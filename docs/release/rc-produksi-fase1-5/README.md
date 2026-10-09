# Kandidat rilis gabungan Produksi Fase 1–5 — untuk REVIEW (belum dirilis)

**SHA kandidat:** lihat commit paling atas cabang `rc/produksi-fase1-5-on-live-2a5ab783` (dibangun di atas release live yang aktif).
Jangan deploy dari dokumen ini. Tidak ada kebijakan V2 yang diaktifkan, tidak ada cohort diperluas, tidak ada unit nyata dikerjakan, tidak ada tulisan ke database production.

## 1. Freeze release aktif (diverifikasi langsung di VPS, baca-saja)
- Release aktif saat mulai: `7c4e5586`; berpindah ke `b3c5502d` (Delivery POD) lalu **`2a5ab783`** (PDF Purchase Order) selama pekerjaan. Kandidat digabung ulang tiap perpindahan; yang terakhir diverifikasi sebelum penyerahan: **`2a5ab783`** (mount frontend + image backend `sha256:736b8eec…`).
- Bukan `2e7d5db8`, bukan 228. Migration **applied di production: 226** (hitungan dari `_prisma_migrations`, 0 menggantung). 2 di antaranya (`20260906120000_block_reason_extended`, `20260906130000_production_blockers`) applied tetapi tidak ada folder di repo (yatim, sudah begitu sebelum kandidat; Prisma menoleransi).
- Perpindahan live selama pekerjaan **tidak menambah migration** (hanya kode Delivery dan PDF PO); kandidat digabung ulang dan tes diulang. **Re-freeze wajib dicek lagi tepat sebelum rilis** (release lain bergerak paralel).

## 2. Migration pending (7, semuanya aditif)
`20261018100000_production_build_stage`, `20261019100000_production_build_plan_settings`, `20261021100000_production_component_qc_sections`, `20261022100000_production_qc_gate_policy`, `20261023100000_material_density_thickness` (idempoten `IF NOT EXISTS`), `20261024100000_production_component_plan_racikan`, `20261025100000_production_component_assembly_tests`.
Total setelah rilis: **233** applied. Satu-satunya perubahan pada data lama: `routing_stages` +1 baris (`custom_build`, urutan 10) — penambahan, tidak ada baris lama yang berubah. Tidak ada kolom baru NOT NULL tanpa default pada tabel lama.

## 3. Bukti rehearsal pada SALINAN production (`rehearsal/`)
Dijalankan di VPS (`rehearsal-fase5.sh`): `pg_dump -Fc` (baca-saja; sha256 `79d1b383…`) → DB scratch di server postgres yang sama → `prisma migrate deploy` dengan image live + migrations kandidat → dibuang. Database production tidak ditulis.
- Restore 226 → deploy **+7 = 233**, 0 menggantung; replay "No pending".
- Sidik jari 204 tabel (jumlah baris + md5 isi, kolom lama): **identik kecuali `routing_stages` (12→13, baris baru)**.
- **Flag/cohort BYTE-IDENTIK** (md5 `eeb34039…`, sama dengan production saat itu); `production_settings` BYTE-IDENTIK (`319f10e7…`); baris `qc_gate_default_policy` = 0 → **V2 tidak aktif**; `adaptation_default_policy` tetap 1 baris seperti production.
- **Rollback kode:** image live (kode lama) dijalankan terhadap DB yang sudah dimigrasi: baca ke tabel yang berubah (users/orders/units/materials/runs/plans/evidence/moves/flags/settings/PO/valuasi/komponen) dan tulis dalam transaksi yang dibatalkan berhasil; jumlah materials tidak berubah. Migration aditif dipertahankan saat kode digulung balik.
- Catatan jujur: salinan production TIDAK memuat plan/evidence/komponen produksi V2 (0 baris) — perilaku Corner/V2 pada data riil belum teramati; itu dibuktikan di staging.

## 4. Scope file (kandidat vs live `b3c5502d`; dist & artefak dibersihkan)
~481 file: `docs/design` 361 (dokumen+tangkapan layar), `frontend/src` 50, `backend/src` 28, `backend/tests` 18, `frontend/tests` 15, `backend/prisma` 8, `backend/scripts` 1. Overlap file dengan perubahan live (Finance/Gudang/PO/Delivery): `schema.prisma` (model berbeda, auto-merge, `prisma validate` OK), `frontend/src/api.js`, `UnitOverviewDrawer.jsx`, `pageRegistry.jsx` — semua bergabung bersih; `inventoryLedger.js` (live: pembekuan valuasi biaya bahan) tidak disentuh Produksi dan diuji bersama. Satu tes audit yang **sudah merah di live** (pembaca bukti `finance/biayaBahan.js`) diperbaiki: pembaca baca-saja itu masuk allowlist audit (wajib filter `DOC_`).

## 5. Hasil gate (SHA final)
- **Unit:** backend 1157/1157, frontend 780/780.
- **Integrasi terarah (DB unik, tanpa full suite):** 337/337 pada kandidat di atas `b3c5502d` (planning, QC, Corner, dokumentasi, stok/retur, handoff, Delivery, custody, PO, biaya bahan, termin/aging utang, valuasi, promo) lalu **199/199** pada kandidat final di atas `2a5ab783` (+ PDF PO). Tes baru: label konfirmasi, catatan yang sekadar menyebut ganti kain.
- **QA browser pada image gabungan: 76/76** (`qa-ui-result.json`, `screenshots/`): alur QC → Corner diperlukan (permintaan Sales tidak jelas, konfirmasi dicatat PIC Corner) → Selesaikan Produksi → Gudang menolak saat retur tertunda → terima retur → Siap Kirim + 1 job Delivery → tampilan terpadu 390/1440 terang/gelap; ditambah **Corner TIDAK diperlukan** (pesanan BARU divan): status jujur, tanpa aktivitas Corner, PIC Meja menyelesaikan, laporan menandai langkah Corner "Tidak berlaku" dengan alasan. 1 respons 409 disengaja.
- Koreksi sebelum rilis: label "Konfirmasi Sales dicatat oleh PIC Corner" + nama aktor + waktu + isi (tidak mengklaim Sales yang mengisi); catatan order yang sekadar menyebut ganti kain **bukan** permintaan — layanan Sales yang dipesan menjadi penentu (catatan tetap dikutip + ditandai).

## 6. Hal yang harus diputuskan/dilakukan sebelum rilis
1. Re-freeze: cek release aktif lagi saat jendela rilis; gabung ulang bila bergerak.
2. Tidak ada migration yang menunggu persetujuan khusus, tetapi **backup pg_dump + checksum** wajib (skrip rilis serupa `release-reklas-uang-muka.sh`; skrip rilis Produksi khusus kandidat ini belum dibuat).
3. Setelah rilis kode, **V2 tetap mati**: Run baru dipin NULL (kebijakan lama) sampai Admin mengaktifkan bawaan gerbang QC secara eksplisit. Fase 2–5 tidak berlaku untuk Run/unit nyata sebelum itu.
4. Belum diuji: perangkat fisik (S25/kamera); full suite; unit produksi V2 nyata (salinan production tidak memilikinya).
