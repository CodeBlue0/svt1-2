# SVT Experiment Dashboard

Static 3-page dashboard for 7-round SVT experiment latency, accuracy, individual
trend/model-fit, confusion-matrix, item-correctness, and cohort insight analysis. Analyses use only items shared across all rounds; 1st-round-only items are ignored.

## Public Files

- `web/index.html` / `web/app.js`: multi-participant comparison page with the priority RT × accuracy arrow trajectory graph.
- `web/items.html` / `web/items.js`: single-participant analysis page with learning curve, model fits, confusion matrix, and the comparable 176-item correctness grid.
- `web/insights.html` / `web/insights.js`: cohort insight page for participation funnel, round landscape, speed-accuracy atlas, and item difficulty watch list.
- `web/styles.css`: shared visual system for all pages.
- `web/data.js`: generated public payload.

`web/data.js` is a generated, privacy-aware payload. The public participant
selector uses participant-entered `participant_id` values first (for example,
`applebanana`). If a usable participant ID is missing, the generator falls back
to the numeric student ID so nicknameless participants remain recognizable.
Participants with only one completed round are excluded from the public
dashboard.
Names, source file paths, duplicate details, and full audit logs are written
under ignored `metadata/` files and are not part of the public dashboard payload.

Raw files under `extracted/` are read-only inputs; the analysis script never
edits them.

## Regenerate Data

```bash
python3 -m pip install -r requirements.txt
python3 scripts/compute_svt_metrics.py
```

The generator reads `.csv`, `.xlsx`, and `.numbers` participant exports. `.xlsx` support uses `openpyxl`; `.numbers` support uses `numbers-parser`.

The generator writes:

- public dashboard data: `web/data.js`
- private/local audit outputs: `metadata/svt_*.csv`,
  `metadata/svt_quality_summary.json`

Run the fixture checks for round assignment, duplicate selection, identity merging, common-item filtering, model fallback, and payload redaction:

```bash
python3 scripts/test_compute_svt_metrics.py
```

## Run Locally

```bash
python3 -m http.server 8000 --directory web
```

Open `http://localhost:8000` for the comparison page, `/items.html` for individual analysis, and `/insights.html` for cohort insights.
