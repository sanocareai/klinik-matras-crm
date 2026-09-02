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
import { formatAlamat } from "../utils/formatAlamat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Wordmark versi PUTIH (ikon + "KLINIK MATRAS" + pil "SANOCARE" — teksnya
// putih/teal, didesain khusus untuk ditaruh LANGSUNG di atas latar berwarna),
// dikirim owner 2 Sep 2026 (revisi ke-2, file asli:
// frontend/public/sano_logo_invoice/klinikmatras-logo.png, di-trim
// whitespace-nya dengan sharp — lihat riwayat git). Dipakai langsung tanpa
// plat putih di belakangnya (revisi sebelumnya pakai plat + versi biru —
// owner bilang itu kurang minimalis). Rasio aspek gambar ini ~3.07:1.
const LOGO_PATH = path.join(__dirname, "../../assets/logo-invoice-white.png");
const LOGO_ASPEK = 1200 / 391;

// Font kustom (2 Sep 2026, permintaan owner) — Questrial untuk teks isi
// (body, label, angka), Bebas Neue untuk judul/heading yang menonjol (mis.
// kata "INVOICE"). Keduanya Google Fonts open source (lisensi OFL, file
// diunduh dari repo resmi google/fonts), dan CUMA SATU BERAT masing-masing
// (tidak ada varian Bold) — penekanan visual di dokumen ini sengaja
// mengandalkan ukuran & warna, bukan ketebalan huruf.
const FONT_TEKS = "Questrial";
const FONT_JUDUL = "BebasNeue";
const FONT_TEKS_PATH = path.join(__dirname, "../../assets/fonts/Questrial-Regular.ttf");
const FONT_JUDUL_PATH = path.join(__dirname, "../../assets/fonts/BebasNeue-Regular.ttf");

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

