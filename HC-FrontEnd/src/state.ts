import { computed, reactive } from "vue";
import type { Analysis, BatchItem, Bootstrap, Settings } from "./types";
import { i18n, setLanguage, t } from "./i18n";

export const state = reactive({
  page: "analysis" as "analysis" | "history" | "settings",
  info: null as Bootstrap | null,
  settings: null as Settings | null,
  draft: null as Settings | null,
  history: [] as Analysis[],
  active: null as Analysis | null,
  notice: "",
  error: "",
  submitting: false,
  saving: false,
  settingsError: "",
  exporting: false,
  filename: "",
  batch: [] as BatchItem[],
  batchExpanded: true,
  batchSettings: null as Settings | null,
});

let noticeTimer: ReturnType<typeof setTimeout>;
let pollGeneration = 0;
export const dirty = computed(
  () => JSON.stringify(state.settings) !== JSON.stringify(state.draft),
);
export const busy = computed(
  () =>
    state.submitting ||
    ["queued", "running"].includes(state.active?.status || ""),
);

export function notify(message: string) {
  // 新通知替换旧计时，避免旧通知提前隐藏当前反馈。
  clearTimeout(noticeTimer);
  state.notice = message;
  noticeTimer = setTimeout(() => {
    state.notice = "";
  }, 3500);
}

export function report(error: unknown) {
  state.error = error instanceof Error ? error.message : "errors.generic";
}

