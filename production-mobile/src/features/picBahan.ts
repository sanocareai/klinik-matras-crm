import type { BahanDiserahkan, PengaturanBahan, Racikan, RunCard } from "@/api/types";
import type { EntriKomponen } from "./komponen";

// MODEL MURNI PIC BAHAN & JALUR PENGERJAAN PESANAN — cermin web:
//   frontend/src/features/production/experience.js   (productFlowOf, materialsByPic, validateMaterialRecord, buildMaterialRecordBody)
//   frontend/src/features/production/materialRows.js (baris "+ Tambah baris", validateMaterialRows, rowsPayload, sameAsSaved)
//   frontend/src/features/production/workerApp/materialChainModel.js (racikanRefs, reworkState, bomLockedReason, validateReworkLines)
// Server tetap penentu (command build/materials, build/plan-bom, build/rework-material). Tidak ada yang menulis stok di sini.

export type AlurProduk = "KASUR" | "NON_KASUR" | "UNCONFIRMED" | "RESTORATION";
type Kartu = Pick<RunCard, "track" | "product" | "build" | "materialPic">;

/** Jalur BUILD: klasifikasi kanonis server; belum jelas = UNCONFIRMED (TIDAK ada fallback ke kasur). Jalur restorasi = null. */
export const alurProduk = (card: Pick<RunCard, "track" | "product">): "KASUR" | "NON_KASUR" | "UNCONFIRMED" | null =>
  card.track === "BUILD" ? card.product?.flow || "UNCONFIRMED" : null;

/** Pengaturan PIC Bahan yang berlaku: jalur BUILD → card.build, LAYANAN → card.materialPic. */
export const pengaturanBahan = (card: Kartu): PengaturanBahan | null => (card.track === "BUILD" ? card.build ?? null : card.materialPic ?? null);

/** Racikan/pemakaian dicatat PIC Bahan (ditugaskan atau sudah ada catatan) → PIC Meja tidak mengisi ulang. Cermin materialsByPic. */
export const bahanOlehPicKartu = (card: Kartu) => { const p = pengaturanBahan(card); return !!(p?.materialOperator || p?.record); };

/** Saya PIC Bahan pekerjaan ini? (atau pelaksana lintas-lini). Server tetap menegakkan otorisasi PIC per pekerjaan. */
export function sayaPicBahan(card: Kartu, userId: string | null | undefined, executeAny: boolean): boolean {
  const p = pengaturanBahan(card);
  if (!p) return false;
  if (executeAny) return true;
  return !!userId && p.materialOperator?.userId === userId;
}

export const teksRacikan = (r: Racikan | null | undefined) =>
  r ? [r.fondasi && `Fondasi — ${r.fondasi}`, r.lapisan && `Lapisan — ${r.lapisan}`].filter(Boolean).join(" · ") || null : null;

export function teksCorner(c: PengaturanBahan["corner"] | null | undefined): string {
  if (!c?.confirmed) return "Belum dikonfirmasi Lead";
  return c.required ? "Diperlukan" : `Tidak diperlukan${c.reason ? ` — ${c.reason}` : ""}`;
}

// ---- Baris bahan ("+ Tambah baris") ----------------------------------------------------------------------------------------
export type BarisBahan = { key: string; materialId: string; qty: string };
let urut = 0;
export const barisKosong = (): BarisBahan => ({ key: `mb-${++urut}`, materialId: "", qty: "" });
const teksQty = (r: BarisBahan) => String(r.qty ?? "").trim();
export const barisKosongkah = (r: BarisBahan) => !r.materialId && teksQty(r) === "";
export const barisTerisi = (r: BarisBahan) => !!r.materialId && teksQty(r) !== "";
const angka = (v: unknown) => Number(String(v ?? "").trim().replace(",", "."));

/** Tepat SATU baris kosong di akhir bila baris terakhir sudah terisi (atau daftar kosong). Cermin withTrailingBlank. */
export function denganBarisKosong(rows: BarisBahan[]): BarisBahan[] {
  let end = rows.length;
  while (end > 0 && barisKosongkah(rows[end - 1]!)) end -= 1;
  const inti = rows.slice(0, end);
  const akhir = inti[inti.length - 1];
  if (!akhir || barisTerisi(akhir)) return [...inti, rows[end] && barisKosongkah(rows[end]!) ? rows[end]! : barisKosong()];
  return inti;
}
export const barisDari = (lines: { materialId: string; qty: number | string | null }[] | null | undefined) =>
  denganBarisKosong((lines ?? []).map((l) => ({ key: `mb-${++urut}`, materialId: l.materialId, qty: l.qty == null ? "" : String(l.qty) })));
/** Hanya baris TERISI yang dikirim. */
export const payloadBaris = (rows: BarisBahan[]) => rows.filter(barisTerisi).map((r) => ({ materialId: r.materialId, qty: angka(r.qty) }));

