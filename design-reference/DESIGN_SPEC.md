# ResearchHub — Design Specification

Structured extraction of `design-reference/ResearchHub Design System.pdf` (54 pages) for use by future implementation sessions.
**Status: analysis only. No application code was changed to produce this document.**

---

### Contents & suggested reading order

| § | Section | Read when |
|---|---|---|
| 0 | How to read this document (scale, confidence tags, PDF page map) | Always, first |
| 1 | Design tokens — color, type, spacing, radii, elevation, icons, illustration, dark mode, CSS variables | Always |
| 2 | Shared UI components — buttons, inputs, cards, tables, badges, citations, navigation, modals/popovers, feedback, avatars, status | Always for UI work |
| 3 | Application layouts — Shells A/B/C/D, IA, role matrix | Always for page-level work |
| 4 | Screens (37) — per-screen purpose/layout/components/states/interactions/spacing + PDF page | Only the screens being touched (use Appendix A to find them) |
| 5 | Reusable patterns — provenance, citations, AI scope, feedback states, empty states, tone | When building anything AI/evidence/state related |
| 6 | Desktop & responsive behavior | When touching layout/breakpoints |
| 7 | User flows | When validating end-to-end journeys |
| 8 | Interaction & motion inventory | When adding behavior |
| 9 | Ambiguities, inconsistencies, gaps in the PDF | **Before** making a judgment call |
| A/B | Screen → page index, Component → page index | Lookup |

> Emoji/symbols used in this text (📖 ✦ ⌘ ⬇ ↥ ▷ ✓ ✕ …) are shorthand for icons from the icon set (§1.6), not literal glyphs to ship.
> To compare against the original, open the page named in each section (`design-reference/ResearchHub Design System.pdf`, 1-based).

## 0. How to read this document

### 0.1 Source and method

- **Source file:** `design-reference/ResearchHub Design System.pdf` (title "ResearchHub Design System", 54 pages). Note: the actual filename contains spaces, not hyphens.
- **The PDF is raster, not vector.** Every page is one 4× JPEG with an invisible OCR text layer. So all labels, copy and token values below come from the OCR text and were visually cross-checked; all sizes/colors that are *not* printed in the PDF were measured from pixels.
- **Render scale = 0.75.** Pages are drawn at 75 % of real CSS px (verified: the page labelled "1280 px" is 960 wide; the "right 340 px" context panel measures 254; type-scale glyph heights are consistent with 0.75×). **Every dimension in this spec is in real design px (PDF px ÷ 0.75)** unless it says "pdf px".
- **Reference viewports:** auth + dashboard-style pages = 1440 wide (PDF 1080); editor / Ask-AI / analysis pages = 1600 wide (PDF 1200); responsive example = 1280 wide (PDF 960).

### 0.2 Confidence tags

| Tag | Meaning |
|---|---|
| **[S]** | Stated explicitly in the PDF (a label, token value, rule). Authoritative. |
| **[M]** | Measured from pixels, converted to design px. Accurate to about ±2 px / ±1 hex digit. |
| **[I]** | Inferred from how the design looks or behaves. Treat as a sensible default, not a requirement. |

Untagged descriptive text is directly observed in the screens.

### 0.3 PDF page map

| Pages | Content |
|---|---|
| 1 | Brand board (hero, mood-board "UI fragments", palette, type, components). **Non-normative** — see §9 |
| 2 | Design tokens (colors, type scale, radius/spacing, elevation, dark map) |
| 3 | Information architecture, contextual AI surfaces, role access, scaling rules |
| 4 | Illustration kit + character language + animation rules |
| 5 | Components — core UI (buttons, inputs, navigation, feedback, badges, avatars, loading) |
| 6 | Components — research objects (cards, citations, AI, editor, analysis components) |
| 7 | States — system feedback (autosave, permissions, processing, runs, AI answers, skeletons) |
| 8 | States — empty |
| 9–10 | Login, Register |
| 11–13 | Home (populated, empty), Create workspace |
| 14–20 | Workspace Overview, Activity (+Notifications), Documents, Members, Search, Settings (+Archive), User settings |
| 21 | AI debugger (internal) |
| 22–28, 35, 44 | Document editor and its panels/dialogs |
| 29–32, 34, 45 | Sources: library, upload, PDF reader, spreadsheet viewer, ask-this-source, 1280 px layout |
| 33, 36, 37 | Ask AI: workspace answer, compare sources, evidence on a claim |
| 38–43 | Analyses: list, create, running, failed, result, provenance |
| 46–49 | Four user flows |
| 50, 51, 54 | Slices of the shell (sidebar, top bar, editor frame) |
| 52 | Icon set (80 icons) |
| 53 | "Ask. Check. Cite." lock-up |

---

## 1. Design tokens

### 1.1 Color

Palette idea [S]: *"Warm off-white ground, near-black ink, five balanced accents. Accents tint, border and mark — they are never body-text colors."* Minimum text contrast 4.5:1. Dark-mode ready.

#### Brand accents [S unless noted]

Each hue has: **base** (fills, illustrations, stickers, avatars), **tint** (chip/card/callout backgrounds), **ink** (text and icons on a tint — the only accent form allowed for text), and an unlabeled **mid-tint** swatch **[M]**. **Which tint where [M, sampled]:** *mid-tint* = icon-tile fills, source-type chips (PDF/XLSX/TXT…), document-status chips (Draft/In review), stickers' hover/emphasis and borders; *tint* = large surfaces — callouts, banners, processing-status chips (Ready/Processing/Failed/Uploaded), cards such as AI/uncertainty/contradiction blocks, illustration panels.

| Token | Base | Tint | Mid-tint [M] | Ink | Meaning [S] |
|---|---|---|---|---|---|
| `brand-blue` ("Sky") | `#8CC8FF` | `#E8F4FF` | `#D1EAFF` | `#1F6AA8` | Sources · navigation · info |
| `brand-coral` | `#FF8F87` | `#FFEDEB` | `#FFDCDA` | `#B8352C` | PDF · attention · people |
| `brand-lavender` | `#DDB8FF` | `#F5ECFF` | `#EBD9FF` | `#6B3FA0` | AI · notes · generated |
| `brand-mint` | `#B7E7C1` | `#E6F6EA` | `#D8F1DE` | `#1F6B3A` | Datasets · evidence · done |
| `brand-yellow` | `#FFD166` | `#FFF4D6` | `#FFE9AD` | `#7A5600` | Insight · highlight · question |

#### Neutrals [S]

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `background` | `#FBF9F5` | App ground | — |
| `surface` | `#FFFFFF` | Cards, paper | — |
| `surface-muted` | `#F5F2EC` | Wells, sidebar/rail, table headers, hover | — |
| `border` | `#ECE8E0` | Hairlines, card borders | — |
| `border-strong` | `#D9D3C7` | Input borders | — |
| `text-primary` | `#1B1A17` | Body, headings, primary-button fill ("ink") | 16:1 |
| `text-secondary` | `#5E5A52` | Descriptions, meta | 6.5:1 |
| `text-muted` | `#77726A` | Placeholders, captions, counts | 4.5:1 |

#### Status [S]

| Token | Base | Ink | Typical tint |
|---|---|---|---|
| `success` | `#2F8F5B` | `#1F6B3A` | brand-mint tint |
| `warning` | `#E0A100` | `#7A5600` | brand-yellow tint |
| `error` | `#D9483B` | `#B8352C` | brand-coral tint |

Status is **never color-only**: every status carries an icon *and* a word [S].

#### Content origin (provenance bars) [S]

Used as a 3 px left bar on paragraphs/blocks, and in the legend card at the bottom of the editor sidebar.

| Origin | Bar | Icon (token page) |
|---|---|---|
| Human written | none *(but the editor legend draws an ink/black swatch — see §9)* | pencil |
| AI generated | lavender bar | sparkle |
| AI rewritten | **dashed** lavender bar | refresh |
| Imported | blue bar | download |
| Source-derived claim | mint bar | book |
| Analysis-derived claim | yellow bar | lineChart |

#### Source types — icon + label + tint [S]

| Type | Label chip | Tint | Icon [M] |
|---|---|---|---|
| PDF | `PDF` | coral | file |
| Word document | `DOCX` | blue | text |
| Spreadsheet | `XLSX` | mint | table |
| Delimited data | `CSV` | mint | grid |
| Plain text | `TXT` | yellow | text |
| Image | `IMG` ("Image") | lavender | image |
| Scientific paper | `PAPER` | blue | book |
| Web | `Web` | blue | globe |
| Note | `Note` | lavender | note |

#### Other measured colors

| Purpose | Value |
|---|---|
| Modal scrim | ink `#1B1A17` at ≈ 42 % over everything including sidebar/top bar **[M]** |
| Text-selection highlight (editor/PDF) | pale blue `≈#CFE6FB` for selection; yellow tint/mid-tint for evidence highlight and search-term `<mark>` **[M]** |
| Diff: added | mint tint bg + mint-ink underline · removed: coral tint bg + coral-ink strikethrough **[M]** |
| Sidebar/rail background | `surface-muted` (`#F5F2EC`) |
| Primary button hover | ≈ `#3A3833` (also the dark-mode border token) **[M]** |
| Primary button disabled | ink at ≈ 40 % → renders ≈ `#A4A3A1` **[M]** |
| Danger button / hover | ≈ `#B93529` (= error-ink) / ≈ `#912B29` **[M]** |

### 1.2 Typography

| Family | Use |
|---|---|
| **Plus Jakarta Sans** [S] | All UI and headlines. Weights: 800 display/H1, 700 H2/H3/card titles, 600 UI labels, 500 captions/medium UI, 400 body |
| **Source Serif** [S] | "Paper titles" — document titles, document names in lists/cards, quoted source passages (italic) |
| Monospace [I; face not named] | Code panel, hashes, chunk IDs, request IDs, token counts |
| Handwritten script [I; face not named] | Illustration captions and margin notes only ("Ask. Check. Cite.", "Read. Question. Cite.", "data points will enter one by one…", "about 10 minutes, no setup", the yellow sticky note "supports claim [1] in Lab Report") |

#### Type scale [S] (size px / weight)

| Token | Spec | Sample in PDF |
|---|---|---|
| Display | 56 / 800 | "Collaborative research" |
| H1 | 32 / 800 | "Electronics Lab — Team 4" |
| H2 | 24 / 700 | "Theoretical Background" |
| H3 | 18 / 700 | "Evidence for this claim" |
| Body | 15 / 400 | "Efficiency falls as cell temperature increases." |
| UI label | 13 / 600 | "Ask workspace · Find evidence · Add citation" |
| Caption | 12 / 500 | "smith_2025.pdf · page 14 · updated today" |
| Paper title | Source Serif 28 | "Effect of Temperature on Photovoltaic Cell Efficiency" |

#### Sizes actually used on screens **[M]** (approximate ±1–2 px — they differ from the scale in places)

| Element | Size / weight |
|---|---|
| Auth page title ("Welcome back.") | ≈ 38 / 800 |
| Workspace page title (Overview "Electronics Lab — Team 4") | ≈ 38–40 / 800 |
| Page titles (Documents, Members, Sources, Analyses, Home greeting) | ≈ 34–36 / 800, tight tracking [I: ≈ −0.02 em] |
| Section heading ("Continue working", "Recent workspaces") | 18 / 700 |
| Card title (workspace/AI-activity card, panel headings) | 16 / 700 |
| Document/serif list titles | Source Serif 16–18 / 600–700 |
| Editor document title | Source Serif ≈ 36 / 700, line-height ≈ 40 |
| Editor body | 16 / 400, line-height ≈ 27 |
| Editor H2 ("2. Theoretical Background") | ≈ 22 / 700 |
| Sidebar item, table cell title, buttons | 13 / 600 (titles in table cells 14 / 700) |
| Meta / caption / chip text | 12 / 500–700 |
| Micro-label (UPPERCASE) e.g. "SELECTED PARAGRAPH", "WORKSPACE", table headers | 11 / 700, letter-spacing ≈ +0.06 em, `text-muted` |
| Code | mono 12 / 18, with line numbers |

### 1.3 Spacing [S]

Scale: **4 · 8 · 12 · 16 · 24 · 32 · 48 · 64**.

Observed use **[M]**: page content padding 40 (left/right) · card/grid gap 16 · section gap 24–32 · card inner padding 16–20 · control-to-control gap 8 · chip gap 6–8 · sidebar padding 12 · top bar height 56.

### 1.4 Border radii [S]

| Token | px | Typical use [M/I] |
|---|---|---|
| `sm` | 6 | small tags, inline citation chips, tiny tiles |
| `md` | 10 | **controls** (buttons, inputs, selects — "Controls are 34–38 px tall, radius 10, hairline borders" [S]), chips/badges, menu items, icon tiles |
| `lg` | 16 | cards, panels, table containers, toolbars |
| `xl` | 24 | modals, hero illustration panels, auth illustration panel, toasts/banners that float |
| `pill` | 999 | avatars, stacks, presence pills, filter chips on some screens, count bubbles |

### 1.5 Elevation & focus

| Level | Spec [S] | Used for | Inferred shadow [I] |
|---|---|---|---|
| e0 flat | cards at rest — **border only** | cards, list rows, panels | none |
| e1 lifted | selected rows, toolbar | selected sidebar item, floating format toolbar, segmented thumb | `0 1px 2px / 0 2px 8px` at ~6–8 % ink |
| e2 popover | menus, citation popover | context menus, notifications, selected-sources popover | `0 8px 24px` at ~10 % ink (measured fade ≈ 15 px) |
| e3 modal | dialogs, command palette | all modals, search overlay | `0 24px 64px` at ~16–18 % ink (measured fade ≈ 40+ px) |

**Focus [S]:** *2 px ink ring with 2 px gap on controls; 3 px sky halo on text fields.* Text-field focus also gets a 1 px ink border **[M]**. Halo ≈ brand-blue at ~45 % **[I]**.

### 1.6 Iconography [S]

- 24 px grid · 1.75 px rounded stroke · inherits `currentColor`. *"Functional icons stay systematic; hand-drawn art lives in illustrations only."*
- Rendered sizes **[M]**: 14–16 px in buttons/chips/inputs, 16–18 px in navigation and rows, 20 px inside tinted icon tiles.
- **Icon tile:** square 22–40 px, radius `md`, **`mid-tint`** background, `ink`-colored icon (e.g. coral doc tile in lists, mint table tile, lavender sparkle tile). Selected sidebar items put the icon in a *base-colored* tile (see §3.2).
- **Inventory (80):** search, home, book, library, file, text, note, sparkle, chart, lineChart, scatter, users, user, sliders, help, plus, minus, chevDown, chevUp, chevRight, chevLeft, sort, check, x, upload, download, link, quote, comment, clock, history, calendar, folder, table, grid, code, terminal, play, refresh, more, arrowRight, arrowLeft, arrowUp, arrowDown, pencil, highlight, trash, lock, key, shield, eye, bell, bold, italic, heading, list, undo, redo, image, globe, filter, star, warn, alert, info, flask, layers, columns, bookmark, send, database, panel, mail, logout, archive, copy, external, wifi, wifiOff, cursor.

Usage mapping observed **[M]**:

| Concept | Icon |
|---|---|
| Home / Workspaces | home / library |
| Search | search |
| Overview / Documents / Sources / Ask AI / Analyses / Members | grid / file / book / sparkle / lineChart / users |
| Settings / Help / Notifications / Log out | sliders / help / bell / logout |
| Citation / quote | quote |
| Processing / Uploaded / Ready / Failed | refresh / upload / check / alert |
| Queued / Running / Completed / Failed (analysis) | clock / refresh / check / alert |
| Warning banner / info | warn / info |
| Grounded | shield |
| Owner / Editor / Viewer | key / pencil / eye |
| Version history / Restore | history |
| Open external / copy | external / copy |
| Offline | wifiOff |
| Collaborator cursor | cursor |

