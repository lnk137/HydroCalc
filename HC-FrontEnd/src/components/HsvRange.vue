<script setup lang="ts">
import { ref, watch } from "vue";
import { t } from "../i18n";

const props = defineProps<{
  label: string;
  channel: number;
  lower: number;
  upper: number;
  maximum: number;
}>();
const emit = defineEmits<{
  change: [lower: number, upper: number];
}>();
const lowerText = ref(String(props.lower));
const upperText = ref(String(props.upper));
const dragging = ref<"lower" | "upper" | null>(null);
watch(
  () => [props.lower, props.upper],
  () => {
    lowerText.value = String(props.lower);
    upperText.value = String(props.upper);
  },
);

function change(handle: "lower" | "upper", number: number) {
  // 两个端点作为同一对合法值提交，不允许交叉后触发无效自动保存。
  if (!Number.isFinite(number)) return;
  const value = Math.round(Math.max(0, Math.min(props.maximum, number)));
  if (handle === "lower")
    emit("change", Math.min(value, props.upper), props.upper);
  else emit("change", props.lower, Math.max(value, props.lower));
}
function position(event: PointerEvent) {
  if (!dragging.value) return;
  const track = event.currentTarget as HTMLElement;
  const box = track.getBoundingClientRect();
  const value = ((event.clientX - box.left) / box.width) * props.maximum;
  change(dragging.value, value);
}
function begin(event: PointerEvent) {
  // 点击轨道选择最近端点；指针捕获保证拖到控件外仍连续响应。
  const track = event.currentTarget as HTMLElement;
  const target = event.target as HTMLElement;
  const box = track.getBoundingClientRect();
  const value = ((event.clientX - box.left) / box.width) * props.maximum;
  const handle = target.closest("[data-handle]")?.getAttribute("data-handle");
  dragging.value =
    handle === "lower" || handle === "upper"
      ? handle
      : Math.abs(value - props.lower) < Math.abs(value - props.upper)
        ? "lower"
        : "upper";
  track.setPointerCapture(event.pointerId);
  position(event);
}
function keyboard(event: KeyboardEvent, handle: "lower" | "upper") {
  const current = handle === "lower" ? props.lower : props.upper;
  const step = event.shiftKey ? 10 : 1;
  const actions: Record<string, number> = {
    ArrowLeft: current - step,
    ArrowDown: current - step,
    ArrowRight: current + step,
    ArrowUp: current + step,
    Home: 0,
    End: props.maximum,
  };
  if (!(event.key in actions)) return;
  event.preventDefault();
  change(handle, actions[event.key]);
}
function commit(handle: "lower" | "upper") {
  const text = handle === "lower" ? lowerText.value : upperText.value;
  if (text.trim()) change(handle, Number(text));
  lowerText.value = String(props.lower);
  upperText.value = String(props.upper);
}
</script>

<template>
  <div class="range-field">
    <label class="range-label">{{ label }}</label>
    <div
      class="dual-range"
      :class="`channel-${channel}`"
      @pointerdown.prevent="begin"
      @pointermove="position"
      @pointerup="dragging = null"
      @lostpointercapture="dragging = null"
    >
      <div class="range-track"></div>
      <div
        class="range-shade"
        :style="`width:${(lower / maximum) * 100}%`"
      ></div>
      <div
        class="range-shade range-shade-end"
        :style="`left:${(upper / maximum) * 100}%`"
      ></div>
      <button
        v-for="handle in ['lower', 'upper'] as const"
        :key="handle"
        type="button"
        class="range-thumb"
        :data-handle="handle"
        role="slider"
        :style="`left:${((handle === 'lower' ? lower : upper) / maximum) * 100}%`"
        :aria-label="`${label} ${t('settings.' + handle)}`"
        :aria-valuemin="handle === 'upper' ? lower : 0"
        :aria-valuemax="handle === 'lower' ? upper : maximum"
        :aria-valuenow="handle === 'lower' ? lower : upper"
        @keydown="keyboard($event, handle)"
      ></button>
    </div>
    <div class="range-numbers">
      <input
        v-model="lowerText"
        inputmode="numeric"
        :aria-label="`${label} ${t('settings.lower')} value`"
        @blur="commit('lower')"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      /><span>–</span
      ><input
        v-model="upperText"
        inputmode="numeric"
        :aria-label="`${label} ${t('settings.upper')} value`"
        @blur="commit('upper')"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      />
    </div>
  </div>
</template>
