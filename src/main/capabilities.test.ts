import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createCapabilityRegistry } from './capabilities';

describe('capabilities knowledge bundle linkage', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-capabilities-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists knowledge bundles via knowledge.bundles', async () => {
    const bundle = { id: 'bundle-1', name: '数学包', description: '', sourceIds: [], createdAt: 1, updatedAt: 1 };
    fs.writeFileSync(path.join(root, 'knowledge-bundles.json'), JSON.stringify([bundle]));
    const registry = createCapabilityRegistry(() => root);
    const spec = registry.get('knowledge.bundles');
    expect(spec).toBeDefined();
    const result = await spec?.handler({});
    expect(result?.ok).toBe(true);
    expect(result?.bundles).toHaveLength(1);
  });

  it('scopes knowledge.search by the bundleId parameter', async () => {
    const qbDir = path.join(root, 'question-books', 'math-1000');
    fs.mkdirSync(qbDir, { recursive: true });
    fs.writeFileSync(path.join(qbDir, 'questions.md'), '# 数学一千题\n\n极限问题 lim sin(x)/x = 1');
    const kDir = path.join(root, 'knowledge');
    fs.mkdirSync(kDir, { recursive: true });
    fs.writeFileSync(path.join(kDir, 'english.txt'), 'abandon 放弃');

    const bundle = {
      id: 'bundle-1', name: '数学包', description: '',
      sourceIds: ['questionBook:math-1000'], createdAt: 1, updatedAt: 1,
    };
    fs.writeFileSync(path.join(root, 'knowledge-bundles.json'), JSON.stringify([bundle]));

    const search = createCapabilityRegistry(() => root).get('knowledge.search');
    expect(search).toBeDefined();

    // 无效 bundleId：只检索包内来源，返回空而不是全部
    const empty = await search?.handler({ query: '极限', bundleId: 'bundle-not-exist' });
    expect(empty?.results).toHaveLength(0);

    // 有效 bundleId：命中包内题册来源
    const hit = await search?.handler({ query: '极限', bundleId: 'bundle-1' });
    expect(hit?.results.length).toBeGreaterThan(0);
  });
});