### 1.7 Illustration & motion [S]

- **Style:** black line art with slight hand wobble; flat pastel fills from the five brand colors; simple separated objects; **2.6 px ink line, no textures**. Characters: varied hair/face shapes/glasses/posture, minimal faces ("two dots and a line"), original.
- **12 scenes and where they are used:**

| Scene | Used for |
|---|---|
| Researcher + cat | Hero / brand |
| Setting up the desk | No workspaces (Home empty); Overview hero |
| Blank page | No documents |
| Carrying files | No sources; Upload dialog drop-zone |
| Empty chart | No analyses; Analysis failed |
| Magnifier + papers | No results (search) |
| Pinned notes | No evidence; Evidence-on-a-claim hero |
| Armchair reader | Login |
| Two at a laptop | Register |
| Looking closer | Find evidence |
| Typing a draft | Generate |
| Idea bulb | AI thinking; Analysis running ("You can leave this page") |

- **Built to animate** (each object is its own layer; motion short, one-shot, never looping long): Character blink — eyes scale-Y to 0.1 for 120 ms every 5–7 s · Floating paper — rises 6 px and tilts 3° over 2.4 s, once on arrival · Highlight — wipes left→right over 400 ms when evidence is found.
- **Stickers** (decorative callouts): saturated *base*-color pill, ink bold 12–13 px text, radius ≈ 10, no border, rotated ≈ ±2–3°. Examples: "Grounded in 12 sources" (yellow, in sidebar and headers), "New evidence" (sky), "Analysis ready" (mint), "3 collaborators" (lavender), "Needs citation" (coral), "Open question" (yellow), "2 new comments" (lavender). Use sparingly (≈ 1–2 per screen header).

### 1.8 Dark mode token map [S]

*"Warm graphite, off-white text, the same five hues in muted pastel. No neon, no pure black."*

| Token | Dark |
|---|---|
| background | `#1C1B19` |
| surface | `#252421` |
| surface-muted | `#2E2C28` |
| border | `#3A3833` |
| text | `#F3F0E8` |
| blue | `#7DB4E6` |
| coral | `#E8837C` |
| lavender | `#C4A0EC` |
| mint | `#9CD3A8` |
| yellow | `#E8BE5E` |

Only the token map plus one light/dark pair of a source row (p2) and the Appearance previews (p20) exist; there are **no full dark screens**. Appearance setting: Light / Dark / System. Tinted chips in dark mode become dark tints of the hue with a light hue-colored label (see the `PDF` / `Grounded` / `[1]` chips on p2) **[M]**. Dark tints/inks beyond the table are **not specified [I]**.

### 1.9 Token reference as CSS custom properties

Convenience transcription of the tokens above (not code from the app):

```css
:root {
  --bg: #FBF9F5; --surface: #FFFFFF; --surface-muted: #F5F2EC;
  --border: #ECE8E0; --border-strong: #D9D3C7;
  --text: #1B1A17; --text-secondary: #5E5A52; --text-muted: #77726A;

  --blue: #8CC8FF;     --blue-tint: #E8F4FF;     --blue-mid: #D1EAFF;     --blue-ink: #1F6AA8;
  --coral: #FF8F87;    --coral-tint: #FFEDEB;    --coral-mid: #FFDCDA;    --coral-ink: #B8352C;
  --lavender: #DDB8FF; --lavender-tint: #F5ECFF; --lavender-mid: #EBD9FF; --lavender-ink: #6B3FA0;
  --mint: #B7E7C1;     --mint-tint: #E6F6EA;     --mint-mid: #D8F1DE;     --mint-ink: #1F6B3A;
  --yellow: #FFD166;   --yellow-tint: #FFF4D6;   --yellow-mid: #FFE9AD;   --yellow-ink: #7A5600;

  --success: #2F8F5B; --success-ink: #1F6B3A;
  --warning: #E0A100; --warning-ink: #7A5600;
  --error:   #D9483B; --error-ink:   #B8352C;

  --r-sm: 6px; --r-md: 10px; --r-lg: 16px; --r-xl: 24px; --r-pill: 999px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;

  --font-ui: "Plus Jakarta Sans", system-ui, sans-serif;
  --font-paper: "Source Serif 4", "Source Serif Pro", Georgia, serif;

  --scrim: rgba(27, 26, 23, .42);              /* [M] */
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--text);   /* [S] 2px ring + 2px gap */
  --focus-halo: 0 0 0 3px rgba(140, 200, 255, .45);           /* [S] 3px sky halo; alpha [I] */
}
[data-theme="dark"] {
  --bg: #1C1B19; --surface: #252421; --surface-muted: #2E2C28; --border: #3A3833; --text: #F3F0E8;
  --blue: #7DB4E6; --coral: #E8837C; --lavender: #C4A0EC; --mint: #9CD3A8; --yellow: #E8BE5E;
}
```

---

## 2. Shared UI components

General rules [S]: real `<button>`, `<input>`, `<a>` elements (p5 badge) · controls are **34–38 px tall, radius 10, hairline borders** · never color-only status · viewers never see disabled buttons — controls they cannot use are **absent** (see §5.15).

Control heights observed **[M]**: compact/top-bar buttons 34 · default buttons 36 · inputs & selects 40 · small in-row buttons ("Cite", "Resend", "Ask source") 30 · large auth/CTA controls 44.

### 2.1 Buttons (p5; applied throughout)

| Variant | Default | Hover | Focus | Disabled |
|---|---|---|---|---|
| **Primary** (e.g. "Create") | ink fill `#1B1A17`, white 13/600 text | lighter graphite ≈ `#3A3833` | default + 2 px ink ring, 2 px gap | ink @ ~40 % (≈ `#A4A3A1`) |
| **Secondary** ("Download") | white fill, 1 px `border-strong`, ink text | `surface-muted` fill | ring | text `text-muted`, lighter border, no fill change |
| **Ghost** ("Cancel") | no fill/border, ink text | `surface-muted` fill | ring | text muted |
| **Danger** ("Remove") | error-ink fill ≈ `#B93529`, white text | darker ≈ `#912B29` | ring | ~40 % opacity |
| **Danger soft** ("Archive") | coral tint fill + coral border, error-ink text | stronger coral mid-tint | ring | very faint |

- **Icon buttons** (34 × 34, radius 10): primary (ink, "+"), secondary (white + border, download), ghost ("···"), soft-lavender (sparkle = AI), soft-coral (trash = destructive).
- **Busy button** "Running…": graphite `#3D3C3A` fill, white text, rotating `refresh` icon, same size as the idle button **[M]**.
- **Leading icon** 14–16 px + 6–8 px gap ("+ New document", "↥ Upload source", "✦ Ask AI", "▷ Run analysis").
- **Destructive confirmation pattern:** the final action in a destructive *confirm modal* is still the **ink primary** ("Archive workspace") when the action is reversible; **Danger red** is used for the irreversible "Remove" (member). Cancel/Keep is Secondary.
- **Pair order:** `[Cancel (secondary)] [Primary]`, right-aligned in dialogs/footers; primary left of secondary in empty states ("Create workspace" then "Learn how ResearchHub works").

### 2.2 Inputs (p5)

| Component | Spec |
|---|---|
| **Text input** | 40 px (auth: 44), radius 10, 1 px `border-strong`, white fill, 14–15 px text, placeholder `text-muted`. Label above, 13/600, 6 px gap. |
| **Focus** | 1 px ink border + 3 px sky halo ("Email · focus"). A caret is shown. |
| **Error** | 1 px error/coral border; below it a 12 px error-ink message prefixed by an alert icon (e.g. `Use at least 10 characters.`). |
| **Disabled / read-only** | `surface-muted` fill, `text-muted` text ("Owner only"; profile email). |
| **Search input** | Leading `search` icon, placeholder "Search papers, datasets, notes…", trailing `⌘K` keycap chip. |
| **Select** | Same box as input, trailing `chevDown`; value in 600 weight ("Editor"). Opens an e2 popover list. Compact select with leading icon + label ("Status: all", "Uploaded by: anyone"). |
| **Textarea** | Same chrome, ≈ 90–120 px min-height, placeholder "Describe what this workspace is for…". |
| **Combobox (sources)** | Input containing selected **chips** (`instructions.pdf` in PDF-coral) + free text ("lec") with sky-halo focus; dropdown (e2): rows = type tile + name with the **matched substring highlighted in yellow** + right-aligned meta ("PDF · 24 pages"); first/active row on `surface-muted`. |
| **Checkbox** | 18 px square, radius 6, `border-strong`; **checked = mint tint + mint-ink check + mint border** (p6 source selection, p34 scope list, p24 sources to use). |
| **Segmented control** | `surface-muted` track (radius 10), selected = white pill with e1 + ink text ("Required / Where possible / Off", "This source / Selected / All 12"). |
| **Toggle switch** | Ink track, white thumb (p44 "Include source reference"). |
| **Slider** | Lavender track, white thumb with 2 px ink ring; min/max labels below ("~150 … ~1500"), value label above right ("~700 words") (p24). |
| **Choice cards** | Role picker "Editor / Viewer" (selected = lavender tint + ink-ish border + icon), theme picker "Light / Dark / System" (selected = 2 px ink border + check in ink circle). Insert-result format cards (selected = 2 px ink border + check). |
| **Color swatch picker** | 28 px rounded swatches in the five base colors; selected = ink 2 px ring + check; followed by a divider and 4 icon-choice tiles (book, flask, chart, sparkle). |
| **Password strength** | 4 segments (mint, mint, yellow, neutral) + caption "Strength: fair. Add a number or symbol." |
| **Prompt input (AI)** | Card containing scope chip ("📖 Ask across 12 sources ⌄"), multi-line text, footer row: "Citations required" caption + ink square send button (arrowUp) (p6). |
| **Comment composer** | Card: quoted selection (yellow left bar), textarea "Write a comment, or @mention a teammate…", `user` icon (mention) + primary "Comment". |

### 2.3 Cards (p6, plus in-screen)

Base card: white, 1 px `border`, radius 16 (modals 24), **e0**, padding 16–20. Cards "exist only for real objects: workspace, document, source, analysis, suggestion, comment. Everything cites its origin." [S] Layout inside cards = tile/avatar + title + meta + chips.

| Object card | Anatomy |
|---|---|
| **Workspace** | Top banner (~80 px) in accent tint — either illustration or a letter/icon tile (e.g. "S" blue, "T" yellow) · title 16/700 · 2-line description 13 `text-secondary` · footer: avatar stack + "8 sources · 2 docs" · relative time right/below. |
| **Document** | Coral doc tile · **serif** title · "Kasia · edited today 11:20" · skeleton lines (preview) · chips `Draft` + `v14 · 2 manual`. |
| **Source** | Type tile · filename 700 · "Smith et al. (2025) · 24 pages" · chips `PDF` `Ready` · avatar + "Kasia · 3 days ago" · right "Used in 4 places". |
| **Analysis** | Label "Analysis #17" + `Completed` chip · title · mini sparkline (blue line, ink dots) · "measurements.xlsx" · "Table + chart · 12:42". |
| **Suggestion** | Lavender tint card: sparkle + "Improve writing", old text in coral strikethrough on coral tint, new text in mint-ink underline on mint tint, buttons `Accept` (primary) `Reject` (secondary) `Edit` (ghost). |
| **Comment thread** | Yellow (open) or blue left bar, quoted anchor text, avatar + name + time, text, `Reply` / `✓ Resolve` text buttons. |
| **Source-status row card** | Tile + name + meta + status chip + one bounded sentence (p30). |

Row/List card variants: **list-row** = hairline-divided rows inside one card (activity, recent docs, sources); **evidence item** = tinted block (mint when evidence, blue-tint for source quote, yellow for uncertainty, coral for contradictory).

### 2.4 Tables (p16, p29, p21, p32, p38, p42, p43, p36)

- **Container:** white card, radius 16, 1 px border, overflow hidden. Optional footer line (caption).
- **Header row:** `surface-muted`, ≈ 35 px tall, uppercase 11/700 muted labels (NAME, TYPE, UPLOADED BY, DATE, STATUS…).
- **Body rows:** hairline dividers; ≈ 57 px (sources), ≈ 70 px (documents/members); first cell = icon tile (32–40) + title 14/700 (serif for documents) + 12 px muted subline.
- **Row hover:** reveals row actions ("Open", "···", Rename, Archive) — documented in a caption under the table [S]. **Selected/active row:** 3 px ink bar on the left edge (+ `surface-muted`) (search result, source in 1280 list).
- **Cited/highlighted rows** (spreadsheet): yellow-tint rows with a 3 px yellow-ink left bar, footer chip "Rows 14–28 cited".
- **Spreadsheet table:** column header shows a type badge (`123` mint number, `abc` yellow text) + name + unit in muted second line; first column `#` row numbers; cells 14 px; zebra none.
- **Comparison grid (p36):** sticky first column (row labels with chevron to collapse), one column per source; each cell has a citation chip (`p.14`, `sl.6`); a contradiction cell is tinted yellow.
- **Result table (p42):** the *new/calculated* column has a yellow-tint header ("impedance (Ω) · new") and bold yellow-tint cells.
- **Virtualization:** with 300 sources the list virtualizes, folders appear as chips above the tabs [S].

### 2.5 Badges & chips (p5)

All chips: height ≈ 26 (compact 22), radius ≈ 10 (`md`) **[M]**, 12/700 text, leading 12–14 px icon, 8–10 px horizontal padding. **Fill rule [M]:** source-type, role (Editor), document-status and research-label chips use the hue's **mid-tint**; processing-status and analysis-execution chips use the lighter **tint** + a 1 px hue border.

| Group | Variants (icon · fill) |
|---|---|
| **Source type** — icon + label | PDF (file · coral tint) · DOCX (text · blue) · XLSX (table · mint) · CSV (grid · mint) · TXT (text · yellow) · Image (image · lavender) · Paper (book · blue) · Web (globe · blue) · Note (note · lavender) |
| **Processing status** (1 px border in hue) | Uploaded (upload · neutral `surface-muted` + `border-strong`) · Processing (refresh · yellow tint + yellow border) · Ready (check · mint tint + mint border) · Failed (alert · coral tint + coral border) |
| **Roles** | Owner (key · **ink fill, white text**) · Editor (pencil · lavender mid-tint) · Viewer (eye · `surface-muted`) |
| **Research labels** | Grounded (shield · mint) · Needs citation (quote · yellow) · AI generated (sparkle · lavender) · Open question (help · yellow) · New evidence (star · blue) |
| **Document status** | Draft (yellow) · Notes (lavender) · In review (blue) |
| **Evidence summary** | "14 cited · 2 need citation" (yellow) · "5 saved evidence" (mint) · "6 cited" (mint) · "4 citations" (mint) · "2 saved evidence" (yellow) |
| **Analysis execution** | Queued (clock · neutral) · Running (refresh · yellow) · Completed (check · mint) · Failed (alert · coral) |
| **Counts** | Superscript-style number after label in tabs/nav (`All 12`, `PDF 6`), `text-muted` |
| **Citation chip `[n]`** | See §2.6 / §5.2 |
| **Cell-type badge** | `123` (mint) / `abc` (yellow) in spreadsheet column headers; `#17` yellow circle / `[2]` blue circle in activity |
| **Sticker** | See §1.7 |

### 2.6 Citations (p6, p25, p33)

