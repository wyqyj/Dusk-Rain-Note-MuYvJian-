export function isCanvasBackgroundWheelTarget(target: EventTarget | null): boolean {
  const candidate = target as { closest?: (selector: string) => Element | null } | null;
  return !candidate?.closest?.('[data-canvas-item]');
}
