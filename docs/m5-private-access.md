# M5 SSH 隧道访问与公网收敛 Runbook

当前状态：**已启用公网收敛**（2026-11-23）。Web 与普通 API 仅允许 loopback 和 Docker 网关访问，飞书回调继续公网开放。

## 1. 建立隧道

在本机终端运行：

```bash
ssh -i ~/.ssh/nextcareer_deploy -N -L 8080:127.0.0.1:80 ubuntu@49.235.68.206
```

终端需要持续运行。该命令使用现有部署通道，不复制或移动 Claw 私钥，不修改 Claw wrapper、白名单或定时任务。

## 2. 隧道内访问

1. 浏览器打开 `http://localhost:8080`，使用现有 Basic Auth 凭据。
2. 检查岗位、素材、问题、偏好和 AI 面板均能读取。
3. 在 fake provider 验收环境确认 AI SSE 和报告页面使用同源相对 `/api` 路径，不回到公网 IP。
4. 命令行可运行 `curl -u nextcareer http://localhost:8080/api/health`；curl 会交互式询问口令，不要把口令写进命令、文档或日志。

Docker 发布端口会把 SSH 隧道请求转发到容器，Nginx 看到的来源是 `172.18.0.1`，因此私有配置额外放行这个网关地址。若重建 Docker 网络后隧道返回 403，先核对实际网关，不要直接放宽所有私网或公网地址。

## 3. 已知影响

- 公网手机打开旧 Web 深链会返回 403；首版不重设计卡片。
- `/feishu/callback` 仍公网可达，安全继续由 Verification Token / Encrypt Key 保护。
- 5432 仍无宿主端口；`/internal/*` 仍只走 loopback。

## 4. 本次启用验证

- 原 Nginx 配置备份于服务器 `/opt/nextcareer/backups/nginx.default.before-private-20261123-162951.conf`。
- 私有配置与修正后的 Docker 网关规则均通过 `nginx -t`，只热重载 Web，未重启数据库。
- 使用有效 Basic Auth：loopback Web/API 返回 200，公网 IP Web/API 返回 403。
- 实际 SSH 隧道可到达 Basic Auth；未携带凭据返回预期 401。
- 飞书明文和加密 Challenge 均返回 200 且正确回显，伪造 token 返回 403。
- 本次未对生产岗位执行反馈/撤销写入；现有卡片真机回归仍需单独确认。

## 5. 部署与回滚

`web/Dockerfile` 已将 `web/nginx.private.conf` 复制为 `default.conf`，后续正常重建 Web 会保持私有访问。

回滚时恢复备份的原 `default.conf`，执行 `nginx -t` 后只重载 Web；同时将 Dockerfile 的复制来源恢复为 `web/nginx.conf`，避免下次重建再次收敛。不反复重启数据库或 API，不修改 Claw 配置。
