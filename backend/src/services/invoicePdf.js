// ─── PDF INVOICE — server-side (31 Agustus 2026, redesain 2 September 2026) ──
// Pakai `pdfkit` (layout PDF murni JS), BUKAN Puppeteer/Playwright — VPS ini
// kecil (Sumopod, target biaya <Rp300rb/bulan, lihat CLAUDE.md §2) dan
// headless Chromium butuh ratusan MB disk + RAM per render. pdfkit generate
// langsung di proses Node yang sudah jalan, tanpa browser tambahan sama
// sekali — cocok untuk dokumen terstruktur seperti invoice (bukan render
// halaman web kompleks yang memang butuh browser).
//
// SATU aturan penting: file ini CUMA TATA LETAK. Semua ANGKA & TEKS transaksi
// datang dari `buildInvoiceView()` (services/invoice.js) — tidak ada hitungan
// uang di sini sama sekali. Kalau invoice PDF dan invoice di layar pernah
// beda angka, itu artinya ada yang menghitung ulang di salah satu tempat —
// jangan biarkan itu terjadi.
//
// Desain (2 Sep 2026): mengikuti template resmi yang dikirim owner (header
// biru dengan logo Klinik Matras, tabel item bergaris, metode pembayaran,
// terms & conditions, wave dekoratif) — BUKAN desain bebas Claude.

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "../../assets/logo.png");

// Warna brand — diambil dari logo asli (biru "S" + silang teal).
const BIRU = "#2367C2";
const BIRU_GELAP = "#124A99";
const TEAL = "#5FC9BB";
const TEAL_MUDA = "#E9F8F5";
const ABU = "#6b7280";
const GARIS = "#e5e7eb";
const GELAP = "#1f2937";

// Info perusahaan — TIDAK berubah per invoice, sama untuk semua transaksi.
// Sesuai template resmi yang dikirim owner; kalau alamat/rekening berubah,
// cukup ubah di SATU tempat ini.
const PERUSAHAAN = {
  nama: "KLINIK MATRAS",
  tagline: "by SANOCARE",
  telp: "0851 8728 3900",
  website: "www.sanomatrassehat.com",
  whatsapp: "0851 8728 3900",
  alamat: "Jl. Raya Keadilan, Gg Asrama Polri, No. 81, RT 5/12, Pancoran Mas, Kota Depok",
  bank: {
    nama: "Mandiri",
    noRekening: "1230013546272",
    namaRekening: "PT Sano Kreasi Utama",
  },
  syaratKetentuan: [
    "Harga sudah termasuk biaya antar-jemput (Free Delivery).",
    "Tidak ada pembayaran di muka (No DP required).",
    "Pembayaran lunas dilakukan saat serah terima barang di lokasi pelanggan (COD/Transfer saat barang sampai).",
    "Harap periksa kondisi barang sebelum melakukan pembayaran.",
  ],
};

const MIN_BARIS_TABEL = 6; // baris kosong ditambahkan sampai jumlah ini — pola dari template asli

// Backend TIDAK punya formatter Rupiah/tanggal bersama (frontend punya versi
// sendiri, tapi tidak bisa di-import lintas paket) — dua fungsi kecil ini
// pola yang SAMA dengan formatRpWa()/formatTanggalOrder() lokal di
// routes/orders.js (ringkasan WA order), bukan util baru yang tersebar.
function formatRupiah(n) {
  return `Rp${Math.round(n || 0).toLocaleString("id-ID")}`;
}
function formatTanggal(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase();
}

