// ─── PEMBUATAN ORDER + UNIT + INVOICE — SATU SUMBER KEBENARAN (D-115) ──────
//
// Diekstrak dari customerRouter.post("/:id/orders") (11 September 2026)
// supaya jalur B2B (routes/b2b.js) memakai LOGIKA YANG SAMA PERSIS, bukan
// menulis ulang. Order B2B WAJIB otomatis membuat Unit (+ job pickup
// otomatis kalau kategorinya butuh, lihat unitProvisioning.js) dan draft
// invoice persis seperti order Sales CRM biasa — supaya Produksi/Warehouse/
// Delivery melihatnya sebagai order NORMAL yang bisa mereka kerjakan,
// bukan kelas kedua yang butuh jalur integrasi terpisah. Ini persis
// pelajaran dari SILO komplain (D-109): begitu ada 2 cara membuat "order"
// yang berjalan sendiri-sendiri, cepat atau lambat keduanya diam-diam
// tidak sinkron.
import { prisma } from "../db.js";
import { generateOrderNumber } from "./orderNumberGenerator.js";
import { createUnitsForOrder } from "./unitProvisioning.js";
import { syncOrderStatus } from "./orderStatusSync.js";
import { ensureInvoiceForOrder } from "./invoice.js";
import { parseTanggalKalender } from "../utils/wib.js";

export async function createOrderForCustomer(customerId, body, userId) {
  const {
    quantity, status, notes, beratBadan, category, unitCount, promoId, deliveryCity, deliveryAddress,
    healthStatus, complaintCategory, ongkir, ongkirKlaimGaransi, pickupEstimate, pickupConfirmedDate,
    deliveryEstimate, deliveryConfirmedDate, locationUrl, productLine, productType, customerPromiseDate,
  } = body;

  const cat = category || "LAYANAN";

  // Validasi tanggal DULU, sebelum generateOrderNumber() — generate nomor
  // menaikkan counter OrderSequence secara permanen (transaksi sendiri,
  // tidak ikut rollback transaksi di bawah).
  const tglPickup   = parseTanggalKalender(pickupConfirmedDate,   "Tanggal Pick Up Pasti");
  const tglDelivery = parseTanggalKalender(deliveryConfirmedDate, "Tanggal Kirim Pasti");
  const tglJanji    = parseTanggalKalender(customerPromiseDate,   "Tanggal Janji ke Customer");

  const orderNumber = await generateOrderNumber(cat);

  // Order + unit-unitnya lahir dalam SATU transaksi. Order tanpa unit
  // adalah keadaan yang tidak boleh terjadi; jangan biarkan kegagalan
  // separuh jalan membuatnya lagi.
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        customerId,
        value: 0,
        quantity: quantity ? Number(quantity) : 1,
        status: status || "PENDING",
        category: cat,
        productLine: productLine || "KASUR",
        ...(productType && { productType }),
        orderNumber,
        notes,
        ...(beratBadan !== undefined && { beratBadan: beratBadan ? Number(beratBadan) : null }),
        ...(promoId && { promoId }),
        ...(deliveryCity && { deliveryCity }),
        ...(deliveryAddress && { deliveryAddress }),
        ...(healthStatus && {
          healthStatus,
          complaintCategory: healthStatus === "SAKIT" ? (complaintCategory || []) : [],
        }),
        ...(ongkir !== undefined && { ongkir: ongkir === "" || ongkir === null ? null : Number(ongkir) }),
        ...(ongkirKlaimGaransi !== undefined && { ongkirKlaimGaransi: ongkirKlaimGaransi === "" || ongkirKlaimGaransi === null ? null : Number(ongkirKlaimGaransi) }),
        ...(pickupEstimate && { pickupEstimate }),
        ...(tglPickup   && { pickupConfirmedDate: tglPickup }),
        ...(deliveryEstimate && { deliveryEstimate }),
        ...(tglDelivery && { deliveryConfirmedDate: tglDelivery }),
        ...(locationUrl && { locationUrl }),
        ...(tglJanji && { customerPromiseDate: tglJanji }),
      },
      include: { items: true },
    });

    const jumlahUnit = unitCount === undefined ? 1 : Math.max(0, Math.floor(Number(unitCount) || 0));
    if (jumlahUnit > 0) {
      await createUnitsForOrder(tx, { order: created, count: jumlahUnit });
      // SEWA tidak ikut auto-compute dari Unit — Unit tetap dibuat (Armada
      // masih butuh utk job antar/ambil), tapi Order.status dikunci manual
      // ke SEWA_DIKIRIM sejak lahir (bukan hasil sync).
      if (cat === "SEWA") {
        await tx.order.update({ where: { id: created.id }, data: { status: "SEWA_DIKIRIM", statusLocked: true } });
      } else {
        await syncOrderStatus(tx, created.id);
      }
    }

    // Draft invoice lahir BERSAMA order-nya, di transaksi yang SAMA — sales
    // (atau di sini, owner) tidak perlu langkah manual "buat invoice", dan
    // order yang gagal dibuat tidak meninggalkan invoice yatim.
    await ensureInvoiceForOrder(tx, { orderId: created.id, userId: userId || null });

    return tx.order.findUnique({
      where: { id: created.id },
      include: { items: true, units: { orderBy: { seq: "asc" } } },
    });
  });

  return order;
}
