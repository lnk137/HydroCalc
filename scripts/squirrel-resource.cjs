const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  Data,
  NtExecutable,
  NtExecutableResource,
  Resource,
} = require("resedit");

function readExecutable(filename) {
  // Squirrel 随附的模板尚未签名；资源更新与官方 WriteZipToSetup 的行为一致。
  const bytes = fs.readFileSync(filename);
  return NtExecutable.from(bytes);
}

function writeResources(arguments_) {
  // 压缩步骤交给本机 7-Zip，避免在 ARM Mac 上执行 Windows 压缩程序。
  const [program, ...parameters] = arguments_;
  if (path.basename(program).toLowerCase() === "7z.exe") {
    const result = spawnSync("7zz", parameters, {
      stdio: "inherit",
    });
    if (result.status !== 0)
      throw new Error("Native 7-Zip failed: " + result.status);
    return;
  }

  if (path.basename(program).toLowerCase() === "rcedit.exe") {
    // 安装器最后一步填写版本信息；使用与 Forge 打包器相同的 PE 资源库。
    const executable = readExecutable(parameters[0]);
    const resources = NtExecutableResource.from(executable);
    const versions = Resource.VersionInfo.fromEntries(resources.entries);
    if (versions.length !== 1)
      throw new Error("Expected one installer version resource");
    const version = versions[0];
    const strings = {};
    for (let index = 1; index < parameters.length; ) {
      const option = parameters[index++];
      if (option === "--set-version-string") {
        const key = parameters[index++];
        strings[key] = parameters[index++];
      } else if (
        option === "--set-file-version" ||
        option === "--set-product-version"
      ) {
        const numbers = parameters[index++].split(".").map(Number);
        if (option === "--set-file-version") version.setFileVersion(...numbers);
        else version.setProductVersion(...numbers);
      } else if (option === "--set-icon") {
        const bytes = fs.readFileSync(parameters[index++]);
        const icon = Data.IconFile.from(bytes);
        const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
        for (const group of groups) {
          Resource.IconGroupEntry.replaceIconsForResource(
            resources.entries,
            group.id,
            group.lang,
            icon.icons.map((item) => item.data),
          );
        }
      } else {
        throw new Error("Unsupported installer resource option: " + option);
      }
    }

    // 同步现有语言的版本字符串，保留之前已经内嵌的完整安装 ZIP。
    for (const language of version.getAllLanguagesForStringValues()) {
      version.setStringValues(language, strings);
    }
    version.outputToResourceEntries(resources.entries);
    resources.outputResource(executable);
    fs.writeFileSync(parameters[0], Buffer.from(executable.generate()));
    return;
  }

  // 仅接受官方资源工具的调用，不能把这个适配器用于执行其他 Windows 程序。
  if (path.basename(program).toLowerCase() !== "writeziptosetup.exe") {
    throw new Error(
      "Only Squirrel WriteZipToSetup resource operations are supported",
    );
  }

  if (parameters[0] === "--copy-stub-resources") {
    if (parameters.length !== 3)
      throw new Error("Expected source and destination executables");

    // 完整复制应用的资源表至执行代理，包括图标、版本、清单和 ASAR 完整性信息。
    const source = readExecutable(parameters[1]);
    const destination = readExecutable(parameters[2]);
    const resources = NtExecutableResource.from(source);
    resources.outputResource(destination);
    fs.writeFileSync(parameters[2], Buffer.from(destination.generate()));
    return;
  }

  // 与官方源码一致：安装 ZIP 写入 DATA/131/0x0409，可选框架版本写入 FLAGS/132。
  const hasFramework =
    parameters.length === 4 && parameters[2] === "--set-required-framework";
  if (parameters.length !== 2 && !hasFramework)
    throw new Error("Unexpected Squirrel resource arguments");
  const executable = readExecutable(parameters[0]);
  const resources = NtExecutableResource.from(executable);
  const archive = fs.readFileSync(parameters[1]);
  resources.entries = resources.entries.filter(
    (entry) => entry.type !== "DATA" || entry.id !== 131,
  );
  resources.entries.push({
    type: "DATA",
    id: 131,
    lang: 0x0409,
    codepage: 0,
    bin: Uint8Array.from(archive).buffer,
  });
  if (hasFramework) {
    const framework = Buffer.from(parameters[3] + "\0", "utf16le");
    resources.entries = resources.entries.filter(
      (entry) => entry.type !== "FLAGS" || entry.id !== 132,
    );
    resources.entries.push({
      type: "FLAGS",
      id: 132,
      lang: 0x0409,
      codepage: 0,
      bin: Uint8Array.from(framework).buffer,
    });
  }

  // 保留模板的机器代码和入口点，只更新资源节，之后由 Forge 完成产物命名。
  resources.outputResource(executable);
  fs.writeFileSync(parameters[0], Buffer.from(executable.generate()));
}

if (require.main === module) writeResources(process.argv.slice(2));
module.exports = { writeResources };
