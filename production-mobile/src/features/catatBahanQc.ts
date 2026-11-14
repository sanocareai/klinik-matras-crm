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

// ── KERANJANG (gaya kasir, cermin web CatatBahanBaru.jsx + bahanModel.js) ──────────────────────────────────────────────────
// Beberapa bahan dipilih dulu ke keranjang, masing-masing dengan jumlah; saat dikonfirmasi tiap bahan dikirim sebagai SATU
// pencatatan (POST /units/:id/materials, Idempotency-Key sendiri) — sama dengan web. Harga = Harga Berlaku Gudang dari katalog
// (server hanya mengirimnya ke peran pencatat bahan / Finance); subtotal di sini PRATINJAU, angka resmi dibekukan server.

/** Harga dari katalog: null = peran tanpa izin lihat harga · { harga: null } = belum ada Harga Berlaku · { harga: n } = ada. */
export type HargaBahan = { harga: number | null } | null | undefined;
export type BahanKeranjang = BahanDipilih & { tersedia: number | null; saldoDiketahui: boolean; keadaan?: string | null; harga?: HargaBahan };
export type BarisKeranjang = { bahan: BahanKeranjang; qty: string; satuan: string | null };
/** Isian yang berlaku untuk SEMUA bahan di keranjang (catatan; unit terkirim: alasan + tanggal pemakaian). */
export type Bersama = { catatan: string; alasan: string; tanggal: string };

export const isianDari = (b: BarisKeranjang, s: Bersama): Isian => ({ bahan: b.bahan, qty: b.qty, satuan: b.satuan, catatan: s.catatan, alasan: s.alasan, tanggal: s.tanggal });

/** Tambah ke keranjang (bahan yang sudah ada tidak digandakan). Bahan beraturan satuan pakai mulai dari satuan PAKAI (mis. meter). */
export const tambahKeranjang = (list: BarisKeranjang[], bahan: BahanKeranjang): BarisKeranjang[] =>
  list.some((b) => b.bahan.materialId === bahan.materialId) ? list : [...list, { bahan, qty: "", satuan: bahan.satuanPakai?.satuanPakai ?? null }];
export const hapusKeranjang = (list: BarisKeranjang[], materialId: string) => list.filter((b) => b.bahan.materialId !== materialId);
export const ubahKeranjang = (list: BarisKeranjang[], materialId: string, p: Partial<Pick<BarisKeranjang, "qty" | "satuan">>) =>
  list.map((b) => (b.bahan.materialId === materialId ? { ...b, ...p } : b));

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const bulat2 = (v: number) => Math.round(v * 100) / 100;
/** Angka gaya Indonesia tanpa bergantung Intl (Hermes): ribuan titik, desimal koma, maksimal `desimal` angka di belakang koma. */
export function angka(n: number, desimal = 4): string {
  const f = Math.pow(10, desimal);
  const [bulat, pecah] = String(Math.round(Math.abs(n) * f) / f).split(".");
  return `${n < 0 ? "-" : ""}${bulat!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${pecah ? `,${pecah}` : ""}`;
}
export const rupiah = (n: number | null | undefined) => (n == null || Number.isNaN(Number(n)) ? "—" : `Rp${angka(Number(n), 2)}`);

/** Tombol − / + di keranjang: geser jumlah 1 satuan; tidak pernah di bawah 0 (0 → kosong, supaya tidak terkirim nol). */
export function geserJumlah(qty: string, d: number): string {
  const v = Math.max(0, r4((parseJumlah(qty) ?? 0) + d));
  return v > 0 ? String(v).replace(".", ",") : "";
}

const pakaiSatuanPakai = (b: BarisKeranjang) => !!b.bahan.satuanPakai && (b.satuan ?? b.bahan.satuanPakai.satuanPakai) === b.bahan.satuanPakai.satuanPakai;
/** Jumlah yang diketik → jumlah dalam satuan STOK (mis. 45 meter ÷ 90 = 0,5 roll). null bila belum valid. */
export function qtyStok(b: BarisKeranjang): number | null {
  const v = parseJumlah(b.qty);
  if (v === null) return null;
  return pakaiSatuanPakai(b) ? r4(v / Number(b.bahan.satuanPakai!.faktor)) : v;
}

