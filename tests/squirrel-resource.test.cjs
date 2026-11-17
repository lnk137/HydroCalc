const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { zipSync, unzipSync } = require("fflate");
const { NtExecutable, NtExecutableResource } = require("resedit");
const { writeResources } = require("../scripts/squirrel-resource.cjs");

test("Squirrel installer retains executable code and embeds exact installation ZIP", () => {
  // 使用 Forge 实际随附的安装器模板，避免用模拟 PE 文件掩盖资源表兼容问题。
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "hydrocalc-installer-"),
  );
  try {
    const installer = path.join(directory, "Setup.exe");
    const vendor = require.resolve("electron-winstaller/vendor/Setup.exe");
    fs.copyFileSync(vendor, installer);
    const before = NtExecutable.from(fs.readFileSync(installer));
    const originalCode = before
      .getAllSections()
      .find((section) => section.info.name === ".text");
    assert.ok(originalCode);

    // 安装 ZIP 含真实二进制成员，同时覆盖可选框架版本的 UTF-16 编码。
    const archive = zipSync({
      RELEASES: Buffer.from("fixture"),
      "package.nupkg": Uint8Array.from([0, 1, 2, 255]),
    });
    const archivePath = path.join(directory, "install.zip");
    fs.writeFileSync(archivePath, archive);
    writeResources([
      "WriteZipToSetup.exe",
      installer,
      archivePath,
      "--set-required-framework",
      "net45",
    ]);

    // 重新解析输出，检查入口点、机器代码、资源标识以及内嵌 ZIP 的逐字节一致性。
    const after = NtExecutable.from(fs.readFileSync(installer));
    assert.equal(
      after.newHeader.optionalHeader.addressOfEntryPoint,
      before.newHeader.optionalHeader.addressOfEntryPoint,
    );
    const updatedCode = after
      .getAllSections()
      .find((section) => section.info.name === ".text");
    assert.deepEqual(updatedCode, originalCode);
    const resources = NtExecutableResource.from(after);
    const data = resources.entries.find(
      (entry) =>
        entry.type === "DATA" && entry.id === 131 && entry.lang === 0x0409,
    );
    assert.deepEqual(Buffer.from(data.bin), Buffer.from(archive));
    const extracted = unzipSync(new Uint8Array(data.bin));
    assert.deepEqual(
      extracted["package.nupkg"],
      Uint8Array.from([0, 1, 2, 255]),
    );
    const flags = resources.entries.find(
      (entry) => entry.type === "FLAGS" && entry.id === 132,
    );
    assert.equal(Buffer.from(flags.bin).toString("utf16le"), "net45\0");

    // 版本编辑也必须保留安装负载，这是 Squirrel 在生成安装器时的最后一个步骤。
    writeResources([
      "rcedit.exe",
      installer,
      "--set-version-string",
      "ProductName",
      "HydroCalc",
      "--set-file-version",
      "2.0.0",
      "--set-product-version",
      "2.0.0",
    ]);
    const versioned = NtExecutableResource.from(
      NtExecutable.from(fs.readFileSync(installer)),
    );
    const embedded = versioned.entries.find(
      (entry) => entry.type === "DATA" && entry.id === 131,
    );
    assert.deepEqual(Buffer.from(embedded.bin), Buffer.from(archive));

    // 执行代理应完整继承应用的资源，不保留旧资源或遗漏语言版本。
    const stub = path.join(directory, "Stub.exe");
    fs.copyFileSync(vendor, stub);
    writeResources([
      "WriteZipToSetup.exe",
      "--copy-stub-resources",
      installer,
      stub,
    ]);
    const copied = NtExecutableResource.from(
      NtExecutable.from(fs.readFileSync(stub)),
    );
    assert.deepEqual(copied.entries, versioned.entries);
    assert.throws(() => writeResources(["unrelated.exe"]), /Only Squirrel/);
  } finally {
    // 测试结束删除独立临时目录，包含失败时的中间文件。
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});
