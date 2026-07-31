# SANSS — Sano Integrated Smart System
### Product Requirements Document v1.0
**Owner:** Sano · **Company:** Klinik Matras by SANO Care · **Date:** July 2026
**Status:** Requirement masih berlaku — SEBAGIAN sudah digantikan, lihat §0.0

---

## 0.0 ⚠️ SEBAGIAN DOKUMEN INI SUDAH DIGANTIKAN (31 Juli 2026)

Sistemnya sekarang bernama **Sano Hub**, bukan SANSS. Dokumen ini tetap jadi
sumber **requirement** (modul, FR, state machine, model inventory §8), tapi
bagian di bawah ini sudah tidak berlaku. Keputusan penggantinya ada di
`sano-hub/DECISIONS.md`.

| Bagian PRD | Status | Pengganti |
|---|---|---|
| §0.1 nama SANSS/SISS | ⛔ | **Sano Hub** (D-001) |
| §1.1, §9.1, §9.2, §11 — stack Next.js + Supabase + Vercel, project DB terpisah, "jangan sentuh CRM di v1" | ⛔ | Perluasan CRM yang sudah ada: React+Vite, Express, Prisma, Postgres self-hosted. Satu repo, satu database (D-001) |
| §5.1 daftar tahap routing | ⛔ tebakan | Urutan asli dari lantai produksi: `sano-hub/ROUTING.md` (D-003) |
| §6.1 status order sebagai state tunggal + "partial delivery configurable" | ⛔ | Pengiriman bertahap (Batch) wajib di v1; status order = rollup (D-006) |
| §7.4 revisi scope di Phase 4 | ⛔ | Naik ke Phase 1 — ditentukan di tahap Uji Fondasi (D-008) |
| §7.9 uang di Phase 4 | ⛔ | Pencatatan tunai driver naik ke v1 (D-011) |
| §9.3 RLS Postgres | ⛔ | Middleware otorisasi Express + tes (D-001, D-010) |
| §11 rencana fase | ⚠️ diurut ulang | `sano-hub/PHASE-0.md` |
| §14 pertanyaan terbuka | ✅ terjawab | Semua tujuh dijawab Gilang, 31 Juli 2026 — lihat DECISIONS |
| Sisanya (§2, §3, §5 selain 5.1, §7 selain 7.4/7.9, §8, §10, §12, §13) | ✅ berlaku | — |

Baca `sano-hub/CLAUDE.md` sebelum mengerjakan apa pun berdasarkan dokumen ini.

---

## 0. Flags before you read further

1. **Acronym mismatch.** "Sano Integrated Smart System" abbreviates to SISS, not SANSS. If you want SANSS, use **SANO Smart System** or **SANO Nervous System Suite**. Pick one now — it goes into the repo name, the subdomain, and every label in the UI. This doc uses **SANSS**. *(Terjawab: namanya **Sano Hub** — lihat §0.0.)*
2. **Your feature list is missing two things that will break the build if left out:** in-job scope/price revision (diagnosis changes after teardown) and money (DP at pickup, balance at delivery). Both are specified in this doc. See §7.4 and §7.9.

---

## 1. Critical decisions before a single line of code

These are the points where the brief as written will cost you money. Read this section before the specs.

### 1.1 Do not rebuild the CRM first
Your CRM and WhatsApp omnichannel already work. The thing that is actually broken is that once an order is confirmed, it disappears into WhatsApp groups, Excel files, and someone's head until a mattress shows up at a customer's door. **Build the operational spine first — order → pickup → production → delivery — and leave the CRM alone in v1.** Integrate with it; don't replace it. Replacing a working sales tool while simultaneously introducing a new production process doubles the change your team has to absorb and puts revenue at risk for zero gain.

### 1.2 The central object is the **Unit**, not the Order
This is the single most important modeling decision, and it's the one most people get wrong.

A customer orders "restorasi 2 kasur." That is one order, one address, one invoice — but **two physical objects** that get picked up, torn down, diagnosed separately, receive different foam, move through different production stages at different speeds, and might not finish on the same day.

If you model the job at the order level, you will be unable to answer "where is the king-size, and why is it three days behind the queen?" Every status field, every QR label, every production stage, every photo attaches to a **Unit**. The order is just the commercial wrapper.

