// FASE 1 atribusi Meta Ads — DEFINISI METRIK kohort lead → customer → order → pembayaran.
//
// Satu sumber untuk "apa arti angka ini": dipakai inti (cohort.js), laporan (cohortReport.js; bagian `definisi` respons), dan dokumen.
// Semua definisi diturunkan dari kode nyata (rujukan di `sumber`). Modul ini TIDAK menulis apa pun dan TIDAK menyentuh Customer.leadSource.
// Atribusi campaign/ad bukan bagian dari kohort ini (status BELUM_ADA_DATA).

/** Status order yang TIDAK dihitung sebagai "order"/omzet — sama persis dengan OMSET_EXCLUDED_STATUS di routes/analytics.js (dijaga tes). */
export const ORDER_EXCLUDED_STATUS = Object.freeze(["CANCELLED", "PENDING"]);

/**
 * Stage yang berarti sales PERNAH menandai lead sebagai prospek (atau tahap sesudahnya). Diubah MANUAL oleh sales; PipelineTransition baru ada sejak
 * 25 Jul 2026. Penilaian sales, BUKAN "qualified lead" yang objektif — sengaja tidak dinamai begitu.
 */
export const STAGE_PROSPEK_ATAU_LANJUT = Object.freeze(["PROSPECT", "TRANSACTION", "REVIEWED"]);

/**
 * Timestamp PERSIS operasi "tutup buku" satu-kali 31 Agustus 2026: order yang SAAT ITU sudah LUNAS diberi `paidAt = waktu itu`, karena tanggal aslinya
 * tidak pernah tercatat (ledger Payment kosong). BUKAN tanggal lunas sesungguhnya. Nilai yang sama dipakai analytics.js (PAID_AT_BACKFILL_31_AGT,
 * sumber "paidAtPerkiraan"); tes menjaga keduanya tetap sama.
 */
export const PAID_AT_BACKFILL_31_AGT = new Date("2026-08-31T05:35:57.201Z");

/** Customer yang BUKAN lead pemasaran (dikecualikan dari kohort; tetap dihitung di `luarKohort` supaya rekonsiliasi utuh). */
export const LEAD_EXCLUSION = Object.freeze({
  SPAM: "pipelineStage = SPAM (sama dengan custWhereKonversi di analytics.js)",
  B2B_DIRECT: "leadSource = B2B_DIRECT (sama dengan custWhereFunnel)",
  PENJUALAN_KARYAWAN: "leadSource = PENJUALAN_KARYAWAN (pembeli aktual Penjualan Karyawan, bukan lead Sales)",
  INTERNAL_STAFF: "isInternalStaff = true (nomor tim sendiri)",
  PROFIL_KARYAWAN: "staffUserId terisi (profil internal Penjualan Karyawan)",
});

/** SIAP = dihitung dari data nyata; SEBAGIAN = dihitung tetapi cakupan/akurasi terbatas; BELUM_ADA_DATA = tidak dapat dihitung jujur. */
export const STATUS = Object.freeze({ SIAP: "SIAP", SEBAGIAN: "SEBAGIAN", BELUM_ADA_DATA: "BELUM_ADA_DATA" });

/** Tiga tanggal yang TIDAK pernah dicampur. */
export const TANGGAL = Object.freeze({
  LEAD: "Customer.createdAt (hari/bulan WIB) → perBulanLead",
  ORDER: "Order.createdAt (hari/bulan WIB) → perBulanOrder",
  PEMBAYARAN: "Payment.createdAt, FinRefund.approvedAt, Order.paidAt (lunasMenurutCrm), hari payment pelunas (lunasTerbuktiLedger) → perBulanPembayaran",
});

