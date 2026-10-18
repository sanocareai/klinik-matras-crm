// RIWAYAT LENGKAP SATU UNIT (Produksi + Gudang + Sales + Pengiriman) untuk tab Aktivitas Unit 360 (keputusan Owner, 19 Okt 2026: "ada history setiap tindakan, ada nama PIC yang melakukan pengubahan, dan history
// pengubahan semua terekam"). BACA-SAJA: tidak menulis apa pun. Sebelumnya tab ini hanya memuat log tahap, bukti (tanpa pelaku), dan custody; tabel activity_events (override, rencana, bahan, QC, pelepasan,
// penyelarasan order) tidak pernah ditampilkan. Sekarang semua sumber digabung, setiap baris membawa SUMBER, KALIMAT, PELAKU (nama), WAKTU, dan bila ada RINCIAN sebelum → sesudah.
//
// Sumber: activity_events (unit, order milik unit ini, dan dokumen permintaan bahan unit ini), log tahap V1, bukti tahap V2 (per versi = riwayat koreksi bukti), custody (ditawarkan/diterima/ditolak/dibatalkan + pelaku),
// QC (inspektur), dan riwayat status order (siapa mengubah). Peristiwa STAGE_* di activity_events tidak diulang karena sudah diwakili log tahap. Tidak ada tebakan: bila pelaku tidak tercatat, kolom pelaku kosong.
import { formatActivitySentence, ENTITY_TYPES } from "../lib/activityLog.js";
import { STEP_BY_NO } from "../lib/domain/productionSteps.js";

export const SUMBER_RIWAYAT = Object.freeze({ PRODUKSI: "PRODUKSI", GUDANG: "GUDANG", SALES: "SALES", PENGIRIMAN: "PENGIRIMAN" });
const BATAS = 500;

function sumberDariEvent(e) {
  const t = String(e.eventType || "");
  if (e.entityType === ENTITY_TYPES.MATERIAL_ISSUE) return SUMBER_RIWAYAT.GUDANG;
  if (/DISPATCH|DELIVER|ROUTE|JOB_/.test(t) && !/DELIVERY_RELEASED/.test(t)) return SUMBER_RIWAYAT.PENGIRIMAN;
  if (/MATERIAL|CUSTODY|RESERVATION|STOCK|RETURN_RECEIVED|WAREHOUSE|KOREKSI|CORRECTION/.test(t)) return SUMBER_RIWAYAT.GUDANG;
  if (e.entityType === ENTITY_TYPES.ORDER && !/^PRODUCTION_/.test(t)) return SUMBER_RIWAYAT.SALES;
  return SUMBER_RIWAYAT.PRODUKSI;
}

// Rincian sebelum → sesudah dari metadata bila bentuknya mengenal (from/to, sebelum/sesudah, before/after, orderStatusBefore/After, unitStatusBefore/After).
function rincianDariMetadata(m = {}) {
  const pasangan = [
    ["from", "to"], ["sebelum", "sesudah"], ["before", "after"], ["orderStatusBefore", "orderStatusAfter"], ["unitStatusBefore", "unitStatusAfter"], ["statusBefore", "statusAfter"],
  ];
  for (const [a, b] of pasangan) if (m[a] !== undefined || m[b] !== undefined) return { sebelum: m[a] ?? null, sesudah: m[b] ?? null };
  return null;
}

/**
 * @param prisma prisma atau tx
 * @param {{unit:{id:string, orderId:string}, run?:{id:string}|null}} p
 * @returns Array<{at, source, kind, label, actor, detail?}> urut waktu NAIK (terlama dulu), maksimal 500 baris terbaru.
 */
