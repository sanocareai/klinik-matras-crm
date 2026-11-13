import type { RunView } from "@/api/types";
import {
  formAwal, kapasitas, opsiLini, perhatianAdmin, perintahJadwal, perluAlasanUlang, sasaranDariBacklog, sasaranDariView, validasiJadwal,
  type ItemBacklog, type MejaPapan, type RefsJadwal, type Sasaran,
} from "@/features/jadwal";

const view = (o: Partial<RunView> & { plan?: unknown } = {}): RunView => ({
  runId: "r1", revision: 1, status: "ACTIVE", track: "RESTORATION", bucket: "ANTREAN", bucketLabel: "Antrean",
  priority: { key: "NORMAL", label: "Normal", rank: 0 },
  unit: { id: "u1", unitCode: "RES-12112026-004-U1", merk: null, ukuran: null, status: "RECEIVED", photoUrl: null, service: null },
  customer: { orderNumber: null, name: "Bu Ani", city: null, weightKg: null, complaints: [], request: null, salesServices: [], promiseDate: null, salesName: null },
  plan: null, next: null, progress: { done: 0, skipped: 0, remaining: 12, total: 12 },
  timer: { startedAt: null, stepStartedAt: null, elapsedMinutes: 0, stepElapsedMinutes: 0, late: false }, activeOp: null, shortage: null,
  ...o,
} as RunView);

const meja = (code: string, n: number, o: Partial<MejaPapan> = {}): MejaPapan => ({
  code, label: code.replace("TABLE_", "Meja "), capacity: 3, count: n, operatorNames: [], defaultPic: null,
  items: Array.from({ length: n }, (_, i) => view({ runId: `${code}-${i}` })), ...o,
});
const refs: RefsJadwal = {
  workCenters: [{ id: "wc1", name: "Workshop Utama" }], defaultWorkCenterId: "wc1",
  operators: [
    { id: "op-risdy", name: "Risdy", userId: "us1", workLanes: ["TABLE"] },
    { id: "op-emon", name: "Emon", userId: "us2", workLanes: ["TABLE", "CORNER"] },
    { id: "op-ferdy", name: "Ferdy", userId: "us3", workLanes: [] },
  ],
};

const backlog = (o: Partial<ItemBacklog["rencana"]> = {}, prio = "NORMAL"): ItemBacklog => ({
  unitId: "u9", schedulable: false, view: null,
  rencana: { action: "ONBOARD_SCHEDULE", onboardable: true, activatable: false, build: null, ...o },
  card: { unit: { id: "u9", unitCode: "NEW-12112026-001-U1", merk: null, ukuran: null }, customer: { name: "Pak Budi", orderNumber: "NEW-1" }, priority: { key: prio, label: prio, rank: 0 } },
});

describe("sasaran", () => {
  it("kartu backlog tanpa Run: dijadwalkan lewat unitId; aktivasi & Corner ditanyakan sesuai server", () => {
    const s = sasaranDariBacklog(backlog({ build: { product: { problem: null } } }))!;
    expect(s.runId).toBeNull();
    expect(s.tanyaCorner).toBe(true);
    expect(s.tanyaAktivasi).toBe(false);
    const a = sasaranDariBacklog(backlog({ onboardable: false, activatable: true }))!;
    expect(a.tanyaAktivasi).toBe(true);
  });
  it("kartu backlog yang belum bisa dijadwalkan (menunggu dijemput) → null", () => {
    expect(sasaranDariBacklog(backlog({ onboardable: false, activatable: false, action: "WAIT_PICKUP" }))).toBeNull();
  });
  it("kartu Komplain: prioritas bawaan Tinggi", () => {
    expect(sasaranDariView(view({ priority: { key: "COMPLAINT", label: "Komplain", rank: 2 } })).saranPrioritas).toBe(1);
    expect(sasaranDariView(view()).saranPrioritas).toBe(0);
  });
});

describe("pilihan formulir", () => {
  it("kapasitas & meja lega bawaan", () => {
    expect(kapasitas(meja("TABLE_1", 3)).penuh).toBe(true);
    const f = formAwal(sasaranDariView(view()), { tanggal: "2026-11-13", stations: [meja("TABLE_1", 3), meja("TABLE_2", 1)], refs });
    expect(f.stationCode).toBe("TABLE_2");
    expect(f.workCenterId).toBe("wc1");
    expect(f.operatorId).toBe("");
  });
  it("PIC per lini: hanya yang berlini; PIC lama yang tak berlini tetap tampil bertanda", () => {
    expect(opsiLini(refs.operators, "TABLE").map((o) => o.name)).toEqual(["Risdy", "Emon"]);
    expect(opsiLini(refs.operators, "CORNER").map((o) => o.name)).toEqual(["Emon"]);
    const o = opsiLini(refs.operators, "CORNER", { id: "op-ferdy", name: "Ferdy" });
    expect(o[0]).toEqual({ id: "op-ferdy", name: "Ferdy", lama: true });
  });
});

