// Manifest barang Delivery (14 Okt 2026) — pembaca `job.manifest` yang dibangun SERVER (backend lib/domain/deliveryManifest.js) dari unit tertaut ke job.
// Layar TIDAK menghitung ulang dari ringkasan order: angka stop/unit/jenis produk sama dengan web, pesan grup WA, sheet rute, dan app driver. Tanpa harga.
// Murni (tanpa I/O) supaya bisa diuji di Node.

export const manifestJob = (job) => job?.manifest ?? null;

/** "3× Kasur Sorong 3in1 Custom — 100 × 200 cm" (+ spesifikasi bila ada). */
export function teksBarisManifest(b) {
  const inti = `${b.qty}× ${b.nama}`;
  const rincian = [b.ukuran, b.spesifikasi].filter(Boolean).join(" · ");
  return rincian ? `${inti} — ${rincian}` : inti;
}

/** Tiga angka terpisah; null bila server belum mengirim manifest (payload lama). */
export function angkaManifest(job) {
  const m = manifestJob(job);
  return m ? { stop: m.stop ?? 1, unit: m.unit ?? 0, jenisProduk: m.jenisProduk ?? 0 } : null;
}

/** Label unit "U1, U2, U3" dari satu baris manifest. */
export const labelUnitBaris = (b) => (b?.unitLabel ?? (b?.unit ?? []).map((u) => u.label)).join(", ");

/** Progres muat dari server: { dimuat, total, lengkap, label } atau null. */
export function progresMuatServer(job) {
  const m = manifestJob(job);
  if (!m?.muat || !(m.muat.total > 0)) return null;
  return { dimuat: m.muat.dimuat, total: m.muat.total, lengkap: Boolean(m.muat.lengkap), label: m.muat.label };
}

/** Sumber transaksi: { label, penjual, picLead } — penjual ≠ Sales lead; picLead hanya bila berbeda. */
export function sumberManifest(job) {
  const s = manifestJob(job)?.sumber;
  return s ? { label: s.label, penjual: s.penjual ?? null, picLead: s.picLead ?? null } : null;
}

/** Ringkasan seluruh rute: { stop, unit } dari job DELIVERY yang membawa manifest. */
export function ringkasManifestRute(jobs = []) {
  const antar = jobs.filter((j) => j?.type === "DELIVERY" && j.manifest);
  return { stop: antar.length, unit: antar.reduce((n, j) => n + (j.manifest.unit || 0), 0) };
}
