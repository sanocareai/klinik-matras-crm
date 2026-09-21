// PEMASUKAN TERPADU — READ-MODEL AGREGATOR (bukan modul pembukuan). Web & Mobile membaca dari sini.
//
// TIDAK membuat jurnal, transaksi, atau sumber baru; tidak menyentuh saldo Kas & Bank. Semua angka dihitung DI SERVER dengan Decimal dan dikirim
// sebagai string desimal. Klien tidak menghitung atau mengklasifikasikan uang.
//
// ENAM KELAS (dipisah tegas; satu kejadian uang tidak boleh dihitung di dua kelas):
//   1. PENDAPATAN   pendapatan penjualan yang DIAKUI: baris jurnal pada akun pendapatan order (Layanan/Produk/Sewa/Ongkir) dikurangi Retur & Potongan (4-2100).
//                   Sumber: jurnal (mis. PENGAKUAN_PENDAPATAN, pembalikannya, refund/retur). BUKAN uang masuk.
//   2. PEMBAYARAN   uang pelanggan yang DITERIMA: tabel Payment (status: menunggu / terverifikasi / ditolak / dibatalkan) — jurnal PEMBAYARAN_ORDER
//                   TIDAK dihitung lagi dari jurnal (menghindari hitung ganda). Total "terverifikasi" dipisah dari "menunggu".
//   3. PIUTANG      sisa tagihan yang belum tertagih (saldo akun Piutang Usaha per order) — posisi per tanggal akhir periode, bukan arus.
//   4. LAIN         pemasukan lain di luar order: baris jurnal pada akun pendapatan NON-order (mis. 4-9100) dari sumber PEMASUKAN_LAIN.
//   5. DANA         dana masuk BUKAN pendapatan: setoran modal pemilik (3-1100) dan pendanaan pihak ketiga (2-1600 Utang Pihak Ketiga — investor/mitra).
//   6. DIKECUALIKAN transfer antar-rekening (TRANSFER_KAS), saldo awal & koreksi saldo (SALDO_AWAL), dan pembalikan pengeluaran/kasbon — bukan pemasukan.
//   +  DITINJAU     uang masuk/pendapatan yang klasifikasinya TIDAK bisa dipastikan dari akun jurnalnya → tidak dihitung ke kelas mana pun; jangan ditebak.
//   +  HISTORIS     "Data Sebelum Sistem": register pendapatan historis NON-POSTING (services/finance/legacyPendapatan.js). Terpisah, tidak memengaruhi buku besar.
//
// KLASIFIKASI berdasarkan AKUN & SUMBER jurnal (systemKey/kode/tipe), BUKAN nama atau deskripsi.

import { toMoney, sumMoney, ZERO } from "./money.js";
import { STATUS_DIHITUNG } from "./journal.js";
import { KEY as KEY_ORDER } from "./posting/orderRevenue.js";
import { statusDari, LABEL_STATUS, INCLUDE_LIST, idDitolak } from "./pembayaran.js";
import { detailJurnal, LABEL_SUMBER } from "./buku.js";
import { detailPembayaran } from "./pembayaran.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../../utils/wib.js";
import { legacyItems, ringkasLegacy, hitungCutoff, detailLegacy } from "./legacyPendapatan.js";

export class PemasukanError extends Error {
  constructor(message, statusCode = 400) { super(message); this.name = "PemasukanError"; this.statusCode = statusCode; }
}

const uang = (v) => toMoney(v ?? 0).toFixed(2);
const tgl = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const BATAS_JURNAL = 20000;
const TOLERANSI = toMoney("0.005");

