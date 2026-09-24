// READ-MODEL BUKU (Finance Mobile S9): Jurnal, Buku Besar per akun, dan Rekonsiliasi Bank.
//
// HANYA membaca. Tidak ada ledger, status, atau perhitungan tandingan: total debit/kredit, indikator seimbang, saldo berjalan, saldo buku, dan selisih
// koran dihitung DI SINI (server) dengan Decimal dan dikirim sebagai string desimal. Perintah pencocokan tetap ke endpoint yang sudah ada
// (routes/financeTransactions.js: /bank-lines/:id/match|unmatch). Jurnal manual, reversal, edit jurnal terposting, tutup periode, dan koreksi saldo
// SENGAJA tidak ada di sini — hanya di web.

import { hasPermission } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { ENTITY_TYPES } from "../../lib/activityLog.js";
import { toMoney, sumMoney, ZERO } from "./money.js";
import { STATUS_DIHITUNG } from "./journal.js";
import { pandanganCutoff } from "./rekonSnapshot.js";

// B3 (aditif, klien mobile lama mengabaikan field ini): ringkasan cutoff dari snapshot TERSIMPAN.
async function cutoffRingkas(db, s) {
  if (!s.snapshot) return null;
  const p = await pandanganCutoff(db, s.snapshot, { closingBank: s.closingBalance });
  return {
    snapshotAt: p.snapshot.snapshotAt, hwmAt: p.snapshot.hwmAt, saldoBukuSnapshot: uang(toMoney(p.snapshot.saldoBuku)), selisihSnapshot: uang(toMoney(p.snapshot.selisih)),
    postingSetelahCutoff: p.ringkasanSetelahSnapshot.POSTING_SETELAH_CUTOFF.jumlah, reversalSetelahSnapshot: p.ringkasanSetelahSnapshot.REVERSAL_SETELAH_SNAPSHOT.jumlah,
    penyesuaianSetelahSnapshot: p.ringkasanSetelahSnapshot.PENYESUAIAN_BUKU.jumlah, berlaku: p.valid,
  };
}

export class BukuError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "BukuError";
    this.statusCode = statusCode;
  }
}

const uang = (v) => toMoney(v ?? 0).toFixed(2);
const tgl = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const waktu = (d) => (d ? new Date(d).toISOString() : null);
const orang = (u) => (u ? { id: u.id, name: u.name } : null);
const tanggalKolom = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? new Date(`${v}T00:00:00.000Z`) : null);
const batas = (o, dasar = 20) => {
  const limit = Math.min(Math.max(parseInt(o.limit, 10) || dasar, 1), 100);
  const page = Math.max(parseInt(o.page, 10) || 1, 1);
  return { limit, page, skip: (page - 1) * limit };
};

export const LABEL_SUMBER = {
  MANUAL: "Jurnal manual", SALDO_AWAL: "Saldo awal", PEMBAYARAN_ORDER: "Pembayaran order", PENGAKUAN_PENDAPATAN: "Pengakuan pendapatan", REFUND: "Refund",
  PENGELUARAN: "Pengeluaran", PEMBELIAN: "Pembelian", BIAYA_KENDARAAN: "Biaya kendaraan", BIAYA_IKLAN: "Biaya iklan", PEMASUKAN_LAIN: "Pemasukan lain",
  TRANSFER_KAS: "Transfer kas", TAGIHAN_SUPPLIER: "Tagihan supplier", PEMBAYARAN_SUPPLIER: "Pembayaran supplier", PEMAKAIAN_BAHAN: "Pemakaian bahan",
  PENERIMAAN_BAHAN: "Penerimaan bahan", KASBON: "Kasbon", REVERSAL: "Jurnal balik",
};
const STATUS_JURNAL = { DRAFT: ["Draf", "neutral"], POSTED: ["Terposting", "success"], REVERSED: ["Sudah dibalik", "warning"], VOID: ["Batal", "neutral"] };
const statusJ = (s) => ({ status: s, statusLabel: STATUS_JURNAL[s]?.[0] ?? s, nada: STATUS_JURNAL[s]?.[1] ?? "neutral" });

