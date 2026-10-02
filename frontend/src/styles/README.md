# ResearchHub style contract

Source: `design-reference/Brand&system.pdf` pp.2,4 and
`Components&states.pdf` p.1; cross-check `DESIGN_SPEC.md` §1 and §2.1.
[ADR-006](../../../docs/adr/ADR-006-ui-styling-and-assets.md) owns the styling decision.

Import `styles/index.css` once at the application entry. Use colocated `*.module.css`
for component styles (`import styles from './Button.module.css'`). Class keys preserve
their spelling, including hyphens (`styles['danger-soft']`). Plain `.css` is global
and supports side-effect imports only. SVG/font imports are hashed, same-origin URLs;
an SVG URL is not an inline React component.

## Public custom properties

All values live in `tokens.css`; authored CSS and component code use these properties.
This is a light-mode contract. No dark map or preference storage is provided.

| Properties                                                                                                        | Role and source                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--color-background`, `--color-surface`, `--color-surface-muted`                                                  | App ground, paper/cards, wells/rails; stated neutrals.                                                                                                                                            |
| `--color-border`, `--color-border-strong`                                                                         | Hairline separators and input borders; stated.                                                                                                                                                    |
| `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`                                            | Stated original neutral swatches. Primary for body; secondary for metadata. Muted is a palette reference: avoid on muted surfaces.                                                                |
| `--color-text-subtle`                                                                                             | Accessible placeholder/caption role, adjusted from the muted swatch; minimum 4.73:1 across the three neutral surfaces.                                                                            |
| `--color-brand-{blue,coral,lavender,mint,yellow}`                                                                 | The five stated base fills/marks; never body text. Blue = sources/navigation/info; coral = PDF/attention/people; lavender = AI/notes; mint = datasets/evidence/done; yellow = insights/questions. |
| Each brand role's `-tint`, `-mid`, `-ink`                                                                         | Stated large-surface tint; measured unlabeled mid-tint for tiles/chips/borders; stated ink for text/icons on that hue's tint or mid-tint.                                                         |
| `--color-{success,warning,error}`                                                                                 | Stated status marks; never standalone color meaning.                                                                                                                                              |
| Status roles' `-ink`, `-tint`                                                                                     | Aliases to mint/yellow/coral inks and tints; pair status text with its tint and a word/icon.                                                                                                      |
| `--color-action-hover`, `--color-danger-hover`                                                                    | Measured graphite/red button hover colors. Danger's resting fill uses the stated error ink.                                                                                                       |
| `--color-selection`, `--color-scrim`, `--color-focus-halo`, `--color-shadow`                                      | Measured selection/scrim and inferred halo alpha/shadow RGB. Only token definitions contain raw colors.                                                                                           |
| `--font-ui`, `--font-paper`                                                                                       | Plus Jakarta Sans Variable and Source Serif 4 Variable, with system/Georgia fallbacks.                                                                                                            |
| `--font-weight-{regular,medium,semibold,bold,extrabold}`                                                          | 400, 500, 600, 700, 800 from the named UI weights.                                                                                                                                                |
| `--type-{display,h1,h2,h3,body,label,caption,paper-title}-size`                                                   | 56, 32, 24, 18, 15, 13, 12, 28 px at the default 16 px root; rem units respect the user's font preferences.                                                                                       |
| Each type role's `-weight`                                                                                        | Display/H1 800; H2/H3 700; body 400; label 600; caption 500. Paper title 600 is an implementation choice because the PDF names no weight.                                                         |
| `--line-height-{heading,body,control}`                                                                            | Inferred readable defaults: 1.2 / 1.6 / 1.25.                                                                                                                                                     |
| `--space-1` … `--space-8`                                                                                         | Stated 4, 8, 12, 16, 24, 32, 48, 64 px.                                                                                                                                                           |
| `--radius-{sm,md,lg,xl,pill}`                                                                                     | Stated 6, 10, 16, 24, 999 px; controls use md.                                                                                                                                                    |
| `--border-width`                                                                                                  | 1 px hairline.                                                                                                                                                                                    |
| `--control-height-{compact,default,large}`                                                                        | Measured 34, 36, 44 px.                                                                                                                                                                           |
| `--elevation-e0` … `--elevation-e3`                                                                               | Stated roles: border only, lifted, popover, modal; exact shadow geometry/opacity is inferred.                                                                                                     |
| `--focus-ring-width`, `--focus-ring-gap`, `--focus-ring-color`, `--focus-ring`                                    | Stated 2 px ink outline with 2 px gap; outline uses the actual surrounding surface as the gap.                                                                                                    |
| `--focus-field-halo`                                                                                              | Stated 3 px sky halo, inferred 45% alpha; text-field focus keeps the ink outline and ink border.                                                                                                  |
| `--opacity-disabled`                                                                                              | Measured 40%; inactive controls are exempt from active-text contrast. Busy controls retain full opacity.                                                                                          |
| `--motion-fast`, `--motion-standard`, `--motion-easing`                                                           | Inferred 120/180 ms control transitions and easing.                                                                                                                                               |
| `--motion-blink-duration`, `--motion-blink-interval-min`, `--motion-blink-interval-max`, `--motion-blink-scale-y` | Stated 120 ms, 5–7 s, scale-Y 0.1. Tokens only, no illustrations or blinking behavior.                                                                                                            |
| `--motion-paper-duration`, `--motion-paper-rise`, `--motion-paper-tilt`                                           | Stated one-shot 2.4 s / 6 px / 3°; no illustration implementation.                                                                                                                                |
| `--motion-highlight-duration`, `--motion-iteration-count`                                                         | Stated 400 ms wipe and one iteration for illustration/evidence motion.                                                                                                                            |
| `--motion-busy-duration`                                                                                          | Inferred 1 s status rotation; the button is the only ongoing status animation.                                                                                                                    |

`prefers-reduced-motion: reduce` zeroes transition/animation durations, rise and tilt,
and restores scale-Y to 1. The button explicitly disables rotation. State changes and
accessible feedback remain present. Future consumers must use these tokens and avoid
adding independent animation durations.

## Color pairing and accessibility

Use primary, secondary or subtle text on neutral surfaces. Primary/secondary text and
subtle captions achieve at least 4.5:1 on all three. Use blue ink for links on these
surfaces. Each brand ink also achieves at least 4.5:1 on its corresponding tint and
mid-tint; never pair an ink with the base fill. The unadjusted design `text-muted`
measures 4.27:1 on `surface-muted`, which is why base captions use `text-subtle`.

Enabled primary/danger buttons have white text on ink/error-ink; their hover fills
also pass 4.5:1. Secondary/ghost use primary text on neutral surfaces; danger-soft
uses error ink on coral tint/mid-tint. Status information always needs a word and icon.
Preserve native semantic controls, visible labels, and the shared focus treatment.

## Base styles, utilities and fonts

Base styles cover document text/headings, labels, native form controls, links,
quotes, selection, tables and media without introducing page layouts.
`.visually-hidden` hides supporting text visually while preserving it for assistive
technology; it reveals itself if focused. `.focus-visible` opts into the same native
focus outline. `.type-display` and `.type-paper-title` apply the non-element type roles.

Fontsource packages (5.3.0) contain all named UI weights, normal and italic faces,
and Unicode subsets including Polish characters. Webpack serves WOFF2 locally with
`font-display: swap` and `unicode-range`; there are no font CDN requests.
The Source Serif 4 family implements the design's named Source Serif face.
Licenses: [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Verification

RH-270 adds the documented overlay order: `--layer-content` (0), `--layer-popover` (100),
`--layer-slide-over` (200), `--layer-modal` (300), `--layer-toast` (400). A popup inside a
modal inherits that modal's stacking context. Component chrome continues to use the
shared palette, focus and motion tokens; no new raw color values are introduced.

`npm run test:coverage`, `npm run build`, `npm run lint`, `npm run format:check`.
`styles.test.ts` checks palette completeness, all CSS variable references, text
contrast, type/geometry and reduced-motion fallback. `toolchain.test.ts` compiles
real stylesheet/font/SVG imports in both Webpack modes. jsdom tests intentionally
check component behavior rather than claiming to measure CSS layout. Shared
executable UI has enforced 80% line/branch/function/statement gates.
