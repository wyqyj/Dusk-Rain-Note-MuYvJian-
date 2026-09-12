import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Document } from 'flexsearch';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';
import { enqueueFile, readJsonValue, writeAtomic } from './notesData';

export type ResearchDocType = 'pdf' | 'docx' | 'xlsx' | 'markdown' | 'text';

export interface ResearchDocMeta {
  id: string;
  fileName: string;
  relativePath: string;
  type: ResearchDocType;
  sizeBytes: number;
  mtimeMs: number;
  title: string;
  summary: string;
  keywords: string[];
  outline: string[];
  charCount: number;
  extractedAt: number;
}

export interface ResearchScanResult {
  scanned: number;
  parsed: number;
  unchanged: number;
  failed: number;
  documents: ResearchDocMeta[];
}

export interface ResearchSearchResult {
  docId: string;
  fileName: string;
  title: string;
  relativePath: string;
  snippet: string;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_CHARS = 2_000_000;
const MAX_SCAN_DEPTH = 10;
const SUMMARY_CHARS = 200;
const OUTLINE_LIMIT = 50;

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'release', 'release-temp', 'electron-dist-local',
  'resources', 'data', 'dsh-home', 'research-db', '.build-tools', '.codex', '.claude',
]);

const EXT_TYPE: Record<string, ResearchDocType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
};

function docIdFor(relativePath: string): string {
  return 'r' + crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 16);
}

