"""
annotate_translations.py
Two-pass LLM annotation for tanka classical device analysis.

Pass 1 — Source analysis (once per poem):
    Identifies makurakotoba, kakekotoba, jokotoba,
    bipartite kami/shimo structure, and other classical devices.

Pass 2 — Translation evaluation (once per poem × translator):
    For each English translation, evaluates how each device was handled,
    reconstructs the line→ku mapping, and characterises translator strategy.

Results are written to:
    data/annotations/source/poem_{N:03d}.json
    data/annotations/translations/poem_{N:03d}.json
"""

import anthropic
import csv
import json
import re
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

# ── Paths ────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

CSV_PATH   = ROOT / "data/poems_clean.csv"   # poet, JP source/romaji, 4 translations — 100 poems
SRC_DIR    = ROOT / "data/annotations/source"
TRANS_DIR  = ROOT / "data/annotations/translations"
SRC_DIR.mkdir(parents=True, exist_ok=True)
TRANS_DIR.mkdir(parents=True, exist_ok=True)

TRANSLATORS = ["Dickens", "Noguchi", "Porter", "McCauley"]
TRANS_KEYS  = {
    "Dickens":  "dickens_text_1866",
    "Noguchi":  "noguchi_text_1907",
    "Porter":   "porter_text_1909",
    "McCauley": "maccauley_text_1917",
}

client = anthropic.Anthropic()

# Shared schema-description text: build_data.py's build_src_devices() matches
# every device's "word" against source_jp by exact character-substring scan
# (the same mechanism kigo.word's own description below already documents) —
# a word that isn't a verbatim contiguous substring simply never highlights
# anywhere in the UI, with no error surfaced. Used on kakekotoba.word and
# makurakotoba.word too, since they hit the identical matcher.
_EXACT_SUBSTRING_NOTE = (
    "Must be an exact, contiguous substring of source_jp — if it isn't, "
    "this word silently fails to highlight anywhere in the rendered poem."
)

# Pass 2 already asks for a confidence rating on its line_mapping (whole
# object, not per-line) — Pass 1 had no equivalent for individual device
# identifications, even though kakekotoba/makurakotoba calls are genuinely
# contested among scholars for some poems more than others. Added to each
# device entry and to kigo so the review UI can prioritize exactly the
# identifications most likely to need a human look.
_CONFIDENCE_FIELD = {
    "type": "string",
    "enum": ["high", "medium", "low"],
    "description": (
        "How well-supported this specific identification is. \"low\" flags "
        "it as worth a human reviewer's attention, not a reason to omit it."
    ),
}

# Shared kigo search checklist for the system prompt and per-poem request.
KIGO_CATEGORIES = [
    "flowers", "blossoms", "leaves", "maple", "birds", "insects", "dew",
    "frost", "snow", "rain", "long rain", "wind", "autumn wind", "moon",
    "spring dawn", "mist", "haze", "grasses", "reeds", "rivers", "clothing",
    "famous places", "conventional waka imagery",
]


def kigo_checklist_bullets() -> str:
    """The categories as a bullet list — used identically in SYSTEM_PASS1 and
    analyze_source()'s per-poem user_msg, so there's only one list to edit."""
    return "\n".join(f"• {c}" for c in KIGO_CATEGORIES)


# Standard kakekotoba sound-pairs checked for each poem.
KAKEKOTOBA_PIVOT_PAIRS = [
    "なが/長-流", "よ/夜-世", "あき/秋-飽き", "まつ/松-待つ",
    "ふる/降る-古る-経る", "うき/憂き-浮き", "かる/枯る-離る",
]


