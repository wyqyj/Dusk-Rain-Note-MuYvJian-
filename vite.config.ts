import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    // vite root 是 src/renderer，相对 root 把主进程测试也纳入范围
    include: ['**/*.test.ts', '../main/**/*.test.ts'],
    // 本机 HTTP 代理（NODE_USE_ENV_PROXY=1）会偶发拦截回环请求，测试内 fetch 直连
    env: {
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    },
  },
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
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
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
})
