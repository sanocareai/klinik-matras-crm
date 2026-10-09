// SPESIFIKASI PRODUKSI ORDER PENJUALAN KARYAWAN — fungsi MURNI (tanpa DB) supaya bisa dipakai gerbang Produksi, layar Finance, dan tes dengan aturan yang SAMA.
//
// Order yang lahir dari Penjualan Karyawan (PKR) bisa dibuat Finance sebelum spesifikasi produksinya diketahui. Order tetap muncul di CRM, tetapi berstatus
// "Perlu dilengkapi" dan Produksi TIDAK boleh memulai tahap sampai lengkap. Status ini DIHITUNG dari isi order (bukan kolom tersendiri), jadi tidak bisa tidak sinkron:
// bila Sales/Finance mengubah merk/ukuran/alamat lewat jalur mana pun, hasilnya langsung ikut.
//
// Lengkap bila: merk kasur terisi, ukuran terisi, sudah ditentukan perlu dikirim atau diambil sendiri, dan bila perlu dikirim maka alamat pengiriman terisi.

function teksAtauNull(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Notes order berformat JSON (D-012) atau teks polos lama. Tidak pernah melempar. */
export function bacaNotesOrder(notes) {
  if (!notes || typeof notes !== "string") return {};
  try {
    const p = JSON.parse(notes);
    return p && typeof p === "object" && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

/**
 * @param {{ notes?: string|null, pkrPerluDikirim?: boolean|null, deliveryAddress?: string|null, deliveryCity?: string|null }} order
 * @returns {{ lengkap: boolean, kurang: string[], merk: string|null, ukuran: string|null, perluDikirim: boolean|null, alamat: string|null, kota: string|null }}
 */
export function bacaSpesifikasiPkr(order) {
  const info = bacaNotesOrder(order?.notes);
  const merk = teksAtauNull(info.merkKasur);
  const ukuran = teksAtauNull(info.ukuranKasur);
  const alamat = teksAtauNull(order?.deliveryAddress);
  const kota = teksAtauNull(order?.deliveryCity);
  const perluDikirim = order?.pkrPerluDikirim ?? null;
  const kurang = [];
  if (!merk) kurang.push("Merk kasur");
  if (!ukuran) kurang.push("Ukuran");
  if (perluDikirim === null) kurang.push("Dikirim atau diambil sendiri");
  else if (perluDikirim === true && !alamat) kurang.push("Alamat pengiriman");
  return { lengkap: kurang.length === 0, kurang, merk, ukuran, perluDikirim, alamat, kota };
}

export const PESAN_SPEK_BELUM_LENGKAP = (nomor, kurang) =>
  `Order Penjualan Karyawan${nomor ? ` ${nomor}` : ""} perlu dilengkapi dulu (${kurang.join(", ")}). Produksi belum boleh dimulai. Lengkapi di Finance › Penjualan Karyawan.`;
