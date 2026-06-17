# P2 读透 · 设计令牌 (Design Tokens)

> 商业级设计系统 · 2026-06-11 重设计 · 郭嘉 v1
> 调性：不卖课 / 不端着 / 墨黑+米黄+朱砂克制延展
> 参考：Linear · Vercel · Stripe 克制商业产品思路

---

## 设计原则

| 原则 | 说明 |
|:---|:---|
| 🔳 极简克制 | 不做渐变、不做花式阴影、不堆叠装饰 |
| 🏷️ 层次明确 | 5 档灰阶 + 3 档阴影 + 5 档圆角 · 信息层级一眼可辨 |
| ✒️ 阅读优先 | 衬线正文 + 无衬线 UI · 行高 1.65 · 字号 8 档供灵活组合 |
| 🎨 品牌统一 | 墨黑+米黄+朱砂 扩展为 15 个语义变量 · 不加新色系 |
| ⚡ 动效隐忍 | ease-out 不弹 · 最长 400ms · 微交互不抢戏 |

---

## 一、调色板

### 1.1 品牌主色（5 档）

```css
--ink-900:  #1a1a1a;  /* 墨黑 · 沉 · 主文字 / 主底色 */
--paper-50: #fafaf7;  /* 极浅米白 · 页面背景 */
--paper-100:#f5e6d3;  /* 米黄 · 暖 · 卡片底 / 辅色 */
--paper-200:#e8d5b7;  /* 浅米黄 · 边框 / 分隔 */
--accent-500:#c1272d; /* 朱砂 · 力 · CTA / 链接 / 强调 */
--accent-600:#a11f25; /* 深朱砂 · hover / active */
```

### 1.2 灰阶（5 档 · 从浅到深）

```css
--ink-100: #f5f5f5;  /* 极浅灰 · 禁用态底 */
--ink-300: #d4d4d4;  /* 浅灰 · disabled 边框 */
--ink-500: #737373;  /* 中性灰 · 辅助文字 */
--ink-700: #3d3d3d;  /* 深灰 · 次要文字 */
--ink-900: #1a1a1a;  /* 墨黑 · 主文字 ≡ brand ink */
```

### 1.3 4 Agent 主色（商业差异化）

| Agent | 主色 | 亮色 | 语义 |
|:---|:---|:---|:---|
| 领读人 | `#1a1a1a` 墨黑 | `#d4a45a` 金 | 沉稳·引路 |
| 苏格拉底 | `#c1272d` 朱砂 | `#e85d5f` 亮红 | 追问·刺痛 |
| 画师 | `#d97706` 暖橙 | `#fbbf24` 亮橙 | 画面·温度 |
| 金句捕手 | `#7c2d12` 暗红 | `#c2410c` 亮褐 | 深酿·萃句 |

```css
--agent-lead:        #1a1a1a;
--agent-lead-accent: #d4a45a;
--agent-socrates:        #c1272d;
--agent-socrates-accent: #e85d5f;
--agent-painter:         #d97706;
--agent-painter-accent:  #fbbf24;
--agent-quote:           #7c2d12;
--agent-quote-accent:    #c2410c;
```

### 1.4 阴影系统（3 档 + 1 active）

```css
--shadow-sm:     0 1px 3px rgba(26,26,26,0.04), 0 1px 2px rgba(26,26,26,0.06);
--shadow-md:     0 4px 12px rgba(26,26,26,0.08);
--shadow-lg:     0 12px 32px rgba(26,26,26,0.15);
--shadow-active: 0 12px 32px rgba(193,39,45,0.15);  /* 朱砂光晕 · active 专用 */
```

### 1.5 语义色（功能性）

```css
--success: #2d6a4f;  /* 成功 · 暗绿 */
--warning: #a16207;  /* 警告 · 暖黄褐 */
--danger:  #c1272d;  /* 危险 ≡ accent-500 */
```

---

## 二、字体系统

### 2.1 字体栈

```css
--font-sans:  'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif;
--font-serif: 'Noto Serif SC', 'Source Han Serif', 'Songti SC', 'SimSun', serif;
--font-mono:  'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace;
```

