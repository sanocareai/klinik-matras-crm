# Kandidat rilis gabungan Produksi Fase 1–5 — CONDITIONAL GO (dua blocker ditutup di dokumen ini)

**SHA kandidat:** lihat commit paling atas cabang `rc/produksi-fase1-5-on-live-934142cd` (dibangun di atas release live yang aktif).
Rilis hanya lewat `scripts/release-produksi-fase1-5.sh` (fail-closed; backup+checksum+rollback). Tidak ada kebijakan V2 yang diaktifkan, tidak ada cohort diperluas, tidak ada unit nyata dikerjakan, tidak ada tulisan ke database production.

## 1. Freeze release aktif (diverifikasi langsung di VPS, baca-saja)
- Release aktif terakhir diverifikasi: **`934142cd`** (image backend `sha256:f35df5b6…`), **229** migration applied, 0 menggantung. Bukan `2e7d5db8`, bukan 226/228.
- Dua migration yang sebelumnya saya sebut "applied tetapi folder hilang" (`20260906120000_block_reason_extended`, `20260906130000_production_blockers`) **tidak yatim**: folder ada di repo, checksum production = sha256 berkas. Penyebab salah baca: penyaring `grep -v lock`. Lihat `AUDIT-MIGRASI.md`.
- Live bergeser selama pekerjaan (`7c4e5586` → `b3c5502d` → `2a5ab783` → `934142cd`); kandidat digabung ulang tiap kali. **Skrip rilis menolak jalan bila release aktif ≠ BASE_SHA yang dipin.**

## 2. Migration pending (7, semuanya aditif)
`20261018100000_production_build_stage`, `20261019100000_production_build_plan_settings`, `20261021100000_production_component_qc_sections`, `20261022100000_production_qc_gate_policy`, `20261023100000_material_density_thickness` (idempoten `IF NOT EXISTS`), `20261024100000_production_component_plan_racikan`, `20261025100000_production_component_assembly_tests`.
Total setelah rilis: **236** applied (229 + 7). Satu-satunya perubahan pada data lama: `routing_stages` +1 baris (`custom_build`, urutan 10) — penambahan, tidak ada baris lama yang berubah. Tidak ada kolom baru NOT NULL tanpa default pada tabel lama.

## 3. Bukti rehearsal pada SALINAN production (`rehearsal/`)
Dijalankan di VPS (`rehearsal-fase5.sh`): `pg_dump -Fc` (baca-saja; sha256 `79d1b383…`) → DB scratch di server postgres yang sama → `prisma migrate deploy` dengan image live + migrations kandidat → dibuang. Database production tidak ditulis.
- Restore 229 → deploy **+7 = 236**, 0 menggantung; replay "No pending".
- Sidik jari 205 tabel (jumlah baris + md5 isi, kolom lama): **identik kecuali `routing_stages` (+1 baris `custom_build`)**.
- **Flag/cohort BYTE-IDENTIK** (md5 `eeb34039…`, sama dengan production saat itu); `production_settings` BYTE-IDENTIK (`319f10e7…`); baris `qc_gate_default_policy` = 0 → **V2 tidak aktif**; `adaptation_default_policy` tetap 1 baris seperti production.
- **Rollback kode:** image live (kode lama) dijalankan terhadap DB yang sudah dimigrasi: baca ke tabel yang berubah (users/orders/units/materials/runs/plans/evidence/moves/flags/settings/PO/valuasi/komponen) dan tulis dalam transaksi yang dibatalkan berhasil; jumlah materials tidak berubah. Migration aditif dipertahankan saat kode digulung balik.
- Catatan jujur: salinan production TIDAK memuat plan/evidence/komponen produksi V2 (0 baris) — perilaku Corner/V2 pada data riil belum teramati; itu dibuktikan di staging.

