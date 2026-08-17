# 暮雨笺维护指南

本文件用于帮助后续维护者快速定位功能代码、理解数据边界，并按统一流程完成验证和发布。

## 1. 项目结构

| 功能或边界 | 主要文件 | 维护要点 |
| --- | --- | --- |
| Electron 主进程、窗口、IPC、导出 | `src/main/index.ts` | 新增渲染器能力先扩展 IPC，再通过 preload 暴露；不要把 Node API 直接放进渲染器。 |
| 工作台存储、迁移、备份、初始化 | `src/main/workspaceStorage.ts` | 工作台根目录由 bootstrap 文件指向；初始化只清理应用管理目录，保留数据目录位置。 |
| 渲染器安全桥 | `src/main/preload.ts`、`src/renderer/vite-env.d.ts` | 两个文件中的 API 名称和返回类型必须同步。 |
| 共享领域类型 | `src/shared/types.ts` | 便签、画布、题册和学习工作台模型集中维护，跨进程类型变更从这里开始。 |
| 应用首屏和全局快捷键 | `src/renderer/App.tsx` | 负责主窗口布局、主题、外观弹窗、导入导出和新手引导。 |
| 学习工作台 | `src/renderer/components/StudyWorkbench.tsx` | 总览、规划、专注、书架、题册、笔记、画布和设置入口；复杂业务优先抽到 `utils`。 |
| 编辑器与 Markdown 预览 | `src/renderer/components/Editor.tsx`、`Preview.tsx`、`src/renderer/utils/markdown.ts` | 所有 HTML 渲染必须经过消毒；公式和 Wiki 链接保持统一解析路径。 |
| 便签、附件、计时数据 | `src/renderer/store/noteStore.ts`、`attachmentStore.ts`、`timerStore.ts` | Store 负责内存状态和防抖写盘，不在组件中直接写本地文件。 |
| 无限画布 | `src/renderer/components/CanvasBoard.tsx` | 画布交互、视口裁剪和滚轮边界集中在此；滚轮判断使用 `utils/canvasWheel.ts`。 |
| 计划导入 | `src/renderer/utils/planTasks.ts`、`skills/muyujian-plan-import/` | 基础契约是 `- [ ] 任务名称`，解析器不猜测科目或截止日期。 |
| 题册导出 | `src/renderer/utils/questionBookExport.ts` | 先按范围和数量生成快照，再复用主进程 `export-pdf`；PDF 依赖 Pandoc/XeLaTeX。 |
| 输入安全 | `src/renderer/utils/sanitizeHtml.ts`、`src/main/index.ts` | Markdown HTML、路径打开和 IPC 写入均有边界校验。 |
| 测试 | `src/renderer/utils/*.test.ts` | 纯函数优先单测，涉及 IPC 或 Electron 的行为在发布前手工回归。 |

## 2. 数据目录

工作台根目录默认位于开发环境的 `data/`，打包环境位于 Electron userData 下，也可以在设置中迁移到其他目录。应用管理的内容包括：

- `workspace.json`：学习工作台状态。
- `notes.json`、`attachments.json`、`task-timer-records.json`：便签、素材和计时记录。
- `books/`、`question-books/`、`attachments/`、`exports/`、`backups/`、`plans/`：托管书籍、题册、附件、导出和计划数据。

设置中的“初始化全部数据”会删除以上应用管理内容和工作台内备份，重置主进程设置并重新生成功能、Markdown、公式和版本更新预置笔记；它不会删除工作台根目录之外的手动备份，也不会改变当前数据目录位置。

## 3. 本地开发

```bash
npm ci
npm run typecheck
npm test
npm run build
npx electron .
```

Windows 用户可直接双击 `启动暮雨笺.bat`。依赖缺失时脚本会使用 Electron 镜像补齐依赖，随后构建并启动；批处理文件必须保持 CRLF 换行。

## 4. 发布流程

1. 更新 `package.json` 和 `package-lock.json` 版本号。
2. 更新 `CHANGELOG.md` 和 `RELEASE_NOTES_<version>.md`。
3. 执行 `npm run typecheck`、`npm test`、`npm run build`。
4. 确认 `resources/pandoc/pandoc.exe` 存在，执行 `npm run dist` 或双击 `打包.bat`。
5. 检查 `release/` 中的 NSIS 安装包名称和大小；不要提交 `dist/`、`release/`、`node_modules/` 或本地数据。
6. 提交代码、创建版本标签并推送到 `origin/main`。

## 5. 常见修改路径

- 新增 IPC：主进程 `ipcMain.handle` -> preload -> `vite-env.d.ts` -> React 调用。
- 新增工作台字段：先修改 `src/shared/types.ts`，再更新 `initialWorkspace`、规范化逻辑、导入导出和案例文件。
- 新增 Markdown 能力：修改 `markdown.ts`，补充消毒测试，并检查 `Preview`、画布和题册是否共享行为。
- 新增设置：更新主进程默认值、renderer settings store、主窗口外观面板和工作台设置面板。
- 新增发布资源：同时更新 `package.json` 的 `extraResources` 和主进程开发/打包路径。

## 6. 回归重点

- 便签编辑后刷新或退出，内容仍然存在。
- 画布模块内滚轮不改变画布缩放，空白区域仍可缩放。
- 计划 Markdown 的 `[ ]`、`[x]` 导入数量和完成状态正确。
- 题册 PDF 的范围、数量、公式和取消保存路径正确。
- 初始化前必须二次确认，初始化后预置笔记和设置恢复。
- 深色模式下编辑器、题册、画布、弹窗和输入框无白色或过饱和色块。
