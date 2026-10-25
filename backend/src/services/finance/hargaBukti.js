// HARGA BUKTI BAHAN (Okt 2026) — melengkapi nilai pemakaian bahan yang berstatus TANPA_HARGA / belum dibekukan, dengan harga yang DIDUKUNG BUKTI dan periode berlaku yang eksplisit.
//
// PRINSIP (jangan dilanggar):
//   1. Harga TIDAK PERNAH otomatis: bukan Material.referenceUnitCost (snapshot Agustus), bukan harga penerimaan terakhir/hari ini. Keduanya hanya PEMBANDING di pratinjau. Harga bukti hanya menyentuh pergerakan yang
//      (a) tanggalnya (WIB) jatuh pada periode berlaku, dan (b) memang belum punya harga perolehan.
//   2. TIDAK menulis stok (ISSUE/RETURN tidak dibuat/diubah), TIDAK mengubah catatan pemakaian historis, TIDAK membuat jurnal, TIDAK mengubah valuasi beku asli. Satu-satunya tulisan nilai = baris baru append-only di
//      fin_stock_movement_valuation_corrections (sebelum–sesudah, pelaku, waktu, tautan harga bukti); nilai efektif = koreksi terbaru (mekanisme koreksi harga yang sudah ada).
//   3. Dua orang: pengaju (finance:post) ≠ penyetuju (finance:approve). Penyetuju menyetujui PRATINJAU persis (hash); bila pergerakan/saldo/harga bergeser sebelum disetujui → ditolak 409, bukan diterapkan basi.
//   4. Idempoten: kunci pengajuan; kunci per pergerakan (HB:<bukti>:<pergerakan>); klik ulang/serentak = satu penerapan.
//   5. TENTATIF jujur: harga bukti bersertifikat TENTATIF menandai tiap baris koreksi (tentative=true) → jejak biaya menampilkannya sebagai "tentatif", memisahkannya dari nilai yang didukung bukti, dan tetap BELUM_FINAL.
//      Penggantian (versi baru TERBUKTI) menambah baris koreksi baru; baris lama tetap terbaca.
//   6. Tidak ada jurnal otomatis. Bila pergerakan sudah dijurnal, ditandai "jurnal perlu penyesuaian" (keputusan Finance) — sama seperti koreksi harga yang sudah ada.
import crypto from "node:crypto";
import { Decimal, toMoney } from "./money.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { KoreksiError } from "../warehouseCorrection.js";
import { JENIS_BIAYA, TIPE_DINILAI } from "./biayaBahan.js";
import { dasarHargaRataRata } from "./posting/inventory.js";
import { rencanakanPosting } from "../postingPemakaianHistoris.js";
import { terapkanKeadaanEfektif } from "../catatanPemakaianHistoris.js";

export const SUMBER_BUKTI = Object.freeze({ FAKTUR: "Faktur supplier", NOTA_SUPPLIER: "Nota/surat jalan supplier", GR: "Penerimaan (GR) di sistem", PO: "PO di sistem", KESEPAKATAN: "Kesepakatan harga tertulis", LAINNYA: "Lainnya (wajib keterangan)" });
export const AMBANG_HARGA = Object.freeze({ rasioReferensi: 5, selisihPenerimaanTerakhir: 0.3, keteranganMin: 10 });
const STATUS_AKTIF = ["DIAJUKAN", "DISETUJUI"];
const wibTgl = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const tglDate = (s) => new Date(`${s}T00:00:00Z`);
const D = (v) => new Decimal(String(v ?? 0));
const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;
const wajib = (c, m, kode, status = 400) => { if (!c) throw new KoreksiError(m, status, kode); };
const POLA_TGL = /^\d{4}-\d{2}-\d{2}$/;