export async function loadRiwayatUnit(prisma, { unit, run = null }) {
  const issues = await prisma.materialIssue.findMany({ where: { unitId: unit.id }, select: { id: true, issueNumber: true } });
  const issueIds = issues.map((i) => i.id);
  const [events, stageLogs, evidence, handoffs, inspections, transisi] = await Promise.all([
    prisma.activityEvent.findMany({
      where: { OR: [
        { entityType: ENTITY_TYPES.UNIT, entityId: unit.id },
        ...(unit.orderId ? [{ entityType: ENTITY_TYPES.ORDER, entityId: unit.orderId }] : []),
        ...(issueIds.length ? [{ entityType: ENTITY_TYPES.MATERIAL_ISSUE, entityId: { in: issueIds } }] : []),
      ] },
      orderBy: { createdAt: "desc" }, take: BATAS,
    }),
    prisma.unitStageLog.findMany({ where: { unitId: unit.id }, orderBy: { createdAt: "desc" }, take: BATAS, select: { createdAt: true, action: true, note: true, actorId: true, stage: { select: { labelId: true } } } }),
    run ? prisma.productionStepEvidence.findMany({ where: { runId: run.id, stepCode: { not: { startsWith: "DOC_" } } }, orderBy: { createdAt: "desc" }, take: BATAS, select: { createdAt: true, stepNo: true, version: true, payload: true, actorId: true } }) : [],
    prisma.unitCustodyHandoff.findMany({ where: { unitId: unit.id }, orderBy: { offeredAt: "asc" }, select: { direction: true, status: true, reason: true, offeredAt: true, offeredById: true, acceptedAt: true, acceptedById: true, rejectedAt: true, rejectedById: true, cancelledAt: true, cancelledById: true } }),
    run ? prisma.qualityInspection.findMany({ where: { runId: run.id }, orderBy: { version: "asc" }, select: { version: true, result: true, inspectedAt: true, inspectorId: true, overrideReason: true } }) : [],
    unit.orderId ? prisma.orderStatusTransition.findMany({ where: { orderId: unit.orderId }, orderBy: { createdAt: "desc" }, take: 100, select: { createdAt: true, fromStatus: true, toStatus: true, changedById: true } }) : [],
  ]);

  // Satu pencarian nama untuk semua pelaku (actorId bukan FK; resolve manual).
  const ids = new Set();
  const tambah = (x) => { if (x) ids.add(x); };
  events.forEach((e) => e.actorType === "USER" && tambah(e.actorId)); stageLogs.forEach((l) => tambah(l.actorId)); evidence.forEach((v) => tambah(v.actorId)); inspections.forEach((q) => tambah(q.inspectorId)); transisi.forEach((t) => tambah(t.changedById));
  handoffs.forEach((h) => { tambah(h.offeredById); tambah(h.acceptedById); tambah(h.rejectedById); tambah(h.cancelledById); });
  const users = ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }) : [];
  const nama = new Map(users.map((u) => [u.id, u.name]));
  const aktor = (id) => (id ? nama.get(id) ?? null : null);

  const out = [];
  const nomorIssue = new Map(issues.map((i) => [i.id, i.issueNumber]));
  for (const e of events) {
    if (/^STAGE_/.test(String(e.eventType))) continue; // diwakili log tahap
    const m = e.metadata && typeof e.metadata === "object" ? e.metadata : {};
    // Peristiwa di order milik unit lain pada order multi-unit tidak diulang di unit ini.
    if (e.entityType === ENTITY_TYPES.ORDER && m.unitCode && m.unitCode !== unit.unitCode && unit.unitCode) continue;
    let label;
    try { label = formatActivitySentence({ ...e, metadata: m }) || String(e.eventType); } catch { label = String(e.eventType); }
    out.push({ at: e.createdAt, source: sumberDariEvent(e), kind: `EVENT_${e.eventType}`, label, actor: e.actorType === "USER" ? aktor(e.actorId) : (e.actorType === "SYSTEM" ? "Sistem" : null), detail: rincianDariMetadata(m), ...(e.entityType === ENTITY_TYPES.MATERIAL_ISSUE ? { dokumen: nomorIssue.get(e.entityId) ?? null } : {}) });
  }
  for (const l of stageLogs) out.push({ at: l.createdAt, source: SUMBER_RIWAYAT.PRODUKSI, kind: `STAGE_${l.action}`, label: `${l.stage?.labelId ?? "Tahap"} — ${l.action}${l.note ? `: ${l.note}` : ""}`, actor: aktor(l.actorId), detail: null });
  for (const v of evidence) {
    const langkah = STEP_BY_NO[v.stepNo]?.label ?? v.stepNo;
    const dilewati = v.payload && v.payload.outcome === "SKIPPED";
    out.push({ at: v.createdAt, source: SUMBER_RIWAYAT.PRODUKSI, kind: "EVIDENCE", label: `Bukti tahap ${v.stepNo} (${langkah}) ${dilewati ? "DILEWATI" : "tercatat"}${v.version > 1 ? ` — koreksi versi ${v.version}` : ""}`, actor: aktor(v.actorId), detail: v.version > 1 ? { sebelum: `versi ${v.version - 1}`, sesudah: `versi ${v.version}` } : null });
  }
  for (const h of handoffs) {
    const arah = h.direction === "INBOUND" ? "Unit" : "Barang jadi";
    out.push({ at: h.offeredAt, source: SUMBER_RIWAYAT.GUDANG, kind: "CUSTODY_OFFERED", label: h.direction === "INBOUND" ? "Unit ditawarkan ke Gudang (pickup selesai)" : "Barang jadi ditawarkan ke Gudang", actor: aktor(h.offeredById), detail: null });
    if (h.acceptedAt) out.push({ at: h.acceptedAt, source: SUMBER_RIWAYAT.GUDANG, kind: "CUSTODY_ACCEPTED", label: h.direction === "INBOUND" ? "Diterima Gudang (tiba di workshop)" : "Barang jadi diterima Gudang", actor: aktor(h.acceptedById), detail: null });
    if (h.rejectedAt) out.push({ at: h.rejectedAt, source: SUMBER_RIWAYAT.GUDANG, kind: "CUSTODY_REJECTED", label: `${arah} ditolak Gudang${h.reason ? `: ${h.reason}` : ""}`, actor: aktor(h.rejectedById), detail: null });
    if (h.cancelledAt) out.push({ at: h.cancelledAt, source: SUMBER_RIWAYAT.GUDANG, kind: "CUSTODY_CANCELLED", label: `Penawaran ${arah.toLowerCase()} dibatalkan${h.reason ? `: ${h.reason}` : ""}`, actor: aktor(h.cancelledById), detail: null });
  }
  for (const q of inspections) out.push({ at: q.inspectedAt, source: SUMBER_RIWAYAT.PRODUKSI, kind: "QC", label: `QC versi ${q.version}: ${q.result}${q.overrideReason ? ` — ${q.overrideReason}` : ""}`, actor: aktor(q.inspectorId), detail: null });
  for (const t of transisi) out.push({ at: t.createdAt, source: SUMBER_RIWAYAT.SALES, kind: "ORDER_STATUS", label: `Status order diubah ${t.fromStatus} → ${t.toStatus}`, actor: aktor(t.changedById), detail: { sebelum: t.fromStatus, sesudah: t.toStatus } });

  out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return out.slice(-BATAS);
}
