#!/usr/bin/env python3
"""Create a read-only-reference CASC storage view outside the game directory.

This accommodates the shared archive layout that resolved these build-70003
assets on macOS. It copies the Era manifest row and creates symbolic links to
existing configuration and archive files. It does not download missing files.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", type=Path, required=True, help="World of Warcraft installation root")
    parser.add_argument("--view", type=Path, required=True, help="A new local staging directory")
    args = parser.parse_args()
    client = args.client.resolve()
    view = args.view.resolve()
    if view == client or client in view.parents:
        raise ValueError("The view must be outside the game installation")
    lines = (client / ".build.info").read_text().splitlines()
    headers = [x.split("!", 1)[0] for x in lines[0].split("|")]
    selected = []
    for line in lines[1:]:
        values = dict(zip(headers, line.split("|")))
        if values.get("Product") == "wow_classic_era" and values.get("Active") == "1":
            selected.append((line, values))
    if len(selected) != 1:
        raise ValueError(f"Expected one active Classic Era product, found {len(selected)}")
    archives = client / "Data/data"
    config = client / "Data/config"
    if not archives.is_dir() or not config.is_dir():
        raise FileNotFoundError("Shared Data/data and Data/config folders are required; no fallback is available")
    if view.exists() and any(view.iterdir()):
        raise FileExistsError("Choose a new, empty view directory")
    (view / "Data/data").mkdir(parents=True, exist_ok=True)
    (view / ".build.info").write_text(lines[0] + "\n" + selected[0][0] + "\n")
    (view / "Data/config").symlink_to(config, target_is_directory=True)
    count = 0
    for path in sorted(archives.iterdir()):
        if path.is_file() and (path.suffix == ".idx" or path.name.startswith("data.")):
            (view / "Data/data" / path.name).symlink_to(path)
            count += 1
    record = {"product": "wow_classic_era", "version": selected[0][1]["Version"],
              "buildKey": selected[0][1]["Build Key"], "archiveReferences": count,
              "view": str(view), "clientChanged": False, "onlineFallback": False}
    (view / "view-provenance.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
