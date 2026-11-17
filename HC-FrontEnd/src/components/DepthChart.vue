<script setup lang="ts">
import { t } from "../i18n";
import { computed, ref } from "vue";
import type { Analysis } from "../types";
import { format } from "../state";

const props = defineProps<{
  record: Analysis;
}>();
const svg = ref<SVGSVGElement>();
const hover = ref<number | null>(null);
const depth = computed(() => props.record.settings?.soil_height_cm || 50);
const samples = computed(() => {
  const rows = props.record.profile || [];
  const stride = Math.max(1, Math.floor(rows.length / 200));
  return rows.filter(
    (_, index) => index % stride === 0 || index === rows.length - 1,
  );
});
const points = computed(() =>
  samples.value
    .map(
      (row) =>
        `${48 + row.ratio * 3.4},${24 + (row.depth_cm / depth.value) * 174}`,
    )
    .join(" "),
);
const inspected = computed(() => {
  if (hover.value === null) return null;
  const rows = props.record.profile || [];
  return rows[
    Math.min(
      rows.length - 1,
      Math.max(0, Math.round(hover.value * (rows.length - 1))),
    )
  ];
});
function inspect(event: MouseEvent) {
  // 根据 SVG 的实际渲染尺寸定位深度，缩放窗口后仍可检查对应的真实数据行。
  const box = svg.value?.getBoundingClientRect();
  if (!box) return;
  const y = ((event.clientY - box.top) / box.height) * 230;
  hover.value = Math.max(0, Math.min(1, (y - 24) / 174));
}
</script>

<template>
  <section class="panel chart-panel">
    <div class="panel-heading">
      <h2>{{ t("chart.title") }}</h2>
      <span class="chart-reading" v-if="inspected"
        >{{ format(inspected.depth_cm) }} cm /
        {{ format(inspected.ratio) }}%</span
      ><span v-else class="muted small">{{ t("chart.ratio") }}</span>
    </div>
    <svg
      ref="svg"
      class="depth-chart"
      viewBox="0 0 430 230"
      role="img"
      :aria-label="t('chart.description')"
      @mousemove="inspect"
      @mouseleave="hover = null"
    >
      <g v-for="tick in [0, 25, 50, 75, 100]" :key="tick">
        <line
          :x1="48 + tick * 3.4"
          y1="24"
          :x2="48 + tick * 3.4"
          y2="198"
          class="chart-grid"
        />
        <text :x="48 + tick * 3.4" y="220" text-anchor="middle">
          {{ tick }}
        </text>
      </g>
      <g v-for="tick in [0, 0.25, 0.5, 0.75, 1]" :key="tick">
        <line
          x1="48"
          :y1="24 + tick * 174"
          x2="388"
          :y2="24 + tick * 174"
          class="chart-grid"
        />
        <text x="34" :y="28 + tick * 174" text-anchor="end">
          {{ format(tick * depth, 1) }}
        </text>
      </g>
      <text x="14" y="13">cm</text>
      <polygon :points="`48,24 ${points} 48,198`" class="chart-fill" />
      <polyline :points="points" class="chart-line" />
      <line
        v-if="inspected"
        x1="48"
        x2="388"
        :y1="24 + (inspected.depth_cm / depth) * 174"
        :y2="24 + (inspected.depth_cm / depth) * 174"
        class="chart-crosshair"
      />
      <circle
        v-if="inspected"
        :cx="48 + inspected.ratio * 3.4"
        :cy="24 + (inspected.depth_cm / depth) * 174"
        r="4"
        class="chart-point"
      />
    </svg>
  </section>
</template>
