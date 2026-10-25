// PENETAPAN NILAI RESMI BAHAN (Stok → Bahan tanpa harga). Menerapkan nilai dari SATU sumber resmi (nilaiResmi.js: Persediaan Awal + GR) ke pergerakan yang belum bernilai.
//
//   • Harga TIDAK diketik di sini. Server menurunkannya dari sumber resmi per tanggal pemakaian; tanggal/penerimaan berbeda → harga berbeda.
//   • Tiga kelompok pratinjau, DIPISAH: (1) pemakaian SUDAH DIPOSTING tanpa harga (valuasi beku TANPA_HARGA); (2) ISSUE lama yang belum pernah dinilai (tanpa baris valuasi); (3) catatan siap/tertahan yang BELUM menjadi ISSUE.
//     Hanya (1) dan (2) dapat diterapkan. (3) hanya PERKIRAAN: bukan HPP resmi, tidak diterapkan, tidak membuka blokir posting, tidak mengubah catatan.
//   • Penerapan = baris koreksi valuasi append-only per pergerakan (tautan ke penetapan; dasar = lapisan pembuka + GR). Tidak ada ISSUE kedua, tidak mengubah stok/saldo/catatan/valuasi beku, TIDAK ada jurnal.
//   • Nilai beku DINILAI tidak pernah diganti otomatis (hanya dilaporkan bila berbeda dari nilai resmi). Penetapan yang sudah diterapkan dapat diselaraskan ulang (kelompok SELARAS_ULANG) bila sumber resmi dikoreksi kemudian.
//   • Dua orang (finance:post mengajukan, finance:approve menyetujui orang LAIN), hash pratinjau, satu pengajuan aktif per bahan, idempoten.
//   • "Didukung bukti" hanya bila SEMUA GR dasar punya kedatangan tercatat DAN harga disetujui — dihitung ulang saat dibaca, jadi berubah sendiri setelah bukti dilengkapi.
import crypto from "node:crypto";
import { Decimal, toMoney } from "./money.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { KoreksiError } from "../warehouseCorrection.js";
import { TIPE_DINILAI } from "./biayaBahan.js";
import { penyelesaiHarga, barisPembukaResmi, statusBuktiGR, tentatifDariSumber } from "./nilaiResmi.js";
import { rencanakanPosting } from "../postingPemakaianHistoris.js";
import { terapkanKeadaanEfektif } from "../catatanPemakaianHistoris.js";

export const KELOMPOK = Object.freeze({ DIPOSTING_TANPA_HARGA: "Sudah diposting tanpa harga", ISSUE_LAMA: "ISSUE lama belum pernah dinilai", SELARAS_ULANG: "Selaraskan ulang (sumber resmi berubah)" });
const KELOMPOK_BAWAAN = ["DIPOSTING_TANPA_HARGA", "ISSUE_LAMA"];
const D = (v) => new Decimal(String(v ?? 0));
const wibTgl = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const wajib = (c, m, kode, status = 400) => { if (!c) throw new KoreksiError(m, status, kode); };
const nilaiDari = (qty, harga) => { const m = toMoney(D(qty).abs().times(harga)); return D(qty).isNegative() ? m : m.negated(); };
const kunciValid = (k) => { const t = String(k ?? ""); wajib(t.length >= 8 && t.length <= 120, "Idempotency-Key wajib (8–120 karakter)", "IDEMPOTENCY_KEY_REQUIRED", 428); return t; };
const bacaKelompok = (g) => { const x = Array.isArray(g) && g.length ? [...new Set(g)] : KELOMPOK_BAWAAN; wajib(x.every((k) => Object.hasOwn(KELOMPOK, k)), "Kelompok tidak dikenal", "KELOMPOK_TIDAK_VALID"); return x.sort(); };

