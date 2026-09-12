import * as fs from "fs";
import * as path from "path";
import { Document } from "flexsearch";
import { readJsonValue } from "./notesData";

export type KnowledgeSourceType = "note" | "questionBook" | "file";

export interface KnowledgeSourceRef {
  type: KnowledgeSourceType;
  id: string;
  title: string;
}

export interface KnowledgeChunk {
  id: string;
  source: KnowledgeSourceRef;
  content: string;
  chunkIndex: number;
  [key: string]: unknown;
}

export interface KnowledgeSearchResult {
  chunkId: string;
  text: string;
  source: KnowledgeSourceRef;
  score?: number;
}

export interface KnowledgeBundle {
  id: string;
  name: string;
  description?: string;
  sourceIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeSourceItem {
  id: string;
  type: KnowledgeSourceType;
  title: string;
  count?: number;
  mtime?: number;
}

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;

export function splitIntoChunks(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= chunkSize) return [trimmed];

  const paragraphs = trimmed.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) continue;
    if (!current) {
      current = p;
    } else if (current.length + p.length + 2 <= chunkSize) {
      current += "\n\n" + p;
    } else {
      chunks.push(current);
      if (current.length > overlap) {
        current = current.slice(current.length - overlap) + "\n\n" + p;
      } else {
        current = p;
      }
    }
  }
  if (current) {
    chunks.push(current);
  }

  // 兜底：处理超长单段落
  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= chunkSize + overlap) {
      result.push(chunk);
    } else {
      let start = 0;
      while (start < chunk.length) {
        result.push(chunk.slice(start, start + chunkSize));
        start += chunkSize - overlap;
      }
    }
  }
  return result;
}

export class KnowledgeService {
  private workspaceRootGetter: () => string;
  private index: any;
  private chunksMap = new Map<string, KnowledgeChunk>();
  private sourceMtimes = new Map<string, number>();

  constructor(workspaceRootGetter: () => string) {
    this.workspaceRootGetter = workspaceRootGetter;
    this.index = new Document({
      document: {
        id: "id",
        index: ["content"],
      },
      tokenize: "full",
    });
  }

  private get root(): string {
    return this.workspaceRootGetter();
  }

  private notesFile(): string {
    return path.join(this.root, "notes.json");
  }

  private bundlesFile(): string {
    return path.join(this.root, "knowledge-bundles.json");
  }

  private questionBooksDir(): string {
    return path.join(this.root, "question-books");
  }

  private knowledgeDir(): string {
    return path.join(this.root, "knowledge");
  }

  /** 列出工作区已创建的所有知识库打包（Bundles） */
  listBundles(): KnowledgeBundle[] {
    try {
      const data = readJsonValue(this.bundlesFile(), []);
      if (Array.isArray(data)) {
        return data.filter((b) => b && typeof b.id === "string" && typeof b.name === "string");
      }
    } catch {}
    return [];
  }

  /** 保存或更新一个打包知识库 */
  saveBundle(bundle: { id?: string; name: string; description?: string; sourceIds: string[] }): KnowledgeBundle {
    const now = Date.now();
    const bundles = this.listBundles();
    const id = bundle.id || ("bundle-" + now.toString(36) + "-" + Math.random().toString(36).slice(2, 6));
    const existingIndex = bundles.findIndex((b) => b.id === id);
    const updated: KnowledgeBundle = {
      id,
      name: bundle.name.trim() || "未命名知识库包",
      description: bundle.description?.trim() || "",
      sourceIds: Array.isArray(bundle.sourceIds) ? Array.from(new Set(bundle.sourceIds)) : [],
      createdAt: existingIndex >= 0 ? bundles[existingIndex].createdAt : now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      bundles[existingIndex] = updated;
    } else {
      bundles.unshift(updated);
    }

    fs.writeFileSync(this.bundlesFile(), JSON.stringify(bundles, null, 2), "utf-8");
    return updated;
  }

  /** 删除打包知识库 */
  deleteBundle(id: string): boolean {
    const bundles = this.listBundles();
    const filtered = bundles.filter((b) => b.id !== id);
    if (filtered.length === bundles.length) return false;
    fs.writeFileSync(this.bundlesFile(), JSON.stringify(filtered, null, 2), "utf-8");
    return true;
  }

  /** 展开 bundleIds 包含的所有源 ID */
  resolveBundleSourceIds(bundleIds: string[]): string[] {
    const bundles = this.listBundles().filter((b) => bundleIds.includes(b.id));
    const set = new Set<string>();
    bundles.forEach((b) => b.sourceIds.forEach((sid) => set.add(sid)));
    return Array.from(set);
  }

  /** 列出工作区内可作为知识库来源的所有数据项 */
  listAvailableSources(): KnowledgeSourceItem[] {
    const items: KnowledgeSourceItem[] = [];

    // 1. 笔记
    try {
      const notes = readJsonValue(this.notesFile(), []);
      if (Array.isArray(notes)) {
        for (const note of notes) {
          if (note && !note.deleted && !note.inTrash && note.id) {
            items.push({
              id: "note:" + note.id,
              type: "note",
              title: note.title || "未命名笔记",
              mtime: Number(note.updatedAt) || 0,
            });
          }
        }
      }
    } catch {}

    // 2. 题册
    try {
      const qbDir = this.questionBooksDir();
      if (fs.existsSync(qbDir)) {
        const entries = fs.readdirSync(qbDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const stat = fs.statSync(path.join(qbDir, entry.name));
            items.push({
              id: "questionBook:" + entry.name,
              type: "questionBook",
              title: entry.name,
              mtime: stat.mtimeMs,
            });
          }
        }
      }
    } catch {}

