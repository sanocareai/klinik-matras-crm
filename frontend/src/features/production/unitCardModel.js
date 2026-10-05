// P9 UX Realignment — model MURNI untuk kartu unit yang SAMA dipakai Status Produksi, Rencana Produksi, dan Quality
// Control (satu kartu, satu bahasa visual). Tanpa React/DOM supaya bisa diuji langsung. Semua angka/label berasal dari
// view Command Center yang sudah dikirim server — modul ini hanya MENERJEMAHKAN, tidak menghitung KPI sendiri.
import { STEP_BY_NO, bucketStyle } from "@/features/production/experience.js";
import { PRODUCT_TYPE_LABELS } from "@/utils/format.js";

// Prioritas: merah untuk Tinggi/Mendesak TIDAK hanya lewat warna — ada ikon + teks + penanda tepi (lihat UnitCard).
export function priorityMeta(priority) {
  // Nilai KANONIS dari plan.priority (0/1/2) — tidak pernah disimpulkan dari catatan/teks. Overdue = badge TERPISAH, bukan perubahan prioritas.
  // Tanda tidak hanya warna: label + ikon + garis kiri (lebar berbeda). Kelas .plan-* ada di index.css.
  if (priority === 2) return { key: "URGENT", label: "Mendesak", tone: "red", icon: "urgent", edge: "border-l-[4px] border-l-red", badgeClass: "plan-prio-urgent", stripeClass: "plan-stripe-urgent", stripeWidth: 7 };
  if (priority === 1) return { key: "HIGH", label: "Tinggi", tone: "red", icon: "high", edge: "border-l-[4px] border-l-red", badgeClass: "plan-prio-high", stripeClass: "plan-stripe-high", stripeWidth: 5 };
  return { key: "NORMAL", label: "Normal", tone: "neutral", icon: null, edge: "border-l-[4px] border-l-transparent", badgeClass: "plan-prio-normal", stripeClass: "plan-stripe-normal", stripeWidth: 4 };
}

// Kekurangan data yang MEMANG relevan di kartu. Tidak menebak: hanya menyebut yang terbukti kosong di view.
export function dataGaps(view) {
  const gaps = [];
  const c = view?.customer || {};
  if (!view?.unit?.photoUrl) gaps.push("Foto unit belum ada");
  if (c.weightKg == null) gaps.push("Berat badan belum diisi Sales");
  if (!(c.salesServices && c.salesServices.length)) gaps.push("Layanan Sales belum tercatat");
  if (view?.plan && !view.plan.operator) gaps.push("PIC meja belum ditetapkan");
  return gaps;
}

// Kesiapan bahan: satu label + nada, dari materialStatus server (bukan hitungan baru).
export function materialBadge(view) {
  if (view?.shortage) return { label: "Bahan kurang", tone: "red" };
  const key = view?.materialStatus?.key;
  switch (key) {
    case "SUDAH_DISERAHKAN": return { label: "Bahan sudah diserahkan", tone: "green" };
    case "SIAP_DIAMBIL": return { label: "Bahan siap diambil", tone: "green" };
    case "MENUNGGU_DISIAPKAN": return { label: "Bahan direservasi", tone: "green" };
    case "BELUM_DIRESERVASI": return { label: "Bahan belum direservasi", tone: "orange" };
    // Belum ada BOM/rencana bahan = WAJAR sebelum diagnosa selesai — bukan kekurangan, jadi tidak ditandai di kartu.
    case "BOM_BELUM_ADA":
    case "BELUM_ADA_RENCANA": return null;
    default: return view?.materialStatus?.label ? { label: view.materialStatus.label, tone: "neutral" } : null;
  }
}

// Tahap yang sedang/ berikutnya dikerjakan ("Langkah 5 · Diagnosa"), atau label bucket bila tidak ada tahap.
export function stageText(view) {
  const n = view?.next?.stepNo;
  if (n && STEP_BY_NO[n]) return `Langkah ${n} · ${STEP_BY_NO[n].label}`;
  return bucketStyle(view?.bucket).label;
}

export const MEJA = Object.freeze(["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"]);
export const mejaLabel = (code) => (code ? String(code).replace("TABLE_", "Meja ") : null);

// Kolom pipeline untuk layar sempit: chip pemilih tahap (label + jumlah) — sumbernya kolom server apa adanya.
export function pipelineChips(columns) {
  return (columns || []).map((c) => ({ key: c.key, label: c.label, count: c.count ?? c.items?.length ?? 0 }));
}

