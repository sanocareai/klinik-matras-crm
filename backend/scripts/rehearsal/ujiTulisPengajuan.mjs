// UJI TULIS REHEARSAL — pengajuan pemakaian (aturan ADMIN, Nov 2026). HANYA untuk basis data SALINAN restore (nama wajib diawali rehearsal_ppp_); salinan dihapus sesudahnya.
// Membuktikan dengan kode kandidat + skema produksi yang sudah dimigrasi: pengajuan → verifikasi ADMIN lain → TEPAT SATU perubahan stok/HPP, termasuk bukti tahap 6 Aplikasi Meja
// (retur sisa disesuaikan → Gudang menerima = satu pergerakan RETURN). Router asli dipasang pada aplikasi Express kecil (tanpa index.js: tanpa cron/WAHA/Socket).
// Mencetak satu baris JSON ringkasan (tanpa data pelanggan). Gagal = keluar dengan kode ≠ 0.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { randomUUID } from "node:crypto";

const db = (process.env.DATABASE_URL || "").split("/").pop().split("?")[0];
if (!/^rehearsal_ppp_[0-9a-f]{8}$/.test(db)) { console.error("UJI TULIS DITOLAK: bukan basis data salinan rehearsal (" + db + ")"); process.exit(9); }
process.env.PRODUCTION_EVIDENCE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "reh-bukti-")); // foto uji ke folder sementara container (bukan penyimpanan nyata)

import { pathToFileURL } from "node:url";
const SRC = process.env.APP_SRC || "/app/src"; const imp = (p) => import(pathToFileURL(path.join(SRC, p)).href);
const express = (await import("express")).default; const jwt = (await import("jsonwebtoken")).default;
const { prisma } = await imp("db.js");
const { unitRouter } = await imp("routes/units.js");
const { pemakaianKoreksiRouter } = await imp("routes/pemakaianKoreksi.js");
const { productionPlanningRouter } = await imp("routes/productionPlanning.js");
const { productionExperienceRouter } = await imp("routes/productionExperience.js");
const { V2_FLAGS } = await imp("services/v2FeatureFlags.js");
const app = express(); app.use(express.json({ limit: "10mb" }));
app.use("/api/units", unitRouter); app.use("/api/production", pemakaianKoreksiRouter); app.use("/api/production-planning", productionPlanningRouter); app.use("/api/production-v2", productionExperienceRouter);
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const BASE = `http://127.0.0.1:${server.address().port}/api`;

