# Armada (Delivery & Fulfillment) — Redesign & Maximization
### Design & Roadmap Document
**Owner:** Sano · **Company:** Klinik Matras by SANO Care · **Date:** September 2026
**Status:** Proposal — awaiting Gilang/ops sign-off on Open Questions (§9) before Phase B onward

---

## 0. Relationship to existing docs

This document does not replace `SANSS-PRD-v1.md`. It extends §7.2 (FR-L, scheduling & routing), §7.3 (FR-D, driver app), §7.8 (FR-N, notifications), and the "Command" concept from §1.4/§4 — scoped down to what's realistic for this one workspace rather than the full cross-portal vision.

**Explicit constraint from the owner for this redesign: keep the existing visual style.** Nothing here proposes a new design language, new component library, or new color system. Every screen change reuses `frontend/src/components/ui/*` primitives and the tokens already defined in `docs/design-system/sano-*.md` and the armada-specific `delivery-light.css`/`delivery-dark.css` theme files. This is an information-architecture and capability redesign, not a visual rebrand.

---

## 1. Executive summary

The brief described this workspace as "still under development." Two full audits of the actual codebase (`KM_SANSS/frontend/src/pages/armada/*`, `backend/src/routes/armada.js`, the Prisma schema, and the mobile app) found that framing is out of date. As of September 2026:

**Already functional, real data, no mock:**
- Dispatch & job scheduling (`ArmadaJobs.jsx`, `ArmadaDashboard.jsx`)
- Route planning: a real 3-panel drag-and-drop board with nearest-neighbor auto-sequencing (`ArmadaRoutes.jsx`, `RouteMap.jsx` on Leaflet + OSRM)
- Fleet/vehicle management: vehicles, expenses, service history, incidents (`ArmadaPengaturan.jsx`, the largest and most polished armada page)
- Proof of delivery review (`ArmadaPod.jsx`)
- **Live GPS tracking** — genuinely live, backed by `JobPositionPing` rows written every 2 minutes from the driver's browser geolocation, not the old `trackingMock.js` (which is now dead code, referenced only in comments)
- Exceptions/returns (`ArmadaIssues.jsx`, `ArmadaReturns.jsx`) and a delivery report (`ArmadaDeliveryReport.jsx`)
- The driver experience itself: `DriverJobs.jsx`, a page in the same React PWA — arrival, photo capture (4-angle condition + placement), signature, cash collection, offline GPS-ping queueing (`positionQueue.js`). **The separate `KM_SANSS/mobile/` Expo app is not this** — it's a Sales/CRM companion app (Inbox, Pipeline, Customer 360) with no driver/job/GPS code at all.

**Real gaps** (confirmed absent in code, not just unpolished):
1. **No SLA monitoring for delivery/dispatch.** The only SLA logic in the codebase (`slaAlertJob.js`) watches sales chat response time. Nothing tracks a late pickup, a delivery past its promised window, or a route running behind plan.
2. **Customer-facing delivery notifications are built but 3 of 4 disabled.** `customerNotifications.js` has the four WhatsApp trigger points the PRD specifies (§7.8), but `DELIVERY_NOTIF_AKTIF = false` since Aug 31, 2026 — an explicit owner decision to wait until the system is trusted in daily use. Only "ready for delivery" still fires (from the production side, not armada).
3. **No cross-cutting "what needs attention right now" view.** Each page is scoped to its own object (jobs, routes, vehicles, issues). There's no single screen answering "which units/jobs are at risk today, across all of it."
4. **Exception handling is historical, not live.** `ArmadaIssues.jsx`/`ArmadaReturns.jsx` list what already went wrong; there's no surface for a dispatcher to see a problem the moment it happens mid-route and act on it.

There's a fifth, lower-priority item, cheap to close and done first (Phase A, §8 — **already completed** as of this document's writing): an orphaned `ArmadaPlaceholder.jsx` component (imported in `App.jsx` but mounted on no route), a dead `features/armada/data/trackingMock.js` file left over from before live GPS was wired up, and a stale `App.jsx` comment that still described `/armada/tracking` as pure simulation after it had already gone live — plus three Portal landing-page cards (`divisionContent.js`) still marked "Segera hadir" for Route Planner and Proof of Delivery, which have in fact shipped. All fixed.

**Correction from initial audit:** `pages/Armada.jsx` and `ArmadaJobs.jsx` are *not* duplicated implementations needing a merge — reading the actual code shows `ArmadaJobs.jsx` deliberately composes `<Armada />` as its "Papan" (board) view mode, with an explicit in-code rationale ("Papan sengaja DIPERTAHANKAN, bukan diganti") for keeping the working dispatch board intact rather than rebuilding it. This is intentional architecture, not tech debt, and this redesign leaves it untouched. The remaining schema-ready-but-unbuilt item — `Vehicle.capacitySlots` checking, blocked on a mattress-size→slot-count conversion table nobody has supplied yet — stays open, tracked in §9.

