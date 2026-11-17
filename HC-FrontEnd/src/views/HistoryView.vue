<script setup lang="ts">
import { t } from "../i18n";
import { computed, onMounted, ref } from "vue";
import Icon from "../components/Icon.vue";
import {
  date,
  format,
  imageUrl,
  notify,
  refreshHistory,
  report,
  request,
  selectAnalysis,
  state,
} from "../state";

const query = ref("");
const selected = ref<string[]>([]);
const confirming = ref(false);
const removing = ref(false);
const records = computed(() =>
  state.history.filter((record) =>
    record.name.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
const selectable = computed(() =>
  records.value.filter(
    (record) => !["queued", "running"].includes(record.status),
  ),
);
const allSelected = computed(
  () =>
    selectable.value.length > 0 &&
    selectable.value.every((record) => selected.value.includes(record.id)),
);
function toggleAll() {
  selected.value = allSelected.value
    ? []
    : selectable.value.map((record) => record.id);
  confirming.value = false;
}
async function remove() {
  removing.value = true;
  try {
    for (const identifier of selected.value) {
      await request(`/analyses/${identifier}`, {
        method: "DELETE",
      });
      if (state.active?.id === identifier) state.active = null;
    }
    selected.value = [];
    confirming.value = false;
    await refreshHistory();
    notify(t("history.deleted"));
  } catch (error) {
    report(error);
  } finally {
    removing.value = false;
  }
}
onMounted(() => {
  refreshHistory().catch(report);
});
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1>
          {{ t("nav.history")
          }}<span class="heading-count">{{ state.history.length }}</span>
        </h1>
      </div>
      <button class="button primary" @click="state.page = 'analysis'">
        <Icon name="image" :size="17" />{{ t("history.new") }}
      </button>
    </header>
    <div class="history-toolbar">
      <input
        v-model="query"
        type="search"
        :placeholder="t('history.search')"
        :aria-label="t('history.searchLabel')"
      />
      <div class="header-actions" v-if="selected.length">
        <span class="muted small">{{
          t("history.selected", { count: selected.length })
        }}</span
        ><template v-if="confirming"
          ><span class="small">{{ t("history.confirmText") }}</span
          ><button class="button danger" :disabled="removing" @click="remove">
            {{
              removing ? t("history.removing") : t("history.confirm")
            }}</button
          ><button class="button" @click="confirming = false">
            {{ t("common.cancel") }}
          </button></template
        ><button v-else class="button" @click="confirming = true">
          <Icon name="trash" :size="16" />{{ t("history.delete") }}
        </button>
      </div>
    </div>
    <div class="panel history-panel" v-if="records.length">
      <table class="history-table">
        <thead>
          <tr>
            <th class="check-column">
              <input
                type="checkbox"
                :checked="allSelected"
                @change="toggleAll"
                :aria-label="t('history.selectAll')"
              />
            </th>
            <th>{{ t("history.image") }}</th>
            <th>{{ t("metrics.stained_ratio") }}</th>
            <th>{{ t("history.depth") }}</th>
            <th>{{ t("analysis.timestamp") }}</th>
            <th>{{ t("history.status") }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id">
            <td>
              <input
                v-model="selected"
                type="checkbox"
                :value="record.id"
                :disabled="['running', 'queued'].includes(record.status)"
                :aria-label="t('history.select', { name: record.name })"
              />
            </td>
            <td>
              <button class="history-name" @click="selectAnalysis(record.id)">
                <img
                  v-if="record.status === 'completed'"
                  :src="imageUrl(record)"
                  alt=""
                /><span v-else class="history-placeholder"
                  ><Icon name="image" /></span
                ><strong>{{ record.name }}</strong>
              </button>
            </td>
            <td>
              {{ format(record.metrics?.stained_ratio)
              }}<span class="muted"> %</span>
            </td>
            <td>
              {{ format(record.metrics?.maximum_depth_cm)
              }}<span class="muted"> cm</span>
            </td>
            <td class="muted">{{ date(record.created_at) }}</td>
            <td>
              <span class="record-status" :class="record.status">{{
                record.status === "completed"
                  ? t("history.completed")
                  : record.status === "failed"
                    ? t("history.failed")
                    : t("history.running")
              }}</span>
            </td>
            <td>
              <button
                class="icon-button"
                :aria-label="t('history.open', { name: record.name })"
                @click="selectAnalysis(record.id)"
              >
                <Icon name="arrow" :size="17" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="panel library-empty empty-state">
      <span class="empty-symbol"><Icon name="history" :size="30" /></span>
      <h3>{{ query ? t("history.noMatches") : t("history.empty") }}</h3>
      <button v-if="!query" class="button" @click="state.page = 'analysis'">
        {{ t("history.first") }}
      </button>
    </div>
  </div>
</template>