const gagal = []; const cek = (n, c, d = "") => { if (!c) gagal.push(`${n}${d ? ": " + String(d).slice(0, 300) : ""}`); };
const tag = randomUUID().slice(0, 8);
const T = {};
async function pengguna(k, roles) { const u = await prisma.user.create({ data: { name: `REH ${k} ${tag}`, email: `reh-${k}-${tag}@rehearsal.invalid`, passwordHash: "x", role: roles[0] } }); T[k] = { id: u.id, roles, token: jwt.sign({ id: u.id, name: u.name, role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: "1h" }) }; return u; }
const call = async (k, method, p, body, kunci = `reh-${randomUUID()}`) => { const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${T[k].token}`, "Idempotency-Key": kunci }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const ok = async (pr, n) => { const r = await pr; if (r.status >= 300) throw new Error(`${n} → ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const hppMov = async (id) => ({ op: await prisma.stockMovementBiayaOperasional.count({ where: { movementId: id } }), val: await prisma.finStockMovementValuation.count({ where: { movementId: id } }) });
const jumlah = async () => ({ mov: await prisma.stockMovement.count(), op: await prisma.stockMovementBiayaOperasional.count(), val: await prisma.finStockMovementValuation.count(), jurnal: await prisma.finJournalEntry.count() });
const ringkas = {};
try {
  for (const [k, r] of [["admin", ["ADMIN"]], ["admin2", ["ADMIN"]], ["pekerja", ["PRODUCTION_WORKER"]], ["nadya", ["WAREHOUSE", "PRODUCTION_WORKER"]], ["lead", ["PRODUCTION_LEAD"]], ["qc", ["QC_LEAD"]], ["corner", ["PRODUCTION_WORKER"]]]) await pengguna(k, r);
  const mat = await prisma.material.create({ data: { code: `REH-${tag}`, name: `Bahan rehearsal ${tag}`, unit: "KG", active: true } });
  await prisma.stockMovement.create({ data: { materialId: mat.id, type: "RECEIPT", qty: 100, unitCost: 10000, note: "rehearsal" } });
  const cust = await prisma.customer.create({ data: { name: `REH pelanggan ${tag}` } });

  // ── V1: unit berjalan
  const o1 = await prisma.order.create({ data: { customerId: cust.id, value: 0, orderNumber: `REH-${tag}-1` } });
  const u1 = await prisma.unit.create({ data: { unitCode: `REH-${tag}-U1`, orderId: o1.id, seq: 1, status: "IN_PRODUCTION" } });
  const langsung = await ok(call("admin", "POST", `/units/${u1.id}/materials`, { materialId: mat.id, qty: 1 }), "ADMIN langsung");
  const dasarHpp = await hppMov(langsung.id);
  const sebelum = await jumlah();
  const aju = await call("pekerja", "POST", `/units/${u1.id}/materials`, { materialId: mat.id, qty: 2 });
  cek("V1 non-ADMIN = pengajuan 202", aju.status === 202, JSON.stringify(aju.body));
  cek("V1 pengajuan tidak mengubah stok/HPP/jurnal", JSON.stringify(await jumlah()) === JSON.stringify(sebelum));
  const v = await ok(call("admin2", "POST", "/production/pengajuan-pemakaian/verifikasi", { item: [{ id: aju.body.pengajuan.id }] }), "verifikasi V1");
  cek("V1 disahkan", v.hasil[0].status === "DISETUJUI", JSON.stringify(v.hasil));
  const mv = await prisma.stockMovement.findMany({ where: { unitId: u1.id }, orderBy: { createdAt: "asc" } });
  cek("V1 tepat satu pergerakan baru (-2, pelaku pengaju)", mv.length === 2 && Number(mv[1].qty) === -2 && mv[1].createdById === T.pekerja.id, JSON.stringify(mv.map((m) => [Number(m.qty), m.createdById === T.pekerja.id])));
  const hppBaru = await hppMov(mv[1].id);
  cek("V1 HPP pergerakan = pola pencatatan langsung ADMIN (tepat sekali)", JSON.stringify(hppBaru) === JSON.stringify(dasarHpp), JSON.stringify({ hppBaru, dasarHpp }));
  const setelah = await jumlah();
  await ok(call("admin", "POST", "/production/pengajuan-pemakaian/verifikasi", { item: [{ id: aju.body.pengajuan.id }] }), "verifikasi ulang V1");
  cek("V1 verifikasi ulang tidak menambah apa pun", JSON.stringify(await jumlah()) === JSON.stringify(setelah));
  ringkas.v1 = { pergerakan: mv.length - 1, hpp: hppBaru };

  // ── V2: bukti tahap 6 PIC Meja (non-ADMIN) dengan bahan, tanpa PIC Bahan
  const wc = await prisma.workCenter.create({ data: { code: `WC-REH-${tag}`, name: "Workshop rehearsal" } });
  const op = {}; for (const k of ["nadya", "corner"]) op[k] = await prisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: T[k].id, primaryWorkCenterId: wc.id } });
  const o2 = await prisma.order.create({ data: { customerId: cust.id, orderNumber: `REH-${tag}-2`, value: 1, category: "BARU", status: "PROCESSING", productLine: "DIVAN", productType: "DIVAN_UTAMA", items: { create: [{ layananName: "Divan rehearsal", harga: 1 }] } } });
  const u2 = await prisma.unit.create({ data: { unitCode: `REH-${tag}-U2`, orderId: o2.id, seq: 1, status: "RECEIVED" } });
  for (const key of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) { // salinan: unit uji DITAMBAHKAN ke kohort yang ada
    const row = await prisma.v2FeatureFlag.findUnique({ where: { key } }); const ids = [...new Set([...(row?.enabled ? row.config?.unitIds ?? [] : []), u2.id])];
    const data = { enabled: true, scope: "GLOBAL", config: { ...(row?.config ?? {}), unitIds: ids }, reason: "rehearsal uji tulis" };
    await prisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
  const tgl = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const plan = await ok(call("lead", "POST", "/production-v2/plans", { unitId: u2.id, productionDate: tgl, stationCode: "TABLE_1", priority: 0, workCenterId: wc.id, operatorId: op.nadya.id, cornerOperatorId: op.corner.id }), "jadwal");
  const run = await prisma.productionRun.findFirstOrThrow({ where: { unitId: u2.id } });
  const kartu = async () => ok(call("lead", "GET", `/production-v2/runs/${run.id}/card`), "kartu");
  await ok(call("lead", "POST", `/production-v2/runs/${run.id}/build/corner`, { expectedRevision: (await kartu()).revision, required: true }), "corner");
  const pl = await ok(call("lead", "GET", `/production-planning/plans/${plan.planId}`), "rencana");
  const bom = await ok(call("lead", "POST", `/production-planning/plans/${plan.planId}/bom`, { lines: [{ materialId: mat.id, qty: 3 }], expectedRevision: pl.revision }), "bom");
  await ok(call("nadya", "POST", `/production-planning/plans/${plan.planId}/reserve`, { expectedRevision: bom.revision }), "reservasi");
  const mr = await ok(call("nadya", "POST", `/production-planning/plans/${plan.planId}/material-request`, {}), "permintaan");
  await ok(call("nadya", "POST", `/production-planning/material-requests/${mr.issueId}/pick`, { expectedRevision: 1 }), "serah Gudang");
  const keluar = await prisma.stockMovement.count({ where: { unitId: u2.id, type: "ISSUE" } });
  const foto = async (k = "i") => { const fd = new FormData(); fd.append("runId", run.id); fd.append("files", new Blob([Buffer.from(`reh-${k}-${randomUUID()}`)], { type: k === "v" ? "video/mp4" : "image/jpeg" }), k === "v" ? "a.mp4" : "a.jpg"); const r = await fetch(BASE + "/production-v2/evidence/upload", { method: "POST", headers: { Authorization: `Bearer ${T.nadya.token}` }, body: fd }); return (await r.json()).items.map((i) => i.url); };
  const tahap = async (k, n, payload = {}, media = []) => ok(call(k, "POST", `/production-v2/runs/${run.id}/steps/${n}`, { expectedRevision: (await kartu()).revision, workCenterId: wc.id, payload, media }), `tahap ${n}`);
  await tahap("nadya", 6);
  const s6 = await tahap("nadya", 6, { note: "Rangka divan rehearsal", materials: [{ materialId: mat.id, qty: 1 }] }, await foto());
  cek("V2 tahap 6 selesai (bukti tersimpan) + pemakaian menunggu verifikasi", s6.menungguVerifikasi === true && !!s6.pengajuanId && s6.action === "COMPLETE", JSON.stringify(s6).slice(0, 200));
  // Sisa tahap mengikuti langkah "next" dari server — pengaturan produksi (gerbang QC / adaptasi) pada salinan dipakai apa adanya.
  const PAYLOAD = { 9: { note: "siap" }, 10: { mattressStyle: "PILLOWTOP", fabricSpec: "Knit", borderColor: "Abu" }, 11: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, 12: { confirm: true } };
  const langkah = [];
  for (let i = 0; i < 20; i++) {
    const fase = (await prisma.productionRun.findUnique({ where: { id: run.id }, select: { currentPhase: true } })).currentPhase;
    if (fase === "HANDOFF" || fase === "DONE" || fase === "CLOSED" || (await prisma.productionMaterialReturn.count({ where: { runId: run.id } })) > 0) break;
    const n = (await kartu()).next;
    langkah.push(`${n.stepNo}:${n.action}${n.wait ? ":" + n.wait : ""}`);
    if (n.wait === "AWAITING_QC") { const qcRun = await ok(call("qc", "GET", `/production-planning/qc/runs/${run.id}`), "qc baca"); await ok(call("qc", "POST", `/production-planning/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], note: "rehearsal" }), "qc"); continue; }
    if (n.wait === "READY_TO_FINISH") { await ok(call("nadya", "POST", `/production-v2/runs/${run.id}/finish`, { confirm: true, expectedRevision: (await kartu()).revision, workCenterId: wc.id, media: await foto() }), "selesaikan produksi"); break; } // mode adaptasi
    if (n.action === "WAIT" || !n.stepNo) throw new Error("pekerjaan tertahan: " + JSON.stringify(n));
    const media = n.action === "START" ? [] : [9, 11, 12].includes(n.stepNo) || n.action === "HANDOFF" ? await foto() : [];
    await tahap(n.actor === "CORNER" ? "corner" : "nadya", n.stepNo, PAYLOAD[n.stepNo] ?? {}, media);
  }
  ringkas.langkahV2 = langkah;
  cek("V2 pekerjaan selesai tanpa menunggu verifikasi", (await prisma.productionMaterialReturn.count({ where: { runId: run.id } })) > 0, langkah.join(" "));
  const retur = async () => (await prisma.productionMaterialReturn.findMany({ where: { runId: run.id } })).map((x) => [Number(x.qty), x.status]);
  cek("V2 sebelum verifikasi: retur = seluruh yang diserahkan", JSON.stringify(await retur()) === JSON.stringify([[3, "PENDING"]]), JSON.stringify(await retur()));
  const sebelum2 = await jumlah();
  const v2 = await ok(call("admin", "POST", "/production/pengajuan-pemakaian/verifikasi", { item: [{ id: s6.pengajuanId }] }), "verifikasi bukti");
  cek("V2 bukti disahkan", v2.hasil[0].status === "DISETUJUI", JSON.stringify(v2.hasil));
  cek("V2 retur PENDING disesuaikan 3 − 1 = 2", JSON.stringify(await retur()) === JSON.stringify([[2, "PENDING"]]), JSON.stringify(await retur()));
  cek("V2 verifikasi tidak mengubah stok/HPP (stok berubah saat retur diterima)", JSON.stringify(await jumlah()) === JSON.stringify(sebelum2));
  await ok(call("admin2", "POST", "/production/pengajuan-pemakaian/verifikasi", { item: [{ id: s6.pengajuanId }] }), "verifikasi ulang bukti");
  cek("V2 verifikasi ulang tidak mengubah retur", JSON.stringify(await retur()) === JSON.stringify([[2, "PENDING"]]));
  const r0 = await prisma.productionMaterialReturn.findFirstOrThrow({ where: { runId: run.id } }); const kunci = `reh-retur-${randomUUID()}`;
  await ok(call("nadya", "POST", `/production-v2/material-returns/${r0.id}/receive`, { expectedRevision: r0.revision }, kunci), "Gudang terima retur");
  await call("nadya", "POST", `/production-v2/material-returns/${r0.id}/receive`, { expectedRevision: r0.revision }, kunci); // klik ganda = replay
  const rt = await prisma.stockMovement.findMany({ where: { unitId: u2.id, type: "RETURN" } });
  cek("V2 tepat satu pergerakan RETURN = 2", rt.length === 1 && Number(rt[0].qty) === 2, JSON.stringify(rt.map((m) => Number(m.qty))));
  const hppRet = rt[0] ? await hppMov(rt[0].id) : null;
  cek("V2 HPP retur dibukukan paling banyak sekali", hppRet && hppRet.op <= 1 && hppRet.val <= 1, JSON.stringify(hppRet));
  cek("V2 stok keluar tetap tepat sekali (Gudang)", (await prisma.stockMovement.count({ where: { unitId: u2.id, type: "ISSUE" } })) === keluar);
  ringkas.v2 = { retur: Number(rt[0]?.qty ?? 0), hppRetur: hppRet, keluar };
} catch (e) { gagal.push("GALAT: " + (e?.message || String(e)).slice(0, 400)); }
finally { server.close(); await prisma.$disconnect(); }
console.log(JSON.stringify({ ujiTulis: gagal.length ? "GAGAL" : "LULUS", gagal, ...ringkas }));
process.exit(gagal.length ? 1 : 0);
