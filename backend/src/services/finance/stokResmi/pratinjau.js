// PRATINJAU dokumen stok resmi — BACA-SAJA (tidak pernah menulis). Menjawab: apa yang berubah (kuantitas & nilai), akun debit–kredit yang AKAN dipakai, dokumen sumber, gap tanpa harga,
// dan kenapa ditolak. Pratinjau memakai fungsi harga/akun/cutover yang SAMA dengan posting (services/finance/posting/inventory.js) — tes membuktikan baris pratinjau = baris jurnal yang diposting.
import { toMoney, sumMoney, moneyToNumber, ZERO, Decimal } from "../money.js";
import { resolveAccount, AccountError, SYSTEM_KEYS } from "../accounts.js";
import { findEntryByKey } from "../journal.js";
import { dasarHargaRataRata } from "../posting/inventory.js";
import { statusCutoverUntuk, saldoPersediaanSampai, kunciWIB } from "../persediaanAwal.js";
import { getSettingRaw, parseBool, SETTING_KEYS } from "../settings.js";
import { muatDokumen } from "./dokumen.js";
import { JENIS, KODE, PESAN, SEMUA_JENIS, SAKELAR, StokResmiError } from "./matriks.js";

const rp = (d) => moneyToNumber(d);
const info = (kode, extra = {}) => ({ kode, pesan: PESAN[kode], ...extra });

/** Pemakaian bahan yang dicatat PIC (bukti langkah produksi) vs pemakaian yang tercatat di stok pada jendela yang sama — INFORMASI pembanding, tidak pernah dijurnal/diatribusikan. */
export async function pemakaianPicPembanding(db, materialIds, dari, sampai) {
  if (!materialIds.length || !dari) return [];
  const bukti = await db.productionStepEvidence.findMany({
    where: { stepNo: { in: [6, 7, 10] }, NOT: { stepCode: { startsWith: "DOC_" } }, createdAt: { gte: dari, lte: sampai } },
    select: { payload: true },
  });
  const pic = new Map();
  for (const b of bukti) for (const m of Array.isArray(b.payload?.materials) ? b.payload.materials : []) {
    if (materialIds.includes(m?.materialId) && Number(m?.qty) > 0) pic.set(m.materialId, (pic.get(m.materialId) ?? 0) + Number(m.qty));
  }
  if (pic.size === 0) return [];
  const issue = await db.stockMovement.groupBy({ by: ["materialId"], where: { materialId: { in: [...pic.keys()] }, type: "ISSUE", createdAt: { gte: dari, lte: sampai } }, _sum: { qty: true } });
  const tercatat = new Map(issue.map((x) => [x.materialId, Math.abs(Number(x._sum.qty ?? 0))]));
  return [...pic.entries()].map(([materialId, picQty]) => ({ materialId, picQty, tercatatDiStok: tercatat.get(materialId) ?? 0, belumTercatat: Math.max(0, Math.round((picQty - (tercatat.get(materialId) ?? 0)) * 10000) / 10000) }))
    .filter((x) => x.belumTercatat > 0);
}

/** Sakelar + tanggal mulai UNTUK SATU JENIS dokumen (dibaca sekali; baca-saja). Jenis tanpa sakelar (Return Record) = tidak pernah aktif. */
export async function bacaPengaturanPosting(db, jenis) {
  const s = SAKELAR[jenis];
  if (!s) return { aktif: false, sejak: null, kunci: null, tanpaSakelar: true };
  return {
    aktif: parseBool(await getSettingRaw(db, s.aktif)),
    sejak: (await getSettingRaw(db, s.sejak)) || null,
    kunci: { aktif: s.aktif, sejak: s.sejak },
  };
}

/**
 * Evaluasi dokumen: penolakan keras (membatalkan posting) + peringatan + status ringkas. Dipakai pratinjau DAN posting.
 * `untukPosting` = aturan posting (sakelar, tanggal mulai, dokumen final) ikut diperiksa; pratinjau hanya melaporkannya sebagai catatan.
 */
export function evaluasiAturan(d, pengaturan, { untukPosting = false } = {}) {
  const penolakan = [...d.aturan]; const catatan = [];
  const tambah = (arr, x) => arr.push(x);
  tambah(untukPosting ? penolakan : catatan, !pengaturan.aktif ? info(KODE.FITUR_BELUM_AKTIF) : null);
  if (!pengaturan.sejak) tambah(untukPosting ? penolakan : catatan, info(KODE.TANGGAL_AKTIVASI_BELUM_DIISI));
  else if (kunciWIB(d.tanggal) < pengaturan.sejak) tambah(untukPosting ? penolakan : catatan, info(KODE.DI_LUAR_PERIODE_AKTIVASI, { tanggalDokumen: kunciWIB(d.tanggal), sejak: pengaturan.sejak }));
  if (!d.final) tambah(untukPosting ? penolakan : catatan, info(KODE.DOKUMEN_BELUM_FINAL, { status: d.status }));
  else if (d.niat.length === 0) penolakan.push(info(KODE.TANPA_PERGERAKAN));
  return { penolakan: penolakan.filter(Boolean), catatan: catatan.filter(Boolean) };
}

