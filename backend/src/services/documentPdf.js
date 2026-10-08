// KOMPONEN DOKUMEN PDF BERSAMA SANSS — satu sistem tampilan untuk Invoice Sales, Purchase Order, dan dokumen berikutnya.
//
// Dipindahkan APA ADANYA dari invoicePdf.js (urutan operasi gambar tidak diubah) supaya invoice lama tidak berubah satu piksel pun: tes snapshot
// (tests/invoicePdfSnapshot.test.js) membandingkan hash konten PDF lima variasi invoice dengan golden yang diambil SEBELUM refactor.
// Isi di sini hanya TATA LETAK umum: font, warna, logo, identitas perusahaan, header atas, halaman lanjutan, bar tabel, kartu bantuan (footer), helper teks/ikon.
// Angka dan teks transaksi selalu datang dari pemanggil (tidak ada hitungan uang di sini).
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export { PDFDocument };

// Logo versi BIRU (latar terang). Sumber asli: frontend/public/sano_logo_invoice/sano_logo_invoice.png, di-trim sharp.
export const LOGO_PATH = path.join(__dirname, "../../assets/logo-invoice-blue.png");
export const LOGO_ASPEK = 1200 / 426;

// Font: Inter (isi) + Plus Jakarta Sans (judul/label), WOFF dari @fontsource (OFL); ikon FontAwesome Free Solid.
const FONT_DIR = path.join(__dirname, "../../assets/fonts");
export const FONT_TEKS = "Inter";
export const FONT_TEKS_MED = "InterMedium";
export const FONT_JUDUL = "PlusJakartaSansBold";
export const FONT_JUDUL_XBOLD = "PlusJakartaSansExtraBold";
export const FONT_IKON = "FAIcons";
const FONT_TEKS_PATH = path.join(FONT_DIR, "Inter-Regular.woff");
const FONT_TEKS_MED_PATH = path.join(FONT_DIR, "Inter-Medium.woff");
const FONT_JUDUL_PATH = path.join(FONT_DIR, "PlusJakartaSans-Bold.woff");
const FONT_JUDUL_XBOLD_PATH = path.join(FONT_DIR, "PlusJakartaSans-ExtraBold.woff");
export const FONT_IKON_PATH = path.join(FONT_DIR, "fa-solid-900.ttf");

// Kode ikon FontAwesome Free Solid (OFL untuk font, CC BY 4.0 untuk ikon) — dirender sebagai teks dengan FONT_IKON.
export const IKON = {
  user: "",
  wallet: "",
  layerGroup: "",
  shirt: "",
  wrench: "",
  droplet: "",
  gear: "",
  heart: "",
  headset: "",
  globe: "",
  lokasi: "",
  jam: "",
  dokumen: "",
};

// Warna — biru & teal dari logo asli, sisanya palet lembut.
export const BIRU = "#2367C2";
export const BIRU_GELAP = "#124A99";
export const TEAL = "#5FC9BB";
export const TEAL_GELAP = "#2F9C8C";
export const KARTU_BG = "#EEF4FC";
export const HALAMAN_BG = "#F7FAFD";
export const BLOB_WARNA = "#E3ECFB";
export const ABU = "#6b7280";
export const GARIS = "#e2e8f0";
export const GELAP = "#1f2937";

// Identitas perusahaan (PT Sano Kreasi Utama / Klinik Matras) — satu sumber untuk semua dokumen.
export const PERUSAHAAN = {
  website: "www.sanomatrassehat.com",
  whatsapp: "0851 8728 3900",
  alamat: "Jl. Raya Keadilan, Gg Asrama Polri, No. 81, RT 5/12, Pancoran Mas, Kota Depok",
  bank: { nama: "Mandiri", noRekening: "1230013546272", namaRekening: "PT Sano Kreasi Utama" },
};