## 4. Scope file (kandidat vs live `b3c5502d`; dist & artefak dibersihkan)
~481 file: `docs/design` 361 (dokumen+tangkapan layar), `frontend/src` 50, `backend/src` 28, `backend/tests` 18, `frontend/tests` 15, `backend/prisma` 8, `backend/scripts` 1. Overlap file dengan perubahan live (Finance/Gudang/PO/Delivery): `schema.prisma` (model berbeda, auto-merge, `prisma validate` OK), `frontend/src/api.js`, `UnitOverviewDrawer.jsx`, `pageRegistry.jsx` — semua bergabung bersih; `inventoryLedger.js` (live: pembekuan valuasi biaya bahan) tidak disentuh Produksi dan diuji bersama. Satu tes audit yang **sudah merah di live** (pembaca bukti `finance/biayaBahan.js`) diperbaiki: pembaca baca-saja itu masuk allowlist audit (wajib filter `DOC_`).

## 5. Hasil gate (SHA final)
- **Unit:** (diisi pada SHA final)
- **Integrasi terarah (DB unik, tanpa full suite):** 337/337 pada kandidat di atas `b3c5502d` (planning, QC, Corner, dokumentasi, stok/retur, handoff, Delivery, custody, PO, biaya bahan, termin/aging utang, valuasi, promo) lalu **199/199** pada kandidat final di atas `2a5ab783` (+ PDF PO). Tes baru: label konfirmasi, catatan yang sekadar menyebut ganti kain.
- **QA browser pada image gabungan: 76/76** (`qa-ui-result.json`, `screenshots/`): alur QC → Corner diperlukan (permintaan Sales tidak jelas, konfirmasi dicatat PIC Corner) → Selesaikan Produksi → Gudang menolak saat retur tertunda → terima retur → Siap Kirim + 1 job Delivery → tampilan terpadu 390/1440 terang/gelap; ditambah **Corner TIDAK diperlukan** (pesanan BARU divan): status jujur, tanpa aktivitas Corner, PIC Meja menyelesaikan, laporan menandai langkah Corner "Tidak berlaku" dengan alasan. 1 respons 409 disengaja.
- Koreksi sebelum rilis: label "Konfirmasi Sales dicatat oleh PIC Corner" + nama aktor + waktu + isi (tidak mengklaim Sales yang mengisi); catatan order yang sekadar menyebut ganti kain **bukan** permintaan — layanan Sales yang dipesan menjadi penentu (catatan tetap dikutip + ditandai).

## 6. Skrip rilis (blocker 1 — ditutup)
`scripts/release-produksi-fase1-5.sh <DEPLOY_SHA> <BASE_SHA> <FILELIST_SHA256> [--preflight-only|--rehearsal-only]`. Fail-closed: pin sha256 tiap migration dan daftar berkas yang direview; ancestry base→kandidat; release aktif == BASE; pending tepat 7; checksum migration terpasang vs berkas (drift tercatat 4 diizinkan, selain itu berhenti); backup pg_dump + sha256; rehearsal restore backup nyata ke DB scratch + deploy migration + replay; sidik jari tabel; flag/settings md5 identik; `qc_gate_default_policy`=0; uji rollback-kode; image rollback `klinik-matras-backend:rollback-pre-pf5-<sha8>`; verifikasi pasca-rilis (berkas kunci byte-identik di container, endpoint baru 401 tanpa login, aset lama 200, RestartCount=0). Teruji: preflight OK, rehearsal-only end-to-end OK (log di `rehearsal/skrip-rilis-rehearsal-only.log`), tes negatif (penyimpangan dipin → berhenti).

## 7. Setelah rilis
**V2 tetap mati**: Run baru dipin NULL (kebijakan lama) sampai Admin mengaktifkan bawaan gerbang QC secara eksplisit. Setting dan cohort tidak diubah. **QA perangkat fisik S25 adalah gate terpisah sebelum aktivasi V2** (belum dilakukan). Salinan production tidak memuat unit produksi V2 nyata; perilaku di data riil belum teramati.
