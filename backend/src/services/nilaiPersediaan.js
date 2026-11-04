// NILAI PERSEDIAAN (kandidat laporan baca-saja, Nov 2026). TIGA angka yang TIDAK pernah dicampur:
//   1. ESTIMASI NILAI STOK = saldo pada waktu acuan × Harga Berlaku pada waktu acuan yang SAMA (HPP operasional; harga kerja Gudang, BUKAN nilai buku, BUKAN hasil stok fisik final).
//      Dua versi: BERDASARKAN LEDGER (semua bahan bersaldo & ber-harga, termasuk yang hasil SO-nya belum direkonsiliasi) dan YANG MENGECUALIKAN HASIL SO BERMASALAH.
//   2. SALDO AKUN PERSEDIAAN FINANCE = saldo akun sistem PERSEDIAAN_BAHAN (jurnal GR/PSA/pemakaian). Status "belum direkonsiliasi" selama masih ada sebabnya; TIDAK dialokasikan ke bahan.
//   3. BAHAN BELUM BISA DINILAI = pengecualian yang ditampilkan apa adanya. TIDAK PERNAH dijumlah sebagai Rp0.
// Hasil SO (services/hasilSO.js; pengamatan dalam satuan lain, nol dikonfirmasi) dibaca dari catatan berizin & beraudit — bukan dari fin_settings dan bukan dari kode. Modul ini hanya MEMBACA.
// Nominal hanya untuk pemegang izin finance:read (diputuskan pemanggil: `bolehNominal`).
import { AWALAN_KUNCI_PO } from "./finance/hargaBerlaku.js";
import { klasifikasiSaldo, KEADAAN_SALDO, nolTerverifikasiPer } from "./keadaanSaldo.js";
import { hasilSOTerkini, JENIS } from "./hasilSO.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P } from "../constants/permissions.js";

export const STATUS = Object.freeze({
  DINILAI: "DINILAI", SALDO_NOL: "SALDO_NOL", STOK_BELUM_DIKETAHUI: "STOK_BELUM_DIKETAHUI", HARGA_KOSONG: "HARGA_KOSONG", SALDO_MINUS: "SALDO_MINUS", SATUAN_TIDAK_COCOK: "SATUAN_TIDAK_COCOK", PENGAMATAN_FISIK: "PENGAMATAN_FISIK",
});
export const LABEL_STATUS = Object.freeze({
  DINILAI: "Dinilai", SALDO_NOL: "Saldo nol", STOK_BELUM_DIKETAHUI: "Stok belum diketahui", HARGA_KOSONG: "Harga kosong", SALDO_MINUS: "Saldo minus", SATUAN_TIDAK_COCOK: "Satuan tidak cocok", PENGAMATAN_FISIK: "Terukur dalam satuan lain",
});
/** Pengecualian = bahan RELEVAN yang belum bisa dinilai. Saldo nol bukan pengecualian tetapi tetap dihitung dan ditampilkan. */
export const STATUS_PENGECUALIAN = Object.freeze([STATUS.STOK_BELUM_DIKETAHUI, STATUS.HARGA_KOSONG, STATUS.SALDO_MINUS, STATUS.SATUAN_TIDAK_COCOK, STATUS.PENGAMATAN_FISIK]);
const URUT_RISIKO = Object.freeze({ DINILAI: 0, SALDO_MINUS: 1, SATUAN_TIDAK_COCOK: 2, HARGA_KOSONG: 3, PENGAMATAN_FISIK: 4, STOK_BELUM_DIKETAHUI: 5, SALDO_NOL: 6 });
export const DEFINISI = Object.freeze({
  estimasi: "Saldo stok pada waktu acuan × Harga Berlaku pada waktu acuan yang sama. Harga kerja Gudang (HPP operasional) — bukan nilai buku, bukan nilai Finance, dan bukan hasil stok fisik final.",
  ledger: "Berdasarkan ledger: seluruh bahan bersaldo dan ber-harga menurut catatan stok, termasuk bahan yang hasil SO-nya belum direkonsiliasi dengan ledger.",
  tanpaBermasalah: "Tanpa hasil SO bermasalah: mengecualikan bahan yang punya hasil SO tercatat tetapi belum sejalan dengan ledger (terukur dalam satuan lain, atau fisik nol dikonfirmasi sementara ledger masih berisi/minus).",
  finance: "Saldo akun Persediaan Bahan Baku di buku besar Finance (jurnal penerimaan GR, Persediaan Awal, pemakaian). Tidak dialokasikan ke bahan; status rekonsiliasi dijelaskan di bawah.",
  relevan: "Bahan aktif, atau nonaktif tetapi masih bersaldo ≠ 0 pada waktu acuan, KECUALI yang saldonya nol menurut catatan (tidak ada yang perlu dinilai). Bahan yang belum punya catatan stok TERMASUK relevan (stoknya belum diketahui).",
  waktu: "Satu waktu acuan dipakai untuk saldo (pergerakan ≤ waktu) dan Harga Berlaku (berlaku ≤ waktu). Harga yang dijadwalkan sesudah waktu itu tidak dipakai.",
  hasilSO: "Hasil SO per bahan dicatat lewat jalur berizin dan beraudit (sumber, tanggal SO, pelaku, satuan, alasan, riwayat koreksi). Pencatatan tidak menulis ledger dan tidak membuat ADJUSTMENT.",
  nilaiParsial: "Nilai parsial berdasarkan biaya penerimaan terakhir: hanya bahan yang pernah punya biaya penerimaan, dihitung biaya penerimaan terakhir × saldo (termasuk saldo minus). Bukan Estimasi nilai stok dan bukan saldo akun Finance; ditampilkan hanya sebagai rincian.",
});
const EPS = 1e-6; const r4 = (v) => Math.round(Number(v ?? 0) * 10000) / 10000;
const wibTgl = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const NF = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 });
const tglIndo = (t) => { const [y, m, d] = String(t).split("-"); return `${Number(d)} ${["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][Number(m) - 1]} ${y}`; };
/** Peran yang efektif memegang finance:read (dan inventory:read) — dihitung dari peta izin, bukan ditulis tangan. */
export const peranPelihatNominal = () => Object.entries(ROLE_PERMISSIONS).filter(([, izin]) => izin.includes(P.FINANCE_READ) && izin.includes(P.INVENTORY_READ)).map(([r]) => r).sort();

