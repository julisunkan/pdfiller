/* =============================================================
   PDF Form Filler — Frontend Logic
   ============================================================= */

// ── State ──────────────────────────────────────────────────────
const state = {
  mode: 'fill',          // 'fill' | 'create'
  pdfId: null,
  pdfDoc: null,          // PDF.js document
  currentPage: 1,
  totalPages: 1,
  scale: 1.5,
  fields: [],            // [{id, type, page, x_pct, y_pct, w_pct, h_pct, value/label/placeholder}]
  activeTool: null,      // 'text' | 'signature' | 'checkbox'
  selectedFieldId: null,
  pendingSigFieldId: null,
  pendingLabelFieldId: null,
  docName: 'fillable_form',
};

// ── DOM refs ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Mode tabs
const tabFill             = $('tabFill');
const tabCreate           = $('tabCreate');
const fillModePanel       = $('fillModePanel');
const createModePanel     = $('createModePanel');

// Upload (fill mode)
const dropZone            = $('dropZone');
const fileInput           = $('fileInput');
const uploadProgress      = $('uploadProgress');
const progressFill        = $('progressFill');
const progressLabel       = $('progressLabel');
const uploadedInfo        = $('uploadedInfo');
const uploadedName        = $('uploadedName');
const btnChangeFile       = $('btnChangeFile');

// Create mode
const pageSizeSelect      = $('pageSizeSelect');
const docNameInput        = $('docNameInput');
const btnNewBlank         = $('btnNewBlank');
const createFileInfo      = $('createFileInfo');
const createFileName      = $('createFileName');
const btnResetCreate      = $('btnResetCreate');

// Shared tools/fields/generate
const toolsSection        = $('toolsSection');
const fieldsSection       = $('fieldsSection');
const generateSection     = $('generateSection');
const headerActions       = $('headerActions');
const btnAddText          = $('btnAddText');
const btnAddSignature     = $('btnAddSignature');
const btnAddCheckbox      = $('btnAddCheckbox');
const toolHint            = $('toolHint');
const pageNav             = $('pageNav');
const pageLabel           = $('pageLabel');
const btnPrevPage         = $('btnPrevPage');
const btnNextPage         = $('btnNextPage');
const fieldList           = $('fieldList');
const fieldCount          = $('fieldCount');
const btnGenerate         = $('btnGenerate');
const btnCreateFillable   = $('btnCreateFillable');
const downloadArea        = $('downloadArea');
const downloadLink        = $('downloadLink');

// PDF viewer
const pdfPlaceholder      = $('pdfPlaceholder');
const pdfPlaceholderText  = $('pdfPlaceholderText');
const pdfViewerWrap       = $('pdfViewerWrap');
const pdfCanvas           = $('pdfCanvas');
const fieldsOverlay       = $('fieldsOverlay');
const pdfCanvasContainer  = $('pdfCanvasContainer');

// Notification
const notification        = $('notification');

// Sig modal
const sigModal            = $('sigModal');
const closeSigModal       = $('closeSigModal');
const sigCanvas           = $('sigCanvas');
const btnClearSig         = $('btnClearSig');
const btnSaveSig          = $('btnSaveSig');

// Save template modal
const saveTemplateModal       = $('saveTemplateModal');
const btnSaveTemplate         = $('btnSaveTemplate');
const closeSaveTemplateModal  = $('closeSaveTemplateModal');
const templateName            = $('templateName');
const btnConfirmSaveTemplate  = $('btnConfirmSaveTemplate');

// Load template modal
const loadTemplateModal       = $('loadTemplateModal');
const btnLoadTemplate         = $('btnLoadTemplate');
const closeLoadTemplateModal  = $('closeLoadTemplateModal');
const templateListWrap        = $('templateListWrap');

// Field label modal (create mode)
const fieldLabelModal         = $('fieldLabelModal');
const closeFieldLabelModal    = $('closeFieldLabelModal');
const fieldLabelInput         = $('fieldLabelInput');
const fieldPlaceholderInput   = $('fieldPlaceholderInput');
const btnConfirmFieldLabel    = $('btnConfirmFieldLabel');


// ── Notifications ──────────────────────────────────────────────
let notifTimer = null;
function notify(msg, type = 'info', duration = 3500) {
  notification.textContent = msg;
  notification.className = `notification ${type}`;
  notification.classList.remove('hidden');
  if (notifTimer) clearTimeout(notifTimer);
  if (duration > 0) notifTimer = setTimeout(() => notification.classList.add('hidden'), duration);
}
function notifyLoading(msg) { notify(msg, 'loading', 0); }
function notifyHide() { notification.classList.add('hidden'); }


