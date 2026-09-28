<script setup lang="ts">
const paths = {
  home: 'M3 10.5 12 3l9 7.5M5 9v12h5v-7h4v7h5V9',
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5',
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  film: 'M4 3h16v18H4V3ZM4 8h16M4 16h16M8 3v18M16 3v18',
  series: 'M3 7h18v14H3V7ZM3 7l18-4-1-3L2 4l1 3M7 3l3 3M14 2l3 3',
  cartoons: 'M8 5 5 2v6a8 8 0 1 0 14 0V2l-3 3M8 11h.01M16 11h.01M9 16q3 2 6 0',
  anime: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a8 6 0 0 1 16 0v2',
  settings: 'M4 7h16M4 17h16M9 4v6M15 14v6',
  back: 'M20 12H4m7-7-7 7 7 7',
  next: 'm5 5 10 7L5 19V5ZM19 5v14',
  previous: 'm19 5-10 7 10 7V5ZM5 5v14',
  play: 'm6 3 14 9-14 9V3Z',
  pause: 'M8 4v16M16 4v16',
  'seek-left': 'm11 5-8 7 8 7m10-14-8 7 8 7',
  'seek-right': 'm3 5 8 7-8 7m10-14 8 7-8 7',
  aspect: 'M3 5h18v14H3V5ZM3 8h18M3 16h18',
  subtitles: 'M4 6h16v12H4V6ZM7 10h4M7 14h6M15 10h2M15 14h2',
  check: 'm4 12 5 5L20 6',
  close: 'm5 5 14 14M5 19 19 5',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 7M4 12l2 7a8 8 0 0 0 13-2',
} as const;
defineProps<{ name: keyof typeof paths }>();
</script>
<template><svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="paths[name]" /></svg></template>
<style scoped>.app-icon{width:1.2em;height:1.2em;display:inline-block;flex:none;vertical-align:middle}</style>
