/**
 * core/backup/compressor.ts — 暮雨笺综合备份协议（纯函数，零平台依赖）
 *
 * 协议与桌面版保持一致（v1）：JSON 载荷 → gzip(level 9) → 单二进制载荷。
 * 载荷结构：{ format: 'muyujian-workspace/v1', createdAt, files: [{ path, data(base64), size, sha256 }] }
 *
 * 跨端互通：桌面「综合备份」.muyujian-workspace 文件可直接被本模块解析，反之亦然。
 */

import { gzip as _gzip, ungzip as _ungzip } from 'pako';

export interface BackupEntry {
  path: string;
  data: string; // base64
  size: number;
  sha256: string;
}

export interface BackupPayload {
  format: 'muyujian-workspace/v1';
  createdAt: string;
  files: BackupEntry[];
}

export const BACKUP_FORMAT = 'muyujian-workspace/v1' as const;

export interface BackupSourceFile {
  /** 工作台内相对路径，使用 '/' 分隔 */
  path: string;
  data: Uint8Array;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 将文件集合打包为备份二进制载荷（gzip(9)）。 */
export async function packBackup(files: BackupSourceFile[]): Promise<Uint8Array> {
  const entries: BackupEntry[] = [];
  for (const file of files) {
    entries.push({
      path: file.path,
      data: toBase64(file.data),
      size: file.data.length,
      sha256: await sha256Hex(file.data),
    });
  }
  const payload: BackupPayload = {
    format: BACKUP_FORMAT,
    createdAt: new Date().toISOString(),
    files: entries,
  };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return _gzip(json, { level: 9 });
}

/** 解析备份二进制载荷，返回载荷结构（不校验内容完整性，校验由 verifyBackup 承担）。 */
export function unpackBackup(payload: Uint8Array): BackupPayload {
  const json = _ungzip(payload);
  const parsed = JSON.parse(new TextDecoder().decode(json)) as BackupPayload;
  if (parsed?.format !== BACKUP_FORMAT || !Array.isArray(parsed.files)) {
    throw new Error('不是有效的暮雨笺综合备份');
  }
  return parsed;
}

/** 校验单个条目的 size 与 SHA-256。 */
export async function verifyBackupEntry(entry: BackupEntry): Promise<boolean> {
  try {
    const bytes = fromBase64(entry.data);
    if (bytes.length !== entry.size) return false;
    return (await sha256Hex(bytes)) === entry.sha256;
  } catch {
    return false;
  }
}

/** 解出条目的原始字节（通常在校验后调用）。 */
export function decodeBackupEntry(entry: BackupEntry): Uint8Array {
  return fromBase64(entry.data);
}

/** 安全化工作台相对路径：拒绝绝对路径与 .. 逃逸（与桌面版 safeRelative 同语义）。 */
export function safeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || normalized.startsWith('/')) {
    throw new Error('无效的工作台相对路径');
  }
  return normalized;
}