function bacaMasukan(m) {
  const priceInput = Number(m.priceInput); const faktor = m.faktor == null || m.faktor === "" ? null : Number(m.faktor);
  wajib(Number.isFinite(priceInput) && priceInput > 0 && priceInput <= 1_000_000_000, "Harga harus angka lebih dari 0", "HARGA_TIDAK_VALID");
  const inputUnit = String(m.inputUnit ?? "").trim(); wajib(inputUnit.length >= 1 && inputUnit.length <= 30, "Satuan pada bukti wajib diisi", "SATUAN_WAJIB");
  wajib(POLA_TGL.test(String(m.validFrom ?? "")), "Tanggal mulai berlaku wajib (YYYY-MM-DD, WIB)", "PERIODE_TIDAK_VALID");
  const validTo = m.validTo ? String(m.validTo) : null; if (validTo) wajib(POLA_TGL.test(validTo) && validTo >= m.validFrom, "Tanggal akhir harus sama atau setelah tanggal mulai", "PERIODE_TIDAK_VALID");
  const sourceKind = String(m.sourceKind ?? ""); wajib(Object.hasOwn(SUMBER_BUKTI, sourceKind), "Jenis sumber bukti tidak dikenal", "SUMBER_TIDAK_VALID");
  const sourceRef = String(m.sourceRef ?? "").trim() || null; const sourceNote = String(m.sourceNote ?? "").trim() || null;
  wajib(sourceRef || (sourceNote && sourceNote.length >= AMBANG_HARGA.keteranganMin), "Sumber bukti wajib: nomor dokumen, atau keterangan ≥ 10 karakter", "SUMBER_WAJIB");
  if (sourceKind === "LAINNYA") wajib(sourceNote && sourceNote.length >= AMBANG_HARGA.keteranganMin, "Sumber 'Lainnya' wajib keterangan ≥ 10 karakter", "SUMBER_WAJIB");
  const certainty = m.certainty === "TENTATIF" ? "TENTATIF" : "TERBUKTI"; const tentativeReason = String(m.tentativeReason ?? "").trim() || null;
  if (certainty === "TENTATIF") wajib(tentativeReason && tentativeReason.length >= AMBANG_HARGA.keteranganMin, "Harga tentatif wajib alasan ≥ 10 karakter (apa yang belum terbukti)", "ALASAN_TENTATIF_WAJIB");
  return { priceInput, faktor, inputUnit, validFrom: m.validFrom, validTo, sourceKind, sourceRef, sourceNote, certainty, tentativeReason: certainty === "TENTATIF" ? tentativeReason : null, goodsReceiptId: m.goodsReceiptId || null, replacesId: m.replacesId || null };
}
/** Harga per SATUAN STOK dari harga pada bukti + faktor konversi (1 satuan bukti = faktor satuan stok). Satuan sama dengan satuan stok → faktor 1. */
export function hargaPerSatuanStok({ priceInput, faktor, inputUnit }, satuanStok) {
  const sama = String(inputUnit).trim().toUpperCase() === String(satuanStok).trim().toUpperCase();
  if (sama) { wajib(faktor == null || faktor === 1, `Satuan bukti sama dengan satuan stok (${satuanStok}): faktor konversi harus 1 atau dikosongkan`, "FAKTOR_TIDAK_VALID"); return { unitCost: D(priceInput), faktor: D(1) }; }
  wajib(faktor != null && Number.isFinite(faktor) && faktor > 0, `Satuan bukti (${inputUnit}) berbeda dari satuan stok (${satuanStok}): isi faktor konversi (1 ${inputUnit} = … ${satuanStok}) dan buktinya`, "FAKTOR_WAJIB");
  return { unitCost: D(priceInput).dividedBy(D(faktor)), faktor: D(faktor) };
}

// ── pratinjau (baca-saja) ────────────────────────────────────────────────────────────────────────

/**
 * Pratinjau penerapan harga bukti. Memisahkan: (1) transaksi SUDAH DIPOSTING yang akan diberi nilai, (2) SUDAH DIPOSTING tetapi dikecualikan (alasan), (3) BELUM DIPOSTING (siap posting; tidak berubah),
 * (4) TERTAHAN karena alasan selain harga (tidak berubah), (5) dampak per order. Tidak menulis apa pun.
 */
