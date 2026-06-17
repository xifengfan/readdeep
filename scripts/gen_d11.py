#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""D11 章层生成器 - 古典 14 本 + 蒙学 5 本
每本调用对应数据函数（见 data_d11.py），落盘到 chapters/<dir>/NN.md，
并更新 books.json 的 mdChapters 字段。
"""
import os
import json
import sys

BASE = r"D:\Openclaw\.openclaw\workspace-projects\P2-readdeep\02-代码层\readdeep-cf-deploy\public\data"
CHAPTERS = os.path.join(BASE, "chapters")
BOOKS_JSON = os.path.join(BASE, "books.json")

# 书 -> (id, 目录名, 生成函数名)
BOOKS = [
    ("pd-002", "daodejing", "daodejing"),
    ("pd-003", "zhuangzi", "zhuangzi"),
    ("pd-004", "mengzi", "mengzi"),
    ("pd-005", "daxue", "daxue"),
    ("pd-006", "zhongyong", "zhongyong"),
    ("pd-007", "shijing", "shijing"),
    ("pd-008", "chuci", "chuci"),
    ("pd-009", "shiji", "shiji"),
    ("pd-010", "zizhitongjian", "zizhitongjian"),
    ("pd-011", "sunzi", "sunzi"),
    ("pd-012", "sanshiliuji", "sanshiliuji"),
    ("pd-013", "sanguoyanyi", "sanguoyanyi"),
    ("pd-014", "shuihuzhuan", "shuihuzhuan"),
    ("pd-015", "xiyouji", "xiyouji"),
    ("pd-026", "weiluye", "weiluye"),
    ("pd-027", "zengguang", "zengguang"),
    ("pd-028", "qianziwen", "qianziwen"),
    ("pd-029", "sanzijing", "sanzijing"),
    ("pd-030", "baijiaxing", "baijiaxing"),
]


def main():
    from data_d11 import GENERATORS

    # 加载 books.json
    with open(BOOKS_JSON, "r", encoding="utf-8-sig") as f:
        bj = json.load(f)

    summary = {"ok": [], "fail": []}

    for book_id, dir_name, func_name in BOOKS:
        try:
            chapters = GENERATORS[func_name]()  # list of (title, body)
        except Exception as e:
            summary["fail"].append({"id": book_id, "dir": dir_name, "err": f"gen:{e}"})
            print(f"[FAIL] {book_id} 生成器出错: {e}", file=sys.stderr)
            continue

        if not chapters or len(chapters) < 1:
            summary["fail"].append({"id": book_id, "dir": dir_name, "err": "空数据"})
            print(f"[FAIL] {book_id} 无数据", file=sys.stderr)
            continue

        out_dir = os.path.join(CHAPTERS, dir_name)
        os.makedirs(out_dir, exist_ok=True)

        # 清理旧文件
        for fn in os.listdir(out_dir):
            if fn.endswith(".md"):
                os.remove(os.path.join(out_dir, fn))

        written = []
        for i, (title, body) in enumerate(chapters, 1):
            fn = f"{i:02d}.md"
            path = os.path.join(out_dir, fn)
            with open(path, "w", encoding="utf-8") as f:
                f.write(f"# {title}\n\n{body.strip()}\n")
            written.append(f"/data/chapters/{dir_name}/{fn}")

        # 更新 books.json
        for b in bj["books"]:
            if b["id"] == book_id:
                b["mdChapters"] = written
                break

        summary["ok"].append({"id": book_id, "dir": dir_name, "count": len(written)})
        print(f"[OK] {book_id} {dir_name} {len(written)} 章")

    # 写回 books.json
    bj["generated_at"] = "2026-06-15T20:36:00+08:00"
    bj["source"] = "P2-readdeep 内容层 · D11 章层录入（古典14+蒙学5）"
    with open(BOOKS_JSON, "w", encoding="utf-8") as f:
        json.dump(bj, f, ensure_ascii=False, indent=4)
        f.write("\n")

    # 写 fallback 报告
    fb_path = os.path.join(BASE, "chapters", "fallback.json")
    with open(fb_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n=== 总结 ===")
    print(f"成功 {len(summary['ok'])} 本")
    print(f"失败 {len(summary['fail'])} 本")


if __name__ == "__main__":
    main()
