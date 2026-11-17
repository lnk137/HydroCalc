const fs = require("node:fs");
const path = require("node:path");

const defaults = {
  language: "zh-CN",
  theme: "system",
  reduce_motion: false,
  method: "auto",
  lower_hsv: [35, 35, 35],
  upper_hsv: [179, 255, 255],
  resolution_width: 500,
  resolution_height: 500,
  soil_width_cm: 50,
  soil_height_cm: 50,
  start_depth_cm: 0,
  matrix_threshold: 0.8,
  depth_threshold: 0.005,
  blur_kernel: 3,
  clusters: 4,
  enable_clustering: true,
  export_include_original: true,
};

function validateSettings(input) {
  // 验证对象和字段白名单，未知字段不能静默进入配置文件。
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("errors.invalidSettings");
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(defaults, key)) throw new Error("errors.invalidNumbers");
  }
  const settings = structuredClone(defaults);
  Object.assign(settings, input);
  if (!["zh-CN", "en-US", "system"].includes(settings.language))
    throw new Error("errors.invalidSettings");
  if (!["light", "dark", "system"].includes(settings.theme))
    throw new Error("errors.invalidSettings");
  if (!["auto", "hsv", "binary"].includes(settings.method))
    throw new Error("errors.invalidSettings");
  for (const key of [
    "reduce_motion",
    "enable_clustering",
    "export_include_original",
  ]) {
    if (typeof settings[key] !== "boolean")
      throw new Error("errors.invalidNumbers");
  }

  // OpenCV 的 H 通道范围为 0–179，S/V 为 0–255。
  for (const key of ["lower_hsv", "upper_hsv"]) {
    const hsv = settings[key];
    if (!Array.isArray(hsv) || hsv.length !== 3)
      throw new Error("errors.invalidHsv");
    for (let index = 0; index < 3; index++) {
      const maximum = index === 0 ? 179 : 255;
      if (
        !Number.isInteger(hsv[index]) ||
        hsv[index] < 0 ||
        hsv[index] > maximum
      )
        throw new Error("errors.invalidHsv");
      if (settings.lower_hsv[index] > settings.upper_hsv[index])
        throw new Error("errors.invalidHsv");
    }
  }

  // 数值统一在本地业务层校验，拒绝 NaN、无限值、越界和小数分辨率。
  const ranges = {
    resolution_width: [64, 2000],
    resolution_height: [64, 2000],
    soil_width_cm: [0.01, 10000],
    soil_height_cm: [0.01, 10000],
    start_depth_cm: [0, 10000],
    matrix_threshold: [0.01, 1],
    depth_threshold: [0.0001, 1],
    clusters: [2, 8],
  };
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    const number = settings[key];
    if (typeof number !== "number" || !Number.isFinite(number))
      throw new Error("errors.invalidNumbers");
    if (number < minimum || number > maximum)
      throw new Error("errors.invalidNumbers");
  }
  for (const key of ["resolution_width", "resolution_height", "clusters"]) {
    if (!Number.isInteger(settings[key]))
      throw new Error("errors.invalidNumbers");
  }
  if (![0, 3, 5, 7].includes(settings.blur_kernel))
    throw new Error("errors.invalidNumbers");
  if (settings.start_depth_cm >= settings.soil_height_cm)
    throw new Error("errors.invalidStart");
  if (settings.depth_threshold > settings.matrix_threshold)
    throw new Error("errors.invalidThreshold");
  return settings;
}

function saveSettings(directory, settings) {
  // 同目录临时文件原子替换，写入失败时保留旧设置。
  const target = path.join(directory, "settings.json");
  const temporary = target + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2));
  fs.renameSync(temporary, target);
}

function loadSettings(directory) {
  const target = path.join(directory, "settings.json");
  if (!fs.existsSync(target)) return structuredClone(defaults);
  const content = fs.readFileSync(target, "utf8");
  return validateSettings(JSON.parse(content));
}

module.exports = {
  defaults,
  validateSettings,
  loadSettings,
  saveSettings,
};
