// RESI GABUNGAN — FASE 3A: pembayaran/DP Resi, alokasi otomatis ke child order, klaim Lunas level Resi.
//
// PRINSIP (keputusan owner, dokumen: docs/RESI-GABUNGAN-FASE3.md):
//  - TIDAK ada ledger baru. Satu pembayaran/DP Resi = SATU Payment pada order ANCHOR (yang sudah ada) + FinPaymentAllocation ke seluruh
//    child order aktif (tabel alokasi yang sudah ada). Jurnal tetap postPaymentReceived: Dr Kas/Bank sekali (total), Cr Piutang/Uang Muka
//    SATU BARIS PER CHILD sesuai alokasi. Tidak ada uang masuk ganda dan tidak ada pengakuan pendapatan tambahan.
//  - Server-authoritative: pembagian alokasi SELALU dihitung server dari sisa tagihan child aktif; nominal pembagian dari klien tidak dipercaya.
//  - Flag RESI_PEMBAYARAN_AKTIF (default MATI) — semua perintah publik menolak 403 bila mati.
//  - Hanya group source BARU. Group BACKFILL_BUNDLE TIDAK masuk alur ini sebelum backfill resmi.
//  - Order tunggal / groupId NULL: tidak disentuh sama sekali.
//
// ATURAN ANGKA (helper kanonis: services/finance/tagihanOrder.js)
//  - tagihan child = Order.value + Ongkir Tambahan HANYA di anchor (tepat sekali per Resi). Σ = Total Resi = dasar DP 30% Fase 1.
//  - dibayar child = paidForOrder TANPA gerbang verifikasi (semua payment tidak dibatalkan; konservatif — uang yang sudah dicatat Sales tetap
//    mengurangi sisa walau belum diverifikasi Finance, supaya tidak pernah over-alokasi).
//  - mode TAGIHAN: bobot = sisa tagihan child aktif. mode DP: bobot = sisa DP = max(min(dpTarget, tagihan) - dibayar, 0); tanpa pembayaran
//    sebelumnya alokasi DP PERSIS sama dengan dpTarget tiap child (Σ dpTarget = DP 30% Total Resi).
//  - pembagian: largest-remainder (bagiProporsional) sehingga Σ alokasi TEPAT sama dengan nominal Payment; baris 0 dibuang.
//
// KLAIM LUNAS (hardening 28 Sep 2026): klaim Sales disimpan di OrderGroup.lunasDiklaimPada — TIDAK mengubah paymentStatus/paidAt child.
// Status dan paidAt (dasar komisi) hanya bergerak lewat ledger (Payment + alokasi + recompute) setelah Finance memverifikasi.
//
// URUTAN KUNCI: grup → child (id naik) → payment → posting (sama dengan services/finance/urutanKunci.js).
//
// YANG SENGAJA BELUM (Fase 3B, lihat dokumen): pembatalan/refund child. Child yang sudah menerima alokasi aktif TIDAK boleh dibatalkan
// (guard di checkCancelBlockers, routes/orders.js — berlaku tanpa memandang flag).

import { prisma } from "../db.js";
import { bagiProporsional } from "./resi.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { paidForOrder, setAllocations, AllocationError } from "./finance/allocation.js";
import { recomputeOrderPaymentStatus } from "./paymentLedger.js";
import { bukukanPembayaran } from "./finance/hooks.js";
import { getSettingRaw, parseBool, SETTING_KEYS } from "./finance/settings.js";
import { moneyToNumber } from "./finance/money.js";
import { tagihanOrder, ongkirDitagih } from "./finance/tagihanOrder.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const TIPE_BAYAR = Object.freeze({ DP: "DP", TAGIHAN: "TAGIHAN" });
// Sama dengan enum PaymentMethod dan semua jalur pencatatan/verifikasi lama (POST /orders/:id/payments, verifikasiPenerimaan).
export const METODE_BAYAR = Object.freeze(["CASH", "TRANSFER", "QRIS", "CARD"]);
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

export async function pastikanAktif(db) {
  if (!(await resiPembayaranAktif(db))) throw new ResiBayarError("Pembayaran Resi belum diaktifkan", 403, "RESI_PEMBAYARAN_MATI");
}

/** Tagihan satu child Resi — delegasi ke helper kanonis. `grup` = { source, anchorOrderId }; tanpa grup = value + ongkir. */
export const tagihanAnak = (o, grup = null) => tagihanOrder(o, grup);

