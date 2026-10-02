// EXPORT EXCEL — REKONSILIASI BANK (B3.9). Isi berkas = yang sedang dibuka di layar:
//   • sheet "Rekonsiliasi"   : tabel Periode Rekonsiliasi (satu baris = satu rekening + rentang koran bank).
//       ids = id periode yang tampil setelah pencarian/filter sisi-klien (urutan layar dihormati); tanpa ids = filter.cashAccountId (server).
//   • bila filter.statementId (periode yang sedang dibuka di layar), ditambah sheet detailnya:
//       "Detail Periode" (kartu Saldo Buku / Saldo Bank / Selisih / Baris Belum Cocok + snapshot cutoff),
//       "Mutasi" (baris koran bank + pasangannya di buku; filter.lineIds = baris yang tampil setelah pencarian/filter klien, urutan layar),
//       "Setelah Cutoff" (posting/reversal/penyesuaian sesudah snapshot), "Penyesuaian Buku", "Perlu Ditinjau".
//       filter.fokus = "late" | "tinjau" mengikuti tombol Fokus tampilan di layar.
// Data dibaca lewat services/finance/bankStatementRead.js — perhitungan yang SAMA dengan layar (saldo buku, selisih, snapshot).
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { ambilDaftarStatement, ambilDetailStatement } from "../bankStatementRead.js";
import { idValid } from "../supplierRead.js";
import { ExportError, susunLabelFilter, labelPeriode } from "./excel.js";

const LABEL_STATUS_PERIODE = { DRAF_MENUNGGU_MUTASI: "Menunggu mutasi bank", DRAFT: "Sedang dicocokkan", SELESAI: "Selesai" };
const LABEL_STATUS_BARIS = { BELUM_COCOK: "Belum Cocok", COCOK: "Cocok", DIABAIKAN: "Diabaikan" };
const LABEL_KATEGORI = { POSTING_SETELAH_CUTOFF: "Posting setelah cutoff", REVERSAL_SETELAH_SNAPSHOT: "Reversal setelah snapshot", PENYESUAIAN_BUKU: "Penyesuaian buku" };
const LABEL_SUMBER = {
  PEMBAYARAN_ORDER: "Pembayaran order", PENGELUARAN: "Pengeluaran", PEMBELIAN: "Pembelian", TRANSFER_KAS: "Transfer kas",
  PEMASUKAN_LAIN: "Pemasukan lain", PEMBAYARAN_SUPPLIER: "Pembayaran supplier", REFUND: "Refund", KASBON: "Kasbon",
  SALDO_AWAL: "Penyesuaian saldo", REKONSILIASI_SEMENTARA: "Penyesuaian sementara (2-1700)", REVERSAL: "Reversal", MANUAL: "Jurnal umum",
  UANG_MUKA_OPERASIONAL: "Uang muka operasional", INSENTIF_DRIVER: "Insentif driver",
  PENJUALAN_KARYAWAN: "Penjualan karyawan", PEMBAYARAN_PENJUALAN_KARYAWAN: "Pembayaran penjualan karyawan",
};
const labelSumber = (s) => LABEL_SUMBER[s] || String(s ?? "");
const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
const kunciTgl = (d) => String(d instanceof Date ? d.toISOString() : d || "").slice(0, 10);

function arahSelisih(selisih) {
  if (Math.abs(selisih) < 0.005) return "Cocok";
  return selisih < 0 ? "Buku lebih tinggi" : "Bank lebih tinggi";
}

