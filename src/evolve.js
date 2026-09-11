// src/evolve.js — ÖZ-GELİŞİM DÖNGÜSÜ
// Her asistan yanıtından sonra çalışır:
//  1) Kullanıcı hakkında kalıcı olması gereken bilgileri (hafıza) çıkarır
//  2) Kendi sistem promptuna eklenmesi gereken yeni bir kural önerir (yamalar)
//  3) Kullanıcının beceri haritasını günceller
// Güven eşiğinin altındaki yamalar "öneri" olarak bekler, kullanıcı onaylar.
import {
  all, insert, update, remove, getSettings, updateSettings,
  currentPrompt, pushPromptVersion, now,
} from './db.js';
import { chatJSON, chat, activeProvider } from './llm.js';

const MAX_ACTIVE_MEMORIES = 40;

export function memories(kind) {
  const rows = all('memories');
  const filtered = kind ? rows.filter((m) => m.kind === kind) : rows;
  return filtered.slice().sort((a, b) => (b.strength || 0) - (a.strength || 0));
}

export function addMemory({ content, kind = 'fact', source = 'auto', strength = 0.6, tags = [] }) {
  const rows = all('memories');
  const norm = (content || '').trim();
  if (!norm) return null;
  // Aynı içerik varsa güçlendir (pekiştirme)
  const existing = rows.find(
    (m) => m.content.toLowerCase() === norm.toLowerCase() && m.archived !== true
  );
  if (existing) {
    return update('memories', existing.id, {
      strength: Math.min(1, (existing.strength || 0.5) + 0.15),
      hits: (existing.hits || 0) + 1,
      lastSeenAt: now(),
      source,
    });
  }
  return insert('memories', {
    content: norm,
    kind,               // fact | preference | skill | mistake | rule
    source,             // auto | user | feedback
    strength,
    tags,
    hits: 1,
    lastSeenAt: now(),
    archived: false,
  });
}

export function forgetMemory(id) {
  return remove('memories', id);
}

export function archiveMemory(id) {
  return update('memories', id, { archived: true });
}

export function recordFeedback({ messageId, value, comment }) {
  const msg = all('messages').find((m) => m.id === messageId);
  if (msg) update('messages', messageId, { feedback: value, feedbackComment: comment || '' });
  insert('evolutions', {
    type: 'feedback',
    summary: value > 0 ? 'Kullanıcı olumlu geri bildirim verdi' : 'Kullanıcı olumsuz geri bildirim verdi',
    detail: comment || (msg ? String(msg.content).slice(0, 200) : ''),
    applied: true,
    confidence: 1,
    createdAt: now(),
  });
  if (value < 0) {
    addMemory({
      content: `Beğenilmeyen yanıt türü: ${comment || (msg ? String(msg.content).slice(0, 120) : 'belirtilmedi')}`,
      kind: 'mistake',
      source: 'feedback',
      strength: 0.75,
    });
  }
  return { ok: true };
}

/** Sistemin şu anki kişiliğini oluşturan tam prompt */
export function buildSystemPrompt() {
  const base = currentPrompt();
  const s = getSettings();
  const active = memories().filter((m) => !m.archived).slice(0, MAX_ACTIVE_MEMORIES);

  const facts = active.filter((m) => m.kind === 'fact');
  const prefs = active.filter((m) => m.kind === 'preference');
  const skills = active.filter((m) => m.kind === 'skill');
  const mistakes = active.filter((m) => m.kind === 'mistake');
  const rules = active.filter((m) => m.kind === 'rule');

  const lines = [base.text, ''];
  if (s.userName) lines.push(`Kullanıcının adı: ${s.userName}.`);
  lines.push(`Bugünün tarihi: ${new Date().toLocaleDateString('tr-TR', { dateStyle: 'full' })}`);

  const section = (title, rows, map = (r) => r.content) => {
    if (!rows.length) return;
    lines.push('');
    lines.push(`## ${title}`);
    rows.forEach((r) => lines.push(`- ${map(r)}`));
  };

  section('HAFIZA — Kullanıcı hakkında bildiklerin', facts, (r) => `${r.content} (güven ${(r.strength * 100) | 0}%)`);
  section('TERCİHLER', prefs);
  section('BECERİ HARİTASI (öğrenme koçu için)', skills, (r) =>
    `${r.content}${r.level ? ` — seviye ${r.level}/5` : ''}`);
  section('GEÇMİŞ HATALAR / KAÇINILACAKLAR', mistakes);
  section('ÖĞRENİLMİŞ EK KURALLAR', rules);

  if (s.githubRepo) {
    lines.push('');
    lines.push(`## BAĞLI GİTHUB REPOSU: ${s.githubRepo} (dal: ${s.githubBranch})`);
  }

  lines.push('');
  lines.push('Yanıtını verirken yukarıdaki hafızayı doğal şekilde kullan; "hafızamda şöyle yazıyor" diye tekrarlamak zorunda değilsin.');
  return lines.join('\n');
}

