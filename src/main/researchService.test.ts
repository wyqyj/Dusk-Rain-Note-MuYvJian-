import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { ResearchService, extractTitle, extractOutline } from './researchService';

describe('extractTitle / extractOutline', () => {
  it('prefers the first markdown heading as title', () => {
    expect(extractTitle('# 注意力机制\n\n正文', 'paper.md')).toBe('注意力机制');
  });

  it('falls back to first non-empty line then filename', () => {
    expect(extractTitle('第一行文字\n第二行', 'doc.txt')).toBe('第一行文字');
    expect(extractTitle('   \n ', '资料.md')).toBe('资料.md');
  });

  it('extracts headings as outline with limit', () => {
    const text = '# 一\n## 二\n### 三\n' + '## 标题\n'.repeat(60);
    expect(extractOutline(text)).toHaveLength(50);
  });
});

describe('ResearchService', () => {
  let root: string;
  let service: ResearchService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-research-'));
    service = new ResearchService(() => root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('scans markdown/text files into research-db and supports list/search/read/summary', async () => {
    fs.mkdirSync(path.join(root, 'papers'), { recursive: true });
    fs.writeFileSync(path.join(root, 'papers', 'attention.md'), '# 注意力机制综述\n\nTransformer 使用自注意力对序列建模。');
    fs.writeFileSync(path.join(root, 'notes.txt'), '随机梯度下降是深度学习常用的优化算法。');

    const result = await service.scan();
    expect(result.scanned).toBe(2);
    expect(result.parsed).toBe(2);
    expect(fs.existsSync(path.join(root, 'research-db', 'index.json'))).toBe(true);

    const docs = service.listDocuments();
    expect(docs).toHaveLength(2);
    const attention = docs.find((doc) => doc.fileName === 'attention.md');
    expect(attention?.title).toBe('注意力机制综述');
    expect(attention?.outline).toContain('注意力机制综述');

    const hits = service.search('自注意力');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.fileName).toBe('attention.md');
    expect(hits[0]?.snippet).toContain('自注意力');

    const read = service.readDocument(attention?.id ?? '');
    expect(read?.text).toContain('Transformer');
    expect(service.getDocumentSummary(attention?.id ?? '')?.summary).toContain('Transformer');
  });

  it('skips excluded directories and unsupported extensions', async () => {
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'readme.md'), '# 依赖包说明');
    fs.writeFileSync(path.join(root, 'image.png'), 'not-a-document');
    fs.writeFileSync(path.join(root, 'readme.md'), '# 根目录说明');

    const result = await service.scan();
    expect(result.scanned).toBe(1);
    expect(service.listDocuments()[0]?.title).toBe('根目录说明');
  });

  it('reuses unchanged documents on the second scan', async () => {
    fs.writeFileSync(path.join(root, 'a.md'), '# 文档A\n内容甲。');
    const first = await service.scan();
    expect(first.parsed).toBe(1);
    const second = await service.scan();
    expect(second.unchanged).toBe(1);
    expect(second.parsed).toBe(0);
  });

  it('reparses changed files and prunes removed ones', async () => {
    const file = path.join(root, 'b.md');
    fs.writeFileSync(file, '# 旧标题\n旧内容。');
    await service.scan();

    fs.writeFileSync(file, '# 新标题\n新内容乙丙丁。');
    const rescan = await service.scan();
    expect(rescan.parsed).toBe(1);
    expect(service.listDocuments()[0]?.title).toBe('新标题');

    fs.rmSync(file);
    const after = await service.scan();
    expect(after.documents).toHaveLength(0);
    expect(service.listDocuments()).toHaveLength(0);
  });

  it('parses xlsx workbooks into searchable text', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['术语', '释义'],
      ['过拟合', '训练误差低但泛化误差高'],
    ]), '术语表');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    fs.writeFileSync(path.join(root, 'glossary.xlsx'), buffer);

    await service.scan();
    const doc = service.listDocuments()[0];
    expect(doc?.type).toBe('xlsx');
    const hits = service.search('过拟合');
    expect(hits.length).toBeGreaterThan(0);
  });
});
