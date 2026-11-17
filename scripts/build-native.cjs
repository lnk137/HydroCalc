const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// 构建和复制使用绝对路径，Windows、macOS 共用入口且不依赖调用时的工作目录。
const root = path.resolve(__dirname, "..");
const source = path.join(root, "native");
const build = path.join(root, "build", "native");
const configure = ["-S", source, "-B", build, "-DCMAKE_BUILD_TYPE=Release"];
if (process.platform !== "win32") configure.push("-G", "Ninja");
const commands = [
  configure,
  [
    "--build",
    build,
    "--config",
    "Release",
    "--target",
    "hydrocalc-worker",
    "--parallel",
    "8",
  ],
];
for (const arguments_ of commands) {
  const result = spawnSync("cmake", arguments_, {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

const filename =
  process.platform === "win32" ? "hydrocalc-worker.exe" : "hydrocalc-worker";
const input =
  process.platform === "win32"
    ? path.join(build, "worker-bin", "Release", filename)
    : path.join(build, "worker-bin", filename);
const output = path.join(root, "dist", "worker");
fs.mkdirSync(output, {
  recursive: true,
});
fs.copyFileSync(input, path.join(output, filename));
if (process.platform !== "win32")
  fs.chmodSync(path.join(output, filename), 0o755);
console.log("Native worker ready:", path.join(output, filename));

// 静态链接库的许可随计算程序分发，不依赖构建机器上的源码目录。
const licenses = {
  "OpenCV-LICENSE.txt": "opencv-src/LICENSE",
  "nlohmann-json-LICENSE.txt": "json-src/LICENSE.MIT",
  "libpng-LICENSE.txt": "opencv-src/3rdparty/libpng/LICENSE",
  "libjpeg-turbo-LICENSE.txt": "opencv-src/3rdparty/libjpeg-turbo/LICENSE.md",
  "zlib-LICENSE.txt": "opencv-src/3rdparty/zlib/README",
  "OpenJPEG-LICENSE.txt": "opencv-src/3rdparty/openjpeg/LICENSE",
};
const licenseDirectory = path.join(output, "licenses");
fs.mkdirSync(licenseDirectory, {
  recursive: true,
});
for (const [name, relative] of Object.entries(licenses)) {
  const sourcePath = path.join(build, "_deps", relative);
  if (fs.existsSync(sourcePath))
    fs.copyFileSync(sourcePath, path.join(licenseDirectory, name));
}
