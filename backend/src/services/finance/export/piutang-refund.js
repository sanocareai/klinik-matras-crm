// EXPORT EXCEL — PIUTANG & REFUND. Dua sheet utama, sama dengan dua bagian layar "Piutang Pelanggan":
//   • "Piutang"  ← umurPiutang() di services/finance/reports.js (fungsi yang SAMA dengan GET /api/finance/reports/receivables)
//   • "Refund"   ← ambilDaftarRefund() di services/finance/refundRead.js (fungsi yang SAMA dengan GET /api/finance/refunds)
//   • "Ringkasan Umur" ← kartu ember umur di atas tabel piutang (seluruh piutang, tidak ikut filter/pencarian).
//
// Cara layar memfilter: KEDUANYA di KLIEN (ember umur, sales, umur, acuan, pencarian untuk piutang; status + pencarian untuk refund).
// Karena itu layar mengirim id baris yang TAMPIL (urutan layar): `filter.piutangIds` (orderId) dan `filter.refundIds` (id refund).
// Server memuat ulang lewat fungsi baca yang sama dan menghormati urutan id. Tanpa id → semua baris (pemanggil non-layar).
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { umurPiutang } from "../reports.js";
import { ambilDaftarRefund } from "../refundRead.js";
import { moneyToNumber } from "../money.js";
import { susunLabelFilter, tanggalIndonesiaPendek } from "./excel.js";
import { labelStatus, labelCaraBayar, labelMetodeTransfer } from "./label.js";

const BATAS = 50_001; // 1 lebih dari MAKS_BARIS supaya excel.js menolak dengan pesan jelas, bukan memotong diam-diam
const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// id refund bertipe UUID di database — nilai yang bukan UUID dibuang (kalau tidak, Prisma melempar galat, bukan baris kosong).
const idsAman = (v) => (Array.isArray(v) ? [...new Set(v.map(String).filter((x) => UUID.test(x)))] : null);
// id order bukan selalu UUID; hanya dicocokkan di memori, jadi tidak perlu disaring.
const idsBebas = (v) => (Array.isArray(v) ? [...new Set(v.map(String))] : null);
/** Susun ulang `rows` menurut urutan `ids` (baris yang tidak ada di `ids` dibuang). ids null → apa adanya. */
function menurutIds(rows, ids, kunci) {
  if (!ids) return rows;
  const peta = new Map(rows.map((r) => [r[kunci], r]));
  return ids.map((id) => peta.get(id)).filter(Boolean);
}

