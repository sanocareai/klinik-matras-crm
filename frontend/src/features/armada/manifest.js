// MANIFEST BARANG Delivery (sisi layar) — membaca `job.manifest` yang dibangun SERVER dari unit tertaut ke job (backend lib/domain/deliveryManifest.js).
// Layar TIDAK menghitung ulang dari ringkasan order: satu sumber = angka yang sama di web, pesan grup, dan Driver App. Tidak ada harga.

export const manifestOf = (job) => job?.manifest ?? null;

/** Tiga angka terpisah: stop, unit, jenis produk. null bila server belum mengirim manifest (payload lama). */
export function angkaManifest(job) {
  const m = manifestOf(job);
  if (!m) return null;
  return { stop: m.stop ?? 1, unit: m.unit ?? 0, jenisProduk: m.jenisProduk ?? 0 };
}

/** "1 stop • 3 unit • 1 jenis produk". */
export function ringkasManifest(job) {
  const m = manifestOf(job);
  return m?.ringkas ?? null;
}

/** "3× Kasur Sorong 3in1 custom — 100 × 200 cm" untuk satu baris manifest. */
export function teksBaris(b) {
  const inti = `${b.qty}× ${b.nama}`;
  const rincian = [b.ukuran, b.spesifikasi].filter(Boolean).join(" · ");
  return rincian ? `${inti} — ${rincian}` : inti;
}

/** Satu baris pendek untuk chip kartu stop: baris pertama + "+N jenis lain" bila ada lebih dari satu jenis produk. */
export function produkRingkasKartu(job) {
  const m = manifestOf(job);
  if (!m || !m.baris?.length) return null;
  const pertama = teksBaris(m.baris[0]);
  return m.baris.length > 1 ? `${pertama} +${m.baris.length - 1} jenis lain` : pertama;
}

/** Penjual untuk order Penjualan Karyawan ("Dijual oleh Kemal"). BUKAN Sales pemilik lead customer. */
export const penjualPkrOf = (job) => manifestOf(job)?.sumber?.penjual ?? null;
export const sumberManifestOf = (job) => manifestOf(job)?.sumber ?? null;

/** Daftar baris teks lengkap untuk salin/cetak di web. */
export function teksLengkap(job) {
  const m = manifestOf(job);
  if (!m) return [];
  const out = [m.ringkas];
  let set = null;
  for (const b of m.baris ?? []) {
    if (b.bundel && set !== b.bundel.no) { out.push(`Set ${b.bundel.nama}:`); set = b.bundel.no; }
    if (!b.bundel) set = null;
    out.push(`${b.bundel ? "  " : ""}${teksBaris(b)}`);
    out.push(`${b.bundel ? "  " : ""}Unit: ${(b.unitLabel ?? []).join(", ")}`);
  }
  if (m.sumber) out.push(`Sumber: ${m.sumber.label}`);
  return out;
}
