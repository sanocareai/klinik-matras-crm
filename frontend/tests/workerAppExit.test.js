// Aplikasi Meja/Corner/QC/Dokumentasi: tombol "Kembali ke SANSS" di header layar tab untuk peran dengan akses workspace; pekerja lantai tidak; detail pekerjaan tetap memakai tombol Kembali ke daftar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

test("shell: onBack (detail pekerjaan) lebih diutamakan, lalu exitTo (Link ke SANSS), lalu logo", () => {
  const s = read("features", "production", "workerApp", "WorkerAppShell.jsx");
  const iBack = s.indexOf("onBack ? ("); const iExit = s.indexOf(") : exitTo ? ("); const iLogo = s.indexOf(") : (\n            <span aria-hidden");
  assert.ok(iBack > 0 && iExit > iBack && iLogo > iExit, "urutan onBack > exitTo > logo");
  assert.match(s, /data-testid="worker-exit"/); assert.match(s, /aria-label="Kembali ke SANSS \(desktop\)"/);
  assert.match(s, /if \(onLeave && !onLeave\(\)\) e\.preventDefault\(\)/, "penjaga keluar (draf) dihormati");
});

test("exitPathFor: hanya ADMIN/OWNER/PRODUCTION_LEAD; tujuan = tab terakhir atau /portal; pekerja lantai = null", async () => {
  const src = read("features", "production", "workerApp", "Tabs.jsx");
  assert.match(src, /export const exitPathFor = \(roles, pathname\) => \(\(roles \|\| \[\]\)\.some\(\(r\) => \["ADMIN", "OWNER", "PRODUCTION_LEAD"\]\.includes\(r\)\) \? \(lastActiveTabPath\(pathname\) \|\| "\/portal"\) : null\)/);
  for (const page of ["WorkerLane.jsx", "ProductionQcApp.jsx", "ProductionDocumentation.jsx"]) assert.match(read("pages", "produksi", page), /exitTo=\{exitPathFor\(roles, pathname\)\}/, page);
  assert.match(read("pages", "produksi", "ProductionDocumentation.jsx"), /onLeave=\{drafts\.confirmLeave\}/);
});
