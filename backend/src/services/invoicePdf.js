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

import {
  bukaDokumenPdf, gambarLatarHalaman, buatPindahHalaman, gambarHeaderDokumen, gambarHeaderTabel as gambarBarTabel, gambarKartuJudul, gambarFooterBantuan,
  badgeIkon, FONT_TEKS, FONT_TEKS_MED, FONT_JUDUL, FONT_IKON, IKON, BIRU, BIRU_GELAP, TEAL, TEAL_GELAP, KARTU_BG, ABU, GARIS, GELAP,
  PERUSAHAAN, formatRupiah, formatTanggal, formatTanggalPendek, tulisAlamatDibatasi,
} from "./documentPdf.js";
import { formatAlamat } from "../utils/formatAlamat.js";

// Komponen tampilan (font, warna, logo, ikon, header, bar tabel, kartu, footer bantuan, helper) dipindahkan ke documentPdf.js agar Purchase Order memakai sistem
// dokumen yang SAMA. Re-export di bawah menjaga impor lama (warrantyPdf.js) tetap jalan. Tampilan invoice dikunci tes snapshot (tests/invoicePdfSnapshot.test.js).
export { IKON, FONT_IKON, FONT_IKON_PATH, badgeIkon, pil } from "./documentPdf.js";

// Teks khusus invoice (syarat & ketentuan) — identitas perusahaan dan rekening ada di PERUSAHAAN (documentPdf.js).
const SYARAT = {
  syaratKetentuan:
    "Harga sudah termasuk biaya antar-jemput (Free Delivery). Tidak ada pembayaran di muka. " +
    "Pembayaran lunas dilakukan saat serah terima barang di lokasi pelanggan (COD/Transfer saat " +
    "barang sampai). Harap periksa kondisi barang sebelum melakukan pembayaran.",
  // Invoice DP (6 Okt 2026): kalimat "Tidak ada pembayaran di muka" di atas BERTENTANGAN dengan dokumen yang justru menagih DP. Teks ini dipakai
  // HANYA saat nominal.modeDP. Redaksi final = keputusan Owner; kalimat pelunasan saat serah terima dipertahankan dari teks aslinya.
  syaratKetentuanDP:
    "Harga sudah termasuk biaya antar-jemput (Free Delivery). DP dibayarkan sebesar Tagihan DP pada invoice ini; " +
    "sisa pembayaran dilunasi saat serah terima barang di lokasi pelanggan (COD/Transfer saat barang sampai). " +
    "Harap periksa kondisi barang sebelum melakukan pembayaran.",
};

const teksSyarat = (nominal) => (nominal?.modeDP ? SYARAT.syaratKetentuanDP : SYARAT.syaratKetentuan);

const PAYMENT_METHOD_LABEL = { CASH: "Tunai", TRANSFER: "Transfer", QRIS: "QRIS", CARD: "Kartu" };

// Heuristik ikon per item — lihat catatan lisensi/keputusan di kepala file.
function pilihIkonItem(nama = "") {
  const n = nama.toLowerCase();
  if (/fondasi|per\b|pegas|frame|struktur|rangka/.test(n)) return IKON.wrench;
  if (/busa|lapisan|layer/.test(n)) return IKON.layerGroup;
  if (/kain|cover|sarung|fabric/.test(n)) return IKON.shirt;
  if (/sanitasi|cuci|bersih|vakum|steam/.test(n)) return IKON.droplet;
  return IKON.gear;
}

/**
 * @param {Awaited<ReturnType<import("./invoice.js").buildInvoiceView>>} view
 * @returns {Promise<Buffer>}
 */
