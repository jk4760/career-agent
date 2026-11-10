# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

求职者本人（单用户个人工具，无多租户计划）。使用场景：求职季每天查看 AI 采集到的匹配岗位，快速做出「感兴趣 / 不合适 / 已投递」判断；面试准备期维护故事素材与问题库。

## Product Purpose

个人求职一站式平台。AI 定时采集匹配岗位，Web Portal 统一管理岗位流、素材库、问题库与偏好设置，后续接飞书机器人做每日推送与反馈闭环。成功标准：岗位筛选决策在 Portal 内闭环完成，面试素材随取随用，反馈数据沉淀为偏好学习的资产。

## Positioning

反馈事件（feedback_events）是追加式事件日志，状态永远由最新事件派生、不改写历史——这份完整的决策轨迹是未来偏好学习（动态权重）的数据资产，是同类产品不会保留的机制。素材库以「一个可讲的故事」为一行，而非以项目为一行。

## Operating Context

- 桌面端优先的管理后台形态，中文 UI；375px 宽度下不横向滚动。
- 日常动线：看岗位流 → 反馈（可附一句 comment，允许改判）→ 维护素材/问题 → 调偏好。
- 飞书每日推送与回写为后续里程碑（M4），当前里程碑不接。

## Capabilities and Constraints

- 技术栈已定勿改：Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui + react-router；PostgreSQL（骨架阶段只有 `db/schema.sql`，数据访问走可替换的 repository 接口 + 内存实现）。
- 本阶段明确不做：登录鉴权、真实数据库、岗位采集、AI 匹配打分、飞书推送、附件上传。
- 数据约定：ID 一律 UUID；`tags[]` 自由标签与 `capability_l1/l2` 受控词表不混用；`JobStatus` 为派生类型（`new` = 无反馈事件）。
- 里程碑规划：M2 接真实 Postgres（Supabase/Neon），M3 Python 采集脚本，M4 匹配打分 + 飞书闭环。

## Brand Commitments

- 产品名固定为 **NextCareer**（v0.5 起，原 Career Agent；Git 仓库名 `career-agent` 不变），不可更改。Logo = 折线 N（见开工上下文 10.8），侧栏副标题「Jackie 的个人工作台」。
- UI 语言必须为中文，硬约束。

## Evidence on Hand

- 仅有开发用假数据（内存实现内置 10 条岗位种子数据）。无任何真实用户评价、案例、媒体报道——未来工作不得虚构此类内容。
- 完整产品决策记录：`../career-agent-开工上下文.md`（仓库外层目录）。

## Product Principles

1. 反馈即资产：每一次判断都沉淀为可学习的数据，追加式、不改写。
2. 故事优先于项目：素材以「可讲的故事」组织，服务面试表达而非档案管理。
3. 单用户极致顺手：不为多租户妥协，管理后台形态追求扫描效率与操作密度。
4. 骨架可替换：数据访问层面向接口，里程碑演进不推翻结构。
