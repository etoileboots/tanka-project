#!/usr/bin/env python3
"""
review_app/server.py — local human-review UI for the Hyakunin Isshu
AI classification pipeline.

Two views:
  /          — coarse approve/flag per poem x {source, each translator},
               with notes. Writes data/reviews/poem_NNN.json.
  /annotate  — the real visualization (same render as build_data.py
               produces), with per-device confirm/remove/correct/add
               controls, a kami/shimo boundary editor, and per-line ku
               reclassification. Writes data/corrections/poem_NNN.json
               and appends every action to data/corrections/_accuracy_log.jsonl.

Run:
  source venv/bin/activate
  python3 review_app/server.py
  → open http://127.0.0.1:5051
"""

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, render_template

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "poems_clean.csv"
SRC_DIR = ROOT / "data" / "annotations" / "source"
TRANS_DIR = ROOT / "data" / "annotations" / "translations"
REVIEWS_DIR = ROOT / "data" / "reviews"
REVIEWS_DIR.mkdir(parents=True, exist_ok=True)
CORRECTIONS_DIR = ROOT / "data" / "corrections"
CORRECTIONS_DIR.mkdir(parents=True, exist_ok=True)
ACCURACY_LOG = CORRECTIONS_DIR / "_accuracy_log.jsonl"
NOTES_DIR = ROOT / "data" / "notes"
NOTES_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(ROOT))

TRANSLATORS = ["Dickens", "Noguchi", "Porter", "McCauley"]
KU_TYPES = {"kami", "shimo", "imagined"}

app = Flask(__name__)


def load_csv_rows() -> dict[int, dict]:
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return {int(r["poem_number"]): r for r in csv.DictReader(f)}


def annotated_poem_numbers() -> list[int]:
    """Poems with both a source and translation annotation file."""
    src_nums = {int(p.stem.split("_")[1]) for p in SRC_DIR.glob("poem_*.json")}
    tr_nums = {int(p.stem.split("_")[1]) for p in TRANS_DIR.glob("poem_*.json")}
    return sorted(src_nums & tr_nums)


def is_annotated_poem(n: int) -> bool:
    """Only existing, fully annotated poems may receive review data."""
    return n in set(annotated_poem_numbers())


def json_body() -> dict | None:
    """Return a JSON object, never coercing an invalid request into a 500."""
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else None


def review_path(n: int) -> Path:
    return REVIEWS_DIR / f"poem_{n:03d}.json"


def load_review(n: int) -> dict:
    path = review_path(n)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {
        "poem_number": n,
        "source": {"status": "pending", "notes": "", "reviewed_at": None},
        "translations": {
            t: {"status": "pending", "notes": "", "reviewed_at": None}
            for t in TRANSLATORS
        },
    }


def save_review(n: int, review: dict) -> None:
    review_path(n).write_text(
        json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8"
    )


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/poems")
def api_poems():
    rows = load_csv_rows()
    out = []
    for n in annotated_poem_numbers():
        review = load_review(n)
        statuses = [review["source"]["status"]] + [
            review["translations"][t]["status"] for t in TRANSLATORS
        ]
        if all(s == "approved" for s in statuses):
            overall = "approved"
        elif any(s == "flagged" for s in statuses):
            overall = "flagged"
        else:
            overall = "pending"
        out.append(
            {
                "poem_number": n,
                "poet": rows.get(n, {}).get("poet", "?"),
                "overall": overall,
            }
        )
    return jsonify(out)