### 1.3 Three portals ≠ three apps
Build **one Next.js application** with three role-scoped route groups and one shared data layer. Three separate codebases means three deploys, three auth systems, and three places to fix the same bug. "Different display per team" is a routing and permissions problem, not an architecture problem.

### 1.4 You need a fourth portal
Three portals means nobody sees across them. You, Mas Juri, and Kemal need a **Command** view: units at risk, WIP by stage, turnaround time, capacity vs. incoming orders, cash position per job. Without it you've rebuilt the same silos in nicer software.

### 1.5 Do not build route optimization in v1
Automatic VRP solving (Google Route Optimization, Mapbox Optimization v2, self-hosted VROOM) is a v3 feature. In v1, your dispatcher drags stops into an order on a list, the system computes total distance/ETA, and the driver gets a Google Maps deep link. Jabodetabek traffic makes algorithmic optimization far less valuable than a dispatcher who knows that Bekasi in the afternoon is a mistake. Build the manual tool first, collect six months of actual travel-time data, then automate against real numbers.

### 1.6 Workers must not type
Production floor input is a QR scan and a tap. Every unit gets a printed QR label at intake. Scan → confirm stage → optional photo → done. If advancing a stage takes more than five seconds, adoption dies in week two and you're back to WhatsApp.

---

## 2. Product overview

### 2.1 Problem
Klinik Matras runs a reverse-logistics service business: the product leaves the customer's home, is rebuilt in a workshop, and returns. Today, that chain is tracked across a CRM, WhatsApp, Excel production forms, and verbal handoffs. Consequences:

- No one can state a unit's location and stage without asking someone.
- Turnaround time is not measured, so it cannot be improved or promised.
- Foam stock is discovered to be short at cutting time, not at order time.
- Delivery routes are planned by memory each morning.
- Post-teardown price revisions are negotiated over WhatsApp and lost.
- Chain of custody for customer property is undocumented — a real liability.

### 2.2 Vision
One system where a mattress can be located, priced, photographed, and accounted for at every second between pickup and delivery, and where each team sees only the screen they need.

### 2.3 Scope of v1
**In:** order intake, unit tracking, QR-based production routing, foam/material inventory with a movement ledger, pickup and delivery scheduling, driver mobile app, proof of service, scope revision, payment recording, command dashboard.

**Out (v1):** replacing the CRM, replacing the WhatsApp omnichannel inbox, automated route optimization, customer self-service portal, full accounting, payroll, B2B contract management.

### 2.4 Success criteria (measure at day 90)
| Metric | Baseline | Target |
|---|---|---|
| Median turnaround (pickup → delivery) | unknown — establish in week 1 | −20% vs. baseline |
| Units with complete stage history | ~0% | ≥95% |
| Orders with before/after photos on file | ad hoc | 100% |
| Stock-out discovered at cutting stage | unknown | ≤2% of jobs |
| On-time delivery vs. promised date | unknown | ≥90% |
| "Where is my mattress?" inbound messages | high | −50% |

---

## 3. Users and roles

| Role | Portal | Device | Core need |
|---|---|---|---|
| Owner / Management | Command | Desktop | Cross-cutting visibility, cost, capacity |
| Sales / CS | Growth | Desktop | Create orders, quote, revise scope, answer status |
| Dispatcher / Admin Ops | Logistics | Desktop | Schedule pickups/deliveries, assign drivers, build routes |
| Driver | Logistics (mobile) | Phone PWA | Today's stops, navigation, photos, signature, cash |
| Production Lead | Workshop | Desktop/tablet | Assign work, see queue per stage, resolve blocks |
| Production Worker | Workshop (kiosk) | Tablet + QR scanner | Scan unit, advance stage, flag problem |
| Warehouse / Inventory | Workshop | Desktop | Receive materials, issue to job, count stock |
| Finance | Command | Desktop | Payments received, outstanding balance, material cost |

**Rule:** one person can hold multiple roles. Permissions are additive. Do not create "super admin does everything" as a default — it destroys the audit trail that makes this system worth building.

---

## 4. Portal structure

Landing page after login shows only the portals the user has roles for. Single role → skip the chooser and go straight in.

### Portal naming — recommendation

