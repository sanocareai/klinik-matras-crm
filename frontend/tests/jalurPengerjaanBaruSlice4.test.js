// Slice 4 jalur Pengerjaan Pesanan: landing PIC Meja + pilihan mode, "Corner diperlukan?" di modal Jadwalkan (kontrak sama dgn Unit 360), keputusan Corner terkunci.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_URL = pathToFileURL(path.join(here, "..", "src") + path.sep).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(spec, ctx, next) { return spec.startsWith("@/") ? next(new URL(spec.slice(2), ${JSON.stringify(SRC_URL)}).href, ctx) : next(spec, ctx); }`));
const { floorLandingFor, isFloorOnlyUser, landingPathFor } = await import("../src/lib/landing.js");
const { cornerBodyOf, needsCornerChoice, viewOfOnboardCard } = await import("../src/features/production/unitCardModel.js");
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

const BENGKEL = [{ key: "bengkel", path: "/bengkel" }];

test("landing: PIC Meja (PRODUCTION_WORKER saja) mendarat di Aplikasi Meja; mode terakhir yang masih diizinkan dihormati", () => {
  assert.equal(landingPathFor({ roles: ["PRODUCTION_WORKER"], portals: BENGKEL }), "/produksi/meja");
  assert.equal(landingPathFor({ roles: ["PRODUCTION_WORKER"], portals: BENGKEL, lastMode: "corner" }), "/produksi/corner");
  assert.equal(landingPathFor({ roles: ["PRODUCTION_WORKER"], portals: BENGKEL, lastMode: "bahan" }), "/produksi/bahan");
  assert.equal(landingPathFor({ roles: ["PRODUCTION_WORKER"], portals: BENGKEL, lastMode: "dokumentasi" }), "/produksi/meja", "mode di luar izin/bukan lini -> Meja");
  assert.equal(landingPathFor({ roles: ["PRODUCTION_WORKER"], portals: BENGKEL, lastMode: "tidak-ada" }), "/produksi/meja");
});

test("landing: ADMIN/OWNER/LEAD/QC/Dokumenter TIDAK dialihkan ke Meja; portal ganda tidak dilompati", () => {
  for (const roles of [["ADMIN"], ["OWNER"], ["PRODUCTION_LEAD"], ["QC_LEAD"], ["PRODUCTION_DOCUMENTER"], ["PRODUCTION_WORKER", "PRODUCTION_LEAD"], ["PRODUCTION_WORKER", "ADMIN"], ["PRODUCTION_WORKER", "QC_LEAD"]]) {
    assert.equal(isFloorOnlyUser(roles), false, roles.join("+"));
    assert.equal(floorLandingFor(roles), null, roles.join("+"));
    assert.equal(landingPathFor({ roles, portals: BENGKEL }), "/bengkel", `${roles.join("+")} tetap ke portalnya`);
  }
  assert.equal(landingPathFor({ roles: ["PRODUCTION_WORKER"], portals: [...BENGKEL, { key: "warehouse", path: "/gudang" }] }), null, "lebih dari satu portal = layar pemilih portal seperti biasa");
  assert.equal(landingPathFor({ roles: ["SALES"], portals: [{ key: "growth", path: "/dashboard" }] }), "/dashboard", "sales tetap seperti sebelumnya");
});

test("landing: Portal.jsx memakai landingPathFor hanya pada portal tunggal; pemilih mode muncul untuk >1 mode dan diingat per perangkat", () => {
  const portal = src("pages", "Portal.jsx");
  assert.match(portal, /landingPathFor\(\{ roles: rolesOf\(/);
  assert.match(portal, /if \(list\.length === 1\)/);
  const tabs = src("features", "production", "workerApp", "Tabs.jsx");
  assert.match(tabs, /function ModePicker/);
  assert.match(tabs, /if \(modes\.length < 2\) return null;/, "satu mode saja = tanpa pemilih");
  assert.match(tabs, /<ModePicker user=\{user\} lane=\{lane\} \/>/);
  assert.match(tabs, /rememberWorkerMode\(m\.key\)/);
  assert.match(src("pages", "produksi", "WorkerLane.jsx"), /rememberWorkerMode\(mode\.key\)/);
});

test("Corner di modal Jadwalkan: kontrak sama dgn Unit 360 (pilihan wajib; alasan >= 3 bila tidak diperlukan)", () => {
  assert.ok(cornerBodyOf("", "").error, "tanpa pilihan ditolak");
  assert.ok(cornerBodyOf(null, "x").error);
  assert.deepEqual(cornerBodyOf("YES", "diabaikan"), { body: { cornerRequired: true } }, "diperlukan: alasan tidak dikirim");
  assert.match(cornerBodyOf("NO", "  ").error, /beralasan/);
  assert.match(cornerBodyOf("NO", "ab").error, /minimal 3/);
  assert.deepEqual(cornerBodyOf("NO", "  Tanpa kain jahit "), { body: { cornerRequired: false, cornerReason: "Tanpa kain jahit" } });
});

test("Corner di modal Jadwalkan: hanya onboarding jalur Pengerjaan Pesanan; kartu lain tidak berubah", () => {
  const item = (build) => ({ card: { unit: { id: "u1", unitCode: "RES-1-U1" }, customer: {}, priority: { key: "NORMAL" } }, rencana: { build } });
  const v = viewOfOnboardCard(item({ product: { flow: "KASUR", problem: null } }));
  assert.deepEqual(v.build, { product: { flow: "KASUR", problem: null } });
  assert.equal(needsCornerChoice(v), true);
  assert.equal(viewOfOnboardCard(item(null)).build, null);
  assert.equal(needsCornerChoice(viewOfOnboardCard(item(null))), false, "LAYANAN/non-build: tanpa pertanyaan Corner");
  assert.equal(needsCornerChoice({ ...v, plan: { id: "p" } }), false, "rencana yang sudah ada: keputusan lewat Unit 360");
  assert.equal(needsCornerChoice({ ...v, onboardUnitId: undefined }), false);
});

test("Corner di modal Jadwalkan: terkirim bersama jadwal dan peringatan jenis produk tidak menahan simpan", () => {
  const m = src("features", "production", "ScheduleModals.jsx");
  assert.match(m, /\.\.\.corner\.body/);
  assert.match(m, /const askCorner = needsCornerChoice\(target\)/);
  assert.match(m, /data-testid="schedule-corner-yes"/);
  assert.match(m, /data-testid="schedule-corner-reason"/);
  assert.match(m, /data-testid="schedule-product-unclear"/);
  assert.match(m, /const \[cornerChoice, setCornerChoice\] = useState\(""\)/, "tanpa pilihan bawaan");
  assert.doesNotMatch(m, /disabled=\{busy \|\| .*product/, "produk ambigu tidak mematikan tombol simpan");
});

test("keputusan Corner terkunci setelah gerbang: Unit 360 menyembunyikan form dan menjelaskan", () => {
  const p = src("features", "production", "BuildPlanPanel.jsx");
  assert.match(p, /data-testid="corner-locked"/);
  assert.match(p, /canPlan && !corner\.locked/);
});
