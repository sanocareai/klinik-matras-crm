// EXPORT EXCEL — LAPORAN KEUANGAN (Laba Rugi terinci). Sumber data = services/finance/laporanTerinci (read-model SATU snapshot) — PAYLOAD YANG SAMA dengan layar:
// kartu, jembatan pendapatan, PKR, HPP & penanda mutu, beban per divisi, konflik atribusi, gap, dan rincian jurnal. Tidak ada hitungan ulang di sini; total baris tiap sheet
// dihitung dari baris yang sama dan WAJIB sama dengan kartu (kontrol parity dicetak di sheet Ringkasan). Cutoff pembacaan dicetak di kepala sheet.
// Filter (opsional, dari drilldown layar): metrik / akun / divisi / sumber / q menyaring sheet "Rincian Jurnal" saja; sheet lain selalu penuh periode.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { labelPeriode } from "./excel.js";
import { bacaLaporanTerinci } from "../laporanTerinci/index.js";
import { kontribusiMetrik, LABEL_METRIK, METRIK_DRILLDOWN } from "../laporanTerinci/baris.js";
import { PESAN_MARGIN } from "../laporanTerinci/hpp.js";
import { sumMoney, moneyToNumber } from "../money.js";
import { PEMBALIK_BEBAN_BERSIH, PEMBALIK_RETUR_BERSIH, RUMUS_LABA, sifatBeban, sifatBarisBeban } from "../penandaBiaya.js";

const KOLOM_KETERANGAN = { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 70 };
const YA = (b) => (b ? "Ya" : "Tidak");
// Awalan "=" / "+" pada label jembatan dibuang di Excel: sel teks yang diawali karakter itu dinetralkan dengan apostrof (pencegah formula injection). Tanda tetap terbaca dari nominal bertanda.
const bersihLabel = (t) => String(t).replace(/^[=+]\s+/, "");

