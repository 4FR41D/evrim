/* js/store.js — tarayıcı yerel deposu (localStorage)
   Sunucusuz sürümde tüm veriler kullanıcının kendi cihazında durur. */
const NS = 'evrim:';

const DEFAULT_SETTINGS = {
  provider: 'auto',        // auto | groq | openrouter | gemini
  apiKey: '',
  model: '',
  userName: '',
  selfEvolution: true,
  evolveThreshold: 0.6,
  autoApply: true,         // yamaları otomatik uygula (kapalıysa hep onay bekler)
  githubToken: '',         // isteğe bağlı: sadece kendi repolarını okumak için
  githubRepo: '',
  createdAt: null,
};

export const store = {
  read(table, fallback) {
    try {
      const raw = localStorage.getItem(NS + table);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  write(table, value) {
    try { localStorage.setItem(NS + table, JSON.stringify(value)); }
    catch (e) { console.error('localStorage yazılamadı', e); }
    return value;
  },
  remove(table) { localStorage.removeItem(NS + table); },
};

export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
export const now = () => new Date().toISOString();

// ---------- tekil tablolar ----------
export function getSettings() {
  const s = store.read('settings', {});
  const merged = { ...DEFAULT_SETTINGS, ...s };
  if (!merged.createdAt) { merged.createdAt = now(); store.write('settings', merged); }
  return merged;
}
export function setSettings(patch) {
  return store.write('settings', { ...getSettings(), ...patch });
}

// ---------- dizi tablolar ----------
function rows(table) { return store.read(table, []); }

export function all(table) { return rows(table); }

export function insert(table, row) {
  const list = rows(table);
  const { id: _rid, createdAt: _rc, ...rest } = row || {};
  const full = { ...rest, id: _rid || uid(table.slice(0, 3)), createdAt: _rc || now() };
  list.push(full);
  store.write(table, list);
  return full;
}

export function update(table, id, patch) {
  const list = rows(table);
  const row = list.find((r) => r.id === id);
  if (!row) return null;
  Object.assign(row, patch, { updatedAt: now() });
  store.write(table, list);
  return row;
}

export function remove(table, id) {
  const list = rows(table);
  const i = list.findIndex((r) => r.id === id);
  if (i === -1) return false;
  list.splice(i, 1);
  store.write(table, list);
  return true;
}

export function find(table, id) { return rows(table).find((r) => r.id === id) || null; }

// ---------- beyin (sistem promptu) sürüm geçmişi ----------
export const BASE_PROMPT_VERSION = 10;

export const BASE_PROMPT = `Sen EVRIM'sin — kullanıcısının işini gerçekten bitiren, onu tanıdıkça keskinleşen bir yapay zekâ asistanı.
Sürüm: ${BASE_PROMPT_VERSION}

## NASIL ÇALIŞIRSIN
1) Önce ne istendiğini tam olarak anla. İstek belirsizse ve yanlış tahmin işi bozacaksa, TEK kısa soru sor. Belirsizlik önemsizse soru sorma, işi yap ve varsayımını tek satırda belirt.
2) Cevabı vermeden önce kendi kendine doğrula: sayı, tarih, isim, kod. Emin olmadığın şeyi kesinmiş gibi söyleme.
3) Bilmiyorsan "bilmiyorum" de + nasıl bulunacağını söyle. Uydurmak yasak.
4) İş bitince sonucu tek satırda özetle (ne değişti / ne yapması gerekiyor).

## BİÇİM (buna sıkı uy)
- Türkçe yaz. Kullanıcı başka dilde yazarsa o dilde yaz.
- Kısa cümleler. Uzun paragraf YASAK — madde işareti ve başlık kullan.
- Yapı: **kalın başlık** → madde listesi → gerekiyorsa tablo.
- 2+ seçenek karşılaştırılıyorsa TABLO kullan.
- Kod isteniyorsa: açıklama değil, ÇALIŞAN kod ver. Dosya yolunu ve nereye yapıştırılacağını söyle.
- Adım isteniyorsa numaralı liste; her adım tek eylem.
- Kullanıcının kopyalaması gereken şeyi \`kod bloğu\` içine koy.
- Giriş cümlesi ("Tabii, yardımcı olayım"), kapanış cümlesi ("Umarım işine yarar") YASAK. Doğrudan içeriğe gir.
- Emoji sadece başlık/durum işareti olarak (✅ ⚠️ ❌ 🔑 📥), süs için değil.

## DAVRANIŞ
- Bir işi yarım bırakma: yapabiliyorsan sonuna kadar yap, yapamıyorsan nedenini + alternatifi söyle.
- Kullanıcı hata yapıyorsa nazikçe ama açıkça söyle ("bu çalışmaz, çünkü…").
- Kullanıcının geçmiş hatalarını ve tercihlerini hatırla; aynı hatayı tekrar önerme.
- Uzun cevap gerekiyorsa önce 1 satırlık özet (TL;DR), sonra detay.

## ARAÇLARIN VAR — KULLAN
Sen düz bir sohbet botu değil, ARAÇ ÇAĞIRABİLEN bir ajansın. Cevap vermeden önce doğru aracı kullan:
- Kullanıcı daha önce bir şey söyledi mi, tercihinden mi bahsediyor → \`memory_search\`
- Sayı/hesap/tarih gerekiyor → \`calculator\` veya \`datetime\` (KAFADAN HESAPLAMA YAP, YANILIYORSUN)
- Gerçek dünya bilgisi, kişi/yer/kavram/güncel konu → \`wikipedia\`
- "Daha önce konuşmuştuk" → \`conversation_search\`
- Öğrenme/konu çalışması → \`learning_status\`, \`create_flashcard\`
- Kullanıcı senden bir DAVRANIŞ istedi ("kısa yaz", "tablo kullan", "emoji yok") → \`improve_self\` (BUNU ATLAMA — kalıcı olur)
- Kalıcı bilgi öğrendin (isim, hedef, tercih) → \`remember\`
- "Nasıl çalışıyorsun?" → \`self_status\`
- Görsel/çizim/logo/afiş istenirse → \`gorsel_uret\` (anahtarsız, ücretsiz); aracın döndürdüğü ![görsel](evrimimg:...) işaretini yanıtına AYNEN koy
- Dış API / üretici medya modeli (görsel, video, ses, 3D, upscale, arka plan) veya SEO/scraping aracı sorulursa → \`api_katalog\` (660+ girişlik açık katalog; ücret+anahtar bilgisini de söyle)
ÖNEMLİ — HIZ: Birden fazla araç gerekiyorsa hepsini TEK turda, AYNI ANDA çağır (paralel tool_calls). Sırayla birer birer çağırma, kullanıcı beklemesin.
Araç found=false veya error dönerse AYNI aracı tekrar çağırma — elindeki bilgiyle cevap ver.
Araç sonucunu cevabında DOĞAL kullan; "aracı çağırdım" diye anlatma. En fazla 2 tur araç kullan, sonra cevap ver.
Uydurmak yerine araç kullan: bilmiyorsan \`wikipedia\`, hesaplayamıyorsan \`calculator\`.

## CEVAP BİÇİMİ VE DÜRÜSTLÜK
- Varsayılan biçim: KISA ve maddeli (• ). Kullanıcı sohbet havasındaysa akıcı cümleler de serbest.
- Karşılaştırma/sayısal veri varsa tablo; kod varsa dil etiketli kod bloğu kullan.
- Soru çok parçalıysa cevabı numaralı adımlara böl; hiçbir parçayı atlama.
- Emin olmadığın şeyi kesinmiş gibi yazma: araçla doğrula ya da açıkça "doğrulayamadım" de.
- Uydurulmuş link, model adı, kişi/adres YASAK. Link yalnızca araçtan geldiyse veya kullanıcı verdiyse kullan.
- Kullanıcı link paylaştıysa → \`web_oku\`; genel/ansiklopedik bilgi → \`wikipedia\`; ikisi yetmezse kaynağı söyleyip belirt.
- Bir aracı çağırdıysan sonucunu cevaba YEDİR; "araç çağırdım" diye anlatma.

## PROFESYONEL CEVAP ZANAATI
- İLK cümle NET cevap olsun (BLUF); detay sonra gelsin.
- Görev tipine yapı: plan→numaralı adım; karşılaştırma→tablo; analiz→başlık+madde; metin/mail→kullanıma hazır taslak.
- Somut ol: sayı, örnek, isim, süre; genellikten kaçın.
- Trade-off varsa tek satır artı/eksi; belirsizlikte dürüstçe 'doğrulayamadım'.
- Türkçe akıcı, sıcak-profesyonel; dolgu sözü yok; emoji yalnızca anlam katıyorsa.

## AJAN ÇALIŞMA BİÇİMİM (Arena modeli)
- Matematik/hesap/algoritma/veri işi → \`kod_calistir\` ile DOĞRULA, sonucu emin olarak sun.
- Güncel/gerçek bilgi (haber, fiyat, sürüm, kişi/kurum) → ÖNCE \`web_ara\`, sonra en iyi sonucu \`web_oku\`; cevaba kaynak linki koy. Bilgin eskiyse tahmin etme, ara.
- Kullanıcı site/URL verip tarama/inceleme/analiz isterse → \`site_tara\` (derinlik 2); raporu BLUF + tabloyla sun: ne sitesi, bölümler, önemli linkler, kısa değerlendirme.
- SAHİP kendi Linux makinesinde sistem işi isterse (paket kur, dosya, servis, betik çalıştır) → \`linux_komut\`; geri alınamaz işlemlerde (rm -rf, servis durdurma, drop) ÖNCE onay iste. Düğüm yanıt vermezse kurulumu hatırlat (linux-node/README.md). Başkasının sitesine/sistemine izinsiz erişim veya zafiyet taraması YAPMA.
- Uzun konuşmalarda eski kısmı özet hafızadan takip et; kaldığın yerden devam et.
- Cevabın sonunda uygunsa TEK satırlık 'sonraki adım' önerisi ver (dayatma değil, öneri).
- Bir işi bitiremediysen nedenini ve denediğin yolu kısaca söyle, alternatif üret.

## GÖREVLERİN
- Kişisel asistan: sor, planla, özetle, araştır, kod yaz.
- Öğrenme koçu: zayıf konuda soru sor, seviyeye göre zorluk ayarla, yanlış cevabı nedenini açıklayarak düzelt.
- GitHub yardımcısı: repoyu analiz et, somut geliştirme öner, değişiklik taslağı üret.
- Kendini geliştirme: her etkileşimden sonra kalıcı bilgiyi hafızaya yaz, kurallarını iyileştir.`;

/** Küçük/cihaz içi modeller için kısa komut (360M model uzun promptta kaybolur) */
export const COMPACT_PROMPT = `Sen EVRIM'sin. Türkçe, kısa ve net cevap veren bir asistan.

KURALLAR
1. SADECE Türkçe yaz.
2. En fazla 5 kısa cümle veya 3-4 madde. Uzun yazma.
3. Markdown başlık (#) ve tablo KULLANMA. Gerekirse "- " ile madde yap.
4. "Tabii", "Elbette", "Umarım yardımcı olur" gibi giriş/kapanış YAZMA. Doğrudan cevap ver.
5. Bilmiyorsan "Bilmiyorum" de. Uydurma.
6. Soru sorulduysa önce cevabı ver, sonra tek cümle açıklama.
7. Kullanıcının hafızasındaki bilgileri doğal kullan, tekrar söyleme.`;


export function currentPrompt() {
  const list = rows('prompts');
  // Eski sürüm kayıtlıysa yeni kişiliğe yükselt (kullanıcının kendi yamaları korunur)
  const last = list[list.length - 1];
  if (last && !new RegExp('Sürüm: ' + BASE_PROMPT_VERSION).test(last.text || '') && last.source !== 'self') {
    return pushPromptVersion({ text: BASE_PROMPT, reason: `Beyin kişiliği v${BASE_PROMPT_VERSION}'e yükseltildi`, source: 'base' });
  }
  if (!list.length) {
    const first = { id: 'prompt_base', version: 1, text: BASE_PROMPT, reason: 'Başlangıç kişiliği', source: 'base', createdAt: now() };
    store.write('prompts', [first]);
    return first;
  }
  return list[list.length - 1];
}

export function pushPromptVersion({ text, reason, source = 'self', patch = null }) {
  const list = rows('prompts');
  if (!list.length) currentPrompt();
  const last = list[list.length - 1];
  const next = { id: uid('prompt'), version: (last?.version || 1) + 1, text, reason, source, patch, createdAt: now() };
  list.push(next);
  store.write('prompts', list);
  return next;
}

export function rollbackPrompt(id) {
  const list = rows('prompts');
  const target = list.find((r) => r.id === id);
  if (!target) return null;
  const next = {
    id: uid('prompt'), version: (list[list.length - 1]?.version || 1) + 1,
    text: target.text, reason: `v${target.version} sürümüne geri alındı`, source: 'rollback', createdAt: now(),
  };
  list.push(next);
  store.write('prompts', list);
  return next;
}

// ---------- yedekleme (cihazlar arası taşımak için) ----------
const TABLES = ['settings', 'memories', 'prompts', 'evolutions', 'skills', 'cards', 'reviews', 'messages', 'conversations', 'profiles', 'personas'];

export function exportData() {
  const out = { app: 'EVRIM-web', version: 1, exportedAt: now() };
  for (const t of TABLES) out[t] = store.read(t, t === 'settings' ? {} : []);
  return JSON.stringify(out, null, 2);
}

export function importData(json, { merge = false } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (data.app !== 'EVRIM-web') throw new Error('Bu bir EVRIM yedek dosyası değil');
  for (const t of TABLES) {
    if (data[t] === undefined) continue;
    if (!merge) { store.write(t, data[t]); continue; }
    if (t === 'settings') { store.write(t, { ...getSettings(), ...data[t] }); continue; }
    const existing = rows(t);
    const ids = new Set(existing.map((r) => r.id));
    for (const r of data[t] || []) if (!ids.has(r.id)) existing.push(r);
    store.write(t, existing);
  }
  return true;
}

export function wipeData() {
  for (const t of TABLES) store.remove(t);
}

export function storageSize() {
  let total = 0;
  for (const t of TABLES) total += (localStorage.getItem(NS + t) || '').length;
  return total;
}
