# Claw 旅行规划师

AI 驱动的智能旅行规划助手，支持实时搜索、行程生成、地图展示、花费统计与行程分享。

## 功能概览

| 功能 | 说明 |
|------|------|
| AI 对话 | 基于大语言模型的智能旅行对话，自动识别旅行意图 |
| 行程生成 | 根据用户需求自动生成多日行程，含景点、时间、费用 |
| 地图展示 | Leaflet + 高德瓦片地图，标记行程地点并绘制路线 |
| 花费统计 | 按天/按类别统计预算与实际花费 |
| 行程分享 | 生成分享链接，无需登录即可查看行程 |
| 行程对比 | 最多 4 个行程横向对比 |
| 记忆系统 | 双层记忆（短期/长期），自动提取用户偏好 |
| 热门推荐 | 实时抓取旅行热门话题 |
| 用户系统 | 注册/登录、Token 鉴权 |

## 技术栈

**后端**
- Python 3.11+
- FastAPI + Uvicorn
- SQLite（数据存储）
- OpenAI 兼容 API（通义千问等）
- 高德地图 Web服务 API（地理编码）

**前端**
- React 18 + TypeScript
- Vite 6
- Tailwind CSS 3
- Zustand（状态管理）
- Leaflet（地图渲染）
- Framer Motion（动画）
- React Router 7

## 项目结构

```
claw7/
├── api/                    # API 层
│   ├── server.py           # FastAPI 路由与中间件
│   └── intl_coords.py      # 国际目的地坐标库
├── core/                   # 核心业务逻辑
│   ├── agent.py            # Agent 主循环
│   ├── llm.py              # LLM 调用封装
│   ├── reasoning.py        # 推理引擎
│   ├── prompting.py        # Prompt 构建
│   ├── memory.py           # 双层记忆管理
│   ├── memory_extractor.py # 记忆提取
│   ├── memory_distiller.py # 记忆蒸馏
│   ├── session.py          # 会话管理
│   ├── auth.py             # 用户认证
│   ├── token.py            # Token 生成/验证
│   ├── trending.py         # 热门推荐
│   ├── itinerary/          # 行程模块
│   │   ├── schema.py       # 数据模型
│   │   ├── repository.py   # 数据持久化
│   │   └── parser.py       # 行程解析
│   ├── intent/             # 意图识别
│   ├── emotion/            # 情感检测
│   ├── profile/            # 用户画像
│   ├── audit/              # 审计日志
│   └── metrics/            # 监控指标
├── tools/                  # 工具层
│   ├── base.py             # 工具基类
│   ├── registry.py         # 工具注册
│   ├── executor.py         # 工具执行
│   ├── travel.py           # 旅行工具
│   ├── amap.py             # 高德地图工具
│   ├── fliggy.py           # 飞猪工具
│   └── http.py             # HTTP 工具
├── infra/                  # 基础设施
│   ├── db.py               # SQLite 数据库
│   └── health.py           # 健康检查
├── frontend/               # 前端项目
│   ├── src/
│   │   ├── pages/          # 页面组件
│   │   ├── components/     # 通用组件
│   │   ├── hooks/          # 状态管理
│   │   └── utils/          # 工具函数
│   └── vite.config.ts      # Vite 配置
├── data/                   # 运行时数据（自动生成）
├── tests/                  # 测试
├── config.py               # 配置管理
├── app.py                  # Agent 构建
├── main.py                 # CLI 入口
└── .env                    # 环境变量
```

## 快速开始

### 1. 环境准备

```bash
# 克隆项目
git clone <repo-url>
cd claw7

# 创建虚拟环境
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 2. 配置环境变量

复制并编辑 `.env` 文件：

```env
# LLM 配置（必填）
CLAW_API_KEY=your-api-key
CLAW_MODEL=qwen3.6-flash
CLAW_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# 高德地图（必填，用于地理编码）
AMAP_WEBSERVICE_KEY=your-amap-key

# 飞猪旅行（可选，用于机票/酒店查询）
FLYAI_API_KEY=your-flyai-key
```

### 3. 启动后端

```bash
# 开发模式（自动重载）
uvicorn api.server:app --reload --host 0.0.0.0 --port 8000
```

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`，会自动代理 `/api` 请求到后端 `localhost:8000`。

### 5. CLI 模式（可选）

```bash
python main.py chat
```

## 环境变量说明

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `CLAW_API_KEY` | 是 | - | LLM API 密钥 |
| `CLAW_MODEL` | 否 | `qwen3.5-122b-a10b` | 模型名称 |
| `CLAW_BASE_URL` | 否 | 通义千问 | OpenAI 兼容 API 地址 |
| `AMAP_WEBSERVICE_KEY` | 是 | - | 高德地图 Web服务 Key |
| `FLYAI_API_KEY` | 否 | - | 飞猪旅行 API Key |
| `CLAW_LOG_LEVEL` | 否 | `DEBUG` | 日志级别 |
| `CLAW_DATABASE_PATH` | 否 | `data/claw.db` | SQLite 数据库路径 |
| `CLAW_RATE_LIMIT_RPM` | 否 | `60` | 每分钟请求限制 |
| `CLAW_METRICS_ENABLED` | 否 | `true` | 是否启用监控指标 |

## 测试

```bash
pytest tests/ -v
```

## License

Private
