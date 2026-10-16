// MATRIKS PILOT OPNAME — keputusan KUANTITAS dan VALUASI dipisah. Murni (tanpa DB, tanpa tulis).
//
// Masukan:
//   pilot      [{ kode, nama, satuan, peran }]
//   fakta      Map(kode → { saldoSekarang, pergerakanTerakhir, dokumenTertunda:[{jenis,dok,status,qty}] })  — pembacaan DB baca-saja saat matriks dibuat
//   preview    hasil scripts/opname-preview.mjs (preview.json) atau null bila belum ada hitungan nyata
//   keputusan  Map(kode → { gudang, alasanGudang, finance, alasanFinance })  — diisi manusia; kosong = belum diputuskan
// Aturan GO/NO-GO KUANTITAS (semuanya harus terpenuhi untuk GO):
//   1. ada hasil hitung nyata dari Gudang (bukan kosong/BELUM_DIHITUNG);  2. tanpa BLOCKER pada preview;  3. tanpa dokumen tertunda pada material itu;
//   4. keputusan Gudang = TERIMA_FISIK (kosong/lainnya = NO-GO).  GO berarti "boleh diajukan sebagai Stock Adjustment/Count" — BUKAN diposting.
// VALUASI terpisah: SIAP hanya bila harga bersumber dokumen valid (preview.nilai.status = DITETAPKAN) DAN keputusan Finance = HARGA_DITETAPKAN.
// Nilai naik dan turun dijumlah TERPISAH; tidak ada angka bersih.
export const KEPUTUSAN_GUDANG = Object.freeze(["TERIMA_FISIK", "HITUNG_ULANG", "PERBAIKI_MASTER", "NONAKTIFKAN"]);
export const KEPUTUSAN_FINANCE = Object.freeze(["HARGA_DITETAPKAN", "HARGA_MENUNGGU_DOKUMEN", "TOLAK_HARGA", "BEBANKAN_SELISIH"]);
const r4 = (x) => Math.round(x * 10000) / 10000;

