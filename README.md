# SVT Experiment Dashboard

React entry page plus static dashboard pages for SVT experiment latency, accuracy, individual
trend/model-fit, confusion-matrix, item-correctness, and cohort insight analysis.
Participant rounds are assigned by each participant's selected submission
timestamps, not by source folder names. Analyses use only items shared across
observed attempts; first-attempt-only items are ignored.

## Public Files

- `public/index.html` / `public/main.js`: React experiment result lookup page. It reads Supabase when `public/supabase-config.js` is configured and falls back to the generated public payload while credentials are empty.
- `public/total-results/`: migrated static dashboard from the previous `web/` folder. The top-left option on the React page links here for 전체 결과보기.
- `public/supabase-config.js`: Supabase URL, anon key, table names, and participant ID column mapping for the lookup page.
- `web/index.html` / `web/app.js`: multi-participant comparison page with the priority RT × accuracy arrow trajectory graph.
- `web/items.html` / `web/items.js`: single-participant analysis page with learning curve, model fits, confusion matrix, and the comparable 176-item correctness grid.
- `web/insights.html` / `web/insights.js`: cohort insight page for participation funnel, round landscape, speed-accuracy atlas, and item difficulty watch list.
- `web/styles.css`: shared visual system for all pages.
- `web/data.js`: generated public payload.

`web/data.js` is a generated, privacy-aware payload. The public participant
selector uses the most recent selected submission's participant-entered
`participant_id` first (for example, `applebanana`). If a usable participant ID
is missing, the generator falls back to the numeric student ID so nicknameless
participants remain recognizable.
Participants with only one completed round are excluded from the public
dashboard.
Names, source file paths, duplicate details, and full audit logs are written
under ignored `metadata/` files and are not part of the public dashboard payload.

Raw files under `extracted/` are read-only inputs; the analysis script never
edits them. `extracted/svt_s1/` is temporarily excluded from the generated
metrics and public dashboard payload.

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

Run the fixture checks for source-bucket assignment, exact-copy deduplication,
chronological attempt assignment, identity merging, common-item filtering, model
fallback, and payload redaction:

```bash
python3 scripts/test_compute_svt_metrics.py
```

## Run Locally

```bash
python3 -m http.server 8000 --directory web
```

Open `http://localhost:8000` for the comparison page, `/items.html` for individual analysis, and `/insights.html` for cohort insights.

For the new React shell:

```bash
python3 -m http.server 8000 --directory public
```

Open `http://localhost:8000` for the lookup page and `/total-results/` for the migrated full dashboard.
