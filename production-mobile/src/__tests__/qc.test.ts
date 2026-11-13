import { bodyQc, gerbangLulus, opsiRework, validasiQc, type FormQc } from "@/features/qc";

const dasar: FormQc = { mode: "PASS", photoUrls: ["/media/unit-photos/a.jpg"], referenceWeightKg: "80", fitVerdict: "PAS", note: "", reworkStageId: "" };

test("validasi QC kasur: foto, berat acuan bulat, gagal wajib verdict+catatan+tahap rework", () => {
  expect(validasiQc({ ...dasar, photoUrls: [] }, "KASUR")).toMatch(/Foto bukti/);
  expect(validasiQc({ ...dasar, referenceWeightKg: "80.5" }, "KASUR")).toMatch(/bilangan bulat/);
  expect(validasiQc(dasar, "KASUR")).toBeNull();
  const gagal: FormQc = { ...dasar, mode: "FAIL", fitVerdict: "TERLALU_EMPUK" };
  expect(validasiQc(gagal, "KASUR")).toMatch(/Catatan temuan/);
  expect(validasiQc({ ...gagal, note: "tengah turun" }, "KASUR")).toMatch(/Tahap rework/);
  expect(validasiQc({ ...gagal, note: "tengah turun", reworkStageId: "s1" }, "KASUR")).toBeNull();
  expect(validasiQc({ ...dasar, referenceWeightKg: "" }, "GENERIC")).toBeNull();
});

test("body QC sama bentuknya dengan web", () => {
  expect(bodyQc(dasar, 4, "KASUR")).toEqual({ expectedRevision: 4, result: "PASS", photoUrls: ["/media/unit-photos/a.jpg"], referenceWeightKg: 80, note: undefined, fitVerdict: "PAS" });
  expect(bodyQc({ ...dasar, mode: "FAIL", fitVerdict: "TERLALU_KERAS", note: " x ", reworkStageId: "s1" }, 4, "KASUR"))
    .toEqual({ expectedRevision: 4, result: "FAIL", photoUrls: ["/media/unit-photos/a.jpg"], referenceWeightKg: 80, note: "x", fitVerdict: "TERLALU_KERAS", reworkStageId: "s1" });
  expect(bodyQc({ ...dasar, mode: "FAIL", note: "x", reworkStageId: "s1" }, 2, "GENERIC")).toEqual({ expectedRevision: 2, result: "FAIL", photoUrls: ["/media/unit-photos/a.jpg"], note: "x", reworkStageId: "s1" });
});

test("tahap rework hanya sebelum gerbang QC; gerbang lulus mengikuti catatan komponen", () => {
  const st = [
    { id: "a", code: "teardown", label: "Bongkar", order: 1, isQcGate: false },
    { id: "b", code: "comfort_layer_upgrade", label: "Lapisan Baru", order: 2, isQcGate: false },
    { id: "q", code: "fit_test", label: "Uji Berat Badan", order: 3, isQcGate: true },
    { id: "c", code: "corner_sewing", label: "Jahit Corner", order: 4, isQcGate: false },
  ];
  expect(opsiRework(st).map((s) => s.id)).toEqual(["a", "b"]);
  expect(gerbangLulus(null).ok).toBe(true);
  const g = gerbangLulus({ applicable: true, round: 2, hasFoundation: true, current: { foundationTest: { ok: true }, after: { ok: false }, wholeTest: null } });
  expect(g.ok).toBe(false);
  expect(g.pesan).toMatch(/putaran 2: hasil aktual susunan; uji kasur jadi/);
});
