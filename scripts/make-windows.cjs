const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Windows 本机直接使用 Forge；非 Windows 主机使用 MinGW 产物和本机 Mono。
const root = path.resolve(__dirname, "..");
const env = {
  ...process.env,
  HYDROCALC_TARGET_PLATFORM: "win32",
};
if (process.platform !== "win32") {
  for (const executable of ["mono", "7zz"]) {
    const available = spawnSync("which", [executable], {
      encoding: "utf8",
    });
    if (available.status !== 0)
      throw new Error("Missing build dependency: " + executable);
  }

  // Squirrel 仍负责 NuGet、发布索引和安装协议；仅替换资源写入与压缩两个辅助操作。
  const tools = path.join(root, "build", "windows-installer-tools");
  fs.mkdirSync(tools, {
    recursive: true,
  });
  const helper = path.join(__dirname, "squirrel-resource.cjs");
  const launcher = `#!${process.execPath}\nrequire(${JSON.stringify(helper)}).writeResources(process.argv.slice(2));\n`;
  for (const filename of ["wine", "wine64"]) {
    const target = path.join(tools, filename);
    fs.writeFileSync(target, launcher);
    fs.chmodSync(target, 0o755);
  }
  env.PATH = tools + path.delimiter + process.env.PATH;

  // 将构建临时文件留在项目内，避免污染用户配置目录。
  env.TMPDIR = path.join(tools, "tmp") + path.sep;
  env.XDG_DATA_HOME = path.join(tools, "data");
  fs.mkdirSync(env.TMPDIR, {
    recursive: true,
  });
  fs.mkdirSync(env.XDG_DATA_HOME, {
    recursive: true,
  });
}

// 始终打包当前前端与 Windows 工作进程；仅重做安装器时可显式跳过打包。
const arguments_ = ["make", "--platform=win32", "--arch=x64"];
if (process.argv.includes("--skip-package")) arguments_.push("--skip-package");
const forge = require.resolve("@electron-forge/cli/dist/electron-forge.js");
const result = spawnSync(process.execPath, [forge, ...arguments_], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