export function bangunMatriksPilot({ pilot, fakta = new Map(), preview = null, keputusan = new Map() }) {
  const pm = new Map((preview?.materials || []).map((m) => [m.kode, m]));
  const baris = pilot.map((p) => {
    const f = fakta.get(p.kode) || {};
    const pv = pm.get(p.kode) || null;
    const kep = keputusan.get(p.kode) || {};
    const blockers = (pv?.isu || []).filter((i) => i.level === "BLOCKER").map((i) => i.kode);
    const dokTertunda = f.dokumenTertunda || pv?.dokumenTertunda || [];
    const alasanNoGo = [];
    const dihitung = pv && pv.fisikMilikSano !== null && pv.fisikMilikSano !== undefined && pv.kelas !== "BELUM_DIHITUNG";
    if (!dihitung) alasanNoGo.push("BELUM DIHITUNG oleh Gudang");
    if (dihitung && blockers.length) alasanNoGo.push("BLOCKER: " + [...new Set(blockers)].join(", "));
    if (dokTertunda.length) alasanNoGo.push("dokumen tertunda: " + [...new Set(dokTertunda.map((d) => d.dok))].join(", "));
    if (dihitung && !kep.gudang) alasanNoGo.push("menunggu keputusan Gudang");
    else if (kep.gudang && kep.gudang !== "TERIMA_FISIK") alasanNoGo.push("keputusan Gudang: " + kep.gudang);
    if (kep.gudang && !KEPUTUSAN_GUDANG.includes(kep.gudang)) alasanNoGo.push("keputusan Gudang tidak dikenal: " + kep.gudang);
    const goKuantitas = alasanNoGo.length === 0;
    const nilai = pv?.nilai || null;
    const valuasiSiap = !!nilai && nilai.status === "DITETAPKAN" && kep.finance === "HARGA_DITETAPKAN";
    const alasanValuasi = [];
    if (!nilai || nilai.status !== "DITETAPKAN") alasanValuasi.push(nilai ? `harga: ${nilai.status}` : "belum ada harga Finance");
    if (kep.finance !== "HARGA_DITETAPKAN") alasanValuasi.push(kep.finance ? "keputusan Finance: " + kep.finance : "menunggu keputusan Finance");
    if (kep.finance && !KEPUTUSAN_FINANCE.includes(kep.finance)) alasanValuasi.push("keputusan Finance tidak dikenal: " + kep.finance);
    const delta = dihitung && Number.isFinite(pv.delta) ? pv.delta : null;
    return {
      kode: p.kode, nama: p.nama, peran: p.peran || "", satuanMaster: p.satuan,
      fisik: dihitung ? pv.fisikMilikSano : null, satuanHitung: dihitung ? pv.satuan : null,
      saldoSaatHitung: dihitung ? (pv.ledgerSaatHitung ?? null) : null, saldoSekarang: f.saldoSekarang ?? null,
      pergerakanSesi: (pv?.pergerakanJendela || []).map((x) => ({ at: x.at, type: x.type, qty: x.qty, log: x.log })),
      pergerakanSetelah: (pv?.pergerakanSetelahHitung || []).length,
      selisih: delta, kelas: pv ? (pv.statusAkhir || pv.kelas) : "BELUM_DIHITUNG",
      bukti: pv?.bukti || [], penghitung: pv?.penghitung || [], pemeriksa: pv?.pemeriksa || [],
      dokumenTertunda: dokTertunda, blockers,
      keputusanGudang: kep.gudang || "", alasanGudang: kep.alasanGudang || "", keputusanFinance: kep.finance || "", alasanFinance: kep.alasanFinance || "",
      goKuantitas, keputusanKuantitas: goKuantitas ? "GO" : "NO-GO", alasanNoGo,
      valuasi: valuasiSiap ? "SIAP" : "BELUM", alasanValuasi: valuasiSiap ? [] : alasanValuasi,
      hargaFinance: nilai?.status === "DITETAPKAN" ? { unitCost: nilai.unitCost, sumber: nilai.sumber, referensi: nilai.referensi } : null,
      nilaiSelisih: valuasiSiap ? nilai.nilaiSelisih : null,
    };
  });
  // total terpisah
  const go = baris.filter((b) => b.goKuantitas && b.selisih !== null);
  const perSatuan = {};
  for (const b of go) { const s = (perSatuan[b.satuanMaster] ||= { naik: 0, turun: 0 }); if (b.selisih > 0) s.naik = r4(s.naik + b.selisih); else if (b.selisih < 0) s.turun = r4(s.turun + b.selisih); }
  const nilai = baris.filter((b) => b.valuasi === "SIAP" && b.nilaiSelisih !== null);
  const ringkasan = {
    bahan: baris.length, goKuantitas: baris.filter((b) => b.goKuantitas).length, noGoKuantitas: baris.filter((b) => !b.goKuantitas).length,
    valuasiSiap: baris.filter((b) => b.valuasi === "SIAP").length, valuasiBelum: baris.filter((b) => b.valuasi !== "SIAP").length,
    selisihQtyPerSatuan: perSatuan,
    nilaiNaikRp: nilai.filter((b) => b.nilaiSelisih > 0).reduce((s, b) => s + b.nilaiSelisih, 0),
    nilaiTurunRp: nilai.filter((b) => b.nilaiSelisih < 0).reduce((s, b) => s + b.nilaiSelisih, 0),
    catatan: "Kuantitas (GO/NO-GO) dan valuasi (SIAP/BELUM) diputuskan terpisah. Naik dan turun TIDAK di-offset. GO = boleh diajukan sebagai Stock Adjustment/Count oleh pengaju dan disetujui orang lain; bukan posting.",
  };
  return { baris, ringkasan };
}

/** Tindakan manusia yang masih dibutuhkan per bahan (teks operasional). */
export function tindakanManusia(b) {
  const t = [];
  if (b.kelas === "BELUM_DIHITUNG") t.push("Gudang: hitung fisik di aplikasi (Stock Count) — petugas A menghitung, petugas B memeriksa; isi lokasi, nama, bukti");
  for (const k of b.blockers) t.push("Gudang: selesaikan " + k);
  for (const d of b.dokumenTertunda) t.push(`Gudang+Finance: putuskan ${d.dok} (${d.status}) — selesaikan atau batalkan oleh petugas`);
  if (b.kelas !== "BELUM_DIHITUNG" && !b.keputusanGudang) t.push("Gudang: isi keputusan (TERIMA_FISIK / HITUNG_ULANG / PERBAIKI_MASTER / NONAKTIFKAN)");
  if (b.valuasi !== "SIAP") t.push("Finance: tetapkan harga bersumber dokumen (faktur/tagihan/pembelian) lalu keputusan HARGA_DITETAPKAN");
  return t;
}