- **Inline chip:** small `sm`-radius blue-tint chip with a number ("1") placed right after the cited sentence, preceded by a thin space; ink digit 11/700. Hover/click opens the **citation popover**.
- **Chip variants** (reference lists / panels): `1 smith_2025.pdf · p. 14` (blue), `2 lecture_05.pdf · p. 22` (blue), `3 measurements.xlsx · rows 14–28` (**mint**), `4 Analysis #17` (**yellow**). Color tracks the source type (document=blue, dataset=mint, analysis=yellow).
- **Citation popover (e2, ≈ 290 px):** blue number chip + bold "Smith et al. 2025" + muted "smith_2025.pdf · page 14"; yellow-tint quote block in **serif italic** with highlighted phrase ("…conversion efficiency fell by 0.41 % per kelvin over the 25–75 °C range…"); actions `Open source` · `View context` (secondary) · `Replace` (ghost).
- **Locator chips** in Compare grid: `p.8`, `sl.4` (slides), rows for spreadsheets.
- **Citation-pending/needs-citation:** `Needs citation` yellow chip; "Sentences without support are marked 'Needs citation' instead of being invented" [S].

### 2.7 Navigation

| Component | Spec |
|---|---|
| **Sidebar item** (p5) | 36 px tall, radius 10, 8–10 px padding, icon (16–18) + label 13/600 + right-aligned count (`12`, muted). **Default:** transparent. **Hover:** fill slightly darker than the sidebar ground **[I; ≈ `#EFEBE2` — not separable from the PDF pixels]**. **Selected:** white fill + 1 px border + e1, and the icon sits in a 24 px **base-colored tile** (see §3.2 color per section). Item pitch 40. |
| **Rail item** (≥1600 tool pages) | 36 px square icon button in a 64 px rail; selected = white tile with e1 + colored icon tile. |
| **Breadcrumbs** | `text-muted` 13 px segments joined by `chevRight`; current segment ink 700 ("Electronics Lab — Team 4 › Sources › **smith_2025.pdf**"). Long workspace names truncate/wrap in the sidebar switcher, not in the top bar. |
| **Tabs — type filter** | Text tabs with muted count (`All 12  PDF 6  DOCX 2  Spreadsheet 3  Text 1`); active = ink 700 with a 2 px ink underline sitting on a full-width hairline. Used on Documents (All/Mine/Archived), Sources, Search (as chips), Panels (Sources / Provenance / Comments). |
| **Filter chips** | White chip + 1 px border, radius 10–12 [M]; **active = ink fill + white text** (Search "All 11"; Analyses "All 17"). Count in muted. |
| **Context menu** (e2, ≈ 170–190 px) | Rows 32 px with leading icon + label, right shortcut/hint (`↵`, `⌘J`, `F2`, `current`); first row hover on `surface-muted`; destructive row last, red label + red icon ("Archive"). Divider above "Make owner…" in role menu; check mark on current role. |
| **Workspace switcher** | Card in the sidebar: coral letter tile "E", name (truncated "Electronics L…"), "Owner · 3 members" caption, up/down `sort` chevron. |
| **Section label** | "WORKSPACE", "DOCUMENTS", "OUTLINE", "SAVED", "EARLIER" — 11/700 uppercase muted. |
| **Pagination / navigator** | PDF page stepper: `‹ 14 / 31 ›` in a bordered pill; zoom select "110% ⌄". |

### 2.8 Modals, popovers, drawers

| Surface | Spec |
|---|---|
| **Modal** | White, radius 24, e3, over ink scrim ≈ 42 %. Header: title 24/800 (+ optional icon tile) and 14 px `text-secondary` sub-line; close `x` (ghost icon) top-right on larger dialogs; footer actions right-aligned (Cancel secondary + primary). Padding 28–32. Widths **[M]**: confirm ≈ 430 (p5) / ≈ 600 (Archive, p19) · Insert result ≈ 720 (p44) · Upload ≈ 880 (p30) · Create workspace ≈ 780 two-pane (p13). Esc closes, focus is trapped [I]. |
| **Confirm dialog** | Title question + one calm sentence + (optional) mint "nothing is deleted" callout + `Cancel` / action. Example copy is part of the spec (see §5.17). |
| **Popover** | e2, radius 12–16, white, 1 px border; used for citation popover, context menu, notification list (≈ 400 px), selected-sources list. |
| **Slide-over** (≤1280) | Right-anchored panel replacing a docked context panel, ≈ 420 px wide, full height, white, left border, close `x` (p45). |
| **Floating toolbar** | Dark ink pill (radius 10–12, e2) with ghost icon+label buttons in white text; first (active) action has graphite fill. Editor selection toolbar: Improve writing · Shorten · Expand · Explain · Find evidence · Check claim · Add citation (p23). Reader selection toolbar: Cite · Ask AI · Add to document · Save evidence (p31). Generic: Improve · Shorten · Expand · Evidence · Cite (p6). |
| **Command search** | See Screen 10 (p18). |
| **Tooltip** | **Not shown in the PDF.** Closest patterns are the citation popover and the row-action captions. If needed [I]: ink fill, white 12/600 text, radius 6, e2, 6 px offset, appears on hover/focus after ~300 ms, never the only carrier of information. |

### 2.9 Feedback — banners, toasts, callouts (p5, p7)

| Pattern | Spec |
|---|---|
| **Toast — success/info** | White card, border, e2; mint **icon tile** with check; bold title ("measurements.xlsx is ready"), muted meta ("3 sheets · 42 rows read"); secondary action `Open`. |
| **Toast — error/blocking** | **Ink fill**, white text; coral icon tile; bold title ("Save failed"), body ("We'll keep trying. Your text is safe on this device."), underlined white action `Retry now`. Same ink treatment for the offline bar and the viewer "Only editors can change this document" toast (bottom-right, lock tile, ≈ 390 px wide [M]). |
| **Inline banner — warning** | Yellow tint + yellow border + `warn` icon; bold lead + sentence + underlined link ("**Two sources disagree** about the temperature range. **Compare them**"). Also "Conflict" and "Out of date" blocks. |
| **Inline banner — error** | Coral tint + coral border + `alert` icon; "**Analysis could not be completed.** Column 'voltage' contains text values." |
| **Info/permission notice** | `surface-muted` fill, `lock`/`eye` icon, bold lead ("Read-only · You're a viewer in this workspace"). |
| **Success callout** | Mint tint + mint border, bold lead ("No files or documents will be deleted."). |
| **Dashed note** | Transparent, 1 px **dashed** `border-strong`, radius 12; muted explanatory text with a bold lead ("Not in a source? …", "You stay in control. …", "Rules at 1280 px. …", "Strength describes how directly a passage states the claim — not a probability."). Used for rules/explainers — keep non-interactive. |
| **Uncertainty / contradictory callouts** | Yellow tint (UNCERTAINTY) and coral tint (CONTRADICTORY EVIDENCE) with uppercase micro-label and optional link ("Compare sources"). Tone: "warm yellow and coral, **gently — never 'AI error'**" [S]. |

### 2.10 Avatars & presence (p5, p17)

- **Sizes [M]:** 18 / 28 / 36 / 44; circle, base-color fill (member color from the five hues), ink 700 initials ("AN"). Optional photo.
- **Stack:** overlap ≈ 8 px with a 2 px surface-colored ring; collapses to `+N` (`surface-muted` circle) beyond 3–5 [S: "Avatar stack collapses to +N"].
- **Presence pill:** avatar (with 2 px ink ring) + sentence ("Kasia is viewing Methodology" on lavender tint; "Adam is editing Results" on coral tint), pill radius.
- **In-document presence:** colored caret + small colored name label above it ("Adam", "Kasia") and a tinted range for their selection; *"nothing that moves your text"* [S].
- Actor avatars in activity: person → circle with initials; analysis → yellow circle `#17`; citation → blue circle `[2]`.

### 2.11 Status indicators, progress, loading (p5, p7, p30, p40)

| Indicator | Spec |
|---|---|
| **Status chip + sentence** | Always icon + word; failures add **one bounded sentence** and a way forward ("We couldn't read this file. It may be password-protected. Retry · Replace file"). |
| **Autosave** | `Saving…` (neutral chip, spinner; "Spinner next to the title. No toast.") → `Saved · 12:55` (mint chip, quiet check + time, "fades to text") → `Save failed` (coral chip; stays visible; retries automatically) → `Conflict` (yellow chip) [S]. |
| **Linear progress** | 6 px track `surface-muted`, pill; fill sky (upload) or yellow (processing); label row "Uploading 3 of 5 files · 62 %". |
| **Step progress** | 4 segmented bars (mint done, yellow current, neutral next) + "Step 3 of 4 · Running securely". |
| **Pipeline step cards** (p40) | Four cards: DONE (mint tint + check) · DONE · IN PROGRESS (yellow tint + yellow border + spinner + thin progress) · NEXT (white + `–`). |
| **Skeleton** | `surface-muted` blocks keeping the real layout: list (tile + two lines + chip), document (title bar + lines + figure block), analysis result (bar-chart ghost + lines). **Never replace text that is already known** — titles, counts, names appear first [S]. |
| **Offline bar** | Ink bar, `wifiOff` icon, "Offline — reconnecting…" / "Offline — changes are kept on this device · Reconnecting in 8 s · Try now". |
| **Streaming AI answer** | Uppercase lavender "STREAMING" label, text with caret, ghost `Stop` button; "Thinking" = lavender tint card with sparkle + two shimmer lines. |
| **Row icon animation** | Processing file icon "shuffles while it works" [S]. |

---

## 3. Application layouts

Four page shells exist in the PDF. All measures **[M]** at the reference viewport.

### 3.1 Shell A — "Workspace app" (full sidebar) · 1440 reference

Used by: Home, Overview, Activity, Documents list, Members, Search, Settings, User settings, Sources list, Analyses list, and the viewer (read-only) editor (p28).

```
┌────────────┬──────────────────────────────────────────────────────────┐
│  Sidebar   │  Top bar (56 + 1px border)  breadcrumb … avatars · bell · CTA │
│  264 px    ├──────────────────────────────────────────────────────────┤
│  surface-  │  Content: padding 40, scroll area, max ≈ 1096 at 1440      │
│  muted     │                                                          │
│  1px right │                                                          │
│  border    │                                                          │
└────────────┴──────────────────────────────────────────────────────────┘
```

**Sidebar (264 px, full height, sticky; top group scrolls with content, bottom group is pinned):**

| Block | Spec |
|---|---|
| Brand row | 5-petal fan logo (sky, coral, lavender, mint, yellow) ≈ 24 px + "ResearchHub" wordmark ≈ 17/800 [I]; collapse toggle (`panel` icon) right. Height ≈ 40. |
| Workspace switcher | White card, radius 10–12, 1 px border, ≈ 238 × 47; coral letter tile "E" (26), name 13/700 truncated with ellipsis, caption "Owner · 3 members" (role-aware: "Viewer · 3 members"), `sort` chevrons. **No workspace:** replaced by a dashed note — "No workspace yet. Create one to see Documents, Sources and Ask AI here." |
| Global group | `Search ⌘K` (keycap right) · `Home` · `Workspaces`. |
| WORKSPACE group (only when a workspace is open) | Micro-label, then `Overview` · `Documents` (count) · `Sources` (count) · `Ask AI` · `Analyses` (count) · `Members`. Pitch 40, items 36 tall, side padding 12. |
| Sticker | Yellow "✦ Grounded in 12 sources" sticker, rotated ≈ −3°, below the nav group (sidebar-width ≈ 130). Shown whenever a workspace is open. |
| Bottom group (pinned) | `Settings` (sliders) · `Help` (help) · hairline · **user row**: coral avatar 28 + name (two lines "Adam / Nowak") + truncated email "adam.nowak@…" + `···` menu. |
| Active item colors | Selected item = white fill + e1; icon tile fills: **Home** blue · **Search** blue · **Overview** yellow · **Documents** coral · **Sources** blue · **Ask AI** lavender · **Analyses** mint · **Members** yellow · **Settings** lavender (tint-saturated base color tiles; icon in ink). |
| Visibility rules | Viewer role: no `Settings` entry in workspace menu [S, p19]; controls the role can't use are absent. |

**Top bar (56 px, bottom hairline, background `background`):**
left = breadcrumb (see §2.7); right = context-dependent: `AN KW MK` avatar stack · bell icon button (34 px, white, border, with a small coral unread dot) · primary CTA (`+ New workspace` / `+ New document` / `+ Add member` / `↥ Upload source` / `+ New analysis`). On document pages also: `Draft` status chip beside the title, `Read-only` chip for viewers, saved chip, History, Ask AI.

**Content area:** horizontal padding 40; page header = H1 (34–40/800) + one-line `text-secondary` description (+ optional sticker top-right) → toolbar/filters → content. Max readable width ≈ 1096 at 1440; grids (cards/tables) fill that width.

### 3.2 Shell B — "Workspace tool" (rail + secondary column + main + context panel) · 1600 reference

Used by: Document editor (all states except p28), PDF reader, spreadsheet viewer, Ask workspace, Ask-this-source, Compare sources, Evidence on a claim, New analysis, Analysis running/failed/result, Provenance.

```
┌──────┬────────────┬───────────────────────────────────┬──────────────┐
│ Rail │ Secondary  │  Top bar 56: breadcrumb … actions │              │
│ 64   │ column     ├───────────────────────────────────┤ Context panel│
│      │ 240–280    │  Main (scrolls)                   │ 340 px       │
│      │ (optional) │                                   │ (optional)   │
└──────┴────────────┴───────────────────────────────────┴──────────────┘
```

| Part | Spec |
|---|---|
| **Rail (64 px, `surface-muted`, 1 px right border)** | Top: fan logo mark → workspace tile (coral "E", white card) → `search`, `home`, `library` → hairline → `grid`(Overview), `file`(Documents), `book`(Sources), `sparkle`(Ask AI), `lineChart`(Analyses), `users`(Members). Bottom: `sliders` (Settings), `help`, user avatar 28. Selected tool = white tile + e1 with colored icon tile (same color map as §3.1). |
| **Secondary column** (optional; **240–280 px**, `surface-muted`) | Editor: "DOCUMENTS +" list (selected doc = white card) + "OUTLINE" (heading ticks colored by origin; current = white pill) + pinned **CONTENT ORIGIN legend card**. PDF reader: `Pages · Outline` tabs + page thumbnails (selected = 2 px ink border) + yellow note "**2 passages saved** on this source." Ask AI: "Investigations" title + black `+ New question` + SAVED / EARLIER lists. Analysis result: "INPUT DATASET" card + Variables list + lavender "YOUR REQUEST" card + yellow "Data unchanged…" note pinned bottom. |
| **Main** | Editor: centered paper (≈ 760 wide, padding 64) on `background`; others: padded content (40) in the area between columns. |
| **Context panel (340 px, white, 1 px left border)** | Tab strip or titled header (icon tile + 18/700 title), stacked cards with 12 px gaps, **footer pinned to bottom** (an input, an action pair, or a dashed note). Content per screen — see §4. |

Rule [S]: AI is **contextual** — *"Panels and popovers that open over a page. None of them is a permanent chat column."* The context panel is the only docked AI surface; it appears when invoked.

### 3.3 Shell C — Auth split · 1440 reference

Two equal halves. **Form half:** content block ≈ 400–420 px wide, vertically centered-ish (brand top-left at 56 px from top; legal footer bottom-left). **Illustration half:** inset 24 px from the viewport edges, radius 24, tinted background (lavender for Login, mint for Register), centered scene + handwritten caption + two angled stickers. Login: form left / art right. Register: art left / form right (mirrored).

### 3.4 Shell D — Internal tool (AI debugger) · 1600 reference

Dark ink top bar (≈ 52 px) with logo, "AI debugger", yellow chip `INTERNAL · STAFF ONLY`, grey chip `staging`, right-side `request` label + mono id chip + prev/next square buttons. Body = 3-column grid on `background`, padding 24, gap 20: **left ≈ 418** (question card, metadata list, latency bar), **center ≈ 714** (retrieved-chunks table), **right ≈ 379** (context tokens, answer check, prompt). Not part of user navigation — staff flag only [S, p3].

