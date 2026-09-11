// src/learn.js — ÖĞRENME KOÇU
// Spaced repetition (Leitner/SM-2 karışımı) + LLM ile soru üretme ve cevap değerlendirme.
// Kullanıcının yanlışlarına göre hem tekrar aralığı hem zorluk otomatik ayarlanır.
import { all, insert, update, getSettings } from './db.js';
import { chat, chatJSON, activeProvider } from './llm.js';
import { upsertSkill } from './evolve.js';

const LEVELS = ['Çok kolay', 'Kolay', 'Orta', 'Zor', 'Çok zor'];
const BASE_INTERVALS_HOURS = [4, 12, 24, 72, 168, 336]; // doğru cevapladıkça uzar

export function cards() {
  return all('cards').slice().sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0));
}

export function dueCards(limit = 10) {
  const t = Date.now();
  return cards().filter((c) => new Date(c.dueAt || 0).getTime() <= t).slice(0, limit);
}

export function createCard({ topic, level = 3, question, answer, source = 'user', difficulty = 3 }) {
  return insert('cards', {
    topic,
    level,               // kullanıcının konudaki seviyesi 1-5
    difficulty,          // kartın zorluğu 1-5
    question,
    answer,
    source,              // user | ai
    box: 0,              // Leitner kutusu
    lapses: 0,
    reviews: 0,
    correct: 0,
    dueAt: new Date().toISOString(),
    lastReviewedAt: null,
  });
}

export async function generateCards({ topic, count = 5, level = 3 }) {
  if (activeProvider().id === 'demo') {
    return { demo: true, cards: [], message: 'Soru üretmek için ücretsiz bir API anahtarı gerekiyor (Ayarlar).' };
  }
  const difficultyLabel = LEVELS[Math.max(0, Math.min(4, (level | 0) - 1))] || 'Orta';
  const sys = `Sen bir sınav hazırlayıcısısın. Verilen konu ve seviyeye göre ${count} adet özgün soru üret.
Yanıtları SADECE JSON olarak ver:
{"cards":[{"question":"...","answer":"...","explanation":"...","type":"multiple|open"}]}
- "multiple" türünde question içine 4 şık (A/B/C/D) gömülü olsun ve answer doğru şıkkın harfi + açıklaması olsun.
- Türkçe yaz. Seviye: ${difficultyLabel}.`;
  const data = await chatJSON(
    [
      { role: 'system', content: sys },
      { role: 'user', content: `Konu: ${topic}\nAdet: ${count}\nSeviye: ${difficultyLabel}` },
    ],
    { temperature: 0.8, maxTokens: 3000 }
  );
  const created = [];
  for (const c of data?.cards || []) {
    if (!c?.question) continue;
    created.push(
      createCard({
        topic,
        level,
        question: c.question,
        answer: c.answer || '',
        source: 'ai',
        difficulty: level,
        explanation: c.explanation || '',
      })
    );
  }
  return { cards: created };
}

export async function gradeAnswer({ cardId, userAnswer }) {
  const card = all('cards').find((c) => c.id === cardId);
  if (!card) throw new Error('Kart bulunamadı');

  let verdict;
  if (activeProvider().id === 'demo') {
    const ok = normalize(userAnswer) === normalize(card.answer);
    verdict = { correct: ok, score: ok ? 1 : 0, feedback: 'Demo modu: sadece birebir eşleşme kontrol edilir.' };
  } else {
    verdict = await chatJSON(
      [
        {
          role: 'system',
          content: `Sen adil bir değerlendiricisin. Kullanıcının cevabını doğru cevaba göre puanla.
SADECE JSON döndür: {"correct":true|false,"score":0.0-1.0,"feedback":"2 cümlelik Türkçe açıklama"}`,
        },
        {
          role: 'user',
          content: `SORU: ${card.question}\nDOĞRU CEVAP: ${card.answer}\nKULLANICININ CEVABI: ${userAnswer}`,
        },
      ],
      { temperature: 0.1, maxTokens: 300 }
    ) || { correct: false, score: 0, feedback: 'Değerlendirme alınamadı.' };
  }

  // Aralıklı tekrar güncellemesi
  let box = card.box || 0;
  if (verdict.correct) box = Math.min(BASE_INTERVALS_HOURS.length - 1, box + 1);
  else box = 0;

  const hours = BASE_INTERVALS_HOURS[box];
  // Zorluk uyarlama: yanlışsa zorluk düşer, üst üste doğruysa artar
  let difficulty = card.difficulty || 3;
  if (!verdict.correct) difficulty = Math.max(1, difficulty - 1);
  else if ((verdict.score ?? 0) >= 0.9) difficulty = Math.min(5, difficulty + (box >= 2 ? 1 : 0));

  const dueAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const updatedCard = update('cards', cardId, {
    box,
    difficulty,
    dueAt,
    reviews: (card.reviews || 0) + 1,
    correct: (card.correct || 0) + (verdict.correct ? 1 : 0),
    lapses: (card.lapses || 0) + (verdict.correct ? 0 : 1),
    lastReviewedAt: new Date().toISOString(),
  });

  // Beceri haritasını da güncelle (kendini geliştirme bunu kullanır)
  const topicRows = all('cards').filter((c) => c.topic === card.topic);
  const accuracy = topicRows.length
    ? topicRows.reduce((s, c) => s + (c.reviews ? c.correct / c.reviews : 0), 0) / topicRows.length
    : 0.5;
  const level = Math.max(1, Math.min(5, Math.round(1 + accuracy * 4)));
  upsertSkill(card.topic, level, `Doğruluk %${Math.round(accuracy * 100)}`);

  insert('reviews', {
    cardId,
    topic: card.topic,
    correct: !!verdict.correct,
    score: verdict.score ?? 0,
    userAnswer,
    nextDueAt: dueAt,
  });

  return { ...verdict, card: updatedCard, nextInHours: hours };
}

export async function makePlan({ goal, minutesPerDay = 20 }) {
  if (activeProvider().id === 'demo') {
    return { demo: true, plan: `Demo modu: "${goal}" için gerçek plan üretilemedi. Ücretsiz anahtar ekle.` };
  }
  const skills = all('skills');
  const weak = skills.filter((s) => s.level <= 2).map((s) => s.topic);
  const text = await chat(
    [
      {
        role: 'system',
        content: `Sen kişisel bir öğrenme koçusun. Türkçe, madde işaretli, uygulanabilir bir 7 günlük plan yaz.
Günlük süre: ${minutesPerDay} dakika. Kullanıcının zayıf konuları: ${weak.join(', ') || 'bilinmiyor'}.`,
      },
      { role: 'user', content: `Hedefim: ${goal}` },
    ],
    { temperature: 0.7, maxTokens: 800 }
  );
  insert('evolutions', {
    type: 'plan',
    summary: `Öğrenme planı oluşturuldu: ${goal}`,
    detail: text.slice(0, 400),
    applied: true,
    confidence: 1,
  });
  return { plan: text };
}

export function learningStats() {
  const reviews = all('reviews');
  const c = all('cards');
  const total = reviews.length;
  const correct = reviews.filter((r) => r.correct).length;
  return {
    cards: c.length,
    due: dueCards(1000).length,
    reviews: total,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    topics: [...new Set(c.map((x) => x.topic))].length,
  };
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?;:]/g, '').trim();
}
