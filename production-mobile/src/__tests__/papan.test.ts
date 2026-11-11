import { itemSekarang, perluPerhatian, ringkasMeja } from "@/features/papan";
import type { AndonItem, AndonStation } from "@/api/types";

const item = (o: Partial<AndonItem> & { runId: string }): AndonItem => ({
  unitCode: `RES-12112026-${o.runId}-U1`, customerName: "Bu Rina", merk: null, ukuran: null, bucket: "ANTREAN", bucketLabel: "Antrean",
  stepNo: null, stepLabel: null, progress: { done: 0, skipped: 0, remaining: 10, total: 10 },
  timer: { startedAt: null, stepStartedAt: null, elapsedMinutes: 0, stepElapsedMinutes: 0, late: false },
  priority: 0, priorityLabel: "Normal", operatorName: "Risdy", cornerName: null, shortage: null, ...o,
});
const meja = (items: AndonItem[]): AndonStation => ({ code: "MEJA_1", label: "Meja 1", capacity: 4, operatorNames: ["Risdy"], items });

test("item sekarang = yang pertama sedang dikerjakan/terhambat menurut urutan server", () => {
  expect(itemSekarang([item({ runId: "001" }), item({ runId: "002", bucket: "FONDASI" }), item({ runId: "003", bucket: "BONGKAR" })])?.runId).toBe("002");
  expect(itemSekarang([item({ runId: "001" })])).toBeNull();
});

test("ringkasan meja: kosong, kerja, terhambat dengan nama bahan", () => {
  expect(ringkasMeja(meja([item({ runId: "001" })])).status).toBe("kosong");
  const kerja = ringkasMeja(meja([item({ runId: "004", bucket: "FONDASI", stepLabel: "Upgrade Fondasi", timer: { startedAt: null, stepStartedAt: null, elapsedMinutes: 0, stepElapsedMinutes: 42, late: false } })]));
  expect(kerja).toMatchObject({ status: "kerja", pic: "Risdy", sekarang: { kode: "004-U1", tahap: "Upgrade Fondasi", tone: "blue", menit: 42 } });
  const hambat = ringkasMeja(meja([item({ runId: "007", bucket: "MENUNGGU_BAHAN", bucketLabel: "Tertunda", shortage: ["Busa 5cm"] })]));
  expect(hambat.status).toBe("terhambat");
  expect(hambat.sekarang?.tahap).toBe("Bahan kurang: Busa 5cm");
});

test("butuh perhatian: komplain, menunggu bahan, lewat target — unit normal tidak", () => {
  const r = perluPerhatian([meja([
    item({ runId: "009", priority: 3, priorityLabel: "Komplain" }),
    item({ runId: "007", bucket: "MENUNGGU_BAHAN" }),
    item({ runId: "010", timer: { startedAt: null, stepStartedAt: null, elapsedMinutes: 0, stepElapsedMinutes: 0, late: true } }),
    item({ runId: "011" }),
  ])]);
  expect(r.map((x) => x.kode)).toEqual(["009-U1", "007-U1", "010-U1"]);
  expect(r[0]!.tone).toBe("red");
  expect(r[2]!.tone).toBe("orange");
});