export function formatRupiah(n) {
  return `Rp${Math.round(n || 0).toLocaleString("id-ID")}`;
}
export function formatTanggal(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
export function formatTanggalPendek(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
}

// Alamat panjang dibatasi N baris + "…" di baris terakhir; baris disusun manual kata-per-kata (opsi ellipsis bawaan pdfkit memotong 1 baris lebih awal).
export function tulisAlamatDibatasi(doc, teks, x, y, { width, maxBaris, align }) {
  const tinggiBaris = doc.currentLineHeight();
  const lebarAman = width - 3;
  const kata = teks.split(" ");
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

  const terpotong = i < kata.length;
  if (terpotong) {
    let lastLine = barisArr[barisArr.length - 1] || "";
    while (lastLine.length > 0 && doc.widthOfString(`${lastLine}…`) > lebarAman) {
      const idxSpasi = lastLine.lastIndexOf(" ");
      lastLine = idxSpasi > 0 ? lastLine.slice(0, idxSpasi) : lastLine.slice(0, -1);
    }
    barisArr[barisArr.length - 1] = `${lastLine}…`;
  }

  doc.text(barisArr.join("\n"), x, y, { width: width + 3, ...(align && { align }) });
  return tinggiBaris * barisArr.length;
}

// Badge lingkaran berisi 1 ikon FontAwesome; glyph ditengahkan dari metrik font (unitsPerEm=512, ascent=459, tengah bbox ~192).
const FA_ASCENT = 459, FA_MID_Y = 192, FA_UNITS_PER_EM = 512;
export function badgeIkon(doc, cx, cy, r, { bg, ikon, warnaIkon = "#ffffff", ukuranIkon }) {
  doc.circle(cx, cy, r).fill(bg);
  const ukuran = ukuranIkon || r * 1.15;
  const skala = ukuran / FA_UNITS_PER_EM;
  const yTeks = cy - (FA_ASCENT - FA_MID_Y) * skala;
  doc.fontSize(ukuran).font(FONT_IKON).fillColor(warnaIkon)
    .text(ikon, cx - r, yTeks, { width: r * 2, align: "center" });
}

// Pil kecil berisi teks (mis. nomor dokumen) — lebar mengikuti isi.
export function pil(doc, x, y, teks, { bg, warna, fontSize = 10, font = FONT_TEKS, padX = 10, padY = 4 }) {
  doc.fontSize(fontSize).font(font);
  const w = doc.widthOfString(teks) + padX * 2;
  const h = fontSize + padY * 2;
  doc.roundedRect(x, y, w, h, h / 2).fill(bg);
  doc.fillColor(warna).text(teks, x, y + padY - 0.5, { width: w, align: "center" });
  return w;
}

// Blob dekoratif di pojok halaman.
export function gambarBlob(doc, pageWidth, pageHeight) {
  doc.save();
  doc.circle(-60, -40, 140).fillOpacity(0.6).fill(BLOB_WARNA);
  doc.circle(-50, pageHeight - 60, 110).fillOpacity(0.5).fill(BLOB_WARNA);
  doc.restore();
}

/** Buat dokumen A4 tanpa margin bawaan + daftarkan font; kembalikan { doc, selesai: Promise<Buffer>, g: geometri bersama }. */
export function bukaDokumenPdf() {
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  const chunks = [];
  const selesai = new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
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
  const kartuGap = 16;
  const kartuW = (KONTEN_LEBAR - kartuGap) / 2;
  const g = {
    pageWidth, pageHeight, MARGIN, KONTEN_LEBAR, BATAS_BAWAH_HALAMAN: 40,
    kartuGap, kartuW, kartuKiriX: MARGIN, kartuKananX: MARGIN + kartuW + kartuGap, padKartu: 16,
  };
  return { doc, selesai, g };
}

/** Latar halaman terang + blob (halaman pertama dan setiap halaman lanjutan). */
export function gambarLatarHalaman(doc, g) {
  doc.rect(0, 0, g.pageWidth, g.pageHeight).fill(HALAMAN_BG);
  gambarBlob(doc, g.pageWidth, g.pageHeight);
}

/**
 * Pola pindah halaman bersama: halaman lanjutan TIDAK mengulang logo besar, hanya penanda kecil "<nomor> — lanjutan". Mengembalikan fungsi yang
 * menambah halaman dan mengembalikan y awal konten di halaman itu.
 */
export function buatPindahHalaman(doc, g, nomor) {
  return function mulaiHalamanBaru() {
    doc.addPage();
    gambarLatarHalaman(doc, g);
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU)
      .text(`${nomor} — lanjutan`, g.MARGIN, 30, { width: g.KONTEN_LEBAR });
    return 30 + 22;
  };
}