export async function pratinjauHargaBukti(db, masukan, { lengkap = true, kecualiId = null } = {}) {
  const m = bacaMasukan(masukan);
  const bahan = await db.material.findUnique({ where: { id: masukan.materialId }, select: { id: true, code: true, name: true, unit: true, referenceUnitCost: true, referenceUnitCostMonth: true } });
  wajib(bahan, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const { unitCost } = hargaPerSatuanStok(m, bahan.unit);
  const peringatan = [];
  // pembanding (BUKAN harga yang dipakai)
  if (bahan.referenceUnitCost) {
    const rasio = Number(unitCost) / bahan.referenceUnitCost;
    if (rasio > AMBANG_HARGA.rasioReferensi || rasio < 1 / AMBANG_HARGA.rasioReferensi) { peringatan.push({ kode: "HARGA_TIDAK_WAJAR_REFERENSI", pesan: `Harga ${r4(Number(unitCost))}/${bahan.unit} berbeda lebih dari ${AMBANG_HARGA.rasioReferensi}× dari harga referensi ${bahan.referenceUnitCost} (${bahan.referenceUnitCostMonth ?? "?"}) — wajib keterangan sumber.` }); wajib(m.sourceNote && m.sourceNote.length >= AMBANG_HARGA.keteranganMin, "Harga tampak tidak wajar terhadap referensi: wajib keterangan sumber ≥ 10 karakter", "KETERANGAN_WAJIB"); }
  }
  const terakhir = await db.stockMovement.findFirst({ where: { materialId: bahan.id, type: "RECEIPT", unitCost: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { unitCost: true, unitCostExact: true, createdAt: true } });
  const hargaTerakhir = terakhir ? Number(terakhir.unitCostExact ?? terakhir.unitCost) : null;
  if (hargaTerakhir && Math.abs(Number(unitCost) - hargaTerakhir) / hargaTerakhir > AMBANG_HARGA.selisihPenerimaanTerakhir) peringatan.push({ kode: "BEDA_JAUH_PENERIMAAN_TERAKHIR", pesan: `Harga berbeda >${AMBANG_HARGA.selisihPenerimaanTerakhir * 100}% dari harga penerimaan terakhir (${hargaTerakhir}/${bahan.unit}, ${wibTgl(terakhir.createdAt)}). Itu hanya pembanding — tidak otomatis berlaku untuk pemakaian lama.` });
  // tumpang tindih periode
  const lain = await db.finMaterialPriceEvidence.findMany({ where: { materialId: bahan.id, status: { in: STATUS_AKTIF }, ...(m.replacesId || kecualiId ? { id: { notIn: [m.replacesId, kecualiId].filter(Boolean) } } : {}) }, select: { id: true, status: true, validFrom: true, validTo: true, unitCost: true } });
  const awal = m.validFrom; const akhir = m.validTo ?? "9999-12-31";
  const bentrok = lain.filter((x) => wibTgl(x.validFrom) <= akhir && (x.validTo ? wibTgl(x.validTo) : "9999-12-31") >= awal);
  if (bentrok.length) peringatan.push({ kode: "PERIODE_TUMPANG_TINDIH", pesan: `Periode tumpang tindih dengan ${bentrok.length} harga bukti lain (${bentrok.map((x) => `${wibTgl(x.validFrom)}–${x.validTo ? wibTgl(x.validTo) : "…"} ${x.status}`).join("; ")}). Gunakan "Ganti" atau sesuaikan periode.`, blok: true });

  // ── pergerakan bertaut unit pada bahan ini ──
  const pergerakan = await db.stockMovement.findMany({
    where: { materialId: bahan.id, unitId: { not: null }, type: { in: TIPE_DINILAI } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, type: true, qty: true, createdAt: true, note: true, unitId: true, unit: { select: { unitCode: true, order: { select: { orderNumber: true } } } }, valuation: { select: { status: true, value: true, unitCostBasis: true, basis: true } }, valuationCorrections: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, evidenceId: true, unitCostBasis: true, value: true, tentative: true } } },
  });
  const diposting = []; const dikecualikan = []; let diluarPeriode = 0;
  const cacheDasar = new Map();
  for (const p of pergerakan) {
    const tgl = wibTgl(p.createdAt);
    if (tgl < awal || tgl > akhir) { diluarPeriode++; continue; }
    const kor = p.valuationCorrections[0] ?? null;
    const qty = D(p.qty); const mutlak = toMoney(qty.abs().times(unitCost)); const nilai = qty.isNegative() ? mutlak : mutlak.negated();
    const dasarRow = { movementId: p.id, tanggal: tgl, order: p.unit?.order?.orderNumber ?? null, unit: p.unit?.unitCode ?? null, unitId: p.unitId, tipe: p.type, qty: Number(qty), satuan: bahan.unit, historis: String(p.note ?? "").startsWith("Impor pemakaian historis") };
    if (kor) {
      if (m.replacesId && kor.evidenceId === m.replacesId) { diposting.push({ ...dasarRow, keadaan: "DIGANTI_DARI_BUKTI_LAMA", nilaiSebelum: Number(kor.value), nilaiBaru: Number(nilai), sebelumTentatif: kor.tentative }); continue; }
      dikecualikan.push({ ...dasarRow, alasan: kor.evidenceId ? "SUDAH_DINILAI_HARGA_BUKTI_LAIN" : "SUDAH_DIKOREKSI_MANUAL", nilaiSekarang: Number(kor.value) }); continue;
    }
    if (p.valuation?.status === "DINILAI") { dikecualikan.push({ ...dasarRow, alasan: "SUDAH_PUNYA_HARGA_PEROLEHAN", nilaiSekarang: Number(p.valuation.value) }); continue; }
    const k = p.createdAt.toISOString(); if (!cacheDasar.has(k)) cacheDasar.set(k, (await dasarHargaRataRata(db, bahan.id, { asOf: p.createdAt })).harga);
    if (cacheDasar.get(k) != null) { dikecualikan.push({ ...dasarRow, alasan: "ADA_HARGA_PEROLEHAN_PADA_TANGGAL_ITU", hargaPerolehan: Number(cacheDasar.get(k)) }); continue; }
    diposting.push({ ...dasarRow, keadaan: p.valuation?.status === "TANPA_HARGA" ? "TANPA_HARGA" : "BELUM_DIBEKUKAN", nilaiBaru: Number(nilai) });
  }
  const sebelumDinilai = diposting.filter((x) => x.keadaan === "DIGANTI_DARI_BUKTI_LAMA");
  const nilaiTotal = diposting.reduce((a, x) => a + x.nilaiBaru, 0);

  const hasil = {
    bahan: { id: bahan.id, kode: bahan.code, nama: bahan.name, satuan: bahan.unit },
    harga: { perSatuanStok: Number(unitCost.toDecimalPlaces(8)), input: m.priceInput, satuanBukti: m.inputUnit, faktor: Number(hargaPerSatuanStok(m, bahan.unit).faktor), periode: { dari: m.validFrom, sampai: m.validTo }, sumber: { jenis: m.sourceKind, rujukan: m.sourceRef, keterangan: m.sourceNote }, kepastian: m.certainty, alasanTentatif: m.tentativeReason },
    pembanding: { referensi: bahan.referenceUnitCost ? { harga: bahan.referenceUnitCost, bulan: bahan.referenceUnitCostMonth, catatan: "snapshot impor — hanya pembanding, tidak dipakai otomatis" } : null, penerimaanTerakhir: hargaTerakhir ? { harga: hargaTerakhir, tanggal: wibTgl(terakhir.createdAt), catatan: "hanya pembanding — tidak berlaku mundur untuk pemakaian lama" } : null },
    peringatan, adaBlok: peringatan.some((x) => x.blok),
    diposting: { jumlah: diposting.length, nilai: Number(toMoney(nilaiTotal)), baris: lengkap ? diposting : diposting.slice(0, 50), penggantian: sebelumDinilai.length },
    dikecualikan: { jumlah: dikecualikan.length, baris: lengkap ? dikecualikan : dikecualikan.slice(0, 50) },
    diluarPeriode,
  };
  // BELUM DIPOSTING (siap posting) dan TERTAHAN — tidak berubah oleh harga bukti
  if (lengkap) {
    const rencana = await rencanakanPosting(db);
    const siap = rencana.transaksi.filter((t) => t.materialId === bahan.id);
    const dalam = siap.filter((t) => t.tanggal >= awal && t.tanggal <= akhir);
    hasil.belumDiposting = { jumlah: siap.length, qty: r4(siap.reduce((a, t) => a + t.qty, 0)), dalamPeriode: dalam.length, order: [...new Set(siap.map((t) => t.orderNumber))].length, catatan: "Siap posting, belum menjadi pengeluaran stok: dibekukan TANPA_HARGA saat diposting (harga bukti TIDAK diterapkan otomatis saat posting). Setelah diposting, pratinjau ini menawarkannya lagi." };
    const catatan = await db.unitUsageNote.findMany({ where: { materialId: bahan.id, origin: "EXCEL", state: "PERLU_DICEK" }, select: { id: true, origin: true, state: true, flags: true } });
    const efektif = (await terapkanKeadaanEfektif(db, catatan)).filter((n) => n.state === "PERLU_DICEK");
    const sebab = new Map(); for (const n of efektif) { const k = (n.flags ?? []).find((f) => f.tingkat === "BLOK")?.kode ?? "(tanpa penanda)"; sebab.set(k, (sebab.get(k) ?? 0) + 1); }
    hasil.tertahan = { jumlah: efektif.length, perSebab: Object.fromEntries(sebab), catatan: "Tertahan karena alasan selain harga (satuan, katalog, saldo, GR, dst). Harga bukti TIDAK membuka blokir, tidak mengubah catatan, tidak membuat pengeluaran stok." };
  }
  // dampak per order
  const perUnit = new Map();
  for (const x of diposting) { const o = perUnit.get(x.unitId) ?? { unitId: x.unitId, unit: x.unit, order: x.order, transaksi: 0, nilaiTambah: 0 }; o.transaksi++; o.nilaiTambah = Number(toMoney(D(o.nilaiTambah).plus(x.nilaiBaru))); perUnit.set(x.unitId, o); }
  const unitIds = [...perUnit.keys()];
  if (lengkap && unitIds.length) {
    const nilaiSkrg = await db.$queryRawUnsafe(`select s.unit_id::text uid, coalesce(sum(case when c.id is not null then c.value when v.status = 'DINILAI' then v.value end) filter (where s.type <> 'WASTE'),0)::float nilai,
        (count(*) filter (where c.id is null and coalesce(v.status,'ESTIMASI') <> 'DINILAI' and s.type <> 'WASTE'))::int sisa_tanpa_harga
      from stock_movements s left join fin_stock_movement_valuations v on v.movement_id = s.id
      left join lateral (select k.id, k.value from fin_stock_movement_valuation_corrections k where k.movement_id = s.id order by k.created_at desc, k.id desc limit 1) c on true
      where s.unit_id = any($1::uuid[]) and s.type in ('ISSUE','RETURN','WASTE','ADJUSTMENT') group by s.unit_id`, unitIds);
    const tertahanUnit = await db.unitUsageNote.findMany({ where: { unitId: { in: unitIds }, origin: "EXCEL", state: { in: ["PERLU_DICEK", "SIAP_POSTING"] } }, select: { id: true, unitId: true, origin: true, state: true } });
    const ef = await terapkanKeadaanEfektif(db, tertahanUnit); const tertahanPer = new Map(); for (const n of ef) if (n.state !== "DIPOSTING") tertahanPer.set(n.unitId, (tertahanPer.get(n.unitId) ?? 0) + 1);
    const sk = new Map(nilaiSkrg.map((r) => [r.uid, r]));
    for (const o of perUnit.values()) {
      const s = sk.get(o.unitId); o.nilaiSebelum = Number(toMoney(s?.nilai ?? 0)); o.nilaiSesudah = Number(toMoney(D(o.nilaiSebelum).plus(o.nilaiTambah)));
      o.sisaTanpaHarga = Math.max(0, (s?.sisa_tanpa_harga ?? 0) - o.transaksi); o.catatanTertahan = tertahanPer.get(o.unitId) ?? 0;
      o.statusHppSesudah = m.certainty === "TENTATIF" ? "BELUM_FINAL (harga tentatif)" : o.sisaTanpaHarga > 0 || o.catatanTertahan > 0 ? "BELUM_FINAL (masih ada transaksi tanpa harga / catatan tertahan)" : "FINAL_MENURUT_HARGA_BUKTI";
      o.nilaiTentatifSesudah = m.certainty === "TENTATIF" ? o.nilaiTambah : 0; o.nilaiDidukungBuktiTambahan = m.certainty === "TENTATIF" ? 0 : o.nilaiTambah;
    }
  }
  hasil.perOrder = [...perUnit.values()].sort((a, b) => String(a.order).localeCompare(String(b.order)));
  hasil.hash = crypto.createHash("sha256").update(JSON.stringify({ b: bahan.id, c: unitCost.toDecimalPlaces(8).toString(), f: m.validFrom, t: m.validTo, k: m.certainty, r: m.replacesId ?? null, rows: diposting.map((x) => [x.movementId, x.qty, x.nilaiBaru]) })).digest("hex");
  hasil._baris = diposting; hasil._unitCost = unitCost; hasil._m = m;
  return hasil;
}
const sembunyi = ({ _baris, _unitCost, _m, ...x }) => x;