function sheetPeriode(statements) {
  const baris = statements.map((s) => {
    const c = s.cutoffInfo || {};
    return {
      rekening: s.cashAccount?.name || "", mulai: s.periodStart, akhir: s.periodEnd, saldoAwal: s.openingBalance, saldoAkhir: s.closingBalance, saldoBuku: s.saldoBuku,
      selisih: Math.abs(s.selisih) < 0.005 ? 0 : Math.abs(s.selisih), arah: arahSelisih(s.selisih),
      cutoff: c.cutoffAkhir || null, snapshot: c.adaSnapshot ? c.snapshotAt : null,
      selisihSnapshot: c.adaSnapshot && c.valid ? c.selisihSnapshot : null, snapshotStatus: !c.adaSnapshot ? "Belum ada snapshot" : c.valid ? "Berlaku" : "Tidak berlaku",
      late: c.postingSetelahCutoff?.jumlah ?? 0, tinjau: s.perluDitinjau ?? 0, mutasi: s.jumlahBaris, belumCocok: s.jumlahBaris === 0 ? null : s.belumCocok,
      status: LABEL_STATUS_PERIODE[s.status] || s.statusLabel || s.status, dibuat: s.createdBy?.name || "", diselesaikan: s.completedBy?.name || "",
      waktuSelesai: s.completedAt || null, catatan: s.note || "",
    };
  });
  return {
    nama: "Rekonsiliasi", judul: "Periode Rekonsiliasi Bank",
    kolom: [
      { key: "rekening", header: "Rekening", tipe: "teks", lebar: 24 }, { key: "mulai", header: "Periode Mulai", tipe: "tanggal" }, { key: "akhir", header: "Periode Akhir", tipe: "tanggal" },
      { key: "saldoAwal", header: "Saldo Awal Bank (Rp)", tipe: "uang", lebar: 18 }, { key: "saldoAkhir", header: "Saldo Akhir Bank (Rp)", tipe: "uang", lebar: 18 },
      { key: "saldoBuku", header: "Saldo Buku Akhir (Rp)", tipe: "uang", lebar: 18 }, { key: "selisih", header: "Selisih Terbuka (Rp)", tipe: "uang", lebar: 18 },
      { key: "arah", header: "Arah Selisih", tipe: "teks", lebar: 18 }, { key: "cutoff", header: "Cutoff Akhir", tipe: "waktu" }, { key: "snapshot", header: "Waktu Snapshot", tipe: "waktu" },
      { key: "snapshotStatus", header: "Status Snapshot", tipe: "teks", lebar: 18 }, { key: "selisihSnapshot", header: "Selisih Snapshot (Rp)", tipe: "uang", lebar: 18 },
      { key: "late", header: "Posting Setelah Cutoff", tipe: "angka", lebar: 14 }, { key: "tinjau", header: "Perlu Ditinjau", tipe: "angka", lebar: 12 },
      { key: "mutasi", header: "Jumlah Mutasi", tipe: "angka", lebar: 12 }, { key: "belumCocok", header: "Belum Cocok", tipe: "angka", lebar: 12 },
      { key: "status", header: "Status", tipe: "teks", lebar: 22 }, { key: "dibuat", header: "Dibuat Oleh", tipe: "teks", lebar: 18 },
      { key: "diselesaikan", header: "Diselesaikan Oleh", tipe: "teks", lebar: 18 }, { key: "waktuSelesai", header: "Waktu Selesai", tipe: "waktu" },
      { key: "catatan", header: "Catatan Internal", tipe: "teks", lebar: 34, sensitif: true },
    ],
    baris,
    total: { label: `TOTAL (${baris.length} periode)`, nilai: { late: jumlah(baris, "late"), tinjau: jumlah(baris, "tinjau"), mutasi: jumlah(baris, "mutasi"), belumCocok: jumlah(baris, "belumCocok") } },
    catatan: [
      "Selisih Terbuka = selisih mutlak antara saldo akhir menurut koran bank dan saldo buku pada akhir periode (Arah Selisih menjelaskan sisi mana yang lebih tinggi).",
      "Saldo per rekening tidak dijumlahkan lintas rekening karena tiap periode punya rekening & rentang tanggal berbeda.",
    ],
  };
}