### 3.5 Information architecture [S, p3]

*"One workspace holds sources, documents, analyses and conversations. AI appears inside each of them — never as a separate world."* Max **4 levels deep**.

| Group | Items |
|---|---|
| **Entry** | Log in · Create account · Home — workspaces · Create workspace · No workspaces yet |
| **Global (anywhere)** | Search (⌘K) · Notifications · User settings · Help |
| **Internal** | AI debugger (dashed border item; not in user navigation) |
| **Workspace › Overview** | Continue working · Ask across workspace · Recent documents · Recent sources · Recent analyses · Activity timeline · Settings (owner) |
| **Workspace › Documents** | Document list · Editor · Selection toolbar · Generate section · Citation popover · Provenance inspector · Comments · Version history · Insert analysis |
| **Workspace › Sources** | Source library · Upload + processing · PDF reader · Spreadsheet viewer · Ask this source · Cite · save evidence |
| **Workspace › Ask AI** | Ask workspace · Source selection · Citation panel · Find evidence · Compare sources · Contradictions · Saved investigations |
| **Workspace › Analyses** | Analyses list · Create analysis · Running · Result + code · Failed — recover · Provenance chain |
| **Workspace › Members** | Member list · Add member · Role information · Presence · Pending invites |

Contextual AI surfaces [S]: AI selection toolbar (document, over selected text) · Suggestion/tracked-change (inline accept/reject/edit) · Context panel (document & source reader, right 340 px) · Citation popover (any `[n]` chip) · Provenance inspector (paragraph selected) · Insert result dialog (analysis → document) · Command search (everywhere, ⌘K).

### 3.6 Role access matrix [S, p3]

| Capability | Owner | Editor | Viewer |
|---|:-:|:-:|:-:|
| Read everything | ● | ● | ● |
| Ask AI, find evidence | ● | ● | ● |
| Create + edit documents | ● | ● | — |
| Upload sources | ● | ● | — |
| Run + re-run analyses | ● | ● | — |
| Comment | ● | ● | ● |
| Manage members | ● | — | — |
| Archive workspace | ● | — | — |

Viewers never see disabled buttons — controls they can't use are absent. Editors see Settings name/description as read-only, no archive section, no member controls. Viewers have no Settings entry at all [S, p19]. Role help text: Owner = manage workspace and members, edit content, archive; Editor = create/edit content, upload sources, run analyses, comment; Viewer = read-only, ask AI and comment, edit controls hidden.

### 3.7 Overlay layering

Content → sticky bars → popovers/menus (e2) → floating toolbars (e2) → slide-overs → modals over scrim (e3; scrim covers sidebar + top bar) → toasts (bottom-right, above everything).

---

## 4. Screens

37 screens/variants. Template per screen: **Purpose · Layout · Components · States · Interactions · Spacing/layout rules**. Dimensions are design px **[M]** unless tagged. "Shell A/B/C/D" = §3.1–3.4. PDF page numbers are 1-based.

### 4.1 Authentication

#### Screen 1 — Login · PDF p.9
- **Purpose:** Return users sign in and pick up their workspace.
- **Layout:** Shell C, form left / lavender illustration right.
- **Components:** brand lock-up (top-left, 80 px from left) · H1 "Welcome back." ≈ 38/800 · sub "Pick up your workspace where you left it." · Email field (placeholder `you@university.edu`) · Password field (placeholder `At least 10 characters`) with right-aligned link `Forgot password?` (underlined 12 px) on the label row · primary **Log in** full-width (44) · divider `or` · disabled secondary **Continue with Google** with yellow `Soon` chip · "New to ResearchHub? **Create account**" (link) · footer "© ResearchHub · Privacy · Terms" · right: lavender panel with *Armchair reader* scene, handwritten "Read. Question. Cite.", stickers `Grounded in your sources` (yellow, top-right) and `3 collaborators` (mint, bottom-left).
- **States:** default (shown). Field error / focus use the §2.2 patterns (error text e.g. "Use at least 10 characters."). Google button is intentionally disabled with "Soon".
- **Interactions:** submit → Home; links → Register, password reset, Terms, Privacy.
- **Spacing:** form block ≈ 400 wide; label→input 6; field→field 16; stack to button 20–24; panel inset 24 with radius 24.

#### Screen 2 — Register · PDF p.10
- **Purpose:** Create an account; teammates are invited afterwards.
- **Layout:** Shell C mirrored — mint panel left (*Two at a laptop*, caption "Better together.", stickers `Shared sources` sky / `One report, many hands` coral), form right (≈ 420 wide).
- **Components:** H1 "Create your account." · sub "Takes a minute. You can invite your team afterwards." · Name (placeholder "Adam Nowak") · Email · **Password + Confirm password side by side** (placeholders "10+ characters", "Repeat it") · 4-segment strength meter + "Strength: fair. Add a number or symbol." · primary **Create account** · "Already have an account? **Log in**" · legal line "By creating an account you accept the Terms and Privacy policy." at bottom.
- **States:** strength meter levels (segments fill mint → yellow as strength changes); error/validation per §2.2.
- **Spacing:** same field rhythm as Login; legal text 12 px muted pinned to the bottom of the form half.

### 4.2 Home & workspace creation

#### Screen 3 — Home (workspaces) · PDF p.11
- **Purpose:** Landing page after login: jump back into a workspace and see what changed.
- **Layout:** Shell A. Top bar: breadcrumb "Home", bell, primary `+ New workspace`.
- **Components:** greeting H1 "Good morning, Adam." + one-sentence digest ("measurements.xlsx finished processing overnight, and Kasia left 2 comments on Laboratory Report.") · stickers `2 new comments` (lavender) `Analysis ready` (mint) right-aligned · "Recent workspaces" (H3) + `View all 4` link · **4 workspace cards** (§2.3) in a row (≈ 260 wide, gap 16) — banners: mint illustration, blue "S" tile, lavender illustration, yellow "T" tile · three equal cards: **Recently edited documents** (coral tile + serif title + "Workspace · who, time"), **Recent sources** (type tile + name + meta + status chip: Ready/Processing), **Activity** (avatar/`#17` + sentence + relative time).
- **States:** workspace card has no explicit hover in PDF [I: border-strong + e1]. Processing source shows yellow chip.
- **Interactions:** card → workspace Overview; "View all" → workspaces; rows → open document/source; bell → Notifications popover (Screen 7).
- **Spacing:** content padding 40; heading→grid 16; grid→next section 32; 3-column bottom row gap 16.

#### Screen 4 — Home (no workspaces / first run) · PDF p.12
- **Purpose:** Teach what a workspace is; one next step.
- **Layout:** Shell A without workspace group; content column centered ≈ 640–720.
- **Components:** sidebar: Search, Home (selected), Workspaces, dashed note "No workspace yet…", Settings, Help, user row · top bar: "Home" + bell only (no CTA) · mint illustration card ≈ 560 × 300 (radius 24; *Setting up the desk*) with yellow sticker `Open question? Ask it here.` · title "Start your first research workspace." · sub "A workspace holds your sources, documents and analyses — and the people you work on them with." · primary `+ Create workspace` + secondary `Learn how ResearchHub works` · **3 step cards** (numbered tile: 1 blue "Add sources — PDFs, notes and data" · 2 coral "Write together — Documents with citations" · 3 mint "Check the evidence — Ask AI, see where it came from").
- **Rules:** empty-state template §5.12 (illustration → one sentence → one next step). "Empty states teach what the space is for — they never scold."

#### Screen 5 — Create workspace (modal) · PDF p.13 (and Flow 1 step 1, p.46)
- **Purpose:** Name a workspace and pick an accent; people are invited later.
- **Layout:** Modal ≈ 780 × 460 over Home. Two panes: form (≈ 500) + **live preview pane** (≈ 280) tinted with the chosen accent.
- **Components:** title "Create workspace" + sub "A shared home for sources, documents and analyses." · `Workspace name` input (focused, value "Photonics Seminar") · `Description · optional` textarea · `Accent & icon` swatch row (5 colors, coral selected) + icon tiles (book, flask ✓, chart, sparkle) · footer `Cancel` + primary `Create workspace` · right pane: micro-label `PREVIEW`, workspace card preview (accent banner + icon tile, name, description, "AN You · Owner · 0 sources"), helper "You'll add sources and invite people next."
- **Interactions:** preview updates live with name/description/accent/icon; Esc/Cancel closes; create → new workspace Overview. "People are invited after, not before." [S, p46]
- **States:** input focus (ink + sky halo); validation per §2.2; disabled primary until name present [I].

### 4.3 Workspace pages

#### Screen 6 — Workspace Overview · PDF p.14
- **Purpose:** Home for one workspace: resume work, ask across everything, scan recent items.
- **Layout:** Shell A, selected nav = Overview (yellow tile). Top bar: breadcrumb `Electronics Lab — Team 4 › Overview`, avatar stack, bell, primary `+ New document`.
- **Components:**
  - **Hero:** left — ink `🔑 You're Owner` badge + muted "Semester project · due 14 Nov" · H1 workspace name (≈ 38) · description (15, ≈ 560 max width) · presence row: avatar stack + "Adam is editing Results" + sticker `Grounded in 12 sources` + `···` icon button. Right — mint illustration card ≈ 330 × 197 (radius 24).
  - **Ask box** (card, ≈ 113 tall): lavender sparkle tile · placeholder "Ask across this workspace…" (≈ 18) · scope chip `📖 12 sources · 3 documents ⌄` · ink send button · 3 suggestion chips below ("What factors most strongly influenced measurement error?", "Summarize lecture_05.pdf", "Which claims still need a citation?").
  - **Continue working:** 3 equal cards — Document (coral label chip, time, serif title, "You were in 4. Results", progress bar + "5 of 6 sections"), Source (blue chip, filename, "Last read: page 14", yellow `2 saved evidence`, "Kasia asked 2 questions"), Saved investigation (lavender chip, question title, mint `4 citations`, "Michał").
  - **Two-column body:** left ≈ 693 — cards *Recent documents* (`All documents`), *Recent sources* (`All 12 sources`), *Recent analyses* (`All 17`), each with 40 px tile rows, title, meta and right-aligned chips; right ≈ 380 — **Recent AI activity** (lavender-tint card, 3 items: bold question + "Michał · 4 sources cited · 11:48") and **Workspace activity** (`View all`, 5 events with avatars/`#17`/`[2]`).
- **States:** sources row `Processing` chip; documents `Draft` / `Notes` / `In review`.
- **Interactions:** ask box submits to Ask AI with scope; suggestion chips prefill; scope chip opens source selection; cards navigate; `···` opens workspace menu (Settings for owner only).
- **Spacing:** header→ask box 24; ask box→"Continue working" 32; grid gaps 16–24; page continues below the fold (Recent analyses is cut off in the PDF).

#### Screen 7 — Activity timeline + Notifications popover · PDF p.15
- **Purpose:** Full workspace history, newest first; quick notifications.
- **Layout:** Shell A, breadcrumb `… › Overview › Activity`; timeline column ≈ 650 wide on the left; notifications popover (≈ 400 wide, e2) anchored under the bell, top-right.
- **Components:** H1 "Workspace activity" · sub "Everything that changed in Electronics Lab — Team 4, newest first." · filter chips `All` (active, ink) `Documents` `Sources` `AI` `Analyses` `Members` · date group labels `TODAY` `YESTERDAY` · **timeline**: vertical hairline connecting 32 px actor circles (initials / `#17` yellow / `[2]` blue) + event cards (white, radius 12): "**Adam** edited “Results”" + time right, inner tinted object chip (coral doc / mint dataset / lavender AI / blue citation / neutral comment/history) with icon, bold title and muted context ("4. Results Laboratory Report · v14"). **Notifications popover:** title + `Mark all as read`; tabs `Unread 3` / `All`; items with colored icon tile (lavender comment, mint check, yellow chart, blue quote) + sentence + time + coral unread dot; footer link `Notification settings`.
- **States:** unread dot; "All" chip label is invisible in the PDF render (see §9) — intended: white on ink.
- **Interactions:** filter chips filter the stream; items deep-link to the object (paragraph, version, source page).

#### Screen 8 — Documents list · PDF p.16
- **Purpose:** Browse/create documents; evidence status at a glance.
- **Layout:** Shell A. Top bar: breadcrumb, avatars, bell, `+ New document`.
- **Components:** H1 "Documents" · sub "3 documents · 1 archived · everything cites its sources" · right: search input "Search documents" + select `Last edited ⌄` · tabs `All 3 · Mine 0 · Archived 1` · **table** (cols TITLE · LAST EDITED BY · UPDATED · STATUS · EVIDENCE): coral/lavender/blue doc tiles, serif title + "v14 · 2 manual versions" / "v6 · autosaved", avatar + full name, "Today, 12:55", status chip, evidence chip; hovered row shows `Open` (primary small) + `···`; footer caption "Row actions on hover: Open · Rename · Archive" · **Start from a structure** (H3) — 4 template cards: *Laboratory report* (Objective → conclusions), *Literature review* (Themes and sources), *Thesis chapter* (Argument + references), *Blank page* (Start from nothing).
- **States:** archived hidden behind the Archived tab/chip ("Many docs → archived hidden behind a chip" [S]); empty state = Screen "Documents empty" (§5.12).
- **Spacing:** table rows ≈ 70; templates 4-up, gap 16, card ≈ 260 × 66.

#### Screen 9 — Members · PDF p.17
- **Purpose:** See and manage people; only owners change roles/remove.
- **Layout:** Shell A. Top bar: breadcrumb, avatars, bell, primary `+ Add member`. Content: main ≈ 693 + side column ≈ 366.
- **Components:** H1 "Members" · sub "3 members · 1 pending invite. Only owners can change roles or remove people." · **table** (MEMBER · ROLE · JOINED): avatar 36 + name (+ muted `you`) + email; role chip (Owner ink / Editor lavender / Viewer neutral); joined date or "Invited Sep 28" + `Resend` link for pending; owner-only actions per row: `sliders` icon button (opens role menu) and coral `x` (remove) · **role menu** popover (Editor ✓ `current`, Viewer, divider, `Make owner…`) · **Right now** card: presence pills + a sample paragraph with colored carets/labels ("Adam", "Kasia") — demonstrates subtle presence · **Add member** card: email field (`name@university.edu`), Role choice cards (Editor selected lavender / Viewer), full-width primary `Add member`, helper "They'll get an email with a link. You can change the role later." · **What each role can do** card (3 blocks: chip + 2 lines).
- **States:** pending invite; owner-only controls hidden for non-owners (§3.6); with **1 member** "no presence UI; the Members screen leads with the invite form" [S].
- **Interactions:** role menu choose → confirm; remove → confirm dialog "Remove Michał? He loses access. His edits stay." (`Remove` danger / `Keep`).

#### Screen 10 — Search (⌘K command search) · PDF p.18
- **Purpose:** Search documents, source text, AI conversations and analyses; preview and cite.
- **Layout:** Shell A, content area becomes the search surface; sidebar `Search` item selected (blue tile). Top bar: breadcrumb `… › Search`, avatars, bell.
- **Components:** large search field (≈ 56 tall, radius 16, leading icon, value "temperature efficiency", right `esc` keycap, ink border + sky halo) · filter chips `All 11` (active) `Workspaces 1` `Documents 2` `Sources 3` `AI conversations 2` `Analyses 2` + "11 results · 0.04 s" right · grouped results: group header = colored icon tile + UPPERCASE label + count (`DOCUMENTS 2`, `SOURCES 3`, `AI CONVERSATIONS 2`, `ANALYSES 2`), result rows in a card: bold title + muted location ("· 2. Theoretical Background", "· page 14") + snippet with **yellow `<mark>` on matched terms** · **selected row** has a 3 px ink left bar + `surface-muted` · **Preview pane** (card ≈ 380): `PREVIEW`, source icon + "smith_2025.pdf · page 14", serif excerpt with yellow highlight, buttons `Open page` (primary) + `Cite` · **bottom key hint bar** (fixed): `↑↓ move  ↵ open  ⌘↵ open beside  esc close` left, scope note right "Searches documents, sources (text inside), AI conversations and analyses you can access."
- **States:** no results = *Search · no results* empty state (§5.12) with "Search sources only" / "Clear search".
- **Interactions:** type → live results; ↑↓ moves selection and updates preview; ↵ opens; ⌘↵ opens beside; Esc closes. Documented as e3 "command palette" in the IA [S]; on p18 it is drawn full-page with the app shell visible.

