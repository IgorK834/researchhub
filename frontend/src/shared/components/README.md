# Shared controls

`Button.tsx` implements RH-267 on the token and asset contract in
[ADR-006](../../../../docs/adr/ADR-006-ui-styling-and-assets.md).
It contains no feature, API or workspace authorization logic.

```tsx
import { Button } from './shared/components/Button';

<Button type="submit" icon="plus">Create document</Button>
<Button variant="secondary" href="/guide">Read the guide</Button>
<Button variant="danger-soft" iconOnly icon="trash" aria-label="Archive document" />
<Button busy={isPending}>Run analysis</Button>
```

- Variants: `primary` (default), `secondary`, `ghost`, `danger`, `danger-soft`.
- Sizes: `compact` (34 px), `default` (36 px), `large` (44 px).
- `icon` is a typed design name. With text, it is the leading decorative icon.
- `iconOnly` requires both `icon` and a non-empty `aria-label`; children are forbidden.
  TypeScript rejects omitted names, and runtime validation catches blank strings.
- Default rendering is a real `<button type="button">`; pass `type="submit"` explicitly
  for forms. Supplying `href` renders a real `<a>`, which cannot submit a form. Native
  element attributes, event handlers, `className` and the correctly typed ref are forwarded.
- `disabled` and `busy` prevent activation. Unavailable links have no href, carry
  `aria-disabled`, keep their link role and leave the tab order. Native buttons use disabled.
- `busy` exposes `aria-busy`, keeps the original content mounted for width and its
  accessible action name, and overlays a decorative spinner. Reduced motion stops rotation.
  Optional `busyLabel` provides visible progress text; choose text that fits the idle width
  or give the control a suitable minimum width through its CSS Module class.

Focus uses the shared 2 px ink outline and 2 px offset. Do not remove visible focus,
replace action names with icon names, or rely on color alone. Features should omit
actions a user cannot take according to server-authoritative permissions; disabled
is for unavailable interaction, not a substitute for workspace authorization.

The login form demonstrates the migration. Migrate other feature call sites in their
own tasks; no global replacement of existing buttons is required by this foundation.
Icon contract and artwork mapping: [icons/README.md](icons/README.md).

## Form controls (RH-268)

Import `TextField`, `Textarea`, `Select`, `Checkbox`, `Toggle`, `SegmentedControl`
and `ChoiceCards` from `shared/components/forms`. Every control requires a visible
`label`. Native attributes, events and element refs are retained by individual fields.
`Select` is a single native select; its options remain native `<option>` elements.

```tsx
<TextField id="email" name="email" label="Email" type="email"
  hint="Your university address" error={fieldErrors.email}
  value={email} onChange={(event) => setEmail(event.target.value)} />
<Select label="Role" value={role} onChange={changeRole}>
  <option value="EDITOR">Editor</option><option value="VIEWER">Viewer</option>
</Select>
<SegmentedControl label="Citations" options={policies} value={policy} onChange={setPolicy} />
```

- Explicit ids preserve `${id}-error`; omitted ids use React `useId`. The accessible
  description combines the consumer's `aria-describedby`, the hint and the error in
  that order. Errors retain the server's exact wording, add a decorative alert icon,
  and set `aria-invalid`. Removing an error also removes its description reference.
  Fields do not add live alerts: the form's existing request-level alert stays in charge.
- Text controls are 40 px tall; `TextField size="large"` is 44 px for auth. Password
  fields remain native password inputs. Search adds a decorative leading icon and an
  optional visual `keycap`; the consumer registers any actual shortcut.
- Checkbox uses the mint checked state; Toggle is a native checkbox with `role="switch"`.
  Space and form submission retain native behavior. Disabled controls are native disabled.
- Selection groups use native radios in a labelled fieldset, one tab stop and a shared
  native `name`. Arrows select/focus the next enabled option and wrap; Home/End choose
  the first/last. Tab leaves the group. `value`/`onChange` are controlled. `currentStep`
  and option values are application state, never server authorization rules.
- `Choice<T>` defines value, visible label, optional description/icon and disabled state.
  Use an explicit value union when callers must reject unknown values at compile time.

Auth `FormField` has been removed. Login/register and workspace create/edit/member forms
consume these shared fields while keeping their previous labels, ids and error messages.

## Identity and small labels (RH-269)

