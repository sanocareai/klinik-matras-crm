// EXPORT EXCEL — JEJAK BIAYA BAHAN PER UNIT PRODUKSI. Sumber data = services/finance/biayaBahan.js (daftarUnitBiaya + bacaJejakUnit — fungsi baca yang SAMA dengan layar
// Finance → Biaya Bahan). Filter layar: q (kode unit / nomor order). Layar menampilkan maksimal 100 unit terbaru; export memuat unit yang sama persis.
// Empat sheet: Ringkasan per Unit, Rincian Pergerakan (jejak per unit), Bahan Tanpa Harga / Belum Final, Retur dan Waste.
// Nilai kosong = TIDAK DIKETAHUI (sel dibiarkan kosong), bukan Rp0. Total hanya menjumlah baris yang berstatus DINILAI.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { bacaJejakUnit, daftarUnitBiaya, unitSaudaraTanpaPemakaian } from "../biayaBahan.js";
import { susunLabelFilter } from "./excel.js";
import { hppOperasionalUnit } from "../hargaBerlaku.js";

const STATUS = { DINILAI: "Dinilai", TANPA_HARGA: "Tanpa harga", ESTIMASI_HISTORIS: "Belum final (estimasi historis)" };
const JENIS = { PEMAKAIAN: "Pemakaian", RETUR: "Retur diterima Gudang", SUSUT: "Waste / susut", PENYESUAIAN: "Penyesuaian" };
const LABEL_SAUDARA = "Belum ada pemakaian bahan";
const STATUS_BIAYA = { FINAL_MENURUT_HARGA_PO: "Final menurut harga PO", BELUM_FINAL: "Belum final", BELUM_ADA_PEMAKAIAN: "Belum ada pemakaian" };
const STATUS_FAKTUR = { FAKTUR_LENGKAP: "Faktur lengkap", FAKTUR_SEBAGIAN: "Faktur sebagian", FAKTUR_BELUM_ADA: "Faktur belum ada", TANPA_PO: "Tanpa PO" };
const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
const gabung = (xs) => [...new Set(xs.filter(Boolean))].join(", ");

