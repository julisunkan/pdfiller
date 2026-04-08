/* =============================================================
   PDF Form Filler — Frontend Logic
   ============================================================= */

// ── State ──────────────────────────────────────────────────────
const state = {
  pdfId: null,
  pdfDoc: null,         // PDF.js document
  currentPage: 1,
  totalPages: 1,
  scale: 1,
  fields: [],           // [{id, type, page, x_pct, y_pct, w_pct, h_pct, value}]
  activeTool: null,     // 'text' | 'signature'
  selectedFieldId: null,
  pendingSigFieldId: null,  // field waiting for signature
};

// ── DOM refs ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dropZone          = $('dropZone');
const fileInput         = $('fileInput');
const uploadProgress    = $('uploadProgress');
const progressFill      = $('progressFill');
const progressLabel     = $('progressLabel');
const uploadedInfo      = $('uploadedInfo');
const uploadedName      = $('uploadedName');
const btnChangeFile     = $('btnChangeFile');
const toolsSection      = $('toolsSection');
const fieldsSection     = $('fieldsSection');
const generateSection   = $('generateSection');
const headerActions     = $('headerActions');
const pdfPlaceholder    = $('pdfPlaceholder');
const pdfViewerWrap     = $('pdfViewerWrap');
const pdfCanvas         = $('pdfCanvas');
const fieldsOverlay     = $('fieldsOverlay');
const pdfCanvasContainer= $('pdfCanvasContainer');
const fieldList         = $('fieldList');
const fieldCount        = $('fieldCount');
const pageNav           = $('pageNav');
const pageLabel         = $('pageLabel');
const btnPrevPage       = $('btnPrevPage');
const btnNextPage       = $('btnNextPage');
const btnAddText        = $('btnAddText');
const btnAddSignature   = $('btnAddSignature');
const btnGenerate       = $('btnGenerate');
const downloadArea      = $('downloadArea');
const downloadLink      = $('downloadLink');
const notification      = $('notification');

// Signature modal
const sigModal          = $('sigModal');
const closeSigModal     = $('closeSigModal');
const sigCanvas         = $('sigCanvas');
const btnClearSig       = $('btnClearSig');
const btnSaveSig        = $('btnSaveSig');

// Save template modal
const saveTemplateModal     = $('saveTemplateModal');
const btnSaveTemplate       = $('btnSaveTemplate');
const closeSaveTemplateModal= $('closeSaveTemplateModal');
const templateName          = $('templateName');
const btnConfirmSaveTemplate= $('btnConfirmSaveTemplate');

// Load template modal
const loadTemplateModal     = $('loadTemplateModal');
const btnLoadTemplate       = $('btnLoadTemplate');
const closeLoadTemplateModal= $('closeLoadTemplateModal');
const templateListWrap      = $('templateListWrap');


// ── Notifications ──────────────────────────────────────────────
let notifTimer = null;
function notify(msg, type = 'info', duration = 3500) {
  notification.textContent = msg;
  notification.className = `notification ${type}`;
  notification.classList.remove('hidden');
  if (notifTimer) clearTimeout(notifTimer);
  if (duration > 0) {
    notifTimer = setTimeout(() => notification.classList.add('hidden'), duration);
  }
}
function notifyLoading(msg) { notify(msg, 'loading', 0); }
function notifyHide() { notification.classList.add('hidden'); }


// ── File Upload ────────────────────────────────────────────────
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
btnChangeFile.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });

