// ── PROXY CONFIG (configurado por el dueño de la app, una sola vez) ──
// Deployá worker.js en Cloudflare Workers y reemplazá estas URLs con las tuyas.
const TODOIST_PROXY = 'https://todoist-proxy.donatowriter.workers.dev/todoist';
const NOTION_PROXY  = 'https://todoist-proxy.donatowriter.workers.dev/notion';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── FIREBASE CONFIG ──
const firebaseConfig = {
  apiKey: "AIzaSyDNHGopQJNVZjtB7h1S4dCTeVS351j4o9E",
  authDomain: "segundo-cerebro-56d73.firebaseapp.com",
  projectId: "segundo-cerebro-56d73",
  storageBucket: "segundo-cerebro-56d73.firebasestorage.app",
  messagingSenderId: "579620446501",
  appId: "1:579620446501:web:5d2cec65a23790e877facc"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const DATA_REF = doc(db, 'data', 'main');

let notes = [], history = [], trash = [], settings = {};
let activeNoteId = null;
let activeEditId  = null;

// ── LOCAL STORAGE (offline-first) ──
const LOCAL_KEY = 'sc_local';

function saveLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ notes, history, trash, settings }));
  } catch(e) {}
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    const parse = v => Array.isArray(v) ? v : [];
    notes   = parse(d.notes);
    history = parse(d.history);
    trash   = parse(d.trash);
    if (d.settings && typeof d.settings === 'object') {
      settings = d.settings;
      loadSettingsUI();
    }
    renderReview(); renderHistory(); renderTrash(); updateBadge();
    return true;
  } catch(e) { return false; }
}

// ── SYNC ──
function showSyncStatus(ok) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  el.textContent = ok ? '⇕ Sincronizado' : '⚠ Error de sync';
  el.style.borderColor = ok ? 'rgba(45,212,191,0.4)' : 'rgba(255,107,107,0.4)';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2500);
}

function showOfflineBanner(offline) {
  let banner = document.getElementById('offline-banner');
  if (!banner) return;
  banner.style.display = offline ? 'flex' : 'none';
}

function applyRemoteData(d) {
  const parse = v => Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v) : []);
  notes = parse(d.notes);
  history = parse(d.history);
  trash = parse(d.trash);
  if (d.settings && typeof d.settings === 'object') {
    settings = d.settings;
    loadSettingsUI();
  }
}

function startSync() {
  // Mostrar datos locales inmediatamente mientras Firebase conecta
  loadLocal();

  onSnapshot(DATA_REF, async snap => {
    if (!snap.exists()) return;
    const d = snap.data();

    // Detectar notas añadidas offline que no están en Firebase
    const parse = v => Array.isArray(v) ? v : (typeof v === 'string' ? JSON.parse(v) : []);
    const remoteIds = new Set(parse(d.notes).map(n => n.id));
    const offlineNotes = notes.filter(n => !remoteIds.has(n.id));

    applyRemoteData(d);
    saveLocal(); // ← Actualizar caché local con los últimos datos de Firebase
    renderReview(); renderHistory(); renderTrash(); updateBadge();

    // Si había notas offline, fusionarlas y subir a Firebase
    if (offlineNotes.length > 0) {
      notes = [...offlineNotes, ...notes];
      saveLocal();
      await setDoc(DATA_REF, { notes, history, trash, settings }).catch(() => {});
      renderReview(); updateBadge();
      showToast(`↑ ${offlineNotes.length} nota(s) offline sincronizada(s)`, 'success');
    }

    const fbTxt = document.getElementById('firebase-status-text');
    if (fbTxt) fbTxt.textContent = 'Conectado ✓';
    showSyncStatus(true);
    showOfflineBanner(false);
  }, err => {
    const fbTxt = document.getElementById('firebase-status-text');
    if (fbTxt) fbTxt.textContent = 'Error de conexión';
    console.error('Firestore listener error:', err);
    showOfflineBanner(true);
  });
}