// ── ajukan / setujui / tolak / batalkan ────────────────────────────────────────────────────────

const kunciValid = (k) => { const t = String(k ?? ""); wajib(t.length >= 8 && t.length <= 120, "Idempotency-Key wajib (8–120 karakter)", "IDEMPOTENCY_KEY_REQUIRED", 428); return t; };

export async function ajukanHargaBukti(prisma, masukan, { aktor, kunci }) {
  const idem = kunciValid(kunci); wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB");
  const ada = await prisma.finMaterialPriceEvidence.findUnique({ where: { idempotencyKey: idem } });
  if (ada) { wajib(ada.materialId === masukan.materialId, "Idempotency-Key ini sudah dipakai untuk bahan lain", "KUNCI_DIPAKAI_LAIN", 409); return { ulang: true, ...tampil(ada) }; }
  const pra = await pratinjauHargaBukti(prisma, masukan, { lengkap: false });
  wajib(!pra.adaBlok, pra.peringatan.find((x) => x.blok)?.pesan ?? "Pengajuan diblokir", "PERIODE_TUMPANG_TINDIH", 409);
  wajib(String(masukan.hashPratinjau ?? "") === pra.hash, "Pratinjau yang Anda lihat sudah berbeda dari keadaan sekarang (transaksi/saldo/harga bergeser). Muat ulang pratinjau lalu ajukan lagi.", "PRATINJAU_BERUBAH", 409);
  wajib(pra.diposting.jumlah > 0, "Tidak ada transaksi yang akan diberi nilai pada periode ini — tidak ada yang diajukan", "TIDAK_ADA_TRANSAKSI", 409);
  const m = pra._m;
  if (m.replacesId) { const lama = await prisma.finMaterialPriceEvidence.findUnique({ where: { id: m.replacesId } }); wajib(lama && lama.materialId === masukan.materialId && lama.status === "DISETUJUI", "Harga bukti yang diganti harus berstatus DISETUJUI untuk bahan yang sama", "PENGGANTIAN_TIDAK_VALID", 409); }
  if (m.goodsReceiptId) wajib(await prisma.goodsReceipt.findUnique({ where: { id: m.goodsReceiptId }, select: { id: true } }), "GR yang ditautkan tidak ditemukan", "GR_TIDAK_ADA", 404);
  try {
    const baris = await prisma.finMaterialPriceEvidence.create({ data: {
      materialId: masukan.materialId, status: "DIAJUKAN", priceInput: m.priceInput, inputUnit: m.inputUnit, conversionFactor: pra.harga.faktor, unitCost: pra._unitCost.toDecimalPlaces(8).toString(),
      sourceKind: m.sourceKind, sourceRef: m.sourceRef, sourceNote: m.sourceNote, validFrom: tglDate(m.validFrom), validTo: m.validTo ? tglDate(m.validTo) : null, certainty: m.certainty, tentativeReason: m.tentativeReason,
      goodsReceiptId: m.goodsReceiptId, replacesId: m.replacesId, previewHash: pra.hash, previewCount: pra.diposting.jumlah, previewValue: pra.diposting.nilai.toString(), requestedById: aktor.id, idempotencyKey: idem,
    } });
    return { ulang: false, ...tampil(baris), peringatan: pra.peringatan };
  } catch (e) { if (e?.code === "P2002") { const s = await prisma.finMaterialPriceEvidence.findUnique({ where: { idempotencyKey: idem } }); if (s) return { ulang: true, ...tampil(s) }; } throw e; }
}