const EVOLVE_INSTRUCTION = `Sen bu sistemin "meta-öğrenme" modülüsün. Aşağıda bir kullanıcı-asistan diyaloğu var.
Görevin, JSON olarak şunları üretmek:

{
  "memories": [{"content":"kısa ve net bilgi", "kind":"fact|preference|skill|mistake|rule", "strength":0.0-1.0}],
  "promptPatch": "asistanın bir dahaki sefere daha iyi olması için sistem promptuna EKLENECEK tek bir kural (yoksa null)",
  "patchReason": "bu kuralın nedeni (yoksa null)",
  "confidence": 0.0-1.0,
  "skills": [{"topic":"konu", "level":1-5, "note":"kısa değerlendirme"}]
}

KURALLAR:
- TÜM metin alanlarını (content, promptPatch, patchReason, note) TÜRKÇE yaz. İngilizce yazmak yasaktır.
  Örnek: {"content":"Kullanıcının adı Ahmet","kind":"fact","strength":0.9}
  Örnek: {"content":"Kısa ve maddeli cevapları tercih ediyor","kind":"preference","strength":0.95}
- Sadece gerçekten kalıcı/değerli bilgileri yaz. Selamlaşma, geçici sorular -> memories: []
- "content" alanı 140 karakteri geçmesin, tek cümle olsun.
- promptPatch yalnızca diyaloğa bakarak açık bir eksiklik/iyileştirme görüyorsan üret; emin değilsen null.
  Kullanıcı biçim/üslup konusunda bir istek belirttiyse (örn. "kısa yaz", "Türkçe cevap ver", "kod örneği ver")
  bu mutlaka bir promptPatch olmalıdır.
- confidence: promptPatch'in ne kadar gerekli olduğuna dair güvenin.
- Başka hiçbir metin üretme, sadece JSON.`;

