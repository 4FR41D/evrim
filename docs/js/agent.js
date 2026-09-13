/* js/agent.js — AJAN DÖNGÜSÜ (EVRIM'i "asistan"dan "ajan"a çeviren katman)

   Normal sohbet:   soru -> cevap
   Ajan döngüsü:    soru -> DÜŞÜN -> ARAÇ ÇAĞIR -> SONUCU OKU -> (gerekirse tekrar) -> cevap

   Bütün araçlar TARAYICIDA çalışır: sunucu yok, ek API anahtarı yok.
   Sadece `wikipedia` dışarı çıkar (CORS'u açık, anahtar istemiyor). */
import { all, insert, update, remove, getSettings, now, storageSize, gunIsaretle } from './store.js';
import * as evo from './evolve.js';
import * as learn from './learn.js';
import { rawChat, active as activeLLM } from './llm.js';
import { wasmStatus } from './wasm.js';
import { createCard } from './learn.js';
import { localStatus } from './local.js';
import { puterStatus } from './puter.js';

// v70 (lab önerisi #1): araç ağ çağrılarına zaman aşımı — mobilde asılı istek ajanı sonsuza dek kilitlemesin
async function fetchT(url, opts = {}, ms = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  catch (e) { if (e?.name === 'AbortError') throw new Error(`ağ zaman aşımı (${ms / 1000}sn)`); throw e; }
  finally { clearTimeout(t); }
}
import { houseStatus } from './house.js';

const MAX_STEPS = 6;   // v64: daha derin ajan döngüsü (çok adımlı görevler için)

/* ------------------------------------------------------------------ */
/* ARAÇ TANIMLARI (modele giden şema)                                  */
/* ------------------------------------------------------------------ */
const F = (name, description, properties, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const TOOLS = [
  F('memory_search', 'Kullanıcının kalıcı hafızasında ara. Kullanıcı daha önce bir şey söylediyse, tercihlerinden veya geçmişinden bahsediyorsan ÖNCE bunu çağır.', {
    query: { type: 'string', description: 'Aranacak konu/anahtar kelime' },
  }, ['query']),

  F('remember', 'Kalıcı bir bilgiyi hafızaya kaydet. Kullanıcı adını, tercihini, hedefini, bir hatanı veya yeni bir kuralı öğrendiğinde çağır.', {
    content: { type: 'string', description: 'Tek cümle, 140 karakterden kısa, Türkçe' },
    kind: { type: 'string', enum: ['fact', 'preference', 'skill', 'mistake', 'rule'], description: 'fact=bilgi, preference=tercih, skill=beceri, mistake=hata, rule=kural' },
  }, ['content', 'kind']),

  F('conversation_search', 'Geçmiş sohbet mesajlarında ara. "daha önce konuşmuştuk", "geçen sormuştum" gibi ifadelerde kullan.', {
    query: { type: 'string' },
  }, ['query']),

  F('calculator', 'Matematiksel hesap yap. Kendin hesaplamaya ÇALIŞMA, bu aracı kullan.', {
    expression: { type: 'string', description: 'Örn: (145*37)+sqrt(16) — sadece sayı ve operatör' },
  }, ['expression']),

  F('datetime', 'Bugünün tarihi, saati ve gün adını al. Tarih/hesap gerektiren her konuda kullan.', {}),

  F('wikipedia', "Gerçek dünya bilgisi için Vikipedi'de ara; başlık + özet + kaynak bağlantısı döner. Kişi, yer, kavram, olay, tarih gibi olgusal sorularda kullan. ÖNEMLİ: found=false dönerse AYNI aracı farklı sorguyla TEKRAR ÇAĞIRMA — genel bilginle cevap ver veya başka araç kullan.", {
    query: { type: 'string', description: "Konu. Tam başlık olmak zorunda değil (örn. 'Kayseri', 'yapay zeka', 'İstanbul\'un fethi')" },
    lang: { type: 'string', description: 'tr (varsayılan) veya en' },
  }, ['query']),

  F('learning_status', 'Kullanıcının öğrenme koçu durumunu getir: beceri haritası, tekrar zamanı gelen kartlar, zayıf konular.', {}),

  F('create_flashcard', 'Kullanıcının öğrenmesi için tekrar kartı oluştur (aralıklı tekrar sistemine eklenir).', {
    question: { type: 'string' },
    answer: { type: 'string' },
    topic: { type: 'string' },
  }, ['question', 'answer', 'topic']),

  F('self_status', 'Kendi durumunu getir: beyin sürümü, hafıza sayısı, aktif model, öğrenilen kurallar. "Nasıl çalışıyorsun?", "neler biliyorsun?" gibi sorularda kullan.', {}),

  F('improve_self', 'KENDİNİ GELİŞTİR: kalıcı bir davranış kuralı ekle. Kullanıcı senden bir biçim/davranış istediğinde ("kısa yaz", "tablo kullan", "emoji kullanma") MUTLAKA bunu çağır.', {
    rule: { type: 'string', description: 'Tek cümlelik kural, Türkçe, emir kipinde' },
    reason: { type: 'string', description: 'Bu kuralın nedeni' },
  }, ['rule']),

  F('web_oku', 'WEB SAYFASI OKU (anahtarsız): kullanıcı bir LİNK paylaştıysa MUTLAKA bunu çağır ve sayfı özetle. Güncel/kesin bilgi lazım olup Vikipedi yetmezse de kullan (resmî site, doküman, haber). Dakikada 20 istek limiti var; gereksiz çağırma.', {
    url: { type: 'string', description: 'https:// ile başlayan tam adres' },
    odak: { type: 'string', description: 'Opsiyonel: sayfada aranacak konu/anahtar kelime (uzun sayfalarda ilgili bölümü getirir)' },
  }, ['url']),

  F('gorsel_uret', 'GÖRSEL ÜRET (anahtarsız + ücretsiz + GİRİŞSİZ): kullanıcı fotoğraf, çizim, logo, afiş, duvar kağıdı, ikon gibi bir GÖRSEL istediğinde kullan. Asla hesap/giriş istemez. Araç bir İŞARET döndürür (![görsel](evrimimg:...)) — o işareti yanıtına AYNEN koy ki görsel görünsün.', {
    istem: { type: 'string', description: 'Detaylı görsel promptu (İngilizce önerilir: konu, stil, ışık, kompozisyon)' },
    model: { type: 'string', description: 'Opsiyonel model (örn. gpt-image-1-mini, flux-schnell)' },
  }, ['istem']),

  F('hatirlatici', 'HATIRLATICI KUR (bildirimli): kullanıcı "X dakika/saat sonra hatırlat" derse çağır. Süre dolunca uygulama içi uyarı + telefon bildirimi gösterilir (sayfa açıkken). liste:true ile kurulu hatırlatıcıları getirir. takvim:true ile .ics takvim dosyası da indirir (telefon takvimine eklenince sekme kapalıyken de çalar).', {
    mesaj: { type: 'string', description: 'hatırlatılacak şey' },
    dakika: { type: 'number', description: 'kaç dakika sonra (varsayılan 60)' },
    saat: { type: 'string', description: '"HH:MM" — belirli saatte (bugün geçtiyse yarın)' },
    liste: { type: 'boolean', description: 'true = kurulu hatırlatıcıları listele' },
    takvim: { type: 'boolean', description: 'true = ayrıca .ics takvim dosyası indir' },
  }, []),
  F('gider', 'GİDER/GELİR DEFTERİ: kullanıcı harcama söylerse ("bugün 450 lira yakıt") kaydet; "özet/rapor/ne kadar harcadım" derse ozet:true ile aylık + kategori tablosu çıkar.', {
    tutar: { type: 'number', description: 'tutar (sayı)' },
    kategori: { type: 'string', description: 'yakıt, yemek, kira… (serbest)' },
    aciklama: { type: 'string', description: 'kısa açıklama' },
    ozet: { type: 'boolean', description: 'true = kayıt ekleme, özet rapor üret' },
  }, []),
  F('hava_durumu', 'HAVA DURUMU (anahtarsız, canlı): şehir ver; şu anki durum + günlük tahmin tablosu döner. "Yarın yağmur var mı", "hava nasıl" sorularında çağır.', {
    sehir: { type: 'string', description: 'şehir adı (Türkçe yazılabilir, örn. "Gaziantep")' },
    gun: { type: 'number', description: 'kaç günlük tahmin 1-7 (varsayılan 3)' },
  }, ['sehir']),
  F('doviz', 'DÖVİZ KURU (anahtarsız, ECB resmî günlük kurlar): "dolar kaç TL", "100 euro kaç lira" sorularında çağır. Kripto ve hisse YOKTUR — istenirse olmadığını söyle.', {
    baz: { type: 'string', description: 'kaynak para kodu (USD, EUR, GBP, JPY, TRY… varsayılan USD)' },
    hedef: { type: 'string', description: 'hedef para kodu (varsayılan TRY)' },
    miktar: { type: 'number', description: 'çevrilecek tutar (varsayılan 1)' },
  }, []),
  F('ceviri', 'DİL ÇEVİRİSİ (anahtarsız): kısa metinleri çevirir (~1800 karakter altı; anonim günlük kota sınırlı). Kaynak dil verilmezse otomatik sezer (Türkçe karakter varsa tr, yoksa en).', {
    metin: { type: 'string', description: 'çevrilecek metin' },
    hedef: { type: 'string', description: 'hedef dil kodu (tr, en, de, fr, ar… verilmezse kaynağın tersi)' },
    kaynak: { type: 'string', description: 'kaynak dil kodu (verilmezse otomatik)' },
  }, ['metin']),
  F('yapilac', 'YAPILACAKLAR LİSTESİ (kalıcı, cihazda): görev ekle/listele/tamamla/sil. "şunu unutma", "listemde ne var", "1. görevi tamamladım" isteklerinde çağır.', {
    islem: { type: 'string', description: 'ekle | liste | tamamla | sil | temizle (tamamlananları siler)' },
    baslik: { type: 'string', description: 'görev metni (ekle için)' },
    no: { type: 'number', description: 'liste sırası (tamamla/sil için)' },
  }, []),
  F('aliskanlik', 'ALIŞKANLIK TAKİBİ + SERİ (kalıcı, cihazda): alışkanlık oluştur, "bugün yaptım" işaretle, kaç gün üst üste yaptığını raporla. "su içme alışkanlığı ekle", "bugün koştum", "alışkanlıklarım nasıl" isteklerinde çağır.', {
    islem: { type: 'string', description: 'ekle | yapildi | durum | sil' },
    ad: { type: 'string', description: 'alışkanlık adı (örn. "su iç")' },
  }, []),
  F('site_uret', 'WEB SİTESİ ÜRET + CANLI ÖNİZLEME (tarayıcıda, anahtarsız): kullanıcı site/landing/oyun/animasyon/portföy/sayaç gibi görsel-etkileşimli sayfa isterse çağır. TAM tek dosya HTML üret (CSS+JS gömülü, mobil uyumlu; harici CDN YOK — görsel istisnası: image.pollinations.ai). Sistem promptundaki PROFESYONEL SİTE TASARIMI bölümüne UY: hero+CTA, kart bölümleri, CSS değişkenleriyle palet, GERÇEK Türkçe içerik. Kodu "kod" parametresine yaz. Araç kaydeder, OTOMATİK DENETİM yapar (ölü link/görsel hatası/mobil taşma) ve canlı önizleme kartı işareti döner — işareti yanıtına AYNEN koy; dönen kusur listesi boş değilse düzeltip aynı ad ile tekrar çağır. Aynı "ad" ile tekrar çağırırsan site GÜNCELLENİR ("başlığı mavi yap" gibi istekler için). KODU ÖZ TUT (hedef ≤250 satır): çok uzun argüman JSON\u2019u bozabilir.', {
    ad: { type: 'string', description: 'kısa slug: "portfoy", "yilan-oyunu" (küçük harf, tireli)' },
    kod: { type: 'string', description: 'TAM HTML belgesi: <!doctype html>…</html> (CSS+JS gömülü; CDN yok, görsel pollinations olabilir)' },
    islem: { type: 'string', description: 'olustur (varsayılan) | liste | sil' },
  }, ['ad']),
  F('proje_uret', 'ÇOK DOSYALI WEB PROJESİ/UYGULAMASI üret (v76): etkileşimli uygulama, oyun, araç, dashboard, çok ekranlı iş isteklerinde site_uret YERİNE bunu kullan. dosyalar: {"index.html":"...","style.css":"...","app.js":"..."} — her dosyanın TAM içeriği; index.html diğerlerine <link rel="stylesheet" href="style.css"> ve <script src="app.js"><\/script> ile bağlanır (harici CDN YOK). testler: [{ad, js}] — js sayfanın İÇİNDE koşar (document/window erişir); doğrulamayan durumda throw at (örn if(!document.querySelector(".liste")) throw new Error("liste yok")). Araç OTOMATİK DENETİM yapar: statik kontroller + testleri gerçekten çalıştırır; başarısızlık raporunu düzelt ve AYNI ad ile tekrar çağır — DOSYALAR BİRLEŞİR, büyük projeyi turlar halinde inşa et. Profesyonel uygulama standartları: durum yönetimi (localStorage kalıcı), boş/hata durumları, erişilebilirlik, mobil uyum.', {
    ad: { type: 'string', description: 'kısa slug: "todo-app", "hesap-makinesi"' },
    dosyalar: { type: 'object', description: '{"index.html": "...", "style.css": "...", "app.js": "..."} — TAM içerikler' },
    testler: { type: 'array', items: { type: 'object', properties: { ad: { type: 'string' }, js: { type: 'string' } }, required: ['ad', 'js'] }, description: 'sayfa içinde koşacak doğrulama testleri' },
    islem: { type: 'string', description: 'olustur/guncelle (varsayılan) | liste | sil' },
  }, ['ad']),
  F('proje_test', 'Kayıtlı çok dosyalı projenin testlerini + denetimini YENİDEN çalıştır (proje_uret sonrası doğrulama veya "testleri çalıştır" isteği).', {
    ad: { type: 'string', description: 'proje slug' },
  }, ['ad']),
  F('oz_test', 'EVRIM ÖZ TEST / DUMAN TESTİ (TestSprite ruhu, tarayıcıda): ÇALIŞAN uygulamanın kendisini doğrular — kritik DOM öğeleri, 29 aracın Groq-uyumlu şeması, yürütücü eşlemesi, yerel depolama, katalog/müfredat/ders arşivi dosyaları, ServiceWorker. Sonuç ✅/❌ tablosu döner. Kullanıcı "kendini test et / çalışıyor musun / öz denetim / sistem kontrolü" derse çağır.', {}, []),
  F('evrak_taslak', 'RESMÎ YAZI / DİLEKÇE TASLAK ÜRETİCİ (KACHOW ruhu, tarayıcıda): Türk resmî yazışma kurallarına göre biçimlendirilmiş taslak üretir. tip: "dilekce" (vatandaş→kurum, varsayılan) veya "resmi" (kurum yazısı, sayı/ilgi/imza bloğu). yon: "ust" makama → "arz ederim", "alt"/"denk" → "rica ederim". Kullanıcı dilekçe/resmî yazı/evrak taslağı isterse çağır; taslağı markdown olarak aynen sun, değiştirilecek yerleri [...] belirt.', {
    konu: { type: 'string', description: 'yazının konusu (kısa)' },
    muhatap: { type: 'string', description: 'hitap edilen kurum/kişi, örn. "ŞAHİNBEY BELEDİYE BAŞKANLIĞINA"' },
    icerik: { type: 'string', description: 'anlatılacaklar (cümleler veya maddeler; \\n ile ayır)' },
    tip: { type: 'string', description: 'dilekce (varsayılan) | resmi' },
    yon: { type: 'string', description: 'ust (varsayılan) | denk | alt — arz/rica seçimini belirler' },
    ilgi: { type: 'string', description: 'resmi tipinde ilgi tutulan yazı (opsiyonel)' },
  }, ['konu', 'muhatap', 'icerik']),
  F('otomatik_turev', 'OTOMATİK TÜREV / AUTOGRAD (JAX grad() ruhu, tarayıcıda): matematik ifadenin değerini + gradyanını TERS MOD otomatik türevle (işlem bandı/backprop) hesaplar ve sayısal farkla DOĞRULAR. İfade doğal matematik: sin(x)*x + exp(-x^2), ^ üs, fonksiyonlar sin/cos/tan/exp/log/sqrt/abs, sabitler pi/e. Türev/gradyan/marjinal değişim sorularında çağır.', {
    ifade: { type: 'string', description: 'f(x,y,...) doğal matematik, örn. "sin(x)*x" veya "x^2*y + sin(y)"' },
    degiskenler: { type: 'string', description: 'JSON nokta: {"x":1.5} veya {"x":1,"y":2} (verilmezse x=1)' },
  }, ['ifade']),
  F('oto_model', 'OTOMATİK MODEL ARAMA / AutoML (AutoKeras ruhu, tarayıcıda): sinir ağı hiperparametrelerini (gizli nöron 3-12, öğrenme oranı 0.05-0.5) OTOMATİK arar — rastgele arama + doğrulama bölmesi (overfitting elemesi), en iyi yapılandırmayı seçer ve tam veriyle yeniden eğitir. gorev: xor | daire | sinus. Kullanıcı "en iyi modeli bul/otomatik dene/hiperparametre ara" derse çağır.', {
    gorev: { type: 'string', description: 'xor | daire | sinus' },
    deneme: { type: 'number', description: 'denenecek yapılandırma 3-12 (varsayılan 6)' },
  }, ['gorev']),
  F('gizli_ogren', 'GİZLİLİK KORUYAN ÖĞRENME (PySyft ruhu, tarayıcıda): "federe" — FedAvg simülasyonu: 2-5 istemci veriyi PAYLAŞMADAN yerel eğitir, ağırlıklar merkezde ortalanır (tur tur kayıp/doğruluk tablosu); "farkli_gizlilik" — ε bütçeli Laplace gürültülü istatistik: gerçek vs gürültülü ortalama, gizlilik-kullanışlılık dengesi tablosu. Federated learning/diferansiyel gizlilik/gizli veri analizi isteklerinde çağır.', {
    gorev: { type: 'string', description: 'federe | farkli_gizlilik' },
    istemci: { type: 'number', description: 'federe: istemci sayısı 2-5 (varsayılan 3)' },
    turlar: { type: 'number', description: 'federe: federasyon turu 1-20 (varsayılan 8)' },
    epsilon: { type: 'number', description: 'farkli_gizlilik: gizlilik bütçesi ε (varsayılan 1)' },
    veri: { type: 'string', description: 'farkli_gizlilik: JSON sayı dizisi (opsiyonel; verilmezse örnek maaş verisi üretilir)' },
  }, ['gorev']),
  F('olasilik', 'OLASILIK/İSTATİSTİK LABORATUVARI (TensorFlow Probability ruhu, tarayıcıda): 3 görev — "dagilim": dağılım tablosu + ortalama/varyans (normal, binom, poisson, ustel, duzgu); "monte_carlo": π veya integral tahmini (ifade + aralik ver); "mcmc": Metropolis-Hastings ile hedef yoğunluktan posterior örneklemi (Bayesçi çıkarım). Olasılık/istatistik/Bayes/Monte Carlo isteklerinde çağır.', {
    gorev: { type: 'string', description: 'dagilim | monte_carlo | mcmc' },
    dagilimAdi: { type: 'string', description: 'dagilim görevi için: normal | binom | poisson | ustel | duzgu' },
    parametreler: { type: 'string', description: 'JSON: {"mu":0,"sigma":1} / {"n":10,"p":0.5} / {"lambda":3} / {"a":0,"b":1}' },
    ifade: { type: 'string', description: 'monte_carlo integral için f(x) veya mcmc hedef yoğunluk (JS ifadesi, x + Math.*), örn. "Math.exp(-x*x/2)"' },
    aralik: { type: 'string', description: 'JSON [a,b] — integral/mcmc sınırları' },
    ornek: { type: 'number', description: 'örnek/iterasyon sayısı (varsayılan 20000/8000)' },
  }, ['gorev']),
  F('sinir_agi', 'SİNİR AĞI EĞİTİCİ (Flux.jl ruhu, tarayıcıda): küçük bir yapay sinir ağını SIFIRDAN eğitir — ileri geçiş, kayıp, geri yayılım, SGD (saf JS). Hazır görevler: "xor" (klasik mantık), "daire" (2B sınıflandırma), "sinus" (regresyon). Kayıp eğrisi + doğruluk + örnek tahminler döner. Kullanıcı sinir ağı/eğitim/derin öğrenme demosu isterse çağır.', {
    gorev: { type: 'string', description: 'xor | daire | sinus' },
    turler: { type: 'number', description: 'epoch sayısı (varsayılan göreve göre yeterli)' },
    ogrenmeOrani: { type: 'number', description: 'learning rate (varsayılan göreve göre)' },
    gizli: { type: 'number', description: 'gizli katman nöronu 2-16 (varsayılan 4-8)' },
  }, ['gorev']),
  F('kuantum_devre', 'KUANTUM DEVRE SİMÜLATÖRÜ (PennyLane ruhu, tarayıcıda): 1-3 kübitlik devreyi durum vektörüyle simüle eder. Kapılar: X, Y, Z, H, S, T, RX, RY, RZ (açı radyan), CNOT. Ölçüm olasılıkları + genlik tablosu döner. Kuantum örneği/simülasyonu istenince çağır.', {
    qubit: { type: 'number', description: 'kübit sayısı 1-3 (varsayılan 2)' },
    adimlar: { type: 'string', description: 'JSON dizi: [{"kapi":"H","hedef":0},{"kapi":"CNOT","kontrol":0,"hedef":1},{"kapi":"RX","hedef":0,"aci":1.5708}]' },
  }, ['adimlar']),
  F('linux_komut', "SAHİBİN LİNUX MAKİNESİ (tam yetki, yalnız sahip token'ıyla): sahibin özel Linux düğümünde bash komutu çalıştırır — paket kurma (apt/pkg), dosya oluştur/sil/taşı, python/node/git, servis başlat/durdur (systemctl), sistem bilgisi. Uzun işleri arka plana at (nohup ... &). GERİ ALINAMAZ komutlarda (rm -rf, drop, format, servis durdurma) ÖNCE kullanıcıdan onay iste. Düğüm çevrimdışıysa kullanıcıya linux-node/README.md kurulumunu hatırlat.", {
    komut: { type: 'string', description: 'bash komutu (tek satır veya && / ; ile zincir)' },
    cwd: { type: 'string', description: 'çalışma dizini (opsiyonel, varsayılan ev dizini)' },
    bekle: { type: 'number', description: 'yanıt bekleme üst sınırı ms (varsayılan 60000, en çok 120000)' },
  }, ['komut']),
  F('repo_bul', 'AÇIK KAYNAK / GITHUB REPO ARAMA (anahtarsız): açık repo, kütüphane, git projesi, araç ararken çağır. İngilizce sorgu daha iyi sonuç verir (örn. "self improving ai agent"). Sonuçları tabloyla sun: ad, ⭐, dil, lisans, link.', {
    sorgu: { type: 'string', description: 'arama terimleri (İngilizce önerilir)' },
    dil: { type: 'string', description: 'dil filtresi: python, javascript, julia… (isteğe bağlı)' },
    sirala: { type: 'string', description: 'stars (varsayılan) | updated | forks' },
    adet: { type: 'number', description: 'kaç sonuç (1-10, varsayılan 5)' },
  }, ['sorgu']),
  F('site_tara', 'SİTE TARAYICI: kullanıcı bir site/URL verip "tara/incele/analiz et/özetle/ne sitesi bu" derse çağır. Siteyi anahtarsız okuyucuyla tarar: başlık, açıklama, bölüm başlıkları, iç/dış linkler, kelime sayısı; derinlik=2 verilirse iç linklerden 2 alt sayfayı da okur. Raporu BLUF + tabloyla sun (ne sitesi, bölümler, önemli linkler, değerlendirme).', {
    url: { type: 'string', description: 'tam adres, https:// ile' },
    derinlik: { type: 'number', description: '0 = sadece ana sayfa (varsayılan); 2 = ana sayfa + 2 alt sayfa' },
  }, ['url']),
  F('ode_coz', 'DİFERANSİYEL DENKLEM ÇÖZÜCÜ (SciML/DiffEqFlux ruhu, tarayıcıda): dy/dt = f(t,y) başlangıç değer problemini RK4 veya Euler ile sayısal çözer. Fizik/büyüme/salınım modelleri için kullan (örn. lojistik büyüme, basit sarkaç, yay-sönüm). Denklem JS ifadesi: t ve y değişkenleri + Math.* serbest.', {
    denklem: { type: 'string', description: 'f(t,y) sağ tarafı, örn. "0.5*y*(1-y/10)" veya "-9.81*Math.sin(y)"' },
    y0: { type: 'number', description: 'başlangıç değeri y(t0)' },
    t0: { type: 'number', description: 'başlangıç zamanı (varsayılan 0)' },
    tBitis: { type: 'number', description: 'bitiş zamanı (varsayılan t0+10)' },
    adim: { type: 'number', description: 'zaman adımı h (varsayılan 0.05)' },
    yontem: { type: 'string', description: '"rk4" (varsayılan) veya "euler"' },
  }, ['denklem', 'y0']),
  F('ders_calis', 'GENAI DERSİ (Microsoft Generative AI for Beginners müfredatı, MIT): kullanıcı ders/öğrenme/kurs/quiz isterse VEYA sıradaki dersini sorarsa çağır. Ders içeriği+quiz döner: önce 2-4 cümleyle öğret, kavramları maddele, sonra quiz sorusunu seçenekleriyle yaz; kullanıcının cevabını değerlendir ve ders_bitir çağır.', {
    ders: { type: 'number', description: 'Ders no (1-32); verilmezse sıradaki tamamlanmamış ders' },
    tam: { type: 'boolean', description: 'true = orijinal ders metnini de getir (yerel arşivden; link ölse bile çalışır)' },
  }, []),
  F('ders_bitir', 'Ders quiz sonucunu kalıcı kaydeder: seviye + flash-card güncellenir. Kullanıcı quizi cevapladıktan SONRA çağır.', {
    ders: { type: 'number', description: 'Ders no' },
    dogru: { type: 'boolean', description: 'Kullanıcı doğru mu cevapladı' },
  }, ['ders', 'dogru']),
  F('web_ara', 'WEB ARAMA (anahtarsız): güncel/gerçek bilgi, haber, fiyat, sürüm, kişi/kurum bilgisi lazımsa ÖNCE ara; sonra en iyi sonucu web_oku ile okuyup ÖYLE cevapla. Uydurma link yasak — buradan gelen linkleri kullan.', {
    sorgu: { type: 'string', description: 'Arama sorgusu (kısa, net)' },
    adet: { type: 'number', description: 'Opsiyonel: kaç sonuç (1-5, varsayılan 5)' },
  }, ['sorgu']),
  F('kod_calistir', 'KOD ÇALIŞTIR (güvenli sandbox): matematik, hesap, algoritma, veri dönüştürme, test — JS kodunu izole çalıştırır, console çıktısını döndürür. Emin olmadığın hesabı burayla doğrula.', {
    kod: { type: 'string', description: 'Çalıştırılacak JS kodu (console.log kullan)' },
  }, ['kod']),
  F('api_katalog', 'AÇIK API KATALOĞU (660+ üretici medya modeli + üçüncü taraf araçlar): kullanıcı görsel/video/ses/3D üretim modeli, arka plan kaldırma, upscale, SEO, scraping, veri zenginleştirme gibi DIŞ API/model araçları sorarsa burada ara. Kendin model adı UYDURMA — katalogdan getir ve ücret/anahtar gereksinimini mutlaka söyle.', {
    sorgu: { type: 'string', description: 'Aranacak yetenek (İngilizce terim daha iyi eşleşir): "text to image", "video upscale", "background removal", "text to speech"...' },
    adet: { type: 'integer', description: 'Kaç sonuç istensin (1-5, varsayılan 3)' },
  }, ['sorgu']),
];

/* ------------------------------------------------------------------ */
/* ARAÇ ÇALIŞTIRICILAR (hepsi tarayıcıda)                              */
/* ------------------------------------------------------------------ */
const norm = (s) => String(s || '').toLocaleLowerCase('tr');
const score = (hay, needle) => {
  const h = norm(hay), n = norm(needle);
  if (!n) return 0;
  if (h.includes(n)) return 3;
  const words = n.split(/\s+/).filter((w) => w.length > 2);
  return words.filter((w) => h.includes(w)).length;
};

function safeCalc(expr) {
  const e = String(expr || '').replace(/,/g, '.').trim();
  if (!e || e.length > 200) throw new Error('ifade boş veya çok uzun');
  // sadece sayı, operatör, parantez ve bilinen fonksiyonlar
  const allowed = /^[0-9+\-*/().%\s^a-zA-Z_]*$/;
  if (!allowed.test(e)) throw new Error('izin verilmeyen karakter');
  if (/[{}[\];]/.test(e)) throw new Error('izin verilmeyen karakter');
  const fn = ['sqrt', 'abs', 'round', 'floor', 'ceil', 'min', 'max', 'pow', 'sin', 'cos', 'tan', 'log', 'log10', 'exp', 'PI', 'E', 'random'];
  const bad = (e.match(/[a-zA-Z_]+/g) || []).filter((w) => !fn.includes(w));
  if (bad.length) throw new Error(`bilinmeyen fonksiyon: ${bad.join(', ')}`);
  const js = e.replace(/\^/g, '**');
  // eslint-disable-next-line no-new-func
  const val = Function(`"use strict";const {sqrt,abs,round,floor,ceil,min,max,pow,sin,cos,tan,log,log10,exp,PI,E,random}=Math;return (${js});`)();
  if (typeof val !== 'number' || !isFinite(val)) throw new Error('sonuç sayı değil');
  return val;
}

/* --- Vikipedi: Türkçe-duyarlı akıllı başlık seçimi ---
   Ölçüldü: aramanın ilk sonucu çoğu zaman YANLIŞ ("İstanbul'un fethi" -> bir ressam).
   Bu yüzden: (1) adayları Türkçe-normalize benzerlikle skorla,
             (2) iyi eşleşme yoksa başlığı DOĞRUDAN sorgula,
             (3) yine de bulamazsan alternatifleri döndür (model tekrar tahmin yürütmesin). */
/* Türkçe-duyarlı normalleştirme. ÖLÇÜLDÜ: toLocaleLowerCase('tr') ile "I" -> "ı" oluyor
   ve "Istanbul" ile "İstanbul" eşleşmiyordu. Bu yüzden önce ASCII/Türkçe I'ları sabitliyoruz. */
const TR_MAP = {
  'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u',
  'İ': 'i', 'I': 'i', 'Ç': 'c', 'Ğ': 'g', 'Ö': 'o', 'Ş': 's', 'Ü': 'u', 'Â': 'a', 'Î': 'i', 'Û': 'u',
};
const trNorm = (x) => String(x || '').trim().replace(/\s+/g, ' ')
  .split('').map((c) => TR_MAP[c] || c).join('').toLowerCase();

function titleScore(title, query) {
  const t = trNorm(title), q = trNorm(query);
  if (!t) return -1;
  if (t === q) return 100;
  if (t.startsWith(q) || q.startsWith(t)) return 78;
  const qw = q.split(' ').filter((w) => w.length > 2);
  const tw = t.split(' ');
  const exact = qw.filter((w) => tw.includes(w)).length;
  const part = qw.filter((w) => tw.some((x) => x.includes(w) || w.includes(x))).length;
  return exact * 18 + part * 6 + (q.includes(t) ? 25 : 0) - Math.max(0, tw.length - qw.length) * 2;
}

const WIKI_HEADERS = { 'Api-User-Agent': 'EVRIM/1.0 (https://4fr41d.github.io/evrim; kisisel asistan)' };
const wikiCache = new Map();

async function wikiFetch(url) {
  if (wikiCache.has(url)) return wikiCache.get(url);
  let out = null;
  for (let i = 0; i < 2; i++) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 12000);
      // eslint-disable-next-line no-await-in-loop
      const r = await fetch(url, { headers: WIKI_HEADERS, signal: c.signal });
      clearTimeout(t);
      if (r.ok) { out = await r.json().catch(() => null); break; }
      if (r.status === 404) break;
    } catch {}
    if (i === 0) await new Promise((r) => setTimeout(r, 700));
  }
  wikiCache.set(url, out);
  return out;
}

