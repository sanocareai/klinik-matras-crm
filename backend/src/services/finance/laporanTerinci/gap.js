// DAFTAR PEMERIKSAAN GAP PEMBUKUAN (BACA-SAJA) — "N transaksi belum bisa dibukukan" menjadi daftar yang bisa diperiksa satu per satu.
//
// Dua daftar, sengaja terpisah:
//   1. GAP RESMI  (FinPostingGap terbuka) — jumlahnya SAMA dengan banner "N transaksi belum bisa dibukukan" (catatanLaporan.gapTerbuka). Dibedakan:
//        BELUM_BERHARGA          order yang benar-benar belum punya harga (value Rp0, tanpa item) — pengakuan pendapatan tidak bisa diposting sampai harga diisi;
//        PKR_OPERASIONAL_RP0     order operasional hasil sinkronisasi PKR yang memang bernilai Rp0 (nominal & pendapatan ada di dokumen PKR) — bukan kekurangan harga;
//        LAINNYA                 gap sumber/alasan lain (mis. rekening belum dipetakan) — ditampilkan apa adanya dengan detail sistem.
//   2. TANPA GAP — order yang statusnya sudah diserahkan tetapi tidak pernah diakui dan TIDAK tercatat sebagai gap (celah pengaman), relevan untuk periode (lunas atau diserahkan di periode).
// Tidak ada perbaikan otomatis: modul ini hanya membaca.

import { STATUS_DIHITUNG } from "../journal.js";
import { sumMoney, moneyToNumber, toMoney } from "../money.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../../../utils/wib.js";
import { tanggalWIB } from "../cutoff.js";
import { STATUS_PENGAKUAN } from "../posting/orderRevenue.js";

const rp = (d) => moneyToNumber(d);
const JENIS_LABEL = Object.freeze({
  BELUM_BERHARGA: "Order belum punya harga", PKR_OPERASIONAL_RP0: "Order operasional PKR Rp0 (bukan kekurangan harga)", LAINNYA: "Gap pembukuan lain",
  DISERAHKAN_BELUM_DIAKUI: "Diserahkan, tidak pernah diakui, tanpa gap",
});

