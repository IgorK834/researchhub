# Comments v2 — typed human mentions

This additive contract keeps TEXT_MARK_V1 document/Yjs anchors. Plain comment bodies remain escaped text. A human mention is a selected workspace member with an explicit UTF-16 range in the trimmed comment body; text detection never decides the recipient. `@ai` remains an independent explicit contribution/action.

Create/reply keep existing `id`, `body` and root `anchor`, adding optional `mentions` (default `[]`, maximum 20). Each mention has `userId`, `displayLabel`, `start` (inclusive), `end` (exclusive). Covered text must equal `@displayLabel`. Invalid/overlapping ranges, stale labels and non-current recipients receive 400. Durable user ids disambiguate duplicate names.

Root responses add `revision` (initially 1). Root/reply responses include mentions with server-computed `available`; false means the member is no longer eligible. This is presentation metadata, never an authorization grant. Author-only `PUT .../comments/{id}/body` takes `revision`, `body`, `mentions`; current edit capability is required. A stale revision receives 409. Editing never changes the Yjs/document anchor or comment target and never executes AI.

Notification audience comes from added recipient ids in each committed comment revision. Removing, shifting or retaining a mention creates no new event for that recipient. Creation/reply replay must match all typed identities and text. A mention removed before deferred delivery is skipped. Reading delivered events still requires current workspace/target access.

See [the workflow contract](../../../docs/development/collaboration-workflow.md) for the feed, quotas, transitions and verification.
