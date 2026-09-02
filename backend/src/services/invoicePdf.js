// ─── PDF INVOICE — server-side (31 Agustus 2026, redesain ke-3: 2 September
// 2026) ───────────────────────────────────────────────────────────────────
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
// Desain (2 Sep 2026, redesain ke-3): mengikuti referensi kartu-lembut/ikon
// bulat yang dikirim owner — latar terang, kartu rounded, badge pil, ikon
// FontAwesome, tanda tangan "thank you" tulisan tangan. Menggantikan desain
// header-biru sebelumnya sepenuhnya.
//
// Ikon per baris item dipilih dari KATA KUNCI nama layanan (lihat
// pilihIkonItem()) — heuristik best-effort, BUKAN kategori resmi dari
// database (OrderItem cuma punya `layananName`, tidak ada field kategori/
// deskripsi terpisah). Kalau tidak cocok kata kunci mana pun, jatuh ke ikon
// gerigi generik — tidak pernah mengarang teks deskripsi tambahan yang tidak
// ada di data (dikonfirmasi ke owner 2 Sep 2026: skip subjudul deskripsi,
// bukan diisi teks template).

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import { formatAlamat } from "../utils/formatAlamat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Logo versi BIRU (untuk latar terang) — desain header-biru sebelumnya
// (dibuang bersama file ini) pakai versi putih karena latarnya gelap.
// Sumber asli: frontend/public/sano_logo_invoice/sano_logo_invoice.png,
// di-trim sharp.
const LOGO_PATH = path.join(__dirname, "../../assets/logo-invoice-blue.png");
const LOGO_ASPEK = 1200 / 426;

// Font (revisi 2 Sep 2026 — pasangan pertama Questrial/Bebas Neue/Caveat
// dinilai owner kurang cocok/kurang profesional). Ganti ke pasangan yang
// lebih umum dipakai produk fintech/SaaS modern: Inter untuk isi (badan
// teks paling teruji keterbacaannya di ukuran kecil), Plus Jakarta Sans
// Bold/ExtraBold untuk judul & label (geometris, tegas, tapi tetap huruf
// kecil-besar normal — bukan huruf kapital paksa seperti Bebas Neue).
// (Skrip tulisan tangan "thank you" — sempat pakai Sacramento — DIHAPUS
// TOTAL di revisi berikutnya di hari yang sama: owner minta cuma 1 ucapan
// terima kasih, bukan dua tempat terpisah. Lihat blok "Terima kasih" di
// bawah, sekarang teks polos, bukan tanda tangan.)
//
// Semua file WOFF diambil dari paket npm @fontsource/inter dan
// @fontsource/plus-jakarta-sans (Google Fonts, lisensi OFL) — pdfkit lewat
// fontkit BISA baca WOFF langsung, jadi tidak perlu instance TTF statis
// terpisah (Inter/Plus Jakarta Sans di repo google/fonts sekarang cuma
// didistribusikan sebagai variable font, yang tidak bisa dipilih beratnya
// tanpa fonttools/Python — tidak tersedia di server ini).
const FONT_DIR = path.join(__dirname, "../../assets/fonts");
const FONT_TEKS = "Inter";
const FONT_TEKS_MED = "InterMedium";
const FONT_JUDUL = "PlusJakartaSansBold";
const FONT_JUDUL_XBOLD = "PlusJakartaSansExtraBold";
const FONT_IKON = "FAIcons";
const FONT_TEKS_PATH = path.join(FONT_DIR, "Inter-Regular.woff");
const FONT_TEKS_MED_PATH = path.join(FONT_DIR, "Inter-Medium.woff");
const FONT_JUDUL_PATH = path.join(FONT_DIR, "PlusJakartaSans-Bold.woff");
const FONT_JUDUL_XBOLD_PATH = path.join(FONT_DIR, "PlusJakartaSans-ExtraBold.woff");
const FONT_IKON_PATH = path.join(FONT_DIR, "fa-solid-900.ttf");

