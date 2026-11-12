// MODEL MURNI CATATAN KOMPONEN — cermin frontend/src/features/production/componentNotes/componentNotesModel.js (yang dijaga tes paritas
// dengan backend/src/lib/domain/productionComponents.js). Server tetap otoritas validasi (recordComponentSection).
// Endpoint: GET /production-v2/component-notes/units/:unitId · POST …/units/:unitId/sections/:section { expectedVersion, data, media, reason? }
// Catatan ini INFORMASI: tidak memotong stok, bukan BOM/pemakaian.
// Dari HP: lapisan & fondasi sebelum bongkar, hasil aktual (Meja), dan 4 pengujian PIC QC. Racikan rencana tetap lewat SANSS Web.

export type KunciBagian =
  | "LAYERS_BEFORE" | "FOUNDATION_BEFORE" | "AFTER" | "WHOLE_TEST_BEFORE" | "FOUNDATION_TEST_BEFORE" | "FOUNDATION_TEST_AFTER" | "WHOLE_TEST_AFTER" | "PLAN_RACIKAN";

export const BAGIAN_KOMPONEN: Record<KunciBagian, { label: string; qc: boolean }> = {
  LAYERS_BEFORE: { label: "Lapisan sebelum dibongkar", qc: false },
  FOUNDATION_BEFORE: { label: "Fondasi sebelum dibongkar", qc: false },
  AFTER: { label: "Hasil aktual sesudah pengerjaan", qc: false },
  WHOLE_TEST_BEFORE: { label: "QC sebelum bongkar (uji kasur utuh)", qc: true },
  FOUNDATION_TEST_BEFORE: { label: "Uji fondasi awal", qc: true },
  FOUNDATION_TEST_AFTER: { label: "Uji fondasi baru", qc: true },
  WHOLE_TEST_AFTER: { label: "Uji kasur jadi", qc: true },
  PLAN_RACIKAN: { label: "Racikan rencana", qc: false },
};
/** Bagian yang bisa diisi dari HP (racikan rencana tetap di SANSS Web). */
export const BAGIAN_HP: KunciBagian[] = ["LAYERS_BEFORE", "FOUNDATION_BEFORE", "AFTER", "WHOLE_TEST_BEFORE", "FOUNDATION_TEST_BEFORE", "FOUNDATION_TEST_AFTER", "WHOLE_TEST_AFTER"];

export const KONDISI = [
  { value: "BAIK", label: "Baik" }, { value: "CUKUP", label: "Cukup / layak" }, { value: "AUS", label: "Aus / menipis" }, { value: "KEMPES", label: "Kempes / amblas" },
  { value: "RUSAK", label: "Rusak" }, { value: "KOTOR", label: "Kotor / berjamur" }, { value: "TIDAK_DIKETAHUI", label: "Tidak diketahui" },
] as const;
export const SISTEM_FONDASI = [
  { value: "BONNELL", label: "Per bonnell" }, { value: "POCKET_SPRING", label: "Pocket spring" }, { value: "BUSA_FONDASI", label: "Busa fondasi" },
  { value: "PAPAN_KAYU", label: "Papan / rangka kayu" }, { value: "LAINNYA", label: "Lainnya" }, { value: "TIDAK_DIKETAHUI", label: "Tidak diketahui" },
] as const;
export const TINDAKAN = [{ value: "KEEP", label: "Dipertahankan" }, { value: "REPAIR", label: "Diperbaiki" }, { value: "REPLACE", label: "Diganti" }] as const;
export const KESESUAIAN_KELUHAN = [
  { value: "SESUAI", label: "Sesuai keluhan" }, { value: "SEBAGIAN", label: "Sebagian sesuai" }, { value: "TIDAK_SESUAI", label: "Tidak sesuai" }, { value: "TIDAK_DAPAT_DINILAI", label: "Tidak dapat dinilai" },
] as const;
export const MAKS_LAPISAN = 12;
export const MAKS_MEDIA = 8; export const MAKS_MEDIA_QC = 12; export const MAKS_MEDIA_LAPISAN = 24;
export const maksMedia = (b: KunciBagian) => (b === "LAYERS_BEFORE" ? MAKS_MEDIA_LAPISAN : BAGIAN_KOMPONEN[b].qc ? MAKS_MEDIA_QC : MAKS_MEDIA);
export const minMedia = (b: KunciBagian) => (BAGIAN_KOMPONEN[b].qc ? 1 : 0);