def kakekotoba_pivot_pairs_str() -> str:
    return ", ".join(KAKEKOTOBA_PIVOT_PAIRS)


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPTS  (long, stable → marked for prompt caching)
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PASS1 = """\
You are a specialist in classical Japanese waka poetry with deep expertise in \
Heian-period poetics, the Ogura Hyakunin Isshu anthology, and the rhetorical \
devices of the classical tradition. You read Man'yōgana, kana, and kanji fluently \
and are familiar with classical (bungo) grammar.

Your task is to perform close structural analysis of a waka poem, identifying \
every classical rhetorical device present and characterising the bipartite \
kami-no-ku / shimo-no-ku relationship.

LANGUAGE — write every explanatory/narrative field (note, function, interaction, \
pivot_note, kami_theme, shimo_theme, conventional_meaning, semantic_field, and \
any other prose field) in ENGLISH, always, with no exceptions. Only the fields \
that hold an actual Japanese word/phrase from the poem itself (word, original_word, \
kanji, reading, text) should contain Japanese — every field that EXPLAINS or \
REASONS ABOUT the poem must be English prose for an English-speaking reader, \
even though your own internal reasoning process may run in either language.

═══ CLASSICAL DEVICE DEFINITIONS ═══

MAKURAKOTOBA (枕詞) — "pillow word"
  A fixed 5-mora epithet that conventionally precedes a specific word or class \
of words. Its primary function is ornamental, ritual, and register-elevating — \
it contributes sonic texture and signals classical literacy. Crucially, a \
makurakotoba may also carry literal propositional content (e.g. a real place \
name) while still functioning as a pillow word: what defines it is that it is a \
FIXED, conventionally established epithet for the word it introduces, not a \
freely composed image. Common examples:
  • あしびきの → precedes mountain (山) or mountain-bird (山鳥) words
  • ひさかたの → precedes sky, heaven, light, or moon words (光, 月, 天)
  • しろたへの / 白妙の → precedes white things (衣, 袖, 雪, 雲)
  • たらちねの → precedes mother (母) words
  • ぬばたまの → precedes dark, night, or black words (夜, 黒髪, 夢)
  • みちのくの (陸奥の) → precedes words associated with Michinoku (Tohoku) \
    region, especially its famous textiles (しのぶもぢずり, etc.)
  • あをによし → precedes 奈良 (Nara) words
  • ちはやぶる → precedes 神 (gods/kami) or 宇治 words
  • あかねさす → precedes 紫 (purple) or 日 (sun/day) words
  • あづまぢの → precedes words for the eastern road or Azuma region
  • からころも → precedes 着る (wearing) words
  • たまのをよ → not a makurakotoba; do not misidentify pivot words as pillows
  Always occupies a full ku (verse unit), almost always V1. Do not confuse with \
jokotoba, which is freely composed for the specific poem and typically longer \
than one ku. A word that is only metaphorically or associatively linked is NOT \
a makurakotoba — it must be a fixed, canonical epithet with an established \
target word class.

KAKEKOTOBA (掛詞) — "pivot word"
  A word that carries two or more meanings simultaneously, exploiting Japanese \
homophony or polysemy. Both meanings must be grammatically active at once — the \
poem's full meaning requires holding them together. This is the most \
translation-resistant device in waka. Examples:
  • ふる: "to fall" (rain/snow) AND "to grow old / pass time"
  • まつ: "to wait" AND "pine tree"
  • かける: "to hang" AND "to be lacking / absent"
  • ぬれ: "to be wet" AND "to weep / be overcome with longing"
  • しのぶ (in しのぶもぢずり): the place/cloth name Shinobu AND 忍ぶ \
    "to conceal / endure secret love"
  • くくる (in からくれないに水くくるとは): 括る "to tie-bind cloth \
    (resist-dyeing, kukuri-zome)" AND 潜る "to flow beneath / submerge" — \
    both readings are grammatically operative: the water is simultaneously \
    being tie-dyed crimson AND flowing beneath floating crimson leaves. \
  • ながめ: 眺め "to gaze / long reverie" AND 長雨 "long rains" — \
    the speaker's melancholy gaze and the autumn rains are one and the same word
  • たつ: 立つ "to rise / stand" AND 裁つ "to cut cloth"
  • ちる: 散る "to scatter / fall (leaves, blossoms)" AND 知る "to know"
  • なが (as in ながし/ながめ/ながし川 etc.): 長 "long" AND 流 "to flow / drift" — \
    common wherever length and flowing water/time are both in play
  • よ: 夜 "night" AND 世 "one's life / this world / one's lot" — one of the \
    single most common pivots in waka; check EVERY occurrence of よ/夜, especially \
    in phrases like ながき夜/ながながし夜 ("long night" doubling as "long life")
  • あき: 秋 "autumn" AND 飽き "to grow weary / tire (of someone)"
  • うき: 憂き "sorrowful / painful" AND 浮き "floating"
  • かる/かれ: 枯る "to wither" AND 離る "to grow distant / part from (a lover)"
  IMPORTANT — do NOT identify a word as kakekotoba merely because it has a \
  secondary connotation. The test is \
strict: both readings must be simultaneously grammatically operative in the \
poem's syntax, not just associatively present. However, a word that IS a \
  genuine homophonic/polysemous pivot remains a kakekotoba when both readings \
  are grammatically active.
  Standard classical pivots like {kakekotoba_pivot_pairs} are extremely common \
and well-documented in the canon — actively check the poem's text for EVERY occurrence of these known \
sound-pairs before ruling kakekotoba out, rather than waiting to notice one by \
chance. A pivot can also be embedded INSIDE a longer word (e.g. なが and し \
inside ながながし, or よ inside a longer phrase before a particle) — check \
  morphological substrings, not only whole standalone words.
  Identify the specific word, both readings, which ku it sits in, and how the \
two meanings interact with the poem's kami and shimo content.

JOKOTOBA (序詞) — "preface word"
  An extended introduction — usually more than 5 morae — that leads into the main \
poem through sound or meaning. Unlike makurakotoba, jokotoba are not fixed; they \
are composed for the specific poem. They typically occupy kami-no-ku entirely and \
introduce the shimo through a verbal or sonic pivot.

HONKADORI (本歌取り) — "allusion"
  A deliberate echo of an earlier poem (typically from Man'yōshū or Kokinshū). \
Flag only if you are confident of the specific source poem. Include the source.

KIGO (季語) — seasonal word
  A kigo may be explicit or implicit. Examine every category in the checklist \
below before concluding none exists. Consider both literal seasonal setting and \
conventional poetic association. If multiple seasonal images occur, identify \
the dominant one in the schema and explain why. Waka does not have the strict \
kigo rules of haiku, but seasonal words are always intentional and load-bearing.

{kigo_checklist}

═══ BIPARTITE STRUCTURE ═══

Every waka has a structural pivot between:
  Kami-no-ku (上の句): V1 + V2 + V3 — typically 5-7-5 morae
  Shimo-no-ku (下の句): V4 + V5 — typically 7-7 morae

The relationship type between them is the poem's deepest structural feature:
  • causal-physical      — kami causes or enables shimo
  • inferential-sensory  — speaker infers shimo from kami
  • simile-implicit      — kami is a sustained image that mirrors shimo without stating it
  • visual-revelation    — kami is the act of perceiving; shimo is what is perceived
  • emotional-juxtaposition — kami and shimo are placed in contrast or tension
  • seasonal-pivot       — seasonal image leads into human/emotional response
  • paradox              — the two halves contradict or undermine each other
  • other                — describe in pivot_note


Before calling the tool, perform a verification pass:

□ Have I examined every noun for seasonal association?
□ Have I examined every verb/adjective for homophonic or polysemous readings?
□ Have I checked embedded pivots inside compounds?
□ Have I searched for implicit as well as explicit kigo?
□ Have I mapped every preserved rhetorical function to specific English wording where applicable?
□ Is my kigo "word" a SINGLE exact substring of source_jp — not several candidates joined by "/" or a comma, and with no inserted spaces?


Always reason step by step before calling the tool. Perform an exhaustive lexical search before concluding a device is absent. Prefer well-supported identifications over speculative ones, but do not stop after the first plausible analysis. If no makurakotoba is present, return []. \
If no kakekotoba is present, return [].
""".format(kigo_checklist=kigo_checklist_bullets(),
           kakekotoba_pivot_pairs=kakekotoba_pivot_pairs_str())

