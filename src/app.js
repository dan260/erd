'use strict';

const STORAGE_KEY = 'erdraft.schema.v1';
const LANGUAGE_KEY = 'erdraft.language.v1';
function buildExample() {
  return `${I18N.t('example.blog')}
${I18N.t('example.cardinality')}

entity User {
  id: int
  name: string
  email
  posts: Post[1:n]
}

entity Post {
  id: int
  title: string
  body: text
  published_at: datetime
  author: User[n:1]
  comments: Comment[1:n]
  tags: Tag[n:n]
}

entity Comment {
  id: int
  body: string
  created_at: datetime
  author: User[n:1?]
  post: Post[n:1]
}

entity Tag {
  id: int
  name: string
  posts: Post[n:n]
}

entity Notification {
  id: int
  created_at: datetime
  ${I18N.t('example.relation')}
  rel User[1:n]
}
`;
}

const source = document.querySelector('#source');
const codeHighlight = document.querySelector('#codeHighlight');
const lineNumbers = document.querySelector('#lineNumbers');
const statusElement = document.querySelector('#status');
const statusText = document.querySelector('#statusText');
const diagnostics = document.querySelector('#diagnostics');
const diagnosticsCount = document.querySelector('#diagnosticsCount');
const diagnosticsList = document.querySelector('#diagnosticsList');
const saveStatus = document.querySelector('#saveStatus');
const exportButton = document.querySelector('#exportButton');
const exportPngButton = document.querySelector('#exportPngButton');
const helpButton = document.querySelector('#helpButton');
const syntaxDialog = document.querySelector('#syntaxDialog');
const syntaxExampleCode = document.querySelector('#syntaxExampleCode');
const diagram = document.querySelector('#diagram');
const diagramViewport = document.querySelector('#diagramViewport');
const canvasEmpty = document.querySelector('#canvasEmpty');
const emptyTitle = document.querySelector('#emptyTitle');
const emptyText = document.querySelector('#emptyText');
const exampleButton = document.querySelector('#exampleButton');
const canvasStale = document.querySelector('#canvasStale');
const zoomInButton = document.querySelector('#zoomInButton');
const zoomOutButton = document.querySelector('#zoomOutButton');
const fitButton = document.querySelector('#fitButton');
const toast = document.querySelector('#toast');
const languageSelect = document.querySelector('#languageSelect');
const themeSelect = document.querySelector('#themeSelect');
const saveFileButton = document.querySelector('#saveFileButton');
const openFileButton = document.querySelector('#openFileButton');
const importSQLButton = document.querySelector('#importSQLButton');
const settingsButton = document.querySelector('#settingsButton');
const settingsPopover = document.querySelector('#settingsPopover');

const SCHEMA_FILENAME = 'erdraft-schema.erdraft';
const MAX_FILE_SIZE = 1_000_000;
const NODE_CLICK_DRAG_MAX = 4;

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.erdraft,.txt,text/plain';
fileInput.hidden = true;
document.body.appendChild(fileInput);

const sqlInput = document.createElement('input');
sqlInput.type = 'file';
sqlInput.accept = '.sql,text/plain';
sqlInput.hidden = true;
document.body.appendChild(sqlInput);

let currentDiagram = null;
let view = null;
let autoFit = true;
let errorLines = new Set();
let parseTimer = null;
let saveTimer = null;
let toastTimer = null;
let dragState = null;
let editorFocus = null;
let canvasClickCaretLine = null;

function entityCount(value) {
  return I18N.plural(value, 'entities');
}

function relationCount(value) {
  return I18N.plural(value, 'relations');
}

function errorCount(value) {
  return I18N.plural(value, 'errors');
}

function setStatus(kind, text) {
  statusElement.className = `status is-${kind}`;
  statusText.textContent = text;
}

function readSavedSource() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? buildExample() : stored;
  } catch {
    return buildExample();
  }
}

function readSavedLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (stored === 'en' || stored === 'ru') return stored;
  } catch {
    // localStorage unavailable
  }
  return 'en';
}

function saveLanguage(next) {
  try {
    localStorage.setItem(LANGUAGE_KEY, next);
  } catch {
    // localStorage unavailable
  }
}