/** Pratinjau baca-saja. lengkap=false melewati kelompok 3 dan dampak per order (dipakai saat mengajukan/menyetujui, hash tidak bergantung padanya). */
export async function pratinjauPenetapan(db, { materialId, groups } = {}, { lengkap = true } = {}) {
  const kelompok = bacaKelompok(groups);
  const bahan = await db.material.findUnique({ where: { id: materialId }, select: { id: true, code: true, name: true, unit: true } }); wajib(bahan, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const selesai = penyelesaiHarga(db);
  const psa = await barisPembukaResmi(db, bahan.id);
  const pergerakan = await db.stockMovement.findMany({
    where: { materialId: bahan.id, unitId: { not: null }, type: { in: TIPE_DINILAI } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, type: true, qty: true, createdAt: true, unitId: true, note: true, unit: { select: { unitCode: true, order: { select: { orderNumber: true } } } }, valuation: { select: { status: true, value: true, unitCostBasis: true } },
      valuationCorrections: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, settlementId: true, unitCostBasis: true, value: true } } },
  });
  const terapkan = []; const dikecualikan = []; const tanpaSumber = []; const info = { dinilaiBekuBedaDariResmi: [], sudahSelaras: 0 }; const hitungKel = { DIPOSTING_TANPA_HARGA: 0, ISSUE_LAMA: 0, SELARAS_ULANG: 0 };
  for (const p of pergerakan) {
    const kor = p.valuationCorrections[0] ?? null; const qty = D(p.qty);
    const dasar = { movementId: p.id, tanggal: wibTgl(p.createdAt), order: p.unit?.order?.orderNumber ?? null, unit: p.unit?.unitCode ?? null, unitId: p.unitId, tipe: p.type, qty: Number(qty), satuan: bahan.unit, historis: String(p.note ?? "").startsWith("Impor pemakaian historis") };
    if (kor && !kor.settlementId) { dikecualikan.push({ ...dasar, alasan: "SUDAH_DIKOREKSI_MANUAL" }); continue; }
    const h = await selesai(bahan.id, p.createdAt);
    if (kor) { // sudah ditetapkan: selaras atau berubah?
      if (!h) { dikecualikan.push({ ...dasar, alasan: "SUMBER_RESMI_HILANG_PERLU_TINJAUAN", nilaiSekarang: Number(kor.value) }); continue; }
      if (D(kor.unitCostBasis).minus(h.harga).abs().lessThan("0.00000001")) { info.sudahSelaras++; continue; }
      hitungKel.SELARAS_ULANG++; if (!kelompok.includes("SELARAS_ULANG")) continue;
      terapkan.push({ ...dasar, kelompok: "SELARAS_ULANG", harga: h.harga, nilaiSebelum: Number(kor.value), nilaiBaru: Number(nilaiDari(qty, h.harga)), h }); continue;
    }
    if (p.valuation?.status === "DINILAI") { if (h && D(p.valuation.unitCostBasis).minus(h.harga).abs().greaterThan("0.005")) info.dinilaiBekuBedaDariResmi.push({ ...dasar, nilaiBeku: Number(p.valuation.value), hargaBeku: Number(p.valuation.unitCostBasis), hargaResmi: Number(h.harga.toDecimalPlaces(4)) }); dikecualikan.push({ ...dasar, alasan: "SUDAH_BERNILAI_BEKU", nilaiSekarang: Number(p.valuation.value) }); continue; }
    const kel = p.valuation?.status === "TANPA_HARGA" ? "DIPOSTING_TANPA_HARGA" : "ISSUE_LAMA"; hitungKel[kel]++;
    if (!kelompok.includes(kel)) continue;
    if (!h) { tanpaSumber.push({ ...dasar, kelompok: kel }); continue; }
    terapkan.push({ ...dasar, kelompok: kel, harga: h.harga, nilaiSebelum: null, nilaiBaru: Number(nilaiDari(qty, h.harga)), h });
  }
  const total = terapkan.reduce((a, x) => a.plus(x.nilaiBaru), D(0));
  const hasil = {
    bahan: { id: bahan.id, kode: bahan.code, nama: bahan.name, satuan: bahan.unit }, kelompokDipilih: kelompok,
    sumberResmi: { persediaanAwal: psa ? { nomor: psa.nomor, status: psa.status, harga: Number(psa.harga), sumberHarga: psa.sumberHarga, rujukan: psa.rujukanHarga } : null,
      aturan: "Nilai = rata-rata tertimbang lapisan pembuka (Persediaan Awal, status DIPERIKSA/DIPOSTING) + penerimaan berharga yang sudah masuk stok s.d. tanggal pemakaian. Harga referensi, harga hari ini, dan harga ketikan tidak dipakai." },
    kelompok1: { judul: KELOMPOK.DIPOSTING_TANPA_HARGA, tersedia: hitungKel.DIPOSTING_TANPA_HARGA, diterapkan: terapkan.filter((x) => x.kelompok === "DIPOSTING_TANPA_HARGA").length },
    kelompok2: { judul: KELOMPOK.ISSUE_LAMA, tersedia: hitungKel.ISSUE_LAMA, diterapkan: terapkan.filter((x) => x.kelompok === "ISSUE_LAMA").length },
    selarasUlang: { tersedia: hitungKel.SELARAS_ULANG, diterapkan: terapkan.filter((x) => x.kelompok === "SELARAS_ULANG").length, sudahSelaras: info.sudahSelaras },
    penerapan: { jumlah: terapkan.length, nilai: Number(toMoney(total)), baris: terapkan.map(({ h, harga, ...x }) => ({ ...x, harga: Number(harga.toDecimalPlaces(8)), tentatif: h.tentatif, dasar: { pembuka: h.sumber.pembuka, gr: h.grIds } })) },
    tanpaSumberResmi: { jumlah: tanpaSumber.length, baris: tanpaSumber, catatan: "Belum ada sumber resmi (Persediaan Awal berstatus DIPERIKSA/DIPOSTING atau penerimaan berharga) pada tanggal pemakaian — tetap TANPA_HARGA, bukan Rp0." },
    dikecualikan: { jumlah: dikecualikan.length, baris: dikecualikan },
    informasi: { dinilaiBekuBedaDariResmi: info.dinilaiBekuBedaDariResmi, catatan: "Nilai beku DINILAI tidak pernah diganti otomatis; bila berbeda dari nilai resmi hanya dilaporkan untuk keputusan Finance." },
  };
  hasil.hash = crypto.createHash("sha256").update(JSON.stringify({ b: bahan.id, k: kelompok, rows: terapkan.map((x) => [x.movementId, x.harga.toDecimalPlaces(8).toString(), x.nilaiBaru]) })).digest("hex");
  hasil._terapkan = terapkan; hasil._kelompok = kelompok;
  if (!lengkap) return hasil;

  // ── dampak per order (kelompok 1+2+selaras): nilai resmi sebelum → sesudah; HPP tetap PARSIAL bila masih ada yang belum pasti ──
  const perUnit = new Map();
  for (const x of terapkan) { const o = perUnit.get(x.unitId) ?? { unitId: x.unitId, unit: x.unit, order: x.order, transaksi: 0, nilaiTambah: 0, nilaiTentatifTambah: 0 }; o.transaksi++; const delta = x.nilaiBaru - (x.nilaiSebelum ?? 0); o.nilaiTambah = Number(toMoney(D(o.nilaiTambah).plus(delta))); if (x.h.tentatif) o.nilaiTentatifTambah = Number(toMoney(D(o.nilaiTentatifTambah).plus(delta))); perUnit.set(x.unitId, o); }
  const unitIds = [...perUnit.keys()];
  if (unitIds.length) {
    const nilaiSkrg = await db.$queryRawUnsafe(`select s.unit_id::text uid, coalesce(sum(case when c.id is not null then c.value when v.status = 'DINILAI' then v.value end) filter (where s.type <> 'WASTE'),0)::float nilai,
        (count(*) filter (where c.id is null and coalesce(v.status,'ESTIMASI') <> 'DINILAI' and s.type <> 'WASTE'))::int sisa_tanpa_harga
      from stock_movements s left join fin_stock_movement_valuations v on v.movement_id = s.id
      left join lateral (select k.id, k.value from fin_stock_movement_valuation_corrections k where k.movement_id = s.id order by k.created_at desc, k.id desc limit 1) c on true
      where s.unit_id = any($1::uuid[]) and s.type in ('ISSUE','RETURN','WASTE','ADJUSTMENT') group by s.unit_id`, unitIds);
    const catatan = await db.unitUsageNote.findMany({ where: { unitId: { in: unitIds }, origin: "EXCEL", state: { in: ["PERLU_DICEK", "SIAP_POSTING"] } }, select: { id: true, unitId: true, origin: true, state: true } });
    const ef = await terapkanKeadaanEfektif(db, catatan); const tertahanPer = new Map(); for (const n of ef) if (n.state !== "DIPOSTING") tertahanPer.set(n.unitId, (tertahanPer.get(n.unitId) ?? 0) + 1);
    const sk = new Map(nilaiSkrg.map((r) => [r.uid, r]));
    for (const o of perUnit.values()) {
      const s = sk.get(o.unitId); o.nilaiSebelum = Number(toMoney(s?.nilai ?? 0)); o.nilaiSesudah = Number(toMoney(D(o.nilaiSebelum).plus(o.nilaiTambah)));
      const sudahDiterapkan = terapkan.filter((x) => x.unitId === o.unitId && x.kelompok !== "SELARAS_ULANG").length; o.sisaTanpaHarga = Math.max(0, (s?.sisa_tanpa_harga ?? 0) - sudahDiterapkan); o.catatanBelumIssue = tertahanPer.get(o.unitId) ?? 0;
      const alasan = [o.sisaTanpaHarga > 0 && `${o.sisaTanpaHarga} transaksi masih tanpa harga`, o.catatanBelumIssue > 0 && `${o.catatanBelumIssue} catatan belum menjadi ISSUE (siap/tertahan)`, o.nilaiTentatifTambah > 0 && "ada nilai tentatif"].filter(Boolean);
      o.statusHppSesudah = alasan.length ? `PARSIAL — ${alasan.join("; ")}` : "LENGKAP menurut nilai resmi"; o.nilaiDidukungBuktiTambahan = Number(toMoney(D(o.nilaiTambah).minus(o.nilaiTentatifTambah)));
    }
  }
  hasil.perOrder = [...perUnit.values()].sort((a, b) => String(a.order).localeCompare(String(b.order)));

  // ── kelompok 3: catatan siap/tertahan yang BELUM menjadi ISSUE — PERKIRAAN saja ──
  const rencana = await rencanakanPosting(db); const siap = rencana.transaksi.filter((t) => t.materialId === bahan.id);
  const perOrder3 = new Map(); let adaTanpa = 0;
  for (const t of siap) { const h = await selesai(bahan.id, t.usedAt); const o = perOrder3.get(t.orderNumber) ?? { order: t.orderNumber, siap: 0, perkiraan: 0, tertahan: 0, tanpaSumber: 0 }; o.siap++; if (h) o.perkiraan = Number(toMoney(D(o.perkiraan).plus(nilaiDari(-Math.abs(t.qty), h.harga)))); else { o.tanpaSumber++; adaTanpa++; } perOrder3.set(t.orderNumber, o); }
  const notes = await db.unitUsageNote.findMany({ where: { materialId: bahan.id, origin: "EXCEL", state: "PERLU_DICEK" }, select: { id: true, origin: true, state: true, flags: true, qty: true, uom: true, usedAt: true, orderNumber: true } });
  const efektif = (await terapkanKeadaanEfektif(db, notes)).filter((n) => n.state === "PERLU_DICEK"); const sebab = new Map(); let tidakDiperkirakan = 0;
  for (const n of efektif) {
    const blok = (n.flags ?? []).find((f) => f.tingkat === "BLOK")?.kode ?? "(tanpa penanda)"; sebab.set(blok, (sebab.get(blok) ?? 0) + 1);
    const o = perOrder3.get(n.orderNumber) ?? { order: n.orderNumber, siap: 0, perkiraan: 0, tertahan: 0, tanpaSumber: 0 };
    o.tertahan++; const bisa = n.qty != null && Number(n.qty) > 0 && n.usedAt && String(n.uom ?? "").trim().toUpperCase() === String(bahan.unit).toUpperCase();
    if (bisa) { const h = await selesai(bahan.id, n.usedAt); if (h) o.perkiraan = Number(toMoney(D(o.perkiraan).plus(nilaiDari(-Math.abs(Number(n.qty)), h.harga)))); else o.tanpaSumber++; } else tidakDiperkirakan++;
    perOrder3.set(n.orderNumber, o);
  }
  hasil.kelompok3 = { judul: KELOMPOK_3, bukanHppResmi: true, transaksiSiap: siap.length, catatanTertahan: efektif.length, tertahanPerSebab: Object.fromEntries(sebab), tidakDapatDiperkirakan: tidakDiperkirakan, tanpaSumber: adaTanpa,
    perkiraanTotal: Number(toMoney([...perOrder3.values()].reduce((a, o) => a.plus(o.perkiraan), D(0)))), perOrder: [...perOrder3.values()].sort((a, b) => String(a.order).localeCompare(String(b.order))),
    catatan: "PERKIRAAN dampak saja. Bukan HPP resmi, tidak diterapkan, tidak mengubah catatan, tidak membuka blokir (satuan, katalog, saldo, GR…), dan tidak otomatis ikut saat posting — transaksi yang diposting tetap dibekukan menurut aturan posting dan baru bisa ditetapkan lewat pratinjau ini sesudah menjadi ISSUE." };
  return hasil;
}
const KELOMPOK_3 = "Catatan siap/tertahan yang belum menjadi ISSUE (perkiraan)";
export const tanpaInternal = ({ _terapkan, _kelompok, ...x }) => x;

