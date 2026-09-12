/* EVRIM web — sunucusuz sürüm */
import {
  getSettings, setSettings, all, insert, update, remove, find,
  currentPrompt, pushPromptVersion, rollbackPrompt,
  exportData, importData, wipeData, storageSize,
} from './store.js';
import {
  PROVIDERS, active as activeLLM, isReady, chat, testConnection, detectProvider,
  detectWebGPU, guessTier, shortName, localStatus, loadLocal, probeFree,
  fetchFreeModels, bestFreeModel,
  probeNano, nanoStatus, createNano, hasNanoAPI,
  probeKeyless, probePuter, puterStatus, puterSignIn, markPuterDown, markHouseDown, rawChat,
} from './llm.js';
import { testAllFree, freeCacheSnapshot } from './free.js';
import { houseStatus, probeHouse, startHouseHost, stopHouseHost } from './house.js';
import { wasmStatus, loadWasm, unloadWasm } from './wasm.js';
import { reflexAnswer } from './reflex.js';
import { agentChat, toolLabel, TOOLS, mediaGet, webSearch } from './agent.js';
import { initLogin, initShell, renderSidebar, currentPersonaId, openSetupModal, closeSetupModal, closeDrawer, getPersona } from './shell.js';
import { personaPrompt } from './personas.js';
import { activeProfile, renameProfile, isLoggedIn } from './profile.js';
import { MODEL_TIERS, unloadLocal, diagnose, clearModelCache, deviceProfile, vramCap, previewModels } from './local.js';
import * as evo from './evolve.js';
import * as learn from './learn.js';
import * as gh from './github.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const scrollBottom = () => {
  const el = $('#scrollArea') || document.scrollingElement;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
};

let toastT;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast on ${kind}`;
  clearTimeout(toastT);
  toastT = setTimeout(() => (el.className = 'toast'), 2800);
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${label || 'Çalışıyor…'}`; }
  else { btn.disabled = false; if (btn.dataset.old) btn.innerHTML = btn.dataset.old; }
}
/* v56: ```grafik blok ayrıştırıcı -> SVG (cizgi/cubuk) */
function grafikSVG(govde) {
  try {
    const lines = String(govde).split('\n').map((l) => l.trim()).filter(Boolean);
    let tip = 'cizgi'; let baslik = '';
    const pts = [];
    for (const l of lines) {
      if (/^tip:/i.test(l)) { tip = l.slice(4).trim().toLocaleLowerCase('tr'); continue; }
      if (/^baslik:/i.test(l)) { baslik = l.slice(7).trim(); continue; }
      const mcsv = /^(-?[\d.,]+)\s*[,;]\s*(-?[\d.,eE+-]+)$/.exec(l);
      if (!mcsv) continue;
      const x = parseFloat(mcsv[1].replace(',', '.'));
      const y = parseFloat(mcsv[2].replace(',', '.'));
      if (isFinite(x) && isFinite(y)) pts.push([x, y]);
      if (pts.length >= 12) break;
    }
    if (pts.length < 2) return null;
    const W = 320; const Hh = 170; const P = { l: 44, r: 10, t: 22, b: 22 };
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs);
    let y0 = Math.min(...ys, 0); let y1 = Math.max(...ys);
    if (y1 === y0) y1 = y0 + 1;
    const sx = (x) => P.l + ((x - x0) / ((x1 - x0) || 1)) * (W - P.l - P.r);
    const sy = (y) => Hh - P.b - ((y - y0) / (y1 - y0)) * (Hh - P.t - P.b);
    const fmt = (v) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(+v.toFixed(3)));
    let icerik = '';
    // ızgara + eksen etiketleri
    for (let i = 0; i <= 2; i++) {
      const yv = y0 + ((y1 - y0) * i) / 2;
      icerik += `<line x1="${P.l}" y1="${sy(yv)}" x2="${W - P.r}" y2="${sy(yv)}" stroke="#232a45" stroke-width="1"/>`
        + `<text x="${P.l - 5}" y="${sy(yv) + 3}" text-anchor="end" font-size="9" fill="#8b93b5">${fmt(yv)}</text>`;
    }
    icerik += `<text x="${P.l}" y="${Hh - 6}" font-size="9" fill="#8b93b5">${fmt(x0)}</text>`
      + `<text x="${W - P.r}" y="${Hh - 6}" text-anchor="end" font-size="9" fill="#8b93b5">${fmt(x1)}</text>`;
    if (tip.startsWith('cubuk') || tip.startsWith('bar')) {
      const bw = Math.max(4, ((W - P.l - P.r) / pts.length) * 0.6);
      for (const [x, y] of pts) icerik += `<rect x="${sx(x) - bw / 2}" y="${sy(Math.max(y, 0))}" width="${bw}" height="${Math.abs(sy(y) - sy(0)) || 1}" rx="2" fill="#7c5cff"/>`;
    } else {
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
      icerik += `<path d="${d}" fill="none" stroke="#7c5cff" stroke-width="2"/>`;
      for (const [x, y] of pts) icerik += `<circle cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="2.4" fill="#a78bfa"/>`;
    }
    const baslikSvg = baslik ? `<text x="${P.l}" y="13" font-size="10.5" fill="#dbe0f5" font-weight="600">${esc(baslik).slice(0, 60)}</text>` : '';
    return `<svg class="grafik" viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg" role="img">${baslikSvg}${icerik}</svg>`;
  } catch { return null; }
}

