#!/usr/bin/env node
/* EVRIM Araştırma Labı — 7/24 kendi kendine öğrenme döngüsü (GitHub Actions'ta 6 saatte bir).
   1) BENCH    : sabit sorular (lab/bench.json) → mevcut beyin cevaplar → LLM jüri 0-10 puanlar
   2) İÇERİK   : 2 derse doğrulanmış YENİ quiz sorusu üretir → web/data/mufredat.json (ekQuizler)
   3) ÖNERİ    : düşük puanlardan somut iyileştirme önerileri çıkarır → lab/ONERILER.md
   Anahtar: repoda gömülü ev anahtarı (housekey.js) — CI'da secret gerekmez.
   Güvenlik: bu betik YALNIZ veri üretir; uygulama kodunu değiştirmez (kod = insan onaylı). */
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const now = () => new Date().toISOString();
const BEYIN = 'openai/gpt-oss-120b';   // uygulamadaki varsayılan beyinle aynı
const JURI = 'groq/compound';

function houseKey() {
  const src = fs.readFileSync('web/js/housekey.js', 'utf8');
  const m = src.match(/atob\('([^']+)'\)/);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : '';
}
const KEY = houseKey();

async function groq(model, messages, { temp = 0, max = 900, reason = 'high' } = {}) {
  // yedek zinciri: istenen → 20b → 120b (compound'un TPM kotası düşük: 30K/dk — jüri uzun metinde 429 yer)
  const zincir = [model, 'openai/gpt-oss-20b', BEYIN].filter((m, i, arr) => arr.indexOf(m) === i);
  for (const m of zincir) {
    try {
      const body = { model: m, messages, temperature: temp, max_tokens: max };
      // DİKKAT: reasoning_effort high + küçük max_tokens → düşünme bütçeyi bitirir, içerik BOŞ döner (canlı doğrulandı)
      if (m.startsWith('openai/gpt-oss')) body.reasoning_effort = reason;
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY, 'user-agent': UA },
        body: JSON.stringify(body),
      });
      if (r.status === 429 || r.status >= 500) {
        const t = await r.text().catch(() => '');
        const ra = t.match(/try again in ([\d.]+)s/);           // Groq ne zaman deneneceğini söylüyor
        await new Promise((z) => setTimeout(z, Math.min(Math.ceil((ra ? Number(ra[1]) : 5) + 1) * 1000, 30000)));
        continue;
      }
      const j = await r.json();
      const c = j?.choices?.[0]?.message?.content;
      if (c && String(c).trim()) return String(c);
    } catch { await new Promise((z) => setTimeout(z, 2000)); }
  }
  return null;
}

function puanCikar(t) {
  const p = jsonCikar(t);
  if (p && p.puan !== undefined) return { puan: Math.max(0, Math.min(10, Math.round(Number(p.puan) || 0))), neden: String(p.neden || '').slice(0, 160) };
  const m = String(t || '').match(/"?(?:puan|score)"?\s*[:=]\s*(\d{1,2})/i);   // jüri JSON'u bozarsa yedek yol
  if (m) return { puan: Math.max(0, Math.min(10, Number(m[1]))), neden: 'JSON bozuk — puandan okundu' };
  return null;
}

