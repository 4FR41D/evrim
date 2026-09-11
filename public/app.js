/* EVRIM — frontend */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastT;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast on ${kind}`;
  clearTimeout(toastT);
  toastT = setTimeout(() => (el.className = 'toast'), 2600);
}

function busy(btn, on, label) {
  if (!btn) return;
  if (on) {
    btn.dataset.old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> ${label || 'Çalışıyor…'}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.old) btn.innerHTML = btn.dataset.old;
  }
}

/* ---------------- basit markdown ---------------- */
function md(src) {
  let s = esc(src);
  s = s.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, l, code) => `<pre><code>${code}</code></pre>`);
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
  if (v === 'learn') loadLearn();
  if (v === 'gh') loadGh();
  if (v === 'evo') loadEvo();
  if (v === 'set') loadSettings();
}

/* ---------------- sohbet ---------------- */
let conversationId = null;
let sending = false;

function addMsg(m, animate = false) {
  $('#chatEmpty').style.display = 'none';
  const div = document.createElement('div');
  div.className = `msg ${m.role === 'user' ? 'user' : 'bot'}${m.error ? ' err' : ''}`;
  div.dataset.id = m.id || '';
  div.innerHTML = md(m.content);
  if (m.role === 'assistant' && m.id && !m.error) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    const up = m.feedback > 0 ? 'on' : '';
    const dn = m.feedback < 0 ? 'on dn' : '';
    meta.innerHTML = `<button class="fb up ${up}" data-fb="1">👍</button><button class="fb dn ${dn}" data-fb="-1">👎</button>
      <span>${new Date(m.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>`;
    meta.querySelectorAll('.fb').forEach((b) => b.addEventListener('click', () => feedback(m.id, Number(b.dataset.fb), b)));
    div.appendChild(meta);
  }
  $('#msgs').appendChild(div);
  if (animate) requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  return div;
}

async function feedback(id, value, btn) {
  const comment = value < 0 ? prompt('Neyi iyileştirmemi istersin? (EVRIM bunu hafızasına yazar)') || '' : '';
  try {
    await api('/api/feedback', { body: { messageId: id, value, comment } });
    $$('.fb', btn.parentElement).forEach((b) => b.classList.remove('on', 'dn'));
    btn.classList.add('on');
    if (value < 0) btn.classList.add('dn');
    toast(value > 0 ? 'Teşekkürler, kaydettim 🧠' : 'Not alındı — bir dahakine daha iyisini yapacağım', 'ok');
    loadStatus();
  } catch (e) { toast(e.message, 'bad'); }
}

function typing() {
  const div = document.createElement('div');
  div.className = 'msg bot';
  div.id = 'typing';
  div.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;
  $('#msgs').appendChild(div);
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

async function send(text) {
  const content = (text ?? $('#input').value).trim();
  if (!content || sending) return;
  sending = true;
  $('#input').value = '';
  autoGrow();
  addMsg({ role: 'user', content }, true);
  busy($('#send'), true, '');
  typing();
  try {
    const r = await api('/api/chat', { body: { message: content, conversationId } });
    conversationId = r.conversationId;
    $('#typing')?.remove();
    addMsg(r.message, true);
    setTimeout(loadStatus, 1200); // öz-gelişim arka planda çalışıyor
  } catch (e) {
    $('#typing')?.remove();
    addMsg({ role: 'assistant', content: `⚠️ ${e.message}`, error: true });
  } finally {
    busy($('#send'), false);
    sending = false;
  }
}

$('#send').addEventListener('click', () => send());
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
function autoGrow() {
  const el = $('#input');
  el.style.height = 'auto';
  el.style.height = Math.min(120, el.scrollHeight) + 'px';
}
$('#input').addEventListener('input', autoGrow);
$$('[data-quick]').forEach((b) => b.addEventListener('click', () => send(b.dataset.quick)));

async function loadChat() {
  try {
    const convs = await api('/api/conversations');
    if (!convs.length) return;
    conversationId = convs[0].id;
    const msgs = await api(`/api/messages/${conversationId}`);
    $('#msgs').innerHTML = '';
    if (msgs.length) { $('#welcomeCard').style.display = 'none'; $('#chatEmpty').style.display = 'none'; }
    msgs.forEach((m) => addMsg(m));
    window.scrollTo({ top: document.body.scrollHeight });
  } catch {}
}

/* ---------------- durum ---------------- */
async function loadStatus() {
  try {
    const s = await api('/api/status');
    const pill = $('#statusPill');
    if (s.provider === 'demo') {
      pill.textContent = '🧪 demo modu';
      pill.className = 'pill demo';
      $('#subBrand').textContent = 'anahtar yok — Ayarlar';
    } else {
      pill.textContent = `${s.providerName} · ${s.model.split('/').pop()}`;
      pill.className = 'pill ok';
      $('#subBrand').textContent = `v${s.stats.promptVersion} · ${s.stats.memories} hafıza`;
    }
    const pb = $('#pendingBadge');
    if (s.stats.pendingPatches > 0) { pb.style.display = 'grid'; pb.textContent = s.stats.pendingPatches; } else pb.style.display = 'none';
    const db = $('#dueBadge');
    if (s.learning.due > 0) { db.style.display = 'grid'; db.textContent = s.learning.due; } else db.style.display = 'none';
    window.__status = s;
    if (currentView === 'evo') renderEvoStats(s);
    if (currentView === 'learn') renderLearnStats(s);
    if (currentView === 'gh') renderGhStatus(s);
  } catch (e) { console.error(e); }
}

/* ---------------- öğren ---------------- */
let dueQueue = [];
function renderLearnStats(s) {
  const l = s.learning;
  $('#learnStats').innerHTML = `
    <div class="stat"><b>${l.due}</b><span>bekleyen kart</span></div>
    <div class="stat"><b>%${l.accuracy}</b><span>doğruluk</span></div>
    <div class="stat"><b>${l.cards}</b><span>toplam kart</span></div>`;
}

async function loadLearn() {
  try {
    const r = await api('/api/learn/cards');
    renderLearnStats(window.__status || { learning: r.stats });
    $('#dueChip').textContent = `${r.due.length} kart hazır`;
    dueQueue = r.due;
    nextCard();
    $('#cardList').innerHTML = r.all.length
      ? r.all.map((c) => `
        <div class="item">
          <div class="t">${esc(c.topic)} <span class="chip">zorluk ${c.difficulty || 3}</span> <span class="chip">kutu ${c.box}</span></div>
          <div class="s">${esc(c.question)}</div>
          <div class="a">
            <span class="chip ${c.reviews ? (c.correct / c.reviews > 0.6 ? 'ok' : 'warn') : ''}">${c.correct}/${c.reviews} doğru</span>
            <span class="chip">sonraki: ${new Date(c.dueAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            <button class="btn sm danger" data-del="${c.id}" style="margin-left:auto">Sil</button>
          </div>
        </div>`).join('')
      : '<div class="empty">Kart yok. Yukarıdan AI ile soru üret ya da kendin ekle.</div>';
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/api/learn/cards/${b.dataset.del}`, { method: 'DELETE' });
      toast('Kart silindi'); loadLearn(); loadStatus();
    }));
  } catch (e) { toast(e.message, 'bad'); }
}