// ---- Bahan (Katalog / Bahan manual / Tidak diketahui) ----------------------------------------------------------------------
export type RefBahan =
  | { kind: "CATALOG"; materialId: string | null; code?: string; name?: string; unit?: string | null; supplier?: string | null; itemGroup?: string | null; density?: number | string | null; thicknessCm?: number | null }
  | { kind: "MANUAL"; text: string }
  | { kind: "UNKNOWN" };
export const LABEL_MANUAL = "Bahan manual"; export const LABEL_TIDAK_TAHU = "Tidak diketahui";

export function teksBahan(r: RefBahan | null | undefined): string | null {
  if (!r) return null;
  if (r.kind === "CATALOG") return r.name ? `${r.name}${r.code ? ` (${r.code})` : ""}` : r.code || "Bahan katalog";
  if (r.kind === "MANUAL") return `${LABEL_MANUAL}: ${r.text}`;
  return LABEL_TIDAK_TAHU;
}
export const bahanSah = (m: RefBahan | null | undefined) => !!m && (m.kind === "UNKNOWN" || (m.kind === "MANUAL" && m.text.trim().length >= 2) || (m.kind === "CATALOG" && !!m.materialId));
/** Buang field tampilan (label dsb.) — bentuk yang disimpan server (cermin stripRef). */
export function rapikanBahan(r: unknown): RefBahan | null {
  const x = r as Record<string, unknown> | null | undefined;
  if (!x) return null;
  if (x.kind === "CATALOG") {
    const o: RefBahan = { kind: "CATALOG", materialId: (x.materialId as string) ?? null, code: x.code as string, name: x.name as string, unit: (x.unit as string) ?? null };
    if (x.supplier) o.supplier = x.supplier as string;
    if (x.itemGroup) o.itemGroup = x.itemGroup as string;
    if (x.density != null) o.density = x.density as number;
    if (x.thicknessCm != null) o.thicknessCm = x.thicknessCm as number;
    return o;
  }
  if (x.kind === "MANUAL") return { kind: "MANUAL", text: String(x.text ?? "") };
  return { kind: "UNKNOWN" };
}

// ---- Draf ------------------------------------------------------------------------------------------------------------------
let urut = 0;
export const idBaris = () => `b${Date.now().toString(36)}${(++urut).toString(36)}`;
export type BarisSebelum = { id: string; material: RefBahan | null; thickness: string; condition: string; note: string };
export type BarisSesudah = { id: string; action: string; fromOrder: string; material: RefBahan | null; thickness: string; note: string };
export type MediaKomponen = { url: string; previewUrl: string; kind: string; caption: string };

export type Draf = {
  // umum
  note: string; reason: string; media: MediaKomponen[];
  // LAYERS_BEFORE
  layersUnknown: boolean; layersBefore: BarisSebelum[];
  // FOUNDATION_BEFORE / uji fondasi
  system: string; material: RefBahan | null; condition: string;
  unloadedHeight: string; loadedHeight: string;
  // uji
  testerWeight: string; testMethod: string; sameMethod: boolean;
  complaintMatch: string; complaintNote: string; feelNote: string; wholeDrop: string; qcInFrame: boolean;
  // AFTER
  foundationOn: boolean; foundation: { action: string; system: string; material: RefBahan | null; note: string }; layersAfter: BarisSesudah[]; deviationNote: string;
};

export const barisSebelumKosong = (): BarisSebelum => ({ id: idBaris(), material: null, thickness: "", condition: "", note: "" });
export const barisSesudahKosong = (): BarisSesudah => ({ id: idBaris(), action: "", fromOrder: "", material: null, thickness: "", note: "" });

