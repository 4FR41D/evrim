# 🧬 EVRIM — kendini geliştiren AI (sunucusuz sürüm)

Tamamen **tarayıcında** çalışan, ücretsiz ve sınırsız kişisel AI uygulaması.
Sunucu yok, hesap yok, abonelik yok. Verilerin yalnızca kendi cihazında.

## 🔑 Tek gereken: ücretsiz bir AI anahtarı

1. https://console.groq.com/keys → **Create API Key** → `gsk_...` kopyala
2. Uygulamada **⚙️ Ayarlar → API anahtarı** → yapıştır → **Kaydet** → **Test et**

Alternatifler: [OpenRouter](https://openrouter.ai/settings/keys) · [Google AI Studio](https://aistudio.google.com/app/apikey)

> Anahtarın `localStorage`'da, sadece senin tarayıcında durur. Hiçbir sunucuya gönderilmez.
> Bu yüzden **herkes kendi anahtarını** girer — başkasının kotası tüketilmez.

## ✨ Özellikler

| Modül | Ne yapar |
|---|---|
| 💬 Sohbet | Hafızalı asistan — seni tanır, tercihlerini hatırlar |
| 🧬 Evrim | Her yanıttan sonra kendini geliştirir: hafıza çıkarır, **kendi sistem promptunu yamalar**, sürüm geçmişi tutar, tek tıkla geri alınabilir |
| 📚 Öğren | Aralıklı tekrar (spaced repetition). AI soru üretir, cevabını puanlar; yanlışına göre hem tekrar aralığını hem zorluğu otomatik ayarlar |
| 🐙 GitHub | Herhangi bir repoyu okur, AI ile analiz eder, günlük özet çıkarır |
| 💾 Yedek | Verilerini JSON olarak dışa/içe aktar — cihaz değiştirirken taşı |

## 🔄 Kendini nasıl geliştiriyor?

```
mesajın ──► beyin vN + hafıza + beceri haritası ──► yanıt
                                                  │
        arka planda META-ÖĞRENME (JSON) ◄─────────┘
          • memories[]    → kalıcı bilgi / tercih / hata / kural
          • promptPatch   → beynin yeni kuralı
          • confidence    → güven skoru
          • skills[]      → beceri haritası
                    │
     confidence ≥ eşik ──► otomatik uygulanır  → beyin vN+1
     confidence <  eşik ──► "bekleyen yama"    → sen onaylarsın
```

👍/👎 geri bildirimin doğrudan hafızaya ve gelişim günlüğüne işlenir.

## 📱 Telefona kur

- **iPhone:** Safari → Paylaş → **Ana Ekrana Ekle**
- **Android:** Chrome → ⋮ → **Uygulamayı yükle**

PWA olduğu için tam ekran, uygulama gibi açılır ve çevrimdışı kabuğu çalışır.

## ⚠️ Sınırlar

- Veriler **bu tarayıcının** deposunda: başka cihazda görünmez (Yedek al → İçe aktar ile taşı)
- Tarayıcı verilerini temizlersen silinir — arada bir **Ayarlar → 💾 Verilerim → Yedek al**
- Bu sürümde GitHub'a **yazma yok** (commit atma sunucu gerektirir). Onun için repo kökündeki sunuculu sürüme bak: [`../README.md`](../README.md)

## 🛠 Geliştirme

Statik dosyalar — herhangi bir sunucuyla çalışır:

```bash
cd web && python3 -m http.server 4000
# → http://localhost:4000
```

## 📄 Lisans

MIT — istediğin gibi kullan, değiştir, dağıt.