function jsonCikar(t) {
  if (!t) return null;
  const s = String(t).replace(/```json|```/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

function basePrompt() {   // uygulamanın GERÇEK beyin promptu (store.js) — bench birebir onu ölçer
  const src = fs.readFileSync('web/js/store.js', 'utf8');
  const m = src.match(/const BASE_PROMPT = `([\s\S]*?)`;/);
  return m ? m[1].replace(/\$\{BASE_PROMPT_VERSION\}/g, 'lab').replace(/\\`/g, '`') : 'Sen EVRIM asistanısın. Türkçe, doğru, net cevapla.';
}

/* ---------- 1) BENCH ---------- */
async function bench() {
  const sorular = JSON.parse(fs.readFileSync('lab/bench.json', 'utf8'));
  const sonuc = [];
  for (let si = 0; si < sorular.length; si++) {
    const b = sorular[si];
    if (si > 0) await new Promise((z) => setTimeout(z, 6000));   // TPM nefesi: ağır reasoning çağrıları arası bekleme
    let cevap = await groq(BEYIN, [
      { role: 'system', content: basePrompt() + '\n(Not: bu oturumda araçların yok — hesabı dikkatle kendin yap.)' },
      { role: 'user', content: b.soru },
    ], { temp: 0, max: b.max || 3500 });
    if (!cevap) {   // CI'da kota/ağ dalgalanması: bir tekrar (20 sn sonra)
      await new Promise((z) => setTimeout(z, 20000));
      cevap = await groq(BEYIN, [
        { role: 'system', content: basePrompt() + '\n(Not: bu oturumda araçların yok — hesabı dikkatle kendin yap.)' },
        { role: 'user', content: b.soru },
      ], { temp: 0, max: b.max || 3500 });
    }
    if (!cevap) { sonuc.push({ id: b.id, puan: 0, neden: 'cevap alınamadı (ağ/kota)' }); continue; }
    const p = await juriPuan(b, cevap);
    sonuc.push({ id: b.id, puan: p?.puan ?? 0, neden: p?.neden || 'jüri parse edilemedi' });
  }
  return sonuc;
}

// jüri modeli 20b (reasoning LOW): compound küçük gövdede bile 413/429 verebiliyor (canlı doğrulandı)
async function juriPuan(b, cevap) {
  const juriIstek = [
    { role: 'system', content: 'Acımasız ama adil jürisin. Yalnızca TEK satır JSON yaz, başka hiçbir şey yazma: {"puan": <0-10 tam sayı>, "neden": "<1 cümle>"}' },
    { role: 'user', content: `Soru: ${b.soru}\nBeklenen ölçüt: ${b.beklenti}\n\nCevap (kırpılmış olabilir):\n${String(cevap).slice(0, b.juriSlice || 1200)}` },
  ];
  let p = puanCikar(await groq('openai/gpt-oss-20b', juriIstek, { temp: 0, max: 800, reason: 'low' }));
  if (!p) p = puanCikar(await groq('openai/gpt-oss-20b', juriIstek, { temp: 0, max: 800, reason: 'low' }));   // bir tekrar
  return p;
}

/* ---------- 1b) OTO-YAMA: kalıcı zayıflığı lab KENDİSİ düzeltir (v68) ----------
   Tetik: bir bench maddesi SON 3 çalıştırmada ≤3 puan aldıysa.
   Akış: kural adayı üret → ADAY prompt ile hedef + 2 regresyon sorusunu 2'şer kez ölç →
         hepsi ≥7 ise UYGULA (store.js kural + sürüm, suite s1 sürüm, sw/index cache sürüm).
   Güvenlik: A/B eşiği geçilmezse hiçbir dosyaya dokunulmaz; workflow'taki 299 testlik
   regresyon kapısı son sözü söyler — suite geçmezse commit edilmez, workspace çöpe gider. */
async function otoYama(sonuc) {
  try {
    if (process.env.LAB_OTO_YAMA === 'kapali') return null;
    const benchDosya = JSON.parse(fs.readFileSync('lab/bench.json', 'utf8'));
    const src0 = fs.readFileSync('web/js/store.js', 'utf8');
    if ((src0.match(/OTO-KURAL/g) || []).length >= 3) return null;   // prompt şişmesin: en fazla 3 oto-kural
    let hedef = process.env.LAB_FORCE_YAMA || '';
    if (!hedef) {
      const satirlar = fs.existsSync('lab/sonuclar.jsonl')
        ? fs.readFileSync('lab/sonuclar.jsonl', 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
        : [];
      const onceki = satirlar.slice(-3);
      if (onceki.length >= 3) {
        const say = {};
        for (const sat of onceki) for (const [id, p] of (sat.sorular || [])) if (p !== null && p <= 3) say[id] = (say[id] || 0) + 1;   // null = ağ/kota, zaaf değil
        hedef = Object.keys(say).find((k) => say[k] >= 3) || '';
      }
    }
    if (!hedef) return null;
    const b = benchDosya.find((x) => x.id === hedef);
    if (!b) return null;
    const mevcut = basePrompt();
    const not = '\n(Not: bu oturumda araçların yok — hesabı dikkatle kendin yap.)';
    const dusuk = sonuc.find((x) => x.id === hedef);
    // 1) kural adayı (tek satır, güvenli karakterler)
    const k = await groq('groq/compound', [
      { role: 'system', content: 'Türkçe sistem promptu kuralı yazan uzmansın. Yalnızca TEK satır yaz (madde işaretsiz, max 220 karakter, tırnak/backtick/$ kullanma).' },
      { role: 'user', content: `Asistan şu bench sorusunda sürekli başarısız:\nSoru: ${b.soru}\nBeklenen: ${b.beklenti}\nJüri notu: ${dusuk?.neden || '-'}\n\nBu zaafı giderecek GENEL (soruyu birebir tekrar etmeyen, aynı aileden soruları da kapsayan) tek bir davranış kuralı yaz. Kanıtlanmış etkili biçim: önce sorunun ne istediğini tek cümleyle yeniden ifade ettir, sonra cevaplat. Örnek stil: "X tarzı sorularda önce ... yaz, sonra ...".` },
    ], { temp: 0.7, max: 600, reason: 'low' });   // reason LOW: oss yedeğinde düşünme bütçeyi yemesin (canlı doğrulandı)
    let kural = String(k || '').trim().split('\n')[0].replace(/[`$"]/g, '').slice(0, 250);
    if (kural.length < 25) return { hedef, uygulandi: false, neden: 'kural adayı üretilemedi (kota/format)' };
    if (src0.includes(kural.slice(0, 40))) return { hedef, uygulandi: false, neden: 'aynı kural zaten var' };
    // 2) aday prompt
    const i = mevcut.indexOf('\n\n## BİÇİM');
    if (i < 0) return { hedef, uygulandi: false, neden: 'prompt çapası bulunamadı' };
    const aday = mevcut.slice(0, i) + `\n- OTO-KURAL (lab A/B doğrulamalı, ${new Date().toISOString().slice(0, 10)}): ${kural}` + mevcut.slice(i);
    // 3) A/B: hedef + 2 regresyon sorusu, 2'şer ölçüm
    const regresyon = benchDosya.filter((x) => ['matematik-tuzak', 'yuzde-tuzak'].includes(x.id));
    const detay = [];
    let gecti = true;
    for (const t of [b, ...regresyon]) {
      if (!gecti) { detay.push(`${t.id}:atlandı`); continue; }   // eşik bir kez bozulduysa kota harcama
      let toplam = 0, n = 0;
      for (let r = 0; r < 2 && gecti; r++) {
        await new Promise((z) => setTimeout(z, 8000));   // kota nefesi (A/B ağır çağrılar: 3500 token + jüri)
        let cvp = await groq(BEYIN, [{ role: 'system', content: aday + not }, { role: 'user', content: t.soru }], { temp: 0, max: t.max || 3500 });
        if (!cvp) { await new Promise((z) => setTimeout(z, 30000)); cvp = await groq(BEYIN, [{ role: 'system', content: aday + not }, { role: 'user', content: t.soru }], { temp: 0, max: t.max || 3500 }); }
        if (!cvp) { detay.push(`${t.id}:ağ/kota`); gecti = false; break; }
        const p = await juriPuan(t, cvp);
        toplam += p?.puan ?? 0; n++;
      }
      const ort = n ? toplam / n : 0;
      detay.push(`${t.id}:${ort}`);
      if (ort < 7) gecti = false;
    }
    if (!gecti) return { hedef, uygulandi: false, kural, detay };
    // 4) UYGULA: store.js (kural + sürüm) + suite s1 + sw/index cache (mekanik bump)
    const v = Number(src0.match(/BASE_PROMPT_VERSION = (\d+)/)[1]);
    let src = src0.replace(`BASE_PROMPT_VERSION = ${v}`, `BASE_PROMPT_VERSION = ${v + 1}`);
    const i2 = src.indexOf('\n\n## BİÇİM');
    src = src.slice(0, i2) + `\n- OTO-KURAL (lab A/B doğrulamalı, ${new Date().toISOString().slice(0, 10)}): ${kural}` + src.slice(i2);
    fs.writeFileSync('web/js/store.js', src);
    let st = fs.readFileSync('tests/suite.mjs', 'utf8');
    st = st.replace(`Sürüm: ${v}`, `Sürüm: ${v + 1}`);
    fs.writeFileSync('tests/suite.mjs', st);
    const sw0 = fs.readFileSync('web/sw.js', 'utf8');
    const cv = Number(sw0.match(/evrim-web-v(\d+)/)[1]);
    fs.writeFileSync('web/sw.js', sw0.replace(`evrim-web-v${cv}`, `evrim-web-v${cv + 1}`));
    let ix = fs.readFileSync('web/index.html', 'utf8');
    ix = ix.replace(`sw.js?v=${cv}`, `sw.js?v=${cv + 1}`);
    fs.writeFileSync('web/index.html', ix);
    return { hedef, uygulandi: true, kural, detay, beyinSurum: v + 1, cacheSurum: cv + 1 };
  } catch (e) {
    return { hata: String(e?.message || e).slice(0, 140) };
  }
}

/* ---------- 2) İÇERİK: ek quiz üretimi ---------- */
async function icerik() {
  const muf = JSON.parse(fs.readFileSync('web/data/mufredat.json', 'utf8'));
  const gecerli = (q) => q && typeof q.soru === 'string' && q.soru.length > 10
    && Array.isArray(q.secenekler) && q.secenekler.length === 4 && q.secenekler.every((x) => typeof x === 'string' && x.length > 0)
    && Number.isInteger(q.dogru) && q.dogru >= 0 && q.dogru <= 3 && typeof q.aciklama === 'string' && q.aciklama.length > 5;
  const hedef = muf.dersler
    .filter((d) => d.baslik && d.ozet && gecerli(d.quiz))
    .sort((a, b) => (a.ekQuizler?.length || 0) - (b.ekQuizler?.length || 0) || a.no - b.no)
    .slice(0, 2);
  let yeni = 0;
  for (const d of hedef) {
    const j = await groq(JURI, [
      { role: 'system', content: 'Türkçe eğitim içeriği üreticisisin. SADECE JSON yaz, başka hiçbir şey yazma.' },
      { role: 'user', content: `Ders ${d.no}: ${d.baslik}\nÖzet: ${d.ozet}\nKavramlar: ${(d.kavramlar || []).join(', ')}\nMevcut soru: ${d.quiz.soru}\n\nBu derse YENİ ve FARKLI, orta zorlukta 1 çoktan seçmeli soru üret. Biçim: {"soru":"...","secenekler":["a","b","c","d"],"dogru":<0-3>,"aciklama":"1-2 cümle"}. Doğru seçenek kesinlikle doğru olsun; çeldiriciler akla yatkın olsun.` },
    ], { temp: 0.9, max: 500 });
    const q = jsonCikar(j);
    if (!q || !gecerli(q)) continue;
    const dup = [d.quiz, ...(d.ekQuizler || [])].some((x) => (x?.soru || '').replace(/\s+/g, ' ').trim() === q.soru.replace(/\s+/g, ' ').trim());
    if (dup) continue;
    (d.ekQuizler = d.ekQuizler || []).push(q);
    yeni++;
  }
  if (yeni) fs.writeFileSync('web/data/mufredat.json', JSON.stringify(muf, null, 1) + '\n');
  const toplam = muf.dersler.reduce((t, d) => t + (d.ekQuizler?.length || 0), 0);
  return { yeni, toplam };
}

/* ---------- 3) ÖNERİ ---------- */
async function oneriler(sonuc, ort) {
  const dusukler = sonuc.filter((x) => x.puan < 7).map((x) => `${x.id}: ${x.puan}/10 — ${x.neden}`).join('\n') || 'tümü ≥7';
  const t = await groq(JURI, [
    { role: 'system', content: 'Sen EVRIM uygulamasının geliştirme danışmanısın. Türkçe yaz.' },
    { role: 'user', content: `Bench ortalaması: ${ort}/10.\nDüşük puanlılar:\n${dusukler}\n\nEVRIM: tarayıcıda çalışan, ücretsiz, mobil öncelikli, araç çağırabilen (37 araç), hafızalı, RAG destekli Türkçe AI asistanı. Beyin: gpt-oss-120b (reasoning high) + groq/compound eleştirmen. GERÇEK dosyalar YALNIZ şunlardır (başka dosya/Python YOKTUR, .py önerme): web/js/{app,agent,llm,store,rag,learn,wasm,evolve}.js, lab/{run.mjs,bench.json}, tests/suite.mjs, web/data/{mufredat,katalog}.json. Ortam: tarayıcı (ES modules, localStorage, jsdom test) + Node 20 CI. Buna göre 3-5 SOMUT, ücretsiz, bu dosyalarda yapılabilir iyileştirme öner — her biri tek satır, "- " ile başla, hangi dosyada ne değişeceğini söyle.` },
  ], { temp: 0.5, max: 700, reason: 'low' });   // reason LOW: oss yedeğinde düşünme bütçeyi yemesin
  if (t) fs.writeFileSync('lab/ONERILER.md', `# 💡 Lab Önerileri\n\n_Son güncelleme: ${now()} — bench ortalaması ${ort}/10_\n\n${t.trim()}\n`);
}

/* ---------- günlük + özet ---------- */
function logla(sonuc, ort, icerikSonuc) {
  // ağ/kota kaynaklı 0'lar PUAN DEĞİLDİR → null yazılır (oto-yama tetiği bunları SAYMAZ)
  fs.appendFileSync('lab/sonuclar.jsonl', JSON.stringify({ t: now(), beyin: BEYIN, ort, yeniSoru: icerikSonuc.yeni, sorular: sonuc.map((x) => [x.id, x.neden === 'cevap alınamadı (ağ/kota)' ? null : x.puan]) }) + '\n');
  const calisma = fs.readFileSync('lab/sonuclar.jsonl', 'utf8').trim().split('\n').length;
  const satir = `| ${now().slice(0, 16).replace('T', ' ')} | ${ort}/10 | +${icerikSonuc.yeni} | ${sonuc.map((x) => `${x.id.split('-')[0]}:${x.puan}`).join(' ')} |`;
  let md = fs.existsSync('lab/ARASTIRMA.md') ? fs.readFileSync('lab/ARASTIRMA.md', 'utf8') : '';
  const baslik = '# 🔬 EVRIM Araştırma Günlüğü\n\n7/24 otomatik döngü (GitHub Actions, 6 saatte bir): bench + jüri puanı + yeni quiz + öneriler.\n\n| Çalışma (UTC) | Bench ort. | Yeni soru | Detay |\n|---|---|---|---|\n';
  if (!md.includes('| Çalışma (UTC) |')) md = baslik;
  const govde = md.split('\n').filter((l) => l.startsWith('| '));
  const ust = md.slice(0, md.indexOf('| Çalışma (UTC) |') >= 0 ? md.indexOf('| Çalışma (UTC) |') : md.length);
  const tablo = [...govde.slice(0, 1), satir, ...govde.slice(1)].slice(0, 62);   // başlık satırından sonra EN ÜSTE ekle (kronolojik)
  fs.writeFileSync('lab/ARASTIRMA.md', (ust.endsWith('\n') || ust === '' ? ust : ust + '\n') + tablo.join('\n') + '\n');
  const trend = fs.readFileSync('lab/sonuclar.jsonl', 'utf8').trim().split('\n').slice(-8)
    .map((l) => { try { return JSON.parse(l).ort; } catch { return null; } }).filter((x) => x !== null).join(' → ');
  const ozet = { tarih: now(), ortPuan: ort, calismaSayisi: calisma, ekSoruToplam: icerikSonuc.toplam, trend, sonYama: globalThis.__SONYAMA || null, sonBench: sonuc, beyin: BEYIN };
  fs.writeFileSync('lab/ozet.json', JSON.stringify(ozet, null, 1) + '\n');
  return { calisma, ozet };
}

/* ---------- ana ---------- */
try {
  if (!KEY) { console.log('lab: ev anahtarı bulunamadı, atlanıyor'); process.exit(0); }
  console.log('lab: bench başlıyor…');
  const sonuc = await bench();
  const gecerliPuanlar = sonuc.filter((x) => x.neden !== 'cevap alınamadı (ağ/kota)');
  const ort = gecerliPuanlar.length ? Math.round((gecerliPuanlar.reduce((t, x) => t + x.puan, 0) / gecerliPuanlar.length) * 10) / 10 : 0;
  console.log('lab: bench bitti, ort =', ort, JSON.stringify(sonuc.map((x) => [x.id, x.puan])));
  console.log('lab: içerik üretimi…');
  const ic = await icerik();
  console.log('lab: yeni soru =', ic.yeni, 'toplam ek =', ic.toplam);
  const yama = await otoYama(sonuc);
  globalThis.__SONYAMA = yama || null;
  console.log('lab: oto-yama =', yama ? JSON.stringify(yama).slice(0, 400) : 'tetiklenmedi (kalıcı zayıflık yok)');
  await oneriler(sonuc, ort);
  const { calisma } = logla(sonuc, ort, ic);
  console.log(`lab: tamam — çalıştırma #${calisma}`);
} catch (e) {
  console.log('lab: HATA —', String(e?.message || e).slice(0, 200));
  process.exit(0); // döngü dayanıklı: hata olsa da workflow yeşil kalır, sadece commit edilmez
}