export async function hitungGap(tx, { fromStr, toStr, catatan }) {
  const gaps = await tx.finPostingGap.findMany({ where: { resolvedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const idOrder = [...new Set(gaps.filter((g) => g.source === "PENGAKUAN_PENDAPATAN").map((g) => g.sourceId))];
  const selectOrder = {
    id: true, orderNumber: true, category: true, status: true, paymentStatus: true, value: true, ongkir: true, createdAt: true, paidAt: true, penjualanKaryawanId: true,
    customer: { select: { name: true } }, _count: { select: { items: true, units: true } },
  };
  const [orders, bayar, jobs] = await Promise.all([
    idOrder.length ? tx.order.findMany({ where: { id: { in: idOrder } }, select: selectOrder }) : [],
    idOrder.length ? tx.payment.findMany({ where: { orderId: { in: idOrder }, cancelledAt: null }, select: { orderId: true, amount: true, verifications: { select: { id: true } } } }) : [],
    idOrder.length ? tx.job.findMany({ where: { orderId: { in: idOrder }, type: "DELIVERY", status: "COMPLETED" }, select: { orderId: true, completedAt: true } }) : [],
  ]);
  const peta = new Map(orders.map((o) => [o.id, o]));
  const serah = new Map();
  for (const j of jobs) { if (!j.completedAt) continue; const t = tanggalWIB(j.completedAt); if (!serah.has(j.orderId) || t > serah.get(j.orderId)) serah.set(j.orderId, t); }
  const verifikasi = new Map(); const nBayar = new Map();
  for (const p of bayar) { nBayar.set(p.orderId, (nBayar.get(p.orderId) ?? 0) + 1); if (p.verifications.length) verifikasi.set(p.orderId, (verifikasi.get(p.orderId) ?? toMoney(0)).plus(p.amount)); }

  const daftar = gaps.map((g, i) => {
    const o = g.source === "PENGAKUAN_PENDAPATAN" ? peta.get(g.sourceId) : null;
    let jenis = "LAINNYA";
    if (o) {
      if (o.penjualanKaryawanId) jenis = "PKR_OPERASIONAL_RP0";
      else if (g.reason === "NILAI_ORDER_NOL" && rp(toMoney(o.value)) === 0) jenis = "BELUM_BERHARGA";
    }
    const terverifikasi = o ? rp(verifikasi.get(o.id) ?? toMoney(0)) : 0;
    const lunasTanpaBayar = !!o && o.paymentStatus === "LUNAS" && terverifikasi === 0;
    const tindakan = jenis === "BELUM_BERHARGA" ? "Admin/Sales mengisi item layanan dan harga order; setelah itu pengakuan pendapatan dapat diposting dengan tanggal yang disepakati Owner. JANGAN diposting dari laporan ini."
      : jenis === "PKR_OPERASIONAL_RP0" ? "Tidak ada harga yang kurang: pendapatan dan piutang dicatat di dokumen PKR. Gap ini perlu ditutup administratif (bukan jurnal baru)."
        : "Periksa detail sistem dan petakan/selesaikan sumbernya, lalu coba posting ulang lewat alur resmi.";
    const dampak = jenis === "BELUM_BERHARGA"
      ? { pendapatan: "Pendapatan kurang sebesar harga yang belum diisi (nominal tidak terbukti — nilai order Rp0).", hpp: "Tidak langsung.", beban: "Tidak.", labaRugi: "Laba bersih kurang dari seharusnya sebesar pendapatan yang belum diakui.", neraca: lunasTanpaBayar ? "Order berstatus Lunas tanpa pembayaran: piutang/uang muka belum tercatat." : "Piutang usaha belum tercatat." }
      : jenis === "PKR_OPERASIONAL_RP0" ? { pendapatan: "Tidak ada (sudah di PKR).", hpp: "Tidak.", beban: "Tidak.", labaRugi: "Tidak ada pengaruh.", neraca: "Tidak ada." }
        : { pendapatan: "Tergantung sumber.", hpp: "Tergantung sumber.", beban: "Tergantung sumber.", labaRugi: "Lihat detail.", neraca: "Lihat detail." };
    return {
      no: i + 1, gapId: g.id, sumber: g.source, sumberId: g.sourceId, alasanKode: g.reason, detailSistem: g.detail, tanggalGap: tanggalWIB(g.createdAt),
      jenis, jenisLabel: JENIS_LABEL[jenis], tindakan, dampak,
      order: o ? {
        nomor: o.orderNumber, kategori: o.category, status: o.status, statusBayar: o.paymentStatus, pelanggan: o.customer?.name ?? "", nilai: rp(toMoney(o.value)), ongkir: rp(toMoney(o.ongkir)),
        jumlahItem: o._count.items, jumlahUnit: o._count.units, tanggalOrder: tanggalWIB(o.createdAt), tanggalLunas: o.paidAt ? tanggalWIB(o.paidAt) : null, tanggalSerah: serah.get(o.id) ?? null,
        pembayaranTerverifikasi: terverifikasi, jumlahPembayaran: nBayar.get(o.id) ?? 0, lunasTanpaPembayaran: lunasTanpaBayar,
      } : null,
      akunSemestinya: o ? (o.category === "SEWA" ? "4-1300 Pendapatan Sewa" : o.category === "BARU" ? "4-1200 Pendapatan Penjualan Produk" : o.category === "LAYANAN" ? "4-1100 Pendapatan Jasa Layanan" : null) : null,
    };
  });

  // 2. Tanpa gap
  const mulai = startOfDayWIB(fromStr); const selesai = endOfDayExclusiveWIB(toStr);
  const kandidat = await tx.order.findMany({
    where: {
      status: { in: STATUS_PENGAKUAN }, penjualanKaryawanId: null,
      OR: [{ paidAt: { gte: mulai, lt: selesai } }, { jobs: { some: { type: "DELIVERY", status: "COMPLETED", completedAt: { gte: mulai, lt: selesai } } } }],
    },
    select: selectOrder,
  });
  const idK = kandidat.map((o) => o.id);
  const [akui, akuiLine, jobK] = await Promise.all([
    idK.length ? tx.finJournalEntry.findMany({ where: { sourceId: { in: idK }, status: { in: STATUS_DIHITUNG }, OR: [{ source: "PENGAKUAN_PENDAPATAN" }, { idempotencyKey: { startsWith: "PENGAKUAN_PENDAPATAN:" } }] }, select: { sourceId: true } }) : [],
    idK.length ? tx.finJournalLine.findMany({ where: { orderId: { in: idK }, entry: { status: { in: STATUS_DIHITUNG }, OR: [{ source: "PENGAKUAN_PENDAPATAN" }, { idempotencyKey: { startsWith: "PENGAKUAN_PENDAPATAN:" } }] } }, select: { orderId: true } }) : [],
    idK.length ? tx.job.findMany({ where: { orderId: { in: idK }, type: "DELIVERY", status: "COMPLETED" }, select: { orderId: true, completedAt: true } }) : [],
  ]);
  const sudah = new Set([...akui.map((e) => e.sourceId), ...akuiLine.map((l) => l.orderId)]);
  const adaGap = new Set(gaps.map((g) => g.sourceId));
  const serahK = new Map();
  for (const j of jobK) { if (!j.completedAt) continue; const t = tanggalWIB(j.completedAt); if (!serahK.has(j.orderId) || t > serahK.get(j.orderId)) serahK.set(j.orderId, t); }
  const tanpaGap = kandidat.filter((o) => !sudah.has(o.id) && !adaGap.has(o.id) && rp(toMoney(o.value)) + rp(toMoney(o.ongkir)) > 0).map((o) => ({
    nomor: o.orderNumber, kategori: o.category, status: o.status, statusBayar: o.paymentStatus, pelanggan: o.customer?.name ?? "", nilai: rp(toMoney(o.value)), ongkir: rp(toMoney(o.ongkir)),
    tanggalLunas: o.paidAt ? tanggalWIB(o.paidAt) : null, tanggalSerah: serahK.get(o.id) ?? null, jenis: "DISERAHKAN_BELUM_DIAKUI", jenisLabel: JENIS_LABEL.DISERAHKAN_BELUM_DIAKUI,
    tindakan: "Selidiki kenapa hook pengakuan tidak jalan (order dibuat langsung berstatus diserahkan / sebelum cutoff). Pengakuan harus lewat jurnal terkendali dengan tanggal yang disetujui Owner — bukan dari laporan ini.",
    dampak: `Pendapatan kurang ${rp(toMoney(o.value)) + rp(toMoney(o.ongkir))} bila order ini memang sah; uang yang sudah masuk berdiri sebagai Uang Muka Pelanggan.`,
  }));

  return {
    jumlahTerbuka: daftar.length, sesuaiBanner: daftar.length === (catatan?.gapTerbuka ?? daftar.length),
    ringkasanJenis: Object.entries(daftar.reduce((a, g) => { a[g.jenis] = (a[g.jenis] ?? 0) + 1; return a; }, {})).map(([jenis, n]) => ({ jenis, label: JENIS_LABEL[jenis], jumlah: n })),
    daftar, tanpaGap,
    catatan: "Daftar pemeriksaan, bukan antrean perbaikan: tidak ada tombol yang memposting jurnal dari sini.",
  };
}