export const STATUS_HASIL_SO = Object.freeze({
  TERBUKA_SATUAN: "Pengecualian satuan masih terbuka", BELUM_DISAHKAN_STOCK_COUNT: "Fisik nol dikonfirmasi Owner, belum disahkan melalui Stock Count", SEJALAN_BELUM_DISAHKAN: "Sejalan dengan saldo nol, belum disahkan melalui Stock Count",
  SELISIH_BELUM_DIREKONSILIASI: "Selisih dengan ledger belum direkonsiliasi", KEDALUWARSA_PERGERAKAN_BARU: "Tidak lagi mewakili saldo sekarang (ada pergerakan sesudah tanggal SO)",
});
/** Murni. Status rekonsiliasi satu hasil SO terhadap ledger SEKARANG. `sesudah` = { padaTanggal, jumlah, net, terakhir } pergerakan pada/sesudah tanggal SO (dari layanan). */
export function statusHasilSO({ so, keadaan, saldo }) {
  const s0 = so.sesudah ?? { padaTanggal: 0, jumlah: 0, net: 0, terakhir: null }; const kedaluwarsa = s0.jumlah > 0;
  if (so.jenis === JENIS.PENGAMATAN_SATUAN) return { status: "TERBUKA_SATUAN", kedaluwarsa, bermasalah: true };
  if (kedaluwarsa) return { status: "KEDALUWARSA_PERGERAKAN_BARU", kedaluwarsa: true, bermasalah: true };
  if (keadaan === KEADAAN_SALDO.BELUM_ADA_CATATAN) return { status: "BELUM_DISAHKAN_STOCK_COUNT", kedaluwarsa: false, bermasalah: false };
  if (Math.abs(saldo) <= EPS) return { status: "SEJALAN_BELUM_DISAHKAN", kedaluwarsa: false, bermasalah: false };
  return { status: "SELISIH_BELUM_DIREKONSILIASI", kedaluwarsa: false, bermasalah: true };
}
const ringkasSO = (so, st = null) => ({ urutan: so.urutan ?? null, status: st?.status ?? null, statusTeks: st ? STATUS_HASIL_SO[st.status] : null, kedaluwarsa: !!st?.kedaluwarsa, pergerakanSesudah: so.sesudah ?? { padaTanggal: 0, jumlah: 0, net: 0, terakhir: null }, id: so.id, jenis: so.jenis, jumlah: so.jumlah, satuan: so.satuan, soTanggal: so.soTanggal, soWaktu: so.soWaktu, sumber: so.sumber, alasan: so.alasan, pelaku: so.pelaku?.nama ?? null, dicatatPada: so.dicatatPada, revisi: so.revisi ?? 1 });

