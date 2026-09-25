# Production–Delivery V2 RC Writer Canary and Rollback Runbook

Frozen baseline: `cf3e4124bbc16c28f112eec22c608eb468098735` (`origin/main` at RC start).

Production observed before RC: `aecef10d`.

RC identity: the commit containing this runbook; record `git rev-parse HEAD` in the execution ticket before any canary.

This document prepares—but does not authorize—the writer canary. No V2 flag may be changed without a separate owner decision after the RC gate passes.

## Invariants

1. Do not enable Driver or Delivery Web readers during writer-only canary.
2. Do not enable either V1 writer fence.
3. Delivery route and execution writers are one canary unit. Change both in one audited database transaction; never leave only one enabled as a steady state.
4. Keep Production writer/reader OFF until its own canary decision and current writer audit are approved.
5. Preserve endpoints, payloads, enums, and Sales, Finance, Warehouse, and Messenger contracts.
6. Every V1 mutation and its V2 state/publication/feed/outbox projection must commit atomically through the existing command owner.

## Pre-canary gate

- Confirm deployed commit equals the approved RC SHA.
- Confirm migration status clean and no checksum drift.
- Confirm all eight flags are OFF and V1 is the active reader/writer.
- Confirm latest backup and rollback release/image are readable.
- Re-run only drift-sensitive checks: health, writer audit, Delivery shadow parity, pending exceptions, pending outbox count, and target active-route inventory.
- Record a fixed canary start/end window, operator, stop authority, and route/order IDs to observe.
- Do not proceed with an unresolved `KEEP_V1`, active-assignment mismatch, snapshot-integrity error, or shared-core change after the frozen baseline.

## Writer-only canary sequence

1. Capture before-state for the eight flags, active routes/jobs, publications, assignment counts, feed cursors, and outbox watermark.
2. In one audited transaction, enable only:
   - `delivery_v2_writer_route`
   - `delivery_v2_writer_execution`
3. Assert these remain OFF:
   - `driver_v2_snapshot_reader`
   - `delivery_web_v2_reader`
   - `production_v2_writer`
   - `production_v2_reader`
   - `delivery_v1_writer_fence`
   - `production_v1_writer_fence`
4. Exercise a bounded set of normal V1 operations already scheduled by Ops: route publish/edit/reassignment plus one execution transition. Do not fabricate customer actions.
5. For every operation, compare V1 state to V2 state/publication/assignment/feed/outbox and verify one command owner, one idempotency result, and no ghost/missing stop.
6. Observe errors, latency, outbox age, command conflicts, and parity during the fixed window. Readers remain V1 throughout.
7. End with an explicit GO/ROLLBACK decision. Writer canary success does not authorize Driver Reader or OTA rollout.

## Immediate stop conditions

- Any V1 request/response or business behavior changes.
- V1 mutation succeeds while V2 projection fails, or the reverse.
- Duplicate command/outbox/feed event, missing revocation, ghost route, missing stop, or revision gap.
- Any Finance, Sales, Warehouse, Messenger, or Armada regression.
- Unexpected reader/fence flag activation or a nonzero critical parity mismatch.

## Flag rollback

1. In one audited transaction, set `delivery_v2_writer_route=false` and `delivery_v2_writer_execution=false`.
2. Confirm both reader flags and both V1 fences remain OFF.
3. Do not delete V2 commands, publications, assignments, feed rows, outbox rows, or audit evidence.
4. Verify V1 write/read flows, health, and the exact failed aggregate.
5. Reconcile only through the owning idempotent command; do not run direct repair SQL.

## Release rollback

Use release rollback only for application/runtime failure, not to erase data written during canary.

1. Stop the canary by rolling writer flags OFF first.
2. Atomically switch application services to the recorded rollback release/image.
3. Do not roll back additive migrations or restore the database unless separately approved for a confirmed data-loss event.
4. Restart only affected application services; PostgreSQL and persistent mounts remain in place.
5. Verify commit/image, four container states, restart counts, mounts, local/public health, V1 regression, and all flags OFF.
6. Preserve the failed RC release, logs, outbox, command records, and evidence for diagnosis.

## Canary acceptance criteria

- Bounded V1 operations succeed with unchanged contracts.
- Matching V2 projections/publications are committed atomically and exactly once.
- No critical Delivery parity mismatch or unresolved writer bypass.
- Revocations remove stale jobs/routes for every prior recipient.
- Outbox has no duplicate dedupe key, stuck processing row, or failed delivery.
- Readers/fences remain OFF, health remains 200, and rollback is immediately executable.
