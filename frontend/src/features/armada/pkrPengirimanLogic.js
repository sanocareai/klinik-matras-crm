// Logika murni tampilan "order PKR — unit belum terkirim" di layar Delivery (dipakai PkrPengirimanPanel, dites tanpa DOM).
// Aturan (keputusan Owner): setelah pengiriman sebagian, unit sisa TETAP terlihat dan pengiriman berikutnya hanya lewat aksi eksplisit — tidak ada job otomatis.

/** Ringkasan satu baris order dari respons GET /armada/pkr-pengiriman (menunggu[]). */
export function ringkasBarisPengiriman(o) {
  const sisa = Array.isArray(o?.sisa) ? o.sisa : [];
  const sudah = Number(o?.ringkas?.sudahDalamJob) || 0;
  const siapKirim = sisa.filter((u) => u.siap);
  return {
    sudahDalamJob: sudah,
    sisa,
    teksSisa: sisa.length ? `Sisa unit: ${sisa.map((u) => `${u.unitCode} (${u.siap ? "siap kirim" : "belum siap"})`).join(", ")}` : "",
    labelAksi: sudah > 0 ? "Kirim sisa…" : "Kirim sebagian…",
    // Aksi aktif hanya bila ada sisa yang siap; selain itu tombol nonaktif (unit sisa tetap terdaftar di atas).
    aksiAktif: o?.bisaKirimSebagian === undefined ? siapKirim.length > 0 : o.bisaKirimSebagian === true,
  };
}
