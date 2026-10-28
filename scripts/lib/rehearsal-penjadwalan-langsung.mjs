import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-penjadwalan-langsung.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji penjadwalan langsung hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Penjadwalan langsung": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Semua tulisan hanya di DB sementara ini: data uji sintetis (order/unit/Run) dibuat di DB ini; unit nyata hanya dijadwalkan lalu diurungkan pada salinan.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4101); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
let adm = info.find((x) => bisa(x.rs, P.UNIT_ROUTING_WRITE))?.u; let lihat = info.find((x) => !bisa(x.rs, P.UNIT_ROUTING_WRITE) && bisa(x.rs, P.UNIT_READ))?.u;
if (!adm) adm = await prisma.user.create({ data: { name: "REH Admin", email: `reh-adm-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
if (!lihat) lihat = await prisma.user.create({ data: { name: "REH Sales", email: `reh-sls-${Date.now()}@example.test`, passwordHash: "x", role: "SALES" } });
cek("akun uji tersedia: penjadwal (UNIT_ROUTING_WRITE) dan akun hanya-lihat", !!adm && !!lihat && adm.id !== lihat.id);
const tA = await token(adm); const tS = await token(lihat);
const H = async (metode, p, tok, body = null, kunci = null) => { const r = await fetch(BASE + p, { method: metode, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(kunci ? { "Idempotency-Key": kunci } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
let seq = 0; const kunci = (p) => `reh-pjl-${p}-${Date.now().toString(36)}-${++seq}-xxxxxxxx`;
const PRD = "/api/production"; const HARI = 86400_000;
const dkey = (d) => new Date(d).toISOString().slice(0, 10); const wibHariIni = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const tambahHari = (k, nHari) => dkey(new Date(`${k}T00:00:00Z`).getTime() + nHari * HARI); const dow = (k) => new Date(`${k}T00:00:00Z`).getUTCDay();

// ── A. Bacaan bentuk baru pada data produksi nyata (salinan): kalender, hari, antrean satu daftar
const hariIni = wibHariIni();
const mg = await H("GET", `${PRD}/rencana/minggu?start=${hariIni}`, tA); const hr = await H("GET", `${PRD}/rencana/hari?date=${hariIni}`, tA);
const bl = await H("GET", `${PRD}/rencana/antrean?tab=BELUM&pageSize=100`, tA); const sp = await H("GET", `${PRD}/rencana/antrean?tab=SIAP&pageSize=5`, tA); const mt = await H("GET", `${PRD}/rencana/antrean?tab=MENUNGGU_TIBA&pageSize=5`, tA);
cek("bacaan: minggu 7 hari, rincian hari, antrean BELUM/SIAP/MENUNGGU_TIBA 200 pada data nyata", mg.status === 200 && mg.body?.days?.length === 7 && hr.status === 200 && bl.status === 200 && sp.status === 200 && mt.status === 200, `${mg.status}/${hr.status}/${bl.status}/${sp.status}/${mt.status}`);
cek(`satu antrean: BELUM = SIAP + MENUNGGU_TIBA (${bl.body?.counts?.BELUM} = ${bl.body?.counts?.SIAP} + ${bl.body?.counts?.MENUNGGU_TIBA}); setiap kartu membawa jumlahUnitOrder/unitKe/saudaraSiap`, bl.body?.counts?.BELUM === bl.body?.counts?.SIAP + bl.body?.counts?.MENUNGGU_TIBA && (bl.body?.items ?? []).every((i) => Number.isInteger(i.jumlahUnitOrder) && i.jumlahUnitOrder >= 1 && i.unitKe >= 1 && Array.isArray(i.saudaraSiap)));
cek("antrean nyata: tidak ada unit dengan hambatan RUN_OUTSIDE_COHORT di 'Butuh keputusan'", !((await H("GET", `${PRD}/rencana/antrean?tab=KEPUTUSAN&pageSize=100`, tA)).body?.items ?? []).some((i) => /di luar cohort/i.test(i.alasan ?? "")));

// ── B. data uji sintetis pada DB sementara + hari kosong
const wh = await prisma.warehouse.create({ data: { code: `WH-REH-${Date.now().toString(36)}`, name: "Gudang REH" } });
const rcv = await prisma.storageLocation.create({ data: { warehouseId: wh.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-REH-${Date.now().toString(36)}` } });
let ns = 0;
async function mkOrder(jumlah = 1, { orderStatus = "PROCESSING", unitStatus = "RECEIVED", received = true } = {}) {
  const customer = await prisma.customer.create({ data: { name: `Pelanggan REH ${++ns}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await prisma.order.create({ data: { customerId: customer.id, orderNumber: `RES-REH-${Date.now().toString(36)}-${++ns}`, value: 1_000_000 * jumlah, category: "LAYANAN", status: orderStatus, pickupConfirmedDate: new Date(), items: { create: [{ layananName: "Service Fondasi", harga: 1_000_000, sortOrder: 1 }] } } });
  const units = [];
  for (let i = 1; i <= jumlah; i += 1) {
    const unit = await prisma.unit.create({ data: { unitCode: `${order.orderNumber}-U${i}`, orderId: order.id, seq: i, status: unitStatus, merk: "King Koil", ukuran: "160x200" } });
    const job = await prisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } }); await prisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
    if (received) await prisma.unitWorkshopReceipt.create({ data: { unitId: unit.id, seq: i, locationId: rcv.id, receivedById: adm.id } });
    units.push(unit);
  }
  return units;
}
// hari kerja yang KOSONG di salinan (tidak mengganggu rencana nyata): cari mulai 2 minggu ke depan
let H1 = null; for (let d = 14; d < 120 && !H1; d += 1) { const k = tambahHari(hariIni, d); if (dow(k) === 0) continue; const hh = await H("GET", `${PRD}/rencana/hari?date=${k}`, tA); if (hh.status === 200 && hh.body.stations.every((s) => s.items.length === 0) && hh.body.tanpaMeja.length === 0) H1 = k; }
let H2 = H1 ? tambahHari(H1, 1) : null; if (H2 && dow(H2) === 0) H2 = tambahHari(H2, 1);
cek(`hari kerja kosong ditemukan di salinan untuk uji (H1=${H1}, H2=${H2})`, !!H1 && !!H2);
if (!H1) { berhenti(); await prisma.$disconnect(); process.exit(1); }
const jejak = async () => ({ run: await prisma.productionRun.count(), op: await prisma.productionOperationRun.count(), tahap: await prisma.unitStageLog.count(), qc: await prisma.qualityInspection.count(), mov: await prisma.stockMovement.count(), mi: await prisma.materialIssue.count(), jur: await prisma.finJournalEntry.count(), rcp: await prisma.unitWorkshopReceipt.count(), plan: await prisma.productionRunPlan.count(), out: await prisma.domainOutbox.count(), msg: await prisma.message.count().catch(() => -1) });
const sama = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const batch = (tok, units, body = {}, k = kunci("jb")) => H("POST", `${PRD}/rencana/jadwal-batch`, tok, { productionDate: H1, stationCode: "TABLE_2", units: units.map((u) => ({ unitId: u.id, expectedRevision: 0 })), ...body }, k);
const jdw = (tok, u, body = {}, k = kunci("j1")) => H("POST", `${PRD}/units/${u.id}/jadwal`, tok, { productionDate: H1, stationCode: "TABLE_1", expectedRevision: 0, ...body }, k);

// ── C. satu unit: jadwal Admin resmi; tidak menyentuh tabel operasional
const [u1] = await mkOrder(1); const J0 = await jejak();
const r1 = await jdw(tA, u1); const J1 = await jejak();
cek("satu unit dijadwalkan (201, revisi 1); TIDAK ada Run/tahap/QC/penerimaan/stok/Material Issue/jurnal/rencana Meja/outbox baru", r1.status === 201 && r1.body?.revision === 1 && sama(J0, J1), `${r1.status} ${JSON.stringify(r1.body).slice(0, 100)}`);
const st1 = (await prisma.unit.findUniqueOrThrow({ where: { id: u1.id } })).status;
cek("status unit tidak berubah karena penjadwalan (RECEIVED tetap)", st1 === "RECEIVED", st1);
const ev1 = await prisma.activityEvent.count({ where: { entityId: u1.id, eventType: "PRODUCTION_ADMIN_SCHEDULE_SET" } }); const sch1 = await prisma.productionUnitSchedule.findUnique({ where: { unitId: u1.id } });
cek("jadwal tersimpan satu baris per unit + riwayat jadwal + log aktivitas (Riwayat unit)", sch1?.status === "ACTIVE" && dkey(sch1.productionDate) === H1 && sch1.stationCode === "TABLE_1" && ev1 === 1 && (await prisma.productionUnitScheduleEvent.count({ where: { unitId: u1.id } })) === 1);
const ad1 = await H("GET", `${PRD}/units/${u1.id}/adopsi`, tA); const wo = await H("GET", `${PRD}/work-orders?statusKerja=DIJADWALKAN&pageSize=100`, tA);
cek("status kerja 'Dijadwalkan' (drawer/Ringkasan) dan daftar+filter DIJADWALKAN memuat unit itu; bukan 'Sudah dikerjakan'", ad1.body?.adopsi?.kerja?.key === "DIJADWALKAN" && (wo.body?.units ?? []).some((x) => x.id === u1.id));
const kal = (await H("GET", `${PRD}/rencana/hari?date=${H1}`, tA)).body; const m1 = (await H("GET", `${PRD}/rencana/minggu?start=${H1}`, tA)).body.days.find((d) => d.date === H1);
cek("kalender hari + kapasitas minggu memuat jadwal itu (sumber data yang sama)", kal.stations.find((s) => s.code === "TABLE_1").items.some((x) => x.unitId === u1.id) && m1.terencana === 1 && m1.stations.find((s) => s.code === "TABLE_1").count === 1);
const un = await H("POST", `${PRD}/units/${u1.id}/jadwal/undo`, tA, { eventId: r1.body.eventId }, kunci("u1"));
cek("Urungkan satu unit: jadwal kembali kosong (CLEARED)", un.status === 201 && (await prisma.productionUnitSchedule.findUnique({ where: { unitId: u1.id } })).status === "CLEARED");

// ── D. beberapa unit: penempatan BERSAMA, semua-atau-tidak-sama-sekali, AUTO, idempoten
const tiga = await mkOrder(3); const kB = kunci("bt"); const b1 = await batch(tA, tiga, { stationCode: "TABLE_2" }, kB);
const baris = await prisma.productionUnitSchedule.findMany({ where: { unitId: { in: tiga.map((u) => u.id) }, status: "ACTIVE" } });
cek("batch 3 unit satu order → SATU meja (Meja 2) pada hari yang sama (201); hanya jadwal ditulis", b1.status === 201 && baris.length === 3 && baris.every((x) => x.stationCode === "TABLE_2" && dkey(x.productionDate) === H1), JSON.stringify(b1.body).slice(0, 120));
const bUlang = await batch(tA, tiga, { stationCode: "TABLE_2" }, kB); const bBeda = await batch(tA, tiga, { stationCode: "TABLE_3" }, kB);
cek("Idempotency-Key sama = hasil semula (200, replayed, tanpa baris baru); kunci sama untuk meja berbeda ditolak 409", bUlang.status === 200 && bUlang.body?.replayed === true && (await prisma.productionUnitSchedule.count({ where: { unitId: { in: tiga.map((u) => u.id) } } })) === 3 && bBeda.status === 409);
const dua = await mkOrder(2); const penuh = await batch(tA, dua, { stationCode: "TABLE_2" });
cek("kapasitas Meja 2 habis (3/3): 2 unit baru DITOLAK seluruhnya (409 PLAN_STATION_FULL) dengan penjelasan; tidak setengah tersimpan", penuh.status === 409 && penuh.body?.code === "PLAN_STATION_FULL" && /Tidak ada yang disimpan/.test(penuh.body?.error ?? "") && (await prisma.productionUnitSchedule.count({ where: { unitId: { in: dua.map((u) => u.id) } } })) === 0, penuh.body?.error);
const auto = await batch(tA, dua, { stationCode: "AUTO" }); cek("AUTO memilih meja pertama yang muat semua unit (Meja 1, kosong)", auto.status === 201 && auto.body?.stationCode === "TABLE_1", `${auto.status} ${auto.body?.stationCode}`);

// ── E. atomik: satu unit ditolak (selesai) / revisi basi → seluruh batch batal; unit selesai tidak berubah status
const e0 = await mkOrder(2); const [selesai] = await mkOrder(1, { unitStatus: "READY_FOR_DELIVERY" }); const cntE = await prisma.productionUnitSchedule.count();
const bs = await batch(tA, [e0[0], selesai], { productionDate: H2, stationCode: "TABLE_3" });
cek("batch dengan satu unit SELESAI ditolak 422 UNIT_FINISHED; unit lain TIDAK tersimpan; status unit selesai tidak mundur", bs.status === 422 && bs.body?.code === "JADWAL_UNIT_FINISHED" && (await prisma.productionUnitSchedule.count()) === cntE && (await prisma.unit.findUniqueOrThrow({ where: { id: selesai.id } })).status === "READY_FOR_DELIVERY", `${bs.status} ${bs.body?.code}`);
await jdw(tA, e0[1], { productionDate: H2, stationCode: "TABLE_4" }); const cntF = await prisma.productionUnitSchedule.count();
const basi = await batch(tA, e0, { productionDate: H2, stationCode: "TABLE_3" });
cek("batch dengan revisi basi (unit diubah orang lain) ditolak 409 JADWAL_REVISI_BASI dan menyebut unit penyebab; unit lain tidak tersimpan", basi.status === 409 && basi.body?.code === "JADWAL_REVISI_BASI" && (basi.body?.error ?? "").includes(e0[1].unitCode) && (await prisma.productionUnitSchedule.count()) === cntF, basi.body?.error);

// ── F. Urungkan batch: tidak menimpa perubahan orang lain; atomik
const items = b1.body.hasil.map((h) => ({ unitId: h.unitId, eventId: h.eventId }));
await jdw(tA, tiga[1], { productionDate: H2, stationCode: "TABLE_4", expectedRevision: 1 }); // orang lain memindahkan unit ke-2
const ug = await H("POST", `${PRD}/rencana/jadwal-batch/undo`, tA, { items }, kunci("ub"));
const sisa = await prisma.productionUnitSchedule.findMany({ where: { unitId: { in: tiga.map((u) => u.id) }, status: "ACTIVE" } });
cek("Urungkan batch ditolak 409 JADWAL_UNDO_TIDAK_BISA karena satu unit sudah diubah; SEMUA tetap (perubahan orang lain tidak ditimpa)", ug.status === 409 && ug.body?.code === "JADWAL_UNDO_TIDAK_BISA" && sisa.length === 3 && sisa.filter((x) => x.stationCode === "TABLE_2").length === 2 && sisa.some((x) => x.stationCode === "TABLE_4"), ug.body?.error);
const dua2 = await mkOrder(2); const bb = await batch(tA, dua2, { productionDate: H2, stationCode: "TABLE_1" }); const ug2 = await H("POST", `${PRD}/rencana/jadwal-batch/undo`, tA, { items: bb.body.hasil.map((h) => ({ unitId: h.unitId, eventId: h.eventId })) }, kunci("ub2"));
cek("Urungkan batch tanpa campur tangan: seluruhnya kembali belum dijadwalkan", ug2.status === 201 && (await prisma.productionUnitSchedule.count({ where: { unitId: { in: dua2.map((u) => u.id) }, status: "ACTIVE" } })) === 0);

// ── G. Run LAMA di luar cohort: bisa dijadwalkan tanpa menyentuh Run/riwayat lama dan tanpa penanda drift V1
const [lama] = await mkOrder(1); const run = await prisma.productionRun.create({ data: { unitId: lama.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS" } });
const runAwal = JSON.stringify(await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })); const jL0 = await jejak(); const rl = await jdw(tA, lama, { productionDate: H2, stationCode: "TABLE_2" });
const drift = await prisma.activityEvent.count({ where: { entityId: lama.id, eventType: "PRODUCTION_V1_WRITE_ON_V2_RUN" } }); const jL1 = await jejak();
cek(`unit dengan Run lama aktif: ${rl.status === 201 ? "dijadwalkan (201)" : "ditolak karena dimiliki V2 (409 UNIT_V2_OWNED) — writer V2 aktif untuk semua unit di salinan"}; Run tidak berubah; TANPA penanda drift V1; tabel operasional sama`, ((rl.status === 201) || (rl.status === 409 && rl.body?.code === "UNIT_V2_OWNED")) && JSON.stringify(await prisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })) === runAwal && drift === 0 && sama(jL0, jL1), `${rl.status} ${rl.body?.code ?? ""} drift=${drift}`);

// ── H. unit yang sudah punya jadwal bertanggal di rencana Meja tidak mendapat jadwal Admin kedua
const [dobel] = await mkOrder(1); const runD = await prisma.productionRun.create({ data: { unitId: dobel.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS" } });
await prisma.productionRunPlan.create({ data: { runId: runD.id, status: "PLANNED", productionDate: new Date(`${H2}T00:00:00.000Z`), stationCode: "TABLE_4" } });
const rd = await jdw(tA, dobel, { productionDate: H2, stationCode: "TABLE_2" });
cek("unit yang sudah terjadwal di rencana Meja: jadwal Admin kedua ditolak (409 JADWAL_SUDAH_DI_RENCANA_MEJA atau UNIT_V2_OWNED); tidak ada baris jadwal Admin", rd.status === 409 && ["JADWAL_SUDAH_DI_RENCANA_MEJA", "UNIT_V2_OWNED"].includes(rd.body?.code) && (await prisma.productionUnitSchedule.count({ where: { unitId: dobel.id } })) === 0, `${rd.status} ${rd.body?.code}`);

// ── I. izin dan penegakan sebelum menulis
const cntI = await prisma.productionUnitSchedule.count(); const [ui] = await mkOrder(1);
const i401 = await batch(null, [ui]); const i403 = await batch(tS, [ui]); const i403u = await H("POST", `${PRD}/rencana/jadwal-batch/undo`, tS, { items: [{ unitId: ui.id, eventId: "x" }] }, kunci("us"));
const iKunci = await H("POST", `${PRD}/rencana/jadwal-batch`, tA, { productionDate: H1, stationCode: "TABLE_1", units: [{ unitId: ui.id, expectedRevision: 0 }] });
const iBanyak = await H("POST", `${PRD}/rencana/jadwal-batch`, tA, { productionDate: H1, stationCode: "TABLE_1", units: Array.from({ length: 21 }, (_, i) => ({ unitId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, expectedRevision: 0 })) }, kunci("by"));
const iLewat = await batch(tA, [ui], { productionDate: tambahHari(hariIni, -1) }); let mg0 = tambahHari(hariIni, 1); while (dow(mg0) !== 0) mg0 = tambahHari(mg0, 1); const iMinggu = await batch(tA, [ui], { productionDate: mg0 });
cek("izin & penegakan: tanpa token 401; hanya-lihat 403 (batch dan undo batch); tanpa kunci 400; >20 unit 400; tanggal lewat/Minggu 422 — tidak ada tulisan", i401.status === 401 && i403.status === 403 && i403u.status === 403 && iKunci.status === 400 && iBanyak.status === 400 && iLewat.status === 422 && iMinggu.status === 422 && (await prisma.productionUnitSchedule.count()) === cntI, [i401, i403, i403u, iKunci, iBanyak, iLewat, iMinggu].map((x) => x.status).join("/"));

// ── J. unit NYATA dari salinan: jadwal + urungkan (bentuk data produksi sebenarnya)
const nyata = (await H("GET", `${PRD}/rencana/antrean?tab=BELUM&pageSize=100`, tA)).body?.items?.find((i) => i.boleh && i.jalur === "ADMIN" && !String(i.unitCode).includes("REH"));
if (nyata) {
  const jN0 = await jejak(); const rN = await H("POST", `${PRD}/units/${nyata.unitId}/jadwal`, tA, { productionDate: H2, stationCode: "TABLE_3", expectedRevision: nyata.revisiJadwal ?? 0, expectedUnit: nyata.unitCas }, kunci("nyata"));
  const uN = rN.status === 201 ? await H("POST", `${PRD}/units/${nyata.unitId}/jadwal/undo`, tA, { eventId: rN.body.eventId }, kunci("nyataU")) : null;
  cek(`unit NYATA di salinan (${nyata.unitCode}, ${nyata.diterima ? "di workshop" : "belum tiba"}): dijadwalkan lalu diurungkan; tabel operasional tidak berubah`, rN.status === 201 && uN?.status === 201 && sama(jN0, await jejak()), `${rN.status}/${uN?.status} ${rN.body?.code ?? ""}`);
} else cek("unit nyata siap dijadwalkan tersedia di salinan (dilewati: tidak ada unit nyata yang boleh dijadwalkan)", true, "dilewati");

// ── K. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), BASE_GANDA: "0", ORDER_N: String(await num('select count(*)::int n from "Order"')), JOB_N: String(await num("select count(*)::int n from jobs")) } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
