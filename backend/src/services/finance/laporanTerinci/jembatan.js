// JEMBATAN OMZET SALES (LUNAS) → PENDAPATAN BERSIH FINANCE (BACA-SAJA).
//
// Dua angka yang berbeda DASARNYA, bukan salah hitung:
//   Omzet Sales  = Σ NILAI BERSIH order yang menjadi LUNAS pada periode (paidAt WIB): Order.value − Nota Kredit aktif (orderNilaiBersih.js) — definisi kartu "Nilai ... Lunas"
//                  yang sama dengan dashboard Sales/komisi. Nota Kredit ditampilkan sebagai LANGKAH EKSPLISIT saat jembatan kembali ke nilai kotor ledger.
//   Pendapatan   = jurnal buku besar (akrual): diakui saat order DISERAHKAN, bukan saat lunas (posting/orderRevenue.js).
// Jembatan ini mengelompokkan SETIAP order & baris jurnal pendapatan ke tepat satu komponen, lalu memeriksa dua residual yang WAJIB Rp0:
//   residual Sales   = omzet (agregat database) − Σ nilai order empat kelas Lunas-periode;
//   residual Ledger  = pendapatan bruto/retur/bersih menurut labaRugi() − Σ komponen jembatan.
// Residual tidak nol = ada baris yang tidak terklasifikasi (bug atau data aneh) dan DITAMPILKAN, tidak disembunyikan. Tidak ada angka yang dipaksa sama.
//
// Kelas order (per order, urutan prioritas):
//   LUNAS_DIAKUI                 Lunas periode ini DAN ada jurnal pendapatan di periode ini
//   LUNAS_DIAKUI_SEBELUM         Lunas periode ini, pendapatannya SUDAH diakui sebelum periode
//   LUNAS_BELUM_DISERAHKAN       Lunas periode ini, belum diserahkan (uangnya kewajiban Uang Muka)
//   LUNAS_DISERAHKAN_BELUM_DIAKUI Lunas periode ini, sudah berstatus diserahkan tetapi TIDAK PERNAH ada jurnal pengakuan (temuan, bukan wajar)
//   DIAKUI_LUNAS_LAIN            Tidak lunas periode ini, diakui di periode ini, order berstatus Lunas (DP/lunas di periode lain)
//   DIAKUI_BELUM_LUNAS           Diakui periode ini, belum lunas (piutang)
//   PEMBALIK_PENGAKUAN_LAMA      Hanya ada pembalik (order dibatalkan) atas pengakuan periode lain
//   LAIN_TERTAUT                 Sisanya yang punya baris jurnal tetapi tidak cocok kelas di atas (harus kosong)

import { STATUS_DIHITUNG } from "../journal.js";
import { sumMoney, moneyToNumber, toMoney } from "../money.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../../../utils/wib.js";
import { tanggalWIB } from "../cutoff.js";
import { STATUS_PENGAKUAN } from "../posting/orderRevenue.js";
import { aggregateBersih, nilaiBersihPerOrder } from "../../orderNilaiBersih.js";

export const KELAS = Object.freeze({
  LUNAS_DIAKUI: "LUNAS_DIAKUI",
  LUNAS_DIAKUI_SEBELUM: "LUNAS_DIAKUI_SEBELUM",
  LUNAS_BELUM_DISERAHKAN: "LUNAS_BELUM_DISERAHKAN",
  LUNAS_DISERAHKAN_BELUM_DIAKUI: "LUNAS_DISERAHKAN_BELUM_DIAKUI",
  DIAKUI_LUNAS_LAIN: "DIAKUI_LUNAS_LAIN",
  DIAKUI_BELUM_LUNAS: "DIAKUI_BELUM_LUNAS",
  PEMBALIK_PENGAKUAN_LAMA: "PEMBALIK_PENGAKUAN_LAMA",
  LAIN_TERTAUT: "LAIN_TERTAUT",
});