async function persistAll() {
  updateBadge();
  saveLocal(); // Guardar localmente siempre (funciona offline)
  if (!navigator.onLine) return; // Si no hay internet, no intentar Firebase
  try {
    await setDoc(DATA_REF, { notes, history, trash, settings });
  } catch (e) {
    console.error('persistAll error:', e);
  }
}

// ── PIN ──
const PIN_KEY     = 'sc_pin';
const SESSION_KEY = 'sc_session';
const SESSION_DURATIONS = {
  '0':     0,                   // siempre pedir
  '4h':    4  * 3600,
  '24h':   24 * 3600,
  '7d':    7  * 24 * 3600,
  'never': Infinity
};
let pinBuffer = '', pinMode = 'check', pinSetupFirst = '';

function initPin() {
  // ¿Hay sesión válida? Si es así, saltear el PIN directamente.
  const duration = localStorage.getItem('sc_session_duration') || '7d';
  if (duration !== '0') {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const { unlockedAt } = JSON.parse(raw);
        const maxSecs = SESSION_DURATIONS[duration];
        const elapsed = (Date.now() - unlockedAt) / 1000;
        if (maxSecs === Infinity || elapsed < maxSecs) {
          document.getElementById('pin-screen').classList.add('hidden');
          startSync();
          return;
        }
      }
    } catch(e) {}
  }
  // Flujo normal de PIN
  if (!localStorage.getItem(PIN_KEY)) {
    pinMode = 'setup';
    document.getElementById('pin-subtitle').textContent = 'Elegí un PIN de 4 dígitos';
    document.getElementById('pin-setup-hint').style.display = 'block';
  }
}

window.pinKey = d => {
  if (pinBuffer.length >= 4) return;
  pinBuffer += d;
  updateDots();
  if (pinBuffer.length === 4) setTimeout(evalPin, 120);
};

window.pinBackspace = () => {
  pinBuffer = pinBuffer.slice(0, -1);
  updateDots();
  clearPinErr();
};

function updateDots(state) {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById('dot-' + i);
    el.className = 'pin-dot' + (i < pinBuffer.length ? ' filled' : '') + (state === 'error' ? ' error' : '');
  }
}

function evalPin() {
  if (pinMode === 'check') {
    if (pinBuffer === localStorage.getItem(PIN_KEY)) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ unlockedAt: Date.now() }));
      document.getElementById('pin-screen').classList.add('hidden');
      startSync();
    } else {
      pinErr('PIN incorrecto. Intentá de nuevo.');
    }
  } else if (pinMode === 'setup') {
    pinSetupFirst = pinBuffer; pinBuffer = ''; pinMode = 'confirm';
    document.getElementById('pin-subtitle').textContent = 'Confirmá tu PIN';
    document.getElementById('pin-setup-hint').style.display = 'none';
    updateDots();
  } else if (pinMode === 'confirm') {
    if (pinBuffer === pinSetupFirst) {
      localStorage.setItem(PIN_KEY, pinBuffer);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ unlockedAt: Date.now() }));
      document.getElementById('pin-screen').classList.add('hidden');
      startSync();
    } else {
      pinSetupFirst = ''; pinMode = 'setup';
      pinErr('Los PINs no coinciden. Elegí uno nuevo.');
      document.getElementById('pin-subtitle').textContent = 'Elegí un PIN de 4 dígitos';
    }
  }
}

function pinErr(msg) {
  updateDots('error');
  const e = document.getElementById('pin-error');
  e.textContent = msg;
  e.classList.add('show');
  setTimeout(() => { pinBuffer = ''; updateDots(); clearPinErr(); }, 900);
}

function clearPinErr() {
  document.getElementById('pin-error').classList.remove('show');
}