const t = (v: unknown) => (v == null ? "" : String(v));
export type EntriKomponen = { version: number; data: Record<string, unknown> | null; media?: { url: string; previewUrl?: string; kind?: string; caption?: string | null }[]; actor?: { name: string | null } | null; at?: string };

/** Draf formulir dari entri server (atau kosong). Berat penguji AKTUAL tidak pernah diisi otomatis dari berat customer (sama dengan web). */
export function drafDari(bagian: KunciBagian, e: EntriKomponen | null | undefined): Draf {
  const d = (e?.data ?? {}) as Record<string, any>;
  const f = d.foundation as Record<string, any> | null | undefined;
  return {
    note: t(d.note), reason: "",
    media: (e?.media ?? []).map((m) => ({ url: m.url, previewUrl: m.previewUrl || m.url, kind: m.kind || "image", caption: t(m.caption) })),
    layersUnknown: !!d.layersUnknown,
    layersBefore: bagian === "LAYERS_BEFORE" ? ((d.layers ?? []) as Record<string, unknown>[]).map((l) => ({ id: idBaris(), material: rapikanBahan(l.material), thickness: t(l.thicknessCm), condition: t(l.condition), note: t(l.note) })) : [],
    system: t(d.system), material: rapikanBahan(d.material), condition: t(d.condition),
    unloadedHeight: t(d.unloadedHeightCm), loadedHeight: t(d.loadedHeightCm),
    testerWeight: t(d.testerWeightKg), testMethod: t(d.testMethod), sameMethod: false, // konfirmasi sebanding dibuat ULANG setiap simpan
    complaintMatch: t(d.complaintMatch), complaintNote: t(d.complaintNote), feelNote: t(d.feelNote), wholeDrop: t(d.wholeDropCm), qcInFrame: !!d.qcInFrame,
    foundationOn: bagian === "AFTER" ? (e ? !!f : true) : false,
    foundation: { action: t(f?.action), system: t(f?.system), material: rapikanBahan(f?.material), note: t(f?.note) },
    layersAfter: bagian === "AFTER" ? ((d.layers ?? []) as Record<string, unknown>[]).map((l) => ({ id: idBaris(), action: t(l.action), fromOrder: t(l.fromOrder), material: rapikanBahan(l.material), thickness: t(l.thicknessCm), note: t(l.note) })) : [],
    deviationNote: t(d.deviationNote),
  };
}

/** Isi hasil aktual dari racikan rencana tersimpan (bisa diubah sebelum disimpan) — cermin draftFromPlan. */
export function drafDariRencana(rencana: EntriKomponen | null | undefined, dasar: Draf): Draf {
  const d = rencana?.data as Record<string, any> | null | undefined;
  if (!d) return dasar;
  return {
    ...dasar, foundationOn: !!d.foundation,
    foundation: d.foundation ? { action: t(d.foundation.action), system: t(d.foundation.system), material: rapikanBahan(d.foundation.material), note: t(d.foundation.note) } : dasar.foundation,
    layersAfter: ((d.layers ?? []) as Record<string, unknown>[]).map((l) => ({ id: idBaris(), action: t(l.action), fromOrder: t(l.fromOrder), material: rapikanBahan(l.material), thickness: t(l.thicknessCm), note: t(l.note) })),
  };
}

const kunciBahan = (m: RefBahan | null | undefined) => (!m ? "" : m.kind === "CATALOG" ? `C:${m.materialId}` : m.kind === "MANUAL" ? `M:${m.text.trim().toLowerCase()}` : "U");
const n2 = (v: unknown) => { const s = String(v ?? "").trim().replace(",", "."); return s === "" ? null : Number(s); };

