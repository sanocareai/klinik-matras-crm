// Logika murni layar pratinjau "Harga Berlaku dari PO" (tanpa React) — diuji di tests/hargaDariPOLogic.test.js.

export const STATUS_HARGA_PO = Object.freeze({
  BARU: { teks: "Harga pertama", varian: "accent" },
  NAIK: { teks: "Naik", varian: "orange" },
  TURUN: { teks: "Turun", varian: "green" },
  SAMA: { teks: "Sama — tidak berubah", varian: "neutral" },
  SUDAH_DITERAPKAN: { teks: "Sudah diterapkan", varian: "neutral" },
  KONFLIK_HARGA_BEDA: { teks: "Konflik harga", varian: "red" },
  KONVERSI_TIDAK_ADA: { teks: "Tidak ada konversi satuan", varian: "red" },
  KONVERSI_TIDAK_SAH: { teks: "Konversi tidak sah", varian: "red" },
});
const KONFLIK = new Set(["KONFLIK_HARGA_BEDA", "KONVERSI_TIDAK_ADA", "KONVERSI_TIDAK_SAH"]);

/** Rupiah dengan sampai 4 desimal (harga per satuan stok bisa pecahan); bulat ditampilkan tanpa desimal. */
export function rpHarga(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `Rp${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 4 })}`;
}

/** Tombol Setujui hanya aktif bila: pratinjau termuat, penyetuju punya izin harga (bila ada harga berubah), dan SETIAP konflik sudah dilewati eksplisit. */
export function bisaSetujuiHargaPO(pra, lewati = new Set()) {
  if (!pra) return { bisa: false, alasan: "Memuat pratinjau…" };
  if (pra.aktif === false) return { bisa: true, alasan: "" };
  const konflik = (pra.baris ?? []).filter((b) => KONFLIK.has(b.status));
  const terbuka = konflik.filter((b) => !lewati.has(b.materialId));
  if (terbuka.length) return { bisa: false, alasan: `${terbuka.length} bahan masih konflik. Perbaiki di draf PO (satukan baris, isi faktor konversi) atau centang “lewati pembaruan harga” untuk bahan tersebut.` };
  if ((pra.ringkas?.akanMengubahHarga ?? 0) > 0 && pra.bolehSetujuiHarga === false) return { bisa: false, alasan: "PO ini mengubah Harga Berlaku. Hanya Finance atau Owner (izin harga berlaku) yang dapat menyetujuinya; akun Anda hanya dapat melihat pratinjau." };
  return { bisa: true, alasan: "" };
}

/** Ringkasan hasil nyata dari respons persetujuan — hanya yang BENAR-BENAR tercatat server (tidak pernah mengklaim harga terbarui bila tidak). */
export function ringkasHasilHargaPO(h) {
  if (!h) return "PO disetujui.";
  if (h.aktif === false) return "PO disetujui. Pembaruan Harga Berlaku otomatis sedang dimatikan.";
  const n = h.diterapkan?.length ?? 0; const l = h.dilewati?.length ?? 0;
  const bagian = [n ? `${n} Harga Berlaku diperbarui` : "tidak ada Harga Berlaku yang berubah"];
  if (l) bagian.push(`${l} bahan dilewati (ubah manual)`);
  return `PO disetujui · ${bagian.join(" · ")}.`;
}
