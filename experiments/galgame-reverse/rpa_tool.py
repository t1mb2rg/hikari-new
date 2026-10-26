#!/usr/bin/env python3
"""RPA-3.0 只读解包工具（不写回原安装目录）。

用法：
  python rpa_tool.py list  <archive.rpa>                  # 只打印索引
  python rpa_tool.py stat  <archive.rpa>                  # 按扩展名统计
  python rpa_tool.py extract <archive.rpa> <outdir> [--only ext1,ext2] [--max-mb N]
"""
import os
import sys
import zlib
import pickle
import collections

RPA_MAGIC = b"RPA-3.0 "


def read_index(rpa_path):
    with open(rpa_path, "rb") as f:
        header = f.readline().decode("utf-8").strip()
        if not header.startswith("RPA-3.0 "):
            raise SystemExit(f"不是 RPA-3.0 头: {header[:64]}")
        parts = header.split()
        offset = int(parts[1], 16)
        key = int(parts[2], 16)
        f.seek(offset)
        data = zlib.decompress(f.read())
    index = pickle.loads(data)
    out = {}
    for name, entries in index.items():
        fixed = []
        for e in entries:
            start, length, prefix = e
            fixed.append((start ^ key, length ^ key, prefix))
        out[name] = fixed
    return out


def iter_files(index):
    for name, entries in index.items():
        if not entries:
            continue
        start, length, prefix = entries[0]
        yield name, start, length, prefix


def cmd_list(rpa_path):
    index = read_index(rpa_path)
    files = sorted(iter_files(index))
    total = 0
    for name, start, length, prefix in files:
        total += length
        print(f"{length:>10}  {name}")
    print(f"--- {len(files)} files, {total/1048576:.1f} MB 未压缩 ---")


def cmd_stat(rpa_path):
    index = read_index(rpa_path)
    by_ext = collections.Counter()
    size_by_ext = collections.Counter()
    for name, start, length, prefix in iter_files(index):
        ext = os.path.splitext(name)[1].lower() or "(no-ext)"
        by_ext[ext] += 1
        size_by_ext[ext] += length
    for ext, cnt in by_ext.most_common():
        print(f"{ext:>14}  {cnt:>6} files  {size_by_ext[ext]/1048576:>10.2f} MB")


def cmd_extract(rpa_path, outdir, only_exts, max_mb):
    index = read_index(rpa_path)
    os.makedirs(outdir, exist_ok=True)
    files = sorted(iter_files(index))
    written = 0
    skipped = 0
    total_bytes = 0
    limit = max_mb * 1048576 if max_mb else None
    with open(rpa_path, "rb") as f:
        for name, start, length, prefix in files:
            ext = os.path.splitext(name)[1].lower()
            if only_exts and ext not in only_exts:
                skipped += 1
                continue
            if limit is not None and total_bytes + length > limit:
                skipped += 1
                continue
            dest = os.path.join(outdir, name.replace("/", os.sep))
            os.makedirs(os.path.dirname(dest) or outdir, exist_ok=True)
            f.seek(start)
            data = f.read(length)
            if prefix:
                data = bytes(prefix) + data
            with open(dest, "wb") as g:
                g.write(data)
            written += 1
            total_bytes += length
    print(f"写出 {written} 个文件，跳过 {skipped} 个，共 {total_bytes/1048576:.1f} MB → {outdir}")


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    cmd, rpa_path = sys.argv[1], sys.argv[2]
    if cmd == "list":
        cmd_list(rpa_path)
    elif cmd == "stat":
        cmd_stat(rpa_path)
    elif cmd == "extract":
        outdir = sys.argv[3]
        only = None
        max_mb = None
        for a in sys.argv[4:]:
            if a.startswith("--only="):
                only = {x if x.startswith(".") else "." + x for x in a.split("=", 1)[1].split(",")}
            elif a.startswith("--max-mb="):
                max_mb = float(a.split("=", 1)[1])
        cmd_extract(rpa_path, outdir, only, max_mb)
    else:
        raise SystemExit(f"未知命令 {cmd}")


if __name__ == "__main__":
    main()