#### Screen 11 — Workspace settings + Archive dialog · PDF p.19
- **Purpose:** Name/description/accent; archive the workspace (owner only).
- **Layout:** Shell A; breadcrumb `… › Overview › Settings`. Left sub-nav ≈ 200 (`General` selected white card, `Members`, `Archived items`); main column ≈ 697.
- **Components:** H1 "Settings" · **General** card: "Everyone in the workspace sees this name and description." · Workspace name input · Description textarea · Accent swatches · `Discard` (secondary) + `Save changes` (primary) · **Archive workspace** card (coral tint + coral border) with `Owner only` chip, text "Removes the workspace from everyone's active list. You can restore it from Archived workspaces any time." and `Archive workspace…` (danger soft) · two role-variant notes: *Editor sees* "Name and description as read-only text. No archive section, no member controls." / *Viewer sees* "No Settings entry at all. Settings are reached from the workspace menu, which is hidden."
- **Archive modal (≈ 600):** yellow icon tile (`archive`) + title "Archive Electronics Lab — Team 4?" · "Archiving removes this workspace from the active workspace list." · mint callout "**No files or documents will be deleted.** Sources, analyses, the Laboratory Report and every version stay exactly as they are." · `Cancel` + primary `Archive workspace`.
- **Interactions:** archiving is reversible; restore via Archived items.

#### Screen 12 — User settings · PDF p.20
- **Purpose:** Profile, appearance, account.
- **Layout:** Shell A; breadcrumb `Settings › Profile`; sidebar `Settings` (lavender tile) selected; sub-nav (`Profile` selected, `Appearance`, `Account`) + main ≈ 697.
- **Components:** H1 "Your settings" · **Profile** card: large coral avatar (≈ 85) with ring, `Avatar colour` swatches (5, current coral ink ring) + `Upload photo` secondary; Name input + Email input (read-only, `surface-muted`) in 2 columns; `Save profile` (primary, right) · **Appearance** card "Dark uses warm graphite and muted versions of the same five colors.": 3 theme cards — *Light* (selected: 2 px ink border + ink check circle), *Dark* (graphite preview with blue/coral/mint swatches), *System* (half-light/half-dark) · **Account** card: "Signed in as adam.nowak@uni.edu on this device." + `⎋ Log out` secondary.
- **Interactions:** theme choice applies immediately; avatar color updates all avatars.

#### Screen 13 — AI debugger (internal, staff only) · PDF p.21
- **Purpose:** Inspect one AI request end-to-end: retrieval, rerank, prompt, tokens, answer check. Not in user navigation [S].
- **Layout:** Shell D (3 columns).
- **Components:** **Left:** question card (micro-label `QUESTION`, question text, chips: workspace, user `Michał K.`, `scope: all 12 sources` (blue), timestamp `today 11:48:02`) · key/value list (mono values): Model `primary-llm-2026-08`, Prompt template `ask_workspace · v3.2.1`, Temperature `0.2 · top-p 0.9`, Retrieval latency `312 ms`, Rerank latency `148 ms`, LLM latency `4.82 s (first token 0.9 s)`, Context tokens `5,812 in · 612 out`, Estimated cost `$0.0213`, Retrieval `hybrid · k = 24 → rerank 12`, Cache `miss` · **latency** card "LATENCY · 5.31 s total — to scale": stacked bar (retrieval blue 312 ms · rerank yellow 148 ms · prompt build lavender 21 ms · LLM mint 4.82 s) + legend. **Center:** "Retrieved chunks · 24 retrieved, 12 reranked, 9 in context" + chips `hybrid: vector + keyword`, `rerank threshold 0.50` · table cols `# · CHUNK · SOURCE·LOCATION · SNIPPET · RETRIEVAL (value + blue mini-bar) · RERANK (bold) · NEW ORDER (e.g. "2 ▼1" red, "1 ▲1" green, "—") · TOKENS · CONTEXT` — 12 rows; included rows show mint `in` chip; rows 10–12 are dimmed (`surface-muted`) with neutral chips `dropped · <0.50` / `dropped · budget`. **Right:** "Context tokens 5,812 / 8,000" with 5-segment bar (system prompt 1,420 lavender · citation rules 640 yellow · retrieved chunks × 9 3,194 mint · conversation history 534 blue · question 24 coral) + legend values · **Answer check** (4 claim rows with mint ✓ / yellow `help`: "Largest deviation at low frequencies `ch_0142 · ch_0377`", "Contact resistance of 0.2–0.4 Ω `ch_0261`", "Temperature drift ≈ 4 °C `ch_0518`", "Cable length disputed — no data `ch_0090`") + chips `citations 4/4 resolved` · `unsupported 0` · **Prompt** card (`Copy` button, mono text).
- **Note:** the PDF's chunk table has a rendering glitch (snippet column overflows/overlaps). Intent = a readable table with a ≈ 280 px snippet column, single-line ellipsized snippets.
- **Spacing:** page padding 24, column gap 20, card padding 16–18, mono 12.

### 4.4 Document editor (Shell B) — one screen, many panel states

Common frame for Screens 14–22 (PDF p.22–27, 35, 44; asset slice p.54):

- **Top bar:** breadcrumb `Electronics Lab — Team 4 › **Laboratory Report**` + yellow `Draft` chip · right: mint `✓ Saved · 12:55` chip · avatar stack (`AN KW` — who is in the doc) · `History` (secondary, history icon) · primary `✦ Ask AI`.
- **Format toolbar** (white pill, e1, centered over the paper, 28 px buttons): undo · redo | `H` (active = `surface-muted`) · **B** · *I* · list · table · quote · link · comment.
- **Paper:** white, 1 px border, radius 16, width ≈ 760, padding 64, ≈ 28 below toolbar. **Title** serif ≈ 36; meta line "Laboratory Report · Adam Nowak, Kasia Wiśniewska, Michał Kowalczyk · v14" (12 muted); H2s ≈ 22/700; body 16/27; bullets as "•" lines; inline citation chips; **table** with `surface-muted` header row, hairline rows; figure blocks in a bordered card; **origin bar** 3 px at paragraph left, ≈ 16 px outside the text column (lavender = AI generated, mint = source-derived list, yellow = analysis block).
- **Left secondary column (≈ 244):** `DOCUMENTS` + `+` · doc list (selected white card; tiles coral/lavender/blue) · `OUTLINE` — Abstract, 1. Objective, 2. Theoretical Background, 3. Methodology, 4. Results, 5. Analysis, 6. Conclusions (colored 3 px tick per origin; current = white pill) · bottom **CONTENT ORIGIN** legend card (Human written · AI generated / rewritten · Source-derived claim · Analysis-derived claim).
- **Right context panel (340):** content varies by state below.

#### Screen 14 — Editor, default (Sources panel) · PDF p.22 (+ p.54)
- **Purpose:** Write with provenance; see which sources are cited.
- **Panel — Sources** (tabs `Sources | Provenance | Comments 2`): **Cited in this document** + mint chip `4 sources` · list card: `1 smith_2025.pdf — Smith et al. (2025) · p. 14 · 3×`, `2 lecture_05.pdf — Lecture 5 · p. 22 · 2×`, `3 instructions.pdf — Lab instructions · p. 5 · 1×`, `A17 Analysis #17 — measurements.xlsx · 12:42 · 2×` (yellow chip) · **In the workspace, not cited:** `lee_2024.pdf`, `sample_data.csv`, `experiment_notes.docx` each with small `Cite` button · yellow callout "❝ **2 paragraphs need a citation** — 3. Methodology and 5. Analysis make claims without a source. `Review them`" · footer **Ask about this section**: card with scope chip `Section 2 · 3 sources`, input "Ask, or generate a draft…", ink send button.
- **States:** autosave chip cycle (§2.11); presence carets; origin bars.

#### Screen 15 — Editor, AI selection toolbar + "Improve writing" suggestion · PDF p.23
- **Purpose:** Rewrite a selection with AI; the user stays in control.
- **Components:** selected sentence highlighted (blue); **floating dark toolbar** above it: `Improve writing` (active, graphite) · `Shorten` · `Expand` · `Explain` · `Find evidence` · `Check claim` · `Add citation` · **inline suggestion card** (lavender tint, 3 px lavender left bar) under the paragraph: `✦ Suggestion · Improve writing` + muted "uses only your text"; old text coral strikethrough; new text mint underlined ("The cell was mounted on a thermostatic plate and heated in 5 °C steps; voltage and current were recorded at each step."); `Accept` (primary) · `Reject` (secondary) · `Edit` (ghost).
- **Panel — "Improve writing"** (sparkle tile title): `SELECTED TEXT` card (quote + chips `Human written`, `1 sentence`) · **What changed, and why** (4 rows with colored icon tiles: *Passive, past tense — Lab methods are written in passive voice.* · *Specific equipment — "the plate" → "a thermostatic plate".* · *Step size added — 5 °C steps — instructions.pdf, p. 5.* · *What was measured — Names voltage and current instead of "the numbers".*) · mint callout **Nothing new was added** (explains sources used) · `Try another version`: `More formal` `Shorter` `Keep my wording` `Try again` · footer dashed note "**You stay in control.** Suggestions never replace your text on their own. Accept, reject or edit — every accepted change is recorded in the paragraph's provenance."
- **Interactions:** Accept → text replaced + provenance entry "Improved writing accepted"; Reject → dismissed; Edit → inline edit then accept; variants re-run.

#### Screen 16 — Editor, Generate section · PDF p.24
- **Purpose:** Draft a section from chosen sources, as a suggestion only.
- **Panel — "Generate section":** `Section` select ("2. Theoretical Background") · **Sources to use** checklist card — `lecture_03.pdf PDF · 31 pp.` ✓, `instructions.pdf PDF · 9 pp.` ✓, `smith_2025.pdf PDF · 24 pp.` ✓, `lee_2024.pdf PDF · 18 pp.` ☐, `Internet off` ☐ · **Length** slider (`~700 words`, range ~150–~1500) · **Citations** segmented `Required | Where possible | Off` · **Tone** select `Academic` · primary full-width `✦ Generate draft` · result card (lavender): "✓ **Draft ready — 698 words** · 6 citations · every sentence traced to a page. The draft is shown as a suggestion; your document is unchanged." · footer dashed note "**Not in a source?** Sentences without support are marked 'Needs citation' instead of being invented. Internet search is off for this draft."
- **In document:** the section shows a **dashed lavender-bordered block** "✦ AI draft — not in your document yet" + mint chip `Grounded in 3 sources`, paragraphs with citation chips, actions `Insert draft` (primary) · `Insert and edit` (secondary) · `↻ Regenerate` (ghost) · `Discard` (ghost, right-aligned). Original text below remains untouched.
- **States:** idle → generating (button busy, AI "Thinking" card) → ready (shown) → error ("The answer couldn't be finished. Your question is saved. Try again").

#### Screen 17 — Editor, citation popover + Provenance inspector · PDF p.25
- **Purpose:** Inspect where a paragraph came from and what changed.
- **Components:** clicked chip `[1]` shows an ink outline; **citation popover** (§2.6) opens below it · **Panel — Provenance:** `SELECTED PARAGRAPH` quote card · **Content origin** card (pencil tile "Human written — Adam Nowak · Sep 28") · **AI modifications** lavender card (refresh tile "Improved writing — Sep 30 · Accepted by Adam · 1 sentence") · **Sources** (number chip, name, "Smith et al. (2025) · page 14", `external` icon) · **Analysis** dashed empty "None — no analysis result is used here." · **History of this paragraph** timeline (blue dot "Citation [2] added — Michał · Oct 1" · lavender dot "Improved writing accepted — Adam · Sep 30" · ink dot "Written — Adam · Sep 28") · footer: `Paragraph history` + `Check claim` (secondary pair).
- **Interactions:** `Open source` → PDF reader at page; `View context` → reader with passage highlighted; `Replace` → find-evidence; `Check claim` → Screen 21.

#### Screen 18 — Editor, Comments · PDF p.26
- **Panel — Comments** (`Comments 2 open`): **new-comment composer** for the current selection (quote "wrote down the numbers", textarea, `Comment` primary) · thread cards (yellow left bar for open anchor, blue for table anchor): quoted anchor line, avatar + name + time ("Kasia 11:04"), text, `Reply` · `✓ Resolve` · dashed row "✓ 1 resolved thread — `Show`" · footer **In this document now** presence pills.
- **In document:** commented range highlighted yellow; tiny avatar + name label near the anchor.

#### Screen 19 — Editor, Version history (preview + diff) · PDF p.27
- **Purpose:** Browse versions, preview, restore safely.
- **Components:** blue-tint banner under top bar: eye icon + "**Previewing v12** · Manual version · Sep 29, 17:40 · compared with current (v14)" + legend swatches `added since v12` (mint) / `removed` (coral) · diff in the paper (removed = coral tint + strikethrough, added = mint tint + underline, changed table row = mint tint) · **Panel — Version history** (title + `x`): "Every save is kept. Pick a version to preview it — nothing changes until you restore." · version cards: `Current version` (mint ✓ tile, "Adam · today 12:55 · autosave", `v14`), `Autosave checkpoint` (Kasia · today 09:12, `v13`), **selected** `Before Kasia's edits` (bookmark tile, "Manual version · Adam · Sep 29, 17:40", `v12`, 2 px ink border + buttons `Restore this version` primary / `Copy` secondary), `Restored version` (Adam restored v9 · Sep 29, 10:15, `v11`), `Autosave checkpoint` (Michał · Sep 28, 16:20, `v9`), `Created` (Adam · Sep 28, 09:03, `v1`) · footer note "**Restoring is safe.** Your current version is saved first, so you can always come back to it."
- **Interactions:** select card → preview + diff; Restore → creates a new version, never destroys.

#### Screen 20 — Editor, Viewer (read-only) · PDF p.28
- **Purpose:** Same document for a viewer: read, comment, ask AI — not edit.
- **Layout:** **Shell A** (full sidebar, `Documents` selected, switcher shows "Viewer · 3 members") — no doc column, no right panel, no format toolbar. Top bar: breadcrumb + `Draft` + `👁 Read-only` chips · `✓ Saved · 12:55` · avatars · `History`.
- **Components:** info bar (centered ≈ 590, `surface-muted`): "👁 You can read and comment on this document. Ask Adam for editor access to make changes." · paper (≈ 760) · bottom-right **ink toast**: lock tile + "**Only editors can change this document** — You can still read, comment and ask AI about it. `Request edit access`".
- **Rule:** no disabled edit controls — they are absent (§5.15).

