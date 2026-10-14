# PL/EN interface and explicit content languages

Task 35.10, reviewed 2026-10-14. The portfolio default is English; Polish can be selected on public/auth pages and in the authenticated sidebar. Dictionaries cover public marketing/auth, workspace navigation/settings/members, sources/import/search, document editing/comments/history/provenance/exports, research chat and analysis screens, including accessible labels, empty/loading/error states and units.

## Keys and display formatting

`frontend/src/shared/i18n/` has typed semantic keys: common/domain keys plus stable component-scoped copy ids. Keys do not use the English sentence as their identifier. Existing ids must be retained when wording changes. PL and EN key sets/interpolation slots are checked automatically. `translate` falls back to readable English for a missing PL translation and then to a localized generic message for an unknown key; it never exposes the raw key.

React subscriptions update labels without remounting editors, replacing a document, clearing an input or restarting a mutation. Static UI configuration uses lazy localized labels rather than capturing one locale at module initialization. Command ids, roles, API enum values, routes, DOM identities and scientific symbols remain canonical and separate from their labels.

Counts use `Intl.PluralRules` (PL one/few/many/other and EN one/other). Display numbers/dates use explicit `en-US` / `pl-PL` `Intl.NumberFormat` / `Intl.DateTimeFormat`. Source size units and descriptions are UI presentation only. Canonical decimal input still uses a dot; locale does not rewrite parser input, computed output, dataset cells, formulas, physical units, source citations or stored UTC timestamps. Authored content and historical data—including English text and technical codes—are not automatically translated.

API errors remain stable codes. The Polish UI selects safe localized guidance from the code instead of exposing English backend/provider details; field validation has localized guidance. Server authorization, membership checks, CSRF and canonical data validation are unchanged.

## Preference isolation

`researchhub.ui.locale.v1` is stored only in **sessionStorage**. Reloads in the same tab retain the selection. No account preference API, shared demo-account mutation, database locale, third-party translation service, credential or tracking cookie is involved. Another browser session using the same account remains independent. Blocked browser storage falls back safely. Logout does not mutate anyone else's preference.

## UI, template, export and AI language are separate

- Template language is an explicit create-dialog selection; both languages have all four bundled structures. Copying a chosen structure is not automatic translation of an existing document.
- Export language is independently selected (default English) and frozen as additive `exportLanguage` metadata in the report. Old report snapshots without it default to English labels. The selected bundled CSL locale (`en-US` / `pl-PL`) and the explicitly selected APA 7 / IEEE style format verified metadata without changing citation/source identity. No remote CSL style/locale is fetched.
- Answer language is independently selected in workspace questions, research conversation and contextual canvas chat. `answerLanguage: "en" | "pl"` is an explicit request field, not inferred from UI/session or `Accept-Language`. It becomes a server-owned language constraint in the contextual system prompt, participating in its SHA-256 and normal token budget. Source quotations, bibliography titles, citation keys, notation, units and scientific values must stay original. The worker's existing template family identifiers are preserved; the exact language variant is identified by the frozen prompt hash. Legacy requests without the field preserve their original prompt identity.
- Conversation retry identity includes the selected answer language (V52). Canvas requests already freeze their complete JSON selection and hash. Changing the UI locale does not change an in-flight or retry payload. No new automatic translation/model request is made while typing or switching language.

## Verification and extension

`node scripts/i18n/validate.cjs` validates the complete PL/EN catalog and eight reviewed template manifests. Jest checks key/slot parity, missing-key fallback, Polish plurals, date/number formatting, canonical decimal stability, session persistence/storage denial and mounted-input preservation. Both-locale production browser flows check public/auth navigation, preview, keyboard/focus/cancel, creation/retry/quota, explicit export language, shared-account isolation and axe accessibility. JaCoCo/Jest enforce 80% line and branch coverage for the changed executable modules.

Add a new UI string under a stable semantic key in both dictionaries; don't translate DOM text after rendering or match arbitrary source/user strings against an English dictionary. Preserve deliberate technical identifiers/acronyms. Add a plural message instead of concatenating a translated singular/plural suffix. New languages require explicit dictionary, formatter, template, CSL-locale and content-language support, not implicit fallback to a locale the server cannot validate.
