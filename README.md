# SVT Arrow Viewer

Static web viewer for anonymized SVT change arrows.

## Public Files

- `web/index.html`
- `web/app.js`
- `web/styles.css`
- `web/data.js`

The public web data contains graph coordinates and participant-entered nicknames only. Raw files, extracted files, generated metadata, and local analysis scripts are intentionally excluded from Git.

## Run Locally

```bash
python3 -m http.server 8000 --directory web
```

Open `http://localhost:8000`.