// ── JURNAL ──────────────────────────────────────────────────────────────────────────────────────────────────────
function whereJurnal({ from, to, q, source, status, akunId }) {
  const dari = tanggalKolom(from);
  const sampai = tanggalKolom(to);
  return {
    ...(dari && sampai && { date: { gte: dari, lte: sampai } }),
    ...(source && { source }),
    ...(status && { status }),
    ...(akunId && { lines: { some: { accountId: akunId } } }),
    ...(q && String(q).trim() ? {
      AND: String(q).trim().split(/\s+/).slice(0, 6).map((k) => ({
        OR: [
          { entryNumber: { contains: k, mode: "insensitive" } }, { description: { contains: k, mode: "insensitive" } },
          { lines: { some: { description: { contains: k, mode: "insensitive" } } } },
          ...(/^\d{3,12}$/.test(k.replace(/\./g, "")) ? [{ lines: { some: { OR: [{ debit: Number(k.replace(/\./g, "")) }, { credit: Number(k.replace(/\./g, "")) }] } } }] : []),
        ],
      })),
    } : {}),
  };
}

/** Modul mobile + nomor dokumen sumber tiap jurnal (bila ada). Satu kueri per jenis dokumen; tidak ada N+1. */
async function dokumenTerkait(db, entries) {
  const per = (src) => entries.filter((e) => e.source === src && e.sourceId).map((e) => e.sourceId);
  const [exp, pur, bill, pay, inc, ref, kas, kasRep, bayarOrder] = await Promise.all([
    per("PENGELUARAN").length ? db.finExpense.findMany({ where: { id: { in: per("PENGELUARAN") } }, select: { id: true, expenseNumber: true } }) : [],
    per("PEMBELIAN").length ? db.finPurchase.findMany({ where: { id: { in: per("PEMBELIAN") } }, select: { id: true, purchaseNumber: true } }) : [],
    per("TAGIHAN_SUPPLIER").length ? db.finSupplierBill.findMany({ where: { id: { in: per("TAGIHAN_SUPPLIER") } }, select: { id: true, billNumber: true } }) : [],
    per("PEMBAYARAN_SUPPLIER").length ? db.finSupplierPayment.findMany({ where: { id: { in: per("PEMBAYARAN_SUPPLIER") } }, select: { id: true, paymentNumber: true } }) : [],
    per("PEMASUKAN_LAIN").length ? db.finOtherIncome.findMany({ where: { id: { in: per("PEMASUKAN_LAIN") } }, select: { id: true, incomeNumber: true } }) : [],
    per("REFUND").length ? db.finRefund.findMany({ where: { id: { in: per("REFUND") } }, select: { id: true, refundNumber: true } }) : [],
    per("KASBON").length ? db.finKasbon.findMany({ where: { id: { in: per("KASBON") } }, select: { id: true, kasbonNumber: true } }) : [],
    per("KASBON").length ? db.finKasbonRepayment.findMany({ where: { id: { in: per("KASBON") } }, select: { id: true, kasbon: { select: { id: true, kasbonNumber: true } } } }) : [],
    per("PEMBAYARAN_ORDER").length ? db.payment.findMany({ where: { id: { in: per("PEMBAYARAN_ORDER") } }, select: { id: true, order: { select: { orderNumber: true } } } }) : [],
  ]);
  const peta = new Map();
  for (const x of exp) peta.set(`PENGELUARAN:${x.id}`, { modul: "pengeluaran", id: x.id, nomor: x.expenseNumber });
  for (const x of pur) peta.set(`PEMBELIAN:${x.id}`, { modul: "pembelian", id: x.id, nomor: x.purchaseNumber });
  for (const x of bill) peta.set(`TAGIHAN_SUPPLIER:${x.id}`, { modul: "tagihan", id: x.id, nomor: x.billNumber });
  for (const x of pay) peta.set(`PEMBAYARAN_SUPPLIER:${x.id}`, { modul: "pembayaran-supplier", id: x.id, nomor: x.paymentNumber });
  for (const x of inc) peta.set(`PEMASUKAN_LAIN:${x.id}`, { modul: "pemasukan", id: x.id, nomor: x.incomeNumber });
  for (const x of ref) peta.set(`REFUND:${x.id}`, { modul: "refund", id: x.id, nomor: x.refundNumber });
  for (const x of kas) peta.set(`KASBON:${x.id}`, { modul: "kasbon", id: x.id, nomor: x.kasbonNumber });
  for (const x of kasRep) peta.set(`KASBON:${x.id}`, { modul: "kasbon", id: x.kasbon.id, nomor: x.kasbon.kasbonNumber });
  // Pembayaran pelanggan memakai layar S5 (bukan modul transaksi): modul "pembayaran".
  for (const x of bayarOrder) peta.set(`PEMBAYARAN_ORDER:${x.id}`, { modul: "pembayaran", id: x.id, nomor: x.order?.orderNumber ?? "Pembayaran" });
  return (e) => peta.get(`${e.source}:${e.sourceId}`) ?? null;
}