async function ambil(db, { periode, filter, filterLabel, bolehSensitif }) {
  const r = rentangDariQuery({ from: periode.from ?? filter.from, to: periode.to ?? filter.to });
  const d = await bacaLaporanTerinci(db, { fromStr: r.fromStr, toStr: r.toStr, bolehSensitif, denganBaris: true });
  const c = d.cutoff;
  const cutoffTeks = `Cutoff pembacaan: ${c.diambilPadaWib} WIB (${c.diambilPada}); tanggal buku terakhir: ${c.tanggalBukuTerakhir ?? "-"}${c.periodeMelewatiBuku ? " — periode melewati data buku" : ""}. ${c.isolasi}.`;
  const cutoffLayar = typeof filter.cutoffLayar === "string" && filter.cutoffLayar.length <= 40 ? filter.cutoffLayar : null;
  const catatanUmum = [cutoffTeks, ...(cutoffLayar ? [`Cutoff yang tampil di layar saat diekspor: ${cutoffLayar}.`] : []), "Zona waktu seluruh tanggal: WIB. Angka sama dengan layar Laporan Keuangan pada periode yang sama (rumus Laba Rugi tidak berubah)."];
  const R = d.ringkasan;

  const ringkasan = [
    ...d.kartu.map((k) => ({ uraian: k.label, nilai: k.nilai, jumlahBaris: k.jumlahBaris, status: k.cocok ? "Cocok dengan Σ baris jurnal" : "TIDAK COCOK", keterangan: k.metrik === "laba_kotor" ? `Margin ${R.marginKotor ?? "-"}% — ${d.margin.pesan}` : k.metrik === "laba_bersih" ? `Margin ${R.marginBersih ?? "-"}%` : "" })),
    ...(R.pembalikBebanPokok < 0 ? [{ uraian: `Termasuk ${PEMBALIK_BEBAN_BERSIH.label.toLowerCase()} dalam Beban Pokok (HPP)`, nilai: R.pembalikBebanPokok, jumlahBaris: "", status: PEMBALIK_BEBAN_BERSIH.label, keterangan: `${PEMBALIK_BEBAN_BERSIH.penjelasan} ${RUMUS_LABA}` }] : []),
    ...(R.pembalikBebanOperasional < 0 ? [{ uraian: `Termasuk ${PEMBALIK_BEBAN_BERSIH.label.toLowerCase()} dalam Beban Operasional`, nilai: R.pembalikBebanOperasional, jumlahBaris: "", status: PEMBALIK_BEBAN_BERSIH.label, keterangan: `${PEMBALIK_BEBAN_BERSIH.penjelasan} ${RUMUS_LABA}` }] : []),
    { uraian: "Pendapatan bruto", nilai: R.pendapatanBruto, jumlahBaris: "", status: "", keterangan: "Σ akun pendapatan saldo-normal kredit" },
    { uraian: "Retur & Potongan", nilai: R.retur, jumlahBaris: "", status: "", keterangan: "Akun kontra 4-2100" },
    { uraian: `STATUS MUTU MARGIN: ${PESAN_MARGIN[d.hpp.status]}`, nilai: "", jumlahBaris: "", status: d.hpp.final ? "Final" : d.hpp.status === "TIDAK_BERLAKU" ? "Tidak berlaku" : "Belum final", keterangan: d.hpp.alasan.join(" ") },
    { uraian: `Transaksi belum dibukukan (gap terbuka)`, nilai: d.gap.jumlahTerbuka, jumlahBaris: "", status: "", keterangan: d.catatan.pesan.join(" ") },
    ...d.kontrol.daftar.map((k) => ({ uraian: `Kontrol: ${k.label}`, nilai: k.selisih, jumlahBaris: "", status: k.ok ? "OK" : "TIDAK OK", keterangan: `kiri ${k.kiri} / kanan ${k.kanan}; selisih harus 0` })),
  ];

  const barisLR = [];
  const tambah = (seksi, rows, tanda, sifat) => rows.forEach((a) => barisLR.push({ seksi, kode: a.kode, nama: a.nama, nilai: tanda * a.nilai, sifat: sifat(tanda * a.nilai) }));
  tambah("Pendapatan", d.akunPerMetrik.pendapatan.filter((a) => a.kode !== "4-2100"), 1, () => "Pendapatan");
  tambah("Retur & Potongan", d.akunPerMetrik.pendapatan.filter((a) => a.kode === "4-2100"), -1, (v) => (v < 0 ? PEMBALIK_RETUR_BERSIH.label : "Retur & potongan")); // efek retur negatif → tampil positif seperti layar
  tambah("Beban Pokok", d.akunPerMetrik.hpp, 1, sifatBeban); // biaya NETO bertanda: negatif = pembalik beban bersih
  tambah("Beban Operasional", d.akunPerMetrik.beban_operasional, 1, sifatBeban);

  const jembatan = [
    ...d.jembatan.langkah.map((l) => ({ bagian: l.bagian === "SALES" ? "Sisi Sales" : "Sisi Buku Besar", langkah: l.subtotal ? `Subtotal — ${bersihLabel(l.label)}` : bersihLabel(l.label), order: l.jumlahOrder ?? "", nominal: l.nominal, temuan: l.temuan ? "Perlu diperiksa" : "", keterangan: l.keterangan })),
    { bagian: "Kontrol", langkah: "Residual sisi Sales (harus 0)", order: "", nominal: d.jembatan.residual.sales, temuan: d.jembatan.residual.sales === 0 ? "" : "TIDAK NOL", keterangan: "Omzet (agregat database) − Σ nilai empat kelas Lunas periode" },
    { bagian: "Kontrol", langkah: "Residual pendapatan bruto (harus 0)", order: "", nominal: d.jembatan.residual.bruto, temuan: d.jembatan.residual.bruto === 0 ? "" : "TIDAK NOL", keterangan: "labaRugi().pendapatanBruto − Σ komponen jembatan" },
    { bagian: "Kontrol", langkah: "Residual retur (harus 0)", order: "", nominal: d.jembatan.residual.retur, temuan: d.jembatan.residual.retur === 0 ? "" : "TIDAK NOL", keterangan: "" },
    { bagian: "Kontrol", langkah: "Residual pendapatan bersih (harus 0)", order: "", nominal: d.jembatan.residual.bersih, temuan: d.jembatan.residual.bersih === 0 ? "" : "TIDAK NOL", keterangan: "" },
    ...d.jembatan.memo.catatan.map((t) => ({ bagian: "Catatan", langkah: t, order: "", nominal: "", temuan: "", keterangan: "" })),
  ];
  const NAMA_KELAS = Object.fromEntries(d.jembatan.komponen.map((k) => [k.kunci, k.keterangan]));
  const rincianOrder = d.jembatan.detailOrder.map((o) => ({
    kelas: o.kelas, nomor: o.nomor, kategori: o.kategori, status: o.status, statusBayar: o.statusBayar, pelanggan: o.pelanggan, nilai: o.nilai, notaKredit: o.notaKredit, nilaiKotor: o.nilaiKotor, ongkir: o.ongkir,
    tanggalOrder: o.tanggalOrder, tanggalLunas: o.tanggalLunas ?? "", tanggalSerah: o.tanggalSerah ?? "", tanggalJurnal: o.tanggalJurnal.join(", "), jurnal: o.jurnalPeriode.join(", "), akun: o.akun.join(", "),
    bruto: o.bruto, retur: o.retur, neto: o.neto, tanggalBeda: YA(o.tanggalBeda), alasan: o.alasan || NAMA_KELAS[o.kelas] || "",
  }));

  const pkr = d.pkr.dokumen.map((x) => ({
    nomor: x.nomor, tanggal: x.tanggal, status: x.status, penjual: x.penjual, pembeli: x.pembeli, total: x.total, dibayar: x.dibayar, dibayarPeriode: x.dibayarPeriode, sisa: x.sisa,
    pemenuhan: x.statusPemenuhan, orderCrm: x.orderCrm ? `${x.orderCrm.nomor} (${x.orderCrm.status}, ${x.orderCrm.unit} unit, nilai ${x.orderCrm.nilai})` : "", jurnal: x.jurnalPendapatan.join(", "), item: x.item, catatan: x.catatan, tanggalBatal: x.tanggalBatal ?? "", sisaDitagih: x.sisaDitagih, statusTagih: x.statusTagih,
  }));

  const hppBaris = [
    { kelompok: "TERBUKUKAN (ikut laba)", uraian: "Total beban pokok terbukukan", nilai: d.hpp.terbukukan.total, keterangan: d.hpp.terbukukan.catatan },
    ...d.hpp.terbukukan.akun.map((a) => ({ kelompok: "TERBUKUKAN (ikut laba)", uraian: `${a.kode} ${a.label}`, nilai: a.nilai, keterangan: `${a.nBaris} baris jurnal${a.pembalikBebanBersih ? ` — ${PEMBALIK_BEBAN_BERSIH.label}: mengurangi HPP dan menaikkan laba kotor` : ""}` })),
    { kelompok: "TERBUKUKAN (ikut laba)", uraian: "  di antaranya pembalik periode sebelumnya", nilai: d.hpp.pembalikLintasPeriode.nilai, keterangan: d.hpp.pembalikLintasPeriode.pengaruh },
    { kelompok: "BELUM DAPAT DIBUKTIKAN (bukan Rp0)", uraian: "Unit terkirim tanpa catatan pemakaian bahan", nilai: d.hpp.tidakTerbukti.unitTanpaCatatanPemakaian, keterangan: "Jumlah unit; nominal biaya: tidak dapat dibuktikan (kosong, bukan Rp0)" },
    { kelompok: "BELUM DAPAT DIBUKTIKAN (bukan Rp0)", uraian: "Catatan pemakaian tanpa harga perolehan (periode)", nilai: d.hpp.tidakTerbukti.catatanPemakaianTanpaHarga, keterangan: d.hpp.tidakTerbukti.keterangan },
    { kelompok: "ESTIMASI INFORMATIF (TIDAK masuk laba/jurnal)", uraian: "Estimasi pemakaian periode (harga referensi × qty)", nilai: d.hpp.estimasiInformatif.periode ?? "", keterangan: d.hpp.estimasiInformatif.periode == null ? "Tidak ada catatan pemakaian bahan pada periode ini — tidak ada yang dapat diestimasi." : d.hpp.estimasiInformatif.keterangan },
    ...d.hpp.estimasiInformatif.historisPerBulan.map((b) => ({ kelompok: "ESTIMASI INFORMATIF (TIDAK masuk laba/jurnal)", uraian: `Pembanding historis ${b.bulan}: ${b.unit} unit, ${b.catatan} catatan`, nilai: b.estimasi, keterangan: b.perUnit == null ? "" : `≈ ${b.perUnit} per unit` })),
    { kelompok: "PERSEDIAAN (aset, bukan HPP)", uraian: "Penerimaan bahan bernilai pada periode", nilai: d.hpp.persediaan.penerimaanBahanBernilai, keterangan: d.hpp.persediaan.keterangan },
    { kelompok: "KONSUMSI BAHAN", uraian: "Unit terkirim / dengan pemakaian bernilai", nilai: d.hpp.konsumsiBahan.unitTerkirim, keterangan: `${d.hpp.konsumsiBahan.unitDenganPemakaianBernilai} unit punya pemakaian bernilai; ${d.hpp.konsumsiBahan.catatanPemakaianPeriode} catatan pemakaian pada periode` },
  ];

  const divisiBaris = d.bebanDivisi.divisi.flatMap((v) => v.akun.map((a) => ({ divisi: v.label, kode: a.kode, akun: a.nama, jenis: a.tipe === "BEBAN_POKOK" ? "Beban pokok" : "Beban operasional", dokumen: a.nDokumen, baris: a.nBaris, nilai: a.nilai, sifat: sifatBeban(a.nilai) })));
  const konflik = d.bebanDivisi.konflik.baris.map((k) => ({ jurnal: k.nomorJurnal, tanggal: k.tanggal, sumber: k.sumber, akun: `${k.akunKode} ${k.akunNama}`, dokumen: k.dokumen ?? "", nilai: k.nilai, terpilih: k.divisiTerpilihLabel, kandidat: k.kandidatLabel.join(" / "), tahap: k.tahap, aturan: k.aturan, deskripsi: k.deskripsi }));
  const gap = [
    ...d.gap.daftar.map((g) => ({ daftar: "Gap resmi", no: g.no, order: g.order?.nomor ?? g.sumberId, jenis: g.jenisLabel, kategori: g.order?.kategori ?? "", status: g.order ? `${g.order.status} / ${g.order.statusBayar}` : "", pelanggan: g.order?.pelanggan ?? "", nilai: g.order?.nilai ?? "", tanggalGap: g.tanggalGap, tanggalSerah: g.order?.tanggalSerah ?? "", pembayaran: g.order ? `${g.order.jumlahPembayaran} pembayaran, terverifikasi ${g.order.pembayaranTerverifikasi}` : "", akunSemestinya: g.akunSemestinya ?? "", dampak: `Pendapatan: ${g.dampak.pendapatan} Laba: ${g.dampak.labaRugi} Neraca: ${g.dampak.neraca}`, tindakan: g.tindakan, detailSistem: g.detailSistem })),
    ...d.gap.tanpaGap.map((g, i) => ({ daftar: "Tanpa gap (celah)", no: i + 1, order: g.nomor, jenis: g.jenisLabel, kategori: g.kategori, status: `${g.status} / ${g.statusBayar}`, pelanggan: g.pelanggan, nilai: g.nilai, tanggalGap: "", tanggalSerah: g.tanggalSerah ?? "", pembayaran: "", akunSemestinya: "", dampak: g.dampak, tindakan: g.tindakan, detailSistem: "" })),
  ];

  // Rincian jurnal — disaring bila ada filter drilldown; total = Σ kontribusi baris yang tampil.
  const metrik = METRIK_DRILLDOWN.includes(filter.metrik) ? filter.metrik : null;
  const kata = typeof filter.q === "string" ? filter.q.trim().toLowerCase().slice(0, 80) : "";
  const pilih = d.baris.map((r) => ({ r, k: metrik ? kontribusiMetrik(r, metrik) : r.efek })).filter((x) => x.k !== null)
    .filter(({ r }) => (!filter.akun || r.akunKode === filter.akun) && (!filter.divisi || r.divisi === filter.divisi) && (!filter.sumber || r.sumber === filter.sumber)
      && (!kata || [r.nomorJurnal, r.dokumen?.nomor, r.orderNomor, r.deskripsi, r.akunNama].some((t) => String(t ?? "").toLowerCase().includes(kata))));
  const rincian = pilih.map(({ r, k }) => ({
    nomorJurnal: r.nomorJurnal, tanggal: r.tanggal, sumber: r.sumber, status: r.status, akun: `${r.akunKode} ${r.akunNama}`, debit: r.debit, kredit: r.credit, kontribusi: k,
    dokumen: r.dokumen?.nomor ?? "", order: r.orderNomor ?? "", membalik: r.membalik?.nomor ?? "", sifat: r.akunTipe === "BEBAN" || r.akunTipe === "BEBAN_POKOK" ? sifatBarisBeban(r.nilai) : "", divisi: r.divisiLabel, tahapBukti: r.tahap, konflik: r.konflik.length ? "Bukti bertentangan" : "", deskripsi: r.deskripsi,
  }));
  const totalRincian = moneyToNumber(sumMoney(pilih.map((x) => x.k)));
  const labelFilter = [metrik ? `Metrik: ${LABEL_METRIK[metrik]}` : null, filter.akun ? `Akun: ${filter.akun}` : null, filter.divisi ? `Divisi: ${filter.divisi}` : null, filter.sumber ? `Sumber: ${filter.sumber}` : null, kata ? `Cari: ${kata}` : null].filter(Boolean).join("; ");

  return {
    nama: "Laporan Keuangan",
    periodeLabel: labelPeriode({ from: r.fromStr, to: r.toStr }),
    filterLabel: [filterLabel, labelFilter].filter(Boolean).join(" | ") || "Seluruh jurnal Laba Rugi pada periode",
    sheets: [
      { nama: "Ringkasan", judul: "Ringkasan Laporan Keuangan", kolom: [{ key: "uraian", header: "Uraian", tipe: "teks", lebar: 60 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "jumlahBaris", header: "Baris jurnal", tipe: "angka" }, { key: "status", header: "Status", tipe: "teks", lebar: 28 }, KOLOM_KETERANGAN], baris: ringkasan, catatan: catatanUmum },
      { nama: "Laba Rugi", judul: "Laba Rugi per Akun", kolom: [{ key: "seksi", header: "Seksi", tipe: "teks", lebar: 22 }, { key: "kode", header: "Kode", tipe: "teks", lebar: 10 }, { key: "nama", header: "Akun", tipe: "teks", lebar: 44 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "sifat", header: "Sifat", tipe: "teks", lebar: 30 }], baris: barisLR, catatan: [`Pendapatan Bersih ${R.pendapatanBersih}; Laba Kotor ${R.labaKotor}; Beban Operasional ${R.bebanOperasional}; Laba Bersih ${R.labaBersih} — sama dengan kartu layar.`, `Akun biaya ditampilkan sebagai biaya NETO bertanda (debit − kredit). Nilai negatif = ${PEMBALIK_BEBAN_BERSIH.label.toLowerCase()}: ${PEMBALIK_BEBAN_BERSIH.penjelasan}`, RUMUS_LABA, ...catatanUmum] },
      { nama: "Jembatan Pendapatan", judul: "Jembatan Omzet Sales (Lunas) → Pendapatan Bersih Finance", kolom: [{ key: "bagian", header: "Bagian", tipe: "teks", lebar: 18 }, { key: "langkah", header: "Langkah", tipe: "teks", lebar: 66 }, { key: "order", header: "Order/Jurnal", tipe: "angka" }, { key: "nominal", header: "Nominal (Rp)", tipe: "uang" }, { key: "temuan", header: "Penanda", tipe: "teks", lebar: 18 }, KOLOM_KETERANGAN], baris: jembatan, catatan: catatanUmum },
      { nama: "Rincian Order Jembatan", judul: "Order per Komponen Jembatan", kolom: [
        { key: "kelas", header: "Komponen", tipe: "teks", lebar: 34 }, { key: "nomor", header: "No. Order", tipe: "teks", lebar: 20 }, { key: "kategori", header: "Kategori", tipe: "teks" }, { key: "status", header: "Status", tipe: "teks" }, { key: "statusBayar", header: "Status bayar", tipe: "teks" },
        { key: "pelanggan", header: "Pelanggan", tipe: "teks", lebar: 24 }, { key: "nilai", header: "Nilai Bersih Order (Rp)", tipe: "uang" }, { key: "notaKredit", header: "Nota Kredit aktif (Rp)", tipe: "uang" }, { key: "nilaiKotor", header: "Nilai Kotor Order (Rp)", tipe: "uang" }, { key: "ongkir", header: "Ongkir (Rp)", tipe: "uang" },
        { key: "tanggalOrder", header: "Tgl order", tipe: "teks" }, { key: "tanggalLunas", header: "Tgl lunas", tipe: "teks" }, { key: "tanggalSerah", header: "Tgl serah", tipe: "teks" }, { key: "tanggalJurnal", header: "Tgl jurnal", tipe: "teks", lebar: 22 },
        { key: "jurnal", header: "No. jurnal", tipe: "teks", lebar: 26 }, { key: "akun", header: "Akun", tipe: "teks" }, { key: "bruto", header: "Bruto (Rp)", tipe: "uang" }, { key: "retur", header: "Retur (Rp)", tipe: "uang" }, { key: "neto", header: "Neto (Rp)", tipe: "uang" },
        { key: "tanggalBeda", header: "Tgl jurnal ≠ tgl serah", tipe: "teks" }, { key: "alasan", header: "Alasan/keterangan", tipe: "teks", lebar: 60 },
      ], baris: rincianOrder, total: { label: "Total neto (Σ semua komponen order)", nilai: { neto: moneyToNumber(sumMoney(rincianOrder.map((o) => o.neto))), bruto: moneyToNumber(sumMoney(rincianOrder.map((o) => o.bruto))) } } },
      { nama: "PKR", judul: "Penjualan Karyawan (terpisah dari order Sales)", kolom: [
        { key: "nomor", header: "No. PKR", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal", tipe: "teks" }, { key: "status", header: "Status", tipe: "teks" }, { key: "penjual", header: "Penjual", tipe: "teks", lebar: 22 }, { key: "pembeli", header: "Pembeli", tipe: "teks", lebar: 22 },
        { key: "total", header: "Total (Rp)", tipe: "uang" }, { key: "dibayar", header: "Dibayar (Rp)", tipe: "uang" }, { key: "dibayarPeriode", header: "Dibayar periode (Rp)", tipe: "uang" }, { key: "sisa", header: "Sisa (Rp)", tipe: "uang" },
        { key: "pemenuhan", header: "Status pemenuhan", tipe: "teks", lebar: 20 }, { key: "orderCrm", header: "Order CRM", tipe: "teks", lebar: 40 }, { key: "jurnal", header: "Jurnal pendapatan", tipe: "teks", lebar: 20 }, { key: "item", header: "Item", tipe: "teks", lebar: 44 }, KOLOM_KETERANGAN,
        { key: "tanggalBatal", header: "Tanggal batal", tipe: "teks" }, { key: "sisaDitagih", header: "Sisa ditagih (Rp)", tipe: "uang" }, { key: "statusTagih", header: "Status tagih", tipe: "teks", lebar: 28 }, // kolom BARU di ujung kanan (kolom lama tidak bergeser; "Sisa (Rp)" tetap NILAI HISTORIS)
      ], baris: pkr, catatan: [d.pkr.kebijakan, `Pendapatan PKR di buku besar (neto pembalik) ${d.pkr.ringkasan.pendapatanLedger}; Σ dokumen dibuat pada periode ${d.pkr.ringkasan.dibukukanDokumen} − Σ dokumen dibatalkan pada periode ${d.pkr.ringkasan.dibalikDokumen} = ${d.pkr.ringkasan.penjualanDokumenBuku}; selisih ${d.pkr.ringkasan.selisih}. Dokumen aktif periode ${d.pkr.ringkasan.penjualanDokumen}.`] },
      { nama: "HPP", judul: "HPP, Biaya Tak Terbukti & Estimasi (dipisah)", kolom: [{ key: "kelompok", header: "Kelompok", tipe: "teks", lebar: 42 }, { key: "uraian", header: "Uraian", tipe: "teks", lebar: 60 }, { key: "nilai", header: "Nilai", tipe: "uang" }, KOLOM_KETERANGAN], baris: hppBaris, catatan: [`STATUS MARGIN: ${PESAN_MARGIN[d.hpp.status]}`, ...d.hpp.alasan, "Estimasi informatif dan biaya tak terbukti TIDAK masuk laba maupun jurnal.", ...catatanUmum] },
      { nama: "Beban per Divisi", judul: "Beban per Divisi → Akun", kolom: [{ key: "divisi", header: "Divisi", tipe: "teks", lebar: 24 }, { key: "kode", header: "Kode", tipe: "teks", lebar: 10 }, { key: "akun", header: "Akun", tipe: "teks", lebar: 40 }, { key: "jenis", header: "Jenis", tipe: "teks", lebar: 20 }, { key: "dokumen", header: "Dokumen", tipe: "angka" }, { key: "baris", header: "Baris jurnal", tipe: "angka" }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "sifat", header: "Sifat", tipe: "teks", lebar: 26 }], baris: divisiBaris, total: { label: "Total beban (= beban pokok + beban operasional ledger)", nilai: { nilai: d.bebanDivisi.totalDivisi } }, catatan: [`Belum teratribusi: ${d.bebanDivisi.belumTeratribusi.nominal} pada ${d.bebanDivisi.belumTeratribusi.jumlahBaris} baris.`, `Nilai negatif = ${PEMBALIK_BEBAN_BERSIH.label.toLowerCase()} (mengurangi biaya dan menaikkan laba).`] },
      { nama: "Konflik Atribusi", judul: "Baris dengan Bukti Divisi Bertentangan", kolom: [{ key: "jurnal", header: "Jurnal", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal", tipe: "teks" }, { key: "sumber", header: "Sumber", tipe: "teks", lebar: 18 }, { key: "akun", header: "Akun", tipe: "teks", lebar: 34 }, { key: "dokumen", header: "Dokumen", tipe: "teks", lebar: 20 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "terpilih", header: "Divisi terpilih", tipe: "teks", lebar: 20 }, { key: "kandidat", header: "Kandidat bertentangan", tipe: "teks", lebar: 30 }, { key: "tahap", header: "Tahap bukti", tipe: "teks" }, { key: "aturan", header: "Aturan", tipe: "teks", lebar: 44 }, { key: "deskripsi", header: "Deskripsi", tipe: "teks", lebar: 56 }], baris: konflik, total: { label: `Total ${d.bebanDivisi.konflik.jumlahBaris} baris konflik`, nilai: { nilai: d.bebanDivisi.konflik.nominal } }, catatan: [d.bebanDivisi.konflik.penjelasan] },
      { nama: "Gap Pembukuan", judul: "Daftar Pemeriksaan Gap Pembukuan", kolom: [
        { key: "daftar", header: "Daftar", tipe: "teks", lebar: 18 }, { key: "no", header: "No", tipe: "angka" }, { key: "order", header: "Order", tipe: "teks", lebar: 20 }, { key: "jenis", header: "Jenis", tipe: "teks", lebar: 40 }, { key: "kategori", header: "Kategori", tipe: "teks" }, { key: "status", header: "Status", tipe: "teks", lebar: 22 },
        { key: "pelanggan", header: "Pelanggan", tipe: "teks", lebar: 24 }, { key: "nilai", header: "Nilai order (Rp)", tipe: "uang" }, { key: "tanggalGap", header: "Gap tercatat", tipe: "teks" }, { key: "tanggalSerah", header: "Tgl serah", tipe: "teks" }, { key: "pembayaran", header: "Pembayaran", tipe: "teks", lebar: 30 },
        { key: "akunSemestinya", header: "Akun semestinya", tipe: "teks", lebar: 28 }, { key: "dampak", header: "Dampak", tipe: "teks", lebar: 60 }, { key: "tindakan", header: "Tindakan", tipe: "teks", lebar: 60 }, { key: "detailSistem", header: "Detail sistem", tipe: "teks", lebar: 50 },
      ], baris: gap, catatan: [d.gap.catatan, `Gap resmi terbuka: ${d.gap.jumlahTerbuka} (sama dengan banner layar).`] },
      { nama: "Rincian Jurnal", judul: "Rincian Baris Jurnal Laba Rugi", kolom: [
        { key: "nomorJurnal", header: "No. jurnal", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal buku", tipe: "teks" }, { key: "sumber", header: "Sumber", tipe: "teks", lebar: 22 }, { key: "status", header: "Status", tipe: "teks" }, { key: "akun", header: "Akun", tipe: "teks", lebar: 38 },
        { key: "debit", header: "Debit (Rp)", tipe: "uang" }, { key: "kredit", header: "Kredit (Rp)", tipe: "uang" }, { key: "kontribusi", header: metrik ? `Kontribusi ke ${LABEL_METRIK[metrik]} (Rp)` : "Efek ke Laba Bersih (Rp)", tipe: "uang" },
        { key: "dokumen", header: "Dokumen", tipe: "teks", lebar: 20 }, { key: "order", header: "Order", tipe: "teks", lebar: 20 }, { key: "membalik", header: "Membalik", tipe: "teks", lebar: 20 }, { key: "divisi", header: "Divisi", tipe: "teks", lebar: 22 },
        { key: "tahapBukti", header: "Tahap bukti", tipe: "teks" }, { key: "konflik", header: "Konflik", tipe: "teks", lebar: 18 }, { key: "deskripsi", header: "Deskripsi", tipe: "teks", lebar: 70 },
        { key: "sifat", header: "Sifat baris", tipe: "teks", lebar: 26 }, // kolom BARU selalu di ujung kanan: posisi kolom lama tidak bergeser bagi pembaca otomatis
      ], baris: rincian, total: { label: metrik ? `Total ${LABEL_METRIK[metrik]}` : "Total efek ke Laba Bersih", nilai: { kontribusi: totalRincian } }, catatan: [labelFilter ? `Disaring: ${labelFilter}` : "Seluruh baris jurnal Laba Rugi periode ini.", "Total = Σ kolom Kontribusi; tanpa filter metrik/akun sama dengan Laba Bersih pada kartu."] },
    ],
  };
}

export default { kunci: "laporan-keuangan", nama: "Laporan Keuangan", izin: [P.FINANCE_READ], ambil };
