import { useEffect, useRef, useCallback } from 'react';

interface UseAutoSaveOptions {
  content: string;
  saveFn: (content: string) => void;
  interval?: number; // 毫秒，默认 60000
  dependencies?: unknown[];
}

/**
 * 自动保存 Hook
 * 每隔指定时间自动保存内容，切换依赖项时也会触发保存
 */
export function useAutoSave({ content, saveFn, interval = 60000, dependencies = [] }: UseAutoSaveOptions): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contentRef = useRef(content);
  const saveFnRef = useRef(saveFn);
  const lastSavedRef = useRef(content);

  // 更新 refs
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    saveFnRef.current = saveFn;
  }, [saveFn]);

  // 保存函数
  const save = useCallback(() => {
    if (contentRef.current !== lastSavedRef.current) {
      saveFnRef.current(contentRef.current);
      lastSavedRef.current = contentRef.current;
    }
  }, []);

  // 定时保存
  useEffect(() => {
    timerRef.current = setInterval(save, interval);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [interval, save]);

  // 依赖项变化时立即保存
  useEffect(() => {
    save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  // 窗口关闭前保存
  useEffect(() => {
    const handleBeforeUnload = () => save();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [save]);
}
