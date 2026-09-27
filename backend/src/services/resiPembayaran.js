// RESI GABUNGAN — FASE 3A: pembayaran/DP Resi, alokasi otomatis ke child order, klaim Lunas level Resi.
//
// PRINSIP (keputusan owner, dokumen: docs/RESI-GABUNGAN-FASE3.md):
//  - TIDAK ada ledger baru. Satu pembayaran/DP Resi = SATU Payment pada order ANCHOR (yang sudah ada) + FinPaymentAllocation ke seluruh
//    child order aktif (tabel alokasi yang sudah ada). Jurnal tetap postPaymentReceived: Dr Kas/Bank sekali (total), Cr Piutang/Uang Muka
//    SATU BARIS PER CHILD sesuai alokasi. Tidak ada uang masuk ganda dan tidak ada pengakuan pendapatan tambahan.
//  - Server-authoritative: pembagian alokasi SELALU dihitung server dari sisa tagihan child aktif; nominal pembagian dari klien tidak dipercaya.
//  - Flag RESI_PEMBAYARAN_AKTIF (default MATI) — semua fungsi publik menolak 403 bila mati.
//  - Hanya group source BARU. Group BACKFILL_BUNDLE TIDAK masuk alur ini sebelum backfill resmi.
//  - Order tunggal / groupId NULL: tidak disentuh sama sekali.
//
// ATURAN ANGKA
//  - tagihan child = Order.value + Order.ongkir (Ongkir Tambahan hanya menempel di anchor). Sama dengan Total Resi / dasar DP 30% Fase 1.
//  - dibayar child = paidForOrder TANPA gerbang verifikasi (semua payment tidak dibatalkan; konservatif — uang yang sudah dicatat Sales tetap
//    mengurangi sisa walau belum diverifikasi Finance, supaya tidak pernah over-alokasi).
//  - mode TAGIHAN: bobot = sisa tagihan child aktif. mode DP: bobot = sisa DP = max(min(dpTarget, tagihan) - dibayar, 0); tanpa pembayaran
//    sebelumnya alokasi DP PERSIS sama dengan dpTarget tiap child (Σ dpTarget = DP 30% Total Resi).
//  - pembagian: largest-remainder (bagiProporsional) sehingga Σ alokasi TEPAT sama dengan nominal Payment; baris 0 dibuang.
//
// YANG SENGAJA BELUM (Fase 3B, lihat dokumen): pembatalan/refund child. Child yang sudah menerima alokasi TIDAK boleh dibatalkan diam-diam
// (guard di checkCancelBlockers, routes/orders.js).

import { prisma } from "../db.js";
import { bagiProporsional } from "./resi.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { paidForOrder, setAllocations, AllocationError } from "./finance/allocation.js";
import { recomputeOrderPaymentStatus } from "./paymentLedger.js";
import { bukukanPembayaran } from "./finance/hooks.js";
import { getSettingRaw, parseBool, SETTING_KEYS } from "./finance/settings.js";
import { moneyToNumber } from "./finance/money.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const TIPE_BAYAR = Object.freeze({ DP: "DP", TAGIHAN: "TAGIHAN" });
const METODE = ["CASH", "TRANSFER", "QRIS", "CARD"];
const GATE_MATI = Object.freeze({ enabled: false });

export class ResiBayarError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = "ResiBayarError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function resiPembayaranAktif(db = prisma) {
  return parseBool(await getSettingRaw(db, SETTING_KEYS.RESI_PEMBAYARAN_AKTIF));
}

async function pastikanAktif(db) {
  if (!(await resiPembayaranAktif(db))) throw new ResiBayarError("Pembayaran Resi belum diaktifkan", 403, "RESI_PEMBAYARAN_MATI");
}

export const tagihanAnak = (o) => (Number(o.value) || 0) + (Number(o.ongkir) || 0);

