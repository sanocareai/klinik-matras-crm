// NILAI PERSEDIAAN (kandidat laporan baca-saja, Nov 2026). TIGA angka yang TIDAK pernah dicampur:
//   1. ESTIMASI NILAI STOK = saldo pada waktu acuan × Harga Berlaku pada waktu acuan yang SAMA (HPP operasional; harga kerja Gudang, BUKAN nilai buku).
//   2. SALDO AKUN PERSEDIAAN FINANCE = saldo akun sistem PERSEDIAAN_BAHAN (jurnal GR/PSA/pemakaian). Status "belum direkonsiliasi" selama masih ada sebabnya; TIDAK dialokasikan ke bahan.
//   3. BAHAN BELUM BISA DINILAI = pengecualian yang ditampilkan apa adanya — stok belum diketahui, harga kosong, satuan tidak cocok, saldo minus, pengamatan fisik. TIDAK PERNAH dijumlah sebagai Rp0.
// Modul ini hanya MEMBACA. Tidak menulis stok, harga, valuasi, jurnal, PSA, maupun GR. Nominal hanya untuk pemegang izin finance:read (diputuskan pemanggil: `bolehNominal`).
import { AWALAN_KUNCI_PO } from "./finance/hargaBerlaku.js";
import { klasifikasiSaldo, KEADAAN_SALDO, nolTerverifikasiPer } from "./keadaanSaldo.js";

