#!/usr/bin/env python3
"""
ingest_csv.py — clean the raw poem corpus CSV into data/poems_clean.csv.

Input:
  A raw CSV with columns:
    poem_number, poet, original_japanese, original_romaji,
    dickens_text_1866, noguchi_text_1907, porter_text_1909, maccauley_text_1917

  The four translation columns come with embedded line-number markers
  (e.g. "1My lowly hut...\\n2From fields...") and occasional U+2028 line
  separators instead of "\\n". Japanese/romaji columns are clean as-is.

Output:
  data/poems_clean.csv — same columns, translation cells rewritten as
  plain "\\n"-joined lines with the digit markers stripped.

Usage:
  python3 ingest_csv.py /path/to/raw.csv
  python3 ingest_csv.py                     # defaults to the path below
"""

import csv
import re
import sys
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_PATH = ROOT / "data" / "poems_clean.csv"

TRANS_COLS = [
    "dickens_text_1866",
    "noguchi_text_1907",
    "porter_text_1909",
    "maccauley_text_1917",
]
ALL_COLS = ["poem_number", "poet", "original_japanese", "original_romaji"] + TRANS_COLS


def clean_translation_cell(raw: str) -> str:
    """Strip leading line-number markers and normalize separators to \\n."""
    if not raw:
        return ""
    # The first replace targets U+2028 (LINE SEPARATOR) -- invisible in an
    # editor and easy to mistake for a plain space, but a genuinely distinct
    # character some source cells use instead of a real newline.
    text = raw.replace(" ", "\n").replace("\r\n", "\n")
    # split a run-on marker like "...mountain, 2And..." before the digit
    text = re.sub(r"\s+(?=\d+[A-Z(])", "\n", text)
    # split a marker glued directly after a newline, e.g. "\n2And..."
    text = re.sub(r"(?<!\n)(?=\s*\d+[A-Z])", "\n", text)
    lines = []
    for ln in text.splitlines():
        ln = re.sub(r"^\s*\d+\s*", "", ln).strip()
        if ln:
            lines.append(ln)
    return "\n".join(lines)


def ingest(raw_path: Path, out_path: Path) -> None:
    with open(raw_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if not rows:
        raise ValueError("raw CSV contains no data rows")
    missing_cols = set(ALL_COLS) - set(rows[0].keys())
    if missing_cols:
        raise ValueError(f"raw CSV is missing expected columns: {missing_cols}")

    cleaned = []
    for row in rows:
        out = {
            "poem_number": row["poem_number"].strip(),
            "poet": row["poet"].strip(),
            "original_japanese": row["original_japanese"].strip(),
            "original_romaji": row["original_romaji"].strip(),
        }
        for col in TRANS_COLS:
            out[col] = clean_translation_cell(row.get(col, ""))
        cleaned.append(out)

    cleaned.sort(key=lambda r: int(r["poem_number"]))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=ALL_COLS)
        writer.writeheader()
        writer.writerows(cleaned)

    print(f"Ingested {len(cleaned)} poems -> {out_path}")

    # quick sanity report
    empty_jp = sum(1 for r in cleaned if not r["original_japanese"])
    empty_trans = {c: sum(1 for r in cleaned if not r[c]) for c in TRANS_COLS}
    print(f"  missing original_japanese: {empty_jp}")
    for c, n in empty_trans.items():
        print(f"  missing {c}: {n}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clean the raw Hyakunin Isshu corpus CSV.")
    parser.add_argument("raw_csv", type=Path, help="path to the raw corpus CSV")
    parser.add_argument("--output", type=Path, default=OUT_PATH, help=f"output path (default: {OUT_PATH})")
    args = parser.parse_args()
    if not args.raw_csv.is_file():
        parser.error(f"raw CSV not found: {args.raw_csv}")
    try:
        ingest(args.raw_csv, args.output)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