#### Screen 21 — Editor, Find evidence panel · PDF p.35 (Flow 3 steps 1–2, p.48)
- **Purpose:** Back a selected claim with sources, and show contradicting evidence honestly.
- **Components:** claim sentence highlighted yellow in the paper · **Panel — "Find evidence"** (yellow `help` tile): yellow-tint `CLAIM` card ("Efficiency falls as cell temperature increases.") · muted "Searched 9 ready sources · 2 still processing are not included." · **Strong supporting evidence** (mint ✓ heading): cards `1 smith_2025.pdf · page 14 · 3.2 Temperature dependence`, serif-italic quote, **strength meter** (3 ink segments + "Strong · direct statement with data"), actions `Add citation` (primary) · `Insert quote` (secondary) · `Open` (ghost); `2 lecture_05.pdf · page 22 · slide 14` similarly · **Possible contradictory evidence** (yellow `help` heading): yellow-bordered card `5 experiment_notes.docx · page 2 · informal note`, quote, strength meter (1 of 3, "Weak · single reading, unverified"), `Open source` + `Add as note` · footer dashed note "**Strength** describes how directly a passage states the claim — not a probability. Open the source before you cite."
- **Rules:** *"contradicting evidence is information, not an error"*; *no evidence → mark as open question* [S, p48].

#### Screen 22 — Editor, Insert analysis result + analysis block · PDF p.44 (Flow 2 step 5, p.47)
- **Purpose:** Place an analysis chart/table into the document, with provenance.
- **Components:** **Insert result modal** (≈ 720): title "Insert result", sub "Analysis #17 · Calculate impedance vs frequency", close `x` · 4 **format cards**: `Chart` · `Table` · `Chart + caption` (selected: 2 px ink border + check) · `Table + caption` (mini previews) · `Caption` input ("Figure 1 — Impedance magnitude |Z| = U / I versus frequency") · toggles `Include source reference` ("Adds 'Source: measurements.xlsx, measurement_01' under the figure.") and `Include analysis link` ("Readers can open Analysis #17 and re-run it. Updated automatically.") · footer text "Inserts at your cursor in 4. Results." + `Cancel` / `Insert`.
  **In document:** chart block (white card, yellow 3 px origin bar, log-log chart with sky line + ink-stroked dots), caption "**Figure 1** — Impedance magnitude |Z| = U / I versus frequency", meta row: yellow chip `Analysis #17` + "Source: measurements.xlsx · updated 12:42" + right links `Open analysis · Re-run · Refresh`, and an **out-of-date banner** (yellow): "⚠ **Out of date** — measurements.xlsx changed at 13:20, after this analysis ran." + `Refresh result`. Inline reference chip `A17` after text.
  **Panel — "Analysis blocks in this document":** yellow-tint card: chips `Analysis #17` `Out of date`, "Figure 1 · impedance vs frequency", "measurements.xlsx changed at 13:20 · ran 12:42", `Re-run` (primary small) + `Open analysis` (secondary small); note "An out-of-date block keeps showing the old result, clearly marked. Nothing in your text changes until you choose to refresh."

### 4.5 Sources

#### Screen 23 — Source library · PDF p.29
- **Purpose:** Browse, filter and act on all sources; see processing state.
- **Layout:** Shell A, `Sources` selected (blue tile). Top bar: breadcrumb, avatars, bell, primary `↥ Upload source`.
- **Components:** H1 "Sources" · sub "12 sources · 9 ready · AI answers can cite any ready source by page or row." · sticker `Grounded in 9 ready sources` (sky, rotated, top-right) · toolbar: search input "Search by name, author or text inside" (≈ 366) · select `Status: all` (filter icon) · select `Uploaded by: anyone` · right: list/grid view toggle · tabs `All 12 · PDF 6 · DOCX 2 · Spreadsheet 3 · Text 1 · Images 0` · **table** (NAME · TYPE · UPLOADED BY · DATE · STATUS · actions): type tile (coral/mint/blue/yellow) + filename 14/700 + muted subline (title · pages / "3 sheets · 42 rows · frequency, voltage, current" / "Waiting to be read" / "Reading rows… 64%"), type chip, avatar + first name, date ("Sep 28", "Today, 09:12"), status chip, `✦ Ask source` (secondary small) on *Ready* rows, `···` on all · footer caption "Row actions: Open · Download · Ask source · Archive. With 300 sources the list virtualizes and folders appear as chips above the tabs."
- **States per row:** *Ready* (mint) · *Uploaded* (neutral, "Waiting to be read", no Ask) · *Processing* (yellow, progress % in subline) · *Failed* (coral, **coral error sentence replaces the subline** "We couldn't read this file's encoding." + `Retry` (secondary small)).
- **Interactions:** row click → reader/viewer; `Ask source` → Screen 27; `···` menu = Open · Ask this source (`⌘J`) · Download · Rename (`F2`) · Archive.
- **Scale rules** [S]: *3 sources* → cards, generous rows, upload zone inline · *30* → dense list, type tabs, status filter · *300* → virtualized list, saved filters, folders as chips.

#### Screen 24 — Upload sources (modal) + status variants · PDF p.30 (Flow 1 step 2, p.46)
- **Purpose:** Add files; watch each walk Uploaded → Processing → Ready.
- **Components:** modal ≈ 875: title "Upload sources", close `x` · **drop zone** (blue-tint, 2 px dashed sky border, radius 16): *Carrying files* illustration + "Drag & drop files here" / "or" / primary `Browse files` + "Up to 50 MB each" + type chips `PDF DOCX XLSX CSV TXT` · "4 FILES" label · file rows: type tile + name + right size + status chip + progress/sentence — `lecture_05.pdf 2.4 MB` "Uploading… 1.6 of 2.4 MB" (sky progress) `Uploading` · `sample_data.csv 48 KB` "Processing source… reading rows 28 of 42" (yellow progress) `Processing` · `notes.docx 220 KB` "3 pages read · ready to cite" `Ready` · `scan_notes.pdf 9.8 MB` red sentence "We couldn't read this PDF — it looks like a scanned image with no text." `Failed` + `Retry` · footer "You can close this window. Processing continues and you'll get a notification." + primary `Done`.
- **Below the screenshot — "Source status — component variants"** (4 cards): `Uploaded` "Safely stored. Waiting for a free reader." · `Processing` "Reading rows and columns. Page icon shuffles while it works." · `Ready` "Searchable, citable by page. Appears in Ask scope." · `Failed` "Scanned image, no text. Retry, replace, or run OCR later."
- **Rules:** *"The chip always carries an icon and a word; failures say what happened in one bounded sentence and offer a way forward."*

#### Screen 25 — PDF reader · PDF p.31 (Flow 3 step 3, p.48)
- **Purpose:** Read a source, select passages, cite or save as evidence.
- **Layout:** Shell B. Secondary column ≈ 236 (`Pages | Outline` tabs, thumbnails 12–15, selected page = 2 px ink border, page-number labels, bottom yellow note "**2 passages saved** on this source."). Top bar: breadcrumb `… › Sources › **smith_2025.pdf**` · page stepper `‹ 14 / 31 ›` · zoom `110% ⌄` · search / download icon buttons. Main: `surface-muted` canvas with a white PDF page (≈ 700 wide) in serif; context panel 340.
- **Components:** page with running head ("Smith et al. · Temperature dependence of silicon cell efficiency | J. Photovoltaics 12 (2025)"), section heading, paragraphs, figure with 5 colored lines, caption, page number; **yellow highlight** on the evidence sentence; **dark floating selection toolbar** `Cite · Ask AI · Add to document · Save evidence`; **sticky note** (yellow, script font, ≈ −4° tilt, hand-drawn arrow): "supports claim [1] in Lab Report" · **Panel:** coral book tile + `smith_2025.pdf` + chips `PDF` `Ready` · metadata card (Title, Authors "Smith, J. · Okafor, L. · Tan, W.", Year, Page "14 of 31", Section, Added "Kasia · Sep 29") · **Research actions** (full-width rows with icon + label + right hint): `Ask this source` (lavender tint, "scope: 1 source") · `Cite` ("p. 14") · `Add to notes` · `Find related evidence` ("11 sources") · `Compare` ("pick sources") · **Saved evidence · 2**: yellow-tint card (cited: "p. 14 · cited in Laboratory Report [1]") and white card ("p. 14 · not cited yet").
- **Interactions:** select text → toolbar; Cite → inserts `[n]` (page + quote kept); Save evidence → adds to panel; page thumbnails jump pages.

#### Screen 26 — Spreadsheet viewer · PDF p.32 (Flow 2 step 1, p.47)
- **Purpose:** Inspect a dataset; warn about problems before analysis.
- **Layout:** Shell B, rail only + main + panel 340. Top bar: breadcrumb `… › Sources › **measurements.xlsx**` + `⬇ Download` (secondary).
- **Components:** header: mint table tile (48) + title ≈ 30/800 "measurements.xlsx" + meta "XLSX · 3 sheets · measurement_01 has 42 rows × 3 columns · uploaded by Kasia today, 09:12" · actions `Analyze` (primary, chart icon) · `Ask about data` (secondary, sparkle) · `Create analysis` (secondary, +) · **sheet tabs** (`measurement_01 42` active / `calibration 12` / `notes 6`) · **data grid** (§2.4): `#` column, headers with type badge + name + unit ("123 frequency Hz", "123 voltage V", "123 current mA", "abc note text · optional"); rows 8–24 shown; **rows 14–24 yellow-tint with 3 px yellow-ink left bar** and a cell note "first row below 200 Hz"; footer chip `Rows 14–28 cited` + "in Ask workspace answer [3] · Showing rows 8–24 of 42" + `Load more rows` · **Panel "Sheet details":** key/value card (Sheet, Rows 42, Columns "4 (3 numeric)", Header row "Row 1", Source "Bench meter, 2.00 V drive") · **column stats** card "current (mA) · selected column" with mint histogram and min/max/mean/missing · yellow callout "⚠ **Check before analysing** Row 33: voltage reads "n/a". Text values in a number column will stop an analysis." · **Used in** list: `Analysis #17 — Impedance vs frequency` · `Ask answer [3] — Rows 14–28 · measurement error` · `Laboratory Report — Figure 1`.

#### Screen 27 — Ask this source · PDF p.34
- **Purpose:** Ask a question scoped to one source (or a chosen set) with page-level evidence.
- **Layout:** Shell B: rail + main + right "Scope" panel (≈ 340). Top bar breadcrumb `… › Sources › smith_2025.pdf`.
- **Components:** blue-tint **ASKING** banner (coral book tile, "smith_2025.pdf", "Smith et al. (2025) · 31 pages · only this source is used", `Change scope ⌄`) · question H1 (≈ 28/800) + meta "Adam · just now · 3 pages used" · lavender **ANSWER** card with bold phrases and locator chips (`p.8`, `p.9`) · **Where it says so**: cards with page thumbnail + "Page 8 · 2.3 Instrumentation" + serif-italic quote + `Open page` · neutral callout "**Not found in this source:** the thermocouple's accuracy class. You could ask the workspace, or check datasheet_cell.pdf. **Ask all sources instead**" · bottom composer with chip `smith_2025.pdf only` + "Ask this source…" + send · **Scope panel:** segmented `This source | Selected | All 12`, caption "Switching scope re-runs the question. The scope always stays visible above the answer." · **Selected sources (e2 popover):** checklist (instructions.pdf ✓, lecture_05.pdf ✓, measurements.xlsx ✓, notes.docx ☐, `sample_data.csv — processing` ☐ disabled) + "3 of 12 selected · **Select all ready** · **Clear**" · dashed note "Sources still **processing** can't be selected yet — sample_data.csv is at 64%."

#### Screen 28 — Sources at 1280 (responsive) · PDF p.45
See §6 — a responsive variant of Screen 23 with a slide-over source detail.

### 4.6 Ask AI

#### Screen 29 — Ask workspace (answer + citation panel) · PDF p.33 (Flow 1 step 4, p.46)
- **Purpose:** Grounded Q&A across sources; every claim carries a citation; saved as an investigation.
- **Layout:** Shell B: rail + secondary column ≈ 280 ("Investigations": black `+ New question`; `SAVED` — three items with avatar + "Michał · 4 citations" etc.; `EARLIER` — "yesterday", "Sep 29") + main + citation panel 340. Top bar: breadcrumb `… › Ask AI`, yellow sticker `Grounded in 4 sources`, secondary `🔖 Saved`.
- **Components:** scope chip row `📖 Ask across: 12 workspace sources ⌄` (blue tint) · question as H1 (≈ 28) · meta "Michał · today 11:48 · 9 of 12 sources searched · 4 cited" · **SUMMARY** (lavender card, inline bold key phrases + chips) · **Key findings**: numbered cards (ink square numbers 1–3), sentence + chips + evidence-quality chip (mint "Direct evidence · 2 sources", yellow "Indirect — derived from a coefficient") · **Evidence** list: number chip + source name + location + `Inspect` link; quote serif-italic; dataset evidence on mint tint · **UNCERTAINTY** (yellow) + **CONTRADICTORY EVIDENCE** (coral, link `Compare sources`) side by side · **Suggested next questions** chips · sticky composer (`📖 12 sources` chip + "Ask a follow-up…" + send) · **Citation panel:** citation chips `1 2 [3] 4` (selected = ink ring) + "4 citations"; "Citation [3]" with mint table tile + `measurements.xlsx`; key/values (Sheet, Rows 14–28, Columns); mini data table (rows 14–18 yellow-tint); `USED TO SUPPORT` quote; `Open data` (primary) · `View analysis #17` · `Insert evidence` (secondary).
- **States:** Thinking / Streaming / Partly supported / No evidence / Failed (§5.4); scope always visible.
- **Interactions:** click chip → panel updates; `Inspect` → reader/viewer; follow-up keeps scope.

#### Screen 30 — Compare sources · PDF p.36 (Flow 4 step 1, p.49)
- **Purpose:** Side-by-side grid of question/method/dataset/finding/limits, each cell cited.
- **Layout:** Shell B, rail only; wide content. Top bar actions: `✦ Ask follow-up` · `⬇ Export comparison` (secondary) · primary `Insert summary into document`.
- **Components:** H1 "Compare sources" · "Comparing" + removable coral chips (`smith_2025.pdf ✕` …) + dashed `+ Add source` · **grid** (white card): header row = source cards (tile + name + "Smith et al. (2025) · 31 pp." + `Open`); row labels with collapse chevrons: **Research question · Method · Dataset · Main finding · Limitations · Relevant evidence · Contradictions**; cell text 14 + locator chips (`p.8`, `sl.6`); the conflicting cell has yellow tint · below: lavender **SUGGESTED SUMMARY · draft for your report** (inline citation chips) and yellow card "⚠ **1 difference worth a look** — The temperature coefficient differs between smith_2025.pdf and lee_2024.pdf. **Open contradiction view**".
- **Interactions:** add/remove source re-runs; export → table; insert summary → suggestion in document (never silent).

#### Screen 31 — Evidence on a claim (contradiction view) · PDF p.37 (Flow 4 step 2, p.49)
- **Purpose:** Show supporting vs qualifying evidence and *why they differ*; propose careful wording.
- **Layout:** Shell B, rail only. Breadcrumb `… › Ask AI › Evidence on a claim`.
- **Components:** hero card: micro-label `CLAIM · from 2. Theoretical Background` + yellow chip `Partly supported · needs qualifying` · claim in H1 (≈ 28) “Increased temperature always reduces conversion efficiency.” · explanatory sentence ("…That's useful research information — not an error.") · right: yellow-tint card with *Pinned notes* illustration · 3 columns: **Supporting · 2 sources** (mint ✓; mint-tint cards with number chip, name · page, serif-italic quote, context line) · **Qualifying · 1 source** (yellow `help`; yellow card + coral callout "**Handle with care.** Single source, field conditions, sensor drift not quantified.") · **Why the sources differ** (rows with icon tile: Different temperature range / cell architecture / measurement method, each showing `Supporting: …` (mint chip) vs `Qualifying: …` (yellow chip)) · bottom card **SUGGESTED WORDING · replaces the claim in your report** with cited text + primary `📄 Insert into document` + secondary `Keep as open question`.
- **Tone rule:** warm yellow & coral, gently — *never "AI error"* [S].

