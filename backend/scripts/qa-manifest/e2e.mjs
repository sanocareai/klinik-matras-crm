// E2E HTTP terhadap proses server QA sungguhan (bukan in-process): meniru klien RN driver-mobile tanpa perangkat.
// Menyalakan 2 server: gerbang MATI (port A) dan KAPABEL (port B) — pada DB QA yang sama. Job dibuat BARU per skenario.
//   QA_DATABASE_URL=...km_qa_manifest_test node scripts/qa-manifest/e2e.mjs
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertQaDb, seedUsers, seedJob, aktifkanFlagV2, kunci, QA_PASSWORD, QA_DRIVER_EMAIL } from "./lib.mjs";

const url = process.env.QA_DATABASE_URL; assertQaDb(url);
const dir = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({ datasources: { db: { url } } });
const BARU = { "X-Capability": "unit-load" };
const hasil = [];
const cek = (nama, ok, info = "") => { hasil.push({ nama, ok: !!ok, info }); console.log(`${ok ? "PASS" : "FAIL"}  ${nama}${info ? "  — " + info : ""}`); };

function nyalakan(port, mode) {
  const env = { ...process.env, QA_DATABASE_URL: url, PORT: String(port) };
  if (mode) env.DELIVERY_UNIT_CONFIRM_REQUIRED = mode; else delete env.DELIVERY_UNIT_CONFIRM_REQUIRED;
  const p = spawn(process.execPath, [path.join(dir, "server.mjs")], { env, stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((res, rej) => {
    p.stdout.on("data", (d) => { if (String(d).includes("siap")) res(p); });
    p.on("exit", (c) => rej(new Error(`server keluar ${c}`)));
    setTimeout(() => rej(new Error("server tak siap 60 dtk")), 60000);
  });
}
const api = (port, token) => async (method, p, body, headers = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}/api${p}`, { method, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* kosong */ }
  return { status: r.status, body: j };
};
const pod = { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Pak QA" };

const { driver } = await seedUsers(prisma);
await aktifkanFlagV2(prisma);
const sA = await nyalakan(4191, null);
const sB = await nyalakan(4192, "capable");
try {
  const login = await api(4191)("POST", "/auth/login", { email: QA_DRIVER_EMAIL, password: QA_PASSWORD });
  cek("login driver QA lewat HTTP", login.status === 200 && login.body?.token, `status ${login.status}`);
  const token = login.body.token;
  const A = api(4191, token), B = api(4192, token);

  // 1. Konfigurasi gerbang
  const cfgA = await A("GET", "/armada/unit-load/config", null, BARU);
  const cfgB = await B("GET", "/armada/unit-load/config", null, BARU);
  cek("config server MATI melaporkan mode MATI", /MATI/i.test(JSON.stringify(cfgA.body)), JSON.stringify(cfgA.body));
  cek("config server KAPABEL: klien baru ditegakkan", /KAPABEL|capable/i.test(JSON.stringify(cfgB.body)), JSON.stringify(cfgB.body));

  // 2a. Manifest di jalur V1 /armada/my-jobs — jalur yang DIPAKAI RN produksi (reader V2 mati di produksi)
  const j1 = await seedJob(prisma, { driver, label: "M" });
  const v1 = await A("GET", "/armada/my-jobs");
  const t1 = JSON.stringify(v1.body);
  const job1 = (v1.body?.jobs || v1.body?.items || []).flatMap?.((x) => x.jobs || x) || [];
  cek("V1 my-jobs (paritas produksi) membawa job QA + manifest 3 unit U1–U3, tanpa harga", v1.status === 200 && t1.includes(j1.order.orderNumber) && /U1/.test(t1) && /U3/.test(t1) && !/7200000/.test(t1) && /manifest/.test(t1), `status ${v1.status}, ${job1.length} entri`);
  // 2b. Jalur snapshot V2 (cadangan bila reader dinyalakan kelak)
  await aktifkanFlagV2(prisma, { reader: true });
  const snap = await A("GET", "/armada/v2/me/snapshot?limit=50");
  const teks = JSON.stringify(snap.body);
  cek("snapshot V2 (reader dinyalakan di DB QA) membawa manifest 3 unit, tanpa harga", snap.status === 200 && teks.includes(j1.order.orderNumber) && /U1/.test(teks) && /U3/.test(teks) && !/7200000|7_200_000/.test(teks), `status ${snap.status}`);
  await aktifkanFlagV2(prisma, { reader: false });

  // 3. Klien LAMA saat gerbang MATI tidak terblokir (0/3, tanpa header)
  const j2 = await seedJob(prisma, { driver, label: "L" });
  const lama = await A("POST", `/armada/jobs/${j2.job.id}/complete`, pod, kunci());
  cek("MATI: klien lama menyelesaikan job 0/3 tanpa diblokir", [200, 201].includes(lama.status), `status ${lama.status}`);

  // 4. Muat 3/3 + replay idempoten (mode KAPABEL, klien baru)
  const j3 = await seedJob(prisma, { driver, label: "F" });
  const u = j3.units.map((x) => x.id);
  const m1 = await B("POST", `/armada/jobs/${j3.job.id}/unit-load`, { unitIds: [u[0]] }, { ...BARU, ...kunci("ul") });
  cek("muat U1 → 1/3", m1.status === 200 && /1\/3/.test(JSON.stringify(m1.body)), JSON.stringify(m1.body?.muat || m1.body).slice(0, 120));
  const kReplay = kunci("ul");
  const m2a = await B("POST", `/armada/jobs/${j3.job.id}/unit-load`, { unitIds: [u[1]] }, { ...BARU, ...kReplay });
  const m2b = await B("POST", `/armada/jobs/${j3.job.id}/unit-load`, { unitIds: [u[1]] }, { ...BARU, ...kReplay }); // replay antrean offline
  const n = await prisma.jobUnitLoad.count({ where: { jobId: j3.job.id } });
  cek("replay (Idempotency-Key sama / antrean offline) tidak menggandakan baris", m2a.status === 200 && m2b.status === 200 && n === 2, `baris=${n}`);
  const dua = await B("POST", `/armada/jobs/${j3.job.id}/complete`, pod, { ...BARU, ...kunci() });
  cek("KAPABEL: 2/3 ditolak 409 UNIT_BELUM_DIKONFIRMASI", dua.status === 409 && dua.body?.code === "UNIT_BELUM_DIKONFIRMASI", `status ${dua.status} ${dua.body?.error || ""}`);
  await B("POST", `/armada/jobs/${j3.job.id}/unit-load`, { semua: true }, { ...BARU, ...kunci("ul") });
  const tiga = await B("POST", `/armada/jobs/${j3.job.id}/complete`, pod, { ...BARU, ...kunci() });
  const st = (await prisma.job.findUnique({ where: { id: j3.job.id } })).status;
  cek("KAPABEL: 3/3 → POD selesai", [200, 201].includes(tiga.status) && st === "COMPLETED", `status ${tiga.status}, job ${st}`);

  // 5. Pengecualian beralasan + replay → audit tepat 1
  const j4 = await seedJob(prisma, { driver, label: "X" });
  const h = { ...BARU, ...kunci() };
  const pend = { ...pod, pengecualianUnit: { alasan: "Uji QA: HP offline, unit dihitung manual" } };
  const pendek = await B("POST", `/armada/jobs/${j4.job.id}/complete`, { ...pod, pengecualianUnit: { alasan: "x" } }, { ...BARU, ...kunci() });
  const ok1 = await B("POST", `/armada/jobs/${j4.job.id}/complete`, pend, h);
  await B("POST", `/armada/jobs/${j4.job.id}/complete`, pend, h);
  const aud = await prisma.deliveryExecutionEvent.count({ where: { jobId: j4.job.id, action: "UNIT_LOAD_EXCEPTION" } });
  cek("pengecualian: alasan <5 huruf ditolak; alasan sah lolos; audit tepat 1 setelah replay", pendek.status === 409 && [200, 201].includes(ok1.status) && aud === 1, `pendek=${pendek.status} sah=${ok1.status} audit=${aud}`);

  // 6. Klien LAMA saat KAPABEL: lolos + sinyal dicatat
  const j5 = await seedJob(prisma, { driver, label: "K" });
  const lama2 = await B("POST", `/armada/jobs/${j5.job.id}/complete`, pod, kunci());
  const sinyal = await prisma.deliveryExecutionEvent.count({ where: { jobId: j5.job.id, action: "UNIT_LOAD_LEGACY_CLIENT" } });
  cek("KAPABEL: klien lama tidak diblokir + sinyal UNIT_LOAD_LEGACY_CLIENT tercatat 1", [200, 201].includes(lama2.status) && sinyal === 1, `status ${lama2.status} sinyal=${sinyal}`);

  // 7. Unit asing ditolak
  const j6 = await seedJob(prisma, { driver, label: "Z" });
  const asing = await B("POST", `/armada/jobs/${j6.job.id}/unit-load`, { unitIds: [j1.units[0].id] }, { ...BARU, ...kunci("ul") });
  cek("unit milik job lain ditolak", asing.status >= 400 && asing.status < 500, `status ${asing.status}`);
} finally {
  sA.kill(); sB.kill(); await prisma.$disconnect();
}
const gagal = hasil.filter((h) => !h.ok).length;
console.log(`\n[qa-manifest] E2E: ${hasil.length - gagal}/${hasil.length} lulus`);
process.exit(gagal ? 1 : 0);