function applyLanguage() {
  const language = I18N.getLanguage();
  document.documentElement.lang = language;
  document.title = I18N.t('title');
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', I18N.t('meta.description'));
  languageSelect.value = language;

  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = I18N.t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-html]')) {
    element.innerHTML = I18N.t(element.dataset.i18nHtml);
  }
  for (const element of document.querySelectorAll('[data-i18n-aria]')) {
    element.setAttribute('aria-label', I18N.t(element.dataset.i18nAria));
  }
  for (const element of document.querySelectorAll('[data-i18n-title]')) {
    element.setAttribute('title', I18N.t(element.dataset.i18nTitle));
  }
  highlightSyntaxExample();
  setSaveStatus(I18N.t('editor.save.initial'), false);
}

function highlightSyntaxExample() {
  if (!syntaxExampleCode) return;
  syntaxExampleCode.innerHTML = highlightSchema(syntaxExampleCode.textContent);
}

function handleLanguageChange() {
  I18N.setLanguage(languageSelect.value);
  languageSelect.value = I18N.getLanguage();
  saveLanguage(I18N.getLanguage());
  applyLanguage();
  parseAndRender();
}

function scheduleSave() {
  setSaveStatus(I18N.t('editor.save.saving'), true);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, source.value);
      setSaveStatus(I18N.t('editor.save.saved'), false);
    } catch {
      setSaveStatus(I18N.t('editor.save.unavailable'), false);
    }
  }, 320);
}

function setSaveStatus(text, saving) {
  saveStatus.textContent = text;
  saveStatus.classList.toggle('is-saving', Boolean(saving));
}

function updateHighlight() {
  if (!codeHighlight) return;
  const value = source.value;
  codeHighlight.innerHTML = highlightSchema(value);
  codeHighlight.scrollTop = source.scrollTop;
  codeHighlight.scrollLeft = source.scrollLeft;
}

function updateGutter() {
  const lineCount = source.value.split('\n').length;
  const digits = String(lineCount).length;
  lineNumbers.style.width = `${Math.max(47, 23 + digits * 6.3)}px`;

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < lineCount; index += 1) {
    const line = document.createElement('span');
    line.className = 'line-number';
    if (errorLines.has(index + 1)) line.classList.add('has-error');
    line.textContent = String(index + 1);
    fragment.appendChild(line);
  }

  lineNumbers.replaceChildren(fragment);
  lineNumbers.scrollTop = source.scrollTop;
  updateHighlight();
}

function focusLine(lineNumber) {
  const lines = source.value.split('\n');
  const targetLine = Math.max(1, Math.min(lines.length, lineNumber));
  let offset = 0;

  for (let index = 0; index < targetLine - 1; index += 1) {
    offset += lines[index].length + 1;
  }

  source.focus();
  source.setSelectionRange(offset, offset + lines[targetLine - 1].length);

  const lineHeight = Number.parseFloat(getComputedStyle(source).lineHeight) || 24;
  source.scrollTop = Math.max(0, (targetLine - 4) * lineHeight);
  lineNumbers.scrollTop = source.scrollTop;
  if (codeHighlight) codeHighlight.scrollTop = source.scrollTop;
}

function caretLine() {
  const offset = source.selectionStart ?? 0;
  return source.value.slice(0, offset).split('\n').length;
}

function findEntityAtLine(line, entities, lineCount) {
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index];
    if (line < entity.line) break;

    const nextStart =
      index + 1 < entities.length
        ? entities[index + 1].line
        : lineCount + 1;
    const end = Math.max(
      entity.line,
      Math.min(entity.closeLine ?? nextStart - 1, nextStart - 1, lineCount),
    );

    if (line <= end) return entity.name;
  }

  return null;
}

function applyHighlight() {
  currentDiagram?.highlight?.(editorFocus);
}

function updateEditorHighlight() {
  if (!currentDiagram) return;

  const lineCount = source.value.split('\n').length;
  editorFocus = findEntityAtLine(
    caretLine(),
    currentDiagram.entities,
    lineCount,
  );
  applyHighlight();
}

function selectNode(name) {
  if (!name) {
    editorFocus = null;
    canvasClickCaretLine = caretLine();
    applyHighlight();
    return;
  }

  const entity = currentDiagram?.entities.find(
    (item) => item.name === name,
  );
  if (!entity?.line) return;

  focusLine(entity.line);
  canvasClickCaretLine = caretLine();
  updateEditorHighlight();
}

function showEmpty(title, text, withExample) {
  canvasEmpty.hidden = false;
  emptyTitle.textContent = title;
  emptyText.textContent = text;
  exampleButton.hidden = !withExample;
}