@app.route("/api/poem/<int:n>")
def api_poem(n: int):
    rows = load_csv_rows()
    row = rows.get(n)
    if row is None:
        return jsonify({"error": "poem not found in CSV"}), 404

    src_path = SRC_DIR / f"poem_{n:03d}.json"
    tr_path = TRANS_DIR / f"poem_{n:03d}.json"
    if not src_path.exists() or not tr_path.exists():
        return jsonify({"error": "poem not yet annotated"}), 404

    source = json.loads(src_path.read_text(encoding="utf-8"))
    translations = json.loads(tr_path.read_text(encoding="utf-8"))
    review = load_review(n)

    trans_lines = {
        "Dickens": row.get("dickens_text_1866", ""),
        "Noguchi": row.get("noguchi_text_1907", ""),
        "Porter": row.get("porter_text_1909", ""),
        "McCauley": row.get("maccauley_text_1917", ""),
    }

    return jsonify(
        {
            "poem_number": n,
            "poet": row.get("poet", ""),
            "source_jp": row.get("original_japanese", ""),
            "romaji": row.get("original_romaji", ""),
            "source_analysis": source,
            "translations": translations,
            "translation_text": trans_lines,
            "review": review,
        }
    )


@app.route("/api/review/<int:n>", methods=["POST"])
def api_update_review(n: int):
    if not is_annotated_poem(n):
        return jsonify({"error": "poem not found or not yet annotated"}), 404
    body = json_body()
    if body is None:
        return jsonify({"error": "request body must be a JSON object"}), 400
    target = body.get("target")       # "source" or a translator name
    status = body.get("status")       # "approved" | "flagged" | "pending"
    notes = body.get("notes", "")

    if status not in ("approved", "flagged", "pending"):
        return jsonify({"error": "invalid status"}), 400
    if not isinstance(notes, str):
        return jsonify({"error": "notes must be a string"}), 400

    review = load_review(n)
    entry = {
        "status": status,
        "notes": notes,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    if target == "source":
        review["source"] = entry
    elif target in TRANSLATORS:
        review["translations"][target] = entry
    else:
        return jsonify({"error": f"unknown target {target!r}"}), 400

    save_review(n, review)
    return jsonify({"ok": True, "review": review})


# ── Fine-grained corrections: confirm / remove / move a single detected
# device, correct the kami/shimo boundary, or reclassify a translation
# line's kami/shimo/imagined type. Separate from the coarser Approve/Flag
# review above — this tracks individual-item accuracy, not whole-poem status.

# "device_link" points one translator's device word back to the source JP
# word it renders (item_id = the translator word, corrected = {source_word}
# when linked) — overrides the pipeline's own HIGHLIGHT_DEVICE_KEYS guess
# when it's missing or wrong, so the cross-highlight glow connects the
# right two words instead of nothing (or the wrong pair).
VALID_KINDS = {"device", "kami_shimo_boundary", "line_ku_type", "device_link"}
# "added" is a device a human reviewer noticed but the AI missed entirely —
# distinct from "corrected" (AI found it, human adjusted its span/color).
VALID_ACTIONS = {"confirmed", "removed", "corrected", "added"}


def corrections_path(n: int) -> Path:
    return CORRECTIONS_DIR / f"poem_{n:03d}.json"


def load_corrections(n: int) -> dict:
    path = corrections_path(n)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"poem_number": n, "source": {"kami_shimo_boundary": None, "devices": {}}, "translations": {}}


