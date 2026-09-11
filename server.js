// server.js — EVRIM: kendini geliştiren AI uygulaması (backend)
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  all, insert, update, remove, find, getSettings, updateSettings,
  currentPrompt, pushPromptVersion, rollbackPrompt, DATA_DIR,
} from './src/db.js';
import * as llm from './src/llm.js';
import * as evo from './src/evolve.js';
import * as learn from './src/learn.js';
import * as gh from './src/github.js';
import * as agent from './src/agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error('[api]', req.method, req.path, '->', err.message);
  res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 500)
    .json({ error: err.message, rateLimited: !!err.rateLimited });
});

// ---------------- Durum ----------------
app.get('/api/status', wrap(async (req, res) => {
  const active = llm.activeProvider();
  const s = getSettings();
  let ghUser = null;
  if (s.githubToken) ghUser = await gh.checkToken(s.githubToken).catch(() => null);
  res.json({
    provider: active.id,
    providerName: active.def?.name || 'Demo (çevrimdışı)',
    model: llm.resolveModel(),
    hasKey: !!s.apiKey,
    stats: evo.stats(),
    learning: learn.learningStats(),
    github: {
      repo: s.githubRepo || null,
      branch: s.githubBranch,
      hasToken: !!s.githubToken,
      user: ghUser?.ok ? { login: ghUser.login, name: ghUser.name } : null,
    },
    dataDir: DATA_DIR,
    time: new Date().toISOString(),
  });
}));

app.post('/api/test-llm', wrap(async (req, res) => {
  const out = await llm.chat([{ role: 'user', content: 'Tek kelimeyle cevap ver: hazır' }], { maxTokens: 20 });
  res.json({ ok: true, provider: llm.activeProvider().id, model: llm.resolveModel(), reply: out });
}));

// ---------------- Ayarlar ----------------
app.get('/api/settings', wrap(async (req, res) => {
  const s = getSettings();
  res.json({
    ...s,
    apiKey: s.apiKey ? mask(s.apiKey) : '',
    githubToken: s.githubToken ? mask(s.githubToken) : '',
    hasApiKey: !!s.apiKey,
    hasGithubToken: !!s.githubToken,
  });
}));

app.post('/api/settings', wrap(async (req, res) => {
  const patch = { ...req.body };
  // Maskelenmiş değerleri geri yazma
  if (typeof patch.apiKey === 'string' && patch.apiKey.includes('•')) delete patch.apiKey;
  if (typeof patch.githubToken === 'string' && patch.githubToken.includes('•')) delete patch.githubToken;
  if (patch.apiKey === '') patch.apiKey = '';
  if (patch.provider === 'auto' || !['auto', 'groq', 'openrouter', 'gemini', 'demo'].includes(patch.provider)) {
    patch.provider = 'auto';
  }
  const s = updateSettings(patch);
  res.json({
    ok: true,
    provider: llm.activeProvider().id,
    model: llm.resolveModel(),
    settings: { ...s, apiKey: s.apiKey ? mask(s.apiKey) : '', githubToken: s.githubToken ? mask(s.githubToken) : '' },
  });
}));

app.get('/api/providers', wrap(async (req, res) => res.json(llm.providerList())));

// ---------------- Sohbet ----------------
app.get('/api/conversations', wrap(async (req, res) => {
  res.json(all('conversations').slice().reverse());
}));

app.post('/api/conversations', wrap(async (req, res) => {
  const c = insert('conversations', { title: req.body.title || 'Yeni sohbet' });
  res.json(c);
}));

app.delete('/api/conversations/:id', wrap(async (req, res) => {
  for (const m of all('messages').filter((m) => m.conversationId === req.params.id)) remove('messages', m.id);
  res.json({ ok: remove('conversations', req.params.id) });
}));

app.get('/api/messages/:conversationId', wrap(async (req, res) => {
  res.json(all('messages').filter((m) => m.conversationId === req.params.conversationId));
}));

