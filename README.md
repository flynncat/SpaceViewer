# SpaceViewer · 3D Solar-System & Near-Earth Object Monitor

> 使用 Three.js + Express 实现的「太阳系 / 近地天体 / 流星陨石」实时可视化监控。参考 NASA NeoWs 与公开陨石资料，支持示意比例 / 真实比例双模式、时间轴回放、收藏订阅等能力。

![license](https://img.shields.io/badge/license-MIT-brightgreen) ![node](https://img.shields.io/badge/node-%3E%3D20-43853d) ![threejs](https://img.shields.io/badge/Three.js-0.18x-000000) ![express](https://img.shields.io/badge/Express-5.x-lightgrey)

---

## 亮点

- **3D 太阳系交互预览**：可旋转 / 聚焦 / 重置，支持「示意比例」与「真实比例（Celestia 风格）」双模式
- **近地小天体（NEO）实时数据**：每日从 NASA NeoWs 聚合，失败自动回退到本地兜底数据
- **时间轴回放**：以当前时间为中心 -3d ~ +3d，支持倍速与前进 / 倒放
- **选中目标详情 + 收藏 / 订阅**：所有收藏、订阅阈值保存在浏览器 LocalStorage
- **三目标对比看板**：从尺寸、速度、最近距离、风险级别并排对比
- **著名陨石图鉴**：本地内置资料，支持关键词与类型筛选
- **服务端兜底与缓存**：NASA 超时 / 限流时平滑降级到本地 JSON + 简化太阳系
- **零构建步骤**：纯静态前端 + Node.js 运行时，方便部署到任意 VPS

---

## 快速开始（本地）

需要 Node.js **20+**。

```bash
git clone https://github.com/flynncat/SpaceViewer.git
cd SpaceViewer
npm install
cp .env.example .env   # 可选：填入真实 NASA_API_KEY 取得更高速率
npm run dev
```

默认打开 `http://localhost:5173`。

## 自检

```bash
npm run self-check         # 基础存活检查
npm run self-check:deep    # 深度检查（含接口、数据结构）
```

---

## 项目结构

```
.
├── client/                 # 前端（纯静态，零构建）
│   ├── index.html
│   ├── app.js              # Three.js 场景 / UI / 交互全部逻辑
│   ├── styles.css
│   └── assets/textures/    # 行星纹理
├── server/
│   └── server.js           # Express API + 静态资源服务
├── shared/
│   └── data/               # 著名陨石 / NEO 兜底数据
├── scripts/                # 自检脚本
├── Dockerfile              # 一键容器化
├── ecosystem.config.cjs    # PM2 进程配置
└── .env.example            # 环境变量模板
```

## 环境变量

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `5173` | 服务监听端口 |
| `NASA_API_KEY` | `DEMO_KEY` | NASA API Key，建议前往 [api.nasa.gov](https://api.nasa.gov/) 申请免费 key 以提高限速 |

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务健康检查 |
| GET | `/api/notable` | 著名陨石图文库 |
| GET | `/api/neo/today?limit=28` | 当日近地小天体（NASA NeoWs + 兜底） |
| GET | `/api/source/status` | 各数据源可用性诊断 |
| GET | `/api/meteorites/catalog?limit=100&q=` | NASA 公开陨石目录 |
| GET | `/api/combined/home` | 首页组合数据聚合接口 |

---

## 部署到自己的服务器

以下以常见的 Linux VPS（Ubuntu/Debian）为例，提供三种部署方式，按需选一种即可。

### 方式 A · PM2（推荐）

```bash
# 1. 安装 Node.js 20（若未安装）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 拉代码并安装依赖
git clone https://github.com/flynncat/SpaceViewer.git
cd SpaceViewer
npm ci --omit=dev

# 3. 配置环境变量
cp .env.example .env
vim .env         # 写入你的 NASA_API_KEY、PORT 等

# 4. 通过 PM2 启动并开机自启
sudo npm install -g pm2
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup      # 按提示执行返回的 sudo 命令
```

查看状态与日志：

```bash
pm2 status
pm2 logs spaceviewer
```

### 方式 B · Docker

```bash
git clone https://github.com/flynncat/SpaceViewer.git
cd SpaceViewer

docker build -t spaceviewer:latest .
docker run -d \
  --name spaceviewer \
  --restart unless-stopped \
  -p 5173:5173 \
  -e NASA_API_KEY=your_key_here \
  spaceviewer:latest
```

### 方式 C · systemd（原生）

创建 `/etc/systemd/system/spaceviewer.service`：

```ini
[Unit]
Description=SpaceViewer
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/SpaceViewer
EnvironmentFile=/opt/SpaceViewer/.env
ExecStart=/usr/bin/node server/server.js
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now spaceviewer
sudo systemctl status spaceviewer
```

### 可选 · 使用 Nginx 做反向代理 + HTTPS

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

配合 `certbot --nginx` 即可自动签发 HTTPS 证书。

---

## License

[MIT](./LICENSE) © flynncat

## 致谢

- [NASA Open APIs](https://api.nasa.gov/) · NeoWs 近地天体数据
- [Three.js](https://threejs.org/) · 3D 渲染
- [CelestiaProject/Celestia](https://github.com/CelestiaProject/Celestia) · 真实比例可视化思路参考
- 叙事风格参考：[sanwan.ai](https://sanwan.ai/)
- 视觉结构参考：[Dan Koe](https://thedankoe.com/)
