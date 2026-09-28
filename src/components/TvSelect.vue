<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
type Option = { value: string | number; label: string; disabled?: boolean };
const props = defineProps<{ modelValue: string | number; options: Option[]; label: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string | number]; change: [value: string | number] }>();
const id = useId();
const opened = ref(false);
const trigger = ref<HTMLButtonElement>();
const popup = ref<HTMLElement>();
const selected = computed(() => props.options.find(option => option.value === props.modelValue));
const unavailable = computed(() => props.disabled || !props.options.some(option => !option.disabled));
let restorePending = false;
function restoreFocus() {
  const target = trigger.value;
  if (!restorePending || unavailable.value || !target) return;
  restorePending = false;
  if ((document.activeElement === document.body || document.activeElement === target) && target.getClientRects().length && !target.closest('[inert]') && getComputedStyle(target).visibility !== 'hidden') target.focus({ preventScroll: true });
}
watch(unavailable, () => { void nextTick(restoreFocus); });
async function open() {
  if (unavailable.value) return;
  opened.value = true;
  await nextTick();
  const target = popup.value?.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)') || popup.value?.querySelector<HTMLElement>('[role="option"]:not(:disabled)');
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
async function close() {
  restorePending = true;
  opened.value = false;
  await nextTick();
  restoreFocus();
}
function isOpen() { return opened.value; }
defineExpose({ close, isOpen });
function choose(option: Option) {
  if (option.disabled) return;
  emit('update:modelValue', option.value);
  emit('change', option.value);
  void close();
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 461) {
    event.preventDefault(); event.stopPropagation(); void close();
  } else if (event.key === 'Tab') {
    const buttons = [...(popup.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const target = buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
    event.preventDefault(); target?.focus();
  }
}
</script>
<template>
  <div class="tv-select">
    <span class="tv-select-label">{{ label }}</span>
    <button ref="trigger" class="tv-select-trigger" type="button" role="combobox" :aria-label="label" aria-haspopup="listbox" :aria-expanded="opened" :aria-controls="`${id}-options`" :data-value="String(modelValue)" :disabled="unavailable" @click="open">
      <slot name="trigger"><span>{{ selected?.label || (options.length ? 'Выберите вариант' : 'Нет доступных вариантов') }}</span></slot>
    </button>
    <Teleport to="body">
      <div v-if="opened" class="modal-backdrop tv-select-backdrop" data-focus-scope @click.self="close" @keydown="keydown">
        <section ref="popup" class="dialog tv-select-dialog" role="dialog" aria-modal="true" :aria-label="label">
          <header><h2>{{ label }}</h2><button type="button" :aria-label="`Закрыть выбор: ${label}`" @click="close">×</button></header>
          <div :id="`${id}-options`" class="tv-select-options" role="listbox" :aria-label="label">
            <button v-for="option in options" :key="option.value" type="button" role="option" :aria-label="option.label" :aria-selected="option.value === modelValue" :data-value="String(option.value)" :disabled="option.disabled" @click="choose(option)">
              <span>{{ option.label }}</span><span v-if="option.value === modelValue" aria-hidden="true">✓</span>
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>
