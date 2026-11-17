const fs = require("node:fs");
const path = require("node:path");

// 为交叉构建选择独立资源，避免将 Mac 二进制误装进 Windows 包。
const targetPlatform =
  process.env.HYDROCALC_TARGET_PLATFORM || process.platform;
const crossWindows = targetPlatform === "win32" && process.platform !== "win32";
const workerDirectory = crossWindows
  ? path.join(__dirname, "dist", "win32-x64", "worker")
  : path.join(__dirname, "dist", "worker");

// 计算程序放在 ASAR 外；交叉构建也必须使用目标系统和架构的真实二进制。
module.exports = {
  packagerConfig: {
    asar: true,
    name: "HydroCalc",
    executableName: "HydroCalc",
    appBundleId: "com.lnk137.hydrocalc",
    appCategoryType: "public.app-category.education",
    icon: path.join(__dirname, "packaging", "HydroCalc"),
    extraResource: [workerDirectory],
    ignore: [
      /^\/(?:native|build|dist|out|tests|docs|scripts|HC-FrontEnd|README.assets|packaging|\.git|\.idea)(?:\/|$)/,
      /(?:^|\/)(?:AGENTS|CLAUDE|GEMINI)\.md$/i,
      /^\/package-lock\.json$/,
    ],
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "win32"],
    },
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        name: "HydroCalc",
      },
    },
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "HydroCalc",
      },
    },
  ],
  hooks: {
    prePackage: async () => {
      const filename =
        targetPlatform === "win32"
          ? "hydrocalc-worker.exe"
          : "hydrocalc-worker";
      for (const resource of [
        path.join(__dirname, "web/index.html"),
        path.join(workerDirectory, filename),
      ]) {
        if (!fs.existsSync(resource))
          throw new Error(`缺少 ${resource}，请先构建前端和 C++ 进程`);
      }
    },
  },
};