function masukanDariBaris(b) { return { materialId: b.materialId, priceInput: Number(b.priceInput), inputUnit: b.inputUnit, faktor: Number(b.conversionFactor), validFrom: wibTgl(b.validFrom), validTo: b.validTo ? wibTgl(b.validTo) : null, sourceKind: b.sourceKind, sourceRef: b.sourceRef, sourceNote: b.sourceNote, certainty: b.certainty, tentativeReason: b.tentativeReason, goodsReceiptId: b.goodsReceiptId, replacesId: b.replacesId }; }

export async function setujuiHargaBukti(prisma, { id, hashPratinjau, aktor, catatan = null }) {
  wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB");
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "fin_material_price_evidence", id);
    const b = await tx.finMaterialPriceEvidence.findUnique({ where: { id } }); wajib(b, "Harga bukti tidak ditemukan", "TIDAK_ADA", 404);
    if (b.status === "DISETUJUI") return { ulang: true, ...tampil(b) }; // klik ulang / serentak: sudah diterapkan, nol tulisan
    wajib(b.status === "DIAJUKAN", `Harga bukti berstatus ${b.status} tidak bisa disetujui`, "STATUS_FINAL", 409);
    wajib(!b.requestedById || b.requestedById !== aktor.id, "Pengaju tidak boleh menyetujui harga buktinya sendiri — minta penyetuju lain", "PEMOHON_SAMA", 403);
    wajib(String(hashPratinjau ?? "") === b.previewHash, "Pratinjau yang Anda setujui berbeda dari yang diajukan", "PRATINJAU_BERBEDA", 409);
    await lockRowForUpdate(tx, "materials", b.materialId);
    const pra = await pratinjauHargaBukti(tx, masukanDariBaris(b), { lengkap: false, kecualiId: b.id });
    wajib(pra.hash === b.previewHash, `Keadaan sudah bergeser sejak diajukan (transaksi/harga/saldo): pratinjau kini ${pra.diposting.jumlah} transaksi / Rp${pra.diposting.nilai}, diajukan ${b.previewCount} / Rp${Number(b.previewValue)}. Tolak lalu ajukan ulang.`, "PRATINJAU_BERUBAH", 409);
    wajib(!pra.adaBlok, "Periode kini tumpang tindih dengan harga bukti lain", "PERIODE_TUMPANG_TINDIH", 409);
    const alasan = `Harga bukti ${SUMBER_BUKTI[b.sourceKind]}${b.sourceRef ? ` ${b.sourceRef}` : ""} (${b.certainty}) berlaku ${wibTgl(b.validFrom)}–${b.validTo ? wibTgl(b.validTo) : "…"}`.slice(0, 480);
    let jurnalPerlu = 0;
    for (const x of pra._baris) {
      const asal = await tx.stockMovement.findUnique({ where: { id: x.movementId }, select: { id: true, materialId: true, unitId: true, type: true, valuation: { select: { status: true, unitCostBasis: true, value: true } } } });
      const kor0 = await tx.finStockMovementValuationCorrection.findFirst({ where: { movementId: x.movementId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      const sebelum = kor0 ? { status: "DINILAI", unitCostBasis: String(kor0.unitCostBasis), value: String(kor0.value), sumber: "KOREKSI" } : asal.valuation ? { status: asal.valuation.status, unitCostBasis: asal.valuation.unitCostBasis == null ? null : String(asal.valuation.unitCostBasis), value: asal.valuation.value == null ? null : String(asal.valuation.value), sumber: "BEKU" } : { status: "ESTIMASI_HISTORIS", unitCostBasis: null, value: null, sumber: "ESTIMASI" };
      const jurnal = await tx.finJournalEntry.findFirst({ where: { idempotencyKey: `PEMAKAIAN_BAHAN_MOVEMENT:${x.movementId}`, status: { in: ["POSTED", "REVERSED"] } }, select: { id: true } }); if (jurnal) jurnalPerlu++;
      await tx.finStockMovementValuationCorrection.create({ data: {
        movementId: x.movementId, materialId: asal.materialId, unitId: asal.unitId, before: sebelum,
        after: { status: "DINILAI", unitCostBasis: String(pra._unitCost.toDecimalPlaces(8)), value: String(x.nilaiBaru), sumber: "HARGA_BUKTI", evidenceId: b.id, tentatif: b.certainty === "TENTATIF" },
        unitCostBasis: pra._unitCost.toDecimalPlaces(8).toString(), value: String(x.nilaiBaru), reason: alasan, createdById: aktor.id, idempotencyKey: `HB:${b.id}:${x.movementId}`, evidenceId: b.id, tentative: b.certainty === "TENTATIF", tentativeReason: b.certainty === "TENTATIF" ? b.tentativeReason : null,
      } });
    }
    if (b.replacesId) await tx.finMaterialPriceEvidence.update({ where: { id: b.replacesId }, data: { status: "DIGANTI" } });
    const baru = await tx.finMaterialPriceEvidence.update({ where: { id: b.id }, data: { status: "DISETUJUI", decidedById: aktor.id, decidedAt: new Date(), decisionNote: catatan ? String(catatan).slice(0, 500) : null, appliedCount: pra._baris.length } });
    return { ulang: false, ...tampil(baru), jurnalPerluPenyesuaian: jurnalPerlu };
  }, { timeout: 120_000, maxWait: 30_000 });
}