app.post('/api/chat', wrap(async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Mesaj boş olamaz' });

  let convId = conversationId;
  if (!convId) convId = insert('conversations', { title: message.slice(0, 40) }).id;

  const history = all('messages')
    .filter((m) => m.conversationId === convId)
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content }));

  const userMsg = insert('messages', { conversationId: convId, role: 'user', content: message });

  // İlk kullanıcı mesajıysa sohbet başlığı yap
  const conv = find('conversations', convId);
  if (conv && conv.title === 'Yeni sohbet') update('conversations', convId, { title: message.slice(0, 40) });

  const messages = [{ role: 'system', content: evo.buildSystemPrompt() }, ...history, { role: 'user', content: message }];

  try {
    const reply = await llm.chat(messages, { temperature: 0.7, maxTokens: 1200 });
    const botMsg = insert('messages', { conversationId: convId, role: 'assistant', content: reply });

    // Öz-gelişim arka planda çalışır, kullanıcıyı bekletmez
    evo.evolveAfterTurn({
      conversationId: convId,
      userText: message,
      assistantText: reply,
      messageId: botMsg.id,
    }).then((r) => console.log('[evolve]', r)).catch((e) => console.error('[evolve]', e.message));

    res.json({ conversationId: convId, message: botMsg, provider: llm.activeProvider().id, model: llm.resolveModel() });
  } catch (err) {
    const fallback = insert('messages', {
      conversationId: convId,
      role: 'assistant',
      content: `⚠️ Model hatası: ${err.message}\n\nAyarlar sekmesinden API anahtarını/modelini kontrol edebilirsin.`,
      error: true,
    });
    res.status(200).json({ conversationId: convId, message: fallback, error: err.message });
  }
}));

app.post('/api/feedback', wrap(async (req, res) => {
  const { messageId, value, comment } = req.body;
  res.json(evo.recordFeedback({ messageId, value: Number(value), comment }));
}));

// ---------------- Hafıza ----------------
app.get('/api/memories', wrap(async (req, res) => res.json(evo.memories(req.query.kind))));

app.post('/api/memories', wrap(async (req, res) => {
  const { content, kind = 'fact' } = req.body;
  const m = evo.addMemory({ content, kind, source: 'user', strength: 0.9 });
  insert('evolutions', { type: 'memory', summary: `Kullanıcı hafızaya ekledi: ${content}`, applied: true, confidence: 1 });
  res.json(m);
}));

app.patch('/api/memories/:id', wrap(async (req, res) => res.json(update('memories', req.params.id, req.body))));
app.delete('/api/memories/:id', wrap(async (req, res) => res.json({ ok: evo.forgetMemory(req.params.id) })));

// ---------------- Öz-gelişim ----------------
app.get('/api/evolutions', wrap(async (req, res) => {
  res.json(all('evolutions').slice().reverse());
}));

app.post('/api/evolutions/:id/approve', wrap(async (req, res) => {
  const v = evo.approveEvolution(req.params.id);
  res.json(v || { error: 'Uygulanacak yama bulunamadı' });
}));

app.post('/api/evolutions/:id/reject', wrap(async (req, res) => {
  res.json(evo.rejectEvolution(req.params.id) || { error: 'Bulunamadı' });
}));

app.get('/api/prompts', wrap(async (req, res) => {
  res.json(all('prompts').slice().reverse());
}));

app.get('/api/prompt', wrap(async (req, res) => {
  res.json({ current: currentPrompt(), rendered: evo.buildSystemPrompt() });
}));

app.post('/api/prompt/rollback/:id', wrap(async (req, res) => {
  res.json(rollbackPrompt(req.params.id) || { error: 'Sürüm bulunamadı' });
}));

app.post('/api/prompt/edit', wrap(async (req, res) => {
  const { text, reason } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Metin boş olamaz' });
  res.json(pushPromptVersion({ text, reason: reason || 'Kullanıcı elle düzenledi', source: 'user' }));
}));

app.get('/api/skills', wrap(async (req, res) => res.json(all('skills'))));
app.post('/api/skills', wrap(async (req, res) => res.json(evo.upsertSkill(req.body.topic, req.body.level || 3, req.body.note || ''))));

// ---------------- Öğrenme ----------------
app.get('/api/learn/cards', wrap(async (req, res) => {
  res.json({ all: learn.cards(), due: learn.dueCards(50), stats: learn.learningStats() });
}));

