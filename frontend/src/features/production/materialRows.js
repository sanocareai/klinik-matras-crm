// Model MURNI baris bahan (BOM rencana & pemakaian PIC Bahan) — pola "+ Tambah baris" seperti PO Finance:
//   - setelah baris terakhir TERISI (bahan + jumlah), satu baris kosong baru otomatis tersedia;
//   - baris kosong TIDAK ikut terkirim; baris setengah terisi ditolak dengan pesan per baris (tidak dibuang diam-diam);
//   - satu daftar utuh: satu bahan hanya sekali, jumlah > 0, dan (mode pemakaian) tidak melebihi yang diserahkan Gudang.
// Tidak menyentuh stok: hanya bentuk isian dan validasi sebelum dikirim ke command resmi (server tetap menegakkan ulang).
let seq = 0;
const nextKey = () => { seq += 1; return `mr-${seq}`; };

export const blankRow = () => ({ key: nextKey(), materialId: "", qty: "" });
const qtyText = (r) => String(r?.qty ?? "").trim();
export const isBlankRow = (r) => !r?.materialId && qtyText(r) === "";
export const isFilledRow = (r) => !!r?.materialId && qtyText(r) !== "";

// Pastikan setiap baris punya key stabil (baris dari server tidak punya).
export const withKeys = (rows) => (rows || []).map((r) => (r.key ? r : { ...r, key: nextKey() }));

// Tepat SATU baris kosong di akhir bila baris terakhir sudah terisi (atau daftar kosong); baris setengah terisi tidak disusul baris kosong dulu.
export function withTrailingBlank(rows) {
  const list = withKeys(rows);
  let end = list.length;
  while (end > 0 && isBlankRow(list[end - 1])) end -= 1;
  const core = list.slice(0, end);
  const last = core[core.length - 1];
  if (!last || isFilledRow(last)) return [...core, list[end] && isBlankRow(list[end]) ? list[end] : blankRow()];
  return core;
}

export const fromRecord = (lines) => withTrailingBlank((lines || []).map((l) => ({ materialId: l.materialId, qty: l.qty == null ? "" : String(l.qty) })));

// Hanya baris TERISI yang dikirim. Pemanggil harus memanggil validateMaterialRows lebih dulu.
export const rowsPayload = (rows) => (rows || []).filter(isFilledRow).map((r) => ({ materialId: r.materialId, qty: Number(String(r.qty).replace(",", ".")) }));

/**
 * Validasi daftar baris. options: Map|object materialId -> { label, available? } — available (mode pemakaian) = jumlah maksimum yang boleh dicatat untuk bahan itu.
 * Mengembalikan { error, rowErrors }: error = ringkasan pertama untuk banner; rowErrors = { [key]: pesan } untuk ditampilkan di bawah barisnya.
 */
export function validateMaterialRows(rows, { requireOne = true, availableOf = null, labelOf = null } = {}) {
  const rowErrors = {};
  const seen = new Map();
  let n = 0; let filled = 0;
  const list = rows || [];
  list.forEach((r, i) => {
    if (isBlankRow(r)) return;
    n += 1;
    const no = i + 1;
    if (!r.materialId) { rowErrors[r.key] = `Baris ${no}: pilih bahan.`; return; }
    const q = Number(qtyText(r).replace(",", "."));
    if (qtyText(r) === "" || !Number.isFinite(q) || q <= 0) { rowErrors[r.key] = `Baris ${no}: isi jumlah lebih dari nol.`; return; }
    if (seen.has(r.materialId)) { rowErrors[r.key] = `Baris ${no}: bahan ini sudah ada di baris ${seen.get(r.materialId)} — gabungkan jadi satu baris.`; return; }
    seen.set(r.materialId, no);
    if (availableOf) {
      const max = availableOf(r.materialId);
      if (max == null) { rowErrors[r.key] = `Baris ${no}: ${labelOf?.(r.materialId) || "bahan ini"} bukan bahan yang diserahkan Gudang untuk pekerjaan ini.`; return; }
      if (q > max + 1e-9) { rowErrors[r.key] = `Baris ${no}: melebihi yang diserahkan Gudang (maksimal ${max}).`; return; }
    }
    filled += 1;
  });
  if (requireOne && filled === 0 && Object.keys(rowErrors).length === 0) return { error: "Isi minimal satu bahan beserta jumlahnya.", rowErrors };
  const first = Object.values(rowErrors)[0] || null;
  return { error: first, rowErrors, filled, rowsUsed: n };
}

// Ringkasan "validasi total" yang tampil di bawah daftar: jumlah bahan terisi + total jumlah per satuan (tanpa menjumlahkan satuan berbeda).
export function totalsOf(rows, unitOf) {
  const byUnit = new Map(); let count = 0;
  for (const r of rows || []) {
    if (!isFilledRow(r)) continue;
    const q = Number(qtyText(r).replace(",", "."));
    if (!Number.isFinite(q) || q <= 0) continue;
    count += 1;
    const u = unitOf?.(r.materialId) || "";
    byUnit.set(u, (byUnit.get(u) || 0) + q);
  }
  return { count, byUnit: [...byUnit.entries()].map(([unit, qty]) => ({ unit, qty: Math.round(qty * 10000) / 10000 })) };
}

// Isian sama persis dengan yang tersimpan? (tombol Simpan dimatikan bila tidak ada perubahan.)
export function sameAsSaved(rows, saved) {
  const a = rowsPayload(rows).map((l) => [l.materialId, l.qty]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  const b = (saved || []).map((l) => [l.materialId, Number(l.qty)]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  return a.length === b.length && a.every((v, i) => v[0] === b[i][0] && v[1] === b[i][1]);
}
