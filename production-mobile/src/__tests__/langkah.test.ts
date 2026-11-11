import {
  aksiCepat, buatKunciNiat, formulirDidukung, giliranSaya, labelAksi, payloadLangkah, tundaSah, validasiLangkah, type MediaTerunggah,
} from "@/features/langkah";
import { mimeBerkas } from "@/api/aksi";

const foto: MediaTerunggah = { url: "/media/production-evidence/a.jpg", kind: "image" };
const video: MediaTerunggah = { url: "/media/production-evidence/b.mp4", kind: "video" };

test("aksi cepat: Mulai/Lanjutkan & continueOnly; tahap berisi bukti tidak", () => {
  expect(aksiCepat({ action: "START", stepNo: 3 })).toBe(true);
  expect(aksiCepat({ action: "RESUME", stepNo: 3 })).toBe(true);
  expect(aksiCepat({ action: "COMPLETE", stepNo: 5, continueOnly: true })).toBe(true);
  expect(aksiCepat({ action: "COMPLETE", stepNo: 4 })).toBe(false);
  expect(aksiCepat({ action: "START_WITH_EVIDENCE", stepNo: 1 })).toBe(false);
  expect(labelAksi({ action: "START_WITH_EVIDENCE", stepNo: 1 })).toBe("Mulai: Foto Sebelum Bongkar");
  expect(labelAksi({ action: "COMPLETE", stepNo: 4 })).toBe("Kirim Uji Fondasi Lama");
});

test("formulir yang didukung HP: 1-4, 9, 11, 12; bahan/wizard/BUILD ke Web", () => {
  const c = { track: "RESTORATION" as const, cornerView: null };
  for (const n of [1, 2, 3, 4, 9, 11, 12]) expect(formulirDidukung(c, { stepNo: n, action: "COMPLETE" }).ok).toBe(true);
  for (const n of [5, 6, 7, 8, 10]) expect(formulirDidukung(c, { stepNo: n, action: "COMPLETE" }).ok).toBe(false);
  expect(formulirDidukung({ track: "BUILD", cornerView: null }, { stepNo: 1 }).ok).toBe(false);
  expect(formulirDidukung(c, { stepNo: 3, gated: true, layersRequired: true }).ok).toBe(false);
  expect(formulirDidukung({ track: "RESTORATION", cornerView: { contractV2: true } }, { stepNo: 12 }).ok).toBe(false);
});

test("validasi: media minimal, video wajib untuk uji fondasi, angka uji fondasi masuk akal", () => {
  expect(validasiLangkah(4, { heightBeforeCm: "20", heightCompressedCm: "15", testerWeightKg: "75" }, [])).toMatch(/minimal 1/);
  expect(validasiLangkah(4, { heightBeforeCm: "20", heightCompressedCm: "15", testerWeightKg: "75" }, [foto])).toBe("Tahap ini wajib video.");
  expect(validasiLangkah(4, { heightBeforeCm: "20", heightCompressedCm: "25", testerWeightKg: "75" }, [video])).toMatch(/tidak boleh lebih besar/);
  expect(validasiLangkah(4, { heightBeforeCm: "20,5", heightCompressedCm: "15", testerWeightKg: "75" }, [video])).toBeNull();
  expect(validasiLangkah(1, {}, [foto])).toMatch(/Centang/);
  expect(validasiLangkah(1, { conditionConfirmed: true }, [foto])).toBeNull();
  expect(validasiLangkah(9, {}, [foto])).toBeNull();
  expect(validasiLangkah(11, { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, [foto], { cornerV2: true })).toMatch(/pekerjaan Corner/);
});

test("payload sama bentuknya dengan web (angka dinormalisasi koma, kosong dibuang)", () => {
  expect(payloadLangkah(4, { heightBeforeCm: "20,5", heightCompressedCm: "15", testerWeightKg: "75", note: " " }))
    .toEqual({ heightBeforeCm: 20.5, heightCompressedCm: 15, testerWeightKg: 75, foundationIssues: [], note: undefined });
  expect(payloadLangkah(3, { oldMaterials: ["PER", "BUSA"] })).toEqual({ oldMaterials: [{ type: "PER" }, { type: "BUSA" }], note: undefined });
  expect(payloadLangkah(11, { checklist: { jahitan: true } })).toEqual({ checklist: { jahitan: true, list: false, resleting: false, kebersihan: false }, note: undefined });
  expect(payloadLangkah(11, { checklist: {}, cornerWork: "Ganti kain", noDifference: true }, { cornerV2: true })).toMatchObject({ cornerWork: "Ganti kain", noDifference: true, differenceNote: undefined });
});

test("giliran saya: hanya lane yang dipegang dan PIC rencana (atau boleh semua PIC)", () => {
  const card = { next: { actor: "TABLE" as const, action: "START" as const, stepNo: 3 }, plan: { operator: { id: "op", userId: "u1", name: "Risdy" }, cornerOperator: { id: "oc", userId: "u2", name: "Emon" } } } as never;
  expect(giliranSaya(card, "u1", { lane: true, executeAny: false })).toBe("TABLE");
  expect(giliranSaya(card, "u2", { lane: true, executeAny: false })).toBeNull();
  expect(giliranSaya(card, "admin", { lane: true, executeAny: true })).toBe("TABLE");
  expect(giliranSaya(card, "u1", { lane: false, executeAny: false })).toBeNull();
  expect(giliranSaya({ next: { actor: "QC", action: "WAIT", wait: "AWAITING_QC" }, plan: null } as never, "u1", { lane: true, executeAny: true })).toBeNull();
});

test("kunci niat: sama untuk coba lagi, baru setelah dilepas atau revisi berubah", () => {
  let n = 0;
  const k = buatKunciNiat(() => String(++n));
  const a = k.untuk("r", 4, 7);
  expect(k.untuk("r", 4, 7)).toBe(a);
  expect(k.untuk("r", 4, 8)).not.toBe(a);
  k.lepas("r", 4, 7);
  expect(k.untuk("r", 4, 7)).not.toBe(a);
});

test("tunda: Lainnya wajib keterangan; MIME berkas dikenali", () => {
  expect(tundaSah("ARAHAN", "")).toBe(true);
  expect(tundaSah("LAINNYA", "ok")).toBe(false);
  expect(tundaSah("LAINNYA", "lem belum kering")).toBe(true);
  expect(tundaSah("BAHAN", "x")).toBe(false);
  expect(mimeBerkas({ uri: "file:///a/VID_1.MOV" })).toBe("video/quicktime");
  expect(mimeBerkas({ uri: "file:///a/b", type: "video" })).toBe("video/mp4");
  expect(mimeBerkas({ uri: "file:///a/b.heic", mimeType: "image/heic" })).toBe("image/jpeg");
});
