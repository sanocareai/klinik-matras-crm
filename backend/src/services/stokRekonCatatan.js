// REKONSILIASI SALDO SISTEM vs CATATAN OPERASIONAL GUDANG (file Stock) — BACA-SAJA.
//
// File Stock = catatan kerja Gudang: QTY SEP titik awal, lalu MASUK/KELUAR Oktober mengikuti stok. BUKAN hasil opname fisik (SO Oktober gagal) dan BUKAN saldo resmi.
// Prinsip: kosong ≠ nol · harga file tidak dipakai · satuan tidak dikonversi otomatis · pemetaan tidak ditebak · tidak ada adjustment/jurnal dari file ini.
// Saldo resmi = ledger (stock_movements). Catatan Gudang dipakai untuk MENUNJUK bahan yang perlu dicek fisik, bukan untuk menggantikan saldo.
import { enumSatuan, petakan, KELAS_PEMETAAN, EPS } from "./stokFileImport.js";

const r4 = (x) => Math.round(x * 10000) / 10000;
const ada = (a) => a && a.status !== "KOSONG" && a.status !== "GALAT_SHEET" && a.status !== "TIDAK_VALID" && a.nilai != null;

export const PRIORITAS = Object.freeze({
  P1_MENGHAMBAT: "P1_MENGHAMBAT",       // sistem ≤ 0 tetapi catatan Gudang menyatakan ada → Material Issue/produksi tertahan
  P2_RISIKO: "P2_RISIKO",               // sistem positif tetapi catatan Gudang menyatakan habis/negatif → bisa mengeluarkan barang yang tak ada
  P3_SELISIH_BESAR: "P3_SELISIH_BESAR",
  P4_SELISIH_KECIL: "P4_SELISIH_KECIL",
  P5_SESUAI: "P5_SESUAI",
  P6_TANPA_ANGKA_FILE: "P6_TANPA_ANGKA_FILE",
});

const sumPos = (mv) => r4(mv.filter((x) => x.qty > 0).reduce((s, x) => s + x.qty, 0));
const sumNeg = (mv) => r4(-mv.filter((x) => x.qty < 0).reduce((s, x) => s + x.qty, 0));

/**
 * @param p.pemetaan  hasil petakan() (semua baris file)
 * @param p.materials [{id, code, name, unit, active}]
 * @param p.ledger    Map(materialId → [{id, type, qty, createdAt: Date, dokumen, grArrivedDate, jalur}])
 * @param p.pending   [{materialCode, dok, status}]
 * @param p.batas     Date — pembatas "awal Oktober" (default 1 Okt 00:00 WIB); ledger tidak punya pergerakan 8 Sep–9 Okt sehingga hasil sama untuk tanggal manapun di rentang itu
 */
