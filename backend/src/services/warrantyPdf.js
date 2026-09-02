// ─── PDF KARTU GARANSI E-WARRANTY (2 Sep 2026, revisi 3 Sep 2026) ───────────
//
// SATU HALAMAN SENGAJA (bukan 2 "slide" seperti referensi owner) — dokumen
// ini dikirim sebagai lampiran WhatsApp, dan preview thumbnail WA cuma
// menampilkan HALAMAN PERTAMA; kalau cover & kartu data dipisah jadi 2
// halaman, customer yang cuma lihat thumbnail tidak pernah melihat ID
// Transaksi/QR klaim-nya sama sekali tanpa buka PDF-nya dulu.
//
// Revisi 3 Sep 2026 (feedback owner atas draf pertama):
// 1. Logo ganti ke assets/logo-warranty-primary.png (dari "Klinik Matras_
//    Primary Color.png"), tetap di plakat putih kecil (logo ini BERWARNA —
//    tanpa plakat putih, kontrasnya hilang di atas latar biru manapun).
// 2. Biru hero DISAMAKAN dengan biru invoice (BIRU/BIRU_GELAP) — draf
//    pertama pakai navy nyaris hitam yang tidak match brand.
// 3. Angka tahun garansi diperbesar + efek emas berlapis (bayangan emas
//    gelap di belakang, emas terang di atas) — kesan lebih "classy".
// 4. BUG diperbaiki: field bebas (alamat/layanan/keluhan) yang mengandung
//    newline manual dari input sales bikin tinggi baris SALAH HITUNG (fungsi
//    pembungkus kata cuma split spasi, padahal doc.text() pdfkit tetap
//    menghormati \n sebagai baris baru saat digambar) → baris berikutnya
//    numpuk. Sekarang SEMUA teks bebas disaring (\s+ → 1 spasi) dulu
//    sebelum diukur DAN digambar, jadi yang diukur = persis yang digambar.
//    Sekalian: "Keluhan Customer" TIDAK LAGI fallback ke Order.notes — field
//    itu kadang menyimpan JSON internal (metadata katalog), bukan teks utk
//    customer; menampilkannya apa adanya adalah kebocoran data internal.
//    Sekarang HANYA dari complaintDetail (keluhan yang mendasari servis),
//    kosong → "-" jujur, bukan menebak dari field lain.
// 5. Setiap baris label sekarang seragam "Label :" (dulu tanpa titik dua).
// 6. Kartu Syarat & Ketentuan pakai biru brand yang sama (poin 2) — bukan
//    navy terpisah yang tidak konsisten.
// 7. Elemen gaya invoice DIPAKAI ULANG (bukan didesain ulang dari nol):
//    titik dekoratif di bawah logo, badge ikon bulat (badgeIkon), ID
//    Transaksi sbg pil (pil) — SEMUA di-import dari invoicePdf.js, bukan
//    ditulis ulang, supaya PUA glyph FontAwesome-nya dijamin persis sama
//    (menulis ulang kode ikon manual berisiko salah karakter).
//
// Sama seperti invoicePdf.js: file ini CUMA TATA LETAK. Semua data datang
// dari buildWarrantyView() (services/warranty.js) — tidak ada logika bisnis
// di sini.

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";
import { IKON, FONT_IKON, FONT_IKON_PATH, badgeIkon, pil } from "./invoicePdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOGO_PATH = path.join(__dirname, "../../assets/logo-warranty-primary.png");
const LOGO_ASPEK = 3000 / 978;

// Judul "X YEARS of WARRANTY" — asset gambar 3D emas metalik siap-pakai
// dari designer (revisi 3 Sep 2026, poin 2), BUKAN lagi teks yang digambar
// pdfkit. Dua varian (10/20 tahun) punya rasio aspek beda tipis, makanya
// dicatat terpisah — jangan asumsikan sama.
const TITLE_10_PATH = path.join(__dirname, "../../assets/ewarranty_10years_title.png");
const TITLE_20_PATH = path.join(__dirname, "../../assets/ewarranty_20years_title.png");
const TITLE_10_ASPEK = 1400 / 525;
const TITLE_20_ASPEK = 1400 / 467;

const FONT_DIR = path.join(__dirname, "../../assets/fonts");
const FONT_TEKS = "Inter";
const FONT_TEKS_MED = "InterMedium";
const FONT_JUDUL = "PlusJakartaSansBold";
const FONT_JUDUL_XBOLD = "PlusJakartaSansExtraBold";
const FONT_TEKS_PATH = path.join(FONT_DIR, "Inter-Regular.woff");
const FONT_TEKS_MED_PATH = path.join(FONT_DIR, "Inter-Medium.woff");
const FONT_JUDUL_PATH = path.join(FONT_DIR, "PlusJakartaSans-Bold.woff");
const FONT_JUDUL_XBOLD_PATH = path.join(FONT_DIR, "PlusJakartaSans-ExtraBold.woff");

