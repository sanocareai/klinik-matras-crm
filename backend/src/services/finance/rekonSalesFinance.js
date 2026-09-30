// REKONSILIASI SALES–FINANCE (30 Sep 2026) — SATU helper server untuk bridge "Uang Masuk Terverifikasi" → "Nilai Order yang Menjadi Lunas".
// Dipakai panel Rekonsiliasi di Laporan Sales, kartu-kartunya, drill-down, dan Export Excel (frontend TIDAK menghitung ulang).
//
// Dua sisi yang direkonsiliasi (periode = tanggal WIB [from, to], batas eksklusif awal hari berikutnya, sama dengan laporan Sales):
//   FINANCE : Σ Payment aktif TERVERIFIKASI yang diterima dalam periode (kontribusi per order: alokasi kanonis bila ada, kalau tidak nominal penuh ke order).
//   SALES   : Σ Order.value order yang paidAt-nya jatuh dalam periode (status bukan CANCELLED/PENDING, pelanggan bukan SPAM), dihitung PER SALES pemiliknya
//             (pemilik eksplisit salesOwnerId menang; kosong → percakapan INDIVIDUAL yang dipegang Sales) — persis definisi kartu "Nilai ... Lunas" di analytics.js.
//
// Identitas (per order lunas-periode L; neto = Payment terverifikasi s/d akhir periode − refund):
//   value = uang masuk periode + DP sebelum periode − refund − ongkir diterima − selisih lain
// sehingga:  Uang Masuk − DP belum lunas − (order batal/pending/spam) − (order lunas periode lain) − (refund order non-lunas)
//            + DP periode sebelumnya − refund atas order lunas − ongkir − selisih lain  =  Σ value(L) = TOTAL PERUSAHAAN
//            − Tanpa Sales + dihitung ganda  =  angka kartu Sales.  Residual dihitung dan dilaporkan (harus 0).

import { startOfDayWIB, endOfDayExclusiveWIB } from "../../utils/wib.js";
import { ongkirDitagih, tagihanOrder } from "./tagihanOrder.js";

const OMSET_EXCLUDED_STATUS = ["CANCELLED", "PENDING"]; // sama dengan analytics.js
const STATUS_REFUND_AKTIF_TIDAK = ["DITOLAK", "DIBATALKAN"];

const rp = (n) => Math.round(Number(n) || 0);

export const KUNCI = {
  UANG_MASUK: "UANG_MASUK",
  DP_BELUM_LUNAS: "DP_BELUM_LUNAS",
  ORDER_TIDAK_DIHITUNG: "ORDER_TIDAK_DIHITUNG",
  LUNAS_PERIODE_LAIN: "LUNAS_PERIODE_LAIN",
  REFUND_NON_LUNAS: "REFUND_NON_LUNAS",
  DP_SEBELUMNYA: "DP_SEBELUMNYA",
  REFUND_LUNAS: "REFUND_LUNAS",
  ONGKIR: "ONGKIR",
  SELISIH_LAIN: "SELISIH_LAIN",
  TOTAL_PERUSAHAAN: "TOTAL_PERUSAHAAN",
  TANPA_SALES: "TANPA_SALES",
  DIHITUNG_GANDA: "DIHITUNG_GANDA",
  NILAI_LUNAS_SALES: "NILAI_LUNAS_SALES",
};

/**
 * @param db        klien Prisma
 * @param opts      { from, to } — "YYYY-MM-DD" WIB (wajib)
 * @param opts.denganDetail  sertakan daftar order penyusun tiap baris (Finance/Admin saja)
 */
