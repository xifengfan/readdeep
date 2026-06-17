# P2-readdeep · Cloudflare Workers 部署配置

> 主公 git push 到 main → 3 分钟内自动部署到 https://readdeep.xxx
> 本文档说明 GitHub Secrets 怎么配，不用记命令。

---

## 📦 需要配置的 3 个 Secrets

打开 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret 名 | 必填 | 用途 | 在哪里拿 |
|:---|:---:|:---|:---|
| `CLOUDFLARE_API_TOKEN` | ✅ | Wrangler 调 CF API 鉴权 | 见下方"步骤 1" |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | 标识要部署到哪个 CF 账号 | 见下方"步骤 2" |
| `DEEPSEEK_API_KEY` | ✅ | Worker 运行时调用 DeepSeek 用 | 见下方"步骤 3" |

> ⚠️ **三个都要配齐，缺一个会部署失败。** wrangler-action 会自动把 `DEEPSEEK_API_KEY` 当作 Worker Secret 注入（走 `wrangler secret put`），不会出现在日志里。

---

## 步骤 1 · 创建 Cloudflare API Token

1. 打开 https://dash.cloudflare.com/profile/api-tokens
2. 点 **Create Token** → 选 **Edit Cloudflare Workers**（Custom 模板）→ 下一步
3. 权限：
   - Account Resources：选主公部署用的账号（如 `xxx@example.com`）
   - Zone Resources：选 **All zones**（或只选 readdeep 域，但 All zones 更省事）
4. TTL：选 **No expiration**（不过期）或短期 90 天（更安全）
5. 点 **Continue to summary** → **Create Token**
6. 复制生成的 token（**只显示一次，关掉就没了**）→ 填到 GitHub Secret `CLOUDFLARE_API_TOKEN`

**这是 90% 部署失败的根因**：
- ❌ 用 Global API Key（v3 已不支持）
- ❌ Token 权限只勾了 `Read`（必须是 `Edit`）
- ❌ Token scope 选错账号（部署到 A 账号但 token 给了 B 账号）

---

## 步骤 2 · 拿 Cloudflare Account ID

1. 打开 https://dash.cloudflare.com
2. 进 Workers & Pages → readdeep 项目
3. 页面右下角侧栏能看到 **Account ID**（一串 32 位 hex）
4. 或者访问 https://dash.cloudflare.com/?to=/:account 后 URL 里就是
5. 填到 GitHub Secret `CLOUDFLARE_ACCOUNT_ID`

---

## 步骤 3 · 拿 DeepSeek API Key

1. 打开 https://platform.deepseek.com/api_keys
2. 登录主公的 DeepSeek 账号
3. 点 **Create new secret key** → 命名（如 `readdeep-prod`）→ 创建
4. **立即复制**（关闭后无法再查看）
5. 填到 GitHub Secret `DEEPSEEK_API_KEY`

> 💡 本地开发时，复制 `.dev.vars.example` 为 `.dev.vars`，把 key 填进去。`.dev.vars` 已在 `.gitignore` 里，不会被提交。

---

## 🚀 部署触发

主公改完代码：
```bash
git add .
git commit -m "feat: xxx"
git push origin main
```

GitHub Actions 会自动跑：
1. `actions/checkout@v4` 拉代码
2. `cloudflare/wrangler-action@v3` 装 wrangler 3.91.0
3. `wrangler deploy` 上传 Worker + Assets
4. 自动 `wrangler secret put DEEPSEEK_API_KEY` 注入密钥
5. 完成后 < 3 分钟，https://readdeep.xxx 即可访问

**手动重跑**：GitHub → Actions → "Deploy to Cloudflare Workers" → Run workflow

---

## 🔍 部署失败排查

| 现象 | 原因 | 解决 |
|:---|:---|:---|
| `Authentication error [code: 10000]` | API Token 错或过期 | 重新创建 token |
| `account id invalid` | `CLOUDFLARE_ACCOUNT_ID` 填错 | 检查是不是当前账号的 32 位 hex |
| `secret DEEPSEEK_API_KEY not found` | Secret 没配 | 步骤 3 重做 |
| `Could not resolve binding 'ASSETS'` | `public/` 目录被 .gitignore 了 | 检查 .gitignore，确认 `public/` 在 git 里 |
| `wrangler.toml parse error` | toml 语法错 | 本地 `npx wrangler deploy --dry-run` 验证 |

---

## 🛡️ 安全约定

- ✅ `CLOUDFLARE_API_TOKEN` / `DEEPSEEK_API_KEY` **永不**进 git
- ✅ `.dev.vars` 已在 `.gitignore`，本地开发用
- ✅ 生产 secret 唯一来源是 GitHub Secrets
- ❌ 不要把 token 贴在 issue / 飞书 / 微信里

---

_最后更新：2026-06-17 · D14 第 1 块 · 吕玲绮出图_
