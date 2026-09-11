/* js/shell.js — GİRİŞ + KENAR ÇUBUĞU + BOTLAR + SOHBET LİSTESİ
   app.js'ten bağımsız çalışır; app.js ona geri-çağrı (callback) verir, döngüsel import olmaz. */
import { all, remove, update, insert, getSettings } from './store.js';
import {
  profiles, activeProfile, isLoggedIn, createProfile, login, logout,
  deleteProfile, initials, setPin,
} from './profile.js';
import { personas, getPersona, createPersona, deletePersona, TEMPLATES } from './personas.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let H = {};   // app.js'ten gelen geri-çağrılar

/* ============================ GİRİŞ ============================ */
function renderLoginList() {
  const box = $('#loginList'); if (!box) return;
  const list = profiles();
  if (!list.length) { showLoginPane('new'); return; }
  showLoginPane('list');
  box.innerHTML = list.map((p) => `
    <button class="pcard" data-pid="${p.id}">
      <span class="avatar" style="background:${esc(p.color || '#7c5cff')}">${esc(initials(p.name))}</span>
      <span class="pn">${esc(p.name)}${p.puterUser ? ` <span class="pm">☁️ ${esc(p.puterUser)}</span>` : ''}</span>
      ${p.pinHash ? '<span class="lock">🔒</span>' : ''}
    </button>`).join('');
  box.querySelectorAll('[data-pid]').forEach((b) => b.addEventListener('click', () => {
    const p = profiles().find((x) => x.id === b.dataset.pid);
    if (p?.pinHash) askPin(p); else doLogin(p.id, '');
  }));
}

function showLoginPane(which) {
  $('#loginList').style.display = which === 'list' ? 'block' : 'none';
  $('#loginNew').style.display = which === 'new' ? 'block' : 'none';
  $('#loginPin').style.display = which === 'pin' ? 'block' : 'none';
  $('#btnAddProfile').style.display = which === 'list' ? 'block' : 'none';
  if (which === 'new') setTimeout(() => $('#npName')?.focus(), 60);
  if (which === 'pin') setTimeout(() => $('#pinInput')?.focus(), 60);
}

let pinTarget = null;
function askPin(p) {
  pinTarget = p;
  $('#pinWho').innerHTML = `<span class="avatar" style="background:${esc(p.color)};display:inline-flex;width:22px;height:22px;font-size:10px;vertical-align:-6px">${esc(initials(p.name))}</span> ${esc(p.name)}`;
  $('#pinInput').value = '';
  showLoginPane('pin');
}

function doLogin(id, pin) {
  try {
    const p = login(id, pin);
    $('#login').style.display = 'none';
    $('#app').style.display = 'grid';
    H.onLogin?.(p);
    renderSidebar();
  } catch (e) {
    alert(e.message);
    if (pinTarget) askPin(pinTarget);
  }
}

export function initLogin(handlers) {
  H = { ...H, ...handlers };
  renderLoginList();

  $('#btnAddProfile')?.addEventListener('click', () => showLoginPane('new'));
  $('#npCancel')?.addEventListener('click', () => renderLoginList());
  $('#pinCancel')?.addEventListener('click', () => { pinTarget = null; renderLoginList(); });
  $('#npCreate')?.addEventListener('click', () => {
    const name = $('#npName').value.trim();
    if (!name) { alert('Bir isim yaz'); return; }
    try {
      const p = createProfile({ name, pin: $('#npPin').value.trim() });
      $('#login').style.display = 'none';
      $('#app').style.display = 'grid';
      H.onLogin?.(p);
      renderSidebar();
    } catch (e) { alert(e.message); }
  });
  $('#npName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#npCreate').click(); });
  $('#pinGo')?.addEventListener('click', () => pinTarget && doLogin(pinTarget.id, $('#pinInput').value));
  $('#pinInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#pinGo').click(); });

  // Zaten giriş yapılmışsa doğrudan aç
  if (isLoggedIn()) {
    $('#login').style.display = 'none';
    $('#app').style.display = 'grid';
    H.onLogin?.(activeProfile());
    renderSidebar();
  }
}

/* ============================ KENAR ÇUBUĞU ============================ */
export function currentPersonaId() {
  const c = H.activeConversationId?.();
  if (c?.personaId) return c.personaId;
  try { return localStorage.getItem('evrim:persona') || 'evrim'; } catch { return 'evrim'; }
}

export function renderSidebar() {
  renderPersonas();
  renderConvs();
  renderProfileChip();
}

