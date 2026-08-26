# zdmclock-clone 生产镜像（多阶段构建）
# 构建阶段：安装全部依赖（含 dev）并从源码构建前端 web/dist，保证镜像内产物与源码一致（M-12）；
# 运行阶段：仅安装 server 运行时依赖（--omit=dev，跳过 vite/vue 等构建工具），
#           复制 server 源码与「构建阶段已生成的」web/dist，避免把仓库里可能陈旧的 web/dist 直接打进镜像。

# ---- 构建阶段 ----
FROM node:20-alpine AS build
WORKDIR /app
# 仅复制依赖清单，充分利用层缓存
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --no-audit --no-fund
# 复制全部源码后从源码构建前端（不依赖仓库里已提交的 web/dist）
COPY . .
RUN npm run build   # vite build → web/dist（由 package.json 的 build 脚本驱动）

# ---- 运行阶段 ----
FROM node:20-alpine AS runtime
# 以非 root 用户运行，降低容器逃逸风险
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
WORKDIR /app
# 仅安装生产依赖（express/cors/dotenv）；--omit=dev 跳过 cross-env、vite、vue 等构建工具
COPY package.json package-lock.json ./
COPY server/package.json ./server/
RUN npm ci --omit=dev --no-audit --no-fund
# 复制后端源码（.dockerignore 已排除 .env 与 server/data*，凭证与本地数据不进镜像）
COPY server ./server
# 复制构建阶段生成的前端产物（已含内容哈希命名，无需运行时再构建）
COPY --from=build /app/web/dist ./web/dist

# 创建数据目录并改属主：命名卷首次挂载会沿用此权限，避免非 root 用户写入失败
RUN mkdir -p /app/server/data && chown -R nodejs:nodejs /app
USER nodejs

# 生产环境才托管前端静态资源（server/src/index.js 中由 NODE_ENV 开关）
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 存活探针：容器内固定回环探测根路径（SPA 兜底返回 200），确认进程与 HTTP 服务正常。
# 命中非 /api 路径故不受鉴权影响；仅作 liveness，不校验业务逻辑。alpine 自带 busybox wget。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

# 直接运行 server，绕过根 start 脚本里的 cross-env（devDependency 已被跳过）
CMD ["node", "server/src/index.js"]
