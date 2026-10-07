# Illustration placement audit

Reviewed the React routes, feature panels, shared state components, UI inventory,
backlog, asset contract and the supplied HTML references on 7 October 2026.
The two reference exports provide twelve scenes; the previous UI had left the
auth and workspace art slots empty, used small icons in document/source empty
states, and rendered the remaining states primarily as text.

| Surface                           | Added artwork and state behavior                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Login / registration              | Reading / team in the existing decorative auth panels                                                                |
| Workspace home                    | Desk setup for the first workspace; existing create action retained                                                  |
| Workspace overview                | Researcher hero and compact document/source/AI collection empties                                                    |
| Documents                         | Blank page for empty libraries and narrow document columns; search scene for unmatched titles                        |
| Sources                           | Carrying files for a new library; search scene and Show all sources for empty filters                                |
| Analyses                          | Empty chart for the first page; search for empty older pages; sources when no dataset is available                   |
| AI research / citation inspection | Researcher or magnifier for a new conversation; magnifier in an unused inspector; thinking during preparation        |
| AI authoring / evidence           | Laptop before draft generation; magnifier for discovery; thinking during requests; pinned notes for missing evidence |
| Source comparison / missing route | Sources when comparison has no inputs; search for an unknown route                                                   |

Artwork uses native standalone SVG assets and the existing CSS Modules system.
The HTML reference runtime and CDN font links are not included. Decorative
images have empty alt text and do not receive focus or pointer events. Text,
citations, server permissions and real actions continue to convey state.
Loading and request failures do not render successful empty collections;
partial evidence is not presented as no retrieved evidence.

Auth artwork hides on small screens. Overview hero art yields to metadata on
phones; collection and list artwork remains visible and scales to its container.
Document columns and AI side panels use compact artwork. Browser review also
identified fixed desktop navigation, nonwrapping headers and scope labels,
and a sticky composer covering illustrated content. Tool navigation now stacks
below 801px, mobile headers wrap, tables/tabs scroll inside their containers,
scope labels wrap, and the composer stays in document flow. Empty document
navigation grows to show its illustration in full on phones.

Small metadata fallbacks, outline guidance, comments, history, provenance details,
settings and permission notices retain concise text. None has a dedicated scene
in these references, and additional illustration would crowd working content.

Validation: `npm run build`, `npm run lint`, `npm run format:check`, and
`npm run test:coverage -- --runInBand` pass, including all 105 Jest suites /
1,021 tests and the coverage gates. `node e2e/illustrations.cjs` checks all twelve scenes across 95 browser
states at 320, 375, 768, 1024 and 1440px, including actual image loading, aspect
ratio, parent bounds, unobscured artwork, CSP, filtering, creation dialog, request errors and viewer
controls. The run has no horizontal page overflow or browser errors. API data
is mocked; the check does not mutate a product workspace.

Asset inventory and component usage:
[illustration README](../../frontend/src/shared/assets/illustrations/README.md).