async function totalPerJurnal(db, ids) {
  if (!ids.length) return new Map();
  const grup = await db.finJournalLine.groupBy({ by: ["entryId"], where: { entryId: { in: ids } }, _sum: { debit: true, credit: true }, _count: { _all: true } });
  return new Map(grup.map((g) => [g.entryId, { debit: toMoney(g._sum.debit || 0), kredit: toMoney(g._sum.credit || 0), baris: g._count._all }]));
}

const bentukJurnal = (e, t, dok) => {
  const debit = t?.debit ?? ZERO;
  const kredit = t?.kredit ?? ZERO;
  return {
    id: e.id, nomor: e.entryNumber, tanggal: tgl(e.date), keterangan: e.description, sumber: e.source, sumberLabel: LABEL_SUMBER[e.source] ?? e.source, ...statusJ(e.status),
    totalDebit: uang(debit), totalKredit: uang(kredit), seimbang: debit.equals(kredit), selisih: uang(debit.minus(kredit)), jumlahBaris: t?.baris ?? 0,
    membalik: e.reversalOf ? { id: e.reversalOf.id, nomor: e.reversalOf.entryNumber } : null, dibalikOleh: e.reversedBy ? { id: e.reversedBy.id, nomor: e.reversedBy.entryNumber } : null,
    dokumen: dok ? dok(e) : null, dibuatOleh: orang(e.createdBy),
  };
};

export async function daftarJurnal(db, opsi = {}) {
  const { limit, page, skip } = batas(opsi);
  const where = whereJurnal(opsi);
  const [baris, total, perStatus] = await Promise.all([
    db.finJournalEntry.findMany({
      where, orderBy: [{ date: "desc" }, { entryNumber: "desc" }], skip, take: limit,
      include: { createdBy: { select: { id: true, name: true } }, reversedBy: { select: { id: true, entryNumber: true } }, reversalOf: { select: { id: true, entryNumber: true } } },
    }),
    db.finJournalEntry.count({ where }),
    db.finJournalEntry.groupBy({ by: ["status"], where: whereJurnal({ ...opsi, status: null }), _count: { _all: true } }),
  ]);
  const [tot, dok] = await Promise.all([totalPerJurnal(db, baris.map((e) => e.id)), dokumenTerkait(db, baris)]);
  const dari = tanggalKolom(opsi.from);
  const sampai = tanggalKolom(opsi.to);
  // Jurnal tidak seimbang pada periode (server; hanya menghormati rentang tanggal — bukan cari/sumber). Seharusnya 0; bukan nol = darurat.
  const timpang = dari && sampai
    ? await db.$queryRaw`
      SELECT count(*)::int AS n FROM (
        SELECT e.id FROM fin_journal_entries e JOIN fin_journal_lines l ON l.entry_id = e.id
        WHERE e.status::text IN ('POSTED', 'REVERSED') AND e.date >= ${dari} AND e.date <= ${sampai}
        GROUP BY e.id HAVING sum(l.debit) <> sum(l.credit)
      ) t`
    : await db.$queryRaw`
      SELECT count(*)::int AS n FROM (
        SELECT e.id FROM fin_journal_entries e JOIN fin_journal_lines l ON l.entry_id = e.id
        WHERE e.status::text IN ('POSTED', 'REVERSED')
        GROUP BY e.id HAVING sum(l.debit) <> sum(l.credit)
      ) t`;
  return {
    items: baris.map((e) => bentukJurnal(e, tot.get(e.id), dok)), page, limit, total, adaLagi: skip + baris.length < total,
    hitung: Object.fromEntries(perStatus.map((g) => [g.status, g._count._all])), tidakSeimbang: timpang[0]?.n ?? 0, diperbaruiPada: new Date().toISOString(),
  };
}

