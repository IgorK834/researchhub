# CAI-10–12 — weryfikacja matematyki i obliczeń naukowych

Stan lokalnej weryfikacji: **2026-10-11**. Zakres: strukturalne wzory w edytorze, planowanie
`PROBLEM` bez CSV/XLSX oraz wykonanie i niezależna kontrola obliczeń w rzeczywistym Dockerze.
[Backlog](canvas-ai-backlog.md) i [opis funkcji](canvas-ai.md#structured-mathematics-and-scientific-problems-cai-1012)
opisują działający przepływ i jego granice.

## Wyniki testów i buildów

| Warstwa | Wynik | Pokrycie / bramki |
| --- | --- | --- |
| Backend | 1276 testów: 1269 zaliczonych, 7 wcześniejszych opcjonalnych pominiętych, 0 failures/errors | Wszystkie istniejące i nowe bramki Maven `verify` zaliczone |
| PROBLEM application | Planowanie, statusy, idempotency, audyty, kontrola publikacji i weryfikacji | 98,88% linii / 83,93% gałęzi |
| PROBLEM persistence | PostgreSQL, lease, niemutowalność, odczyt artefaktów | 98,17% linii / 91,67% gałęzi |
| Math AST Java | Wspólne fixtures, granice AST, notacja, referencje | 100% linii / 93,41% gałęzi |
| Math document Java | Walidacja dokumentu i powiązań z wykonaniem | 100% linii / 83,33% gałęzi |
| Frontend | 132 zestawy / 1242 testy; lint i format check zaliczone | 98,38% linii / 94,94% gałęzi; istniejące i nowe progi per plik zaliczone |
| AI worker | 716 testów, wheel z nowymi modułami zbudowany | 97,58% łącznie z gałęziami; wszystkie modułowe progi z `scripts/check.sh` zaliczone |
| Collaboration | 6 zestawów / 43 testy; TypeScript build zaliczony | 96,93% linii / 92,32% gałęzi / 100% funkcji; progi per plik zaliczone |
| Sandbox runtime | 158 testów | 98,51% łącznie z gałęziami |
| Bramka bezpieczeństwa | 9 testów; kontrola committed review zaliczona | 98% łącznie z gałęziami |
| Dobór zadań CI | 18 testów; oba zmienione workflow YAML poprawne | Testy istniejącego helpera CI zaliczone |

Minimalny próg zmienianych modułów pozostaje **80%**. Nowe bramki backendu osobno obejmują linie
i gałęzie aplikacji PROBLEM, infrastruktury PROBLEM oraz matematyki; istniejących progów nie obniżono.
Oba produkcyjne buildy frontendu — legacy i realtime — przeszły, z istniejącymi ostrzeżeniami
Webpack dotyczącymi rozmiaru bundle. Obraz `researchhub-sandbox:1.2.0` został przebudowany.

Pełne końcowe uruchomienie backendu miało jeden timeout połączenia PostgreSQL podczas startu Flyway
w `AzureProfileStartupIntegrationTest`. Ponowienie tego testu bez zmian kodu poleceniem
`./mvnw --batch-mode --no-transfer-progress -Dtest=AzureProfileStartupIntegrationTest verify`
przeszło i uruchomiło wszystkie bramki pokrycia z zachowanymi danymi pełnej serii.
Powyższe sumy pochodzą z końcowych raportów Surefire. Siedem pominięć dotyczy wcześniejszych,
osobno włączanych testów browser source/export/quota/debugger, testu restartu collaboration
oraz natywnego kompilatora TeX. **Nowe testy PROBLEM, math oraz rzeczywistego sandboxa nie były pominięte.**

## Rzeczywisty przekrój E2E

[ProblemApiIntegrationTest](../../backend/src/test/java/dev/researchhub/analysis/api/ProblemApiIntegrationTest.java)
uruchamia Spring, PostgreSQL Testcontainers oraz osobny proces workera z wewnętrznym uwierzytelnianiem.
Worker korzysta z deterministycznego adaptera modelu; obliczenia wykonuje rzeczywisty Docker,
a przeglądarka uruchamia produkcyjny frontend. Kontrola adaptera Gemini i zamkniętego schematu
planu jest objęta testami workera. Ta seria nie jest oceną jakości odpowiedzi live Gemini z CAI-18.

Wszystkie 8 testów tego zestawu przeszły. Potwierdzają:

- `100 cm / 2 s = 0,5 m/s`, zapis wartości i podstawień, 11 punktów danych wykresu oraz poprawne
  dekodowanie PNG; receipt `CHECKED` z osobnej fazy VERIFY.
- Rozwiązanie `x² = 4` w dziedzinie REAL bez datasetu; zapis obu rzeczywistych pierwiastków.
- Odtworzenie z dokładnym input/plan/image ID, bez kolejnego audytu modelu i bez zmiany starego wykonania.
- Nową analizę z parent lineage po zmianie danych; trwałe idempotency create i brak drugiego aktywnego run.
- Doprecyzowanie brakujących danych bez planowania/wykonania, odrzucanie niezgodnych jednostek,
  kanonicznych liczb spoza kontraktu, obcego kontekstu, referencji i operacji niedostępnych dla viewera.
- `SOLVE` z canvasu: zamrożony wybrany AST, dokładna wiadomość USER i rewizja dokumentu;
  późniejsza zmiana wzoru oznacza stary cel jako STALE, lecz nie mutuje zapisanego zadania.
- Niemutowalność planu i zakończonych rekordów w PostgreSQL, przerwane lease, błędne artefakty,
  dzielenie przez zero bez opublikowania wyniku i następne zdrowe wykonanie.

[scientific-problem.cjs](../../frontend/e2e/scientific-problem.cjs) przechodzi przez formularz
**Solve a problem without dataset**, **Calculate in sandbox**, wynik, wykres, odświeżenie,
**Reproduce frozen run** i utworzenie potomnej analizy `200 cm / 2 s = 1 m/s`.
Sprawdza brak naruszeń CSP. Dowód z uruchomienia: `backend/target/scientific-problem-browser.log`.

[canvas-proposals.cjs](../../frontend/e2e/canvas-proposals.cjs), wywoływany przez
[CanvasProposalApiIntegrationTest](../../backend/src/test/java/dev/researchhub/ai/api/CanvasProposalApiIntegrationTest.java),
potwierdza zapis, ponowne otwarcie, renderowanie i clipboard wzorów w obu produkcyjnych buildach
legacy/realtime. Oba browser receipts wskazują zero naruszeń CSP:
`backend/target/canvas-proposals-legacy.log` i `backend/target/canvas-proposals-realtime.log`.
Rzeczywisty Yjs round-trip, zachowanie sąsiednich cytowań/komentarzy i tabel, hostile AST oraz dostępność
sprawdzają również [testy collaboration](../../collaboration/test/math.test.ts),
[frontend math](../../frontend/src/features/documents/api/mathAst.test.ts) i
[walidator dokumentu Java](../../backend/src/test/java/dev/researchhub/document/application/MathDocumentValidatorTest.java).

## Izolacja i niezależna kontrola

Obraz 1.2.0 zawiera przypięte SymPy 1.14.0 oraz mpmath 1.3.0. Worker i Java nie wykonują CAS.
Kontrolowany runtime tworzy wyrażenia z zamkniętego AST przez jawne konstruktory; nie używa
`eval`, `sympify`, `parse_expr` ani importu wygenerowanego programu. Każdy etap ma własny kontener,
readonly frozen inputs, hashe i stały entrypoint. Weryfikacja używa content-addressed image ID fazy compute.
Host sprawdza receipt, input/plan/candidate/file hashes, nazwy, AST, jednostki, liczbę wartości/punktów,
tolerancję oraz powiązanie tabeli danych z wykresem. Fałszywe `VERIFIED` w wyniku nie nadaje mu zaufania.

[DockerSandboxRunnerIntegrationTest](../../backend/src/test/java/dev/researchhub/analysis/infrastructure/DockerSandboxRunnerIntegrationTest.java)
ma 5 zaliczonych testów, w tym controlled PROBLEM, ignorowanie nieufnego kodu w tym workloadzie
oraz odrzucanie sfałszowanych wartości/kroków przez świeży verifier.
[Acceptance harness](../../sandbox/scripts/acceptance.py) przeszedł na rzeczywistym daemonie Docker:
brak sieci i sekretów, non-root, readonly root/inputs, brak instalatora, brak stanu między runami,
limity pamięci/PID/dysku/inode/logów, timeout i sprzątanie, odrzucanie symlinków oraz obcych plików.
Potwierdził też zgodność dotychczasowych obliczeń CSV/XLSX i wykresów.

[ADR-008](../adr/ADR-008-analysis-execution-boundary.md),
[threat model](../security/analysis-execution-threat-model.md),
[execution v3](../../contracts/analysis/execution/v3/README.md) i pliki obrazu są związane hashami
z committed technical self-review `a70ee1c`. Bramka sprawdza rzeczywiste bajty plików i zapis w Git.
To lokalny techniczny self-review; nie deklaruje zgody człowieka ani akceptacji wykonania cloud.

## Powtórzenie weryfikacji

Wymagane są runtime projektu Java 25 / Node / Python 3.13.3, Docker, uv z projektu i Chromium.
Testy uruchamiają izolowane bazy oraz procesy; nie wymagają produkcyjnych danych ani klucza Gemini.
Przy innym sockecie Dockera ustawić `ANALYSIS_SANDBOX_SOCKET_PATH` oraz konfigurację Testcontainers.
Odpowiednik przygotowania i wykonania w CI, z katalogu głównego:

```bash
python3 scripts/security/check_analysis_boundary.py
uv sync --project ai-worker --frozen
npm ci --prefix collaboration
npm run build --prefix collaboration
npm ci --prefix frontend
npm run build:realtime --prefix frontend
RESEARCHHUB_COLLABORATION_ENABLED=false npm run build --prefix frontend -- --output-path dist-canvas-legacy
cd frontend
npx playwright install chromium
cd ../backend
ANALYSIS_SANDBOX_TESTS=true CANVAS_BROWSER_TESTS=true ./mvnw --batch-mode --no-transfer-progress verify
```

Przed Maven należy zbudować obraz z głównego katalogu:

```bash
docker build -t researchhub-sandbox:1.2.0 sandbox
```

Pozostałe warstwy, z głównego katalogu:

```bash
npm run lint --prefix frontend
npm run format:check --prefix frontend
npm run test:coverage --prefix frontend -- --runInBand
npm test --prefix collaboration
cd ai-worker
sh scripts/check.sh
cd ..
uv venv sandbox/.venv --python 3.13.3
uv pip install --python sandbox/.venv/bin/python -r sandbox/requirements-test.lock
cd sandbox
.venv/bin/python -m pytest
cd ..
ai-worker/.venv/bin/python sandbox/scripts/acceptance.py
ai-worker/.venv/bin/python -m unittest discover -s scripts/security -p test_analysis_boundary.py
ai-worker/.venv/bin/python -m unittest discover -s scripts/ci
git diff --check
```

Lokalnie uv nie był dostępny, więc testy workera i wszystkie bramki `coverage report --fail-under=80`
z `scripts/check.sh` wykonano w istniejącym `.venv` z tymi samymi przypiętymi zależnościami.
Sandbox ma osobne `.venv` i `requirements-test.lock`; SymPy nie dodano do środowiska workera.
Wheel zbudowano przy użyciu przypiętego hatchling 1.27.0 i sprawdzono obecność nowych modułów PROBLEM.
Workflow [CI](../../.github/workflows/ci.yml) włącza nowe browser/Docker E2E i zachowuje ich logi;
[analysis security](../../.github/workflows/analysis-security.yml) uruchamia bramkę oraz rzeczywiste kontenery.

## Granice tego wydania

Obsługiwane obliczenia: REAL, jawne jednostki SI, arytmetyka, sqrt/sin/cos, jeden nieznany symbol,
wymierny wielomian stopnia 1–4 oraz wykres do 201 punktów. AST ma limit głębokości 12 i 128 węzłów,
operandów 8, wykładnika ±8 i kosztu numerycznego 2048. Wartości końcowe muszą być skończone.
Domyślny limit to 45 sekund wykonania + 10 sekund sprzątania na fazę, 110 sekund dla obu faz;
maksimum 120 + 10 sekund na fazę, 260 sekund łącznie. Tolerancja kontroli wartości wynosi
`1e-10` absolutnie i względnie; resztę równania sprawdza się w SI z limitem `1e-7`.
Macierze, ogólne CAS i układy równań dają czytelne ograniczenie.

Kontrola arytmetyki nie potwierdza poprawności interpretacji fizycznej; założenia i opis modelu
są widoczne osobno. Math atoms nie mają text marks ze względu na możliwości obecnego transportu Yjs.
Pełny eksport równań/pakietów oraz ewaluacja live Gemini pozostają w CAI-16–18.
CAI-13–15 opisuje osobny raport [canvas-packages-validation.md](canvas-packages-validation.md). Obecny eksport wzorów zachowuje czytelny tekst/notację.
