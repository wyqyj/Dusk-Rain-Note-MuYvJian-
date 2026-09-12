import * as fs from 'fs';
import * as path from 'path';

/**
 * 数据文件的并发保护工具。
 *
 * 背景：notes.json 会被多个窗口以两条路径写入——主窗口渲染进程整文件覆写
 * （save-notes），速记窗经主进程读-改-写（create/update-quick-note）。
 * 无串行化时防抖写入会用内存里的旧快照覆盖掉刚写入的速记。
 * 这里为每个文件维护一条 Promise 链，所有读写都按到达顺序串行执行。
 */

const fileQueues = new Map<string, Promise<void>>();

/** 将针对同一文件的操作串行化，不怕前一个操作失败。 */
export function enqueueFile<T>(file: string, job: () => T | Promise<T>): Promise<T> {
  const previous = fileQueues.get(file) || Promise.resolve();
  const next = previous.then(job, job);
  fileQueues.set(file, next.then(() => undefined, () => undefined));
  return next;
}

export function readJsonValue(file: string, fallback: unknown): unknown {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : fallback;
  } catch {
    return fallback;
  }
}

/** 先写临时文件再改名，避免写一半进程崩溃留下截断的 JSON。 */
export function writeAtomic(file: string, data: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, data, 'utf-8');
  fs.renameSync(temporary, file);
}

function noteTime(note: Record<string, unknown>, key: 'updatedAt' | 'createdAt'): number {
  const value = note[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 以 id 为键合并磁盘与渲染进程提交的便签快照：
 * - 双方都有的，保留 updatedAt 较新的一方；
 * - 仅在磁盘上出现的，只有在渲染进程最近一次加载快照之后才创建的才保留，
 *   这样既不会覆盖其他窗口新建的便签，也能让渲染进程的删除真正生效。
 */
export function mergeNotes(disk: unknown, incoming: unknown, knownAfter = 0): unknown[] {
  const diskList = Array.isArray(disk) ? disk : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const diskById = new Map<string, Record<string, unknown>>();
  for (const item of diskList) {
    const id = (item as Record<string, unknown> | null)?.id;
    if (typeof id === 'string') diskById.set(id, item as Record<string, unknown>);
  }
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const item of incomingList) {
    const note = item as Record<string, unknown> | null;
    const id = note?.id;
    if (!note || typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const onDisk = diskById.get(id);
    merged.push(onDisk && noteTime(onDisk, 'updatedAt') > noteTime(note, 'updatedAt') ? onDisk : note);
  }
  const freshFromDisk: unknown[] = [];
  for (const item of diskList) {
    const note = item as Record<string, unknown> | null;
    const id = note?.id;
    if (!note || typeof id !== 'string' || seen.has(id)) continue;
    if (noteTime(note, 'createdAt') >= knownAfter) freshFromDisk.push(note);
  }
  return [...freshFromDisk, ...merged];
}

const FORBIDDEN_UPDATE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 过滤原型链污染键，仅保留普通自有键。 */
export function sanitizeNoteUpdates(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_UPDATE_KEYS.has(key)) continue;
    clean[key] = (value as Record<string, unknown>)[key];
  }
  return clean;
}
