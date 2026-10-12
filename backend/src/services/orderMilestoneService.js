// Status global tingkat ORDER (Fase 2 milestone "Diterima di Workshop") — pemuat BATCH + penempel ke respons API. BACA-SAJA.
// Satu sumber untuk semua workspace (Sales CRM, Pipeline, Delivery/Driver, Warehouse, laporan, mobile, MCP): order mengikuti unit aktif yang PALING tertinggal,
// dengan rincian progres; unit batal tidak ikut penyebut; order tanpa unit / sewa tidak dikarang (legacy). Field Order.status lama TIDAK diubah.
import { globalStatusOf, orderMilestoneView, orderRollupOf } from "../lib/domain/workshopMilestone.js";
import { loadMilestoneEvidence } from "./workshopMilestoneEvidence.js";

/** @returns {Promise<Map<string, ReturnType<typeof orderMilestoneView>>>} orderId -> tampilan status global order. Setiap orderId yang diminta ADA di Map. */
export async function loadOrderMilestones(client, orders) {
  const list = (orders || []).filter((o) => o?.id);
  const out = new Map();
  if (!list.length) return out;
  const statusOf = new Map(list.map((o) => [o.id, o.status]));
  const units = await client.unit.findMany({ where: { orderId: { in: [...statusOf.keys()] } }, select: { id: true, orderId: true, status: true } });
  const evidence = await loadMilestoneEvidence(client, units.map((u) => u.id));
  const byOrder = new Map();
  for (const u of units) {
    const e = evidence.get(u.id) || { receivedBasis: null, started: false, pickupCompleted: false, pickupInProgress: false };
    const g = globalStatusOf({ unitStatus: u.status, ...e });
    if (!byOrder.has(u.orderId)) byOrder.set(u.orderId, []);
    byOrder.get(u.orderId).push(g);
  }
  for (const [id, status] of statusOf) out.set(id, orderMilestoneView({ orderStatus: status, rollup: orderRollupOf(byOrder.get(id) || []) }));
  return out;
}

/** Menempelkan `milestone` (status global order) ke tiap objek order ({ id, status, ... }). Mengembalikan array baru; objek asli tidak diubah. */
export async function attachOrderMilestones(client, orders, { key = "milestone" } = {}) {
  const list = Array.isArray(orders) ? orders : [];
  const map = await loadOrderMilestones(client, list);
  return list.map((o) => (o?.id ? { ...o, [key]: map.get(o.id) ?? null } : o));
}
