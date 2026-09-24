// GERBANG KOREKSI TRANSAKSI — infrastruktur bersama untuk "Edit & Koreksi Aman".
//
// Prinsip (lihat juga posting/journal.js):
//  - Jurnal yang sudah POSTED TIDAK PERNAH di-UPDATE/DELETE. Perubahan yang memengaruhi ledger =
//    reversal resmi jurnal lama + jurnal pengganti, dalam SATU transaksi database.
//  - PRATINJAU memakai kode koreksi yang SAMA persis (dijalankan di dalam transaksi lalu di-ROLLBACK),
//    bukan hitungan terpisah — jadi yang dilihat pengguna = yang akan terjadi.
//  - Koreksi finansial butuh PIN step-up (token pendek), jadi sesi login yang tertinggal terbuka
//    tidak cukup untuk mengubah angka buku besar.
//  - Jurnal yang sudah dicocokkan ke rekonsiliasi bank tidak boleh dibalik diam-diam.

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { toMoney, moneyToNumber } from "./money.js";
import { saldoBukuSampai } from "./rekonBank.js";
import { ENTITY_TYPES } from "../../lib/activityLog.js";

export class KoreksiError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = "KoreksiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ─── PIN STEP-UP ─────────────────────────────────────────────────────────
export const PIN_REGEX = /^\d{6}$/;
export const STEPUP_TTL_DETIK = 300;
const MAKS_GAGAL = 5;
const KUNCI_MENIT = 15;
const rahasia = () => `${process.env.JWT_SECRET}:finance-stepup`;

export async function statusPin(db, userId) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { financePinHash: true, financePinSetAt: true, financePinLockedUntil: true } });
  return {
    sudahDiatur: !!u?.financePinHash,
    diaturPada: u?.financePinSetAt || null,
    terkunciSampai: u?.financePinLockedUntil && u.financePinLockedUntil > new Date() ? u.financePinLockedUntil : null,
  };
}

/** Atur/ganti PIN — wajib memverifikasi password login (bukan PIN lama) supaya sesi curian tidak bisa mengganti PIN. */
export async function aturPin(db, { userId, password, pin }) {
  if (!PIN_REGEX.test(String(pin || ""))) throw new KoreksiError("PIN harus 6 digit angka", 400, "PIN_TIDAK_VALID");
  const u = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!u || !password || !(await bcrypt.compare(String(password), u.passwordHash))) {
    throw new KoreksiError("Password login salah — PIN tidak diubah", 403, "PASSWORD_SALAH");
  }
  await db.user.update({
    where: { id: userId },
    data: { financePinHash: await bcrypt.hash(String(pin), 10), financePinSetAt: new Date(), financePinFailed: 0, financePinLockedUntil: null },
  });
}

/** Verifikasi PIN -> token step-up berumur pendek (terikat ke pengguna). */
export async function verifikasiPin(db, { userId, pin }) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { financePinHash: true, financePinFailed: true, financePinLockedUntil: true } });
  if (!u?.financePinHash) throw new KoreksiError("PIN Finance belum diatur", 403, "STEPUP_PIN_BELUM_DIATUR");
  if (u.financePinLockedUntil && u.financePinLockedUntil > new Date()) {
    throw new KoreksiError("PIN terkunci karena terlalu banyak salah. Coba lagi beberapa menit lagi.", 429, "PIN_TERKUNCI");
  }
  const cocok = await bcrypt.compare(String(pin || ""), u.financePinHash);
  if (!cocok) {
    const gagal = (u.financePinFailed || 0) + 1;
    const kunci = gagal >= MAKS_GAGAL;
    await db.user.update({
      where: { id: userId },
      data: { financePinFailed: kunci ? 0 : gagal, financePinLockedUntil: kunci ? new Date(Date.now() + KUNCI_MENIT * 60_000) : null },
    });
    throw new KoreksiError(
      kunci ? `PIN salah ${MAKS_GAGAL} kali — dikunci ${KUNCI_MENIT} menit.` : `PIN salah (sisa percobaan ${MAKS_GAGAL - gagal}).`,
      kunci ? 429 : 403, kunci ? "PIN_TERKUNCI" : "PIN_SALAH",
    );
  }
  if (u.financePinFailed) await db.user.update({ where: { id: userId }, data: { financePinFailed: 0, financePinLockedUntil: null } });
  const token = jwt.sign({ sub: userId, typ: "finance-stepup" }, rahasia(), { expiresIn: STEPUP_TTL_DETIK, audience: "finance-stepup" });
  return { token, berlakuDetik: STEPUP_TTL_DETIK };
}