/** Murni. Satu baris bahan → status + nilai. nilai = null untuk SEMUA yang bukan DINILAI/SALDO_NOL (tidak pernah Rp0 palsu). `nilaiLedger` = estimasi berbasis ledger (juga untuk bahan terukur dalam satuan lain). */
export function klasifikasiBaris({ bahan, saldo, jumlahPergerakan, nolTerverifikasi = false, harga = null, hasilSO = null }) {
  const keadaan = klasifikasiSaldo({ jumlahPergerakan, saldo, nolTerverifikasi }); const so = hasilSO ?? null; const st = so ? statusHasilSO({ so, keadaan, saldo }) : null;
  const dasar = { materialId: bahan.id, kode: bahan.code, nama: bahan.name, satuan: bahan.unit, kategori: bahan.category ?? null, aktif: bahan.active !== false, keadaanSaldo: keadaan, saldo: keadaan === KEADAAN_SALDO.BELUM_ADA_CATATAN ? null : r4(saldo),
    harga: harga ? { nilai: harga.harga, satuan: harga.satuan, berlakuSejak: harga.berlakuMulai, sumber: harga.sumber, labelBukti: harga.label } : null, nilai: null, nilaiLedger: null, hasilSO: so ? ringkasSO(so, st) : null, hasilSOBermasalah: false, pengamatan: so?.jenis === JENIS.PENGAMATAN_SATUAN ? `${NF.format(so.jumlah)} ${so.satuan}` : null };
  const hargaCocok = harga && String(harga.satuan ?? "").toUpperCase() === String(bahan.unit ?? "").toUpperCase();
  const soTxt = so ? `SO ${tglIndo(so.soTanggal)}${so.pelaku?.nama ? `, dicatat oleh ${so.pelaku.nama}` : ""}` : "";
  const sd = so?.sesudah; const catSesudah = so && sd ? (sd.jumlah > 0 ? ` PERINGATAN: ada ${sd.jumlah} pergerakan sesudah tanggal SO (net ${NF.format(r4(sd.net))}${sd.terakhir ? `, terakhir ${tglIndo(wibTgl(sd.terakhir))}` : ""}) — catatan SO ini tidak lagi mewakili saldo sekarang.` : "") + (sd.padaTanggal > 0 ? ` ${sd.padaTanggal} pergerakan terjadi pada tanggal SO (jam SO belum diketahui).` : "") : "";
  if (so?.jenis === JENIS.PENGAMATAN_SATUAN) {
    const nilaiLedger = saldo > EPS && hargaCocok ? r4(saldo * harga.harga) : null;
    return { ...dasar, status: STATUS.PENGAMATAN_FISIK, hasilSOBermasalah: true, nilaiLedger, keterangan: `Terukur dalam ${so.satuan}: ${NF.format(so.jumlah)} ${so.satuan} (${soTxt}); belum terukur dalam satuan stok (${bahan.unit}). Tidak dikonversi dan tidak dinilai dari pengamatan. Pengecualian satuan masih terbuka.${catSesudah}` };
  }
  const nol = so?.jenis === JENIS.NOL_DIKONFIRMASI;
  if (keadaan === KEADAAN_SALDO.BELUM_ADA_CATATAN) return { ...dasar, status: STATUS.STOK_BELUM_DIKETAHUI, keterangan: nol ? `Fisik nol dikonfirmasi Owner (${soTxt}), belum disahkan melalui Stock Count; belum tercatat sebagai hasil SO di ledger. Saldo sistem belum diketahui — bukan "sudah sesuai".${catSesudah}` : "Belum ada catatan stok — saldo belum diketahui (bukan Rp0)." };
  if (keadaan === KEADAAN_SALDO.MINUS) return { ...dasar, status: STATUS.SALDO_MINUS, hasilSOBermasalah: nol, keterangan: `Saldo catatan minus (${r4(saldo)}) — tidak dinilai; perlu dihitung fisik.${nol ? ` Fisik nol dikonfirmasi (${soTxt}); belum direkonsiliasi dengan ledger dan belum disahkan melalui Stock Count.${catSesudah}` : ""}` };
  if (keadaan === KEADAAN_SALDO.NOL_MENURUT_PERGERAKAN || keadaan === KEADAAN_SALDO.NOL_TERVERIFIKASI) return { ...dasar, status: STATUS.SALDO_NOL, nilai: 0, nilaiLedger: 0, keterangan: (keadaan === KEADAAN_SALDO.NOL_TERVERIFIKASI ? "Nol terverifikasi hitung fisik." : "Nol menurut pergerakan.") + (nol ? ` Sejalan dengan hasil SO nol (${soTxt}); belum disahkan melalui Stock Count.${catSesudah}` : "") };
  if (!harga) return { ...dasar, status: STATUS.HARGA_KOSONG, hasilSOBermasalah: nol && st.bermasalah, keterangan: "Belum ada Harga Berlaku pada waktu acuan — tidak dinilai (bukan Rp0)." };
  if (!hargaCocok) return { ...dasar, status: STATUS.SATUAN_TIDAK_COCOK, hasilSOBermasalah: nol && st.bermasalah, keterangan: `Satuan harga ${harga.satuan} ≠ satuan stok ${bahan.unit} — tidak dikonversi otomatis.` };
  const nilai = r4(saldo * harga.harga);
  return { ...dasar, status: STATUS.DINILAI, nilai, nilaiLedger: nilai, hasilSOBermasalah: nol && st.bermasalah, keterangan: nol ? `Berbasis ledger. Fisik nol dikonfirmasi (${soTxt}) sementara ledger masih ${NF.format(r4(saldo))} ${bahan.unit}: selisih belum direkonsiliasi dan belum disahkan melalui Stock Count.${catSesudah}` : "" };
}

