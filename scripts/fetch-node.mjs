// 阶段 E：下载钉版 Node.js（win-x64 node.exe）到 resources/node/。
// dsh 子进程需独立 Node 运行时（其 bin 入口判断依赖 import.meta.main，Node 24 起才支持），
// 官方桌面壳同样内置上游 Node，
// 绝不使用 Electron 自带 Node（ABI/fuse/生命周期原因）。
// 用法：node scripts/fetch-node.mjs
// 镜像：默认 npmmirror（国内可直连），可用 NODE_DOWNLOAD_BASE 覆盖为官方源。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targetDir = path.join(root, 'resources', 'node');
const NODE_VERSION = '24.19.0';
const base = process.env.NODE_DOWNLOAD_BASE || 'https://registry.npmmirror.com/-/binary/node';

async function download(url, file) {
  console.log(`下载 ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  await pipeline(response.body, fs.createWriteStream(file));
}

fs.mkdirSync(targetDir, { recursive: true });
const nodeExe = path.join(targetDir, 'node.exe');

if (process.platform === 'win32') {
  const zipFile = path.join(targetDir, `node-v${NODE_VERSION}-win-x64.zip`);
  await download(`${base}/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`, zipFile);
  const { execFileSync } = await import('node:child_process');
  const tmp = path.join(targetDir, '_extract');
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zipFile}' -DestinationPath '${tmp}' -Force`]);
  fs.copyFileSync(path.join(tmp, `node-v${NODE_VERSION}-win-x64`, 'node.exe'), nodeExe);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(zipFile, { force: true });
  console.log(`完成：${nodeExe}（${(fs.statSync(nodeExe).size / 1024 / 1024).toFixed(1)} MB）`);
} else {
  const tarball = path.join(targetDir, `node-v${NODE_VERSION}-${process.platform}-x64.tar.gz`);
  await download(`${base}/v${NODE_VERSION}/node-v${NODE_VERSION}-${process.platform}-x64.tar.gz`, tarball);
  console.log(`已下载 ${tarball}；解包后请将 bin/node 放入 resources/node/`);
}
