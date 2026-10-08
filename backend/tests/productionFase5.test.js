// Fase 5 — Corner, siklus produksi, rangkaian dokumentasi: logika MURNI (tanpa DB).
import test from "node:test";
import assert from "node:assert/strict";
import { buildCornerRequest, cornerStatusOf, validateCornerDone, validateCornerStart } from "../src/lib/domain/productionCorner.js";
import { lifecycleStatusOf } from "../src/lib/domain/productionLifecycle.js";
import { buildDocumentationMatrix, buildDocumentationSequence } from "../src/lib/domain/productionDocumentation.js";

const invalid = (m) => Object.assign(new Error(m), { statusCode: 400, code: "STEP_EVIDENCE_INVALID" });

test("permintaan Sales: ganti kain tanpa motif/warna tertulis = 'Perlu konfirmasi Sales' (tidak menebak); detail tertulis = jelas; tanpa permintaan kain = tidak ada", () => {
  const vague = buildCornerRequest({ items: [{ layananName: "Ganti Kain Pinggir" }], orderNotes: "Mohon ganti kain, jangan terlalu tebal" });
  assert.deepEqual([vague.status, vague.needsSalesConfirmation, vague.missing, vague.statusLabel], ["PERLU_KONFIRMASI_SALES", true, ["motif", "warna"], "Perlu konfirmasi Sales"]);
  assert.match(vague.hint, /jangan menebak/); assert.equal(vague.notes, "Mohon ganti kain, jangan terlalu tebal");
  const colorOnly = buildCornerRequest({ items: [{ layananName: "Ganti Kain Sarung" }], orderNotes: "warna abu-abu tua" });
  assert.deepEqual([colorOnly.needsSalesConfirmation, colorOnly.missing], [true, ["motif"]], "hanya yang belum tertulis yang disebut");
  const clear = buildCornerRequest({ items: [{ layananName: "Ganti Kain Sarung" }], orderNotes: "motif polos warna abu-abu tua" });
  assert.deepEqual([clear.status, clear.needsSalesConfirmation, clear.hint], ["JELAS", false, null]);
  const none = buildCornerRequest({ items: [{ layananName: "Upgrade Fondasi" }], orderNotes: "Minta tekstur firm" });
  assert.deepEqual([none.status, none.fabricChangeRequested, none.missing], ["TIDAK_ADA_PERMINTAAN_KAIN", false, []]);
  assert.equal(buildCornerRequest({}).status, "TIDAK_ADA_PERMINTAAN_KAIN");
  const fromNotes = buildCornerRequest({ items: [], orderNotes: "tolong ganti sarung kasurnya" });
  assert.equal(fromNotes.fabricChangeRequested, true, "permintaan di catatan pesanan tanpa item kain tetap terbaca");
});

test("status Corner jujur: tidak berlaku (alasan + tanpa aktivitas), menunggu, dikerjakan, jahit selesai, selesai", () => {
  const na = cornerStatusOf({ cornerApplies: false, decision: false, reason: "Divan polos" });
  assert.deepEqual([na.status, na.applies, na.reason], ["TIDAK_BERLAKU", false, "Divan polos"]); assert.match(na.note, /PIC Meja/);
  assert.equal(cornerStatusOf({ cornerApplies: false, adaptation: true }).reason, "Mode adaptasi: tahap Corner dilewati sesuai kebijakan");
  assert.equal(cornerStatusOf({ cornerApplies: true, qcPassed: true }).status, "MENUNGGU_CORNER");
  assert.equal(cornerStatusOf({ cornerApplies: true, steps: new Set([9]) }).status, "MENUNGGU_CORNER");
  assert.equal(cornerStatusOf({ cornerApplies: true, steps: new Set([9, 10]) }).status, "DIKERJAKAN");
  assert.equal(cornerStatusOf({ cornerApplies: true, steps: new Set([9, 10, 11]) }).status, "JAHIT_SELESAI");
  assert.equal(cornerStatusOf({ cornerApplies: true, steps: new Set([9, 10, 11, 12]) }).status, "SELESAI");
  assert.equal(cornerStatusOf({ cornerApplies: true }).status, "BELUM_SAMPAI");
});