Import from `shared/components/identity`. `Badge` requires both an `IconName` and a
non-blank visible `label`. Tones are neutral, blue, coral, lavender, mint, yellow and
ink; `variant="mid"` uses mid-tint, `variant="outlined"` uses tint plus hue border.
Sizes are default 26 px and compact 22 px. Text uses ink, or white on the ink fill.
`Chip` shares this contract and optionally adds `onRemove` with a named remove button.

`Avatar` accepts `{ userId, name, size }`; sizes xs/sm/md/lg are 18/28/36/44 px. Initials
use the first and last name, including Unicode characters; a blank name has `?` and
an accessible fallback. Color comes from a stable FNV-1a hash of `userId` into the five
brand hues, independently of name and render order. This hash has no security purpose.

`AvatarStack` takes `people`, a positive integer `limit` (default 3) and an optional
size/group label. It shows `limit` avatars plus a separate `+N` circle, whose accessible
name retains all omitted names. `Sticker` uses a base hue (yellow by default), a visible
label, optional decorative icon and −3° rotation. No photo or presence contract exists.

### Workspace roles and UI capabilities (RH-278)

`RoleBadge` takes a server-provided `role: string`: Owner uses ink/key, Editor uses
lavender/pencil, Viewer uses neutral/eye. Unfamiliar strings remain visible verbatim
with a neutral users badge; a blank string reads "Unknown role". Every badge includes
an icon and a visible word. `workspaceRoleLabel` supplies the same text for the switcher.

`workspaceCapabilities(role: string | undefined, archived: boolean)` in `shared/utils`
returns `{ canRead, canEditContent, canManage, canViewSettings }` for an **already authorized** membership:

| Role                      | Read | Edit content | Manage workspace |
| ------------------------- | ---- | ------------ | ---------------- |
| OWNER                     | Yes  | Active only  | Active only      |
| EDITOR                    | Yes  | Active only  | No               |
| VIEWER                    | Yes  | No           | No               |
| Unfamiliar non-blank role | Yes  | No           | No               |
| Missing/blank role        | No   | No           | No               |

Archived workspaces never expose editing or management actions. Missing workspace data
does not grant write affordances. Consumers omit unavailable controls rather than disabling
them; the helper neither gates routes nor replaces server authorization. The source page
uses the shared workspace metadata query for both role and archive state, while its member
query remains responsible for uploader labels. Reading and downloads are unchanged.
`canViewSettings` is true for Owner and Editor, including archived workspaces where the
General card is read-only. Viewer and unfamiliar roles have no Settings entry and direct
Settings URLs return to Overview. This controls presentation, not server access rights.

## Overlays (RH-270)

Import `Dialog`, `SlideOver`, `Popover` and `Menu` from `shared/components/overlays`.
Dialogs and slide-overs are controlled by `open`/`onClose` and require a title. Optional
description, children and footer stay within the dialog. They portal to the body,
set `aria-modal`, make background body children inert, lock body scrolling, trap Tab
and restore focus. Nested modal lifetimes restore previous inert/scroll state.

Use `initialFocusRef` for a suitable first control (especially the least destructive
action in a confirmation); `returnFocusRef` can specify the trigger. Otherwise focus
starts on the first enabled visible control and returns to the element active at opening.
An outside, hidden or disabled initial target falls back to an available dialog control.
An optional `className` adds feature-specific geometry; a CSS Module can set
`--dialog-width` (600 px by default) while the surface remains capped at the viewport.
`closeDisabled` disables the explicit close button while a submitted operation is pending;
pair it with `dismissible={false}` and disabled cancellation controls when appropriate.
`dismissible={false}` blocks Escape/outside dismissal; the named close control remains
available for explicit cancellation. The callback never performs the destructive action.

`Popover` supplies a labelled trigger and a non-modal content dialog. Tab moves through
its content, leaves at the boundary and closes it; Escape/outside pointer also closes it.
`Menu` supplies a labelled native button and `items` with id/label/onSelect, optional
icon, visual shortcut, disabled/destructive state and separator. Enter/Space activate
native buttons; ArrowDown/Up open at either end. Inside, arrows wrap over enabled items,
Home/End select an end, typeahead finds labels, Tab exits and Escape returns to the trigger.
Shortcut hints do not register application shortcuts. Context menus do not execute actions
on focus. Popups clamp to the viewport and reposition on scrolling/resizing.
`triggerIcon` uses an icon-only trigger with the same accessible `label`; `disabled`
disables that trigger. The role menu uses these options while a membership write is pending.