function md(src) {
  let s = esc(src);
  // üretilen görseller: ![alt](evrimimg:id) -> <img> (data-URL depodan gelir)
  s = s.replace(/!\[([^\]]*)\]\(evrimimg:([A-Za-z0-9_-]+)\)/g, (_, alt, id) => {
    const src2 = mediaGet(id);
    return src2
      ? `<img class="gen" alt="${alt}" src="${src2}">`
      : `<span class="muted">[görsel bu cihazda/oturumda yok: ${id}]</span>`;
  });
  // v56: ```grafik bloğu -> inline SVG (tabloların görsel hâli)
  s = s.replace(/```grafik\n([\s\S]*?)```/g, (blok, govde) => grafikSVG(govde) || blok);
  s = s.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, l, c) => `<pre><code>${c}</code></pre>`);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|\n)###?\s?(.*)/g, (_, a, b) => `${a}<b>${b}</b>`);
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // markdown tablo -> gerçek tablo (profesyonel sunum)
  s = s.replace(/(?:^\|.*\|\s*\n?)+/gm, (block) => {
    const lines = block.trim().split('\n').map((l) => l.trim()).filter((l) => l);
    const isSep = (l) => /^\|?[\s:|-]+\|?$/.test(l) && l.includes('-');
    const body = lines.filter((l) => !isSep(l));
    if (!body.length) return block;
    const cells = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const head = cells(body[0]);
    const rows = body.slice(1).map((l) => '<tr>' + cells(l).map((c) => `<td>${c}</td>`).join('') + '</tr>').join('');
    return `<table class="tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  });
  s = s.replace(/(^|\n)[-*]\s+/g, '$1• ');
  return s;
}

/* ---------------- navigasyon ---------------- */
let currentView = 'chat';
function go(v) {
  currentView = v;
  $$('.view').forEach((el) => el.classList.toggle('on', el.id === `v-${v}`));
  $$('.sb-nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('#composer').style.display = v === 'chat' ? 'block' : 'none';
  $('#scrollArea')?.scrollTo({ top: 0 });
  const pe = getPersona(currentPersonaId());
  const tm = $('#chatTitleMain');
  const sb = $('#subBrand');
  if (tm) tm.textContent = v === 'chat' ? `${pe.emoji} ${pe.name}`
    : ({ search: '🔎 Web arama', learn: '🎓 Öğrenme koçu', gh: '🐙 GitHub', evo: '🧬 Evrim', set: '⚙️ Ayarlar' }[v] || 'EVRIM');
  if (sb && v === 'chat') sb.textContent = pe.tag || 'yeni sohbet';
  closeDrawer();
  if (v === 'learn') renderLearn();
  if (v === 'gh') { $('#ghRepoInput').value = getSettings().githubRepo || $('#ghRepoInput').value; }
  if (v === 'evo') renderEvo();
  if (v === 'set') renderSettings();
  if (v === 'search') setTimeout(() => $('#wsInput')?.focus(), 50);
}

/* ---------------- v36: açık web arama bölümü ---------------- */
async function wsRun() {
  const q = $('#wsInput')?.value.trim();
  const out = $('#wsOut');
  if (!q || !out) return;
  out.innerHTML = '<div class="muted" style="font-size:13px">🔎 Aranıyor…</div>';
  const n = Number($('#wsCount')?.value) || 5;
  const r = await webSearch(q, n);
  if (!r?.ok) { out.innerHTML = `<div class="muted" style="font-size:13px">⚠️ ${esc(r?.hata || 'arama yapılamadı')}</div>`; return; }
  if (!r.sonuc?.length) { out.innerHTML = '<div class="muted" style="font-size:13px">Sonuç bulunamadı — farklı bir sorgu dene.</div>'; return; }
  out.innerHTML = r.sonuc.map((it, i) => `
    <div class="item" style="padding:10px;margin-bottom:8px">
      <div style="font-size:13.5px;font-weight:600;margin-bottom:4px">${i + 1}. ${esc(it.baslik)}</div>
      <div class="muted" style="font-size:11.5px;word-break:break-all;margin-bottom:8px">${esc(it.url)}</div>
      <div class="row">
        <a class="btn sm ghost" href="${esc(it.url)}" target="_blank" rel="noopener">🔗 Aç</a>
        <button class="btn sm ghost" data-ws-ask="${esc(it.url)}">💬 Özetle</button>
      </div>
    </div>`).join('');
  out.querySelectorAll('[data-ws-ask]').forEach((b) => b.addEventListener('click', () => {
    const u = b.getAttribute('data-ws-ask');
    go('chat');
    send(`Şu sayfayı oku ve özetleyip kaynak linkiyle ver: ${u} (arama sorgum: ${q})`);
  }));
}
$('#wsBtn')?.addEventListener('click', wsRun);
$('#wsInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') wsRun(); });
$('#gotoSettings')?.addEventListener('click', () => go('set'));

/* ---------------- sohbet ---------------- */
let conversationId = null;
let sending = false;

function addCodeCopyButtons(root) {
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.copybtn')) return;
    const b = document.createElement('button');
    b.className = 'copybtn'; b.textContent = 'kopyala';
    b.addEventListener('click', async () => {
      const code = pre.querySelector('code')?.innerText || pre.innerText;
      try { await navigator.clipboard.writeText(code.replace(/\nkopyala$/, '')); b.textContent = '✓ kopyalandı'; }
      catch { b.textContent = 'olmadı'; }
      setTimeout(() => { b.textContent = 'kopyala'; }, 1600);
    });
    pre.appendChild(b);
  });
}

/* ---------------- v48: sesli yanıt (Web Speech TTS, tarayıcı yerleşik) ---------------- */
function speakText(txt, btn) {
  const S = globalThis.speechSynthesis;
  if (!S) { toast('Bu tarayıcıda ses desteği yok', 'err'); return; }
  if (S.speaking || S.pending) { S.cancel(); if (btn) btn.classList.remove('on'); return; }
  const clean = String(txt || '')
    .replace(/```[\s\S]*?```/g, ' kod bloğu. ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#*_|>`\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().slice(0, 4000);
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'tr-TR'; u.rate = 1;
  const voices = (S.getVoices && S.getVoices()) || [];
  const tr = voices.find((v) => /^tr/i.test(String(v.lang || '')));
  if (tr) u.voice = tr;
  if (btn) {
    btn.classList.add('on');
    u.onend = () => btn.classList.remove('on');
    u.onerror = () => btn.classList.remove('on');
  }
  S.speak(u);
}

function addMsg(m) {
  const ce = $('#chatEmpty'); if (ce) ce.style.display = 'none';
  const wc = $('#welcomeCard'); if (wc) wc.style.display = 'none';
  const div = document.createElement('div');
  div.className = `msg ${m.role === 'user' ? 'user' : 'bot'}${m.error ? ' err' : ''}`;
  div.innerHTML = md(m.content);
  addCodeCopyButtons(div);
  if (m.role === 'assistant' && m.id && !m.error) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<button class="fb" data-speak="1" title="Sesli oku">🔊</button>
      <button class="fb ${m.feedback > 0 ? 'on' : ''}" data-fb="1">👍</button>
      <button class="fb ${m.feedback < 0 ? 'on dn' : ''}" data-fb="-1">👎</button>
      <span>${new Date(m.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>`;
    meta.querySelectorAll('[data-fb]').forEach((b) => b.addEventListener('click', () => feedback(m.id, Number(b.dataset.fb), b)));
    meta.querySelector('[data-speak]')?.addEventListener('click', (e) => speakText(m.content, e.currentTarget));
    div.appendChild(meta);
  }
  $('#msgs').appendChild(div);
  requestAnimationFrame(scrollBottom);
  return div;
}

function feedback(id, value, btn) {
  const comment = value < 0 ? (prompt('Neyi iyileştirmemi istersin? (EVRIM bunu hafızasına yazar)') || '') : '';
  evo.recordFeedback({ messageId: id, value, comment });
  // 👎 + yorum = kalıcı davranış kuralı: öz-gelişim döngüsünü anında kapat
  if (value < 0 && comment.trim()) {
    const rule = `Kullanıcı düzeltmesi: ${comment.trim().slice(0, 160)}`;
    evo.addMemory({ content: rule, kind: 'rule', source: 'feedback', strength: 0.9 });
    insert('evolutions', {
      type: 'feedback', summary: 'Geri bildirimden kural öğrendi', detail: rule,
      applied: true, confidence: 0.9, createdAt: new Date().toISOString(),
    });
    toast('📌 Kural öğrenildi, bundan sonraki cevaplarda geçerli', 'ok');
  }
  $$('.fb', btn.parentElement).forEach((b) => b.classList.remove('on', 'dn'));
  btn.classList.add('on');
  if (value < 0) btn.classList.add('dn');
  toast(value > 0 ? 'Teşekkürler, kaydettim 🧠' : 'Not alındı — bir dahakine daha iyisini yapacağım', 'ok');
  refreshStatus();
}

function typing(on) {
  if (on) {
    const div = document.createElement('div');
    div.className = 'msg bot'; div.id = 'typing';
    div.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    $('#msgs').appendChild(div);
    scrollBottom();
  } else $('#typing')?.remove();
}

const KEY_RE = /^(sk-or-v1-[A-Za-z0-9-]{20,}|gsk_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,})$/;

async function send(text) {
  const content = (text ?? $('#input').value).trim();
  if (!content || sending) return;

  // Anahtarı yanlışlıkla sohbet kutusuna yapıştırdıysa -> mesaj gönderme, kaydet
  if (KEY_RE.test(content)) {
    $('#input').value = ''; autoGrow();
    setSettings({ apiKey: content, model: '' });
    toast('🔑 Anahtar algılandı, test ediliyor…', 'ok');
    const r = await testConnection().catch((e) => ({ ok: false, error: e.message }));
    if (r.ok) {
      addMsg({ role: 'assistant', createdAt: new Date().toISOString(),
        content: `✅ **Anahtar çalışıyor!** ${esc(r.provider)} · \`${esc(r.model)}\`\n\nArtık büyük bulut modeli **2 saniyede** cevap veriyor. Bir şey sor.` });
      $('#smartCard') && ($('#smartCard').style.display = 'none');
      closeSetupModal();
    } else {
      setSettings({ apiKey: '' });
      addMsg({ role: 'assistant', error: true, createdAt: new Date().toISOString(),
        content: `❌ Anahtar çalışmadı: ${esc(r.error || 'bilinmeyen hata')}\n\nAnahtarı kontrol edip tekrar yapıştır.` });
    }
    refreshStatus(); renderSettings();
    return;
  }

  sending = true;
  $('#input').value = ''; autoGrow();
  addMsg({ role: 'user', content });
  busy($('#send'), true, '');
  closeSetupModal();

  // Canlı yanıt balonu: model indirilirken/yazarken kullanıcı boş ekran görmesin
  const live = document.createElement('div');
  live.className = 'msg bot';
  live.innerHTML = '<div class="toolsteps"></div>'
    + '<div class="livebody"><span class="typing"><i></i><i></i><i></i></span></div>'
    + '<div class="livestatus muted" style="font-size:12px;margin-top:6px"></div>';
  $('#msgs').appendChild(live);
  const liveBody = live.querySelector('.livebody');
  const liveStat = live.querySelector('.livestatus');
  const toolBox = live.querySelector('.toolsteps');
  const toolRows = new Map();

  // AJAN: modelin araç çağrıları burada görünür (tıpkı bir ajanın "ne yaptığı" gibi)
  const onTool = (name, phase, detail, ms, args) => {
    if (phase === 'running') {
      const row = document.createElement('div');
      row.className = 'toolstep run';
      row.innerHTML = `<span class="spin"></span>${esc(toolLabel(name, detail || {}))}`;
      toolBox.appendChild(row);
      toolRows.set(name + toolBox.children.length, row);
      live.dataset.cur = name + toolBox.children.length;
      scroll();
    } else {
      const key = live.dataset.cur;
      const row = toolRows.get(key);
      if (row) {
        const bad = detail && (detail.error || detail.hata);
        row.className = 'toolstep ' + (bad ? 'bad' : 'ok');
        row.innerHTML = `${bad ? '⚠️' : '✅'} ${esc(toolLabel(name, args || {}, true, bad))}`
          + `<span class="tms">${ms || 0} ms</span>`;
      }
      scroll();
    }
  };
  const scroll = () => scrollBottom();
  scroll();

  let streamed = '';
  const onChunk = (delta, full) => {
    if (!streamed) { liveBody.innerHTML = ''; }
    streamed = full || (streamed + delta);
    liveBody.innerHTML = md(streamed) + '<span class="cursor">▌</span>';
    addCodeCopyButtons(liveBody);
    scroll();
  };

  // Takılma koruması: 3 dk boyunca hiçbir ilerleme yoksa kullanıcıyı bilgilendir
  let lastBeat = Date.now();
  const beat = () => { lastBeat = Date.now(); };
  const watchdog = setInterval(() => {
    const idle = (Date.now() - lastBeat) / 1000;
    if (idle > 180) {
      clearInterval(watchdog);
      liveStat.innerHTML = '⏳ 3 dakikadır yanıt yok. '
        + '<button class="btn sm ghost" id="wdRetry">Tekrar dene</button> '
        + '<button class="btn sm ghost" id="wdDiag">🩺 Tanıla</button>';
      $('#wdRetry')?.addEventListener('click', () => { live.remove(); sending = false; send(content); });
      $('#wdDiag')?.addEventListener('click', () => { go('set'); setTimeout(runDiag, 60); });
    }
  }, 5000);

  try {
    if (!conversationId) {
      conversationId = insert('conversations', {
        title: content.slice(0, 40),
        profileId: activeProfile()?.id || null,
        personaId: currentPersonaId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).id;
    } else {
      update('conversations', conversationId, { updatedAt: new Date().toISOString() });
    }
    insert('messages', { conversationId, role: 'user', content });
    renderSidebar();

    // v31 COMPACTION (benim session-memory modelim): uzun konuşma özetlenir, bağlam kaybolmaz
    let summary = '';
    try {
      const conv = find('conversations', conversationId);
      summary = conv?.summary || '';
      const fullMsgs = all('messages').filter((m) => m.conversationId === conversationId);
      const needAt = conv?.summaryLen ? conv.summaryLen + 20 : 28;
      if (fullMsgs.length > needAt) {
        const oldChunk = fullMsgs.slice(0, fullMsgs.length - 24)
          .map((m) => `${m.role}: ${String(m.content).slice(0, 240)}`).join('\n').slice(0, 6000);
        const r = await rawChat([
          { role: 'system', content: 'Eski konuşmayı 3-6 maddede özetle. YALNIZCA JSON dön: {"ozet":"..."}' },
          { role: 'user', content: oldChunk + (summary ? '\n\nÖnceki özet: ' + summary : '') },
        ], { json: true, maxTokens: 400 });
        const oz = String((JSON.parse(r.content) || {}).ozet || '').slice(0, 1500);
        if (oz) {
          summary = oz;
          update('conversations', conversationId, { summary: oz, summaryLen: fullMsgs.length });
        }
      }
    } catch { /* özet opsiyonel */ }

    const history = all('messages').filter((m) => m.conversationId === conversationId).slice(-24)
      .map((m) => ({ role: m.role, content: m.content }));
    const pers = personaPrompt(currentPersonaId());
    const sysPrompt = evo.buildSystemPrompt()
      + (summary ? `\n\n## ÖNCEKİ KONUŞMA ÖZETİ (bağlam)\n${summary}` : '')
      + (pers ? `\n\n## ŞU ANKİ ROLÜN\n${pers}` : '');
    const messages = [{ role: 'system', content: sysPrompt }, ...history];

    // v26 REFLEKS: beyin yoksa bile selam/small-talk/matematik/saat ANINDA cevaplanır.
    // Sessizlik yasak — kullanıcı her yazdığında bir şey duyar.
    {
      const a0 = activeLLM();
      const brainReady = !(a0.id === 'local' && !localStatus().ready)
        || !!(getSettings().solo && wasmStatus().supported);   // 🔌 bağımsız mod: cihaz beyni ilk mesajda kurulur
      if (!brainReady) {
        const rx = reflexAnswer(content, { userName: getSettings().userName });
        if (rx) {
          clearInterval(watchdog);
          live.remove();
          typing(true);
          await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
          typing(false);
          const rxMsg = insert('messages', { conversationId, role: 'assistant', content: rx, model: 'refleks' });
          addMsg(rxMsg);
          busy($('#send'), false);
          sending = false;
          return;
        }
      }
    }

    // Beyin hazır değilse: SESSIZCE indirme başlatma; önce anahtarsız kaynağı ARA,
    // bulamazsan KULLANICIDAN ANAHTAR İSTEME — tek dokunuşluk ücretsiz bağlantı sun.
    const a = activeLLM();
    if (a.id === 'local' && !localStatus().ready && !puterStatus().ready
      && !(getSettings().solo && wasmStatus().supported)) {   // 🔌 bağımsız modda bulut kapıları atlanır
      if (!localStatus().supported) {
        // v22: SIFIR SÜRTÜNME — gönder dokunuşu jestin kendisi; ücretsiz bulut
        // penceresini BEKLEMEDEN aç, girince soruyu otomatik sor. Kart yok, kurulum yok.
        // v24: KENDİLİĞİNDEN HİÇBİR SİTEYE YÖNLENDİRME YOK.
        // Sessizce ev bulutuna bak; yoksa NET SEÇİM kartı (uygulama içi kurulum birincil).
        let connected = false;
        liveStat.textContent = '🏠 Ev bulutu kontrol ediliyor…';
        beat();
        try { connected = await probeHouse(1800); } catch { connected = false; }
        if (connected && houseStatus().ready) {
          refreshStatus(); renderSettings(); renderLocalBoxes();
          liveStat.textContent = '🏠 Ev bulutu hazır — cevabını yazıyorum…';
          beat();
        } else {
          clearInterval(watchdog);
          live.remove();
          busy($('#send'), false);
          sending = false;
          askBrain(content);
          return;
        }
      } else {
        // Cihaz modeli çalışabilir: sessiz indirme YOK — net seçim sun
        liveStat.textContent = '☁️ Ücretsiz bulut modeli aranıyor…';
        beat();
        const found = await Promise.race([
          probeKeyless({ onProgress: (t) => { liveStat.textContent = t; beat(); } }),
          new Promise((r) => setTimeout(() => r(null), 4000)),
        ]).catch(() => null);
        if (!found) {
          clearInterval(watchdog);
          live.remove();
          busy($('#send'), false);
          sending = false;
          askBrain(content);
          return;
        }
        refreshStatus();
      }
    }

    // v33 PROFESYONEL MOD: kompleks isteğe taslak -> öz-eleştiri -> final turu
    const complex = content.length > 120 || /(plan|analiz|rapor|strateji|karşılaştır|karsilastir|tasar|öneri|oneri|değerlendir|degerlendir|müfredat|program)/i.test(content);
    if (complex) {
      try {
        liveStat.textContent = '🤔 Profesyonel mod: taslak çıkarıp eleştiriyorum…';
        beat();
        const draft = await agentChat(messages, { temperature: 0.6, maxTokens: 700 });
        messages.push({ role: 'system', content: `PROFESYONEL SON TUR: şu taslağı eleştirip SON cevabı yaz: ilk cümlede net cevap (BLUF), göreve uygun yapı (plan→numaralı, karşılaştırma→tablo, analiz→başlık+madde), somut örnek/sayı, gerekirse kaynak linki, sonda TEK satır sonraki adım önerisi. Taslak:\n${String(draft.content || '').slice(0, 3000)}` });
      } catch { /* taslak opsiyonel */ }
    }

    let res;
    let selfChecked = false;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await agentChat(messages, {
          temperature: 0.7,
          maxTokens: 1200,
          onChunk,
          onTool,
          onProgress: (pct, t) => {
            beat();
            if (pct > 0 && pct < 100) {
              liveStat.textContent = `⬇️ ${t || ''} %${pct}`;
              setLocalProgress(pct, t);
            } else if (t) {
              liveStat.textContent = t;
            }
          },
        });
        // v31 ÖZ-DENETİM (benim test-döngümün karşılığı): cevap yetersizse bir kez düzelt
        if (!selfChecked) {
          const chk = cevapYeterliMi(content, res.content);
          if (!chk.ok) {
            selfChecked = true;
            liveStat.textContent = '🔍 Cevabımı doğruluyorum — daha iyisini yazıyorum…';
            beat();
            messages.push({ role: 'system', content: `ÖZ DENETİM: önceki cevap yetersizdi (${chk.neden}). Aynı soruya daha dolu, doğrudan, gerekirse maddeli cevap ver.` });
            continue;
          }
        }
        break;
      } catch (e429) {
        const em = String(e429?.message || e429);
        if (attempt === 0 && /429|kota|hız limiti|overloaded/i.test(em)) {
          // v29: kota doluysa ev anahtarını 60 sn dinlendir, ZİNCİRLE bir deneme daha
          markHouseDown(60000);
          liveStat.textContent = '⏳ Ücretsiz kota dolu — yedek beyin devreye alınıyor…';
          beat();
          refreshStatus();
          continue;
        }
        if (/BEYIN_YOK/.test(em)) {
          clearInterval(watchdog);
          live.remove();
          typing(false);
          busy($('#send'), false);
          sending = false;
          askBrain(content);
          return;
        }
        throw e429;
      }
    }
    const reply = res.content;
    beat();
    clearInterval(watchdog);
    live.remove();
    typing(false);

    const botMsg = insert('messages', {
      conversationId, role: 'assistant', content: reply,
      model: res.model || null, steps: (res.steps || []).map((s) => ({ tool: s.tool, ms: s.ms })),
    });
    const node = addMsg(botMsg);
    // v33: arka planda tercih/bilgi çıkarımı — her uzun cevaptan sonra sessizce öğren
    if (String(reply).length > 300) {
      const nAssist = all('messages').filter((m) => m.conversationId === conversationId && m.role === 'assistant').length;
      if (nAssist % 2 === 1) {
        rawChat([
          { role: 'system', content: 'Kullanıcı hakkında KALICI tercih/bilgi çıkar (iş, şehir, biçim tercihi, hedef). YALNIZCA JSON: {"facts":["..."]} — yoksa {"facts":[]}' },
          { role: 'user', content: content + '\n---\n' + String(reply).slice(0, 1500) },
        ], { json: true, maxTokens: 200, model: 'openai/gpt-oss-20b' })
          .then((r) => {
            const f = (JSON.parse(r.content) || {}).facts || [];
            f.slice(0, 2).forEach((x) => evo.addMemory({ content: String(x).slice(0, 140), kind: 'fact', source: 'auto', strength: 0.7 }));
          })
          .catch(() => {});
      }
    }
    // Araç adımları kaybolmasın: canlı baloncuktan kalıcı mesaja taşı
    if (toolBox && toolBox.children.length && node) {
      const ts = document.createElement('div');
      ts.className = 'toolsteps done';
      ts.innerHTML = toolBox.innerHTML;
      node.prepend(ts);
    }
    // hangi model + kaç araç adımı -> şeffaflık
    if (node && (res.model || res.steps?.length)) {
      const info = document.createElement('div');
      info.className = 'agentinfo';
      info.innerHTML = `${res.steps?.length ? `<span title="${esc(res.steps.map((s) => s.tool).join(' → '))}">🔧 ${res.steps.length} araç</span>` : ''}`
        + `${res.model ? `<span>${esc(String(res.model).replace(':free', '').split('/').pop())}</span>` : ''}`;
      node.appendChild(info);
    }
    renderSidebar();

    evo.evolveAfterTurn({ conversationId, userText: content, assistantText: reply, messageId: botMsg.id })
      .then(() => refreshStatus())
      .catch((e) => console.error('[evolve]', e));
  } catch (err) {
    clearInterval(watchdog);
    live.remove();
    typing(false);
    const msg = String(err?.message || err);
    // Bayat/geçersiz anahtar kullanıcıyı kilitlemesin: temizle + ücretsiz yola geç
    if (/geçersiz|invalid|401|unauthorized/i.test(msg) && (getSettings().apiKey || '').trim()) {
      setSettings({ apiKey: '', model: '' });
      refreshStatus(); renderSettings();
      sending = false;
      addMsg({
        role: 'assistant', error: true, createdAt: new Date().toISOString(),
        content: '🔑 Bu cihazda kayıtlı bulut anahtarı geçersiz görünüyor — sildim, kimse senden anahtar istemeyecek. Şimdi ücretsiz bağlantıyı kuralım:',
      });
      askBrain(content);
      return;
    }
    const st = localStatus();
    const a = activeLLM();
    let extra = '';
    if (a.id === 'local') {
      extra = '\n\n**Ne yapabilirsin?**\n'
        + '1. ☁️ Ücretsiz bulut bağlantısı: sohbetteki "Ücretsiz bağlan" düğmesi (ANAHTAR İSTEMEZ)\n'
        + '2. 🩺 Ayarlar → "Tanıla" ile hangi kaynağın kapalı olduğunu gör\n'
        + '3. 📥 Ayarlar → açık kaynak modeli cihazında çalıştır';
    }
    addMsg({
      role: 'assistant',
      content: `⚠️ **Yanıt alınamadı**\n\n${err.message}${extra}`,
      error: true, createdAt: new Date().toISOString(),
    });
    console.error('[send]', err);
  } finally {
    clearInterval(watchdog);
    busy($('#send'), false);
    sending = false;
    refreshStatus();
  }
}