// ── Mode Switching ─────────────────────────────────────────────
tabFill.addEventListener('click', () => switchMode('fill'));
tabCreate.addEventListener('click', () => switchMode('create'));

function switchMode(mode) {
  state.mode = mode;
  tabFill.classList.toggle('active', mode === 'fill');
  tabCreate.classList.toggle('active', mode === 'create');
  fillModePanel.classList.toggle('hidden', mode !== 'fill');
  createModePanel.classList.toggle('hidden', mode !== 'create');

  // Update placeholder text
  pdfPlaceholderText.textContent = mode === 'fill'
    ? 'Upload a PDF to get started'
    : 'Click "New Blank Document" to start designing your form';

  // Toggle tools visibility
  btnAddCheckbox.classList.toggle('hidden', mode !== 'create');
  btnGenerate.classList.toggle('hidden', mode !== 'fill');
  btnCreateFillable.classList.toggle('hidden', mode !== 'create');

  // Tool hint
  toolHint.textContent = mode === 'create'
    ? 'Click a tool, then click on the canvas to place a form field.'
    : 'Click a tool then click on the PDF to place the field.';

  // Reset if switching modes
  resetSession();
}

function resetSession() {
  state.pdfId = null;
  state.pdfDoc = null;
  state.fields = [];
  state.currentPage = 1;
  state.totalPages = 1;
  state.selectedFieldId = null;
  state.activeTool = null;

  fieldsOverlay.innerHTML = '';
  pdfPlaceholder.classList.remove('hidden');
  pdfViewerWrap.classList.add('hidden');
  toolsSection.classList.add('hidden');
  fieldsSection.classList.add('hidden');
  generateSection.classList.add('hidden');
  headerActions.classList.add('hidden');
  downloadArea.classList.add('hidden');
  pageNav.classList.add('hidden');
  renderFieldList();
  deactivateTools();
}


// ── File Upload (Fill Mode) ────────────────────────────────────
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
btnChangeFile.addEventListener('click', () => {
  uploadedInfo.classList.add('hidden');
  dropZone.classList.remove('hidden');
  fileInput.value = '';
  resetSession();
  fileInput.click();
});

async function handleFile(file) {
  if (!file.name.endsWith('.pdf')) { notify('Only PDF files are accepted.', 'error'); return; }
  if (file.size > 20 * 1024 * 1024) { notify('File exceeds 20 MB limit.', 'error'); return; }

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
      xhr.onload = () => xhr.status === 200
        ? resolve(JSON.parse(xhr.responseText))
        : reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed'));
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    });

    progressFill.style.width = '100%';
    uploadProgress.classList.add('hidden');
    uploadedInfo.classList.remove('hidden');
    uploadedName.textContent = result.original_name;

    state.pdfId = result.pdf_id;
    state.fields = [];
    state.currentPage = 1;
    state.totalPages = result.page_count;
    state.pdfDoc = null;

    showAppSections();
    await loadPdfPage(1);
    renderFieldList();
    notify(`Uploaded "${result.original_name}" — ${result.page_count} page(s)`, 'success');
  } catch (err) {
    uploadProgress.classList.add('hidden');
    notify(err.message, 'error');
  }
}


// ── New Blank Document (Create Mode) ──────────────────────────
btnNewBlank.addEventListener('click', createBlankDocument);
btnResetCreate.addEventListener('click', () => {
  createFileInfo.classList.add('hidden');
  resetSession();
});