async function akhiri(prisma, { id, aktor, catatan, status, hanyaPemohon }) {
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "fin_material_price_evidence", id);
    const b = await tx.finMaterialPriceEvidence.findUnique({ where: { id } }); wajib(b, "Harga bukti tidak ditemukan", "TIDAK_ADA", 404);
    if (b.status === status) return { ulang: true, ...tampil(b) };
    wajib(b.status === "DIAJUKAN", `Harga bukti berstatus ${b.status} tidak bisa diubah`, "STATUS_FINAL", 409);
    if (hanyaPemohon) wajib(b.requestedById === aktor.id, "Hanya pengaju yang dapat membatalkan pengajuannya", "BUKAN_PEMOHON", 403);
    else { wajib(!b.requestedById || b.requestedById !== aktor.id, "Pengaju tidak memutuskan pengajuannya sendiri — gunakan Batalkan", "PEMOHON_SAMA", 403); wajib(String(catatan ?? "").trim().length >= 5, "Alasan penolakan wajib diisi (min 5 karakter)", "ALASAN_WAJIB"); }
    const baru = await tx.finMaterialPriceEvidence.update({ where: { id }, data: { status, decidedById: aktor.id, decidedAt: new Date(), decisionNote: catatan ? String(catatan).slice(0, 500) : null } });
    return { ulang: false, ...tampil(baru) };
  }, { timeout: 30_000, maxWait: 10_000 });
}
export const tolakHargaBukti = (prisma, a) => akhiri(prisma, { ...a, status: "DITOLAK", hanyaPemohon: false });
export const batalkanHargaBukti = (prisma, a) => akhiri(prisma, { ...a, status: "DIBATALKAN", hanyaPemohon: true });

