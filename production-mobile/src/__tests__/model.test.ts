import { formatMenit, grupMedia, kartuDariV1, kartuDariV2, kodePendek, prioritasDari, ringkasPapan, susunAntrean } from "@/features/model";
import type { RunView, V1QueueItem } from "@/api/types";

const v2 = (o: Partial<RunView> & { runId: string }): RunView => ({
  revision: 1, status: "IN_PROGRESS", track: "RESTORATION", bucket: "ANTREAN", bucketLabel: "Antrean",
  priority: { key: "NORMAL", label: "Normal", rank: 0 },
  unit: { id: `u-${o.runId}`, unitCode: `RES-12112026-${o.runId}-U1`, merk: "Sano Royal", ukuran: "180×200", status: "IN_PRODUCTION", photoUrl: null, service: null },
  customer: { orderNumber: null, name: "Bu Rina", city: null, weightKg: null, complaints: [], request: null, salesServices: ["Upgrade"], promiseDate: null, salesName: null },
  plan: null, next: null, progress: { done: 0, skipped: 0, remaining: 10, total: 10 },
  timer: { startedAt: null, stepStartedAt: null, elapsedMinutes: 0, stepElapsedMinutes: 0, late: false },
  activeOp: null, shortage: null,
  ...o,
});

test("kode pendek membuang prefiks order", () => {
  expect(kodePendek("RES-12112026-004-U1")).toBe("004-U1");
  expect(kodePendek("LEG-abcd1234")).toBe("LEG-abcd1234");
});

test("prioritas: komplain merah, tinggi oranye, normal disembunyikan", () => {
  expect(prioritasDari("COMPLAINT", "Komplain", 3)?.tone).toBe("red");
  expect(prioritasDari("HIGH", "Tinggi", 1)?.tone).toBe("orange");
  expect(prioritasDari("NORMAL", "Normal", 0)).toBeNull();
});

test("kartu V2: aktif hanya bila ada operasi berjalan di bucket kerja; jeda berwarna oranye", () => {
  const jalan = kartuDariV2(v2({ runId: "004", bucket: "FONDASI", bucketLabel: "Fondasi Baru", activeOp: { stageLabel: "Upgrade Fondasi", status: "IN_PROGRESS", startedAt: null, delayKind: null, delayNote: null }, timer: { startedAt: null, stepStartedAt: null, elapsedMinutes: 50, stepElapsedMinutes: 42, late: false } }));
  expect(jalan.aktif).toBe(true);
  expect(jalan.tone).toBe("blue");
  expect(jalan.menit).toBe(42);
  expect(jalan.tahap).toBe("Upgrade Fondasi");
  const jeda = kartuDariV2(v2({ runId: "005", bucket: "LAPISAN", activeOp: { stageLabel: "Ganti Kain", status: "PAUSED", startedAt: null, delayKind: "BREAK", delayNote: null } }));
  expect(jeda.tone).toBe("orange");
  expect(jeda.tahap).toBe("Jeda · Ganti Kain");
  const tunda = kartuDariV2(v2({ runId: "008", bucket: "FONDASI", activeOp: { stageLabel: "Upgrade Fondasi", status: "BLOCKED", startedAt: null, delayKind: "ARAHAN", delayNote: null } }));
  expect(tunda.tone).toBe("red");
  expect(tunda.tahap).toBe("Tertunda · Upgrade Fondasi");
  const tunggu = kartuDariV2(v2({ runId: "006", bucket: "FONDASI", next: { action: "WAIT" }, activeOp: { stageLabel: "x", status: "IN_PROGRESS", startedAt: null, delayKind: null, delayNote: null } }));
  expect(tunggu.aktif).toBe(false);
});

test("susun antrean: urutan server dipertahankan, yang sedang dikerjakan naik ke atas, V1 sesudah V2", () => {
  const a = v2({ runId: "001" });
  const b = v2({ runId: "002", bucket: "BONGKAR", activeOp: { stageLabel: "Bongkar", status: "IN_PROGRESS", startedAt: null, delayKind: null, delayNote: null } });
  const c = v2({ runId: "003" });
  const v1: V1QueueItem = { state: "READY", stage: { id: "s", code: "teardown", labelId: "Bongkar" }, unit: { id: "lama", unitCode: "LEG-1", merk: null, ukuran: null, status: "RECEIVED" } };
  const r = susunAntrean([a, b, c], [v1]);
  expect(r.aktif?.runId).toBe("002");
  expect(r.antrean.map((k) => k.kodePendek)).toEqual(["001-U1", "003-U1", "LEG-1"]);
  expect(r.antrean.map((k) => k.no)).toEqual([2, 3, 4]);
  expect(kartuDariV1(v1).tahap).toBe("Siap dikerjakan · Bongkar");
});

test("format menit", () => {
  expect(formatMenit(42)).toBe("42 mnt");
  expect(formatMenit(60)).toBe("1 jam");
  expect(formatMenit(75)).toBe("1 j 15 mnt");
  expect(formatMenit(null)).toBe("—");
});

test("ringkasan papan memakai KPI server", () => {
  const r = ringkasPapan({ readerMode: "COHORT", kpi: { target: 12, planned: 12, completed: 4, waitingMaterial: 1, late: 0 }, counts: { FONDASI: 2, BONGKAR: 1, QC: 1, CORNER: 1 }, stations: [] });
  expect(r).toEqual({ target: 12, selesai: 4, dikerjakan: 5, terhambat: 1, terlambat: 0 });
  expect(ringkasPapan(undefined).target).toBe(0);
});

test("media: dikelompokkan Sebelum/Proses/Sesudah, video dikenali, URL kosong dibuang", () => {
  const g = grupMedia({
    runId: "r", unit: { unitCode: "x", merk: null, ukuran: null, service: null }, order: { orderNumber: null, customerName: null }, mediaCount: 3,
    media: {
      before: [{ url: "/media/production-evidence/a.jpg?sig=1", kind: "PHOTO" }, { url: null }],
      process: [{ url: "/media/production-evidence/b.mp4?sig=2", kind: "VIDEO", stepLabel: "Uji Fondasi" }],
      after: [],
    },
  });
  expect(g.map((x) => x.key)).toEqual(["before", "process"]);
  expect(g[0]!.items).toHaveLength(1);
  expect(g[1]!.items[0]!.video).toBe(true);
});

test("berat pemakai dari order: per pemakai bila ada, selain itu berat badan order", () => {
  const { beratPemakai, teksBerat } = jest.requireActual("@/features/model");
  expect(beratPemakai({ weightKg: 70, weightEntries: [{ label: "Suami", beratKg: 85 }, { label: "Istri", beratKg: 58 }] })).toEqual([{ label: "Suami", kg: 85 }, { label: "Istri", kg: 58 }]);
  expect(beratPemakai({ weightKg: 70, weightEntries: [] })).toEqual([{ label: "Customer", kg: 70 }]);
  expect(beratPemakai({ weightKg: null })).toEqual([]);
  expect(teksBerat(beratPemakai({ weightKg: 70 }))).toBe("70 kg");
  expect(teksBerat(beratPemakai({ weightEntries: [{ label: "Suami", beratKg: 85 }, { label: "Istri", beratKg: 58 }] }))).toBe("Suami 85 kg · Istri 58 kg");
});

test("geser urutan: naik/turun, batas tidak berubah", () => {
  const { geser } = jest.requireActual("@/features/model");
  expect(geser(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
  expect(geser(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  const xs = ["a", "b"];
  expect(geser(xs, 0, -1)).toBe(xs);
  expect(geser(xs, 1, 1)).toBe(xs);
});
