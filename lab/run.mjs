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
  for (const b of sorular) {
    let cevap = await groq(BEYIN, [
      { role: 'system', content: basePrompt() + '\n(Not: bu oturumda araçların yok — hesabı dikkatle kendin yap.)' },
      { role: 'user', content: b.soru },
    ], { temp: 0, max: 3500 });
    if (!cevap) {   // CI'da kota/ağ dalgalanması: bir tekrar (20 sn sonra)
      await new Promise((z) => setTimeout(z, 20000));
      cevap = await groq(BEYIN, [
        { role: 'system', content: basePrompt() + '\n(Not: bu oturumda araçların yok — hesabı dikkatle kendin yap.)' },
        { role: 'user', content: b.soru },
      ], { temp: 0, max: 3500 });
    }
    if (!cevap) { sonuc.push({ id: b.id, puan: 0, neden: 'cevap alınamadı (ağ/kota)' }); continue; }
    const juriIstek = [
      { role: 'system', content: 'Acımasız ama adil jürisin. Yalnızca TEK satır JSON yaz, başka hiçbir şey yazma: {"puan": <0-10 tam sayı>, "neden": "<1 cümle>"}' },
      { role: 'user', content: `Soru: ${b.soru}\nBeklenen ölçüt: ${b.beklenti}\n\nCevap (kırpılmış olabilir):\n${cevap.slice(0, 1200)}` },
    ];
    // jüri modeli 20b (reasoning LOW): compound küçük gövdede bile 413/429 verebiliyor (canlı doğrulandı)
    let p = puanCikar(await groq('openai/gpt-oss-20b', juriIstek, { temp: 0, max: 800, reason: 'low' }));
    if (!p) p = puanCikar(await groq('openai/gpt-oss-20b', juriIstek, { temp: 0, max: 800, reason: 'low' }));   // bir tekrar
    sonuc.push({ id: b.id, puan: p?.puan ?? 0, neden: p?.neden || 'jüri parse edilemedi' });
  }
  return sonuc;
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
    { role: 'user', content: `Bench ortalaması: ${ort}/10.\nDüşük puanlılar:\n${dusukler}\n\nEVRIM: tarayıcıda çalışan, ücretsiz, mobil öncelikli, araç çağırabilen (37 araç), hafızalı, RAG destekli Türkçe AI asistanı. Beyin: gpt-oss-120b (reasoning high) + groq/compound eleştirmen. Buna göre 3-5 SOMUT, ücretsiz yapılabilir iyileştirme öner — her biri tek satır, "- " ile başla, kod/değişiklik önerisi düzeyinde somut olsun.` },
  ], { temp: 0.5, max: 500 });
  if (t) fs.writeFileSync('lab/ONERILER.md', `# 💡 Lab Önerileri\n\n_Son güncelleme: ${now()} — bench ortalaması ${ort}/10_\n\n${t.trim()}\n`);
}

/* ---------- günlük + özet ---------- */
function logla(sonuc, ort, icerikSonuc) {
  fs.appendFileSync('lab/sonuclar.jsonl', JSON.stringify({ t: now(), beyin: BEYIN, ort, yeniSoru: icerikSonuc.yeni, sorular: sonuc.map((x) => [x.id, x.puan]) }) + '\n');
  const calisma = fs.readFileSync('lab/sonuclar.jsonl', 'utf8').trim().split('\n').length;
  const satir = `| ${now().slice(0, 16).replace('T', ' ')} | ${ort}/10 | +${icerikSonuc.yeni} | ${sonuc.map((x) => `${x.id.split('-')[0]}:${x.puan}`).join(' ')} |`;
  let md = fs.existsSync('lab/ARASTIRMA.md') ? fs.readFileSync('lab/ARASTIRMA.md', 'utf8') : '';
  const baslik = '# 🔬 EVRIM Araştırma Günlüğü\n\n7/24 otomatik döngü (GitHub Actions, 6 saatte bir): bench + jüri puanı + yeni quiz + öneriler.\n\n| Çalışma (UTC) | Bench ort. | Yeni soru | Detay |\n|---|---|---|---|\n';
  if (!md.includes('| Çalışma (UTC) |')) md = baslik;
  const govde = md.split('\n').filter((l) => l.startsWith('| '));
  const ust = md.slice(0, md.indexOf('| Çalışma (UTC) |') >= 0 ? md.indexOf('| Çalışma (UTC) |') : md.length);
  const tablo = [...govde.slice(0, 1), satir, ...govde.slice(1)].slice(0, 62);   // başlık satırından sonra EN ÜSTE ekle (kronolojik)
  fs.writeFileSync('lab/ARASTIRMA.md', (ust.endsWith('\n') || ust === '' ? ust : ust + '\n') + tablo.join('\n') + '\n');
  const ozet = { tarih: now(), ortPuan: ort, calismaSayisi: calisma, ekSoruToplam: icerikSonuc.toplam, sonBench: sonuc, beyin: BEYIN };
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
  await oneriler(sonuc, ort);
  const { calisma } = logla(sonuc, ort, ic);
  console.log(`lab: tamam — çalıştırma #${calisma}`);
} catch (e) {
  console.log('lab: HATA —', String(e?.message || e).slice(0, 200));
  process.exit(0); // döngü dayanıklı: hata olsa da workflow yeşil kalır, sadece commit edilmez
}
