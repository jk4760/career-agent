# M5 SSH 隧道访问与公网收敛 Runbook

当前状态：**仅准备，尚未启用公网收敛**。必须先在隧道内验证 Web、Basic Auth、现有 API 和 SSE，再启用 `web/nginx.private.conf`。

## 1. 建立隧道

在本机终端运行：

```bash
ssh -i ~/.ssh/nextcareer_deploy -N -L 8080:127.0.0.1:80 ubuntu@49.235.68.206
```

终端需要持续运行。该命令使用现有部署通道，不复制或移动 Claw 私钥，不修改 Claw wrapper、白名单或定时任务。

## 2. 隧道内验收

1. 浏览器打开 `http://localhost:8080`，使用现有 Basic Auth 凭据。
2. 检查岗位、素材、问题、偏好和 AI 面板均能读取。
3. 在 fake provider 验收环境确认 AI SSE 和报告页面使用同源相对 `/api` 路径，不回到公网 IP。
4. 命令行可运行 `curl -u nextcareer http://localhost:8080/api/health`；curl 会交互式询问口令，不要把口令写进命令、文档或日志。

## 3. 启用前的已知影响

- 公网手机打开旧 Web 深链会受限；首版不重设计卡片。
- `/feishu/callback` 仍必须公网可达，安全继续由 Verification Token / Encrypt Key 保护。
- 5432 仍无宿主端口；`/internal/*` 仍只走 loopback。
- 启用后必须实测明文/加密 Challenge、现有卡片反馈与撤销。

## 4. 启用与回滚

启用前先备份当前 Nginx 文件并执行 `nginx -t`。只有用户确认隧道可用后，才把 `web/nginx.private.conf` 部署为 `default.conf`。

回滚时恢复原 `default.conf`，再执行 `nginx -t` 并只重建/重载 Web；不反复重启数据库或 API，不修改 Claw 配置。
