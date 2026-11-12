import {
  aksiCepat, bahanUrutBom, bodyKurangBahan, bolehLaporKurang, buatKunciNiat, formulirDidukung, giliranSaya, labelAksi, langkahBahanOlehPic, payloadLangkah,
  tundaSah, validasiLangkah, type MediaTerunggah,
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

test("formulir yang didukung HP: 1-4, 6, 7, 9-12; Diagnosa, uji tekstur, BUILD & gerbang Catatan Komponen ke Web", () => {
  const c = { track: "RESTORATION" as const, cornerView: null };
  for (const n of [1, 2, 3, 4, 6, 7, 9, 10, 11, 12]) expect(formulirDidukung(c, { stepNo: n, action: "COMPLETE" }).ok).toBe(true);
  for (const n of [5, 8]) expect(formulirDidukung(c, { stepNo: n, action: "COMPLETE" }).ok).toBe(false);
  expect(formulirDidukung({ track: "BUILD", cornerView: null }, { stepNo: 1 }).ok).toBe(false);
  expect(formulirDidukung(c, { stepNo: 3, gated: true, layersRequired: true }).ok).toBe(false);
  expect(formulirDidukung(c, { stepNo: 7, gated: true, layersAfterRequired: true }).ok).toBe(false);
  expect(formulirDidukung({ track: "RESTORATION", cornerView: { contractV2: true } }, { stepNo: 12 }).ok).toBe(true);
});

test("tahap 6/7: bahan dari Gudang wajib (qty > 0) kecuali dicatat PIC Bahan; payload sama dengan web", () => {
  const f = { materials: [{ materialId: "m1", qty: "2,5" }, { materialId: "m2", qty: "" }], note: "pocket spring baru" };
  expect(validasiLangkah(6, { note: "isi" }, [video])).toMatch(/bahan Gudang/);
  expect(validasiLangkah(6, { ...f, note: "ok" }, [video])).toMatch(/fondasi baru/);
  expect(validasiLangkah(6, f, [foto])).toBe("Tahap ini wajib video.");
  expect(validasiLangkah(6, f, [video])).toBeNull();
  expect(payloadLangkah(6, f)).toEqual({ materials: [{ materialId: "m1", qty: 2.5 }], note: "pocket spring baru" });
  expect(validasiLangkah(7, {}, [foto], { byPic: true })).toBeNull();
  expect(payloadLangkah(7, f, { byPic: true })).toEqual({ materials: [], note: "pocket spring baru" });
  const pic = { track: "RESTORATION" as const, materialPic: { materialOperator: { name: "Nadya" } } };
  expect(langkahBahanOlehPic(pic, 6)).toBe(true);
  expect(langkahBahanOlehPic(pic, 7)).toBe(true);
  expect(langkahBahanOlehPic({ track: "RESTORATION", materialPic: null }, 6)).toBe(false);
});

test("tahap 10 Corner V2: cek permintaan Sales, ganti kain diminta tapi kain lama → wajib 'Ada perbedaan', konfirmasi Sales bila motif/warna belum tertulis", () => {
  const dasar = { mattressStyle: "BIASA", fabricSpec: "Knitting putih", borderColor: "Abu" };
  expect(validasiLangkah(10, dasar, [])).toBeNull(); // non-V2
  const brief = { fabricChangeRequested: true, needsSalesConfirmation: true, missing: ["motif", "warna"] };
  const v2 = { cornerV2: true, cornerBrief: brief };
  expect(validasiLangkah(10, dasar, [], v2)).toMatch(/permintaan Sales sudah Anda periksa/);
  expect(validasiLangkah(10, { ...dasar, requestChecked: true, fabricMode: "OLD_REUSED", requestMatch: "SESUAI" }, [], v2)).toMatch(/Ada perbedaan/);
  expect(validasiLangkah(10, { ...dasar, requestChecked: true, fabricMode: "NEW_INSTALLED", requestMatch: "SESUAI" }, [], v2)).toMatch(/motif dan warna/);
  const ok = { ...dasar, requestChecked: true, fabricMode: "NEW_INSTALLED", requestMatch: "SESUAI", salesConfirmation: "polos abu" };
  expect(validasiLangkah(10, ok, [], v2)).toBeNull();
  expect(payloadLangkah(10, ok, { cornerV2: true })).toEqual({
    mattressStyle: "BIASA", fabricSpec: "Knitting putih", borderColor: "Abu", materials: [], note: undefined,
    requestChecked: true, fabricMode: "NEW_INSTALLED", requestMatch: "SESUAI", requestNote: undefined, salesConfirmation: "polos abu",
  });
});

test("lapor kurang bahan: hanya Meja, tahap 3–8, belum ada laporan terbuka; BOM dulu; qty opsional", () => {
  const kartu = (next: object, shortage: unknown = null) => ({ next, shortage } as never);
  expect(bolehLaporKurang(kartu({ stepNo: 6, action: "COMPLETE" }), "TABLE")).toBe(true);
  expect(bolehLaporKurang(kartu({ stepNo: 6, action: "WAIT", wait: "MATERIAL_NOT_READY" }), "TABLE")).toBe(true);
  expect(bolehLaporKurang(kartu({ stepNo: 6, action: "WAIT", wait: "AWAITING_QC" }), "TABLE")).toBe(false);
  expect(bolehLaporKurang(kartu({ stepNo: 10, action: "COMPLETE" }), "TABLE")).toBe(false);
  expect(bolehLaporKurang(kartu({ stepNo: 6, action: "COMPLETE" }), "CORNER")).toBe(false);
  expect(bolehLaporKurang(kartu({ stepNo: 6, action: "COMPLETE" }, { items: [] }), "TABLE")).toBe(false);
  expect(bahanUrutBom([{ materialId: "b", code: "B", name: "Busa" }], [{ id: "a", code: "A", name: "Latex" }, { id: "b", code: "B", name: "Busa" }]).map((m) => m.id)).toEqual(["b", "a"]);
  expect(bodyKurangBahan({ revision: 4, workCenterId: "wc" }, {}, "")).toBeNull();
  expect(bodyKurangBahan({ revision: 4, workCenterId: "wc" }, { a: { qty: "3" }, b: { qty: "" } }, " cepat ")).toEqual({
    expectedRevision: 4, workCenterId: "wc", items: [{ materialId: "a", qty: 3 }, { materialId: "b" }], note: "cepat",
  });
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