// ── perhitungan murni ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Hitung alokasi otomatis. MURNI (tanpa DB). `anak` = semua child (child CANCELLED diabaikan), `dibayar` = Map orderId → Rupiah yang sudah tercatat.
 * Mengembalikan { tipe, nominal, alokasi (semua child aktif, termasuk 0), tulis (hanya alokasi > 0), totalBobot, ... }.
 */
export function hitungAlokasiResi({ anak, dibayar, tipe = TIPE_BAYAR.TAGIHAN, nominal = null }) {
  if (!Object.values(TIPE_BAYAR).includes(tipe)) throw new ResiBayarError("Tipe pembayaran tidak dikenal (pilih DP atau TAGIHAN)", 400, "TIPE_TIDAK_VALID");
  const aktif = anak.filter((o) => o.status !== "CANCELLED");
  if (aktif.length === 0) throw new ResiBayarError("Resi tidak punya order aktif", 409, "RESI_TANPA_ORDER_AKTIF");

  const baris = aktif.map((o) => {
    const tagihan = tagihanAnak(o);
    const sudah = Math.max(Number(dibayar.get(o.id)) || 0, 0);
    const sisa = Math.max(tagihan - sudah, 0);
    const sisaDp = Math.max(Math.min(Number(o.dpTarget) || 0, tagihan) - sudah, 0);
    return { orderId: o.id, orderNumber: o.orderNumber ?? null, tagihan, dibayar: sudah, sisa, sisaDp, bobot: tipe === TIPE_BAYAR.DP ? sisaDp : sisa };
  });
  const totalBobot = baris.reduce((s, b) => s + b.bobot, 0);
  if (totalBobot <= 0) {
    throw new ResiBayarError(
      tipe === TIPE_BAYAR.DP ? "DP Resi sudah terpenuhi atau tidak ada target DP tersisa" : "Resi sudah lunas, tidak ada sisa tagihan yang bisa dialokasikan",
      409, "TIDAK_ADA_SISA",
    );
  }

  let nominalFinal = totalBobot;
  if (nominal !== null && nominal !== undefined && nominal !== "") {
    const n = Number(nominal);
    if (!Number.isInteger(n) || n <= 0) throw new ResiBayarError("Nominal pembayaran harus bilangan bulat lebih dari 0", 400, "NOMINAL_TIDAK_VALID");
    nominalFinal = n;
  }
  if (nominalFinal > totalBobot) {
    throw new ResiBayarError(
      `Nominal Rp${nominalFinal.toLocaleString("id-ID")} melebihi sisa ${tipe === TIPE_BAYAR.DP ? "DP" : "tagihan"} Resi Rp${totalBobot.toLocaleString("id-ID")} (over-alokasi ditolak)`,
      409, "OVER_ALOKASI",
    );
  }

  const bagi = bagiProporsional(nominalFinal, baris.map((b) => b.bobot));
  const alokasi = baris.map((b, i) => ({ ...b, alokasi: bagi[i] }));
  return {
    tipe,
    nominal: nominalFinal,
    totalTagihan: baris.reduce((s, b) => s + b.tagihan, 0),
    totalDibayarSebelum: baris.reduce((s, b) => s + b.dibayar, 0),
    totalSisa: baris.reduce((s, b) => s + b.sisa, 0),
    totalBobot,
    alokasi,
    tulis: alokasi.filter((a) => a.alokasi > 0),
  };
}

// ── pemuatan + penguncian ─────────────────────────────────────────────────────────────────────────────────────────

const PILIH_ANAK = { id: true, orderNumber: true, customerId: true, groupId: true, status: true, value: true, ongkir: true, dpTarget: true, paymentStatus: true, paidAt: true };

/**
 * Muat group + seluruh child. Dengan `kunci` = true (WAJIB di dalam transaksi tulis): kunci baris group lalu SEMUA child secara URUT (id naik),
 * sehingga double-click/request paralel untuk Resi yang sama berjalan berurutan, tanpa deadlock antar-Resi.
 */