SYSTEM_PASS2 = """\
When evaluating translations, always perform lexical alignment before rhetorical evaluation.

For every rhetorical device:

1. Locate every English word or phrase corresponding to it.
2. Record all plausible English equivalents.
3. Only then determine whether the rhetorical function has been preserved.

Never infer omission merely because the wording differs.

LANGUAGE — write every explanatory/narrative field (note, structural_note, \
translator_strategy, and any other prose field) in ENGLISH, always, with no \
exceptions. Only en_equivalent/original_word-type fields that quote an actual \
word from the source or translation should contain non-English text — every \
field that EXPLAINS or REASONS ABOUT the poem must be English prose, even \
though your own internal reasoning process may run in either language.

You are a specialist in comparative translation studies with deep expertise in \
classical Japanese waka poetry and 19th–20th century English literary translation. \
You are evaluating how four English translators handled the rhetorical devices of \
a specific waka poem.

You will be given:
  1. The original Japanese poem with ku segmentation
  2. A source analysis identifying all classical devices (produced by a prior analysis)
  3. One English translation to evaluate

Your task is to:
  A. Map each English line to the JP ku it most closely corresponds to (kami or shimo),
     based on semantic content — NOT on line number. A 4-line translation may have
     line 1 covering V1+V2 content; a 6-line may have two lines covering V5.

  B. Evaluate how each identified classical device was handled:
     — Makurakotoba: was it omitted, translated literally, given an ornamental
       equivalent, or explained?
     — Kakekotoba: which reading was preserved? Was the double meaning attempted?
     — Kigo: does the season survive explicitly (named), implicitly (through
       imagery/atmosphere without naming it), or not at all? English rarely
       preserves a literal seasonal word, so look for the FEELING of the
       season, not just a matching word.

  C. Characterise the bipartite relationship: did the translator preserve the
     structural logic between kami and shimo, invert it, collapse it, or displace
     it into a different relationship type entirely?

  D. Identify the translator's apparent strategy in one precise sentence.

═══ HANDLING VERDICTS ═══

Makurakotoba handling options:
  omitted              — pillow word simply absent, content skipped
  literal              — translated as if it had literal meaning (usually wrong)
  ornamental_equivalent — different phrase that performs the same elevating function
  explained            — paraphrased with its function made explicit in prose
  transformed          — repurposed into a different rhetorical gesture

Kakekotoba reading preserved options:
  both                 — translator found an English word or phrase holding both meanings
  primary_only         — the literal/surface reading is present, secondary lost
  secondary_only       — the figurative/emotional reading, literal lost
  neither              — both meanings absent
  transformed          — neither reading preserved but a new double meaning introduced

Bipartite preservation options:
  preserved   — structural logic and relationship type both maintained
  partial     — relationship type maintained but weakened or compressed
  inverted    — kami/shimo order reversed
  collapsed   — the bipartite boundary dissolved into continuous narrative
  displaced   — a different relationship type substituted

Always reason about each element before calling the tool. When line mapping is \
ambiguous (e.g., a line spans two ku worth of content), mark confidence "medium" \
and split the line content between the two ku in the note field.
"""

