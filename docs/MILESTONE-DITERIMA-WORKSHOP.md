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

## 5. Fase 2 — diimplementasikan (12 Okt 2026)

Urutan kanonis 7 status: **Menunggu Dijemput · Pengambilan · Diterima di Workshop · Diproses · Siap Kirim · Dalam Pengiriman · Terkirim**. "Menunggu Dijemput" vs "Pengambilan" dibedakan oleh Job pickup yang sedang berjalan (EN_ROUTE/ARRIVED) — `UnitStatus` tetap `AWAITING_PICKUP` sepanjang itu.

### 5.1 Status tingkat order (`orderMilestoneService`, `orderRollupOf`)
- Semua unit aktif sama → status itu. Berbeda → unit aktif yang PALING tertinggal, dengan rincian ("Diterima di Workshop · 2 dari 3 unit", "lainnya: 1 unit Diproses").
- Unit batal tidak ikut penyebut. Order tidak pernah tampil Siap Kirim/Terkirim selagi ada unit aktif yang tertinggal. Tanpa enum "Campuran".
- Order tanpa unit / order sewa (`SEWA_*`) tidak dikarang: `legacy: true`, label dari `Order.status` tersimpan.
- `BELUM_BAYAR` bukan blocker dan bukan sumbu status global (modul tidak membaca status pembayaran; dijaga tes).
- Dipasang: `GET /orders` (`milestone`), `GET /customers/:id` (order), `GET /pipeline/order-board` (kartu) + `/pipeline/board` (`latestOrderMilestone`), `GET /armada/jobs` (`orderMilestone`), antrean Gudang (`globalStatus` per unit), MCP (`statusGlobal`), Unit 360, mobile `OrdersScreen`. Field status lama TIDAK diubah/dihapus.

### 5.2 Notifikasi
- "Unit sampai bengkel" sebelumnya dipicu `POST /armada/jobs/:id/complete` (pickup selesai) — SALAH. Sekarang hanya command **Terima Unit di Workshop** (`acceptUnitCustody` INBOUND / `confirmUnitArrival` tanpa custody), SEKALI per transisi (replay Idempotency-Key tidak memicu lagi), plus event outbox `production.unit.received-workshop` dengan `dedupeKey` unik per handoff/Run.
- `DELIVERY_NOTIF_AKTIF` tetap `false` (dijaga tes). Tes memakai hook spy (`custodyHooks`), tidak ada pesan nyata.
- Belum diubah: notifikasi lain (produksi dimulai, produksi selesai/menunggu Gudang, delivery dimulai) — tetap seperti semula; belum ada pemicu idempoten baru.

### 5.3 KPI waktu alur (`workshopKpi`, `workshopTimelineService`)
Tujuh timestamp sumber → enam durasi, dihitung HANYA bila kedua timestamp ada dan berurutan; selain itu "Data waktu belum tersedia" (tidak ada timestamp dibuat, histori tak diubah):
pickup selesai (`Job PICKUP COMPLETED.completedAt`) → diterima workshop (custody INBOUND `acceptedAt` / fase INTAKE konfirmasi petugas) → produksi mulai (operasi non-SKIPPED pertama / log tahap V1 START) → produksi selesai (custody FINISHED_GOODS `offeredAt`, fallback fase HANDOFF) → barang jadi diterima Gudang (FINISHED_GOODS `acceptedAt`) → delivery mulai (`DeliveryExecutionEvent JOB_STARTED`) → terkirim (`Job DELIVERY COMPLETED.completedAt`).
Dipasang: Unit 360 (`timeline`, bagian "Waktu alur") dan `GET /production-v2/reports/milestone-durations?from=&to=` (n, rata-rata, median, `missing`).
Unit lahir di workshop tidak punya pickup → durasi 1 tidak tersedia (bukan dikarang).

### 5.4 Belum / sengaja tidak diubah
- Laporan Sales/CRM (`analytics`, `RingkasanTab`) tetap menghitung per `Order.status` tersimpan karena itu dasar omset; bukan milestone.
- Bucket Sales "Diproses" (PENDING+PICKUP+PROCESSING) dan filter status order tidak diubah (keputusan produk); badge milestone ditambahkan di samping.
- driver-mobile (app native, jalur OTA terpisah) belum memakai `orderMilestone`.
- Kolom papan Pipeline tetap menurut `Order.status` tersimpan.
