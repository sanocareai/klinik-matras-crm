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
import { PILIH_KREDIT, nilaiBersih, kreditDariRelasi } from "../orderNilaiBersih.js";
import { STATUS_DIHITUNG } from "./journal.js";
import { KEY as KEY_ORDER } from "./posting/orderRevenue.js";

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
  // Penyebab selisih yang SELALU bisa diklasifikasikan (Fase 1b): menggantikan "Selisih Nominal Lain". SELISIH_LAIN hanya menampung sisa yang benar-benar tak terklasifikasi (harus Rp0).
  KLAIM_TANPA_PAYMENT: "KLAIM_TANPA_PAYMENT",
  PAYMENT_MENUNGGU: "PAYMENT_MENUNGGU",
  PAYMENT_KURANG: "PAYMENT_KURANG",
  KELEBIHAN_BAYAR: "KELEBIHAN_BAYAR",
  SELISIH_LAIN: "SELISIH_LAIN",
  TOTAL_PERUSAHAAN: "TOTAL_PERUSAHAAN",
  TANPA_SALES: "TANPA_SALES",
  DIHITUNG_GANDA: "DIHITUNG_GANDA",
  NILAI_LUNAS_SALES: "NILAI_LUNAS_SALES",
  // Jembatan KOHORT (audit 1 Nov 2026): kartu "Sudah Lunas" di Laporan Ringkasan = order DIBUAT di periode yang kini Lunas (basis tanggal dibuat), sedangkan kartu Sales/Finance memakai
  // tanggal MENJADI lunas. Dua populasi berbeda; jembatan ini menyambungkannya sampai nomor order.
  KOHORT_DIBUAT_LUNAS: "KOHORT_DIBUAT_LUNAS",
  KOHORT_LUNAS_DI_LUAR: "KOHORT_LUNAS_DI_LUAR",
  KOHORT_DIBUAT_SEBELUM: "KOHORT_DIBUAT_SEBELUM",
  KOHORT_BELUM_LUNAS_PAIDAT: "KOHORT_BELUM_LUNAS_PAIDAT",
};