// ── ajukan / setujui / tolak / batalkan ──────────────────────────────────────────────────────────
export async function ajukanPenetapan(prisma, masukan, { aktor, kunci }) {
  const idem = kunciValid(kunci); wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB");
  const ada = await prisma.finMaterialValueSettlement.findUnique({ where: { idempotencyKey: idem } });
  if (ada) { wajib(ada.materialId === masukan.materialId, "Idempotency-Key ini sudah dipakai untuk bahan lain", "KUNCI_DIPAKAI_LAIN", 409); return { ulang: true, ...tampil(ada) }; }
  const pra = await pratinjauPenetapan(prisma, masukan, { lengkap: false });
  wajib(String(masukan.hashPratinjau ?? "") === pra.hash, "Pratinjau yang Anda lihat sudah berbeda dari keadaan sekarang. Muat ulang pratinjau lalu ajukan lagi.", "PRATINJAU_BERUBAH", 409);
  wajib(pra.penerapan.jumlah > 0, "Tidak ada transaksi yang akan ditetapkan nilainya — tidak ada yang diajukan", "TIDAK_ADA_TRANSAKSI", 409);
  try {
    const b = await prisma.finMaterialValueSettlement.create({ data: { materialId: masukan.materialId, scope: pra._kelompok, previewHash: pra.hash, previewCount: pra.penerapan.jumlah, previewValue: pra.penerapan.nilai.toString(), requestedById: aktor.id, idempotencyKey: idem } });
    return { ulang: false, ...tampil(b) };
  } catch (e) {
    if (e?.code === "P2002") { const s = await prisma.finMaterialValueSettlement.findUnique({ where: { idempotencyKey: idem } }); if (s) return { ulang: true, ...tampil(s) }; throw new KoreksiError("Sudah ada pengajuan penetapan yang menunggu untuk bahan ini — setujui, tolak, atau batalkan dulu (satu sumber nilai per bahan)", 409, "SATU_PENGAJUAN_AKTIF"); }
    throw e;
  }
}

