// ─── PDF INVOICE — server-side (31 Agustus 2026) ───────────────────────────
// Pakai `pdfkit` (layout PDF murni JS), BUKAN Puppeteer/Playwright — VPS ini
// kecil (Sumopod, target biaya <Rp300rb/bulan, lihat CLAUDE.md §2) dan
// headless Chromium butuh ratusan MB disk + RAM per render. pdfkit generate
// langsung di proses Node yang sudah jalan, tanpa browser tambahan sama
// sekali — cocok untuk dokumen terstruktur seperti invoice (bukan render
// halaman web kompleks yang memang butuh browser).
//
// SATU aturan penting: file ini CUMA TATA LETAK. Semua ANGKA & TEKSnya
// datang dari `buildInvoiceView()` (services/invoice.js) — tidak ada
// hitungan uang di sini sama sekali. Kalau invoice PDF dan invoice di layar
// pernah beda angka, itu artinya ada yang menghitung ulang di salah satu
// tempat — jangan biarkan itu terjadi.

import PDFDocument from "pdfkit";

const AKSEN = "#2f6fed";
const ABU = "#6b7280";
const GARIS = "#e5e7eb";

// Backend TIDAK punya formatter Rupiah/tanggal bersama (frontend punya versi
// sendiri, tapi tidak bisa di-import lintas paket) — dua fungsi kecil ini
// pola yang SAMA dengan formatRpWa()/formatTanggalOrder() lokal di
// routes/orders.js (ringkasan WA order), bukan util baru yang tersebar.
function formatRupiah(n) {
  return `Rp${(n || 0).toLocaleString("id-ID")}`;
}
function formatTanggal(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * @param {Awaited<ReturnType<import("./invoice.js").buildInvoiceView>>} view
 * @returns {Promise<Buffer>}
 */
export function renderInvoicePdf(view) {
  return new Promise((resolve, reject) => {
    const { invoice, order, customer, nominal } = view;
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Kop ──────────────────────────────────────────────────────────────
    doc.fontSize(20).fillColor("#111827").font("Helvetica-Bold").text("KLINIK MATRAS", 50, 50);
    doc.fontSize(9).fillColor(ABU).font("Helvetica").text("Ahlinya Kasur Sehat", 50, 74);

    doc.fontSize(16).fillColor(AKSEN).font("Helvetica-Bold")
      .text("INVOICE", 0, 50, { align: "right" });
    doc.fontSize(10).fillColor("#111827").font("Helvetica-Bold")
      .text(invoice.invoiceNumber, 0, 72, { align: "right" });
    doc.fontSize(9).fillColor(ABU).font("Helvetica")
      .text(`Order: ${order.orderNumber || "-"}`, 0, 86, { align: "right" })
      .text(`Tanggal: ${formatTanggal(invoice.createdAt)}`, 0, 99, { align: "right" });

    doc.moveTo(50, 125).lineTo(545, 125).strokeColor(GARIS).stroke();

    // ── Ditagihkan ke ────────────────────────────────────────────────────
    doc.fontSize(9).fillColor(ABU).font("Helvetica-Bold").text("DITAGIHKAN KEPADA", 50, 140);
    doc.fontSize(11).fillColor("#111827").font("Helvetica-Bold").text(customer.nama || "-", 50, 154);
    doc.fontSize(9).fillColor(ABU).font("Helvetica")
      .text(customer.phone || "-", 50, 170)
      .text(`${order.deliveryAddress || "-"}${order.deliveryCity ? `, ${order.deliveryCity}` : ""}`, 50, 183, { width: 300 });

    if (invoice.dueDate) {
      doc.fontSize(9).fillColor(ABU).font("Helvetica-Bold").text("JATUH TEMPO", 380, 140, { width: 165, align: "right" });
      doc.fontSize(11).fillColor("#111827").font("Helvetica").text(formatTanggal(invoice.dueDate), 380, 154, { width: 165, align: "right" });
    }

    // ── Tabel item ───────────────────────────────────────────────────────
    let y = 240;
    doc.rect(50, y, 495, 22).fill("#f3f4f6");
    doc.fontSize(9).fillColor(ABU).font("Helvetica-Bold")
      .text("LAYANAN", 60, y + 6)
      .text("HARGA", 0, y + 6, { width: 535, align: "right" });
    y += 30;

    doc.font("Helvetica").fillColor("#111827");
    if (order.items.length === 0) {
      doc.fontSize(10).fillColor(ABU).text("(belum ada item)", 60, y);
      y += 20;
    } else {
      for (const it of order.items) {
        doc.fontSize(10).fillColor("#111827")
          .text(it.nama, 60, y, { width: 380 })
          .text(formatRupiah(it.harga), 0, y, { width: 535, align: "right" });
        y += 20;
      }
    }
    y += 6;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(GARIS).stroke();
    y += 12;

    // ── Rincian nominal ──────────────────────────────────────────────────
    function baris(label, value, { bold = false, warna = "#111827" } = {}) {
      doc.fontSize(bold ? 11 : 10)
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fillColor(bold ? warna : ABU)
        .text(label, 300, y, { width: 140 });
      doc.fillColor(warna).text(value, 0, y, { width: 535, align: "right" });
      y += bold ? 20 : 16;
    }

    if (nominal.diskonPersen) {
      baris("Harga sebelum diskon", formatRupiah(nominal.hargaSebelumDiskon));
      baris(`Diskon ${nominal.diskonPersen}%${nominal.promoCode ? ` (${nominal.promoCode})` : ""}`, `-${formatRupiah(nominal.nilaiDiskon)}`);
    }
    if (nominal.ongkir > 0) baris("Ongkir", formatRupiah(nominal.ongkir));
    y += 4;
    doc.moveTo(300, y).lineTo(545, y).strokeColor(GARIS).stroke();
    y += 10;
    baris("TOTAL TAGIHAN", formatRupiah(nominal.totalTagihan), { bold: true });
    y += 8;
    baris("Sudah dibayar", nominal.dibayarTidakRinci ? "—" : formatRupiah(nominal.dibayar), { warna: "#16a34a" });
    baris("SISA TAGIHAN", nominal.dibayarTidakRinci ? "—" : formatRupiah(nominal.sisa), {
      bold: true, warna: nominal.sisa > 0 ? "#dc2626" : "#16a34a",
    });

    if (nominal.dibayarTidakRinci) {
      y += 6;
      doc.fontSize(8).font("Helvetica-Oblique").fillColor(ABU)
        .text("* Status pembayaran: DP — nominal belum tercatat rinci di sistem.", 300, y, { width: 245, align: "right" });
      y += 16;
    }

    // ── Catatan & footer ─────────────────────────────────────────────────
    if (invoice.notes) {
      y += 20;
      doc.fontSize(9).fillColor(ABU).font("Helvetica-Bold").text("CATATAN", 50, y);
      doc.fontSize(10).fillColor("#111827").font("Helvetica").text(invoice.notes, 50, y + 14, { width: 495 });
    }

    doc.fontSize(8).fillColor(ABU).font("Helvetica")
      .text(
        `Dibuat oleh ${customer.salesOwner || "Klinik Matras"} — dokumen ini digenerate otomatis oleh sistem.`,
        50, 780, { width: 495, align: "center" }
      );

    doc.end();
  });
}
