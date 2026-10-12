# Milestone global "Diterima di Workshop" — audit dampak + desain

Status: fase 1 (read-model + Produksi + Unit 360) diimplementasikan di branch `feat/milestone-diterima-workshop`. Fase 2 (Sales/Delivery/Finance/laporan/mobile/MCP) = audit di bawah, BELUM diubah.
Prinsip yang dijaga: **tidak ada enum/status tersimpan yang diubah, tidak ada histori lama yang ditulis ulang, tidak ada bukti kedatangan yang dibuat.** Semua milestone adalah TURUNAN (read-model) dari fakta yang sudah tercatat.

## 1. Kontrak kosakata (satu sumber: `backend/src/lib/domain/workshopMilestone.js`, cermin frontend `features/production/globalStatus.js`)

| Status global | Bukti yang diwajibkan | Sumber fakta |
|---|---|---|
| **Pengambilan** | unit belum terbukti diterima workshop: pickup sedang berlangsung (`AWAITING_PICKUP`, `IN_TRANSIT_IN`) ATAU pickup selesai tetapi belum ada bukti terima | status unit + tidak adanya bukti terima |
| **Diterima di Workshop** | petugas menekan "Terima Unit di Workshop": custody INBOUND `ACCEPTED` (`acceptUnitCustody`), atau konfirmasi tiba tanpa custody (`confirmUnitArrival`, fase INTAKE `reason` baku), atau unit lahir di workshop (`registerWorkshopBornRun`, `origin=WORKSHOP_BORN`) — DAN pekerjaan produksi belum dimulai | `unit_custody_handoffs_v2`, `production_phase_runs_v2`, `production_runs_v2.origin` |
| **Diproses** | pekerjaan produksi pertama benar-benar dimulai: ada operasi V2 non-SKIPPED, bukti langkah V2 non-lewati, atau log tahap V1 | `production_operation_runs_v2`, `production_step_evidence_v2`, `unit_stage_logs` |
| **Siap Kirim** | `READY_FOR_DELIVERY` / `READY_ON_CUSTOMER_HOLD` (gerbang sistem: produksi selesai → retur sisa → Gudang menerima barang jadi); histori lama dipertahankan | status unit tersimpan |
| **Dalam Pengiriman** | `IN_TRANSIT_OUT` (delivery ke customer sudah dimulai) | status unit tersimpan |
| **Terkirim** | `DELIVERED` (POD selesai) | status unit tersimpan |
| Dibatalkan | `CANCELLED` | status unit tersimpan |

Dua keadaan tampilan khusus, **bukan tebakan**:
- unit `RECEIVED`/`IN_PRODUCTION` tanpa bukti terima & belum dimulai → tetap **Pengambilan**, detail "Pickup selesai — menunggu Terima Unit di Workshop" (ada pickup selesai) atau "Konfirmasi workshop belum tercatat" (tidak ada catatan pickup: histori lama/pesanan BARU belum didaftarkan);
- unit yang SUDAH dimulai tanpa bukti terima (histori V1 lama) → **Diproses**, keberadaan fisik tetap "Konfirmasi workshop belum tercatat" (tidak diberi bukti palsu).

## 2. Empat sumbu read-model (dipisah, tidak digabung jadi satu badge)
1. **Status global** (`globalStatus`): tabel di atas.
2. **Keberadaan fisik/custody** (`presence`): sudah ada; ditambah `receivedBasis` (`CUSTODY` | `STAFF_CONFIRMED` | `BORN_IN_WORKSHOP` | `null`).
3. **Tahap produksi rinci** (`next`/`bucket`/langkah 1–12): tidak berubah artinya.
4. **Status jadwal** (`scheduleStatus`): `BELUM_DIJADWALKAN` · `SUDAH_DIJADWALKAN` · `MENUNGGU_BAHAN` · `SIAP_DIKERJAKAN`. "Sudah dijadwalkan" TIDAK berarti Diproses.