/** Pastikan permintaan membawa token step-up yang sah milik pengguna yang sama. Melempar 403 dengan kode yang dipahami UI. */
export async function pastikanStepUp(db, req) {
  const token = req.get("X-Finance-Stepup");
  if (token) {
    try {
      const p = jwt.verify(token, rahasia(), { audience: "finance-stepup" });
      if (p.sub === req.user.id) return;
    } catch { /* jatuh ke penolakan di bawah */ }
  }
  const { sudahDiatur } = await statusPin(db, req.user.id);
  throw new KoreksiError(
    sudahDiatur ? "Koreksi finansial butuh konfirmasi PIN Finance." : "Atur PIN Finance dulu sebelum mengoreksi transaksi yang sudah masuk buku besar.",
    403, sudahDiatur ? "STEPUP_DIPERLUKAN" : "STEPUP_PIN_BELUM_DIATUR",
  );
}

// ─── PRATINJAU (rollback) ────────────────────────────────────────────────
export class PratinjauKoreksi extends Error {
  constructor(data) { super("pratinjau"); this.data = data; }
}

const sumberOr = (sources) => sources.map(({ source, sourceId }) => ({ source, sourceId }));

/** Status semua jurnal dokumen SEBELUM koreksi dijalankan. */
export async function snapshotJurnal(tx, sources) {
  const rows = await tx.finJournalEntry.findMany({ where: { OR: sumberOr(sources) }, select: { id: true, status: true } });
  return new Map(rows.map((r) => [r.id, r.status]));
}

const lineInclude = { include: { account: { select: { code: true, name: true } }, cashAccount: { select: { id: true, name: true, accountId: true } } }, orderBy: { lineNo: "asc" } };
const bentukEntry = (e) => ({
  id: e.id, nomor: e.entryNumber, tanggal: e.date, deskripsi: e.description, status: e.status,
  baris: e.lines.map((l) => ({
    akun: `${l.account.code} ${l.account.name}`, debit: moneyToNumber(l.debit), kredit: moneyToNumber(l.credit),
    rekening: l.cashAccount?.name || null,
  })),
  totalDebit: moneyToNumber(e.lines.reduce((a, l) => a.plus(toMoney(l.debit)), toMoney(0))),
  totalKredit: moneyToNumber(e.lines.reduce((a, l) => a.plus(toMoney(l.credit)), toMoney(0))),
});