# ─────────────────────────────────────────────────────────────────────────────
# TOOL SCHEMAS
# ─────────────────────────────────────────────────────────────────────────────

SOURCE_TOOL = {
    "name": "annotate_source",
    "description": (
        "Record the complete classical device analysis of a waka poem. "
        "Call exactly once after completing your reasoning."
    ),
    "input_schema": {
        "type": "object",
        "required": ["makurakotoba", "kakekotoba",
                     "bipartite", "kigo", "furigana"],
        "properties": {
            "makurakotoba": {
                "type": "array",
                "description": "All pillow words in the poem. Empty array if none.",
                "items": {
                    "type": "object",
                    "required": ["word", "ku", "precedes", "conventional_meaning", "confidence"],
                    "properties": {
                        "word":                {"type": "string", "description": _EXACT_SUBSTRING_NOTE},
                        "ku":                  {"type": "integer", "minimum": 1, "maximum": 5},
                        "precedes":            {"type": "string"},
                        "conventional_meaning":{"type": "string"},
                        "confidence":          _CONFIDENCE_FIELD,
                    }
                }
            },
            "kakekotoba": {
                "type": "array",
                "description": "All pivot words. Empty array if none.",
                "items": {
                    "type": "object",
                    "required": ["word", "ku", "reading_primary",
                                 "reading_secondary", "interaction", "confidence"],
                    "properties": {
                        "word":              {"type": "string", "description": _EXACT_SUBSTRING_NOTE},
                        "ku":                {"type": "integer", "minimum": 1, "maximum": 5},
                        "reading_primary":   {"type": "string"},
                        "reading_secondary": {"type": "string"},
                        "interaction":       {"type": "string",
                                              "description": "How the two readings interlock in the poem's meaning"},
                        "confidence":        _CONFIDENCE_FIELD,
                    }
                }
            },
            "jokotoba": {
                "type": "object",
                "description": "Preface word sequence, if present. Omit if absent.",
                "properties": {
                    "text":    {"type": "string"},
                    "ku_span": {"type": "array", "items": {"type": "integer"}},
                    "pivot":   {"type": "string",
                                "description": "The word or sound linking jokotoba to the main poem"},
                    "function":{"type": "string"},
                }
            },
            "honkadori": {
                "type": "object",
                "description": "Source poem allusion, if identifiable with confidence. Omit if absent.",
                "properties": {
                    "source_poem": {"type": "string"},
                    "source_poet": {"type": "string"},
                    "echoed_phrase":{"type": "string"},
                    "function":    {"type": "string"},
                }
            },
            "kigo": {
                "type": "object",
                "required": ["word", "season", "note", "confidence"],
                "properties": {
                    "word":   {"type": "string",
                               "description": (
                                   "A SINGLE exact, contiguous substring of source_jp — never "
                                   "multiple candidates joined by '/', a comma, or 'and'; never "
                                   "with an inserted space that isn't in the original text. If "
                                   "several words carry seasonal weight, pick the ONE most "
                                   "load-bearing kigo here and mention the others by name in "
                                   "'note' instead — this field is verified by exact substring "
                                   "match against the poem text and silently fails to render at "
                                   "all if it isn't one."
                               )},
                    "season": {"type": "string",
                               "enum": ["spring", "summer", "autumn", "winter", "new_year", "none"]},
                    "ku":     {"type": "integer"},
                    "note":   {"type": "string",
                               "description": "Why this word carries the seasonal association — its classical poetic connotation, not just a dictionary gloss."},
                    "confidence": _CONFIDENCE_FIELD,
                }
            },
            "furigana": {
                "type": "array",
                "description": (
                    "Reading aid for classical readers. One entry per CONTIGUOUS run of "
                    "kanji characters in source_jp, in order of appearance left-to-right. "
                    "Do NOT include hiragana/katakana-only runs — only kanji need a reading. "
                    "'kanji' must be an exact, contiguous substring of source_jp."
                ),
                "items": {
                    "type": "object",
                    "required": ["kanji", "reading"],
                    "properties": {
                        "kanji":   {"type": "string", "description": "Exact contiguous kanji substring."},
                        "reading": {"type": "string", "description": "Hiragana reading as used in THIS poem (classical/historical kana usage where relevant, e.g. ゐ/ゑ/む for ん)."},
                    }
                }
            },
            "bipartite": {
                "type": "object",
                "required": ["kami_ku", "shimo_ku", "kami_theme",
                             "shimo_theme", "relationship_type", "pivot_note"],
                "properties": {
                    "kami_ku":    {"type": "array", "items": {"type": "integer"},
                                   "description": "Which ku numbers form the kami (usually [1,2,3])"},
                    "shimo_ku":   {"type": "array", "items": {"type": "integer"},
                                   "description": "Which ku numbers form the shimo (usually [4,5])"},
                    "kami_theme": {"type": "string"},
                    "shimo_theme":{"type": "string"},
                    "relationship_type": {
                        "type": "string",
                        "enum": ["causal-physical", "inferential-sensory", "simile-implicit",
                                 "visual-revelation", "emotional-juxtaposition",
                                 "seasonal-pivot", "paradox", "other"]
                    },
                    "pivot_note": {"type": "string",
                                   "description": "What makes the kami→shimo transition the poem's central meaning"},
                }
            },
        }
    }
}

