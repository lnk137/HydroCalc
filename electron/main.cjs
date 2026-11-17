const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createService } = require("./service.cjs");
const { exportFile, exportBatch } = require("./exports.cjs");
const { translate } = require("./i18n.cjs");

const root = path.resolve(__dirname, "..");
const development = process.argv.includes("--dev");
if (process.env.HYDROCALC_DATA_DIR)
  app.setPath("userData", process.env.HYDROCALC_DATA_DIR);
let service;
let window;
let vite;
let closing = false;
let origin;
let language = "en-US";

// Squirrel 安装事件不启动业务和计算服务，单实例锁避免同时写入同一历史目录。
const squirrelStartup = require("electron-squirrel-startup");
if (squirrelStartup || !app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      const locale = app.getLocale().startsWith("zh") ? "zh-CN" : "en-US";
      dialog.showErrorBox(
        translate(locale, "native.startFailed"),
        error.stack || error.message,
      );
      app.quit();
    });
}

function trusted(event) {
  // 原生文件操作只接受当前主窗口、当前本地来源发出的 IPC。
  if (!window || event.sender !== window.webContents)
    throw new Error("errors.localOnly");
  const senderOrigin = new URL(event.senderFrame.url).origin;
  if (senderOrigin !== origin) throw new Error("errors.localOnly");
}

function rebuildMenu() {
  const label = (key) => translate(language, "menu." + key);
  const item = (role, key) => ({
    role,
    label: label(key),
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      {
        label: label("edit"),
        submenu: [
          item("undo", "undo"),
          item("redo", "redo"),
          { type: "separator" },
          item("cut", "cut"),
          item("copy", "copy"),
          item("paste", "paste"),
          item("selectAll", "selectAll"),
        ],
      },
      {
        label: label("view"),
        submenu: [
          item("zoomIn", "zoomIn"),
          item("zoomOut", "zoomOut"),
          item("resetZoom", "actualSize"),
          item("togglefullscreen", "fullscreen"),
        ],
      },
      {
        label: label("window"),
        submenu: [item("minimize", "minimize"), item("close", "close")],
      },
    ]),
  );
}

async function start() {
  const dataDir = process.env.HYDROCALC_DATA_DIR || app.getPath("userData");
  const executable =
    process.platform === "win32" ? "hydrocalc-worker.exe" : "hydrocalc-worker";
  const worker = app.isPackaged
    ? path.join(process.resourcesPath, "worker", executable)
    : path.join(root, "dist", "worker", executable);
  await fs.access(worker);
  service = await createService({
    dataDir,
    worker,
    webDir: path.join(root, "web"),
  });
  let url = service.url;
  if (development) {
    // 开发服务以真实动态端口代理 API，主进程管理其生命周期。
    process.env.HYDROCALC_API_URL = service.url;
    const { createServer } = await import("vite");
    vite = await createServer({
      root: path.join(root, "HC-FrontEnd"),
      server: {
        host: "127.0.0.1",
        port: 0,
      },
    });
    await vite.listen();
    url = vite.resolvedUrls.local[0];
  }
  origin = new URL(url).origin;
  console.log("HydroCalc URL:", url);

  // 操作系统主题与网页样式保持一致；原生窗口允许缩放而不是固定尺寸。
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  window = new BrowserWindow({
    title: "HydroCalc",
    width: Math.min(1390, workArea.width),
    height: Math.min(980, workArea.height),
    minWidth: Math.min(900, workArea.width),
    minHeight: Math.min(680, workArea.height),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#21252b" : "#f5f6f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({
    action: "deny",
  }));
  window.webContents.on("will-navigate", (event, destination) => {
    if (new URL(destination).origin !== origin) event.preventDefault();
  });

  ipcMain.handle("hydrocalc:theme", (event, theme) => {
    trusted(event);
    if (!["light", "dark", "system"].includes(theme))
      throw new Error("errors.invalidSettings");
    nativeTheme.themeSource = theme;
    window.setBackgroundColor(
      nativeTheme.shouldUseDarkColors ? "#21252b" : "#f5f6f4",
    );
  });
  ipcMain.handle("hydrocalc:language", (event, preference) => {
    trusted(event);
    if (!["zh-CN", "en-US"].includes(preference))
      throw new Error("errors.invalidSettings");
    if (language !== preference) {
      language = preference;
      rebuildMenu();
    }
  });
  ipcMain.handle("hydrocalc:open-directory", async (event) => {
    trusted(event);
    const error = await shell.openPath(dataDir);
    if (error) throw new Error(error);
  });
  ipcMain.handle("hydrocalc:export", async (event, identifier, kind) => {
    trusted(event);
    const file = await exportFile(service.repository, identifier, kind);
    const result = await dialog.showSaveDialog(window, {
      title: translate(language, "export.button"),
      defaultPath: file.filename,
      filters: [
        {
          name: path.extname(file.filename).slice(1).toUpperCase(),
          extensions: [path.extname(file.filename).slice(1)],
        },
      ],
    });
    if (result.canceled || !result.filePath)
      return {
        cancelled: true,
      };
    await fs.writeFile(result.filePath, file.content);
    return {
      saved: true,
    };
  });
  ipcMain.handle("hydrocalc:export-batch", async (event, identifiers) => {
    trusted(event);
    const result = await dialog.showSaveDialog(window, {
      title: translate(language, "batch.export"),
      defaultPath: "hydrocalc-batch.zip",
      filters: [
        {
          name: "ZIP",
          extensions: ["zip"],
        },
      ],
    });
    if (result.canceled || !result.filePath)
      return {
        cancelled: true,
      };
    await exportBatch(service.repository, identifiers, result.filePath);
    return {
      saved: true,
    };
  });
  rebuildMenu();
  await window.loadURL(url);
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  // 先停计算进程和 HTTP 服务，再释放 SQLite；不留下后台孤儿进程。
  if (closing) return;
  event.preventDefault();
  closing = true;
  Promise.resolve()
    .then(async () => {
      if (vite) await vite.close();
      if (service) await service.close();
    })
    .catch(console.error)
    .finally(() => app.quit());
});
