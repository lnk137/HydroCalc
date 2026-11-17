const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// 交叉编译产物独立存放，原有 Mac 安装包和原生工作进程保持可用。
const root = path.resolve(__dirname, "..");
const build = path.join(root, "build", "native-win64");
const commands = [
  [
    "-S",
    path.join(root, "native"),
    "-B",
    build,
    "-G",
    "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_TOOLCHAIN_FILE=" +
      path.join(root, "native", "toolchains", "mingw-x64.cmake"),
  ],
  ["--build", build, "--target", "hydrocalc-worker", "--parallel", "8"],
];
// 复用已经校验过的同版本源码缓存，首次独立构建时仍由 CMake 下载并校验。
const cachedSources = {
  OPENCV: path.join(root, "build", "native", "_deps", "opencv-src"),
  JSON: path.join(root, "build", "native", "_deps", "json-src"),
};
for (const [name, directory] of Object.entries(cachedSources)) {
  if (fs.existsSync(path.join(directory, "CMakeLists.txt"))) {
    commands[0].push(`-DFETCHCONTENT_SOURCE_DIR_${name}=${directory}`);
  }
}
for (const arguments_ of commands) {
  const result = spawnSync("cmake", arguments_, {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

// 使用真实 PE 可执行文件，附上静态库许可证，不依赖用户安装编译器或 OpenCV。
const output = path.join(root, "dist", "win32-x64", "worker");
fs.mkdirSync(output, {
  recursive: true,
});
fs.copyFileSync(
  path.join(build, "worker-bin", "hydrocalc-worker.exe"),
  path.join(output, "hydrocalc-worker.exe"),
);
// 去掉发布包不需要的符号表，保持 Windows 工作进程体积接近原生版本。
const stripped = spawnSync(
  "x86_64-w64-mingw32-strip",
  [path.join(output, "hydrocalc-worker.exe")],
  {
    stdio: "inherit",
  },
);
if (stripped.status !== 0) process.exit(stripped.status || 1);
const licenseSources = {
  "OpenCV-LICENSE.txt": "opencv-src/LICENSE",
  "nlohmann-json-LICENSE.txt": "json-src/LICENSE.MIT",
  "libpng-LICENSE.txt": "opencv-src/3rdparty/libpng/LICENSE",
  "libjpeg-turbo-LICENSE.txt": "opencv-src/3rdparty/libjpeg-turbo/LICENSE.md",
  "zlib-LICENSE.txt": "opencv-src/3rdparty/zlib/README",
  "OpenJPEG-LICENSE.txt": "opencv-src/3rdparty/openjpeg/LICENSE",
};
fs.mkdirSync(path.join(output, "licenses"), {
  recursive: true,
});
for (const [name, relative] of Object.entries(licenseSources)) {
  const localSource = path.join(build, "_deps", relative);
  const source = fs.existsSync(localSource)
    ? localSource
    : path.join(root, "build", "native", "_deps", relative);
  if (fs.existsSync(source))
    fs.copyFileSync(source, path.join(output, "licenses", name));
}
// MinGW 静态运行库的许可和 GCC 运行库例外也随 Windows 程序一起分发。
const runtimeLicenses = path.join(root, "packaging", "licenses");
for (const name of fs.readdirSync(runtimeLicenses)) {
  fs.copyFileSync(
    path.join(runtimeLicenses, name),
    path.join(output, "licenses", name),
  );
}
console.log("Windows x64 worker ready:", output);
