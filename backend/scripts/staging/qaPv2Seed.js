// Seeder staging QA-PV2 (P12A): master data, akun, 12 unit "matriks demo", lifecycle end-to-end, status, dan reset aman.
// Perubahan produksi lewat endpoint command ASLI (jalur tulis aplikasi). Semua entitas ber-prefix QA-PV2; idempoten (ensure-by-code).
// Library ini TIDAK membaca env sendiri: pemanggil (CLI/tes) wajib sudah lolos assertQaPv2Safe().
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PREFIX, EMAIL_PREFIX, BASELINE_TABLES, qaCode } from "./qaPv2Safety.js";
import { makeKit, png, wibDate } from "./qaPv2Kit.js";
import { DOC_CATEGORIES } from "../../src/lib/domain/productionDocumentation.js";

const V2 = "/api/production-v2";
const P = "/api/production-planning";

// ---------------------------------------------------------------- akun staging (tanpa password di kode; password acak -> berkas kredensial 0600) --------------------------------
export const ACCOUNTS = Object.freeze([
  { key: "owner", name: `${PREFIX} Owner`, role: "OWNER" }, { key: "admin", name: `${PREFIX} Admin`, role: "ADMIN" },
  { key: "lead", name: `${PREFIX} Production Lead`, role: "PRODUCTION_LEAD" },
  { key: "meja1", name: `${PREFIX} Operator Meja 1`, role: "PRODUCTION_WORKER", operator: "TABLE" }, { key: "meja2", name: `${PREFIX} Operator Meja 2`, role: "PRODUCTION_WORKER", operator: "TABLE" },
  { key: "meja3", name: `${PREFIX} Operator Meja 3`, role: "PRODUCTION_WORKER", operator: "TABLE" }, { key: "meja4", name: `${PREFIX} Operator Meja 4`, role: "PRODUCTION_WORKER", operator: "TABLE" },
  { key: "corner1", name: `${PREFIX} PIC Corner 1`, role: "PRODUCTION_WORKER", operator: "CORNER" }, { key: "corner2", name: `${PREFIX} PIC Corner 2`, role: "PRODUCTION_WORKER", operator: "CORNER" },
  { key: "qc", name: `${PREFIX} QC`, role: "QC_LEAD" }, { key: "gudang", name: `${PREFIX} Gudang`, role: "WAREHOUSE" },
  { key: "dokumentasi", name: `${PREFIX} Dokumentasi`, role: "PRODUCTION_DOCUMENTER" }, { key: "driver", name: `${PREFIX} Driver`, role: "DRIVER" },
  // Sales dummy (pemilik customer di kartu "Sales"); bukan akun uji peran Production.
  { key: "sales_fadlan", name: `${PREFIX} Sales Fadlan`, role: "SALES" }, { key: "sales_rifki", name: `${PREFIX} Sales Rifki`, role: "SALES" },
  { key: "sales_ervina", name: `${PREFIX} Sales Ervina`, role: "SALES" }, { key: "sales_kiki", name: `${PREFIX} Sales Kiki`, role: "SALES" },
]);
export const accountEmail = (key) => `${EMAIL_PREFIX}${key}@staging.invalid`;

export const MATERIALS = Object.freeze([
  ["BSA-D26", "Busa D26", "SHEET"], ["PER-BNL", "Per bonnell", "PCS"], ["LTX-05", "Latex 5 cm", "SHEET"], ["KAIN-RJT", "Kain rajut abu", "METER"], ["LEM-01", "Lem kasur", "KG"], ["RBD-10", "Rebonded 10 cm", "SHEET"],
]);

