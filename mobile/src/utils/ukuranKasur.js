// UKURAN KASUR CUSTOM — SALINAN mobile (formatter + validasi). Sumber utama: backend/src/lib/ukuranKasur.js; salinan web: frontend/src/utils/ukuranKasur.js.
//
// PENYIMPANAN (tanpa perubahan skema, mengikuti arsitektur yang sudah ada): ukuran kasur hidup di JSON Order.notes
//   { ukuranKasur: "Ukuran Custom" | "160x200 cm (Queen)" | ..., ukuranLebarCm: 145, ukuranPanjangCm: 205, ... }
// `ukuranKasur` tetap label dropdown (kunci katalog harga tidak berubah). Jenis CUSTOM = ukuranKasur "Ukuran Custom"; angkanya di
// ukuranLebarCm/ukuranPanjangCm (hanya ada bila custom). Unit.ukuran (salinan untuk Produksi/Delivery) memakai teks terformat untuk unit BARU.
//
// ⚠️ TIGA SALINAN (backend, web, mobile). Tes paritas backend/tests/ukuranKasur.test.js menjaga keluaran identik — ubah SEMUANYA bersama.
//
// DATA LAMA TIDAK DITEBAK: record "Ukuran Custom" tanpa angka tampil "Ukuran Custom (ukuran belum diisi)"; tidak ada migrasi otomatis.

export const UKURAN_CUSTOM_LABEL = "Ukuran Custom";
export const UKURAN_CUSTOM_MIN_CM = 30;
export const UKURAN_CUSTOM_MAX_CM = 400;
export const UKURAN_CUSTOM_BELUM_DIISI = "Ukuran Custom (ukuran belum diisi)";

export function isUkuranCustom(label) {
  return typeof label === "string" && label.trim().toLowerCase() === UKURAN_CUSTOM_LABEL.toLowerCase();
}

/** Angka cm dari number atau teks ("145", "145,5", "145.5"). Positif, maksimal 1 desimal. Null bila kosong/tidak valid. */
export function parseAngkaCm(nilai) {
  if (typeof nilai === "number") return Number.isFinite(nilai) && nilai > 0 && Math.abs(nilai * 10 - Math.round(nilai * 10)) < 1e-9 ? Math.round(nilai * 10) / 10 : null;
  if (typeof nilai !== "string") return null;
  const t = nilai.trim().replace(",", ".");
  if (!/^\d+(\.\d)?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

const KOSONG = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * Validasi Lebar & Panjang custom. Mengembalikan { ok, lebarCm, panjangCm, galat: { lebar, panjang } } — pesan Bahasa Indonesia.
 * Kedua nilai WAJIB; positif; maksimal 1 desimal; antara MIN dan MAX cm.
 */
export function validasiUkuranCustom({ lebar, panjang }) {
  const galat = {};
  const nilai = {};
  for (const [kunci, label, mentah] of [["lebar", "Lebar", lebar], ["panjang", "Panjang", panjang]]) {
    if (KOSONG(mentah)) { galat[kunci] = `${label} (cm) wajib diisi.`; continue; }
    const n = parseAngkaCm(mentah);
    if (n === null) { galat[kunci] = `${label} harus berupa angka positif (maksimal satu angka di belakang koma).`; continue; }
    if (n < UKURAN_CUSTOM_MIN_CM || n > UKURAN_CUSTOM_MAX_CM) { galat[kunci] = `${label} harus antara ${UKURAN_CUSTOM_MIN_CM} dan ${UKURAN_CUSTOM_MAX_CM} cm.`; continue; }
    nilai[kunci] = n;
  }
  const ok = Object.keys(galat).length === 0;
  return { ok, lebarCm: ok ? nilai.lebar : null, panjangCm: ok ? nilai.panjang : null, galat };
}

const fmtAngka = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
const UKURAN_STANDAR = /^(\d{2,3}(?:[.,]\d)?)\s*[x×X]\s*(\d{2,3}(?:[.,]\d)?)\s*(?:cm)?\s*(?:\([^)]*\))?$/;

/** Teks ukuran dari SATU string label (mis. Unit.ukuran atau ukuranKasur di notes lama). Tidak menebak angka custom. */
export function formatUkuranLabel(teks) {
  if (typeof teks !== "string") return "";
  const t = teks.trim();
  if (!t) return "";
  if (isUkuranCustom(t)) return UKURAN_CUSTOM_BELUM_DIISI;
  if (/\(custom\)\s*$/i.test(t)) return t;
  const m = t.match(UKURAN_STANDAR);
  if (m) {
    const a = parseAngkaCm(m[1]); const b = parseAngkaCm(m[2]);
    if (a !== null && b !== null) return `${fmtAngka(a)} × ${fmtAngka(b)} cm`;
  }
  return t;
}

/**
 * Formatter bersama. Standar: "160 × 200 cm". Custom: "145 × 205 cm (Custom)". Custom lama tanpa angka: "Ukuran Custom (ukuran belum diisi)".
 * Ukuran kosong → "" (pemanggil memilih penanda "-"/"—").
 */
export function formatUkuranKasur(info) {
  const label = typeof info?.ukuranKasur === "string" ? info.ukuranKasur.trim() : "";
  if (!label) return "";
  if (isUkuranCustom(label)) {
    const w = parseAngkaCm(info?.ukuranLebarCm);
    const p = parseAngkaCm(info?.ukuranPanjangCm);
    return w !== null && p !== null ? `${fmtAngka(w)} × ${fmtAngka(p)} cm (Custom)` : UKURAN_CUSTOM_BELUM_DIISI;
  }
  return formatUkuranLabel(label);
}

/** Baca ukuran dari string Order.notes tanpa pernah melempar. */
export function ukuranDariNotes(notes) {
  if (!notes || typeof notes !== "string") return { ukuranKasur: "", ukuranLebarCm: null, ukuranPanjangCm: null };
  try {
    const p = JSON.parse(notes);
    if (!p || typeof p !== "object" || Array.isArray(p)) return { ukuranKasur: "", ukuranLebarCm: null, ukuranPanjangCm: null };
    return { ukuranKasur: typeof p.ukuranKasur === "string" ? p.ukuranKasur : "", ukuranLebarCm: parseAngkaCm(p.ukuranLebarCm), ukuranPanjangCm: parseAngkaCm(p.ukuranPanjangCm) };
  } catch {
    return { ukuranKasur: "", ukuranLebarCm: null, ukuranPanjangCm: null };
  }
}

/** Teks siap tampil dari string Order.notes ("" bila tidak ada ukuran). */
export function teksUkuranDariNotes(notes) {
  return formatUkuranKasur(ukuranDariNotes(notes));
}
