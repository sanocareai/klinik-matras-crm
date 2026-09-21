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

// Kategori yang bisa diatur pengguna (S11). Baris preferensi tidak ada / kunci tidak ada = aktif.
export const KATEGORI_NOTIF = ["approval", "pembayaran", "piutang", "supplier", "sensitif"];
const CHANNEL_KATEGORI = { approval: "approval", pembayaran: "pembayaran", piutang: "pengingat", supplier: "pengingat", sensitif: "sensitif" };

export async function bacaPreferensi(db, userId) {
  const row = await db.mobileNotificationPref.findUnique({ where: { userId } });
  const c = row?.categories && typeof row.categories === "object" ? row.categories : {};
  return Object.fromEntries(KATEGORI_NOTIF.map((k) => [k, c[k] !== false]));
}

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
  title, body, data = {}, channelId = null, category = "approval",
  permission = null, userIds = null, excludeUserId = null, db = prisma,
}) {
  const ringkasan = { penerima: 0, terkirim: 0, dihapus: 0, dilewati: null };
  try {
    if (!financePushEnabled()) return { ...ringkasan, dilewati: "push_nonaktif" };

    let target = userIds ? [...new Set(userIds)] : permission ? await usersWithPermission(db, permission) : [];
    if (excludeUserId) target = target.filter((id) => id !== excludeUserId);
    ringkasan.penerima = target.length;
    if (!target.length) return ringkasan;

    // Preferensi per kategori: pengguna yang mematikan kategori ini tidak dikirimi.
    const mati = await db.mobileNotificationPref.findMany({ where: { userId: { in: target } }, select: { userId: true, categories: true } });
    const nonaktif = new Set(mati.filter((p) => p.categories && typeof p.categories === "object" && p.categories[category] === false).map((p) => p.userId));
    target = target.filter((id) => !nonaktif.has(id));
    ringkasan.penerima = target.length;
    if (!target.length) return ringkasan;
    channelId = channelId || CHANNEL_KATEGORI[category] || "approval";

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
const jenisApproval = (jenis) => (["expense", "purchase", "bill", "refund"].includes(jenis) ? jenis : null);

// `path` = rute layar di aplikasi (divalidasi ulang oleh klien terhadap daftar putih). `url` dipertahankan untuk kompatibilitas.
const pathApproval = (jenis, id) => `/persetujuan/${jenis}/${id}`;

/** Pengajuan baru menunggu persetujuan → pemegang FINANCE_APPROVE selain pengaju. */
export function notifyApprovalRequested({ jenis, id, nomor, actorId }) {
  if (!jenisApproval(jenis) || !id) return Promise.resolve({ dilewati: "jenis_tidak_dikenal" });
  return dispatchFinanceNotification({
    title: "Ada pengajuan menunggu persetujuan",
    body: "Buka aplikasi untuk memeriksa dan memutuskan.",
    data: { type: "approval_requested", jenis, id, nomor: nomor || "", path: pathApproval(jenis, id), url: `sanofinance://approval/${jenis}/${id}` },
    category: "approval",
    permission: P.FINANCE_APPROVE,
    excludeUserId: actorId || null,
  });
}

/** Putusan (setuju/tolak) → pengaju dokumen. */
export function notifyApprovalDecided({ jenis, id, nomor, decision, submitterId }) {
  if (!jenisApproval(jenis) || !id || !submitterId) return Promise.resolve({ dilewati: "tanpa_penerima" });
  const label = JENIS_LABEL[jenis] || "pengajuan";
  return dispatchFinanceNotification({
    title: decision === "approved" ? "Pengajuan disetujui" : "Pengajuan ditolak",
    body: `Ada putusan untuk ${label} Anda. Buka aplikasi untuk melihat.`,
    data: { type: "approval_decided", decision, jenis, id, nomor: nomor || "", path: `/tx/${MODUL_DARI_JENIS[jenis]}/${id}`, url: `sanofinance://approval/${jenis}/${id}` },
    category: "approval",
    userIds: [submitterId],
  });
}
const MODUL_DARI_JENIS = { expense: "pengeluaran", purchase: "pembelian", bill: "tagihan", refund: "refund" };

/** Ada pembayaran menunggu verifikasi → pemegang PAYMENT_WRITE. */
export function notifyPaymentsPending({ count }) {
  return dispatchFinanceNotification({
    title: "Pembayaran menunggu verifikasi",
    body: "Ada pembayaran yang perlu dicek uang masuknya.",
    data: { type: "payments_pending", count: String(count ?? ""), path: "/pembayaran", url: "sanofinance://payments" },
    category: "pembayaran",
    permission: P.PAYMENT_WRITE,
  });
}

/** Pembayaran ditolak verifikator → pencatat pembayaran (bila pengguna aplikasi). */
export function notifyPaymentRejected({ id, recordedById, actorId }) {
  if (!id || !recordedById || recordedById === actorId) return Promise.resolve({ dilewati: "tanpa_penerima" });
  return dispatchFinanceNotification({
    title: "Pembayaran ditolak",
    body: "Ada pembayaran yang ditolak. Buka aplikasi untuk melihat alasannya.",
    data: { type: "payment_rejected", id, path: `/pembayaran/${id}`, url: `sanofinance://payments/${id}` },
    category: "pembayaran",
    userIds: [recordedById],
  });
}

/** Pengingat jatuh tempo (piutang / tagihan supplier) → pemegang FINANCE_READ. Tanpa nominal/nama; jumlah hanya di data. */
export function notifyDueReminder({ kind, count }) {
  const piutang = kind === "piutang";
  return dispatchFinanceNotification({
    title: piutang ? "Piutang jatuh tempo" : "Tagihan supplier jatuh tempo",
    body: piutang ? "Ada piutang pelanggan yang jatuh tempo hari ini atau besok." : "Ada tagihan supplier yang jatuh tempo hari ini atau besok.",
    data: { type: piutang ? "receivable_due" : "bill_due", count: String(count ?? ""), path: piutang ? "/tx/piutang" : "/tx/tagihan" },
    category: piutang ? "piutang" : "supplier",
    permission: P.FINANCE_READ,
  });
}

/** Transaksi sensitif (pembatalan/pembalikan jurnal oleh admin) → pemegang FINANCE_ADMIN selain pelaku. */
export function notifySensitive({ modul, id, actorId }) {
  if (!id) return Promise.resolve({ dilewati: "tanpa_penerima" });
  return dispatchFinanceNotification({
    title: "Transaksi sensitif dicatat",
    body: "Ada pembatalan transaksi yang perlu Anda ketahui. Buka aplikasi untuk melihat.",
    data: { type: "sensitive_action", modul: modul || "", id, path: modul ? `/tx/${modul}/${id}` : "/" },
    category: "sensitif",
    permission: P.FINANCE_ADMIN,
    excludeUserId: actorId || null,
  });
}
