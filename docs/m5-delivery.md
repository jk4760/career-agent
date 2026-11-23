# M5 全栈交付与验收报告

日期：2026-11-23
分支：`m5-ai-fullstack`
状态：生产已部署 migration `0004`–`0009`；AI 对话、简历报告、飞书报告按钮与摘要推送已开启；真实模型小额冒烟已执行；公网收敛已启用。硬预算仍关闭。

## 1. 开工审计结论

详见 `docs/m5-opening-audit.md`。关键事实：

- 当前简历权威数据源是 `preferences.background_text`，不存在独立简历中心。M5 复用该正文，以 preferences ID、`updated_at` 和 hash 追溯版本。
- 生产使用国内 Moonshot/Kimi API，实际模型为代码默认 `kimi-k3.1-pro`；服务器已有 Key，但未显式设置 base URL/model 环境变量。
- 原唯一付费路径为 `api/src/llm/scorer.ts`：串行最多 60 条，429 首次 + 三次退避；偏好变化另有异步重评入口。
- 飞书公网必要路径是 `/feishu/callback`；`/internal/*` 仅 loopback，Postgres 无宿主端口。
- 实际 AI 面板是用户已验收的 384px，未按旧原型回退到 224px。

## 2. Commit 与调用关系

| Commit | 内容 |
|---|---|
| `fbad54b` | 开工审计 |
| `7bfaa91` | 用量台账、精确价格、每日预算与测试 |
| `9aa2090` | 岗位评分逐请求预算接入 |
| `65f85df` | 会话/消息、上下文、SSE、停止与幂等后端 |
| `8433893` | AI 面板、上下文选择器、只读模型配置 |
| `13614d1` | 报告版本、差异、快照、生成/更新服务 |
| `656fecd` | 报告 Web、飞书摘要与手动更新入口 |
| `9fbba61` | SSH 隧道 runbook 与未启用的 Nginx 私有配置 |
| `791870c` | 岗位行窄屏兼容修复 |
| `7e4687e` | 全栈 fake 测试补齐 |
| `3024269` | 报告完整重建、取消竞态修复与测试 |

核心调用：

- 评分：`runScoring` → `scoreJobWithLLM` → `reserveModelCall` → 上游 → `settleModelCall`。
- 对话：`POST /api/ai/chat/stream` → `createChatStream` → 预算 → 上游 SSE → 消息落库。
- 报告：`generateReport` → 固定输入/快照 → 预算 → 严格 JSON 校验 → 追加版本；当前报告只认 `done`。
- 飞书报告：`card.action.trigger` → `generateReport` 快速回执；已有摘要根据 flag 走现有卡片分片器。

## 3. Migration 清单

| Migration | 内容 |
|---|---|
| `0004` | `model_usage_requests`、`model_budget_alerts` |
| `0005` | 每日预算互斥行 `model_budget_days` |
| `0006` | 每日原子额度 `total_amount` |
| `0007` | `conversations`、`messages` |
| `0008` | 报告设置、报告版本、不可变来源快照、报告推送记录 |
| `0009` | 报告任务 `generation_mode`（update/rebuild） |

均为新增表/字段，不删除既有表或数据。生产前滚前必须备份数据库；备份不包含 `.env`，按敏感数据管理。

## 4. Flag 与配置清单

默认/当前代码状态：

| 配置 | 默认 |
|---|---|
| `AI_BUDGET_ENFORCE` | `false` |
| `AI_CHAT_ENABLED` | `false` |
| `RESUME_STRATEGY_ENABLED` | `false` |
| `RESUME_STRATEGY_FEISHU_ACTION_ENABLED` | `false` |
| `RESUME_STRATEGY_FEISHU_PUSH_ENABLED` | `false` |
| `AI_DAILY_BUDGET_CNY` | `2` |

非敏感价格配置（单位：元/MTok）：

- 标准版：`AI_PRICE_KIMI_K3_1_PRO_{INPUT,OUTPUT,CACHE_HIT,CACHE_WRITE_5M,CACHE_WRITE_1H}_CNY_PER_MTOK`。
- Highspeed：`AI_PRICE_KIMI_K3_1_PRO_HIGHSPEED_{INPUT,OUTPUT,CACHE_HIT,CACHE_WRITE_5M,CACHE_WRITE_1H}_CNY_PER_MTOK`。

参考值已写入 `.env.example`；生产只能写实际启用模型的对应价格。秘密只放服务器 `.env`，不得写入这些文档、日志或 Git。

