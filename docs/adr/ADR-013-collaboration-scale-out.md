# ADR-013: Coordinating collaboration scale-out

- Status: Proposed
- Date: 2026-10-12
- Backlog: RH-350; depends on Task 16.1 / [ADR-007](ADR-007-realtime-document-authoring.md)
- Implementation trigger: measured room count, memory or persistence latency exceeds one writer's tested budget, or room-writer failover becomes a funded availability requirement.

## Current boundary

Today one Node/Hocuspocus process is the **single logical writer** for its rooms. Spring authorizes
each workspace/document access and commits the Yjs snapshot and validated JSON projection with
compare-and-set on sequence. An identical snapshot receipt can be retried after a lost response.
Persistence precedes broadcast and durable acknowledgement. Clients reauthorize on reconnect;
ongoing access is rechecked and revoked connections fail closed. Controlled state replacement must
disconnect old sessions and preserve document history/provenance. These are current ADR-007 invariants,
not evidence of distributed coordination. Replica count must remain one for the collaboration service.

JDBC sessions make multiple Spring replicas possible; they do not make multiple room writers safe.
CAS prevents overwrites but alone cannot coordinate divergent in-memory rooms or user acknowledgements.
Current public browser messages and private snapshot receipts remain the baseline. No lease, Redis
fan-out, hash ring or new persistence API is implemented by this ADR.

## Proposed coordination contract

Evaluate a **distributed lease per room** in PostgreSQL first, alongside deterministic room placement.
The room key includes workspace, document and the state-replacement epoch. The lease stores writer
identity, expiry and a monotonically increasing fencing term, using database time. Acquire/renew/release
must be atomic. Every commit checks current lease owner, unexpired term, epoch and expected sequence
in the same transaction as persistence. A paused writer cannot commit after its lease was reassigned;
an application timer without database fencing is insufficient. On renewal failure stop writes/broadcast,
close or redirect connections, and reload the committed state after a new lease is acquired.

Persist updates idempotently under **(document id, epoch, update id)** with a uniqueness constraint and
payload hash. Scope the document to its workspace server-side. Retrying the same key/hash returns the
original durable receipt; changing the payload under that key is a conflict. A receipt records sequence,
revision and commit time. This ledger extends today's bounded snapshot receipt; it is not a claim
that a general update ledger already exists. Retention of receipts must outlive all supported retries.
An old epoch is rejected even if a replay has a valid old lease term or access token.

Evaluate **consistent-hash partitioning** of room keys across writer instances (virtual nodes, versioned
membership). It reduces room movement but is routing, not authority: the lease still fences writes.
Rebalance drains an old owner, commits its state, releases/fences it, and loads the committed snapshot
on the new owner. Existing clients reconnect with fresh authorization and a current epoch. Do not
let two owners replay uncommitted room memory across a ring change.

## Redis fan-out is conditional

Redis Pub/Sub may distribute **committed** updates/receipts after scale measurements justify it. It
does not own document state, authorization, leases or saved status. Preserve all of the following:

1. Persist-before-broadcast: transaction commits first; no unvalidated candidate reaches other clients.
2. Compare-and-set: lease fencing, epoch and sequence validated in PostgreSQL; a Redis lock is insufficient.
3. Durable acknowledgement: only the saved receipt means Saved; fan-out delivery is never an acknowledgement.
4. Access revocation: authorize each connection/message and recheck at the existing bounded interval;
   subscribers cannot cache membership indefinitely. Spring failure closes access.
5. State replacement: increment epoch transactionally, invalidate old room credentials/leases, disconnect
   all old subscribers, load the replacement and preserve the historical original. Buffered updates from
   an old epoch require explicit human recovery, never automatic resurrection.

A committed update may be lost by Pub/Sub between commit and publication. Resolve sequence gaps by
loading durable state/state-vector sync; duplicates are idempotent. Add a transactional outbox only if
measured recovery requirements need reliable fan-out delivery. No exactly-once transport promise.

## Alternatives, rollout and open questions

| Option | Evaluation |
| --- | --- |
| Keep one writer | Chosen now: lowest cost/complexity; process restart recovers durable state, with downtime |
| Lease per room, PostgreSQL ledger | Preferred experiment; needs schema/API design, fencing and failure tests |
| Consistent-hash routing | Useful placement with lease authority; ring membership/rebalance still needs design |
| Redis lock + direct broadcast | Rejected: loses durable ordering/fencing and can falsely report Saved |
| Managed WebSocket transport | Does not replace authorization, CRDT state or persistence ownership |

Open: lease TTL/renewal under pauses, document epoch versus writer term, ledger compaction/retry window,
room admission/memory limits, ring discovery, redirects, subscriber revocation and read-only client behavior.
Introduce versioned private contracts and additive Flyway migrations with the implementation; keep browser
contracts explicit. Tests must cover split brain, paused old writer, network partition, lost commit response,
duplicate/conflicting update IDs, commit-before-publish crash, rebalance, epoch replacement and revocation
on every instance. Run the existing Spring/Node/browser collaboration suites and their >=80% coverage
gates before enabling more than one writer. No distributed-load result is claimed here.
