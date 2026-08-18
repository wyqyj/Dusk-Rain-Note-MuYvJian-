# 暮雨笺 Android（muyujian-android）

桌面笔记应用 [Dusk-Rain-Note-MuYvJian-](https://github.com/wyqyj/Dusk-Rain-Note-MuYvJian-)（暮雨笺 v3.0.6，Electron）的 Android 移植版。
采用 **Capacitor 8 + 六边形架构（ports & adapters）**：渲染层 95% 复用上游 React 代码，能力层以接口隔离，原生适配可替换。

> **版权提示**：上游项目无 LICENSE，本工程仅作**学习与本地使用**，不对外分发。

## 目录结构

```
muyujian-android/
├── src/
│   ├── ui/           # React 渲染层（复用上游，DI 化后无任何 window.electronAPI 引用）
│   ├── ports/        # 能力接口层（9 个 port，签名与上游 Electron IPC 契约一致）
│   ├── core/         # 领域层（纯 TS，零平台依赖：备份协议/校验/导出/工具）
│   ├── adapters/     # 适配层（capacitor / web / memory 三套实现）
│   └── platform/     # 组合根（container.ts：DI；bootstrap.ts：装配）
├── android/          # Capacitor 生成的原生工程（cap add android）
├── dist-apk/         # 构建产物 APK
└── build-apk.sh      # 一键构建脚本
```

## 构建要求（全部位于 D:/muyujian-tooling/，独立于项目工作区）

| 工具 | 版本 | 位置 |
|---|---|---|
| Node.js + npm | 任意现代版本 | 系统安装 |
| JDK | 21（构建运行时） | `D:/muyujian-tooling/jdk-21.0.12+8` |
| Android SDK | platform 36 + build-tools | `D:/muyujian-tooling/android-sdk` |
| Gradle | 8.14.3（wrapper 自动） | `D:/muyujian-tooling/gradle-home` |
| Clash 代理 | 127.0.0.1:7897（首次依赖下载需要） | — |

## 构建步骤

```bash
# 一键（推荐）
bash build-apk.sh            # debug
bash build-apk.sh release    # release（未配置签名，见脚本注释）

# 手动
source D:/muyujian-tooling/env.sh
export JAVA_HOME="$JDK21_HOME"
cd muyujian-android
npx vite build               # 1. web 资源 → dist/
npx cap sync android         # 2. 同步 → android/app/src/main/assets/public
cd android && ./gradlew.bat assembleDebug   # 3. 原生打包
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## 架构要点

- **依赖方向**：`ui → ports ← adapters`，`ui/adapters → core`。ui 不直接触碰平台能力，全部经 `getBridge()`（`src/platform/container.ts`）注入。
- **数据兼容桌面**：便签/附件/计时/工作台数据沿用桌面 JSON 格式（notes.json / attachments.json / task-timer-records.json / workspace.json），综合备份协议为 `muyujian-workspace/v1`（gzip+base64+SHA-256，`core/backup`），桌面↔手机可互相迁移。
- **KV 单通道**：设置强制走 WebView localStorage，避免 Preferences 与 localStorage 双通道不一致。
- **测试**：core 纯函数与 memory 桥（测试替身）共 7 文件 20 用例（`npx vitest run`）。

## 功能降级矩阵（移动端）

| 能力 | 移动端行为 |
|---|---|
| 导出 Word / PDF | 降级为 `.doc`（HTML）/ `.pdf.html`（打印为 PDF）+ 系统分享 |
| pandoc 编译 | 返回失败，预览自动回退 KaTeX 渲染 |
| 书籍封面生成 | 不支持本地生成；导入时提示 |
| 综合备份 | 打包后调用系统分享/保存；恢复走系统文件选择器 |
| 多窗口（快速笔记/今日计划/任务统计） | 收敛为 App 内全屏覆盖层，系统返回键关闭 |
| 画布缩放 | 桌面积滚轮缩放；移动端双指捏合缩放+平移（锚点数学抽离 core 层并有单测） |
| 键盘避让 | `windowSoftInputMode=adjustResize` + Keyboard 插件（resize: body） |
| 打开数据目录 | 分享文件而不是打开文件夹 |
| 工作台目录迁移 | 沙箱内固定数据目录（桌面迁移协议保留） |

## 桌面 → 手机迁移

1. 桌面端「设置 → 数据目录与综合备份 → 导出综合备份」得到 `.muyujian-workspace` 文件。
2. 手机端「学习工作台 → 设置页 → 导入恢复」选择该文件（逐文件 SHA-256 校验）。

## 开发脚本

| 命令 | 说明 |
|---|---|
| `npx tsc --noEmit` | 类型检查（DI 引用纪律的编译时保障） |
| `npx vitest run` | 单元测试（core 领域层 + memory 桥） |
| `npx vite build` | 渲染层构建 |
| `npx cap sync` | 同步 web 资源到原生工程 |
| `cd android && ./gradlew.bat assembleDebug` | 原生 APK 打包（需 JDK 21） |