### 4.7 Analyses

#### Screen 32 — Analyses list · PDF p.38
- **Purpose:** All analyses with status and quick actions.
- **Layout:** Shell A, `Analyses` selected (mint tile). Top bar: breadcrumb, avatars, bell, primary `+ New analysis`.
- **Components:** H1 "Analyses" · sub "17 analyses · each keeps its data, code, parameters and result together." · sticker `Analysis ready` (mint) · filter chips `All 17` (active ink) `Completed 14` `Running 1` `Queued 1` `Failed 1` + right select `Source: all ⌄` · **analysis cards** (white, radius 16, ≈ 103 tall; gap 13): 96 × 80 thumbnail (mint-tint with mini line chart; running = yellow tint; failed = coral tint with alert; queued = neutral blank) + label "Analysis #17" + status chip + title 16/700 + meta row (mint `measurements.xlsx` chip, avatar + name, time, "Table + chart") + right actions: `Open` (primary small) `↻ Re-run` `⬇ Insert into document` (secondary small). **Failed** card: reason in red under meta ("Column 'voltage' contains text values.") and a single `Inspect data` button. **Running** → only `Open`. **Queued** → no buttons.
- **Empty state:** *Analyses · empty* (§5.12) "Analyze data".

#### Screen 33 — New analysis · PDF p.39 (Flow 2 steps 1–2, p.47)
- **Purpose:** Pick data, describe the calculation in plain language, run.
- **Layout:** Shell B, rail only; 2 columns (≈ 60 % / 40 %). Breadcrumb `… › Analyses › New analysis`.
- **Components:** H1 "New analysis" + sub "Pick the data, say what to calculate. We write and run the code, then keep everything together." · **Card 1 "Choose data"** (blue numbered square `1`): `Source` select (`measurements.xlsx` with mint tile) + `Sheet` select (`measurement_01`) · `Columns to use` toggle chips (✓ `frequency Hz`, ✓ `voltage V`, ✓ `current mA`, ☐ `note text` — checked = mint tint + ink border) · **preview table** (8 rows, `—` for empty note cells) + caption "Preview · rows 1–8 of 42 · 3 numeric columns" · **Card 2 "Describe what to calculate"** (lavender numbered square `2`): focused textarea with the request; suggestion chips `Fit a trend line` `Remove outliers` `Compare two columns` `Average repeated runs`; `Output` ☑ Table ☑ Chart; primary full-width `▷ Run analysis` · **What you'll get** (lavender-tint card): result table you can insert · chart with axes, units and source · "The Python that produced it — readable, re-runnable" · "Provenance: data, sheet, columns, parameters, time".
- **Interactions:** suggestion chips append to the request; "No code to write" [S].

#### Screen 34 — Analysis running · PDF p.40 (Flow 2 step 3)
- **Purpose:** Calm progress; user may leave.
- **Layout:** Shell B rail only; top-right yellow chip `⟳ Running · 12 s`. Left ≈ 400: `YOUR REQUEST` card (bold request text, chips `measurements.xlsx` mint + `measurement_01`) + blue-tint card with *Idea bulb* illustration — "**You can leave this page.** We'll notify you when the result is ready." Right: **"Working on it…"** card (sub "Step 3 of 4 · Running securely") with 4 pipeline cards — `DONE Preparing data — Read 42 rows and 3 columns from measurement_01.` · `DONE Generating analysis — Wrote the calculation Z = U / I and a log-log chart.` · `IN PROGRESS Running securely — Calculating impedance for each measurement in an isolated sandbox.` (yellow, progress line) · `NEXT Creating results — Building the table and chart, then saving provenance.`; below a **dashed** card `RESULT PREVIEW · appears here` with skeleton bars + lines and handwritten "data points will enter one by one…".
- **Rule:** *"no stack traces, no infrastructure words"* [S, p47].

#### Screen 35 — Analysis failed · PDF p.41 (Flow 2 failure path)
- **Purpose:** Explain, reassure, offer quick fixes.
- **Layout:** Shell B rail only; top-right coral chip `Failed`. Main ≈ 770 + side ≈ 380.
- **Components:** hero card (coral border): coral-tint illustration + H1 "Analysis could not be completed." + "**Nothing was changed in your data or document.**" + coral block `POSSIBLE REASON` "Column 'voltage' contains text values. / Row 33 reads "n/a". A number is needed to calculate Z = U / I." + actions `Inspect data` (primary, table icon) · `Edit request` (secondary, pencil) · `Run again` (secondary, refresh) · **Where it happened · measurement_01** + yellow `1 cell` chip + 5-row table with row 33 tinted coral and `n/a` in a coral chip · **Quick fixes** ("Pick one and run again. Your original data stays untouched."): `Ignore row 33 — Skip the row and calculate the other 41.` (yellow-tint, suggested) · `Treat "n/a" as missing — Keep the row, leave Z empty for it.` · `Fix the cell in the source — Open measurements.xlsx and re-upload.` · **What happened** step list (✓ Preparing data · ✓ Generating analysis · ✖ **Running securely — stopped at row 33** · – Creating results — not reached) + muted "Technical details are kept for support and never shown here."
- **Rule:** four-part answer — what's happening, why, what is safe, what next (§5.4).

#### Screen 36 — Analysis result (chart + table + code + provenance) · PDF p.42 (Flow 2 step 4)
- **Purpose:** The completed analysis: figure, data, exact code, provenance — re-runnable.
- **Layout:** Shell B: rail + secondary column ≈ 275 (**INPUT DATASET** card `measurements.xlsx · sheet measurement_01`; **Variables** list: `f frequency x-axis Hz`, `U voltage input V`, `I current input mA`, yellow `Z impedance calculated Ω`; lavender **YOUR REQUEST** card; pinned yellow note "**Data unchanged** since this ran. If measurements.xlsx is replaced, this result is marked out of date.") + main + **Provenance panel 340**.
- **Components:** breadcrumb `… › Analyses › Analysis #17` · label "Analysis #17" + mint `✓ Completed` · H1 "Calculate impedance vs frequency" · actions `</> Hide code` (pressed, muted fill) · `↻ Re-run` · `Insert table` · primary `Insert chart` · **chart card:** title "Impedance magnitude |Z| versus frequency", right "log–log · 10 of 42 points marked", y-label `|Z| (Ω)`, **yellow-tint band** labelled "Largest deviation · below 200 Hz", sky line (≈ 2.5 px) with white dots/ink stroke, hairline gridlines, legend "Z = U / I, U = 2.00 V", x-label `Frequency f (Hz)`, footer "Source: measurements.xlsx · measurement_01   Executed today 12:42" · **Result table** ("8 of 42 rows · sorted by frequency"; calculated column highlighted yellow, bold) · **The code that produced this** card + lavender chip `Python · read-only`, sub "This is exactly what ran. Edit it to change the analysis, or re-run it to reproduce the result.", code block with line numbers (keywords purple, strings green, comments grey) · **Provenance panel:** key/value (Source, Sheet, Columns, Operation `Z = U / I`, Parameters, Executed "Today, 12:42 · 3.2 s", Created by, Status) · **Run history** (grey dot "Re-run available — Same data, same code · now"; green dot "Completed — Adam · today 12:42 · current"; grey dot "Draft request — Adam · today 12:39") · **Used in** `Laboratory Report — 4. Results · Figure 1` · footer dashed note "**See the full chain** from the source file to this chart." (link → Screen 37).

#### Screen 37 — Provenance chain · PDF p.43 (Flow 2 step 4)
- **Purpose:** The reproducible chain from source file to figure.
- **Layout:** Shell B rail only; breadcrumb `… › Analyses › Analysis #17 › Provenance`; sticker `Reproducible` (mint) top-right.
- **Components:** H1 "Where this chart came from" + sub "Analysis #17 — every step from the source file to the figure, kept together and re-runnable." · **8 step cards** in one row (≈ 173 × 200, white, radius 16; icon tile top-left, step number top-right, title, bold value, muted footer) joined by `→` arrows: ① `Source file measurements.xlsx` (mint table tile) ② `Sheet measurement_01` (mint grid) ③ `Selected columns frequency, voltage, current` (mint columns) ④ `Analysis request "Calculate impedance for each measurement…"` (lavender pencil) ⑤ `Generated Python · 12 lines · Z = U / I · hash 9c4e…` (lavender code) ⑥ `Execution · Sandbox run · 3.2 s` (yellow play) ⑦ `Result dataset · 42 rows · impedance (Ω)` (mint database) ⑧ `Chart · |Z| vs f · log–log · Inserted as Figure 1` (blue chart tile; **2 px ink border** = current). Tiles use each hue's mid-tint (mint ①②③⑦, lavender ④⑤, yellow ⑥, blue ⑧) · **Run history** table (RUN · WHEN · WHO · DATA VERSION `v3 · ab12…` · CODE `9c4e…`/`draft` · RESULT `Current` mint / `Replaced` neutral) + caption "Same data version and same code give the same result. If the data version changes, the chart in your document is marked **Out of date** until you refresh it." · **Used downstream** list (`Laboratory Report · 4. Results · Figure 1 · chart + caption`, `Draft Conclusions · Referenced in paragraph 2`, each `Up to date` mint chip) · primary `↻ Re-run analysis` + secondary `⬇ Export record`.

---

## 5. Reusable patterns

### 5.1 Provenance & content origin ("everything cites its origin")
- Every object card and paragraph carries its origin: author + time + version. Paragraph-level **origin bars** (§1.1) and the **Provenance inspector** (Screen 17) expose it; the editor sidebar always shows the legend.
- Every AI-touched change is recorded: "Improved writing accepted — Adam · Sep 30" in the paragraph history. Version history keeps every save; restore never destroys.
- Analyses keep **data, code, parameters, result together** (Screens 36–37); documents embedding them show freshness (§5.14).

### 5.2 Citation chips `[n]`
- Inline numeric chip after the sentence; number = order of first use in the document; click/hover → citation popover (quote, page/rows, Open source, View context, Replace).
- Chip color follows source kind: document = **blue**, dataset/rows = **mint**, analysis = **yellow** (`A17`), PDF locators in grids `p.8`, slides `sl.4`.
- Used identically in: document body, AI answers, Compare grid, evidence lists, suggested wording, summaries. A selected chip gets a 2 px ink outline (panel chip rows, active inline chip).

### 5.3 AI scope is always visible
- Scope chip with book icon ("Ask across 12 sources", "smith_2025.pdf only", "Section 2 · 3 sources") sits in/above every prompt and above every answer; sticker `Grounded in N sources` appears in the sidebar and headers. *"Switching scope re-runs the question. The scope always stays visible above the answer."* Sources still processing cannot be selected.

### 5.4 System feedback — the four-part answer [S]
Every status answers: **what is happening · why · what is safe · what next.** *Never color-only.*

| Area | States (copy from PDF) |
|---|---|
| **Autosave** | Saving… (spinner by title, no toast) · Saved (quiet check + time) · Save failed (stays visible, auto-retries; toast "We'll keep trying. Your text is safe on this device." + `Retry now`) · Conflict ("**Kasia changed this paragraph while you were typing** — Both versions are kept. Nothing was lost." → `Compare` / `Keep mine` / `Take theirs`) |
| **Permission & connection** | "You can read this workspace, not change it — Ask Adam (owner) for editor access…" + `Request edit access` · Offline bar "changes are kept on this device · Reconnecting in 8 s · Try now" · "Read-only · You're a viewer in this workspace" |
| **Source processing** | Uploaded "waiting to be read" · Processing "Reading page 14 of 24" (+ progress) · Ready · Failed "We couldn't read this file. It may be password-protected. `Retry` · `Replace file`" |
| **Analysis runs** | Queued "Waiting for a free runner · 2nd in line" · Running "Step 3 of 4 · Running securely" · Completed "Table + chart · today 11:50" · Failed "Column 'voltage' contains text values" |
| **AI answers** | Thinking ("Reading 12 sources · looking for page references") · Streaming (+ `Stop`) · **No evidence found** ("None of the 12 sources mention this. Widen the scope or add sources.") · **Partly supported — 2 of 3 claims** (✓ ✓ ? list with source/page each, "no source found") · Failed ("The answer couldn't be finished. Your question is saved. `Try again`") |

### 5.5 Suggestion flow — user stays in control
AI output arrives as a **suggestion** (tracked-change style): inline card or dashed "not in your document yet" block; actions **Accept / Reject / Edit** (rewrite) or **Insert draft / Insert and edit / Regenerate / Discard** (generation). *"Suggestions never replace your text on their own."* Rewrites state what they used ("uses only your text", "Nothing new was added"). Generated text marks unsupported sentences "Needs citation" instead of inventing.

### 5.6 Object row anatomy
`[icon tile 32–40 | title 14/700 (serif for documents) + 12 px muted meta | chips (type · status) | hover actions]`, hairline separated; whole row clickable; actions on hover (`Open`, `···`, Rename, Archive); selected = ink left bar. Meta convention: "Who · when · size/pages/version" (e.g. "Kasia · today 09:12 · 3 sheets").

### 5.7 Page header + sticker
H1 + one `text-secondary` sentence (states the object count and a purpose phrase: "3 documents · 1 archived · everything cites its sources") + optional rotated sticker top-right summarizing grounded/ready state + toolbar row (search, filters, tabs) directly beneath.

### 5.8 Callout family
Mint = reassurance/safe ("No files or documents will be deleted", "Nothing new was added", "Restoring is safe") · Yellow = caution/needs attention ("2 paragraphs need a citation", "Check before analysing", "Out of date") · Coral = problem/contradiction ("Analysis could not be completed", "Contradictory evidence", "Handle with care") · Lavender = AI-generated content or summary · Blue = info/context (previewing a version, "ASKING" scope) · Neutral/dashed = rules & explanations. Each: tinted bg + matching border, 14–16 px icon, bold lead + sentence, optional underlined action.

### 5.9 Evidence strength & quality
- **Strength meter:** 3 small ink segments + word ("Strong · direct statement with data", "Weak · single reading, unverified"). *"Strength describes how directly a passage states the claim — not a probability."*
- **Quality chip:** `Direct evidence · 2 sources` (mint) · `Indirect — derived from a coefficient` (yellow).
- Supporting vs qualifying are presented **side by side**, with *why they differ* (range · architecture · method). Contradiction ≠ error.

### 5.10 Failure pattern
`Status chip (icon + word)` → one bounded sentence (red/error-ink) → recovery actions (Retry / Replace / Inspect data / Quick fixes) → reassurance of what is untouched ("Nothing was changed in your data or document.") → no stack traces or infrastructure words ("Technical details are kept for support and never shown here.").

### 5.11 Loading
Skeletons preserve layout, never hide known text (§2.11); progress = linear bar + words; long jobs: "You can leave this page. We'll notify you when the result is ready."; handwritten hints for waiting ("data points will enter one by one…").

### 5.12 Empty states — template [S]
**One illustration · one sentence (title) · one next step.** *"Empty states teach what the space is for — they never scold."* Layout: card (radius 24) with tinted illustration panel on top (~260 × 160), UPPERCASE context micro-label (`HOME · NO WORKSPACES`), title 18–20/800, 2-line description 13–14 muted, 1–2 buttons (primary + optional secondary).

