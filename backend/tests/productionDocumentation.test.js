// P10B Aplikasi Dokumentasi — aturan murni (matriks kanonis, normalisasi, sumber), izin peran, migration role, dan pagar kode.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOC_CATEGORIES, DOC_QUEUE_FILTERS, DOC_VERSION_BASE, buildDocumentationMatrix, deriveDocSource, docStepCode, isDocumentationRow, isUuid, matchesDocFilter, normalizeDocItems, parseDocRows,
} from "../src/lib/domain/productionDocumentation.js";
import { mediaKindOf } from "../src/lib/domain/productionSteps.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P, PORTALS } from "../src/constants/permissions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "..", rel), "utf8");
const url = (n) => `/media/production-evidence/${String(n).repeat(40).slice(0, 40)}.jpg`;
const ALL_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const media = (...urls) => urls.map((u) => ({ url: u, kind: "image", evidenceId: `e-${u.slice(-8)}`, actorName: "PIC", createdAt: "2026-10-02T01:00:00Z" }));
const base = (over = {}) => ({
  applicableSteps: ALL_STEPS, recordedSteps: new Set(), nextStepNo: 1, started: true, run: { origin: "CUSTODY_PICKUP", status: "ACTIVE" }, qcDone: false,
  stepMedia: new Map(), extra: {}, docRows: [], ...over,
});
const cat = (m, k) => m.categories.find((c) => c.key === k);

test("matriks kanonis: 12 kategori berurutan, 3 kelompok Before/Proses/After, minimum jelas, penanda baris DOC_ aman", () => {
  assert.deepEqual(DOC_CATEGORIES.map((c) => c.key), ["PICKUP_ARRIVAL", "INITIAL_CONDITION", "BEFORE_TEARDOWN", "TEARDOWN_DIAGNOSIS", "FOUNDATION", "LAYER_COMPONENT", "PROCESS", "TEXTURE_TEST", "QC", "CORNER", "FINAL_RESULT", "READY_TO_SHIP"]);
  assert.deepEqual([...new Set(DOC_CATEGORIES.map((c) => c.group))], ["BEFORE", "PROCESS", "AFTER"]);
  assert.ok(DOC_CATEGORIES.every((c) => c.min >= 1 && c.storeStepNo >= 1 && c.storeStepNo <= 12), "storeStepNo harus 1..12 (CHECK tabel bukti)");
  assert.deepEqual(DOC_QUEUE_FILTERS, ["ALL", "BELUM_DIMULAI", "BEFORE_KURANG", "PROSES_KURANG", "AFTER_KURANG", "LENGKAP"]);
  assert.equal(docStepCode("QC"), "DOC_QC"); assert.equal(isDocumentationRow({ stepCode: "DOC_QC" }), true); assert.equal(isDocumentationRow({ stepCode: "S01_BEFORE" }), false);
  assert.ok(DOC_VERSION_BASE >= 1000, "versi dokumentasi tak boleh bertabrakan dengan versi bukti tahap");
  assert.equal(isUuid("0f5cbf18-7d8e-4c61-9b5c-2d4f2b1c9a10"), true); assert.equal(isUuid("../x"), false);
});