window.changePIN = () => {
  localStorage.removeItem(PIN_KEY);
  localStorage.removeItem(SESSION_KEY); // Invalidar sesión al cambiar PIN
  pinBuffer = ''; pinSetupFirst = ''; pinMode = 'setup';
  document.getElementById('pin-title').textContent = 'Nuevo PIN';
  document.getElementById('pin-subtitle').textContent = 'Elegí un PIN de 4 dígitos';
  document.getElementById('pin-setup-hint').style.display = 'block';
  document.getElementById('pin-screen').classList.remove('hidden');
  updateDots();
};

initPin();

// ── TABS ──
window.switchTab = tab => {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('screen-' + tab).classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'review') renderReview();
  if (tab === 'history') renderHistory();
  if (tab === 'trash') renderTrash();
};

// ── CAPTURE ──
document.getElementById('capture-input').addEventListener('input', function () {
  document.getElementById('char-count').textContent = this.value.length;
  document.getElementById('btn-save').disabled = !this.value.length;
});
document.getElementById('capture-input').addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveNote();
});

window.saveNote = async () => {
  const el = document.getElementById('capture-input'), text = el.value.trim();
  if (!text) return;
  notes.unshift({ id: Date.now().toString(), text, created: new Date().toISOString() });
  el.value = '';
  document.getElementById('char-count').textContent = '0';
  document.getElementById('btn-save').disabled = true;
  showToast('✓ Guardado en inbox', 'success');
  if (navigator.vibrate) navigator.vibrate(10);
  await persistAll();
};

// ── RENDERS ──
function renderReview() { document.getElementById('review-list').innerHTML = notes.length ? notes.map(n => card(n, 'inbox')).join('') : empty('Inbox vacío 🎉'); }
function renderHistory() { document.getElementById('history-list').innerHTML = history.length ? history.map(n => card(n, 'history')).join('') : empty('Sin notas enviadas aún'); }
function renderTrash() { document.getElementById('trash-list').innerHTML = trash.length ? trash.map(n => card(n, 'trash')).join('') : empty('Papelera vacía'); }

function empty(msg) {
  return `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><p>${msg}</p></div>`;
}

function card(n, mode) {
  const destTag = n.destination ? `<span class="note-meta-tag tag-${n.destination.toLowerCase()}">${n.destination}</span>` : '';
  const timeLabel = mode === 'history' && n.sentAt ? ' · ' + fmt(n.sentAt) : mode === 'trash' && n.deletedAt ? ' · ' + fmt(n.deletedAt) : '';
  const COPY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
  let actions = '', confirm = '';

  const EDIT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  if (mode === 'inbox') {
    actions = `
      <button class="action-btn todoist" onclick="openTodoist('${n.id}')"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.2 0H2.8C1.3 0 0 1.3 0 2.8v18.4C0 22.7 1.3 24 2.8 24h18.4c1.5 0 2.8-1.3 2.8-2.8V2.8C24 1.3 22.7 0 21.2 0zM10 17.2l-5-5 1.4-1.4 3.6 3.6 7.6-7.6 1.4 1.4L10 17.2z"/></svg>Todoist</button>
      <button class="action-btn notion" onclick="openNotion('${n.id}')"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/></svg>Notion</button>
      <button class="action-btn keep" onclick="sendToKeep('${n.id}')"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6l1 9H8L9 3zM4.5 14h15l-1.68 6.39A2 2 0 0116 22H8a2 2 0 01-1.93-1.61L4.5 14z"/></svg>Keep</button>
      <button class="action-btn edit" onclick="openEdit('${n.id}')" title="Editar">${EDIT_SVG}</button>
      <button class="action-btn copy" onclick="copyNote('${n.id}','inbox')" title="Copiar">${COPY_SVG}</button>
      <button class="action-btn dismiss" id="dismiss-${n.id}" onclick="askDismiss('${n.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    confirm = `<div class="dismiss-confirm" id="confirm-${n.id}"><span class="dismiss-confirm-text">¿Mover a papelera?</span><div class="dismiss-confirm-btns"><button class="dismiss-no" onclick="cancelDismiss('${n.id}')">No</button><button class="dismiss-yes" onclick="trashNote('${n.id}')">Sí, eliminar</button></div></div>`;
  } else if (mode === 'history') {
    actions = `<button class="action-btn copy" onclick="copyNote('${n.id}','history')">${COPY_SVG} Copiar</button>`;
  } else {
    actions = `
      <button class="action-btn restore" onclick="restoreNote('${n.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4"/></svg>Restaurar</button>
      <button class="action-btn copy" onclick="copyNote('${n.id}','trash')" title="Copiar">${COPY_SVG}</button>
      <button class="action-btn delete-perm" id="dismiss-${n.id}" onclick="askPermDelete('${n.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    confirm = `<div class="dismiss-confirm" id="confirm-${n.id}"><span class="dismiss-confirm-text">¿Eliminar definitivamente?</span><div class="dismiss-confirm-btns"><button class="dismiss-no" onclick="cancelDismiss('${n.id}')">No</button><button class="dismiss-yes" onclick="permDelete('${n.id}')">Sí, borrar</button></div></div>`;
  }

  const cls = mode === 'history' ? 'note-card history-card' : mode === 'trash' ? 'note-card trash-card' : 'note-card';
  const tcls = mode !== 'inbox' ? 'note-text muted' : 'note-text';
  return `<div class="${cls}" id="card-${n.id}"><div class="${tcls}">${esc(n.text)}</div><div class="note-meta">${fmt(n.created)}${timeLabel} ${destTag}</div><div class="note-actions">${actions}</div>${confirm}</div>`;
}