// 12 unit matriks demo — tiap baris = satu keadaan yang harus tampak di layar. stage: lihat STAGE_ORDER.
// prio: 0 normal, 1 tinggi, 2 mendesak. station=null -> belum dijadwalkan. photo: pickup (foto pickup driver) | manual (foto unggahan Production).
export const MATRIX = Object.freeze([
  { n: 1, kasur: "none", cust: "Pelanggan 01", city: "Bandung", sales: "Fadlan", svc: "Paket Upgrade Fondasi + Lapisan MS", note: "Minta lapisan atas lebih empuk", kg: 62, comp: ["SAKIT_PUNGGUNG"], size: "180 × 200", stage: "perjalanan", photo: "manual", prio: 0, station: null, label: "Dalam perjalanan (belum dijadwalkan)" },
  { n: 2, kasur: "partial", cust: "Pelanggan 02", city: "Jakarta Selatan", sales: "Rifki", svc: "Rubah Texture Menjadi Empuk/Keras", note: "Kasur terasa terlalu lembek", kg: 58, comp: ["SAKIT_PINGGANG"], size: "160 × 200", stage: "tiba", photo: "pickup", prio: 1, station: null, label: "Tiba, belum dijadwalkan — prioritas tinggi" },
  { n: 3, cust: "Pelanggan 03", city: "Depok", sales: "Ervina", svc: "Full Service (Service + Tambah Busa + Ganti Kain)", note: "Segera — pelanggan pindah rumah akhir pekan", kg: 75, comp: ["PEGAL_PEGAL"], size: "200 × 200", stage: "tiba", photo: "pickup", prio: 2, station: null, label: "Tiba, belum dijadwalkan — mendesak" },
  { n: 4, cust: "Pelanggan 04", city: "Bekasi", sales: "Kiki", svc: "Service Fondasi + Tambah Busa + Penggantian Per Bonnell Sisi Kanan + Pembersihan Total + Perlakuan Anti Tungau dan Antibakteri", note: "Kasur anak, jangan terlalu keras", kg: 45, comp: [], size: "120 × 200", stage: "bongkar", photo: "pickup", prio: 0, station: "TABLE_1", op: 0, docs: "kurang", label: "Meja 1 — tahap bongkar (diagnosis belum)" },
  { n: 5, cust: "Pelanggan 05 — Bapak Ahmad Sulaiman Wijayakusuma & Ibu Siti Nurhaliza Rahmawati", city: "Bogor", sales: "Kiki", svc: "Upgrade Fondasi Matras Sehat (150kg)", note: "Suami 84kg dan istri 53kg tidur menyamping; minta sisi suami lebih keras dan sisi istri lebih empuk; kain rajut abu-abu polos tanpa motif; mohon dihubungi sebelum pickup karena rumah di lantai 3 tanpa lift", kg: 84, comp: ["SAKIT_LEHER"], size: "180 × 200", stage: "bahan_kurang", photo: "manual", prio: 2, station: "TABLE_2", op: 1, docs: "kurang", label: "Meja 2 — menunggu bahan" },
  { n: 6, cust: "Pelanggan 06", city: "Bandung", sales: "Fadlan", svc: "Paket Upgrade Fondasi + Lapisan MS", note: "Kasur amblas sisi kanan", kg: 60, comp: ["KEPALA_PUSING"], size: "180 × 200", stage: "lapisan_selesai", photo: "pickup", prio: 1, station: "TABLE_2", op: 1, docs: "kurang", label: "Meja 2 — lapisan selesai, uji tekstur berikutnya" },
  { n: 7, cust: "Pelanggan 07", city: "Tangerang", sales: "Rifki", svc: "Ganti Kain", note: "", kg: 70, comp: ["BAHU"], size: "160 × 200", stage: "menunggu_qc", photo: "pickup", prio: 0, station: "TABLE_3", op: 2, docs: "kurang", label: "Meja 3 — menunggu QC" },
  { n: 8, cust: "Pelanggan 08", city: "Jakarta Timur", sales: "Ervina", svc: "Paket Upgrade Fondasi + Lapisan MS", note: "Untuk orang tua — jangan terlalu keras", kg: 95, comp: ["SAKIT_PINGGANG"], size: "200 × 200", stage: "qc_gagal", photo: "pickup", prio: 1, station: "TABLE_3", op: 2, docs: "kurang", label: "Meja 3 — QC gagal, rework" },
  { n: 9, cust: "Pelanggan 09", city: "Bandung", sales: "Fadlan", svc: "Full Service (Service + Tambah Busa + Ganti Kain)", note: "Motif kain mau polos abu-abu", kg: 55, comp: ["PEGAL_PEGAL"], size: "160 × 200", stage: "corner", photo: "pickup", prio: 0, station: "TABLE_4", op: 3, corner: 0, docs: "kurang", label: "Meja 4 — di Corner" },
  { n: 10, cust: "Pelanggan 10", city: "Jakarta Selatan", sales: "Kiki", svc: "Service Fondasi + Tambah Busa", note: "Sisa busa harus dikembalikan", kg: 88, comp: ["SAKIT_PINGGANG"], size: "160 × 200", stage: "menunggu_retur", photo: "pickup", prio: 2, station: "TABLE_4", op: 3, corner: 1, docs: "kurang", label: "Meja 4 — menunggu retur sisa bahan" },
  { n: 11, cust: "Pelanggan 11", city: "Bandung", sales: "Rifki", svc: "Paket Upgrade Fondasi + Lapisan MS", note: "Sudah selesai, siap diantar", kg: 68, comp: ["SAKIT_PINGGANG"], size: "180 × 200", stage: "siap_kirim", photo: "pickup", prio: 0, station: "TABLE_1", op: 0, corner: 1, docs: "lengkap", label: "Meja 1 — siap kirim, dokumentasi lengkap" },
  { n: 12, cust: "Pelanggan 12", city: "Depok", sales: "Ervina", svc: "Upgrade Fondasi Matras Sehat (150kg)", note: "Pickup besok pagi", kg: 80, comp: ["SAKIT_PUNGGUNG"], size: "180 × 200", stage: "akan_masuk", photo: "none", prio: 0, station: null, label: "Akan masuk — pickup terjadwal (forecast)" },
]);
export const STAGE_ORDER = Object.freeze(["akan_masuk", "perjalanan", "tiba", "bongkar", "diagnosa", "bahan_kurang", "fondasi", "lapisan", "lapisan_selesai", "menunggu_qc", "qc_gagal", "corner", "menunggu_retur", "siap_kirim"]);
const DIAG = { diagnosis: "Per tengah lemah dan busa penopang kempes sehingga pinggang melengkung saat tidur.", inputMethod: "TEXT" };

