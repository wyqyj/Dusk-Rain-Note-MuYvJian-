import { describe, expect, it } from 'vitest';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { prepareSdkProfile } from './dshRuntime';

/**
 * 真实 dsh profile 冒烟（慢，会物化完整 sdk profile）：
 * `DSH_INTEGRATION=1 npm test` 时才执行。
 * 验证 prepareSdkProfile 的产物被 dsh 正确组合：插件挂载 + 危险工具禁用。
 */
const RUN = process.env.DSH_INTEGRATION === '1';

describe.skipIf(!RUN)('prepareSdkProfile（集成）', () => {
  it('生成 patch 并被 dsh 组合：插件挂载、危险工具禁用', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-dsh-'));
    const dshBin = require.resolve('@deepseek-ai/dsh/lib/bin.js');
    const pluginDir = path.join(__dirname, '..', '..', 'plugins', 'muyujian-dsh-tools');

    const args = await prepareSdkProfile(home, { nodeCommand: 'node', dshBin, pluginDir });
    expect(args[0]).toBe('--patch');
    expect(fs.existsSync(path.join(home, 'profiles', 'sdk', 'node_modules', 'muyujian-dsh-tools', 'index.js'))).toBe(true);

    const composed = await new Promise<string>((resolve, reject) => {
      execFile('node', [dshBin, '--profile', 'sdk', '--dump-config', ...args], {
        env: { ...process.env, DSH_HOME: home },
        maxBuffer: 32 * 1024 * 1024,
      }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    });
    expect(composed).toContain('muyujian-dsh-tools');
    for (const id of ['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-web']) {
      const row = composed.match(new RegExp(`id: ${id}[\\s\\S]{0,200}`));
      expect(row?.[0]).toContain('disabled: true');
    }
  }, 180_000);
});
