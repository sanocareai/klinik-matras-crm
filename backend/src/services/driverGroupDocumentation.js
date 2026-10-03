// Kontrak kecil dokumentasi POD internal. Dipisahkan dari route supaya format
// pesan dan kill-switch bisa diuji tanpa membuka koneksi database/WhatsApp.

import { formatUkuranLabel, teksUkuranDariNotes } from "../lib/ukuranKasur.js";

export function isPodBroadcastActive(value = process.env.POD_BROADCAST_AKTIF) {
  return value !== "false";
}

export function buildDriverGroupCaption(job, headline) {
  const order = job?.order || job?.units?.[0]?.unit?.order || null;
  const orderNo = order?.orderNumber || job?.orderId || "Order tanpa nomor";
  const customerName = order?.customer?.name?.trim() || "Customer belum tersedia";

  const ukuranPerUnit = (job?.units || [])
    .map((ju) => formatUkuranLabel(ju?.unit?.ukuran))
    .filter(Boolean);
  const jumlahPerUkuran = new Map();
  for (const ukuran of ukuranPerUnit) jumlahPerUkuran.set(ukuran, (jumlahPerUkuran.get(ukuran) || 0) + 1);
  const ukuranUnit = [...jumlahPerUkuran.entries()]
    .map(([ukuran, jumlah]) => jumlah > 1 ? `${jumlah}× ${ukuran}` : ukuran)
    .join(", ");
  const ukuranOrder = teksUkuranDariNotes(order?.notes);
  const ukuran = ukuranUnit || ukuranOrder || "Ukuran belum diisi";

  return [
    headline,
    `*Customer:* ${customerName}`,
    `*Resi:* ${orderNo}`,
    `*Ukuran kasur:* ${ukuran}`,
  ].join("\n");
}