### 2.2 字号（8 档 · 1.25 黄金比例）

| Token | 值 | 像素 | 用途 |
|:---|:---|:---|:---|
| `--text-xs` | 0.75rem | 12px | 标签 / 辅助信息 |
| `--text-sm` | 0.875rem | 14px | 辅助文字 / 按钮小字 |
| `--text-base` | 1rem | 16px | 正文 |
| `--text-lg` | 1.125rem | 18px | 强调正文 |
| `--text-xl` | 1.25rem | 20px | 小标题 |
| `--text-2xl` | 1.5rem | 24px | 区块标题 |
| `--text-3xl` | 1.875rem | 30px | 大标题 |
| `--text-4xl` | 2.5rem | 40px | 页面大标题 |

### 2.3 行高

```css
--leading-tight:  1.2;   /* 大标题 */
--leading-snug:   1.35;  /* 小标题 */
--leading-normal: 1.5;   /* UI 元素 / 按钮 */
--leading-relaxed:1.65;  /* 正文阅读（推荐）*/
--leading-loose:  1.8;   /* 章节原文 / 长段落 */
```

### 2.4 字重

```css
--weight-normal:  400;
--weight-medium:  500;
--weight-semibold:600;
--weight-bold:    700;
```

### 2.5 字间距

```css
--tracking-tight:  -0.01em;  /* 大标题收紧 */
--tracking-normal: 0;
--tracking-wide:   0.02em;   /* 大写标签 */
```

---

## 三、间距系统

### 3.1 间距（8 档 · 4px 基线）

| Token | 值 | 像素 | 典型用途 |
|:---|:---|:---|:---|
| `--space-1` | 0.25rem | 4px | icon-text gap / 紧密 |
| `--space-2` | 0.5rem | 8px | button padding / 标签间隙 |
| `--space-3` | 0.75rem | 12px | 列表项间距 |
| `--space-4` | 1rem | 16px | 卡片 padding（默认）|
| `--space-6` | 1.5rem | 24px | 区块内间距 |
| `--space-8` | 2rem | 32px | 区块间距 |
| `--space-12` | 3rem | 48px | Section 间距 |
| `--space-16` | 4rem | 64px | 页面级大间距 |

### 3.2 圆角（5 档）

| Token | 值 | 用途 |
|:---|:---|:---|
| `--radius-sm` | 0.375rem (6px) | 试试问按钮 / 小标签 |
| `--radius-md` | 0.5rem (8px) | 思考题卡 / input / select |
| `--radius-lg` | 0.75rem (12px) | agent 卡片 / 对话气泡 |
| `--radius-xl` | 1rem (16px) | 大区块 / Modal |
| `--radius-full` | 9999px | 头像 / badge / 圆点 |

---

## 四、动效缓动

### 4.1 缓动曲线

```css
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);   /* 商业级 · 不弹 · hover/enter */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);     /* 标准 · 状态切换 */
```

### 4.2 时长

```css
--duration-fast: 150ms;  /* 微交互 · hover / focus */
--duration-base: 250ms;  /* 标准过渡 · card / modal */
--duration-slow: 400ms;  /* 大区块 · page enter */
```

---

## 五、4 Agent 视觉差异化方案

### 5.1 选定方案：方案 A —— 左侧强调条 + active 加深

**理由**：
- 不破坏米黄主调（方案 C 会碎片化页面色彩）
- 比顶部色条（方案 B）更符合"书架/目录"的空间节奏
- 左侧条 = 书脊隐喻 · 与阅读产品调性天然吻合
- active 态用 6px 加粗 + 朱砂光晕，视觉层级瞬间可辨

### 5.2 实现片段