/** Murni. Cakupan dari daftar baris: universe, relevan, dinilai, pengecualian per status — SATU sumber untuk kartu & strip & tabel. */
export function ringkasCakupan(baris) {
  const per = {}; for (const b of baris) per[b.status] = (per[b.status] ?? 0) + 1;
  const dinilai = baris.filter((b) => b.status === STATUS.DINILAI); const saldoNol = per[STATUS.SALDO_NOL] ?? 0;
  const pengecualian = baris.filter((b) => STATUS_PENGECUALIAN.includes(b.status)); const relevan = dinilai.length + pengecualian.length;
  return { universe: baris.length, saldoNol, relevan, dinilai: dinilai.length, pengecualian: pengecualian.length, persenDinilai: relevan ? Math.round((dinilai.length / relevan) * 1000) / 10 : null, perStatus: per,
    dariPO: dinilai.filter((b) => b.harga?.sumber === "PO").length, hasilSOBermasalah: baris.filter((b) => b.hasilSOBermasalah).length, nolDikonfirmasiBelumDiLedger: baris.filter((b) => b.status === STATUS.STOK_BELUM_DIKETAHUI && b.hasilSO?.jenis === JENIS.NOL_DIKONFIRMASI).length, hasilSOTercatat: baris.filter((b) => b.hasilSO).length, hasilSOKedaluwarsa: baris.filter((b) => b.hasilSO?.kedaluwarsa).length, pengecualianSatuanTerbuka: baris.filter((b) => b.hasilSO?.status === "TERBUKA_SATUAN").length };
}
/** Murni. Dua estimasi dari baris yang sama: berdasarkan ledger vs yang mengecualikan hasil SO bermasalah. */
export function hitungEstimasi(baris) {
  const ledger = baris.reduce((a, b) => a + (b.nilaiLedger ?? 0), 0); const tanpa = baris.filter((b) => !b.hasilSOBermasalah).reduce((a, b) => a + (b.nilaiLedger ?? 0), 0);
  const bermasalah = baris.filter((b) => b.hasilSOBermasalah);
  return { nilaiLedger: Math.round(ledger), nilaiTanpaHasilSOBermasalah: Math.round(tanpa), bahanHasilSOBermasalah: bermasalah.length, nilaiHasilSOBermasalah: Math.round(bermasalah.reduce((a, b) => a + (b.nilaiLedger ?? 0), 0)), bahanLedgerBernilai: baris.filter((b) => (b.nilaiLedger ?? 0) > 0 || b.status === STATUS.DINILAI).length };
}
export const urutkanRisiko = (baris) => [...baris].sort((a, b) => URUT_RISIKO[a.status] - URUT_RISIKO[b.status] || (b.nilaiLedger ?? 0) - (a.nilaiLedger ?? 0) || String(a.kode).localeCompare(String(b.kode)));