This document proposes closing gaps 1–4, informed by what's already correctly built, in five sequenced phases (§8).

---

## 2. Current-state map

| Page | File | Data source | Maturity |
|---|---|---|---|
| Dashboard | `pages/armada/ArmadaDashboard.jsx` | Real: `getArmadaJobs`, unscheduled list, route summary | Functional/polished |
| Jobs ("Jadwal & Penugasan") | `pages/armada/ArmadaJobs.jsx` | Real: `GET /armada/jobs`, `getDrivers` | Functional |
| Orders | `pages/armada/ArmadaOrders.jsx` | Real: `api.getOrders` | Functional |
| Routes (Route Planner) | `pages/armada/ArmadaRoutes.jsx` + `RouteMap.jsx` | Real: drag/drop board, Leaflet/OSRM | Functional |
| Pengaturan (fleet admin) | `pages/armada/ArmadaPengaturan.jsx` | Real: vehicles/expenses/services/incidents CRUD | Polished, largest page |
| Pod (proof-of-delivery review) | `pages/armada/ArmadaPod.jsx` | Real: `api.getPodJobs` | Functional |
| Tracking (live map) | `pages/armada/ArmadaTracking.jsx` | Real GPS via `JobPositionPing` | Functional, recently redesigned |
| Issues (Kendala) | `pages/armada/ArmadaIssues.jsx` | Real: `api.getIssues` | Functional, simple |
| Returns (Retur/Revisi) | `pages/armada/ArmadaReturns.jsx` | Real: `api.getRevisions` | Functional |
| Delivery Report | `pages/armada/ArmadaDeliveryReport.jsx` | Real: report/fleet summary endpoints | Functional |
| Placeholder | `pages/armada/ArmadaPlaceholder.jsx` | N/A | **Orphaned** — imported, unrouted |
| Legacy `pages/Armada.jsx` | 780 lines, still mounted at `/armada/jobs` | Real (driver-group/broadcast logic) | Functional but **not merged into `ArmadaJobs.jsx`** |
| `pages/DriverJobs.jsx` | The actual driver flow | Real: `getMyJobs`, `useDriverTracking` | Functional — this *is* the driver app |

**Backend:** `backend/src/routes/armada.js` covers jobs, routes, vehicles/fleet, drivers/helpers, POD, issues/returns, payments, reports, and tracking. Supporting services: `deliveryHandoff.js` (Production → Armada: auto-creates a skeleton delivery job when a unit is ready), `armadaAutoJob.js` (Sales → Armada: auto-creates a pickup job when units go `AWAITING_PICKUP`), `jobStatus.js` (shared status constants, including `STALE_UNSCHEDULED_JOB` detection), `slaAlertJob.js` (sales-chat SLA only, not delivery).

**Data model available to build against** (Prisma): `Job` (type, status, scheduledDate, timeWindow, estimatedDurationMinutes, driverId, helperId, sequence, POD fields, failure/reschedule fields, vehicleId, routeId), `Route` (code, date, driver/helper/vehicle, status, plannedDistanceKm, plannedDurationMin), `Vehicle` (plateNumber, capacitySlots, status), `VehicleExpense`/`VehicleService`/`VehicleIncident`, `JobPositionPing` (live GPS log). Enums: `JobType`, `JobStatus`, `PodStatus`, `VehicleStatus`.

---

## 3. Information architecture

Keep the existing route structure and page set — it maps cleanly to real operational tasks and matches how the team already thinks about the work. `pages/Armada.jsx` stays exactly as-is, composed inside `ArmadaJobs.jsx`'s "Papan" view — that's working architecture, not something to unwind (see the correction in §1). One structural addition:

- **Add one new landing surface: "Ringkasan Operasional" (Delivery Command overview)** — see §6. It sits above the existing Dashboard, not instead of it: Dashboard stays job/route-scheduling-focused; the new screen is the "what needs my attention right now" cockpit. `divisionContent.js`'s "SLA Monitor"/"Delivery SLA" Portal cards stay `path: null` (honestly, per that file's own documented convention) until this screen and the SLA feed (§4) actually exist, then get pointed at them.

No new workspace, no new nav pattern, no new sidebar section beyond one added link — this stays inside `armada` exactly as scoped by `WorkspaceSwitcher.jsx`.

---

