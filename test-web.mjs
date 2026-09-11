// test-web.mjs — sunucusuz (web/) sürümün çekirdek mantığını Node üzerinde doğrular.
// localStorage taklidi + gerçek Groq çağrısı ile tam öz-gelişim turu çalıştırır.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.location = { origin: 'http://localhost', href: 'http://localhost/', pathname: '/' };

const KEY = process.env.GROQ_API_KEY || JSON.parse(process.argv[2] || '""');
if (!KEY) { console.error('Anahtar verilmedi'); process.exit(1); }

const { setSettings, getSettings, all, currentPrompt } = await import('./web/js/store.js');
const evo = await import('./web/js/evolve.js');
const learn = await import('./web/js/learn.js');
const { chat, active, testConnection } = await import('./web/js/llm.js');

setSettings({ apiKey: KEY, provider: 'auto', userName: 'Test', selfEvolution: true, evolveThreshold: 0.6, autoApply: true });

console.log('=== 1) sağlayıcı algılama ===');
const a = active();
console.log('  ', a.def?.name, '/', a.model);

console.log('\n=== 2) bağlantı testi ===');
const t = await testConnection();
console.log('  ', t.ok ? `✅ ${t.provider}: "${t.reply}"` : `❌ ${t.error}`);
if (!t.ok) process.exit(1);

console.log('\n=== 3) sohbet (hafıza + kişilik promptu ile) ===');
const userText = 'Benim adim Zeynep, Istanbul\'da yasiyorum ve React ogreniyorum. Bana hep kisa ve madde madde cevap ver.';
const sys = evo.buildSystemPrompt();
console.log('   sistem promptu uzunluğu:', sys.length, 'karakter');
const reply = await chat([{ role: 'system', content: sys }, { role: 'user', content: userText }], { maxTokens: 500 });
console.log('   yanıt:', reply.slice(0, 220).replace(/\n/g, ' | '));

console.log('\n=== 4) öz-gelişim döngüsü ===');
const r = await evo.evolveAfterTurn({ conversationId: 'test', userText, assistantText: reply, messageId: 'm1' });
console.log('  ', JSON.stringify(r));

console.log('\n=== 5) sonuçlar ===');
const st = evo.stats();
console.log('   beyin sürümü : v%s'.replace('%s', st.promptVersion));
console.log('   hafıza       :', st.memories, JSON.stringify(st.byKind));
console.log('   beceri       :', st.skills);
console.log('   gelişim kaydı:', st.evolutions);
for (const m of evo.memories()) console.log('     •', `[${m.kind}]`, m.content, `(güven ${(m.strength * 100) | 0}%)`);
console.log('\n=== 6) hafıza yeni turda kullanılıyor mu? ===');
const sys2 = evo.buildSystemPrompt();
console.log('   HAFIZA bölümü var mı:', sys2.includes('## HAFIZA') ? '✅' : '❌');
console.log('   ÖĞRENİLMİŞ KURAL var mı:', sys2.includes('ÖĞRENİLMİŞ KURAL') ? '✅' : '❌ (yamaya bağlı)');
const reply2 = await chat([{ role: 'system', content: sys2 }, { role: 'user', content: 'Ben kimim ve ne ogreniyorum?' }], { maxTokens: 300 });
console.log('   yanıt:', reply2.slice(0, 200).replace(/\n/g, ' | '));

console.log('\n=== 7) öğrenme koçu ===');
const g = await learn.generateCards({ topic: 'React hooks', count: 2, level: 2 });
console.log('   üretilen kart:', g.cards.length);
if (g.cards.length) {
  const c = g.cards[0];
  console.log('   örnek soru:', c.question.slice(0, 110).replace(/\n/g, ' '));
  const grade = await learn.gradeAnswer({ cardId: c.id, userAnswer: 'B' });
  console.log('   puanlama:', grade.correct ? 'doğru' : 'yanlış', '| sonraki tekrar:', grade.nextInHours, 'saat');
  console.log('   beceri haritası:', JSON.stringify(all('skills')));
}

console.log('\n=== 8) localStorage boyutu ===');
let total = 0; for (const v of mem.values()) total += v.length;
console.log('  ', (total / 1024).toFixed(1), 'KB,', mem.size, 'tablo');
console.log('\n✅ TÜM TESTLER TAMAM');
