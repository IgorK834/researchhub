# ResearchHub icons

Source inventory: `design-reference/Reusable_parts.pdf` p.3 (80 names), and
`Brand&system.pdf` p.2. The source is raster. Artwork is selected from
[lucide-react 1.49.0](https://lucide.dev/guide/react), with explicit imports and
ResearchHub wrappers; it is not extracted from the PDF.
[ISC and Feather MIT notices](../../../../THIRD_PARTY_NOTICES.md) are retained.

Import `Icon`, `IconName`, `iconNames`, `iconRegistry` or a named component
(e.g. `SearchIcon`) from this directory. `<Icon name="search" />` and named
components share the same contract: 24-unit viewBox, 1.75-unit rounded stroke,
no fill, currentColor, sizes 14–20 or 24 (default 16). Stroke scales with the
viewBox; it is not forced to 1.75 rendered pixels at small sizes.

Icons are decorative (aria-hidden, unfocusable) by default. Put them beside
visible text or inside a named control. For an independent meaningful image,
supply `label="Search sources"`; it exposes role=img and that accessible name.
A blank label stays decorative. Never communicate status or an action through
shape/color alone. Icon-only Button requires its own action aria-label; the
icon inside it remains decorative. Unknown registry names fail TypeScript.

## Artwork mapping

Design names are stable public keys. Lucide equivalents below intentionally
retain a consistent open artwork vocabulary; the raster and equivalents can
differ in individual path details. No logo or illustrations are included.

| ResearchHub name | Lucide component    |
| ---------------- | ------------------- |
| `search`         | `Search`            |
| `home`           | `House`             |
| `book`           | `Book`              |
| `library`        | `Library`           |
| `file`           | `FileText`          |
| `text`           | `TextAlignStart`    |
| `note`           | `StickyNote`        |
| `sparkle`        | `Sparkles`          |
| `chart`          | `ChartColumn`       |
| `lineChart`      | `ChartLine`         |
| `scatter`        | `ChartScatter`      |
| `users`          | `UsersRound`        |
| `user`           | `UserRound`         |
| `sliders`        | `SlidersHorizontal` |
| `help`           | `CircleHelp`        |
| `plus`           | `Plus`              |
| `minus`          | `Minus`             |
| `chevDown`       | `ChevronDown`       |
| `chevUp`         | `ChevronUp`         |
| `chevRight`      | `ChevronRight`      |
| `chevLeft`       | `ChevronLeft`       |
| `sort`           | `ChevronsUpDown`    |
| `check`          | `Check`             |
| `x`              | `X`                 |
| `upload`         | `Upload`            |
| `download`       | `Download`          |
| `link`           | `Link`              |
| `quote`          | `Quote`             |
| `comment`        | `MessageSquare`     |
| `clock`          | `Clock`             |
| `history`        | `History`           |
| `calendar`       | `Calendar`          |
| `folder`         | `Folder`            |
| `table`          | `Table`             |
| `grid`           | `Grid2X2`           |
| `code`           | `CodeXml`           |
| `terminal`       | `Terminal`          |
| `play`           | `Play`              |
| `refresh`        | `RefreshCw`         |
| `more`           | `Ellipsis`          |
| `arrowRight`     | `ArrowRight`        |
| `arrowLeft`      | `ArrowLeft`         |
| `arrowUp`        | `ArrowUp`           |
| `arrowDown`      | `ArrowDown`         |
| `pencil`         | `Pencil`            |
| `highlight`      | `Highlighter`       |
| `trash`          | `Trash2`            |
| `lock`           | `Lock`              |
| `key`            | `KeyRound`          |
| `shield`         | `ShieldCheck`       |
| `eye`            | `Eye`               |
| `bell`           | `Bell`              |
| `bold`           | `Bold`              |
| `italic`         | `Italic`            |
| `heading`        | `Heading`           |
| `list`           | `List`              |
| `undo`           | `Undo2`             |
| `redo`           | `Redo2`             |
| `image`          | `Image`             |
| `globe`          | `Globe`             |
| `filter`         | `ListFilter`        |
| `star`           | `Star`              |
| `warn`           | `TriangleAlert`     |
| `alert`          | `CircleAlert`       |
| `info`           | `Info`              |
| `flask`          | `FlaskConical`      |
| `layers`         | `Layers`            |
| `columns`        | `Columns2`          |
| `bookmark`       | `Bookmark`          |
| `send`           | `Send`              |
| `database`       | `Database`          |
| `panel`          | `PanelLeft`         |
| `mail`           | `Mail`              |
| `logout`         | `LogOut`            |
| `archive`        | `Archive`           |
| `copy`           | `Copy`              |
| `external`       | `ExternalLink`      |
| `wifi`           | `Wifi`              |
| `wifiOff`        | `WifiOff`           |
| `cursor`         | `MousePointer2`     |
