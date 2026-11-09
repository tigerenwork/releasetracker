# TSD 变更：ConfigMap 编辑审计历史

| 要素 | 内容 |
|------|------|
| 时间 | 2026-11-09 |
| 对应规格 | [tsd_configmap_history.md](./tsd_configmap_history.md) |
| 提交 | feat(configmap): 历史记录旧值并在无历史时写入 Initial 基线 |

## 本次变更

- patch 增加可选 `before`，记录被改/删 key 的旧值
- `source` 增加 `init`：无历史且有 `before` 时先插入基线再记编辑
- Pods UI / 版本步骤 / auto-run 在 apply 前采集旧值并传入 `recordConfigMapEdit`

## 涉及代码

- `src/lib/db/schema.ts`
- `src/lib/actions/config-map-edits.ts`
- `src/components/pods/config-editor-dialog.tsx`
- `src/components/pods/config-map-history-panel.tsx`
- `src/components/executors/configmap-executor.tsx`
- `src/lib/services/auto-runner.ts`
