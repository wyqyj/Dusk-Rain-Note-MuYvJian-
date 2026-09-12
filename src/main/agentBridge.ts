import * as crypto from 'crypto';
import * as http from 'http';
import { createCapabilityRegistry, type CapabilitySpec } from './capabilities';

/**
 * 对外接入 Agent 的本地桥服务。
 *
 * 安全模型（与 docs/archive/AGENT_BRIDGE_PLAN.md 对齐）：
 * - 默认关闭；开启后绑定地址可选 127.0.0.1（仅本机）或 0.0.0.0（局域网）。
 * - 所有请求都需要 Authorization: Bearer <token>，token 存在应用配置中并可手动重置。
 * - 能力走白名单注册表；不允许删除数据、导出备份、读取 AI Key。
 * - 写路径全部经 enqueueFile 串行写队列，与 UI 侧写入互不覆盖。
 * - 每个实例带令牌桶限流与请求体上限，避免被本机其他进程打爆。
 */

export type BridgeBind = 'loopback' | 'lan';

export interface BridgeOptions {
  enabled: boolean;
  bind: BridgeBind;
  token: string;
  portPreferred?: number;
}

export interface BridgeStatus {
  running: boolean;
  host: string;
  port: number;
  url: string;
  allowedIpsNote: string;
}

const MAX_BODY_BYTES = 512 * 1024;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 30;
const AUDIT_LIMIT = 200;

export interface BridgeDeps {
  /** 当前工作台根目录 */
  workspaceRoot: () => string;
  /** 写操作确认闸门（可选）：返回 true 放行，false/异常拒绝。不配置则写操作直接放行。 */
  confirmWrite?: (request: { capability: string; description: string; params: Record<string, unknown> }) => Promise<boolean>;
  /** 审计日志输出（默认 console） */
  log?: (line: string) => void;
}

export class AgentBridge {
  private server: http.Server | null = null;
  private actualPort = 0;
  private bindHost = '127.0.0.1';
  private audit: string[] = [];
  private rateBuckets = new Map<string, number[]>();
  private readonly capabilities = new Map<string, CapabilitySpec>();

  constructor(
    private options: BridgeOptions,
    private deps: BridgeDeps,
  ) {
    for (const spec of createCapabilityRegistry(deps.workspaceRoot).values()) {
      this.capabilities.set(spec.name, spec);
    }
  }

  // ---------- 生命周期 ----------

  async start(): Promise<BridgeStatus> {
    await this.stop();
    this.bindHost = this.options.bind === 'lan' ? '0.0.0.0' : '127.0.0.1';
    const server = http.createServer((request, response) => { void this.handleRequest(request, response); });
    this.server = server;

    const base = this.options.portPreferred ?? 18921;
    let port = base;
    // 端口被占用时依次后移，最多尝试 50 次
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') reject(error);
            else reject(error);
          };
          server.once('error', onError);
          server.listen(port, this.bindHost, () => {
            server.off('error', onError);
            resolve();
          });
        });
        break;
      } catch {
        port = base + attempt + 1;
        if (attempt === 49) throw new Error('无法找到可用端口（18921-18970 均被占用）');
      }
    }
    this.actualPort = port;
    this.recordAudit(`bridge started on ${this.bindHost}:${port}`);
    return this.status();
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    // 先断开 keep-alive 连接，避免客户端在重启或测试间复用已被回收的 socket。
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.recordAudit('bridge stopped');
  }

  status(): BridgeStatus {
    const running = Boolean(this.server);
    return {
      running,
      host: this.bindHost,
      port: this.actualPort,
      url: running ? `http://${this.bindHost === '0.0.0.0' ? '<本机IP>' : '127.0.0.1'}:${this.actualPort}` : '',
      allowedIpsNote: this.bindHost === '0.0.0.0' ? '允许局域网内设备访问' : '仅允许本机访问',
    };
  }

  auditTrail(): string[] { return [...this.audit]; }

  updateOptions(options: BridgeOptions): void { this.options = options; }

  // ---------- 请求处理 ----------

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown) => {
      const text = JSON.stringify(body);
      // 每个响应都关闭连接：桥接会重启，禁止客户端复用可能已失效的 keep-alive socket。
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      response.end(text);
    };
    try {
      if (request.method !== 'POST') { reply(405, { ok: false, error: '仅支持 POST' }); return; }
      const auth = request.headers.authorization || '';
      if (auth !== `Bearer ${this.options.token}`) { reply(401, { ok: false, error: 'Token 校验失败' }); return; }
      if (!this.checkRateLimit(request.socket.remoteAddress || 'unknown')) { reply(429, { ok: false, error: '请求过于频繁' }); return; }

      const body = await this.readBody(request);
      const call = JSON.parse(body) as { capability?: string; params?: unknown };
      const spec = typeof call.capability === 'string' ? this.capabilities.get(call.capability) : undefined;
      if (!spec) { reply(404, { ok: false, error: `未知能力：${String(call.capability)}` }); return; }
      const params = (call.params && typeof call.params === 'object' && !Array.isArray(call.params)) ? call.params as Record<string, unknown> : {};
      if (spec.sideEffect === 'write' && this.deps.confirmWrite) {
        let approved = false;
        try {
          approved = await this.deps.confirmWrite({ capability: spec.name, description: spec.description, params });
        } catch {
          approved = false;
        }
        this.recordAudit(`${spec.name} confirm=${approved ? 'approved' : 'denied'}`);
        if (!approved) { reply(403, { ok: false, error: '用户拒绝了该写操作' }); return; }
      }
      this.recordAudit(`${spec.name} from ${request.socket.remoteAddress}`);
      reply(200, await spec.handler(params));
    } catch (error: any) {
      reply(400, { ok: false, error: error?.message || '请求无效' });
    }
  }

  private readBody(request: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let total = 0;
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) { request.destroy(); reject(new Error('请求体超过 512KB 上限')); return; }
        chunks.push(chunk);
      });
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      request.on('error', reject);
    });
  }

  private checkRateLimit(key: string): boolean {
    const now = Date.now();
    const bucket = (this.rateBuckets.get(key) || []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
    if (bucket.length >= RATE_LIMIT_MAX) return false;
    bucket.push(now);
    this.rateBuckets.set(key, bucket);
    return true;
  }

  private recordAudit(line: string): void {
    const entry = `${new Date().toISOString()} ${line}`;
    this.audit.push(entry);
    if (this.audit.length > AUDIT_LIMIT) this.audit.splice(0, this.audit.length - AUDIT_LIMIT);
    (this.deps.log || (() => {}))(entry);
  }
}

/** 生成新 token（URL-safe，32 字节随机数）。 */
export function generateBridgeToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

