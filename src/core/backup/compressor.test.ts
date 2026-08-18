import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT, decodeBackupEntry, packBackup, safeRelativePath, sha256Hex, unpackBackup, verifyBackupEntry,
} from './compressor';

describe('core/backup/compressor — 暮雨笺综合备份协议', () => {
  it('打包→解包往返保持数据不变', async () => {
    const files = [
      { path: 'notes.json', data: new TextEncoder().encode(JSON.stringify([{ id: 'a', title: '便签' }])) },
      { path: 'workspace/workspace.json', data: new TextEncoder().encode('{"version":3}') },
      { path: 'task-timer-records.json', data: new TextEncoder().encode('[{"taskId":"t1"}]') },
    ];
    const packed = await packBackup(files);
    expect(packed.length).toBeGreaterThan(0);

    const payload = unpackBackup(packed);
    expect(payload.format).toBe(BACKUP_FORMAT);
    expect(payload.files).toHaveLength(3);
    expect(payload.files.find((f) => f.path === 'notes.json')?.size).toBe(files[0].data.length);

    // 逐个校验 SHA-256 与 base64 解码
    for (const entry of payload.files) {
      expect(await verifyBackupEntry(entry)).toBe(true);
      const decoded = decodeBackupEntry(entry);
      expect(decoded.length).toBe(entry.size);
    }
  });

  it('篡改数据后 SHA-256 校验失败', async () => {
    const files = [{ path: 'notes.json', data: new TextEncoder().encode('[]') }];
    const payload = unpackBackup(await packBackup(files));
    payload.files[0] = { ...payload.files[0], data: btoa('fake') };
    expect(await verifyBackupEntry(payload.files[0])).toBe(false);
  });

  it('sha256Hex 输出 64 位十六进制', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('muyujian'));
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('safeRelativePath 拒绝路径逃逸', () => {
    expect(safeRelativePath('notes.json')).toBe('notes.json');
    expect(safeRelativePath('a/b/c.md')).toBe('a/b/c.md');
    // 桌面版安全语义：归一化后检查，前导分隔符视为相对（与上游 safeRelative 一致）
    expect(safeRelativePath('/abs/path')).toBe('abs/path');
    expect(() => safeRelativePath('../etc/passwd')).toThrow();
    expect(() => safeRelativePath('a/../../b')).toThrow();
    expect(() => safeRelativePath('')).toThrow();
    expect(() => safeRelativePath('.')).toThrow();
  });
});