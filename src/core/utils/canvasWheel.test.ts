import { describe, expect, it } from 'vitest';
import { isCanvasBackgroundWheelTarget } from './canvasWheel';

describe('isCanvasBackgroundWheelTarget', () => {
  it('keeps canvas zoom on the background and blocks it inside an item', () => {
    expect(isCanvasBackgroundWheelTarget({ closest: () => null } as unknown as EventTarget)).toBe(true);
    expect(isCanvasBackgroundWheelTarget({ closest: () => ({}) as Element } as unknown as EventTarget)).toBe(false);
    expect(isCanvasBackgroundWheelTarget(null)).toBe(true);
  });
});
