/**
 * platform/bootstrap.ts — 按运行环境装配适配器
 *
 * Capacitor 原生环境 → 文件系统适配器；浏览器 → localStorage 适配器。
 * 未来如双端演进（桌面 electron），在此增加分支即可，ui/core 零改动。
 */

import { Capacitor } from '@capacitor/core';
import type { PlatformBridge } from '../ports';
import { createCapacitorBridge } from '../adapters/capacitor';
import { createWebBridge } from '../adapters/web';
import { createMemoryBridge } from '../adapters/memory';
import { attachUiEventWindowOps } from '../adapters/ui-events';
import { initBridge } from './container';

export function createPlatformBridge(): PlatformBridge {
  if (Capacitor.isNativePlatform()) return createCapacitorBridge();
  return createWebBridge();
}

/** 在 body 上标记运行平台 class，供 CSS 按平台调整（如隐藏桌面窗口按钮）。 */
function markPlatformClass(name: string): void {
  try { document.body.classList.add(`platform-${name}`); } catch { /* 文档未就绪时忽略 */ }
}

/** 应用启动入口：初始化桥并返回。 */
export function bootstrap(): PlatformBridge {
  const bridge = createPlatformBridge();
  // 多窗口语义 → 站内覆盖层事件（快速笔记/今日计划/任务统计）
  attachUiEventWindowOps(bridge as { window: PlatformBridge['window'] });
  initBridge(bridge);
  markPlatformClass(bridge.platform);
  return bridge;
}

/** 测试/演示用：注入内存桥。 */
export function bootstrapMemory(): PlatformBridge {
  const bridge = createMemoryBridge();
  initBridge(bridge);
  return bridge;
}