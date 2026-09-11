/* js/evolve.js — ÖZ-GELİŞİM DÖNGÜSÜ (tarayıcıda)
   Her yanıttan sonra: hafıza çıkarır, beynin kuralını yamalar, beceri haritasını günceller. */
import {
  all, insert, update, remove, getSettings, currentPrompt, pushPromptVersion, now,
  BASE_PROMPT, COMPACT_PROMPT,
} from './store.js';
import { chatJSON, isReady, active as activeLLM } from './llm.js';

const MAX_ACTIVE_MEMORIES = 40;
const KINDS = ['fact', 'preference', 'skill', 'mistake', 'rule'];

export function memories(kind) {
  const list = all('memories').filter((m) => !m.archived);
  const filtered = kind ? list.filter((m) => m.kind === kind) : list;
  return filtered.sort((a, b) => (b.strength || 0) - (a.strength || 0));
}

export function addMemory({ content, kind = 'fact', source = 'auto', strength = 0.6 }) {
  const norm = String(content || '').trim().slice(0, 200);
  if (!norm) return null;
  const existing = all('memories').find(
    (m) => !m.archived && (m.content || '').toLowerCase() === norm.toLowerCase()
  );
  if (existing) {
    return update('memories', existing.id, {
      strength: Math.min(1, (existing.strength || 0.5) + 0.15),
      hits: (existing.hits || 0) + 1,
      lastSeenAt: now(),
    });
  }
  return insert('memories', {
    content: norm,
    kind: KINDS.includes(kind) ? kind : 'fact',
    source, strength: clamp(strength), hits: 1, lastSeenAt: now(), archived: false,
  });
}

export const forgetMemory = (id) => remove('memories', id);

export function recordFeedback({ messageId, value, comment }) {
  const m = all('messages').find((x) => x.id === messageId);
  if (m) update('messages', messageId, { feedback: value, feedbackComment: comment || '' });
  insert('evolutions', {
    type: 'feedback',
    summary: value > 0 ? 'Olumlu geri bildirim' : 'Olumsuz geri bildirim',
    detail: comment || (m ? String(m.content).slice(0, 180) : ''),
    applied: true, confidence: 1,
  });
  if (value < 0) {
    addMemory({
      content: `Beğenilmeyen yanıt: ${comment || (m ? String(m.content).slice(0, 100) : 'belirtilmedi')}`,
      kind: 'mistake', source: 'feedback', strength: 0.75,
    });
  }
  return { ok: true };
}

/** O anki kişilik + hafıza + beceriler -> tam sistem promptu */
export function buildSystemPrompt() {
  const a = activeLLM();
  // Küçük cihaz-içi model: uzun prompt onu boğar -> sade sürüm + az hafıza
  const tiny = a.id === 'local';
  const base = tiny ? { text: COMPACT_PROMPT } : currentPrompt();
  const s = getSettings();
  const active = memories().slice(0, tiny ? 8 : MAX_ACTIVE_MEMORIES);
  const by = (k) => active.filter((m) => m.kind === k);

  const out = [base.text, ''];
  if (tiny) {
    // sadece en kritik öğrenilmiş kurallar
    const rules = by('rule').slice(0, 4).map((r) => r.content);
    if (rules.length) out.push('', '## EK KURALLAR', ...rules.map((r) => `- ${r}`));
    if (s.userName) out.push(`Kullanıcının adı: ${s.userName}.`);
    out.push('', 'Kısa tut. Doğrudan cevap ver.');
    return out.join('\n');
  }
  if (s.userName) out.push(`Kullanıcının adı: ${s.userName}.`);
  out.push(`Bugünün tarihi: ${new Date().toLocaleDateString('tr-TR', { dateStyle: 'full' })}`);

  const section = (title, list, map = (r) => r.content) => {
    if (!list.length) return;
    out.push('', `## ${title}`);
    list.forEach((r) => out.push(`- ${map(r)}`));
  };

  section('HAFIZA — Kullanıcı hakkında bildiklerin', by('fact'), (r) => `${r.content} (güven ${(r.strength * 100) | 0}%)`);
  section('TERCİHLER', by('preference'));
  section('BECERİ HARİTASI (öğrenme koçu için)', by('skill'), (r) => `${r.content}${r.level ? ` — seviye ${r.level}/5` : ''}`);
  section('GEÇMİŞ HATALAR / KAÇINILACAKLAR', by('mistake'));
  section('ÖĞRENİLMİŞ EK KURALLAR', by('rule'));

  out.push('', 'Yanıtını verirken yukarıdaki hafızayı doğal şekilde kullan; "hafızamda şöyle yazıyor" diye tekrarlamak zorunda değilsin.');
  return out.join('\n');
}

