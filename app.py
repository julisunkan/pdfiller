import os
import io
import uuid
import json
import base64
import sqlite3
import logging
from datetime import datetime
from flask import (Flask, render_template, request, jsonify,
                   send_from_directory, abort)
from werkzeug.utils import secure_filename
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib.colors import Color, HexColor, black, white, blue
from PIL import Image

logging.basicConfig(level=logging.DEBUG)

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "pdf-form-filler-secret")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
GENERATED_FOLDER = os.path.join(BASE_DIR, "generated")
DATABASE = os.path.join(BASE_DIR, "database.db")
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
ALLOWED_EXTENSIONS = {"pdf"}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(GENERATED_FOLDER, exist_ok=True)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS pdfs (
            id   TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            page_count INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS templates (
            id         TEXT PRIMARY KEY,
            pdf_id     TEXT NOT NULL,
            name       TEXT NOT NULL,
            field_data TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (pdf_id) REFERENCES pdfs(id)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS filled_documents (
            id          TEXT PRIMARY KEY,
            template_id TEXT,
            pdf_id      TEXT NOT NULL,
            values_data TEXT NOT NULL,
            out_filename TEXT NOT NULL,
            created_at  TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()
    logging.info("Database initialised")


init_db()


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def now_iso():
    return datetime.utcnow().isoformat()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ------ Upload PDF ----------------------------------------------------------

@app.route("/upload", methods=["POST"])
def upload_pdf():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": "Only PDF files are accepted"}), 400

    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_FILE_SIZE:
        return jsonify({"error": "File exceeds 20 MB limit"}), 400

    pdf_id = str(uuid.uuid4())
    original_name = secure_filename(file.filename)
    stored_name = f"{pdf_id}.pdf"
    save_path = os.path.join(UPLOAD_FOLDER, stored_name)
    file.save(save_path)

    # Extract existing AcroForm fields
    fields = []
    page_count = 1
    try:
        reader = PdfReader(save_path)
        page_count = len(reader.pages)
        if reader.get_fields():
            for name, field in reader.get_fields().items():
                ft = field.get("/FT", "")
                field_type = "text"
                if ft == "/Btn":
                    field_type = "checkbox"
                elif ft == "/Ch":
                    field_type = "dropdown"
                fields.append({
                    "name": name,
                    "type": field_type,
                    "value": field.get("/V", ""),
                })
    except Exception as e:
        logging.warning(f"Could not parse PDF fields: {e}")

    conn = get_db()
    conn.execute(
        "INSERT INTO pdfs (id, filename, original_name, page_count, created_at) VALUES (?,?,?,?,?)",
        (pdf_id, stored_name, original_name, page_count, now_iso()),
    )
    conn.commit()
    conn.close()

    return jsonify({
        "pdf_id": pdf_id,
        "original_name": original_name,
        "page_count": page_count,
        "fields": fields,
    })


# ------ Serve uploaded PDF for preview --------------------------------------

@app.route("/pdf/<pdf_id>")
def serve_pdf(pdf_id):
    conn = get_db()
    row = conn.execute("SELECT filename FROM pdfs WHERE id=?", (pdf_id,)).fetchone()
    conn.close()
    if not row:
        abort(404)
    return send_from_directory(UPLOAD_FOLDER, row["filename"],
                               mimetype="application/pdf")


# ------ Fill PDF ------------------------------------------------------------

@app.route("/fill/<pdf_id>", methods=["POST"])
def fill_pdf(pdf_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM pdfs WHERE id=?", (pdf_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "PDF not found"}), 404

    data = request.get_json(force=True)
    fields = data.get("fields", [])       # list of field objects
    page_count = row["page_count"]

    src_path = os.path.join(UPLOAD_FOLDER, row["filename"])

    try:
        reader = PdfReader(src_path)
        writer = PdfWriter()

        # Build per-page field lists
        pages_fields = {i: [] for i in range(page_count)}
        for f in fields:
            pg = int(f.get("page", 0))
            if pg < page_count:
                pages_fields[pg].append(f)

        for page_idx in range(page_count):
            pdf_page = reader.pages[page_idx]
            page_w = float(pdf_page.mediabox.width)
            page_h = float(pdf_page.mediabox.height)

            page_fields = pages_fields[page_idx]

            if page_fields:
                # Build reportlab overlay for this page
                overlay_buf = io.BytesIO()
                c = rl_canvas.Canvas(overlay_buf, pagesize=(page_w, page_h))

                for field in page_fields:
                    ftype = field.get("type", "text")
                    # Coordinates from frontend are relative to rendered canvas
                    # Frontend sends: x, y (top-left of field, % of page dims)
                    x_pct = float(field.get("x_pct", 0))
                    y_pct = float(field.get("y_pct", 0))
                    w_pct = float(field.get("w_pct", 10))
                    h_pct = float(field.get("h_pct", 5))

                    # Convert to PDF points (origin bottom-left in reportlab)
                    pdf_x = x_pct / 100.0 * page_w
                    pdf_y_top = y_pct / 100.0 * page_h
                    pdf_w = w_pct / 100.0 * page_w
                    pdf_h = h_pct / 100.0 * page_h
                    # ReportLab origin is bottom-left; PDF y grows upward
                    pdf_y = page_h - pdf_y_top - pdf_h

                    if ftype == "signature":
                        sig_data = field.get("value", "")
                        if sig_data and sig_data.startswith("data:image"):
                            header, b64 = sig_data.split(",", 1)
                            img_bytes = base64.b64decode(b64)
                            pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
                            img_reader = ImageReader(pil_img)
                            c.drawImage(img_reader, pdf_x, pdf_y,
                                        width=pdf_w, height=pdf_h,
                                        mask="auto")
                    elif ftype == "text":
                        value = str(field.get("value", ""))
                        if value:
                            font_size = max(8, min(int(pdf_h * 0.6), 24))
                            c.setFont("Helvetica", font_size)
                            c.setFillColorRGB(0, 0, 0)
                            c.drawString(pdf_x + 2, pdf_y + (pdf_h - font_size) / 2 + 2, value)

                c.save()
                overlay_buf.seek(0)

                overlay_reader = PdfReader(overlay_buf)
                pdf_page.merge_page(overlay_reader.pages[0])

            writer.add_page(pdf_page)

        out_name = f"filled_{pdf_id}_{uuid.uuid4().hex[:8]}.pdf"
        out_path = os.path.join(GENERATED_FOLDER, out_name)
        with open(out_path, "wb") as f:
            writer.write(f)

        # Record
        doc_id = str(uuid.uuid4())
        conn2 = get_db()
        conn2.execute(
            "INSERT INTO filled_documents (id, pdf_id, values_data, out_filename, created_at) VALUES (?,?,?,?,?)",
            (doc_id, pdf_id, json.dumps(fields), out_name, now_iso()),
        )
        conn2.commit()
        conn2.close()

        return jsonify({"filename": out_name, "doc_id": doc_id})

    except Exception as e:
        logging.exception("Error filling PDF")
        return jsonify({"error": str(e)}), 500


# ------ Save Template -------------------------------------------------------

@app.route("/save-template/<pdf_id>", methods=["POST"])
def save_template(pdf_id):
    conn = get_db()
    row = conn.execute("SELECT id FROM pdfs WHERE id=?", (pdf_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "PDF not found"}), 404

    data = request.get_json(force=True)
    name = data.get("name", "Untitled Template").strip() or "Untitled Template"
    field_data = data.get("fields", [])

    tpl_id = str(uuid.uuid4())
    conn2 = get_db()
    conn2.execute(
        "INSERT INTO templates (id, pdf_id, name, field_data, created_at) VALUES (?,?,?,?,?)",
        (tpl_id, pdf_id, name, json.dumps(field_data), now_iso()),
    )
    conn2.commit()
    conn2.close()

    return jsonify({"template_id": tpl_id, "name": name})


# ------ Load Template -------------------------------------------------------

@app.route("/template/<tpl_id>")
def load_template(tpl_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM templates WHERE id=?", (tpl_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "Template not found"}), 404
    return jsonify({
        "id": row["id"],
        "pdf_id": row["pdf_id"],
        "name": row["name"],
        "fields": json.loads(row["field_data"]),
        "created_at": row["created_at"],
    })


# ------ List Templates for a PDF -------------------------------------------

@app.route("/templates/<pdf_id>")
def list_templates(pdf_id):
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, created_at FROM templates WHERE pdf_id=? ORDER BY created_at DESC",
        (pdf_id,),
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ------ Download generated PDF ---------------------------------------------

@app.route("/download/<filename>")
def download_file(filename):
    safe = secure_filename(filename)
    path = os.path.join(GENERATED_FOLDER, safe)
    if not os.path.exists(path):
        abort(404)
    return send_from_directory(GENERATED_FOLDER, safe,
                               as_attachment=True,
                               mimetype="application/pdf")


# ------ Create Blank PDF (for form designer) --------------------------------

PAGE_SIZES = {
    "letter": (612, 792),
    "a4":     (595, 842),
    "legal":  (612, 1008),
}

@app.route("/create-blank", methods=["POST"])
def create_blank():
    data = request.get_json(force=True) or {}
    size_key = data.get("page_size", "letter").lower()
    page_w, page_h = PAGE_SIZES.get(size_key, PAGE_SIZES["letter"])

    # Build a plain white PDF page
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(page_w, page_h))
    c.setFillColorRGB(1, 1, 1)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)
    c.save()
    buf.seek(0)

    pdf_id = str(uuid.uuid4())
    stored_name = f"{pdf_id}.pdf"
    save_path = os.path.join(UPLOAD_FOLDER, stored_name)
    with open(save_path, "wb") as f:
        f.write(buf.read())

    conn = get_db()
    conn.execute(
        "INSERT INTO pdfs (id, filename, original_name, page_count, created_at) VALUES (?,?,?,?,?)",
        (pdf_id, stored_name, "Blank Form", 1, now_iso()),
    )
    conn.commit()
    conn.close()

    return jsonify({
        "pdf_id": pdf_id,
        "original_name": "Blank Form",
        "page_count": 1,
        "page_w": page_w,
        "page_h": page_h,
        "fields": [],
    })


# ------ Create Fillable AcroForm PDF ----------------------------------------

@app.route("/create-fillable/<pdf_id>", methods=["POST"])
def create_fillable(pdf_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM pdfs WHERE id=?", (pdf_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "PDF not found"}), 404

    data = request.get_json(force=True)
    fields = data.get("fields", [])
    doc_name = data.get("doc_name", "fillable_form").strip() or "fillable_form"

    src_path = os.path.join(UPLOAD_FOLDER, row["filename"])

    try:
        # Get page dimensions from the source PDF
        reader = PdfReader(src_path)
        page_w = float(reader.pages[0].mediabox.width)
        page_h = float(reader.pages[0].mediabox.height)

        # Build a new PDF with the original page as background + AcroForm fields
        buf = io.BytesIO()
        c = rl_canvas.Canvas(buf, pagesize=(page_w, page_h))
        form = c.acroForm

        # Draw the original page content as a background image via pypdf merge
        # We'll build the AcroForm layer separately and merge
        for field in fields:
            ftype = field.get("type", "text")
            x_pct  = float(field.get("x_pct", 0))
            y_pct  = float(field.get("y_pct", 0))
            w_pct  = float(field.get("w_pct", 20))
            h_pct  = float(field.get("h_pct", 5))
            label  = field.get("label", f"field_{field.get('id','')}")
            placeholder = field.get("placeholder", "")

            pdf_x = x_pct / 100.0 * page_w
            pdf_y_top = y_pct / 100.0 * page_h
            pdf_w = w_pct / 100.0 * page_w
            pdf_h = h_pct / 100.0 * page_h
            pdf_y = page_h - pdf_y_top - pdf_h  # flip to bottom-left origin

            font_size = max(8, min(int(pdf_h * 0.55), 18))

            if ftype == "text":
                form.textfield(
                    name=label,
                    tooltip=placeholder or label,
                    x=pdf_x, y=pdf_y,
                    width=pdf_w, height=pdf_h,
                    fontSize=font_size,
                    borderColor=Color(0.6, 0.6, 0.8),
                    fillColor=Color(0.97, 0.97, 1),
                    textColor=black,
                    borderStyle="inset",
                    forceBorder=True,
                )
            elif ftype == "checkbox":
                box_size = min(pdf_h, pdf_w, 18)
                form.checkbox(
                    name=label,
                    tooltip=placeholder or label,
                    x=pdf_x, y=pdf_y + (pdf_h - box_size) / 2,
                    size=box_size,
                    borderColor=Color(0.4, 0.4, 0.7),
                    fillColor=white,
                    forceBorder=True,
                )
                # Draw checkbox label text next to box
                c.setFont("Helvetica", font_size)
                c.setFillColorRGB(0, 0, 0)
                c.drawString(pdf_x + box_size + 4,
                             pdf_y + (pdf_h - font_size) / 2 + 2,
                             placeholder or label)
            elif ftype == "signature":
                # Signature: styled text field as signature area
                form.textfield(
                    name=label,
                    tooltip="Sign here",
                    x=pdf_x, y=pdf_y,
                    width=pdf_w, height=pdf_h,
                    fontSize=font_size,
                    borderColor=Color(0.3, 0.3, 0.7),
                    fillColor=Color(0.95, 0.95, 1),
                    textColor=Color(0, 0, 0.6),
                    borderStyle="underlined",
                    forceBorder=True,
                )

        c.save()
        buf.seek(0)

        # Merge the AcroForm overlay on top of the original background
        acro_reader  = PdfReader(buf)
        bg_reader    = PdfReader(src_path)
        writer       = PdfWriter()

        bg_page = bg_reader.pages[0]
        bg_page.merge_page(acro_reader.pages[0])
        writer.add_page(bg_page)
        writer.add_metadata({"/Title": doc_name, "/Producer": "PDF Form Filler"})

        safe_name = secure_filename(doc_name.replace(" ", "_"))
        out_name = f"fillable_{pdf_id}_{uuid.uuid4().hex[:6]}_{safe_name}.pdf"
        out_path = os.path.join(GENERATED_FOLDER, out_name)
        with open(out_path, "wb") as f:
            writer.write(f)

        doc_id = str(uuid.uuid4())
        conn2 = get_db()
        conn2.execute(
            "INSERT INTO filled_documents (id, pdf_id, values_data, out_filename, created_at) VALUES (?,?,?,?,?)",
            (doc_id, pdf_id, json.dumps(fields), out_name, now_iso()),
        )
        conn2.commit()
        conn2.close()

        return jsonify({"filename": out_name, "doc_id": doc_id})

    except Exception as e:
        logging.exception("Error creating fillable PDF")
        return jsonify({"error": str(e)}), 500


# ------ PWA manifest & service worker --------------------------------------

@app.route("/manifest.json")
def manifest():
    return send_from_directory("static", "manifest.json")


@app.route("/service-worker.js")
def service_worker():
    return send_from_directory("static", "service-worker.js",
                               mimetype="application/javascript")