test("normalizeDocItems: hanya foto store V2, urutan, keterangan dibersihkan & dibatasi, duplikat/kosong/terlalu banyak ditolak", () => {
  const n = (items) => normalizeDocItems(items, { urlKind: mediaKindOf });
  assert.deepEqual(n([{ url: url("a"), caption: " Sisi\u0007  kiri ", order: 2 }, { url: url("b"), order: 1 }]).map((i) => [i.url, i.caption, i.order]), [[url("b"), null, 1], [url("a"), "Sisi kiri", 2]]);
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
  assert.equal(code(() => n([])), "DOC_ITEMS_REQUIRED");
  assert.equal(code(() => n(null)), "DOC_ITEMS_REQUIRED");
  assert.equal(code(() => n([{ url: "/media/production-evidence/" + "a".repeat(40) + ".mp4" }])), "DOC_MEDIA_INVALID", "video bukan dokumentasi foto");
  assert.equal(code(() => n([{ url: "https://x.test/a.jpg" }])), "DOC_MEDIA_INVALID");
  assert.equal(code(() => n([{ url: "/media/production-evidence/../../etc/passwd" }])), "DOC_MEDIA_INVALID");
  assert.equal(code(() => n([{ url: url("a") }, { url: url("a") }])), "DOC_MEDIA_DUPLICATE_IN_REQUEST");
  assert.equal(code(() => n([{ url: url("a"), caption: "x".repeat(201) }])), "DOC_CAPTION_TOO_LONG");
  assert.equal(code(() => n(Array.from({ length: 13 }, (_, i) => ({ url: url(String(i % 10) + "abcdef"[i % 6]) })))), "DOC_ITEMS_TOO_MANY");
});

test("deriveDocSource: sumber diturunkan dari peran/penugasan (QC, Gudang, Corner, Produksi), selain itu Manual", () => {
  assert.equal(deriveDocSource({ category: "QC", hasQcWrite: true }), "QC");
  assert.equal(deriveDocSource({ category: "READY_TO_SHIP", hasInventoryWrite: true }), "GUDANG");
  assert.equal(deriveDocSource({ category: "PICKUP_ARRIVAL", hasInventoryWrite: true }), "GUDANG");
  assert.equal(deriveDocSource({ category: "FINAL_RESULT", isCornerOperator: true }), "CORNER");
  assert.equal(deriveDocSource({ category: "FOUNDATION", isTableOperator: true }), "PRODUKSI");
  assert.equal(deriveDocSource({ category: "FOUNDATION" }), "MANUAL");
  assert.equal(deriveDocSource({ category: "FOUNDATION", hasInventoryWrite: true }), "MANUAL", "izin gudang tidak mengubah sumber kategori produksi");
});