test("kontrak mulai Corner: periksa permintaan, kain lama/baru, kesesuaian, media; konfirmasi Sales wajib bila 'Perlu konfirmasi Sales' dan kain baru", () => {
  const vague = buildCornerRequest({ items: [{ layananName: "Ganti Kain" }], orderNotes: "ganti kain" });
  const base = { requestChecked: true, fabricMode: "NEW_INSTALLED", requestMatch: "SESUAI", salesConfirmation: "Sales: polos abu" };
  const ok = validateCornerStart(base, { brief: vague, mediaCount: 1, label: "Mulai Jahit" }, invalid);
  assert.deepEqual([ok.fabricMode, ok.requestStatusAtStart, ok.salesConfirmation], ["NEW_INSTALLED", "PERLU_KONFIRMASI_SALES", "Sales: polos abu"]);
  const bad = (p, m = 1, b = vague) => assert.throws(() => validateCornerStart({ ...base, ...p }, { brief: b, mediaCount: m, label: "x" }, invalid), (e) => e.code === "STEP_EVIDENCE_INVALID");
  bad({ requestChecked: false }); bad({ fabricMode: "LAIN" }); bad({ requestMatch: "?" }); bad({}, 0); bad({ salesConfirmation: "" });
  bad({ fabricMode: "OLD_REUSED", requestMatch: "SESUAI" }); bad({ requestMatch: "ADA_PERBEDAAN" });
  assert.equal(validateCornerStart({ ...base, salesConfirmation: undefined }, { brief: buildCornerRequest({ items: [], orderNotes: "x" }), mediaCount: 1, label: "x" }, invalid).salesConfirmation, null, "tanpa permintaan kain: konfirmasi tidak wajib");
  assert.equal(validateCornerStart({ ...base, fabricMode: "OLD_REUSED", requestMatch: "ADA_PERBEDAAN", requestNote: "Kain lama masih layak, disetujui Lead" }, { brief: vague, mediaCount: 1, label: "x" }, invalid).requestNote, "Kain lama masih layak, disetujui Lead");
});

test("kontrak jahit selesai: pekerjaan Corner wajib; perbedaan dicatat atau dinyatakan tidak ada", () => {
  assert.deepEqual(validateCornerDone({ cornerWork: "Jahit ulang", noDifference: true }, { label: "x" }, invalid), { cornerWork: "Jahit ulang", noDifference: true, differenceNote: null });
  assert.equal(validateCornerDone({ cornerWork: "Jahit ulang", noDifference: false, differenceNote: "List lebih lebar" }, { label: "x" }, invalid).differenceNote, "List lebih lebar");
  assert.throws(() => validateCornerDone({ cornerWork: "", noDifference: true }, { label: "x" }, invalid), /Pekerjaan Corner/);
  assert.throws(() => validateCornerDone({ cornerWork: "Jahit ulang" }, { label: "x" }, invalid), /catatan perbedaan/);
});

