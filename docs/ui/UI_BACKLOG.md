# UI backlog

Implementation backlog derived from [`UI_INVENTORY.md`](UI_INVENTORY.md), ordered by **dependency and readiness**, not by PDF order. Issue drafts for the `Task` items are in [`issues.json`](issues.json); relationships are drawn in [`UI_DEPENDENCIES.md`](UI_DEPENDENCIES.md).

**Status:** audit only. No production code changed; no GitHub issue created. Scope uses the repository's own size scale (XS, S, M, L, XL); no time estimates.

## Phases

| Phase | Contents | New issues | Backlog items |
| --- | --- | ---: | ---: |
| 0 | Design foundations | 3 | 3 |
| 1 | Shared primitives | 7 | 7 |
| 2 | Shared ResearchHub components | 5 | 5 |
| 3 | Application shell and navigation | 4 | 4 |
| 4 | READY_NOW feature UI (incl. existing features to polish) | 22 | 22 |
| 5 | UI_ONLY_NOW feature UI | 2 | 2 |
| 6 | BLOCKED UI (existing issues are the blockers) | 0 | 13 |
| 7 | Design decisions required | 0 | 33 |
| | **Total** | **43** | **89** |

Order of creation (and therefore issue numbers) follows the dependency order in `issues.json`: Phase 0, Phase 1, Phase 3 (shell), Phase 2 (shared components), Phase 4, Phase 5.

**Where the issues live.** Cross-cutting design-system and shell work goes to **Epic 3: Frontend Foundation** (`Task 3.7`–`3.20`). Feature screens go to the epic of their feature (Epic 4 auth, 5 workspaces, 6 documents, 7 sources, 9 parsing/preview, 11 Ask/citations, 12 authoring, 13 datasets, 15 analysis artifacts, 24 research workflows). New `RH-` references continue at `RH-264`. See [`ISSUE_STYLE_GUIDE.md`](ISSUE_STYLE_GUIDE.md).

## PHASE 0 — Design foundations

### BL-0-01 — Define frontend styling approach and add CSS toolchain support