test("buildDocumentationMatrix: belum dimulai, jatuh tempo, kurang vs menunggu, NA, foto tahap dihitung, koreksi menggantikan", () => {
  // Belum dimulai: hanya Pickup yang 'always'; tidak ada kategori lain yang dianggap kurang.
  let m = buildDocumentationMatrix(base({ started: false, nextStepNo: null, run: { origin: "CUSTODY_PICKUP", status: "PENDING_ARRIVAL" } }));
  assert.equal(m.flags.belumDimulai, true); assert.deepEqual(m.missing.map((x) => x.key), ["PICKUP_ARRIVAL"]);
  assert.equal(cat(m, "BEFORE_TEARDOWN").status, "MENUNGGU"); assert.equal(m.flags.lengkap, false);
  // Foto pickup driver dihitung; unit lahir di workshop: Pickup tidak berlaku.
  m = buildDocumentationMatrix(base({ extra: { pickupPhoto: { url: "/media/unit-photo/u?exp=1&sig=a" } } }));
  assert.equal(cat(m, "PICKUP_ARRIVAL").status, "LENGKAP"); assert.equal(cat(m, "PICKUP_ARRIVAL").items[0].source, "DRIVER_PICKUP");
  m = buildDocumentationMatrix(base({ run: { origin: "WORKSHOP_BORN", status: "ACTIVE" } }));
  assert.equal(cat(m, "PICKUP_ARRIVAL").status, "NA"); assert.equal(m.missing.some((x) => x.key === "PICKUP_ARRIVAL"), false);
  // Tahap 1 tercatat (1 foto) -> Sebelum bongkar jatuh tempo & kurang 1 (Before Kurang); kategori Proses/After belum waktunya.
  m = buildDocumentationMatrix(base({ recordedSteps: new Set([1]), nextStepNo: 2, stepMedia: new Map([[1, media(url("1"))]]), run: { origin: "WORKSHOP_BORN", status: "ACTIVE" } }));
  assert.equal(cat(m, "BEFORE_TEARDOWN").status, "KURANG"); assert.equal(cat(m, "BEFORE_TEARDOWN").missing, 1); assert.equal(cat(m, "BEFORE_TEARDOWN").items[0].source, "PRODUKSI");
  assert.equal(m.flags.beforeKurang, true); assert.equal(m.flags.prosesKurang, false); assert.equal(m.flags.afterKurang, false);
  // Layanan tanpa modul fondasi/lapisan -> kategori itu NA, tidak pernah dituntut.
  m = buildDocumentationMatrix(base({ applicableSteps: [1, 2, 3, 4, 5, 8, 9, 10, 11, 12], recordedSteps: new Set([1, 2, 3, 4, 5]), nextStepNo: 8 }));
  assert.equal(cat(m, "FOUNDATION").status, "NA"); assert.equal(cat(m, "LAYER_COMPONENT").status, "NA");
  assert.equal(cat(m, "PROCESS").due, true, "tanpa modul, Proses jatuh tempo setelah diagnosa");
  // Foto Corner (tahap 9 & 11) dan Hasil akhir (12) memakai sumber Corner/Produksi yang benar.
  m = buildDocumentationMatrix(base({ recordedSteps: new Set([9, 11, 12]), nextStepNo: null, run: { origin: "CUSTODY_PICKUP", status: "ACTIVE" }, stepMedia: new Map([[9, media(url("9"))], [11, media(url("b"), url("c"))], [12, media(url("d"), url("e"))]]) }));
  assert.deepEqual(cat(m, "CORNER").items.map((i) => i.source), ["PRODUKSI", "CORNER", "CORNER"]); assert.equal(cat(m, "FINAL_RESULT").status, "LENGKAP");
  // Foto QC dan diagnosis dihitung ke kategorinya.
  m = buildDocumentationMatrix(base({ qcDone: true, extra: { qcPhotos: [{ url: "/media/unit-photos/qc.jpg" }], diagnosisPhotos: [{ url: url("f") }] } }));
  assert.equal(cat(m, "QC").items[0].source, "QC"); assert.equal(cat(m, "QC").status, "LENGKAP"); assert.equal(cat(m, "TEARDOWN_DIAGNOSIS").items[0].source, "PRODUKSI");
  // Dokumentasi manual + koreksi: hanya versi terbaru berlaku; riwayat menyimpan versi lama beserta alasan koreksi.
  const rows = parseDocRows([
    { id: "r1", stepCode: "DOC_PROCESS", actorId: "u1", createdAt: "2026-10-02T02:00:00Z", media: [{ url: url("1"), kind: "image" }], payload: { documentation: { category: "PROCESS", source: "MANUAL", items: [{ url: url("1"), caption: "salah", order: 1 }] } } },
    { id: "r2", stepCode: "DOC_PROCESS", actorId: "u2", createdAt: "2026-10-02T03:00:00Z", media: [{ url: url("2"), kind: "image" }], payload: { documentation: { category: "PROCESS", source: "MANUAL", items: [{ url: url("2"), caption: "benar", order: 1 }], supersedesEvidenceId: "r1", reason: "tertukar" } } },
  ]).map((r) => ({ ...r, actorName: r.actorId === "u1" ? "Andi" : "Budi" }));
  m = buildDocumentationMatrix(base({ docRows: rows, started: true }));
  const proc = cat(m, "PROCESS");
  assert.deepEqual(proc.items.map((i) => i.caption), ["benar"]); assert.equal(proc.items[0].correctable, true); assert.equal(proc.items[0].evidenceId, "r2");
  assert.equal(proc.history.length, 1); assert.equal(proc.history[0].reason, "tertukar"); assert.equal(proc.history[0].actorName, "Andi"); assert.equal(proc.history[0].correctedBy, "Budi"); assert.equal(proc.history[0].items[0].caption, "salah");
});