/**
 * Header atas: logo kiri, judul besar kanan, titik dekoratif, pil nomor + tanggal. `barisTambahan` (opsional) = teks kecil rata kanan di bawah tanggal.
 * Mengembalikan y awal konten berikutnya.
 */
export function gambarHeaderDokumen(doc, g, { judul, labelNomor, nomor, tanggal, barisTambahan = null, ukuranJudul = 32, subjudul = null }) {
  const { MARGIN, KONTEN_LEBAR } = g;
  let y = 44;
  const logoTinggi = 46;
  const logoLebar = logoTinggi * LOGO_ASPEK;
  try {
    doc.image(LOGO_PATH, MARGIN, y, { width: logoLebar, height: logoTinggi });
  } catch {
    // Aset logo hilang/rusak tidak boleh menggagalkan generate PDF.
  }
  doc.fontSize(ukuranJudul).font(FONT_JUDUL_XBOLD).fillColor(BIRU)
    .text(judul, MARGIN, y + 4, { width: KONTEN_LEBAR, align: "right" });
  // Subjudul kecil di bawah judul (mis. padanan Indonesia) — hanya digambar bila diberikan; invoice tidak memakainya.
  if (subjudul) {
    doc.fontSize(10).font(FONT_TEKS_MED).fillColor(TEAL_GELAP).text(subjudul, MARGIN, y + 4 + ukuranJudul * 1.18, { width: KONTEN_LEBAR, align: "right" });
  }

  // Titik dekoratif kecil di bawah logo.
  const dotY = y + logoTinggi + 14;
  for (let baris = 0; baris < 2; baris++) {
    for (let kolom = 0; kolom < 4; kolom++) {
      doc.circle(MARGIN + kolom * 12, dotY + baris * 10, 1.6).fill(TEAL);
    }
  }

  let yMeta = y + 56;
  doc.fontSize(9.5).font(FONT_TEKS).fillColor(ABU)
    .text(labelNomor, MARGIN, yMeta + 3, { width: KONTEN_LEBAR - 130, align: "right" });
  pil(doc, MARGIN + KONTEN_LEBAR - 118, yMeta - 4, nomor, {
    bg: TEAL, warna: "#ffffff", fontSize: 9.5, font: FONT_TEKS,
  });
  yMeta += 28;
  doc.fontSize(9.5).font(FONT_TEKS).fillColor(ABU)
    .text("Tanggal", MARGIN, yMeta, { width: KONTEN_LEBAR - 130, align: "right" });
  doc.fontSize(11).font(FONT_TEKS).fillColor(GELAP)
    .text(formatTanggal(tanggal), MARGIN, yMeta - 1, { width: KONTEN_LEBAR, align: "right" });

  if (barisTambahan) {
    yMeta += 16;
    doc.fontSize(8).font(FONT_TEKS).fillColor(ABU)
      .text(barisTambahan, MARGIN, yMeta, { width: KONTEN_LEBAR, align: "right" });
  }
  return Math.max(dotY + 30, yMeta + 22);
}

export const TINGGI_HEADER_TABEL = 30;
/** Bar biru header tabel; `kolom` = [{ label, x, w, align }]. Mengembalikan y baris pertama. */
export function gambarHeaderTabel(doc, g, yMulai, kolom) {
  doc.roundedRect(g.MARGIN, yMulai, g.KONTEN_LEBAR, TINGGI_HEADER_TABEL, 10).fill(BIRU);
  doc.fontSize(9).font(FONT_JUDUL).fillColor("#ffffff");
  const yHeaderTeks = yMulai + (TINGGI_HEADER_TABEL - doc.currentLineHeight()) / 2;
  for (const k of kolom) doc.text(k.label, k.x, yHeaderTeks, { width: k.w, ...(k.align && { align: k.align }) });
  return yMulai + TINGGI_HEADER_TABEL + 8;
}

