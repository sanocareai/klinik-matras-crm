# Driver V2 Reschedule Reconciliation — 7d34e05d

Date: 2026-09-25

Scope: production data correction approved by Ops for final pickup reschedule on 2026-09-27.

## Before

- Job `7d34e05d-b7f2-43cd-8842-31e13645492f`: `SCHEDULED`, date `2026-09-27`.
- V1 `routeId`, driver, helper, and vehicle were null.
- Order `RES-22092026-142` remained `PICKUP`.
- One stale V2 assignment `3d84a289-7be1-4f02-a0d8-765f23a014db` was `ACTIVE` on terminal route `f518deaa-9b85-4222-a2a0-e684d06fa356` (`COMPLETED`).
- V2 job projection was stale at `FAILED` revision 1.

## Commands and replay evidence

1. `158b789a-854b-4d38-aa74-93465c68d2de` — `REVOKE_CONFIRMED_RESCHEDULED_ASSIGNMENT`, `APPLIED`, provenance `OPS_CONFIRMED_RESCHEDULE`.
2. `4731c56e-7c75-4b0a-9163-941498a22ad2` — `RECONCILE_CONFIRMED_RESCHEDULE_JOB_STATE`, `APPLIED`, projection-only reconciliation to revision 2.

Both idempotency keys were replayed. Each returned `replayed: true`; no projector or mutation ran a second time.

## After and parity

- Assignment is `REVOKED`; active assignment count is zero.
- V1 Job remains `SCHEDULED` on `2026-09-27`; order/status, issue count 2, execution-event count 3, reschedule count 1, timestamps, and evidence were preserved.
- V2 state is `SCHEDULED`, revision 2, and source checksum matches V1.
- One revocation activity and one revocation outbox row exist.
- Projection reconciliation created one `delivery.job.plan.changed` outbox row.
- Driver and helper each received exactly one `REMOVE_JOB` and one `REMOVE_ROUTE` event.
- Old route visibility in the active snapshot predicate is zero.
- Targeted production parity returned `parityClean: true`.
- Snapshot/feed unit tests passed 10/10; historical-assignment integration passed 3/3 on a disposable database.
- All eight V2 feature flags remained OFF.

Result: the data blocker for this Job is closed. The outbox rows remain auditable and are not a reason to activate any reader or writer flag.
