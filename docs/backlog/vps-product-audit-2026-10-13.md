# Backlog VPS i funkcji ResearchHub — audyt 2026-10-13

Źródło: wszystkie 238 issues repozytorium [IgorK834/researchhub](https://github.com/IgorK834/researchhub/issues), pobrane ze stanem `all`, bez pull requests. Przejrzano opisy, etykiety, milestone i state reason. Snapshot obejmuje **36 otwartych i 202 zamknięte issues**, #1–#238, oraz 30 otwartych milestone. Żadne issue nie miało komentarzy w chwili odczytu. Baza kodu audytu: `a6c42f90e429277831385ac7d3d2dd502a1a5374`; niezacommitowany WIP #234/#235 jest zachowany.

Skrypt [import-vps-backlog.sh](../../scripts/github/import-vps-backlog.sh) zawiera **61 kompletnych definicji zadań**: **50 nowych i 11 odpowiadających istniejącym otwartym Task ID**. Dodaje siedem nowych epiców (31–37); sześć istniejących epiców jest ponownie wykorzystywanych. Wszystkie nowe tytuły i treść są po polsku, poza czterema nagłówkami i obowiązkowym wierszem coverage wskazanymi w szablonie użytkownika.

## Uruchomienie

W repozytorium z zalogowanym GitHub CLI:

```bash
bash scripts/github/import-vps-backlog.sh --dry-run
bash scripts/github/import-vps-backlog.sh
```

Skrypt jest samodzielny i nie potrzebuje tego dokumentu ani pliku danych. Każda komenda `gh` zajmuje jeden wiersz; każde `--body` używa ANSI-C `$'...'` z `\n`. Nie ma heredoców ani kontynuacji wierszy. Wersja CLI sprawdzona przy przygotowaniu: `gh 2.93.0`; Bash 3.2 jest wspierany.

Komendy etykiet zachowują żądany zapis `--color "#hex"`; wrapper usuwa `#` przed przekazaniem do rzeczywistego CLI, które dokumentuje [format sześciu cyfr hex](https://cli.github.com/manual/gh_label_create). Podgląd wypisuje operację i nazwę zamiast 250 kB opisów; wszystkie kompletne opisy pozostają w pliku Bash.

Podgląd nadal odczytuje GitHub, ale blokuje wszystkie mutacje. Zwykły import tworzy/aktualizuje etykiety z `--force`, tworzy tylko brakujące milestone oraz tylko Task ID nieobecne w otwartych **i zamkniętych** issues. Nie edytuje opisów istniejących zadań, nie zamyka ich i nie otwiera ponownie. Szczegółowe polskie opisy istniejących zadań w skrypcie są materiałem do ich późniejszego doprecyzowania. Powtórny sekwencyjny import oraz wznowienie po błędzie nie tworzą duplikatów. Nie uruchamiaj importerów równolegle.

Przy aktualnym snapshot importer powinien utworzyć 50 issues i 7 milestone oraz pominąć 11 istniejących tasks. Stan jest pobierany ponownie przed każdym uruchomieniem, więc wynik może być mniejszy po postępie innych zadań. Konflikt nazwy dla tego samego Epic N albo zamknięty milestone zatrzymuje import przed pierwszą mutacją.

Walidacja wykonana 2026-10-13: `bash -n` na systemowym Bash 3.2.57 oraz 12/12 testów offline (`python3 -m unittest discover -s scripts/github/tests -p 'test_*.py' -v`). Testy sprawdzają wszystkie 61 zdekodowanych body, cztery nagłówki, rzeczywiste nowe linie, kolory/etykiety/milestone, komplet i brak cykli zależności, istniejące otwarte/zamknięte Task ID, powtórny import, dry-run bez mutacji, wznowienie po awarii, konflikt milestone oraz repo override. Końcowy dry-run z rzeczywistym GitHub zakończył się: `Gotowe: 50 zadań zaplanowano, 11 istniejących pominięto; 7 nowych milestone.` Import zapisujący do GitHuba nie był wykonywany.

## Korekty wcześniejszego audytu

- Task 30.2/#220 oraz Task 30.1/#219 są zamknięte; kod ma `WorkspaceRegistrationInvitations` i obsługuje invite-only. Fragment `docs/deployment/demo.md` opisujący brak implementacji jest nieaktualny. Naprawa to dokumentacja Task 34.2, bez duplikatu zaproszeń.
- Task 24.6/#234 i Task 24.7/#235 są otwarte i mają równoległy lokalny WIP. Nie dodajemy drugich zadań Crossref/CSL; ich walidacja jest zależnością Task 34.5.
- Task 18.2/#106 i Task 27.3/#196 dostarczyły quota hooks i atomowe request counts. Nowe Task 32.1–32.3 dotyczą brakujących limitów storage, ingest/embeddingów i tokenów/kosztu całego deploymentu.
- Task 19.3/#112 i Task 30.8/#226 dostarczyły telemetrię oraz workspace usage. Task 33.7 dodaje oddzielny operatorski widok budżetu globalnego.
- Task 15.9/#228 zapewnia istniejący inspector provenance. Task 35.7 jest grafem zależności i wykorzystuje ten inspector.
- Task 28.1/#202 dotyczy demo localhost i wyklucza publiczny hosting. Nowy Epic 31 obejmuje publiczny VPS; istniejący Task 28.10/#211 pozostaje runbookiem.
- Task 26.7/#238 jest zamknięty, ale jego deklarowane komentarze triage nie występują w issues, a część opisanych jako completed/deferrable nadal jest otwarta. Task 34.2 wymaga doprowadzenia dokumentacji do stanu opartego na dowodach; importer sam nie zmienia cudzych statusów.

## Kolejność prac i koszt

1. Dokończyć Task 24.6/24.7, bramkę formatowania 34.1 i freeze/evidence 34.5.
2. Zatwierdzić plan VPS 31.1; wdrożyć limity 32.1–32.7, politykę kont demo i storage 31.9.
3. Przygotować edge/runtime/systemd/secrets/bootstrap/release/deploy 31.2–31.8 oraz operacje 33.1–33.6.
4. Przeprowadzić rzeczywistą walidację 31.10 i uzupełnić runbooki 28.10/30.6.
5. Rozwijać epiki produktu 35–37 według wartości; optional SSO, organizacje i digest nie blokują launch.

Bazowy plan nie dodaje obowiązkowych płatnych usług poza VPS i Gemini. DNS/domena już posiadana lub darmowa, brak SMTP i Brave, dane syntetyczne/resetowane oraz brak płatnego off-site storage są jawnie założone. Trwały wariant korzysta z filesystem, nie emulatora Azurite. Lokalny backup nie jest disaster recovery. Zadania dokumentacyjne mają 80% coverage dla wykonywalnych walidatorów/skryptów, jeśli są zmieniane; Markdown nie jest pozorowany jako kod.

## Indeks kompletnych definicji

| Task ID | Tytuł po polsku | Priorytet | Stan w snapshot | Zależności |
|---|---|---|---|---|
| Task 3.21 | Podziel kod tras i wprowadź budżet wydajności frontendu | medium-priority | [Istniejące #227](https://github.com/IgorK834/researchhub/issues/227) — open | Task 3.17, Task 20.4 |
| Task 24.6 | Dokończ style CSL i bibliografię we wszystkich eksportach | medium-priority | [Istniejące #234](https://github.com/IgorK834/researchhub/issues/234) — open | Task 24.1, Task 23.2, Task 23.3, Task 23.4, Task 12.4 |
| Task 24.7 | Dokończ propozycje metadanych DOI z Crossref | low-priority | [Istniejące #235](https://github.com/IgorK834/researchhub/issues/235) — open | Task 24.1, Task 18.2 |
| Task 25.3 | Dodaj wspólną bramkę browser E2E i dostępności | medium-priority | [Istniejące #144](https://github.com/IgorK834/researchhub/issues/144) — open | Task 4.6, Task 5.7, Task 6.7, Task 20.4 |
| Task 26.3 | Udokumentuj publiczne API i kontrakty OpenAPI | medium-priority | [Istniejące #149](https://github.com/IgorK834/researchhub/issues/149) — open | Task 4.6, Task 5.6, Task 6.2 |
| Task 28.3 | Dodaj tworzenie przykładowego workspace i pierwszy start | medium-priority | [Istniejące #204](https://github.com/IgorK834/researchhub/issues/204) — open | Task 28.2, Task 5.3, Task 5.9, Task 32.1, Task 32.5 |
| Task 28.6 | Przygotuj preflight i zestaw do niezawodnego live demo | high-priority | [Istniejące #207](https://github.com/IgorK834/researchhub/issues/207) — open | Task 28.1, Task 28.2, Task 28.5, Task 32.3 |
| Task 28.7 | Przepisz README jako wejście do produktu i deployu VPS | high-priority | [Istniejące #208](https://github.com/IgorK834/researchhub/issues/208) — open | Task 34.2, Task 28.10 |
| Task 28.10 | Udokumentuj publiczne demo na pojedynczym VPS | high-priority | [Istniejące #211](https://github.com/IgorK834/researchhub/issues/211) — open | Task 31.10, Task 33.1, Task 33.2, Task 33.3, Task 32.4 |
| Task 30.5 | Dodaj opcjonalne logowanie OIDC przez Microsoft Entra ID | low-priority | [Istniejące #223](https://github.com/IgorK834/researchhub/issues/223) — open | Task 27.1, Task 30.1 |
| Task 30.6 | Opracuj runbook incydentów i odtwarzania VPS | medium-priority | [Istniejące #224](https://github.com/IgorK834/researchhub/issues/224) — open | Task 33.1, Task 33.2, Task 33.3, Task 33.4, Task 33.5, Task 33.6, Task 31.10 |
| Task 31.1 | Zdefiniuj topologię, zasoby i koszt pojedynczego VPS | high-priority | Nowe | Task 28.1, Task 27.8, Task 14.3 |
| Task 31.2 | Dodaj publiczny Compose i Caddy z automatycznym HTTPS | high-priority | Nowe | Task 31.1 |
| Task 31.3 | Parametryzuj publiczne adresy, CSP i konfigurację runtime | high-priority | Nowe | Task 31.1, Task 31.2 |
| Task 31.4 | Uruchamiaj backend i kontenery automatycznie przez systemd | high-priority | Nowe | Task 31.1, Task 31.2, Task 31.3 |
| Task 31.5 | Przygotuj przypięte artefakty wydania dla VPS x86-64 | high-priority | Nowe | Task 31.1, Task 34.1, Task 34.5, Task 20.2 |
| Task 31.6 | Dodaj wdrożenie, migracje i kontrolowany rollback wydania | high-priority | Nowe | Task 31.4, Task 31.5, Task 33.2 |
| Task 31.7 | Dodaj bootstrap i zabezpieczenie dedykowanego hosta VPS | high-priority | Nowe | Task 31.1, Task 31.4 |
| Task 31.8 | Zarządzaj sekretami VPS i ich rotacją bez płatnego vaulta | high-priority | Nowe | Task 31.1, Task 31.4 |
| Task 31.9 | Dodaj prywatny storage filesystem dla wdrożenia VPS | high-priority | Nowe | Task 31.1, Task 32.1 |
| Task 31.10 | Zweryfikuj cold deploy, reboot i obciążenie na rzeczywistym VPS | high-priority | Nowe | Task 31.2, Task 31.3, Task 31.4, Task 31.6, Task 31.7, Task 31.8, Task 31.9, Task 32.2, Task 32.3, Task 32.4, Task 32.5, Task 32.6, Task 32.7, Task 33.1, Task 33.3, Task 33.4, Task 33.5, Task 33.6, Task 34.5, Task 25.3 |
| Task 32.1 | Egzekwuj atomowe limity bajtów i liczby źródeł | high-priority | Nowe | Task 7.4, Task 13.1, Task 27.3 |
| Task 32.2 | Ogranicz ingestion, embeddingi i ponowne indeksowanie | high-priority | Nowe | Task 32.1, Task 18.2, Task 27.3 |
| Task 32.3 | Wprowadź globalny budżet tokenów i wydatków Gemini | high-priority | Nowe | Task 19.3, Task 27.3, Task 32.2 |
| Task 32.4 | Dodaj serwerową politykę publicznych kont demo | high-priority | Nowe | Task 30.1, Task 30.2, Task 30.3, Task 30.7, Task 32.1 |
| Task 32.5 | Ogranicz liczbę obiektów, eksportów i równoległych analiz | high-priority | Nowe | Task 32.1, Task 18.2, Task 29.4 |
| Task 32.6 | Ogranicz próby logowania i usuń dane osobowe z logów | high-priority | Nowe | Task 4.4, Task 31.3 |
| Task 32.7 | Skonfiguruj ograniczenia dostawcy Gemini i awaryjne odcięcie | high-priority | Nowe | Task 32.3, Task 31.8 |
| Task 33.1 | Automatyzuj nocny reset i tryb konserwacji demo | high-priority | Nowe | Task 31.4, Task 31.9, Task 32.3, Task 32.4 |
| Task 33.2 | Dodaj backup, restore i test odtwarzania danych VPS | high-priority | Nowe | Task 31.9, Task 32.3, Task 30.7 |
| Task 33.3 | Monitoruj zdrowie, zasoby i błędy na pojedynczym VPS | high-priority | Nowe | Task 31.4, Task 19.2, Task 32.3 |
| Task 33.4 | Ogranicz logi i retencję danych operacyjnych | high-priority | Nowe | Task 31.2, Task 31.4, Task 32.6 |
| Task 33.5 | Sprzątaj osierocone sandboxy i nieużywane artefakty wydania | high-priority | Nowe | Task 31.1, Task 32.5, Task 14.3 |
| Task 33.6 | Obsłuż brak miejsca i presję pamięci bez utraty danych | high-priority | Nowe | Task 32.1, Task 32.5, Task 33.3, Task 33.5 |
| Task 33.7 | Dodaj operatorski panel globalnego budżetu i zużycia Gemini | medium-priority | Nowe | Task 32.3, Task 32.7, Task 30.8 |
| Task 34.1 | Napraw formatowanie i uruchamiaj Prettier w CI | high-priority | Nowe | Task 3.6, Task 20.4 |
| Task 34.2 | Uaktualnij inwentaryzację funkcji i stan backlogu | medium-priority | Nowe | Task 26.7 |
| Task 34.3 | Usuń deprecated bootstrap Spring i dynamiczny attach Mockito | medium-priority | Nowe | Task 21.16, Task 27.5 |
| Task 34.4 | Wyłącz Azure TTL bez konfiguracji i zachowaj jego zabezpieczenia | medium-priority | Nowe | Task 29.6 |
| Task 34.5 | Zamroź wydanie i zweryfikuj pełne bramki po bieżącym WIP | high-priority | Nowe | Task 24.6, Task 24.7, Task 34.1, Task 20.4 |
| Task 34.6 | Podnieś i ponownie zmierz jakość odpowiedzi Gemini | high-priority | Nowe | Task 22.1, Task 22.2, Task 22.3, Task 22.4, Task 32.3 |
| Task 35.1 | Dodaj lokalny OCR skanowanych PDF z provenance stron | medium-priority | Nowe | Task 9.1, Task 18.1, Task 32.2 |
| Task 35.2 | Importuj bibliografię z plików BibTeX i RIS | medium-priority | Nowe | Task 24.1, Task 24.6, Task 32.5 |
| Task 35.3 | Dodaj migrację bibliotek Zotero i Mendeley przez eksporty | low-priority | Nowe | Task 35.2, Task 24.2 |
| Task 35.4 | Wyszukuj globalnie w dokumentach, źródłach i wynikach workspace | medium-priority | Nowe | Task 24.3, Task 24.5, Task 17.1, Task 15.1 |
| Task 35.5 | Zbuduj macierz przeglądu literatury z dowodami i rozbieżnościami | medium-priority | Nowe | Task 12.5, Task 12.6, Task 24.6, Task 32.3 |
| Task 35.6 | Sprawdzaj dowody i niepodparte twierdzenia w całym dokumencie | medium-priority | Nowe | Task 12.3, Task 17.5, Task 32.3, Task 34.6 |
| Task 35.7 | Pokaż graf pochodzenia źródeł, odpowiedzi i analiz | medium-priority | Nowe | Task 15.9, Task 17.5, Task 15.5 |
| Task 35.8 | Dodaj wersjonowane szablony raportów badawczych | medium-priority | Nowe | Task 6.2, Task 23.1, Task 32.5 |
| Task 35.9 | Eksportuj kompletny pakiet reprodukowalności badania | medium-priority | Nowe | Task 23.1, Task 23.4, Task 15.4, Task 24.6, Task 32.5 |
| Task 35.10 | Dodaj polski i angielski interfejs z trwałym wyborem języka | low-priority | Nowe | Task 3.17, Task 30.3 |
| Task 36.1 | Dodaj listę archiwów i bezpieczne przywracanie workspace | medium-priority | Nowe | Task 5.4, Task 6.2, Task 30.7, Task 32.5 |
| Task 36.2 | Dodaj centrum powiadomień i czytelny feed aktywności | medium-priority | Nowe | Task 17.4, Task 30.8 |
| Task 36.3 | Dodaj wzmianki użytkowników w komentarzach | medium-priority | Nowe | Task 17.1, Task 36.2 |
| Task 36.4 | Dodaj przypisywanie zadań przeglądu w workspace | low-priority | Nowe | Task 36.2, Task 36.3, Task 32.5 |
| Task 36.5 | Dodaj konfigurowalny digest aktywności i preferencje powiadomień | low-priority | Nowe | Task 36.2, Task 30.3 |
| Task 36.6 | Oznacz nieaktualne analizy po zmianie danych źródłowych | medium-priority | Nowe | Task 13.1, Task 15.4, Task 36.2 |
| Task 36.7 | Dodaj parametryzowane ponawianie analiz z walidacją danych | medium-priority | Nowe | Task 15.4, Task 32.5 |
| Task 36.8 | Dodaj kontrolowane czyszczenie datasetów przed analizą | medium-priority | Nowe | Task 13.2, Task 36.7, Task 32.1, Task 32.5 |
| Task 36.9 | Dodaj przewodnik demo od źródła do eksportu | medium-priority | Nowe | Task 28.3, Task 32.4, Task 15.9, Task 24.6 |
| Task 37.1 | Dodaj opcjonalną administrację organizacji i jej limitów | low-priority | Nowe | Task 32.3, Task 30.2, Task 30.5 |

## Wszystkie otwarte issues — decyzja o pokryciu

| Issue | Task / tytuł (oryginalny) | Ocena |
|---|---|---|
| [#114](https://github.com/IgorK834/researchhub/issues/114) | [Task 20.1] Create GitHub Actions CI pipeline | Pipeline jest już w kodzie i Task 20.4/#229 jest zamknięte. Zweryfikować acceptance i zawęzić/zamknąć #114; nowa kontrola Prettier to Task 34.1. |
| [#115](https://github.com/IgorK834/researchhub/issues/115) | [Task 20.2] Add pull-request quality gate and branch conventions | Istniejąca bramka PR/branch protection pozostaje do potwierdzenia; zależność Task 31.5. Nie tworzę jej duplikatu. |
| [#119](https://github.com/IgorK834/researchhub/issues/119) | [Task 21.3] Deploy Azure PostgreSQL and configure migrations | Azure PostgreSQL pozostaje osobnym cloud roadmap; VPS korzysta z lokalnego PostgreSQL. |
| [#120](https://github.com/IgorK834/researchhub/issues/120) | [Task 21.4] Deploy Blob Storage and switch cloud storage adapter | Azure Blob pozostaje osobnym cloud roadmap; VPS filesystem to Task 31.9. |
| [#121](https://github.com/IgorK834/researchhub/issues/121) | [Task 21.5] Deploy backend to Azure Container Apps | Azure Container Apps pozostaje poza wdrożeniem VPS. |
| [#122](https://github.com/IgorK834/researchhub/issues/122) | [Task 21.6] Deploy frontend | Stare Azure/static hosting nie jest publicznym VPS; Caddy/Compose to Task 31.2. |
| [#123](https://github.com/IgorK834/researchhub/issues/123) | [Task 21.7] Integrate Microsoft Foundry model provider | Foundry cloud deployment/evaluation jest opcjonalne; VPS używa Gemini. |
| [#124](https://github.com/IgorK834/researchhub/issues/124) | [Task 21.8] Integrate Azure AI Search if selected by ADR | Sprawdzić triage z zamkniętego #238. Nowy backlog nie dodaje Azure AI Search; obowiązuje pgvector. |
| [#125](https://github.com/IgorK834/researchhub/issues/125) | [Task 21.9] Integrate Azure Document Intelligence | Azure OCR jest opcjonalne i płatne; lokalny OCR na VPS ma osobny zakres Task 35.1. |
| [#126](https://github.com/IgorK834/researchhub/issues/126) | [Task 21.10] Replace local job dispatcher transport with Azure Service Bus | Sprawdzić triage z #238; PostgreSQL durable queue jest świadomą decyzją. Brak wymagania Service Bus. |
| [#127](https://github.com/IgorK834/researchhub/issues/127) | [Task 21.11] Deploy sandbox execution to Azure Container Apps Jobs | Azure sandbox pozostaje roadmap. Publiczny VPS wykorzystuje lokalny Docker i Task 33.5. |
| [#128](https://github.com/IgorK834/researchhub/issues/128) | [Task 21.12] Configure Key Vault / managed secret strategy | Cloud Key Vault nie jest wymagany na VPS; lokalne secrets/rotation to Task 31.8. |
| [#129](https://github.com/IgorK834/researchhub/issues/129) | [Task 21.13] Configure Application Insights/OpenTelemetry | Azure Insights/Otel nie jest wymagany na VPS; lokalne metryki i alerty to Task 33.3. |
| [#130](https://github.com/IgorK834/researchhub/issues/130) | [Task 21.14] Create deployment workflow | Azure deploy workflow nie jest zastępowany milcząco; release/deploy VPS to Task 31.5–31.6. |
| [#142](https://github.com/IgorK834/researchhub/issues/142) | [Task 25.1] Create authorization test matrix | Istniejąca macierz autoryzacji: najpierw audyt aktualnych testów, potem brakujące endpointy. Nowe taski wymagają tych samych invariants. |
| [#143](https://github.com/IgorK834/researchhub/issues/143) | [Task 25.2] Add backend architecture tests | Istniejące architecture tests: sprawdzić coverage modułów przed closure; bez drugiego issue o tym samym zakresie. |
| [#144](https://github.com/IgorK834/researchhub/issues/144) | [Task 25.3] Add end-to-end browser testing foundation | Ponownie użyte jako Task 25.3; opis w skrypcie doprecyzowuje browser flows, axe i CI. |
| [#145](https://github.com/IgorK834/researchhub/issues/145) | [Task 25.4] Add file-ingestion fixture corpus | Istniejący ingestion corpus: porównać acceptance z contracts i parser tests; nowe OCR ma osobny corpus Task 35.1. |
| [#146](https://github.com/IgorK834/researchhub/issues/146) | [Task 25.5] Add sandbox adversarial test suite | Istniejące sandbox adversarial tests: sprawdzić brakujące scenarios. Nowe recovery/cleanup ma Task 33.5. |
| [#147](https://github.com/IgorK834/researchhub/issues/147) | [Task 26.1] Create local developer setup guide | Developer setup guide pozostaje istniejącym zadaniem; aktualizacja stanu dokumentów jest w Task 34.2. |
| [#148](https://github.com/IgorK834/researchhub/issues/148) | [Task 26.2] Maintain architecture decision records | ADRs są już częściowo dostarczone przez zamknięte #236/#237. Utrzymanie decyzji nadal istnieje; VPS ADR to Task 31.1. |
| [#149](https://github.com/IgorK834/researchhub/issues/149) | [Task 26.3] Add API documentation/OpenAPI | Ponownie użyte jako Task 26.3; nie tworzę drugiego OpenAPI. |
| [#150](https://github.com/IgorK834/researchhub/issues/150) | [Task 26.4] Create architecture diagrams | Istniejące diagramy architektury zachować; Task 31.1 dostarcza konkretne uzupełnienie diagramu VPS. |
| [#204](https://github.com/IgorK834/researchhub/issues/204) | [Task 28.3] Add a Create sample workspace action and first-run experience | Ponownie użyte jako Task 28.3; sample onboarding nie jest nowym dublem. |
| [#207](https://github.com/IgorK834/researchhub/issues/207) | [Task 28.6] Prepare the live-demo interview kit and pre-flight check | Ponownie użyte jako Task 28.6; preflight rozszerzony o VPS/budget. |
| [#208](https://github.com/IgorK834/researchhub/issues/208) | [Task 28.7] Rewrite the README for first-time visitors | Ponownie użyte jako Task 28.7; nowy README ma odnosić się do dowodów i VPS. |
| [#209](https://github.com/IgorK834/researchhub/issues/209) | [Task 28.8] Script and record the product demo videos | Istniejący task filmów portfolio pozostaje otwarty; nie duplikuję. Guided UI demo to nowy Task 36.9. |
| [#210](https://github.com/IgorK834/researchhub/issues/210) | [Task 28.9] Prepare the portfolio case study content | Istniejący task case study pozostaje otwarty; wymaga oceny docs/case-study.md i publikacji. Nie duplikuję. |
| [#211](https://github.com/IgorK834/researchhub/issues/211) | [Task 28.10] Document the optional on-demand hosted demo runbook | Ponownie użyte jako Task 28.10; dotychczasowe alternatywy hostingu wymagają zawężenia do wybranego VPS. |
| [#218](https://github.com/IgorK834/researchhub/issues/218) | [Task 29.7] Execute the Azure validation window and publish the evidence | Płatna/time-boxed Azure walidacja nie jest warunkiem publicznego demo VPS. |
| [#223](https://github.com/IgorK834/researchhub/issues/223) | [Task 30.5] Add an optional Microsoft Entra ID sign-in adapter | Ponownie użyte jako opcjonalny Task 30.5; nie blokuje launch VPS. |
| [#224](https://github.com/IgorK834/researchhub/issues/224) | [Task 30.6] Write the operations runbook | Ponownie użyte jako Task 30.6; opis doprecyzowuje lokalny runbook bez Azure jako zależności. |
| [#227](https://github.com/IgorK834/researchhub/issues/227) | [Task 3.21] Add route-level code splitting and a Lighthouse performance budget | Ponownie użyte jako Task 3.21; splitting/Lighthouse obejmuje również obrazy landing. |
| [#232](https://github.com/IgorK834/researchhub/issues/232) | [Task 21.17] Use Managed Identity for Azure Blob and PostgreSQL access | Managed Identity Azure nie dotyczy bazowego VPS. |
| [#234](https://github.com/IgorK834/researchhub/issues/234) | [Task 24.6] Add CSL citation styles and a generated reference list to export | Ponownie użyte jako Task 24.6; lokalny WIP CSL/BibTeX wymaga freeze i full gates. |
| [#235](https://github.com/IgorK834/researchhub/issues/235) | [Task 24.7] Add DOI metadata prefill through Crossref | Ponownie użyte jako Task 24.7; lokalny WIP Crossref wymaga testów i zatwierdzenia. |

## Pełna inwentaryzacja otwartych i zamkniętych issues

Tytuły są zachowane zgodnie z GitHub. Zamknięte pozycje są traktowane jako istniejąca praca i zależności, a nie jako dowód, że każde przyszłe wdrożenie produkcyjne jest już zweryfikowane.

| Issue | Stan | Tytuł (oryginalny) | Epic |
|---|---|---|---|
| [#1](https://github.com/IgorK834/researchhub/issues/1) | Zamknięte | [Task 1.1] Normalize the monorepo root | Epic 1: Repository and Development Standards |
| [#2](https://github.com/IgorK834/researchhub/issues/2) | Zamknięte | [Task 1.2] Create a root `.gitignore` | Epic 1: Repository and Development Standards |
| [#3](https://github.com/IgorK834/researchhub/issues/3) | Zamknięte | [Task 1.3] Add repository-level README and developer entry points | Epic 1: Repository and Development Standards |
| [#4](https://github.com/IgorK834/researchhub/issues/4) | Zamknięte | [Task 1.4] Establish formatting and line-ending conventions | Epic 1: Repository and Development Standards |
| [#5](https://github.com/IgorK834/researchhub/issues/5) | Zamknięte | [Task 1.5] Define environment/configuration conventions | Epic 1: Repository and Development Standards |
| [#6](https://github.com/IgorK834/researchhub/issues/6) | Zamknięte | [Task 2.1] Define backend module boundaries | Epic 2: Backend Application Foundation |
| [#7](https://github.com/IgorK834/researchhub/issues/7) | Zamknięte | [Task 2.2] Introduce a standardized API error contract | Epic 2: Backend Application Foundation |
| [#8](https://github.com/IgorK834/researchhub/issues/8) | Zamknięte | [Task 2.3] Configure request validation conventions | Epic 2: Backend Application Foundation |
| [#9](https://github.com/IgorK834/researchhub/issues/9) | Zamknięte | [Task 2.4] Add local PostgreSQL through Docker Compose | Epic 2: Backend Application Foundation |
| [#10](https://github.com/IgorK834/researchhub/issues/10) | Zamknięte | [Task 2.5] Configure Spring Data JPA and PostgreSQL datasource | Epic 2: Backend Application Foundation |
| [#11](https://github.com/IgorK834/researchhub/issues/11) | Zamknięte | [Task 2.6] Introduce Flyway database migrations | Epic 2: Backend Application Foundation |
| [#12](https://github.com/IgorK834/researchhub/issues/12) | Zamknięte | [Task 2.7] Add Testcontainers PostgreSQL integration-test foundation | Epic 2: Backend Application Foundation |
| [#13](https://github.com/IgorK834/researchhub/issues/13) | Zamknięte | [Task 2.8] Configure Actuator health endpoints | Epic 2: Backend Application Foundation |
| [#14](https://github.com/IgorK834/researchhub/issues/14) | Zamknięte | [Task 3.1] Complete the manual React + TypeScript build toolchain | Epic 3: Frontend Foundation |
| [#15](https://github.com/IgorK834/researchhub/issues/15) | Zamknięte | [Task 3.2] Establish frontend source structure | Epic 3: Frontend Foundation |
| [#16](https://github.com/IgorK834/researchhub/issues/16) | Zamknięte | [Task 3.3] Add React Router and application shell | Epic 3: Frontend Foundation |
| [#17](https://github.com/IgorK834/researchhub/issues/17) | Zamknięte | [Task 3.4] Add frontend API client foundation | Epic 3: Frontend Foundation |
| [#18](https://github.com/IgorK834/researchhub/issues/18) | Zamknięte | [Task 3.5] Introduce TanStack Query for server state | Epic 3: Frontend Foundation |
| [#19](https://github.com/IgorK834/researchhub/issues/19) | Zamknięte | [Task 3.6] Add frontend quality scripts | Epic 3: Frontend Foundation |
| [#20](https://github.com/IgorK834/researchhub/issues/20) | Zamknięte | [Task 4.1] Write ADR for MVP authentication mechanism | Epic 4: Authentication Architecture |
| [#21](https://github.com/IgorK834/researchhub/issues/21) | Zamknięte | [Task 4.2] Create `User` domain model and persistence | Epic 4: Authentication Architecture |
| [#22](https://github.com/IgorK834/researchhub/issues/22) | Zamknięte | [Task 4.3] Implement user registration | Epic 4: Authentication Architecture |
| [#23](https://github.com/IgorK834/researchhub/issues/23) | Zamknięte | [Task 4.4] Implement login | Epic 4: Authentication Architecture |
| [#24](https://github.com/IgorK834/researchhub/issues/24) | Zamknięte | [Task 4.5] Configure Spring Security authorization baseline | Epic 4: Authentication Architecture |
| [#25](https://github.com/IgorK834/researchhub/issues/25) | Zamknięte | [Task 4.6] Implement current-user endpoint and frontend auth bootstrap | Epic 4: Authentication Architecture |
| [#26](https://github.com/IgorK834/researchhub/issues/26) | Zamknięte | [Task 4.7] Implement logout | Epic 4: Authentication Architecture |
| [#27](https://github.com/IgorK834/researchhub/issues/27) | Zamknięte | [Task 5.1] Create workspace domain model | Epic 5: Workspaces and RBAC |
| [#28](https://github.com/IgorK834/researchhub/issues/28) | Zamknięte | [Task 5.2] Create workspace membership model and role semantics | Epic 5: Workspaces and RBAC |
| [#29](https://github.com/IgorK834/researchhub/issues/29) | Zamknięte | [Task 5.3] Implement create/list/get workspace APIs | Epic 5: Workspaces and RBAC |
| [#30](https://github.com/IgorK834/researchhub/issues/30) | Zamknięte | [Task 5.4] Implement workspace update and archive/delete policy | Epic 5: Workspaces and RBAC |
| [#31](https://github.com/IgorK834/researchhub/issues/31) | Zamknięte | [Task 5.5] Implement add existing user to workspace by email | Epic 5: Workspaces and RBAC |
| [#32](https://github.com/IgorK834/researchhub/issues/32) | Zamknięte | [Task 5.6] Implement list/update/remove workspace members | Epic 5: Workspaces and RBAC |
| [#33](https://github.com/IgorK834/researchhub/issues/33) | Zamknięte | [Task 5.7] Build workspace list/detail frontend | Epic 5: Workspaces and RBAC |
| [#34](https://github.com/IgorK834/researchhub/issues/34) | Zamknięte | [Task 6.1] Create document domain model | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#35](https://github.com/IgorK834/researchhub/issues/35) | Zamknięte | [Task 6.2] Implement document CRUD APIs | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#36](https://github.com/IgorK834/researchhub/issues/36) | Zamknięte | [Task 6.3] Implement optimistic concurrency for non-realtime document saves | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#37](https://github.com/IgorK834/researchhub/issues/37) | Zamknięte | [Task 6.4] Select and integrate the rich-text editor | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#38](https://github.com/IgorK834/researchhub/issues/38) | Zamknięte | [Task 6.5] Implement document autosave | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#39](https://github.com/IgorK834/researchhub/issues/39) | Zamknięte | [Task 6.6] Add basic document version snapshots | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#40](https://github.com/IgorK834/researchhub/issues/40) | Zamknięte | [Task 6.7] Build document list and editor frontend flow | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#41](https://github.com/IgorK834/researchhub/issues/41) | Zamknięte | [Task 7.1] Define source file model and supported MIME/type policy | Epic 7: Object Storage and Source Metadata |
| [#42](https://github.com/IgorK834/researchhub/issues/42) | Zamknięte | [Task 7.2] Introduce object-storage abstraction | Epic 7: Object Storage and Source Metadata |
| [#43](https://github.com/IgorK834/researchhub/issues/43) | Zamknięte | [Task 7.3] Configure Azurite/Blob-compatible local object storage | Epic 7: Object Storage and Source Metadata |
| [#44](https://github.com/IgorK834/researchhub/issues/44) | Zamknięte | [Task 7.4] Implement secure source upload API | Epic 7: Object Storage and Source Metadata |
| [#45](https://github.com/IgorK834/researchhub/issues/45) | Zamknięte | [Task 7.5] Implement source list/detail/download API | Epic 7: Object Storage and Source Metadata |
| [#46](https://github.com/IgorK834/researchhub/issues/46) | Zamknięte | [Task 7.6] Build source library frontend | Epic 7: Object Storage and Source Metadata |
| [#47](https://github.com/IgorK834/researchhub/issues/47) | Zamknięte | [Task 8.1] Create processing job domain model | Epic 8: Durable Processing Jobs and Python Worker Foundation |
| [#48](https://github.com/IgorK834/researchhub/issues/48) | Zamknięte | [Task 8.2] Implement initial durable job dispatcher without cloud broker | Epic 8: Durable Processing Jobs and Python Worker Foundation |
| [#49](https://github.com/IgorK834/researchhub/issues/49) | Zamknięte | [Task 8.3] Scaffold `ai-worker` Python service | Epic 8: Durable Processing Jobs and Python Worker Foundation |
| [#50](https://github.com/IgorK834/researchhub/issues/50) | Zamknięte | [Task 8.4] Secure internal Spring-to-worker communication | Epic 8: Durable Processing Jobs and Python Worker Foundation |
| [#51](https://github.com/IgorK834/researchhub/issues/51) | Zamknięte | [Task 8.5] Define worker job request/result contracts | Epic 8: Durable Processing Jobs and Python Worker Foundation |
| [#52](https://github.com/IgorK834/researchhub/issues/52) | Zamknięte | [Task 9.1] Implement PDF text extraction with page provenance | Epic 9: Document Parsing |
| [#53](https://github.com/IgorK834/researchhub/issues/53) | Zamknięte | [Task 9.2] Implement DOCX text and structure extraction | Epic 9: Document Parsing |
| [#54](https://github.com/IgorK834/researchhub/issues/54) | Zamknięte | [Task 9.3] Implement CSV metadata/preview extraction | Epic 9: Document Parsing |
| [#55](https://github.com/IgorK834/researchhub/issues/55) | Zamknięte | [Task 9.4] Implement XLSX workbook metadata/preview extraction | Epic 9: Document Parsing |
| [#56](https://github.com/IgorK834/researchhub/issues/56) | Zamknięte | [Task 9.5] Persist source extraction metadata and processing result | Epic 9: Document Parsing |
| [#57](https://github.com/IgorK834/researchhub/issues/57) | Zamknięte | [Task 9.6] Build source preview UI | Epic 9: Document Parsing |
| [#58](https://github.com/IgorK834/researchhub/issues/58) | Zamknięte | [Task 10.1] Define canonical source chunk schema | Epic 10: Chunking and Indexing |
| [#59](https://github.com/IgorK834/researchhub/issues/59) | Zamknięte | [Task 10.2] Implement structure-aware chunking | Epic 10: Chunking and Indexing |
| [#60](https://github.com/IgorK834/researchhub/issues/60) | Zamknięte | [Task 10.3] Define embedding provider abstraction | Epic 10: Chunking and Indexing |
| [#61](https://github.com/IgorK834/researchhub/issues/61) | Zamknięte | [Task 10.4] Decide local vector search vs Azure AI Search adapter strategy | Epic 10: Chunking and Indexing |
| [#62](https://github.com/IgorK834/researchhub/issues/62) | Zamknięte | [Task 10.5] Implement retrieval index adapter | Epic 10: Chunking and Indexing |
| [#63](https://github.com/IgorK834/researchhub/issues/63) | Zamknięte | [Task 10.6] Extend ingestion pipeline with embeddings and indexing | Epic 10: Chunking and Indexing |
| [#64](https://github.com/IgorK834/researchhub/issues/64) | Zamknięte | [Task 11.1] Define LLM provider abstraction and structured response policy | Epic 11: LLM Orchestration and Citations |
| [#65](https://github.com/IgorK834/researchhub/issues/65) | Zamknięte | [Task 11.2] Implement citation-aware RAG context builder | Epic 11: LLM Orchestration and Citations |
| [#66](https://github.com/IgorK834/researchhub/issues/66) | Zamknięte | [Task 11.3] Implement `Ask Workspace` backend use case | Epic 11: LLM Orchestration and Citations |
| [#67](https://github.com/IgorK834/researchhub/issues/67) | Zamknięte | [Task 11.4] Add AI conversation persistence | Epic 11: LLM Orchestration and Citations |
| [#68](https://github.com/IgorK834/researchhub/issues/68) | Zamknięte | [Task 11.5] Build Ask Workspace frontend sidebar | Epic 11: LLM Orchestration and Citations |
| [#69](https://github.com/IgorK834/researchhub/issues/69) | Zamknięte | [Task 11.6] Add response streaming via SSE | Epic 11: LLM Orchestration and Citations |
| [#70](https://github.com/IgorK834/researchhub/issues/70) | Zamknięte | [Task 12.1] Implement selected-source section generation | Epic 12: AI-Assisted Authoring |
| [#71](https://github.com/IgorK834/researchhub/issues/71) | Zamknięte | [Task 12.2] Implement rewrite selected document fragment | Epic 12: AI-Assisted Authoring |
| [#72](https://github.com/IgorK834/researchhub/issues/72) | Zamknięte | [Task 12.3] Implement `Find Evidence` for selected claim | Epic 12: AI-Assisted Authoring |
| [#73](https://github.com/IgorK834/researchhub/issues/73) | Zamknięte | [Task 12.4] Implement citation insertion node/mark in editor | Epic 12: AI-Assisted Authoring |
| [#74](https://github.com/IgorK834/researchhub/issues/74) | Zamknięte | [Task 12.5] Implement multi-source comparison | Epic 12: AI-Assisted Authoring |
| [#75](https://github.com/IgorK834/researchhub/issues/75) | Zamknięte | [Task 12.6] Prototype contradiction/disagreement detection | Epic 12: AI-Assisted Authoring |
| [#76](https://github.com/IgorK834/researchhub/issues/76) | Zamknięte | [Task 13.1] Create source versioning for data files | Epic 13: Dataset Inspection |
| [#77](https://github.com/IgorK834/researchhub/issues/77) | Zamknięte | [Task 13.2] Build spreadsheet inspection API | Epic 13: Dataset Inspection |
| [#78](https://github.com/IgorK834/researchhub/issues/78) | Zamknięte | [Task 13.3] Build dataset preview frontend | Epic 13: Dataset Inspection |
| [#79](https://github.com/IgorK834/researchhub/issues/79) | Zamknięte | [Task 14.1] Create analysis request/domain model | Epic 14: Analysis Planning and Sandbox Execution |
| [#80](https://github.com/IgorK834/researchhub/issues/80) | Zamknięte | [Task 14.2] Define structured AI analysis plan schema | Epic 14: Analysis Planning and Sandbox Execution |
| [#81](https://github.com/IgorK834/researchhub/issues/81) | Zamknięte | [Task 14.3] Design sandbox threat model and ADR | Epic 14: Analysis Planning and Sandbox Execution |
| [#82](https://github.com/IgorK834/researchhub/issues/82) | Zamknięte | [Task 14.4] Build sandbox execution image | Epic 14: Analysis Planning and Sandbox Execution |
| [#83](https://github.com/IgorK834/researchhub/issues/83) | Zamknięte | [Task 14.5] Implement sandbox runner service/adapter | Epic 14: Analysis Planning and Sandbox Execution |
| [#84](https://github.com/IgorK834/researchhub/issues/84) | Zamknięte | [Task 14.6] Implement analysis orchestration end to end | Epic 14: Analysis Planning and Sandbox Execution |
| [#85](https://github.com/IgorK834/researchhub/issues/85) | Zamknięte | [Task 15.1] Create `AnalysisArtifact` and execution persistence | Epic 15: Analysis Artifacts and Provenance |
| [#86](https://github.com/IgorK834/researchhub/issues/86) | Zamknięte | [Task 15.2] Define chart output contract | Epic 15: Analysis Artifacts and Provenance |
| [#87](https://github.com/IgorK834/researchhub/issues/87) | Zamknięte | [Task 15.3] Build analysis result frontend | Epic 15: Analysis Artifacts and Provenance |
| [#88](https://github.com/IgorK834/researchhub/issues/88) | Zamknięte | [Task 15.4] Implement analysis re-run semantics | Epic 15: Analysis Artifacts and Provenance |
| [#89](https://github.com/IgorK834/researchhub/issues/89) | Zamknięte | [Task 15.5] Add analysis provenance API | Epic 15: Analysis Artifacts and Provenance |
| [#90](https://github.com/IgorK834/researchhub/issues/90) | Zamknięte | [Task 15.6] Implement document analysis block node | Epic 15: Analysis Artifacts and Provenance |
| [#91](https://github.com/IgorK834/researchhub/issues/91) | Zamknięte | [Task 15.7] Add computed-result grounding to AI responses | Epic 15: Analysis Artifacts and Provenance |
| [#92](https://github.com/IgorK834/researchhub/issues/92) | Zamknięte | [Task 16.1] Write ADR for realtime collaboration architecture | Epic 16: Realtime Document Collaboration |
| [#93](https://github.com/IgorK834/researchhub/issues/93) | Zamknięte | [Task 16.2] Scaffold collaboration service | Epic 16: Realtime Document Collaboration |
| [#94](https://github.com/IgorK834/researchhub/issues/94) | Zamknięte | [Task 16.3] Implement collaboration access token/handshake | Epic 16: Realtime Document Collaboration |
| [#95](https://github.com/IgorK834/researchhub/issues/95) | Zamknięte | [Task 16.4] Integrate Yjs with Tiptap editor | Epic 16: Realtime Document Collaboration |
| [#96](https://github.com/IgorK834/researchhub/issues/96) | Zamknięte | [Task 16.5] Persist Yjs document state safely | Epic 16: Realtime Document Collaboration |
| [#97](https://github.com/IgorK834/researchhub/issues/97) | Zamknięte | [Task 16.6] Implement user presence and cursors | Epic 16: Realtime Document Collaboration |
| [#98](https://github.com/IgorK834/researchhub/issues/98) | Zamknięte | [Task 16.7] Implement collaboration permission downgrade/revocation behavior | Epic 16: Realtime Document Collaboration |
| [#99](https://github.com/IgorK834/researchhub/issues/99) | Zamknięte | [Task 17.1] Implement document comments domain model | Epic 17: Comments, Audit, and Document History |
| [#100](https://github.com/IgorK834/researchhub/issues/100) | Zamknięte | [Task 17.2] Build comments UI | Epic 17: Comments, Audit, and Document History |
| [#101](https://github.com/IgorK834/researchhub/issues/101) | Zamknięte | [Task 17.3] Add `@AI find evidence` comment action | Epic 17: Comments, Audit, and Document History |
| [#102](https://github.com/IgorK834/researchhub/issues/102) | Zamknięte | [Task 17.4] Create audit event infrastructure | Epic 17: Comments, Audit, and Document History |
| [#103](https://github.com/IgorK834/researchhub/issues/103) | Zamknięte | [Task 17.5] Implement document contribution/provenance metadata | Epic 17: Comments, Audit, and Document History |
| [#104](https://github.com/IgorK834/researchhub/issues/104) | Zamknięte | [Task 17.6] Implement collaborative document snapshots and restore | Epic 17: Comments, Audit, and Document History |
| [#105](https://github.com/IgorK834/researchhub/issues/105) | Zamknięte | [Task 18.1] Implement file-upload hardening | Epic 18: Application Security Hardening |
| [#106](https://github.com/IgorK834/researchhub/issues/106) | Zamknięte | [Task 18.2] Add application rate limiting and AI quota hooks | Epic 18: Application Security Hardening |
| [#107](https://github.com/IgorK834/researchhub/issues/107) | Zamknięte | [Task 18.3] Implement prompt-injection defensive boundaries | Epic 18: Application Security Hardening |
| [#108](https://github.com/IgorK834/researchhub/issues/108) | Zamknięte | [Task 18.4] Add secure HTTP/security headers and CORS policy | Epic 18: Application Security Hardening |
| [#109](https://github.com/IgorK834/researchhub/issues/109) | Zamknięte | [Task 18.5] Add dependency and secret scanning in CI | Epic 18: Application Security Hardening |
| [#110](https://github.com/IgorK834/researchhub/issues/110) | Zamknięte | [Task 19.1] Implement structured application logging and correlation IDs | Epic 19: Observability |
| [#111](https://github.com/IgorK834/researchhub/issues/111) | Zamknięte | [Task 19.2] Add metrics for core backend and job processing | Epic 19: Observability |
| [#112](https://github.com/IgorK834/researchhub/issues/112) | Zamknięte | [Task 19.3] Implement AI usage/cost telemetry | Epic 19: Observability |
| [#113](https://github.com/IgorK834/researchhub/issues/113) | Zamknięte | [Task 19.4] Implement developer-only AI debugger | Epic 19: Observability |
| [#114](https://github.com/IgorK834/researchhub/issues/114) | Otwarte | [Task 20.1] Create GitHub Actions CI pipeline | Epic 20: Continuous Integration |
| [#115](https://github.com/IgorK834/researchhub/issues/115) | Otwarte | [Task 20.2] Add pull-request quality gate and branch conventions | Epic 20: Continuous Integration |
| [#116](https://github.com/IgorK834/researchhub/issues/116) | Zamknięte | [Task 20.3] Build backend/frontend/worker container images | Epic 20: Continuous Integration |
| [#117](https://github.com/IgorK834/researchhub/issues/117) | Zamknięte | [Task 21.1] Create Azure architecture ADR and resource inventory | Epic 21: Azure Infrastructure and Deployment |
| [#118](https://github.com/IgorK834/researchhub/issues/118) | Zamknięte | [Task 21.2] Choose and initialize Infrastructure as Code | Epic 21: Azure Infrastructure and Deployment |
| [#119](https://github.com/IgorK834/researchhub/issues/119) | Otwarte | [Task 21.3] Deploy Azure PostgreSQL and configure migrations | Epic 21: Azure Infrastructure and Deployment |
| [#120](https://github.com/IgorK834/researchhub/issues/120) | Otwarte | [Task 21.4] Deploy Blob Storage and switch cloud storage adapter | Epic 21: Azure Infrastructure and Deployment |
| [#121](https://github.com/IgorK834/researchhub/issues/121) | Otwarte | [Task 21.5] Deploy backend to Azure Container Apps | Epic 21: Azure Infrastructure and Deployment |
| [#122](https://github.com/IgorK834/researchhub/issues/122) | Otwarte | [Task 21.6] Deploy frontend | Epic 21: Azure Infrastructure and Deployment |
| [#123](https://github.com/IgorK834/researchhub/issues/123) | Otwarte | [Task 21.7] Integrate Microsoft Foundry model provider | Epic 21: Azure Infrastructure and Deployment |
| [#124](https://github.com/IgorK834/researchhub/issues/124) | Otwarte | [Task 21.8] Integrate Azure AI Search if selected by ADR | Epic 21: Azure Infrastructure and Deployment |
| [#125](https://github.com/IgorK834/researchhub/issues/125) | Otwarte | [Task 21.9] Integrate Azure Document Intelligence | Epic 21: Azure Infrastructure and Deployment |
| [#126](https://github.com/IgorK834/researchhub/issues/126) | Otwarte | [Task 21.10] Replace local job dispatcher transport with Azure Service Bus | Epic 21: Azure Infrastructure and Deployment |
| [#127](https://github.com/IgorK834/researchhub/issues/127) | Otwarte | [Task 21.11] Deploy sandbox execution to Azure Container Apps Jobs | Epic 21: Azure Infrastructure and Deployment |
| [#128](https://github.com/IgorK834/researchhub/issues/128) | Otwarte | [Task 21.12] Configure Key Vault / managed secret strategy | Epic 21: Azure Infrastructure and Deployment |
| [#129](https://github.com/IgorK834/researchhub/issues/129) | Otwarte | [Task 21.13] Configure Application Insights/OpenTelemetry | Epic 21: Azure Infrastructure and Deployment |
| [#130](https://github.com/IgorK834/researchhub/issues/130) | Otwarte | [Task 21.14] Create deployment workflow | Epic 21: Azure Infrastructure and Deployment |
| [#131](https://github.com/IgorK834/researchhub/issues/131) | Zamknięte | [Task 22.1] Create RAG evaluation dataset format | Epic 22: AI Evaluation |
| [#132](https://github.com/IgorK834/researchhub/issues/132) | Zamknięte | [Task 22.2] Implement retrieval evaluation runner | Epic 22: AI Evaluation |
| [#133](https://github.com/IgorK834/researchhub/issues/133) | Zamknięte | [Task 22.3] Implement answer/citation evaluation runner | Epic 22: AI Evaluation |
| [#134](https://github.com/IgorK834/researchhub/issues/134) | Zamknięte | [Task 23.1] Define export document model | Epic 23: Research Document Export |
| [#135](https://github.com/IgorK834/researchhub/issues/135) | Zamknięte | [Task 23.2] Implement DOCX export | Epic 23: Research Document Export |
| [#136](https://github.com/IgorK834/researchhub/issues/136) | Zamknięte | [Task 23.3] Implement PDF export | Epic 23: Research Document Export |
| [#137](https://github.com/IgorK834/researchhub/issues/137) | Zamknięte | [Task 23.4] Prototype LaTeX export | Epic 23: Research Document Export |
| [#138](https://github.com/IgorK834/researchhub/issues/138) | Zamknięte | [Task 24.1] Add source bibliographic metadata | Epic 24: Advanced Source and Research Workflows |
| [#139](https://github.com/IgorK834/researchhub/issues/139) | Zamknięte | [Task 24.2] Add source tagging/folders/collections | Epic 24: Advanced Source and Research Workflows |
| [#140](https://github.com/IgorK834/researchhub/issues/140) | Zamknięte | [Task 24.3] Add source search and filtering | Epic 24: Advanced Source and Research Workflows |
| [#141](https://github.com/IgorK834/researchhub/issues/141) | Zamknięte | [Task 24.4] Add internet/external literature search as a separate trust mode | Epic 24: Advanced Source and Research Workflows |
| [#142](https://github.com/IgorK834/researchhub/issues/142) | Otwarte | [Task 25.1] Create authorization test matrix | Epic 25: Cross-Cutting Testing |
| [#143](https://github.com/IgorK834/researchhub/issues/143) | Otwarte | [Task 25.2] Add backend architecture tests | Epic 25: Cross-Cutting Testing |
| [#144](https://github.com/IgorK834/researchhub/issues/144) | Otwarte | [Task 25.3] Add end-to-end browser testing foundation | Epic 25: Cross-Cutting Testing |
| [#145](https://github.com/IgorK834/researchhub/issues/145) | Otwarte | [Task 25.4] Add file-ingestion fixture corpus | Epic 25: Cross-Cutting Testing |
| [#146](https://github.com/IgorK834/researchhub/issues/146) | Otwarte | [Task 25.5] Add sandbox adversarial test suite | Epic 25: Cross-Cutting Testing |
| [#147](https://github.com/IgorK834/researchhub/issues/147) | Otwarte | [Task 26.1] Create local developer setup guide | Epic 26: Developer Experience and Documentation |
| [#148](https://github.com/IgorK834/researchhub/issues/148) | Otwarte | [Task 26.2] Maintain architecture decision records | Epic 26: Developer Experience and Documentation |
| [#149](https://github.com/IgorK834/researchhub/issues/149) | Otwarte | [Task 26.3] Add API documentation/OpenAPI | Epic 26: Developer Experience and Documentation |
| [#150](https://github.com/IgorK834/researchhub/issues/150) | Otwarte | [Task 26.4] Create architecture diagrams | Epic 26: Developer Experience and Documentation |
| [#151](https://github.com/IgorK834/researchhub/issues/151) | Zamknięte | [Task 3.7] Define frontend styling approach and add CSS toolchain support | Epic 3: Frontend Foundation |
| [#152](https://github.com/IgorK834/researchhub/issues/152) | Zamknięte | [Task 3.8] Add design tokens and base typography styles | Epic 3: Frontend Foundation |
| [#153](https://github.com/IgorK834/researchhub/issues/153) | Zamknięte | [Task 3.9] Add the ResearchHub icon set | Epic 3: Frontend Foundation |
| [#154](https://github.com/IgorK834/researchhub/issues/154) | Zamknięte | [Task 3.10] Build button primitives | Epic 3: Frontend Foundation |
| [#155](https://github.com/IgorK834/researchhub/issues/155) | Zamknięte | [Task 3.11] Build form field and selection control primitives | Epic 3: Frontend Foundation |
| [#156](https://github.com/IgorK834/researchhub/issues/156) | Zamknięte | [Task 3.12] Build badge, chip, avatar and sticker primitives | Epic 3: Frontend Foundation |
| [#157](https://github.com/IgorK834/researchhub/issues/157) | Zamknięte | [Task 3.13] Build overlay primitives: dialog, popover menu and slide-over | Epic 3: Frontend Foundation |
| [#158](https://github.com/IgorK834/researchhub/issues/158) | Zamknięte | [Task 3.14] Build feedback primitives: banner, toast, progress, spinner and skeleton | Epic 3: Frontend Foundation |
| [#159](https://github.com/IgorK834/researchhub/issues/159) | Zamknięte | [Task 3.15] Build surface primitives: card, list row, data table and empty state | Epic 3: Frontend Foundation |
| [#160](https://github.com/IgorK834/researchhub/issues/160) | Zamknięte | [Task 3.16] Build navigation primitives: tabs, filter chips and breadcrumbs | Epic 3: Frontend Foundation |
| [#161](https://github.com/IgorK834/researchhub/issues/161) | Zamknięte | [Task 3.17] Build the authenticated app shell with sidebar and top bar | Epic 3: Frontend Foundation |
| [#162](https://github.com/IgorK834/researchhub/issues/162) | Zamknięte | [Task 3.18] Add workspace section routes and navigation structure | Epic 3: Frontend Foundation |
| [#163](https://github.com/IgorK834/researchhub/issues/163) | Zamknięte | [Task 3.19] Build the workspace tool shell with rail, secondary column and context panel | Epic 3: Frontend Foundation |
| [#164](https://github.com/IgorK834/researchhub/issues/164) | Zamknięte | [Task 3.20] Add responsive shell behavior for narrower desktop widths | Epic 3: Frontend Foundation |
| [#165](https://github.com/IgorK834/researchhub/issues/165) | Zamknięte | [Task 5.8] Add workspace capability helper and role badge | Epic 5: Workspaces and RBAC |
| [#166](https://github.com/IgorK834/researchhub/issues/166) | Zamknięte | [Task 7.7] Add source type and processing status components | Epic 7: Object Storage and Source Metadata |
| [#167](https://github.com/IgorK834/researchhub/issues/167) | Zamknięte | [Task 11.7] Build AI scope selector and source picker | Epic 11: LLM Orchestration and Citations |
| [#168](https://github.com/IgorK834/researchhub/issues/168) | Zamknięte | [Task 11.8] Build citation chip and citation popover | Epic 11: LLM Orchestration and Citations |
| [#169](https://github.com/IgorK834/researchhub/issues/169) | Zamknięte | [Task 11.9] Build grounded answer block and evidence list components | Epic 11: LLM Orchestration and Citations |
| [#170](https://github.com/IgorK834/researchhub/issues/170) | Zamknięte | [Task 4.8] Restyle login and register screens with the auth split layout | Epic 4: Authentication Architecture |
| [#171](https://github.com/IgorK834/researchhub/issues/171) | Zamknięte | [Task 5.9] Build workspace home with workspace cards and first-run empty state | Epic 5: Workspaces and RBAC |
| [#172](https://github.com/IgorK834/researchhub/issues/172) | Zamknięte | [Task 5.10] Build the create workspace dialog | Epic 5: Workspaces and RBAC |
| [#173](https://github.com/IgorK834/researchhub/issues/173) | Zamknięte | [Task 5.11] Build workspace overview page from existing data | Epic 5: Workspaces and RBAC |
| [#174](https://github.com/IgorK834/researchhub/issues/174) | Zamknięte | [Task 5.12] Build members page and role management UI | Epic 5: Workspaces and RBAC |
| [#175](https://github.com/IgorK834/researchhub/issues/175) | Zamknięte | [Task 5.13] Build workspace settings page and archive confirmation dialog | Epic 5: Workspaces and RBAC |
| [#176](https://github.com/IgorK834/researchhub/issues/176) | Zamknięte | [Task 6.8] Build documents list page | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#177](https://github.com/IgorK834/researchhub/issues/177) | Zamknięte | [Task 6.9] Build document editor frame with documents column and outline | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#178](https://github.com/IgorK834/researchhub/issues/178) | Zamknięte | [Task 6.10] Style document paper, formatting toolbar and content blocks | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#179](https://github.com/IgorK834/researchhub/issues/179) | Zamknięte | [Task 6.11] Build save status, conflict and read-only document states | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#180](https://github.com/IgorK834/researchhub/issues/180) | Zamknięte | [Task 6.12] Build document version history panel | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#181](https://github.com/IgorK834/researchhub/issues/181) | Zamknięte | [Task 6.13] Build version diff preview for document history | Epic 6: Persistent Documents Before Realtime Collaboration |
| [#182](https://github.com/IgorK834/researchhub/issues/182) | Zamknięte | [Task 7.8] Build source library page | Epic 7: Object Storage and Source Metadata |
| [#183](https://github.com/IgorK834/researchhub/issues/183) | Zamknięte | [Task 7.9] Build upload sources dialog | Epic 7: Object Storage and Source Metadata |
| [#184](https://github.com/IgorK834/researchhub/issues/184) | Zamknięte | [Task 9.7] Build source detail page layout | Epic 9: Document Parsing |
| [#185](https://github.com/IgorK834/researchhub/issues/185) | Zamknięte | [Task 11.10] Build Ask AI page | Epic 11: LLM Orchestration and Citations |
| [#186](https://github.com/IgorK834/researchhub/issues/186) | Zamknięte | [Task 11.11] Build scoped Ask this source view | Epic 11: LLM Orchestration and Citations |
| [#187](https://github.com/IgorK834/researchhub/issues/187) | Zamknięte | [Task 12.7] Build document selection toolbar for AI rewrite actions | Epic 12: AI-Assisted Authoring |
| [#188](https://github.com/IgorK834/researchhub/issues/188) | Zamknięte | [Task 12.8] Build generate section panel | Epic 12: AI-Assisted Authoring |
| [#189](https://github.com/IgorK834/researchhub/issues/189) | Zamknięte | [Task 12.9] Build AI suggestion card and find evidence panel | Epic 12: AI-Assisted Authoring |
| [#190](https://github.com/IgorK834/researchhub/issues/190) | Zamknięte | [Task 12.10] Build compare sources view | Epic 12: AI-Assisted Authoring |
| [#191](https://github.com/IgorK834/researchhub/issues/191) | Zamknięte | [Task 13.4] Build spreadsheet viewer from the dataset preview | Epic 13: Dataset Inspection |
| [#192](https://github.com/IgorK834/researchhub/issues/192) | Zamknięte | [Task 15.8] Build analysis status, pipeline and result presentation components | Epic 15: Analysis Artifacts and Provenance |
| [#193](https://github.com/IgorK834/researchhub/issues/193) | Zamknięte | [Task 24.5] Build command search dialog for workspace sources | Epic 24: Advanced Source and Research Workflows |
| [#194](https://github.com/IgorK834/researchhub/issues/194) | Zamknięte | [Task 27.1] Adopt Spring Session JDBC for shared HTTP sessions | Epic 27: Horizontal Scalability Foundations |
| [#195](https://github.com/IgorK834/researchhub/issues/195) | Zamknięte | [Task 27.2] Add cross-instance session integration test | Epic 27: Horizontal Scalability Foundations |
| [#196](https://github.com/IgorK834/researchhub/issues/196) | Zamknięte | [Task 27.3] Implement PostgresCostQuotaStore | Epic 27: Horizontal Scalability Foundations |
| [#197](https://github.com/IgorK834/researchhub/issues/197) | Zamknięte | [Task 27.4] Add concurrent quota admission tests | Epic 27: Horizontal Scalability Foundations |
| [#198](https://github.com/IgorK834/researchhub/issues/198) | Zamknięte | [Task 27.5] Remove profile coupling from product beans | Epic 27: Horizontal Scalability Foundations |
| [#199](https://github.com/IgorK834/researchhub/issues/199) | Zamknięte | [Task 27.6] Replace the cloud profile scaffold with a real azure profile | Epic 27: Horizontal Scalability Foundations |
| [#200](https://github.com/IgorK834/researchhub/issues/200) | Zamknięte | [Task 27.7] Split the Azure Blob adapter from Azurite local configuration | Epic 27: Horizontal Scalability Foundations |
| [#201](https://github.com/IgorK834/researchhub/issues/201) | Zamknięte | [Task 27.8] Bound database connection pools and document the capacity budget | Epic 27: Horizontal Scalability Foundations |
| [#202](https://github.com/IgorK834/researchhub/issues/202) | Zamknięte | [Task 28.1] Provide a one-command local demo stack | Epic 28: Demo Kit and Portfolio Presentation |
| [#203](https://github.com/IgorK834/researchhub/issues/203) | Zamknięte | [Task 28.2] Create the RC Circuit Lab demo seed fixtures | Epic 28: Demo Kit and Portfolio Presentation |
| [#204](https://github.com/IgorK834/researchhub/issues/204) | Otwarte | [Task 28.3] Add a Create sample workspace action and first-run experience | Epic 28: Demo Kit and Portfolio Presentation |
| [#205](https://github.com/IgorK834/researchhub/issues/205) | Zamknięte | [Task 28.4] Add an OpenAI-compatible model provider to the AI worker | Epic 28: Demo Kit and Portfolio Presentation |
| [#206](https://github.com/IgorK834/researchhub/issues/206) | Zamknięte | [Task 28.5] Add a demo profile, demo banner and AI mode indicator | Epic 28: Demo Kit and Portfolio Presentation |
| [#207](https://github.com/IgorK834/researchhub/issues/207) | Otwarte | [Task 28.6] Prepare the live-demo interview kit and pre-flight check | Epic 28: Demo Kit and Portfolio Presentation |
| [#208](https://github.com/IgorK834/researchhub/issues/208) | Otwarte | [Task 28.7] Rewrite the README for first-time visitors | Epic 28: Demo Kit and Portfolio Presentation |
| [#209](https://github.com/IgorK834/researchhub/issues/209) | Otwarte | [Task 28.8] Script and record the product demo videos | Epic 28: Demo Kit and Portfolio Presentation |
| [#210](https://github.com/IgorK834/researchhub/issues/210) | Otwarte | [Task 28.9] Prepare the portfolio case study content | Epic 28: Demo Kit and Portfolio Presentation |
| [#211](https://github.com/IgorK834/researchhub/issues/211) | Otwarte | [Task 28.10] Document the optional on-demand hosted demo runbook | Epic 28: Demo Kit and Portfolio Presentation |
| [#212](https://github.com/IgorK834/researchhub/issues/212) | Zamknięte | [Task 29.1] Add a local two-instance topology | Epic 29: Performance and Scale Validation |
| [#213](https://github.com/IgorK834/researchhub/issues/213) | Zamknięte | [Task 29.2] Create the k6 load-test scenarios | Epic 29: Performance and Scale Validation |
| [#214](https://github.com/IgorK834/researchhub/issues/214) | Zamknięte | [Task 29.3] Run the local multi-replica validation and save the report | Epic 29: Performance and Scale Validation |
| [#215](https://github.com/IgorK834/researchhub/issues/215) | Zamknięte | [Task 29.4] Verify that multiple dispatchers never process a job twice | Epic 29: Performance and Scale Validation |
| [#216](https://github.com/IgorK834/researchhub/issues/216) | Zamknięte | [Task 29.5] Create the Azure staging lifecycle scripts | Epic 29: Performance and Scale Validation |
| [#217](https://github.com/IgorK834/researchhub/issues/217) | Zamknięte | [Task 29.6] Add Azure staging deploy and destroy workflows with cost guardrails | Epic 29: Performance and Scale Validation |
| [#218](https://github.com/IgorK834/researchhub/issues/218) | Otwarte | [Task 29.7] Execute the Azure validation window and publish the evidence | Epic 29: Performance and Scale Validation |
| [#219](https://github.com/IgorK834/researchhub/issues/219) | Zamknięte | [Task 30.1] Add a registration switch and invite-only mode | Epic 30: Enterprise Account and Operations Features |
| [#220](https://github.com/IgorK834/researchhub/issues/220) | Zamknięte | [Task 30.2] Implement workspace invitations for unregistered users | Epic 30: Enterprise Account and Operations Features |
| [#221](https://github.com/IgorK834/researchhub/issues/221) | Zamknięte | [Task 30.3] Add change password and session management | Epic 30: Enterprise Account and Operations Features |
| [#222](https://github.com/IgorK834/researchhub/issues/222) | Zamknięte | [Task 30.4] Add password reset and email verification | Epic 30: Enterprise Account and Operations Features |
| [#223](https://github.com/IgorK834/researchhub/issues/223) | Otwarte | [Task 30.5] Add an optional Microsoft Entra ID sign-in adapter | Epic 30: Enterprise Account and Operations Features |
| [#224](https://github.com/IgorK834/researchhub/issues/224) | Otwarte | [Task 30.6] Write the operations runbook | Epic 30: Enterprise Account and Operations Features |
| [#225](https://github.com/IgorK834/researchhub/issues/225) | Zamknięte | [Task 30.7] Implement account and workspace deletion according to the retention ADR | Epic 30: Enterprise Account and Operations Features |
| [#226](https://github.com/IgorK834/researchhub/issues/226) | Zamknięte | [Task 30.8] Add audit export and a workspace AI usage view | Epic 30: Enterprise Account and Operations Features |
| [#227](https://github.com/IgorK834/researchhub/issues/227) | Otwarte | [Task 3.21] Add route-level code splitting and a Lighthouse performance budget | Epic 3: Frontend Foundation |
| [#228](https://github.com/IgorK834/researchhub/issues/228) | Zamknięte | [Task 15.9] Surface provenance from the document in two clicks | Epic 15: Analysis Artifacts and Provenance |
| [#229](https://github.com/IgorK834/researchhub/issues/229) | Zamknięte | [Task 20.4] Split the general CI workflow from the security regression workflow | Epic 20: Continuous Integration |
| [#230](https://github.com/IgorK834/researchhub/issues/230) | Zamknięte | [Task 21.15] Define the Azure Monitor dashboard and alert rules as code | Epic 21: Azure Infrastructure and Deployment |
| [#231](https://github.com/IgorK834/researchhub/issues/231) | Zamknięte | [Task 21.16] Record immutable deploy identity for every deployment | Epic 21: Azure Infrastructure and Deployment |
| [#232](https://github.com/IgorK834/researchhub/issues/232) | Otwarte | [Task 21.17] Use Managed Identity for Azure Blob and PostgreSQL access | Epic 21: Azure Infrastructure and Deployment |
| [#233](https://github.com/IgorK834/researchhub/issues/233) | Zamknięte | [Task 22.4] Select the demo AI model from evaluation results | Epic 22: AI Evaluation |
| [#234](https://github.com/IgorK834/researchhub/issues/234) | Otwarte | [Task 24.6] Add CSL citation styles and a generated reference list to export | Epic 24: Advanced Source and Research Workflows |
| [#235](https://github.com/IgorK834/researchhub/issues/235) | Otwarte | [Task 24.7] Add DOI metadata prefill through Crossref | Epic 24: Advanced Source and Research Workflows |
| [#236](https://github.com/IgorK834/researchhub/issues/236) | Zamknięte | [Task 26.5] Write ADRs for shared state, durable processing and export | Epic 26: Developer Experience and Documentation |
| [#237](https://github.com/IgorK834/researchhub/issues/237) | Zamknięte | [Task 26.6] Write ADRs for deployment topology, collaboration scale-out, retention and the Azure sandbox | Epic 26: Developer Experience and Documentation |
| [#238](https://github.com/IgorK834/researchhub/issues/238) | Zamknięte | [Task 26.7] Triage and re-scope stale backlog issues | Epic 26: Developer Experience and Documentation |