test("flag antrean & filter: Lengkap hanya bila semua kategori berlaku terpenuhi; satu unit bisa masuk beberapa filter kurang", () => {
  const stepMedia = new Map(ALL_STEPS.map((n) => [n, media(url(String(n % 10)), url("a" + String(n % 10)), url("b" + String(n % 10)))]));
  const full = buildDocumentationMatrix(base({
    run: { origin: "CUSTODY_PICKUP", status: "COMPLETED" }, recordedSteps: new Set(ALL_STEPS), nextStepNo: null, qcDone: true, stepMedia,
    extra: { pickupPhoto: { url: "/media/unit-photo/u?exp=1&sig=a" }, qcPhotos: [{ url: "/media/unit-photos/q.jpg" }] },
    docRows: parseDocRows([
      { id: "p", stepCode: "DOC_PROCESS", actorId: null, createdAt: "2026-10-02T02:00:00Z", media: [{ url: url("p"), kind: "image" }], payload: { documentation: { category: "PROCESS", source: "MANUAL", items: [] } } },
      { id: "r", stepCode: "DOC_READY_TO_SHIP", actorId: null, createdAt: "2026-10-02T02:00:00Z", media: [{ url: url("r"), kind: "image" }], payload: { documentation: { category: "READY_TO_SHIP", source: "GUDANG", items: [] } } },
    ]),
  }));
  assert.equal(full.flags.lengkap, true, JSON.stringify(full.missing)); assert.equal(full.missingTotal, 0);
  assert.equal(matchesDocFilter(full.flags, "LENGKAP"), true); assert.equal(matchesDocFilter(full.flags, "AFTER_KURANG"), false); assert.equal(matchesDocFilter(full.flags, "ALL"), true);
  // Run selesai tanpa foto Siap kirim -> After Kurang; tanpa Proses -> Proses Kurang; tidak Lengkap.
  const gaps = buildDocumentationMatrix(base({ run: { origin: "CUSTODY_PICKUP", status: "COMPLETED" }, recordedSteps: new Set(ALL_STEPS), nextStepNo: null, qcDone: true, stepMedia, extra: { pickupPhoto: { url: "/x?exp=1&sig=a" }, qcPhotos: [{ url: "/media/unit-photos/q.jpg" }] } }));
  assert.equal(gaps.flags.lengkap, false); assert.equal(gaps.flags.afterKurang, true); assert.equal(gaps.flags.prosesKurang, true);
  assert.equal(matchesDocFilter(gaps.flags, "AFTER_KURANG"), true); assert.equal(matchesDocFilter(gaps.flags, "PROSES_KURANG"), true); assert.equal(matchesDocFilter(gaps.flags, "BEFORE_KURANG"), false);
});

test("izin: PRODUCTION_DOCUMENTATION_WRITE hanya PRODUCTION_LEAD dan PRODUCTION_DOCUMENTER; TIDAK ke worker, ADMIN/OWNER, QC, Gudang, Finance, Driver; peran khusus tanpa harga/finance/tahap/QC", () => {
  const holders = Object.entries(ROLE_PERMISSIONS).filter(([, perms]) => perms.includes(P.PRODUCTION_DOCUMENTATION_WRITE)).map(([role]) => role).sort();
  assert.deepEqual(holders, ["PRODUCTION_DOCUMENTER", "PRODUCTION_LEAD"]);
  assert.deepEqual([...ROLE_PERMISSIONS.PRODUCTION_DOCUMENTER].sort(), [P.PRODUCTION_DOCUMENTATION_WRITE, P.UNIT_READ].sort());
  for (const forbidden of [P.UNIT_STAGE_WRITE, P.QC_WRITE, P.ORDER_PRICE_READ, P.PAYMENT_READ, P.FINANCE_READ, P.CUSTOMER_PII_READ, P.INVENTORY_WRITE]) assert.equal(ROLE_PERMISSIONS.PRODUCTION_DOCUMENTER.includes(forbidden), false, forbidden);
  assert.equal(ROLE_PERMISSIONS.PRODUCTION_WORKER.includes(P.PRODUCTION_DOCUMENTATION_WRITE), false);
  assert.ok(PORTALS.find((p) => p.key === "bengkel").roles.includes("PRODUCTION_DOCUMENTER"), "peran khusus bisa membuka workspace Production");
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /enum Role \{[\s\S]*?\bPRODUCTION_DOCUMENTER\b[\s\S]*?\n\}/);
});

