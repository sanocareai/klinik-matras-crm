// CUTOVER PERSEDIAAN BERBASIS OPNAME FISIK BARU — logika PREVIEW (DRY-RUN, tidak pernah menulis).
//
// Prinsip (lihat docs/RUNBOOK-CUTOVER-OPNAME-PERSEDIAAN.md):
//  1. Saldo dasar = HITUNG FISIK BARU. File stok/pemakaian manual Jan–Sep hanya referensi investigasi; tidak dipakai di sini sama sekali.
//  2. Selisih dihitung terhadap ledger PADA WAKTU HITUNG yang sama (bukan saldo hari ini): selisih = fisik − ledger(selesai hitung)
//     dikoreksi pergerakan yang terjadi di jendela hitung dan tercatat di log (efek sudah/belum tercermin di fisik).
//  3. Kolom kosong BUKAN nol. Nol fisik wajib status NOL_FISIK + pemeriksa + bukti.
//  4. GR tertunda, staging Issue, barang dalam perjalanan, sisa di produksi, dan barang milik customer dicatat di kolom TERPISAH
//     supaya tidak dihitung ganda dan tidak dicampur ke jumlah fisik milik SANO.
//  5. Kuantitas fisik dan nilai buku Finance direkonsiliasi TERPISAH. Harga sheet/harga referensi master TIDAK PERNAH menjadi nilai buku;
//     harga hanya dari tabel harga Finance (faktur/tagihan/pembelian) yang diberikan eksplisit.
//
// Modul ini murni (tanpa efek samping) kecuali `muatLedger` yang hanya membaca.

export const STATUS_HITUNG = Object.freeze({ DIHITUNG: "DIHITUNG", NOL_FISIK: "NOL_FISIK", BELUM_DIHITUNG: "BELUM_DIHITUNG" });
export const LEVEL = Object.freeze({ BLOCKER: "BLOCKER", PERINGATAN: "PERINGATAN" });
export const KELAS = Object.freeze({
  SESUAI: "SESUAI",
  SELISIH_KECIL: "SELISIH_KECIL",
  SELISIH_BESAR: "SELISIH_BESAR",
  NOL_FISIK_LEDGER_POSITIF: "NOL_FISIK_LEDGER_POSITIF",
  LEDGER_NEGATIF: "LEDGER_NEGATIF",
  BELUM_DIHITUNG: "BELUM_DIHITUNG",
  PERLU_HITUNG_ULANG: "PERLU_HITUNG_ULANG",
});
export const SUMBER_HARGA_FINANCE = Object.freeze(["FAKTUR", "TAGIHAN", "PEMBELIAN", "LAINNYA"]);

/** Judul kolom lembar hitung — SATU sumber untuk pembuat lembar dan pembaca/pratinjau. */
export const KOLOM_HITUNG = Object.freeze({
  no: "No",
  materialId: "Material ID",
  kode: "Kode",
  nama: "Nama",
  satuan: "Satuan",
  lokasi: "Lokasi",
  status: "Status hitung",
  qtyRak: "Jumlah fisik di rak (milik SANO)",
  qtyStaging: "Staging Issue (sudah diambil, belum diposting)",
  qtyGrFisik: "GR sudah datang, belum diposting",
  qtyPerjalanan: "Barang dalam perjalanan / belum diterima",
  qtyProduksi: "Sisa di lantai produksi (info)",
  qtyCustomer: "Milik customer (dikecualikan)",
  mulai: "Mulai hitung",
  selesai: "Selesai hitung",
  penghitung: "Penghitung",
  pemeriksa: "Pemeriksa",
  bukti: "Bukti (no. foto/form)",
  catatan: "Catatan",
});
export const KOLOM_LOG = Object.freeze({
  dokumen: "Dokumen / ID movement",
  kode: "Kode material",
  qty: "Qty (+/-)",
  waktu: "Waktu",
  tercermin: "Efek sudah ada di jumlah fisik? (YA/TIDAK)",
  pencatat: "Dicatat oleh",
});
export const KOLOM_HARGA = Object.freeze({
  kode: "Kode material",
  unitCost: "Harga per satuan (Rp)",
  sumber: "Sumber harga (FAKTUR/TAGIHAN/PEMBELIAN/LAINNYA)",
  referensi: "No. dokumen sumber",
  catatan: "Keterangan",
});

export const DEFAULTS = Object.freeze({
  selisihKecilPersen: 2, // |selisih| ≤ 2% dari saldo ledger saat hitung (min 1 satuan) = kecil
  buktiWajibMulaiPersen: 2, // di atas ini bukti wajib
  jendelaMaksJam: 12, // satu baris tak boleh "dihitung" lebih lama dari ini
});

