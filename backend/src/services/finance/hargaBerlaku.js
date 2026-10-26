// HARGA BERLAKU BAHAN = HPP OPERASIONAL (Okt 2026). Harga per SATUAN STOK dengan waktu mulai berlaku, diedit dari layar Stok.
//
// PEMISAHAN (jangan dilanggar, jangan ditampilkan seolah sama):
//   • HPP OPERASIONAL (file ini)  = harga berlaku × pemakaian. BUKAN nilai buku, BUKAN HPP final Finance. Bukti supplier/kedatangan boleh belum ada → label "Belum didukung bukti".
//   • NILAI PERSEDIAAN/JURNAL FINANCE = biaya perolehan Persediaan Awal/GR (fin_stock_movement_valuations, nilaiResmi.js, penetapanNilai.js). Tidak disentuh di sini.
// Aturan waktu: dasar harga = WAKTU PEMAKAIAN AKTUAL (stock_movements.created_at), bukan tanggal order dibuat. Harga baru berlaku untuk pemakaian sejak waktu efektif; pemakaian yang sudah dibekukan tidak berubah.
// Dibekukan saat pemakaian diposting (catatBiayaOperasional, transaksi yang sama dengan pergerakan stok). Koreksi salah input = baris KOREKSI baru (baris lama tetap); pemakaian lama baru diberi/diselaraskan harganya lewat
// tindakan khusus berpengaju+penyetuju (penerapan), tidak pernah otomatis. Tidak menulis stok, ISSUE, catatan, valuasi Finance, jurnal, maupun GL.
// ATURAN (Okt 2026, setelah keputusan Owner):
//   1. Perubahan harga BIASA hanya berlaku "saat disimpan" atau waktu MENDATANG; tanggal mundur DITOLAK (server + CHECK DB). Koreksi salah input historis = tindakan khusus KOREKSI: alasan ≥10 karakter,
//      pratinjau SELURUH pemakaian terdampak (wajib dikonfirmasi), riwayat append-only (baris lama tidak dihapus); nilai beku lama tidak diubah diam-diam — perbaikannya lewat penerapan khusus dua orang.
//   2. RETUR: bila tertaut ISSUE asal (correctsMovementId, atau ISSUE bahan yang sama pada unit itu) memakai HARGA OPERASIONAL ISSUE ASAL, bukan harga yang sedang berlaku saat retur.
//      WASTE: harga berlaku saat waste dicatat; sumbernya ditampilkan (basis_harga).
//   3. Izin EDIT harga/koreksi/ajukan penerapan = finance:harga_berlaku:edit; setujui = finance:harga_berlaku:approve (FINANCE + OWNER saja; BUKAN semua ADMIN tanpa keputusan Owner).
import crypto from "node:crypto";
import { Decimal, toMoney } from "./money.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { KoreksiError } from "../warehouseCorrection.js";

export const JENIS_BIAYA_OP = { ISSUE: "PEMAKAIAN", RETURN: "RETUR", WASTE: "SUSUT", ADJUSTMENT: "PENYESUAIAN" };
export const TIPE_OP = Object.keys(JENIS_BIAYA_OP);
export const LABEL_BUKTI = Object.freeze({
  BELUM_DIDUKUNG_BUKTI: "Belum didukung bukti",
  ADA_CATATAN_BUKTI: "Ada catatan bukti — belum diverifikasi Finance",
});
export const PEMISAH = Object.freeze({
  operasional: "HPP operasional (harga berlaku) — angka kerja Gudang/Produksi; bukan nilai buku dan bukan HPP final Finance.",
  finance: "Nilai persediaan/jurnal Finance (biaya perolehan Persediaan Awal/GR) — sumber jurnal; tidak berubah karena harga berlaku.",
});
export const BASIS_TEKS = Object.freeze({
  WAKTU_PEMAKAIAN: "Harga berlaku saat pemakaian", WAKTU_WASTE: "Harga berlaku saat waste dicatat", WAKTU_PENYESUAIAN: "Harga berlaku saat penyesuaian",
  HARGA_ISSUE_ASAL: "Harga operasional ISSUE asal (bukan harga saat retur)", WAKTU_RETUR_TANPA_ISSUE: "Harga berlaku saat retur — tidak tertaut ISSUE asal",
  TIDAK_DIKETAHUI: "Dasar harga tidak diketahui — pembekuan harga GAGAL saat pemakaian diposting",
});
export const IZIN_TEKS = Object.freeze({
  ubah: "Yang boleh mengubah/mengoreksi harga dan mengajukan penerapan: peran Finance dan Owner (izin finance:harga_berlaku:edit).",
  setujui: "Yang boleh menyetujui penerapan (orang lain dari pengaju): peran Finance dan Owner (izin finance:harga_berlaku:approve).",
  admin: "Akun Admin tanpa peran Finance/Owner hanya dapat melihat — perluasan menunggu keputusan Owner.",
});
export const KELOMPOK_PENERAPAN = Object.freeze({ BELUM_DIBEKUKAN: "Pemakaian lama belum dibekukan harga operasionalnya", TANPA_HARGA_BERLAKU: "Dibekukan tanpa harga berlaku (saat itu belum ada harga)", SELARAS_ULANG: "Harga beku berbeda dari harga berlaku pada waktu pemakaian (mis. setelah koreksi)" });
export const GAGAL = "GAGAL_PEMBEKUAN"; // penanda kegagalan pembekuan (BEDA dari TANPA_HARGA = memang tidak ada harga berlaku saat itu)
const D = (v) => new Decimal(String(v ?? 0));
const wajib = (c, m, kode, status = 400) => { if (!c) throw new KoreksiError(m, status, kode); };
const kunciValid = (k) => { const t = String(k ?? ""); wajib(t.length >= 8 && t.length <= 120, "Idempotency-Key wajib (8–120 karakter)", "IDEMPOTENCY_KEY_REQUIRED", 428); return t; };
const wibTgl = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const labelDari = (baris) => (String(baris?.evidenceNote ?? "").trim() ? "ADA_CATATAN_BUKTI" : "BELUM_DIDUKUNG_BUKTI");
const sha = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex");
const STATUS_MI_BELUM_KELUAR = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"];

// ── baca: harga berlaku pada suatu waktu ─────────────────────────────────────────────────────────────

