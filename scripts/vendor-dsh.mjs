/**
 * 阶段 E：把钉版 @deepseek-ai/dsh 及其生产依赖导出为独立目录 resources/dsh-runtime。
 * 打包时经 extraResources 整体带入安装包，dsh 子进程从此处启动，
 * 与主应用 node_modules（不随包发布）完全解耦。
 *
 * 用法：node scripts/vendor-dsh.mjs
 * 重跑前会清空目标目录；npm 脚本策略若拦截 postinstall（如 node-pty/koffi），
 * 对本项目无影响（我们已禁用 shell/fs 类内置工具），脚本会继续。
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(root, 'resources', 'dsh-runtime');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = (pkg.dependencies?.['@deepseek-ai/dsh'] || '').replace(/^[^\d]*/, '');
if (!version) {
  console.error('package.json 未找到 @deepseek-ai/dsh 依赖');
  process.exit(1);
}

console.log(`导出 @deepseek-ai/dsh@${version} → ${target}`);
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
  name: 'muyujian-dsh-runtime',
  private: true,
  version: '1.0.0',
  dependencies: { '@deepseek-ai/dsh': version },
}, null, 2));

try {
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], {
    cwd: target,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
} catch (error) {
  console.error('npm install 失败（若受本机 allow-scripts 策略影响，请检查输出）');
  process.exit(1);
}

// 体积统计
let total = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else total += fs.statSync(full).size;
  }
};
walk(target);
console.log(`完成：${(total / 1024 / 1024).toFixed(1)} MB（${target}）`);
