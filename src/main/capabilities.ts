import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeService } from './knowledgeService';
import { ResearchService } from './researchService';
import { DocService } from './docService';
import { enqueueFile, readJsonValue, sanitizeNoteUpdates, writeAtomic } from './notesData';

/**
 * 共享能力层（Capabilities）。
 *
 * Agent Bridge（HTTP 通道）与内置 Agent（dsh 工具通道）共用同一份能力定义：
 * - `handler` 是唯一的数据语义实现，写路径全走 `enqueueFile` 串行队列。
 * - `description` / `inputSchema` 供 LLM function calling（dsh 工具注册）使用。
 * - `sideEffect` 供确认闸门判断：write 需用户确认，read 直接放行。
 *
 * 安全约束与原 agentBridge 一致：不暴露删除、导出备份、AI Key 等能力。
 */

export type CapabilityResult = { ok: boolean; [key: string]: unknown };
export type CapabilityHandler = (params: Record<string, unknown>) => Promise<CapabilityResult> | CapabilityResult;

export interface CapabilitySpec {
  /** 能力名，如 notes.create */
  name: string;
  /** 展示给模型的功能描述 */
  description: string;
  /** 参数的 JSON Schema（object 根），供 function calling 使用 */
  inputSchema: Record<string, unknown>;
  /** 'read' 无需确认；'write' 在内置 Agent 通道需用户确认 */
  sideEffect: 'read' | 'write';
  handler: CapabilityHandler;
}

export const MAX_NOTE_CONTENT = 100_000;
export const MAX_IMPORT_BYTES = 512 * 1024;

