# 修复计划（基于 2026-09-10 静态审查）

> 状态（2026-09-10）：#1–#14 已全部完成代码修复并通过测试（`npm test` 28 用例全绿、双侧 typecheck 通过），#15 主体覆盖（workspaceStorage 备份校验单测待抽离后补齐）。打包与真实窗口手工回归按用户要求暂缓。

> 编号与审查结论一致。每项含：问题定位 → 修复思路 → 验证方式 → 预估工作量。
> 顺序即建议执行顺序：先高优先级数据安全问题，再中优先级健壮性，最后低优先级体验与测试。

## 第一阶段：高优先级（数据安全）

### #1 notes.json / attachments.json 多窗口写竞争（丢数据）
- **位置**：`src/main/index.ts`（`save-notes`、`create-quick-note`、`update-quick-note-content`、`update-quick-note`）与 `src/renderer/store/noteStore.ts`（500ms 防抖整文件覆写）。
- **方案**：
  1. 主进程为每个数据文件建一条串行写队列（简单的 Promise 链即可）。
  2. `save-notes` 不再无合并地整文件覆写，改为「读取磁盘最新 → 以 id 为键合并（后写方 `updatedAt` 优先）→ 原子落盘」。
  3. `create-quick-note` / `update-quick-note-*` 并入同一队列，消除与防抖写入的交错。
  4. 写入成功后广播 `reload-notes` 的既有机制保留。
- **验证**：新增 vitest 覆盖合并逻辑；手工回归：主窗口编辑中关速记窗，确认速记内容不丢；两速记窗连续关闭，两条都在。
- **工作量**：中（约半天）。

### #2 `update-quick-note` 原型链污染
- **位置**：`src/main/index.ts` `ipcMain.handle('update-quick-note', ...)` 中 `Object.assign(notes[idx], JSON.parse(updates))`。
- **方案**：合并前过滤 `__proto__`、`constructor`、`prototype` 键（递归一层即可），或使用 `Object.assign(Object.create(null), ...)` 模式后白名单拷贝。
- **验证**：新增单测，对构造 `{"__proto__": {...}}` 载荷断言原型未被污染且 notes.json 不含注入键。
- **工作量**：小（<1 小时，含测试）。

### #3 备份恢复无解压上限（gzip 炸弹）
- **位置**：`src/main/workspaceStorage.ts` `restoreBackup`。
- **方案**：解压后校验原始字节数（如 ≤ 512MB）、逐条目累计 `data` 解码长度并设上限、条目数设上限（如 100,000）。超限即拒绝且不落任何一个文件（先全部校验再写入）。
- **验证**：构造压缩包内嵌超大 base64 条目的单测。
- **工作量**：小。

## 第二阶段：中优先级（健壮性）

### #4 待办窗透明度钳制不对称
- **位置**：`src/main/index.ts` `set-opacity` 与 `createTodayPlanWindow`。
- **方案**：写入 store 前即钳制到 [0.2, 1]；读取时用同一钳制函数。
- **验证**：单测钳制函数或手工回归：设极端值后重启应用，窗口可见且透明度合法。
- **工作量**：极小。

### #5 KaTeX 渲染失败回退未转义
- **位置**：`src/renderer/utils/markdown.ts` 所有 `catch` 回退分支（`preRenderMath`、`renderInlineMath`、两种 renderer rule、`postProcessPandocHtml`）。
- **方案**：抽一个 `escapeHtml` 工具函数，所有回退分支统一使用。
- **验证**：单测断言含 `<` 的非法公式输出为转义文本。
- **工作量**：小。

### #6 `$…$` 误吞货币/价格文本
- **位置**：`markdown.ts` `renderInlineMath` 与 markdown-it `math_inline` 规则。
- **方案**：采用 pandoc 规则——开 `$` 后紧跟的字符非空白、闭 `$` 前一字符非空白且闭 `$` 后非数字，否则不当公式。
- **验证**：单测覆盖 "$5 到 $10" 保持原文、`$x^2$` 正常渲染。
- **工作量**：小。

### #7 `normalizeMathMarkdown` 跨全文正则
- **位置**：`markdown.ts` 中 `\\\[([\s\S]*?)\\\]`、`\\\(([\s\S]*?)\\\)`。
- **方案**：改为受限匹配（不跨空行 / 限定最大长度），或复用逐字符扫描。
- **验证**：单测覆盖未闭合定界符场景不吞全文。
- **工作量**：小。

### #8 生产环境回退加载 localhost:5173
- **位置**：`src/main/index.ts` 三个窗口创建函数中的 `loadFile` 失败回退，及 CSP `connect-src`。
- **方案**：`app.isPackaged` 时渲染入口缺失即报错退出并弹错误框；CSP 的 localhost 例外只在开发环境注入。
- **验证**：打包后删除 dist 渲染产物手工验证错误路径。
- **工作量**：小。

## 第三阶段：低优先级（体验与工程化）

### #9 导出备份携带整机配置
- **方案**：`export-data` 时剔除 `encryptedAiApiKey`（说明为机器绑定、迁移后需重设），导入时忽略该键并提示。

### #10 dataURI 内嵌导致 notes.json 膨胀与写放大
- **方案**：图片统一落 `attachments/` 目录文件，notes 仅存引用 id；存量 dataURI 做惰性迁移。
- **工作量**：中（涉及渲染与导出路径，建议单独一个迭代）。

### #11 PDF 导出字体硬编码
- **方案**：xelatex 失败时回退字体候选列表（Microsoft YaHei → Noto Sans CJK SC → SimSun），并在错误提示中给出字体缺失说明。

### #12 AI 流推送到已销毁窗口
- **方案**：`requestAi` 循环内检查 `sender.isDestroyed()`，为 true 时 abort 并静默退出。

### #13 `readQuestionBook` 路径校验与 `isManagedBookPath` 标准不一致
- **方案**：统一为 `realpathSync` 后的前缀比较，抽共享工具函数。

### #14 生产菜单暴露 DevTools / Reload
- **方案**：`isPackaged` 时隐藏「重新加载」「开发者工具」菜单项。

### #15 测试覆盖不足
- **方案**：为以下路径补 vitest——备份恢复校验（随 #3）、合并写逻辑（随 #1）、透明度钳制（随 #4）、KaTeX 回退转义（随 #5）、AI 配置校验。发布后按 `MAINTENANCE_GUIDE.md` 清单做手工回归。

## 排期建议

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| 第一天 | #2、#3、#4（小改动清掉） | 半个工作日 |
| 第二天 | #1 合并写队列 + 单测 | 一个工作日 |
| 第三天 | #5、#6、#7（渲染管线一组）、#8 | 一个工作日 |
| 后续迭代 | #9–#14 随版本顺带，#10 单独迭代，#15 持续补齐 | — |

## 发布前检查（沿用维护指南）
- `npm run typecheck`、`npm test`、`npm run build` 全绿。
- 手工回归：便签编辑后重启内容仍在；速记与主窗口交叉操作不丢数据；初始化二次确认后预置笔记恢复。