async function handleFile(file) {
  if (!file.name.endsWith('.pdf')) { notify('Only PDF files are accepted.', 'error'); return; }
  if (file.size > 20 * 1024 * 1024) { notify('File exceeds 20 MB limit.', 'error'); return; }

  // Show progress
  uploadProgress.classList.remove('hidden');
  uploadedInfo.classList.add('hidden');
  progressFill.style.width = '0%';
  progressLabel.textContent = 'Uploading…';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload');
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        progressFill.style.width = pct + '%';
        progressLabel.textContent = `Uploading… ${pct}%`;
      }
    };

    const result = await new Promise((resolve, reject) => {
      xhr.onload = () => {
        if (xhr.status === 200) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed'));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    });

    progressFill.style.width = '100%';
    progressLabel.textContent = 'Processing…';

    state.pdfId = result.pdf_id;
    state.fields = [];
    state.currentPage = 1;
    state.totalPages = result.page_count;

    uploadProgress.classList.add('hidden');
    uploadedInfo.classList.remove('hidden');
    uploadedName.textContent = result.original_name;

    showAppSections();
    await loadPdfPage(state.currentPage);
    renderFieldList();
    notify(`Uploaded "${result.original_name}" — ${result.page_count} page(s)`, 'success');

  } catch (err) {
    uploadProgress.classList.add('hidden');
    notify(err.message, 'error');
  }
}

function showAppSections() {
  toolsSection.classList.remove('hidden');
  fieldsSection.classList.remove('hidden');
  generateSection.classList.remove('hidden');
  headerActions.classList.remove('hidden');
  pdfPlaceholder.classList.add('hidden');
  pdfViewerWrap.classList.remove('hidden');
  downloadArea.classList.add('hidden');
  if (state.totalPages > 1) pageNav.classList.remove('hidden');
}


// ── PDF.js Rendering ───────────────────────────────────────────
async function loadPdfPage(pageNum) {
  if (!state.pdfId) return;
  notifyLoading('Rendering PDF…');
  try {
    const pdfUrl = `/pdf/${state.pdfId}`;

    // Load document only once
    if (!state.pdfDoc) {
      state.pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
    }

    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    state.scale = 1.5;

    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;

    const ctx = pdfCanvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    state.currentPage = pageNum;
    pageLabel.textContent = `Page ${pageNum} / ${state.totalPages}`;
    btnPrevPage.disabled = pageNum <= 1;
    btnNextPage.disabled = pageNum >= state.totalPages;

    renderOverlayFields();
    notifyHide();
  } catch (err) {
    notify('Failed to render PDF: ' + err.message, 'error');
  }
}

btnPrevPage.addEventListener('click', () => {
  if (state.currentPage > 1) loadPdfPage(state.currentPage - 1);
});
btnNextPage.addEventListener('click', () => {
  if (state.currentPage < state.totalPages) loadPdfPage(state.currentPage + 1);
});


// ── Tool Selection ─────────────────────────────────────────────
btnAddText.addEventListener('click', () => setActiveTool('text'));
btnAddSignature.addEventListener('click', () => setActiveTool('signature'));

function setActiveTool(tool) {
  if (state.activeTool === tool) {
    state.activeTool = null;
    btnAddText.classList.remove('active');
    btnAddSignature.classList.remove('active');
    pdfCanvasContainer.style.cursor = 'default';
  } else {
    state.activeTool = tool;
    btnAddText.classList.toggle('active', tool === 'text');
    btnAddSignature.classList.toggle('active', tool === 'signature');
    pdfCanvasContainer.style.cursor = 'crosshair';
  }
}


// ── Place Field on Click ───────────────────────────────────────
pdfCanvasContainer.addEventListener('click', e => {
  if (!state.activeTool) return;
  if (e.target.closest('.field-widget')) return;  // clicked existing field

  const rect = pdfCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  // Convert to percentage of canvas size
  const x_pct = (cx / pdfCanvas.width) * 100;
  const y_pct = (cy / pdfCanvas.height) * 100;

  const fieldId = 'f_' + Date.now();
  const field = {
    id: fieldId,
    type: state.activeTool,
    page: state.currentPage - 1,    // 0-indexed for backend
    x_pct,
    y_pct,
    w_pct: state.activeTool === 'signature' ? 18 : 20,
    h_pct: state.activeTool === 'signature' ? 8 : 5,
    value: '',
    label: state.activeTool === 'text' ? `Text ${state.fields.filter(f=>f.type==='text').length + 1}`
                                        : `Signature ${state.fields.filter(f=>f.type==='signature').length + 1}`,
  };

  state.fields.push(field);
  addFieldWidget(field);
  renderFieldList();
  setActiveTool(null);  // deactivate after placing

  // If signature, open sig modal immediately
  if (field.type === 'signature') {
    openSigModal(fieldId);
  }
});


// ── Render Overlay Fields ──────────────────────────────────────
function renderOverlayFields() {
  fieldsOverlay.innerHTML = '';
  state.fields
    .filter(f => f.page === state.currentPage - 1)
    .forEach(addFieldWidget);
}

function addFieldWidget(field) {
  const el = document.createElement('div');
  el.className = 'field-widget';
  el.dataset.id = field.id;
  el.style.left   = field.x_pct + '%';
  el.style.top    = field.y_pct + '%';
  el.style.width  = field.w_pct + '%';
  el.style.height = field.h_pct + '%';
  if (state.selectedFieldId === field.id) el.classList.add('selected');

  // Controls bar
  const controls = document.createElement('div');
  controls.className = 'widget-controls';

  if (field.type === 'signature') {
    const editBtn = document.createElement('button');
    editBtn.className = 'widget-ctrl-btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit signature';
    editBtn.addEventListener('click', e => { e.stopPropagation(); openSigModal(field.id); });
    controls.appendChild(editBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'widget-ctrl-btn';
  delBtn.textContent = '🗑';
  delBtn.title = 'Delete field';
  delBtn.addEventListener('click', e => { e.stopPropagation(); deleteField(field.id); });
  controls.appendChild(delBtn);

  el.appendChild(controls);

  // Content
  if (field.type === 'text') {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = field.value;
    input.placeholder = 'Type here…';
    input.addEventListener('input', () => { field.value = input.value; });
    input.addEventListener('mousedown', e => e.stopPropagation());
    el.appendChild(input);
  } else {
    if (field.value) {
      const img = document.createElement('img');
      img.src = field.value;
      img.className = 'sig-preview';
      el.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'sig-placeholder';
      ph.textContent = '✍ Click to sign';
      el.appendChild(ph);
    }
  }

  // Resize handle
  const resizer = document.createElement('div');
  resizer.className = 'resize-handle';
  el.appendChild(resizer);

  // Drag
  makeDraggable(el, field, resizer);

  // Select
  el.addEventListener('mousedown', e => {
    if (e.target.closest('.widget-ctrl-btn') || e.target === resizer) return;
    selectField(field.id);
  });

  fieldsOverlay.appendChild(el);
}

function selectField(id) {
  state.selectedFieldId = id;
  fieldsOverlay.querySelectorAll('.field-widget').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
  fieldList.querySelectorAll('.field-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
}

function deleteField(id) {
  state.fields = state.fields.filter(f => f.id !== id);
  const el = fieldsOverlay.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();
  if (state.selectedFieldId === id) state.selectedFieldId = null;
  renderFieldList();
}


// ── Drag & Resize ──────────────────────────────────────────────
function makeDraggable(el, field, resizer) {
  let dragging = false, resizing = false;
  let startX, startY, startLeft, startTop, startW, startH;

  el.addEventListener('mousedown', e => {
    if (e.target.closest('.widget-ctrl-btn') || e.target === resizer) return;
    if (e.target.tagName === 'INPUT') return;
    dragging = true;
    const rect = fieldsOverlay.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = (field.x_pct / 100) * fieldsOverlay.clientWidth;
    startTop  = (field.y_pct / 100) * fieldsOverlay.clientHeight;
    e.preventDefault();
  });

  resizer.addEventListener('mousedown', e => {
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = (field.w_pct / 100) * fieldsOverlay.clientWidth;
    startH = (field.h_pct / 100) * fieldsOverlay.clientHeight;
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging && !resizing) return;
    const ow = fieldsOverlay.clientWidth;
    const oh = fieldsOverlay.clientHeight;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (dragging) {
      const newLeft = Math.max(0, Math.min(startLeft + dx, ow - el.offsetWidth));
      const newTop  = Math.max(0, Math.min(startTop  + dy, oh - el.offsetHeight));
      field.x_pct = (newLeft / ow) * 100;
      field.y_pct = (newTop  / oh) * 100;
      el.style.left = field.x_pct + '%';
      el.style.top  = field.y_pct + '%';
    }

    if (resizing) {
      const newW = Math.max(40, startW + dx);
      const newH = Math.max(20, startH + dy);
      field.w_pct = (newW / ow) * 100;
      field.h_pct = (newH / oh) * 100;
      el.style.width  = field.w_pct + '%';
      el.style.height = field.h_pct + '%';
    }
  });

  document.addEventListener('mouseup', () => { dragging = false; resizing = false; });
}


// ── Field List (sidebar) ───────────────────────────────────────
function renderFieldList() {
  fieldCount.textContent = state.fields.length;
  fieldList.innerHTML = '';
  state.fields.forEach(f => {
    const li = document.createElement('li');
    li.className = 'field-item' + (state.selectedFieldId === f.id ? ' selected' : '');
    li.dataset.id = f.id;

    const icon = document.createElement('span');
    icon.className = 'field-icon';
    icon.textContent = f.type === 'text' ? '𝖳' : '✍';

    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = f.label;

    const pg = document.createElement('span');
    pg.className = 'field-page';
    pg.textContent = `p${f.page + 1}`;

    const del = document.createElement('button');
    del.className = 'field-delete';
    del.textContent = '✕';
    del.title = 'Delete field';
    del.addEventListener('click', e => { e.stopPropagation(); deleteField(f.id); });

    li.appendChild(icon);
    li.appendChild(label);
    li.appendChild(pg);
    li.appendChild(del);

    li.addEventListener('click', () => {
      if (f.page !== state.currentPage - 1) {
        loadPdfPage(f.page + 1).then(() => selectField(f.id));
      } else {
        selectField(f.id);
      }
    });

    fieldList.appendChild(li);
  });
}


// ── Signature Modal ────────────────────────────────────────────
let sigCtx, sigDrawing = false, sigHasContent = false;

function openSigModal(fieldId) {
  state.pendingSigFieldId = fieldId;
  sigModal.classList.remove('hidden');
  sigCtx = sigCanvas.getContext('2d');
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  sigCtx.strokeStyle = '#1a1a2e';
  sigCtx.lineWidth = 2.5;
  sigCtx.lineCap = 'round';
  sigCtx.lineJoin = 'round';
  sigHasContent = false;
}

function closeSigModalFn() {
  sigModal.classList.add('hidden');
  state.pendingSigFieldId = null;
}
closeSigModal.addEventListener('click', closeSigModalFn);

sigCanvas.addEventListener('mousedown', e => {
  sigDrawing = true;
  const r = sigCanvas.getBoundingClientRect();
  sigCtx.beginPath();
  sigCtx.moveTo(e.clientX - r.left, e.clientY - r.top);
});
sigCanvas.addEventListener('mousemove', e => {
  if (!sigDrawing) return;
  const r = sigCanvas.getBoundingClientRect();
  sigCtx.lineTo(e.clientX - r.left, e.clientY - r.top);
  sigCtx.stroke();
  sigHasContent = true;
});
sigCanvas.addEventListener('mouseup', () => { sigDrawing = false; });
sigCanvas.addEventListener('mouseleave', () => { sigDrawing = false; });

// Touch support for signature
sigCanvas.addEventListener('touchstart', e => {
  e.preventDefault();
  sigDrawing = true;
  const r = sigCanvas.getBoundingClientRect();
  const t = e.touches[0];
  sigCtx.beginPath();
  sigCtx.moveTo(t.clientX - r.left, t.clientY - r.top);
}, { passive: false });
sigCanvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!sigDrawing) return;
  const r = sigCanvas.getBoundingClientRect();
  const t = e.touches[0];
  sigCtx.lineTo(t.clientX - r.left, t.clientY - r.top);
  sigCtx.stroke();
  sigHasContent = true;
}, { passive: false });
sigCanvas.addEventListener('touchend', () => { sigDrawing = false; });