function setExportEnabled(enabled, title) {
  exportButton.disabled = !enabled;
  exportButton.title = enabled ? I18N.t('export.title.ready') : title;
  exportPngButton.disabled = !enabled;
  exportPngButton.title = enabled ? I18N.t('export.title.readyPng') : title;
}

function renderDiagnostics(errors) {
  diagnostics.hidden = errors.length === 0;
  diagnosticsList.replaceChildren();

  if (errors.length === 0) {
    diagnosticsCount.textContent = '';
    return;
  }

  diagnosticsCount.textContent = errorCount(errors.length);

  for (const error of errors) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const lineLabel = document.createElement('span');
    const message = document.createElement('span');

    button.type = 'button';
    button.className = 'diagnostic';
    lineLabel.className = 'diagnostic-line';
    lineLabel.textContent = I18N.t('diagnostic.line', {
      line: error.line,
    });
    message.textContent = error.message;

    button.append(lineLabel, message);
    button.addEventListener('click', () => focusLine(error.line));
    item.appendChild(button);
    diagnosticsList.appendChild(item);
  }
}

function applyView() {
  if (!view) return;
  diagram.setAttribute(
    'viewBox',
    `${view.x} ${view.y} ${view.w} ${view.h}`,
  );
}

function fitView() {
  if (!currentDiagram) return;

  const rect = diagramViewport.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const bounds = currentDiagram.renderBounds;
  const aspect = rect.width / rect.height;
  let width = bounds.width;
  let height = bounds.height;

  if (width / height > aspect) {
    height = width / aspect;
  } else {
    width = height * aspect;
  }

  view = {
    x: (bounds.width - width) / 2,
    y: (bounds.height - height) / 2,
    w: width,
    h: height,
  };
  autoFit = true;
  applyView();
}

function pointerToSvg(clientX, clientY) {
  const matrix = diagram.getScreenCTM();
  if (!matrix) return null;

  const point = diagram.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(matrix.inverse());
}

function zoomAt(factor, anchor) {
  if (!view && currentDiagram) fitView();
  if (!view) return;

  const target = anchor || {
    x: view.x + view.w / 2,
    y: view.y + view.h / 2,
  };
  const newWidth = Math.max(70, Math.min(40000, view.w / factor));
  const actualFactor = newWidth / view.w;
  const newHeight = view.h * actualFactor;

  view = {
    x: target.x - (target.x - view.x) * actualFactor,
    y: target.y - (target.y - view.y) * actualFactor,
    w: newWidth,
    h: newHeight,
  };
  autoFit = false;
  applyView();
}

function zoomBy(factor) {
  if (!currentDiagram) return;
  zoomAt(factor);
}

function updateZoomControls() {
  const disabled = !currentDiagram;
  zoomInButton.disabled = disabled;
  zoomOutButton.disabled = disabled;
  fitButton.disabled = disabled;
}

function clearDiagram() {
  currentDiagram = null;
  view = null;
  autoFit = true;
  diagram.replaceChildren();
  diagram.removeAttribute('viewBox');
  updateZoomControls();
}

function parseAndRender() {
  window.clearTimeout(parseTimer);
  parseTimer = null;

  const parsed = parseSchema(source.value);
  errorLines = new Set(parsed.errors.map((error) => error.line));
  updateGutter();
  renderDiagnostics(parsed.errors);

  if (parsed.errors.length > 0) {
    setStatus('error', errorCount(parsed.errors.length));
    setExportEnabled(false, I18N.t('export.title.invalid'));

    editorFocus = null;
    currentDiagram?.highlight?.(null);

    if (currentDiagram) {
      canvasStale.hidden = false;
      canvasEmpty.hidden = true;
    } else {
      showEmpty(
        I18N.t('canvas.error.title'),
        I18N.t('canvas.error.text'),
        false,
      );
      canvasStale.hidden = true;
    }
    updateZoomControls();
    return;
  }

  if (parsed.entities.length === 0) {
    clearDiagram();
    renderDiagnostics([]);
    setStatus('empty', I18N.t('status.empty'));
    setExportEnabled(false, I18N.t('export.title.empty'));
    canvasStale.hidden = true;
    editorFocus = null;
    showEmpty(
      I18N.t('canvas.now.title'),
      I18N.t('canvas.now.text'),
      true,
    );
    return;
  }

  const measured = measureEntities(parsed.entities);
  const layout = layoutDiagram(measured, parsed.relations, {
    ...ERDRAFT_SETTINGS,
    labelWidths: measureLabelWidths(parsed.relations),
  });
  const rendered = renderDiagram(diagram, layout, parsed.relations);

  currentDiagram = {
    layout,
    entities: parsed.entities,
    relations: parsed.relations,
    renderBounds: rendered,
    highlight: rendered.highlight,
  };

  canvasEmpty.hidden = true;
  canvasStale.hidden = true;
  setStatus(
    'ok',
    `${entityCount(parsed.entities.length)} · ${relationCount(parsed.relations.length)}`,
  );
  setExportEnabled(true);
  updateZoomControls();

  updateEditorHighlight();

  if (autoFit) {
    fitView();
  } else if (view) {
    applyView();
  }
}