test("siklus produksi: satu kosakata — Corner tidak berlaku disebut jujur; Siap Kirim hanya setelah unit READY_FOR_DELIVERY; retur/Gudang = Menunggu Gudang", () => {
  const corner = (status, applies = true, reason = null) => ({ status, applies, reason });
  const L = (o) => lifecycleStatusOf({ runStatus: "ACTIVE", currentPhase: "PROCESS", unitStatus: "IN_PRODUCTION", started: true, ...o });
  assert.equal(L({ unitStatus: "READY_FOR_DELIVERY", runStatus: "COMPLETED" }).key, "SIAP_KIRIM");
  assert.equal(L({ unitStatus: "READY_FOR_DELIVERY", adaptation: true }).detail, "Diselesaikan dengan mode adaptasi (tanpa penerimaan barang jadi Gudang)");
  assert.equal(L({ currentPhase: "HANDOFF" }).key, "MENUNGGU_GUDANG");
  assert.equal(L({ next: { wait: "AWAITING_QC" } }).key, "MENUNGGU_QC");
  assert.equal(L({ latestQcResult: "FAIL_REWORK", next: { action: "START", stepNo: 7 } }).key, "REWORK");
  assert.equal(L({ cornerStatus: corner("MENUNGGU_CORNER"), next: { stepNo: 10, action: "START_CORNER" } }).key, "MENUNGGU_CORNER");
  assert.equal(L({ cornerStatus: corner("DIKERJAKAN"), next: { stepNo: 11 } }).key, "DI_CORNER");
  const na = L({ cornerStatus: corner("TIDAK_BERLAKU", false, "Divan polos"), next: { action: "FINISH", stepNo: 12, actor: "TABLE" } });
  assert.deepEqual([na.key, na.cornerNotApplicable, na.cornerReason], ["SIAP_DISELESAIKAN", true, "Divan polos"]);
  assert.equal(L({ next: { wait: "READY_TO_FINISH" } }).key, "SIAP_DISELESAIKAN");
  assert.equal(L({ unitStatus: "DELIVERED" }).key, "TERKIRIM"); assert.equal(L({ runStatus: "CANCELLED" }).key, "DIBATALKAN"); assert.equal(L({ started: false }).key, "BELUM_MULAI");
});

test("rangkaian dokumentasi: tujuh langkah berurutan; sumber dikenali; Corner tidak berlaku diberi alasan (bukan foto buatan)", () => {
  const mk = (cornerApplicable) => {
    const matrix = buildDocumentationMatrix({
      applicableSteps: cornerApplicable ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1, 2, 3, 4, 5, 6, 7, 8, 12], recordedSteps: new Set([1, 2, 3, 6, 7, 8]), nextStepNo: 9, started: true, run: { origin: "CUSTODY_PICKUP", status: "ACTIVE" }, qcDone: true,
      stepMedia: new Map([[6, [{ url: "u1", kind: "video", actorName: "Meja" }]], [8, [{ url: "u2", kind: "video" }]]]), extra: { pickupPhoto: { url: "p", createdAt: null }, diagnosisPhotos: [], qcPhotos: [{ url: "q", kind: "image" }] }, docRows: [],
      naReasons: { CORNER: "Corner tidak diperlukan — keputusan Lead: Divan polos" },
    });
    return buildDocumentationSequence(matrix, { recordedNotes: new Set(["PLAN_RACIKAN", "AFTER", "WHOLE_TEST_AFTER"]), cornerStatus: { status: cornerApplicable ? "MENUNGGU_CORNER" : "TIDAK_BERLAKU", label: "x" } });
  };
  const seq = mk(true);
  assert.deepEqual(seq.map((x) => x.key), ["BEFORE_TEARDOWN", "OLD_CONTENT", "RACIKAN", "ASSEMBLY", "QC_TEST", "CORNER", "FINAL"]);
  assert.equal(seq.find((x) => x.key === "RACIKAN").status, "LENGKAP", "racikan = catatan komponen tercatat (tanpa foto wajib)");
  const qc = seq.find((x) => x.key === "QC_TEST"); assert.ok(qc.sources.QC >= 1 && qc.sources.Meja >= 1, "sumber QC dan Meja dikenali");
  assert.equal(seq.find((x) => x.key === "BEFORE_TEARDOWN").sources.Driver, 1, "foto pickup dikenali sebagai Driver");
  const na = mk(false).find((x) => x.key === "CORNER");
  assert.deepEqual([na.status, na.naReason, na.count], ["NA", "Corner tidak diperlukan — keputusan Lead: Divan polos", 0]);
});