$('#send').addEventListener('click', () => send());
$('#input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
function autoGrow() {
  const el = $('#input');
  el.style.height = 'auto';
  el.style.height = Math.min(120, el.scrollHeight) + 'px';
}
$('#input').addEventListener('input', autoGrow);
$$('[data-quick]').forEach((b) => b.addEventListener('click', () => send(b.dataset.quick)));

function loadChat(convId) {
  const pid = activeProfile()?.id;
  const convs = all('conversations')
    .filter((c) => !pid || !c.profileId || c.profileId === pid)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  if (convId) {
    conversationId = convId;
  } else if (convs.length) {
    conversationId = convs[0].id;
  } else { conversationId = null; }
  const msgs = all('messages').filter((m) => m.conversationId === conversationId);
  $('#msgs').innerHTML = '';
  if (!msgs.length) {
    $('#welcomeCard').style.display = 'block';
    $('#chatEmpty').style.display = 'none';
    renderSidebar();
    return;
  }
  $('#welcomeCard').style.display = 'none';
  $('#chatEmpty').style.display = 'none';
  msgs.forEach(addMsg);
  renderSidebar();
  requestAnimationFrame(scrollBottom);
}

function newChat() {
  conversationId = null;
  $('#msgs').innerHTML = '';
  $('#welcomeCard').style.display = 'block';
  $('#chatEmpty').style.display = 'none';
  go('chat');
  renderSidebar();
  setTimeout(() => $('#input')?.focus(), 80);
}

/* ---------------- durum ---------------- */
function setBrainBar(text) {
  // v21: sohbet ekranı her cihazda "hazır" görünür — uyarı bandı yok.
  const bar = $('#brainBar');
  if (bar) bar.style.display = 'none';
  return;
  if (!bar) return;
  if (!text) { bar.style.display = 'none'; return; }
  const sub = $('#brainBarSub'); if (sub) sub.textContent = text;
  bar.style.display = 'flex';
}

function refreshStatus() {
  const a = activeLLM();
  const st = evo.stats();
  const ls = learn.learningStats();
  const pill = $('#statusPill');
  const loc = localStatus();

  if (a.houseKey) {
    pill.textContent = '⚡ ev anahtarı · herkes için hazır';
    pill.className = 'pill ok';
    setBrainBar(null);
  } else if (a.id === 'wasm') {
    pill.textContent = '🧠 küçük beyin · cihazında';
    pill.className = 'pill ok';
    setBrainBar(null);
  } else if (a.id === 'house') {
    pill.textContent = '🏠 ev bulutu · anahtarsız hazır';
    pill.className = 'pill ok';
    setBrainBar(null);
  } else if (a.id === 'puter') {
    pill.textContent = '☁️ Puter · anahtarsız bulut';
    pill.className = 'pill ok';
    setBrainBar(null);
  } else if (a.id === 'nano') {
    pill.textContent = '⚡ Chrome Nano · anahtarsız, sınırsız';
    pill.className = 'pill ok';
    setBrainBar(null);
  } else if (a.id === 'free') {
    pill.textContent = '🌐 ücretsiz servis · anahtarsız';
    pill.className = 'pill ok';
    closeSetupModal();
  } else if (a.id === 'local') {
    if (loc.ready) {
      pill.textContent = `🧠 ${shortName(loc.modelId)} · cihazında`;
      pill.className = 'pill ok';
      setBrainBar(null);
    } else if (loc.supported) {
      pill.textContent = loc.loading ? `indiriliyor %${loc.progress}` : '🧠 modeli başlat';
      pill.className = loc.loading ? 'pill demo' : 'pill ok';
      setBrainBar(null);
    } else {
      pill.textContent = '🆓 ücretsiz mod · anahtar yok';
      pill.className = 'pill ok';
      setBrainBar(null);
    }
  } else {
    pill.textContent = `${a.def.name} · ${String(a.model).split('/').pop()}`;
    pill.className = 'pill ok';
    setBrainBar(null);
  }
  const sbEl = $('#subBrand'); if (sbEl && currentView !== 'chat') sbEl.textContent = `beyin v${st.promptVersion} · ${st.memories} hafıza`;
  renderLocalBoxes();
  const pb = $('#pendingBadge');
  pb.style.display = st.pendingPatches ? 'grid' : 'none';
  pb.textContent = st.pendingPatches;
  const db = $('#dueBadge');
  db.style.display = ls.due ? 'grid' : 'none';
  db.textContent = ls.due;
  if (currentView === 'evo') renderEvoStats(st);
  if (currentView === 'learn') renderLearnStats(ls);
}

/* ---------------- öğren ---------------- */
let dueQueue = [];
function renderLearnStats(l) {
  $('#learnStats').innerHTML = `
    <div class="stat"><b>${l.due}</b><span>bekleyen kart</span></div>
    <div class="stat"><b>%${l.accuracy}</b><span>doğruluk</span></div>
    <div class="stat"><b>${l.cards}</b><span>toplam kart</span></div>`;
}
function renderLearn() {
  const l = learn.learningStats();
  renderLearnStats(l);
  dueQueue = learn.dueCards();
  $('#dueChip').textContent = `${dueQueue.length} kart hazır${l.seri > 0 ? ` · 🔥 ${l.seri} gün seri` : ''}`;
  nextCard();
  const list = learn.cards();
  $('#cardList').innerHTML = list.length ? list.map((c) => `
    <div class="item">
      <div class="t">${esc(c.topic)} <span class="chip">zorluk ${c.difficulty}</span> <span class="chip">kutu ${c.box}</span></div>
      <div class="s">${esc(c.question)}</div>
      <div class="a">
        <span class="chip ${c.reviews ? (c.correct / c.reviews > 0.6 ? 'ok' : 'warn') : ''}">${c.correct}/${c.reviews} doğru</span>
        <span class="chip">sonraki: ${new Date(c.dueAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
        <button class="btn sm danger" data-del="${c.id}" style="margin-left:auto">Sil</button>
      </div>
    </div>`).join('') : '<div class="empty">Kart yok — yukarıdan AI ile soru üret.</div>';
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => { learn.deleteCard(b.dataset.del); renderLearn(); refreshStatus(); }));
}
function nextCard() {
  const box = $('#studyBox');
  const c = dueQueue.shift();
  if (!c) { box.innerHTML = '<div class="card"><p class="hint">🎉 Tekrar bekleyen kart yok. Yeni soru üret ya da daha sonra gel.</p></div>'; return; }
  box.innerHTML = `
    <div class="card">
      <span class="chip acc">${esc(c.topic)}</span> <span class="chip">zorluk ${c.difficulty}/5</span>
      <h3 style="margin:10px 0 8px;font-size:15.5px;white-space:pre-wrap">${esc(c.question)}</h3>
      <textarea id="ans" placeholder="Cevabın…"></textarea>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="btnGrade">Kontrol et</button>
        <button class="btn ghost" id="btnSkip">Atla</button>
      </div>
      <div id="gradeOut"></div>
    </div>`;
  $('#btnSkip').addEventListener('click', nextCard);
  $('#btnGrade').addEventListener('click', async () => {
    const btn = $('#btnGrade');
    busy(btn, true, 'Değerlendiriliyor…');
    try {
      const r = await learn.gradeAnswer({ cardId: c.id, userAnswer: $('#ans').value });
      $('#gradeOut').innerHTML = `<hr><div class="item" style="border-color:${r.correct ? 'rgba(52,211,153,.4)' : 'rgba(251,113,133,.4)'}">
        <div class="t">${r.correct ? '✅ Doğru' : '❌ Yanlış'} <span class="chip">${r.nextInHours} saat sonra tekrar</span></div>
        <div class="s">${esc(r.feedback || '')}</div>
        <div class="s muted"><b>Doğru cevap:</b> ${esc(c.answer)}</div>
        ${c.explanation ? `<div class="s muted">${esc(c.explanation)}</div>` : ''}
        <div class="a"><button class="btn sm" id="btnNext">Sonraki kart →</button></div></div>`;
      $('#btnNext').addEventListener('click', () => { renderLearn(); });
      refreshStatus();
    } catch (e) { toast(e.message, 'bad'); }
    finally { busy(btn, false); }
  });
}
$('#btnGen').addEventListener('click', async () => {
  const topic = $('#genTopic').value.trim();
  if (!topic) return toast('Önce bir konu yaz', 'bad');
  busy($('#btnGen'), true, 'Sorular üretiliyor…');
  try {
    const r = await learn.generateCards({ topic, count: Number($('#genCount').value), level: Number($('#genLevel').value) });
    if (r.message) toast(r.message, 'bad');
    else { toast(`${r.cards.length} soru üretildi ✨`, 'ok'); renderLearn(); refreshStatus(); }
  } catch (e) { toast(e.message, 'bad'); }
  finally { busy($('#btnGen'), false); }
});
$('#btnPlan').addEventListener('click', async () => {
  const goal = $('#planGoal').value.trim();
  if (!goal) return toast('Hedefini yaz', 'bad');
  busy($('#btnPlan'), true, 'Plan hazırlanıyor…');
  try { $('#planOut').textContent = (await learn.makePlan({ goal, minutesPerDay: Number($('#planMin').value) })).plan; }
  catch (e) { toast(e.message, 'bad'); }
  finally { busy($('#btnPlan'), false); }
});