const credsFile = (ctx) => path.resolve(ctx.dataDir, "qa-pv2-credentials.json");
const unitCodeOf = (n) => qaCode(`U${String(n).padStart(2, "0")}`);
const orderNoOf = (n) => qaCode(`RES-${String(n).padStart(4, "0")}`);

// ---------------------------------------------------------------- master data + akun -------------------------------------------------------------------------------------------------
export async function ensureMaster(ctx, { rotate = false } = {}) {
  const { prisma, kit } = ctx; const log = ctx.log;
  const existingCreds = fs.existsSync(credsFile(ctx)) ? JSON.parse(fs.readFileSync(credsFile(ctx), "utf8")) : {};
  const creds = { ...existingCreds }; let credsChanged = false;
  const accounts = {};
  for (const a of ACCOUNTS) {
    const email = accountEmail(a.key);
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user || rotate || !creds[email]) {
      const pw = crypto.randomBytes(12).toString("base64url"); creds[email] = pw; credsChanged = true;
      const passwordHash = await bcrypt.hash(pw, 10);
      user = user ? await prisma.user.update({ where: { id: user.id }, data: { passwordHash, active: true, role: a.role, name: a.name } }) : await prisma.user.create({ data: { name: a.name, email, passwordHash, role: a.role, active: true } });
      log(`  akun ${a.key}: ${existingCreds[email] ? "password dirotasi" : "dibuat"}`);
    }
    accounts[a.key] = { ...a, id: user.id, email, token: kit.tokenFor(user, [a.role]) };
  }
  if (credsChanged) { fs.mkdirSync(path.dirname(credsFile(ctx)), { recursive: true }); fs.writeFileSync(credsFile(ctx), JSON.stringify(creds, null, 2), { mode: 0o600 }); }

  const wc = (await prisma.workCenter.findUnique({ where: { code: qaCode("WC-1") } })) || (await prisma.workCenter.create({ data: { code: qaCode("WC-1"), name: `${PREFIX} Workshop` } }));
  const operators = { TABLE: [], CORNER: [] };
  for (const a of ACCOUNTS.filter((x) => x.operator)) {
    const op = (await prisma.productionOperator.findUnique({ where: { userId: accounts[a.key].id } })) || (await prisma.productionOperator.create({ data: { userId: accounts[a.key].id, primaryWorkCenterId: wc.id } }));
    operators[a.operator].push({ key: a.key, id: op.id });
  }
  const wh = (await prisma.warehouse.findUnique({ where: { code: qaCode("WH-1") } })) || (await prisma.warehouse.create({ data: { code: qaCode("WH-1"), name: `${PREFIX} Gudang` } }));
  const loc = async (code, zone, locationType) => (await prisma.storageLocation.findUnique({ where: { code } })) || prisma.storageLocation.create({ data: { warehouseId: wh.id, zone, locationType, code } });
  const rcv = await loc(qaCode("RCV-1"), "RCV", "RECEIVING_AREA"); const fg = await loc(qaCode("FG-1"), "FG", "FINISHED_GOODS_AREA");
  const materials = {};
  for (const [code, name, unit] of MATERIALS) {
    const full = qaCode(code);
    let m = await prisma.material.findUnique({ where: { code: full } });
    if (!m) { m = await prisma.material.create({ data: { code: full, name: `${PREFIX} ${name}`, unit, category: "RAW_MATERIAL", active: true } }); await prisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 500, note: `${PREFIX} stok awal` } }); }
    materials[code] = m;
  }
  const service = (await prisma.serviceCatalog.findFirstOrThrow({ where: { code: "UPG_FONDASI_LAPISAN", active: true } }));
  return { accounts, wc, operators, wh, rcv, fg, materials, service };
}

