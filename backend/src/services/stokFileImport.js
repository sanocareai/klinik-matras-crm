// IMPOR STOK DARI FILE (Sano-Stock*.csv) — PRATINJAU + DRAFT PENGAJUAN. TIDAK PERNAH MEMPOSTING.
//
// Prinsip (Okt 2026):
//  • Kolom kosong = BELUM DIKETAHUI, bukan nol. Header "QTY SEP" BUKAN bukti tanggal: waktu hitung harus datang dari bukti terpisah (--waktu-hitung + --bukti-waktu).
//  • Tanpa bukti waktu + bukti petugas (penghitung & pemeriksa), SEMUA baris BLOCKER; pratinjau hanya menampilkan skenario informatif.
//  • Pemetaan hanya pasti bila nama sama (normalisasi spasi/huruf besar) atau alias yang dikonfirmasi manusia. Kemiripan = KANDIDAT, tidak dipakai.
//  • Satuan file harus sama dengan satuan master. Tidak ada konversi otomatis (KG↔CAN, METER↔ROLL, dst).
//  • Jumlah fisik dipisah dari harga: kolom harga file TIDAK dipakai (bukan nilai buku).
//  • Selisih = fisik − saldo ledger PADA waktu hitung; pergerakan sesudahnya TIDAK dihapus (GR Oktober tidak dihitung dua kali).
//  • Satu-satunya "penulisan" yang disiapkan: DRAFT Stock Adjustment (COUNT_DIFFERENCE) lewat API resmi, idempoten, tanpa mengubah status/ledger/jurnal.

export const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;

// ---------- CSV ----------
export function parseCsvText(text) {
  const rows = []; let row = []; let cur = ""; let q = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cur); cur = ""; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// ---------- angka format Indonesia ----------