## 3. Audit dampak

### 3.1 Enum / status tersimpan — TIDAK diubah
- `UnitStatus`: `AWAITING_PICKUP, IN_TRANSIT_IN, RECEIVED, IN_PRODUCTION, READY_FOR_DELIVERY, READY_ON_CUSTOMER_HOLD, IN_TRANSIT_OUT, DELIVERED, CANCELLED`. `RECEIVED` **diset saat pickup selesai** (`routes/armada.js` ± baris 5529), bukan saat workshop menerima — inilah akar kerancuan "Diproses". Tidak diubah (histori + otomasi bergantung padanya).
- `Order.status`: `PENDING, PICKUP, PROCESSING, READY, SHIPPING, DELIVERED, CANCELLED(+SEWA_*)`. `orderStatusSync` memetakan `RECEIVED/IN_PRODUCTION → PROCESSING`. Tidak diubah.
- Migrasi: **tidak ada**. Tidak ada kolom/enum baru.

### 3.2 Filter
| Lokasi | Perilaku lama | Dampak / tindakan |
|---|---|---|
| `GET /production-v2/backlog?status=` (`productionBacklog.js`) | `DIPROSES` = unit `RECEIVED/IN_PRODUCTION`; `PENGAMBILAN` = `AWAITING_PICKUP/IN_TRANSIT_IN` | **Diubah (fase 1)**: `PENGAMBILAN` | `DITERIMA_WORKSHOP` | `DIPROSES` berbasis bukti. Kelayakan Rencana (`classifyRencanaUnit`) TIDAK diubah: unit "pickup selesai belum diterima" tetap bisa dijadwalkan (Run `PENDING_ARRIVAL`) dan muncul di tab Pengambilan dengan detail jelas. |
| `GET /production/work-orders?displayStatus=` (Order Produksi, `v1Source`) | peta statis `DISPLAY_STATUS_UNIT_FILTER` | **Diubah (fase 1)**: kunci baru + hitungan per status global dari bukti. |
| `Orders.jsx` (Sales) bucket "Diproses" = `PENDING+PICKUP+PROCESSING` | label/sentinel Sales | **Fase 2** — butuh status global tingkat ORDER (agregasi unit) + keputusan bucket; tidak disentuh sekarang. |
| `pipeline.js` papan order `ORDER_BOARD_STATUSES` | kolom per `Order.status` | Fase 2. |
| `auth.js` hitungan `IN_PRODUCTION` | angka dashboard | Tidak berubah (mengukur status tersimpan); dicatat. |
| `ONBOARD_UNIT_STATUSES`, `EXECUTING_UNIT_STATUSES`, `BORN_UNIT_STATUSES` | gerbang command | **Tidak boleh berubah** (memakai status tersimpan, bukan label). |

### 3.3 KPI / laporan
- `productionMetrics`, `productionReportingService`, ringkasan Produksi: menghitung dari Run/operasi/handoff (bukan label "Diproses") — **tidak berubah**; angka tetap.
- Hitungan "Diproses" di tab Order Produksi dan Rencana **berubah makna** (hanya unit yang sudah dimulai) — ini perubahan yang DISENGAJA; unit lama pindah ke "Pengambilan — konfirmasi workshop belum tercatat" tanpa menulis data.
- `RingkasanTab` (laporan Sales/CRM), `laporan` lain yang menjumlah `Order.status`: fase 2.

### 3.4 Notifikasi / otomasi
- `leaderRecapJob` (pengingat order `PROCESSING` per Sales), `morningPriority` (hanya order `PROCESSING`), `notifyReadyForDelivery` (READY) — memakai status tersimpan; **tidak berubah**. Label di pesan/WA yang menyebut "Diproses" belum diubah (fase 2, perlu tinjauan teks per template).

