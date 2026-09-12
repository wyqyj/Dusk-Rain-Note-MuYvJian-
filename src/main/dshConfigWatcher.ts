import * as fs from 'fs';
import { readHarnessModelConfig, type HarnessModelConfig } from './dshConfig';

/** 配置指纹：只有有效配置（baseUrl/model/providerId/apiKey）实际变化时才触发重启。 */
export function fingerprintConfig(config: HarnessModelConfig | null): string {
  return config ? [config.baseUrl, config.model, config.providerId, config.apiKey ?? ''].join('|') : '';
}

export interface DshConfigWatcherOptions {
  homeDir: string;
  onChange: () => void | Promise<void>;
  debounceMs?: number;
}

/**
 * 监听 dsh home 目录（settings.yaml / .credentials.yaml）。
 * dsh Web GUI 里改模型或 Key 时直接写这两个文件，热重载据此自动重启运行时。
 * 返回停止函数（幂等，应用退出时调用）。
 */
export function startDshConfigWatcher(options: DshConfigWatcherOptions): () => void {
  const { homeDir, onChange, debounceMs = 900 } = options;
  let last = fingerprintConfig(readHarnessModelConfig(homeDir));
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let watcher: fs.FSWatcher | null = null;

  const evaluate = (): void => {
    if (stopped) return;
    const next = fingerprintConfig(readHarnessModelConfig(homeDir));
    if (next && next !== last) {
      last = next;
      void onChange();
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(evaluate, debounceMs);
  };

  try {
    watcher = fs.watch(homeDir, { persistent: false }, (_event, filename) => {
      const name = filename ? String(filename) : '';
      if (name && !name.includes('settings.yaml') && !name.includes('credentials.yaml')) return;
      schedule();
    });
  } catch {
    return () => {};
  }

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    watcher?.close();
    watcher = null;
  };
}
