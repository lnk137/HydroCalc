<script setup lang="ts">
import { t } from "../i18n";
import { computed, ref, watch } from "vue";
import Icon from "../components/Icon.vue";
import DepthChart from "../components/DepthChart.vue";
import BatchQueue from "../components/BatchQueue.vue";
import {
  analyze,
  analyzeFiles,
  busy,
  date,
  exportArtifact,
  format,
  imageUrl,
  report,
  state,
} from "../state";

const input = ref<HTMLInputElement>();
const folderInput = ref<HTMLInputElement>();
const modal = ref<HTMLDialogElement>();
const view = ref("annotated");
const exportKind = ref("bundle");
const dragging = ref(false);
const blurred = ref(false);
const record = computed(() => state.active);
const completed = computed(() => record.value?.status === "completed");
const imageKind = computed(() =>
  view.value === "clusters" && blurred.value ? "clusters_blurred" : view.value,
);
const colors = computed(() => record.value?.colors?.[imageKind.value] || []);
const metrics = computed(() => [
  { key: "stained_area_cm2", name: t("metrics.stained_area_cm2"), unit: "cm²" },
  {
    key: "priority_percentage",
    name: t("metrics.priority_percentage"),
    unit: "%",
  },
  {
    key: "priority_area_ratio",
    name: t("metrics.priority_area_ratio"),
    unit: "%",
  },
  { key: "matrix_depth_cm", name: t("metrics.matrix_depth_cm"), unit: "cm" },
  { key: "maximum_depth_cm", name: t("metrics.maximum_depth_cm"), unit: "cm" },
  { key: "length_index", name: t("metrics.length_index"), unit: "" },
]);
watch(
  () => record.value?.id,
  () => {
    view.value = "annotated";
    blurred.value = false;
  },
);

function choose(event: Event) {
  const element = event.target as HTMLInputElement;
  const files = Array.from(element.files || []);
  if (files.length) analyzeFiles(files);
  element.value = "";
}
async function readEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) =>
      (entry as FileSystemFileEntry).file(
        (file) => {
          // 拖入文件夹时保留相对路径，与文件夹选择入口的命名规则一致。
          Object.defineProperty(file, "webkitRelativePath", {
            value: entry.fullPath.replace(/^\//, ""),
          });
          resolve([file]);
        },
        () => resolve([]),
      ),
    );
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const files: File[] = [];
  while (true) {
    const children = await new Promise<FileSystemEntry[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([])),
    );
    if (!children.length) break;
    for (const child of children) files.push(...(await readEntry(child)));
  }
  return files;
}
async function drop(event: DragEvent) {
  dragging.value = false;
  if (!event.dataTransfer) return;
  const entries = Array.from(event.dataTransfer.items)
    .map((item) => item.webkitGetAsEntry())
    .filter(Boolean) as FileSystemEntry[];
  const groups = await Promise.all(entries.map(readEntry));
  const files = groups.length
    ? groups.flat()
    : Array.from(event.dataTransfer.files);
  analyzeFiles(files);
}
async function reanalyze() {
  if (!record.value || busy.value) return;
  try {
    const response = await fetch(imageUrl(record.value));
    if (!response.ok) throw new Error("errors.originalMissing");
    const content = await response.blob();
    const file = new File([content], record.value.name, {
      type: "image/png",
    });
    await analyze(file);
  } catch (error) {
    report(error);
  }
}
function download() {
  exportArtifact(
    exportKind.value === "image" ? imageKind.value : exportKind.value,
  );
}
</script>

