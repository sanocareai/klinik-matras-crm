// PDF PURCHASE ORDER / PESANAN PEMBELIAN — memakai sistem dokumen SANSS yang SAMA dengan PDF Invoice Sales (services/documentPdf.js):
// logo, header atas (judul + pil nomor + tanggal), kartu lembut berikon, bar biru tabel, format Rupiah, kartu "Butuh Bantuan" sebagai footer,
// penanda "— lanjutan" pada halaman berikutnya, margin dan aturan pindah halaman. Yang berbeda hanya ISI: supplier, daftar material, termin, penerimaan barang, status/revisi PO.
//
// Seperti invoicePdf.js, file ini CUMA TATA LETAK: seluruh angka & teks datang dari view (services/finance/purchaseOrderDocument.js). Tidak ada hitungan uang di sini
// (nilai baris = `nilaiDipesan` dari bentukPO, total = `totalDipesan`), jadi PDF tidak mungkin berbeda dari layar PO.
// TIDAK memuat elemen invoice yang tidak relevan: DP pelanggan, garansi, status pembayaran pelanggan, rekening penerimaan, atau informasi Sales.
import {
  bukaDokumenPdf, gambarLatarHalaman, buatPindahHalaman, gambarHeaderDokumen, gambarHeaderTabel, gambarFooterBantuan, gambarKartuJudul,
  badgeIkon, FONT_TEKS, FONT_TEKS_MED, FONT_JUDUL, IKON, BIRU, BIRU_GELAP, TEAL, TEAL_GELAP, KARTU_BG, ABU, GARIS, GELAP,
  formatRupiah, formatTanggal, tulisAlamatDibatasi,
} from "./documentPdf.js";

const MERAH = "#dc2626";
const HIJAU = "#16a34a";

export const LABEL_STATUS_PO_PDF = {
  DRAFT: "Draf — belum disetujui", DISETUJUI: "Disetujui", DITERIMA_SEBAGIAN: "Diterima sebagian", SELESAI: "Selesai", DIBATALKAN: "Dibatalkan",
};
const WARNA_STATUS = { DRAFT: ABU, DISETUJUI: HIJAU, DITERIMA_SEBAGIAN: BIRU, SELESAI: HIJAU, DIBATALKAN: MERAH };

const SYARAT_PO = [
  "Cantumkan nomor PO pada surat jalan dan faktur.",
  "Hanya barang berkondisi baik yang diterima dan ditagihkan.",
  "Faktur dicocokkan dengan PO; bayar sesuai termin.",
];

const fmtQty = (n) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });

/**
 * @param {Awaited<ReturnType<import("./finance/purchaseOrderDocument.js").bangunViewPO>>} view
 * @returns {Promise<Buffer>}
 */
