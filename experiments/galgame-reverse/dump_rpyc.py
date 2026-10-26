#!/usr/bin/env python3
"""RENPY RPC2 (.rpyc) 结构导出器。

不依赖 Ren'Py 运行时：把 pickle 里的未知类替换成占位类，保留字段，
然后打印 AST 树。目的是看清逻辑（节点类型、条件、参数、调用），
不是生成可编译回 .rpy 的源码。

用法：
  python dump_rpyc.py <file.rpyc> [--depth N] [--json]
"""
import sys
import io
import zlib
import pickle
import struct
import json
import os

MAGIC = b"RENPY RPC2"
HEADER_LEN = 10
SLOT_ENTRY_LEN = 12


class Stub:
    """占位类：保留 pickle 里的 __dict__。"""
    _cls_name = "?"

    def __new__(cls, *a, **kw):
        obj = object.__new__(cls)
        return obj

    def __init__(self, *a, **kw):
        self._args = a

    def __setstate__(self, state):
        if isinstance(state, dict):
            self.__dict__.update(state)
        elif isinstance(state, tuple) and len(state) == 2 and isinstance(state[0], (dict, type(None))):
            if state[0]:
                self.__dict__.update(state[0])
            if isinstance(state[1], dict):
                self.__dict__.update(state[1])
        else:
            self.__dict__["_state"] = state

    def __repr__(self):
        fields = ", ".join(f"{k}={v!r}" for k, v in sorted(self.__dict__.items()) if not k.startswith("__"))
        return f"<{self._cls_name} {fields}>"


_stub_cache = {}


class PyExpr(str):
    """renpy.ast.PyExpr 是 str 子类：字符串内容就是源码文本。"""
    __slots__ = ("filename", "linenumber", "py")

    def __new__(cls, s="", filename=None, linenumber=0, py=3):
        self = str.__new__(cls, s)
        self.filename = filename
        self.linenumber = linenumber
        self.py = py
        return self

    def __getnewargs__(self):
        return (str(self), self.filename, self.linenumber, self.py)

    def __setstate__(self, state):
        pass

    def __reduce__(self):
        return (PyExpr, self.__getnewargs__())


class StubUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if module == "renpy.ast" and name == "PyExpr":
            return PyExpr
        # revertable 容器：直接用内建容器接收
        if name in ("RevertableDict", "RevertableList", "RevertableSet"):
            return {"RevertableDict": dict, "RevertableList": list, "RevertableSet": set}[name]
        if module.startswith("renpy") or module.startswith("copyreg") or module.startswith("collections"):
            if module == "copyreg" or module == "collections":
                try:
                    return super().find_class(module, name)
                except Exception:
                    pass
            key = f"{module}.{name}"
            if key in _stub_cache:
                return _stub_cache[key]
            base = type(name, (Stub,), {"_cls_name": key})
            _stub_cache[key] = base
            return base
        try:
            return super().find_class(module, name)
        except Exception:
            key = f"{module}.{name}"
            if key in _stub_cache:
                return _stub_cache[key]
            base = type(name, (Stub,), {"_cls_name": key})
            _stub_cache[key] = base
            return base


def read_slots(path):
    with open(path, "rb") as f:
        data = f.read()
    if not data.startswith(MAGIC):
        raise SystemExit(f"不是 RENPY RPC2: {data[:12]!r}")
    pos = HEADER_LEN
    slots = {}
    while True:
        sid, start, length = struct.unpack_from("<III", data, pos)
        pos += SLOT_ENTRY_LEN
        if sid == 0:
            break
        slots[sid] = (start, length)
    return data, slots


def load_slot(data, start, length):
    raw = data[start:start + length]
    # 先尝试 zlib，失败则当作裸 pickle
    try:
        raw = zlib.decompress(raw)
    except zlib.error:
        pass
    return StubUnpickler(io.BytesIO(raw)).load()


def pycode_source(obj):
    """从 PyCode 的 pickle state 里取出源码字符串。

    renpy.ast.PyCode.__getstate__ 返回
    (1, <源码 str 或 PyExpr>, (filename, line, ..., hash), mode, py)
    源码可能直接是 str，也可能被 PyExpr 包装；取最长的一段。
    """
    state = obj.__dict__.get("_state")
    if isinstance(state, str):
        return state
    if isinstance(state, tuple):
        candidates = []
        for item in state:
            src = _find_source(item)
            if src is not None:
                candidates.append(src)
        if candidates:
            return max(candidates, key=len)
    return None


