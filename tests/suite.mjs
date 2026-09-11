/* EVRIM jsdom regresyon seti — kalıcı (repo içinde).
   Çalıştırma: cd /home/user/evrim && npx esbuild web/js/app.js --bundle --format=iife --outfile=tests/bundle.js && node tests/suite.mjs
   Bölümler: 1) beyin v5 + web_oku + perf + 👎kural  2) gorsel_uret (puter)  3) anahtarsız bağlan akışı  4) geçersiz anahtar kurtarma  5) katalog  6) gorsel reload kalıcılığı */
import { JSDOM } from 'jsdom';
import fs from 'fs';

const html = fs.readFileSync('/home/user/evrim/web/index.html', 'utf8');
const bundle = fs.readFileSync('/home/user/evrim/tests/bundle.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];

function makeWin(overrides = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){} });
  w.Element.prototype.scrollTo = function () {};
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.confirm = () => true; w.alert = () => {};
  // jsdom dış scriptleri yüklemez: src atanınca 'load' olayı simüle et (Puter SDK mock akışı için)
  Object.defineProperty(w.HTMLScriptElement.prototype, 'src', {
    set() { setTimeout(() => this.dispatchEvent(new w.Event('load')), 0); },
    get() { return ''; }, configurable: true,
  });
  w.prompt = () => 'daha kısa ve maddeli yaz';
  if (!('__EVHOUSEKEY' in overrides)) w.__EVHOUSEKEY = ''; // testlerde ev anahtarı kapalı (gerçek senaryo: anahtarsız zincir)
  w.errors = [];
  w.addEventListener('error', (e) => w.errors.push(e.error?.stack || e.message));
  Object.assign(w, overrides);
  return w;
}
function fakeRes(body, toolCall, finalText) {
  const enc = new TextEncoder();
  if (!body.stream) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: '{}' } }] }), text: async () => '{}' };
  const chunk1 = toolCall
    ? { delta: { tool_calls: [{ index: 0, id: 'tc1', type: 'function', function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) } }] }, finish_reason: null }
    : { delta: { content: finalText }, finish_reason: null };
  const chunks = [chunk1, { delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' }];
  const text = chunks.map((c) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, ...c }] })}\n\n`).join('') + 'data: [DONE]\n\n';
  return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, json: async () => ({}), text: async () => text,
    body: { getReader() { let d = false; return { read: async () => d ? { done: true, value: undefined } : (d = true, { done: false, value: enc.encode(text) }), cancel: async () => {} }; } } };
}

/* ================= 1) BEYİN v5 + web_oku + perf + 👎 kural ================= */
{
  let step = 0; const calls = [];
  const JINA_MD = `Title: Test Sayfası\n\nURL Source: https://example.com/x\n\nMarkdown Content:\n![resim](https://example.com/i.png)\nBu bir [bağlantı](https://example.com/y) içeren test metnidir.\n\n## test bölümü\nBurada TEST KONU geçiyor.\n\n\n\nSon satır.`;
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('r.jina.ai')) { calls.push({ u }); return { ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => JINA_MD, json: async () => ({}) }; }
    if (u.includes('openrouter.ai')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push({ u, body });
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [{ id: 'a/m:free' }] }) };
      step++;
      return step === 1
        ? fakeRes(body, { name: 'web_oku', args: { url: 'https://example.com/x', odak: 'test konu' } })
        : fakeRes(body, null, 'Sayfaya göre: TEST KONU şudur.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.localStorage.setItem('evrim:settings', JSON.stringify({ apiKey: 'sk-or-v1-' + 'a'.repeat(56), provider: 'openrouter', model: 'a/m:free' }));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Zeka'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'şu linki özetler misin https://example.com/x';
  $(w, '#send').click();
  await wait(3000);
  const sys = calls.find((c) => c.body?.tools)?.body?.messages?.[0]?.content || '';
  ok('1. beyin v7 sistem promptunda', sys.includes('CEVAP BİÇİMİ VE DÜRÜSTLÜK') && sys.includes('Sürüm: 7') && sys.includes('AJAN ÇALIŞMA BİÇİMİM') && sys.includes('web_ara'));
  ok('1. web_oku araç listesinde', (calls.find((c) => c.body?.tools)?.body?.tools || []).some((t) => t.function.name === 'web_oku'));
  const toolMsg = calls.filter((c) => c.body?.stream)[1]?.body?.messages?.find((m) => m.role === 'tool');
  const res = toolMsg ? JSON.parse(toolMsg.content) : null;
  ok('1. web_oku: jina çağrıldı + başlık', calls.some((c) => c.u.includes('r.jina.ai')) && res?.baslik === 'Test Sayfası');
  ok('1. web_oku: görsel/url temizliği', !String(res?.icerik).includes('![') && String(res?.icerik).includes('bağlantı') && !String(res?.icerik).includes('](https://example.com/y)'));
  ok('1. web_oku: odak bölümü', String(res?.icerik).includes('TEST KONU'));
  ok('1. UI çipi: Sayfa okudu', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('Sayfa okudu')));
  ok('1. cevap kaydedildi + meta düğmeleri', (JSON.parse(w.localStorage.getItem('evrim:messages') || '[]').length >= 2) && $$(w, '#msgs .fb').length > 0);
  const perf = JSON.parse(w.localStorage.getItem('evrim:modelPerf') || '{}');
  const pe = Object.values(perf)[0];
  ok('1. model performansı ölçüldü', !!pe && pe.ok >= 1 && pe.ms >= 0);
  const dn = $$(w, '#msgs .fb[data-fb="-1"]')[0];
  if (dn) dn.click();
  await wait(300);
  const mems = JSON.parse(w.localStorage.getItem('evrim:memories') || '[]');
  ok('1. 👎+yorum → kalıcı kural', mems.some((m) => m.kind === 'rule' && String(m.content).includes('Kullanıcı düzeltmesi')));
  ok('1. evrim günlüğüne işlendi', JSON.parse(w.localStorage.getItem('evrim:evolutions') || '[]').some((e) => e.type === 'feedback'));
  ok('1. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 2) gorsel_uret (puter mock) ================= */
{
  let round = 0; const calls = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('openrouter.ai')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push({ body });
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      return round === 1 ? fakeRes(body, { name: 'gorsel_uret', args: { istem: 'kırmızı gül' } }) : fakeRes(body, null, 'Görsel hazır.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.puter = { auth: { isSignedIn: () => true, signIn: async () => {} },
    ai: { chat: async () => ({ message: { content: 'ok' } }), models: async () => [], txt2img: async () => { const i = w.document.createElement('img'); i.src = 'data:image/png;base64,iVBORw0KGgo='; return i; } } };
  w.localStorage.setItem('evrim:settings', JSON.stringify({ apiKey: 'sk-or-v1-' + 'a'.repeat(56), provider: 'openrouter', model: 'a/m:free' }));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Çizer'; $(w, '#npCreate').click(); await wait(200);
  $(w, '#input').value = 'gül çiz'; $(w, '#send').click();
  await wait(2500);
  const t2 = calls.filter((c) => c.body?.stream)[1]?.body?.messages?.find((m) => m.role === 'tool');
  const r2 = t2 ? JSON.parse(t2.content) : null;
  const media2 = JSON.parse(w.localStorage.getItem('evrim:media') || '{}');
  ok('2. gorsel: txt2img → ok + media deposuna yazıldı', r2?.ok === true && Object.keys(media2).length === 1 && String(r2?.not || '').includes('evrimimg:'));
  ok('2. gorsel: araç çipi', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('Görsel')));
  ok('2. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 3) ANAHTARSIZ: kart + bağlan + otomatik tekrar ================= */
{
  const calls = []; let signedIn = false;
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('openrouter.ai') && !u.includes('/models')) { const body = opts?.body ? JSON.parse(opts.body) : null; calls.push({ body }); return fakeRes(body, null, 'Puter cevabı.'); }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.puter = { auth: { isSignedIn: () => signedIn, signIn: async () => { signedIn = true; return true; } },
    ai: { chat: async () => { if (!signedIn) throw new Error('sign-in required'); return { message: { content: 'Merhaba, Puter cevabı.' } }; }, models: async () => [{ id: 'p1', name: 'p1' }] } };
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Yeni'; $(w, '#npCreate').click(); await wait(200);
  ok('3. açılış: uyarı bandı YOK (beyin hazır görünür)', ($(w, '#brainBar')?.style.display || 'none') === 'none');
  ok('3. açılış: pill korkutucu değil', !($(w, '#statusPill')?.textContent || '').includes('WebGPU') && ($(w, '#statusPill')?.textContent || '').includes('ücretsiz mod'));
  $(w, '#input').value = 'kuantum bilgisayarı nedir kısaca'; $(w, '#send').click();
  await wait(3500); // v24: ev bulutu sessiz bak → yoksa kart (OTOMATİK YÖNLENDİRME YOK)
  ok('3. kart: anahtar alanı YOK', !$$(w, '#msgs .ckey').length);
  ok('3. kendiliğinden siteye yönlendirme YOK (popup açılmadı)', signedIn === false);
  ok('3. kart: cihaz içi kurulum birincil + bulut isteğe bağlı', !!$(w, '#msgs .cwasm') && !!$(w, '#msgs .cconn'));
  const conn = $(w, '#msgs .cconn');
  if (conn) conn.click(); // kullanıcı İSTERSE buluta basar
  await wait(2500);
  ok('3. isteğe bağlı bağlan → cevap geldi', signedIn && !$$(w, '#msgs .card').length && (JSON.parse(w.localStorage.getItem('evrim:messages') || '[]').some((m) => m.role === 'assistant')));
  ok('3. pill puter', ($(w, '#statusPill')?.textContent || '').includes('Puter'));
  // 2. mesaj doğrudan (kart YOK)
  $(w, '#input').value = 'ikinci'; $(w, '#send').click();
  await wait(2500);
  ok('3. oturum sonrası doğrudan cevap (kart yok)', (JSON.parse(w.localStorage.getItem('evrim:messages') || '[]').filter((m) => m.role === 'assistant').length >= 2) && !$$(w, '#msgs .card').length);
  ok('3. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 4) GEÇERSİZ ANAHTAR → temizle + bağlan kartı ================= */
{
  const w = makeWin({ fetch: async () => ({ ok: false, status: 401, headers: { get: () => 'application/json' }, json: async () => ({ error: { message: 'invalid api key' } }), text: async () => '{"error":{"message":"invalid api key"}}' }) });
  w.localStorage.setItem('evrim:settings', JSON.stringify({ apiKey: 'sk-or-v1-' + 'b'.repeat(56), provider: 'openrouter', model: 'a/m:free' }));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Ölü'; $(w, '#npCreate').click(); await wait(200);
  $(w, '#input').value = 'selam'; $(w, '#send').click();
  await wait(1500);
  const st = JSON.parse(w.localStorage.getItem('evrim:settings') || '{}');
  ok('4. ölü anahtar otomatik temizlendi', !st.apiKey);
  ok('4. bağlan kartı çıktı', !!$(w, '#msgs .cconn'));
  ok('4. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 5) api_katalog (anahtarsız) ================= */
{
  let round = 0; const calls = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('katalog.json')) { const j = JSON.parse(fs.readFileSync('/home/user/evrim/web/data/katalog.json', 'utf8')); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => j, text: async () => fs.readFileSync('/home/user/evrim/web/data/katalog.json', 'utf8') }; }
    if (u.includes('githubusercontent') || u.includes('api.github.com')) return { ok: false, status: 404, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
    if (u.includes('openrouter.ai')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push({ body });
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      return round === 1 ? fakeRes(body, { name: 'api_katalog', args: { sorgu: 'chat' } }) : fakeRes(body, null, 'Katalogda free-api var.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.localStorage.setItem('evrim:settings', JSON.stringify({ apiKey: 'sk-or-v1-' + 'a'.repeat(56), provider: 'openrouter', model: 'a/m:free' }));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Kat'; $(w, '#npCreate').click(); await wait(200);
  $(w, '#input').value = 'ücretsiz api bul'; $(w, '#send').click();
  await wait(2500);
  const toolMsg = calls.filter((c) => c.body?.stream)[1]?.body?.messages?.find((m) => m.role === 'tool');
  ok('5. katalog sonucu döndü (yerel ayna)', !!toolMsg && toolMsg.content.includes('kaynak') && !/\"found\":0/.test(toolMsg.content));
  ok('5. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 6) gorsel reload kalıcılığı ================= */
{
  const w = makeWin({ fetch: async () => ({ ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' }) });
  w.localStorage.setItem('evrim:media', JSON.stringify({ g1: 'data:image/png;base64,iVBORw0KGgo=' }));
  w.localStorage.setItem('evrim:profiles', JSON.stringify([{ id: 'pr1', name: 'Test', color: '#7c5cff', createdAt: new Date().toISOString() }]));
  w.localStorage.setItem('evrim:activeProfile', 'pr1');
  w.localStorage.setItem('evrim:conversations', JSON.stringify([{ id: 'c1', title: 'Görsel', profileId: 'pr1', createdAt: new Date().toISOString() }]));
  w.localStorage.setItem('evrim:messages', JSON.stringify([{ id: 'm1', conversationId: 'c1', role: 'assistant', content: 'Görsel hazır. ![görsel](evrimimg:g1)', createdAt: new Date().toISOString() }]));
  w.localStorage.setItem('evrim:personas', JSON.stringify([{ id: 'p1', name: 'EVRIM', emoji: '⚡', tone: '', model: '', focus: [], createdAt: new Date().toISOString() }]));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(500);
  ok('6. reload sonrası görsel mesajda görünüyor', $$(w, '#msgs img.gen').length === 1);
  ok('6. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 7) bağlanma başarısızsa seçim kartı ================= */
{
  const w = makeWin({ fetch: async () => ({ ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' }) });
  w.puter = { auth: { isSignedIn: () => false, signIn: async () => { throw new Error('popup engellendi'); } },
    ai: { chat: async () => { throw new Error('no session'); }, models: async () => [] } };
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Engel'; $(w, '#npCreate').click(); await wait(200);
  $(w, '#input').value = 'kuantum nedir'; $(w, '#send').click();
  await wait(2500);
  ok('7. ev bulutu yoksa seçim kartı (çıkmaz yok, yönlendirme yok)', !!$(w, '#msgs .cconn') && !!$(w, '#msgs .cwasm'));
  ok('7. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 8) EV BULUTU: sahip cihaz beyin olur, misafir sıfır girişle cevap alır ================= */
function makeBroker() {
  const peers = new Map();
  class E {
    constructor() { this.h = {}; }
    on(n, f) { (this.h[n] = this.h[n] || []).push(f); return this; }
    once(n, f) { const g = (...a) => { this.off(n, g); f(...a); }; return this.on(n, g); }
    off(n, f) { if (this.h[n]) this.h[n] = this.h[n].filter((x) => x !== f); return this; }
    emit(n, ...a) { (this.h[n] || []).slice().forEach((f) => f(...a)); }
  }
  class Conn extends E {
    constructor() { super(); this.open = false; this.remote = null; }
    send(d) { const r = this.remote; setTimeout(() => { if (r && r.open) r.emit('data', d); }, 0); }
    close() { this.open = false; this.emit('close'); const r = this.remote; if (r && r.open) { r.open = false; r.emit('close'); } }
  }
  class Peer extends E {
    constructor(id) {
      super(); this.id = id || ('rnd' + Math.random().toString(36).slice(2)); this.destroyed = false; this.open = false;
      setTimeout(() => {
        if (id && peers.has(id)) { this.emit('error', { type: 'unavailable-id' }); return; }
        peers.set(this.id, this); this.open = true; this.emit('open', this.id);
      }, 0);
    }
    connect(target) {
      const tp = peers.get(target); const a = new Conn(); const b = new Conn(); a.remote = b; b.remote = a;
      setTimeout(() => {
        if (!tp || tp.destroyed) { a.emit('error', new Error('peer yok')); return; }
        a.open = true; b.open = true; a.emit('open'); b.emit('open'); tp.emit('connection', b);
      }, 0);
      return a;
    }
    reconnect() {}
    destroy() { this.destroyed = true; peers.delete(this.id); }
  }
  return Peer;
}
{
  const Broker = makeBroker();
  let hostCalls = 0;
  /* --- SAHİP: anahtarlı cihaz, ev bulutunu açar --- */
  const wH = makeWin({ Peer: Broker, fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('openrouter.ai')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      hostCalls++;
      return fakeRes(body, null, 'Ev bulutundan merhaba!');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  wH.localStorage.setItem('evrim:settings', JSON.stringify({ apiKey: 'sk-or-v1-' + 'a'.repeat(56), provider: 'openrouter', model: 'a/m:free', houseHost: true }));
  try { wH.eval(bundle); } catch (e) { wH.errors.push('THROW: ' + e.stack); }
  await wait(300);
  $(wH, '#npName').value = 'Sahip'; $(wH, '#npCreate').click();
  await wait(900);
  ok('8. sahip: ev bulutu AÇIK', ($(wH, '#houseStat')?.textContent || '').includes('AÇIK'));

  /* --- MİSAFİR: yeni cihaz, hiçbir şeyi yok --- */
  const wG = makeWin({ Peer: Broker, fetch: async () => ({ ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' }) });
  wG.puter = { auth: { isSignedIn: () => false, signIn: async () => { throw new Error('pop'); } }, ai: { chat: async () => { throw new Error('x'); }, models: async () => [] } };
  try { wG.eval(bundle); } catch (e) { wG.errors.push('THROW: ' + e.stack); }
  await wait(300);
  $(wG, '#npName').value = 'Misafir'; $(wG, '#npCreate').click(); await wait(1600);
  ok('8. misafir: açılışta SESSİZCE ev bulutuna bağlandı (pill)', ($(wG, '#statusPill')?.textContent || '').includes('ev bulutu'));
  $(wG, '#input').value = 'merhaba'; $(wG, '#send').click();
  await wait(3500);
  const gmsgs = JSON.parse(wG.localStorage.getItem('evrim:messages') || '[]');
  ok('8. misafir: sıfır giriş + sıfır dokunuşla cevap aldı', gmsgs.some((m) => m.role === 'assistant' && String(m.content).includes('Ev bulutundan merhaba')));
  ok('8. misafir: kart/popup gerekmedi', !$$(wG, '#msgs .card').length);
  ok('8. beyin sahibin cihazında çalıştı', hostCalls >= 1);
  ok('8. misafir pill: ev bulutu', ($(wG, '#statusPill')?.textContent || '').includes('ev bulutu'));
  ok('8. hatalar yok', wH.errors.length === 0 && wG.errors.length === 0);
  wH.close?.(); wG.close?.();
}


/* ================= 9) CİHAZ İÇİ KÜÇÜK BEYİN (WASM): kur → yönlendirmesiz cevap ================= */
{
  const w = makeWin({ fetch: async () => ({ ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' }) });
  w.__EVWASM = { pipeline: async (task, model, opts) => {
    opts?.progress_callback?.({ status: 'progress', progress: 60 });
    return async (prompt, o) => {
      o?.streamer?.callback_function?.('Küçük beyinden cevap: merhaba!');
      o?.streamer?.end?.();
      return [{ generated_text: 'Küçük beyinden cevap: merhaba!' }];
    };
  } };
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Wasm'; $(w, '#npCreate').click(); await wait(200);
  $(w, '#input').value = 'kuantum nedir'; $(w, '#send').click();
  await wait(3500);
  ok('9. kart: wasm birincil düğme var', !!$(w, '#msgs .cwasm'));
  const wb = $(w, '#msgs .cwasm');
  if (wb) wb.click();
  await wait(2500);
  const m9 = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('9. kur → otomatik cevap (siteye gitmeden)', m9.some((m) => m.role === 'assistant' && String(m.content).includes('Küçük beyinden cevap')));
  ok('9. pill: küçük beyin cihazda', ($(w, '#statusPill')?.textContent || '').includes('küçük beyin'));
  // 2. mesaj: kart yok, doğrudan cihaz beyni
  $(w, '#input').value = 'tekrar merhaba'; $(w, '#send').click();
  await wait(2000);
  const m9b = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('9. sonrası: doğrudan cihaz beyni (kart yok)', !$$(w, '#msgs .card').length && m9b.filter((m) => m.role === 'assistant').length >= 2);
  ok('9. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 10) REFLEKS: beyinsiz cihazda bile ANINDA cevap ================= */
{
  const w = makeWin({ fetch: async () => ({ ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' }) });
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Refleks'; $(w, '#npCreate').click(); await wait(200);
  const t0 = Date.now();
  $(w, '#input').value = 'Merhaba'; $(w, '#send').click();
  await wait(1200);
  const ms = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  const bot = ms.find((m) => m.role === 'assistant');
  ok('10. "Merhaba" → anında cevap (<1.5 sn, beyinsiz)', !!bot && Date.now() - t0 < 2000 && /merhaba|selam|hey/i.test(bot.content));
  ok('10. kart/popup YOK', !$$(w, '#msgs .card').length);
  $(w, '#input').value = '2+2'; $(w, '#send').click();
  await wait(1200);
  const ms2 = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('10. matematik anında: 2+2=4', ms2.some((m) => m.role === 'assistant' && String(m.content).includes('4')));
  $(w, '#input').value = 'saat kaç'; $(w, '#send').click();
  await wait(1200);
  const ms3 = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('10. saat/tarih anında', ms3.some((m) => m.role === 'assistant' && String(m.content).includes('🕒')));
  $(w, '#input').value = 'kuantum dolanıklık nedir'; $(w, '#send').click();
  await wait(3000);
  ok('10. bilgi sorusu → refleks değil, beyin zinciri (kart)', !!$(w, '#msgs .cconn') || !!$(w, '#msgs .cwasm'));
  ok('10. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 11) EV ANAHTARI: yeni kullanıcı, sıfır kurulum, anında GERÇEK cevap ================= */
{
  let groqCalls = 0;
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; groqCalls++;
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [{ id: 'llama-3.1-8b-instant' }] }) };
      return fakeRes(body, null, 'Kuantum dolanıklık: iki parçacığın ortak kaderi paylaşmasıdır.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_evtest123';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'YeniKullanıcı'; $(w, '#npCreate').click(); await wait(250);
  ok('11. pill: ev anahtarı hazır', ($(w, '#statusPill')?.textContent || '').includes('ev anahtarı'));
  $(w, '#input').value = 'kuantum dolanıklık nedir'; $(w, '#send').click();
  await wait(2500);
  const ms = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('11. yeni kullanıcı: sıfır kurulumla anında gerçek cevap', ms.some((m) => m.role === 'assistant' && String(m.content).includes('Kuantum dolanıklık')));
  ok('11. kart/popup/indirme YOK', !$$(w, '#msgs .card').length && groqCalls >= 1);
  ok('11. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 13) KOTA: 429 -> model rotasyonu ile cevap ================= */
{
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (body?.model === 'openai/gpt-oss-120b') return { ok: false, status: 429, headers: { get: () => 'application/json' }, json: async () => ({ error: { message: 'rate limit exceeded' } }), text: async () => '{}' };
      return fakeRes(body, null, 'Yedek modelden cevap: döngü tamam.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Kota'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'kuantum nedir'; $(w, '#send').click();
  await wait(3000);
  const ms = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('13. 429 -> sıradaki Groq modeliyle cevap', ms.some((m) => m.role === 'assistant' && String(m.content).includes('Yedek modelden cevap')));
  ok('13. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 14) TÜM modeller 429 -> zincir + kart (OpenRouter efsanesi YOK) ================= */
{
  const w = makeWin({ fetch: async (url) => {
    if (String(url).includes('groq.com')) return { ok: false, status: 429, headers: { get: () => 'application/json' }, json: async () => ({ error: { message: 'rate limit exceeded' } }), text: async () => '{}' };
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Tuku'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'kuantum nedir'; $(w, '#send').click();
  await wait(4000);
  const all = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]').map((m) => m.content).join(' ');
  ok('14. kota tükenince seçim kartı (çıkmaz yok)', !!$(w, '#msgs .cwasm') && !!$(w, '#msgs .cconn'));
  ok('14. yanlış metin yok (OpenRouter geçmez)', !all.includes('OpenRouter'));
  ok('14. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 15) GÖRSEL: girişsiz üretim, puter'a YÖNLENDİRME YOK ================= */
{
  let puterSignInCalls = 0; let round = 0; const calls = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('pollinations.ai')) {
      calls.push('img');
      const blob = new w.Blob([new Uint8Array(2048).fill(7)], { type: 'image/jpeg' });
      return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, blob: async () => blob };
    }
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push('groq');
      round++;
      return round === 1
        ? fakeRes(body, { name: 'gorsel_uret', args: { istem: 'Beyoğlu Nakliyat logosu' } })
        : fakeRes(body, null, 'Logon hazır: ![görsel](evrimimg:GTEST)');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  w.puter = { auth: { isSignedIn: () => false, signIn: async () => { puterSignInCalls++; throw new Error('popup'); } },
    ai: { chat: async () => { throw new Error('x'); }, models: async () => [], txt2img: async () => { throw new Error('sign-in'); } } };
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Logo'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'Beyoğlu Nakliyat logo yap'; $(w, '#send').click();
  await wait(3500);
  const media = JSON.parse(w.localStorage.getItem('evrim:media') || '{}');
  ok('15. görsel girişsiz üretildi (media deposu dolu)', Object.keys(media).length === 1 && String(Object.values(media)[0]).startsWith('data:'));
  ok('15. putera yönlendirme YOK (signIn 0)', puterSignInCalls === 0);
  ok('15. pollinations çağrıldı', calls.includes('img'));
  ok('15. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 16) COMPACTION: uzun konuşma özetlenir, bağlam kaybolmaz ================= */
{
  let sysSeen = '';
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (body?.response_format) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ozet: 'ESKI ÖZET: logo, plan ve şehir listesi konuşuldu.' } ) } }] }), text: async () => '{}' };
      if (body?.messages?.[0]?.role === 'system') sysSeen = body.messages[0].content;
      return fakeRes(body, null, 'Özet bağlamıyla cevap: kaldığımız yerden.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  const seed = [];
  for (let i = 0; i < 30; i++) seed.push({ id: 's' + i, conversationId: 'c1', role: i % 2 ? 'assistant' : 'user', content: 'eski mesaj ' + i + ' '.repeat(40), createdAt: new Date().toISOString() });
  w.localStorage.setItem('evrim:profiles', JSON.stringify([{ id: 'pr1', name: 'T', createdAt: new Date().toISOString() }]));
  w.localStorage.setItem('evrim:activeProfile', 'pr1');
  w.localStorage.setItem('evrim:conversations', JSON.stringify([{ id: 'c1', title: 'uzun', profileId: 'pr1', createdAt: new Date().toISOString() }]));
  w.localStorage.setItem('evrim:messages', JSON.stringify(seed));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(500);
  $(w, '#input').value = 'kaldığımız yerden devam edelim mi'; $(w, '#send').click();
  await wait(3000);
  const conv = JSON.parse(w.localStorage.getItem('evrim:conversations') || '[]').find((c) => c.id === 'c1');
  ok('16. konuşma özeti çıkarıldı ve saklandı', !!conv?.summary && conv.summary.includes('ESKI ÖZET'));
  ok('16. özet sistem promptuna enjekte edildi', sysSeen.includes('ÖNCEKİ KONUŞMA ÖZETİ'));
  ok('16. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 17) ÖZ-DENETİM: yetersiz cevap otomatik düzeltilir ================= */
{
  let round = 0; let streamCalls = 0;
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++; if (body?.stream) streamCalls++;
      return round === 1 ? fakeRes(body, null, 'Evet.') : fakeRes(body, null, 'Detaylı cevap: kuantum dolanıklık iki parçacığın ortak durum paylaşmasıdır; ölçüm biriyle yapıldığında diğeri anında etkilenir. Örnekler: foton çiftleri, süperiletken kübitler.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Denetim'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'kuantum dolanıklık nedir'; $(w, '#send').click();
  await wait(3500);
  const ms = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  const bot = ms.filter((m) => m.role === 'assistant').pop();
  ok('17. kısa cevap reddedildi, düzeltilmiş hali kaydedildi', String(bot?.content || '').includes('Detaylı cevap'));
  ok('17. öz-denetim bir kez yeniden denedi', streamCalls === 2);
  ok('17. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 18) KOD ÇALIŞTIR: sandbox çıktı doğrular ================= */
{
  let round = 0; const calls = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      return round === 1 ? fakeRes(body, { name: 'kod_calistir', args: { kod: 'console.log(6*7)' } }) : fakeRes(body, null, 'Hesap doğrulandı: 42.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Kod'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = '6 kere 7 kaçtır, kodla doğrula'; $(w, '#send').click();
  await wait(3000);
  const toolMsg = calls.filter((c) => c?.stream)[1]?.messages?.find((m) => m.role === 'tool');
  ok('18. kod sandbox çıktısı 42', !!toolMsg && toolMsg.content.includes('42'));
  ok('18. araç çipi: Kod çalıştırdı', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('Kod çalıştırdı')));
  ok('18. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 19) WEB ARAMA zinciri + Groq şema geçerliliği ================= */
{
  let round = 0; const calls = [];
  const DDG_MD = 'Title: arama\n\nMarkdown Content:\n[Naakka Nakliyat İletişim](https://duckduckgo.com/l/?uddg=aHR0cHM6Ly9uYWtrYS5jb20=&rut=abc)\nResmi site snippet.\n[İKİNCİ sonuç](https://example.org/iki)\n';
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('r.jina.ai') && u.includes('duckduckgo')) return { ok: true, status: 200, headers: { get: () => 'text/plain' }, text: async () => DDG_MD, json: async () => ({}) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      return round === 1 ? fakeRes(body, { name: 'web_ara', args: { sorgu: 'Beyoğlu nakliyat telefon' } }) : fakeRes(body, null, 'Kaynak: https://nakka.com — telefon 0212…');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Ara'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'Beyoğlu nakliyat telefonunu bul'; $(w, '#send').click();
  await wait(3000);
  const tools = calls.find((c) => c?.tools)?.tools || [];
  const kc = tools.find((t) => t.function.name === 'kod_calistir');
  ok('19. Groq şeması geçerli: properties nesne, required dizi (kod_calistir)', !!kc && !!kc.function.parameters.properties.kod && Array.isArray(kc.function.parameters.required) && !kc.function.parameters.properties.required);
  ok('19. web_ara araç listesinde', tools.some((t) => t.function.name === 'web_ara'));
  const toolMsg = calls.filter((c) => c?.stream)[1]?.messages?.find((m) => m.role === 'tool');
  const tr = toolMsg ? JSON.parse(toolMsg.content) : null;
  ok('19. arama sonucu: uddg çözüldü + başlık', tr?.sonuc?.[0]?.url === 'https://nakka.com/' || tr?.sonuc?.[0]?.url === 'https://nakka.com', );
  ok('19. ikinci sonuç da listede', (tr?.sonuc || []).some((x) => x.url === 'https://example.org/iki'));
  ok('19. çip: Web araması', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('Web')));
  ok('19. hata yok', w.errors.length === 0);
  w.close?.();
}

console.log(`\nSONUÇ: ${pass} ✅ / ${fail} ❌`);
process.exit(fail ? 1 : 0);
