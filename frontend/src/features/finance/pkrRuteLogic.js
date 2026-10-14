// Logika murni mode rute Produksi + status "Menunggu penentuan alur Produksi" + kesiapan fisik (tanpa import React/api — diuji `node --test`).

export const MODE_LABEL = { TRANSISI: "Transisi", KETAT: "Ketat" };
export const labelMode = (m) => MODE_LABEL[m] ?? String(m ?? "—");
export const modeBerikutnya = (m) => (m === "KETAT" ? "TRANSISI" : "KETAT");
export const alasanModeValid = (a) => String(a ?? "").trim().replace(/\s+/g, " ").length >= 5;

/** Peringatan "Menunggu penentuan alur Produksi" dari sekumpulan peringatan (objek {kode,pesan} atau teks). */
export function peringatanAlur(daftar) {
  const hasil = [];
  for (const w of daftar ?? []) {
    const kode = typeof w === "object" && w ? w.kode : null;
    const pesan = typeof w === "object" && w ? w.pesan : String(w ?? "");
    if (kode === "MENUNGGU_ALUR_PRODUKSI" || /Menunggu penentuan alur Produksi/.test(pesan)) hasil.push(pesan);
  }
  return hasil;
}

/** Status alur satu baris unit (dari read model server): { menunggu, label, tindakan }. */
export function statusAlurUnit(u) {
  const menunggu = u?.alur?.status === "MENUNGGU_ALUR";
  return { menunggu, label: menunggu ? "Menunggu penentuan alur Produksi" : null, tindakan: menunggu ? (u.alur.tindakan ?? null) : null };
}

/** Label kesiapan fisik satu baris unit; null bila tidak ada konfirmasi. */
export const labelSiapFisik = (u) => (u?.kesiapanFisik?.dikonfirmasi ? "Siap fisik (dikonfirmasi) — status Produksi belum ditandai siap" : null);

/** Validasi form konfirmasi kesiapan fisik. */
export function galatKesiapanFisik({ unitIds, alasan }) {
  if (!Array.isArray(unitIds) || unitIds.length === 0) return "Pilih minimal satu unit yang nyata sudah siap.";
  if (String(alasan ?? "").trim().replace(/\s+/g, " ").length < 5) return "Alasan wajib diisi (minimal 5 karakter).";
  return null;
}