- **Proposed issue:** `[Task 3.7]` · `RH-264` · milestone *Epic 3: Frontend Foundation*
- **Scope:** M · **Readiness:** `READY_NOW` · **Priority label:** `high-priority`
- **Objective:** Choose how ResearchHub UI is styled and make the Webpack, Jest, TypeScript and Prettier toolchain handle stylesheets and font/SVG assets accordingly. This work gives the frontend a predictable styling and asset contract before the design system and feature screens are built on it.
- **Source design files:** none (toolchain task)
- **Relevant code paths:** `frontend/webpack.config.cjs`, `frontend/jest.config.cjs`, `frontend/src/env.d.ts`, `frontend/src/styles/`, `docs/adr/`
- **Existing issues:** #14, #15, #19
- **Dependencies:** Task 3.1 (#14), Task 3.2 (#15)
- **Acceptance criteria:**
  - ADR-006 records the decision, the alternatives considered and the dependency consequences.
  - A component can import a `.css` file in both a Jest component test and the production Webpack build.
  - Coverage collection includes the new shared UI directories without lowering existing thresholds.
- **Inventory:** `UI-FND-07`
- **Duplicate check:** closest existing #14, #15, #19 — #14/#15/#19 (closed) delivered the build, `src/` layout and quality scripts and only reserve a `styles/` folder in docs; none covers CSS handling in Jest/Webpack or the open component-library decision.

### BL-0-02 — Add design tokens and base typography styles

- **Proposed issue:** `[Task 3.8]` · `RH-265` · milestone *Epic 3: Frontend Foundation*
- **Scope:** L · **Readiness:** `READY_NOW` · **Priority label:** `high-priority`
- **Objective:** Add the ResearchHub design tokens (color roles, type scale, spacing, radii, elevation, focus and motion) as CSS custom properties with base element styles. This work gives every later component one visual source of truth, so screens are assembled from tokens instead of ad-hoc values.
- **Source design files:** `Brand&system.pdf` p.2,4; `Components&states.pdf` p.1
- **Relevant code paths:** `frontend/src/styles/`, `frontend/public/index.html`, `frontend/package.json`
- **Existing issues:** none
- **Dependencies:** Task 3.7 (BL-0-01)
- **Acceptance criteria:**
  - Every token in the design exists as a documented CSS custom property and hex values are defined only in the token files.
  - Body text and controls meet the 4.5:1 contrast minimum stated in the design.
  - Existing pages render with the base styles and all existing tests still pass.
- **Inventory:** `UI-FND-01`, `UI-FND-02`, `UI-FND-04`, `UI-FND-05`, `UI-FND-13`, `UI-FND-14`, `UI-PRM-23`
- **Duplicate check:** closest existing — — No issue (open or closed) mentions design tokens, typography or a stylesheet.

### BL-0-03 — Add the ResearchHub icon set

- **Proposed issue:** `[Task 3.9]` · `RH-266` · milestone *Epic 3: Frontend Foundation*
- **Scope:** L · **Readiness:** `READY_NOW` · **Priority label:** `high-priority`
- **Objective:** Add the ResearchHub icon set as typed React components on a 24 px grid with a 1.75 px rounded stroke. This work gives navigation, buttons, chips and states one systematic icon vocabulary instead of text-only controls.
- **Source design files:** `Reusable_parts.pdf` p.3; `Brand&system.pdf` p.2
- **Relevant code paths:** `frontend/src/shared/components/icons/`
- **Existing issues:** none
- **Dependencies:** Task 3.7 (BL-0-01)
- **Acceptance criteria:**
  - All 80 icons render at 14 to 20 px without clipping and follow `currentColor`.
  - A unit test renders every registry entry.
  - Icons never carry meaning alone: consumers pass a text label or hide the icon.
- **Inventory:** `UI-FND-08`
- **Duplicate check:** closest existing — — No issue mentions icons.

## PHASE 1 — Shared primitives

### BL-1-01 — Build button primitives

- **Proposed issue:** `[Task 3.10]` · `RH-267` · milestone *Epic 3: Frontend Foundation*
- **Scope:** S · **Readiness:** `READY_NOW` · **Priority label:** `high-priority`
- **Objective:** Build the shared button primitives: primary, secondary, ghost, danger and danger-soft, with icon-only and busy variants. This work replaces roughly thirty raw `<button>` elements with one accessible and consistent control.
- **Source design files:** `Components&states.pdf` p.1
- **Relevant code paths:** `frontend/src/shared/components/`
- **Existing issues:** none
- **Dependencies:** Task 3.8 (BL-0-02), Task 3.9 (BL-0-03)
- **Acceptance criteria:**
  - Variants and focus ring match the design (2 px ink ring with 2 px gap).
  - An icon-only button without an accessible name fails type-checking.
  - One existing screen is migrated and its tests that query buttons by accessible name still pass.
- **Inventory:** `UI-PRM-01`
- **Duplicate check:** closest existing — — No issue covers shared UI controls.

### BL-1-02 — Build form field and selection control primitives

- **Proposed issue:** `[Task 3.11]` · `RH-268` · milestone *Epic 3: Frontend Foundation*
- **Scope:** L · **Readiness:** `READY_NOW` · **Priority label:** `high-priority`
- **Objective:** Build shared text field, textarea, select, checkbox, toggle, segmented control and choice-card primitives with label, hint and error wiring. This work consolidates the form markup that `features/auth` and `features/workspaces` duplicate today and keeps the existing `aria-describedby` and `aria-invalid` behavior.
- **Source design files:** `Components&states.pdf` p.1; `Document_editor.pdf` p.3; `Results,provenance&insert.pdf` p.3
- **Relevant code paths:** `frontend/src/shared/components/`, `frontend/src/features/auth/components/FormField.tsx`, `frontend/src/features/workspaces/components/`
- **Existing issues:** none
- **Dependencies:** Task 3.8 (BL-0-02), Task 3.10 (BL-1-01)
- **Acceptance criteria:**
  - Labels, hints and errors remain programmatically associated as in the current `FormField`.
  - Segmented control and radio cards are operable with arrow keys.
  - The auth `FormField` is replaced by the shared field without changing its tests' accessible queries.
- **Inventory:** `UI-PRM-02`, `UI-PRM-03`, `UI-PRM-04`, `UI-PRM-05`, `UI-PRM-06`
- **Duplicate check:** closest existing — — No issue covers shared form primitives; `FormField` exists but is auth-local.

### BL-1-03 — Build badge, chip, avatar and sticker primitives

- **Proposed issue:** `[Task 3.12]` · `RH-269` · milestone *Epic 3: Frontend Foundation*
- **Scope:** M · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build badge, chip, avatar, avatar stack and sticker primitives. This work provides the small status and identity elements that every list, card and header in the design depends on.
- **Source design files:** `Components&states.pdf` p.1,2
- **Relevant code paths:** `frontend/src/shared/components/`
- **Existing issues:** none
- **Dependencies:** Task 3.8 (BL-0-02), Task 3.9 (BL-0-03)
- **Acceptance criteria:**
  - Badge, avatar and sticker visuals match the design at all documented sizes.
  - The avatar stack collapses to +N past the configured limit.
  - No badge is color-only.
- **Inventory:** `UI-PRM-07`, `UI-PRM-08`, `UI-SHR-14`, `UI-SHR-27`
- **Duplicate check:** closest existing — — #97 (presence) is the only mention of avatars/cursors and covers realtime data, not the primitive.

### BL-1-04 — Build overlay primitives: dialog, popover menu and slide-over

- **Proposed issue:** `[Task 3.13]` · `RH-270` · milestone *Epic 3: Frontend Foundation*
- **Scope:** L · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build dialog, popover, menu and slide-over primitives with focus management. This work gives confirmations, menus and side panels one accessible implementation and removes the need for inline two-step workarounds.
- **Source design files:** `Components&states.pdf` p.1; `Access&home.pdf` p.5; `Responsive.pdf` p.1
- **Relevant code paths:** `frontend/src/shared/components/`
- **Existing issues:** none
- **Dependencies:** Task 3.8 (BL-0-02), Task 3.10 (BL-1-01)
- **Acceptance criteria:**
  - Tab stays inside an open dialog and focus returns to the trigger on close.
  - Esc closes non-destructive overlays.
  - Menus are fully operable by keyboard.
  - Behavior is covered by component tests.
- **Inventory:** `UI-PRM-10`, `UI-PRM-12`, `UI-PRM-13`, `UI-SHL-09`
- **Duplicate check:** closest existing — — #33 mentions a create-workspace dialog only as a screen option.

### BL-1-05 — Build feedback primitives: banner, toast, progress, spinner and skeleton

- **Proposed issue:** `[Task 3.14]` · `RH-271` · milestone *Epic 3: Frontend Foundation*
- **Scope:** L · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build banner, toast, progress, spinner and skeleton primitives. This work gives the four-part system feedback pattern (what is happening, why, what is safe, what next) one shared implementation.
- **Source design files:** `Components&states.pdf` p.1,3
- **Relevant code paths:** `frontend/src/shared/components/`, `frontend/src/shared/components/ApiStatusBanner.tsx`
- **Existing issues:** none
- **Dependencies:** Task 3.8 (BL-0-02), Task 3.9 (BL-0-03), Task 3.10 (BL-1-01)
- **Acceptance criteria:**
  - Banners, toasts and skeletons match the design.
  - Existing alert and status announcements are preserved when a first consumer migrates.
  - Status is always conveyed by an icon and a word.
- **Inventory:** `UI-PRM-14`, `UI-PRM-15`, `UI-PRM-16`, `UI-PRM-17`, `UI-STA-01`, `UI-STA-03`, `UI-STA-06`, `UI-STA-08`
- **Duplicate check:** closest existing #17, #18 — #25 mentions loading states for auth bootstrap; none covers shared feedback components.

### BL-1-06 — Build surface primitives: card, list row, data table and empty state

- **Proposed issue:** `[Task 3.15]` · `RH-272` · milestone *Epic 3: Frontend Foundation*
- **Scope:** L · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build card, panel, list row, icon tile, data table and empty-state primitives. This work gives lists, tables and empty areas one structure so feature screens differ in content rather than in markup.
- **Source design files:** `Components&states.pdf` p.1,2,4; `Sources.pdf` p.1
- **Relevant code paths:** `frontend/src/shared/components/`
- **Existing issues:** none
- **Dependencies:** Task 3.8 (BL-0-02), Task 3.12 (BL-1-03)
- **Acceptance criteria:**
  - Tables keep semantic `<table>` markup and accessible headers.
  - The empty states in the design (workspaces, documents, sources, analyses, search, evidence) are expressible without feature-specific markup.
  - One existing table is migrated and its tests pass.
- **Inventory:** `UI-PRM-18`, `UI-PRM-19`, `UI-PRM-20`, `UI-PRM-21`, `UI-STA-02`
- **Duplicate check:** closest existing #46, #33 — #33 and #46 require loading/empty/error states functionally; they do not define shared surfaces.

### BL-1-07 — Build navigation primitives: tabs, filter chips and breadcrumbs

- **Proposed issue:** `[Task 3.16]` · `RH-273` · milestone *Epic 3: Frontend Foundation*
- **Scope:** M · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build tabs, filter chips and breadcrumb primitives. This work provides the in-page and top-bar navigation elements that the shell and several screens share.
- **Source design files:** `Components&states.pdf` p.1; `Reusable_parts.pdf` p.2
- **Relevant code paths:** `frontend/src/shared/components/`
- **Existing issues:** none
- **Dependencies:** Task 3.8 (BL-0-02), Task 3.9 (BL-0-03)
- **Acceptance criteria:**
  - Tabs are operable with arrow keys and expose selected state.
  - The breadcrumb is a labelled `nav` landmark.
  - Visuals match the design.
- **Inventory:** `UI-PRM-09`
- **Duplicate check:** closest existing #16 — #16 added routing only.

## PHASE 2 — Shared ResearchHub components

### BL-2-01 — Add workspace capability helper and role badge

- **Proposed issue:** `[Task 5.8]` · `RH-278` · milestone *Epic 5: Workspaces and RBAC*
- **Scope:** S · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Add one shared helper that turns a workspace role and archived state into UI capabilities, and a role badge. This work removes the role checks that three pages currently re-implement and applies the rule that controls a role cannot use are absent rather than disabled.
- **Source design files:** `Components&states.pdf` p.1; `Brand&system.pdf` p.3
- **Relevant code paths:** `frontend/src/shared/components/`, `frontend/src/pages/WorkspaceDetailPage.tsx`, `frontend/src/pages/DocumentDetailPage.tsx`, `frontend/src/pages/SourceDetailPage.tsx`
- **Existing issues:** #28
- **Dependencies:** Task 5.2 (#28), Task 3.12 (BL-1-03)
- **Acceptance criteria:**
  - The workspace, document and source pages use the helper with unchanged behavior.
  - The helper is unit tested for each role and for archived workspaces.
- **Inventory:** `UI-SHR-26`, `UI-WSP-22`
- **Duplicate check:** closest existing #28, #33 — #28 is the backend role model; #33 uses it inline.

### BL-2-02 — Add source type and processing status components

- **Proposed issue:** `[Task 7.7]` · `RH-279` · milestone *Epic 7: Object Storage and Source Metadata*
- **Scope:** M · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Add typed source-type badge and tile and source-status chip components for the supported source types. This work gives every source list, card and picker one visual language for type and processing state.
- **Source design files:** `Components&states.pdf` p.1; `Brand&system.pdf` p.2; `Sources.pdf` p.2
- **Relevant code paths:** `frontend/src/features/sources/`, `frontend/src/shared/components/`
- **Existing issues:** #46
- **Dependencies:** Task 7.6 (#46), Task 3.9 (BL-0-03), Task 3.12 (BL-1-03)
- **Acceptance criteria:**
  - Every `SourceType` and `SourceStatus` value has a visual and a unit test.
  - An unknown future value falls back to a neutral badge instead of crashing.
- **Inventory:** `UI-FND-11`, `UI-SHR-01`, `UI-SHR-02`
- **Duplicate check:** closest existing #46 — #46 required status chips functionally (text); the visual component is new.

### BL-2-03 — Build AI scope selector and source picker

- **Proposed issue:** `[Task 11.7]` · `RH-280` · milestone *Epic 11: LLM Orchestration and Citations*
- **Scope:** M · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build one shared scope chip and source picker for AI questions, authoring and comparison. This work replaces four near-identical source-selection fieldsets and keeps the AI scope visible wherever an answer is requested.
- **Source design files:** `Ask,evidence&comparison.pdf` p.1,2; `Components&states.pdf` p.2
- **Relevant code paths:** `frontend/src/shared/components/`, `frontend/src/features/ai/components/`
- **Existing issues:** #66, #68
- **Dependencies:** Task 11.5 (#68), Task 3.11 (BL-1-02), Task 3.12 (BL-1-03)
- **Acceptance criteria:**
  - `WorkspaceQuestions`, `ResearchPanel`, `AuthoringPanel` and `SourceComparisonPanel` use the shared picker.
  - The existing AI component tests pass without weakening assertions.
- **Inventory:** `UI-SHR-09`, `UI-ASK-04`
- **Duplicate check:** closest existing #68 — #68 delivered scope selection functionally inside the Ask panel; this extracts and restyles it.

### BL-2-04 — Build citation chip and citation popover

- **Proposed issue:** `[Task 11.8]` · `RH-281` · milestone *Epic 11: LLM Orchestration and Citations*
- **Scope:** L · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build the numbered citation chip and the citation popover used in documents, answers and evidence lists. This work makes every citation open the same quote, page and source preview, which is how the product shows where a claim came from.
- **Source design files:** `Components&states.pdf` p.2; `Document_editor.pdf` p.4
- **Relevant code paths:** `frontend/src/features/documents/api/researchCitation.ts`, `frontend/src/features/ai/components/`, `frontend/src/shared/components/`
- **Existing issues:** #73, #65
- **Dependencies:** Task 12.4 (#73), Task 11.2 (#65), Task 3.13 (BL-1-04), Task 3.12 (BL-1-03)
- **Acceptance criteria:**
  - A citation in the editor and in an AI answer opens the same popover.
  - Citation numbering and clipboard behavior from Task 12.4 are unchanged.
  - Popover content comes from existing citation data only.
- **Inventory:** `UI-SHR-06`, `UI-DOC-14`
- **Duplicate check:** closest existing #73, #65, #68 — #73 added the citation mark and numbering; #68 renders citation links. The popover and shared chip are new.

### BL-2-05 — Build grounded answer block and evidence list components

- **Proposed issue:** `[Task 11.9]` · `RH-282` · milestone *Epic 11: LLM Orchestration and Citations*
- **Scope:** L · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build the grounded answer block, answer state set and evidence list shared by the question, conversation and structured-response views. This work gives every AI answer the same attributable layout and the same honest states.
- **Source design files:** `Ask,evidence&comparison.pdf` p.1; `Components&states.pdf` p.3
- **Relevant code paths:** `frontend/src/features/ai/components/`, `frontend/src/shared/components/`
- **Existing issues:** #66, #69
- **Dependencies:** Task 11.3 (#66), Task 11.6 (#69), Task 3.14 (BL-1-05), Task 11.7 (BL-2-03), Task 11.8 (BL-2-04)
- **Acceptance criteria:**
  - The three existing consumers render through the shared components.
  - No state invents evidence: INSUFFICIENT_EVIDENCE always shows its reason.
  - Existing tests for streaming, cancellation and insufficient evidence pass.
- **Inventory:** `UI-SHR-10`, `UI-SHR-11`, `UI-ASK-05`, `UI-ASK-07`, `UI-ASK-10`
- **Duplicate check:** closest existing #68, #69 — #68/#69 deliver the behavior; this restyles and consolidates it.

## PHASE 3 — Application shell and navigation

### BL-3-01 — Build the authenticated app shell with sidebar and top bar

- **Proposed issue:** `[Task 3.17]` · `RH-274` · milestone *Epic 3: Frontend Foundation*
- **Scope:** XL · **Readiness:** `READY_NOW` · **Priority label:** `high-priority`
- **Objective:** Build the authenticated app shell: sidebar, workspace switcher and top bar. This work replaces the scaffold header in `AppLayoutPage` with the product's navigation frame so later pages mount into it.
- **Source design files:** `Reusable_parts.pdf` p.1,2; `Access&home.pdf` p.3; `Workspace.pdf` p.1
- **Relevant code paths:** `frontend/src/pages/AppLayoutPage.tsx`, `frontend/src/app/`, `frontend/src/shared/components/`
- **Existing issues:** #26
- **Dependencies:** Task 3.3 (#16), Task 5.7 (#33), Task 3.10 (BL-1-01), Task 3.12 (BL-1-03), Task 3.13 (BL-1-04), Task 3.16 (BL-1-07)
- **Acceptance criteria:**
  - Every `/app` page renders inside the shell with correct `nav` and `main` landmarks.
  - Entries without a destination are hidden rather than rendered dead.
  - Existing page tests pass.
- **Inventory:** `UI-SHL-01`, `UI-SHL-02`, `UI-SHL-03`, `UI-SHL-08`, `UI-FND-10`, `UI-ACC-13`, `UI-SCH-08`, `UI-STA-07`
- **Duplicate check:** closest existing #16 — #16 (closed) only promised that the shell "can later host sidebar/header/workspace navigation"; it delivered a scaffold. #68 is the Ask sidebar, unrelated.

### BL-3-02 — Add workspace section routes and navigation structure

- **Proposed issue:** `[Task 3.18]` · `RH-275` · milestone *Epic 3: Frontend Foundation*
- **Scope:** L · **Readiness:** `READY_NOW` · **Priority label:** `high-priority`
- **Objective:** Add workspace section routes (Overview, Documents, Sources, Ask AI, Members, Settings) and wire them to the sidebar. This work splits the single workspace detail page into the sections defined by the design's information architecture without breaking existing deep links.
- **Source design files:** `Brand&system.pdf` p.3
- **Relevant code paths:** `frontend/src/app/AppRouter.tsx`, `frontend/src/pages/`
- **Existing issues:** #33, #40, #46
- **Dependencies:** Task 5.7 (#33), Task 6.7 (#40), Task 7.6 (#46), Task 3.17 (BL-3-01)
- **Acceptance criteria:**
  - Each section is reachable from the sidebar and by direct URL refresh.
  - Citation and dataset deep links still resolve.
  - The page tests are migrated with equivalent assertions.
- **Inventory:** `UI-SHL-04`, `UI-FLW-01`
- **Duplicate check:** closest existing #16, #33 — #16 defined the initial routes; #33 and #40 built screens inside them. Section routing is new.

### BL-3-03 — Build the workspace tool shell with rail, secondary column and context panel

- **Proposed issue:** `[Task 3.19]` · `RH-276` · milestone *Epic 3: Frontend Foundation*
- **Scope:** L · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build the workspace tool shell: a 64 px rail, an optional secondary column and a docked 340 px context panel. This work provides the layout shared by the editor, the source reader and the Ask AI screens and replaces the inline flex layout in `DocumentDetailPage`.
- **Source design files:** `Document_editor.pdf` p.1; `Sources.pdf` p.3; `Ask,evidence&comparison.pdf` p.1; `Reusable_parts.pdf` p.5
- **Relevant code paths:** `frontend/src/pages/DocumentDetailPage.tsx`, `frontend/src/shared/components/`
- **Existing issues:** #40
- **Dependencies:** Task 3.13 (BL-1-04), Task 3.17 (BL-3-01)
- **Acceptance criteria:**
  - The editor page renders in the new shell without behavior changes.
  - Landmarks and focus order are correct for rail, column, main and panel.
  - The context panel works as docked and as slide-over.
- **Inventory:** `UI-SHL-05`
- **Duplicate check:** closest existing #40 — #40 built the editor flow with a temporary inline layout.

### BL-3-04 — Add responsive shell behavior for narrower desktop widths

- **Proposed issue:** `[Task 3.20]` · `RH-277` · milestone *Epic 3: Frontend Foundation*
- **Scope:** M · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Add the responsive shell behavior defined for 1280 px: rail instead of sidebar, slide-over context panels and reduced table columns. This work keeps the shell usable on narrower desktop windows as specified by the responsive design.
- **Source design files:** `Responsive.pdf` p.1
- **Relevant code paths:** `frontend/src/shared/components/`, `frontend/src/styles/`
- **Existing issues:** none
- **Dependencies:** Task 3.13 (BL-1-04), Task 3.17 (BL-3-01), Task 3.19 (BL-3-03)
- **Acceptance criteria:**
  - Layouts match `Responsive.pdf` at 1280 px with no horizontal page scroll.
  - The column-priority rule is unit tested.
- **Inventory:** `UI-RSP-01`, `UI-RSP-02`, `UI-RSP-03`, `UI-RSP-07`
- **Duplicate check:** closest existing #78 — #78 uses the word "responsive" for preview performance, not breakpoints.

## PHASE 4 — READY_NOW feature UI (incl. existing features to polish)

### BL-4-01 — Restyle login and register screens with the auth split layout

- **Proposed issue:** `[Task 4.8]` · `RH-283` · milestone *Epic 4: Authentication Architecture*
- **Scope:** M · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Restyle the login and register screens with the split layout from the design. This work brings the first screens users see in line with the design while keeping the existing session, CSRF and error behavior.
- **Source design files:** `Access&home.pdf` p.1,2
- **Relevant code paths:** `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/RegisterPage.tsx`, `frontend/src/features/auth/components/`
- **Existing issues:** #22, #23
- **Dependencies:** Task 4.3 (#22), Task 4.4 (#23), Task 3.8 (BL-0-02), Task 3.11 (BL-1-02), Task 3.14 (BL-1-05)
- **Acceptance criteria:**
  - Login and register behavior and copy, including "Invalid email or password.", are unchanged.
  - A password mismatch is shown before submit.
  - `LoginPage` and `RegisterPage` tests pass.
- **Inventory:** `UI-SHL-06`, `UI-ACC-01`, `UI-ACC-03`, `UI-ACC-04`, `UI-ACC-05`
- **Duplicate check:** closest existing #22, #23 — #22/#23 implemented the flows; scope here is layout and styling plus a client-only confirm field.

### BL-4-02 — Build workspace home with workspace cards and first-run empty state

- **Proposed issue:** `[Task 5.9]` · `RH-284` · milestone *Epic 5: Workspaces and RBAC*
- **Scope:** L · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the workspace home: greeting header, recent workspaces grid and the first-run empty state. This work gives users a recognizable starting point and replaces the plain workspace list.
- **Source design files:** `Access&home.pdf` p.3,4
- **Relevant code paths:** `frontend/src/pages/WorkspaceListPage.tsx`, `frontend/src/features/workspaces/components/WorkspaceList.tsx`
- **Existing issues:** #33
- **Dependencies:** Task 5.7 (#33), Task 3.15 (BL-1-06), Task 3.12 (BL-1-03), Task 3.17 (BL-3-01)
- **Acceptance criteria:**
  - A new account sees the empty state and an existing account sees its workspaces.
  - No extra requests are issued per card.
  - `WorkspaceListPage` tests pass.
- **Inventory:** `UI-ACC-07`, `UI-ACC-10`, `UI-SHR-05`
- **Duplicate check:** closest existing #33 — #33 built the list and create flow; the card, header and empty-state design are new.

### BL-4-03 — Build the create workspace dialog

- **Proposed issue:** `[Task 5.10]` · `RH-285` · milestone *Epic 5: Workspaces and RBAC*
- **Scope:** M · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the create workspace dialog with a live preview. This work turns the inline creation form into the guided two-pane dialog from the design.
- **Source design files:** `Access&home.pdf` p.5; `Key_user_flows.pdf` p.1
- **Relevant code paths:** `frontend/src/features/workspaces/components/CreateWorkspaceForm.tsx`
- **Existing issues:** #29, #33
- **Dependencies:** Task 5.3 (#29), Task 3.11 (BL-1-02), Task 3.13 (BL-1-04), Task 5.9 (BL-4-02)
- **Acceptance criteria:**
  - Creating a workspace works as today and the new workspace appears without a full reload.
  - Focus returns to the opener on close.
  - Tests cover validation and success.
- **Inventory:** `UI-ACC-11`
- **Duplicate check:** closest existing #33 — #33 listed a create dialog or page as an option and shipped an inline form.

### BL-4-04 — Build workspace overview page from existing data

- **Proposed issue:** `[Task 5.11]` · `RH-286` · milestone *Epic 5: Workspaces and RBAC*
- **Scope:** L · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the workspace overview page: hero, ask box and recent documents, sources and AI activity cards. This work gives each workspace a landing page built only from data the application already serves.
- **Source design files:** `Workspace.pdf` p.1
- **Relevant code paths:** `frontend/src/pages/WorkspaceDetailPage.tsx`, `frontend/src/features/ai/components/WorkspaceQuestions.tsx`
- **Existing issues:** #33, #68
- **Dependencies:** Task 3.15 (BL-1-06), Task 5.8 (BL-2-01), Task 7.7 (BL-2-02), Task 3.18 (BL-3-02)
- **Acceptance criteria:**
  - The overview renders from the existing documents, sources, members and conversations queries.
  - Viewers see no create or upload controls.
  - Existing workspace page tests are migrated with equivalent assertions.
- **Inventory:** `UI-WSP-01`, `UI-WSP-02`, `UI-WSP-04`, `UI-WSP-05`, `UI-WSP-07`
- **Duplicate check:** closest existing #33 — #33 shipped a detail page with lists; the overview composition is new.

### BL-4-05 — Build members page and role management UI

- **Proposed issue:** `[Task 5.12]` · `RH-287` · milestone *Epic 5: Workspaces and RBAC*
- **Scope:** M · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the members page with the role chips, role menu, add-member card and role information from the design. This work gives workspace owners a clear view of who has access and what each role can do.
- **Source design files:** `Workspace.pdf` p.4; `Components&states.pdf` p.1
- **Relevant code paths:** `frontend/src/features/workspaces/components/MemberList.tsx`, `frontend/src/features/workspaces/components/AddMemberForm.tsx`
- **Existing issues:** #31, #32
- **Dependencies:** Task 5.5 (#31), Task 5.6 (#32), Task 3.11 (BL-1-02), Task 3.13 (BL-1-04), Task 5.8 (BL-2-01)
- **Acceptance criteria:**
  - Role changes, removal and add-by-email behave as today.
  - Non-owners see no management controls.
  - Member list and add-member tests pass.
- **Inventory:** `UI-WSP-15`, `UI-WSP-16`, `UI-WSP-17`, `UI-WSP-19`, `UI-REV-07`, `UI-REV-08`
- **Duplicate check:** closest existing #32, #33 — #31/#32 delivered the behavior; this is the redesigned page.

### BL-4-06 — Build workspace settings page and archive confirmation dialog

- **Proposed issue:** `[Task 5.13]` · `RH-288` · milestone *Epic 5: Workspaces and RBAC*
- **Scope:** M · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the workspace settings page and the archive confirmation dialog. This work separates workspace administration from the working views and states clearly what archiving does.
- **Source design files:** `Search,settings&internal_tools.pdf` p.2
- **Relevant code paths:** `frontend/src/features/workspaces/components/EditWorkspaceForm.tsx`, `frontend/src/features/workspaces/components/ArchiveWorkspaceButton.tsx`
- **Existing issues:** #30
- **Dependencies:** Task 5.4 (#30), Task 3.11 (BL-1-02), Task 3.13 (BL-1-04), Task 5.8 (BL-2-01)
- **Acceptance criteria:**
  - The archive wording matches the current behavior and does not promise restoring.
  - Owner, editor and viewer variants are covered by tests.
  - Archiving still returns the user to the workspace list.
- **Inventory:** `UI-WSP-20`, `UI-WSP-21`
- **Duplicate check:** closest existing #30, #33 — #30 implemented update and archive; the page and dialog design are new.

### BL-4-07 — Build documents list page

- **Proposed issue:** `[Task 6.8]` · `RH-289` · milestone *Epic 6: Persistent Documents Before Realtime Collaboration*
- **Scope:** M · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build the documents list page with the table, row actions and empty state from the design. This work gives documents a dedicated entry point instead of a list on the workspace page.
- **Source design files:** `Workspace.pdf` p.3
- **Relevant code paths:** `frontend/src/features/documents/components/DocumentList.tsx`, `frontend/src/features/documents/components/CreateDocumentForm.tsx`
- **Existing issues:** #35, #40
- **Dependencies:** Task 6.7 (#40), Task 3.15 (BL-1-06), Task 3.16 (BL-1-07), Task 3.18 (BL-3-02)
- **Acceptance criteria:**
  - Rename and Archive use the existing update and archive endpoints and respect roles.
  - Viewers see no create, rename or archive controls.
  - `DocumentList` tests pass.
- **Inventory:** `UI-WSP-11`, `UI-WSP-13`, `UI-SHR-04`
- **Duplicate check:** closest existing #40 — #40 built a title-only list; the table page is new.

### BL-4-08 — Build document editor frame with documents column and outline

- **Proposed issue:** `[Task 6.9]` · `RH-290` · milestone *Epic 6: Persistent Documents Before Realtime Collaboration*
- **Scope:** L · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the document editor frame: documents column, outline, top bar and context panel slot. This work gives the editor the writing layout from the design while reusing the existing editor and AI panels.
- **Source design files:** `Document_editor.pdf` p.1; `Reusable_parts.pdf` p.5
- **Relevant code paths:** `frontend/src/pages/DocumentDetailPage.tsx`, `frontend/src/features/documents/components/`
- **Existing issues:** #40, #103
- **Dependencies:** Task 6.7 (#40), Task 3.19 (BL-3-03)
- **Acceptance criteria:**
  - The editor opens, edits and autosaves exactly as before in the new frame.
  - `DocumentDetailPage` and `DocumentWorkspaceFlow` tests pass.
  - The outline updates as headings change.
- **Inventory:** `UI-DOC-01`, `UI-DOC-02`, `UI-DOC-03`, `UI-DOC-04`, `UI-DOC-08`, `UI-FND-12`, `UI-SHR-07`
- **Duplicate check:** closest existing #40 — #40 shipped the editor flow with a temporary layout.

### BL-4-09 — Style document paper, formatting toolbar and content blocks

- **Proposed issue:** `[Task 6.10]` · `RH-291` · milestone *Epic 6: Persistent Documents Before Realtime Collaboration*
- **Scope:** M · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Style the document paper, the formatting toolbar and the content blocks. This work makes the editing surface look and read like the design (serif title, readable body, tables and figures).
- **Source design files:** `Document_editor.pdf` p.1; `Reusable_parts.pdf` p.5; `Components&states.pdf` p.2
- **Relevant code paths:** `frontend/src/features/documents/components/DocumentBodyEditor.tsx`, `frontend/src/styles/`
- **Existing issues:** #37, #40
- **Dependencies:** Task 6.4 (#37), Task 3.8 (BL-0-02), Task 3.9 (BL-0-03), Task 3.10 (BL-1-01), Task 6.9 (BL-4-08)
- **Acceptance criteria:**
  - Stored ProseMirror content is unchanged.
  - Toolbar buttons keep their accessible names.
  - Editor tests pass.
- **Inventory:** `UI-DOC-05`, `UI-DOC-06`, `UI-DOC-07`
- **Duplicate check:** closest existing #37, #40 — #37 integrated the editor with a minimal toolbar; styling is new.

### BL-4-10 — Build save status, conflict and read-only document states

- **Proposed issue:** `[Task 6.11]` · `RH-292` · milestone *Epic 6: Persistent Documents Before Realtime Collaboration*
- **Scope:** M · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the save status chip, conflict banner and read-only viewer states. This work makes it obvious to the writer whether text is stored and what happens when it is not.
- **Source design files:** `Components&states.pdf` p.3; `Document_editor.pdf` p.1; `Review,history&roles.pdf` p.3
- **Relevant code paths:** `frontend/src/features/documents/components/SaveStatus.tsx`, `frontend/src/features/documents/components/DocumentEditorForm.tsx`
- **Existing issues:** #36, #38
- **Dependencies:** Task 6.5 (#38), Task 6.3 (#36), Task 3.14 (BL-1-05), Task 6.9 (BL-4-08)
- **Acceptance criteria:**
  - Autosave, conflict and restore behavior is unchanged.
  - No copy claims that text is stored locally.
  - `SaveStatus` and viewer tests pass.
- **Inventory:** `UI-SHR-28`, `UI-DOC-16`, `UI-REV-06`
- **Duplicate check:** closest existing #36, #38 — #36/#38 implemented the mechanics.

### BL-4-11 — Build document version history panel

- **Proposed issue:** `[Task 6.12]` · `RH-293` · milestone *Epic 6: Persistent Documents Before Realtime Collaboration*
- **Scope:** M · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the version history panel from the design on top of the existing history, preview and restore behavior. This work presents the document history as a clear, safe list of restore points.
- **Source design files:** `Review,history&roles.pdf` p.2
- **Relevant code paths:** `frontend/src/features/documents/components/DocumentHistory.tsx`
- **Existing issues:** #39, #104
- **Dependencies:** Task 6.6 (#39), Task 3.13 (BL-1-04), Task 6.9 (BL-4-08)
- **Acceptance criteria:**
  - Restoring creates a new revision and never removes later versions.
  - History, preview and restore tests pass.
- **Inventory:** `UI-SHR-24`, `UI-DOC-17`, `UI-REV-03`
- **Duplicate check:** closest existing #39, #104 — #39 delivered history and restore; #104 (open) adds named snapshots. The panel design is new.

### BL-4-22 — Build version diff preview for document history

- **Proposed issue:** `[Task 6.13]` · `RH-294` · milestone *Epic 6: Persistent Documents Before Realtime Collaboration*
- **Scope:** M · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build the version diff preview that compares a stored version with the current document. This work lets writers see what changed before they restore anything.
- **Source design files:** `Review,history&roles.pdf` p.2
- **Relevant code paths:** `frontend/src/features/documents/components/DocumentHistory.tsx`, `frontend/src/features/documents/api/`
- **Existing issues:** #39
- **Dependencies:** Task 6.11 (BL-4-10), Task 6.12 (BL-4-11)
- **Acceptance criteria:**
  - A diff never mutates the open document.
  - Identical versions show an explicit "no differences" state.
  - The diff algorithm is unit tested.
- **Inventory:** `UI-REV-04`
- **Duplicate check:** closest existing #39 — #39 has no diff; none of #104's bullets describes one.

### BL-4-12 — Build source library page

- **Proposed issue:** `[Task 7.8]` · `RH-295` · milestone *Epic 7: Object Storage and Source Metadata*
- **Scope:** L · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the source library page with type tabs, the sources table, status chips and row actions. This work gives the shared source library the layout and clarity of the design.
- **Source design files:** `Sources.pdf` p.1; `Components&states.pdf` p.3
- **Relevant code paths:** `frontend/src/features/sources/components/SourceList.tsx`, `frontend/src/pages/`
- **Existing issues:** #46, #140, #139
- **Dependencies:** Task 7.6 (#46), Task 3.15 (BL-1-06), Task 3.16 (BL-1-07), Task 7.7 (BL-2-02), Task 3.18 (BL-3-02)
- **Acceptance criteria:**
  - List, download and reprocess behavior is unchanged.
  - Viewers do not see upload or retry controls.
  - Source list tests pass.
- **Inventory:** `UI-SRC-01`, `UI-SRC-03`, `UI-SRC-05`, `UI-SRC-17`, `UI-SHR-03`
- **Duplicate check:** closest existing #46, #140 — #46 built the library; #140 (open) is search/filter. This restyles the page and excludes the toolbar filters.

### BL-4-13 — Build upload sources dialog

- **Proposed issue:** `[Task 7.9]` · `RH-296` · milestone *Epic 7: Object Storage and Source Metadata*
- **Scope:** M · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the upload sources dialog with a dropzone and a per-file queue. This work lets users add several files at once and watch each file move from uploaded to ready.
- **Source design files:** `Sources.pdf` p.2; `Key_user_flows.pdf` p.1
- **Relevant code paths:** `frontend/src/features/sources/components/SourceUploadForm.tsx`
- **Existing issues:** #44, #46
- **Dependencies:** Task 7.4 (#44), Task 3.11 (BL-1-02), Task 3.13 (BL-1-04), Task 7.7 (BL-2-02)
- **Acceptance criteria:**
  - Each file is uploaded with the existing endpoint and progress callback.
  - Rejected files show the same messages as today.
  - Upload form tests pass.
- **Inventory:** `UI-SRC-07`
- **Duplicate check:** closest existing #44, #46 — #46 required drag/drop or file picker; the form ships a picker. Queue and dialog are new.

### BL-4-14 — Build source detail page layout

- **Proposed issue:** `[Task 9.7]` · `RH-297` · milestone *Epic 9: Document Parsing*
- **Scope:** L · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the source detail page layout around the existing source features. This work presents source metadata, processing state and previews in the workspace tool layout.
- **Source design files:** `Sources.pdf` p.3,2; `Reusable_parts.pdf` p.5
- **Relevant code paths:** `frontend/src/pages/SourceDetailPage.tsx`, `frontend/src/features/sources/components/`
- **Existing issues:** #57, #138, #76
- **Dependencies:** Task 9.6 (#57), Task 7.7 (BL-2-02), Task 3.19 (BL-3-03), Task 3.15 (BL-1-06)
- **Acceptance criteria:**
  - All current source detail behavior and deep links keep working.
  - Tests for `SourceDetailPage` and version history pass.
- **Inventory:** `UI-SRC-08`, `UI-SRC-11`, `UI-SRC-15`, `UI-SRC-16`, `UI-SHR-13`
- **Duplicate check:** closest existing #57, #138 — #57 delivered the preview UI; #138 is metadata. The layout and restyle are new.

### BL-4-15 — Build Ask AI page

- **Proposed issue:** `[Task 11.10]` · `RH-298` · milestone *Epic 11: LLM Orchestration and Citations*
- **Scope:** XL · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build the Ask AI page in the workspace tool shell using the existing research conversations. This work promotes the research conversation from a panel beside the editor to a full page with an investigations list and a citation panel.
- **Source design files:** `Ask,evidence&comparison.pdf` p.1; `Key_user_flows.pdf` p.1
- **Relevant code paths:** `frontend/src/features/ai/components/ResearchPanel.tsx`, `frontend/src/features/ai/components/WorkspaceQuestions.tsx`, `frontend/src/pages/`
- **Existing issues:** #67, #68, #69
- **Dependencies:** Task 11.4 (#67), Task 11.6 (#69), Task 11.7 (BL-2-03), Task 11.8 (BL-2-04), Task 11.9 (BL-2-05), Task 3.19 (BL-3-03)
- **Acceptance criteria:**
  - Asking, streaming, cancelling and reloading history behave as in the current panel.
  - Selecting a citation updates the panel and opens the source page at the cited location.
  - `ResearchPanel` tests are migrated with equivalent assertions.
- **Inventory:** `UI-ASK-01`, `UI-ASK-02`, `UI-ASK-04`, `UI-ASK-09`, `UI-ASK-12`
- **Duplicate check:** closest existing #68, #67, #69 — #68 built the panel beside the editor; a standalone page is new.

### BL-4-16 — Build scoped Ask this source view

- **Proposed issue:** `[Task 11.11]` · `RH-299` · milestone *Epic 11: LLM Orchestration and Citations*
- **Scope:** M · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build the Ask this source view that scopes a question to one source and shows where it says so. This work lets a reader interrogate a single paper and see the cited page and quote.
- **Source design files:** `Ask,evidence&comparison.pdf` p.2
- **Relevant code paths:** `frontend/src/features/ai/components/`, `frontend/src/pages/SourceDetailPage.tsx`
- **Existing issues:** #66
- **Dependencies:** Task 11.3 (#66), Task 11.10 (BL-4-15), Task 9.7 (BL-4-14)
- **Acceptance criteria:**
  - A question is sent with `selectedSourceIds` set to the source.
  - Switching scope re-runs and keeps the scope visible above the answer.
- **Inventory:** `UI-ASK-14`
- **Duplicate check:** closest existing #66, #68 — #66 supports source scoping; the dedicated view is new.

### BL-4-17 — Build document selection toolbar for AI rewrite actions

- **Proposed issue:** `[Task 12.7]` · `RH-300` · milestone *Epic 12: AI-Assisted Authoring*
- **Scope:** M · **Readiness:** `READY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build the floating selection toolbar that starts AI rewrite and evidence actions on selected text. This work puts the existing rewrite actions where the writer is looking, while the suggestion still needs explicit approval.
- **Source design files:** `Document_editor.pdf` p.2
- **Relevant code paths:** `frontend/src/features/documents/components/DocumentBodyEditor.tsx`, `frontend/src/features/ai/components/AuthoringPanel.tsx`
- **Existing issues:** #71, #72
- **Dependencies:** Task 12.2 (#71), Task 3.13 (BL-1-04), Task 6.10 (BL-4-09)
- **Acceptance criteria:**
  - The toolbar sends the same commands as the panel.
  - Keyboard users can reach the actions.
  - Authoring tests pass.
- **Inventory:** `UI-DOC-09`
- **Duplicate check:** closest existing #71 — #71 delivered rewrite through a panel; a floating toolbar is new.

### BL-4-18 — Build generate section panel

- **Proposed issue:** `[Task 12.8]` · `RH-301` · milestone *Epic 12: AI-Assisted Authoring*
- **Scope:** L · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the Generate section panel and the in-document AI draft block. This work presents source-grounded drafting with clear controls and a draft that is clearly not in the document yet.
- **Source design files:** `Document_editor.pdf` p.3
- **Relevant code paths:** `frontend/src/features/ai/components/AuthoringPanel.tsx`
- **Existing issues:** #70, #141
- **Dependencies:** Task 12.1 (#70), Task 11.7 (BL-2-03), Task 3.19 (BL-3-03), Task 6.10 (BL-4-09)
- **Acceptance criteria:**
  - Insertion keeps explicit approval and idempotency.
  - The draft never changes the document until accepted.
  - `AuthoringPanel` tests pass.
- **Inventory:** `UI-DOC-12`, `UI-DOC-13`
- **Duplicate check:** closest existing #70 — #70 delivered section generation behavior.

### BL-4-19 — Build AI suggestion card and find evidence panel

- **Proposed issue:** `[Task 12.9]` · `RH-302` · milestone *Epic 12: AI-Assisted Authoring*
- **Scope:** L · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the AI suggestion card and the find evidence panel for a selected claim. This work makes AI changes reviewable and puts supporting evidence next to the claim.
- **Source design files:** `Document_editor.pdf` p.2; `Ask,evidence&comparison.pdf` p.3; `Key_user_flows.pdf` p.3
- **Relevant code paths:** `frontend/src/features/ai/components/AuthoringPanel.tsx`
- **Existing issues:** #71, #72
- **Dependencies:** Task 12.3 (#72), Task 12.7 (BL-4-17), Task 11.8 (BL-2-04), Task 11.9 (BL-2-05)
- **Acceptance criteria:**
  - Accept, reject and edit use the existing endpoints with the stale-revision guard.
  - Evidence cards show only data the candidate carries.
  - Tests pass.
- **Inventory:** `UI-SHR-12`, `UI-DOC-10`, `UI-ASK-13`, `UI-FLW-03`
- **Duplicate check:** closest existing #71, #72 — #71/#72 delivered the behavior.

### BL-4-20 — Build compare sources view

- **Proposed issue:** `[Task 12.10]` · `RH-303` · milestone *Epic 12: AI-Assisted Authoring*
- **Scope:** L · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the compare sources view with the grid, summary and disagreement card from the design. This work gives literature comparison a readable grid in which every cell is cited.
- **Source design files:** `Ask,evidence&comparison.pdf` p.4; `Key_user_flows.pdf` p.4
- **Relevant code paths:** `frontend/src/features/ai/components/SourceComparisonPanel.tsx`
- **Existing issues:** #74, #75
- **Dependencies:** Task 12.5 (#74), Task 12.6 (#75), Task 3.15 (BL-1-06), Task 11.7 (BL-2-03), Task 11.8 (BL-2-04)
- **Acceptance criteria:**
  - Comparison and disagreement requests are unchanged.
  - Missing research fields stay missing.
  - `SourceComparisonPanel` tests and its coverage threshold hold.
- **Inventory:** `UI-ASK-15`, `UI-ASK-16`, `UI-FLW-04`
- **Duplicate check:** closest existing #74, #75 — #74/#75 delivered comparison and disagreement analysis.

### BL-4-21 — Build spreadsheet viewer from the dataset preview

- **Proposed issue:** `[Task 13.4]` · `RH-304` · milestone *Epic 13: Dataset Inspection*
- **Scope:** M · **Readiness:** `EXISTS_NEEDS_POLISH` · **Priority label:** `medium-priority`
- **Objective:** Build the spreadsheet viewer layout around the existing bounded dataset preview. This work presents the safe dataset preview with the clarity of the design while keeping its limits visible.
- **Source design files:** `Sources.pdf` p.4
- **Relevant code paths:** `frontend/src/features/analysis/components/DatasetPreviewPanel.tsx`
- **Existing issues:** #77, #78
- **Dependencies:** Task 13.3 (#78), Task 3.15 (BL-1-06), Task 3.16 (BL-1-07), Task 7.7 (BL-2-02)
- **Acceptance criteria:**
  - Every value is rendered as inert text.
  - The preview remains bounded and keeps its limit and warning notes.
  - `DatasetPreviewPanel` tests and the analysis coverage threshold pass.
- **Inventory:** `UI-SRC-10`, `UI-SHR-18`
- **Duplicate check:** closest existing #78 — #78 (open) describes the functional preview UI, which already exists in the working tree; this issue is the visual redesign only.

## PHASE 5 — UI_ONLY_NOW feature UI

### BL-5-01 — Build analysis status, pipeline and result presentation components

- **Proposed issue:** `[Task 15.8]` · `RH-305` · milestone *Epic 15: Analysis Artifacts and Provenance*
- **Scope:** L · **Readiness:** `UI_ONLY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build presentational analysis components with typed props: status chip, pipeline step cards, code panel, result table, chart card frame, freshness banner and analysis list item. This work lets the analysis screens be assembled quickly once the analysis contracts exist, without inventing backend semantics.
- **Source design files:** `Analysis_studio.pdf` p.1,3; `Results,provenance&insert.pdf` p.1,3; `Components&states.pdf` p.2
- **Relevant code paths:** `frontend/src/features/analysis/components/`, `frontend/src/shared/components/`
- **Existing issues:** #87, #86, #79
- **Dependencies:** Task 3.12 (BL-1-03), Task 3.14 (BL-1-05), Task 3.15 (BL-1-06)
- **Acceptance criteria:**
  - Components have no knowledge of the planner or the sandbox.
  - All text inputs render as inert text and code is never executed.
  - Each component has a unit test with typed fixtures.
- **Inventory:** `UI-SHR-16`, `UI-SHR-17`, `UI-SHR-19`, `UI-SHR-20`, `UI-SHR-21`, `UI-SHR-22`, `UI-ANA-02`, `UI-ANA-03`, `UI-PRM-22`, `UI-RES-08`
- **Duplicate check:** closest existing #87, #90 — #87 is the full screen and is BLOCKED on #84/#85/#86; this issue covers only stateless presentational parts and does not overlap its integration scope.

### BL-5-02 — Build command search dialog for workspace sources

- **Proposed issue:** `[Task 24.5]` · `RH-306` · milestone *Epic 24: Advanced Source and Research Workflows*
- **Scope:** L · **Readiness:** `UI_ONLY_NOW` · **Priority label:** `medium-priority`
- **Objective:** Build the keyboard-driven search dialog (Cmd or Ctrl K) over the workspace's source text using the existing retrieval search. This work gives researchers the fast path to a passage in any source, with a preview and a link to the cited page.
- **Source design files:** `Search,settings&internal_tools.pdf` p.1; `Components&states.pdf` p.4
- **Relevant code paths:** `frontend/src/features/sources/`, `frontend/src/shared/components/`
- **Existing issues:** #140, #62
- **Dependencies:** Task 10.5 (#62), Task 3.13 (BL-1-04), Task 3.11 (BL-1-02), Task 3.15 (BL-1-06)
- **Acceptance criteria:**
  - Results come only from `GET /api/workspaces/{id}/retrieval/search` and respect workspace scope.
  - The dialog is fully keyboard operable and announces result counts.
  - Tests cover keyboard navigation and the empty state.
- **Inventory:** `UI-SCH-01`, `UI-SCH-03`, `UI-SCH-04`
- **Duplicate check:** closest existing #140, #62 — #140 is source list search and filtering; #62 is the retrieval index. No issue covers a keyboard search surface.

## PHASE 6 — BLOCKED UI

Do not implement yet. **No new issue is proposed**: either an existing open issue already owns the work (the UI should be built under it and the design reference attached), or the blocker has no issue and appears in Phase 7.

### BL-6-01 — Analyses screens: list, new analysis, running, failed

- **Scope:** XL · **Readiness:** `BLOCKED`
- **Objective:** Build the Analyses list, New analysis, Running and Failed screens once an analysis can be created, executed and failed in a recoverable way.
- **Source design files:** `Analysis_studio.pdf` p.1,2,3,4; `Key_user_flows.pdf` p.2
- **Relevant code paths:** none (`frontend/src/features/analysis/` holds only the dataset preview); `backend/src/main/java/dev/researchhub/analysis/` has only `DatasetPreviewController`
- **Existing issues / blockers:** Blocked by #79 (request/domain), #80 (plan schema), #81–#83 (sandbox), #84 (orchestration), #85 (artifact persistence). Related: #87.
- **Dependencies:** #79, #80, #84, #85, BL-5-01 (presentational parts), BL-7-30
- **Unblock criteria:**
  - an analysis entity and API exist with the statuses Queued, Running, Completed, Failed;
  - failure causes are structured enough to drive the Quick fixes list (or the list is dropped by decision);
  - design reference note added to #87 and #84 (see below).
- **Inventory:** `UI-ANA-01`, `UI-ANA-04`, `UI-ANA-05`, `UI-ANA-06`, `UI-WSP-06`, `UI-FLW-02`

### BL-6-02 — Analysis result and provenance screens

- **Scope:** XL · **Readiness:** `BLOCKED`
- **Objective:** Build the Analysis result screen (chart, result table, code, provenance panel) and the Provenance chain screen.
- **Source design files:** `Results,provenance&insert.pdf` p.1,2
- **Relevant code paths:** none
- **Existing issues / blockers:** Blocked by #85 (artifacts), #86 (chart output contract), #88 (re-run semantics), #89 (provenance API). This is exactly the scope of #87 (open) — do **not** create another issue.
- **Dependencies:** #85, #86, #88, #89, BL-5-01
- **Unblock criteria:**
  - result, chart and provenance endpoints exist and are typed;
  - #87 acceptance criteria satisfied with the design reference attached.
- **Inventory:** `UI-RES-01`, `UI-RES-02`, `UI-RES-03`, `UI-RES-04`

### BL-6-03 — Insert result dialog, analysis block in the document and out-of-date handling

- **Scope:** L · **Readiness:** `BLOCKED`
- **Objective:** Build the Insert result dialog, the analysis block node rendering and the freshness banner in the editor.
- **Source design files:** `Results,provenance&insert.pdf` p.3; `Key_user_flows.pdf` p.2
- **Relevant code paths:** `frontend/src/features/documents/api/documentContent.ts` (extensions) — no analysis node
- **Existing issues / blockers:** Covered by #90 (open: document analysis block node); blocked by #87, #88, #89.
- **Dependencies:** #87, #88, #89, #90
- **Unblock criteria:**
  - the analysis block node and its persistence exist (#90);
  - freshness/stale data is exposed by the provenance API (#88/#89).
- **Inventory:** `UI-RES-05`, `UI-RES-06`

### BL-6-04 — Comments: panel, anchors, threads and composer

- **Scope:** L · **Readiness:** `BLOCKED`
- **Objective:** Build the comments panel, text anchors and composer in the editor.
- **Source design files:** `Review,history&roles.pdf` p.1; `Components&states.pdf` p.2
- **Relevant code paths:** none
- **Existing issues / blockers:** Covered by #100 (open: Build comments UI); blocked by #99 (domain model). #101 adds `@AI find evidence`.
- **Dependencies:** #99, #100
- **Unblock criteria:**
  - comment domain and API exist (#99);
  - #100 acceptance criteria include the design's panel states (composer, reply, resolve, resolved group).
- **Inventory:** `UI-SHR-23`, `UI-REV-01`, `UI-REV-02`, `UI-DOC-19`

### BL-6-05 — Live presence in the editor and top bar

- **Scope:** L · **Readiness:** `BLOCKED`
- **Objective:** Show who is editing or viewing: carets with name labels, presence pills and the avatar stack of people currently in the document.
- **Source design files:** `Workspace.pdf` p.4; `Review,history&roles.pdf` p.1
- **Relevant code paths:** none (editor has no collaboration extension)
- **Existing issues / blockers:** Covered by #97 (open); blocked by #95 (Yjs integration), #94 (token/handshake). Member avatar stack (not live) is in BL-1-03/BL-3-01.
- **Dependencies:** #92, #93, #94, #95, #97
- **Unblock criteria:**
  - Yjs presence data exists (#95/#97);
  - #97 acceptance criteria reference the design's caret label and pill treatments.
- **Inventory:** `UI-SHR-15`, `UI-DOC-18`

### BL-6-06 — Provenance inspector and content-origin data

- **Scope:** XL · **Readiness:** `BLOCKED`
- **Objective:** Show per-paragraph origin (human / AI generated / AI rewritten / imported / source-derived / analysis-derived), AI modifications, sources and paragraph history, and draw the origin bars.
- **Source design files:** `Document_editor.pdf` p.4; `Brand&system.pdf` p.2
- **Relevant code paths:** `document_versions.reason` includes AI_ACCEPTANCE; no paragraph-level data
- **Existing issues / blockers:** Blocked by #103 (contribution/provenance metadata) and #102 (audit events). Document history is #104.
- **Dependencies:** #102, #103
- **Unblock criteria:**
  - paragraph-level contribution and AI-origin metadata can be read per document;
  - decision on whether human-written shows no bar (token page) or an ink bar (editor legend).
- **Inventory:** `UI-SHR-07`, `UI-SHR-08`, `UI-DOC-15`, `UI-FND-12`

### BL-6-07 — Activity page, workspace activity widgets, Home digest and notifications

- **Scope:** XL · **Readiness:** `BLOCKED`
- **Objective:** Build the Activity timeline, the Overview/Home activity cards, the Home digest and the notification center.
- **Source design files:** `Workspace.pdf` p.1,2; `Access&home.pdf` p.3
- **Relevant code paths:** none
- **Existing issues / blockers:** Needs #102 (audit events). Notifications are an open decision (`docs/context.md` §37); no issue.
- **Dependencies:** #102, BL-7-01, BL-7-09
- **Unblock criteria:**
  - audit events exposed to the UI with actor, object and time;
  - notification scope decided (BL-7-01).
- **Inventory:** `UI-SHR-25`, `UI-ACC-08`, `UI-ACC-09`, `UI-WSP-08`, `UI-WSP-09`

### BL-6-08 — AI debugger (internal, staff only)

- **Scope:** XL · **Readiness:** `BLOCKED`
- **Objective:** Build the AI debugger shell and its components (question card, metadata, latency bar, chunk table, token budget, answer check, prompt).
- **Source design files:** `Search,settings&internal_tools.pdf` p.4
- **Relevant code paths:** `backend/src/main/java/dev/researchhub/ai/` persists model call audit (migration `V15`) but exposes no debugger API; no staff role exists
- **Existing issues / blockers:** Covered by #113 (open); needs #112 (usage/cost telemetry) and #111 metrics. Security: staff-only and cross-workspace data protection.
- **Dependencies:** #111, #112, #113
- **Unblock criteria:**
  - a protected debugger API exists (#113);
  - the chunk table layout intent is used, not the PDF's broken render (see conflicts).
- **Inventory:** `UI-SHL-07`, `UI-SCH-10`

### BL-6-09 — Named versions and scheduled snapshots in version history

- **Scope:** M · **Readiness:** `BLOCKED`
- **Objective:** Show manual named versions ("Before X's edits") and scheduled snapshots in the history list.
- **Source design files:** `Review,history&roles.pdf` p.2
- **Relevant code paths:** `frontend/src/features/documents/components/DocumentHistory.tsx`
- **Existing issues / blockers:** Covered by #104 (open); depends on #96/#92 for collaborative state.
- **Dependencies:** #104
- **Unblock criteria:**
  - version names and reasons are stored and returned.
- **Inventory:** `UI-REV-05`

### BL-6-10 — Source bibliographic metadata panel

- **Scope:** M · **Readiness:** `BLOCKED`
- **Objective:** Show title, authors, year, DOI and venue in the source metadata card and Compare headers.
- **Source design files:** `Sources.pdf` p.3; `Ask,evidence&comparison.pdf` p.4
- **Relevant code paths:** `frontend/src/pages/SourceDetailPage.tsx`
- **Existing issues / blockers:** Covered by #138 (open: Add source bibliographic metadata).
- **Dependencies:** #138
- **Unblock criteria:**
  - metadata fields exist and are editable.
- **Inventory:** `UI-SRC-11 (partial)`

### BL-6-11 — Source library search, filters and folders

- **Scope:** M · **Readiness:** `BLOCKED`
- **Objective:** Add the library search box, Status and Uploaded-by filters, saved filters and folder chips.
- **Source design files:** `Sources.pdf` p.1; `Brand&system.pdf` p.3
- **Relevant code paths:** `frontend/src/features/sources/components/SourceList.tsx`
- **Existing issues / blockers:** Covered by #140 (open: source search and filtering) and #139 (open: tags/folders).
- **Dependencies:** #139, #140, BL-4-12
- **Unblock criteria:**
  - backend filter parameters exist;
  - #140's acceptance criteria reference the design toolbar.
- **Inventory:** `UI-SRC-02`, `UI-RSP-06 (folders)`

### BL-6-12 — Collaboration permission downgrade UI

- **Scope:** M · **Readiness:** `BLOCKED`
- **Objective:** Show the read-only transition when a role is downgraded or a member is removed during an editing session.
- **Source design files:** `Review,history&roles.pdf` p.3
- **Relevant code paths:** none
- **Existing issues / blockers:** Covered by #98 (open).
- **Dependencies:** #94, #97, #98
- **Unblock criteria:**
  - revocation signal exists on the collaboration channel.
- **Inventory:** `UI-REV-09`

### BL-6-13 — Internet-search trust mode in Generate section

- **Scope:** S · **Readiness:** `BLOCKED`
- **Objective:** Add the Internet toggle (off by default) to the Generate section panel.
- **Source design files:** `Document_editor.pdf` p.3
- **Relevant code paths:** `frontend/src/features/ai/components/AuthoringPanel.tsx`
- **Existing issues / blockers:** Covered by #141 (open: external literature search as a separate trust mode); `docs/context.md` §37 leaves internet search open.
- **Dependencies:** #141
- **Unblock criteria:**
  - trust-mode backend and policy exist.
- **Inventory:** `UI-DOC-12 (partial)`

## PHASE 7 — Design decisions required

Each row is a question the owner must answer before the dependent UI is built. None of them has a GitHub issue; answering one may produce a backend task, a design clarification, or a decision to drop the element. **Nothing here should be built from the mockup alone.**

| ID | Decision | Question | Design source | Affected inventory | Existing issue | Scope of dependent work |
| --- | --- | --- | --- | --- | --- | --- |
| `BL-7-01` | Notifications | Should the product have notifications (bell, unread dot, notification center, "Mark all as read")? `docs/context.md` §37 lists notifications as intentionally left open. | Workspace.pdf p.2; Reusable_parts.pdf p.2 | `UI-WSP-10`, `UI-SCH-07`, `UI-SHL-03`, `UI-ACC-08` | No issue | L |
| `BL-7-02` | Dark mode scope and theme preference | Dark tints/inks/shadows are undefined (only 10 tokens given). Where is Light/Dark/System stored: browser only, or the account? | Brand&system.pdf p.2; Search,settings&internal_tools.pdf p.3 | `UI-FND-06`, `UI-SCH-06` | No issue | L |
| `BL-7-03` | Font delivery and unnamed faces | Self-host Plus Jakarta Sans and Source Serif (OFL) or use a CDN? Which monospace and handwritten faces? | Brand&system.pdf p.1; Brand&system.pdf p.2 | `UI-FND-03` | No issue | S |
| `BL-7-04` | Illustration and logo asset delivery | Provide layered SVG for the 12 scenes, character kit and lock-up. Until then components render art slots empty. | Brand&system.pdf p.4; Reusable_parts.pdf p.4 | `UI-FND-09`, `UI-PRM-21` | No issue | XL |
| `BL-7-05` | Workspace accent, icon and tagline | Should a workspace store accent color, icon and a subtitle/due date? Visible in the create dialog, cards, overview hero and settings. Needs a backend field and migration. | Access&home.pdf p.3; Access&home.pdf p.5; Workspace.pdf p.1; Search,settings&internal_tools.pdf p.2 | `UI-ACC-12`, `UI-WSP-01`, `UI-SHR-05` | No issue (would extend #29/#30) | M |
| `BL-7-06` | Document metadata: status, kind, last edited by, evidence summary | Draft / Notes / In review, a "Mine" filter, author names and "14 cited · 2 need citation" are not in the document contract. | Workspace.pdf p.3; Document_editor.pdf p.1 | `UI-WSP-12`, `UI-DOC-04`, `UI-SHR-04` | Partly #103 (authorship); otherwise none | M |
| `BL-7-07` | "Saved evidence" concept | A user-saved passage attached to a source, cited or not. Appears in the PDF reader, Overview, Documents, Compare and Flow 3. No entity, API or issue. | Sources.pdf p.3; Workspace.pdf p.1; Key_user_flows.pdf p.3 | `UI-SRC-13`, UI-ASK-13 (Add as note) | No issue | L |
| `BL-7-08` | "Open question" concept | Marking a claim as an open question (chip, "Mark as open question", "Keep as open question"). No concept exists. | Components&states.pdf p.4; Ask,evidence&comparison.pdf p.5 | `UI-ASK-17`, UI-PRM-07 (label) | No issue | M |
| `BL-7-09` | Cross-workspace aggregates for Home | Recently edited documents, recent sources and activity across all workspaces need a new endpoint (or an agreed per-workspace composition). | Access&home.pdf p.3 | `UI-ACC-09` | No issue | M |
| `BL-7-10` | Invitations, pending invites and "Request edit access" | The backend has no invitation or access-request feature (`AddMemberForm` states so). Design shows Resend, "Invited Sep 28", an email promise and Request edit access. | Workspace.pdf p.4; Review,history&roles.pdf p.3 | `UI-WSP-18`, `UI-WSP-16`, `UI-REV-06` | None (#31 is add-existing-user-by-email) | L |
| `BL-7-11` | User profile (display-name edit, avatar color/photo) | No profile-update endpoint or avatar fields exist. Settings Profile section depends on this. | Search,settings&internal_tools.pdf p.3 | `UI-SCH-05`, `UI-SCH-09`, `UI-PRM-08` | No issue | M |
| `BL-7-12` | Global search scope | Search over Workspaces, Documents, AI conversations and Analyses needs endpoints; only source-chunk retrieval exists. Palette (⌘K) or page, or both? | Search,settings&internal_tools.pdf p.1; Brand&system.pdf p.3 | `UI-SCH-02` | None (#140 is source list filtering) | L |
| `BL-7-13` | Structured Ask answer contract | Key findings with evidence-quality (Direct/Indirect), Uncertainty, Contradictory evidence, Suggested next questions and "Partly supported — 2 of 3 claims" are not in `QuestionResponse`. Requires a Spring + worker + `contracts/` schema change. | Ask,evidence&comparison.pdf p.1; Components&states.pdf p.3 | `UI-ASK-06`, `UI-ASK-08`, UI-ASK-09 (suggested questions), `UI-ASK-11` | No issue (would extend #66) | XL |
| `BL-7-14` | Claim check / evidence-on-a-claim feature | "Check claim" in the selection toolbar and the Evidence-on-a-claim screen (supporting vs qualifying evidence, why sources differ, suggested wording). | Ask,evidence&comparison.pdf p.5; Document_editor.pdf p.2; Key_user_flows.pdf p.4 | `UI-ASK-17`, UI-DOC-09 (Check claim) | Adjacent: #72, #75, #101 | XL |
| `BL-7-15` | PDF rendering approach | Today the PDF "preview" shows extracted text with page navigation. The reader design needs rendered pages, thumbnails, zoom, search and a selection toolbar: client renderer (new dependency) or server page images? | Sources.pdf p.3 | `UI-SRC-14` | None (#57 accepted the MVP) | XL |
| `BL-7-16` | Source management actions | Rename and Archive source, a grid view, "Add to notes" and the relation to folders/tags (#139). Sources are immutable (ADR-005). | Sources.pdf p.1; Sources.pdf p.3; Components&states.pdf p.1 | `UI-SRC-04`, `UI-SRC-06`, `UI-SRC-12` | Related #139 | M |
| `BL-7-17` | Dataset viewer beyond the bounded preview | "Load more rows", column histograms/stats, row-range highlight, "check before analysing" and "Used in". The preview is deliberately capped at 10 rows / 64 KiB. | Sources.pdf p.4 | `UI-SRC-09` | Related #77, #85, #89 | L |
| `BL-7-18` | Document conflict resolution UX | Design: Compare / Keep mine / Take theirs. Code: "Discard my changes and load the latest version". Merge semantics? | Components&states.pdf p.3 | `UI-STA-05` | Related #36 (closed), #95 (collab will change this) | M |
| `BL-7-19` | Offline behavior and local draft persistence | Design copy says text is "kept on this device". The app keeps nothing locally (no localStorage/IndexedDB). Implement local drafts or change the copy? | Components&states.pdf p.3 | `UI-STA-04` | None | L |
| `BL-7-20` | Insert-into-document flows and comparison export | "Insert summary into document", "Insert quote", "Insert evidence", "Cite" from search, "Export comparison". Target document and format are undefined. | Ask,evidence&comparison.pdf p.3; Ask,evidence&comparison.pdf p.4; Ask,evidence&comparison.pdf p.5 | `UI-ASK-18`, UI-ASK-15 (export), UI-SCH-03 (Cite) | Related #134–#137 (document export) | L |
| `BL-7-21` | Document templates | "Start from a structure": Laboratory report, Literature review, Thesis chapter, Blank page. Template content is unspecified. | Workspace.pdf p.3 | `UI-WSP-14` | None | M |
| `BL-7-22` | Citation extras | Citation popover "Replace"; Generate-section citation modes "Where possible/Off" (contract has a boolean); editor Link support (disabled in extensions). | Document_editor.pdf p.3; Document_editor.pdf p.4; Document_editor.pdf p.1 | UI-SHR-06 (Replace), `UI-DOC-12`, UI-DOC-05 (link) | Related #70, #73 | S |
| `BL-7-23` | Responsive below 1024 px, tablet/mobile and scale thresholds | Only the rule "rail becomes a top menu" exists. Define thresholds for 3/30/300 sources and virtualization. | Responsive.pdf p.1; Brand&system.pdf p.3 | `UI-RSP-04`, `UI-RSP-05`, `UI-RSP-06` | Related #139, #140 | L |
| `BL-7-24` | Sidebar collapse toggle | Manual collapse, persistence and interplay with the 1280 px automatic rail. | Reusable_parts.pdf p.1; Responsive.pdf p.1 | `UI-SHL-10` | None | XS |
| `BL-7-25` | Help and workspace menu | Destination of Help and "Learn how ResearchHub works"; contents of the workspace "···" menu. | Reusable_parts.pdf p.1; Workspace.pdf p.1; Access&home.pdf p.4 | `UI-SHL-11` | None | XS |
| `BL-7-26` | Tooltips | No tooltip is designed. Decide whether any consumer needs one. | Components&states.pdf p.1 | `UI-PRM-11` | None | XS |
| `BL-7-27` | Auth extras: password reset, Google sign-in, strength rules | Forgot password has no backend or issue; Google is shown disabled ("Soon"); strength meter rules are not defined. | Access&home.pdf p.1; Access&home.pdf p.2 | `UI-ACC-02`, `UI-ACC-06` | None (ADR-001 selected cookie sessions) | M |
| `BL-7-28` | "Continue working" tracking | "You were in 4. Results", "Last read: page 14", "5 of 6 sections" need last-opened/progress state. | Workspace.pdf p.1 | `UI-WSP-03` | None | M |
| `BL-7-29` | Restore archived workspaces and Archived items | Design copy promises restore from Archived workspaces. There is no restore endpoint or archived list. | Search,settings&internal_tools.pdf p.2 | UI-WSP-20 (Archived items), UI-WSP-21 (copy) | Related #30 | M |
| `BL-7-30` | Analysis quick fixes and request suggestion chips | "Ignore row 33", "Treat n/a as missing", "Fit a trend line", "Remove outliers"… imply planner capabilities and parameterized re-runs. | Analysis_studio.pdf p.2; Analysis_studio.pdf p.4 | `UI-ANA-04`, `UI-ANA-06` | Related #80, #84, #88 | L |
| `BL-7-31` | Rewrite rationale and extra selection actions | "What changed, and why", "Nothing new was added", Check claim, Add citation and the "N paragraphs need a citation" callout need contract/backend support. | Document_editor.pdf p.2; Document_editor.pdf p.1 | `UI-DOC-11`, UI-DOC-08 (callout), `UI-DOC-09` | Related #71, #72 | L |
| `BL-7-32` | Export record (analysis) | Format and contents of "Export record" on the provenance screen. | Results,provenance&insert.pdf p.2 | `UI-RES-07` | Related #89 | S |
| `BL-7-33` | Saved investigations | Meaning of the "Saved" button and the SAVED group in the Investigations list (all conversations are already durable). | Ask,evidence&comparison.pdf p.1 | `UI-ASK-03` | Related #67 | S |

## Existing issues that should receive a design reference

Existing issues own work whose design now exists. They are **not modified** by this audit; consider adding a comment (or editing the body) with the references below when each is scheduled.

| Issue | Design reference to attach |
| --- | --- |
| #78 — Task 13.3 Build dataset preview frontend | Sources.pdf p.4 (spreadsheet viewer). Note: implemented in the working tree; verify, commit and close. Visual redesign is BL-4-21. |
| #87 — Task 15.3 Build analysis result frontend | Results,provenance&insert.pdf p.1; Analysis_studio.pdf p.2–4 (new/running/failed). |
| #90 — Task 15.6 Document analysis block node | Results,provenance&insert.pdf p.3 (insert dialog, block, out-of-date banner). |
| #97 — Task 16.6 User presence and cursors | Workspace.pdf p.4 (presence demo); Review,history&roles.pdf p.1 (labels). |
| #100 — Task 17.2 Build comments UI | Review,history&roles.pdf p.1; Components&states.pdf p.2 (comment card). |
| #101 — Task 17.3 Add `@AI find evidence` comment action | Ask,evidence&comparison.pdf p.3. |
| #104 — Task 17.6 Collaborative snapshots and restore | Review,history&roles.pdf p.2 (named versions, restore safety copy). |
| #113 — Task 19.4 Developer-only AI debugger | Search,settings&internal_tools.pdf p.4 (note the broken table render). |
| #138 — Task 24.1 Source bibliographic metadata | Sources.pdf p.3 (metadata card), Ask,evidence&comparison.pdf p.4 (Compare headers). |
| #139 — Task 24.2 Source tagging/folders/collections | Brand&system.pdf p.3 ("300 sources: folders as chips"). |
| #140 — Task 24.3 Source search and filtering | Sources.pdf p.1 (toolbar), Responsive.pdf (Filters button). |
| #141 — Task 24.4 Internet/external literature search | Document_editor.pdf p.3 (Internet toggle, off by default). |
| #84 — Task 14.6 Analysis orchestration | Analysis_studio.pdf p.3–4 (run steps, failure, quick fixes). |
| #89 — Task 15.5 Analysis provenance API | Results,provenance&insert.pdf p.2 (8-step chain, run history). |
| #103 — Task 17.5 Document contribution/provenance metadata | Document_editor.pdf p.4 (provenance inspector); Brand&system.pdf p.2 (content origin). |
| #102 — Task 17.4 Audit event infrastructure | Workspace.pdf p.2 (activity timeline). |

## Designed work already owned by existing issues (duplicates avoided)

The following designed items were **not** proposed as new issues because an open or closed issue already covers the substantive work (10 skipped): #87 (analysis result UI), #90 (analysis block), #97 (presence), #98 (permission downgrade UI), #100 (comments UI), #104 (named snapshots), #113 (AI debugger), #138 (bibliographic metadata), #139/#140 (source folders, search and filters), #141 (internet trust mode).

## Critical path

`Task 3.7` → `3.8` → (`3.9`, `3.10`) → `3.11`–`3.16` → `3.17` (shell) → `3.18` (routes) / `3.19` (tool shell) → feature screens. The shared-component tasks (`5.8`, `7.7`, `11.7`–`11.9`) can start as soon as `3.12`/`3.13` land. Phase 5 can run in parallel with Phase 4. Phase 6 waits on the open backend epics (14–17); Phase 7 needs owner answers.

