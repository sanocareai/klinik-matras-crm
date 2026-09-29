// EXPORT EXCEL — UANG MUKA OPERASIONAL (B3.9). Layar punya 4 tab (Saldo Aktif, Pertanggungjawaban, Pengembalian, Riwayat) tanpa
// pencarian/filter sisi-klien, jadi export MENGIKUTI TAB AKTIF:
//   filter.tab = "SALDO" | "PERTANGGUNGJAWABAN" | "PENGEMBALIAN" | "RIWAYAT"  (tanpa tab = semua tab jadi sheet terpisah)
//   ids        = (opsional) id baris tab SALDO (uang muka) / PERTANGGUNGJAWABAN (pengeluaran) yang tampil, urutan layar dihormati
// Data dibaca lewat services/finance/uangMukaRead.js (daftar + ringkasan + riwayat) dan expenseRead.js (pertanggungjawaban) — query yang
// SAMA dengan layar. Sheet "Ringkasan" (4 kartu di kepala halaman) selalu ikut.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { ambilDaftarUangMuka, ambilRiwayatUangMuka } from "../uangMukaRead.js";
import { ambilDaftarPengeluaran, ambilPengeluaranByIds } from "../expenseRead.js";
import { susunLabelFilter } from "./excel.js";
import { labelCaraBayar, labelMetodeTransfer } from "./label.js";

const LABEL_STATUS_LAYAR = {
  AKTIF: "Aktif", SEBAGIAN: "Sebagian", SELESAI: "Selesai", DIBATALKAN: "Dibatalkan", DRAFT: "Draft", MENUNGGU_APPROVAL: "Menunggu Persetujuan",
  DISETUJUI: "Disetujui", DIBAYAR: "Dibayar", DITOLAK: "Ditolak",
};
const labelStatus = (s) => LABEL_STATUS_LAYAR[s] || String(s ?? "");
const LABEL_DIVISI = {
  SALES: "Sales", PRODUKSI: "Produksi", GUDANG: "Gudang", DELIVERY: "Delivery", DIGITAL_TECHNOLOGY: "D&T (Digital & Technology)",
  OFFICE: "Office", MANAGEMENT: "Management", UMUM: "Umum",
};
const LABEL_JENIS = { DIBERIKAN: "Diberikan", PERTANGGUNGJAWABAN: "Pertanggungjawaban", PENGEMBALIAN: "Pengembalian" };
const TAB = ["SALDO", "PERTANGGUNGJAWABAN", "PENGEMBALIAN", "RIWAYAT"];
const LABEL_TAB = { SALDO: "Saldo Aktif", PERTANGGUNGJAWABAN: "Pertanggungjawaban", PENGEMBALIAN: "Pengembalian", RIWAYAT: "Riwayat" };
const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