export const KATEGORI = {
  PENDAPATAN: { label: "Pendapatan Penjualan", tab: "pendapatan", penjelasan: "Penjualan yang sudah DIAKUI sebagai pendapatan (order diserahkan). Belum tentu sudah dibayar." },
  PEMBAYARAN: { label: "Pembayaran Masuk", tab: "pembayaran", penjelasan: "Uang dari pelanggan yang diterima. Pembayaran pada order yang sama dengan pendapatan BUKAN pemasukan tambahan." },
  LAIN: { label: "Pemasukan Lain", tab: "lain", penjelasan: "Pendapatan di luar penjualan order, dicatat lewat Pemasukan Lain (mis. bunga bank)." },
  DANA: { label: "Dana Masuk Bukan Pendapatan", tab: "dana", penjelasan: "Uang masuk yang bukan hasil penjualan: setoran modal dan pinjaman/pendanaan pihak ketiga. Tidak masuk laba." },
  HISTORIS: { label: "Data Sebelum Sistem", tab: "historis", penjelasan: "Arsip pendapatan sebelum sistem dipakai. Belum memengaruhi buku besar sampai rekonsiliasi dan posting disetujui." },
  DITINJAU: { label: "Perlu Ditinjau", tab: null, penjelasan: "Klasifikasinya tidak bisa dipastikan dari data yang ada. Tidak dihitung ke kategori mana pun sampai ditinjau." },
  DIKECUALIKAN: { label: "Dikecualikan", tab: null, penjelasan: "Bukan pemasukan: transfer antar-rekening, saldo awal/koreksi saldo, dan pembalikan pengeluaran." },
};
export const LABEL_HISTORIS = "Data sebelum sistem berasal dari arsip lama dan belum memengaruhi buku besar sampai proses rekonsiliasi dan posting disetujui.";
const SUB_LABEL = {
  PENJUALAN: "Pengakuan pendapatan", RETUR: "Retur/potongan penjualan", PEMBALIKAN_PENDAPATAN: "Pembalikan pendapatan", MANUAL_PENDAPATAN: "Jurnal manual pada akun penjualan",
  PENDAPATAN_LAIN: "Pendapatan lain-lain", SETORAN_MODAL: "Setoran modal pemilik", PENDANAAN_PIHAK_KETIGA: "Pendanaan pihak ketiga (investor/mitra)",
  TRANSFER: "Transfer antar-rekening", SALDO_AWAL: "Saldo awal / koreksi saldo", PEMBALIKAN_BIAYA: "Pembalikan pengeluaran (bukan pemasukan)",
  PEMBAYARAN_TERVERIFIKASI: "Uang masuk terverifikasi", PEMBAYARAN_MENUNGGU: "Uang masuk menunggu verifikasi", PEMBAYARAN_TIDAK_DIHITUNG: "Tidak dihitung (ditolak/dibatalkan)",
  PEMBAYARAN_BELUM_DIBUKUKAN: "Terverifikasi, belum masuk buku besar", TIDAK_JELAS: "Akun lawan tidak menentukan jenis dana", HISTORIS: "Pendapatan arsip (non-posting)",
};
const AKUN_ORDER = new Set(["PENDAPATAN_LAYANAN", "PENDAPATAN_PRODUK", "PENDAPATAN_SEWA", "PENDAPATAN_ONGKIR", "RETUR_PENJUALAN"]);
const SUMBER_BIAYA = new Set(["PENGELUARAN", "PEMBELIAN", "BIAYA_KENDARAAN", "BIAYA_IKLAN", "TAGIHAN_SUPPLIER", "PEMBAYARAN_SUPPLIER", "PEMAKAIAN_BAHAN", "PENERIMAAN_BAHAN", "KASBON"]);
const STATUS_JURNAL = { POSTED: ["Terposting", "success"], REVERSED: ["Sudah dibalik", "warning"] };

/**
 * Klasifikasi SATU jurnal → daftar item (bisa lebih dari satu kelas hanya bila jurnalnya memang memuat dua hal berbeda). MURNI: input = jurnal + baris + akun.
 * Aturan agar tidak ada hitung ganda: uang kas yang sudah dijelaskan oleh baris pendapatan TIDAK diklasifikasi lagi sebagai dana masuk.
 */
