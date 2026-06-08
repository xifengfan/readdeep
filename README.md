# 读透（ReadDeep）· D1 阶段交付

> **站点定位**：AI 时代最有效的增长路径——4 个 AI 角色陪读每一本书。
> **D1 范围**：网站骨架 + 4 大页面 + 详情页 + 5 埋点 + 占位数据 + Vercel 部署配置。
> **D2~D5**：接 DeepSeek API / 接 Excalidraw / 接真实书库 / 接 4 Agent 真推理。

---

## 一、项目结构

```
readdeep-site/
├── index.html              # 首页：4 Agent Hero + Manifesto
├── library.html            # 书库：50 本书（30 公版 + 20 主公）
├── reader.html             # 陪读室：4 Agent Tab + 对话 + 思考题 + 进度条
├── workshop.html           # 笔记工坊：4 模板（公众号/小红书/思维导图/卡片）
├── book.html               # 详情页：单本书介绍（从 library 跳转）
├── style.css               # 调性色：墨黑 #1a1a1a + 米黄 #f5e6d3 + 朱砂红 #c1272d
├── app.js                  # 5 埋点 + 路由 + Mock Agent
├── data/
│   └── books.json          # 50 本占位数据（30 公版 + 20 主公已读）
├── api/                    # D2 由鲁肃接 Serverless Functions
├── vercel.json             # 部署配置（readdeep 子域名）
└── package.json
```

---

## 二、本地启动

```bash
# 进入项目
cd "D:\Openclaw\.openclaw\workspace-projects\P2-readdeep\02-代码层\readdeep-site"

# 启动本地服务器（任选其一）
python -m http.server 8080
# 或
npx serve -p 8080
# 或
npx http-server -p 8080
```

打开浏览器访问：

| 页面 | URL |
|:---|:---|
| 首页 | http://localhost:8080/index.html |
| 书库 | http://localhost:8080/library.html |
| 详情 | http://localhost:8080/book.html?id=pd-001 |
| 陪读室 | http://localhost:8080/reader.html?id=pd-001 |
| 笔记工坊 | http://localhost:8080/workshop.html |

---

## 三、5 大埋点

```js
App.track('book_select',    { bookId });     // 选书（library / book / reader）
App.track('chapter_read',   { bookId, chapter });  // 进陪读室
App.track('agent_chat',     { agent });      // 与 Agent 对话
App.track('note_generate',  { template });   // 生成笔记
App.track('book_share',     { action });     // 分享/导出
```

埋点日志存到 `localStorage.readdeep.track`，最多 1000 条。D6 阶段接真实上报通道。

---

## 四、调性色

| 元素 | 颜色 | 含义 |
|:---|:---|:---|
| **主色** | `#1a1a1a`（墨黑）| 阅读沉稳 |
| **辅色** | `#f5e6d3`（米黄）| 纸张温暖 |
| **点睛** | `#c1272d`（朱砂红）| 重要按钮 / CTA |
| **背景** | `#fafaf7`（米白）| 阅读舒适 |

**与 P1 的差异**：P1 是"朱砂红主色"（商业感），P2 是"墨黑主色"（阅读感）。

---

## 五、安全规范

- ✅ 本任务**不写凭证**（不接 DeepSeek API Key，D4 阶段主公本人 Dashboard 配）
- ✅ 不写 `.env`、不写 `.git/config`、不写任何含 Key 的文件
- ✅ `data/books.json` 不含敏感信息（仅书名/作者/分类）
- ✅ 复制 P1 时已检查 `.vercel` 目录未复制

---

## 六、下一步（D2~D5）

| 阶段 | 任务 | 负责 |
|:---|:---|:---|
| **D2** | 接 DeepSeek API（4 Agent 真推理） | 鲁肃（API）+ 蔡文姬（Prompt 校准）|
| **D2** | 接 Serverless Functions（`api/agent.js`） | 吕玲绮 |
| **D3** | 4 Agent 头像真实化（鲁班 SVG） | 鲁班 |
| **D4** | 公版书内容接入（替代方案） | 鲁肃 |
| **D5** | Vercel 正式部署 + readdeep 子域名 | 吕玲绮 |
| **D6** | 5 埋点真实上报 + 飞书机器人 | 吕玲绮 |
| **D7** | dogfooding（主公 + 蔡文姬自测） | 卧龙 |

---

## 七、复用 P1 资产清单

| P1 源文件 | P2 目标 | 改动点 |
|:---|:---|:---|
| `index.html` | `index.html` | 改品牌名 + 4 Agent Hero + Manifesto |
| `style.css` | `style.css` | 改主题色 + 加 4 Agent 头像样式 |
| `app.js` | `app.js` | 改 5 埋点 + 加 Mock Agent + 进度管理 |
| `tools.html` | `reader.html` | 4 Agent Tab + 对话 + 思考题 |
| `methods.html` | `library.html` | 50 本书卡片 + 筛选 + 搜索 |
| `success.html` | `workshop.html` | 4 模板 + 生成 + 导出 |
| `pricing.html` | 删除 | P2 不收费 |
| `vercel.json` | `vercel.json` | 改 endpoint 名 `api/agent.js` |
| `package.json` | `package.json` | 改 name 为 readdeep-site |

---

## 八、已知局限（D1 占位）

1. **Agent 回复是 Mock**——D4 接 DeepSeek 才会有真实内容。
2. **画师不出图**——D5 鲁班出真实 SVG/PNG（当前是文字占位）。
3. **30 本公版书无原文**——D4 走"替代方案"接入（鲁肃 2 因 timeout 走替代）。
4. **埋点仅 console + localStorage**——D6 接真实上报通道。
5. **没有 .env / 任何凭证**——主公本人 Dashboard 配 Vercel 环境变量。

---

**主公认证清单** ✅

- [x] 4 大页面可访问（首页/书库/陪读室/笔记工坊）
- [x] 详情页可访问
- [x] 5 埋点就位
- [x] 调性色：墨黑 + 米黄
- [x] 不含任何凭证
- [x] 复制 P1 时已排除 `.vercel` 目录
- [x] 本地可用 `python -m http.server` 启动
- [x] 50 本占位数据齐全

—— 吕玲绮 · 2026-06-04
