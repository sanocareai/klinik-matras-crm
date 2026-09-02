// ─── PDF KARTU GARANSI E-WARRANTY (2 Sep 2026) ──────────────────────────────
//
// SATU HALAMAN SENGAJA (bukan 2 "slide" seperti referensi owner) — dokumen
// ini dikirim sebagai lampiran WhatsApp, dan preview thumbnail WA cuma
// menampilkan HALAMAN PERTAMA; kalau cover & kartu data dipisah jadi 2
// halaman, customer yang cuma lihat thumbnail tidak pernah melihat ID
// Transaksi/QR klaim-nya sama sekali tanpa buka PDF-nya dulu. Digabung jadi
// 1 halaman: hero bermerek (logo + "X YEARS of WARRANTY" emas) tetap dapat
// momen visual di atas, TAPI info yang sungguh berguna (ID transaksi, QR
// klaim, syarat garansi) langsung ikut kelihatan di halaman/thumbnail yang
// sama — bukan cuma janji visual di halaman 1 lalu data "tersembunyi" di
// halaman 2.
//
// Sama seperti invoicePdf.js: file ini CUMA TATA LETAK. Semua data datang
// dari buildWarrantyView() (services/warranty.js) — tidak ada logika bisnis
// di sini.

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOGO_PATH = path.join(__dirname, "../../assets/logo-invoice-blue.png");
const LOGO_ASPEK = 1200 / 426;

const FONT_DIR = path.join(__dirname, "../../assets/fonts");
const FONT_TEKS = "Inter";
const FONT_TEKS_MED = "InterMedium";
const FONT_JUDUL = "PlusJakartaSansBold";
const FONT_JUDUL_XBOLD = "PlusJakartaSansExtraBold";
const FONT_TEKS_PATH = path.join(FONT_DIR, "Inter-Regular.woff");
const FONT_TEKS_MED_PATH = path.join(FONT_DIR, "Inter-Medium.woff");
const FONT_JUDUL_PATH = path.join(FONT_DIR, "PlusJakartaSans-Bold.woff");
const FONT_JUDUL_XBOLD_PATH = path.join(FONT_DIR, "PlusJakartaSans-ExtraBold.woff");

// Palet — hero navy gelap (beda dari biru terang invoice, kesan "sertifikat/
// dokumen resmi") + emas untuk angka tahun garansi (permintaan eksplisit
// owner: "text gold untuk 10/20 YEARS of WARRANTY"). SENGAJA tanpa ikon
// FontAwesome sama sekali (beda dari invoicePdf.js) — permintaan owner
// "lebih minimalist, clean", dan footer cuma 1 nomor kontak jadi tidak
// butuh baris ikon padat seperti referensi.
const NAVY_GELAP = "#0B2358";
const NAVY = "#15398C";
const EMAS = "#E4C583";
const TEAL = "#5FC9BB";
const TEAL_GELAP = "#2F9C8C";
const ABU = "#6b7280";
const GELAP = "#1f2937";
const GARIS = "#e2e8f0";
const KARTU_BG = "#F7FAFD";

const PERUSAHAAN = {
  website: "www.sanomatrassehat.com",
  // SATU nomor saja (permintaan eksplisit owner 2 Sep 2026 — referensi
  // punya 2 nomor, disederhanakan jadi 1) — dipakai sama persis dengan
  // yang tercetak di invoice (invoicePdf.js) supaya konsisten 1 kontak
  // resmi di semua dokumen customer-facing.
  whatsapp: "0851 8728 3900",
  alamat: "Jl. Raya Keadilan, Gg Asrama Polri, No. 81, RT 5/12, Pancoran Mas, Kota Depok",
};

