// Pembelian punya DUA isian pihak yang terpisah: "Supplier" (master terdaftar, dropdown) dan "Dibeli dari" (teks bebas, payeeName). Sebelumnya layar hanya menampilkan
// supplier bila ada, sehingga "Dibeli dari" yang benar tersembunyi (kasus PUR-07102026-009: tampil YULIUS, padahal dibeli dari NELI SEUBELAN - EKA TUNGGAL).
// Logika murni (tanpa React) supaya bisa dites. Padanan backend: services/finance/export/pengeluaran.js#pihakPenerima.

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Dua nama dianggap "berkaitan" bila salah satunya memuat yang lain (mis. supplier "YULIUS" dan payee "YULIUS - Toko Busa"). */
export function namaBerkaitan(a, b) {
  const x = norm(a); const y = norm(b);
  if (!x || !y) return true; // salah satu kosong → tidak ada pertentangan
  return x.includes(y) || y.includes(x);
}

/** Yang ditampilkan di daftar/panel: supplier terdaftar, dan "dibeli dari" HANYA bila berbeda dari supplier (dan dari penalang). */
export function pihakPembelian(p) {
  const supplier = p?.supplier?.name || null;
  const payee = (p?.payeeName ?? "").trim() || null;
  const penalang = p?.reimburseTo?.name || null;
  if (supplier) return { supplier, dibeliDari: payee && !namaBerkaitan(supplier, payee) ? payee : null };
  return { supplier: null, dibeliDari: payee && !(penalang && norm(payee) === norm(penalang)) ? payee : null };
}

/** Peringatan di formulir bila Supplier terpilih dan "Dibeli dari" diisi nama yang tidak berkaitan; null bila aman. */
export function peringatanSupplierBeda(suppliers, form) {
  const sup = (suppliers ?? []).find((s) => s.id === form?.supplierId);
  const payee = (form?.payeeName ?? "").trim();
  if (!sup || !payee || namaBerkaitan(sup.name, payee)) return null;
  return `Supplier terpilih "${sup.name}" berbeda dari "Dibeli dari" ("${payee}"). Pastikan dropdown Supplier benar — kosongkan bila pemasoknya belum terdaftar.`;
}
