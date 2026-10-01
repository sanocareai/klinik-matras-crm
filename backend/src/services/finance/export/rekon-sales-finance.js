// EXPORT EXCEL — REKONSILIASI SALES–FINANCE (kartu "Kenapa angka Finance dan Sales berbeda?"). Sumber data = services/finance/rekonSalesFinance.js: PAYLOAD YANG SAMA dengan kartu,
// drill-down, dan panel Rekonsiliasi di layar (satu fungsi server). Sheet: Ringkasan (kartu + penyebab), Tindak Lanjut, Jembatan (dua tahap), Rincian Order (semua penyebab).
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rekonSalesFinance } from "../rekonSalesFinance.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { labelPeriode } from "./excel.js";

const STATUS_BAYAR = { LUNAS: "Lunas", DP: "DP", BELUM_BAYAR: "Belum bayar" };

async function ambil(db, { periode, filter, filterLabel }) {
  const r = rentangDariQuery({ from: periode.from ?? filter.from, to: periode.to ?? filter.to });
  const d = await rekonSalesFinance(db, { from: r.fromStr, to: r.toStr, denganDetail: true });
  const k = d.kartuSelisih;
  const tanda = (p) => (p.arah === "MENAMBAH" ? "+" : "−");

  const ringkasan = [
    { uraian: "Payment tercatat (aktif, periode ini)", jumlah: k.tercatat.jumlah, n: k.tercatat.nPayment, keterangan: "Termasuk yang menunggu verifikasi; Payment dibatalkan tidak dihitung" },
    { uraian: "  dari itu: menunggu verifikasi", jumlah: k.tercatat.menunggu.jumlah, n: k.tercatat.menunggu.nPayment, keterangan: "Belum dihitung sebagai uang masuk terverifikasi" },
    { uraian: "Uang masuk terverifikasi", jumlah: k.terverifikasi.jumlah, n: k.terverifikasi.nPayment, keterangan: "Basis tanggal pembayaran diterima (WIB)" },
    { uraian: "Klaim Lunas Sales — nilai order yang menjadi Lunas (Total Perusahaan)", jumlah: k.klaimLunas.jumlah, n: k.klaimLunas.nOrder, keterangan: k.klaimLunas.keterangan },
    { uraian: "Selisih (Klaim Lunas − Uang masuk terverifikasi)", jumlah: k.selisih.jumlah, n: "", keterangan: k.selisih.keterangan },
    ...k.penyebab.map((p) => ({ uraian: `  ${tanda(p)} ${p.label}`, jumlah: p.efek, n: p.nOrder, keterangan: p.penjelasan })),
    { uraian: "Residual tahap 1 (harus 0)", jumlah: k.residual.tahap1, n: "", keterangan: "" },
    { uraian: "Nilai Tim Sales", jumlah: k.tim.jumlah, n: "", keterangan: "Total Perusahaan − Tanpa Atribusi Sales + Dihitung Ganda" },
    ...k.tim.penyebab.map((p) => ({ uraian: `  ${tanda(p)} ${p.label}`, jumlah: p.efek, n: p.nOrder, keterangan: p.penjelasan })),
    { uraian: "Residual tahap 2 (harus 0)", jumlah: k.residual.tahap2, n: "", keterangan: "" },
    { uraian: `STATUS: ${k.status.label}`, jumlah: "", n: "", keterangan: k.residual.nol ? "Perhitungan cocok (residual Rp0)" : "Perhitungan TIDAK cocok" },
  ];
  const tindak = k.tindakLanjut.map((t) => ({ tindakan: t.label, order: t.nOrder, nilai: t.jumlah }));
  const jembatan = [d.tahap1, d.tahap2].flatMap((t) => [
    { tahap: `Tahap ${t.nomor}: ${t.judul}`, langkah: "", arah: "", order: "", jumlah: "", keterangan: "" },
    ...t.langkah.map((b) => ({ tahap: "", langkah: b.label, arah: b.tanda === 0 ? "Awal/Hasil" : b.tanda * b.jumlah < 0 ? "Kurangi" : "Tambah", order: b.nOrder || 0, jumlah: b.tanda === 0 ? b.jumlah : Math.abs(b.jumlah), keterangan: b.keterangan })),
    ...(t.komponenLain.daftar.length ? [{ tahap: "", langkah: "Komponen lain (Rp0)", arah: "", order: 0, jumlah: 0, keterangan: t.komponenLain.daftar.join(" · ") }] : []),
    { tahap: "", langkah: t.pembanding.label, arah: "", order: "", jumlah: t.pembanding.jumlah, keterangan: `Residual ${t.residual} — ${t.status.perhitunganLabel}` },
  ]);
  const rincian = Object.entries(d.detail).flatMap(([kunci, arr]) => arr.map((o) => ({
    penyebab: d.bridge.find((b) => b.kunci === kunci)?.label ?? kunci, nomor: o.nomor, pelanggan: o.pelanggan, sales: o.sales || "", nilaiJasa: o.nilaiJasa, ongkir: o.ongkir, totalTagihan: o.totalTagihan,
    tercatat: o.paymentTercatat, terverifikasi: o.paymentTerverifikasi, kurangLebih: o.kurangLebih, tanggalBayar: o.tanggalBayar || "", tanggalLunas: o.tanggalLunas || "",
    statusBayar: STATUS_BAYAR[o.statusBayar] ?? o.statusBayar, jumlah: o.jumlah, tindakan: o.tindakan?.label ?? "", catatan: o.alasan || "",
  })));

  return {
    nama: "Rekonsiliasi Sales-Finance",
    periodeLabel: labelPeriode({ from: r.fromStr, to: r.toStr }),
    filterLabel: filterLabel || "Seluruh order pada periode",
    sheets: [
      {
        nama: "Ringkasan", judul: "Kenapa Angka Finance dan Sales Berbeda?",
        kolom: [{ key: "uraian", header: "Uraian", tipe: "teks", lebar: 62 }, { key: "jumlah", header: "Jumlah (Rp)", tipe: "uang" }, { key: "n", header: "Order/Payment", tipe: "angka" }, { key: "keterangan", header: "Penjelasan", tipe: "teks", lebar: 70 }],
        baris: ringkasan,
        catatan: ["Selisih = Nilai Lunas (Sales) − Uang masuk terverifikasi (Finance). Tanda + menambah dan − mengurangi dari uang masuk menuju nilai Lunas.", "Angka sama dengan kartu & panel Rekonsiliasi di layar (satu fungsi server)."],
      },
      ...(tindak.length ? [{ nama: "Tindak Lanjut", judul: "Transaksi yang Perlu Ditindaklanjuti", kolom: [{ key: "tindakan", header: "Tindakan", tipe: "teks", lebar: 36 }, { key: "order", header: "Jumlah order", tipe: "angka" }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }], baris: tindak }] : []),
      {
        nama: "Jembatan", judul: "Jembatan Dua Tahap",
        kolom: [{ key: "tahap", header: "Tahap", tipe: "teks", lebar: 50 }, { key: "langkah", header: "Langkah", tipe: "teks", lebar: 48 }, { key: "arah", header: "Arah", tipe: "teks" }, { key: "order", header: "Order", tipe: "angka" }, { key: "jumlah", header: "Jumlah (Rp)", tipe: "uang" }, { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 60 }],
        baris: jembatan,
      },
      {
        nama: "Rincian Order", judul: "Rincian Order per Penyebab",
        kolom: [
          { key: "penyebab", header: "Penyebab", tipe: "teks", lebar: 36 }, { key: "nomor", header: "No. Order", tipe: "teks", lebar: 20 }, { key: "pelanggan", header: "Pelanggan", tipe: "teks", lebar: 26 }, { key: "sales", header: "Sales", tipe: "teks" },
          { key: "nilaiJasa", header: "Nilai Jasa (Rp)", tipe: "uang" }, { key: "ongkir", header: "Ongkir (Rp)", tipe: "uang" }, { key: "totalTagihan", header: "Total Tagihan (Rp)", tipe: "uang" },
          { key: "tercatat", header: "Payment Tercatat (Rp)", tipe: "uang" }, { key: "terverifikasi", header: "Payment Terverifikasi (Rp)", tipe: "uang" }, { key: "kurangLebih", header: "Kekurangan(−)/Kelebihan(+) (Rp)", tipe: "uang" },
          { key: "tanggalBayar", header: "Tanggal Pembayaran", tipe: "teks" }, { key: "tanggalLunas", header: "Tanggal Pelunasan", tipe: "teks" }, { key: "statusBayar", header: "Status Bayar", tipe: "teks" },
          { key: "jumlah", header: "Jumlah pada Jembatan (Rp)", tipe: "uang" }, { key: "tindakan", header: "Status Tindakan", tipe: "teks", lebar: 24 }, { key: "catatan", header: "Catatan", tipe: "teks", lebar: 44 },
        ],
        baris: rincian,
      },
    ],
  };
}

export default { kunci: "rekon-sales-finance", nama: "Rekonsiliasi Sales-Finance", izin: [P.FINANCE_READ], ambil };
