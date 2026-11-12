// MODEL MURNI DIAGNOSA (tahap 5) — cermin frontend/src/features/production/DiagnosisWizard.jsx dan validasi SERVER
// (backend/src/services/productionDiagnosisCommandService.js#validateFindings final=true, normalizeManualMaterials, normalizePhotoUrls).
// Alur sama dengan web: kirim diagnosis (POST /production-v2/diagnosis/:runId/submit — menulis Planned BOM) LALU tutup tahap 5
// lewat POST /runs/:runId/steps/5. Bila penutupan gagal, diagnosis TETAP tersimpan; layar menawarkan menutup tahap saja.

export const TINGKAT_KERUSAKAN = [{ value: "RINGAN", label: "Ringan" }, { value: "SEDANG", label: "Sedang" }, { value: "BERAT", label: "Berat" }] as const;
export const TINDAKAN_FONDASI = [{ value: "KEEP", label: "Dipertahankan" }, { value: "REINFORCE", label: "Diperkuat" }, { value: "REPLACE", label: "Diganti" }] as const;
export const TINDAKAN_LAPISAN = [{ value: "KEEP", label: "Dipertahankan" }, { value: "REMOVE", label: "Dilepas" }, { value: "REPLACE", label: "Diganti" }] as const;
export const KOMPONEN = [
  { key: "spring", label: "Per/spring" }, { key: "cover", label: "Kain/cover" }, { key: "quilting", label: "Quilting" }, { key: "glue", label: "Lem" }, { key: "wood", label: "Kayu" },
] as const;
export const BAGIAN = [
  { key: "sales", label: "Info Sales" }, { key: "bongkar", label: "Hasil Bongkar" }, { key: "fondasi", label: "Fondasi" },
  { key: "lapisan", label: "Lapisan" }, { key: "bahan", label: "Bahan" }, { key: "review", label: "Kirim" },
] as const;
export type KunciBagian = (typeof BAGIAN)[number]["key"];

export const MAKS_LAPISAN = 10;
export const MAKS_BAHAN_MANUAL = 20;
export const KESIMPULAN_MIN = 10;
/** Penutup tahap 5 — payload yang SAMA dengan DiagnosisStepSheet web. */
export const PAYLOAD_TUTUP_TAHAP5 = { diagnosis: "Diagnosis dikirim", inputMethod: "TEXT" } as const;

export type Lapisan = { oldCondition: string; action: string; material: string; thickness: string; density: string; qty: string; note: string };
export type Temuan = {
  general: { condition: string; mainDamage: string; damageLevel: string; teardownNote: string };
  foundation: { oldCondition: string; action: string; size: string; qty: string; note: string };
  layers: Lapisan[];
  components: { spring: string; cover: string; quilting: string; glue: string; wood: string; other: string[] };
  serviceNote: string;
};
export type BarisBom = { materialId: string; code: string; name: string; unit: string | null; onHandQty?: number; qty: string };
export type BahanManual = { description: string; estimatedUnit: string; qty: string; reason: string };
/** Foto/video diagnosis yang sudah ada di server (revisi): url mentah untuk dikirim ulang + pratinjau bertanda tangan. */
export type FotoServer = { url: string; previewUrl: string };

export type DraftDiagnosa = { temuan: Temuan; bom: BarisBom[]; manual: BahanManual[]; fotoServer: FotoServer[] };

/** GET /production-v2/diagnosis/:runId → current */
export type DiagnosaServer = {
  revision: number;
  status: "DRAFT" | "RECORDED" | string;
  findings?: Partial<Temuan> | null;
  prefill?: { bomLines?: { materialId: string; code: string; name: string; unit: string | null; qty: number }[]; photos?: FotoServer[] };
  manualMaterials?: { description: string; estimatedUnit: string | null; qty: number; reason: string | null; status: string }[];
};

export const lapisanKosong = (): Lapisan => ({ oldCondition: "", action: "", material: "", thickness: "", density: "", qty: "", note: "" });
export function temuanKosong(): Temuan {
  return {
    general: { condition: "", mainDamage: "", damageLevel: "", teardownNote: "" },
    foundation: { oldCondition: "", action: "", size: "", qty: "", note: "" },
    layers: [],
    components: { spring: "", cover: "", quilting: "", glue: "", wood: "", other: [] },
    serviceNote: "",
  };
}