function renderPersonas() {
  const box = $('#personaList'); if (!box) return;
  const cur = currentPersonaId();
  box.innerHTML = personas().map((p) => `
    <button class="persona ${p.id === cur ? 'on' : ''}" data-persona="${esc(p.id)}" title="${esc(p.tag || '')}">
      <span class="pe">${esc(p.emoji || '🤖')}</span>
      <span><span class="pn">${esc(p.name)}</span><span class="pt">${esc(p.tag || '')}</span></span>
      ${p.builtin ? '' : '<span class="cx" data-delpersona="' + esc(p.id) + '" style="margin-left:auto">✕</span>'}
    </button>`).join('')
    + `<button class="persona" id="btnAddPersona" style="opacity:.75"><span class="pe">➕</span><span><span class="pn">Yeni bot</span><span class="pt">kendi botunu oluştur</span></span></button>`;

  box.querySelectorAll('[data-persona]').forEach((b) => b.addEventListener('click', (e) => {
    if (e.target.dataset.delpersona) return;
    H.onPersona?.(b.dataset.persona);
    renderPersonas();
  }));
  box.querySelectorAll('[data-delpersona]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = b.dataset.delpersona;
    if (confirm('Bu bot silinsin mi?')) { deletePersona(id); if (currentPersonaId() === id) H.onPersona?.('evrim'); renderSidebar(); }
  }));
  $('#btnAddPersona')?.addEventListener('click', () => newPersonaDialog());
}

function newPersonaDialog() {
  const m = document.createElement('div');
  m.className = 'modal on';
  m.innerHTML = `<div class="modal-box" style="max-width:480px">
    <div class="modal-head"><b>➕ Yeni bot oluştur</b><button class="icon-btn" data-x>✕</button></div>
    <div class="modal-body">
      <div class="muted" style="font-size:12.5px;margin-bottom:10px">Hazır şablondan başla ya da sıfırdan yaz:</div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:12px">
        ${TEMPLATES.map((t, i) => `<button class="btn sm ghost" data-tpl="${i}">${esc(t.emoji)} ${esc(t.name)}</button>`).join('')}
      </div>
      <label>Bot adı</label><input id="pnName" maxlength="30" placeholder="örn. Çevirmen">
      <div class="row" style="gap:8px;margin-top:10px">
        <div style="flex:0 0 74px"><label>Emoji</label><input id="pnEmoji" maxlength="4" value="🤖"></div>
        <div style="flex:1"><label>Kısa tanım</label><input id="pnTag" maxlength="40" placeholder="ne yapar"></div>
      </div>
      <label style="margin-top:10px">Botun görevi / kuralları <span class="muted">(sistem komutu)</span></label>
      <textarea id="pnPrompt" rows="5" placeholder="Sen bir çevirmensin. Sadece çeviriyi ver..."></textarea>
      <button class="btn" id="pnSave" style="width:100%;margin-top:12px">Botu oluştur</button>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelector('[data-x]').addEventListener('click', close);
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  m.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
    const t = TEMPLATES[Number(b.dataset.tpl)];
    m.querySelector('#pnName').value = t.name; m.querySelector('#pnEmoji').value = t.emoji;
    m.querySelector('#pnTag').value = t.tag; m.querySelector('#pnPrompt').value = t.prompt;
  }));
  m.querySelector('#pnSave').addEventListener('click', () => {
    try {
      const p = createPersona({
        name: m.querySelector('#pnName').value, emoji: m.querySelector('#pnEmoji').value,
        tag: m.querySelector('#pnTag').value, prompt: m.querySelector('#pnPrompt').value,
      });
      close(); H.onPersona?.(p.id); renderSidebar();
    } catch (e) { alert(e.message); }
  });
}

function renderConvs() {
  const box = $('#convList'); if (!box) return;
  const pid = activeProfile()?.id;
  const cur = H.activeConversationId?.()?.id;
  const list = all('conversations')
    .filter((c) => !pid || !c.profileId || c.profileId === pid)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, 40);
  if (!list.length) {
    box.innerHTML = '<div class="muted" style="font-size:12px;padding:6px 9px">Henüz sohbet yok</div>';
    return;
  }
  box.innerHTML = list.map((c) => {
    const pe = getPersona(c.personaId || 'evrim').emoji || '💬';
    return `<button class="conv ${c.id === cur ? 'on' : ''}" data-conv="${esc(c.id)}">
      <span>${pe}</span><span class="ct">${esc(c.title || 'Yeni sohbet')}</span>
      <span class="cx" role="button" aria-label="Sohbeti sil" data-del="${esc(c.id)}">✕</span></button>`;
  }).join('');
  box.querySelectorAll('[data-conv]').forEach((b) => b.addEventListener('click', (e) => {
    if (e.target.dataset.del) return;
    H.onSelectConv?.(b.dataset.conv);
    renderConvs(); closeDrawer();
  }));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = b.dataset.del;
    if (!confirm('Bu sohbet silinsin mi?')) return;
    all('messages').filter((m) => m.conversationId === id).forEach((m) => remove('messages', m.id));
    remove('conversations', id);
    H.onDeleteConv?.(id);
    renderConvs();
  }));
}

function renderProfileChip() {
  const b = $('#profileChip'); if (!b) return;
  const p = activeProfile();
  if (!p) { b.innerHTML = '<span class="avatar" style="background:#333">?</span> Giriş yap'; return; }
  const nConv = all('conversations').filter((c) => c.profileId === p.id).length;
  const nMem = all('memories').filter((m) => !m.archived).length;
  b.innerHTML = `<span class="avatar" style="background:${esc(p.color)}">${esc(initials(p.name))}</span>
    <span style="flex:1;text-align:left;min-width:0"><b style="display:block;font-size:13px">${esc(p.name)}</b>
    <span class="muted" style="font-size:10.5px">${nConv} sohbet · ${nMem} hafıza</span></span>
    <span class="muted" style="font-size:15px">⋯</span>`;
  b.onclick = () => profileMenu(p);
}

function profileMenu(p) {
  const m = document.createElement('div');
  m.className = 'modal on';
  m.innerHTML = `<div class="modal-box" style="max-width:380px">
    <div class="modal-head"><b>${esc(p.name)}</b><button class="icon-btn" data-x>✕</button></div>
    <div class="modal-body">
      <button class="btn ghost" data-act="pin" style="width:100%;margin-bottom:8px">${p.pinHash ? '🔓 PIN kaldır/değiştir' : '🔒 PIN koy'}</button>
      <button class="btn ghost" data-act="rename" style="width:100%;margin-bottom:8px">✏️ Adı değiştir</button>
      <button class="btn ghost" data-act="switch" style="width:100%;margin-bottom:8px">👥 Profil değiştir</button>
      <button class="btn ghost" data-act="new" style="width:100%;margin-bottom:8px">➕ Yeni profil ekle</button>
      <button class="btn ghost" data-act="logout" style="width:100%;margin-bottom:8px">🚪 Çıkış yap</button>
      <button class="btn ghost" data-act="delete" style="width:100%;color:var(--bad)">🗑 Bu profili ve sohbetlerini sil</button>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.querySelector('[data-x]').addEventListener('click', close);
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  m.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'rename') {
      const n = prompt('Yeni ad:', p.name); if (n) { H.onRenameProfile?.(p.id, n); renderSidebar(); }
    } else if (act === 'pin') {
      const n = prompt('Yeni PIN (boş bırakırsan kalkar):', ''); if (n !== null) { setPin(p.id, n.trim()); }
    } else if (act === 'logout' || act === 'switch' || act === 'new') {
      logout(); close();
      $('#app').style.display = 'none';
      $('#login').style.display = 'flex';
      if (act === 'new') { $('#npName').value = ''; $('#npPin').value = ''; showLoginPane('new'); }
      else renderLoginList();
      return;
    } else if (act === 'delete') {
      if (!confirm(`${p.name} profili ve TÜM sohbetleri silinsin mi? Bu geri alınamaz.`)) return;
      deleteProfile(p.id); close();
      $('#app').style.display = 'none'; $('#login').style.display = 'flex'; renderLoginList();
      return;
    }
    close();
  }));
}