export function klasifikasiJurnal(e) {
  const asal = e.source === "REVERSAL" ? (e.reversalOf?.source ?? null) : e.source;
  const balik = e.source === "REVERSAL";
  if (asal === "PEMBAYARAN_ORDER") return []; // dihitung dari tabel Payment (kelas PEMBAYARAN)
  const kas = e.lines.filter((l) => l.cashAccountId);
  const kasMasuk = kas.length ? sumMoney(kas.map((l) => l.debit)) : ZERO;
  const kasNet = kas.length ? sumMoney(kas.map((l) => toMoney(l.debit).minus(toMoney(l.credit)))) : ZERO;
  const item = (kategori, sub, nilai, extra = {}) => ({ kategori, sub, nilai: toMoney(nilai), ...extra });

  if (asal === "TRANSFER_KAS") return kasMasuk.isZero() ? [] : [item("DIKECUALIKAN", "TRANSFER", kasMasuk)];
  if (asal === "SALDO_AWAL") return kasNet.isZero() ? [] : [item("DIKECUALIKAN", "SALDO_AWAL", kasNet)];

  const hasil = [];
  const rev = e.lines.filter((l) => l.account.type === "PENDAPATAN");
  const revOrder = rev.filter((l) => AKUN_ORDER.has(l.account.systemKey));
  const revLain = rev.filter((l) => !AKUN_ORDER.has(l.account.systemKey));
  const net = (ls) => (ls.length ? sumMoney(ls.map((l) => toMoney(l.credit).minus(toMoney(l.debit)))) : ZERO);
  let dijelaskan = ZERO;

  if (revOrder.length) {
    const retur = net(revOrder.filter((l) => l.account.systemKey === "RETUR_PENJUALAN"));
    const bruto = net(revOrder.filter((l) => l.account.systemKey !== "RETUR_PENJUALAN"));
    const nilai = bruto.plus(retur);
    if (!nilai.isZero()) {
      const sub = asal === "MANUAL" ? "MANUAL_PENDAPATAN" : balik ? "PEMBALIKAN_PENDAPATAN" : retur.isZero() ? "PENJUALAN" : bruto.isZero() ? "RETUR" : "PENJUALAN";
      hasil.push(item("PENDAPATAN", sub, nilai, { bruto, retur }));
      dijelaskan = dijelaskan.plus(nilai);
    }
  }
  if (revLain.length) {
    const nilai = net(revLain);
    if (!nilai.isZero()) {
      if (asal === "PEMASUKAN_LAIN") hasil.push(item("LAIN", "PENDAPATAN_LAIN", nilai));
      else hasil.push(item("DITINJAU", "TIDAK_JELAS", nilai, { catatan: "Pendapatan pada akun non-penjualan di luar alur Pemasukan Lain" }));
      dijelaskan = dijelaskan.plus(nilai);
    }
  }

  const sisa = kasNet.minus(dijelaskan.greaterThan(ZERO) ? dijelaskan : ZERO);
  if (sisa.greaterThan(TOLERANSI) && !rev.length) {
    if (balik && SUMBER_BIAYA.has(asal)) { hasil.push(item("DIKECUALIKAN", "PEMBALIKAN_BIAYA", sisa)); return hasil; }
    const lawan = e.lines.filter((l) => !l.cashAccountId && toMoney(l.credit).greaterThan(ZERO));
    const semua = (fn) => lawan.length > 0 && lawan.every(fn);
    if (!balik && (asal === "MANUAL" || asal === "PEMASUKAN_LAIN")) {
      if (semua((l) => l.account.systemKey === "UTANG_PIHAK_KETIGA")) { hasil.push(item("DANA", "PENDANAAN_PIHAK_KETIGA", sisa)); return hasil; }
      if (semua((l) => l.account.code === "3-1100")) { hasil.push(item("DANA", "SETORAN_MODAL", sisa)); return hasil; }
    }
    hasil.push(item("DITINJAU", "TIDAK_JELAS", sisa, { catatan: `Uang masuk dari sumber ${asal ?? "?"}: akun lawan (${lawan.map((l) => l.account.code).join(", ") || "-"}) tidak menentukan jenis dana` }));
  } else if (sisa.greaterThan(TOLERANSI) && rev.length) {
    hasil.push(item("DITINJAU", "TIDAK_JELAS", sisa, { catatan: "Uang masuk melebihi pendapatan pada jurnal yang sama" }));
  }
  return hasil;
}

