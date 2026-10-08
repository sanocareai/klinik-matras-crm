// Fase 3 LAYANAN — rantai bahan PIC Bahan: racikan komponen (Meja/QC) → BOM rencana → bahan diserahkan Gudang → pemakaian aktual.
// Murni (tanpa React/jaringan). Empat sumber TETAP terpisah (tabel/command masing-masing) dan hanya DITAUTKAN di tampilan lewat materialId. Kosong = "Belum dicatat" (tidak dikarang).
export const NOT_RECORDED = "Belum dicatat";
const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

/** Bahan KATALOG yang dirujuk racikan rencana (PLAN_RACIKAN) + butir racikan tanpa katalog (manual/tidak diketahui — tidak bisa ditautkan ke BOM). */
export function racikanRefs(planEntry) {
  const d = planEntry?.data; const byId = new Map(); const unlinked = [];
  const add = (where, action, ref) => {
    if (!ref) return;
    if (ref.kind === "CATALOG" && ref.materialId) {
      const row = byId.get(ref.materialId) || { materialId: ref.materialId, code: ref.code ?? null, name: ref.name ?? null, unit: ref.unit ?? null, supplier: ref.supplier ?? null, itemGroup: ref.itemGroup ?? null, uses: [] };
      row.uses.push({ where, action }); byId.set(ref.materialId, row);
    } else unlinked.push({ where, action, label: ref.kind === "MANUAL" ? `Bahan manual: ${ref.text}` : "Tidak diketahui" });
  };
  if (d?.foundation) add("Fondasi", d.foundation.action, d.foundation.material);
  (d?.layers || []).forEach((l, i) => add(`Lapisan ${i + 1}`, l.action, l.material));
  return { catalog: [...byId.values()], unlinked };
}

/**
 * Baris rantai per bahan (kunci materialId): racikan (rujukan), BOM rencana, diserahkan, dipakai.
 * @param {{planEntry?:object|null, bom?:Array, issued?:Array, used?:Array}} src  bom: [{materialId,qty,name,code,uom}]; issued: [{materialId,qty,...}]; used: [{materialId,qty,...}]
 */
export function materialChainRows({ planEntry = null, bom = [], issued = [], used = [] } = {}) {
  const refs = racikanRefs(planEntry);
  const rows = new Map();
  const ensure = (m) => {
    if (!rows.has(m.materialId)) rows.set(m.materialId, { materialId: m.materialId, code: m.code ?? null, name: m.name ?? null, unit: m.uom ?? m.unit ?? null, supplier: null, itemGroup: null, racikan: [], bomQty: null, issuedQty: null, usedQty: null });
    const r = rows.get(m.materialId); r.code ??= m.code ?? null; r.name ??= m.name ?? null; r.unit ??= m.uom ?? m.unit ?? null; return r;
  };
  for (const c of refs.catalog) { const r = ensure(c); r.racikan = c.uses; r.supplier = c.supplier; r.itemGroup = c.itemGroup; }
  for (const b of bom) ensure(b).bomQty = num(b.qty);
  for (const i of issued) ensure(i).issuedQty = num(i.qty);
  for (const u of used) ensure(u).usedQty = num(u.qty);
  const list = [...rows.values()].map((r) => ({ ...r, flags: chainFlags(r) }));
  list.sort((a, b) => String(a.name || a.code || "").localeCompare(String(b.name || b.code || "")));
  return { rows: list, unlinked: refs.unlinked, hasPlan: !!planEntry };
}

// Penanda ketidaksesuaian ringan (informasi, bukan blok): dipakai > diserahkan, dipakai tanpa diserahkan, racikan tanpa BOM, BOM tanpa racikan.
export function chainFlags(r) {
  const f = [];
  if (r.usedQty != null && r.issuedQty == null) f.push("DIPAKAI_TANPA_SERAH");
  if (r.usedQty != null && r.issuedQty != null && r.usedQty > r.issuedQty + 1e-9) f.push("DIPAKAI_MELEBIHI_SERAH");
  if (r.racikan.length && r.bomQty == null) f.push("RACIKAN_TANPA_BOM");
  if (r.bomQty != null && !r.racikan.length) f.push("BOM_TANPA_RACIKAN");
  return f;
}
export const FLAG_TEXT = Object.freeze({
  DIPAKAI_TANPA_SERAH: "Dipakai tetapi belum diserahkan Gudang",
  DIPAKAI_MELEBIHI_SERAH: "Dipakai melebihi yang diserahkan",
  RACIKAN_TANPA_BOM: "Ada di racikan, belum masuk BOM",
  BOM_TANPA_RACIKAN: "Ada di BOM, tidak dirujuk racikan",
});
export const fmtQty = (v, unit) => (v == null ? null : `${v}${unit ? ` ${String(unit).toLowerCase()}` : ""}`);

// ---- BOM rencana: draf <-> payload (command planning yang sama) ----
export const bomDraftFromCard = (bom = []) => bom.map((b) => ({ materialId: b.materialId, code: b.code ?? null, name: b.name ?? null, unit: b.uom ?? null, supplier: b.supplier ?? null, itemGroup: b.itemGroup ?? null, qty: String(b.qty ?? "") }));
export function bomPayload(draft = []) { return draft.map((l) => ({ materialId: l.materialId, qty: num(l.qty) })); }
export function validateBomDraft(draft = []) {
  if (!draft.length) return "Tambahkan minimal satu bahan ke BOM.";
  const seen = new Set();
  for (const l of draft) {
    const name = l.name || l.code || "bahan";
    const q = num(l.qty);
    if (q == null || !(q > 0)) return `Isi jumlah ${name} (lebih dari 0).`;
    if (seen.has(l.materialId)) return `${name} muncul dua kali — satu bahan satu baris.`;
    seen.add(l.materialId);
  }
  return null;
}
export const bomUnchanged = (draft = [], bom = []) => {
  const a = bomPayload(draft).map((l) => `${l.materialId}:${l.qty}`).sort().join("|");
  const b = bom.map((x) => `${x.materialId}:${Number(x.qty)}`).sort().join("|");
  return a === b;
};
/** BOM terkunci di UI bila bahan sudah diserahkan Gudang (server tetap penegak: PLAN_MATERIAL_ALREADY_ISSUED / PLAN_MATERIAL_ISSUE_ACTIVE). */
export const bomLockedReason = (card) => ((card?.issuedMaterials || []).length ? "Bahan sudah diserahkan Gudang — rencana bahan terkunci. Koreksi lewat retur/penyesuaian stok oleh Gudang." : null);
export const bomWillReleaseReservation = (card) => card?.plan?.status === "MATERIAL_RESERVED";
