# Atribusi Fase 3.3 — KPI periode penuh, hari berjalan, kelengkapan spend, dan kohort D7 (kode-saja)

**KPI (biayaKpi.js, iklanReport.js, spend.js):**
- Bawaan laporan = 7 HARI PENUH yang berakhir kemarin; hari berjalan dipilih eksplisit (`dari=sampai=hari ini`).
- Rentang yang punya hari penuh tanpa baris spend (tingkat akun) → CPL / cost per qualified / cost per customer ber-order / CPA / booked & cash ROAS = `null`, alasan `SPEND_TIDAK_LENGKAP`; peringatan memuat tanggal yang hilang. Spend, percakapan platform, dan jumlah lead/order/DP/lunas tetap tampil.
- Rentang yang mencakup HARI INI → KPI CRM `null` alasan `HARI_BERJALAN_PARSIAL` (spend hari berjalan parsial/belum diimpor vs lead sampai sekarang tidak sebanding; tidak dianggap Rp0 dan tidak ada "sementara" karena kesetaraan cakupan jam tidak dapat dibuktikan). `laporan.periode` memisahkan `penuh` (berakhir kemarin).
- Nol spend sah (baris Rp0 ada) tetap dihitung (CPL/CPA Rp0, ROAS null `SPEND_NOL`).
- Penyebut CPA = closing seluruh lead di rentang yang SAMA dengan spend; blok kematangan (subset matang) tidak dipakai sebagai penyebut spend seluruh periode.

**D7 (`GET /api/atribusi/iklan/d7`, d7.js, baca-saja, ADMIN):** kohort lead akuisisi-terbukti yang hari lead-nya SELURUHNYA ≥ 7 hari; kejadian dihitung sampai 7×24 jam sejak lead dibuat dari histori: status order pada akhir jendela (order_status_transitions), pembayaran tercatat/terverifikasi ≤ akhir dan tidak dibatalkan ≤ akhir, refund disetujui ≤ akhir, prospek = transisi bertanggal. Status sekarang TIDAK dipakai. Biaya D7 = spend pada hari kohort yang sama dan hanya bila semua hari terisi. Akuisisi per campaign dipisah dari UNMAPPED; UNKNOWN dan reaktivasi di luar kohort. Coverage: atribusi, ledger, histori, spend. Batasan dinyatakan di respons.

**Rilis:** `scripts/release-atribusi-kpi-d7.sh <DEPLOY_SHA> <BASE_SHA> [--preflight-only|--rollback]` — backup, image rollback, build web, smoke (laporan, /d7, rentang tanpa spend, RBAC, tanpa PII/reach), tanpa migrasi, data tidak ditulis.