def _find_source(item):
    if isinstance(item, (PyExpr, str)):
        return str(item)
    if isinstance(item, tuple):
        best = None
        for sub in item:
            src = _find_source(sub)
            if src is not None and (best is None or len(src) > len(best)):
                best = src
        return best
    if isinstance(item, list):
        best = None
        for sub in item:
            src = _find_source(sub)
            if src is not None and (best is None or len(src) > len(best)):
                best = src
        return best
    return None


def describe(obj, depth=0, max_depth=8, seen=None):
    if seen is None:
        seen = set()
    pad = "  " * depth
    if depth > max_depth:
        return f"{pad}..."
    if isinstance(obj, Stub):
        name = obj._cls_name.split(".")[-1]
        # PyExpr / PyCode 直接吐出源码文本
        if name in ("PyExpr", "PyCode", "PyAnalysis"):
            src = pycode_source(obj)
            if src is not None:
                return f"{pad}<{name}> {src!r}"
        lines = [f"{pad}{name}"]
        for k, v in sorted(obj.__dict__.items()):
            if k.startswith("__"):
                continue
            sub = describe(v, depth + 1, max_depth, seen)
            if isinstance(v, (Stub, list, tuple, dict)) and "\n" in sub:
                lines.append(f"{pad}  {k}:")
                lines.append(sub)
            else:
                lines.append(f"{pad}  {k} = {sub.strip()}")
        return "\n".join(lines)
    if isinstance(obj, (list, tuple)):
        if not obj:
            return f"{pad}[]"
        lines = [f"{pad}["]
        for item in obj:
            lines.append(describe(item, depth + 1, max_depth, seen))
        lines.append(f"{pad}]")
        return "\n".join(lines)
    if isinstance(obj, dict):
        lines = [f"{pad}{{"]
        for k, v in obj.items():
            lines.append(f"{pad}  {k!r}: {describe(v, depth + 1, max_depth, seen).strip()}")
        lines.append(f"{pad}}}")
        return "\n".join(lines)
    return f"{pad}{obj!r}"


def walk_stmts(obj, out, depth=0):
    """按 Ren'Py AST 常见字段遍历，抽取所有 PyExpr / ParameterInfo 的文本。"""
    if depth > 40:
        return
    cls = getattr(obj, "_cls_name", "")
    if cls.endswith("PyExpr") or cls.endswith("PyCode"):
        text = getattr(obj, "s", None) or getattr(obj, "source", None)
        out.append(("expr", cls.split(".")[-1], text))
        return
    if isinstance(obj, Stub):
        for k, v in obj.__dict__.items():
            walk_stmts(v, out, depth + 1)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            walk_stmts(v, out, depth + 1)
    elif isinstance(obj, dict):
        for v in obj.values():
            walk_stmts(v, out, depth + 1)


def collect_exprs(obj, out, depth=0):
    """按出现顺序收集 (文件名, 行号, 源码) —— PyExpr 与 PyCode 内部表达式。"""
    if depth > 60:
        return
    if isinstance(obj, PyExpr):
        out.append((getattr(obj, "filename", None), getattr(obj, "linenumber", 0), str(obj)))
        return
    if isinstance(obj, Stub):
        name = obj._cls_name.split(".")[-1]
        if name == "PyCode":
            src = pycode_source(obj)
            loc = getattr(obj, "location", None)
            line = 0
            if isinstance(loc, tuple) and len(loc) > 1 and isinstance(loc[1], int):
                line = loc[1]
            if src is not None:
                out.append((None, line, src))
        for v in obj.__dict__.values():
            collect_exprs(v, out, depth + 1)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            collect_exprs(v, out, depth + 1)
    elif isinstance(obj, dict):
        for v in obj.values():
            collect_exprs(v, out, depth + 1)


def main():
    path = sys.argv[1]
    max_depth = 6
    as_json = "--json" in sys.argv
    for a in sys.argv[2:]:
        if a.startswith("--depth="):
            max_depth = int(a.split("=", 1)[1])
    data, slots = read_slots(path)
    print(f"# {path}", file=sys.stderr)
    print(f"# slots: {{{', '.join(f'{k}: start={v[0]} len={v[1]}' for k, v in slots.items())}}}", file=sys.stderr)
    for sid in sorted(slots):
        start, length = slots[sid]
        obj = load_slot(data, start, length)
        if as_json:
            exprs = []
            walk_stmts(obj, exprs)
            print(json.dumps([{"kind": k, "cls": c, "text": t} for k, c, t in exprs], ensure_ascii=False, indent=1))
        elif os.environ.get("DUMP_MODE") == "code":
            exprs = []
            collect_exprs(obj, exprs)
            for fn, line, src in exprs:
                if not src or not src.strip():
                    continue
                print(f"{line:>6}  {src}")
        else:
            print(f"===== slot {sid} =====")
            print(describe(obj, 0, max_depth))


if __name__ == "__main__":
    main()
