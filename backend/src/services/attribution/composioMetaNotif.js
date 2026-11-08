// Isi notifikasi kegagalan sinkron Composio. Hanya kolom agregat yang lolos; pesan galat mentah dan kredensial tidak pernah ikut.
const KODE_AMAN = /^[A-Z0-9_]{1,60}$/;
const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const aman = (v, re) => (typeof v === "string" && re.test(v) ? v : null);

export function ambilRingkasan(keluaran) {
  const baris = String(keluaran ?? "").trim().split(/\r?\n/).reverse();
  for (const b of baris) {
    let j; try { j = JSON.parse(b); } catch { continue; }
    if (!j || typeof j !== "object") continue;
    return {
      status: aman(j.status, KODE_AMAN),
      kode: aman(j.failureCode, KODE_AMAN) ?? aman(j.kode, KODE_AMAN),
      checkpoint: aman(j.checkpoint, TANGGAL),
    };
  }
  return { status: null, kode: null, checkpoint: null };
}

export function susunPesanGagal({ tahap, rc, keluaran, waktu }) {
  const r = ambilRingkasan(keluaran);
  const tanda = r.status ?? "TANPA_STATUS";
  return {
    subject: `[SANSS] Sync Meta gagal: ${tanda}${r.kode ? ` (${r.kode})` : ""}`,
    text: [
      "Sync harian Meta lewat Composio tidak selesai bersih.",
      `Tahap: ${tahap}`,
      `Kode keluar: ${rc}`,
      `Status: ${tanda}`,
      `Kode galat: ${r.kode ?? "-"}`,
      `Checkpoint terakhir: ${r.checkpoint ?? "-"}`,
      `Waktu: ${waktu}`,
      "",
      "Data hari yang belum terbukti tidak ditulis sebagai Rp0. Periksa ~/ops/sync-meta-composio/sync-meta-composio.cron.log di VPS.",
    ].join("\n"),
  };
}