const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;
const kosong = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const teks = (v) => (kosong(v) ? "" : String(v).trim());
const upper = (v) => teks(v).toUpperCase();

/** "1.234,5" (ID) atau "1234.5" → angka; kosong → null; tak terbaca → NaN. */
export function parseAngka(v) {
  if (kosong(v)) return null;
  if (typeof v === "number") return v;
  const s = String(v).trim().replace(/\s/g, "");
  const norm = /,\d{1,4}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(norm) ? Number(norm) : NaN;
}

/** Waktu tanpa zona dianggap WIB (+07:00). Mengembalikan Date atau null (kosong) atau Invalid Date. */
export function parseWaktuWIB(v) {
  if (kosong(v)) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim().replace(" ", "T");
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) return new Date(s);
  return new Date(s.length <= 10 ? `${s}T00:00:00+07:00` : `${s}${s.length === 16 ? ":00" : ""}+07:00`);
}

/** Normalisasi satu baris mentah (judul kolom → field). */
export function normalisasiBaris(raw, nomor) {
  const g = (k) => raw[KOLOM_HITUNG[k]];
  const status = upper(g("status")) || STATUS_HITUNG.BELUM_DIHITUNG;
  return {
    baris: nomor,
    materialId: teks(g("materialId")),
    kode: teks(g("kode")),
    nama: teks(g("nama")),
    satuan: upper(g("satuan")),
    lokasi: upper(g("lokasi")),
    status,
    qtyRak: parseAngka(g("qtyRak")),
    qtyStaging: parseAngka(g("qtyStaging")),
    qtyGrFisik: parseAngka(g("qtyGrFisik")),
    qtyPerjalanan: parseAngka(g("qtyPerjalanan")),
    qtyProduksi: parseAngka(g("qtyProduksi")),
    qtyCustomer: parseAngka(g("qtyCustomer")),
    mulai: parseWaktuWIB(g("mulai")),
    selesai: parseWaktuWIB(g("selesai")),
    penghitung: teks(g("penghitung")),
    pemeriksa: teks(g("pemeriksa")),
    bukti: teks(g("bukti")),
    catatan: teks(g("catatan")),
  };
}

const ok = (d) => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * Muat pergerakan ledger (BACA-SAJA) untuk sekumpulan material sampai `sampai` (inklusif).
 * Mengembalikan Map(materialId → [{id, type, qty, createdAt, note, reason, dokumen, ...}]) terurut waktu.
 */