export function renderPurchaseOrderPdf(view) {
  return new Promise((resolve, reject) => {
    const { po, supplier, termin, perusahaan, revisi } = view;
    const { doc, selesai, g } = bukaDokumenPdf();
    selesai.then(resolve, reject);
    const { pageHeight, MARGIN, KONTEN_LEBAR, BATAS_BAWAH_HALAMAN, kartuW, kartuKiriX, kartuKananX, padKartu } = g;

    gambarLatarHalaman(doc, g);
    const mulaiHalamanBaru = buatPindahHalaman(doc, g, po.poNumber);

    // ── Header (komponen bersama) ────────────────────────────────────────
    const statusTeks = LABEL_STATUS_PO_PDF[po.status] || po.status;
    let y = gambarHeaderDokumen(doc, g, {
      judul: "PURCHASE ORDER", ukuranJudul: 27, subjudul: "Pesanan Pembelian", labelNomor: "PO No.", nomor: po.poNumber, tanggal: po.orderDate,
      barisTambahan: `Status: ${statusTeks}${revisi.jumlah > 0 ? ` · Revisi ke-${revisi.jumlah}` : ""}`,
    });

    // ── Dua kartu: Dipesan Dari (supplier) / Termin Pembayaran ───────────
    const namaSupplier = supplier.nama || "-";
    const alamatSupplier = supplier.alamat || "";
    doc.fontSize(9).font(FONT_TEKS);
    const tinggiAlamat = alamatSupplier ? Math.min(doc.heightOfString(alamatSupplier, { width: kartuW - 30 }), doc.currentLineHeight() * 3) : 0;
    const kontak = [supplier.telepon, supplier.email].filter(Boolean).join("  ·  ");
    doc.fontSize(11.5).font(FONT_JUDUL);
    const tinggiNama = doc.heightOfString(namaSupplier, { width: kartuW - padKartu * 2 });
    const kartuKiriTinggi = 46 + tinggiNama + 3 + (tinggiAlamat ? tinggiAlamat + 3 : 0) + (kontak ? 14 : 0) + 14;
    const kartuKananTinggi = 104;
    const kartuTinggi = Math.max(kartuKiriTinggi, kartuKananTinggi);

    const kiri = gambarKartuJudul(doc, g, { x: kartuKiriX, y, w: kartuW, tinggi: kartuTinggi, ikon: IKON.user, judul: "DIPESAN DARI" });
    let yk = kiri.yIsi;
    doc.fontSize(11.5).font(FONT_JUDUL).fillColor(GELAP).text(namaSupplier, kiri.x, yk, { width: kiri.lebarIsi });
    yk += doc.heightOfString(namaSupplier, { width: kiri.lebarIsi }) + 3;
    // Kode supplier di baris judul kartu (rata kanan) — hemat satu baris isi.
    doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU).text(supplier.kode, kiri.x, y + padKartu + 8, { width: kiri.lebarIsi, align: "right" });
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU);
    if (alamatSupplier) yk += tulisAlamatDibatasi(doc, alamatSupplier, kiri.x, yk, { width: kiri.lebarIsi, maxBaris: 3 }) + 3;
    if (kontak) doc.fontSize(9).font(FONT_TEKS).fillColor(ABU).text(kontak, kiri.x, yk, { width: kiri.lebarIsi });

    const kanan = gambarKartuJudul(doc, g, { x: kartuKananX, y, w: kartuW, tinggi: kartuTinggi, ikon: IKON.wallet, judul: "TERMIN PEMBAYARAN" });
    let yr0 = kanan.yIsi;
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU).text("Termin supplier", kanan.x, yr0);
    yr0 += 14;
    doc.fontSize(11.5).font(FONT_JUDUL).fillColor(GELAP).text(termin.label || "Belum ditetapkan", kanan.x, yr0, { width: kanan.lebarIsi });
    yr0 += 17;
    doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU)
      .text(termin.label ? "Jatuh tempo dihitung dari tanggal faktur supplier." : "Jatuh tempo mengikuti tanggal yang tertera pada faktur.", kanan.x, yr0, { width: kanan.lebarIsi });
    if (termin.sumber) {
      yr0 += doc.heightOfString("Jatuh tempo dihitung dari tanggal faktur supplier.", { width: kanan.lebarIsi }) + 3;
      doc.fontSize(8).font(FONT_TEKS).fillColor(ABU).text(termin.sumber, kanan.x, yr0, { width: kanan.lebarIsi });
    }
    y += kartuTinggi + 14;

    // ── Penerimaan barang (alamat tujuan) — kartu selebar halaman ────────
    const alamatTujuan = perusahaan.alamatPenerimaan;
    doc.fontSize(9).font(FONT_TEKS);
    const tinggiTujuan = Math.min(doc.heightOfString(alamatTujuan, { width: KONTEN_LEBAR * 0.55 - 20 }), doc.currentLineHeight() * 2);
    const penerimaanTinggi = Math.max(58, 39 + tinggiTujuan + 10);
    doc.roundedRect(MARGIN, y, KONTEN_LEBAR, penerimaanTinggi, 14).fill(KARTU_BG);
    badgeIkon(doc, MARGIN + padKartu + 12, y + penerimaanTinggi / 2, 12, { bg: TEAL, ikon: IKON.lokasi });
    doc.fontSize(9).font(FONT_JUDUL).fillColor(TEAL_GELAP).text("ALAMAT PENERIMAAN BARANG", MARGIN + padKartu + 32, y + 12, { width: 240 });
    doc.fontSize(10).font(FONT_JUDUL).fillColor(GELAP).text(perusahaan.namaPenerima, MARGIN + padKartu + 32, y + 25, { width: KONTEN_LEBAR * 0.55 - 20 });
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU);
    tulisAlamatDibatasi(doc, alamatTujuan, MARGIN + padKartu + 32, y + 39, { width: KONTEN_LEBAR * 0.55 - 20, maxBaris: 2 });
    const xEst = MARGIN + KONTEN_LEBAR * 0.62;
    doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU).text("Estimasi kedatangan", xEst, y + 14, { width: KONTEN_LEBAR * 0.38 - padKartu });
    doc.fontSize(10).font(FONT_JUDUL).fillColor(GELAP).text(po.expectedDate ? formatTanggal(po.expectedDate) : "Sesuai kesepakatan", xEst, y + 27, { width: KONTEN_LEBAR * 0.38 - padKartu });
    doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU).text(`Kontak penerimaan ${perusahaan.whatsapp}`, xEst, y + 42, { width: KONTEN_LEBAR * 0.38 - padKartu });
    y += penerimaanTinggi + 14;

    // ── Tabel material ───────────────────────────────────────────────────
    const TABEL_PAD = 14;
    const kolNoX = MARGIN + TABEL_PAD;
    const kolNoW = 30;
    const kolDeskX = kolNoX + kolNoW + 34;
    const kolQtyW = 72;
    const kolHargaW = 88;
    const kolTotalW = 92;
    const kolTotalX = MARGIN + KONTEN_LEBAR - TABEL_PAD - kolTotalW;
    const kolHargaX = kolTotalX - kolHargaW - 12;
    const kolQtyX = kolHargaX - kolQtyW - 10;
    const kolDeskW = kolQtyX - kolDeskX - 12;
    const barTabel = (yMulai) => gambarHeaderTabel(doc, g, yMulai, [
      { label: "NO.", x: kolNoX, w: kolNoW, align: "center" },
      { label: "MATERIAL", x: kolDeskX, w: kolDeskW },
      { label: "QTY", x: kolQtyX, w: kolQtyW, align: "center" },
      { label: "HARGA SATUAN", x: kolHargaX, w: kolHargaW, align: "right" },
      { label: "TOTAL", x: kolTotalX, w: kolTotalW, align: "right" },
    ]);
    // Bar tabel (30) + minimal satu baris harus muat di halaman ini; kalau tidak, mulai di halaman baru (tidak ada bar yatim di dasar halaman).
    if (y + 30 + 8 + 40 > pageHeight - BATAS_BAWAH_HALAMAN) y = mulaiHalamanBaru();
    y = barTabel(y);

    const TINGGI_BARIS_MIN = 34;
    po.lines.forEach((l, i) => {
      doc.fontSize(10).font(FONT_TEKS_MED);
      const judulBaris = `${l.nama}`;
      const tinggiNama = doc.heightOfString(judulBaris, { width: kolDeskW });
      doc.fontSize(8).font(FONT_TEKS);
      const subBaris = [l.kode, l.catatan].filter(Boolean).join(" · ");
      const tinggiSub = subBaris ? doc.heightOfString(subBaris, { width: kolDeskW }) + 3 : 0;
      const tinggiBaris = Math.max(TINGGI_BARIS_MIN, tinggiNama + tinggiSub + 16);
      if (y + tinggiBaris > pageHeight - BATAS_BAWAH_HALAMAN) {
        y = mulaiHalamanBaru();
        y = barTabel(y);
      }
      badgeIkon(doc, kolNoX + kolNoW - 10 + 22, y + tinggiBaris / 2, 13, { bg: KARTU_BG, ikon: IKON.layerGroup, warnaIkon: TEAL_GELAP, ukuranIkon: 11 });
      doc.fontSize(9.5).font(FONT_TEKS).fillColor(GELAP).text(String(i + 1), kolNoX, y + 6, { width: kolNoW, align: "center" });
      doc.fontSize(10).font(FONT_TEKS_MED).fillColor(GELAP).text(judulBaris, kolDeskX, y + 6, { width: kolDeskW });
      if (subBaris) doc.fontSize(8).font(FONT_TEKS).fillColor(ABU).text(subBaris, kolDeskX, y + 6 + tinggiNama + 2, { width: kolDeskW });
      doc.fontSize(9.5).font(FONT_TEKS_MED).fillColor(GELAP).text(fmtQty(l.dipesan), kolQtyX, y + 6, { width: kolQtyW, align: "center" });
      doc.fontSize(8).font(FONT_TEKS).fillColor(ABU).text(l.satuan, kolQtyX, y + 19, { width: kolQtyW, align: "center" });
      doc.fontSize(9.5).font(FONT_TEKS_MED).fillColor(GELAP).text(formatRupiah(l.hargaSatuan), kolHargaX, y + 6, { width: kolHargaW, align: "right" });
      doc.text(formatRupiah(l.nilaiDipesan), kolTotalX, y + 6, { width: kolTotalW, align: "right" });
      y += tinggiBaris;
      if (i < po.lines.length - 1) {
        doc.moveTo(MARGIN, y).lineTo(MARGIN + KONTEN_LEBAR, y).strokeColor(GARIS).stroke();
        y += 1;
      }
    });
    y += 14;

    // ── Kiri: Catatan & Ketentuan · Kanan: total + persetujuan ───────────
    const bawahKananX = kartuKananX;
    const bawahKananW = kartuW;
    const teksCatatan = [po.notes ? `Catatan: ${po.notes}` : null, ...SYARAT_PO.map((t, i) => `${i + 1}. ${t}`)].filter(Boolean).join("\n");
    doc.fontSize(8.5).font(FONT_TEKS);
    const tinggiCatatan = doc.heightOfString(teksCatatan, { width: kartuW - padKartu * 2 });
    const catatanTinggi = 58 + tinggiCatatan;
    const estimasiKanan = 18 + 22 + 12 + 70 + (po.status === "DIBATALKAN" ? 40 : 0);
    if (y + Math.max(catatanTinggi, estimasiKanan) > pageHeight - BATAS_BAWAH_HALAMAN) y = mulaiHalamanBaru();

    doc.roundedRect(kartuKiriX, y, kartuW, catatanTinggi, 14).fill(KARTU_BG);
    badgeIkon(doc, kartuKiriX + padKartu + 12, y + padKartu + 12, 12, { bg: BIRU_GELAP, ikon: IKON.dokumen });
    doc.fontSize(11).font(FONT_JUDUL).fillColor(GELAP).text("CATATAN & KETENTUAN", kartuKiriX + padKartu + 32, y + padKartu + 8, { width: kartuW - padKartu * 2 - 32 });
    doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU).text(teksCatatan, kartuKiriX + padKartu, y + padKartu + 32, { width: kartuW - padKartu * 2 });

    let yr = y + 6;
    const barisTotal = (label, value, { bold = false, warna = GELAP } = {}) => {
      doc.fontSize(bold ? 13 : 9.5).font(bold ? FONT_JUDUL : FONT_TEKS).fillColor(bold ? warna : ABU).text(label, bawahKananX, yr, { width: bawahKananW * 0.5 });
      doc.font(bold ? FONT_JUDUL : FONT_TEKS).fillColor(warna).text(value, bawahKananX, yr, { width: bawahKananW, align: "right" });
      yr += bold ? 22 : 18;
    };
    doc.moveTo(bawahKananX, yr + 3).lineTo(bawahKananX + bawahKananW, yr + 3).dash(2, { space: 2 }).strokeColor(GARIS).stroke();
    doc.undash();
    yr += 12;
    barisTotal("TOTAL PESANAN", formatRupiah(po.totalDipesan), { bold: true, warna: BIRU });

    // Status & persetujuan — sesuai kontrak PO (draf / disetujui / dibatalkan), bukan status pembayaran pelanggan.
    yr += 6;
    const warnaStatus = WARNA_STATUS[po.status] || ABU;
    doc.fontSize(9.5).font(FONT_JUDUL).fillColor(warnaStatus).text(`STATUS: ${statusTeks.toUpperCase()}`, bawahKananX, yr, { width: bawahKananW, align: "right" });
    yr += 15;
    if (po.status === "DRAFT") {
      doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU).text("Dokumen ini masih draf dan belum mengikat.", bawahKananX, yr, { width: bawahKananW, align: "right" });
      yr += 14;
    } else if (po.status === "DIBATALKAN") {
      const alasan = `Dibatalkan${po.cancelledAt ? ` ${formatTanggal(po.cancelledAt)}` : ""}${po.cancelReason ? ` — ${po.cancelReason}` : ""}`;
      doc.fontSize(8.5).font(FONT_TEKS).fillColor(MERAH).text(alasan, bawahKananX, yr, { width: bawahKananW, align: "right" });
      yr += doc.heightOfString(alasan, { width: bawahKananW }) + 6;
    } else if (po.approvedBy) {
      doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU)
        .text(`Disetujui oleh ${po.approvedBy.name}${po.approvedAt ? ` · ${formatTanggal(po.approvedAt)}` : ""}`, bawahKananX, yr, { width: bawahKananW, align: "right" });
      yr += 14;
    }
    if (revisi.jumlah > 0) {
      doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU)
        .text(`Revisi ke-${revisi.jumlah}${revisi.terakhir ? ` · ${formatTanggal(revisi.terakhir)}` : ""} `, bawahKananX, yr, { width: bawahKananW, align: "right" });
      yr += 14;
    }
    yr += 10;
    doc.fontSize(9.5).font(FONT_JUDUL).fillColor(TEAL_GELAP).text("Ahlinya Kasur Sehat", bawahKananX, yr, { width: bawahKananW, align: "right" });
    yr += 16;

    y += Math.max(catatanTinggi, yr - y) + 8; // footer tertambat ke dasar halaman: jarak minimal ke konten cukup 8pt
    if (process.env.PO_DEBUG) console.error("y konten", Math.round(y), "batas", Math.round(pageHeight - BATAS_BAWAH_HALAMAN - 90));
    gambarFooterBantuan(doc, g, { y, mulaiHalamanBaru });
    doc.end();
  });
}
