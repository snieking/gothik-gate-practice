#!/usr/bin/env python3
"""Import the original Era Night Elf female, clothing and animation tracks.

Only the selected local Classic Era product is read. Geometry, bone weights,
pivots, hierarchy, compressed quaternion keys, and millisecond timestamps stay
unaltered. Textures use original character-atlas layering and original leather
item components. There are no generated animation curves or replacement models.
"""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess


HELPER_PATH = Path(__file__).with_name("import-client-assets.py")
SPEC = importlib.util.spec_from_file_location("client_assets", HELPER_PATH)
CLIENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLIENT)

MODEL = "Character/NightElf/Female/NightElfFemale.m2"
CLIPS = [("Stand", 0, 0), ("Walk", 4, 0), ("Run", 5, 0), ("ShuffleLeft", 11, 0),
         ("ShuffleRight", 12, 0), ("WalkBackwards", 13, 0), ("JumpStart", 37, 0),
         ("JumpStartFlip", 37, 1), ("Jump", 38, 0), ("JumpLand", 39, 0),
         ("Fall", 40, 0), ("JumpLandRun", 187, 0)]
VISIBLE_GEOSETS = {0, 2, 401, 501, 702, 1301}
REGIONS = {
    "armUpper": (0, 0, 128, 64), "armLower": (0, 64, 128, 64),
    "hand": (0, 128, 128, 32), "faceUpper": (0, 160, 128, 32),
    "faceLower": (0, 192, 128, 64), "torsoUpper": (128, 0, 128, 64),
    "torsoLower": (128, 64, 128, 32), "legUpper": (128, 96, 128, 64),
    "legLower": (128, 160, 128, 64), "foot": (128, 224, 128, 32),
}
LAYERS = [
    ("faceUpper", "Character/NightElf/Female/NightElfFemaleFaceUpper00_00.blp"),
    ("faceLower", "Character/NightElf/Female/NightElfFemaleFaceLower00_00.blp"),
    ("faceUpper", "Character/NightElf/ScalpUpperHair00_03.blp"),
    ("faceLower", "Character/NightElf/ScalpLowerHair00_03.blp"),
    ("torsoUpper", "Item/TextureComponents/TorsoUpperTexture/Leather_A_01Green_Chest_TU_U.blp"),
    ("torsoLower", "Item/TextureComponents/TorsoLowerTexture/Leather_A_01Green_Chest_TL_U.blp"),
    ("armUpper", "Item/TextureComponents/ArmUpperTexture/Leather_A_01Green_Sleeve_AU_U.blp"),
    ("armLower", "Item/TextureComponents/ArmLowerTexture/Leather_A_01Green_Glove_AL_U.blp"),
    ("hand", "Item/TextureComponents/HandTexture/Leather_A_01Green_Glove_HA_U.blp"),
    ("legUpper", "Item/TextureComponents/LegUpperTexture/Leather_A_01Green_Pant_LU_U.blp"),
    ("legLower", "Item/TextureComponents/LegLowerTexture/Leather_A_01Green_Boot_LL_U.blp"),
    ("foot", "Item/TextureComponents/FootTexture/Leather_A_01Green_Boot_FO_U.blp"),
]


def overlay(atlas, pixels, region, width, height):
    x0, y0, w, h = REGIONS[region]
    if (w, h) != (width, height):
        raise ValueError(f"Original atlas region dimensions differ for {region}")
    for y in range(h):
        for x in range(w):
            si, di = (y * w + x) * 4, ((y + y0) * 256 + x + x0) * 4
            alpha = pixels[si + 3]
            for channel in range(3):
                atlas[di + channel] = (pixels[si + channel] * alpha + atlas[di + channel] * (255 - alpha) + 127) // 255
            atlas[di + 3] = 255


