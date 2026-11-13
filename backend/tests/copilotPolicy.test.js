// Tes aturan Copilot (MVP 2 langkah 3) — murni.
import test from "node:test";
import assert from "node:assert/strict";
import { bolehCopilot, alasanPercakapanDitolak, validasiOutcome, validasiCrm, slugTag, ringkasStats } from "../src/services/agentStudio/copilotPolicy.js";

test("bolehCopilot: Tahap A ADMIN/OWNER, Tahap B lewat config.copilotUsers", () => {
  assert.equal(bolehCopilot(["OWNER"], "u1", {}), true);
  assert.equal(bolehCopilot(["ADMIN", "SALES"], "u1", null), true);
  assert.equal(bolehCopilot(["SALES"], "u1", {}), false);
  assert.equal(bolehCopilot(["SALES"], "u1", { copilotUsers: ["u1"] }), true);
  assert.equal(bolehCopilot(["SALES"], "u2", { copilotUsers: ["u1"] }), false);
  assert.equal(bolehCopilot(["SALES"], undefined, { copilotUsers: [undefined] }), false);
});

test("alasanPercakapanDitolak: hanya chat customer individual", () => {
  assert.match(alasanPercakapanDitolak(null), /tidak ditemukan/);
  assert.match(alasanPercakapanDitolak({ type: "GROUP" }), /grup/);
  assert.match(alasanPercakapanDitolak({ type: "INDIVIDUAL", customer: null }), /belum terhubung/);
  assert.match(alasanPercakapanDitolak({ type: "INDIVIDUAL", customer: { isInternalStaff: true } }), /Kontak Tim/);
  assert.equal(alasanPercakapanDitolak({ type: "INDIVIDUAL", customer: { isInternalStaff: false } }), null);
});

test("validasiOutcome", () => {
  assert.ok(validasiOutcome({ outcome: "SHOWN" }).error);
  assert.ok(validasiOutcome({ outcome: "USED_AS_IS" }).error, "dipakai wajib sentText");
  const a = validasiOutcome({ outcome: "USED_EDITED", sentText: "  halo kak  ", ignoreReason: "SALAH_INFO" });
  assert.equal(a.data.sentText, "halo kak");
  assert.equal(a.data.ignoreReason, null);
  const b = validasiOutcome({ outcome: "IGNORED", ignoreReason: "TIDAK_NATURAL" });
  assert.equal(b.data.ignoreReason, "TIDAK_NATURAL");
  assert.equal(b.data.sentText, null);
  assert.equal(validasiOutcome({ outcome: "IGNORED", ignoreReason: "ngawur" }).data.ignoreReason, null);
});

test("validasiCrm: hanya kota, tag (append), catatan; pipelineStage ditolak", () => {
  assert.match(validasiCrm({ pipelineStage: "TRANSACTION" }).error, /pipelineStage/);
  assert.match(validasiCrm({ city: "Bekasi", name: "x" }).error, /name/);
  assert.ok(validasiCrm({}).error);
  const r = validasiCrm({ city: " Bekasi ", tag: "Sakit Pinggang!", note: "BB 85/55" }, ["lama"]);
  assert.deepEqual(r.data.customer, { city: "Bekasi", tags: ["lama", "sakit-pinggang"] });
  assert.equal(r.data.note, "BB 85/55");
  assert.deepEqual(r.data.disimpan, { city: "Bekasi", tag: "sakit-pinggang", note: "BB 85/55" });
  assert.deepEqual(validasiCrm({ tag: "sakit pinggang" }, ["sakit-pinggang"]).data.customer, {}, "tag sudah ada tidak diduplikasi");
});

test("slugTag", () => {
  assert.equal(slugTag("  Pegal  Pinggang "), "pegal-pinggang");
  assert.equal(slugTag("Kasur_Kempes!!"), "kasur-kempes");
});

test("ringkasStats: persen dipakai dari draft yang sudah diputuskan, per sales", () => {
  const s = ringkasStats(
    [
      { salesUserId: "a", outcome: "USED_AS_IS", costUsd: 0.001 },
      { salesUserId: "a", outcome: "IGNORED", costUsd: 0.001 },
      { salesUserId: "a", outcome: "SHOWN", costUsd: 0.001 },
      { salesUserId: "b", outcome: "USED_EDITED", costUsd: 0.002 },
    ],
    { a: "Novi" }
  );
  assert.equal(s.total.total, 4);
  assert.equal(s.total.persenDipakai, 67);
  assert.equal(s.perSales[0].nama, "Novi");
  assert.equal(s.perSales[0].persenDipakai, 50);
  assert.equal(s.perSales[1].nama, "—");
  assert.ok(Math.abs(s.total.costUsd - 0.005) < 1e-9);
});
