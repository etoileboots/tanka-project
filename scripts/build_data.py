#!/usr/bin/env python3
"""
build_data.py — generate the data JSON for the Hyakunin Isshu
comparative-translation visualization from the annotation corpus.

Inputs (all under the project root):
  data/poems_clean.csv                    — poet + 4 public-domain translations, 100 poems
  data/annotations/source/poem_NNN.json   — per-poem source analysis (bipartite, kigo, ...)
  data/annotations/translations/poem_NNN.json — per-translator analysis

Output:
  data/poems.json — fetched at runtime by the static site (see app.js).
  data/prompts.json — the system-prompt text shown on prompts.html.

Usage:
  python3 scripts/build_data.py
"""

import csv
import glob
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, "data", "poems_clean.csv")
SRC_DIR = os.path.join(ROOT, "data", "annotations", "source")
TR_DIR = os.path.join(ROOT, "data", "annotations", "translations")
CORR_DIR = os.path.join(ROOT, "data", "corrections")

# Translator full name (as used in corrections docs, matching review_app's
# TRANSLATORS list) <-> the short bar label used everywhere else in this file.
TRANS_FULLNAME = {"D": "Dickens", "N": "Noguchi", "M": "McCauley", "P": "Porter"}

# ── Palette ─────────────────────────────────────────────────────────────────
# Hierarchy is deliberate: kami/shimo/imagined are the STRUCTURAL signal and must
# read clearly even at grid scale (~15px cells), so they're deep and saturated.
# Device colors (kakekotoba/makurakotoba/kigo) are used as full-color
# highlight BACKGROUNDS with black text on top — so every one of them must
# stay light enough for black text to read cleanly (no white text anywhere
# in this app), while still being distinct enough from each other not to blur.
KAMI = "#2E9E6B"
SHIMO = "#E5503A"
IMAGINED = "#6F63C9"
KAKE = "#F28FC0"
MAKURA = "#7EBBEE"
KIGO = "#B4DE65"
# Flat neutral for poems with no annotation yet — never implies structure/devices.
UNANALYZED = "#D6D2C9"

# The runtime palette object mirrored into the HTML.
C_PALETTE = {
    "kami": KAMI, "shimo": SHIMO, "imagined": IMAGINED,
    "kakekotoba": KAKE, "makurakotoba": MAKURA, "kigo": KIGO,
    "unanalyzed": UNANALYZED,
}

# CSV column → translator bar label
TRANS_COLS = {
    "D": "dickens_text_1866",
    "N": "noguchi_text_1907",
    "M": "maccauley_text_1917",
    "P": "porter_text_1909",
}
# ── Load the corpus ──────────────────────────────────────────────────────────
def load_csv():
    out = {}
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            n = str(int(row["poem_number"]))
            entry = {"poet": row["poet"].strip()}
            for lbl, col in TRANS_COLS.items():
                lines = [ln.strip() for ln in (row.get(col) or "").split("\n")]
                entry[lbl] = [ln for ln in lines if ln]
            out[n] = entry
    return out


def analyzed_numbers():
    """Poem numbers that have BOTH a source and a translation annotation file."""
    def nums(d):
        s = set()
        for p in glob.glob(os.path.join(d, "poem_*.json")):
            m = re.search(r"poem_(\d+)\.json$", p)
            if m:
                s.add(str(int(m.group(1))))
        return s
    return sorted(nums(SRC_DIR) & nums(TR_DIR), key=int)


_STRINGIFIED_FIELDS = ("line_mapping", "bipartite", "kakekotoba_handling", "kakekotoba",
                       "makurakotoba_handling", "makurakotoba")


