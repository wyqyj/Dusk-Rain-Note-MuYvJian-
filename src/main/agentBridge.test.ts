import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentBridge, generateBridgeToken } from './agentBridge';

describe('AgentBridge', () => {
  let root: string;
  let bridge: AgentBridge;
  let token: string;
  let url: string;

  const call = async (capability: string, params: Record<string, unknown> = {}, bearer?: string) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer === undefined ? { Authorization: `Bearer ${token}` } : bearer ? { Authorization: bearer } : {}),
      },
      body: JSON.stringify({ capability, params }),
    });
    return { status: response.status, body: await response.json() as any };
  };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-bridge-'));
    token = generateBridgeToken();
    bridge = new AgentBridge(
      { enabled: true, bind: 'loopback', token, portPreferred: 21900 },
      { workspaceRoot: () => root },
    );
    const status = await bridge.start();
    url = status.url;
  });

  afterAll(async () => {
    await bridge.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects requests without a valid token', async () => {
    const noHeader = await fetch(url, { method: 'POST', body: '{}' });
    expect(noHeader.status).toBe(401);
    const wrong = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: '{}' });
    expect(wrong.status).toBe(401);
  });

  it('rejects non-POST methods', async () => {
    const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(405);
  });

  it('returns 404 for unknown capabilities', async () => {
    const { status, body } = await call('secret.deleteEverything');
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it('workspace.status reports the workspace', async () => {
    const { status, body } = await call('workspace.status');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.root).toBe(root);
    expect(body.notes).toBe(0);
  });

  it('creates and reads back a note', async () => {
    const created = await call('notes.create', { title: '桥建笔记', content: '来自 Agent 的内容' });
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);
    const id = created.body.id as string;
    expect(id).toMatch(/^agent-/);

    const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'notes.json'), 'utf-8'));
    expect(onDisk.some((note: any) => note.id === id)).toBe(true);

    const listed = await call('notes.list');
    expect(listed.body.notes.map((note: any) => note.id)).toContain(id);

    const fetched = await call('notes.get', { id });
    expect(fetched.body.note.content).toBe('来自 Agent 的内容');

    const updated = await call('notes.update', { id, content: '更新后的内容' });
    expect(updated.body.ok).toBe(true);
    const refetched = await call('notes.get', { id });
    expect(refetched.body.note.content).toBe('更新后的内容');
  });

  it('supports plan add/complete cycle', async () => {
    const added = await call('plan.addTask', { title: '复习错题', subject: '数学' });
    expect(added.body.ok).toBe(true);
    const id = added.body.id as string;

    const listed = await call('plan.list');
    expect(listed.body.tasks.some((task: any) => task.id === id && !task.completed)).toBe(true);

    const done = await call('plan.completeTask', { id });
    expect(done.body.ok).toBe(true);
    const after = await call('plan.list');
    expect(after.body.tasks.find((task: any) => task.id === id).completed).toBe(true);
  });

  it('imports a question book', async () => {
    const imported = await call('questionBook.import', { name: '数学错题集', content: '# 题册\n\n题目示例' });
    expect(imported.body.ok).toBe(true);
    const folder = imported.body.folder as string;
    expect(fs.existsSync(path.join(root, 'question-books', folder, 'questions.md'))).toBe(true);

    const listed = await call('questionBook.list');
    expect(listed.body.books).toContain(folder);
  });

  it('records an audit trail', async () => {
    const audit = bridge.auditTrail();
    expect(audit.some((line) => line.includes('notes.create'))).toBe(true);
    expect(audit.some((line) => line.includes('bridge started'))).toBe(true);
  });
});

describe('AgentBridge 写操作确认闸门', () => {
  const setup = async (confirmWrite?: (req: { capability: string; description: string; params: Record<string, unknown> }) => Promise<boolean>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'muyujian-bridge-confirm-'));
    const token = generateBridgeToken();
    const bridge = new AgentBridge(
      { enabled: true, bind: 'loopback', token },
      { workspaceRoot: () => root, confirmWrite },
    );
    const status = await bridge.start();
    return {
      root,
      bridge,
      call: async (capability: string, params: Record<string, unknown> = {}) => {
        const response = await fetch(status.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ capability, params }),
        });
        return { status: response.status, body: await response.json() as any };
      },
    };
  };

  it('配置确认回调后，写操作被拒绝则不执行', async () => {
    const { root, bridge, call } = await setup(async () => false);
    const denied = await call('notes.create', { title: '不该存在', content: 'x' });
    expect(denied.status).toBe(403);
    expect(fs.existsSync(path.join(root, 'notes.json'))).toBe(false);
    expect(bridge.auditTrail().some((line) => line.includes('denied'))).toBe(true);
    await bridge.stop();
  });

  it('确认通过后写操作正常执行；读操作不经确认', async () => {
    const seen: string[] = [];
    const { bridge, call } = await setup(async (req) => { seen.push(req.capability); return true; });
    const read = await call('notes.list');
    expect(read.status).toBe(200);
    expect(seen).toEqual([]);
    const created = await call('notes.create', { title: '已确认', content: 'y' });
    expect(created.status).toBe(200);
    expect(seen).toEqual(['notes.create']);
    await bridge.stop();
  });

  it('确认回调抛错视为拒绝', async () => {
    const { root, bridge, call } = await setup(async () => { throw new Error('UI 异常'); });
    const denied = await call('plan.addTask', { title: 't' });
    expect(denied.status).toBe(403);
    expect(fs.existsSync(path.join(root, 'plan.json'))).toBe(false);
    await bridge.stop();
  });
});