```css
/* agent 卡片基类 */
.agent-card {
  position: relative;
  padding: var(--space-6);            /* 24px */
  border-radius: var(--radius-lg);    /* 12px */
  background: var(--paper-100);       /* 米黄 */
  border: 1px solid var(--paper-200); /* 浅米黄边 */
  /* 左侧 4px 强调条（默认透明，由 agent 类着色）*/
  border-left: 4px solid transparent;
  transition: border-left-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
  cursor: pointer;
  min-height: 220px;  /* v1 180px → 220px */
  display: flex;
  flex-direction: column;
  gap: var(--space-2);  /* 8px */
}

/* 每个 agent 的左侧强调条 */
.agent-card[data-agent="lingdu_ren"]    { border-left-color: var(--agent-lead); }
.agent-card[data-agent="sugeladuo"]     { border-left-color: var(--agent-socrates); }
.agent-card[data-agent="huashi"]        { border-left-color: var(--agent-painter); }
.agent-card[data-agent="jinjubushou"]   { border-left-color: var(--agent-quote); }

/* active 态：强调条加粗 + 朱砂光晕 */
.agent-card.active {
  border-left-width: 6px;
  box-shadow: var(--shadow-active);
  background: var(--paper-50);  /* 微微提亮米白 */
}
.agent-card.active .name { color: var(--agent-lead); }  /* 保留墨黑 · 不用反色 */
.agent-card.active .persona { color: var(--ink-700); }
.agent-card.active .task { color: var(--ink-500); }

/* hover 微动 */
.agent-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.agent-card.active:hover {
  transform: none;  /* active 不浮 */
}
```

### 5.3 对比：v1（当前）vs v2（新设计）

| 维度 | v1 当前 | v2 新设计 |
|:---|:---|:---|
| 4 Agent 区分 | ❌ 完全同色 | ✅ 左侧 4 色强调条 |
| active 态 | 墨黑全反色 | 强调条加粗 6px + 朱砂光晕 |
| 卡片高度 | 180px 固定 | 220px min-height · flex 自适应 |
| 间距 | 1rem → 无 gap | 24px padding + 8px gap |
| hover | 2px 上浮 + 阴影 | 同上 + 缓动优化 |
| 圆角 | 0.75rem | 沿用 --radius-lg (12px) |

---

## 六、使用规范（Design Token → 组件映射）

### 6.1 Agent 卡片

```
padding:      --space-6 (24px)
min-height:   220px
border-radius:--radius-lg (12px)
border:       1px solid --paper-200
左边条:       4px → --agent-* (6px active)
阴影:         --shadow-md (hover) · --shadow-active (active)
内 gap:       --space-2 (8px)
```

### 6.2 试试问按钮

```
字号:         --text-xs (12px)
padding:      --space-1 --space-2 (4px 8px)
border:       1px dashed --ink-300
border-radius:--radius-sm (6px)
hover:        border-color → --accent-500
              color → --accent-500
              background → --paper-50
```

### 6.3 对话气泡

```
padding:      --space-3 --space-4 (12px 16px)
border-radius:--radius-lg (12px)
line-height:  --leading-normal (1.5)
字号:         --text-base (16px)
user 气泡:    bg --ink-900 · color --paper-100 · 右对齐 · 右下小圆角
agent 气泡:   bg --paper-100 · color --ink-900 · 左对齐 · 左下小圆角
thinking:     bg --paper-50 · color --ink-500 · dashed 边框 · 斜体
```

### 6.4 思考题卡

```
padding:      --space-4 --space-6 (16px 24px)
border:       1px solid --paper-200
border-radius:--radius-md (8px)
background:   --paper-50
题号圆点:     --ink-900 底 · --paper-100 字 · --radius-full
hover:        border-color → --ink-900
```

### 6.5 书库卡片

```
padding:      --space-6 (24px)
border:       1px solid --paper-200
border-radius:--radius-lg (12px)
gap:          --space-2 (8px)
hover:        border-color → --ink-900 · --shadow-md
badge:        --radius-full · --paper-100 底 / --ink-900 底(vip)
```

### 6.6 Toast 提示

```
padding:      --space-2 --space-4 (8px 16px)
border-radius:--radius-md (8px)
background:   --ink-900
color:        --paper-50
字号:         --text-sm (14px)
阴影:         --shadow-lg
```

### 6.7 进度条

```
height:       6px
background:   --paper-100
border-radius:--radius-full
fill:         --ink-900 · transition width --ease-out
```

### 6.8 按钮（CTA）