describe("validasi & body (cermin ScheduleModal web)", () => {
  const baru: Sasaran = sasaranDariView(view());
  const f0 = formAwal(baru, { tanggal: "2026-11-13", stations: [meja("TABLE_1", 0)], refs });

  it("tanpa PIC pilihan & tanpa PIC bawaan aktif → ditolak; PIC bawaan aktif cukup", () => {
    expect(validasiJadwal(baru, f0, null)).toMatch(/PIC meja/);
    expect(validasiJadwal(baru, f0, { operatorId: "op-risdy", name: "Risdy", active: true })).toBeNull();
  });

  it("rencana baru dari Run: POST /plans dengan runId; operatorId tidak dikirim bila ikut bawaan", () => {
    const p = perintahJadwal(baru, f0);
    expect(p.jenis).toBe("rencana");
    expect(p.body).toEqual({ runId: "r1", productionDate: "2026-11-13", stationCode: "TABLE_1", priority: 0, workCenterId: "wc1" });
  });

  it("onboarding Corner TIDAK: alasan wajib ≥3 huruf; body membawa unitId + keputusan Corner + aktivasi", () => {
    const s = sasaranDariBacklog(backlog({ onboardable: false, activatable: true, build: { product: { problem: null } } }))!;
    const f = { ...f0, operatorId: "op-risdy", corner: "NO" as const, alasanCorner: "ok" };
    expect(validasiJadwal(s, f, null)).toMatch(/aktifkan|persetujuan/i);
    expect(validasiJadwal(s, { ...f, aktivasiOk: true }, null)).toMatch(/minimal 3/);
    const g = { ...f, aktivasiOk: true, alasanCorner: "tanpa kain" };
    expect(validasiJadwal(s, g, null)).toBeNull();
    expect(perintahJadwal(s, g).body).toEqual({
      unitId: "u9", productionDate: "2026-11-13", stationCode: "TABLE_1", priority: 0, workCenterId: "wc1", operatorId: "op-risdy",
      activateUnit: true, cornerRequired: false, cornerReason: "tanpa kain",
    });
  });

  it("kartu terjadwal lewat target dipindah tanggal → alasan + catatan wajib; schedule membawa expectedRevision", () => {
    const s = sasaranDariView(view({ plan: { id: "p1", revision: 7, productionDate: "2026-11-10", stationCode: "TABLE_1", stationLabel: "Meja 1", stationSequence: 1, priorityLabel: "Normal", priorityRank: 0, priority: 0, targetDate: null, targetMissed: true, targetEffective: "2026-11-10", operator: { id: "op-risdy", name: "Risdy" }, cornerOperator: null } as never }));
    const f = { ...formAwal(s, { tanggal: "2026-11-13", stations: [meja("TABLE_1", 1)], refs }), productionDate: "2026-11-13" };
    expect(perluAlasanUlang(s, f)).toBe(true);
    expect(validasiJadwal(s, f, null)).toMatch(/Target sudah lewat/);
    const g = { ...f, alasanUlang: "WAITING_MATERIAL", catatanUlang: "bahan busa telat" };
    expect(validasiJadwal(s, g, null)).toBeNull(); // PIC lama rencana ini sudah ada
    const p = perintahJadwal(s, g);
    expect(p).toEqual({ jenis: "jadwal", planId: "p1", body: expect.objectContaining({ expectedRevision: 7, rescheduleReason: "WAITING_MATERIAL", rescheduleNote: "bahan busa telat" }) });
    expect(perintahJadwal(s, g, true).body).toEqual({ productionDate: null, stationCode: null, priority: 0, expectedRevision: 7 });
  });
});

describe("perhatian Admin", () => {
  it("Komplain dulu (papan & belum dijadwalkan), lalu lewat target, tertunda, Tinggi belum dijadwalkan", () => {
    const stations = [meja("TABLE_1", 0, {
      items: [
        view({ runId: "a", bucket: "MENUNGGU_BAHAN" }),
        view({ runId: "b", plan: { targetMissed: true } as never }),
        view({ runId: "c", priority: { key: "COMPLAINT", label: "Komplain", rank: 2 } }),
        view({ runId: "d" }),
      ],
    })];
    const list = perhatianAdmin(stations, [backlog({}, "HIGH"), { ...backlog({}, "COMPLAINT"), unitId: "u8" }]);
    expect(list.map((p) => p.alasan)).toEqual([
      "Komplain · Meja 1", "Komplain · belum dijadwalkan", "Lewat target · Meja 1", "Menunggu bahan · Meja 1", "Prioritas Tinggi · belum dijadwalkan",
    ]);
    expect(list[1]!.sasaran?.unitId).toBe("u9");
  });
});