function sheetDetail(d, s) {
  const r = d.rekonsiliasi;
  const c = d.cutoff;
  const baris = [
    { indikator: "Rekening", nilai: null, keterangan: s.cashAccount?.name || "" },
    { indikator: "Periode koran bank", nilai: null, keterangan: labelPeriode({ from: kunciTgl(s.periodStart), to: kunciTgl(s.periodEnd) }) },
    { indikator: "Status periode", nilai: null, keterangan: LABEL_STATUS_PERIODE[s.status] || r.statusLabel || s.status },
    { indikator: "Saldo Menurut Buku", nilai: r.saldoBuku, keterangan: "Hasil hitungan jurnal sampai akhir periode" },
    { indikator: "Saldo Menurut Bank", nilai: r.saldoKoran, keterangan: "Saldo akhir menurut koran bank (diisi manual)" },
    { indikator: "Selisih Terbuka", nilai: Math.abs(r.selisih), keterangan: r.cocok ? "Saldo akhir cocok" : r.selisih < 0 ? "Saldo buku lebih tinggi dari saldo bank" : "Saldo bank lebih tinggi dari saldo buku" },
    { indikator: "Baris Belum Cocok", nilai: null, keterangan: s.lines.length === 0 ? "Belum ada mutasi" : String(r.belumCocok) },
    ...(d.danaBelumTeridentifikasi?.total ? [{ indikator: "Dana Masuk Belum Teridentifikasi (2-1700)", nilai: d.danaBelumTeridentifikasi.total, keterangan: "Akun sementara, bukan pendapatan; periode tidak bisa diselesaikan sebelum diidentifikasi" }] : []),
    ...(r.sementara ? [{ indikator: "Rekonsiliasi sementara", nilai: null, keterangan: r.labelSementara || "" }] : []),
    ...(c ? [
      { indikator: "Snapshot saat dikonfirmasi (saldo buku)", nilai: c.snapshot.saldoBuku, keterangan: `Selisih vs bank: Rp${Number(c.snapshot.selisih).toLocaleString("id-ID")}` },
      { indikator: "Snapshot berlaku", nilai: null, keterangan: c.valid ? "Ya" : `Tidak — ${c.alasanTidakBerlaku || ""}` },
      { indikator: "Posting Setelah Cutoff", nilai: c.ringkasanSetelahSnapshot.POSTING_SETELAH_CUTOFF.total, keterangan: `${c.ringkasanSetelahSnapshot.POSTING_SETELAH_CUTOFF.jumlah} jurnal` },
      { indikator: "Reversal Setelah Snapshot", nilai: c.ringkasanSetelahSnapshot.REVERSAL_SETELAH_SNAPSHOT.total, keterangan: `${c.ringkasanSetelahSnapshot.REVERSAL_SETELAH_SNAPSHOT.jumlah} jurnal` },
      { indikator: "Penyesuaian Buku setelah snapshot", nilai: c.ringkasanSetelahSnapshot.PENYESUAIAN_BUKU.total, keterangan: `${c.ringkasanSetelahSnapshot.PENYESUAIAN_BUKU.jumlah} jurnal · bukan mutasi bank` },
      { indikator: "Saldo Buku Sekarang", nilai: c.saldoBukuSekarang, keterangan: c.identitas.konsisten ? "= snapshot + jurnal sesudahnya" : "Tidak cocok dengan snapshot + jurnal sesudahnya" },
    ] : [{ indikator: "Snapshot cutoff", nilai: null, keterangan: "Belum ada snapshot" }]),
    { indikator: "Syarat menyelesaikan periode", nilai: null, keterangan: d.rekonsiliasi.penyelesaian.bisa ? "Semua syarat terpenuhi" : `Belum: ${(d.rekonsiliasi.penyelesaian.alasan || []).join("; ")}` },
  ];
  return {
    nama: "Detail Periode", judul: `Detail Rekonsiliasi — ${s.cashAccount?.name || ""}`,
    kolom: [
      { key: "indikator", header: "Indikator", tipe: "teks", lebar: 44 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang", lebar: 18 }, { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 60 },
    ],
    baris,
  };
}

function sheetMutasi(lines, s) {
  const baris = lines.map((l) => ({
    tanggal: l.date, keterangan: l.description, referensi: l.reference || "", nominal: l.amount, arah: Number(l.amount) > 0 ? "Masuk" : Number(l.amount) < 0 ? "Keluar" : "",
    jurnal: l.matchedLine?.entry?.entryNumber || "", tglJurnal: l.matchedLine?.entry?.date || null,
    ketJurnal: l.matchedLine ? (l.matchedLine.description || l.matchedLine.entry?.description || "") : "",
    nilaiJurnal: l.matchedLine ? (Number(l.matchedLine.debit) || 0) - (Number(l.matchedLine.credit) || 0) : null,
    status: LABEL_STATUS_BARIS[l.status] || String(l.status), dicocokkan: l.matchedBy?.name || "", waktuCocok: l.matchedAt || null, catatan: l.note || "",
  }));
  const masuk = lines.filter((l) => Number(l.amount) > 0).reduce((a, l) => a + Number(l.amount), 0);
  const keluar = lines.filter((l) => Number(l.amount) < 0).reduce((a, l) => a + Number(l.amount), 0);
  return {
    nama: "Mutasi", judul: `Mutasi Koran Bank — ${s.cashAccount?.name || ""} · ${labelPeriode({ from: kunciTgl(s.periodStart), to: kunciTgl(s.periodEnd) })}`,
    kolom: [
      { key: "tanggal", header: "Tanggal", tipe: "tanggal" }, { key: "keterangan", header: "Keterangan Bank", tipe: "teks", lebar: 40 },
      { key: "referensi", header: "Referensi", tipe: "teks", lebar: 20 }, { key: "nominal", header: "Nominal (Rp)", tipe: "uang" }, { key: "arah", header: "Arah", tipe: "teks", lebar: 9 },
      { key: "jurnal", header: "No. Jurnal Pasangan", tipe: "teks", lebar: 22 }, { key: "tglJurnal", header: "Tanggal Jurnal", tipe: "tanggal" },
      { key: "ketJurnal", header: "Keterangan Jurnal", tipe: "teks", lebar: 36 }, { key: "nilaiJurnal", header: "Nilai Jurnal (Rp)", tipe: "uang" },
      { key: "status", header: "Status", tipe: "teks", lebar: 13 }, { key: "dicocokkan", header: "Dicocokkan Oleh", tipe: "teks", lebar: 18 }, { key: "waktuCocok", header: "Waktu Dicocokkan", tipe: "waktu" },
      { key: "catatan", header: "Catatan / Alasan Abaikan", tipe: "teks", lebar: 32, sensitif: true },
    ],
    baris,
    total: { label: `TOTAL (${baris.length} mutasi) — bersih`, nilai: { nominal: masuk + keluar } },
    catatan: [
      `Uang masuk ${masuk.toLocaleString("id-ID")} · uang keluar ${Math.abs(keluar).toLocaleString("id-ID")} (Rp). Nominal bertanda apa adanya dari koran bank: positif = masuk, negatif = keluar.`,
      "Pencocokan menuntut nominal sama persis, termasuk arahnya.",
    ],
  };
}

function sheetSetelahCutoff(c) {
  const item = [...c.postingSetelahCutoff, ...c.reversalSetelahSnapshot, ...c.penyesuaianSetelahSnapshot];
  const baris = item.map((i) => ({
    kategori: LABEL_KATEGORI[i.kategori] || i.kategori || "", nomor: i.nomor, tanggalBuku: i.tanggalBuku, sebelum: i.tanggalSebelumPeriode ? "Ya" : "Tidak",
    dibuat: i.dibuatPada || null, sumber: labelSumber(i.sumber), nilai: i.nilai,
  }));
  return {
    nama: "Setelah Cutoff", judul: "Jurnal Sesudah Snapshot Cutoff",
    kolom: [
      { key: "kategori", header: "Kategori", tipe: "teks", lebar: 26 }, { key: "nomor", header: "No. Jurnal", tipe: "teks", lebar: 22 }, { key: "tanggalBuku", header: "Tanggal Buku", tipe: "tanggal" },
      { key: "sebelum", header: "Sebelum Periode", tipe: "teks", lebar: 12 }, { key: "dibuat", header: "Dibuat Pada", tipe: "waktu" },
      { key: "sumber", header: "Sumber", tipe: "teks", lebar: 26 }, { key: "nilai", header: "Dampak (Rp)", tipe: "uang" },
    ],
    baris,
    catatan: ["Posting Setelah Cutoff, Reversal Setelah Snapshot, dan Penyesuaian Buku dipisah per kategori dan tidak dijumlahkan menjadi satu angka."],
  };
}

function sheetPenyesuaian(pb) {
  const baris = pb.items.map((x) => ({ nomor: x.nomor, tanggal: x.tanggal, jenis: x.jenisLabel || "", keterangan: x.keterangan || "", nilai: x.nilai }));
  return {
    nama: "Penyesuaian Buku", judul: "Penyesuaian Buku (bukan transaksi bank)",
    kolom: [
      { key: "nomor", header: "No. Jurnal", tipe: "teks", lebar: 22 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" }, { key: "jenis", header: "Jenis", tipe: "teks", lebar: 26 },
      { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 44 }, { key: "nilai", header: "Pengaruh ke Saldo Buku (Rp)", tipe: "uang", lebar: 24 },
    ],
    baris,
    total: { label: `TOTAL (${baris.length} jurnal) — bersih`, nilai: { nilai: jumlah(baris, "nilai") } },
    catatan: pb.catatan ? [String(pb.catatan)] : [],
  };
}

function sheetTinjau(pd) {
  const baris = pd.items.map((x) => ({
    label: x.label, jenis: x.jenisDokumen || "", nomor: x.nomor || "", tanggal: x.tanggal || null, jurnal: x.jurnal || "", rincian: x.rincian || "",
    status: x.ditinjau ? "Ditinjau" : "Terbuka", oleh: x.ditinjau?.oleh || "", waktu: x.ditinjau?.pada || null, catatan: x.ditinjau?.catatan || "",
  }));
  return {
    nama: "Perlu Ditinjau", judul: `Perlu Ditinjau (${pd.terbuka} terbuka)`,
    kolom: [
      { key: "label", header: "Temuan", tipe: "teks", lebar: 44 }, { key: "jenis", header: "Jenis Dokumen", tipe: "teks", lebar: 20 }, { key: "nomor", header: "No. Dokumen", tipe: "teks", lebar: 20 },
      { key: "tanggal", header: "Tanggal", tipe: "tanggal" }, { key: "jurnal", header: "Jurnal", tipe: "teks", lebar: 26 }, { key: "rincian", header: "Rincian", tipe: "teks", lebar: 34 },
      { key: "status", header: "Status", tipe: "teks", lebar: 12 }, { key: "oleh", header: "Ditinjau Oleh", tipe: "teks", lebar: 18 }, { key: "waktu", header: "Waktu Tinjau", tipe: "waktu" },
      { key: "catatan", header: "Catatan Tinjauan", tipe: "teks", lebar: 40, sensitif: true },
    ],
    baris,
  };
}

async function ambil(db, { filter, ids, filterLabel }) {
  const statements = await ambilDaftarStatement(db, { cashAccountId: filter.cashAccountId }, { take: 50_001, ids: ids || null });
  const sheets = [sheetPeriode(statements)];

  let periodeLabel;
  const bagianLabel = [["Rekening", filter.cashAccountId && statements[0]?.cashAccount?.name], ["Periode", ids ? "sesuai baris yang tampil di layar" : ""]];
  if (filter.statementId) {
    if (idValid([filter.statementId]).length === 0) throw new ExportError("Periode rekonsiliasi tidak ditemukan", 404, "TIDAK_DITEMUKAN");
    const d = await ambilDetailStatement(db, String(filter.statementId));
    if (!d) throw new ExportError("Periode rekonsiliasi tidak ditemukan", 404, "TIDAK_DITEMUKAN");
    const s = d.statement;
    const fokus = ["late", "tinjau"].includes(filter.fokus) ? filter.fokus : "";

    let lines = s.lines;
    if (Array.isArray(filter.lineIds)) {
      const urut = new Map(filter.lineIds.map((id, i) => [String(id), i]));
      lines = lines.filter((l) => urut.has(l.id)).sort((a, b) => urut.get(a.id) - urut.get(b.id));
    } else {
      if (filter.status) lines = lines.filter((l) => l.status === filter.status);
      if (filter.arah === "masuk") lines = lines.filter((l) => Number(l.amount) > 0);
      if (filter.arah === "keluar") lines = lines.filter((l) => Number(l.amount) < 0);
    }

    sheets.push(sheetDetail(d, s));
    if (!fokus) sheets.push(sheetMutasi(lines, s));
    if (d.cutoff && fokus !== "tinjau") sheets.push(sheetSetelahCutoff(d.cutoff));
    if (!fokus && d.penyesuaianBuku?.items?.length > 0) sheets.push(sheetPenyesuaian(d.penyesuaianBuku));
    if (fokus !== "late" && d.perluDitinjau) sheets.push(sheetTinjau(d.perluDitinjau));

    periodeLabel = labelPeriode({ from: kunciTgl(s.periodStart), to: kunciTgl(s.periodEnd) });
    bagianLabel.push(["Periode dibuka", `${s.cashAccount?.name || ""}`], ["Status mutasi", filter.status && (LABEL_STATUS_BARIS[filter.status] || filter.status)], ["Arah", filter.arah],
      ["Mutasi", Array.isArray(filter.lineIds) ? "sesuai baris yang tampil di layar" : ""], ["Fokus", fokus === "late" ? "Posting Setelah Cutoff" : fokus === "tinjau" ? "Perlu Ditinjau" : ""]);
  }

  return { nama: "Rekonsiliasi Bank", filterLabel: filterLabel || susunLabelFilter(bagianLabel), ...(periodeLabel ? { periodeLabel } : {}), sheets };
}

export default { kunci: "rekonsiliasi", nama: "Rekonsiliasi Bank", izin: [P.FINANCE_READ], ambil };
