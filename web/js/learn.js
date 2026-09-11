/* js/learn.js — ÖĞRENME KOÇU (tarayıcıda aralıklı tekrar + AI soru üretme/puanlama) */
import { all, insert, update, remove } from './store.js';
import { chat, chatJSON, isReady } from './llm.js';
import { upsertSkill } from './evolve.js';

const LEVELS = ['Çok kolay', 'Kolay', 'Orta', 'Zor', 'Çok zor'];
const INTERVALS_H = [4, 12, 24, 72, 168, 336];

export const cards = () => all('cards').slice().sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0));

export function dueCards(limit = 50) {
  const t = Date.now();
  return cards().filter((c) => new Date(c.dueAt || 0).getTime() <= t).slice(0, limit);
}

export function createCard({ topic, level = 3, question, answer, explanation = '', source = 'user', difficulty = 3 }) {
  return insert('cards', {
    topic, level, difficulty, question, answer, explanation, source,
    box: 0, lapses: 0, reviews: 0, correct: 0,
    dueAt: new Date().toISOString(), lastReviewedAt: null,
  });
}

export const deleteCard = (id) => remove('cards', id);

export async function generateCards({ topic, count = 5, level = 3 }) {
  if (!isReady()) return { cards: [], message: 'Soru üretmek için Ayarlar’dan ücretsiz anahtar gir.' };
  const diff = LEVELS[Math.max(0, Math.min(4, (level | 0) - 1))] || 'Orta';
  const data = await chatJSON(
    [
      {
        role: 'system',
        content: `Sen bir sınav hazırlayıcısısın. Verilen konu ve seviyeye göre ${count} özgün soru üret.
SADECE JSON döndür: {"cards":[{"question":"...","answer":"...","explanation":"..."}]}
- multiple choice olsun: question içinde 4 şık (A/B/C/D) bulunsun, answer doğru şıkkın harfi + kısa açıklama olsun.
- Türkçe yaz. Seviye: ${diff}.`,
      },
      { role: 'user', content: `Konu: ${topic}\nAdet: ${count}\nSeviye: ${diff}` },
    ],
    { temperature: 0.8, maxTokens: 3000 }
  );
  const created = [];
  for (const c of data?.cards || []) {
    if (!c?.question) continue;
    created.push(createCard({
      topic, level, question: c.question, answer: c.answer || '',
      explanation: c.explanation || '', source: 'ai', difficulty: level,
    }));
  }
  return { cards: created };
}

export async function gradeAnswer({ cardId, userAnswer }) {
  const card = all('cards').find((c) => c.id === cardId);
  if (!card) throw new Error('Kart bulunamadı');

  let verdict;
  if (!isReady()) {
    const ok = norm(userAnswer) === norm(card.answer);
    verdict = { correct: ok, score: ok ? 1 : 0, feedback: 'Anahtar girilmedi: sadece birebir eşleşme kontrol edildi.' };
  } else {
    verdict = (await chatJSON(
      [
        {
          role: 'system',
          content: `Sen adil bir değerlendiricisin. Kullanıcının cevabını doğru cevaba göre puanla.
SADECE JSON: {"correct":true|false,"score":0.0-1.0,"feedback":"2 cümlelik Türkçe açıklama"}`,
        },
        { role: 'user', content: `SORU: ${card.question}\nDOĞRU CEVAP: ${card.answer}\nKULLANICININ CEVABI: ${userAnswer}` },
      ],
      { temperature: 0.1, maxTokens: 300 }
    )) || { correct: false, score: 0, feedback: 'Değerlendirme alınamadı.' };
  }

  let box = card.box || 0;
  box = verdict.correct ? Math.min(INTERVALS_H.length - 1, box + 1) : 0;
  const hours = INTERVALS_H[box];

  let difficulty = card.difficulty || 3;
  if (!verdict.correct) difficulty = Math.max(1, difficulty - 1);
  else if ((verdict.score ?? 0) >= 0.9 && box >= 2) difficulty = Math.min(5, difficulty + 1);

  const dueAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const updated = update('cards', cardId, {
    box, difficulty, dueAt,
    reviews: (card.reviews || 0) + 1,
    correct: (card.correct || 0) + (verdict.correct ? 1 : 0),
    lapses: (card.lapses || 0) + (verdict.correct ? 0 : 1),
    lastReviewedAt: new Date().toISOString(),
  });

  // Beceri haritasını güncelle
  const topicCards = all('cards').filter((c) => c.topic === card.topic);
  const acc = topicCards.length
    ? topicCards.reduce((s, c) => s + (c.reviews ? c.correct / c.reviews : 0), 0) / topicCards.length
    : 0.5;
  upsertSkill(card.topic, Math.max(1, Math.min(5, Math.round(1 + acc * 4))), `Doğruluk %${Math.round(acc * 100)}`);

  insert('reviews', { cardId, topic: card.topic, correct: !!verdict.correct, score: verdict.score ?? 0, userAnswer, nextDueAt: dueAt });
  return { ...verdict, card: updated, nextInHours: hours };
}

export async function makePlan({ goal, minutesPerDay = 20 }) {
  if (!isReady()) return { plan: 'Plan üretmek için Ayarlar’dan ücretsiz anahtar gir.' };
  const weak = all('skills').filter((s) => s.level <= 2).map((s) => s.topic);
  const plan = await chat(
    [
      {
        role: 'system',
        content: `Sen kişisel bir öğrenme koçusun. Türkçe, madde işaretli, uygulanabilir bir 7 günlük plan yaz.
Günlük süre: ${minutesPerDay} dakika. Zayıf konular: ${weak.join(', ') || 'bilinmiyor'}. Kısa tut.`,
      },
      { role: 'user', content: `Hedefim: ${goal}` },
    ],
    { temperature: 0.7, maxTokens: 900 }
  );
  insert('evolutions', { type: 'plan', summary: `Öğrenme planı: ${goal}`, detail: plan.slice(0, 300), applied: true, confidence: 1 });
  return { plan };
}

export function learningStats() {
  const reviews = all('reviews');
  const c = all('cards');
  const correct = reviews.filter((r) => r.correct).length;
  return {
    cards: c.length,
    due: dueCards(1000).length,
    reviews: reviews.length,
    accuracy: reviews.length ? Math.round((correct / reviews.length) * 100) : 0,
    topics: [...new Set(c.map((x) => x.topic))].length,
  };
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?;:]/g, '').trim();
}
