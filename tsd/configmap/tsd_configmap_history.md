# TSD：ConfigMap 编辑审计历史

| 要素 | 内容 |
|------|------|
| 时间 | 2026-11-09 |
| 关联服务 | releasetracker web |
| 关联功能模块 | configmap |
| 提交 | feat(configmap): 新增 ConfigMap 编辑审计历史，可追溯增删改 |

功能规格：[fsd_configmap_history.md](../../fsd/configmap/fsd_configmap_history.md)。  
详细设计：[TSD-CONFIGMAP-HISTORY.md](../../docs/TSD-CONFIGMAP-HISTORY.md)。

## 1. 决定

| # | 决定 |
|---|------|
| P1 | 新增 append-only 表 `config_map_edit_history`；保留 `config_map_edits` 作为 last-edit 缓存 |
| P2 | 每次成功 `configApply` 后先 insert 历史，再 upsert last-edit；失败不阻断集群写入 |
| P3 | 记录 `source`：`pods-ui` / `release-step` / `auto-runner`；后两者附带 `releaseId`/`stepId` |
| P4 | 只存 patch（`set`/`delete`），不做 before 全量快照；不做回滚/操作者身份 |
| P5 | 启动时将尚无历史的 last-edit 行回填进 history（source 标为 `pods-ui`） |

## 2. 代码

- `src/lib/db/schema.ts`、`src/lib/db/index.ts`
- `src/lib/db/migrations/0004_add_config_map_edit_history.sql`
- `src/lib/actions/config-map-edits.ts`
- `src/components/pods/config-map-history-panel.tsx`、`config-editor-dialog.tsx`
- `src/components/executors/configmap-executor.tsx`
- `src/lib/services/auto-runner.ts`

## 变更记录

- 2026-11-09 feat(configmap): 新增 ConfigMap 编辑审计历史，可追溯增删改 — 初版