function sheetUangMuka(items) {
  const baris = items.map((u) => ({
    nomor: u.advanceNumber, pemegang: u.holder?.name || "", tujuan: u.purpose, divisi: LABEL_DIVISI[u.division] || u.division || "",
    tanggal: u.date, tenggat: u.dueDate || null, nominal: u.amount, dipertanggungjawabkan: u.dipertanggungjawabkan, dikembalikan: u.dikembalikan, saldo: u.saldo,
    status: labelStatus(u.status), lewat: u.lewatTempo ? "Ya" : "Tidak", rekening: u.cashAccount?.name || "",
    caraBayar: labelCaraBayar(u.paymentMethod), metodeTransfer: labelMetodeTransfer(u.transferFeeType), biayaAdmin: Number(u.transferFeeAmount) || 0,
    dicatat: u.createdBy?.name || "", waktuBatal: u.cancelledAt || null, alasanBatal: u.status === "DIBATALKAN" ? (u.cancelReason || "") : "",
    bukti: u.receiptUrl || "", catatan: u.notes || "",
  }));
  const bukanBatal = items.filter((u) => u.status !== "DIBATALKAN");
  const aktif = items.filter((u) => ["AKTIF", "SEBAGIAN"].includes(u.status));
  return {
    nama: "Uang Muka", judul: "Uang Muka Operasional — Daftar",
    kolom: [
      { key: "nomor", header: "No. Uang Muka", tipe: "teks", lebar: 20 }, { key: "pemegang", header: "Pemegang", tipe: "teks", lebar: 20 },
      { key: "tujuan", header: "Tujuan", tipe: "teks", lebar: 32 }, { key: "divisi", header: "Divisi", tipe: "teks", lebar: 16 },
      { key: "tanggal", header: "Tanggal Diberikan", tipe: "tanggal" }, { key: "tenggat", header: "Tenggat", tipe: "tanggal" },
      { key: "nominal", header: "Nominal (Rp)", tipe: "uang" }, { key: "dipertanggungjawabkan", header: "Dipertanggungjawabkan (Rp)", tipe: "uang", lebar: 20 },
      { key: "dikembalikan", header: "Dikembalikan (Rp)", tipe: "uang" }, { key: "saldo", header: "Saldo (Rp)", tipe: "uang" },
      { key: "status", header: "Status", tipe: "teks", lebar: 14 }, { key: "lewat", header: "Lewat Tenggat", tipe: "teks", lebar: 12 },
      { key: "rekening", header: "Rekening Sumber", tipe: "teks", lebar: 20 }, { key: "caraBayar", header: "Cara Bayar", tipe: "teks", lebar: 12 },
      { key: "metodeTransfer", header: "Metode Transfer", tipe: "teks", lebar: 16 }, { key: "biayaAdmin", header: "Biaya Admin (Rp)", tipe: "uang" },
      { key: "dicatat", header: "Dicatat Oleh", tipe: "teks", lebar: 18 }, { key: "waktuBatal", header: "Waktu Dibatalkan", tipe: "waktu" },
      { key: "alasanBatal", header: "Alasan Pembatalan", tipe: "teks", lebar: 28, sensitif: true },
      { key: "bukti", header: "Tautan Bukti", tipe: "teks", lebar: 30, sensitif: true },
      { key: "catatan", header: "Catatan Internal", tipe: "teks", lebar: 30, sensitif: true },
    ],
    baris,
    total: {
      label: `TOTAL (${bukanBatal.length} uang muka tidak dibatalkan)`,
      nilai: { nominal: jumlah(bukanBatal, "amount"), dipertanggungjawabkan: jumlah(bukanBatal, "dipertanggungjawabkan"), dikembalikan: jumlah(bukanBatal, "dikembalikan"), saldo: jumlah(aktif, "saldo"), biayaAdmin: jumlah(bukanBatal, "transferFeeAmount") },
    },
    catatan: ["Saldo = nominal − pertanggungjawaban − pengembalian (aktif); total saldo hanya menghitung uang muka Aktif/Sebagian, sama dengan kartu Saldo Uang Muka Aktif. Uang muka yang dibatalkan tidak dijumlahkan."],
  };
}

function sheetPerPemegang(perPemegang) {
  return {
    nama: "Saldo per Pemegang", judul: "Saldo Uang Muka per Pemegang",
    kolom: [
      { key: "nama", header: "Pemegang", tipe: "teks", lebar: 24 }, { key: "jumlah", header: "Uang Muka Aktif", tipe: "angka", lebar: 14 },
      { key: "lewatTempo", header: "Lewat Tenggat", tipe: "angka", lebar: 14 }, { key: "saldo", header: "Saldo (Rp)", tipe: "uang" },
    ],
    baris: perPemegang,
    total: { label: "TOTAL", nilai: { jumlah: jumlah(perPemegang, "jumlah"), lewatTempo: jumlah(perPemegang, "lewatTempo"), saldo: jumlah(perPemegang, "saldo") } },
  };
}

