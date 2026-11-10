FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=1536
# monorepo workspaces：lockfile 在根目录
COPY package.json package-lock.json ./
COPY web/package.json ./web/
COPY api/package.json ./api/
RUN npm ci --workspace web --include-workspace-root=false
COPY web ./web
RUN npm run build --workspace web

FROM nginx:alpine
# apache2-utils 提供 htpasswd（容器启动时从环境变量生成 Basic Auth 凭据）
RUN apk add --no-cache apache2-utils
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
