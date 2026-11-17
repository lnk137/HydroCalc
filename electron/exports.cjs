const fs = require("node:fs/promises");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { zip } = require("fflate");
const { loadSettings } = require("./settings.cjs");
const syncFs = require("node:fs");
const archiver = require("archiver");

async function exportBatch(repository, identifiers, target) {
  // 批量包使用流式归档，不把整个图片批次读入主进程内存。
  if (
    !Array.isArray(identifiers) ||
    !identifiers.length ||
    identifiers.length > 10000
  )
    throw new Error("errors.export");
  const records = identifiers.map((identifier) => repository.get(identifier));
  if (
    records.some((record) => !["completed", "failed"].includes(record.status))
  )
    throw new Error("errors.notCompleted");
  const temporary = target + ".hydrocalc-tmp";
  const output = syncFs.createWriteStream(temporary);
  const archive = archiver("zip", {
    zlib: {
      level: 6,
    },
  });
  const complete = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", reject);
  });
  archive.pipe(output);
  const columns = [
    "stained_area_cm2",
    "stained_ratio",
    "priority_percentage",
    "priority_area_ratio",
    "matrix_depth_cm",
    "maximum_depth_cm",
    "length_index",
  ];
  const rows = ["filename,status,error," + columns.join(",")];
  const configuration = loadSettings(repository.directory);
  const imageNames = [
    "mask.png",
    "annotated.png",
    "clusters.png",
    "clusters_blurred.png",
    "profile.csv",
    "matrix.csv",
  ];
  if (configuration.export_include_original) imageNames.push("original.png");
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    // 文件名做跨平台清理并加序号，同名图片也不会覆盖；CSV 文件名防止公式注入。
    const name = record.name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/[. ]+$/, "")
      .slice(0, 100);
    const folder = `${String(index + 1).padStart(4, "0")}-${name || "image"}`;
    let cell = record.name;
    if (/^[=+@-]/.test(cell)) cell = "'" + cell;
    cell = '"' + cell.replaceAll('"', '""') + '"';
    rows.push(
      [
        cell,
        record.status,
        record.error || "",
        ...columns.map((column) => record.metrics?.[column] ?? ""),
      ].join(","),
    );
    archive.append(JSON.stringify(record, null, 2), {
      name: folder + "/result.json",
    });
    const directory = repository.folder(record.id);
    for (const filename of imageNames) {
      const fullPath = path.join(directory, filename);
      if (syncFs.existsSync(fullPath))
        archive.file(fullPath, {
          name: folder + "/" + filename,
        });
    }
  }
  archive.append("\ufeff" + rows.join("\n"), {
    name: "summary.csv",
  });
  try {
    await archive.finalize();
    await complete;
    await fs.rename(temporary, target);
  } catch (error) {
    archive.abort();
    output.destroy();
    await fs.rm(temporary, {
      force: true,
    });
    throw error;
  }
}

const matrixJobs = new Map();

async function matrixFile(directory) {
  const output = path.join(directory, "matrix.xlsx");
  try {
    await fs.access(output);
    return output;
  } catch {}
  // 同一任务只启动一次 Excel 转换，避免重复导出时并发覆盖目标文件。
  if (!matrixJobs.has(directory)) {
    const pending = new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "export-worker.cjs"), {
        workerData: {
          input: path.join(directory, "matrix.csv"),
          output,
        },
      });
      worker.on("message", (message) => {
        if (message.error) reject(new Error(message.error));
        else resolve(output);
      });
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) reject(new Error("errors.export"));
      });
    });
    matrixJobs.set(directory, pending);
  }
  try {
    return await matrixJobs.get(directory);
  } finally {
    matrixJobs.delete(directory);
  }
}

async function exportFile(repository, identifier, kind) {
  const record = repository.get(identifier);
  if (record.status !== "completed") throw new Error("errors.notCompleted");
  const directory = repository.folder(identifier);
  const images = [
    "original",
    "mask",
    "annotated",
    "clusters",
    "clusters_blurred",
  ];
  if (images.includes(kind)) {
    const content = await fs.readFile(path.join(directory, kind + ".png"));
    return {
      content,
      filename: `hydrocalc-${kind}.png`,
      type: "image/png",
    };
  }
  if (kind === "matrix") {
    const filename = await matrixFile(directory);
    return {
      content: await fs.readFile(filename),
      filename: "hydrocalc-matrix.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  if (kind === "profile") {
    return {
      content: await fs.readFile(path.join(directory, "profile.csv")),
      filename: "hydrocalc-profile.csv",
      type: "text/csv",
    };
  }
  if (kind === "metrics") {
    const rows = Object.entries(record.metrics).map(
      ([key, value]) => `${key},${value}`,
    );
    return {
      content: Buffer.from("\ufeffindicator,value\n" + rows.join("\n")),
      filename: "hydrocalc-metrics.csv",
      type: "text/csv",
    };
  }
  if (kind !== "bundle") throw new Error("errors.export");

  // 完整结果包包含可复核的参数快照、物理指标、曲线、像素矩阵和处理图。
  const files = {
    "result.json": Buffer.from(JSON.stringify(record, null, 2)),
    "profile.csv": await fs.readFile(path.join(directory, "profile.csv")),
    "matrix.csv": await fs.readFile(path.join(directory, "matrix.csv")),
  };
  const exportSettings = loadSettings(repository.directory);
  for (const kind of images) {
    if (kind === "original" && !exportSettings.export_include_original)
      continue;
    const filename = kind + ".png";
    try {
      files[filename] = await fs.readFile(path.join(directory, filename));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const content = await new Promise((resolve, reject) => {
    zip(
      files,
      {
        level: 6,
      },
      (error, output) => {
        if (error) reject(error);
        else resolve(Buffer.from(output));
      },
    );
  });
  return {
    content,
    filename: "hydrocalc-analysis.zip",
    type: "application/zip",
  };
}

module.exports = {
  exportFile,
  exportBatch,
};