const tampil = (b) => ({ id: b.id, bahanId: b.materialId, status: b.status, hargaPerSatuanStok: Number(b.unitCost), hargaBukti: Number(b.priceInput), satuanBukti: b.inputUnit, faktor: Number(b.conversionFactor), sumber: { jenis: b.sourceKind, rujukan: b.sourceRef, keterangan: b.sourceNote }, periode: { dari: wibTgl(b.validFrom), sampai: b.validTo ? wibTgl(b.validTo) : null }, kepastian: b.certainty, alasanTentatif: b.tentativeReason, menggantiId: b.replacesId, pratinjau: { hash: b.previewHash, transaksi: b.previewCount, nilai: Number(b.previewValue) }, diajukanOleh: b.requestedById, diajukanPada: b.requestedAt, diputuskanOleh: b.decidedById, diputuskanPada: b.decidedAt, catatanKeputusan: b.decisionNote, diterapkan: b.appliedCount });

export async function daftarHargaBukti(db, { materialId = null, status = null } = {}) {
  const baris = await db.finMaterialPriceEvidence.findMany({ where: { ...(materialId ? { materialId } : {}), ...(status ? { status } : {}) }, orderBy: [{ requestedAt: "desc" }], take: 200, include: { material: { select: { code: true, name: true, unit: true } } } });
  return baris.map((b) => ({ ...tampil(b), bahan: { kode: b.material.code, nama: b.material.name, satuan: b.material.unit } }));
}
export async function bacaHargaBukti(db, id) {
  const b = await db.finMaterialPriceEvidence.findUnique({ where: { id }, include: { material: { select: { code: true, name: true, unit: true } }, corrections: { orderBy: [{ createdAt: "asc" }], select: { movementId: true, value: true, tentative: true, createdAt: true, createdById: true } } } });
  if (!b) return null;
  return { ...tampil(b), bahan: { kode: b.material.code, nama: b.material.name, satuan: b.material.unit }, koreksi: b.corrections.map((k) => ({ movementId: k.movementId, nilai: Number(k.value), tentatif: k.tentative, waktu: k.createdAt, oleh: k.createdById })) };
}

// ── daftar bahan tanpa harga (layar awal) ───────────────────────────────────────────────────────