btnClearSig.addEventListener('click', () => {
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  sigHasContent = false;
});

btnSaveSig.addEventListener('click', () => {
  if (!sigHasContent) { notify('Please draw a signature first.', 'error'); return; }
  const dataUrl = sigCanvas.toDataURL('image/png');
  const field = state.fields.find(f => f.id === state.pendingSigFieldId);
  if (field) {
    field.value = dataUrl;
    // Update widget
    const widget = fieldsOverlay.querySelector(`[data-id="${field.id}"]`);
    if (widget) {
      const ph = widget.querySelector('.sig-placeholder');
      if (ph) ph.remove();
      let img = widget.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.className = 'sig-preview';
        widget.insertBefore(img, widget.querySelector('.resize-handle'));
      }
      img.src = dataUrl;
    }
    renderFieldList();
    notify('Signature saved!', 'success');
  }
  closeSigModalFn();
});


// ── Generate PDF ───────────────────────────────────────────────
btnGenerate.addEventListener('click', async () => {
  if (!state.pdfId) { notify('Upload a PDF first.', 'error'); return; }
  if (state.fields.length === 0) { notify('Add at least one field.', 'error'); return; }

  notifyLoading('Generating PDF…');
  btnGenerate.disabled = true;

  try {
    const res = await fetch(`/fill/${state.pdfId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: state.fields }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');

    downloadLink.href = `/download/${data.filename}`;
    downloadLink.download = data.filename;
    downloadArea.classList.remove('hidden');
    notify('PDF generated! Click below to download.', 'success', 5000);
  } catch (err) {
    notify(err.message, 'error');
  } finally {
    btnGenerate.disabled = false;
  }
});


// ── Save Template ──────────────────────────────────────────────
btnSaveTemplate.addEventListener('click', () => {
  if (!state.pdfId) { notify('Upload a PDF first.', 'error'); return; }
  templateName.value = '';
  saveTemplateModal.classList.remove('hidden');
  setTimeout(() => templateName.focus(), 50);
});
closeSaveTemplateModal.addEventListener('click', () => saveTemplateModal.classList.add('hidden'));
saveTemplateModal.addEventListener('click', e => { if (e.target === saveTemplateModal) saveTemplateModal.classList.add('hidden'); });

btnConfirmSaveTemplate.addEventListener('click', async () => {
  const name = templateName.value.trim() || 'Untitled Template';
  notifyLoading('Saving template…');
  try {
    const res = await fetch(`/save-template/${state.pdfId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, fields: state.fields }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    saveTemplateModal.classList.add('hidden');
    notify(`Template "${data.name}" saved!`, 'success');
  } catch (err) {
    notify(err.message, 'error');
  }
});


// ── Load Template ──────────────────────────────────────────────
btnLoadTemplate.addEventListener('click', async () => {
  if (!state.pdfId) { notify('Upload a PDF first.', 'error'); return; }
  loadTemplateModal.classList.remove('hidden');
  templateListWrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await fetch(`/templates/${state.pdfId}`);
    const templates = await res.json();
    if (templates.length === 0) {
      templateListWrap.innerHTML = '<p class="muted">No templates saved for this PDF yet.</p>';
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'template-list';
    templates.forEach(tpl => {
      const li = document.createElement('li');
      li.className = 'template-list-item';
      const info = document.createElement('div');
      info.innerHTML = `<div class="tpl-name">${esc(tpl.name)}</div>
                        <div class="tpl-date">${new Date(tpl.created_at).toLocaleDateString()}</div>`;
      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn btn-outline';
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', () => loadTemplate(tpl.id));
      li.appendChild(info);
      li.appendChild(loadBtn);
      ul.appendChild(li);
    });
    templateListWrap.innerHTML = '';
    templateListWrap.appendChild(ul);
  } catch (err) {
    templateListWrap.innerHTML = `<p class="muted" style="color:var(--danger)">Failed to load templates.</p>`;
  }
});
closeLoadTemplateModal.addEventListener('click', () => loadTemplateModal.classList.add('hidden'));
loadTemplateModal.addEventListener('click', e => { if (e.target === loadTemplateModal) loadTemplateModal.classList.add('hidden'); });

async function loadTemplate(tplId) {
  notifyLoading('Loading template…');
  try {
    const res = await fetch(`/template/${tplId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Load failed');
    state.fields = data.fields;
    renderOverlayFields();
    renderFieldList();
    loadTemplateModal.classList.add('hidden');
    notify(`Template "${data.name}" loaded!`, 'success');
  } catch (err) {
    notify(err.message, 'error');
  }
}


// ── Helpers ────────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[m]);
}


// ── PWA Service Worker ─────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .catch(err => console.warn('SW registration failed:', err));
  });
}