def _repair_stringified_field(raw):
    """The model occasionally returns a nested tool-input field (normally an
    object) as a JSON-encoded STRING instead, sometimes with an extra
    closing bracket before the next key (e.g. `]],"confidence"` where it
    should be `],"confidence"` — seen on poems 5 and 22 so far, and any
    future poem could hit it too). Try parsing as-is, then try the one
    known malformation, and give up (leave the raw string) if neither
    works — the caller's normal `.get()` calls will then simply see no
    matching keys rather than crashing."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    for bad, good in ((']],"confidence"', '],"confidence"'),):
        if bad in raw:
            try:
                return json.loads(raw.replace(bad, good, 1))
            except json.JSONDecodeError:
                continue
    return raw


def load_json(d, n):
    path = os.path.join(d, f"poem_{int(n):03d}.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for translator_block in data.values():
        if not isinstance(translator_block, dict):
            continue
        for field in _STRINGIFIED_FIELDS:
            val = translator_block.get(field)
            if isinstance(val, str):
                translator_block[field] = _repair_stringified_field(val)
    return data


# ── Human corrections (review_app) ──────────────────────────────────────────
# review_app/server.py writes data/corrections/poem_NNN.json as reviewers
# confirm/remove/correct/add individual devices, the kami/shimo boundary, or a
# translation line's ku classification (see VALID_KINDS/VALID_ACTIONS there).
# This is the other half of that loop: apply those corrections here so the
# rendered site actually reflects human review, not just the raw LLM output
# the corrections were logged against.
def load_corrections(n):
    path = os.path.join(CORR_DIR, f"poem_{int(n):03d}.json")
    if not os.path.exists(path):
        return {"source": {"kami_shimo_boundary": None, "devices": {}}, "translations": {}}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def apply_boundary_correction(src, boundary_corr):
    """A corrected kami_shimo_boundary is a CHARACTER offset into the
    unbroken source_jp text (see annotate.js computeKamiEnd/renderJPChars —
    the modal's own sidebar bracket uses the same character-granular value).
    build_real_data's O-bar segments are per-KU, not per-character, so convert
    the offset to a ku boundary: if source_jp is newline-split into exactly as
    many lines as there are ku, use each ku's real character length to find
    the exact ku the offset falls in; otherwise fall back to splitting the ku
    count proportionally by character count, the same estimate the client
    uses when it has no explicit per-ku split."""
    if not boundary_corr or boundary_corr.get("status") != "corrected":
        return
    corrected = boundary_corr.get("corrected") or {}
    kami_end = corrected.get("kamiEnd")
    if not isinstance(kami_end, int):
        return

    bp = src.get("bipartite", {}) or {}
    kami_ku, shimo_ku = set(bp.get("kami_ku", [])), set(bp.get("shimo_ku", []))
    all_ku = kami_ku | shimo_ku
    n_ku = max(all_ku) if all_ku else 5

    raw_jp = src.get("source_jp", "") or ""
    verses = raw_jp.split("\n") if "\n" in raw_jp else None

    if verses and len(verses) == n_ku:
        cum = 0
        k = n_ku
        for i, v in enumerate(verses, start=1):
            cum += len(v)
            if kami_end <= cum:
                k = i
                break
    else:
        total = len(raw_jp.replace("\n", "")) or 1
        k = max(1, min(n_ku - 1, round(kami_end / total * n_ku)))

    src["bipartite"] = dict(bp, kami_ku=list(range(1, k + 1)), shimo_ku=list(range(k + 1, n_ku + 1)))


def apply_device_corrections(devices, device_corr):
    """Apply confirmed/removed/added device corrections onto an already-built
    word/phrase -> color dict (SRC_DEVICES[n] or HIGHLIGHTS[n][lbl]). Keys are
    matched case-insensitively to match build_highlights()'s lowercased keys."""
    for word, entry in (device_corr or {}).items():
        status = entry.get("status")
        if status == "removed":
            devices.pop(word, None)
            devices.pop(word.lower(), None)
        elif status in ("added", "corrected"):
            corrected = entry.get("corrected") or {}
            color = corrected.get("color")
            if color:
                devices[word.lower()] = color
        # "confirmed" needs no change — the word is already present as-is.


def apply_device_correction_labels(labels, device_corr):
    """Added-device corrections may carry a reviewer-written note (see
    review_app's add-device form) — use it as that word's hover label, the
    same note surfaced in the review sidebar's 'why' tooltip, so a
    human-added device gets a real label too, not just a color."""
    for word, entry in (device_corr or {}).items():
        if entry.get("status") in ("added", "corrected"):
            note = (entry.get("corrected") or {}).get("note")
            if note:
                labels[word] = note


def apply_device_link_corrections(device_keys, link_corr):
    """Apply manual "connects to" corrections (review_app's linkRowHTML /
    tdev-link-save) onto an already-built word -> source-JP-word dict
    (HIGHLIGHT_DEVICE_KEYS[n][lbl]) — this is what drives the site's
    cross-highlight glow between a translation word and its source
    character(s). Without this, a reviewer's manually-drawn connection
    lived only in data/corrections/poem_NNN.json and never reached
    poems.json, so the glow silently kept using (or lacking) the
    pipeline's own original guess no matter what was corrected."""
    for word, entry in (link_corr or {}).items():
        status = entry.get("status")
        key = word.lower()
        if status == "removed":
            device_keys.pop(word, None)
            device_keys.pop(key, None)
        elif status == "corrected":
            source_word = (entry.get("corrected") or {}).get("source_word")
            if source_word:
                device_keys[key] = source_word


def apply_line_corrections(bars, translations_corr):
    """Apply corrected translation-line ku classifications onto REAL_DATA's
    per-translator bar segments, keyed by 0-based line index (matching the
    order build_real_data() builds segs in, one per line_mapping entry)."""
    for lbl, translator in TRANS_FULLNAME.items():
        lines_corr = ((translations_corr or {}).get(translator) or {}).get("lines") or {}
        if not lines_corr:
            continue
        bar = next((b for b in bars if b["lbl"] == lbl), None)
        if not bar:
            continue
        for idx_str, entry in lines_corr.items():
            if entry.get("status") != "corrected":
                continue
            corrected_type = (entry.get("corrected") or {}).get("type")
            try:
                idx = int(idx_str)
            except ValueError:
                continue
            if corrected_type and 0 <= idx < len(bar["segs"]):
                bar["segs"][idx]["type"] = corrected_type


# ── Per-poem derivations ─────────────────────────────────────────────────────
def source_ku_sets(src):
    bp = src.get("bipartite", {})
    return set(bp.get("kami_ku", [])), set(bp.get("shimo_ku", []))


def build_src_devices(src):
    """Return a Japanese device-word to color map."""
    devs = {}
    kigo = src.get("kigo", {}) or {}
    kw = (kigo.get("word") or "").strip()
    season = (kigo.get("season") or "").strip().lower()
    # The season field determines whether a kigo is present.
    if kw and season and season != "none":
        devs[kw] = KIGO
    for k in src.get("kakekotoba", []) or []:
        if k.get("word"):
            devs[k["word"]] = KAKE
    for k in src.get("makurakotoba", []) or []:
        if k.get("word"):
            devs[k["word"]] = MAKURA
    return devs


def _short_gloss(text, maxlen=40):
    """reading_primary/reading_secondary are full explanatory sentences
    ('仮庵 (kariho) — a temporary hut, here built to...'), not short glosses —
    too long for a hover tooltip. Keep just the part before the first
    em-dash (the actual gloss), falling back to a hard truncation if there
    isn't one."""
    if not text:
        return ""
    text = text.strip()
    head = text.split(" — ")[0].strip()
    if len(head) <= maxlen:
        return head
    return head[:maxlen].rstrip() + "…"


def build_src_device_labels(src):
    """JP word → short human-readable label for the hover tooltip on that
    device's highlight (e.g. 'Kigo — Autumn', 'Kakekotoba — 仮庵 / 刈り穂').
    Separate from build_src_devices()'s color map so existing color-only
    consumers (SRC_DEVICES) don't need to change shape — this is purely
    additive UI sugar, safe to omit if a word's label can't be built."""
    labels = {}
    kigo = src.get("kigo", {}) or {}
    kw = (kigo.get("word") or "").strip()
    season = (kigo.get("season") or "").strip()
    if kw and kw.lower() != "none":
        labels[kw] = f"Kigo — {season.replace('_', ' ').title()}" if season and season != "none" else "Kigo"
    for k in src.get("kakekotoba", []) or []:
        w = k.get("word")
        if not w:
            continue
        primary, secondary = _short_gloss(k.get("reading_primary")), _short_gloss(k.get("reading_secondary"))
        if primary and secondary:
            labels[w] = f"Kakekotoba — {primary} / {secondary}"
        else:
            labels[w] = "Kakekotoba — pivot word"
    for m in src.get("makurakotoba", []) or []:
        w = m.get("word")
        if not w:
            continue
        precedes = m.get("precedes")
        labels[w] = f"Makurakotoba — precedes {precedes}" if precedes else "Makurakotoba — pillow word"
    return labels


def point_devices(src):
    """Devices that sit at a single ku: (ku, color). Used for translation-bar dev bands."""
    pts = []
    kigo = src.get("kigo", {}) or {}
    if ((kigo.get("word") or "").strip().lower() not in ("", "none")
            and (kigo.get("season") or "").strip().lower() != "none"
            and kigo.get("ku")):
        pts.append((kigo["ku"], KIGO))
    for k in src.get("kakekotoba", []) or []:
        if k.get("ku"):
            pts.append((k["ku"], KAKE))
    for k in src.get("makurakotoba", []) or []:
        if k.get("ku"):
            pts.append((k["ku"], MAKURA))
    return pts


def line_entries(tr_block):
    lm = tr_block.get("line_mapping", {}) or {}
    entries = lm.get("entries", []) or []
    return sorted(entries, key=lambda e: e.get("en_line", 0))


def line_ku_type(en_line, jp_ku, tr_block, kami_ku, shimo_ku, origin=None):
    """Classify one translation line as kami / shimo / imagined.
    A line the translator flagged as invented (origin="extrapolated") is
    always "imagined" regardless of which ku it was loosely anchored to —
    that anchoring is approximate for invented content and would otherwise
    mask every embellished line as ordinary kami/shimo. Otherwise prefer the
    translator's own bipartite line lists; fall back to the source ku sets
    via the line's jp_ku mapping. Kami wins on overlap."""
    if origin == "extrapolated":
        return "imagined"
    bp = tr_block.get("bipartite")
    if isinstance(bp, dict) and (bp.get("kami_lines") or bp.get("shimo_lines")):
        if en_line in (bp.get("kami_lines") or []):
            return "kami"
        if en_line in (bp.get("shimo_lines") or []):
            return "shimo"
        return "imagined"
    ku = set(jp_ku or [])
    if ku & kami_ku:
        return "kami"
    if ku & shimo_ku:
        return "shimo"
    return "imagined"


def build_real_data(n, src, tr, csv_entry, highlights=None):
    kami_ku, shimo_ku = source_ku_sets(src)
    pts = point_devices(src)
    bars = []

    # O bar — the original, one segment per source ku.
    # Derive ku count from the bipartite ku numbers (robust even when source_jp
    # is a single unbroken string, as in poem 1).
    all_ku = kami_ku | shimo_ku
    if all_ku:
        n_ku = max(all_ku)
    else:
        n_ku = len([v for v in src.get("source_jp", "").split("\n") if v.strip()])
    o_segs = []
    for ku in range(1, n_ku + 1):
        seg = {"type": "kami" if ku in kami_ku else "shimo"}
        dev = next((c for (k, c) in pts if k == ku), None)
        if dev:
            seg["dev"] = dev
        o_segs.append(seg)
    bars.append({"lbl": "O", "segs": o_segs, "nLines": n_ku})

    # Translation bars, in display order D, N, M, P (matches TRANS_LBLS in HTML)
    highlights = highlights or {}
    for lbl in ("D", "N", "M", "P"):
        block = tr.get(TRANS_FULLNAME[lbl], {}) or {}
        entries = line_entries(block)
        lines_text = csv_entry.get(lbl, [])
        if not entries:
            # Fall back to the actual translation line count with no ku data
            nlines = len(lines_text)
            # Annotation is absent, so do not present a fabricated structure.
            segs = [{"type": "unanalyzed"} for _ in range(nlines)]
            bars.append({"lbl": lbl, "segs": segs, "nLines": nlines or 1})
            continue
        wm = highlights.get(lbl, {})
        segs = []
        for e in entries:
            jp_ku = e.get("jp_ku", [])
            t = line_ku_type(e.get("en_line"), jp_ku, block, kami_ku, shimo_ku, e.get("origin"))
            seg = {"type": t}
            # A device band on a translation line means the line's own text
            # actually contains a preserved device word — verified against
            # the same substring-checked highlight map build_highlights()
            # produces, not just "this line's ku matches where the device
            # sits in the source" (a translator can drop or substitute the
            # word entirely, e.g. rendering 露 "dew" as "rain").
            en_line = e.get("en_line") or 0
            line_text = (lines_text[en_line - 1].lower()
                         if 1 <= en_line <= len(lines_text) else "")
            # A line can preserve more than one device. Collect all matches and place
            # each band at that word's own character span within the line
            # (not an even split by device count), same as jpDeviceFracs
            # does for the source bar.
            seen = set()
            devs = []
            n_chars = len(line_text) or 1
            for phrase, color in sorted(wm.items(), key=lambda kv: line_text.find(kv[0])):
                pos = line_text.find(phrase)
                if pos < 0 or color in seen:
                    continue
                seen.add(color)
                devs.append({
                    "color": color,
                    "start": pos / n_chars,
                    "end": (pos + len(phrase)) / n_chars,
                })
            if devs:
                seg["devs"] = devs
            segs.append(seg)
        bars.append({"lbl": lbl, "segs": segs, "nLines": len(segs)})

    return {"n": int(n), "real": True, "bars": bars}


_CJK = re.compile(r"[　-ヿ㐀-䶿一-鿿＀-￯]")

def clean_phrases(raw):
    """Turn an annotation 'surviving word' into zero or more highlightable phrases.
    Drops Japanese glosses and parentheticals; splits on '...' and '/'."""
    if not raw:
        return []
    s = re.sub(r"\([^)]*\)", " ", raw)          # drop parentheticals
    parts = re.split(r"\.\.\.|…|/", s)      # split on ellipsis or slash
    out = []
    for p in parts:
        p = p.strip(" .,;:—-—")
        if p and not _CJK.search(p):
            out.append(p)
    return out


def clean_device_key(raw, jp_text):
    """A device_key (below) is meant to be the literal SOURCE JP word/phrase
    that an English highlight preserves — build_data.py:jp.includes(word)
    is what the frontend uses to find and glow those characters, so it has
    to be an exact substring of the source text. The AI's own
    original_word field for kakekotoba/makurakotoba/kigo is frequently NOT
    that — it's a gloss like 'よる (ku2, 寄る)' or 'ながし (長し/流し)',
    annotated with parentheticals, ku-position notes, or slash-separated
    reading alternatives, none of which literally appear in the text as
    written. The EN phrase side already gets validated against the real
    translation text (see add() below); this is the same idea for the JP
    side — try the raw string, then a cleaned-up version (strip a trailing
    parenthetical, try each slash-separated alternative inside it), and
    give up (return None, i.e. no link) rather than ever pointing the glow
    at something that isn't actually in the poem."""
    if not raw:
        return None
    raw = raw.strip()
    if raw in jp_text:
        return raw
    # "よる (ku2, 寄る)" -> "よる", then also try "寄る" from inside the parens
    base = re.split(r"[\(（]", raw)[0].strip()
    if base and base in jp_text:
        return base
    paren = re.search(r"[\(（]([^\)）]*)[\)）]", raw)
    if paren:
        for alt in re.split(r"[/／、,]", paren.group(1)):
            alt = alt.strip()
            # Drop a leading "ku2," / "ku 3" style position note before
            # checking — those aren't part of the word itself.
            alt = re.sub(r"^ku\s*\d+\s*,?\s*", "", alt, flags=re.IGNORECASE).strip()
            if alt and alt in jp_text:
                return alt
    return None


def build_highlights(src, tr, csv_entry):
    """Per-translator English phrase → device color, from the translation analysis.
    Only phrases that actually appear in that translator's text are kept, so every
    highlight is guaranteed to render. Returns (highlights, labels, device_keys):
      - highlights: phrase -> color (unchanged, existing shape)
      - labels: phrase -> hover-tooltip string (e.g. 'Kigo — Autumn'), built from
        the same source data as build_src_device_labels() so JP and EN describe a
        device identically
      - device_keys: phrase -> the SOURCE JP word this phrase preserves (e.g.
        'かりほ'). Since SRC_DEVICE_LABELS is keyed by that same JP word, this is
        what lets the frontend glow every highlight tied to one device — the JP
        word's characters AND every translator's rendering of it — together,
        not just the single element under the cursor."""
    jp_text = (src.get("source_jp") or "").replace("\n", "")
    kigo = src.get("kigo", {}) or {}
    kigo_word = (kigo.get("word") or "").strip()
    kigo_season = (kigo.get("season") or "").strip()
    kigo_label = f"Kigo — {kigo_season.replace('_', ' ').title()}" if kigo_season and kigo_season != "none" else "Kigo"

    out, out_labels, out_keys = {}, {}, {}
    for lbl in ("D", "N", "M", "P"):
        block = tr.get(TRANS_FULLNAME[lbl], {}) or {}
        text = " ".join(csv_entry.get(lbl, [])).lower()
        wm, lm, dk = {}, {}, {}

        def add(raw, color, label=None, device_key=None):
            for phrase in clean_phrases(raw):
                key = phrase.lower()
                if key and key in text:          # verify it's really in the text
                    wm.setdefault(key, color)
                    if label:
                        lm.setdefault(key, label)
                    if device_key:
                        # Same idea as the EN-side check above, for the JP
                        # side — see clean_device_key's docstring for why
                        # this can't just trust original_word as-is.
                        cleaned_key = clean_device_key(device_key, jp_text)
                        if cleaned_key:
                            dk.setdefault(key, cleaned_key)

        for k in (block.get("kakekotoba_handling") or block.get("kakekotoba") or []):
            if (k.get("method") or "").lower() != "omitted":
                ow = k.get("original_word")
                add(k.get("en_equivalent"), KAKE, f"Kakekotoba — {ow}" if ow else "Kakekotoba", ow)
        for k in (block.get("makurakotoba_handling") or block.get("makurakotoba") or []):
            if (k.get("method") or "").lower() != "omitted":
                ow = k.get("original_word")
                add(k.get("en_equivalent"), MAKURA, f"Makurakotoba — {ow}" if ow else "Makurakotoba", ow)
        # Only highlight when the seasonal signal genuinely survives as the
        # SAME image (explicit/implicit_imagery/relocated) — "transformed"
        # means a different season/image was substituted, which shouldn't
        # be shown as if it matched the source's actual kigo.
        kh = block.get("kigo_handling")
        if kh and (kh.get("preserved") or "").lower() in ("explicit", "implicit_imagery", "relocated"):
            add(kh.get("en_equivalent"), KIGO, kigo_label, kigo_word or None)
        if wm:
            out[lbl] = wm
        if lm:
            out_labels[lbl] = lm
        if dk:
            out_keys[lbl] = dk
    return out, out_labels, out_keys


def compute_data():
    """Single source of truth for site/data/poems.json, which the portable
    static site fetches at runtime."""
    csv_data = load_csv()
    nums = analyzed_numbers()

    CSV = csv_data  # all 100 poems
    SRC_JP, SRC_DEVICES, HIGHLIGHTS, REAL_DATA = {}, {}, {}, {}
    SRC_FURIGANA = {}
    SRC_DEVICE_LABELS, HIGHLIGHT_LABELS, HIGHLIGHT_DEVICE_KEYS = {}, {}, {}

    for n in nums:
        src = load_json(SRC_DIR, n)
        tr = load_json(TR_DIR, n)
        corr = load_corrections(n)

        # Apply the kami/shimo boundary correction before anything derives
        # ku sets from src — it changes which ku numbers count as kami/shimo.
        apply_boundary_correction(src, corr.get("source", {}).get("kami_shimo_boundary"))

        src_devices_corr = corr.get("source", {}).get("devices")
        SRC_JP[n] = src.get("source_jp", "")
        SRC_DEVICES[n] = build_src_devices(src)
        apply_device_corrections(SRC_DEVICES[n], src_devices_corr)
        # Hover-tooltip labels (e.g. "Kigo — Autumn") — a separate map keyed
        # the same way as SRC_DEVICES, so existing color-only consumers are
        # unaffected and a missing label just means no tooltip, not an error.
        labels = build_src_device_labels(src)
        apply_device_correction_labels(labels, src_devices_corr)
        if labels:
            SRC_DEVICE_LABELS[n] = labels
        # Kanji-run -> hiragana reading pairs (furigana), in poem order —
        # only present for poems annotated after this field was added.
        if src.get("furigana"):
            SRC_FURIGANA[n] = src["furigana"]
        hl, hl_labels, hl_keys = build_highlights(src, tr, csv_data.get(n, {}))
        for lbl, translator in TRANS_FULLNAME.items():
            t_corr = corr.get("translations", {}).get(translator, {})
            t_devices_corr = t_corr.get("devices")
            apply_device_corrections(hl.setdefault(lbl, {}), t_devices_corr)
            apply_device_correction_labels(hl_labels.setdefault(lbl, {}), t_devices_corr)
            apply_device_link_corrections(hl_keys.setdefault(lbl, {}), t_corr.get("device_links"))
            if not hl.get(lbl):
                hl.pop(lbl, None)
            if not hl_labels.get(lbl):
                hl_labels.pop(lbl, None)
            if not hl_keys.get(lbl):
                hl_keys.pop(lbl, None)
        if hl:
            HIGHLIGHTS[n] = hl
        if hl_labels:
            HIGHLIGHT_LABELS[n] = hl_labels
        if hl_keys:
            HIGHLIGHT_DEVICE_KEYS[n] = hl_keys
        real_data = build_real_data(n, src, tr, csv_data.get(n, {}), hl)
        apply_line_corrections(real_data["bars"], corr.get("translations", {}))
        REAL_DATA[int(n)] = real_data

    return {
        "csv_data": csv_data, "nums": nums,
        "C": C_PALETTE, "CSV": CSV, "SRC_JP": SRC_JP, "SRC_DEVICES": SRC_DEVICES,
        "HIGHLIGHTS": HIGHLIGHTS,
        "REAL_DATA": REAL_DATA, "SRC_FURIGANA": SRC_FURIGANA,
        "SRC_DEVICE_LABELS": SRC_DEVICE_LABELS, "HIGHLIGHT_LABELS": HIGHLIGHT_LABELS,
        "HIGHLIGHT_DEVICE_KEYS": HIGHLIGHT_DEVICE_KEYS,
    }


DATA_KEYS = ("C", "CSV", "SRC_JP", "SRC_DEVICES", "HIGHLIGHTS",
             "REAL_DATA", "SRC_FURIGANA", "SRC_DEVICE_LABELS", "HIGHLIGHT_LABELS",
             "HIGHLIGHT_DEVICE_KEYS")


def write_site_data(data, site_dir):
    out_path = os.path.join(site_dir, "data", "poems.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    payload = {k: data[k] for k in DATA_KEYS}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {out_path}")


def write_prompts(site_dir):
    """Export the annotation prompts displayed by the static site."""
    import annotate_translations as at
    out_path = os.path.join(site_dir, "data", "prompts.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    payload = {"SYSTEM_PASS1": at.SYSTEM_PASS1, "SYSTEM_PASS2": at.SYSTEM_PASS2}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Wrote {out_path}")


def main():
    site_dir = ROOT

    data = compute_data()
    write_site_data(data, site_dir)
    write_prompts(site_dir)

    print(f"Analyzed poems: {', '.join(data['nums'])}")
    print(f"CSV poems: {len(data['CSV'])}")


if __name__ == "__main__":
    main()
