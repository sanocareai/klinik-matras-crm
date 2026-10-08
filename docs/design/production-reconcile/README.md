# Rekonsiliasi: baseline live 2e7d5db8 + Fase 4 (7df9d4f1) + setting gerbang QC + Material.density/thicknessCm

Branch `feat/production-reconcile-live-fase4`. Fase 5 dimulai dari branch ini.

## Susunan
- Dasar: `2e7d5db8` (live terakhir menurut catatan; production TIDAK dibaca). Merge `7df9d4f1` (Fase 4, memuat Fase 2/3) tanpa konflik → merge `feat/production-layanan-fase3-reconcile` (density + setting) dengan 2 konflik di tempat pembuatan Run, diselesaikan memakai `defaultQcGatePolicy(tx)`. Checkpoint `021dcf47` dan branch Fase 4 tidak diubah; worktree sesi lain tidak disentuh.
- Overlap file live vs Fase 4: hanya `schema.prisma`, `activityLog.js`, `frontend/src/api.js` (auto-merge bersih).

## Kontrak gerbang QC
- Tanpa setting eksplisit = kebijakan lama (Run baru NULL, tanpa gerbang). Admin/Owner (`production_settings:write`) mengaktifkan V1 (gerbang awal) atau V2 (awal + perakitan) atau menonaktifkan: `PUT /production-v2/settings/qc-gate-default {enabled, version?}`; tanpa `version` = V2. UI: Pengaturan Produksi › Alur Kerja.
- Dibaca saat Run dibuat (3 tempat) dan di-snapshot ke `qc_gate_policy_version`; tidak retroaktif; tiap perubahan tercatat `PRODUCTION_SETTING_CHANGED`.
- Penerapan ke Run berjalan: `POST /runs/:id/qc-gate` — beralasan, memeriksa revisi, idempoten, tercatat; tidak pernah menurunkan.
- Setting TIDAK diaktifkan oleh saya di production (hanya di staging terisolasi).
- Density/thicknessCm: opsional, tampil hanya bila ada, tidak dikarang.

## Migration final: 228
Set live (219) + Fase 2–4 (`production_build_stage`, `production_build_plan_settings`, `production_component_qc_sections`, `production_qc_gate_policy`, `production_component_plan_racikan`, `production_component_assembly_tests`) + `20261023100000_material_density_thickness` (idempoten `IF NOT EXISTS`). Stempel `20261021100000` dipakai dua migration berbeda nama (`route_completeness_proof` Delivery, `production_component_qc_sections` Produksi): aman, tes stempel diberi pengecualian.
Rehearsal (`rehearsal-migration.json`, DB terisolasi): clean install; dari live 219; live + QC gate lokal (223); + density sudah applied & tercatat (224); kolom density ada tanpa catatan (223); Fase 4 penuh tanpa density (227) → semua 228, replay "No pending", 0 migration gagal. BUKAN dump production.

## Verifikasi (terarah, bukan full suite)
- Unit: backend 1128, frontend 745 (setelah perbaikan tes kontrak).
- Integrasi terarah (DB unik): PreTeardown (bawaan gerbang: tanpa setting NULL, V1/V2/nonaktif, tercatat, tidak retroaktif, Run lama, penerapan eksplisit), Experience (tiga racikan, rework fondasi/lapisan, bahan rework PIC Bahan→Gudang, replay/konflik, stok & retur tepat sekali), ComponentNotes (katalog density), AdaptationSlice2, QcFinishedGoods, ReturnQueueReorder, QcPermissionMatrix, BuildTrack, MaterialIssue, Planning: 121 lulus pada batch pertama + 60 lulus pada ulang (PreTeardown/ReturnQueueReorder/BuildTrack/MaterialIssue/Planning). Dijalankan pada SHA sebelum 3 commit terakhir yang hanya mengubah: tes, label UI, `IF NOT EXISTS` migration — integrasi tidak diulang setelahnya.
- QA browser (image e21c5334): setting Admin 4/4 (nonaktif awal, aktifkan, ganti versi, Run lama tak berubah) dan alur normal Meja→PIC QC→Meja→PIC QC→Lulus 32/32; konsol error 0.
- Tidak dijalankan: full suite; perangkat fisik; dump production; QA browser rework/tiga racikan di image gabungan (hanya integrasi).

## Audit 48 artefak di riwayat 09a8fb6d
`backend/data/production-evidence/*` (20 jpg + 28 mp4) isinya teks pendek penanda uji (`p9d-N-<acak>`, `vid-…`), bukan gambar/video asli; tanpa EXIF, tanpa email/telepon/token/kata sandi. Bukan data sensitif. Sejarah tidak ditulis ulang (branch bersama); file sudah dilepas dari pohon sejak 7df9d4f1.