/** Kartu lembut dengan badge ikon + judul kecil teal (kartu "Diterbitkan Untuk", "Metode Pembayaran", dst.). Mengembalikan { x, yIsi, lebarIsi }. */
export function gambarKartuJudul(doc, g, { x, y, w, tinggi, ikon, judul, bgIkon = TEAL, warnaJudul = TEAL_GELAP, ukuranJudul = 9, fontJudul = FONT_JUDUL, offsetJudulY = 6 }) {
  doc.roundedRect(x, y, w, tinggi, 14).fill(KARTU_BG);
  badgeIkon(doc, x + g.padKartu + 12, y + g.padKartu + 12, 12, { bg: bgIkon, ikon });
  doc.fontSize(ukuranJudul).font(fontJudul).fillColor(warnaJudul)
    .text(judul, x + g.padKartu + 32, y + g.padKartu + offsetJudulY, { width: w - g.padKartu * 2 - 32 });
  return { x: x + g.padKartu, yIsi: y + g.padKartu + 30, lebarIsi: w - g.padKartu * 2 };
}

export const BANTUAN_TINGGI = 90;
/**
 * Footer "BUTUH BANTUAN?" — ditambatkan ke tepi bawah halaman; bila konten di atasnya sudah lewat titik tambat, pindah halaman dulu.
 * `mulaiHalamanBaru` dari buatPindahHalaman. Mengembalikan y kartu.
 */
export function gambarFooterBantuan(doc, g, { y, mulaiHalamanBaru }) {
  const { pageHeight, BATAS_BAWAH_HALAMAN, kartuKiriX, KONTEN_LEBAR, padKartu } = g;
  if (y + BANTUAN_TINGGI > pageHeight - BATAS_BAWAH_HALAMAN) {
    y = mulaiHalamanBaru();
  }
  y = Math.max(y, pageHeight - BATAS_BAWAH_HALAMAN - BANTUAN_TINGGI);
  doc.roundedRect(kartuKiriX, y, KONTEN_LEBAR, BANTUAN_TINGGI, 14).fill(KARTU_BG);
  badgeIkon(doc, kartuKiriX + padKartu + 12, y + padKartu + 12, 12, { bg: TEAL, ikon: IKON.headset });
  doc.fontSize(10.5).font(FONT_JUDUL).fillColor(TEAL_GELAP)
    .text("BUTUH BANTUAN?", kartuKiriX + padKartu + 32, y + padKartu + 6, { width: 200 });
  doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU).text("Customer Care", kartuKiriX + padKartu + 32, y + padKartu + 22);
  doc.fontSize(10.5).font(FONT_JUDUL).fillColor(GELAP).text(PERUSAHAAN.whatsapp, kartuKiriX + padKartu + 32, y + padKartu + 34);

  const kolomKananBantuanX = kartuKiriX + KONTEN_LEBAR * 0.48;
  let yBantuan = y + padKartu + 6;
  doc.fontSize(9).font(FONT_IKON).fillColor(TEAL_GELAP).text(IKON.globe, kolomKananBantuanX, yBantuan, { width: 14 });
  doc.fontSize(9).font(FONT_TEKS).fillColor(GELAP).text(PERUSAHAAN.website, kolomKananBantuanX + 18, yBantuan - 1);
  yBantuan += 18;
  doc.fontSize(9).font(FONT_IKON).fillColor(TEAL_GELAP).text(IKON.lokasi, kolomKananBantuanX, yBantuan, { width: 14 });
  doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU).text("Workshop:", kolomKananBantuanX + 18, yBantuan - 1);
  tulisAlamatDibatasi(doc, PERUSAHAAN.alamat, kolomKananBantuanX + 18, yBantuan + 11, {
    width: KONTEN_LEBAR - (kolomKananBantuanX + 18 - kartuKiriX) - padKartu, maxBaris: 2,
  });
  return y;
}