| Your name | Recommended | Rationale |
|---|---|---|
| CRM & Omnichannel | **Growth** (Pertumbuhan) | Covers leads, quotes, orders, after-sales — not just CRM |
| Production & Inventory | **Workshop** (Bengkel) | Matches how the team already talks; "bengkel matras" is on-brand and covers production + materials + QC in one word |
| Pickup & Delivery | **Logistics** (Armada) | "Armada" reads better in Indonesian and covers vehicles, drivers, and routes |
| — | **Command** (Kendali) | New. Cross-portal oversight. |

If you want one consistent language, go Indonesian: **Growth / Bengkel / Armada / Kendali**. Mixing English portal names with an Indonesian-speaking floor team creates friction for zero benefit. Recommend Indonesian labels, English code.

---

## 5. Domain model

### 5.1 Core entities

```
Customer
  id, name, phone (E.164, unique), email, type (B2C|B2B), company_id?,
  source, notes, created_at

Address
  id, customer_id, label, full_text, lat, lng, geo_verified_at,
  access_notes (gang sempit, lantai 3, no lift), preferred_time_window
  → CRITICAL: Indonesian addresses are unreliable. Capture the GPS pin on
    first driver visit and reuse it forever. This alone kills most repeat-
    visit failures.

Order
  id, order_no (human: KM-2607-0142), customer_id, address_id,
  status (see §6.1), service_type, promised_delivery_date,
  quoted_total, approved_total, created_by, created_at

Unit                          ← the heart of the system
  id, unit_code (QR: KM-2607-0142-U1), order_id,
  mattress_type, brand, size (single|super_single|queen|king|custom),
  dimensions_cm (w × l × h), body_weight_target_kg,
  spec_json (foundation + comfort layer recipe),
  routing_template_id, current_stage_id, status (see §6.2),
  intake_photos[], teardown_photos[], finished_photos[],
  received_at, completed_at, storage_location

DiagnosisReport
  id, unit_id, stage (survey|teardown), findings_json,
  spring_condition, foam_condition, cover_condition, contamination,
  photos[], recommendation, created_by, created_at

RoutingTemplate  /  RoutingStage
  Configurable per service_type. NOT hardcoded.
  e.g. "Restorasi Full" = bongkar → diagnosa → perbaikan per → potong busa
       → layering → quilting cover → jahit list/sudut → assembly → finishing
       → QC → packing
  Each stage: name, sequence, is_optional, expected_duration_minutes,
              required_role, requires_photo, requires_qc

UnitStageLog                  ← append-only, never updated
  id, unit_id, stage_id, action (start|pause|complete|fail|skip),
  actor_id, started_at, ended_at, duration_seconds, photos[],
  note, block_reason

Material
  id, sku, name, category (foam|fabric|spring|thread|accessory|packaging),
  density (D50, D44...), uom (sheet|meter|kg|pcs|m3),
  dimensions, unit_cost, reorder_point, reorder_qty, supplier_id

StockMovement                 ← append-only ledger. See §8.
  id, material_id, qty_delta, uom, type, ref_type, ref_id,
  location_id, actor_id, unit_cost_at_time, created_at

MaterialReservation
  id, order_id, unit_id, material_id, qty, status (held|issued|released)

Job (Pickup | Delivery)
  id, type, order_id, unit_ids[], address_id, scheduled_date,
  time_window, route_id, sequence_no, vehicle_id, driver_id,
  status (see §6.3), capacity_slots,
  arrived_at, completed_at, gps_at_completion,
  proof_photos[], signature_url, cod_amount_collected

Route
  id, date, vehicle_id, driver_id, stops[] (ordered Jobs),
  planned_distance_km, planned_duration_min, status

Vehicle
  id, plate, type, capacity_slots (by mattress size), active

Payment
  id, order_id, amount, method (transfer|cash|edc|qris),
  type (dp|pelunasan|refund), collected_by, proof_url, verified_by

ScopeRevision                 ← see §7.4
  id, order_id, unit_id, reason, delta_amount, before_spec, after_spec,
  status (pending|approved|rejected), approved_via, approved_at, evidence_url
```

### 5.2 Relationship notes
- One Order → many Units. One Unit → one Order.
- One Pickup Job can carry Units from **one** order only in v1. (Multi-order consolidation is a v2 optimization; it complicates chain of custody.)
- One Route → many Jobs, ordered. One Job → one Route.
- Stock is *never* a column. Stock = `SUM(qty_delta)` over StockMovement. See §8.1.

---

## 6. State machines