function sheetPertanggungjawaban(expenses) {
  const menunggu = (e) => ["DRAFT", "MENUNGGU_APPROVAL"].includes(e.status);
  const baris = expenses.map((e) => {
    const dipakai = Number(e.advanceAppliedAmount) || 0;
    return {
      nomor: e.expenseNumber, tanggal: e.date, uangMuka: e.advance?.advanceNumber || "", keterangan: e.description, nominal: Number(e.amount) || 0,
      dariUangMuka: menunggu(e) ? null : dipakai, selisih: menunggu(e) ? null : (Number(e.amount) || 0) - dipakai, status: labelStatus(e.status),
    };
  });
  const berlaku = expenses.filter((e) => ["DISETUJUI", "DIBAYAR"].includes(e.status));
  const dipakaiTotal = berlaku.reduce((a, e) => a + (Number(e.advanceAppliedAmount) || 0), 0);
  const nominalTotal = berlaku.reduce((a, e) => a + (Number(e.amount) || 0), 0);
  return {
    nama: "Pertanggungjawaban", judul: "Pertanggungjawaban Biaya (dibayar dari uang muka)",
    kolom: [
      { key: "nomor", header: "No. Pengeluaran", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" },
      { key: "uangMuka", header: "No. Uang Muka", tipe: "teks", lebar: 20 }, { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 34 },
      { key: "nominal", header: "Nominal (Rp)", tipe: "uang" }, { key: "dariUangMuka", header: "Dari Uang Muka (Rp)", tipe: "uang", lebar: 18 },
      { key: "selisih", header: "Selisih / Utang (Rp)", tipe: "uang", lebar: 18 }, { key: "status", header: "Status", tipe: "teks", lebar: 20 },
    ],
    baris,
    total: { label: `TOTAL disetujui (${berlaku.length} pengeluaran)`, nilai: { nominal: nominalTotal, dariUangMuka: dipakaiTotal, selisih: nominalTotal - dipakaiTotal } },
    catatan: ["Saldo uang muka baru berkurang saat pengeluaran DISETUJUI; baris Draft / Menunggu Persetujuan menampilkan kolom uang muka kosong dan tidak dijumlahkan."],
  };
}

function sheetPengembalian(riwayat) {
  const baris = riwayat.filter((r) => r.jenis === "PENGEMBALIAN").map((r) => ({
    nomor: r.advanceNumber, tanggal: r.tanggal, pemegang: r.pemegang || "", keterangan: r.keterangan || "", nominal: r.nominal, status: labelStatus(r.status),
    alasanBatal: r.status === "DIBATALKAN" ? (r.alasan || "") : "",
  }));
  const aktif = baris.filter((b) => b.status === "Aktif");
  return {
    nama: "Pengembalian", judul: "Pengembalian Sisa Uang Muka",
    kolom: [
      { key: "nomor", header: "No. Uang Muka", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" },
      { key: "pemegang", header: "Pemegang", tipe: "teks", lebar: 20 }, { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 34 },
      { key: "nominal", header: "Nominal (Rp)", tipe: "uang" }, { key: "status", header: "Status", tipe: "teks", lebar: 14 },
      { key: "alasanBatal", header: "Alasan Pembatalan", tipe: "teks", lebar: 28, sensitif: true },
    ],
    baris,
    total: { label: `TOTAL pengembalian aktif (${aktif.length})`, nilai: { nominal: jumlah(aktif, "nominal") } },
  };
}

function sheetRiwayat(riwayat) {
  const baris = riwayat.map((r) => ({
    nomor: r.advanceNumber, tanggal: r.tanggal, jenis: LABEL_JENIS[r.jenis] || r.jenis, pemegang: r.pemegang || "", keterangan: r.keterangan || "",
    nominal: r.nominal, status: labelStatus(r.status), alasanBatal: r.status === "DIBATALKAN" ? (r.alasan || "") : "",
  }));
  return {
    nama: "Riwayat", judul: "Riwayat Uang Muka",
    kolom: [
      { key: "nomor", header: "No. Uang Muka", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" },
      { key: "jenis", header: "Jenis", tipe: "teks", lebar: 20 }, { key: "pemegang", header: "Pemegang", tipe: "teks", lebar: 20 },
      { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 34 }, { key: "nominal", header: "Nominal (Rp)", tipe: "uang" },
      { key: "status", header: "Status", tipe: "teks", lebar: 14 }, { key: "alasanBatal", header: "Alasan Pembatalan", tipe: "teks", lebar: 28, sensitif: true },
    ],
    baris,
    catatan: ["Riwayat memuat pemberian, pertanggungjawaban, dan pengembalian (terbaru di atas); jenis berbeda tidak dijumlahkan."],
  };
}

function sheetRingkasan(ringkasan) {
  return {
    nama: "Ringkasan", judul: "Ringkasan Uang Muka Operasional",
    kolom: [{ key: "indikator", header: "Indikator", tipe: "teks", lebar: 44 }, { key: "jumlah", header: "Jumlah", tipe: "angka", lebar: 12 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }],
    baris: [
      { indikator: "Saldo Uang Muka Aktif (belum dipertanggungjawabkan)", jumlah: ringkasan.jumlahAktif, nilai: ringkasan.totalSaldoAktif },
      { indikator: "Uang Muka Aktif (pemberian yang belum selesai)", jumlah: ringkasan.jumlahAktif, nilai: null },
      { indikator: "Lewat Tenggat", jumlah: ringkasan.jumlahLewatTempo, nilai: null },
      { indikator: "Pemegang (orang yang sedang memegang uang muka)", jumlah: ringkasan.perPemegang.length, nilai: null },
    ],
  };
}

async function ambil(db, { user, filter, ids, filterLabel }) {
  const tab = TAB.includes(filter.tab) ? filter.tab : null;
  const perlu = (k) => !tab || tab === k;

  const [daftar, riwayat] = await Promise.all([
    ambilDaftarUangMuka(db, { status: filter.status, holderId: filter.holderId, q: filter.q, lewatTempo: filter.lewatTempo }, { take: 50_001, ids: tab === "SALDO" && ids ? ids : null }),
    perlu("PENGEMBALIAN") || perlu("RIWAYAT") ? ambilRiwayatUangMuka(db) : Promise.resolve([]),
  ]);
  // Ringkasan (kartu) selalu dari SELURUH uang muka, sama dengan layar — bukan dari baris terpilih.
  const ringkasan = tab === "SALDO" && ids ? (await ambilDaftarUangMuka(db, {}, { take: 50_001 })).ringkasan : daftar.ringkasan;

  const sheets = [];
  if (perlu("SALDO")) {
    sheets.push(sheetUangMuka(daftar.items));
    // Seperti layar: tabel "Saldo per Pemegang" hanya ada bila ada pemegang aktif.
    if (ringkasan.perPemegang.length > 0) sheets.push(sheetPerPemegang(ringkasan.perPemegang));
  }
  if (perlu("PERTANGGUNGJAWABAN")) {
    // Layar memuat semua pengeluaran mode UANG_MUKA (rentang 2020–2099), tanpa filter lain.
    const rentang = rentangDariQuery({ from: "2020-01-01", to: "2099-12-31" });
    const expenses = tab === "PERTANGGUNGJAWABAN" && ids
      ? await ambilPengeluaranByIds(db, ids, { user })
      : (await ambilDaftarPengeluaran(db, { rentang, mode: "UANG_MUKA" }, { user, take: 50_001 })).expenses;
    sheets.push(sheetPertanggungjawaban(expenses));
  }
  if (perlu("PENGEMBALIAN")) sheets.push(sheetPengembalian(riwayat));
  if (perlu("RIWAYAT")) sheets.push(sheetRiwayat(riwayat));
  sheets.push(sheetRingkasan(ringkasan));

  return {
    nama: "Uang Muka Operasional",
    filterLabel: filterLabel || susunLabelFilter([["Tab", tab ? LABEL_TAB[tab] : "Semua tab"], ["Status", filter.status && labelStatus(filter.status)], ["Lewat tenggat", filter.lewatTempo === "1" ? "Ya" : ""], ["Pencarian", filter.q]]),
    sheets,
  };
}

export default { kunci: "uang-muka", nama: "Uang Muka", izin: [P.FINANCE_READ], ambil };
