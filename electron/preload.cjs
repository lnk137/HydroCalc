const { contextBridge, ipcRenderer } = require("electron");

// 渲染层只得到三个明确能力，不能使用任意 IPC、Node 文件系统或进程 API。
contextBridge.exposeInMainWorld("hydrocalc", {
  exportArtifact: (identifier, kind) =>
    ipcRenderer.invoke("hydrocalc:export", identifier, kind),
  exportBatch: (identifiers) =>
    ipcRenderer.invoke("hydrocalc:export-batch", identifiers),
  openDataDirectory: () => ipcRenderer.invoke("hydrocalc:open-directory"),
  setTheme: (theme) => ipcRenderer.invoke("hydrocalc:theme", theme),
  setLanguage: (language) => ipcRenderer.invoke("hydrocalc:language", language),
});