<template>
  <div class="page analysis-page">
    <header class="page-header">
      <div>
        <h1>{{ t("nav.analysis") }}</h1>
      </div>
      <div class="header-actions">
        <template v-if="completed"
          ><select
            v-model="exportKind"
            :aria-label="t('export.format')"
            class="export-select"
          >
            <option value="bundle">{{ t("export.bundle") }}</option>
            <option value="image">{{ t("export.image") }}</option>
            <option value="matrix">{{ t("export.matrix") }}</option>
            <option value="profile">{{ t("export.profile") }}</option>
            <option value="metrics">{{ t("export.metrics") }}</option></select
          ><button class="button" :disabled="state.exporting" @click="download">
            <span v-if="state.exporting" class="spinner small-spinner"></span
            ><Icon v-else name="download" :size="17" />{{
              state.exporting ? t("export.busy") : t("export.button")
            }}
          </button></template
        >
        <button class="button primary" :disabled="busy" @click="input?.click()">
          <Icon name="upload" :size="17" />{{ t("analysis.import") }}
        </button>
        <button
          class="button folder-import"
          :disabled="busy"
          :aria-label="t('batch.folder')"
          :title="t('batch.folder')"
          @click="folderInput?.click()"
        >
          <Icon name="folder" :size="17" /></button
        ><input
          ref="folderInput"
          class="visually-hidden"
          type="file"
          multiple
          webkitdirectory
          @change="choose"
          :aria-label="t('batch.folder')"
        /><input
          ref="input"
          class="visually-hidden"
          type="file"
          accept="image/png,image/jpeg"
          multiple
          @change="choose"
          :aria-label="t('analysis.importLabel')"
        />
      </div>
    </header>
    <div class="analysis-context">
      <div>
        <span class="status-dot"></span
        >{{
          completed
            ? t("analysis.completed")
            : busy
              ? t("analysis.running")
              : t("analysis.ready")
        }}<span class="context-divider"></span
        ><span class="context-filename">{{
          record?.name || t("analysis.noFile")
        }}</span>
      </div>
      <button class="text-button" @click="state.page = 'settings'">
        <Icon name="settings" :size="15" />{{ t("analysis.parameters") }}
      </button>
    </div>
    <BatchQueue />
    <div class="analysis-layout">
      <section
        class="panel image-panel"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="drop"
      >
        <div class="image-toolbar">
          <div class="segmented image-tabs">
            <button
              v-for="item in [
                { id: 'original', label: t('image.original') },
                { id: 'mask', label: t('image.mask') },
                { id: 'annotated', label: t('image.annotated') },
                { id: 'clusters', label: 'K-means' },
              ]"
              :key="item.id"
              :class="{ selected: view === item.id }"
              :disabled="
                !completed ||
                (item.id === 'clusters' && !record?.settings?.enable_clustering)
              "
              @click="view = item.id"
            >
              {{ item.label }}
            </button>
          </div>
          <button
            class="icon-button"
            :aria-label="t('image.zoom')"
            :disabled="!completed"
            @click="modal?.showModal()"
          >
            <Icon name="zoom" :size="18" />
          </button>
        </div>
        <div class="image-canvas" :class="{ dragging, empty: !completed }">
          <img
            v-if="completed && record"
            :src="imageUrl(record, imageKind)"
            :alt="record.name"
            @click="modal?.showModal()"
          />
          <div v-else-if="busy" class="processing-state">
            <span class="spinner large-spinner"></span>
            <h3>{{ t("stages." + (record?.stage || "uploading")) }}</h3>
            <p>{{ state.filename || record?.name }}</p>
            <div class="activity-line"></div>
          </div>
          <div v-else-if="record?.status === 'failed'" class="empty-state">
            <span class="empty-symbol"><Icon name="info" :size="28" /></span>
            <h3>{{ t("analysis.failedTitle") }}</h3>
            <p>{{ t(record.error || "errors.generic") }}</p>
            <button class="button" @click="input?.click()">
              {{ t("analysis.chooseAgain") }}
            </button>
          </div>
          <button
            v-else
            class="dropzone"
            :disabled="busy"
            @click="input?.click()"
          >
            <span class="empty-symbol"><Icon name="upload" :size="28" /></span>
            <h3>{{ t("analysis.dropTitle") }}</h3>
            <p>{{ t("analysis.dropAction") }}</p>
            <span class="file-hint">{{ t("analysis.fileHint") }}</span>
          </button>
        </div>
        <div class="image-footer">
          <template v-if="completed"
            ><span
              >{{ record?.settings?.resolution_width }} ×
              {{ record?.settings?.resolution_height }} px</span
            ><label v-if="view === 'clusters'" class="inline-toggle"
              ><input v-model="blurred" type="checkbox" />{{
                t("settings.blur")
              }}</label
            ><span v-else-if="view === 'annotated'" class="line-legend"
              ><i class="line-red"></i>{{ t("image.matrixLine")
              }}<i class="line-blue"></i>{{ t("settings.startDepth")
              }}<i class="line-green"></i>{{ t("history.depth") }}</span
            ><span v-else-if="view === 'mask'">{{ t("image.blackStain") }}</span
            ><span v-else>{{ t("image.originalFull") }}</span></template
          >
          <template v-else
            ><span>{{ t("analysis.local") }}</span
            ><span>{{ t("analysis.localFiles") }}</span></template
          >
        </div>
      </section>
      <section class="panel results-panel">
        <div class="panel-heading">
          <h2>{{ t("analysis.indicators") }}</h2>
          <span class="badge">{{
            (record?.effective_method ||
              record?.settings?.method ||
              state.settings?.method) === "binary"
              ? t("method.binaryShort")
              : (record?.effective_method ||
                    record?.settings?.method ||
                    state.settings?.method) === "auto"
                ? t("method.auto")
                : t("method.hsvShort")
          }}</span>
        </div>
        <div class="main-metric">
          <span class="metric-label">{{ t("metrics.stained_ratio") }}</span>
          <div class="main-metric-value">
            {{ format(completed ? record?.metrics?.stained_ratio : undefined)
            }}<span>%</span>
          </div>
          <div class="metric-track">
            <div
              :style="`width:${completed ? record?.metrics?.stained_ratio || 0 : 0}%`"
            ></div>
          </div>
        </div>
        <div class="metrics-grid">
          <div v-for="metric in metrics" :key="metric.key" class="metric-cell">
            <span class="metric-label">{{ metric.name }}</span>
            <div>
              {{ format(completed ? record?.metrics?.[metric.key] : undefined)
              }}<span>{{ metric.unit }}</span>
            </div>
          </div>
        </div>
        <div class="results-footer">
          <span
            >{{ t("analysis.profile") }}
            {{
              record?.settings?.soil_width_cm || state.settings?.soil_width_cm
            }}
            ×
            {{
              record?.settings?.soil_height_cm || state.settings?.soil_height_cm
            }}
            cm</span
          ><button
            v-if="completed"
            class="text-button"
            :disabled="busy"
            @click="reanalyze"
          >
            <Icon name="reset" :size="14" />{{ t("analysis.reanalyze") }}
          </button>
        </div>
      </section>
      <DepthChart v-if="completed && record" :record="record" />
      <section v-else class="panel chart-panel empty-chart">
        <div class="panel-heading">
          <h2>{{ t("chart.title") }}</h2>
        </div>
        <div class="empty-plot">
          <Icon name="chart" :size="32" />
          <p>{{ t("analysis.noChart") }}</p>
        </div>
      </section>
      <section class="panel details-panel">
        <div class="panel-heading">
          <h2>
            {{
              view === "clusters" && completed
                ? t("analysis.colorDistribution")
                : t("analysis.details")
            }}
          </h2>
          <Icon :name="view === 'clusters' ? 'grid' : 'info'" :size="17" />
        </div>
        <div v-if="view === 'clusters' && completed" class="color-distribution">
          <div v-for="color in colors" :key="color.color" class="color-row">
            <span
              class="color-swatch"
              :style="`background:${color.color}`"
            ></span>
            <div>
              <span>{{ color.color.toUpperCase() }}</span
              ><small>{{ format(color.area_cm2) }} cm²</small>
            </div>
            <strong>{{ format(color.ratio) }}<small>%</small></strong>
          </div>
        </div>
        <dl v-else class="analysis-details">
          <div>
            <dt>{{ t("settings.method") }}</dt>
            <dd>
              {{
                t(
                  "method." +
                    (record?.effective_method ||
                      (record?.settings || state.settings)?.method ||
                      "auto"),
                )
              }}
            </dd>
          </div>
          <div>
            <dt>{{ t("settings.blur") }}</dt>
            <dd>
              {{
                (record?.settings || state.settings)?.blur_kernel
                  ? `${(record?.settings || state.settings)?.blur_kernel} × ${(record?.settings || state.settings)?.blur_kernel}`
                  : t("common.off")
              }}
            </dd>
          </div>
          <div>
            <dt>{{ t("settings.clustering") }}</dt>
            <dd>
              {{
                (record?.settings || state.settings)?.enable_clustering
                  ? t("settings.classes", {
                      count: (record?.settings || state.settings)?.clusters,
                    })
                  : t("common.off")
              }}
            </dd>
          </div>
          <div>
            <dt>{{ t("analysis.timestamp") }}</dt>
            <dd>{{ record ? date(record.created_at) : "—" }}</dd>
          </div>
        </dl>
        <div class="details-note">
          <Icon name="info" :size="15" /><span>{{
            view === "clusters"
              ? t("analysis.colorNote")
              : t("analysis.calibrationNote")
          }}</span>
        </div>
      </section>
    </div>
    <dialog ref="modal" class="image-modal" @click="modal?.close()">
      <button
        class="icon-button modal-close"
        :aria-label="t('image.closeZoom')"
        @click="modal?.close()"
      >
        <Icon name="close" /></button
      ><img
        v-if="completed && record"
        :src="imageUrl(record, imageKind)"
        :alt="record.name"
      />
    </dialog>
  </div>
</template>
