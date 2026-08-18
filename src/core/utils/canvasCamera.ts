/**
 * core/utils/canvasCamera.ts — 画布相机（视口变换）纯函数
 *
 * 零平台依赖：缩放锚点数学被 滚轮缩放 / 双指捏合 / 元素聚焦 共用，
 * 抽离到 core 层以便单测与跨端一致。
 */

export interface Camera2D {
  x: number; // 视口平移（屏幕像素）
  y: number;
  scale: number; // 缩放系数
}

export const CAMERA_MIN_SCALE = 0.35;
export const CAMERA_MAX_SCALE = 2.5;

export const clampScale = (value: number): number =>
  Math.min(CAMERA_MAX_SCALE, Math.max(CAMERA_MIN_SCALE, value));

/**
 * 围绕固定锚点缩放（滚轮/按钮缩放语义）。
 * 锚点在屏幕坐标（相对画布视口左上角），缩放前后保持锚点的世界坐标不动。
 */
export function zoomAround(
  camera: Camera2D,
  anchorX: number,
  anchorY: number,
  nextScale: number,
): Camera2D {
  const ratio = clampScale(nextScale) / camera.scale;
  return {
    x: anchorX - (anchorX - camera.x) * ratio,
    y: anchorY - (anchorY - camera.y) * ratio,
    scale: clampScale(nextScale),
  };
}

/**
 * 双指捏合语义：以起始锚点做缩放基准，同时跟随锚点移动到新位置（缩放+平移）。
 * anchor（起始两指中点）与 nextAnchor（当前两指中点）均为屏幕坐标。
 */
export function pinchTo(
  camera: Camera2D,
  anchorX: number,
  anchorY: number,
  nextAnchorX: number,
  nextAnchorY: number,
  nextScale: number,
): Camera2D {
  const scale = clampScale(nextScale);
  const ratio = scale / camera.scale;
  const worldX = (anchorX - camera.x) / camera.scale;
  const worldY = (anchorY - camera.y) / camera.scale;
  return {
    x: nextAnchorX - worldX * ratio,
    y: nextAnchorY - worldY * ratio,
    scale,
  };
}