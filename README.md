# 3D Designer

> [!WARNING]
> This project was written primarily with AI. It is very experimental and will
> have bugs. Modern Warfare 3 is the best-supported game so far; the others may
> be primitive or buggy. Black Ops II's zombies mode is also functional, through
> private matches.

A browser 3D engine for walkable worlds, written as plain text. A world is a
`.world` file: glTF models, a collision mesh, lights, spawns and triggers. Most
of one is generated — Call of Duty maps imported by a Python pipeline — and what
a human writes over it is the gameplay. The app parses, validates and renders it
as a first-person scene, and multiplayer is playable on top of it.

## Game Modes

- **Team Deathmatch (TDM)**: Faction-based combat (**Allies** vs. **Axis**). Players select their team on join (or use auto-assign), can change teams mid-match from the pause menu, and compete to reach the team score limit. Includes an in-game faction HUD and a two-column tactical scoreboard.
- **Deathmatch (Free-for-All)**: Every soldier for themselves. Fast-paced solo combat with custom kill limits and time limits, authentic FFA HUD, and real-time leader tracking.
- **Zombies**: Cooperative wave survival mode (supported on Black Ops maps such as Kino der Toten).

Both multiplayer modes feature intelligent bot fill with authentic Call of Duty callsigns (`Ghost`, `Soap`, `Price`, `Roach`, `Gaz`, etc.) and tactical scoreboard badges.

## Multiplayer & Matchmaking

Multiplayer is fully server-authoritative with lag compensation and client prediction:
- **Central API (`@3d/api`)**: Owns accounts, authentication, world catalogue, and matchmaking lobbies.
- **Game Server (`@3d/game-server`)**: Low-latency 60 Hz WebRTC/UDP match instances running authoritative physics, damage verification, and game scripts.
- **Private Matches & Custom Rules**: Hosts can create private lobbies, configure game modes, select maps, customize score/time limits, and share 6-character invite codes or direct join links (`/?join=<code>`). Guests can also connect via the in-game **Join Game** menu dialog.

## Previews

![Dome, from Modern Warfare 3](docs/previews/mw3-dome.png)

_Dome (Modern Warfare 3): the most feature-complete multiplayer map._

![Kino der Toten, Black Ops zombies](docs/previews/bo1-zombies.png)

_Black Ops zombies: the game mode partly works and needs tweaking._

**[More previews →](docs/previews/README.md)**

## Quick start

```
pnpm install
pnpm dev:mp
```

Open the printed URL (`http://localhost:5173`). Click to play:
- **Movement**: `W`, `A`, `S`, `D` to move, `Space` to jump, `Shift` to sprint, `C` to crouch, `Ctrl` to go prone.
- **Combat**: Left-click to fire, right-click to Aim Down Sights (ADS), `R` to reload, `1` / `2` to switch weapons.
- **Scoreboard**: `Tab` toggles the Call of Duty tactical scoreboard (or orbiting dollhouse view when walking alone).
- **Pause & Team Selection**: `Esc` opens the pause menu (change team mid-match in TDM, change loadout class, adjust quality/sensitivity, or exit).

That starts three processes: the client's dev server; `@3d/api`, which serves
the worlds and their assets and does the matchmaking; and a `@3d/game-server`,
which hosts the games it is given. The client proxies to the api, and a match
needs the game server. `pnpm dev` starts only the first two, which is enough to
walk a world alone. See **[docs/server/README.md](docs/server/README.md)** for
the topology, and `.env.example` for every setting.

To serve the dev server beyond localhost, put `DEV_HOST=0.0.0.0` and
`DEV_ALLOWED_HOSTS=your.host` in `.env.local` (copy `.env.example`). It serves
the imported game assets to anyone who can reach it.

## Editing a world

See **[worlds/AUTHORING.md](worlds/AUTHORING.md)** for the format. A map's
geometry, props and lighting are written by the importer below; what you edit by
hand is the gameplay over them — spawns, triggers and behaviours. Validate
without a browser:

```
pnpm check worlds/<slug>
```

With `pnpm dev:mp` (or `pnpm dev`) running, saving a `.world` file updates the
browser immediately and keeps your camera position.

## Importing Call of Duty maps

`scripts/cod/` converts maps from the Call of Duty games you own on Steam (MW2,
MW3, Black Ops, Black Ops II, Ghosts and Advanced Warfare) into worlds. See
**[docs/cod/](docs/cod/README.md#export-maps-from-your-own-games)** for setup,
then:

```
python3 -m scripts.cod doctor            # where your games are, and what is missing
python3 -m scripts.cod maps --game mw3   # the maps your install holds
pnpm export:cod mp_dome                  # one map -> worlds/dome-mw3
```

## Development

```
pnpm test        # vitest
pnpm typecheck   # every package, plus @3d/shared's isomorphism check
pnpm lint        # ESLint, including the layer boundaries
pnpm shots <poses.json> --compare DIR   # screenshot regressions
pnpm test:py     # pytest for the importer
pnpm build       # production build to dist/
```

[CLAUDE.md](CLAUDE.md) is the map of the engine's structure;
[docs/engine/](docs/engine/) holds the rationale for rendering, collision, the
UI and the debug tools.