// Backlog "Belum Dijadwalkan" = view aktif tanpa meja (sama persis definisi KPI belumDijadwalkan di server).
export function backlogOf(columns) {
  const out = [];
  for (const col of columns || []) {
    for (const item of col.items || []) {
      if (item.kind === "UPCOMING_PICKUP") continue; // belum ada Run — belum bisa dijadwalkan
      if (item.runId && !item.plan?.stationCode) out.push(item);
    }
  }
  return out.sort((a, b) => (b.plan?.priority ?? 0) - (a.plan?.priority ?? 0));
}

// Pemetaan item kartu QC (antrean P6) -> view Command Center yang sama (lewat runId) supaya kartu QC = kartu Status.
export function mergeQcWithViews(queueItems, columns) {
  const byRun = new Map();
  for (const col of columns || []) for (const it of col.items || []) if (it.runId) byRun.set(it.runId, it);
  return (queueItems || []).map((q) => ({ queue: q, view: byRun.get(q.runId) || null }));
}

// Ganti Kain = layanan KRUSIAL: hasilnya harus persis keinginan customer (kain/warna/motif), jadi kartunya diberi warna beda.
// Dikenali dari nama layanan yang DIPESAN di Sales (OrderItem.layananName, mis. "Ganti Kain") — bukan tebakan dari teks bebas.
export function isGantiKain(view) {
  const list = view?.customer?.salesServices;
  return Array.isArray(list) && list.some((s) => /\bganti\s+kain\b/i.test(String(s)));
}

function parseNotesObject(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!(t.startsWith("{") && t.endsWith("}"))) return null;
  try { const o = JSON.parse(t); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}

// Jenis kasur / merk / ukuran untuk kartu. Jenis = tipe produk order (enum); "Lainnya" memakai teks bebas Sales. Merk & ukuran
// dari kolom unit, kalau kosong dari catatan order (JSON formulir Sales). Kosong = null (jujur: tidak ditebak).
export function mattressInfo(view) {
  const c = view?.customer || {};
  const notes = parseNotesObject(c.request) || {};
  const jenisBase = c.productType ? (PRODUCT_TYPE_LABELS[c.productType] || null) : null;
  const jenis = c.productType === "KASUR_LAINNYA" && notes.jenisKasurLainnya ? `Lainnya (${notes.jenisKasurLainnya})` : jenisBase;
  const merk = view?.unit?.merk || notes.merkKasur || null;
  const ukuran = view?.unit?.ukuran || notes.ukuranKasur || null;
  return { jenis: jenis || null, merk: merk || null, ukuran: ukuran || null };
}

// Catatan Sales untuk kartu: keluhan/catatan/request SAJA — merk, ukuran, dan jenis kasur sudah punya baris sendiri
// (mattressInfo). Teks biasa (bukan JSON) ditampilkan apa adanya. Kosong = null.
export function salesNoteOf(view) {
  const raw = view?.customer?.request;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const o = parseNotesObject(raw);
  if (!o) return raw.trim();
  const parts = Object.entries(o)
    .filter(([k, v]) => ["keluhanCustomer", "catatan", "request"].includes(k) && v !== null && v !== "" && typeof v !== "object")
    .map(([, v]) => String(v).trim()).filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// Catatan/Request dari Sales kadang berupa JSON mentah dari formulir intake ({"merkKasur":"…","keluhanCustomer":"…"}).
// Terjemahkan ke kalimat terbaca TANPA menebak isi: hanya memetakan kunci yang dikenal, sisanya apa adanya. Teks biasa tidak diubah.
const REQUEST_KEYS = { merkKasur: "Merk", ukuranKasur: "Ukuran", keluhanCustomer: "Keluhan", jenisKasurLainnya: "Jenis kasur", catatan: "Catatan", request: "Request" };
export function humanizeRequest(text) {
  if (typeof text !== "string") return text ?? null;
  const t = text.trim();
  if (!(t.startsWith("{") && t.endsWith("}"))) return text;
  try {
    const o = JSON.parse(t);
    if (!o || typeof o !== "object" || Array.isArray(o)) return text;
    const parts = Object.entries(o).filter(([, v]) => v !== null && v !== "" && typeof v !== "object")
      .map(([k, v]) => `${REQUEST_KEYS[k] || k}: ${v}`);
    return parts.length ? parts.join(" · ") : text;
  } catch { return text; }
}
