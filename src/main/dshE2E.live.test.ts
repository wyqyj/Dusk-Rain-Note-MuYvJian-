import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DshRuntime } from './dshRuntime';
import { AgentBridge } from './agentBridge';

/**
 * 真实网关端到端：kimi-k3（openai-completions）+ 暮雨笺能力工具。
 * 仅在 `DSH_LIVE_KEY=<api key>` 时执行；同时覆盖中文工作区路径作为 dsh cwd 的回归。
 */
const KEY = process.env.DSH_LIVE_KEY;
const BASE_URL = process.env.DSH_LIVE_BASE_URL || 'https://api.yujianwudi.top/v1';
const MODEL = process.env.DSH_LIVE_MODEL || 'kimi-k3';

describe.skipIf(!KEY)('DshRuntime 真实网关 E2E', () => {
  it('中文路径工作区 + 自定义 provider 下，模型能调用 notes_create 建笔记', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-e2e-home-'));
    // 含空格与多中文段的工作区路径，覆盖路径裁剪回归
    const workspace = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-e2e-')), '工作区 导入验证');
    fs.mkdirSync(workspace, { recursive: true });

    const token = 'e2e-token';
    const bridge = new AgentBridge(
      { enabled: true, bind: 'loopback', token },
      { workspaceRoot: () => workspace, confirmWrite: async () => true },
    );
    const status = await bridge.start();

    const runtime = new DshRuntime({
      workspaceRoot: () => workspace,
      getApiKey: () => KEY!,
      getModelConfig: () => ({ baseUrl: BASE_URL, model: MODEL }),
      homeDir: home,
      getBridgeEndpoint: async () => ({ url: `http://127.0.0.1:${status.port}`, token }),
    });

    try {
      const result = await runtime.run(
        undefined,
        '请立即调用 notes_create 工具创建一条笔记，标题为「端到端验证」，内容为「dsh agent 冒烟」。只需调用工具，不要编造结果。',
        (notification) => { if (process.env.DSH_LIVE_VERBOSE) console.log('[event]', notification.method, JSON.stringify(notification.params).slice(0, 300)); },
      );
      console.log('finalResponse:', result.finalResponse);

      const notesFile = path.join(workspace, 'notes.json');
      expect(fs.existsSync(notesFile)).toBe(true);
      const notes = JSON.parse(fs.readFileSync(notesFile, 'utf-8'));
      expect(notes.some((note: any) => note.title?.includes('端到端验证'))).toBe(true);
    } finally {
      await runtime.close();
      await bridge.stop();
    }
  }, 300_000);
});
