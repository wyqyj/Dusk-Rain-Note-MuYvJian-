import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getPreset, PRESETS, buildPresetPatch } from './dshPreset';

describe('dshPreset', () => {
  it('returns default preset when unknown or undefined', () => {
    expect(getPreset().id).toBe('muyujian');
    expect(getPreset('unknown').id).toBe('muyujian');
  });

  it('returns research preset when requested', () => {
    const p = getPreset('research');
    expect(p.id).toBe('research');
    expect(p.label).toContain('研究');
    expect(p.systemPrompt).toContain('学术研究助手');
  });

  it('builds preset patch file successfully', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-test-'));
    try {
      const patch = buildPresetPatch(tmp, 'research');
      expect(fs.existsSync(patch)).toBe(true);
      const content = fs.readFileSync(patch, 'utf-8');
      expect(content).toContain('muyujian-tools');
      expect(content).toContain('研究预设');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
