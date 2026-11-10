FROM node:22-alpine
WORKDIR /app
# monorepo workspaces：lockfile 在根目录
COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY web/package.json ./web/
RUN npm ci --workspace api --include-workspace-root=false
COPY db ./db
COPY api ./api
COPY web/src/types ./web/src/types
WORKDIR /app/api
CMD ["npx", "tsx", "src/index.ts"]