/** Validasi daftar baris (cermin validateMaterialRows). tersedia(id) = batas jumlah (mode pemakaian: diserahkan Gudang). */
export function validasiBaris(rows: BarisBahan[], opsi: { wajibSatu?: boolean; tersedia?: (id: string) => number | null; namaOf?: (id: string) => string | null | undefined } = {}): string | null {
  const seen = new Map<string, number>();
  let terisi = 0;
  for (const [i, r] of rows.entries()) {
    if (barisKosongkah(r)) continue;
    const no = i + 1;
    if (!r.materialId) return `Baris ${no}: pilih bahan.`;
    const q = angka(r.qty);
    if (teksQty(r) === "" || !Number.isFinite(q) || q <= 0) return `Baris ${no}: isi jumlah lebih dari nol.`;
    if (seen.has(r.materialId)) return `Baris ${no}: bahan ini sudah ada di baris ${seen.get(r.materialId)} — gabungkan jadi satu baris.`;
    seen.set(r.materialId, no);
    if (opsi.tersedia) {
      const max = opsi.tersedia(r.materialId);
      if (max == null) return `Baris ${no}: ${opsi.namaOf?.(r.materialId) || "bahan ini"} bukan bahan yang diserahkan Gudang untuk pekerjaan ini.`;
      if (q > max + 1e-9) return `Baris ${no}: melebihi yang diserahkan Gudang (maksimal ${max}).`;
    }
    terisi += 1;
  }
  if ((opsi.wajibSatu ?? true) && terisi === 0) return "Isi minimal satu bahan beserta jumlahnya.";
  return null;
}

/** Isian sama persis dengan yang tersimpan? (cermin sameAsSaved) */
export function samaDenganTersimpan(rows: BarisBahan[], saved: { materialId: string; qty: number | string }[] | null | undefined): boolean {
  const kunci = (xs: { materialId: string; qty: number }[]) => xs.map((x) => `${x.materialId}:${x.qty}`).sort().join("|");
  return kunci(payloadBaris(rows)) === kunci((saved ?? []).map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })));
}

// ---- Catat racikan & bahan (POST /runs/:runId/build/materials) ----------------------------------------------------------------
export type FormCatatBahan = { racikanFondasi: string; racikanLapisan: string; note: string; rows: BarisBahan[] };

export function formCatatAwal(card: Kartu): FormCatatBahan {
  const rec = pengaturanBahan(card)?.record;
  return { racikanFondasi: rec?.racikan?.fondasi ?? "", racikanLapisan: rec?.racikan?.lapisan ?? "", note: rec?.note ?? "", rows: barisDari(rec?.materials) };
}

/** Alur lembar Catat: LAYANAN = RESTORATION (hanya pemakaian aktual; racikan di Catatan Komponen), BUILD = alur produk. */
export const alurCatat = (card: Pick<RunCard, "track" | "product">): AlurProduk => alurProduk(card) ?? "RESTORATION";

/** Cermin validateMaterialRows (mode pemakaian) + validateMaterialRecord. */
export function validasiCatatBahan(f: FormCatatBahan, alur: AlurProduk, issued: BahanDiserahkan[]): string | null {
  const peta = new Map(issued.map((m) => [m.materialId, m]));
  const vb = validasiBaris(f.rows, { wajibSatu: false, tersedia: (id) => (peta.has(id) ? Number(peta.get(id)!.qty) : null), namaOf: (id) => peta.get(id)?.name });
  if (vb) return vb;
  const lines = payloadBaris(f.rows);
  if (alur === "RESTORATION") return lines.length ? null : "Isi pemakaian bahan.";
  const fon = f.racikanFondasi.trim(); const lap = f.racikanLapisan.trim();
  const adaRacikan = fon.length >= 3 || lap.length >= 3;
  if (alur === "UNCONFIRMED" && (fon || lap)) return "Jenis produk belum jelas — racikan kasur ditahan sampai Sales mengonfirmasi jenis produk.";
  if (alur === "KASUR" && ((fon && fon.length < 3) || (lap && lap.length < 3))) return "Racikan minimal 3 karakter.";
  if (!adaRacikan && !lines.length) return alur === "KASUR" ? "Isi racikan dan/atau pemakaian bahan." : "Isi pemakaian bahan.";
  return null;
}

/** Body sama dengan buildMaterialRecordBody web. */
export function bodyCatatBahan(f: FormCatatBahan, alur: AlurProduk, revision: number): Record<string, unknown> {
  const body: Record<string, unknown> = { expectedRevision: revision, materials: payloadBaris(f.rows) };
  if (alur === "KASUR") {
    const fondasi = f.racikanFondasi.trim(); const lapisan = f.racikanLapisan.trim();
    if (fondasi || lapisan) body.racikan = { fondasi: fondasi || undefined, lapisan: lapisan || undefined };
  }
  const note = f.note.trim(); if (note) body.note = note;
  return body;
}

