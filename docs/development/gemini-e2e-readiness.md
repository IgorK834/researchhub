# Natywny Gemini: gotowość E2E

Stan: 2026-10-09. Wdrożono natywne API Google zamiast mostka OpenAI dla wybranego Gemini.
Przeanalizowano `design-reference/DESIGN_SPEC.md`, istniejące kontrakty, UI, Spring, worker,
indeks pgvector, pipeline obliczeń i sandbox. Spring pozostaje modularnym monolitem;
Python odpowiada za AI, embeddingi i obliczenia.

## Uruchomienie

W prywatnym, ignorowanym `.env` wystarczy `GEMINI_API_KEY`. Polecenie `scripts/demo/up.sh`
uruchamia aplikację pod **https://localhost:8443**, wybiera `gemini-3.8-flash` i
`gemini-embedding-001` (768 wymiarów), przygotowuje sandbox i jawnie ponownie przetwarza
syntetyczne źródła demo. Zmiana modelu embeddingów tworzy odrębną tożsamość w bazie;
stare wektory nie są przemianowywane. Źródła innych workspace wymagają istniejącego Reprocess.

Klucz trafia wyłącznie do workera. Nie jest kopiowany do Spring, przeglądarki, sandboxa ani obrazu.
Wszystkie opcjonalne ustawienia są w [konfiguracji](configuration.md#native-gemini-worker-provider).
[Instrukcja startu i testów](native-gemini.md) opisuje również wymagane lokalne Java 25,
Node/npm, Python 3.13, Docker oraz zaufanie do lokalnego certyfikatu HTTPS.

## Zakres integracji

| Funkcja | Implementacja |
| --- | --- |
| Indeksowanie i retrieval | Natywne embeddingi query/document, L2, paczki ograniczone wymiarem, walidacja rzeczywistych 768 wymiarów, wersjonowany namespace |
| Pytania o workspace/źródło | Kontrakty odpowiedzi v1/v2, autoryzowany zakres, cytowania i odmowa przy braku danych |
| Rozmowy | Zapis historii, idempotencja, SSE po walidacji i zapisie |
| Generate section | Cytowany draft, jawna akceptacja, rewizja i provenance dokumentu |
| Improve/Shorten/Expand/Clarify/Grammar/Explain | Wszystkie sześć akcji przez natywny adapter, dotychczasowy podgląd i Accept/Reject |
| Find evidence i AI w komentarzach | Lokalna walidacja kategorii/cytowań, Add citation, trwała sugestia i receipt akceptacji |
| Compare sources / disagreements | Właściwe przypisanie dowodów do źródła, kontrolowany fallback JSON dla złożonych schematów Google |
| Planowanie i wykonanie CSV/XLSX | Natywny planner, walidacja planu, istniejący izolowany sandbox, tabele/wykresy i immutable inputs |
| Pytania o obliczenia i reprodukcja | Zapisane wyniki z cytowaniem wykonania, hash kodu/danych/runtime i ORIGINAL rerun |
| Diagnostyka | Tokeny wraz z thinking/repair; koszt benchmarku z wersjonowanej macierzy cen; chroniony debugger pozostaje opcjonalny |

Adapter zachowuje brak tools, przechowywania rozmów u dostawcy i przekierowań, HTTPS,
limit odpowiedzi 256 KiB, skończony budżet czasu, jedną próbę naprawy schematu i bezpieczne błędy.
`ModelGateway` nadal sprawdza zakres dowodów i prompt injection. UI wyjaśnia niepoprawny wynik
oraz niedostępność/limit usługi. Foundry i istniejące adaptery zachowano jako dostępne alternatywy.

## Dowody jakości

[Pełny benchmark native-v2](../evaluation/results/gemini-native-2026-10-09/models.md)
obejmuje 33 przypadki i dwa dodatkowe testy injection. Cytowania wskazują przekazane fragmenty,
odmowy, schema-valid output i injection mają 100%; p95 to około 3,5 s, średni koszt około
0,001453 USD. Konserwatywne reguły curated grounding (67,86%) i poprawności (81,82%) nie
osiągają progów 90%. Progi i gold rules pozostały bez zmian. Istnienie cytowanego fragmentu
nie dowodzi wsparcia każdego twierdzenia; nie należy interpretować wyniku jako gwarancji jakości.

[Rzeczywisty scenariusz E2E](../evaluation/results/gemini-native-2026-10-09/live-features.json)
zaliczył wszystkie 18 etapów. [Weryfikacja repozytorium](../evaluation/results/gemini-native-2026-10-09/validation.json)
obejmuje 649 testów workera (94,97% coverage modułu Gemini), Maven `verify`, 1098 testów
frontendu z progami coverage, 36 testów skryptów, buildy obrazów i test przeglądarkowy.

```sh
python3 scripts/demo/evaluate-ai.py
python3 scripts/demo/ai-smoke.py --local-quota-window
```

Pierwsze polecenie zapisuje raport i zwraca niezero przy niespełnionych progach. Drugie weryfikuje
rzeczywisty łańcuch publiczne API → Spring → Gemini/embeddingi → PostgreSQL → sandbox na
osobnym syntetycznym workspace. Na czas lokalnego testu skraca okno limitów aplikacji do minuty;
przywraca ustawienia również po błędzie. Nie zmienia limitów ani billingu Google.
Raporty prywatne są w `.demo/local/`; opublikowane dowody nie zawierają kluczy ani haseł.

## Warunki zewnętrzne i granice funkcji

Google początkowo odrzucał wywołania po wyczerpaniu 20 generacji/dzień skonfigurowanego free tier.
Po włączeniu billingu przez użytkownika pełny benchmark zakończył się bez błędów generacji.
Rzeczywiste limity projektu nadal obowiązują. Dla publicznych klientów dostępnych w Polsce/EOG
warunki Google wymagają Paid Services: [warunki](https://ai.google.dev/gemini-api/terms),
[limity](https://ai.google.dev/gemini-api/docs/rate-limits).

Rozmowy zapisują historię, lecz nie przekazują jej jako pamięci modelu. SSE publikuje zwalidowaną
odpowiedź. Skany PDF nadal mają `OCR_REQUIRED`; wyszukiwanie zewnętrznych publikacji używa
odrębnego istniejącego providera. Żadna z tych granic produktu nie została rozszerzona w tej zmianie.
Koszty w debuggerze Spring wymagają jawnie skonfigurowanych stawek dla modelu/wersji;
nie obejmują pełnego rachunku za embeddingi.
