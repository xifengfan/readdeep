/**
 * D7-6 · SVG 封面重生成脚本（v2 商业级）
 *
 * 从 books.json 读 50 本书，按新极简设计原则生成 SVG：
 *   - 只留 4 个元素（书名 + 作者 + 2 极简装饰朱砂条）
 *   - 8 档字号按字数精确分档（不用 textLength · 字不变形）
 *   - 书名居中 + 作者居中
 *   - 删所有小字（READ DEEP / 读透 / 公版书 / PD-001 / No.01 等）
 *
 * 使用方式：
 *   cd "D:\Openclaw\.openclaw\workspace-projects\P2-readdeep\02-代码层\readdeep-cf-deploy"
 *   node scripts/regen-covers.cjs
 */

const fs = require('fs');
const path = require('path');

// ---- 路径 ----
const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'public', 'images', 'covers');
const archiveDir = path.join(projectRoot, 'public', 'images', '_archive_svg_2026-06-11');
const booksJsonPath = path.join(projectRoot, 'public', 'data', 'books.json');

// ---- 读取 books.json ----
const raw = fs.readFileSync(booksJsonPath, 'utf-8');
const data = JSON.parse(raw);
const books = data.books || [];
console.log(`Loaded ${books.length} books from books.json`);

// ---- 备份现有 SVG 到 archive（如果还没备份则新建） ----
if (!fs.existsSync(archiveDir)) {
  fs.mkdirSync(archiveDir, { recursive: true });
  const svgFiles = fs.readdirSync(outDir).filter(f => f.endsWith('.svg'));
  for (const f of svgFiles) {
    fs.copyFileSync(path.join(outDir, f), path.join(archiveDir, f));
  }
  console.log(`Backed up ${svgFiles.length} SVGs to ${archiveDir}`);
} else {
  console.log(`Archive dir already exists at ${archiveDir}, skipping backup`);
}

// ---- 字号分档（v2 · 8 档 · 不用 textLength）----
function getTitleSize(title) {
  const len = title.length;
  if (len === 1) return 200;   // --svg-title-1
  if (len === 2) return 160;   // --svg-title-2
  if (len === 3) return 120;   // --svg-title-3
  if (len === 4) return 100;   // --svg-title-4
  if (len === 5) return 88;    // --svg-title-5
  if (len === 6) return 75;    // --svg-title-6
  if (len === 7) return 65;    // --svg-title-7
  return 55;                   // --svg-title-8 (>=8 字)
}

// ---- 生成新 SVG（v2 · 不用 textLength · 居中）----
function generateSvg(book) {
  const title = book.title || '';
  const author = book.author || '佚名';
  const titleSize = getTitleSize(title);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="440" height="600" viewBox="0 0 440 600">
  <defs>
    <style><![CDATA[
      .t-title { font: 900 ${titleSize}px/1 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; letter-spacing: 4px; }
      .t-author { font: 600 32px/1 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; letter-spacing: 8px; }
    ]]></style>
  </defs>
  <rect width="440" height="600" fill="#f5e6d3"/>
  <rect x="0" y="0" width="440" height="8" fill="#8b1a1f"/>
  <text class="t-title" x="50%" y="320" fill="#1a1a1a" text-anchor="middle" dominant-baseline="central">${title}</text>
  <text class="t-author" x="50%" y="430" fill="#8b1a1f" text-anchor="middle" dominant-baseline="central">${author}</text>
  <rect x="0" y="592" width="440" height="8" fill="#8b1a1f"/>
</svg>`;
}

// ---- 主循环 ----
let count = 0;
for (const book of books) {
  const cover = book.cover || `images/covers/${book.id}.svg`;
  if (!cover.endsWith('.svg')) {
    console.log(`Skipping ${book.id} (cover is not SVG: ${cover})`);
    continue;
  }

  const svg = generateSvg(book);
  const basename = path.basename(cover);
  const outPath = path.join(outDir, basename);
  fs.writeFileSync(outPath, svg, 'utf-8');
  count++;
  console.log(`  ✓ ${basename}  ${book.title}  (${book.title.length}字 · ${getTitleSize(book.title)}px)`);
}

console.log(`\nDone! Regenerated ${count} SVG covers.`);
console.log(`All svgs use 8-tier font sizing WITHOUT textLength + lengthAdjust.`);
