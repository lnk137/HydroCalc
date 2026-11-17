<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";
import { t } from "../i18n";
import {
  cancelWaiting,
  exportBatch,
  format,
  retryFailed,
  selectAnalysis,
  state,
} from "../state";

const finished = computed(
  () =>
    state.batch.filter((item) =>
      ["completed", "failed", "cancelled"].includes(item.status),
    ).length,
);
const failed = computed(
  () => state.batch.filter((item) => item.status === "failed").length,
);
const completed = computed(
  () => state.batch.filter((item) => item.status === "completed").length,
);
</script>

<template>
  <details
    class="panel batch-panel"
    :open="state.batchExpanded"
    @toggle="state.batchExpanded = ($event.target as HTMLDetailsElement).open"
    v-if="state.batch.length > 1"
  >
    <summary>
      <div>
        <Icon name="grid" :size="17" /><strong>{{ t("batch.title") }}</strong
        ><span class="muted">{{ finished }} / {{ state.batch.length }}</span>
      </div>
      <div class="batch-actions" @click.stop>
        <button
          class="text-button"
          v-if="state.submitting"
          @click="cancelWaiting"
        >
          {{ t("batch.cancel") }}</button
        ><button
          v-if="failed && !state.submitting"
          class="text-button"
          @click="retryFailed"
        >
          {{ t("batch.retry") }}</button
        ><button
          v-if="completed && !state.submitting"
          class="text-button"
          :disabled="state.exporting"
          @click="exportBatch"
        >
          <Icon name="download" :size="15" />{{ t("batch.export") }}
        </button>
      </div>
    </summary>
    <progress
      :value="finished"
      :max="state.batch.length"
      :aria-label="t('batch.progress')"
    ></progress>
    <div class="batch-list">
      <button
        v-for="item in state.batch"
        :key="item.key"
        :class="{ current: item.id === state.active?.id }"
        :disabled="!item.id"
        @click="item.id && selectAnalysis(item.id)"
      >
        <span
          v-if="['uploading', 'queued', 'running'].includes(item.status)"
          class="spinner small-spinner"
        ></span
        ><Icon
          v-else
          :name="
            item.status === 'completed'
              ? 'check'
              : item.status === 'failed'
                ? 'info'
                : 'image'
          "
          :size="15"
        /><span class="batch-filename">{{
          item.file.webkitRelativePath || item.file.name
        }}</span
        ><span class="batch-metric" v-if="item.status === 'completed'"
          >{{ format(item.metrics?.stained_ratio) }}%</span
        ><span class="batch-status" :class="item.status">{{
          item.error ? t(item.error) : t("batch." + item.status)
        }}</span>
      </button>
    </div>
  </details>
</template>
