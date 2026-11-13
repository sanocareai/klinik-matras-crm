import {
  bagianLengkap, benihServer, bodyDiagnosa, bomTanpaJumlah, lapisanKosong, temuanKosong, validasiDiagnosa, type DraftDiagnosa,
} from "@/features/diagnosa";

const lengkap = (): DraftDiagnosa => {
  const t = temuanKosong();
  t.general = { condition: "Kasur amblas di tengah", mainDamage: "Per tengah patah", damageLevel: "BERAT", teardownNote: "" };
  t.foundation = { oldCondition: "", action: "REPLACE", size: "180x200", qty: "1", note: "" };
  t.serviceNote = "Fondasi diganti karena per patah, lapisan atas diperkuat";
  return { temuan: t, bom: [], manual: [], fotoServer: [] };
};

describe("validasi (sama dengan yang ditolak server saat submit)", () => {
  it("kosong → mulai dari Hasil Bongkar", () => {
    expect(validasiDiagnosa({ temuan: temuanKosong(), bom: [], manual: [], fotoServer: [] }, 0)).toEqual({ bagian: "bongkar", pesan: "Isi kondisi kasur (minimal 3 huruf)." });
  });
  it("foto wajib minimal 1 (baru ATAU dari diagnosis sebelumnya)", () => {
    expect(validasiDiagnosa(lengkap(), 0)?.pesan).toMatch(/minimal 1 foto/);
    expect(validasiDiagnosa({ ...lengkap(), fotoServer: [{ url: "/a.jpg", previewUrl: "/a.jpg?s" }] }, 0)).toBeNull();
    expect(validasiDiagnosa(lengkap(), 1)).toBeNull();
  });
  it("tindakan fondasi, jumlah angka, kesimpulan ≥10 huruf", () => {
    const d = lengkap();
    expect(validasiDiagnosa({ ...d, temuan: { ...d.temuan, foundation: { ...d.temuan.foundation, action: "" } } }, 1)?.bagian).toBe("fondasi");
    expect(validasiDiagnosa({ ...d, temuan: { ...d.temuan, foundation: { ...d.temuan.foundation, qty: "abc" } } }, 1)?.bagian).toBe("fondasi");
    expect(validasiDiagnosa({ ...d, temuan: { ...d.temuan, layers: [{ ...lapisanKosong(), qty: "-1" }] } }, 1)?.bagian).toBe("lapisan");
    expect(validasiDiagnosa({ ...d, temuan: { ...d.temuan, serviceNote: "pendek" } }, 1)).toEqual({ bagian: "review", pesan: "Tulis kesimpulan diagnosis (minimal 10 huruf)." });
  });
  it("bahan manual: nama, jumlah > 0, alasan ≥3 huruf", () => {
    const d = { ...lengkap(), manual: [{ description: "Kain jacquard", estimatedUnit: "m", qty: "0", reason: "baru" }] };
    expect(validasiDiagnosa(d, 1)?.pesan).toMatch(/jumlah wajib/);
    expect(validasiDiagnosa({ ...d, manual: [{ ...d.manual[0]!, qty: "2", reason: "x" }] }, 1)?.pesan).toMatch(/alasan/);
    expect(validasiDiagnosa({ ...d, manual: [{ ...d.manual[0]!, qty: "2" }] }, 1)).toBeNull();
  });
});

describe("body submit (bentuk sama dengan wizard web)", () => {
  it("foto lama + baru, BOM hanya yang berjumlah, teks kosong → null, angka koma → titik", () => {
    const d: DraftDiagnosa = {
      ...lengkap(),
      fotoServer: [{ url: "/media/production-evidence/lama.jpg", previewUrl: "x" }],
      bom: [{ materialId: "m1", code: "LTX", name: "Latex", unit: "lembar", qty: "1,5" }, { materialId: "m2", code: "BSA", name: "Busa", unit: "lembar", qty: "" }],
      manual: [{ description: " Kain jacquard ", estimatedUnit: "", qty: "2", reason: "belum ada di katalog" }],
    };
    d.temuan.layers = [{ ...lapisanKosong(), action: "REPLACE", material: "Latex", qty: "1" }];
    const b = bodyDiagnosa(d, { revision: 3, workCenterId: "wc1" }, ["/media/production-evidence/baru.mp4"]);
    expect(b.expectedRevision).toBe(3);
    expect(b.photoUrls).toEqual(["/media/production-evidence/lama.jpg", "/media/production-evidence/baru.mp4"]);
    expect(b.materials).toEqual([{ materialId: "m1", qty: 1.5 }]);
    expect(b.manualMaterials).toEqual([{ description: "Kain jacquard", estimatedUnit: null, qty: 2, reason: "belum ada di katalog" }]);
    expect(b.findings.foundation).toEqual({ oldCondition: null, action: "REPLACE", size: "180x200", qty: 1, note: null });
    expect(b.findings.layers[0]).toEqual({ oldCondition: null, action: "REPLACE", material: "Latex", thickness: null, density: null, qty: 1, note: null });
    expect(bomTanpaJumlah(d)).toEqual(["Busa"]);
  });
});

describe("benih dari server (revisi)", () => {
  it("membawa temuan, BOM aktif, foto, dan HANYA bahan manual yang belum dipetakan", () => {
    const d = benihServer({
      revision: 2, status: "RECORDED",
      findings: { general: { condition: "Cukup baik", mainDamage: "Amblas", damageLevel: "SEDANG", teardownNote: "" }, foundation: { action: "KEEP" } as never, serviceNote: "Kesimpulan lama panjang" },
      prefill: { bomLines: [{ materialId: "m1", code: "LTX", name: "Latex", unit: null, qty: 2 }], photos: [{ url: "/a.jpg", previewUrl: "/a.jpg?sig" }] },
      manualMaterials: [
        { description: "Kain A", estimatedUnit: "m", qty: 1, reason: "baru", status: "NEEDS_MAPPING" },
        { description: "Kain B", estimatedUnit: "m", qty: 1, reason: "baru", status: "MAPPED" },
      ],
    });
    expect(d.temuan.general.damageLevel).toBe("SEDANG");
    expect(d.temuan.foundation.action).toBe("KEEP");
    expect(d.bom).toEqual([{ materialId: "m1", code: "LTX", name: "Latex", unit: null, qty: "2" }]);
    expect(d.manual.map((m) => m.description)).toEqual(["Kain A"]);
    expect(bagianLengkap("bongkar", d, 0)).toBe(true);
    expect(benihServer(null).temuan).toEqual(temuanKosong());
  });
});