Define these explicitly and enforce transitions server-side. Illegal transitions must be rejected, not just hidden in the UI.

### 6.1 Order status
```
DRAFT → SURVEY_SCHEDULED → QUOTED → CONFIRMED → PICKUP_SCHEDULED
      → IN_TRANSIT_IN → RECEIVED → IN_PRODUCTION → READY_FOR_DELIVERY
      → DELIVERY_SCHEDULED → IN_TRANSIT_OUT → DELIVERED → CLOSED

Side exits (from most states): CANCELLED, ON_HOLD
Order status is DERIVED from its Units, not set manually:
  - IN_PRODUCTION while any unit is in production
  - READY_FOR_DELIVERY only when ALL units pass QC
  (Configurable: allow partial delivery for multi-unit orders — flag per order)
```

### 6.2 Unit status
```
AWAITING_PICKUP → IN_TRANSIT_IN → RECEIVED → IN_PRODUCTION
                → QC_PENDING → QC_PASSED → READY_FOR_DELIVERY
                → IN_TRANSIT_OUT → DELIVERED

QC_FAILED → back to a named rework stage (logged as rework, counts against
            the rework-rate metric — do not let rework be invisible)
BLOCKED   → any stage can be blocked with a reason
            (material_shortage | awaiting_customer_approval | machine_down
             | quality_issue | other). Blocked time is tracked separately
             from work time or your cycle-time data is worthless.
```

**Stage progression within IN_PRODUCTION** is driven by the unit's RoutingTemplate, not by this enum. A unit is at `stage_id = 4 (jahit list/sudut)` inside status `IN_PRODUCTION`.

### 6.3 Job (pickup/delivery) status
```
UNSCHEDULED → SCHEDULED → ASSIGNED → EN_ROUTE → ARRIVED
            → COMPLETED
Exceptions: FAILED (customer absent | access denied | refused | damaged)
            → RESCHEDULED
```
Every failure requires a reason code and a photo. No exceptions — this is how you find the address quality problems.

---

## 7. Functional requirements by module

### 7.1 Growth — Order intake (FR-G)

| ID | Requirement | Priority |
|---|---|---|
| FR-G-01 | Create order from existing customer or new customer; phone number is the unique key and is checked for duplicates on entry | Must |
| FR-G-02 | Add N units to an order, each with size, brand, current condition, target body weight, and photo upload | Must |
| FR-G-03 | Spec builder: select foundation layer + comfort layer from the SANO catalogue (Rebonded D50+, HR D44+, Natural Latex), constrained by body weight; system suggests a recipe, sales can override with a logged reason | Must |
| FR-G-04 | Live quote calculation: labour + materials + transport surcharge by district | Must |
| FR-G-05 | On order confirmation, system **reserves** required materials and flags shortage immediately, before a pickup is promised | Must |
| FR-G-06 | Promised delivery date is proposed by the system from current WIP and stage capacity, and can be overridden with a logged reason | Should |
| FR-G-07 | Survey mode: schedule a survey visit that produces a DiagnosisReport, which converts to a quote | Should |
| FR-G-08 | Order timeline view showing every event across all portals, readable by CS without leaving the screen | Must |
| FR-G-09 | Generate a shareable customer status link (read-only, tokenised, no login) | Should |

### 7.2 Logistics — Scheduling & routing (FR-L)

| ID | Requirement | Priority |
|---|---|---|
| FR-L-01 | Dispatch board: unscheduled jobs on the left, days/vehicles as columns, drag to schedule | Must |
| FR-L-02 | Capacity check by vehicle: mattress sizes consume different slot counts; the board blocks overloading | Must |
| FR-L-03 | Route builder: pick a date + vehicle, drag stops into sequence, see total distance and estimated duration | Must |
| FR-L-04 | Export route to driver; driver gets a per-stop "Navigate" deep link to Google Maps | Must |
| FR-L-05 | Time-window respect: warn if a stop is sequenced outside the customer's stated window | Should |
| FR-L-06 | Live map of driver positions during active routes (position ping every 2 min while route is active, only while active) | Should |
| FR-L-07 | Automated VRP sequencing suggestion | Could (v3) |

### 7.3 Logistics — Driver app (FR-D)
Mobile-first PWA. Assume patchy signal in the field.

