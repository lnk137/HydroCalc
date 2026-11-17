const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { _electron } = require("playwright");
const { defaults } = require("../electron/settings.cjs");
const { unzipSync } = require("fflate");

const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydrocalc-desktop-"));
const outputDir =
  process.env.HYDROCALC_CHECK_OUTPUT || path.join(dataDir, "screenshots");
fs.mkdirSync(outputDir, {
  recursive: true,
});

function fixture(filename, binary) {
  // 测试固定图由真实 C++ 解码为 PNG；可选的实验图路径只通过环境传入，不提交用户图片。
  const directory = path.join(dataDir, filename);
  fs.mkdirSync(directory);
  const input = path.join(directory, "input.ppm");
  const pixels = Buffer.alloc(100 * 100 * 3);
  for (let row = 0; row < 100; row++) {
    for (let column = 0; column < 100; column++) {
      const color =
        row < 50 ? (binary ? [0, 0, 0] : [40, 130, 90]) : [255, 255, 255];
      for (let channel = 0; channel < 3; channel++)
        pixels[(row * 100 + column) * 3 + channel] = color[channel];
    }
  }
  fs.writeFileSync(
    input,
    Buffer.concat([Buffer.from("P6\n100 100\n255\n"), pixels]),
  );
  const worker = path.join(
    root,
    "dist",
    "worker",
    process.platform === "win32" ? "hydrocalc-worker.exe" : "hydrocalc-worker",
  );
  const command = {
    input,
    output: directory,
    settings: defaults,
  };
  const result = spawnSync(worker, [], {
    input: JSON.stringify(command) + "\n",
  });
  assert.equal(result.status, 0, result.stdout.toString());
  return path.join(directory, "original.png");
}

async function launch() {
  // 真实启动 Electron、沙盒渲染器、Node 服务和独立 C++ 进程。
  return _electron.launch({
    executablePath: process.env.HYDROCALC_EXECUTABLE || require("electron"),
    args: process.env.HYDROCALC_EXECUTABLE ? [] : [root],
    env: {
      ...process.env,
      HYDROCALC_DATA_DIR: dataDir,
    },
  });
}

