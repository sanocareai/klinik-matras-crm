import {
  alasanBomTerkunci, alurCatat, barisDari, bodyCatatBahan, bodyCorner, denganBarisKosong, formCatatAwal, payloadBaris, rujukanRacikan, samaDenganTersimpan,
  sayaPicBahan, statusRework, teksCorner, validasiBaris, validasiCatatBahan, validasiCorner, validasiRework, type FormCatatBahan,
} from "@/features/picBahan";
import { bentukHasil, drafDari, payloadKomponen, validasiKomponen } from "@/features/komponen";
import type { BahanDiserahkan } from "@/api/types";

const diserahkan: BahanDiserahkan[] = [{ materialId: "m1", code: "LTX", name: "Latex", uom: "LBR", qty: 2 }];

describe("baris bahan (+ Tambah baris)", () => {
  it("selalu tepat satu baris kosong di akhir; baris kosong tidak dikirim", () => {
    const r = barisDari([{ materialId: "m1", qty: 2 }]);
    expect(r).toHaveLength(2);
    expect(r[1]).toMatchObject({ materialId: "", qty: "" });
    expect(denganBarisKosong(r)).toHaveLength(2);
    expect(payloadBaris(r)).toEqual([{ materialId: "m1", qty: 2 }]);
  });
  it("menolak bahan ganda, jumlah ≤ 0, dan melebihi yang diserahkan Gudang", () => {
    expect(validasiBaris(barisDari([{ materialId: "m1", qty: 1 }, { materialId: "m1", qty: 1 }]))).toMatch(/sudah ada di baris 1/);
    expect(validasiBaris(barisDari([{ materialId: "m1", qty: "0" }]))).toMatch(/lebih dari nol/);
    expect(validasiBaris(barisDari([]))).toMatch(/minimal satu bahan/);
    expect(validasiBaris(barisDari([]), { wajibSatu: false })).toBeNull();
    const tersedia = (id: string) => (id === "m1" ? 2 : null);
    expect(validasiBaris(barisDari([{ materialId: "m1", qty: "2,5" }]), { tersedia })).toMatch(/maksimal 2/);
    expect(validasiBaris(barisDari([{ materialId: "x", qty: 1 }]), { tersedia, namaOf: () => "Busa" })).toMatch(/Busa bukan bahan yang diserahkan/);
  });
  it("sama dengan tersimpan (urutan tidak berpengaruh)", () => {
    expect(samaDenganTersimpan(barisDari([{ materialId: "b", qty: 1 }, { materialId: "a", qty: 2 }]), [{ materialId: "a", qty: 2 }, { materialId: "b", qty: "1" }])).toBe(true);
    expect(samaDenganTersimpan(barisDari([{ materialId: "a", qty: 3 }]), [{ materialId: "a", qty: 2 }])).toBe(false);
  });
});

describe("catat racikan & bahan (PIC Bahan)", () => {
  const form = (p: Partial<FormCatatBahan> = {}): FormCatatBahan => ({ racikanFondasi: "", racikanLapisan: "", note: "", rows: barisDari([]), ...p });
  it("LAYANAN: hanya pemakaian aktual; racikan tidak dikirim", () => {
    expect(validasiCatatBahan(form(), "RESTORATION", diserahkan)).toBe("Isi pemakaian bahan.");
    const f = form({ rows: barisDari([{ materialId: "m1", qty: 1 }]), racikanFondasi: "abaikan" });
    expect(validasiCatatBahan(f, "RESTORATION", diserahkan)).toBeNull();
    expect(bodyCatatBahan(f, "RESTORATION", 7)).toEqual({ expectedRevision: 7, materials: [{ materialId: "m1", qty: 1 }] });
  });
  it("BUILD kasur: racikan dan/atau bahan; racikan minimal 3 karakter", () => {
    expect(validasiCatatBahan(form(), "KASUR", diserahkan)).toBe("Isi racikan dan/atau pemakaian bahan.");
    expect(validasiCatatBahan(form({ racikanFondasi: "ab" }), "KASUR", diserahkan)).toMatch(/minimal 3/);
    const f = form({ racikanLapisan: "latex 3 cm", note: " ok " });
    expect(validasiCatatBahan(f, "KASUR", diserahkan)).toBeNull();
    expect(bodyCatatBahan(f, "KASUR", 4)).toEqual({ expectedRevision: 4, materials: [], racikan: { fondasi: undefined, lapisan: "latex 3 cm" }, note: "ok" });
  });
  it("BUILD jenis produk belum jelas: racikan ditahan; non-kasur tanpa racikan", () => {
    expect(validasiCatatBahan(form({ racikanFondasi: "pocket" }), "UNCONFIRMED", diserahkan)).toMatch(/racikan kasur ditahan/);
    expect(validasiCatatBahan(form(), "NON_KASUR", diserahkan)).toBe("Isi pemakaian bahan.");
    expect(validasiCatatBahan(form({ rows: barisDari([{ materialId: "m1", qty: 3 }]) }), "NON_KASUR", diserahkan)).toMatch(/maksimal 2/);
  });
  it("isian awal dari catatan terakhir; alur dari jalur kartu", () => {
    const card = { track: "BUILD" as const, product: { flow: "KASUR" as const }, materialPic: null, build: { record: { version: 2, racikan: { fondasi: "pocket" }, note: "n", materials: [{ materialId: "m1", qty: 1 }] } } };
    expect(formCatatAwal(card)).toMatchObject({ racikanFondasi: "pocket", racikanLapisan: "", note: "n" });
    expect(alurCatat(card)).toBe("KASUR");
    expect(alurCatat({ track: "BUILD", product: null })).toBe("UNCONFIRMED");
    expect(alurCatat({ track: "RESTORATION", product: null })).toBe("RESTORATION");
  });
  it("saya PIC Bahan: userId cocok, atau pelaksana lintas-lini", () => {
    const card = { track: "BUILD" as const, materialPic: null, build: { materialOperator: { userId: "u1", name: "Nadya" } } };
    expect(sayaPicBahan(card, "u1", false)).toBe(true);
    expect(sayaPicBahan(card, "u2", false)).toBe(false);
    expect(sayaPicBahan(card, "u2", true)).toBe(true);
    expect(sayaPicBahan({ track: "RESTORATION", materialPic: null, build: null }, "u1", true)).toBe(false);
  });
});