/* ---------------- github ---------------- */
let ghCtx = null;
$('#btnLoadRepo').addEventListener('click', loadRepo);
async function loadRepo() {
  const full = gh.parseRepo($('#ghRepoInput').value);
  if (!full) return toast('Biçim: kullanici/repo', 'bad');
  setSettings({ githubRepo: full });
  const body = $('#ghBody');
  body.innerHTML = '<div class="card"><span class="spin"></span> <span class="muted">Repo okunuyor…</span></div>';
  busy($('#btnLoadRepo'), true, '…');
  try {
    const info = await gh.repoInfo(full);
    const tree = await gh.fileTree(full, info.defaultBranch).catch(() => ({ files: [] }));
    const commits = await gh.recentCommits(full, 10).catch(() => []);
    const issues = await gh.listIssues(full, 10).catch(() => []);
    ghCtx = { full, info, tree, commits, issues };
    body.innerHTML = `
      <div class="card">
        <h3>${esc(info.full)}</h3>
        <p class="hint">${esc(info.description || 'Açıklama yok')}</p>
        <div class="grid3">
          <div class="stat"><b>⭐ ${info.stars}</b><span>yıldız</span></div>
          <div class="stat"><b>${esc(info.language || '-')}</b><span>ana dil</span></div>
          <div class="stat"><b>${tree.files.length}</b><span>dosya</span></div>
        </div>
        <div class="row" style="margin-top:10px">
          <a class="btn ghost sm" href="${info.htmlUrl}" target="_blank" rel="noopener">GitHub’da aç</a>
          <button class="btn sm" id="btnAnalyze">🔍 AI ile analiz et</button>
          <button class="btn ghost sm" id="btnDaily">📅 24 saat özeti</button>
        </div>
        <div id="analysisOut" style="margin-top:10px;white-space:pre-wrap;font-size:13.5px"></div>
      </div>
      <div class="sect">Son commitler</div>
      ${commits.map((c) => `<div class="item"><div class="t">${esc(c.message)}</div>
        <div class="s"><span class="mono">${c.sha}</span> · ${esc(c.author)} · ${new Date(c.date).toLocaleString('tr-TR')}</div></div>`).join('') || '<div class="empty">Commit yok</div>'}
      <div class="sect">Açık issue’lar</div>
      ${issues.map((x) => `<div class="item"><div class="t">#${x.number} ${esc(x.title)}</div>
        <div class="a">${x.labels.map((l) => `<span class="chip">${esc(l)}</span>`).join('')}</div></div>`).join('') || '<div class="empty">Açık issue yok 🎉</div>'}
      <div class="sect">Dosyalar</div>
      ${tree.files.slice(0, 120).map((f) => `<div class="item" style="padding:8px 10px">
        <div class="t mono" style="font-weight:500">${esc(f.path)}</div>
        <div class="a"><span class="chip">${(f.size / 1024).toFixed(1)} KB</span>
        <button class="btn sm ghost" data-open="${esc(f.path)}">Aç</button></div></div>`).join('')}
      <pre id="fileOut" style="display:none"></pre>`;
    $('#btnAnalyze').addEventListener('click', async () => {
      const out = $('#analysisOut');
      busy($('#btnAnalyze'), true, 'Analiz (30-60 sn)…');
      try { out.innerHTML = md((await gh.analyzeRepo(full)).report); }
      catch (e) { out.textContent = '⚠️ ' + e.message; }
      finally { busy($('#btnAnalyze'), false); }
    });
    $('#btnDaily').addEventListener('click', async () => {
      const out = $('#analysisOut');
      busy($('#btnDaily'), true, 'Özetleniyor…');
      try { const r = await gh.dailySummary(full); out.innerHTML = md(r.summary); }
      catch (e) { out.textContent = '⚠️ ' + e.message; }
      finally { busy($('#btnDaily'), false); }
    });
    $$('[data-open]').forEach((b) => b.addEventListener('click', async () => {
      const pre = $('#fileOut');
      pre.style.display = 'block';
      pre.textContent = 'yükleniyor…';
      try {
        const f = await gh.readFile(full, b.dataset.open, info.defaultBranch);
        pre.textContent = `// ${f.path}\n\n${f.content.slice(0, 20000)}`;
        pre.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) { pre.textContent = '⚠️ ' + e.message; }
    }));
  } catch (e) {
    body.innerHTML = `<div class="card">⚠️ ${esc(e.message)}</div>`;
  } finally { busy($('#btnLoadRepo'), false); }
}
$('#btnMyRepos').addEventListener('click', async () => {
  const box = $('#repoPicker');
  if (!getSettings().githubToken) {
    box.innerHTML = '<div class="empty">Liste için Ayarlar → GitHub bölümüne token gir. Public repoları token’sız da yazıp yükleyebilirsin.</div>';
    return;
  }
  box.innerHTML = '<span class="spin"></span> <span class="muted">yükleniyor…</span>';
  try {
    const repos = await gh.searchMyRepos();
    box.innerHTML = repos.length ? repos.slice(0, 40).map((r) => `<div class="item" style="padding:8px 10px">
      <div class="t">${esc(r.full)} ${r.private ? '🔒' : ''}</div>
      <div class="a"><button class="btn sm ghost" data-pick="${esc(r.full)}">İncele</button></div></div>`).join('') : '<div class="empty">Repo bulunamadı</div>';
    $$('[data-pick]').forEach((b) => b.addEventListener('click', () => { $('#ghRepoInput').value = b.dataset.pick; loadRepo(); }));
  } catch (e) { box.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; }
});

/* ---------------- evrim ---------------- */
function renderEvoStats(st) {
  $('#evoStats').innerHTML = `
    <div class="stat"><b>v${st.promptVersion}</b><span>beyin sürümü</span></div>
    <div class="stat"><b>${st.memories}</b><span>hafıza</span></div>
    <div class="stat"><b>${st.evolutions}</b><span>gelişim kaydı</span></div>`;
}
const KIND_TR = { fact: 'Bilgi', preference: 'Tercih', skill: 'Beceri', mistake: 'Hata', rule: 'Kural' };
const TYPE_TR = { 'prompt-patch': '🧠 Kural yaması', memory: '💾 Hafıza', feedback: '👍 Geri bildirim', plan: '🗓 Plan', error: '⚠️ Hata' };
let memFilter = '';

function renderEvo() {
  const st = evo.stats();
  renderEvoStats(st);
  const evos = all('evolutions').slice().reverse();
  const pending = evos.filter((e) => e.type === 'prompt-patch' && !e.applied && !e.rejected);

  $('#pendingList').innerHTML = pending.length ? pending.map((e) => `
    <div class="item" style="border-color:rgba(124,92,255,.45)">
      <div class="t">${esc(e.summary)}</div>
      <div class="s">${esc(e.detail || '')}</div>
      <div class="a"><span class="chip">güven ${((e.confidence || 0) * 100) | 0}%</span>
        <button class="btn sm ok" data-approve="${e.id}">Uygula</button>
        <button class="btn sm danger" data-reject="${e.id}">Reddet</button></div>
    </div>`).join('') : '<div class="empty">Bekleyen yama yok — EVRIM şimdiki kurallarından memnun 🙂</div>';
  $$('[data-approve]').forEach((b) => b.addEventListener('click', () => { evo.approveEvolution(b.dataset.approve); toast('Yama uygulandı 🧬', 'ok'); renderEvo(); refreshStatus(); }));
  $$('[data-reject]').forEach((b) => b.addEventListener('click', () => { evo.rejectEvolution(b.dataset.reject); toast('Reddedildi'); renderEvo(); refreshStatus(); }));

  $('#evoList').innerHTML = evos.length ? evos.slice(0, 40).map((e) => `
    <div class="item">
      <div class="t">${TYPE_TR[e.type] || e.type} ${e.applied ? '<span class="chip ok">uygulandı</span>' : '<span class="chip warn">pasif</span>'}</div>
      <div class="s">${esc(e.summary)}${e.detail ? '\n' + esc(e.detail) : ''}</div>
      <div class="a"><span class="chip">${new Date(e.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
    </div>`).join('') : '<div class="empty">Henüz kayıt yok — sohbet ettikçe dolacak.</div>';

  const prompts = all('prompts').slice().reverse();
  $('#curVer').textContent = 'v' + (prompts[0]?.version || 1);
  $('#promptVersions').innerHTML = prompts.map((p) => `
    <div class="item">
      <div class="t">v${p.version} <span class="chip">${esc(p.source)}</span></div>
      <div class="s">${esc(p.reason || '')}</div>
      <div class="a"><span class="chip">${new Date(p.createdAt).toLocaleString('tr-TR')}</span>
      ${prompts[0].id === p.id ? '<span class="chip ok">aktif</span>' : `<button class="btn sm ghost" data-rb="${p.id}">Bu sürüme dön</button>`}</div>
    </div>`).join('');
  $$('[data-rb]').forEach((b) => b.addEventListener('click', () => { rollbackPrompt(b.dataset.rb); toast('Eski sürüme dönüldü'); renderEvo(); refreshStatus(); }));

  const skills = all('skills');
  $('#skillList').innerHTML = skills.length ? skills.map((s) => `
    <div class="item"><div class="t">${esc(s.topic)} <span class="chip">seviye ${s.level}/5</span></div>
      <div class="bar"><i style="width:${s.level * 20}%"></i></div>
      <div class="s">${esc(s.note || '')}</div></div>`).join('') : '<div class="empty">Beceri haritası boş — Öğren sekmesinde çalıştıkça dolacak.</div>';

  renderMemories();
}

