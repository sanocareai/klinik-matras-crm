// NOTIFIKASI PUSH SANSS PRODUKSI (aplikasi Android lantai produksi, 12 November 2026).
//
// AMAN BY DEFAULT — TIDAK ADA PUSH KELUAR kecuali PRODUCTION_PUSH_ENABLED=true. Saat mati, pemicu di route
// bahkan TIDAK memuat kartu "sebelum/sesudah" (nol beban tambahan pada perintah produksi).
// Penerima hanya token app="production" di mobile_device_tokens (token Finance tidak pernah tersentuh; satu kiriman
// Expo tidak boleh mencampur token dua proyek). Kegagalan push TIDAK PERNAH dilempar ke pemanggil.
//
// Isi notifikasi: kode unit pendek + tahap, TANPA nama customer (terlihat di layar terkunci). `data.path` = layar
// tujuan di aplikasi (divalidasi ulang oleh klien terhadap daftar putih).
//
// Pemicu (dipasang di route, setelah perintah BERHASIL):
//   • Kartu berpindah ke QC (menunggu Uji Berat Badan)  → semua pemegang peran QC_LEAD
//   • Kartu berpindah ke Corner                           → PIC Corner rencana itu
//   • Kartu kembali ke Meja (mis. QC gagal → rework)      → PIC Meja rencana itu
//   • Urutan satu meja diubah Admin                       → para PIC unit di meja itu
// Pelaku aksi sendiri tidak dikirimi.

import { prisma } from "../db.js";
import { fcmConfigured, sendFcm } from "./fcmTransport.js";
import { loadRuns, viewsOf } from "./productionExperienceReadService.js";
import { parseProductionDate } from "../lib/domain/productionBoard.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
let expoFetch = (...a) => globalThis.fetch(...a);
/** Ganti fetch Expo — hanya untuk tes. */
export function setProductionExpoFetchForTests(fn) { expoFetch = fn || ((...a) => globalThis.fetch(...a)); }

export const productionPushEnabled = () => process.env.PRODUCTION_PUSH_ENABLED === "true";

const kodePendek = (unitCode) => String(unitCode || "").replace(/^[A-Z]{2,4}-\d{8}-/, "");

/** Ringkasan kartu untuk keputusan notifikasi: aksi berikutnya + PIC rencana. null bila run tidak ada. */
export async function ringkasKartu(db, runId) {
  const runs = await loadRuns(db, { id: runId });
  if (!runs.length) return null;
  const [v] = await viewsOf(db, runs, { now: new Date() });
  return {
    runId: v.runId,
    unitCode: v.unit.unitCode,
    actor: v.next?.actor ?? null,
    wait: v.next?.wait ?? null,
    stepNo: v.next?.stepNo ?? null,
    tableUserId: v.plan?.operator?.userId ?? null,
    cornerUserId: v.plan?.cornerOperator?.userId ?? null,
  };
}

/**
 * MURNI — dari ringkasan sebelum & sesudah perintah, tentukan notifikasi yang dikirim.
 * Hanya PERPINDAHAN tim yang dikabarkan (bukan setiap tahap), supaya HP tidak berbunyi terus.
 * @returns {{ ke: "QC_LEAD" | string, title: string, body: string, data: object, channelId: string }[]}
 */
export function notifikasiPerpindahan(sebelum, sesudah) {
  if (!sesudah || !sebelum || sebelum.actor === sesudah.actor) return [];
  const kode = kodePendek(sesudah.unitCode);
  const data = { path: `/unit/${sesudah.runId}`, runId: sesudah.runId, jenis: "" };
  if (sesudah.actor === "QC") {
    return [{ ke: "QC_LEAD", title: "Siap QC", body: `${kode} siap Uji Berat Badan.`, data: { ...data, jenis: "SIAP_QC", path: `/qc/${sesudah.runId}` }, channelId: "tugas" }];
  }
  if (sesudah.actor === "CORNER" && sesudah.cornerUserId) {
    return [{ ke: sesudah.cornerUserId, title: "Siap Corner", body: `${kode} siap dijahit di meja Corner.`, data: { ...data, jenis: "SIAP_CORNER" }, channelId: "tugas" }];
  }
  if (sesudah.actor === "TABLE" && sesudah.tableUserId && sebelum.actor === "QC") {
    return [{ ke: sesudah.tableUserId, title: "QC gagal — rework", body: `${kode} kembali ke Meja untuk rework.`, data: { ...data, jenis: "REWORK" }, channelId: "penting" }];
  }
  return [];
}

/** ID pengguna AKTIF yang memegang peran tertentu (tabel user_roles + kolom role lama). */
export async function usersWithRole(db, role) {
  const [viaTable, viaLegacy] = await Promise.all([
    db.userRole.findMany({ where: { role, user: { active: true } }, select: { userId: true } }),
    db.user.findMany({ where: { role, active: true }, select: { id: true } }),
  ]);
  return [...new Set([...viaTable.map((r) => r.userId), ...viaLegacy.map((u) => u.id)])];
}