// ---- Rencana bahan (BOM) & bahan rework -------------------------------------------------------------------------------------
export type BahanRujukan = { materialId: string; code: string | null; name: string | null; unit: string | null; supplier: string | null; itemGroup: string | null; uses: { where: string; action: string | null }[] };

/** Bahan KATALOG yang dirujuk racikan rencana + butir tanpa katalog (tidak bisa ditautkan ke BOM). Cermin racikanRefs. */
export function rujukanRacikan(rencana: EntriKomponen | null | undefined): { catalog: BahanRujukan[]; unlinked: { where: string; label: string }[] } {
  const d = rencana?.data as { foundation?: { action?: string; material?: Record<string, unknown> | null } | null; layers?: { action?: string; material?: Record<string, unknown> | null }[] } | null | undefined;
  const byId = new Map<string, BahanRujukan>(); const unlinked: { where: string; label: string }[] = [];
  const add = (where: string, action: string | null, ref: Record<string, unknown> | null | undefined) => {
    if (!ref) return;
    if (ref.kind === "CATALOG" && ref.materialId) {
      const id = String(ref.materialId);
      const row = byId.get(id) ?? { materialId: id, code: (ref.code as string) ?? null, name: (ref.name as string) ?? null, unit: (ref.unit as string) ?? null, supplier: (ref.supplier as string) ?? null, itemGroup: (ref.itemGroup as string) ?? null, uses: [] };
      row.uses.push({ where, action }); byId.set(id, row);
    } else unlinked.push({ where, label: ref.kind === "MANUAL" ? `Bahan manual: ${String(ref.text ?? "")}` : "Tidak diketahui" });
  };
  if (d?.foundation) add("Fondasi", d.foundation.action ?? null, d.foundation.material);
  (d?.layers ?? []).forEach((l, i) => add(`Lapisan ${i + 1}`, l.action ?? null, l.material));
  return { catalog: [...byId.values()], unlinked };
}

/** BOM terkunci bila bahan sudah diserahkan Gudang (server tetap penegak). */
export const alasanBomTerkunci = (card: Pick<RunCard, "issuedMaterials">) =>
  (card.issuedMaterials ?? []).length ? "Bahan sudah diserahkan Gudang — rencana bahan terkunci. Koreksi lewat retur/penyesuaian stok oleh Gudang." : null;
export const bomMelepasReservasi = (card: Pick<RunCard, "plan">) => card.plan?.status === "MATERIAL_RESERVED";
/** Tombol BOM tampil? Cermin web: bukan jalur BUILD dan sudah ada rencana. */
export const bolehIsiBom = (card: Pick<RunCard, "track" | "plan">) => card.track !== "BUILD" && !!card.plan;

export type BarisRework = { materialId: string; code: string | null; name: string | null; unit: string | null; qty: string };
export function validasiRework(lines: BarisRework[]): string | null {
  if (!lines.length) return "Tambahkan minimal satu bahan tambahan.";
  const seen = new Set<string>();
  for (const l of lines) {
    const nama = l.name || l.code || "bahan"; const q = angka(l.qty);
    if (!Number.isFinite(q) || !(q > 0)) return `Isi jumlah ${nama} (lebih dari 0).`;
    if (seen.has(l.materialId)) return `${nama} muncul dua kali — satu bahan satu baris.`;
    seen.add(l.materialId);
  }
  return null;
}
export const payloadRework = (lines: BarisRework[]) => lines.map((l) => ({ materialId: l.materialId, qty: angka(l.qty) }));

/** Status rework untuk PIC Bahan: terbuka (boleh minta), sudah diminta, atau tidak berlaku. */
export function statusRework(card: Pick<RunCard, "assembly">): { kind: "NONE" } | { kind: "OPEN" } | { kind: "REQUESTED"; issue: { issueNumber: string | null; status: string } } {
  const r = card.assembly?.rework;
  if (!card.assembly?.applicable || !r) return { kind: "NONE" };
  if (r.issue) return { kind: "REQUESTED", issue: r.issue };
  return r.open ? { kind: "OPEN" } : { kind: "NONE" };
}

// ---- Pengaturan pekerjaan oleh Lead (PIC Bahan & Corner) ---------------------------------------------------------------------
/** Konfirmasi Corner (cermin BuildPlanPanel.saveCorner). null = sah. */
export function validasiCorner(pilihan: "" | "YES" | "NO", alasan: string): string | null {
  if (!pilihan) return "Pilih: Corner diperlukan atau tidak diperlukan.";
  if (pilihan === "NO" && alasan.trim().length < 3) return "Corner tidak diperlukan wajib beralasan (minimal 3 karakter).";
  return null;
}
export const bodyCorner = (revision: number, pilihan: "YES" | "NO", alasan: string) =>
  ({ expectedRevision: revision, required: pilihan === "YES", ...(pilihan === "NO" ? { reason: alasan.trim() } : {}) });