/** Sohbet sonrası öz-gelişim tetikleyicisi (arka planda çalışır, kullanıcıyı bekletmez) */
export async function evolveAfterTurn({ conversationId, userText, assistantText, messageId }) {
  const s = getSettings();
  if (!s.selfEvolution) return { skipped: 'selfEvolution kapalı' };
  if (activeProvider().id === 'demo') return { skipped: 'demo modu' };

  try {
    const result = await chatJSON(
      [
        { role: 'system', content: EVOLVE_INSTRUCTION },
        {
          role: 'user',
          content: `KULLANICI: ${userText}\n\nASİSTAN: ${assistantText}`,
        },
      ],
      { temperature: 0.2, maxTokens: 1400 }
    );

    if (!result) return { skipped: 'model JSON döndürmedi' };

    const created = [];
    for (const m of result.memories || []) {
      if (!m?.content) continue;
      const mem = addMemory({
        content: m.content,
        kind: ['fact', 'preference', 'skill', 'mistake', 'rule'].includes(m.kind) ? m.kind : 'fact',
        source: 'auto',
        strength: clamp(m.strength ?? 0.6),
      });
      if (mem) created.push(mem);
    }

    for (const sk of result.skills || []) {
      if (!sk?.topic) continue;
      upsertSkill(sk.topic, sk.level ?? 3, sk.note || '');
    }

    let patchStatus = 'none';
    const threshold = s.evolveThreshold ?? 0.6;
    const conf = clamp(result.confidence ?? 0);

    if (result.promptPatch && String(result.promptPatch).trim()) {
      const patchText = String(result.promptPatch).trim();
      if (conf >= threshold) {
        const base = currentPrompt();
        const next = `${base.text}\n\n## ÖĞRENİLMİŞ KURAL v${(base.version || 1) + 1}\n- ${patchText}`;
        const version = pushPromptVersion({
          text: next,
          reason: result.patchReason || 'Otomatik öz-gelişim',
          source: 'self',
          patch: patchText,
        });
        insert('evolutions', {
          type: 'prompt-patch',
          summary: patchText,
          detail: result.patchReason || '',
          confidence: conf,
          applied: true,
          promptVersion: version.version,
          promptId: version.id,
          conversationId,
          messageId,
        });
        patchStatus = `applied (v${version.version})`;
      } else {
        const evo = insert('evolutions', {
          type: 'prompt-patch',
          summary: patchText,
          detail: result.patchReason || '',
          confidence: conf,
          applied: false,
          conversationId,
          messageId,
        });
        patchStatus = `pending (güven ${conf.toFixed(2)} < eşik ${threshold})`;
        evo.pendingId = evo.id;
      }
    }

    if (created.length) {
      insert('evolutions', {
        type: 'memory',
        summary: `${created.length} yeni hafıza kaydı`,
        detail: created.map((c) => c.content).join(' | ').slice(0, 500),
        confidence: conf,
        applied: true,
        conversationId,
      });
    }

    return { memories: created.length, patch: patchStatus, confidence: conf };
  } catch (err) {
    insert('evolutions', {
      type: 'error',
      summary: 'Öz-gelişim döngüsü hatası',
      detail: err.message,
      applied: false,
      confidence: 0,
    });
    return { error: err.message };
  }
}

/** Bekleyen bir yamayı kullanıcı onaylarsa uygula */
export function approveEvolution(id) {
  const evo = all('evolutions').find((e) => e.id === id);
  if (!evo || evo.applied) return null;
  const base = currentPrompt();
  const next = `${base.text}\n\n## ÖĞRENİLMİŞ KURAL v${(base.version || 1) + 1} (onaylandı)\n- ${evo.summary}`;
  const version = pushPromptVersion({
    text: next,
    reason: evo.detail || 'Kullanıcı onayıyla uygulandı',
    source: 'approved',
    patch: evo.summary,
  });
  update('evolutions', id, { applied: true, promptVersion: version.version, promptId: version.id });
  return version;
}

export function rejectEvolution(id) {
  return update('evolutions', id, { applied: false, rejected: true });
}

/** Beceri haritası (öğrenme koçu bunu kullanır) */
export function upsertSkill(topic, level, note) {
  const rows = all('skills');
  const key = topic.toLowerCase().trim();
  const existing = rows.find((s) => (s.topic || '').toLowerCase().trim() === key);
  if (existing) {
    const newLevel = clampLevel(level);
    return update('skills', existing.id, {
      topic,
      level: newLevel,
      note: note || existing.note,
      updatedAt: now(),
    });
  }
  return insert('skills', { topic, level: clampLevel(level), note: note || '' });
}

export function stats() {
  const mem = all('memories').filter((m) => !m.archived);
  return {
    memories: mem.length,
    byKind: mem.reduce((acc, m) => ({ ...acc, [m.kind]: (acc[m.kind] || 0) + 1 }), {}),
    promptVersion: currentPrompt().version,
    evolutions: all('evolutions').length,
    pendingPatches: all('evolutions').filter((e) => e.type === 'prompt-patch' && !e.applied && !e.rejected).length,
    skills: all('skills').length,
    cards: all('cards').length,
    messages: all('messages').length,
    selfEvolution: getSettings().selfEvolution,
    provider: activeProvider().id,
    model: (() => { try { return activeProvider().id; } catch { return 'demo'; } })(),
  };
}

function clamp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.6;
  return Math.max(0, Math.min(1, n));
}
function clampLevel(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, n));
}
