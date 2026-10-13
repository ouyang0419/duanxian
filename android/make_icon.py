"""Launcher icon: a paper slip with a cinnabar edge and a rising line."""

import struct
import zlib
from pathlib import Path

INK = (27, 36, 48, 255)
PAPER = (247, 250, 251, 255)
CINNABAR = (158, 43, 43, 255)
SIZE = 192


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def length(x: float, y: float) -> float:
    return (x * x + y * y) ** 0.5


def rounded_box(px: float, py: float, cx: float, cy: float, half_w: float, half_h: float, radius: float) -> float:
    qx = abs(px - cx) - half_w + radius
    qy = abs(py - cy) - half_h + radius
    return min(max(qx, qy), 0.0) + length(max(qx, 0.0), max(qy, 0.0)) - radius


def cover(distance: float) -> float:
    return max(0.0, min(1.0, 0.5 - distance))


def mix(base: tuple[int, int, int, int], color: tuple[int, int, int, int], amount: float) -> tuple[int, int, int, int]:
    return tuple(int(base[i] + (color[i] - base[i]) * amount) for i in range(4))


def segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx = bx - ax
    dy = by - ay
    denom = dx * dx + dy * dy
    if denom == 0:
        return length(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denom))
    return length(px - (ax + t * dx), py - (ay + t * dy))


def write_png(path: Path, size: int = SIZE) -> None:
    slip = rounded_box
    cx = cy = (size - 1) / 2
    half = size * 0.31
    radius = 14
    bar = cx - half + size * 0.11
    points = ((68, 128), (96, 104), (114, 112), (150, 64))
    stroke = 8.0
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            pixel = INK
            edge = slip(x, y, cx, cy, half, half, radius)
            slip_cover = cover(edge)
            if slip_cover:
                fill = CINNABAR if x < bar else PAPER
                pixel = mix(pixel, fill, slip_cover)
            nearest = min(segment_distance(x, y, *points[i], *points[i + 1]) for i in range(len(points) - 1))
            line_cover = cover(nearest - stroke / 2) * slip_cover
            if line_cover:
                pixel = mix(pixel, CINNABAR, line_cover)
            raw.extend(pixel)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


if __name__ == "__main__":
    write_png(Path(__file__).resolve().parent / "res" / "drawable" / "ic_launcher.png")
