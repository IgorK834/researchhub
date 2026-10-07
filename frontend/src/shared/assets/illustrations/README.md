# ResearchHub illustrations

These twelve standalone SVG scenes adapt the artwork in
`docs/ui/Illustration kit-html/Illus.dc.html` (also supplied with
`docs/ui/States — empty-html`). The exported HTML and design runtime stay in docs;
only self-contained SVG artwork ships in the application. The original paths,
pastel fills, separate objects and hand-wobble filters are preserved. The hero's
labels and search question mark use Georgia instead of the reference's CDN-only
Caveat font, so there are no external font or network dependencies.

Import `Illustration` from `shared/components/Illustration`; SVG imports remain
Webpack asset URLs, following ADR-006. Each scene has intrinsic dimensions and
scales proportionally to its container. Sizes are compact (160px), default
(270px), and hero (480px), capped at the available width. Artwork is decorative:
empty alt text, hidden from assistive technology, non-draggable and noninteractive.
Provide the state explanation and real actions in adjacent semantic UI.

| Scene     | Placement                                                                |
| --------- | ------------------------------------------------------------------------ |
| reading   | Login art panel                                                          |
| team      | Registration art panel                                                   |
| workspace | First workspace                                                          |
| hero      | Workspace overview; empty research conversation page                     |
| documents | Empty documents list/column; overview collection                         |
| sources   | Empty source library; no datasets; empty comparison; overview collection |
| analyses  | First page of an empty analysis library                                  |
| search    | Filtered documents/sources; empty older analysis page; missing route     |
| evidence  | No retrieved evidence; no supporting claim evidence                      |
| magnifier | Empty research panel; citation inspector; Find evidence                  |
| laptop    | Generate section before a suggestion                                     |
| thinking  | AI preparation; authoring request; empty overview activity               |

Auth art hides below 801px, and the overview hero art hides below 641px to keep
forms and workspace metadata prominent. Empty-state art remains visible and
shrinks with its container, including document columns and mobile drawers.
States use matching reference tints and natural height rather than fixed card
heights. No animation is added; artwork is static for reduced-motion users too.

Inline metadata fallbacks (no description, no logs, no sample rows), outline
guidance, version/provenance details, resolved comments and permissions/settings
retain concise text. They do not have a corresponding scene in the reference
and extra artwork would compete with the surrounding content. Request failures
retain error feedback; they do not masquerade as illustrated successful empties.

Browser verification: build the frontend, then run
`node e2e/illustrations.cjs` from `frontend`. It serves the production bundle with
its CSP, mocks API fixtures, checks actual SVG loading and geometry across mobile,
tablet and desktop sizes, and exercises filtering and create dialogs.