app.post('/api/learn/cards', wrap(async (req, res) => {
  res.json(learn.createCard(req.body));
}));

app.delete('/api/learn/cards/:id', wrap(async (req, res) => res.json({ ok: remove('cards', req.params.id) })));

app.post('/api/learn/generate', wrap(async (req, res) => {
  const { topic, count = 5, level = 3 } = req.body;
  if (!topic?.trim()) return res.status(400).json({ error: 'Konu gerekli' });
  res.json(await learn.generateCards({ topic, count: Math.min(10, Number(count) || 5), level: Number(level) || 3 }));
}));

app.post('/api/learn/grade', wrap(async (req, res) => {
  const { cardId, userAnswer } = req.body;
  res.json(await learn.gradeAnswer({ cardId, userAnswer }));
}));

app.post('/api/learn/plan', wrap(async (req, res) => {
  const { goal, minutesPerDay } = req.body;
  if (!goal?.trim()) return res.status(400).json({ error: 'Hedef gerekli' });
  res.json(await learn.makePlan({ goal, minutesPerDay: Number(minutesPerDay) || 20 }));
}));

// ---------------- GitHub ----------------
app.get('/api/github/repos', wrap(async (req, res) => {
  const s = getSettings();
  res.json(await gh.myRepos(s.githubToken));
}));

app.get('/api/github/repo', wrap(async (req, res) => {
  const s = getSettings();
  const full = req.query.full || s.githubRepo;
  if (!full) return res.status(400).json({ error: 'Repo belirtilmedi' });
  const info = await gh.repoInfo(full, s.githubToken);
  const tree = await gh.fileTree(full, s.githubToken, info.defaultBranch).catch(() => ({ files: [], branch: info.defaultBranch }));
  const commits = await gh.recentCommits(full, s.githubToken, { limit: 10 }).catch(() => []);
  const issues = await gh.listIssues(full, s.githubToken, { limit: 10 }).catch(() => []);
  res.json({ info, tree, commits, issues });
}));

app.get('/api/github/file', wrap(async (req, res) => {
  const s = getSettings();
  res.json(await gh.readFile(req.query.full || s.githubRepo, req.query.path, s.githubToken, req.query.branch));
}));

app.post('/api/github/analyze', wrap(async (req, res) => {
  const s = getSettings();
  res.json(await agent.analyzeRepo(req.body.full || s.githubRepo, s.githubToken, { branch: req.body.branch }));
}));

app.post('/api/github/implement', wrap(async (req, res) => {
  const s = getSettings();
  const { task, full, branch, targetPaths, autoCommit, commitMessage } = req.body;
  if (!task?.trim()) return res.status(400).json({ error: 'Görev metni gerekli' });
  res.json(await agent.implementTask({
    task, full: full || s.githubRepo, token: s.githubToken,
    branch: branch || s.githubBranch, targetPaths: targetPaths || [], autoCommit, commitMessage,
  }));
}));

app.post('/api/github/commit', wrap(async (req, res) => {
  const s = getSettings();
  const { full, path: p, content, message, branch } = req.body;
  res.json(await agent.commitFile({
    full: full || s.githubRepo, token: s.githubToken, branch: branch || s.githubBranch,
    path: p, content, message,
  }));
}));

app.post('/api/github/issue', wrap(async (req, res) => {
  const s = getSettings();
  res.json(await gh.createIssue({ full: req.body.full || s.githubRepo, token: s.githubToken, title: req.body.title, body: req.body.body }));
}));

app.get('/api/github/daily', wrap(async (req, res) => {
  const s = getSettings();
  res.json(await agent.dailySummary(req.query.full || s.githubRepo, s.githubToken));
}));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function mask(s) {
  if (!s) return '';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

app.listen(PORT, HOST, () => {
  console.log(`\n🧬 EVRIM çalışıyor → http://${HOST}:${PORT}`);
  console.log(`   Sağlayıcı: ${llm.activeProvider().id} | Model: ${llm.resolveModel()}`);
  console.log(`   Veri klasörü: ${DATA_DIR}\n`);
});