EVAL_TOOL = {
    "name": "evaluate_translation",
    "description": (
        "Record the complete evaluation of one English translation. "
        "Call exactly once after completing your reasoning."
    ),
    "input_schema": {
        "type": "object",
        "required": ["line_mapping", "bipartite", "kakekotoba_handling",
                     "makurakotoba_handling", "kigo_handling",
                     "translator_strategy", "overall_fidelity"],
        "properties": {
            "line_mapping": {
                "type": "object",
                "required": ["entries", "confidence", "structural_note"],
                "properties": {
                    "entries": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["en_line", "jp_ku", "content_summary", "origin"],
                            "properties": {
                                "en_line":        {"type": "integer"},
                                "jp_ku":          {"type": "array", "items": {"type": "integer"},
                                                   "description": "One or more ku this line maps to. Empty list if purely extrapolated."},
                                "content_summary":{"type": "string"},
                                "origin":         {"type": "string",
                                                   "enum": ["source", "extrapolated"],
                                                   "description": "'source' if this line translates actual JP content; 'extrapolated' if the translator invented content with no equivalent in the source poem."},
                            }
                        }
                    },
                    "confidence":     {"type": "string", "enum": ["high", "medium", "low"]},
                    "structural_note":{"type": "string",
                                       "description": "Any unusual structure (inversion, compression, expansion)"},
                }
            },
            "bipartite": {
                "type": "object",
                "required": ["preserved", "kami_lines", "shimo_lines", "note"],
                "properties": {
                    "preserved":         {"type": "string",
                                          "enum": ["preserved", "partial", "inverted",
                                                   "collapsed", "displaced"]},
                    "kami_lines":        {"type": "array", "items": {"type": "integer"}},
                    "shimo_lines":       {"type": "array", "items": {"type": "integer"}},
                    "relationship_type": {"type": "string"},
                    "note":              {"type": "string"},
                }
            },
            "kakekotoba_handling": {
                "type": "array",
                "description": "One entry per kakekotoba identified in source analysis.",
                "items": {
                    "type": "object",
                    "required": ["original_word", "reading_preserved", "method", "en_equivalent", "note"],
                    "properties": {
                        "original_word":    {"type": "string"},
                        "reading_preserved":{"type": "string",
                                             "enum": ["both", "primary_only", "secondary_only",
                                                      "neither", "transformed"]},
                        "method":           {"type": "string",
                                             "enum": ["literal_primary", "literal_secondary",
                                                      "bilingual_pun", "partial",
                                                      "paraphrase", "omitted",
                                                      "explained", "transformed"]},
                        "en_equivalent":    {"type": "string",
                                             "description": (
                                                 "The SHORTEST exact, verbatim substring of the "
                                                 "translation's actual text that carries this pivot — "
                                                 "one or two words, never a whole clause or line. Copy "
                                                 "it exactly as it appears (same spelling/inflection); "
                                                 "this is verified by exact substring match and is "
                                                 "silently dropped if it doesn't match verbatim."
                                             )},
                        "note":             {"type": "string"},
                    }
                }
            },
            "makurakotoba_handling": {
                "type": "array",
                "description": "One entry per makurakotoba in source analysis. Empty array if none.",
                "items": {
                    "type": "object",
                    "required": ["original_word", "method", "note"],
                    "properties": {
                        "original_word":{"type": "string"},
                        "method":       {"type": "string",
                                         "enum": ["omitted", "literal", "ornamental_equivalent",
                                                  "explained", "transformed"],
                                         "description": (
                                             "'ornamental_equivalent' requires a REAL substitute doing "
                                             "the same register-elevating/epithet work — not just any "
                                             "nearby word that happens to survive. If the makurakotoba's "
                                             "actual rhetorical function (elevating register, signaling "
                                             "the target word class) is gone even though some vocabulary "
                                             "remains, that is 'omitted', not 'ornamental_equivalent'."
                                         )},
                        "en_equivalent":{"type": "string",
                                         "description": (
                                             "The SHORTEST exact, verbatim substring of the "
                                             "translation's actual text performing this epithet's "
                                             "function — one or two words, never a whole clause or "
                                             "line. Copy it exactly as it appears; this is verified by "
                                             "exact substring match and is silently dropped if it "
                                             "doesn't match verbatim."
                                         )},
                        "note":         {"type": "string"},
                    }
                }
            },
            "kigo_handling": {
                "type": "object",
                "description": (
                    "How this translator handled the source poem's kigo (seasonal word). "
                    "English translation rarely preserves a literal seasonal WORD the way "
                    "Japanese does, so check for the season's ATMOSPHERE/IMAGERY surviving "
                    "even when no season name appears."
                ),
                "required": ["preserved", "note"],
                "properties": {
                    "preserved": {"type": "string",
                                  "enum": ["explicit", "implicit_imagery", "omitted",
                                           "relocated", "transformed"],
                                  "description": (
                                      "explicit = the season is named outright (e.g. 'autumn'). "
                                      "implicit_imagery = the season is conveyed through imagery/"
                                      "atmosphere without naming it (e.g. dew, falling leaves, cold "
                                      "night implying autumn). omitted = no seasonal signal survives "
                                      "at all. relocated = the seasonal signal moved to a different "
                                      "point in the translation than where the kigo sits in source. "
                                      "transformed = a different season or seasonal image was "
                                      "substituted."
                                  )},
                    "en_equivalent": {"type": "string",
                                      "description": (
                                          "The SHORTEST exact, verbatim substring of the "
                                          "translation's actual text carrying the seasonal signal — "
                                          "one or two words, never a whole clause or line. Copy it "
                                          "exactly as it appears; this is verified by exact substring "
                                          "match and is silently dropped if it doesn't match "
                                          "verbatim."
                                      )},
                    "note": {"type": "string"},
                }
            },
            "translator_strategy": {
                "type": "string",
                "description": "One precise sentence characterising this translator's approach to this poem.",
            },
            "overall_fidelity": {
                "type": "string",
                "enum": ["high", "medium", "low"],
            },
        }
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────────────────────────────────────────

