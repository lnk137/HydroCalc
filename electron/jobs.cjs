const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

class Jobs {
  constructor(repository, worker) {
    this.repository = repository;
    this.worker = worker;
    this.queue = [];
    this.child = null;
    this.closed = false;
  }

  submit(content, name, settings) {
    // 限制队列内存和并行 CPU 使用，每个任务使用自己的输入与配置快照。
    if (this.closed) throw new Error("errors.closing");
    if (this.queue.length + (this.child ? 1 : 0) >= 4)
      throw new Error("errors.queueFull");
    const identifier = crypto.randomUUID().replaceAll("-", "");
    const directory = this.repository.folder(identifier);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "input"), content);
    const record = {
      id: identifier,
      name,
      created_at: new Date().toISOString(),
      status: "queued",
      stage: "queued",
      settings: structuredClone(settings),
      algorithm_version: "2.0",
    };
    this.repository.put(record);
    this.queue.push(record);
    this.next();
    return record;
  }

  next() {
    if (this.closed || this.child || this.queue.length === 0) return;
    const record = this.queue.shift();
    const directory = this.repository.folder(record.id);
    record.status = "running";
    record.stage = "starting";
    this.repository.put(record);
    const child = spawn(this.worker, [], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OPENCV_IO_MAX_IMAGE_PIXELS: "30000000",
      },
    });
    this.child = child;
    let result = null;
    let failure = "";
    const messages = readline.createInterface({
      input: child.stdout,
    });
    messages.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.event === "progress") {
          record.stage = message.stage;
          this.repository.put(record);
        }
        if (message.event === "result") result = message.data;
        if (message.event === "error") failure = message.message;
      } catch {
        failure = "errors.engine";
      }
    });
    child.stderr.on("data", (chunk) => {
      // 只保留有限的错误上下文，避免原生进程异常输出占满内存。
      console.error(chunk.toString().slice(-2000));
    });
    child.on("error", (error) => {
      failure = "errors.engine";
    });
    child.stdin.on("error", () => {});
    const command = {
      input: path.join(directory, "input"),
      output: directory,
      settings: record.settings,
    };
    child.stdin.end(JSON.stringify(command) + "\n");
    const timeout = setTimeout(() => {
      failure = "errors.timeout";
      child.kill("SIGKILL");
    }, 300000);
    child.on("close", (code) => {
      clearTimeout(timeout);
      messages.close();
      // 所有文件就绪且进程正常退出后才发布完成状态。
      if (code === 0 && result) {
        Object.assign(record, result);
        record.status = "completed";
        record.stage = "completed";
        fs.writeFileSync(
          path.join(directory, "result.json"),
          JSON.stringify(record, null, 2),
        );
      } else {
        record.status = "failed";
        record.stage = "failed";
        record.error = failure.startsWith("errors.")
          ? failure
          : "errors.engine";
      }
      this.repository.put(record);
      this.child = null;
      this.next();
    });
  }

  async close() {
    // 退出时停止原生进程，再关闭 SQLite，避免回调向已关闭的数据库写入。
    this.closed = true;
    if (this.child) {
      const child = this.child;
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.kill("SIGKILL");
      await closed;
    }
    for (const record of this.queue) {
      record.status = "failed";
      record.stage = "interrupted";
      record.error = "errors.interrupted";
      this.repository.put(record);
    }
    this.queue = [];
  }
}

module.exports = {
  Jobs,
};
