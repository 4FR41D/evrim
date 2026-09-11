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
  probeKeyless, probePuter, puterStatus, puterSignIn, markPuterDown,
} from './llm.js';
import { testAllFree, freeCacheSnapshot } from './free.js';
import { MODEL_TIERS, unloadLocal, diagnose, clearModelCache, deviceProfile, vramCap, previewModels } from './local.js';
import * as evo from './evolve.js';
import * as learn from './learn.js';
import * as gh from './github.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
function md(src) {
  let s = esc(src);
  s = s.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, l, c) => `<pre><code>${c}</code></pre>`);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|\n)###?\s?(.*)/g, (_, a, b) => `${a}<b>${b}</b>`);
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|\n)[-*]\s+/g, '$1• ');
  return s;
}

/* ---------------- navigasyon ---------------- */
let currentView = 'chat';
$$('nav.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.v)));
function go(v) {
  currentView = v;
  $$('.view').forEach((el) => el.classList.toggle('on', el.id === `v-${v}`));
  $$('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('#composer').style.display = v === 'chat' ? 'block' : 'none';
  window.scrollTo({ top: 0 });
  if (v === 'learn') renderLearn();
  if (v === 'gh') { $('#ghRepoInput').value = getSettings().githubRepo || $('#ghRepoInput').value; }
  if (v === 'evo') renderEvo();
  if (v === 'set') renderSettings();
}
$('#gotoSettings')?.addEventListener('click', () => go('set'));

/* ---------------- sohbet ---------------- */
let conversationId = null;
let sending = false;

function addMsg(m) {
  $('#chatEmpty').style.display = 'none';
  const div = document.createElement('div');
  div.className = `msg ${m.role === 'user' ? 'user' : 'bot'}${m.error ? ' err' : ''}`;
  div.innerHTML = md(m.content);
  if (m.role === 'assistant' && m.id && !m.error) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<button class="fb ${m.feedback > 0 ? 'on' : ''}" data-fb="1">👍</button>
      <button class="fb ${m.feedback < 0 ? 'on dn' : ''}" data-fb="-1">👎</button>
      <span>${new Date(m.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>`;
    meta.querySelectorAll('.fb').forEach((b) => b.addEventListener('click', () => feedback(m.id, Number(b.dataset.fb), b)));
    div.appendChild(meta);
  }
  $('#msgs').appendChild(div);
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  return div;
}

function feedback(id, value, btn) {
  const comment = value < 0 ? (prompt('Neyi iyileştirmemi istersin? (EVRIM bunu hafızasına yazar)') || '') : '';
  evo.recordFeedback({ messageId: id, value, comment });
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
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } else $('#typing')?.remove();
}

async function send(text) {
  const content = (text ?? $('#input').value).trim();
  if (!content || sending) return;
  sending = true;
  $('#input').value = ''; autoGrow();
  addMsg({ role: 'user', content });
  busy($('#send'), true, '');
  $('#setupCard').style.display = 'none';

  // Canlı yanıt balonu: model indirilirken/yazarken kullanıcı boş ekran görmesin
  const live = document.createElement('div');
  live.className = 'msg bot';
  live.innerHTML = '<div class="livebody"><span class="typing"><i></i><i></i><i></i></span></div>'
    + '<div class="livestatus muted" style="font-size:12px;margin-top:6px"></div>';
  $('#msgs').appendChild(live);
  const liveBody = live.querySelector('.livebody');
  const liveStat = live.querySelector('.livestatus');
  const scroll = () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  scroll();

  let streamed = '';
  const onChunk = (delta, full) => {
    if (!streamed) { liveBody.innerHTML = ''; }
    streamed = full || (streamed + delta);
    liveBody.innerHTML = md(streamed) + '<span class="cursor">▌</span>';
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
    if (!conversationId) conversationId = insert('conversations', { title: content.slice(0, 40) }).id;
    insert('messages', { conversationId, role: 'user', content });

    const history = all('messages').filter((m) => m.conversationId === conversationId).slice(-24)
      .map((m) => ({ role: m.role, content: m.content }));
    const messages = [{ role: 'system', content: evo.buildSystemPrompt() }, ...history];

    // Model hazır değilse OTOMATİK başlat (kullanıcıdan düğmeye basmasını bekleme)
    const a = activeLLM();
    if (a.id === 'local' && !localStatus().ready) {
      liveStat.textContent = '🧠 Beyin başlatılıyor… (ilk seferde model iner)';
      beat();
    }

    const reply = await chat(messages, {
      temperature: 0.7,
      maxTokens: 1200,
      onChunk,
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
    beat();
    clearInterval(watchdog);
    live.remove();
    typing(false);

    const botMsg = insert('messages', { conversationId, role: 'assistant', content: reply });
    addMsg(botMsg);

    evo.evolveAfterTurn({ conversationId, userText: content, assistantText: reply, messageId: botMsg.id })
      .then(() => refreshStatus())
      .catch((e) => console.error('[evolve]', e));
  } catch (err) {
    clearInterval(watchdog);
    live.remove();
    typing(false);
    const st = localStatus();
    const a = activeLLM();
    let extra = '';
    if (a.id === 'local') {
      extra = '\n\n**Ne yapabilirsin?**\n'
        + '1. 🩺 Ayarlar → "Tanıla" ile hangi sunucunun kapalı olduğunu gör\n'
        + '2. 🔑 Ayarlar → ücretsiz OpenRouter/Groq anahtarı gir (indirme yok, anında çalışır)\n'
        + '3. 🌐 Ayarlar → "Ücretsiz servisleri test et"';
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

function loadChat() {
  const convs = all('conversations');
  if (!convs.length) return;
  conversationId = convs[convs.length - 1].id;
  const msgs = all('messages').filter((m) => m.conversationId === conversationId);
  if (!msgs.length) return;
  $('#welcomeCard').style.display = 'none';
  $('#chatEmpty').style.display = 'none';
  $('#msgs').innerHTML = '';
  msgs.forEach(addMsg);
}

/* ---------------- durum ---------------- */
function refreshStatus() {
  const a = activeLLM();
  const st = evo.stats();
  const ls = learn.learningStats();
  const pill = $('#statusPill');
  const loc = localStatus();

  if (a.id === 'puter') {
    pill.textContent = '☁️ Puter · anahtarsız bulut';
    pill.className = 'pill ok';
    $('#setupCard').style.display = 'none';
  } else if (a.id === 'nano') {
    pill.textContent = '⚡ Chrome Nano · anahtarsız, sınırsız';
    pill.className = 'pill ok';
    $('#setupCard').style.display = 'none';
  } else if (a.id === 'free') {
    pill.textContent = '🌐 ücretsiz servis · anahtarsız';
    pill.className = 'pill ok';
    $('#setupCard').style.display = 'none';
  } else if (a.id === 'local') {
    if (loc.ready) {
      pill.textContent = `🧠 ${shortName(loc.modelId)} · cihazında`;
      pill.className = 'pill ok';
      $('#setupCard').style.display = 'none';
    } else if (loc.supported) {
      pill.textContent = loc.loading ? `indiriliyor %${loc.progress}` : '🧠 modeli başlat';
      pill.className = loc.loading ? 'pill demo' : 'pill ok';
      $('#setupCard').style.display = currentView === 'chat' ? 'block' : 'none';
    } else {
      pill.textContent = '⚠️ WebGPU yok';
      pill.className = 'pill demo';
      $('#setupCard').style.display = currentView === 'chat' ? 'block' : 'none';
    }
  } else {
    pill.textContent = `${a.def.name} · ${String(a.model).split('/').pop()}`;
    pill.className = 'pill ok';
    $('#setupCard').style.display = 'none';
  }
  $('#subBrand').textContent = `beyin v${st.promptVersion} · ${st.memories} hafıza`;
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
  $('#dueChip').textContent = `${dueQueue.length} kart hazır`;
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
  $('#setGhRepo').value = s.githubRepo || '';
  const pf = $('#setPreferFree');
  if (pf) {
    pf.checked = getSettings().preferFree !== false;
    pf.onchange = () => { setSettings({ preferFree: pf.checked }); refreshStatus(); };
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
  refreshStatus();
  loadChat();
  renderSettings();
  // Cihaz WebGPU destekliyor mu? (yerel model mümkün mü)
  await detectWebGPU();
  refreshStatus();
  renderSettings();
  // Anahtar yoksa: indirmesiz çalışan ücretsiz bir servis var mı diye ARKA PLANDA bak
  // ANAHTARSIZ en iyi kaynağı bul: Puter (büyük bulut) -> ücretsiz servisler -> Chrome Nano
  probeKeyless({ onProgress: (t) => { const el = $('#capBox'); if (el) el.textContent = t; } })
    .then((found) => {
      if (found === 'puter') toast('☁️ Anahtarsız bulut modeli hazır — indirme yok, anahtar yok', 'ok');
      else if (found === 'nano') toast('⚡ Chrome Nano hazır', 'ok');
      else if (found) toast('🌐 Ücretsiz servis bulundu', 'ok');
      refreshStatus(); renderSettings(); renderLocalBoxes();
    })
    .catch(() => {});
})();

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
  if (out) out.textContent = '☁️ Puter deneniyor… (SDK 400 KB iner, ilk sefer 5-15 sn)';
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

async function startLocal() {
  // Telefonda mobil veri uyarısı (indirme 200 MB+)
  const d = deviceProfile();
  if ((d.mobileData || d.saveData) && d.kind !== 'desktop') {
    const yes = confirm('📶 Mobil veridesin. Model ~200 MB indirecek (bir kez, sonra çevrimdışı çalışır).\n\nDevam edilsin mi?\n\nİpucu: Wi-Fi\'a geçersen daha hızlı ve ücretsiz olur.');
    if (!yes) { toast('İndirme iptal — Wi-Fi\'a geçince tekrar dene', 'warn'); return; }
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
    $('#setupCard').style.display = 'none';
  } catch (e) {
    toast(e.message, 'bad');
  }
  renderLocalBoxes();
  refreshStatus();
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
      $('#setupCard').style.display = 'none';
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
