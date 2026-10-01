# GitHub issue style guide (inferred from this repository)

This guide records the conventions that `IgorK834/researchhub` **actually uses** for its issues, so new UI issues drafted in
[`issues.json`](issues.json) read like the existing ones. It is descriptive, not prescriptive: nothing here was imposed from
a generic template.

## Evidence base

| Item | Value |
| --- | --- |
| Issues inspected | **150 of 150** (`gh api repos/IgorK834/researchhub/issues?state=all`, pull requests excluded): #1–#150 |
| State | 75 closed (#1–#75, Epics 1–12) and 75 open (#76–#150, Epics 13–26) |
| Authors / assignees | 1 author (`IgorK834`); **no assignees** on any issue |
| Comments | None on any issue |
| Milestones | **150/150** carry a milestone, and it always matches the epic label |
| Representative issues read in full | #14, #16, #19, #33, #46, #57, #68, #76–#78, #87, #90, #97, #98, #100, #104, #113, #138–#140 |
| Template-consistency checks | Run over all 150 bodies (counts below) |

All 26 milestones are still **open**, including Epics 1–12 whose issues are all closed, so adding an issue to an older epic is
possible and consistent with how the backlog is organised.

Recent history is uniform. Issues #1–#75 and #76–#150 share one template; the only drift is that 4 issues use a generic
filler sentence instead of a topical body (#139 and three others), mostly in Epics 13+. There is no evidence of the format
changing over time, so "most recent convention" and "most repeated convention" coincide.

## Title style

```text
[Task <epic>.<n>] <Imperative verb phrase in sentence case>
```

- **Prefix:** `[Task N.M]` on **150/150**. `N` is the epic number, `M` the position inside that epic (`Task 5.7` = seventh task of
  Epic 5). A new task continues its epic's sequence (Epic 3 ends at `Task 3.6`, so the next is `Task 3.7`).
- **Language:** English.
- **Verb:** imperative. Counts: `Implement` 46, `Add` 26, `Create` 17, `Build` 11, `Define` 10, `Configure` 7, `Deploy` 5,
  `Introduce` 4, `Integrate` 4. Frontend slices are usually **`Build … frontend`** or **`Build … UI`**:
  #33 *Build workspace list/detail frontend*, #46 *Build source library frontend*, #57 *Build source preview UI*,
  #68 *Build Ask Workspace frontend sidebar*, #78 *Build dataset preview frontend*, #87 *Build analysis result frontend*,
  #100 *Build comments UI*.
- **Capitalisation:** sentence case after the prefix; product concepts keep their casing (`Ask Workspace`, `Find Evidence`);
  code identifiers and literals use backticks (`` `AnalysisArtifact` ``, `` `Ask Workspace` ``). No trailing period.
- **No** `feat:`/`fix:` prefixes, no `UI:`/`RH-` prefix in titles. (Commit messages are a separate convention:
  Conventional Commits such as `feat(ui): …`, `feat(editor): …`, `docs: …`.)

## Body style

Always four `###` headings, in this order, and nothing else at heading level:

1. `### Objective`
2. `### Technical Implementation Details`
3. `### Acceptance Criteria`
4. `### Dependencies`

### Objective (150/150)

Three sentences:

1. What the task delivers (one sentence, specific).
2. "This work …" rationale tied to the epic's purpose.
3. The fixed sentence: *"The implementation must stay within the agreed ResearchHub architecture and avoid unrelated
   infrastructure or feature expansion."*

Example: #19 (*Provide repeatable checks for TypeScript/frontend changes. This work gives the frontend a predictable
structure …*).

### Technical Implementation Details (150/150)

A fixed block of bold key lines, then optional topical bold sections.

```markdown
**Backlog reference:** RH-035
**Estimated size:** M
**Primary implementation paths:** `frontend/package.json`, `frontend/src/`
**Technology baseline:** <boilerplate; varies with labels>
**Architecture constraints:** <identical boilerplate>
**Implementation anchor:** <identical boilerplate>
```

- `Backlog reference` — an `RH-nnn` id (150/150). Ids are allocated in blocks per epic (Epic 3 = RH-030…035, Epic 5 =
  RH-050…056, Epic 13 = RH-130…132) but the later epics overflowed (Epic 18 = RH-180…184, Epic 19 continues at RH-185,
  Epic 21 = RH-200…213). The highest id in use is **RH-263** (#150), so new work continues at **RH-264**.
- `Estimated size` — `XS`, `S`, `M`, `L`, `XL` (distribution: L 70, M 43, XL 26, S 9, XS 1; one `ongoing` for the ADR
  upkeep task #148). This is the same scale the UI audit uses for scope.
- `Primary implementation paths` — backticked, comma-separated repo paths (150/150), e.g. `` `frontend/src/features/sources/` ``.
- `Technology baseline` / `Architecture constraints` / `Implementation anchor` — long, **identical-per-variant**
  boilerplate (150/150 each). The baseline gains clauses depending on labels (Python/`ai-worker` text for `ai`/`data`, Flyway
  text for `database`). A frontend-only task uses the same variant as #19 and #15.
- **Topical bold sections** follow, chosen per task. Frequency: `Rules:` 36, `Requirements:` 14, `Deliverables:` 4,
  `UX:` 5 (#40, #68, #78, #87, #100) and `UX requirements:` 1 (#46), `Screens:` 1 (#33), `Behavior:` 5, `Flow:` 4,
  `Out of scope:` 3 (#1, #9, #31), `Assumption(s):` 8. Lists use `-` bullets ending with `;` and a final `.`; code fences
  (` ```text `) are used in 65/150 issues for routes, field lists and schemas (#16 lists routes this way).

Frontend/UI slices use `**UX:**` (#68, #78, #87, #100) or `**Screens:**` (#33) with short noun-phrase bullets that name the
visible parts of the screen.

### Acceptance Criteria (150/150)

`- [ ]` checklist. 1–5 task-specific bullets (average 2.0), written as observable outcomes (*"A group member can upload a
source in one browser session and another authorized member can see it after query refresh/polling."*, #46). Two bullets
close **every** list verbatim:

```markdown
- [ ] Relevant automated tests pass and the repository builds successfully for the affected component.
- [ ] Minimum 80% test coverage for this module
```

(the second has no final period in the originals.)

### Dependencies (150/150)

A single line of **task numbers**, not issue numbers: `Task 5.3, Task 3.5` (148/150), or `None` (2/150). Dependencies point
at earlier tasks, almost always in the same or a foundational epic. Issue numbers (`#33`) are not used in bodies, so this
repository's dependency graph is expressed as `Task N.M`.

## Metadata style

| Aspect | Convention |
| --- | --- |
| **Priority label** | Exactly one of `high-priority` (116/150), `medium-priority` (28), `low-priority` (6). Definitions from `gh label list`: P0/P1 blocks the MVP or a critical workstream / P2 important for a strong portfolio-quality release / P3 later expansion. |
| **Domain labels** | Zero or more of `frontend`, `backend`, `devops`, `database`, `security`, `testing`, `monitoring`, `ai`, `data`, `collaboration`, `azure`, `docs`. |
| **Epic label** | One `epic:*` label (150/150) matching the milestone, e.g. `epic:frontend-foundation`, `epic:workspaces-rbac`. |
| **Milestone** | `Epic N: <Name>` (150/150), identical to the epic label. |
| **Assignees** | None. |
| **Parent/child, links** | None. The epic is the milestone plus label. Cross-issue links exist only as `Task N.M` in `Dependencies`. |
| **Issue types / templates** | No `.github/ISSUE_TEMPLATE`; the template lives only in the issue bodies. |

## Granularity

One issue ≈ one backlog task ≈ **one vertical slice or one cohesive component group**, usually `L`:

- A whole feature screen with its states: #33 (workspace list/detail), #46 (source library), #78 (dataset preview).
- A panel plus its client wiring: #68 (Ask Workspace sidebar), #100 (comments UI).
- A single mechanism: #26 (logout, `S`), #73 (citation mark/node).
- Large `XL` items are reserved for end-to-end or multi-part systems: #68, #87, #90, #95.

Frontend tasks bundle their loading/empty/error/success states in the same issue rather than splitting them out (#33's
acceptance criterion: *"loading, empty, error, and success states exist"*).

## Quirks to know before copying the style

These are real properties of the current corpus. Mirror the structure, **not** the artifacts:

1. **Stray bullet `- [ ] ---.`** appears in 147/150 acceptance lists. It is a generation artifact, not a requirement. New
   issues should omit it.
2. **Label inflation.** `devops` is on 108/150 issues and `backend` on 100/150, including pure-frontend tasks (e.g. #19, #46
   carry `devops`). New issues should apply only the labels that are true for the work.
3. **Trailing `;.`** after bullets in 15 acceptance lists (e.g. #33) is punctuation noise.
4. **Boilerplate Technology baseline mentions Java/Spring even for frontend-only tasks.** Keep it (it is the repository's
   fixed text) rather than rewriting it per task.
5. **Priority is skewed high.** 116/150 are `high-priority`; the label definitions in `gh label list` are stricter than
   practice. For UI polish the audit proposes `medium-priority` (*"important for a strong portfolio-quality release"*) unless
   work blocks a critical workstream.
6. **Open issues can already be implemented.** The working tree implements RH-130–RH-132 (source versioning, dataset
   inspection API and preview UI; migration `V19`, `frontend/src/features/analysis/`), yet #76–#78 are still open and the code is
   not committed. Always verify code before treating an open issue as "to do" (see `UI_INVENTORY.md`).
7. **Issue numbers ≠ backlog ids.** `README.md` and docs refer to `RH-nnn` (e.g. "RH-130–RH-132"), which map to the
   `Backlog reference` line, not to `#nnn`.

## How the UI audit adapts the style (and where it deliberately stays inside it)

The proposed UI issues use the template above unchanged. The only additions are expressed with the existing mechanism of
"bold topical lines":

| Need | How it is written |
| --- | --- |
| Point to the visual source | `**Design reference:**` line placed after `Primary implementation paths`. Lists split-PDF names and pages (e.g. `Components&states.pdf p.1`). |
| State what is intentionally left out | `**Out of scope:**` (already used in #1, #9, #31). Used heavily, because many design elements lack a backend. |
| Describe the screen | `**UX:**` / `**Screens:**` with short bullets (as #33, #68, #78, #87). |
| Reference existing work | `Dependencies:` as `Task N.M`. Existing **issue numbers** are carried in `issues.json` (`existing_dependencies`, `related_existing_issues`) so the script can validate them. |
| Task numbers | Continue each epic's sequence (`Task 3.7`, `Task 5.8`, …). |
| Backlog references | Continue from `RH-264`. |
| Labels / milestone | Existing labels only; milestone = epic (the repo's universal convention, verified by the script before use). |

## Uncertainty

- Whether the maintainer wants UI work grouped under **Epic 3: Frontend Foundation** or spread across feature epics is not
  stated anywhere. The audit puts cross-cutting design-system and shell work in Epic 3 and feature screens in their feature
  epic, mirroring how #33/#40/#46/#57/#68/#78/#87/#100 live in their feature epics.
- The repository has never needed a "design-system" or "ui" label; none is proposed and none will be created.
- `RH-nnn` allocation rules are inferred from the sequence, not documented. Confirm no id in `RH-264+` is reserved elsewhere.