export async function muatGrupResi(db, groupId, { kunci = false } = {}) {
  if (!groupId || typeof groupId !== "string") throw new ResiBayarError("Resi tidak ditemukan", 404);
  if (kunci) await lockRowForUpdate(db, "order_groups", groupId, { cast: null });
  const grup = await db.orderGroup.findUnique({
    where: { id: groupId },
    select: { id: true, source: true, customerId: true, anchorOrderId: true, dpPersen: true, dpTarget: true, ongkirTambahan: true, customer: { select: { name: true, assignedSalesId: true } } },
  });
  if (!grup) throw new ResiBayarError("Resi tidak ditemukan", 404);
  if (kunci) await db.$queryRawUnsafe('SELECT id FROM "Order" WHERE group_id = $1 ORDER BY id FOR UPDATE', groupId);
  const anak = await db.order.findMany({ where: { groupId }, orderBy: { id: "asc" }, select: PILIH_ANAK });
  return { grup, anak };
}

/** Kelayakan group untuk alur pembayaran Resi. */
export function pastikanGrupLayak(grup, anak) {
  if (grup.source !== "BARU") {
    throw new ResiBayarError("Resi hasil backfill bundle lama belum masuk alur pembayaran Resi (menunggu backfill resmi)", 409, "GRUP_BACKFILL");
  }
  if (anak.length === 0) throw new ResiBayarError("Resi tidak punya order", 409, "RESI_KOSONG");
  const asing = anak.find((o) => o.customerId !== grup.customerId);
  if (asing) throw new ResiBayarError("Ada order dalam Resi yang milik customer berbeda — pembayaran Resi ditolak", 409, "CUSTOMER_BEDA");
  const anchor = anak.find((o) => o.id === grup.anchorOrderId);
  if (!anchor) throw new ResiBayarError("Order anchor Resi tidak ditemukan", 409, "ANCHOR_HILANG");
  if (anchor.status === "CANCELLED") {
    throw new ResiBayarError("Order anchor Resi sudah dibatalkan — pembayaran Resi tidak bisa dicatat sebelum pembatalan/refund child didukung (Fase 3B)", 409, "ANCHOR_DIBATALKAN");
  }
  return { anchor, aktif: anak.filter((o) => o.status !== "CANCELLED") };
}

async function muatDibayar(db, aktif) {
  const peta = new Map();
  for (const o of aktif) peta.set(o.id, moneyToNumber(await paidForOrder(db, o.id, GATE_MATI)));
  return peta;
}

// ── invarian alokasi (dipanggil tepat sebelum menulis) ────────────────────────────────────────────────────────────

/**
 * Validasi ULANG terhadap DATABASE (bukan terhadap hasil hitungan): child harus ada, satu group & satu customer, tidak CANCELLED, nominal bulat > 0,
 * tidak over-alokasi terhadap sisa tagihan, tanpa duplikat, dan Σ alokasi TEPAT sama dengan nominal Payment.
 */