/** Harga Berlaku pada `at` untuk semua bahan: aturan SAMA dengan hargaBerlaku.js (abaikan baris yang digantikan koreksi; ambil effectiveFrom ≤ at yang terakhir). Sumber "PO" bila kunci idempotensi berawalan po-harga:. */
async function hargaPada(db, at) {
  const semua = await db.materialHargaBerlaku.findMany({ orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  const diganti = new Set(semua.map((x) => x.correctsId).filter(Boolean)); const peta = new Map(); const t = new Date(at);
  for (const x of semua) { if (diganti.has(x.id) || new Date(x.effectiveFrom) > t) continue; peta.set(x.materialId, { harga: Number(x.unitPrice), satuan: x.satuan, berlakuMulai: x.effectiveFrom, sumber: String(x.idempotencyKey ?? "").startsWith(AWALAN_KUNCI_PO) ? "PO" : x.jenis === "KOREKSI" ? "KOREKSI" : "MANUAL", label: String(x.evidenceNote ?? "").trim() ? "ADA_CATATAN_BUKTI" : "BELUM_DIDUKUNG_BUKTI" }); }
  return peta;
}

/** Blok Finance: saldo akun persediaan + penyebab "belum direkonsiliasi" + bukti harga penerimaan (rincian, TIDAK mengalokasikan saldo akun ke bahan) + nilai parsial biaya penerimaan terakhir (rincian). */
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
  const parsial = (await db.$queryRaw`SELECT COUNT(*) FILTER (WHERE luc IS NOT NULL)::int AS dengan_biaya, COUNT(*) FILTER (WHERE luc IS NULL)::int AS tanpa_biaya, COALESCE(SUM(bal * luc) FILTER (WHERE luc IS NOT NULL),0)::float AS nilai, COALESCE(SUM(bal * luc) FILTER (WHERE luc IS NOT NULL AND bal < 0),0)::float AS bagian_minus
    FROM (SELECT m.id, COALESCE(SUM(sm.qty) FILTER (WHERE sm.created_at <= ${at}),0)::float AS bal, (SELECT sm2.unit_cost FROM stock_movements sm2 WHERE sm2.material_id = m.id AND sm2.unit_cost IS NOT NULL AND sm2.created_at <= ${at} ORDER BY sm2.created_at DESC LIMIT 1) AS luc
          FROM materials m LEFT JOIN stock_movements sm ON sm.material_id = m.id WHERE m.active GROUP BY m.id) s`)[0];
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
    nilaiParsial: { definisi: DEFINISI.nilaiParsial, bahanDenganBiaya: parsial.dengan_biaya, bahanTanpaBiaya: parsial.tanpa_biaya, nilai: kosongNominal ? null : Math.round(parsial.nilai), bagianSaldoMinus: kosongNominal ? null : Math.round(parsial.bagian_minus) },
    bukti: { bahanBerstok: tanpaBukti + sebagian + berbukti, berbukti, sebagian, tanpaBukti, catatan: "Rincian bukti per bahan. Harga Berlaku (jika ada) BUKAN bukti perolehan Finance.", rincian: rincian.sort((a, b) => b.qtyTanpaBukti - a.qtyTanpaBukti || a.kode.localeCompare(b.kode)) } };
}

/**
 * Laporan nilai persediaan pada SATU waktu acuan (default: sekarang). BACA-SAJA.
 * @param opsi.waktu  Date acuan untuk saldo DAN Harga Berlaku (tidak boleh di masa depan)
 * @param opsi.bolehNominal  false ⇒ semua nominal (harga, nilai, saldo akun, biaya rata-rata, nilai parsial) dihilangkan; status & jumlah tetap tampil
 */