export async function setujuiPenetapan(prisma, { id, hashPratinjau, aktor, catatan = null }) {
  wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB");
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "fin_material_value_settlements", id);
    const b = await tx.finMaterialValueSettlement.findUnique({ where: { id } }); wajib(b, "Penetapan tidak ditemukan", "TIDAK_ADA", 404);
    if (b.status === "DISETUJUI") return { ulang: true, ...tampil(b) };
    wajib(b.status === "DIAJUKAN", `Penetapan berstatus ${b.status} tidak bisa disetujui`, "STATUS_FINAL", 409);
    wajib(!b.requestedById || b.requestedById !== aktor.id, "Pengaju tidak boleh menyetujui penetapannya sendiri — minta penyetuju lain", "PEMOHON_SAMA", 403);
    wajib(String(hashPratinjau ?? "") === b.previewHash, "Pratinjau yang Anda setujui berbeda dari yang diajukan", "PRATINJAU_BERBEDA", 409);
    await lockRowForUpdate(tx, "materials", b.materialId);
    const pra = await pratinjauPenetapan(tx, { materialId: b.materialId, groups: b.scope }, { lengkap: false });
    wajib(pra.hash === b.previewHash, `Keadaan sudah bergeser sejak diajukan (transaksi/sumber resmi): pratinjau kini ${pra.penerapan.jumlah} transaksi / Rp${pra.penerapan.nilai}, diajukan ${b.previewCount} / Rp${Number(b.previewValue)}. Tolak lalu ajukan ulang.`, "PRATINJAU_BERUBAH", 409);
    let jurnalPerlu = 0;
    for (const x of pra._terapkan) {
      const kor0 = await tx.finStockMovementValuationCorrection.findFirst({ where: { movementId: x.movementId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      const asal = await tx.stockMovement.findUnique({ where: { id: x.movementId }, select: { materialId: true, unitId: true, valuation: { select: { status: true, unitCostBasis: true, value: true } } } });
      const sebelum = kor0 ? { status: "DINILAI", unitCostBasis: String(kor0.unitCostBasis), value: String(kor0.value), sumber: "KOREKSI" } : asal.valuation ? { status: asal.valuation.status, unitCostBasis: asal.valuation.unitCostBasis == null ? null : String(asal.valuation.unitCostBasis), value: asal.valuation.value == null ? null : String(asal.valuation.value), sumber: "BEKU" } : { status: "ESTIMASI_HISTORIS", unitCostBasis: null, value: null, sumber: "ESTIMASI" };
      if (await tx.finJournalEntry.findFirst({ where: { idempotencyKey: `PEMAKAIAN_BAHAN_MOVEMENT:${x.movementId}`, status: { in: ["POSTED", "REVERSED"] } }, select: { id: true } })) jurnalPerlu++;
      await tx.finStockMovementValuationCorrection.create({ data: { movementId: x.movementId, materialId: asal.materialId, unitId: asal.unitId, before: sebelum,
        after: { status: "DINILAI", unitCostBasis: x.harga.toDecimalPlaces(8).toString(), value: String(x.nilaiBaru), sumber: "NILAI_RESMI", settlementId: b.id, kelompok: x.kelompok, dasar: { pembuka: x.h.sumber.pembuka, penerimaan: x.h.sumber.penerimaan } },
        unitCostBasis: x.harga.toDecimalPlaces(8).toString(), value: String(x.nilaiBaru), reason: `Nilai resmi ${x.kelompok} (Persediaan Awal + GR) — penetapan ${b.id.slice(0, 8)}`.slice(0, 480), createdById: aktor.id, idempotencyKey: `PN:${b.id}:${x.movementId}`, settlementId: b.id } });
    }
    const baru = await tx.finMaterialValueSettlement.update({ where: { id: b.id }, data: { status: "DISETUJUI", decidedById: aktor.id, decidedAt: new Date(), decisionNote: catatan ? String(catatan).slice(0, 500) : null, appliedCount: pra._terapkan.length } });
    return { ulang: false, ...tampil(baru), jurnalPerluPenyesuaian: jurnalPerlu };
  }, { timeout: 120_000, maxWait: 30_000 });
}
async function akhiri(prisma, { id, aktor, catatan, status, hanyaPemohon }) {
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "fin_material_value_settlements", id);
    const b = await tx.finMaterialValueSettlement.findUnique({ where: { id } }); wajib(b, "Penetapan tidak ditemukan", "TIDAK_ADA", 404);
    if (b.status === status) return { ulang: true, ...tampil(b) };
    wajib(b.status === "DIAJUKAN", `Penetapan berstatus ${b.status} tidak bisa diubah`, "STATUS_FINAL", 409);
    if (hanyaPemohon) wajib(b.requestedById === aktor.id, "Hanya pengaju yang dapat membatalkan pengajuannya", "BUKAN_PEMOHON", 403);
    else { wajib(!b.requestedById || b.requestedById !== aktor.id, "Pengaju tidak memutuskan pengajuannya sendiri — gunakan Batalkan", "PEMOHON_SAMA", 403); wajib(String(catatan ?? "").trim().length >= 5, "Alasan penolakan wajib diisi (min 5 karakter)", "ALASAN_WAJIB"); }
    return { ulang: false, ...tampil(await tx.finMaterialValueSettlement.update({ where: { id }, data: { status, decidedById: aktor.id, decidedAt: new Date(), decisionNote: catatan ? String(catatan).slice(0, 500) : null } })) };
  }, { timeout: 30_000, maxWait: 10_000 });
}
export const tolakPenetapan = (prisma, a) => akhiri(prisma, { ...a, status: "DITOLAK", hanyaPemohon: false });
export const batalkanPenetapan = (prisma, a) => akhiri(prisma, { ...a, status: "DIBATALKAN", hanyaPemohon: true });
const tampil = (b) => ({ id: b.id, bahanId: b.materialId, status: b.status, kelompok: b.scope, pratinjau: { hash: b.previewHash, transaksi: b.previewCount, nilai: Number(b.previewValue) }, diajukanOleh: b.requestedById, diajukanPada: b.requestedAt, diputuskanOleh: b.decidedById, diputuskanPada: b.decidedAt, catatanKeputusan: b.decisionNote, diterapkan: b.appliedCount });
export async function daftarPenetapan(db, { materialId = null, status = null } = {}) {
  const baris = await db.finMaterialValueSettlement.findMany({ where: { ...(materialId ? { materialId } : {}), ...(status ? { status } : {}) }, orderBy: { requestedAt: "desc" }, take: 200, include: { material: { select: { code: true, name: true, unit: true } } } });
  return baris.map((b) => ({ ...tampil(b), bahan: { kode: b.material.code, nama: b.material.name, satuan: b.material.unit } }));
}
export async function bacaPenetapan(db, id) {
  const b = await db.finMaterialValueSettlement.findUnique({ where: { id }, include: { material: { select: { code: true, name: true, unit: true } }, corrections: { orderBy: { createdAt: "asc" }, select: { movementId: true, value: true, unitCostBasis: true, createdAt: true, createdById: true, after: true } } } });
  if (!b) return null;
  return { ...tampil(b), bahan: { kode: b.material.code, nama: b.material.name, satuan: b.material.unit }, koreksi: b.corrections.map((k) => ({ movementId: k.movementId, nilai: Number(k.value), harga: Number(k.unitCostBasis), dasar: k.after?.dasar ?? null, waktu: k.createdAt, oleh: k.createdById })) };
}

