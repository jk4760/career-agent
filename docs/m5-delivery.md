# M5 全栈交付与验收报告

日期：2026-11-23
分支：`m5-ai-fullstack`
状态：代码与 fake 验收完成；生产部署、真实模型冒烟和公网收敛未执行。

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
| T2 SSE 对话 | 通过（fake） | 中文增量、参数、内部 assistant 回放、停止、幂等、401/429/5xx 不重试通过；真实模型冒烟未批准、未执行。 |
| T3 上下文 | 通过（fake） | 明确选择、数量/长度限制、超限标记、最近 6 轮通过；无摘要/标题隐藏调用。 |
| T4 报告 | 通过（fake） | 首次、增量、完整重建、no_change、并发、取消、截断、校验失败、历史快照、生成期间变更依据均有测试。 |
| T5 Web/浏览器 | fake 主路径通过 | 实际点击流式发送、上下文选择/搜索/应用、报告确认/生成/详情/快照；375px AI 底部抽屉与报告单栏通过。不是生产真实个人数据验收。 |
| T6 飞书与安全 | 部分通过 | 明文/加密 Challenge、伪造 token、报告 flag 通过；隧道尚需用户确认，公网尚未收敛，因此这两项不能写成已验收。 |

最终自动化结果：`31/31` 通过。另有 API TypeScript 检查、Web production build 和私有 Nginx `nginx -t` 通过。

## 6. 三段核心流程

### 预算预留/结算

按估算输入、可能的缓存写入和最大 completion tokens 做最坏情况预留。每日额度通过数据库原子条件占用；成功后按服务商分类 usage 结算并释放多余预留。请求已发出但 usage 缺失时按预留保守结算，不当作免费。

### SSE 中断

面板发送唯一 `client_request_id`，后端创建用户/助手消息并代理上游流。停止、下游断开都 abort 上游；内存累积文本，结束/停止/失败时一次落库。`length` 标记 `truncated`，不伪装成完整成功。

### 报告增量更新

指纹覆盖岗位、简历、已选素材的 ID、版本和 hash。无变化返回 `no_change`；更新请求携带上一版报告和当前差异，模型返回完整新 JSON；完整重建不携带上一版。任务期间依据变化时，新报告保存但立即显示“依据已变化”。

## 7. 部署与回滚

当前未部署生产。建议顺序：

1. 运行全部 fake 测试与构建，备份数据库并验证 migration 前滚。
2. 先上台账，核对生产模型/计费渠道并写价格；确认后再开启 `AI_BUDGET_ENFORCE`。
3. 对话、报告和飞书 flag 先保持关闭，完成 fake/浏览器验收后逐项开启。
4. 用户按 `docs/m5-private-access.md` 确认隧道可用后，才启用私有 Nginx；随后实测飞书回调与卡片反馈。
5. 真实模型只允许用户批准的小额冒烟，不跑批量，不用公网 HTTP 传真实简历。

回滚：

- 各新功能 flag 独立关闭；既有岗位评分、反馈和推送保留。
- Nginx 恢复原 `default.conf`，`nginx -t` 后只重载/重建 Web。
- 报告失败/取消/截断不覆盖旧成功版本；migration 不删除历史数据。
- 隧道不可用时先恢复公网访问，不反复重启整套容器。

## 8. 仍需用户配合

1. 按 runbook 建立并确认 SSH 隧道，批准后再收敛公网。
2. 决定是否批准真实模型小额冒烟；当前次数为 0。
3. 生产部署前确认服务器 `.env` 中实际模型的价格配置，并明确批准开启硬预算与各功能 flag。
4. 公网收敛后做一次飞书真实回调/卡片反馈回归。

本报告不包含真实 Prompt、个人资料、密钥或真实模型冒烟结果。
