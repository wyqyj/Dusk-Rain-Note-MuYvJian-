import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TransportClosedError } from '@deepseek-ai/dsh-sdk-client';
import { DshRuntime, toLongRealPath } from './dshRuntime';

/**
 * dshRuntime 单测：以假 harness 验证生命周期管理。
 * 真实 dsh 子进程行为（握手/工具/流式）由 dev 冒烟验证，不在 CI 内拉起。
 */

interface FakeHarness {
  start: () => Promise<void>;
  close: () => Promise<void>;
  session: (id?: string) => { run: (input: string, options: { onNotification?: (n: unknown) => void }) => Promise<{ sessionId: string; finalResponse: string }> };
}

function makeDeps(overrides: {
  harnessFactory?: (options: any) => any;
  apiKey?: string;
} = {}) {
  return {
    workspaceRoot: () => 'D:/ws',
    getApiKey: () => overrides.apiKey ?? 'test-key',
    homeDir: 'D:/dsh-home',
    dshBin: 'D:/fake/bin.js',
    nodeCommand: 'node',
    prepareProfile: async () => [],
    harnessFactory: overrides.harnessFactory,
  };
}

function successHarness(behavior?: Partial<FakeHarness>): FakeHarness {
  return {
    start: async () => {},
    close: async () => {},
    session: (id?: string) => ({
      run: async (input: string, options: { onNotification?: (n: unknown) => void }) => {
        options.onNotification?.({ method: 'session.event', params: { input } });
        return { sessionId: id ?? 'sess-1', finalResponse: `回声:${input}` };
      },
    }),
    ...behavior,
  };
}

describe('DshRuntime', () => {
  it('启动一次即复用，并透传通知与结果', async () => {
    let starts = 0;
    const runtime = new DshRuntime(makeDeps({
      harnessFactory: () => { starts += 1; return successHarness(); },
    }));
    const events: unknown[] = [];
    const first = await runtime.run(undefined, '你好', (n) => events.push(n));
    expect(first.sessionId).toBe('sess-1');
    expect(first.finalResponse).toBe('回声:你好');
    expect(events).toHaveLength(1);
    await runtime.run('sess-1', '继续', () => {});
    expect(starts).toBe(1);
    await runtime.close();
    expect(runtime.isRunning()).toBe(false);
  });

  it('会话 id 透传给 harness.session', async () => {
    let seen: string | undefined;
    const runtime = new DshRuntime(makeDeps({
      harnessFactory: () => successHarness({
        session: (id?: string) => { seen = id; return successHarness().session(id); },
      }),
    }));
    await runtime.run('sess-42', 'hi', () => {});
    expect(seen).toBe('sess-42');
    await runtime.close();
  });

  it('TransportClosedError 后丢弃运行时，下次调用重建', async () => {
    let starts = 0;
    const runtime = new DshRuntime(makeDeps({
      harnessFactory: () => {
        starts += 1;
        return starts === 1 ? successHarness({
          session: () => ({ run: async () => { throw new TransportClosedError('runtime died'); } }),
        }) : successHarness();
      },
    }));
    await expect(runtime.run(undefined, 'hi', () => {})).rejects.toThrow('died');
    expect(runtime.isRunning()).toBe(false);
    const again = await runtime.run(undefined, 'retry', () => {});
    expect(again.finalResponse).toBe('回声:retry');
    expect(starts).toBe(2);
    await runtime.close();
  });

  it('启动失败不留坏句柄，可重试', async () => {
    let starts = 0;
    const runtime = new DshRuntime(makeDeps({
      harnessFactory: () => {
        starts += 1;
        return starts === 1 ? { ...successHarness(), start: async () => { throw new Error('spawn fail'); } } : successHarness();
      },
    }));
    await expect(runtime.run(undefined, 'hi', () => {})).rejects.toThrow('spawn fail');
    const result = await runtime.run(undefined, 'again', () => {});
    expect(result.finalResponse).toBe('回声:again');
    await runtime.close();
  });

  it('没有 API Key 时直接报错，不启动子进程', async () => {
    let started = false;
    const runtime = new DshRuntime(makeDeps({
      apiKey: '',
      harnessFactory: () => { started = true; return successHarness(); },
    }));
    await expect(runtime.run(undefined, 'hi', () => {})).rejects.toThrow('API Key');
    expect(started).toBe(false);
  });

  it('close 幂等，restart 后下次调用重建', async () => {
    let starts = 0;
    let closes = 0;
    const runtime = new DshRuntime(makeDeps({
      harnessFactory: () => ({
        ...successHarness(),
        start: async () => { starts += 1; },
        close: async () => { closes += 1; },
      }),
    }));
    await runtime.close();
    await runtime.run(undefined, 'a', () => {});
    await runtime.restart();
    await runtime.run(undefined, 'b', () => {});
    expect(starts).toBe(2);
    expect(closes).toBe(1);
    await runtime.close();
    await runtime.close();
    expect(closes).toBe(2);
  });
});

describe('toLongRealPath', () => {
  it('中文路径返回 realpath 归一化结果', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '暮雨-'));
    try {
      const expected = fs.realpathSync.native(dir);
      if (process.platform === 'win32') {
        expect(toLongRealPath(dir)).toBe(expected);
      } else {
        expect(toLongRealPath(dir)).toBe(dir);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('路径不存在时原样返回，不抛错', () => {
    const missing = path.join(os.tmpdir(), '暮雨-不存在的路径-xyz123');
    expect(toLongRealPath(missing)).toBe(missing);
  });
});
