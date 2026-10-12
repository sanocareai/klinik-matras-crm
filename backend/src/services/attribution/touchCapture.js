// ATRIBUSI CTWA FASE 2 — penangkapan TOUCH iklan pada jalur inbound.
//
// Satu touch = satu pesan inbound yang membawa sinyal iklan CTWA VALID: contextInfo.externalAdReply.sourceID numerik DAN sourceType = "ad".
// Ad ID BERASAL dari payload webhook (sourceID) — TIDAK PERNAH disimpulkan dari URL postingan, shortcode, nama, atau kemiripan angka.
//
// DURABILITAS (menutup loss window): touch ditulis ATOMIK dalam transaksi yang SAMA dengan Message.create (simpanPesanDenganTouch).
// Ad ID hanya ada di payload webhook; begitu Message ter-commit tanpa touch, tidak ada cara memulihkannya (retry WAHA dibuang oleh
// cariPesanSudahAda sebelum handler, dan DB tidak menyimpan sinyalnya). Maka sinyal HARUS ikut commit bersama pesan. Akibatnya:
//   - proses mati SEBELUM commit  → tidak ada Message, tidak ada touch; webhook yang dikirim ulang memprosesnya normal;
//   - proses mati SESUDAH commit  → Message DAN touch sudah ada (tepat satu; kunci dedupe UNIQUE);
//   - tidak ada keadaan "Message ada, touch belum" yang dapat dicapai oleh kematian proses.
// Kegagalan atribusi TIDAK boleh menggagalkan inbox:
//   - insert touch berada di dalam SAVEPOINT; gagal → ROLLBACK TO SAVEPOINT, pesan tetap commit (terhitung `gagal`);
//   - transaksi sendiri rusak/timeout (P2028/P2034/savepoint tak pulih) → pesan dibuat ulang TANPA transaksi (jalur lama), lalu touch
//     dicoba sekali lagi di luar jalur kritis (terhitung `dipulihkan` / `gagalPulih`);
//   - pesan tanpa sinyal iklan tidak memakai transaksi sama sekali (perilaku identik dengan sebelum Fase 2).
// Kontrak lain:
//   - flag ATRIBUSI_TOUCH_CAPTURE_ENABLED harus persis "true" (default MATI);
//   - idempoten: kunci dedupe = hash ID pesan inti (message + message.any + retry untuk pesan yang sama = 1 baris);
//   - tidak menyimpan isi chat, nomor, nama, JID, payload mentah, atau clid mentah (hanya hash HMAC 16 hex bila CTWA_CAPTURE_HASH_SALT valid);
//   - log hanya KODE (tidak pernah pesan galat / identitas).
import crypto from "crypto";
import { buildObservation } from "../ctwaCapture.js";
import { idPesanInti } from "../../utils/idPesanWa.js";
import { hariWIB } from "./cohort.js";

export const TOUCH_FLAG = "ATRIBUSI_TOUCH_CAPTURE_ENABLED";
export const TOUCH_VERSION = 1;
export const EVIDENCE = Object.freeze({ CTWA_AD: "CTWA_AD", AD_REPLY_UNMARKED: "AD_REPLY_UNMARKED" });
/** Customer yang SUDAH ada saat pesan ini diproses tetap dihitung "baru" bila dibuat ≤ jendela ini dan belum punya pesan sama sekali
 *  (mis. proses mati setelah customer dibuat tetapi sebelum pesan tersimpan, lalu webhook dikirim ulang). */
export const JENDELA_CUSTOMER_BARU_MS = 2 * 60 * 60 * 1000;
const SAVEPOINT = "atribusi_touch";

export const isTouchCaptureOn = () => process.env[TOUCH_FLAG] === "true";
const saltAsli = () => {
  const s = process.env.CTWA_CAPTURE_HASH_SALT;
  return typeof s === "string" && s.length >= 16 ? s : null;
};
const SALT_PLACEHOLDER = "touch-tanpa-salt-placeholder-0000";   // hanya agar buildObservation tidak melempar; hasil hash-nya DIBUANG

