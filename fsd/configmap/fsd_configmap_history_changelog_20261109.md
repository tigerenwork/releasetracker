# FSD 变更：ConfigMap 编辑审计历史

| 要素 | 内容 |
|------|------|
| 时间 | 2026-11-09 |
| 对应规格 | [fsd_configmap_history.md](./fsd_configmap_history.md) |
| 提交 | feat(configmap): 历史记录旧值并在无历史时写入 Initial 基线 |

## 本次变更

- 历史展开后展示旧值→新值（新增 key 标为 added；删除展示被删值）
- 首次被追踪的 ConfigMap 编辑前会多一条 Initial 基线
- 来源徽章增加 Initial

## 涉及代码

- `src/components/pods/config-map-history-panel.tsx`
