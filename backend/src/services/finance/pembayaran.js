// PEMBAYARAN PELANGGAN — read-model & command untuk Finance Mobile S5 (daftar, detail, verifikasi, penolakan).
//
// TIDAK ada tabel/kolom baru. Yang dipakai persis yang sudah ada:
//   Payment (+ cancelledAt/cancelReason), PaymentVerification (unik per payment), FinPaymentAllocation,
//   jurnal PEMBAYARAN_ORDER:<paymentId>, ActivityEvent.
//
// STATUS (diturunkan server, tidak disimpan):
//   MENUNGGU       cancelledAt kosong & belum ada PaymentVerification
//   TERVERIFIKASI  cancelledAt kosong & ada PaymentVerification
//   DITOLAK        dibatalkan lewat penolakan Finance (ActivityEvent payment/DOCUMENT_REJECTED)
//   DIBATALKAN     dibatalkan dengan cara lain (admin di CRM: POST /orders/:id/payments/:id/cancel)
//
// KEPUTUSAN WORKFLOW (dokumentasi gap di docs/FINANCE-MOBILE-BACKEND.md):
//  • Verifikasi = PaymentVerification. Jurnal penerimaan SUDAH terposting saat pembayaran dicatat (routes/orders.js),
//    verifikasi tidak menjurnal ulang; efeknya pada status bayar order hanya bila "gerbang verifikasi" aktif.
//  • Penolakan = pembatalan Payment (append-only: cancelledAt + alasan) + pembalikan jurnal + hitung ulang status.
//    HANYA untuk pembayaran yang BELUM diverifikasi. Pembayaran yang sudah diverifikasi tidak bisa ditolak dari sini —
//    koreksinya tetap pembatalan oleh admin (kebijakan reversal tidak dikarang).
//  • Kelebihan bayar / tanpa alokasi / beda nominal: TIDAK ada kebijakan di backend selain "nominal ≤ sisa" pada
//    verifikasi penerimaan. Di sini hanya dilaporkan sebagai `peringatan` informatif; server tidak memblokir.
//  • Pencatatan pembayaran baru oleh Finance dari mobile TIDAK didukung workflow: Payment dicatat sales/driver
//    (POST /orders/:id/payments, tanpa izin granular) atau lahir dari "Lunas di CRM" (verifikasi penerimaan).

import { hasPermission } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { recomputeOrderPaymentStatus } from "../paymentLedger.js";
import { isPaymentCounted, paidForOrder } from "./allocation.js";
import { getVerificationGate } from "./settings.js";
import { batalkanJurnalPembayaran } from "./hooks.js";
import { findEntryByKey } from "./journal.js";
import { KEY as KEY_ORDER } from "./posting/orderRevenue.js";
import { toMoney, ZERO } from "./money.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";
import { FILE_PATTERN, MEDIA_SIGN_TTL_SECONDS, signFile } from "../../lib/mediaSigning.js";
import { RECEIPTS_URL_PREFIX } from "./receipts.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../../utils/wib.js";

export const STATUS_LIST = ["MENUNGGU", "TERVERIFIKASI", "DITOLAK", "DIBATALKAN"];
export const LABEL_STATUS = {
  MENUNGGU: "Menunggu verifikasi", TERVERIFIKASI: "Terverifikasi", DITOLAK: "Ditolak", DIBATALKAN: "Dibatalkan",
};
export const METODE_LIST = ["CASH", "TRANSFER", "QRIS", "CARD"];
const LABEL_METODE = { CASH: "Tunai", TRANSFER: "Transfer", QRIS: "QRIS", CARD: "Kartu" };
export const PAYMENT_PROOF_PREFIX = "/media/payment-proofs";
const ALASAN_MAKS = 500;