def animation_fallbacks(data):
    """Read the local AnimationData WDC5 layout BBF66A3C, without a network DB."""
    if data[:4] != b"WDC5":
        raise ValueError("AnimationData must be the selected client's WDC5 table")
    n, field_count, record_size, _, _, layout, _, _, _ = struct.unpack_from("<9I", data, 136)
    if layout != 0xBBF66A3C or field_count != 4:
        raise ValueError("Unsupported local AnimationData layout")
    flags, _ = struct.unpack_from("<2H", data, 172)
    field_total, _, _, storage, _, _, section_count = struct.unpack_from("<7I", data, 176)
    offset = 204
    sections = []
    for _ in range(section_count):
        sections.append(struct.unpack_from("<Q8I", data, offset))
        offset += 40
    offset += field_total * 4
    fields = [struct.unpack_from("<HH5I", data, offset + i * 24) for i in range(storage // 24)]
    offset += storage
    palettes = {}
    for i, field in enumerate(fields):
        if field[3] in (3, 4):
            palettes[i] = CLIENT.array(data[offset:offset + field[2]], "I")
            offset += field[2]
    rows = {}
    for section in sections:
        encryption, position, count, string_size, _, id_size, _, offset_count, copy_count = section
        if encryption or flags & 1 or offset_count or copy_count:
            raise ValueError("Unsupported AnimationData section storage")
        ids = CLIENT.array(data[position + count * record_size + string_size:position + count * record_size + string_size + id_size], "I")
        for i in range(count):
            record = int.from_bytes(data[position + i * record_size:position + (i + 1) * record_size], "little")
            values = []
            for fi, field in enumerate(fields):
                bit, size, _, compression, _, _, _ = field
                key = (record >> bit) & ((1 << size) - 1)
                if compression == 3:
                    values.append(palettes[fi][key])
                elif compression == 4:
                    values.append(palettes[fi][key * 2:key * 2 + 2])
                elif compression in (0, 1, 5):
                    values.append(key)
                else:
                    raise ValueError("Unsupported AnimationData field compression")
            rows[ids[i]] = {"Fallback": values[0], "BehaviorTier": values[1],
                            "BehaviorID": values[2], "Flags": values[3]}
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "docs/assets/character")
    parser.add_argument("--probe", type=Path)
    parser.add_argument("--storage", type=Path)
    args = parser.parse_args()
    raw, out = args.raw.resolve(), args.out.resolve()
    raw.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    provenance = {}

    def file_name(request):
        return request[3:] + ".blp" if request.startswith("id:") else Path(request).name

    def extract(requests):
        if not args.probe or not args.storage:
            raise FileNotFoundError("Missing original client files: " + ", ".join(requests))
        result = subprocess.run([str(args.probe.resolve()), "--storage", str(args.storage.resolve()),
                                 "--output", str(raw), *requests], capture_output=True, text=True)
        if result.returncode or "online feature disabled" not in result.stdout:
            raise RuntimeError("Offline import failed; no substitute files were used.\n" + result.stdout + result.stderr)

    def read(request):
        name = file_name(request)
        path = raw / name
        if not path.exists():
            extract([request])
        data = path.read_bytes()
        provenance[request] = {"request": request, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        return data

    requests = [MODEL, "id:471230", "id:120591", "DBFilesClient/AnimationData.db2",
                "Character/NightElf/Female/NightElfFemaleSkin00_00.blp", "Character/NightElf/Hair00_03.blp"]
    requests.extend(path for _, path in LAYERS)
    missing = [request for request in requests if not (raw / file_name(request)).exists()]
    if missing:
        extract(missing)
    model_sections = CLIENT.chunks(read(MODEL), reverse=False)
    model = model_sections["MD21"][0]
    skin_id = CLIENT.array(model_sections["SFID"][0], "I")[0]
    if skin_id != 471230:
        raise ValueError("Night Elf skin reference differs from the recorded Era model")
    if "SKID" in model_sections:
        raise ValueError("This importer requires the original embedded Era skeleton")
    skin = read(f"id:{skin_id}")
    if skin[:4] != b"SKIN":
        raise ValueError("Missing original Night Elf skin")
    buffer = CLIENT.MeshBuffer()
    vertex_count, vertex_offset = CLIENT.pairs(model, 60)
    positions, normals, uv, weights, bone_indices = [], [], [], [], []
    for i in range(vertex_count):
        offset = vertex_offset + i * 48
        positions.extend(struct.unpack_from("<3f", model, offset))
        weights.extend(model[offset + 12:offset + 16])
        bone_indices.extend(model[offset + 16:offset + 20])
        normals.extend(struct.unpack_from("<3f", model, offset + 20))
        uv.extend(struct.unpack_from("<2f", model, offset + 32))
    if any(sum(weights[i:i + 4]) != 255 for i in range(0, len(weights), 4)):
        raise ValueError("Original vertex weights do not sum to 255")
    attributes = {"position": buffer.add(positions, item_size=3),
                  "normal": buffer.add(normals, item_size=3), "uv": buffer.add(uv, item_size=2),
                  "skinWeight": buffer.add(weights, "Uint8", 4, True),
                  "skinIndex": buffer.add(bone_indices, "Uint8", 4)}
    lookup = CLIENT.source_array(skin, 4, "H")
    triangle_lookup = CLIENT.source_array(skin, 12, "H")
    submesh_count, submesh_offset = CLIENT.pairs(skin, 28)
    submeshes = []
    for i in range(submesh_count):
        values = struct.unpack_from("<10H7f", skin, submesh_offset + i * 48)
        submeshes.append({"id": values[0], "start": values[4] + (values[1] << 16), "count": values[5]})
    unit_count, unit_offset = CLIENT.pairs(skin, 36)
    units = [struct.unpack_from("<Bb11H", skin, unit_offset + i * 24) for i in range(unit_count)]
    material_data = CLIENT.source_array(model, 112, "H", 2)
    texture_combos = CLIENT.source_array(model, 128, "H")
    texture_count, texture_offset = CLIENT.pairs(model, 80)
    texture_types = [struct.unpack_from("<I", model, texture_offset + i * 16)[0] for i in range(texture_count)]
    texture_files = {1: "body.png", 6: "hair.png", 0: "eyes.png"}
    indices, groups, materials = [], [], {}
    for i, submesh in enumerate(submeshes):
        if submesh["id"] not in VISIBLE_GEOSETS:
            continue
        unit = next(unit for unit in units if unit[3] == i)
        material_index, texture_combo = unit[6], unit[9]
        texture_type = texture_types[texture_combos[texture_combo]]
        material = {"id": material_index, "flags": material_data[material_index * 2],
                    "blendMode": material_data[material_index * 2 + 1], "textureType": texture_type,
                    "texture": texture_files[texture_type]}
        materials[material_index] = material
        triangle_indices = [lookup[j] for j in triangle_lookup[submesh["start"]:submesh["start"] + submesh["count"]]]
        groups.append({"start": len(indices), "count": len(triangle_indices), "material": material_index,
                       "geoset": submesh["id"], "originalSubmesh": i})
        indices.extend(triangle_indices)
    CLIENT.check_mesh(positions, indices)
    index = buffer.add(indices, "Uint32")
    bone_count, bone_offset = CLIENT.pairs(model, 44)
    bones = []
    for i in range(bone_count):
        offset = bone_offset + i * 88
        key, flags, parent, submesh, crc = struct.unpack_from("<iIhHI", model, offset)
        bones.append({"index": i, "keyBoneID": key, "flags": flags, "parent": parent,
                      "submeshID": submesh, "nameCRC": crc,
                      "pivot": list(struct.unpack_from("<3f", model, offset + 76))})
    if max(bone_indices) >= bone_count:
        raise ValueError("Original vertex references a missing bone")
    sequences = []
    sequence_count, sequence_offset = CLIENT.pairs(model, 28)
    for i in range(sequence_count):
        v = struct.unpack_from("<HHIfIhHIIHH6ffhH", model, sequence_offset + i * 64)
        sequences.append({"index": i, "id": v[0], "variation": v[1], "durationMs": v[2],
                          "movespeed": v[3], "flags": v[4], "frequency": v[5], "blendInMs": v[9], "blendOutMs": v[10],
                          "variationNext": v[-2], "aliasNext": v[-1]})
    animation_lookup = CLIENT.source_array(model, 36, "h")
    globals_ms = CLIENT.source_array(model, 20, "I")

    def track(bone_index, channel, sequence_index, global_only=False):
        offset = bone_offset + bone_index * 88 + {"translation": 16, "rotation": 36, "scale": 56}[channel]
        interpolation, global_seq, tc, to, vc, vo = struct.unpack_from("<HH4I", model, offset)
        if not tc or not vc or (global_only != (global_seq != 65535)):
            return None
        slot = 0 if global_only else sequence_index
        if slot >= tc or slot >= vc:
            return None
        time_count, time_offset = struct.unpack_from("<II", model, to + slot * 8)
        value_count, value_offset = struct.unpack_from("<II", model, vo + slot * 8)
        if not time_count or not value_count:
            return None
        if time_count != value_count or interpolation not in (0, 1):
            raise ValueError("Unsupported original track interpolation")
        times = CLIENT.array(model[time_offset:time_offset + time_count * 4], "I")
        item_size = 4 if channel == "rotation" else 3
        code, size, value_type = ("H", 2, "Uint16") if channel == "rotation" else ("f", 4, "Float32")
        values = CLIENT.array(model[value_offset:value_offset + value_count * item_size * size], code)
        if len(times) != time_count or len(values) != value_count * item_size or times != sorted(times):
            raise ValueError("Truncated or unordered original bone track")
        return {"bone": bone_index, "channel": channel, "interpolation": interpolation,
                "globalSequence": -1 if global_seq == 65535 else global_seq,
                "timesMs": buffer.add(times, "Uint32"),
                "values": buffer.add(values, value_type, item_size),
                "encoding": "m2-uint16-quaternion" if channel == "rotation" else "original-float32"}

    clips = []
    for name, animation_id, variation in CLIPS:
        sequence_index = animation_lookup[animation_id]
        if sequence_index < 0:
            raise ValueError(f"The selected original Era model lacks {name}")
        sequence = sequences[sequence_index]
        while sequence["variation"] != variation:
            sequence_index = sequence["variationNext"]
            if sequence_index < 0:
                raise ValueError(f"The original Era model lacks variation {variation} of {name}")
            sequence = sequences[sequence_index]
        while sequence["flags"] & 0x40:
            sequence_index = sequence["aliasNext"]
            sequence = sequences[sequence_index]
        if not sequence["flags"] & 0x20:
            raise ValueError(f"External animation data is required for {name}; no fallback animation was used")
        tracks = []
        for bone in bones:
            for channel in ["translation", "rotation", "scale"]:
                entry = track(bone["index"], channel, sequence_index)
                if entry:
                    tracks.append(entry)
        clips.append({"name": name, **sequence,
                      "loop": name in {"Stand", "Walk", "Run", "ShuffleLeft", "ShuffleRight", "WalkBackwards", "Jump", "Fall"},
                      "tracks": tracks})
    global_tracks = []
    for bone in bones:
        for channel in ["translation", "rotation", "scale"]:
            entry = track(bone["index"], channel, 0, True)
            if entry:
                global_tracks.append(entry)
    w, h, body_pixels = CLIENT.decode_blp(read("Character/NightElf/Female/NightElfFemaleSkin00_00.blp"))
    if (w, h) != (256, 256):
        raise ValueError("Unexpected original Classic character atlas size")
    atlas = bytearray(body_pixels)
    for region, path in LAYERS:
        width, height, pixels = CLIENT.decode_blp(read(path))
        overlay(atlas, pixels, region, width, height)
    CLIENT.write_png(out / "body.png", 256, 256, atlas)
    for filename, request in [("hair.png", "Character/NightElf/Hair00_03.blp"), ("eyes.png", "id:120591")]:
        width, height, pixels = CLIENT.decode_blp(read(request))
        CLIENT.write_png(out / filename, width, height, pixels)
    fallbacks = animation_fallbacks(read("DBFilesClient/AnimationData.db2"))
    version, build_key = CLIENT.VERSION, CLIENT.BUILD_KEY
    if args.storage:
        lines = (args.storage.resolve() / ".build.info").read_text().splitlines()
        headers = [key.split("!", 1)[0] for key in lines[0].split("|")]
        rows = [dict(zip(headers, line.split("|"))) for line in lines[1:]]
        active = [row for row in rows if row.get("Product") == "wow_classic_era" and row.get("Active") == "1"]
        if len(active) != 1:
            raise ValueError("Expected one active Era product")
        version, build_key = active[0]["Version"], active[0]["Build Key"]
    manifest = {
        "schema": "gothik-nightelf-v1", "name": "Classic Era Night Elf female",
        "coordinateSystem": "Original M2 XYZ, Z up, faces +X, origin at feet",
        "client": {"version": version, "buildKey": build_key, "product": "wow_classic_era"},
        "buffer": "nightelf.bin", "attributes": attributes, "index": index, "groups": groups,
        "materials": list(materials.values()), "bones": bones, "animations": clips,
        "globalSequencesMs": globals_ms, "globalTracks": global_tracks,
        "vertexCount": vertex_count, "triangleCount": len(indices) // 3, "bounds": CLIENT.bbox(positions),
        "sourceCollision": {"bounds": {"min": list(struct.unpack_from("<3f", model, 188)),
                                       "max": list(struct.unpack_from("<3f", model, 200))},
                            "sphereRadius": struct.unpack_from("<f", model, 212)[0],
                            "note": "M2 model metadata. It does not establish the live player's terrain collider."},
        "appearance": {"skin": 0, "face": 0, "hairTexture": 3, "hairGeoset": 2,
                       "visibleGeosets": sorted(VISIBLE_GEOSETS), "clothing": "Original Leather_A_01Green component textures",
                       "atlasLayers": [{"region": region, "source": path, "rectangle": REGIONS[region]} for region, path in LAYERS]},
        "animationFallbacks": {str(i): fallbacks[i] for i in [0, 4, 5, 11, 12, 13, 37, 38, 39, 40, 92, 93, 187]},
        "provenance": {"sourceFiles": list(provenance.values()), "modelFileDataID": 120590, "skinFileDataID": skin_id,
                       "modelAnimationCount": sequence_count, "externalAnimationFiles": [],
                       "quaternionDecoding": "unsigned>=32768 ? (unsigned-32768)/32767 : (unsigned-32767)/32767; normalized linear interpolation",
                       "references": [
                           "https://github.com/Kruithne/wow.export/blob/c2fd7bde36a712be78a5da896c995b84fbfa2545/src/js/3D/loaders/M2Loader.js",
                           "https://github.com/Kruithne/wow.export/blob/c2fd7bde36a712be78a5da896c995b84fbfa2545/src/js/3D/loaders/M2Generics.js",
                           "https://github.com/Kruithne/wow.export/blob/c2fd7bde36a712be78a5da896c995b84fbfa2545/src/js/3D/AnimMapper.js",
                           "https://github.com/wowdev/pywowlib/blob/55276dc5c2195da7fe136638a2a59716622f8c65/file_formats/m2_format.py#L279-L312",
                           "https://github.com/sc2-arcade-watcher/WhiteoutLib/blob/libmodkit/docs/M2_FILE_FORMAT_SPECIFICATION.md",
                           "https://github.com/wowdev/WoWDBDefs/blob/master/definitions/AnimationData.dbd"]}}
    (out / "nightelf.bin").write_bytes(buffer.data)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"manifest": str(out / "manifest.json"), "vertices": vertex_count,
                      "triangles": len(indices) // 3, "bones": bone_count,
                      "animationTracks": sum(len(clip["tracks"]) for clip in clips),
                      "animations": [{"name": clip["name"], "durationMs": clip["durationMs"],
                                      "tracks": len(clip["tracks"])} for clip in clips]}, indent=2))


if __name__ == "__main__":
    main()