// ── observabilitas agregat (per proses; tanpa identitas) ─────────────────────────────────────────────────────────────────
const stats = {
  direkam: 0, duplikat: 0, bukanTouch: 0, gagal: 0, dilewati: 0,
  fallbackTransaksi: 0, dipulihkan: 0, gagalPulih: 0, terakhirGagalAt: null,
};
const tertunda = new Map();          // id → waktu mulai (percobaan susulan yang sedang berjalan)
let tertundaSeq = 0;
let lastWarnAt = 0;
export const _getTouchStats = (now = Date.now()) => {
  let tertua = 0;
  for (const t of tertunda.values()) tertua = Math.max(tertua, now - t);
  return { ...stats, tertunda: tertunda.size, usiaTertundaTertuaMs: tertunda.size ? tertua : 0 };
};
export const _resetTouchStats = () => {
  for (const k of Object.keys(stats)) stats[k] = k === "terakhirGagalAt" ? null : 0;
  tertunda.clear(); lastWarnAt = 0;
};
function warnLimited(kode) {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn(`[atribusi-touch] ${kode}`);   // hanya kode, tidak pernah pesan error (bisa memuat nilai)
}
const kodeGalat = (e) => String(e?.code || e?.name || "ERR").slice(0, 24);
function catatGagal(e) {
  stats.gagal++;
  stats.terakhirGagalAt = new Date().toISOString();
  try { warnLimited(`gagal merekam touch (${kodeGalat(e)})`); } catch { /* sengaja diam */ }
}

/** Kunci dedupe per PESAN: stabil lintas event (`message`/`message.any`) dan retry. null bila ID pesan tidak ada. */
export function kunciDedupe(externalId) {
  const inti = idPesanInti(externalId) ?? String(externalId ?? "");
  if (!inti) return null;
  return "msg:" + crypto.createHash("sha256").update(inti).digest("hex").slice(0, 40);
}

/**
 * Murni (tanpa I/O). Mengembalikan { valid:true, touch } atau { valid:false, alasan }.
 * Valid bila verdict ∈ {CTWA_AD, AD_REPLY_UNMARKED} DAN values.sourceId (digit) ada DAN values.sourceType === "ad".
 * AD_REPLY_UNMARKED (balasan ke iklan tanpa penanda/clid, mis. Status WhatsApp) direkam dengan evidenceSource sendiri sebagai AUDIT;
 * ia tidak pernah masuk atribusi utama.
 */
export function bangunTouch(payload, { externalId, isNewCustomer, event, engine, salt = null, now = Date.now() } = {}) {
  const dedupeKey = kunciDedupe(externalId);
  if (!dedupeKey) return { valid: false, alasan: "TANPA_ID_PESAN" };
  let obs;
  try {
    obs = buildObservation(payload, { event, engine, externalId, isNewCustomer: !!isNewCustomer, salt: salt || SALT_PLACEHOLDER, now });
  } catch {
    return { valid: false, alasan: "PAYLOAD_TIDAK_DAPAT_DIURAI" };
  }
  if (obs.verdict !== EVIDENCE.CTWA_AD && obs.verdict !== EVIDENCE.AD_REPLY_UNMARKED) return { valid: false, alasan: "BUKAN_SINYAL_IKLAN" };
  const adId = obs.values?.sourceId;
  if (!adId) return { valid: false, alasan: "TANPA_SOURCE_ID" };
  if (obs.values?.sourceType !== "ad") return { valid: false, alasan: "SOURCE_TYPE_BUKAN_AD" };
  if (!/^\d{5,32}$/.test(adId)) return { valid: false, alasan: "SOURCE_ID_BENTUK_TIDAK_VALID" };
  return {
    valid: true,
    touch: {
      adId,
      evidenceSource: obs.verdict,
      sourceType: "ad",
      entryPointSource: obs.values.entryPointConversionSource || null,
      entryPointApp: obs.values.entryPointConversionApp || null,
      ctwaClidHash: salt && obs.ctwaClid?.hash ? obs.ctwaClid.hash : null,
      providerTs: obs.providerTs ? new Date(obs.providerTs) : null,
      customerNewAtTouch: !!isNewCustomer,
      dedupeKey,
    },
  };
}

/**
 * Menyiapkan rencana touch dari payload (SEBELUM Message.create). Sinkron, tanpa I/O, TIDAK PERNAH melempar.
 * @returns {null | { touch: object }} null = tidak ada touch yang perlu ditulis (flag MATI atau bukan sinyal iklan valid).
 */
