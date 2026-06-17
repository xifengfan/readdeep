// ================================================
// src/lib/chapters.js
// P2 读透 · 章节标题字典
// 用途：让 4 Agent LLM 知道"自己在第几章 · 章节标题"
// 来源：避免运行时读 md 文件，改为静态字典（D5+ 再补全 30 本书）
// ================================================

export const CHAPTER_TITLES = {
  'pd-001': { // 论语
    0: '学而第一',
    1: '为政第二',
    2: '八佾第三',
    3: '里仁第四',
    4: '公冶长第五',
  },
  // pd-002 ~ pd-030 D5+ 补；当前 fallback 到「第 N 章」
};

export function getChapterTitle(bookId, chapterIndex) {
  const idx = Number.isInteger(chapterIndex) && chapterIndex >= 0 ? chapterIndex : 0;
  const titles = CHAPTER_TITLES[bookId];
  // 边界：未配字典 / 索引越界 → 都走 fallback
  if (!titles || !(idx in titles)) return `第 ${idx + 1} 章`;
  return titles[idx];
}
