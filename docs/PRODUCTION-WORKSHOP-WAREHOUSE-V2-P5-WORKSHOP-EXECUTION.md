# Production Workshop + Warehouse V2 — P5 Eksekusi Workshop

Slice kelima, di atas P4 (`...-P4-MATERIAL-ISSUE.md`, commit `f89a8a12`). Additive; flag SAMA dengan P1–P4 (`production_v2_writer`/
`production_v2_reader`, cohort `unitIds`, fail-closed); jalur V1 untuk writer OFF / non-cohort **tidak berubah dan tanpa jejak V2**.
P5 **tidak menulis stock movement, reservasi, atau HPP**, dan **tidak meluluskan QC / menandai siap kirim** (P6).

## Reuse vs baru
| Reuse (tidak diduplikasi) | Baru |
|---|---|
| Stage engine V1 `unitStageEngine.js` (aturan urutan jalur, foto wajib, alasan jeda, ledger `unit_stage_logs`, `units.currentStageId`) | Varian `startStageInTx/pauseStageInTx/resumeStageInTx/completeStageInTx` (isi engine yang sama, dipanggil di dalam transaksi P5; wrapper V1 memakai varian itu, perilaku tidak berubah) |
| Tabel V2 `production_runs_v2`, `production_phase_runs_v2`, `production_operation_runs_v2` (dari P1) | Command owner `productionWorkshopExecutionCommandService.js`; endpoint `/api/production-planning/workshop/…` |
| `v2_commands` (idempotensi), `domain_outbox`, `lockRowForUpdate`, optimistic `revision` | Enum `ProductionRunOrigin`, kolom `production_runs_v2.origin`; partial unique "satu operasi aktif per run" |
| Gerbang QC V1 (`fit_test` "Uji Berat Badan", `qc-queue`) | UI `/bengkel/workshop` (Antrean Kerja) |

## Aturan
- **Material gate:** start hanya bila plan `MATERIAL_RESERVED`, ada `material_issues` `ISSUED`, tidak ada reservasi `ACTIVE`, dan setiap baris BOM punya reservasi `CONSUMED` milik plan yang sama **yang dirujuk baris material issue `ISSUED` plan itu dengan `issuedQty` ≥ qty reservasi** (bukan sekadar ada issue terminal). Bila tidak: 409 `WORKSHOP_MATERIAL_NOT_ISSUED`, tanpa tulisan apa pun.
- **Status unit:** start hanya untuk unit `RECEIVED`/`IN_PRODUCTION`; jeda/lanjut/selesai hanya `IN_PRODUCTION`. Override manual V1 (unit jadi `CANCELLED`/`READY_FOR_DELIVERY`/`DELIVERED`) menghentikan eksekusi (409 `WORKSHOP_UNIT_NOT_IN_PRODUCTION`) tanpa menulis ledger tahap.
- **Operator/work center:** aktor harus `ProductionOperator` yang ditugaskan pada plan P3 (403 `WORKSHOP_OPERATOR_MISMATCH`) dan `workCenterId` wajib sama dengan plan (422 `WORKSHOP_WORK_CENTER_MISMATCH`). Otorisasi dicek sebelum revisi.
- **Satu tahap aktif per run:** pre-check + partial unique index `production_operation_runs_v2_active_run_key` (`status IN ('ACTIVE','PAUSED')`). Tahap dijeda tetap "aktif" — start tahap lain ditolak (409 `WORKSHOP_STAGE_ALREADY_ACTIVE`).
- **Urutan tahap:** mengikuti jalur routing V1 unit (INTAKE + modul layanan); tahap tidak dapat dilompati (engine yang menolak).
- **Jeda:** alasan wajib (`BREAK`/`PROCESS_DELAY`/`OTHER` + catatan); alasan blokir operasional ditolak (gunakan "Tandai Terhambat"); foto evidence opsional disimpan di log PAUSE. Selesai tahap: foto wajib bila tahap `requiresPhoto`.
- **Idempotensi/revisi:** setiap perintah wajib `Idempotency-Key` + `expectedRevision` (revisi Production Run). Replay (aktor+kunci+hash sama) mengembalikan respons tersimpan tanpa tulisan/outbox baru; revisi basi → 409 `WORKSHOP_REVISION_CONFLICT`.

## State machine
Run (tampilan antrean): `READY_TO_START` → `IN_PROGRESS` ⇄ `PAUSED` → (tahap berikutnya) `READY_TO_START` … → **`AWAITING_QC`**.
Operasi (`production_operation_runs_v2`): `ACTIVE` ⇄ `PAUSED` → `COMPLETED`.

`AWAITING_QC` tidak memakai enum baru: fase `PROCESS` = `COMPLETED`, `run.currentPhase = QC`, fase `QC` = `NOT_STARTED`, dan
`units.currentStageId` = gerbang QC V1 (unit otomatis muncul di `qc-queue` V1). Selesai tahap workshop terakhir hanya menuju keadaan ini
(outbox `production.run.awaiting_qc`); tidak ada `QualityInspection`, tidak ada `READY_FOR_DELIVERY`, tidak ada saran delivery job.

