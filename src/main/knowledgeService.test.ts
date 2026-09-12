import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KnowledgeService, splitIntoChunks } from './knowledgeService';

describe('splitIntoChunks', () => {
  it('returns empty array for empty string', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks('   \n  ')).toEqual([]);
  });

  it('returns single chunk when text is short', () => {
    const text = '这是简短的一段考研笔记。';
    expect(splitIntoChunks(text, 100)).toEqual([text]);
  });

  it('splits paragraphs when text exceeds chunk size', () => {
    const para1 = '第一段文字。'.repeat(10);
    const para2 = '第二段文字。'.repeat(10);
    const text = para1 + "\n\n" + para2;
    const chunks = splitIntoChunks(text, 50, 10);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('KnowledgeService', () => {
  let root: string;
  let service: KnowledgeService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-knowledge-'));
    service = new KnowledgeService(() => root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('indexes and searches notes', () => {
    const notes = [
      { id: 'note-1', title: '高等数学导数', content: '函数在某点的导数反映了函数的变化率。' },
      { id: 'note-2', title: '线性代数矩阵', content: '特征值与特征向量是矩阵的重要特征。' },
    ];
    fs.writeFileSync(path.join(root, 'notes.json'), JSON.stringify(notes));

    const sources = service.listAvailableSources();
    expect(sources.length).toBe(2);
    expect(sources.map((s) => s.id)).toContain('note:note-1');

    const res = service.search('导数');
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].source.id).toBe('note:note-1');
    expect(res[0].text).toContain('变化率');
  });

  it('indexes and searches question books', () => {
    const qbDir = path.join(root, 'question-books', 'math-1000');
    fs.mkdirSync(qbDir, { recursive: true });
    fs.writeFileSync(path.join(qbDir, 'questions.md'), '# 考研数学一千题\n\n求极限问题 lim(x->0) sin(x)/x = 1');

    const sources = service.listAvailableSources();
    expect(sources.some((s) => s.type === 'questionBook')).toBe(true);

    const res = service.search('极限');
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].source.type).toBe('questionBook');
    expect(res[0].text).toContain('sin(x)/x');
  });

  it('indexes and searches knowledge/ files', () => {
    const kDir = path.join(root, 'knowledge');
    fs.mkdirSync(kDir, { recursive: true });
    fs.writeFileSync(path.join(kDir, 'english-words.txt'), 'abandon 放弃\nabundant 丰富的');

    const sources = service.listAvailableSources();
    expect(sources.some((s) => s.type === 'file')).toBe(true);

    const res = service.search('放弃');
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].source.type).toBe('file');
    expect(res[0].text).toContain('abandon');
  });

  it('filters search by specified sourceIds', () => {
    const notes = [
      { id: 'n1', title: '政治马原', content: '唯物辩证法三大规律' },
      { id: 'n2', title: '政治毛中特', content: '新时代中国特色社会主义思想' },
    ];
    fs.writeFileSync(path.join(root, 'notes.json'), JSON.stringify(notes));

    const res = service.search('政治', { sourceIds: ['note:n1'] });
    expect(res.length).toBe(1);
    expect(res[0].source.id).toBe('note:n1');
  });

  it('handles empty results and empty query gracefully', () => {
    expect(service.search('')).toEqual([]);
    expect(service.search('   ')).toEqual([]);
    expect(service.search('一个完全不存在的专有名词abcdefg')).toEqual([]);
  });

  it('manages knowledge bundles and searches through bundles', () => {
    const notes = [
      { id: 'n1', title: '马原绪论', content: '马克思主义是科学的世界观和方法论。' },
      { id: 'n2', title: '毛中特第一章', content: '毛泽东思想活的灵魂实事求是。' },
    ];
    fs.writeFileSync(path.join(root, 'notes.json'), JSON.stringify(notes));

    // 创建 Bundle
    const bundle = service.saveBundle({
      name: '政治基础包',
      description: '马原和毛中特考研政治基础',
      sourceIds: ['note:n1', 'note:n2'],
    });
    expect(bundle.id).toBeDefined();
    expect(bundle.name).toBe('政治基础包');

    const list = service.listBundles();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(bundle.id);

    // 搜索指定 bundleId
    const res = service.search('马克思主义', { bundleIds: [bundle.id] });
    expect(res.length).toBe(1);
    expect(res[0].source.id).toBe('note:n1');

    // 删除 Bundle
    expect(service.deleteBundle(bundle.id)).toBe(true);
    expect(service.listBundles().length).toBe(0);
  });
});
