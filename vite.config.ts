import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: { target: 'chrome120', cssCodeSplit: false, modulePreload: false, rolldownOptions: { output: { format: 'iife' } } },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:5174' },
    watch: { ignored: ['**/.state/**', '**/build/**', '**/artifacts/**', '**/tests/**', '**/docs/**'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.state/**'] },
  },
})