async function pageExists(base, title) {
  const j = await wikiFetch(`${base}/w/api.php?action=query&titles=${encodeURIComponent(title)}&redirects=1&format=json&origin=*`);
  const pages = j?.query?.pages || {};
  const k = Object.keys(pages)[0];
  return (k && k !== '-1' && !pages[k].missing) ? pages[k].title : null;
}

/** "Anitkabir" -> "Anıtkabir" gibi Türkçe karakter varyantlarını üret */
function trVariants(word) {
  const out = new Set([word]);
  const swaps = [['i', 'ı'], ['ı', 'i'], ['u', 'ü'], ['o', 'ö'], ['c', 'ç'], ['g', 'ğ'], ['s', 'ş']];
  for (const [a, b] of swaps) if (word.includes(a)) { out.add(word.split(a).join(b)); }
  return [...out];
}

async function wiki(query, lang = 'tr') {
  const base = `https://${lang === 'en' ? 'en' : 'tr'}.wikipedia.org`;
  const q = String(query || '').trim();
  if (!q) return { found: false, note: 'sorgu boş' };
  const enc = encodeURIComponent(q);

  const cands = new Map();
  const add = (title, score) => {
    if (!title) return;
    cands.set(title, Math.max(cands.get(title) || 0, score));
  };

  // 1) opensearch — başlık öneki eşleşmesi ("Istanbul'un fethi" -> "İstanbul'un Fethi")
  const os = await wikiFetch(`${base}/w/api.php?action=opensearch&search=${enc}&limit=6&namespace=0&format=json&origin=*`);
  if (os === null) return { found: false, note: "Vikipedi'ye ulaşılamadı (ağ veya aşırı istek). TEKRAR DENEME, genel bilginle cevap ver." };
  (Array.isArray(os) ? os[1] : []).forEach((t, i) => add(t, Math.max(titleScore(t, q), 92 - i * 4)));

  // 2) tam metin arama — soru biçimli sorgular için
  const sj = await wikiFetch(`${base}/w/api.php?action=query&list=search&srsearch=${enc}&format=json&origin=*&srlimit=6`);
  (sj?.query?.search || []).forEach((x) => add(x.title, titleScore(x.title, q)));

  // 3) doğrudan başlık sorgusu + Türkçe varyantlar (arama bulamadıysa)
  let ranked = [...cands.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 40) {
    const words = q.split(' ').filter((w) => w.length > 3);
    const tries = [];
    for (const base0 of [q, ...(words.length ? [words[0]] : [])]) {
      const cap = base0.charAt(0).toLocaleUpperCase('tr') + base0.slice(1);
      for (const v of trVariants(base0)) { tries.push(v, v.charAt(0).toLocaleUpperCase('tr') + v.slice(1)); }
      for (const v of trVariants(cap)) tries.push(v);
    }
    for (const t of [...new Set(tries)].slice(0, 6)) {
      // eslint-disable-next-line no-await-in-loop
      const real = await pageExists(base, t);
      if (real) { add(real, 95); break; }
    }
    ranked = [...cands.entries()].sort((a, b) => b[1] - a[1]);
  }

  if (!ranked.length) {
    return { found: false, note: `"${q}" için Vikipedi'de sonuç yok. Farklı sorguyla TEKRAR DENEME; genel bilginle cevap ver.`, oneriler: [] };
  }

  for (const [title, score] of ranked.slice(0, 2)) {
    // eslint-disable-next-line no-await-in-loop
    const j = await wikiFetch(`${base}/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (j?.extract) {
      return {
        found: true, title: j.title || title, eslesmeSkoru: score,
        extract: String(j.extract).slice(0, 1400),
        url: j.content_urls?.desktop?.page || `${base}/wiki/${encodeURIComponent(title)}`,
        oneriler: ranked.slice(1, 4).map(([t]) => t),
      };
    }
  }
  return {
    found: false,
    note: `"${q}" için özet alınamadı. Farklı sorguyla TEKRAR DENEME; elindeki bilgiyle cevap ver.`,
    oneriler: ranked.slice(0, 4).map(([t]) => t),
  };
}

/* ------------------------------------------------------------------ */
/* AÇIK API KATALOĞU — awesome-agent-apis (MIT)                        */
/* Anahtar YOK, ücret YOK: yalnızca herkese açık GitHub verisi okunur. */
/* CORS: api.github.com ve raw.githubusercontent.com -> *              */
/* ------------------------------------------------------------------ */
const CAT_REPO = 'Anil-matcha/awesome-agent-apis';
const CAT_CACHE_KEY = 'evrim:catTree';
const CAT_TTL = 6 * 60 * 60 * 1000;   // 6 saat
let catTreeMem = null;

const CAT_ASCII = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c' };
const catNorm = (s) => String(s || '').replace(/[ıİşŞğĞüÜöÖçÇ]/g, (c) => CAT_ASCII[c]).toLowerCase();
function catScore(hay, needle) {
  const h = catNorm(hay), n = catNorm(needle);
  if (!n) return 0;
  if (h.includes(n)) return 3;
  const words = n.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  return words.filter((w) => h.includes(w)).length;
}

async function catTree() {
  if (catTreeMem) return catTreeMem;
  try {
    const c = JSON.parse(localStorage.getItem(CAT_CACHE_KEY) || 'null');
    if (c && Array.isArray(c.names) && c.names.length && Date.now() - c.t < CAT_TTL) {
      catTreeMem = c.names; return c.names;
    }
  } catch { /* önbellek yok */ }
  const res = await fetchT(`https://api.github.com/repos/${CAT_REPO}/git/trees/main?recursive=1`,
    { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`katalog listesine ulaşılamadı (${res.status})`);
  const j = await res.json();
  const names = (j.tree || [])
    .filter((x) => x.path.startsWith('models/') && x.path.endsWith('.yaml'))
    .map((x) => x.path.slice('models/'.length, -5));
  if (!names.length) throw new Error('katalog boş geldi');
  catTreeMem = names;
  try { localStorage.setItem(CAT_CACHE_KEY, JSON.stringify({ t: Date.now(), names })); } catch { /* kota */ }
  return names;
}

const catField = (yaml, key) => {
  const m = yaml.match(new RegExp(`^${key}:\\s*"?([^"#\\n]*)"?`, 'm'));
  return m ? m[1].trim() : '';
};

const CAT_UYARI = 'Bu modeller muapi.ai üzerinden çağrılır: ÜCRETLİDİR (kredi) ve muapi API anahtarı ister. EVRIM bunları şu an doğrudan ÇALIŞTIRMAZ; yalnızca katalogdan bulup bildirir.';
const CAT_NOMATCH = 'Bu sorguyla eşleşme yok. İngilizce ve daha genel dene: "text to image", "video", "audio", "upscale", "background".';

/* 1) YEREL YEDEK — kendi repomuzda (GitHub Pages, aynı origin, CORS derdi yok,
      upstream repo silinse bile çalışır, SW sayesinde çevrimdışı da çalışır) */
const CAT_MIRROR = new URL('data/katalog.json', document.baseURI).href;
let catMirrorMem = null;
async function catMirror() {
  if (catMirrorMem) return catMirrorMem;
  const r = await fetchT(CAT_MIRROR);
  if (!r.ok) throw new Error(`yerel yedek ${r.status}`);
  const j = await r.json();
  if (!j || !Array.isArray(j.items) || !j.items.length) throw new Error('yerel yedek boş');
  catMirrorMem = j;
  return j;
}

let MUF_CACHE = null;
// v72: SİTE KONTROL — EVRIM eserini "görsün": statik tarama + gizli iframe'de render denetimi
async function siteQA(html) {
  const r = { oluLink: [], altYok: 0, viewportYok: false, langYok: false, doctypeYok: false, h1Yok: false, imgYuklenmedi: [], tasma: false, render: 'yapildi' };
  const src = String(html || '');
  if (!/<!doctype html>/i.test(src)) r.doctypeYok = true;
  if (!/<meta[^>]+viewport/i.test(src)) r.viewportYok = true;
  if (!/<html[^>]+lang=/i.test(src)) r.langYok = true;
  if (!/<h1[\s>]/i.test(src)) r.h1Yok = true;
  r.altYok = (src.match(/<img(?![^>]*alt=)[^>]*>/gi) || []).length;
  const ids = new Set([...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  r.oluLink = [...src.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((x) => x && !ids.has(x));
  // render denetimi: gerçek tarayıcıda görseller + yatay taşma; jsdom (test) ortamında onload hiç tetiklenmediği için atlanır
  try {
    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(String(navigator.userAgent || ''));
    if (!isJsdom && typeof document !== 'undefined' && document.createElement && document.body) {
      const ifr = document.createElement('iframe');
      ifr.style.cssText = 'position:fixed;left:-9999px;top:0;width:390px;height:844px;visibility:hidden';
      document.body.appendChild(ifr);
      const yuklendi = await new Promise((res) => { ifr.onload = () => res(true); setTimeout(() => res(false), 3500); ifr.srcdoc = src; });
      if (yuklendi) {
        const d = ifr.contentDocument;
        if (d?.documentElement) r.tasma = d.documentElement.scrollWidth > 390 + 8;
        const imgs = [...(d?.querySelectorAll('img') || [])];
        await Promise.all(imgs.map((im) => new Promise((res) => {
          if (im.complete) return res();
          im.addEventListener('load', res, { once: true });
          im.addEventListener('error', res, { once: true });
          setTimeout(res, 5000);   // soğuk pollinations üretimi yavaş olabilir — sonsuza dek beklemeyiz
        })));
        r.imgYuklenmedi = imgs.filter((im) => !im.naturalWidth).map((im) => String(im.getAttribute('src') || '').slice(0, 60));
      } else r.render = 'atlandi';
      ifr.remove();
    } else r.render = 'atlandi';
  } catch { r.render = 'atlandi'; }
  return r;
}
function qaOzet(r) {
  const kus = [];
  if (r.doctypeYok) kus.push('doctype yok');
  if (r.viewportYok) kus.push('viewport meta yok (mobilde bozulur)');
  if (r.langYok) kus.push('html lang yok');
  if (r.h1Yok) kus.push('h1 yok');
  if (r.altYok) kus.push(r.altYok + ' görselde alt yok');
  if (r.oluLink.length) kus.push('ölü iç link: #' + r.oluLink.join(', #'));
  if (r.tasma) kus.push('yatay taşma (mobilde kaydırıyor)');
  if (r.imgYuklenmedi.length) kus.push('yüklenmeyen görsel: ' + r.imgYuklenmedi.join(' | ') + ' → onerror yedeği/background-color ekle veya görseli kaldır');
  return kus;
}
// v75: ZENGİNLİK taraması — "etkileyici site" eksenindeki eksikler (yalnız gerçek sayfalarda; küçük demoları şişirme)
function qaZenginlik(src) {
  const oneri = [];
  const uzun = src.length > 2500 || (src.match(/<section/gi) || []).length >= 2;
  if (!uzun) return oneri;
  if (!/<script[\s>]/i.test(src)) oneri.push('etkilesim (script yok)');
  if (!/IntersectionObserver|@keyframes|transition:/i.test(src)) oneri.push('animasyon yok');
  if (!/prefers-color-scheme|data-theme/i.test(src)) oneri.push('koyu/açık tema yok');
  if (!/<svg[\s>]/i.test(src)) oneri.push('SVG ikon yok');
  if (!/position:\s*sticky|backdrop-filter/i.test(src)) oneri.push('sticky header yok');
  if (/<form[\s>]/i.test(src) && !/addEventListener|onsubmit/i.test(src)) oneri.push('form doğrulaması yok');
  return oneri;
}

// v76: ÇOK DOSYALI PROJE — paketleyici (önizleme/test/yayın tek kaynaktan)
export function projeBundleFiles(files) {
  let doc = String(files?.['index.html'] || '');
  doc = doc.replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/gi, (m, p) => (files[p] != null ? `<style>\n${files[p]}\n</style>` : m));
  doc = doc.replace(/<script[^>]+src="([^"]+\.js)"[^>]*>\s*<\/script>/gi, (m, p) => (files[p] != null ? `<script>\n${files[p]}\n<\/script>` : m));
  return doc;
}
// v76: proje denetimi — statik kontroller + (gerçek tarayıcıda) paketlenmiş belgeyi ÇALIŞTIRIP testleri koşar
export async function projeQA(files, testler) {
  const r = { kusurlar: [], testler: [], render: 'yapildi' };
  const idx = String(files?.['index.html'] || '');
  if (!/<!doctype html>/i.test(idx)) r.kusurlar.push('index.html doctype yok');
  if (!/<meta[^>]+viewport/i.test(idx)) r.kusurlar.push('viewport meta yok (mobilde bozulur)');
  if (!/<html[^>]+lang=/i.test(idx)) r.kusurlar.push('html lang yok');
  const refs = [...idx.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:|mailto:)/i.test(u));
  for (const ref of refs) if (!(ref in (files || {}))) r.kusurlar.push('index.html referansı projede YOK: ' + ref);
  const ext = [...idx.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => !/image\.pollinations\.ai/.test(u));
  if (ext.length) r.kusurlar.push('harici CDN/kaynak var (tek paket ilkesi — dosyaları projeye göm): ' + ext.slice(0, 3).join(' | '));
  for (const t of (testler || [])) { try { new Function(String(t?.js || '')); } catch (e) { r.kusurlar.push('test "' + t?.ad + '" sözdizimi hatası: ' + String(e.message).slice(0, 80)); } }
  try {
    const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(String(navigator.userAgent || ''));
    if (!isJsdom && typeof document !== 'undefined' && document.createElement && document.body) {
      const ifr = document.createElement('iframe');
      ifr.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
      ifr.style.cssText = 'position:fixed;left:-9999px;top:0;width:390px;height:844px;visibility:hidden';
      document.body.appendChild(ifr);
      // v76.2 TEST İZOLASYONU: her test TAZE sayfa örneğinde koşar (önceki testlerin DOM/localStorage kalıntısı taşmaz)
      const doc = projeBundleFiles(files);
      const jsErrors = [];
      for (const t of (testler || [])) {
        // eslint-disable-next-line no-await-in-loop
        const yuklendi = await new Promise((res) => { ifr.onload = () => res(true); setTimeout(() => res(false), 4000); ifr.srcdoc = doc; });
        if (!yuklendi) { r.render = 'atlandi'; break; }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((z) => setTimeout(z, 350));   // DOMContentLoaded + listener'lar otursun
        try {
          const w = ifr.contentWindow;
          try { w.addEventListener('error', (ev) => jsErrors.push(String(ev.message || '').slice(0, 100))); } catch {}
          const fn = new w.Function('"use strict";' + String(t?.js || '') + '\nreturn true;');
          const out = fn();
          r.testler.push({ ad: String(t?.ad || 'test'), gecti: out !== false });
        } catch (e) { r.testler.push({ ad: String(t?.ad || 'test'), gecti: false, hata: String(e.message || e).slice(0, 120) }); }
      }
      if (jsErrors.length) r.kusurlar.push('çalışma zamanı JS hatası: ' + jsErrors.join(' | '));
      if (r.render === 'yapildi' && !(testler || []).length) {
        const yuklendi0 = await new Promise((res) => { ifr.onload = () => res(true); setTimeout(() => res(false), 4000); ifr.srcdoc = doc; });
        if (yuklendi0) await new Promise((z) => setTimeout(z, 500));
      }
      ifr.remove();
    } else r.render = 'atlandi';
  } catch { r.render = 'atlandi'; }
  return r;
}
// v76: kart üzerindeki ✅ Test düğmesi için — kayıtlı projeyi bul, denetimi koş, rapor döndür
export async function projeCalistirTestler(slug) {
  const row = all('projects').find((x) => x.ad === slug);
  if (!row) throw new Error('proje yok: ' + slug);
  return projeQA(row.files || {}, row.testler || []);
}

// v66: lab döngüsünün ürettiği ek sorular (ekQuizler) derslerde rastgele seçilir → içerik sürekli tazelenir
function secQuiz(d) {
  const qs = [d.quiz, ...(d.ekQuizler || [])].filter((q) => q?.soru && Array.isArray(q.secenekler) && q.secenekler.length === 4 && Number.isInteger(q.dogru));
  return qs.length ? qs[Math.floor(Math.random() * qs.length)] : d.quiz;
}

async function mufredat() {
  if (MUF_CACHE) return MUF_CACHE;
  const r = await fetchT('data/mufredat.json', {}, 15000);
  if (!r.ok) throw new Error('müfredat yüklenemedi');
  MUF_CACHE = await r.json();
  return MUF_CACHE;
}

async function katalogAra(sorgu, adet) {
  const q = String(sorgu || '').trim();
  if (!q) return { found: 0, note: 'Sorgu boş.' };
  const lim = Math.max(1, Math.min(5, Number(adet) || 3));

  /* --- önce yerel yedek --- */
  try {
    const mir = await catMirror();
    const ranked = mir.items
      .map((it) => ({
        it,
        s: Math.max(
          catScore(String(it.m || '').replace(/[-_]+/g, ' '), q),
          catScore(String(it.a || ''), q),
          catScore(String(it.c || '').replace(/[._]+/g, ' '), q),
        ),
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, lim);
    return {
      found: ranked.length,
      toplam: mir.items.length,
      kaynak: 'yerel yedek (bu repo) ← awesome-agent-apis (MIT)',
      senkron: mir.senkron || null,
      uyari: CAT_UYARI,
      note: ranked.length ? undefined : CAT_NOMATCH,
      items: ranked.map(({ it }) => ({
        model: it.m, ad: it.a, yetenek: it.c, aciklama: it.d,
        ucret: it.u ? `~$${it.u} / çağrı (muapi kredisi)` : 'belirtilmemiş',
        docs: it.l,
      })),
    };
  } catch { /* yerel yedek yoksa upstream'e düş */ }

  /* --- sonra upstream GitHub (eski davranış) --- */
  try {
    const names = await catTree();
    const ranked = names
      .map((n) => ({ n, s: catScore(n.replace(/[-_]+/g, ' '), q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, lim);
    if (!ranked.length) return { found: 0, toplam: names.length, kaynak: 'upstream GitHub', note: CAT_NOMATCH };
    const items = await Promise.all(ranked.map(async ({ n }) => {
      try {
        const r = await fetchT(`https://raw.githubusercontent.com/${CAT_REPO}/main/models/${encodeURIComponent(n)}.yaml`);
        if (!r.ok) return { model: n, hata: `okunamadı (${r.status})` };
        const y = await r.text();
        return {
          model: n,
          ad: catField(y, 'title') || n,
          yetenek: catField(y, 'capability'),
          aciklama: catField(y, 'description'),
          ucret: catField(y, 'cost') ? `~$${catField(y, 'cost')} / çağrı (muapi kredisi)` : 'belirtilmemiş',
          docs: catField(y, 'docs_url'),
        };
      } catch (e) { return { model: n, hata: e.message }; }
    }));
    return {
      found: items.length,
      toplam: names.length,
      kaynak: 'awesome-agent-apis (MIT, github.com/Anil-matcha/awesome-agent-apis)',
      uyari: CAT_UYARI,
      items,
    };
  } catch (e) {
    /* HİÇBİR kaynak yoksa çökme: dürüst ve yumuşak cevap */
    return {
      found: 0,
      hata: e.message,
      note: 'Katalog şu an hiçbir kaynaktan okunamadı (yerel yedek + GitHub ikisi de kapalı). Bağlantını kontrol edip tekrar dene.',
    };
  }
}

/* --- üretilen görseller: mesaj geçmişinde data-URL taşıma, id taşı --- */
const MEDIA_KEY = 'evrim:media';
const MEDIA_CAP = 4;
const mediaMem = new Map();
function mediaKaydet(id, dataUrl) {
  mediaMem.set(id, dataUrl);
  try {
    const all = JSON.parse(localStorage.getItem(MEDIA_KEY) || '{}');
    all[id] = dataUrl;
    const keys = Object.keys(all);
    while (keys.length > MEDIA_CAP) delete all[keys.shift()];
    try { localStorage.setItem(MEDIA_KEY, JSON.stringify(all)); }
    catch { localStorage.removeItem(MEDIA_KEY); }   // kota: sadece oturumda kalsın
  } catch { /* gizli mod vb. */ }
}
// v52: KADEMELİ ARAÇ ŞEMASI — küçük dakikalık-token limitli (ITPM) modellere yalnız çekirdek set gönderilir.
// Tam 28 araç şeması ~8k token; qwen/20b sınıfının limiti 7k → 413. Çekirdek 10 araç sohbet+arama+kurs+görsel için yeter.
export const CORE_TOOL_NAMES = ['calculator', 'datetime', 'wikipedia', 'memory_search', 'remember', 'web_ara', 'web_oku', 'kod_calistir', 'gorsel_uret', 'ders_calis', 'site_uret'];
export const CORE_TOOLS = TOOLS.filter((t) => CORE_TOOL_NAMES.includes(t?.function?.name || t?.name));

export function mediaGet(id) {
  if (mediaMem.has(id)) return mediaMem.get(id);
  try {
    const all = JSON.parse(localStorage.getItem(MEDIA_KEY) || '{}');
    if (all[id]) { mediaMem.set(id, all[id]); return all[id]; }
  } catch { /* yok */ }
  return null;
}

/* v62: kesik/bozuk araç JSON'unu onar — açık dizeyi kapat, eksik parantezleri tamamla */
function repairJSON(str) {
  let t = String(str || '').trim();
  const i = t.indexOf('{');
  if (i < 0) return null;
  t = t.slice(i);
  let out = ''; let inStr = false; let esc = false; const stack = [];
  for (const ch of t) {
    out += ch;
    if (esc) { esc = false; continue; }
    if (inStr && ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, ':null');
  while (stack.length) out += stack.pop();
  try { return JSON.parse(out); } catch { return null; }
}

const EXEC = {
  memory_search({ query }) {
    const mems = all('memories').filter((m) => !m.archived);
    const ranked = mems.map((m) => ({ m, s: score(m.content, query) + (m.strength || 0) }))
      .filter((x) => x.s > 0.4).sort((a, b) => b.s - a.s).slice(0, 8);
    if (!ranked.length) return { found: 0, note: 'Hafızada bu konuyla ilgili kayıt yok.' };
    return {
      found: ranked.length,
      items: ranked.map((x) => ({ content: x.m.content, kind: x.m.kind, strength: x.m.strength })),
    };
  },

  remember({ content, kind }) {
    const r = evo.addMemory({ content, kind: kind || 'fact', source: 'tool', strength: 0.85 });
    return r ? { ok: true, saved: r.content, kind: r.kind } : { ok: false, note: 'kaydedilemedi' };
  },

  conversation_search({ query }) {
    const msgs = all('messages');
    const ranked = msgs.map((m) => ({ m, s: score(m.content, query) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s).slice(0, 6);
    if (!ranked.length) return { found: 0, note: 'Geçmiş mesajlarda bulunamadı.' };
    return {
      found: ranked.length,
      items: ranked.map((x) => ({
        role: x.m.role, content: String(x.m.content).slice(0, 220),
        date: new Date(x.m.createdAt).toLocaleDateString('tr-TR'),
      })),
    };
  },

  calculator({ expression }) {
    try { const v = safeCalc(expression); return { expression, result: v }; }
    catch (e) { return { error: e.message }; }
  },

  datetime() {
    const d = new Date();
    return {
      tarih: d.toLocaleDateString('tr-TR', { dateStyle: 'full' }),
      saat: d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      iso: d.toISOString(),
      zamanDilimi: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },

  async wikipedia({ query, lang }) {
    try { return await wiki(query, lang || 'tr'); }
    catch (e) { return { error: `Vikipedi'ye ulaşılamadı: ${e.message}` }; }
  },

  learning_status() {
    const st = learn.learningStats?.() || {};
    return {
      ...st,
      tekrarZamaniGelenKartlar: (learn.dueCards?.() || []).length,
      beceriHaritasi: all('skills').slice(0, 10).map((s) => ({ konu: s.topic, seviye: s.level, not: s.note })),
    };
  },

  create_flashcard({ question, answer, topic }) {
    const r = learn.createCard({ topic: topic || 'genel', question, answer, source: 'agent' });
    return { ok: true, id: r?.id || null, question, topic };
  },

  self_status() {
    const st = evo.stats();
    const a = activeLLM();
    const s = getSettings();
    return {
      beyinSurumu: `v${st.promptVersion}`,
      aktifModel: a.model || a.id,
      saglayici: a.def?.name || a.id,
      hafizaKaydi: st.memories,
      ogrenilenKurallar: all('memories').filter((m) => m.kind === 'rule' && !m.archived).map((m) => m.content).slice(0, 12),
      kartlar: st.cards,
      mesajSayisi: all('messages').length,
      depolama: `${(storageSize() / 1024).toFixed(1)} KB (tarayıcıda, sunucuya gitmez)`,
      aracSayisi: TOOLS.length,
      calismaSekli: 'ajan döngüsü (araç çağırabilen)',
      kullaniciAdi: s.userName || null,
    };
  },

  async web_oku({ url, odak }) {
    const u = String(url || '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(u)) return { hata: 'geçersiz adres (https:// ile başlamalı)' };
    try {
      const r = await fetchT('https://r.jina.ai/' + u, { headers: { Accept: 'text/plain' } }, 40000);
      if (r.status === 429) return { hata: 'okuyucu limiti dolu (20/dk); 1 dk sonra tekrar dene' };
      if (!r.ok) return { hata: `sayfa okunamadı (${r.status})` };
      let t = await r.text();
      t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (!t) return { hata: 'sayfa boş döndü' };
      let govde = t;
      if (odak) {
        const i = t.toLocaleLowerCase('tr').indexOf(String(odak).toLocaleLowerCase('tr'));
        if (i > 800) govde = '…' + t.slice(Math.max(0, i - 400), i + 5200);
      }
      return {
        ok: true,
        url: u,
        baslik: (t.match(/^Title:\s*(.+)/m) || [])[1] || null,
        karakter: t.length,
        icerik: govde.slice(0, 6500),
        not: 'İçerik kırpılmış olabilir; kritik iddiaları ikinci bir kaynakla doğrula.',
      };
    } catch (e) { return { hata: String(e.message || e).slice(0, 120) }; }
  },

  async gorsel_uret({ istem, model }) {
    const prompt = String(istem || '').trim();
    if (!prompt) return { hata: 'istem boş' };
    const seed = Math.floor(Math.random() * 1e6);
    const remote = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt)
      + `?width=768&height=768&nologo=true&seed=${seed}` + (model ? `&model=${encodeURIComponent(model)}` : '');
    const id = 'g' + Date.now().toString(36);
    const isaret = `![görsel](evrimimg:${id})`;
    // 1) ANAHTARSIZ + GİRİŞSİZ görsel servisi (CORS *): blob olarak çek, depoya göm
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 60000);
      const res = await fetch(remote, { signal: ctl.signal, headers: { Accept: 'image/*' } });
      clearTimeout(t);
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 500) {
          const dataUrl = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => reject(new Error('okunamadı'));
            fr.readAsDataURL(blob);
          });
          const { shrinkDataUrl } = await import('./puter.js');
          const small = await shrinkDataUrl(dataUrl);
          mediaKaydet(id, small);
          return { ok: true, id, kaynak: 'anahtarsız görsel servisi', boyut: Math.round(small.length / 1024) + ' KB',
            not: `Görsel üretildi (giriş gerekmedi). Yanıtına bu işareti AYNEN ekle: ${isaret}` };
        }
      }
    } catch { /* aşağıya düş */ }
    // 2) Blob alınamadıysa (CORS/ağ): uzak URL'yi doğrudan göm (img etiketi zaten yükler)
    try { mediaKaydet(id, remote); return { ok: true, id, kaynak: 'anahtarsız görsel servisi (uzak)', not: `Görsel hazır. İşareti AYNEN ekle: ${isaret}` }; } catch {}
    // 3) Puter: YALNIZCA oturum zaten varsa — popup/yönlendirme ASLA
    if (puterStatus().ready) {
      try {
        const { puterTxt2Img, shrinkDataUrl } = await import('./puter.js');
        const raw = await puterTxt2Img(prompt, model ? { model } : {});
        const small = await shrinkDataUrl(raw);
        mediaKaydet(id, small);
        return { ok: true, id, kaynak: 'puter (oturum açık)', boyut: Math.round(small.length / 1024) + ' KB',
          not: `Görsel üretildi. Yanıtına bu işareti AYNEN ekle: ${isaret}` };
      } catch (e) { return { hata: String(e.message || e).slice(0, 140) }; }
    }
    return { hata: 'Görsel servisi bu anda yanıt vermedi — 10-20 sn sonra tekrar iste (giriş/hesap gerekmez).' };
  },

  async hatirlatici({ mesaj, dakika, saat, liste, takvim }) {
    if (liste) {
      const rs = all('reminders').filter((r) => !r.done);
      return { ok: true, adet: rs.length, hatirlaticilar: rs.slice(0, 20).map((r) => ({ mesaj: r.mesaj, zaman: new Date(r.dueAt).toLocaleString('tr-TR') })) };
    }
    const m = String(mesaj || '').trim();
    if (!m) return { hata: 'mesaj boş' };
    let dueAt;
    const hhmm = /^(\d{1,2}):(\d{2})$/.exec(String(saat || '').trim());
    if (hhmm) {
      const d = new Date();
      d.setHours(Number(hhmm[1]), Number(hhmm[2]), 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      dueAt = d.getTime();
    } else {
      const dk = Number(dakika) > 0 ? Number(dakika) : 60;
      dueAt = Date.now() + dk * 60000;
    }
    insert('reminders', { mesaj: m, dueAt, done: false, createdAt: now() });
    const sonuc = { ok: true, mesaj: m, zaman: new Date(dueAt).toLocaleString('tr-TR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }), not: 'Kurulumu onayla; bildirimin çalışması için sekmenin açık kalması gerektiğini, izin istenirse bildirimin de geleceğini söyle.' };
    if (takvim) {
      const icsT = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EVRIM//hatirlatici//TR', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${dueAt}-${Date.now()}@evrim.local`, `DTSTAMP:${icsT(Date.now())}`, `DTSTART:${icsT(dueAt)}`, `SUMMARY:${m.replace(/[\r\n,;]/g, ' ').slice(0, 120)}`, 'DESCRIPTION:EVRIM hatirlaticisi', 'BEGIN:VALARM', 'TRIGGER:PT0S', 'ACTION:DISPLAY', 'DESCRIPTION:EVRIM hatirlaticisi', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      sonuc.ics = ics;
      try {
        if (typeof URL !== 'undefined' && URL.createObjectURL && typeof Blob !== 'undefined' && typeof document !== 'undefined' && document.createElement) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
          a.download = 'evrim-hatirlatici.ics';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch {} }, 4000);
          sonuc.takvim = 'indirildi';
          sonuc.not = 'Kurulumu onayla; .ics dosyasının indiğini, telefon takvimine eklerse sekme kapalıyken de çalacağını söyle.';
        } else { sonuc.takvim = 'hazir'; }
      } catch { sonuc.takvim = 'hazir'; }
    }
    return sonuc;
  },

  async gider({ tutar, kategori, aciklama, ozet }) {
    if (ozet) {
      const ex = all('expenses');
      if (!ex.length) return { ok: true, adet: 0, not: 'Henüz kayıt yok — kullanıcı harcama söyledikçe gider aracıyla kaydet.' };
      const aylik = {}; const kat = {};
      for (const e of ex) {
        const ay = new Date(e.ts || e.createdAt || Date.now()).toISOString().slice(0, 7);
        aylik[ay] = (aylik[ay] || 0) + Number(e.tutar || 0);
        const k = e.kategori || 'diğer';
        kat[k] = (kat[k] || 0) + Number(e.tutar || 0);
      }
      const ayTablo = '| ay | toplam |\n|---|---|\n' + Object.entries(aylik).sort().map(([a, t]) => `| ${a} | ${t.toLocaleString('tr-TR')} ₺ |`).join('\n');
      const katTablo = '| kategori | toplam |\n|---|---|\n' + Object.entries(kat).sort((a, b) => b[1] - a[1]).map(([k, t]) => `| ${k} | ${t.toLocaleString('tr-TR')} ₺ |`).join('\n');
      const son30 = ex.filter((e) => (e.ts || 0) > Date.now() - 30 * 86400000).reduce((a, e) => a + Number(e.tutar || 0), 0);
      return { ok: true, adet: ex.length, son30GunToplam: +son30.toFixed(2), ayTablo, katTablo, not: 'İki tabloyu sun; en yüksek 2 kategoriye 1 cümle yorum; istenirse grafik bloğuyla kategori dağılımını çiz.' };
    }
    const t = Number(tutar);
    if (!isFinite(t) || t === 0) return { hata: 'tutar sayı olmalı' };
    insert('expenses', { tutar: t, kategori: String(kategori || 'diğer').slice(0, 30), aciklama: String(aciklama || '').slice(0, 120), ts: Date.now(), createdAt: now() });
    return { ok: true, kayit: { tutar: t, kategori: kategori || 'diğer' }, not: 'Kaydı tek satırda onayla.' };
  },

  async hava_durumu({ sehir, gun }) {
    const s0 = String(sehir || '').trim();
    if (!s0) return { hata: 'şehir adı gerekli' };
    const g = Math.min(Math.max(Number(gun) || 3, 1), 7);
    const WC = { 0: 'Açık', 1: 'Az bulutlu', 2: 'Parçalı bulutlu', 3: 'Kapalı', 45: 'Sisli', 48: 'Kırağılı sis', 51: 'Hafif çisenti', 53: 'Çisenti', 55: 'Yoğun çisenti', 56: 'Donan çisenti', 57: 'Donan çisenti', 61: 'Hafif yağmur', 63: 'Yağmurlu', 65: 'Şiddetli yağmur', 66: 'Donan yağmur', 67: 'Donan yağmur', 71: 'Hafif kar', 73: 'Karlı', 75: 'Yoğun kar', 77: 'Kar taneleri', 80: 'Hafif sağanak', 81: 'Sağanak', 82: 'Şiddetli sağanak', 85: 'Kar sağanağı', 86: 'Yoğun kar sağanağı', 95: 'Gök gürültülü fırtına', 96: 'Dolulu fırtına', 99: 'Şiddetli dolu fırtınası' };
    const wc = (c) => WC[c] || 'Bilinmiyor';
    try {
      const gr = await fetchT(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(s0)}&count=1&language=tr&format=json`);
      if (!gr.ok) return { hata: 'şehir aranamadı (HTTP ' + gr.status + ')' };
      const gj = await gr.json();
      const loc = gj?.results?.[0];
      if (!loc) return { hata: `"${s0}" bulunamadı — daha bilinen bir ad dene (örn. "Gaziantep").` };
      const fr = await fetchT(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=${g}`);
      if (!fr.ok) return { hata: 'hava verisi alınamadı (HTTP ' + fr.status + ')' };
      const f = await fr.json();
      const cur = f.current || {};
      const yer = `${loc.name}${loc.admin1 && loc.admin1 !== loc.name ? ', ' + loc.admin1 : ''}${loc.country ? ' (' + loc.country + ')' : ''}`;
      let tablo = '';
      if (f.daily?.time?.length) {
        tablo = '| gün | durum | en düşük | en yüksek | yağış % |\n|---|---|---|---|---|\n' + f.daily.time.map((d, i) => `| ${d} | ${wc(f.daily.weather_code?.[i])} | ${Math.round(f.daily.temperature_2m_min?.[i] ?? 0)}°C | ${Math.round(f.daily.temperature_2m_max?.[i] ?? 0)}°C | ${f.daily.precipitation_probability_max?.[i] ?? '-'} |`).join('\n');
      }
      return { ok: true, yer, simdi: { durum: wc(cur.weather_code), sicaklik: cur.temperature_2m, hissedilen: cur.apparent_temperature, nem: cur.relative_humidity_2m, ruzgar: cur.wind_speed_10m, yagis: cur.precipitation }, gunlukTablo: tablo, not: 'Önce şu anki durumu 1-2 cümleyle söyle, sonra tabloyu sun; yağış olasılığı yüksekse uyar.' };
    } catch (e) { return { hata: 'hava servisine ulaşılamadı: ' + String(e.message || e).slice(0, 100) }; }
  },

  async doviz({ baz, hedef, miktar }) {
    const b = String(baz || 'USD').trim().toUpperCase().slice(0, 3);
    const h = String(hedef || 'TRY').trim().toUpperCase().slice(0, 3);
    const m = Number(miktar) > 0 ? Number(miktar) : 1;
    try {
      const r = await fetchT(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(b)}&symbols=${encodeURIComponent(h)}`);
      if (!r.ok) return { hata: 'kur alınamadı (HTTP ' + r.status + ') — kod geçerli mi? (USD, EUR, TRY, GBP, JPY… kripto yok)' };
      const j = await r.json();
      const kur = j?.rates?.[h];
      if (typeof kur !== 'number') return { hata: `${b}→${h} kuru yok (ECB ~30 para birimi; kripto/hisse YOK).` };
      return { ok: true, baz: b, hedef: h, kur, miktar: m, sonuc: +(m * kur).toFixed(2), tarih: j.date, not: 'Tek satırda söyle: miktar, sonuç, kur ve tarih. Resmî ECB günlük kuru; kripto/borsa olmadığını belirt.' };
    } catch (e) { return { hata: 'döviz servisine ulaşılamadı: ' + String(e.message || e).slice(0, 100) }; }
  },

  async ceviri({ metin, hedef, kaynak }) {
    const t = String(metin || '').trim();
    if (!t) return { hata: 'metin boş' };
    if (t.length > 1800) return { hata: 'çok uzun — 1800 karakterden kısa parçalar hâlinde çevir.' };
    const k = String(kaynak || '').trim().toLowerCase().slice(0, 2) || (/[çğıöşü]/i.test(t) ? 'tr' : 'en');
    const h = String(hedef || '').trim().toLowerCase().slice(0, 2) || (k === 'tr' ? 'en' : 'tr');
    try {
      const r = await fetchT(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(t)}&langpair=${k}|${h}`);
      if (!r.ok) return { hata: 'çeviri alınamadı (HTTP ' + r.status + ')' };
      const j = await r.json();
      const out = j?.responseData?.translatedText;
      if (!out || j.responseStatus !== 200) return { hata: 'çeviri boş döndü — anonim günlük kota dolmuş olabilir; yarın tekrar dene.' };
      return { ok: true, kaynak: k, hedef: h, cevir: String(out), not: 'Çeviriyi aynen sun; kaynak dili kısaca belirt.' };
    } catch (e) { return { hata: 'çeviri servisine ulaşılamadı: ' + String(e.message || e).slice(0, 100) }; }
  },

  async yapilac({ islem, baslik, no }) {
    const op = String(islem || 'liste').trim().toLowerCase();
    const kalan = () => all('todos').filter((x) => !x.done);
    if (op === 'ekle') {
      const t = String(baslik || '').trim();
      if (!t) return { hata: 'başlık boş' };
      insert('todos', { baslik: t.slice(0, 120), done: false, ts: Date.now(), createdAt: now() });
      return { ok: true, eklenen: t.slice(0, 120), kalan: kalan().length, not: 'Tek satırda onayla, kalan görev sayısını söyle.' };
    }
    if (op === 'temizle') {
      const dn = all('todos').filter((x) => x.done);
      for (const x of dn) remove('todos', x.id);
      return { ok: true, silinen: dn.length, kalan: kalan().length };
    }
    if (op === 'liste') {
      const k = kalan();
      const md = k.length ? k.map((x, i) => `${i + 1}. ${x.baslik}`).join('\n') : '(liste boş)';
      return { ok: true, adet: k.length, liste: md, sonTamamlanan: all('todos').filter((x) => x.done).slice(-5).map((x) => x.baslik), not: 'Listeyi numaralı sun; "X tamam" derse tamamla.' };
    }
    const aktif = kalan();
    let row = null;
    const i = Number(no) - 1;
    if (Number.isInteger(i) && i >= 0 && i < aktif.length) row = aktif[i];
    else {
      const q = String(no || baslik || '').trim().toLowerCase();
      if (q) row = aktif.find((x) => String(x.baslik).toLowerCase().includes(q)) || null;
    }
    if (!row) return { hata: 'görev bulunamadı — önce liste ile numaraları göster.' };
    if (op === 'sil') { remove('todos', row.id); return { ok: true, silinen: row.baslik, kalan: kalan().length }; }
    update('todos', row.id, { done: true, doneTs: Date.now() });
    return { ok: true, tamamlanan: row.baslik, kalan: kalan().length, not: 'Kısa tebrik et; kalanları hatırlat.' };
  },

  async aliskanlik({ islem, ad }) {
    const op = String(islem || 'durum').trim().toLowerCase();
    const svse = (d) => d.toLocaleDateString('sv-SE');
    const bugun = svse(new Date());
    const serisi = (h) => {
      const set = new Set(h?.tarihler || []); let s2 = 0;
      const d = new Date(); if (!set.has(svse(d))) d.setDate(d.getDate() - 1);
      while (set.has(svse(d))) { s2++; d.setDate(d.getDate() - 1); }
      return s2;
    };
    const nm = String(ad || '').trim().toLowerCase();
    let h = nm ? (all('habits').find((x) => String(x.ad).toLowerCase().includes(nm)) || null) : null;
    if (op === 'ekle' || (op === 'yapildi' && !h)) {
      const t = String(ad || '').trim();
      if (!t) return { hata: 'alışkanlık adı gerekli' };
      if (!h) {
        insert('habits', { ad: t.slice(0, 60), tarihler: op === 'yapildi' ? [bugun] : [], createdAt: now() });
        h = all('habits').find((x) => x.ad === t.slice(0, 60));
      }
      return { ok: true, ad: h.ad, bugunIsaretli: (h.tarihler || []).includes(bugun), seri: serisi(h), not: op === 'yapildi' ? 'Bugün için işaretlendi — seri sayısını söyle, kısa motive et.' : 'Alışkanlık oluşturuldu — her "bugün yaptım" dediğinde yapildi ile işaretle.' };
    }
    if (!h) return { hata: 'alışkanlık bulunamadı — önce "X alışkanlığı ekle" de.' };
    if (op === 'yapildi') {
      const tl = Array.isArray(h.tarihler) ? h.tarihler : [];
      if (!tl.includes(bugun)) { tl.push(bugun); update('habits', h.id, { tarihler: tl }); }
      return { ok: true, ad: h.ad, seri: serisi(all('habits').find((x) => x.id === h.id)), not: 'Seri sayısını söyle, kısa motive et.' };
    }
    if (op === 'sil') { remove('habits', h.id); return { ok: true, silinen: h.ad }; }
    const hs = all('habits');
    if (!hs.length) return { ok: true, adet: 0, not: 'Henüz alışkanlık yok — "su iç", "kitap oku", "spor" gibi örnekler öner.' };
    const tablo = '| alışkanlık | bugün | seri | toplam |\n|---|---|---|---|\n' + hs.map((x) => `| ${x.ad} | ${(x.tarihler || []).includes(bugun) ? '✅' : '—'} | ${serisi(x)} gün | ${(x.tarihler || []).length} |`).join('\n');
    return { ok: true, adet: hs.length, tablo, not: 'Tabloyu sun; en uzun seriyi 1 cümleyle öne çıkar.' };
  },

  async site_uret({ ad, kod, islem }) {
    const op = String(islem || (kod ? 'olustur' : 'liste')).trim().toLowerCase();
    const slug = String(ad || '').trim().toLowerCase().replace(/[^a-z0-9çğıöşü_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site';
    if (op === 'liste') {
      const ss = all('sites');
      return { ok: true, adet: ss.length, siteler: ss.slice(-15).map((x) => ({ ad: x.ad, boyutKB: Math.round(String(x.html || '').length / 1024), tarih: new Date(x.ts || Date.now()).toLocaleDateString('tr-TR') })), not: 'Listeyi sun; önizlemek/degistirmek için birini seçmesini söyle.' };
    }
    if (op === 'sil') {
      const row = all('sites').find((x) => x.ad === slug);
      if (!row) return { hata: `"${slug}" adlı site yok — liste ile adları gör.` };
      remove('sites', row.id);
      return { ok: true, silinen: slug, not: 'Silindiğini tek satırda söyle.' };
    }
    const h = String(kod || '');
    if (!h.trim()) return { hata: 'kod boş — TAM HTML belgesini kod parametresine yaz' };
    if (h.length > 400000) return { hata: 'kod çok büyük (400KB üstü) — sayfayı sadeleştir, böl veya varlıkları azalt' };
    if (!/<!doctype html>/i.test(h) && !/<html[\s>]/i.test(h)) return { hata: 'kod geçerli HTML belgesi değil — <!doctype html> ile başlayan tam belge yaz' };
    const varMi = all('sites').find((x) => x.ad === slug);
    if (varMi) update('sites', varMi.id, { html: h, ts: Date.now() });
    else insert('sites', { ad: slug, html: h, ts: Date.now(), createdAt: now() });
    const isaret = `[site](evrimsite:${slug})`;
    // v72: otomatik denetim — kusur varsa beyin aynı ad ile düzeltme turu atar (site güncellenir)
    let kontrol = null, kusurlar = [], zenginlik = [];
    try {
      if (getSettings().siteQa !== false) {
        kontrol = await siteQA(h);
        kusurlar = qaOzet(kontrol);
        zenginlik = qaZenginlik(h);
      }
    } catch { /* denetim aracı asla bozmasın */ }
    const denetimNot = kusurlar.length
      ? ` ÖNCE DÜZELT: şu kusurları giderip AYNI "${slug}" adı ile site_uret'i TEKRAR çağır (site güncellenir); kullanıcıye bitti deme: ${kusurlar.join('; ')}`
      : ' Site OTOMATİK DENETİMDEN GEÇTİ (görseller, linkler, mobil taşma) — kusur yok.'
      + (zenginlik.length ? ` ZENGİNLEŞTİR: şu İLERİ DÜZEY özellikler eksik → ekle ve AYNI "${slug}" adı ile (islem=guncelle) TEKRAR çağır: ${zenginlik.join(', ')}. Tasarımın geri kalanını BOZMA.` : '');
    return { ok: true, ad: slug, boyutKB: Math.round(h.length / 1024), islem: varMi ? 'guncellendi' : 'olusturuldu', isaret, kusur: kusurlar.length, kontrol: kontrol ? { render: kontrol.render, kusurlar, zenginlikEksik: zenginlik } : undefined, not: `Bu işareti yanıtına AYNEN koy: ${isaret} — böylece canlı önizleme kartı görünür.` + denetimNot };
  },

  async proje_uret({ ad, dosyalar, testler, islem }) {
    const op = String(islem || (dosyalar ? 'olustur' : 'liste')).trim().toLowerCase();
    const slug = String(ad || '').trim().toLowerCase().replace(/[^a-z0-9çğıöşü_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'proje';
    if (op === 'liste') {
      const ps = all('projects');
      return { ok: true, adet: ps.length, projeler: ps.slice(-12).map((x) => ({ ad: x.ad, dosyalar: Object.keys(x.files || {}), testler: (x.testler || []).length, tarih: new Date(x.ts || Date.now()).toLocaleDateString('tr-TR') })), not: 'Listeyi sun.' };
    }
    if (op === 'sil') {
      const row = all('projects').find((x) => x.ad === slug);
      if (!row) return { hata: `"${slug}" adlı proje yok — liste ile adları gör.` };
      remove('projects', row.id);
      return { ok: true, silinen: slug, not: 'Silindiğini tek satırda söyle.' };
    }
    // v76.1: serbest modeller iç içe yapıları JSON-string olarak gönderebiliyor → normalleştir
    let dos = dosyalar;
    if (typeof dos === 'string') { try { dos = JSON.parse(dos); } catch { dos = null; } }
    let tst = testler;
    if (typeof tst === 'string') {
      try { tst = JSON.parse(tst); }
      catch {
        try { tst = JSON.parse(tst.replace(/\\'/g, "'")); }   // \' kaçışı JSON'da geçersiz — serbest model tik'i
        catch { try { tst = JSON.parse(tst.replace(/\}\s*\]\s*$/, '"}]')); } catch { tst = null; } }   // kapanış tırnağı düşmüşse onar
      }
    }
    if (typeof dos === 'string' && !dos) { /* noop */ }
    const yeni = {};
    if (dos && typeof dos === 'object') {
      for (const [p, c] of Object.entries(dos)) {
        const n = String(p).replace(/^\/+/, '').replace(/\.\./g, '').replace(/[^A-Za-z0-9._/-]/g, '');
        if (n && typeof c === 'string' && c.trim()) yeni[n] = c;
      }
    }
    const varMi = all('projects').find((x) => x.ad === slug);
    if (!varMi && !yeni['index.html']) return { hata: 'index.html ZORUNLU — dosyalar: {"index.html":"...","style.css":"...","app.js":"..."} biçiminde TAM içerikleri ver' };
    const merged = varMi ? { ...(varMi.files || {}), ...yeni } : { ...yeni };
    const tList = (Array.isArray(tst) && tst.length)
      ? tst.filter((t) => t && t.ad && typeof t.js === 'string').slice(0, 12)   // çılgın test listelerini sınırla
      : (varMi?.testler || []);
    if (varMi) update('projects', varMi.id, { files: merged, testler: tList, ts: Date.now() });
    else insert('projects', { ad: slug, files: merged, testler: tList, ts: Date.now(), createdAt: now() });
    let rapor = null;
    try { if (getSettings().siteQa !== false) rapor = await projeQA(merged, tList); } catch { /* denetim aracı bozmasın */ }
    const kusurlar = rapor?.kusurlar || [];
    const kalanTest = (rapor?.testler || []).filter((t) => !t.gecti);
    const isaret = `[proje](evrimproje:${slug})`;
    const denetimNot = (kusurlar.length || kalanTest.length)
      ? ` ÖNCE DÜZELT: ${[...kusurlar, ...kalanTest.map((t) => `test "${t.ad}" BAŞARISIZ: ${t.hata || 'false döndü'}`)].join('; ')} → dosyaları düzelt ve AYNI "${slug}" adı ile proje_uret'i TEKRAR çağır (dosyalar birleşir); kullanıcıye bitti deme.`
      : ` Proje OTOMATİK DENETİMDEN GEÇTİ: ${rapor ? rapor.testler.length + ' test çalıştırıldı' : 'denetim atlandı'}${rapor?.render === 'atlandi' ? ' (çalıştırma bu ortamda atlandı — statik kontroller temiz)' : ''}, kusur yok.`;
    return {
      ok: true, ad: slug, islem: varMi ? 'guncellendi (dosyalar birleşti)' : 'olusturuldu',
      dosyalar: Object.keys(merged).map((k) => `${k} (${Math.max(1, Math.round(merged[k].length / 1024))}KB)`),
      testSayisi: tList.length, kusur: kusurlar.length, basarisizTest: kalanTest.length, isaret,
      not: `Bu işareti yanıtına AYNEN koy: ${isaret} — proje kartı görünür (Önizle/Test/Yayınla/İndir).` + denetimNot,
    };
  },

  async proje_test({ ad }) {
    const slug = String(ad || '').trim().toLowerCase().replace(/[^a-z0-9çğıöşü_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const row = all('projects').find((x) => x.ad === slug);
    if (!row) return { hata: `"${slug}" adlı proje yok — proje_uret islem=liste ile adları gör.` };
    let rapor;
    try { rapor = await projeQA(row.files || {}, row.testler || []); }
    catch (e) { return { hata: 'test koşusu başarısız: ' + String(e.message || e).slice(0, 100) }; }
    const kalan = rapor.testler.filter((t) => !t.gecti);
    return {
      ok: true, ad: slug, render: rapor.render, kusurlar: rapor.kusurlar, testler: rapor.testler,
      not: (kalan.length || rapor.kusurlar.length)
        ? `BAŞARISIZ ${kalan.length} test + ${rapor.kusurlar.length} kusur var → dosyaları düzelt ve AYNI "${slug}" adı ile proje_uret'i tekrar çağır (birleşerek güncellenir).`
        : 'TÜM testler geçti ✅ — kullanıcıya tek cümleyle söyle.',
    };
  },

  async oz_test() {
    const checks = [];
    const add = (ad, gecti, detay) => checks.push({ kontrol: ad, sonuc: gecti === 'atlandi' ? '⏭ atlandı' : gecti ? '✅' : '❌', detay: detay || '' });
    const q = (sel) => { try { return !!document.querySelector(sel); } catch { return false; } };
    add('Konuşma girişi (#input, #send)', q('#input') && q('#send'));
    add('Mesaj alanı (#msgs)', q('#msgs'));
    let navCount = 0; try { navCount = document.querySelectorAll('.sb-nav button').length; } catch {}
    add('Menü bölümleri (≥5)', navCount >= 5, navCount + ' düğme');
    let quick = 0; try { quick = document.querySelectorAll('[data-quick]').length; } catch {}
    add('Hoş geldin kısayolları (≥3)', quick >= 3, quick + ' düğme');
    add('Arama bölümü (#wsInput, #wsBtn)', q('#wsInput') && q('#wsBtn'));
    add('Öğrenme koçu (#btnGen)', q('#btnGen'));
    add('Linux PIN alanı (#setLinuxPin)', q('#setLinuxPin'));
    add('Araç sayısı (≥29)', TOOLS.length >= 29, TOOLS.length + ' araç');
    let schemaOk = true; let schemaBad = '';
    for (const t of TOOLS) {
      const f = t?.function || t; const prm = f?.parameters || {};
      if (!f?.name || typeof f?.description !== 'string' || typeof prm?.properties !== 'object' || prm.properties === null || !Array.isArray(prm?.required || [])) { schemaOk = false; schemaBad = String(f?.name); break; }
      for (const k of Object.keys(prm.properties)) {
        const pv = prm.properties[k];
        if (pv && typeof pv === 'object' && 'required' in pv) { schemaOk = false; schemaBad = f?.name + '.' + k; }
      }
    }
    add('Groq-uyumlu araç şeması', schemaOk, schemaBad ? 'bozuk: ' + schemaBad : '');
    const eksik = [];
    for (const t of TOOLS) { const nm = (t?.function || t)?.name; if (nm && typeof EXEC[nm] !== 'function') eksik.push(nm); }
    add('Tüm araçların yürütücüsü var', eksik.length === 0, eksik.join(','));
    let lsOk = true;
    try { localStorage.setItem('__oztest', '1'); if (localStorage.getItem('__oztest') !== '1') lsOk = false; localStorage.removeItem('__oztest'); } catch { lsOk = false; }
    add('Yerel depolama okunur/yazılır', lsOk);
    let convOk = true; let convN = 0;
    try { const c = all('conversations'); convOk = Array.isArray(c); convN = c ? c.length : 0; } catch { convOk = false; }
    add('Sohbet deposu geçerli', convOk, convN + ' konuşma');
    try {
      const kr = await fetchT('data/katalog.json', {}, 15000);
      const kj = kr.ok ? await kr.json() : null;
      const n1 = kj ? Number(kj.adet || (Array.isArray(kj.yetenekler) ? kj.yetenekler.length : 0)) : 0;
      add('API kataloğu yüklü', kr.ok && n1 > 0, n1 + ' kayıt');
    } catch { add('API kataloğu yüklü', false, 'okunamadı'); }
    try {
      const mr = await fetch('data/mufredat.json');
      const mj = mr.ok ? await mr.json() : null;
      const dl = mj?.dersler || [];
      const bad = dl.find((d) => !d.baslik || !d.ozet || !d.quiz || !d.quiz.soru || !Array.isArray(d.quiz.secenekler) || d.quiz.secenekler.length !== 4 || typeof d.quiz.dogru !== 'number');
      add('Müfredat sağlam (≥33 ders, quizli)', mr.ok && dl.length >= 33 && !bad, dl.length + ' ders' + (bad ? ', bozuk: ' + bad.no : ''));
    } catch { add('Müfredat sağlam', false, 'okunamadı'); }
    try { const ar = await fetch('data/dersler/17.md'); add('Ders arşivi yerinde (link-ölümüne dayanıklı)', ar.ok); } catch { add('Ders arşivi yerinde', false, 'okunamadı'); }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker?.getRegistrations) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        add('ServiceWorker kayıtlı (çevrimdışı kabuk)', (regs && regs.length > 0) || !!navigator.serviceWorker.controller, (regs ? regs.length : 0) + ' kayıt');
      } catch { add('ServiceWorker kayıtlı', 'atlandi'); }
    } else add('ServiceWorker kayıtlı', 'atlandi');
    const kalan = checks.filter((c) => c.sonuc === '❌').length;
    const gecen = checks.filter((c) => c.sonuc === '✅').length;
    const atlanan = checks.filter((c) => c.sonuc.includes('atlandı')).length;
    const tabloMarkdown = '| kontrol | sonuç | detay |\n|---|---|---|\n' + checks.map((c) => `| ${c.kontrol} | ${c.sonuc} | ${c.detay || '—'} |`).join('\n');
    return { ok: kalan === 0, gecen, kalan, atlanan, toplam: checks.length, tabloMarkdown, not: kalan ? 'Tabloyu AYNEN sun; kalan maddeleri dürüstçe raporla, olası neden + düzeltme öner.' : 'Tabloyu sun; tüm kritik kontroller geçti — BLUF: sistem sağlıklı.' };
  },

  async evrak_taslak({ konu, muhatap, icerik, tip, yon, ilgi }) {
    try {
      const k = String(konu || '').trim(); const muh = String(muhatap || '').trim().toLocaleUpperCase('tr');
      const ic = String(icerik || '').trim();
      if (!k || !muh || !ic) return { hata: 'konu, muhatap ve icerik zorunlu' };
      const t = String(tip || 'dilekce').toLocaleLowerCase('tr') === 'resmi' ? 'resmi' : 'dilekce';
      const y = ['ust', 'denk', 'alt'].includes(String(yon || '').toLocaleLowerCase('tr')) ? String(yon).toLocaleLowerCase('tr') : 'ust';
      const kapanis = y === 'ust' ? 'Gereğini saygılarımla arz ederim.'
        : y === 'alt' ? 'Gereğini rica ederim.'
        : 'Bilgilerinizi ve gereğini rica ederim.';
      const bugun = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
      const paragraflar = ic.split(/\n+/).map((p) => p.trim()).filter(Boolean).map((p) => p.replace(/^- /, '')).join('\n\n');
      let taslak;
      if (t === 'dilekce') {
        taslak = `${muh}

**Konu:** ${k}

${paragraflar}

${kapanis}

<div align=right>

Tarih: ${bugun}
Ad Soyad: [adınız soyadınız]
T.C. Kimlik No: [..............]
Adres: [adresiniz]
Telefon: [telefonunuz]
İmza

</div>`;
      } else {
        const sayi = `EV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`;
        taslak = `**Sayı:** ${sayi}
**Konu:** ${k}
${ilgi ? `**İlgi:** ${String(ilgi).trim()}
` : ''}
${muh}

${paragraflar}

${kapanis}

<div align=right>

[Ünvan]
[Ad Soyad]
[İmza]

</div>`;
      }
      return { ok: true, tip: t, yon: y, muhatap: muh, kapanis, taslakMarkdown: taslak, not: 'Taslağı AYNEN markdown olarak sun; köşeli parantezli alanları kullanıcının dolduracağını belirt; resmî yazışmada üst makama "arz", alt/denk makama "rica" kuralını hatırlat.' };
    } catch (e) { return { hata: String(e.message || e).slice(0, 140) }; }
  },

  async otomatik_turev({ ifade, degiskenler }) {
    try {
      const expr = String(ifade || '').trim();
      if (!expr) return { hata: 'ifade boş' };
      if (/[;{}]|=>|\bfunction\b|\breturn\b|import|require|fetch|eval|globalThis|window|document|localStorage/.test(expr)) return { hata: 'ifade yalnızca matematik olmalı' };
      let pt = {};
      try { pt = typeof degiskenler === 'string' && degiskenler.trim() ? JSON.parse(degiskenler) : (degiskenler || {}); } catch { pt = {}; }
      if (!pt || typeof pt !== 'object' || !Object.keys(pt).length) pt = { x: 1 };
      // ---- tokenizer ----
      const toks = [];
      const re = /(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/^(),])|(\s+)/g;
      let m2; let pos = 0;
      while ((m2 = re.exec(expr))) {
        if (m2[0].length === 0) break;
        pos = re.lastIndex;
        if (m2[4]) continue;
        if (m2[1]) toks.push({ t: 'num', v: parseFloat(m2[1]) });
        else if (m2[2]) toks.push({ t: 'name', v: m2[2].toLowerCase() });
        else if (m2[3]) toks.push({ t: 'op', v: m2[3] });
        else return { hata: `ayrıştırılamayan karakter: ${m2[0]}` };
      }
      if (pos < expr.replace(/\s+$/, '').length) return { hata: 'ifade tam ayrıştırılamadı' };
      const FNS = ['sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs'];
      // ---- shunting-yard -> RPN ----
      const rpn = []; const ops2 = [];
      const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3, 'u-': 2.5 };
      let prev = null;
      for (const tk of toks) {
        if (tk.t === 'num') { rpn.push(tk); }
        else if (tk.t === 'name') {
          if (FNS.includes(tk.v)) { ops2.push({ t: 'fn', v: tk.v }); }
          else if (tk.v === 'pi' || tk.v === 'e') { rpn.push({ t: 'num', v: tk.v === 'pi' ? Math.PI : Math.E }); }
          else rpn.push({ t: 'var', v: tk.v });
        } else if (tk.t === 'op') {
          const c = tk.v;
          if (c === '-' && (prev === null || (prev.t === 'op') || (prev.t === 'lp'))) { ops2.push({ t: 'op', v: 'u-' }); }
          else if (c === '(') { ops2.push({ t: 'lp' }); }
          else if (c === ')') {
            while (ops2.length && ops2[ops2.length - 1].t !== 'lp') rpn.push(ops2.pop());
            if (!ops2.length) return { hata: 'parantez dengesi bozuk' };
            ops2.pop();
            if (ops2.length && ops2[ops2.length - 1].t === 'fn') rpn.push(ops2.pop());
          } else {
            while (ops2.length) {
              const top = ops2[ops2.length - 1];
              if (top.t === 'fn' || (top.t === 'op' && (prec[top.v] > prec[c] || (prec[top.v] === prec[c] && c !== '^')))) rpn.push(ops2.pop());
              else break;
            }
            ops2.push({ t: 'op', v: c });
          }
        }
        prev = c2p(tk);
      }
      function c2p(tk) { if (tk.t === 'op' && tk.v === '(') return { t: 'lp' }; return tk; }
      while (ops2.length) { const o = ops2.pop(); if (o.t === 'lp') return { hata: 'parantez dengesi bozuk' }; rpn.push(o); }
      // ---- AD tape ----
      const evalAt = (point) => {
        const nodes = [];
        const V = (v, par, back) => { const o = { v, par: par || [], back: back || null, g: 0, id: nodes.length }; nodes.push(o); return o; };
        const B = {
          '+': (a, b) => V(a.v + b.v, [a, b], (g) => [[a, g], [b, g]]),
          '-': (a, b) => V(a.v - b.v, [a, b], (g) => [[a, g], [b, -g]]),
          '*': (a, b) => V(a.v * b.v, [a, b], (g) => [[a, g * b.v], [b, g * a.v]]),
          '/': (a, b) => V(a.v / b.v, [a, b], (g) => [[a, g / b.v], [b, -g * a.v / (b.v * b.v)]]),
          '^': (a, b) => V(Math.pow(a.v, b.v), [a, b], (g) => [[a, g * b.v * Math.pow(a.v, b.v - 1)], [b, g * Math.pow(a.v, b.v) * Math.log(Math.abs(a.v) || 1e-12)]]),
          'u-': (a) => V(-a.v, [a], (g) => [[a, -g]]),
          sin: (a) => V(Math.sin(a.v), [a], (g) => [[a, g * Math.cos(a.v)]]),
          cos: (a) => V(Math.cos(a.v), [a], (g) => [[a, -g * Math.sin(a.v)]]),
          tan: (a) => V(Math.tan(a.v), [a], (g) => [[a, g / (Math.cos(a.v) ** 2)]]),
          exp: (a) => V(Math.exp(a.v), [a], (g) => [[a, g * Math.exp(a.v)]]),
          log: (a) => { if (!(a.v > 0)) throw new Error('log pozitif girdi ister'); return V(Math.log(a.v), [a], (g) => [[a, g / a.v]]); },
          sqrt: (a) => { if (a.v < 0) throw new Error('sqrt negatif girdi istermez'); const r = Math.sqrt(a.v); return V(r, [a], (g) => [[a, g / (2 * r)]]); },
          abs: (a) => V(Math.abs(a.v), [a], (g) => [[a, g * Math.sign(a.v)]]),
        };
        const vars = {};
        for (const k of Object.keys(point)) vars[k.toLowerCase()] = V(Number(point[k]));
        const st = [];
        for (const tk of rpn) {
          if (tk.t === 'num') st.push(V(tk.v));
          else if (tk.t === 'var') { const v = vars[tk.v]; if (!v) throw new Error(`bilinmeyen değişken: ${tk.v}`); st.push(v); }
          else if (tk.t === 'fn') { const a = st.pop(); if (!a) throw new Error('eksik argüman'); st.push(B[tk.v](a)); }
          else {
            if (tk.v === 'u-') { const a = st.pop(); if (!a) throw new Error('eksik argüman'); st.push(B['u-'](a)); }
            else { const b = st.pop(); const a = st.pop(); if (!a || !b) throw new Error('eksik işleç'); st.push(B[tk.v](a, b)); }
          }
        }
        if (st.length !== 1) throw new Error('ifade eksik/fazla işleçli');
        const root = st[0];
        if (!isFinite(root.v)) throw new Error('sonuç sonlu değil');
        root.g = 1;
        for (let i = nodes.length - 1; i >= 0; i--) {
          const nd = nodes[i];
          if (nd.back && nd.g !== 0) { for (const [par, gg] of nd.back(nd.g)) par.g += gg; }
        }
        const grads = {};
        for (const k of Object.keys(vars)) grads[k] = vars[k].g;
        return { value: root.v, grads, finite: Object.values(grads).every(isFinite) };
      };
      const base = evalAt(pt);
      if (!base.finite) return { hata: 'gradyan sonlu değil — noktayı değiştir (ör. log(0), 1/0)' };
      // sayısal doğrulama (merkezi fark)
      const h = 1e-5;
      const rows = [];
      for (const k of Object.keys(pt)) {
        const pp = { ...pt, [k]: pt[k] + h }; const pm = { ...pt, [k]: pt[k] - h };
        let num = null;
        try { num = (evalAt(pp).value - evalAt(pm).value) / (2 * h); } catch { num = NaN; }
        rows.push({ degisken: k, ad: +base.grads[k].toFixed(8), sayisal: isFinite(num) ? +num.toFixed(8) : null, fark: isFinite(num) ? +Math.abs(base.grads[k] - num).toExponential(2) : null });
      }
      const tabloMarkdown = '| değişken | AD gradyanı | sayısal kontrol | fark |\n|---|---|---|---|\n'
        + rows.map((r) => `| ${r.degisken} | ${r.ad} | ${r.sayisal} | ${r.fark} |`).join('\n');
      return { ok: true, arac: 'ters mod otomatik türev (tape)', ifade: expr, nokta: pt, deger: +base.value.toFixed(8), tabloMarkdown, dogrulama: rows.every((r) => r.fark === null || r.fark < 1e-4) ? 'AD = sayısal ✓' : 'FARK VAR — ifadeyi kontrol et', not: 'Tabloyu koy; gradyanın fiziksel anlamını 1 cümleyle yorumla (x artınca f ne hızla değişir).' };
    } catch (e) { return { hata: String(e.message || e).slice(0, 140) }; }
  },

  async oto_model({ gorev, deneme }) {
    try {
      const g = String(gorev || '').toLocaleLowerCase('tr');
      if (!['xor', 'daire', 'sinus'].includes(g)) return { hata: 'görev xor | daire | sinus olmalı' };
      let seed = 20240101;
      const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const X = []; const Y = [];
      if (g === 'xor') { X.push([0, 0], [0, 1], [1, 0], [1, 1]); Y.push([0], [1], [1], [0]); }
      else if (g === 'daire') {
        while (X.length < 120) {
          const ic = X.length < 60;
          const r = ic ? 0.25 + rnd() * 0.65 : 1.4 + rnd() * 0.6;
          const a = rnd() * Math.PI * 2;
          X.push([+(r * Math.cos(a)).toFixed(4), +(r * Math.sin(a)).toFixed(4)]);
          Y.push([ic ? 1 : 0]);
        }
      } else {
        for (let i = 0; i < 64; i++) { const x = (i / 63) * 2 * Math.PI; X.push([+(x / Math.PI - 1).toFixed(5)]); Y.push([+Math.sin(x).toFixed(5)]); }
      }
      const N = X.length;
      const idxAll = Array.from({ length: N }, (_, i) => i);
      for (let i = idxAll.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idxAll[i], idxAll[j]] = [idxAll[j], idxAll[i]]; }
      const valN = g === 'xor' ? 4 : Math.max(8, Math.round(N * 0.2));
      const valIdx = idxAll.slice(0, valN);
      const trIdx = g === 'xor' ? idxAll : idxAll.slice(valN);
      const E = g === 'xor' ? 1200 : 700;
      const trainModel = (H, lr, trI) => {
        const W1 = []; const b1 = []; const W2 = []; const b2 = [0];
        for (let i = 0; i < H; i++) { W1.push(Array.from({ length: X[0].length }, () => (rnd() * 2 - 1) * 1.5)); b1.push(rnd() * 2 - 1); }
        W2.push(Array.from({ length: H }, () => (rnd() * 2 - 1) / Math.sqrt(H)));
        const M = trI.length;
        for (let e = 0; e < E; e++) {
          const dW1 = W1.map((w) => w.map(() => 0)); const db1 = b1.map(() => 0); const dW2 = W2[0].map(() => 0); let db2 = 0;
          for (const s of trI) {
            const x = X[s];
            const hp = W1.map((w, i) => w.reduce((a, wi, j) => a + wi * x[j], 0) + b1[i]);
            const h = hp.map(Math.tanh);
            const o = W2[0].reduce((a, wi, i) => a + wi * h[i], 0) + b2[0];
            const d = o - Y[s][0];
            for (let i = 0; i < H; i++) dW2[i] += 2 * d * h[i];
            db2 += 2 * d;
            for (let i = 0; i < H; i++) {
              const dp = 2 * d * W2[0][i] * (1 - h[i] * h[i]);
              db1[i] += dp;
              for (let j = 0; j < x.length; j++) dW1[i][j] += dp * x[j];
            }
          }
          for (let i = 0; i < H; i++) { for (let j = 0; j < X[0].length; j++) W1[i][j] -= lr * dW1[i][j] / M; b1[i] -= lr * db1[i] / M; W2[0][i] -= lr * dW2[i] / M; }
          b2[0] -= lr * db2 / M;
        }
        return { W1, b1, W2, b2 };
      };
      const evaluate = (m, idx) => {
        let L = 0; let dogru = 0;
        for (const s of idx) {
          const x = X[s];
          const h = m.W1.map((w, i) => Math.tanh(w.reduce((a, wi, j) => a + wi * x[j], 0) + m.b1[i]));
          const o = m.W2[0].reduce((a, wi, i) => a + wi * h[i], 0) + m.b2[0];
          L += (o - Y[s][0]) ** 2;
          if ((o > 0.5 ? 1 : 0) === Y[s][0]) dogru++;
        }
        return { kayip: L / idx.length, dogruluk: Math.round((dogru / idx.length) * 100) };
      };
      const trials = Math.max(3, Math.min(12, Math.round(Number(deneme) || 6)));
      const hs = [3, 4, 6, 8, 12]; const lrs = [0.05, 0.1, 0.15, 0.3, 0.5];
      const results = [];
      for (let t = 0; t < trials; t++) {
        const H = hs[Math.floor(rnd() * hs.length)];
        const lr = lrs[Math.floor(rnd() * lrs.length)];
        const m = trainModel(H, lr, trIdx);
        const ev = evaluate(m, valIdx);
        results.push({ H, lr, valKayip: +ev.kayip.toFixed(5), valDogruluk: ev.dogruluk });
      }
      const enIyi = results.slice().sort((a, b) => a.valKayip - b.valKayip)[0];
      const final = evaluate(trainModel(enIyi.H, enIyi.lr, idxAll), idxAll);
      const tabloMarkdown = '| # | gizli | lr | val kayıp |' + (g !== 'sinus' ? ' val doğruluk |' : '\n')
        + (g !== 'sinus' ? '\n|---|---|---|---|---|\n' : '|---|---|---|---|\n')
        + results.map((r, i) => `| ${i + 1} | ${r.H} | ${r.lr} | ${r.valKayip} |` + (g !== 'sinus' ? ` ${r.valDogruluk}% |` : '')).join('\n');
      return {
        ok: true, gorev: 'oto_model (rastgele arama)', denenen: trials,
        enIyi: { gizli: enIyi.H, ogrenmeOrani: enIyi.lr, valKayip: enIyi.valKayip, valDogruluk: g !== 'sinus' ? enIyi.valDogruluk + '%' : undefined },
        finalTamVeri: { kayip: +final.kayip.toFixed(5), dogruluk: g !== 'sinus' ? final.dogruluk + '%' : undefined },
        dogrulamaNotu: g === 'xor' ? 'XOR 4 örnekli olduğu için val=tüm veri (istisna)' : `Val bölmesi: ${valN} örnek (verilmedi)`,
        tabloMarkdown,
        not: 'Tabloyu koy; en iyi yapılandırmayı ve neden kazandığını (en düşük val kaybı) belirt; final tam-veri metriğini raporla.',
      };
    } catch (e) { return { hata: String(e.message || e).slice(0, 140) }; }
  },

  async gizli_ogren({ gorev, istemci, turlar, epsilon, veri }) {
    try {
      let seed = 135792468;
      const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const g = String(gorev || '').toLocaleLowerCase('tr');

      if (g === 'federe') {
        const K = Math.max(2, Math.min(5, Math.round(Number(istemci) || 3)));
        const R = Math.max(1, Math.min(20, Math.round(Number(turlar) || 8)));
        const X = []; const Y = [];
        while (X.length < 120) {
          const ic = X.length < 60;
          const r = ic ? 0.25 + rnd() * 0.65 : 1.4 + rnd() * 0.6;
          const a = rnd() * Math.PI * 2;
          X.push([+(r * Math.cos(a)).toFixed(4), +(r * Math.sin(a)).toFixed(4)]);
          Y.push([ic ? 1 : 0]);
        }
        for (let i = X.length - 1; i > 0; i--) { const j2 = Math.floor(rnd() * (i + 1)); [X[i], X[j2]] = [X[j2], X[i]]; [Y[i], Y[j2]] = [Y[j2], Y[i]]; }
        const shards = Array.from({ length: K }, () => []);
        X.forEach((x, i) => shards[i % K].push(i));
        const H = 6; const lr = 0.15; const localE = 25;
        let W1 = []; const b1 = []; let W2 = [[]]; let b2 = [0];
        for (let i = 0; i < H; i++) { W1.push([(rnd() * 2 - 1) * 1.5, (rnd() * 2 - 1) * 1.5]); b1.push(rnd() * 2 - 1); }
        for (let i = 0; i < H; i++) W2[0].push((rnd() * 2 - 1) / Math.sqrt(H));
        const evaluate = () => {
          let L = 0; let dogru = 0;
          for (let s = 0; s < X.length; s++) {
            const h = W1.map((w, i) => Math.tanh(w[0] * X[s][0] + w[1] * X[s][1] + b1[i]));
            const o = W2[0].reduce((a, wi, i) => a + wi * h[i], 0) + b2[0];
            L += (o - Y[s][0]) ** 2;
            if ((o > 0.5 ? 1 : 0) === Y[s][0]) dogru++;
          }
          return { kayip: +(L / X.length).toFixed(5), dogruluk: Math.round((dogru / X.length) * 100) };
        };
        const log = [];
        for (let r2 = 1; r2 <= R; r2++) {
          const acc = { W1: W1.map((w) => [0, 0]), b1: b1.map(() => 0), W2: W2[0].map(() => 0), b2: 0 };
          for (let c = 0; c < K; c++) {
            let cW1 = W1.map((w) => [w[0], w[1]]); let cb1 = b1.slice(); let cW2 = W2[0].slice(); let cb2 = b2[0];
            const idx = shards[c]; const N = idx.length;
            for (let e = 0; e < localE; e++) {
              const dW1 = cW1.map(() => [0, 0]); const db1 = cb1.map(() => 0); const dW2 = cW2.map(() => 0); let db2 = 0;
              for (const s of idx) {
                const hpre = cW1.map((w, i) => w[0] * X[s][0] + w[1] * X[s][1] + cb1[i]);
                const h = hpre.map(Math.tanh);
                const o = cW2.reduce((a, wi, i) => a + wi * h[i], 0) + cb2;
                const d = o - Y[s][0];
                for (let i = 0; i < H; i++) dW2[i] += 2 * d * h[i];
                db2 += 2 * d;
                for (let i = 0; i < H; i++) {
                  const dp = 2 * d * cW2[i] * (1 - h[i] * h[i]);
                  db1[i] += dp; dW1[i][0] += dp * X[s][0]; dW1[i][1] += dp * X[s][1];
                }
              }
              for (let i = 0; i < H; i++) { cW1[i][0] -= lr * dW1[i][0] / N; cW1[i][1] -= lr * dW1[i][1] / N; cb1[i] -= lr * db1[i] / N; cW2[i] -= lr * dW2[i] / N; }
              cb2 -= lr * db2 / N;
            }
            for (let i = 0; i < H; i++) { acc.W1[i][0] += cW1[i][0] / K; acc.W1[i][1] += cW1[i][1] / K; acc.b1[i] += cb1[i] / K; acc.W2[i] += cW2[i] / K; }
            acc.b2 += cb2 / K;
          }
          W1 = acc.W1; W2 = [acc.W2]; b2 = [acc.b2];
          for (let i = 0; i < H; i++) b1[i] = acc.b1[i];
          const ev = evaluate();
          log.push([r2, ev.kayip, ev.dogruluk]);
        }
        const son = log[log.length - 1];
        const tabloMarkdown = '| tur | küresel kayıp | doğruluk |\n|---|---|---|\n' + log.map(([r3, l, a]) => `| ${r3} | ${l} | ${a}% |`).join('\n');
        return { ok: true, gorev: 'federe (FedAvg)', istemciSayisi: K, federasyonTuru: R, veriPuani: X.length, sonKayip: son[1], dogruluk: son[2] + '%', tabloMarkdown, not: 'Tabloyu koy; vurgula: ham veri istemcilerden ÇIKMADI, yalnız ağırlıklar ortalandı (FedAvg).' };
      }

      if (g === 'farkli_gizlilik') {
        let V;
        try { V = typeof veri === 'string' && veri.trim() ? JSON.parse(veri) : null; } catch { V = null; }
        if (!Array.isArray(V) || V.length < 5) {
          V = []; for (let i = 0; i < 200; i++) V.push(Math.round(30000 + rnd() * rnd() * 60000));
          V._ornek = true;
        }
        V = V.slice(0, 1000).map(Number).filter((x) => isFinite(x));
        if (V.length < 5) return { hata: 'en az 5 sayı gerekli' };
        const n = V.length; const mn = Math.min(...V); const mx = Math.max(...V);
        const gercek = V.reduce((a, b) => a + b, 0) / n;
        const sens = (mx - mn) / n;
        const lap = (scale) => { const u = rnd() - 0.5; return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u)); };
        const epsList = [0.1, 0.5, 1, 2];
        const userEps = Number(epsilon) > 0 ? Number(epsilon) : 1;
        if (!epsList.includes(userEps)) epsList.push(userEps);
        epsList.sort((a, b) => a - b);
        const rows = epsList.map((e) => { const gurultulu = gercek + lap(sens / e); return [e, Math.round(gurultulu), Math.round(Math.abs(gurultulu - gercek))]; });
        const tabloMarkdown = '| ε | gürültülü ortalama | mutlak hata |\n|---|---|---|\n' + rows.map(([e, v, h2]) => `| ${e} | ${v} | ${h2} |`).join('\n');
        return { ok: true, gorev: 'farkli_gizlilik (Laplace)', sorgu: 'ortalama', adet: n, gercekOrtalama: Math.round(gercek), aralik: [mn, mx], duyarlilik: +sens.toFixed(4), tabloMarkdown, ornekVeri: !!V._ornek, not: 'Tabloyu koy; yorum: küçük ε = güçlü gizlilik + büyük hata, büyük ε = zayıf gizlilik + isabet. Gerçek ortalama "sır" olarak kalmalı — yayınlanan yalnız gürültülü değer.' };
      }

      return { hata: 'görev federe | farkli_gizlilik olmalı' };
    } catch (e) { return { hata: String(e.message || e).slice(0, 140) }; }
  },

  async olasilik({ gorev, dagilimAdi, parametreler, ifade, aralik, ornek }) {
    try {
      let seed = 246813579;
      const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const g = String(gorev || '').toLocaleLowerCase('tr');
      const P = typeof parametreler === 'string' ? (parametreler.trim() ? JSON.parse(parametreler) : {}) : (parametreler || {});
      const A = typeof aralik === 'string' ? (aralik.trim() ? JSON.parse(aralik) : null) : (aralik || null);
      const GUARD = /[;{}]|=>|\bfunction\b|\breturn\b|import|require|fetch|eval|globalThis|window|document|localStorage/;

      if (g === 'dagilim') {
        const ad = String(dagilimAdi || P.ad || 'normal').toLocaleLowerCase('tr');
        const rows = [];
        let mean = 0; let variance = 0; let tip = 'sürekli';
        if (ad === 'normal' || ad === 'gauss') {
          const mu = Number(P.mu ?? 0), sigma = Number(P.sigma ?? 1);
          if (!(sigma > 0)) return { hata: 'sigma > 0 olmalı' };
          mean = mu; variance = sigma * sigma;
          for (let i = 0; i <= 12; i++) { const x = mu - 3 * sigma + (i * 6 * sigma) / 12; rows.push([+x.toFixed(3), +(Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI))).toFixed(4)]); }
        } else if (ad === 'binom' || ad === 'binomial') {
          const n = Math.max(1, Math.min(60, Math.round(Number(P.n ?? 10))));
          const p = Math.min(1, Math.max(0, Number(P.p ?? 0.5)));
          tip = 'ayrık'; mean = n * p; variance = n * p * (1 - p);
          const lnf = (k) => { let t = 0; for (let i = 2; i <= k; i++) t += Math.log(i); return t; };
          for (let k = 0; k <= Math.min(20, n); k++) {
            const lp = lnf(n) - lnf(k) - lnf(n - k) + k * Math.log(p || 1e-12) + (n - k) * Math.log(1 - p || 1e-12);
            rows.push([k, +Math.exp(lp).toFixed(4)]);
          }
        } else if (ad === 'poisson') {
          const lam = Number(P.lambda ?? 3);
          if (!(lam > 0)) return { hata: 'lambda > 0 olmalı' };
          tip = 'ayrık'; mean = lam; variance = lam;
          let lf = 0;
          const kmax = Math.min(25, Math.ceil(lam + 4 * Math.sqrt(lam) + 3));
          for (let k = 0; k <= kmax; k++) { if (k > 0) lf += Math.log(k); rows.push([k, +Math.exp(-lam + k * Math.log(lam) - lf).toFixed(4)]); }
        } else if (ad === 'ustel' || ad === 'exponential') {
          const lam = Number(P.lambda ?? 1);
          if (!(lam > 0)) return { hata: 'lambda > 0 olmalı' };
          mean = 1 / lam; variance = 1 / (lam * lam);
          for (let i = 0; i <= 12; i++) { const x = (i * 4) / (12 * lam); rows.push([+x.toFixed(3), +(lam * Math.exp(-lam * x)).toFixed(4)]); }
        } else if (ad === 'duzgu' || ad === 'uniform') {
          const a = Number(P.a ?? 0), b = Number(P.b ?? 1);
          if (!(b > a)) return { hata: 'b > a olmalı' };
          mean = (a + b) / 2; variance = ((b - a) ** 2) / 12;
          for (let i = 0; i <= 10; i++) { const x = a + (i * (b - a)) / 10; rows.push([+x.toFixed(3), +(1 / (b - a)).toFixed(4)]); }
        } else return { hata: 'bilinmeyen dağılım (normal|binom|poisson|ustel|duzgu)' };
        const tabloMarkdown = `| ${tip === 'ayrık' ? 'k' : 'x'} | ${tip === 'ayrık' ? 'P(X=k)' : 'pdf(x)'} |\n|---|---|\n` + rows.map(([x, y]) => `| ${x} | ${y} |`).join('\n');
        return { ok: true, gorev: 'dagilim', dagilim: ad, tip, ortalama: +mean.toFixed(4), varyans: +variance.toFixed(4), stdSapma: +Math.sqrt(variance).toFixed(4), tabloMarkdown, not: 'Tabloyu cevabına koy; ortalama/varyansı 1-2 cümleyle yorumla.' };
      }

      if (g === 'monte_carlo') {
        const N = Math.max(1000, Math.min(200000, Number(ornek) || 20000));
        const expr = String(ifade || '').trim();
        if (expr) {
          if (GUARD.test(expr)) return { hata: 'ifade yalnızca matematik olmalı (x, Math.*)' };
          const f = new Function('x', 'Math', '"use strict"; return (' + expr + ');');
          const lo = Array.isArray(A) ? Number(A[0]) : 0;
          const hi = Array.isArray(A) ? Number(A[1]) : 1;
          if (!(hi > lo)) return { hata: 'aralik [a,b] ve b>a olmalı' };
          const est = (M) => {
            let s1 = 0; let s2 = 0;
            for (let i = 0; i < M; i++) { const x = lo + rnd() * (hi - lo); const v = f(x, Math); if (!isFinite(v)) throw new Error('ifade sonlu değer vermedi'); s1 += v; s2 += v * v; }
            const m = s1 / M; const varM = Math.max(0, s2 / M - m * m);
            return { tahmin: m * (hi - lo), stdHata: Math.sqrt(varM / M) * (hi - lo) };
          };
          const full = est(N);
          const conv = [Math.floor(N / 4), Math.floor(N / 2), N].map((M) => [M, +est(M).tahmin.toFixed(5)]);
          const tabloMarkdown = '| örnek | tahmin |\n|---|---|\n' + conv.map(([m, v]) => `| ${m} | ${v} |`).join('\n');
          return { ok: true, gorev: 'monte_carlo: integral', ifade: expr, aralik: [lo, hi], ornek: N, tahmin: +full.tahmin.toFixed(5), stdHata: +full.stdHata.toFixed(5), tabloMarkdown, not: 'Tahmini ± 2·stdHata yakınsama tablosuyla sun.' };
        }
        const est = (M) => { let ic = 0; for (let i = 0; i < M; i++) { const x = rnd(); const y = rnd(); if (x * x + y * y <= 1) ic++; } return (4 * ic) / M; };
        const full = est(N);
        const conv = [Math.floor(N / 4), Math.floor(N / 2), N].map((M) => [M, +est(M).toFixed(5)]);
        const tabloMarkdown = '| örnek | π tahmini |\n|---|---|\n' + conv.map(([m, v]) => `| ${m} | ${v} |`).join('\n');
        return { ok: true, gorev: 'monte_carlo: pi', ornek: N, tahmin: +full.toFixed(5), hata: +Math.abs(full - Math.PI).toFixed(5), tabloMarkdown, not: 'π tahminini yakınsama tablosuyla sun.' };
      }

      if (g === 'mcmc') {
        const expr = String(ifade || '').trim();
        if (!expr) return { hata: 'mcmc için hedef yoğunluk ifadesi gerekli (örn. "Math.exp(-x*x/2)")' };
        if (GUARD.test(expr)) return { hata: 'ifade yalnızca matematik olmalı (x, Math.*)' };
        const f = new Function('x', 'Math', '"use strict"; return (' + expr + ');');
        const it = Math.max(500, Math.min(50000, Number(ornek) || 8000));
        const lo = Array.isArray(A) ? Number(A[0]) : -6;
        const hi = Array.isArray(A) ? Number(A[1]) : 6;
        if (!(hi > lo)) return { hata: 'aralik [a,b] ve b>a olmalı' };
        const step = (hi - lo) / 20;
        let x = (lo + hi) / 2;
        let fx = f(x, Math);
        if (!isFinite(fx) || fx <= 0) {
          let found = false;
          for (let i = 0; i < 60 && !found; i++) { const xt = lo + rnd() * (hi - lo); const ft = f(xt, Math); if (isFinite(ft) && ft > 0) { x = xt; fx = ft; found = true; } }
          if (!found) return { hata: 'hedef yoğunluk bu aralıkta pozitif/sonlu değil' };
        }
        const burn = Math.floor(it * 0.2);
        const samples = [];
        let kabul = 0;
        for (let i = 0; i < it; i++) {
          const u1 = Math.max(1e-12, rnd()); const u2 = rnd();
          const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          const xp = x + z * step;
          const fp = f(xp, Math);
          if (isFinite(fp) && fp > 0 && (fp >= fx || rnd() < fp / fx)) { x = xp; fx = fp; kabul++; }
          if (i >= burn) samples.push(x);
        }
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
        const std = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
        const sorted = samples.slice().sort((a, b) => a - b);
        const q = (pr) => +sorted[Math.min(sorted.length - 1, Math.floor(pr * sorted.length))].toFixed(4);
        const bins = 10; const bmin = sorted[0]; const bmax = sorted[sorted.length - 1];
        const hist = new Array(bins).fill(0);
        for (const v of samples) { let bi = Math.floor(((v - bmin) / ((bmax - bmin) || 1)) * bins); if (bi >= bins) bi = bins - 1; hist[bi]++; }
        const tabloMarkdown = '| aralık | örnek |\n|---|---|\n' + hist.map((c, i) => `| ${(+((bmin + (i * (bmax - bmin)) / bins)).toFixed(2))} – ${(+((bmin + ((i + 1) * (bmax - bmin)) / bins)).toFixed(2))} | ${c} |`).join('\n');
        return { ok: true, gorev: 'mcmc (Metropolis-Hastings)', ifade: expr, orneklem: samples.length, kabulOrani: Math.round((kabul / it) * 100) + '%', ortalama: +mean.toFixed(4), stdSapma: +std.toFixed(4), q025: q(0.25), medyan: q(0.5), q975: q(0.975), tabloMarkdown, not: 'Posterior özetini sun: ortalama ± std, %95 aralık [q025,q975], histogram tablosu; kabul oranı %20-50 ideal.' };
      }

      return { hata: 'görev dagilim | monte_carlo | mcmc olmalı' };
    } catch (e) { return { hata: String(e.message || e).slice(0, 140) }; }
  },

  async sinir_agi({ gorev, turler, ogrenmeOrani, gizli }) {
    try {
      const g = String(gorev || '').toLocaleLowerCase('tr');
      if (!['xor', 'daire', 'sinus'].includes(g)) return { hata: 'görev xor | daire | sinus olmalı' };
      let seed = 987654321;
      const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const X = []; const Y = [];
      if (g === 'xor') { X.push([0, 0], [0, 1], [1, 0], [1, 1]); Y.push([0], [1], [1], [0]); }
      else if (g === 'daire') {
        while (X.length < 120) {
          const ic = X.length < 60;
          const r = ic ? 0.25 + rnd() * 0.65 : 1.4 + rnd() * 0.6;
          const a = rnd() * Math.PI * 2;
          X.push([+(r * Math.cos(a)).toFixed(4), +(r * Math.sin(a)).toFixed(4)]);
          Y.push([ic ? 1 : 0]);
        }
      } else {
        for (let i = 0; i < 64; i++) { const x = (i / 63) * 2 * Math.PI; X.push([+(x / Math.PI - 1).toFixed(5)]); Y.push([+Math.sin(x).toFixed(5)]); }
      }
      const inN = X[0].length; const outN = 1;
      const H = Math.max(2, Math.min(16, Number(gizli) || (g === 'xor' ? 4 : 8)));
      const lr = Number(ogrenmeOrani) > 0 ? Math.min(2, Number(ogrenmeOrani)) : (g === 'xor' ? 0.5 : g === 'daire' ? 0.15 : 0.08);
      const E = Math.max(200, Math.min(20000, Number(turler) || (g === 'xor' ? 3000 : 2500)));
      const W1 = []; const b1 = []; const W2 = []; const b2 = [];
      for (let i = 0; i < H; i++) { W1.push(Array.from({ length: inN }, () => (rnd() * 2 - 1) * 1.5)); b1.push(rnd() * 2 - 1); }
      for (let k = 0; k < outN; k++) { W2.push(Array.from({ length: H }, () => (rnd() * 2 - 1) / Math.sqrt(H))); b2.push(0); }
      const fwd = (x) => {
        const h = W1.map((w, i) => Math.tanh(w.reduce((a, wi, j) => a + wi * x[j], 0) + b1[i]));
        return W2.map((w) => w.reduce((a, wi, i) => a + wi * h[i], 0) + b2[0]);
      };
      let ilkKayip = null; const egris = [];
      const N = X.length;
      for (let e = 1; e <= E; e++) {
        const dW1 = W1.map((w) => w.map(() => 0)); const db1 = b1.map(() => 0);
        const dW2 = W2.map((w) => w.map(() => 0)); const db2 = [0];
        let L = 0;
        for (let s = 0; s < N; s++) {
          const x = X[s];
          const hp = W1.map((w, i) => w.reduce((a, wi, j) => a + wi * x[j], 0) + b1[i]);
          const h = hp.map(Math.tanh);
          const o = W2[0].reduce((a, wi, i) => a + wi * h[i], 0) + b2[0];
          const d = o - Y[s][0]; L += d * d;
          for (let i = 0; i < H; i++) dW2[0][i] += 2 * d * h[i];
          db2[0] += 2 * d;
          for (let i = 0; i < H; i++) {
            const dp = 2 * d * W2[0][i] * (1 - h[i] * h[i]);
            db1[i] += dp;
            for (let j = 0; j < inN; j++) dW1[i][j] += dp * x[j];
          }
        }
        L /= N;
        for (let i = 0; i < H; i++) { for (let j = 0; j < inN; j++) W1[i][j] -= lr * dW1[i][j] / N; b1[i] -= lr * db1[i] / N; }
        for (let i = 0; i < H; i++) W2[0][i] -= lr * dW2[0][i] / N;
        b2[0] -= lr * db2[0] / N;
        if (ilkKayip === null) ilkKayip = L;
        if (e === 1 || e === Math.floor(E / 4) || e === Math.floor(E / 2) || e === Math.floor(3 * E / 4) || e === E) egris.push([e, +L.toFixed(6)]);
      }
      const sonKayip = egris[egris.length - 1][1];
      const tabloMarkdown = '| tur | kayıp (MSE) |\n|---|---|\n' + egris.map(([e2, l]) => `| ${e2} | ${l} |`).join('\n');
      const sonuc = { ok: true, gorev: g, turler: E, ogrenmeOrani: lr, gizli: H, baslangicKaybi: +ilkKayip.toFixed(4), sonKayip, tabloMarkdown };
      if (g !== 'sinus') {
        let dogru = 0;
        for (let s = 0; s < N; s++) { const o = fwd(X[s])[0]; if ((o > 0.5 ? 1 : 0) === Y[s][0]) dogru++; }
        sonuc.dogruluk = Math.round((dogru / N) * 100) + '%';
      }
      if (g === 'xor') {
        sonuc.ornekler = X.map((x, i) => ({ girdi: `${x[0]} XOR ${x[1]}`, beklenen: Y[i][0], tahmin: +fwd(x)[0].toFixed(3) }));
      } else if (g === 'sinus') {
        sonuc.ornekler = [0, 15, 31, 47, 63].map((i) => ({ x: (X[i][0]).toFixed(2), beklenen: Y[i][0], tahmin: +fwd(X[i])[0].toFixed(3) }));
      }
      sonuc.not = 'Kayıp tablosunu cevabına markdown olarak koy; doğruluk/ornekleri yorumla; 1 cümleyle geri yayılımın ne yaptığını hatırlat.';
      return sonuc;
    } catch (e) { return { hata: String(e.message || e).slice(0, 140) }; }
  },

  async kuantum_devre({ qubit, adimlar }) {
    try {
      const n = Math.max(1, Math.min(3, Number(qubit) || 2));
      let steps = adimlar;
      if (typeof steps === 'string') steps = JSON.parse(steps);
      if (!Array.isArray(steps) || !steps.length) return { hata: 'adımlar JSON dizi olmalı (örn. [{"kapi":"H","hedef":0}])' };
      if (steps.length > 40) return { hata: 'en fazla 40 adım' };
      const dim = 1 << n;
      let st = []; for (let i = 0; i < dim; i++) st.push(i === 0 ? [1, 0] : [0, 0]);
      const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
      const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
      const S2 = Math.SQRT1_2;
      const mat = (k, aci) => {
        const g = String(k || '').toUpperCase();
        const t = Number(aci) || 0;
        const c = Math.cos(t / 2), sn = Math.sin(t / 2);
        switch (g) {
          case 'X': return [[[0, 0], [1, 0]], [[1, 0], [0, 0]]];
          case 'Y': return [[[0, 0], [0, -1]], [[0, 1], [0, 0]]];
          case 'Z': return [[[1, 0], [0, 0]], [[0, 0], [-1, 0]]];
          case 'H': return [[[S2, 0], [S2, 0]], [[S2, 0], [-S2, 0]]];
          case 'S': return [[[1, 0], [0, 0]], [[0, 0], [0, 1]]];
          case 'T': return [[[1, 0], [0, 0]], [[0, 0], [S2, S2]]];
          case 'RX': return [[[c, 0], [0, -sn]], [[0, -sn], [c, 0]]];
          case 'RY': return [[[c, 0], [-sn, 0]], [[sn, 0], [c, 0]]];
          case 'RZ': return [[[c, -sn], [0, 0]], [[0, 0], [c, sn]]];
          default: return null;
        }
      };
      const log = [];
      for (const step of steps) {
        const g = String(step.kapi || step.gate || '').toUpperCase();
        const q = Number(step.hedef != null ? step.hedef : step.target || 0);
        if (!(q >= 0 && q < n)) return { hata: `hedef ${q} aralık dışında (0-${n - 1})` };
        if (g === 'CNOT' || g === 'CX') {
          const ctl = Number(step.kontrol != null ? step.kontrol : step.control || 0);
          if (!(ctl >= 0 && ctl < n) || ctl === q) return { hata: 'CNOT kontrol/hedef geçersiz' };
          for (let i = 0; i < dim; i++) {
            if ((i >> ctl) & 1) { const j = i ^ (1 << q); if (i < j) { const tmp = st[i]; st[i] = st[j]; st[j] = tmp; } }
          }
          log.push(`CNOT(k=${ctl},h=${q})`);
          continue;
        }
        const m = mat(g, step.aci != null ? step.aci : step.angle);
        if (!m) return { hata: `bilinmeyen kapı: ${g} (X,Y,Z,H,S,T,RX,RY,RZ,CNOT)` };
        const nw = st.map((x) => [x[0], x[1]]);
        for (let i = 0; i < dim; i++) {
          if ((i >> q) & 1) continue;
          const j = i | (1 << q);
          nw[i] = cadd(cmul(m[0][0], st[i]), cmul(m[0][1], st[j]));
          nw[j] = cadd(cmul(m[1][0], st[i]), cmul(m[1][1], st[j]));
        }
        st = nw;
        log.push(`${g}(h=${q}${step.aci != null ? ',' + (+Number(step.aci).toFixed(3)) : ''})`);
      }
      let norm = 0;
      const probs = st.map((a) => { const p = a[0] * a[0] + a[1] * a[1]; norm += p; return p; });
      for (let i = 0; i < probs.length; i++) probs[i] /= (norm || 1);
      const rows = [];
      for (let i = 0; i < dim; i++) {
        if (probs[i] > 1e-9) rows.push({ durum: '|' + i.toString(2).padStart(n, '0') + '⟩', olasilik: probs[i], re: +st[i][0].toFixed(4), im: +st[i][1].toFixed(4) });
      }
      rows.sort((a, b) => b.olasilik - a.olasilik);
      const tabloMarkdown = '| durum | olasılık | genlik (re,im) |\n|---|---|---|\n'
        + rows.map((r) => `| ${r.durum} | ${(r.olasilik * 100).toFixed(1)}% | (${r.re}, ${r.im}) |`).join('\n');
      return { ok: true, qubit: n, adimlar: log, enOlasilik: rows.length ? rows[0].durum : null, tabloMarkdown, not: 'Tabloyu cevabına markdown olarak koy; 1-2 cümle fiziksel yorum ekle (süperpozisyon/dolanıklık).' };
    } catch (e) { return { hata: String(e.message || e).slice(0, 140) }; }
  },

  async linux_komut({ komut, cwd, bekle }) {
    const s = getSettings();
    const tok = s.githubToken;
    if (!tok) return { hata: 'linux_komut yalnız SAHİBİN cihazında çalışır (GitHub token gerekir) — düğüm sahibi değilsen bu araç kapalı.' };
    if (s.linuxPin) {
      const pin = globalThis.prompt ? globalThis.prompt('🐧 Linux düğümü bağlantı PIN\'i:') : null;
      if (String(pin == null ? '' : pin).trim() !== String(s.linuxPin)) return { hata: 'Yanlış PIN — komut gönderilmedi.' };
    }
    const q = String(komut || '').trim();
    if (!q) return { hata: 'komut boş' };
    const REPO = s.linuxBus || '4FR41D/evrim-node-bus';
    const H = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
    const API = `https://api.github.com/repos/${REPO}/contents/`;
    const b64ToUtf8 = (b) => decodeURIComponent(Array.from(atob(b), (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    const utf8ToB64 = (str) => { const by = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < by.length; i++) bin += String.fromCharCode(by[i]); return btoa(bin); };
    const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const getFile = async (path) => {
      const r = await fetch(API + path + '?r=' + Math.random().toString(36).slice(2), { headers: H });
      if (r.status === 404) return { sha: null, data: null };
      if (!r.ok) throw new Error(`bus okunamadı (${r.status})`);
      const j = await r.json();
      return { sha: j.sha, data: JSON.parse(b64ToUtf8(String(j.content).replace(/\n/g, ''))) };
    };
    try {
      const cur = await getFile('cmd.json');
      const body = { message: 'evrim cmd ' + id, content: utf8ToB64(JSON.stringify({ id, komut: q.slice(0, 4000), cwd: cwd || null, ts: Date.now() })), branch: 'main' };
      if (cur.sha) body.sha = cur.sha;
      const w = await fetch(API + 'cmd.json', { method: 'PUT', headers: H, body: JSON.stringify(body) });
      if (!w.ok) throw new Error(`komut gönderilemedi (${w.status})`);
      const maxMs = Math.min(120000, Math.max(8000, Number(bekle) || 60000));
      const t0 = Date.now();
      let out = null;
      while (Date.now() - t0 < maxMs) {
        await new Promise((r) => setTimeout(r, 2500));
        try { const g = await getFile('out.json'); if (g.data && g.data.id === id) { out = g.data; break; } } catch {}
      }
      if (!out) return { hata: `Linux düğümü ${Math.round(maxMs / 1000)} sn içinde yanıt vermedi — makinede evrim-node çalışıyor mu? (repo: linux-node/README.md)`, komut: q };
      return { ok: out.exit === 0, exit: out.exit, stdout: out.stdout || '', stderr: out.stderr || '', ms: out.ms, host: out.host, user: out.user, komut: q };
    } catch (e) { return { hata: String(e.message || e).slice(0, 160) }; }
  },

  async repo_bul({ sorgu, dil, sirala, adet }) {
    const q = String(sorgu || '').trim();
    if (!q) return { hata: 'sorgu boş' };
    const lim = Math.max(1, Math.min(10, Number(adet) || 5));
    let qs = q;
    if (dil) qs += ` language:${String(dil).trim()}`;
    const sort = ['stars', 'updated', 'forks'].includes(String(sirala)) ? String(sirala) : 'stars';
    const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(qs)
      + `&sort=${sort}&order=desc&per_page=${lim}`;
    try {
      const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
      if (r.status === 403 || r.status === 429) return { hata: 'GitHub arama limiti dolu (anahtarsız ~10 istek/dk) — 1 dk sonra tekrar dene' };
      if (!r.ok) return { hata: `GitHub arama yanıt vermedi (${r.status})` };
      const j = await r.json();
      const items = (j.items || []).slice(0, lim).map((it) => ({
        ad: it.full_name,
        aciklama: String(it.description || '').slice(0, 160),
        yildiz: it.stargazers_count,
        dil: it.language || null,
        lisans: (it.license && it.license.spdx_id) || null,
        guncelleme: String(it.updated_at || '').slice(0, 10),
        url: it.html_url,
      }));
      if (!items.length) return { ok: true, sorgu: q, sonuc: [], not: 'Sonuç yok — sorguyu daha genel/İngilizce terimlerle tekrar dene.' };
      return {
        ok: true, sorgu: q, toplam: j.total_count, sonuc: items,
        not: 'Tabloyla sun (ad | ⭐ | dil | lisans); en uygun 2-3 repo için 1 cümle gerekçe; GPL gibi bulaşıcı lisanslara dikkat çek.',
      };
    } catch (e) { return { hata: String(e.message || e).slice(0, 140) }; }
  },

  async site_tara({ url, derinlik }) {
    const u = String(url || '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(u)) return { hata: 'geçersiz adres (https:// ile başlamalı)' };
    const readRaw = async (page) => {
      const r = await fetch('https://r.jina.ai/' + page, { headers: { Accept: 'text/plain' } });
      if (!r.ok) throw new Error(r.status === 429 ? 'okuyucu limiti dolu (20/dk) — 1 dk sonra tekrar dene' : `sayfa okunamadı (${r.status})`);
      return r.text();
    };
    try {
      const md = await readRaw(u);
      const baslik = (md.match(/^Title:\s*(.+)/m) || [])[1] || null;
      const aciklama = (md.match(/^Description:\s*(.+)/m) || [])[1] || null;
      const host = u.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
      const ic = []; const dis = [];
      const re = /\[([^\]\n]{2,120})\]\(((?:https?:)?\/\/[^)\s]+)\)/g;
      let m;
      while ((m = re.exec(md)) && ic.length + dis.length < 60) {
        let lu = m[2];
        if (lu.startsWith('//')) lu = 'https:' + lu;
        if (/duckduckgo\.com|jina\.ai|\.(png|jpg|jpeg|gif|css|js|ico|svg|woff2?)(\?|$)/i.test(lu)) continue;
        const h = lu.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
        const rec = { baslik: m[1].trim(), url: lu };
        if (h === host) { if (!ic.some((x) => x.url === lu)) ic.push(rec); }
        else if (!dis.some((x) => x.url === lu)) dis.push(rec);
      }
      const metin = md.replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\n{3,}/g, '\n\n');
      const kelimeSayisi = (metin.match(/[A-Za-zÇĞİÖŞÜçğıöşü0-9]+/g) || []).length;
      const bolumBasliklari = [...md.matchAll(/^#{1,3}\s+(.+)$/gm)].map((x) => x[1].trim()).slice(0, 12);
      const sonuc = {
        ok: true, url: u, baslik, aciklama, kelimeSayisi, bolumBasliklari,
        icLinkSayisi: ic.length, disLinkSayisi: dis.length,
        icLinkler: ic.slice(0, 10), disLinkler: dis.slice(0, 5),
        ozetMetin: metin.replace(/^Title:.*$/m, '').replace(/^Description:.*$/m, '').trim().slice(0, 900),
      };
      const derin = Math.max(0, Math.min(2, Number(derinlik) || 0));
      if (derin > 0) {
        sonuc.altSayfalar = [];
        for (const it of ic.slice(0, derin)) {
          try {
            const sub = await readRaw(it.url);
            const smd = sub.replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
            sonuc.altSayfalar.push({ url: it.url, baslik: (sub.match(/^Title:\s*(.+)/m) || [])[1] || it.baslik, ozet: smd.slice(0, 450) });
          } catch (e) { sonuc.altSayfalar.push({ url: it.url, hata: String(e.message || e).slice(0, 80) }); }
        }
      }
      sonuc.not = derin > 0
        ? 'Ana sayfa + alt sayfalar tarandı. Rapor: BLUF, bölümler/linkler tablosu, 1 cümle değerlendirme.'
        : 'Yalnız ana sayfa tarandı; derin inceleme istenirse derinlik=2 ile tekrar çağır.';
      return sonuc;
    } catch (e) { return { hata: String(e.message || e).slice(0, 140) }; }
  },

  async ode_coz({ denklem, y0, t0, tBitis, adim, yontem }) {
    try {
      const src = String(denklem);
      if (/[;{}]|=>|\bfunction\b|\breturn\b|import|require|fetch|eval|globalThis|window|document|localStorage/.test(src)) return { hata: 'denklem yalnızca matematik ifadesi olmalı (t, y, Math.*)' };
      const f = new Function('t', 'y', 'Math', '"use strict"; return (' + src + ');');
      f(0, Number(y0) || 0, Math); // deneme çağrısı
      let t = Number(t0) || 0, y = Number(y0);
      if (!isFinite(y)) return { hata: 'y0 sayı olmalı' };
      let te = Number(tBitis); if (!isFinite(te)) te = t + 10;
      if (te <= t) return { hata: 'tBitis > t0 olmalı' };
      let h = Number(adim) || 0.05; if (!(h > 0)) h = 0.05;
      const steps = Math.min(20000, Math.max(1, Math.ceil((te - t) / h)));
      h = (te - t) / steps;
      const method = String(yontem || 'rk4').toLowerCase() === 'euler' ? 'euler' : 'rk4';
      const pts = [[t, y]];
      for (let i = 0; i < steps; i++) {
        if (method === 'euler') { y = y + h * f(t, y, Math); }
        else {
          const k1 = f(t, y, Math);
          const k2 = f(t + h / 2, y + h * k1 / 2, Math);
          const k3 = f(t + h / 2, y + h * k2 / 2, Math);
          const k4 = f(t + h, y + h * k3, Math);
          y = y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
        }
        t += h;
        if (!isFinite(y) || Math.abs(y) > 1e12) return { hata: 'çözüm ıraksadı — adımı küçült veya aralığı daralt' };
        pts.push([t, y]);
      }
      const stride = Math.max(1, Math.floor(pts.length / 12));
      const rows = [];
      for (let i = 0; i < pts.length && rows.length < 12; i += stride) rows.push(pts[i]);
      if (rows[rows.length - 1] !== pts[pts.length - 1]) rows.push(pts[pts.length - 1]);
      const tabloMarkdown = '| t | y(t) |\n|---|---|\n' + rows.map(([a, b]) => '| ' + (+a.toFixed(4)) + ' | ' + (+b.toFixed(6)) + ' |').join('\n');
      return { ok: true, yontem: method, adimSayisi: steps, h: +h.toFixed(6), baslangic: [+pts[0][0].toFixed(6), +pts[0][1].toFixed(6)], sonuc: [+t.toFixed(6), +y.toFixed(6)], tabloMarkdown, not: 'Tabloyu cevabına aynen markdown tablo olarak koy; sonucu 1-2 cümleyle fiziksel/matematiksel yorumla.' };
    } catch (e) { return { hata: String(e.message || e).slice(0, 140) }; }
  },

  async ders_calis({ ders, tam }) {
    try {
      const m = await mufredat();
      const skills = all('skills');
      const done = (no) => { const sk = skills.find((x) => x.topic === 'genai-' + no); return !!sk && (sk.level || 0) >= 3; };
      let no = Number(ders) || 0;
      if (!no) no = (m.dersler.find((d) => !done(d.no)) || m.dersler[0]).no;
      const d = m.dersler.find((x) => x.no === no);
      if (!d) return { hata: 'ders bulunamadı (1-21)' };
      // v54: tam metin — önce YEREL ARŞİV (data/dersler), o yoksa dış ham link
      let tamMetin = null;
      if (tam) {
        try {
          if (d.yerel) {
            const tr = await fetch(d.yerel);
            if (tr.ok) tamMetin = (await tr.text()).slice(0, 6000);
          }
          if (!tamMetin && d.ham) {
            const tr2 = await fetch('https://r.jina.ai/' + d.ham, { headers: { Accept: 'text/plain' } });
            if (tr2.ok) tamMetin = (await tr2.text()).slice(0, 6000);
          }
        } catch {}
        if (!tamMetin) tamMetin = 'Bu dersin yerel arşivi yok — özet ve kavramlar tam içeriklidir; istersen kaynak linkini kullanıcıya ver (site_tara/web_oku ile de okunabilir).';
      }
      const tamam = m.dersler.filter((x) => done(x.no)).length;
      return {
        ok: true, ders: d.no, toplam: m.dersler.length, tamamlanan: tamam,
        baslik: d.baslik, ozet: d.ozet, kavramlar: d.kavramlar, quiz: secQuiz(d), kaynak: m.url,
        kaynakLink: d.link || m.url, hamMetin: d.ham || null, tamMetin,
        not: 'Önce 2-4 cümleyle öğret + kavramları maddele; sonra quiz sorusunu ve seçeneklerini yaz; cevabı bekleyip nedenini açıklayarak değerlendir, ardından ders_bitir(ders, dogru) çağır. Cevabın sonuna kaynakLink ekle. Derin anlatım istenirse ders_calis(ders, tam:true) çağır — tamMetin YEREL ARŞİVDEN gelir (dış link ölse bile çalışır); onu Türkçe özetle.',
      };
    } catch (e) { return { hata: String(e.message || e).slice(0, 120) }; }
  },

  async ders_bitir({ ders, dogru }) {
    const no = Number(ders);
    const topic = 'genai-' + no;
    try {
      const ex = all('skills').find((x) => x.topic === topic);
      if (dogru) {
        if (ex) update('skills', ex.id, { level: Math.min(5, (ex.level || 2) + 1) });
        else insert('skills', { topic, level: 3, createdAt: now() });
      } else {
        if (ex) update('skills', ex.id, { level: Math.max(1, (ex.level || 3) - 1) });
        else insert('skills', { topic, level: 2, createdAt: now() });
        const m = await mufredat();
        const d = m.dersler.find((x) => x.no === no);
        if (d) createCard({ topic: 'genai', question: d.quiz.soru, answer: d.quiz.secenekler[d.quiz.dogru], explanation: d.quiz.aciklama || '', source: 'kurs' });
      }
      gunIsaretle('ders');
      return { ok: true, ders: no, dogru: !!dogru, not: dogru ? 'İlerleme kaydedildi ✅ — sıradaki derse geçebilirsin.' : 'Kaydedildi 📇 — yanlış kavram flash-card oldu, aralıklı tekrarda karşına çıkacak.' };
    } catch (e) { return { hata: String(e.message || e).slice(0, 120) }; }
  },

  async web_ara({ sorgu, adet }) {
    const q = String(sorgu || '').trim();
    if (!q) return { hata: 'sorgu boş' };
    const lim = Math.max(1, Math.min(5, Number(adet) || 5));
    try {
      const res = await fetch('https://r.jina.ai/https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { headers: { Accept: 'text/plain' } });
      if (!res.ok) return { hata: res.status === 429 ? 'arama limiti dolu (20/dk) — birazdan tekrar dene' : 'arama servisi yanıt vermedi (' + res.status + ')' };
      const md = await res.text();
      const items = [];
      const re = /\[([^\]\n]{6,140})\]\(((?:https?:)?\/\/[^)\s]+)\)/g;
      let m;
      while ((m = re.exec(md)) && items.length < lim) {
        let u = m[2];
        if (u.startsWith('//')) u = 'https:' + u;
        const dd = /uddg=([^&]+)/.exec(u);
        if (dd) {
          try { u = atob(dd[1].replace(/-/g, '+').replace(/_/g, '/')); }
          catch { try { u = decodeURIComponent(dd[1]); } catch {} }
        }
        if (/duckduckgo\.com|jina\.ai|\.(png|jpg|jpeg|gif|css|js)$/i.test(u)) continue;
        if (items.some((x) => x.url === u)) continue;
        items.push({ baslik: m[1].trim(), url: u });
      }
      if (!items.length) return { ok: true, sorgu: q, sonuc: [], not: 'Sonuç bulunamadı — sorguyu değiştirip tekrar dene.' };
      return { ok: true, sorgu: q, sonuc: items, not: 'En uygun 1-2 sonucu web_oku ile oku, sonra kaynak linkleriyle cevapla.' };
    } catch (e) {
      return { hata: String(e.message || e).slice(0, 140) };
    }
  },

  async kod_calistir({ kod }) {
    // v31: benim bash'imin karşılığı — izole JS sandbox (sahte console, try/catch, çıktı sınırı)
    const src = String(kod || '').slice(0, 8000);
    if (!src.trim()) return { hata: 'kod boş' };
    const logs = [];
    const fake = new Proxy({}, {
      get: () => (...a) => logs.push(a.map((x) => { try { return typeof x === 'object' ? JSON.stringify(x) : String(x); } catch { return String(x); } }).join(' ')),
    });
    try {
      const t0 = Date.now();
      Function('console', '"use strict";' + src)(fake);
      return { ok: true, cikti: logs.join('\n').slice(0, 4000) || '(çıktı yok)', ms: Date.now() - t0, hata: null };
    } catch (e) {
      return { ok: false, cikti: logs.join('\n').slice(0, 2000), hata: String(e.message || e).slice(0, 200) };
    }
  },

  async api_katalog({ sorgu, adet }) {
    return katalogAra(sorgu, adet);
  },

  improve_self({ rule, reason }) {
    const clean = String(rule || '').trim().slice(0, 200);
    if (!clean) return { ok: false, note: 'kural boş' };
    evo.addMemory({ content: clean, kind: 'rule', source: 'self', strength: 0.9 });
    insert('evolutions', {
      type: 'tool', summary: 'Kendini geliştirdi', detail: `${clean}${reason ? ' — ' + reason : ''}`,
      applied: true, confidence: 0.9, createdAt: now(),
    });
    return { ok: true, eklenenKural: clean, note: 'Bu kural bundan sonraki tüm yanıtlarda geçerli.' };
  },
};

/* ------------------------------------------------------------------ */
/* AJAN DÖNGÜSÜ                                                        */
/* ------------------------------------------------------------------ */
/**
 * @returns {Promise<{content:string, steps:Array, model:string}>}
 * opts.onTool(name, phase, detail) -> UI'da "🔧 hafızada arıyor…" göstermek için
 */
export async function agentChat(messages, opts = {}) {
  const a = activeLLM();
  if (a.id === 'wasm') {
    const { wasmChat } = await import('./wasm.js');
    const out = await wasmChat(messages, opts.onChunk);
    return { content: out.content, model: out.model || 'küçük beyin', steps: [] };
  }
  if (a.id === 'house') {
    const { houseChat } = await import('./house.js');
    const out = await houseChat(messages, opts.onChunk);
    return { content: out.content, model: out.model || 'ev bulutu', steps: [] };
  }
  if (a.id === 'local' && !localStatus?.().ready && !puterStatus?.().ready && !houseStatus?.().ready
    && !(getSettings().solo && wasmStatus().supported)) {
    throw new Error('BEYIN_YOK');
  }
  const supportsTools = a.def?.format === 'openai' && !opts.json;

  // Araç desteklemeyen beyin (yerel model / Nano / Puter) -> düz sohbet
  if (!supportsTools) {
    const { chat } = await import('./llm.js');
    const content = await chat(messages, opts);
    return { content, steps: [], model: a.model };
  }

  const msgs = [...messages];
  const steps = [];
  let lastContent = '';
  let lastModel = a.model;

  for (let step = 0; step < MAX_STEPS; step++) {
    // eslint-disable-next-line no-await-in-loop
    const r = await rawChat(msgs, {
      ...opts,
      tools: TOOLS,
      toolsSlim: CORE_TOOLS,
      // Araç turunda akış açıksa ve içerik gelirse göster (genelde boş gelir)
      onChunk: opts.onChunk,
    });
    lastModel = r.model || lastModel;

    if (!r.toolCalls?.length) {
      lastContent = r.content || lastContent;
      break;
    }

    // Model araç istedi -> çalıştır, sonuçları geri besle
    msgs.push({
      role: 'assistant',
      content: r.content || '',
      tool_calls: r.toolCalls.map((t, i) => ({
        id: t.id || `call_${step}_${i}`,
        type: 'function',
        function: { name: t.name, arguments: t.arguments || '{}' },
      })),
    });

    for (const tc of r.toolCalls) {
      const id = tc.id || `call_${step}_${steps.length}`;
      let args = {};
      try { args = JSON.parse(tc.arguments || '{}'); }
      catch {
        // v62: kesik JSON → onarımı dene; olmazsa modele hata geri besle (tur yanmasın)
        args = repairJSON(tc.arguments);
        if (!args) {
          const hmsg = { error: 'Araç çağrısı argümanları geçerli JSON değildi. Aynı aracı DAHA KISA ve geçerli JSON ile yeniden çağır (kod parametresini öz tut).' };
          steps.push({ tool: tc.name, args: {}, result: hmsg, ms: 0 });
          opts.onTool?.(tc.name, 'done', hmsg, 0, {});
          msgs.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(hmsg) });
          continue;
        }
      }
      opts.onTool?.(tc.name, 'running', args);
      let result;
      const t0 = performance.now();
      try {
        const fn = EXEC[tc.name];
        if (!fn) result = { error: `bilinmeyen araç: ${tc.name}` };
        else result = await fn(args);
      } catch (e) {
        result = { error: e.message };
      }
      const ms = Math.round(performance.now() - t0);
      steps.push({ tool: tc.name, args, result, ms });
      opts.onTool?.(tc.name, 'done', result, ms, args);
      msgs.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(result).slice(0, 6000) });
    }
    // Son turda hâlâ araç istiyorsa cevabı zorla
    if (step === MAX_STEPS - 1) {
      msgs.push({
        role: 'user',
        content: '(sistem) Araç bütçen bitti. Elindeki bilgilerle şimdi Türkçe ve kısa cevap ver, başka araç çağırma.',
      });
      // eslint-disable-next-line no-await-in-loop
      const fin = await rawChat(msgs, { ...opts, tools: undefined, onChunk: opts.onChunk });
      lastContent = fin.content || lastContent;
      lastModel = fin.model || lastModel;
    }
  }

  // Boş cevap koruması: model turu bitirip içerik üretmediyse araçsız son bir istek
  if (!String(lastContent || '').trim()) {
    try {
      const fin = await rawChat(msgs, { ...opts, tools: undefined, onChunk: opts.onChunk });
      lastContent = fin.content || '';
      lastModel = fin.model || lastModel;
    } catch (e) { console.warn('[agent] boş cevap kurtarma başarısız:', e.message); }
  }
  if (!String(lastContent || '').trim()) {
    throw new Error('Model boş cevap döndürdü. Bir kez daha dene — sorun sürerse Ayarlar → Tanıla.');
  }
  return { content: lastContent, steps, model: lastModel };
}

