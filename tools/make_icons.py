#!/usr/bin/env python3
"""Erzeugt die App-Icons als PNG — ohne Fremdbibliothek, damit der Build
ueberall laeuft. Dunkles Quadrat mit gruenem Blitz."""

import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = (11, 18, 32)
FG = (74, 222, 128)

# Blitz als Polygon in einem 100x100-Raster
BOLT = [(56, 6), (26, 56), (46, 56), (40, 94), (74, 40), (52, 40)]


def inside(x, y, poly):
    """Punkt-in-Polygon (Strahlmethode)."""
    hit = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xi = x1 + (y - y1) / (y2 - y1) * (x2 - x1)
            if x < xi:
                hit = not hit
    return hit


def render(size):
    """Ein Bild als Liste von Zeilen (jeweils RGB-Bytes)."""
    rows = []
    r = size * 0.20          # Eckenradius
    for py in range(size):
        row = bytearray()
        for px in range(size):
            # abgerundete Ecken
            cx = min(px, size - 1 - px)
            cy = min(py, size - 1 - py)
            corner = (cx < r and cy < r and
                      (r - cx) ** 2 + (r - cy) ** 2 > r * r)
            if corner:
                row += bytes((0, 0, 0))
                continue
            gx, gy = px / size * 100, py / size * 100
            row += bytes(FG if inside(gx, gy, BOLT) else BG)
        rows.append(bytes(row))
    return rows


def write_png(path, rows, size):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print(f"  {path} ({len(png)} Bytes)")


def main():
    out = os.path.join(ROOT, "icons")
    os.makedirs(out, exist_ok=True)
    for size in (192, 512):
        write_png(os.path.join(out, f"icon-{size}.png"), render(size), size)


if __name__ == "__main__":
    main()
