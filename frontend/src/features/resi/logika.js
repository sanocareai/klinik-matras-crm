// Logika murni "Buat Resi" (Resi Gabungan Fase 1). Cermin dari backend/src/services/resi.js — server TETAP menghitung ulang dan menegakkan aturan;
// angka di sini hanya pratinjau supaya Sales melihat Total Resi & DP sebelum menyimpan.

export const DP_PERSEN = 30;
export const MAKS_ITEM = 20;

export function bagiProporsional(total, bobot) {
  const jumlah = bobot.reduce((s, b) => s + b, 0);
  if (total <= 0 || jumlah <= 0) return bobot.map(() => 0);
  const mentah = bobot.map((b) => (total * b) / jumlah);
  const dasar = mentah.map((x) => Math.floor(x));
  let sisa = total - dasar.reduce((s, x) => s + x, 0);
  const urutan = mentah.map((x, i) => ({ i, frak: x - Math.floor(x) })).sort((a, b) => b.frak - a.frak || a.i - b.i);
  for (const { i } of urutan) { if (sisa <= 0) break; dasar[i] += 1; sisa -= 1; }
  return dasar;
}

const angka = (v) => { const n = Number(String(v ?? "").replace(/[^\d-]/g, "")); return Number.isFinite(n) ? n : 0; };

/** Ringkasan pratinjau: subtotal, Ongkir Tambahan, Total Resi, DP 30% (dari Total Resi termasuk ongkir tambahan), sisa pelunasan. */
export function hitungRingkasan(form) {
  const harga = (form.items || []).map((it) => angka(it.nominal));
  const ongkirTambahan = Math.max(angka(form.ongkirTambahan), 0);
  const subtotal = harga.reduce((s, h) => s + h, 0);
  const totalResi = subtotal + ongkirTambahan;
  const dp = Math.round((totalResi * DP_PERSEN) / 100);
  return { subtotal, ongkirTambahan, totalResi, dpPersen: DP_PERSEN, dp, sisaSetelahDp: totalResi - dp };
}

export const itemKosong = () => ({ merk: "", ukuran: "", keluhan: "", nominal: "", unitCount: 1, catatan: "" });
export const formKosong = () => ({ alamat: "", kota: "", tautanLokasi: "", tanggalKirim: "", ongkirTambahan: "0", items: [itemKosong(), itemKosong()] });

/** Galat yang pasti ditolak server — teks Indonesia, atau null bila form layak dikirim. */
export function galatForm(form) {
  const items = form.items || [];
  if (items.length < 1) return "Resi minimal berisi 1 item";
  if (items.length > MAKS_ITEM) return "Resi maksimal berisi " + MAKS_ITEM + " item";
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (!(angka(it.nominal) > 0)) return "Item " + (i + 1) + ": nominal harus lebih dari 0";
    const u = Number(it.unitCount);
    if (!Number.isInteger(u) || u < 1 || u > 10) return "Item " + (i + 1) + ": jumlah unit harus 1 sampai 10";
  }
  if (String(form.ongkirTambahan ?? "").trim() !== "" && !(Number.isInteger(Number(form.ongkirTambahan)) && Number(form.ongkirTambahan) >= 0)) return "Ongkir Tambahan harus bilangan bulat 0 atau lebih";
  return null;
}

export function payloadResi(customerId, form) {
  return {
    customerId,
    alamat: form.alamat || undefined, kota: form.kota || undefined, tautanLokasi: form.tautanLokasi || undefined, tanggalKirim: form.tanggalKirim || undefined,
    ongkirTambahan: String(form.ongkirTambahan ?? "").trim() === "" ? 0 : Number(form.ongkirTambahan),
    items: form.items.map((it) => ({ merk: it.merk, ukuran: it.ukuran, keluhan: it.keluhan, catatan: it.catatan, nominal: angka(it.nominal), unitCount: Number(it.unitCount) || 1 })),
  };
}
