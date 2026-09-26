// RESI GABUNGAN — FASE 1 ("Buat Resi"), TANPA perubahan schema.
//
// Satu form membuat N order/item untuk SATU customer dalam SATU transaksi: order + unit + job pickup + draft invoice memakai
// createOrderForCustomer (alur lama, tidak diubah), lalu invoice tiap item digabung otomatis lewat mekanisme invoice bundle yang SUDAH ada
// (attachOrderToInvoice). Invoice anchor (item pertama) menjadi tampilan resi gabungan.
//
// YANG SENGAJA TIDAK DILAKUKAN di Fase 1: tidak ada tabel order_groups, tidak ada alokasi pembayaran, tidak menyentuh Payment/posting
// finance/produksi/delivery/insentif, tidak membuat jurnal. Pendapatan tetap diakui per order saat DELIVERED (aturan lama).
//
// ATURAN ANGKA (keputusan owner):
//  - Harga item yang diinput Sales SUDAH termasuk ongkir; "Ongkir Tambahan" hanya biaya ekstra (jarak jauh dsb), default Rp0, dipasang SEKALI
//    di order anchor (Order.ongkir) supaya tidak tertagih berkali-kali.
//  - Total Resi = Σ harga item + Ongkir Tambahan. DP 30% dihitung dari Total Resi (termasuk ongkir tambahan).
//  - DP dibagi ke tiap order lewat Order.dpTarget (kolom yang SUDAH ada) proporsional terhadap tagihan tiap order (largest remainder, jumlah tepat),
//    sehingga tampilan invoice gabungan (Σ dpTarget) = DP 30% Total Resi tanpa mengubah rumus invoice.

import { prisma } from "../db.js";
import { createOrderForCustomer } from "./orderCreation.js";
import { attachOrderToInvoice } from "./invoice.js";
import { syncCustomerOrderAggregate } from "./customerOrderAggregate.js";
import { getSettingRaw, parseBool, SETTING_KEYS } from "./finance/settings.js";

export const DP_PERSEN = 30;
export const MAKS_ITEM_RESI = 20;

export class ResiError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "ResiError";
    this.statusCode = statusCode;
  }
}

export async function resiAktif(db = prisma) {
  return parseBool(await getSettingRaw(db, SETTING_KEYS.RESI_INPUT_AKTIF));
}

const bulatRp = (v) => Math.round(Number(v) || 0);

/** Bagi `total` ke `bobot` secara proporsional dengan pembulatan largest-remainder; hasil PERSIS berjumlah `total`. */
export function bagiProporsional(total, bobot) {
  const jumlahBobot = bobot.reduce((s, b) => s + b, 0);
  if (total <= 0 || jumlahBobot <= 0) return bobot.map(() => 0);
  const mentah = bobot.map((b) => (total * b) / jumlahBobot);
  const dasar = mentah.map((x) => Math.floor(x));
  let sisa = total - dasar.reduce((s, x) => s + x, 0);
  const urutan = mentah.map((x, i) => ({ i, frak: x - Math.floor(x) })).sort((a, b) => b.frak - a.frak || a.i - b.i);
  for (const { i } of urutan) {
    if (sisa <= 0) break;
    dasar[i] += 1;
    sisa -= 1;
  }
  return dasar;
}

/** Ringkasan resi (MURNI): subtotal, ongkir tambahan, total resi, DP 30%, sisa pelunasan, dan pembagian DP per item. */
export function hitungRingkasanResi({ hargaItem, ongkirTambahan = 0 }) {
  const harga = hargaItem.map(bulatRp);
  const ongkir = bulatRp(ongkirTambahan);
  const subtotal = harga.reduce((s, h) => s + h, 0);
  const totalResi = subtotal + ongkir;
  const dp = Math.round((totalResi * DP_PERSEN) / 100);
  // Tagihan per item: ongkir tambahan melekat pada item pertama (anchor).
  const tagihan = harga.map((h, i) => h + (i === 0 ? ongkir : 0));
  const dpPerItem = bagiProporsional(dp, tagihan);
  return { subtotal, ongkirTambahan: ongkir, totalResi, dpPersen: DP_PERSEN, dp, sisaSetelahDp: totalResi - dp, tagihanPerItem: tagihan, dpPerItem };
}

function bersihkanItem(raw, i) {
  const label = `Item ${i + 1}`;
  const harga = Number(raw?.nominal);
  if (!Number.isFinite(harga) || !Number.isInteger(harga) || harga <= 0) throw new ResiError(`${label}: nominal harus bilangan bulat lebih dari 0`);
  const unitCount = raw?.unitCount === undefined || raw?.unitCount === "" ? 1 : Number(raw.unitCount);
  if (!Number.isInteger(unitCount) || unitCount < 1 || unitCount > 10) throw new ResiError(`${label}: jumlah unit harus 1 sampai 10`);
  const teks = (v, maks) => String(v ?? "").trim().slice(0, maks);
  return {
    merk: teks(raw?.merk, 120), ukuran: teks(raw?.ukuran, 60), keluhan: teks(raw?.keluhan, 500), catatan: teks(raw?.catatan, 500),
    namaLayanan: teks(raw?.namaLayanan, 160), harga, unitCount, customerId: raw?.customerId ?? null,
  };
}

