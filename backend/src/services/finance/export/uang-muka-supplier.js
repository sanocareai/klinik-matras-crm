// EXPORT EXCEL — UANG MUKA SUPPLIER (Okt 2026). Angka SAMA dengan layar: dibaca dari services/finance/uangMukaSupplier.js (daftarUangMuka, daftarPenerapan, ringkasUangMukaSupplier, ringkasanKeuanganPO) —
// bukan query kedua. Sheet: Ringkasan, Uang Muka (daftar DP + saldo belum diterapkan), Penerapan ke Faktur, Per Supplier, Sisa Komitmen PO.
//   filter.supplierId        hanya satu supplier
//   filter.belumDiterapkan   "1" → sheet Uang Muka hanya yang masih punya saldo belum diterapkan
// Mutasi rekening untuk uang muka = nominal + biaya admin (kolom Total Keluar Rekening) — sama dengan Kas & Bank. Uang muka TIDAK masuk aging utang.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { daftarUangMuka, daftarPenerapan, ringkasUangMukaSupplier, ringkasanKeuanganPO } from "../uangMukaSupplier.js";
import { susunLabelFilter } from "./excel.js";

const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
const LABEL_STATUS = { DIBAYAR: "Dibayar", DIBATALKAN: "Dibatalkan", DISETUJUI: "Disetujui", DRAFT: "Draft", MENUNGGU_APPROVAL: "Menunggu Persetujuan" };