## 5. T0–T6 验收对照

| 测试 | 结果 | 证据与边界 |
|---|---|---|
| T0 预算 | 通过 | 单价换算、缓存分类、2 元边界、并发、释放预留、保守结算、上海跨日、告警去重均有自动化测试。 |
| T1 既有评分 | 通过 | fake 评分保持参数和结果；预算耗尽零调用；既有反馈评分回归通过，最终分仍允许超过 100。 |
| T2 SSE 对话 | 通过（fake + 生产冒烟） | 中文增量、参数、内部 assistant 回放、停止、幂等、401/429/5xx 不重试通过；生产真实对话小额冒烟 1 次已执行。 |
| T3 上下文 | 通过（fake） | 明确选择、数量/长度限制、超限标记、最近 6 轮通过；无摘要/标题隐藏调用。 |
| T4 报告 | 通过（fake + 生产冒烟） | 首次、增量、完整重建、no_change、并发、取消、截断、校验失败、历史快照、生成期间变更依据均有测试；生产真实报告小额冒烟 1 次已执行，版本 1 保留。 |
| T5 Web/浏览器 | fake 主路径通过 | 实际点击流式发送、上下文选择/搜索/应用、报告确认/生成/详情/快照；375px AI 底部抽屉与报告单栏通过。不是生产真实个人数据验收。 |
| T6 飞书与安全 | 网络安全通过；卡片回归待确认 | 生产公网 Web/API 使用有效凭据返回 403，loopback 返回 200，实际 SSH 隧道到达 Basic Auth；明文/加密 Challenge 均为 200，伪造 token 为 403。本次未写入生产反馈，现有卡片反馈/撤销仍需真机回归。 |

最终自动化结果：`31/31` 通过。另有 API TypeScript 检查、Web production build 和私有 Nginx `nginx -t` 通过。

## 6. 三段核心流程

### 预算预留/结算

按估算输入、可能的缓存写入和最大 completion tokens 做最坏情况预留。每日额度通过数据库原子条件占用；成功后按服务商分类 usage 结算并释放多余预留。请求已发出但 usage 缺失时按预留保守结算，不当作免费。

### SSE 中断

面板发送唯一 `client_request_id`，后端创建用户/助手消息并代理上游流。停止、下游断开都 abort 上游；内存累积文本，结束/停止/失败时一次落库。`length` 标记 `truncated`，不伪装成完整成功。

### 报告增量更新

指纹覆盖岗位、简历、已选素材的 ID、版本和 hash。无变化返回 `no_change`；更新请求携带上一版报告和当前差异，模型返回完整新 JSON；完整重建不携带上一版。任务期间依据变化时，新报告保存但立即显示“依据已变化”。

## 7. 部署与回滚

生产当前状态：

1. migration 已前滚至 `0009`，AI 对话、简历报告、飞书报告按钮与摘要推送均已开启；`AI_BUDGET_ENFORCE=false`。
2. 真实模型对话和报告各执行 1 次小额冒烟，合计估算 ¥0.444223；未跑批量。
3. `web/Dockerfile` 默认使用 `web/nginx.private.conf`，Web 与普通 API 仅允许 loopback 和 Docker 网关，飞书回调保持公网。
4. 私有配置、公网拒绝、隧道认证入口及飞书明文/加密 Challenge 均已实测，详见 `docs/m5-private-access.md`。

回滚：

- 各新功能 flag 独立关闭；既有岗位评分、反馈和推送保留。
- Nginx 恢复备份的原 `default.conf`，`nginx -t` 后只重载 Web；Dockerfile 同时恢复使用 `web/nginx.conf`，避免重建后再次收敛。
- 报告失败/取消/截断不覆盖旧成功版本；migration 不删除历史数据。
- 隧道不可用时先恢复公网访问，不反复重启整套容器。

## 8. 仍需用户配合

1. 按 `docs/m5-private-access.md` 建立 SSH 隧道，通过 `http://localhost:8080` 和现有 Basic Auth 使用系统；公网旧 Web 深链返回 403 是预期行为。
2. 在飞书现有卡片做一次反馈与撤销真机回归；本次公网收敛未写入生产反馈数据。
3. 是否开启硬预算需另行明确批准，目前保持关闭。

本报告不包含真实 Prompt、个人资料或密钥；真实冒烟只记录次数与估算费用，不记录生成内容。
