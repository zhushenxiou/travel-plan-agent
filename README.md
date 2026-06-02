# Claw 旅行规划师

AI 驱动的智能旅行规划助手 — 实时搜索 · 智能行程 · 地图展示 · 花费统计 · 一键分享

## 功能

- **AI 对话** — 基于大语言模型，自动识别旅行意图，多轮对话规划行程
- **行程生成** — 根据需求自动生成多日行程，含景点、时间、费用、贴士
- **地图展示** — Leaflet + 高德瓦片地图，标记行程地点并绘制路线
- **花费统计** — 按天/按活动统计预算与实际花费，支持打卡记录
- **行程分享** — 生成分享链接，无需登录即可查看行程
- **行程对比** — 最多 4 个行程横向对比预算与活动
- **记忆系统** — 双层记忆（短期/长期），自动提取用户偏好与旅行经验
- **热门推荐** — 实时抓取旅行热门话题与目的地推荐
- **用户系统** — 注册/登录、Token 鉴权

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.11 · FastAPI · SQLite · OpenAI 兼容 API · 高德地图 Web服务 API |
| 前端 | React 18 · TypeScript · Vite 6 · Tailwind CSS 3 · Zustand · Leaflet · Framer Motion |
| 基础设施 | Uvicorn · Prometheus · Redis（可选） |

## 项目结构

```
claw7/
├── api/                    # API 路由与中间件
│   ├── server.py           # FastAPI 主文件
│   └── intl_coords.py      # 国际目的地坐标库
├── core/                   # 核心业务逻辑
│   ├── agent.py            # Agent 主循环
│   ├── llm.py              # LLM 调用封装
│   ├── reasoning.py        # 推理引擎
│   ├── memory.py           # 双层记忆管理
│   ├── auth.py / token.py  # 用户认证与 Token
│   ├── itinerary/          # 行程模块（schema / repository / parser）
│   ├── intent/             # 意图识别
│   ├── emotion/            # 情感检测
│   ├── profile/            # 用户画像
│   ├── audit/              # 审计日志
│   └── metrics/            # 监控指标
├── tools/                  # 工具层（旅行 / 高德 / 飞猪 / HTTP）
├── infra/                  # 基础设施（数据库 / 健康检查）
├── frontend/               # React 前端
│   ├── src/pages/          # 页面组件
│   ├── src/components/     # 通用组件
│   └── src/hooks/          # Zustand 状态管理
├── tests/                  # 测试
├── docs/                   # 文档
│   ├── README.md           # 详细项目说明
│   └── API.md              # 接口文档
├── config.py               # 配置管理
├── app.py                  # Agent 构建
├── main.py                 # CLI 入口
└── .env.example            # 环境变量模板
```

## 快速开始

### 1. 安装依赖

```bash
# 后端
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 前端
cd frontend
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 API Key
```

### 3. 启动服务

```bash
# 后端（端口 8000）
uvicorn api.server:app --reload --host 0.0.0.0 --port 8000

# 前端（端口 5173，自动代理 /api 到后端）
cd frontend
npm run dev
```

打开 http://localhost:5173 即可使用。

### 4. CLI 模式

```bash
python main.py chat
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `CLAW_API_KEY` | ✅ | — | LLM API 密钥 |
| `CLAW_MODEL` | ❌ | `qwen3.5-122b-a10b` | 模型名称 |
| `CLAW_BASE_URL` | ❌ | 通义千问 | OpenAI 兼容 API 地址 |
| `AMAP_WEBSERVICE_KEY` | ✅ | — | 高德地图 Web服务 Key |
| `FLYAI_API_KEY` | ❌ | — | 飞猪旅行 API Key |

完整配置项参见 [.env.example](.env.example)。

## 文档

- [项目详细说明](docs/README.md)
- [API 接口文档](docs/API.md)

## 测试

```bash
pytest tests/ -v
```

## License

MIT