async function addToCohort(ctx, unitIds) {
  const { prisma } = ctx;
  for (const key of ["production_v2_writer", "production_v2_reader"]) {
    const cur = await prisma.v2FeatureFlag.findUnique({ where: { key } });
    const ids = [...new Set([...(cur?.config?.unitIds || []), ...unitIds])];
    await prisma.v2FeatureFlag.upsert({ where: { key }, create: { key, enabled: true, scope: "GLOBAL", config: { unitIds: ids }, reason: `${PREFIX} staging cohort` }, update: { enabled: true, config: { unitIds: ids }, reason: `${PREFIX} staging cohort` } });
  }
}

// ---------------------------------------------------------------- satu unit: dari order sampai tahap yang diminta ------------------------------------------------------------------
export async function ensureUnit(ctx, W, spec) {
  const { prisma, kit } = ctx; const A = W.accounts;
  const code = unitCodeOf(spec.n);
  const existing = await prisma.unit.findUnique({ where: { unitCode: code } });
  if (existing) { ctx.log(`  ${code}: sudah ada — dilewati (idempoten)`); return { code, unitId: existing.id, existed: true }; }
  const customer = await prisma.customer.create({ data: { name: `${PREFIX} ${spec.cust}`, city: spec.city, assignedSalesId: A[`sales_${spec.sales.toLowerCase()}`]?.id ?? null } });
  const order = await prisma.order.create({ data: { customerId: customer.id, orderNumber: orderNoOf(spec.n), value: 1_500_000 + spec.n * 130_000, category: "LAYANAN", productType: spec.kasur === "none" ? null : ["KASUR_SPRING", "KASUR_BUSA", "KASUR_2IN1_ATAS", "KASUR_SPRING"][spec.n % 4], beratBadan: spec.kg, complaintCategory: spec.comp, notes: spec.note ? `${spec.note}` : null, customerPromiseDate: new Date(Date.now() + (3 + (spec.n % 5)) * 86_400_000) } });
  await prisma.orderItem.create({ data: { orderId: order.id, layananName: spec.svc, harga: 1_500_000 + spec.n * 130_000, sortOrder: 0 } });
  const unit = await prisma.unit.create({ data: { unitCode: code, orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: spec.kasur ? null : ["King Koil", "Serta", "Comforta", "Florence"][spec.n % 4], ukuran: spec.kasur ? null : spec.size } });
  await addToCohort(ctx, [unit.id]);
  ctx.log(`  ${code}: order+unit dibuat → ${spec.stage}`);
  await advance(ctx, W, spec, { unit, order });
  return { code, unitId: unit.id, existed: false };
}