test("migration role P10B: additive murni (hanya ADD VALUE), tidak ada migration lain untuk dokumentasi (tabel bukti dipakai ulang)", () => {
  const dirs = readdirSync(path.join(here, "..", "prisma", "migrations")).filter((d) => /production_documenter|dokumentasi|documentation/i.test(d));
  assert.deepEqual(dirs, ["20261013090000_role_production_documenter"]);
  const sql = read(`prisma/migrations/${dirs[0]}/migration.sql`).replace(/--.*$/gm, "");
  assert.match(sql, /ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PRODUCTION_DOCUMENTER'/);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|CREATE TABLE|ALTER TABLE)\b/i);
});

test("pagar kode: route tulis butuh izin khusus; unggah memakai magic byte + preservePath + nama simpan sha1; command idempoten + terkunci; tak ada tabel/penyimpanan paralel", () => {
  const route = read("src/routes/productionDocumentation.js");
  for (const ep of ["/upload", "/runs/:runId/submit", "/runs/:runId/correct"]) assert.match(route, new RegExp(`post\\("${ep.replace(/[/:]/g, (c) => `\\${c}`)}", requirePermission\\(P\\.PRODUCTION_DOCUMENTATION_WRITE\\)`), ep);
  for (const ep of ["/queue", "/runs/:runId", "/matrix"]) assert.match(route, new RegExp(`get\\("${ep.replace(/[/:]/g, (c) => `\\${c}`)}", requirePermission\\(P\\.UNIT_READ\\)`), ep);
  assert.match(route, /sniffImageType\(buf\)/); assert.match(route, /preservePath: true/); assert.match(route, /createHash\("sha1"\)/); assert.match(route, /SAFE_NAME/);
  assert.match(route, /ALLOWED_MIME = new Set\(\["image\/jpeg", "image\/png", "image\/webp"\]\)/);
  assert.doesNotMatch(route, /originalname[^)]*\)?\s*[,;]?\s*\n?.*(path\.join|rename|writeFile)/, "nama klien tidak dipakai sebagai nama simpan");
  const svc = read("src/services/productionDocumentationService.js");
  assert.match(svc, /lockRowForUpdate\(tx, "production_runs_v2", runId\)[\s\S]{0,400}v2Command\.findUnique/, "run dikunci SEBELUM replay-check");
  assert.match(svc, /isProductionWriterEnabledFor/); assert.match(svc, /DOC_MEDIA_OTHER_UNIT/); assert.match(svc, /docStepCode\(category\)/);
  assert.doesNotMatch(svc, /revision:\s*\{?\s*increment|bumpRunRevisionInTx/, "dokumentasi tidak menaikkan revisi run");
  assert.doesNotMatch(read("prisma/schema.prisma"), /model\s+\w*Documentation\w*\s*\{/, "tidak ada model dokumentasi paralel");
  const steps = read("src/services/productionStepCommandService.js");
  assert.match(steps, /const evidence = allEvidence\.filter\(\(e\) => !isDocumentationRow\(e\)\)/);
  assert.match(steps, /NOT: \{ stepCode: \{ startsWith: DOC_STEP_CODE_PREFIX \} \}/, "versi bukti tahap tidak dihitung dari baris dokumentasi");
  const exp = read("src/routes/productionExperience.js");
  assert.match(exp, /productionExperienceRouter\.use\("\/documentation", productionDocumentationRouter\)/);
});