// Palet — SAMA dengan invoicePdf.js (poin 2 & 6 revisi: brand blue yang
// konsisten, bukan navy terpisah).
const BIRU = "#2367C2";
const BIRU_GELAP = "#124A99";
const TEAL = "#5FC9BB";
const TEAL_GELAP = "#2F9C8C";
// Dipakai HANYA sbg warna fallback kalau asset judul emas (lihat TITLE_*_PATH
// di bawah) hilang/rusak — headline utama sekarang gambar PNG siap-pakai
// (revisi poin 2), bukan teks pdfkit lagi.
const EMAS = "#E0BA6C";
const ABU = "#6b7280";
const GELAP = "#1f2937";
const KARTU_BG = "#F7FAFD";

const PERUSAHAAN = {
  website: "www.sanomatrassehat.com",
  // SATU nomor saja (permintaan eksplisit owner 2 Sep 2026 — referensi
  // punya 2 nomor, disederhanakan jadi 1) — sama persis dengan yang
  // tercetak di invoice supaya konsisten 1 kontak resmi.
  whatsapp: "0851 8728 3900",
  alamat: "Jl. Raya Keadilan, Gg Asrama Polri, No. 81, RT 5/12, Pancoran Mas, Kota Depok",
};

// Syarat & ketentuan — TEKS PERSIS dari kartu garansi fisik yang sudah
// dipakai Klinik Matras (owner eksplisit: "jangan ubah syarat dan
// ketentuan"). JANGAN parafrase/rapikan kalimatnya.
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

// Teks bebas (alamat/layanan/keluhan) bisa mengandung newline/tab manual
// dari input sales — DISARING jadi 1 baris logis SEBELUM diukur/digambar
// (lihat catatan bug #4 di kepala file). Tanpa ini, tinggi yang DIUKUR
// (word-wrap spasi biasa) tidak pernah sama dengan tinggi yang SUNGGUH
// digambar (doc.text() pdfkit tetap menghormati \n apa adanya).
function bersihkanTeks(v) {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t || "-";
}