const KETERANGAN = Object.freeze({
  [KELAS.LUNAS_DIAKUI]: "Lunas dan diserahkan pada periode ini: nilai order menjadi pendapatan periode ini.",
  [KELAS.LUNAS_DIAKUI_SEBELUM]: "Lunas periode ini, tetapi pendapatannya sudah diakui sebelum periode (diserahkan lebih dulu).",
  [KELAS.LUNAS_BELUM_DISERAHKAN]: "Sudah lunas, belum diserahkan: uangnya berdiri sebagai Uang Muka Pelanggan (kewajiban), bukan pendapatan.",
  [KELAS.LUNAS_DISERAHKAN_BELUM_DIAKUI]: "TEMUAN: order sudah berstatus diserahkan dan lunas, tetapi tidak pernah ada jurnal pengakuan pendapatan (dan tidak ada gap). Uangnya tertahan di Uang Muka.",
  [KELAS.DIAKUI_LUNAS_LAIN]: "Diserahkan periode ini, tetapi lunas di periode lain (DP/pelunasan sebelumnya): pendapatan periode ini, bukan omzet Lunas periode ini.",
  [KELAS.DIAKUI_BELUM_LUNAS]: "Diserahkan periode ini, belum lunas: pendapatan akrual yang masih menjadi piutang.",
  [KELAS.PEMBALIK_PENGAKUAN_LAMA]: "Pengakuan periode lain dibalik karena order dibatalkan — pembaliknya jatuh di periode ini.",
  [KELAS.LAIN_TERTAUT]: "Order punya jurnal pendapatan tetapi tidak cocok kelas mana pun — perlu diperiksa.",
});

const ALASAN_ORDER = Object.freeze({
  [KELAS.LUNAS_BELUM_DISERAHKAN]: (o) => `Status order ${o.status} — belum diserahkan, pendapatan belum boleh diakui.`,
  [KELAS.LUNAS_DISERAHKAN_BELUM_DIAKUI]: (o) => `Status ${o.status} tetapi tak ada jurnal pengakuan; pembayaran masuk Uang Muka.`,
  [KELAS.LUNAS_DIAKUI_SEBELUM]: () => "Diakui sebelum periode; lunas di periode ini.",
});

const dec = (n) => toMoney(n ?? 0);
const rp = (d) => moneyToNumber(d);

/**
 * @param tx       klien Prisma (transaksi snapshot)
 * @param opts     { fromStr, toStr, baris, ringkasan }  baris = muatBarisLabaRugi(); ringkasan = labaRugi().ringkasan
 */