// ── daftar bahan tanpa harga (layar awal) ────────────────────────────────────────────────────────
export async function daftarBahanTanpaHarga(db, { q = "" } = {}) {
  const bahan = await db.$queryRawUnsafe(`select m.id::text id, m.code kode, m.name nama, m.unit satuan, m.reference_unit_cost::float referensi, m.reference_unit_cost_month bulan_referensi,
      (select coalesce(sum(x.qty),0)::float from stock_movements x where x.material_id = m.id) saldo,
      (select count(*)::int from stock_movements r where r.material_id = m.id and r.type = 'RECEIPT' and r.unit_cost > 0 and r.qty > 0) penerimaan_berharga
    from materials m ${q ? "where m.code ilike $1 or m.name ilike $1" : ""} order by m.code`, ...(q ? [`%${q}%`] : []));
  const rencana = await rencanakanPosting(db); const siapPer = new Map();
  for (const t of rencana.transaksi) { const x = siapPer.get(t.materialId) ?? { trx: 0, qty: 0, order: new Set() }; x.trx++; x.qty += t.qty; x.order.add(t.orderNumber); siapPer.set(t.materialId, x); }
  const mv = await db.$queryRawUnsafe(`select s.material_id::text mid, s.created_at, abs(s.qty)::float qty, v.status vs, (select count(*) from fin_stock_movement_valuation_corrections c where c.movement_id = s.id)::int nkor from stock_movements s left join fin_stock_movement_valuations v on v.movement_id = s.id where s.unit_id is not null and s.type in ('ISSUE','RETURN','WASTE','ADJUSTMENT')`);
  const pm = new Map(); for (const x of mv) { if (x.nkor > 0 || x.vs === "DINILAI") continue; const e = pm.get(x.mid) ?? { beku: 0, lama: 0, qty: 0, awal: null, akhir: null }; if (x.vs === "TANPA_HARGA") e.beku++; else e.lama++; e.qty += x.qty; const t = wibTgl(x.created_at); e.awal = !e.awal || t < e.awal ? t : e.awal; e.akhir = !e.akhir || t > e.akhir ? t : e.akhir; pm.set(x.mid, e); }
  const tertahan = new Map((await db.$queryRawUnsafe(`select material_id::text mid, count(*)::int n from unit_usage_notes where origin = 'EXCEL' and state = 'PERLU_DICEK' and material_id is not null group by 1`)).map((t) => [t.mid, t.n]));
  const pend = new Map((await db.finMaterialValueSettlement.findMany({ where: { status: "DIAJUKAN" }, select: { id: true, materialId: true } })).map((p) => [p.materialId, p.id]));
  const hasil = [];
  for (const b of bahan) {
    const e = pm.get(b.id); const siap = siapPer.get(b.id); const nSiap = siap?.trx ?? 0;
    if (!(e || nSiap)) continue;
    const psa = await barisPembukaResmi(db, b.id);
    const sebab = psa ? "PERSEDIAAN_AWAL_RESMI_ADA" : b.penerimaan_berharga === 0 ? (b.saldo > 0 ? "SALDO_PEMBUKA_BELUM_PUNYA_HARGA_RESMI" : "BELUM_ADA_SUMBER_RESMI") : "HANYA_PENERIMAAN_BERHARGA";
    hasil.push({ bahanId: b.id, kode: b.kode, nama: b.nama, satuan: b.satuan, saldo: Math.round(b.saldo * 1e4) / 1e4, sebab,
      sumberResmi: { persediaanAwal: psa ? { nomor: psa.nomor, status: psa.status, harga: Number(psa.harga) } : null, penerimaanBerharga: b.penerimaan_berharga },
      kelompok1_dipostingTanpaHarga: e?.beku ?? 0, kelompok2_issueLamaBelumDinilai: e?.lama ?? 0, rentangTanggal: e ? { dari: e.awal, sampai: e.akhir } : null, qtyBelumBernilai: Math.round((e?.qty ?? 0) * 1e4) / 1e4,
      kelompok3_siapPosting: { transaksi: nSiap, qty: Math.round((siap?.qty ?? 0) * 1e4) / 1e4, order: siap?.order.size ?? 0 }, kelompok3_tertahanSelainHarga: tertahan.get(b.id) ?? 0,
      pembanding: { referensi: b.referensi ? { harga: b.referensi, bulan: b.bulan_referensi, catatan: "pembanding saja" } : null }, pengajuanAktif: pend.get(b.id) ?? null });
  }
  return hasil.sort((a, b) => (b.kelompok1_dipostingTanpaHarga + b.kelompok2_issueLamaBelumDinilai + b.kelompok3_siapPosting.transaksi) - (a.kelompok1_dipostingTanpaHarga + a.kelompok2_issueLamaBelumDinilai + a.kelompok3_siapPosting.transaksi));
}
export { statusBuktiGR, tentatifDariSumber };