async function run() {
  const colorImage =
    process.env.HYDROCALC_TEST_COLOR || fixture("color", false);
  const binaryImage =
    process.env.HYDROCALC_TEST_BINARY || fixture("binary", true);
  const invalid = path.join(dataDir, "invalid.png");
  fs.writeFileSync(invalid, "invalid image");
  let application = await launch();
  let page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page
      .getByRole("heading", { name: "图像分析", exact: true })
      .waitFor();
    assert.equal(await page.locator(".eyebrow").count(), 0);
    const background = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    );
    assert.equal(background, "#f4f4f5");
    console.log("Desktop startup and neutral background passed");

    // 同一批次混合彩色、二值和损坏图片：成功项继续完成，失败项独立显示。
    await page
      .locator('input[accept="image/png,image/jpeg"]')
      .setInputFiles([colorImage, binaryImage, invalid]);
    await page.waitForFunction(
      () => {
        const rows = [
          ...document.querySelectorAll(".batch-list .batch-status"),
        ];
        return (
          rows.length === 3 &&
          rows.every((row) =>
            ["已完成", "无法读取图片，请选择有效的 PNG 或 JPEG"].includes(
              row.textContent,
            ),
          )
        );
      },
      null,
      { timeout: 30000 },
    );
    const records = await page.evaluate(async () =>
      (await fetch("/api/analyses")).json(),
    );
    assert.equal(
      records.filter((record) => record.status === "completed").length,
      2,
    );
    assert.equal(
      records.filter((record) => record.status === "failed").length,
      1,
    );
    const completed = records.filter((record) => record.status === "completed");
    const details = [];
    for (const record of completed) {
      const detail = await page.evaluate(
        async (id) => (await fetch("/api/analyses/" + id)).json(),
        record.id,
      );
      details.push(detail);
    }
    assert.ok(details.some((record) => record.effective_method === "hsv"));
    assert.ok(details.some((record) => record.effective_method === "binary"));
    fs.writeFileSync(
      path.join(outputDir, "trial-results.json"),
      JSON.stringify(details, null, 2),
    );
    console.log(
      "Mixed batch and failure isolation passed:",
      details.map((record) => record.metrics),
    );

    // 通过原生 IPC 导出真实 ZIP，文件对话框只在测试中替换为确定的保存路径。
    const batchPath = path.join(outputDir, "批量试验结果.zip");
    await application.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: target,
      });
    }, batchPath);
    await page
      .getByRole("button", { name: "导出整个批次", exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector(".toast")?.textContent?.includes("文件已保存"),
    );
    const archived = unzipSync(fs.readFileSync(batchPath));
    assert.ok(archived["summary.csv"]);
    assert.equal(
      Object.keys(archived).filter((name) => name.endsWith("/mask.png")).length,
      2,
    );

    await page
      .locator(".batch-list > button")
      .filter({ hasText: path.basename(colorImage) })
      .first()
      .click();
    await page.getByRole("button", { name: "原图", exact: true }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(outputDir, "浅色-彩色试验图.png"),
      scale: "css",
      fullPage: true,
    });

    // HSV 新控件同时验证键盘微调、输入自动保存和无效值不覆盖有效设置。
    await page
      .locator("nav")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await page.getByRole("tab", { name: "分析参数", exact: true }).click();
    const lowerHue = page.getByRole("slider", {
      name: "H 色相 下限",
      exact: true,
    });
    await lowerHue.focus();
    await lowerHue.press("ArrowRight");
    await page.waitForFunction(
      async () =>
        (await (await fetch("/api/bootstrap")).json()).settings.lower_hsv[0] ===
        36,
    );
    const width = page.getByLabel("实际宽度", { exact: false });
    await width.fill("0");
    await page
      .getByText("请检查分辨率、尺寸及阈值的范围和格式", { exact: true })
      .waitFor();
    const storedWidth = await page.evaluate(
      async () =>
        (await (await fetch("/api/bootstrap")).json()).settings.soil_width_cm,
    );
    assert.equal(storedWidth, 50);
    await width.fill("50");
    await page.getByText("已自动保存", { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(outputDir, "设置-HSV双滑块.png"),
      scale: "css",
      fullPage: true,
    });

    // 切换语言和外观自动持久化，且不改变已有历史记录。
    await page.getByRole("tab", { name: "外观", exact: true }).click();
    await page.locator(".language-select").selectOption("en-US");
    await page
      .getByRole("heading", { name: "Settings", exact: true })
      .waitFor();
    await page.getByText("Saved automatically", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await page.getByText("Saved automatically", { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(outputDir, "设置-English-夜间.png"),
      scale: "css",
      fullPage: true,
    });
    await page
      .locator("nav")
      .getByRole("button", { name: "Image analysis", exact: true })
      .click();
    await page
      .locator(".batch-list > button")
      .filter({ hasText: path.basename(binaryImage) })
      .first()
      .click();
    await page.getByRole("button", { name: "Binary", exact: true }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(outputDir, "夜间-English-二值试验图.png"),
      scale: "css",
      fullPage: true,
    });
    const previousIds = records.map((record) => record.id).sort();
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await page
      .getByRole("heading", { name: "Image analysis", exact: true })
      .waitFor();
    const restored = await page.evaluate(async () =>
      (await fetch("/api/bootstrap")).json(),
    );
    assert.equal(restored.settings.theme, "dark");
    assert.equal(restored.settings.language, "en-US");
    const restoredRecords = await page.evaluate(async () =>
      (await fetch("/api/analyses")).json(),
    );
    assert.deepEqual(
      restoredRecords.map((record) => record.id).sort(),
      previousIds,
    );
    // 真实文件夹入口保留相对路径，同名图片不会合并或覆盖。
    const folder = path.join(dataDir, "import-folder");
    for (const part of ["first", "second"]) {
      const child = path.join(folder, part);
      fs.mkdirSync(child, { recursive: true });
      fs.copyFileSync(
        part === "first" ? colorImage : binaryImage,
        path.join(child, "same-name.png"),
      );
    }
    await page.locator("input[webkitdirectory]").setInputFiles(folder);
    await page.waitForFunction(
      () => document.querySelectorAll(".batch-status.completed").length === 2,
    );
    const folderRecords = await page.evaluate(async () =>
      (await fetch("/api/analyses")).json(),
    );
    const names = folderRecords
      .filter((record) => record.name.includes("same-name"))
      .map((record) => record.name);
    assert.equal(names.length, 2);
    assert.notEqual(names[0], names[1]);
    console.log("Folder import with duplicate basenames passed");

    // 一批八张图超过服务的四项队列上限，前端流水线仍能排队且允许取消等待项。
    const cancelFiles = [];
    for (let index = 0; index < 8; index++) {
      const target = path.join(dataDir, "cancel-" + index + ".png");
      fs.copyFileSync(binaryImage, target);
      cancelFiles.push(target);
    }
    await page
      .locator('input[accept="image/png,image/jpeg"]')
      .setInputFiles(cancelFiles);
    await page
      .getByRole("button", { name: "Cancel waiting", exact: true })
      .click();
    await page.waitForFunction(() => {
      const statuses = [...document.querySelectorAll(".batch-status")];
      return (
        statuses.length === 8 &&
        statuses.every((status) =>
          ["Complete", "Cancelled"].includes(status.textContent),
        )
      );
    });
    assert.ok((await page.locator(".batch-status.cancelled").count()) > 0);
    console.log("Batch backpressure and cancellation passed");
    assert.deepEqual(errors, []);
    console.log(
      "Autosave, range slider, localization, dark mode, ZIP export and restart recovery passed",
    );
  } finally {
    await application.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
