# FSD：Jenkins 经本地 Agent 访问

| 要素 | 内容 |
|------|------|
| 时间 | 2026-10-31 |
| 关联服务 | releasetracker web、rt-agent、Chrome extension |
| 关联功能模块 | jenkins |
| 提交 | feat(jenkins): 经本地 Agent 访问 Jenkins，凭证仅存于本机 |

技术规格：[tsd_jenkins_local_agent.md](../../tsd/jenkins/tsd_jenkins_local_agent.md)。

## 1. 用户可见行为

| # | 行为 |
|---|------|
| F1 | 操作者在扩展弹窗「Jenkins」中填写 Base URL / 用户名 / API Token，保存到本机 Agent；可用「Test Jenkins」验证（含 Netbird 可达性） |
| F2 | `/jenkins` 页不再保存服务端凭证，仅展示 Agent 侧配置状态与设置指引，并支持通过 Agent 测连 |
| F3 | 部署步骤加载服务列表、分支参数、触发构建、轮询状态均依赖扩展 + Agent；Agent/扩展缺失时给出明确错误 |
| F4 | 自动运行中的 Jenkins 步骤同样走本机 Agent，不再要求部署服务器能访问 Jenkins |
| F5 | 客户编辑页的 service→pod 下拉仍可从 Jenkins 拉服务列表，同样经 Agent |

## 2. 前置条件

- 本机已安装并运行 rt-agent，扩展已配置 Agent URL 与 auth token
- 本机（如经 Netbird）可访问 Jenkins
- 客户已配置 Jenkins view 或 job 映射

## 变更记录

- 2026-10-31 feat(jenkins): 经本地 Agent 访问 Jenkins，凭证仅存于本机 — 初版