/**
 * Buat resi. Semua-atau-tidak-sama-sekali: satu transaksi Prisma; kegagalan pada item mana pun me-rollback SEMUA order, unit, job, dan invoice.
 * Tidak membuat Payment maupun jurnal.
 */
export async function buatResi(customerId, body, userId) {
  if (!(await resiAktif())) throw new ResiError("Fitur Resi Gabungan belum diaktifkan", 403);

  const itemsMentah = Array.isArray(body?.items) ? body.items : [];
  if (itemsMentah.length < 1) throw new ResiError("Resi minimal berisi 1 item");
  if (itemsMentah.length > MAKS_ITEM_RESI) throw new ResiError(`Resi maksimal berisi ${MAKS_ITEM_RESI} item`);
  const items = itemsMentah.map(bersihkanItem);
  if (items.some((it) => it.customerId && it.customerId !== customerId)) {
    throw new ResiError("Semua item dalam satu resi harus milik customer yang sama");
  }

  const ongkirTambahan = body?.ongkirTambahan === undefined || body?.ongkirTambahan === "" || body?.ongkirTambahan === null ? 0 : Number(body.ongkirTambahan);
  if (!Number.isInteger(ongkirTambahan) || ongkirTambahan < 0) throw new ResiError("Ongkir Tambahan harus bilangan bulat 0 atau lebih");

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) throw new ResiError("Customer tidak ditemukan", 404);

  const ringkasan = hitungRingkasanResi({ hargaItem: items.map((it) => it.harga), ongkirTambahan });
  const alamat = String(body?.alamat ?? "").trim() || undefined;
  const kota = String(body?.kota ?? "").trim() || undefined;
  const tautan = String(body?.tautanLokasi ?? "").trim() || undefined;
  const tanggalKirim = body?.tanggalKirim || undefined;

  const hasil = await prisma.$transaction(async (tx) => {
    const dibuat = [];
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      const notes = JSON.stringify({ merkKasur: it.merk, ukuranKasur: it.ukuran, keluhanCustomer: it.keluhan, ...(it.catatan && { catatan: it.catatan }) });
      const order = await createOrderForCustomer(customerId, {
        notes, unitCount: it.unitCount, deliveryAddress: alamat, deliveryCity: kota, locationUrl: tautan, deliveryConfirmedDate: tanggalKirim,
        // Ongkir Tambahan SEKALI di anchor (item pertama); item lain dibiarkan kosong (tidak tertagih ganda).
        ...(i === 0 && { ongkir: ongkirTambahan }),
      }, userId, { tx });

      const nama = it.namaLayanan || [`Kasur`, it.merk, it.ukuran].filter(Boolean).join(" ") || `Item resi ${i + 1}`;
      await tx.orderItem.create({ data: { orderId: order.id, layananName: nama, harga: it.harga, sortOrder: 0 } });
      const dp = ringkasan.dpPerItem[i];
      await tx.order.update({ where: { id: order.id }, data: { value: it.harga, ...(dp > 0 && { dpTarget: dp }) } });
      dibuat.push({ id: order.id, orderNumber: order.orderNumber, nama, harga: it.harga, ongkir: i === 0 ? ongkirTambahan : 0, dpTarget: dp, unitCount: it.unitCount });
    }

    // Gabungkan invoice: item ke-2..N ke invoice anchor (item pertama). attachOrderToInvoice memilih bundle yang anggotanya lebih banyak
    // sebagai primary; karena anchor selalu ≥ sumber, anchor tetap primary. Menolak customer campur / order dibatalkan.
    const anchorId = dibuat[0].id;
    for (let i = 1; i < dibuat.length; i += 1) {
      await attachOrderToInvoice(tx, { sourceOrderId: dibuat[i].id, targetOrderId: anchorId, userId });
    }
    const invoices = await tx.invoice.findMany({ where: { orderId: { in: dibuat.map((d) => d.id) } }, select: { id: true, orderId: true, invoiceNumber: true, combinedIntoId: true } });
    const perOrder = new Map(invoices.map((v) => [v.orderId, v]));
    const anchorInvoice = perOrder.get(anchorId);
    return {
      orders: dibuat.map((d) => ({ ...d, invoiceNumber: perOrder.get(d.id)?.invoiceNumber ?? null })),
      anchorOrderId: anchorId, anchorInvoiceNumber: anchorInvoice?.invoiceNumber ?? null, anchorInvoiceId: anchorInvoice?.id ?? null,
    };
  }, { maxWait: 15_000, timeout: 60_000 });

  await syncCustomerOrderAggregate(customerId);
  return { ...hasil, ringkasan: { subtotal: ringkasan.subtotal, ongkirTambahan: ringkasan.ongkirTambahan, totalResi: ringkasan.totalResi, dpPersen: ringkasan.dpPersen, dp: ringkasan.dp, sisaSetelahDp: ringkasan.sisaSetelahDp } };
}