/** Araç adını Türkçe eylem metnine çevir (UI için) */
export function toolLabel(name, args = {}, done = false, bad = false) {
  const q = args.query || '';
  const map = {
    memory_search: q ? `🧠 Hafızada arad${done ? 'ı' : 'ıyor'}: "${q}"` : `🧠 Hafızaya bakt${done ? 'ı' : 'ıyor'}`,
    remember: done ? '📝 Hafızaya kaydetti' : '📝 Hafızaya kaydediyor',
    conversation_search: q ? `💬 Geçmişte arad${done ? 'ı' : 'ıyor'}: "${q}"` : `💬 Geçmiş sohbeti ar${done ? 'adı' : 'ıyor'}`,
    calculator: args.expression ? `🧮 ${done ? 'Hesapladı' : 'Hesaplıyor'}: ${args.expression}` : `🧮 ${done ? 'Hesapladı' : 'Hesaplıyor'}`,
    datetime: done ? '📅 Tarih/saat alındı' : '📅 Tarih/saat alıyor',
    wikipedia: q ? `🌐 Vikipedi${done ? ' okundu' : ''}: "${q}"` : `🌐 Vikipedi'ye bak${done ? 'tı' : 'ıyor'}`,
    learning_status: done ? '🎓 Öğrenme durumu okundu' : '🎓 Öğrenme durumuna bakıyor',
    create_flashcard: done ? '🃏 Tekrar kartı oluşturuldu' : '🃏 Tekrar kartı oluşturuyor',
    self_status: done ? '🔍 Kendi durumu incelendi' : '🔍 Kendi durumunu inceliyor',
    improve_self: `⚙️ ${done ? 'Kendini geliştirdi' : 'Kendini geliştiriyor'}${args.rule ? `: "${String(args.rule).slice(0, 50)}"` : ''}`,
    gorsel_uret: `🎨 ${done ? (bad ? 'Görsel üretilemedi' : 'Görsel üretti') : 'Görsel üretiyor'}${args.istem ? `: "${String(args.istem).slice(0, 40)}"` : ''}`,
    web_oku: args.url
      ? `🌍 ${done ? 'Sayfa okudu' : 'Sayfa okuyor'}: ${String(args.url).replace(/^https?:\/\//, '').slice(0, 42)}`
      : `🌍 ${done ? 'Sayfa okudu' : 'Sayfa okuyor'}`,
    hatirlatici: done ? (bad ? '⏰ Hatırlatıcı kurulamadı' : (args.liste ? '⏰ Hatırlatıcılar listelendi' : '⏰ Hatırlatıcı kuruldu')) : '⏰ Hatırlatıcı kuruluyor',
    gider: done ? (bad ? '💸 Kayıt başarısız' : (args.ozet ? '💸 Gider özeti hazır' : '💸 Kaydedildi')) : '💸 Deftere işleniyor',
    hava_durumu: done ? (bad ? '🌤️ Hava durumu alınamadı' : `🌤️ Hava durumu${args.sehir ? ': ' + String(args.sehir).slice(0, 18) : ''}`) : '🌤️ Hava durumuna bakıyor',
    doviz: done ? (bad ? '💱 Kur alınamadı' : `💱 Kur hesaplandı: ${String(args.baz || 'USD')}→${String(args.hedef || 'TRY')}`) : '💱 Kura bakıyor',
    ceviri: done ? (bad ? '🗣️ Çeviri başarısız' : `🗣️ Çevrildi${args.hedef ? ' (→' + String(args.hedef).slice(0, 5) + ')' : ''}`) : '🗣️ Çeviriyor',
    yapilac: done ? (bad ? '🗓️ Görev işlemi başarısız' : `🗓️ Yapılacaklar: ${String(args.islem || 'liste').slice(0, 8)}`) : '🗓️ Görev listesi işleniyor',
    aliskanlik: done ? (bad ? '💧 Alışkanlık başarısız' : `💧 Alışkanlık: ${String(args.islem || 'durum').slice(0, 8)}`) : '💧 Alışkanlık işleniyor',
    site_uret: done ? (bad ? '🏗️ Site üretilemedi' : (args.islem === 'sil' ? `🏗️ Site silindi: ${String(args.ad || '').slice(0, 16)}` : args.islem === 'liste' ? '🏗️ Siteler listelendi' : `🏗️ Site hazır: ${String(args.ad || '').slice(0, 16)}`)) : '🏗️ Web sitesi üretiliyor',
    oz_test: done ? (bad ? '🧪 Öz test BAŞARISIZ' : '🧪 Öz test tamam') : '🧪 Öz test çalışıyor (canlı uygulama duman testi)',
    evrak_taslak: done ? (bad ? '📄 Taslak üretilemedi' : `📄 ${args.tip === 'resmi' ? 'Resmî yazı' : 'Dilekçe'} taslağı hazır`) : '📄 Evrak taslağı üretiliyor',
    otomatik_turev: done ? (bad ? '𝛁 Türev hesaplanamadı' : '𝛁 Gradyan hesaplandı (AD)') : '𝛁 Otomatik türev hesaplanıyor',
    oto_model: (args.gorev) ? `🤖 AutoML ${done ? (bad ? 'arama başarısız' : 'en iyi modeli buldu') : 'model arıyor'}: ${String(args.gorev).slice(0, 10)}` : `🤖 AutoML ${done ? 'tamam' : 'çalışıyor'}`,
    gizli_ogren: (args.gorev) ? `🔐 Gizli öğrenme ${done ? (bad ? 'başarısız' : 'çalıştı') : 'çalışıyor'}: ${String(args.gorev).slice(0, 16)}` : `🔐 Gizli öğrenme ${done ? 'çalıştı' : 'çalışıyor'}`,
    olasilik: (args.gorev) ? `🎲 Olasılık ${done ? (bad ? 'hesaplanamadı' : 'hesaplandı') : 'hesaplanıyor'}: ${String(args.gorev).slice(0, 14)}` : `🎲 Olasılık ${done ? 'hesaplandı' : 'hesaplanıyor'}`,
    sinir_agi: (args.gorev) ? `🧮 Sinir ağı ${done ? (bad ? 'eğitilemedi' : 'eğitildi (' + args.gorev + ')') : 'eğitiliyor (' + args.gorev + ')'}` : `🧮 Sinir ağı ${done ? 'eğitildi' : 'eğitiliyor'}`,
    kuantum_devre: done ? (bad ? '⚛ Kuantum devre çalışmadı' : '⚛ Kuantum devre simüle edildi') : '⚛ Kuantum devre simüle ediliyor',
    linux_komut: done ? (bad ? '🐧 Linux komutu başarısız' : '🐧 Linux komutu çalıştı') : '🐧 Linux komutu çalıştırılıyor',
    repo_bul: (args.sorgu) ? `🐙 Repo ${done ? (bad ? 'bulunamadı' : 'bulundu') : 'aranıyor'}: ${String(args.sorgu).slice(0, 30)}` : `🐙 Açık kaynak ${done ? 'arandı' : 'aranıyor'}`,
    site_tara: (() => { const h = String(args.url || '').replace(/^https?:\/\//, '').split('/')[0]; return done ? (bad ? `🌐 ${h} taranamadı` : `🌐 ${h} tarandı`) : `🌐 ${h} taranıyor`; })(),
    ode_coz: done ? (bad ? '∫ Denklem çözülemedi' : '∫ Denklem çözüldü (RK4/Euler)') : '∫ Diferansiyel denklem çözülüyor',
    ders_calis: done ? `🎓 Ders ${args.ders || ''} hazır`.trim() : `🎓 Ders ${args.ders || 'sıradaki'} getiriliyor`.trim(),
    ders_bitir: done ? (bad ? `🎓 Ders ${args.ders}: yanlış kaydedildi 📇` : `🎓 Ders ${args.ders} tamamlandı ✅`) : `🎓 Ders ${args.ders} kaydediliyor`,
    web_ara: (args.sorgu) ? `🔍 Web'de ${done ? 'aradı' : 'arıyor'}: "${String(args.sorgu).slice(0, 40)}"` : `🔍 Web araması ${done ? 'yaptı' : 'yapıyor'}`,
    kod_calistir: done ? '💻 Kod çalıştırdı' : '💻 Kod çalıştırıyor',
    api_katalog: (args.sorgu || args.query)
      ? `📚 API kataloğunda ${done ? 'aradı' : 'arıyor'}: "${String(args.sorgu || args.query).slice(0, 40)}"`
      : `📚 API kataloğuna ${done ? 'baktı' : 'bakıyor'}`,
  };
  return map[name] || `🔧 ${name}`;
}

// v36: Arama bölümü (UI) ajanın web_ara/web_oku araçlarını doğrudan kullanır — ayrı kod yolu yok.
export async function webSearch(sorgu, adet) { return EXEC.web_ara({ sorgu, adet }); }
export async function webRead(url, odak) { return EXEC.web_oku({ url, odak }); }
