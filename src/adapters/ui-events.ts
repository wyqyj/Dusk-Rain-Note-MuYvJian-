/**
 * adapters/ui-events.ts — 覆盖层控制的站内事件实现
 *
 * 桌面版的多窗口（快速笔记/今日计划/任务统计）在移动端收敛为 App 内覆盖层。
 * 视图实现归属 ui 层（App.tsx 监听事件切换覆盖层），本适配器只负责把
 * IWindowOps 的窗口语义翻译为站内事件——桥接口不变，呈现方式由 ui 决定。
 */

import { BaseWindowOps } from './base';

export const EV_QUICK_NOTE_TOGGLE = 'muyujian:toggle-quick-note';
export const EV_QUICK_NOTE_CLOSE = 'muyujian:close-quick-note';
export const EV_TODAY_PLAN_TOGGLE = 'muyujian:toggle-today-plan';
export const EV_TODAY_PLAN_CLOSE = 'muyujian:close-today-plan';
export const EV_STATS_TOGGLE = 'muyujian:toggle-timer-stats';
export const EV_STATS_CLOSE = 'muyujian:close-timer-stats';
export const EV_PANEL_BACK = 'muyujian:back';

export class UiEventWindowOps extends BaseWindowOps {
  override toggleQuickNote(): void { window.dispatchEvent(new Event(EV_QUICK_NOTE_TOGGLE)); }
  override closeQuickNote(): void { window.dispatchEvent(new Event(EV_QUICK_NOTE_CLOSE)); }
  override toggleTodayPlanWindow(): void { window.dispatchEvent(new Event(EV_TODAY_PLAN_TOGGLE)); }
  override closeTodayPlanWindow(): void { window.dispatchEvent(new Event(EV_TODAY_PLAN_CLOSE)); }
  override toggleTimerStatsWindow(): void { window.dispatchEvent(new Event(EV_STATS_TOGGLE)); }
  override closeTimerStatsWindow(): void { window.dispatchEvent(new Event(EV_STATS_CLOSE)); }
  // 最小化/透明度等桌面语义在移动端保持 no-op
}

/** 在 bridge 上装配覆盖层事件驱动窗口（web/capacitor 共用）。 */
export function attachUiEventWindowOps(bridge: { window: BaseWindowOps }): void {
  bridge.window = new UiEventWindowOps();
}