export async function hitungNilaiPersediaan(db, { waktu = new Date(), bolehNominal = false } = {}) {
  const at = new Date(waktu); const sekarang = new Date();
  const bahan = await db.material.findMany({ select: { id: true, code: true, name: true, unit: true, category: true, active: true }, orderBy: { code: "asc" } });
  const agr = await db.stockMovement.groupBy({ by: ["materialId"], where: { createdAt: { lte: at } }, _sum: { qty: true }, _count: { _all: true } });
  const ledger = new Map(agr.map((g) => [g.materialId, { saldo: r4(g._sum.qty ?? 0), n: g._count._all }]));
  const hargaPeta = await hargaPada(db, at);
  const penggunaanSekarang = sekarang.getTime() - at.getTime() < 60_000; // verifikasi nol memakai keadaan SEKARANG; untuk waktu lampau tidak diterapkan (tidak ada bukti as-of)
  const nolVer = penggunaanSekarang ? await nolTerverifikasiPer(db) : new Map();
  const soPeta = await hasilSOTerkini(db);
  { // pergerakan pada/sesudah tanggal SO per bahan (sampai waktu acuan): catatan SO lama tidak boleh dianggap mewakili saldo sekarang
    const ids = [...soPeta.keys()]; if (ids.length) {
      const awalMin = new Date(Math.min(...ids.map((id) => Date.parse(`${soPeta.get(id).soTanggal}T00:00:00+07:00`))));
      const gerak = await db.stockMovement.findMany({ where: { materialId: { in: ids }, createdAt: { gte: awalMin, lte: at } }, select: { materialId: true, qty: true, createdAt: true } });
      for (const id of ids) { const so = soPeta.get(id); const awal = Date.parse(`${so.soTanggal}T00:00:00+07:00`); const akhir = awal + 86_400_000; const batas = so.soWaktu ? Date.parse(so.soWaktu) : akhir;
        const g = gerak.filter((x) => x.materialId === id); const sesudah = g.filter((x) => x.createdAt.getTime() > batas); const pada = so.soWaktu ? [] : g.filter((x) => x.createdAt.getTime() >= awal && x.createdAt.getTime() <= akhir);
        so.sesudah = { padaTanggal: pada.length, jumlah: sesudah.length, net: r4(sesudah.reduce((a, x) => a + Number(x.qty), 0)), terakhir: sesudah.length ? new Date(Math.max(...sesudah.map((x) => x.createdAt.getTime()))).toISOString() : null }; } } }
  const baris = []; const saldoPerBahan = new Map();
  for (const m of bahan) {
    const l = ledger.get(m.id) ?? { saldo: 0, n: 0 }; if (!m.active && Math.abs(l.saldo) <= EPS) continue; // nonaktif tanpa saldo: di luar universe
    const h = hargaPeta.get(m.id) ?? null; const b = klasifikasiBaris({ bahan: m, saldo: l.saldo, jumlahPergerakan: l.n, nolTerverifikasi: nolVer.has(m.id), harga: h, hasilSO: soPeta.get(m.id) ?? null });
    baris.push(b); saldoPerBahan.set(m.id, { saldo: l.saldo, kode: m.code, nama: m.name, satuan: m.unit, hargaBerlaku: h ? h.harga : null });
  }
  const cakupan = ringkasCakupan(baris); const est = hitungEstimasi(baris);
  const finance = await blokFinance(db, { at, saldoPerBahan, bolehNominal });
  const tampilBaris = urutkanRisiko(baris).map((b) => (bolehNominal ? b : { ...b, harga: null, nilai: b.status === STATUS.SALDO_NOL ? 0 : null, nilaiLedger: null }));
  return {
    waktuAcuan: at.toISOString(), waktuHitung: sekarang.toISOString(), definisi: DEFINISI, izin: { nominal: !!bolehNominal, peranPelihatNominal: peranPelihatNominal(), keterangan: "Nominal terlihat oleh pemegang izin finance:read; tidak ada peran baru." },
    kartu: {
      estimasi: { nilaiLedger: bolehNominal ? est.nilaiLedger : null, nilaiTanpaHasilSOBermasalah: bolehNominal ? est.nilaiTanpaHasilSOBermasalah : null, bahanHasilSOBermasalah: est.bahanHasilSOBermasalah, nilaiHasilSOBermasalah: bolehNominal ? est.nilaiHasilSOBermasalah : null,
        bahanDinilai: cakupan.dinilai, bahanRelevan: cakupan.relevan, persen: cakupan.persenDinilai, dariPO: cakupan.dariPO, label: "Estimasi nilai stok", status: "BELUM_DIREKONSILIASI_DENGAN_HASIL_SO", catatan: "Harga kerja Gudang (saldo × Harga Berlaku). Belum direkonsiliasi dengan hasil SO — bukan hasil stok fisik final." },
      finance: { saldo: finance.saldo, status: finance.status, alasan: finance.alasan, label: "Saldo akun persediaan Finance", catatan: "Belum direkonsiliasi dengan stok per bahan." },
      belumDinilai: { jumlah: cakupan.pengecualian, perStatus: Object.fromEntries(STATUS_PENGECUALIAN.map((s) => [s, cakupan.perStatus[s] ?? 0])), nolDikonfirmasiBelumDiLedger: cakupan.nolDikonfirmasiBelumDiLedger, label: "Bahan belum bisa dinilai", catatan: "Tidak dihitung sebagai Rp0." },
    },
    cakupan, finance, baris: tampilBaris, hasilSOTercatat: cakupan.hasilSOTercatat,
  };
}