async function ambil(db, { filter }) {
  const q = String(filter?.q ?? "").trim().slice(0, 60);
  const daftar = await daftarUnitBiaya(db, { q });
  const detail = []; const operasional = []; // HPP operasional (harga berlaku): sheet TERPISAH, tidak bercampur dengan nilai persediaan Finance
  for (const u of daftar) {
    const j = await bacaJejakUnit(db, u.unitId, { izinHarga: true });
    if (j) { detail.push(j); operasional.push({ j, h: await hppOperasionalUnit(db, u.unitId) }); }
  }

  // Order multi-unit: unit lain pada order yang sama yang BELUM punya pemakaian bahan ikut tampil (tanpa nilai) agar tidak terlewat.
  const { perOrder, saudara } = await unitSaudaraTanpaPemakaian(db, daftar);
  const unitOrder = (n) => { const p = perOrder.get(n); return p ? `${p.berBahan} dari ${p.total} unit ber-bahan` : ""; };
  const ringkasanBahan = detail.map((j) => ({
    unit: j.unit.unitCode, order: j.unit.orderNumber || "", unitOrder: unitOrder(j.unit.orderNumber), totalBiaya: j.ringkasan.totalBiaya, totalRetur: j.ringkasan.totalRetur,
    nilaiBersih: j.ringkasan.nilaiBersih, waste: j.ringkasan.totalWaste, selisihFaktur: j.ringkasan.selisihHargaFaktur?.nilai ?? null,
    tanpaHarga: j.ringkasan.jumlahTanpaHarga, historis: j.ringkasan.jumlahEstimasiHistoris, status: STATUS_BIAYA[j.statusBiaya] || j.statusBiaya,
  }));
  const ringkasanSaudara = saudara.map((u) => ({
    unit: u.unitCode, order: u.orderNumber, unitOrder: unitOrder(u.orderNumber), totalBiaya: null, totalRetur: null, nilaiBersih: null, waste: null, selisihFaktur: null,
    tanpaHarga: null, historis: null, status: LABEL_SAUDARA,
  }));
  const ringkasan = [...ringkasanBahan, ...ringkasanSaudara];

  const pergerakan = detail.flatMap((j) => j.bahan.flatMap((b) => b.pergerakan.map((r) => ({
    waktu: r.tanggal, unit: j.unit.unitCode, order: j.unit.orderNumber || "", kode: r.kode, bahan: r.nama, jenis: JENIS[r.jenisBiaya] || r.jenisBiaya,
    qty: Math.abs(r.qty), satuan: r.satuan, harga: r.hargaDasar, nilai: r.nilai, status: STATUS[r.status] || r.status,
    po: gabung(r.sumber.map((s) => s.poNumber)), penerimaan: gabung(r.sumber.map((s) => s.receiptNumber)), materialIssue: r.dokumen?.nomor || "",
    faktur: r.faktur ? (STATUS_FAKTUR[r.faktur.status] || r.faktur.status) : "", noFaktur: gabung((r.faktur?.dokumen ?? []).map((x) => x.nomor)),
    selisihFaktur: r.faktur?.selisih ?? null, oleh: r.oleh || "", catatan: r.catatan || "",
  })))).sort((a, b) => String(a.unit).localeCompare(String(b.unit)) || new Date(a.waktu) - new Date(b.waktu));

  const tanpaHarga = detail.flatMap((j) => j.bahan.flatMap((b) => b.pergerakan.filter((r) => r.status !== "DINILAI").map((r) => ({
    waktu: r.tanggal, unit: j.unit.unitCode, order: j.unit.orderNumber || "", kode: r.kode, bahan: r.nama, jenis: JENIS[r.jenisBiaya] || r.jenisBiaya, qty: Math.abs(r.qty), satuan: r.satuan,
    status: STATUS[r.status] || r.status, estimasi: r.estimasi, alasan: r.status === "TANPA_HARGA" ? "Bahan belum punya harga perolehan saat diposting — tidak dihitung (bukan Rp0)" : "Terjadi sebelum nilai dibekukan — hanya estimasi, tidak masuk total pasti",
  }))));

  const STATUS_OP = { DIBEKUKAN: "Dibekukan saat/oleh penerapan", DIBEKUKAN_TANPA_HARGA_BERLAKU: "Dibekukan tanpa harga berlaku", BELUM_DIBEKUKAN: "Belum dibekukan (pratinjau)", GAGAL_PEMBEKUAN: "GAGAL membekukan harga saat diposting — perlu diperbaiki" };
  const hppOp = operasional.flatMap(({ j, h }) => h.baris.map((r) => ({
    waktu: r.tanggal, unit: j.unit.unitCode, order: j.unit.orderNumber || "", kode: r.kode, bahan: r.nama, jenis: JENIS[r.jenisBiaya] || r.jenisBiaya, qty: Math.abs(r.qty), satuan: r.satuan,
    harga: r.harga ?? r.pratinjau?.harga ?? null, nilai: r.nilai, pratinjau: r.nilai == null ? (r.pratinjau?.nilai ?? null) : null, status: STATUS_OP[r.status] || r.status,
    bukti: r.teksLabelBukti || r.pratinjau?.label || "", dasar: r.basisTeks || "", sumber: r.sumber === "PENERAPAN_DISETUJUI" ? "Penerapan khusus (disetujui)" : r.sumber === "BEKU_SAAT_POSTING" ? "Dibekukan saat pemakaian diposting" : "",
  }))).sort((a, b) => String(a.unit).localeCompare(String(b.unit)) || new Date(a.waktu) - new Date(b.waktu));
  const hppOpDinilai = hppOp.filter((r) => r.nilai != null && r.jenis !== JENIS.SUSUT);
  const returWaste = pergerakan.filter((r) => r.jenis === JENIS.RETUR || r.jenis === JENIS.SUSUT);

  const kolomRincian = [
    { key: "waktu", header: "Waktu (WIB)", tipe: "waktu" }, { key: "unit", header: "Unit", tipe: "teks", lebar: 16 }, { key: "order", header: "No. Order", tipe: "teks", lebar: 18 },
    { key: "kode", header: "Kode Bahan", tipe: "teks", lebar: 16 }, { key: "bahan", header: "Bahan", tipe: "teks", lebar: 28 }, { key: "jenis", header: "Jenis", tipe: "teks", lebar: 20 },
    { key: "qty", header: "Jumlah", tipe: "angka" }, { key: "satuan", header: "Satuan", tipe: "teks", lebar: 9 }, { key: "harga", header: "Harga Dasar (Rp/satuan)", tipe: "angka" },
    { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "status", header: "Status Nilai", tipe: "teks", lebar: 26 },
    { key: "po", header: "No. PO", tipe: "teks", lebar: 20 }, { key: "penerimaan", header: "No. Penerimaan", tipe: "teks", lebar: 22 }, { key: "materialIssue", header: "No. Material Issue", tipe: "teks", lebar: 22 },
    { key: "faktur", header: "Status Faktur", tipe: "teks", lebar: 18 }, { key: "noFaktur", header: "No. Faktur Supplier", tipe: "teks", lebar: 22 }, { key: "selisihFaktur", header: "Selisih Harga Faktur (Rp)", tipe: "uang" },
    { key: "oleh", header: "Dicatat Oleh", tipe: "teks", lebar: 18 }, { key: "catatan", header: "Catatan", tipe: "teks", lebar: 30 },
  ];
  // Total biaya bersih = pemakaian − retur (+ penyesuaian); waste TIDAK ikut (dilaporkan terpisah) — sama dengan kartu "Biaya Bersih" di layar.
  const dinilai = pergerakan.filter((r) => r.status === STATUS.DINILAI && r.jenis !== JENIS.SUSUT);
  const catatanKosong = "Belum ada pemakaian bahan yang tertaut ke unit produksi untuk filter ini.";

  return {
    nama: "Biaya Bahan per Unit",
    filterLabel: susunLabelFilter([["Pencarian unit/order", q]]),
    sheets: [
      {
        nama: "Ringkasan per Unit", judul: "Biaya Bahan per Unit Produksi",
        kolom: [
          { key: "unit", header: "Unit", tipe: "teks", lebar: 16 }, { key: "order", header: "No. Order", tipe: "teks", lebar: 18 },
          { key: "unitOrder", header: "Unit dalam Order", tipe: "teks", lebar: 22 },
          { key: "totalBiaya", header: "Total Biaya Bahan (Rp)", tipe: "uang" }, { key: "totalRetur", header: "Retur Diterima (Rp)", tipe: "uang" },
          { key: "nilaiBersih", header: "Biaya Bersih (Rp)", tipe: "uang" }, { key: "waste", header: "Waste / Susut (Rp, terpisah)", tipe: "uang" },
          { key: "selisihFaktur", header: "Selisih Harga Faktur (Rp, terpisah)", tipe: "uang" }, { key: "tanpaHarga", header: "Pergerakan Tanpa Harga", tipe: "angka" },
          { key: "historis", header: "Pergerakan Estimasi Historis", tipe: "angka" }, { key: "status", header: "Status Biaya", tipe: "teks", lebar: 24 },
        ],
        baris: ringkasan,
        total: { label: `TOTAL (${ringkasanBahan.length} unit ber-bahan${ringkasanSaudara.length ? `, ${ringkasanSaudara.length} unit lain belum ada pemakaian` : ""})`, nilai: { totalBiaya: jumlah(ringkasan, "totalBiaya"), totalRetur: jumlah(ringkasan, "totalRetur"), nilaiBersih: jumlah(ringkasan, "nilaiBersih"), waste: jumlah(ringkasan, "waste"), selisihFaktur: jumlah(ringkasan, "selisihFaktur"), tanpaHarga: jumlah(ringkasan, "tanpaHarga"), historis: jumlah(ringkasan, "historis") } },
        catatan: [
          "Biaya bersih = total biaya bahan − retur yang sudah diterima Gudang. Waste dan selisih harga faktur ditampilkan terpisah dan tidak masuk biaya bersih.",
          "Sel kosong berarti belum diketahui (bahan tanpa harga atau belum ada pemakaian) — bukan Rp0. Layar menampilkan maksimal 100 unit terbaru; persempit pencarian untuk unit lain.",
          ringkasanSaudara.length ? `${ringkasanSaudara.length} unit pada order multi-unit belum punya pemakaian bahan tercatat (baris berstatus "${LABEL_SAUDARA}"). Kosong = belum dicatat, bukan Rp0 — cek apakah bahan unit itu terlewat.` : null,
          ringkasan.length === 0 ? catatanKosong : null,
        ].filter(Boolean),
      },
      {
        nama: "Rincian Pergerakan", judul: "Jejak Biaya Bahan — Rincian per Pergerakan", kolom: kolomRincian, baris: pergerakan,
        total: { label: `TOTAL biaya bersih, berstatus Dinilai, tanpa waste (${dinilai.length} baris)`, nilai: { nilai: jumlah(dinilai, "nilai"), selisihFaktur: jumlah(dinilai, "selisihFaktur") } },
        catatan: ["Nilai bertanda minus = retur yang mengurangi biaya. Waste, selisih faktur, dan baris Tanpa harga / Belum final tidak masuk total biaya bersih."],
      },
      {
        nama: "Tanpa Harga", judul: "Bahan Tanpa Harga dan Belum Final",
        kolom: [
          { key: "waktu", header: "Waktu (WIB)", tipe: "waktu" }, { key: "unit", header: "Unit", tipe: "teks", lebar: 16 }, { key: "order", header: "No. Order", tipe: "teks", lebar: 18 },
          { key: "kode", header: "Kode Bahan", tipe: "teks", lebar: 16 }, { key: "bahan", header: "Bahan", tipe: "teks", lebar: 28 }, { key: "jenis", header: "Jenis", tipe: "teks", lebar: 20 },
          { key: "qty", header: "Jumlah", tipe: "angka" }, { key: "satuan", header: "Satuan", tipe: "teks", lebar: 9 }, { key: "status", header: "Status", tipe: "teks", lebar: 28 },
          { key: "estimasi", header: "Estimasi Informatif (Rp, bukan biaya)", tipe: "uang" }, { key: "alasan", header: "Alasan", tipe: "teks", lebar: 56 },
        ],
        baris: tanpaHarga, catatan: tanpaHarga.length === 0 ? ["Tidak ada pergerakan tanpa harga atau belum final pada unit-unit ini."] : undefined,
      },
      {
        nama: "Retur dan Waste", judul: "Retur Diterima dan Waste per Unit", kolom: kolomRincian.filter((k) => !["faktur", "noFaktur", "selisihFaktur"].includes(k.key)), baris: returWaste,
        catatan: [returWaste.length === 0 ? "Tidak ada retur yang sudah diterima atau waste pada unit-unit ini." : "Retur dan waste tidak digabung: retur mengurangi biaya (nilai minus), waste tetap menjadi susut yang dilaporkan terpisah."],
      },
      {
        nama: "HPP Operasional", judul: "HPP Operasional (Harga Berlaku) — BUKAN nilai persediaan/jurnal Finance",
        kolom: [
          { key: "waktu", header: "Waktu pemakaian (WIB)", tipe: "waktu" }, { key: "unit", header: "Unit", tipe: "teks", lebar: 16 }, { key: "order", header: "No. Order", tipe: "teks", lebar: 18 },
          { key: "kode", header: "Kode Bahan", tipe: "teks", lebar: 16 }, { key: "bahan", header: "Bahan", tipe: "teks", lebar: 28 }, { key: "jenis", header: "Jenis", tipe: "teks", lebar: 20 },
          { key: "qty", header: "Jumlah", tipe: "angka" }, { key: "satuan", header: "Satuan", tipe: "teks", lebar: 9 }, { key: "harga", header: "Harga Berlaku (Rp/satuan)", tipe: "angka" },
          { key: "nilai", header: "HPP Operasional Dibekukan (Rp)", tipe: "uang" }, { key: "pratinjau", header: "Pratinjau (Rp, belum dibekukan)", tipe: "uang" }, { key: "status", header: "Status", tipe: "teks", lebar: 30 },
          { key: "dasar", header: "Dasar Harga (waktu pemakaian / waste / ISSUE asal)", tipe: "teks", lebar: 44 }, { key: "bukti", header: "Label Bukti Harga", tipe: "teks", lebar: 40 }, { key: "sumber", header: "Sumber Nilai", tipe: "teks", lebar: 32 },
        ],
        baris: hppOp,
        total: { label: `TOTAL HPP operasional dibekukan, tanpa waste (${hppOpDinilai.length} baris)`, nilai: { nilai: jumlah(hppOpDinilai, "nilai") } },
        catatan: ["HPP OPERASIONAL = harga berlaku (harga kerja) × pemakaian aktual, dibekukan saat pemakaian diposting. BUKAN nilai buku dan BUKAN HPP final Finance; tidak sama dengan sheet Rincian Pergerakan (biaya perolehan PSA/GR) dan tidak berubah karena sheet itu.",
          "Sel nilai kosong = belum dibekukan / tanpa harga berlaku (bukan Rp0). Kolom Pratinjau hanya informasi dan tidak dijumlahkan."],
      },
    ],
  };
}

export default { kunci: "biaya-bahan", nama: "Biaya Bahan per Unit", izin: [P.FINANCE_READ], ambil };