| ID | Requirement | Priority |
|---|---|---|
| FR-D-01 | Today's route as an ordered list; one stop expanded at a time | Must |
| FR-D-02 | Per stop: customer name, phone (tap to call/WA), address, notes, unit list, amount to collect | Must |
| FR-D-03 | Pickup flow: arrive → scan/generate unit QR → photo condition from 4 angles → customer signs on screen → collect DP → complete | Must |
| FR-D-04 | Delivery flow: arrive → scan unit QR (validates the right mattress is at the right house) → placement photo → signature → collect balance → complete | Must |
| FR-D-05 | Offline queue: all stop completions cached locally and synced when signal returns; UI must show sync state honestly | Must |
| FR-D-06 | Photos compressed client-side to ≤300KB before upload | Must |
| FR-D-07 | Failure flow: reason code + photo + auto-notify dispatcher | Must |
| FR-D-08 | Cash collected today, running total, end-of-day handover confirmation | Must |

**QR validation at delivery (FR-D-04) is not optional.** Delivering the wrong restored mattress to the wrong house is the highest-embarrassment failure mode in this business and it is trivially preventable.

### 7.4 The scope revision flow (FR-R) — do not skip this
The most common real-world event in mattress restoration: the mattress is torn down, the actual condition is worse than the survey suggested, and the price must change.

| ID | Requirement | Priority |
|---|---|---|
| FR-R-01 | At the diagnosis stage, production can raise a ScopeRevision with findings, photos, revised spec, and price delta | Must |
| FR-R-02 | Unit auto-enters `BLOCKED: awaiting_customer_approval`; blocked clock starts | Must |
| FR-R-03 | Revision generates a customer-facing summary (photos + old vs. new + delta) that CS sends via WhatsApp | Must |
| FR-R-04 | CS records the outcome — approved, rejected, or partial — with evidence (WA screenshot or link click) | Must |
| FR-R-05 | On approval: order total updates, new materials reserve, unit unblocks. On rejection: unit routes to a defined fallback spec or to "return as-is" | Must |
| FR-R-06 | Revision rate and average approval time are reported metrics — a high revision rate means your survey process is wrong | Should |

Without this flow, your order totals will silently diverge from what you actually charge, and the production floor will be blocked on WhatsApp threads no one can find.

### 7.5 Workshop — Production floor (FR-P)

| ID | Requirement | Priority |
|---|---|---|
| FR-P-01 | Intake: scan incoming unit, confirm against expected pickup manifest, assign storage location, print QR label | Must |
| FR-P-02 | Kiosk mode: scan unit QR → shows current stage → tap Start / Complete / Block | Must |
| FR-P-03 | Stage completion captures actor, timestamp, duration; photo required on stages configured as `requires_photo` (minimum: teardown, layering, finishing) | Must |
| FR-P-04 | Kanban board per routing stage showing WIP, with per-stage WIP limits and visual overflow warning | Must |
| FR-P-05 | Production Lead can reassign a unit's routing template or skip an optional stage with a logged reason | Must |
| FR-P-06 | Block a unit with a reason code; blocks appear on the Lead's board and the Command dashboard immediately | Must |
| FR-P-07 | QC gate: checklist per service type, pass/fail, fail routes to a named rework stage with rework counter | Must |
| FR-P-08 | Material issue at cutting stage: scan unit + scan material → deducts stock, records actual vs. planned consumption | Must |
| FR-P-09 | Worker view of "my units today" and simple output count | Should |
| FR-P-10 | Capacity view: units per stage vs. daily throughput capacity, projecting whether promised dates are achievable | Should |

**Photo discipline is the product.** Before/after evidence at teardown and finishing is simultaneously your QC record, your dispute defence, your warranty baseline, and your best marketing content. Make it a hard requirement at those two stages, optional elsewhere.

### 7.6 Workshop — Inventory (FR-I)
See §8 for the model. Requirements:

| ID | Requirement | Priority |
|---|---|---|
| FR-I-01 | Goods receipt against a purchase order; records qty, unit cost, supplier, batch | Must |
| FR-I-02 | Current stock per material per location, computed from the movement ledger | Must |
| FR-I-03 | Reservation vs. available-to-promise: available = on-hand − reserved | Must |
| FR-I-04 | Foam partial-sheet consumption with remnant tracking (see §8.2) | Must |
| FR-I-05 | Reorder point alerts with suggested order qty, surfaced in Command | Must |
| FR-I-06 | Stock opname (cycle count) mode: count by location, system records variance as an ADJUSTMENT movement with mandatory reason | Must |
| FR-I-07 | Material cost roll-up per unit and per order, using cost at time of issue | Should |
| FR-I-08 | Yield report: planned vs. actual foam consumption, waste %, by worker and by size | Should |

