#!/bin/sh
# 容器启动时从环境变量生成 Basic Auth 凭据文件，然后启动 nginx
set -e
htpasswd -bc /etc/nginx/.htpasswd "${AUTH_USER:-nextcareer}" "$AUTH_PASS"
exec nginx -g 'daemon off;'
