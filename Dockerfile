# ---- 构建阶段：安装依赖并构建前端 ----
FROM node:18-alpine AS build
WORKDIR /app

# 先拷贝依赖清单，利用层缓存
COPY package.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install

# 拷贝全部源码并构建前端
COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM node:18-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# 直接复用构建阶段产物（含 node_modules、web/dist、server 源码）
COPY --from=build /app /app

EXPOSE 3000
CMD ["npm", "start"]
