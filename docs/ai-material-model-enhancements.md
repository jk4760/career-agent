# NextCareer 素材沉淀与多模型对话 · 交付记录

日期：2026-11-25
分支：`ai-material-model-enhancements`
状态：三组功能已完成并部署，等待用户真机验收；第二模型仅有 fake 与配置化能力，未宣称生产可用。

## 1. 基线、commit 与 migration

- 最新 `main`：`5099ba8`，是当前集成分支祖先。
- 完整 M5 基线：`3ad52ca`，生产关键文件校验和一致。
- 本批无回滚或重复 M5 修复，未展开 AI 空回复排查。

| Commit | 内容 |
|---|---|
| `8c398de` | 能力域支持预设选择、自定义、清空和 IME Enter 处理 |
| `f2021e7` | 素材新建／编辑表单直接添加附件、失败重试、同名替换与 25 MB 后端校验 |
| `0732c16` | AI 回复编辑确认后保存素材／问答，来源表、事务、唯一去重与详情跳转 |
| `55162aa` | 服务端模型目录、新建会话选择、会话固定模型与预算／能力映射 |
| `8a7d50e` | AI 保存后 focus 导航重新加载目标列表 |
| `2a905e3` | Compose 与 `.env.example` 模型目录配置 |

Migration：`0010_wandering_vulture.sql`，仅新增 `ai_message_saves` 表、外键、目标索引和 `(message_id, target_type)` 唯一约束；没有删表、删字段或历史回填。

## 2. 素材库表单

- `web/src/components/MaterialForm.tsx`：能力域使用原生可输入下拉框，建议项不再限制自定义；单值、trim、40 字上限、可清空，facets 仍独立驱动故事方向。
- 新建时 ID 在首次保存前固定；故事保存成功后逐文件上传并更新元信息。部分失败时保留故事和成功附件，重试只处理失败／待上传文件，不重复创建故事或已成功附件。
- 编辑显示已有附件；新增多文件展示待上传、上传中、成功、失败状态。同名替换，单文件 25 MB，附件不解析覆盖正文。
- 未保存附件或保存中关闭有提示；取消不创建故事、不调用上传。
- `api/src/routes/attachments.ts` 增加 25 MB 服务端 413 拒绝。

浏览器结果：自定义“Agent 评测”刷新后保留；两个附件均显示；模拟首个上传失败后重试成功，故事未重复；桌面与 375px 表单和附件区无横向溢出。

## 3. AI 回复保存

- 仅 `role=assistant`、`status=done` 且正文非空的消息显示保存入口；streaming、stopped、error、truncated、空正文不开放。
- `SaveAIReplyDialog` 强制用户编辑确认；标题／问题只用来源用户问题本地预填，不为标题额外调用模型。
- `POST /api/ai/messages/:id/save` 校验消息、会话归属、目标字段和长度。目标分别写入 `materials` 与 `interview_questions`，AI 原文不覆盖用户确认内容。
- `ai_message_saves` 保存 `source_type / conversation_id / message_id / provider / model / saved_at / target_type / target_id`，不包含 reasoning、providerMessage 或完整上下文。
- 同一事务创建目标与来源；唯一冲突回滚多余目标后返回已保存目标。重复或并发保存不重复计数，同一消息可分别保存素材和问答各一次。
- 保存成功后提供查看素材／问答，focus 导航重新加载并显示来源模型与时间。取消零请求、零写入；保存本身零模型调用。

后端定向测试 `5/5`：编辑覆盖、双目标、重复与并发去重、状态拒绝、来源脱敏、事务失败零半截记录和 `fetch=0`。浏览器已验证素材编辑确认、问答跳转和来源展示。

## 4. 新建会话模型目录

