#!/usr/bin/env python3
"""Prepare the LIVECell nuclear-count benchmark (A172, A549) as cache/fields.npz.

Usage: python prepare.py CACHE [--raw RAW]

RAW defaults to CACHE/raw. Missing official files are downloaded; every file
(existing or downloaded) must match the pinned SHA256 or the script aborts.

Output CACHE/fields.npz:
  images   uint8 (N,128,160)  full 1408x1040 field, box-filter downsampled (no crop)
  line     str   'A172'|'A549'
  well     str   plate coordinate, e.g. 'A6' (both acquisitions use field 1)
  filename str   official count-json key (basename of the zip member, sans '_focusProblem')
  hours    float64 hours since the line's earliest acquisition (over all zip images)
  count    int64 fluorescence nuclear count
Order: (line, time, well), deterministic.

Source facts (verified against the pinned files):
  A172: 348 PNGs, 348 json keys, exact match, all counts finite.
  A549: 450 PNGs, 450 json keys. 7 PNGs are named '<key>_focusProblem.png'; their
  json counts are NaN. These 7 (wells D5/D6) are explicit exclusions, never zero-filled,
  leaving 443 rows. Total 348 + 443 = 791.
"""
import argparse
import hashlib
import io
import json
import math
import re
import sys
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

BASE = "https://livecell-dataset.s3.eu-central-1.amazonaws.com/LIVECell_dataset_2021/nuclear_count_benchmark/"
SHA256 = {
    "A172.zip": "5bbf23937dbb25285d3af65444a2fd6bf20b155747779a25114edfb13c580716",
    "A172_counts.json": "637a98c520a1c4f28d0ef9bee9ddb62c1da82c440481f887701ae2b652ea5684",
    "A549.zip": "97b59ff538cc7e87b5cf888da010ad560d7bc03d04f074cf4b962cc712e27737",
    "A549_counts.json": "9edaf4c58620287b55c67e591884b795bbc9180944fc6daf6c1d41a73b1cc07d",
}
LINES = ("A172", "A549")
EXPECT_ROWS = {"A172": 348, "A549": 443}
EXPECT_EXCLUDED = {"A172": 0, "A549": 7}
SRC_SIZE = (1408, 1040)  # PIL (width, height)
OUT_HW = (128, 160)
NAME = re.compile(r"^([A-Z]\d+-\d+)_(\d{6})_(\d{4})(_focusProblem)?\.png$")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(raw):
    raw.mkdir(parents=True, exist_ok=True)
    for name, want in SHA256.items():
        p = raw / name
        if not p.exists():
            tmp = p.with_suffix(p.suffix + ".part")
            print(f"downloading {name}", file=sys.stderr)
            urllib.request.urlretrieve(BASE + name, tmp)
            tmp.replace(p)
        got = sha256(p)
        if got != want:
            raise SystemExit(f"SHA256 mismatch for {p}: {got} != {want}")