export function siapkanTouch({ payload, event, engine, externalId }) {
  try {
    if (!isTouchCaptureOn()) return null;
    const b = bangunTouch(payload, { externalId, isNewCustomer: false, event, engine, salt: saltAsli() });
    if (!b.valid) { stats.bukanTouch++; return null; }
    return { touch: b.touch };
  } catch {
    stats.bukanTouch++;
    return null;
  }
}

/** Customer "baru saat touch": baru dibuat oleh pemrosesan ini, ATAU dibuat ≤ jendela dan belum punya pesan apa pun. Tidak melempar. */
async function tentukanCustomerBaru(db, { customer, customerSudahAda, sekarang }) {
  if (!customerSudahAda) return true;
  try {
    const dibuat = customer?.createdAt ? new Date(customer.createdAt).getTime() : NaN;
    if (!Number.isFinite(dibuat) || sekarang.getTime() - dibuat > JENDELA_CUSTOMER_BARU_MS) return false;
    const sebelumnya = await db.message.count({ where: { conversation: { customerId: customer.id } } });
    return sebelumnya === 0;
  } catch {
    return false;                       // gagal menentukan → jangan menyatakan akuisisi tanpa bukti
  }
}

function dataTouch(rencana, { customer, message, customerBaru, ref }) {
  const t = rencana.touch;
  const touchAt = message.createdAt ? new Date(message.createdAt) : new Date();
  return {
    customerId: customer.id,
    messageId: message.id,
    adId: t.adId,
    adSetId: ref?.adSetId ?? null,
    campaignId: ref?.campaignId ?? null,
    mappingStatusAtTouch: ref ? "MAPPED" : "UNMAPPED",
    touchAt,
    touchDateWib: new Date(`${hariWIB(touchAt)}T00:00:00.000Z`),
    providerTs: t.providerTs,
    evidenceSource: t.evidenceSource,
    sourceType: t.sourceType,
    entryPointSource: t.entryPointSource,
    entryPointApp: t.entryPointApp,
    ctwaClidHash: t.ctwaClidHash,
    customerNewAtTouch: !!customerBaru,
    dedupeKey: t.dedupeKey,
    captureVersion: TOUCH_VERSION,
  };
}

const cariReferensi = (db, adId) => db.metaAdReference.findUnique({ where: { adId }, select: { adSetId: true, campaignId: true } });
const rusak = (e) => Object.assign(new Error("TOUCH_TX_RUSAK"), { code: "TOUCH_TX_RUSAK", cause: e });
const transaksiBermasalah = (e) => e?.code === "TOUCH_TX_RUSAK" || e?.code === "P2028" || e?.code === "P2034";