def _load_rows() -> dict[int, dict]:
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return {int(r["poem_number"]): r for r in rows}


def _clean_translation(raw: str) -> list[str]:
    """Return numbered lines from a raw translation cell."""
    # U+2028/U+2029 (LINE/PARAGRAPH SEPARATOR) -- invisible in an editor,
    # easy to mistake for a plain space, but genuinely distinct characters
    # some source cells use instead of a real newline.
    text = raw.replace(" ", "\n").replace(" ", "\n").replace("\\n", "\n")
    # Split a run-on marker like "...mountain, 2And..." before the digit,
    # then split one glued directly after a newline, e.g. "\n2And...".
    text = re.sub(r"\s+(?=\d+[A-Z(])", "\n", text)
    text = re.sub(r"(?<!\n)(?=\s*\d+[A-Z])", "\n", text)
    lines = []
    for ln in text.splitlines():
        ln = re.sub(r"^\s*\d+\s*", "", ln).strip()
        if ln:
            lines.append(ln)
    return lines


def _call_with_retry(fn, max_attempts: int = 4):
    """Exponential backoff retry for API calls."""
    for attempt in range(max_attempts):
        try:
            return fn()
        except anthropic.RateLimitError:
            if attempt == max_attempts - 1:
                raise
            wait = 2 ** (attempt + 2)   # 4, 8, 16 s
            print(f"      rate limit — waiting {wait}s")
            time.sleep(wait)
        except anthropic.APIStatusError as e:
            if e.status_code >= 500:
                if attempt == max_attempts - 1:
                    raise
                wait = 2 ** (attempt + 1)
                print(f"      server error {e.status_code} — waiting {wait}s")
                time.sleep(wait)
            else:
                raise
    raise RuntimeError(f"Failed after {max_attempts} attempts")


