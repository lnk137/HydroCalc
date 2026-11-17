<script setup lang="ts">
defineProps<{
  name: string;
  size?: number;
}>();

// 共用线性图标，避免整套字体图标进入安装包。
const paths: Record<string, string> = {
  drop: "M12 3C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-12Z M9 16a3 3 0 0 0 3 3",
  image: "M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4 M15 8h.01",
  history: "M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  upload: "M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6",
  download: "M12 3v13 M7 11l5 5 5-5 M4 17v4h16v-4",
  sun: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5",
  moon: "M20.8 13a9 9 0 0 1-9.8-9.8A9 9 0 1 0 20.8 13Z",
  monitor: "M3 4h18v13H3z M8 21h8 M12 17v4",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  check: "M5 12l4 4L19 6",
  close: "M6 6l12 12 M18 6 6 18",
  trash: "M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7",
  folder: "M3 6h7l2 2h9v12H3z M3 6V4h7l2 2h6v2",
  zoom: "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14 M15 15l6 6 M7 10h6 M10 7v6",
  chevron: "M8 5l7 7-7 7",
  info: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18 M12 11v6 M12 7h.01",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  chart: "M4 3v17h17 M7 14l4-5 4 3 5-7",
  reset: "M3 11a9 9 0 1 1 3 8 M3 4v7h7",
};
</script>

<template>
  <svg
    :width="size || 20"
    :height="size || 20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.image" />
  </svg>
</template>
