#!/usr/bin/env python3
"""
Patch the residual `IDI_MYICON` RT_GROUP_ICON resource that bun's compiled
Windows binary always carries.

bun's stub PE has a string-named `IDI_MYICON` group_icon that references
RT_ICON id=1 with metadata claiming it's 256x256 / 270600 bytes (bun's
default mountain icon). When `rcedit` re-injects our FuseBase icons, the
RT_ICON entries get overwritten — but `IDI_MYICON`'s metadata is left
unchanged and now points at our 16x16 BMP (1128 bytes) while still
declaring "I'm a 256x256, 270600 bytes" image.

Some Windows icon-extraction paths use `IDI_MYICON`; they then read 1128
bytes of 16x16 BMP data and try to render it as 256x256 — the result is the
blurry icon QA reported on NIM-40683 even after we added a real 256x256
PNG entry to our group_icon.

Fix: rewrite `IDI_MYICON`'s single 14-byte GRPICONDIRENTRY in place so it
points to our largest icon (the 256x256 PNG that rcedit added). The data
size doesn't change, so no PE-section reflowing needed.
"""
from __future__ import annotations

import struct
import sys

import pefile

RT_GROUP_ICON = 14
GRPICONDIR_HEADER_SIZE = 6
GRPICONDIRENTRY_SIZE = 14


def find_group_icon(pe: pefile.PE, *, numeric_id: int | None = None, name_str: str | None = None):
    for t in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        if t.struct.Id != RT_GROUP_ICON:
            continue
        for n in t.directory.entries:
            if name_str is not None:
                if n.name is not None and str(n.name) == name_str:
                    return n
            elif numeric_id is not None:
                if n.name is None and n.struct.Id == numeric_id:
                    return n
    return None


def find_largest_icon_in_group(pe: pefile.PE, group):
    """Read GRPICONDIR data and return (icon_id, bytes_in_res) for the 256x256
    entry, or for whichever entry has the largest pixel area."""
    lang = group.directory.entries[0]
    de = lang.data.struct
    data = pe.get_data(de.OffsetToData, de.Size)
    _reserved, _type, count = struct.unpack("<HHH", data[:GRPICONDIR_HEADER_SIZE])
    best = None
    for i in range(count):
        off = GRPICONDIR_HEADER_SIZE + i * GRPICONDIRENTRY_SIZE
        w, h, _col, _r, _planes, _bits, n_bytes, icon_id = struct.unpack(
            "<BBBBHHIH", data[off : off + GRPICONDIRENTRY_SIZE]
        )
        actual_w = 256 if w == 0 else w
        actual_h = 256 if h == 0 else h
        area = actual_w * actual_h
        if best is None or area > best[0]:
            best = (area, icon_id, n_bytes)
    if best is None:
        return None
    return best[1], best[2]


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: fix-windows-idi-myicon.py <exe>", file=sys.stderr)
        return 2
    exe_path = sys.argv[1]

    pe = pefile.PE(exe_path)
    if not hasattr(pe, "DIRECTORY_ENTRY_RESOURCE"):
        print("No resource directory; nothing to patch.")
        return 0

    idi = find_group_icon(pe, name_str="IDI_MYICON")
    if idi is None:
        print("No residual IDI_MYICON group_icon found; nothing to patch.")
        return 0

    main_group = find_group_icon(pe, numeric_id=0) or find_group_icon(pe, numeric_id=1)
    if main_group is None:
        print("Could not find rcedit-injected numeric group_icon; aborting.", file=sys.stderr)
        return 1

    largest = find_largest_icon_in_group(pe, main_group)
    if largest is None:
        print("Main group_icon has no entries; aborting.", file=sys.stderr)
        return 1
    icon_id, bytes_in_res = largest

    lang = idi.directory.entries[0]
    de = lang.data.struct
    old_data = pe.get_data(de.OffsetToData, de.Size)
    new_entry = struct.pack(
        "<BBBBHHIH",
        0, 0, 0, 0, 1, 32, bytes_in_res, icon_id,
    )
    new_data = old_data[:GRPICONDIR_HEADER_SIZE] + new_entry
    if len(new_data) != de.Size:
        print(f"unexpected IDI_MYICON size {de.Size} (need {len(new_data)})", file=sys.stderr)
        return 1

    file_off = pe.get_offset_from_rva(de.OffsetToData)
    pe.set_bytes_at_offset(file_off, new_data)
    pe.write(filename=exe_path)

    print(
        f"Patched IDI_MYICON: now points to RT_ICON id={icon_id} "
        f"({bytes_in_res} bytes, 256x256)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
