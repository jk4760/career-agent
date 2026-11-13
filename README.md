# NextCareer

> 原 Career Agent，v0.5 起更名 NextCareer（Git 仓库名 `career-agent` 不变）。

个人求职一站式平台：AI 定时采集匹配岗位 → Web Portal 管理（岗位流 / 素材库 / 问题库 / AI 助手面板 / 偏好设置），后续接飞书机器人做每日推送与反馈闭环。

当前为 **M2**：前端 + Hono API + Postgres（Docker Compose 一键起全站），单服务器部署。

## 技术栈

- 前端：Vite + React 18 + TypeScript + Tailwind CSS v4 + shadcn/ui（Base UI 版）+ react-router（`web/`）
- 后端：TypeScript + Hono（Node 22）+ drizzle-orm + zod（`api/`）
- 数据库：PostgreSQL 16（Docker 容器；schema 单一事实来源为 `db/schema.ts`，迁移由 drizzle-kit 生成）
- 部署：Docker Compose 三服务（db / api / web），nginx 托管静态文件 + 转发 `/api/*` + 全站 Basic Auth
- 附件存储：服务器本地磁盘卷（容器卷 `/var/lib/nextcareer/uploads`）

## 运行

要求 **Node.js ≥ 22**（本机开发）与 Docker。

### 本机一键起全站（与线上同构）

```bash
cp .env.example .env   # 填 DB_PASSWORD / AUTH_USER / AUTH_PASS
docker compose up -d --build
npm run seed           # 或：docker compose exec -T api npx tsx src/seed.ts
```

打开 `http://localhost`，输入 Basic Auth 凭据即可。

### 本机开发（前端热更新）

```bash
docker compose up -d db api   # 只起 db + api
npm run dev --prefix web      # vite dev，/api 自动代理到 localhost:3001
```

### 环境变量（`.env`，绝不入库）

| 变量 | 含义 |
|---|---|
| `DB_PASSWORD` | Postgres 容器密码（仅 compose 内网使用，5432 不对公网开放） |
| `AUTH_USER` / `AUTH_PASS` | 全站 Basic Auth 凭据（nginx 容器启动时生成 htpasswd） |
| `WEB_PORT` | web 对外端口，默认 80（可选） |

## 架构

```
浏览器 ──HTTP──▶ web 容器（nginx :80，Basic Auth）
                   ├─ /      → 前端静态文件（SPA fallback → /index.html）
                   └─ /api/*  → api 容器 :3001（Hono）
api ──▶ db 容器（Postgres，仅内网可达，不暴露端口）
api ──▶ uploads 卷（附件原文件，按 materialId 分目录）
```

```
db/schema.ts             # drizzle schema（单一事实来源；schema.sql 仅历史存档）
db/seed.sql              # 种子数据（幂等，固定 UUID）
db/backup.sh             # pg_dump 备份脚本（保留最近 12 份）
api/src/                 # Hono 入口 + routes/（jobs/materials/questions/preferences/facets/attachments）+ db.ts + storage.ts
web/src/lib/
  ├── repository.ts          # Repository 接口（16 个方法，签名冻结）
  ├── apiRepository.ts       # M2：API 实现（fetch → /api/*）
  └── aiSettingsLocal.ts     # AI 对话配置：localStorage（豁免条款保留）
```

### 数据访问层（可替换设计）

页面只依赖 `Repository` 接口，通过 Context 注入。M2 已用 `apiRepository`（Postgres）替换内存实现；`getAISettings` / `saveAISettings` 按豁免条款仍走浏览器 localStorage，不走路由。

### 持久化说明

- 素材库、岗位、问题、偏好 → Postgres（服务器）
- **AI 对话配置（含 API Key）→ 浏览器 localStorage**（仅本机本浏览器，不提交任何服务器；M5 起迁后端代理）
- 附件原文件 → 服务器磁盘卷（元信息在 `materials.attachments` JSONB）

## 备份与恢复

- `db/backup.sh`：`pg_dump -Fc` 导出到 `backups/nextcareer-YYYY-MM-DD.dump`，自动保留最近 12 份
- 服务器 cron（每月 1 日凌晨 3 点）：`0 3 1 * * /opt/nextcareer/db/backup.sh >> /opt/nextcareer/backups/cron.log 2>&1`
- 恢复（把库删了从备份恢复）：

```bash
docker compose exec -T db psql -U nextcareer -c "DROP DATABASE nextcareer" -c "CREATE DATABASE nextcareer"
docker compose exec -T db pg_restore -U nextcareer -d nextcareer < backups/nextcareer-YYYY-MM-DD.dump
```

- 素材库是唯一的不可再生资产，建议定期把 `backups/` 额外拷贝到网盘或 GitHub 私有仓库（几十 KB 量级）

## 页面