function sheetUangMuka(daftar) {
  const baris = daftar.map((d) => ({
    nomor: d.nomor, tanggal: d.tanggal, supplier: d.supplier?.nama ?? "", po: d.purchaseOrder?.nomor ?? "", rekening: d.rekening ?? "",
    nominal: d.nominal, biayaAdmin: d.biayaAdmin, totalKeluar: d.totalKeluarRekening, keFaktur: d.diterapkanKeFaktur, kePembelian: d.diterapkanKePembelian, saldo: d.saldoBelumDiterapkan,
    status: LABEL_STATUS[d.status] || d.status, referensi: d.referensi ?? "", melebihi: d.melebihiPO ? "Ya" : "Tidak", alasanMelebihi: d.alasanMelebihiPO ?? "", dicatat: d.dibuatOleh?.nama ?? "", catatan: d.catatan ?? "",
  }));
  const aktif = daftar.filter((d) => d.status === "DIBAYAR");
  return {
    nama: "Uang Muka", judul: "Daftar Uang Muka Supplier",
    kolom: [
      { key: "nomor", header: "No. Dokumen", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal Bayar", tipe: "tanggal" }, { key: "supplier", header: "Supplier", tipe: "teks", lebar: 24 },
      { key: "po", header: "PO", tipe: "teks", lebar: 18 }, { key: "rekening", header: "Rekening", tipe: "teks", lebar: 20 },
      { key: "nominal", header: "Uang Muka (Rp)", tipe: "uang" }, { key: "biayaAdmin", header: "Biaya Admin (Rp)", tipe: "uang" }, { key: "totalKeluar", header: "Total Keluar Rekening (Rp)", tipe: "uang" },
      { key: "keFaktur", header: "Diterapkan ke Faktur (Rp)", tipe: "uang" }, { key: "kePembelian", header: "Diterapkan ke Pembelian (Rp)", tipe: "uang" }, { key: "saldo", header: "Belum Diterapkan (Rp)", tipe: "uang" },
      { key: "status", header: "Status", tipe: "teks", lebar: 14 }, { key: "referensi", header: "No. Referensi", tipe: "teks", lebar: 20, sensitif: true },
      { key: "melebihi", header: "Melebihi Nilai PO", tipe: "teks", lebar: 12 }, { key: "alasanMelebihi", header: "Alasan Melebihi PO", tipe: "teks", lebar: 28, sensitif: true },
      { key: "dicatat", header: "Dicatat Oleh", tipe: "teks", lebar: 18 }, { key: "catatan", header: "Catatan", tipe: "teks", lebar: 28, sensitif: true },
    ],
    baris,
    total: { label: `TOTAL uang muka berstatus Dibayar (${aktif.length} dokumen)`, nilai: { nominal: jumlah(aktif, "nominal"), biayaAdmin: jumlah(aktif, "biayaAdmin"), totalKeluar: jumlah(aktif, "totalKeluarRekening"), keFaktur: jumlah(aktif, "diterapkanKeFaktur"), kePembelian: jumlah(aktif, "diterapkanKePembelian"), saldo: jumlah(aktif, "saldoBelumDiterapkan") } },
    catatan: [
      "Uang muka adalah ASET (akun Uang Muka Pembelian/Supplier, 1-1500): bukan stok, bukan biaya, bukan utang. Biaya admin bank dicatat terpisah ke Beban Administrasi Bank.",
      "Total Keluar Rekening = Uang Muka + Biaya Admin = mutasi rekening di Kas & Bank. Saldo belum diterapkan = Uang Muka − penerapan aktif (ke faktur dan ke pembelian); kelebihan di atas faktur menjadi Kredit Supplier (tanpa refund kas otomatis).",
    ],
  };
}

function sheetPenerapan(daftar) {
  const baris = daftar.map((a) => ({
    tanggal: a.tanggal, status: a.status === "ACTIVE" ? "Aktif" : "Dibatalkan", uangMuka: a.uangMuka.nomor, faktur: a.faktur.nomor, fakturSupplier: a.faktur.nomorSupplier ?? "", po: a.faktur.po ?? a.uangMuka.po ?? "",
    supplier: a.supplier, jumlah: a.jumlah, jurnal: a.jurnal, jurnalBalik: a.jurnalBalik ?? "", oleh: a.dibuatOleh ?? "", dibatalkanOleh: a.dibatalkanOleh ?? "", alasanBatal: a.alasanBatal ?? "", catatan: a.catatan ?? "",
  }));
  const aktif = daftar.filter((a) => a.status === "ACTIVE");
  return {
    nama: "Penerapan ke Faktur", judul: "Penerapan Uang Muka ke Faktur Supplier",
    kolom: [
      { key: "tanggal", header: "Waktu Penerapan", tipe: "waktu" }, { key: "status", header: "Status", tipe: "teks", lebar: 12 }, { key: "uangMuka", header: "Uang Muka", tipe: "teks", lebar: 20 },
      { key: "faktur", header: "Faktur (Tagihan)", tipe: "teks", lebar: 20 }, { key: "fakturSupplier", header: "No. Faktur Supplier", tipe: "teks", lebar: 20 }, { key: "po", header: "PO", tipe: "teks", lebar: 18 },
      { key: "supplier", header: "Supplier", tipe: "teks", lebar: 24 }, { key: "jumlah", header: "Jumlah (Rp)", tipe: "uang" }, { key: "jurnal", header: "Jurnal", tipe: "teks", lebar: 18 }, { key: "jurnalBalik", header: "Jurnal Pembalik", tipe: "teks", lebar: 18 },
      { key: "oleh", header: "Diterapkan Oleh", tipe: "teks", lebar: 18 }, { key: "dibatalkanOleh", header: "Dibatalkan Oleh", tipe: "teks", lebar: 18 }, { key: "alasanBatal", header: "Alasan Pembatalan", tipe: "teks", lebar: 28, sensitif: true }, { key: "catatan", header: "Catatan", tipe: "teks", lebar: 28, sensitif: true },
    ],
    baris,
    total: { label: `TOTAL penerapan aktif (${aktif.length})`, nilai: { jumlah: jumlah(aktif, "jumlah") } },
    catatan: ["Jurnal penerapan: Dr Utang Usaha / Cr Uang Muka Supplier. Nilai yang sama mengurangi sisa utang faktur (sama dengan Supplier & Utang dan aging)."],
  };
}

function sheetPerSupplier(ringkas) {
  const baris = ringkas.suppliers.map((s) => ({ supplier: s.supplier, total: s.totalUangMuka, terpakai: s.uangMukaTerpakai, belum: s.uangMukaBelumDiterapkan, utang: s.utangAktif, bersih: s.saldoBersih }));
  return {
    nama: "Per Supplier", judul: "Uang Muka dan Utang per Supplier",
    kolom: [
      { key: "supplier", header: "Supplier", tipe: "teks", lebar: 28 }, { key: "total", header: "Total Uang Muka (Rp)", tipe: "uang" }, { key: "terpakai", header: "Uang Muka Terpakai (Rp)", tipe: "uang" },
      { key: "belum", header: "Belum Diterapkan (Rp)", tipe: "uang" }, { key: "utang", header: "Utang Aktif (Rp)", tipe: "uang" }, { key: "bersih", header: "Saldo Bersih (Rp)", tipe: "uang" },
    ],
    baris,
    total: { label: `TOTAL (${baris.length} supplier)`, nilai: { total: ringkas.kartu.totalUangMuka, terpakai: ringkas.kartu.uangMukaTerpakai, belum: ringkas.kartu.uangMukaBelumDiterapkan, utang: ringkas.kartu.utangAktif, bersih: ringkas.kartu.saldoBersih } },
    catatan: ringkas.definisi.map((d) => `${d.label}: ${d.definisi}`),
  };
}

async function sheetKomitmen(db, supplierId) {
  const pos = await db.finPurchaseOrder.findMany({
    where: { ...(supplierId && { supplierId }), OR: [{ status: { in: ["DISETUJUI", "DITERIMA_SEBAGIAN"] } }, { status: { in: ["SELESAI", "DIBATALKAN"] }, advances: { some: { status: "DIBAYAR" } } }] },
    orderBy: [{ orderDate: "desc" }], take: 500, select: { id: true, poNumber: true, status: true, orderDate: true, supplier: { select: { name: true } } },
  });
  const baris = [];
  for (const po of pos) {
    const k = await ringkasanKeuanganPO(db, po.id);
    baris.push({ po: po.poNumber, tanggal: po.orderDate, supplier: po.supplier.name, status: po.status, nilaiPO: k.nilaiPO, uangMuka: k.uangMukaDibayar, diterapkan: k.uangMukaDiterapkan, belum: k.uangMukaBelumDiterapkan, ditagih: k.sudahDitagih, utang: k.utangTercatat, dibayar: k.dibayarAtasFaktur, sisaUtang: k.sisaUtang, komitmen: k.sisaKomitmen, catatan: k.peringatan?.pesan ?? "" });
  }
  return {
    nama: "Sisa Komitmen PO", judul: "Sisa Komitmen PO dan Utang Sebenarnya",
    kolom: [
      { key: "po", header: "PO", tipe: "teks", lebar: 18 }, { key: "tanggal", header: "Tanggal PO", tipe: "tanggal" }, { key: "supplier", header: "Supplier", tipe: "teks", lebar: 24 }, { key: "status", header: "Status PO", tipe: "teks", lebar: 18 },
      { key: "nilaiPO", header: "Nilai PO (Rp)", tipe: "uang" }, { key: "uangMuka", header: "Uang Muka Dibayar (Rp)", tipe: "uang" }, { key: "diterapkan", header: "Uang Muka Diterapkan (Rp)", tipe: "uang" }, { key: "belum", header: "Uang Muka Belum Diterapkan (Rp)", tipe: "uang" },
      { key: "ditagih", header: "Sudah Ditagih (Rp)", tipe: "uang" }, { key: "utang", header: "Utang Tercatat (Rp)", tipe: "uang" }, { key: "dibayar", header: "Dibayar atas Faktur (Rp)", tipe: "uang" }, { key: "sisaUtang", header: "Sisa Utang (Rp)", tipe: "uang" },
      { key: "komitmen", header: "Sisa Komitmen PO (Rp)", tipe: "uang" }, { key: "catatan", header: "Peringatan", tipe: "teks", lebar: 40 },
    ],
    baris,
    total: { label: `TOTAL (${baris.length} PO)`, nilai: { nilaiPO: jumlah(baris, "nilaiPO"), uangMuka: jumlah(baris, "uangMuka"), diterapkan: jumlah(baris, "diterapkan"), belum: jumlah(baris, "belum"), ditagih: jumlah(baris, "ditagih"), utang: jumlah(baris, "utang"), dibayar: jumlah(baris, "dibayar"), sisaUtang: jumlah(baris, "sisaUtang"), komitmen: jumlah(baris, "komitmen") } },
    catatan: [
      "Sisa Komitmen PO = Nilai PO − Uang Muka Dibayar − Dibayar atas Faktur. BUKAN utang: utang baru ada setelah faktur disetujui. Utang sebenarnya = kolom Sisa Utang (sama dengan Supplier & Utang dan aging).",
      "PO dibatalkan yang masih punya uang muka belum diterapkan: uang muka perlu dikembalikan supplier atau dialihkan ke faktur supplier yang sama.",
    ],
  };
}

async function ambil(db, { filter = {} }) {
  const supplierId = /^[0-9a-f-]{36}$/i.test(String(filter.supplierId ?? "")) ? filter.supplierId : null;
  const belumDiterapkan = filter.belumDiterapkan === "1" || filter.belumDiterapkan === true;
  const [daftar, penerapan, ringkas] = await Promise.all([
    daftarUangMuka(db, { supplierId, belumDiterapkan, take: 50_000 }),
    daftarPenerapan(db, { supplierId, take: 50_000 }),
    ringkasUangMukaSupplier(db, { supplierId }),
  ]);
  const komitmen = await sheetKomitmen(db, supplierId);
  const ringkasan = {
    nama: "Ringkasan", judul: "Ringkasan Uang Muka Supplier",
    kolom: [{ key: "indikator", header: "Indikator", tipe: "teks", lebar: 52 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }],
    baris: [
      { indikator: "Total Uang Muka Supplier (dibayar)", nilai: ringkas.kartu.totalUangMuka },
      { indikator: "Uang Muka Terpakai (diterapkan)", nilai: ringkas.kartu.uangMukaTerpakai },
      { indikator: "Uang Muka Supplier Belum Diterapkan", nilai: ringkas.kartu.uangMukaBelumDiterapkan },
      { indikator: "Utang Aktif (faktur disetujui)", nilai: ringkas.kartu.utangAktif },
      { indikator: "Saldo Bersih (utang aktif − uang muka belum diterapkan)", nilai: ringkas.kartu.saldoBersih },
      { indikator: "Sisa Komitmen PO (PO terbuka)", nilai: komitmen.total.nilai.komitmen },
    ],
    catatan: ["Uang muka adalah aset di neraca (akun 1-1500), bukan pengurang stok atau biaya. Aging utang hanya memakai faktur — sisa PO dan uang muka tidak masuk aging."],
  };
  return { nama: "Uang Muka Supplier", filterLabel: susunLabelFilter([["Supplier", supplierId ? "satu supplier" : ""], ["Saldo", belumDiterapkan ? "hanya yang belum diterapkan" : ""]]), sheets: [ringkasan, sheetUangMuka(daftar), sheetPenerapan(penerapan), sheetPerSupplier(ringkas), komitmen] };
}

export default { kunci: "uang-muka-supplier", nama: "Uang Muka Supplier", izin: [P.FINANCE_READ], ambil };