/** Bahan yang masih punya pemakaian bertaut unit tanpa harga (beku TANPA_HARGA / belum dibekukan tanpa dasar harga), transaksi siap posting tanpa harga, atau saldo tanpa harga perolehan. Baca-saja. */
export async function daftarBahanTanpaHarga(db, { q = "" } = {}) {
  const bahan = await db.$queryRawUnsafe(`select m.id::text id, m.code kode, m.name nama, m.unit satuan, m.reference_unit_cost::float referensi, m.reference_unit_cost_month bulan_referensi,
      (select coalesce(sum(x.qty),0)::float from stock_movements x where x.material_id = m.id) saldo,
      (select count(*)::int from stock_movements r where r.material_id = m.id and r.type = 'RECEIPT' and r.unit_cost > 0 and r.qty > 0) penerimaan_berharga,
      (select min(r.created_at) from stock_movements r where r.material_id = m.id and r.type = 'RECEIPT' and r.unit_cost > 0 and r.qty > 0) penerimaan_berharga_pertama
    from materials m ${q ? "where m.code ilike $1 or m.name ilike $1" : ""} order by m.code`, ...(q ? [`%${q}%`] : []));
  const rencana = await rencanakanPosting(db);
  const siapPer = new Map(); for (const t of rencana.transaksi) { const x = siapPer.get(t.materialId) ?? { trx: 0, qty: 0, order: new Set() }; x.trx++; x.qty += t.qty; x.order.add(t.orderNumber); siapPer.set(t.materialId, x); }
  const mv = await db.$queryRawUnsafe(`select s.material_id::text mid, s.id::text, s.created_at, s.qty::float qty, v.status vs, (select count(*) from fin_stock_movement_valuation_corrections c where c.movement_id = s.id)::int nkor
    from stock_movements s left join fin_stock_movement_valuations v on v.movement_id = s.id where s.unit_id is not null and s.type in ('ISSUE','RETURN','WASTE','ADJUSTMENT')`);
  const pm = new Map(); const perluDasar = [];
  for (const x of mv) { if (x.nkor > 0 || x.vs === "DINILAI") continue; const e = pm.get(x.mid) ?? { beku: 0, tak: 0, qty: 0, awal: null, akhir: null, baris: [] }; if (x.vs === "TANPA_HARGA") e.beku++; else e.baris.push(x); pm.set(x.mid, e); }
  for (const [mid, e] of pm) { for (const x of e.baris) { const d = await dasarHargaRataRata(db, mid, { asOf: new Date(x.created_at) }); if (d.harga == null) { e.tak++; e.qty += Math.abs(x.qty); const t = wibTgl(x.created_at); e.awal = !e.awal || t < e.awal ? t : e.awal; e.akhir = !e.akhir || t > e.akhir ? t : e.akhir; } } }
  const beku = await db.$queryRawUnsafe(`select s.material_id::text mid, count(*)::int n, coalesce(sum(abs(s.qty)),0)::float qty, min(s.created_at) awal, max(s.created_at) akhir from stock_movements s join fin_stock_movement_valuations v on v.movement_id = s.id
    where v.status = 'TANPA_HARGA' and not exists (select 1 from fin_stock_movement_valuation_corrections c where c.movement_id = s.id) group by 1`);
  const bekuMap = new Map(beku.map((b) => [b.mid, b]));
  const bukti = await db.finMaterialPriceEvidence.findMany({ where: { status: { in: STATUS_AKTIF } }, select: { id: true, materialId: true, status: true, unitCost: true, validFrom: true, validTo: true, certainty: true } });
  const buktiPer = new Map(); for (const b of bukti) { (buktiPer.get(b.materialId) ?? buktiPer.set(b.materialId, []).get(b.materialId)).push({ id: b.id, status: b.status, harga: Number(b.unitCost), dari: wibTgl(b.validFrom), sampai: b.validTo ? wibTgl(b.validTo) : null, kepastian: b.certainty }); }
  const tertahan = await db.$queryRawUnsafe(`select material_id::text mid, count(*)::int n from unit_usage_notes where origin = 'EXCEL' and state = 'PERLU_DICEK' and material_id is not null group by 1`);
  const tertahanMap = new Map(tertahan.map((t) => [t.mid, t.n]));
  const hasil = [];
  for (const b of bahan) {
    const e = pm.get(b.id); const bk = bekuMap.get(b.id); const siap = siapPer.get(b.id);
    const nBeku = bk?.n ?? 0; const nTak = e?.tak ?? 0; const nSiap = siap?.trx ?? 0; const tanpaPenerimaan = b.penerimaan_berharga === 0;
    if (!(nBeku || nTak || nSiap || (b.saldo > 0 && tanpaPenerimaan && (tertahanMap.get(b.id) ?? 0) > 0))) continue;
    const sebab = tanpaPenerimaan ? (b.saldo > 0 ? "HANYA_SALDO_PEMBUKA_TANPA_HARGA" : "BELUM_ADA_PENERIMAAN_BERHARGA") : "PENERIMAAN_BERHARGA_SETELAH_TANGGAL_PEMAKAIAN";
    hasil.push({ bahanId: b.id, kode: b.kode, nama: b.nama, satuan: b.satuan, saldo: r4(b.saldo), sebab,
      diposting: { dibekukanTanpaHarga: nBeku, belumDibekukan: nTak, qty: r4((bk?.qty ?? 0) + (e?.qty ?? 0)), tanggalAwal: bk?.awal ? wibTgl(bk.awal) : e?.awal ?? null, tanggalAkhir: bk?.akhir ? wibTgl(bk.akhir) : e?.akhir ?? null },
      siapPosting: { transaksi: nSiap, qty: r4(siap?.qty ?? 0), order: siap?.order.size ?? 0 }, tertahanSelainHarga: tertahanMap.get(b.id) ?? 0,
      pembanding: { referensi: b.referensi ? { harga: b.referensi, bulan: b.bulan_referensi, catatan: "pembanding saja" } : null, penerimaanBerhargaPertama: b.penerimaan_berharga_pertama ? wibTgl(b.penerimaan_berharga_pertama) : null },
      hargaBukti: buktiPer.get(b.id) ?? [] });
  }
  return hasil.sort((a, b) => (b.diposting.dibekukanTanpaHarga + b.diposting.belumDibekukan + b.siapPosting.transaksi) - (a.diposting.dibekukanTanpaHarga + a.diposting.belumDibekukan + a.siapPosting.transaksi));
}

export { sembunyi as tanpaInternal };