/** Bagian hasil aktual yang berbeda dari racikan rencana (cermin draftDeviations). */
export function perbedaanDariRencana(d: Draf, rencana: EntriKomponen | null | undefined): string[] {
  const p = rencana?.data as Record<string, any> | null | undefined;
  if (!p) return [];
  const out: string[] = [];
  if (d.foundationOn && p.foundation) {
    const f = d.foundation;
    if (f.action !== p.foundation.action || kunciBahan(f.material) !== kunciBahan(rapikanBahan(p.foundation.material)) || (f.system || "") !== (p.foundation.system || "")) out.push("Fondasi");
  }
  if (d.layersAfter.length) {
    const rl = (p.layers ?? []) as Record<string, any>[];
    const n = Math.max(d.layersAfter.length, rl.length);
    for (let i = 0; i < n; i++) {
      const a = d.layersAfter[i]; const r = rl[i];
      if (!a || !r) { out.push(`Lapisan ${i + 1}`); continue; }
      if (a.action !== r.action || kunciBahan(a.material) !== kunciBahan(rapikanBahan(r.material)) || (n2(a.thickness) != null && r.thicknessCm != null && n2(a.thickness) !== r.thicknessCm)) out.push(`Lapisan ${i + 1}`);
    }
  }
  return out;
}

const tebalSah = (v: string) => { const n = n2(v); return n === null || (Number.isFinite(n) && n > 0 && n <= 100); };

/** Pesan galat pertama (sama urutan & aturan dengan validateDraft web), atau null. */
export function validasiKomponen(b: KunciBagian, d: Draf, opsi: { koreksi?: boolean; rencana?: EntriKomponen | null } = {}): string | null {
  if (opsi.koreksi && d.reason.trim().length < 3) return "Tulis alasan koreksi (minimal 3 huruf).";
  if (b === "AFTER" && opsi.rencana && !d.deviationNote.trim()) {
    const beda = perbedaanDariRencana(d, opsi.rencana);
    if (beda.length) return `Hasil aktual berbeda dari rencana (${beda.join(", ")}) — tulis alasan perbedaannya.`;
  }
  const adaMedia = d.media.length > 0;
  if (b === "LAYERS_BEFORE") {
    if (d.layersUnknown) return null;
    if (!d.layersBefore.length) return "Tambahkan minimal satu lapisan, atau pilih “Lapisan tidak diketahui”.";
    for (const [i, l] of d.layersBefore.entries()) {
      if (!bahanSah(l.material)) return `Lapisan ${i + 1}: pilih bahan, “${LABEL_MANUAL}”, atau “${LABEL_TIDAK_TAHU}”.`;
      if (!l.condition) return `Lapisan ${i + 1}: pilih kondisi (boleh “${LABEL_TIDAK_TAHU}”).`;
      if (!tebalSah(l.thickness)) return `Lapisan ${i + 1}: ketebalan harus angka 0–100 cm atau dikosongkan.`;
    }
    return null;
  }
  if (b === "WHOLE_TEST_BEFORE" || b === "WHOLE_TEST_AFTER") {
    if (!d.complaintMatch) return "Pilih kesesuaian dengan keluhan customer (atau “Tidak dapat dinilai”).";
    if (d.feelNote.trim().length < 3) return "Tulis feel awal (minimal 3 huruf).";
    const w = n2(d.testerWeight);
    if (w === null || !(w > 0) || w > 300) return "Isi berat penguji aktual (kg) — tidak terisi otomatis dari berat customer.";
    if (d.testMethod.trim().length < 3) return "Isi titik/metode pengujian (minimal 3 huruf).";
    const dr = n2(d.wholeDrop);
    if (dr === null || !Number.isFinite(dr) || dr < 0 || dr > 100) return "Isi penurunan kasur utuh (cm), 0–100.";
    if (!d.qcInFrame) return "Konfirmasi bahwa foto/video memperlihatkan PIC QC sedang menguji kasur.";
    if (!adaMedia) return b === "WHOLE_TEST_AFTER" ? "Lampirkan minimal 1 foto/video uji kasur jadi." : "Lampirkan minimal 1 foto/video kondisi sebelum bongkar.";
    return null;
  }
  if (b === "FOUNDATION_TEST_BEFORE" || b === "FOUNDATION_TEST_AFTER") {
    if (!d.system) return `Pilih jenis/sistem fondasi (boleh “${LABEL_TIDAK_TAHU}”).`;
    const a = n2(d.unloadedHeight); const l = n2(d.loadedHeight);
    if (a === null || !(a > 0) || a > 100) return "Isi tinggi tanpa beban (cm).";
    if (l === null || !(l > 0) || l > 100) return "Isi tinggi saat dibebani (cm).";
    if (l > a) return "Tinggi saat dibebani tidak boleh lebih besar dari tinggi tanpa beban.";
    const w = n2(d.testerWeight);
    if (w === null || !(w > 0) || w > 300) return "Isi berat penguji aktual (kg).";
    if (d.testMethod.trim().length < 3) return "Isi titik/metode pengujian (minimal 3 huruf).";
    if (d.material && !bahanSah(d.material)) return "Lengkapi bahan fondasi atau kosongkan.";
    if (!adaMedia) return "Lampirkan minimal 1 foto/video yang memperlihatkan pengukuran fondasi dengan beban.";
    return null;
  }
  if (b === "FOUNDATION_BEFORE") {
    if (!d.system) return `Pilih jenis/sistem fondasi (boleh “${LABEL_TIDAK_TAHU}”).`;
    if (!d.condition) return `Pilih kondisi fondasi (boleh “${LABEL_TIDAK_TAHU}”).`;
    if (d.material && !bahanSah(d.material)) return "Lengkapi bahan fondasi atau kosongkan.";
    return null;
  }
  // AFTER
  if (!d.foundationOn && !d.layersAfter.length) return "Isi fondasi atau minimal satu lapisan hasil akhir.";
  if (d.foundationOn) {
    if (!d.foundation.action) return "Fondasi: pilih dipertahankan / diperbaiki / diganti.";
    if (d.foundation.action === "REPLACE" && !d.foundation.system) return `Fondasi diganti: pilih jenis fondasi baru (boleh “${LABEL_TIDAK_TAHU}”).`;
    if (d.foundation.material && !bahanSah(d.foundation.material)) return "Lengkapi bahan fondasi atau kosongkan.";
  }
  for (const [i, l] of d.layersAfter.entries()) {
    if (!l.action) return `Lapisan ${i + 1}: pilih dipertahankan / diperbaiki / diganti.`;
    if (l.action !== "KEEP" && !bahanSah(l.material)) return `Lapisan ${i + 1}: pilih bahan, “${LABEL_MANUAL}”, atau “${LABEL_TIDAK_TAHU}”.`;
    if (l.material && !bahanSah(l.material)) return `Lapisan ${i + 1}: lengkapi bahan atau kosongkan.`;
    if (!tebalSah(l.thickness)) return `Lapisan ${i + 1}: ketebalan harus angka 0–100 cm atau dikosongkan.`;
  }
  return null;
}

