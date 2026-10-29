# MW3's AI, read from its files

## The question

**What does MW3 say a soldier fighting a player does — how well it shoots, how it
fires, when it throws — and where does it say it?**

The multiplayer bots (`game/bots/brains/combat.ts`) are meant to fight as MW3's
AI does. MW3's multiplayer has no bot AI: its only bots are test clients with no
brain. The AI that fights on its multiplayer maps is **Survival's**: the
campaign's actor AI (`animscripts/*`, `maps/_gameskill`, in `common.ff`) with
Survival's soldiers (`aitype/enemy_so_*`) and weapons (`common_survival.ff`).
The skill levels a lobby offers — recruit, regular, hardened, veteran — are
`_gameskill`'s easy, normal, hardened and veteran.

## Answer

`extract.py` reads it all; `packages/shared/src/game/bots/mw3Ai.ts` holds the
result, each number with its file and key. The executable is not in an install
(only zones are), so what the engine does with these numbers is read from how
the scripts use them, and marked `engine:` where it is a reading.

| What | Where | Found by |
| --- | --- | --- |
| Accuracy, miss time, grenade timers, sniper pauses per skill | `maps/_gameskill` (common.ff, scriptfile 69) | the table's `(skill, key)` strings, paired in order with each `<literal> string string 6b e4 22 1c 1c 7b` store |
| The soldier's accuracy (0.2) and engagement distances (256; 768/1024) | `aitype/enemy_so_{easy,regular,hardened,veteran}` (common_survival.ff) | the `self.<field> = literal` stores and the two `setEngagement*Dist` calls; the four set the same, and differ in weapons only |
| Shoot style ranges 250/900/1600 | `animscripts/shoot_behavior` | the squared distances 62500, 810000 and 2560000 |
| Rounds in a burst | `animscripts/init` | three `anim.<field> = array( ... )` at 0x830; `animscripts/shared` reads them semi, fast, normal |
| Pauses after a burst | `animscripts/combat_utility` | the first function's four `return randomFloatRange( a, b )` |
| Melee range 64 | `animscripts/melee` | the squared distance 4096 |
| Hit chance by distance | `accuracy/aivsplayer/*.accu`, named by Survival's weapons with their `maxDist` | the weapon dump |

## What the bytecode is

An OAT `.gscbin` is the name, a NUL, three int32 sizes, the zlib'd string table
(literals in first-use order) and the bytecode. IW5 names most scripts by token
number; `animscripts/*` and `aitype/*` keep their names. Field and function names
are tokens, not strings, so a field is known by where it is stored, not by name.
The opcodes these readers rely on — `02` byte, `04` ushort, `06` int, `09` float,
`0a` string, `0c` zero, `7e` self field store, `7d` anim field store, `20`/`29` a
builtin call — are proven only by every table parsing whole.

## Check it again

```bash
COD_MW3_DIR=... .venv/bin/python reverse/iw5-ai/extract.py --out .cache/iw5-ai/ai.json
```