// Wave dekoratif di footer — dua lapis kurva Bezier, meniru bentuk di
// template asli (bukan grafik lepas, digambar langsung karena pdfkit tidak
// bisa import SVG kompleks).
function gambarWaveFooter(doc, pageWidth, pageHeight) {
  const tinggi = 70;
  const dasar = pageHeight;
  const puncak = pageHeight - tinggi;

  doc.save();
  doc.path(
    `M0,${puncak + 25} C${pageWidth * 0.25},${puncak - 15} ${pageWidth * 0.4},${puncak + 40} ${pageWidth * 0.65},${puncak + 10} ` +
    `C${pageWidth * 0.85},${puncak - 12} ${pageWidth * 0.95},${puncak + 15} ${pageWidth},${puncak} ` +
    `L${pageWidth},${dasar} L0,${dasar} Z`
  ).fill(BIRU);

  doc.path(
    `M0,${puncak + 40} C${pageWidth * 0.2},${puncak + 10} ${pageWidth * 0.35},${puncak + 55} ${pageWidth * 0.55},${puncak + 30} ` +
    `C${pageWidth * 0.7},${puncak + 12} ${pageWidth * 0.8},${puncak + 45} ${pageWidth},${puncak + 20} ` +
    `L${pageWidth},${dasar} L0,${dasar} Z`
  ).fillOpacity(0.55).fill(TEAL);
  doc.restore();
}

/**
 * @param {Awaited<ReturnType<import("./invoice.js").buildInvoiceView>>} view
 * @returns {Promise<Buffer>}
 */
