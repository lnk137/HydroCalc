const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

class Repository {
  constructor(directory) {
    // SQLite 与分析文件分别存放，WAL 保证历史写入的事务完整性。
    this.directory = directory;
    this.analyses = path.join(directory, "analyses");
    fs.mkdirSync(this.analyses, {
      recursive: true,
    });
    this.database = new DatabaseSync(path.join(directory, "history.sqlite"));
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        record TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    this.insert = this.database.prepare(
      "INSERT INTO analyses VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record",
    );
    this.select = this.database.prepare(
      "SELECT record FROM analyses WHERE id = ?",
    );
    this.list = this.database.prepare(
      "SELECT record FROM analyses ORDER BY created_at DESC",
    );
    this.remove = this.database.prepare("DELETE FROM analyses WHERE id = ?");

    // 上次退出时未完成的任务变为明确失败状态，不让界面无限轮询。
    for (const record of this.history(true)) {
      if (["queued", "running"].includes(record.status)) {
        record.status = "failed";
        record.stage = "interrupted";
        record.error = "errors.interrupted";
        this.put(record);
      }
    }
  }

  folder(identifier) {
    if (!/^[a-f0-9]{32}$/.test(identifier)) throw new Error("errors.invalidId");
    return path.join(this.analyses, identifier);
  }

  put(record) {
    const serialized = JSON.stringify(record);
    this.insert.run(record.id, record.created_at, serialized);
  }

  get(identifier) {
    this.folder(identifier);
    const row = this.select.get(identifier);
    if (!row) throw new Error("errors.notFound");
    return JSON.parse(row.record);
  }

  history(complete = false) {
    const rows = this.list.all();
    return rows.map((row) => {
      const record = JSON.parse(row.record);
      if (complete) return record;
      // 列表省略逐行曲线和配置，详情页按需读取完整记录。
      return {
        id: record.id,
        name: record.name,
        created_at: record.created_at,
        status: record.status,
        stage: record.stage,
        metrics: record.metrics,
        error: record.error,
      };
    });
  }

  delete(identifier) {
    const record = this.get(identifier);
    if (["queued", "running"].includes(record.status))
      throw new Error("errors.deleteRunning");
    const folder = this.folder(identifier);
    fs.rmSync(folder, {
      recursive: true,
      force: true,
    });
    this.remove.run(identifier);
  }

  close() {
    this.database.close();
  }
}

module.exports = {
  Repository,
};