const LABEL_PERISTIWA = {
  DOCUMENT_POSTED: "Diposting", DOCUMENT_CANCELLED: "Dibatalkan", DOCUMENT_CORRECTED: "Dikoreksi", DOCUMENT_EDITED: "Diubah", DOCUMENT_APPROVED: "Disetujui", DOCUMENT_REJECTED: "Ditolak",
};

export async function detailJurnal(db, user, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const e = await db.finJournalEntry.findUnique({
    where: { id },
    include: {
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          account: { select: { id: true, code: true, name: true } }, order: { select: { id: true, orderNumber: true } }, customer: { select: { name: true } },
          supplier: { select: { name: true } }, cashAccount: { select: { name: true } },
        },
      },
      createdBy: { select: { id: true, name: true } }, postedBy: { select: { id: true, name: true } },
      reversedBy: { select: { id: true, entryNumber: true } }, reversalOf: { select: { id: true, entryNumber: true } },
    },
  });
  if (!e) return null;
  const debit = e.lines.length ? sumMoney(e.lines.map((l) => l.debit)) : ZERO;
  const kredit = e.lines.length ? sumMoney(e.lines.map((l) => l.credit)) : ZERO;
  const dok = await dokumenTerkait(db, [e]);
  const events = await db.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: e.id }, orderBy: { createdAt: "asc" }, take: 50 });
  const pelaku = new Map((await db.user.findMany({ where: { id: { in: [...new Set(events.map((x) => x.actorId).filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const riwayat = [{ waktu: waktu(e.createdAt), peristiwa: "DIBUAT", label: "Dibuat", oleh: e.createdBy?.name ?? null, catatan: null }];
  if (e.postedAt) riwayat.push({ waktu: waktu(e.postedAt), peristiwa: "DIPOSTING", label: "Diposting", oleh: e.postedBy?.name ?? null, catatan: null });
  for (const x of events) {
    const md = x.metadata && typeof x.metadata === "object" ? x.metadata : {};
    riwayat.push({ waktu: waktu(x.createdAt), peristiwa: x.eventType, label: LABEL_PERISTIWA[x.eventType] ?? "Aktivitas", oleh: x.actorId ? pelaku.get(x.actorId) ?? null : null, catatan: typeof md.reason === "string" ? md.reason : null });
  }
  if (e.reversedAt) riwayat.push({ waktu: waktu(e.reversedAt), peristiwa: "DIBALIK", label: `Dibalik oleh ${e.reversedBy?.entryNumber ?? "jurnal balik"}`, oleh: null, catatan: e.reversalReason ?? null });
  riwayat.sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
  const item = bentukJurnal(e, { debit, kredit, baris: e.lines.length }, dok);
  return {
    ...item,
    baris: e.lines.map((l) => ({
      no: l.lineNo, akunId: l.account.id, kodeAkun: l.account.code, namaAkun: l.account.name, debit: uang(l.debit), kredit: uang(l.credit), keterangan: l.description,
      order: l.order ? { id: l.order.id, nomor: l.order.orderNumber } : null, pelanggan: l.customer?.name ?? null, supplier: l.supplier?.name ?? null, rekening: l.cashAccount?.name ?? null,
    })),
    diposting: { pada: waktu(e.postedAt), oleh: orang(e.postedBy) }, alasanBalik: e.reversalReason ?? null, riwayat,
    catatan: item.seimbang ? null : "Jurnal ini TIDAK seimbang. Ini keadaan darurat — hubungi admin; perbaikannya hanya di web.",
  };
}

// ── BUKU BESAR ──────────────────────────────────────────────────────────────────────────────────────────────────
export async function daftarAkun(db, { q = "", limit = 50 } = {}) {
  const kata = String(q).trim();
  const akun = await db.finAccount.findMany({
    where: { isPostable: true, ...(kata ? { OR: [{ code: { contains: kata, mode: "insensitive" } }, { name: { contains: kata, mode: "insensitive" } }] } : {}) },
    orderBy: { code: "asc" }, take: Math.min(Number(limit) || 50, 200), select: { id: true, code: true, name: true, type: true, normalBalance: true, active: true },
  });
  return { akun };
}

const BATAS_BARIS_BUKU = 20000;

/** Mutasi satu akun + saldo awal + saldo berjalan (Decimal di server). Halaman = potongan dari daftar lengkap periode; saldo berjalan SUDAH benar per baris. */
export async function mutasiAkun(db, { accountId, from, to, page, limit }) {
  const dari = tanggalKolom(from);
  const sampai = tanggalKolom(to);
  if (!dari || !sampai) throw new BukuError("Periode (from & to, YYYY-MM-DD) wajib diisi untuk buku besar");
  if (dari > sampai) throw new BukuError("Tanggal awal tidak boleh setelah tanggal akhir");
  const akun = await db.finAccount.findUnique({ where: { id: accountId }, select: { id: true, code: true, name: true, type: true, normalBalance: true } });
  if (!akun) return null;
  const { limit: lim, page: hal, skip } = batas({ page, limit }, 30);

  const sebelum = await db.finJournalLine.aggregate({ where: { accountId, entry: { status: { in: STATUS_DIHITUNG }, date: { lt: dari } } }, _sum: { debit: true, credit: true } });
  const net = (d, k) => (akun.normalBalance === "DEBIT" ? toMoney(d).minus(toMoney(k)) : toMoney(k).minus(toMoney(d)));
  const saldoAwal = net(sebelum._sum.debit || 0, sebelum._sum.credit || 0);

  const lines = await db.finJournalLine.findMany({
    where: { accountId, entry: { status: { in: STATUS_DIHITUNG }, date: { gte: dari, lte: sampai } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { entryNumber: "asc" } }, { lineNo: "asc" }],
    take: BATAS_BARIS_BUKU + 1,
    select: {
      id: true, debit: true, credit: true, description: true,
      entry: { select: { id: true, entryNumber: true, date: true, description: true, source: true, status: true } },
      order: { select: { orderNumber: true } }, customer: { select: { name: true } }, supplier: { select: { name: true } }, cashAccount: { select: { name: true } },
    },
  });
  const terpotong = lines.length > BATAS_BARIS_BUKU;
  if (terpotong) throw new BukuError(`Akun ini punya lebih dari ${BATAS_BARIS_BUKU} mutasi pada periode tersebut. Persempit periode.`, 422);

  let saldo = saldoAwal;
  let totD = ZERO;
  let totK = ZERO;
  const semua = lines.map((l) => {
    const d = toMoney(l.debit);
    const k = toMoney(l.credit);
    saldo = saldo.plus(net(d, k));
    totD = totD.plus(d);
    totK = totK.plus(k);
    return {
      lineId: l.id, jurnalId: l.entry.id, nomor: l.entry.entryNumber, tanggal: tgl(l.entry.date), keterangan: l.description || l.entry.description, sumber: l.entry.source,
      sumberLabel: LABEL_SUMBER[l.entry.source] ?? l.entry.source, status: l.entry.status, debit: uang(d), kredit: uang(k), saldo: uang(saldo),
      penanda: [l.order?.orderNumber && `Order ${l.order.orderNumber}`, l.customer?.name, l.supplier?.name, l.cashAccount?.name].filter(Boolean).join(" · ") || null,
    };
  });
  return {
    akun: { id: akun.id, kode: akun.code, nama: akun.name, tipe: akun.type, saldoNormal: akun.normalBalance },
    periode: { from: tgl(dari), to: tgl(sampai) }, saldoAwal: uang(saldoAwal), totalDebit: uang(totD), totalKredit: uang(totK), saldoAkhir: uang(saldo),
    total: semua.length, page: hal, limit: lim, adaLagi: skip + lim < semua.length, baris: semua.slice(skip, skip + lim), diperbaruiPada: new Date().toISOString(),
  };
}

// ── REKONSILIASI BANK ───────────────────────────────────────────────────────────────────────────────────────────
const STATUS_REKON = { DRAFT: ["Berjalan", "warning"], SELESAI: ["Selesai", "success"], DRAF_MENUNGGU_MUTASI: ["Draf — menunggu mutasi bank", "warning"] };
const STATUS_BARIS = { BELUM_COCOK: ["Belum cocok", "warning"], COCOK: ["Cocok", "success"], DIABAIKAN: ["Diabaikan", "neutral"] };

async function saldoBukuSampai(db, cashAccountId, sampai) {
  const agr = await db.finJournalLine.aggregate({ where: { cashAccountId, entry: { status: { in: STATUS_DIHITUNG }, date: { lte: sampai } } }, _sum: { debit: true, credit: true } });
  return toMoney(agr._sum.debit || 0).minus(toMoney(agr._sum.credit || 0));
}

export async function daftarRekon(db, { cashAccountId, status } = {}) {
  const daftar = await db.finBankStatement.findMany({
    where: { ...(cashAccountId ? { cashAccountId } : {}), ...(status ? { status } : {}) }, orderBy: { periodStart: "desc" }, take: 50,
    include: { cashAccount: { select: { id: true, name: true } }, lines: { select: { status: true } }, snapshot: true },
  });
  const items = [];
  for (const s of daftar) {
    const buku = await saldoBukuSampai(db, s.cashAccountId, s.periodEnd);
    const selisih = toMoney(s.closingBalance).minus(buku);
    items.push({
      id: s.id, rekening: { id: s.cashAccount.id, name: s.cashAccount.name }, periode: { from: tgl(s.periodStart), to: tgl(s.periodEnd) },
      status: s.status, statusLabel: STATUS_REKON[s.status]?.[0] ?? s.status, nada: STATUS_REKON[s.status]?.[1] ?? "neutral",
      saldoKoran: uang(s.closingBalance), saldoBuku: uang(buku), selisih: uang(selisih), cocok: selisih.isZero(),
      jumlahBaris: s.lines.length, belumCocok: s.lines.filter((l) => l.status === "BELUM_COCOK").length, cocokBaris: s.lines.filter((l) => l.status === "COCOK").length,
      diabaikan: s.lines.filter((l) => l.status === "DIABAIKAN").length,
      cutoff: await cutoffRingkas(db, s),
    });
  }
  return { items, total: items.length, diperbaruiPada: new Date().toISOString() };
}

export async function detailRekon(db, user, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const s = await db.finBankStatement.findUnique({
    where: { id },
    include: {
      cashAccount: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } }, completedBy: { select: { id: true, name: true } }, snapshot: true,
      lines: {
        orderBy: [{ date: "asc" }, { createdAt: "asc" }], take: 500,
        include: {
          matchedBy: { select: { id: true, name: true } },
          matchedLine: { select: { id: true, debit: true, credit: true, description: true, entry: { select: { id: true, entryNumber: true, date: true, description: true } } } },
        },
      },
    },
  });
  if (!s) return null;
  const buku = await saldoBukuSampai(db, s.cashAccountId, s.periodEnd);
  const selisih = toMoney(s.closingBalance).minus(buku);

  // Kandidat: mutasi rekening ini di periode yang SAMA yang belum dipasangkan dengan baris koran mana pun.
  const kandidat = await db.finJournalLine.findMany({
    where: { cashAccountId: s.cashAccountId, entry: { status: { in: STATUS_DIHITUNG }, date: { gte: s.periodStart, lte: s.periodEnd } }, bankStatementLines: { none: {} } },
    orderBy: [{ entry: { date: "asc" } }],
    select: { id: true, debit: true, credit: true, description: true, entry: { select: { id: true, entryNumber: true, date: true, description: true, source: true } } },
  });
  const kandidatBentuk = kandidat.map((k) => ({
    lineId: k.id, jurnalId: k.entry.id, nomor: k.entry.entryNumber, tanggal: tgl(k.entry.date), keterangan: k.description || k.entry.description,
    sumber: LABEL_SUMBER[k.entry.source] ?? k.entry.source, nilai: toMoney(k.debit).minus(toMoney(k.credit)),
  }));

  const boleh = hasPermission(user, P.FINANCE_POST) && s.status === "DRAFT";
  const aksi = (ok, alasan, path) => ({ boleh: ok, alasan: ok ? null : alasan, path, metode: "POST" });
  const baris = s.lines.map((l) => {
    const nilai = toMoney(l.amount);
    const sama = l.status === "BELUM_COCOK" ? kandidatBentuk.filter((k) => k.nilai.equals(nilai)).slice(0, 10).map((k) => ({ ...k, nilai: uang(k.nilai) })) : [];
    const alasanIzin = !hasPermission(user, P.FINANCE_POST) ? "Akun Anda tidak boleh mencocokkan mutasi." : "Rekonsiliasi periode ini sudah selesai — buka kembali di web bila perlu.";
    return {
      id: l.id, tanggal: tgl(l.date), keterangan: l.description, referensi: l.reference, nominal: uang(nilai), status: l.status, statusLabel: STATUS_BARIS[l.status]?.[0] ?? l.status,
      nada: STATUS_BARIS[l.status]?.[1] ?? "neutral", catatan: l.note,
      cocokDengan: l.matchedLine ? { lineId: l.matchedLine.id, jurnalId: l.matchedLine.entry.id, nomor: l.matchedLine.entry.entryNumber, tanggal: tgl(l.matchedLine.entry.date), keterangan: l.matchedLine.description || l.matchedLine.entry.description, nilai: uang(toMoney(l.matchedLine.debit).minus(toMoney(l.matchedLine.credit))) } : null,
      dicocokkan: l.matchedAt ? { oleh: orang(l.matchedBy), pada: waktu(l.matchedAt) } : null,
      kandidat: sama,
      aksi: {
        cocokkan: aksi(boleh && l.status === "BELUM_COCOK" && sama.length > 0, l.status !== "BELUM_COCOK" ? "Baris ini sudah diproses." : sama.length === 0 && boleh ? "Tidak ada mutasi buku dengan nominal & arah yang sama. Catat penyesuaian sebagai jurnal di web dulu." : alasanIzin, `/finance/bank-lines/${l.id}/match`),
        lepas: aksi(boleh && l.status === "COCOK", l.status !== "COCOK" ? "Baris ini belum dicocokkan." : alasanIzin, `/finance/bank-lines/${l.id}/unmatch`),
      },
    };
  });
  const events = await db.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.FIN_BANK_STATEMENT, entityId: s.id }, orderBy: { createdAt: "asc" }, take: 100 });
  const pelaku = new Map((await db.user.findMany({ where: { id: { in: [...new Set(events.map((x) => x.actorId).filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const riwayat = [{ waktu: waktu(s.createdAt), peristiwa: "DIBUAT", label: "Koran bank dicatat", oleh: s.createdBy?.name ?? null, catatan: null }];
  for (const x of events) {
    const md = x.metadata && typeof x.metadata === "object" ? x.metadata : {};
    riwayat.push({ waktu: waktu(x.createdAt), peristiwa: x.eventType, label: typeof md.label === "string" ? md.label : "Aktivitas", oleh: x.actorId ? pelaku.get(x.actorId) ?? null : null, catatan: typeof md.catatan === "string" ? md.catatan : null });
  }
  if (s.completedAt) riwayat.push({ waktu: waktu(s.completedAt), peristiwa: "SELESAI", label: "Rekonsiliasi diselesaikan", oleh: s.completedBy?.name ?? null, catatan: s.note });
  riwayat.sort((a, b) => new Date(a.waktu) - new Date(b.waktu));

  return {
    id: s.id, rekening: { id: s.cashAccount.id, name: s.cashAccount.name }, periode: { from: tgl(s.periodStart), to: tgl(s.periodEnd) }, status: s.status,
    statusLabel: STATUS_REKON[s.status]?.[0] ?? s.status, nada: STATUS_REKON[s.status]?.[1] ?? "neutral", catatan: s.note,
    saldoAwalKoran: uang(s.openingBalance), saldoKoran: uang(s.closingBalance), saldoBuku: uang(buku), selisih: uang(selisih), cocok: selisih.isZero(),
    ringkasan: {
      jumlahBaris: s.lines.length, belumCocok: s.lines.filter((l) => l.status === "BELUM_COCOK").length, cocokBaris: s.lines.filter((l) => l.status === "COCOK").length,
      diabaikan: s.lines.filter((l) => l.status === "DIABAIKAN").length, mutasiBukuBelumDipasangkan: kandidatBentuk.length,
    },
    baris, terpotong: s.lines.length >= 500, riwayat, diperbaruiPada: new Date().toISOString(), cutoff: await cutoffRingkas(db, s),
    penutup: s.completedAt ? { pada: waktu(s.completedAt), oleh: orang(s.completedBy) } : null,
  };
}