function renderMemories() {
  const list = evo.memories(memFilter || undefined);
  $('#memList').innerHTML = list.length ? list.map((m) => `
    <div class="item">
      <div class="t">${esc(m.content)}</div>
      <div class="a"><span class="chip acc">${KIND_TR[m.kind] || m.kind}</span>
        <span class="chip">güven ${((m.strength || 0) * 100) | 0}%</span>
        <span class="chip">${m.hits || 1} kez</span>
        <button class="btn sm danger" data-forget="${m.id}" style="margin-left:auto">Unut</button></div>
    </div>`).join('') : '<div class="empty">Bu kategoride kayıt yok.</div>';
  $$('[data-forget]').forEach((b) => b.addEventListener('click', () => { evo.forgetMemory(b.dataset.forget); toast('Unutuldu'); renderMemories(); refreshStatus(); }));
}
$$('#memTabs button').forEach((b) => b.addEventListener('click', () => {
  $$('#memTabs button').forEach((x) => x.classList.remove('on'));
  b.classList.add('on'); memFilter = b.dataset.mk; renderMemories();
}));
$('#btnAddMem').addEventListener('click', () => {
  const content = $('#memText').value.trim();
  if (!content) return toast('Bir şey yaz', 'bad');
  evo.addMemory({ content, kind: $('#memKind').value, source: 'user', strength: 0.9 });
  insert('evolutions', { type: 'memory', summary: `Kullanıcı ekledi: ${content}`, applied: true, confidence: 1 });
  $('#memText').value = '';
  toast('Hafızaya eklendi 🧠', 'ok');
  renderMemories(); refreshStatus();
});
$('#btnShowPrompt').addEventListener('click', () => {
  const el = $('#promptOut');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
  el.textContent = evo.buildSystemPrompt();
});
$('#btnEditPrompt').addEventListener('click', () => {
  const box = $('#promptEdit');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
  if (box.style.display === 'block') $('#promptText').value = currentPrompt().text;
});
$('#btnSavePrompt').addEventListener('click', () => {
  const text = $('#promptText').value.trim();
  if (!text) return toast('Metin boş olamaz', 'bad');
  const v = pushPromptVersion({ text, reason: $('#promptReason').value || 'Kullanıcı düzenledi', source: 'user' });
  toast(`Beyin v${v.version} kaydedildi`, 'ok');
  renderEvo(); refreshStatus();
});

/* ---------------- ayarlar ---------------- */
async function fillModelOptions(providerId) {
  const sel = $('#setModel');
  if (!sel) return;
  const def = PROVIDERS[providerId];
  let list = def?.models || [];
  const cur = getSettings().model;
  const paint = (items, label) => {
    sel.innerHTML = `<option value="">${label}</option>` +
      items.map((m) => {
        const id = typeof m === 'string' ? m : m.id;
        const txt = typeof m === 'string' ? m : `${m.name || m.id} · ${Math.round((m.ctx || 0) / 1000)}k`;
        return `<option value="${esc(id)}" ${id === cur ? 'selected' : ''}>${esc(txt)}</option>`;
      }).join('');
  };
  if (def?.dynamic) {
    paint([], 'Otomatik (en iyi ücretsiz model seçilir)');
    const free = await fetchFreeModels();
    paint(free, `Otomatik: ${free[0]?.id || 'en iyi ücretsiz'}`);
  } else {
    paint(list, `Varsayılan (${def?.defaultModel || '-'})`);
  }
}

function renderSettings() {
  const s = getSettings();
  $('#setKey').value = s.apiKey || '';
  const detected = detectProvider(s.apiKey) || s.provider || 'groq';
  fillModelOptions(detected === 'auto' ? 'groq' : detected).catch(() => {});
  $('#setEvolve').checked = s.selfEvolution;
  $('#setAuto').checked = s.autoApply !== false;
  $('#setThr').value = s.evolveThreshold;
  $('#thrLabel').textContent = Number(s.evolveThreshold).toFixed(2);
  $('#setName').value = s.userName || '';
  $('#setGhToken').value = s.githubToken || '';
  const lpin = $('#setLinuxPin'); if (lpin) lpin.value = s.linuxPin || '';
  const lpst = $('#linuxPinState'); if (lpst) lpst.textContent = s.linuxPin ? '🔒 PIN koruması AÇIK' : '🔓 PIN koruması kapalı';
  $('#setGhRepo').value = s.githubRepo || '';
  renderHouseBox();
  renderWasmBox();
  const pf = $('#setPreferFree');
  if (pf) {
    pf.checked = getSettings().preferFree !== false;
    pf.onchange = () => { setSettings({ preferFree: pf.checked }); refreshStatus(); };
  }
  const soloEl = $('#setSolo');
  if (soloEl) {
    soloEl.checked = !!getSettings().solo;
    soloEl.onchange = async () => {
      setSettings({ solo: soloEl.checked });
      if (soloEl.checked) {
        const hazir = wasmStatus().ready || nanoStatus().availability === 'available' || localStatus().ready;
        if (hazir) {
          toast('🔌 Bağımsız mod AÇIK — bulut tamamen kapalı, cihaz beyni hazır', 'ok');
        } else if (wasmStatus().supported) {
          let evet = false;
          try { evet = !!confirm('Bağımsız mod için cihaz beyni kurulacak: ~90 MB, tek seferlik indirme (sonrası tamamen çevrimdışı). Şimdi kurulsun mu?'); } catch { evet = false; }
          if (evet) {
            toast('🧠 Küçük beyin kuruluyor… %0');
            try {
              await loadWasm((p2) => { if (p2 % 20 === 0) toast(`🧠 Cihaz beyni kuruluyor… %${p2}`); });
              toast('🧠 Cihaz beyni hazır — artık tamamen bağımsızsın 🔌', 'ok');
            } catch (e) { toast('Beyin kurulamadı: ' + String(e.message || e).slice(0, 60), 'bad'); }
          } else {
            toast('🔌 Bağımsız mod açık — cihaz beyni ilk mesajda kurulur (~90 MB, bir kez)', 'ok');
          }
        } else {
          toast('Bu tarayıcıda cihaz beyni desteklenmiyor — bağımsız mod çalışmayabilir', 'bad');
        }
      } else {
        toast('☁️ Bağımsız mod kapalı — akıllı sıra (bulut + cihaz) yeniden aktif', 'ok');
      }
      refreshStatus(); renderSettings();
    };
  }
  const freeBox = $('#freeBox');
  if (freeBox) {
    const snap = freeCacheSnapshot();
    freeBox.innerHTML = snap.length
      ? snap.map((c) => `<span class="chip ${c.ok ? 'ok' : 'warn'}">${c.ok ? '✅' : '❌'} ${esc(c.name)}</span>`).join(' ')
      : '<span class="chip">henüz test edilmedi</span>';
  }
  const tierSel = $('#setTier');
  if (tierSel) {
    const cur = s.localTier || guessTier();
    tierSel.innerHTML = MODEL_TIERS.map((t) =>
      `<option value="${t.id}" ${t.id === cur ? 'selected' : ''}>${t.label} — ${t.hint}</option>`).join('');
    tierSel.onchange = () => setSettings({ localTier: tierSel.value });
  }
  const a = activeLLM();
  const st = evo.stats();
  $('#dataInfo').innerHTML = `Depolama: <b>${(storageSize() / 1024).toFixed(1)} KB</b> · ${st.memories} hafıza · ${all('messages').length} mesaj`;
  $('#sysInfo').innerHTML = `
    <div class="kv"><span>Sağlayıcı</span><b>${esc(a.def?.name || 'yok')}</b></div>
    <div class="kv"><span>Model</span><b>${esc(a.model || '-')}</b></div>
    <div class="kv"><span>Beyin sürümü</span><b>v${st.promptVersion}</b></div>
    <div class="kv"><span>Hafıza</span><b>${st.memories}</b></div>
    <div class="kv"><span>Öğrenme kartı</span><b>${st.cards}</b></div>
    <div class="kv"><span>Mod</span><b>${getSettings().solo ? '🔌 Bağımsız — yalnız cihaz beyni' : '☁️ Karma — bulut + cihaz'}</b></div>
    <div class="kv"><span>Çalışma biçimi</span><b>%100 tarayıcı (sunucusuz)</b></div>`;
  renderLocalBoxes();
  renderSmartCard();
  renderNanoBox();
  renderPuterBox();
  const up = $('#setUsePuter');
  if (up) {
    up.checked = getSettings().usePuter !== false;
    up.onchange = () => { setSettings({ usePuter: up.checked }); refreshStatus(); };
  }
}
$('#setKey').addEventListener('input', () => {
  const d = detectProvider($('#setKey').value.trim());
  if (d) fillModelOptions(d);
});
$('#setThr').addEventListener('input', () => ($('#thrLabel').textContent = Number($('#setThr').value).toFixed(2)));

$('#btnSaveAI').addEventListener('click', () => {
  const key = $('#setKey').value.trim();
  const d = detectProvider(key);
  setSettings({ provider: d || 'auto', apiKey: key, model: $('#setModel').value });
  const a = activeLLM();
  $('#aiOut').innerHTML = key ? `✅ Kaydedildi → <b>${esc(a.def?.name)}</b> / <span class="mono">${esc(a.model)}</span>` : 'Anahtar temizlendi (çevrimdışı)';
  toast('AI ayarları kaydedildi', 'ok');
  refreshStatus(); renderSettings();
});
$('#btnTestAI').addEventListener('click', async () => {
  busy($('#btnTestAI'), true, 'Test…');
  const r = await testConnection();
  $('#aiOut').innerHTML = r.ok
    ? `✅ <b>${esc(r.provider)}</b> çalışıyor → “${esc(r.reply)}” <span class="mono">(${esc(r.model)})</span>`
    : `⚠️ ${esc(r.error)}`;
  busy($('#btnTestAI'), false);
});
$('#btnSaveSet').addEventListener('click', () => {
  setSettings({
    selfEvolution: $('#setEvolve').checked,
    autoApply: $('#setAuto').checked,
    evolveThreshold: Number($('#setThr').value),
    userName: $('#setName').value.trim(),
  });
  toast('Ayarlar kaydedildi', 'ok');
  refreshStatus();
});
$('#btnSavePin')?.addEventListener('click', () => {
  const v = String($('#setLinuxPin')?.value || '').trim().slice(0, 8);
  setSettings({ linuxPin: v });
  const lpst = $('#linuxPinState'); if (lpst) lpst.textContent = v ? '🔒 PIN koruması AÇIK' : '🔓 PIN koruması kapalı';
  toast(v ? 'Linux PIN kaydedildi 🔒' : 'Linux PIN kaldırıldı', 'ok');
  refreshStatus(); renderSettings();
});
/* ---------------- v56: 🎙️ sesli girdi (Web Speech STT) ---------------- */
let sttRec = null;
$('#micBtn')?.addEventListener('click', () => {
  const btn = $('#micBtn');
  if (sttRec) { try { sttRec.stop(); } catch {} sttRec = null; btn.classList.remove('on'); return; }
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!SR) { toast('Bu tarayıcıda ses tanıma yok — Android Chrome önerilir', 'err'); return; }
  try {
    const r = new SR();
    r.lang = 'tr-TR'; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false;
    let finalT = '';
    r.onresult = (e) => {
      let ara = '';
      for (const res of e.results) { if (res.isFinal) finalT += res[0].transcript + ' '; else ara += res[0].transcript; }
      $('#input').value = (finalT + ara).trim();
      $('#input').dispatchEvent(new Event('input', { bubbles: true }));
    };
    r.onend = () => { btn.classList.remove('on'); sttRec = null; };
    r.onerror = (e) => { btn.classList.remove('on'); sttRec = null; if (e?.error !== 'aborted') toast('Mikrofon hatası (' + (e?.error || 'bilinmiyor') + ') — izin ayarlarını kontrol et', 'err'); };
    r.start();
    sttRec = r;
    btn.classList.add('on');
    toast('🎙️ Dinliyorum — konuş, bitince dur butonuna bas veya otomatik durur', 'ok');
  } catch { toast('Ses tanıma başlatılamadı', 'err'); }
});

