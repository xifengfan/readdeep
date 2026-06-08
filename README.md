# 读透 ReadDeep · Cloudflare Workers 部署版

> P2 项目 Cloudflare Workers 部署版（替代 Vercel，国内访问友好）
> 默认模型：`deepseek-v4-flash`（主公 openclaw.json 配置）
> 部署时间：2026-06-08

## 架构

```
readdeep-cf-deploy/
├── src/                      ← Cloudflare Workers 入口
│   ├── index.js              ← 主入口（fetch 路由 + 静态资源 fallback）
│   ├── chat.js               ← /api/chat 4 Agent 陪读
│   ├── agents.js             ← /api/agents 4 Agent 列表
│   └── lib/
│       ├── deepseek.js       ← DeepSeek API 客户端（v4-flash 默认）
│       ├── agents.js         ← 4 Agent system prompt 路由
│       └── prompts.js        ← 通用 prompt 库
├── public/                   ← Workers Assets（静态资源）
│   ├── 5 个 HTML 页面
│   ├── style.css / app.js / reader.js
│   ├── data/books.json       ← 50 本书元数据
│   ├── images/covers/        ← 88 张封面（50 SVG + 38 JPG）
│   └── _headers / _redirects
├── wrangler.toml             ← Workers 配置
└── README.md
```

## 部署

1. Cloudflare Dashboard → Workers & Pages → Create → **Workers** (不是 Pages)
2. Connect to Git → 选 `xifengfan/readdeep`
3. Build command: None
4. Deploy command: `npx wrangler deploy`
5. Root directory: `/`
6. 在 Settings → Variables and secrets 配 `DEEPSEEK_API_KEY`

## API 端点

| 端点 | 方法 | 说明 |
|:---|:---|:---|
| `/api/health` | GET | 健康检查 |
| `/api/agents` | GET | 4 Agent 列表 |
| `/api/chat` | POST/GET | 4 Agent 陪读对话（v4-flash）|

## 4 Agent

- **领读人 lead**：温润学者，拆解章节 + 背景知识 + 引导问题
- **苏格拉底 socrates**：刁钻老头，5Why + 反向论证 + 暴露假设
- **画师 painter**：灵动少年，概念图 + 关系图 + 视觉化
- **金句捕手 quote**：文艺姑娘，摘抄 + 感悟 + 小红书卡片

## P1 9 教训已规避

✅ Functions 路径在 src/（Workers 模式）  
✅ 静态资源在 public/（Workers Assets）  
✅ 模型名从 openclaw.json 取（不造名字）  
✅ wrangler.toml 用 main 字段（Workers 入口）