function nextCard() {
  const box = $('#studyBox');
  const c = dueQueue.shift();
  if (!c) {
    box.innerHTML = '<div class="card"><p class="hint">🎉 Şimdilik tekrar bekleyen kart yok. Yeni soru üret ya da daha sonra gel.</p></div>';
    return;
  }
  box.innerHTML = `
    <div class="card">
      <span class="chip acc">${esc(c.topic)}</span> <span class="chip">zorluk ${c.difficulty || 3}/5</span>
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
      const r = await api('/api/learn/grade', { body: { cardId: c.id, userAnswer: $('#ans').value } });
      $('#gradeOut').innerHTML = `
        <hr><div class="item" style="border-color:${r.correct ? 'rgba(52,211,153,.4)' : 'rgba(251,113,133,.4)'}">
          <div class="t">${r.correct ? '✅ Doğru' : '❌ Yanlış'} <span class="chip">${r.nextInHours} saat sonra tekrar</span></div>
          <div class="s">${esc(r.feedback || '')}</div>
          <div class="s muted"><b>Doğru cevap:</b> ${esc(c.answer)}</div>
          <div class="a"><button class="btn sm" id="btnNext">Sonraki kart →</button></div>
        </div>`;
      $('#btnNext').addEventListener('click', () => { nextCard(); loadLearn(); });
      loadStatus();
    } catch (e) { toast(e.message, 'bad'); }
    finally { busy(btn, false); }
  });
}

$('#btnGen').addEventListener('click', async () => {
  const topic = $('#genTopic').value.trim();
  if (!topic) return toast('Önce bir konu yaz', 'bad');
  busy($('#btnGen'), true, 'Sorular üretiliyor…');
  try {
    const r = await api('/api/learn/generate', { body: { topic, count: Number($('#genCount').value), level: Number($('#genLevel').value) } });
    if (r.demo) toast(r.message, 'bad');
    else { toast(`${r.cards.length} soru üretildi ✨`, 'ok'); loadLearn(); }
  } catch (e) { toast(e.message, 'bad'); }
  finally { busy($('#btnGen'), false); }
});

$('#btnPlan').addEventListener('click', async () => {
  const goal = $('#planGoal').value.trim();
  if (!goal) return toast('Hedefini yaz', 'bad');
  busy($('#btnPlan'), true, 'Plan hazırlanıyor…');
  try {
    const r = await api('/api/learn/plan', { body: { goal, minutesPerDay: Number($('#planMin').value) } });
    $('#planOut').textContent = r.plan || r.message || '';
  } catch (e) { toast(e.message, 'bad'); }
  finally { busy($('#btnPlan'), false); }
});

/* ---------------- github ---------------- */
function renderGhStatus(s) {
  const g = s.github;
  $('#ghRepoHint').innerHTML = g.repo
    ? `<span class="chip ok">🐙 ${esc(g.repo)}</span> <span class="chip">dal: ${esc(g.branch)}</span>
       ${g.hasToken ? '<span class="chip ok">token ✓</span>' : '<span class="chip warn">token yok → sadece public okuma</span>'}`
    : 'Henüz repo bağlanmadı. Ayarlar → GitHub bölümünden ekle.';
}

let ghData = null;
async function loadGh() {
  renderGhStatus(window.__status || { github: {} });
  const s = window.__status;
  if (!s?.github?.repo) {
    $('#gh-overview').innerHTML = '<div class="empty">Repo bağlandığında burada özet, commitler ve issue\'lar görünecek.</div>';
    return;
  }
  $('#gh-overview').innerHTML = '<div class="card"><span class="spin"></span> <span class="muted">Repo okunuyor…</span></div>';
  try {
    ghData = await api(`/api/github/repo?full=${encodeURIComponent(s.github.repo)}`);
    const i = ghData.info;
    $('#gh-overview').innerHTML = `
      <div class="card">
        <h3>${esc(i.full)}</h3>
        <p class="hint">${esc(i.description || 'Açıklama yok')}</p>
        <div class="grid3">
          <div class="stat"><b>⭐ ${i.stars}</b><span>yıldız</span></div>
          <div class="stat"><b>${i.language || '-'}</b><span>ana dil</span></div>
          <div class="stat"><b>${ghData.tree.files?.length || 0}</b><span>dosya</span></div>
        </div>
        <div class="row" style="margin-top:10px">
          <a class="btn ghost sm" href="${i.htmlUrl}" target="_blank" rel="noopener">GitHub'da aç</a>
        </div>
      </div>
      <div class="sect">Son commitler</div>
      ${ghData.commits.map((c) => `<div class="item"><div class="t">${esc(c.message)}</div>
        <div class="s"><span class="mono">${c.sha}</span> · ${esc(c.author)} · ${new Date(c.date).toLocaleString('tr-TR')}</div></div>`).join('') || '<div class="empty">Commit yok</div>'}
      <div class="sect">Açık issue'lar</div>
      ${ghData.issues.map((x) => `<div class="item"><div class="t">#${x.number} ${esc(x.title)}</div>
        <div class="a">${x.labels.map((l) => `<span class="chip">${esc(l)}</span>`).join('')}</div></div>`).join('') || '<div class="empty">Açık issue yok 🎉</div>'}
      <div class="sect">Dosya ağacı</div>
      <div id="treeInline"></div>`;
    renderTree($('#treeInline'));
  } catch (e) {
    $('#gh-overview').innerHTML = `<div class="card"><b>Hata:</b> ${esc(e.message)}${e.message.includes('rate') ? '<br><span class="muted">Ücretsiz token eklersen limit yükselir.</span>' : ''}</div>`;
  }
}

function renderTree(target) {
  const files = (ghData?.tree?.files || []).slice(0, 300);
  target.innerHTML = files.length
    ? files.map((f) => `<div class="item" style="padding:8px 10px"><div class="t mono" style="font-weight:500">${esc(f.path)}</div>
        <div class="a"><span class="chip">${(f.size / 1024).toFixed(1)} KB</span>
        <button class="btn sm ghost" data-open="${esc(f.path)}">Dosyayı aç</button></div></div>`).join('')
    : '<div class="empty">Dosya listelenemedi</div>';
  $$('[data-open]', target).forEach((b) => b.addEventListener('click', () => {
    go('gh'); $('#filePath').value = b.dataset.open;
    $$('#ghTabs button').forEach((x) => x.classList.toggle('on', x.dataset.gt === 'files'));
    ghPanel('files'); openFile();
  }));
}

function ghPanel(name) {
  ['overview', 'files', 'agent', 'daily'].forEach((p) => {
    $(`#gh-${p}`).style.display = p === name ? 'block' : 'none';
  });
}
$$('#ghTabs button').forEach((b) => b.addEventListener('click', () => {
  $$('#ghTabs button').forEach((x) => x.classList.remove('on'));
  b.classList.add('on');
  ghPanel(b.dataset.gt);
  if (b.dataset.gt === 'files' && ghData) { $('#treeList').innerHTML = ''; renderTree($('#treeList')); }
}));

