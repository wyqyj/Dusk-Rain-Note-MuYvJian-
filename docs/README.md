# 暮雨笺 · 项目文档

面向使用者的说明见根目录 [README.md](../README.md)，版本记录见 [CHANGELOG.md](../CHANGELOG.md) 与 [UPDATE_NOTICES.md](../UPDATE_NOTICES.md)（后者同时是应用内置资源，勿移动）。

## 交接与维护
- [HANDOVER.md](HANDOVER.md) — 工作交接文件：当前状态、已完成工作、建议执行顺序、环境注意事项与遗留事项
- [MAINTENANCE_GUIDE.md](MAINTENANCE_GUIDE.md) — 维护指南：功能到代码文件索引、数据边界、发布检查清单

## 计划书（plans/）
- [KNOWLEDGE_PRESETS_PLAN.md](plans/KNOWLEDGE_PRESETS_PLAN.md) — 知识库 + Agent 预设系统；阶段 0/1/2/F2b/F3 已完成，收尾进行中
- [DEEPSEEK_HARNESS_PLAN.md](plans/DEEPSEEK_HARNESS_PLAN.md) — 内置 Agent（dsh）方案与里程碑；已实施，保留作架构参考
- [FEATURE_OPTIMIZATION_PLAN.md](plans/FEATURE_OPTIMIZATION_PLAN.md) — 计划导入提示词 / 题册按数量导出 PDF / 画布滚轮隔离（backlog，未实施）

## 归档（archive/）— 已完成或已被取代
- [AGENT_BRIDGE_PLAN.md](archive/AGENT_BRIDGE_PLAN.md) — 对外 Agent 桥方案（已实现）
- [FIX_PLAN.md](archive/FIX_PLAN.md) — 15 项审查问题修复（全部完成）
- [INLINE_AGENT_PLAN.md](archive/INLINE_AGENT_PLAN.md) — 内置 Agent 旧方案（被 dsh 方案取代，仅历史参考）
- [OPTIMIZATION_PLAN.md](archive/OPTIMIZATION_PLAN.md) — UI 优化 v3.0.8（已完成）
- [OPTIMIZATION_EXECUTION_PLAN.md](archive/OPTIMIZATION_EXECUTION_PLAN.md) — 安全加固与工程化护栏执行计划（已完成）

## 工作日志（logs/）
- [2026-09-10](logs/WORK_LOG_2026-09-10.md) — 审查修复 + Agent Bridge + 内置 dsh 阶段 A–E
- [2026-09-11](logs/WORK_LOG_2026-09-11.md) — dsh Web GUI 收尾 + 第二/三阶段（知识库、预设）
- [2026-09-12](logs/WORK_LOG_2026-09-12.md) — 收尾提交 + F2b/F3 + 配置热重载 + 预设切换修复 + 文档生成实测

## 发布说明（releases/）
- RELEASE_NOTES_3.0.5 ~ 3.0.8：按版本的发布快照，汇总见根目录 [UPDATE_NOTICES.md](../UPDATE_NOTICES.md)；新版本发布说明也放在本目录。