// Pecah 1 kalimat jadi 2 baris SEIMBANG panjangnya (revisi poin 4, 3 Sep
// 2026) — dulu alamat cuma di-word-wrap otomatis pdfkit pada lebar tetap,
// hasilnya baris kedua sering pendek sendiri (mis. "Mas, Kota Depok" doang)
// yang menurut owner "kurang estetik". Dicari titik potong (antar kata)
// yang bikin PANJANG KARAKTER kedua baris paling mendekati sama, bukan
// sekadar "sepenuh mungkin muat di lebar kolom".
function bagiDuaBarisSeimbang(teks) {
  const kata = teks.split(" ");
  if (kata.length < 2) return [teks, ""];
  let potonganTerbaik = 1;
  let bedaTerkecil = Infinity;
  for (let i = 1; i < kata.length; i++) {
    const baris1 = kata.slice(0, i).join(" ");
    const baris2 = kata.slice(i).join(" ");
    const beda = Math.abs(baris1.length - baris2.length);
    if (beda < bedaTerkecil) { bedaTerkecil = beda; potonganTerbaik = i; }
  }
  return [kata.slice(0, potonganTerbaik).join(" "), kata.slice(potonganTerbaik).join(" ")];
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
// tulisAlamatDibatasi di invoicePdf.js. Input WAJIB sudah lewat
// bersihkanTeks() dulu (tidak disaring ulang di sini) supaya kontrak fungsi
// ini jelas: "teks 1 baris logis masuk, dibungkus, tinggi yang dikembalikan
// akurat".
function tulisDibatasi(doc, teksBersih, x, y, { width, maxBaris }) {
  const tinggiBaris = doc.currentLineHeight();
  const lebarAman = width - 3;
  const kata = teksBersih.split(" ");
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
    color: { dark: BIRU_GELAP, light: "#FFFFFFFF" },
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
    doc.registerFont(FONT_IKON, FONT_IKON_PATH);
    doc.font(FONT_TEKS);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const MARGIN = 42;
    const KONTEN_LEBAR = pageWidth - MARGIN * 2;

    // ── Hero — logo, label, angka tahun EMAS besar, tagline ──────────────
    // Revisi ke-2 (3 Sep 2026): revisi sebelumnya kepanjangan/kekecilan —
    // owner kirim referensi baru (komposisi lebih "penuh", label & tagline
    // BOLD besar, jarak antar elemen RAPAT bukan lega) dan minta disesuaikan
    // ke arah itu — TETAP pakai asset gambar emas utk "X YEARS of WARRANTY"
    // (bukan diganti teks), cuma sizing/komposisinya diselaraskan.
    const HERO_TINGGI = 328;
    const gradienHero = doc.linearGradient(0, 0, pageWidth, HERO_TINGGI);
    gradienHero.stop(0, BIRU_GELAP).stop(1, BIRU);
    doc.rect(0, 0, pageWidth, HERO_TINGGI).fill(gradienHero);

    // Plakat putih kecil kiri-atas berisi logo BERWARNA — logo aslinya
    // biru/teal (bukan versi putih), jadi butuh dasar terang supaya tetap
    // terbaca di atas hero biru apa pun kecerahannya. Titik dekoratif yang
    // dulu ada di bawah plakat DIHAPUS (revisi poin 1 — owner minta hilang).
    const plakatW = 104, plakatH = 38;
    doc.roundedRect(MARGIN, 26, plakatW, plakatH, 8).fill("#ffffff");
    try {
      const logoTinggi = plakatH - 14;
      const logoLebar = logoTinggi * LOGO_ASPEK;
      doc.image(LOGO_PATH, MARGIN + (plakatW - logoLebar) / 2, 26 + (plakatH - logoTinggi) / 2, { width: logoLebar, height: logoTinggi });
    } catch {
      // Aset logo hilang/rusak tidak boleh menggagalkan generate PDF.
    }

    // Label & tagline sekarang BOLD/lebih besar (revisi ke-2, mengikuti
    // referensi baru owner) — bukan lagi label kecil berspasi lebar +
    // tagline tipis, itu yang bikin komposisi lama terasa "kosong".
    const labelY = 84;
    doc.fontSize(15).font(FONT_JUDUL_XBOLD).fillColor("#ffffff")
      .text("E-WARRANTY CARD", MARGIN, labelY, { width: KONTEN_LEBAR, align: "center", characterSpacing: 0.5 });

    // Judul "X YEARS of WARRANTY" — gambar 3D emas metalik siap-pakai
    // (asset designer), bukan teks pdfkit. PNG transparan (dicek: alpha=0
    // di seluruh area luar hurufnya) jadi tinggal ditempel di atas gradasi
    // hero. Revisi ke-2 (3 Sep 2026): diperbesar lagi ke 80% lebar konten +
    // jarak ke label/tagline DIRAPATKAN, mengikuti komposisi "penuh & rapat"
    // dari referensi baru owner — TETAP ada margin kiri-kanan yang jelas
    // (bukan nempel edge-to-edge spt revisi pertama).
    const titlePath = warrantyYears === 20 ? TITLE_20_PATH : TITLE_10_PATH;
    const titleAspek = warrantyYears === 20 ? TITLE_20_ASPEK : TITLE_10_ASPEK;
    const titleLebar = KONTEN_LEBAR * 0.8;
    const titleTinggi = titleLebar / titleAspek;
    const titleY = labelY + 30;
    try {
      doc.image(titlePath, MARGIN + (KONTEN_LEBAR - titleLebar) / 2, titleY, { width: titleLebar, height: titleTinggi });
    } catch {
      // Fallback teks polos kalau asset hilang — jangan sampai generate PDF gagal total.
      doc.fontSize(44).font(FONT_JUDUL_XBOLD).fillColor(EMAS)
        .text(`${warrantyYears} YEARS of WARRANTY`, MARGIN, titleY + titleTinggi / 3, { width: KONTEN_LEBAR, align: "center" });
    }

    doc.fontSize(12.5).font(FONT_JUDUL).fillColor("#ffffff")
      .text("Dedikasi Kami untuk Tidur Sehat dan Nyenyak Anda", MARGIN, titleY + titleTinggi + 14, { width: KONTEN_LEBAR, align: "center" });

    // ── "KARTU GARANSI" — data transaksi (kiri) + QR klaim (kanan) ────────
    let y = HERO_TINGGI + 30;
    badgeIkon(doc, MARGIN + 12, y + 10, 12, { bg: TEAL, ikon: IKON.heart });
    doc.fontSize(19).font(FONT_JUDUL_XBOLD).fillColor(GELAP)
      .text("KARTU GARANSI", MARGIN + 32, y);
    y += 40;

    const kolKiriX = MARGIN;
    const kolKiriW = KONTEN_LEBAR * 0.6;
    const kolKananX = MARGIN + KONTEN_LEBAR * 0.68;
    const kolKananW = KONTEN_LEBAR * 0.32;
    const labelW = 128;
    let yKiri = y;

    // Setiap baris "Label :  Nilai" (revisi poin 5: dulu tanpa titik dua).
    function baris(label, rawValue, { maxBaris = 1, pilBadge = false } = {}) {
      const value = bersihkanTeks(rawValue);
      doc.fontSize(9).font(FONT_TEKS_MED).fillColor(ABU).text(`${label} :`, kolKiriX, yKiri, { width: labelW });
      if (pilBadge) {
        // ID Transaksi sbg pil kecil — gaya sama dgn "Invoice No." di
        // invoicePdf.js (elemen dipakai ulang, poin 7 revisi).
        pil(doc, kolKiriX + labelW, yKiri - 4, value, { bg: TEAL, warna: "#ffffff", fontSize: 9.5, font: FONT_TEKS_MED });
        yKiri += 24;
        return;
      }
      doc.fontSize(9.8).font(FONT_TEKS_MED).fillColor(GELAP);
      if (maxBaris > 1) {
        const tinggi = tulisDibatasi(doc, value, kolKiriX + labelW, yKiri, { width: kolKiriW - labelW, maxBaris });
        yKiri += Math.max(18, tinggi + 8);
      } else {
        doc.text(value, kolKiriX + labelW, yKiri, { width: kolKiriW - labelW });
        yKiri += 18;
      }
    }

    baris("Nama Customer", customer.nama);
    baris("No. WhatsApp", customer.phone);
    baris("Alamat", [order.deliveryAddress, order.deliveryCity].filter(Boolean).join(", "), { maxBaris: 2 });
    baris("ID Transaksi", invoiceNumber, { pilBadge: true });
    baris("Tanggal Pembelian", formatTanggal(purchaseDate));
    baris("Layanan", layanan, { maxBaris: 2 });
    baris("Keluhan Customer", order.keluhanCustomer, { maxBaris: 2 });

    // QR — kanan, sejajar dgn awal kolom kiri.
    const qrUkuran = 116;
    const qrX = kolKananX + (kolKananW - qrUkuran) / 2;
    doc.roundedRect(qrX - 8, y - 8, qrUkuran + 16, qrUkuran + 16, 10).fill(KARTU_BG);
    doc.image(qrBuffer, qrX, y, { width: qrUkuran, height: qrUkuran });
    doc.fontSize(8.5).font(FONT_JUDUL).fillColor(TEAL_GELAP)
      .text("SCAN DISINI UNTUK KLAIM", kolKananX, y + qrUkuran + 16, { width: kolKananW, align: "center" });

    y = Math.max(yKiri, y + qrUkuran + 34) + 18;

    // ── Syarat & Ketentuan Garansi — teks PERSIS, warna brand (poin 6) ────
    doc.fontSize(9).font(FONT_TEKS);
    let tinggiSyarat = 44;
    const syaratLebar = KONTEN_LEBAR - 32;
    for (const poin of SYARAT_GARANSI) {
      tinggiSyarat += doc.heightOfString(poin, { width: syaratLebar - 16 }) + 6;
    }
    const gradienSyarat = doc.linearGradient(MARGIN, y, MARGIN, y + tinggiSyarat);
    gradienSyarat.stop(0, BIRU_GELAP).stop(1, BIRU);
    doc.roundedRect(MARGIN, y, KONTEN_LEBAR, tinggiSyarat, 12).fill(gradienSyarat);
    // Revisi poin 3 (3 Sep 2026): badge digeser lebih ke kiri + diperkecil,
    // dan judul digeser lebih ke kanan — jarak sebelumnya cuma ~2pt (badge
    // & huruf "S" nyaris nempel/tumpang tindih di render nyata).
    badgeIkon(doc, MARGIN + 16 + 9, y + 16 + 9, 9, { bg: "#ffffff", ikon: IKON.dokumen, warnaIkon: BIRU_GELAP, ukuranIkon: 9 });
    doc.fontSize(10.5).font(FONT_JUDUL).fillColor("#ffffff")
      .text("SYARAT & KETENTUAN GARANSI", MARGIN + 46, y + 16 + 5, { width: syaratLebar - 30 });
    let ySyarat = y + 42;
    SYARAT_GARANSI.forEach((poin, i) => {
      doc.fontSize(8.5).font(FONT_JUDUL).fillColor(TEAL)
        .text(`${i + 1}.`, MARGIN + 16, ySyarat, { width: 14 });
      doc.fontSize(8.5).font(FONT_TEKS).fillColor("#e4edfb")
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
    const [alamatBaris1, alamatBaris2] = bagiDuaBarisSeimbang(PERUSAHAAN.alamat);
    doc.fontSize(8.5).font(FONT_TEKS).fillColor("#eafff9")
      .text(alamatBaris1, MARGIN + KONTEN_LEBAR / 2, footerY + 14, { width: KONTEN_LEBAR / 2, align: "right" })
      .text(alamatBaris2, MARGIN + KONTEN_LEBAR / 2, footerY + 27, { width: KONTEN_LEBAR / 2, align: "right" });

    doc.end();
  });
}