/* ---------------- v56: 📄 PDF metin çıkarma (pdf.js CDN) ---------------- */
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const sc = document.createElement('script');
    sc.src = src; sc.async = true; sc.onload = () => res(); sc.onerror = () => rej(new Error('CDN yüklenemedi'));
    document.head.appendChild(sc);
  });
}
$('#pdfBtn')?.addEventListener('click', () => $('#pdfFile')?.click());
$('#pdfFile')?.addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  toast('📄 PDF okunuyor…', 'ok');
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js');
    const pdfjs = globalThis.pdfjsLib;
    if (!pdfjs) throw new Error('pdf.js yüklenemedi');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    let metin = '';
    const sayfaN = Math.min(doc.numPages, 25);
    for (let i = 1; i <= sayfaN; i++) {
      const pg = await doc.getPage(i);
      const tc = await pg.getTextContent();
      metin += tc.items.map((it) => it.str).join(' ') + '\n\n';
      if (metin.length > 14000) break;
    }
    metin = metin.replace(/\s+/g, ' ').trim();
    if (!metin) { toast('PDF metin katmanı boş (taranmış görüntü) — 📷 OCR düğmesini dene', 'err'); return; }
    send(`📄 PDF: ${file.name} (${doc.numPages} sayfa) — metnini oku, özetle ve sorularımı bekle:\n\n${metin.slice(0, 12000)}`);
  } catch (e) { toast('PDF okunamadı: ' + String(e.message || e).slice(0, 80), 'err'); }
});

/* ---------------- v56: 📷 OCR (tesseract.js CDN) ---------------- */
$('#ocrBtn')?.addEventListener('click', () => $('#ocrFile')?.click());
$('#ocrFile')?.addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  toast('📷 OCR hazırlanıyor (ilk seferde ~10 MB dil verisi iner)…', 'ok');
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    const T = globalThis.Tesseract;
    if (!T) throw new Error('tesseract yüklenemedi');
    const res = await T.recognize(file, 'tur', {
      logger: (m) => { if (m.status === 'recognizing text' && m.progress) $('#ocrBtn').title = 'OCR %' + Math.round(m.progress * 100); },
    });
    const metin = String(res?.data?.text || '').replace(/\n{3,}/g, '\n\n').trim();
    if (!metin) { toast('Fotoğrafta yazı bulunamadı — daha net/aydınlık çek', 'err'); return; }
    $('#input').value = metin.slice(0, 8000);
    $('#input').dispatchEvent(new Event('input', { bubbles: true }));
    toast('📷 Yazı çıkarıldı — düzenleyip gönder', 'ok');
  } catch (e) { toast('OCR başarısız: ' + String(e.message || e).slice(0, 80), 'err'); }
});

/* ---------------- v56: ⏰ hatırlatıcı takibi (sayfa açıkken) ---------------- */
setInterval(() => {
  try {
    const rs = all('reminders').filter((r) => !r.done && r.dueAt <= Date.now());
    for (const r of rs) {
      update('reminders', r.id, { done: true, firedAt: Date.now() });
      toast('⏰ Hatırlatma: ' + r.mesaj, 'ok');
      if ('Notification' in globalThis && Notification.permission === 'granted') {
        try { new Notification('EVRIM hatırlatıcı', { body: r.mesaj }); } catch {}
      }
    }
  } catch {}
}, 20000);

/* ---------------- v56: 🧾 tek dosya HTML yedek ---------------- */
$('#btnHtmlYedek')?.addEventListener('click', () => {
  try {
    const json = exportData();
    const html = `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EVRIM yedek ${new Date().toISOString().slice(0, 10)}</title>
<style>body{font-family:system-ui;background:#0a0e1a;color:#dbe0f5;margin:0;padding:18px}h1{font-size:18px}button{background:#7c5cff;color:#fff;border:0;border-radius:10px;padding:10px 14px;font-size:14px}.k{background:#131a30;border:1px solid #232a45;border-radius:12px;padding:10px;margin:8px 0;font-size:13px;white-space:pre-wrap;word-break:break-word}</style>
<h1>🧬 EVRIM tek dosya yedek</h1>
<p>Tüm verin bu dosyanın içinde. Geri yüklemek için: EVRIM → Ayarlar → Verilerim → "JSON'u indir" düğmesiyle buradan JSON al, orada "İçe aktar".</p>
<button onclick="indir()">⬇️ JSON'u indir</button>
<div id="ozet"></div>
<script type="application/json" id="veri">${json.replace(/</g, '\\u003c')}</script>
<script>
const d=JSON.parse(document.getElementById('veri').textContent);
const oz=document.getElementById('ozet');
for(const k of Object.keys(d)){const v=d[k];const n=Array.isArray(v)?v.length:'-';oz.insertAdjacentHTML('beforeend','<div class="k"><b>'+k+'</b>: '+(Array.isArray(v)?n+' kayıt':typeof v)+'</div>');}
function indir(){const b=new Blob([document.getElementById('veri').textContent],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='evrim-yedek.json';a.click();}
</` + `script>`;
    const blob = new Blob([html], { type: 'text/html' });
    if (!URL.createObjectURL) { toast('Bu tarayıcıda indirme desteklenmiyor', 'err'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `evrim-yedek-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('🧾 Tek dosya yedek indirildi', 'ok');
  } catch (e) { toast('Yedek oluşturulamadı: ' + String(e.message || e).slice(0, 80), 'err'); }
});

$('#btnSaveGh').addEventListener('click', () => {
  setSettings({ githubToken: $('#setGhToken').value.trim(), githubRepo: gh.parseRepo($('#setGhRepo').value) || $('#setGhRepo').value.trim() });
  toast('GitHub ayarları kaydedildi', 'ok');
});
$('#btnExport').addEventListener('click', () => {
  const blob = new Blob([exportData()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `evrim-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Yedek indirildi', 'ok');
});
$('#btnImport').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    importData(await f.text(), { merge: confirm('Birleştirmek için Tamam, tamamen değiştirmek için İptal’e bas (sonra tekrar sorulmaz).') });
    toast('İçe aktarıldı', 'ok');
    loadChat(); renderSettings(); refreshStatus();
  } catch (err) { toast(err.message, 'bad'); }
  e.target.value = '';
});
$('#btnWipe').addEventListener('click', () => {
  if (!confirm('TÜM veriler silinecek (hafıza, beyin sürümleri, kartlar, sohbetler). Emin misin?')) return;
  if (!confirm('Son şans — gerçekten sıfırlansın mı?')) return;
  wipeData();
  location.reload();
});

/* PWA */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('#btnInstall').textContent = '📲 Uygulamayı yükle'; });
$('#btnInstall').addEventListener('click', async () => {
  if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
  else toast('iPhone: Safari → Paylaş → “Ana Ekrana Ekle”. Android: Chrome menüsü → “Uygulamayı yükle”.');
});

/* başlat */
(async function init() {
  const s = getSettings();
  if (!s.createdAt) setSettings({ createdAt: new Date().toISOString() });
  if (!s.localTier) setSettings({ localTier: guessTier() });
  currentPrompt();

  /* --- yeni kabuk: giriş + kenar çubuğu + botlar --- */
  initShell({
    activeConversationId: () => find('conversations', conversationId) || null,
    onNewChat: () => newChat(),
    onGo: (v) => go(v),
    onSelectConv: (id) => { loadChat(id); go('chat'); },
    onDeleteConv: (id) => { if (conversationId === id) { conversationId = null; newChat(); } },
    onPersona: (pid) => {
      try { localStorage.setItem('evrim:persona', pid); } catch { /* gizli mod */ }
      if (conversationId) { conversationId = null; newChat(); }
      else go('chat');
      const pe = getPersona(pid);
      toast(`${pe.emoji} ${pe.name} hazır`, 'ok');
    },
    onRenameProfile: (id, name) => { renameProfile(id, name); },
    onLogin: () => { bootApp(); },
  });
  initLogin({ onLogin: () => { bootApp(); } });

  if (!isLoggedIn()) { go('chat'); return; }   // giriş bekleniyor
  await bootApp();
})();

let booted = false;
async function bootApp() {
  // v25: ORTAM KENDİNİ KURAR (ajan modeli): ilk cihaz beyin olur,
  // beyin başka cihazda doluysa bu cihaz SESSİZCE misafir olur — kullanıcı hiçbir şey yapmaz.
  if (getSettings().houseHost !== false) {
    startHouseHost(houseHandlers())
      .then(() => { renderHouseBox(); refreshStatus(); })
      .catch((e) => {
        const msg = String(e?.message || e);
        if (/zaten|unavailable/i.test(msg)) {
          probeHouse(2500).then((ok) => {
            if (ok) toast('🏠 Ev bulutuna bağlandın — yaz, cevap hazır', 'ok');
            renderHouseBox(); refreshStatus();
          }).catch(() => renderHouseBox());
        } else { renderHouseBox(); }
      });
  }
  loadChat();
  go('chat');
  renderSettings();
  refreshStatus();
  if (booted) return;
  booted = true;
  // Cihaz WebGPU destekliyor mu? (yerel model mümkün mü)
  await detectWebGPU();
  refreshStatus();
  renderSettings();
  // ANAHTARSIZ en iyi kaynağı bul: Puter (büyük bulut) -> ücretsiz servisler -> Chrome Nano
  probeKeyless({ onProgress: (t) => { const el = $('#capBox'); if (el) el.textContent = t; } })
    .then((found) => {
      if (found === 'puter') toast('☁️ Anahtarsız bulut modeli hazır — indirme yok, anahtar yok', 'ok');
      else if (found === 'nano') toast('⚡ Chrome Nano hazır', 'ok');
      else if (found) toast('🌐 Ücretsiz servis bulundu', 'ok');
      refreshStatus(); renderSettings(); renderLocalBoxes();
    })
    .catch(() => {});
}

/* ---------------- cihazında çalışan model ---------------- */
function setLocalProgress(pct, text) {
  for (const [barId, txtId, wrapId] of [
    ['localProgressBar', 'localProgressText', 'localProgress'],
    ['localProgressBar2', 'localProgressText2', 'localProgress2'],
  ]) {
    const bar = document.getElementById(barId);
    const txt = document.getElementById(txtId);
    const wrap = document.getElementById(wrapId);
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (txt) txt.textContent = text || '';
    if (wrap) wrap.style.display = pct > 0 && pct < 100 ? 'block' : (pct >= 100 ? 'block' : wrap.style.display);
  }
}

function renderPuterBox() {
  const el = $('#puterBox'); if (!el) return;
  const p = puterStatus();
  const auth = (globalThis.puter?.auth?.isSignedIn?.() ?? false);
  const btn = $('#btnPuterTest'), sign = $('#btnPuterSign');
  el.innerHTML = p.ready
    ? `<span class="chip ok">✅ ÇALIŞIYOR</span> anahtarsız bulut modeli aktif${auth ? ' · Puter hesabın açık' : ' · misafir hakkıyla'}`
      : `<span class="chip ${p.error ? 'warn' : ''}">${p.error ? '❌ ' + esc(p.error.slice(0, 90)) : 'henüz test edilmedi'}</span>`;
  if (btn) btn.disabled = false;
  if (sign) sign.style.display = p.ready || p.error ? 'inline-flex' : 'none';
}

async function testPuter(force = true) {
  const out = $('#puterOut'); const btn = $('#btnPuterTest');
  btn.disabled = true;
  if (out) out.innerHTML = '☁️ Puter deneniyor… <b>Pencere açılırsa e-posta veya GitHub ile ücretsiz giriş yap.</b><br><span class="muted">(SDK 400 KB iner, ilk sefer 10-20 sn)</span>';
  try {
    const ok = await probePuter({ force });
    if (out) out.innerHTML = ok
      ? '✅ <b>Çalışıyor!</b> Anahtar ve indirme olmadan büyük bulut modeli cevap veriyor. Artık sohbet edebilirsin.'
      : '❌ Çalışmadı: ' + esc(puterStatus().error || 'bilinmeyen hata')
        + '<br>Misafir hakkı dolmuş olabilir → "Puter ile giriş yap" düğmesini dene (ücretsiz hesap, API anahtarı istemez).';
    if (ok) { toast('☁️ Anahtarsız bulut beyni hazır!', 'ok'); $('#smartCard') && ($('#smartCard').style.display = 'none'); }
  } catch (e) {
    if (out) out.textContent = '❌ ' + e.message;
  }
  btn.disabled = false;
  renderPuterBox(); refreshStatus(); renderLocalBoxes();
}

