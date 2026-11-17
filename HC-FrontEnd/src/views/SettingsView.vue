<script setup lang="ts">
import { t } from "../i18n";
import { computed, ref } from "vue";
import Icon from "../components/Icon.vue";
import HsvRange from "../components/HsvRange.vue";
import { dirty, notify, report, state } from "../state";

const section = ref("appearance");
const isDesktop = Boolean(window.hydrocalc);
const draft = computed(() => state.draft!);
const themes = computed(
  () =>
    [
      { id: "light", name: t("settings.light"), icon: "sun" },
      { id: "dark", name: t("settings.dark"), icon: "moon" },
      { id: "system", name: t("settings.system"), icon: "monitor" },
    ] as const,
);

function reset() {
  if (!state.info) return;
  state.draft = JSON.parse(JSON.stringify(state.info.defaults));
  notify(t("settings.defaultsLoaded"));
}
async function openDirectory() {
  try {
    if (window.hydrocalc) await window.hydrocalc.openDataDirectory();
    else {
      await navigator.clipboard.writeText(state.info?.data_dir || "");
      notify(t("settings.pathCopied"));
    }
  } catch (error) {
    report(error);
  }
}
</script>

<template>
  <div class="page settings-page" v-if="draft">
    <header class="page-header">
      <div>
        <h1>{{ t("nav.settings") }}</h1>
      </div>
      <button class="text-button" @click="reset">
        <Icon name="reset" :size="16" />{{ t("settings.reset") }}
      </button>
    </header>
    <div
      class="settings-tabs"
      role="tablist"
      :aria-label="t('settings.sections')"
    >
      <button
        v-for="tab in [
          { id: 'appearance', name: t('settings.appearance'), icon: 'sun' },
          { id: 'analysis', name: t('analysis.parameters'), icon: 'settings' },
          { id: 'data', name: t('settings.data'), icon: 'folder' },
        ]"
        :key="tab.id"
        :id="`tab-${tab.id}`"
        role="tab"
        :aria-selected="section === tab.id"
        :aria-controls="`settings-${tab.id}`"
        :class="{ active: section === tab.id }"
        @click="section = tab.id"
      >
        <Icon :name="tab.icon" :size="17" />{{ tab.name }}
      </button>
    </div>
    <form novalidate @submit.prevent class="settings-form">
      <div
        v-show="section === 'appearance'"
        id="settings-appearance"
        role="tabpanel"
        aria-labelledby="tab-appearance"
      >
        <section class="settings-section">
          <div class="section-title">
            <h2>{{ t("settings.theme") }}</h2>
            <p>{{ t("settings.themeHint") }}</p>
          </div>
          <div class="theme-options">
            <button
              v-for="theme in themes"
              :key="theme.id"
              type="button"
              class="theme-option"
              :class="{ chosen: draft.theme === theme.id }"
              :aria-pressed="draft.theme === theme.id"
              @click="draft.theme = theme.id"
            >
              <div class="theme-preview" :class="`preview-${theme.id}`">
                <div class="mini-sidebar">
                  <span></span><i></i><i></i><i></i>
                </div>
                <div class="mini-content">
                  <span></span>
                  <div class="mini-panels"><i></i><i></i></div>
                  <div class="mini-line"></div>
                </div>
              </div>
              <div class="theme-option-label">
                <Icon :name="theme.icon" :size="17" /><span>{{
                  theme.name
                }}</span
                ><span class="theme-radio"
                  ><Icon
                    v-if="draft.theme === theme.id"
                    name="check"
                    :size="12"
                /></span>
              </div>
            </button>
          </div>
        </section>
        <section class="settings-section">
          <div class="setting-row">
            <div>
              <h3>{{ t("settings.languageLabel") }}</h3>
              <p>{{ t("settings.languageHint") }}</p>
            </div>
            <select
              v-model="draft.language"
              class="language-select"
              :aria-label="t('settings.languageLabel')"
            >
              <option value="system">{{ t("settings.system") }}</option>
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </div>
        </section>
        <section class="settings-section">
          <div class="setting-row">
            <div>
              <h3>{{ t("settings.reduceMotion") }}</h3>
              <p>{{ t("settings.motionHint") }}</p>
            </div>
            <label class="switch"
              ><input
                v-model="draft.reduce_motion"
                type="checkbox"
                :aria-label="t('settings.reduceMotion')" /><span></span
            ></label>
          </div>
        </section>
      </div>
      <div
        v-show="section === 'analysis'"
        id="settings-analysis"
        role="tabpanel"
        aria-labelledby="tab-analysis"
      >
        <section class="settings-section">
          <div class="section-title">
            <h2>{{ t("settings.processing") }}</h2>
            <p>{{ t("settings.processingHint") }}</p>
          </div>
          <div class="field-grid">
            <label
              >{{ t("settings.method")
              }}<select v-model="draft.method">
                <option value="auto">{{ t("method.auto") }}</option>
                <option value="hsv">{{ t("method.hsv") }}</option>
                <option value="binary">{{ t("method.binary") }}</option>
              </select></label
            ><label
              >{{ t("settings.blur")
              }}<select
                v-model="draft.blur_kernel"
                :disabled="draft.method === 'binary'"
              >
                <option :value="0">{{ t("common.off") }}</option>
                <option :value="3">3 × 3</option>
                <option :value="5">5 × 5</option>
                <option :value="7">7 × 7</option>
              </select></label
            ><label
              >{{ t("settings.width") }}<span>px</span
              ><input
                v-model.number="draft.resolution_width"
                type="number"
                min="64"
                max="2000"
                step="1"
                required /></label
            ><label
              >{{ t("settings.height") }}<span>px</span
              ><input
                v-model.number="draft.resolution_height"
                type="number"
                min="64"
                max="2000"
                step="1"
                required
            /></label>
          </div>
        </section>
        <section class="settings-section" v-if="draft.method !== 'binary'">
          <div class="section-title">
            <h2>{{ t("settings.hsv") }}</h2>
            <p>{{ t("settings.hsvHint") }}</p>
          </div>
          <div class="hsv-ranges">
            <HsvRange
              v-for="(channel, index) in [
                t('settings.hue'),
                t('settings.saturation'),
                t('settings.value'),
              ]"
              :key="index"
              :label="channel"
              :channel="index"
              :lower="draft.lower_hsv[index]"
              :upper="draft.upper_hsv[index]"
              :maximum="index === 0 ? 179 : 255"
              @change="
                (lower, upper) => {
                  draft.lower_hsv[index] = lower;
                  draft.upper_hsv[index] = upper;
                }
              "
            />
          </div>
        </section>
        <section class="settings-section">
          <div class="section-title">
            <h2>{{ t("settings.scale") }}</h2>
            <p>{{ t("settings.scaleHint") }}</p>
          </div>
          <div class="field-grid">
            <label
              >{{ t("settings.actualWidth") }}<span>cm</span
              ><input
                v-model.number="draft.soil_width_cm"
                type="number"
                min="0.01"
                max="10000"
                step="any"
                required /></label
            ><label
              >{{ t("settings.actualHeight") }}<span>cm</span
              ><input
                v-model.number="draft.soil_height_cm"
                type="number"
                min="0.01"
                max="10000"
                step="any"
                required /></label
            ><label
              >{{ t("settings.startDepth") }}<span>cm</span
              ><input
                v-model.number="draft.start_depth_cm"
                type="number"
                min="0"
                :max="draft.soil_height_cm"
                step="any"
                required
            /></label>
          </div>
        </section>
        <section class="settings-section">
          <div class="section-title">
            <h2>{{ t("settings.thresholds") }}</h2>
          </div>
          <div class="field-grid">
            <label
              >{{ t("settings.matrixThreshold")
              }}<input
                v-model.number="draft.matrix_threshold"
                type="number"
                min="0.01"
                max="1"
                step="0.01"
                required
              /><small>{{ t("settings.matrixDefault") }}</small></label
            ><label
              >{{ t("settings.depthThreshold")
              }}<input
                v-model.number="draft.depth_threshold"
                type="number"
                min="0.0001"
                max="1"
                step="0.0001"
                required
              /><small>{{ t("settings.depthDefault") }}</small></label
            >
          </div>
        </section>
        <section class="settings-section">
          <div class="setting-row">
            <div>
              <h3>{{ t("settings.clustering") }}</h3>
              <p>{{ t("settings.clusterHint") }}</p>
            </div>
            <label class="switch"
              ><input
                v-model="draft.enable_clustering"
                type="checkbox"
                :aria-label="t('settings.clusterEnable')" /><span></span
            ></label>
          </div>
          <div
            class="field-grid clustering-setting"
            v-if="draft.enable_clustering"
          >
            <label
              >{{ t("settings.clusterCount")
              }}<select v-model.number="draft.clusters">
                <option
                  v-for="count in [2, 3, 4, 5, 6, 7, 8]"
                  :key="count"
                  :value="count"
                >
                  {{ t("settings.classes", { count }) }}
                </option>
              </select></label
            >
          </div>
        </section>
      </div>
      <div
        v-show="section === 'data'"
        id="settings-data"
        role="tabpanel"
        aria-labelledby="tab-data"
      >
        <section class="settings-section">
          <div class="section-title">
            <h2>{{ t("settings.export") }}</h2>
            <p>{{ t("settings.exportHint") }}</p>
          </div>
          <div class="setting-row">
            <div>
              <h3>{{ t("settings.includeOriginal") }}</h3>
              <p>{{ t("settings.originalHint") }}</p>
            </div>
            <label class="switch"
              ><input
                v-model="draft.export_include_original"
                type="checkbox"
                :aria-label="t('settings.includeOriginal')" /><span></span
            ></label>
          </div>
        </section>
        <section class="settings-section">
          <div class="section-title">
            <h2>{{ t("settings.localData") }}</h2>
            <p>{{ t("settings.dataHint") }}</p>
          </div>
          <label class="directory-label"
            >{{ t("settings.directory") }}
            <div class="directory-field">
              <input
                :value="state.info?.data_dir"
                readonly
                :aria-label="t('settings.directory')"
              /><button type="button" class="button" @click="openDirectory">
                <Icon name="folder" :size="17" />{{
                  isDesktop
                    ? t("settings.openDirectory")
                    : t("settings.copyDirectory")
                }}
              </button>
            </div></label
          >
          <div class="data-facts">
            <span
              >{{ t("settings.savedAnalyses")
              }}<strong>{{ state.history.length }}</strong></span
            ><button
              type="button"
              class="text-button"
              @click="state.page = 'history'"
            >
              {{ t("settings.manageHistory") }}<Icon name="arrow" :size="15" />
            </button>
          </div>
        </section>
        <section class="settings-section">
          <div class="section-title">
            <h2>{{ t("settings.about") }}</h2>
          </div>
          <dl class="about-details">
            <div>
              <dt>{{ t("settings.version") }}</dt>
              <dd>{{ state.info?.version }}</dd>
            </div>
            <div>
              <dt>{{ t("settings.platform") }}</dt>
              <dd>
                {{
                  state.info?.platform === "darwin"
                    ? "macOS"
                    : state.info?.platform === "win32"
                      ? "Windows"
                      : state.info?.platform
                }}
              </dd>
            </div>
            <div>
              <dt>{{ t("settings.processingMode") }}</dt>
              <dd>{{ t("common.localOnly") }}</dd>
            </div>
          </dl>
        </section>
      </div>
      <footer class="settings-autosave" role="status">
        <span class="status-dot"></span
        >{{
          state.settingsError
            ? t(state.settingsError)
            : state.saving || dirty
              ? t("settings.saving")
              : t("settings.autoSaved")
        }}
      </footer>
    </form>
  </div>
</template>
