/**
 * platform/container.ts — 依赖容器（单一注入点）
 *
 * ui 层通过 getBridge() 获取唯一依赖面；单测/演示可在启动前 initBridge(任意实现)。
 * 这是对上游"全局 window.electronAPI"接缝的正式替代：显式、可替换、可测试。
 */

import type { PlatformBridge } from '../ports';

let active: PlatformBridge | null = null;

export function initBridge(bridge: PlatformBridge): void {
  active = bridge;
}

export function getBridge(): PlatformBridge {
  if (!active) {
    throw new Error('PlatformBridge 未初始化：请在应用启动（main.tsx 首行）调用 initBridge(createPlatformBridge())');
  }
  return active;
}

export function isBridgeReady(): boolean {
  return active !== null;
}

export function resetBridge(): void {
  active = null;
}