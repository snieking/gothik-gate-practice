#!/usr/bin/env python3
"""Convert a narrowly scoped, offline Classic Era extract for the trainer.

No client files are changed, no CDN fallback is available, and no geometry is
welded or simplified. The output is original coordinates, with Z up. This
script only requires Python 3's standard library.

Source format references are recorded in the generated provenance. The mesh
buffer schema is documented at the end of this file in --help's description.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import zlib


VERSION = "1.15.9.70003"
BUILD_KEY = "2417084b8b041ee120d02d4adf31b0bc"
ROOT_NAME = "stratholme_raid.wmo"
ROOT_PATH = "World/WMO/Dungeon/LD_Stratholme/Stratholme_raid.wmo"
DOOR_PATH = "World/Lordaeron/STRATHOLME/ActiveDoodads/Doors/nox_door_portcullis.m2"
REFERENCES = [
    "https://github.com/Kruithne/wow.export/blob/c2fd7bde36a712be78a5da896c995b84fbfa2545/src/js/3D/loaders/WMOLoader.js",
    "https://github.com/Kruithne/wow.export/blob/c2fd7bde36a712be78a5da896c995b84fbfa2545/src/js/3D/loaders/M2Loader.js",
    "https://github.com/Kruithne/wow.export/blob/c2fd7bde36a712be78a5da896c995b84fbfa2545/src/js/3D/Skin.js",
    "https://github.com/vmangos/core/blob/53d24d5c748bef5e0cde7b1155bcb3d979af614c/contrib/vmap_extractor/vmapextract/wmo.cpp",
    "https://github.com/cmangos/classic-db/blob/ec4f596146be6467ea93c57397858e329e2db852/Updates/Instances/533_naxxramas.sql",
]


def chunks(data, start=0, end=None, reverse=True):
    """Return all chunks, including repeats, and reject malformed lengths."""
    end = len(data) if end is None else end
    result = {}
    while start < end:
        if start + 8 > end:
            raise ValueError("Truncated chunk header")
        tag = data[start:start + 4]
        if reverse:
            tag = tag[::-1]
        tag = tag.decode("ascii")
        size = struct.unpack_from("<I", data, start + 4)[0]
        offset = start + 8
        if offset + size > end:
            raise ValueError(f"Truncated {tag} chunk")
        result.setdefault(tag, []).append(data[offset:offset + size])
        start = offset + size
    return result


def array(data, code):
    size = struct.calcsize("<" + code)
    if len(data) % size:
        raise ValueError(f"Array is not aligned to {code}")
    return list(struct.unpack("<" + code * (len(data) // size), data))


def pairs(data, offset):
    count, position = struct.unpack_from("<II", data, offset)
    return count, position


def source_array(data, offset, code, item_size=1):
    count, position = pairs(data, offset)
    length = count * item_size * struct.calcsize("<" + code)
    if position + length > len(data):
        raise ValueError("M2 array exceeds MD21 data")
    return array(data[position:position + length], code)


def bbox(positions):
    if not positions:
        return {"min": [0, 0, 0], "max": [0, 0, 0]}
    return {"min": [min(positions[i::3]) for i in range(3)],
            "max": [max(positions[i::3]) for i in range(3)]}


def check_mesh(positions, indices):
    if len(positions) % 3 or len(indices) % 3:
        raise ValueError("Incomplete triangle or position")
    if indices and max(indices) >= len(positions) // 3:
        raise ValueError("Triangle references missing vertex")
    if not all(math.isfinite(x) for x in positions):
        raise ValueError("Non-finite vertex coordinate")


class MeshBuffer:
    TYPES = {"Float32": "f", "Uint32": "I", "Uint16": "H", "Uint8": "B"}

    def __init__(self):
        self.data = bytearray()

    def add(self, values, kind="Float32", item_size=1, normalized=False):
        # Every attribute starts at a 4-byte boundary for typed-array readers.
        self.data.extend(bytes((-len(self.data)) % 4))
        offset = len(self.data)
        code = self.TYPES[kind]
        self.data.extend(struct.pack("<" + code * len(values), *values))
        if len(values) % item_size:
            raise ValueError("Attribute is not aligned to its item size")
        result = {"type": kind, "itemSize": item_size,
                  "byteOffset": offset, "count": len(values) // item_size}
        if normalized:
            result["normalized"] = True
        return result


def parse_root(data):
    sections = chunks(data)
    materials = []
    raw_materials = sections["MOMT"][0]
    for i in range(len(raw_materials) // 64):
        values = struct.unpack_from("<16I", raw_materials, i * 64)
        materials.append({"id": i, "flags": values[0], "shader": values[1],
                          "blendMode": values[2], "textureFileDataID": values[3],
                          "emissiveBGRA": values[4], "texture2": values[6],
                          "diffuseBGRA": values[7], "terrainType": values[8]})
    header = sections["MOHD"][0]
    return {"materials": materials, "names": sections["MOGN"][0],
            "groupIDs": array(sections["GFID"][0], "I"),
            "ambientBGRA": struct.unpack_from("<I", header, 28)[0],
            "flags": struct.unpack_from("<H", header, 60)[0],
            "sections": sections}


def parse_group(data, group_index, root):
    sections = chunks(data)
    group = sections["MOGP"][0]
    sections = chunks(group, 68)
    name_offset, _, flags = struct.unpack_from("<3I", group)
    name = root["names"][name_offset:].split(b"\0", 1)[0].decode("utf-8")
    positions = array(sections["MOVT"][0], "f")
    indices = array(sections["MOVI"][0], "H")
    normals = array(sections["MONR"][0], "f")
    uv = array(sections["MOTV"][0], "f")
    mopy = sections["MOPY"][0]
    if len(mopy) != len(indices) // 3 * 2:
        raise ValueError("MOPY and MOVI triangle counts disagree")
    collision = []
    collision_flags = []
    for triangle, flag in enumerate(mopy[::2]):
        # Original MOPY collision bit, plus solid render faces. Decorative
        # detail faces are excluded. Hidden collision-only faces remain.
        collidable = bool(flag & 0x08 or ((flag & 0x20) and not (flag & 0x04)))
        if collidable:
            collision.extend(indices[triangle * 3:triangle * 3 + 3])
            collision_flags.append(flag)
    check_mesh(positions, indices)
    check_mesh(positions, collision)
    vertex_count = len(positions) // 3
    if len(normals) != len(positions) or len(uv) != vertex_count * 2:
        raise ValueError("WMO vertex attributes have differing counts")
    render_groups = []
    material_ids = set()
    for i in range(len(sections["MOBA"][0]) // 24):
        batch = struct.unpack_from("<6HI3H2B", sections["MOBA"][0], i * 24)
        first_face, count, first_vertex, last_vertex, batch_flags, material = batch[6:]
        # Flag 2 promotes material index to the uint16 field at offset 10.
        if batch_flags & 2:
            material = batch[5]
        if first_face + count > len(indices) or material >= len(root["materials"]):
            raise ValueError("WMO render batch is out of range")
        render_groups.append({"start": first_face, "count": count, "material": material,
                              "flags": batch_flags, "firstVertex": first_vertex,
                              "lastVertex": last_vertex})
        material_ids.add(material)
    buffer = MeshBuffer()
    attributes = {"position": buffer.add(positions, item_size=3),
                  "normal": buffer.add(normals, item_size=3),
                  "uv": buffer.add(uv, item_size=2)}
    if "MOCV" in sections:
        mocv = sections["MOCV"][0]
        if len(mocv) != vertex_count * 4:
            raise ValueError("MOCV count does not match MOVT")
        rgb = []
        for b, g, r, _ in struct.iter_unpack("4B", mocv):
            rgb.extend([r / 255, g / 255, b / 255])
        attributes["color"] = buffer.add(rgb, item_size=3)
        raw_color = buffer.add(list(mocv), "Uint8", 4)
    else:
        raw_color = None
    index = buffer.add(indices, "Uint32")
    collision_index = buffer.add(collision, "Uint32")
    triangle_flags = buffer.add(list(mopy[::2]), "Uint8")
    triangle_materials = buffer.add(list(mopy[1::2]), "Uint8")
    collision_flags_attribute = buffer.add(collision_flags, "Uint8")
    mesh = {"id": f"wmo-{group_index}", "kind": "wmo", "groupIndex": group_index,
            "groupName": name, "groupFlags": flags,
            "fileDataID": root["groupIDs"][group_index],
            "buffer": f"wmo-{group_index}.bin", "attributes": attributes,
            "index": index, "groups": render_groups, "bounds": bbox(positions),
            "collision": {"position": attributes["position"], "index": collision_index,
                          "triangleFlags": collision_flags_attribute,
                          "bounds": bbox(positions), "triangleCount": len(collision) // 3,
                          "policy": "(MOPY.flags & 0x08) || ((flags & 0x20) && !(flags & 0x04))"},
            "originalTriangleFlags": triangle_flags,
            "originalTriangleMaterials": triangle_materials,
            "vertexCount": vertex_count, "triangleCount": len(indices) // 3,
            "rawVertexBGRA": raw_color}
    return mesh, buffer.data, material_ids


def parse_m2(data, skin_data, name, file_id):
    sections = chunks(data, reverse=False)
    model = sections["MD21"][0]
    if model[:4] != b"MD20":
        raise ValueError("Unsupported M2 header")
    vertex_count, vertex_offset = pairs(model, 60)
    positions, normals, uv = [], [], []
    for i in range(vertex_count):
        offset = vertex_offset + i * 48
        positions.extend(struct.unpack_from("<3f", model, offset))
        normals.extend(struct.unpack_from("<3f", model, offset + 20))
        uv.extend(struct.unpack_from("<2f", model, offset + 32))
    if skin_data[:4] != b"SKIN":
        raise ValueError("Unsupported M2 skin")
    lookup = source_array(skin_data, 4, "H")
    triangle_lookup = source_array(skin_data, 12, "H")
    if triangle_lookup and max(triangle_lookup) >= len(lookup):
        raise ValueError("Skin triangle references missing lookup")
    indices = [lookup[x] for x in triangle_lookup]
    material_values = source_array(model, 112, "H", 2)
    material_count = len(material_values) // 2
    texture_combos = source_array(model, 128, "H")
    texture_ids = array(sections["TXID"][0], "I")
    material_defs = [{"id": f"{name}:{i}", "flags": material_values[i * 2],
                      "blendMode": material_values[i * 2 + 1]} for i in range(material_count)]
    submesh_count, submesh_offset = pairs(skin_data, 28)
    submeshes = []
    for i in range(submesh_count):
        values = struct.unpack_from("<10H7f", skin_data, submesh_offset + i * 48)
        submeshes.append({"start": values[4] + (values[1] << 16), "count": values[5]})
    unit_count, unit_offset = pairs(skin_data, 36)
    render_groups = []
    for i in range(unit_count):
        values = struct.unpack_from("<Bb11H", skin_data, unit_offset + i * 24)
        submesh, material_index, texture_combo = values[3], values[6], values[9]
        if submesh >= len(submeshes) or material_index >= len(material_defs):
            raise ValueError("Skin material unit is out of range")
        texture_index = texture_combos[texture_combo]
        material_defs[material_index]["textureFileDataID"] = texture_ids[texture_index]
        render_groups.append({**submeshes[submesh], "material": f"{name}:{material_index}"})
    # M2 has its own collision vertices. They are not the visible bars.
    collision_indices = source_array(model, 216, "H")
    collision_positions = source_array(model, 224, "f", 3)
    collision_normals = source_array(model, 232, "f", 3)
    check_mesh(positions, indices)
    check_mesh(collision_positions, collision_indices)
    buffer = MeshBuffer()
    attributes = {"position": buffer.add(positions, item_size=3),
                  "normal": buffer.add(normals, item_size=3),
                  "uv": buffer.add(uv, item_size=2)}
    index = buffer.add(indices, "Uint32")
    collision = {"position": buffer.add(collision_positions, item_size=3),
                 "index": buffer.add(collision_indices, "Uint32"),
                 "normal": buffer.add(collision_normals, item_size=3),
                 "bounds": bbox(collision_positions),
                 "triangleCount": len(collision_indices) // 3,
                 "policy": "Dedicated, unmodified MD21 collision positions and indices"}
    mesh = {"id": name, "kind": "m2", "fileDataID": file_id,
            "buffer": f"{name}.bin", "attributes": attributes, "index": index,
            "groups": render_groups, "bounds": bbox(positions), "collision": collision,
            "vertexCount": vertex_count, "triangleCount": len(indices) // 3,
            "skinFileDataID": array(sections["SFID"][0], "I")[0],
            "pose": "Unmodified base pose, closed gate; no animation applied"}
    return mesh, buffer.data, material_defs, texture_ids


def rgb565(value):
    r, g, b = (value >> 11) & 31, (value >> 5) & 63, value & 31
    return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]


def decode_blp(data):
    """Decode the original highest-resolution BLP2 mip to RGBA bytes."""
    if data[:4] != b"BLP2":
        raise ValueError("Only BLP2 textures are supported")
    _, encoding, alpha_depth, alpha_encoding, _, width, height = struct.unpack_from("<I4B2I", data, 4)
    if width < 1 or height < 1 or width * height > 16777216:
        raise ValueError("Invalid BLP dimensions")
    offset = struct.unpack_from("<I", data, 20)[0]
    length = struct.unpack_from("<I", data, 84)[0]
    pixels = data[offset:offset + length]
    out = bytearray(width * height * 4)
    if len(pixels) != length:
        raise ValueError("Truncated BLP mip")
    if encoding == 1:
        palette = data[148:1172]
        pixel_count = width * height
        alpha = pixels[pixel_count:]
        for i, index in enumerate(pixels[:pixel_count]):
            b, g, r, _ = palette[index * 4:index * 4 + 4]
            a = 255
            if alpha_depth == 1:
                a = 255 if alpha[i // 8] & (1 << (i % 8)) else 0
            elif alpha_depth == 4:
                a = ((alpha[i // 2] >> ((i % 2) * 4)) & 15) * 17
            elif alpha_depth == 8:
                a = alpha[i]
            out[i * 4:i * 4 + 4] = bytes([r, g, b, a])
    elif encoding == 3:
        if len(pixels) < width * height * 4:
            raise ValueError("Truncated BGRA texture")
        for i in range(width * height):
            b, g, r, a = pixels[i * 4:i * 4 + 4]
            out[i * 4:i * 4 + 4] = bytes([r, g, b, a])
    elif encoding == 2:
        block_size = 8 if alpha_depth <= 1 else 16
        blocks_x, blocks_y = (width + 3) // 4, (height + 3) // 4
        if len(pixels) < blocks_x * blocks_y * block_size:
            raise ValueError("Truncated DXT texture")
        for by in range(blocks_y):
            for bx in range(blocks_x):
                block = pixels[(by * blocks_x + bx) * block_size:]
                alpha = [255] * 16
                color_offset = 0
                if block_size == 16:
                    color_offset = 8
                    if alpha_encoding == 7:
                        a0, a1 = block[0], block[1]
                        if a0 > a1:
                            table = [a0, a1] + [((7 - i) * a0 + i * a1) // 7 for i in range(1, 7)]
                        else:
                            table = [a0, a1] + [((5 - i) * a0 + i * a1) // 5 for i in range(1, 5)] + [0, 255]
                        selectors = int.from_bytes(block[2:8], "little")
                        alpha = [table[(selectors >> (3 * i)) & 7] for i in range(16)]
                    elif alpha_encoding == 1:
                        alphas = int.from_bytes(block[:8], "little")
                        alpha = [((alphas >> (4 * i)) & 15) * 17 for i in range(16)]
                    else:
                        raise ValueError(f"Unsupported DXT alpha encoding {alpha_encoding}")
                c0, c1, selectors = struct.unpack_from("<HHI", block, color_offset)
                color0, color1 = rgb565(c0), rgb565(c1)
                if c0 > c1 or block_size == 16:
                    table = [color0, color1,
                             [(2 * a + b) // 3 for a, b in zip(color0, color1)],
                             [(a + 2 * b) // 3 for a, b in zip(color0, color1)]]
                else:
                    table = [color0, color1, [(a + b) // 2 for a, b in zip(color0, color1)], [0, 0, 0]]
                for i in range(16):
                    x, y = bx * 4 + i % 4, by * 4 + i // 4
                    if x >= width or y >= height:
                        continue
                    select = (selectors >> (2 * i)) & 3
                    a = alpha[i]
                    if block_size == 8 and c0 <= c1 and select == 3:
                        a = 0 if alpha_depth else 255
                    target = (y * width + x) * 4
                    out[target:target + 4] = bytes(table[select] + [a])
    else:
        raise ValueError(f"Unsupported BLP2 encoding {encoding}")
    return width, height, bytes(out)


def write_png(path, width, height, rgba):
    def chunk(tag, contents):
        return struct.pack(">I", len(contents)) + tag + contents + struct.pack(">I", zlib.crc32(tag + contents) & 0xffffffff)
    scanlines = b"".join(b"\0" + rgba[row * width * 4:(row + 1) * width * 4] for row in range(height))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(scanlines, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, required=True, help="Folder of offline extracts, outside the public docs folder")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "docs/assets/scene")
    parser.add_argument("--groups", default="17,38", help="Exact WMO group indices to include")
    parser.add_argument("--probe", type=Path, help="Optional existing offline CascLib extraction executable")
    parser.add_argument("--storage", type=Path, help="Read-only Era storage view used by --probe")
    parser.add_argument("--workspace", type=Path, help="Legacy probe cwd, with work/gothik-local-assets as its output")
    parser.add_argument("--version", help="Source version when importing an existing raw extract")
    parser.add_argument("--build-key", help="Source build key when importing an existing raw extract")
    args = parser.parse_args()
    raw, out = args.raw.resolve(), args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    group_indices = sorted(set(int(x) for x in args.groups.split(",")))
    source_records = {}
    source_version, source_build_key = args.version or VERSION, args.build_key or BUILD_KEY
    if args.storage:
        build_lines = (args.storage.resolve() / ".build.info").read_text().splitlines()
        build_headers = [x.split("!", 1)[0] for x in build_lines[0].split("|")]
        records = [dict(zip(build_headers, line.split("|"))) for line in build_lines[1:]]
        selected = [r for r in records if r.get("Product") == "wow_classic_era" and r.get("Active") == "1"]
        if len(selected) != 1:
            raise ValueError("Expected one active Classic Era manifest row")
        recorded = selected[0]
        if (args.version and args.version != recorded["Version"]) or (args.build_key and args.build_key != recorded["Build Key"]):
            raise ValueError("Requested provenance differs from the selected Era manifest")
        source_version, source_build_key = recorded["Version"], recorded["Build Key"]

    def extract(requests):
        if not args.probe or not args.storage:
            raise FileNotFoundError("Missing original files. Supply offline --probe and --storage, or extract them into --raw first: " + ", ".join(requests))
        command = [str(args.probe.resolve()), "--storage", str(args.storage.resolve())]
        cwd = None
        if args.workspace:
            expected = args.workspace.resolve() / "work/gothik-local-assets"
            if raw != expected:
                raise ValueError(f"Legacy probe writes to {expected}; --raw must match")
            cwd = args.workspace.resolve()
        else:
            command.extend(["--output", str(raw)])
        command.extend(requests)
        result = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
        if result.returncode or "online feature disabled" not in result.stdout:
            raise RuntimeError("Offline extraction failed; no fallback was attempted.\n" + result.stdout + result.stderr)

    def read_file(name, request, file_id=None):
        path = raw / name
        if not path.is_file():
            extract([request])
        data = path.read_bytes()
        source_records[name] = {"name": name, "fileDataID": file_id, "bytes": len(data),
                                "sha256": hashlib.sha256(data).hexdigest()}
        return data

    root = parse_root(read_file(ROOT_NAME, ROOT_PATH, 110251))
    # These hashes document the installed display/model lookup and WMO
    # instance transform. The table/map files are not distributed with the UI.
    for file_id in [1266277, 825038, 827115]:
        if (raw / f"{file_id}.blp").is_file():
            read_file(f"{file_id}.blp", f"id:{file_id}", file_id)
    mesh_records, material_ids = [], set()
    for group_index in group_indices:
        name = f"stratholme_raid_{group_index:03}.wmo"
        request = "World/WMO/Dungeon/LD_Stratholme/" + name
        data = read_file(name, request, root["groupIDs"][group_index])
        mesh, buffer, used = parse_group(data, group_index, root)
        (out / mesh["buffer"]).write_bytes(buffer)
        mesh_records.append(mesh)
        material_ids.update(used)
    materials = [root["materials"][i] for i in sorted(material_ids)]
    gate_data = read_file("nox_door_portcullis.m2", DOOR_PATH, 203994)
    gate_sections = chunks(gate_data, reverse=False)
    skin_id = array(gate_sections["SFID"][0], "I")[0]
    skin_data = read_file(f"{skin_id}.blp", f"id:{skin_id}", skin_id)
    gate, gate_buffer, gate_materials, gate_texture_ids = parse_m2(gate_data, skin_data, "gate", 203994)
    (out / gate["buffer"]).write_bytes(gate_buffer)
    mesh_records.append(gate)
    materials.extend(gate_materials)
    texture_ids = sorted({m["textureFileDataID"] for m in materials if m.get("textureFileDataID")} | set(gate_texture_ids))
    missing = [f"id:{i}" for i in texture_ids if not (raw / f"{i}.blp").is_file()]
    if missing:
        extract(missing)
    textures = []
    for file_id in texture_ids:
        name = f"{file_id}.blp"
        data = read_file(name, f"id:{file_id}", file_id)
        width, height, rgba = decode_blp(data)
        png_name = f"texture-{file_id}.png"
        write_png(out / png_name, width, height, rgba)
        textures.append({"fileDataID": file_id, "file": png_name, "width": width,
                         "height": height, "sourceSHA256": source_records[name]["sha256"],
                         "colorSpace": "sRGB", "flipY": False, "wrap": "repeat"})
    for material in materials:
        file_id = material.get("textureFileDataID")
        material["texture"] = f"texture-{file_id}.png" if file_id else None
    manifest = {
        "schema": "gothik-client-scene-v1", "coordinateSystem": "Original WMO/M2 XYZ, Z up, right-handed",
        "bufferEndianness": "little", "units": "Original client model units",
        "textureOrientation": "Unmodified top-down BLP pixels and raw UV; Three.js texture.flipY = false",
        "client": {"product": "wow_classic_era", "version": source_version,
                   "buildKey": source_build_key, "import": "offline local client"},
        "root": {"fileDataID": 110251, "ambientBGRA": root["ambientBGRA"], "flags": root["flags"]},
        "meshes": mesh_records, "materials": materials, "textures": textures,
        "instances": [{"mesh": f"wmo-{i}", "position": [0, 0, 0], "rotationZ": 0, "scale": 1} for i in group_indices],
        "gatePlacement": {"entry": 181125, "display": 6676, "scale": 0.790041,
                          "worldPosition": [2633.84, -3336.82, 267.084], "worldOrientation": 0,
                          "wmoOriginWorld": [3005.783203125, -3434.357421875, 300.9723205566406],
                          "position": [371.943203125, -97.537421875, -33.88832055664062],
                          "rotationZ": math.pi,
                          "precision": "Template/spawn reconstructed from CMaNGOS Classic DB; spawn coordinates rounded in source, not live Era measurements"},
        "provenance": {"sourceFiles": sorted(source_records.values(), key=lambda x: x["name"]),
                       "formatReferences": REFERENCES,
                       "geometry": "Original vertices and triangle indices retained; no welding, decimation, or guessed collision boxes",
                       "scope": "Gothik exit approach, gate and adjacent hallway; no client archives included"}}
    manifest["instances"].append({"mesh": "gate", "position": manifest["gatePlacement"]["position"],
                                  "rotationZ": math.pi, "scale": 0.790041})
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"manifest": str(out / "manifest.json"), "groups": group_indices,
                      "textures": len(textures), "meshes": [{"id": x["id"], "vertices": x["vertexCount"],
                                                               "triangles": x["triangleCount"],
                                                               "collisionTriangles": x["collision"]["triangleCount"],
                                                               "bounds": x["bounds"]} for x in mesh_records]}, indent=2))


if __name__ == "__main__":
    main()