export const METRICS = Object.freeze([
  {
    id: "unique_lead", status: STATUS.SIAP, label: "Unique lead masuk",
    definisi: "Customer unik (satu baris per nomor) dengan `createdAt` di bulan WIB itu, bukan SPAM/B2B_DIRECT/staf internal/profil karyawan.",
    sumber: ["Customer.createdAt", "Customer.pipelineStage", "Customer.leadSource", "Customer.isInternalStaff", "Customer.staffUserId"],
    tanggal: "Customer.createdAt = waktu pesan pertama diproses, BUKAN waktu klik iklan.",
    catatan: ["Customer yang datang lagi bukan lead baru (nomor unik, thread seumur hidup).", "Beberapa LID/nomor yang belum tergabung dihitung terpisah."],
  },
  {
    id: "pernah_ditandai_prospek", status: STATUS.SEBAGIAN, label: "Pernah ditandai prospek",
    definisi: "Lead yang PERNAH di stage PROSPECT/TRANSACTION/REVIEWED. Penilaian manual sales; bukan 'qualified lead'. `tanpaTanggal` = stage prospek-atau-lanjut tanpa riwayat transisi (transisi baru ada sejak 25 Jul 2026).",
    sumber: ["PipelineTransition.toStage", "PipelineTransition.createdAt", "Customer.pipelineStage"],
    tanggal: "PipelineTransition.createdAt.",
    catatan: ["Ambang 'qualified' belum disepakati."],
  },
  {
    id: "customer_dengan_order", status: STATUS.SIAP, label: "Customer dengan order",
    definisi: "Customer unik (kohort lead) dengan ≥ 1 order eligible: status bukan CANCELLED/PENDING, bukan Penjualan Karyawan. `customerRepeat` = ≥ 2 order; `customerHanyaOrderPending` = punya PENDING tetapi nol eligible (selisih terhadap Dashboard).",
    sumber: ["Order.customerId", "Order.status", "Order.penjualanKaryawanId"],
    tanggal: "Order.createdAt menentukan bulan order; kohort tetap menurut tanggal lead.",
    catatan: ["Satuan customer; jangan dibandingkan langsung dengan jumlah order."],
  },
  {
    id: "order", status: STATUS.SIAP, label: "Order",
    definisi: "Jumlah order eligible. `orderPending` dan `orderBatal` terpisah. `orderBerulang` = order ke-2 dst milik customer yang sama (urut createdAt lalu id).",
    sumber: ["Order.createdAt", "Order.status", "Order.penjualanKaryawanId"],
    tanggal: "Order.createdAt (bulan WIB).",
    catatan: ["Selaras dengan omzet Dashboard (OMSET_EXCLUDED_STATUS)."],
  },
  {
    id: "nilai_order", status: STATUS.SIAP, label: "Nilai order (booked)",
    definisi: "Σ `Order.value` order eligible (tanpa ongkir). Nilai yang dibukukan sales; BUKAN uang diterima dan BUKAN nilai lunas.",
    sumber: ["Order.value"], tanggal: "Order.createdAt (bulan WIB).",
    catatan: ["Ongkir ditagih terpisah dan hanya masuk tagihan (dasar status bayar)."],
  },
  {
    id: "lunas_menurut_crm", status: STATUS.SEBAGIAN, label: "Lunas menurut CRM",
    definisi: "Order eligible dengan `Order.paymentStatus = LUNAS` (status tersimpan; yang dilihat tampilan operasional). Order dengan ledger kurang TETAP termasuk. Tanggal: `tanggalPasti` = paidAt tercatat bukan backfill (masuk tren per bulan); `tanggalTidakPasti` = paidAt = timestamp backfill 31 Agt 2026 (tidak masuk tren); `tanpaTanggal`.",
    sumber: ["Order.paymentStatus", "Order.paidAt", "OrderPaidAtPengecualian (aktif)"],
    tanggal: "Order.paidAt (bulan WIB), hanya `tanggalPasti`.",
    catatan: [
      "Status tersimpan bisa diubah manual tanpa jejak ledger; BUKAN bukti uang.",
      "`tanggalDikunciOwner`: tanggal dikunci pengecualian Owner — membuktikan tanggal yang dikunci, bukan uang diterima.",
      "`didukungLedger`: ledger valid juga menghitung LUNAS pada hari WIB yang sama.",
    ],
  },
  {
    id: "lunas_terbukti_ledger", status: STATUS.SEBAGIAN, label: "Lunas terbukti ledger",
    definisi: "Order eligible yang ledger valid-nya menutup SELURUH tagihan: Σ kontribusi dihitung − refund DISETUJUI (≥ 0) ≥ tagihan > 0, tagihan = Order.value + ongkir ditagih. Order dengan ledger kurang TIDAK masuk. Tanggal = hari WIB payment yang pertama membuat kumulatif ≥ tagihan.",
    sumber: ["Payment (dihitung)", "FinPaymentAllocation", "FinRefund(DISETUJUI)", "tagihanOrder", "isPaymentCounted (gerbang verifikasi)"],
    tanggal: "Payment.createdAt hari pelunas (bulan WIB) — aturan `tanggalLunasEfektif` live.",
    catatan: [
      "Cutoff ledger: histori sebelum ledger terisi (sebagian besar sebelum ±Sep 2026) tidak punya Payment; order itu hanya bisa 'lunas menurut CRM'. Lihat `cakupanLedger`.",
      "Formula: lunasTerbuktiLedger = buktiPelunasan.lunasTerbuktiLedger + buktiPelunasan.konflikBelumLunasTersimpanLedgerCukup.",
    ],
  },
  {
    id: "bukti_pelunasan", status: STATUS.SIAP, label: "Bukti pelunasan",
    definisi: "Partisi tepat-satu atas order LUNAS menurut CRM: `lunasTerbuktiLedger` (ledger ≥ tagihan), `lunasTanpaLedger` (tidak ada payment valid; belum terbukti), `konflikLunasTersimpanLedgerTidakCukup` (ada payment valid tetapi < tagihan; kekurangan di `kekuranganRupiahKonflik`). `konflikBelumLunasTersimpanLedgerCukup` = ledger menutup tagihan tetapi CRM belum LUNAS.",
    sumber: ["Order.paymentStatus", "Payment (dihitung)", "tagihanOrder", "FinRefund(DISETUJUI)"],
    tanggal: "—",
    catatan: [
      "Konflik BUKAN lunas terbukti dan BUKAN DP selaras; `orderDpSaatIniKonflikLunasCrm` menandai bagian DP-kini-ledger yang berstatus LUNAS CRM.",
      "Penyebab konflik tidak disimpulkan: pembayaran di luar sistem yang belum dicatat, atau status LUNAS manual yang keliru, tidak dapat dibedakan dari data. Tidak ada koreksi otomatis.",
    ],
  },
  {
    id: "uang_ledger", status: STATUS.SEBAGIAN, label: "Uang diterima (ledger valid)",
    definisi: "Σ kontribusi Payment yang dihitung (bukan dibatalkan, lolos gerbang verifikasi, sadar-alokasi) pada order bukan CANCELLED. `refundDisetujui` dan `uangBersihLedger = uangLedger − refundDisetujui` terpisah.",
    sumber: ["Payment.amount", "FinPaymentAllocation.amount", "FinRefund.amount (DISETUJUI)"],
    tanggal: "Payment.createdAt dan FinRefund.approvedAt (bulan WIB).",
    catatan: [
      "Hanya mencakup order yang punya Payment di ledger; baca bersama `cakupanLedger` sebelum menganggapnya total pemasukan.",
      "Uang pada order PENDING di `uangPadaOrderPending`; pada order CANCELLED di `uangPadaOrderBatal` (tidak masuk uangLedger).",
      "Nilai order lunas (`lunasMenurutCrm.nilai`/`lunasTerbuktiLedger.nilai`) adalah booked value, BUKAN uang; tidak boleh dijumlahkan dengan uangLedger.",
    ],
  },
  {
    id: "cakupan_ledger", status: STATUS.SIAP, label: "Cakupan ledger",
    definisi: "Dari order eligible: `orderBerLedger` (≥ 1 payment dihitung; dipecah `berLedgerCukup`/`berLedgerSebagian`) dan `orderTanpaLedger`; `persenOrderBerLedger` dihitung di respons. Per bulan lead dan per bulan order.",
    sumber: ["Payment (dihitung)"], tanggal: "Bulan lead dan bulan order.",
    catatan: ["Penjelas keterbatasan uang dan lunas terbukti untuk histori."],
  },
  {
    id: "order_dengan_dp", status: STATUS.SEBAGIAN, label: "Order dengan DP (ledger)",
    definisi: "`orderDpSaatIniLedger` = ledger bersih > 0 dan < tagihan; `orderPernahDp` = payment ledger pertama < tagihan. Hanya untuk order ber-ledger.",
    sumber: ["Payment", "tagihanOrder"], tanggal: "Hari WIB payment pertama.",
    catatan: ["Payment.createdAt = waktu dicatat/diverifikasi, belum tentu tanggal uang masuk."],
  },
  {
    id: "atribusi_campaign", status: STATUS.BELUM_ADA_DATA, label: "Atribusi campaign / ad set / ad",
    definisi: "TIDAK dihitung dan TIDAK diisi. Data hanya memuat ctwa_clid + URL kreatif, bukan ID iklan; leadSourceDetail adalah teks kreatif.",
    sumber: ["Customer.ctwaClid", "capture CTWA Fase 0 (belum ditinjau)"], tanggal: "—",
    catatan: ["Menunggu hasil capture dan akses Marketing API."],
  },
]);