### 7.7 Command (FR-C)

| ID | Requirement | Priority |
|---|---|---|
| FR-C-01 | Live board: units by status, units blocked, units at risk of missing promised date | Must |
| FR-C-02 | Turnaround time distribution, by service type and by month | Must |
| FR-C-03 | Stage cycle-time breakdown — where units actually wait | Must |
| FR-C-04 | On-time delivery rate; failed-visit reasons ranked | Must |
| FR-C-05 | Material consumption and cost per order; gross margin per order | Should |
| FR-C-06 | Driver productivity: stops/day, distance/stop, failed-visit rate | Should |
| FR-C-07 | Rework rate and revision rate by stage and by worker | Should |

### 7.8 Cross-cutting: notifications (FR-N)
Automated WhatsApp template messages at four moments only. More than four and customers mute you.

| Trigger | Message |
|---|---|
| Pickup scheduled | Date, time window, driver name, status link |
| Unit received at workshop | "Your mattress arrived safely," teardown photo, estimated completion |
| Ready for delivery | Proposed delivery slot, request confirmation |
| Delivered | Thank you, warranty terms, care instructions, review request |

Scope revision (§7.4) is sent manually by CS, not automatically. It requires a human.

### 7.9 Cross-cutting: money (FR-M)

| ID | Requirement | Priority |
|---|---|---|
| FR-M-01 | Record DP at order confirmation or at pickup, with method and proof | Must |
| FR-M-02 | Outstanding balance visible on the driver's delivery stop | Must |
| FR-M-03 | Driver records collection (cash/transfer/QRIS) with proof photo | Must |
| FR-M-04 | Daily cash reconciliation: collected vs. handed over, per driver | Must |
| FR-M-05 | Finance verification step; unverified collections flagged after 24h | Should |
| FR-M-06 | Order cannot be CLOSED with an outstanding balance unless explicitly waived by an authorised role | Should |

---

## 8. Inventory model — the part that must be right

### 8.1 Stock is a ledger, not a number
Never store `current_qty` as a mutable column. Store append-only `StockMovement` rows and derive stock.

```
Movement types:
  RECEIPT       +qty   goods in from supplier
  RESERVE        0     no qty change; creates a MaterialReservation hold
  ISSUE         −qty   consumed into a specific unit_id
  RETURN        +qty   unused material back to store
  WASTE         −qty   scrap, with reason
  ADJUSTMENT    ±qty   stock opname variance, mandatory reason + approver
  TRANSFER      ±qty   between locations, as a paired movement
```

Why this matters: when the physical count doesn't match the system — and it will not match — a ledger lets you find the exact movement where reality diverged. A mutable number tells you only that you are wrong. This costs nothing extra to build now and is effectively impossible to retrofit later.

For performance, maintain a `stock_balance` materialised view refreshed on write. Read from the view, write only to the ledger.

### 8.2 Foam is the hard case
Foam arrives as sheets (e.g. 200×180×5 cm, D50) and is cut to unit dimensions. A single sheet serves multiple jobs, leaving remnants.

**Model foam in two dimensions simultaneously:** `sheet_count` (for procurement and physical counting) and `volume_m3` (for consumption and costing).

```
Sheet inventory:  FOAM-RB-D50-200x180x5  →  12 sheets  →  2.16 m³
Issue to unit:    cut 190×160×5 = 0.152 m³ from sheet #7
Result:           sheet #7 becomes a REMNANT record (0.028 m³ usable)
                  ISSUE movement of −0.152 m³ against unit KM-2607-0142-U1
```

Remnants are a separate location (`REMNANT-BIN`) that the cutting stage checks first. Track **yield %** = issued volume ÷ (issued + waste) volume. Yield is the single most improvable cost line in a foam business and you currently cannot see it at all.

### 8.3 Bill of Materials
Each spec recipe expands to a BoM at order confirmation:

