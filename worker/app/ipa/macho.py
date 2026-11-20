from __future__ import annotations

import struct
from pathlib import Path
from typing import List

# Pure-Python header read: the binary is NEVER executed.
_CPU = {(7 | 0x01000000): "x86_64", 7: "i386", (12 | 0x01000000): "arm64", 12: "arm", (12 | 0x02000000): "arm64_32"}
_MAGICS_THIN = {0xFEEDFACE: "<", 0xFEEDFACF: "<", 0xCEFAEDFE: ">", 0xCFFAEDFE: ">"}


def architectures(path: Path) -> List[str]:
    try:
        with open(path, "rb") as f:
            head = f.read(4096)
    except OSError:
        return []
    if len(head) < 8:
        return []
    magic_be = struct.unpack(">I", head[:4])[0]
    if magic_be in (0xCAFEBABE, 0xCAFEBABF):  # fat
        wide = magic_be == 0xCAFEBABF
        n = struct.unpack(">I", head[4:8])[0]
        size = 32 if wide else 20
        out = []
        for i in range(min(n, 8)):
            off = 8 + i * size
            if off + 4 > len(head):
                break
            cpu = struct.unpack(">I", head[off:off + 4])[0]
            out.append(_CPU.get(cpu, f"cpu{cpu}"))
        return out
    magic_le = struct.unpack("<I", head[:4])[0]
    if magic_le in (0xFEEDFACE, 0xFEEDFACF):
        cpu = struct.unpack("<I", head[4:8])[0]
        return [_CPU.get(cpu, f"cpu{cpu}")]
    return []