| 路由 | 说明 |
|---|---|
| `/jobs` | 岗位流：状态筛选 tab、行式列表展开详情、感兴趣/不合适/已投递反馈（可附一句话 comment） |
| `/materials` | 素材库：facet chips + 搜索 + 项目树状大纲，markdown 渲染，文件导入（.md/.docx/.pdf）与附件下载，新建/编辑抽屉表单，删除二次确认 |
| `/questions` | 问题库：新增问题表单、详情区即编辑区、列表 hover 删除（二次确认），未关联计数提醒 |
| `/ai-settings` | AI 对话管理：API 地址 / API Key / 模型列表 chips，保存后面板模型下拉立即联动 |
| `/preferences` | 偏好设置：行业/职能/城市/薪资底线/经验上限（年，可空）/包含排除关键词，保存即生效 |

右侧常驻 **AI 助手面板**：头部模型下拉 + 收起/展开（30px 竖条），消息气泡与输入区样式已定稿，真实对话能力 M5 上线。

## 采集器（M3）

`collector/`：Python 3.12 采集包，从猎聘（主）与目标公司官网（次）低频抓取岗位，经三维度硬过滤后写入 jobs 表。**手动触发，每天最多一次完整采集**：

```bash
docker compose --profile manual run --rm collector
```

- **限流纪律（写死）**：搜索间隔 ≥2s、详情页间隔 3–5s、单 run 详情请求封顶 100（已入库岗位不再抓详情）；详情页遇 302（临时限流）即停手等待，不换 IP、不做指纹伪装
- **过滤规则**（入库前，宁可漏不可噪）：职能方向（title 命中 roles 或 JD 含 include 关键词；命中 exclude 直接丢）＋ 城市/远程（子串匹配，「远程」偏好兼容 Remote 字样；官网链接无地点信息时放行）＋ 职级年限（JD 提取，超过偏好经验上限则丢，提取不到放行）＋ 薪资上限低于偏好下限则丢 ＋ 发布超过 120 天则丢
- **官网监控**：`collector/config.yaml` 里 32 家公司清单，按域名注册适配器、JSON API 直连优先——飞书招聘（MiniMax/Soul）、腾讯（post/Query）、B 站（positionList）已直连，列表自带 JD、不消耗详情配额；字节/小红书/美团（SPA + 接口签名/交互受阻）记日志跳过，渲染兜底暂未做；未注册域名落回静态 HTML 链接抽取；career_url 为空的公司跳过——补 URL 后下 run 生效
- **合规**：仅供个人低频使用；日志记录每次请求的 URL 与时间戳；猎聘搜索走无 robots.txt 的接口主机，详情页路径不在禁止列表
- 每次运行结束输出报告：猎聘与官网分开计数（新增 / 重复跳过 / 补回 JD）、过滤明细、详情配额用量、是否触发限流

## 自动化（M4）

**打分**：最终排序分 = LLM 主导分（`jobs.llm_eval` 缓存，Moonshot/Kimi，temperature 0，prompt 版本化于 `api/src/llm/scorePrompt.ts`）+ 反馈调整（不合适 −20 / 感兴趣 +10 职能词连坐，60 天衰减）；LLM 缺失自动降级为规则五维参考分 + 反馈调整。规则分同时产出事实标签（薪资达标/★目标公司/7 天内等）。

**每日编排**：唯一入口 `ops/daily.sh`（flock 防重入，日志 `ops/logs/ops-YYYYMMDD.log`，失败非零退出 + 同群 ⚠️ 告警）：

```bash
ops/daily.sh collect-and-push   # 采集 → 评分 → 推送（早 8:30）
ops/daily.sh push-only          # 只推不采（晚 17:30）
ops/daily.sh status             # 只读巡检：采集/评分/推送状态
```

- 推送选择：新岗（未推过 + 最终分≥60 + 近 7 天入库）与无反馈满 5 天重推岗（生命周期最多 2 次）合并 Top 15，最终分降序；`push_log` 岗位级记录，仅推送成功才写（失败重试天然同批，at-least-once）；无候选静默不推
- **触发层**：Claw 云端定时（移交三步见 M4 文档 §3.5）；不稳时退回 crontab——条目在 `ops/crontab.example`，`crontab -e` 粘贴两行即切换（先停用 Claw 定时避免双触发）
- **内网接口**：`/internal/score`、`/internal/push`、`/internal/alert` 不挂 `/api` 前缀，nginx 不转发；api 端口仅绑 `127.0.0.1:3001` 供 ops 脚本使用
- 密钥（webhook、Moonshot key）只入服务器 `.env`，不进 git；评分/推送缺失配置时自动降级不失能

## 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | Portal 骨架 | ✅ |
| M2 | Postgres + Hono API + Docker Compose 部署 | ✅ |
| M3 | Python 采集脚本：岗位抓取、清洗、去重（dedup_key）（本仓库当前状态） | ✅ |
| M4 | LLM 主导匹配打分 + 飞书机器人推送 + 反馈回写 + ops 编排 | 施工中 |
| M5 | AI 助手真能力：LLM 后端代理 + 对话记忆 + 附件对象存储 | 未开始 |
