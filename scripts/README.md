# Import the local client assets

The browser scene uses the original Era vertices, render batches, UVs, baked
vertex colors, highest-resolution textures, and collision geometry. The import
contains only Gothik's exit approach, its portcullis, and the adjacent hallway.
The original archive and table files are not included in this repo.

The published scene came from Era `1.15.9.70003`, build key
`2417084b8b041ee120d02d4adf31b0bc`. The importer reads local files only. A missing
file stops the import. It has no CDN fallback.

Rebuilding needs Python 3, CMake, a C++17 compiler, zlib, and a local Era client.
These commands work in fish and run from the repo root:

```fish
mkdir -p .client-work
git clone https://github.com/ladislav-zezula/CascLib.git .client-work/CascLib
git -C .client-work/CascLib checkout 38a34665624b8775bb875274b36191b21c38d97b
git -C .client-work/CascLib apply --unidiff-zero ../../scripts/casclib-read-only.patch
cmake -S .client-work/CascLib -B .client-work/CascLib/build -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_BUILD_TYPE=Release -DCASC_BUILD_SHARED_LIB=OFF -DCASC_BUILD_STATIC_LIB=ON
cmake --build .client-work/CascLib/build --parallel
c++ -std=c++17 -O2 -I .client-work/CascLib/src scripts/extract-client-assets.cpp .client-work/CascLib/build/libcasc.a -lz -o .client-work/extract-client-assets
python3 scripts/prepare-era-storage.py --client "/Applications/World of Warcraft" --view .client-work/storage
python3 scripts/import-client-assets.py --raw .client-work/raw --probe .client-work/extract-client-assets --storage .client-work/storage
```

The patch changes CascLib's local file-existence check to read-only mode and fixes
an undefined macOS pointer type. Both changes affect the local extractor copy.
`prepare-era-storage.py` copies the Era product's manifest row and creates links
to existing shared archives. It refuses a staging directory inside the client.

The shared archive layout resolved these files on the tested Mac. A different
installation or later archive format may need extractor support. Do not replace
missing files with another build and label them as this client.

The importer reads the selected version and build key from the storage view. To
convert an existing raw extract without a storage view, supply its recorded
values with `--version` and `--build-key`. Gate placement comes from Classic
database reconstruction rather than the client asset archive. Updating assets
does not establish live Era movement fidelity.

## Mesh buffer format

`docs/assets/scene/manifest.json` describes one little-endian buffer per mesh.
Positions retain original XYZ coordinates with Z up. The importer does not weld,
decimate, scale, rotate, or move collision vertices.

A buffer descriptor is `{type, itemSize, byteOffset, count}`. `count` is the number
of vector items. A typed-array view has `count * itemSize` elements. Descriptors
start at a four-byte boundary. Meshes contain `attributes.position`, `.normal`,
`.uv`, optional `.color`, `index`, and render `groups` with `start`, `count`, and
`material`. Each collision mesh has its own `position` and `index` descriptors.

The WMO collision selection follows the original MOPY flags. It includes faces
with `0x08`, or `0x20` without detail flag `0x04`. The original triangle flags and
material bytes remain in each buffer for inspection. Portcullis collision uses
its dedicated M2 positions and indices. It is a closed box of 12 triangles, not
the gaps between its visible bars.

PNG pixels and UVs keep their source orientation. Three.js should use
`texture.flipY = false`, sRGB texture color space, and repeating wrapping.
Instance transforms apply equally to visible geometry and collision. The gate
has a rotation of pi radians in the raw WMO basis and scale `0.790041`.

Provenance records source FileDataIDs, byte counts, SHA-256 hashes, the client
build, parser references, and the gate-placement limitation.

## Night Elf female

`import-character-assets.py` uses the same read-only offline extractor and
storage view. It exports only NightElfFemale FileDataID 120590, skin 471230,
the selected original body/hair/eye textures, original green leather texture
components, and the locomotion/jump animation tracks needed by this trainer.
The character manifest records source hashes, bone hierarchy, original key times,
compressed quaternion values, model collision metadata and format references.

After preparing the storage view and reader described above, in fish:

```fish
python3 scripts/import-character-assets.py --probe .client-work/extract-client-assets --storage .client-work/storage --raw .client-work/character-raw
```

The browser loader decodes the original 16-bit quaternion keys and skins the
original mesh. It does not generate replacement character geometry or animations.
Live animation state transitions and terrain collision still need separate
measurement.