// ── perhitungan murni ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Hitung alokasi otomatis. MURNI (tanpa DB). `anak` = semua child (child CANCELLED diabaikan), `dibayar` = Map orderId → Rupiah yang sudah tercatat,
 * `grup` = { source, anchorOrderId } (Ongkir Tambahan hanya dihitung di anchor).
 * Mengembalikan { tipe, nominal, alokasi (semua child aktif, termasuk 0), tulis (hanya alokasi > 0), totalBobot, ... }.
 */
export function hitungAlokasiResi({ anak, dibayar, tipe = TIPE_BAYAR.TAGIHAN, nominal = null, grup = null }) {
  if (!Object.values(TIPE_BAYAR).includes(tipe)) throw new ResiBayarError("Tipe pembayaran tidak dikenal (pilih DP atau TAGIHAN)", 400, "TIPE_TIDAK_VALID");
  const aktif = anak.filter((o) => o.status !== "CANCELLED");
  if (aktif.length === 0) throw new ResiBayarError("Resi tidak punya order aktif", 409, "RESI_TANPA_ORDER_AKTIF");

  const baris = aktif.map((o) => {
    const tagihan = tagihanAnak(o, grup);
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
const PILIH_GRUP = {
  id: true, source: true, customerId: true, anchorOrderId: true, dpPersen: true, dpTarget: true, ongkirTambahan: true, createdAt: true,
  lunasDiklaimPada: true, lunasDiklaimOlehId: true, lunasDiklaimOleh: { select: { name: true } },
  // updatedAt (hardening 2: exactly-once verifikasi) — dipakai sebagai "versi" optimistik: setiap verifikasi (penuh ATAU sebagian) menulis
  // ulang baris grup sehingga updatedAt selalu berubah; request kedua yang balapan dengan versi LAMA (dibaca sebelum request pertama commit)
  // ditolak 409 alih-alih diam-diam membuat Payment kedua untuk aksi yang sama. Lihat services/finance/penerimaanResi.js.
  updatedAt: true,
  customer: { select: { name: true, assignedSalesId: true } },
};

/** Versi optimistik grup (angka, ms epoch) untuk dikirim balik ke klien dan dicocokkan ulang saat verifikasi (hardening 2). */
export const versiGrup = (grup) => grup.updatedAt.getTime();

/**
 * Muat group + seluruh child. Dengan `kunci` = true (WAJIB di dalam transaksi tulis): kunci baris group lalu SEMUA child secara URUT (id naik) —
 * urutan kanonis grup → order (services/finance/urutanKunci.js), sehingga perintah paralel atas Resi yang sama berjalan berurutan tanpa deadlock.
 */
export async function muatGrupResi(db, groupId, { kunci = false } = {}) {
  if (!groupId || typeof groupId !== "string") throw new ResiBayarError("Resi tidak ditemukan", 404);
  if (kunci) await lockRowForUpdate(db, "order_groups", groupId, { cast: null });
  const grup = await db.orderGroup.findUnique({ where: { id: groupId }, select: PILIH_GRUP });
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

export async function muatDibayar(db, aktif) {
  const peta = new Map();
  for (const o of aktif) peta.set(o.id, moneyToNumber(await paidForOrder(db, o.id, GATE_MATI)));
  return peta;
}

/** Ringkasan per child untuk UI/antrean: tagihan kanonis, ongkir yang ditagih, dibayar, sisa. */
export function rincianAnak(aktif, dibayar, grup) {
  return aktif.map((o) => {
    const tagihan = tagihanAnak(o, grup);
    const sudah = Number(dibayar.get(o.id)) || 0;
    return {
      orderId: o.id, orderNumber: o.orderNumber, status: o.status, paymentStatus: o.paymentStatus, anchor: o.id === grup.anchorOrderId,
      nilai: Number(o.value) || 0, ongkir: ongkirDitagih(o, grup), tagihan, dibayar: sudah, sisa: Math.max(tagihan - sudah, 0), dpTarget: o.dpTarget ?? null,
    };
  });
}

// ── invarian alokasi (dipanggil tepat sebelum menulis) ────────────────────────────────────────────────────────────

/**
 * Validasi ULANG terhadap DATABASE (bukan terhadap hasil hitungan): child harus ada, satu group & satu customer, tidak CANCELLED, nominal bulat > 0,
 * tidak over-alokasi terhadap sisa tagihan KANONIS, tanpa duplikat, dan Σ alokasi TEPAT sama dengan nominal Payment.
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
    const sisa = tagihanAnak(o, grup) - moneyToNumber(await paidForOrder(db, o.id, GATE_MATI));
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

function bentukKlaim(grup) {
  return grup.lunasDiklaimPada ? { pada: grup.lunasDiklaimPada, olehId: grup.lunasDiklaimOlehId ?? null, olehNama: grup.lunasDiklaimOleh?.name ?? null } : null;
}

// ── Sales: ringkasan, pratinjau, catat pembayaran/DP, klaim Lunas ─────────────────────────────────────────────────

/**
 * Ringkasan pembayaran satu Resi (BACA-SAJA) untuk UI Sales/Finance: total, ongkir tambahan, rincian child, sisa, dan klaim yang menunggu.
 * `aktif: false` bila flag mati — UI menyembunyikan seluruh fitur. Tidak pernah melempar untuk group BACKFILL (hanya `layak: false`).
 */
export async function ringkasanPembayaranResi(db, { groupId }) {
  if (!(await resiPembayaranAktif(db))) return { aktif: false };
  const { grup, anak } = await muatGrupResi(db, groupId);
  if (grup.source !== "BARU") return { aktif: true, layak: false, alasan: "Resi hasil backfill bundle lama belum masuk alur pembayaran Resi", groupId: grup.id };
  const { aktif } = pastikanGrupLayak(grup, anak);
  const dibayar = await muatDibayar(db, aktif);
  const rinci = rincianAnak(aktif, dibayar, grup);
  const total = rinci.reduce((s, r) => s + r.tagihan, 0);
  const sudah = rinci.reduce((s, r) => s + r.dibayar, 0);
  return {
    aktif: true, layak: true, groupId: grup.id, customerName: grup.customer?.name ?? null, anchorOrderId: grup.anchorOrderId,
    totalTagihan: total, ongkirTambahan: rinci.reduce((s, r) => s + r.ongkir, 0), dpTarget: grup.dpTarget ?? null,
    dibayar: sudah, sisa: Math.max(total - sudah, 0), klaim: bentukKlaim(grup), anak: rinci,
    dibatalkan: anak.filter((o) => o.status === "CANCELLED").map((o) => ({ orderId: o.id, orderNumber: o.orderNumber })),
  };
}

/** Pratinjau alokasi (BACA-SAJA, tanpa kunci). Server menghitung; klien hanya menerima hasilnya. Penulisan tetap menghitung ULANG di bawah kunci. */
export async function pratinjauPembayaranResi(db, { groupId, tipe = TIPE_BAYAR.TAGIHAN, nominal = null }) {
  await pastikanAktif(db);
  const { grup, anak } = await muatGrupResi(db, groupId);
  const { aktif } = pastikanGrupLayak(grup, anak);
  const hitung = hitungAlokasiResi({ anak: aktif, dibayar: await muatDibayar(db, aktif), tipe, nominal, grup });
  return {
    groupId: grup.id, customerName: grup.customer?.name ?? null, tipe: hitung.tipe, nominal: hitung.nominal,
    ringkasan: { totalTagihan: hitung.totalTagihan, dibayarSebelum: hitung.totalDibayarSebelum, sisa: hitung.totalSisa, dpTarget: grup.dpTarget },
    alokasi: hitung.alokasi.map((a) => ({ orderId: a.orderId, orderNumber: a.orderNumber, tagihan: a.tagihan, dibayar: a.dibayar, sisa: a.sisa, alokasi: a.alokasi, sisaSesudah: a.sisa - a.alokasi })),
    klaim: bentukKlaim(grup),
    dibaca: "pratinjau", // bukan komitmen: penulisan menghitung ulang di bawah kunci
  };
}

function cekInput({ method, proofPhotoUrl }) {
  if (!METODE_BAYAR.includes(method)) throw new ResiBayarError("Metode pembayaran tidak valid (pilih Tunai, Transfer, QRIS, atau Kartu)", 400, "METODE_TIDAK_VALID");
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
    // Klaim Lunas yang menunggu Finance tidak boleh "dilunasi diam-diam" lewat pencatatan Sales (akan menghilangkan Resi dari antrean verifikasi).
    if (grup.lunasDiklaimPada) {
      throw new ResiBayarError("Resi ini sudah diklaim Lunas dan sedang menunggu verifikasi Finance — pembayaran tidak dicatat dari sisi Sales", 409, "KLAIM_LUNAS_AKTIF");
    }
    const hitung = hitungAlokasiResi({ anak: aktif, dibayar: await muatDibayar(tx, aktif), tipe, nominal, grup });
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
 * Sales mengklaim Resi LUNAS SEKALI (bukan per order). Klaim hanya dicatat di grup (lunasDiklaimPada/Oleh) + activity log:
 * TIDAK mengubah paymentStatus/paidAt child dan tidak membuat Payment/jurnal. Finance memverifikasinya lewat SATU antrean Resi
 * (services/finance/penerimaanResi.js); status + paidAt (dasar komisi) baru bergerak lewat ledger saat verifikasi.
 */
export async function klaimLunasResi(db, { groupId, userId }) {
  await pastikanAktif(db);
  return db.$transaction(async (tx) => {
    const { grup, anak } = await muatGrupResi(tx, groupId, { kunci: true });
    const { anchor, aktif } = pastikanGrupLayak(grup, anak);
    if (grup.lunasDiklaimPada) throw new ResiBayarError("Resi ini sudah diklaim Lunas dan sedang menunggu verifikasi Finance", 409, "KLAIM_SUDAH_ADA");
    const rinci = rincianAnak(aktif, await muatDibayar(tx, aktif), grup);
    const sisa = rinci.reduce((s, r) => s + r.sisa, 0);
    if (sisa <= 0) throw new ResiBayarError("Resi ini sudah lunas menurut pembayaran tercatat — tidak perlu diklaim", 409, "SUDAH_LUNAS");
    const sekarang = new Date();
    await tx.orderGroup.update({ where: { id: grup.id }, data: { lunasDiklaimPada: sekarang, lunasDiklaimOlehId: userId } });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.ORDER, entityId: anchor.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: userId,
      metadata: { aksi: "klaim_lunas_resi", groupId: grup.id, sisa: String(sisa), child: rinci.map((r) => r.orderNumber || r.orderId) },
    });
    return { groupId: grup.id, diklaimPada: sekarang, sisa, total: rinci.reduce((s, r) => s + r.tagihan, 0), anak: rinci };
  }, { maxWait: 15_000, timeout: 60_000 });
}

/** Guard untuk alur per-order lama: child Resi (group BARU) pada saat flag ON harus diproses lewat alur Resi, bukan per order. */
async function anakResiBaru(db, orderId) {
  if (!(await resiPembayaranAktif(db))) return false;
  const o = await db.order.findUnique({ where: { id: orderId }, select: { groupId: true, group: { select: { source: true } } } });
  return !!(o?.groupId && o.group?.source === "BARU");
}

export async function pastikanBukanAnakResiAktif(db, orderId) {
  if (await anakResiBaru(db, orderId)) {
    throw new ResiBayarError("Order ini bagian dari Resi Gabungan — status dan pembayarannya diproses sekali di level Resi (Klaim Lunas Resi / antrean Resi Finance), bukan per order", 409, "ANAK_RESI");
  }
}

/**
 * Guard untuk POST /orders/:id/payments (pencatatan pembayaran manual GENERIK, dipakai Sales/admin untuk semua order): child Resi BARU wajib
 * dibayar lewat alur Resi (services/resiPembayaran.js#catatPembayaranResi), bukan endpoint per-order ini — supaya SATU jalur saja yang bisa
 * mencatat uang untuk child Resi (uangnya harus melalui alokasi ke seluruh child, bukan 100% ke satu order). Order tunggal (groupId NULL) dan
 * group BACKFILL_BUNDLE (legacy) TIDAK terpengaruh — identik dengan perilaku sebelum guard ini ada. Flag mati → tidak ada perubahan.
 */
export async function pastikanBukanAnakResiWajibBayarLewatResi(db, orderId) {
  if (await anakResiBaru(db, orderId)) {
    throw new ResiBayarError(
      "Order ini bagian dari Resi Gabungan — pembayarannya wajib dicatat lewat alur Resi (Klaim Lunas Resi / catat pembayaran Resi), bukan endpoint pembayaran per order ini",
      409, "ANAK_RESI_WAJIB_BAYAR_LEWAT_RESI",
    );
  }
}

/**
 * Guard koreksi alokasi manual: Payment milik Resi BARU (Payment di anchor yang dialokasikan ke child) tidak boleh dialokasikan ulang lewat jalur
 * Finance umum — BERLAKU TANPA MEMANDANG FLAG (Payment Resi tetap ada walau flag dimatikan). Pindah/batal child = Fase 3B.
 */
export async function pastikanPaymentBukanResi(db, paymentId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(paymentId))) return;
  const p = await db.payment.findUnique({
    where: { id: String(paymentId) },
    select: { order: { select: { groupId: true, group: { select: { source: true } } } }, _count: { select: { finAllocations: true } } },
  });
  if (p?.order?.groupId && p.order.group?.source === "BARU" && p._count.finAllocations > 0) {
    throw new ResiBayarError("Pembayaran ini milik Resi Gabungan — alokasinya dihitung server dan tidak bisa diubah manual (perubahan/realokasi Resi = Fase 3B)", 409, "ALOKASI_RESI_TERKUNCI");
  }
}
