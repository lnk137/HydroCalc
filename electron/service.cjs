const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const Busboy = require("busboy");
const { Repository } = require("./repository.cjs");
const { Jobs } = require("./jobs.cjs");
const {
  defaults,
  validateSettings,
  loadSettings,
  saveSettings,
} = require("./settings.cjs");
const { exportFile } = require("./exports.cjs");
const { exportBatch } = require("./exports.cjs");
const { randomUUID } = require("node:crypto");

async function readJson(request, maximum = 16000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw new Error("errors.invalidSettings");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

function readUpload(request) {
  return new Promise((resolve, reject) => {
    // 在解析层限制文件数、字段数和大小，拒绝截断后继续计算的图片。
    const parser = Busboy({
      headers: request.headers,
      defParamCharset: "utf8",
      preservePath: true,
      limits: {
        files: 1,
        fields: 1,
        fileSize: 20 * 1024 * 1024,
        fieldSize: 16000,
      },
    });
    const chunks = [];
    let filename = "";
    let settings;
    let truncated = false;
    parser.on("file", (name, file, info) => {
      if (name !== "file") {
        truncated = true;
        file.resume();
        return;
      }
      filename = info.filename;
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("limit", () => {
        truncated = true;
      });
      file.on("error", reject);
    });
    parser.on("field", (name, value, info) => {
      if (name === "settings") settings = value;
      if (info.valueTruncated) truncated = true;
    });
    parser.on("filesLimit", () => {
      truncated = true;
    });
    parser.on("fieldsLimit", () => {
      truncated = true;
    });
    parser.on("error", reject);
    request.on("aborted", () => reject(new Error("errors.upload")));
    parser.on("close", () => {
      try {
        if (truncated) return reject(new Error("errors.upload"));
        const content = Buffer.concat(chunks);
        if (!content.length) return reject(new Error("errors.upload"));
        resolve({
          content,
          name: (filename || "image")
            .replaceAll("\\", "/")
            .split("/")
            .filter((segment) => segment && segment !== "." && segment !== "..")
            .join("/")
            .slice(0, 300),
          settings: settings ? validateSettings(JSON.parse(settings)) : null,
        });
      } catch (error) {
        reject(error);
      }
    });
    request.pipe(parser);
  });
}

async function createService(options) {
  const repository = new Repository(options.dataDir);
  const jobs = new Jobs(repository, options.worker);
  let configurationError = "";
  let settings;
  try {
    settings = loadSettings(options.dataDir);
  } catch {
    // 损坏设置保留原文件，用户可在界面恢复默认值后重新保存。
    settings = structuredClone(defaults);
    configurationError = "errors.settingsCorrupt";
  }
  const json = (response, value, status = 200) => {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer(async (request, response) => {
    try {
      // 服务仅绑定回环地址，所有修改请求要求自定义头且不开放 CORS。
      const hostname = (request.headers.host || "").split(":")[0];
      if (!["127.0.0.1", "localhost"].includes(hostname))
        throw new Error("errors.localOnly");
      const url = new URL(request.url, "http://127.0.0.1");
      const pathname = url.pathname;
      const writing = ["POST", "PUT", "DELETE"].includes(request.method);
      if (writing && request.headers["x-hydrocalc"] !== "1")
        throw new Error("errors.localOnly");
      if (pathname === "/api/bootstrap" && request.method === "GET") {
        return json(response, {
          version: "2.0.0",
          platform: process.platform,
          data_dir: options.dataDir,
          settings,
          defaults,
          configuration_error: configurationError,
        });
      }
      if (pathname === "/api/settings" && request.method === "PUT") {
        const input = await readJson(request);
        const updated = validateSettings(input);
        saveSettings(options.dataDir, updated);
        settings = updated;
        configurationError = "";
        return json(response, updated);
      }
      if (pathname === "/api/analyses" && request.method === "GET")
        return json(response, repository.history());
      if (pathname === "/api/analyses" && request.method === "POST") {
        const upload = await readUpload(request);
        const record = jobs.submit(
          upload.content,
          upload.name,
          upload.settings || settings,
        );
        return json(response, record, 202);
      }
      if (pathname === "/api/batches/export" && request.method === "POST") {
        // 浏览器验收模式也复用流式归档；临时 ZIP 在响应结束后清理。
        const body = await readJson(request, 512000);
        const target = path.join(
          options.dataDir,
          "batch-" + randomUUID() + ".zip",
        );
        try {
          await exportBatch(repository, body.ids, target);
          response.writeHead(200, {
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="hydrocalc-batch.zip"',
          });
          const stream = fs.createReadStream(target);
          stream.on("error", () => response.destroy());
          response.on("close", () => {
            stream.destroy();
            fsp.rm(target, { force: true }).catch(console.error);
          });
          return stream.pipe(response);
        } catch (error) {
          await fsp.rm(target, { force: true });
          throw error;
        }
      }
      const match = pathname.match(
        /^\/api\/analyses\/([a-f0-9]{32})(?:\/(images|export)\/([a-z_]+))?$/,
      );
      if (match) {
        const [, id, section, kind] = match;
        if (!section && request.method === "DELETE") {
          repository.delete(id);
          response.writeHead(204);
          return response.end();
        }
        if (request.method !== "GET") throw new Error("errors.generic");
        if (!section) return json(response, repository.get(id));
        const file = await exportFile(repository, id, kind);
        if (
          section === "images" &&
          ![
            "original",
            "mask",
            "annotated",
            "clusters",
            "clusters_blurred",
          ].includes(kind)
        )
          throw new Error("errors.export");
        const headers = {
          "Content-Type": file.type,
          "Cache-Control": "no-store",
        };
        if (section === "export")
          headers["Content-Disposition"] =
            `attachment; filename="${file.filename}"`;
        response.writeHead(200, headers);
        return response.end(file.content);
      }
      if (pathname.startsWith("/api/"))
        return json(
          response,
          {
            error: "errors.notFound",
          },
          404,
        );

      // 前端静态文件只从构建目录读取，路径标准化后必须仍在该目录内。
      const relative =
        pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
      const filename = path.resolve(options.webDir, relative);
      if (!filename.startsWith(path.resolve(options.webDir) + path.sep))
        throw new Error("errors.fileMissing");
      const content = await fsp.readFile(filename);
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      };
      response.writeHead(200, {
        "Content-Type":
          types[path.extname(filename)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
      });
      response.end(content);
    } catch (error) {
      if (!response.headersSent)
        json(
          response,
          {
            error:
              error.code === "ENOENT"
                ? "errors.fileMissing"
                : error.message.startsWith("errors.")
                  ? error.message
                  : "errors.generic",
          },
          error.message === "errors.notFound" || error.code === "ENOENT"
            ? 404
            : 400,
        );
      else response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    repository,
    jobs,
    async close() {
      // 先停止接收请求，再终止计算队列，最后关闭数据库。
      await new Promise((resolve) => server.close(resolve));
      await jobs.close();
      repository.close();
    },
  };
}

module.exports = {
  createService,
};