// ── PENGUMPULAN ────────────────────────────────────────────────────────────────────────────────────────────────
function periode(q = {}) {
  const now = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || "") ? q.from : `${now.slice(0, 7)}-01`;
  const akhirBulan = new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)), 0)).getUTCDate();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || "") ? q.to : `${now.slice(0, 7)}-${String(akhirBulan).padStart(2, "0")}`;
  if (from > to) throw new PemasukanError("Tanggal awal tidak boleh setelah tanggal akhir");
  return { from, to, dari: new Date(`${from}T00:00:00.000Z`), sampai: new Date(`${to}T00:00:00.000Z`) };
}

async function itemJurnal(db, { dari, sampai }) {
  const entri = await db.finJournalEntry.findMany({
    where: {
      date: { gte: dari, lte: sampai }, status: { in: STATUS_DIHITUNG }, source: { not: "PEMBAYARAN_ORDER" },
      OR: [{ lines: { some: { cashAccountId: { not: null }, debit: { gt: 0 } } } }, { lines: { some: { account: { type: "PENDAPATAN" } } } }],
    },
    select: {
      id: true, entryNumber: true, date: true, description: true, source: true, sourceId: true, status: true, reversalOf: { select: { source: true } },
      lines: { select: { debit: true, credit: true, cashAccountId: true, orderId: true, cashAccount: { select: { name: true } }, customer: { select: { name: true } }, account: { select: { code: true, type: true, systemKey: true } } } },
    },
    orderBy: [{ date: "desc" }, { entryNumber: "desc" }], take: BATAS_JURNAL + 1,
  });
  const terpotong = entri.length > BATAS_JURNAL;
  const daftar = terpotong ? entri.slice(0, BATAS_JURNAL) : entri;

  const orderIds = [...new Set(daftar.flatMap((e) => e.lines.map((l) => l.orderId)).filter(Boolean))];
  const [invoices, orders] = orderIds.length ? await Promise.all([
    db.invoice.findMany({ where: { orderId: { in: orderIds } }, select: { id: true, orderId: true, invoiceNumber: true } }),
    db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true, customer: { select: { name: true } } } }),
  ]) : [[], []];
  const invByOrder = new Map(invoices.map((i) => [i.orderId, i]));
  const ordById = new Map(orders.map((o) => [o.id, o]));

  const baris = [];
  for (const e of daftar) {
    for (const it of klasifikasiJurnal(e)) {
      const rekening = [...new Set(e.lines.filter((l) => l.cashAccountId).map((l) => l.cashAccount?.name).filter(Boolean))].join(", ") || null;
      const oid = e.lines.find((l) => l.orderId)?.orderId ?? null;
      const ord = oid ? ordById.get(oid) : null;
      const inv = oid ? invByOrder.get(oid) : null;
      const pihak = e.lines.find((l) => l.customer?.name)?.customer?.name ?? ord?.customer?.name ?? null;
      const [statusLabel, nada] = STATUS_JURNAL[e.status] ?? [e.status, "neutral"];
      baris.push({
        key: `j:${e.id}:${it.kategori}:${it.sub}`, jenis: "jurnal", id: e.id, tanggal: tgl(e.date), nomor: e.entryNumber, sumber: e.source, sumberLabel: LABEL_SUMBER[e.source] ?? e.source,
        pihak, keterangan: e.description, rekening, nilai: uang(it.nilai), ...(it.bruto ? { bruto: uang(it.bruto), retur: uang(it.retur) } : {}),
        status: e.status, statusLabel, nada, kategori: it.kategori, kategoriLabel: KATEGORI[it.kategori].label, sub: it.sub, subLabel: SUB_LABEL[it.sub] ?? it.sub,
        perluTinjau: it.kategori === "DITINJAU", catatan: it.catatan ?? null,
        tautan: { jurnal: { id: e.id, nomor: e.entryNumber }, pembayaran: null, invoice: inv ? { id: inv.id, nomor: inv.invoiceNumber } : null, order: ord ? { id: oid, nomor: ord.orderNumber } : null, dokumen: e.source === "PEMASUKAN_LAIN" && e.sourceId ? { modul: "pemasukan", id: e.sourceId } : null },
        _nilai: it.nilai, _bruto: it.bruto ?? null, _retur: it.retur ?? null,
      });
    }
  }
  return { baris, terpotong };
}

