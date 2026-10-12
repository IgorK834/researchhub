# Walidacja CAI-13–15

Zakres: wykonanie analizy datasetu z czatu, zapisane rozwiązanie SOLUTION i atomowe wstawienie pakietu. Kontrakty: [SOLUTION](../../contracts/analysis/execution/v3/SOLUTION.md), [referencje dokumentu](../../contracts/analysis/document-block/v2/README.md), [computed provenance](../../contracts/analysis/provenance/v2/README.md). Migracja: V43; konfiguracja istniejących limitów ANALYSIS/LLM i sandboxa pozostaje wspólna ze Studio.

## Sprawdzone przekroje

- `SourceExtractionEndToEndTest`: rzeczywisty upload CSV → wersjonowane bytes HTTP → Python worker → PostgreSQL → czat ANALYZE → plan → Docker → zapis tabeli/wykresu. Zastąpienie pliku po enqueue zachowuje dwie stare obserwacje i impedancję `4.81 / 0.12`. Powtórzony request, odzyskanie observer lease i odczyt Studio pozostawiają jedno wykonanie i jeden plan. Brak sheet/columns daje clarification. Odzyskanie już zapisanego płatnego planu nie powtarza inference. Cancel question zatrzymuje turę, zachowując istniejące wykonanie w Studio.
- `ProblemApiIntegrationTest`: rzeczywisty controlled compute i fresh verify, zapis SOLUTION z kodem/image/input/plan/candidate hashes, niezmienność PostgreSQL, odczyt przez viewer i odmowa obcemu workspace. Follow-up cytuje wynik A z workload PROBLEM i pustym inputSources; interpretacja pozostaje NOT_CHECKED. Nowe wykonanie nie zmienia już wstawionego dokumentu.
- API pakietów: preview pozostawia dokument bez zmian; FULL/TABLE/CHART odczytują dokładny saved output. Idempotency key/version hash, błędny/obcy output, błędny step i zmieniony cel blokują publikację. Jedna akceptacja zachowuje prefix/suffix, sześć stabilnych PROBLEM block IDs i dokładny step ID. Conditional undo przywraca poprzednią treść. Dataset pakiet korzysta z tej samej ścieżki.
- `CanvasProposalApiIntegrationTest` + `canvas-proposals.cjs`: prawdziwy Chrome/production build/Spring/PostgreSQL/worker/Docker/canonical Yjs. Oba tryby legacy/realtime: preview, jedna akceptacja pełnego rozwiązania, tabela, PNG, dokładne step/conversation/execution references, reload, undo po ponownym otwarciu rozmowy i zachowanie zdalnej zmiany. Snapshot porównuje dokładny zapis serwera i package refs; historyczne paragrafy bez blockId nie dostają sztucznej tożsamości w bazie.
- `canvas-dataset.cjs`: realny picker version/sheet/physical columns, blokada wysyłania bez wyboru, zamknięcie/otwarcie/reload czatu, stare numeric bytes po replace oraz pakiet tabeli/wykresu po reload dokumentu. Szerokości 360/768/1440 px i brak naruszeń produkcyjnego CSP. Szeroka tabela przewija się poziomo; liczby nie łamią się na pojedyncze cyfry.
- Wspólne fixtures Java/Python/TypeScript oraz kanoniczny Yjs round-trip zachowują AST, jednostki, references i statusy. Testy runtime odrzucają błędne wartości, podstawienia, jednostki i równoważności. Java dodatkowo odrzuca niespójny step/output/AST/input/hash, nie wykonując CAS. Żaden opis modelu nie może nadać interpretacji statusu CHECKED.

## Polecenia odtworzenia

```sh
cd frontend
npm run test:coverage
npm run lint
npm run format:check
npm run build -- --output-path dist-canvas-legacy
npm run build:realtime
cd ../collaboration
npm run build
npm test
cd ../ai-worker
.venv/bin/python -m pytest
# Dodatkowe bramki modułów: scripts/check.sh (uv); lokalnie te same coverage report --include --fail-under=80.
cd ../sandbox
.venv/bin/python -m pytest
cd ../backend
CANVAS_BROWSER_TESTS=true ANALYSIS_SANDBOX_TESTS=true ./mvnw --batch-mode --no-transfer-progress verify
cd ..
python3 scripts/security/check_analysis_boundary.py
python3 -m unittest discover -s scripts/security -p 'test*.py'
python3 -m unittest discover -s scripts/ci -p 'test*.py'
```

Frontend: 1262 testy, wszystkie bramki pokrycia przechodzą. Nowe SolutionView, ProblemReferencedOutput, CalculationPackagePicker i solution API mają 100% linii i gałęzi; DatasetPicker i zmieniony CanvasAiChat pozostają powyżej 80% dla linii/gałęzi/funkcji/statements. Worker: 717 testów, 97.58%, wszystkie oddzielne bramki modułów ≥80%. Collaboration: 44 testy, 96.93% linii i 92.32% gałęzi. Sandbox: 158 testów, 98.51%. Security helper tests: 22 (20 przechodzi, dwa istniejące opt-in pominięte); CI selection: 18. Bramka RH-142 potwierdza committed reviewed local boundary; cloud execution pozostaje deferred.

Maven verify: **1284 testy, 0 failures, 0 errors, 7 istniejących pominięć opt-in**, BUILD SUCCESS. Wszystkie nowo dodane E2E zostały wykonane (Chrome i Docker włączone). Oddzielne bramki backendu:

| Warstwa | Linie | Gałęzie |
| --- | ---: | ---: |
| Solution / calculation packages | 100% | 90.26% |
| Problem application | 98.89% | 84.01% |
| Canvas application | 97.81% | 83.09% |
| Canvas document | 98.79% | 86.13% |
| Canvas API | 100% | 100% |
| Canvas persistence | 96.97% | 82.76% |

Wynik obejmuje rzeczywisty upgrade historycznej bazy V21 → V43 z zachowaniem dawnych wykonań. Maven czasem zgłasza komunikat Surefire o zakończeniu fork JVM po 30 sekundach; kończy się kodem 0/BUILD SUCCESS i wszystkie raporty testów/bramki przechodzą. Raporty JaCoCo są w backend/target/site. CI zachowuje backend/target/canvas-*.log i canvas-*.png, w tym nowe pakiety i widoki mobilne.

## Granice

Zakres CAS i limity pozostają takie jak w CAI-10–12: REAL, jawne jednostki, bounded AST, sqrt/sin/cos, jeden nieznany symbol, wymierny wielomian stopnia 1–4, wykres do 201 punktów. Bundle ≤262144 bytes, maksymalnie 32 checked steps (do 4/output). Pakiet ≤32 atomy; dokument ≤50 analysis atoms; maksymalnie 32 zapisane pakiety na turę. Computed evidence ma 8000 znaków i maksymalnie 50 punktów z jawnym truncated. To nie jest rozszerzenie na macierze/ogólne CAS ani weryfikacja fizycznych założeń. Model adapter w E2E jest deterministyczny; nie wykonano live Gemini. Dotychczasowe ostrzeżenia Webpack o wielkości bundle są zachowane. Eksport natywnych pakietów PROBLEM, łącznie z atomami STEP/SOLUTION, pozostaje CAI-16. Eksport dotychczasowych DATASET TABLE/CHART/TEXT zachowuje swoje mechanizmy.
