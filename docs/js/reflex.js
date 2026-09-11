/* js/reflex.js — REFLEKS KATMANI (v26): beyin bağlı olmasa bile ANINDA cevap.
   Selamlaşma / small-talk / saat-tarih / basit matematik: 0 ms, çevrimdışı, indirme yok.
   Bilgi sorusuysa null döner → gerçek beyin zinciri devralır. Sessizlik yasak. */

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function mathEval(t) {
  const s = String(t).replace(/x/gi, '*').replace(/,/g, '.').replace(/\s+/g, '');
  if (!/^[-+*/().\d]+$/.test(s) || !/\d/.test(s) || !/[-+*/]/.test(s)) return null;
  try {
    const v = Function('"use strict";return(' + s + ')')();
    if (typeof v === 'number' && isFinite(v)) return Math.round(v * 1e6) / 1e6;
  } catch {}
  return null;
}

export function reflexAnswer(text, ctx = {}) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || t.length > 160) return null;
  const name = ctx.userName ? ` ${ctx.userName}` : '';

  /* --- selamlaşma --- */
  if (/^(merhaba|selam|hey|hi|hello|slaam|selamün|günaydın|iyi akşamlar|iyi geceler|hayırlı)(lar| bey|can| can| dostum)?[.! ]*$/.test(t)) {
    return pick([
      `Merhaba${name}! 👋 Ben EVRIM — kendi kendini geliştiren asistanın. Bugün ne yapalım: plan mı, pratik mi, araştırma mı?`,
      `Selam${name}! ⚡ Buradayım ve hazırım. Sorunu yaz, hemen işe koyulayım.`,
      `Hey${name}! 🧠 Ben EVRIM. Konuşabilir, planlayabilir, web okuyabilir, görsel üretebilirim — ne lazım?`,
    ]);
  }

  /* --- hâl hatır --- */
  if (/^(nasılsın|naber|ne haber|nasilsin|how are you|iyi misin)[?! ]*$/.test(t)) {
    return pick([
      'Formdayım! ⚡ Her soru beni biraz daha geliştiriyor — sen nasılsın, günün nasıl geçiyor?',
      'İyiyim, teşekkürler 🧡 Hafızam taze, motivasyonum tam. Senden ne haber?',
    ]);
  }

  /* --- kimlik --- */
  if (/(kimsin|nesin|sen kimsin|adın ne|adin ne|what are you|who are you)/.test(t) && t.length < 40) {
    return 'Ben EVRIM 🧠 — kendini sürekli geliştiren bir yapay zeka asistanıyım. Konuşmalarımdan öğrenir, araçlar kullanır (web okuma, görsel üretme, API kataloğu), geri bildirimlerini kural yaparım. Tamamen ücretsiz ve anahtarsız çalışırım.';
  }

  /* --- yetenekler / yardım --- */
  if (/(ne yapabilirsin|yardım|yardim|help|neler bilirsin|özelliklerin|ozelliklerin)/.test(t) && t.length < 50) {
    return 'Yapabildiklerim 🧰:\n• Sorularını yanıtlar, plan ve günlük program çıkarırım\n• Link/web sayfası okur ve özetlerim (🌍 web_oku)\n• Görsel üretirim (🎨)\n• Mülakat/pratik koçluğu, durum raporu, hafıza günlüğü\n• Basit hesap ve saat/tarih anında: "2+2", "saat kaç"\nSorunu yazman yeterli — gerisini ben wire ederim.';
  }

  /* --- teşekkür / veda --- */
  if (/(teşekkür|tesekkur|sağol|sagol|thanks|eyvallah)/.test(t) && t.length < 30) return 'Rica ederim 🧡 Başka bir şey lazımsa buradayım.';
  if (/(görüşürüz|gorusuruz|bay bay|bye|iyi geceler|hoşça kal|hosca kal)/.test(t) && t.length < 30) return 'Görüşürüz 👋 Konuşmamız hafızamda — kaldığımız yerden devam ederiz.';

  /* --- saat / tarih --- */
  if (/(saat kaç|saat kac|şu an saat|tarih|bugün ayın kaçı|bugun ayin kaci|hangi gün|hangi gun|what time)/.test(t) && t.length < 40) {
    const d = new Date();
    return `🕒 ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · 📅 ${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })}`;
  }

  /* --- basit matematik --- */
  const m = mathEval(t.replace(/\?$/g, '').replace(/kaç eder|kaç yapar|equal?s?/gi, ''));
  if (m !== null) return `= ${m} ✅ (hesap anında, beyin bile gerekmedi)`;

  return null; // gerçek beyin zinciri devralır
}
