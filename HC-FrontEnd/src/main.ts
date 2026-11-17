import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { i18n, setLanguage } from "./i18n";

// 挂载前恢复外观，避免深色启动时闪现浅色界面。
const preference = localStorage.getItem("hydrocalc-theme") || "system";
const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.dataset.theme =
  preference === "dark" || (preference === "system" && systemDark)
    ? "dark"
    : "light";
setLanguage(localStorage.getItem("hydrocalc-language") || "system");
createApp(App).use(i18n).mount("#app");
