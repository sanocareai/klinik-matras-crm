// Logika murni panel aksi dokumen (diuji tanpa DOM).
/** Galat isian panel (murni, diuji): wajib/panjang/format tanggal. "" = lolos. */
export function galatPanel(panel, nilai) {
  for (const b of panel?.bidang ?? []) {
    const v = String(nilai?.[b.nama] ?? "").trim();
    if (b.wajib && v === "") return `${b.label} wajib diisi`;
    if (v !== "" && b.min && v.length < b.min) return `${b.label} minimal ${b.min} karakter`;
    if (v !== "" && b.maks && v.length > b.maks) return `${b.label} maksimal ${b.maks} karakter`;
    if (v !== "" && b.tipe === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${b.label} tidak valid`;
  }
  return "";
}
