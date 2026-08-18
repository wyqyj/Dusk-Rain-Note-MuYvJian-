import { describe, expect, it } from 'vitest';
import { clampScale, pinchTo, zoomAround } from './canvasCamera';

const cam = (x: number, y: number, scale: number) => ({ x, y, scale });

describe('core/utils/canvasCamera — 画布相机数学', () => {
  it('zoomAround 保持锚点世界坐标不动', () => {
    const camera = cam(100, 50, 1);
    const anchorX = 300;
    const anchorY = 200;
    const worldBefore = { x: (anchorX - camera.x) / camera.scale, y: (anchorY - camera.y) / camera.scale };
    const next = zoomAround(camera, anchorX, anchorY, 2);
    const worldAfter = { x: (anchorX - next.x) / next.scale, y: (anchorY - next.y) / next.scale };
    expect(next.scale).toBe(2);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('zoomAround 缩小时世界锚点同样不动', () => {
    const camera = cam(0, 0, 2);
    const next = zoomAround(camera, 400, 300, 0.5);
    expect(next.scale).toBe(0.5);
    expect((400 - next.x) / next.scale).toBeCloseTo((400 - 0) / 2, 6);
    expect((300 - next.y) / next.scale).toBeCloseTo((300 - 0) / 2, 6);
  });

  it('pinchTo 同时应用缩放与中点位移', () => {
    const camera = cam(100, 50, 1);
    // 锚点不动时退化为 zoomAround
    const noPan = pinchTo(camera, 300, 200, 300, 200, 2);
    expect(noPan).toEqual(zoomAround(camera, 300, 200, 2));
    // 中点移动 (dx, dy)，世界锚点被带到新位置
    const pan = pinchTo(camera, 300, 200, 330, 240, 2);
    expect((330 - pan.x) / pan.scale).toBeCloseTo((300 - camera.x) / camera.scale, 6);
    expect((240 - pan.y) / pan.scale).toBeCloseTo((200 - camera.y) / camera.scale, 6);
  });

  it('clampScale 限制缩放到 [0.35, 2.5]', () => {
    expect(clampScale(0.1)).toBe(0.35);
    expect(clampScale(10)).toBe(2.5);
    expect(clampScale(1)).toBe(1);
  });
});