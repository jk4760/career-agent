# M5 开工审计

日期：2026-11-22
基线：`main@5099ba8`
分支：`m5-ai-fullstack`

## 仓库与部署入口

- Web：`web/src/main.tsx` → `web/src/App.tsx`；Vite + React + TypeScript；右侧全局面板为 `web/src/components/AssistantPanel.tsx`。
- API：`api/src/index.ts`；Hono + Drizzle；业务路由位于 `api/src/routes/`，飞书模块位于 `api/src/feishu/`。
- 采集器：`collector/src/__main__.py`，通过 Compose 内部 `API_BASE=http://api:3001` 调用 `/api/jobs/ingest`。
- 数据库：`db/schema.ts` 是唯一 schema 来源；现有 migration 为 0000–0003，最新 0003 增加 `feedback_events.canceled_at`。
- 编排：`ops/daily.sh`，`collect-and-push` 执行采集 → 同步评分 → 推送，`push-only` 只推送；评分 HTTP 超时 5400 秒。
- 部署：`docker-compose.yml`；API 仅绑定 `127.0.0.1:3001`，数据库无宿主端口；Web 默认暴露 80 端口。
- Nginx：`web/nginx.conf` 统一托管 SPA、转发 `/api/` 与 `/feishu/`，默认全站 Basic Auth，仅 `/feishu/` 关闭 Basic Auth。

## 当前模型、计费渠道与调用路径

- 生产服务器存在 `MOONSHOT_API_KEY`；未显式设置 `MOONSHOT_BASE_URL` 和 `MOONSHOT_MODEL`，因此实际使用代码默认值：
  - base URL：`https://api.moonshot.cn/v1`
  - model：`kimi-k3.1-pro`
  - 渠道：Kimi/Moonshot 国内 API，不是会员计费，也不是 Highspeed。
- 当前唯一付费模型入口是 `api/src/llm/scorer.ts` 的岗位评分，尚无 AI 对话或简历方向报告调用。
- `scoreJobWithLLM` → `callLLM` → `POST /chat/completions`；参数包含 `reasoning_effort=low`、`response_format=json_object`，未设置 `max_completion_tokens`。
- 429 路径最多发起 4 次请求（首次 + 2s/4s/8s 三次退避）；其他 HTTP 错误、超时和解析失败不自动重试。
- `runScoring` 串行处理，单次最多 60 条；默认只补近 7 天未评分岗位。偏好七字段实际变化时另经 `preferences.ts` 异步触发近 60 天重评。
- 现有代码没有读取或持久化服务商 usage；没有统一预算台账。上游流式与分类 usage 仅作为待接入能力，未经真实冒烟，不记为已验证。

## 当前简历与相关数据权威来源

- 没有独立简历表、简历中心或简历版本表。
- 当前简历权威正文是单例 `preferences.background_text`；读取时取第一条 preferences 记录，版本可依据 `updated_at` 与内容 hash 追溯。
- 偏好字段：`industries / roles / locations / salary_min / keywords_include / keywords_exclude / experience_min / background_text / updated_at`。
- 素材：`materials` 表，正文 `content`，另有 `project / title / role / metrics / tags / facets / attachments / updated_at` 等字段。
- 反馈：`feedback_events` 的 `job_id / action / reason / comment / canceled_at / created_at`；有效状态必须排除已撤销记录并取最新状态。
- 推送：`push_log` 的 `job_id / channel / pushed_at / user_reply`。

## 飞书回调与公网边界

- 公网回调：`POST /feishu/callback`。
- 明文 Challenge 与加密 Challenge 均已有处理；加密体由 `FEISHU_ENCRYPT_KEY` 驱动 AES 解密，随后校验 Verification Token。
- `card.action.trigger` 已覆盖岗位三态反馈、原因选择、撤销和同步卡片重建；伪造 token 返回 403。
- 当前必须直接暴露公网的业务接口只有 `/feishu/callback`。Web、普通 `/api` 和内部 `/internal` 不需要为飞书服务器开放。
- `/internal/*` 只绑定宿主机 loopback，Nginx 不转发；数据库不暴露端口。
- 当前 app 卡片只有“完整列表见 Web”的文字，没有实际 Web 超链接；旧 webhook 卡片包含 `/jobs?focus=...` 深链。公网收敛后，旧深链在手机公网打开会受限，本批次不重设计卡片。

## 与施工指令的差异及处理

1. **简历来源**：指令中的“当前简历”不是现有独立实体。复用 `preferences.background_text`，以其记录 ID 作为 resume_id、`updated_at + hash` 作为版本；不新建第二套简历中心。
2. **AI 面板宽度**：指令写 224px，真实代码为用户已验收的 384px。保留 384px，不回退；400px 上下文浮层从面板附近弹出，不挤压主面板。
3. **生产用量与流式证据**：现有评分未读取 usage，流式尚未实测。先用 fake provider 完成实现与测试；真实模型调用需用户另行批准。
4. **旧文档中的模型价格注释**：业务代码已有价格注释，但不是可执行计费依据。M5 将价格迁移为非敏感环境配置，不以注释参与计算。

## 施工约束确认

- 自动化测试只使用 fake provider、虚构数据和假价格，不触发真实模型费用。
- 不修改 Claw 定时任务、私钥、白名单或受限 wrapper。
- 未经用户确认 SSH 隧道可用，不启用公网收敛。
- 未经用户明确批准，不发起真实模型冒烟。