/** HPP satu baris: "tersembunyi" (peran tanpa izin) | "tanpa_harga" (belum ada Harga Berlaku — TIDAK ditebak, tidak masuk total) | "ada". */
export function hppBaris(b: BarisKeranjang): { status: "tersembunyi" | "tanpa_harga" | "ada"; harga: number | null; subtotal: number | null } {
  const h = b.bahan.harga;
  if (h === null || h === undefined) return { status: "tersembunyi", harga: null, subtotal: null };
  if (h.harga == null) return { status: "tanpa_harga", harga: null, subtotal: null };
  const v = qtyStok(b);
  return { status: "ada", harga: h.harga, subtotal: v !== null && v > 0 ? bulat2(v * h.harga) : null };
}
/** Total keranjang: hanya baris berharga & berjumlah; baris tanpa harga dihitung terpisah (bukan Rp0). */
export function ringkasHpp(list: BarisKeranjang[]) {
  const per = list.map(hppBaris);
  if (!per.length || per.every((x) => x.status === "tersembunyi")) return { tampil: false, total: 0, nTanpaHarga: 0, nBelumJumlah: 0 };
  return {
    tampil: true,
    total: bulat2(per.reduce((a, x) => a + (x.subtotal ?? 0), 0)),
    nTanpaHarga: per.filter((x) => x.status === "tanpa_harga").length,
    nBelumJumlah: per.filter((x) => x.status === "ada" && x.subtotal === null).length,
  };
}

/** Teks ketersediaan di katalog (sama dengan web): "Belum diketahui" berarti belum ada catatan stok — bukan nol. */
export function teksStok(b: Pick<BahanKeranjang, "tersedia" | "saldoDiketahui" | "keadaan" | "satuan">): { teks: string; nada: "green" | "orange" | "red" | "gray" } {
  if (!b.saldoDiketahui || b.tersedia == null) return { teks: "Stok belum diketahui", nada: "gray" };
  if (b.keadaan === "MINUS") return { teks: "Catatan stok minus", nada: "red" };
  if (b.keadaan === "NOL_TERHITUNG" || Number(b.tersedia) <= 0) return { teks: "Habis menurut catatan", nada: "red" };
  if (b.keadaan === "TERPESAN_PENUH") return { teks: "Seluruhnya sudah dipesan", nada: "orange" };
  return { teks: `Tersedia ${angka(Number(b.tersedia))} ${String(b.satuan ?? "").toLowerCase()}`.trim(), nada: b.keadaan === "MENIPIS" ? "orange" : "green" };
}

/**
 * Saldo untuk SATU baris pada unit yang BELUM terkirim (cermin keadaanSaldo web). Server menjalankan pemeriksaan stok yang sama
 * sebelum menerima pencatatan/pengajuan, jadi baris yang pasti ditolak ditandai di sini — bukan dibiarkan gagal saat dikirim.
 * Unit TERKIRIM tidak memakai ini: dampaknya diputuskan pratinjau server.
 */
export function keadaanSaldo(b: BarisKeranjang): { blok: boolean; teks: string | null } {
  if (!b.bahan.saldoDiketahui || b.bahan.tersedia == null) return { blok: true, teks: "Stok bahan ini belum tercatat di Gudang, jadi server akan menolak. Minta Gudang mencatat stok awal, atau catat sebagai pemakaian sementara lewat SANSS Web." };
  const v = qtyStok(b); const tersedia = Number(b.bahan.tersedia); const sat = String(b.bahan.satuan ?? "").toLowerCase();
  if (v !== null && v > tersedia + 0.00005) return { blok: true, teks: `Saldo Gudang ${angka(tersedia)} ${sat}, kurang ${angka(r4(v - tersedia))}. Kurangi jumlah atau minta Gudang menambah stok.` };
  return { blok: false, teks: v !== null && v > 0 ? `Sisa setelah dicatat: ${angka(r4(tersedia - v))} ${sat}` : null };
}

/** Boleh dikirim (unit belum terkirim): ada baris, semua jumlah > 0, tidak ada yang pasti ditolak karena stok. */
export function bolehKirimKeranjang(list: BarisKeranjang[], s: Bersama, statusUnit: string): { ok: true } | { ok: false; galat: string } {
  if (!list.length) return { ok: false, galat: "Pilih bahan dulu dari katalog." };
  for (const b of list) {
    const v = validasi(isianDari(b, s), statusUnit);
    if (!v.ok) return { ok: false, galat: list.length > 1 && /jumlah/i.test(v.galat) ? `${b.bahan.nama}: ${v.galat}` : v.galat };
    if (!perluPembetulan(statusUnit) && keadaanSaldo(b).blok) return { ok: false, galat: `${b.bahan.nama}: stok tidak cukup atau belum diketahui.` };
  }
  return { ok: true };
}
