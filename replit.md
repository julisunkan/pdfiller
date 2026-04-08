# PDF Form Filler

A lightweight DocuSign-style PDF editor that runs entirely in the browser with server-side PDF generation.

## Overview

Users can upload a PDF, overlay draggable text and signature fields directly on the PDF preview, fill them in, and download the completed PDF. Field layouts can be saved as reusable templates.

## Tech Stack

- **Backend**: Python / Flask
- **Database**: SQLite (via sqlite3 standard library)
- **PDF Reading**: pypdf
- **PDF Generation/Overlay**: reportlab + pypdf merge
- **Image Processing**: Pillow
- **Frontend**: Vanilla HTML, CSS, JavaScript
- **PDF Rendering**: PDF.js (CDN)
- **PWA**: manifest.json + service-worker.js

## Project Structure

```
app.py               # Flask app — routes, DB, PDF generation
main.py              # Entry point
requirements.txt     # Python dependencies
database.db          # SQLite database (auto-created)
uploads/             # Uploaded source PDFs (UUID-named)
generated/           # Generated filled PDFs
templates/
  index.html         # Main single-page UI
static/
  app.js             # All frontend logic
  styles.css         # Dark-mode UI styles
  manifest.json      # PWA manifest
  service-worker.js  # PWA service worker + cache
  icons/             # App icons (192, 512px)
```

## Database Schema

- **pdfs** — uploaded PDF records (id, filename, original_name, page_count, created_at)
- **templates** — saved field layouts (id, pdf_id, name, field_data JSON, created_at)
- **filled_documents** — generated PDF records (id, pdf_id, values_data JSON, out_filename, created_at)

## API Endpoints

- `POST /upload` — upload PDF, extract AcroForm fields
- `GET /pdf/<pdf_id>` — serve PDF for PDF.js preview
- `POST /fill/<pdf_id>` — overlay fields and generate filled PDF
- `POST /save-template/<pdf_id>` — save field layout as template
- `GET /template/<id>` — load a template
- `GET /templates/<pdf_id>` — list templates for a PDF
- `GET /download/<filename>` — download generated PDF

## Running

```bash
python3 -m gunicorn --bind 0.0.0.0:5000 --reuse-port --reload main:app
```

## Key Features

- Drag & drop PDF upload
- PDF.js multi-page rendering
- Draggable + resizable text/signature fields
- Signature drawing canvas (mouse & touch)
- Coordinate mapping: canvas % → PDF points
- Template save/load per PDF
- PWA installable (offline static caching)
- No alert() popups — all inline notifications