export function renderInvoicePdf(view) {
  return new Promise((resolve, reject) => {
    const { invoice, order, orders, items: itemsGabungan, customer, nominal, payments } = view;
    const { doc, selesai, g } = bukaDokumenPdf();
    selesai.then(resolve, reject);
    const { pageHeight, MARGIN, KONTEN_LEBAR, BATAS_BAWAH_HALAMAN, kartuW, kartuKiriX, kartuKananX, padKartu } = g;

    // ── Latar halaman ────────────────────────────────────────────────────
    gambarLatarHalaman(doc, g);

    // Pindah halaman (multi-halaman untuk order B2B/hotel banyak item): halaman lanjutan hanya mengulang nomor invoice kecil sebagai penanda.
    const mulaiHalamanBaru = buatPindahHalaman(doc, g, invoice.invoiceNumber);

    // ── Header: logo kiri, "INVOICE" kanan (komponen bersama) ─────────────
    // Invoice gabungan lintas-order: baris tambahan hanya muncul bila orders.length > 1 (order tunggal: tata letak identik).
    let y = gambarHeaderDokumen(doc, g, {
      judul: "INVOICE", labelNomor: "Invoice No.", nomor: invoice.invoiceNumber, tanggal: invoice.createdAt,
      barisTambahan: orders.length > 1 ? `Order: ${orders.map((o) => o.orderNumber).join(", ")}` : null,
    });

    // ── Dua kartu: Diterbitkan Untuk / Metode Pembayaran ─────────────────
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
    // Dipakai lagi di tiap halaman lanjutan saat tabel item meluber (kolom tetap ada di tiap halaman).
    function gambarHeaderTabel(yMulai) {
      return gambarBarTabel(doc, g, yMulai, [
        { label: "NO.", x: kolNoX, w: kolNoW, align: "center" },
        { label: "LAYANAN", x: kolDeskX, w: kolDeskW },
        { label: "QTY", x: kolQtyX, w: kolQtyW, align: "center" },
        { label: "HARGA SATUAN", x: kolHargaX, w: kolHargaW, align: "right" },
        { label: "TOTAL", x: kolTotalX, w: kolTotalW, align: "right" },
      ]);
    }
    y = gambarHeaderTabel(y);

    // items: view.items (top-level, sudah di-flatten & di-tag orderNumber
    // oleh services/invoice.js) — utk order tunggal isinya sama persis
    // dengan order.items dulu, cuma sekarang lewat 1 field yang juga jalan
    // ketika invoice-nya gabungan (lihat buildCombinedInvoiceView).
    const items = itemsGabungan || order.items || [];
    const banyakOrder = orders.length > 1;
    const TINGGI_BARIS_ITEM_MIN = 34;
    // Ukuran kasur (teks tampil bersama: "160 × 200 cm" / "145 × 205 cm (Custom)" / "Ukuran Custom (ukuran belum diisi)") — SATU baris per order,
    // di bawah item pertama order itu (invoice gabungan bisa berisi ukuran berbeda per order). Tinggi baris menyesuaikan sehingga layout tidak bergeser.
    const kunciOrder = (o) => o?.orderNumber || "_";
    const ukuranPerOrder = new Map((orders && orders.length ? orders : [order]).map((o) => [kunciOrder(o), o?.ukuranKasur || ""]));
    const sudahTampilUkuran = new Set();
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
      // Label kecil asal order (cuma kalau invoice ini gabungan >1 order)
      // butuh sedikit ruang tambahan di bawah nama item.
      const kunci = kunciOrder(it);
      const teksUkuran = !sudahTampilUkuran.has(kunci) ? (ukuranPerOrder.get(kunci) || "") : "";
      sudahTampilUkuran.add(kunci);
      const barisUkuran = teksUkuran ? `Ukuran: ${teksUkuran}` : "";
      doc.fontSize(8).font(FONT_TEKS);
      const tinggiUkuran = barisUkuran ? doc.heightOfString(barisUkuran, { width: kolDeskW }) + 2 : 0;
      doc.fontSize(10).font(FONT_TEKS_MED);
      const tinggiBarisIni = Math.max(TINGGI_BARIS_ITEM_MIN, tinggiNama + (banyakOrder ? 26 : 16) + tinggiUkuran);

      // Pindah halaman kalau baris ini tidak muat lagi — dicek SEBELUM
      // digambar (bukan sesudah), supaya tidak ada baris yang badannya
      // terbelah antar 2 halaman. Header tabel biru digambar ulang di
      // halaman baru supaya kolomnya tetap kelihatan di tiap halaman.
      if (y + tinggiBarisIni > pageHeight - BATAS_BAWAH_HALAMAN) {
        y = mulaiHalamanBaru();
        y = gambarHeaderTabel(y);
      }

      badgeIkon(doc, kolNoX + kolNoW - 10 + 22, y + tinggiBarisIni / 2, 13, { bg: KARTU_BG, ikon: pilihIkonItem(it.nama), warnaIkon: TEAL_GELAP, ukuranIkon: 11 });
      doc.fontSize(9.5).font(FONT_TEKS).fillColor(GELAP).text(String(i + 1), kolNoX, y + 6, { width: kolNoW, align: "center" });
      doc.fontSize(10).font(FONT_TEKS_MED).fillColor(GELAP).text(it.nama, kolDeskX, y + 6, { width: kolDeskW });
      if (banyakOrder && it.orderNumber) {
        doc.fontSize(7.5).font(FONT_TEKS).fillColor(ABU)
          .text(`· ${it.orderNumber}`, kolDeskX, y + 6 + tinggiNama + 2, { width: kolDeskW });
      }
      if (barisUkuran) {
        doc.fontSize(8).font(FONT_TEKS).fillColor(ABU)
          .text(barisUkuran, kolDeskX, y + 6 + tinggiNama + (banyakOrder && it.orderNumber ? 13 : 3), { width: kolDeskW });
      }
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
    const tinggiSyarat = doc.heightOfString(teksSyarat(nominal), { width: bawahKiriW - padKartu * 2 });
    const syaratTinggi = 44 + tinggiSyarat;

    // Perkiraan tinggi blok KANAN (rincian total) — cuma dipakai utk
    // keputusan pindah halaman di bawah ini, BUKAN tata letak sungguhan
    // (itu tetap dihitung persis oleh barisTotal() dkk). Sengaja dilebihkan
    // (bukan pas-pasan) supaya tidak ada kasus konten kepotong di ujung
    // halaman kalau perkiraannya sedikit meleset.
    let estimasiKananTinggi = 18 * 2 + 22 + 12; // subtotal + diskon + TOTAL(bold) + garis putus
    if (nominal.ongkir > 0) estimasiKananTinggi += 18;
    if (nominal.modeDP) {
      estimasiKananTinggi += 18 * 2 + 18; // sudah dibayar? + Sisa DP + info total order
    } else {
      if (nominal.dibayar > 0 || nominal.dibayarTidakRinci) estimasiKananTinggi += 18 * 2;
      if (nominal.dpTarget > 0 && nominal.sumber === "ledger" && !nominal.bisaDP) estimasiKananTinggi += 18;
    }
    if (payments && payments.length > 1) estimasiKananTinggi += 19 + payments.length * 13;
    if (invoice.dueDate) estimasiKananTinggi += 36;
    estimasiKananTinggi += 16 + 9 + 6 + 16 + 20; // blok "Terima kasih!" + margin aman

    if (y + Math.max(syaratTinggi, estimasiKananTinggi) > pageHeight - BATAS_BAWAH_HALAMAN) {
      y = mulaiHalamanBaru();
    }

    doc.roundedRect(kartuKiriX, y, bawahKiriW, syaratTinggi, 14).fill(KARTU_BG);
    badgeIkon(doc, kartuKiriX + padKartu + 12, y + padKartu + 12, 12, { bg: BIRU_GELAP, ikon: IKON.dokumen });
    doc.fontSize(11).font(FONT_JUDUL).fillColor(GELAP)
      .text("SYARAT & KETENTUAN", kartuKiriX + padKartu + 32, y + padKartu + 8, { width: bawahKiriW - padKartu * 2 - 32 });
    doc.fontSize(9).font(FONT_TEKS).fillColor(ABU)
      .text(teksSyarat(nominal), kartuKiriX + padKartu, y + padKartu + 32, { width: bawahKiriW - padKartu * 2 });

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
    if (nominal.modeDP) {
      // Tagihan DP (16 September 2026, laporan owner: "customer kadang
      // mau invoice DP dulu") — SEBELUMNYA headline SELALU nilai order
      // PENUH walau baru fase DP, dpTarget cuma catatan kecil di bawah.
      // Sekarang selama dibayar BELUM mencapai dpTarget (nominal.modeDP,
      // lihat services/invoice.js), headline berganti jadi nominal DP yang
      // SUNGGUH diminta ke customer saat ini — bukan total order yang
      // belum relevan ditagih penuh. Rincian layanan di atas TETAP tampil
      // apa adanya (tidak diringkas), + baris info "Total keseluruhan
      // order" di bawah supaya customer tetap lihat konteks lengkap.
      barisTotal("Tagihan DP", formatRupiah(nominal.dpTarget), { bold: true, warna: BIRU });
      if (nominal.dibayar > 0) {
        barisTotal("Sudah dibayar", formatRupiah(nominal.dibayar), { warna: "#16a34a" });
      }
      barisTotal("Sisa DP", formatRupiah(nominal.dpKurang), { bold: true, warna: "#dc2626" });
      yr += 4;
      doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU)
        .text(`Total keseluruhan order: ${formatRupiah(nominal.totalTagihan)}`, bawahKananX, yr, { width: bawahKananW, align: "right" });
      yr += 14;
    } else {
      barisTotal("TOTAL", formatRupiah(nominal.totalTagihan), { bold: true, warna: BIRU });

      if (nominal.dibayar > 0 || nominal.dibayarTidakRinci) {
        barisTotal("Sudah dibayar", nominal.dibayarTidakRinci ? "—" : formatRupiah(nominal.dibayar), { warna: "#16a34a" });
        barisTotal("Sisa tagihan", nominal.dibayarTidakRinci ? "—" : formatRupiah(nominal.sisa), {
          bold: true, warna: nominal.sisa > 0 ? "#dc2626" : "#16a34a",
        });
      }

      // DP disepakati (2 Sep 2026) — hanya tersisa jalur "terpenuhi" sejak
      // modeDP ada (kasus "kurang" sekarang jadi headline di atas, bukan
      // di sini lagi) — MURNI catatan riwayat bahwa DP sudah dipenuhi,
      // cuma tampil kalau ledger-nya ada.
      if (nominal.dpTarget > 0 && nominal.sumber === "ledger" && !nominal.bisaDP) {
        yr += 4;
        doc.fontSize(8.5).font(FONT_TEKS).fillColor("#16a34a")
          .text(`DP disepakati ${formatRupiah(nominal.dpTarget)} — terpenuhi`, bawahKananX, yr, { width: bawahKananW, align: "right" });
        yr += 14;
      }
    }

    // Riwayat Pembayaran per transaksi (2 Sep 2026) — cuma kalau lebih dari
    // 1 pembayaran (DP lalu pelunasan, dst); 1 pembayaran saja sudah cukup
    // terwakili baris "Sudah dibayar" di atas, tidak perlu diulang.
    if (payments && payments.length > 1) {
      yr += 6;
      doc.fontSize(8).font(FONT_JUDUL).fillColor(ABU)
        .text("RIWAYAT PEMBAYARAN", bawahKananX, yr, { width: bawahKananW, align: "right" });
      yr += 13;
      for (const p of payments) {
        doc.fontSize(8.5).font(FONT_TEKS).fillColor(ABU)
          .text(`${formatTanggalPendek(p.createdAt)} · ${PAYMENT_METHOD_LABEL[p.method] || p.method}`, bawahKananX, yr, { width: bawahKananW * 0.6 });
        doc.font(FONT_TEKS_MED).fillColor(GELAP)
          .text(formatRupiah(p.amount), bawahKananX, yr, { width: bawahKananW, align: "right" });
        yr += 13;
      }
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
    gambarFooterBantuan(doc, g, { y, mulaiHalamanBaru });

    doc.end();
  });
}
