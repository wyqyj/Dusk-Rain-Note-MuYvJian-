/**
 * ui/utils/platform.ts — 渲染层平台判定
 *
 * 手机端（Capacitor 原生容器）走独立 UX：单栏编辑/预览、无画布、安全区等。
 * web 模式（浏览器调试/桌面）保持桌面形态；窄屏浏览器另有上游 media query 兜底。
 */
import { Capacitor } from '@capacitor/core';

export const isNativeMobile = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};