async function openFile() {
  const p = $('#filePath').value.trim();
  if (!p) return toast('Dosya yolu gir', 'bad');
  busy($('#btnOpenFile'), true, '…');
  try {
    const r = await api(`/api/github/file?path=${encodeURIComponent(p)}`);
    $('#fileOut').style.display = 'block';
    $('#fileOut').textContent = r.content.slice(0, 20000);
  } catch (e) { toast(e.message, 'bad'); }
  finally { busy($('#btnOpenFile'), false); }
}
$('#btnOpenFile').addEventListener('click', openFile);

$('#btnAnalyze').addEventListener('click', async () => {
  busy($('#btnAnalyze'), true, 'Repo inceleniyor (30-60 sn)…');
  try {
    const r = await api('/api/github/analyze', { body: {} });
    $('#analyzeOut').innerHTML = r.demo ? `<span class="chip warn">demo</span> ${esc(r.report)}` : md(r.report);
  } catch (e) { $('#analyzeOut').textContent = '⚠️ ' + e.message; }
  finally { busy($('#btnAnalyze'), false); }
});

$('#btnDaily').addEventListener('click', async () => {
  busy($('#btnDaily'), true, 'Özetleniyor…');
  try {
    const r = await api('/api/github/daily');
    $('#dailyOut').innerHTML = `<div class="row" style="margin-bottom:8px">
      <div class="stat"><b>${r.counts.commitsToday}</b><span>commit (24s)</span></div>
      <div class="stat"><b>${r.counts.openIssues}</b><span>açık issue</span></div>
      <div class="stat"><b>${r.counts.openPRs}</b><span>açık PR</span></div></div>` + md(r.summary);
  } catch (e) { $('#dailyOut').textContent = '⚠️ ' + e.message; }
  finally { busy($('#btnDaily'), false); }
});

