// Capabilities SANSS Produksi (aplikasi Android lantai produksi) + daftar jalur token mobile per aplikasi.
// Memastikan: tim produksi boleh masuk, Sales/Finance/Driver tidak; token Produksi tidak menjangkau Finance
// dan token Finance (tanpa klaim app) tetap persis seperti sebelumnya.
import test from "node:test";
import assert from "node:assert/strict";
import { capabilitiesFor } from "../src/services/capabilities.js";
import { jalurMobileBoleh } from "../src/middleware/auth.js";
import { gerbangApp } from "../src/routes/mobileAuth.js";

const cap = (...roles) => capabilitiesFor({ role: roles[0], roles });

test("Tim produksi boleh memakai aplikasi Produksi; Sales/Finance/Driver/Gudang tidak", () => {
  for (const r of ["PRODUCTION_WORKER", "PRODUCTION_LEAD", "QC_LEAD", "PRODUCTION_DOCUMENTER", "ADMIN", "OWNER"]) {
    assert.equal(cap(r).productionApp, true, r);
  }
  for (const r of ["SALES", "FINANCE", "DRIVER", "HELPER", "WAREHOUSE", "DISPATCHER"]) {
    assert.equal(cap(r).productionApp, false, r);
  }
});

test("Preset tata letak Produksi: Admin > QC > Dokumentasi > Meja", () => {
  assert.equal(cap("PRODUCTION_LEAD").productionPreset, "ADMIN");
  assert.equal(cap("ADMIN").productionPreset, "ADMIN");
  assert.equal(cap("QC_LEAD").productionPreset, "QC");
  assert.equal(cap("PRODUCTION_DOCUMENTER").productionPreset, "DOKUMENTASI");
  assert.equal(cap("PRODUCTION_WORKER").productionPreset, "MEJA");
  assert.equal(cap("SALES").productionPreset, "NONE");
  // Multi-peran: QC + dokumentasi tetap QC (izin terbesar menentukan tata letak).
  assert.equal(cap("QC_LEAD", "PRODUCTION_DOCUMENTER").productionPreset, "QC");
});

test("Capability produksi mencerminkan izin route", () => {
  const w = cap("PRODUCTION_WORKER").production;
  assert.deepEqual(w, { lane: true, qc: false, plan: false, docs: false, executeAny: false });
  const qc = cap("QC_LEAD").production;
  assert.equal(qc.qc, true);
  assert.equal(qc.plan, false);
  const lead = cap("PRODUCTION_LEAD").production;
  assert.equal(lead.plan, true);
  assert.equal(lead.executeAny, false);
  assert.equal(cap("OWNER").production.executeAny, true);
});

test("Capability Finance lama tidak berubah oleh tambahan Produksi", () => {
  const f = cap("FINANCE");
  assert.equal(f.financeApp, true);
  assert.equal(f.preset, "FINANCE");
  assert.equal(f.productionApp, false);
});

test("Jalur token mobile: Finance (tanpa klaim app) tidak berubah, Produksi hanya jalur produksi", () => {
  // Finance — persis daftar lama.
  assert.equal(jalurMobileBoleh("/api/finance/dashboard"), true);
  assert.equal(jalurMobileBoleh("/api/mobile/devices"), true);
  assert.equal(jalurMobileBoleh("/api/auth/me"), true);
  assert.equal(jalurMobileBoleh("/api/units/x"), false);
  assert.equal(jalurMobileBoleh("/api/production-v2/worker/table"), false);
  // Produksi.
  const p = (u) => jalurMobileBoleh(u, "production");
  assert.equal(p("/api/production-v2/worker/table"), true);
  assert.equal(p("/api/production-v2/andon?date=2026-11-12"), true);
  assert.equal(p("/api/production/v1-worker-queue?lane=TABLE"), true);
  assert.equal(p("/api/production-planning/x"), true);
  assert.equal(p("/api/units/abc/timeline"), true);
  assert.equal(p("/api/mobile/auth/sessions"), true);
  assert.equal(p("/api/auth/me"), true);
  assert.equal(p("/api/finance/dashboard"), false);
  assert.equal(p("/api/orders/1/invoice/pdf"), false);
  assert.equal(p("/api/productionx"), false);
  assert.equal(p("/api/conversations"), false);
});

test("Gerbang aplikasi login: kosong = Finance, 'production' dikenal, nilai lain ditolak", () => {
  assert.equal(gerbangApp(undefined).kunci, null);
  assert.equal(gerbangApp("").kunci, null);
  assert.equal(gerbangApp("finance").kunci, null);
  assert.equal(gerbangApp("production").kunci, "production");
  assert.equal(gerbangApp("toString"), null);
  assert.equal(gerbangApp("lain"), null);
  assert.equal(gerbangApp("production").login[1], "NOT_PRODUCTION_TEAM");
});
