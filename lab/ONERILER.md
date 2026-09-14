# 💡 Lab Önerileri

_Son güncelleme: 2026-09-14T12:52:08.189Z — bench ortalaması 6.8/10_

- **web/js/store.js**: `localStorage` erişimini `try/catch` bloğuna alarak, tarayıcıda `localStorage` devre dışı bırakıldığında uygulamanın çökmesini önle.  
- **web/js/llm.js**: `fetch` çağrıları için `AbortController` ekle, böylece uzun süreli istekler `timeout` ile iptal edilebilir ve bellek sızıntısı engellenir.  
- **web/js/rag.js**: RAG sorgularında kullanılan `fetch`’in `cache: 'no-store'` seçeneğini zorunlu kıl, böylece eski verilerle yanıt alınma ihtimali azalır.  
- **web/js/learn.js**: Kullanıcı öğrenme geçmişini `localStorage` yerine `sessionStorage`’a kaydet, böylece tarayıcı kapatıldığında veri silinir ve gizlilik artar.  
- **lab/run.mjs**: `bench.json` dosyasını okurken `fs.promises.readFile` yerine `fs.readFileSync` kullan, bu sayede CI ortamında eşzamanlı okuma hatası önlenir.