$('#btnTask').addEventListener('click', async () => {
  const task = $('#taskText').value.trim();
  if (!task) return toast('Görev yaz', 'bad');
  const btn = $('#btnTask');
  busy(btn, true, 'AI kod yazıyor…');
  $('#taskOut').innerHTML = '<div class="card"><span class="spin"></span> <span class="muted">Repo okunuyor, değişiklik üretiliyor…</span></div>';
  try {
    const r = await api('/api/github/implement', {
      body: {
        task,
        targetPaths: $('#taskPaths').value.split(',').map((x) => x.trim()).filter(Boolean),
        autoCommit: $('#taskAutoCommit').checked,
      },
    });
    if (r.demo) { $('#taskOut').innerHTML = `<div class="card"><span class="chip warn">demo</span> ${esc(r.message)}</div>`; return; }
    $('#taskOut').innerHTML = `<div class="card"><h3>Plan</h3><p class="hint">${esc(r.plan || '')}</p>
      ${r.files.map((f, idx) => `<div class="sect">${esc(f.path)} ${f.isNew ? '<span class="chip acc">yeni</span>' : '<span class="chip">güncellendi</span>'}</div>
        <pre>${esc(f.content.slice(0, 8000))}</pre>
        ${r.committed ? '' : `<button class="btn sm ok" data-commit="${idx}">✓ Bu değişikliği repoya commit et</button>`}`).join('')}
      ${r.committed ? `<div class="item" style="border-color:rgba(52,211,153,.4)"><div class="t">✅ Commit atıldı: <span class="mono">${r.committed.sha}</span></div>
        <div class="s"><a href="${r.committed.url}" target="_blank" rel="noopener">GitHub'da gör</a></div></div>` : ''}
      </div>`;
    $$('[data-commit]').forEach((b) => b.addEventListener('click', async () => {
      const f = r.files[Number(b.dataset.commit)];
      busy(b, true, 'Commit ediliyor…');
      try {
        const c = await api('/api/github/commit', { body: { path: f.path, content: f.content, message: r.commitMessage } });
        toast(`Commit atıldı: ${c.sha}`, 'ok');
        b.outerHTML = `<div class="chip ok">✅ commit ${c.sha} — <a href="${c.url}" target="_blank" rel="noopener">gör</a></div>`;
      } catch (e) { toast(e.message, 'bad'); busy(b, false); }
    }));
    loadStatus();
  } catch (e) { $('#taskOut').innerHTML = `<div class="card">⚠️ ${esc(e.message)}</div>`; }
  finally { busy(btn, false); }
});

/* ---------------- evrim ---------------- */
function renderEvoStats(s) {
  const st = s.stats;
  $('#evoStats').innerHTML = `
    <div class="stat"><b>v${st.promptVersion}</b><span>beyin sürümü</span></div>
    <div class="stat"><b>${st.memories}</b><span>hafıza</span></div>
    <div class="stat"><b>${st.evolutions}</b><span>gelişim kaydı</span></div>`;
}

const KIND_TR = { fact: 'Bilgi', preference: 'Tercih', skill: 'Beceri', mistake: 'Hata', rule: 'Kural' };
const TYPE_TR = { 'prompt-patch': '🧠 Kural yaması', memory: '💾 Hafıza', feedback: '👍 Geri bildirim', 'repo-analysis': '🔍 Repo analizi', 'code-change': '💻 Kod değişikliği', plan: '🗓 Plan', error: '⚠️ Hata' };

let memFilter = '';
$$('#memTabs button').forEach((b) => b.addEventListener('click', () => {
  $$('#memTabs button').forEach((x) => x.classList.remove('on'));
  b.classList.add('on');
  memFilter = b.dataset.mk;
  loadMemories();
}));

async function loadEvo() {
  if (window.__status) renderEvoStats(window.__status);
  const [evos, prompts, skills] = await Promise.all([
    api('/api/evolutions').catch(() => []),
    api('/api/prompts').catch(() => []),
    api('/api/skills').catch(() => []),
  ]);
  const pending = evos.filter((e) => e.type === 'prompt-patch' && !e.applied && !e.rejected);
  $('#pendingList').innerHTML = pending.length
    ? pending.map((e) => `<div class="item" style="border-color:rgba(124,92,255,.45)">
        <div class="t">${esc(e.summary)}</div>
        <div class="s">${esc(e.detail || '')}</div>
        <div class="a"><span class="chip">güven ${(e.confidence * 100) | 0}%</span>
          <button class="btn sm ok" data-approve="${e.id}">Uygula</button>
          <button class="btn sm danger" data-reject="${e.id}">Reddet</button></div></div>`).join('')
    : '<div class="empty">Bekleyen yama yok — EVRIM şu anki kurallarından memnun 🙂</div>';

  $$('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/evolutions/${b.dataset.approve}/approve`, { body: {} });
    toast('Yama uygulandı, beynim güncellendi 🧬', 'ok'); loadEvo(); loadStatus();
  }));
  $$('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/evolutions/${b.dataset.reject}/reject`, { body: {} });
    toast('Yama reddedildi'); loadEvo(); loadStatus();
  }));

  $('#evoList').innerHTML = evos.length
    ? evos.slice(0, 40).map((e) => `<div class="item">
        <div class="t">${TYPE_TR[e.type] || e.type} ${e.applied ? '<span class="chip ok">uygulandı</span>' : '<span class="chip warn">pasif</span>'}</div>
        <div class="s">${esc(e.summary)}${e.detail ? '\n' + esc(e.detail) : ''}</div>
        <div class="a"><span class="chip">${new Date(e.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>`).join('')
    : '<div class="empty">Henüz gelişim kaydı yok. Sohbet ettikçe burası dolacak.</div>';

  $('#curVer').textContent = prompts[0] ? `v${prompts[0].version}` : 'v1';
  $('#promptVersions').innerHTML = prompts.map((p) => `<div class="item">
      <div class="t">v${p.version} <span class="chip">${esc(p.source)}</span></div>
      <div class="s">${esc(p.reason || '')}</div>
      <div class="a"><span class="chip">${new Date(p.createdAt).toLocaleString('tr-TR')}</span>
      ${prompts[0].id === p.id ? '<span class="chip ok">aktif</span>' : `<button class="btn sm ghost" data-rb="${p.id}">Bu sürüme dön</button>`}</div>
    </div>`).join('');
  $$('[data-rb]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/prompt/rollback/${b.dataset.rb}`, { body: {} });
    toast('Eski sürüme dönüldü'); loadEvo(); loadStatus();
  }));

  $('#skillList').innerHTML = skills.length
    ? skills.map((s) => `<div class="item"><div class="t">${esc(s.topic)} <span class="chip">seviye ${s.level}/5</span></div>
        <div class="bar"><i style="width:${s.level * 20}%"></i></div>
        <div class="s">${esc(s.note || '')}</div></div>`).join('')
    : '<div class="empty">Beceri haritası boş. Öğren sekmesinde çalıştıkça otomatik dolacak.</div>';

  loadMemories();
}

