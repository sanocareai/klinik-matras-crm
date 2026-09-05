# Armada (Delivery & Fulfillment) — Redesign & Maximization
### Design & Roadmap Document
**Owner:** Sano · **Company:** Klinik Matras by SANO Care · **Date:** September 2026
**Status:** Phases A-D shipped. Phase E deliberately not built (owner decision, §5). Route Planner card-identification + emergency-edit follow-up shipped (§10, outside the original 4-gap scope, requested directly on top of it after Phase D).

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

**Status: decided — stays manual, not being built for now (owner decision, September 2026).** Confirmed directly: sales keeps handling delivery-status WhatsApp messages by hand. `DELIVERY_NOTIF_AKTIF` stays `false`; the three disabled triggers in `customerNotifications.js` are not being re-enabled as part of this redesign.

The staged rollout below is kept in this document as the plan to use *if and when* that decision changes — no code should be written against it until then.

1. **Shadow mode first.** Turn the 3 disabled triggers (job start, pickup complete, delivered) on in a mode that logs what *would* have been sent (recipient, template, timestamp) without actually sending, surfaced as a small panel in `ArmadaJobs.jsx` or the job detail view. Let ops eyeball a week of "would-have-sent" messages against what actually happened operationally.
2. **Limited rollout.** Enable real sending for one trigger at a time, starting with the lowest-risk one (arguably "pickup complete" — informational, no promise being made), for a subset of jobs (e.g. one driver or one day of the week) before going wide.
3. **Full re-activation**, with message delivery status made visible in the dispatcher UI (sent/failed/pending) so it isn't a black box the way "just toggle the flag" would be.

This directly respects the reason the flag was turned off (§ CLAUDE.md, Aug 31: "sales handles this manually until Delivery Hub is trusted in daily use") — the plan is to earn that trust with visible logs before flipping the switch, not to just flip it back.

---

## 6. Gap 3 — Command-style cross-cutting visibility ("Ringkasan Operasional")

**Status: shipped.** New page `frontend/src/pages/armada/ArmadaRingkasan.jsx`, route `/armada/ringkasan`, sidebar entry in the OPERASIONAL section (right below Dashboard) and a Portal landing card. All data comes from endpoints that already existed — no new backend routes or migrations.

