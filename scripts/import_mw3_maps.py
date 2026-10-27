#!/usr/bin/env python3
"""Batch import all MW3 maps that exist in the install and are not yet fully exported."""

import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PYTHON = REPO_ROOT / ".venv" / "bin" / "python"
WORLDS_DIR = REPO_ROOT / "worlds"

# All 17 MW3 MP & Spec Ops map zones present in the install
MW3_MAPS = [
    ("mp_alpha", "alpha-mw3"),
    ("mp_bootleg", "bootleg-mw3"),
    ("mp_bravo", "bravo-mw3"),
    ("mp_carbon", "carbon-mw3"),
    ("mp_dome", "dome-mw3"),
    ("mp_exchange", "exchange-mw3"),
    ("mp_hardhat", "hardhat-mw3"),
    ("mp_interchange", "interchange-mw3"),
    ("mp_lambeth", "lambeth-mw3"),
    ("mp_mogadishu", "mogadishu-mw3"),
    ("mp_paris", "paris-mw3"),
    ("mp_plaza2", "plaza2-mw3"),
    ("mp_radar", "radar-mw3"),
    ("mp_seatown", "seatown-mw3"),
    ("mp_underground", "underground-mw3"),
    ("mp_village", "village-mw3"),
    ("so_deltacamp", "deltacamp-mw3"),
]


def is_already_exported(world_slug: str) -> bool:
    world_dir = WORLDS_DIR / world_slug
    world_file = world_dir / "world.world"
    props_world = world_dir / "props.world"
    collision_glb = world_dir / "assets" / "collision.glb"
    return world_file.is_file() and props_world.is_file() and collision_glb.is_file()


def main():
    print("=== MW3 Batch Importer ===")
    to_export = [
        (m, w) for m, w in MW3_MAPS if not is_already_exported(w)
    ]
    total = len(to_export)
    print(f"Total maps to export: {total} (skipped already completed maps)")

    for idx, (map_name, world_slug) in enumerate(to_export, 1):
        print(f"\n==========================================")
        print(f"[{idx}/{total}] Exporting {map_name} -> {world_slug}")
        print(f"==========================================")
        cmd = [
            str(PYTHON),
            "-m",
            "scripts.cod",
            "export",
            map_name,
            "--game",
            "mw3",
            "--world",
            world_slug,
        ]
        res = subprocess.run(cmd, cwd=str(REPO_ROOT))
        if res.returncode != 0:
            print(f"FAILED to export {map_name} (exit code {res.returncode})", file=sys.stderr)
        else:
            print(f"SUCCESS: {map_name} exported to worlds/{world_slug}")

    print("\n=== Batch Import Completed ===")


if __name__ == "__main__":
    main()