/** Status tindakan per penyebab (dipakai kolom "Tindakan" di drill-down & tombol CTA). */
export const TINDAKAN = Object.freeze({
  [KUNCI.PAYMENT_MENUNGGU]: { kode: "TINJAU_PAYMENT_MENUNGGU", label: "Verifikasi Payment" },
  [KUNCI.KLAIM_TANPA_PAYMENT]: { kode: "TINJAU_KLAIM_TANPA_PAYMENT", label: "Tinjau klaim Lunas" },
  [KUNCI.PAYMENT_KURANG]: { kode: "TINJAU_KEKURANGAN", label: "Tagih kekurangan / koreksi" },
  [KUNCI.TANPA_SALES]: { kode: "TETAPKAN_SALES", label: "Tetapkan Sales" },
  [KUNCI.ONGKIR]: { kode: "LIHAT_ONGKIR", label: "Lihat ongkir" },
  [KUNCI.REFUND_NON_LUNAS]: { kode: "TINJAU_REFUND", label: "Tinjau refund" },
  [KUNCI.DIHITUNG_GANDA]: { kode: "TINJAU_DOUBLE_SALES", label: "Tinjau pemilik Sales" },
});
/** Penjelasan awam tiap penyebab untuk kartu "Kenapa angka Finance dan Sales berbeda?". */
export const PENYEBAB = Object.freeze({
  [KUNCI.DP_BELUM_LUNAS]: "Uang muka/DP sudah masuk, tetapi ordernya belum Lunas sehingga belum dihitung sebagai nilai Lunas.",
  [KUNCI.ORDER_TIDAK_DIHITUNG]: "Uang masuk untuk order Batal/Pending/Spam — tidak dihitung sebagai penjualan Lunas.",
  [KUNCI.LUNAS_PERIODE_LAIN]: "Uang masuk periode ini untuk order yang dihitung Lunas di periode lain.",
  [KUNCI.REFUND_NON_LUNAS]: "Refund membuat order keluar dari status Lunas.",
  [KUNCI.DP_SEBELUMNYA]: "DP yang diterima di periode sebelumnya untuk order yang baru Lunas periode ini.",
  [KUNCI.REFUND_LUNAS]: "Refund aktif atas order Lunas mengurangi uang bersih terhadap nilai order.",
  [KUNCI.ONGKIR]: "Ongkir ikut dibayar di Payment, tetapi bukan nilai jasa/order (dasar komisi).",
  [KUNCI.KLAIM_TANPA_PAYMENT]: "Sales menandai Lunas, tetapi belum ada Payment sama sekali — nilai Lunas tercatat tanpa uang terverifikasi.",
  [KUNCI.PAYMENT_MENUNGGU]: "Uang sudah tercatat, tetapi menunggu verifikasi Finance — belum dihitung sebagai uang masuk terverifikasi.",
  [KUNCI.PAYMENT_KURANG]: "Order Lunas, tetapi Payment terverifikasi baru sebagian dari nilai order.",
  [KUNCI.KELEBIHAN_BAYAR]: "Uang terverifikasi lebih besar dari nilai order + ongkir (kelebihan bayar atau pembulatan).",
  [KUNCI.SELISIH_LAIN]: "Sisa yang belum bisa diklasifikasikan. Seharusnya Rp0.",
  [KUNCI.TANPA_SALES]: "Order Lunas tanpa pemilik Sales — masuk Total Perusahaan, tidak masuk angka Tim Sales.",
  [KUNCI.DIHITUNG_GANDA]: "Order dipegang lebih dari satu Sales sehingga nilainya dihitung ganda di laporan per-Sales.",
});

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
    id: true, orderNumber: true, value: true, ongkir: true, status: true, paymentStatus: true, paidAt: true, createdAt: true, groupId: true, salesOwnerId: true, penjualanKaryawanId: true, staffSeller: { select: { name: true } }, ...PILIH_KREDIT,
    group: { select: { id: true, source: true, anchorOrderId: true } },
    customer: { select: { id: true, name: true, pipelineStage: true, assignedSales: { select: { name: true } } } },
  };
  const ordersL = await db.order.findMany({
    // penjualanKaryawanId: null — SAMA dengan tanpaOrderSpam() di routes/analytics.js: order Penjualan Karyawan bukan omzet Sales (nominalnya dikelola Finance), jadi tidak masuk himpunan lunas-periode.
    where: { paidAt: { gte: mulai, lt: selesai }, status: { notIn: OMSET_EXCLUDED_STATUS }, penjualanKaryawanId: null, customer: { pipelineStage: { not: "SPAM" } } },
    select: selectOrder,
  });
  const idL = new Set(ordersL.map((o) => o.id));
  // KOHORT (kartu "Sudah Lunas" di Laporan Ringkasan): order DIBUAT di periode yang kini Lunas — kriteria SAMA dengan business-summary (tanpaOrderSpam + status bukan batal/pending).
  const ordersA = await db.order.findMany({
    where: { createdAt: { gte: mulai, lt: selesai }, status: { notIn: OMSET_EXCLUDED_STATUS }, paymentStatus: "LUNAS", penjualanKaryawanId: null, customer: { pipelineStage: { not: "SPAM" } } },
    select: selectOrder,
  });
  const idA = new Set(ordersA.map((o) => o.id));

  // Order yang menerima uang periode tetapi BUKAN L
  const idLain = [...masuk.keys()].filter((id) => !idL.has(id));
  const ordersLain = idLain.length ? await db.order.findMany({ where: { id: { in: idLain } }, select: selectOrder }) : [];

  // ── DP/uang sebelum periode & refund untuk semua order yang relevan ──
  const idKohortSaja = ordersA.filter((o) => !idL.has(o.id) && !idLain.includes(o.id)).map((o) => o.id);
  const semuaId = [...idL, ...idLain, ...idKohortSaja];
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
  // Semua Payment AKTIF (sudah/belum diverifikasi) sampai akhir periode untuk order relevan → tercatat vs terverifikasi vs menunggu per order.
  const semuaBayar = semuaId.length
    ? await db.payment.findMany({
      where: { cancelledAt: null, createdAt: { lt: selesai }, OR: [{ orderId: { in: semuaId } }, { finAllocations: { some: { orderId: { in: semuaId } } } }] },
      select: { id: true, amount: true, createdAt: true, orderId: true, verifications: { select: { id: true }, take: 1 }, finAllocations: { select: { orderId: true, amount: true } } },
    })
    : [];
  const fin = new Map(); // orderId → { tercatat, terverifikasi, menunggu, tglBayar }
  for (const p of semuaBayar) {
    const verif = p.verifications.length > 0;
    for (const k of kontribusi(p)) {
      if (!semuaId.includes(k.orderId)) continue;
      const cur = fin.get(k.orderId) ?? { tercatat: 0, terverifikasi: 0, menunggu: 0, tglBayar: null };
      cur.tercatat += k.amount; if (verif) cur.terverifikasi += k.amount; else cur.menunggu += k.amount;
      if (!cur.tglBayar || p.createdAt > cur.tglBayar) cur.tglBayar = p.createdAt;
      fin.set(k.orderId, cur);
    }
  }
  // Payment tercatat pada PERIODE (apa pun status verifikasinya, tidak dibatalkan) — untuk kartu "Kenapa angka Finance dan Sales berbeda?".
  const tercatatPeriode = await db.payment.findMany({ where: { cancelledAt: null, createdAt: { gte: mulai, lt: selesai } }, select: { amount: true, verifications: { select: { id: true }, take: 1 } } });
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
  const tglWib = (d) => (d ? new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10) : null);
  const namaSalesOrder = (o) => {
    const ids = o.salesOwnerId ? (namaSales.has(o.salesOwnerId) ? [o.salesOwnerId] : []) : [...(pemegangPercakapan.get(o.customer.id) ?? [])].filter((id) => namaSales.has(id));
    const n = ids.map((id) => namaSales.get(id));
    return n.length ? n.join(", ") : (namaPemegang.get(o.customer.id) || o.customer.assignedSales?.name || null);
  };
  const infoOrder = (o) => {
    const t = tagihanOrder(o, o.group ?? null);
    const f = fin.get(o.id) ?? { tercatat: 0, terverifikasi: 0, menunggu: 0, tglBayar: null };
    const totalTagihan = rp(t);
    return {
      orderId: o.id, nomor: o.orderNumber, pelanggan: o.customer.name, sales: namaSalesOrder(o), status: o.status, statusBayar: o.paymentStatus, nilaiJasa: rp(nilaiBersih(o)), notaKredit: rp(kreditDariRelasi(o)), ongkir: rp(ongkirDitagih(o, o.group ?? null)), totalTagihan,
      paymentTercatat: rp(f.tercatat), paymentTerverifikasi: rp(f.terverifikasi), paymentMenunggu: rp(f.menunggu),
      kurangLebih: rp(f.terverifikasi - totalTagihan), // negatif = kekurangan, positif = kelebihan (dari Payment terverifikasi terhadap total tagihan)
      tanggalBayar: tglWib(f.tglBayar), tanggalLunas: tglWib(o.paidAt), tanggalDibuat: tglWib(o.createdAt),
    };
  };
  const baris = { [KUNCI.UANG_MASUK]: [], [KUNCI.DP_BELUM_LUNAS]: [], [KUNCI.ORDER_TIDAK_DIHITUNG]: [], [KUNCI.LUNAS_PERIODE_LAIN]: [], [KUNCI.REFUND_NON_LUNAS]: [], [KUNCI.DP_SEBELUMNYA]: [], [KUNCI.REFUND_LUNAS]: [], [KUNCI.ONGKIR]: [], [KUNCI.KLAIM_TANPA_PAYMENT]: [], [KUNCI.PAYMENT_MENUNGGU]: [], [KUNCI.PAYMENT_KURANG]: [], [KUNCI.KELEBIHAN_BAYAR]: [], [KUNCI.SELISIH_LAIN]: [], [KUNCI.TANPA_SALES]: [], [KUNCI.DIHITUNG_GANDA]: [], [KUNCI.KOHORT_DIBUAT_LUNAS]: [], [KUNCI.KOHORT_LUNAS_DI_LUAR]: [], [KUNCI.KOHORT_DIBUAT_SEBELUM]: [], [KUNCI.KOHORT_BELUM_LUNAS_PAIDAT]: [] };
  const total = {};
  for (const k of Object.keys(baris)) total[k] = 0;
  const tambah = (kunci, info, jumlah, tambahan = {}) => {
    if (!jumlah) return;
    total[kunci] += jumlah;
    baris[kunci].push({ ...info, jumlah, tindakan: TINDAKAN[kunci] ?? null, ...tambahan });
  };

  // Uang masuk periode (semua order)
  for (const [orderId, m] of masuk) {
    const o = ordersL.find((x) => x.id === orderId) ?? ordersLain.find((x) => x.id === orderId);
    if (!o) continue;
    tambah(KUNCI.UANG_MASUK, infoOrder(o), m.jumlah, { pembayaran: m.pay });
  }

  // Pengecualian lunas (keputusan Owner): order yang tanggal lunasnya DIKUNCI ke periode lain walau uangnya baru masuk sekarang.
  const idLunasLain = ordersLain.filter((o) => o.paymentStatus === "LUNAS" && o.paidAt && (o.paidAt < mulai || o.paidAt >= selesai)).map((o) => o.id);
  const pengecualian = idLunasLain.length
    ? await db.orderPaidAtPengecualian.findMany({ where: { orderId: { in: idLunasLain } }, select: { orderId: true, paidAtDikunci: true, alasan: true, dicabutAt: true, alasanDicabut: true }, orderBy: { createdAt: "asc" } })
    : [];
  const pengecualianPerOrder = new Map(pengecualian.filter((x) => !x.dicabutAt).map((x) => [x.orderId, x]));
  const pengecualianDicabut = new Map(pengecualian.filter((x) => x.dicabutAt).map((x) => [x.orderId, x])); // dicabut: tanggal lunas TIDAK otomatis pindah ke tanggal bayar — wajib terlihat

  // Order bukan-L yang menerima uang periode
  for (const o of ordersLain) {
    const m = masuk.get(o.id);
    const info = infoOrder(o);
    const lunasLain = o.paymentStatus === "LUNAS" && o.paidAt && (o.paidAt < mulai || o.paidAt >= selesai);
    if (OMSET_EXCLUDED_STATUS.includes(o.status) || o.customer.pipelineStage === "SPAM" || o.penjualanKaryawanId) {
      tambah(KUNCI.ORDER_TIDAK_DIHITUNG, info, m.jumlah, { alasan: o.penjualanKaryawanId ? "Order Penjualan Karyawan — di luar omzet Sales" : o.customer.pipelineStage === "SPAM" ? "Pelanggan SPAM" : `Order ${o.status}`, pembayaran: m.pay });
    } else if (refundMap.get(o.id) > 0 && o.paymentStatus !== "LUNAS") {
      tambah(KUNCI.REFUND_NON_LUNAS, info, m.jumlah, { pembayaran: m.pay, refund: refundMap.get(o.id) });
    } else if (lunasLain) {
      const kunci = pengecualianPerOrder.get(o.id);
      tambah(KUNCI.LUNAS_PERIODE_LAIN, info, m.jumlah, {
        pembayaran: m.pay, paidAt: o.paidAt,
        alasan: kunci ? `Tanggal lunas DIKUNCI ke ${tglWib(kunci.paidAtDikunci)} (pengecualian lunas): ${kunci.alasan}`
          : pengecualianDicabut.has(o.id) ? `Pengecualian lunas sudah DICABUT ${tglWib(pengecualianDicabut.get(o.id).dicabutAt)} ("${pengecualianDicabut.get(o.id).alasanDicabut ?? "-"}"), tetapi tanggal lunas tetap ${tglWib(o.paidAt)} — pencabutan tidak memindahkannya ke tanggal pembayaran; perlu keputusan Owner`
          : `Order dihitung lunas pada ${tglWib(o.paidAt)} (di luar periode ini)`,
      });
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
    const nilai = rp(nilaiBersih(o)); // BERSIH dari Nota Kredit aktif — sama dengan angka "Lunas" di Laporan Sales (Okt 2026)
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
    const bayarOrder = masuk.get(o.id)?.pay ?? [];
    if (lain < 0) {
      // KEKURANGAN: tiga sebab yang terbukti dari data — uang tercatat tapi menunggu verifikasi, verifikasi parsial, atau Lunas tanpa Payment sama sekali.
      let kurang = -lain;
      const menunggu = Math.min(kurang, fin.get(o.id)?.menunggu ?? 0);
      if (menunggu > 0) { tambah(KUNCI.PAYMENT_MENUNGGU, info, -menunggu, { alasan: "Payment sudah tercatat tetapi menunggu verifikasi Finance", pembayaran: bayarOrder }); kurang -= menunggu; }
      if (kurang > 0) {
        if (neto <= 0) tambah(KUNCI.KLAIM_TANPA_PAYMENT, info, -kurang, { alasan: "Lunas menurut Sales tanpa Payment terverifikasi", pembayaran: bayarOrder });
        else tambah(KUNCI.PAYMENT_KURANG, info, -kurang, { alasan: "Payment terverifikasi belum menutup nilai order", pembayaran: bayarOrder });
      }
    } else if (lain > 0) {
      tambah(KUNCI.KELEBIHAN_BAYAR, info, lain, { alasan: "Uang terverifikasi melebihi nilai order + ongkir (kelebihan bayar, DP periode lain, atau pembulatan)", pembayaran: bayarOrder });
    }

    const pemilik = salesDari(o);
    if (pemilik.length === 0) {
      const info2 = { ...info, pemegangInformasi: o.staffSeller ? `Penjualan Karyawan · ${o.staffSeller.name}` : o.salesOwnerId ? "Pemilik eksplisit bukan Sales aktif" : (namaPemegang.get(o.customer.id) || o.customer.assignedSales?.name || null) };
      tambah(KUNCI.TANPA_SALES, info2, nilai, { pembayaran: masuk.get(o.id)?.pay ?? [] });
    } else {
      nilaiSalesKartu += nilai * pemilik.length;
      if (pemilik.length > 1) tambah(KUNCI.DIHITUNG_GANDA, info, nilai * (pemilik.length - 1), { sales: pemilik.map((id) => namaSales.get(id)) });
    }
  }

  // ── JEMBATAN KOHORT: "Sudah Lunas" (dibuat di periode) → Total Perusahaan (lunas di periode) ──
  const nilaiA = ordersA.reduce((a, o) => a + rp(nilaiBersih(o)), 0);
  // Dokumen pembayaran order kohort: semua Payment terverifikasi s/d akhir periode (sebelum + dalam periode) supaya drilldown sampai dokumen.
  const payKohort = (o) => [...(pra.get(o.id)?.pay ?? []), ...(masuk.get(o.id)?.pay ?? [])];
  for (const o of ordersA) {
    if (idL.has(o.id)) continue;
    tambah(KUNCI.KOHORT_LUNAS_DI_LUAR, infoOrder(o), rp(nilaiBersih(o)), { pembayaran: payKohort(o), alasan: o.paidAt ? `Berstatus Lunas, tetapi tanggal lunas ${tglWib(o.paidAt)} di luar periode` : "Berstatus Lunas, tetapi tanggal lunas kosong (tidak tercatat)" });
  }
  for (const o of ordersL) {
    if (idA.has(o.id)) continue;
    if (o.createdAt < mulai) tambah(KUNCI.KOHORT_DIBUAT_SEBELUM, infoOrder(o), rp(nilaiBersih(o)), { pembayaran: payKohort(o), alasan: `Dibuat ${tglWib(o.createdAt)} (sebelum periode), lunas ${tglWib(o.paidAt)}` });
    else tambah(KUNCI.KOHORT_BELUM_LUNAS_PAIDAT, infoOrder(o), rp(nilaiBersih(o)), { pembayaran: payKohort(o), alasan: `Dibuat di periode, tanggal lunas ${tglWib(o.paidAt)} terisi, tetapi status bayar sekarang ${o.paymentStatus}` });
  }
  for (const o of ordersA) baris[KUNCI.KOHORT_DIBUAT_LUNAS].push({ ...infoOrder(o), jumlah: rp(nilaiBersih(o)), tindakan: null, pembayaran: payKohort(o) });
  total[KUNCI.KOHORT_DIBUAT_LUNAS] = nilaiA;

  // ── DOKUMEN PEMBAYARAN: lengkapi tiap Payment di jembatan dengan rekening + nomor jurnal supaya angka bisa ditelusuri ke dokumen ──
  const petaPay = new Map();
  for (const arr of Object.values(baris)) for (const r of arr) for (const p of r.pembayaran ?? []) petaPay.set(p.id, p);
  if (petaPay.size) {
    const idPay = [...petaPay.keys()];
    const [infoPay, jurnalPay] = await Promise.all([
      db.payment.findMany({ where: { id: { in: idPay } }, select: { id: true, referenceNumber: true, cashAccount: { select: { name: true } } } }),
      db.finJournalEntry.findMany({ where: { idempotencyKey: { in: idPay.map((i) => KEY_ORDER.payment(i)) }, status: { in: STATUS_DIHITUNG } }, select: { idempotencyKey: true, entryNumber: true } }),
    ]);
    const rekPay = new Map(infoPay.map((x) => [x.id, x]));
    const jurPay = new Map(jurnalPay.map((j) => [j.idempotencyKey, j.entryNumber]));
    for (const [id, p] of petaPay) {
      p.ref = id.slice(0, 8); p.tanggalWib = tglWib(p.tanggal);
      p.rekening = rekPay.get(id)?.cashAccount?.name ?? null; p.referensi = rekPay.get(id)?.referenceNumber ?? null;
      p.nomorJurnal = jurPay.get(KEY_ORDER.payment(id)) ?? null;
    }
  }

  // ── Susun bridge ──
  const M = total[KUNCI.UANG_MASUK];
  const langkah = (kunci, label, tanda, jumlah, ket) => ({ kunci, label, tanda, jumlah: rp(jumlah), keterangan: ket, nOrder: (baris[kunci] ?? []).length });
  const totalPerusahaan = M - total[KUNCI.DP_BELUM_LUNAS] - total[KUNCI.ORDER_TIDAK_DIHITUNG] - total[KUNCI.LUNAS_PERIODE_LAIN] - total[KUNCI.REFUND_NON_LUNAS]
    + total[KUNCI.DP_SEBELUMNYA] - total[KUNCI.REFUND_LUNAS] - total[KUNCI.ONGKIR] - total[KUNCI.KLAIM_TANPA_PAYMENT] - total[KUNCI.PAYMENT_MENUNGGU] - total[KUNCI.PAYMENT_KURANG] - total[KUNCI.KELEBIHAN_BAYAR] - total[KUNCI.SELISIH_LAIN];
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
    langkah(KUNCI.KLAIM_TANPA_PAYMENT, "Klaim Lunas tanpa Payment", -1, total[KUNCI.KLAIM_TANPA_PAYMENT], "Order Lunas menurut Sales, belum ada Payment sama sekali — menambah nilai Lunas di atas uang masuk"),
    langkah(KUNCI.PAYMENT_MENUNGGU, "Payment menunggu verifikasi", -1, total[KUNCI.PAYMENT_MENUNGGU], "Uang sudah tercatat Sales/Driver tetapi belum diverifikasi Finance"),
    langkah(KUNCI.PAYMENT_KURANG, "Payment terverifikasi kurang dari nilai order", -1, total[KUNCI.PAYMENT_KURANG], "Order Lunas, Payment terverifikasi hanya sebagian"),
    langkah(KUNCI.KELEBIHAN_BAYAR, "Kelebihan bayar / DP periode lain", -1, total[KUNCI.KELEBIHAN_BAYAR], "Uang terverifikasi melebihi nilai order + ongkir"),
    langkah(KUNCI.SELISIH_LAIN, "Tak terklasifikasi", -1, total[KUNCI.SELISIH_LAIN], "Sisa yang belum bisa diklasifikasikan (harus Rp0)"),
    langkah(KUNCI.TOTAL_PERUSAHAAN, "Nilai Order yang Menjadi Lunas — Total Perusahaan", 0, totalPerusahaan, "Semua order yang lunas pada periode ini, termasuk yang tanpa Sales"),
    langkah(KUNCI.TANPA_SALES, "Tanpa Atribusi Sales", -1, total[KUNCI.TANPA_SALES], "Order lunas yang tidak dimiliki Sales mana pun (order internal / di luar percakapan Sales)"),
    langkah(KUNCI.DIHITUNG_GANDA, "Dihitung Ganda (order dipegang >1 Sales)", 1, total[KUNCI.DIHITUNG_GANDA], "Laporan per-Sales menghitung order itu untuk tiap Sales yang memegangnya"),
    langkah(KUNCI.NILAI_LUNAS_SALES, "Nilai Order yang Menjadi Lunas (angka Total Tim di laporan Sales)", 0, kartuSales, "Persis angka kartu di laporan Sales"),
  ];

  const kohortLangkah = [
    { kunci: KUNCI.KOHORT_DIBUAT_LUNAS, label: "Sudah Lunas — order dibuat pada periode (kartu \"Sudah Lunas\" di Laporan Ringkasan)", tanda: 0, jumlah: rp(nilaiA), keterangan: "Order DIBUAT di periode yang sekarang berstatus Lunas (basis tanggal dibuat)", nOrder: ordersA.length },
    langkah(KUNCI.KOHORT_LUNAS_DI_LUAR, "Dibuat di periode & Lunas, tetapi tanggal lunas di luar periode / kosong", -1, total[KUNCI.KOHORT_LUNAS_DI_LUAR], "Tidak dihitung sebagai menjadi lunas di periode"),
    langkah(KUNCI.KOHORT_DIBUAT_SEBELUM, "Dibuat sebelum periode, menjadi Lunas di periode", 1, total[KUNCI.KOHORT_DIBUAT_SEBELUM], "Order bulan-bulan lalu yang baru lunas sekarang (lintas bulan)"),
    langkah(KUNCI.KOHORT_BELUM_LUNAS_PAIDAT, "Dibuat di periode, tanggal lunas di periode, tetapi status bayar kini bukan Lunas", 1, total[KUNCI.KOHORT_BELUM_LUNAS_PAIDAT], "Mis. refund/pembatalan setelah lunas yang tidak mengosongkan tanggal lunas"),
    { kunci: KUNCI.TOTAL_PERUSAHAAN, label: "Nilai Order yang Menjadi Lunas — Total Perusahaan", tanda: 0, jumlah: rp(totalNilaiL), keterangan: "Order yang lunas pada periode (basis tanggal lunas)", nOrder: ordersL.length },
  ];
  const residualKohort = rp(nilaiA) - rp(total[KUNCI.KOHORT_LUNAS_DI_LUAR]) + rp(total[KUNCI.KOHORT_DIBUAT_SEBELUM]) + rp(total[KUNCI.KOHORT_BELUM_LUNAS_PAIDAT]) - rp(totalNilaiL);
  const kohort = {
    judul: "Order Dibuat di Periode (Sudah Lunas) → Order yang Menjadi Lunas di Periode (Total Perusahaan)",
    penjelasan: "Dua kartu memakai tanggal berbeda: 'Sudah Lunas' di Laporan Ringkasan menghitung order yang DIBUAT di periode dan kini Lunas; 'Nilai Order yang Menjadi Lunas' menghitung order yang LUNAS di periode, termasuk order lama.",
    mulai: kohortLangkah[0], akhir: kohortLangkah[kohortLangkah.length - 1], langkah: kohortLangkah,
    pembanding: { label: "Σ nilai order lunas (dihitung langsung)", jumlah: rp(totalNilaiL) },
    residual: residualKohort,
    status: { perhitungan: residualKohort === 0 ? "COCOK" : "TIDAK_COCOK", perhitunganLabel: residualKohort === 0 ? "Perhitungan cocok" : "Perhitungan tidak cocok" },
  };

  const residual = rp(kartuSales) - rp(nilaiSalesKartu); // bridge vs hitungan langsung Σ value×jumlah Sales — HARUS 0
  const ringkas = (arr) => arr.map((b) => ({ ...b }));

  // ── DUA TAHAP (Fase 1 — Kontrak Angka): dua pertanyaan berbeda, dua residual, dua status — supaya "perhitungan cocok" tidak tercampur dengan "perlu ditinjau" ──
  //   Tahap 1: Uang Masuk Terverifikasi → Nilai Order Lunas Total Perusahaan.  Pembanding independen = Σ Order.value order lunas-periode dihitung LANGSUNG (totalNilaiL).
  //   Tahap 2: Total Perusahaan → Nilai Tim Sales.                              Pembanding independen = Σ Order.value × jumlah Sales pemilik (nilaiSalesKartu).
  //   Status "Perhitungan cocok" = residual Rp0 (matematis; tak ada uang/order yang hilang dari jembatan).
  //   Status "Perlu ditinjau"    = ada data yang butuh keputusan manusia walau perhitungannya cocok (mis. Lunas tanpa Payment penuh, order tanpa Sales).
  const residual1 = rp(totalPerusahaan) - rp(totalNilaiL);
  const residual2 = rp(totalNilaiL - total[KUNCI.TANPA_SALES] + total[KUNCI.DIHITUNG_GANDA]) - rp(nilaiSalesKartu);
  const urutan1 = [KUNCI.UANG_MASUK, KUNCI.DP_BELUM_LUNAS, KUNCI.ORDER_TIDAK_DIHITUNG, KUNCI.LUNAS_PERIODE_LAIN, KUNCI.REFUND_NON_LUNAS, KUNCI.DP_SEBELUMNYA, KUNCI.REFUND_LUNAS, KUNCI.ONGKIR, KUNCI.KLAIM_TANPA_PAYMENT, KUNCI.PAYMENT_MENUNGGU, KUNCI.PAYMENT_KURANG, KUNCI.KELEBIHAN_BAYAR, KUNCI.SELISIH_LAIN, KUNCI.TOTAL_PERUSAHAAN];
  const urutan2 = [KUNCI.TOTAL_PERUSAHAAN, KUNCI.TANPA_SALES, KUNCI.DIHITUNG_GANDA, KUNCI.NILAI_LUNAS_SALES];
  const ambilLangkah = (urutan) => urutan.map((k) => langkahBridge.find((b) => b.kunci === k));
  // Baris bernilai Rp0 dan tanpa order TIDAK ditampilkan satu per satu; digabung ke "Komponen lain" (nama-namanya tetap tercantum, bukan dibuang).
  const lipatNol = (arr) => {
    const ujung = new Set([arr[0].kunci, arr[arr.length - 1].kunci]);
    const nol = arr.filter((b) => !ujung.has(b.kunci) && b.jumlah === 0 && b.nOrder === 0);
    return { langkah: arr.filter((b) => !nol.includes(b)), komponenLain: { jumlah: 0, nOrder: 0, daftar: nol.map((b) => b.label) } };
  };
  const susunTahap = (nomor, judul, urutan, pembanding, residualTahap, tinjau) => {
    const semua = ambilLangkah(urutan);
    const { langkah: tampil, komponenLain } = lipatNol(semua);
    return {
      nomor, judul,
      mulai: semua[0], akhir: semua[semua.length - 1],
      langkah: tampil, komponenLain,
      pembanding: { label: nomor === 1 ? "Σ nilai order lunas (dihitung langsung)" : "Σ nilai order × jumlah Sales pemilik (dihitung langsung)", jumlah: rp(pembanding) },
      residual: residualTahap,
      status: { perhitungan: residualTahap === 0 ? "COCOK" : "TIDAK_COCOK", perhitunganLabel: residualTahap === 0 ? "Perhitungan cocok" : "Perhitungan tidak cocok", perluDitinjau: tinjau.length > 0, perluDitinjauLabel: tinjau.length > 0 ? "Perlu ditinjau" : "Tidak ada yang perlu ditinjau", alasanTinjau: tinjau },
    };
  };
  const tinjau1 = [];
  for (const k of [KUNCI.KLAIM_TANPA_PAYMENT, KUNCI.PAYMENT_MENUNGGU, KUNCI.PAYMENT_KURANG, KUNCI.SELISIH_LAIN]) {
    if (baris[k].length) tinjau1.push({ kunci: k, nOrder: baris[k].length, jumlah: rp(total[k]), alasan: { [KUNCI.KLAIM_TANPA_PAYMENT]: "Order Lunas menurut Sales tanpa Payment — tinjau klaim, minta bukti, atau tolak", [KUNCI.PAYMENT_MENUNGGU]: "Payment tercatat menunggu verifikasi Finance", [KUNCI.PAYMENT_KURANG]: "Payment terverifikasi belum menutup nilai order — tagih kekurangan atau koreksi", [KUNCI.SELISIH_LAIN]: "Selisih belum terklasifikasi — hubungi admin" }[k] });
  }
  if (baris[KUNCI.REFUND_NON_LUNAS].length) tinjau1.push({ kunci: KUNCI.REFUND_NON_LUNAS, nOrder: baris[KUNCI.REFUND_NON_LUNAS].length, jumlah: rp(total[KUNCI.REFUND_NON_LUNAS]), alasan: "Refund membuat order keluar dari status lunas" });
  const tinjau2 = [];
  if (baris[KUNCI.TANPA_SALES].length) tinjau2.push({ kunci: KUNCI.TANPA_SALES, nOrder: baris[KUNCI.TANPA_SALES].length, jumlah: rp(total[KUNCI.TANPA_SALES]), alasan: "Order lunas tanpa pemilik Sales — tetapkan pemilik bila memang closing Sales" });
  if (baris[KUNCI.DIHITUNG_GANDA].length) tinjau2.push({ kunci: KUNCI.DIHITUNG_GANDA, nOrder: baris[KUNCI.DIHITUNG_GANDA].length, jumlah: rp(total[KUNCI.DIHITUNG_GANDA]), alasan: "Order dipegang lebih dari satu Sales sehingga nilainya dihitung ganda di laporan per-Sales" });
  const tahap1 = susunTahap(1, "Uang Masuk Terverifikasi → Nilai Order Lunas (Total Perusahaan)", urutan1, totalNilaiL, residual1, tinjau1);
  const tahap2 = susunTahap(2, "Total Perusahaan → Nilai Order Lunas Tim Sales", urutan2, nilaiSalesKartu, residual2, tinjau2);

  // ── KARTU "Kenapa angka Finance dan Sales berbeda?" — SATU sumber dengan bridge, drill-down, dan Export Excel ──
  const bukanMenunggu = tercatatPeriode.filter((p) => p.verifications.length === 0);
  const sumP = (arr) => arr.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const efek = (kunci) => { const b = langkahBridge.find((x) => x.kunci === kunci); return b.tanda * b.jumlah; };
  const penyebabKunci = [KUNCI.DP_BELUM_LUNAS, KUNCI.ORDER_TIDAK_DIHITUNG, KUNCI.LUNAS_PERIODE_LAIN, KUNCI.REFUND_NON_LUNAS, KUNCI.DP_SEBELUMNYA, KUNCI.REFUND_LUNAS, KUNCI.ONGKIR, KUNCI.KLAIM_TANPA_PAYMENT, KUNCI.PAYMENT_MENUNGGU, KUNCI.PAYMENT_KURANG, KUNCI.KELEBIHAN_BAYAR, KUNCI.SELISIH_LAIN];
  const penyebab = penyebabKunci.map((k) => ({
    kunci: k, label: langkahBridge.find((x) => x.kunci === k).label, efek: rp(efek(k)), arah: efek(k) > 0 ? "MENAMBAH" : "MENGURANGI", nOrder: baris[k].length, jumlah: rp(Math.abs(total[k])),
    penjelasan: PENYEBAB[k], tindakan: TINDAKAN[k] ?? null, bisaDibuka: baris[k].length > 0,
  })).filter((p) => p.nOrder > 0 || p.efek !== 0).sort((a, b) => Math.abs(b.efek) - Math.abs(a.efek));
  const penyebabTim = [KUNCI.TANPA_SALES, KUNCI.DIHITUNG_GANDA].map((k) => ({
    kunci: k, label: langkahBridge.find((x) => x.kunci === k).label, efek: rp(efek(k)), arah: efek(k) > 0 ? "MENAMBAH" : "MENGURANGI", nOrder: baris[k].length, jumlah: rp(Math.abs(total[k])),
    penjelasan: PENYEBAB[k], tindakan: TINDAKAN[k] ?? null, bisaDibuka: baris[k].length > 0,
  })).filter((p) => p.nOrder > 0);
  const selisih = rp(totalPerusahaan) - rp(M);
  const tidakTerklasifikasi = rp(total[KUNCI.SELISIH_LAIN]) !== 0;
  const kodeStatus = residual1 !== 0 || residual2 !== 0 || residualKohort !== 0 || tidakTerklasifikasi ? "TIDAK_COCOK" : selisih === 0 && penyebab.length === 0 ? "COCOK" : "TERJELASKAN";
  const LABEL_STATUS = { COCOK: "Cocok", TERJELASKAN: "Berbeda tetapi terjelaskan", TIDAK_COCOK: "Tidak cocok" };
  const kartuSelisih = {
    tercatat: { jumlah: rp(sumP(tercatatPeriode)), nPayment: tercatatPeriode.length, menunggu: { jumlah: rp(sumP(bukanMenunggu)), nPayment: bukanMenunggu.length } },
    terverifikasi: { jumlah: rp(M), nPayment: tercatatPeriode.length - bukanMenunggu.length },
    klaimLunas: { jumlah: rp(totalPerusahaan), nOrder: ordersL.length, keterangan: "Nilai order yang menjadi Lunas pada periode (Total Perusahaan)" },
    selisih: { jumlah: selisih, keterangan: "Nilai Lunas − Uang masuk terverifikasi" },
    penyebab, jumlahPenyebab: penyebab.length,
    tim: { jumlah: rp(kartuSales), selisihDariTotal: rp(kartuSales) - rp(totalPerusahaan), penyebab: penyebabTim },
    residual: { tahap1: residual1, tahap2: residual2, kohort: residualKohort, nol: residual1 === 0 && residual2 === 0 && residualKohort === 0, terklasifikasiPenuh: !tidakTerklasifikasi },
    status: { kode: kodeStatus, label: LABEL_STATUS[kodeStatus] },
    tindakLanjut: [KUNCI.PAYMENT_MENUNGGU, KUNCI.KLAIM_TANPA_PAYMENT, KUNCI.PAYMENT_KURANG, KUNCI.TANPA_SALES, KUNCI.ONGKIR].map((k) => ({ kunci: k, label: TINDAKAN[k].label, kode: TINDAKAN[k].kode, nOrder: baris[k].length, jumlah: rp(Math.abs(total[k])) })).filter((t) => t.nOrder > 0),
  };

  const hasil = {
    periode: { from, to },
    bridge: langkahBridge,
    kartuSelisih,
    residual,
    tahap1, tahap2, kohort,
    status: { perhitungan: residual1 === 0 && residual2 === 0 && residualKohort === 0 ? "COCOK" : "TIDAK_COCOK", perluDitinjau: tinjau1.length + tinjau2.length > 0 },
    metrikKunci: { uangMasuk: "uang_masuk_terverifikasi", totalPerusahaan: "nilai_order_lunas_perusahaan", tim: "nilai_lunas_tim_sales", tanpaSales: "tanpa_atribusi_sales" },
    kartu: {
      uangMasukDariOrder: rp(M),
      dpBelumLunas: rp(total[KUNCI.DP_BELUM_LUNAS]), jumlahOrderDp: baris[KUNCI.DP_BELUM_LUNAS].length,
      ongkirDiterima: rp(total[KUNCI.ONGKIR]),
      tanpaAtribusiSales: rp(total[KUNCI.TANPA_SALES]), jumlahOrderTanpaSales: baris[KUNCI.TANPA_SALES].length,
      totalPerusahaan: rp(totalPerusahaan),
      nilaiLunasSales: rp(kartuSales),
      sudahLunasKohortDibuat: rp(nilaiA), jumlahOrderKohortDibuat: ordersA.length,
    },
    detailTersedia: denganDetail,
  };
  if (denganDetail) {
    hasil.detail = {};
    for (const [kunci, arr] of Object.entries(baris)) hasil.detail[kunci] = ringkas(arr);
  }
  return hasil;
}