async function ambil(db, { filter, periode, filterLabel }) {
  // Layar Piutang memanggil tanpa parameter → posisi per akhir bulan berjalan (default rentangDariQuery). Dipakai fungsi yang sama.
  const { rentangDariQuery } = await import("../../../routes/finance.js");
  const { to } = rentangDariQuery({ to: periode.to ?? filter.to });
  const ar = await umurPiutang(db, { to });

  const piutangIds = idsBebas(filter.piutangIds);
  const refundIds = idsAman(filter.refundIds);

  // ── Piutang ──
  const barisPiutang = menurutIds(ar.baris, piutangIds, "orderId").map((b) => ({
    order: b.orderNumber || "", invoice: b.invoiceNumber || "", pelanggan: b.customerName || "", sales: b.salesName || "",
    nilaiOrder: b.nilaiOrder, sisa: b.sisaTagihan, jatuhTempo: b.dueDate || null,
    acuan: b.sumberJatuhTempo === "invoice" ? "invoice" : "tanggal order",
    umur: b.hariLewat > 0 ? b.hariLewat : 0,
    ember: (ar.ember.find((e) => e.key === b.ember) || {}).label || b.ember,
  }));

  // ── Refund ──
  const refundMentah = await ambilDaftarRefund(db, { ids: refundIds }, { take: BATAS });
  const barisRefund = refundMentah.map((r) => {
    const nominal = moneyToNumber(r.amount);
    const biaya = moneyToNumber(r.transferFeeAmount ?? 0);
    return {
      nomor: r.refundNumber, tanggal: r.date, order: r.order?.orderNumber || "", pelanggan: r.order?.customer?.name || "",
      alasan: r.reason || "", nominal, biaya, totalKeluar: nominal + biaya,
      cara: labelCaraBayar(r.paymentMethod), metodeTransfer: labelMetodeTransfer(r.transferFeeType), rekening: r.cashAccount?.name || "",
      status: labelStatus(r.status), disetujui: r.status === "DISETUJUI", diajukan: r.createdBy?.name || "", waktuDiajukan: r.createdAt,
      penyetuju: r.approvedBy?.name || "", waktuDisetujui: r.approvedAt || null,
      menggantikan: r.replaces?.refundNumber || "", digantiOleh: r.replacedBy?.refundNumber || "",
      alasanTolak: r.status === "DITOLAK" || r.status === "DIBATALKAN" ? (r.rejectReason || "") : "", lampiran: r.attachmentUrl || "", // rejectReason juga menyimpan alasan pembatalan
    };
  });
  const disetujui = barisRefund.filter((r) => r.disetujui);

  // ── Ringkasan umur (kartu di atas tabel piutang: seluruh piutang, bukan yang terfilter) ──
  const ringkasan = [
    { ket: "Total Piutang", jumlah: ar.baris.length, nominal: ar.total },
    ...ar.ember.map((e) => ({ ket: e.label, jumlah: ar.baris.filter((b) => b.ember === e.key).length, nominal: ar.ringkasan?.[e.key] ?? 0 })),
    { ket: "Ditandai Lunas oleh sales (tidak dihitung piutang; menunggu verifikasi finance)", jumlah: ar.menungguVerifikasi?.jumlah ?? 0, nominal: ar.menungguVerifikasi?.total ?? 0 },
  ];

  return {
    nama: "Piutang & Refund",
    periodeLabel: `Piutang per ${tanggalIndonesiaPendek(ar.perTanggal instanceof Date ? ar.perTanggal.toISOString().slice(0, 10) : ar.perTanggal)}`,
    filterLabel: filterLabel || susunLabelFilter([["Piutang", piutangIds ? `${barisPiutang.length} dari ${ar.baris.length} order` : null], ["Refund", refundIds ? `${barisRefund.length} refund` : null]]),
    sheets: [
      {
        nama: "Piutang", judul: "Piutang Pelanggan",
        kolom: [
          { key: "order", header: "No. Order", tipe: "teks", lebar: 20 }, { key: "invoice", header: "No. Invoice", tipe: "teks", lebar: 18 },
          { key: "pelanggan", header: "Pelanggan", tipe: "teks", lebar: 26 }, { key: "sales", header: "Sales", tipe: "teks", lebar: 16 },
          { key: "nilaiOrder", header: "Nilai Order (Rp)", tipe: "uang" }, { key: "sisa", header: "Sisa Tagihan (Rp)", tipe: "uang" },
          { key: "jatuhTempo", header: "Jatuh Tempo", tipe: "tanggal" }, { key: "acuan", header: "Acuan Umur", tipe: "teks", lebar: 14 },
          { key: "umur", header: "Umur (hari lewat jatuh tempo)", tipe: "angka" }, { key: "ember", header: "Kelompok Umur", tipe: "teks", lebar: 20 },
        ],
        baris: barisPiutang,
        total: { label: `TOTAL (${barisPiutang.length} order)`, nilai: { nilaiOrder: jumlah(barisPiutang, "nilaiOrder"), sisa: jumlah(barisPiutang, "sisa") } },
        catatan: [
          "Piutang dihitung dari saldo akun Piutang Usaha per order di buku besar. Order yang belum diserahkan tidak muncul (uangnya masih uang muka).",
          "Umur dihitung dari jatuh tempo invoice bila ada; bila tidak, dari tanggal order (kolom Acuan Umur). Umur 0 = belum jatuh tempo.",
        ],
      },
      {
        nama: "Refund", judul: "Refund ke Pelanggan",
        kolom: [
          { key: "nomor", header: "No. Refund", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" },
          { key: "order", header: "No. Order", tipe: "teks", lebar: 20 }, { key: "pelanggan", header: "Pelanggan", tipe: "teks", lebar: 26 },
          { key: "alasan", header: "Alasan Refund", tipe: "teks", lebar: 36 },
          { key: "nominal", header: "Nominal (Rp)", tipe: "uang" }, { key: "biaya", header: "Biaya Transfer (Rp)", tipe: "uang" },
          { key: "totalKeluar", header: "Total Keluar Rekening (Rp)", tipe: "uang" },
          { key: "cara", header: "Cara Bayar", tipe: "teks", lebar: 12 }, { key: "metodeTransfer", header: "Metode Transfer", tipe: "teks", lebar: 16 },
          { key: "rekening", header: "Rekening Sumber", tipe: "teks", lebar: 22 }, { key: "status", header: "Status", tipe: "teks", lebar: 20 },
          { key: "diajukan", header: "Diajukan Oleh", tipe: "teks", lebar: 18 }, { key: "waktuDiajukan", header: "Tanggal & Jam Diajukan", tipe: "waktu" },
          { key: "penyetuju", header: "Diputuskan Oleh (setuju/tolak)", tipe: "teks", lebar: 18 }, { key: "waktuDisetujui", header: "Tanggal & Jam Keputusan", tipe: "waktu" },
          { key: "menggantikan", header: "Menggantikan Refund", tipe: "teks", lebar: 20 }, { key: "digantiOleh", header: "Diganti Oleh Refund", tipe: "teks", lebar: 20 },
          { key: "alasanTolak", header: "Alasan Penolakan / Pembatalan", tipe: "teks", lebar: 28, sensitif: true },
          { key: "lampiran", header: "Tautan Lampiran", tipe: "teks", lebar: 36, sensitif: true },
        ],
        baris: barisRefund,
        total: { label: `TOTAL disetujui (${disetujui.length} refund)`, nilai: { nominal: jumlah(disetujui, "nominal"), biaya: jumlah(disetujui, "biaya"), totalKeluar: jumlah(disetujui, "totalKeluar") } },
        catatan: ["Baris TOTAL hanya menghitung refund berstatus Disetujui (uang benar-benar keluar). Menunggu persetujuan, Ditolak, dan Dibatalkan/diganti tidak dihitung."],
      },
      {
        nama: "Ringkasan Umur", judul: "Ringkasan Umur Piutang",
        kolom: [
          { key: "ket", header: "Keterangan", tipe: "teks", lebar: 48 }, { key: "jumlah", header: "Jumlah Order", tipe: "angka" }, { key: "nominal", header: "Nominal (Rp)", tipe: "uang" },
        ],
        baris: ringkasan,
        catatan: ["Sama dengan kartu di atas tabel piutang di layar: seluruh piutang terbuka, tidak ikut filter/pencarian."],
      },
    ],
  };
}

export default { kunci: "piutang-refund", nama: "Piutang & Refund", izin: [P.FINANCE_READ], ambil };
