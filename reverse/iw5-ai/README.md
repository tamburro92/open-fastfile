# MW3's AI, read from its files

**No longer what the bots run on.** `combat` now plays by Bot Warfare
(`packages/shared/src/game/bots/botWarfare.ts`), and the `mw3Ai.ts` named below is
gone. This stays as what was found: how MW3's actors really aim, for whoever wants
Survival's enemies rather than players.

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
result, each number with its file and key. What the engine does with them is in
`iw5sp.exe`: what has been read there is below, and the rest is marked `engine:`
where it is a reading. The multiplayer client is not available, only `iw5sp.exe`
and `iw5mp_server.exe`.

| What | Where | Found by |
| --- | --- | --- |
| Accuracy, miss time, grenade timers, sniper pauses per skill | `maps/_gameskill` (common.ff, scriptfile 69) | the table's `(skill, key)` strings, paired in order with each `<literal> string string 6b e4 22 1c 1c 7b` store |
| The soldier's accuracy (0.2) and engagement distances (256; 768/1024) | `aitype/enemy_so_{easy,regular,hardened,veteran}` (common_survival.ff) | the `self.<field> = literal` stores and the two `setEngagement*Dist` calls; the four set the same, and differ in weapons only |
| Shoot style ranges 250/900/1600 | `animscripts/shoot_behavior` | the squared distances 62500, 810000 and 2560000 |
| Rounds in a burst | `animscripts/init` | three `anim.<field> = array( ... )` at 0x830; `animscripts/shared` reads them semi, fast, normal |
| Pauses after a burst | `animscripts/combat_utility` | the first function's four `return randomFloatRange( a, b )` |
| Melee range 64 | `animscripts/melee` | the squared distance 4096 |
| Hit chance by distance | `accuracy/aivsplayer/*.accu`, named by Survival's weapons with their `maxDist` | the weapon dump |

## Read from `iw5sp.exe`

- **The accuracy graph's lookup, 0x587bd0.** x is the distance over the double at
  0x7b9c78, 4000 units, clamped to 1. Against a player the caller first multiplies
  the distance by `ai_accuracyDistScale` (0x587d3d). A weapon's `maxDist` plays no part.
- **With no graph, 0x52e5f4.** `ai_playerNearAccuracy` 0.5 within `ai_playerNearRange`
  800, `ai_playerFarAccuracy` 0.1 beyond `ai_playerFarRange` 2000, linear between.

That `self.accuracy` and `base_enemy_accuracy` multiply the graph's answer is still a reading.

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