function handleInput() {
  updateGutter();
  scheduleSave();
  updateEditorHighlight();
  window.clearTimeout(parseTimer);
  parseTimer = window.setTimeout(parseAndRender, 140);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 2400);
}

function handleExport() {
  if (parseTimer !== null) parseAndRender();

  if (!currentDiagram || exportButton.disabled) {
    showToast(I18N.t('toast.notReady'));
    return;
  }

  const xml = buildDrawioFile(
    currentDiagram.layout,
    currentDiagram.entities,
    currentDiagram.relations,
  );
  const blob = new Blob([xml], {
    type: 'application/xml;charset=utf-8',
  });
  downloadBlob(blob, 'erdraft-diagram.drawio');
  showToast(I18N.t('toast.exported'));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleExportPng() {
  if (parseTimer !== null) parseAndRender();

  if (!currentDiagram || exportPngButton.disabled) {
    showToast(I18N.t('toast.notReady'));
    return;
  }

  const bounds = currentDiagram.renderBounds;
  try {
    const blob = await exportDiagramPng(
      diagram,
      bounds.width,
      bounds.height,
    );
    downloadBlob(blob, 'erdraft-diagram.png');
    showToast(I18N.t('toast.pngExported'));
  } catch (error) {
    console.warn('PNG export failed', error);
    showToast(I18N.t('toast.pngFailed'));
  }
}

function handleSaveFile() {
  const blob = new Blob([source.value], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = SCHEMA_FILENAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(I18N.t('file.saved', { name: SCHEMA_FILENAME }));
}

function handleOpenFile() {
  fileInput.value = '';
  fileInput.click();
}

function handleFileSelected() {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  const reset = () => {
    fileInput.value = '';
  };

  if (file.size > MAX_FILE_SIZE) {
    showToast(I18N.t('file.tooLarge'));
    reset();
    return;
  }

  file
    .text()
    .then((text) => {
      if (text.includes('\u0000')) {
        showToast(I18N.t('file.loadError'));
        return;
      }

      source.value = text;
      source.scrollTop = 0;
      source.focus();
      source.setSelectionRange(0, 0);
      source.dispatchEvent(new Event('input', { bubbles: true }));
      showToast(I18N.t('file.loaded', { name: file.name }));
    })
    .catch(() => {
      showToast(I18N.t('file.loadError'));
    })
    .finally(reset);
}

function handleImportSQL() {
  sqlInput.value = '';
  sqlInput.click();
}

function handleSQLFileSelected() {
  const file = sqlInput.files && sqlInput.files[0];
  if (!file) return;

  const reset = () => {
    sqlInput.value = '';
  };

  if (file.size > MAX_FILE_SIZE) {
    showToast(I18N.t('file.tooLarge'));
    reset();
    return;
  }

  file
    .text()
    .then((text) => {
      if (text.includes('\u0000')) {
        showToast(I18N.t('file.loadError'));
        return;
      }

      // Compile the DDL into ERDraft. The resulting text is what the editor
      // holds: edit it like any other schema and keep the generated relations.
      const schema = sqlToErdraft(text);
      if (!schema) {
        showToast(I18N.t('file.noSQL'));
        return;
      }

      source.value = schema;
      source.scrollTop = 0;
      source.focus();
      source.setSelectionRange(0, 0);
      source.dispatchEvent(new Event('input', { bubbles: true }));
      showToast(I18N.t('file.imported', { name: file.name }));
    })
    .catch(() => {
      showToast(I18N.t('file.loadError'));
    })
    .finally(reset);
}

function handlePointerDown(event) {
  if (event.button !== 0) return;
  if (!event.target.closest('.diagram-svg')) return;
  if (!currentDiagram || !view) return;

  const node = event.target.closest('.erd-node');
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    view: { ...view },
    entity: node ? node.dataset.entity : null,
  };

  diagramViewport.classList.add('is-panning');
  diagramViewport.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function handlePointerMove(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  const matrix = diagram.getScreenCTM();
  if (!matrix) return;

  const scaleX = Math.abs(matrix.a) || 1;
  const scaleY = Math.abs(matrix.d) || 1;
  const deltaX = (event.clientX - dragState.startX) / scaleX;
  const deltaY = (event.clientY - dragState.startY) / scaleY;

  view = {
    ...dragState.view,
    x: dragState.view.x - deltaX,
    y: dragState.view.y - deltaY,
  };
  autoFit = false;
  applyView();
}

function handlePointerUp(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  const wasClick = Math.hypot(dx, dy) <= NODE_CLICK_DRAG_MAX;
  const entity = dragState.entity;

  dragState = null;
  diagramViewport.classList.remove('is-panning');
  if (diagramViewport.hasPointerCapture(event.pointerId)) {
    diagramViewport.releasePointerCapture(event.pointerId);
  }

  if (wasClick && event.type === 'pointerup') {
    selectNode(entity);
  }
}

function handleWheel(event) {
  if (!currentDiagram) return;
  event.preventDefault();

  const anchor = pointerToSvg(event.clientX, event.clientY);
  const factor = Math.exp(-event.deltaY * 0.00135);
  zoomAt(Math.max(0.82, Math.min(1.22, factor)), anchor);
}

function handleExample() {
  source.value = buildExample();
  source.scrollTop = 0;
  errorLines = new Set();
  updateGutter();
  parseAndRender();
  autoFit = true;
  fitView();
  scheduleSave();
  showToast(I18N.t('toast.example'));
}

const BRACKET_PAIRS = new Map([
  ['{', '}'],
  ['[', ']'],
]);
const BRACKET_OPENERS = new Map([['}', '{'], [']', '[']]);
const INDENT = '  ';

function handleBracketInput(event) {
  const opener = event.key;
  const closer = BRACKET_PAIRS.get(opener);
  if (!closer) return;

  const value = source.value;
  const start = source.selectionStart ?? 0;
  const end = source.selectionEnd ?? 0;

  event.preventDefault();

  if (start === end && value[start] === closer && value[start - 1] === opener) {
    source.setSelectionRange(start + 1, start + 1);
    return;
  }

  source.setRangeText(opener + closer, start, end, 'end');
  source.setSelectionRange(start + 1, start + 1);
  source.dispatchEvent(new Event('input', { bubbles: true }));
}

function handleBracketComplete(event) {
  const closer = event.key;
  const opener = BRACKET_OPENERS.get(closer);
  if (!opener) return;

  const value = source.value;
  const start = source.selectionStart ?? 0;
  const end = source.selectionEnd ?? 0;

  if (start !== end) return;
  if (value[start] !== closer || value[start - 1] !== opener) return;

  event.preventDefault();
  source.setSelectionRange(start + 1, start + 1);
}

function outdentLine(line) {
  const spaces = line.match(/^ {1,2}/u);
  if (spaces) return line.slice(spaces[0].length);
  if (line.startsWith('\t')) return line.slice(1);
  return line;
}

function indentOrOutdent(outdent) {
  const value = source.value;
  const start = source.selectionStart ?? 0;
  const end = source.selectionEnd ?? 0;

  if (!value.slice(start, end).includes('\n')) {
    if (outdent) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const line = value.slice(lineStart);
      const cut = line.length - outdentLine(line).length;
      if (!cut) return false;
      source.setRangeText('', lineStart, lineStart + cut, 'start');
      source.setSelectionRange(
        Math.max(start - cut, lineStart),
        Math.max(end - cut, lineStart),
      );
      return true;
    }

    source.setRangeText(INDENT, start, end, 'end');
    return true;
  }

  const blockStart = value.lastIndexOf('\n', start - 1) + 1;
  let blockEnd = value.indexOf('\n', end);
  if (blockEnd === -1) blockEnd = value.length;

  const lines = value.slice(blockStart, blockEnd).split('\n');
  const newLines = lines.map((line) =>
    outdent ? outdentLine(line) : INDENT + line,
  );
  if (newLines.every((line, index) => line === lines[index])) {
    return false;
  }

  source.setRangeText(newLines.join('\n'), blockStart, blockEnd, 'select');
  return true;
}

source.addEventListener('input', handleInput);
source.addEventListener('click', updateEditorHighlight);
source.addEventListener('keyup', updateEditorHighlight);
source.addEventListener('select', () => {
  // A canvas click/press makes the browser fire a spurious `select` on the
  // still-focused textarea; ignore it when the caret line didn't move.
  if (canvasClickCaretLine !== null && canvasClickCaretLine === caretLine()) {
    return;
  }
  canvasClickCaretLine = null;
  updateEditorHighlight();
});
source.addEventListener('scroll', () => {
  lineNumbers.scrollTop = source.scrollTop;
  if (codeHighlight) {
    codeHighlight.scrollTop = source.scrollTop;
    codeHighlight.scrollLeft = source.scrollLeft;
  }
});
source.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === 'Tab') {
    event.preventDefault();
    if (indentOrOutdent(event.shiftKey)) {
      source.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }

  if (!event.shiftKey && BRACKET_PAIRS.has(event.key)) {
    handleBracketInput(event);
    return;
  }

  if (BRACKET_OPENERS.has(event.key)) {
    handleBracketComplete(event);
  }
});

