const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { defaults, validateSettings } = require("../electron/settings.cjs");
const { Repository } = require("../electron/repository.cjs");

const executable =
  process.platform === "win32" ? "hydrocalc-worker.exe" : "hydrocalc-worker";
const worker = path.resolve(__dirname, "..", "dist", "worker", executable);

function analyze(width, height, pixel, overrides = {}) {
  // PPM 是无损、无外部依赖的真实图像输入，仍通过完整 OpenCV 解码和工作进程。
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hydrocalc 中文 "));
  const input = path.join(directory, "土壤 image.ppm");
  const body = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = pixel(x, y);
      for (let channel = 0; channel < 3; channel++)
        body[(y * width + x) * 3 + channel] = color[channel];
    }
  }
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
  fs.writeFileSync(input, Buffer.concat([header, body]));
  const settings = validateSettings({
    ...defaults,
    method: "binary",
    resolution_width: width,
    resolution_height: height,
    enable_clustering: false,
    ...overrides,
  });
  const command = {
    input,
    output: directory,
    settings,
  };
  const result = spawnSync(worker, [], {
    input: JSON.stringify(command) + "\n",
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const messages = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const data = messages.find((message) => message.event === "result").data;
  return {
    directory,
    data,
    cleanup: () =>
      fs.rmSync(directory, {
        recursive: true,
        force: true,
      }),
  };
}

for (const resolution of [100, 500, 1000]) {
  test(`physical calibration is resolution invariant at ${resolution}px`, () => {
    const run = analyze(
      resolution,
      resolution,
      (_x, y) => (y < resolution / 2 ? [0, 0, 0] : [255, 255, 255]),
      {
        soil_height_cm: 40,
      },
    );
    try {
      assert.equal(run.data.metrics.stained_area_cm2, 1000);
      assert.equal(run.data.metrics.matrix_depth_cm, 20);
      assert.equal(run.data.metrics.maximum_depth_cm, 20);
      assert.equal(run.data.metrics.priority_percentage, 0);
      assert.equal(run.data.metrics.length_index, 100);
      assert.equal(run.data.profile.length, resolution);
    } finally {
      run.cleanup();
    }
  });
}

for (const stained of [false, true]) {
  test(`uniform ${stained ? "black" : "white"} images have finite metrics`, () => {
    const run = analyze(100, 100, () =>
      stained ? [0, 0, 0] : [255, 255, 255],
    );
    try {
      assert.equal(run.data.metrics.stained_area_cm2, stained ? 2500 : 0);
      assert.equal(run.data.metrics.matrix_depth_cm, stained ? 50 : 0);
      assert.equal(run.data.metrics.maximum_depth_cm, stained ? 50 : 0);
      assert.equal(run.data.metrics.priority_percentage, 0);
    } finally {
      run.cleanup();
    }
  });
}

test("priority flow uses actual pixels below matrix boundary", () => {
  const run = analyze(100, 100, (x, y) =>
    x < (y < 50 ? 90 : 20) ? [0, 0, 0] : [255, 255, 255],
  );
  try {
    assert.equal(run.data.metrics.stained_area_cm2, 1375);
    assert.equal(run.data.metrics.priority_area_ratio, 10);
    assert.equal(run.data.metrics.priority_percentage, 18.1818);
  } finally {
    run.cleanup();
  }
});

test("HSV extraction and both clustering variants share physical calibration", () => {
  const run = analyze(
    100,
    100,
    (x, y) => (y < 50 ? [40 + Math.floor(x / 3), 130, 90] : [255, 255, 255]),
    {
      method: "hsv",
      blur_kernel: 0,
      enable_clustering: true,
      soil_height_cm: 40,
    },
  );
  try {
    assert.equal(run.data.metrics.stained_ratio, 50);
    for (const key of ["clusters", "clusters_blurred"]) {
      assert.ok(fs.existsSync(path.join(run.directory, key + ".png")));
      const ratio = run.data.colors[key].reduce(
        (sum, color) => sum + color.ratio,
        0,
      );
      assert.ok(Math.abs(ratio - 100) < 0.001);
      const area = run.data.colors[key].reduce(
        (sum, color) => sum + color.area_cm2,
        0,
      );
      assert.ok(Math.abs(area - 2000) < 0.001);
    }
  } finally {
    run.cleanup();
  }
});

test("invalid settings never reach the native worker", () => {
  const invalid = [
    { resolution_width: 0 },
    { soil_width_cm: NaN },
    { soil_height_cm: true },
    { lower_hsv: [180, 0, 0] },
    { lower_hsv: [100, 0, 0], upper_hsv: [50, 255, 255] },
    { clusters: 2.5 },
    { reduce_motion: "false" },
    { start_depth_cm: 50 },
    { method: "model" },
    { unknown: 1 },
  ];
  for (const settings of invalid)
    assert.throws(() => validateSettings(settings));
});

test("SQLite persists history and marks interrupted work after restart", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hydrocalc-db-"));
  let repository = new Repository(directory);
  const id = "a".repeat(32);
  repository.put({
    id,
    created_at: new Date().toISOString(),
    name: "中文图片.png",
    status: "running",
  });
  repository.close();
  repository = new Repository(directory);
  assert.equal(repository.get(id).status, "failed");
  assert.equal(repository.get(id).name, "中文图片.png");
  repository.delete(id);
  assert.equal(repository.history().length, 0);
  repository.close();
  fs.rmSync(directory, {
    recursive: true,
    force: true,
  });
});

module.exports = {
  analyze,
};
