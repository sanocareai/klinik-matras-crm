// Helper tes integrasi — pengujian awal LAYANAN (fase 2): sejak gerbang QC sebelum bongkar, tahap 2/3/4 non-adaptasi menunggu catatan PIC QC (uji kasur utuh, uji fondasi) dan lapisan awal.
// Memakai endpoint resmi Catatan Komponen (bukan jalan pintas DB), jadi tes lama tetap menguji jalur nyata.
import { testPrisma } from "./testDb.js";

let seq = 0;
const key = (tag) => `pt-${tag}-${Date.now().toString(36)}-${++seq}-kunci`;

export async function unitOfRun(runId) {
  return (await testPrisma.productionRun.findUniqueOrThrow({ where: { id: runId }, select: { unitId: true } })).unitId;
}

// Video kecil (jenis dari daftar izin; tidak disniff) lewat unggah Catatan Komponen.
export async function uploadVideo(server, who, unitId, { bytes = null } = {}) {
  const fd = new FormData();
  fd.append("files", new Blob([Buffer.from(bytes || `vid-${Math.random()}-${++seq}`)], { type: "video/mp4" }), "uji.mp4");
  const res = await fetch(`${server.baseUrl}/api/production-v2/component-notes/units/${unitId}/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  const body = await res.json();
  if (res.status !== 201) throw new Error(`upload gagal ${res.status}: ${JSON.stringify(body)}`);
  return body.items.map((i) => ({ url: i.url, caption: null }));
}

export const WHOLE = { complaintMatch: "SEBAGIAN", complaintNote: "Pinggang terasa lebih sakit di sisi kiri", feelNote: "Tengah terasa amblas", testerWeightKg: 75, testMethod: "Berbaring di tengah 1 menit", wholeDropCm: 4, qcInFrame: true };
export const FOUNDATION = { system: "BONNELL", unloadedHeightCm: 25, loadedHeightCm: 15, testerWeightKg: 75, testMethod: "Beban di tengah rangka" };
export const LAYERS = { layers: [
  { material: { kind: "MANUAL", text: "Memory foam" }, thicknessCm: 6, condition: "AUS", note: null },
  { material: { kind: "UNKNOWN" }, thicknessCm: null, condition: "TIDAK_DIKETAHUI", note: "Busa bawah" },
] };

export async function save(server, who, unitId, section, { data, media = [], expectedVersion = 0, reason, idempotencyKey = key(section) }) {
  return who.api.post(`/api/production-v2/component-notes/units/${unitId}/sections/${section}`, { expectedVersion, data, media, ...(reason ? { reason } : {}) }, { "Idempotency-Key": idempotencyKey });
}
async function mustSave(server, who, unitId, section, opts) {
  const res = await save(server, who, unitId, section, opts);
  if (![200, 201].includes(res.status)) throw new Error(`${section} gagal ${res.status}: ${JSON.stringify(res.body)}`);
  return res;
}
export async function qcWhole(server, qc, runId, over = {}) { const unitId = await unitOfRun(runId); return mustSave(server, qc, unitId, "WHOLE_TEST_BEFORE", { data: { ...WHOLE, ...over }, media: await uploadVideo(server, qc, unitId) }); }
export async function foundationTest(server, qc, runId, over = {}) { const unitId = await unitOfRun(runId); return mustSave(server, qc, unitId, "FOUNDATION_TEST_BEFORE", { data: { ...FOUNDATION, ...over }, media: await uploadVideo(server, qc, unitId) }); }
export async function layersBefore(server, who, runId, over = {}) { const unitId = await unitOfRun(runId); return mustSave(server, who, unitId, "LAYERS_BEFORE", { data: { ...LAYERS, ...over } }); }

// ---- Fase 4 (perakitan -> uji hasil): uji fondasi baru, hasil aktual susunan, uji kasur jadi — lewat endpoint resmi Catatan Komponen.
export const FOUNDATION_AFTER = { system: "BONNELL", unloadedHeightCm: 25, loadedHeightCm: 23, testerWeightKg: 75, testMethod: "Beban di tengah rangka", sameMethodAsBefore: true };
export const WHOLE_AFTER = { complaintMatch: "SESUAI", complaintNote: "Pinggang terasa tertopang", feelNote: "Tengah kokoh, pinggir rata", testerWeightKg: 75, testMethod: "Berbaring di tengah 1 menit", wholeDropCm: 1, qcInFrame: true, sameMethodAsBefore: true };
export const AFTER_SIMPLE = { foundation: null, layers: [{ action: "REPLACE", material: { kind: "MANUAL", text: "Busa HD baru" }, thicknessCm: 5 }] };
export async function foundationAfter(server, qc, runId, over = {}, { expectedVersion = 0, reason } = {}) { const unitId = await unitOfRun(runId); return mustSave(server, qc, unitId, "FOUNDATION_TEST_AFTER", { data: { ...FOUNDATION_AFTER, ...over }, media: await uploadVideo(server, qc, unitId), expectedVersion, reason }); }
export async function wholeAfter(server, qc, runId, over = {}, { expectedVersion = 0, reason } = {}) { const unitId = await unitOfRun(runId); return mustSave(server, qc, unitId, "WHOLE_TEST_AFTER", { data: { ...WHOLE_AFTER, ...over }, media: await uploadVideo(server, qc, unitId), expectedVersion, reason }); }
export async function afterRecord(server, who, runId, over = {}, { expectedVersion = 0, reason } = {}) { const unitId = await unitOfRun(runId); return mustSave(server, who, unitId, "AFTER", { data: { ...AFTER_SIMPLE, ...over }, expectedVersion, reason }); }