const s = (v: unknown) => (v == null ? "" : String(v));

/** Benih formulir dari diagnosis server (cermin serverSeed web): bahan manual yang SUDAH dipetakan tidak dibawa (sudah jadi baris BOM). */
export function benihServer(cur: DiagnosaServer | null | undefined): DraftDiagnosa {
  const k = temuanKosong();
  if (!cur) return { temuan: k, bom: [], manual: [], fotoServer: [] };
  const f = cur.findings ?? {};
  const g = (f.general ?? {}) as Partial<Temuan["general"]>;
  const fo = (f.foundation ?? {}) as Partial<Temuan["foundation"]>;
  const co = (f.components ?? {}) as Partial<Temuan["components"]>;
  return {
    temuan: {
      general: { condition: s(g.condition), mainDamage: s(g.mainDamage), damageLevel: s(g.damageLevel), teardownNote: s(g.teardownNote) },
      foundation: { oldCondition: s(fo.oldCondition), action: s(fo.action), size: s(fo.size), qty: s(fo.qty), note: s(fo.note) },
      layers: (f.layers ?? []).map((l) => ({ oldCondition: s(l.oldCondition), action: s(l.action), material: s(l.material), thickness: s(l.thickness), density: s(l.density), qty: s(l.qty), note: s(l.note) })),
      components: { spring: s(co.spring), cover: s(co.cover), quilting: s(co.quilting), glue: s(co.glue), wood: s(co.wood), other: Array.isArray(co.other) ? co.other.map(s) : [] },
      serviceNote: s(f.serviceNote),
    },
    bom: (cur.prefill?.bomLines ?? []).map((l) => ({ materialId: l.materialId, code: l.code, name: l.name, unit: l.unit, qty: String(l.qty) })),
    manual: (cur.manualMaterials ?? []).filter((m) => m.status === "NEEDS_MAPPING").map((m) => ({ description: m.description, estimatedUnit: m.estimatedUnit ?? "", qty: String(m.qty), reason: m.reason ?? "" })),
    fotoServer: cur.prefill?.photos ?? [],
  };
}

const angka = (v: string) => Number(String(v ?? "").replace(",", "."));
const panjang = (v: string) => (v ?? "").trim().length;
const angkaSah = (v: string) => !v.trim() || (angka(v) > 0 && angka(v) <= 1000);

export type GalatDiagnosa = { bagian: KunciBagian; pesan: string };

/** Validasi sebelum kirim — SAMA dengan yang ditolak server saat submit (final). Mengembalikan bagian pertama yang belum lengkap. */
export function validasiDiagnosa(d: DraftDiagnosa, jumlahFotoBaru: number): GalatDiagnosa | null {
  const t = d.temuan;
  if (panjang(t.general.condition) < 3) return { bagian: "bongkar", pesan: "Isi kondisi kasur (minimal 3 huruf)." };
  if (panjang(t.general.mainDamage) < 3) return { bagian: "bongkar", pesan: "Isi kerusakan utama (minimal 3 huruf)." };
  if (!t.general.damageLevel) return { bagian: "bongkar", pesan: "Pilih tingkat kerusakan." };
  if (jumlahFotoBaru + d.fotoServer.length < 1) return { bagian: "bongkar", pesan: "Lampirkan minimal 1 foto/video hasil bongkar." };
  if (!t.foundation.action) return { bagian: "fondasi", pesan: "Pilih tindakan fondasi." };
  if (!angkaSah(t.foundation.qty)) return { bagian: "fondasi", pesan: "Jumlah fondasi harus angka lebih dari 0." };
  if (t.layers.length > MAKS_LAPISAN) return { bagian: "lapisan", pesan: `Maksimal ${MAKS_LAPISAN} baris lapisan.` };
  const lap = t.layers.findIndex((l) => !angkaSah(l.qty));
  if (lap >= 0) return { bagian: "lapisan", pesan: `Jumlah lapisan #${lap + 1} harus angka lebih dari 0.` };
  if (d.manual.length > MAKS_BAHAN_MANUAL) return { bagian: "bahan", pesan: `Maksimal ${MAKS_BAHAN_MANUAL} bahan manual.` };
  for (const [i, m] of d.manual.entries()) {
    if (panjang(m.description) < 2) return { bagian: "bahan", pesan: `Bahan manual #${i + 1}: isi nama/deskripsi.` };
    if (!(angka(m.qty) > 0)) return { bagian: "bahan", pesan: `Bahan manual #${i + 1}: jumlah wajib lebih dari 0.` };
    if (panjang(m.reason) < 3) return { bagian: "bahan", pesan: `Bahan manual #${i + 1}: tulis alasan tidak ada di katalog.` };
  }
  if (panjang(t.serviceNote) < KESIMPULAN_MIN) return { bagian: "review", pesan: `Tulis kesimpulan diagnosis (minimal ${KESIMPULAN_MIN} huruf).` };
  return null;
}