Popups opened inside a modal portal inside its surface so focus and stacking remain
consistent. Layer tokens are content 0, popover 100, slide-over 200, modal 300, toast 400;
a nested popup uses its parent's stacking context. Dialog geometry is radius 24/e3/42%
scrim; slide-over is right-aligned, 420 px, capped at viewport width and full height.

Keyboard/focus behavior follows the W3C [modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/),
[menu button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) and
[radio group](https://www.w3.org/WAI/ARIA/apg/patterns/radio/) patterns.

## Feedback (RH-271)

Import from `shared/components/feedback`. `Banner` requires a visible bold `lead` and
adds a decorative status icon. Tones: info, warning, error, success, note. Body content
can explain why, what is safe and what to do next; optional action is a real control/link.
Note is a non-interactive dashed explanation. Default announcements are status/polite,
error alert, and no live role for notes. Pass `role` to preserve an existing announcement
contract. `ApiStatusBanner` now uses it, including `role="status"` for its error branch.

`AppProviders` installs `ToastProvider`, including one persistent `ToastHost`. `useToast()`
returns `showToast(input)` (an id) and `dismissToast(id)`. Success toasts use a polite live
region, visible title/body/check icon and optional named action; default duration 5 s,
`duration: 0` is persistent. Hover/focus pause the remaining time. Blocking toasts use an
assertive live region, ink surface/coral icon, require a named action and never expire.
Actions do not implicitly dismiss a toast; consumers dismiss after resolving the operation.
Do not mount another host alongside the provider or steal focus to announce a toast.
While a modal is open, the stable toast portal root lives inside its active surface so
live announcements and actions remain available within `aria-modal` and the focus trap.
Moving between nested modals and the body retains toast DOM, state and remaining lifetime.

`Progress` requires a label and accepts a percentage in [0,100]; omitted value is
indeterminate. `StepProgress` accepts named `steps`, a one-based `currentStep` and label;
`steps.length + 1` means complete. Both provide numeric/value-text semantics, visible
words and icons. `Spinner` requires a label or `decorative`; reduced motion stops animation.
`Skeleton` is a static, hidden placeholder with width/height and text/block/circle shape.
Supplied children, including zero counts, always render in place of a skeleton. Keep known
titles/counts/names outside unknown placeholders and reproduce the surrounding layout.

Visual references: `Components&states.pdf` pp.1–3, `Document_editor.pdf` p.3,
`Results,provenance&insert.pdf` p.3, `Access&home.pdf` p.5 and `Responsive.pdf` p.1,
cross-checked against `design-reference/DESIGN_SPEC.md` §§2.2, 2.5, 2.8–2.11.
These primitives add no runtime dependencies, feature permissions or backend behavior.

## Content structures (RH-272)

Import `Card`, `Panel`, `DashedNote`, `IconTile`, `ListRow`, `DataTable`, `EmptyState`,
`Keycap` and `KeyboardHintBar` from `shared/components/content`.

- `Card` forwards native div attributes and refs; radius 16, border 1, elevation e0,
  padding 16. `Panel` is a labelled section with a required `title`, optional `header`
  action slot, body `children` and optional `footer`. `DashedNote` is quiet explanatory
  content with a decorative icon, without a live-region role.
- `IconTile` requires an `IconName`; five brand tones, `small` (24), `default` (32),
  `large` (40), and `fill="mid"` (default) or `fill="base"` for selected navigation.
  Tiles are decorative; the neighbouring title supplies their meaning.
- `ListRow` renders an `li` inside a consumer's list. It accepts `title`, `meta`,
  `leading`, `trailing`, `actions` and `selected`, plus native li attributes/ref.
  Put navigation in a title link and commands in separate named buttons. Selection
  includes a hidden word and a 3 px ink bar. Actions appear on hover **and** focus within
  on fine pointers; they remain visible on touch devices and stay keyboard reachable.
- `DataTable<Row>` requires `rows`, `rowKey`, `columns` and a visible `caption`.
  Each column has a stable `id`, a string `header`, a typed `render(row)` and optional
  `rowHeader`. It retains native table/caption/thead/tbody markup and `scope="col"` /
  `scope="row"`. `label` defaults to the caption; `scrollLabel` names the focusable
  overflow region. `isSelected(row)` styles a row and adds a hidden selection word.
  An optional `footer` is outside the table so arbitrary controls retain their semantics.
  Selection inputs, sorting, filtering and virtualization remain consumer concerns.
- `EmptyState` requires `title` and `description`, accepts `context`, decorative `art`,
  `tone`, heading level (`h2` default or `h3`) and a tuple of one or two `actions`.
  Both TypeScript and runtime reject three actions. Art is optional; no illustration is
  generated. `emptyStateCopy` holds the reference's workspaces, documents, sources,
  analyses and evidence copy; `searchEmptyStateCopy(query, counts)` expresses search
  without inventing totals. Consumers supply real actions and omit unavailable ones.
- `Keycap` is native `kbd`. `KeyboardHintBar` is a labelled list of `{ keys, label }`
  hints. These are informational: they do not register shortcuts, and consumers should
  advertise only shortcuts they actually implement.

```tsx
<DataTable rows={documents} rowKey={(document) => document.id}
  caption="Document library" columns={[
    { id: 'title', header: 'Title', rowHeader: true,
      render: (document) => document.title },
  ]} />
<EmptyState {...emptyStateCopy.documents}
  actions={[<Button key="create" onClick={createDocument}>Create first document</Button>]} />
```

The existing dataset preview's column-types and sample-rows tables are the first consumers.
Their labels, captions, row headers, immutable version metadata and bounded samples remain
unchanged. Reference: `Components&states.pdf` pp.1,2,4 and `Sources.pdf` p.1.

## In-page navigation (RH-273)

Import `Tabs`, `FilterChip` and `Breadcrumb` from `shared/components/navigation`.
`Tabs<T>` requires a visible group `label`, controlled `value` / `onChange` and typed
`items` (`value`, `label`, optional `count` / `disabled`, `content`). Tabs and panels are
associated by generated ids. Automatic activation uses Left/Right, wrapping past disabled
items, plus Home/End; `orientation="vertical"` uses Up/Down. One enabled tab is in the
Tab sequence. Inactive panels remain mounted and hidden, preserving local state; only the
selected panel is exposed. Consumers should use automatic activation for promptly available
content. Removing the selected item falls back to the first enabled item.

`FilterChip` is a native button with `aria-pressed`, a required word `label`, controlled
`active`, optional `count` and native props/ref. Its active fill is ink with white text.
`Breadcrumb` is a labelled nav (`Breadcrumb` by default) with an ordered list of `segments`
(`label`, optional `href`). Only the last segment has `aria-current="page"` and is always
plain text. Long names truncate visually, retain their complete accessible text and have a
full-text title. `renderLink` can integrate an application's router. These primitives do
not choose routes or implement filtering. Reference: `Components&states.pdf` p.1 and
`Reusable_parts.pdf` p.2.

## Authenticated frame (RH-274)

`shared/components/shell` exports the presentational `AppShell`, `ShellSidebar` and
`ResearchHubMark`. The shell provides a 264 px sidebar (64 px for tools and at <=1280 px), 56 px top bar, skip link and one
`main` landmark. Slots accept the breadcrumb, primary action and sidebar composition;
member metadata produces a stack with +N overflow. A one-person roster has no collaboration
stack. The sidebar has a scrollable navigation area and a pinned settings/user/sign-out
area, with complete identity text preserved behind visual truncation. The five-petal mark
is an original vector redraw of the raster reference, colored from existing tokens.

`pages/AppLayoutPage.tsx` assembles features and routes. The URL selects the workspace; a
native workspace select navigates between server-returned workspaces, including the current
archived workspace when absent from the active list. It shows the server's current role
and the roster's member count. The existing workspace, member, document and source query
hooks share their current cache keys. An optional `enabled` argument, defaulting to true,
lets the shell wait for workspace authorization before requesting its collections. Failed
counts remain unknown, and failed workspace context is suppressed even if cached metadata
exists. The outlet stays mounted while these queries resolve or fail, preserving drafts.

Documents, Sources, Ask AI, Members and Owner/Editor Settings destinations use the workspace
section routes. Existing heading ids remain available for focus navigation. The app focuses
and scrolls to the heading, including asynchronously rendered content and repeated actions.
Detail breadcrumbs resolve names from the same list queries. New document,
Upload source and Add member top-bar actions focus existing forms in their sections.
New workspace opens the shared creation dialog. Settings is absent for viewers;
write actions are absent for viewers and archived workspaces.
Editors can read General settings and write content in active workspaces but cannot manage the workspace. Server authorization remains authoritative.

The grounding sticker counts **READY** sources, matching the existing question scope; the
Sources navigation count includes every listed source. Member avatars describe workspace
membership, not live presence. Search, Analyses, Help, notifications and global Settings have
no implemented destinations and are absent. ApiStatusBanner remains a tested shared control
but is removed from the application header. The responsive contract is documented below. Reference: `Reusable_parts.pdf` pp.1,2, `Access&home.pdf` p.3 and
`Workspace.pdf` p.1.

## Workspace sections and tools (RH-275–RH-277)

`app/workspaceRoutes.ts` defines the section labels and `workspaceSectionPath`:

| Section   | URL under `/app/workspaces/:workspaceId` |
| --------- | ---------------------------------------- |
| Overview  | the existing base URL                    |
| Documents | `/documents`                             |
| Sources   | `/sources`                               |
| Ask AI    | `/ask`                                   |
| Members   | `/members`                               |
| Settings  | `/settings`                              |

`WorkspaceDetailPage` composes the existing feature components for its typed `section`.
Overview keeps the metadata and read-only document/source lists; creation/upload, research,
member management and owner settings live in their respective sections. Archived and role
restrictions, server field errors and immutable-version behavior are unchanged. Settings
opened by an Editor render read-only metadata; Viewer and unfamiliar roles return to Overview.
Owner settings are read-only when archived. Unknown sections resolve to Not Found.

The document and source URLs retain their existing shapes. All query parameters, including
`page`, `unit`, `version`, `processingVersion`, `analyzeSource`, `analyzeVersion` and
`analyzeSheet`, remain untouched by route composition. A legacy base URL with `analyzeSource`
redirects with replacement to `/ask`. Old workspace heading fragments redirect to the matching
section, retaining search and fragment; the shell focuses the target after its data arrives.
Refresh support uses the existing history fallback and session guard.

`ToolShell` is mounted inside AppShell's single `main`. `AppShell tool` supplies the 64 px
rail. `ToolShell` orders the optional named secondary `nav` (240, 260 default, or 280 px),
the named main-content region, then the context `aside` (340 px). `children`, `secondary`,
`context` and `contextFooter` are content slots; `label`, `secondaryLabel` and `contextTitle`
name their accessible regions. The footer is pinned, with panel content scrolling independently.
`contextMode` defaults to `auto`; `docked` and `slide-over` support explicit composition.

At <=1280 px, `auto` context panels use a labelled trigger and the existing 420 px SlideOver,
with a focus trap, Escape dismissal and focus return. Stable portal containers preserve
mounted research controls and drafts when docking, opening, closing or resizing. The editor
continues to use its existing autosave, version history and conflict handling. Source reader
and Ask AI pages also compose ToolShell; their future panel content is not invented here.
A narrow source URL opens SourceDetailPage in a SlideOver over the Sources section, including
on direct refresh. Its stable portal also preserves controls across breakpoint changes. Closing returns to `/sources` and focuses its heading.

`useNarrowDesktop` observes `(max-width: 1280px)` with subscription cleanup. CSS uses the same
breakpoint. Rail links retain accessible names, selected state, counts and destinations even
when their text is visually collapsed; the native workspace selector remains keyboard usable.
No manual collapse switch or below-1024 top menu is introduced.

`TableColumn.priority` is `essential` (also the default when omitted) or `metadata`.
`visibleTableColumns` drops metadata at the breakpoint; both header and data cells use the
same result, preserving `table`, `th`, scopes and row headers. SourceList marks **Uploaded by**
and **Date** as metadata. Tables scroll within their named container rather than the page.
At least one column must remain visible. `ResponsiveFilters` moves consumer-supplied controls
into a single **Filters** popover and keeps their DOM/state alive; it owns no filtering logic.
SourceList uses local type tabs with counts; search, additional filters and a grid view remain out of scope.

References: `Brand&system.pdf` p.3; `Document_editor.pdf` p.1; `Sources.pdf` p.3;
`Ask,evidence&comparison.pdf` p.1; `Reusable_parts.pdf` p.5; `Responsive.pdf` p.1.
No backend, schema, package or runtime dependency changes are needed.