```
Spec: "HR D44 comfort 5cm + Rebonded D50 foundation 10cm, Queen 160×200"
BoM:
  FOAM-HR-D44-5cm    0.160 m³   (160×200×5 + 3% cutting allowance)
  FOAM-RB-D50-10cm   0.320 m³
  FABRIC-KNIT-QUILT  4.8 m
  THREAD-POLY-40     1 spool (0.05 consumed)
  ZIPPER-HD-180      1 pcs
  PLASTIC-WRAP       6 m
```

Cutting allowance is a per-material configurable percentage, not a hardcoded number. Planned vs. actual variance per BoM line is the input to the yield report.

---

## 9. Technical architecture

### 9.1 Stack — reuse what you already run
You already run Next.js + TypeScript + Tailwind + shadcn/ui + Supabase on Vercel for SANO Studio. Use the same stack. Do not introduce a new one for this.

```
Frontend      Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui
State         TanStack Query + Supabase Realtime subscriptions
Backend       Supabase (Postgres, Auth, Storage, Realtime, Edge Functions)
Auth          Supabase Auth, phone OTP for drivers, email for office
Files         Supabase Storage, image transform on upload
Realtime      Postgres changes → Realtime channels (Kanban, dispatch board)
Jobs          Supabase Cron for nightly rollups, SLA checks, reorder alerts
Maps          Google Maps JS API (display) + Directions API (distance/ETA)
              Deep links for driver navigation. No optimization API in v1.
QR            Client-side generation; Zebra/Brother thermal label printer at intake
WhatsApp      Meta WhatsApp Cloud API for templates; existing omnichannel
              tool remains the agent inbox
Hosting       Vercel · app.sanomatrassehat.com (or sanss.sanomatrassehat.com)
Monorepo      One repo, route groups: (growth) (bengkel) (armada) (kendali)
```

### 9.2 Separate Supabase project from SANO Studio
Different data domain, different users, different security posture. Two projects, and later a shared identity layer if you need SSO. Do not co-locate operational customer data with the content pipeline.

### 9.3 Security model
- **RLS on every table.** No exceptions. Default deny.
- Drivers can read only Jobs assigned to them, only for today ±1 day.
- Production workers can read Units currently in the workshop; no customer phone numbers, no pricing.
- Customer PII (phone, full address) is readable only by Growth, Logistics, and Command roles.
- All money-related tables require an explicit finance or owner role to write.
- `UnitStageLog`, `StockMovement`, and `Payment` are insert-only for all roles. Corrections are new compensating rows, never edits.
- Full audit trail: actor, timestamp, IP, before/after on every mutable table.
- Photo storage is private-bucket with signed URLs; customer status links are tokenised and expiring.

### 9.4 Offline strategy
Only the driver app needs offline. Use IndexedDB for a route snapshot + an outbox queue of completions. Sync on reconnect with idempotency keys so a double-sync can't duplicate a collection record. The production floor is on workshop wifi and does not need offline; if the wifi is unreliable, fix the wifi — it is cheaper than building offline sync twice.

### 9.5 Performance targets
- Dispatch board and Kanban render < 1.5s on desktop.
- Driver app first contentful paint < 2s on 3G.
- QR scan → stage screen < 1s.
- Realtime stage update propagates to other screens < 2s.

---

## 10. Integrations

| System | Direction | v1 approach |
|---|---|---|
| Existing CRM | Bi-directional | SANSS is the source of truth for orders; sync customer + order status back to CRM via API or nightly job. If the CRM has no API, migrate customers into SANSS and retire the CRM in v2. **Audit this before committing to a plan.** |
| WhatsApp omnichannel | Outbound | Keep the existing inbox for conversations. SANSS sends the four automated templates via WhatsApp Cloud API. Deep-link from an order to the customer's chat thread. |
| Google Maps | Outbound | Geocoding, distance matrix, navigation deep links |
| Accounting | Manual v1 | CSV export of payments and material costs |
| Excel operational forms | One-way | Migrate historical production and customer data at cutover, then retire. Do not run both in parallel for more than two weeks. |

---

## 11. Delivery roadmap

Sequenced so that each phase is independently usable. Do not build phases in parallel with a small team.

**Phase 0 — Foundation (3 weeks)**
Schema, RLS, auth, roles, master data (materials, routing templates, vehicles, service types), customer + address migration from Excel. Deliverable: nothing user-facing. Resist the pressure to skip this.

