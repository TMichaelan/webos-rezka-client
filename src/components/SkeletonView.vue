<script setup lang="ts">
import iconUrl from '../../webos/large-icon.png';
defineProps<{ kind: 'boot' | 'shelves' | 'grid' | 'details' | 'profile'; count?: number }>();
</script>
<template>
  <div :data-skeleton="kind" :class="{ 'boot-screen': kind === 'boot' }" aria-hidden="true">
    <template v-if="kind === 'boot'">
      <div class="boot-content"><img class="boot-mark" :src="iconUrl" alt="" width="130" height="130" /><div class="skeleton-block skeleton-line" /><div class="skeleton-block skeleton-line skeleton-short" /></div>
    </template>
    <div v-else-if="kind === 'shelves' || kind === 'grid'" :class="kind === 'shelves' ? 'poster-row' : 'poster-grid'">
      <div v-for="item in count ?? (kind === 'grid' ? 10 : 6)" :key="item" class="skeleton-card"><div class="poster-image skeleton-block" /><div class="poster-title skeleton-block skeleton-line" /><div class="poster-meta skeleton-block skeleton-line skeleton-short" /></div>
    </div>
    <div v-else-if="kind === 'details'" class="detail-hero">
      <div class="detail-artwork skeleton-block" />
      <div class="detail-info"><div class="skeleton-block skeleton-title" /><div class="detail-metadata skeleton-block skeleton-line skeleton-short" /><div class="detail-synopsis"><div v-for="line in 4" :key="line" class="skeleton-block skeleton-line skeleton-copy" /></div><div class="detail-actions"><div class="skeleton-block skeleton-action" /></div><div class="detail-selectors"><div><div class="skeleton-block skeleton-line skeleton-short" /><div class="skeleton-block skeleton-select" /></div></div></div>
    </div>
    <div v-else class="profile-panel">
      <div class="profile-avatar skeleton-block" /><div class="profile-copy"><div class="profile-label skeleton-block skeleton-line skeleton-short" /><div class="skeleton-block skeleton-heading" /><div class="account-tier skeleton-block skeleton-line skeleton-short" /></div><div class="profile-logout skeleton-block skeleton-action" />
    </div>
  </div>
</template>