```
padding:      --space-2 --space-4 (8px 16px) · 小按钮
              --space-3 --space-8 (12px 32px) · 大按钮
border-radius:--radius-md (8px)
primary:      bg --accent-500 · color --paper-50 · hover --accent-600
secondary:    bg --ink-900 · color --paper-100 · hover --ink-700
transition:   all --duration-fast --ease-out
```

### 6.9 输入框

```
padding:      --space-2 --space-3 (8px 12px)
border:       1px solid --ink-300
border-radius:--radius-md (8px)
background:   --paper-50
focus:        border-color --ink-900 · ring 1px --ink-900
字号:         --text-sm (14px)
```

---

## 七、响应式断点

```css
--bp-sm:  640px;   /* 手机横屏 */
--bp-md:  768px;   /* 平板 */
--bp-lg:  1024px;  /* 桌面 */
--bp-xl:  1280px;  /* 大桌面 */
```

---

## 八、附录：完整 CSS 变量一键复制

```css
:root {
  /* === 品牌主色 === */
  --ink-900: #1a1a1a;
  --paper-50: #fafaf7;
  --paper-100: #f5e6d3;
  --paper-200: #e8d5b7;
  --accent-500: #c1272d;
  --accent-600: #a11f25;

  /* === 灰阶 === */
  --ink-100: #f5f5f5;
  --ink-300: #d4d4d4;
  --ink-500: #737373;
  --ink-700: #3d3d3d;

  /* === 4 Agent 主色 === */
  --agent-lead: #1a1a1a;
  --agent-lead-accent: #d4a45a;
  --agent-socrates: #c1272d;
  --agent-socrates-accent: #e85d5f;
  --agent-painter: #d97706;
  --agent-painter-accent: #fbbf24;
  --agent-quote: #7c2d12;
  --agent-quote-accent: #c2410c;

  /* === 阴影 === */
  --shadow-sm: 0 1px 3px rgba(26,26,26,0.04), 0 1px 2px rgba(26,26,26,0.06);
  --shadow-md: 0 4px 12px rgba(26,26,26,0.08);
  --shadow-lg: 0 12px 32px rgba(26,26,26,0.15);
  --shadow-active: 0 12px 32px rgba(193,39,45,0.15);

  /* === 语义色 === */
  --success: #2d6a4f;
  --warning: #a16207;
  --danger: #c1272d;

  /* === 字体 === */
  --font-sans: 'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif;
  --font-serif: 'Noto Serif SC', 'Source Han Serif', 'Songti SC', 'SimSun', serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace;

  /* === 字号 === */
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --text-4xl: 2.5rem;

  /* === 行高 === */
  --leading-tight: 1.2;
  --leading-snug: 1.35;
  --leading-normal: 1.5;
  --leading-relaxed: 1.65;
  --leading-loose: 1.8;

  /* === 字重 === */
  --weight-normal: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;

  /* === 字间距 === */
  --tracking-tight: -0.01em;
  --tracking-normal: 0;
  --tracking-wide: 0.02em;

  /* === 间距 === */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;

  /* === 圆角 === */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-full: 9999px;

  /* === 动效 === */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-base: 250ms;
  --duration-slow: 400ms;
}
```

---

## 九、变更记录

| 日期 | 版本 | 作者 | 变更 |
|:---|:---|:---|:---|
| 2026-06-11 | v1 | 郭嘉 | 初版：调色板扩展 / 字体系统 / 间距系统 / 动效缓动 / 4 Agent 差异化方案 A |


---

# P2 读透 · 设计令牌 v2

> 郭嘉 v2 · 2026-06-11 · **商业级 SVG + 书卡 + 4 Agent 卡片重构**
> 解决 D7-5 后 3 大问题：SVG 文字变形 / 书卡元数据顶框 / 4 Agent 卡片参差不齐

---

## 十、SVG 封面字号 8 档（不用 textLength）