/** "1.176.000" → 1176000 ; "71,5" → 71.5 ; "" → KOSONG ; "#N/A" → GALAT_SHEET ; "5.5" → AMBIGU (titik bukan pemisah ribuan). */
export function parseAngkaId(mentah) {
  const t = String(mentah ?? "").trim();
  if (t === "" || t === "-") return { nilai: null, status: "KOSONG", mentah: t };
  if (/^#/.test(t)) return { nilai: null, status: "GALAT_SHEET", mentah: t };
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return { nilai: Number(t.replace(/\./g, "").replace(",", ".")), status: /^-?\d{1,3}\.\d{3}$/.test(t) ? "RIBUAN_DIASUMSIKAN" : "OK", mentah: t };
  if (/^-?\d+(,\d+)?$/.test(t)) return { nilai: Number(t.replace(",", ".")), status: "OK", mentah: t };
  return { nilai: null, status: "TIDAK_VALID", mentah: t };
}

// ---------- satuan ----------
export const ALIAS_SATUAN = Object.freeze({
  PCS: "PCS", PC: "PCS", METER: "METER", M: "METER", LEMBAR: "SHEET", LBR: "SHEET", SHEET: "SHEET", ROLL: "ROLL", ROL: "ROLL", KG: "KG", PAK: "PACK", PACK: "PACK", BUNGKUS: "PACK", BKS: "PACK",
  KUBIK: "M3", M3: "M3", BATANG: "ROD", ROD: "ROD", BTG: "ROD", PASANG: "PAIR", PAIR: "PAIR", BLEK: "CAN", KLG: "CAN", CAN: "CAN", BOX: "BOX", DUS: "BOX", LITER: "LITER", SPOOL: "SPOOL", IKAT: "BUNDLE", BUNDLE: "BUNDLE",
});
export const enumSatuan = (raw) => { const t = String(raw ?? "").trim().toUpperCase(); return t ? (ALIAS_SATUAN[t] || null) : null; };

export const normNama = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
const kanon = (s) => normNama(s).replace(/[(),;:]/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
const token = (s) => new Set(kanon(s).split(" ").filter(Boolean));

// ---------- membaca sheet Stock ----------
// Posisi kolom DIVALIDASI terhadap nama header; bila bergeser → galat (fail-closed), bukan menebak.
const KOLOM = Object.freeze({
  kode: [0, "KODE BANG"], nama: [1, "NAMA BARANG"], satuan: [2, "SATUAN"], jenis: [3, "JENIS"], barang: [4, "BARANG"], vendor: [5, "VENDOR"],
  hargaSep: [43, "HARGA ACT"], masukSep: [44, "MASUK"], keluarSep: [45, "KELUAR"], sisaSep: [46, "SISA"], qtySep: [47, "QTY SEP"], selisihSep: [48, "QTY Selisih"], satuanSep: [49, "SATUAN"],
  hargaOkt: [52, "HARGA ACT"], masukOkt: [53, "MASUK"], keluarOkt: [54, "KELUAR"], sisaOkt: [55, "SISA"], qtyOkt: [56, "QTY OKT"], selisihOkt: [57, "QTY SELISIH"], satuanOkt: [58, "SATUAN"],
});

export function bacaStockCsv(text) {
  const R = parseCsvText(text);
  const h = R.findIndex((r) => (r[0] || "").trim() === "KODE BANG");
  if (h < 0) throw new Error('Header "KODE BANG" tidak ditemukan — bukan sheet Stock yang dikenal.');
  for (const [k, [i, nama]] of Object.entries(KOLOM)) {
    if (String(R[h][i] ?? "").trim().toUpperCase() !== nama.toUpperCase()) throw new Error(`Kolom ${k} diharapkan "${nama}" di posisi ${i + 1}, ditemukan "${R[h][i] ?? ""}". Layout berubah — hentikan, jangan menebak.`);
  }
  const g = (r, k) => String(r[KOLOM[k][0]] ?? "").trim();
  const baris = [];
  for (let i = h + 1; i < R.length; i++) {
    const r = R[i]; if (!g(r, "nama")) continue;
    baris.push({
      baris: i + 1, kode: g(r, "kode"), nama: g(r, "nama"), jenis: g(r, "jenis"), barang: g(r, "barang"), vendor: g(r, "vendor"), satuanPrimer: g(r, "satuan"), satuanSepMentah: g(r, "satuanSep"),
      qtySep: parseAngkaId(g(r, "qtySep")), sisaSep: parseAngkaId(g(r, "sisaSep")), selisihSep: parseAngkaId(g(r, "selisihSep")), masukSep: parseAngkaId(g(r, "masukSep")), keluarSep: parseAngkaId(g(r, "keluarSep")),
      masukOkt: parseAngkaId(g(r, "masukOkt")), keluarOkt: parseAngkaId(g(r, "keluarOkt")), sisaOkt: parseAngkaId(g(r, "sisaOkt")), qtyOkt: parseAngkaId(g(r, "qtyOkt")), satuanOktMentah: g(r, "satuanOkt"),
      hargaInfo: g(r, "hargaSep"), // INFORMASI SAJA — bukan nilai buku
    });
  }
  return { barisHeader: h + 1, baris };
}

// ---------- pemetaan ----------
export const KELAS_PEMETAAN = Object.freeze({ NAMA_SAMA: "NAMA_SAMA", ALIAS: "ALIAS_DIKONFIRMASI", KANONIK: "NAMA_SAMA_TANPA_TANDA_BACA", KANDIDAT: "KANDIDAT_BELUM_PASTI", TANPA: "TANPA_PASANGAN", GANDA: "NAMA_MASTER_GANDA" });

/** alias: Map(nomorBarisFile → kodeMaster) hasil keputusan manusia. */
export function petakan(bacaan, materials, alias = new Map()) {
  const byNama = new Map(); const byKanon = new Map(); const byKode = new Map(materials.map((m) => [m.code, m]));
  for (const m of materials) { (byNama.get(normNama(m.name)) || byNama.set(normNama(m.name), []).get(normNama(m.name))).push(m); (byKanon.get(kanon(m.name)) || byKanon.set(kanon(m.name), []).get(kanon(m.name))).push(m); }
  const hit = (a) => (a.length === 1 ? a[0] : null);
  return bacaan.baris.map((b) => {
    let m = null; let kelas; let kandidat = [];
    if (alias.has(b.baris)) { m = byKode.get(alias.get(b.baris)) || null; kelas = m ? KELAS_PEMETAAN.ALIAS : KELAS_PEMETAAN.TANPA; }
    else if ((byNama.get(normNama(b.nama)) || []).length > 1) kelas = KELAS_PEMETAAN.GANDA;
    else if ((m = hit(byNama.get(normNama(b.nama)) || []))) kelas = KELAS_PEMETAAN.NAMA_SAMA;
    else if ((m = hit(byKanon.get(kanon(b.nama)) || []))) kelas = KELAS_PEMETAAN.KANONIK;
    else {
      const ts = token(b.nama);
      kandidat = materials.map((x) => { const t2 = token(x.name); const inter = [...ts].filter((y) => t2.has(y)).length; return { code: x.code, nama: x.name, satuan: x.unit, skor: Number((inter / (ts.size + t2.size - inter)).toFixed(2)) }; })
        .filter((x) => x.skor >= 0.6).sort((a, b2) => b2.skor - a.skor).slice(0, 3);
      kelas = kandidat.length ? KELAS_PEMETAAN.KANDIDAT : KELAS_PEMETAAN.TANPA;
    }
    return { ...b, material: m, kelasPemetaan: kelas, kandidat };
  });
}

// ---------- pratinjau ----------
/**
 * @param p.pemetaan      hasil petakan()
 * @param p.materials     [{id, code, name, unit, active}]
 * @param p.ledger        Map(materialId → [{id, type, qty, createdAt: Date, dokumen, grArrivedDate: 'YYYY-MM-DD'|null, jalur}])
 * @param p.pending       [{materialCode, dok, status}]  dokumen tertunda
 * @param p.bukti         {waktuHitung: Date|null, sumberWaktu: string, penghitung: string, pemeriksa: string, buktiPetugas: string}
 * @param p.skenario      Date — dipakai HANYA untuk kolom informatif bila waktu hitung tidak terbukti
 */
export function buatPratinjau({ pemetaan, materials, ledger, pending = [], bukti = {}, skenario = null, jenisDiImpor = "MATERIAL" }) {
  const waktu = bukti.waktuHitung instanceof Date && !Number.isNaN(bukti.waktuHitung.getTime()) && String(bukti.sumberWaktu || "").trim() ? bukti.waktuHitung : null;
  const petugasOk = ["penghitung", "pemeriksa", "buktiPetugas"].every((k) => String(bukti[k] || "").trim()) && String(bukti.penghitung).trim().toLowerCase() !== String(bukti.pemeriksa).trim().toLowerCase();
  const T = waktu || skenario;
  const dalam = pemetaan.filter((b) => b.jenis === jenisDiImpor); const luar = pemetaan.filter((b) => b.jenis !== jenisDiImpor);

  // kelompok per material master
  const perMat = new Map(); const tanpaPasangan = [];
  for (const b of dalam) { if (!b.material) { tanpaPasangan.push(b); continue; } (perMat.get(b.material.id) || perMat.set(b.material.id, []).get(b.material.id)).push(b); }

  const hasil = [];
  for (const [id, bs] of perMat) {
    const m = bs[0].material; const isu = []; const add = (level, kode, pesan) => isu.push({ level, kode, pesan });
    const berangka = bs.filter((b) => b.qtySep.status !== "KOSONG");
    if (bs.length > 1) add(berangka.length > 1 ? "BLOCKER" : "PERINGATAN", "NAMA_GANDA_DI_FILE", `${bs.length} baris file (${bs.map((b) => b.baris).join(", ")}) menunjuk material yang sama${berangka.length > 1 ? " dan lebih dari satu berangka — tidak dijumlahkan, tidak dipilih" : ""}.`);
    const sumber = berangka.length === 1 ? berangka[0] : null;
    const b = sumber || bs[0];
    if (bs.some((x) => x.kelasPemetaan === KELAS_PEMETAAN.KANONIK)) add("PERINGATAN", "PEMETAAN_TANPA_TANDA_BACA", "Nama cocok setelah mengabaikan tanda baca; dipakai, mohon dikonfirmasi.");
    // satuan
    const satuanFile = enumSatuan(b.satuanSepMentah) || null; const satuanPrimer = enumSatuan(b.satuanPrimer);
    let satuanDipakai = null;
    if (b.satuanSepMentah) { if (!satuanFile) add("BLOCKER", "SATUAN_TIDAK_DIKENAL", `Satuan "${b.satuanSepMentah}" tidak dikenal.`); else satuanDipakai = satuanFile; }
    else if (satuanPrimer) { satuanDipakai = satuanPrimer; add("PERINGATAN", "SATUAN_BLOK_SEP_KOSONG", `Satuan blok SEP kosong; memakai satuan kolom utama "${b.satuanPrimer}".`); }
    else add("BLOCKER", "SATUAN_TIDAK_TERTULIS", "Tidak ada satuan tertulis di file — tidak ditebak dari master.");
    if (satuanDipakai && satuanDipakai !== String(m.unit).toUpperCase()) add("BLOCKER", "SATUAN_BEDA", `Satuan file ${b.satuanSepMentah || b.satuanPrimer} (${satuanDipakai}) ≠ satuan master ${m.unit}. Tidak dikonversi otomatis.`);
    if (satuanFile && satuanPrimer && satuanFile !== satuanPrimer) add("PERINGATAN", "SATUAN_ANTAR_KOLOM_BEDA", `Kolom utama ${b.satuanPrimer} vs blok SEP ${b.satuanSepMentah}.`);
    // angka
    const q = b.qtySep; let fisik = null;
    if (q.status === "KOSONG") { /* belum diketahui */ }
    else if (q.status === "GALAT_SHEET") add("BLOCKER", "ANGKA_GALAT_SHEET", `Sel berisi ${q.mentah}.`);
    else if (q.status === "TIDAK_VALID") add("BLOCKER", "ANGKA_TIDAK_VALID", `Sel "${q.mentah}" bukan angka.`);
    else { fisik = q.nilai; if (q.status === "RIBUAN_DIASUMSIKAN") add("BLOCKER", "FORMAT_ANGKA_AMBIGU", `"${q.mentah}" bisa 1,1 atau 1100 — konfirmasi ke petugas.`); if (fisik < 0) add("BLOCKER", "ANGKA_NEGATIF", "Fisik tidak bisa negatif."); }
    if (sumber && q.status === "OK" && sumber.selisihSep.nilai != null) {
      const sisa = sumber.sisaSep.nilai ?? 0; const exp = q.nilai - sisa;
      if (Math.abs(exp - sumber.selisihSep.nilai) > 0.51) add("PERINGATAN", "SELISIH_FILE_TAK_KONSISTEN", `Selisih di file ${sumber.selisihSep.mentah} ≠ QTY SEP − SISA (${q.nilai} − ${sisa}).`);
    }
    // ledger
    const mv = (ledger.get(id) || []).slice().sort((x, y) => x.createdAt - y.createdAt);
    const ledgerKini = r4(mv.reduce((s, x) => s + x.qty, 0));
    let ledgerSaatT = null; let sesudah = []; let jendela = null;
    if (T) {
      ledgerSaatT = r4(mv.filter((x) => x.createdAt <= T).reduce((s, x) => s + x.qty, 0)); sesudah = mv.filter((x) => x.createdAt > T);
      const sebelumT = mv.filter((x) => x.createdAt <= T).map((x) => x.createdAt).sort((x, y) => y - x)[0] || null; const pertama = sesudah[0]?.createdAt || null;
      jendela = { dari: sebelumT, sampaiSebelum: pertama };
    }
    const delta = fisik != null && ledgerSaatT != null ? r4(fisik - ledgerSaatT) : null;
    const proyeksiKini = fisik != null ? r4(fisik + sesudah.reduce((s, x) => s + x.qty, 0)) : null;
    if (T && ledgerSaatT != null && ledgerSaatT < -EPS) add("PERINGATAN", "LEDGER_NEGATIF_SAAT_HITUNG", `Ledger saat hitung ${ledgerSaatT} (negatif).`);
    // GR sesudah hitung yang barangnya SUDAH tiba sebelum hitung → bisa terhitung dua kali
    for (const x of sesudah) if (x.grArrivedDate && T && x.grArrivedDate <= T.toISOString().slice(0, 10)) add("BLOCKER", "GR_TIBA_SEBELUM_HITUNG", `Penerimaan ${x.dokumen} (+${x.qty}) diposting setelah hitung tetapi barang tiba ${x.grArrivedDate} (≤ tanggal hitung): kemungkinan sudah ada di fisik → bisa terhitung dua kali.`);
    // blok Oktober pada file vs ledger sesudah
    const masukFile = b.masukOkt.nilai; const masukLedger = r4(sesudah.filter((x) => x.qty > 0).reduce((s, x) => s + x.qty, 0));
    if (masukFile != null && masukFile > 0 && masukLedger > 0) add("PERINGATAN", "MASUK_OKTOBER_FILE_DAN_LEDGER", `File mencatat MASUK Oktober ${b.masukOkt.mentah}; ledger sesudah hitung +${masukLedger}. Kemungkinan peristiwa yang sama — JANGAN dijumlahkan dua kali.`);
    const keluarFile = b.keluarOkt.nilai;
    if (keluarFile != null && keluarFile > 0) add("PERINGATAN", "PEMAKAIAN_SETELAH_HITUNG_TAK_TERCATAT", `File mencatat KELUAR Oktober ${b.keluarOkt.mentah} yang TIDAK ada di ledger (pemakaian lama tidak direkonstruksi tanpa bukti per transaksi). Proyeksi kini = fisik + penerimaan ledger saja, bisa terlalu tinggi.`);
    // dokumen tertunda
    const pend = pending.filter((p) => p.materialCode === m.code);
    if (pend.length) add("BLOCKER", "DOKUMEN_TERTUNDA", `Dokumen tertunda: ${[...new Set(pend.map((p) => p.dok))].join(", ")}.`);
    if (!m.active) add("PERINGATAN", "MATERIAL_NONAKTIF", "Material nonaktif di master.");
    // bukti global
    if (fisik != null) {
      if (!waktu) add("BLOCKER", "WAKTU_HITUNG_TIDAK_TERBUKTI", "Tanggal/jam hitung tidak punya bukti. Header \"QTY SEP\" bukan bukti tanggal.");
      if (!petugasOk) add("BLOCKER", "BUKTI_PETUGAS_TIDAK_ADA", "Penghitung dan pemeriksa (orang berbeda) beserta rujukan bukti belum tercatat.");
      if (bs.every((x) => x.kelasPemetaan === KELAS_PEMETAAN.KANDIDAT)) add("BLOCKER", "PEMETAAN_BELUM_PASTI", "Pemetaan belum pasti.");
    }
    const blocker = isu.filter((i) => i.level === "BLOCKER");
    const status = fisik == null ? "BELUM_DIHITUNG" : blocker.length ? "BLOCKER" : "SIAP_DITINJAU";
    hasil.push({
      kode: m.code, materialId: id, nama: m.name, satuanMaster: m.unit, aktif: m.active, barisFile: bs.map((x) => x.baris), namaFile: b.nama,
      angkaSumber: q.mentah, fisik, satuanFile: b.satuanSepMentah || b.satuanPrimer || "", kelasPemetaan: bs.map((x) => x.kelasPemetaan),
      waktuHitung: waktu ? waktu.toISOString() : null, waktuSkenario: !waktu && skenario ? skenario.toISOString() : null,
      ledgerSaatHitung: ledgerSaatT, ledgerKini, delta, proyeksiKini,
      pergerakanSesudah: sesudah.map((x) => ({ id: x.id, type: x.type, qty: x.qty, at: x.createdAt.toISOString(), dokumen: x.dokumen || null, jalur: x.jalur || null })),
      jendelaHasilSama: jendela ? { dari: jendela.dari ? jendela.dari.toISOString() : null, sampaiSebelum: jendela.sampaiSebelum ? jendela.sampaiSebelum.toISOString() : null } : null,
      masukOktFile: b.masukOkt.mentah, keluarOktFile: b.keluarOkt.mentah, sisaOktFile: b.sisaOkt.mentah, hargaFileInfo: b.hargaInfo,
      isu, status,
    });
  }
  const tidakBerfile = materials.filter((m) => !perMat.has(m.id)).map((m) => ({ kode: m.code, nama: m.name, satuan: m.unit, aktif: m.active, ledgerKini: r4((ledger.get(m.id) || []).reduce((s, x) => s + x.qty, 0)) }));
  const ringkasan = {
    barisFile: pemetaan.length, barisMaterial: dalam.length, barisLuarLingkup: luar.length, qtySepTerisi: dalam.filter((b) => b.qtySep.status !== "KOSONG").length, qtySepKosong: dalam.filter((b) => b.qtySep.status === "KOSONG").length,
    petaPasti: dalam.filter((b) => b.material).length, petaKandidat: dalam.filter((b) => !b.material && b.kelasPemetaan === KELAS_PEMETAAN.KANDIDAT).length, petaTanpaPasangan: dalam.filter((b) => !b.material && b.kelasPemetaan !== KELAS_PEMETAAN.KANDIDAT).length,
    materialDipetakan: hasil.length, status: hasil.reduce((o, x) => ((o[x.status] = (o[x.status] || 0) + 1), o), {}),
    buktiWaktu: waktu ? "ADA" : "TIDAK ADA", buktiPetugas: petugasOk ? "ADA" : "TIDAK ADA", masterTanpaBarisFile: tidakBerfile.length,
    layakStrukturTanpaBukti: hasil.filter((x) => x.fisik != null && !x.isu.some((i) => i.level === "BLOCKER" && !["WAKTU_HITUNG_TIDAK_TERBUKTI", "BUKTI_PETUGAS_TIDAK_ADA"].includes(i.kode))).length,
  };
  return { ringkasan, bahan: hasil, tanpaPasangan: tanpaPasangan.map((b) => ({ baris: b.baris, nama: b.nama, jenis: b.jenis, qtySep: b.qtySep.mentah, kelas: b.kelasPemetaan, kandidat: b.kandidat })), luarLingkup: luar.map((b) => ({ baris: b.baris, nama: b.nama, jenis: b.jenis, qtySep: b.qtySep.mentah, kode: b.material?.code || null })), masterTanpaBarisFile: tidakBerfile };
}

// ---------- rencana DRAFT (tanpa posting) ----------
export function kunciImpor(waktuHitung, kode) { return `IMPOR-STOK-${new Date(waktuHitung).toISOString().slice(0, 10)}:${kode}`; }

export function bangunRencanaDraft(pratinjau, { waktuHitung, sumberWaktu, penghitung, pemeriksa, buktiPetugas }) {
  if (!(waktuHitung instanceof Date) || !String(sumberWaktu || "").trim()) throw new Error("Rencana draft butuh waktu hitung BERBUKTI (waktu + sumber).");
  if (!["penghitung", "pemeriksa", "buktiPetugas"].every((k) => String({ penghitung, pemeriksa, buktiPetugas }[k] || "").trim())) throw new Error("Rencana draft butuh penghitung, pemeriksa, dan rujukan bukti.");
  return pratinjau.bahan.filter((x) => x.status === "SIAP_DITINJAU" && Math.abs(x.delta) > EPS).map((x) => ({
    key: kunciImpor(waktuHitung, x.kode), materialId: x.materialId, kode: x.kode, delta: x.delta,
    reason: `Selisih opname file Sano-Stock (hitung ${waktuHitung.toISOString()}; sumber waktu: ${sumberWaktu}; penghitung ${penghitung}; pemeriksa ${pemeriksa}; bukti ${buktiPetugas}); fisik ${x.fisik} vs ledger ${x.ledgerSaatHitung}; DRAFT pengajuan, belum disetujui.`,
  }));
}

/**
 * Membuat DRAFT Stock Adjustment lewat API resmi (client: {get, post} bergaya httpClient). TIDAK mengubah status (tetap DRAFT), tidak memposting.
 * Idempoten: butir yang key-nya sudah ada pada request berstatus apa pun selain CANCELLED dilewati; bila delta lama berbeda dilaporkan, tidak dibuat ulang.
 */
export async function ajukanDraft({ plan, client, apply = false }) {
  const hasil = { dryRun: !apply, dibuat: [], dilewati: [], ditolak: [], berbedaDenganDraftLama: [] };
  const daftar = await client.get("/api/inventory/adjustments");
  if (daftar.status !== 200) throw new Error("gagal membaca daftar adjustment: " + daftar.status);
  const sudah = (daftar.body.requests || []).filter((r) => r.status !== "CANCELLED");
  for (const item of plan) {
    if (!item.key || !item.materialId || !Number.isFinite(item.delta) || item.delta === 0) { hasil.ditolak.push({ key: item.key, alasan: "key/materialId/delta tidak valid" }); continue; }
    const ada = sudah.find((r) => String(r.reason || "").startsWith(item.key));
    if (ada) { (Math.abs(Number(ada.adjustmentQty) - item.delta) > EPS ? hasil.berbedaDenganDraftLama : hasil.dilewati).push({ key: item.key, nomor: ada.adjustmentNumber, status: ada.status, qtyLama: Number(ada.adjustmentQty), qtyBaru: item.delta }); continue; }
    if (!apply) { hasil.dibuat.push({ key: item.key, delta: item.delta, dryRun: true }); continue; }
    const c = await client.post("/api/inventory/adjustments", { materialId: item.materialId, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: item.delta, reason: `${item.key} ${item.reason || ""}`.trim() });
    if (c.status !== 201) { hasil.ditolak.push({ key: item.key, alasan: `buat: ${c.status} ${c.body?.error}` }); continue; }
    hasil.dibuat.push({ key: item.key, id: c.body.id, nomor: c.body.adjustmentNumber, status: c.body.status, delta: item.delta });
    sudah.push(c.body);
  }
  return hasil;
}
