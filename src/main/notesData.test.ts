import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { enqueueFile, mergeNotes, sanitizeNoteUpdates, readJsonValue, writeAtomic } from './notesData';

describe('mergeNotes', () => {
  const base = { id: 'a', title: 't', content: '', tags: [], createdAt: 100, updatedAt: 200 };

  it('keeps the incoming note when it is newer', () => {
    const disk = [{ ...base, content: 'old', updatedAt: 200 }];
    const incoming = [{ ...base, content: 'new', updatedAt: 300 }];
    const merged = mergeNotes(disk, incoming, 0) as any[];
    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe('new');
  });

  it('keeps the disk note when it is newer', () => {
    const disk = [{ ...base, content: 'disk-newer', updatedAt: 400 }];
    const incoming = [{ ...base, content: 'stale', updatedAt: 300 }];
    const merged = mergeNotes(disk, incoming, 0) as any[];
    expect(merged[0].content).toBe('disk-newer');
  });

  it('preserves notes created by another window after the renderer snapshot', () => {
    const quickNote = { id: 'quick', title: '', content: '速记', tags: [], createdAt: 500, updatedAt: 500 };
    const merged = mergeNotes([quickNote], [base], 100) as any[];
    expect(merged.map((n) => n.id)).toContain('quick');
    expect(merged.map((n) => n.id)).toContain('a');
  });

  it('lets the renderer delete notes it already knew about', () => {
    const merged = mergeNotes([base], [], 200) as any[];
    expect(merged).toHaveLength(0);
  });

  it('ignores malformed entries and duplicate ids', () => {
    const merged = mergeNotes('not-an-array', [null, base, base], 0) as any[];
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('a');
  });
});

describe('sanitizeNoteUpdates', () => {
  it('drops prototype-polluting keys', () => {
    const parsed = JSON.parse('{"title":"ok","__proto__":{"polluted":true}}');
    const clean = sanitizeNoteUpdates(parsed);
    expect(clean.title).toBe('ok');
    expect(Object.prototype.hasOwnProperty.call(clean, '__proto__')).toBe(false);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('returns an empty object for non-objects', () => {
    expect(sanitizeNoteUpdates(null)).toEqual({});
    expect(sanitizeNoteUpdates([1, 2])).toEqual({});
    expect(sanitizeNoteUpdates('x')).toEqual({});
  });
});

describe('enqueueFile / writeAtomic', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-notes-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('serializes concurrent read-modify-write operations', async () => {
    const file = path.join(dir, 'notes.json');
    writeAtomic(file, '[]');
    const jobs = Array.from({ length: 20 }, (_, i) =>
      enqueueFile(file, () => {
        const list = readJsonValue(file, []) as unknown[];
        list.push(i);
        writeAtomic(file, JSON.stringify(list));
      })
    );
    await Promise.all(jobs);
    const result = readJsonValue(file, []) as number[];
    expect(result).toHaveLength(20);
    expect([...result].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('keeps the queue alive after a failing job', async () => {
    const file = path.join(dir, 'notes.json');
    await enqueueFile(file, () => { throw new Error('boom'); }).catch(() => undefined);
    await enqueueFile(file, () => writeAtomic(file, '[1]'));
    expect(readJsonValue(file, null)).toEqual([1]);
  });
});
