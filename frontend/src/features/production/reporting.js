// P11 — Reporting & KPI Production–Warehouse: model tampilan murni (tanpa React) supaya bisa diuji dengan `node --test`.
// Angka TIDAK dihitung di sini: semua nilai datang dari backend (kontrak metrik kanonis). File ini hanya memformat & menyusun query
// yang SAMA untuk layar, drill-down, dan export, sehingga layar = berkas.

export const MIN_SAMPLE = 5;
export const INSUFFICIENT = "Data belum cukup";

// ---------------------------------------------------------------- format (selaras dengan backend productionReportExport.formatCell) ----------
const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 });
export function wibStamp(iso) {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} WIB`;
}
export function formatCell(value, tipe) {
  if (value === null || value === undefined || value === "") return "—";
  if (tipe === "angka") return typeof value === "number" ? nf.format(value) : String(value);
  if (tipe === "waktu") return wibStamp(value);
  if (tipe === "tanggal") return String(value).slice(0, 10);
  return String(value);
}
export function formatMinutes(min) {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${Math.round(min)} mnt`;
  if (min < 24 * 60) return `${Math.round((min / 60) * 10) / 10} jam`;
  return `${Math.round((min / 1440) * 10) / 10} hari`;
}

// Tampilan satu metrik di kartu KPI. Nilai null = "Data belum cukup" (+ alasan); hitungan (count) tidak pernah null.
export function metricView(m) {
  if (!m) return { text: "—", sub: "", insufficient: false };
  if (m.value === null || m.value === undefined) {
    return { text: INSUFFICIENT, sub: m.reason || `n=${m.n ?? 0}, minimal ${MIN_SAMPLE}`, insufficient: true };
  }
  let text;
  if (m.unit === "menit") text = formatMinutes(m.value);
  else if (m.unit === "%") text = `${nf.format(m.value)}%`;
  else text = nf.format(m.value);
  let sub = "";
  if (m.key === "target_vs_done") sub = `Target ${nf.format(m.target)} (${m.targetDesc || `${m.dailyTarget}/hari × ${m.activeDays} hari aktif`})${m.achievementPct != null ? ` · ${nf.format(m.achievementPct)}%` : ""}`;
  else if (m.kind !== "count") sub = `n=${m.n}`;
  return { text, sub, insufficient: false };
}

// Kelompokkan metrik menurut `group` dengan urutan kemunculan dari server.
export function groupMetrics(metrics = []) {
  const order = []; const by = new Map();
  for (const m of metrics) { if (!by.has(m.group)) { by.set(m.group, []); order.push(m.group); } by.get(m.group).push(m); }
  return order.map((group) => ({ group, items: by.get(group) }));
}

// Validasi formulir target (cermin aturan server; server tetap menegakkan ulang).
export function targetFormError(form, meta = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveFrom || "")) return "Pilih tanggal berlaku";
  if (meta.minEffectiveDate && form.effectiveFrom < meta.minEffectiveDate) return `Tanggal berlaku paling awal ${meta.minEffectiveDate}`;
  const n = Number(form.targetUnits);
  if (!Number.isInteger(n) || n < 1 || n > (meta.maxTargetUnits || 500)) return `Target harus bilangan bulat 1–${meta.maxTargetUnits || 500} unit`;
  const r = (form.reason || "").trim();
  if (r.length < 5 || r.length > 300) return "Alasan wajib diisi (5–300 karakter)";
  return "";
}

// ---------------------------------------------------------------- tab menurut izin ----------------------------------------------------------
export const TABS = [
  { key: "ringkasan", label: "Ringkasan", kind: "summary", cap: "summary" },
  { key: "meja", label: "Performa Meja", kind: "stations", cap: "stations" },
  { key: "pic", label: "Performa PIC", kind: "operators", cap: "operators" },
  { key: "gudang", label: "Gudang", kind: "warehouse", cap: "warehouse" },
  { key: "laporan", label: "Laporan", kind: "units", cap: "units" },
];
export function tabsFor(capabilities = {}) {
  const tabs = TABS.filter((t) => capabilities[t.cap]);
  if (!tabs.length && capabilities.self) return [{ key: "saya", label: "Ringkasan Saya", kind: "mine", cap: "self" }];
  return tabs;
}

// ---------------------------------------------------------------- filter & query ------------------------------------------------------------
export const FILTER_FIELDS = ["station", "operator", "step", "status", "priority", "service", "qc", "docs"];
export const emptyFilters = () => Object.fromEntries(FILTER_FIELDS.map((k) => [k, ""]));
export function activeFilterCount(filters = {}) { return FILTER_FIELDS.filter((k) => filters[k] !== "" && filters[k] != null).length; }

// Query SATU-SATUNYA untuk layar, drill-down, dan export. Kunci kosong dibuang; urutan deterministik.
export function reportQuery({ from, to } = {}, filters = {}, extra = {}) {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  for (const k of FILTER_FIELDS) if (filters[k] !== "" && filters[k] != null) p.set(k, String(filters[k]));
  for (const [k, v] of Object.entries(extra)) if (v !== "" && v != null) p.set(k, String(v));
  return p.toString();
}

// ---------------------------------------------------------------- tren ----------------------------------------------------------------------
export function trendSeries(table) {
  return (table?.rows || []).map((r) => ({ bucket: r.bucket, masuk: r.masuk ?? 0, terjadwal: r.terjadwal ?? 0, selesai: r.selesai ?? 0 }));
}
export function trendTick(bucket, granularity) {
  if (!bucket) return "";
  if (granularity === "month") return bucket;
  return `${bucket.slice(8, 10)}/${bucket.slice(5, 7)}`;
}

// ---------------------------------------------------------------- baris tabel -> Unit 360 ---------------------------------------------------
export const hasUnit = (row) => !!(row && row.unitId);
export const sensitiveLeak = (doc) => /omzet|harga|pembayaran|\bhpp\b|jurnal|customerName|phone/i.test(JSON.stringify(doc || {}));

// Nama berkas aman dari header Content-Disposition (server yang menentukan); cadangan bila tidak ada.
export const exportFormats = [{ key: "xlsx", label: "Excel" }, { key: "pdf", label: "PDF" }];
export const EXPORTABLE = { ringkasan: "summary", meja: "stations", pic: "operators", gudang: "warehouse", laporan: "units" };

// Pesan ramah untuk reader OFF / non-cohort.
export function offMessage(doc) {
  if (doc?.readerMode === "OFF") return doc.message || "Produksi V2 belum aktif — laporan terisi setelah Production V2 diaktifkan untuk unit terkait.";
  return null;
}

// Baris "cakupan" yang selalu tampil di atas laporan (dari dokumen yang sama dengan export).
export function coverageChips(doc) {
  const c = doc?.coverage; if (!c) return [];
  return [
    { key: "cohort", label: "Unit cohort V2", value: c.cohortUnits },
    { key: "runs", label: "Run V2 dalam cohort", value: c.runsInCohort },
    { key: "filtered", label: "Setelah filter", value: c.runsAfterFilters },
    { key: "total", label: "Total unit V2 di sistem", value: c.totalV2Units },
    { key: "period", label: "Periode", value: `${c.period.from} s/d ${c.period.to} (${c.period.days} hari)` },
    { key: "tz", label: "Zona waktu", value: c.timezone },
  ];
}