def _extract_tool_input(response) -> tuple[dict, str]:
    """Both prompts explicitly ask the model to "reason step by step before
    calling the tool" — that reasoning arrives as a text block preceding the
    tool_use block in the response. Return it with the tool input so callers
    can store it in the annotation record."""
    reasoning_parts = []
    tool_input = None
    for block in response.content:
        if block.type == "text":
            reasoning_parts.append(block.text)
        elif block.type == "tool_use":
            tool_input = block.input
    if tool_input is None:
        raise ValueError("No tool_use block in response")
    return tool_input, "\n".join(reasoning_parts).strip()


# ─────────────────────────────────────────────────────────────────────────────
# PASS 1 — SOURCE ANALYSIS
# ─────────────────────────────────────────────────────────────────────────────

def analyze_source(poem_number: int, row: dict) -> dict:
    source_jp = row["original_japanese"]
    romaji    = row.get("original_romaji", "")
    poet      = row.get("poet", "")

    user_msg = f"""\
<poem>
  <id>{poem_number}</id>
  <poet>{poet}</poet>

  <japanese>{source_jp}</japanese>
  <romaji>{romaji}</romaji>
</poem>

Analyse this waka carefully. Think through each classical device in order:
1. Is there a makurakotoba? Which word, which ku, what does it precede?
2. Are there kakekotoba? Explicitly check the poem against the standard canon \
   of pivot sound-pairs ({kakekotoba_pivot_pairs_str()}) at every occurrence, \
   including substrings inside longer words, before concluding none are present. \
   List each word, both readings, how they interact.
3. Is there a jokotoba? (more than 5 morae, not a fixed epithet)
4. Is there an identifiable honkadori (allusion to a specific earlier poem)?
5. Examine EVERY lexical item for seasonal significance.

Search for explicit and implicit kigo including:

{kigo_checklist_bullets()}

If multiple seasonal images occur, identify the dominant kigo and explain why it governs the poem.

Do not conclude season="none" until every lexical item has been checked.
6. What is the bipartite structure — kami theme, shimo theme, relationship type?
7. Read through the poem left to right and give the hiragana furigana reading for every contiguous kanji run (skip hiragana/katakana runs entirely).

Reason through each point before calling the tool. Perform an exhaustive search before concluding that a device is absent.
Prefer well-supported identifications over speculative ones, but do not stop after the first plausible interpretation.
"""

    def _call():
        return client.messages.create(
            model="claude-sonnet-5",
            max_tokens=6000,
            system=[{
                "type": "text",
                "text": SYSTEM_PASS1,
                "cache_control": {"type": "ephemeral"},
            }],
            tools=[SOURCE_TOOL],
            tool_choice={"type": "any"},
            messages=[{"role": "user", "content": user_msg}],
        )

    response = _call_with_retry(_call)
    result, reasoning = _extract_tool_input(response)
    result["poem_number"] = poem_number
    result["poet"]        = poet
    result["source_jp"]   = source_jp
    if reasoning:
        result["_reasoning"] = reasoning

    return result