async function advance(ctx, W, spec, { unit, order }) {
  const { prisma, kit } = ctx; const A = W.accounts;
  const stage = STAGE_ORDER.indexOf(spec.stage); if (stage < 0) throw new Error(`stage tidak dikenal: ${spec.stage}`);
  const at = (s) => stage >= STAGE_ORDER.indexOf(s);
  if (spec.stage === "akan_masuk") { // pickup TERJADWAL (belum dijemput): forecast kedatangan, belum punya Run — bukan WIP/target
    const route = await prisma.route.create({ data: { code: qaCode(`RTE-${String(spec.n).padStart(2, "0")}-${Date.now().toString(36)}`), date: new Date(), status: "PUBLISHED", publishedAt: new Date(), driverId: A.driver.id } });
    const job = await prisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: A.driver.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date(Date.now() + 86_400_000) } });
    await prisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
    return;
  }
  // --- pickup driver (foto pickup fixture lokal) ---
  const podName = `${PREFIX}-pod-${String(spec.n).padStart(2, "0")}.png`;
  const podDir = path.resolve(ctx.dataDir, "job-photos"); fs.mkdirSync(podDir, { recursive: true });
  const withProof = spec.photo === "pickup";
  if (withProof) fs.writeFileSync(path.join(podDir, podName), png(320, 240, (spec.n * 47) % 360));
  const route = await prisma.route.create({ data: { code: qaCode(`RTE-${String(spec.n).padStart(2, "0")}-${Date.now().toString(36)}`), date: new Date(), status: "PUBLISHED", publishedAt: new Date(), driverId: A.driver.id } });
  const job = await prisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: A.driver.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date() } });
  await prisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  await kit.post(A.driver, `/api/armada/jobs/${job.id}/start`, {}); await kit.post(A.driver, `/api/armada/jobs/${job.id}/arrive`, { location: null });
  await kit.post(A.driver, `/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: withProof ? [`/media/job-photos/${podName}`] : ["/media/job-photos/pod-placeholder.png"], recipientName: "Penjaga", note: "QA-PV2", location: null });
  if (!withProof) await prisma.job.update({ where: { id: job.id }, data: { proofPhotoUrls: [] } });
  const run = await prisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  if (spec.photo === "manual") await kit.upload(A.lead, `${V2}/units/${unit.id}/photo`, { field: "photo" });
  if (!at("tiba")) return;
  const handoff = await prisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id, direction: "INBOUND" } });
  await kit.post(A.gudang, `/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: W.rcv.id, expectedRevision: 1 });
  const meja = spec.station ? A[`meja${spec.op + 1}`] : null; const mejaOp = spec.station ? W.operators.TABLE[spec.op] : null;
  const corner = spec.station ? A[`corner${(spec.corner ?? 0) + 1}`] : null; const cornerOp = spec.station ? W.operators.CORNER[spec.corner ?? 0] : null;
  let planned = null;
  const planBody = (date, station) => ({ runId: run.id, productionDate: date, stationCode: station, priority: spec.prio || 0, workCenterId: W.wc.id, operatorId: (mejaOp || W.operators.TABLE[3]).id, ...(cornerOp ? { cornerOperatorId: cornerOp.id } : {}) });
  if (spec.station) planned = await kit.post(A.lead, `${V2}/plans`, planBody(wibDate(spec.day ?? 0), spec.station));
  else if (spec.prio) { // belum dijadwalkan tetapi ber-prioritas: buat rencana lalu keluarkan dari papan (tanggal & meja null)
    const p = await kit.post(A.lead, `${V2}/plans`, planBody(wibDate(2), "TABLE_4"));
    await kit.post(A.lead, `${V2}/plans/${p.planId || p.id}/schedule`, { expectedRevision: p.revision, productionDate: null, stationCode: null, priority: spec.prio, workCenterId: W.wc.id, operatorId: W.operators.TABLE[3].id });
  }
  if (!planned) { await maybeDocs(ctx, W, spec, run.id); return; }
  const rev = async () => (await kit.get(A.lead, `${V2}/runs/${run.id}/card`)).revision;
  const media = async (who, ...kinds) => (await kit.upload(who, `${V2}/evidence/upload`, { runId: run.id, files: kinds.length, video: kinds[0] === "v" })).items.map((i) => i.url);
  const step = async (who, n, payload = {}, mediaUrls = []) => kit.post(who, `${V2}/runs/${run.id}/steps/${n}`, { expectedRevision: await rev(), workCenterId: W.wc.id, payload, media: mediaUrls });
  const planId = planned.planId || planned.id;
  if (spec.stage === "bongkar") { // Tahap Bongkar: Langkah 1-2 selesai, hasil bongkar (3) berikutnya
    await step(meja, 1, { conditionConfirmed: true, conditionNote: "kain luar kusam" }, await media(meja, "i"));
    await step(meja, 2, { feelNote: "Tengah terasa amblas" }, await media(meja, "v"));
    await maybeDocs(ctx, W, spec, run.id); return;
  }
  if (at("diagnosa")) {
    await step(meja, 1, { conditionConfirmed: true, conditionNote: "kain luar kusam" }, await media(meja, "i"));
    await step(meja, 2, { feelNote: "Tengah terasa amblas" }, await media(meja, "v"));
    await step(meja, 3, { oldMaterials: ["PER", { type: "BUSA", note: "kuning kempes" }] }, await media(meja, "i", "i"));
    await step(meja, 4, { heightBeforeCm: 24, heightCompressedCm: 17, testerWeightKg: spec.kg, foundationIssues: ["Per tengah lemah"] }, await media(meja, "v"));
  }
  if (spec.stage === "diagnosa") { await maybeDocs(ctx, W, spec, run.id); return; }
  // diagnosis + BOM
  await step(meja, 5, DIAG);
  await kit.patch(A.lead, `/api/units/${unit.id}/service`, { serviceId: W.service.id });
  const plan = await kit.get(A.lead, `${P}/plans/${planId}`);
  const bom = await kit.post(A.lead, `${P}/plans/${planId}/bom`, { lines: [{ materialId: W.materials["PER-BNL"].id, qty: 1 }, { materialId: W.materials["LTX-05"].id, qty: 2 }], expectedRevision: plan.revision });
  if (spec.stage === "bahan_kurang") {
    await kit.post(meja, `${V2}/runs/${run.id}/material-shortage`, { expectedRevision: await rev(), workCenterId: W.wc.id, items: [{ materialId: W.materials["BSA-D26"].id, qty: 4, note: "Stok gudang tidak cukup" }], note: "Menunggu busa D26 dari supplier" });
    await maybeDocs(ctx, W, spec, run.id); return;
  }
  await kit.post(A.gudang, `${P}/plans/${planId}/reserve`, { expectedRevision: bom.revision });
  const mr = await kit.post(A.gudang, `${P}/plans/${planId}/material-request`, {});
  await step(meja, 5, {});
  await kit.post(A.gudang, `${P}/material-requests/${mr.issueId}/pick`, { expectedRevision: 1 });
  await step(meja, 6, {}); // mulai fondasi
  if (spec.stage === "fondasi") { await maybeDocs(ctx, W, spec, run.id); return; }
  await step(meja, 6, { note: "Pocket spring baru + penguat pinggir", materials: [{ materialId: W.materials["PER-BNL"].id, qty: 1 }] }, await media(meja, "v"));
  const usedLapisan = spec.stage === "menunggu_retur" ? 1 : 2;
  if (spec.stage === "lapisan") { await maybeDocs(ctx, W, spec, run.id); return; } // fondasi selesai, tahap lapisan (7) berikutnya — tahap 7 tak punya langkah "mulai" terpisah
  await step(meja, 7, { materials: [{ materialId: W.materials["LTX-05"].id, qty: usedLapisan }] }, await media(meja, "i"));
  if (spec.stage === "lapisan_selesai") { await maybeDocs(ctx, W, spec, run.id); return; } // Lapisan Jadi: uji tekstur akhir (8) belum dikirim
  await step(meja, 8, { verdict: "PAS", testerWeightKg: spec.kg }, await media(meja, "v"));
  if (spec.stage === "menunggu_qc") { await maybeDocs(ctx, W, spec, run.id); return; }
  const qcRun = await kit.get(A.qc, `${P}/qc/runs/${run.id}`);
  if (spec.stage === "qc_gagal") {
    const gate = qcRun.stages.find((s) => s.isQcGate); const reworkStage = qcRun.stages.filter((s) => !s.isQcGate && s.order < gate.order).at(-1);
    await kit.post(A.qc, `${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "FAIL", photoUrls: ["/media/job-photos/qa-pv2-qc.png"], referenceWeightKg: spec.kg, fitVerdict: "TERLALU_KERAS", note: "Kasur terlalu keras di area pinggang", reworkStageId: reworkStage.id });
    await maybeDocs(ctx, W, spec, run.id); return;
  }
  await kit.post(A.qc, `${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qa-pv2-qc.png"], referenceWeightKg: spec.kg, fitVerdict: "PAS", note: "lulus uji" });
  await step(meja, 9, { note: "siap dibungkus" }, await media(meja, "i"));
  await step(corner, 10, { mattressStyle: "PILLOWTOP", fabricSpec: "Knitting putih quilting", borderColor: "Abu-abu tua" });
  if (spec.stage === "corner") { await maybeDocs(ctx, W, spec, run.id); return; }
  await step(corner, 11, { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, await media(meja, "i", "v"));
  const fin = await step(corner, 12, { confirm: true }, await media(meja, "i"));
  await maybeDocs(ctx, W, spec, run.id);
  if (spec.stage === "menunggu_retur") return; // sisa bahan PENDING menahan penerimaan barang jadi
  const fgh = await prisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id, direction: "FINISHED_GOODS" } });
  await kit.post(A.gudang, `/api/inventory/unit-custody/${fgh.id}/accept`, { locationId: W.fg.id, expectedRevision: fgh.revision });
  void fin;
}

