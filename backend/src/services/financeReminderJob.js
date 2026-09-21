// JOB PENGINGAT FINANCE (S11) — sekali sehari (08:00 WIB): piutang & tagihan supplier yang jatuh tempo hari ini/besok, dan pembayaran menunggu verifikasi.
// DORMAN sampai FINANCE_PUSH_ENABLED=true (job terdaftar, tetapi tiap tick keluar lebih dulu bila push nonaktif). Hasil dihitung dengan fungsi laporan yang sama
// dengan web (umurPiutang/umurUtang). Isi push tidak memuat nominal/nama.

import cron from "node-cron";
import { prisma } from "../db.js";
import { umurPiutang, umurUtang } from "./finance/reports.js";
import { financePushEnabled, notifyDueReminder, notifyPaymentsPending } from "./financeNotifications.js";

/** Item jatuh tempo hari ini atau besok (hariLewat ∈ {-1, 0}). */
export const jatuhTempoDekat = (baris) => (Array.isArray(baris) ? baris : []).filter((b) => Number.isFinite(Number(b?.hariLewat)) && Number(b.hariLewat) >= -1 && Number(b.hariLewat) <= 0);

export async function runFinanceReminderCycle(db = prisma) {
  if (!financePushEnabled()) return { dilewati: "push_nonaktif" };
  const hasil = {};
  try {
    const p = await umurPiutang(db);
    const n = jatuhTempoDekat(p?.baris).length;
    if (n > 0) hasil.piutang = await notifyDueReminder({ kind: "piutang", count: n });
  } catch (e) { console.warn("[finance-reminder] piutang gagal:", e.message); }
  try {
    const u = await umurUtang(db);
    const n = jatuhTempoDekat(u?.baris).length;
    if (n > 0) hasil.supplier = await notifyDueReminder({ kind: "supplier", count: n });
  } catch (e) { console.warn("[finance-reminder] utang gagal:", e.message); }
  try {
    const menunggu = await db.payment.count({ where: { cancelledAt: null, verifications: { none: {} } } });
    if (menunggu > 0) hasil.pembayaran = await notifyPaymentsPending({ count: menunggu });
  } catch (e) { console.warn("[finance-reminder] pembayaran gagal:", e.message); }
  return hasil;
}

export function startFinanceReminderJob() {
  cron.schedule("0 8 * * *", () => { void runFinanceReminderCycle(); }, { timezone: "Asia/Jakarta" });
  console.log("[finance-reminder] Job terdaftar — 08:00 Asia/Jakarta (aktif hanya bila FINANCE_PUSH_ENABLED=true)");
}
