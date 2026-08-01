# A Syntenic View of Poetic Translations

An interactive comparison of four English translations of the *Ogura Hyakunin
Isshu*. The repository contains the public static site, its source corpus,
machine-assisted annotations, and an optional local review interface.

## Quick start

Requires Python 3.10 or newer.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python build_data.py
python -m http.server --directory site 8000
```

Open <http://127.0.0.1:8000>. The static site is self-contained after
`build_data.py` runs.

## Project layout

- `data/poems_clean.csv` — source poems and four public-domain translations.
- `data/annotations/` — source and translation annotation records.
- `data/corrections/` — curated reviewer corrections applied at build time.
- `annotate_translations.py` — optional Anthropic-powered annotation pipeline.
- `build_data.py` — validates/combines source data and writes `site/data/`.
- `review_app/` — local-only review UI for annotations and corrections.
- `site/` — deployable static visualization.

## Annotation and review

To run new annotations, copy `.env.example` to `.env`, add an Anthropic API
key, then run `python annotate_translations.py 1-5`.

To review existing annotations locally:

```sh
python review_app/server.py
```

Open <http://127.0.0.1:5051>. The server deliberately binds only to localhost.
After changing annotations or corrections, run `python build_data.py` before
publishing the static site.