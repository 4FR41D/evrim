/* EVRIM web — sunucusuz sürüm */
import {
  getSettings, setSettings, all, insert, update, remove, find,
  currentPrompt, pushPromptVersion, rollbackPrompt,
  exportData, importData, wipeData, storageSize,
} from './store.js';
import {
  PROVIDERS, active as activeLLM, isReady, chat, testConnection, detectProvider,
  detectWebGPU, guessTier, shortName, localStatus, loadLocal,
} from './llm.js';
import { MODEL_TIERS, unloadLocal } from './local.js';
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
  if (!isReady()) {
    $('#setupCard').style.display = 'block';
    toast('Önce beyni başlat (aşağıdaki düğme) ya da Ayarlar’dan ücretsiz anahtar gir', 'bad');
    return;
  }
  sending = true;
  $('#input').value = ''; autoGrow();
  addMsg({ role: 'user', content });
  busy($('#send'), true, '');
  typing(true);

  try {
    if (!conversationId) conversationId = insert('conversations', { title: content.slice(0, 40) }).id;
    insert('messages', { conversationId, role: 'user', content });

    const history = all('messages').filter((m) => m.conversationId === conversationId).slice(-24)
      .map((m) => ({ role: m.role, content: m.content }));
    const messages = [{ role: 'system', content: evo.buildSystemPrompt() }, ...history];

    const reply = await chat(messages, {
      temperature: 0.7,
      maxTokens: 1200,
      onProgress: (pct, text) => setLocalProgress(pct, text),
    });
    typing(false);
    const botMsg = insert('messages', { conversationId, role: 'assistant', content: reply });
    addMsg(botMsg);

    // öz-gelişim arka planda
    evo.evolveAfterTurn({ conversationId, userText: content, assistantText: reply, messageId: botMsg.id })
      .then((r) => { console.log('[evolve]', r); refreshStatus(); })
      .catch((e) => console.error('[evolve]', e));
  } catch (err) {
    typing(false);
    addMsg({ role: 'assistant', content: `⚠️ ${err.message}`, error: true, createdAt: new Date().toISOString() });
  } finally {
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

  if (a.id === 'local') {
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
function fillModelOptions(providerId) {
  const sel = $('#setModel');
  const list = PROVIDERS[providerId]?.models || [];
  const cur = getSettings().model;
  sel.innerHTML = `<option value="">Varsayılan (${PROVIDERS[providerId]?.defaultModel || '-'})</option>` +
    list.map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${m}</option>`).join('');
}

function renderSettings() {
  const s = getSettings();
  $('#setKey').value = s.apiKey || '';
  const detected = detectProvider(s.apiKey) || s.provider || 'groq';
  fillModelOptions(detected === 'auto' ? 'groq' : detected);
  $('#setEvolve').checked = s.selfEvolution;
  $('#setAuto').checked = s.autoApply !== false;
  $('#setThr').value = s.evolveThreshold;
  $('#thrLabel').textContent = Number(s.evolveThreshold).toFixed(2);
  $('#setName').value = s.userName || '';
  $('#setGhToken').value = s.githubToken || '';
  $('#setGhRepo').value = s.githubRepo || '';
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

function renderLocalBoxes() {
  const loc = localStatus();
  const a = activeLLM();
  const cap = $('#capBox');
  const box = $('#localBox');

  if (cap) {
    cap.innerHTML = loc.checked
      ? (loc.supported
        ? `<span class="chip ok">✅ WebGPU var</span> ${esc(loc.adapter || '')} — model cihazında çalışabilir`
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

let lightTimer = null;
function refreshStatusLight() {
  clearTimeout(lightTimer);
  lightTimer = setTimeout(() => { renderLocalBoxes(); }, 120);
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'btnStartLocal' || e.target.id === 'btnLoadLocal') { e.preventDefault(); startLocal(); }
  if (e.target.id === 'btnUnloadLocal') {
    unloadLocal().then(() => { toast('Model bellekten çıkarıldı'); renderLocalBoxes(); refreshStatus(); });
  }
});
