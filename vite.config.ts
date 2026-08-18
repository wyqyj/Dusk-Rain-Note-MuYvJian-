import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src/ui',
  base: './',
  server: {
    host: true,
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-codemirror': [
            '@codemirror/view', '@codemirror/state',
            '@codemirror/lang-markdown', '@codemirror/language',
            '@codemirror/language-data', '@codemirror/commands',
          ],
          'vendor-markdown': ['markdown-it', 'markdown-it-task-lists', 'highlight.js', 'katex'],
          'vendor-zustand': ['zustand'],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/ui'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@ports': path.resolve(__dirname, 'src/ports'),
      '@adapters': path.resolve(__dirname, 'src/adapters'),
    },
  },
  test: {
    environment: 'node',
    // root 为 src/ui，测试文件位于 ../core 与 ../adapters，用相对根目录的模式
    include: ['../core/**/*.test.ts', '../adapters/**/*.test.ts', '../ports/**/*.test.ts'],
  },
})