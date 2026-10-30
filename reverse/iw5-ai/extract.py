"""Read MW3's AI numbers out of its own compiled scripts and weapon files.

Writes the JSON of MW3 actor numbers, once behind the combat brain,
so a bot's rules can be checked against the game again. Reads `$COD_MW3_DIR`
(reverse/tools/paths.py), keeps its dumps under `--work`, and writes `--out`.

    COD_MW3_DIR=... .venv/bin/python reverse/iw5-ai/extract.py --out .cache/iw5-ai/ai.json

Each table is found by what it says, not by its number, and every reader
asserts the shape it expects: a script recompiled differently fails loudly
rather than reading a neighbour's constant.
"""

import argparse
import json
import os
import re
import struct
import sys
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path[:0] = [ROOT, os.path.join(ROOT, "reverse", "tools")]

from paths import game_dir  # noqa: E402
from scripts.cod import backends  # noqa: E402

ZONES = ("common", "common_survival")

# IW5 PC opcodes, as far as these readers need them. Proven only by the tables
# below parsing whole: a wrong size would desynchronise every entry after it.
OP_BYTE, OP_USHORT, OP_INT, OP_FLOAT, OP_STRING, OP_ZERO = 0x02, 0x04, 0x06, 0x09, 0x0A, 0x0C
OP_FUNC = 0x64  # a `::function` reference, three bytes: `pain_test`'s values
OP_SET_SELF_FIELD = 0x7E
OP_SET_ANIM_FIELD = 0x7D
OP_PRE_CALL, OP_CALL_BUILTIN = 0x20, 0x29

# `level.difficultySettings[ key ][ skill ] = value;` ends in this: the level
# field, two array refs, and the store.
GAMESKILL_STORE = bytes.fromhex("6be4221c1c7b")


def split(path):
    """(strings, bytecode) of an OAT `.gscbin`: name, NUL, three sizes, zlib strings, bytecode."""
    data = open(path, "rb").read()
    start = data.index(0) + 1
    compressed, _inflated, _length = struct.unpack_from("<iii", data, start)
    strings = zlib.decompress(data[start + 12 : start + 12 + compressed])
    return strings, data[start + 12 + compressed :]


def words(strings):
    return [w.decode() for w in re.findall(rb"[\x20-\x7e]{2,}", strings)]


def value_at(code, i):
    """(value, next offset) of the literal pushed at `i`."""
    op = code[i]
    if op == OP_BYTE:
        return code[i + 1], i + 2
    if op == OP_USHORT:
        return struct.unpack_from("<H", code, i + 1)[0], i + 3
    if op == OP_INT:
        return struct.unpack_from("<i", code, i + 1)[0], i + 5
    if op == OP_FLOAT:
        return round(struct.unpack_from("<f", code, i + 1)[0], 6), i + 5
    if op == OP_ZERO:
        return 0, i + 1
    if op == OP_FUNC:
        return "::function", i + 4
    raise ValueError(f"no literal at {i:#x} (op {op:#04x})")


def _ends_at(code, i, at):
    try:
        return value_at(code, i)[1] == at
    except (ValueError, IndexError):
        return False


def scripts(work):
    for dirpath, _, files in os.walk(work):
        for f in files:
            if f.endswith(".gscbin"):
                yield os.path.join(dirpath, f)


def find_script(work, *needles):
    for path in scripts(work):
        text = words(split(path)[0])
        if all(n in text for n in needles):
            return path
    sys.exit(f"no script under {work} names {needles}")


def gameskill(work):
    """maps/_gameskill's `difficultySettings`: {key: {skill: value}}, in the script's own order."""
    path = find_script(work, "base_enemy_accuracy", "missTimeConstant", "GAMESKILL_VETERAN")
    strings, code = split(path)
    text = words(strings)
    skills = ("easy", "normal", "hardened", "veteran")
    # The table's (skill, key) pairs, in first-use order, start after the autodifficulty names.
    pairs = []
    at = text.index("autodifficulty_frac") + 1
    while at + 1 < len(text) and text[at] in skills:
        pairs.append((text[at], text[at + 1]))
        at += 2
    # Each entry is `<literal> string string <GAMESKILL_STORE>`, one after another: an entry starts
    # where the last store ended. The first starts at the longest literal that ends at its strings.
    stores = [m.start() for m in re.finditer(re.escape(GAMESKILL_STORE), code)]
    table = {}
    begin = None
    for (skill, key), end in zip(pairs, stores, strict=False):
        strings_at = end - 6
        assert code[strings_at] == OP_STRING and code[strings_at + 3] == OP_STRING, hex(end)
        if begin is None or begin != strings_at and value_at(code, begin)[1] != strings_at:
            begin = next(strings_at - n for n in (5, 4, 3, 2, 1) if _ends_at(code, strings_at - n, strings_at))
        value, _ = value_at(code, begin)
        table.setdefault(key, {})[skill] = value
        begin = end + len(GAMESKILL_STORE)
    assert len(stores) >= len(pairs), (len(stores), len(pairs))
    return os.path.basename(path), table