def load_line(raw, line):
    """Return (rows, excluded) with rows = list of (time, well, filename, member, count)."""
    counts = json.loads((raw / f"{line}_counts.json").read_text())
    zf = zipfile.ZipFile(raw / f"{line}.zip")
    members = [n for n in zf.namelist() if not n.endswith("/")]
    if any(not n.endswith(".png") for n in members):
        raise SystemExit(f"{line}: non-PNG member in zip")

    by_key = {}
    all_times = []
    for m in members:
        base = m.rsplit("/", 1)[-1]
        mt = NAME.match(base)
        if not mt:
            raise SystemExit(f"{line}: unparseable image name {m}")
        well, day, hm, focus = mt.groups()
        t = datetime.strptime(day + hm, "%y%m%d%H%M")
        key = f"{well}_{day}_{hm}.png"  # json key, drops _focusProblem
        if key in by_key:
            raise SystemExit(f"{line}: duplicate image for {key}")
        well_id, field = well.split("-")
        if field != "1":
            raise SystemExit(f"{line}: unexpected field {well} in {m}")
        by_key[key] = (t, well_id, m, bool(focus))
        all_times.append(t)
    if set(by_key) != set(counts):
        raise SystemExit(
            f"{line}: zip/json key mismatch: only zip {sorted(set(by_key) - set(counts))[:5]}, "
            f"only json {sorted(set(counts) - set(by_key))[:5]}"
        )
    if len({(w, t) for t, w, _, _ in by_key.values()}) != len(by_key):
        raise SystemExit(f"{line}: well/time not unique")

    t0 = min(all_times)
    rows, excluded = [], []
    for key, (t, well, m, focus) in by_key.items():
        v = counts[key]
        if isinstance(v, str):
            if not re.fullmatch(r"\d+", v):
                raise SystemExit(f"{line}: bad count {v!r} for {key}")
            if focus:
                raise SystemExit(f"{line}: focusProblem image {key} has a finite count")
            rows.append(((t - t0).total_seconds() / 3600.0, t, well, key, m, int(v)))
        elif isinstance(v, float) and math.isnan(v):
            if not focus:
                raise SystemExit(f"{line}: NaN count for non-focusProblem image {key}")
            excluded.append(key)
        else:
            raise SystemExit(f"{line}: unexpected count {v!r} for {key}")
    if len(rows) != EXPECT_ROWS[line] or len(excluded) != EXPECT_EXCLUDED[line]:
        raise SystemExit(f"{line}: got {len(rows)} rows/{len(excluded)} excluded")
    rows.sort(key=lambda r: (r[1], r[2]))
    return zf, rows, sorted(excluded)


def downsample(data):
    im = Image.open(io.BytesIO(data))
    if im.size != SRC_SIZE or im.mode != "L":
        raise SystemExit(f"unexpected image {im.size} {im.mode}")
    a = np.asarray(im.resize((OUT_HW[1], OUT_HW[0]), Image.BOX), dtype=np.uint8)
    assert a.shape == OUT_HW
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cache", type=Path)
    ap.add_argument("--raw", type=Path, default=None)
    args = ap.parse_args()
    cache = args.cache.expanduser().resolve()
    raw = (args.raw or cache / "raw").expanduser().resolve()
    fetch(raw)

    images, line_v, well_v, file_v, hours_v, count_v = [], [], [], [], [], []
    for line in LINES:
        zf, rows, excluded = load_line(raw, line)
        print(f"{line}: {len(rows)} rows; excluded (NaN count) {len(excluded)}: {excluded}")
        for hours, _, well, key, member, count in rows:
            images.append(downsample(zf.read(member)))
            line_v.append(line)
            well_v.append(well)
            file_v.append(key)
            hours_v.append(hours)
            count_v.append(count)
        zf.close()

    n = len(images)
    out = dict(
        images=np.stack(images),
        line=np.array(line_v, dtype=str),
        well=np.array(well_v, dtype=str),
        filename=np.array(file_v, dtype=str),
        hours=np.array(hours_v, dtype=np.float64),
        count=np.array(count_v, dtype=np.int64),
    )
    assert out["images"].shape == (n, *OUT_HW) and out["images"].dtype == np.uint8
    assert n == sum(EXPECT_ROWS.values())
    assert len(set(zip(out["line"], out["well"], out["hours"]))) == n
    assert len(set(zip(out["line"], out["filename"]))) == n
    assert np.isfinite(out["hours"]).all() and (out["count"] >= 0).all()
    for line in LINES:
        assert out["hours"][out["line"] == line].min() == 0.0

    cache.mkdir(parents=True, exist_ok=True)
    tmp = cache / "fields.tmp.npz"
    np.savez_compressed(tmp, **out)
    tmp.replace(cache / "fields.npz")
    print(f"wrote {cache / 'fields.npz'} ({n} fields)")


if __name__ == "__main__":
    main()
