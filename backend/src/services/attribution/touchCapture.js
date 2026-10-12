// ATRIBUSI CTWA FASE 2 — penangkapan TOUCH iklan pada jalur inbound tersimpan.
//
// Satu touch = satu pesan inbound yang membawa sinyal iklan CTWA VALID: contextInfo.externalAdReply.sourceID numerik DAN sourceType = "ad".
// Ad ID BERASAL dari payload webhook (sourceID) — TIDAK PERNAH disimpulkan dari URL postingan, shortcode, nama, atau kemiripan angka.
//
// Titik pemasangan: routes/webhooks.js tepat SETELAH Message.create sukses (customer.id dan message.id sudah ada; tidak ada backfill customer dari
// berkas capture Fase 0 karena JSONL itu tidak memuat customer ID). Kontrak:
//   - flag ATRIBUSI_TOUCH_CAPTURE_ENABLED harus persis "true" (default MATI);
//   - TIDAK PERNAH melempar dan TIDAK menunda inbox (dipanggil tanpa await; kegagalan hanya tercatat di stats + peringatan berbatas 1x/menit);
//   - idempoten: kunci dedupe = hash ID pesan inti (message + message.any + retry untuk pesan yang sama = 1 baris);
//   - tidak menyimpan isi chat, nomor, nama, JID, payload mentah, atau clid mentah (hanya hash HMAC 16 hex bila CTWA_CAPTURE_HASH_SALT valid).
import crypto from "crypto";
import { buildObservation } from "../ctwaCapture.js";
import { idPesanInti } from "../../utils/idPesanWa.js";
import { hariWIB } from "./cohort.js";

export const TOUCH_FLAG = "ATRIBUSI_TOUCH_CAPTURE_ENABLED";
export const TOUCH_VERSION = 1;
export const EVIDENCE = Object.freeze({ CTWA_AD: "CTWA_AD", AD_REPLY_UNMARKED: "AD_REPLY_UNMARKED" });

export const isTouchCaptureOn = () => process.env[TOUCH_FLAG] === "true";
const saltAsli = () => {
  const s = process.env.CTWA_CAPTURE_HASH_SALT;
  return typeof s === "string" && s.length >= 16 ? s : null;
};
const SALT_PLACEHOLDER = "touch-tanpa-salt-placeholder-0000";   // hanya agar buildObservation tidak melempar; hasil hash-nya DIBUANG

const stats = { direkam: 0, duplikat: 0, bukanTouch: 0, gagal: 0, dilewati: 0 };
let lastWarnAt = 0;
export const _getTouchStats = () => ({ ...stats });
export const _resetTouchStats = () => { for (const k of Object.keys(stats)) stats[k] = 0; lastWarnAt = 0; };
function warnLimited(kode) {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn(`[atribusi-touch] ${kode}`);   // hanya kode, tidak pernah pesan error (bisa memuat nilai)
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
 * AD_REPLY_UNMARKED (balasan ke iklan tanpa penanda/clid, mis. Status WhatsApp) direkam dengan evidenceSource sendiri; laporan memilih sinyalnya.
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
 * Titik masuk dari webhook. TIDAK PERNAH melempar. Dipanggil TANPA await oleh webhook; tes boleh meng-await hasilnya.
 * @param {object} db PrismaClient
 * @param {{payload:object,event?:string,engine?:string,externalId:string,customer:{id:string},message:{id:string,createdAt?:Date},isNewCustomer:boolean}} arg
 */
export async function rekamTouch(db, { payload, event, engine, externalId, customer, message, isNewCustomer }) {
  try {
    if (!isTouchCaptureOn()) return { status: "OFF" };
    if (!customer?.id || !message?.id) { stats.dilewati++; return { status: "DILEWATI", alasan: "TANPA_CUSTOMER_ATAU_PESAN" }; }
    const b = bangunTouch(payload, { externalId, isNewCustomer, event, engine, salt: saltAsli() });
    if (!b.valid) { stats.bukanTouch++; return { status: "BUKAN_TOUCH", alasan: b.alasan }; }

    const t = b.touch;
    const touchAt = message.createdAt ? new Date(message.createdAt) : new Date();
    const ref = await db.metaAdReference.findUnique({ where: { adId: t.adId }, select: { adSetId: true, campaignId: true } });
    try {
      await db.attributionTouch.create({
        data: {
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
          customerNewAtTouch: t.customerNewAtTouch,
          dedupeKey: t.dedupeKey,
          captureVersion: TOUCH_VERSION,
        },
      });
      stats.direkam++;
      return { status: "REKAM", adId: t.adId, mapped: !!ref };
    } catch (e) {
      if (e?.code === "P2002") { stats.duplikat++; return { status: "DUPLIKAT" }; }
      throw e;
    }
  } catch (e) {
    stats.gagal++;
    try { warnLimited(`gagal merekam touch (${e?.code || "ERR"})`); } catch { /* sengaja diam */ }
    return { status: "GAGAL" };
  }
}