export async function validasiAlokasiResi(db, { grup, alokasi, nominalPayment }) {
  const tolak = (pesan, code, status = 409) => { throw new ResiBayarError(pesan, status, code); };
  if (!Array.isArray(alokasi) || alokasi.length === 0) tolak("Alokasi Resi tidak boleh kosong", "ALOKASI_KOSONG", 400);
  const ids = alokasi.map((a) => a.orderId);
  if (new Set(ids).size !== ids.length) tolak("Satu order tidak boleh muncul dua kali dalam alokasi Resi", "ALOKASI_GANDA", 400);
  for (const a of alokasi) {
    if (!Number.isInteger(a.amount) || a.amount <= 0) tolak("Nominal alokasi harus bilangan bulat lebih dari 0", "NOMINAL_ALOKASI_TIDAK_VALID", 400);
  }
  if (!Number.isInteger(nominalPayment) || nominalPayment <= 0) tolak("Nominal pembayaran harus bilangan bulat lebih dari 0", "NOMINAL_TIDAK_VALID", 400);

  const orders = await db.order.findMany({ where: { id: { in: ids } }, select: { id: true, groupId: true, customerId: true, status: true, value: true, ongkir: true } });
  if (orders.length !== ids.length) tolak("Ada order alokasi yang tidak ditemukan", "ORDER_TIDAK_ADA", 404);
  const peta = new Map(orders.map((o) => [o.id, o]));
  for (const a of alokasi) {
    const o = peta.get(a.orderId);
    if (o.groupId !== grup.id) tolak("Order alokasi bukan bagian dari Resi ini", "GROUP_BEDA");
    if (o.customerId !== grup.customerId) tolak("Order alokasi milik customer berbeda dari Resi", "CUSTOMER_BEDA");
    if (o.status === "CANCELLED") tolak("Pembayaran Resi tidak boleh dialokasikan ke order yang dibatalkan", "CHILD_DIBATALKAN");
  }
  for (const a of alokasi) {
    const o = peta.get(a.orderId);
    const sisa = tagihanAnak(o) - moneyToNumber(await paidForOrder(db, o.id, GATE_MATI));
    if (a.amount > sisa) tolak(`Alokasi ke order melebihi sisa tagihannya (Rp${a.amount.toLocaleString("id-ID")} > Rp${Math.max(sisa, 0).toLocaleString("id-ID")})`, "OVER_ALOKASI");
  }
  const total = alokasi.reduce((s, a) => s + a.amount, 0);
  if (total !== nominalPayment) tolak(`Total alokasi ${total} tidak sama dengan nominal pembayaran ${nominalPayment}`, "TOTAL_TIDAK_SAMA");
  return true;
}

/** Tulis Payment anchor + alokasi + hitung ulang status semua child. Pemanggil WAJIB sudah memegang kunci (muatGrupResi kunci=true). */
export async function tulisPembayaranResi(tx, { grup, anchor, aktif, hitung, method, cashAccountId = null, proofPhotoUrl = null, recordedById, verifierId = null, createdAt = null }) {
  const alokasi = hitung.tulis.map((a) => ({ orderId: a.orderId, amount: a.alokasi }));
  await validasiAlokasiResi(tx, { grup, alokasi, nominalPayment: hitung.nominal });

  const payment = await tx.payment.create({
    data: {
      orderId: anchor.id, amount: hitung.nominal, method,
      proofPhotoUrl: proofPhotoUrl || null, cashAccountId: cashAccountId || null,
      recordedById, ...(createdAt && { createdAt }),
    },
  });
  if (verifierId) await tx.paymentVerification.create({ data: { paymentId: payment.id, verifiedById: verifierId } });
  try {
    await setAllocations(tx, { paymentId: payment.id, allocations: alokasi, userId: recordedById });
  } catch (e) {
    if (e instanceof AllocationError) throw new ResiBayarError(e.message, e.statusCode || 409, "ALOKASI_DITOLAK");
    throw e;
  }
  const status = [];
  for (const o of aktif) status.push({ orderId: o.id, orderNumber: o.orderNumber, ...(await recomputeOrderPaymentStatus(tx, o.id)) });
  return { payment, alokasi, status };
}

function bentukRespons(hitung, tulis, jurnal) {
  return {
    paymentId: tulis.payment.id,
    nominal: hitung.nominal,
    tipe: hitung.tipe,
    alokasi: hitung.alokasi.filter((a) => a.alokasi > 0).map((a) => ({ orderId: a.orderId, orderNumber: a.orderNumber, jumlah: a.alokasi, sisaSebelum: a.sisa, sisaSesudah: a.sisa - a.alokasi })),
    status: tulis.status,
    jurnal: jurnal ? { posted: !!jurnal.posted, gap: !!jurnal.gap, entryId: jurnal.entry?.id ?? null } : null,
    ringkasan: { totalTagihan: hitung.totalTagihan, dibayarSebelum: hitung.totalDibayarSebelum, dibayarSesudah: hitung.totalDibayarSebelum + hitung.nominal, sisaSesudah: hitung.totalSisa - hitung.nominal },
  };
}

