# HydroCalc 界面

Vue 3 + TypeScript。开发、依赖安装和构建统一从仓库根目录执行，使用根目录的 npm lockfile。

- `npm run dev`：Electron 管理的 Vite 开发模式。
- `npm run build:ui`：类型检查并将页面构建到根目录 `web/`。
- `npm run test:desktop`：真实 Electron 全流程测试。

文案位于根目录 `locales/zh-CN.json`、`locales/en-US.json`。新增语言需要增加对应 JSON，注册 `src/i18n.ts` 与 Electron 共用语言资源，再加入设置页语言选项。

所有业务请求通过同源 `/api` 进入 Node；只有原生保存、批量导出、打开数据目录和原生外观使用白名单 IPC。渲染器不直接访问 Node、SQLite 或计算进程。