// ── COPY ──
window.copyNote = (id, src) => {
  const pool = src === 'inbox' ? notes : src === 'history' ? history : trash;
  const n = pool.find(x => x.id === id);
  if (!n) return;
  navigator.clipboard.writeText(n.text)
    .then(() => showToast('📋 Copiado al portapapeles', 'success'))
    .catch(() => showToast('No se pudo copiar', 'error'));
};

// ── TODOIST ──
window.openTodoist = id => {
  if (!settings.todoistToken) { showToast('⚠️ Configurá el token de Todoist', 'error'); switchTab('settings'); return; }
  activeNoteId = id;
  document.getElementById('todoist-preview').textContent = notes.find(n => n.id === id).text;
  document.getElementById('todoist-due').value = '';
  document.getElementById('todoist-priority').value = '4';
  document.getElementById('modal-todoist').classList.add('show');
};

window.confirmTodoist = async () => {
  const note = notes.find(n => n.id === activeNoteId);
  const due = document.getElementById('todoist-due').value.trim();
  const priority = parseInt(document.getElementById('todoist-priority').value);
  const btn = document.querySelector('.modal-confirm.todoist');
  btn.textContent = 'Creando...'; btn.disabled = true;
  try {
    const body = { content: note.text, priority };
    if (due) body.due_string = due;
    if (settings.todoistProject) body.project_id = settings.todoistProject;
    const r = await fetch(`${TODOIST_PROXY}/tasks`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${settings.todoistToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
    addHist(note, 'Todoist');
    removeInbox(activeNoteId);
    closeModal('modal-todoist');
    showToast('✓ Tarea creada en Todoist', 'success');
    await persistAll();
  } catch (e) {
    showToast('Error Todoist: ' + (e.message || 'verificá el token'), 'error');
  } finally {
    btn.textContent = 'Crear tarea'; btn.disabled = false;
  }
};

// ── NOTION ──
// Parsea tanto un ID suelto como una URL completa de Notion
function parseNotionDbId(input) {
  // Extraer el ID de 32 hex chars de una URL o string con/sin guiones
  const match = input.match(/([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})/i);
  if (!match) return input;
  const raw = match[1].replace(/-/g, '');
  return raw.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

window.openNotion = id => {
  if (!settings.notionToken || !settings.notionDb) { showToast('⚠️ Configurá Notion', 'error'); switchTab('settings'); return; }
  activeNoteId = id;
  document.getElementById('notion-preview').textContent = notes.find(n => n.id === id).text;
  document.getElementById('modal-notion').classList.add('show');
};

window.confirmNotion = async () => {
  const note = notes.find(n => n.id === activeNoteId);
  const type = document.getElementById('notion-type').value;
  const btn  = document.querySelector('#modal-notion .modal-confirm');
  btn.textContent = 'Creando...'; btn.disabled = true;
  try {
    const dbId = parseNotionDbId(settings.notionDb);

    // 1. Obtener el schema de la base de datos para encontrar propiedades reales
    const schemaRes = await fetch(`${NOTION_PROXY}/databases/${dbId}`, {
      headers: { 'Authorization': `Bearer ${settings.notionToken}`, 'Notion-Version': '2022-06-28' }
    });
    if (!schemaRes.ok) throw new Error('No se pudo leer la base de datos de Notion');
    const schema = await schemaRes.json();

    // 2. Encontrar la propiedad de tipo 'title' (puede llamarse cualquier cosa)
    const titleEntry = Object.entries(schema.properties).find(([, v]) => v.type === 'title');
    if (!titleEntry) throw new Error('La base de datos no tiene una columna de título');
    const titleKey = titleEntry[0];

    // 3. Armar el cuerpo con el nombre de propiedad correcto
    const body = {
      parent: { database_id: dbId },
      properties: {
        [titleKey]: { title: [{ text: { content: note.text.slice(0, 100) } }] }
      }
    };

    // 4. Agregar 'Tipo' solo si existe en el schema y es un select
    if (schema.properties['Tipo']?.type === 'select') {
      body.properties['Tipo'] = { select: { name: type } };
    }

    // 5. Si el texto supera 100 chars, agregar el resto como bloque
    if (note.text.length > 100) {
      body.children = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: note.text } }] } }];
    }

    const r = await fetch(`${NOTION_PROXY}/pages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${settings.notionToken}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify(body)
    });
    if (!r.ok) { const err = await r.json(); throw new Error(err.message || 'Error Notion'); }

    addHist(note, 'Notion');
    removeInbox(activeNoteId);
    closeModal('modal-notion');
    showToast('✓ Página creada en Notion', 'success');
    await persistAll();
  } catch (e) {
    showToast('Error Notion: ' + e.message, 'error');
  } finally {
    btn.textContent = 'Crear página'; btn.disabled = false;
  }
};

// ── KEEP ──
window.sendToKeep = async id => {
  const note = notes.find(n => n.id === id);
  navigator.clipboard.writeText(note.text).catch(() => { });
  window.open('https://keep.google.com/#NOTE', '_blank');
  addHist(note, 'Keep');
  removeInbox(id);
  showToast('📋 Texto copiado — abriendo Keep', 'success');
  await persistAll();
};

function addHist(note, dest) {
  history.unshift({ ...note, destination: dest, sentAt: new Date().toISOString() });
  if (history.length > 500) history = history.slice(0, 500);
}

// ── DISMISS ──
window.askDismiss = id => { document.getElementById('confirm-' + id).classList.add('show'); document.getElementById('dismiss-' + id).style.display = 'none'; };
window.cancelDismiss = id => { document.getElementById('confirm-' + id).classList.remove('show'); const d = document.getElementById('dismiss-' + id); if (d) d.style.display = ''; };

window.trashNote = async id => {
  const note = notes.find(n => n.id === id);
  if (note) trash.unshift({ ...note, deletedAt: new Date().toISOString() });
  const c = document.getElementById('card-' + id);
  if (c) { c.classList.add('removing'); setTimeout(() => removeInbox(id), 380); }
  else removeInbox(id);
  await persistAll();
};

// ── TRASH ──
window.askPermDelete = id => { document.getElementById('confirm-' + id).classList.add('show'); document.getElementById('dismiss-' + id).style.display = 'none'; };

window.permDelete = async id => {
  const c = document.getElementById('card-' + id);
  const go = async () => { trash = trash.filter(n => n.id !== id); await persistAll(); renderTrash(); updateBadge(); };
  if (c) { c.classList.add('removing'); setTimeout(go, 380); }
  else await go();
};

window.restoreNote = async id => {
  const note = trash.find(n => n.id === id);
  if (note) { const { deletedAt, ...clean } = note; notes.unshift(clean); }
  const c = document.getElementById('card-' + id);
  const go = async () => { trash = trash.filter(n => n.id !== id); await persistAll(); renderTrash(); renderReview(); updateBadge(); };
  if (c) { c.classList.add('removing'); setTimeout(go, 380); }
  else await go();
  showToast('↩ Nota restaurada al inbox', 'success');
};

function removeInbox(id) {
  notes = notes.filter(n => n.id !== id);
  renderReview();
  updateBadge();
}

// ── EDIT ──
window.openEdit = id => {
  const note = notes.find(n => n.id === id);
  if (!note) return;
  activeEditId = id;
  document.getElementById('edit-input').value = note.text;
  document.getElementById('modal-edit').classList.add('show');
  setTimeout(() => document.getElementById('edit-input').focus(), 100);
};

window.confirmEdit = async () => {
  const text = document.getElementById('edit-input').value.trim();
  if (!text) return;
  const note = notes.find(n => n.id === activeEditId);
  if (!note) return;
  note.text = text;
  note.edited = new Date().toISOString();
  document.getElementById('modal-edit').classList.remove('show');
  activeEditId = null;
  renderReview();
  showToast('✓ Nota editada', 'success');
  await persistAll();
};

// ── MODALS ──
window.closeModal = id => { document.getElementById(id).classList.remove('show'); activeNoteId = null; };
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); }));

// ── SETTINGS ──
function loadSettingsUI() {
  document.getElementById('todoist-token').value   = settings.todoistToken   || '';
  document.getElementById('todoist-project').value  = settings.todoistProject || '';
  document.getElementById('notion-token').value     = settings.notionToken    || '';
  document.getElementById('notion-db').value        = settings.notionDb       || '';
  document.getElementById('session-duration').value = localStorage.getItem('sc_session_duration') || '7d';
}

window.saveSettings = async () => {
  settings.todoistToken   = document.getElementById('todoist-token').value.trim();
  settings.todoistProject = document.getElementById('todoist-project').value.trim();
  settings.notionToken    = document.getElementById('notion-token').value.trim();
  settings.notionDb       = document.getElementById('notion-db').value.trim();
  // Sesión: se guarda en localStorage para estar disponible antes de Firebase
  localStorage.setItem('sc_session_duration', document.getElementById('session-duration').value);
  await persistAll();
};

window.lockNow = () => {
  localStorage.removeItem(SESSION_KEY);
  location.reload();
};

window.testConnections = async () => {
  if (settings.todoistToken) {
    const st = document.getElementById('todoist-status');
    st.className = 'settings-status'; st.textContent = 'Verificando...'; st.style.display = 'block';
    try {
      const r = await fetch(`${TODOIST_PROXY}/projects`, { headers: { 'Authorization': `Bearer ${settings.todoistToken}` } });
      st.className = 'settings-status ' + (r.ok ? 'ok' : 'err');
      st.textContent = r.ok ? '✓ Conectado' : '✗ Token inválido';
    } catch {
      st.className = 'settings-status err'; st.textContent = '✗ Error de red';
    }
  }
  if (settings.notionToken && settings.notionDb) {
    const st = document.getElementById('notion-status');
    st.className = 'settings-status'; st.textContent = 'Verificando...'; st.style.display = 'block';
    try {
      const dbId = parseNotionDbId(settings.notionDb);
      const r = await fetch(`${NOTION_PROXY}/databases/${dbId}`, { headers: { 'Authorization': `Bearer ${settings.notionToken}`, 'Notion-Version': '2022-06-28' } });
      st.className = 'settings-status ' + (r.ok ? 'ok' : 'err');
      st.textContent = r.ok ? '✓ Base de datos encontrada' : '✗ Verificá token y ID';
    } catch {
      st.className = 'settings-status err'; st.textContent = '✗ Error de red';
    }
  }
};

window.clearAllNotes = async () => {
  if (!notes.length) { showToast('El inbox ya está vacío', 'error'); return; }
  if (!confirm(`¿Mover ${notes.length} nota(s) a la papelera?`)) return;
  const now = new Date().toISOString();
  trash = [...notes.map(n => ({ ...n, deletedAt: now })), ...trash];
  notes = [];
  await persistAll(); renderReview(); renderTrash();
  showToast('Inbox movido a papelera', 'success');
};

window.emptyTrash = async () => {
  if (!trash.length) { showToast('La papelera ya está vacía', 'error'); return; }
  if (!confirm(`¿Eliminar permanentemente ${trash.length} nota(s)?`)) return;
  trash = [];
  await persistAll(); renderTrash();
  showToast('Papelera vaciada', 'success');
};

// ── EXPORT ──
window.exportXLSX = () => {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload = () => {
    const X = window.XLSX, wb = X.utils.book_new(), f = iso => iso ? new Date(iso).toLocaleString('es-AR') : '';
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(notes.length ? notes.map(n => ({ 'Texto': n.text, 'Creada': f(n.created) })) : [{ 'Texto': '(vacío)', 'Creada': '' }]), 'Inbox');
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(history.length ? history.map(n => ({ 'Texto': n.text, 'Creada': f(n.created), 'Enviada a': n.destination || '', 'Fecha envío': f(n.sentAt) })) : [{ 'Texto': '(vacío)', 'Creada': '', 'Enviada a': '', 'Fecha envío': '' }]), 'Historial');
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(trash.length ? trash.map(n => ({ 'Texto': n.text, 'Creada': f(n.created), 'Eliminada': f(n.deletedAt) })) : [{ 'Texto': '(vacío)', 'Creada': '', 'Eliminada': '' }]), 'Papelera');
    X.writeFile(wb, `segundo-cerebro-${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('✓ Archivo descargado', 'success');
  };
  document.head.appendChild(s);
};