async function createBlankDocument() {
  const pageSize = pageSizeSelect.value;
  state.docName = docNameInput.value.trim() || 'fillable_form';
  notifyLoading('Creating blank document…');
  btnNewBlank.disabled = true;
  try {
    const res = await fetch('/create-blank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: pageSize }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create blank document');

    state.pdfId = data.pdf_id;
    state.fields = [];
    state.currentPage = 1;
    state.totalPages = 1;
    state.pdfDoc = null;

    createFileName.textContent = state.docName || 'Blank Form';
    createFileInfo.classList.remove('hidden');

    showAppSections();
    await loadPdfPage(1);
    renderFieldList();
    notifyHide();
    notify('Blank document ready — start adding fields!', 'success');
  } catch (err) {
    notify(err.message, 'error');
  } finally {
    btnNewBlank.disabled = false;
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
  // Show/hide correct generate button
  btnGenerate.classList.toggle('hidden', state.mode !== 'fill');
  btnCreateFillable.classList.toggle('hidden', state.mode !== 'create');
}


// ── PDF.js Rendering ───────────────────────────────────────────
async function loadPdfPage(pageNum) {
  if (!state.pdfId) return;
  notifyLoading('Rendering page…');
  try {
    if (!state.pdfDoc) {
      state.pdfDoc = await pdfjsLib.getDocument(`/pdf/${state.pdfId}`).promise;
    }
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: state.scale });

    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;

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

btnPrevPage.addEventListener('click', () => { if (state.currentPage > 1) loadPdfPage(state.currentPage - 1); });
btnNextPage.addEventListener('click', () => { if (state.currentPage < state.totalPages) loadPdfPage(state.currentPage + 1); });


// ── Tool Selection ─────────────────────────────────────────────
btnAddText.addEventListener('click', () => setActiveTool('text'));
btnAddSignature.addEventListener('click', () => setActiveTool('signature'));
btnAddCheckbox.addEventListener('click', () => setActiveTool('checkbox'));

function setActiveTool(tool) {
  if (state.activeTool === tool) {
    deactivateTools();
  } else {
    state.activeTool = tool;
    btnAddText.classList.toggle('active', tool === 'text');
    btnAddSignature.classList.toggle('active', tool === 'signature');
    btnAddCheckbox.classList.toggle('active', tool === 'checkbox');
    pdfCanvasContainer.style.cursor = 'crosshair';
  }
}

function deactivateTools() {
  state.activeTool = null;
  btnAddText.classList.remove('active');
  btnAddSignature.classList.remove('active');
  btnAddCheckbox.classList.remove('active');
  pdfCanvasContainer.style.cursor = 'default';
}


// ── Place Field on Click ───────────────────────────────────────
pdfCanvasContainer.addEventListener('click', e => {
  if (!state.activeTool) return;
  if (e.target.closest('.field-widget')) return;

  const rect = pdfCanvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const x_pct = (cx / pdfCanvas.width) * 100;
  const y_pct = (cy / pdfCanvas.height) * 100;

  const ftype = state.activeTool;
  const textCount = state.fields.filter(f => f.type === 'text').length;
  const sigCount  = state.fields.filter(f => f.type === 'signature').length;
  const cbCount   = state.fields.filter(f => f.type === 'checkbox').length;

  const defaultLabel = ftype === 'text'      ? `Text Field ${textCount + 1}`
                     : ftype === 'signature' ? `Signature ${sigCount + 1}`
                     :                         `Checkbox ${cbCount + 1}`;

  const field = {
    id: 'f_' + Date.now(),
    type: ftype,
    page: state.currentPage - 1,
    x_pct,
    y_pct,
    w_pct: ftype === 'checkbox' ? 30 : ftype === 'signature' ? 20 : 25,
    h_pct: ftype === 'checkbox' ? 5  : ftype === 'signature' ? 8  : 5,
    value: '',
    label: defaultLabel,
    placeholder: '',
  };

  state.fields.push(field);
  addFieldWidget(field);
  renderFieldList();
  deactivateTools();

  if (ftype === 'signature' && state.mode === 'fill') {
    openSigModal(field.id);
  } else if (state.mode === 'create') {
    openFieldLabelModal(field.id);
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

  if (state.mode === 'create') {
    const editBtn = document.createElement('button');
    editBtn.className = 'widget-ctrl-btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Edit field properties';
    editBtn.addEventListener('click', e => { e.stopPropagation(); openFieldLabelModal(field.id); });
    controls.appendChild(editBtn);
  } else if (field.type === 'signature') {
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

  if (state.mode === 'create') {
    // Show field design preview (label + placeholder)
    if (field.type === 'checkbox') {
      el.classList.add('checkbox-widget');
      const box = document.createElement('div');
      box.className = 'checkbox-box';
      const lbl = document.createElement('span');
      lbl.className = 'create-label';
      lbl.textContent = field.placeholder || field.label;
      el.appendChild(box);
      el.appendChild(lbl);
    } else {
      el.classList.add('create-text-widget');
      const badge = document.createElement('span');
      badge.className = 'field-type-badge';
      badge.textContent = field.type === 'signature' ? 'sig' : 'text';
      const lbl = document.createElement('span');
      lbl.className = 'create-label';
      lbl.textContent = field.label;
      const ph = document.createElement('span');
      ph.className = 'create-placeholder';
      ph.textContent = field.placeholder || 'No placeholder set';
      el.appendChild(badge);
      el.appendChild(lbl);
      el.appendChild(ph);
    }
  } else {
    // Fill mode content
    if (field.type === 'text') {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = field.value;
      input.placeholder = 'Type here…';
      input.addEventListener('input', () => { field.value = input.value; });
      input.addEventListener('mousedown', e => e.stopPropagation());
      el.appendChild(input);
    } else if (field.type === 'signature') {
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
  }

  // Resize handle
  const resizer = document.createElement('div');
  resizer.className = 'resize-handle';
  el.appendChild(resizer);

  makeDraggable(el, field, resizer);

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
  fieldsOverlay.querySelector(`[data-id="${id}"]`)?.remove();
  if (state.selectedFieldId === id) state.selectedFieldId = null;
  renderFieldList();
}

function refreshWidget(field) {
  const existing = fieldsOverlay.querySelector(`[data-id="${field.id}"]`);
  if (existing) existing.remove();
  addFieldWidget(field);
}


// ── Drag & Resize ──────────────────────────────────────────────
function makeDraggable(el, field, resizer) {
  let dragging = false, resizing = false;
  let startX, startY, startLeft, startTop, startW, startH;

  el.addEventListener('mousedown', e => {
    if (e.target.closest('.widget-ctrl-btn') || e.target === resizer) return;
    if (e.target.tagName === 'INPUT') return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = (field.x_pct / 100) * fieldsOverlay.clientWidth;
    startTop  = (field.y_pct / 100) * fieldsOverlay.clientHeight;
    e.preventDefault();
  });

  resizer.addEventListener('mousedown', e => {
    resizing = true;
    startX = e.clientX; startY = e.clientY;
    startW = (field.w_pct / 100) * fieldsOverlay.clientWidth;
    startH = (field.h_pct / 100) * fieldsOverlay.clientHeight;
    e.preventDefault(); e.stopPropagation();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging && !resizing) return;
    const ow = fieldsOverlay.clientWidth, oh = fieldsOverlay.clientHeight;
    const dx = e.clientX - startX, dy = e.clientY - startY;

    if (dragging) {
      const newLeft = Math.max(0, Math.min(startLeft + dx, ow - el.offsetWidth));
      const newTop  = Math.max(0, Math.min(startTop  + dy, oh - el.offsetHeight));
      field.x_pct = (newLeft / ow) * 100;
      field.y_pct = (newTop  / oh) * 100;
      el.style.left = field.x_pct + '%';
      el.style.top  = field.y_pct + '%';
    }
    if (resizing) {
      field.w_pct = (Math.max(40, startW + dx) / ow) * 100;
      field.h_pct = (Math.max(20, startH + dy) / oh) * 100;
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
    icon.textContent = f.type === 'text' ? '𝖳' : f.type === 'checkbox' ? '☑' : '✍';

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

    li.appendChild(icon); li.appendChild(label); li.appendChild(pg); li.appendChild(del);
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

closeSigModal.addEventListener('click', () => { sigModal.classList.add('hidden'); state.pendingSigFieldId = null; });
sigCanvas.addEventListener('mousedown', e => {
  sigDrawing = true;
  const r = sigCanvas.getBoundingClientRect();
  sigCtx.beginPath(); sigCtx.moveTo(e.clientX - r.left, e.clientY - r.top);
});
sigCanvas.addEventListener('mousemove', e => {
  if (!sigDrawing) return;
  const r = sigCanvas.getBoundingClientRect();
  sigCtx.lineTo(e.clientX - r.left, e.clientY - r.top);
  sigCtx.stroke(); sigHasContent = true;
});
sigCanvas.addEventListener('mouseup', () => { sigDrawing = false; });
sigCanvas.addEventListener('mouseleave', () => { sigDrawing = false; });
sigCanvas.addEventListener('touchstart', e => {
  e.preventDefault(); sigDrawing = true;
  const r = sigCanvas.getBoundingClientRect(), t = e.touches[0];
  sigCtx.beginPath(); sigCtx.moveTo(t.clientX - r.left, t.clientY - r.top);
}, { passive: false });
sigCanvas.addEventListener('touchmove', e => {
  e.preventDefault(); if (!sigDrawing) return;
  const r = sigCanvas.getBoundingClientRect(), t = e.touches[0];
  sigCtx.lineTo(t.clientX - r.left, t.clientY - r.top);
  sigCtx.stroke(); sigHasContent = true;
}, { passive: false });
sigCanvas.addEventListener('touchend', () => { sigDrawing = false; });
btnClearSig.addEventListener('click', () => { sigCtx.clearRect(0,0,sigCanvas.width,sigCanvas.height); sigHasContent=false; });

btnSaveSig.addEventListener('click', () => {
  if (!sigHasContent) { notify('Please draw a signature first.', 'error'); return; }
  const dataUrl = sigCanvas.toDataURL('image/png');
  const field = state.fields.find(f => f.id === state.pendingSigFieldId);
  if (field) {
    field.value = dataUrl;
    const widget = fieldsOverlay.querySelector(`[data-id="${field.id}"]`);
    if (widget) {
      widget.querySelector('.sig-placeholder')?.remove();
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
  sigModal.classList.add('hidden');
  state.pendingSigFieldId = null;
});


// ── Field Label Modal (Create Mode) ───────────────────────────
function openFieldLabelModal(fieldId) {
  state.pendingLabelFieldId = fieldId;
  const field = state.fields.find(f => f.id === fieldId);
  fieldLabelInput.value = field ? field.label : '';
  fieldPlaceholderInput.value = field ? field.placeholder : '';
  fieldLabelModal.classList.remove('hidden');
  setTimeout(() => fieldLabelInput.focus(), 50);
}

closeFieldLabelModal.addEventListener('click', () => { fieldLabelModal.classList.add('hidden'); state.pendingLabelFieldId = null; });
fieldLabelModal.addEventListener('click', e => { if (e.target === fieldLabelModal) { fieldLabelModal.classList.add('hidden'); state.pendingLabelFieldId = null; } });

btnConfirmFieldLabel.addEventListener('click', () => {
  const field = state.fields.find(f => f.id === state.pendingLabelFieldId);
  if (field) {
    field.label = fieldLabelInput.value.trim() || field.label;
    field.placeholder = fieldPlaceholderInput.value.trim();
    refreshWidget(field);
    renderFieldList();
    notify('Field properties updated.', 'success');
  }
  fieldLabelModal.classList.add('hidden');
  state.pendingLabelFieldId = null;
});

// Allow Enter key to confirm
[fieldLabelInput, fieldPlaceholderInput].forEach(inp => {
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') btnConfirmFieldLabel.click(); });
});


// ── Generate Filled PDF (Fill Mode) ───────────────────────────
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


// ── Create Fillable PDF (Create Mode) ─────────────────────────
btnCreateFillable.addEventListener('click', async () => {
  if (!state.pdfId) { notify('Create a blank document first.', 'error'); return; }
  if (state.fields.length === 0) { notify('Add at least one field to the form.', 'error'); return; }
  notifyLoading('Creating fillable PDF…');
  btnCreateFillable.disabled = true;
  try {
    const docName = docNameInput.value.trim() || state.docName || 'fillable_form';
    const res = await fetch(`/create-fillable/${state.pdfId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: state.fields, doc_name: docName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Creation failed');
    downloadLink.href = `/download/${data.filename}`;
    downloadLink.download = data.filename;
    downloadArea.classList.remove('hidden');
    notify('Fillable PDF created! Click below to download.', 'success', 5000);
  } catch (err) {
    notify(err.message, 'error');
  } finally {
    btnCreateFillable.disabled = false;
  }
});


// ── Save Template ──────────────────────────────────────────────
btnSaveTemplate.addEventListener('click', () => {
  if (!state.pdfId) { notify('No document loaded.', 'error'); return; }
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
  if (!state.pdfId) { notify('No document loaded.', 'error'); return; }
  loadTemplateModal.classList.remove('hidden');
  templateListWrap.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await fetch(`/templates/${state.pdfId}`);
    const templates = await res.json();
    if (templates.length === 0) {
      templateListWrap.innerHTML = '<p class="muted">No templates saved for this document yet.</p>';
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'template-list';
    templates.forEach(tpl => {
      const li = document.createElement('li');
      li.className = 'template-list-item';
      li.innerHTML = `<div><div class="tpl-name">${esc(tpl.name)}</div><div class="tpl-date">${new Date(tpl.created_at).toLocaleDateString()}</div></div>`;
      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn btn-outline';
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', () => loadTemplate(tpl.id));
      li.appendChild(loadBtn);
      ul.appendChild(li);
    });
    templateListWrap.innerHTML = '';
    templateListWrap.appendChild(ul);
  } catch {
    templateListWrap.innerHTML = '<p class="muted" style="color:var(--danger)">Failed to load templates.</p>';
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
  return String(str).replace(/[&<>"']/g, m =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
}

// ── PWA Service Worker ─────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .catch(err => console.warn('SW registration failed:', err));
  });
}