/** Menulis touch DI DALAM transaksi pesan, di balik SAVEPOINT. Hanya melempar bila transaksi tidak dapat dipakai lagi (TOUCH_TX_RUSAK). */
async function tulisTouchDalamTx(tx, rencana, ctx) {
  try { await tx.$executeRawUnsafe(`SAVEPOINT ${SAVEPOINT}`); } catch (e) { throw rusak(e); }
  try {
    const ref = await cariReferensi(tx, rencana.touch.adId);
    await tx.attributionTouch.create({ data: dataTouch(rencana, { ...ctx, ref }) });
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    stats.direkam++;
    return { status: "REKAM", adId: rencana.touch.adId, mapped: !!ref };
  } catch (e) {
    try { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`); } catch (e2) { throw rusak(e2); }
    if (e?.code === "P2002") { stats.duplikat++; return { status: "DUPLIKAT" }; }
    catatGagal(e);
    return { status: "GAGAL" };
  }
}

/** Percobaan susulan di luar transaksi (jalur fallback). Tidak melempar. */
async function tulisTouchSusulan(db, rencana, ctx) {
  const id = ++tertundaSeq;
  tertunda.set(id, Date.now());
  try {
    const ref = await cariReferensi(db, rencana.touch.adId);
    try {
      await db.attributionTouch.create({ data: dataTouch(rencana, { ...ctx, ref }) });
      stats.dipulihkan++;
      return { status: "DIPULIHKAN" };
    } catch (e) {
      if (e?.code === "P2002") { stats.duplikat++; return { status: "DUPLIKAT" }; }
      throw e;
    }
  } catch (e) {
    stats.gagalPulih++;
    stats.terakhirGagalAt = new Date().toISOString();
    try { warnLimited(`gagal memulihkan touch (${kodeGalat(e)})`); } catch { /* sengaja diam */ }
    return { status: "GAGAL" };
  } finally {
    tertunda.delete(id);
  }
}

/**
 * Titik masuk dari webhook: menyimpan pesan inbound dan (bila ada rencana) touch-nya secara ATOMIK.
 * Error dari `buatPesan` (mis. P2002 = pesan sudah ada) dilempar apa adanya seperti jalur lama; yang tidak pernah melempar adalah atribusi.
 * @param {object} db PrismaClient
 * @param {{rencana:(null|{touch:object}), buatPesan:(client:object)=>Promise<{id:string,createdAt?:Date}>, customer:{id:string,createdAt?:Date}, customerSudahAda:boolean, sekarang?:Date, tunggu?:boolean}} arg
 *   tunggu=true: percobaan susulan di-await (tes). Default: dijalankan di latar.
 * @returns {Promise<{message:object, touch:{status:string}}>}
 */
export async function simpanPesanDenganTouch(db, { rencana, buatPesan, customer, customerSudahAda, sekarang = new Date(), tunggu = false }) {
  if (!rencana || !customer?.id) return { message: await buatPesan(db), touch: { status: "TANPA_TOUCH" } };

  const customerBaru = await tentukanCustomerBaru(db, { customer, customerSudahAda, sekarang });
  let hasil = { status: "GAGAL" };
  try {
    const message = await db.$transaction(async (tx) => {
      const m = await buatPesan(tx);
      hasil = await tulisTouchDalamTx(tx, rencana, { customer, message: m, customerBaru });
      return m;
    }, { timeout: 8000, maxWait: 3000 });
    return { message, touch: hasil };
  } catch (e) {
    if (!transaksiBermasalah(e)) throw e;           // termasuk P2002 dari pesan: ditangani pemanggil (skip-dupe)
    stats.fallbackTransaksi++;
    try { warnLimited(`transaksi touch bermasalah (${kodeGalat(e?.cause || e)}) — pesan disimpan tanpa transaksi`); } catch { /* sengaja diam */ }
    const message = await buatPesan(db);            // jalur lama; galatnya (mis. P2002) mengalir seperti biasa
    const susulan = tulisTouchSusulan(db, rencana, { customer, message, customerBaru });
    if (tunggu) return { message, touch: await susulan };
    susulan.catch(() => {});
    return { message, touch: { status: "FALLBACK_TERTUNDA" } };
  }
}

/**
 * Jalur lama non-atomik (best effort, setelah pesan tersimpan). Dipertahankan untuk tes/kompatibilitas; webhook memakai simpanPesanDenganTouch.
 * TIDAK PERNAH melempar.
 */
export async function rekamTouch(db, { payload, event, engine, externalId, customer, message, isNewCustomer }) {
  try {
    if (!isTouchCaptureOn()) return { status: "OFF" };
    if (!customer?.id || !message?.id) { stats.dilewati++; return { status: "DILEWATI", alasan: "TANPA_CUSTOMER_ATAU_PESAN" }; }
    const b = bangunTouch(payload, { externalId, isNewCustomer, event, engine, salt: saltAsli() });
    if (!b.valid) { stats.bukanTouch++; return { status: "BUKAN_TOUCH", alasan: b.alasan }; }
    const ref = await cariReferensi(db, b.touch.adId);
    try {
      await db.attributionTouch.create({ data: dataTouch({ touch: b.touch }, { customer, message, customerBaru: isNewCustomer, ref }) });
      stats.direkam++;
      return { status: "REKAM", adId: b.touch.adId, mapped: !!ref };
    } catch (e) {
      if (e?.code === "P2002") { stats.duplikat++; return { status: "DUPLIKAT" }; }
      throw e;
    }
  } catch (e) {
    catatGagal(e);
    return { status: "GAGAL" };
  }
}