    // 3. 知识库外部导入文件 (knowledge/ 目录)
    try {
      const kDir = this.knowledgeDir();
      if (fs.existsSync(kDir)) {
        const files = fs.readdirSync(kDir, { withFileTypes: true });
        for (const file of files) {
          if (file.isFile()) {
            const stat = fs.statSync(path.join(kDir, file.name));
            items.push({
              id: "file:" + file.name,
              type: "file",
              title: file.name,
              mtime: stat.mtimeMs,
            });
          }
        }
      }
    } catch {}

    return items;
  }

  /** 同步/增量更新指定或选中的来源索引 */
  syncSources(sourceIds?: string[]): void {
    const allAvailable = this.listAvailableSources();
    const targetSources = sourceIds && sourceIds.length > 0
      ? allAvailable.filter((s) => sourceIds.includes(s.id))
      : allAvailable;

    for (const src of targetSources) {
      const lastMtime = this.sourceMtimes.get(src.id);
      if (lastMtime && src.mtime && lastMtime >= src.mtime) {
        continue;
      }
      this.indexSource(src);
    }
  }

  /** 索引单个来源 */
  private indexSource(src: KnowledgeSourceItem): void {
    this.removeSource(src.id);

    let textContent = "";
    const ref: KnowledgeSourceRef = {
      type: src.type,
      id: src.id,
      title: src.title,
    };

    if (src.type === "note") {
      const noteId = src.id.replace(/^note:/, "");
      const notes = readJsonValue(this.notesFile(), []);
      if (Array.isArray(notes)) {
        const n = notes.find((item: any) => item?.id === noteId);
        if (n) {
          textContent = (n.title || "") + "\n\n" + (n.content || "");
        }
      }
    } else if (src.type === "questionBook") {
      const folder = src.id.replace(/^questionBook:/, "");
      const qPath = path.join(this.questionBooksDir(), folder, "questions.md");
      if (fs.existsSync(qPath)) {
        try {
          textContent = fs.readFileSync(qPath, "utf-8");
        } catch {}
      }
    } else if (src.type === "file") {
      const filename = src.id.replace(/^file:/, "");
      const fPath = path.join(this.knowledgeDir(), filename);
      if (fs.existsSync(fPath)) {
        try {
          textContent = fs.readFileSync(fPath, "utf-8");
        } catch {}
      }
    }

    if (!textContent.trim()) {
      this.sourceMtimes.set(src.id, src.mtime || Date.now());
      return;
    }

    const chunks = splitIntoChunks(textContent);
    chunks.forEach((chunkText, idx) => {
      const chunkId = src.id + "#c" + idx;
      const chunkObj: KnowledgeChunk = {
        id: chunkId,
        source: ref,
        content: chunkText,
        chunkIndex: idx,
      };
      this.chunksMap.set(chunkId, chunkObj);
      this.index.add(chunkObj);
    });

    this.sourceMtimes.set(src.id, src.mtime || Date.now());
  }

  /** 移除单个来源已索引的 chunks */
  removeSource(sourceId: string): void {
    const toRemove: string[] = [];
    for (const [chunkId, chunk] of this.chunksMap.entries()) {
      if (chunk.source.id === sourceId) {
        toRemove.push(chunkId);
      }
    }
    for (const id of toRemove) {
      this.chunksMap.delete(id);
      this.index.remove(id);
    }
    this.sourceMtimes.delete(sourceId);
  }

  /** 全文检索 */
  search(query: string, options?: { sourceIds?: string[]; bundleIds?: string[]; limit?: number }): KnowledgeSearchResult[] {
    const q = (query || "").trim();
    if (!q) return [];
    const limit = options?.limit ?? 6;

    // 合并显式传入的 sourceIds 与从 bundleIds 解析出的 sourceIds
    let effectiveSourceIds: string[] | undefined = undefined;
    const sourceIdSet = new Set<string>();
    const hadExplicitFilter = (options?.sourceIds && options.sourceIds.length > 0)
      || (options?.bundleIds && options.bundleIds.length > 0);
    if (options?.sourceIds && options.sourceIds.length > 0) {
      options.sourceIds.forEach((id) => sourceIdSet.add(id));
    }
    if (options?.bundleIds && options.bundleIds.length > 0) {
      const bundleSources = this.resolveBundleSourceIds(options.bundleIds);
      bundleSources.forEach((id) => sourceIdSet.add(id));
    }
    if (sourceIdSet.size > 0) {
      effectiveSourceIds = Array.from(sourceIdSet);
    } else if (hadExplicitFilter) {
      // 显式给了过滤条件但解析不到任何来源：返回空而不是检索全部
      effectiveSourceIds = ["__none__"];
    }

    // 确保涉及的来源有同步
    if (effectiveSourceIds && effectiveSourceIds.length > 0) {
      this.syncSources(effectiveSourceIds);
    } else {
      this.syncSources();
    }

    const searchResults = this.index.search(q, { limit: limit * 3 });
    const matchedIds = new Set<string>();

    for (const res of searchResults) {
      if (Array.isArray(res.result)) {
        for (const id of res.result) {
          matchedIds.add(String(id));
        }
      }
    }

    const results: KnowledgeSearchResult[] = [];
    for (const id of matchedIds) {
      const chunk = this.chunksMap.get(id);
      if (!chunk) continue;
      if (effectiveSourceIds && effectiveSourceIds.length > 0 && !effectiveSourceIds.includes(chunk.source.id)) {
        continue;
      }
      results.push({
        chunkId: chunk.id,
        text: chunk.content,
        source: chunk.source,
      });
      if (results.length >= limit) break;
    }

    return results;
  }
}