/** Bagian ini sudah terisi wajibnya? (penanda ✓ di tab bagian) */
export function bagianLengkap(bagian: KunciBagian, d: DraftDiagnosa, jumlahFotoBaru: number): boolean {
  const t = d.temuan;
  switch (bagian) {
    case "sales": return true;
    case "bongkar": return panjang(t.general.condition) >= 3 && panjang(t.general.mainDamage) >= 3 && !!t.general.damageLevel && jumlahFotoBaru + d.fotoServer.length > 0;
    case "fondasi": return !!t.foundation.action;
    case "lapisan": return true;
    case "bahan": return d.bom.length > 0 || d.manual.length > 0;
    case "review": return panjang(t.serviceNote) >= KESIMPULAN_MIN;
    default: return false;
  }
}

const isi = (v: string) => (v.trim() ? v.trim() : null);
const qtyAtauNull = (v: string) => (v.trim() ? angka(v) : null);

/** Body POST /production-v2/diagnosis/:runId/submit (bentuk SAMA dengan DiagnosisWizard.submit()). */
export function bodyDiagnosa(d: DraftDiagnosa, ctx: { revision: number; workCenterId: string | null }, urlFotoBaru: string[]) {
  const t = d.temuan;
  return {
    expectedRevision: ctx.revision,
    workCenterId: ctx.workCenterId,
    findings: {
      general: { condition: t.general.condition.trim(), mainDamage: t.general.mainDamage.trim(), damageLevel: t.general.damageLevel, teardownNote: isi(t.general.teardownNote) },
      foundation: { oldCondition: isi(t.foundation.oldCondition), action: t.foundation.action, size: isi(t.foundation.size), qty: qtyAtauNull(t.foundation.qty), note: isi(t.foundation.note) },
      layers: t.layers.map((l) => ({
        oldCondition: isi(l.oldCondition), action: l.action || null, material: isi(l.material), thickness: isi(l.thickness), density: isi(l.density), qty: qtyAtauNull(l.qty), note: isi(l.note),
      })),
      components: { spring: isi(t.components.spring), cover: isi(t.components.cover), quilting: isi(t.components.quilting), glue: isi(t.components.glue), wood: isi(t.components.wood), other: t.components.other.filter((o) => o.trim()) },
      serviceNote: t.serviceNote.trim(),
    },
    photoUrls: [...d.fotoServer.map((f) => f.url), ...urlFotoBaru],
    materials: d.bom.filter((l) => angka(l.qty) > 0).map((l) => ({ materialId: l.materialId, qty: angka(l.qty) })),
    manualMaterials: d.manual.filter((m) => m.description.trim()).map((m) => ({ description: m.description.trim(), estimatedUnit: isi(m.estimatedUnit), qty: angka(m.qty), reason: m.reason.trim() })),
  };
}

/** Bahan katalog yang dipilih tanpa jumlah tidak ikut ke Planned BOM — beri tahu sebelum kirim. */
export const bomTanpaJumlah = (d: DraftDiagnosa) => d.bom.filter((l) => !(angka(l.qty) > 0)).map((l) => l.name);
