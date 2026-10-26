#!/usr/bin/env python3
"""把 .rpyc 里的 Python 块还原成可读的 .py 近似源码。

RENPY 的 PyCode 里存的是原始源码字符串，按出现顺序拼接，
并标注它所在的 .rpy 行号，便于引用证据。
"""
import os
import sys
import glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dump_rpyc as D


def extract_one(rpyc_path, out_path):
    data, slots = D.read_slots(rpyc_path)
    obj = D.load_slot(data, *slots[1])
    exprs = []
    D.collect_exprs(obj, exprs)
    seen = set()
    lines = []
    for fn, line, src in exprs:
        if not isinstance(src, str) or not src.strip():
            continue
        key = (line, src)
        if key in seen:
            continue
        seen.add(key)
        if len(src) > 120 or "\n" in src:
            lines.append(f"\n#### rpy line {line} ####\n{src}")
        else:
            lines.append(f"# [{line}] {src}")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return len(lines)


def main():
    src_dir = sys.argv[1]
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for path in sorted(glob.glob(os.path.join(src_dir, "*.rpyc"))):
        base = os.path.basename(path)[:-5]
        n = extract_one(path, os.path.join(out_dir, base + ".py.txt"))
        total += n
    print(f"写出 {total} 行到 {out_dir}")


if __name__ == "__main__":
    main()
