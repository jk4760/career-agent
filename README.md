# NextCareer

> 原 Career Agent，v0.5 起更名 NextCareer（Git 仓库名 `career-agent` 不变）。

个人求职一站式平台：AI 定时采集匹配岗位 → Web Portal 管理（岗位流 / 素材库 / 问题库 / AI 助手 / 偏好设置），后续接飞书机器人做每日推送与反馈闭环。

当前为 **骨架 v0.5**：页面与交互完整，数据走内存假数据，不接真实数据库。

## 技术栈

- 前端：Vite + React 18 + TypeScript + Tailwind CSS v4 + shadcn/ui（Base UI 版）+ react-router
- 数据库：PostgreSQL（本阶段只有 `db/schema.sql`，不连接真实库）
- 采集器：Python 脚本（后续里程碑）

## 运行

要求 **Node.js ≥ 22**（Vite 8 需要 `^20.19 || >=22.12`，本项目统一按 Node ≥ 22 标注；低版本 Node 20 会出现引擎警告）。

```bash
npm install
npm run dev      # 开发
npm run build    # 类型检查 + 生产构建
```

### 部署说明

静态托管时需配置 SPA fallback：所有路由 rewrite 到 `/index.html`（否则刷新 `/jobs` 等子路由会 404）。

## 架构

```
db/schema.sql            # 六张表的 PostgreSQL schema（M2 建库用）
src/
├── types/               # 实体类型 + JobStatus 派生类型（与 schema 对应）
├── lib/
│   ├── repository.ts        # Repository 接口 + Context/Hook
│   ├── memoryRepository.ts  # 内存实现 + 假数据（10 条岗位等）
│   └── fileImport.ts        # 素材导入：.md/.docx/.pdf 本地解析 + 启发式预填
├── components/          # LogoMark、JobRow、StatusBadge、FeedbackDialog、MaterialForm（抽屉）、QuestionForm、ui/(shadcn)
└── pages/               # JobsPage / MaterialsPage / QuestionsPage / AssistantPage / PreferencesPage
```

### 数据访问层（可替换设计）

页面只依赖 `Repository` 接口（`src/lib/repository.ts`），通过 Context 注入。骨架阶段由 `useMemoryRepository`（内存 + 假数据）实现；**M2 将用 Postgres 实现同一接口替换内存版，页面代码无需改动**。

注意一个实现约定：内存实现的状态放在 App 层，每次变更会生成新的 repo 实例，页面的 effect 监听 repo 变化自动重新拉取。因此**变更操作后不要手动用旧闭包 reload**（旧闭包读到的是变更前的数据，会把新数据覆盖回去）。

### 附件与持久化（重要）

- **素材库（materials）持久化在浏览器 localStorage**（仅本机本浏览器，key 带数据结构版本号，版本不匹配自动重置为种子数据）；其余模块（岗位/问题/偏好）为纯内存，刷新即重置。M2 迁 Postgres 后统一由数据库接管。
- 素材库支持导入 .md / .docx / .pdf 并挂为故事附件。**文件本体只存于会话内变量**：刷新页面后故事与附件元信息（文件名/大小）仍在，但文件本体丢失，点下载会提示重新导入。M2 接后端 + 对象存储后解决。

### 数据模型要点

- `feedback_events` 是追加式事件日志，不改写状态——岗位状态永远由"最新一条事件"派生（`new` = 无事件），允许改判。这是未来偏好学习的数据资产。
- `materials` 一行 = 一个可讲的**故事**（不是项目），项目只是分组属性。
- ID 一律 UUID；`capability_l1/l2` 是受控词表（只服务筛选），`tags[]` 是自由标签，`facets[]` 是经历/公司标签（chips 由数据派生），三者不混用。

## 页面

| 路由 | 说明 |
|---|---|
| `/jobs` | 岗位流：状态筛选 tab、行式列表展开详情、感兴趣/不合适/已投递反馈（可附一句话 comment） |
| `/materials` | 素材库：facet chips + 搜索 + 项目树状大纲，markdown 渲染，文件导入（.md/.docx/.pdf）与附件下载，新建/编辑抽屉表单，删除二次确认 |
| `/questions` | 问题库：新增问题表单、详情区即编辑区（问题/分类/草稿/关联故事/把握度）、列表 hover 删除（二次确认），未关联计数提醒 |
| `/assistant` | AI 助手：会话列表 + 对话区 UI 骨架（真实对话能力 M5 上线，发送禁用） |
| `/preferences` | 偏好设置：行业/职能/城市/薪资底线/包含排除关键词，保存即生效 |

## 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | Portal 骨架（本仓库当前状态） | ✅ |
| M2 | 接真实 Postgres（Supabase/Neon），实现 DB 版 repository + 附件对象存储 | 未开始 |
| M3 | Python 采集脚本：岗位抓取、清洗、去重（dedup_key） | 未开始 |
| M4 | 匹配打分 + 飞书机器人推送 + 反馈回写偏好（动态权重） | 未开始 |
| M5 | AI 助手真能力：LLM 后端 + 对话记忆 + 附件上传对象存储 | 未开始 |