/** Susun pratinjau dampak koreksi: jurnal dibalik, jurnal pengganti, dan perubahan saldo tiap rekening. */
export async function susunPratinjau(tx, { sebelum, sources, perubahan }) {
  const semua = await tx.finJournalEntry.findMany({ where: { OR: sumberOr(sources) }, include: { lines: lineInclude } });
  const dibalik = semua.filter((e) => sebelum.get(e.id) === "POSTED" && e.status === "REVERSED");
  const pengganti = semua.filter((e) => !sebelum.has(e.id) && e.status === "POSTED");
  const balikan = dibalik.length
    ? await tx.finJournalEntry.findMany({ where: { reversalOfId: { in: dibalik.map((e) => e.id) } }, include: { lines: lineInclude } })
    : [];

  // Dampak saldo tiap rekening kas/bank: hanya baris pada AKUN kas/bank rekening itu sendiri.
  const delta = new Map();
  for (const e of [...balikan, ...pengganti]) {
    for (const l of e.lines) {
      if (!l.cashAccount || l.accountId !== l.cashAccount.accountId) continue;
      const d = delta.get(l.cashAccount.id) || { id: l.cashAccount.id, nama: l.cashAccount.name, selisih: toMoney(0) };
      d.selisih = d.selisih.plus(toMoney(l.debit)).minus(toMoney(l.credit));
      delta.set(l.cashAccount.id, d);
    }
  }
  const akhir = new Date("2999-12-31T00:00:00Z");
  const dampakSaldo = [];
  for (const d of delta.values()) {
    const sesudah = await saldoBukuSampai(tx, d.id, akhir);
    dampakSaldo.push({
      rekeningId: d.id, rekening: d.nama, sebelum: moneyToNumber(sesudah.minus(d.selisih)),
      sesudah: moneyToNumber(sesudah), selisih: moneyToNumber(d.selisih),
    });
  }

  return {
    perubahan: Object.keys(perubahan?.after || {}).map((k) => ({ field: k, lama: perubahan.before?.[k] ?? null, baru: perubahan.after[k] })),
    menyentuhJurnal: dibalik.length > 0 || pengganti.length > 0,
    jurnalDibalik: dibalik.map(bentukEntry),
    jurnalPengganti: pengganti.map(bentukEntry),
    dampakSaldo,
    seimbang: pengganti.every((e) => bentukEntry(e).totalDebit === bentukEntry(e).totalKredit),
  };
}

// ─── PENGAMAN ────────────────────────────────────────────────────────────
/** Jurnal yang sudah dicocokkan ke mutasi bank tidak boleh dibalik: hasil rekonsiliasi akan rusak diam-diam. */
export async function pastikanBelumDirekonsiliasi(tx, sources) {
  const lines = await tx.finJournalLine.findMany({ where: { entry: { status: "POSTED", OR: sumberOr(sources) } }, select: { id: true } });
  if (lines.length === 0) return;
  const n = await tx.finBankStatementLine.count({ where: { matchedLineId: { in: lines.map((l) => l.id) } } });
  if (n > 0) {
    throw new KoreksiError(
      "Jurnal transaksi ini sudah dicocokkan dengan mutasi bank (Rekonsiliasi Bank). Lepas pencocokannya di Rekonsiliasi Bank dulu, baru koreksi.",
      409, "SUDAH_DIREKONSILIASI",
    );
  }
}

// ─── RIWAYAT VERSI ───────────────────────────────────────────────────────
export const JENIS_DOKUMEN = {
  expenses: { model: "finExpense", nomor: "expenseNumber", entity: ENTITY_TYPES.FIN_EXPENSE, source: "PENGELUARAN" },
  purchases: { model: "finPurchase", nomor: "purchaseNumber", entity: ENTITY_TYPES.FIN_PURCHASE, source: "PEMBELIAN" },
  transfers: { model: "finCashTransfer", nomor: "transferNumber", entity: ENTITY_TYPES.FIN_CASH_TRANSFER, source: "TRANSFER_KAS" },
  "other-income": { model: "finOtherIncome", nomor: "incomeNumber", entity: ENTITY_TYPES.FIN_OTHER_INCOME, source: "PEMASUKAN_LAIN" },
  kasbon: { model: "finKasbon", nomor: "kasbonNumber", entity: ENTITY_TYPES.FIN_KASBON, source: "KASBON" },
  refunds: { model: "finRefund", nomor: "refundNumber", entity: ENTITY_TYPES.FIN_REFUND, source: "REFUND" },
  bills: { model: "finSupplierBill", nomor: "billNumber", entity: ENTITY_TYPES.FIN_SUPPLIER_BILL, source: "TAGIHAN_SUPPLIER" },
  "supplier-payments": { model: "finSupplierPayment", nomor: "paymentNumber", entity: null, source: "PEMBAYARAN_SUPPLIER" },
  "uang-muka": { model: "finOperationalAdvance", nomor: "advanceNumber", entity: ENTITY_TYPES.FIN_UANG_MUKA, source: "UANG_MUKA_OPERASIONAL" },
};