export const STATUS = Object.freeze({
  DINILAI: "DINILAI", SALDO_NOL: "SALDO_NOL", STOK_BELUM_DIKETAHUI: "STOK_BELUM_DIKETAHUI", HARGA_KOSONG: "HARGA_KOSONG", SALDO_MINUS: "SALDO_MINUS", SATUAN_TIDAK_COCOK: "SATUAN_TIDAK_COCOK", PENGAMATAN_FISIK: "PENGAMATAN_FISIK",
});
export const LABEL_STATUS = Object.freeze({
  DINILAI: "Dinilai", SALDO_NOL: "Saldo nol", STOK_BELUM_DIKETAHUI: "Stok belum diketahui", HARGA_KOSONG: "Harga kosong", SALDO_MINUS: "Saldo minus", SATUAN_TIDAK_COCOK: "Satuan tidak cocok", PENGAMATAN_FISIK: "Pengamatan fisik",
});
/** Pengecualian = bahan RELEVAN yang belum bisa dinilai. Saldo nol bukan pengecualian (tidak ada yang perlu dinilai) tetapi tetap dihitung dan ditampilkan. */
export const STATUS_PENGECUALIAN = Object.freeze([STATUS.STOK_BELUM_DIKETAHUI, STATUS.HARGA_KOSONG, STATUS.SALDO_MINUS, STATUS.SATUAN_TIDAK_COCOK, STATUS.PENGAMATAN_FISIK]);
const URUT_RISIKO = Object.freeze({ DINILAI: 0, SALDO_MINUS: 1, SATUAN_TIDAK_COCOK: 2, HARGA_KOSONG: 3, PENGAMATAN_FISIK: 4, STOK_BELUM_DIKETAHUI: 5, SALDO_NOL: 6 });
export const KUNCI_PENGAMATAN = "nilai_persediaan_pengamatan_fisik"; // fin_settings: JSON [{ "kode": "KAIN-LAVA-B-GRADE", "teks": "13,5 ROLL" }]; dibaca saja, tidak ada jalur tulis di modul ini
export const DEFINISI = Object.freeze({
  estimasi: "Saldo stok pada waktu acuan × Harga Berlaku pada waktu acuan yang sama. Harga kerja Gudang (HPP operasional) — bukan nilai buku dan bukan nilai Finance.",
  finance: "Saldo akun Persediaan Bahan Baku di buku besar Finance (jurnal penerimaan GR, Persediaan Awal, pemakaian). Tidak dialokasikan ke bahan; status rekonsiliasi dijelaskan di bawah.",
  relevan: "Bahan aktif, atau nonaktif tetapi masih bersaldo ≠ 0 pada waktu acuan, KECUALI yang saldonya nol menurut catatan (tidak ada yang perlu dinilai). Bahan yang belum punya catatan stok TERMASUK relevan (stoknya belum diketahui).",
  waktu: "Satu waktu acuan dipakai untuk saldo (pergerakan ≤ waktu) dan Harga Berlaku (berlaku ≤ waktu). Harga yang dijadwalkan sesudah waktu itu tidak dipakai.",
});
const EPS = 1e-6; const r4 = (v) => Math.round(Number(v ?? 0) * 10000) / 10000;
const wibTgl = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Murni. Satu baris bahan → status + nilai. nilai = null untuk SEMUA yang bukan DINILAI/SALDO_NOL (tidak pernah Rp0 palsu). */
export function klasifikasiBaris({ bahan, saldo, jumlahPergerakan, nolTerverifikasi = false, harga = null, pengamatan = null }) {
  const keadaan = klasifikasiSaldo({ jumlahPergerakan, saldo, nolTerverifikasi });
  const dasar = { materialId: bahan.id, kode: bahan.code, nama: bahan.name, satuan: bahan.unit, kategori: bahan.category ?? null, aktif: bahan.active !== false, keadaanSaldo: keadaan, saldo: keadaan === KEADAAN_SALDO.BELUM_ADA_CATATAN ? null : r4(saldo), harga: harga ? { nilai: harga.harga, satuan: harga.satuan, berlakuSejak: harga.berlakuMulai, sumber: harga.sumber, labelBukti: harga.label } : null, nilai: null, pengamatan: pengamatan ?? null };
  if (pengamatan) return { ...dasar, status: STATUS.PENGAMATAN_FISIK, keterangan: `Pengamatan fisik: ${pengamatan}. Tidak dikonversi ke satuan stok dan tidak diberi nilai.` };
  if (keadaan === KEADAAN_SALDO.BELUM_ADA_CATATAN) return { ...dasar, status: STATUS.STOK_BELUM_DIKETAHUI, keterangan: "Belum ada catatan stok — saldo belum diketahui (bukan Rp0)." };
  if (keadaan === KEADAAN_SALDO.MINUS) return { ...dasar, status: STATUS.SALDO_MINUS, keterangan: `Saldo catatan minus (${r4(saldo)}) — tidak dinilai; perlu dihitung fisik.` };
  if (keadaan === KEADAAN_SALDO.NOL_MENURUT_PERGERAKAN || keadaan === KEADAAN_SALDO.NOL_TERVERIFIKASI) return { ...dasar, status: STATUS.SALDO_NOL, nilai: 0, keterangan: keadaan === KEADAAN_SALDO.NOL_TERVERIFIKASI ? "Nol terverifikasi hitung fisik." : "Nol menurut pergerakan." };
  if (!harga) return { ...dasar, status: STATUS.HARGA_KOSONG, keterangan: "Belum ada Harga Berlaku pada waktu acuan — tidak dinilai (bukan Rp0)." };
  if (String(harga.satuan ?? "").toUpperCase() !== String(bahan.unit ?? "").toUpperCase()) return { ...dasar, status: STATUS.SATUAN_TIDAK_COCOK, keterangan: `Satuan harga ${harga.satuan} ≠ satuan stok ${bahan.unit} — tidak dikonversi otomatis.` };
  return { ...dasar, status: STATUS.DINILAI, nilai: r4(saldo * harga.harga), keterangan: "" };
}

/** Murni. Cakupan dari daftar baris: universe, relevan, dinilai, pengecualian per status — SATU sumber untuk kartu & strip & tabel. */
export function ringkasCakupan(baris) {
  const per = {}; for (const b of baris) per[b.status] = (per[b.status] ?? 0) + 1;
  const dinilai = baris.filter((b) => b.status === STATUS.DINILAI); const saldoNol = per[STATUS.SALDO_NOL] ?? 0;
  const pengecualian = baris.filter((b) => STATUS_PENGECUALIAN.includes(b.status)); const relevan = dinilai.length + pengecualian.length;
  return { universe: baris.length, saldoNol, relevan, dinilai: dinilai.length, pengecualian: pengecualian.length, persenDinilai: relevan ? Math.round((dinilai.length / relevan) * 1000) / 10 : null, perStatus: per,
    dariPO: dinilai.filter((b) => b.harga?.sumber === "PO").length };
}
export const urutkanRisiko = (baris) => [...baris].sort((a, b) => URUT_RISIKO[a.status] - URUT_RISIKO[b.status] || (b.nilai ?? 0) - (a.nilai ?? 0) || String(a.kode).localeCompare(String(b.kode)));