/* ============================ ÇEKMECE / MODAL ============================ */
export function openDrawer() { document.body.classList.add('sb-open'); }
export function closeDrawer() { document.body.classList.remove('sb-open'); }

export function openSetupModal() { $('#setupModal')?.classList.add('on'); }
export function closeSetupModal() { $('#setupModal')?.classList.remove('on'); }

export function initShell(handlers) {
  H = { ...H, ...handlers };
  $('#sbOpen')?.addEventListener('click', openDrawer);
  $('#sbClose')?.addEventListener('click', closeDrawer);
  $('#scrim')?.addEventListener('click', closeDrawer);
  $('#closeSetup')?.addEventListener('click', closeSetupModal);
  $('#statusPill')?.addEventListener('click', openSetupModal);
  $('#brainBarBtn')?.addEventListener('click', openSetupModal);
  $('#setupModal')?.addEventListener('click', (e) => { if (e.target.id === 'setupModal') closeSetupModal(); });
  $('#btnNewChat')?.addEventListener('click', () => { H.onNewChat?.(); closeDrawer(); });
  $$('.sb-nav button').forEach((b) => b.addEventListener('click', () => {
    H.onGo?.(b.dataset.v);
    $$('.sb-nav button').forEach((x) => x.classList.toggle('on', x === b));
    closeDrawer();
  }));
}

export { getPersona, personas, activeProfile, profiles };