export async function request<T>(
  route: string,
  options: RequestInit = {},
): Promise<T> {
  // 所有请求都同源，并统一解析本地业务层返回的错误。
  const headers = new Headers(options.headers);
  headers.set("X-HydroCalc", "1");
  const response = await fetch(`/api${route}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || "errors.generic");
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function applyTheme(settings: Settings) {
  setLanguage(settings.language);
  // 预览主题同时更新网页和 Electron 的原生主题。
  const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const dark =
    settings.theme === "dark" || (settings.theme === "system" && systemDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.reducedMotion = String(
    settings.reduce_motion,
  );
  window.hydrocalc?.setTheme(settings.theme).catch(report);
}

export async function initialize() {
  try {
    const [info, history] = await Promise.all([
      request<Bootstrap>("/bootstrap"),
      request<Analysis[]>("/analyses"),
    ]);
    state.info = info;
    state.settings = info.settings;
    state.draft = JSON.parse(JSON.stringify(info.settings));
    state.history = history;
    if (info.configuration_error) state.error = info.configuration_error;
    applyTheme(info.settings);
  } catch (error) {
    report(error);
  }
}

export async function refreshHistory() {
  state.history = await request<Analysis[]>("/analyses");
}

let saveTimer: ReturnType<typeof setTimeout>;
let savingPromise: Promise<boolean> | null = null;

export function scheduleSave() {
  clearTimeout(saveTimer);
  state.settingsError = "";
  if (!dirty.value || !state.draft) return;
  saveTimer = setTimeout(() => {
    saveSettings();
  }, 450);
}

export async function saveSettings(): Promise<boolean> {
  clearTimeout(saveTimer);
  if (savingPromise) {
    await savingPromise;
    if (dirty.value && !state.settingsError) return saveSettings();
    return !state.settingsError;
  }
  if (!state.draft || !dirty.value) return !state.settingsError;
  const snapshot = JSON.stringify(state.draft);
  state.saving = true;
  state.settingsError = "";
  savingPromise = (async () => {
    try {
      const settings = await request<Settings>("/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: snapshot,
      });
      state.settings = settings;
      localStorage.setItem("hydrocalc-theme", settings.theme);
      return true;
    } catch (error) {
      state.settingsError =
        error instanceof Error ? error.message : "errors.generic";
      return false;
    } finally {
      state.saving = false;
    }
  })();
  const saved = await savingPromise;
  savingPromise = null;
  if (saved && dirty.value) return saveSettings();
  return saved;
}

export async function selectAnalysis(identifier: string) {
  // 代次标识防止旧轮询的慢响应覆盖刚选中的历史任务。
  const generation = ++pollGeneration;
  state.page = "analysis";
  try {
    while (generation === pollGeneration) {
      const record = await request<Analysis>(`/analyses/${identifier}`);
      if (generation !== pollGeneration) return;
      state.active = record;
      if (["completed", "failed"].includes(record.status)) {
        await refreshHistory();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  } catch (error) {
    report(error);
  }
}

let nextBatchKey = 0;

export function analyze(file: File) {
  return analyzeFiles([file]);
}

export async function analyzeFiles(files: File[], override?: Settings) {
  if (state.submitting || !files.length) return;
  const supported = files.filter((file) => /\.(png|jpe?g)$/i.test(file.name));
  if (!supported.length) {
    state.error = "errors.imageType";
    return;
  }
  const valid = override ? true : await saveSettings();
  if (!valid || !state.settings) {
    state.error = state.settingsError;
    return;
  }
  // 整个批次固定使用导入时的参数，后续修改设置不会改变尚在等待的图片。
  const snapshot = JSON.parse(
    JSON.stringify(override || state.settings),
  ) as Settings;
  state.batchSettings = snapshot;
  state.batchExpanded = true;
  state.batch = supported.map((file) => ({
    key: ++nextBatchKey,
    file,
    status: "waiting" as const,
  }));
  state.active = null;
  state.submitting = true;
  state.error = "";
  let cursor = 0;
  async function consume() {
    while (cursor < state.batch.length) {
      const item = state.batch[cursor++];
      if (item.status === "cancelled") continue;
      item.status = "uploading";
      try {
        if (item.file.size > 20 * 1024 * 1024)
          throw new Error("errors.imageSize");
        const body = new FormData();
        body.append(
          "file",
          item.file,
          item.file.webkitRelativePath || item.file.name,
        );
        body.append("settings", JSON.stringify(snapshot));
        const record = await request<Analysis>("/analyses", {
          method: "POST",
          body,
        });
        item.id = record.id;
        if (!state.active) state.active = record;
        while (true) {
          const current = await request<Analysis>("/analyses/" + record.id);
          item.status = current.status;
          item.stage = current.stage;
          item.error = current.error;
          item.metrics = current.metrics;
          if (state.active?.id === current.id) state.active = current;
          if (current.status === "completed" || current.status === "failed")
            break;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      } catch (error) {
        item.status = "failed";
        item.error = error instanceof Error ? error.message : "errors.generic";
      }
    }
  }
  try {
    // 两条上传流水线配合单个 C++ 工作进程，图片逐张读取，不积累整批二进制数据。
    await Promise.all([consume(), consume()]);
    await refreshHistory();
    const failed = state.batch.filter(
      (item) => item.status === "failed",
    ).length;
    const completed = state.batch.filter(
      (item) => item.status === "completed",
    ).length;
    if (state.batch.length > 1)
      notify(t("batch.finished", { completed, failed }));
  } finally {
    state.submitting = false;
  }
}

export function cancelWaiting() {
  for (const item of state.batch) {
    if (item.status === "waiting") item.status = "cancelled";
  }
}

export function retryFailed() {
  const files = state.batch
    .filter((item) => item.status === "failed")
    .map((item) => item.file);
  return analyzeFiles(files, state.batchSettings || undefined);
}

export async function exportBatch() {
  const identifiers = state.batch
    .filter((item) => ["completed", "failed"].includes(item.status) && item.id)
    .map((item) => item.id!);
  if (!identifiers.length) return;
  state.exporting = true;
  try {
    if (window.hydrocalc) {
      const result = await window.hydrocalc.exportBatch(identifiers);
      if (result.saved) notify(t("export.saved"));
    } else {
      const response = await fetch("/api/batches/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-HydroCalc": "1",
        },
        body: JSON.stringify({
          ids: identifiers,
        }),
      });
      if (!response.ok) throw new Error("errors.export");
      const content = await response.blob();
      const url = URL.createObjectURL(content);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "hydrocalc-batch.zip";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (error) {
    report(error);
  } finally {
    state.exporting = false;
  }
}

export async function exportArtifact(kind: string) {
  if (state.active?.status !== "completed" || state.exporting) return;
  state.exporting = true;
  try {
    if (window.hydrocalc) {
      const result = await window.hydrocalc.exportArtifact(
        state.active.id,
        kind,
      );
      if (result.saved) notify(t("export.saved"));
    } else {
      const anchor = document.createElement("a");
      anchor.href = `/api/analyses/${state.active.id}/export/${kind}`;
      anchor.download = "";
      anchor.click();
    }
  } catch (error) {
    report(error);
  } finally {
    state.exporting = false;
  }
}

export function imageUrl(record: Analysis, kind = "original") {
  return `/api/analyses/${record.id}/images/${kind}`;
}

export function format(value: number | undefined, digits = 2) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat(i18n.global.locale.value, {
    maximumFractionDigits: digits,
  }).format(value);
}

export function date(value: string) {
  return new Intl.DateTimeFormat(i18n.global.locale.value, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