/** Workbook matriks (ExcelJS diberikan pemanggil agar service tetap bebas dependensi berat). */
export function buatWorkbookMatriks(ExcelJS, { baris, ringkasan }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Matriks pilot");
  ws.addRow(["Kode", "Nama", "Peran pilot", "Satuan master", "Fisik (hitung Gudang)", "Satuan hitung", "Saldo ledger pada waktu hitung", "Saldo ledger sekarang", "Pergerakan selama sesi", "Selisih (fisik − saldo)", "Status preview",
    "Bukti", "Penghitung", "Pemeriksa", "Dokumen tertunda", "Keputusan Gudang", "Alasan Gudang", "KUANTITAS", "Alasan NO-GO", "Keputusan Finance", "Harga Finance (Rp/satuan)", "Sumber harga", "Nilai selisih (Rp)", "VALUASI", "Alasan valuasi belum siap"]);
  for (const b of baris) ws.addRow([b.kode, b.nama, b.peran, b.satuanMaster, b.fisik, b.satuanHitung, b.saldoSaatHitung, b.saldoSekarang,
    b.pergerakanSesi.map((p) => `${p.type} ${p.qty > 0 ? "+" : ""}${p.qty} [${p.log ?? "tanpa tanda"}]`).join("\n"), b.selisih, b.kelas, b.bukti.join(", "), b.penghitung.join(", "), b.pemeriksa.join(", "),
    b.dokumenTertunda.map((d) => `${d.dok} (${d.status})`).join("\n"), b.keputusanGudang, b.alasanGudang, b.keputusanKuantitas, b.alasanNoGo.join("; "),
    b.keputusanFinance, b.hargaFinance?.unitCost ?? null, b.hargaFinance ? `${b.hargaFinance.sumber} ${b.hargaFinance.referensi || ""}` : "", b.nilaiSelisih, b.valuasi, b.alasanValuasi.join("; ")]);
  ws.columns.forEach((c) => { c.width = 24; }); ws.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  ws.eachRow((r, i) => { if (i === 1) { r.font = { bold: true }; r.alignment = { wrapText: true, vertical: "middle" }; } else r.alignment = { wrapText: true, vertical: "top" }; });
  const rs = wb.addWorksheet("Ringkasan");
  rs.addRows([["MATRIKS PILOT OPNAME — keputusan kuantitas dan valuasi terpisah"], ["Bahan", ringkasan.bahan], ["GO kuantitas", ringkasan.goKuantitas], ["NO-GO kuantitas", ringkasan.noGoKuantitas], ["Valuasi SIAP", ringkasan.valuasiSiap], ["Valuasi BELUM", ringkasan.valuasiBelum],
    ["Nilai selisih NAIK (Rp, baris valuasi siap)", ringkasan.nilaiNaikRp], ["Nilai selisih TURUN (Rp, baris valuasi siap)", ringkasan.nilaiTurunRp], [], ["Selisih kuantitas per satuan (hanya baris GO) — naik / turun terpisah"],
    ...Object.entries(ringkasan.selisihQtyPerSatuan).map(([s, v]) => [s, `naik ${v.naik}`, `turun ${v.turun}`]), [], [ringkasan.catatan]]);
  rs.getColumn(1).width = 60;
  const ts = wb.addWorksheet("Tindakan manusia");
  ts.addRow(["Kode", "Tindakan yang masih dibutuhkan"]);
  for (const b of baris) for (const t of tindakanManusia(b)) ts.addRow([b.kode, t]);
  ts.getColumn(1).width = 36; ts.getColumn(2).width = 110;
  const ks = wb.addWorksheet("Keputusan");
  ks.addRow(["Kode", "Keputusan Gudang", "Alasan Gudang", "Keputusan Finance", "Alasan Finance"]);
  for (const b of baris) ks.addRow([b.kode, b.keputusanGudang, b.alasanGudang, b.keputusanFinance, b.alasanFinance]);
  ks.addRow([]); ks.addRow([`Nilai Keputusan Gudang: ${KEPUTUSAN_GUDANG.join(" | ")}`]); ks.addRow([`Nilai Keputusan Finance: ${KEPUTUSAN_FINANCE.join(" | ")}`]);
  ks.columns.forEach((c) => { c.width = 30; });
  return wb;
}
