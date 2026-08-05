# zdmclock-clone 生产镜像
# 说明：前端构建产物 web/dist 已随仓库入库，镜像内无需重新构建；
#       仅安装 server 运行时依赖，跳过 devDependencies（含 cross-env / vite / vue 等）。
FROM node:20-alpine

# 以非 root 用户运行，降低容器逃逸风险
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

WORKDIR /app

# 1) 仅复制依赖清单，充分利用层缓存
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

# 2) 仅安装生产依赖（express/cors/dotenv）；--omit=dev 跳过 cross-env、vite、vue 等
RUN npm ci --omit=dev --no-audit --no-fund

# 3) 复制全部源码与已构建前端（.dockerignore 已排除 .env 与 server/data*，凭证与本地数据不进镜像）
COPY . .

# 4) 创建数据目录并改属主：命名卷首次挂载会沿用此权限，避免非 root 用户写入失败
RUN mkdir -p /app/server/data && chown -R nodejs:nodejs /app/server/data

# 归属非 root 用户
RUN chown -R nodejs:nodejs /app
USER nodejs

# 生产环境才托管前端静态资源（server/src/index.js 中由 NODE_ENV 开关）
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 直接运行 server，绕过根 start 脚本里的 cross-env（devDependency 已被跳过）
CMD ["node", "server/src/index.js"]
