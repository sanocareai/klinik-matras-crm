import {
  barisSebelumKosong, barisSesudahKosong, catatanDitunggu, drafDari, drafDariRencana, payloadKomponen, penurunanFondasi, perbedaanDariRencana, rapikanBahan,
  ringkasLapisan, validasiKomponen, type Draf,
} from "@/features/komponen";
import { payloadLangkah, validasiLangkah } from "@/features/langkah";

const kosong = (b: Parameters<typeof drafDari>[0]): Draf => drafDari(b, null);
const foto = { url: "/media/production-evidence/a.jpg", previewUrl: "/a?s", kind: "image", caption: "" };

describe("lapisan sebelum bongkar (Meja)", () => {
  it("minimal satu lapisan atau 'tidak diketahui'; tiap lapisan wajib bahan + kondisi; ketebalan opsional 0–100", () => {
    const d = kosong("LAYERS_BEFORE");
    expect(validasiKomponen("LAYERS_BEFORE", d)).toMatch(/minimal satu lapisan/);
    expect(validasiKomponen("LAYERS_BEFORE", { ...d, layersUnknown: true })).toBeNull();
    const l = { ...barisSebelumKosong(), material: { kind: "MANUAL" as const, text: "x" } };
    expect(validasiKomponen("LAYERS_BEFORE", { ...d, layersBefore: [l] })).toMatch(/pilih bahan/);
    const ok = { ...l, material: { kind: "UNKNOWN" as const }, condition: "KEMPES", thickness: "5" };
    expect(validasiKomponen("LAYERS_BEFORE", { ...d, layersBefore: [{ ...ok, thickness: "150" }] })).toMatch(/ketebalan/);
    const dd = { ...d, layersBefore: [ok, { ...ok, id: "z", thickness: "" }] };
    expect(validasiKomponen("LAYERS_BEFORE", dd)).toBeNull();
    expect(payloadKomponen("LAYERS_BEFORE", dd)).toEqual({ layersUnknown: false, note: null, layers: [
      { material: { kind: "UNKNOWN" }, thicknessCm: 5, condition: "KEMPES", note: null }, { material: { kind: "UNKNOWN" }, thicknessCm: null, condition: "KEMPES", note: null },
    ] });
    expect(ringkasLapisan(dd)).toMatch(/belum lengkap — 5 cm dari 1 lapisan/);
  });
  it("koreksi entri yang sudah ada wajib beralasan", () => {
    expect(validasiKomponen("LAYERS_BEFORE", { ...kosong("LAYERS_BEFORE"), layersUnknown: true }, { koreksi: true })).toMatch(/alasan koreksi/);
  });
});

describe("pengujian PIC QC", () => {
  it("uji fondasi: sistem, tinggi tanpa beban ≥ dibebani, berat aktual, metode, foto; penurunan dihitung server (tidak dikirim)", () => {
    let d: Draf = { ...kosong("FOUNDATION_TEST_BEFORE"), system: "POCKET_SPRING", unloadedHeight: "20", loadedHeight: "22", testerWeight: "70", testMethod: "duduk di tengah" };
    expect(validasiKomponen("FOUNDATION_TEST_BEFORE", d)).toMatch(/tidak boleh lebih besar/);
    d = { ...d, loadedHeight: "17,5" };
    expect(validasiKomponen("FOUNDATION_TEST_BEFORE", d)).toMatch(/Lampirkan minimal 1/);
    d = { ...d, media: [foto] };
    expect(validasiKomponen("FOUNDATION_TEST_BEFORE", d)).toBeNull();
    expect(penurunanFondasi(d)).toBe(2.5);
    const p = payloadKomponen("FOUNDATION_TEST_BEFORE", d);
    expect(p).not.toHaveProperty("dropCm");
    expect(p).not.toHaveProperty("sameMethodAsBefore");
    expect(payloadKomponen("FOUNDATION_TEST_AFTER", { ...d, sameMethod: true })).toMatchObject({ sameMethodAsBefore: true, unloadedHeightCm: 20, loadedHeightCm: 17.5 });
  });
  it("uji kasur utuh: kesesuaian keluhan, feel, berat aktual, metode, penurunan 0–100, konfirmasi QC di foto", () => {
    const d: Draf = { ...kosong("WHOLE_TEST_AFTER"), complaintMatch: "SESUAI", feelNote: "tengah mantap", testerWeight: "80", testMethod: "rebah telentang", wholeDrop: "3", media: [foto] };
    expect(validasiKomponen("WHOLE_TEST_AFTER", d)).toMatch(/PIC QC sedang menguji/);
    expect(validasiKomponen("WHOLE_TEST_AFTER", { ...d, qcInFrame: true })).toBeNull();
    expect(validasiKomponen("WHOLE_TEST_AFTER", { ...d, qcInFrame: true, testerWeight: "" })).toMatch(/tidak terisi otomatis/);
  });
  it("berat penguji tidak pernah diisi otomatis dari entri kosong", () => {
    expect(drafDari("WHOLE_TEST_BEFORE", null).testerWeight).toBe("");
  });
});

