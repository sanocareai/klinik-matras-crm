// ADOPSI ADMIN — RENCANA bahan per unit (fungsi MURNI). Rencana = niat; BUKAN pemakaian dan TIDAK mengurangi stok. Pemakaian aktual hanya lewat transaksi resmi (POST /units/:id/materials atau Material Issue Gudang).
import { KELOMPOK_BELUM, LABEL_BELUM, KELOMPOK, URUTAN_KELOMPOK } from "../../constants/kelompokBahan.js";

export const MAX_BARIS_RENCANA = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class RencanaBahanError extends Error {
  constructor(message, code = "RENCANA_BAHAN_TIDAK_VALID", statusCode = 400, extra = null) { super(message); this.name = "RencanaBahanError"; this.code = code; this.statusCode = statusCode; if (extra) this.extra = extra; }
}
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;

/** Normalisasi baris rencana: [{ materialId, qty }] → tanpa duplikat, qty > 0 (4 desimal). Bahan harus ada & aktif di `materialsById` (Map id → {id,kode,nama,satuan,aktif}). */
export function normalisasiBarisRencana(lines, materialsById) {
  if (!Array.isArray(lines)) throw new RencanaBahanError("Daftar bahan rencana harus berupa daftar");
  if (lines.length > MAX_BARIS_RENCANA) throw new RencanaBahanError(`Maksimal ${MAX_BARIS_RENCANA} bahan per rencana`);
  const seen = new Set();
  return lines.map((l, i) => {
    const id = l?.materialId;
    if (typeof id !== "string" || !UUID_RE.test(id)) throw new RencanaBahanError(`Baris ${i + 1}: bahan tidak valid`);
    if (seen.has(id)) throw new RencanaBahanError(`Baris ${i + 1}: bahan yang sama dipilih dua kali`, "RENCANA_BAHAN_DUPLIKAT");
    seen.add(id);
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new RencanaBahanError(`Baris ${i + 1}: jumlah rencana harus lebih dari 0`);
    if (qty > 1_000_000) throw new RencanaBahanError(`Baris ${i + 1}: jumlah rencana terlalu besar`);
    const m = materialsById?.get(id);
    if (!m) throw new RencanaBahanError(`Baris ${i + 1}: bahan tidak ditemukan`, "RENCANA_BAHAN_TIDAK_ADA", 404);
    if (m.aktif === false) throw new RencanaBahanError(`Baris ${i + 1}: bahan ${m.kode ?? ""} sudah nonaktif`, "RENCANA_BAHAN_NONAKTIF");
    return { materialId: id, qty: r4(qty) };
  });
}

/** Selisih dua rencana (untuk riwayat): TAMBAH / UBAH / HAPUS per bahan. */
export function selisihRencana(sebelum = [], sesudah = [], materialsById = new Map()) {
  const a = new Map((sebelum || []).map((l) => [l.materialId, Number(l.qty)]));
  const b = new Map((sesudah || []).map((l) => [l.materialId, Number(l.qty)]));
  const info = (id) => { const m = materialsById.get(id); return { materialId: id, kode: m?.kode ?? null, nama: m?.nama ?? null, satuan: m?.satuan ?? null }; };
  const out = [];
  for (const [id, q] of b) {
    if (!a.has(id)) out.push({ ...info(id), aksi: "TAMBAH", sebelum: null, sesudah: q });
    else if (r4(a.get(id)) !== r4(q)) out.push({ ...info(id), aksi: "UBAH", sebelum: a.get(id), sesudah: q });
  }
  for (const [id, q] of a) if (!b.has(id)) out.push({ ...info(id), aksi: "HAPUS", sebelum: q, sesudah: null });
  return out;
}

export const sameLines = (x = [], y = []) => selisihRencana(x, y).length === 0 && x.length === y.length;

/** Ringkasan per kelompok untuk rencana (urutan kelompok Gudang). */
export function ringkasPerKelompok(barisDenganKelompok) {
  const m = new Map(URUTAN_KELOMPOK.map((k) => [k, { kode: k, label: k === KELOMPOK_BELUM ? LABEL_BELUM : KELOMPOK[k], jumlahBahan: 0 }]));
  for (const b of barisDenganKelompok) { const o = m.get(b.kelompok?.kode ?? KELOMPOK_BELUM) ?? m.get(KELOMPOK_BELUM); o.jumlahBahan += 1; }
  return [...m.values()].filter((o) => o.jumlahBahan > 0);
}
