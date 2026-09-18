# ==============================================================================
# Doujiao Remote Assistance - Signaling Server Dockerfile
# ==============================================================================
FROM node:22-alpine

WORKDIR /app

# 拷贝信令服务源码与配置文件
COPY package.json tsconfig.json ./
COPY src/ ./src/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# 启动原生无外部依赖的高性能信令服务
CMD ["node", "src/server.ts"]