**Phase 1 — The spine (5 weeks)**
Order intake → unit creation → pickup job → intake scan → production stage tracking → QC → delivery job → proof of delivery. Manual scheduling, no route builder, no inventory. Deliverable: one order tracked end-to-end in software. **This is the phase that proves the concept. Run 20 real orders through it before building anything else.**

**Phase 2 — Driver app + dispatch board (4 weeks)**
PWA, offline queue, photos, signature, cash collection, dispatch board with capacity, route sequencing with distance/ETA.

**Phase 3 — Inventory (4 weeks)**
Movement ledger, BoM expansion, reservations, foam remnant handling, goods receipt, stock opname, reorder alerts, yield reporting.

**Phase 4 — Scope revision + money + notifications (3 weeks)**
Revision flow with customer approval, payment recording, cash reconciliation, the four WhatsApp templates, customer status link.

**Phase 5 — Command (3 weeks)**
Dashboards, TAT, cycle time, margin per order, driver productivity, rework/revision rates.

**Phase 6 — CRM absorption (scope after Phase 5)**
Only after the operational spine is stable and trusted. Decide then whether to absorb the CRM or keep integrating.

**Total to a complete v1: ~22 weeks.** If that is too long, cut Phase 5 and Phase 3's yield reporting. Do not cut Phase 0.

---

## 12. Rollout

1. **Parallel run is a trap.** Running Excel and SANSS side by side for months guarantees both are half-maintained. Cap it at two weeks.
2. **Cut over one service type first** — the highest-volume, most standardised one. Prove the routing template works before adding custom jobs.
3. **Appoint a floor champion.** One production person who knows the system well enough to fix confusion without escalating. Without this, adoption depends on you being physically present, which does not scale.
4. **Print labels the day before go-live.** Label stock, printer ribbon, and a spare scanner are the boring things that delay launches.
5. **Week-one rule: no feature requests.** Log everything, build nothing, for the first two weeks. Most week-one complaints are training issues that disappear.

---

## 13. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Floor team doesn't scan; status data goes stale | System becomes decorative — total loss | Sub-5-second scan flow; make the QR label the physical job ticket so work cannot proceed without it; Lead reviews unscanned units daily |
| Existing CRM has no usable API | Phase 1 integration blocked | Audit this in week 1, before Phase 0 finishes. Fallback: migrate and retire. |
| Workshop wifi unreliable | Stage logging fails | Site survey before Phase 1; mesh AP is a cheap fix |
| Address/GPS data quality | Failed visits, wasted fuel | Force GPS pin capture on first successful visit; failed visits require a reason code so the pattern surfaces |
| Foam remnant tracking ignored in practice | Yield data is fiction | Make remnant bin the first place cutting checks; audit variance weekly for the first month |
| Photo storage cost growth | Unbudgeted spend | Client-side compression to 300KB; lifecycle policy moving photos >12 months to cold storage |
| Scope creep from "while we're at it" | Timeline doubles | This PRD is the scope. Changes go to a v2 backlog, not into the current phase. |
| Single-person dependency (you) | Bus factor of 1 | Document routing templates and BoM recipes as data, not as tribal knowledge — which this design already forces |

---

## 14. Open questions — answer before Phase 0

1. What is the current CRM, and does it have an API? This determines the entire integration strategy.
2. How many units per month, and how many drivers/vehicles? Capacity assumptions in §7.2 depend on it.
3. What is the actual production stage list, in the words the floor team uses? The routing template in §5.1 is my guess and needs correcting by whoever runs the workshop.
4. Do you ever hold customer mattresses beyond the promised date because of foam shortage? If yes, reservations (FR-G-05) become a Phase 1 requirement, not Phase 3.
5. Do drivers currently collect payment? If yes, FR-M moves earlier.
6. Multi-unit orders: can you deliver units partially, or must all units finish together? This changes the order-status derivation logic in §6.1.
7. B2B (hotels, kos, properti) — different flow, contract pricing, bulk pickup? If this is more than 10% of revenue it needs its own section before build.

---

## 15. What this document deliberately does not do

- It does not specify UI screens. Design comes after the domain model is agreed; designing screens first locks in a wrong model.
- It does not choose an ORM, testing framework, or CI setup. Those are build-time decisions.
- It does not price the build. That follows from the phase plan and whoever is building it.

**Next step:** answer §14, correct the routing template in §5.1 with the real stage names, then lock Phase 0 scope.