// Dokumentasi: "lengkap" = minimum setiap kategori terpenuhi; "kurang" = hanya sebagian kategori awal.
async function maybeDocs(ctx, W, spec, runId) {
  if (!spec.docs) return;
  const { kit } = ctx; const who = W.accounts.dokumentasi;
  const cats = spec.docs === "lengkap" ? DOC_CATEGORIES : DOC_CATEGORIES.slice(0, 2);
  for (const c of cats) {
    const n = spec.docs === "lengkap" ? c.min : Math.max(1, c.min - 1);
    const up = await kit.upload(who, `${V2}/documentation/upload`, { runId, files: n });
    await kit.post(who, `${V2}/documentation/runs/${runId}/submit`, { category: c.key, items: up.items });
  }
}

export async function seedMatrix(ctx, W) {
  const out = [];
  for (const spec of MATRIX) out.push({ n: spec.n, label: spec.label, ...(await ensureUnit(ctx, W, spec)) });
  return out;
}

// ---------------------------------------------------------------- lifecycle end-to-end baru (unit baru, nomor berikutnya) ----------------------------------------------------------
export async function runLifecycle(ctx, W, { stage = "siap_kirim", station = "TABLE_1", prio = 1, docs = "lengkap", photo = "pickup", day = 1 } = {}) {
  // nomor lifecycle baru = maksimum nomor unit >= 100 yang ada + 1 (matriks demo memakai 1..12)
  const used = await ctx.prisma.unit.findMany({ where: { unitCode: { startsWith: `${PREFIX}-U` } }, select: { unitCode: true } });
  const nextN = Math.max(100, ...used.map((u) => Number(u.unitCode.slice(`${PREFIX}-U`.length)) || 0)) + 1;
  const spec = { n: nextN, cust: `Lifecycle ${nextN}`, city: "Bandung", sales: "Fadlan", svc: "Paket Upgrade Fondasi + Lapisan MS", note: "Lifecycle uji end-to-end", kg: 70, comp: ["SAKIT_PINGGANG"], size: "180 × 200", stage, photo, prio, station, day, op: 0, corner: 0, docs, label: "lifecycle" };
  const t0 = Date.now();
  const res = await ensureUnit(ctx, W, spec);
  return { ...res, stage, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------- status & reset -------------------------------------------------------------------------------------------------------
export async function statusQaPv2(ctx) {
  const { prisma } = ctx;
  const units = await prisma.unit.findMany({ where: { unitCode: { startsWith: `${PREFIX}-` } }, orderBy: { unitCode: "asc" }, select: { unitCode: true, status: true, id: true } });
  const runs = await prisma.productionRun.findMany({ where: { unitId: { in: units.map((u) => u.id) } }, select: { unitId: true, status: true, currentPhase: true } });
  const foreign = await foreignRows(ctx);
  return { units: units.map((u) => ({ unitCode: u.unitCode, unitStatus: u.status, run: runs.find((r) => r.unitId === u.id) ? `${runs.find((r) => r.unitId === u.id).status}/${runs.find((r) => r.unitId === u.id).currentPhase}` : null })), accounts: await prisma.user.count({ where: { email: { startsWith: EMAIL_PREFIX } } }), foreign };
}

// Baris NON-QA-PV2 pada tabel bisnis kunci. Reset menolak jalan bila ada (database staging harus murni QA-PV2).
export async function foreignRows(ctx) {
  const { prisma } = ctx; const q = (sql) => prisma.$queryRawUnsafe(sql).then((r) => Number(r[0].c));
  const like = `${PREFIX}%`;
  return {
    users: await q(`select count(*)::int c from "User" where email not like '${EMAIL_PREFIX}%'`),
    customers: await q(`select count(*)::int c from "Customer" where coalesce(name, '') not like '${like}'`),
    orders: await q(`select count(*)::int c from "Order" where coalesce("orderNumber", '') not like '${like}'`),
    units: await q(`select count(*)::int c from units where unit_code not like '${like}'`),
    materials: await q(`select count(*)::int c from materials where code not like '${like}'`),
    workCenters: await q(`select count(*)::int c from work_centers where code not like '${like}'`),
  };
}

export async function resetQaPv2(ctx, { yes = false } = {}) {
  const { prisma } = ctx;
  if (!yes) throw new Error("reset membutuhkan --yes");
  const foreign = await foreignRows(ctx);
  const bad = Object.entries(foreign).filter(([, c]) => c > 0);
  if (bad.length) throw new Error(`reset DITOLAK: ada data non-${PREFIX} (${bad.map(([k, c]) => `${k}=${c}`).join(", ")}) — staging harus murni ${PREFIX}`);
  return wipeNonBaseline(ctx);
}

// Pengosongan semua tabel non-baseline. TANPA pemeriksaan data asing: hanya dipanggil resetQaPv2 (sesudah pemeriksaan) dan tes pada DB uji sekali pakai.
export async function wipeNonBaseline(ctx) {
  const { prisma } = ctx;
  const tables = (await prisma.$queryRawUnsafe("select tablename from pg_tables where schemaname='public' order by 1")).map((r) => r.tablename).filter((t) => !BASELINE_TABLES.includes(t));
  // Tabel non-baseline yang DIREFERENSI tabel baseline (mis. work_centers <- routing_stages) tidak boleh di-TRUNCATE; baris ber-prefix dihapus satu per satu.
  const clean = (n) => String(n).replace(/"/g, "").replace(/^public\./, "");
  const fks = await prisma.$queryRawUnsafe("select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace");
  const keep = new Set(fks.filter((f) => BASELINE_TABLES.includes(clean(f.child)) && !BASELINE_TABLES.includes(clean(f.parent))).map((f) => clean(f.parent)));
  const truncate = tables.filter((t) => !keep.has(t));
  const list = truncate.map((t) => `"${t.replace(/"/g, '""')}"`).join(", ");
  // Tanpa CASCADE: bila tabel baseline mereferensi tabel yang dikosongkan, Postgres menolak (fail-closed).
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY`);
  for (const t of keep) {
    const hasCode = (await prisma.$queryRawUnsafe(`select 1 from information_schema.columns where table_schema='public' and table_name='${t.replace(/'/g, "''")}' and column_name='code'`)).length > 0;
    if (!hasCode) throw new Error(`reset DITOLAK: tabel ${t} direferensi tabel baseline tetapi tidak punya kolom code untuk penghapusan per-prefix`);
    await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE code LIKE '${PREFIX}-%'`);
  }
  // Entri baseline ber-prefix QA-PV2 (lokasi/gudang buatan seeder) dihapus per-prefix; baseline asli tidak disentuh.
  await prisma.$executeRawUnsafe(`DELETE FROM storage_locations WHERE code LIKE '${PREFIX}-%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM warehouses WHERE code LIKE '${PREFIX}-%'`);
  let files = 0;
  for (const rel of ["job-photos", "unit-photo-evidence", "production-evidence", "unit-photos"]) {
    const dir = path.resolve(ctx.dataDir, rel); if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) { if (f === ".gitkeep") continue; const p = path.join(dir, f); if (fs.statSync(p).isFile()) { fs.rmSync(p); files += 1; } }
  }
  fs.rmSync(credsFile(ctx), { force: true });
  return { truncated: truncate.length, deletedByPrefix: [...keep], mediaFiles: files };
}