/** Payload server (cermin payloadFromDraft). dropCm uji fondasi TIDAK dikirim — dihitung server. */
export function payloadKomponen(b: KunciBagian, d: Draf): Record<string, unknown> {
  const note = d.note.trim() || null;
  if (b === "LAYERS_BEFORE") {
    return { layersUnknown: d.layersUnknown, note, layers: d.layersUnknown ? [] : d.layersBefore.map((l) => ({ material: l.material, thicknessCm: n2(l.thickness), condition: l.condition, note: l.note.trim() || null })) };
  }
  if (b === "FOUNDATION_BEFORE") return { system: d.system, material: d.material || null, condition: d.condition, note };
  if (b === "WHOLE_TEST_BEFORE" || b === "WHOLE_TEST_AFTER") {
    return {
      ...(b === "WHOLE_TEST_AFTER" ? { sameMethodAsBefore: d.sameMethod } : {}),
      complaintMatch: d.complaintMatch, complaintNote: d.complaintNote.trim() || null, feelNote: d.feelNote.trim(), testerWeightKg: n2(d.testerWeight), testMethod: d.testMethod.trim(),
      wholeDropCm: n2(d.wholeDrop), qcInFrame: d.qcInFrame, note,
    };
  }
  if (b === "FOUNDATION_TEST_BEFORE" || b === "FOUNDATION_TEST_AFTER") {
    return {
      ...(b === "FOUNDATION_TEST_AFTER" ? { sameMethodAsBefore: d.sameMethod } : {}),
      system: d.system, material: d.material || null, unloadedHeightCm: n2(d.unloadedHeight), loadedHeightCm: n2(d.loadedHeight), testerWeightKg: n2(d.testerWeight), testMethod: d.testMethod.trim(), note,
    };
  }
  return {
    foundation: d.foundationOn ? { action: d.foundation.action, system: d.foundation.system || null, material: d.foundation.material || null, note: d.foundation.note.trim() || null } : null,
    layers: d.layersAfter.map((l) => ({ action: l.action, fromOrder: l.fromOrder === "" ? null : Number(l.fromOrder), material: l.material || null, thicknessCm: n2(l.thickness), note: l.note.trim() || null })),
    note, ...(d.deviationNote.trim() ? { deviationNote: d.deviationNote.trim() } : {}),
  };
}
export const mediaKomponen = (d: Draf) => d.media.map((m) => ({ url: m.url, caption: m.caption.trim() || null }));

