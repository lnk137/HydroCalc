import { createI18n } from "vue-i18n";
import zhCN from "../../locales/zh-CN.json";
import enUS from "../../locales/en-US.json";

export const i18n = createI18n({
  legacy: false,
  flatJson: true,
  locale: "zh-CN",
  fallbackLocale: "en-US",
  messages: {
    "zh-CN": zhCN,
    "en-US": enUS,
  },
});

export function t(key: string, parameters: Record<string, unknown> = {}) {
  // 业务层与计算进程只发送稳定代码，具体语言由当前界面决定。
  if (!i18n.global.te(key)) return key;
  return i18n.global.t(key, parameters);
}

export function setLanguage(language: string) {
  // 跟随系统时按浏览器语言选择，未提供的语言统一回退为英语。
  const preference = language === "system" ? navigator.language : language;
  const locale = preference.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
  localStorage.setItem("hydrocalc-language", language);
  window.hydrocalc?.setLanguage(locale).catch(console.error);
}
