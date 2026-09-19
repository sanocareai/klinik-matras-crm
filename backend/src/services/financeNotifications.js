// DISPATCH NOTIFIKASI FINANCE — fondasi push untuk aplikasi Finance mobile.
//
// Yang ada di sini hanya PENGIRIM (siapa penerimanya, ke token mana, bagaimana
// isi yang aman di layar terkunci). Pemasangan pemicu di route finance
// (submit/approve/verifikasi) dikerjakan di slice S11, supaya perilaku
// endpoint yang sekarang berjalan tidak berubah di S0.
//
// AMAN BY DEFAULT — TIDAK ADA PUSH KELUAR kecuali:
//   • FINANCE_PUSH_ENABLED=true, DAN
//   • untuk token provider "fcm": kredensial FCM lengkap (services/fcmTransport.js);
//     untuk token provider "expo": tidak butuh kredensial server (Expo Push).
// Kegagalan push TIDAK PERNAH dilempar ke pemanggil (fire-and-forget); token
// yang sudah mati dibersihkan dari database.
//
// Privasi: title/body sengaja generik (tanpa nominal/nama). Detail hanya di
// `data` untuk dibaca aplikasi setelah dibuka kuncinya.

import { prisma } from "../db.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P } from "../constants/permissions.js";
import { fcmConfigured, sendFcm } from "./fcmTransport.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
let expoFetch = (...a) => globalThis.fetch(...a);
/** Ganti fetch Expo — hanya untuk tes. */
export function setExpoFetchForTests(fn) { expoFetch = fn || ((...a) => globalThis.fetch(...a)); }

export function financePushEnabled() {
  return process.env.FINANCE_PUSH_ENABLED === "true";
}

/** ID pengguna AKTIF yang memegang permission tertentu (lewat role apa pun). */
export async function usersWithPermission(db, permission) {
  const roles = Object.entries(ROLE_PERMISSIONS).filter(([, perms]) => perms.includes(permission)).map(([r]) => r);
  if (!roles.length) return [];
  const [viaTable, viaLegacy] = await Promise.all([
    db.userRole.findMany({ where: { role: { in: roles }, user: { active: true } }, select: { userId: true } }),
    db.user.findMany({ where: { role: { in: roles }, active: true }, select: { id: true } }),
  ]);
  return [...new Set([...viaTable.map((r) => r.userId), ...viaLegacy.map((u) => u.id)])];
}

async function kirimExpo(tokens, { title, body, data, channelId }) {
  const messages = tokens.map((t) => ({ to: t.fcmToken, title, body, data, sound: "default", channelId }));
  try {
    const res = await expoFetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
    const json = await res.json();
    const mati = [];
    (json.data || []).forEach((t, i) => {
      if (t?.status === "error" && t?.details?.error === "DeviceNotRegistered") mati.push(tokens[i].id);
    });
    return { terkirim: tokens.length - mati.length, mati };
  } catch (err) {
    console.warn("[financePush] Expo gagal:", err.message);
    return { terkirim: 0, mati: [] };
  }
}

/**
 * Kirim notifikasi ke penerima. Penerima = `userIds` eksplisit ATAU semua
 * pemegang `permission`; `excludeUserId` (biasanya pelaku aksi) tidak dikirimi.
 * Hasil: ringkasan angka (tidak pernah melempar).
 */
export async function dispatchFinanceNotification({
  title, body, data = {}, channelId = "approval",
  permission = null, userIds = null, excludeUserId = null, db = prisma,
}) {
  const ringkasan = { penerima: 0, terkirim: 0, dihapus: 0, dilewati: null };
  try {
    if (!financePushEnabled()) return { ...ringkasan, dilewati: "push_nonaktif" };

    let target = userIds ? [...new Set(userIds)] : permission ? await usersWithPermission(db, permission) : [];
    if (excludeUserId) target = target.filter((id) => id !== excludeUserId);
    ringkasan.penerima = target.length;
    if (!target.length) return ringkasan;

    const tokens = await db.mobileDeviceToken.findMany({ where: { userId: { in: target } } });
    if (!tokens.length) return ringkasan;

    const fcmTokens = tokens.filter((t) => t.provider === "fcm");
    const expoTokens = tokens.filter((t) => t.provider === "expo");
    const rusak = [];

    if (fcmTokens.length) {
      if (!fcmConfigured()) {
        ringkasan.dilewati = "tanpa_kredensial_fcm";
      } else {
        const hasil = await Promise.allSettled(fcmTokens.map((t) => sendFcm(t.fcmToken, { title, body, data, channelId })));
        hasil.forEach((r, i) => {
          if (r.status !== "fulfilled") return;
          if (r.value.ok) ringkasan.terkirim += 1;
          else if (r.value.invalidToken) rusak.push(fcmTokens[i].id);
        });
      }
    }
    for (let i = 0; i < expoTokens.length; i += 100) {
      const { terkirim, mati } = await kirimExpo(expoTokens.slice(i, i + 100), { title, body, data, channelId });
      ringkasan.terkirim += terkirim;
      rusak.push(...mati);
    }

    if (rusak.length) {
      const r = await db.mobileDeviceToken.deleteMany({ where: { id: { in: rusak } } });
      ringkasan.dihapus = r.count;
    }
    return ringkasan;
  } catch (err) {
    console.warn("[financePush] dispatch gagal:", err.message);
    return { ...ringkasan, dilewati: "galat" };
  }
}

const JENIS_LABEL = { expense: "pengeluaran", purchase: "pembelian", bill: "tagihan supplier", refund: "refund" };

/** Pengajuan baru menunggu persetujuan → pemegang FINANCE_APPROVE selain pengaju. */
export function notifyApprovalRequested({ jenis, id, nomor, actorId }) {
  return dispatchFinanceNotification({
    title: "Ada pengajuan menunggu persetujuan",
    body: "Buka aplikasi untuk memeriksa dan memutuskan.",
    data: { type: "approval_requested", jenis, id, nomor: nomor || "", url: `sanofinance://approval/${jenis}/${id}` },
    channelId: "approval",
    permission: P.FINANCE_APPROVE,
    excludeUserId: actorId || null,
  });
}

/** Putusan (setuju/tolak) → pengaju dokumen. */
export function notifyApprovalDecided({ jenis, id, nomor, decision, submitterId }) {
  const label = JENIS_LABEL[jenis] || "pengajuan";
  return dispatchFinanceNotification({
    title: decision === "approved" ? "Pengajuan disetujui" : "Pengajuan ditolak",
    body: `Ada putusan untuk ${label} Anda. Buka aplikasi untuk melihat.`,
    data: { type: "approval_decided", decision, jenis, id, nomor: nomor || "", url: `sanofinance://${jenis}/${id}` },
    channelId: "approval",
    userIds: submitterId ? [submitterId] : [],
  });
}

/** Ada pembayaran/order lunas menunggu verifikasi → pemegang PAYMENT_WRITE. */
export function notifyPaymentsPending({ count }) {
  return dispatchFinanceNotification({
    title: "Pembayaran menunggu verifikasi",
    body: "Ada pembayaran yang perlu dicek uang masuknya.",
    data: { type: "payments_pending", count: String(count ?? ""), url: "sanofinance://payments" },
    channelId: "pembayaran",
    permission: P.PAYMENT_WRITE,
  });
}
