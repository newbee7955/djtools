# 豆角远程协助信令与 TURN 中继服务 (Remote Assist Signal & TURN Service)

本目录提供豆角桌面端公网远程协助所需的信令分发服务及 TURN 中继服务部署配置。

## 架构说明

1. **信令服务 (`signal`)**:
   - 原生 Node.js 实现，零外部依赖（无需安装第三方 npm 包），基于 RFC 6455 规范高效处理 WebSocket 握手与二进/文本帧。
   - 设备身份注册管理：存储在线设备的 9 位设备码（基于公钥哈希派生）、公钥与活跃连接映射。
   - 端到端消息转发：中继握手协商（Offer / Answer / Candidate）、配对请求、确认与断开。
   - 动态 TURN 临时凭据分发：为已连接客户端生成 5 分钟有效期的 HMAC-SHA1 临时凭据，防止 TURN 服务器遭盗用。

2. **TURN / STUN 服务 (`coturn`)**:
   - 基于标准开源 `coturn` 镜像，支持 RFC 5389 (STUN) 与 RFC 5766 (TURN)。
   - 当两端处于对称型 NAT（Symmetric NAT）或复杂防火墙导致 P2P 直连失败时，自动承载 WebRTC SRTP 音视频及 DataChannel 转发。

---

## 快速部署 (Docker Compose)

### 1. 配置环境变量
在当前目录创建 `.env` 文件或直接设置环境变量：
```bash
# 必填项：TURN 共享密钥与公网 IP/域名
TURN_SECRET=your_production_secure_turn_secret_here
TURN_HOST=117.72.108.46
PORT=8080

# 可选：连接鉴权 Token（设置后客户端连接必须携带 ?token=你的Token，防止未授权连接和扫描盗用）
SIGNAL_AUTH_TOKEN=your_custom_signal_token
```

### 2. 启动服务
```bash
docker compose up -d
```

### 3. 健康检查
```bash
curl http://localhost:8080/health
# 返回: {"status":"ok","onlineDevices":0}
```

---

## Nginx 反向代理与安全加固配置建议 (含 WSS / 证书 / 防扫描 / 限流防刷)

```nginx
# 1. 连接数与请求速率限制（防 CC 攻击和连接耗尽）
limit_conn_zone $binary_remote_addr zone=ws_conn_zone:10m;
limit_req_zone $binary_remote_addr zone=ws_req_zone:10m rate=10r/s;

server {
    listen 443 ssl http2;
    server_name signal.yourdomain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # 仅允许指定 Host 访问，防止全网扫描器通过 IP 直连嗅探
    if ($host !~ ^(signal.yourdomain.com)$) {
        return 444;
    }

    location / {
        # 单 IP 限制最多 10 个长连接，突发速率限制
        limit_conn ws_conn_zone 10;
        limit_req zone=ws_req_zone burst=20 nodelay;

        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

---

## 端口开放要求（云服务器防火墙）

- `8080/TCP` (或通过 Nginx 映射到 443/TCP)
- `3478/UDP` 及 `3478/TCP` (STUN/TURN 协议端口)
- `49152-65535/UDP` (TURN Relay 动态媒体中继端口范围)
