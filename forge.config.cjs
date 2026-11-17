const fs = require("node:fs");
const path = require("node:path");

// 原生计算程序放在 ASAR 外，构建时必须在目标系统和目标架构上编译。
module.exports = {
  packagerConfig: {
    asar: true,
    name: "HydroCalc",
    executableName: "HydroCalc",
    appBundleId: "com.lnk137.hydrocalc",
    appCategoryType: "public.app-category.education",
    icon: path.join(__dirname, "packaging", "HydroCalc"),
    extraResource: [path.join(__dirname, "dist", "worker")],
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
        process.platform === "win32"
          ? "hydrocalc-worker.exe"
          : "hydrocalc-worker";
      for (const resource of ["web/index.html", `dist/worker/${filename}`]) {
        if (!fs.existsSync(path.join(__dirname, resource)))
          throw new Error(`缺少 ${resource}，请先构建前端和 C++ 进程`);
      }
    },
  },
};