async function loadMemories() {
  const q = memFilter ? `?kind=${memFilter}` : '';
  const mems = await api('/api/memories' + q).catch(() => []);
  $('#memList').innerHTML = mems.length
    ? mems.map((m) => `<div class="item">
        <div class="t">${esc(m.content)}</div>
        <div class="a"><span class="chip acc">${KIND_TR[m.kind] || m.kind}</span>
          <span class="chip">güven ${(m.strength * 100) | 0}%</span>
          <span class="chip">${m.hits || 1} kez</span>
          <span class="chip">${esc(m.source)}</span>
          <button class="btn sm danger" data-forget="${m.id}" style="margin-left:auto">Unut</button></div>
      </div>`).join('')
    : '<div class="empty">Bu kategoride hafıza kaydı yok.</div>';
  $$('[data-forget]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/memories/${b.dataset.forget}`, { method: 'DELETE' });
    toast('Unutuldu'); loadMemories(); loadStatus();
  }));
}

$('#btnAddMem').addEventListener('click', async () => {
  const content = $('#memText').value.trim();
  if (!content) return toast('Bir şey yaz', 'bad');
  await api('/api/memories', { body: { content, kind: $('#memKind').value } });
  $('#memText').value = '';
  toast('Hafızaya eklendi 🧠', 'ok');
  loadMemories(); loadStatus();
});