## 4. Gap 1 — SLA monitoring for delivery/dispatch

**Status: v1 shipped (visibility only, no outbound alerting yet — see below for why).**

While implementing this, two things sharpened the scope from what was originally proposed above:

1. **The "never scheduled" half of this gap turned out to already exist.** `ArmadaDashboard.jsx`'s "Perlu Dijadwalkan" panel already flags jobs that never got a `scheduledDate`, with a deliberately-tuned 7-day threshold (raised from an initial 3 days after production data showed 3 days lit up the entire backlog — documented in-code, D-050). Building a second, separate "unscheduled backlog SLA" concept would have duplicated that, exactly the kind of drift this codebase's own conventions warn against. Left untouched.
2. **`Job.timeWindow` can't support an intraday breach check.** It's free text ("pagi", "10:00-12:00", or nothing at all) — not a structured time column. `ArmadaDeliveryReport.jsx` already carries the same honest disclaimer about this field. Computing "breached its time window" from unstructured text would mean fabricating precision the data doesn't have, so that condition was dropped rather than faked.

**What "SLA breach" means in v1 (the one gap that had no existing coverage):** a job whose `scheduledDate` has already passed (WIB, day-granularity) while its `status` is still active (`UNSCHEDULED`/`SCHEDULED`/`ASSIGNED`/`EN_ROUTE`/`ARRIVED` — not `COMPLETED`/`FAILED`/`RESCHEDULED`). This is a promise that was made to a specific day and never closed out — distinct from "never scheduled at all."

**Implemented:**
- `frontend/src/features/armada/jobStatus.js` — `isJobOverdue(job)` / `overdueDays(job)`, built on the existing `hariSejak()` WIB-day-diff helper (`utils/formatDate.js`), the same single-source-of-truth pattern the rest of this file already follows. No backend change needed — `Job.scheduledDate`/`status` are already returned by `GET /armada/jobs`/`GET /armada/board`.
- `ArmadaJobs.jsx` — a red "Terlambat N hari" line on each overdue job row, plus a "Terlambat" count added to the list view's hero stats (fifth box; `WorkspaceHero`'s grid wraps gracefully rather than needing a slot swapped out).
- `ArmadaDashboard.jsx` — overdue jobs surfaced inside the existing "Butuh Perhatian" card (ahead of vehicle-document expiry warnings, since a broken delivery promise is more urgent), not a new card — same "something needs action now" purpose as what's already there.

**Deliberately not built yet: outbound alerting (WA/push) and a `JobSlaBreachLog` audit table.** §9's open questions — SLA thresholds beyond "day already passed," and who actually receives an alert — aren't answered. Pinging real staff phones with a new automated message type on an unreviewed threshold is the kind of thing that's easy to send and hard to un-send; in-app visibility ships now, an alerting pass follows once those questions have owners' answers. The `slaAlertJob.js` pattern (config-driven threshold + in-memory dedup, no DB log needed) is still the right template to reuse when that happens — this doesn't need a new table even then, since sales SLA alerting doesn't have one either.

**Still open (§9):** on-time delivery rate as a Command-level historical metric (§6/§7.7 FR-C-04) — that needs aggregating completed jobs against their `scheduledDate`, which is Gap 3 territory, not v1 of this gap.

---

## 5. Gap 2 — Customer communication re-activation

The infrastructure already exists and matches the PRD's "four triggers only" discipline (§7.8) — this is a re-activation and trust-building problem, not a build problem. Proposed staged approach, explicitly framed as a proposal requiring the same kind of sign-off that turned it off:

1. **Shadow mode first.** Turn the 3 disabled triggers (job start, pickup complete, delivered) on in a mode that logs what *would* have been sent (recipient, template, timestamp) without actually sending, surfaced as a small panel in `ArmadaJobs.jsx` or the job detail view. Let ops eyeball a week of "would-have-sent" messages against what actually happened operationally.
2. **Limited rollout.** Enable real sending for one trigger at a time, starting with the lowest-risk one (arguably "pickup complete" — informational, no promise being made), for a subset of jobs (e.g. one driver or one day of the week) before going wide.
3. **Full re-activation**, with message delivery status made visible in the dispatcher UI (sent/failed/pending) so it isn't a black box the way "just toggle the flag" would be.

This directly respects the reason the flag was turned off (§ CLAUDE.md, Aug 31: "sales handles this manually until Delivery Hub is trusted in daily use") — the plan is to earn that trust with visible logs before flipping the switch, not to just flip it back.

---

## 6. Gap 3 — Command-style cross-cutting visibility ("Ringkasan Operasional")

