import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 开发代理由 Electron 注入实际后端地址，发行版直接使用同源 API。
const backend = process.env.HYDROCALC_API_URL || "http://127.0.0.1:5000";

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "../web",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": backend,
    },
  },
});