# ─────────────────────────────────────────────────────────────────────────────
# PASS 2 — TRANSLATION EVALUATION
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_translation(poem_number: int, translator: str,
                          translation_lines: list[str],
                          source_analysis: dict) -> dict:

    # Serialise source analysis compactly for the prompt
    src_block = json.dumps({
        k: v for k, v in source_analysis.items()
        if not k.startswith("_")
    }, ensure_ascii=False, indent=2)

    numbered = "\n".join(f"  L{i+1}: {l}" for i, l in enumerate(translation_lines))

    user_msg = f"""\
<source_analysis>
{src_block}
</source_analysis>

<translation>
  <translator>{translator}</translator>
  <lines>
{numbered}
  </lines>
</translation>

Evaluate this translation against the source analysis above.

Work through each element:
1. LINE MAPPING — map each English line to the JP ku(s) it covers by semantic \
content. Note any compression, expansion, or inversion.
2. BIPARTITE — did the translator preserve the {source_analysis["bipartite"]["relationship_type"]} \
relationship between kami and shimo?
3. KAKEKOTOBA — for each pivot word in the source analysis, which reading did \
this translator preserve? What English word did they use? Use method "partial" \
when exactly one of the two readings is preserved by a specific English word \
(e.g. 'bound' preserves 括る but not 潜る → partial). Use "paraphrase" only \
when the EN word captures neither reading with any precision.
4. MAKURAKOTOBA — for each pillow word, what did this translator do with it? \
Only call it "ornamental_equivalent" if the substitute genuinely does the same \
elevating/epithet work — otherwise it's "omitted" even if some nearby word survives.
5. KIGO — does the source's seasonal word ({source_analysis.get("kigo", {}).get("word", "")}, \
{source_analysis.get("kigo", {}).get("season", "")}) survive in this translation? Check for \
the season's imagery/atmosphere surviving even without the literal season being named — \
English translations of waka usually convey season through image, not vocabulary.
6. STRATEGY — what single principle seems to govern this translator's choices here?

Reason through each point before calling the tool. For every en_equivalent field \
(kakekotoba, makurakotoba, kigo), give the SHORTEST exact verbatim phrase from the \
translation's own text — one or two words, never a whole clause or line — copied \
exactly as it appears. These are verified by exact substring match against the \
translation text and are silently dropped if they don't match verbatim.
"""

    def _call():
        return client.messages.create(
            model="claude-sonnet-5",
            max_tokens=4000,
            system=[{
                "type": "text",
                "text": SYSTEM_PASS2,
                "cache_control": {"type": "ephemeral"},
            }],
            tools=[EVAL_TOOL],
            tool_choice={"type": "any"},
            messages=[{"role": "user", "content": user_msg}],
        )

    response = _call_with_retry(_call)
    result, reasoning = _extract_tool_input(response)
    result["poem_number"] = poem_number
    result["translator"]  = translator
    if reasoning:
        result["_reasoning"] = reasoning
    return result


# ─────────────────────────────────────────────────────────────────────────────
# ORCHESTRATOR
# ─────────────────────────────────────────────────────────────────────────────

def run(poem_ids: list[int] | None = None):
    rows = _load_rows()
    targets = sorted(poem_ids or rows.keys())

    print(f"Annotating {len(targets)} poem(s)…\n")

    for pid in targets:
        if pid not in rows:
            print(f"[{pid:3d}] ✗  not found in CSV")
            continue

        row      = rows[pid]
        if not row.get("original_japanese", "").strip():
            print(f"[{pid:3d}] ✗  no Japanese source in {CSV_PATH} — check the row")
            continue
        src_path = SRC_DIR  / f"poem_{pid:03d}.json"
        tr_path  = TRANS_DIR / f"poem_{pid:03d}.json"

        # ── Pass 1 ──────────────────────────────────────────────────
        if src_path.exists():
            print(f"[{pid:3d}] Pass 1  (cached)")
            source = json.loads(src_path.read_text())
        else:
            print(f"[{pid:3d}] Pass 1  analysing source…", end=" ", flush=True)
            try:
                source = analyze_source(pid, row)
                src_path.write_text(json.dumps(source, ensure_ascii=False, indent=2))
                print("✓")
            except Exception as e:
                print(f"✗  {e}")
                continue
            time.sleep(1)   # brief courtesy pause between poems

        # ── Pass 2 ──────────────────────────────────────────────────
        existing = json.loads(tr_path.read_text()) if tr_path.exists() else {}

        for t in TRANSLATORS:
            if t in existing:
                print(f"[{pid:3d}] Pass 2  {t:10s} (cached)")
                continue

            raw_text = row.get(TRANS_KEYS[t], "")
            if not raw_text.strip():
                print(f"[{pid:3d}] Pass 2  {t:10s} (no text — skipped)")
                continue

            lines = _clean_translation(raw_text)
            print(f"[{pid:3d}] Pass 2  {t:10s} {len(lines)} lines…", end=" ", flush=True)

            try:
                result = evaluate_translation(pid, t, lines, source)
                existing[t] = result
                tr_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2))
                print("✓")
            except Exception as e:
                print(f"✗  {e}")

            time.sleep(0.5)

        print()

    print("Done.")


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = sys.argv[1:]

    # Usage:
    #   python annotate_translations.py              → all 100 poems
    #   python annotate_translations.py 1 2 3        → specific poems
    #   python annotate_translations.py 1-10         → range
    ids: list[int] | None = None

    if args:
        ids = []
        for a in args:
            try:
                if "-" in a:
                    lo, hi = (int(part) for part in a.split("-", 1))
                    if lo > hi:
                        raise ValueError("range start must not exceed range end")
                    ids.extend(range(lo, hi + 1))
                else:
                    ids.append(int(a))
            except ValueError as exc:
                sys.exit(f"Invalid poem id {a!r}: {exc}")

    run(ids)