function bacaPengamatan(mentah) {
  if (!mentah) return { peta: new Map(), valid: true };
  try { const a = JSON.parse(mentah); if (!Array.isArray(a)) return { peta: new Map(), valid: false };
    const peta = new Map(); for (const x of a) { const k = String(x?.kode ?? "").trim(), t = String(x?.teks ?? "").trim(); if (k && t) peta.set(k, t.slice(0, 120)); } return { peta, valid: true }; } catch { return { peta: new Map(), valid: false }; }
}

/** Harga Berlaku pada `at` untuk semua bahan: aturan SAMA dengan hargaBerlaku.js (abaikan baris yang digantikan koreksi; ambil effectiveFrom ≤ at yang terakhir). Sumber "PO" bila kunci idempotensi berawalan po-harga:. */
async function hargaPada(db, at) {
  const semua = await db.materialHargaBerlaku.findMany({ orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  const diganti = new Set(semua.map((x) => x.correctsId).filter(Boolean)); const peta = new Map(); const t = new Date(at);
  for (const x of semua) { if (diganti.has(x.id) || new Date(x.effectiveFrom) > t) continue; peta.set(x.materialId, { harga: Number(x.unitPrice), satuan: x.satuan, berlakuMulai: x.effectiveFrom, sumber: String(x.idempotencyKey ?? "").startsWith(AWALAN_KUNCI_PO) ? "PO" : x.jenis === "KOREKSI" ? "KOREKSI" : "MANUAL", label: String(x.evidenceNote ?? "").trim() ? "ADA_CATATAN_BUKTI" : "BELUM_DIDUKUNG_BUKTI" }); }
  return peta;
}

/** Blok Finance: saldo akun persediaan + penyebab "belum direkonsiliasi" + bukti harga penerimaan (rincian, TIDAK mengalokasikan saldo akun ke bahan). */
async function blokFinance(db, { at, saldoPerBahan, bolehNominal }) {
  const tgl = wibTgl(at);
  const akun = (await db.$queryRaw`SELECT id, code, name FROM fin_accounts WHERE system_key = 'PERSEDIAAN_BAHAN' LIMIT 1`)[0] ?? null;
  const dasar = { akun: akun ? { kode: akun.code, nama: akun.name } : null, tanggalBuku: tgl };
  if (!akun) return { ...dasar, tersedia: false, status: "BELUM_DIREKONSILIASI", alasan: ["Akun sistem PERSEDIAAN_BAHAN belum disiapkan di Bagan Akun."], saldo: null, perSumber: [], jurnal: 0 };
  const [{ n: jurnalDicek }] = await db.$queryRaw`SELECT COUNT(DISTINCT e.id)::int AS n FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id = l.entry_id WHERE l.account_id = ${akun.id}::uuid AND e.status::text IN ('POSTED','REVERSED') AND e.date <= ${tgl}::date`;
  const perSumber = await db.$queryRaw`SELECT e.source::text AS sumber, COUNT(DISTINCT e.id)::int AS jurnal, COALESCE(SUM(l.debit),0)::float AS debit, COALESCE(SUM(l.credit),0)::float AS kredit, MIN(e.date)::text AS awal, MAX(e.date)::text AS akhir
    FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id = l.entry_id WHERE l.account_id = ${akun.id}::uuid AND e.status::text IN ('POSTED','REVERSED') AND e.date <= ${tgl}::date GROUP BY e.source ORDER BY e.source`;
  const saldo = Math.round(perSumber.reduce((a, r) => a + r.debit - r.kredit, 0) * 100) / 100;
  const opening = (await db.$queryRaw`SELECT number, status, cutover_date::text AS cutover FROM fin_inventory_openings ORDER BY created_at DESC LIMIT 1`)[0] ?? null;
  const posted = (await db.$queryRaw`SELECT COUNT(*)::int AS n FROM fin_inventory_openings WHERE status = 'DIPOSTING'`)[0].n > 0;
  const gaps = await db.$queryRaw`SELECT source::text AS sumber, reason AS alasan, COUNT(*)::int AS n FROM fin_posting_gaps WHERE resolved_at IS NULL AND source::text IN ('PEMAKAIAN_BAHAN','PENERIMAAN_BAHAN') GROUP BY 1,2 ORDER BY 1,2`;
  const rc = await db.$queryRaw`SELECT material_id::text AS id, COALESCE(SUM(qty),0)::float AS qty, COALESCE(SUM(qty * COALESCE(unit_cost_exact, unit_cost::numeric)),0)::float AS nilai, COUNT(DISTINCT goods_receipt_id)::int AS gr
    FROM stock_movements WHERE type::text = 'RECEIPT' AND qty > 0 AND COALESCE(unit_cost_exact, unit_cost::numeric) > 0 AND created_at <= ${at} GROUP BY material_id`;
  const buktiPer = new Map(rc.map((r) => [r.id, r])); const totalBukti = Math.round(rc.reduce((a, r) => a + r.nilai, 0) * 100) / 100;
  let tanpaBukti = 0, sebagian = 0, berbukti = 0; const rincian = [];
  for (const [id, s] of saldoPerBahan) { if (s.saldo <= EPS) continue; const b = buktiPer.get(id); const qb = b ? Math.min(s.saldo, b.qty) : 0; if (!b) tanpaBukti++; else if (qb + EPS < s.saldo) sebagian++; else berbukti++;
    rincian.push({ materialId: id, kode: s.kode, nama: s.nama, satuan: s.satuan, saldo: r4(s.saldo), qtyPenerimaanBerharga: b ? r4(b.qty) : 0, jumlahGR: b?.gr ?? 0, biayaRata2: b && b.qty > 0 && bolehNominal ? Math.round((b.nilai / b.qty) * 10000) / 10000 : null, qtyBerbukti: r4(qb), qtyTanpaBukti: r4(Math.max(s.saldo - qb, 0)), hargaBerlaku: bolehNominal ? s.hargaBerlaku ?? null : null }); }
  const alasan = [];
  if (!posted) alasan.push(`Persediaan Awal belum diposting${opening ? ` (${opening.number}: ${opening.status})` : ""} — saldo buku sebelum cutover belum dijembatani.`);
  for (const g of gaps) alasan.push(`${g.n} jurnal tertahan (${g.sumber}: ${g.alasan}).`);
  if (tanpaBukti + sebagian > 0) alasan.push(`${tanpaBukti} bahan bersaldo tanpa bukti harga penerimaan dan ${sebagian} sebagian — nilai bukunya tidak bisa dipastikan per bahan.`);
  const selisihBukti = Math.round((saldo - totalBukti) * 100) / 100; if (Math.abs(selisihBukti) > 1) alasan.push(`Saldo akun berbeda Rp${Math.abs(selisihBukti).toLocaleString("id-ID")} dari jumlah biaya penerimaan berharga di ledger stok.`);
  alasan.push("Saldo akun tidak dialokasikan ke bahan; rekonsiliasi per bahan belum tersedia.");
  const kosongNominal = !bolehNominal;
  return { ...dasar, tersedia: true, status: "BELUM_DIREKONSILIASI", alasan, saldo: kosongNominal ? null : saldo, jurnal: jurnalDicek,
    perSumber: kosongNominal ? perSumber.map((r) => ({ sumber: r.sumber, jurnal: r.jurnal, awal: r.awal, akhir: r.akhir })) : perSumber,
    persediaanAwal: opening ? { nomor: opening.number, status: opening.status, cutover: opening.cutover } : null, persediaanAwalDiposting: posted, gapTertahan: gaps, pembandingLedger: kosongNominal ? null : { totalBiayaPenerimaanBerharga: totalBukti, selisihDenganSaldoAkun: selisihBukti },
    bukti: { bahanBerstok: tanpaBukti + sebagian + berbukti, berbukti, sebagian, tanpaBukti, catatan: "Rincian bukti per bahan. Harga Berlaku (jika ada) BUKAN bukti perolehan Finance.", rincian: rincian.sort((a, b) => b.qtyTanpaBukti - a.qtyTanpaBukti || a.kode.localeCompare(b.kode)) } };
}

/**
 * Laporan nilai persediaan pada SATU waktu acuan (default: sekarang). BACA-SAJA.
 * @param opsi.waktu  Date acuan untuk saldo DAN Harga Berlaku (tidak boleh di masa depan)
 * @param opsi.bolehNominal  false ⇒ semua nominal (harga, nilai, saldo akun, biaya rata-rata) dihilangkan; status & jumlah tetap tampil
 */
export async function hitungNilaiPersediaan(db, { waktu = new Date(), bolehNominal = false } = {}) {
  const at = new Date(waktu); const sekarang = new Date();
  const bahan = await db.material.findMany({ select: { id: true, code: true, name: true, unit: true, category: true, active: true }, orderBy: { code: "asc" } });
  const agr = await db.stockMovement.groupBy({ by: ["materialId"], where: { createdAt: { lte: at } }, _sum: { qty: true }, _count: { _all: true } });
  const ledger = new Map(agr.map((g) => [g.materialId, { saldo: r4(g._sum.qty ?? 0), n: g._count._all }]));
  const hargaPeta = await hargaPada(db, at);
  const penggunaanSekarang = sekarang.getTime() - at.getTime() < 60_000; // verifikasi nol memakai keadaan SEKARANG; untuk waktu lampau tidak diterapkan (tidak ada bukti as-of)
  const nolVer = penggunaanSekarang ? await nolTerverifikasiPer(db) : new Map();
  const setelan = await db.finSetting.findUnique({ where: { key: KUNCI_PENGAMATAN } }); const { peta: pengamatan, valid: pengamatanValid } = bacaPengamatan(setelan?.value);
  const baris = []; const saldoPerBahan = new Map();
  for (const m of bahan) {
    const l = ledger.get(m.id) ?? { saldo: 0, n: 0 }; if (!m.active && Math.abs(l.saldo) <= EPS) continue; // nonaktif tanpa saldo: di luar universe
    const h = hargaPeta.get(m.id) ?? null; const b = klasifikasiBaris({ bahan: m, saldo: l.saldo, jumlahPergerakan: l.n, nolTerverifikasi: nolVer.has(m.id), harga: h, pengamatan: pengamatan.get(m.code) ?? null });
    baris.push(b); saldoPerBahan.set(m.id, { saldo: l.saldo, kode: m.code, nama: m.name, satuan: m.unit, hargaBerlaku: h ? h.harga : null });
  }
  const cakupan = ringkasCakupan(baris); const dinilai = baris.filter((b) => b.status === STATUS.DINILAI);
  const total = Math.round(dinilai.reduce((a, b) => a + b.nilai, 0));
  const finance = await blokFinance(db, { at, saldoPerBahan, bolehNominal });
  const tampilBaris = urutkanRisiko(baris).map((b) => (bolehNominal ? b : { ...b, harga: null, nilai: b.status === STATUS.SALDO_NOL ? 0 : null }));
  return {
    waktuAcuan: at.toISOString(), waktuHitung: sekarang.toISOString(), definisi: DEFINISI, izin: { nominal: !!bolehNominal },
    kartu: {
      estimasi: { nilai: bolehNominal ? total : null, bahanDinilai: cakupan.dinilai, bahanRelevan: cakupan.relevan, persen: cakupan.persenDinilai, dariPO: cakupan.dariPO, label: "Estimasi nilai stok", catatan: "Harga kerja Gudang — bukan nilai buku." },
      finance: { saldo: finance.saldo, status: finance.status, alasan: finance.alasan, label: "Saldo akun persediaan Finance", catatan: "Belum direkonsiliasi dengan stok per bahan." },
      belumDinilai: { jumlah: cakupan.pengecualian, perStatus: Object.fromEntries(STATUS_PENGECUALIAN.map((s) => [s, cakupan.perStatus[s] ?? 0])), label: "Bahan belum bisa dinilai", catatan: "Tidak dihitung sebagai Rp0." },
    },
    cakupan, finance, baris: tampilBaris, pengamatanSetelanValid: pengamatanValid, pengamatanTerisi: pengamatan.size,
  };
}