export function renderInvoicePdf(view) {
  return new Promise((resolve, reject) => {
    const { invoice, order, customer, nominal } = view;
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width; // 595.28
    const pageHeight = doc.page.height; // 841.89
    const MARGIN = 40;
    const KONTEN_LEBAR = pageWidth - MARGIN * 2;

    // ── Header: banner biru dengan logo + info kontak ───────────────────
    const HEADER_TINGGI = 118;
    doc.rect(0, 0, pageWidth, HEADER_TINGGI).fill(BIRU);

    // Plat putih di belakang logo supaya kontras di atas banner biru.
    const logoUkuran = 44;
    const logoX = MARGIN;
    const logoY = 24;
    doc.roundedRect(logoX - 8, logoY - 8, logoUkuran + 16, logoUkuran + 16, 10).fill("#ffffff");
    try {
      doc.image(LOGO_PATH, logoX, logoY, { width: logoUkuran, height: logoUkuran });
    } catch {
      // Kalau file logo tidak ada/rusak, invoice tetap jalan tanpa logo —
      // jangan sampai satu aset hilang menggagalkan seluruh generate PDF.
    }

    const namaX = logoX + logoUkuran + 24;
    doc.fontSize(17).fillColor("#ffffff").font("Helvetica-Bold").text(PERUSAHAAN.nama, namaX, logoY + 2);
    doc.fontSize(9).fillColor(TEAL_MUDA).font("Helvetica-Oblique").text(PERUSAHAAN.tagline, namaX, logoY + 22);

    // Info kontak — rata kanan, 2 baris.
    const kontakLebar = 260;
    const kontakX = pageWidth - MARGIN - kontakLebar;
    doc.fontSize(8.5).font("Helvetica").fillColor("#ffffff");
    doc.text(`Telp: ${PERUSAHAAN.telp}    Web: ${PERUSAHAAN.website}`, kontakX, 30, { width: kontakLebar, align: "right" });
    doc.text(`WA: ${PERUSAHAAN.whatsapp}`, kontakX, 44, { width: kontakLebar, align: "right" });
    doc.text(PERUSAHAAN.alamat, kontakX, 58, { width: kontakLebar, align: "right" });

    // ── Invoice To / Invoice meta ────────────────────────────────────────
    let y = HEADER_TINGGI + 30;
    doc.fontSize(9).fillColor(ABU).font("Helvetica-Bold").text("INVOICE TO:", MARGIN, y);
    doc.fontSize(12).fillColor(GELAP).font("Helvetica-Bold").text((customer.nama || "-").toUpperCase(), MARGIN, y + 14);
    doc.fontSize(9).fillColor(ABU).font("Helvetica")
      .text(`${order.deliveryAddress || "-"}${order.deliveryCity ? `, ${order.deliveryCity}` : ""}`, MARGIN, y + 32, { width: 260 })
      .text(customer.phone || "-", MARGIN, y + 46);

    doc.fontSize(20).fillColor(BIRU).font("Helvetica-Bold").text("INVOICE", MARGIN, y, { width: KONTEN_LEBAR, align: "right" });
    doc.fontSize(9).fillColor(ABU).font("Helvetica")
      .text(`Invoice No: ${invoice.invoiceNumber}`, MARGIN, y + 26, { width: KONTEN_LEBAR, align: "right" })
      .text(`Invoice Date: ${formatTanggal(invoice.createdAt)}`, MARGIN, y + 40, { width: KONTEN_LEBAR, align: "right" });

    y += 80;

    // ── Tabel item ───────────────────────────────────────────────────────
    const kolNo = MARGIN;
    const kolNoLebar = 30;
    const kolDesk = kolNo + kolNoLebar;
    const kolDeskLebar = 240;
    const kolHarga = kolDesk + kolDeskLebar;
    const kolHargaLebar = 90;
    const kolQty = kolHarga + kolHargaLebar;
    const kolQtyLebar = 45;
    const kolTotal = kolQty + kolQtyLebar;
    const kolTotalLebar = MARGIN + KONTEN_LEBAR - kolTotal;

    const TINGGI_HEADER_TABEL = 24;
    const TINGGI_BARIS = 22;

    doc.rect(MARGIN, y, KONTEN_LEBAR, TINGGI_HEADER_TABEL).fill(BIRU);
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#ffffff");
    doc.text("NO.", kolNo, y + 8, { width: kolNoLebar, align: "center" });
    doc.text("ITEM DESCRIPTION", kolDesk + 6, y + 8, { width: kolDeskLebar - 6 });
    doc.text("PRICE", kolHarga, y + 8, { width: kolHargaLebar - 6, align: "right" });
    doc.text("QTY", kolQty, y + 8, { width: kolQtyLebar, align: "center" });
    doc.text("TOTAL", kolTotal, y + 8, { width: kolTotalLebar - 6, align: "right" });
    y += TINGGI_HEADER_TABEL;

    const items = order.items || [];
    const jumlahBaris = Math.max(items.length, MIN_BARIS_TABEL);
    for (let i = 0; i < jumlahBaris; i++) {
      const it = items[i];
      if (i % 2 === 1) doc.rect(MARGIN, y, KONTEN_LEBAR, TINGGI_BARIS).fill(TEAL_MUDA);
      if (it) {
        doc.fontSize(9).font("Helvetica").fillColor(GELAP);
        doc.text(String(i + 1), kolNo, y + 6, { width: kolNoLebar, align: "center" });
        doc.text(it.nama, kolDesk + 6, y + 6, { width: kolDeskLebar - 10 });
        doc.text(formatRupiah(it.harga), kolHarga, y + 6, { width: kolHargaLebar - 6, align: "right" });
        doc.text("1", kolQty, y + 6, { width: kolQtyLebar, align: "center" });
        doc.text(formatRupiah(it.harga), kolTotal, y + 6, { width: kolTotalLebar - 6, align: "right" });
      }
      y += TINGGI_BARIS;
    }
    doc.moveTo(MARGIN, y).lineTo(MARGIN + KONTEN_LEBAR, y).strokeColor(GARIS).stroke();
    y += 24;

    // ── Payment Method (kiri) + Rincian total (kanan) ───────────────────
    const kolKiriLebar = 260;
    const kolKananX = MARGIN + kolKiriLebar + 20;
    const kolKananLebar = KONTEN_LEBAR - kolKiriLebar - 20;
    const yAwalBawah = y;

    doc.fontSize(10).font("Helvetica-Bold").fillColor(BIRU).text("PAYMENT METHOD", MARGIN, y);
    y += 16;
    doc.fontSize(9).font("Helvetica").fillColor(ABU).text("No. Rekening:", MARGIN, y);
    y += 13;
    doc.fontSize(10).font("Helvetica-Bold").fillColor(GELAP).text(`${PERUSAHAAN.bank.nama} ${PERUSAHAAN.bank.noRekening}`, MARGIN, y);
    y += 15;
    doc.fontSize(9).font("Helvetica").fillColor(ABU).text(`Nama Rekening: ${PERUSAHAAN.bank.namaRekening}`, MARGIN, y, { width: kolKiriLebar });

    // Rincian nominal — kanan.
    let yr = yAwalBawah;
    function barisTotal(label, value, { bold = false, warna = GELAP } = {}) {
      doc.fontSize(bold ? 11 : 9.5)
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fillColor(bold ? warna : ABU)
        .text(label, kolKananX, yr, { width: kolKananLebar * 0.55 });
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(warna)
        .text(value, kolKananX, yr, { width: kolKananLebar, align: "right" });
      yr += bold ? 20 : 17;
    }

    const subTotal = nominal.diskonPersen ? nominal.hargaSebelumDiskon : nominal.totalLayanan;
    barisTotal("Sub Total", formatRupiah(subTotal));
    barisTotal("PPN 10%", formatRupiah(0));
    if (nominal.ongkir > 0) barisTotal("Ongkir", formatRupiah(nominal.ongkir));
    if (nominal.diskonPersen) {
      barisTotal(`Discount${nominal.promoCode ? ` (${nominal.promoCode})` : ""}`, formatRupiah(nominal.nilaiDiskon));
    }
    doc.moveTo(kolKananX, yr + 2).lineTo(kolKananX + kolKananLebar, yr + 2).dash(2, { space: 2 }).strokeColor(GARIS).stroke();
    doc.undash();
    yr += 10;
    barisTotal("TOTAL", formatRupiah(nominal.totalTagihan), { bold: true, warna: BIRU });

    if (nominal.dibayar > 0 || nominal.dibayarTidakRinci) {
      yr += 4;
      barisTotal("Sudah dibayar", nominal.dibayarTidakRinci ? "—" : formatRupiah(nominal.dibayar), { warna: "#16a34a" });
      barisTotal("Sisa tagihan", nominal.dibayarTidakRinci ? "—" : formatRupiah(nominal.sisa), {
        bold: true, warna: nominal.sisa > 0 ? "#dc2626" : "#16a34a",
      });
    }

    y = Math.max(y + 14, yr) + 20;

    // ── Terms & Conditions ───────────────────────────────────────────────
    doc.fontSize(10).font("Helvetica-Bold").fillColor(BIRU).text("TERMS & CONDITIONS", MARGIN, y);
    y += 16;
    doc.fontSize(8.5).font("Helvetica").fillColor(ABU);
    for (const butir of PERUSAHAAN.syaratKetentuan) {
      doc.text(`•  ${butir}`, MARGIN, y, { width: KONTEN_LEBAR - 10 });
      y += doc.heightOfString(`•  ${butir}`, { width: KONTEN_LEBAR - 10 }) + 4;
    }

    if (invoice.notes) {
      y += 10;
      doc.fontSize(9).fillColor(ABU).font("Helvetica-Bold").text("CATATAN", MARGIN, y);
      doc.fontSize(9).fillColor(GELAP).font("Helvetica").text(invoice.notes, MARGIN, y + 13, { width: KONTEN_LEBAR - 100 });
    }

    // ── Wave dekoratif footer ────────────────────────────────────────────
    gambarWaveFooter(doc, pageWidth, pageHeight);
    doc.fontSize(8).fillColor("#ffffff").font("Helvetica")
      .text("Terima kasih telah mempercayakan tidur sehat Anda kepada Klinik Matras.", MARGIN, pageHeight - 30, {
        width: KONTEN_LEBAR, align: "center",
      });

    doc.end();
  });
}