// ── Sales: pratinjau, catat pembayaran/DP, klaim Lunas ────────────────────────────────────────────────────────────

/** Pratinjau alokasi (BACA-SAJA, tanpa kunci). Server menghitung; klien hanya menerima hasilnya. Penulisan tetap menghitung ULANG di bawah kunci. */
export async function pratinjauPembayaranResi(db, { groupId, tipe = TIPE_BAYAR.TAGIHAN, nominal = null }) {
  await pastikanAktif(db);
  const { grup, anak } = await muatGrupResi(db, groupId);
  const { aktif } = pastikanGrupLayak(grup, anak);
  const hitung = hitungAlokasiResi({ anak: aktif, dibayar: await muatDibayar(db, aktif), tipe, nominal });
  return {
    groupId: grup.id, customerName: grup.customer?.name ?? null, tipe: hitung.tipe, nominal: hitung.nominal,
    ringkasan: { totalTagihan: hitung.totalTagihan, dibayarSebelum: hitung.totalDibayarSebelum, sisa: hitung.totalSisa, dpTarget: grup.dpTarget },
    alokasi: hitung.alokasi.map((a) => ({ orderId: a.orderId, orderNumber: a.orderNumber, tagihan: a.tagihan, dibayar: a.dibayar, sisa: a.sisa, alokasi: a.alokasi, sisaSesudah: a.sisa - a.alokasi })),
    dibaca: "pratinjau", // bukan komitmen: penulisan menghitung ulang di bawah kunci
  };
}

function cekInput({ method, proofPhotoUrl }) {
  if (!METODE.includes(method)) throw new ResiBayarError("Metode pembayaran tidak valid", 400, "METODE_TIDAK_VALID");
  if (proofPhotoUrl != null && !String(proofPhotoUrl).startsWith("/media/payment-proofs/")) throw new ResiBayarError("URL foto bukti tidak valid", 400, "BUKTI_TIDAK_VALID");
}

/** Sales mencatat pembayaran/DP Resi. Satu transaksi; kunci group + child urut; hitung ulang di bawah kunci. */
export async function catatPembayaranResi(db, { groupId, userId, tipe = TIPE_BAYAR.TAGIHAN, nominal = null, method, cashAccountId = null, proofPhotoUrl = null }) {
  await pastikanAktif(db);
  cekInput({ method, proofPhotoUrl });
  if (cashAccountId) {
    const akun = await db.finCashAccount.findUnique({ where: { id: String(cashAccountId) }, select: { active: true } });
    if (!akun || !akun.active) throw new ResiBayarError("Rekening tujuan tidak valid atau sudah nonaktif", 400, "REKENING_TIDAK_VALID");
  }
  return db.$transaction(async (tx) => {
    const { grup, anak } = await muatGrupResi(tx, groupId, { kunci: true });
    const { anchor, aktif } = pastikanGrupLayak(grup, anak);
    const dibayar = await muatDibayar(tx, aktif);
    // Klaim Lunas yang menunggu Finance tidak boleh "dilunasi diam-diam" lewat pencatatan Sales (akan menghilangkan Resi dari antrean verifikasi).
    if (aktif.some((o) => o.paymentStatus === "LUNAS" && (Number(o.value) || 0) > 0 && (dibayar.get?.(o.id) ?? 0) < tagihanAnak(o))) {
      throw new ResiBayarError("Resi sedang diklaim Lunas dan menunggu verifikasi Finance; pembayaran tidak dicatat dari sisi Sales", 409, "KLAIM_LUNAS_AKTIF");
    }
    const hitung = hitungAlokasiResi({ anak: aktif, dibayar, tipe, nominal });
    const tulis = await tulisPembayaranResi(tx, { grup, anchor, aktif, hitung, method, cashAccountId, proofPhotoUrl, recordedById: userId });
    const jurnal = await bukukanPembayaran(tx, { paymentId: tulis.payment.id, userId });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.ORDER, entityId: anchor.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: userId,
      metadata: { aksi: "catat_pembayaran_resi", groupId: grup.id, tipe: hitung.tipe, amount: String(hitung.nominal), method, paymentId: tulis.payment.id, child: hitung.tulis.length },
    });
    return bentukRespons(hitung, tulis, jurnal);
  }, { maxWait: 15_000, timeout: 60_000 });
}

