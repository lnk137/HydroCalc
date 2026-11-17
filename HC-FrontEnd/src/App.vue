<script setup lang="ts">
import { t } from "./i18n";
import { onMounted, watch } from "vue";
import Icon from "./components/Icon.vue";
import AnalysisView from "./views/AnalysisView.vue";
import HistoryView from "./views/HistoryView.vue";
import SettingsView from "./views/SettingsView.vue";
import { applyTheme, dirty, initialize, scheduleSave, state } from "./state";

// 设置页面的外观立即预览，随后由防抖保存写入配置文件。
watch(
  () => [state.draft?.theme, state.draft?.reduce_motion, state.draft?.language],
  () => {
    if (state.draft) applyTheme(state.draft);
  },
);
function quickTheme() {
  if (!state.draft) return;
  state.draft.theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
}
watch(() => state.draft, scheduleSave, {
  deep: true,
});
onMounted(() => {
  initialize();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (state.draft) applyTheme(state.draft);
  });
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" @click.prevent="state.page = 'analysis'"
        ><span class="brand-symbol"><Icon name="drop" :size="23" /></span
        ><span>HydroCalc</span></a
      >
      <div class="sidebar-caption">{{ t("app.subtitle") }}</div>
      <nav :aria-label="t('nav.main')">
        <button
          :class="{ active: state.page === 'analysis' }"
          @click="state.page = 'analysis'"
        >
          <Icon name="image" />{{ t("nav.analysis") }}
        </button>
        <button
          :class="{ active: state.page === 'history' }"
          @click="state.page = 'history'"
        >
          <Icon name="history" />{{ t("nav.history")
          }}<span class="nav-count" v-if="state.history.length">{{
            state.history.length
          }}</span>
        </button>
        <button
          :class="{ active: state.page === 'settings' }"
          @click="state.page = 'settings'"
        >
          <Icon name="settings" />{{ t("nav.settings")
          }}<span
            v-if="dirty"
            class="unsaved-dot"
            :aria-label="t('common.unsaved')"
          ></span>
        </button>
      </nav>
      <div class="sidebar-footer">
        <button class="theme-toggle" @click="quickTheme">
          <Icon name="moon" :size="18" /><span>{{ t("app.toggleTheme") }}</span
          ><span class="theme-key">◐</span>
        </button>
        <div class="version">
          <span class="status-dot"></span>{{ t("app.local")
          }}<span>v{{ state.info?.version || "2.0.0" }}</span>
        </div>
      </div>
    </aside>
    <main class="main-content">
      <div v-if="state.error" class="error-banner" role="alert">
        <Icon name="info" :size="18" /><span>{{ t(state.error) }}</span
        ><button
          class="icon-button"
          :aria-label="t('app.closeError')"
          @click="state.error = ''"
        >
          <Icon name="close" :size="16" />
        </button>
      </div>
      <template v-if="state.info">
        <AnalysisView v-if="state.page === 'analysis'" />
        <HistoryView v-else-if="state.page === 'history'" />
        <SettingsView v-else />
      </template>
      <div v-else class="initial-loading">
        <span class="spinner"></span><span>{{ t("app.connecting") }}</span
        ><button v-if="state.error" class="button" @click="initialize">
          {{ t("app.retry") }}
        </button>
      </div>
    </main>
    <Transition name="toast"
      ><div v-if="state.notice" class="toast" role="status">
        <Icon name="check" :size="18" />{{ state.notice }}
      </div></Transition
    >
  </div>
</template>
