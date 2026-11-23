# M5 验收修正批记录

日期：2026-11-23
分支：`m5-acceptance-fixes`
基线：`2a95cb7`
状态：F1–F4 已修复并部署；F5 等待生产模型价格配置确认。用户 Web、飞书与硬预算真机验收尚未关闭。

## 1. Commit 与 migration

| Commit | 内容 |
|---|---|
| `091527a` | 岗位评分移除 429 自动重试与退避，增加评分专属失败回归 |
| `5eaafc0` | 报告从任务冻结快照生成，新岗位快照保存完整 JD，Prompt 保持有界压缩 |
| `4387595` | 报告请求前失败释放预留，已尝试上游后才保守或按 usage 结算 |
| `7bac542` | 修正本地隔离测试的外键清理顺序 |

本批没有新增或修改 migration，没有回填或重写历史快照。

## 2. F1–F5 对照

| 项目 | 原根因 | 修正与证据 | 生产状态 |
|---|---|---|---|
| F1 岗位评分重试 | 429 最多首次加三次退避请求 | 单次评分只调用一次 `callLLM`；401、429、500、断网、超时均一次请求、一条终态台账，`llm_eval` 保持 NULL；预算耗尽零上游调用。`api/src/llm/scorer.ts`、对应测试 | 已部署 |
| F2 冻结输入 | `runReport` 再读当前岗位、简历、素材 | `runReport` 只读取当前 `taskId` 的快照；上一版仅用于差异。A→B 回归断言实际 Prompt 只含 A，B 证据被过滤，完成后 `stale=true`，历史仍为 A | 已部署 |
| F3 请求前扣费 | Key 缺失发生在预留后，`finally` 统一保守结算 | Key 在预留前校验；预留后、fetch 前失败走 release；fetch 前置 `upstreamAttempted=true`，之后统一 settle。Key 缺失和本地请求前故障均零费用、零有效预留 | 已部署 |
| F4 完整 JD 快照 | 岗位 `content` 只存前 1200 字 | 新快照保存公司、岗位、地点、薪资和完整 JD，`hash=SHA256(content)`；Prompt 仅从冻结全文压缩 JD 到 1200 字。1300 字加末尾唯一标记测试通过 | 已部署；旧截断快照保持原样 |
| F5 生产硬预算 | `AI_BUDGET_ENFORCE=false`，实际模型五项价格未配置 | 已核对 Moonshot 国内 base URL、`kimi-k3.1-pro`、每日 2 元、`.env` 权限 600；标准版五项价格均为 missing，Highspeed 未启用 | 等待用户确认价格；未开启、未按 0 元放行测试 |

## 3. 预算状态机

```text
本地输入与 Key 校验
  → reserveModelCall
  → 请求前失败：releaseModelCall（actual=0、error=NOT_SENT、日预留完全释放）
  → fetch 前设置 upstreamAttempted=true
  → 已尝试请求：settleModelCall
      有真实 usage → 按分类 usage 结算并释放多余预留
      无 usage / 网络或超时 / HTTP 错误 → 按既有预留口径保守结算
```

每条报告预留只有一个终态分支。对话既有释放逻辑未改；评分仍统一经过预算服务。

## 4. 报告调用关系与快照口径

```text
generateReportAtomic
  → collectSources 读取创建时输入
  → inputHash + generating task + 当前任务完整快照
  → runReport(taskId) 读取该任务快照
  → 从冻结全文生成有界 Prompt 压缩视图
  → 使用同一冻结全文校验证据
  → 保存报告，不改旧成功版本
  → reportState 重新读取当前输入并计算 stale
```

新岗位快照是完整原文；Prompt 中单个 JD 仍最多 1200 字，未提高 completion 上限，也没有新增摘要或第二次模型调用。既有历史快照不可变，旧记录若只有 1200 字，只能视为旧格式截断快照，不使用当前 JD 回填。

## 5. 自动化与质量门禁

- F1 定向：`7/7` 通过。
- 报告 F2/F3/F4 定向：`14/14` 通过。
- 全量 API：实际 `43/43` 通过（原 31 项，本批净增 12 项）。
- Node：`v22.23.1`，无 engine 警告。
- API TypeScript：通过。
- Web production build：通过。
- Web lint：`0 errors / 15 warnings`，均为既有警告。
- `git diff --check`：通过。
- 私钥、`sk-...`、常见 Key/Token 特征扫描：无命中。
- diff 仅包含评分、报告及其虚构测试数据；无真实简历、素材、Prompt、模型回复、生产配置或数据库备份。

## 6. 部署与回滚

- 生产部署内容：F1–F4，仅重建 `api`；Web、Nginx、Claw 和定时任务未改。
- 数据库备份：`/opt/nextcareer/backups/nextcareer-pre-m5-acceptance-20261123-175645.sql`，权限 600，不包含 `.env`。
- 回滚 API 镜像：`sha256:a3b7a90198be2799003faf54f7d732a4c3c3cb9ac24683790a6e568f602d943e`。
- 部署后 API 镜像：`sha256:190dee7edc40743262e9aa26e4c2ec7b1600220d03801d0042a45253d3db164a`。
- 报告版本 3 与 3 个既有会话可读。
- 部署前后模型用量均为 5 条，最新时间未变化；本批真实模型调用为 0。
- 当前硬预算仍为 `false`，等待价格配置确认。硬预算限制系统估算模型费用，不等于服务商最终账单。

## 7. 待用户验收

### Web 隧道

通过既有 SSH 隧道、`http://localhost:8080` 和 Basic Auth，回归对话发送、停止、刷新恢复和上下文选择；生成或更新报告并查看历史来源；检查“依据已变化”、完整快照和预算提示。

### 飞书真机

对现有卡片做一次反馈与撤销；使用报告更新按钮，确认只创建一个任务；观察下一次既定推送只读最新成功报告，不自动生成报告，摘要不包含资料完整原文。

### 硬预算

确认生产价格配置与 `AI_BUDGET_ENFORCE=true` 的脱敏证据；日常观察 80% 提示、100% 停止与每日最多一次告警，不为验收故意烧到上限。

在用户完成上述验收前，状态只能是“修正已部署，等待用户验收”，不能写成 M5 全部关闭。