/**
 * Sales menandai Resi LUNAS SEKALI (semua child aktif) — pengganti klik Lunas per order. Tidak membuat Payment/jurnal: hanya klaim, sama seperti
 * dropdown Lunas biasa; Finance memverifikasinya lewat SATU antrean Resi (services/finance/penerimaanResi.js).
 */
export async function klaimLunasResi(db, { groupId, userId }) {
  await pastikanAktif(db);
  return db.$transaction(async (tx) => {
    const { grup, anak } = await muatGrupResi(tx, groupId, { kunci: true });
    const { anchor, aktif } = pastikanGrupLayak(grup, anak);
    const target = aktif.filter((o) => (Number(o.value) || 0) > 0 && o.paymentStatus !== "LUNAS");
    if (target.length === 0) throw new ResiBayarError("Resi ini sudah ditandai Lunas", 409, "SUDAH_LUNAS");
    const sekarang = new Date();
    for (const o of target) {
      // paidAt = saat transisi masuk LUNAS (dasar komisi) — sama dengan PATCH /orders/:id paymentStatus=LUNAS.
      await tx.order.update({ where: { id: o.id }, data: { paymentStatus: "LUNAS", paidAt: sekarang } });
    }
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.ORDER, entityId: anchor.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: userId,
      metadata: { aksi: "klaim_lunas_resi", groupId: grup.id, child: target.map((o) => o.orderNumber || o.id) },
    });
    return { groupId: grup.id, ditandai: target.map((o) => ({ orderId: o.id, orderNumber: o.orderNumber })), total: target.reduce((s, o) => s + tagihanAnak(o), 0) };
  }, { maxWait: 15_000, timeout: 60_000 });
}

/** Guard untuk alur per-order lama: child Resi (group BARU) pada saat flag ON harus diproses lewat alur Resi, bukan per order. */
export async function pastikanBukanAnakResiAktif(db, orderId) {
  if (!(await resiPembayaranAktif(db))) return;
  const o = await db.order.findUnique({ where: { id: orderId }, select: { groupId: true, group: { select: { source: true } } } });
  if (o?.groupId && o.group?.source === "BARU") {
    throw new ResiBayarError("Order ini bagian dari Resi Gabungan — proses pembayarannya lewat alur Resi (antrean Resi Finance), bukan per order", 409, "ANAK_RESI");
  }
}

/** Guard koreksi alokasi manual: Payment Resi (anchor di group BARU) tidak boleh dialokasikan ulang lewat jalur Finance umum saat flag ON — pindah/batal child = Fase 3B. */
export async function pastikanPaymentBukanResi(db, paymentId) {
  if (!(await resiPembayaranAktif(db))) return;
  if (!/^[0-9a-f-]{36}$/i.test(String(paymentId))) return;
  const p = await db.payment.findUnique({ where: { id: String(paymentId) }, select: { order: { select: { groupId: true, group: { select: { source: true } } } } } });
  if (p?.order?.groupId && p.order.group?.source === "BARU") {
    throw new ResiBayarError("Pembayaran ini milik Resi Gabungan — alokasinya dihitung server dan tidak bisa diubah manual (perubahan/realokasi Resi = Fase 3B)", 409, "ALOKASI_RESI_TERKUNCI");
  }
}