async function kirimExpo(tokens, pesan) {
  const messages = tokens.map((t) => ({ to: t.fcmToken, ...pesan, sound: "default" }));
  try {
    const res = await expoFetch(EXPO_PUSH_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(messages) });
    const json = await res.json();
    const mati = [];
    (json.data || []).forEach((t, i) => { if (t?.status === "error" && t?.details?.error === "DeviceNotRegistered") mati.push(tokens[i].id); });
    return { terkirim: tokens.length - mati.length, mati };
  } catch (err) {
    console.warn("[productionPush] Expo gagal:", err.message);
    return { terkirim: 0, mati: [] };
  }
}

/** Kirim ke penerima (userIds) — hanya token app="production". Tidak pernah melempar. */
export async function dispatchProductionNotification({ userIds, title, body, data = {}, channelId = "tugas", excludeUserId = null, db = prisma }) {
  const ringkasan = { penerima: 0, terkirim: 0, dihapus: 0, dilewati: null };
  try {
    if (!productionPushEnabled()) return { ...ringkasan, dilewati: "push_nonaktif" };
    const target = [...new Set(userIds || [])].filter((id) => id && id !== excludeUserId);
    ringkasan.penerima = target.length;
    if (!target.length) return ringkasan;
    const tokens = await db.mobileDeviceToken.findMany({ where: { userId: { in: target }, app: "production" } });
    if (!tokens.length) return ringkasan;
    const rusak = [];
    const fcm = tokens.filter((t) => t.provider === "fcm");
    const expo = tokens.filter((t) => t.provider === "expo");
    if (fcm.length) {
      if (!fcmConfigured()) ringkasan.dilewati = "tanpa_kredensial_fcm";
      else {
        const hasil = await Promise.allSettled(fcm.map((t) => sendFcm(t.fcmToken, { title, body, data, channelId })));
        hasil.forEach((r, i) => { if (r.status === "fulfilled") { if (r.value.ok) ringkasan.terkirim += 1; else if (r.value.invalidToken) rusak.push(fcm[i].id); } });
      }
    }
    for (let i = 0; i < expo.length; i += 100) {
      const { terkirim, mati } = await kirimExpo(expo.slice(i, i + 100), { title, body, data, channelId });
      ringkasan.terkirim += terkirim;
      rusak.push(...mati);
    }
    if (rusak.length) ringkasan.dihapus = (await db.mobileDeviceToken.deleteMany({ where: { id: { in: rusak } } })).count;
    return ringkasan;
  } catch (err) {
    console.warn("[productionPush] dispatch gagal:", err.message);
    return { ...ringkasan, dilewati: "galat" };
  }
}

/**
 * Pembungkus perintah produksi: ambil ringkasan SEBELUM, jalankan perintah, ambil ringkasan SESUDAH, kirim notifikasi
 * perpindahan TANPA menunggu (fire-and-forget). Push mati = perintah dijalankan apa adanya, tanpa query tambahan.
 * Galat pengambilan ringkasan tidak pernah menggagalkan perintah.
 */
export async function denganNotifikasiPerpindahan(runId, actorId, perintah, db = prisma) {
  if (!productionPushEnabled() || !runId) return perintah();
  const sebelum = await ringkasKartu(db, runId).catch(() => null);
  const hasil = await perintah();
  void (async () => {
    try {
      const sesudah = await ringkasKartu(db, runId);
      for (const n of notifikasiPerpindahan(sebelum, sesudah)) {
        const userIds = n.ke === "QC_LEAD" ? await usersWithRole(db, "QC_LEAD") : [n.ke];
        await dispatchProductionNotification({ userIds, title: n.title, body: n.body, data: n.data, channelId: n.channelId, excludeUserId: actorId, db });
      }
    } catch (err) {
      console.warn("[productionPush] notifikasi perpindahan gagal:", err.message);
    }
  })();
  return hasil;
}

/** Urutan meja diubah Admin → kabari para PIC (Meja & Corner) unit di meja itu. Fire-and-forget. */
export function kabariUrutanBerubah({ productionDate, stationCode, actorId, db = prisma }) {
  if (!productionPushEnabled()) return;
  void (async () => {
    try {
      const day = parseProductionDate(productionDate);
      if (!day) return;
      const plans = await db.productionRunPlan.findMany({
        where: { productionDate: day, stationCode, status: { not: "CANCELLED" } },
        select: { operator: { select: { userId: true } }, cornerOperator: { select: { userId: true } } },
      });
      const userIds = plans.flatMap((p) => [p.operator?.userId, p.cornerOperator?.userId]).filter(Boolean);
      await dispatchProductionNotification({
        userIds, title: "Urutan berubah", body: "Admin Produksi mengubah urutan antrean meja kamu. Cek nomor antrean terbaru.",
        data: { path: "/kerja", jenis: "URUTAN" }, channelId: "tugas", excludeUserId: actorId, db,
      });
    } catch (err) {
      console.warn("[productionPush] kabari urutan gagal:", err.message);
    }
  })();
}
