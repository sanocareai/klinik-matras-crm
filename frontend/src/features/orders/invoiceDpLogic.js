// Menentukan nominal DP dari isian Sales di tab Invoice: dalam PERSEN dari total tagihan atau langsung NOMINAL (Rp).
// Murni (tanpa DOM) supaya bisa dites; salinan identik untuk mobile ada di mobile/src/lib/invoiceDp.js (dijaga sama oleh tes paritas).
//
// Yang disimpan ke order SELALU nominal bulat Rupiah (Order.dpTarget Int) — persen hanya cara mengisi, tidak disimpan. Persen dibulatkan ke
// Rupiah terdekat. DP wajib > 0 dan < total tagihan (DP sama dengan total = pelunasan, bukan DP).

export const DP_PERSEN_SARAN = 30; // sama dengan DP_PERSEN Resi (features/resi/logika.js)
export const MODE_DP = Object.freeze({ PERSEN: "PERSEN", NOMINAL: "NOMINAL" });

/**
 * Angka dari isian teks. Nominal Rupiah: titik/koma = pemisah ribuan ("1.500.000"). Mode desimal (persen): titik ATAU koma = pemisah desimal
 * ("12,5" dan "12.5" sama-sama 12,5) dan maksimal SATU pemisah — "1.5" harus terbaca 1,5% (bukan 15%), "12.5.1" ditolak. null bila tidak valid.
 */
export function parseAngka(teks, { desimal = false } = {}) {
  const t = String(teks ?? "").trim();
  if (!t) return null;
  let bersih;
  if (desimal) {
    if ((t.match(/[.,]/g) || []).length > 1) return null;
    bersih = t.replace(",", ".");
  } else {
    bersih = t.replace(/[.,\s]/g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(bersih)) return null;
  const n = Number(bersih);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{mode: "PERSEN"|"NOMINAL", nilai: string|number, total: number}} p
 * @returns {{ok: true, nominal: number, persen: number} | {ok: false, galat: string}}
 */
export function hitungDpDariInput({ mode, nilai, total }) {
  const t = Number(total) || 0;
  if (!(t > 0)) return { ok: false, galat: "Total tagihan belum ada — isi harga order dulu" };
  let nominal;
  if (mode === MODE_DP.PERSEN) {
    const p = parseAngka(nilai, { desimal: true });
    if (p === null || p <= 0) return { ok: false, galat: "Persen DP harus lebih dari 0" };
    if (p >= 100) return { ok: false, galat: "Persen DP harus kurang dari 100% (100% = pelunasan)" };
    nominal = Math.round((t * p) / 100);
  } else {
    const n = parseAngka(nilai);
    if (n === null || !Number.isInteger(n) || n <= 0) return { ok: false, galat: "Nominal DP harus bilangan bulat lebih dari 0" };
    nominal = n;
  }
  if (nominal <= 0) return { ok: false, galat: "DP hasil hitungan kurang dari Rp1 — naikkan persennya" };
  if (nominal >= t) return { ok: false, galat: "DP harus lebih kecil dari total tagihan" };
  return { ok: true, nominal, persen: Math.round((nominal / t) * 10000) / 100 };
}

/** Isian awal form: nominal DP yang sudah disepakati (bila ada) atau saran persen. */
export function isianAwalDp({ total, dpTarget = null }) {
  if (dpTarget > 0) return { mode: MODE_DP.NOMINAL, nilai: String(dpTarget) };
  return { mode: MODE_DP.PERSEN, nilai: String(DP_PERSEN_SARAN) };
}

/** Ganti mode tanpa kehilangan angka: nilai yang sedang valid dikonversi ke mode baru. */
export function gantiModeDp({ dari, ke, nilai, total }) {
  if (dari === ke) return nilai;
  const r = hitungDpDariInput({ mode: dari, nilai, total });
  if (!r.ok) return ke === MODE_DP.PERSEN ? String(DP_PERSEN_SARAN) : "";
  return ke === MODE_DP.PERSEN ? String(r.persen).replace(".", ",") : String(r.nominal);
}