export async function rekonSalesFinance(db, { from, to, denganDetail = false } = {}) {
  if (!from || !to) throw Object.assign(new Error("Periode (from/to) wajib diisi"), { statusCode: 400 });
  const mulai = startOfDayWIB(from);
  const selesai = endOfDayExclusiveWIB(to);

  // ── Yang dijumlahkan kartu "Nilai ... Lunas Tim" di laporan Sales: Sales aktif (peran utama SALES) + closing pribadi Team Lead (isSalesTeamLead) ──
  const salesUsers = await db.user.findMany({ where: { active: true, OR: [{ role: "SALES" }, { isSalesTeamLead: true }] }, select: { id: true, name: true } });
  const namaSales = new Map(salesUsers.map((u) => [u.id, u.name]));

  // ── Payment aktif terverifikasi diterima dalam periode + kontribusi per order ──
  const bayarPeriode = await db.payment.findMany({
    where: { cancelledAt: null, createdAt: { gte: mulai, lt: selesai }, verifications: { some: {} } },
    select: { id: true, amount: true, createdAt: true, method: true, orderId: true, finAllocations: { select: { orderId: true, amount: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const kontribusi = (p) => (p.finAllocations.length > 0 ? p.finAllocations.map((a) => ({ orderId: a.orderId, amount: rp(a.amount) })) : [{ orderId: p.orderId, amount: rp(p.amount) }]);
  const masuk = new Map(); // orderId → { jumlah, pay: [{id, tanggal, nominal, metode}] }
  for (const p of bayarPeriode) {
    for (const k of kontribusi(p)) {
      const cur = masuk.get(k.orderId) ?? { jumlah: 0, pay: [] };
      cur.jumlah += k.amount;
      cur.pay.push({ id: p.id, tanggal: p.createdAt, nominal: k.amount, metode: p.method });
      masuk.set(k.orderId, cur);
    }
  }

  // ── Order lunas-periode (L) — definisi Sales ──
  const selectOrder = {
    id: true, orderNumber: true, value: true, ongkir: true, status: true, paymentStatus: true, paidAt: true, groupId: true, salesOwnerId: true,
    group: { select: { id: true, source: true, anchorOrderId: true } },
    customer: { select: { id: true, name: true, pipelineStage: true, assignedSales: { select: { name: true } } } },
  };
  const ordersL = await db.order.findMany({
    where: { paidAt: { gte: mulai, lt: selesai }, status: { notIn: OMSET_EXCLUDED_STATUS }, customer: { pipelineStage: { not: "SPAM" } } },
    select: selectOrder,
  });
  const idL = new Set(ordersL.map((o) => o.id));

  // Order yang menerima uang periode tetapi BUKAN L
  const idLain = [...masuk.keys()].filter((id) => !idL.has(id));
  const ordersLain = idLain.length ? await db.order.findMany({ where: { id: { in: idLain } }, select: selectOrder }) : [];

  // ── DP/uang sebelum periode & refund untuk semua order yang relevan ──
  const semuaId = [...idL, ...idLain];
  const bayarSebelum = semuaId.length
    ? await db.payment.findMany({
      where: { cancelledAt: null, createdAt: { lt: mulai }, verifications: { some: {} }, OR: [{ orderId: { in: semuaId } }, { finAllocations: { some: { orderId: { in: semuaId } } } }] },
      select: { id: true, amount: true, createdAt: true, method: true, orderId: true, finAllocations: { select: { orderId: true, amount: true } } },
    })
    : [];
  const pra = new Map();
  for (const p of bayarSebelum) {
    for (const k of kontribusi(p)) {
      if (!semuaId.includes(k.orderId)) continue;
      const cur = pra.get(k.orderId) ?? { jumlah: 0, pay: [] };
      cur.jumlah += k.amount;
      cur.pay.push({ id: p.id, tanggal: p.createdAt, nominal: k.amount, metode: p.method });
      pra.set(k.orderId, cur);
    }
  }
  const refunds = semuaId.length
    ? await db.finRefund.groupBy({ by: ["orderId"], where: { orderId: { in: semuaId }, status: { notIn: STATUS_REFUND_AKTIF_TIDAK } }, _sum: { amount: true } })
    : [];
  const refundMap = new Map(refunds.map((r) => [r.orderId, rp(r._sum.amount)]));

  // ── Atribusi Sales (pemilik eksplisit menang; kosong → percakapan INDIVIDUAL yang dipegang Sales) ──
  const idTanpaPemilik = ordersL.filter((o) => !o.salesOwnerId).map((o) => o.customer.id);
  const percakapan = idTanpaPemilik.length
    ? await db.conversation.findMany({ where: { type: "INDIVIDUAL", customerId: { in: idTanpaPemilik }, assignedToId: { not: null } }, select: { customerId: true, assignedToId: true, assignedTo: { select: { name: true } } } })
    : [];
  const pemegangPercakapan = new Map(); // customerId → Set(userId)
  const namaPemegang = new Map();       // customerId → nama (informasi, bukan atribusi)
  for (const c of percakapan) {
    if (!pemegangPercakapan.has(c.customerId)) pemegangPercakapan.set(c.customerId, new Set());
    pemegangPercakapan.get(c.customerId).add(c.assignedToId);
    if (!namaPemegang.has(c.customerId)) namaPemegang.set(c.customerId, c.assignedTo?.name ?? null);
  }
  const salesDari = (o) => {
    if (o.salesOwnerId) return namaSales.has(o.salesOwnerId) ? [o.salesOwnerId] : []; // pemilik eksplisit bukan Sales aktif → tidak dihitung ke Sales mana pun
    return [...(pemegangPercakapan.get(o.customer.id) ?? [])].filter((id) => namaSales.has(id));
  };

  // ── Bangun baris per order ──
  const infoOrder = (o) => {
    const t = tagihanOrder(o, o.group ?? null);
    return { orderId: o.id, nomor: o.orderNumber, pelanggan: o.customer.name, status: o.status, statusBayar: o.paymentStatus, nilaiJasa: rp(o.value), ongkir: rp(ongkirDitagih(o, o.group ?? null)), totalTagihan: rp(t) };
  };
  const baris = { [KUNCI.UANG_MASUK]: [], [KUNCI.DP_BELUM_LUNAS]: [], [KUNCI.ORDER_TIDAK_DIHITUNG]: [], [KUNCI.LUNAS_PERIODE_LAIN]: [], [KUNCI.REFUND_NON_LUNAS]: [], [KUNCI.DP_SEBELUMNYA]: [], [KUNCI.REFUND_LUNAS]: [], [KUNCI.ONGKIR]: [], [KUNCI.SELISIH_LAIN]: [], [KUNCI.TANPA_SALES]: [], [KUNCI.DIHITUNG_GANDA]: [] };
  const total = {};
  for (const k of Object.keys(baris)) total[k] = 0;
  const tambah = (kunci, info, jumlah, tambahan = {}) => {
    if (!jumlah) return;
    total[kunci] += jumlah;
    baris[kunci].push({ ...info, jumlah, ...tambahan });
  };

  // Uang masuk periode (semua order)
  for (const [orderId, m] of masuk) {
    const o = ordersL.find((x) => x.id === orderId) ?? ordersLain.find((x) => x.id === orderId);
    if (!o) continue;
    tambah(KUNCI.UANG_MASUK, infoOrder(o), m.jumlah, { pembayaran: m.pay });
  }

  // Order bukan-L yang menerima uang periode
  for (const o of ordersLain) {
    const m = masuk.get(o.id);
    const info = infoOrder(o);
    const lunasLain = o.paymentStatus === "LUNAS" && o.paidAt && (o.paidAt < mulai || o.paidAt >= selesai);
    if (OMSET_EXCLUDED_STATUS.includes(o.status) || o.customer.pipelineStage === "SPAM") {
      tambah(KUNCI.ORDER_TIDAK_DIHITUNG, info, m.jumlah, { alasan: o.customer.pipelineStage === "SPAM" ? "Pelanggan SPAM" : `Order ${o.status}`, pembayaran: m.pay });
    } else if (refundMap.get(o.id) > 0 && o.paymentStatus !== "LUNAS") {
      tambah(KUNCI.REFUND_NON_LUNAS, info, m.jumlah, { pembayaran: m.pay, refund: refundMap.get(o.id) });
    } else if (lunasLain) {
      tambah(KUNCI.LUNAS_PERIODE_LAIN, info, m.jumlah, { pembayaran: m.pay, paidAt: o.paidAt });
    } else {
      // DP / parsial: order belum lunas (atau lunas di periode berikutnya). Sertakan pembayaran sebelumnya agar terlihat total DP order ini.
      tambah(KUNCI.DP_BELUM_LUNAS, info, m.jumlah, { pembayaran: m.pay, dibayarTotal: m.jumlah + (pra.get(o.id)?.jumlah ?? 0), sisaTagihan: Math.max(rp(tagihanOrder(o, o.group ?? null)) - (m.jumlah + (pra.get(o.id)?.jumlah ?? 0)), 0) });
    }
  }

  // Order lunas-periode (L): DP sebelum periode, refund, ongkir, selisih lain, atribusi
  let totalNilaiL = 0;
  let nilaiSalesKartu = 0;
  for (const o of ordersL) {
    const info = infoOrder(o);
    const nilai = rp(o.value);
    totalNilaiL += nilai;
    const inPeriode = masuk.get(o.id)?.jumlah ?? 0;
    const sebelum = pra.get(o.id)?.jumlah ?? 0;
    const refund = refundMap.get(o.id) ?? 0;
    const neto = inPeriode + sebelum - refund;
    const lebih = neto - nilai;
    const ongkirBagian = Math.min(Math.max(lebih, 0), info.ongkir);
    const lain = lebih - ongkirBagian; // bisa NEGATIF: order Lunas tetapi uang terverifikasi belum menutup nilai order
    tambah(KUNCI.DP_SEBELUMNYA, info, sebelum, { pembayaran: pra.get(o.id)?.pay ?? [] });
    tambah(KUNCI.REFUND_LUNAS, info, refund);
    tambah(KUNCI.ONGKIR, info, ongkirBagian, { pembayaran: masuk.get(o.id)?.pay ?? [] });
    tambah(KUNCI.SELISIH_LAIN, info, lain, { alasan: lain < 0 ? (neto <= 0 ? "Lunas menurut Sales tanpa Payment terverifikasi" : "Payment terverifikasi belum menutup nilai order") : "Kelebihan bayar / pembulatan", pembayaran: masuk.get(o.id)?.pay ?? [] });

    const pemilik = salesDari(o);
    if (pemilik.length === 0) {
      const info2 = { ...info, pemegangInformasi: o.salesOwnerId ? "Pemilik eksplisit bukan Sales aktif" : (namaPemegang.get(o.customer.id) || o.customer.assignedSales?.name || null) };
      tambah(KUNCI.TANPA_SALES, info2, nilai, { pembayaran: masuk.get(o.id)?.pay ?? [] });
    } else {
      nilaiSalesKartu += nilai * pemilik.length;
      if (pemilik.length > 1) tambah(KUNCI.DIHITUNG_GANDA, info, nilai * (pemilik.length - 1), { sales: pemilik.map((id) => namaSales.get(id)) });
    }
  }

  // ── Susun bridge ──
  const M = total[KUNCI.UANG_MASUK];
  const langkah = (kunci, label, tanda, jumlah, ket) => ({ kunci, label, tanda, jumlah: rp(jumlah), keterangan: ket, nOrder: (baris[kunci] ?? []).length });
  const totalPerusahaan = M - total[KUNCI.DP_BELUM_LUNAS] - total[KUNCI.ORDER_TIDAK_DIHITUNG] - total[KUNCI.LUNAS_PERIODE_LAIN] - total[KUNCI.REFUND_NON_LUNAS]
    + total[KUNCI.DP_SEBELUMNYA] - total[KUNCI.REFUND_LUNAS] - total[KUNCI.ONGKIR] - total[KUNCI.SELISIH_LAIN];
  const kartuSales = totalPerusahaan - total[KUNCI.TANPA_SALES] + total[KUNCI.DIHITUNG_GANDA];

  const langkahBridge = [
    langkah(KUNCI.UANG_MASUK, "Uang Masuk Terverifikasi", 0, M, "Payment aktif terverifikasi yang diterima pada periode ini"),
    langkah(KUNCI.DP_BELUM_LUNAS, "DP / Parsial Belum Lunas", -1, total[KUNCI.DP_BELUM_LUNAS], "Uang masuk untuk order yang belum lunas pada periode ini"),
    langkah(KUNCI.ORDER_TIDAK_DIHITUNG, "Order Batal / Pending / Spam", -1, total[KUNCI.ORDER_TIDAK_DIHITUNG], "Tidak dihitung sebagai penjualan"),
    langkah(KUNCI.LUNAS_PERIODE_LAIN, "Pembayaran untuk Order Lunas di Periode Lain", -1, total[KUNCI.LUNAS_PERIODE_LAIN], "Order-nya dihitung lunas di periode lain"),
    langkah(KUNCI.REFUND_NON_LUNAS, "Refund pada Order yang Kembali Belum Lunas", -1, total[KUNCI.REFUND_NON_LUNAS], "Refund membuat order keluar dari status lunas"),
    langkah(KUNCI.DP_SEBELUMNYA, "DP Periode Sebelumnya (order yang lunas periode ini)", 1, total[KUNCI.DP_SEBELUMNYA], "Uang yang sudah diterima sebelum periode untuk order yang baru lunas sekarang"),
    langkah(KUNCI.REFUND_LUNAS, "Penyesuaian Refund / Reversal", -1, total[KUNCI.REFUND_LUNAS], "Refund aktif atas order yang lunas"),
    langkah(KUNCI.ONGKIR, "Ongkir Diterima", -1, total[KUNCI.ONGKIR], "Ongkir ikut Payment tetapi bukan nilai jasa/order"),
    langkah(KUNCI.SELISIH_LAIN, "Selisih Nominal Lain", -1, total[KUNCI.SELISIH_LAIN], "Kelebihan bayar/pembulatan (+) atau Lunas tanpa uang terverifikasi penuh (−)"),
    langkah(KUNCI.TOTAL_PERUSAHAAN, "Nilai Order yang Menjadi Lunas — Total Perusahaan", 0, totalPerusahaan, "Semua order yang lunas pada periode ini, termasuk yang tanpa Sales"),
    langkah(KUNCI.TANPA_SALES, "Tanpa Atribusi Sales", -1, total[KUNCI.TANPA_SALES], "Order lunas yang tidak dimiliki Sales mana pun (order internal / di luar percakapan Sales)"),
    langkah(KUNCI.DIHITUNG_GANDA, "Dihitung Ganda (order dipegang >1 Sales)", 1, total[KUNCI.DIHITUNG_GANDA], "Laporan per-Sales menghitung order itu untuk tiap Sales yang memegangnya"),
    langkah(KUNCI.NILAI_LUNAS_SALES, "Nilai Order yang Menjadi Lunas (angka Total Tim di laporan Sales)", 0, kartuSales, "Persis angka kartu di laporan Sales"),
  ];

  const residual = rp(kartuSales) - rp(nilaiSalesKartu); // bridge vs hitungan langsung Σ value×jumlah Sales — HARUS 0
  const ringkas = (arr) => arr.map((b) => ({ ...b }));
  const hasil = {
    periode: { from, to },
    bridge: langkahBridge,
    residual,
    kartu: {
      uangMasukDariOrder: rp(M),
      dpBelumLunas: rp(total[KUNCI.DP_BELUM_LUNAS]), jumlahOrderDp: baris[KUNCI.DP_BELUM_LUNAS].length,
      ongkirDiterima: rp(total[KUNCI.ONGKIR]),
      tanpaAtribusiSales: rp(total[KUNCI.TANPA_SALES]), jumlahOrderTanpaSales: baris[KUNCI.TANPA_SALES].length,
      totalPerusahaan: rp(totalPerusahaan),
      nilaiLunasSales: rp(kartuSales),
    },
    detailTersedia: denganDetail,
  };
  if (denganDetail) {
    hasil.detail = {};
    for (const [kunci, arr] of Object.entries(baris)) hasil.detail[kunci] = ringkas(arr);
  }
  return hasil;
}
