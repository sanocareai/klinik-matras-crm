// PEMAKAIAN DI BUKTI TAHAP (Aplikasi Meja, tahap 6/7/10) — aturan ADMIN (Nov 2026).
// Bukti dari non-ADMIN tetap tersimpan dan tahap boleh selesai, tetapi jumlah pemakaiannya ditandai `materialsMenungguVerifikasi` dan
// diajukan (pengajuan BUKTI_V2). Untuk STOK & HPP (retur sisa, ringkasan "terpakai") jumlah itu baru dihitung setelah pengajuannya
// DISETUJUI ADMIN lain — memakai isi pengajuan yang disetujui terakhir (pengajuan bisa diubah sebelum/sesudah verifikasi).
// Untuk VALIDASI sisa yang boleh dipakai (cegah pemakaian dua kali), jumlah yang dilaporkan tetap dihitung sejak disimpan.

/** Map evidenceId → baris bahan yang SAH (pengajuan BUKTI_V2 DISETUJUI terakhir) untuk satu run. */
export async function pemakaianBuktiSah(db, runId) {
  const rows = await db.pengajuanPemakaianProduksi.findMany({ where: { runId, jalur: "BUKTI_V2", status: "DISETUJUI" }, orderBy: { diputuskanPada: "asc" }, select: { masukan: true } });
  const sah = new Map();
  for (const r of rows) if (r.masukan?.evidenceId) sah.set(r.masukan.evidenceId, Array.isArray(r.masukan.materials) ? r.masukan.materials : []);
  return sah;
}

/** Baris bahan bukti yang berlaku untuk stok/HPP: bukti ADMIN/lama = payload.materials; bukti tertunda = isi pengajuan yang disetujui (atau kosong). */
export function bahanBuktiBerlaku(e, sah) {
  if (!e?.payload?.materialsMenungguVerifikasi) return e?.payload?.materials || [];
  return sah?.get(e.id) || [];
}