describe("rencana bahan, rework, Corner", () => {
  it("racikan rencana → bahan katalog (acuan BOM) + butir tanpa katalog", () => {
    const r = rujukanRacikan({ version: 1, data: { foundation: { action: "REPLACE", material: { kind: "CATALOG", materialId: "m1", name: "Pocket" } }, layers: [{ action: "REPLACE", material: { kind: "CATALOG", materialId: "m1" } }, { action: "KEEP", material: { kind: "MANUAL", text: "Kapuk" } }] } });
    expect(r.catalog).toEqual([expect.objectContaining({ materialId: "m1", uses: [{ where: "Fondasi", action: "REPLACE" }, { where: "Lapisan 1", action: "REPLACE" }] })]);
    expect(r.unlinked).toEqual([{ where: "Lapisan 2", label: "Bahan manual: Kapuk" }]);
    expect(rujukanRacikan(null)).toEqual({ catalog: [], unlinked: [] });
  });
  it("BOM terkunci setelah Gudang menyerahkan bahan", () => {
    expect(alasanBomTerkunci({ issuedMaterials: diserahkan })).toMatch(/terkunci/);
    expect(alasanBomTerkunci({ issuedMaterials: [] })).toBeNull();
  });
  it("rework: status dari kartu; baris wajib jumlah & tanpa ganda", () => {
    expect(statusRework({ assembly: { applicable: true, rework: { open: true, issue: null } } })).toEqual({ kind: "OPEN" });
    expect(statusRework({ assembly: { applicable: true, rework: { open: false, issue: { issueId: "i", issueNumber: "MI-1", status: "READY_TO_PICK" } } } }).kind).toBe("REQUESTED");
    expect(statusRework({ assembly: null })).toEqual({ kind: "NONE" });
    const l = { materialId: "m1", code: "LTX", name: "Latex", unit: null, qty: "" };
    expect(validasiRework([])).toMatch(/minimal satu/);
    expect(validasiRework([l])).toMatch(/Isi jumlah Latex/);
    expect(validasiRework([{ ...l, qty: "1" }, { ...l, qty: "1" }])).toMatch(/dua kali/);
  });
  it("Corner: tidak diperlukan wajib beralasan; body sama dengan web", () => {
    expect(validasiCorner("", "")).toMatch(/Pilih/);
    expect(validasiCorner("NO", "x")).toMatch(/beralasan/);
    expect(bodyCorner(3, "NO", " tanpa kain ")).toEqual({ expectedRevision: 3, required: false, reason: "tanpa kain" });
    expect(bodyCorner(3, "YES", "abaikan")).toEqual({ expectedRevision: 3, required: true });
    expect(teksCorner({ required: false, reason: "tanpa jahit", confirmed: true })).toBe("Tidak diperlukan — tanpa jahit");
    expect(teksCorner(null)).toBe("Belum dikonfirmasi Lead");
  });
});

describe("racikan rencana (PLAN_RACIKAN) di Catatan Komponen", () => {
  it("bentuk sama dengan hasil aktual, tanpa alasan perbedaan", () => {
    expect(bentukHasil("PLAN_RACIKAN")).toBe(true);
    const d = drafDari("PLAN_RACIKAN", null);
    expect(d.foundationOn).toBe(true);
    expect(validasiKomponen("PLAN_RACIKAN", { ...d, foundationOn: false })).toMatch(/racikan rencana/);
    const isi = { ...d, foundation: { action: "REPLACE", system: "POCKET_SPRING", material: null, note: "" }, deviationNote: "jangan terkirim" };
    expect(validasiKomponen("PLAN_RACIKAN", isi)).toBeNull();
    expect(payloadKomponen("PLAN_RACIKAN", isi)).toEqual({ foundation: { action: "REPLACE", system: "POCKET_SPRING", material: null, note: null }, layers: [], note: null });
    const lama = drafDari("PLAN_RACIKAN", { version: 2, data: { foundation: null, layers: [{ action: "KEEP", thicknessCm: 3 }] } });
    expect(lama.foundationOn).toBe(false);
    expect(lama.layersAfter).toHaveLength(1);
  });
});