helpButton.addEventListener('click', () => syntaxDialog.showModal());
syntaxDialog.addEventListener('click', (event) => {
  if (event.target === syntaxDialog) syntaxDialog.close();
});
exportButton.addEventListener('click', handleExport);
exportPngButton.addEventListener('click', handleExportPng);
exampleButton.addEventListener('click', handleExample);
saveFileButton.addEventListener('click', handleSaveFile);
openFileButton.addEventListener('click', handleOpenFile);
fileInput.addEventListener('change', handleFileSelected);
importSQLButton.addEventListener('click', handleImportSQL);
sqlInput.addEventListener('change', handleSQLFileSelected);
zoomInButton.addEventListener('click', () => zoomBy(1.2));
zoomOutButton.addEventListener('click', () => zoomBy(1 / 1.2));
fitButton.addEventListener('click', fitView);
diagramViewport.addEventListener('dblclick', (event) => {
  if (!currentDiagram) return;
  if (!event.target.closest('.diagram-svg')) return;
  fitView();
});

diagramViewport.addEventListener('pointerdown', handlePointerDown);
diagramViewport.addEventListener('pointermove', handlePointerMove);
diagramViewport.addEventListener('pointerup', handlePointerUp);
diagramViewport.addEventListener('pointercancel', handlePointerUp);
diagramViewport.addEventListener('wheel', handleWheel, { passive: false });