export function extractTitle(text: string, fileName: string): string {
  const heading = text.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim().slice(0, 120);
  const line = text.split(/\r?\n/).map((item) => item.trim()).find((item) => item.length > 0);
  return ((line || '').replace(/^#+\s*/, '').slice(0, 120)) || fileName;
}

export function extractOutline(text: string): string[] {
  const outline: string[] = [];
  for (const match of text.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    const title = match[1]?.trim();
    if (title) outline.push(title.slice(0, 120));
    if (outline.length >= OUTLINE_LIMIT) break;
  }
  return outline;
}

export function extractSheetText(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    parts.push(`## ${name}\n${XLSX.utils.sheet_to_csv(sheet).trim()}`);
  }
  return parts.join('\n\n');
}

function makeSnippet(text: string, query: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const direct = trimmed.indexOf(query);
  const needle = direct >= 0
    ? query
    : (query.split(/\s+/).find((token) => token && trimmed.includes(token)) || '');
  const at = needle ? trimmed.indexOf(needle) : -1;
  if (at < 0) return trimmed.slice(0, 120);
  const start = Math.max(0, at - 60);
  return trimmed.slice(start, Math.min(trimmed.length, at + needle.length + 60));
}

export class ResearchService {
  private workspaceRootGetter: () => string;
  private index: any;
  private docsCache = new Map<string, { meta: ResearchDocMeta; text: string }>();
  private indexedStamp = '';

  constructor(workspaceRootGetter: () => string) {
    this.workspaceRootGetter = workspaceRootGetter;
    this.index = new Document({
      document: { id: 'id', index: ['content'] },
      tokenize: 'full',
    });
  }

  private get root(): string {
    return this.workspaceRootGetter();
  }

  private dbDir(): string {
    return path.join(this.root, 'research-db');
  }

  private textsDir(): string {
    return path.join(this.dbDir(), 'texts');
  }

  private indexFile(): string {
    return path.join(this.dbDir(), 'index.json');
  }

  private textFile(id: string): string {
    return path.join(this.textsDir(), `${id}.txt`);
  }

  private loadIndex(): Record<string, ResearchDocMeta> {
    const data = readJsonValue(this.indexFile(), {});
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, ResearchDocMeta>)
      : {};
  }

  listDocuments(): ResearchDocMeta[] {
    return Object.values(this.loadIndex())
      .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-Hans-CN'));
  }

  getDocumentSummary(id: string): ResearchDocMeta | null {
    return this.loadIndex()[id] || null;
  }

  readDocument(id: string, maxLength = 20_000): { meta: ResearchDocMeta; text: string } | null {
    const meta = this.loadIndex()[id];
    if (!meta) return null;
    let text = '';
    try {
      text = fs.readFileSync(this.textFile(id), 'utf-8');
    } catch {
      return null;
    }
    const body = text.length > maxLength ? `${text.slice(0, maxLength)}\n（已截断，全文见 research-db/texts）` : text;
    return { meta, text: body };
  }

  async scan(force = false): Promise<ResearchScanResult> {
    const candidates: Array<{
      abs: string;
      rel: string;
      type: ResearchDocType;
      size: number;
      mtime: number;
    }> = [];

    const walk = (dir: string, rel: string, depth: number): void => {
      if (depth > MAX_SCAN_DEPTH) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const abs = path.join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (EXCLUDED_DIRS.has(entry.name)) continue;
          walk(abs, relPath, depth + 1);
        } else if (entry.isFile()) {
          const type = EXT_TYPE[path.extname(entry.name).toLowerCase()];
          if (!type) continue;
          let stat;
          try {
            stat = fs.statSync(abs);
          } catch {
            continue;
          }
          if (stat.size > MAX_FILE_BYTES) continue;
          candidates.push({ abs, rel: relPath, type, size: stat.size, mtime: stat.mtimeMs });
        }
      }
    };
    walk(this.root, '', 0);

    const existing = this.loadIndex();
    const nextIndex: Record<string, ResearchDocMeta> = {};
    const documents: ResearchDocMeta[] = [];
    let parsed = 0;
    let unchanged = 0;
    let failed = 0;

    for (const candidate of candidates) {
      const id = docIdFor(candidate.rel);
      const prev = existing[id];
      if (!force && prev && prev.mtimeMs === candidate.mtime && prev.sizeBytes === candidate.size) {
        nextIndex[id] = prev;
        documents.push(prev);
        unchanged += 1;
        continue;
      }
      try {
        const buffer = fs.readFileSync(candidate.abs);
        let text = '';
        if (candidate.type === 'pdf') {
          const parser = new PDFParse({ data: buffer });
          try {
            const result = await parser.getText();
            text = result.text || '';
          } finally {
            await parser.destroy();
          }
        } else if (candidate.type === 'docx') {
          const data = await mammoth.extractRawText({ buffer });
          text = data.value || '';
        } else if (candidate.type === 'xlsx') {
          text = extractSheetText(buffer);
        } else {
          text = buffer.toString('utf-8');
        }
        if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);
        if (!text.trim()) throw new Error('无法提取文本内容');
        const fileName = path.basename(candidate.abs);
        const meta: ResearchDocMeta = {
          id,
          fileName,
          relativePath: candidate.rel,
          type: candidate.type,
          sizeBytes: candidate.size,
          mtimeMs: candidate.mtime,
          title: extractTitle(text, fileName),
          summary: text.trim().slice(0, SUMMARY_CHARS),
          keywords: [],
          outline: extractOutline(text),
          charCount: text.length,
          extractedAt: Date.now(),
        };
        nextIndex[id] = meta;
        documents.push(meta);
        parsed += 1;
        const textForFile = text;
        await enqueueFile(this.textFile(id), () => writeAtomic(this.textFile(id), textForFile));
      } catch {
        failed += 1;
      }
    }

    for (const id of Object.keys(existing)) {
      if (!nextIndex[id]) {
        try {
          fs.rmSync(this.textFile(id), { force: true });
        } catch {}
      }
    }

    await enqueueFile(this.indexFile(), () => writeAtomic(this.indexFile(), JSON.stringify(nextIndex, null, 2)));
    return { scanned: candidates.length, parsed, unchanged, failed, documents };
  }

  search(query: string, limit = 8): ResearchSearchResult[] {
    const q = (query || '').trim();
    if (!q) return [];
    const index = this.loadIndex();
    const stamp = Object.values(index).map((doc) => `${doc.id}:${doc.mtimeMs}:${doc.charCount}`).join('|');
    if (stamp !== this.indexedStamp) this.rebuildIndex(index, stamp);

    const fieldResults = this.index.search(q, { limit });
    const ids = new Set<string>();
    for (const field of fieldResults) {
      if (Array.isArray(field?.result)) {
        for (const id of field.result) ids.add(String(id));
      }
    }

    const results: ResearchSearchResult[] = [];
    for (const id of ids) {
      const meta = index[id];
      if (!meta) continue;
      const cached = this.docsCache.get(id);
      results.push({
        docId: id,
        fileName: meta.fileName,
        title: meta.title,
        relativePath: meta.relativePath,
        snippet: makeSnippet(cached?.text ?? '', q),
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  private rebuildIndex(index: Record<string, ResearchDocMeta>, stamp: string): void {
    this.index = new Document({
      document: { id: 'id', index: ['content'] },
      tokenize: 'full',
    });
    this.docsCache.clear();
    for (const meta of Object.values(index)) {
      let text = '';
      try {
        text = fs.readFileSync(this.textFile(meta.id), 'utf-8');
      } catch {
        continue;
      }
      this.docsCache.set(meta.id, { meta, text });
      this.index.add({ id: meta.id, content: text });
    }
    this.indexedStamp = stamp;
  }
}
