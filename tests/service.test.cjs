const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { unzipSync } = require("fflate");
const { createService } = require("../electron/service.cjs");
const { defaults } = require("../electron/settings.cjs");

const workerName =
  process.platform === "win32" ? "hydrocalc-worker.exe" : "hydrocalc-worker";
const headers = {
  "X-HydroCalc": "1",
};

async function wait(url, id) {
  // 等待真实工作进程，测试超时明确失败而不是无期限轮询。
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}/api/analyses/${id}`);
    const record = await response.json();
    if (["completed", "failed"].includes(record.status)) return record;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("原生任务超时");
}

test("full API upload, settings, XLSX, ZIP and deletion", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "hydrocalc-service-"),
  );
  const service = await createService({
    dataDir: directory,
    webDir: path.resolve("web"),
    worker: path.resolve("dist/worker", workerName),
  });
  try {
    const { url } = service;
    const settings = {
      ...defaults,
      method: "binary",
      enable_clustering: false,
      resolution_width: 100,
      resolution_height: 100,
      theme: "dark",
    };
    const refused = await fetch(`${url}/api/settings`, {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    assert.equal(refused.status, 400);
    const saved = await fetch(`${url}/api/settings`, {
      method: "PUT",
      headers,
      body: JSON.stringify(settings),
    });
    assert.equal(saved.status, 200);
    const body = new FormData();
    const pixels = Buffer.alloc(100 * 100 * 3);
    const image = Buffer.concat([Buffer.from("P6\n100 100\n255\n"), pixels]);
    body.append("file", new Blob([image]), "中文 土壤.ppm");
    body.append("settings", JSON.stringify(settings));
    const response = await fetch(`${url}/api/analyses`, {
      method: "POST",
      headers,
      body,
    });
    assert.equal(response.status, 202);
    const submission = await response.json();
    const record = await wait(url, submission.id);
    assert.equal(record.status, "completed", record.error);
    assert.equal(record.metrics.stained_area_cm2, 2500);

    // 真实读取 Excel 单元格，验证导出没有混入参考线颜色。
    const matrixResponse = await fetch(
      `${url}/api/analyses/${record.id}/export/matrix`,
    );
    assert.equal(matrixResponse.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await matrixResponse.arrayBuffer()));
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.rowCount, 100);
    assert.equal(sheet.getCell("A1").value, 0);
    assert.equal(sheet.getCell("CV100").value, 0);

    const bundleResponse = await fetch(
      `${url}/api/analyses/${record.id}/export/bundle`,
    );
    const bytes = new Uint8Array(await bundleResponse.arrayBuffer());
    const files = unzipSync(bytes);
    assert.ok(files["original.png"]);
    assert.ok(files["mask.png"]);
    assert.ok(files["profile.csv"]);
    assert.ok(files["matrix.csv"]);
    const metadata = JSON.parse(Buffer.from(files["result.json"]).toString());
    assert.equal(metadata.settings.soil_width_cm, 50);

    // 无效 JSON 需要成为请求错误，不能从事件回调逃逸并终止整个应用。
    const invalidBody = new FormData();
    invalidBody.append("file", new Blob([image]), "bad.ppm");
    invalidBody.append("settings", "bad json");
    const invalid = await fetch(`${url}/api/analyses`, {
      method: "POST",
      headers,
      body: invalidBody,
    });
    assert.equal(invalid.status, 400);
    const bootstrap = await fetch(`${url}/api/bootstrap`);
    const info = await bootstrap.json();
    assert.equal(info.settings.theme, "dark");
    const deleted = await fetch(`${url}/api/analyses/${record.id}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(deleted.status, 204);
    assert.equal(service.repository.history().length, 0);
  } finally {
    await service.close();
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});