$('#btnShowPrompt').addEventListener('click', async () => {
  const r = await api('/api/prompt');
  const el = $('#promptOut');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
  el.textContent = r.rendered;
});
$('#btnEditPrompt').addEventListener('click', async () => {
  const box = $('#promptEdit');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
  if (box.style.display === 'block') $('#promptText').value = (await api('/api/prompt')).current.text;
});
$('#btnSavePrompt').addEventListener('click', async () => {
  busy($('#btnSavePrompt'), true, 'Kaydediliyor…');
  try {
    const v = await api('/api/prompt/edit', { body: { text: $('#promptText').value, reason: $('#promptReason').value } });
    toast(`Beyin v${v.version} kaydedildi`, 'ok');
    loadEvo(); loadStatus();
  } catch (e) { toast(e.message, 'bad'); }
  finally { busy($('#btnSavePrompt'), false); }
});

/* ---------------- ayarlar ---------------- */
async function loadSettings() {
  try {
    const s = await api('/api/settings');
    $('#setProvider').value = s.provider;
    $('#setKey').value = s.apiKey || '';
    $('#setModel').value = s.model || '';
    $('#setRepo').value = s.githubRepo || '';
    $('#setBranch').value = s.githubBranch || 'main';
    $('#setGh').value = s.githubToken || '';
    $('#setEvolve').checked = s.selfEvolution;
    $('#setAutoCommit').checked = s.autoCommit;
    $('#setThr').value = s.evolveThreshold;
    $('#thrLabel').textContent = Number(s.evolveThreshold).toFixed(2);
    $('#setName').value = s.userName || '';
    const st = window.__status;
    $('#sysInfo').innerHTML = `
      <div class="kv"><span>Sağlayıcı</span><b>${esc(st?.providerName || '-')}</b></div>
      <div class="kv"><span>Model</span><b>${esc(st?.model || '-')}</b></div>
      <div class="kv"><span>Beyin sürümü</span><b>v${st?.stats?.promptVersion || 1}</b></div>
      <div class="kv"><span>Hafıza kaydı</span><b>${st?.stats?.memories || 0}</b></div>
      <div class="kv"><span>Mesaj sayısı</span><b>${st?.stats?.messages || 0}</b></div>
      <div class="kv"><span>Veri klasörü</span><b class="mono" style="font-size:11px">${esc(st?.dataDir || '')}</b></div>`;
  } catch (e) { toast(e.message, 'bad'); }
}
$('#setThr').addEventListener('input', () => ($('#thrLabel').textContent = Number($('#setThr').value).toFixed(2)));