/** Total tinggi lapisan (pratinjau; server menghitung ulang). Kosong = belum dicatat, bukan 0. */
export function ringkasLapisan(d: Draf): string {
  if (d.layersUnknown) return "Lapisan tidak diketahui — total tinggi belum dicatat";
  const rows = d.layersBefore;
  if (!rows.length) return "Belum ada lapisan";
  const known = rows.map((l) => n2(l.thickness)).filter((x): x is number => x != null && Number.isFinite(x) && x > 0);
  if (!known.length) return "Total tinggi lapisan belum dicatat";
  const total = Math.round(known.reduce((a, b) => a + b, 0) * 100) / 100;
  return known.length === rows.length ? `Total tinggi lapisan ${total} cm (${rows.length} lapisan)` : `Total belum lengkap — ${total} cm dari ${known.length} lapisan; ${rows.length - known.length} belum diukur`;
}

/** Penurunan fondasi (pratinjau) = tinggi tanpa beban − saat dibebani. */
export function penurunanFondasi(d: Draf): number | null {
  const a = n2(d.unloadedHeight); const l = n2(d.loadedHeight);
  return a != null && l != null && a > 0 && l > 0 && l <= a ? Math.round((a - l) * 100) / 100 : null;
}

// ---- Dari kartu ke bagian yang ditunggu --------------------------------------------------------------------------------------
/** next.wait dari server → bagian Catatan Komponen PIC QC yang ditunggu (sama dengan KIND di qc-queue server). */
export const BAGIAN_TUNGGU_QC: Record<string, KunciBagian> = {
  QC_BEFORE_PENDING: "WHOLE_TEST_BEFORE", FOUNDATION_TEST_PENDING: "FOUNDATION_TEST_BEFORE",
  FOUNDATION_NEW_TEST_PENDING: "FOUNDATION_TEST_AFTER", FINISHED_TEST_PENDING: "WHOLE_TEST_AFTER",
};

/** Catatan Komponen yang ditunggu kartu ini, beserta siapa yang mengisinya. null = tidak ada. */
export function catatanDitunggu(next: { action?: string; wait?: string; actor?: string; gated?: boolean; layersRequired?: boolean; layersAfterRequired?: boolean; stepNo?: number | null } | null | undefined):
  { bagian: KunciBagian; oleh: "TABLE" | "QC" } | null {
  if (!next) return null;
  if (next.action === "WAIT" && next.wait && BAGIAN_TUNGGU_QC[next.wait]) return { bagian: BAGIAN_TUNGGU_QC[next.wait]!, oleh: "QC" };
  if (next.action === "WAIT" && next.wait === "AFTER_PENDING") return { bagian: "AFTER", oleh: "TABLE" };
  if (next.gated && next.layersRequired && next.stepNo === 3) return { bagian: "LAYERS_BEFORE", oleh: "TABLE" };
  if (next.gated && next.layersAfterRequired) return { bagian: "AFTER", oleh: "TABLE" };
  return null;
}