const META_INSTRUCTION = `Sen bu sistemin "meta-öğrenme" modülüsün. Aşağıda bir kullanıcı-asistan diyaloğu var.
Görevin, JSON olarak şunları üretmek:

{
  "memories": [{"content":"kısa ve net bilgi", "kind":"fact|preference|skill|mistake|rule", "strength":0.0-1.0}],
  "promptPatch": "asistanın bir dahaki sefere daha iyi olması için sistem promptuna EKLENECEK tek bir kural (yoksa null)",
  "patchReason": "bu kuralın nedeni (yoksa null)",
  "confidence": 0.0-1.0,
  "skills": [{"topic":"konu", "level":1-5, "note":"kısa değerlendirme"}]
}

KURALLAR:
- TÜM metin alanlarını TÜRKÇE yaz. İngilizce yazmak yasaktır.
  Örnek: {"content":"Kullanıcının adı Ahmet","kind":"fact","strength":0.9}
- Sadece gerçekten kalıcı/değerli bilgileri yaz. Selamlaşma, geçici sorular -> memories: []
- "content" 140 karakteri geçmesin, tek cümle olsun.
- promptPatch'i yalnızca açık bir eksiklik/iyileştirme görüyorsan üret; emin değilsen null.
  Kullanıcı biçim/üslup konusunda istek belirttiyse (örn. "kısa yaz", "Türkçe cevap ver") bu MUTLAKA promptPatch olmalı.
- confidence: promptPatch'in ne kadar gerekli olduğuna dair güvenin.
- Başka hiçbir metin üretme, sadece JSON.`;

/** Sohbet sonrası öz-gelişim (async, arayüzü bloklamaz) */
export async function evolveAfterTurn({ conversationId, userText, assistantText, messageId }) {
  const s = getSettings();
  if (!s.selfEvolution) return { skipped: 'selfEvolution kapalı' };
  if (!isReady()) return { skipped: 'anahtar yok' };

  try {
    const r = await chatJSON(
      [
        { role: 'system', content: META_INSTRUCTION },
        { role: 'user', content: `KULLANICI: ${userText}\n\nASİSTAN: ${assistantText}` },
      ],
      { temperature: 0.2, maxTokens: 1400 }
    );
    if (!r) return { skipped: 'model JSON döndürmedi' };

    const created = [];
    for (const m of r.memories || []) {
      if (!m?.content) continue;
      const mem = addMemory({ content: m.content, kind: m.kind, source: 'auto', strength: m.strength ?? 0.6 });
      if (mem) created.push(mem);
    }
    for (const sk of r.skills || []) if (sk?.topic) upsertSkill(sk.topic, sk.level ?? 3, sk.note || '');

    let patchStatus = 'none';
    const threshold = Number(s.evolveThreshold ?? 0.6);
    const conf = clamp(r.confidence ?? 0);
    const patch = r.promptPatch ? String(r.promptPatch).trim() : '';

    if (patch) {
      const autoApply = s.autoApply !== false && conf >= threshold;
      if (autoApply) {
        const base = currentPrompt();
        const v = pushPromptVersion({
          text: `${base.text}\n\n## ÖĞRENİLMİŞ KURAL v${(base.version || 1) + 1}\n- ${patch}`,
          reason: r.patchReason || 'Otomatik öz-gelişim',
          source: 'self', patch,
        });
        insert('evolutions', {
          type: 'prompt-patch', summary: patch, detail: r.patchReason || '',
          confidence: conf, applied: true, promptVersion: v.version, promptId: v.id, conversationId, messageId,
        });
        patchStatus = `applied (v${v.version})`;
      } else {
        insert('evolutions', {
          type: 'prompt-patch', summary: patch, detail: r.patchReason || '',
          confidence: conf, applied: false, conversationId, messageId,
        });
        patchStatus = `pending (güven ${conf.toFixed(2)} < eşik ${threshold})`;
      }
    }

    if (created.length) {
      insert('evolutions', {
        type: 'memory',
        summary: `${created.length} yeni hafıza kaydı`,
        detail: created.map((c) => c.content).join(' | ').slice(0, 400),
        confidence: conf, applied: true, conversationId,
      });
    }
    return { memories: created.length, patch: patchStatus, confidence: conf };
  } catch (e) {
    insert('evolutions', { type: 'error', summary: 'Öz-gelişim döngüsü hatası', detail: e.message, applied: false, confidence: 0 });
    return { error: e.message };
  }
}

export function approveEvolution(id) {
  const e = all('evolutions').find((x) => x.id === id);
  if (!e || e.applied) return null;
  const base = currentPrompt();
  const v = pushPromptVersion({
    text: `${base.text}\n\n## ÖĞRENİLMİŞ KURAL v${(base.version || 1) + 1} (onaylandı)\n- ${e.summary}`,
    reason: e.detail || 'Kullanıcı onayıyla uygulandı', source: 'approved', patch: e.summary,
  });
  update('evolutions', id, { applied: true, promptVersion: v.version, promptId: v.id });
  return v;
}

export const rejectEvolution = (id) => update('evolutions', id, { applied: false, rejected: true });

export function upsertSkill(topic, level, note) {
  const key = String(topic || '').toLowerCase().trim();
  if (!key) return null;
  const existing = all('skills').find((x) => (x.topic || '').toLowerCase().trim() === key);
  if (existing) return update('skills', existing.id, { topic, level: clampLevel(level), note: note || existing.note });
  return insert('skills', { topic, level: clampLevel(level), note: note || '' });
}

export function stats() {
  const mem = all('memories').filter((m) => !m.archived);
  return {
    memories: mem.length,
    byKind: mem.reduce((a, m) => ({ ...a, [m.kind]: (a[m.kind] || 0) + 1 }), {}),
    promptVersion: currentPrompt().version,
    evolutions: all('evolutions').length,
    pendingPatches: all('evolutions').filter((e) => e.type === 'prompt-patch' && !e.applied && !e.rejected).length,
    skills: all('skills').length,
    cards: all('cards').length,
    messages: all('messages').length,
    selfEvolution: getSettings().selfEvolution,
  };
}

function clamp(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.6;
}
function clampLevel(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3;
}