// ── BADGE / TOAST / HELPERS ──
function updateBadge() {
  const n = notes.length, t = trash.length;
  const rb = document.getElementById('review-badge');
  const tb = document.getElementById('trash-badge');
  const hc = document.getElementById('header-count');
  rb.textContent = n > 99 ? '99+' : n; rb.style.display = n > 0 ? 'flex' : 'none';
  tb.textContent = t > 99 ? '99+' : t; tb.style.display = t > 0 ? 'flex' : 'none';
  hc.style.display = n > 0 ? 'flex' : 'none';
  document.getElementById('count-num').textContent = n;
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show ' + type;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = ''; }, 2800);
}
window.showToast = showToast;

function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date(), diff = (now - d) / 1000;
  if (diff < 60) return 'Ahora mismo';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');
}

// ── ONLINE / OFFLINE ──
window.addEventListener('offline', () => {
  showOfflineBanner(true);
  showToast('№ Sin conexión — las notas se guardan localmente', 'error');
});

window.addEventListener('online', async () => {
  showOfflineBanner(false);
  showToast('🔄 Conexión restaurada — sincronizando...', 'success');
  try {
    await setDoc(DATA_REF, { notes, history, trash, settings });
  } catch(e) {}
});

// ── SERVICE WORKER ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/segundo-cerebro/sw.js')
      .catch(err => console.warn('SW no registrado:', err));
  });
}