export async function hitungJembatan(tx, { fromStr, toStr, baris, ringkasan }) {
  const mulai = startOfDayWIB(fromStr); const selesai = endOfDayExclusiveWIB(toStr);
  const whereLunas = { paidAt: { gte: mulai, lt: selesai }, status: { notIn: ["CANCELLED", "PENDING"] }, customer: { pipelineStage: { not: "SPAM" } } };
  const selectOrder = {
    id: true, orderNumber: true, category: true, status: true, paymentStatus: true, value: true, ongkir: true, paidAt: true, createdAt: true, penjualanKaryawanId: true,
    customer: { select: { name: true } },
  };

  const [lunas, omzetDb] = await Promise.all([
    tx.order.findMany({ where: whereLunas, select: selectOrder }),
    aggregateBersih(tx, { where: whereLunas, _sum: { value: true }, _count: { _all: true } }),
  ]);

  const barisPend = baris.filter((r) => r.akunTipe === "PENDAPATAN");
  const idLunas = new Set(lunas.map((o) => o.id));
  const idJurnal = [...new Set(barisPend.map((r) => r.orderId).filter(Boolean))];
  const idLain = idJurnal.filter((id) => !idLunas.has(id));
  const lainMentah = idLain.length ? await tx.order.findMany({ where: { id: { in: idLain } }, select: selectOrder }) : [];
  // Nota Kredit aktif per order → nilaiBersih (dipakai omzet Sales) dan notaKredit (langkah eksplisit jembatan).
  const orders = new Map((await nilaiBersihPerOrder(tx, [...lunas, ...lainMentah])).map((o) => [o.id, o]));
  const semuaId = [...orders.keys()];

  // Pengakuan KAPAN PUN (termasuk piutang awal SALDO_AWAL) + tanggal serah dari job selesai — hanya untuk order yang relevan.
  const [pengakuan, pengakuanKey, jobs] = await Promise.all([
    semuaId.length ? tx.finJournalEntry.findMany({
      where: { sourceId: { in: semuaId }, status: { in: STATUS_DIHITUNG }, OR: [{ source: "PENGAKUAN_PENDAPATAN" }, { idempotencyKey: { startsWith: "PENGAKUAN_PENDAPATAN:" } }] },
      select: { sourceId: true, entryNumber: true, date: true, source: true },
    }) : [],
    semuaId.length ? tx.finJournalLine.findMany({
      where: { orderId: { in: semuaId }, entry: { status: { in: STATUS_DIHITUNG }, OR: [{ source: "PENGAKUAN_PENDAPATAN" }, { idempotencyKey: { startsWith: "PENGAKUAN_PENDAPATAN:" } }] } },
      select: { orderId: true, entry: { select: { entryNumber: true, date: true, source: true } } },
    }) : [],
    semuaId.length ? tx.job.findMany({ where: { orderId: { in: semuaId }, type: "DELIVERY", status: "COMPLETED" }, select: { orderId: true, completedAt: true } }) : [],
  ]);
  const pengakuanAda = new Map(); // orderId → [{nomor,tanggal}]
  const catat = (id, nomor, date) => { const a = pengakuanAda.get(id) ?? []; if (!a.some((x) => x.nomor === nomor)) a.push({ nomor, tanggal: new Date(date).toISOString().slice(0, 10) }); pengakuanAda.set(id, a); };
  pengakuan.forEach((e) => catat(e.sourceId, e.entryNumber, e.date));
  pengakuanKey.forEach((l) => catat(l.orderId, l.entry.entryNumber, l.entry.date));
  const serah = new Map();
  for (const j of jobs) { if (!j.completedAt) continue; const t = tanggalWIB(j.completedAt); if (!serah.has(j.orderId) || t > serah.get(j.orderId)) serah.set(j.orderId, t); }

  // Baris pendapatan per order
  const perOrder = new Map();
  for (const r of barisPend) { if (!r.orderId) continue; const a = perOrder.get(r.orderId) ?? []; a.push(r); perOrder.set(r.orderId, a); }
  const kredit = (r) => r.normal === "KREDIT";

  const detail = []; // satu entri per order terklasifikasi
  for (const o of orders.values()) {
    const rows = perOrder.get(o.id) ?? [];
    const lunasP = idLunas.has(o.id);
    const bruto = sumMoney(rows.filter(kredit).map((r) => r.efek));
    const retur = sumMoney(rows.filter((r) => !kredit(r)).map((r) => -r.efek));
    const pengakuanP = rows.filter((r) => r.sumber === "PENGAKUAN_PENDAPATAN");
    const pembalik = rows.filter((r) => r.sumber === "REVERSAL");
    const ongkirRows = sumMoney(rows.filter((r) => kredit(r) && r.akunKode === "4-1900").map((r) => r.efek));
    const sebelum = (pengakuanAda.get(o.id) ?? []).filter((p) => p.tanggal < fromStr);
    const adaPengakuan = (pengakuanAda.get(o.id) ?? []).length > 0;
    const diserahkan = STATUS_PENGAKUAN.includes(o.status);
    let kelas = null;
    if (o.penjualanKaryawanId) kelas = rows.length ? KELAS.LAIN_TERTAUT : null;
    else if (lunasP) {
      if (!bruto.isZero() || pengakuanP.length) kelas = KELAS.LUNAS_DIAKUI;
      else if (!adaPengakuan) kelas = diserahkan ? KELAS.LUNAS_DISERAHKAN_BELUM_DIAKUI : KELAS.LUNAS_BELUM_DISERAHKAN;
      else kelas = KELAS.LUNAS_DIAKUI_SEBELUM;
    } else if (rows.length) {
      if (pembalik.length && !pengakuanP.length) kelas = KELAS.PEMBALIK_PENGAKUAN_LAMA;
      else if (!bruto.isZero() || pengakuanP.length) kelas = o.paymentStatus === "LUNAS" ? KELAS.DIAKUI_LUNAS_LAIN : KELAS.DIAKUI_BELUM_LUNAS;
      else kelas = KELAS.LAIN_TERTAUT;
    }
    if (!kelas) continue;
    detail.push({
      kelas, orderId: o.id, nomor: o.orderNumber, kategori: o.category, status: o.status, statusBayar: o.paymentStatus, pelanggan: o.customer?.name ?? "",
      nilai: rp(dec(o.nilaiBersih)), notaKredit: rp(dec(o.notaKredit)), nilaiKotor: o.value, ongkir: rp(dec(o.ongkir)), lunasPeriode: lunasP,
      tanggalOrder: tanggalWIB(o.createdAt), tanggalLunas: o.paidAt ? tanggalWIB(o.paidAt) : null, tanggalSerah: serah.get(o.id) ?? null,
      jurnalPeriode: [...new Set(rows.map((r) => r.nomorJurnal))],
      tanggalJurnal: [...new Set(rows.map((r) => r.tanggal))], akun: [...new Set(rows.map((r) => r.akunKode))],
      bruto: rp(bruto), retur: rp(retur), neto: rp(bruto.minus(retur)), ongkirDiakui: rp(ongkirRows),
      manual: rp(sumMoney(rows.filter((r) => r.sumber === "MANUAL").map((r) => r.efek))),
      pengakuanSebelum: sebelum.map((p) => p.nomor),
      tanggalBeda: !!pengakuanP.length && serah.has(o.id) && pengakuanP.some((r) => r.tanggal !== serah.get(o.id)),
      alasan: ALASAN_ORDER[kelas] ? ALASAN_ORDER[kelas](o) : "",
    });
  }
  const dari = (kelas) => detail.filter((d) => d.kelas === kelas);
  const jml = (arr, f) => rp(sumMoney(arr.map(f)));
  const komp = (kelas, extra = {}) => { const a = dari(kelas); return { kunci: kelas, jumlahOrder: a.length, nilaiOrder: jml(a, (d) => d.nilai), notaKredit: jml(a, (d) => d.notaKredit), bruto: jml(a, (d) => d.bruto), neto: jml(a, (d) => d.neto), keterangan: KETERANGAN[kelas], orders: a, ...extra }; };
  const A = komp(KELAS.LUNAS_DIAKUI); const B = komp(KELAS.LUNAS_DIAKUI_SEBELUM); const C = komp(KELAS.LUNAS_BELUM_DISERAHKAN); const D = komp(KELAS.LUNAS_DISERAHKAN_BELUM_DIAKUI);
  const E = komp(KELAS.DIAKUI_LUNAS_LAIN); const F = komp(KELAS.DIAKUI_BELUM_LUNAS); const H = komp(KELAS.PEMBALIK_PENGAKUAN_LAMA); const X = komp(KELAS.LAIN_TERTAUT);

  // Sisi ledger yang tidak tertaut order biasa
  const pkrRows = barisPend.filter((r) => r.sumber === "PENJUALAN_KARYAWAN" && kredit(r));
  const tanpaOrder = barisPend.filter((r) => !r.orderId && r.sumber !== "PENJUALAN_KARYAWAN" && kredit(r));
  const returSemua = barisPend.filter((r) => !kredit(r));
  const pkrBruto = sumMoney(pkrRows.map((r) => r.efek));
  const tanpaOrderBruto = sumMoney(tanpaOrder.map((r) => r.efek));
  const returTotal = sumMoney(returSemua.map((r) => -r.efek));
  // Baris order tertaut PKR (order CRM operasional) masuk LAIN_TERTAUT; jangan terhitung ganda dengan PKR.
  const ongkirA = jml(A.orders, (d) => d.ongkirDiakui);
  const nilaiA = A.nilaiOrder;
  // Ledger mengakui nilai KOTOR (Dr Piutang / Cr Pendapatan); Nota Kredit muncul terpisah di 4-2100. Jadi dari nilai bersih Sales ke bruto ledger ada langkah "+ Nota Kredit".
  const notaKreditA = A.notaKredit;
  const selisihA = rp(dec(A.bruto).minus(dec(nilaiA)).minus(dec(notaKreditA)).minus(dec(ongkirA)));

  const omzet = rp(dec(omzetDb._sum.value ?? 0));
  const residualSales = rp(dec(omzet).minus(dec(A.nilaiOrder + B.nilaiOrder + C.nilaiOrder + D.nilaiOrder)));
  const brutoOrder = sumMoney([A.bruto, E.bruto, F.bruto, H.bruto, X.bruto]);
  const brutoKomponen = brutoOrder.plus(pkrBruto).plus(tanpaOrderBruto);
  const residualBruto = rp(dec(ringkasan.pendapatanBruto).minus(brutoKomponen));
  const residualRetur = rp(dec(ringkasan.retur).minus(returTotal));
  const bersihJembatan = brutoKomponen.minus(returTotal);
  const residualBersih = rp(dec(ringkasan.pendapatanBersih).minus(bersihJembatan));

  const manualRows = barisPend.filter((r) => r.sumber === "MANUAL");
  const langkah = [
    { kunci: "omzet", label: "Omzet Sales: nilai bersih order yang menjadi Lunas pada periode (setelah Nota Kredit)", tanda: 0, nominal: omzet, jumlahOrder: omzetDb._count._all, keterangan: "Σ (Order.value − Nota Kredit aktif), paidAt WIB di periode, status bukan Batal/Pending, pelanggan bukan Spam (nilai layanan, tanpa ongkir). Sama dengan angka Sales/komisi.", bagian: "SALES" },
    { kunci: C.kunci, label: "− Lunas, belum diserahkan", tanda: -1, nominal: -C.nilaiOrder, jumlahOrder: C.jumlahOrder, keterangan: C.keterangan, bagian: "SALES" },
    { kunci: D.kunci, label: "− Lunas & diserahkan, tidak pernah diakui", tanda: -1, nominal: -D.nilaiOrder, jumlahOrder: D.jumlahOrder, keterangan: D.keterangan, bagian: "SALES", temuan: D.jumlahOrder > 0 },
    { kunci: B.kunci, label: "− Lunas, pendapatannya sudah diakui sebelum periode", tanda: -1, nominal: -B.nilaiOrder, jumlahOrder: B.jumlahOrder, keterangan: B.keterangan, bagian: "SALES" },
    { kunci: "nilai_diakui", label: "= Nilai order Lunas periode ini yang diakui sebagai pendapatan", tanda: 0, nominal: nilaiA, jumlahOrder: A.jumlahOrder, keterangan: "Subtotal; setara kelas \"Lunas & diakui\".", bagian: "SALES", subtotal: true },
    { kunci: "nota_kredit", label: "+ Nota Kredit aktif pada order tersebut (kembali ke nilai kotor; potongannya tampil di Retur & Potongan)", tanda: 1, nominal: notaKreditA, jumlahOrder: A.orders.filter((d) => d.notaKredit !== 0).length, keterangan: "Ledger mengakui pendapatan sebesar nilai kotor order; Nota Kredit mengurangi omzet Sales tetapi dicatat sebagai potongan (4-2100), bukan mengurangi pengakuan.", bagian: "LEDGER" },
    { kunci: "ongkir", label: "+ Ongkos kirim yang diakui (4-1900)", tanda: 1, nominal: ongkirA, jumlahOrder: A.orders.filter((d) => d.ongkirDiakui !== 0).length, keterangan: "Ongkir bukan Order.value, tetapi pendapatan di buku besar.", bagian: "LEDGER" },
    { kunci: "selisih_nilai", label: "± Selisih nilai order vs jurnal (penyesuaian)", tanda: 1, nominal: selisihA, jumlahOrder: A.orders.filter((d) => d.manual !== 0).length, keterangan: "Jurnal penyesuaian nilai/ pembulatan pada order kelas ini; 0 bila nilai order sama dengan pengakuan.", bagian: "LEDGER" },
    { kunci: "bruto_A", label: "= Bruto ledger dari order Lunas & diakui periode ini", tanda: 0, nominal: A.bruto, jumlahOrder: A.jumlahOrder, keterangan: "Subtotal ledger kelas pertama.", bagian: "LEDGER", subtotal: true },
    { kunci: E.kunci, label: "+ Diakui periode ini, lunas di periode lain", tanda: 1, nominal: E.bruto, jumlahOrder: E.jumlahOrder, keterangan: E.keterangan, bagian: "LEDGER" },
    { kunci: F.kunci, label: "+ Diakui periode ini, belum lunas (piutang)", tanda: 1, nominal: F.bruto, jumlahOrder: F.jumlahOrder, keterangan: F.keterangan, bagian: "LEDGER" },
    { kunci: H.kunci, label: "− Pembalik pengakuan periode lain (order dibatalkan)", tanda: -1, nominal: H.bruto, jumlahOrder: H.jumlahOrder, keterangan: H.keterangan, bagian: "LEDGER" },
    ...(X.jumlahOrder ? [{ kunci: X.kunci, label: "Order tertaut lain (periksa)", tanda: 1, nominal: X.bruto, jumlahOrder: X.jumlahOrder, keterangan: X.keterangan, bagian: "LEDGER", temuan: true }] : []),
    { kunci: "bruto_order", label: "= Pendapatan bruto dari order", tanda: 0, nominal: rp(brutoOrder), jumlahOrder: A.jumlahOrder + E.jumlahOrder + F.jumlahOrder + H.jumlahOrder + X.jumlahOrder, keterangan: "Subtotal sebelum PKR dan jurnal tanpa order.", bagian: "LEDGER", subtotal: true },
    { kunci: "pkr", label: "+ Penjualan Karyawan (PKR) — terpisah, 4-1250", tanda: 1, nominal: rp(pkrBruto), jumlahOrder: new Set(pkrRows.map((r) => r.nomorJurnal)).size, keterangan: "Diakui saat dokumen PKR dibuat, bukan saat serah. Rincian di tab PKR.", bagian: "LEDGER" },
    ...(tanpaOrder.length ? [{ kunci: "tanpa_order", label: "+ Jurnal pendapatan tanpa order (manual/lain)", tanda: 1, nominal: rp(tanpaOrderBruto), jumlahOrder: new Set(tanpaOrder.map((r) => r.nomorJurnal)).size, keterangan: "Jurnal pendapatan yang tidak tertaut order dan bukan PKR.", bagian: "LEDGER", temuan: true }] : []),
    { kunci: "bruto", label: "= Pendapatan bruto (buku besar)", tanda: 0, nominal: rp(brutoKomponen), jumlahOrder: null, keterangan: "Sama dengan Σ akun pendapatan saldo-normal kredit di Laba Rugi.", bagian: "LEDGER", subtotal: true },
    { kunci: "retur", label: "− Retur & Potongan Penjualan (4-2100)", tanda: -1, nominal: -rp(returTotal), jumlahOrder: new Set(returSemua.map((r) => r.nomorJurnal)).size, keterangan: "Refund/Nota Kredit yang diakui sebagai potongan pendapatan.", bagian: "LEDGER" },
    { kunci: "bersih", label: "= Pendapatan bersih Finance", tanda: 0, nominal: rp(bersihJembatan), jumlahOrder: null, keterangan: "Angka kartu \"Pendapatan Bersih\".", bagian: "LEDGER", subtotal: true },
  ];

  const nol = residualSales === 0 && residualBruto === 0 && residualRetur === 0 && residualBersih === 0;
  return {
    langkah,
    komponen: [A, B, C, D, E, F, H, ...(X.jumlahOrder ? [X] : [])].map(({ orders, ...k }) => ({ ...k, jumlahOrder: orders.length })),
    detailOrder: detail,
    residual: { sales: residualSales, bruto: residualBruto, retur: residualRetur, bersih: residualBersih, nol },
    memo: {
      notaKreditOmzetLunas: rp(sumMoney([A, B, C, D].map((k) => dec(k.notaKredit)))),
      penyesuaianManualNeto: rp(sumMoney(manualRows.filter(kredit).map((r) => r.efek))) - rp(sumMoney(manualRows.filter((r) => !kredit(r)).map((r) => -r.efek))),
      jurnalManual: [...new Set(manualRows.map((r) => r.nomorJurnal))],
      pengakuanTanggalBeda: detail.filter((d) => d.tanggalBeda).length,
      pengakuanDiPeriode: detail.filter((d) => d.jurnalPeriode.length && d.kelas !== KELAS.PEMBALIK_PENGAKUAN_LAMA).length,
      catatan: [
        "Omzet Lunas dan pendapatan akrual berbeda dasar pengakuan (lunas vs serah) — selisihnya dijelaskan komponen di atas, bukan dipaksa sama.",
        "Tanggal jurnal pengakuan mengikuti saat status order diubah menjadi diserahkan, bukan tanggal POD driver (jumlah order dengan tanggal berbeda tertera di memo).",
      ],
    },
  };
}
