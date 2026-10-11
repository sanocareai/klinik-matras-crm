// Keputusan kredit closing saat admin mentransfer percakapan (keputusan Owner 11 Okt 2026, opsi B).
// Murni (tanpa DOM) supaya bisa dites; salinan identik untuk mobile ada di mobile/src/lib/kreditTransfer.js (dijaga sama oleh tes paritas).
//
// Server (utils/kreditOrderPerpindahan.js) menyediakan daftar order yang kreditnya SEKARANG ada pada pemegang lama. Admin memutuskan per order:
// IKUT pindah ke penerima (alasan wajib, diaudit) atau TETAP di pemegang lama (default aman; angka laporan tidak bergeser).

/** Pilihan awal per order: yang belum lunas disarankan ikut, yang sudah lunas tetap (komisi sudah terhitung). Penerima non-Sales → semua tetap. */
export function pilihanAwal(orders, penerimaSales) {
  const p = {};
  for (const o of orders || []) p[o.id] = !!penerimaSales && !!o.sarankanIkut;
  return p;
}

export function jumlahIkut(pilihan) {
  return Object.values(pilihan || {}).filter(Boolean).length;
}

/** Galat yang harus dibereskan sebelum tombol Transfer aktif; null bila siap. */
export function validasiKeputusan({ pilihan, alasan, penerimaSales }) {
  if (penerimaSales && jumlahIkut(pilihan) > 0 && !String(alasan || "").trim()) return "Isi alasan pemindahan kredit order";
  return null;
}

/** Badan PATCH /conversations/:id. Order tanpa centang dikirim eksplisit "tetap" agar jejak keputusannya jelas. */
export function buatPayloadTransfer({ userId, orders, pilihan, alasan, penerimaSales }) {
  return {
    assignedToId: userId,
    keputusanOrder: (orders || []).map((o) => ({ orderId: o.id, ikut: !!penerimaSales && !!pilihan?.[o.id] })),
    alasanOrder: String(alasan || "").trim(),
  };
}

/** Ringkasan satu baris untuk konfirmasi. */
export function ringkasanKeputusan({ orders, pilihan, penerimaSales, namaPenerima }) {
  const total = (orders || []).length;
  const ikut = penerimaSales ? jumlahIkut(pilihan) : 0;
  const tetap = total - ikut;
  if (total === 0) return "";
  return `${ikut} order ikut ke ${namaPenerima}, ${tetap} order tetap di pemegang lama`;
}
