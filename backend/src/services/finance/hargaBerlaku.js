// HARGA BERLAKU BAHAN = HPP OPERASIONAL (Okt 2026). Harga per SATUAN STOK dengan waktu mulai berlaku, diedit dari layar Stok.
//
// PEMISAHAN (jangan dilanggar, jangan ditampilkan seolah sama):
//   • HPP OPERASIONAL (file ini)  = harga berlaku × pemakaian. BUKAN nilai buku, BUKAN HPP final Finance. Bukti supplier/kedatangan boleh belum ada → label "Belum didukung bukti".
//   • NILAI PERSEDIAAN/JURNAL FINANCE = biaya perolehan Persediaan Awal/GR (fin_stock_movement_valuations, nilaiResmi.js, penetapanNilai.js). Tidak disentuh di sini.
// Aturan waktu: dasar harga = WAKTU PEMAKAIAN AKTUAL (stock_movements.created_at), bukan tanggal order dibuat. Harga baru berlaku untuk pemakaian sejak waktu efektif; pemakaian yang sudah dibekukan tidak berubah.
// Dibekukan saat pemakaian diposting (catatBiayaOperasional, transaksi yang sama dengan pergerakan stok). Koreksi salah input = baris KOREKSI baru (baris lama tetap); pemakaian lama baru diberi/diselaraskan harganya lewat
// tindakan khusus berpengaju+penyetuju (penerapan), tidak pernah otomatis. Tidak menulis stok, ISSUE, catatan, valuasi Finance, jurnal, maupun GL.
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
export const KELOMPOK_PENERAPAN = Object.freeze({ BELUM_DIBEKUKAN: "Pemakaian lama belum dibekukan harga operasionalnya", TANPA_HARGA_BERLAKU: "Dibekukan tanpa harga berlaku (saat itu belum ada harga)", SELARAS_ULANG: "Harga beku berbeda dari harga berlaku pada waktu pemakaian (mis. setelah koreksi)" });
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
           count(*) filter (where created_at >= $3 and st = 'TANPA_HARGA')::int beku_tanpa_harga_sejak, count(*) filter (where st is null)::int belum_dibekukan, count(*) filter (where st is null and created_at >= $3)::int belum_dibekukan_sejak,
           count(distinct unit_id) filter (where st is null or st = 'TANPA_HARGA')::int unit_tanpa_harga_op from m`, materialId, TIPE_OP, mulai))[0];
  return { akanMemakai: { unit: belumMemakai.unit, order: belumMemakai.ord, ket: "Order yang belum memakai bahan ini (Material Issue belum keluar / catatan siap posting): akan dibekukan dengan harga yang berlaku pada waktu pemakaian aktual." },
    sudahDibekukanSejakMulai: { pemakaian: dipakai.beku_sejak, nilai: dipakai.nilai_beku_sejak, ket: "Pemakaian sejak waktu berlaku yang SUDAH dibekukan — TIDAK berubah karena harga baru." },
    sudahDibekukanTanpaHargaSejakMulai: dipakai.beku_tanpa_harga_sejak, belumDibekukan: { pemakaian: dipakai.belum_dibekukan, sejakMulai: dipakai.belum_dibekukan_sejak, unit: dipakai.unit_tanpa_harga_op, ket: "Pemakaian lama yang belum punya harga operasional: hanya diberi harga lewat tindakan khusus berpersetujuan, tidak otomatis." } };
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
    dampak, jumlahRiwayat: semua.length, penerapanAktif: aktifApp,
  };
}

// ── pratinjau & simpan ──────────────────────────────────────────────────────────────────────────────

function bacaMasukan(m, bahan, { koreksi }) {
  let harga; try { harga = new Decimal(String(m.hargaBaru ?? "").replace(/\s/g, "")); } catch { harga = null; }
  wajib(harga && harga.isFinite() && harga.greaterThan(0), "Harga baru wajib angka lebih dari 0 (bukan Rp0)", "HARGA_TIDAK_VALID");
  wajib(harga.decimalPlaces() <= 4, "Harga maksimal 4 desimal — tidak dibulatkan diam-diam", "HARGA_DESIMAL_BERLEBIH");
  wajib(harga.lessThan("1000000000"), "Harga tidak masuk akal (≥ Rp1 miliar per satuan)", "HARGA_TIDAK_MASUK_AKAL");
  const sat = String(m.satuan ?? "").trim().toUpperCase();
  wajib(sat === String(bahan.unit).toUpperCase(), `Satuan harus ${bahan.unit} (satuan stok bahan ini); harga dalam satuan lain (mis. per pak/roll) harus dikonversi dulu — jangan dicampur`, "SATUAN_BEDA", 422);
  const mulai = new Date(m.berlakuMulai); wajib(!Number.isNaN(mulai.getTime()), "Waktu mulai berlaku tidak valid", "WAKTU_TIDAK_VALID");
  wajib(mulai.getFullYear() >= 2025 && mulai.getTime() <= Date.now() + 366 * 86400_000, "Waktu mulai berlaku di luar rentang wajar (maks 1 tahun ke depan)", "WAKTU_TIDAK_WAJAR");
  const alasan = String(m.alasan ?? "").trim(); wajib(alasan.length >= 5 && alasan.length <= 500, "Alasan wajib diisi (5–500 karakter)", "ALASAN_WAJIB");
  const catatan = String(m.catatan ?? "").trim().slice(0, 500) || null; const bukti = String(m.catatanBukti ?? "").trim().slice(0, 500) || null;
  return { harga: harga.toDecimalPlaces(4), mulai, alasan, catatan, bukti, jenis: koreksi ? "KOREKSI" : "HARGA" };
}

/** Pratinjau SEBELUM simpan (baca-saja). koreksiId bila memperbaiki baris yang salah input. */
export async function pratinjauUbahHarga(db, masukan = {}, { lengkap = true } = {}) {
  const materialId = masukan.materialId;
  const bahan = await db.material.findUnique({ where: { id: String(materialId ?? "") }, select: { id: true, code: true, name: true, unit: true, referenceUnitCost: true } }); wajib(bahan, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const koreksiId = masukan.koreksiId ? String(masukan.koreksiId) : null; const { aktif, semua, diganti } = await barisAktif(db, bahan.id);
  let sasaran = null; if (koreksiId) { sasaran = semua.find((x) => x.id === koreksiId); wajib(sasaran, "Baris harga yang dikoreksi tidak ditemukan pada bahan ini", "BARIS_TIDAK_ADA", 404); wajib(!diganti.has(sasaran.id), "Baris ini sudah digantikan koreksi lain — koreksi baris terbarunya", "SUDAH_DIKOREKSI", 409); }
  const m = bacaMasukan(masukan, bahan, { koreksi: !!koreksiId });
  const dasar = koreksiId ? aktif.filter((x) => x.id !== koreksiId) : aktif;
  const sebelum = pilih(dasar, m.mulai); const terbaru = semua[semua.length - 1] ?? null; const sekarang = new Date();
  const berlakuSekarangLama = pilih(aktif, sekarang);
  const hargaLama = sebelum ? D(sebelum.unitPrice) : null;
  const selisihPersen = hargaLama && hargaLama.greaterThan(0) ? Number(m.harga.minus(hargaLama).dividedBy(hargaLama).times(100).toDecimalPlaces(1)) : null;
  const peringatan = [];
  if (m.mulai < new Date(sekarang.getTime() - 60_000)) peringatan.push({ kode: "WAKTU_LAMPAU", pesan: "Waktu berlaku di masa lalu: pemakaian yang SUDAH dibekukan tidak berubah; hanya pemakaian yang belum dibekukan dan penerapan khusus yang memakai harga ini." });
  if (selisihPersen != null && Math.abs(selisihPersen) >= 30) peringatan.push({ kode: "SELISIH_BESAR", pesan: `Harga berubah ${selisihPersen > 0 ? "naik" : "turun"} ${Math.abs(selisihPersen)}% dari harga sebelumnya — periksa satuan (${bahan.unit}) dan angka nol.` });
  if (bahan.referenceUnitCost && (m.harga.dividedBy(D(bahan.referenceUnitCost)).greaterThan(5) || m.harga.times(5).lessThan(D(bahan.referenceUnitCost)))) peringatan.push({ kode: "JAUH_DARI_REFERENSI", pesan: "Harga lebih dari 5× atau kurang dari 1/5 harga referensi Agustus (pembanding) — pastikan satuan benar." });
  if (!m.bukti) peringatan.push({ kode: "BELUM_ADA_BUKTI", pesan: "Tanpa catatan bukti: harga ini tersimpan dengan label “Belum didukung bukti”. Boleh, tetapi bukan nilai buku dan bukan HPP final Finance." });
  let terkoreksi = null;
  if (sasaran) { const dipakai = (await db.$queryRawUnsafe(`select count(*)::int n, coalesce(sum(value),0)::float v from (select distinct on (movement_id) movement_id, status, value, price_id from stock_movement_biaya_operasional order by movement_id, created_at desc, id desc) t where price_id = $1::uuid and status = 'DINILAI'`, sasaran.id))[0];
    terkoreksi = { baris: tampilBaris(sasaran, { diganti, aktifId: null, sekarang }), pemakaianSudahDibekukanDenganHargaIni: dipakai.n, nilai: dipakai.v, ket: dipakai.n ? "Pemakaian itu TIDAK diubah diam-diam; perbaikannya lewat Penerapan khusus (dua orang) setelah koreksi ini disimpan." : "Belum ada pemakaian yang dibekukan dengan harga salah ini." }; }
  const hasil = {
    bahan: { id: bahan.id, kode: bahan.code, nama: bahan.name, satuan: bahan.unit }, jenis: m.jenis,
    hargaLama: hargaLama == null ? null : Number(hargaLama), hargaBaru: Number(m.harga), selisihPersen, berlakuMulai: m.mulai.toISOString(), satuan: bahan.unit, alasan: m.alasan, catatan: m.catatan, catatanBukti: m.bukti,
    labelBukti: m.bukti ? "ADA_CATATAN_BUKTI" : "BELUM_DIDUKUNG_BUKTI", teksLabelBukti: LABEL_BUKTI[m.bukti ? "ADA_CATATAN_BUKTI" : "BELUM_DIDUKUNG_BUKTI"],
    hargaBerlakuSekarangSebelumUbah: berlakuSekarangLama ? Number(berlakuSekarangLama.unitPrice) : null, terkoreksi, peringatan, pemisah: PEMISAH,
    aturan: "Harga baru berlaku untuk pemakaian aktual sejak waktu berlaku. Pemakaian yang sudah dibekukan tidak berubah. Order yang belum memakai bahan menampilkan pratinjau harga terbaru dan dibekukan saat pemakaian diposting.",
  };
  hasil.hash = sha({ m: bahan.id, h: m.harga.toString(), t: m.mulai.toISOString(), s: bahan.unit, j: m.jenis, k: koreksiId, lama: sebelum?.id ?? null, terbaru: terbaru?.id ?? null });
  if (lengkap) hasil.dampak = await hitungDampak(db, bahan.id, m.mulai);
  hasil._simpan = { materialId: bahan.id, m, koreksiId, sebelumId: sebelum?.id ?? null, hargaLama, satuan: bahan.unit };
  return hasil;
}
export const tanpaInternal = ({ _simpan, ...x }) => x;

const tampilSimpan = (b) => ({ id: b.id, jenis: b.jenis, bahanId: b.materialId, harga: Number(b.unitPrice), satuan: b.satuan, berlakuMulai: b.effectiveFrom, hargaLama: b.previousPrice == null ? null : Number(b.previousPrice), alasan: b.reason, labelBukti: labelDari(b), teksLabelBukti: LABEL_BUKTI[labelDari(b)], dibuatOleh: b.createdById, dibuatPada: b.createdAt });

/** Simpan Harga Berlaku baru / koreksi salah input. Idempoten (Idempotency-Key), hash pratinjau wajib sama, append-only. */
export async function simpanHarga(prisma, masukan, { aktor, kunci }) {
  const idem = kunciValid(kunci); wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB");
  const ada = await prisma.materialHargaBerlaku.findUnique({ where: { idempotencyKey: idem } });
  if (ada) { wajib(ada.materialId === masukan.materialId, "Idempotency-Key ini sudah dipakai untuk bahan lain", "KUNCI_DIPAKAI_LAIN", 409); return { ulang: true, ...tampilSimpan(ada) }; }
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "materials", String(masukan.materialId ?? ""));
    const dupl = await tx.materialHargaBerlaku.findUnique({ where: { idempotencyKey: idem } }); if (dupl) return { ulang: true, ...tampilSimpan(dupl) };
    const pra = await pratinjauUbahHarga(tx, masukan, { lengkap: false });
    wajib(String(masukan.hashPratinjau ?? "") === pra.hash, "Pratinjau yang Anda lihat sudah berbeda dari keadaan sekarang (harga lain disimpan, atau isian berubah). Muat ulang pratinjau lalu simpan lagi.", "PRATINJAU_BERUBAH", 409);
    const { m, koreksiId, hargaLama } = pra._simpan;
    const b = await tx.materialHargaBerlaku.create({ data: { materialId: pra._simpan.materialId, jenis: m.jenis, unitPrice: m.harga.toString(), satuan: pra._simpan.satuan, effectiveFrom: m.mulai, previousPrice: hargaLama == null ? null : hargaLama.toString(), correctsId: koreksiId, reason: m.alasan, note: m.catatan, evidenceNote: m.bukti, createdById: aktor.id, idempotencyKey: idem } });
    return { ulang: false, ...tampilSimpan(b) };
  }, { timeout: 30_000, maxWait: 10_000 });
}

// ── pembekuan saat pemakaian diposting ──────────────────────────────────────────────────────────────

/** Dipanggil postStockMovement (transaksi yang sama). Membekukan HARGA BERLAKU pada WAKTU PEMAKAIAN; tidak pernah menggagalkan perintah Gudang; tidak menulis stok/jurnal/valuasi Finance. */
export async function catatBiayaOperasional(tx, mov) {
  if (!mov?.unitId || !JENIS_BIAYA_OP[mov.type]) return null;
  if (typeof tx?.$executeRawUnsafe !== "function" || !tx?.stockMovementBiayaOperasional) return null;
  await tx.$executeRawUnsafe("SAVEPOINT sp_biaya_operasional");
  try {
    const qty = D(mov.qty); const at = mov.createdAt ? new Date(mov.createdAt) : new Date(); const h = await hargaBerlakuPada(tx, mov.materialId, at);
    const data = h
      ? { status: "DINILAI", unitCost: h.harga.toString(), value: (qty.isNegative() ? toMoney(qty.abs().times(h.harga)) : toMoney(qty.abs().times(h.harga)).negated()).toString(), priceId: h.baris.id, priceEffectiveFrom: h.baris.effectiveFrom, evidenceLabel: h.label }
      : { status: "TANPA_HARGA", unitCost: null, value: null, priceId: null, priceEffectiveFrom: null, evidenceLabel: null };
    const baris = await tx.stockMovementBiayaOperasional.create({ data: { movementId: mov.id, materialId: mov.materialId, unitId: mov.unitId, qty: qty.toString(), sumber: "BEKU_SAAT_POSTING", createdById: mov.createdById ?? null, ...data } });
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT sp_biaya_operasional");
    return baris;
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sp_biaya_operasional"); await tx.$executeRawUnsafe("RELEASE SAVEPOINT sp_biaya_operasional");
    console.error("[harga-berlaku] pembekuan biaya operasional gagal (perintah Gudang tetap berjalan):", mov.id, e?.message);
    return null;
  }
}

// ── tindakan khusus: memberi/menyelaraskan harga berlaku pada pemakaian LAMA ────────────────────────

const bacaGrup = (g) => { const x = Array.isArray(g) && g.length ? [...new Set(g)] : ["BELUM_DIBEKUKAN", "TANPA_HARGA_BERLAKU"]; wajib(x.every((k) => Object.hasOwn(KELOMPOK_PENERAPAN, k)), "Kelompok tidak dikenal", "KELOMPOK_TIDAK_VALID"); return x.sort(); };

export async function pratinjauPenerapan(db, { materialId, groups, movementIds = null, dari = null, sampai = null } = {}, { lengkap = true } = {}) {
  const grup = bacaGrup(groups); const bahan = await db.material.findUnique({ where: { id: String(materialId ?? "") }, select: { id: true, code: true, name: true, unit: true } }); wajib(bahan, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const pilihId = Array.isArray(movementIds) && movementIds.length ? new Set(movementIds.map(String)) : null;
  const d0 = dari ? new Date(dari) : null; const d1 = sampai ? new Date(sampai) : null; wajib(!(d0 && Number.isNaN(d0.getTime())) && !(d1 && Number.isNaN(d1.getTime())), "Rentang tanggal tidak valid", "RENTANG_TIDAK_VALID");
  const selesai = penyelesaiHargaBerlaku(db);
  const mv = await db.stockMovement.findMany({ where: { materialId: bahan.id, unitId: { not: null }, type: { in: TIPE_OP }, ...(d0 || d1 ? { createdAt: { ...(d0 ? { gte: d0 } : {}), ...(d1 ? { lte: d1 } : {}) } } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, type: true, qty: true, createdAt: true, unitId: true, unit: { select: { unitCode: true, order: { select: { orderNumber: true } } } }, biayaOperasional: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } });
  const terapkan = []; const gap = []; let sudahSelaras = 0; const hitung = { BELUM_DIBEKUKAN: 0, TANPA_HARGA_BERLAKU: 0, SELARAS_ULANG: 0 };
  for (const p of mv) {
    const terakhir = p.biayaOperasional[0] ?? null; const h = await selesai(bahan.id, p.createdAt); const qty = D(p.qty);
    const dasar = { movementId: p.id, tanggal: wibTgl(p.createdAt), waktu: p.createdAt, order: p.unit?.order?.orderNumber ?? null, unit: p.unit?.unitCode ?? null, unitId: p.unitId, tipe: p.type, qty: Number(qty), satuan: bahan.unit };
    let kel;
    if (!terakhir) kel = "BELUM_DIBEKUKAN"; else if (terakhir.status === "TANPA_HARGA") kel = "TANPA_HARGA_BERLAKU";
    else if (!h) { gap.push({ ...dasar, gap: "HARGA_BERLAKU_HILANG", ket: "Harga beku ada tetapi tidak ada harga berlaku pada waktu itu (setelah koreksi) — tinjau manual", nilaiSekarang: Number(terakhir.value) }); continue; }
    else if (D(terakhir.unitCost).equals(h.harga)) { sudahSelaras++; continue; } else kel = "SELARAS_ULANG";
    hitung[kel]++; if (!grup.includes(kel)) continue; if (pilihId && !pilihId.has(p.id)) continue;
    if (!h) { gap.push({ ...dasar, kelompok: kel, gap: "BELUM_ADA_HARGA_PADA_WAKTU_PEMAKAIAN", ket: "Belum ada harga berlaku pada waktu pemakaian ini — tidak diberi harga rekaan" }); continue; }
    const mutlak = toMoney(qty.abs().times(h.harga)); const nilai = qty.isNegative() ? mutlak : mutlak.negated();
    terapkan.push({ ...dasar, kelompok: kel, harga: h.harga, nilaiBaru: Number(nilai), nilaiSebelum: terakhir?.value == null ? null : Number(terakhir.value), priceId: h.baris.id, priceEffectiveFrom: h.baris.effectiveFrom, label: h.label, hargaBeku: terakhir?.unitCost == null ? null : Number(terakhir.unitCost) });
  }
  const total = terapkan.reduce((a, x) => a.plus(x.nilaiBaru), D(0));
  const hasil = { bahan: { id: bahan.id, kode: bahan.code, nama: bahan.name, satuan: bahan.unit }, kelompokDipilih: grup, tersedia: hitung, sudahSelaras,
    penerapan: { jumlah: terapkan.length, nilai: Number(toMoney(total)), baris: terapkan.map(({ harga, priceId, priceEffectiveFrom, waktu, ...x }) => ({ ...x, harga: Number(harga), hargaBerlakuMulai: priceEffectiveFrom })) },
    gap: { jumlah: gap.length, baris: gap, catatan: "Tanpa harga berlaku pada waktu pemakaian → tetap tanpa harga operasional (tidak ada harga rekaan)." }, pemisah: PEMISAH,
    aturan: "Penerapan = baris biaya operasional BARU yang disetujui orang lain; tidak mengubah stok, ISSUE, catatan, valuasi/jurnal Finance, atau GL; tidak otomatis untuk semua order lama." };
  hasil.hash = sha({ b: bahan.id, g: grup, rows: terapkan.map((x) => [x.movementId, x.harga.toString(), x.priceId]) });
  hasil._terapkan = terapkan; hasil._scope = { groups: grup, movementIds: pilihId ? [...pilihId].sort() : null, dari: d0?.toISOString() ?? null, sampai: d1?.toISOString() ?? null };
  if (!lengkap) return hasil;
  const unitIds = [...new Set(terapkan.map((x) => x.unitId))];
  hasil.perOrder = unitIds.length ? (await db.$queryRawUnsafe(`select o."orderNumber" "order", u.unit_code unit, u.id::text "unitId", coalesce(sum(x.val) filter (where x.st = 'DINILAI' and s.type::text <> 'WASTE'),0)::float sebelum, count(*) filter (where x.st is null or x.st = 'TANPA_HARGA')::int tanpa_harga_op
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
    for (const x of pra._terapkan) await tx.stockMovementBiayaOperasional.create({ data: { movementId: x.movementId, materialId: b.materialId, unitId: x.unitId, status: "DINILAI", qty: String(x.qty), unitCost: x.harga.toString(), value: String(x.nilaiBaru), priceId: x.priceId, priceEffectiveFrom: x.priceEffectiveFrom, evidenceLabel: x.label, sumber: "PENERAPAN_DISETUJUI", applicationId: b.id, createdById: aktor.id } });
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
    select: { id: true, type: true, qty: true, createdAt: true, materialId: true, material: { select: { code: true, name: true, unit: true } }, biayaOperasional: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } });
  const selesai = penyelesaiHargaBerlaku(db); const sekarang = new Date();
  const baris = []; let nilai = D(0); let susut = D(0); let pratinjauTambah = D(0); let nTanpa = 0; let nBelum = 0;
  for (const m of mv) {
    const o = m.biayaOperasional[0] ?? null; const qty = D(m.qty); const jenis = JENIS_BIAYA_OP[m.type];
    let status; let harga = null; let nilaiB = null; let label = null; let pratinjau = null; let sumber = null; let mulai = null;
    if (o?.status === "DINILAI") { status = "DIBEKUKAN"; harga = Number(o.unitCost); nilaiB = Number(o.value); label = o.evidenceLabel; sumber = o.sumber; mulai = o.priceEffectiveFrom; if (m.type === "WASTE") susut = susut.plus(o.value); else nilai = nilai.plus(o.value); }
    else {
      status = o ? "DIBEKUKAN_TANPA_HARGA_BERLAKU" : "BELUM_DIBEKUKAN"; if (o) nTanpa++; else nBelum++;
      const h = await selesai(m.materialId, m.createdAt);
      if (h) { const mutlak = toMoney(qty.abs().times(h.harga)); const v = qty.isNegative() ? mutlak : mutlak.negated(); pratinjau = { harga: Number(h.harga), nilai: Number(v), label: h.label, ket: "Pratinjau pada harga berlaku saat pemakaian — belum dibekukan; diberi harga hanya lewat penerapan khusus." }; if (m.type !== "WASTE") pratinjauTambah = pratinjauTambah.plus(v); }
    }
    baris.push({ movementId: m.id, tanggal: m.createdAt, jenisBiaya: jenis, tipe: m.type, kode: m.material.code, nama: m.material.name, satuan: m.material.unit, qty: Number(qty), status, harga, nilai: nilaiB, labelBukti: label, teksLabelBukti: label ? LABEL_BUKTI[label] : null, sumber, hargaBerlakuMulai: mulai, pratinjau });
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
    ringkasan: { hppOperasionalDibekukan: Number(toMoney(nilai)), susutOperasional: Number(toMoney(susut)), pemakaianTanpaHargaOperasional: nTanpa, pemakaianBelumDibekukan: nBelum, pratinjauPemakaianLama: Number(toMoney(pratinjauTambah)), pratinjauBelumMemakai: Number(toMoney(pratinjauAkan)) },
    status: nTanpa + nBelum > 0 ? "PARSIAL" : mv.length ? "LENGKAP_MENURUT_HARGA_BERLAKU" : "BELUM_ADA_PEMAKAIAN", baris, belumMemakai };
}