def save_corrections(n: int, doc: dict) -> None:
    corrections_path(n).write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def log_accuracy_event(poem: int, scope: str, kind: str, item_id: str, action: str) -> None:
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "poem": poem, "scope": scope, "kind": kind, "item_id": item_id, "action": action,
    }
    with open(ACCURACY_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


@app.route("/annotate")
def annotate_page():
    return render_template("annotate.html")


@app.route("/api/data")
def api_data():
    """The same computed dataset build_data.py writes to site/data/poems.json
    (C, CSV, SRC_JP, SRC_DEVICES, HIGHLIGHTS, REAL_DATA) —
    so the annotate view renders the current annotation files."""
    from build_data import compute_data
    data = compute_data()
    payload = {k: data[k] for k in
               ("C", "CSV", "SRC_JP", "SRC_DEVICES", "HIGHLIGHTS", "REAL_DATA",
                # Needed to connect a device's source JP word to its rendering
                # in each translator's text (data-device pairing) and to give
                # both sides the same hover-tooltip definition (data-tip) —
                # see the glow/tooltip wiring in annotate.js.
                "SRC_DEVICE_LABELS", "HIGHLIGHT_LABELS", "HIGHLIGHT_DEVICE_KEYS")}
    return jsonify(payload)


@app.route("/api/corrections/<int:n>")
def api_get_corrections(n: int):
    return jsonify(load_corrections(n))


@app.route("/api/reasoning/<int:n>")
def api_reasoning(n: int):
    """Raw annotation JSON, not the flattened word→color maps compute_data()
    produces — this is the only place the LLM's actual rationale lives
    (bipartite.pivot_note, kakekotoba[].interaction,
    each translator's line_mapping[].content_summary, etc.), so the reviewer
    can see WHY something was classified a given way, not just what."""
    src_path = SRC_DIR / f"poem_{n:03d}.json"
    tr_path = TRANS_DIR / f"poem_{n:03d}.json"
    source = json.loads(src_path.read_text(encoding="utf-8")) if src_path.exists() else {}
    translations = json.loads(tr_path.read_text(encoding="utf-8")) if tr_path.exists() else {}
    return jsonify({"source": source, "translations": translations})


@app.route("/api/corrections/<int:n>", methods=["POST"])
def api_post_correction(n: int):
    if not is_annotated_poem(n):
        return jsonify({"error": "poem not found or not yet annotated"}), 404
    body = json_body()
    if body is None:
        return jsonify({"error": "request body must be a JSON object"}), 400
    scope = body.get("scope")        # "source" or a translator name
    kind = body.get("kind")          # "device" | "kami_shimo_boundary" | "line_ku_type"
    item_id = body.get("item_id")    # stable id: device word, or line index as string
    action = body.get("action")      # "confirmed" | "removed" | "corrected" | "added"
    original = body.get("original")
    corrected = body.get("corrected")

    if kind not in VALID_KINDS or action not in VALID_ACTIONS:
        return jsonify({"error": "invalid kind or action"}), 400
    if scope != "source" and scope not in TRANSLATORS:
        return jsonify({"error": "invalid scope"}), 400
    if not isinstance(item_id, str) or not item_id.strip():
        return jsonify({"error": "scope and item_id are required"}), 400

    if kind == "kami_shimo_boundary":
        if scope != "source":
            return jsonify({"error": "boundary corrections apply only to source"}), 400
        if action == "corrected":
            kami_end = (corrected or {}).get("kamiEnd") if isinstance(corrected, dict) else None
            source_path = SRC_DIR / f"poem_{n:03d}.json"
            source_jp = json.loads(source_path.read_text(encoding="utf-8")).get("source_jp", "")
            if not isinstance(kami_end, int) or not 1 <= kami_end < len(source_jp.replace("\n", "")):
                return jsonify({"error": "kamiEnd must be within the source poem"}), 400
    elif kind == "line_ku_type":
        if scope == "source" or action not in {"confirmed", "corrected"}:
            return jsonify({"error": "invalid line classification correction"}), 400
        if action == "corrected" and (not isinstance(corrected, dict) or corrected.get("type") not in KU_TYPES):
            return jsonify({"error": "corrected line type must be kami, shimo, or imagined"}), 400
    elif kind == "device_link" and (scope == "source" or action not in {"corrected", "removed"}):
        return jsonify({"error": "invalid device-link correction"}), 400
    elif kind == "device" and scope == "source" and action == "added":
        source_path = SRC_DIR / f"poem_{n:03d}.json"
        source_jp = json.loads(source_path.read_text(encoding="utf-8")).get("source_jp", "")
        if item_id not in source_jp.replace("\n", ""):
            return jsonify({"error": "source device must appear in the source poem"}), 400

    doc = load_corrections(n)
    entry = {
        "status": action,
        "original": original,
        "corrected": corrected if action in ("corrected", "added") else None,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }

    if kind == "kami_shimo_boundary" and scope == "source":
        doc["source"]["kami_shimo_boundary"] = entry
    elif kind == "device" and scope == "source":
        doc["source"].setdefault("devices", {})[item_id] = entry
    elif kind == "device":
        doc.setdefault("translations", {}).setdefault(scope, {}).setdefault("devices", {})[item_id] = entry
    elif kind == "line_ku_type":
        doc.setdefault("translations", {}).setdefault(scope, {}).setdefault("lines", {})[item_id] = entry
    elif kind == "device_link":
        doc.setdefault("translations", {}).setdefault(scope, {}).setdefault("device_links", {})[item_id] = entry
    else:
        return jsonify({"error": "invalid kind/scope combination"}), 400

    save_corrections(n, doc)
    log_accuracy_event(n, scope, kind, item_id, action)
    return jsonify({"ok": True, "corrections": doc})


@app.route("/api/accuracy")
def api_accuracy():
    """Aggregate stats across every logged correction event — the general
    accuracy measure: what fraction of AI-detected items did a human
    reviewer confirm as-is vs. need to remove or correct."""
    if not ACCURACY_LOG.exists():
        return jsonify({"total": 0, "by_action": {}, "by_kind": {}, "confirmed_rate_pct": None})
    by_action, by_kind = {}, {}
    total = 0
    with open(ACCURACY_LOG, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(ev, dict) or "action" not in ev or "kind" not in ev:
                continue
            total += 1
            by_action[ev["action"]] = by_action.get(ev["action"], 0) + 1
            by_kind[ev["kind"]] = by_kind.get(ev["kind"], 0) + 1
    confirmed_rate = round(100 * by_action.get("confirmed", 0) / total, 1) if total else None
    return jsonify({
        "total": total, "by_action": by_action, "by_kind": by_kind,
        "confirmed_rate_pct": confirmed_rate,
    })


# ── Annotator notes: free-form commentary attached to a specific ku (poem
# section) or to the poem as a whole. Separate from the structured
# corrections above — this is open-ended prose, not a confirm/remove/correct
# verdict on a specific AI-detected item.

def notes_path(n: int) -> Path:
    return NOTES_DIR / f"poem_{n:03d}.json"


def load_notes(n: int) -> dict:
    path = notes_path(n)
    if path.exists():
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc.setdefault("words", {})
        return doc
    return {"poem_number": n, "general": "", "ku": {}, "words": {}}


def save_notes(n: int, doc: dict) -> None:
    notes_path(n).write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )


@app.route("/api/notes/<int:n>")
def api_get_notes(n: int):
    return jsonify(load_notes(n))


@app.route("/api/notes/<int:n>", methods=["POST"])
def api_post_notes(n: int):
    if not is_annotated_poem(n):
        return jsonify({"error": "poem not found or not yet annotated"}), 404
    body = json_body()
    if body is None:
        return jsonify({"error": "request body must be a JSON object"}), 400
    scope = body.get("scope")   # "general" | "1".."5" (ku number) | "word"
    text = body.get("text", "")
    word = (body.get("word") or "").strip()

    if not isinstance(text, str):
        return jsonify({"error": "text must be a string"}), 400

    if scope == "word":
        if not word:
            return jsonify({"error": "word is required for scope=word"}), 400
    elif scope != "general" and scope not in ("1", "2", "3", "4", "5"):
        return jsonify({"error": "invalid scope"}), 400

    doc = load_notes(n)
    if scope == "general":
        doc["general"] = text
    elif scope == "word":
        words = doc.setdefault("words", {})
        if text:
            words[word] = text
        else:
            words.pop(word, None)   # empty text deletes the note
    else:
        doc.setdefault("ku", {})[scope] = text
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_notes(n, doc)
    return jsonify({"ok": True, "notes": doc})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5051, debug=False)