$('#btnSaveAI').addEventListener('click', async () => {
  busy($('#btnSaveAI'), true, 'Kaydediliyor…');
  try {
    const r = await api('/api/settings', {
      body: { provider: $('#setProvider').value, apiKey: $('#setKey').value.trim(), model: $('#setModel').value.trim() },
    });
    $('#aiOut').innerHTML = `✅ Kaydedildi → <b>${esc(r.provider)}</b> / <span class="mono">${esc(r.model)}</span>`;
    toast('AI ayarları kaydedildi', 'ok');
    loadStatus();
  } catch (e) { $('#aiOut').textContent = '⚠️ ' + e.message; }
  finally { busy($('#btnSaveAI'), false); }
});

$('#btnTestAI').addEventListener('click', async () => {
  busy($('#btnTestAI'), true, 'Test…');
  try {
    const r = await api('/api/test-llm', { body: {} });
    $('#aiOut').innerHTML = `✅ <b>${esc(r.provider)}</b> çalışıyor → “${esc(r.reply)}” <span class="mono">(${esc(r.model)})</span>`;
  } catch (e) { $('#aiOut').textContent = '⚠️ ' + e.message; }
  finally { busy($('#btnTestAI'), false); }
});

$('#btnSaveGh').addEventListener('click', async () => {
  busy($('#btnSaveGh'), true, 'Kaydediliyor…');
  try {
    await api('/api/settings', {
      body: {
        githubRepo: $('#setRepo').value.trim(),
        githubBranch: $('#setBranch').value.trim() || 'main',
        githubToken: $('#setGh').value.trim(),
      },
    });
    toast('GitHub ayarları kaydedildi', 'ok');
    $('#ghOut').textContent = '✅ Kaydedildi';
    await loadStatus(); loadGh();
  } catch (e) { $('#ghOut').textContent = '⚠️ ' + e.message; }
  finally { busy($('#btnSaveGh'), false); }
});

