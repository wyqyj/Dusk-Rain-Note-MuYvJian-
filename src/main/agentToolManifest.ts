import * as fs from 'fs';
import * as path from 'path';
import { createCapabilityRegistry } from './capabilities';

/**
 * 把共享能力层序列化为 dsh 工具插件可读写的清单。
 *
 * 能力定义只有一个来源（`capabilities.ts`）；dsh 子进程是独立 Node 进程，
 * 通过该 JSON 清单拿到能力名、描述与参数 schema，执行时回调本进程 Agent Bridge。
 */

export interface AgentToolManifestEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  sideEffect: 'read' | 'write';
}

export function buildAgentToolManifest(workspaceRoot: () => string): AgentToolManifestEntry[] {
  return [...createCapabilityRegistry(workspaceRoot).values()]
    .map(({ name, description, inputSchema, sideEffect }) => ({ name, description, inputSchema, sideEffect }));
}

/** 写入 <dir>/muyujian-tools.json 并返回绝对路径。 */
export function writeAgentToolManifest(dir: string, workspaceRoot: () => string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'muyujian-tools.json');
  fs.writeFileSync(file, JSON.stringify(buildAgentToolManifest(workspaceRoot), null, 2), 'utf-8');
  return file;
}
