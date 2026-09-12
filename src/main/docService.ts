import * as fs from 'fs';
import * as path from 'path';
import MarkdownIt from 'markdown-it';
import HTMLToDOCX from 'html-to-docx';
import * as XLSX from 'xlsx';
import { enqueueFile } from './notesData';

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

export function markdownToHtml(content: string): string {
  return md.render(content || '');
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

export function buildStyledHtml(title: string, bodyHtml: string): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    "body { font-family: 'Microsoft YaHei', 'Noto Sans CJK SC', 'PingFang SC', sans-serif; margin: 48px; line-height: 1.6; color: #1f2430; }",
    'h1, h2, h3, h4 { line-height: 1.3; }',
    'code { background: #f2f3f5; padding: 2px 6px; border-radius: 4px; }',
    'pre { background: #f2f3f5; padding: 16px; border-radius: 6px; overflow-x: auto; }',
    'table { border-collapse: collapse; }',
    'th, td { border: 1px solid #c9cdd4; padding: 6px 10px; }',
    'blockquote { border-left: 3px solid #c9cdd4; margin-left: 0; padding-left: 12px; color: #5a6072; }',
    '</style>',
    '</head>',
    `<body>${bodyHtml}</body>`,
    '</html>',
  ].join('\n');
}

function sheetNameFor(title: string): string {
  const name = title.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31);
  return name || 'Sheet1';
}

export class DocService {
  async createWord(title: string, content: string, outFile: string): Promise<void> {
    const body = title.trim() ? `<h1>${escapeHtml(title.trim())}</h1>\n${markdownToHtml(content)}` : markdownToHtml(content);
    const buffer = await HTMLToDOCX(body, null, { footer: true, pageNumber: true });
    await enqueueFile(outFile, () => {
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, buffer);
    });
  }

  async createSheet(title: string, headers: string[], rows: unknown[][], outFile: string): Promise<void> {
    const data: unknown[][] = [];
    if (headers.length > 0) data.push(headers);
    for (const row of rows) {
      data.push(row.map((cell) => (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean' ? cell : String(cell ?? ''))));
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), sheetNameFor(title));
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    await enqueueFile(outFile, () => {
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, buffer);
    });
  }

  async createPdf(title: string, content: string, outFile: string): Promise<void> {
    const electron = (await import('electron')) as unknown as Record<string, unknown>;
    const BrowserWindow = electron.BrowserWindow;
    if (typeof BrowserWindow !== 'function') {
      throw new Error('PDF 生成需要 Electron 环境（printToPDF）');
    }
    const html = buildStyledHtml(title, markdownToHtml(content));
    const tmpHtml = `${outFile}.tmp.html`;
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(tmpHtml, html, 'utf-8');
    try {
      const WindowCtor = BrowserWindow as unknown as new (options: unknown) => {
        loadFile(file: string): Promise<void>;
        webContents: { printToPDF(options?: unknown): Promise<Buffer> };
        destroy(): void;
      };
      const win = new WindowCtor({
        show: false,
        width: 794,
        height: 1123,
        webPreferences: { offscreen: true, javascript: false },
      });
      try {
        await win.loadFile(tmpHtml);
        const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
        await enqueueFile(outFile, () => fs.writeFileSync(outFile, data));
      } finally {
        win.destroy();
      }
    } finally {
      try {
        fs.rmSync(tmpHtml, { force: true });
      } catch {}
    }
  }
}