// Alamat customer/kantor kadang sangat panjang (2 Sep 2026: ditemukan alamat
// nyata sampai 3 baris dengan catatan patokan lokasi) — dibatasi maksimal
// N baris + "…" di baris terakhir, BUKAN dibiarkan mendorong seluruh layout
// ke bawah tanpa batas.
//
// SENGAJA susun baris SENDIRI kata-per-kata pakai widthOfString() (bukan
// opsi `height`+`ellipsis` bawaan pdfkit, dan bukan juga mundur berdasarkan
// heightOfString total) — dua pendekatan itu sudah dicoba dan hasilnya
// konsisten memotong SATU BARIS lebih awal dari yang diminta (minta 3 baris,
// yang tampil cuma 2), karena menambah "…" di akhir teks yang nyaris pas
// bisa mendorongnya meluap ke baris tambahan, lalu seluruh perhitungan
// mundur ikut kepotong berlebihan. Menyusun baris manual & cuma
// mempersingkat BARIS TERAKHIR itu presisi per-baris, bukan tebak-tebakan
// tinggi total.
function tulisAlamatDibatasi(doc, teks, x, y, { width, maxBaris, align }) {
  const tinggiBaris = doc.currentLineHeight();
  // Margin aman 3pt: widthOfString() dipakai untuk MENYUSUN baris manual di
  // sini, tapi doc.text() sendiri (yang benar-benar merender) punya
  // pembulatan/kerning yang kadang menilai baris yang SAMA sebagai "tidak
  // muat" lalu memaksanya bungkus ke baris tambahan — ditemukan nyata
  // (kata terakhir kepental sendiri ke baris baru, mendorong seluruh baris
  // di bawahnya, sampai numpuk dengan nomor telepon). Longgarkan ambang
  // pas menyusun supaya tidak pernah pas-pasan di tepi lebar kolom.
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
      if (barisArr.length === maxBaris) break; // baris penuh, sisa kata dibuang/dipotong di bawah
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

  // width EKSTRA LEBAR di sini (bukan `width` asli) — baris sudah pasti
  // muat (dites pakai lebarAman di atas), tapi pdfkit tetap butuh angka
  // lebar untuk urusan align:"right"; kalau dikasih persis `width`, risiko
  // pembulatan yang sama seperti di atas bisa kambuh saat render sungguhan.
  doc.text(barisArr.join("\n"), x, y, { width: width + 3, ...(align && { align }) });
  return tinggiBaris * barisArr.length;
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

    doc.registerFont(FONT_TEKS, FONT_TEKS_PATH);
    doc.registerFont(FONT_JUDUL, FONT_JUDUL_PATH);
    doc.font(FONT_TEKS); // default dokumen — dipakai kalau ada .text() yang lupa set font eksplisit

    const pageWidth = doc.page.width; // 595.28
    const pageHeight = doc.page.height; // 841.89
    const MARGIN = 40;
    const KONTEN_LEBAR = pageWidth - MARGIN * 2;

    // ── Header: banner biru dengan logo + info kontak ───────────────────
    const HEADER_TINGGI = 118;
    doc.rect(0, 0, pageWidth, HEADER_TINGGI).fill(BIRU);

    // Wordmark versi putih ditaruh LANGSUNG di atas banner biru — TANPA plat
    // putih di belakangnya (revisi 2 Sep 2026: versi sebelumnya kelihatan
    // terlalu besar/berat karena ada kotak putih besar; versi logo ini sudah
    // didesain putih supaya kontras sendiri di atas warna, jadi minimalis).
    const logoTinggi = 32;
    const logoLebar = logoTinggi * LOGO_ASPEK;
    const logoX = MARGIN;
    const logoY = (HEADER_TINGGI - logoTinggi) / 2;
    try {
      doc.image(LOGO_PATH, logoX, logoY, { width: logoLebar, height: logoTinggi });
    } catch {
      // Kalau file logo tidak ada/rusak, invoice tetap jalan tanpa logo —
      // jangan sampai satu aset hilang menggagalkan seluruh generate PDF.
    }

    // Info kontak — rata kanan, ALAMAT dulu baru WA (revisi 2 Sep 2026: baris
    // "Telp: ..." dihapus, nomor telepon & WA memang sama jadi cuma perlu 1
    // baris; alamat kantor dipindah ke atas supaya yang paling identitatif
    // dibaca duluan, bukan angka).
    const kontakLebar = 260;
    const kontakX = pageWidth - MARGIN - kontakLebar;
    doc.fontSize(8.5).font(FONT_TEKS).fillColor("#ffffff");
    const ALAMAT_HEADER_MAKS_BARIS = 2;
    const tinggiAlamatHeader = doc.currentLineHeight() * ALAMAT_HEADER_MAKS_BARIS;
    let yKontak = (HEADER_TINGGI - (tinggiAlamatHeader + 12 + 11)) / 2;
    tulisAlamatDibatasi(doc, PERUSAHAAN.alamat, kontakX, yKontak, {
      width: kontakLebar, maxBaris: ALAMAT_HEADER_MAKS_BARIS, align: "right",
    });
    yKontak += tinggiAlamatHeader + 6;
    doc.text(`WA: ${PERUSAHAAN.whatsapp}`, kontakX, yKontak, { width: kontakLebar, align: "right" });
    yKontak += 13;
    doc.fillColor(TEAL_MUDA).text(PERUSAHAAN.website, kontakX, yKontak, { width: kontakLebar, align: "right" });

    // ── Invoice To / Invoice meta ────────────────────────────────────────
    let y = HEADER_TINGGI + 30;
    // `invoice.alamatTujuan` = override manual sales (2 Sep 2026, lihat
    // schema.prisma) — kalau diisi, PAKAI APA ADANYA (sales sudah sengaja
    // menuliskannya rapi), jangan diproses formatAlamat() lagi. Kalau kosong,
    // pakai alamat order tapi DIRAPIKAN dulu (huruf kecil semua/singkatan
    // nempel angka dsb — lihat utils/formatAlamat.js) — bukan mengubah data
    // order, cuma cara menampilkannya di invoice.
    const alamatLengkap = invoice.alamatTujuan
      || formatAlamat(`${order.deliveryAddress || "-"}${order.deliveryCity ? `, ${order.deliveryCity}` : ""}`);
    const ALAMAT_LEBAR = 260;
    const ALAMAT_MAKS_BARIS = 3;

    const namaTampil = invoice.namaTujuan || customer.nama || "-";
    doc.fontSize(9).fillColor(ABU).font(FONT_JUDUL).text("INVOICE TO:", MARGIN, y);
    doc.fontSize(13).fillColor(GELAP).font(FONT_JUDUL).text(namaTampil.toUpperCase(), MARGIN, y + 14);
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU);
    const tinggiAlamat = tulisAlamatDibatasi(doc, alamatLengkap, MARGIN, y + 32, {
      width: ALAMAT_LEBAR, maxBaris: ALAMAT_MAKS_BARIS,
    });
    doc.text(customer.phone || "-", MARGIN, y + 32 + tinggiAlamat + 4);

    doc.fontSize(24).fillColor(BIRU).font(FONT_JUDUL).text("INVOICE", MARGIN, y - 3, { width: KONTEN_LEBAR, align: "right" });
    doc.fontSize(9).fillColor(ABU).font(FONT_TEKS)
      .text(`Invoice No: ${invoice.invoiceNumber}`, MARGIN, y + 26, { width: KONTEN_LEBAR, align: "right" })
      .text(`Invoice Date: ${formatTanggal(invoice.createdAt)}`, MARGIN, y + 40, { width: KONTEN_LEBAR, align: "right" });

    // Blok kanan (INVOICE/nomor/tanggal) tingginya tetap (~54pt dari y), tapi
    // blok kiri (nama+alamat+telp) bisa lebih tinggi kalau alamat panjang
    // (alamat pengiriman customer nyata sering 2-3 baris, BUKAN kasus tepi) —
    // tabel item harus mulai di bawah blok yang LEBIH TINGGI, jangan asumsikan
    // tinggi tetap seperti sebelumnya (itu yang menyebabkan alamat panjang
    // bertabrakan dengan baris telepon).
    const tinggiBlokKiri = 32 + tinggiAlamat + 4 + 12;
    y += Math.max(tinggiBlokKiri, 54) + 26;

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
    doc.fontSize(9.5).font(FONT_JUDUL).fillColor("#ffffff");
    doc.text("NO.", kolNo, y + 7, { width: kolNoLebar, align: "center" });
    doc.text("ITEM DESCRIPTION", kolDesk + 6, y + 7, { width: kolDeskLebar - 6 });
    doc.text("PRICE", kolHarga, y + 7, { width: kolHargaLebar - 6, align: "right" });
    doc.text("QTY", kolQty, y + 7, { width: kolQtyLebar, align: "center" });
    doc.text("TOTAL", kolTotal, y + 7, { width: kolTotalLebar - 6, align: "right" });
    y += TINGGI_HEADER_TABEL;

    const items = order.items || [];
    const jumlahBaris = Math.max(items.length, MIN_BARIS_TABEL);
    for (let i = 0; i < jumlahBaris; i++) {
      const it = items[i];
      if (i % 2 === 1) doc.rect(MARGIN, y, KONTEN_LEBAR, TINGGI_BARIS).fill(TEAL_MUDA);
      if (it) {
        doc.fontSize(9).font(FONT_TEKS).fillColor(GELAP);
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

    // ── Kolom kiri (Payment Method + Terms & Conditions) dipisah garis
    // vertikal dari kolom kanan (rincian total) — revisi 2 Sep 2026 supaya
    // footer terlihat lebih terstruktur (dua kolom jelas), bukan teks lepas
    // di seluruh lebar halaman. Terms & Conditions karena itu SEKARANG ikut
    // lebar kolom kiri, bukan lebar penuh halaman seperti sebelumnya.
    const kolKiriLebar = 260;
    const kolKananX = MARGIN + kolKiriLebar + 20;
    const kolKananLebar = KONTEN_LEBAR - kolKiriLebar - 20;
    const GARIS_PEMISAH_X = kolKananX - 10;
    const yAwalBawah = y;

    // Kolom kiri: Payment Method lalu Terms & Conditions, ditulis berurutan
    // dalam SATU alur y supaya tidak overlap kalau salah satu memanjang.
    let yKiri = yAwalBawah;
    doc.fontSize(11).font(FONT_JUDUL).fillColor(BIRU).text("PAYMENT METHOD", MARGIN, yKiri);
    yKiri += 16;
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU).text("No. Rekening:", MARGIN, yKiri);
    yKiri += 13;
    doc.fontSize(10).font(FONT_TEKS).fillColor(GELAP).text(`${PERUSAHAAN.bank.nama} ${PERUSAHAAN.bank.noRekening}`, MARGIN, yKiri);
    yKiri += 15;
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU).text(`Nama Rekening: ${PERUSAHAAN.bank.namaRekening}`, MARGIN, yKiri, { width: kolKiriLebar });
    yKiri += 30;

    doc.fontSize(11).font(FONT_JUDUL).fillColor(BIRU).text("TERMS & CONDITIONS", MARGIN, yKiri);
    yKiri += 16;
    doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU);
    const BULLET_INDENT = 12;
    for (const butir of PERUSAHAAN.syaratKetentuan) {
      doc.text("•", MARGIN, yKiri, { width: BULLET_INDENT });
      doc.text(butir, MARGIN + BULLET_INDENT, yKiri, { width: kolKiriLebar - BULLET_INDENT });
      yKiri += doc.heightOfString(butir, { width: kolKiriLebar - BULLET_INDENT }) + 6;
    }

    // Kolom kanan: rincian nominal.
    let yr = yAwalBawah;
    function barisTotal(label, value, { bold = false, warna = GELAP } = {}) {
      doc.fontSize(bold ? 12 : 9.5)
        .font(bold ? FONT_JUDUL : FONT_TEKS)
        .fillColor(bold ? warna : ABU)
        .text(label, kolKananX, yr, { width: kolKananLebar * 0.55 });
      doc.font(bold ? FONT_JUDUL : FONT_TEKS).fillColor(warna)
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

    // Garis pemisah vertikal antar-kolom — tinggi mengikuti kolom yang lebih
    // panjang (biasanya kiri, karena Terms & Conditions selalu ada di sana).
    const yAkhirBawah = Math.max(yKiri, yr);
    doc.moveTo(GARIS_PEMISAH_X, yAwalBawah).lineTo(GARIS_PEMISAH_X, yAkhirBawah - 6).strokeColor(GARIS).stroke();

    y = yAkhirBawah + 14;

    if (invoice.notes) {
      doc.fontSize(10).fillColor(ABU).font(FONT_JUDUL).text("CATATAN", MARGIN, y);
      doc.fontSize(9).fillColor(GELAP).font(FONT_TEKS).text(invoice.notes, MARGIN, y + 13, { width: KONTEN_LEBAR - 100 });
    }

    // ── Wave dekoratif footer ────────────────────────────────────────────
    gambarWaveFooter(doc, pageWidth, pageHeight);
    doc.fontSize(8).fillColor("#ffffff").font(FONT_TEKS)
      .text("Terima kasih telah mempercayakan tidur sehat Anda kepada Klinik Matras.", MARGIN, pageHeight - 30, {
        width: KONTEN_LEBAR, align: "center",
      });

    doc.end();
  });
}