export function rekonsiliasiCatatan({ pemetaan, materials, ledger, pending = [], batas = new Date("2026-09-30T17:00:00Z"), jenisDiImpor = "MATERIAL" }) {
  const dalam = pemetaan.filter((b) => b.jenis === jenisDiImpor);
  const perMat = new Map(); const tanpaPasangan = [];
  for (const b of dalam) { if (!b.material) { tanpaPasangan.push(b); continue; } (perMat.get(b.material.id) || perMat.set(b.material.id, []).get(b.material.id)).push(b); }

  const bahan = [];
  for (const [id, bs] of perMat) {
    const m = bs[0].material; const isu = []; const add = (level, kode, pesan) => isu.push({ level, kode, pesan });
    const berangka = bs.filter((b) => b.qtySep.status !== "KOSONG" || (b.masukOkt.status !== "KOSONG" || b.keluarOkt.status !== "KOSONG"));
    const gandaBerangka = bs.filter((b) => b.qtySep.status !== "KOSONG").length > 1;
    if (bs.length > 1) add(gandaBerangka ? "BLOCKER" : "PERINGATAN", "NAMA_GANDA_DI_FILE", `Baris file ${bs.map((b) => b.baris).join(", ")} menunjuk material yang sama${gandaBerangka ? " dengan lebih dari satu QTY SEP — tidak dijumlah/dipilih" : ""}.`);
    const b = (gandaBerangka ? null : berangka[0]) || bs[0];
    if (bs.some((x) => x.kelasPemetaan === KELAS_PEMETAAN.KANONIK)) add("PERINGATAN", "PEMETAAN_TANPA_TANDA_BACA", "Nama cocok setelah mengabaikan tanda baca — mohon dikonfirmasi.");

    // satuan
    const sat = enumSatuan(b.satuanSepMentah) || enumSatuan(b.satuanPrimer); const satOkt = enumSatuan(b.satuanOktMentah);
    const unitMaster = String(m.unit).toUpperCase();
    let satuanOk = true;
    const adaAngkaFile = b.qtySep.status !== "KOSONG" || (b.masukOkt.nilai ?? 0) > 0 || (b.keluarOkt.nilai ?? 0) > 0;
    if (!adaAngkaFile) { /* tanpa angka file, satuan tidak relevan sekarang */ }
    else if (!b.satuanSepMentah && !b.satuanPrimer) { add("BLOCKER", "SATUAN_TIDAK_TERTULIS", "Tidak ada satuan tertulis di file."); satuanOk = false; }
    else if (!sat) { add("BLOCKER", "SATUAN_TIDAK_DIKENAL", `Satuan "${b.satuanSepMentah || b.satuanPrimer}" tidak dikenal.`); satuanOk = false; }
    else if (sat !== unitMaster) { add("BLOCKER", "SATUAN_BEDA", `Satuan file ${b.satuanSepMentah || b.satuanPrimer} (${sat}) ≠ master ${m.unit}; tidak dikonversi otomatis.`); satuanOk = false; }
    if (satOkt && sat && satOkt !== sat) add("PERINGATAN", "SATUAN_BLOK_OKTOBER_BEDA", `Satuan blok Oktober ${b.satuanOktMentah} ≠ blok SEP ${b.satuanSepMentah || b.satuanPrimer}.`);

    // sisi file
    const sep = ada(b.qtySep) ? b.qtySep.nilai : null; const masuk = ada(b.masukOkt) ? b.masukOkt.nilai : (b.masukOkt.status === "KOSONG" ? 0 : null); const keluar = ada(b.keluarOkt) ? b.keluarOkt.nilai : (b.keluarOkt.status === "KOSONG" ? 0 : null);
    if (b.qtySep.status === "GALAT_SHEET" || b.qtySep.status === "TIDAK_VALID") add("BLOCKER", "ANGKA_SEP_GALAT", `QTY SEP "${b.qtySep.mentah}" tidak valid.`);
    if (b.qtySep.status === "RIBUAN_DIASUMSIKAN") add("PERINGATAN", "FORMAT_ANGKA_AMBIGU", `QTY SEP "${b.qtySep.mentah}" bisa berarti ribuan atau desimal.`);
    if (b.masukOkt.status === "GALAT_SHEET" || b.keluarOkt.status === "GALAT_SHEET") add("PERINGATAN", "ANGKA_OKTOBER_GALAT_SHEET", `MASUK/KELUAR Oktober berisi ${b.masukOkt.status === "GALAT_SHEET" ? b.masukOkt.mentah : b.keluarOkt.mentah} — angka Oktober file tidak tersedia.`);
    const sisaFile = ada(b.sisaOkt) ? b.sisaOkt.nilai : null;
    if (b.sisaOkt.status === "GALAT_SHEET") add("PERINGATAN", "SISA_FILE_GALAT_SHEET", "SISA Oktober di file #N/A — file sendiri tidak punya saldo Oktober untuk bahan ini.");
    if (sep == null && ((masuk ?? 0) > 0 || (keluar ?? 0) > 0)) add("PERINGATAN", "SEP_KOSONG_TAPI_ADA_GERAK_OKTOBER", "QTY SEP kosong (belum diketahui) tetapi ada MASUK/KELUAR Oktober: rumus file memperlakukan kosong sebagai nol — di sini TIDAK.");
    const sisaHitungUlang = sep != null && masuk != null && keluar != null ? r4(sep + masuk - keluar) : null;
    if (sisaHitungUlang != null && sisaFile != null && Math.abs(sisaHitungUlang - sisaFile) > 0.51) add("PERINGATAN", "SISA_FILE_TAK_KONSISTEN", `SISA file ${b.sisaOkt.mentah} ≠ SEP + MASUK − KELUAR (${sisaHitungUlang}).`);

    // sisi ledger
    const mv = (ledger.get(id) || []).slice().sort((x, y) => x.createdAt - y.createdAt);
    const sebelum = mv.filter((x) => x.createdAt <= batas); const sesudah = mv.filter((x) => x.createdAt > batas);
    const ledgerAwal = r4(sebelum.reduce((s, x) => s + x.qty, 0)); const ledgerKini = r4(mv.reduce((s, x) => s + x.qty, 0));
    const ledgerMasuk = sumPos(sesudah); const ledgerKeluar = sumNeg(sesudah);
    const dokMasuk = [...new Set(sesudah.filter((x) => x.qty > 0).map((x) => x.dokumen).filter(Boolean))];
    const terakhirSebelum = sebelum.length ? sebelum[sebelum.length - 1].createdAt.toISOString().slice(0, 10) : null;

    // selisih (hanya bila satuan sama; kalau tidak, angka file tidak sebanding)
    const bisa = satuanOk;
    const selisihAwal = bisa && sep != null ? r4(sep - ledgerAwal) : null;
    const selisihMasuk = bisa && masuk != null ? r4(masuk - ledgerMasuk) : null;
    const selisihKeluar = bisa && keluar != null ? r4(keluar - ledgerKeluar) : null;
    const selisihTotal = bisa && sisaHitungUlang != null ? r4(sisaHitungUlang - ledgerKini) : null;

    // hitung ganda / sumber ganda
    const flag = { grDiKeduaSumber: null, pemakaianHanyaDiFile: false, masukHanyaDiFile: false, masukHanyaDiLedger: false };
    if (bisa && (masuk ?? 0) > 0 && ledgerMasuk > 0) {
      const rasio = masuk / ledgerMasuk;
      flag.grDiKeduaSumber = Math.abs(masuk - ledgerMasuk) <= 0.5 ? "SAMA" : masuk > ledgerMasuk ? "FILE_LEBIH" : "LEDGER_LEBIH";
      add("PERINGATAN", "GR_DI_KEDUA_SUMBER", `MASUK Oktober file ${masuk} dan penerimaan ledger ${ledgerMasuk} (${dokMasuk.join(", ")}) — ${flag.grDiKeduaSumber === "SAMA" ? "angkanya sama: peristiwa yang sama" : "kemungkinan peristiwa yang sama"}; pakai LEDGER, jangan dijumlahkan.`);
      void rasio;
    } else if (!bisa && (b.masukOkt.nilai ?? 0) > 0 && ledgerMasuk > 0) {
      const rasio = (b.masukOkt.nilai ?? 0) / ledgerMasuk; const bulat = Number.isInteger(Math.round(rasio * 100) / 100) && rasio >= 2;
      const samaAngka = Math.abs((b.masukOkt.nilai ?? 0) - ledgerMasuk) <= 0.5;
      flag.grDiKeduaSumber = samaAngka ? "ANGKA_SAMA_SATUAN_TAK_TERBUKTI" : bulat ? "BEDA_SATUAN_KEMUNGKINAN" : "BEDA_SATUAN";
      add("PERINGATAN", "GR_DI_KEDUA_SUMBER", `MASUK file ${b.masukOkt.mentah} ${b.satuanOktMentah || b.satuanSepMentah || ""} vs ledger ${ledgerMasuk} ${m.unit} (${dokMasuk.join(", ")})${samaAngka ? " — angkanya sama tetapi satuan file tidak tertulis/berbeda: kemungkinan peristiwa yang sama (BELUM dikonfirmasi)" : bulat ? ` — rasio ${rasio}: mungkin satu peristiwa dengan faktor satuan ${rasio} (BELUM dikonfirmasi, tidak dikonversi)` : ""}.`);
    }
    if ((keluar ?? 0) > 0 && ledgerKeluar === 0) { flag.pemakaianHanyaDiFile = true; add("PERINGATAN", "PEMAKAIAN_HANYA_DI_FILE", `KELUAR Oktober ${b.keluarOkt.mentah} hanya ada di file; tidak ada Material Issue/transaksi keluar resmi di ledger (tidak direkonstruksi tanpa bukti per transaksi).`); }
    if ((masuk ?? 0) > 0 && ledgerMasuk === 0) { flag.masukHanyaDiFile = true; add("PERINGATAN", "MASUK_HANYA_DI_FILE", `MASUK Oktober ${b.masukOkt.mentah} di file tetapi tidak ada penerimaan resmi di ledger (GR belum diputaway / pembelian tanpa GR).`); }
    if (ledgerMasuk > 0 && (masuk ?? 0) === 0 && b.masukOkt.status === "KOSONG") { flag.masukHanyaDiLedger = true; add("PERINGATAN", "MASUK_HANYA_DI_LEDGER", `Ledger mencatat penerimaan ${ledgerMasuk} (${dokMasuk.join(", ")}) yang tidak ada di file.`); }
    const pend = pending.filter((p) => p.materialCode === m.code);
    if (pend.length) add("PERINGATAN", "DOKUMEN_TERTUNDA", `Dokumen tertunda: ${[...new Set(pend.map((p) => p.dok))].join(", ")}.`);
    if (sisaHitungUlang != null && sisaHitungUlang < -EPS) add("PERINGATAN", "SISA_FILE_NEGATIF", `Saldo catatan Gudang negatif (${sisaHitungUlang}): pemakaian tercatat melebihi stok awal + masuk.`);
    if (ledgerKini < -EPS) add("PERINGATAN", "LEDGER_NEGATIF", `Ledger kini ${ledgerKini}.`);
    if (!m.active) add("PERINGATAN", "MATERIAL_NONAKTIF", "Material nonaktif.");

    // perkiraan Gudang tanpa hitung ganda (INFORMATIF, bukan saldo resmi)
    let perkiraan = null;
    if (bisa && sep != null && keluar != null) perkiraan = r4(sep + Math.max(masuk ?? 0, ledgerMasuk) - keluar);
    // prioritas
    let prioritas; let alasan = "";
    const acuan = perkiraan ?? sisaHitungUlang;
    if (!bisa) { prioritas = PRIORITAS.P3_SELISIH_BESAR; alasan = "Satuan tidak sebanding — butuh perbaikan master/konfirmasi faktor sebelum dibandingkan."; }
    else if (sep == null && masuk === 0 && keluar === 0 && b.sisaOkt.status === "KOSONG") { prioritas = PRIORITAS.P6_TANPA_ANGKA_FILE; alasan = "File tidak punya angka (kosong ≠ nol)."; }
    else if (acuan == null) { prioritas = PRIORITAS.P6_TANPA_ANGKA_FILE; alasan = "Angka file tidak lengkap (QTY SEP kosong atau angka Oktober #N/A) — saldo file tidak dapat dihitung."; }
    else if (ledgerKini <= EPS && acuan > EPS) { prioritas = PRIORITAS.P1_MENGHAMBAT; alasan = `Sistem ${ledgerKini} tetapi catatan Gudang ≈ ${acuan}: pengeluaran bahan ini di sistem tertahan (saldo tidak boleh minus).`; }
    else if (ledgerKini > EPS && acuan <= EPS) { prioritas = PRIORITAS.P2_RISIKO; alasan = `Sistem ${ledgerKini} tetapi catatan Gudang ≈ ${acuan} (pemakaian di catatan melebihi stok yang dicatat): barang mungkin tidak ada ATAU catatan masuk/awal belum lengkap — cek fisik.`; }
    else {
      const d = acuan - ledgerKini; const besar = Math.abs(d) >= Math.max(5, 0.2 * Math.max(Math.abs(ledgerKini), Math.abs(acuan)));
      if (Math.abs(d) < 0.51) { prioritas = PRIORITAS.P5_SESUAI; alasan = "Sesuai (±0,5)."; }
      else if (besar) { prioritas = PRIORITAS.P3_SELISIH_BESAR; alasan = `Selisih catatan − sistem = ${r4(d)}.`; }
      else { prioritas = PRIORITAS.P4_SELISIH_KECIL; alasan = `Selisih kecil ${r4(d)}.`; }
    }
    if (isu.some((i) => i.level === "BLOCKER" && i.kode === "NAMA_GANDA_DI_FILE") && prioritas === PRIORITAS.P5_SESUAI) prioritas = PRIORITAS.P3_SELISIH_BESAR;

    bahan.push({
      kode: m.code, materialId: id, nama: m.name, aktif: m.active, satuanMaster: m.unit, satuanFile: b.satuanSepMentah || b.satuanPrimer || "", barisFile: bs.map((x) => x.baris),
      sep: sep, sepMentah: b.qtySep.mentah, masukFile: ada(b.masukOkt) ? b.masukOkt.nilai : null, masukMentah: b.masukOkt.mentah, keluarFile: ada(b.keluarOkt) ? b.keluarOkt.nilai : null, keluarMentah: b.keluarOkt.mentah, sisaFile, sisaMentah: b.sisaOkt.mentah, sisaHitungUlang,
      ledgerAwal, ledgerTerakhirSebelumBatas: terakhirSebelum, ledgerMasuk, ledgerKeluar, ledgerKini, dokMasukLedger: dokMasuk,
      selisihAwal, selisihMasuk, selisihKeluar, selisihTotal, perkiraanTanpaDobel: perkiraan, prioritas, alasanPrioritas: alasan, flag, isu,
      sumber: {
        sep: sep != null ? `file Sano-Stock baris ${b.baris} kolom QTY SEP (catatan Gudang, bukan opname fisik; tanggal tidak terbukti)` : "file: kosong (belum diketahui)",
        oktober: `file baris ${b.baris} kolom MASUK/KELUAR/SISA Oktober (catatan Gudang)`,
        ledger: `ledger resmi: ${sebelum.length} movement ≤ batas (terakhir ${terakhirSebelum || "-"}), ${sesudah.length} sesudahnya${dokMasuk.length ? " (" + dokMasuk.join(", ") + ")" : ""}`,
      },
      buktiFisik: "TIDAK ADA — SO Oktober gagal; angka file belum diverifikasi fisik",
    });
  }
  const urutan = Object.values(PRIORITAS);
  bahan.sort((a, c) => urutan.indexOf(a.prioritas) - urutan.indexOf(c.prioritas) || Math.abs((c.selisihTotal ?? 0)) - Math.abs((a.selisihTotal ?? 0)) || a.kode.localeCompare(c.kode));
  const hitung = (f) => bahan.filter(f).length;
  const tanpaBaris = materials.filter((m) => !perMat.has(m.id)).map((m) => ({ kode: m.code, nama: m.name, satuan: m.unit, aktif: m.active, ledgerKini: r4((ledger.get(m.id) || []).reduce((s, x) => s + x.qty, 0)) }));
  const ringkasan = {
    barisMaterialFile: dalam.length, materialDipetakan: bahan.length, barisTanpaPasangan: tanpaPasangan.length, masterTanpaBarisFile: tanpaBaris.length,
    prioritas: bahan.reduce((o, x) => ((o[x.prioritas] = (o[x.prioritas] || 0) + 1), o), {}),
    pemakaianHanyaDiFile: hitung((x) => x.flag.pemakaianHanyaDiFile), grDiKeduaSumber: hitung((x) => x.flag.grDiKeduaSumber), masukHanyaDiFile: hitung((x) => x.flag.masukHanyaDiFile), masukHanyaDiLedger: hitung((x) => x.flag.masukHanyaDiLedger),
    konflikSatuan: hitung((x) => x.isu.some((i) => i.kode === "SATUAN_BEDA" || i.kode === "SATUAN_TIDAK_TERTULIS" || i.kode === "SATUAN_TIDAK_DIKENAL")), namaGanda: hitung((x) => x.isu.some((i) => i.kode === "NAMA_GANDA_DI_FILE")),
    sepKosongTapiGerakOktober: hitung((x) => x.isu.some((i) => i.kode === "SEP_KOSONG_TAPI_ADA_GERAK_OKTOBER")), sisaFileGalat: hitung((x) => x.isu.some((i) => i.kode === "SISA_FILE_GALAT_SHEET")),
    ledgerNegatif: hitung((x) => x.ledgerKini < -EPS),
  };
  return { ringkasan, bahan, tanpaPasangan: tanpaPasangan.map((b) => ({ baris: b.baris, nama: b.nama, sep: b.qtySep.mentah, kelas: b.kelasPemetaan, kandidat: b.kandidat })), masterTanpaBarisFile: tanpaBaris };
}

export { petakan };
