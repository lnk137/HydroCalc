const messages = {
  "zh-CN": require("../locales/zh-CN.json"),
  "en-US": require("../locales/en-US.json"),
};

function translate(language, key) {
  // Electron 与 Vue 共用语言资源，原生菜单不会维护另一套重复文案。
  const catalog = messages[language] || messages["en-US"];
  return catalog[key] || key;
}

module.exports = {
  translate,
};