function renderNanoBox() {
  const el = $('#nanoBox'); if (!el) return;
  const n = nanoStatus();
  const btn = $('#btnNanoStart');
  const map = {
    available: '<span class="chip ok">✅ hazır</span> Chrome modeli zaten indirmiş — 0 MB, sınırsız',
    downloadable: '<span class="chip acc">⬇️ indirilebilir</span> Chrome modeli kendisi indirecek (~2 GB, arka planda)',
    downloading: `<span class="chip warn">⬇️ iniyor %${n.progress || 0}</span>`,
    unavailable: '<span class="chip warn">❌ kullanılamıyor</span> cihaz/tarayıcı desteklemiyor',
  };
  let html = hasNanoAPI()
    ? (map[n.availability] || `<span class="chip">durum: ${esc(String(n.availability || 'bilinmiyor'))}</span>`)
    : '<span class="chip warn">❌ API yok</span> Chrome 148+ <b>masaüstü</b> gerekir (Android/iOS desteklemiyor)';
  html += '<div class="muted" style="font-size:12px;margin-top:6px">⚠️ Nano ağırlıklı olarak İngilizce eğitildi → Türkçe cevapları zayıf olabilir. '
    + 'Kapalı kaynak ağırlıklar; <b>açık kaynak + sınırsız</b> istiyorsan aşağıdaki WebLLM modellerini kullan.</div>';
  el.innerHTML = html;
  if (btn) {
    btn.style.display = (hasNanoAPI() && n.availability !== 'available') ? 'inline-flex' : 'none';
    btn.disabled = n.availability === 'unavailable';
  }
}

async function startNano() {
  const btn = $('#btnNanoStart'); const el = $('#nanoBox');
  if (btn) btn.disabled = true;
  try {
    await createNano({ onProgress: (p, t) => { if (el) el.querySelector('.chip') && (el.querySelector('.chip').textContent = `⬇️ %${p}`); setLocalProgress(p, t); renderNanoBox(); } });
    toast('⚡ Chrome Nano hazır — anahtarsız, sınırsız, 0 indirme', 'ok');
  } catch (e) { toast(e.message, 'bad'); }
  if (btn) btn.disabled = false;
  renderNanoBox(); refreshStatus(); renderSettings();
}

function renderSmartCard() {
  const card = $('#smartCard'); if (!card) return;
  const s = getSettings();
  const show = !(s.apiKey || '').trim() && !s.smartDismissed;
  card.style.display = show ? 'block' : 'none';
}

function renderLocalBoxes() {
  const loc = localStatus();
  const a = activeLLM();
  const d = deviceProfile();
  const cap = $('#capBox');
  const box = $('#localBox');

  if (cap) {
    cap.innerHTML = loc.checked
      ? (loc.supported
        ? `<span class="chip ok">✅ WebGPU var</span> ${esc(loc.adapter || '')}`
        + `<div class="muted" style="font-size:12px;margin-top:4px">Cihaz: ${d.kind === 'phone' ? '📱 telefon' : d.kind === 'tablet' ? '📱 tablet' : '💻 bilgisayar'}`
        + `${d.mem ? ' · ' + d.mem + ' GB RAM' : ''} · Chrome ${d.chromeVer || '?'} · GPU tavanı ${vramCap()} MB</div>`
        + `<div class="muted" style="font-size:12px">Açık kaynak model cihazında çalışabilir</div>`
        + (hasNanoAPI() ? (nanoStatus().availability === 'available'
          ? ' · <span class="chip ok">⚡ Chrome Nano da hazır</span>' : ' · <span class="chip">Chrome Nano: ' + esc(String(nanoStatus().availability || '?')) + '</span>') : '')
        : `<span class="chip warn">⚠️ WebGPU yok</span> Bu tarayıcıda yerel model çalışmaz. Chrome 113+ (Android 121+) / Safari 26+ dene ya da ücretsiz anahtar gir.`)
      : '<span class="chip">cihaz denetleniyor…</span>';
    const btn = $('#btnStartLocal');
    if (btn) {
      btn.disabled = !(loc.checked && loc.supported) || loc.loading;
      btn.textContent = loc.ready ? `✅ Hazır: ${shortName(loc.modelId)}`
        : loc.loading ? `⬇️ İndiriliyor… %${loc.progress}`
        : '🚀 Modeli indir ve başlat';
    }
  }

  if (box) {
    box.innerHTML = loc.ready
      ? `<span class="chip ok">✅ çalışıyor</span> <b>${esc(shortName(loc.modelId))}</b> · bellekte, çevrimdışı hazır${a.id === 'local' ? '' : ' <span class="chip">(bulut anahtarı öncelikli)</span>'}`
      : loc.loading
        ? `<span class="chip warn">⬇️ indiriliyor %${loc.progress}</span> ${esc(loc.progressText || '')}`
        : (loc.supported
          ? `<span class="chip">hazır, indirilmedi</span> ${esc(loc.adapter || '')}`
          : `<span class="chip warn">WebGPU yok</span> ${esc(loc.error || '')}`);
  }
}

async function startLocal({ skipConfirm = false } = {}) {
  const d = deviceProfile();
  // Sessiz indirme YOK — kullanıcı her zaman onaylar
  if (!skipConfirm) {
    const msg = d.mobileData || d.saveData
      ? '📶 Mobil veridesin! Model 200-660 MB indirecek ve telefonda cevaplar 10-40 sn sürer.\n\nBunun yerine 🔑 ücretsiz anahtar yapıştırırsan 2 saniyede cevap alırsın.\n\nYine de indirmek istiyor musun?'
      : 'Model 200-660 MB indirecek (bir kez). Cevaplar cihazında üretilir.\n\nDevam?';
    if (!confirm(msg)) { toast('İndirme iptal', 'warn'); return; }
  }
  const ok = await detectWebGPU();
  if (!ok) {
    const s = getSettings();
    if (!s.apiKey) toast('Bu cihazda WebGPU yok — ücretsiz bir API anahtarı girmen gerekiyor', 'bad');
    renderLocalBoxes();
    return;
  }
  if (!getSettings().localTier) setSettings({ localTier: guessTier() });
  renderLocalBoxes();
  try {
    await loadLocal({ onProgress: (p, t) => { setLocalProgress(p, t); renderLocalBoxes(); refreshStatusLight(); } });
    setLocalProgress(100, 'Hazır');
    toast('Model cihazında çalışıyor 🧠', 'ok');
    closeSetupModal();
  } catch (e) {
    toast(e.message, 'bad');
  }
  renderLocalBoxes();
  refreshStatus();
}

/** Beyin hazır değilse: büyük indirme yerine kullanıcıya 3 net seçenek sun */
function askBrain(pendingText) {
  const div = document.createElement('div');
  div.className = 'msg bot pick';
  div.innerHTML = `
    <b>🧠 Bu cihazda beyin henüz kurulu değil — hangisini istersin?</b>
    <div class="muted" style="font-size:12.5px;margin:6px 0 10px">
      İkisi de <b>anahtarsız ve ücretsiz</b>. Kurulumdan sonra sorunu otomatik yeniden sorarım;
      bir daha bu kartı görmezsin.
    </div>
    <div class="item" style="border-color:rgba(124,92,255,.5)">
      <div class="t">🧠 Küçük beyni cihazıma kur <span class="chip acc">~90 MB · bir kez · ÇEVRİMDIŞI</span></div>
      <div class="s">Açık kaynak model uygulama içine iner (başka siteye gitmez). Sonra bu cihazda
      girişsiz, çevrimdışı, sınırsız cevap verirsin. Cevap süresi ~10-30 sn.</div>
      <div class="a"><button class="btn sm cwasm" style="flex:1">🧠 Kur ve cevapla</button></div>
    </div>
    <div class="item">
      <div class="t">☁️ Ücretsiz bulut (puter.com) <span class="chip">0 MB · İSTEĞE BAĞLI</span></div>
      <div class="s">Büyük bulut modeli için ücretsiz giriş penceresi açılır — ancak sen basarsan.</div>
      <div class="a"><button class="btn sm ghost cconn">☁️ Bağlan ve cevapla</button></div>
    </div>
    <div class="item" style="display:none" id="wlocalItem">
      <div class="t">📥 Büyük cihaz modeli (WebGPU) <span class="chip">~194 MB · hızlı donanım</span></div>
      <div class="s">Bu cihaz WebGPU destekliyorsa: daha güçlü yerel model.</div>
      <div class="a"><button class="btn sm ghost clocal">📥 İndir ve başlat</button></div>
    </div>
`;
  $('#msgs').appendChild(div);
  requestAnimationFrame(scrollBottom);

  if (localStatus().supported) {
    const li = div.querySelector('#wlocalItem'); if (li) li.style.display = '';
  }
  div.querySelector('.cwasm').addEventListener('click', async () => {
    const btn = div.querySelector('.cwasm');
    btn.disabled = true; btn.textContent = '🧠 Hazırlanıyor… %0';
    try {
      await loadWasm((p) => { btn.textContent = `🧠 Kuruluyor… %${p}`; });
      div.remove();
      toast('🧠 Küçük beyin hazır — başka siteye gerek kalmadı', 'ok');
      refreshStatus(); renderSettings(); renderWasmBox();
      if (pendingText) send(pendingText);
    } catch (e) {
      btn.disabled = false; btn.textContent = '🧠 Kur ve cevapla';
      const note = div.querySelector('.cnote') || (() => {
        const d = document.createElement('div');
        d.className = 'muted cnote'; d.style.cssText = 'font-size:12px;margin-top:8px;color:var(--bad)';
        div.appendChild(d); return d;
      })();
      note.textContent = 'Olamadı: ' + (e.message || e) + ' — bulut seçeneğini deneyebilirsin.';
    }
  });
  div.querySelector('.cconn').addEventListener('click', async () => {
    const btn = div.querySelector('.cconn');
    btn.disabled = true; btn.textContent = '☁️ Bağlanılıyor… pencereye izin ver';
    try {
      await puterSignIn();
    } catch { /* durum aşağıda okunur */ }
    if (puterStatus().ready) {
      div.remove();
      toast('☁️ Ücretsiz bulut hazır — anahtar gerekmedi', 'ok');
      refreshStatus(); renderSettings(); renderLocalBoxes();
      if (pendingText) send(pendingText);
    } else {
      btn.disabled = false; btn.textContent = '☁️ Ücretsiz bağlan ve sorumu sor';
      const err = puterStatus().error || 'pencere engellenmiş olabilir';
      const note = div.querySelector('.cnote') || (() => {
        const d = document.createElement('div');
        d.className = 'muted cnote'; d.style.cssText = 'font-size:12px;margin-top:8px;color:var(--bad)';
        div.appendChild(d); return d;
      })();
      note.textContent = `Olamadı: ${err}. Açılan pencereyi kapatmadıysan tekrar dene — ya da aşağıdan cihaz modeli.`;
    }
  });
  div.querySelector('.clocal').addEventListener('click', async () => {
    div.remove();
    await startLocal({ skipConfirm: true });
    if (localStatus().ready && pendingText) send(pendingText);
  });
}

async function pasteInto(sel) {
  const el = $(sel); if (!el) return;
  try {
    const t = await navigator.clipboard.readText();
    if (t && t.trim()) { el.value = t.trim(); el.dispatchEvent(new Event('input')); toast('Panodan yapıştırıldı', 'ok'); }
    else toast('Pano boş', 'warn');
  } catch {
    toast('Tarayıcı pano izni vermedi — anahtarı elle yapıştır (Ctrl+V)', 'warn');
    el.focus();
  }
}

async function saveSmartKey() {
  const inp = $('#smartKey'); const out = $('#smartOut'); const btn = $('#btnSmartKey');
  const key = (inp?.value || '').trim();
  if (!key) { if (out) out.textContent = '⚠️ Önce anahtarı yapıştır (📋 düğmesi panodan alır)'; return; }
  btn.disabled = true; if (out) out.textContent = '🔎 anahtar deneniyor…';
  const prev = getSettings().apiKey;
  setSettings({ apiKey: key, model: '' });
  try {
    const r = await testConnection();
    if (r.ok) {
      if (out) out.innerHTML = `✅ <b>${esc(r.provider)} · ${esc(r.model)}</b> çalışıyor`;
      toast('🎉 Akıllı mod açık — artık büyük bulut modeli cevap veriyor', 'ok');
      $('#smartCard').style.display = 'none';
      closeSetupModal();
      refreshStatus(); renderSettings();
      btn.disabled = false;
      return;
    }
    if (out) out.textContent = '❌ ' + (r.error || 'bağlanamadı');
    setSettings({ apiKey: prev || '' });
  } catch (e) {
    if (out) out.textContent = '❌ ' + e.message;
    setSettings({ apiKey: prev || '' });
  }
  btn.disabled = false;
  refreshStatus();
}

