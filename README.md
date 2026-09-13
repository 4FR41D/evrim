# EVRIM

> 🇹 **[turkiye-acik-kaynak-platformu](https://github.com/topics/turkiye-acik-kaynak-platformu)** konusunda listeli — Türkçe açık kaynak yapay zeka topluluğunun parçası.
> Canlı demo: **https://4fr41d.github.io/evrim/** · anahtarsız · ücretsiz · ajan döngülü
> 🛠 **Kendin geliştirmek istersen:** [GELISTIRME.md](GELISTIRME.md) — bilgisayarsız, tamamen telefondan: kodsuz kurallar → GitHub web editörü → Termux'ta testli geliştirme.


Mobil öncelikli bir web uygulaması (PWA). Dört modül tek çatı altında:

| Modül | Ne yapar |
|---|---|
| 💬 **Sohbet** | Hafızalı asistan. Seni tanır, tercihlerini hatırlar, yanıtlarını kişiselleştirir. |
| 🔁 **Evrim** | Her yanıttan sonra *meta-öğrenme* döngüsü çalışır: kalıcı bilgi çıkarır, kendi sistem promptuna kural yamar, beceri haritanı günceller. Sürüm geçmişi + tek tıkla geri alma. |
| 📚 **Öğren** | Spaced repetition (aralıklı tekrar). AI soru üretir, cevabını puanlar; yanlışlarına göre hem tekrar aralığını hem zorluğu otomatik ayarlar. |
| 🐙 **GitHub** | Reponu bağla: dosya ağacı, commit/issue/PR özeti, AI repo analizi ve **AI'ın ürettiği kodu doğrudan repoya commit atma**. |

Tamamen ücretsiz çalışacak şekilde tasarlandı: Groq / OpenRouter / Google Gemini ücretsiz katmanları.
Anahtar yoksa **demo modu** devreye girer, arayüz ve GitHub okuma yine çalışır.

---

## 🖥 Arayüz (v15 — Claude benzeri kabuk)

Canlı yayın: **`web/` klasörü → GitHub Pages (`docs/`)**. Sunucu gerekmez.

- **Giriş / profiller:** cihaz içi çoklu profil, isteğe bağlı PIN. Her profilin sohbet
  geçmişi ayrıdır. Sunucu olmadığı için "giriş" yalnızca bu cihazda geçerlidir.
- **Sohbet botları:** 7 hazır kişilik (EVRIM, Kod Uzmanı, Öğrenme Koçu, Yazı Editörü,
  Araştırmacı, Planlayıcı, Sohbet Arkadaşı) + kendi botunu oluşturma. Seçili botun
  kişiliği sistem promptuna eklenir; bot değiştirince yeni sohbet açılır.
- **Kenar çubuğu:** botlar, sohbet listesi (son etkinlik sırasıyla), profil çipi.
  Mobilde hamburger + çekmece. Alt sekme çubuğu kaldırıldı.
- **Günlük asistan (v56):** 🎙️ sesli mesaj yazdırma (Chrome), 📄 PDF okuma (metni sohbete gönderir),
  📷 fotoğraftan yazı okuma (OCR), ⏰ hatırlatıcı + bildirim, 💸 gider defteri, 📈 sohbet içi SVG grafik
  (` ```grafik ` bloğu), 🔥 günlük kullanım serisi, 🧾 tek dosya HTML yedek (tüm verin tek dosyada).
- **Günlük asistan 2 (v57):** 🌤️ hava durumu (open-meteo), 💱 döviz kuru (ECB), 🗣️ dil çevirisi,
  🗓️ yapılacaklar listesi, 💧 alışkanlık takibi + seri, 📅 hatırlatıcı → .ics takvim dosyası
  (telefon takvimine eklenince sekme kapalıyken de çalar). Hepsi anahtarsız/ücretsiz.
- **🔌 Bağımsız mod (v58):** Ayarlar'dan aç → EVRIM **hiçbir bulut API'si/AI'ı çağırmaz**
  (Groq/Puter/ücretsiz servisler tamamen kapalı). Sohbet + öğrenme + hafıza + kendini geliştirme
  %100 cihazda: SmolLM2-135M (WASM, ~90 MB bir kez) / Gemini Nano / WebLLM (WebGPU).
  Kurulumdan sonra **uçak modunda bile** çalışır.
- **🎯 Eğitim paneli (v59):** hazır eğitim paketleri (💻 Yazılım Öğretmeni, 📝 Sınav Koçu,
  💼 İş Asistanı, ✍️ Yazar/Editör), "şu konuda uzmanlaş" alanı, öğrenilen tüm kural +
  hafıza kayıtlarının listesi ve tek tek silinmesi. Kurallar beynin sistem promptuna işlenir.
- **Beyin v60:** 🧠 ilgili hafıza (mesajla örtüşen kayıtlar promptta öne çıkar),
  🎧 sesli sohbet modu (eller serbest: dinle → cevapla → seslendir → tekrar dinle),
  🌅 günlük brifing (günde bir, tamamen yerel: seri + hatırlatıcı + görev + alışkanlık + harcama).
- **🏗️ Site üretimi + canlı önizleme (v61):** "bana portföy sitesi yap" → beyin tek dosya HTML
  üretir (`site_uret`), sohbet içinde **sandbox iframe ile canlı önizleme** kartı açılır
  (👁 Önizle / ⛶ Tam ekran / ⬇️ İndir). "Başlığı mavi yap" → aynı adla güncellenir.
- **🩹 v62 hata onarımı:** `tool_use_failed / Failed to parse tool call arguments as JSON` kökten çözüldü —
  araç turlarında max_tokens 900→8000 (kesilme bitti), kesik JSON otomatik onarılır (`repairJSON`),
  yine de bozulursa araçsız tek tekrar → kullanıcı asla cevapsız kalmaz.
- **🏗️ v63 site garantisi:** beyin v14 kuralı site işlerinde `site_uret` çağırmayı ZORUNLU kılar
  (tek dosya + profesyonel tasarım rehberi); `site_uret` çekirdek araç setine girdi (küçük modeller de
  site üretir); model yine de ham kod yazarsa **yakalayıcı** devreye girer: HTML+CSS otomatik tek
  dosyaya çevrilir, mesajın altına canlı önizleme kartı (👁/⛶/⬇️) eklenir — önizleme ASLA kaçmaz.
- **🧠 v64 beyin gücü:** gpt-oss-120b artık `reasoning_effort: high` ile DERİN DÜŞÜNEREK cevap
  veriyor (canlı doğrulandı: 9.11 vs 9.9 tuzağını çözüyor); düşünce tokenları için max_tokens tabanı
  yükseltildi; düz cevap turlarında `groq/compound` (bileşik AI sistemi) yedek sıraya eklendi
  (araç çağrısı desteklemediği için yalnız araçsız turlarda); ajan döngüsü 4→6 adım.
- **🚀 v65 frontier teknikleri (açık kaynak):** (1) **Çoklu-beyin** — profesyonel modda taslağı
  `groq/compound` İKİNCİ bir beyin bağımsız eleştirir, final cevap ikisini bireşimler (ensemble/
  çapraz eleştiri tekniği; `settings.ensemble:false` ile kapanır). (2) **Derin hafıza (RAG)** — açık
  kaynak çok dilli gömme modeli (`paraphrase-multilingual-MiniLM-L12-v2`, ~45 MB, opt-in) hafıza
  kayıtlarını vektöre çevirir; sorulara ANLAMCA ilgili kayıtlar "İLGİLİ BAĞLAM" olarak sistem
  promptuna girer. Tamamen cihazda/çevrimdışı çalışır — sunucu ve anahtar yok.
- **🔬 v66 araştırma labı (7/24 kendi kendine öğrenme):** GitHub Actions üzerinde 6 saatte bir
  otomatik döngü — sabit bench sorularını mevcut beyin cevaplar, bağımsız LLM jürisi 0-10 puanlar,
  derslere doğrulanmış YENİ quizler üretilir (`ekQuizler`, kurs modunda rastgele sorulur), düşük
  puanlardan somut iyileştirme önerileri yazılır. Sonuçlar otomatik repoya işlenir; tam test paketi
  (299 test) regresyon kapısı olarak çalışır, geçmeden hiçbir şey commit edilmez. Günlük:
  `lab/ARASTIRMA.md` · Öneriler: `lab/ONERILER.md` · Ayarlar'da "🔬 Araştırma Labı" kartı.
- **🔁 v67 kapalı döngü (lab ölçtü → uygulandı):** lab'ın yakaladığı "elma tuzağı" zaafı beyin
  v15 kuralıyla giderildi (BİLMECE/ŞAŞIRTMACA: önce "soru ne istiyor?" cümlesi, sonra cevap —
  canlı A/B ile doğrulandı: kural öncesi yanlış, sonrası doğru); bench artık uygulamanın GERÇEK
  BASE_PROMPT'uyla ölçüyor ve aynı aileden YENİ soru (portakal-tuzak) eklendi — ezber değil
  genelleme ölçülür.
- **🤖 v68 oto-yama (tam otonomi):** lab artık kalıcı zayıflığı KENDİSİ düzeltir: bir bench
  maddesi 3 çalıştırma üst üste ≤3 puan alırsa kural adayı üretir, ADAY beyin promptuyla hedef +
  2 regresyon sorusunu A/B ölçer, hepsi ≥7 geçerse kuralı store.js'e işler (sürüm yükseltmeleri
  dahil mekanik) — son sözü 300 testlik regresyon kapısı söyler, geçmezse commit edilmez.
  Ayarlar kartında 📈 bench trendi ve 🔧 son oto-yama görünür. Mekanizma klon üzerinde canlı
  doğrulandı (kural üret → A/B 10/10/10 → uygula → suite 300/300).
- **🎨 v69 profesyonel site tasarımı:** beyin v16'ya "PROFESYONEL SİTE TASARIMI" bölümü eklendi
  (CSS değişkenleriyle tasarım sistemi, hero+CTA, kart/grid bölümler, gerçek Türkçe içerik — lorem
  yasak, mobil @media, erişilebilirlik, pollinations görselleri); lab'a `site-tasarim` bench sorusu
  girdi — tasarım kalitesi artık HER TURDA jüri puanıyla ölçülüyor, kalıcı düşüşte oto-yama devreye
  girer. Canlı ön prova: 251 satırlık tam donanımlı baklavacı landing page (tüm kontroller yeşil).
- **⏱️ v70 lab önerisi uygulandı:** öneri motoru temellendirildi (artık yalnız gerçek dosyaları
  öneriyor — ilk taze çıktısının 1 numaralı önerisi uygulandı): tüm araç ağ çağrılarına
  `fetchT` zaman aşımı (25sn, jina okuyucu 40sn, yerel veri 15sn) — mobilde asılı istekler
  ajanı artık kilitlemiyor, araç Türkçe "ağ zaman aşımı" hatasıyla hızlıca geri dönüyor.
  Ayrıca bench ölçüm bütünlüğü: cevaplar YALNIZ 120b'den ölçülür (yedek modele düşünce kimlik
  bozulmasın), günlük kota bitince ölçümler dürüstçe atlanır.
- **🌍 v71 site yayınlama (GitHub Pages):** site kartındaki yeni **🌍 Yayınla** düğmesi, üretilen
  siteyi kullanıcının KENDİ GitHub token'ıyla (cihazında kalır, app'e gömülü anahtar yok)
  `kullanici.github.io/evrim-siteler/<slug>.html` adresinde canlıya alır: repo yoksa oluşturur,
  dosyayı yükler/günceller, Pages'i açar, adresi gösterir. Tamamen tarayıcıdan, sunucusuz.
- **👁️ v72 site denetimi (EVRIM eserini görüyor):** `site_uret` artık üretilen siteyi OTOMATİK
  DENETİYOR — gizli iframe'de render edip yüklenmeyen görselleri, ölü iç linkleri, mobil yatay
  taşmayı, eksik viewport/alt/lang/h1'i yakalıyor; kusur raporu beyne dönüyor ve beyin aynı ad ile
  düzeltme turu atıyor (site güncelleniyor). Statik tarama her ortamda, render denetimi gerçek
  tarayıcıda çalışır. Böylece "tek atışta üret-umut et" devri bitti: üret → denetle → düzelt → yayınla.
- **🚀 v73 frontier katmanı + DEV BAĞLAM:** Gemini sağlayıcısı OpenAI-uyumlu uca taşındı
  (CORS + araç çağrıları + akış canlı doğrulandı) → ajan döngüsü frontier modellerle aynen çalışır
  (gemini-2.5-flash / flash-lite / 2.5-pro, **1M token bağlam**). `housekey.js`'e ücretsiz FRONTIER
  anahtarı yuvası eklendi: anahtar gömülünce TÜM kullanıcılar kutudan çıkar çıkmaz frontier beyin alır;
  kota/hata durumunda flash→lite kuyruğu, sonra otomatik Groq ev beynine düşüş (10 dk soğuma).
  Dev bağlam: frontier aktifken geçmiş 24→60 mesaj, RAG 4→12 parça, çıktı bütçesi 8-12K token.
  Kullanıcı kendi AIza anahtarını Ayarlar'a yapıştırırsa da doğrudan frontier modu açılır.
- **🚀 v74 frontier CANLI:** sahibin verdiği ücretsiz OpenRouter anahtarı (kredi $0 — doğrulandı)
  frontier yuvasına gömüldü → EVRIM'in varsayılan beyni artık frontier sınıfı :free havuzu:
  nemotron-3-super-120b / nex-n2.5-pro / nemotron-3-ultra-550b (256K-1M bağlam), ölçülmüş öncelik
  sırası + perf puanıyla otomatik seçim, araç çağrıları canlı doğrulandı. Zincir: :free kuyruğu →
  kota dolarsa Groq ev beyni (10 dk soğuma) → kullanıcı hiçbir şey fark etmez. Dev bağlam bu
  beyinlerle otomatik açılır (60 mesaj geçmiş + 12 RAG parçası).
- **🎨 v75 İLERİ DÜZEY site şartnamesi (BASE_PROMPT v17):** tasarım bölümüne ZORUNLU ileri düzey
  listesi eklendi — sticky header+blur, hamburger menü, IntersectionObserver scroll animasyonları,
  koyu/açık tema (prefers-color-scheme + düğme + localStorage), inline SVG ikonlar (emoji yasak),
  clamp() akışkan tipografi, mikro-etkileşimler, form doğrulama, zengin footer, back-to-top;
  hedef 350-600 satır. Frontier araç bütçesi 16K tokena çıktı. site_kontrol'e ZENGİNLİK taraması
  eklendi: eksik ileri düzey özellikler raporlanır → beyin bir zenginleştirme turu atar (küçük
  demolar şişirilmez). Canlı kanıt: kahveci-pro.html — 445 satır, zenginlik 9/9, ilk turda sıfır kusur.
- **📦 v76 ÇOK DOSYALI PROJE + TEST (kalan fark kapandı):** `proje_uret` — index.html + style.css +
  app.js AYRI dosyalar + `testler` [{ad, js}]; araç projeyi kaydeder, dosyaları tek belgede paketler,
  gizli sandbox iframe'de GERÇEKTEN ÇALIŞTIRIR ve testleri içinde koşar (JS hataları + statik denetim:
  referans/kopya dosya, CDN yasağı, test sözdizimi). Başarısız rapor → beyin düzeltir, aynı ad ile
  tekrar çağırır — DOSYALAR BİRLEŞİR, proje turlar halinde büyür (iteratif inşaat). `proje_test` testi
  yeniden koşar. Proje kartı: 👁 Önizle / ✅ Test / ⬇️ İndir (tek dosya bundle) / 🌍 Yayınla
  (publishProject → klasör olarak Pages'e, her dosya ayrı PUT). BASE_PROMPT v18: uygulama
  isteklerinde proje_uret + en az 3 test ZORUNLU + localStorage kalıcılık/erişilebilirlik standartları.
  v76.1/v76.2 sağlamlaştırma (canlı demodan çıkan gerçek hatalarla): testler/dosyalar JSON-string
  gelirse normalizasyon + \' ve kapanış-tırnağı onarımı + test listesi sınırı (12); TEST İZOLASYONU —
  her test taze sayfa örneğinde koşar (önceki testin DOM/localStorage kalıntısı taşmaz). Canlı kanıt:
  todo-app — frontier beyin 3 dosya + 4 gerçek test üretti; 3 düzeltme turuyla 4/4 YEŞİL'e ulaştı,
  https://4fr41d.github.io/evrim-siteler/todo-app/ adresinde yayında.
- **🔬 v78 ikili beyin labı + daha derin döngü:** bench artık İKİ beyni ölçüyor — frontier
  (nemotron-3-super:free, SABİT model = karşılaştırılabilir trend, ayrı kota havuzu) + gpt-oss-120b
  (trend sürekliliği); tek jüri (20b) ikisini de aynı ölçütle puanlar → adil A/B. Groq günlük kotası
  bitse bile frontier ölçümü sürer (dürüst null semantiği korundu). ozet.json/ARASTIRMA.md/jsonl'ye
  frontierOrt + frontierTrend eklendi. MAX_STEPS 6→8: proje inşaatının üret→test→düzelt turları
  ajan döngüsüne sığar.
- **🧬 v79 KOD SEVİYESİNDE KENDİ KENDİNİ GELİŞTİRME (Faz 1 — ölçülen yönlendirme):** lab artık
  EVRIM'in kendi kodunu güncelliyor: `kodAyar()` OpenRouter :free havuzunu canlı ÖLÇER (başarı + hız
  propları, yeni adayları keşfeder, kısıtlı/ölü modelleri eler) → llm.js'teki işaretli OR_PRIORITY/
  OR_SKIP bölgesini yeniden yazar → KAPILAR: node --check + esbuild + TAM suite (334 test);herhangi biri
  patlarsa yama OTOMATİK GERİ ALINIR. Kill-switch: lab/AYAR_KAPALI. Sıklık: günde 1 (lab/ayar.json).
  İlk canlı koşu: 8 model ölçüldü, sıra yenilendi (ultra-550b en hızlı), nex-n2.5-mini havuza girdi.
  Yol haritası: Faz 2 = sabit/mekanizma mikro-yamaları, Faz 3 = test-doğrulamalı fonksiyon yamaları.
- **🧬 v80 ÖNERİ-YAMA (Faz 2):** lab, ONERILER.md maddelerini KENDİSİ koda çevirir — beyaz listedeki
  dosyayı tam bağlamla frontier beyne gönderir, cerrahi {bul→değiştir} JSON yaması alır, doğrular
  (tek geçiş/boyut/korunan bölge), uygular, 3 kapıdan geçirir (node --check + esbuild + TAM suite);
  geçemezse OTOMATİK GERİ ALIR. Günlük sınır (lab/yamalar.json) + kill-switch (lab/YAMA_KAPALI).
  İlk prova: model, localStorage→IndexedDB önerisini teknik gerekçeyle DÜRÜSTÇE REDDETTİ — kör yama yok.
  Oto-yama da frontier beyne terfi etti (tetik + kural + A/B; Groq çapraz yedek).
- **🧬 v81 BÖLGE-YAMA (Faz 3):** büyük dosyalar (agent.js 145K, app.js 119K) öneri-yamaya açıldı —
  dosya bütün gönderilmez; lab fonksiyon indeksini çıkarır (agent.js: 27, app.js: 64 bölge), frontier
  ilgili fonksiyonu seçer, yama yalnız o bölgeye uygulanır. Prova kancaları: LAB_FORCE_YAMA/LAB_FORCE_BEYIN.
  İlk frontier oto-yama provası (elma-tuzak): kural üretimi çalıştı, A/B kotaya takıldı → güvenli red
  (ölçümsüz yama yok).
- **🧬 v82 ÇOKLU MADDE:** öneri-yama tek koşuda 3 maddeye kadar dener — yumuşak ret sonraki maddeye
  geçer, sert sonuç (uygulandı/kapı reddi) günü bitirir, frontier cevapsızsa kota korunur.
- **🧬 v83 ÖLÇÜM TABANI:** bench 7→10 soru: kod-uretme (kenar durumlu fonksiyon), mantik-kisit (çok
  adımlı kısıt tatmini), yanlis-onerme (uydurma öncülde dürüstlük — yıl uyduran 0-2 alır). kodAyar
  EWMA geçmişi: prob gürültüsüyle rota flip-flop yapmaz (0.6 eski + 0.4 yeni, ayar.json ile taşınır).
- **🧬 v84 KOTA BÜTÇESİ + 2. HAVUZ:** lab frontier kotasını SAYAR (lab/kota.json, 50/gün): gece
  koşusu tam bütçeyi alır (bench + kodAyar + öneri-yama), gündüz koşuları bilinçli tasarruf eder
  (dürüst null, rastgele 429 yok); bench, kodAyar/öneri-yama için 15 istek rezerv bırakır. Sahip
  ücretsiz Gemini anahtarı eklerse (repo secret LAB_GEMINI_KEY, ~200 istek/gün ayrı kota) frontierSoru
  otomatik ikinci havuza düşer — lab kapasitesi ~5×.
- **Ajan modu:** model araç çağırabilir (hafıza, hesap, Vikipedi, tarih, açık API kataloğu…). Adımlar
  mesajın üstünde "🔧 Hesapladı: … 12 ms" şeklinde görünür, kalıcıdır.
- **Beyin katmanları (öncelik sırası):** senin OpenRouter/Groq anahtarın → Puter
  (anahtarsız bulut) → ücretsiz servisler → Chrome Nano → cihazında açık kaynak model.
  Hiçbiri yoksa sohbet kilitlenmez: engelleyici olmayan bir uyarı şeridi çıkar.

---

## 🚀 5 dakikada çalıştır

```bash
git clone https://github.com/KULLANICI/evrim.git
cd evrim
npm install
npm start          # → http://localhost:3000
```

## 🔑 Ücretsiz AI anahtarı (birini seç)

1. **Groq** (en hızlısı, önerilen) → <https://console.groq.com/keys> → "Create API Key" → `gsk_...`
2. **OpenRouter** (çok model, `:free` olanlar ücretsiz) → <https://openrouter.ai/settings/keys> → `sk-or-...`
3. **Google AI Studio** → <https://aistudio.google.com/app/apikey> → `AIza...`

Uygulamada **Ayarlar → AI beyni** alanına yapıştır → **Kaydet** → **Test et**.
Sağlayıcı otomatik algılanır (anahtarın önekinden).

> Anahtar yalnızca senin sunucundaki `data/settings.json` dosyasında durur, hiçbir yere gönderilmez.

## 🐙 GitHub bağlantısı

1. GitHub → Settings → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → *Generate new token*
2. **Repository access**: sadece kendi repon ("Only select repositories")
3. **Permissions → Repository permissions → Contents**: `Read and write`
4. Token'ı kopyala (`github_pat_...`)
5. EVRIM → **Ayarlar → GitHub**: repo adını yaz (`kullanici/repo`) veya **Seç** ile listenden bağla, token'ı yapıştır, **Kaydet**

> Token olmadan da **public** repolar okunabilir (commit/dosya/issue). Commit atmak için token şart.
> Güvenlik: `autoCommit` varsayılan **kapalı**. AI kodu üretir, sen görüp onaylarsın.

## 📱 Telefonda kullan

- Sayfa telefonda açıkken: iPhone → Safari → **Paylaş → Ana Ekrana Ekle**; Android → Chrome → **⋮ → Uygulamayı yükle**.
- Tam ekran, uygulama gibi açılır, çevrimdışı kabuğu çalışır.

## ☁️ Ücretsiz yayınlama (telefondan her yerden erişim)

> 📘 **Adım adım tam rehber: [DEPLOY.md](DEPLOY.md)** — Render kurulumu, ortam değişkenleri,
> veri kalıcılığı, sorun giderme tablosu ve güvenlik notları orada.

**Önemli:** ücretsiz bulut planlarında disk geçicidir. EVRIM bu yüzden `data/` klasörünü
GitHub'daki **özel** bir repoda (`evrim-data`) şifreli yedekler ve açılışta geri yükler.
`PERSIST=1` ile açılır; `GITHUB_TOKEN`, `GROQ_API_KEY`, `APP_PIN`, `DATA_KEY` ortam değişkenleri yeterlidir.



### Seçenek A — Render / Railway (Node sunucusu, en kolay)
1. Repoyu GitHub'a push et
2. Render → **New → Web Service** → repoyu seç
3. Build: `npm install` · Start: `npm start` · Ücretsiz plan
4. **ÖNEMLİ:** ücretsiz planda disk geçicidir. Kalıcı veri için ortam değişkeni olarak `DATA_DIR` ver ve bir volume bağla, ya da `src/db.js` içindeki JSON katmanını Supabase/Postgres ile değiştir (tek dosya).

### Seçenek B — Kendi bilgisayarın + Tailscale (tamamen ücretsiz, veri sende)
```bash
npm start
```
Telefona Tailscale kur, aynı ağda `http://bilgisayarın-tailscale-ip:3000` adresini aç. Veriler diskinde kalır, kimseye gitmez.

### Seçenek C — Vercel/Netlify
Statik arayüzü çalışır ama bu backend uzun ömürlü bir Node process'i olduğu için serverless'a taşımak gerekir.
İstersen `server.js` içindeki route'ları Vercel function'larına bölebilirim.

## 🧠 Öz-gelişim döngüsü nasıl işliyor?

```
kullanıcı mesajı ──► sistem promptu (beyin vN) + hafıza + beceri haritası
                 ──► LLM yanıtı
                 ──► arka planda META-ÖĞRENME çağrısı (JSON):
                       • memories[]      → kalıcı bilgi / tercih / hata / kural
                       • promptPatch     → beynin yeni kuralı
                       • confidence      → güven skoru
                       • skills[]        → beceri haritası güncellemesi
                 ──► confidence ≥ eşik  → otomatik uygulanır (beyin vN+1)
                     confidence <  eşik  → "bekleyen yama" olur, sen onaylarsın
```

- 👍/👎 geri bildirimi doğrudan hafızaya ve gelişim günlüğüne işlenir.
- **Evrim** sekmesinden her sürümü görebilir, eski bir sürüme dönebilirsin.
- Güven eşiğini Ayarlar'dan kaydır: düşük = hızlı evrim, yüksek = kontrollü evrim.

## 📁 Yapı

```
evrim/
├─ web/                 # CANLI statik uygulama (GitHub Pages buradan yayınlanır)
│  ├─ index.html        # giriş + kabuk + görünümler
│  ├─ style.css
│  ├─ sw.js             # service worker (çevrimdışı kabuk)
│  └─ js/
│     ├─ app.js         # UI + mesaj akışı + ajan bağlantısı
│     ├─ shell.js       # giriş akışı, kenar çubuğu, botlar, modal, çekmece
│     ├─ profile.js     # cihaz içi profiller + PIN
│     ├─ personas.js    # hazır botlar + şablonlar
│     ├─ agent.js       # 37 araç + ajan döngüsü + Türkçe-duyarlı Vikipedi
│     │                 #   + gorsel_uret: Puter üzerinden anahtarsız/ücretsiz görsel üretimi
│     │                 #   + api_katalog: awesome-agent-apis (660+ model, anahtarsız/ücretsiz okuma)
│     │                 #   + web_ara: anahtarsız web araması (jina+ddg) → web_oku zinciri
│     │                 #   + web_oku: herhangi bir web sayfasını okur (r.jina.ai, anahtarsız)
│     │                 #   + kod_calistir: JS sandbox (benim bash'imin karşılığı)
│     │                 #   + gorsel_uret: girişsiz/anahtarsız görsel (pollinations, CORS *)
│     ├─ linux-node/     # 🐧 SAHİBE ÖZEL Linux düğümü: private GitHub bus üzerinden tam yetkili yürütücü
│     ├─ data/mufredat.json # 🎓 KURS MODU: GenAI 21 ders (MIT, Microsoft) + 11 bonus, TR
│     ├─ data/dersler/   # 📚 derslerin YEREL ARŞİVİ (link ölse bile kurs çalışır, MIT)
│     ├─ reflex.js      # REFLEKS KATMANI: beyinsiz bile anında cevap (selam, saat, matematik)
│     ├─ wasm.js        # CİHAZ İÇİ KÜÇÜK BEYİN: transformers.js WASM (SmolLM2-135M) —
│     │                 #   WebGPU'suz, girişsiz, çevrimdışı; hiçbir siteye yönlendirmez
│     └─ house.js       # EV BULUTU: sunucusuz/hesapsız WebRTC beyni (PeerJS) —
│                       #   sahibin cihazı beyin olur, diğer tüm cihazlar sıfır girişle bağlanır
│                       #   v25: ilk cihaz otomatik beyin, doluySA yeni cihaz otomatik misafir
│     ├─ data/katalog.json  # kataloğun YEREL YEDEĞİ (upstream silinse bile çalışır)
│     ├─ llm.js         # sağlayıcılar, akış, model rotasyonu
│     ├─ store.js       # localStorage tabanlı veri katmanı + beyin sürümleri
│     ├─ evolve.js      # hafıza + öz-gelişim + beceri haritası
│     ├─ learn.js       # aralıklı tekrar, soru üretme, plan
│     ├─ github.js      # GitHub REST (okuma + commit)
│     └─ local.js / nano.js / puter.js / free.js   # beyin katmanları
├─ docs/                # web/'in birebir kopyası (Pages bu klasörü servis eder)
├─ server.js + src/     # (eski) Node backend — artık gerekli değil
└─ data/                # yerel veri (git'e girmez)
```

> Not: `web/` dosyalarını değiştirirsen `docs/` ile senkronla
> (`cp -r web/. docs/`) ve ikisini birlikte commit'le.
> Katalog yedeğini tazelemek için: `node scripts/katalog-sync.js`.

## 🔒 Güvenlik notları

- `data/` klasörü `.gitignore` içinde — API anahtarların repoya sızmaz.
- Token'lar sunucuda kalır, tarayıcıya maskelenmiş (`gsk_••••1234`) gönderilir.
- AI'ın repoya yazma yetkisini istediğin an kapat (`autoCommit: false` + token'ı sil).

## 🗺 Sıradaki adımlar (istersen ekleriz)

- [ ] Gerçek mobil uygulama paketi (Expo/React Native) — aynı API'yi kullanır
- [ ] SQLite/Supabase'e geçiş (çok cihaz senkronu)
- [ ] Sesli sohbet (mikrofon → STT → LLM → TTS)
- [ ] Zamanlanmış görevler: her sabah GitHub + öğrenme özeti bildirimi
- [ ] Çok kullanıcılı giriş (auth)