export async function muatLedger(db, materialIds, sampai) {
  if (!materialIds.length) return new Map();
  const rows = await db.stockMovement.findMany({
    where: { materialId: { in: materialIds }, createdAt: { lte: sampai } },
    select: {
      id: true, materialId: true, type: true, qty: true, createdAt: true, note: true, reason: true, location: true, createdById: true,
      goodsReceiptId: true, materialIssueId: true, stockTransferId: true, stockCountId: true, damagedStockRecordId: true, returnRecordId: true, stockAdjustmentRequestId: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const m = new Map();
  for (const r of rows) {
    const dok = r.goodsReceiptId || r.materialIssueId || r.stockTransferId || r.stockCountId || r.damagedStockRecordId || r.returnRecordId || r.stockAdjustmentRequestId || null;
    const e = { ...r, qty: Number(r.qty), dokumenId: dok, tanpaDokumen: !dok };
    (m.get(r.materialId) || m.set(r.materialId, []).get(r.materialId)).push(e);
  }
  return m;
}

const cocokLog = (mv, log) => {
  const d = upper(log.dokumen);
  if (d && (d === upper(mv.id) || upper(mv.note).includes(d) || upper(mv.dokumenId || "") === d)) return true;
  if (log.kode && log.qtyAngka != null && Math.abs(log.qtyAngka - mv.qty) < EPS && ok(log.waktuDate) && Math.abs(log.waktuDate - mv.createdAt) <= 120_000) return true;
  return false;
};

export function normalisasiLog(rows) {
  return rows.map((raw, i) => ({
    baris: i + 2,
    dokumen: teks(raw[KOLOM_LOG.dokumen]),
    kode: teks(raw[KOLOM_LOG.kode]),
    qtyAngka: parseAngka(raw[KOLOM_LOG.qty]),
    waktuDate: parseWaktuWIB(raw[KOLOM_LOG.waktu]),
    tercermin: upper(raw[KOLOM_LOG.tercermin]),
    pencatat: teks(raw[KOLOM_LOG.pencatat]),
  }));
}

export function normalisasiHarga(rows) {
  const m = new Map();
  for (const raw of rows) {
    const kode = teks(raw[KOLOM_HARGA.kode]); if (!kode) continue;
    m.set(kode, { unitCost: parseAngka(raw[KOLOM_HARGA.unitCost]), sumber: upper(raw[KOLOM_HARGA.sumber]), referensi: teks(raw[KOLOM_HARGA.referensi]), catatan: teks(raw[KOLOM_HARGA.catatan]) });
  }
  return m;
}

/**
 * PREVIEW selisih. Murni.
 * @param {object} p
 * @param {Array}  p.materials   [{id, code, name, unit, active}]
 * @param {Array}  p.baris       hasil normalisasiBaris()
 * @param {Map}    p.ledger      Map(materialId → movements) sampai >= semua waktu selesai dan cut-off
 * @param {Date}   p.cutoff      waktu cut-off pembanding "saldo ledger sekarang" (default: max selesai)
 * @param {Array}  p.logJendela  hasil normalisasiLog()
 * @param {Map}    p.hargaFinance Map(kode → {unitCost, sumber, referensi}) — dari Finance, BUKAN dari sheet
 * @param {Array}  p.pending     [{jenis, dok, materialCode, qty}] dokumen tertunda saat cut-off (GR/Issue/transfer)
 * @param {number|null} p.saldoBuku1400 saldo akun 1-1400 saat cut-off (opsional, untuk rekonsiliasi nilai)
 */
export function hitungPreview({ materials, baris, ledger, cutoff = null, logJendela = [], hargaFinance = new Map(), pending = [], saldoBuku1400 = null, opsi = {} }) {
  const cfg = { ...DEFAULTS, ...opsi };
  const byId = new Map(materials.map((m) => [m.id, m]));
  const byCode = new Map(materials.map((m) => [m.code, m]));
  const perMaterial = new Map(); // materialId → {baris:[], isu:[]}
  const isuUmum = [];

  for (const b of baris) {
    const isu = [];
    const add = (level, kode, pesan) => isu.push({ level, kode, pesan });
    let m = b.materialId ? byId.get(b.materialId) : null;
    if (!m && b.kode) m = byCode.get(b.kode);
    if (!m) { add(LEVEL.BLOCKER, "MATERIAL_TIDAK_DIKENAL", `Material ${b.materialId || b.kode || "(kosong)"} tidak ada di master.`); isuUmum.push({ baris: b.baris, isu }); continue; }
    if (b.materialId && b.kode && b.kode !== m.code) add(LEVEL.BLOCKER, "ID_DAN_KODE_TIDAK_SAMA", `Material ID milik ${m.code} tetapi kolom Kode berisi ${b.kode}.`);
    if (b.satuan && b.satuan !== String(m.unit).toUpperCase()) add(LEVEL.BLOCKER, "SATUAN_BEDA", `Satuan hitung ${b.satuan} ≠ satuan master ${m.unit}. Hitung dalam satuan master atau perbaiki master dulu.`);
    if (!Object.values(STATUS_HITUNG).includes(b.status)) add(LEVEL.BLOCKER, "STATUS_TIDAK_DIKENAL", `Status "${b.status}" tidak dikenal (DIHITUNG / NOL_FISIK / BELUM_DIHITUNG).`);

    const qtyField = (nama, v) => { if (v !== null && (Number.isNaN(v) || v < 0)) add(LEVEL.BLOCKER, "ANGKA_TIDAK_VALID", `${nama}: harus angka ≥ 0 (nilai: ${v}).`); };
    qtyField("Jumlah di rak", b.qtyRak); qtyField("Staging Issue", b.qtyStaging); qtyField("GR belum diposting", b.qtyGrFisik);
    qtyField("Dalam perjalanan", b.qtyPerjalanan); qtyField("Sisa di produksi", b.qtyProduksi); qtyField("Milik customer", b.qtyCustomer);

    if (b.konflikStockCount) add(LEVEL.BLOCKER, "HITUNG_BEDA_STOCK_COUNT", `Lembar berisi ${b.konflikStockCount.lembar} tetapi Stock Count mencatat ${b.konflikStockCount.sistem} — samakan (hitung ulang atau koreksi salah satu); angka tidak dipilih otomatis.`);
    if (b.status === STATUS_HITUNG.DIHITUNG) {
      if (b.qtyRak === null) add(LEVEL.BLOCKER, "KOSONG_BUKAN_NOL", "Status DIHITUNG tetapi jumlah di rak kosong. Kolom kosong bukan nol — isi angka, atau tulis NOL_FISIK bila memang tidak ada.");
      else if (b.qtyRak === 0) add(LEVEL.BLOCKER, "NOL_HARUS_EKSPLISIT", "Jumlah 0 harus dicatat sebagai status NOL_FISIK (dengan pemeriksa dan bukti), bukan DIHITUNG.");
    }
    if (b.status === STATUS_HITUNG.NOL_FISIK) {
      if (b.qtyRak !== null && b.qtyRak !== 0) add(LEVEL.BLOCKER, "NOL_TAPI_ADA_QTY", `Status NOL_FISIK tetapi jumlah di rak ${b.qtyRak}.`);
      if (!b.bukti) add(LEVEL.BLOCKER, "NOL_TANPA_BUKTI", "NOL_FISIK wajib bukti (foto rak/lokasi kosong atau no. form).");
    }
    const dihitung = b.status === STATUS_HITUNG.DIHITUNG || b.status === STATUS_HITUNG.NOL_FISIK;
    if (dihitung) {
      if (!b.lokasi) add(LEVEL.BLOCKER, "LOKASI_KOSONG", "Lokasi hitung wajib diisi.");
      if (!b.penghitung) add(LEVEL.BLOCKER, "PENGHITUNG_KOSONG", "Nama penghitung wajib.");
      if (!b.pemeriksa) add(LEVEL.BLOCKER, "PEMERIKSA_KOSONG", "Nama pemeriksa wajib.");
      if (b.penghitung && b.pemeriksa && b.penghitung.toLowerCase() === b.pemeriksa.toLowerCase()) add(LEVEL.BLOCKER, "PEMERIKSA_SAMA_DENGAN_PENGHITUNG", "Pemeriksa harus orang lain dari penghitung.");
      if (!ok(b.mulai) || !ok(b.selesai)) add(LEVEL.BLOCKER, "WAKTU_TIDAK_LENGKAP", "Waktu mulai dan selesai hitung wajib (format 2026-10-31 08:15, dianggap WIB).");
      else {
        if (b.selesai < b.mulai) add(LEVEL.BLOCKER, "SELESAI_SEBELUM_MULAI", "Waktu selesai lebih awal dari mulai.");
        else if ((b.selesai - b.mulai) / 3600_000 > cfg.jendelaMaksJam) add(LEVEL.PERINGATAN, "JENDELA_TERLALU_PANJANG", `Jendela hitung > ${cfg.jendelaMaksJam} jam — pergerakan di jendela sulit dipastikan.`);
      }
    }
    const e = perMaterial.get(m.id) || perMaterial.set(m.id, { m, baris: [], isu: [] }).get(m.id);
    e.baris.push(b); e.isu.push(...isu.map((x) => ({ ...x, baris: b.baris })));
  }

  const hasil = [];
  for (const { m, baris: bs, isu } of perMaterial.values()) {
    const mv = ledger.get(m.id) || [];
    const dihitung = bs.filter((b) => b.status === STATUS_HITUNG.DIHITUNG || b.status === STATUS_HITUNG.NOL_FISIK);
    const out = { materialId: m.id, kode: m.code, nama: m.name, satuan: m.unit, isu: [...isu], baris: bs.map((b) => b.baris) };
    // duplikat lokasi
    const lok = new Map();
    for (const b of dihitung) { const k = b.lokasi; lok.set(k, (lok.get(k) || 0) + 1); }
    for (const [k, n] of lok) if (n > 1 && k) out.isu.push({ level: LEVEL.BLOCKER, kode: "DUPLIKAT_LOKASI", pesan: `Lokasi ${k} tercatat ${n} kali untuk material ini (jumlahkan jadi satu baris).`, baris: null });
    if (bs.some((b) => b.status === STATUS_HITUNG.BELUM_DIHITUNG) && dihitung.length === 0) {
      out.kelas = KELAS.BELUM_DIHITUNG; out.fisikMilikSano = null; out.ledgerCutoff = r4(mv.reduce((s, x) => s + x.qty, 0));
      hasil.push(out); continue;
    }
    if (bs.some((b) => b.status === STATUS_HITUNG.BELUM_DIHITUNG) && dihitung.length > 0) out.isu.push({ level: LEVEL.BLOCKER, kode: "SEBAGIAN_LOKASI_BELUM_DIHITUNG", pesan: "Ada baris lokasi BELUM_DIHITUNG untuk material yang sebagian lokasinya sudah dihitung.", baris: null });

    const fisik = r4(dihitung.reduce((s, b) => s + (b.qtyRak || 0) + (b.qtyStaging || 0), 0));
    const excl = {
      grFisikBelumDiposting: r4(bs.reduce((s, b) => s + (b.qtyGrFisik || 0), 0)),
      dalamPerjalanan: r4(bs.reduce((s, b) => s + (b.qtyPerjalanan || 0), 0)),
      sisaDiProduksi: r4(bs.reduce((s, b) => s + (b.qtyProduksi || 0), 0)),
      milikCustomer: r4(bs.reduce((s, b) => s + (b.qtyCustomer || 0), 0)),
    };
    out.fisikMilikSano = fisik; out.dikecualikan = excl;
    out.bukti = [...new Set(dihitung.map((b) => b.bukti).filter(Boolean))];
    out.penghitung = [...new Set(dihitung.map((b) => b.penghitung).filter(Boolean))];
    out.pemeriksa = [...new Set(dihitung.map((b) => b.pemeriksa).filter(Boolean))];

    const validWaktu = dihitung.filter((b) => ok(b.mulai) && ok(b.selesai));
    if (validWaktu.length === 0) { out.kelas = KELAS.PERLU_HITUNG_ULANG; hasil.push(out); continue; }
    const mulai = new Date(Math.min(...validWaktu.map((b) => b.mulai)));
    const selesai = new Date(Math.max(...validWaktu.map((b) => b.selesai)));
    out.mulai = mulai.toISOString(); out.selesai = selesai.toISOString();

    const sampaiSelesai = mv.filter((x) => x.createdAt <= selesai);
    const ledgerSelesai = r4(sampaiSelesai.reduce((s, x) => s + x.qty, 0));
    const ledgerMulai = r4(mv.filter((x) => x.createdAt <= mulai).reduce((s, x) => s + x.qty, 0));
    const jendela = mv.filter((x) => x.createdAt > mulai && x.createdAt <= selesai);
    out.ledgerMulai = ledgerMulai; out.ledgerSelesai = ledgerSelesai;

    let belumTercermin = 0;
    out.pergerakanJendela = jendela.map((x) => {
      const log = logJendela.find((l) => cocokLog(x, { ...l, kode: l.kode || m.code }) && (!l.kode || l.kode === m.code));
      if (!log) { out.isu.push({ level: LEVEL.BLOCKER, kode: "PERGERAKAN_JENDELA_TAK_TERCATAT", pesan: `Ada ${x.type} ${x.qty} pada ${x.createdAt.toISOString()} di jendela hitung yang TIDAK ada di log. Catat di log (efek sudah/belum tercermin) atau hitung ulang.`, baris: null }); return { ...pickMv(x), log: null }; }
      if (!["YA", "TIDAK"].includes(log.tercermin)) { out.isu.push({ level: LEVEL.BLOCKER, kode: "LOG_TANPA_KEPUTUSAN", pesan: `Log pergerakan ${x.id} belum menyatakan YA/TIDAK apakah efeknya sudah ada di jumlah fisik.`, baris: log.baris }); return { ...pickMv(x), log: log.tercermin }; }
      if (log.tercermin === "TIDAK") belumTercermin += x.qty;
      return { ...pickMv(x), log: log.tercermin };
    });
    const ledgerSaatHitung = r4(ledgerSelesai - belumTercermin); // ledger yang setara dengan keadaan fisik saat dihitung
    out.ledgerSaatHitung = ledgerSaatHitung;

    // dokumen tertunda per material (pembeda dari selisih)
    const pend = pending.filter((p) => p.materialCode === m.code);
    out.dokumenTertunda = pend;
    const grDoc = r4(pend.filter((p) => p.jenis === "GR_TERTUNDA").reduce((s, p) => s + (p.qty || 0), 0));
    if (excl.grFisikBelumDiposting > 0 && grDoc === 0) out.isu.push({ level: LEVEL.PERINGATAN, kode: "GR_FISIK_TANPA_DOKUMEN", pesan: `Ada ${excl.grFisikBelumDiposting} barang tiba tetapi tak ada dokumen GR tertunda untuk material ini — buat/telusuri dokumennya.`, baris: null });
    if (grDoc > 0 && Math.abs(grDoc - excl.grFisikBelumDiposting) > EPS) out.isu.push({ level: LEVEL.PERINGATAN, kode: "GR_FISIK_BEDA_DOKUMEN", pesan: `GR tertunda per dokumen ${grDoc} ≠ fisik tiba yang dihitung ${excl.grFisikBelumDiposting}.`, baris: null });
    const isuDoc = r4(pend.filter((p) => p.jenis === "ISSUE_TERTUNDA").reduce((s, p) => s + (p.qty || 0), 0));
    const staging = r4(bs.reduce((s, b) => s + (b.qtyStaging || 0), 0));
    if (staging > 0 && isuDoc === 0) out.isu.push({ level: LEVEL.PERINGATAN, kode: "STAGING_TANPA_ISSUE", pesan: `Staging Issue ${staging} tetapi tak ada Material Issue tertunda.`, baris: null });

    // selisih
    const delta = r4(fisik - ledgerSaatHitung);
    out.delta = delta;
    out.deltaPersen = Math.abs(ledgerSaatHitung) > EPS ? r4((delta / ledgerSaatHitung) * 100) : null;
    const basis = Math.max(Math.abs(ledgerSaatHitung), 1);
    const kecil = Math.abs(delta) <= (cfg.selisihKecilPersen / 100) * basis;
    if (ledgerSaatHitung < -EPS) { out.kelas = KELAS.LEDGER_NEGATIF; out.isu.push({ level: LEVEL.PERINGATAN, kode: "LEDGER_NEGATIF", pesan: `Ledger saat hitung negatif (${ledgerSaatHitung}) — fisik tidak bisa negatif; selisih = fisik − ledger menaikkan stok ke angka fisik.`, baris: null }); }
    else if (Math.abs(delta) < EPS) out.kelas = KELAS.SESUAI;
    else if (fisik === 0) out.kelas = KELAS.NOL_FISIK_LEDGER_POSITIF;
    else out.kelas = kecil ? KELAS.SELISIH_KECIL : KELAS.SELISIH_BESAR;
    if (Math.abs(delta) >= EPS && !out.bukti.length) out.isu.push({ level: LEVEL.BLOCKER, kode: "SELISIH_TANPA_BUKTI", pesan: `Selisih ${delta} tanpa bukti hitung.`, baris: null });
    if (out.kelas === KELAS.SELISIH_BESAR && out.pemeriksa.length === 0) out.isu.push({ level: LEVEL.BLOCKER, kode: "SELISIH_BESAR_TANPA_PEMERIKSA", pesan: "Selisih besar wajib pemeriksa.", baris: null });

    // setelah selesai hitung sampai cut-off
    if (cutoff && cutoff < selesai) out.isu.push({ level: LEVEL.BLOCKER, kode: "CUTOFF_SEBELUM_SELESAI", pesan: "Cut-off pembanding lebih awal dari selesai hitung — gunakan cut-off ≥ selesai hitung terakhir.", baris: null });
    const batas = cutoff && cutoff >= selesai ? cutoff : selesai;
    const setelah = mv.filter((x) => x.createdAt > selesai && x.createdAt <= batas);
    out.pergerakanSetelahHitung = setelah.map(pickMv);
    out.pergerakanJalurCepat = [...jendela, ...setelah].filter((x) => x.tanpaDokumen && x.type !== "ADJUSTMENT").map(pickMv);
    out.ledgerCutoff = r4(mv.filter((x) => x.createdAt <= batas).reduce((s, x) => s + x.qty, 0));
    out.fisikProyeksiCutoff = r4(fisik + setelah.reduce((s, x) => s + x.qty, 0) + belumTercermin);
    out.adjustmentCutoffDiperlukan = r4(out.fisikProyeksiCutoff - out.ledgerCutoff); // harus sama dengan delta bila tak ada kebocoran
    if (Math.abs(out.adjustmentCutoffDiperlukan - delta) > EPS) out.isu.push({ level: LEVEL.PERINGATAN, kode: "DELTA_CUTOFF_BEDA", pesan: `Adjustment di cut-off (${out.adjustmentCutoffDiperlukan}) ≠ selisih saat hitung (${delta}); periksa pergerakan di jendela.`, baris: null });

    // nilai — TERPISAH dari kuantitas; hanya dari harga Finance
    const h = hargaFinance.get(m.code);
    if (h && SUMBER_HARGA_FINANCE.includes(h.sumber) && Number.isFinite(h.unitCost) && h.unitCost > 0 && (h.sumber === "LAINNYA" ? h.catatan : h.referensi)) {
      out.nilai = { status: "DITETAPKAN", unitCost: h.unitCost, sumber: h.sumber, referensi: h.referensi, nilaiFisik: Math.round(fisik * h.unitCost), nilaiSelisih: Math.round(delta * h.unitCost) };
    } else if (h) {
      out.nilai = { status: "HARGA_TIDAK_VALID", pesan: "Harga ada tetapi sumber/dokumen/angka tidak lengkap — tidak dipakai." };
    } else {
      out.nilai = { status: "NILAI_BELUM_DITETAPKAN", pesan: "Tidak ada harga dari Finance (harga sheet/referensi master tidak dipakai)." };
    }
    if (fisik > EPS && out.nilai.status !== "DITETAPKAN") out.isu.push({ level: LEVEL.PERINGATAN, kode: "STOK_TANPA_HARGA_FINANCE", pesan: "Ada stok fisik tetapi nilai buku belum bisa ditetapkan — Finance wajib mengisi harga dari dokumen.", baris: null });

    if (out.isu.some((x) => x.level === LEVEL.BLOCKER)) out.statusAkhir = KELAS.PERLU_HITUNG_ULANG; else out.statusAkhir = out.kelas;
    hasil.push(out);
  }

  // material master aktif/berstok yang tidak ada baris hitung sama sekali
  const adaBaris = new Set(hasil.map((h) => h.materialId));
  const tidakDihitung = materials.filter((m) => !adaBaris.has(m.id)).map((m) => {
    const bal = r4((ledger.get(m.id) || []).reduce((s, x) => s + x.qty, 0));
    return { materialId: m.id, kode: m.code, nama: m.name, satuan: m.unit, aktif: m.active !== false, ledger: bal, perlu: Math.abs(bal) > EPS || m.active !== false };
  });

  const dipakai = hasil.filter((h) => h.fisikMilikSano !== null && h.statusAkhir !== KELAS.PERLU_HITUNG_ULANG);
  const naik = r4(dipakai.filter((h) => h.delta > 0).reduce((s, h) => s + h.delta, 0));
  const turun = r4(dipakai.filter((h) => h.delta < 0).reduce((s, h) => s + h.delta, 0));
  const nilaiDitetapkan = dipakai.filter((h) => h.nilai?.status === "DITETAPKAN");
  const nilaiFisik = nilaiDitetapkan.reduce((s, h) => s + h.nilai.nilaiFisik, 0);
  const rekonNilai = {
    nilaiFisikDitetapkan: nilaiFisik,
    materialBerstokTanpaHarga: dipakai.filter((h) => h.fisikMilikSano > EPS && h.nilai?.status !== "DITETAPKAN").map((h) => h.kode),
    selisihNilaiNaik: nilaiDitetapkan.filter((h) => h.nilai.nilaiSelisih > 0).reduce((s, h) => s + h.nilai.nilaiSelisih, 0),
    selisihNilaiTurun: nilaiDitetapkan.filter((h) => h.nilai.nilaiSelisih < 0).reduce((s, h) => s + h.nilai.nilaiSelisih, 0),
    saldoBuku1400: saldoBuku1400,
    penyesuaianJurnalPersediaanAwal: saldoBuku1400 == null ? null : Math.round(nilaiFisik - saldoBuku1400),
    catatan: "Nilai fisik hanya mencakup material berharga Finance yang sah; jurnal PERSEDIAAN_AWAL diposting Finance lewat modul Tutup Stok (Owner + PIN), bukan oleh pratinjau ini.",
  };
  return {
    dryRun: true,
    ringkasan: {
      materialDihitung: hasil.length,
      perluHitungUlang: hasil.filter((h) => h.statusAkhir === KELAS.PERLU_HITUNG_ULANG).length,
      belumDihitung: hasil.filter((h) => h.kelas === KELAS.BELUM_DIHITUNG).length,
      tidakAdaBarisHitung: tidakDihitung.filter((x) => x.perlu).length,
      kelas: hasil.reduce((o, h) => ((o[h.statusAkhir || h.kelas] = (o[h.statusAkhir || h.kelas] || 0) + 1), o), {}),
      selisihQtyNaik: naik, selisihQtyTurun: turun,
      catatanNaikTurun: "Naik dan turun dijumlah TERPISAH per satuan berbeda — angka ini bukan nilai uang dan tidak boleh di-offset.",
    },
    materials: hasil,
    isuUmum,
    tidakDihitung,
    rekonNilai,
  };
}

function pickMv(x) {
  return { id: x.id, type: x.type, qty: x.qty, at: x.createdAt.toISOString(), note: x.note || null, dokumenId: x.dokumenId, tanpaDokumen: x.tanpaDokumen };
}

// ───────────── pembaca BACA-SAJA untuk skrip (db = klien prisma / tx dengan SET TRANSACTION READ ONLY) ─────────────

export async function muatMaterials(db) {
  return db.material.findMany({ select: { id: true, code: true, name: true, unit: true, active: true, category: true, storageHint: true, vendor: true }, orderBy: { code: "asc" } });
}

/** Dokumen tertunda saat ini: GR belum selesai, Issue disetujui/siap ambil/diambil, transfer di jalan, rusak/retur belum selesai. */
export async function muatDokumenTertunda(db) {
  const gr = await db.$queryRaw`SELECT g.receipt_number AS dok, g.status::text AS status, m.code AS "materialCode", COALESCE(l.accepted_qty, l.received_qty, l.ordered_qty)::float AS qty
    FROM goods_receipt_lines l JOIN goods_receipts g ON g.id=l.goods_receipt_id JOIN materials m ON m.id=l.material_id WHERE g.status NOT IN ('COMPLETED','REJECTED')`;
  const iss = await db.$queryRaw`SELECT i.issue_number AS dok, i.status::text AS status, m.code AS "materialCode", l.requested_qty::float AS qty
    FROM material_issue_lines l JOIN material_issues i ON i.id=l.material_issue_id JOIN materials m ON m.id=l.material_id WHERE i.status IN ('APPROVED','READY_TO_PICK','PICKED')`;
  const trf = await db.$queryRaw`SELECT t.transfer_number AS dok, t.status::text AS status, m.code AS "materialCode", l.qty_sent::float AS qty
    FROM stock_transfer_lines l JOIN stock_transfers t ON t.id=l.stock_transfer_id JOIN materials m ON m.id=l.material_id WHERE t.status IN ('APPROVED','PICKED','IN_TRANSIT')`;
  const rusak = await db.$queryRaw`SELECT d.record_number AS dok, d.status::text AS status, m.code AS "materialCode", d.qty::float AS qty
    FROM damaged_stock_records d JOIN materials m ON m.id=d.material_id WHERE d.status <> 'RESOLVED'`;
  const retur = await db.$queryRaw`SELECT r.return_number AS dok, r.status::text AS status, m.code AS "materialCode", r.qty::float AS qty
    FROM return_records r JOIN materials m ON m.id=r.material_id WHERE r.status NOT IN ('COMPLETED','CANCELLED')`;
  const tag = (rows, jenis) => rows.map((r) => ({ jenis, ...r }));
  return [...tag(gr, "GR_TERTUNDA"), ...tag(iss, "ISSUE_TERTUNDA"), ...tag(trf, "TRANSFER_DI_JALAN"), ...tag(rusak, "RUSAK_BELUM_SELESAI"), ...tag(retur, "RETUR_BELUM_SELESAI")];
}

/** Saldo akun 1-1400 (debit − kredit) dari jurnal POSTED/REVERSED sampai `sampai` (inklusif, kolom tanggal pembukuan). */
export async function muatSaldoBuku1400(db, sampaiTanggal) {
  const r = await db.$queryRaw`SELECT COALESCE(SUM(l.debit - l.credit),0)::float AS saldo
    FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id=l.entry_id JOIN fin_accounts a ON a.id=l.account_id
    WHERE a.code='1-1400' AND e.status IN ('POSTED','REVERSED') AND e.date <= ${sampaiTanggal}::date`;
  return r[0]?.saldo ?? 0;
}

/**
 * Menggabungkan hasil hitung yang SUDAH diinput Gudang di aplikasi (Stock Count) ke baris lembar. Murni.
 *  • Lembar menyimpan bukti, pemeriksa, penghitung, lokasi, dan kolom terpisah; Stock Count menyimpan angka hitung dan waktunya.
 *  • Isian lembar yang sudah ada TIDAK ditimpa: bila angka berbeda dari Stock Count → baris diberi konflik (BLOCKER), tidak dipilih otomatis.
 *  • Material yang ada di Stock Count tetapi belum punya baris lembar → baris baru yang HANYA berisi angka/waktu dari Stock Count; metadata lain
 *    (lokasi, penghitung, pemeriksa, bukti) dibiarkan kosong sehingga muncul sebagai BLOCKER sampai Gudang melengkapinya. Tidak ada nama/angka yang ditebak.
 * @param count { startedAt, submittedAt, lines:[{id, materialId, countedQty, material:{code, unit}}] }
 * @param selesaiPerLine Map(lineId → Date waktu angka terakhir diinput)
 */
export function gabungStockCount(baris, { count, selesaiPerLine = new Map() }) {
  const out = baris.map((b) => ({ ...b }));
  let nomor = 0;
  for (const line of count.lines) {
    if (line.countedQty === null || line.countedQty === undefined) continue;
    const qty = Number(line.countedQty);
    const selesai = selesaiPerLine.get(line.id) || count.submittedAt || null;
    const status = qty === 0 ? STATUS_HITUNG.NOL_FISIK : STATUS_HITUNG.DIHITUNG;
    const ada = out.filter((b) => b.materialId === line.materialId || (b.kode && b.kode === line.material.code));
    if (ada.length === 0) {
      out.push(normalisasiBaris({}, --nomor)); const b = out[out.length - 1];
      Object.assign(b, { materialId: line.materialId, kode: line.material.code, satuan: String(line.material.unit).toUpperCase(), status, qtyRak: qty, mulai: count.startedAt ? new Date(count.startedAt) : null, selesai: selesai ? new Date(selesai) : null });
      continue;
    }
    for (const b of ada) {
      if (b.qtyRak !== null && b.qtyRak !== undefined && !Number.isNaN(b.qtyRak)) {
        if (Math.abs(b.qtyRak - qty) > EPS && (ada.length === 1)) b.konflikStockCount = { lembar: b.qtyRak, sistem: qty };
        continue;
      }
      if (ada.length > 1) continue; // beberapa lokasi: angka per lokasi harus dari lembar, bukan dari total Stock Count
      b.qtyRak = qty; b.status = status;
      if (!b.mulai && count.startedAt) b.mulai = new Date(count.startedAt);
      if (!b.selesai && selesai) b.selesai = new Date(selesai);
    }
  }
  return out;
}