async function itemPembayaran(db, { from, to }) {
  const pays = await db.payment.findMany({
    where: { createdAt: { gte: startOfDayWIB(from), lt: endOfDayExclusiveWIB(to) } },
    include: INCLUDE_LIST, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: BATAS_JURNAL,
  });
  if (!pays.length) return [];
  const ids = pays.map((p) => p.id);
  const [ditolak, jurnal, gaps] = await Promise.all([
    idDitolak(db, ids),
    db.finJournalEntry.findMany({ where: { idempotencyKey: { in: ids.map((i) => KEY_ORDER.payment(i)) }, status: { in: STATUS_DIHITUNG } }, select: { id: true, entryNumber: true, idempotencyKey: true } }),
    db.finPostingGap.findMany({ where: { source: "PEMBAYARAN_ORDER", sourceId: { in: ids }, resolvedAt: null }, select: { sourceId: true, reason: true } }),
  ]);
  const jurnalByKey = new Map(jurnal.map((j) => [j.idempotencyKey, j]));
  const gapById = new Map(gaps.map((g) => [g.sourceId, g]));
  const NADA = { MENUNGGU: "warning", TERVERIFIKASI: "success", DITOLAK: "danger", DIBATALKAN: "neutral" };
  return pays.map((p) => {
    const status = statusDari(p, ditolak);
    const j = jurnalByKey.get(KEY_ORDER.payment(p.id)) ?? null;
    const gap = gapById.get(p.id);
    const belumBuku = status === "TERVERIFIKASI" && !j;
    const sub = status === "MENUNGGU" ? "PEMBAYARAN_MENUNGGU" : status === "TERVERIFIKASI" ? (belumBuku ? "PEMBAYARAN_BELUM_DIBUKUKAN" : "PEMBAYARAN_TERVERIFIKASI") : "PEMBAYARAN_TIDAK_DIHITUNG";
    return {
      key: `p:${p.id}`, jenis: "pembayaran", id: p.id, tanggal: new Date(p.createdAt.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10),
      nomor: p.order?.orderNumber ?? "—", sumber: "PEMBAYARAN_ORDER", sumberLabel: `Pembayaran pelanggan (${p.method})`, pihak: p.order?.customer?.name ?? null,
      keterangan: `Pembayaran ${p.method} untuk order ${p.order?.orderNumber ?? ""}`.trim(), rekening: p.cashAccount?.name ?? null, nilai: uang(p.amount),
      status, statusLabel: LABEL_STATUS[status], nada: NADA[status], kategori: "PEMBAYARAN", kategoriLabel: KATEGORI.PEMBAYARAN.label, sub, subLabel: SUB_LABEL[sub],
      perluTinjau: belumBuku, catatan: belumBuku ? (gap ? "Terverifikasi tetapi belum masuk buku besar: rekening kas/bank belum dipetakan. Selesaikan lewat Data belum lengkap di web." : "Terverifikasi tetapi tidak ada jurnal penerimaan") : null,
      tautan: { jurnal: j ? { id: j.id, nomor: j.entryNumber } : null, pembayaran: { id: p.id }, invoice: null, order: p.order ? { id: p.order.id, nomor: p.order.orderNumber } : null, dokumen: null },
      _nilai: toMoney(p.amount), _bruto: null, _retur: null,
    };
  });
}

/** Semua item pemasukan pada periode (jurnal + pembayaran + arsip historis), sudah diklasifikasi. */
async function kumpulkan(db, p, { termasukHistoris = true } = {}) {
  const [j, pay, his] = await Promise.all([itemJurnal(db, p), itemPembayaran(db, p), termasukHistoris ? legacyItems(db, p) : []]);
  return { baris: [...j.baris, ...pay, ...his], terpotong: j.terpotong };
}