export async function pratinjau(db, jenis, id, { resolusi = null, sekarang = new Date(), pengaturan = null } = {}) {
  if (!SEMUA_JENIS.includes(jenis)) throw new StokResmiError(`Jenis dokumen tidak dikenal: ${jenis}`, 400, "JENIS_TIDAK_DIKENAL");
  const d = await muatDokumen(db, jenis, id, { resolusi, sekarang });
  if (!d) throw new StokResmiError("Dokumen tidak ditemukan", 404, "DOKUMEN_TIDAK_ADA");
  const set = pengaturan ?? await bacaPengaturanPosting(db, jenis);
  const { penolakan, catatan } = evaluasiAturan(d, set);
  const peringatan = [...catatan];

  const cut = await statusCutoverUntuk(db, d.tanggal);
  const sudah = await findEntryByKey(db, d.kunci);
  if (sudah) penolakan.push(info(sudah.status === "REVERSED" ? KODE.SUDAH_DIBALIK : KODE.SUDAH_DIPOSTING, { nomorJurnal: sudah.entryNumber, statusJurnal: sudah.status }));

  // ── nilai per baris ──
  // Nilai beku pergerakan (jejak biaya) adalah sumber tunggal bila ada — SAMA dengan bukukanPergerakan; selain itu rata-rata tertimbang pada saat pergerakan.
  const idPergerakan = d.niat.map((n) => n.movementId).filter(Boolean);
  const beku = new Map((idPergerakan.length ? await db.finStockMovementValuation.findMany({ where: { movementId: { in: idPergerakan } }, select: { movementId: true, status: true, value: true } }) : []).map((v) => [v.movementId, v]));
  const perBaris = []; const gap = [];
  for (const n of d.niat) {
    const bk = n.movementId ? beku.get(n.movementId) : null;
    const dasar = bk?.status === "DINILAI" && bk.value != null ? { harga: null, beku: toMoney(new Decimal(String(bk.value)).abs()) } : await dasarHargaRataRata(db, n.materialId, { asOf: n.at ?? sekarang });
    const baris = { materialId: n.materialId, kode: n.material?.code ?? null, nama: n.material?.name ?? null, satuan: n.material?.unit ?? null, tipe: n.tipe, qty: n.qty, movementId: n.movementId, hargaSatuan: null, nilai: null, dasarHarga: null };
    if (dasar.beku) {
      baris.nilai = rp(dasar.beku); baris.dasarHarga = { metode: "NILAI_BEKU_PERGERAKAN" };
    } else if (dasar.harga == null) {
      gap.push(info(KODE.TANPA_HARGA_PEROLEHAN, { materialId: n.materialId, kodeMaterial: baris.kode, qty: n.qty }));
    } else {
      const nilai = toMoney(new Decimal(String(Math.abs(n.qty))).times(dasar.harga));
      baris.hargaSatuan = dasar.harga.toDecimalPlaces(4).toString(); baris.nilai = rp(nilai);
      baris.dasarHarga = { metode: "RATA_RATA_TERTIMBANG", totalQty: dasar.totalQty.toString(), jumlahSumberPenerimaan: dasar.sumber.length, persediaanAwal: dasar.opening };
    }
    perBaris.push(baris);
  }

  // ── jurnal (cerminan bukukanPergerakan: turun → Dr beban / Cr persediaan; naik → Dr persediaan / Cr beban; dua arah TIDAK di-netto) ──
  let akunOk = true; const akunInfo = {};
  for (const key of [SYSTEM_KEYS.PERSEDIAAN_BAHAN, SYSTEM_KEYS[d.akunKey]]) {
    try { const a = await resolveAccount(db, key); akunInfo[key] = { id: a.id, kode: a.code, nama: a.name, systemKey: key }; } catch (e) { if (!(e instanceof AccountError)) throw e; akunOk = false; }
  }
  if (!akunOk) penolakan.push(info(KODE.AKUN_SISTEM_BELUM_SIAP));
  const berharga = perBaris.filter((b) => b.nilai != null && b.nilai > 0);
  const turun = berharga.filter((b) => b.qty < 0); const naik = berharga.filter((b) => b.qty > 0);
  const totalTurun = turun.length ? sumMoney(turun.map((b) => toMoney(b.nilai))) : ZERO;
  const totalNaik = naik.length ? sumMoney(naik.map((b) => toMoney(b.nilai))) : ZERO;
  const baris = [];
  const beban = akunInfo[SYSTEM_KEYS[d.akunKey]]; const pers = akunInfo[SYSTEM_KEYS.PERSEDIAAN_BAHAN];
  if (akunOk) {
    if (totalTurun.greaterThan(0)) { baris.push({ akun: beban, debit: rp(totalTurun), kredit: 0, keterangan: `${turun.length} baris bahan berkurang` }); }
    if (totalNaik.greaterThan(0)) { baris.push({ akun: beban, debit: 0, kredit: rp(totalNaik), keterangan: `${naik.length} baris bahan bertambah` }); }
    if (totalTurun.greaterThan(0)) baris.push({ akun: pers, debit: 0, kredit: rp(totalTurun), keterangan: "Persediaan bahan berkurang" });
    if (totalNaik.greaterThan(0)) baris.push({ akun: pers, debit: rp(totalNaik), kredit: 0, keterangan: "Persediaan bahan bertambah" });
  }
  const dr = baris.reduce((a, b) => a + b.debit, 0); const kr = baris.reduce((a, b) => a + b.kredit, 0);

  // ── cutover / saldo buku ──
  let akanDibukukan = baris.length > 0 && gap.length === 0 ? true : baris.length > 0 && gap.length < perBaris.length;
  if (cut.status === "tertutup") { peringatan.push(info(KODE.TERCAKUP_PERSEDIAAN_AWAL)); akanDibukukan = false; }
  if (cut.status === "tunggu_pembuka") { peringatan.push(info(KODE.PERSEDIAAN_AWAL_BELUM_DIPOSTING)); akanDibukukan = false; }
  if (gap.length > 0) peringatan.push(info(KODE.TANPA_HARGA_PEROLEHAN, { jumlahMaterial: new Set(gap.map((g) => g.materialId)).size }));
  const saldoBuku = await saldoPersediaanSampai(db, kunciWIB(d.tanggal));
  if (totalTurun.greaterThan(0) && toMoney(saldoBuku).lessThan(totalTurun)) peringatan.push(info(KODE.SALDO_BUKU_PERSEDIAAN_KURANG, { saldoBuku: rp(toMoney(saldoBuku)), nilaiKeluar: rp(totalTurun) }));

  // ── pembanding pemakaian PIC (informasi, bukan atribusi) ──
  let picInfo = [];
  if ([JENIS.STOCK_COUNT, JENIS.STOCK_ADJUSTMENT].includes(jenis) && d.niat.some((n) => n.qty < 0)) {
    picInfo = await pemakaianPicPembanding(db, [...new Set(d.niat.filter((n) => n.qty < 0).map((n) => n.materialId))], d.windowDari, d.windowSampai ?? sekarang);
    if (picInfo.length) peringatan.push(info(KODE.PEMAKAIAN_PIC_BELUM_TERCATAT, { materialAda: picInfo.length }));
  }

  const status = d.aturan.length || (penolakan.some((p) => [KODE.SUDAH_DIPOSTING, KODE.SUDAH_DIBALIK, KODE.TANPA_PERGERAKAN, KODE.AKUN_SISTEM_BELUM_SIAP].includes(p.kode))) ? "DITOLAK"
    : !d.final ? "BELUM_FINAL" : cut.status === "tertutup" ? "TIDAK_PERLU_JURNAL" : cut.status === "tunggu_pembuka" ? "MENUNGGU_PERSEDIAAN_AWAL" : gap.length === perBaris.length && perBaris.length > 0 ? "MENUNGGU_HARGA" : "SIAP";
  const siapDiposting = status === "SIAP" && !penolakan.some((p) => p.kode !== KODE.SUDAH_DIPOSTING) && !sudah && set.aktif && !!set.sejak && kunciWIB(d.tanggal) >= set.sejak;

  return {
    jenis, dokumen: { id: d.id, nomor: d.nomor, status: d.status, tanggal: kunciWIB(d.tanggal), final: d.final, meta: d.meta },
    status, siapDiposting, sakelar: set,
    kuantitas: perBaris.map((b) => ({ materialId: b.materialId, kode: b.kode, nama: b.nama, satuan: b.satuan, tipe: b.tipe, qty: b.qty, movementId: b.movementId })),
    nilai: { total: rp(sumMoney(berharga.map((b) => toMoney(b.nilai)).concat([ZERO]))), perBaris },
    jurnal: { tanggal: kunciWIB(d.tanggal), sumber: "PEMAKAIAN_BAHAN", kunciIdempotensi: d.kunci, akanDibukukan, baris, totalDebit: dr, totalKredit: kr, seimbang: Math.abs(dr - kr) < 0.005 },
    dokumenSumber: { jenis, id: d.id, nomor: d.nomor, pergerakan: d.niat.map((n) => n.movementId).filter(Boolean) },
    statusCutover: { status: cut.status, cutover: cut.kebijakan?.cutover ?? null, persediaanAwal: cut.aktif ? { nomor: cut.aktif.number } : null },
    gapTanpaHarga: gap, penolakan, peringatan,
    atribusi: { keOrder: false, keUnit: false, catatan: "Selisih hasil hitung fisik / susut TIDAK diatribusikan ke HPP order atau unit. Jurnal tanpa dimensi unit/order (akun agregat)." },
    pembandingPemakaianProduksi: picInfo,
    sudahDiposting: sudah ? { nomorJurnal: sudah.entryNumber, status: sudah.status, tanggal: kunciWIB(sudah.date) } : null,
    dampakLaporan: "Masuk kelompok Beban Pokok pada Laba Rugi (akun 5-1960 / 5-1900) sebagai baris tersendiri; tidak mengubah HPP per unit/order maupun nilai beku jejak biaya.",
  };
}
