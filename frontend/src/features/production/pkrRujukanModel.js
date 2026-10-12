// Rujukan Penjualan Karyawan di daftar Produksi — model murni (tanpa React) supaya aturan tampilannya bisa dites.
// Bentuk server (rujukanPkrDariOrder): { penjualanId, nomor, karyawan, pembeli, perluDikirim, kirimLabel, lengkap, kurang[] }. Tidak membawa nominal.

/** Adaptor dari ringkasan Finance/CRM (ringkasOrderPkr: { nomor, penjual:{name}, pembeli, order:{spesifikasi} }) ke bentuk rujukan Produksi. */
export function rujukanDariRingkas(p) {
  if (!p?.nomor) return null;
  const s = p.order?.spesifikasi || null;
  return {
    penjualanId: p.penjualanId ?? null, nomor: p.nomor, karyawan: p.penjual?.name ?? null, pembeli: p.pembeli ?? null,
    perluDikirim: s?.perluDikirim ?? null,
    kirimLabel: s?.perluDikirim === true ? "Dikirim" : s?.perluDikirim === false ? "Ambil sendiri" : "Belum ditentukan",
    lengkap: s ? !!s.lengkap : false, kurang: s?.kurang ?? [],
    ...(p.order?.modeItem && p.items?.length ? { items: p.items.map((i) => ({ no: i.no, kategori: i.kategoriNama, produk: i.produk, jumlah: i.jumlah, ukuran: i.ukuran, kirim: i.perluDikirim, kurang: i.kurang })) } : {}),
  };
}

/** Teks siap tampil. null bila bukan order Penjualan Karyawan. */
export function tampilRujukanPkr(r) {
  if (!r?.nomor) return null;
  const perluDilengkapi = r.lengkap === false;
  return {
    badge: "Penjualan Karyawan",
    nomor: r.nomor,
    karyawan: r.karyawan || null,
    kirim: r.kirimLabel || (r.perluDikirim === true ? "Dikirim" : r.perluDikirim === false ? "Ambil sendiri" : "Belum ditentukan"),
    perluDilengkapi,
    kurangTeks: perluDilengkapi && r.kurang?.length ? r.kurang.join(", ") : "",
    ringkas: [r.nomor, r.karyawan].filter(Boolean).join(" · "),
    // Order multi-item: satu baris per item ("Kasur Baru ×1 — 200 × 160 × 20 cm"). Kunci HANYA ada untuk order multi-item (order lama satu-spesifikasi: bentuk lama persis).
    ...(r.items?.length ? {
      items: r.items.map((i) => ({
        no: i.no, teks: `${i.produk || i.kategori}${i.jumlah > 1 ? ` ×${i.jumlah}` : ""}`, ukuran: i.ukuran || "", kirim: i.kirim === true ? "Dikirim" : i.kirim === false ? "Ambil sendiri" : "Belum ditentukan",
        kurang: (i.kurang || []).join(", "),
      })),
    } : {}),
  };
}
