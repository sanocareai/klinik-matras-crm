// MODEL MURNI pencatatan bahan oleh tim QC & Dokumentasi (diuji tanpa React).
// Cermin web: CatatBahanBaru.jsx (unit belum terkirim) dan PembetulanUnitSelesai.jsx cara "TAMBAH" (unit TERKIRIM).
// Server yang menegakkan semuanya (satuan pakai, saldo, ganda, izin, pengajuan); di sini hanya validasi ramah sebelum mengirim.

export type AturanSatuan = { satuanStok: string; satuanPakai: string; faktor: number } | null;
export type BahanDipilih = { materialId: string; nama: string; kode: string; satuan: string | null; satuanPakai: AturanSatuan };
export type Isian = { bahan: BahanDipilih | null; qty: string; satuan: string | null; catatan: string; alasan: string; tanggal: string };

/** Unit terkirim (DELIVERED) wajib lewat jalur pembetulan: alasan + tanggal dilaporkan + pratinjau dampak. */
export const perluPembetulan = (statusUnit: string | null | undefined) => statusUnit === "DELIVERED";

/** "1,5" / "1.5" → 1.5 (dibulatkan 4 desimal, ketelitian stok). Bukan angka / kosong → null. */
export function parseJumlah(s: string): number | null {
  const t = String(s ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 10000) / 10000;
}

const WIB_HARI = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
export const hariIniWib = (d = new Date()) => WIB_HARI(d);
export const kemarinWib = (d = new Date()) => WIB_HARI(new Date(d.getTime() - 86400_000));

/** Satuan yang dikirim: hanya untuk bahan beraturan satuan pakai (mis. LIST WIBING ROLL ↔ METER); server mengonversi ke satuan stok. */
export const satuanKirim = (i: Pick<Isian, "bahan" | "satuan">) => (i.bahan?.satuanPakai ? i.satuan ?? i.bahan.satuanPakai.satuanPakai : null);

export function validasi(i: Isian, statusUnit: string, sekarang = new Date()): { ok: true; qty: number } | { ok: false; galat: string } {
  if (!i.bahan) return { ok: false, galat: "Pilih bahan lebih dulu." };
  const q = parseJumlah(i.qty);
  if (q === null || q <= 0) return { ok: false, galat: "Isi jumlah lebih dari 0 (boleh pakai koma, mis. 1,5)." };
  if (perluPembetulan(statusUnit)) {
    const a = i.alasan.trim();
    if (a.length < 5) return { ok: false, galat: "Unit ini sudah terkirim: alasan wajib diisi (minimal 5 karakter)." };
    if (a.length > 500) return { ok: false, galat: "Alasan maksimal 500 karakter." };
    const t = i.tanggal.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(new Date(`${t}T00:00:00Z`).getTime()) || new Date(`${t}T00:00:00Z`).toISOString().slice(0, 10) !== t) return { ok: false, galat: "Isi tanggal pemakaian (format TTTT-BB-HH)." };
    if (t > WIB_HARI(sekarang)) return { ok: false, galat: "Tanggal pemakaian tidak boleh di masa depan." };
  }
  if (i.catatan.length > 500) return { ok: false, galat: "Catatan maksimal 500 karakter." };
  return { ok: true, qty: q };
}

/** Sidik isian: pratinjau hanya berlaku untuk isian yang SAMA; kunci idempotensi baru tiap niat berbeda. */
export const sidik = (i: Isian) => JSON.stringify([i.bahan?.materialId ?? null, parseJumlah(i.qty), satuanKirim(i), i.catatan.trim(), i.alasan.trim(), i.tanggal.trim()]);

/** POST /units/:id/materials — unit BELUM terkirim (CatatBahanBaru web). */
export function tubuhBiasa(i: Isian, qty: number) {
  const s = satuanKirim(i);
  return { materialId: i.bahan!.materialId, qty, ...(i.catatan.trim() ? { note: i.catatan.trim() } : {}), ...(s ? { satuan: s } : {}) };
}

/** POST /production/units/:id/pembetulan-bahan/pratinjau — cara TAMBAH (baca-saja). */
export function tubuhPratinjau(i: Isian, qty: number) {
  const s = satuanKirim(i);
  return { jenis: "TAMBAH", tanggalPemakaian: i.tanggal.trim(), materialId: i.bahan!.materialId, qty, ...(s ? { satuan: s } : {}) };
}

/** POST /units/:id/materials — pembetulan unit TERKIRIM (tubuhPembetulan web, cara TAMBAH). */
export function tubuhPembetulan(i: Isian, qty: number, pra: { stok?: { saldoDilihat?: unknown } | null; hppOperasional?: { sidik?: unknown } | null }, sudahPeriksa: boolean) {
  const s = satuanKirim(i);
  return {
    materialId: i.bahan!.materialId, qty, alasanPembetulan: i.alasan.trim(), tanggalPemakaian: i.tanggal.trim(),
    saldoDilihat: pra?.stok?.saldoDilihat, hppSidik: pra?.hppOperasional?.sidik,
    ...(sudahPeriksa ? { konfirmasiBukanGanda: true } : {}), ...(s ? { satuan: s } : {}),
  };
}

/** Boleh menekan "Catat" untuk unit terkirim: pratinjau ada & boleh, isian belum berubah, dan kemungkinan ganda sudah diperiksa. */
export function bolehKonfirmasi(pra: { boleh: boolean; sudahTercatat?: { perluKonfirmasi: boolean } } | null, sidikSekarang: string, sidikPra: string | null, sudahPeriksa: boolean) {
  return !!pra && pra.boleh === true && sidikSekarang === sidikPra && (!pra.sudahTercatat?.perluKonfirmasi || sudahPeriksa);
}
