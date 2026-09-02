// ─── KARTU GARANSI E-WARRANTY (2 Sep 2026) ──────────────────────────────────
//
// Jauh lebih sederhana dari invoice (services/invoice.js) SENGAJA — kartu
// garansi tidak punya lifecycle draft/sent/viewed/gabungan, cuma "kapan
// terakhir dikirim & varian berapa tahun" (Order.warrantyYears/warrantySentAt).
// Datanya SELALU dibaca ulang dari Order + Invoice yang sudah ada (ID
// Transaksi = nomor invoice ORDER INI SENDIRI, bukan nomor invoice gabungan
// kalau order ini kebetulan anggota suatu bundle — garansi melekat ke barang/
// servis order ini secara fisik, bukan ke dokumen tagihan gabungannya).

import { prisma } from "../db.js";
import { ensureInvoiceForOrder } from "./invoice.js";

export const WARRANTY_YEARS_VALID = [10, 20];

// View siap-render untuk PDF & panel UI. `warrantyYears` param = pilihan
// SEKARANG (dari dropdown sales/admin) — TIDAK otomatis dari paket manapun
// (sistem ini belum menyimpan "Paket Standard/Premium" per order, lihat
// komentar di schema.prisma). Kalau tidak dikirim, jatuh ke pilihan
// TERAKHIR yang pernah dikirim (Order.warrantyYears), atau default 10.
export async function buildWarrantyView(orderId, { userId = null, warrantyYears } = {}) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      customer: { select: { id: true, name: true, phone: true, city: true } },
      invoice: true, // SENGAJA baca langsung (bukan buildInvoiceView) — lihat catatan di atas.
    },
  });
  if (!order) return null;
  if (!order.customer) return null;

  let invoice = order.invoice;
  if (!invoice) {
    invoice = await prisma.$transaction((tx) => ensureInvoiceForOrder(tx, { orderId, userId }));
  }

  const tahun = WARRANTY_YEARS_VALID.includes(Number(warrantyYears))
    ? Number(warrantyYears)
    : (order.warrantyYears || 10);

  const layanan = order.items.length
    ? order.items.map((i) => i.layananName).join(", ")
    : "-";

  return {
    invoiceNumber: invoice.invoiceNumber,
    purchaseDate: invoice.createdAt,
    warrantyYears: tahun,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      deliveryAddress: order.deliveryAddress,
      deliveryCity: order.deliveryCity,
      // "Keluhan Customer" di kartu = complaintDetail SAJA (D-006/7D di
      // CLAUDE.md — keluhan yang MENDASARI kenapa order/servis ini dibuat,
      // mis. "bagian kiri amblas"). BUG diperbaiki 3 Sep 2026: SEBELUMNYA
      // fallback ke Order.notes kalau complaintDetail kosong — ternyata
      // notes kadang berisi JSON metadata internal (mis. katalog/ukuran
      // yang disimpan sales lewat form lain), BUKAN teks bebas utk
      // customer. Menampilkannya apa adanya = bocor data internal ke
      // dokumen customer-facing. Sekarang kosong = "-" jujur, TIDAK
      // menebak dari field lain.
      keluhanCustomer: order.complaintDetail || "-",
    },
    customer: {
      id: order.customer.id,
      nama: order.customer.name,
      phone: order.customer.phone,
    },
    layanan,
    warrantySentAt: order.warrantySentAt,
  };
}

// Ditandai setelah SUNGGUH terkirim ke WhatsApp customer (pola sama seperti
// setInvoiceLifecycle dipanggil dari POST /invoice/send) — "terkirim" di
// sini juga berarti dokumennya benar-benar sampai, bukan cuma tombol diklik.
export async function markWarrantySent(orderId, warrantyYears) {
  return prisma.order.update({
    where: { id: orderId },
    data: { warrantyYears, warrantySentAt: new Date() },
  });
}
