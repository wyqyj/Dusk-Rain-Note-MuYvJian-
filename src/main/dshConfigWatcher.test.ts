import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fingerprintConfig, startDshConfigWatcher } from './dshConfigWatcher';

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(poll, 40);
    };
    poll();
  });
}

const MINIMAL_SETTINGS = [
  'llm-pi-ai:',
  '  providers:',
  '    test-provider:',
  '      baseURL: https://example.test/v1',
  '      api: openai-completions',
  '      models:',
  '        - id: test-model',
  'agent-default-model:',
  '  provider: test-provider',
  '  model: test-model',
].join('\n');

describe('fingerprintConfig', () => {
  it('is empty for missing config and distinct for changed values', () => {
    expect(fingerprintConfig(null)).toBe('');
    const base = { baseUrl: 'https://a/v1', model: 'm1', providerId: 'p', apiKey: null };
    expect(fingerprintConfig(base)).toBe('https://a/v1|m1|p|');
    expect(fingerprintConfig({ ...base, model: 'm2' })).not.toBe(fingerprintConfig(base));
    expect(fingerprintConfig({ ...base, apiKey: 'k' })).not.toBe(fingerprintConfig(base));
  });
});

describe('startDshConfigWatcher', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-dsh-home-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('fires onChange when settings.yaml introduces a valid config', async () => {
    let fired = 0;
    const stop = startDshConfigWatcher({ homeDir: home, onChange: () => { fired += 1; }, debounceMs: 60 });
    try {
      fs.writeFileSync(path.join(home, 'settings.yaml'), MINIMAL_SETTINGS, 'utf-8');
      await waitFor(() => fired > 0, 2500);
      expect(fired).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });

  it('does not fire when config files do not change', async () => {
    let fired = 0;
    const stop = startDshConfigWatcher({ homeDir: home, onChange: () => { fired += 1; }, debounceMs: 60 });
    try {
      fs.writeFileSync(path.join(home, 'unrelated.txt'), 'noise', 'utf-8');
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(fired).toBe(0);
    } finally {
      stop();
    }
  });
});