## Pagar V1 (kepemilikan)
`assertNotV2ExecutionOwned` di 9 fungsi penulis ledger tahap engine (start/pause/resume/complete/recordDone/fail/skip/recordQcFitTest/adminBypassProduction;
diperiksa PER FUNGSI oleh audit). `resolveBlocker` sengaja tidak dipagari (hanya menyentuh `production_blockers`, bukan ledger tahap). Bila writer aktif untuk unit
tersebut **dan** unit punya Production Run non-terminal, endpoint V1 menolak (409, arahkan ke endpoint workshop). Writer OFF / unit
non-cohort / unit tanpa run → jalur V1 persis seperti sebelumnya.

## Unit BARU/SEWA lahir di workshop
`POST /workshop/runs {unitId}` membuat Production Run `origin = WORKSHOP_BORN`, `kind = NEW_PRODUCT`: fase INTAKE/DIAGNOSIS `NOT_APPLICABLE`,
PROCESS `NOT_STARTED`. Hanya kategori order BARU/SEWA dan unit **segar** (status `RECEIVED`, tanpa `currentStageId`, tanpa log tahap V1 — unit legacy/berjalan ditolak: `WORKSHOP_BORN_STATUS_INVALID`/`WORKSHOP_BORN_UNIT_NOT_FRESH`); unit yang punya job PICKUP atau custody INBOUND ditolak (409 `WORKSHOP_BORN_HAS_PICKUP`)
— gunakan alur custody. **Tidak ada custody handoff palsu** dan `migrationSource` tidak dipakai. P3 memperlakukan `origin = WORKSHOP_BORN`
sebagai eligible untuk rencana (di samping custody diterima / legacy). Unit ini baru mendapat custody barang jadi setelah QC/P6.
Run yang dibuat lewat custody (P1–P2) kini diberi `origin = CUSTODY_PICKUP` (kolom nullable; run lama tetap `NULL`).

## Antrean & UI
`GET /workshop/queue?scope=today|all&mine=1` (reader-gated; reader OFF → `{items:[], readerMode:"OFF"}`): run dengan material ISSUED;
`today` = target mulai ≤ akhir hari ini (WIB). `GET /workshop/runs/:runId`: tahap + status, kesiapan material, gerbang QC, histori dari ledger tahap.
UI Bahasa Indonesia `/bengkel/workshop`: antrean kerja hari ini, detail tahap, Mulai / Jeda / Lanjutkan / Selesai Tahap, histori aktivitas,
state loading/kosong/galat/409, kunci idempotensi per niat perintah. Logika murni: `frontend/src/features/production/workshopExecution.js`.

## Migrasi & audit
`20261001080000_production_workshop_execution_v2` — additive (enum + kolom nullable + partial unique index), LF, tanpa backfill.
`scripts/production-delivery-v2/audit-workshop-execution-writers.js` (0 pelanggaran): penulis operation-run hanya P5; phase/run hanya custody + P5;
`unit_stage_logs` hanya engine; P5 tanpa stok/reservasi/HPP/jurnal dan wajib memakai keempat varian `*InTx`; engine memagari 9 fungsi (per fungsi; pagar di fungsi tanpa `unitId` atau di varian `*InTx` dianggap pelanggaran).

## Risiko diterima (hasil audit 1e74ab3e)
1. **Override manual order/unit di V1** (`PATCH /orders/:id` status READY/DELIVERED/CANCELLED, `reopen-for-delivery`) bisa memindahkan unit V2 ke `READY_FOR_DELIVERY`/`CANCELLED` tanpa lewat V2. P5 berhenti dengan 409 (tanpa menulis ledger); run V2 tetap `ACTIVE` sampai ditangani — rekonsiliasi jadi tugas P6.
2. **`PATCH /units/:id/service` dan persetujuan Scope Revision** mengganti layanan (jalur routing) di tengah run. P5 fail-closed (`WORKSHOP_STAGE_MISMATCH`/galat engine → rollback), tidak merusak state.
3. **Assign P3 setelah produksi berjalan** mengganti operator/work center; otorisasi P5 mengikuti assignment terbaru (serah-terima supervisor), tercatat di outbox/audit P3.
4. **Unit di gerbang QC (AWAITING_QC)** belum bisa di-QC dari jalur V1 (mulai tahap QC dipagari) — jalur QC V2 = P6; flag Production tetap OFF.
5. Skrip backfill historis (`backfill-core.js`, `resolve-admin-bypass-history.js`) menulis di luar engine; bukan writer runtime.

## Gap menuju P6
1. **Keputusan QC:** PASS/FAIL, foto QC, dan rework ada di jalur QC V1 (`/units/:id/stages/:stageId/qc`); belum ada command owner V2 yang mengubah fase `QC`/`HANDOFF`.
2. **Barang jadi:** custody barang jadi (Produksi → Gudang barang jadi) dan `READY_FOR_DELIVERY` V2 belum ada; unit WORKSHOP_BORN/SEWA butuh serah-terima barang jadi pertama saat P6.
3. **Terhambat/exception:** "Tandai Terhambat" (Block Production V1) belum terhubung ke operasi V2; jeda hanya untuk alasan terkendali.
4. **Penyelesaian run:** `production_runs_v2.status` belum pernah `COMPLETED` — dipicu oleh P6.
5. **Rework/scope revision** setelah QC gagal, serta pemakaian bahan aktual vs planned BOM (selisih), belum dimodelkan di V2.
6. **Notifikasi/SLA** tahap terlambat dan mobile (APK) operator belum ada.