/** Baris harga yang MASIH BERLAKU (tidak digantikan koreksi), urut waktu efektif lalu waktu dibuat. */
async function barisAktif(db, materialId) {
  const semua = await db.materialHargaBerlaku.findMany({ where: { materialId }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  const diganti = new Set(semua.map((x) => x.correctsId).filter(Boolean));
  return { semua, aktif: semua.filter((x) => !diganti.has(x.id)), diganti };
}
const pilih = (aktif, at) => { let hasil = null; for (const x of aktif) if (new Date(x.effectiveFrom) <= at) hasil = x; return hasil; };

/** Harga yang berlaku untuk pemakaian pada waktu `at` (waktu pemakaian aktual), atau null bila belum ada harga berlaku pada waktu itu. */
export async function hargaBerlakuPada(db, materialId, at) {
  const { aktif } = await barisAktif(db, materialId);
  const r = pilih(aktif, new Date(at));
  return r ? { harga: D(r.unitPrice), baris: r, label: labelDari(r) } : null;
}

/** Fungsi penyelesai ber-cache untuk satu operasi: (materialId, at) → {harga,baris,label}|null. */
export function penyelesaiHargaBerlaku(db) {
  const c = new Map();
  return async (materialId, at) => { if (!c.has(materialId)) c.set(materialId, await barisAktif(db, materialId)); const r = pilih(c.get(materialId).aktif, new Date(at)); return r ? { harga: D(r.unitPrice), baris: r, label: labelDari(r) } : null; };
}

// ── dasar waktu harga untuk PEMBETULAN terlambat (unit terkirim) ───────────────────────────────────
// Keputusan Owner: pembetulan yang dicatat belakangan memilih Harga Berlaku menurut TANGGAL PEMAKAIAN YANG DILAPORKAN (bukan hari pencatatan). Tanggal itu hidup di catatan baku pergerakan
// ("Pembetulan unit terkirim (KODE) [dilaporkan YYYY-MM-DD]: …", ditulis server di jalur unit terkirim). Aturan batas: harga yang berlaku pada AWAL hari itu (00:00 WIB, inklusif) — harga yang baru mulai
// berlaku di tengah hari itu TIDAK dipakai (ditandai di pratinjau). Belum ada harga pada batas itu → TANPA_HARGA/belum diketahui; TIDAK PERNAH memakai harga hari pencatatan. Waktu pencatatan
// (stock_movements.created_at) dan tanggal jurnal Finance tidak berubah. Hanya ISSUE/RETURN; pergerakan lain memakai created_at seperti biasa.
const POLA_DILAPORKAN = /^Pembetulan unit terkirim \(.+?\) \[dilaporkan (\d{4}-\d{2}-\d{2})\]: /;
export const batasHargaTanggal = (tgl) => new Date(`${tgl}T00:00:00+07:00`);
/** Tanggal (YYYY-MM-DD, WIB) yang menjadi dasar harga pergerakan ini, atau null bila dasarnya waktu pergerakan biasa. */
export function tanggalDasarHarga(p) {
  if (!p || (p.type !== "ISSUE" && p.type !== "RETURN")) return null;
  const m = POLA_DILAPORKAN.exec(String(p.note ?? "")); if (!m) return null;
  const t = batasHargaTanggal(m[1]); return Number.isFinite(t.getTime()) && wibTgl(t) === m[1] ? m[1] : null;
}
/** Waktu yang dipakai MEMILIH Harga Berlaku untuk pergerakan ini (satu aturan untuk posting, penerapan, koreksi harga, dan tampilan). */
export const waktuDasarHarga = (p) => { const t = tanggalDasarHarga(p); return t ? batasHargaTanggal(t) : new Date(p.createdAt ?? Date.now()); };
const detailTanggal = (tgl, p) => ({ dasarTanggal: tgl, aturan: "HARGA_PADA_AWAL_HARI_WIB", batasHarga: batasHargaTanggal(tgl).toISOString(), dicatatPada: p.createdAt ? new Date(p.createdAt).toISOString() : null });
/** Harga berlaku yang MULAI berlaku di tengah hari (WIB) itu: tidak dipakai (batas = awal hari) tetapi ditampilkan sebagai peringatan di pratinjau. Baca-saja. */
export async function hargaBerubahPadaHari(db, materialId, tgl) {
  const { aktif } = await barisAktif(db, materialId); const a = batasHargaTanggal(tgl).getTime(); const b = a + 86_400_000;
  return aktif.filter((x) => { const t = new Date(x.effectiveFrom).getTime(); return t > a && t < b; }).map((x) => ({ harga: Number(x.unitPrice), mulai: x.effectiveFrom }));
}
/** Teks dasar harga untuk tampilan/Excel: sama di Ringkasan, Riwayat, pratinjau, dan ekspor. */
export function teksDasarHarga(basis, tgl) {
  if (tgl && basis === "WAKTU_PEMAKAIAN") return `Harga berlaku pada tanggal pemakaian yang dilaporkan (${tgl}) — bukan hari pencatatan`;
  if (tgl && basis === "WAKTU_RETUR_TANPA_ISSUE") return `Harga berlaku pada tanggal pemakaian yang dilaporkan (${tgl}) — retur tidak tertaut ISSUE asal`;
  return BASIS_TEKS[basis] ?? basis;
}

const penyelesaiDariDaftar = (aktif) => (at) => { const r = pilih(aktif, new Date(at)); return r ? { harga: D(r.unitPrice), baris: r, label: labelDari(r) } : null; };
const BASIS_TIPE = { ISSUE: "WAKTU_PEMAKAIAN", WASTE: "WAKTU_WASTE", ADJUSTMENT: "WAKTU_PENYESUAIAN", RETURN: "WAKTU_RETUR_TANPA_ISSUE" };
async function opTerakhirPer(db, ids) {
  if (!ids.length) return new Map();
  const rows = await db.stockMovementBiayaOperasional.findMany({ where: { movementId: { in: ids } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return new Map(rows.map((r) => [r.movementId, r])); // yang terakhir menang
}
/** ISSUE asal sebuah RETUR: correctsMovementId bila ada; selain itu ISSUE bahan yang sama pada unit itu sampai waktu retur. */
async function asalRetur(db, p) {
  if (p.correctsMovementId) return db.stockMovement.findMany({ where: { id: p.correctsMovementId }, select: { id: true, qty: true } });
  return db.stockMovement.findMany({ where: { unitId: p.unitId, materialId: p.materialId, type: "ISSUE", createdAt: { lte: new Date(p.createdAt) } }, select: { id: true, qty: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}
/**
 * Harga operasional untuk SATU pergerakan (satu aturan untuk posting, penerapan, dan tampilan):
 *   ISSUE → harga berlaku saat pemakaian · WASTE → saat waste dicatat · ADJUSTMENT → saat penyesuaian ·
 *   RETURN tertaut ISSUE asal → HARGA ISSUE ASAL (rata-rata tertimbang kuantitas bila beberapa ISSUE; bukan harga saat retur); ISSUE asal tanpa harga → retur tanpa harga (bukan harga baru); tanpa ISSUE asal → harga saat retur, ditandai.
 * Kembalian: { ada, harga(4 dp), priceId, priceEffectiveFrom, label, basis, detail } atau { ada:false, basis, gap, detail }.
 */
export async function hargaUntukPergerakan(db, p, sel) {
  const tglDasar = tanggalDasarHarga(p); const at = waktuDasarHarga(p); // asal retur tetap dicari menurut waktu pencatatan (p.createdAt); hanya PEMILIHAN harga mengikuti tanggal dilaporkan
  if (p.type === "RETURN") {
    const asal = await asalRetur(db, p);
    if (asal.length) {
      const peta = await opTerakhirPer(db, asal.map((x) => x.id));
      const detail = asal.map((x) => { const o = peta.get(x.id); return { movementId: x.id, qty: Math.abs(Number(x.qty)), unitCost: o?.status === "DINILAI" ? Number(o.unitCost) : null, priceId: o?.priceId ?? null, priceEffectiveFrom: o?.priceEffectiveFrom ?? null, label: o?.evidenceLabel ?? null }; });
      if (detail.some((d) => d.unitCost == null)) return { ada: false, basis: "HARGA_ISSUE_ASAL", gap: "ISSUE_ASAL_BELUM_BERHARGA", detail };
      const totalQ = detail.reduce((a, d) => a.plus(d.qty), D(0)); const rata = detail.reduce((a, d) => a.plus(D(d.qty).times(d.unitCost)), D(0)).dividedBy(totalQ.isZero() ? 1 : totalQ).toDecimalPlaces(4);
      const utama = detail.reduce((m, d) => (d.qty > m.qty ? d : m), detail[0]);
      return { ada: true, harga: rata, priceId: utama.priceId, priceEffectiveFrom: utama.priceEffectiveFrom, label: utama.label, basis: "HARGA_ISSUE_ASAL", detail, tanggalDasar: tglDasar };
    }
  }
  const h = await sel(p.materialId, at); const basis = BASIS_TIPE[p.type] ?? "WAKTU_PEMAKAIAN"; const detail = tglDasar ? detailTanggal(tglDasar, p) : null;
  if (!h) return { ada: false, basis, gap: "BELUM_ADA_HARGA_PADA_WAKTU_PEMAKAIAN", detail, tanggalDasar: tglDasar };
  return { ada: true, harga: h.harga.toDecimalPlaces(4), priceId: h.baris.id, priceEffectiveFrom: h.baris.effectiveFrom, label: h.label, basis, detail, tanggalDasar: tglDasar };
}

const tampilBaris = (x, { diganti, aktifId, sekarang }) => ({
  id: x.id, jenis: x.jenis, harga: Number(x.unitPrice), satuan: x.satuan, berlakuMulai: x.effectiveFrom, hargaLama: x.previousPrice == null ? null : Number(x.previousPrice),
  alasan: x.reason, catatan: x.note, catatanBukti: x.evidenceNote, labelBukti: labelDari(x), teksLabelBukti: LABEL_BUKTI[labelDari(x)],
  diperbaikiOleh: null, menggantikan: x.correctsId, dibuatOleh: x.createdById, dibuatPada: x.createdAt,
  status: diganti.has(x.id) ? "DIGANTI_KOREKSI" : x.id === aktifId ? "BERLAKU_SEKARANG" : new Date(x.effectiveFrom) > sekarang ? "TERJADWAL" : "BERAKHIR_DIGANTI_HARGA_BARU",
});

/** Riwayat append-only satu bahan (terbaru dulu). */
export async function riwayatHarga(db, materialId) {
  const { semua, aktif, diganti } = await barisAktif(db, materialId); const sekarang = new Date();
  const berlaku = pilih(aktif, sekarang); const pengguna = new Map((await db.user.findMany({ where: { id: { in: [...new Set(semua.map((x) => x.createdById).filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const peta = new Map(semua.map((x) => [x.correctsId, x.id]));
  return semua.slice().reverse().map((x) => ({ ...tampilBaris(x, { diganti, aktifId: berlaku?.id, sekarang }), dibuatOlehNama: pengguna.get(x.createdById) ?? null, diperbaikiOleh: peta.get(x.id) ?? null }));
}

// ── dampak: berapa order/pemakaian ───────────────────────────────────────────────────────────────────

async function hitungDampak(db, materialId, mulai) {
  const belumMemakai = (await db.$queryRawUnsafe(`select count(distinct u.id)::int unit, count(distinct u.order_id)::int ord from (
      select mi.unit_id from material_issue_lines l join material_issues mi on mi.id = l.material_issue_id where l.material_id = $1::uuid and mi.status::text = any($2::text[]) and mi.unit_id is not null
      union select n.unit_id from unit_usage_notes n where n.material_id = $1::uuid and n.state = 'SIAP_POSTING' and n.unit_id is not null) x join units u on u.id = x.unit_id`, materialId, STATUS_MI_BELUM_KELUAR))[0];
  const dipakai = (await db.$queryRawUnsafe(`with m as (select s.id, s.unit_id, s.created_at, s.qty, (select o.status from stock_movement_biaya_operasional o where o.movement_id = s.id order by o.created_at desc, o.id desc limit 1) st,
        (select o.value from stock_movement_biaya_operasional o where o.movement_id = s.id order by o.created_at desc, o.id desc limit 1) val
      from stock_movements s where s.material_id = $1::uuid and s.unit_id is not null and s.type::text = any($2::text[]))
    select count(*) filter (where created_at >= $3 and st = 'DINILAI')::int beku_sejak, coalesce(sum(val) filter (where created_at >= $3 and st = 'DINILAI'),0)::float nilai_beku_sejak,
           count(*) filter (where created_at >= $3 and st = 'TANPA_HARGA')::int beku_tanpa_harga_sejak, count(*) filter (where st is null or st = 'GAGAL_PEMBEKUAN')::int belum_dibekukan, count(*) filter (where (st is null or st = 'GAGAL_PEMBEKUAN') and created_at >= $3)::int belum_dibekukan_sejak,
           count(*) filter (where st = 'GAGAL_PEMBEKUAN')::int gagal_pembekuan, count(distinct unit_id) filter (where st is null or st = 'TANPA_HARGA' or st = 'GAGAL_PEMBEKUAN')::int unit_tanpa_harga_op from m`, materialId, TIPE_OP, mulai))[0];
  return { akanMemakai: { unit: belumMemakai.unit, order: belumMemakai.ord, ket: "Order yang belum memakai bahan ini (Material Issue belum keluar / catatan siap posting): akan dibekukan dengan harga yang berlaku pada waktu pemakaian aktual." },
    sudahDibekukanSejakMulai: { pemakaian: dipakai.beku_sejak, nilai: dipakai.nilai_beku_sejak, ket: "Pemakaian sejak waktu berlaku yang SUDAH dibekukan — TIDAK berubah karena harga baru." },
    sudahDibekukanTanpaHargaSejakMulai: dipakai.beku_tanpa_harga_sejak, gagalPembekuan: { pemakaian: dipakai.gagal_pembekuan, ket: "Pembekuan harga GAGAL saat pemakaian diposting (tercatat persisten) — termasuk ‘belum dibekukan’; perbaiki lewat penerapan khusus." },
    belumDibekukan: { pemakaian: dipakai.belum_dibekukan, sejakMulai: dipakai.belum_dibekukan_sejak, unit: dipakai.unit_tanpa_harga_op, ket: "Pemakaian lama yang belum punya harga operasional: hanya diberi harga lewat tindakan khusus berpersetujuan, tidak otomatis." } };
}

// ── ringkasan satu bahan (layar Stok) ────────────────────────────────────────────────────────────────

export async function ringkasanBahan(db, materialId) {
  const bahan = await db.material.findUnique({ where: { id: materialId }, select: { id: true, code: true, name: true, unit: true, referenceUnitCost: true, referenceUnitCostMonth: true } }); wajib(bahan, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const { aktif, semua, diganti } = await barisAktif(db, materialId); const sekarang = new Date(); const berlaku = pilih(aktif, sekarang); const terjadwal = aktif.filter((x) => new Date(x.effectiveFrom) > sekarang);
  const dampak = await hitungDampak(db, materialId, berlaku ? new Date(berlaku.effectiveFrom) : new Date(0));
  const rcpt = (await db.$queryRawUnsafe(`select unit_cost, created_at from stock_movements where material_id = $1::uuid and type = 'RECEIPT' and unit_cost > 0 and qty > 0 order by created_at desc limit 1`, materialId))[0];
  const aktifApp = await db.biayaOperasionalPenerapan.findFirst({ where: { materialId, status: "DIAJUKAN" }, select: { id: true, previewCount: true, requestedAt: true } });
  return {
    bahan: { id: bahan.id, kode: bahan.code, nama: bahan.name, satuan: bahan.unit },
    hargaBerlaku: berlaku ? { ...tampilBaris(berlaku, { diganti, aktifId: berlaku.id, sekarang }) } : null,
    terjadwal: terjadwal.map((x) => tampilBaris(x, { diganti, aktifId: null, sekarang })),
    labelHarga: "HPP operasional per satuan stok — harga kerja, bukan nilai buku dan bukan HPP final Finance.",
    pemisah: PEMISAH,
    pembanding: { catatan: "Pembanding saja — bukan sumber harga berlaku.", biayaPerolehanGRTerakhir: rcpt ? { harga: Number(rcpt.unit_cost), tanggal: rcpt.created_at } : null, referensiAgustus: bahan.referenceUnitCost != null ? { harga: Number(bahan.referenceUnitCost), bulan: bahan.referenceUnitCostMonth } : null },
    dampak, jumlahRiwayat: semua.length, penerapanAktif: aktifApp, izinTeks: IZIN_TEKS,
    nilaiPersediaanFinance: await nilaiPersediaanFinanceBahan(db, materialId),
  };
}

/**
 * NILAI PERSEDIAAN FINANCE per bahan (terpisah dari harga berlaku/HPP operasional): satu-satunya sumber per-bahan adalah baris Persediaan Awal yang sudah DIPOSTING Finance
 * (qty fisik × biaya satuan pada tanggal cutover). Bukan saldo berjalan dan bukan harga kerja. Bila belum ada yang diposting: tersedia=false (jujur, bukan Rp0).
 */
export async function nilaiPersediaanFinanceBahan(db, materialId) {
  const r = (await db.$queryRawUnsafe(`select o.number, o.cutover_date, o.posted_at, l.qty, l.unit, l.unit_cost, l.value from fin_inventory_opening_lines l join fin_inventory_openings o on o.id = l.opening_id
      where l.material_id = $1::uuid and o.status = 'DIPOSTING' order by o.posted_at desc limit 1`, materialId))[0];
  const nama = "Nilai persediaan Finance (Persediaan Awal terposting)";
  if (!r) return { tersedia: false, nama, teks: "Belum ada nilai persediaan Finance untuk bahan ini: Persediaan Awal belum diposting atau tidak memuat bahan ini. Ini BUKAN Rp0." };
  return { tersedia: true, nama, nomor: r.number, tanggalCutover: r.cutover_date, diposting: r.posted_at, qty: Number(r.qty), satuan: r.unit, biayaSatuan: Number(r.unit_cost), nilai: Number(r.value),
    teks: "Snapshot pada tanggal cutover (qty hitung fisik × biaya perolehan). Bukan saldo berjalan, bukan Harga Berlaku, bukan HPP operasional." };
}

/** Harga berlaku SEKARANG semua bahan yang punya riwayat harga — untuk kolom daftar Stok & Lokasi (satu kueri, baca-saja). Bahan tanpa harga tidak muncul (UI: "Belum ada harga berlaku", bukan Rp0). */
export async function ringkasanDaftar(db) {
  const semua = await db.materialHargaBerlaku.findMany({ orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }], include: { material: { select: { unit: true } } } });
  const per = new Map(); for (const x of semua) { if (!per.has(x.materialId)) per.set(x.materialId, []); per.get(x.materialId).push(x); }
  const sekarang = new Date(); const harga = {};
  for (const [id, baris] of per) {
    const diganti = new Set(baris.map((x) => x.correctsId).filter(Boolean)); const aktif = baris.filter((x) => !diganti.has(x.id));
    const b = pilih(aktif, sekarang); const jadwal = aktif.find((x) => new Date(x.effectiveFrom) > sekarang);
    if (b || jadwal) harga[id] = { harga: b ? Number(b.unitPrice) : null, satuan: baris[0].material.unit, berlakuMulai: b?.effectiveFrom ?? null, labelBukti: b ? labelDari(b) : null, teksLabelBukti: b ? LABEL_BUKTI[labelDari(b)] : null, terjadwal: jadwal ? { harga: Number(jadwal.unitPrice), berlakuMulai: jadwal.effectiveFrom } : null };
  }
  return { sekarang, harga, jumlah: Object.keys(harga).length, pemisah: PEMISAH, catatan: "Harga berlaku = HPP operasional per satuan stok (harga kerja), bukan nilai persediaan Finance." };
}

// ── pratinjau & simpan ──────────────────────────────────────────────────────────────────────────────

const ALASAN_MIN = { HARGA: 5, KOREKSI: 10 };
function bacaMasukan(m, bahan, { koreksi, sekarang }) {
  let harga; try { harga = new Decimal(String(m.hargaBaru ?? "").replace(/\s/g, "")); } catch { harga = null; }
  wajib(harga && harga.isFinite() && harga.greaterThan(0), "Harga baru wajib angka lebih dari 0 (bukan Rp0)", "HARGA_TIDAK_VALID");
  wajib(harga.decimalPlaces() <= 4, "Harga maksimal 4 desimal — tidak dibulatkan diam-diam", "HARGA_DESIMAL_BERLEBIH");
  wajib(harga.lessThan("1000000000"), "Harga tidak masuk akal (≥ Rp1 miliar per satuan)", "HARGA_TIDAK_MASUK_AKAL");
  const sat = String(m.satuan ?? "").trim().toUpperCase();
  wajib(sat === String(bahan.unit).toUpperCase(), `Satuan harus ${bahan.unit} (satuan stok bahan ini); harga dalam satuan lain (mis. per pak/roll) harus dikonversi dulu — jangan dicampur`, "SATUAN_BEDA", 422);
  const jenis = koreksi ? "KOREKSI" : "HARGA"; let mulai = null; let saatDisimpan = false;
  const kosong = m.berlakuMulai == null || String(m.berlakuMulai).trim() === "" || m.berlakuMulai === "SEKARANG";
  if (kosong) {
    wajib(!koreksi, "Koreksi wajib menyebut waktu berlaku harga yang dikoreksi", "WAKTU_TIDAK_VALID"); saatDisimpan = true;
  } else {
    mulai = new Date(m.berlakuMulai); wajib(!Number.isNaN(mulai.getTime()), "Waktu mulai berlaku tidak valid", "WAKTU_TIDAK_VALID");
    wajib(mulai.getFullYear() >= 2025 && mulai.getTime() <= sekarang.getTime() + 366 * 86400_000, "Waktu mulai berlaku di luar rentang wajar (maks 1 tahun ke depan)", "WAKTU_TIDAK_WAJAR");
    wajib(koreksi || mulai.getTime() > sekarang.getTime(), "Perubahan harga biasa tidak boleh berlaku mundur. Pilih “saat disimpan” atau waktu mendatang. Untuk memperbaiki salah input historis gunakan Koreksi (tindakan khusus: alasan, pratinjau seluruh pemakaian terdampak).", "WAKTU_MUNDUR", 422);
  }
  const alasan = String(m.alasan ?? "").trim(); wajib(alasan.length >= ALASAN_MIN[jenis] && alasan.length <= 500, `Alasan wajib diisi (${ALASAN_MIN[jenis]}–500 karakter)${koreksi ? " — koreksi salah input historis butuh alasan yang jelas" : ""}`, "ALASAN_WAJIB");
  const catatan = String(m.catatan ?? "").trim().slice(0, 500) || null; const bukti = String(m.catatanBukti ?? "").trim().slice(0, 500) || null;
  return { harga: harga.toDecimalPlaces(4), mulai, saatDisimpan, alasan, catatan, bukti, jenis };
}

/** Pemakaian yang HARGA BERLAKU-nya berubah bila baris sasaran diganti koreksi (seluruh pemakaian terdampak, bukan contoh). Baca-saja. */
async function dampakKoreksi(db, bahan, { aktif, sasaran, hargaBaru, mulaiBaru, bukti }) {
  const dasar = aktif.filter((x) => x.id !== sasaran.id);
  const maya = { id: "KOREKSI-BARU", unitPrice: hargaBaru.toString(), effectiveFrom: mulaiBaru, createdAt: new Date(), evidenceNote: bukti };
  const sesudah = [...dasar, maya].sort((a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom) || new Date(a.createdAt) - new Date(b.createdAt));
  const dari = new Date(Math.min(new Date(sasaran.effectiveFrom).getTime(), mulaiBaru.getTime()));
  const mv = await db.stockMovement.findMany({ where: { materialId: bahan.id, unitId: { not: null }, type: { in: TIPE_OP }, createdAt: { gte: dari } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, type: true, qty: true, createdAt: true, note: true, unitId: true, materialId: true, correctsMovementId: true, unit: { select: { unitCode: true, order: { select: { orderNumber: true } } } }, biayaOperasional: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } });
  const kena = new Set(); const baris = [];
  for (const p of mv) {
    let hSebelum = null; let hSesudah = null; let ikut = false;
    if (p.type === "RETURN") { const asal = await asalRetur(db, p); if (asal.length) { if (!asal.some((x) => kena.has(x.id))) continue; ikut = true; } }
    if (!ikut) { const wd = waktuDasarHarga(p); const a = pilih(aktif, wd); const b = pilih(sesudah, wd); hSebelum = a ? Number(a.unitPrice) : null; hSesudah = b ? Number(b.unitPrice) : null; if (hSebelum === hSesudah) continue; }
    kena.add(p.id); const o = p.biayaOperasional[0] ?? null;
    baris.push({ movementId: p.id, order: p.unit?.order?.orderNumber ?? null, unit: p.unit?.unitCode ?? null, tanggal: wibTgl(p.createdAt), tipe: p.type, qty: Math.abs(Number(p.qty)), hargaBerlakuSebelum: hSebelum, hargaBerlakuSesudah: hSesudah, ikutIssueAsal: ikut,
      keadaanBeku: !o ? "BELUM_DIBEKUKAN" : o.status === GAGAL ? "GAGAL_PEMBEKUAN" : o.status === "DINILAI" ? "DIBEKUKAN" : "DIBEKUKAN_TANPA_HARGA", hargaBeku: o?.unitCost == null ? null : Number(o.unitCost), nilaiBeku: o?.value == null ? null : Number(o.value) });
  }
  const dibekukan = baris.filter((x) => x.keadaanBeku === "DIBEKUKAN");
  const ringkas = { jumlah: baris.length, dibekukanDenganHargaLama: dibekukan.length, nilaiBekuTerdampak: Number(toMoney(dibekukan.reduce((a, x) => a.plus(x.nilaiBeku ?? 0), D(0)))), belumDibekukan: baris.filter((x) => x.keadaanBeku === "BELUM_DIBEKUKAN" || x.keadaanBeku === "GAGAL_PEMBEKUAN").length, gagalPembekuan: baris.filter((x) => x.keadaanBeku === "GAGAL_PEMBEKUAN").length, dibekukanTanpaHarga: baris.filter((x) => x.keadaanBeku === "DIBEKUKAN_TANPA_HARGA").length, dariWaktu: dari.toISOString(), digest: sha(baris.map((x) => [x.movementId, x.hargaBerlakuSesudah])) };
  return { ringkas, baris, dipotong: baris.length > 300, ids: baris.map((x) => x.movementId) };
}

/** Pratinjau SEBELUM simpan (baca-saja). koreksiId = tindakan khusus memperbaiki baris harga yang salah input. */
export async function pratinjauUbahHarga(db, masukan = {}, { lengkap = true } = {}) {
  const bahan = await db.material.findUnique({ where: { id: String(masukan.materialId ?? "") }, select: { id: true, code: true, name: true, unit: true, referenceUnitCost: true } }); wajib(bahan, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const koreksiId = masukan.koreksiId ? String(masukan.koreksiId) : null; const { aktif, semua, diganti } = await barisAktif(db, bahan.id); const sekarang = new Date();
  let sasaran = null; if (koreksiId) { sasaran = semua.find((x) => x.id === koreksiId); wajib(sasaran, "Baris harga yang dikoreksi tidak ditemukan pada bahan ini", "BARIS_TIDAK_ADA", 404); wajib(!diganti.has(sasaran.id), "Baris ini sudah digantikan koreksi lain — koreksi baris terbarunya", "SUDAH_DIKOREKSI", 409); }
  const m = bacaMasukan(masukan, bahan, { koreksi: !!koreksiId, sekarang });
  const dasar = koreksiId ? aktif.filter((x) => x.id !== koreksiId) : aktif; const acuan = m.mulai ?? sekarang;
  const sebelum = pilih(dasar, acuan); const terbaru = semua[semua.length - 1] ?? null;
  const berlakuSekarangLama = pilih(aktif, sekarang); const hargaLama = sebelum ? D(sebelum.unitPrice) : null;
  const selisihPersen = hargaLama && hargaLama.greaterThan(0) ? Number(m.harga.minus(hargaLama).dividedBy(hargaLama).times(100).toDecimalPlaces(1)) : null;
  const peringatan = [];
  if (selisihPersen != null && Math.abs(selisihPersen) >= 30) peringatan.push({ kode: "SELISIH_BESAR", pesan: `Harga berubah ${selisihPersen > 0 ? "naik" : "turun"} ${Math.abs(selisihPersen)}% dari harga sebelumnya — periksa satuan (${bahan.unit}) dan angka nol.` });
  if (bahan.referenceUnitCost && (m.harga.dividedBy(D(bahan.referenceUnitCost)).greaterThan(5) || m.harga.times(5).lessThan(D(bahan.referenceUnitCost)))) peringatan.push({ kode: "JAUH_DARI_REFERENSI", pesan: "Harga lebih dari 5× atau kurang dari 1/5 harga referensi Agustus (pembanding) — pastikan satuan benar." });
  if (!m.bukti) peringatan.push({ kode: "BELUM_ADA_BUKTI", pesan: "Tanpa catatan bukti: harga ini tersimpan dengan label “Belum didukung bukti”. Boleh, tetapi bukan nilai buku dan bukan HPP final Finance." });
  let terkoreksi = null; let dampakK = null;
  if (sasaran) {
    dampakK = await dampakKoreksi(db, bahan, { aktif, sasaran, hargaBaru: m.harga, mulaiBaru: m.mulai, bukti: m.bukti });
    terkoreksi = { baris: tampilBaris(sasaran, { diganti, aktifId: null, sekarang }), ket: dampakK.ringkas.dibekukanDenganHargaLama ? `${dampakK.ringkas.dibekukanDenganHargaLama} pemakaian SUDAH dibekukan dengan harga lama (${Math.abs(dampakK.ringkas.nilaiBekuTerdampak).toLocaleString("id-ID")}) — nilai beku itu TIDAK diubah diam-diam; perbaikannya lewat penerapan khusus dua orang setelah koreksi disimpan.` : "Belum ada pemakaian yang dibekukan dengan harga yang dikoreksi." };
    peringatan.push({ kode: "TINDAKAN_KHUSUS", pesan: "Koreksi salah input historis adalah tindakan khusus: baris lama tidak dihapus, nilai beku tidak berubah, seluruh pemakaian terdampak ditampilkan di bawah dan wajib dikonfirmasi." });
  }
  const hasil = {
    bahan: { id: bahan.id, kode: bahan.code, nama: bahan.name, satuan: bahan.unit }, jenis: m.jenis,
    hargaLama: hargaLama == null ? null : Number(hargaLama), hargaBaru: Number(m.harga), selisihPersen, berlakuMulai: m.saatDisimpan ? null : m.mulai.toISOString(), saatDisimpan: m.saatDisimpan, satuan: bahan.unit, alasan: m.alasan, catatan: m.catatan, catatanBukti: m.bukti,
    labelBukti: m.bukti ? "ADA_CATATAN_BUKTI" : "BELUM_DIDUKUNG_BUKTI", teksLabelBukti: LABEL_BUKTI[m.bukti ? "ADA_CATATAN_BUKTI" : "BELUM_DIDUKUNG_BUKTI"],
    hargaBerlakuSekarangSebelumUbah: berlakuSekarangLama ? Number(berlakuSekarangLama.unitPrice) : null, terkoreksi, peringatan, pemisah: PEMISAH,
    dampakKoreksi: dampakK ? { ...dampakK.ringkas, baris: dampakK.baris.slice(0, 300), dipotong: dampakK.dipotong, wajibKonfirmasi: true } : null,
    aturan: m.jenis === "KOREKSI" ? "Koreksi mengganti harga baris yang salah input untuk pemakaian SESUDAH koreksi disimpan dan untuk penerapan khusus. Nilai beku lama tidak berubah." : "Harga baru berlaku untuk pemakaian aktual sejak waktu berlaku (saat disimpan atau mendatang). Pemakaian yang sudah dibekukan tidak berubah. Order yang belum memakai bahan menampilkan pratinjau harga terbaru dan dibekukan saat pemakaian diposting.",
  };
  hasil.hash = sha({ m: bahan.id, h: m.harga.toString(), t: m.saatDisimpan ? "SEKARANG" : m.mulai.toISOString(), s: bahan.unit, j: m.jenis, k: koreksiId, lama: sebelum?.id ?? null, terbaru: terbaru?.id ?? null, dk: dampakK ? dampakK.ringkas.digest : null });
  if (lengkap) hasil.dampak = await hitungDampak(db, bahan.id, m.mulai ?? sekarang);
  hasil._simpan = { materialId: bahan.id, m, koreksiId, dampak: dampakK, satuan: bahan.unit };
  return hasil;
}
export const tanpaInternal = ({ _simpan, ...x }) => x;

const tampilSimpan = (b) => ({ id: b.id, jenis: b.jenis, bahanId: b.materialId, harga: Number(b.unitPrice), satuan: b.satuan, berlakuMulai: b.effectiveFrom, hargaLama: b.previousPrice == null ? null : Number(b.previousPrice), alasan: b.reason, labelBukti: labelDari(b), teksLabelBukti: LABEL_BUKTI[labelDari(b)], dibuatOleh: b.createdById, dibuatPada: b.createdAt, dampak: b.impact ?? null });

/** Simpan Harga Berlaku baru / KOREKSI salah input (tindakan khusus). Idempoten (Idempotency-Key), hash pratinjau wajib sama, append-only, tanpa tanggal mundur untuk harga biasa. */
export async function simpanHarga(prisma, masukan, { aktor, kunci }) {
  const idem = kunciValid(kunci); wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB");
  const ada = await prisma.materialHargaBerlaku.findUnique({ where: { idempotencyKey: idem } });
  if (ada) { wajib(ada.materialId === masukan.materialId, "Idempotency-Key ini sudah dipakai untuk bahan lain", "KUNCI_DIPAKAI_LAIN", 409); return { ulang: true, ...tampilSimpan(ada) }; }
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "materials", String(masukan.materialId ?? ""));
    const dupl = await tx.materialHargaBerlaku.findUnique({ where: { idempotencyKey: idem } }); if (dupl) return { ulang: true, ...tampilSimpan(dupl) };
    const pra = await pratinjauUbahHarga(tx, masukan, { lengkap: false });
    wajib(String(masukan.hashPratinjau ?? "") === pra.hash, "Pratinjau yang Anda lihat sudah berbeda dari keadaan sekarang (harga lain disimpan, pemakaian baru, atau isian berubah). Muat ulang pratinjau lalu simpan lagi.", "PRATINJAU_BERUBAH", 409);
    const { m, koreksiId, dampak } = pra._simpan;
    if (koreksiId) wajib(masukan.konfirmasiDampak === true, "Koreksi salah input historis wajib dikonfirmasi setelah membaca seluruh pemakaian terdampak", "KONFIRMASI_DAMPAK_WAJIB", 422);
    const sekarang = new Date(); const mulai = m.saatDisimpan ? sekarang : m.mulai;
    if (!koreksiId) wajib(mulai.getTime() >= sekarang.getTime(), "Waktu berlaku terjadwal sudah terlewat saat disimpan — pilih ulang waktu", "WAKTU_MUNDUR", 422);
    const { aktif } = await barisAktif(tx, pra._simpan.materialId); const dasar = koreksiId ? aktif.filter((x) => x.id !== koreksiId) : aktif; const sebelum = pilih(dasar, mulai);
    const impact = koreksiId ? { ...dampak.ringkas, movementIds: dampak.ids.slice(0, 500), dikonfirmasiOleh: aktor.id } : null;
    const b = await tx.materialHargaBerlaku.create({ data: { materialId: pra._simpan.materialId, jenis: m.jenis, unitPrice: m.harga.toString(), satuan: pra._simpan.satuan, effectiveFrom: mulai, previousPrice: sebelum ? String(sebelum.unitPrice) : null, correctsId: koreksiId, reason: m.alasan, note: m.catatan, evidenceNote: m.bukti, createdById: aktor.id, createdAt: sekarang, idempotencyKey: idem, impact } });
    return { ulang: false, ...tampilSimpan(b) };
  }, { timeout: 30_000, maxWait: 10_000 });
}


// ── pembekuan saat pemakaian diposting ──────────────────────────────────────────────────────────────

/** Dipanggil postStockMovement (transaksi yang sama). Membekukan harga operasional menurut hargaUntukPergerakan (ISSUE/WASTE: harga berlaku saat itu; RETUR tertaut ISSUE: harga ISSUE asal); tidak pernah menggagalkan perintah Gudang; tidak menulis stok/jurnal/valuasi Finance. */
export async function catatBiayaOperasional(tx, mov) {
  if (!mov?.unitId || !JENIS_BIAYA_OP[mov.type]) return null;
  if (typeof tx?.$executeRawUnsafe !== "function" || !tx?.stockMovementBiayaOperasional) return null;
  await tx.$executeRawUnsafe("SAVEPOINT sp_biaya_operasional");
  try {
    const qty = D(mov.qty); const sel = penyelesaiHargaBerlaku(tx); const r = await hargaUntukPergerakan(tx, { id: mov.id, type: mov.type, materialId: mov.materialId, unitId: mov.unitId, createdAt: mov.createdAt ?? new Date(), correctsMovementId: mov.correctsMovementId ?? null, note: mov.note ?? null }, sel);
    const nilai = r.ada ? (qty.isNegative() ? toMoney(qty.abs().times(r.harga)) : toMoney(qty.abs().times(r.harga)).negated()) : null;
    const data = r.ada
      ? { status: "DINILAI", unitCost: r.harga.toString(), value: nilai.toString(), priceId: r.priceId, priceEffectiveFrom: r.priceEffectiveFrom, evidenceLabel: r.label }
      : { status: "TANPA_HARGA", unitCost: null, value: null, priceId: null, priceEffectiveFrom: null, evidenceLabel: null };
    const baris = await tx.stockMovementBiayaOperasional.create({ data: { movementId: mov.id, materialId: mov.materialId, unitId: mov.unitId, qty: qty.toString(), sumber: "BEKU_SAAT_POSTING", basisHarga: r.basis, basisDetail: r.detail ?? undefined, createdById: mov.createdById ?? null, ...data } });
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT sp_biaya_operasional");
    return baris;
  } catch (e) {
    // Kegagalan pembekuan TIDAK menggagalkan perintah Gudang HANYA bila kegagalan itu tercatat persisten (baris GAGAL_PEMBEKUAN: ditemukan lewat daftarGagalPembekuan, diperbaiki lewat penerapan khusus).
    // Bila pemulihan savepoint atau penyimpanan penandanya sendiri gagal, kesalahan DILEMPAR → seluruh transaksi stok ditolak (tidak ada pemakaian tanpa jejak).
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sp_biaya_operasional"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT sp_biaya_operasional");
    const kode = String(e?.code ?? e?.name ?? "ERROR").slice(0, 60); const alasan = String(e?.message ?? e ?? "").trim().slice(0, 500) || "tanpa pesan";
    try {
      await tx.$executeRawUnsafe("SAVEPOINT sp_biaya_operasional_gagal");
      await tx.stockMovementBiayaOperasional.create({ data: { movementId: mov.id, materialId: mov.materialId, unitId: mov.unitId, status: GAGAL, qty: D(mov.qty).toString(), sumber: "GAGAL_SAAT_POSTING", basisHarga: "TIDAK_DIKETAHUI", gagalKode: kode, gagalAlasan: alasan, createdById: mov.createdById ?? null } });
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT sp_biaya_operasional_gagal");
    } catch (e2) {
      console.error("[harga-berlaku] pembekuan GAGAL dan penandanya GAGAL disimpan — transaksi stok ditolak:", mov.id, e?.message, "|", e2?.message);
      throw new KoreksiError("Pemakaian tidak dapat diposting: pembekuan harga operasional gagal dan kegagalannya tidak dapat dicatat. Tidak ada yang tersimpan; coba lagi atau hubungi admin sistem.", 503, "PENANDA_PEMBEKUAN_GAGAL");
    }
    console.error("[harga-berlaku] pembekuan biaya operasional GAGAL — dicatat persisten (GAGAL_PEMBEKUAN) agar dapat diperbaiki; perintah Gudang tetap berjalan:", mov.id, kode, alasan);
    return null;
  }
}

/** Pemakaian yang pembekuannya GAGAL dan belum diperbaiki (baris terakhirnya masih penanda). Untuk ditemukan lalu diperbaiki lewat penerapan khusus (kelompok BELUM_DIBEKUKAN). Baca-saja. */
export async function daftarGagalPembekuan(db, { bahanId = null, limit = 200 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const rows = await db.$queryRawUnsafe(`with t as (select distinct on (b.movement_id) b.movement_id, b.status, b.material_id, b.unit_id from stock_movement_biaya_operasional b
        where exists (select 1 from stock_movement_biaya_operasional g where g.movement_id = b.movement_id and g.status = 'GAGAL_PEMBEKUAN') order by b.movement_id, b.created_at desc, b.id desc)
      select t.movement_id::text "movementId", m.code kode, m.name nama, m.unit satuan, t.material_id::text "bahanId", u.unit_code unit, o."orderNumber" "order", s.type::text tipe, s.qty::float qty, s.created_at "waktuPemakaian", g.created_at "dicatatPada", g.gagal_kode "kodeGalat", g.gagal_alasan alasan
      from t join stock_movement_biaya_operasional g on g.movement_id = t.movement_id and g.status = 'GAGAL_PEMBEKUAN' join stock_movements s on s.id = t.movement_id join materials m on m.id = t.material_id left join units u on u.id = t.unit_id left join "Order" o on o.id = u.order_id
      where t.status = 'GAGAL_PEMBEKUAN' and ($1::uuid is null or t.material_id = $1::uuid) order by g.created_at limit $2`, bahanId, lim);
  return { jumlah: rows.length, dipotong: rows.length >= lim, baris: rows, tindakan: "Perbaiki lewat Stok → bahan → “Beri harga ke pemakaian lama” (kelompok ‘belum dibekukan’; butuh pengaju dan penyetuju berbeda). Penanda kegagalan tetap tersimpan sebagai riwayat." };
}


// ── tindakan khusus: memberi/menyelaraskan harga berlaku pada pemakaian LAMA ────────────────────────

const bacaGrup = (g) => { const x = Array.isArray(g) && g.length ? [...new Set(g)] : ["BELUM_DIBEKUKAN", "TANPA_HARGA_BERLAKU"]; wajib(x.every((k) => Object.hasOwn(KELOMPOK_PENERAPAN, k)), "Kelompok tidak dikenal", "KELOMPOK_TIDAK_VALID"); return x.sort(); };

export async function pratinjauPenerapan(db, { materialId, groups, movementIds = null, dari = null, sampai = null } = {}, { lengkap = true } = {}) {
  const grup = bacaGrup(groups); const bahan = await db.material.findUnique({ where: { id: String(materialId ?? "") }, select: { id: true, code: true, name: true, unit: true } }); wajib(bahan, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const pilihId = Array.isArray(movementIds) && movementIds.length ? new Set(movementIds.map(String)) : null;
  const d0 = dari ? new Date(dari) : null; const d1 = sampai ? new Date(sampai) : null; wajib(!(d0 && Number.isNaN(d0.getTime())) && !(d1 && Number.isNaN(d1.getTime())), "Rentang tanggal tidak valid", "RENTANG_TIDAK_VALID");
  const selesai = penyelesaiHargaBerlaku(db);
  const mv = await db.stockMovement.findMany({ where: { materialId: bahan.id, unitId: { not: null }, type: { in: TIPE_OP }, ...(d0 || d1 ? { createdAt: { ...(d0 ? { gte: d0 } : {}), ...(d1 ? { lte: d1 } : {}) } } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, type: true, qty: true, createdAt: true, note: true, unitId: true, materialId: true, correctsMovementId: true, unit: { select: { unitCode: true, order: { select: { orderNumber: true } } } }, biayaOperasional: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } });
  const terapkan = []; const gap = []; let sudahSelaras = 0; const hitung = { BELUM_DIBEKUKAN: 0, TANPA_HARGA_BERLAKU: 0, SELARAS_ULANG: 0 };
  for (const p of mv) {
    const terakhir = p.biayaOperasional[0] ?? null; const h = await hargaUntukPergerakan(db, p, selesai); const qty = D(p.qty);
    const dasar = { movementId: p.id, tanggal: wibTgl(p.createdAt), tanggalDasarHarga: tanggalDasarHarga(p), waktu: p.createdAt, order: p.unit?.order?.orderNumber ?? null, unit: p.unit?.unitCode ?? null, unitId: p.unitId, tipe: p.type, qty: Number(qty), satuan: bahan.unit };
    let kel;
    if (!terakhir || terakhir.status === GAGAL) kel = "BELUM_DIBEKUKAN"; else if (terakhir.status === "TANPA_HARGA") kel = "TANPA_HARGA_BERLAKU";
    else if (!h.ada) { gap.push({ ...dasar, gap: "HARGA_BERLAKU_HILANG", ket: "Harga beku ada tetapi tidak ada harga berlaku pada waktu itu (setelah koreksi) — tinjau manual", nilaiSekarang: Number(terakhir.value) }); continue; }
    else if (D(terakhir.unitCost).equals(h.harga)) { sudahSelaras++; continue; } else kel = "SELARAS_ULANG";
    hitung[kel]++; if (!grup.includes(kel)) continue; if (pilihId && !pilihId.has(p.id)) continue;
    if (!h.ada) { gap.push({ ...dasar, kelompok: kel, basis: h.basis, basisTeks: teksDasarHarga(h.basis, dasar.tanggalDasarHarga), gap: h.gap, ket: h.gap === "ISSUE_ASAL_BELUM_BERHARGA" ? "Retur tertaut ISSUE asal yang belum punya harga operasional — beri harga ISSUE asal dulu (retur mengikuti, bukan memakai harga yang sedang berlaku)" : "Belum ada harga berlaku pada waktu pemakaian ini — tidak diberi harga rekaan" }); continue; }
    const mutlak = toMoney(qty.abs().times(h.harga)); const nilai = qty.isNegative() ? mutlak : mutlak.negated();
    terapkan.push({ ...dasar, kelompok: kel, harga: h.harga, nilaiBaru: Number(nilai), nilaiSebelum: terakhir?.value == null ? null : Number(terakhir.value), priceId: h.priceId, priceEffectiveFrom: h.priceEffectiveFrom, label: h.label, basis: h.basis, basisTeks: teksDasarHarga(h.basis, dasar.tanggalDasarHarga), basisDetail: h.detail, hargaBeku: terakhir?.unitCost == null ? null : Number(terakhir.unitCost) });
  }
  const total = terapkan.reduce((a, x) => a.plus(x.nilaiBaru), D(0));
  const hasil = { bahan: { id: bahan.id, kode: bahan.code, nama: bahan.name, satuan: bahan.unit }, kelompokDipilih: grup, tersedia: hitung, sudahSelaras,
    penerapan: { jumlah: terapkan.length, nilai: Number(toMoney(total)), baris: terapkan.map(({ harga, priceId, priceEffectiveFrom, waktu, basisDetail, ...x }) => ({ ...x, harga: Number(harga), hargaBerlakuMulai: priceEffectiveFrom })) },
    gap: { jumlah: gap.length, baris: gap, catatan: "Tanpa harga berlaku pada waktu pemakaian → tetap tanpa harga operasional (tidak ada harga rekaan)." }, pemisah: PEMISAH,
    aturan: "Penerapan = baris biaya operasional BARU yang disetujui orang lain; tidak mengubah stok, ISSUE, catatan, valuasi/jurnal Finance, atau GL; tidak otomatis untuk semua order lama." };
  hasil.hash = sha({ b: bahan.id, g: grup, rows: terapkan.map((x) => [x.movementId, x.harga.toString(), x.priceId, x.basis]) });
  hasil._terapkan = terapkan; hasil._scope = { groups: grup, movementIds: pilihId ? [...pilihId].sort() : null, dari: d0?.toISOString() ?? null, sampai: d1?.toISOString() ?? null };
  if (!lengkap) return hasil;
  const unitIds = [...new Set(terapkan.map((x) => x.unitId))];
  hasil.perOrder = unitIds.length ? (await db.$queryRawUnsafe(`select o."orderNumber" "order", u.unit_code unit, u.id::text "unitId", coalesce(sum(x.val) filter (where x.st = 'DINILAI' and s.type::text <> 'WASTE'),0)::float sebelum, count(*) filter (where x.st is null or x.st = 'TANPA_HARGA' or x.st = 'GAGAL_PEMBEKUAN')::int tanpa_harga_op
      from stock_movements s join units u on u.id = s.unit_id join "Order" o on o.id = u.order_id left join lateral (select b.status st, b.value val from stock_movement_biaya_operasional b where b.movement_id = s.id order by b.created_at desc, b.id desc limit 1) x on true
      where s.unit_id = any($1::uuid[]) and s.type::text = any($2::text[]) group by o."orderNumber", u.unit_code, u.id order by 1`, unitIds, TIPE_OP)).map((r) => {
    const tambah = terapkan.filter((x) => x.unitId === r.unitId); const delta = tambah.reduce((a, x) => a.plus(x.nilaiBaru - (x.nilaiSebelum ?? 0)), D(0)); const sudah = tambah.filter((x) => x.kelompok !== "SELARAS_ULANG").length;
    return { order: r.order, unit: r.unit, transaksi: tambah.length, hppOperasionalSebelum: r.sebelum, tambah: Number(toMoney(delta)), hppOperasionalSesudah: Number(toMoney(D(r.sebelum).plus(delta))), sisaTanpaHargaOperasional: Math.max(0, r.tanpa_harga_op - sudah) };
  }) : [];
  return hasil;
}
export const tanpaInternalPenerapan = ({ _terapkan, _scope, ...x }) => x;

const tampilApp = (b) => ({ id: b.id, bahanId: b.materialId, status: b.status, cakupan: b.scope, alasan: b.reason, pratinjau: { hash: b.previewHash, transaksi: b.previewCount, nilai: Number(b.previewValue) }, diajukanOleh: b.requestedById, diajukanPada: b.requestedAt, diputuskanOleh: b.decidedById, diputuskanPada: b.decidedAt, catatanKeputusan: b.decisionNote, diterapkan: b.appliedCount });

export async function ajukanPenerapan(prisma, masukan, { aktor, kunci }) {
  const idem = kunciValid(kunci); wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB");
  const alasan = String(masukan.alasan ?? "").trim(); wajib(alasan.length >= 5 && alasan.length <= 500, "Alasan wajib diisi (5–500 karakter)", "ALASAN_WAJIB");
  const ada = await prisma.biayaOperasionalPenerapan.findUnique({ where: { idempotencyKey: idem } });
  if (ada) { wajib(ada.materialId === masukan.materialId, "Idempotency-Key ini sudah dipakai untuk bahan lain", "KUNCI_DIPAKAI_LAIN", 409); return { ulang: true, ...tampilApp(ada) }; }
  const pra = await pratinjauPenerapan(prisma, masukan, { lengkap: false });
  wajib(String(masukan.hashPratinjau ?? "") === pra.hash, "Pratinjau yang Anda lihat sudah berbeda dari keadaan sekarang. Muat ulang pratinjau lalu ajukan lagi.", "PRATINJAU_BERUBAH", 409);
  wajib(pra.penerapan.jumlah > 0, "Tidak ada pemakaian yang akan diberi harga — tidak ada yang diajukan", "TIDAK_ADA_TRANSAKSI", 409);
  try { return { ulang: false, ...tampilApp(await prisma.biayaOperasionalPenerapan.create({ data: { materialId: masukan.materialId, scope: pra._scope, reason: alasan, previewHash: pra.hash, previewCount: pra.penerapan.jumlah, previewValue: pra.penerapan.nilai.toString(), requestedById: aktor.id, idempotencyKey: idem } })) }; }
  catch (e) { if (e?.code === "P2002") { const s = await prisma.biayaOperasionalPenerapan.findUnique({ where: { idempotencyKey: idem } }); if (s) return { ulang: true, ...tampilApp(s) }; throw new KoreksiError("Sudah ada pengajuan penerapan yang menunggu untuk bahan ini — setujui, tolak, atau batalkan dulu", 409, "SATU_PENGAJUAN_AKTIF"); } throw e; }
}

export async function setujuiPenerapan(prisma, { id, hashPratinjau, aktor, catatan = null }) {
  wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB");
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "biaya_operasional_penerapan", id);
    const b = await tx.biayaOperasionalPenerapan.findUnique({ where: { id } }); wajib(b, "Penerapan tidak ditemukan", "TIDAK_ADA", 404);
    if (b.status === "DISETUJUI") return { ulang: true, ...tampilApp(b) };
    wajib(b.status === "DIAJUKAN", `Penerapan berstatus ${b.status} tidak bisa disetujui`, "STATUS_FINAL", 409);
    wajib(!b.requestedById || b.requestedById !== aktor.id, "Pengaju tidak boleh menyetujui penerapannya sendiri — minta penyetuju lain", "PEMOHON_SAMA", 403);
    wajib(String(hashPratinjau ?? "") === b.previewHash, "Pratinjau yang Anda setujui berbeda dari yang diajukan", "PRATINJAU_BERBEDA", 409);
    await lockRowForUpdate(tx, "materials", b.materialId);
    const pra = await pratinjauPenerapan(tx, { materialId: b.materialId, groups: b.scope.groups, movementIds: b.scope.movementIds, dari: b.scope.dari, sampai: b.scope.sampai }, { lengkap: false });
    wajib(pra.hash === b.previewHash, `Keadaan sudah bergeser sejak diajukan (harga berlaku/pemakaian): pratinjau kini ${pra.penerapan.jumlah} transaksi, diajukan ${b.previewCount}. Tolak lalu ajukan ulang.`, "PRATINJAU_BERUBAH", 409);
    for (const x of pra._terapkan) await tx.stockMovementBiayaOperasional.create({ data: { movementId: x.movementId, materialId: b.materialId, unitId: x.unitId, status: "DINILAI", qty: String(x.qty), unitCost: x.harga.toString(), value: String(x.nilaiBaru), priceId: x.priceId, priceEffectiveFrom: x.priceEffectiveFrom, evidenceLabel: x.label, sumber: "PENERAPAN_DISETUJUI", basisHarga: x.basis, basisDetail: x.basisDetail ?? undefined, applicationId: b.id, createdById: aktor.id } });
    return { ulang: false, ...tampilApp(await tx.biayaOperasionalPenerapan.update({ where: { id: b.id }, data: { status: "DISETUJUI", decidedById: aktor.id, decidedAt: new Date(), decisionNote: catatan ? String(catatan).slice(0, 500) : null, appliedCount: pra._terapkan.length } })) };
  }, { timeout: 120_000, maxWait: 30_000 });
}
async function akhiri(prisma, { id, aktor, catatan, status, hanyaPemohon }) {
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "biaya_operasional_penerapan", id);
    const b = await tx.biayaOperasionalPenerapan.findUnique({ where: { id } }); wajib(b, "Penerapan tidak ditemukan", "TIDAK_ADA", 404);
    if (b.status === status) return { ulang: true, ...tampilApp(b) };
    wajib(b.status === "DIAJUKAN", `Penerapan berstatus ${b.status} tidak bisa diubah`, "STATUS_FINAL", 409);
    if (hanyaPemohon) wajib(b.requestedById === aktor.id, "Hanya pengaju yang dapat membatalkan pengajuannya", "BUKAN_PEMOHON", 403);
    else { wajib(!b.requestedById || b.requestedById !== aktor.id, "Pengaju tidak memutuskan pengajuannya sendiri — gunakan Batalkan", "PEMOHON_SAMA", 403); wajib(String(catatan ?? "").trim().length >= 5, "Alasan penolakan wajib diisi (min 5 karakter)", "ALASAN_WAJIB"); }
    return { ulang: false, ...tampilApp(await tx.biayaOperasionalPenerapan.update({ where: { id }, data: { status, decidedById: aktor.id, decidedAt: new Date(), decisionNote: catatan ? String(catatan).slice(0, 500) : null } })) };
  }, { timeout: 30_000, maxWait: 10_000 });
}
export const tolakPenerapan = (prisma, a) => akhiri(prisma, { ...a, status: "DITOLAK", hanyaPemohon: false });
export const batalkanPenerapan = (prisma, a) => akhiri(prisma, { ...a, status: "DIBATALKAN", hanyaPemohon: true });
export async function daftarPenerapan(db, { materialId = null, status = null } = {}) {
  const baris = await db.biayaOperasionalPenerapan.findMany({ where: { ...(materialId ? { materialId } : {}), ...(status ? { status } : {}) }, orderBy: { requestedAt: "desc" }, take: 100, include: { material: { select: { code: true, name: true, unit: true } } } });
  return baris.map((b) => ({ ...tampilApp(b), bahan: { kode: b.material.code, nama: b.material.name, satuan: b.material.unit } }));
}
export async function bacaPenerapan(db, id) { const b = await db.biayaOperasionalPenerapan.findUnique({ where: { id }, include: { material: { select: { code: true, name: true, unit: true } } } }); return b ? { ...tampilApp(b), bahan: { kode: b.material.code, nama: b.material.name, satuan: b.material.unit } } : null; }

// ── baca-model: HPP operasional per unit/order (dipasang di jejak bahan; dipisah dari nilai Finance) ─────

export async function hppOperasionalUnit(db, unitId) {
  const mv = await db.stockMovement.findMany({ where: { unitId, type: { in: TIPE_OP } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, type: true, qty: true, createdAt: true, note: true, materialId: true, unitId: true, correctsMovementId: true, material: { select: { code: true, name: true, unit: true } }, biayaOperasional: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } });
  const selesai = penyelesaiHargaBerlaku(db); const sekarang = new Date();
  const baris = []; let nilai = D(0); let susut = D(0); let pratinjauTambah = D(0); let nTanpa = 0; let nBelum = 0; let nGagal = 0;
  for (const m of mv) {
    const o = m.biayaOperasional[0] ?? null; const gagal = o?.status === GAGAL; const qty = D(m.qty); const jenis = JENIS_BIAYA_OP[m.type];
    let status; let harga = null; let nilaiB = null; let label = null; let pratinjau = null; let sumber = null; let mulai = null; let basis = o?.basisHarga ?? BASIS_TIPE[m.type];
    if (o?.status === "DINILAI") { status = "DIBEKUKAN"; harga = Number(o.unitCost); nilaiB = Number(o.value); label = o.evidenceLabel; sumber = o.sumber; mulai = o.priceEffectiveFrom; if (m.type === "WASTE") susut = susut.plus(o.value); else nilai = nilai.plus(o.value); }
    else {
      status = gagal ? GAGAL : o ? "DIBEKUKAN_TANPA_HARGA_BERLAKU" : "BELUM_DIBEKUKAN"; if (gagal) nGagal++; else if (o) nTanpa++; else nBelum++;
      const hh = await hargaUntukPergerakan(db, m, selesai); basis = gagal ? "TIDAK_DIKETAHUI" : hh.basis; const h = hh.ada ? { harga: hh.harga, label: hh.label } : null;
      if (h) { const mutlak = toMoney(qty.abs().times(h.harga)); const v = qty.isNegative() ? mutlak : mutlak.negated(); pratinjau = { harga: Number(h.harga), nilai: Number(v), label: h.label, ket: "Pratinjau pada harga berlaku saat pemakaian — belum dibekukan; diberi harga hanya lewat penerapan khusus." }; if (m.type !== "WASTE") pratinjauTambah = pratinjauTambah.plus(v); }
    }
    const tglDasar = tanggalDasarHarga(m);
    baris.push({ movementId: m.id, tanggal: m.createdAt, waktuPencatatan: m.createdAt, tanggalDasarHarga: tglDasar, jenisBiaya: jenis, tipe: m.type, kode: m.material.code, nama: m.material.name, satuan: m.material.unit, qty: Number(qty), status, harga, nilai: nilaiB, labelBukti: label, teksLabelBukti: label ? LABEL_BUKTI[label] : null, sumber, basis, basisTeks: teksDasarHarga(basis, tglDasar), basisDetail: o?.basisDetail ?? null, gagalAlasan: gagal ? o.gagalAlasan : null, hargaBerlakuMulai: mulai, pratinjau });
  }
  // bahan yang BELUM dipakai: Material Issue belum keluar + catatan siap posting → pratinjau harga terbaru
  const akan = await db.$queryRawUnsafe(`select m.id::text mid, m.code kode, m.name nama, m.unit satuan, sum(q.qty)::float qty, string_agg(distinct q.asal, ', ') asal from (
      select l.material_id, l.requested_qty qty, mi.issue_number asal from material_issue_lines l join material_issues mi on mi.id = l.material_issue_id where mi.unit_id = $1::uuid and mi.status::text = any($2::text[])
      union all select n.material_id, n.qty::float, 'catatan siap posting' from unit_usage_notes n where n.unit_id = $1::uuid and n.state = 'SIAP_POSTING' and n.material_id is not null and lower(coalesce(n.uom,'')) = (select lower(unit::text) from materials where id = n.material_id)) q
    join materials m on m.id = q.material_id group by m.id, m.code, m.name, m.unit order by m.code`, unitId, STATUS_MI_BELUM_KELUAR);
  const belumMemakai = []; let pratinjauAkan = D(0);
  for (const a of akan) { const h = await selesai(a.mid, sekarang); const v = h ? toMoney(D(a.qty).times(h.harga)) : null; const jadwal = (await barisAktif(db, a.mid)).aktif.find((x) => new Date(x.effectiveFrom) > sekarang); if (v) pratinjauAkan = pratinjauAkan.plus(v); belumMemakai.push({ kode: a.kode, nama: a.nama, satuan: a.satuan, qty: a.qty, asal: a.asal, hargaTerbaru: h ? Number(h.harga) : null, nilaiPratinjau: v ? Number(v) : null, labelBukti: h?.label ?? null, teksLabelBukti: h ? LABEL_BUKTI[h.label] : null, hargaTerjadwal: jadwal ? { harga: Number(jadwal.unitPrice), berlakuMulai: jadwal.effectiveFrom, ket: "Berlaku untuk pemakaian sejak waktu ini" } : null, ket: h ? "Pratinjau harga terbaru — dibekukan pada harga yang berlaku saat pemakaian diposting." : "Belum ada harga berlaku." }); }
  return { judul: "HPP operasional (harga berlaku)", pemisah: PEMISAH,
    peringatan: "Angka ini BUKAN nilai persediaan/jurnal Finance. Bila berbeda dari Nilai persediaan Finance, itu wajar: sumbernya berbeda (harga berlaku vs biaya perolehan PSA/GR).",
    ringkasan: { hppOperasionalDibekukan: Number(toMoney(nilai)), susutOperasional: Number(toMoney(susut)), pemakaianTanpaHargaOperasional: nTanpa, pemakaianBelumDibekukan: nBelum, pemakaianGagalPembekuan: nGagal, pratinjauPemakaianLama: Number(toMoney(pratinjauTambah)), pratinjauBelumMemakai: Number(toMoney(pratinjauAkan)) },
    status: nTanpa + nBelum + nGagal > 0 ? "PARSIAL" : mv.length ? "LENGKAP_MENURUT_HARGA_BERLAKU" : "BELUM_ADA_PEMAKAIAN", baris, belumMemakai };
}