function cocok(b, f) {
  if (f.kategori && b.kategori !== f.kategori) return false;
  if (f.status && b.status !== f.status) return false;
  if (f.rekening && !(b.rekeningIds ?? []).includes(f.rekening) && !(b.rekening ?? "").toLowerCase().includes(String(f.rekening).toLowerCase())) return false;
  if (f.sumber && b.sumber !== f.sumber) return false;
  if (f.pihak && !(b.pihak ?? "").toLowerCase().includes(String(f.pihak).toLowerCase())) return false;
  if (f.q) {
    const hay = `${b.nomor} ${b.pihak ?? ""} ${b.keterangan ?? ""} ${b.rekening ?? ""} ${b.nilai}`.toLowerCase();
    if (!String(f.q).toLowerCase().split(/\s+/).filter(Boolean).every((k) => hay.includes(k))) return false;
  }
  return true;
}
const bersih = (b) => { const { _nilai, _bruto, _retur, rekeningIds, ...x } = b; return x; };

// ── RINGKASAN ───────────────────────────────────────────────────────────────────────────────────────────────────
export async function ringkasanPemasukan(db, q = {}) {
  const p = periode(q);
  const { baris, terpotong } = await kumpulkan(db, p);
  const jumlah = (arr) => ({ jumlah: arr.length, nilai: arr.length ? uang(sumMoney(arr.map((b) => b._nilai))) : "0.00" });
  const cat = (k) => baris.filter((b) => b.kategori === k);
  const pendapatan = cat("PENDAPATAN");
  const bayar = cat("PEMBAYARAN");
  const hitung = (st) => bayar.filter((b) => b.status === st);
  const historisHitung = baris.filter((b) => b.kategori === "HISTORIS" && b.dihitung);
  const historisTinjau = baris.filter((b) => b.kategori === "HISTORIS" && b.perluTinjau);
  const dana = cat("DANA");
  const pendSistem = pendapatan.length ? sumMoney(pendapatan.map((b) => b._nilai)) : ZERO;
  const pendHis = historisHitung.length ? sumMoney(historisHitung.map((b) => b._nilai)) : ZERO;
  const subDana = {};
  for (const b of dana) subDana[b.sub] = (subDana[b.sub] ?? ZERO).plus(b._nilai);
  const excl = (sub) => jumlah(cat("DIKECUALIKAN").filter((b) => b.sub === sub));
  const belumBuku = bayar.filter((b) => b.sub === "PEMBAYARAN_BELUM_DIBUKUKAN");
  const ditinjauSemua = baris.filter((b) => b.perluTinjau);
  const cutoff = await hitungCutoff(db);

  return {
    periode: { from: p.from, to: p.to }, cutoff, terpotong, labelHistoris: LABEL_HISTORIS,
    pendapatanSistem: { ...jumlah(pendapatan), bruto: pendapatan.length ? uang(sumMoney(pendapatan.map((b) => b._bruto ?? b._nilai))) : "0.00", retur: pendapatan.length ? uang(sumMoney(pendapatan.map((b) => b._retur ?? ZERO))) : "0.00" },
    pendapatanHistoris: { ...jumlah(historisHitung), lunas: uang(sumMoney(historisHitung.filter((b) => b.payStatus === "LUNAS").map((b) => b._nilai)) ?? ZERO), belumBayar: uang(sumMoney(historisHitung.filter((b) => b.payStatus !== "LUNAS").map((b) => b._nilai)) ?? ZERO), perluDitinjau: jumlah(historisTinjau) },
    pendapatanGabungan: { nilai: uang(pendSistem.plus(pendHis)), catatan: "Pendapatan sistem + pendapatan historis (setelah deduplikasi). TIDAK ditambah lagi dengan pembayaran masuk." },
    pembayaranMasuk: { terverifikasi: jumlah(hitung("TERVERIFIKASI")), menunggu: jumlah(hitung("MENUNGGU")), tidakDihitung: jumlah(bayar.filter((b) => b.status === "DITOLAK" || b.status === "DIBATALKAN")), belumDibukukan: jumlah(belumBuku) },
    piutangTersisa: await piutangTersisa(db, p.sampai),
    pemasukanLain: jumlah(cat("LAIN")),
    danaMasukBukanPendapatan: { ...jumlah(dana), rincian: Object.entries(subDana).map(([sub, n]) => ({ sub, label: SUB_LABEL[sub] ?? sub, nilai: uang(n), jumlah: dana.filter((b) => b.sub === sub).length })) },
    perluDitinjau: jumlah(ditinjauSemua),
    dikecualikan: { transfer: excl("TRANSFER"), saldoAwal: excl("SALDO_AWAL"), pembalikanBiaya: excl("PEMBALIKAN_BIAYA") },
    penjelasan: [
      "Pendapatan adalah penjualan yang sudah diakui. Uang masuk adalah pembayaran yang benar-benar diterima. Keduanya berbeda: order bisa diakui sebagai pendapatan sebelum dibayar (menjadi piutang), dan DP diterima sebelum pendapatan diakui.",
      "Pendapatan dan pembayaran tidak dijumlahkan menjadi satu total, karena akan menghitung penjualan yang sama dua kali.",
      "Dana masuk bukan pendapatan (modal, pinjaman/pendanaan pihak ketiga) dan transfer antar-rekening tidak dihitung sebagai pendapatan.",
    ],
  };
}

