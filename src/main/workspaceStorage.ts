import { app, dialog, BrowserWindow, nativeImage } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const BOOTSTRAP_NAME = 'muyujian-workspace-bootstrap.json';
const STATE_NAME = 'workspace.json';

type BackupEntry = { path: string; data: string; size: number; sha256: string };

function safeRelative(relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('..') || path.isAbsolute(normalized)) throw new Error('无效的工作台相对路径');
  return normalized;
}

function sha256(data: Buffer): string { return crypto.createHash('sha256').update(data).digest('hex'); }

function listFiles(root: string, current = root): string[] {
  if (!fs.existsSync(current)) return [];
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(current, entry.name);
    return entry.isDirectory() ? listFiles(root, target) : [target];
  });
}

function copyDirectory(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

export class WorkspaceStorage {
  private root: string;
  private readonly bootstrapPath: string;

  constructor(defaultRoot?: string) {
    this.bootstrapPath = path.join(app.getPath('userData'), BOOTSTRAP_NAME);
    this.root = this.loadBootstrap() || defaultRoot || path.join(app.getPath('documents'), '暮雨笺学习工作台');
    this.ensureRoot();
  }

  private loadBootstrap(): string | null {
    try {
      const value = JSON.parse(fs.readFileSync(this.bootstrapPath, 'utf8'));
      return typeof value.root === 'string' && value.root ? value.root : null;
    } catch { return null; }
  }

  private saveBootstrap(): void {
    fs.mkdirSync(path.dirname(this.bootstrapPath), { recursive: true });
    fs.writeFileSync(this.bootstrapPath, JSON.stringify({ root: this.root }, null, 2), 'utf8');
  }

  private ensureRoot(): void {
    for (const directory of ['', 'books', 'question-books', 'attachments', 'exports', 'backups', 'plans']) {
      fs.mkdirSync(path.join(this.root, directory), { recursive: true });
    }
    this.saveBootstrap();
  }

  getRoot(): string { return this.root; }
  getStatePath(): string { return path.join(this.root, STATE_NAME); }

  readState(): string {
    try { return fs.existsSync(this.getStatePath()) ? fs.readFileSync(this.getStatePath(), 'utf8') : ''; } catch { return ''; }
  }

  writeState(value: string): { success: boolean; error?: string } {
    try {
      JSON.parse(value);
      const temporary = `${this.getStatePath()}.tmp`;
      fs.writeFileSync(temporary, value, 'utf8');
      fs.renameSync(temporary, this.getStatePath());
      return { success: true };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async chooseRoot(parent: BrowserWindow | null): Promise<{ canceled?: boolean; path?: string }> {
    const options = { title: '选择学习工作台数据目录', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { path: result.filePaths[0] };
  }

  migrate(destination: string): { success: boolean; error?: string; source?: string; destination?: string; files?: number } {
    try {
      const target = path.resolve(destination);
      if (target === path.resolve(this.root)) return { success: true, source: this.root, destination: target, files: 0 };
      fs.mkdirSync(target, { recursive: true });
      const files = listFiles(this.root);
      for (const sourceFile of files) {
        const relative = path.relative(this.root, sourceFile);
        const destinationFile = path.join(target, relative);
        fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
        fs.copyFileSync(sourceFile, destinationFile);
        const sourceHash = sha256(fs.readFileSync(sourceFile));
        const destinationHash = sha256(fs.readFileSync(destinationFile));
        if (sourceHash !== destinationHash) throw new Error(`迁移校验失败：${relative}`);
      }
      const source = this.root;
      this.root = target;
      this.ensureRoot();
      return { success: true, source, destination: target, files: files.length };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async createBackup(parent: BrowserWindow | null): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      const options = {
        title: '导出暮雨笺综合备份', defaultPath: `暮雨笺-${new Date().toISOString().slice(0, 10)}.muyujian-workspace`,
        filters: [{ name: '暮雨笺综合备份', extensions: ['muyujian-workspace'] }],
      };
      const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { success: false, error: 'cancelled' };
      const files: BackupEntry[] = listFiles(this.root).map((file) => {
        const data = fs.readFileSync(file);
        return { path: path.relative(this.root, file).replace(/\\/g, '/'), data: data.toString('base64'), size: data.length, sha256: sha256(data) };
      });
      const payload = Buffer.from(JSON.stringify({ format: 'muyujian-workspace/v1', createdAt: new Date().toISOString(), files }), 'utf8');
      fs.writeFileSync(result.filePath, zlib.gzipSync(payload, { level: 9 }));
      return { success: true, path: result.filePath };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async restoreBackup(parent: BrowserWindow | null): Promise<{ success: boolean; error?: string; files?: number }> {
    try {
      const options = { title: '恢复暮雨笺综合备份', properties: ['openFile'] as ('openFile')[], filters: [{ name: '暮雨笺综合备份', extensions: ['muyujian-workspace'] }] };
      const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return { success: false, error: 'cancelled' };
      const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(result.filePaths[0])).toString('utf8'));
      if (payload?.format !== 'muyujian-workspace/v1' || !Array.isArray(payload.files)) throw new Error('不是有效的暮雨笺综合备份');
      for (const entry of payload.files as BackupEntry[]) {
        const relative = safeRelative(entry.path);
        const data = Buffer.from(entry.data, 'base64');
        if (data.length !== entry.size || sha256(data) !== entry.sha256) throw new Error(`备份校验失败：${entry.path}`);
        const target = path.join(this.root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
      }
      return { success: true, files: payload.files.length };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  async chooseQuestionBook(parent: BrowserWindow | null): Promise<{ canceled?: boolean; folder?: string; originalFolder?: string; content?: string }> {
    const options = { title: '选择题册文件夹（包含 questions.md）', properties: ['openDirectory'] as ('openDirectory')[] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const folder = result.filePaths[0];
    const markdownPath = path.join(folder, 'questions.md');
    if (!fs.existsSync(markdownPath)) throw new Error('选中的文件夹未包含 questions.md');
    const managedFolder = path.join(this.root, 'question-books', `${Date.now()}-${path.basename(folder).replace(/[<>:"/\\|?*]/g, '_')}`);
    copyDirectory(folder, managedFolder);
    return { folder: managedFolder, originalFolder: folder, content: fs.readFileSync(path.join(managedFolder, 'questions.md'), 'utf8') };
  }

  readQuestionBook(folder: string): { success: boolean; folder?: string; content?: string; error?: string } {
    try {
      const managedRoot = path.resolve(this.root, 'question-books');
      const target = path.resolve(folder);
      if (!target.startsWith(`${managedRoot}${path.sep}`)) throw new Error('题册目录不属于当前学习工作台');
      const markdownPath = path.join(target, 'questions.md');
      if (!fs.existsSync(markdownPath)) throw new Error('对应目录中的 questions.md 不存在');
      return { success: true, folder: target, content: fs.readFileSync(markdownPath, 'utf8') };
    } catch (error: any) { return { success: false, error: error.message }; }
  }

  private isManagedBookPath(sourcePath: string): boolean {
    try {
      const booksRoot = fs.realpathSync(path.resolve(this.root, 'books'));
      const target = fs.realpathSync(path.resolve(sourcePath));
      return target.startsWith(`${booksRoot}${path.sep}`);
    } catch {
      return false;
    }
  }

  private async createBookCover(sourcePath: string): Promise<string> {
    if (!this.isManagedBookPath(sourcePath)) throw new Error('书籍文件不属于当前学习工作台');
    const source = path.resolve(sourcePath);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('书籍文件不存在或不是有效文件');

    const thumbnail = await nativeImage.createThumbnailFromPath(source, { width: 360, height: 480 });
    if (thumbnail.isEmpty()) throw new Error('系统无法为该文件生成缩略图');

    const coverPath = path.join(path.dirname(source), 'cover.png');
    fs.writeFileSync(coverPath, thumbnail.toPNG());
    return coverPath;
  }

  async generateBookCover(sourcePath: string): Promise<{ success: boolean; coverPath?: string; error?: string }> {
    try {
      return { success: true, coverPath: await this.createBookCover(sourcePath) };
    } catch (error: any) {
      return { success: false, error: error.message || '生成书籍封面失败' };
    }
  }

  async chooseBookFile(parent: BrowserWindow | null): Promise<{ canceled?: boolean; path?: string; originalPath?: string; name?: string; coverPath?: string; coverError?: string }> {
    const options = { title: '导入书籍', properties: ['openFile'] as ('openFile')[], filters: [{ name: '书籍文件', extensions: ['pdf', 'epub', 'mobi', 'azw3', 'docx', 'txt'] }, { name: '所有文件', extensions: ['*'] }] };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };

    const originalPath = result.filePaths[0];
    const name = path.basename(originalPath);
    const managedDirectory = path.join(this.root, 'books', `${Date.now()}-${crypto.randomUUID()}-${name.replace(/[<>:"/\\|?*]/g, '_')}`);
    fs.mkdirSync(managedDirectory, { recursive: true });
    const managedPath = path.join(managedDirectory, name);
    fs.copyFileSync(originalPath, managedPath);

    const cover = await this.generateBookCover(managedPath);
    return { path: managedPath, originalPath, name, coverPath: cover.coverPath, coverError: cover.error };
  }
}
