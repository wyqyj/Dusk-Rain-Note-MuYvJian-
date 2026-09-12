import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { DocService, markdownToHtml, buildStyledHtml } from './docService';

describe('markdownToHtml / buildStyledHtml', () => {
  it('renders headings and emphasis', () => {
    const html = markdownToHtml('# 标题\n\n**重点** 与 *次要*。');
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<strong>重点</strong>');
    expect(html).toContain('<em>次要</em>');
  });

  it('wraps body html in a styled document with the title', () => {
    const html = buildStyledHtml('研究文档', '<h1>内容</h1>');
    expect(html).toContain('<title>研究文档</title>');
    expect(html).toContain('<h1>内容</h1>');
    expect(html).toContain('Microsoft YaHei');
  });
});

describe('DocService', () => {
  let root: string;
  let service: DocService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-doc-'));
    service = new DocService();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates a Word document readable back via mammoth', async () => {
    const outFile = path.join(root, 'docs', '复习提纲.docx');
    await service.createWord('复习提纲', '# 注意力机制\n\nTransformer 使用自注意力。', outFile);
    expect(fs.existsSync(outFile)).toBe(true);

    const data = await mammoth.extractRawText({ buffer: fs.readFileSync(outFile) });
    expect(data.value).toContain('复习提纲');
    expect(data.value).toContain('注意力机制');
    expect(data.value).toContain('Transformer');
  });

  it('creates an xlsx workbook with headers and rows', async () => {
    const outFile = path.join(root, 'docs', '术语表.xlsx');
    await service.createSheet('术语表', ['术语', '释义'], [
      ['过拟合', '训练误差低但泛化误差高'],
      ['注意力', '序列建模机制'],
    ], outFile);
    expect(fs.existsSync(outFile)).toBe(true);

    const workbook = XLSX.read(fs.readFileSync(outFile), { type: 'buffer' });
    expect(workbook.SheetNames[0]).toBe('术语表');
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0] as string], { header: 1 });
    expect(rows[0]).toEqual(['术语', '释义']);
    expect(rows[1]).toEqual(['过拟合', '训练误差低但泛化误差高']);
  });

  it('rejects PDF generation with a clear error outside Electron', async () => {
    const outFile = path.join(root, 'docs', '文档.pdf');
    await expect(service.createPdf('文档', '# 标题\n内容', outFile)).rejects.toThrow('PDF 生成需要 Electron 环境');
  });

  it('creates a pptx presentation as a valid zip package', async () => {
    const outFile = path.join(root, 'docs', '汇报.pptx');
    await service.createPpt('汇报', [
      { title: '第一页', content: '注意力机制综述' },
      { title: '第二页', content: 'Transformer 使用自注意力建模。' },
    ], outFile);
    expect(fs.existsSync(outFile)).toBe(true);
    const head = fs.readFileSync(outFile).subarray(0, 2).toString('latin1');
    expect(head).toBe('PK');
    const raw = fs.readFileSync(outFile);
    expect(raw.includes(Buffer.from('presentation.xml'))).toBe(true);
  });
});