def burst_tables(work):
    """animscripts/init's three `anim.<field> = array( ... );`, by field token, in order."""
    path = os.path.join(work, "animscripts", "init.gscbin")
    _, code = split(path)
    out = []
    for m in re.finditer(rb"\x20((?:\x02[\x00-\x10]){5,})\x29...\x7d(..)", code, re.S):
        pushed = m.group(1)[1::2]
        field = struct.unpack("<H", m.group(2))[0]
        out.append({"field": f"{field:#06x}", "values": list(reversed(pushed))})  # pushed last argument first
    assert [len(t["values"]) for t in out] == [11, 9, 12], out
    return out


def burst_delays(work):
    """animscripts/combat_utility's burst delay: each `return randomFloatRange( a, b );` in its first function."""
    _, code = split(os.path.join(work, "animscripts", "combat_utility.gscbin"))
    ranges = []
    for m in re.finditer(rb"\x09(....)\x09(....)\x86\x9b\x00\x01", code[:0x100], re.S):
        b, a = (round(struct.unpack("<f", x)[0], 4) for x in m.groups())  # pushed last argument first
        ranges.append([a, b])
    assert len(ranges) == 4, ranges
    return ranges


def shoot_style_ranges(work):
    """animscripts/shoot_behavior's squared distances, in units: the shoot style's bands."""
    _, code = split(os.path.join(work, "animscripts", "shoot_behavior.gscbin"))
    found = []
    for sq in (62500, 810000, 2560000):
        raw = struct.pack("<H", sq) if sq < 0x10000 else struct.pack("<i", sq)
        assert raw in code, sq
        found.append(round(sq**0.5))
    return found


def aitype(work, name):
    """An aitype's `self.<field> = literal;` stores and its two engagement calls."""
    _, code = split(os.path.join(work, "aitype", f"{name}.gscbin"))
    stores = []
    i = 0
    while i < len(code):
        if code[i] in (OP_BYTE, OP_USHORT, OP_INT, OP_FLOAT, OP_ZERO):
            try:
                value, nxt = value_at(code, i)
            except (ValueError, IndexError):
                i += 1
                continue
            if nxt < len(code) and code[nxt] == OP_SET_SELF_FIELD:
                stores.append({"field": f"{struct.unpack_from('<H', code, nxt + 1)[0]:#06x}", "value": value})
                i = nxt + 3
                continue
        i += 1
    floats = [round(struct.unpack_from("<f", code, m.start() + 1)[0], 3) for m in re.finditer(rb"\x09", code)]
    return {"stores": stores, "floats": floats}


def accuracy_graphs(work):
    out = {}
    for kind in ("aivsai", "aivsplayer"):
        folder = os.path.join(work, "accuracy", kind)
        for f in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
            lines = open(os.path.join(folder, f)).read().split("\n")
            n = int(lines[2])
            out.setdefault(kind, {})[f] = [[float(v) for v in line.split()] for line in lines[3 : 3 + n]]
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--work", default=".cache/iw5-ai")
    parser.add_argument("--out", default=".cache/iw5-ai/ai.json")
    args = parser.parse_args()
    for zone in ZONES:
        ff = game_dir("mw3", "zone", "english", f"{zone}.ff")
        out = os.path.join(args.work, zone)
        for kind in ("scriptfile", "weapon"):
            done = os.path.join(out, f".{kind}")
            if not os.path.exists(done):
                backends.for_fastfile(ff).dump(ff, out, kind)
                open(done, "w").close()
    common, survival = (os.path.join(args.work, z) for z in ZONES)
    script, table = gameskill(common)
    result = {
        "gameskill": {"script": script, "table": table},
        "burstTables": burst_tables(common),
        "burstDelays": burst_delays(common),
        "shootStyleRanges": shoot_style_ranges(common),
        "aitypes": {n: aitype(survival, n) for n in ("enemy_so_easy", "enemy_so_regular", "enemy_so_hardened", "enemy_so_veteran")},
        "accuracyGraphs": accuracy_graphs(survival),
    }
    with open(args.out, "w") as fh:
        json.dump(result, fh, indent=1)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
