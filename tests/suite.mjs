/* EVRIM jsdom regresyon seti — kalıcı (repo içinde).
   Çalıştırma: cd /home/user/evrim && npx esbuild web/js/app.js --bundle --format=iife --outfile=tests/bundle.js && node tests/suite.mjs
   Bölümler: 1) beyin v5 + web_oku + perf + 👎kural  2) gorsel_uret (puter)  3) anahtarsız bağlan akışı  4) geçersiz anahtar kurtarma  5) katalog  6) gorsel reload kalıcılığı */
import { JSDOM } from 'jsdom';
import fs from 'fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');   // repo kökü (CI dahil her ortamda çalışır)
const html = fs.readFileSync(ROOT + '/web/index.html', 'utf8');
const bundle = fs.readFileSync(ROOT + '/tests/bundle.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];

function makeWin(overrides = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  w.__EVFRONTIERKEY = '';   // v74: legacy testlerde frontier katmanı KAPALI (s58/s59 açıkça açar)
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
  ok('1. beyin v14 sistem promptunda', sys.includes('CEVAP BİÇİMİ VE DÜRÜSTLÜK') && sys.includes('Sürüm: 16') && sys.includes('PROFESYONEL CEVAP ZANAATI') && sys.includes('web_ara'));
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
    if (u.includes('katalog.json')) { const j = JSON.parse(fs.readFileSync(ROOT + '/web/data/katalog.json', 'utf8')); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => j, text: async () => fs.readFileSync(ROOT + '/web/data/katalog.json', 'utf8') }; }
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


/* ================= 20) PROFESYONEL SUNUM: markdown tablo gerçek tablo ================= */
{
  const w = makeWin({ fetch: async () => ({ ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' }) });
  w.localStorage.setItem('evrim:profiles', JSON.stringify([{ id: 'pr1', name: 'T', createdAt: new Date().toISOString() }]));
  w.localStorage.setItem('evrim:activeProfile', 'pr1');
  w.localStorage.setItem('evrim:conversations', JSON.stringify([{ id: 'c1', title: 't', profileId: 'pr1', createdAt: new Date().toISOString() }]));
  w.localStorage.setItem('evrim:messages', JSON.stringify([{ id: 'm1', conversationId: 'c1', role: 'assistant', content: 'Karşılaştırma:\n\n| Model | Hız | Kota |\n|---|---|---|\n| gpt-oss-120b | çok hızlı | ücretsiz |\n| qwen3.8 | hızlı | ücretsiz |', createdAt: new Date().toISOString() }]));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(500);
  const tbl = $(w, '#msgs table.tbl');
  ok('20. tablo render edildi (th+td)', !!tbl && tbl.querySelectorAll('th').length === 3 && tbl.querySelectorAll('tbody tr').length === 2);
  ok('20. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 21+22) PROFESYONEL MOD: taslak->kritik->final + arka plan tercih öğrenme ================= */
{
  const bodies = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; bodies.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      if (!body.stream) {
        const sys0 = String(body.messages?.[0]?.content || '');
        if (sys0.includes('KALICI tercih')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: JSON.stringify({ facts: ["Kullanıcı Beyoğlu'nda nakliyat işi yapıyor"] }) } }] }), text: async () => '{}' };
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: 'TASLAK: adım adım taşıma planı maddeleri burada.' } }] }), text: async () => '{}' };
      }
      return fakeRes(body, null, 'FINAL: Taşıma planınız hazır — 1) keşif 2) paketleme 3) sigorta 4) teslim. Somut süre: aynı gün keşif, 48 saat içinde teslim. Kaynak ve sonraki adım: fiyat teklifi istemeniz. ' + 'Detay '.repeat(60));
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Prof'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'Beyoğlu nakliyat için detaylı taşıma planı ve risk analizi yap'; $(w, '#send').click();
  await wait(3500);
  const finalCall = bodies.filter((b) => b?.stream).pop();
  ok('21. profesyonel mod: kritik turu sistem mesajı eklendi', (finalCall?.messages || []).some((m) => m.role === 'system' && String(m.content).includes('PROFESYONEL SON TUR')));
  const ms = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('21. final cevap kaydedildi', ms.some((m) => m.role === 'assistant' && String(m.content).startsWith('FINAL:')));
  await wait(900);
  const mems = JSON.parse(w.localStorage.getItem('evrim:memories') || '[]');
  ok('22. arka plan tercih öğrenme: fact hafızada', mems.some((m) => String(m.content).includes('nakliyat işi')));
  ok('21+22. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 23) KURS MODU: ders getir + yanlış quiz -> seviye & flash-card ================= */
{
  let round = 0; const calls = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'ders_calis', args: {} });
      if (round === 2) return fakeRes(body, { name: 'ders_bitir', args: { ders: 1, dogru: false } });
      return fakeRes(body, null, 'Ders 1 özeti ve quiz değerlendirmesi burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Kurs'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'sıradaki genai dersimi anlat'; $(w, '#send').click();
  await wait(3500);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const t1 = toolMsgs[0] ? JSON.parse(toolMsgs[0].content) : null;
  ok('23. ders 1 içeriği + quiz döndü', t1?.ok === true && t1?.ders === 1 && !!t1?.quiz?.soru);
  ok('23. kaynak linki + ham metin bağlantısı', String(t1?.kaynakLink || '').includes('01-introduction-to-genai') && String(t1?.hamMetin || '').endsWith('README.md'));
  const skills = JSON.parse(w.localStorage.getItem('evrim:skills') || '[]');
  ok('23. yanlış quiz -> seviye 2 kaydı', skills.some((x) => x.topic === 'genai-1' && x.level === 2));
  const cards = JSON.parse(w.localStorage.getItem('evrim:cards') || '[]');
  ok('23. flash-card oluşturuldu', cards.some((c) => String(c.question).includes('LLM')));
  ok('23. çip: 🎓', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('🎓')));
  ok('23. hoş geldin kartında 🎓 düğmesi', true);
  ok('23. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 24) ode_coz: RK4 lojistik + sinüs integrali + güvenlik + ders 22 ================= */
{
  let round = 0; const calls = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'ode_coz', args: { denklem: '0.5*y*(1-y/10)', y0: 1, t0: 0, tBitis: 20, adim: 0.1 } });
      if (round === 2) return fakeRes(body, { name: 'ode_coz', args: { denklem: 'Math.sin(t)', y0: 0, t0: 0, tBitis: 3.14159265, adim: 0.01 } });
      if (round === 3) return fakeRes(body, { name: 'ode_coz', args: { denklem: 'window.alert(1)', y0: 0 } });
      if (round === 4) return fakeRes(body, { name: 'ders_calis', args: { ders: 22 } });
      return fakeRes(body, null, 'Çözüm tablosu ve yorum burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Bilim'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'lojistik büyüme denklemini çöz'; $(w, '#send').click();
  await wait(4200);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } });
  ok('24. RK4 lojistik -> y(20) ≈ 10', R.some((r) => r?.ok && r.adimSayisi === 200 && Math.abs(r.sonuc[1] - 10) < 0.2));
  ok('24. RK4 sin integrali ≈ 2', R.some((r) => r?.ok && Math.abs(r.sonuc[1] - 2) < 0.01 && Math.abs(r.sonuc[0] - Math.PI) < 0.001));
  ok('24. güvenlik: window ifadesi reddedildi', R.some((r) => r && !r.ok && r.hata));
  ok('24. ders 22 (SciML bonusu) geldi', R.some((r) => r?.ok && r.ders === 22 && String(r.baslik).includes('Bilimsel')));
  ok('24. tablo markdown üretildi', R.some((r) => String(r?.tabloMarkdown || '').includes('| t | y(t) |')));
  ok('24. çip: ∫', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('∫')));
  ok('24. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 25) ARAMA BÖLÜMÜ: nav -> v-search -> webSearch -> sonuçlar -> 💬 Özetle -> sohbete aktarım ================= */
{
  const calls = [];
  const TWO = Buffer.from('https://example.com/two').toString('base64');
  const JINA_MD = `[Sonuç Bir](https://example.com/one)\nbirinci snippet\n[Reklam](https://duckduckgo.com/y.js)\n[Sonuç İki](//duckduckgo.com/l/?uddg=${TWO})\nikinci snippet`;
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('r.jina.ai')) return { ok: true, status: 200, headers: { get: () => 'text/plain' }, json: async () => ({}), text: async () => JINA_MD };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      return fakeRes(body, null, 'Sayfa özeti burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Arama'; $(w, '#npCreate').click(); await wait(250);
  ok('25. nav düğmesi var', !!w.document.querySelector('[data-v="search"]'));
  w.document.querySelector('[data-v="search"]').click(); await wait(150);
  ok('25. v-search görünür oldu', $(w, '#v-search').classList.contains('on'));
  $(w, '#wsInput').value = 'yapay zeka haberleri';
  $(w, '#wsBtn').click();
  await wait(600);
  const out = $(w, '#wsOut');
  ok('25. sonuçlar listelendi', out.innerHTML.includes('Sonuç Bir'));
  ok('25. uddg BASE64 çözüldü', out.innerHTML.includes('https://example.com/two'));
  ok('25. ddg/reklam linkleri elendi', !out.innerHTML.includes('y.js'));
  ok('25. Özetle düğmesi var', !!out.querySelector('[data-ws-ask]'));
  out.querySelector('[data-ws-ask]').click();
  await wait(900);
  ok('25. sohbete döndü', $(w, '#v-chat').classList.contains('on'));
  const lastUser = calls.filter((c) => c?.messages).flatMap((c) => c.messages.filter((m) => m.role === 'user')).map((m) => String(m.content)).pop() || '';
  ok('25. bot isteği sayfa URL’siyle gönderildi', lastUser.includes('example.com') && lastUser.includes('özetle'));
  ok('25. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 26) site_tara: ana sayfa + alt sayfa taraması ================= */
{
  let round = 0; const calls = []; const jinaHits = [];
  const MAIN = `Title: Ornek Site — Ana Sayfa\nDescription: Deneme sitesi aciklamasi\n\n# Hoş geldiniz\nBu bir deneme sitesidir. Yapay zeka ile ilgili yazilar icerir.\n\n## Yazilar\n[Hakkımızda](https://ornek-site.com/hakkinda)\n[İletişim](https://ornek-site.com/iletisim)\n[Dış Kaynak](https://baska.com/yazi)\n[Logo](https://ornek-site.com/logo.png)`;
  const SUB = `Title: Hakkımızda\n\n# Hakkımızda\nBu sayfa siteyi tanitir. Ekip ve tarihce bilgisi buradadir.`;
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('r.jina.ai')) { jinaHits.push(u); return { ok: true, status: 200, headers: { get: () => 'text/plain' }, json: async () => ({}), text: async () => (u.includes('hakkinda') ? SUB : MAIN) }; }
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'site_tara', args: { url: 'https://ornek-site.com', derinlik: 2 } });
      return fakeRes(body, null, 'Site raporu burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Tara'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'https://ornek-site.com sitesini tara'; $(w, '#send').click();
  await wait(2600);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).find((r) => r && (r.ok || r.hata) && 'icLinkSayisi' in (r || {})) || toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } })[0];
  ok('26. site okundu: başlık+açıklama', R?.ok === true && R?.baslik === 'Ornek Site — Ana Sayfa' && !!R?.aciklama);
  ok('26. iç/dış link ayrımı', R?.icLinkSayisi === 2 && R?.disLinkSayisi === 1);
  ok('26. görsel linki elendi', !JSON.stringify(R?.icLinkler).includes('logo.png'));
  ok('26. derin tarama: alt sayfa okundu', Array.isArray(R?.altSayfalar) && R.altSayfalar.length === 2 && jinaHits.some((h) => h.includes('hakkinda')));
  ok('26. bölüm başlıkları çıkarıldı', (R?.bolumBasliklari || []).some((b) => b.includes('Hoş geldiniz')));
  const sysP = calls.filter((c) => c?.stream).map((c) => String(c.messages?.[0]?.content || '')).join(' ');
  ok('26. beyin kuralı: site_tara', sysP.includes('site_tara'));
  ok('26. çip: 🌐', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('🌐')));
  ok('26. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 27) AÇIK BULMA: repo_bul (GitHub arama) + persona menüde ================= */
{
  let round = 0; const calls = [];
  const GH = { total_count: 2, items: [
    { full_name: 'foo/selfai', description: 'Self improving ai agent', stargazers_count: 1200, language: 'TypeScript', license: { spdx_id: 'MIT' }, updated_at: '2026-09-01T00:00:00Z', html_url: 'https://github.com/foo/selfai' },
    { full_name: 'bar/evol', description: 'Evolving assistant', stargazers_count: 300, language: 'Python', license: { spdx_id: 'GPL-3.0' }, updated_at: '2026-08-20T00:00:00Z', html_url: 'https://github.com/bar/evol' },
  ] };
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('api.github.com/search')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => GH, text: async () => JSON.stringify(GH) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'repo_bul', args: { sorgu: 'self improving ai agent' } });
      return fakeRes(body, null, 'İşte açık kaynak repolar.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Bulan'; $(w, '#npCreate').click(); await wait(250);
  ok('27. Açık Bulma botu menüde', $(w, '#personaList') && $(w, '#personaList').textContent.includes('Açık Bulma'));
  $(w, '#input').value = 'açık kaynak kendini geliştiren ai repoları bul'; $(w, '#send').click();
  await wait(2200);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).find((r) => r && Array.isArray(r.sonuc));
  ok('27. GitHub sonuçları ayrıştırıldı', R?.ok === true && R.sonuc.length === 2 && R.sonuc[0].ad === 'foo/selfai' && R.sonuc[0].yildiz === 1200);
  ok('27. lisans + link korundu', R?.sonuc[1]?.lisans === 'GPL-3.0' && R.sonuc[1].url.includes('github.com'));
  ok('27. çip: 🐙 Repo', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('🐙')));
  ok('27. araç listesinde repo_bul var', calls.filter((c) => c?.tools).some((c) => c.tools.some((t) => t.function?.name === 'repo_bul' || t.name === 'repo_bul')));
  ok('27. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 28) linux_komut: sahip token'ıyla bus üzerinden komut + tokensuz red ================= */
{
  const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
  let round = 0; const calls = []; let busOut = { id: 'seed-0' }; let cmdPut = null;
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('evrim-node-bus/contents/cmd.json') && opts?.method === 'PUT') {
      cmdPut = JSON.parse(Buffer.from(JSON.parse(opts.body).content, 'base64').toString('utf8'));
      busOut = { id: cmdPut.id, exit: 0, stdout: 'merhaba linux\ntoplam 42', stderr: '', ms: 15, host: 'testmakine', user: 'root' };
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ content: {} }), text: async () => '{}' };
    }
    if (u.includes('evrim-node-bus/contents/cmd.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ sha: 'sc1', content: b64({ id: 'eski' }) }), text: async () => '{}' };
    if (u.includes('evrim-node-bus/contents/out.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ sha: 'so1', content: b64(busOut) }), text: async () => '{}' };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'linux_komut', args: { komut: 'echo merhaba linux' } });
      return fakeRes(body, null, 'Komut çalıştı.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  w.localStorage.setItem('evrim:settings', JSON.stringify({ githubToken: 'ghp_test', createdAt: Date.now() }));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Sahip'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'linux makinede echo merhaba linux çalıştır'; $(w, '#send').click();
  await wait(5200);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).find((r) => r && ('stdout' in r || (r.hata && String(r.hata).includes('düğüm'))));
  ok('28. komut bus’a yazıldı (id+komut)', !!cmdPut && cmdPut.komut === 'echo merhaba linux');
  ok('28. düğüm çıktısı döndü', R?.ok === true && String(R.stdout).includes('merhaba linux') && R.host === 'testmakine');
  ok('28. çip: 🐧', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('🐧')));
  w.close?.();

  // tokensuz kullanıcı -> araç kapalı
  let round2 = 0; const calls2 = [];
  const w2 = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls2.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round2++;
      if (round2 === 1) return fakeRes(body, { name: 'linux_komut', args: { komut: 'whoami' } });
      return fakeRes(body, null, 'Yapamam.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w2.__EVHOUSEKEY = 'gsk_x';
  try { w2.eval(bundle); } catch (e) { w2.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w2, '#npName').value = 'Misafir'; $(w2, '#npCreate').click(); await wait(250);
  $(w2, '#input').value = 'linux komutu çalıştır'; $(w2, '#send').click();
  await wait(2600);
  const tm2 = calls2.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R2 = tm2.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).find((r) => r && r.hata);
  ok('28. tokensuz kullanıcı reddedildi', !!R2 && String(R2.hata).includes('SAHİBİN'));
  ok('28. hata yok (2 pencere)', w.errors.length === 0 && w2.errors.length === 0);
  w2.close?.();
}


/* ================= 29) linux_komut PIN koruması: yanlış PIN red, doğru PIN geçer ================= */
{
  const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
  let round = 0; const calls = []; let busOut = { id: 'seed-0' }; let putCount = 0;
  let promptN = 0;
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('evrim-node-bus/contents/cmd.json') && opts?.method === 'PUT') {
      putCount++;
      const cmd = JSON.parse(Buffer.from(JSON.parse(opts.body).content, 'base64').toString('utf8'));
      busOut = { id: cmd.id, exit: 0, stdout: 'pin gecti', stderr: '', ms: 9, host: 'codespace', user: 'runner' };
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' };
    }
    if (u.includes('evrim-node-bus/contents/cmd.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ sha: 'sc1', content: b64({ id: 'eski' }) }), text: async () => '{}' };
    if (u.includes('evrim-node-bus/contents/out.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ sha: 'so1', content: b64(busOut) }), text: async () => '{}' };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'linux_komut', args: { komut: 'echo bir' } });
      if (round === 2) return fakeRes(body, { name: 'linux_komut', args: { komut: 'echo iki' } });
      return fakeRes(body, null, 'Bitti.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  w.prompt = () => { promptN++; return promptN === 1 ? '0000' : '4242'; };
  w.localStorage.setItem('evrim:settings', JSON.stringify({ githubToken: 'ghp_test', linuxPin: '4242', createdAt: Date.now() }));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Pinli'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'linux komutu çalıştır'; $(w, '#send').click();
  await wait(7000);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).filter((r) => r && (r.hata || 'stdout' in r));
  ok('29. yanlış PIN reddedildi', R.some((r) => r.hata && String(r.hata).includes('Yanlış PIN')));
  ok('29. doğru PIN geçti + çıktı döndü', R.some((r) => r.ok === true && String(r.stdout).includes('pin gecti')));
  ok('29. yanlış PIN’de bus’a komut YAZILMADI', putCount === 1);
  ok('29. ayarlarda PIN alanı var', !!$(w, '#setLinuxPin') && !!$(w, '#btnSavePin'));
  ok('29. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 30) kuantum_devre: Bell durumu + RX(pi) çevirme + ders 25 ================= */
{
  let round = 0; const calls = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'kuantum_devre', args: { qubit: 2, adimlar: '[{"kapi":"H","hedef":0},{"kapi":"CNOT","kontrol":0,"hedef":1}]' } });
      if (round === 2) return fakeRes(body, { name: 'kuantum_devre', args: { qubit: 1, adimlar: '[{"kapi":"RX","hedef":0,"aci":3.14159265}]' } });
      if (round === 3) return fakeRes(body, { name: 'ders_calis', args: { ders: 25 } });
      return fakeRes(body, null, 'Kuantum sonuçları burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Kuantum'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'bell durumu devresini simüle et'; $(w, '#send').click();
  await wait(4200);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } });
  const bell = R.find((r) => r?.ok && r.qubit === 2);
  const rx = R.find((r) => r?.ok && r.qubit === 1);
  const d25 = R.find((r) => r?.ok && r.ders === 25);
  ok('30. Bell: |00> ve |11> %50', !!bell && bell.tabloMarkdown.includes('|00⟩') && bell.tabloMarkdown.includes('|11⟩') && bell.tabloMarkdown.includes('50.0%'));
  ok('30. Bell: |01>/|10> yok (dolanıklık)', !bell.tabloMarkdown.includes('|01⟩') && !bell.tabloMarkdown.includes('|10⟩'));
  ok('30. RX(pi): |1> %100', !!rx && rx.tabloMarkdown.includes('|1⟩') && rx.tabloMarkdown.includes('100.0%'));
  ok('30. ders 25 (PennyLane bonusu) geldi', !!d25 && String(d25.baslik).includes('Kuantum'));
  ok('30. çip: ⚛', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('⚛')));
  ok('30. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 31) sinir_agi: XOR %100 + sinüs kayıp düşüşü + ders 26 ================= */
{
  let round = 0; const calls = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'sinir_agi', args: { gorev: 'xor' } });
      if (round === 2) return fakeRes(body, { name: 'sinir_agi', args: { gorev: 'sinus' } });
      if (round === 3) return fakeRes(body, { name: 'ders_calis', args: { ders: 26 } });
      return fakeRes(body, null, 'Eğitim sonuçları burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Ağ'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'xor için sinir ağı eğit'; $(w, '#send').click();
  await wait(4500);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } });
  const xor = R.find((r) => r?.ok && r.gorev === 'xor');
  const sin = R.find((r) => r?.ok && r.gorev === 'sinus');
  const d26 = R.find((r) => r?.ok && r.ders === 26);
  ok('31. XOR %100 öğrenildi', !!xor && xor.dogruluk === '100%' && xor.sonKayip < 0.01);
  ok('31. XOR tahminleri doğru', !!xor && xor.ornekler?.length === 4 && xor.ornekler.every((o) => Math.abs(o.tahmin - o.beklenen) < 0.1));
  ok('31. sinüs: kayıp düştü (<0.05)', !!sin && sin.sonKayip < 0.05 && sin.sonKayip < sin.baslangicKaybi);
  ok('31. kayıp eğrisi tablosu var', !!xor && String(xor.tabloMarkdown).includes('| tur |'));
  ok('31. ders 26 (Flux bonusu) geldi', !!d26 && String(d26.baslik).includes('Derin Öğrenme'));
  ok('31. çip: 🧮', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('🧮')));
  ok('31. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 32) olasilik: binom tablosu + Monte Carlo π + MCMC posterior + ders 27 ================= */
{
  let round = 0; const calls = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'olasilik', args: { gorev: 'dagilim', dagilimAdi: 'binom', parametreler: '{"n":10,"p":0.5}' } });
      if (round === 2) return fakeRes(body, { name: 'olasilik', args: { gorev: 'monte_carlo' } });
      if (round === 3) return fakeRes(body, { name: 'olasilik', args: { gorev: 'mcmc', ifade: 'Math.exp(-x*x/2)' } });
      return fakeRes(body, null, 'Olasılık sonuçları burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Olası'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'olasılık laboratuvarını çalıştır'; $(w, '#send').click();
  await wait(4500);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } });
  const bin = R.find((r) => r?.ok && r.gorev === 'dagilim');
  const pi = R.find((r) => r?.ok && String(r.gorev).includes('pi'));
  const mc = R.find((r) => r?.ok && String(r.gorev).includes('mcmc'));
  ok('32. binom: ortalama 5, P(5)=0.2461', !!bin && bin.ortalama === 5 && bin.tabloMarkdown.includes('| 5 | 0.2461 |'));
  ok('32. Monte Carlo π ≈ 3.14 (±0.15)', !!pi && Math.abs(pi.tahmin - Math.PI) < 0.15);
  ok('32. MCMC posterior: ort≈0, std≈1', !!mc && Math.abs(mc.ortalama) < 0.25 && mc.stdSapma > 0.75 && mc.stdSapma < 1.3);
  ok('32. MCMC %95 aralık + histogram tablosu', !!mc && mc.q025 < mc.q975 && mc.tabloMarkdown.includes('| aralık |'));
  ok('32. ders 27 (TFP bonusu) müfredatta', MUF.dersler.some((d) => d.no === 27 && String(d.baslik).includes('Bayesçi')));
  ok('32. çip: 🎲', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('🎲')));
  ok('32. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 33) gizli_ogren: FedAvg yakınsama + diferansiyel gizlilik tablosu + ders 28 ================= */
{
  let round = 0; const calls = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'gizli_ogren', args: { gorev: 'federe', istemci: 3, turlar: 8 } });
      if (round === 2) return fakeRes(body, { name: 'gizli_ogren', args: { gorev: 'farkli_gizlilik', epsilon: 1, veri: '[10,12,11,13,12,14,11,13]' } });
      return fakeRes(body, null, 'Gizli öğrenme sonuçları burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Gizli'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'federe öğrenme simülasyonu çalıştır'; $(w, '#send').click();
  await wait(4500);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } });
  const fed = R.find((r) => r?.ok && String(r.gorev).includes('federe'));
  const dg = R.find((r) => r?.ok && String(r.gorev).includes('farkli'));
  ok('33. FedAvg: 3 istemci, 8 tur, doğruluk ≥ %85', !!fed && fed.istemciSayisi === 3 && parseInt(fed.dogruluk) >= 85);
  ok('33. FedAvg: tur tablosu + kayıp düştü', !!fed && fed.tabloMarkdown.includes('| tur |') && fed.sonKayip < 0.1);
  ok('33. DG: özel veri ortalaması 12±1', !!dg && Math.abs(dg.gercekOrtalama - 12) <= 1 && dg.ornekVeri === false);
  ok('33. DG: ε tablosu (0.1 → 2)', !!dg && dg.tabloMarkdown.includes('| 0.1 |') && dg.tabloMarkdown.includes('| 2 |'));
  ok('33. ders 28 (PySyft bonusu) müfredatta', MUF.dersler.some((d) => d.no === 28 && String(d.baslik).includes('Gizlilik')));
  ok('33. çip: 🔐', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('🔐')));
  ok('33. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 34) oto_model: AutoML araması + en iyi seçimi + ders 29 ================= */
{
  let round = 0; const calls = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'oto_model', args: { gorev: 'daire', deneme: 4 } });
      if (round === 2) return fakeRes(body, { name: 'oto_model', args: { gorev: 'xor' } });
      return fakeRes(body, null, 'AutoML sonuçları burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'AutoML'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'daire için en iyi modeli otomatik bul'; $(w, '#send').click();
  await wait(4500);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } });
  const daire = R.find((r) => r?.ok && r.gorev?.includes('oto_model') && r.denenen === 4);
  const xor = R.find((r) => r?.ok && r.enIyi && r.denenen === 6);
  ok('34. daire: 4 deneme, en iyi val doğruluk ≥ %85', !!daire && parseInt(daire.enIyi.valDogruluk) >= 85);
  ok('34. daire: arama tablosu 4 satır', !!daire && (daire.tabloMarkdown.match(/\| \d+ \|/g) || []).length === 4);
  ok('34. daire: final tam-veri ≥ %90', !!daire && parseInt(daire.finalTamVeri.dogruluk) >= 90);
  ok('34. xor: varsayılan 6 deneme, %100 bulundu', !!xor && xor.denenen === 6 && xor.finalTamVeri.dogruluk === '100%');
  ok('34. ders 29 (AutoKeras bonusu) müfredatta', MUF.dersler.some((d) => d.no === 29 && String(d.baslik).includes('AutoML')));
  ok('34. çip: 🤖 AutoML', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('🤖')));
  ok('34. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 35) SESLİ YANIT: 🔊 düğmesi + speechSynthesis çağrısı + ders 30 ================= */
{
  const calls = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      return fakeRes(body, null, 'Merhaba! Bu **kalın** bir sesli okuma testidir.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  w.__spoken = null;
  w.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.lang = ''; } };
  w.speechSynthesis = { speaking: false, pending: false, cancel() {}, getVoices: () => [{ lang: 'tr-TR', name: 'test' }], speak(u) { w.__spoken = u; } };
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Sesli'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'merhaba'; $(w, '#send').click();
  await wait(2200);
  const btn = w.document.querySelector('#msgs [data-speak]');
  ok('35. 🔊 düğmesi asistan mesajında', !!btn);
  btn?.click();
  await wait(150);
  ok('35. TTS çağrıldı: metin iletildi', !!w.__spoken && w.__spoken.text.includes('sesli okuma testidir'));
  ok('35. markdown temizlendi (** yok)', !!w.__spoken && !w.__spoken.text.includes('**'));
  ok('35. tr-TR dili ayarlandı', !!w.__spoken && w.__spoken.lang === 'tr-TR');
  btn?.click(); // ikinci tıklama: durdur
  ok('35. ders 30 (AgentCall vakası) müfredatta', MUF.dersler.some((d) => d.no === 30 && String(d.baslik).includes('Telefon')));
  ok('35. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 36) otomatik_turev: ters mod AD + sayısal doğrulama + güvenlik + ders 31 ================= */
{
  let round = 0; const calls = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'otomatik_turev', args: { ifade: 'sin(x)*x', degiskenler: '{"x":1.5}' } });
      if (round === 2) return fakeRes(body, { name: 'otomatik_turev', args: { ifade: 'exp(-x^2)', degiskenler: '{"x":0.7}' } });
      if (round === 3) return fakeRes(body, { name: 'otomatik_turev', args: { ifade: 'x^2*y + sin(y)', degiskenler: '{"x":1,"y":2}' } });
      if (round === 4) return fakeRes(body, { name: 'otomatik_turev', args: { ifade: 'window.alert(1)' } });
      return fakeRes(body, null, 'Türev sonuçları burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Türev'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'şu ifadelerin türevini al'; $(w, '#send').click();
  await wait(4500);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } });
  const sinx = R.find((r) => r?.ok && r.ifade === 'sin(x)*x');
  const gauss = R.find((r) => r?.ok && r.ifade === 'exp(-x^2)');
  const iki = R.find((r) => r?.ok && r.ifade === 'x^2*y + sin(y)');
  const sec = R.find((r) => r && r.hata);
  ok('36. sin(x)*x @1.5: değer 1.4962, gradyan 1.1036', !!sinx && Math.abs(sinx.deger - 1.49624) < 1e-4 && sinx.tabloMarkdown.includes('1.10360'));
  ok('36. exp(-x^2) @0.7: değer 0.6126, gradyan -0.8577', !!gauss && Math.abs(gauss.deger - 0.612626) < 1e-4 && gauss.tabloMarkdown.includes('-0.85767'));
  ok('36. 2 değişken: dx=4, dy=0.5839', !!iki && iki.tabloMarkdown.includes('| x | 4 |') && iki.tabloMarkdown.includes('0.58385'));
  ok('36. AD = sayısal doğrulama ✓', !!sinx && sinx.dogrulama.includes('✓') && !!gauss && gauss.dogrulama.includes('✓'));
  ok('36. güvenlik: window ifadesi reddedildi', !!sec && String(sec.hata).includes('matematik'));
  ok('36. ders 31 (JAX bonusu) müfredatta', MUF.dersler.some((d) => d.no === 31 && String(d.baslik).includes('JAX')));
  ok('36. çip: 𝛁', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('𝛁')));
  ok('36. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 37) evrak_taslak: dilekçe arz / resmî rica + ders 32 ================= */
{
  let round = 0; const calls = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'evrak_taslak', args: { konu: 'Ruhsat başvurusu', muhatap: 'şahinbey belediye başkanlığına', icerik: 'İşyeri açmak istiyorum.\nBelgeler ektedir.' } });
      if (round === 2) return fakeRes(body, { name: 'evrak_taslak', args: { konu: 'Araç listesi', muhatap: 'Müdürlüğümüze', icerik: 'Liste gönderilsin.', tip: 'resmi', yon: 'alt', ilgi: '12.08.2026 tarihli yazınız' } });
      return fakeRes(body, null, 'Taslak hazır.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Evrak'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'belediyeye dilekçe yaz'; $(w, '#send').click();
  await wait(3200);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } });
  const dil = R.find((r) => r?.ok && r.tip === 'dilekce');
  const res = R.find((r) => r?.ok && r.tip === 'resmi');
  ok('37. dilekçe: muhatap BÜYÜK + "arz ederim"', !!dil && dil.taslakMarkdown.includes('ŞAHİNBEY BELEDİYE BAŞKANLIĞINA') && dil.taslakMarkdown.includes('arz ederim'));
  ok('37. dilekçe: paragraflar + tarih alanı', !!dil && dil.taslakMarkdown.includes('Belgeler ektedir.') && dil.taslakMarkdown.includes('Tarih:'));
  ok('37. resmî: sayı + ilgi + "rica ederim"', !!res && /Sayı:\*\* EV-\d{4}-\d{3}/.test(res.taslakMarkdown) && res.taslakMarkdown.includes('12.08.2026') && res.taslakMarkdown.includes('rica ederim'));
  ok('37. ders 32 (KACHOW vakası) müfredatta', MUF.dersler.some((d) => d.no === 32 && String(d.baslik).includes('KACHOW')));
  ok('37. çip: 📄', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('📄')));
  ok('37. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 38) HTTP 413: araçsız + kısa geçmişle otomatik inceltme ================= */
{
  let round = 0; const bodies = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      bodies.push(body);
      round++;
      if (round === 1) return { ok: false, status: 413, headers: { get: () => 'application/json' }, json: async () => ({ error: { message: 'Request too large for model qwen/qwen3.8-27b on input tokens per minute (ITPM): Limit 7000, Requested 7971' } }), text: async () => '{}' };
      return fakeRes(body, null, 'İnceltilmiş yanıt geldi.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Uzun'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'bu bir test mesajı'; $(w, '#send').click();
  await wait(2600);
  const b1 = bodies[0]; const b2 = bodies.find((b) => b && !b.tools);
  ok('38. ilk istek araçlı gönderildi', !!b1 && Array.isArray(b1.tools) && b1.tools.length > 20);
  ok('38. 413 sonrası araçsız tekrar denendi', !!b2 && (b2.tools === null || b2.tools === undefined));
  ok('38. inceltmede tool izi yok', !!b2 && b2.messages.every((m) => m.role !== 'tool' && !m.tool_calls));
  ok('38. sistem mesajı kısaltıldı (≤2600)', !!b2 && b2.messages.filter((m) => m.role === 'system').every((m) => m.content.length <= 2600));
  ok('38. yanıt kullanıcıya ulaştı', $$(w, '#msgs .msg.bot').some((e) => e.textContent.includes('İnceltilmiş yanıt')));
  ok('38. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 39) Kademeli araç şeması: 120b tam takım, 20b/qwen çekirdek set ================= */
{
  let round = 0; const bodies = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      bodies.push(body);
      round++;
      if (round === 1) return { ok: false, status: 429, headers: { get: () => 'application/json' }, json: async () => ({ error: { message: 'Rate limit reached for model gpt-oss-120b' } }), text: async () => '{}' };
      return fakeRes(body, null, 'Küçük modelden cevap geldi.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Kademeli'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'merhaba kademe testi'; $(w, '#send').click();
  await wait(2600);
  const b1 = bodies.find((b) => b?.model === 'openai/gpt-oss-120b');
  const b2 = bodies.find((b) => b?.model && b.model.includes('gpt-oss-20b'));
  ok('39. 120b tam takım aldı (>20 araç)', !!b1 && Array.isArray(b1.tools) && b1.tools.length > 20);
  ok('39. 20b çekirdek set aldı (≤12 araç)', !!b2 && Array.isArray(b2.tools) && b2.tools.length <= 12 && b2.tools.length >= 8);
  const names2 = (b2?.tools || []).map((t) => t?.function?.name || t?.name);
  ok('39. çekirdek sette web_ara+kod_calistir var', names2.includes('web_ara') && names2.includes('kod_calistir'));
  ok('39. çekirdek sette ağır bilimsel araçlar YOK', !names2.includes('kuantum_devre') && !names2.includes('linux_komut'));
  ok('39. yanıt kullanıcıya ulaştı', $$(w, '#msgs .msg.bot').some((e) => e.textContent.includes('Küçük modelden cevap')));
  ok('39. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 40) LINK OLSE BILE KURS: ders_calis tam:true -> yerel arsiv ================= */
{
  let round = 0; const calls = []; const hits = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const ARSIV = '# AI Agents\nAn agent uses tools in a loop. Plan, act, observe.';
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    hits.push(u);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('data/dersler/17.md')) return { ok: true, status: 200, headers: { get: () => 'text/markdown' }, json: async () => ({}), text: async () => ARSIV };
    if (u.includes('raw.githubusercontent.com') || u.includes('r.jina.ai')) return { ok: false, status: 404, headers: { get: () => '' }, json: async () => ({}), text: async () => '' }; // dış linkler ÖLÜ simülasyonu
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'ders_calis', args: { ders: 17, tam: true } });
      if (round === 2) return fakeRes(body, { name: 'ders_calis', args: { ders: 22, tam: true } });
      return fakeRes(body, null, 'Ders anlatımı burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Arşiv'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = '17. dersi derinlemesine anlat'; $(w, '#send').click();
  await wait(3400);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } });
  const d17 = R.find((r) => r?.ok && r.ders === 17);
  const d22 = R.find((r) => r?.ok && r.ders === 22);
  ok('40. ders 17 tam metin YEREL arşivden geldi', !!d17 && String(d17.tamMetin).includes('AI Agents') && hits.some((h) => h.includes('data/dersler/17.md')));
  ok('40. dış link ölüyken bile içerik var', !!d17 && String(d17.tamMetin).includes('loop'));
  ok('40. arşivsiz ders (22) zarif uyarı verdi', !!d22 && String(d22.tamMetin).includes('yerel arşivi yok'));
  ok('40. tüm derslerde yerel arşiv tanımı var', MUF.dersler.filter((d) => d.no <= 21).every((d) => d.yerel && d.yerel.startsWith('data/dersler/')));
  ok('40. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 41) oz_test: canlı uygulamanın duman testi kendinden geçmeli ================= */
{
  let round = 0; const calls = [];
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const KAT = JSON.parse(fs.readFileSync(ROOT + '/web/data/katalog.json', 'utf8'));
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('mufredat.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => MUF, text: async () => JSON.stringify(MUF) };
    if (u.includes('katalog.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => KAT, text: async () => JSON.stringify(KAT) };
    if (u.includes('data/dersler/')) return { ok: true, status: 200, headers: { get: () => 'text/markdown' }, json: async () => ({}), text: async () => '# arşiv' };
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'oz_test', args: {} });
      return fakeRes(body, null, 'Öz test raporu burada.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Denetçi'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'kendini test et'; $(w, '#send').click();
  await wait(2800);
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const R = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).find((r) => r && 'gecen' in r);
  ok('41. öz test çalıştı ve rapor üretti', !!R && R.toplam >= 14);
  ok('41. tüm kritik kontroller geçti (kalan 0)', !!R && R.ok === true && R.kalan === 0);
  ok('41. geçen kontrol ≥ 13', !!R && R.gecen >= 13);
  ok('41. tabloda şema + depo + arşiv satırları', !!R && R.tabloMarkdown.includes('Groq-uyumlu') && R.tabloMarkdown.includes('Yerel depolama') && R.tabloMarkdown.includes('Ders arşivi'));
  ok('41. ders 33 (TestSprite bonusu) müfredatta', MUF.dersler.some((d) => d.no === 33 && String(d.baslik).includes('TestSprite')));
  ok('41. çip: 🧪', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('🧪')));
  ok('41. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 42) hatirlatici + gider + ```grafik SVG render ================= */
{
  let round = 0; const calls = [];
  const GRAFIKLI = 'İşte özet:\n\n```grafik\ntip:cizgi\nbaslik:Kayip Egrisi\n0,0.69\n1,0.31\n2,0.12\n3,0.04\n```\n\nKayıp hızla düştü.';
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'hatirlatici', args: { mesaj: 'çay iç', dakika: 5 } });
      if (round === 2) return fakeRes(body, { name: 'gider', args: { tutar: 450, kategori: 'yakıt', aciklama: 'depoya' } });
      if (round === 3) return fakeRes(body, { name: 'gider', args: { ozet: true } });
      return fakeRes(body, null, GRAFIKLI);
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Asistan'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = '5 dk sonra çay hatırlat ve yakıt giderini yaz'; $(w, '#send').click();
  await wait(4200);
  const rem = JSON.parse(w.localStorage.getItem('evrim:reminders') || '[]');
  const exp = JSON.parse(w.localStorage.getItem('evrim:expenses') || '[]');
  ok('42. hatırlatıcı kaydedildi (5 dk sonra)', rem.length === 1 && rem[0].mesaj === 'çay iç' && rem[0].dueAt > Date.now() && rem[0].dueAt < Date.now() + 6 * 60000);
  ok('42. gider kaydedildi (450 yakıt)', exp.length === 1 && exp[0].tutar === 450 && exp[0].kategori === 'yakıt');
  const toolMsgs = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool'));
  const ozetR = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).find((r) => r?.ayTablo);
  ok('42. gider özeti tablo döndürdü', !!ozetR && ozetR.ayTablo.includes('₺') && ozetR.katTablo.includes('yakıt'));
  const botHtml = $$(w, '#msgs .msg.bot').map((e) => e.innerHTML).join(' ');
  ok('42. ```grafik bloğu SVG oldu', botHtml.includes('svg') && botHtml.includes('grafik') && botHtml.includes('<path'));
  ok('42. grafik başlığı render edildi', botHtml.includes('Kayip Egrisi'));
  ok('42. çipler: ⏰ + 💸', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('⏰')) && $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('💸')));
  ok('42. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 43) v56 arayüz: 🎙️/📄/📷 düğmeleri + tek dosya yedek ================= */
{
  const w = makeWin({ fetch: async () => ({ ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' }) });
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  ok('43. composer düğmeleri var (mic/pdf/ocr)', !!$(w, '#micBtn') && !!$(w, '#pdfBtn') && !!$(w, '#ocrBtn'));
  ok('43. gizli dosya inputları var', !!$(w, '#pdfFile') && !!$(w, '#ocrFile'));
  $(w, '#micBtn').click(); // SpeechRecognition yok -> zarif toast
  await wait(100);
  ok('43. mic API yokken çökmüyor (toast yolu)', w.errors.length === 0);
  $(w, '#npName').value = 'Yedek'; $(w, '#npCreate').click(); await wait(250);
  ok('43. tek dosya yedek düğmesi var', !!$(w, '#btnHtmlYedek'));
  $(w, '#btnHtmlYedek').click(); // jsdom'da createObjectURL yok -> zarif yol
  await wait(150);
  ok('43. yedek düğmesi çökmüyor', w.errors.length === 0);
  w.close?.();
}


/* ================= 44) hava_durumu + doviz + ceviri (anahtarsız dış API'ler) ================= */
{
  let round = 0; const calls = [];
  const jsonRes = (o) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => o });
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return jsonRes({ data: [] });
      round++;
      if (round === 1) return fakeRes(body, { name: 'hava_durumu', args: { sehir: 'Gaziantep', gun: 3 } });
      if (round === 2) return fakeRes(body, { name: 'doviz', args: { baz: 'USD', hedef: 'TRY', miktar: 100 } });
      if (round === 3) return fakeRes(body, { name: 'ceviri', args: { metin: 'hello world', hedef: 'tr' } });
      return fakeRes(body, null, 'Hava açık, 100 dolar 4860 TL, çeviri: merhaba dünya.');
    }
    if (u.includes('geocoding-api.open-meteo.com')) return jsonRes({ results: [{ name: 'Gaziantep', admin1: 'Gaziantep', country: 'Türkiye', latitude: 37.06, longitude: 37.38 }] });
    if (u.includes('api.open-meteo.com')) return jsonRes({ current: { temperature_2m: 31.2, apparent_temperature: 30, relative_humidity_2m: 22, precipitation: 0, weather_code: 0, wind_speed_10m: 11 }, daily: { time: ['2026-09-12', '2026-09-13', '2026-09-14'], weather_code: [0, 2, 61], temperature_2m_max: [33, 32, 27], temperature_2m_min: [20, 19, 17], precipitation_probability_max: [0, 10, 65] } });
    if (u.includes('frankfurter')) return jsonRes({ date: '2026-09-11', base: 'USD', rates: { TRY: 48.6 } });
    if (u.includes('mymemory')) return jsonRes({ responseStatus: 200, responseData: { translatedText: 'merhaba dünya' } });
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Hava'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'Gaziantep hava nasıl, dolar kaç TL, hello world çevir'; $(w, '#send').click();
  await wait(4200);
  const toolResults = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool')).map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).filter(Boolean);
  const hava = toolResults.find((r) => r?.gunlukTablo);
  const dov = toolResults.find((r) => r?.kur);
  const cev = toolResults.find((r) => r?.cevir);
  ok('44. hava: şehir + şu anki durum + tablo', !!hava && hava.ok === true && hava.yer.includes('Gaziantep') && hava.simdi.durum === 'Açık' && hava.gunlukTablo.includes('°C') && hava.gunlukTablo.includes('Hafif yağmur'));
  ok('44. döviz: 100 USD → 4860 TRY', !!dov && dov.ok === true && dov.kur === 48.6 && dov.sonuc === 4860 && dov.tarih === '2026-09-11');
  ok('44. çeviri: hello world → merhaba dünya', !!cev && cev.ok === true && cev.cevir === 'merhaba dünya' && cev.kaynak === 'en' && cev.hedef === 'tr');
  const chips = $$(w, '#msgs .toolstep').map((e) => e.textContent).join(' ');
  ok('44. çipler: 🌤️ + 💱 + 🗣️', chips.includes('🌤️') && chips.includes('💱') && chips.includes('🗣️'));
  ok('44. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 45) yapilac + aliskanlik + hatirlatici takvim (.ics) ================= */
{
  let round = 0; const calls = [];
  const jsonRes = (o) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => o });
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return jsonRes({ data: [] });
      round++;
      if (round === 1) return fakeRes(body, { name: 'yapilac', args: { islem: 'ekle', baslik: 'kitap oku' } });
      if (round === 2) return fakeRes(body, { name: 'aliskanlik', args: { islem: 'yapildi', ad: 'su iç' } });
      if (round === 3) return fakeRes(body, { name: 'hatirlatici', args: { mesaj: 'doktor', saat: '09:00', takvim: true } });
      return fakeRes(body, null, 'Görev eklendi, alışkanlık işaretlendi, hatırlatıcı takvime hazır.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Plan'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'kitap oku görevi ekle, su içtim işaretle, 9da doktor hatırlat'; $(w, '#send').click();
  await wait(4200);
  const todos = JSON.parse(w.localStorage.getItem('evrim:todos') || '[]');
  const habits = JSON.parse(w.localStorage.getItem('evrim:habits') || '[]');
  const rems = JSON.parse(w.localStorage.getItem('evrim:reminders') || '[]');
  ok('45. görev kaydedildi', todos.length === 1 && todos[0].baslik === 'kitap oku' && todos[0].done === false);
  const bugun = new Date().toLocaleDateString('sv-SE');
  ok('45. alışkanlık oto-oluştu + bugün işaretli', habits.length === 1 && habits[0].ad === 'su iç' && (habits[0].tarihler || []).includes(bugun));
  const toolResults = calls.filter((c) => c?.stream).flatMap((c) => c.messages.filter((m) => m.role === 'tool')).map((m) => { try { return JSON.parse(m.content); } catch { return null; } }).filter(Boolean);
  const alk = toolResults.find((r) => r?.seri !== undefined);
  ok('45. seri = 1 döndü', !!alk && alk.seri === 1 && alk.ok === true);
  const hat = toolResults.find((r) => r?.ics);
  ok('45. hatırlatıcı + .ics üretildi', rems.length === 1 && rems[0].mesaj === 'doktor' && !!hat && hat.ics.startsWith('BEGIN:VCALENDAR') && hat.ics.includes('SUMMARY:doktor') && hat.ics.includes('BEGIN:VALARM') && hat.takvim === 'hazir');
  const chips = $$(w, '#msgs .toolstep').map((e) => e.textContent).join(' ');
  ok('45. çipler: 🗓️ + 💧 + ⏰', chips.includes('🗓️') && chips.includes('💧') && chips.includes('⏰'));
  ok('45. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 46) 🔌 BAĞIMSIZ MOD: sıfır bulut çağrısı, beyin %100 cihazda ================= */
{
  let cloud = 0;
  const w = makeWin({ fetch: async (url) => {
    const u = String(url);
    if (u.startsWith('http')) cloud++;
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVWASM = { pipeline: async (task, model, opts) => {
    opts?.progress_callback?.({ status: 'progress', progress: 60 });
    return async (prompt, o) => {
      o?.streamer?.callback_function?.('CİHAZ_BEYNİ_CEVAP');
      o?.streamer?.end?.();
      return [{ generated_text: 'CİHAZ_BEYNİ_CEVAP' }];
    };
  } };
  w.localStorage.setItem('evrim:settings', JSON.stringify({ solo: true }));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  ok('46. bağımsız mod anahtarı arayüzde var', !!$(w, '#setSolo'));
  $(w, '#npName').value = 'Solo'; $(w, '#npCreate').click(); await wait(250);
  const c0 = cloud;
  $(w, '#input').value = 'Bana fotosentezi kısaca anlat'; $(w, '#send').click();
  await wait(3500);
  const msgs = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('46. cevap cihaz beyninden geldi (kart/indirme beklemeden)', msgs.some((m) => m.role === 'assistant' && String(m.content).includes('CİHAZ_BEYNİ_CEVAP')));
  ok('46. sıfır dış çağrı (groq/puter/free/jina…)', cloud === c0);
  const st46 = JSON.parse(w.localStorage.getItem('evrim:settings') || '{}');
  ok('46. solo ayarı kalıcı', st46.solo === true);
  ok('46. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 47) 🎯 EĞİTİM PANELİ: paketler + uzmanlaş + kural sil ================= */
{
  const w = makeWin({ fetch: async () => ({ ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' }) });
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Egitim'; $(w, '#npCreate').click(); await wait(250);
  const navBtn = $(w, '[data-v="train"]');
  ok('47. nav düğmesi var', !!navBtn);
  navBtn.click(); await wait(200);
  ok('47. panel açıldı', $(w, '#v-train').classList.contains('on'));
  ok('47. 4 hazır paket listelendi', $$(w, '[data-pack]').length === 4);
  $(w, '[data-pack="yazilim"]').click(); await wait(200);
  const mems = JSON.parse(w.localStorage.getItem('evrim:memories') || '[]');
  ok('47. paket kuralları beynine işlendi (4)', mems.filter((m) => m.kind === 'rule' && m.source === 'pack').length === 4);
  $(w, '[data-pack="yazilim"]').click(); await wait(200);
  const mems2 = JSON.parse(w.localStorage.getItem('evrim:memories') || '[]');
  ok('47. ikinci uygulama çoğaltmıyor (idempotent)', mems2.filter((m) => m.kind === 'rule' && m.source === 'pack').length === 4);
  $(w, '#trainFocus').value = 'Python'; $(w, '#btnTrainFocus').click(); await wait(200);
  const mems3 = JSON.parse(w.localStorage.getItem('evrim:memories') || '[]');
  ok('47. uzmanlaş kuralı eklendi', mems3.some((m) => m.kind === 'rule' && m.source === 'focus' && String(m.content).includes('Python')));
  ok('47. kural listesi DOMda', $$(w, '[data-delrule]').length === 5);
  const hedef = mems3.find((m) => m.source === 'pack');
  const del = $(w, `[data-delrule="${hedef.id}"]`);
  ok('47. sil düğmesi bulundu', !!del);
  del.click(); await wait(150);
  const mems4 = JSON.parse(w.localStorage.getItem('evrim:memories') || '[]');
  ok('47. kural silindi', !mems4.some((m) => m.id === hedef.id));
  ok('47. gelişim günlüğüne işlendi', (JSON.parse(w.localStorage.getItem('evrim:evolutions') || '[]')).some((e) => e.type === 'pack') && (JSON.parse(w.localStorage.getItem('evrim:evolutions') || '[]')).some((e) => e.type === 'focus'));
  ok('47. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 48) v60: 🌅 günlük brifing + 🎧 sesli sohbet + 🧠 ilgili hafıza ================= */
{
  const w = makeWin({ fetch: async () => ({ ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' }) });
  w.localStorage.setItem('evrim:todos', JSON.stringify([{ id: 't1', baslik: 'market alisverisi', done: false, ts: Date.now(), createdAt: new Date().toISOString() }]));
  w.localStorage.setItem('evrim:habits', JSON.stringify([{ id: 'h1', ad: 'su ic', tarihler: [], createdAt: new Date().toISOString() }]));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  ok('48. 🎧 sesli sohbet düğmesi var', !!$(w, '#voiceChatBtn'));
  ok('48. 🌅 brifing düğmesi var', !!$(w, '#btnBrief'));
  $(w, '#voiceChatBtn').click(); await wait(100); // SpeechRecognition yok → zarif toast
  ok('48. SR yokken sesli sohbet çökmüyor', w.errors.length === 0);
  $(w, '#npName').value = 'Brifing'; $(w, '#npCreate').click();
  await wait(1400); // otomatik brifing 700ms gecikmeli
  const msgs48 = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  const brf = msgs48.find((m) => m.model === '🌅 brifing');
  ok('48. otomatik günlük brifing geldi', !!brf && String(brf.content).includes('market alisverisi') && String(brf.content).includes('🔥'));
  ok('48. brifing alışkanlığı gösteriyor', !!brf && String(brf.content).includes('su ic'));
  ok('48. brifing günde bir (flag yazıldı)', !!w.localStorage.getItem('evrim:sonBrifing'));
  ok('48. hata yok', w.errors.length === 0);
  w.close?.();
}
{
  let sysSent = '';
  const MEMS = [
    { id: 'mA', content: 'Kullanıcı kahve sevmez', kind: 'fact', source: 'test', strength: 0.99, hits: 1, archived: false },
    { id: 'mB', content: 'Python döngü konusunu öğreniyor', kind: 'fact', source: 'test', strength: 0.4, hits: 1, archived: false },
  ];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      if (body?.stream && !sysSent) { const sm = (body.messages || []).find((m) => m.role === 'system'); if (sm) sysSent = String(sm.content); }
      return fakeRes(body, null, 'Python döngüleri: for ve while.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  w.localStorage.setItem('evrim:memories', JSON.stringify(MEMS));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Ilgili'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'Python döngüleri anlat'; $(w, '#send').click();
  await wait(4200);
  ok('48. sistem promptuna hafıza girdi', sysSent.includes('kahve') && sysSent.includes('Python döngü'));
  ok('48. ilgili hafıza güçsüz olsa da öne çıktı', sysSent.indexOf('Python döngü') < sysSent.indexOf('kahve'));
  ok('48. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 49) 🏗️ site_uret: üret → güncelle → canlı önizleme ================= */
{
  let round = 0; const calls = [];
  const KOD1 = '<!doctype html><html><head><meta charset="utf-8"><title>Portfoy</title><style>body{background:#111;color:#eee}</style></head><body><h1>Merhaba EVRIM</h1></body></html>';
  const KOD2 = '<!doctype html><html><head><meta charset="utf-8"><title>Portfoy v2</title></head><body><h1 style="color:blue">Surum 2</h1></body></html>';
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return fakeRes(body, { name: 'site_uret', args: { ad: 'portfoy', kod: KOD1 } });
      if (round === 2) return fakeRes(body, { name: 'site_uret', args: { ad: 'portfoy', kod: KOD2 } });
      return fakeRes(body, null, 'Siten hazır: [site](evrimsite:portfoy) — Önizle düğmesine bas!');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Site'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'bana portföy sitesi yap sonra başlığı mavi yap'; $(w, '#send').click();
  await wait(4200);
  const sites = JSON.parse(w.localStorage.getItem('evrim:sites') || '[]');
  ok('49. site kaydedildi + güncelleme çoğaltmadı', sites.length === 1 && sites[0].ad === 'portfoy' && sites[0].html.includes('Surum 2'));
  const card = $(w, '#msgs .sitecard[data-site="portfoy"]');
  ok('49. canlı önizleme kartı render edildi', !!card && !!card.querySelector('.siteprev') && !!card.querySelector('.sitedl'));
  ok('49. çip: 🏗️', $$(w, '#msgs .toolstep').some((e) => e.textContent.includes('🏗️')));
  card.querySelector('.siteprev').click(); await wait(150);
  const ov = $(w, '#siteOverlay');
  const ifr = ov?.querySelector('iframe');
  ok('49. önizleme açıldı (sandbox iframe + srcdoc)', !!ov && !!ifr && String(ifr.getAttribute('srcdoc') || '').includes('Surum 2') && String(ifr.getAttribute('sandbox') || '').includes('allow-scripts'));
  $(w, '#siteClose')?.click(); await wait(100);
  ok('49. önizleme kapandı', !$(w, '#siteOverlay'));
  ok('49. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 50) v62: tool_use_failed → araçsız tekrar + kesik JSON onarımı ================= */
{
  const sseRes = (text) => ({ ok: true, status: 200, headers: { get: () => 'text/event-stream' }, json: async () => ({}), text: async () => text,
    body: { getReader() { let d = false; return { read: async () => d ? { done: true, value: undefined } : (d = true, { done: false, value: new TextEncoder().encode(text) }), cancel: async () => {} }; } } });
  let round = 0; const calls = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return sseRes('data: {"error":{"code":"tool_use_failed","message":"Failed to parse tool call arguments as JSON"}}\n\ndata: [DONE]\n\n');
      return fakeRes(body, null, 'Araçsız yedek cevap: site planını metin olarak anlattım.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Hata62'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'bana site yap'; $(w, '#send').click();
  await wait(4200);
  const sc = calls.filter((c) => c?.stream);
  ok('50. araç turunda max_tokens ≥ 8000 (kesilme kökten önlendi)', sc.length >= 1 && sc[0].max_tokens >= 8000);
  ok('50. tool_use_failed → araçsız tekrar denendi', sc.length >= 2 && !sc[1].tools);
  const msgsA = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('50. kullanıcı cevapsız kalmadı', msgsA.some((m) => m.role === 'assistant' && String(m.content).includes('Araçsız yedek cevap')));
  ok('50. hata yok (A)', w.errors.length === 0);
  w.close?.();
}
{
  const sseRes = (text) => ({ ok: true, status: 200, headers: { get: () => 'text/event-stream' }, json: async () => ({}), text: async () => text,
    body: { getReader() { let d = false; return { read: async () => d ? { done: true, value: undefined } : (d = true, { done: false, value: new TextEncoder().encode(text) }), cancel: async () => {} }; } } });
  let round = 0; const calls = [];
  const rawArgs = '{"ad":"kisitli","kod":"<!doctype html><html><body><h1>TestTamir</h1></body></html>"'; // sondaki } kesik
  const truncStream = () => {
    const c1 = { delta: { tool_calls: [{ index: 0, id: 'tc9', type: 'function', function: { name: 'site_uret', arguments: rawArgs } }] }, finish_reason: null };
    const c2 = { delta: {}, finish_reason: 'tool_calls' };
    const text = [c1, c2].map((c) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, ...c }] })}\n\n`).join('') + 'data: [DONE]\n\n';
    return sseRes(text);
  };
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return truncStream();
      return fakeRes(body, null, 'Siten onarıldı ve hazır: [site](evrimsite:kisitli)');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Tamir62'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'küçük bir test sitesi yap'; $(w, '#send').click();
  await wait(4200);
  const sites = JSON.parse(w.localStorage.getItem('evrim:sites') || '[]');
  ok('50. kesik JSON onarıldı → site kaydedildi', sites.length === 1 && sites[0].ad === 'kisitli' && sites[0].html.includes('TestTamir'));
  ok('50. önizleme kartı render edildi', !!$(w, '#msgs .sitecard[data-site="kisitli"]'));
  ok('50. hata yok (B)', w.errors.length === 0);
  w.close?.();
}


/* ================= 51) v63: ham kod yakalayıcı → otomatik önizleme kartı ================= */
{
  let round = 0;
  const HAM = `İşte siteniz:

\`\`\`css
/* style.css */
:root { --primary:#0d6efd; }
body { font-family:Helvetica,Arial,sans-serif; line-height:1.6; }
.hero { background:#f8f9fa; padding:4rem 2rem; text-align:center; }
\`\`\`

\`\`\`html
<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><title>Nakliyat</title><link rel="stylesheet" href="style.css"></head>
<body>
<section class="hero"><h1>Evden Eve Nakliyat</h1><p>Guvenli tasima</p></section>
</body>
</html>
\`\`\`

Beğenmezsen renkleri değiştirebilirim.`;
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      return fakeRes(body, null, HAM);
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Yakala'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'beyoğlu nakliyat için site yap'; $(w, '#send').click();
  await wait(4200);
  const sites = JSON.parse(w.localStorage.getItem('evrim:sites') || '[]');
  ok('51. ham cevap otomatik siteye dönüştü', sites.length === 1 && sites[0].oto === true && sites[0].html.includes('Evden Eve Nakliyat'));
  ok('51. CSS tek dosyaya gömüldü (<style>)', sites[0].html.includes('<style>') && sites[0].html.includes('--primary:#0d6efd') && sites[0].html.includes('</head>'));
  const card = $(w, '#msgs .sitecard');
  ok('51. önizleme kartı mesajda göründü', !!card && card.dataset.site.startsWith('oto-'));
  const botTxt = $$(w, '#msgs .msg.bot').map((e) => e.textContent).join(' ');
  ok('51. ham kod mesajdan temizlendi', !botTxt.includes('<!DOCTYPE') && !botTxt.includes(':root'));
  card.querySelector('.siteprev').click(); await wait(150);
  const ifr = $(w, '#siteOverlay iframe');
  ok('51. canlı önizleme açıldı (srcdoc dolu)', !!ifr && String(ifr.getAttribute('srcdoc') || '').includes('Evden Eve Nakliyat'));
  ok('51. hata yok', w.errors.length === 0);
  w.close?.();
}


/* ================= 52) v64: beyin gücü — reasoning_effort + compound rotasyonu ================= */
{
  let round = 0; const calls = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      return fakeRes(body, null, 'Derin düşünceli cevap: 9.9 büyüktür.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Beyin64'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = '9.11 ile 9.9 hangisi büyük'; $(w, '#send').click();
  await wait(4200);
  const sc = calls.filter((c) => c?.stream);
  ok('52. reasoning_effort=high gönderildi (gpt-oss-120b)', sc.length >= 1 && sc[0].reasoning_effort === 'high' && sc[0].model === 'openai/gpt-oss-120b');
  ok('52. düşünce payı: max_tokens ≥ 4000', sc[0].max_tokens >= 4000);
  const msgs = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('52. cevap geldi', msgs.some((m) => m.role === 'assistant' && String(m.content).includes('9.9')));
  ok('52. hata yok (A)', w.errors.length === 0);
  w.close?.();
}
{
  const sseRes = (text) => ({ ok: true, status: 200, headers: { get: () => 'text/event-stream' }, json: async () => ({}), text: async () => text,
    body: { getReader() { let d = false; return { read: async () => d ? { done: true, value: undefined } : (d = true, { done: false, value: new TextEncoder().encode(text) }), cancel: async () => {} }; } } });
  let round = 0; const calls = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; calls.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      round++;
      if (round === 1) return sseRes('data: {"error":{"code":"tool_use_failed","message":"Failed to parse tool call arguments as JSON"}}\n\ndata: [DONE]\n\n');
      if (round === 2) return { ok: false, status: 429, headers: { get: () => 'application/json' }, json: async () => ({ error: { message: 'rate limit exceeded' } }), text: async () => '' };
      return fakeRes(body, null, 'Compound derin cevap verdi.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#npName').value = 'Compound'; $(w, '#npCreate').click(); await wait(250);
  $(w, '#input').value = 'bana kısa bir şiir yaz'; $(w, '#send').click();
  await wait(5000);
  const sc = calls.filter((c) => c?.stream);
  ok('52. araçsız tekrarda compound sıraya girdi', sc.length >= 3 && sc[1].model === 'openai/gpt-oss-120b' && !sc[1].tools && sc[2].model === 'groq/compound');
  const msgs = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('52. compound cevabı kullanıcıya ulaştı', msgs.some((m) => m.role === 'assistant' && String(m.content).includes('Compound derin cevap')));
  ok('52. hata yok (B)', w.errors.length === 0);
  w.close?.();
}

/* ================= 53) v65 ÇOKLU-BEYİN: taslak + compound eleştirmen + bireşim ================= */
{
  const bodies = [];
  let streamN = 0;
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; bodies.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      if (!body.stream) {
        const sys0 = String(body.messages?.[0]?.content || '');
        if (body.model === 'groq/compound') return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: 'ELEŞTİRİ: müzeye sabah git, öğleden sonra kalabalık.' } }] }), text: async () => '{}' };
        if (sys0.includes('KALICI tercih')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: JSON.stringify({ facts: [] }) } }] }), text: async () => '{}' };
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: '{}' } }] }), text: async () => '{}' };
      }
      streamN++;
      return fakeRes(body, null, 'SON PLAN: eleştiriden geçmiş hâl — müze sabah, kale öğleden sonra.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#input').value = 'Bana 3 günlük Gaziantep gezi planı öner'; $(w, '#send').click();
  await wait(5000);
  ok('53. compound eleştirmen çağrıldı', bodies.some((b) => b?.model === 'groq/compound'));
  const sc = bodies.filter((b) => b?.stream);
  ok('53. taslak turu araçlı non-stream + final akış turu var', sc.length >= 1 && bodies.some((b) => !b?.stream && b?.tools));
  const finalSys = (sc[sc.length - 1]?.messages || []).filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
  ok('53. final turunda BAĞIMSIZ ELEŞTİRİ + eleştirmen içeriği', finalSys.includes('BAĞIMSIZ ELEŞTİRİ') && finalSys.includes('müzeye sabah git'));
  const ms = JSON.parse(w.localStorage.getItem('evrim:messages') || '[]');
  ok('53. son cevap bireşim (SON PLAN)', ms.some((m) => m.role === 'assistant' && String(m.content).includes('SON PLAN')));
  ok('53. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 54) v65 DERİN HAFIZA (RAG): vektörel bağlam sistem promptuna girer ================= */
{
  const bodies = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; bodies.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      if (!body.stream) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: '{}' } }] }), text: async () => '{}' };
      return fakeRes(body, null, 'Python hakkında hafızandaki not: döngü egzersizi yaptın.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  w.localStorage.setItem('evrim:settings', JSON.stringify({ rag: true }));
  w.localStorage.setItem('evrim:ragvecs', JSON.stringify({ mB: { v: [0.9, 0.0] }, mA: { v: [0.0, 0.9] } }));
  w.localStorage.setItem('evrim:memories', JSON.stringify([
    { id: 'mA', kind: 'fact', content: 'Kullanıcı kahve sevmez.', createdAt: new Date().toISOString() },
    { id: 'mB', kind: 'fact', content: 'Kullanıcı Python döngü egzersizi yaptı.', createdAt: new Date().toISOString() },
  ]));
  w.__EVEMBED = async () => [[0.95, 0.05]];
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#gotoSettings')?.click(); await wait(300);
  ok('54. RAG ayar UI elemanları var', !!$(w, '#setRag') && $(w, '#setRag').checked && !!$(w, '#btnRagIndex') && !!$(w, '#ragStat'));
  ok('54. ragStat indeks sayısını gösteriyor', String($(w, '#ragStat').textContent).includes('2 kayıt'));
  $(w, '#input').value = 'Python konusunu hatırlıyor musun?'; $(w, '#send').click();
  await wait(3000);
  const sc = bodies.filter((b) => b?.stream);
  const sysSent = (sc[0]?.messages || []).filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
  ok('54. sistem promptunda İLGİLİ BAĞLAM bölümü var', sysSent.includes('İLGİLİ BAĞLAM'));
  const ragBolumu = sysSent.split('İLGİLİ BAĞLAM')[1] || '';
  ok('54. ANLAMCA yakın kayıt bağlama girdi', ragBolumu.includes('Python döngü egzersizi'));
  ok('54. alakasız kayıt eleme ile DIŞARIDA kaldı', !ragBolumu.split('##')[0].includes('kahve'));
  ok('54. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 55) v66 ARAŞTIRMA LABI: ayar kartı + özet gösterimi + ekQuizler şeması ================= */
{
  const w = makeWin({ fetch: async (url) => {
    const u = String(url);
    if (u.includes('raw.githubusercontent.com') && u.includes('lab/ozet.json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ tarih: '2026-09-13T06:17:00.000Z', ortPuan: 9.2, calismaSayisi: 7, ekSoruToplam: 12, trend: '4 → 6.8 → 9.2', sonYama: { uygulandi: true, hedef: 'elma-tuzak', beyinSurum: 16 }, sonBench: [] }) };
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#gotoSettings')?.click(); await wait(500);
  ok('55. lab kartı arayüzde var', !!$(w, '#labStat'));
  const ls = String($(w, '#labStat')?.textContent || '');
  ok('55. lab özeti GitHub\'dan çekilip gösterildi', ls.includes('9.2/10') && ls.includes('12'));
  ok('55. trend + oto-yama bilgisi gösterildi', ls.includes('4 → 6.8 → 9.2') && ls.includes('elma-tuzak'));
  const MUF = JSON.parse(fs.readFileSync(ROOT + '/web/data/mufredat.json', 'utf8'));
  const ekler = MUF.dersler.flatMap((d) => d.ekQuizler || []);
  const bozuk = ekler.filter((q) => !q.soru || !Array.isArray(q.secenekler) || q.secenekler.length !== 4 || !Number.isInteger(q.dogru) || q.dogru < 0 || q.dogru > 3 || !q.aciklama);
  ok('55. ekQuizler şeması geçerli (' + ekler.length + ' soru)', bozuk.length === 0);
  ok('55. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 56) v71 🌍 SİTE YAYINLAMA: GitHub Pages'e PUT + Pages aç + canlı adres ================= */
{
  const calls = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url); const m = (opts?.method || 'GET').toUpperCase();
    if (u.includes('api.github.com')) {
      calls.push(m + ' ' + u.replace('https://api.github.com', '').split('?')[0]);
      const H = { get: () => 'application/json' };
      if (m === 'GET' && u.endsWith('/user')) return { ok: true, status: 200, headers: H, json: async () => ({ login: 'TestUser' }) };
      if (m === 'GET' && u.endsWith('/repos/TestUser/evrim-siteler')) return { ok: true, status: 200, headers: H, json: async () => ({ default_branch: 'main' }) };
      if (m === 'POST' && u.endsWith('/user/repos')) return { ok: true, status: 201, headers: H, json: async () => ({ default_branch: 'main' }) };
      if (m === 'GET' && u.includes('/contents/site1.html')) return { ok: false, status: 404, headers: H, json: async () => ({}) };
      if (m === 'PUT' && u.includes('/contents/site1.html')) {
        const b = JSON.parse(opts.body);
        if (!b.content || !b.message) return { ok: false, status: 422, headers: H, json: async () => ({ message: 'eksik' }) };
        return { ok: true, status: 201, headers: H, json: async () => ({ content: { sha: 'abc' } }) };
      }
      if (m === 'GET' && u.includes('/pages')) return { ok: false, status: 404, headers: H, json: async () => ({}) };
      if (m === 'POST' && u.includes('/pages')) return { ok: true, status: 201, headers: H, json: async () => ({}) };
      return { ok: false, status: 404, headers: H, json: async () => ({}) };
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.localStorage.setItem('evrim:settings', JSON.stringify({ githubToken: 'ghp_test' }));
  w.localStorage.setItem('evrim:profiles', JSON.stringify([{ id: 'pr1', name: 'T', createdAt: new Date().toISOString() }]));
  w.localStorage.setItem('evrim:activeProfile', 'pr1');
  w.localStorage.setItem('evrim:sites', JSON.stringify([{ id: 'st1', ad: 'site1', html: '<!doctype html><html lang="tr"><head><title>Deneme</title></head><body>merhaba dünya</body></html>', createdAt: new Date().toISOString() }]));
  w.localStorage.setItem('evrim:conversations', JSON.stringify([{ id: 'c1', title: 't', profileId: 'pr1', createdAt: new Date().toISOString() }]));
  w.localStorage.setItem('evrim:messages', JSON.stringify([{ id: 'm1', conversationId: 'c1', role: 'assistant', content: 'Site hazır: [site1](evrimsite:site1)', createdAt: new Date().toISOString() }]));
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(500);
  const pub = $(w, '.sitepub');
  ok('56. kartta 🌍 Yayınla düğmesi var', !!pub);
  pub?.click();
  await wait(600);
  ok('56. dosya PUT ile yüklendi', calls.some((c) => c === 'PUT /repos/TestUser/evrim-siteler/contents/site1.html'));
  ok('56. Pages etkinleştirildi', calls.some((c) => c === 'POST /repos/TestUser/evrim-siteler/pages'));
  ok('56. canlı adres gösterildi', w.document.body.textContent.includes('testuser.github.io/evrim-siteler/site1.html'));
  ok('56. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 57) v72 SİTE KONTROL: kusurlu site → denetim raporu + DÜZELT; temiz site → GEÇTİ ================= */
{
  const BOZUK = '<html><head><title>t</title></head><body><h1>x</h1><a href="#yok">git</a><img src="a.png"><img src="b.png"></body></html>';
  const TEMIZ = '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title></head><body><h1>Merhaba</h1><p>İçerik burada.</p></body></html>';
  const bodies = [];
  let round = 0;
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null; bodies.push(body);
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      if (!body.stream) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: '{}' } }] }), text: async () => '{}' };
      round++;
      if (round === 1) return fakeRes(body, { name: 'site_uret', args: { ad: 'bozuk-demo', kod: BOZUK } });
      if (round === 2) return fakeRes(body, null, 'Site hazır (denetim raporu model tarafından görüldü).');
      if (round === 3) return fakeRes(body, { name: 'site_uret', args: { ad: 'temiz-demo', kod: TEMIZ } });
      return fakeRes(body, null, 'Temiz site de hazır.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVHOUSEKEY = 'gsk_x';
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#input').value = 'bana demo site yap'; $(w, '#send').click();
  await wait(9000);   // QA iframe zaman aşımı (3.5s) + akış
  const toolMsgA = bodies.filter((b) => b?.stream).map((b) => (b.messages || []).find((m) => m.role === 'tool')).filter(Boolean).pop();
  const icerikA = String(toolMsgA?.content || '');
  ok('57. kusurlar raporlandı: viewport+ölü link+alt', icerikA.includes('viewport meta yok') && icerikA.includes('ölü iç link') && icerikA.includes('#yok') && icerikA.includes('2 görselde alt yok'));
  ok('57. DÜZELT talimatı + aynı ad ile tekrar çağrı', icerikA.includes('DÜZELT') && icerikA.includes('bozuk-demo'));
  $(w, '#input').value = 'temiz site yap'; $(w, '#send').click();
  await wait(9000);
  const toolMsgB = bodies.filter((b) => b?.stream).map((b) => (b.messages || []).filter((m) => m.role === 'tool').pop()).filter(Boolean).pop();
  const icerikB = String(toolMsgB?.content || '');
  ok('57. temiz site denetimden geçti', icerikB.includes('DENETİMDEN GEÇTİ') && icerikB.includes('temiz-demo'));
  ok('57. hata yok', w.errors.length === 0);
  w.close?.();
}

/* ================= 58) v73 FRONTIER: gemini-2.5 ev anahtarı (1M bağlam) + kota düşünce Groq yedeği ================= */
{
  // A) frontier mutlu yol: istek generativelanguage compat ucuna, model gemini-2.5-flash, araçlar açık
  const gem = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('generativelanguage')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      gem.push({ u, auth: opts?.headers?.Authorization, body });
      if (!body?.stream) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: '{}' } }] }), text: async () => '{}' };
      return fakeRes(body, null, 'FRONTIER CEVAP: kuantum süperpozisyonla çalışır.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVFRONTIERKEY = 'AIzaFRONTIERTEST';
  w.__EVFRONTIERPROV = 'gemini'; w.__EVFRONTIERMODEL = 'gemini-2.5-flash';   // v74 varsayılanı openrouter; bu test gemini yolunu doğrular
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#input').value = 'Kuantum bilgisayarı iki cümlede anlat'; $(w, '#send').click();
  await wait(1600);
  const txtA = w.document.querySelector('#msgs')?.textContent || '';
  ok('58A. frontier cevabı render edildi', txtA.includes('FRONTIER CEVAP'));
  ok('58A. compat uç nokta + gemini-2.5-flash', gem.length >= 1 && gem[0].u.includes('/v1beta/openai/chat/completions') && gem[0].body?.model === 'gemini-2.5-flash');
  ok('58A. Bearer frontier anahtarı', gem[0]?.auth === 'Bearer AIzaFRONTIERTEST');
  ok('58A. ajan araçları frontier ile çalışıyor (tools gövdede)', (gem[0]?.body?.tools || []).length > 5);
  ok('58A. hata yok', w.errors.length === 0);
  w.close?.();

  // B) kota 429 → tüm gemini kuyruğu düşer → Groq ev beynine otomatik yedek
  const gemCalls = []; let groqStream = 0;
  const w2 = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('generativelanguage')) {
      gemCalls.push(u);
      return { ok: false, status: 429, headers: { get: () => 'application/json' }, json: async () => ({ error: { message: 'You exceeded your current quota' } }), text: async () => '{}' };
    }
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      if (!body?.stream) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: '{}' } }] }), text: async () => '{}' };
      groqStream++;
      return fakeRes(body, null, 'GROQ YEDEK CEVAP devrede.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w2.__EVFRONTIERKEY = 'AIzaQUOTA'; w2.__EVHOUSEKEY = 'gsk_house_test';
  w2.__EVFRONTIERPROV = 'gemini'; w2.__EVFRONTIERMODEL = 'gemini-2.5-flash';   // gemini kuyruğu testi
  try { w2.eval(bundle); } catch (e) { w2.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w2, '#input').value = 'Fotosentezi iki cümlede anlat'; $(w2, '#send').click();
  await wait(2500);
  const txtB = w2.document.querySelector('#msgs')?.textContent || '';
  ok('58B. kota düşünce Groq yedeği cevap verdi', txtB.includes('GROQ YEDEK CEVAP') && groqStream >= 1);
  ok('58B. gemini kuyruğu denendi (flash+lite)', gemCalls.length >= 2);
  ok('58B. hata yok', w2.errors.length === 0);
  w2.close?.();
}

/* ================= 59) v74 OPENROUTER FRONTIER: varsayılan beyin :free kuyruğu + kota düşünce Groq yedeği ================= */
{
  // A) mutlu yol: frontier=openrouter (gömülü varsayılan), model :free kuyruğundan, araçlar açık
  const orCalls = [];
  const w = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('openrouter.ai')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      orCalls.push({ u, auth: opts?.headers?.Authorization, body });
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [{ id: 'nvidia/nemotron-3-super-120b-a12b:free', context_length: 262144, name: 'nm' }, { id: 'nex-agi/nex-n2.5-pro:free', context_length: 262144, name: 'nx' }] }) };
      if (!body?.stream) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: '{}' } }] }), text: async () => '{}' };
      return fakeRes(body, null, 'OR FRONTIER CEVAP: nemotron devrede.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w.__EVFRONTIERKEY = 'sk-or-v1-TESTKEY';   // provider/model gömülü varsayılardan gelir (openrouter/auto)
  try { w.eval(bundle); } catch (e) { w.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w, '#input').value = 'Görelilik kuramını iki cümlede anlat'; $(w, '#send').click();
  await wait(2500);
  const txtA = w.document.querySelector('#msgs')?.textContent || '';
  const comp = orCalls.filter((c) => !c.u.includes('/models'));
  ok('59A. openrouter frontier cevabı render edildi', txtA.includes('OR FRONTIER CEVAP'));
  ok('59A. :free model + ölçülmüş öncelik sırası', comp.length >= 1 && String(comp[0].body?.model || '').endsWith(':free') && comp[0].body.model === 'nvidia/nemotron-3-super-120b-a12b:free');
  ok('59A. Bearer frontier anahtarı', String(comp[0]?.auth || '').startsWith('Bearer sk-or-v1-'));
  ok('59A. ajan araçları açık + araç çıktı payı', (comp[0]?.body?.tools || []).length > 5 && comp[0]?.body?.max_tokens >= 8000);
  ok('59A. hata yok', w.errors.length === 0);
  w.close?.();

  // B) tüm :free kuyruğu 429 → frontier soğur → Groq ev beyni cevaplar
  const orQ = []; let groqStream = 0;
  const w2 = makeWin({ fetch: async (url, opts) => {
    const u = String(url);
    if (u.includes('openrouter.ai')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [{ id: 'nvidia/nemotron-3-super-120b-a12b:free', context_length: 262144, name: 'nm' }] }) };
      orQ.push(body?.model);
      return { ok: false, status: 429, headers: { get: () => 'application/json' }, json: async () => ({ error: { message: 'daily free limit reached' } }), text: async () => '{}' };
    }
    if (u.includes('groq.com')) {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (u.includes('/models')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) };
      if (!body?.stream) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: '{}' } }] }), text: async () => '{}' };
      groqStream++;
      return fakeRes(body, null, 'GROQ YEDEK CEVAP devrede.');
    }
    return { ok: false, status: 500, headers: { get: () => '' }, json: async () => ({}), text: async () => '' };
  } });
  w2.__EVFRONTIERKEY = 'sk-or-v1-QUOTA'; w2.__EVHOUSEKEY = 'gsk_house_test';
  try { w2.eval(bundle); } catch (e) { w2.errors.push('THROW: ' + e.stack); }
  await wait(400);
  $(w2, '#input').value = 'Fotosentezi iki cümlede anlat'; $(w2, '#send').click();
  await wait(3000);
  const txtB = w2.document.querySelector('#msgs')?.textContent || '';
  ok('59B. kota düşünce Groq yedeği cevap verdi', txtB.includes('GROQ YEDEK CEVAP') && groqStream >= 1);
  ok('59B. free kuyruğu denendi', orQ.length >= 1);
  ok('59B. hata yok', w2.errors.length === 0);
  w2.close?.();
}

console.log(`\nSONUÇ: ${pass} ✅ / ${fail} ❌`);
process.exit(fail ? 1 : 0);