document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || syntaxDialog.open) return;

  switch (event.key.toLowerCase()) {
    case 'e':
      event.preventDefault();
      if (event.shiftKey) handleExportPng();
      else handleExport();
      break;
    case 's':
      event.preventDefault();
      handleSaveFile();
      break;
  }
});

languageSelect.addEventListener('change', handleLanguageChange);
themeSelect.addEventListener('change', () => {
  applyThemePreference(themeSelect.value);
});

function syncSettingsUI() {
  for (const btn of settingsPopover.querySelectorAll('.segment-btn')) {
    const checked = btn.dataset.value === ERDRAFT_SETTINGS[btn.dataset.setting];
    btn.setAttribute('aria-checked', String(checked));
  }
}

settingsButton.addEventListener('click', (event) => {
  event.stopPropagation();
  const isHidden = settingsPopover.hidden;
  settingsPopover.hidden = !isHidden;
  settingsButton.setAttribute('aria-expanded', String(isHidden));
  if (isHidden) syncSettingsUI();
});

settingsPopover.addEventListener('click', (event) => {
  const btn = event.target.closest('.segment-btn');
  if (!btn) return;
  event.stopPropagation();
  setSetting(btn.dataset.setting, btn.dataset.value);
  syncSettingsUI();
  if (currentDiagram) {
    window.clearTimeout(parseTimer);
    parseTimer = window.setTimeout(parseAndRender, 50);
  }
});

document.addEventListener('click', () => {
  if (!settingsPopover.hidden) {
    settingsPopover.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
  }
});

const resizeObserver = new ResizeObserver(() => {
  if (autoFit && currentDiagram) fitView();
});
resizeObserver.observe(diagramViewport);

I18N.setLanguage(readSavedLanguage());
applyLanguage();
source.value = readSavedSource();
updateGutter();
parseAndRender();
requestAnimationFrame(() => {
  if (currentDiagram) fitView();
});