function err(message, statusCode = 400, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

const uang = (v) => toMoney(v ?? 0).toFixed(2);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orang = (u) => (u ? { id: u.id, name: u.name } : null);

/** Tanggal WIB (YYYY-MM-DD) dari sebuah instant. */
function tanggalWIB(instant) {
  return new Date(new Date(instant).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
const tglValid = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// ── Status ────────────────────────────────────────────────────────────────────────────────────────

export function statusDari(p, ditolakIds) {
  if (p.cancelledAt) return ditolakIds.has(p.id) ? "DITOLAK" : "DIBATALKAN";
  return p.verifications?.length ? "TERVERIFIKASI" : "MENUNGGU";
}

async function idDitolak(db, ids = null) {
  const baris = await db.activityEvent.findMany({
    where: { entityType: ENTITY_TYPES.PAYMENT, eventType: EVENT_TYPES.DOCUMENT_REJECTED, ...(ids ? { entityId: { in: ids } } : {}) },
    select: { entityId: true },
  });
  return new Set(baris.map((b) => b.entityId));
}

// ── Aksi (dihitung server; klien tidak menyalin aturan) ──────────────────────────────────────────

export function hitungAksi(p, status, user) {
  const punyaIzin = hasPermission(user, P.PAYMENT_WRITE);
  const base = (aksi) => ({ path: `/finance/pembayaran/${p.id}/${aksi}`, metode: "POST" });
  let alasan = null;
  if (!punyaIzin) alasan = "Akun Anda tidak punya izin memverifikasi pembayaran.";
  else if (status === "TERVERIFIKASI") alasan = "Pembayaran ini sudah diverifikasi.";
  else if (status === "DITOLAK" || status === "DIBATALKAN") alasan = "Pembayaran ini sudah dibatalkan.";
  const boleh = !alasan;
  return {
    verifikasi: { boleh, alasan, ...base("verifikasi") },
    tolak: { boleh, alasan, alasanWajib: true, ...base("tolak") },
  };
}

// ── Filter daftar ─────────────────────────────────────────────────────────────────────────────────

function klausaCari(q) {
  const kata = String(q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return kata.map((k) => {
    const atau = [
      { order: { orderNumber: { contains: k, mode: "insensitive" } } },
      { order: { customer: { name: { contains: k, mode: "insensitive" } } } },
      { recordedBy: { name: { contains: k, mode: "insensitive" } } },
      { cashAccount: { name: { contains: k, mode: "insensitive" } } },
    ];
    const angka = k.replace(/\./g, "");
    if (/^\d{3,12}$/.test(angka)) atau.push({ amount: Number(angka) });
    return { OR: atau };
  });
}

function whereDasar({ from, to, q, metode, rekeningId }) {
  return {
    ...(tglValid(from) && tglValid(to) && { createdAt: { gte: startOfDayWIB(from), lt: endOfDayExclusiveWIB(to) } }),
    ...(METODE_LIST.includes(metode) && { method: metode }),
    ...(rekeningId && UUID.test(rekeningId) && { cashAccountId: rekeningId }),
    ...(q && String(q).trim() ? { AND: klausaCari(q) } : {}),
  };
}

function whereStatus(status, ditolakIds) {
  const ids = [...ditolakIds];
  switch (status) {
    case "MENUNGGU": return { cancelledAt: null, verifications: { none: {} } };
    case "TERVERIFIKASI": return { cancelledAt: null, verifications: { some: {} } };
    case "DITOLAK": return { cancelledAt: { not: null }, id: { in: ids } };
    case "DIBATALKAN": return { cancelledAt: { not: null }, id: { notIn: ids } };
    default: return {};
  }
}

const INCLUDE_LIST = {
  cashAccount: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  verifications: { select: { id: true, createdAt: true, verifiedBy: { select: { id: true, name: true } } } },
  finAllocations: { select: { id: true, orderId: true, amount: true } },
  order: { select: { id: true, orderNumber: true, value: true, paymentStatus: true, customer: { select: { id: true, name: true } } } },
  job: { select: { id: true, type: true } },
};

// ── Jenis (DP / cicilan / pelunasan) — TURUNAN, bukan field server ───────────────────────────────

/**
 * Untuk sebuah pembayaran: DP bila ini pembayaran pertama order dan belum melunasi, PELUNASAN bila kumulatif s/d
 * pembayaran ini ≥ nilai order, selain itu CICILAN. Hanya pembayaran yang tidak dibatalkan yang dihitung.
 */
export async function jenisUntuk(db, payments) {
  const orderIds = [...new Set(payments.map((p) => p.orderId))];
  const semua = orderIds.length
    ? await db.payment.findMany({
      where: { orderId: { in: orderIds }, cancelledAt: null },
      select: { id: true, orderId: true, amount: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
    : [];
  const peta = new Map();
  const perOrder = new Map();
  for (const p of semua) {
    const daftar = perOrder.get(p.orderId) ?? [];
    daftar.push(p);
    perOrder.set(p.orderId, daftar);
  }
  for (const p of payments) {
    const nilai = p.order?.value ?? 0;
    const daftar = perOrder.get(p.orderId) ?? [];
    const idx = daftar.findIndex((x) => x.id === p.id);
    if (idx === -1) { peta.set(p.id, null); continue; } // dibatalkan → tidak diklasifikasi
    const kumulatif = daftar.slice(0, idx + 1).reduce((s, x) => s + x.amount, 0);
    peta.set(p.id, nilai > 0 && kumulatif >= nilai ? "PELUNASAN" : idx === 0 ? "DP" : "CICILAN");
  }
  return peta;
}

// ── Normalisasi item ──────────────────────────────────────────────────────────────────────────────

const adaBukti = (p) => !!(p.proofPhotoUrl && String(p.proofPhotoUrl).trim());

function normalisasi(p, status, jenis, user) {
  const verif = p.verifications?.[0] ?? null;
  return {
    id: p.id,
    status,
    statusLabel: LABEL_STATUS[status],
    nominal: uang(p.amount),
    metode: p.method,
    metodeLabel: LABEL_METODE[p.method] ?? p.method,
    jenis: jenis ?? null,
    dicatatPada: iso(p.createdAt),
    tanggal: tanggalWIB(p.createdAt),
    order: p.order ? { id: p.order.id, nomor: p.order.orderNumber, nilai: uang(p.order.value), statusBayar: p.order.paymentStatus } : null,
    pelanggan: orang(p.order?.customer),
    rekening: p.cashAccount ? { id: p.cashAccount.id, name: p.cashAccount.name } : null,
    pencatat: orang(p.recordedBy),
    sumber: p.job ? "PENGIRIMAN" : "CRM",
    adaBukti: adaBukti(p),
    adaAlokasi: (p.finAllocations?.length ?? 0) > 0,
    verifikasi: verif ? { oleh: orang(verif.verifiedBy), pada: iso(verif.createdAt) } : null,
    pembatalan: p.cancelledAt ? { oleh: orang(p.cancelledBy), pada: iso(p.cancelledAt), alasan: p.cancelReason ?? null } : null,
    aksi: hitungAksi(p, status, user),
  };
}

// ── Daftar ────────────────────────────────────────────────────────────────────────────────────────

function encCursor(p) { return Buffer.from(`${new Date(p.createdAt).toISOString()}|${p.id}`).toString("base64url"); }
function decCursor(c) {
  if (!c) return null;
  try {
    const [t, id] = Buffer.from(String(c), "base64url").toString("utf8").split("|");
    const d = new Date(t);
    return Number.isNaN(d.getTime()) || !UUID.test(id || "") ? null : { createdAt: d, id };
  } catch { return null; }
}

/** Ringkasan periode — TIDAK tergantung tab/filter (kartu angka harus stabil saat pindah tab). */
export async function ringkasanPeriode(db, { from, to } = {}) {
  const dasar = whereDasar({ from, to });
  const ditolak = await idDitolak(db);
  const agg = async (status) => {
    const r = await db.payment.aggregate({ where: { ...dasar, ...whereStatus(status, ditolak) }, _count: { _all: true }, _sum: { amount: true } });
    return { jumlah: r._count._all, nominal: uang(r._sum.amount ?? 0) };
  };
  const [menunggu, terverifikasi, ditolakAgg, dibatalkan] = await Promise.all(STATUS_LIST.map(agg));
  const masuk = toMoney(menunggu.nominal).plus(terverifikasi.nominal);
  return { menunggu, terverifikasi, ditolak: ditolakAgg, dibatalkan, totalMasuk: masuk.toFixed(2) };
}

/** Jumlah menunggu (lencana tab) — tanpa filter. */
export async function ringkasanMenunggu(db) {
  const [pembayaran, lunasCrm] = await Promise.all([
    db.payment.count({ where: { cancelledAt: null, verifications: { none: {} } } }),
    db.order.count({ where: { paymentStatus: "LUNAS", value: { gt: 0 }, status: { not: "CANCELLED" }, payments: { none: {} } } }),
  ]);
  return { menunggu: pembayaran, lunasBelumDicatat: lunasCrm };
}

export async function daftarPembayaran(db, user, opsi = {}) {
  const status = STATUS_LIST.includes(String(opsi.status || "").toUpperCase()) ? String(opsi.status).toUpperCase() : null;
  const limit = Math.min(Math.max(parseInt(opsi.limit, 10) || 20, 1), 50);
  const cur = decCursor(opsi.cursor);
  const ditolak = await idDitolak(db);
  const dasar = whereDasar(opsi);

  const where = {
    ...dasar,
    ...whereStatus(status, ditolak),
    ...(cur && { OR: [{ createdAt: { lt: cur.createdAt } }, { createdAt: cur.createdAt, id: { lt: cur.id } }] }),
  };
  // Cursor memakai OR sendiri — gabungkan dengan AND pencarian tanpa menimpa.
  const whereAkhir = cur && dasar.AND ? { AND: [{ ...dasar, ...whereStatus(status, ditolak) }, { OR: where.OR }] } : where;

  const [rows, hitungan, ringkasan, diperbarui] = await Promise.all([
    db.payment.findMany({
      where: whereAkhir, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, include: INCLUDE_LIST,
    }),
    Promise.all(STATUS_LIST.map((s) => db.payment.count({ where: { ...dasar, ...whereStatus(s, ditolak) } }))),
    ringkasanPeriode(db, { from: opsi.from, to: opsi.to }),
    Promise.resolve(new Date()),
  ]);
  const adaLagi = rows.length > limit;
  const halaman = adaLagi ? rows.slice(0, limit) : rows;
  const jenis = await jenisUntuk(db, halaman);
  const items = halaman.map((p) => normalisasi(p, statusDari(p, ditolak), jenis.get(p.id), user));

  return {
    items,
    nextCursor: adaLagi ? encCursor(halaman[halaman.length - 1]) : null,
    hitung: Object.fromEntries(STATUS_LIST.map((s, i) => [s, hitungan[i]])),
    ringkasan,
    diperbaruiPada: diperbarui.toISOString(),
  };
}

/** Pilihan filter: rekening aktif + metode. */
export async function opsiFilter(db) {
  const rekening = await db.finCashAccount.findMany({
    where: { active: true }, select: { id: true, name: true, kind: true }, orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return { rekening, metode: METODE_LIST.map((m) => ({ id: m, label: LABEL_METODE[m] })) };
}

// ── Bukti ─────────────────────────────────────────────────────────────────────────────────────────

const EKSTENSI_BUKTI = /\.(jpe?g|png|webp|pdf)$/i;

/** Nama file bukti bila URL milik server ini (finance-receipts atau payment-proofs); selain itu null. */
export function fileBukti(url) {
  const s = String(url || "").split("?")[0];
  if (s.startsWith(`${RECEIPTS_URL_PREFIX}/`)) {
    const f = s.slice(RECEIPTS_URL_PREFIX.length + 1);
    return FILE_PATTERN.test(f) ? { sumber: "receipts", file: f } : null;
  }
  if (s.startsWith(`${PAYMENT_PROOF_PREFIX}/`)) {
    const f = s.slice(PAYMENT_PROOF_PREFIX.length + 1);
    return /^[A-Za-z0-9._-]{3,200}$/.test(f) && !f.includes("..") && EKSTENSI_BUKTI.test(f) ? { sumber: "payment-proofs", file: f } : null;
  }
  return null;
}

/** Bukti → tautan bertanda-tangan berumur pendek (10 mnt). Tautan lain tidak diproksikan. */
export function bangunBukti(p) {
  if (!adaBukti(p)) return null;
  const f = fileBukti(p.proofPhotoUrl);
  if (!f) return { jenis: "tautan", url: null, thumbUrl: null, kedaluwarsa: null };
  const pdf = /\.pdf$/i.test(f.file);
  const a = signFile(f.file);
  const dasar = f.sumber === "receipts" ? `${RECEIPTS_URL_PREFIX}/${f.file}` : `/media/bukti-pembayaran/${f.file}`;
  let thumb = null;
  if (f.sumber === "receipts" && !pdf) {
    const t = signFile(f.file.replace(/\.jpg$/, "_t.jpg"));
    thumb = `${RECEIPTS_URL_PREFIX}/${f.file.replace(/\.jpg$/, "_t.jpg")}?exp=${t.exp}&sig=${t.sig}`;
  }
  return {
    jenis: pdf ? "pdf" : "gambar",
    url: `${dasar}?exp=${a.exp}&sig=${a.sig}`,
    thumbUrl: thumb,
    kedaluwarsa: new Date(Date.now() + MEDIA_SIGN_TTL_SECONDS * 1000).toISOString(),
  };
}

// ── Detail ────────────────────────────────────────────────────────────────────────────────────────

const LABEL_PERISTIWA = {
  DOCUMENT_APPROVED: "Diverifikasi", DOCUMENT_REJECTED: "Ditolak", DOCUMENT_POSTED: "Diverifikasi & dibukukan", DOCUMENT_CANCELLED: "Dibatalkan",
};

async function bangunRiwayat(db, p, status) {
  const [langsung, viaOrder] = await Promise.all([
    db.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.PAYMENT, entityId: p.id }, orderBy: { createdAt: "asc" }, take: 50 }),
    // Verifikasi penerimaan ("Lunas di CRM") direkam di entitas ORDER dengan metadata.paymentId.
    db.activityEvent.findMany({
      where: { entityType: ENTITY_TYPES.ORDER, entityId: p.orderId, metadata: { path: ["paymentId"], equals: p.id } },
      orderBy: { createdAt: "asc" }, take: 20,
    }),
  ]);
  const events = [...langsung, ...viaOrder];
  const idPelaku = [...new Set(events.map((e) => e.actorId).filter(Boolean))];
  const pelaku = idPelaku.length ? await db.user.findMany({ where: { id: { in: idPelaku } }, select: { id: true, name: true } }) : [];
  const nama = new Map(pelaku.map((u) => [u.id, u.name]));

  const riwayat = [{ waktu: iso(p.createdAt), peristiwa: "DICATAT", label: "Dicatat", oleh: p.recordedBy?.name ?? null, catatan: null }];
  const sudahVerif = new Set();
  for (const e of events) {
    const md = e.metadata && typeof e.metadata === "object" ? e.metadata : {};
    if (e.eventType === "DOCUMENT_APPROVED" || md.aksi === "verifikasi_penerimaan") sudahVerif.add("v");
    riwayat.push({
      waktu: iso(e.createdAt), peristiwa: e.eventType,
      label: md.aksi === "verifikasi_penerimaan" ? "Diverifikasi dari \"Lunas di CRM\"" : LABEL_PERISTIWA[e.eventType] ?? "Aktivitas",
      oleh: e.actorId ? nama.get(e.actorId) ?? null : null,
      catatan: typeof md.reason === "string" ? md.reason : null,
    });
  }
  // Data lama (verifikasi sebelum audit S5 ada): tetap tampilkan dari PaymentVerification.
  const v = p.verifications?.[0];
  if (v && !sudahVerif.size) riwayat.push({ waktu: iso(v.createdAt), peristiwa: "DIVERIFIKASI", label: "Diverifikasi", oleh: v.verifiedBy?.name ?? null, catatan: null });
  if (p.cancelledAt && !events.some((e) => e.eventType === "DOCUMENT_REJECTED")) {
    riwayat.push({ waktu: iso(p.cancelledAt), peristiwa: "DIBATALKAN", label: status === "DITOLAK" ? "Ditolak" : "Dibatalkan", oleh: p.cancelledBy?.name ?? null, catatan: p.cancelReason ?? null });
  }
  return riwayat.sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
}

/** Peringatan informatif untuk pemeriksa. Server TIDAK memblokir — tidak ada kebijakan backend untuk ini. */
function bangunPeringatan({ p, status, tagihan, kembar }) {
  const w = [];
  if (status === "MENUNGGU" && !adaBukti(p) && p.method !== "CASH") w.push({ kode: "TANPA_BUKTI", pesan: "Belum ada bukti pembayaran terlampir." });
  if (p.order && toMoney(p.amount).greaterThan(toMoney(p.order.value))) w.push({ kode: "NOMINAL_MELEBIHI_ORDER", pesan: "Nominal lebih besar dari nilai order." });
  if (tagihan && status === "MENUNGGU" && toMoney(tagihan.sisaSetelahIni).lessThan(0)) {
    w.push({ kode: "KELEBIHAN_BAYAR", pesan: "Bersama pembayaran lain, total melebihi nilai order (kelebihan bayar). Sistem tidak punya aturan khusus; periksa manual." });
  }
  if (!(p.finAllocations?.length) && !p.order) w.push({ kode: "TANPA_ORDER", pesan: "Pembayaran tidak terhubung ke order." });
  if (kembar > 0) w.push({ kode: "KEMUNGKINAN_GANDA", pesan: `Ada ${kembar} pembayaran lain untuk order yang sama dengan nominal & cara bayar yang sama dalam 24 jam.` });
  return w;
}

export async function detailPembayaran(db, user, id) {
  if (!UUID.test(String(id))) return null;
  const p = await db.payment.findUnique({ where: { id }, include: { ...INCLUDE_LIST, order: { select: { id: true, orderNumber: true, value: true, paymentStatus: true, status: true, customer: { select: { id: true, name: true } }, invoice: { select: { invoiceNumber: true, lifecycleStatus: true, dueDate: true, cancelledAt: true } } } } } });
  if (!p) return null;
  const ditolak = await idDitolak(db, [p.id]);
  const status = statusDari(p, ditolak);
  const jenis = await jenisUntuk(db, [p]);

  const gate = await getVerificationGate(db);
  const alokasi = await db.finPaymentAllocation.findMany({
    where: { paymentId: p.id }, select: { orderId: true, amount: true, note: true, order: { select: { orderNumber: true } } },
  });
  const terhitung = p.order ? await paidForOrder(db, p.order.id, gate) : ZERO;
  const nilaiOrder = toMoney(p.order?.value ?? 0);
  // Apakah pembayaran ini SUDAH ikut di `terhitung`? Jawabannya dari aturan resmi (isPaymentCounted): gerbang mati, gerbang tanpa
  // tanggal mulai, atau pembayaran lebih tua dari tanggal mulai → sudah terhitung walau belum diverifikasi. Hanya bila BELUM terhitung
  // pembayaran menunggu ini dikurangkan lagi ("sisa jika ikut dihitung") — kalau tidak, nominalnya terhitung dua kali.
  const sudahTerhitung = !!p.order && status === "MENUNGGU" && isPaymentCounted(p, gate);
  // Bagian pembayaran ini untuk order induknya: nominal penuh, atau jumlah alokasi ke order itu bila dialokasikan.
  const bagianOrder = alokasi.length && p.order
    ? alokasi.filter((a) => a.orderId === p.order.id).reduce((t, a) => t.plus(toMoney(a.amount)), ZERO)
    : toMoney(p.amount);
  const tagihan = p.order ? {
    nilaiOrder: uang(nilaiOrder), terbayarTerhitung: uang(terhitung), sisa: uang(nilaiOrder.minus(terhitung)),
    sisaSetelahIni: uang(nilaiOrder.minus(terhitung).minus(status === "MENUNGGU" && !sudahTerhitung ? bagianOrder : 0)),
    gerbangVerifikasi: gate.enabled,
    /** true = pembayaran ini SUDAH terhitung di status bayar CRM sebelum diverifikasi (gerbang belum berlaku untuknya). */
    terhitungSebelumVerifikasi: sudahTerhitung,
  } : null;

  const [jurnal, gap, kembar, riwayat] = await Promise.all([
    findEntryByKey(db, KEY_ORDER.payment(p.id)),
    db.finPostingGap.findUnique({ where: { source_sourceId: { source: "PEMBAYARAN_ORDER", sourceId: p.id } } }).catch(() => null),
    db.payment.count({
      where: {
        id: { not: p.id }, orderId: p.orderId, amount: p.amount, method: p.method, cancelledAt: null,
        createdAt: { gte: new Date(p.createdAt.getTime() - 86400000), lte: new Date(p.createdAt.getTime() + 86400000) },
      },
    }),
    bangunRiwayat(db, p, status),
  ]);

  const item = normalisasi(p, status, jenis.get(p.id), user);
  const inv = p.order?.invoice;
  return {
    ...item,
    tagihan,
    invoice: inv ? { nomor: inv.invoiceNumber, status: inv.cancelledAt ? "CANCELLED" : inv.lifecycleStatus, jatuhTempo: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : null } : null,
    statusOrder: p.order?.status ?? null,
    alokasi: alokasi.map((a) => ({ orderId: a.orderId, nomor: a.order?.orderNumber ?? null, nominal: uang(a.amount), catatan: a.note ?? null })),
    jurnal: jurnal ? { nomor: jurnal.entryNumber ?? null, status: jurnal.status, tanggal: jurnal.date ? new Date(jurnal.date).toISOString().slice(0, 10) : null } : null,
    belumDibukukan: !jurnal && !!gap && !gap.resolvedAt ? { pesan: gap.detail } : null,
    bukti: bangunBukti(p),
    // Field yang TIDAK ada di model Payment — dinyatakan jujur, bukan dikosongkan diam-diam.
    tidakTercatat: ["referensi", "pengirim", "catatan"],
    peringatan: bangunPeringatan({ p, status, tagihan, kembar }),
    riwayat,
  };
}

// ── Command ───────────────────────────────────────────────────────────────────────────────────────

/** Order yang status bayarnya bisa berubah oleh payment ini: order induk + semua order tujuan alokasi. */
async function orderTerdampak(tx, p) {
  const alokasi = await tx.finPaymentAllocation.findMany({ where: { paymentId: p.id }, select: { orderId: true } });
  return [...new Set([p.orderId, ...alokasi.map((a) => a.orderId)])];
}

async function kunciPayment(tx, id) {
  if (!UUID.test(String(id))) throw err("Pembayaran tidak ditemukan", 404);
  await lockRowForUpdate(tx, "payments", id);
  const p = await tx.payment.findUnique({
    where: { id },
    select: {
      id: true, orderId: true, amount: true, method: true, cancelledAt: true,
      verifications: { select: { createdAt: true, verifiedBy: { select: { name: true } } } },
      order: { select: { orderNumber: true } },
    },
  });
  if (!p) throw err("Pembayaran tidak ditemukan", 404);
  return p;
}

/**
 * Verifikasi satu pembayaran. Dijalankan DI DALAM `prisma.$transaction`: baris payment dikunci (FOR UPDATE) sehingga
 * dua verifikasi paralel tidak bisa lolos bersamaan — yang kedua melihat verifikasi pertama dan mendapat 409.
 */
export async function verifikasiPembayaran(tx, { paymentId, userId }) {
  const p = await kunciPayment(tx, paymentId);
  if (p.cancelledAt) throw err("Pembayaran ini sudah dibatalkan, tidak bisa diverifikasi.", 409, { code: "SUDAH_DIBATALKAN" });
  if (p.verifications.length) {
    const v = p.verifications[0];
    throw err(`Pembayaran ini sudah diverifikasi oleh ${v.verifiedBy?.name ?? "pengguna lain"}.`, 409, { code: "SUDAH_DIPROSES" });
  }
  await tx.paymentVerification.create({ data: { paymentId: p.id, verifiedById: userId } });
  const orderIds = await orderTerdampak(tx, p);
  for (const oid of orderIds) {
    await lockRowForUpdate(tx, '"Order"', oid, { cast: null });
    await recomputeOrderPaymentStatus(tx, oid);
  }
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.PAYMENT, entityId: p.id, eventType: EVENT_TYPES.DOCUMENT_APPROVED, actorId: userId,
    metadata: { aksi: "verifikasi_pembayaran", orderNumber: p.order?.orderNumber ?? null, amount: uang(p.amount), method: p.method },
  });
  return { paymentId: p.id, orderIds };
}

/**
 * Tolak pembayaran BELUM diverifikasi (uang tidak masuk / salah catat): batalkan Payment, balik jurnalnya, hitung ulang
 * status bayar order. Alasan wajib. Pembayaran yang sudah diverifikasi ditolak dengan 409 (koreksinya di luar S5).
 */
export async function tolakPembayaran(tx, { paymentId, reason, userId }) {
  const alasan = String(reason ?? "").trim();
  if (!alasan) throw err("Alasan penolakan wajib diisi.", 400, { code: "ALASAN_WAJIB" });
  if (alasan.length > ALASAN_MAKS) throw err(`Alasan maksimal ${ALASAN_MAKS} karakter.`, 400);
  const p = await kunciPayment(tx, paymentId);
  if (p.cancelledAt) throw err("Pembayaran ini sudah dibatalkan sebelumnya.", 409, { code: "SUDAH_DIBATALKAN" });
  if (p.verifications.length) {
    const v = p.verifications[0];
    throw err(`Pembayaran ini sudah diverifikasi oleh ${v.verifiedBy?.name ?? "pengguna lain"} dan tidak bisa ditolak dari sini. Koreksi lewat admin.`, 409, { code: "SUDAH_DIPROSES" });
  }
  await tx.payment.update({ where: { id: p.id }, data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: alasan } });
  const jurnal = await batalkanJurnalPembayaran(tx, { paymentId: p.id, reason: `Pembayaran ditolak Finance: ${alasan}`, userId });
  const orderIds = await orderTerdampak(tx, p);
  const status = [];
  for (const oid of orderIds) {
    await lockRowForUpdate(tx, '"Order"', oid, { cast: null });
    status.push({ orderId: oid, ...(await recomputeOrderPaymentStatus(tx, oid)) });
  }
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.PAYMENT, entityId: p.id, eventType: EVENT_TYPES.DOCUMENT_REJECTED, actorId: userId,
    metadata: { aksi: "tolak_pembayaran", reason: alasan, orderNumber: p.order?.orderNumber ?? null, amount: uang(p.amount), jurnalDibalik: !!jurnal?.reversed },
  });
  return { paymentId: p.id, orderIds, status, jurnal };
}