// Kode ikon FontAwesome Free Solid (lisensi OFL untuk font, CC BY 4.0 untuk
// ikon — dipakai apa adanya, atribusi dicatat di sini) yang dipakai di
// invoice ini. Render sebagai teks biasa dengan FONT_IKON, BUKAN gambar.
const IKON = {
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

// Warna — biru & teal diambil dari logo asli, sisanya palet lembut mengikuti
// referensi (latar terang, kartu biru-abu sangat muda).
const BIRU = "#2367C2";
const BIRU_GELAP = "#124A99";
const TEAL = "#5FC9BB";
const TEAL_GELAP = "#2F9C8C";
const KARTU_BG = "#EEF4FC";
const HALAMAN_BG = "#F7FAFD";
const BLOB_WARNA = "#E3ECFB";
const ABU = "#6b7280";
const GARIS = "#e2e8f0";
const GELAP = "#1f2937";

const PERUSAHAAN = {
  website: "www.sanomatrassehat.com",
  whatsapp: "0851 8728 3900",
  alamat: "Jl. Raya Keadilan, Gg Asrama Polri, No. 81, RT 5/12, Pancoran Mas, Kota Depok",
  bank: {
    nama: "Mandiri",
    noRekening: "1230013546272",
    namaRekening: "PT Sano Kreasi Utama",
  },
  syaratKetentuan:
    "Harga sudah termasuk biaya antar-jemput (Free Delivery). Tidak ada pembayaran di muka. " +
    "Pembayaran lunas dilakukan saat serah terima barang di lokasi pelanggan (COD/Transfer saat " +
    "barang sampai). Harap periksa kondisi barang sebelum melakukan pembayaran.",
};

function formatRupiah(n) {
  return `Rp${Math.round(n || 0).toLocaleString("id-ID")}`;
}
function formatTanggal(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// Heuristik ikon per item — lihat catatan lisensi/keputusan di kepala file.
function pilihIkonItem(nama = "") {
  const n = nama.toLowerCase();
  if (/fondasi|per\b|pegas|frame|struktur|rangka/.test(n)) return IKON.wrench;
  if (/busa|lapisan|layer/.test(n)) return IKON.layerGroup;
  if (/kain|cover|sarung|fabric/.test(n)) return IKON.shirt;
  if (/sanitasi|cuci|bersih|vakum|steam/.test(n)) return IKON.droplet;
  return IKON.gear;
}

// Alamat customer/kantor kadang sangat panjang — dibatasi maksimal N baris
// + "…" di baris terakhir. Lihat riwayat: opsi height+ellipsis bawaan
// pdfkit terbukti memotong 1 baris lebih awal dari yang diminta, jadi baris
// disusun manual kata-per-kata pakai widthOfString(), dengan margin aman
// beberapa pt supaya pembulatan pdfkit saat render sungguhan tidak
// menggeser 1 kata ke baris tambahan yang tidak diperhitungkan.
function tulisAlamatDibatasi(doc, teks, x, y, { width, maxBaris, align }) {
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

// Badge lingkaran berisi 1 ikon FontAwesome — dipakai untuk avatar kartu
// "Diterbitkan Untuk"/"Metode Pembayaran", ikon per baris item, dst.
// Offset vertikal buat menengahkan glyph FontAwesome secara presisi (bukan
// tebak-tebakan angka seperti sebelumnya — itu yang bikin ikon kelihatan
// "ga rata tengah" di kartu, ditemukan lewat komplain visual owner).
// pdfkit menaruh TOP garis teks di `y` yang diberikan, dijangkarkan dari
// ascent font (bukan dari tinggi tinta glyph-nya) — jadi buat menengahkan
// tinta glyph di titik cy, hitung mundur pakai metrik font FontAwesome
// Solid sungguhan: unitsPerEm=512, ascent=459, dan titik tengah kotak
// glyph (bbox minY/maxY) SELALU ~192 unit untuk semua ikon yang dipakai di
// sini (dicek satu-satu lewat fontkit) — makanya SATU konstanta ini cukup
// untuk semua ikon, tidak perlu kalibrasi manual per ikon.
const FA_ASCENT = 459, FA_MID_Y = 192, FA_UNITS_PER_EM = 512;
function badgeIkon(doc, cx, cy, r, { bg, ikon, warnaIkon = "#ffffff", ukuranIkon }) {
  doc.circle(cx, cy, r).fill(bg);
  const ukuran = ukuranIkon || r * 1.15;
  const skala = ukuran / FA_UNITS_PER_EM;
  const yTeks = cy - (FA_ASCENT - FA_MID_Y) * skala;
  doc.fontSize(ukuran).font(FONT_IKON).fillColor(warnaIkon)
    .text(ikon, cx - r, yTeks, { width: r * 2, align: "center" });
}

// Pil kecil berisi teks (mis. nomor invoice) — lebar mengikuti isi.
function pil(doc, x, y, teks, { bg, warna, fontSize = 10, font = FONT_TEKS, padX = 10, padY = 4 }) {
  doc.fontSize(fontSize).font(font);
  const w = doc.widthOfString(teks) + padX * 2;
  const h = fontSize + padY * 2;
  doc.roundedRect(x, y, w, h, h / 2).fill(bg);
  doc.fillColor(warna).text(teks, x, y + padY - 0.5, { width: w, align: "center" });
  return w;
}

// Blob dekoratif — lingkaran besar transparan-lembut di pojok, meniru
// bentuk organik di referensi tanpa perlu SVG kompleks.
function gambarBlob(doc, pageWidth, pageHeight) {
  doc.save();
  doc.circle(-60, -40, 140).fillOpacity(0.6).fill(BLOB_WARNA);
  doc.circle(-50, pageHeight - 60, 110).fillOpacity(0.5).fill(BLOB_WARNA);
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

    // ── Latar halaman ────────────────────────────────────────────────────
    doc.rect(0, 0, pageWidth, pageHeight).fill(HALAMAN_BG);
    gambarBlob(doc, pageWidth, pageHeight);

    // ── Header: logo kiri, "INVOICE" kanan ───────────────────────────────
    let y = 44;
    const logoTinggi = 46;
    const logoLebar = logoTinggi * LOGO_ASPEK;
    try {
      doc.image(LOGO_PATH, MARGIN, y, { width: logoLebar, height: logoTinggi });
    } catch {
      // Aset logo hilang/rusak tidak boleh menggagalkan generate PDF.
    }
    doc.fontSize(32).font(FONT_JUDUL_XBOLD).fillColor(BIRU)
      .text("INVOICE", MARGIN, y + 4, { width: KONTEN_LEBAR, align: "right" });

    // Titik dekoratif kecil di bawah logo (meniru pola titik referensi).
    const dotY = y + logoTinggi + 14;
    for (let baris = 0; baris < 2; baris++) {
      for (let kolom = 0; kolom < 4; kolom++) {
        doc.circle(MARGIN + kolom * 12, dotY + baris * 10, 1.6).fill(TEAL);
      }
    }

    // Invoice No. + Tanggal — rata kanan, di bawah judul "INVOICE". Revisi
    // 2 Sep 2026: jarak ke judul "INVOICE" ditambah (dulu nyaris nempel,
    // owner minta lebih rapi) dan pil-nya dirapikan (padding vertikal &
    // penjajaran teks di dalam pil dihitung dari tinggi pil itu sendiri,
    // bukan angka tetap yang gampang meleset kalau ukuran font berubah).
    let yMeta = y + 56;
    doc.fontSize(9.5).font(FONT_TEKS).fillColor(ABU)
      .text("Invoice No.", MARGIN, yMeta + 3, { width: KONTEN_LEBAR - 130, align: "right" });
    pil(doc, MARGIN + KONTEN_LEBAR - 118, yMeta - 4, invoice.invoiceNumber, {
      bg: TEAL, warna: "#ffffff", fontSize: 9.5, font: FONT_TEKS,
    });
    yMeta += 28;
    doc.fontSize(9.5).font(FONT_TEKS).fillColor(ABU)
      .text("Tanggal", MARGIN, yMeta, { width: KONTEN_LEBAR - 130, align: "right" });
    doc.fontSize(11).font(FONT_TEKS).fillColor(GELAP)
      .text(formatTanggal(invoice.createdAt), MARGIN, yMeta - 1, { width: KONTEN_LEBAR, align: "right" });

    y = Math.max(dotY + 30, yMeta + 22);

    // ── Dua kartu: Diterbitkan Untuk / Metode Pembayaran ─────────────────
    const kartuGap = 16;
    const kartuW = (KONTEN_LEBAR - kartuGap) / 2;
    const kartuKiriX = MARGIN;
    const kartuKananX = MARGIN + kartuW + kartuGap;

    const namaTampil = invoice.namaTujuan || customer.nama || "-";
    const alamatLengkap = invoice.alamatTujuan
      || formatAlamat(`${order.deliveryAddress || "-"}${order.deliveryCity ? `, ${order.deliveryCity}` : ""}`);

    doc.fontSize(9).font(FONT_TEKS);
    const tinggiAlamatKartu = Math.min(
      doc.heightOfString(alamatLengkap, { width: kartuW - 30 }),
      doc.currentLineHeight() * 3
    );
    const kartuKiriTinggi = 78 + tinggiAlamatKartu;
    const kartuKananTinggi = 118;
    const kartuTinggi = Math.max(kartuKiriTinggi, kartuKananTinggi);

    doc.roundedRect(kartuKiriX, y, kartuW, kartuTinggi, 14).fill(KARTU_BG);
    doc.roundedRect(kartuKananX, y, kartuW, kartuTinggi, 14).fill(KARTU_BG);

    // Kartu kiri: Diterbitkan Untuk
    const padKartu = 16;
    badgeIkon(doc, kartuKiriX + padKartu + 12, y + padKartu + 12, 12, { bg: TEAL, ikon: IKON.user });
    doc.fontSize(9).font(FONT_JUDUL).fillColor(TEAL_GELAP)
      .text("DITERBITKAN UNTUK", kartuKiriX + padKartu + 32, y + padKartu + 6, { width: kartuW - padKartu * 2 - 32 });
    let yKartuKiri = y + padKartu + 30;
    doc.fontSize(11.5).font(FONT_JUDUL).fillColor(GELAP)
      .text(namaTampil, kartuKiriX + padKartu, yKartuKiri, { width: kartuW - padKartu * 2 });
    yKartuKiri += 16;
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU);
    const tinggiAlamatDipakai = tulisAlamatDibatasi(doc, alamatLengkap, kartuKiriX + padKartu, yKartuKiri, {
      width: kartuW - padKartu * 2, maxBaris: 3,
    });
    doc.text(customer.phone || "-", kartuKiriX + padKartu, yKartuKiri + tinggiAlamatDipakai + 3);

    // Kartu kanan: Metode Pembayaran
    badgeIkon(doc, kartuKananX + padKartu + 12, y + padKartu + 12, 12, { bg: TEAL, ikon: IKON.wallet });
    doc.fontSize(9).font(FONT_JUDUL).fillColor(TEAL_GELAP)
      .text("METODE PEMBAYARAN", kartuKananX + padKartu + 32, y + padKartu + 6, { width: kartuW - padKartu * 2 - 32 });
    let yKartuKanan = y + padKartu + 30;
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU).text("Transfer Bank", kartuKananX + padKartu, yKartuKanan);
    yKartuKanan += 14;
    doc.fontSize(11.5).font(FONT_JUDUL).fillColor(GELAP).text(`BANK ${PERUSAHAAN.bank.nama.toUpperCase()}`, kartuKananX + padKartu, yKartuKanan);
    yKartuKanan += 15;
    doc.fontSize(11).font(FONT_TEKS).fillColor(GELAP).text(PERUSAHAAN.bank.noRekening, kartuKananX + padKartu, yKartuKanan);
    yKartuKanan += 14;
    doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU).text(`a.n. ${PERUSAHAAN.bank.namaRekening}`, kartuKananX + padKartu, yKartuKanan, { width: kartuW - padKartu * 2 });

    y += kartuTinggi + 22;

    // ── Tabel item ───────────────────────────────────────────────────────
    // TABEL_PAD: jarak dari tepi bar biru ke kolom NO./TOTAL — sebelumnya
    // 0 (kolNoX = MARGIN persis, kolTotalX+kolTotalW = tepi kanan persis),
    // jadi kedua kolom itu nempel ke sudut membulat bar-nya, kelihatan
    // ga rata tengah/hampir keluar area (temuan visual owner). Kolom
    // lain (LAYANAN/QTY/HARGA SATUAN) sudah otomatis dapat jarak dari
    // hitungan gap antar-kolom, cuma NO. & TOTAL yang kena karena ada di
    // ujung.
    const TABEL_PAD = 14;
    const kolNoX = MARGIN + TABEL_PAD;
    const kolNoW = 30;
    const kolDeskX = kolNoX + kolNoW + 34; // + ruang ikon bulat
    const kolQtyW = 44;
    const kolHargaW = 92;
    const kolTotalW = 92;
    const kolTotalX = MARGIN + KONTEN_LEBAR - TABEL_PAD - kolTotalW;
    const kolHargaX = kolTotalX - kolHargaW - 12;
    const kolQtyX = kolHargaX - kolQtyW - 12;
    const kolDeskW = kolQtyX - kolDeskX - 12;

    const TINGGI_HEADER_TABEL = 30;
    doc.roundedRect(MARGIN, y, KONTEN_LEBAR, TINGGI_HEADER_TABEL, 10).fill(BIRU);
    doc.fontSize(9).font(FONT_JUDUL).fillColor("#ffffff");
    // Rata tengah VERTIKAL yang presisi (bukan angka tebakan) — posisi
    // teks = tengah bar dikurangi setengah tinggi barisnya sendiri, biar
    // label header selalu center persis di bar birunya berapa pun tinggi
    // barnya nanti berubah. Rata HORIZONTAL tiap kolom header SUDAH
    // dicocokkan dengan rata isian datanya (NO./QTY center, LAYANAN kiri,
    // HARGA SATUAN/TOTAL kanan — sama persis dengan baris item di bawahnya).
    const yHeaderTeks = y + (TINGGI_HEADER_TABEL - doc.currentLineHeight()) / 2;
    doc.text("NO.", kolNoX, yHeaderTeks, { width: kolNoW, align: "center" });
    doc.text("LAYANAN", kolDeskX, yHeaderTeks, { width: kolDeskW });
    doc.text("QTY", kolQtyX, yHeaderTeks, { width: kolQtyW, align: "center" });
    doc.text("HARGA SATUAN", kolHargaX, yHeaderTeks, { width: kolHargaW, align: "right" });
    doc.text("TOTAL", kolTotalX, yHeaderTeks, { width: kolTotalW, align: "right" });
    y += TINGGI_HEADER_TABEL + 8;

    const items = order.items || [];
    const TINGGI_BARIS_ITEM_MIN = 34;
    if (items.length === 0) {
      doc.fontSize(9.5).font(FONT_TEKS).fillColor(ABU)
        .text("Belum ada item layanan pada order ini.", kolDeskX, y + 8);
      y += TINGGI_BARIS_ITEM_MIN;
    }
    items.forEach((it, i) => {
      // Nama layanan panjang bisa bungkus 2+ baris (mis. paket gabungan
      // "Paket Upgrade Fondasi + Lapisan Matras Sehat") — tinggi baris
      // WAJIB ikut menyesuaikan, kalau tidak baris berikutnya (atau garis
      // pemisahnya) numpuk ke teks yang masih terpotong.
      doc.fontSize(10).font(FONT_TEKS_MED);
      const tinggiNama = doc.heightOfString(it.nama, { width: kolDeskW });
      const tinggiBarisIni = Math.max(TINGGI_BARIS_ITEM_MIN, tinggiNama + 16);
      badgeIkon(doc, kolNoX + kolNoW - 10 + 22, y + tinggiBarisIni / 2, 13, { bg: KARTU_BG, ikon: pilihIkonItem(it.nama), warnaIkon: TEAL_GELAP, ukuranIkon: 11 });
      doc.fontSize(9.5).font(FONT_TEKS).fillColor(GELAP).text(String(i + 1), kolNoX, y + 6, { width: kolNoW, align: "center" });
      doc.fontSize(10).font(FONT_TEKS_MED).fillColor(GELAP).text(it.nama, kolDeskX, y + 6, { width: kolDeskW });
      doc.fontSize(9.5).font(FONT_TEKS).fillColor(ABU).text("1", kolQtyX, y + 6, { width: kolQtyW, align: "center" });
      doc.font(FONT_TEKS_MED).fillColor(GELAP).text(formatRupiah(it.harga), kolHargaX, y + 6, { width: kolHargaW, align: "right" });
      doc.text(formatRupiah(it.harga), kolTotalX, y + 6, { width: kolTotalW, align: "right" });
      y += tinggiBarisIni;
      if (i < items.length - 1) {
        doc.moveTo(MARGIN, y).lineTo(MARGIN + KONTEN_LEBAR, y).strokeColor(GARIS).stroke();
        y += 1;
      }
    });
    y += 20;

    // ── Kartu "Syarat & Ketentuan" (kiri) + total & jatuh tempo (kanan) ──
    // Revisi 2 Sep 2026 (owner): kartu ini dulu isinya "Terima Kasih", tapi
    // dipindah — Syarat & Ketentuan yang sebelumnya cetakan kecil di
    // footer sekarang naik ke sini (lebih terlihat), dan "Terima Kasih"
    // pindah jadi teks polos di bawah kanan (lihat blok setelah ini).
    const bawahKiriW = kartuW;
    const bawahKananW = kartuW;
    const bawahKananX = kartuKananX;

    doc.fontSize(9).font(FONT_TEKS);
    const tinggiSyarat = doc.heightOfString(PERUSAHAAN.syaratKetentuan, { width: bawahKiriW - padKartu * 2 });
    const syaratTinggi = 44 + tinggiSyarat;

    doc.roundedRect(kartuKiriX, y, bawahKiriW, syaratTinggi, 14).fill(KARTU_BG);
    badgeIkon(doc, kartuKiriX + padKartu + 12, y + padKartu + 12, 12, { bg: BIRU_GELAP, ikon: IKON.dokumen });
    doc.fontSize(11).font(FONT_JUDUL).fillColor(GELAP)
      .text("SYARAT & KETENTUAN", kartuKiriX + padKartu + 32, y + padKartu + 8, { width: bawahKiriW - padKartu * 2 - 32 });
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU)
      .text(PERUSAHAAN.syaratKetentuan, kartuKiriX + padKartu, y + padKartu + 32, { width: bawahKiriW - padKartu * 2 });

    // Kartu kanan — rincian total.
    let yr = y + 6;
    function barisTotal(label, value, { bold = false, warna = GELAP } = {}) {
      doc.fontSize(bold ? 13 : 9.5)
        .font(bold ? FONT_JUDUL : FONT_TEKS)
        .fillColor(bold ? warna : ABU)
        .text(label, bawahKananX, yr, { width: bawahKananW * 0.5 });
      doc.font(bold ? FONT_JUDUL : FONT_TEKS).fillColor(warna)
        .text(value, bawahKananX, yr, { width: bawahKananW, align: "right" });
      yr += bold ? 22 : 18;
    }
    const subTotal = nominal.diskonPersen ? nominal.hargaSebelumDiskon : nominal.totalLayanan;
    barisTotal("Subtotal", formatRupiah(subTotal));
    barisTotal(
      nominal.diskonPersen ? `Diskon${nominal.promoCode ? ` (${nominal.promoCode})` : ""}` : "Diskon",
      nominal.diskonPersen ? `-${formatRupiah(nominal.nilaiDiskon)}` : "–"
    );
    if (nominal.ongkir > 0) barisTotal("Ongkir", formatRupiah(nominal.ongkir));
    doc.moveTo(bawahKananX, yr + 3).lineTo(bawahKananX + bawahKananW, yr + 3).dash(2, { space: 2 }).strokeColor(GARIS).stroke();
    doc.undash();
    yr += 12;
    barisTotal("TOTAL", formatRupiah(nominal.totalTagihan), { bold: true, warna: BIRU });

    if (nominal.dibayar > 0 || nominal.dibayarTidakRinci) {
      barisTotal("Sudah dibayar", nominal.dibayarTidakRinci ? "—" : formatRupiah(nominal.dibayar), { warna: "#16a34a" });
      barisTotal("Sisa tagihan", nominal.dibayarTidakRinci ? "—" : formatRupiah(nominal.sisa), {
        bold: true, warna: nominal.sisa > 0 ? "#dc2626" : "#16a34a",
      });
    }

    // Badge jatuh tempo — CUMA muncul kalau invoice.dueDate memang diisi
    // (jangan mengarang tanggal kalau belum ditentukan sales/admin).
    if (invoice.dueDate) {
      yr += 6;
      const teksBadge = `Bayar sebelum ${formatTanggal(invoice.dueDate)}`;
      doc.fontSize(9).font(FONT_TEKS);
      const lebarBadge = Math.min(doc.widthOfString(teksBadge) + 56, bawahKananW);
      doc.roundedRect(bawahKananX + bawahKananW - lebarBadge, yr, lebarBadge, 30, 15).fill(BIRU_GELAP);
      doc.fontSize(11).font(FONT_IKON).fillColor(TEAL)
        .text(IKON.jam, bawahKananX + bawahKananW - lebarBadge + 14, yr + 9, { width: 16 });
      doc.fontSize(9).font(FONT_TEKS).fillColor("#ffffff")
        .text(teksBadge, bawahKananX + bawahKananW - lebarBadge + 34, yr + 10, { width: lebarBadge - 44 });
      yr += 30;
    }

    // ── Terima kasih — teks polos rata kanan di bawah rincian total
    // (revisi 2 Sep 2026: dulu kartu terpisah di kiri + tanda tangan
    // tulisan tangan terpisah lagi di kanan — sekarang digabung jadi SATU
    // ucapan saja, di bawah kanan). Kalimat body TIDAK mengulang "Terima
    // kasih" (sudah ada di judulnya) dan tagline "Ahlinya Kasur Sehat"
    // (CLAUDE.md §16.7) berdiri sendiri sebagai baris penutup — revisi
    // wording eksplisit dari owner 2 Sep 2026.
    const teksTerimaKasih = "telah mempercayakan tidur sehat Anda kepada Klinik Matras.";
    yr += 14;
    doc.fontSize(11).font(FONT_JUDUL).fillColor(GELAP)
      .text("Terima kasih!", bawahKananX, yr, { width: bawahKananW, align: "right" });
    yr += 16;
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU)
      .text(teksTerimaKasih, bawahKananX, yr, { width: bawahKananW, align: "right" });
    yr += doc.heightOfString(teksTerimaKasih, { width: bawahKananW }) + 6;
    doc.fontSize(9.5).font(FONT_JUDUL).fillColor(TEAL_GELAP)
      .text("Ahlinya Kasur Sehat", bawahKananX, yr, { width: bawahKananW, align: "right" });
    yr += 16;

    y += Math.max(syaratTinggi, yr - y) + 22;

    // ── Kartu "Butuh bantuan" — PALING BAWAH/PALING AKHIR (revisi 2 Sep
    // 2026), dan SENGAJA ditambatkan ke tepi bawah halaman (bukan cuma
    // "setelah konten di atasnya" seperti section lain) — kalau ditaruh
    // langsung setelah konten, sisa ruang kosong di bawahnya kelihatan
    // percuma untuk invoice pendek (owner menandai ini di screenshot).
    // Kalau kontennya panjang sampai lewat titik tambat, jatuh balik ke
    // "setelah konten" biar tidak tabrakan ke atas.
    const bantuanTinggi = 90;
    const BATAS_BAWAH_HALAMAN = 40;
    y = Math.max(y, pageHeight - BATAS_BAWAH_HALAMAN - bantuanTinggi);
    doc.roundedRect(kartuKiriX, y, KONTEN_LEBAR, bantuanTinggi, 14).fill(KARTU_BG);
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

    doc.end();
  });
}