const LABEL_AKSI = {
  DOCUMENT_CREATED: "Dibuat", DOCUMENT_EDITED: "Diedit", DOCUMENT_CORRECTED: "Dikoreksi", DOCUMENT_APPROVED: "Disetujui",
  DOCUMENT_POSTED: "Diposting", DOCUMENT_CANCELLED: "Dibatalkan", DOCUMENT_REJECTED: "Ditolak",
};

function ubahKePerubahan(m) {
  if (m?.changes && typeof m.changes === "object") {
    return Object.entries(m.changes).map(([field, v]) => ({ field, lama: v?.from ?? null, baru: v?.to ?? null }));
  }
  if (m?.after && typeof m.after === "object") {
    return Object.keys(m.after).map((field) => ({ field, lama: m.before?.[field] ?? null, baru: m.after[field] }));
  }
  return [];
}

/** Riwayat versi satu dokumen: siapa, kapan, alasan, perubahan, serta rantai jurnal (asli -> dibalik -> pengganti). */
export async function riwayatVersi(db, jenis, id) {
  const cfg = JENIS_DOKUMEN[jenis];
  if (!cfg) throw new KoreksiError("Jenis dokumen tidak dikenal", 404);
  const doc = await db[cfg.model].findUnique({ where: { id } });
  if (!doc) throw new KoreksiError("Dokumen tidak ditemukan", 404);

  const events = cfg.entity
    ? await db.activityEvent.findMany({ where: { entityType: cfg.entity, entityId: id }, orderBy: { createdAt: "asc" } })
    : [];
  const aktorIds = [...new Set(events.map((e) => e.actorId).filter(Boolean))];
  const aktor = aktorIds.length ? await db.user.findMany({ where: { id: { in: aktorIds } }, select: { id: true, name: true } }) : [];
  const namaAktor = new Map(aktor.map((a) => [a.id, a.name]));

  const versi = events.map((e) => ({
    waktu: e.createdAt, aksi: LABEL_AKSI[e.eventType] || e.eventType, eventType: e.eventType,
    aktor: e.actorType === "SYSTEM" ? "Sistem" : (namaAktor.get(e.actorId) || "—"),
    alasan: e.metadata?.reason || e.metadata?.alasan || null,
    perubahan: ubahKePerubahan(e.metadata),
    otomatis: e.actorType === "SYSTEM",
  }));

  const entries = await db.finJournalEntry.findMany({
    where: { source: cfg.source, sourceId: id },
    include: { reversalOf: { select: { entryNumber: true } }, reversedBy: { select: { entryNumber: true, reversalReason: true } } },
    orderBy: { createdAt: "asc" },
  });
  const balikan = entries.length
    ? await db.finJournalEntry.findMany({ where: { reversalOfId: { in: entries.map((e) => e.id) } }, include: { reversalOf: { select: { entryNumber: true } } } })
    : [];
  const jurnal = [...entries, ...balikan]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((e) => ({
      id: e.id, nomor: e.entryNumber, tanggal: e.date, deskripsi: e.description, status: e.status, sumber: e.source,
      membalikJurnal: e.reversalOf?.entryNumber || null, dibalikOleh: e.reversedBy?.entryNumber || null,
      alasanBalik: e.reversalReason || e.reversedBy?.reversalReason || null, dibuatPada: e.createdAt,
    }));

  return { dokumen: { jenis, id, nomor: doc[cfg.nomor] }, versi, jurnal };
}

/** Nomor jurnal yang dibalik & yang menjadi pengganti pada koreksi ini — disimpan di log audit supaya dokumen & jurnal saling tertaut. */
export async function tautanJurnal(tx, sebelum, sources) {
  const semua = await tx.finJournalEntry.findMany({ where: { OR: sumberOr(sources) }, select: { id: true, entryNumber: true, status: true } });
  return {
    jurnalDibalik: semua.filter((e) => sebelum.get(e.id) === "POSTED" && e.status === "REVERSED").map((e) => e.entryNumber),
    jurnalPengganti: semua.filter((e) => !sebelum.has(e.id) && e.status === "POSTED").map((e) => e.entryNumber),
  };
}