A single new screen, reusing existing `ui/stat-card`, `section-card`, and `page` components already used across the mature Sales CRM pages for visual consistency. Content (all derivable from existing data, no new backend beyond query aggregation):

- **Jobs at risk today** — unscheduled jobs whose order is close to its promised date, and any current SLA breaches (§4).
- **Driver workload right now** — active route per driver, jobs remaining, using existing `Route`/`Job` associations.
- **Fleet status** — vehicles `IN_USE`/`MAINTENANCE`/`AVAILABLE`, reusing `getFleetSummary` already built for `ArmadaDeliveryReport.jsx`.
- **Exception feed** — today's failed visits/incidents, feeding into Gap 4.
- **On-time delivery rate** (rolling 7/30 day) — the PRD metric this workspace has never actually computed.

This is scoped as "Delivery Command," not the full PRD §1.4 cross-portal Command concept (which would also need Workshop/production and Finance data) — that stays a future, separate initiative if the org wants it.

---

## 7. Gap 4 — Exception & field-coordination handling

Today, a failed visit or incident is recorded (`Job.failureReason`/`failurePhotoUrls[]`, `VehicleIncident`) and shows up later in `ArmadaIssues.jsx`/`ArmadaReturns.jsx` — but nothing tells a dispatcher *the moment* it happens. Proposed addition:

- A **live "needs attention now" list** as a section of the Delivery Command overview (§6), populated by jobs that just transitioned to `FAILED` or a vehicle that just logged an incident, using the same polling pattern `ArmadaTracking.jsx` already uses (15s interval) rather than introducing a new real-time transport (no new WebSocket layer needed given the existing polling approach already works at this scale).
- A **one-click path from that alert into the existing reschedule flow** (`POST /armada/issues/:jobId/reschedule`, already built) — the goal is shrinking time-to-reaction, not building a new reschedule mechanism.

---

## 8. Phased roadmap

Sequenced, each phase independently shippable — consistent with the existing PRD's own delivery philosophy (§11: "do not build phases in parallel with a small team").

| Phase | Scope | Depends on |
|---|---|---|
| **A — Cleanup** ✅ done | Deleted orphaned `ArmadaPlaceholder.jsx` + dead `trackingMock.js`, removed their unused imports from `App.jsx`, fixed the stale `App.jsx` tracking comment, pointed `divisionContent.js`'s Route Planner/Proof of Delivery/Driver App cards at their real, already-shipped routes | Nothing — done first, unblocks clean iteration |
| **B — SLA monitoring** ✅ v1 shipped (visibility only) | `isJobOverdue`/`overdueDays` in `jobStatus.js`, overdue badges + hero stat on `ArmadaJobs.jsx`, "Butuh Perhatian" surfacing on `ArmadaDashboard.jsx`. **Remaining, blocked on §9 sign-off:** outbound WA/push alerting, on-time delivery rate metric | Phase A |
| **C — Delivery Command overview** | New "Ringkasan Operasional" screen, all sections in §6 | Phase B (needs the breach feed) |
| **D — Exception/field-coordination live surface** | "Needs attention now" section + one-click reschedule from it | Phase C (lives inside the same screen) |
| **E — Customer comms re-activation** | Shadow mode → limited rollout → full, per §5 | Independent of B–D, but sequenced last because it's the most owner-sensitive and benefits from the trust-building the other phases create |

---

## 9. Open questions — answer before Phase B

1. **SLA thresholds.** How much buffer before `scheduledDate` counts as "at risk" vs. "breached"? Is the tolerance the same for pickup and delivery jobs?
2. **Who receives SLA breach alerts?** Dispatcher role only, or also Owner/Admin (Juri, Kemal)?
3. **Customer-comms re-activation approval.** Who signs off on moving from shadow mode to real sending — Gilang directly, or can ops (Juri/Kemal) approve once shadow-mode logs look clean?
4. **Capacity-slot conversion table.** `Vehicle.capacitySlots` exists but nothing maps mattress size → slot count. This blocks making `onOptimize`/route capacity-checking real (called out as a known gap, not in the user's top-4 but adjacent to Gap 3's fleet-status section). Needs the actual conversion table from whoever runs logistics.

---

## 10. What this document deliberately does not do

- It does not change any visual style, component library, or color system — per explicit instruction, this is IA and capability work only.
- It does not touch the Expo `mobile/` app — that's a separate Sales/CRM product with no armada surface today; extending it is a distinct decision, not assumed here.
- It does not attempt full VRP route optimization — consistent with PRD §1.5, that stays out of scope.
- It does not implement the full cross-portal PRD §1.4 "Command" vision — §6's "Delivery Command" is scoped to this workspace's own data only.