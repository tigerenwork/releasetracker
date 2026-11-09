# FSD：ConfigMap 编辑审计历史

| 要素 | 内容 |
|------|------|
| 时间 | 2026-11-09 |
| 关联服务 | releasetracker web |
| 关联功能模块 | configmap |
| 提交 | feat(configmap): 新增 ConfigMap 编辑审计历史，可追溯增删改 |

技术规格：[tsd_configmap_history.md](../../tsd/configmap/tsd_configmap_history.md)。  
详细设计：[FSD-CONFIGMAP-HISTORY.md](../../docs/FSD-CONFIGMAP-HISTORY.md)。

## 1. 用户可见行为

| # | 行为 |
|---|------|
| F1 | 在 Pods Config 编辑器中，选中 ConfigMap 后可展开「Edit history」，按时间倒序查看历史 |
| F2 | 每条历史可展开，看到被 set/deleted 的 key；有旧值时展示旧值→新值；首次编辑前若无历史会多一条 Initial 基线 |
| F2a | 来源徽章：Pods UI / Release step / Auto-run / Initial |
| F3 | 成功保存后历史会刷新；「Last edited …」仍显示最近一次编辑摘要 |
| F4 | 从版本步骤或自动运行应用 ConfigMap 变更时，同样写入历史（含 release/step 关联） |
| F5 | 历史加载失败不影响继续编辑 ConfigMap |

## 2. 前置条件

- 数据库已初始化（含 `config_map_edit_history` 表）
- Agent ≥ 1.4.0 且可编辑 ConfigMap（与现有 Config 编辑能力相同）

## 变更记录

- 2026-11-09 feat(configmap): 历史记录旧值并在无历史时写入 Initial 基线 — 详情见 [fsd_configmap_history_changelog_20261109.md](./fsd_configmap_history_changelog_20261109.md)
- 2026-11-09 feat(configmap): 新增 ConfigMap 编辑审计历史，可追溯增删改 — 初版
