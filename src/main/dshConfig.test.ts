import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readHarnessModelConfig, seedHarnessModelConfig, upsertHarnessModelConfig } from './dshConfig';

let homeDir = '';

beforeEach(() => { homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-dshconfig-')); });
afterEach(() => { fs.rmSync(homeDir, { recursive: true, force: true }); });

describe('dshConfig', () => {
  it('播种后可读回 baseUrl / model / apiKey', () => {
    expect(seedHarnessModelConfig(homeDir, { baseUrl: 'https://gw.example.com/v1', model: 'kimi-k3', apiKey: 'sk-test' })).toBe(true);
    const config = readHarnessModelConfig(homeDir);
    expect(config).toEqual({ baseUrl: 'https://gw.example.com/v1', model: 'kimi-k3', providerId: 'muyujian-gateway', apiKey: 'sk-test' });
  });

  it('播种不覆盖用户已有配置（含用户在 GUI 里改过的默认模型）', () => {
    seedHarnessModelConfig(homeDir, { baseUrl: 'https://gw.example.com/v1', model: 'kimi-k3', apiKey: 'sk-old' });
    upsertHarnessModelConfig(homeDir, { baseUrl: 'https://gw2.example.com/v1', model: 'deepseek-v4' });
    // 第二次播种（比如应用升级后再启动）不能回写旧值
    expect(seedHarnessModelConfig(homeDir, { baseUrl: 'https://gw.example.com/v1', model: 'kimi-k3', apiKey: 'sk-old' })).toBe(false);
    const config = readHarnessModelConfig(homeDir);
    expect(config?.baseUrl).toBe('https://gw2.example.com/v1');
    expect(config?.model).toBe('deepseek-v4');
    expect(config?.apiKey).toBe('sk-old');
  });

  it('upsert 覆盖凭据；clearApiKey 删除凭据', () => {
    upsertHarnessModelConfig(homeDir, { baseUrl: 'https://gw.example.com/v1', model: 'm1', apiKey: 'sk-1' });
    upsertHarnessModelConfig(homeDir, { baseUrl: 'https://gw.example.com/v1', model: 'm2', apiKey: 'sk-2' });
    expect(readHarnessModelConfig(homeDir)?.apiKey).toBe('sk-2');
    upsertHarnessModelConfig(homeDir, { baseUrl: 'https://gw.example.com/v1', model: 'm2', clearApiKey: true });
    expect(readHarnessModelConfig(homeDir)?.apiKey).toBeNull();
  });

  it('settings.yaml 缺失或为空时读取返回 null，不抛错', () => {
    expect(readHarnessModelConfig(homeDir)).toBeNull();
    fs.writeFileSync(path.join(homeDir, 'settings.yaml'), 'not: [valid');
    expect(readHarnessModelConfig(homeDir)).toBeNull();
  });
});