$('#btnCheckGh').addEventListener('click', async () => {
  busy($('#btnCheckGh'), true, 'Kontrol…');
  try {
    const r = await api('/api/status');
    $('#ghOut').innerHTML = r.github.user
      ? `✅ Bağlı: <b>${esc(r.github.user.login)}</b> — repo: <b>${esc(r.github.repo || 'yok')}</b>`
      : '⚠️ Token doğrulanamadı veya boş. Public repolar yine de okunabilir.';
  } catch (e) { $('#ghOut').textContent = '⚠️ ' + e.message; }
  finally { busy($('#btnCheckGh'), false); }
});

$('#btnPickRepo').addEventListener('click', async () => {
  const box = $('#repoPicker');
  box.style.display = 'block';
  box.innerHTML = '<span class="spin"></span> <span class="muted">Repoların çekiliyor…</span>';
  try {
    const repos = await api('/api/github/repos');
    box.innerHTML = repos.length
      ? repos.map((r) => `<div class="item" style="padding:8px 10px"><div class="t">${esc(r.full)}</div>
          <div class="s">${esc(r.description || '')} ${r.private ? '🔒' : ''}</div>
          <div class="a"><button class="btn sm" data-repo="${esc(r.full)}" data-branch="${esc(r.defaultBranch || 'main')}">Bağla</button></div></div>`).join('')
      : '<div class="empty">Repo bulunamadı (token yetkisini kontrol et).</div>';
    $$('[data-repo]', box).forEach((b) => b.addEventListener('click', () => {
      $('#setRepo').value = b.dataset.repo;
      $('#setBranch').value = b.dataset.branch;
      box.style.display = 'none';
      toast('Seçildi — şimdi Kaydet’e bas');
    }));
  } catch (e) { box.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; }
});

$('#btnSaveSet').addEventListener('click', async () => {
  busy($('#btnSaveSet'), true, 'Kaydediliyor…');
  try {
    await api('/api/settings', {
      body: {
        selfEvolution: $('#setEvolve').checked,
        autoCommit: $('#setAutoCommit').checked,
        evolveThreshold: Number($('#setThr').value),
        userName: $('#setName').value.trim(),
      },
    });
    toast('Ayarlar kaydedildi', 'ok');
    loadStatus();
  } catch (e) { toast(e.message, 'bad'); }
  finally { busy($('#btnSaveSet'), false); }
});

/* PWA kurulum */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('#btnInstall').textContent = '📲 Uygulamayı yükle'; });
$('#btnInstall').addEventListener('click', async () => {
  if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
  else toast('iPhone: Safari → Paylaş → "Ana Ekrana Ekle". Android: Chrome menüsü → "Uygulamayı yükle".');
});

/* başlat */
(async function init() {
  await loadStatus();
  await loadChat();
  setInterval(loadStatus, 20000);
})();