// Syarat & ketentuan — TEKS PERSIS dari kartu garansi fisik yang sudah
// dipakai Klinik Matras (owner eksplisit: "jangan ubah syarat dan
// ketentuan"). JANGAN parafrase/rapikan kalimatnya biar konsisten dengan
// versi cetak yang sudah beredar ke customer lama.
const SYARAT_GARANSI = [
  "Label Produk/Merk tidak terlepas dan masih terpasang dengan baik.",
  "Ukuran/bentuk produk yang dikembalikan harus sesuai dengan foto.",
  "Semua dokumentasi seperti invoice harus ada.",
  "Penurunan Kenyamanan: Klaim dapat diajukan jika terjadi penurunan kualitas busa (kempes).",
  "Kerusakan Fondasi: Klaim berlaku jika struktur fondasi kasur mengalami kerusakan atau kehilangan kemampuan menopang secara kokoh.",
  "Pemakaian Normal: Garansi biasanya berlaku untuk penggunaan wajar (tidak terkena banjir kebakaran, atau kerusakan sengaja akibat benda tajam/kimia).",
];

function formatTanggal(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// Nomor lokal ("0851 8728 3900") → format wa.me ("6285187283900").
function nomorKeWaMe(nomor) {
  const digit = String(nomor).replace(/\D/g, "");
  return digit.startsWith("0") ? `62${digit.slice(1)}` : digit;
}

export function buildWarrantyClaimLink(invoiceNumber) {
  const pesan = `Halo, saya ingin mengajukan klaim garansi untuk ID Transaksi ${invoiceNumber}.`;
  return `https://wa.me/${nomorKeWaMe(PERUSAHAAN.whatsapp)}?text=${encodeURIComponent(pesan)}`;
}

// Wrap teks manual dibatasi N baris + "…" — pola sama seperti
// tulisAlamatDibatasi di invoicePdf.js (opsi height+ellipsis bawaan pdfkit
// terbukti tidak akurat), disalin ringkas di sini karena file ini sengaja
// berdiri sendiri (tidak saling import dengan invoicePdf.js).
function tulisDibatasi(doc, teks, x, y, { width, maxBaris }) {
  const tinggiBaris = doc.currentLineHeight();
  const lebarAman = width - 3;
  const kata = String(teks || "-").split(" ");
  const barisArr = [];
  let current = "";
  let i = 0;
  while (i < kata.length) {
    const coba = current ? `${current} ${kata[i]}` : kata[i];
    if (!current || doc.widthOfString(coba) <= lebarAman) {
      current = coba;
      i++;
    } else {
      barisArr.push(current);
      current = "";
      if (barisArr.length === maxBaris) break;
    }
  }
  if (current && barisArr.length < maxBaris) barisArr.push(current);
  if (i < kata.length) {
    let lastLine = barisArr[barisArr.length - 1] || "";
    while (lastLine.length > 0 && doc.widthOfString(`${lastLine}…`) > lebarAman) {
      const idxSpasi = lastLine.lastIndexOf(" ");
      lastLine = idxSpasi > 0 ? lastLine.slice(0, idxSpasi) : lastLine.slice(0, -1);
    }
    barisArr[barisArr.length - 1] = `${lastLine}…`;
  }
  doc.text(barisArr.join("\n"), x, y, { width: width + 3 });
  return tinggiBaris * barisArr.length;
}

/**
 * @param {Awaited<ReturnType<import("./warranty.js").buildWarrantyView>>} view
 * @returns {Promise<Buffer>}
 */
export async function renderWarrantyPdf(view) {
  const { invoiceNumber, purchaseDate, warrantyYears, order, customer, layanan } = view;
  const waLink = buildWarrantyClaimLink(invoiceNumber);
  // QR dibuat SEBELUM PDFDocument dibuka — QRCode.toBuffer async, sisanya
  // (gambar PDF) semua sinkron begitu buffer QR sudah ada.
  const qrBuffer = await QRCode.toBuffer(waLink, {
    type: "png", width: 400, margin: 1,
    color: { dark: NAVY_GELAP, light: "#FFFFFFFF" },
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont(FONT_TEKS, FONT_TEKS_PATH);
    doc.registerFont(FONT_TEKS_MED, FONT_TEKS_MED_PATH);
    doc.registerFont(FONT_JUDUL, FONT_JUDUL_PATH);
    doc.registerFont(FONT_JUDUL_XBOLD, FONT_JUDUL_XBOLD_PATH);
    doc.font(FONT_TEKS);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const MARGIN = 42;
    const KONTEN_LEBAR = pageWidth - MARGIN * 2;

    // ── Hero navy — logo, label, angka tahun EMAS, tagline ───────────────
    const HERO_TINGGI = 300;
    // Gradasi diagonal tipis (kiri-atas lebih gelap → kanan-bawah sedikit
    // lebih terang) meniru referensi tanpa perlu foto/asset tambahan.
    const gradienHero = doc.linearGradient(0, 0, pageWidth, HERO_TINGGI);
    gradienHero.stop(0, NAVY_GELAP).stop(1, NAVY);
    doc.rect(0, 0, pageWidth, HERO_TINGGI).fill(gradienHero);

    // Plakat putih kecil kiri-atas berisi logo asli (biru/teal) — dipilih
    // dibanding logo versi putih polos karena versi putih menghilangkan
    // kontras internal badge "SANOCARE" (jadi 1 blok putih tak terbaca);
    // plakat putih di sini menjamin logo tetap terbaca persis seperti di
    // invoice, di atas latar gelap sekalipun.
    const plakatW = 108, plakatH = 40;
    doc.roundedRect(MARGIN, 26, plakatW, plakatH, 8).fill("#ffffff");
    try {
      const logoTinggi = plakatH - 14;
      const logoLebar = logoTinggi * LOGO_ASPEK;
      doc.image(LOGO_PATH, MARGIN + (plakatW - logoLebar) / 2, 26 + (plakatH - logoTinggi) / 2, { width: logoLebar, height: logoTinggi });
    } catch {
      // Aset logo hilang/rusak tidak boleh menggagalkan generate PDF.
    }

    doc.fontSize(10.5).font(FONT_JUDUL).fillColor("#ffffff")
      .text("E - W A R R A N T Y   C A R D", MARGIN, 96, { width: KONTEN_LEBAR, align: "center", characterSpacing: 0.5 });

    doc.fontSize(58).font(FONT_JUDUL_XBOLD).fillColor(EMAS)
      .text(`${warrantyYears} YEARS`, MARGIN, 120, { width: KONTEN_LEBAR, align: "center" });
    doc.fontSize(26).font(FONT_JUDUL).fillColor(EMAS)
      .text("of WARRANTY", MARGIN, 188, { width: KONTEN_LEBAR, align: "center" });

    doc.fontSize(10.5).font(FONT_TEKS).fillColor("#cfe0ff")
      .text("Dedikasi Kami untuk Tidur Sehat dan Nyenyak Anda", MARGIN, 236, { width: KONTEN_LEBAR, align: "center" });

    // ── Kartu "KARTU GARANSI" — data transaksi (kiri) + QR klaim (kanan) ──
    let y = HERO_TINGGI + 30;
    doc.fontSize(19).font(FONT_JUDUL_XBOLD).fillColor(GELAP)
      .text("KARTU GARANSI", MARGIN, y);
    doc.roundedRect(MARGIN, y + 26, 44, 3, 1.5).fill(TEAL);
    y += 42;

    const kolKiriX = MARGIN;
    const kolKiriW = KONTEN_LEBAR * 0.6;
    const kolKananX = MARGIN + KONTEN_LEBAR * 0.68;
    const kolKananW = KONTEN_LEBAR * 0.32;
    const labelW = 118;
    let yKiri = y;

    function baris(label, value, { maxBaris = 1 } = {}) {
      doc.fontSize(9).font(FONT_TEKS_MED).fillColor(ABU).text(label, kolKiriX, yKiri, { width: labelW });
      doc.fontSize(9.8).font(FONT_TEKS_MED).fillColor(GELAP);
      if (maxBaris > 1) {
        const tinggi = tulisDibatasi(doc, value, kolKiriX + labelW, yKiri, { width: kolKiriW - labelW, maxBaris });
        yKiri += Math.max(18, tinggi + 6);
      } else {
        doc.text(value || "-", kolKiriX + labelW, yKiri, { width: kolKiriW - labelW });
        yKiri += 18;
      }
    }

    baris("Nama Customer", customer.nama || "-");
    baris("No. WhatsApp", customer.phone || "-");
    baris("Alamat", [order.deliveryAddress, order.deliveryCity].filter(Boolean).join(", ") || "-", { maxBaris: 2 });
    baris("ID Transaksi", invoiceNumber);
    baris("Tanggal Pembelian", formatTanggal(purchaseDate));
    baris("Layanan", layanan, { maxBaris: 2 });
    baris("Keluhan Customer", order.keluhanCustomer, { maxBaris: 2 });

    // QR — kanan, sejajar dgn awal kolom kiri.
    const qrUkuran = 118;
    const qrX = kolKananX + (kolKananW - qrUkuran) / 2;
    doc.roundedRect(qrX - 8, y - 8, qrUkuran + 16, qrUkuran + 16, 10).fill(KARTU_BG);
    doc.image(qrBuffer, qrX, y, { width: qrUkuran, height: qrUkuran });
    doc.fontSize(8.5).font(FONT_JUDUL).fillColor(TEAL_GELAP)
      .text("SCAN DISINI UNTUK KLAIM", kolKananX, y + qrUkuran + 16, { width: kolKananW, align: "center" });

    y = Math.max(yKiri, y + qrUkuran + 34) + 18;

    // ── Syarat & Ketentuan Garansi — teks PERSIS, jangan diubah ───────────
    doc.fontSize(9).font(FONT_TEKS);
    let tinggiSyarat = 40;
    const syaratLebar = KONTEN_LEBAR - 32;
    for (const poin of SYARAT_GARANSI) {
      tinggiSyarat += doc.heightOfString(`0. ${poin}`, { width: syaratLebar - 14 }) + 6;
    }
    doc.roundedRect(MARGIN, y, KONTEN_LEBAR, tinggiSyarat, 12).fill(NAVY_GELAP);
    doc.fontSize(10.5).font(FONT_JUDUL).fillColor("#ffffff")
      .text("SYARAT & KETENTUAN GARANSI", MARGIN + 16, y + 14, { width: syaratLebar });
    let ySyarat = y + 36;
    SYARAT_GARANSI.forEach((poin, i) => {
      doc.fontSize(8.5).font(FONT_JUDUL).fillColor(TEAL)
        .text(`${i + 1}.`, MARGIN + 16, ySyarat, { width: 14 });
      doc.fontSize(8.5).font(FONT_TEKS).fillColor("#dbe6f7")
        .text(poin, MARGIN + 32, ySyarat, { width: syaratLebar - 16 });
      ySyarat += doc.heightOfString(poin, { width: syaratLebar - 16 }) + 6;
    });
    y += tinggiSyarat + 20;

    // ── Footer — 1 kontak saja (permintaan owner), full-bleed spt referensi.
    const footerTinggi = 62;
    const footerY = Math.max(y, pageHeight - footerTinggi);
    doc.rect(0, footerY, pageWidth, pageHeight - footerY).fill(TEAL);
    doc.fontSize(10).font(FONT_JUDUL).fillColor("#ffffff")
      .text(`Customer Care: ${PERUSAHAAN.whatsapp}`, MARGIN, footerY + 14, { width: KONTEN_LEBAR / 2 });
    doc.fontSize(9).font(FONT_TEKS).fillColor("#ffffff")
      .text(PERUSAHAAN.website, MARGIN, footerY + 32, { width: KONTEN_LEBAR / 2 });
    doc.fontSize(8.5).font(FONT_TEKS).fillColor("#eafff9")
      .text(PERUSAHAAN.alamat, MARGIN + KONTEN_LEBAR / 2, footerY + 14, { width: KONTEN_LEBAR / 2, align: "right" });

    doc.end();
  });
}