async function piutangTersisa(db, sampai) {
  const akun = await db.finAccount.findUnique({ where: { systemKey: "PIUTANG_USAHA" }, select: { id: true } });
  if (!akun) return { nilai: "0.00", jumlahOrder: 0, menungguVerifikasi: { nilai: "0.00", jumlahOrder: 0 }, perTanggal: tgl(sampai) };
  const g = await db.finJournalLine.groupBy({ by: ["orderId"], where: { accountId: akun.id, orderId: { not: null }, entry: { status: { in: STATUS_DIHITUNG }, date: { lte: sampai } } }, _sum: { debit: true, credit: true } });
  const bersaldo = g.map((x) => ({ orderId: x.orderId, saldo: toMoney(x._sum.debit ?? 0).minus(toMoney(x._sum.credit ?? 0)) })).filter((x) => x.saldo.greaterThan(ZERO));
  const orders = bersaldo.length ? await db.order.findMany({ where: { id: { in: bersaldo.map((b) => b.orderId) } }, select: { id: true, paymentStatus: true } }) : [];
  const lunas = new Set(orders.filter((o) => o.paymentStatus === "LUNAS").map((o) => o.id));
  const terbuka = bersaldo.filter((b) => !lunas.has(b.orderId));
  const tunggu = bersaldo.filter((b) => lunas.has(b.orderId));
  const s = (a) => (a.length ? uang(sumMoney(a.map((x) => x.saldo))) : "0.00");
  return { nilai: s(terbuka), jumlahOrder: terbuka.length, menungguVerifikasi: { nilai: s(tunggu), jumlahOrder: tunggu.length }, perTanggal: tgl(sampai) };
}

// ── DAFTAR ──────────────────────────────────────────────────────────────────────────────────────────────────────
export async function daftarPemasukan(db, q = {}) {
  const p = periode(q);
  const kategori = q.kategori && KATEGORI[q.kategori] ? q.kategori : null;
  if (q.kategori && !kategori) throw new PemasukanError("Kategori tidak dikenal");
  const { baris, terpotong } = await kumpulkan(db, p);
  let rekeningNama = null;
  if (q.rekening && /^[0-9a-f-]{36}$/i.test(String(q.rekening))) rekeningNama = (await db.finCashAccount.findUnique({ where: { id: q.rekening }, select: { name: true } }))?.name ?? null;
  const filter = { kategori, status: q.status || null, rekening: rekeningNama ?? (q.rekening && !/^[0-9a-f-]{36}$/i.test(String(q.rekening)) ? q.rekening : null), sumber: q.sumber || null, pihak: q.pihak || null, q: q.q ? String(q.q).slice(0, 80) : null };
  const tampil = baris.filter((b) => cocok(b, filter)).sort((a, b) => (b.tanggal ?? "").localeCompare(a.tanggal ?? "") || String(b.nomor).localeCompare(String(a.nomor)));
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const potong = tampil.slice((page - 1) * limit, page * limit);
  const total = tampil.length ? uang(sumMoney(tampil.filter((b) => b.kategori !== "DIKECUALIKAN" && b.status !== "DITOLAK" && b.status !== "DIBATALKAN").map((b) => b._nilai))) : "0.00";
  return { periode: { from: p.from, to: p.to }, kategori, items: potong.map(bersih), page, limit, total: tampil.length, totalNilai: total, adaLagi: page * limit < tampil.length, terpotong, diperbaruiPada: new Date().toISOString() };
}