async function saveQuickKey() {
  const inp = $('#quickKey'); const out = $('#quickKeyOut'); const btn = $('#btnQuickKey');
  const key = (inp?.value || '').trim();
  if (!key) { if (out) out.textContent = '⚠️ Önce anahtarı yapıştır'; return; }
  btn.disabled = true; if (out) out.textContent = '🔎 anahtar deneniyor…';
  setSettings({ apiKey: key, model: '' });
  try {
    const r = await testConnection();
    if (r.ok) {
      if (out) out.innerHTML = `✅ Çalışıyor! <b>${esc(r.provider)} · ${esc(r.model)}</b><br>Yanıt: ${esc(String(r.reply || '').slice(0, 80))}`;
      toast('🎉 Bulut beyni hazır — artık akıllı ve hızlı', 'ok');
      $('#keyBox').style.display = 'none';
      refreshStatus(); renderSettings();
      return;
    }
    if (out) out.textContent = '❌ ' + (r.error || 'bağlanamadı');
    setSettings({ apiKey: '' });
  } catch (e) {
    if (out) out.textContent = '❌ ' + e.message;
    setSettings({ apiKey: '' });
  }
  btn.disabled = false;
}

async function runPreview() {
  const out = $('#previewOut'); const btn = $('#btnPreview');
  if (!out) return;
  btn.disabled = true; out.textContent = '📏 ölçülüyor… (gerçek indirme boyutları sunucudan alınıyor, ~10 sn)';
  try {
    const d = deviceProfile();
    const r = await previewModels();
    if (!r.length) { out.textContent = '❌ Bu cihaz için uygun model bulunamadı. Ücretsiz bulut anahtarı kullan.'; return; }
    out.innerHTML = `<b>${d.kind === 'phone' ? '📱 Telefon' : d.kind === 'tablet' ? '📱 Tablet' : '💻 Bilgisayar'}</b>`
      + ` · ${d.mem ? d.mem + ' GB RAM' : 'RAM bilinmiyor'} · GPU tavanı ${vramCap()} MB · shader-f16 ${r.f16 === false ? 'yok' : 'var'}<br><br>`
      + `<b>Sırayla denenecek modeller:</b><br>`
      + r.map((x, i) => `${i + 1}. ${esc(shortName(x.id))} — <b>${x.mb ? x.mb + ' MB' : 'boyut ölçülemedi'}</b> · VRAM ${Math.round(x.vram)} MB`).join('<br>')
      + `<br><br>İlki başarısız olursa otomatik olarak sıradakine geçer. İndirme <b>bir kez</b> yapılır, sonra çevrimdışı çalışır.`;
  } catch (e) { out.textContent = '❌ ' + e.message; }
  btn.disabled = false;
}

async function runDiag() {
  const out = $('#diagOut'); const btn = $('#btnDiag');
  if (!out) return;
  btn.disabled = true; out.style.display = 'block'; out.textContent = '🩺 denetleniyor… (10-20 sn)';
  try {
    const d = await diagnose();
    const L = [];
    L.push(`Çevrimiçi        : ${d.online ? 'evet' : 'HAYIR'}`);
    L.push(`WebGPU           : ${d.gpu ? 'VAR ✅' : 'YOK ❌ (Chrome 113+/Safari 26+ gerekir)'}`);
    L.push(`shader-f16       : ${d.f16 ? 'var ✅' : 'yok (f32 modeller kullanılır)'}`);
    L.push(`GPU              : ${d.adapter || '-'}`);
    L.push(`Cihaz belleği    : ${d.deviceMemoryGB ? d.deviceMemoryGB + ' GB' : 'bilinmiyor'}`);
    L.push(`huggingface.co   : ${d.net.hf ? 'ERİŞİLİYOR ✅' : 'ERİŞİLEMİYOR ❌  <-- indirme hatasının sebebi bu'}`);
    L.push(`github (wasm)    : ${d.net.gh ? 'erişiliyor ✅' : 'erişilemiyor ❌'}`);
    L.push(`WebLLM kütüphanesi: ${d.lib ? `yüklendi ✅ (${d.models} model)` : 'YÜKLENEMEDİ ❌ (CDN kapalı)'}`);
    L.push(`Depolama         : ${d.quota ? `${d.quota.usedMB} MB kullanımda / ${d.quota.totalMB} MB kota` : '-'}`);
    L.push(`Seçili boyut     : ${d.tier}`);
    if (d.catalog?.length) L.push(`Uygun modeller   : ${d.catalog.map((c) => `${shortName(c.id)} ~${c.mb}MB`).join(', ')}`);
    out.textContent = L.join('\n');
  } catch (e) { out.textContent = 'Tanılama hatası: ' + e.message; }
  btn.disabled = false;
}

async function tryFreeNow(full = false) {
  const out = $('#freeOut') || $('#capBox');
  const btn = $('#btnTestFree'); const b2 = $('#btnTryFree');
  if (btn) btn.disabled = true; if (b2) b2.disabled = true;
  if (out) out.textContent = '🔎 ücretsiz servisler deneniyor… (birkaç saniye)';
  try {
    if (full) {
      const rs = await testAllFree((name, st) => { if (out) out.textContent = `${name}: ${st}`; });
      const ok = rs.filter((r) => r.ok).length;
      if (out) out.innerHTML = rs.map((r) => `${r.ok ? '✅' : '❌'} ${esc(r.name)}`).join(' &nbsp;·&nbsp; ');
      toast(ok ? `🌐 ${ok} ücretsiz servis çalışıyor — indirme gerekmiyor` : 'Hiçbiri çalışmıyor: cihazında model ya da ücretsiz anahtar kullan', ok ? 'ok' : 'warn');
    } else {
      const id = await probeFree({ force: true, onProgress: (t) => { if (out) out.textContent = t; } });
      if (id) {
        if (out) out.textContent = `✅ çalışıyor: ${id}`;
        toast('🌐 Ücretsiz servis çalışıyor! Ayarlar\'dan anahtar girmeden sohbet edebilirsin', 'ok');
      } else {
        if (out) out.textContent = '❌ şu an çalışan ücretsiz servis yok — cihazında modeli başlat ya da ücretsiz anahtar gir';
        toast('Ücretsiz servisler şu an kapalı (bu normal, garanti edilmiyor)', 'warn');
      }
    }
  } catch (e) {
    if (out) out.textContent = '❌ ' + e.message;
  }
  if (btn) btn.disabled = false; if (b2) b2.disabled = false;
  refreshStatus(); renderSettings();
}

let lightTimer = null;
function cevapYeterliMi(soru, cevap) {
  const c = String(cevap || '').trim();
  if (!c || c.length < 40) return { ok: false, neden: 'cevap çok kısa/k boş' };
  if (/^(evet|hayır|ok|tamam)[.! ]*$/i.test(c)) return { ok: false, neden: 'tek kelimelik cevap' };
  if (/üzgünüm|başaramadım|yapamadım|malesef|maalesef/i.test(c) && c.length < 200) return { ok: false, neden: 'hata/kaçınma dili' };
  const cokParca = (String(soru).match(/\?/g) || []).length >= 2 || /\bve\b.*\?/.test(String(soru));
  if (cokParca && !/[•\n1-9)]/.test(c)) return { ok: false, neden: 'çok parçalı soruya tek parça cevap' };
  return { ok: true, neden: '' };
}

function houseHandlers() {
  return { chat: (msgs, onChunk) => agentChat(msgs, { temperature: 0.7, maxTokens: 1200, onChunk }) };
}
function renderHouseBox() {
  const btn = $('#houseBtn'); const stat = $('#houseStat');
  if (!btn) return;
  const hs = houseStatus();
  if (hs.hosting) {
    btn.textContent = '🏠 Ev bulutunu kapat';
    stat.textContent = `AÇIK · ${hs.clients} bağlı cihaz`;
  } else if (hs.ready) {
    btn.textContent = '🏠 Ev bulutunu aç';
    stat.textContent = 'bu cihaz ev bulutuna bağlı (misafir)';
  } else {
    btn.textContent = '🏠 Ev bulutunu aç';
    stat.textContent = hs.error || 'kapalı';
  }
  btn.onclick = async () => {
    if (houseStatus().hosting) {
      stopHouseHost(); setSettings({ houseHost: false });
      toast('🏠 Ev bulutu kapatıldı', 'ok');
    } else {
      btn.disabled = true; btn.textContent = 'açılıyor…';
      try {
        await startHouseHost(houseHandlers());
        setSettings({ houseHost: true });
        toast('🏠 Ev bulutu AÇIK — diğer cihazlar sıfır girişle cevap alır', 'ok');
      } catch (e) { toast('Olamadı: ' + (e.message || e), 'err'); }
      btn.disabled = false;
    }
    renderHouseBox(); refreshStatus();
  };
}

function renderWasmBox() {
  const btn = $('#wasmBtn'); const stat = $('#wasmStat');
  if (!btn) return;
  const st = wasmStatus();
  if (st.ready) { btn.textContent = '🧠 Kaldır'; stat.textContent = 'kurulu · çevrimdışı çalışır'; }
  else if (st.loading) { btn.disabled = true; btn.textContent = `⬇️ %${st.progress}`; stat.textContent = 'indiriliyor…'; }
  else { btn.disabled = false; btn.textContent = '🧠 Kur'; stat.textContent = st.error || (st.supported ? 'kurulu değil' : 'bu tarayıcıda yok'); }
  btn.onclick = async () => {
    if (wasmStatus().ready) { unloadWasm(); renderWasmBox(); refreshStatus(); return; }
    btn.disabled = true; btn.textContent = '⬇️ %0';
    try {
      await loadWasm((p) => { btn.textContent = `⬇️ %${p}`; });
      toast('🧠 Küçük beyin kuruldu — çevrimdışı bile cevap verir', 'ok');
    } catch (e) { toast('Olamadı: ' + (e.message || e), 'err'); }
    renderWasmBox(); refreshStatus();
  };
}

function refreshStatusLight() {
  clearTimeout(lightTimer);
  lightTimer = setTimeout(() => { renderLocalBoxes(); }, 120);
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'btnStartLocal' || e.target.id === 'btnLoadLocal') { e.preventDefault(); startLocal(); }
  if (e.target.id === 'btnTryFree') { e.preventDefault(); tryFreeNow(); }
  if (e.target.id === 'btnDiag') { e.preventDefault(); runDiag(); }
  if (e.target.id === 'btnPreview') { e.preventDefault(); runPreview(); }
  if (e.target.id === 'btnShowKey') {
    e.preventDefault();
    const k = $('#keyBox');
    k.style.display = k.style.display === 'none' ? 'block' : 'none';
    if (k.style.display === 'block') $('#quickKey')?.focus();
  }
  if (e.target.id === 'btnQuickKey') { e.preventDefault(); saveQuickKey(); }
  if (e.target.id === 'btnSmartKey') { e.preventDefault(); saveSmartKey(); }
  if (e.target.id === 'btnNanoStart' || e.target.id === 'btnNanoTop') { e.preventDefault(); startNano(); }
  if (e.target.id === 'btnPuterTest' || e.target.id === 'btnPuterTop') { e.preventDefault(); testPuter(); }
  if (e.target.id === 'btnPuterSign') {
    e.preventDefault();
    puterSignIn().then((ok) => toast(ok ? '✅ Giriş başarılı, bulut modeli hazır' : 'Giriş tamamlanmadı', ok ? 'ok' : 'warn'));
  }
  if (e.target.id === 'btnPasteKey') { e.preventDefault(); pasteInto('#smartKey'); }
  if (e.target.id === 'btnSmartLater') {
    e.preventDefault();
    setSettings({ smartDismissed: true });
    $('#smartCard').style.display = 'none';
    toast('Tamam — cihazındaki modelle devam ediyoruz. İstediğin an Ayarlar\'dan anahtar girebilirsin');
  }
  if (e.target.id === 'btnClearCache') {
    e.preventDefault();
    clearModelCache().then((d) => toast(d.length ? `Temizlendi: ${d.join(', ')}` : 'Temizlenecek model önbelleği yok', 'ok'));
  }
  if (e.target.id === 'btnTestFree') { e.preventDefault(); tryFreeNow(true); }
  if (e.target.id === 'btnUnloadLocal') {
    unloadLocal().then(() => { toast('Model bellekten çıkarıldı'); renderLocalBoxes(); refreshStatus(); });
  }
});
