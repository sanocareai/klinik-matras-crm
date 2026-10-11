// Kategori kerja efektif SATU unit dari DB (unit.workCategory lalu order.category). Untuk pemanggil yang tidak membawa kolom unit di select-nya.
import { kategoriUnit } from "../lib/domain/unitKategori.js";

export async function kategoriUnitDb(client, unitId) {
  if (!unitId) return null;
  const u = await client.unit.findUnique({ where: { id: unitId }, select: { workCategory: true, order: { select: { category: true } } } });
  return kategoriUnit(u, u?.order);
}

/** Pasangan produkLine/productType efektif satu unit dari DB (kolom unit lalu order). */
export async function produkUnitDb(client, unitId) {
  const u = await client.unit.findUnique({ where: { id: unitId }, select: { productLine: true, productType: true, order: { select: { productLine: true, productType: true } } } });
  if (!u) return {};
  if (u.productLine || u.productType) return { productLine: u.productLine ?? null, productType: u.productType ?? null };
  return { productLine: u.order?.productLine ?? null, productType: u.order?.productType ?? null };
}