| Token | 值 | 适用字数 | 说明 |
|:---|:---|:---|:---|
| `--svg-title-1` | 200px | 1 字 | 如《诗》《易》 |
| `--svg-title-2` | 160px | 2 字 | 如《论语》《老子》 |
| `--svg-title-3` | 120px | 3 字 | 如《韩非子》《孙子兵法》 |
| `--svg-title-4` | 100px | 4 字 | 如《资治通鉴》《国富论》 |
| `--svg-title-5` | 88px | 5 字 | 如《唐诗三百首》 |
| `--svg-title-6` | 75px | 6 字 | 如《枪炮病菌与钢铁》 |
| `--svg-title-7` | 65px | 7 字 | 如《思考快与慢》变体 |
| `--svg-title-8` | 55px | ≥8 字 | 如《卓有成效的管理者精读》 |

```css
--svg-title-1: 200px;
--svg-title-2: 160px;
--svg-title-3: 120px;
--svg-title-4: 100px;
--svg-title-5: 88px;
--svg-title-6: 75px;
--svg-title-7: 65px;
--svg-title-8: 55px;
--svg-author:  32px;
```

### 设计原理

**不用 `textLength` + `lengthAdjust`**：这两个属性会强制压缩/拉伸字形，导致中文字体严重变形（如 4 字被压扁 55%）。改为按字数精确分档字号，让字保持原始比例。

viewBox 保持 440×600，8 档字号均能自然容纳（无需压缩）。

---

## 十一、书卡 body 排版（v2 · 不顶框）

```css
.book-card {
  height: 100%;  /* 关键：撑开 */
}

.book-card__body {
  padding: var(--space-5) var(--space-5) var(--space-4);  /* 上 20px / 左右 20px / 下 16px */
  gap: var(--space-3);  /* 段间距 12px → v1 是 8px */
  flex: 1;  /* 关键：撑开 */
  min-height: 0;  /* flex 子项最小高度 0 */
}

.book-card__title {
  min-height: 2.4em;  /* 强制 2 行高（即使 1 行也不"顶框"）*/
}

.book-card__summary {
  flex: 1;  /* 关键：摘要区域撑开剩余空间 */
  min-height: 2.4em;  /* 强制 2 行高 */
}

.book-card__footer {
  padding-top: var(--space-3);
  border-top: 1px solid var(--paper-200);
  margin-top: var(--space-1);
}
```

### 设计原理

v1 使用 `padding: var(--space-4) var(--space-5)` (16px/20px) + `gap: var(--space-2)` (8px)，导致标题/元数据紧贴边框。v2 增大 padding 到 space-5 (20px) + gap space-3 (12px)，增加 `min-height: 2.4em` 保障最小间距，footer 用 border-top + padding-top 分隔。

---

## 十二、4 Agent 卡片等高（v2 · flex column + stretch）

```css
.agent-grid {
  align-items: stretch;  /* 关键：4 卡片等高 */
}

.agent-card {
  display: flex;
  flex-direction: column;
  height: 100%;  /* 关键 */
  min-height: 280px;  /* 提高容纳试试问 */
  padding: var(--space-5);
  gap: var(--space-3);
}

.agent-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex: 1;
  min-height: 0;
}

.agent-task {
  flex: 1;  /* 撑开 */
  min-height: 2.5em;
}

.agent-emoji-frame {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.try-ask-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--paper-200);
  margin-top: var(--space-1);
}

.try-ask-btn {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
}
```

### 设计原理

v1 使用 `min-height: 220px` 但没有 `display: flex; flex-direction: column`，4 卡片高度被内容撑开成参差不齐。v2 使用 `height: 100%` + `align-items: stretch` 强制等高，`flex: 1` 让 task 区域撑开，try-ask-list 用 `flex-wrap: wrap` 横排按钮。

---

## 十三、新增 spacing token

```css
--space-5: 1.25rem;  /* 20px · v2 新增 · 书卡 body 专用 */
```

---

## 十四、变更记录

| 日期 | 版本 | 作者 | 变更 |
|:---|:---|:---|:---|
| 2026-06-11 | v2 | 郭嘉 | SVG 字号 8 档 / 书卡 body 排版 / 4 Agent 等高 / --space-5 |
| 2026-06-11 | v1 | 郭嘉 | 初始：品牌色扩展 / 字体系统 / 间距系统 / 动效系统 / 4 Agent 差异化方案 A |