// ── OPSI ────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function opsiPemasukan(db, user, hasPermission, P) {
  const rekening = await db.finCashAccount.findMany({ where: { active: true }, select: { id: true, name: true, kind: true }, orderBy: { name: "asc" } });
  return {
    kategori: Object.entries(KATEGORI).map(([id, k]) => ({ id, label: k.label, tab: k.tab, penjelasan: k.penjelasan })),
    tab: ["ringkasan", "pendapatan", "pembayaran", "lain", "dana", "historis"],
    status: [
      { id: "POSTED", label: "Terposting" }, { id: "REVERSED", label: "Sudah dibalik" }, { id: "MENUNGGU", label: "Menunggu verifikasi" },
      { id: "TERVERIFIKASI", label: "Terverifikasi" }, { id: "DITOLAK", label: "Ditolak" }, { id: "DIBATALKAN", label: "Dibatalkan" },
    ],
    rekening,
    sumber: Object.entries(LABEL_SUMBER).map(([id, label]) => ({ id, label })),
    cutoff: await hitungCutoff(db),
    labelHistoris: LABEL_HISTORIS,
    // Pencatatan baru HANYA lewat workflow Pemasukan Lain yang sudah ada (validasi akun di server). Tidak ada "buat pemasukan umum".
    aksiCatat: { boleh: hasPermission(user, P.FINANCE_POST), alasan: hasPermission(user, P.FINANCE_POST) ? null : "Akun Anda tidak boleh mencatat.", tujuan: { modul: "pemasukan", webPath: "/finance/other-income" }, keterangan: "Pemasukan lain dicatat lewat Pemasukan Lain. Uang pelanggan dicatat di Pembayaran & Verifikasi." },
    dataSebelumSistem: { boleh: hasPermission(user, P.FINANCE_POST), impor: "web" },
  };
}

// ── DETAIL ──────────────────────────────────────────────────────────────────────────────────────────────────────
export async function detailPemasukan(db, user, jenis, id) {
  if (jenis === "jurnal") {
    const d = await detailJurnal(db, user, id);
    if (!d) return null;
    const e = await db.finJournalEntry.findUnique({
      where: { id }, select: { id: true, entryNumber: true, date: true, description: true, source: true, sourceId: true, status: true, reversalOf: { select: { source: true } },
        lines: { select: { debit: true, credit: true, cashAccountId: true, orderId: true, cashAccount: { select: { name: true } }, customer: { select: { name: true } }, account: { select: { code: true, type: true, systemKey: true } } } } },
    });
    const kl = klasifikasiJurnal(e).map((x) => ({ kategori: x.kategori, kategoriLabel: KATEGORI[x.kategori].label, sub: x.sub, subLabel: SUB_LABEL[x.sub] ?? x.sub, nilai: uang(x.nilai), catatan: x.catatan ?? null }));
    return { jenis, id, klasifikasi: kl, penjelasan: kl.length ? null : "Jurnal ini bukan pemasukan (tidak ada pendapatan atau uang masuk yang perlu diklasifikasi).", detail: d };
  }
  if (jenis === "pembayaran") {
    const d = await detailPembayaran(db, user, id);
    if (!d) return null;
    return { jenis, id, klasifikasi: [{ kategori: "PEMBAYARAN", kategoriLabel: KATEGORI.PEMBAYARAN.label, sub: null, subLabel: null, nilai: uang(d.nominal ?? d.amount ?? 0), catatan: null }], penjelasan: KATEGORI.PEMBAYARAN.penjelasan, detail: d };
  }
  if (jenis === "historis") return detailLegacy(db, id);
  throw new PemasukanError("Jenis tidak dikenal (jurnal | pembayaran | historis)", 404);
}

export { ringkasLegacy };
