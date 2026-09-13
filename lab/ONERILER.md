# 💡 Lab Önerileri

_Son güncelleme: 2026-09-13T20:53:58.487Z — bench ortalaması 0/10_

- **web/js/agent.js**: `fetch` çağrılarını `AbortController` ile sarmalayarak uzun bekleyen istekleri iptal edebilir, böylece UI donmasını engelleyebilirsin.  
- **web/js/store.js**: `localStorage` kullanımını `IndexedDB` ile değiştirerek daha büyük veri setleri (ör. RAG belgeleri) saklayabilir ve performansı artırabilirsin.  
- **web/js/rag.js**: `fetch` ile gelen metinleri `TextEncoder/Decoder` kullanarak UTF‑8 olarak kodlayıp, `Web Workers` içinde işleyerek ana thread’i boşaltabilirsin.  
- **web/js/learn.js**: Kullanıcı etkileşimlerini `debounce` (ör. 300 ms) ile sınırlayarak, sık sık tetiklenen öğrenme döngülerinin gereksiz tekrarlarını önleyebilirsin.  
- **lab/run.mjs**: Testleri `jsdom` yerine `node:vm` ile çalıştırarak, tarayıcı ortamı taklidi yerine gerçek Node ortamında daha hızlı ve güvenilir testler elde edebilirsin.
