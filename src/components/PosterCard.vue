<script setup lang="ts">
import type { Content, ContinueItem } from '../types';
defineProps<{ item: Content | ContinueItem; context: string }>();
defineEmits<{ select: [item: Content] }>();
</script>
<template>
  <button class="poster-card" :data-nav-id="`${context}-${item.id}`" @click="$emit('select', item)">
    <span class="poster-image">
      <img v-if="item.poster" :src="item.poster" :alt="''" width="300" height="450" loading="lazy" decoding="async" @error="($event.target as HTMLImageElement).style.display = 'none'" />
      <span class="poster-fallback" aria-hidden="true">{{ item.title.slice(0, 1) }}</span>
      <span v-if="item.rating" class="rating">{{ item.rating }}</span>
      <span v-if="'progress' in item && item.progress.position !== null" class="poster-progress"><span :style="{ width: `${Math.min(100, item.progress.position / (item.progress.duration || Infinity) * 100)}%` }" /></span>
    </span>
    <span class="poster-title">{{ item.title }}</span>
    <span v-if="!('progress' in item)" class="poster-meta">{{ item.meta || (item.type === 'series' ? 'Сериал' : 'Фильм') }}</span>
    <span v-if="'progress' in item" class="poster-meta accent">{{ item.progress.season ? `Сезон ${item.progress.season} · Серия ${item.progress.episode}` : 'Открыть' }}{{ item.progress.position === null ? '' : ` · ${Math.floor(item.progress.position / 60)} мин` }}</span>
  </button>
</template>
