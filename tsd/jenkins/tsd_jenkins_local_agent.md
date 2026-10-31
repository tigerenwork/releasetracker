# TSD：Jenkins 经本地 Agent 访问

| 要素 | 内容 |
|------|------|
| 时间 | 2026-10-31 |
| 关联服务 | releasetracker web、rt-agent、Chrome extension |
| 关联功能模块 | jenkins |
| 提交 | feat(jenkins): 经本地 Agent 访问 Jenkins，凭证仅存于本机 |

功能规格：[fsd_jenkins_local_agent.md](../../fsd/jenkins/fsd_jenkins_local_agent.md)。

## 1. 决定

| # | 决定 |
|---|------|
| P1 | Jenkins HTTP 不再由 Next.js 服务端直连；改为 web → extension → local agent → Jenkins |
| P2 | `baseUrl` / `username` / `apiToken` 只写入 `~/.config/rt-agent/config.json`（0600），服务端 DB 与页面均不持有 apiToken |
| P3 | Extension popup 负责采集并 `PUT /api/v1/settings/jenkins`；扩展不持久化 Jenkins token |
| P4 | Agent 提供 `POST /api/v1/jenkins/request`，注入 Basic Auth；绝对 URL 限制为已配置 Jenkins 同源 |
| P5 | 服务端仅保留客户 view/job 映射与 `step_executions` 记录（`recordJenkinsDeploy` / `updateJenkinsDeployStatus`） |
| P6 | `src/lib/jenkins/client.ts` 改为 transport 无关；浏览器 transport 在 `browser.ts` |

## 2. 代码

- `agent/src/jenkins.js`、`agent/src/config.js`、`agent/server.js`
- `extension/popup.{html,js}`、`background.js`、`content.js`、`injected.js`
- `src/lib/jenkins/{client,browser}.ts`、`src/lib/actions/jenkins.ts`
- `src/lib/services/{agent-bridge,auto-runner}.ts`
- `src/components/executors/jenkins-executor.tsx`、`src/components/jenkins/jenkins-settings-form.tsx`

## 变更记录

- 2026-10-31 feat(jenkins): 经本地 Agent 访问 Jenkins，凭证仅存于本机 — 初版
