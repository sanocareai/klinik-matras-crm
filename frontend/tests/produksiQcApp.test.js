// Fase 2 (penutupan gap) — Aplikasi PIC QC mandiri: antrean pengujian awal TERLIHAT meski menu QC desktop disembunyikan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
// Alias "@/" (Vite) -> src/ agar modul ASLI diuji, bukan salinan.
const SRC_URL = pathToFileURL(path.join(here, "..", "src") + path.sep).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(spec, ctx, next) { return spec.startsWith("@/") ? next(new URL(spec.slice(2), ${JSON.stringify(SRC_URL)}).href, ctx) : next(spec, ctx); }`));
const { APP_MODES, QC_NAV_TABS, allowedModes, qcTabOf } = await import("../src/features/production/workerApp/workerAppModel.js");
const { PRODUCTION_NAV, PRODUCTION_QC_APP_ROLES } = await import("../src/lib/productionNav.js");
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

test("mode PIC QC hanya untuk pemegang izin QC di server (QC_LEAD/ADMIN/OWNER) — Lead, Meja, Dokumentasi tidak ditawari", () => {
  const qc = APP_MODES.find((m) => m.key === "qc");
  assert.equal(qc.to, "/produksi/qc"); assert.equal(qc.lane, null);
  assert.deepEqual([...qc.roles].sort(), ["ADMIN", "OWNER", "QC_LEAD"]);
  assert.deepEqual([...PRODUCTION_QC_APP_ROLES].sort(), [...qc.roles].sort());
  for (const r of ["PRODUCTION_LEAD", "PRODUCTION_WORKER", "PRODUCTION_DOCUMENTER", "SALES", "WAREHOUSE"]) assert.equal(allowedModes([r]).some((m) => m.key === "qc"), false, r);
  assert.equal(allowedModes(["QC_LEAD"]).some((m) => m.key === "qc"), true);
});

test("menu desktop 'Quality Control' tetap disembunyikan, tetapi 'Antrean PIC QC' terlihat langsung di OPERASIONAL (bukan akordeon tertutup) dan hanya untuk peran berizin", () => {
  const flat = PRODUCTION_NAV.flatMap((s) => s.items.map((i) => ({ ...i, section: s.section })));
  assert.equal(flat.some((i) => /quality-control/.test(i.to)), false, "menu QC desktop tetap tersembunyi");
  const item = flat.find((i) => i.to === "/produksi/qc");
  assert.equal(item.section, "OPERASIONAL"); assert.equal(item.label, "Antrean PIC QC");
  const visible = (roles) => roles.some((r) => item.bolehPeran.includes(r));
  assert.equal(visible(["QC_LEAD"]), true); assert.equal(visible(["PRODUCTION_WORKER"]), false);
});

test("kerangka Aplikasi PIC QC: tab Antrean/Akun, rute mandiri terdaftar, antrean memakai komponen & endpoint yang sama, akun tanpa izin diberi penjelasan", () => {
  assert.deepEqual(QC_NAV_TABS.map((t) => t.key), ["antrean", "akun"]); assert.equal(qcTabOf("zzz"), "antrean"); assert.equal(qcTabOf("akun"), "akun");
  assert.match(src("routes", "pageRegistry.jsx"), /path: "\/produksi\/qc", render: \(ctx\) => <DemoPage slotBar><ProductionQcApp/);
  const app = src("pages", "produksi", "ProductionQcApp.jsx");
  assert.match(app, /<PreTestQueue key=\{reloadKey\} standalone/); assert.match(app, /currentKey="qc"/); assert.doesNotMatch(app, /ProductionQcHub/, "tidak bergantung pada halaman QC desktop");
  const q = src("features", "production", "componentNotes", "PreTestQueue.jsx");
  assert.match(q, /data-testid="pretest-forbidden"/); assert.match(q, /getComponentQcQueue/);
});