- 默认目录项由现有 Moonshot 配置生成；额外项只能来自服务端 `AI_CHAT_MODEL_CATALOG_JSON`，创建接口只接受 `catalogId`。
- 目录项服务端字段：`id / label / provider / model / baseUrl / apiKeyEnv / enabled / maxCompletionTokens / capabilities`。
- 浏览器只获得非敏感 `id / label / provider / model / configured / enabled / is_default / capabilities / priceConfigured / disabledReason`，不包含 base URL、Key 环境变量名、Secret 或价格。
- 创建时后端重新检查白名单、Key、完整价格、enabled、streaming 与 usage；不接受前端任意 model、base URL 或价格。
- 会话持久化 provider／model，发送只读取会话记录。旧默认模型在全局默认变化后仍按旧会话解析，不静默换模，历史不跨会话回放。
- `reasoning_effort=low` 仅用于声明 reasoning 能力的目录项；completion 上限和 base URL 按目录项，预算 provider／model／价格按会话映射并共享每日总预算。
- 岗位评分、简历报告和定时任务仍读取原 Moonshot 配置，不读取新会话选择。

定向测试与既有对话回归 `9/9`：默认／备选、伪造配置、配置／价格／能力拒绝、固定模型、旧默认变化、独立价格共享预算、不发送 Kimi 专属参数、失败不换模不重试。桌面与 375px 新建弹窗已点击验证。

## 5. 全量质量门禁

- API 全量：实际 `54/54` 通过。
- API TypeScript：通过。
- Web production build：通过。
- Web lint：`0 errors / 19 warnings`（15 个既有，4 个本批新增同类 Hook 警告）。
- `git diff --check`：通过。
- Impeccable 静态设计检测：无命中。
- 私钥、`sk-...`、常见 Key／Token 特征扫描：无命中；测试只用虚构数据和 fake provider。

## 6. 生产配置、部署与回滚

生产当前真正可用模型仅有：

| provider | model | configured | enabled | priceConfigured |
|---|---|---|---|---|
| `moonshot` | `kimi-k3.1-pro` | true | true | true |

- `AI_CHAT_ENABLED=true`，`AI_BUDGET_ENFORCE=true`，每日总预算 2 元不变。
- 生产未设置 `AI_CHAT_MODEL_CATALOG_JSON`，没有第二模型可用状态。
- 仅重建 API 与 Web；Nginx、Claw、定时任务、评分和报告模型未改。
- 数据库备份：`/opt/nextcareer/backups/nextcareer-pre-ai-material-model-20261125-101252.sql`，权限 600，不包含 `.env`。
- 回滚 commit：`3ad52ca`。
- 回滚 API 镜像：`sha256:4c1394604d62c230f25adf247a523223029974f6274893701d877936382017a6`。
- 回滚 Web 镜像：`sha256:acab03b12016cddfbc4080ac7804de5bee8006bb07e156e386b77496c4595a00`。
- 新 API 镜像：`sha256:104849e928d8031485abb7e1dcd1d4dc9658900ebadc9cede41a2fff8d0b9ceb`。
- 新 Web 镜像：`sha256:27171607a60e5ea24d088cf69d8d479a82846f7490b7260812d63dfd633f1238`。
- 部署前后模型用量均为 20 条且最新时间不变，本批真实模型调用为 0。
- 回滚不删除已保存素材、问答或来源记录；migration 使用向前修复，不删表回滚。

## 7. 第二模型仍需用户补充

1. 希望启用的真实 model ID、provider、OpenAI 兼容 base URL 和计费渠道。
2. 服务器 Secret 配置方式：仅提供环境变量名（例如 `SECOND_MODEL_API_KEY`），Key 本体只写服务器 `.env`，不发聊天或 Git。
3. 输入、输出、缓存命中、5min／1h 缓存写入价格（元/MTok），需与渠道核对。
4. streaming、usage、reasoning、json_schema 的实际支持情况与 completion 上限。
5. 是否启用目录项，以及另行批准的真实冒烟次数和金额上限。

## 8. 待用户最终验收

- 素材库：自定义能力域并刷新；新建／编辑直接添加附件；验证一次失败提示与重试不重复创建故事。
- AI 回复：把一条成功回复分别编辑保存为素材和问答，检查来源、去重、跳转、取消不入库及保存零模型调用。
- 新建会话：用当前模型创建并确认旧会话行为不变。没有第二模型时只验收目录展示与 fake 证据；第二模型真实验收需另行批准。
- 确认岗位评分和报告仍使用原模型。
