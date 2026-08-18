# 暮雨笺 Android 验证指南

> APK：`muyujian-android/dist-apk/暮雨笺-3.0.6-debug.apk`
> 包名：`com.lingxi.notes.mobile`（debug 包，未经签名加固，可在任意 Android 设备侧载）

## 一、安装 APK（三选一）

### 路线 A：Android 真机 + USB（推荐，唯一完整验证触摸/通知的途径）

```bash
# 0. 手机开启「开发者选项 → USB 调试」，连接电脑
# 1. 确认设备识别
D:/muyujian-tooling/android-sdk/platform-tools/adb.exe devices
#    应看到一行 "XXXXXX device"（若显示 unauthorized，在手机上允许调试授权）

# 2. 安装（首次提示允许安装未知来源应用）
D:/muyujian-tooling/android-sdk/platform-tools/adb.exe install -r "D:/工作区/星河阙/muyujian-android/dist-apk/暮雨笺-3.0.6-debug.apk"

# 3. 启动（可选）
D:/muyujian-tooling/android-sdk/platform-tools/adb.exe shell am start -n com.lingxi.notes.mobile/.MainActivity

# 4. 查看运行日志（排错时用）
D:/muyujian-tooling/android-sdk/platform-tools/adb.exe logcat -s chromium:* Capacitor/Console:*
```

### 路线 B：真机免 USB（微信/QQ/网盘传 APK 文件到手机直接安装）
1. 把 `暮雨笺-3.0.6-debug.apk` 传到手机（文件传输/微信文件助手等）。
2. 手机上点击 APK 安装；系统提示「未知来源」时允许（Android 14+ 为「允许此来源的应用」）。

### 路线 C：模拟器（本机未装，需先下载 ~2GB 镜像，仅当无真机时）
```bash
source D:/muyujian-tooling/env.sh
# 1. 安装模拟器与系统镜像（经代理下载）
sdkmanager "emulator" "system-images;android-36;google_apis;x86_64" "platform-tools"
# 2. 接受许可（如提示）
yes | sdkmanager --licenses
# 3. 创建并启动 AVD（需硬件虚拟化 WHPX/HAXM 支持；无 GUI 的服务器环境无法显示窗口）
avdmanager create avd -n muyujian -k "system-images;android-36;google_apis;x86_64" -d pixel_7
emulator -avd muyujian &
# 4. 等设备出现后安装
adb wait-for-device && adb install -r "D:/工作区/星河阙/muyujian-android/dist-apk/暮雨笺-3.0.6-debug.apk"
```

## 二、功能验证清单（按优先级）

### 1. 启动与首屏
- [ ] 冷启动显示 Splash（约 1.2s）后进入主界面，无白屏/闪退
- [ ] 深色/浅色主题随「设置 → 外观」切换，重启后保持
- [ ] 顶栏不显示桌面窗口控制按钮（最小化/最大化/关闭）

### 2. 便签编辑（核心路径）
- [ ] 新建便签（命令面板「新建便签」）→ 输入 Markdown → 预览渲染（表格/代码高亮/数学公式 KaTeX）
- [ ] **移动端单栏布局**：编辑与预览不同屏；点顶栏预览按钮全屏预览、再点回编辑（默认只显示编辑器）
- [ ] 返回桌面再进入应用，内容仍在（数据落盘 `Documents/lingxi-data/notes.json`）
- [ ] 主界面无侧栏/状态栏，切换便签用命令面板（顶栏 Ctrl K 按钮）

### 3. 画布（移动端已禁用）
- [ ] 移动端**无任何画布入口**（侧栏/命令面板/工作台导航均无"画布"）
- [ ] 打开旧画布便签（桌面迁移来）显示占位提示卡，不进入画布编辑器

### 4. 工作台底部导航（全局适配）
- [ ] 底部导航仅 **7 项**（无"画布"）：总览/规划/专注/书架/题册/笔记/设置，按钮可点间隙大
- [ ] 页头不再显示"导出综合备份/导入恢复"（已移至设置）
- [ ] 设置页无"数据目录与综合备份"区（迁移功能已移除）

### 5. 键盘避让
- [ ] 聚焦编辑区弹出输入法时，编辑器视口自动上移不被遮挡（`adjustResize`）
- [ ] 收起键盘后视口还原

### 6. 覆盖层窗口与返回键
- [ ] 命令面板/侧栏打开「快速笔记」→ 全屏覆盖层出现
- [ ] 系统返回键：优先关闭覆盖层 → 退 WebView 历史 → 最后最小化应用
- [ ] 「今日计划窗口」「任务统计窗口」同理

### 7. 系统通知（Android 13+ 需授权）
- [ ] 学习工作台专注计时完成后弹出本地通知（首次会请求通知权限）

### 8. 数据备份与恢复（设置面板）
- [ ] **导出综合备份**入口在「设置（外观与壁纸）→ 数据备份与恢复」
- [ ] 导出后弹出系统分享/保存 `.muyujian-workspace` 文件
- [ ] **导入恢复**选桌面版导出的备份文件（逐文件 SHA-256 校验），恢复后便签/附件/工作台数据与桌面一致
- [ ] 手机导出 → 桌面导入 反向迁移同样通过

### 9. 降级路径（已知差异，验证提示文案友好）
- [ ] 「导出 Word/PDF」弹出系统分享/保存而非报错
- [ ] 「题册整理技能/Agent 提示词」：**显示「复制 Agent 提示词」按钮但不展示提示词全文**，点击按钮复制成功
- [ ] 导入书籍提示「移动端暂不支持生成首页封面」
- [ ] 工作台「打开案例目录」按钮移动端不显示

## 三、发现问题的反馈模板

```
设备/系统：<机型 + Android 版本>
操作路径：<点到哪一步>
预期：<应该怎样>
实际：<发生了什么 / 截图 / logcat 片段>
```

## 四、常见问题

| 现象 | 处理 |
|---|---|
| 安装报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | `adb uninstall com.lingxi.notes.mobile` 后重装 |
| 启动闪退 | `adb logcat -s AndroidRuntime:E` 抓崩溃栈，发我 |
| 白屏 | 确认 APK 为最新构建；`adb logcat -s chromium:*` 看 WebView 报错 |
| 画布相关 | 移动端已无画布入口；旧画布便签应显示占位提示卡 |
| 通知不弹 | 设置 → 应用 → 暮雨笺 → 通知 → 允许 |

## 五、Web 快速预览（不装 APK 先看 UI）

```bash
cd D:/工作区/星河阙/muyujian-android
source D:/muyujian-tooling/env.sh
npx vite dev --port 5173
# 浏览器打开 http://localhost:5173 —— web 适配器运行（localStorage 存数据、Blob 下载导出）
```
> 注意：此模式验证**渲染层功能**（编辑/预览/画布/设置），不覆盖原生插件（通知/分享/文件沙箱）；触摸手势可在 DevTools 设备模拟下体验。