**Correction from the original proposal:** it said to reuse `ui/stat-card` — that component is the Sales-CRM-side "DS v2.2" blue-block KPI style. Per the owner's explicit instruction not to change the existing look, this page instead reuses armada's *own* established visual pattern — the same tile shape `DeliveryKpiRow`/`ArmadaDashboard.jsx` already use (icon badge + `dh-figure` big number + label), `SectionCard`-equivalent `Card` panels, and `EmptyState`. A generic `Tile` sub-component was added locally to this one page rather than modifying the shared `DeliveryKpiRow` (whose click behavior assumes a real `JobStatus` value, which "overdue"/"backlog" aren't).

**Implemented sections:**
- **Top stat row** — Job Terlambat (reuses Gap 1's `isJobOverdue`), Backlog Lama (jobs unscheduled ≥7 days, same threshold as the Dashboard's "Perlu Dijadwalkan" panel — not duplicated logic, just read from the same `unscheduled` job list), Kendala Terbuka (`GET /armada/issues?status=OPEN`), Ketepatan Waktu (see below).
- **"Perlu Perhatian Sekarang"** — merges overdue jobs, open issues, and recent vehicle incidents into one clickable feed, each row routing to where it can actually be acted on (job detail, Issues page, Fleet settings).
- **"Beban Kerja Driver — Hari Ini"** — today's `GET /armada/jobs?date=<today>` grouped by driver, plus an "unassigned" row.
- **"Status Armada"** — `GET /armada/reports/summary` → `byVehicleStatus` (verified field name directly against `backend/src/routes/armada.js:2513` before shipping, not assumed).
- **On-time delivery rate** — the PRD metric (§7.7 FR-C-04) this workspace never computed: among the last 300 `COMPLETED` jobs that have both `scheduledDate` and `completedAt`, the % where `completedAt`'s WIB calendar day is on or before `scheduledDate`. Day-granularity only, same discipline as Gap 1 — `timeWindow` still can't support an hour-level "on time."

**Not built (deliberately smaller than the original proposal):** driver workload does not fetch a per-driver route summary (`getArmadaRouteSummary`) — that would mean one API call per driver on every page load, which doesn't scale and wasn't necessary for a job-count view. If per-driver distance/duration ever matters here, add it as a drill-down on click, not an eager fetch.

This stays scoped as this workspace's own "Delivery Command," not the full PRD §1.4 cross-portal Command concept (which would also need Workshop/production and Finance data) — that remains a future, separate initiative if the org wants it.

---

## 7. Gap 4 — Exception & field-coordination handling

**Status: shipped.** A failed visit or incident used to only show up later in `ArmadaIssues.jsx`/`ArmadaReturns.jsx` — nothing told a dispatcher *the moment* it happened. `ArmadaRingkasan.jsx`'s "Perlu Perhatian Sekarang" feed (§6) now surfaces failed jobs and recent incidents in one place, and:

- **Live refresh.** `load()` polls every 15 seconds, reusing `ArmadaTracking.jsx`'s exact `POLL_MS` pattern rather than introducing a new real-time transport. Only the first call sets `loading`; subsequent polls update silently so the page doesn't re-skeleton every 15 seconds.
- **Inline one-click reschedule.** Clicking an open-issue row opens `IssueRescheduleDrawer` (the same component `ArmadaIssues.jsx` uses) directly in place — reused, not rebuilt. Verified against `deriveIssueStatus()` (`backend/src/routes/armada.js:1408-1414`) that every job with `issueStatus === "OPEN"` genuinely has `status === "FAILED"`, so the drawer's reschedule form is always actionable for these rows, never a dead end.

Overdue (not-yet-failed) job rows still route to the Jobs list / job detail drawer rather than getting their own inline editor — `JobDetailDrawer` already covers full edit there, so a second mini-editor on this page would just duplicate it.

---

## 8. Phased roadmap

Sequenced, each phase independently shippable — consistent with the existing PRD's own delivery philosophy (§11: "do not build phases in parallel with a small team").

| Phase | Scope | Depends on |
|---|---|---|
| **A — Cleanup** ✅ done | Deleted orphaned `ArmadaPlaceholder.jsx` + dead `trackingMock.js`, removed their unused imports from `App.jsx`, fixed the stale `App.jsx` tracking comment, pointed `divisionContent.js`'s Route Planner/Proof of Delivery/Driver App cards at their real, already-shipped routes | Nothing — done first, unblocks clean iteration |
| **B — SLA monitoring** ✅ v1 shipped (visibility only) | `isJobOverdue`/`overdueDays` in `jobStatus.js`, overdue badges + hero stat on `ArmadaJobs.jsx`, "Butuh Perhatian" surfacing on `ArmadaDashboard.jsx`. **Remaining, blocked on §9 sign-off:** outbound WA/push alerting | Phase A |
| **C — Delivery Command overview** ✅ shipped | New `/armada/ringkasan` screen — stat row, "Perlu Perhatian Sekarang" feed, driver workload, fleet status, on-time delivery rate (all sections in §6) | Phase B |
| **D — Exception/field-coordination live surface** ✅ done | 15s polling on `ArmadaRingkasan.jsx`, inline reschedule via reused `IssueRescheduleDrawer` (§7) | Phase C |
| **E — Customer comms re-activation** ❌ decided against, for now (Sep 2026) | Stays manual — sales keeps sending delivery-status WhatsApp messages by hand. §5's staged rollout is kept as the plan to use if this decision is revisited later, not as active scope | — |

---

## 9. Open questions — answer before extending Gap 1 to outbound alerting

1. **SLA thresholds.** How much buffer before `scheduledDate` counts as "at risk" vs. "breached"? Is the tolerance the same for pickup and delivery jobs?
2. **Who receives SLA breach alerts?** Dispatcher role only, or also Owner/Admin (Juri, Kemal)?
3. **Capacity-slot conversion table.** `Vehicle.capacitySlots` exists but nothing maps mattress size → slot count. This blocks making `onOptimize`/route capacity-checking real (called out as a known gap, not in the user's top-4 but adjacent to Gap 3's fleet-status section). Needs the actual conversion table from whoever runs logistics.

~~Customer-comms re-activation approval~~ — resolved (§5): stays manual, sales keeps sending delivery-status WhatsApp by hand. Not an open question anymore.

---

## 10. Route Planner — card identification & emergency edit (follow-up, shipped)

Requested directly against the live Route Planner after Phase D, not part of the original 4-gap scope — kept here for continuity rather than a separate document.

**1-2-3. Card identification.** `frontend/src/features/armada/components/JobBadges.jsx` gained `JobTypeBadge` (PICKUP filled-accent vs DELIVERY outline chip, plus a distinct icon each — never color alone, per this codebase's own `StatusBadge.jsx` accessibility rule), `RentalBadge` ("Sewa", `Order.category === "SEWA"`), `ServiceLabel` (first `OrderItem.layananName`), and `ConfirmedTimeBadge` (`Order.pickupConfirmedDate`/`deliveryConfirmedDate` — the real confirmed date, not the free-text estimate field). Wired into both `RouteCard.jsx` stops and `UnroutedJobsPanel.jsx` cards.

**Why no new color was added for these:** checked `tokens.css` directly and found `--color-chart-violet`/`--color-ai-violet` are both literally aliased to `var(--accent)` in production — this app has already, deliberately, collapsed every decorative hue down to one accent blue. Adding a genuinely new hue would break with that enforced pattern, not just a style guideline. Distinction is carried by icon + label + fill-vs-outline instead.

**4. Emergency edit of published routes.** Per your decision: routes stay locked by default after publishing (unchanged — "immutability = commitment to the driver"), but a dispatcher can now click "Edit" on a `PUBLISHED` route, is prompted for a mandatory reason (`window.prompt`, matching the existing `confirm()` pattern already used for Cancel/Delete rather than introducing a new modal for one text field), and the route unlocks exactly like Draft until "Selesai Edit." The reason is recorded on `Route.lastEditReason`/`lastEditedAt`/`lastEditedById` (new columns, migration `20260905180000_route_edit_after_publish`) and shown on the card so other dispatchers see a route was edited after publishing, not just the person who did it. Backend guards in `PATCH /routes/:id` and `PATCH /routes/:id/jobs` require the reason for `PUBLISHED` and re-cascade driver/helper/vehicle to member jobs on every edit (mirroring what `POST /routes/:id/publish` already does), so Route and Job assignment can't silently desync. `IN_PROGRESS`/`COMPLETED`/`CANCELLED` routes remain fully locked — this is for "plans changed," not for routes already underway or finished.

**5. Confirmed pickup/delivery time** — see point 1-2-3 above, `ConfirmedTimeBadge`.

---

## 11. What this document deliberately does not do

- It does not change any visual style, component library, or color system — per explicit instruction, this is IA and capability work only.
- It does not touch the Expo `mobile/` app — that's a separate Sales/CRM product with no armada surface today; extending it is a distinct decision, not assumed here.
- It does not attempt full VRP route optimization — consistent with PRD §1.5, that stays out of scope.
- It does not implement the full cross-portal PRD §1.4 "Command" vision — §6's "Delivery Command" is scoped to this workspace's own data only.