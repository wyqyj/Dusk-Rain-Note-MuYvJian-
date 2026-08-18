/// <reference types="vite/client" />

/**
 * 全局环境类型（平台中立）。
 *
 * 上游的 window.electronAPI（Electron IPC 契约）已由 ports + adapters 取代：
 * ui 层一律通过 getBridge()（src/platform/container.ts）访问能力面。
 * 删除 ElectronAPI 全局声明后，任何遗留的 window.electronAPI 引用都会在
 * tsc 阶段被静态捕获——这是"引用清零"的编译时保障。
 */

interface Window {
  __muyujianPendingCanvasId?: string;
  MathJax?: { typesetPromise?: (elements?: Element[]) => Promise<void> };
}