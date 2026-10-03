// Kontrak kecil dokumentasi POD internal. Dipisahkan dari route supaya format
// pesan dan kill-switch bisa diuji tanpa membuka koneksi database/WhatsApp.

export function isPodBroadcastActive(value = process.env.POD_BROADCAST_AKTIF) {
  return value !== "false";
}

export function buildDriverGroupCaption(job, headline) {
  const orderNo = job?.units?.[0]?.unit?.order?.orderNumber || job?.orderId || "Order tanpa nomor";
  const unitList = (job?.units || [])
    .map((ju) => ju?.unit?.unitCode)
    .filter(Boolean)
    .join(", ") || "Unit tidak tersedia";
  return `${headline}\n*${orderNo}*\n${unitList}`;
}