| Context | Illustration | Title | Body | Actions |
|---|---|---|---|---|
| Home · no workspaces | Setting up the desk (mint) | Start your first research workspace. | A workspace holds your sources, documents and analyses — and the people you work with. | `+ Create workspace` · `Learn how ResearchHub works` |
| Documents · empty | Blank page (lavender) | Nothing written yet | Start a report or notes. Sources you add can be cited as you write. | `Create first document` |
| Sources · empty | Carrying files (blue) | Bring in your research material | PDF, DOCX, XLSX, CSV and TXT. We read them so answers can point back to a page. | `↥ Upload research material` |
| Analyses · empty | Empty chart (yellow) | No analyses yet | Open a spreadsheet and describe what to calculate. Code and results stay together. | `Analyze data` |
| Search · no results | Magnifier + papers (blue) | Nothing matches “thermal drift” | Try fewer words, or limit the search to sources. Searching 12 sources, 3 documents, 17 analyses. | `Search sources only` · `Clear search` |
| AI · no evidence | Pinned notes (coral) | No evidence found | None of the selected sources mention this claim. You can keep it as an open question. | `Mark as open question` · `Add sources` |

The in-answer "No evidence found" variant is a compact dashed card with a small illustration (Screen 29 / §5.4).

### 5.13 Presence
Subtle: avatar stack in the top bar; presence pills; colored caret + small label in text; "nothing that moves your text." 1 member → no presence UI; 5+ members → stack collapses to `+N`; presence colors map to member color.

### 5.14 Freshness / out-of-date
Embedded analysis blocks show an **Out of date** chip + yellow banner when the source file changed after the run; old result stays visible and marked; refresh is explicit (`Refresh result`, `Re-run`). Same-data + same-code ⇒ same result (data version `v3 · ab12…`, code hash `9c4e…`).

### 5.15 Role-based absence
Controls a role cannot use are **absent**, not disabled (viewer: no edit toolbar, no Upload, no Settings, no member controls). Instead, show a calm read-only notice with a path forward (`Request edit access`). Exception: Google sign-in shows a disabled "Soon" state (a roadmap marker, not a permission).

### 5.16 Keyboard & shortcuts [S]
`⌘K` search · `↑ ↓` move · `↵` open · `⌘↵` open beside · `Esc` close · `⌘J` ask this source · `F2` rename. Focus ring: 2 px ink + 2 px gap on every focusable control.

### 5.17 Copy & tone
Calm, specific, non-blaming: say what happened, what's safe, what next. Examples to reuse verbatim: "Nothing was changed in your data or document." · "Your text is safe on this device." · "Both versions are kept. Nothing was lost." · "No files or documents will be deleted." · "Restoring is safe. Your current version is saved first." · "Suggestions never replace your text on their own." · "That's useful research information — not an error." · Failures: one bounded sentence + a way forward. Headlines sometimes end with a period ("Welcome back.", "Create your account.", "Start your first research workspace.", "Analysis could not be completed."). Sentence case everywhere; UPPERCASE only for micro-labels.

---

## 6. Desktop & responsive behavior

The PDF is desktop-first: **no mobile or tablet screens**. One explicit responsive spec exists (p.45) plus inferences.

### 6.1 Stated rules [S, p.45 — "Rules at 1280 px"]
1. **Sidebar collapses to a rail** (64 px).
2. **Context panels become slide-overs** instead of docking (≈ 420 wide, full height, close `x`; e.g. Source detail with `Open reader` primary + `Ask this source` lavender secondary).
3. **Tables drop "Uploaded by" and "Date" columns first.**
4. **Below 1024 px the rail becomes a top menu.**

### 6.2 Observed differences at 1280 (Screen 28 vs Screen 23)
- Search shortened ("Search sources"); the `Status` and `Uploaded by` selects collapse into one `Filters` button.
- Tabs shorten ("Sheets 3", "Text 1"; Images tab omitted).
- Table keeps NAME + type chip + status chip only (type chip moves right, left of status); the selected row keeps the 3 px ink bar.
- Sticker is replaced by a small yellow `1280 px` marker (annotation only); page title shrinks (≈ 30).

### 6.3 Breakpoint model derived from the PDF [I]

| Viewport | Shell | Panels | Notes |
|---|---|---|---|
| ≥ 1600 | B: rail 64 + secondary column 240–280 + main + **docked context panel 340** | docked | Editor/AI/analysis screens drawn at 1600 |
| 1440 | A: **full sidebar 264**, main padding 40 | docked right columns (≈ 366–380) on Members/Overview | Dashboard-style screens drawn at 1440 |
| 1280 | rail 64 | **slide-overs** | Tables drop columns (§6.1) |
| 1024–1279 | rail 64 | slide-overs | |
| < 1024 | **top menu** replaces rail | slide-overs / full-screen sheets | No design exists; keep the same object model |

### 6.4 Other inferred behavior [I]
- Auth: below ≈ 900 px hide/stack the illustration panel above or below the form; form stays ≈ 400 max-width.
- Home workspace cards 4 → 2 → 1 columns; Overview body 2 columns → 1; "Continue working" 3 → 1.
- Editor paper shrinks to available width keeping padding ≥ 24; right panel becomes slide-over; format toolbar stays sticky.
- Modals: max-width = min(design width, viewport − 32); body scrolls, footer stays visible.
- Sticky regions: sidebar/rail, top bar, Ask-AI composer (bottom), Search key-hint bar (bottom), panel footers (pinned bottom), table header (when scrolling long lists / virtualized).
- Text handling: switcher name and emails truncate with ellipsis ("Electronics L…", "adam.nowak@…"); captions wrap to a second line ("Owner · 3 / members"); long filenames and quotes wrap in cards, ellipsize in dense rows.
- Scaling behavior by data volume is specified in the PDF [S, p.3]: 3 / 30 / 300 sources; 1 / 5 members; many docs (outline + list pinned left, recent first, archived behind a chip).

---

## 7. User flows (p.46–49)

Each page shows 4–5 steps as miniature screens joined by arrows, a numbered step title, and a caption. Pills at the bottom state design constraints.

| Flow | Persona · time | Path | Step captions [S] |
|---|---|---|---|
| **1 — Start a report from scratch** (p.46) | Student · first session · *about 10 minutes, no setup* | Create workspace → upload sources → create document → ask AI → insert a citation | 1 Create workspace (Screen 5): "Name it, pick an accent. People are invited after, not before." · 2 Upload sources (24): "Drop PDFs and data. Each file walks Uploaded → Processing → Ready." · 3 Create a document (8): "Start from a laboratory-report structure or a blank page." · 4 Ask AI (29): "Scope is visible. Every claim carries a citation chip." · 5 Insert a citation (17): "Source, page and quote travel with the sentence. Provenance is recorded." Pills: *always visible: workspace scope · source status · AI scope + sources used · where each sentence came from* |
| **2 — From a spreadsheet to a reproducible figure** (p.47) | Researcher · data in hand · *the chart draws itself* | Open dataset → describe analysis → run → inspect provenance → insert chart | 1 Open the dataset (26): "Sheet, columns and a warning about text in number columns." · 2 Describe the analysis (33): "Plain language, plus the columns you pick. No code to write." · 3 Run (34): "Four friendly steps. You can leave and get notified." · 4 Inspect provenance (37; result view is 36): "File → sheet → columns → request → code → run → result → chart." · 5 Insert chart (22): "Chart + caption, source reference, analysis link. Marked out of date if data changes." Pills: *failure path: plain reason, quick fixes, run again (Screen 35) · no stack traces, no infrastructure words* |
| **3 — Back a claim with evidence** (p.48) | Student or researcher · mid-draft · *check it before you cite it* | Select claim → find evidence → inspect source → add citation | 1 Select the claim (14 + selection toolbar as in 15): "Highlight a sentence, choose 'Find evidence' in the selection toolbar." · 2 Find evidence (21): "Strong support and possible contradiction side by side. Strength is described, not scored." · 3 Inspect the source (25): "Open the page, read the passage in context, save it as evidence." · 4 Add the citation (17): "[1] links to source and page. The paragraph's provenance updates." Pills: *no evidence → mark as open question · contradicting evidence is information, not an error* |
| **4 — From comparison to a careful synthesis** (p.49) | Researcher · literature review · *disagreement is data* | Compare sources → detect contradiction → insert synthesis into the report | 1 Compare sources (30): "Question, method, dataset, finding and limits in one grid — each cell cited." · 2 Detect the contradiction (31): "Supporting and qualifying evidence, and why they differ: range, architecture, method." · 3 Insert the synthesis (editor with the suggestion/Generate panel, 16): "The wording arrives as a suggestion. Insert, edit or discard — your text never changes silently." · 4 Provenance keeps the trail (Version history, 19; paragraph provenance, 17): "Who inserted it, from which sources, and every earlier version to return to." Pills: *warm yellow and coral, gently — never "AI error" · export the comparison as a table* |

---

## 8. Interaction & motion inventory

| Interaction | Behavior |
|---|---|
| Autosave | Spinner next to title → quiet check + time (fades to plain text); no toast; failure persists with auto-retry |
| Selection toolbars | Appear over selected text (document) / selected passage (PDF); dark pill, e2; dismiss on selection change |
| Suggestion | Inline card below paragraph; accept/reject/edit; provenance entry written on accept |
| Citation chip | Click/hover → popover (e2) anchored to chip; Esc closes |
| Row hover | Reveals `Open`, `···`, Rename, Archive |
| Context menu | Opens from `···`; shortcuts shown right |
| Streaming AI | Text streams with caret; `Stop` available; skeleton → thinking → streaming → complete/partial/none/failed |
| Source processing | Page icon "shuffles" while processing; progress bar fills; status chip updates in place; notification on completion |
| Analysis run | Step cards advance DONE → IN PROGRESS → NEXT; leaving the page is safe; result preview ghost "data points enter one by one" |
| Modal | Scrim ≈ 42 %; focus trapped; Esc/Cancel closes; Create-workspace preview updates live |
| Search | Live results; ↑↓ changes preview; ↵ open; ⌘↵ open beside |
| Presence | Colored caret + label; never moves user text |
| Illustration motion | Blink 120 ms every 5–7 s · floating paper 6 px / 3° over 2.4 s once · highlight wipe 400 ms L→R on evidence found. Short, one-shot, never long loops |
| Reduced motion | [I] honor `prefers-reduced-motion`: drop wipes/float, keep state changes |

---

## 9. Ambiguities, inconsistencies and gaps in the PDF

Decisions a future session should make consciously (or confirm with the designer):

1. **Raster source.** Colors for button hover/disabled, shadows, scrim and mid-tints were *measured*, not read from tokens (tagged **[M]/[I]**). Exact shadow definitions are inferred.
2. **Control height:** stated 34–38 px; measured buttons 34 (top bar) / 36 (default) / 30 (in-row small) / 44 (auth, full-width CTAs) and inputs 40. Use the measured set unless the designer says otherwise.
3. **Title sizes:** type scale lists H1 32 and paper title 28, but screens show page titles ≈ 34–40 and the editor title ≈ 36 (§1.2). Tokens in §1.2 are authoritative for the scale; screen values are guidance.
4. **Human-written origin:** token page says *no bar*; the editor's CONTENT ORIGIN legend draws an ink/black bar. Pick one (recommend: no bar in the document, legend swatch black for recognition).
5. **Activity filter chip (p.15):** the active "All" chip renders as a solid ink pill with **no visible label** (text same color as fill). Pattern on p.18/p.38 is correct: ink fill + white text.
6. **AI debugger table (p.21):** the Snippet column overflows/overlaps in the render. Treat the intent (§Screen 13) as the spec, not the pixels.
7. **Tooltips:** no tooltip component is shown anywhere (inferred spec in §2.8).
8. **Dark mode:** only the token map exists, plus the Appearance previews and one chip pair. Dark tints/inks, shadows, and screens are undefined.
9. **Mobile/tablet:** not designed; < 1024 px only has "rail → top menu".
10. **Slide-over width at 1280** is not annotated; ≈ 420 px measured.
11. **Page 1 "UI fragments"** (My Library, Shared with me, AI Assistant, Projects, "Research workspace" mock) show an *earlier exploration* with different navigation and component styling (e.g. blue "+" button, "Dataset" chip). They conflict with the final IA (Overview / Documents / Sources / Ask AI / Analyses / Members). **Treat p.1 as mood-board only.**
12. **Overview (p.14)** is cropped at the bottom; the *Recent analyses* card shows only Analysis #17 and #16 in the render.
13. **Search** is described as a ⌘K command palette (e3 dialog) in the IA but drawn as a full-page search with the shell visible (p.18). Support both: palette overlay (⌘K) and a full results view.
14. **Two shells for documents:** the editor appears in Shell B (rail + doc column + panel, 1600) and the viewer variant in Shell A (full sidebar, 1440, p.28). The viewer likely also fits Shell B; confirm.
15. **Fonts:** Plus Jakarta Sans and Source Serif are named; the monospace and handwritten faces are not.
16. **Text copy contains sample data** (people, files, numbers) — treat it as placeholder content, but keep the *copy patterns* (§5.17).
17. **Dates in the mock are October 2026** ("Sep 28 … Oct 1"); irrelevant to implementation.
18. **Spacing/size values not derivable** (e.g. exact paddings of every card) are approximations ±2 px; prefer the 4-pt scale (§1.3) when snapping.

---

## Appendix A — Screen → PDF page index

| # | Screen | PDF p. | Shell |
|---|---|---|---|
| 1 | Login | 9 | C |
| 2 | Register | 10 | C |
| 3 | Home (workspaces) | 11 | A |
| 4 | Home (empty) | 12 | A |
| 5 | Create workspace (modal) | 13, 46 | A |
| 6 | Workspace Overview | 14 | A |
| 7 | Activity + Notifications | 15 | A |
| 8 | Documents list | 16 | A |
| 9 | Members | 17 | A |
| 10 | Search | 18 | A |
| 11 | Workspace settings + Archive dialog | 19 | A |
| 12 | User settings | 20 | A |
| 13 | AI debugger (internal) | 21 | D |
| 14 | Editor — default / Sources panel | 22, 54 | B |
| 15 | Editor — selection toolbar + Improve writing | 23 | B |
| 16 | Editor — Generate section | 24 | B |
| 17 | Editor — citation popover + Provenance | 25 | B |
| 18 | Editor — Comments | 26 | B |
| 19 | Editor — Version history | 27 | B |
| 20 | Editor — Viewer (read-only) | 28 | A |
| 21 | Editor — Find evidence | 35 | B |
| 22 | Editor — Insert analysis result + analysis block | 44 | B |
| 23 | Source library | 29 | A |
| 24 | Upload sources (modal) + status variants | 30 | A |
| 25 | PDF reader | 31 | B |
| 26 | Spreadsheet viewer | 32 | B |
| 27 | Ask this source | 34 | B |
| 28 | Source library @ 1280 + slide-over | 45 | rail |
| 29 | Ask workspace | 33 | B |
| 30 | Compare sources | 36 | B |
| 31 | Evidence on a claim | 37 | B |
| 32 | Analyses list | 38 | A |
| 33 | New analysis | 39 | B |
| 34 | Analysis running | 40 | B |
| 35 | Analysis failed | 41 | B |
| 36 | Analysis result | 42 | B |
| 37 | Provenance chain | 43 | B |

**Non-screen pages:** 1 brand board · 2 tokens · 3 IA/roles/scaling · 4 illustration kit · 5–8 components & states · 46–49 flows · 50 sidebar slice · 51 top-bar slice · 52 icon set · 53 lock-up.

## Appendix B — Component → PDF page index

Buttons / inputs / navigation / badges / avatars / feedback / loading: p.5 · Object cards, citations, AI components, editor components, analysis components, chart-type stickers: p.6 · Autosave, permissions, source processing, analysis runs, AI answers, skeletons: p.7 · Empty states: p.8 · Insert-result dialog: p.44 · Upload dialog + status variants: p.30 · Version history: p.27 · Role menu: p.17 · Notifications popover: p.15 · Citation popover: p.6, p.25 · Selection toolbars: p.6, p.23, p.31 · Comparison grid: p.36 · Code panel: p.6, p.42 · Icon set: p.52 · Colors/type/radius/elevation/dark: p.2 · Illustrations & motion: p.4.