describe("hasil aktual (AFTER) vs racikan rencana", () => {
  const rencana = { version: 1, data: { foundation: { action: "REPLACE", system: "POCKET_SPRING", material: { kind: "UNKNOWN" } }, layers: [{ action: "REPLACE", material: { kind: "MANUAL", text: "Latex" }, thicknessCm: 3 }] } };
  it("isi dari rencana = tidak ada perbedaan; ubah ketebalan = perbedaan wajib beralasan", () => {
    const d = drafDariRencana(rencana, kosong("AFTER"));
    expect(perbedaanDariRencana(d, rencana)).toEqual([]);
    expect(validasiKomponen("AFTER", d, { rencana })).toBeNull();
    const beda = { ...d, layersAfter: [{ ...d.layersAfter[0]!, thickness: "5" }] };
    expect(validasiKomponen("AFTER", beda, { rencana })).toMatch(/Lapisan 1/);
    expect(validasiKomponen("AFTER", { ...beda, deviationNote: "latex 3 cm habis" }, { rencana })).toBeNull();
    expect(payloadKomponen("AFTER", { ...beda, deviationNote: "latex 3 cm habis" })).toMatchObject({ deviationNote: "latex 3 cm habis", layers: [{ action: "REPLACE", thicknessCm: 5, fromOrder: null }] });
  });
  it("tanpa fondasi & tanpa lapisan ditolak; lapisan diganti wajib bahan", () => {
    const d = { ...kosong("AFTER"), foundationOn: false };
    expect(validasiKomponen("AFTER", d)).toMatch(/minimal satu lapisan/);
    expect(validasiKomponen("AFTER", { ...d, layersAfter: [{ ...barisSesudahKosong(), action: "REPLACE" }] })).toMatch(/pilih bahan/);
    expect(validasiKomponen("AFTER", { ...d, layersAfter: [{ ...barisSesudahKosong(), action: "KEEP" }] })).toBeNull();
  });
});

describe("kartu → catatan yang ditunggu", () => {
  it("memetakan next dari server ke bagian & siapa pengisinya", () => {
    expect(catatanDitunggu({ action: "WAIT", wait: "QC_BEFORE_PENDING" })).toEqual({ bagian: "WHOLE_TEST_BEFORE", oleh: "QC" });
    expect(catatanDitunggu({ action: "WAIT", wait: "FINISHED_TEST_PENDING", stepNo: 8 })).toEqual({ bagian: "WHOLE_TEST_AFTER", oleh: "QC" });
    expect(catatanDitunggu({ action: "WAIT", wait: "AFTER_PENDING" })).toEqual({ bagian: "AFTER", oleh: "TABLE" });
    expect(catatanDitunggu({ action: "COMPLETE", stepNo: 3, gated: true, layersRequired: true })).toEqual({ bagian: "LAYERS_BEFORE", oleh: "TABLE" });
    expect(catatanDitunggu({ action: "EVIDENCE", stepNo: 7, gated: true, layersAfterRequired: true })).toEqual({ bagian: "AFTER", oleh: "TABLE" });
    expect(catatanDitunggu({ action: "WAIT", wait: "AWAITING_QC" })).toBeNull();
    expect(catatanDitunggu({ action: "COMPLETE", stepNo: 3, gated: true })).toBeNull();
  });
  it("bahan katalog dirapikan (label tampilan dibuang)", () => {
    expect(rapikanBahan({ kind: "CATALOG", materialId: "m1", code: "LTX", name: "Latex", unit: "lbr", supplier: null, label: "Latex (LTX)" })).toEqual({ kind: "CATALOG", materialId: "m1", code: "LTX", name: "Latex", unit: "lbr" });
  });
});

describe("tahap 8 uji tekstur akhir (Meja)", () => {
  it("hasil wajib, berat penguji wajib, video wajib; payload sama dengan web", () => {
    const video = { url: "/b.mp4", kind: "video" as const };
    expect(validasiLangkah(8, { testerWeightKg: "70" }, [video])).toMatch(/Pilih hasil uji/);
    expect(validasiLangkah(8, { verdict: "PAS" }, [video])).toMatch(/berat penguji/);
    expect(validasiLangkah(8, { verdict: "PAS", testerWeightKg: "70" }, [{ url: "/a.jpg", kind: "image" }])).toBe("Tahap ini wajib video.");
    expect(validasiLangkah(8, { verdict: "TERLALU_KERAS", testerWeightKg: "70" }, [video])).toBeNull();
    expect(payloadLangkah(8, { verdict: "TERLALU_KERAS", testerWeightKg: "70,5" })).toEqual({ verdict: "TERLALU_KERAS", testerWeightKg: 70.5, note: undefined });
  });
});