### 3.5 Integrasi antar-workspace
- Gudang: `acceptUnitCustody` / "Terima Unit" (WarehouseUnitCustody) = sumber bukti terima; tombol Produksi "Unit Tiba di Workshop" memakai command custody yang sama → label diseragamkan "Terima Unit di Workshop".
- Delivery/driver (`armada`): menyelesaikan pickup tetap menulis `RECEIVED`; tidak diubah.
- MCP/ChatGPT (`mcp/toolsShared.js` `ORDER_STATUS`), `mobile/` (`OrdersScreen`, `utils/format`): memakai enum tersimpan + label sendiri → fase 2 (konsumsi `globalStatus` dari API bila tersedia).

## 4. Fase 1 — yang berubah (diimplementasikan)
**Backend** (read-model; tanpa migrasi, tanpa tulis data):
- `lib/domain/workshopMilestone.js` (murni) — status global, dasar bukti, status jadwal, rakitan `milestoneOf`.
- `services/workshopMilestoneEvidence.js` — pemuat bukti BATCH (tanpa N+1) + fragmen `where` yang sama untuk filter dan hitungan di server.
- `GET /api/production-v2/backlog?status=SEMUA|PENGAMBILAN|DITERIMA_WORKSHOP|DIPROSES` — filter & hitungan berbasis bukti; default `SEMUA` = himpunan lama (unit order Diproses yang sudah dijemput/lahir di workshop). Kelayakan Rencana (`classifyRencanaUnit`) tidak diubah. Kartu membawa `globalStatus`, `receivedBasis(+Label)`, `scheduleStatus`.
- `GET /api/production/work-orders`: parameter baru `globalStatus=A,B` (berbasis bukti) dan `statusIn=RECEIVED,IN_PRODUCTION` (status tersimpan mentah, tervalidasi); respons baru `globalStatusCounts`, `globalStatusFlow`, serta `globalStatus/receivedBasis/scheduleStatus` per baris. `displayStatus` lama tidak berubah artinya.
- `toRunView` (papan/kartu/Andon/pekerja) dan Unit 360 (`identity`, unit dengan maupun tanpa Run): bidang `globalStatus`, `receivedBasis`, `receivedBasisLabel`, `scheduleStatus`. `physicalPresenceOf` kini juga menghormati konfirmasi petugas (`staffConfirmed`).
- "Menunggu bahan" pada sumbu jadwal dihitung HANYA di tampilan Run (butuh BOM/Material Issue); daftar Order Produksi tidak menebaknya (bidang jadwal = belum dijadwalkan / sudah dijadwalkan / siap dikerjakan sesuai bukti).

**Frontend**: kosakata + warna badge (`productionLabels.js`: `GLOBAL_STATUS_TABS`, `statusOf` mendahulukan `globalStatus` server), tab Backlog Rencana, tab Order Produksi (6 status, lingkup Aktif = tanpa Terkirim), kartu backlog (status + dasar bukti + jadwal), Ringkasan Unit 360 (Status global · Posisi unit + dasar bukti · Status jadwal), himpunan V1 off-board lewat `statusIn` (persis himpunan lama). Tombol "Unit Tiba di Workshop" → "Terima Unit di Workshop" (command custody tidak berubah).

**Tes**: unit murni (`backend/tests/workshopMilestone.test.js`, `frontend/tests/workshopMilestoneLabels.test.js`), integrasi HTTP di DB sekali-pakai (`workshopMilestone.integration.test.js`: 10 unit skenario bukti, filter, hitungan, kartu, work-orders, Dalam Pengiriman, read-only). Tes lama yang artinya SENGAJA berubah diperbarui (`productionSimplifikasiSlice1`, empat tes frontend).

## 5. Fase 2 — belum
Order-level status global (Sales/Pipeline/laporan), template notifikasi, mobile + MCP, KPI yang mau dipisah "diterima vs diproses", dan keputusan produk atas bucket Sales "Diproses".
