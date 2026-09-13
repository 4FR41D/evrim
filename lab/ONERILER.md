# 💡 Lab Önerileri

_Son güncelleme: 2026-09-13T16:19:09.101Z — bench ortalaması 0/10_

- `web/js/app.js`: `import { initializeApp } from './agent.js';` satırını ekleyerek, uygulama başlatıldığında otomatik olarak `agent` modülünü yükleyin, böylece kullanıcı arayüzü ve arka plan görevleri senkronize çalışır.  
- `web/js/agent.js`: `export const agent = new Agent({ llm: 'gpt-oss-120b', memory: true, rag: true });` satırını ekleyerek, agent’in hafıza ve RAG yeteneklerini varsayılan olarak etkinleştirin, böylece kullanıcı sorularına bağlamlı yanıtlar sunar.  
- `web/js/store.js`: `localStorage.setItem('evrimState', JSON.stringify(state));` satırını ekleyerek, uygulama kapanıp açıldığında önceki oturum durumunu (örn. son arama, tercihler) otomatik olarak geri yükleyin.  
- `lab/run.mjs`: `import { runBench } from './bench.json';` satırını ekleyerek, CI ortamında testleri doğrudan `bench.json` üzerinden çalıştırın ve sonuçları konsola yazdırın, böylece performans izleme otomatikleşir.  
- `tests/suite.mjs`: `import { test } from 'jsdom';` satırını ekleyerek, tarayıcı ortamını taklit eden jsdom ile testleri çalıştırın, böylece Node 20 CI’de tarayıcı bağımlılıkları hatasız test edilir.