/** 规范化文件名为安全片段（只允许一层，无路径分隔符）。 */
function safeName(input: string): string {
  return input.replace(/[<>:"/\\|?*\x00-\x1f\s]/g, '_').slice(0, 80) || 'untitled';
}

function noteSummary(note: Record<string, unknown>): Record<string, unknown> {
  return {
    id: note.id,
    title: note.title ?? '',
    noteType: note.noteType ?? 'note',
    category: note.category ?? '',
    updatedAt: note.updatedAt ?? 0,
  };
}

/**
 * 构建全部白名单能力。`workspaceRoot` 惰性取值，跟随工作区切换。
 */
export function createCapabilityRegistry(workspaceRoot: () => string): Map<string, CapabilitySpec> {
  const knowledgeService = new KnowledgeService(workspaceRoot);
  const researchService = new ResearchService(workspaceRoot);
  const docService = new DocService();
  const notesFile = (): string => path.join(workspaceRoot(), 'notes.json');
  const stateFile = (): string => path.join(workspaceRoot(), 'workspace.json');
  const questionBooksDir = (): string => path.join(workspaceRoot(), 'question-books');

  const registry = new Map<string, CapabilitySpec>();
  const add = (spec: CapabilitySpec) => registry.set(spec.name, spec);

  add({
    name: 'workspace.status',
    description: '获取工作台概览：根目录、笔记数、题册数、任务数。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    sideEffect: 'read',
    handler: () => {
      const root = workspaceRoot();
      const notes = readJsonValue(notesFile(), []);
      const state = readJsonValue(stateFile(), {}) as Record<string, unknown>;
      let books = 0;
      try { books = fs.readdirSync(questionBooksDir()).length; } catch {}
      return { ok: true, root, notes: Array.isArray(notes) ? notes.length : 0, questionBooks: books, tasks: Array.isArray(state?.tasks) ? (state.tasks as unknown[]).length : 0 };
    },
  });

  add({
    name: 'notes.list',
    description: '列出所有有效笔记的摘要（不含回收站与已删除项）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    sideEffect: 'read',
    handler: () => {
      const notes = readJsonValue(notesFile(), []);
      const list = Array.isArray(notes) ? notes.filter((n: any) => n && !n.deleted && !n.inTrash).map(noteSummary) : [];
      return { ok: true, notes: list };
    },
  });

  add({
    name: 'notes.get',
    description: '按 id 读取一条笔记的完整内容。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '笔记 id' } },
      required: ['id'],
      additionalProperties: false,
    },
    sideEffect: 'read',
    handler: (params) => {
      const id = String(params.id || '');
      if (!id) throw new Error('缺少参数 id');
      const notes = readJsonValue(notesFile(), []);
      const note = Array.isArray(notes) ? notes.find((n: any) => n?.id === id) : null;
      if (!note) return { ok: false, error: '未找到该笔记' };
      return { ok: true, note };
    },
  });

  add({
    name: 'notes.create',
    description: '新建一条笔记或待办。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '标题（最长 120 字符）' },
        content: { type: 'string', description: '正文内容' },
        category: { type: 'string', description: '分类（最长 40 字符）' },
        noteType: { type: 'string', enum: ['note', 'todo'], description: '笔记或待办' },
      },
      additionalProperties: false,
    },
    sideEffect: 'write',
    handler: async (params) => {
      const content = String(params.content ?? '');
      const title = String(params.title ?? '').slice(0, 120) || '未命名笔记';
      if (content.length > MAX_NOTE_CONTENT) throw new Error('内容超过 100,000 字符上限');
      const now = Date.now();
      const note = {
        id: `agent-${now.toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
        title, content,
        noteType: params.noteType === 'todo' ? 'todo' : 'note',
        category: typeof params.category === 'string' ? params.category.slice(0, 40) : '',
        tags: [], pinned: false, createdAt: now, updatedAt: now,
      };
      await enqueueFile(notesFile(), () => {
        const disk = readJsonValue(notesFile(), []);
        const list = Array.isArray(disk) ? disk : [];
        writeAtomic(notesFile(), JSON.stringify([note, ...list], null, 2));
      });
      return { ok: true, id: note.id };
    },
  });

  add({
    name: 'notes.update',
    description: '更新一条笔记的标题、正文或分类。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '笔记 id' },
        title: { type: 'string' },
        content: { type: 'string' },
        category: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    sideEffect: 'write',
    handler: async (params) => {
      const id = String(params.id || '');
      if (!id) throw new Error('缺少参数 id');
      // 兼容 { updates: {...} } 与扁平字段两种传法
      const raw = (params.updates && typeof params.updates === 'object')
        ? params.updates
        : { title: params.title, content: params.content, category: params.category };
      const updates = sanitizeNoteUpdates(raw);
      for (const key of Object.keys(updates)) {
        if (typeof updates[key] === 'string' && (updates[key] as string).length > MAX_NOTE_CONTENT) throw new Error(`字段 ${key} 超出长度上限`);
      }
      let found = false;
      await enqueueFile(notesFile(), () => {
        const disk = readJsonValue(notesFile(), []);
        const list = (Array.isArray(disk) ? disk : []) as Record<string, unknown>[];
        const next = list.map((note) => {
          if (note?.id !== id) return note;
          found = true;
          return { ...note, ...updates, id, updatedAt: Date.now() };
        });
        if (found) writeAtomic(notesFile(), JSON.stringify(next, null, 2));
      });
      return found ? { ok: true } : { ok: false, error: '未找到该笔记' };
    },
  });

  add({
    name: 'plan.list',
    description: '列出复习计划中的全部任务。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    sideEffect: 'read',
    handler: () => {
      const state = readJsonValue(stateFile(), {}) as { tasks?: unknown[] };
      return { ok: true, tasks: Array.isArray(state?.tasks) ? state.tasks : [] };
    },
  });

  add({
    name: 'plan.addTask',
    description: '向复习计划添加一个任务。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题（必填）' },
        subject: { type: 'string', description: '科目（最长 20 字符）' },
        date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    sideEffect: 'write',
    handler: async (params) => {
      const title = String(params.title || '').trim();
      if (!title) throw new Error('缺少参数 title');
      if (title.length > 200) throw new Error('任务标题过长');
      const today = new Date().toISOString().slice(0, 10);
      const taskId = `agent-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
      await enqueueFile(stateFile(), () => {
        const state = (readJsonValue(stateFile(), {}) || {}) as Record<string, unknown>;
        const tasks = Array.isArray(state.tasks) ? state.tasks : [];
        state.tasks = [...tasks, {
          id: taskId,
          title, subject: typeof params.subject === 'string' ? params.subject.slice(0, 20) : '综合',
          date: typeof params.date === 'string' ? params.date.slice(0, 10) : today,
          bucket: 'daily', completed: false,
        }];
        writeAtomic(stateFile(), JSON.stringify(state, null, 2));
      });
      return { ok: true, id: taskId };
    },
  });

  add({
    name: 'plan.completeTask',
    description: '把计划任务标记为已完成或未完成。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '任务 id' },
        completed: { type: 'boolean', description: '默认 true' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    sideEffect: 'write',
    handler: async (params) => {
      const id = String(params.id || '');
      if (!id) throw new Error('缺少参数 id');
      let found = false;
      await enqueueFile(stateFile(), () => {
        const state = (readJsonValue(stateFile(), {}) || {}) as Record<string, unknown>;
        const tasks = (Array.isArray(state.tasks) ? state.tasks : []) as Record<string, unknown>[];
        state.tasks = tasks.map((task) => {
          if (task?.id !== id) return task;
          found = true;
          return { ...task, completed: params.completed !== false };
        });
        if (found) writeAtomic(stateFile(), JSON.stringify(state, null, 2));
      });
      return found ? { ok: true } : { ok: false, error: '未找到该任务' };
    },
  });

  add({
    name: 'questionBook.list',
    description: '列出全部题册（返回题册目录名）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    sideEffect: 'read',
    handler: () => {
      const dir = questionBooksDir();
      const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()) : [];
      return { ok: true, books: entries.map((entry) => entry.name) };
    },
  });

  add({
    name: 'questionBook.import',
    description: '导入一个题册（写入 questions.md）。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '题册名称' },
        markdown: { type: 'string', description: 'questions.md 内容（必填）' },
      },
      required: ['markdown'],
      additionalProperties: false,
    },
    sideEffect: 'write',
    handler: async (params) => {
      const name = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : `agent-${Date.now().toString(36)}`;
      const markdown = String(params.markdown ?? params.content ?? '');
      if (!markdown.trim()) throw new Error('缺少参数 markdown（questions.md 内容）');
      if (markdown.length > MAX_IMPORT_BYTES) throw new Error('题册内容超过 512KB 上限');
      const folder = `${Date.now()}-${safeName(name)}`;
      const fullPath = path.join(questionBooksDir(), folder);
      fs.mkdirSync(fullPath, { recursive: true });
      writeAtomic(path.join(fullPath, 'questions.md'), markdown);
      return { ok: true, folder };
    },
  });

  add({
    name: 'knowledge.sources',
    description: '列出工作区内可作为知识库来源的所有数据项（笔记、题册、知识库文件）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    sideEffect: 'read',
    handler: () => {
      const sources = knowledgeService.listAvailableSources();
      return { ok: true, sources };
    },
  });

  add({
    name: 'knowledge.search',
    description: '在知识库中全文检索相关片段。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索查询词' },
        sourceIds: {
          type: 'array',
          items: { type: 'string' },
          description: '可选，限定来源 id 列表，如 ["note:xxx", "questionBook:yyy"]',
        },
        limit: { type: 'number', description: '最大返回条数，默认 6' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    sideEffect: 'read',
    handler: (params) => {
      const query = String(params.query || '');
      const sourceIds = Array.isArray(params.sourceIds) ? params.sourceIds.map(String) : undefined;
      const limit = typeof params.limit === 'number' ? params.limit : 6;
      const results = knowledgeService.search(query, { sourceIds, limit });
      return { ok: true, results };
    },
  });

  add({
    name: 'research.scan',
    description: '扫描工作区全部文档（PDF/DOCX/XLSX/MD/TXT），解析文本并在 research-db/ 建立索引数据库。',
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: '可选，true 时强制重新解析全部文件，默认 false' },
      },
      additionalProperties: false,
    },
    sideEffect: 'write',
    handler: async (params) => {
      const result = await researchService.scan(params.force === true);
      return {
        ok: true,
        scanned: result.scanned,
        parsed: result.parsed,
        unchanged: result.unchanged,
        failed: result.failed,
        documents: result.documents,
      };
    },
  });

  add({
    name: 'research.list',
    description: '列出研究库（research-db）中已索引的全部文档元数据。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    sideEffect: 'read',
    handler: () => ({ ok: true, documents: researchService.listDocuments() }),
  });

  add({
    name: 'research.read',
    description: '读取研究库中一篇已解析文档的全文（可截断）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id（research_scan / research_list 返回）' },
        maxLength: { type: 'number', description: '可选，最大返回字符数，默认 20000' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    sideEffect: 'read',
    handler: (params) => {
      const id = String(params.id || '');
      if (!id) throw new Error('缺少参数 id');
      const maxLength = typeof params.maxLength === 'number' ? params.maxLength : 20_000;
      const doc = researchService.readDocument(id, maxLength);
      if (!doc) return { ok: false, error: '未找到该文档' };
      return { ok: true, meta: doc.meta, text: doc.text };
    },
  });

  add({
    name: 'research.search',
    description: '在研究库（research-db）中全文检索，返回命中文档与片段。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索查询词' },
        limit: { type: 'number', description: '最大返回条数，默认 8' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    sideEffect: 'read',
    handler: (params) => {
      const query = String(params.query || '');
      const limit = typeof params.limit === 'number' ? params.limit : 8;
      const results = researchService.search(query, limit);
      return { ok: true, results };
    },
  });

  add({
    name: 'research.summary',
    description: '读取研究库中一篇文档的元数据摘要（题目、摘要、章节大纲）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    sideEffect: 'read',
    handler: (params) => {
      const id = String(params.id || '');
      if (!id) throw new Error('缺少参数 id');
      const meta = researchService.getDocumentSummary(id);
      if (!meta) return { ok: false, error: '未找到该文档' };
      return { ok: true, meta };
    },
  });

  add({
    name: 'doc.createWord',
    description: '把 Markdown 内容生成为 Word（.docx）文档，写入工作台 documents/ 目录。',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: '文件名（不含扩展名）' },
        title: { type: 'string', description: '文档标题（可选，默认取文件名）' },
        content: { type: 'string', description: 'Markdown 正文' },
      },
      required: ['fileName', 'content'],
      additionalProperties: false,
    },
    sideEffect: 'write',
    handler: async (params) => {
      const fileName = String(params.fileName || '').trim();
      const content = String(params.content ?? '');
      if (!fileName) throw new Error('缺少参数 fileName');
      if (!content.trim()) throw new Error('缺少参数 content');
      if (content.length > MAX_IMPORT_BYTES) throw new Error('内容超过 512KB 上限');
      const title = String(params.title ?? '').trim() || fileName;
      const file = path.join(workspaceRoot(), 'documents', `${safeName(fileName)}.docx`);
      await docService.createWord(title, content, file);
      return { ok: true, file, type: 'docx' };
    },
  });

  add({
    name: 'doc.createSheet',
    description: '把表头 + 行数据生成为 Excel（.xlsx）表格，写入工作台 documents/ 目录。',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: '文件名（不含扩展名）' },
        sheetName: { type: 'string', description: '工作表名（可选，默认文件名）' },
        headers: {
          type: 'array',
          items: { type: 'string' },
          description: '表头列名（可选）',
        },
        rows: {
          type: 'array',
          items: { type: 'array', items: {} },
          description: '行数据，每行为一维数组',
        },
      },
      required: ['fileName', 'rows'],
      additionalProperties: false,
    },
    sideEffect: 'write',
    handler: async (params) => {
      const fileName = String(params.fileName || '').trim();
      if (!fileName) throw new Error('缺少参数 fileName');
      const rows = Array.isArray(params.rows) ? (params.rows as unknown[]) : [];
      if (rows.length === 0) throw new Error('缺少参数 rows（至少一行数据）');
      const headers = Array.isArray(params.headers) ? (params.headers as unknown[]).map((h) => String(h)) : [];
      const matrix = rows.map((row) => (Array.isArray(row) ? row : [row]));
      const sheetName = String(params.sheetName ?? '').trim() || fileName;
      const file = path.join(workspaceRoot(), 'documents', `${safeName(fileName)}.xlsx`);
      await docService.createSheet(sheetName, headers, matrix, file);
      return { ok: true, file, type: 'xlsx', rowCount: matrix.length };
    },
  });

  add({
    name: 'doc.createPdf',
    description: '把 Markdown 内容渲染并生成为 PDF 文档，写入工作台 documents/ 目录（走 Electron printToPDF，中文字体友好）。',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: '文件名（不含扩展名）' },
        title: { type: 'string', description: '文档标题（可选，默认取文件名）' },
        content: { type: 'string', description: 'Markdown 正文' },
      },
      required: ['fileName', 'content'],
      additionalProperties: false,
    },
    sideEffect: 'write',
    handler: async (params) => {
      const fileName = String(params.fileName || '').trim();
      const content = String(params.content ?? '');
      if (!fileName) throw new Error('缺少参数 fileName');
      if (!content.trim()) throw new Error('缺少参数 content');
      if (content.length > MAX_IMPORT_BYTES) throw new Error('内容超过 512KB 上限');
      const title = String(params.title ?? '').trim() || fileName;
      const file = path.join(workspaceRoot(), 'documents', `${safeName(fileName)}.pdf`);
      await docService.createPdf(title, content, file);
      return { ok: true, file, type: 'pdf' };
    },
  });

  return registry;
}
