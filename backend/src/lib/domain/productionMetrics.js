// KONTRAK METRIK KANONIS Production–Warehouse (P11). Modul MURNI (tanpa database): satu-satunya tempat rumus, definisi, filter, dan
// pembulatan. Dashboard, drill-down, laporan per meja/PIC/Gudang/unit, dan export Excel/PDF SEMUANYA memakai fungsi di sini lewat
// service pembaca — sehingga angka di layar = angka di daftar unit pembentuknya = angka di berkas export.
//
// Prinsip (dari spesifikasi):
//  • V1 dan V2 TIDAK dicampur: laporan hanya memuat unit V2 dalam reader cohort; cakupan (cohort / total V2 / periode) selalu ditampilkan.
//  • Sampel < MIN_SAMPLE (rata-rata / persentase) -> "Data belum cukup", bukan angka menyesatkan. Hitungan (count) tetap tampil apa adanya.
//  • Semua waktu WIB (UTC+7 tetap). Tanggal DIRENCANAKAN (kolom DATE), MASUK (tiba), MULAI, SELESAI (tahap 12 / fase Handoff), dan
//    SIAP KIRIM (barang jadi diterima Gudang) adalah lima tanggal yang berbeda dan tidak pernah dipertukarkan.
//  • TIDAK ADA omzet / harga / pembayaran / HPP di modul ini (gate Finance PERSEDIAAN_AWAL_BELUM_DIPOSTING belum selesai).
//  • Target harian: tersimpan historis di production_daily_targets_v2 (berlaku mulai effective_from, append-only). Hari tanpa target tercatat
//    memakai konfigurasi sistem (BOARD_DEFAULTS.dailyTarget). Target yang dipakai + sumbernya dicatat di setiap laporan ("targetPerHari",
//    "targetNote") agar berkas lama tetap menyatakan target yang dipakainya.

export const MIN_SAMPLE = 5;
export const MAX_RANGE_DAYS = 366;
export const WIB_MS = 7 * 3600_000;
export const SLA = Object.freeze({ materialResponseMin: 240, returnReceiveMin: 480, finishedGoodsAcceptMin: 480 });
export const SLA_NOTE = "SLA bawaan konfigurasi sistem (belum disimpan/diatur historis).";
export const DATE_BASES = Object.freeze({
  planned: "Tanggal direncanakan (jadwal meja)", arrived: "Tanggal masuk (tiba di workshop)", started: "Tanggal mulai (operasi pertama)",
  finished: "Tanggal selesai produksi (Konfirmasi Selesai / tahap 12)", ready: "Tanggal siap kirim (barang jadi diterima Gudang)",
});
export const STATUS_BUCKETS = Object.freeze({
  DALAM_PERJALANAN: "Dalam perjalanan", MASUK: "Masuk (belum dijadwalkan)", TERJADWAL: "Terjadwal", DIKERJAKAN: "Sedang dikerjakan", TERTUNDA: "Tertunda",
  MENUNGGU_QC: "Menunggu QC", MENUNGGU_GUDANG: "Menunggu Gudang", SIAP_KIRIM: "Siap kirim",
});

// ---------------------------------------------------------------- waktu & periode -------------------------------------------------------
export const wibKey = (d) => (d ? new Date(new Date(d).getTime() + WIB_MS).toISOString().slice(0, 10) : null);
export const dateKeyOfDateColumn = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null); // kolom @db.Date = tanggal kalender WIB apa adanya
export const startOfWibDay = (key) => new Date(Date.parse(`${key}T00:00:00.000Z`) - WIB_MS);
export const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (fromKey, toKey) => Math.round((Date.parse(`${toKey}T00:00:00.000Z`) - Date.parse(`${fromKey}T00:00:00.000Z`)) / 86_400_000);
// Tanggal kalender nyata: bulan 13 / 30 Feb ditolak (new Date(...) tidak valid -> toISOString melempar RangeError, jadi dijaga dulu).
const isKey = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export const isCalendarKey = isKey;
export function periodError(message, code = "REPORT_PERIOD_INVALID") { return Object.assign(new Error(message), { statusCode: 400, code }); }
export function parsePeriod({ from, to, now = new Date() } = {}) {
  const today = wibKey(now);
  const toKey = to || today;
  const fromKey = from || addDays(toKey, -29);
  if (!isKey(fromKey) || !isKey(toKey)) throw periodError("Periode harus berformat YYYY-MM-DD (tanggal kalender WIB)");
  if (fromKey > toKey) throw periodError("Tanggal awal tidak boleh setelah tanggal akhir");
  const days = daysBetween(fromKey, toKey) + 1;
  if (days > MAX_RANGE_DAYS) throw periodError(`Periode maksimal ${MAX_RANGE_DAYS} hari`);
  return { from: fromKey, to: toKey, days, start: startOfWibDay(fromKey), endExclusive: startOfWibDay(addDays(toKey, 1)) };
}
export const inPeriod = (instant, p) => !!instant && instant >= p.start && instant < p.endExclusive;
export const keyInPeriod = (key, p) => !!key && key >= p.from && key <= p.to;
export function bucketKey(key, granularity) {
  if (granularity === "month") return key.slice(0, 7);
  if (granularity === "week") { const dow = (new Date(`${key}T00:00:00.000Z`).getUTCDay() + 6) % 7; return addDays(key, -dow); } // Senin
  return key;
}
export function bucketsOf(p, granularity) { const out = []; for (let i = 0; i < p.days; i += 1) { const b = bucketKey(addDays(p.from, i), granularity); if (out[out.length - 1] !== b) out.push(b); } return out; }
export const GRANULARITY = Object.freeze(["day", "week", "month"]);

// ---------------------------------------------------------------- target harian historis ----------------------------------------------------
// rows: [{ effectiveFrom: "YYYY-MM-DD" (kalender WIB), targetUnits, createdAt }]. Target berlaku pada hari D = baris dengan effective_from <= D
// terbaru (kembar tanggal: createdAt terbaru menang). Tak ada baris yang berlaku -> fallback (konfigurasi sistem).
export function buildTargetResolver(rows = [], fallback) {
  const sorted = rows.map((r) => ({ from: r.effectiveFrom, units: r.targetUnits, at: new Date(r.createdAt).getTime() })).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.at - b.at));
  const find = (key) => { let hit = null; for (const r of sorted) { if (r.from <= key) hit = r; else break; } return hit; };
  return { targetFor: (key) => find(key)?.units ?? fallback, recorded: (key) => !!find(key), fallback, count: sorted.length };
}
// Ringkasan target untuk satu periode: nilai per hari (angka seragam atau "a–b"), potongan (tercatat vs konfigurasi), dan catatan yang dicetak di setiap laporan.
export function describeTargets(resolver, p) {
  const segs = [];
  for (let i = 0; i < p.days; i += 1) {
    const day = addDays(p.from, i); const units = resolver.targetFor(day); const source = resolver.recorded(day) ? "tercatat" : "konfigurasi";
    const last = segs[segs.length - 1];
    if (last && last.units === units && last.source === source) last.to = day; else segs.push({ from: day, to: day, units, source });
  }
  const values = segs.map((s) => s.units); const lo = Math.min(...values); const hi = Math.max(...values);
  const perDay = lo === hi ? lo : `${lo}–${hi}`;
  const anyRecorded = segs.some((s) => s.source === "tercatat");
  const note = anyRecorded
    ? `Target harian tercatat historis: ${segs.map((s) => `${s.units}/hari ${s.from === s.to ? s.from : `${s.from}–${s.to}`}${s.source === "konfigurasi" ? " (konfigurasi sistem, belum ada target tercatat)" : ""}`).join("; ")}.`
    : `Target harian = konfigurasi sistem (${resolver.fallback}/hari); belum tersimpan historis untuk periode ini.`;
  return { perDay, note, segments: segs };
}

// ---------------------------------------------------------------- statistik --------------------------------------------------------------
export const round1 = (n) => Math.round(n * 10) / 10;
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export function percentile(sorted, q) { if (!sorted.length) return null; const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1)); return sorted[i]; }
export const minutesBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000)) : null);
export function formatMinutes(min) {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} mnt`;
  if (min < 24 * 60) return `${round1(min / 60)} jam`;
  return `${round1(min / 1440)} hari`;
}
export const pct = (num, den) => (den > 0 ? round1((num / den) * 100) : null);

// ---------------------------------------------------------------- filter ----------------------------------------------------------------
export const FILTER_KEYS = Object.freeze(["station", "operator", "step", "status", "priority", "service", "qc", "docs"]);
export const QC_FILTERS = Object.freeze(["PASS", "FAIL", "BELUM"]);
export const DOC_FILTERS = Object.freeze(["LENGKAP", "KURANG"]);
export function normalizeFilters(raw = {}) {
  const f = {};
  const str = (v) => (v == null || v === "" ? null : String(v).slice(0, 80));
  f.station = str(raw.station);
  if (f.station && !/^TABLE_\d{1,2}$/.test(f.station)) throw periodError("Filter meja tidak valid", "REPORT_FILTER_INVALID");
  f.operator = str(raw.operator);
  if (f.operator && !/^[0-9a-f-]{36}$/i.test(f.operator)) throw periodError("Filter PIC tidak valid", "REPORT_FILTER_INVALID");
  f.step = raw.step == null || raw.step === "" ? null : Number(raw.step);
  if (f.step != null && !(Number.isInteger(f.step) && f.step >= 1 && f.step <= 12)) throw periodError("Filter tahap harus 1–12", "REPORT_FILTER_INVALID");
  f.status = str(raw.status);
  if (f.status && !STATUS_BUCKETS[f.status]) throw periodError("Filter status tidak dikenal", "REPORT_FILTER_INVALID");
  f.priority = raw.priority == null || raw.priority === "" ? null : Number(raw.priority);
  if (f.priority != null && ![0, 1, 2].includes(f.priority)) throw periodError("Filter prioritas harus 0, 1, atau 2", "REPORT_FILTER_INVALID");
  f.service = str(raw.service);
  if (f.service && !/^[A-Z0-9_]{2,60}$/.test(f.service)) throw periodError("Filter layanan tidak valid", "REPORT_FILTER_INVALID");
  f.qc = str(raw.qc);
  if (f.qc && !QC_FILTERS.includes(f.qc)) throw periodError("Filter QC tidak dikenal", "REPORT_FILTER_INVALID");
  f.docs = str(raw.docs);
  if (f.docs && !DOC_FILTERS.includes(f.docs)) throw periodError("Filter dokumentasi tidak dikenal", "REPORT_FILTER_INVALID");
  return f;
}
export function activeFilterLabels(f, { stationLabel = (c) => c, operatorName = (id) => id, serviceLabel = (c) => c } = {}) {
  const out = [];
  if (f.station) out.push(`Meja: ${stationLabel(f.station)}`);
  if (f.operator) out.push(`PIC: ${operatorName(f.operator)}`);
  if (f.step != null) out.push(`Tahap: ${f.step}`);
  if (f.status) out.push(`Status: ${STATUS_BUCKETS[f.status]}`);
  if (f.priority != null) out.push(`Prioritas: ${f.priority >= 1 ? "Tinggi" : "Normal"}`);
  if (f.service) out.push(`Layanan: ${serviceLabel(f.service)}`);
  if (f.qc) out.push(`QC: ${{ PASS: "Lulus pertama kali", FAIL: "Pernah gagal", BELUM: "Belum QC" }[f.qc]}`);
  if (f.docs) out.push(`Dokumentasi: ${f.docs === "LENGKAP" ? "Lengkap" : "Kurang"}`);
  return out;
}
// Fakta unit -> lolos filter? (semua filter AND). Sama persis untuk dashboard, drill-down, laporan, dan export.
export function matchesFilters(fact, f) {
  if (f.station && fact.stationCode !== f.station) return false;
  if (f.operator && fact.operatorId !== f.operator && fact.cornerOperatorId !== f.operator) return false;
  if (f.step != null && fact.currentStepNo !== f.step) return false;
  if (f.status && fact.statusBucket !== f.status) return false;
  if (f.priority != null && (f.priority >= 1 ? !(fact.priority >= 1) : fact.priority !== 0)) return false; // Tinggi mencakup nilai lama Mendesak (2); Normal = tepat 0 (unit tanpa rencana tidak ikut, seperti semula)
  if (f.service && fact.serviceCode !== f.service) return false;
  if (f.qc === "PASS" && fact.qc.first !== "PASS") return false;
  if (f.qc === "FAIL" && !(fact.qc.fails > 0)) return false;
  if (f.qc === "BELUM" && fact.qc.count > 0) return false;
  if (f.docs === "LENGKAP" && !fact.docs.lengkap) return false;
  if (f.docs === "KURANG" && fact.docs.lengkap) return false;
  return true;
}

// ---------------------------------------------------------------- definisi metrik ----------------------------------------------------------
// kind: count | rate | avg. basis = tanggal yang menentukan keanggotaan periode (atau 'snapshot' = posisi saat laporan dibuat).
export const METRICS = Object.freeze([
  { key: "target_vs_done", group: "Target", label: "Selesai vs target", unit: "unit", kind: "count", basis: "finished",
    formula: "Jumlah unit dengan tanggal selesai produksi dalam periode ÷ (target harian × hari aktif). Hari aktif = hari dalam periode yang punya jadwal atau unit selesai.",
    note: "Target harian = konfigurasi sistem saat ini (belum tersimpan historis)." },
  { key: "units_in", group: "Arus unit", label: "Unit masuk", unit: "unit", kind: "count", basis: "arrived", formula: "Unit yang tiba di workshop (custody diterima Gudang; unit lahir workshop = saat run dibuat) dalam periode." },
  { key: "units_scheduled", group: "Arus unit", label: "Terjadwal", unit: "unit", kind: "count", basis: "planned", formula: "Unit dengan tanggal direncanakan (jadwal meja) dalam periode." },
  { key: "in_progress", group: "Posisi saat ini", label: "Sedang dikerjakan", unit: "unit", kind: "count", basis: "snapshot", formula: "Unit berstatus Sedang dikerjakan: ada operasi AKTIF dan tidak tertunda." },
  { key: "delayed", group: "Posisi saat ini", label: "Tertunda", unit: "unit", kind: "count", basis: "snapshot", formula: "Unit dengan operasi dijeda atau pekerjaan ditunda atau laporan kekurangan bahan yang masih terbuka." },
  { key: "late_open", group: "Posisi saat ini", label: "Terlambat (belum selesai)", unit: "unit", kind: "count", basis: "snapshot", formula: "Unit belum selesai produksi dan waktu sekarang melewati target selesai rencana." },
  { key: "waiting_material", group: "Posisi saat ini", label: "Menunggu bahan", unit: "unit", kind: "count", basis: "snapshot", formula: "Unit dengan kekurangan bahan terbuka, atau permintaan pengambilan bahan belum diserahkan Gudang." },
  { key: "waiting_qc", group: "Posisi saat ini", label: "Menunggu QC", unit: "unit", kind: "count", basis: "snapshot", formula: "Unit pada fase QC (tahap produksi selesai, menunggu keputusan QC)." },
  { key: "waiting_return", group: "Posisi saat ini", label: "Menunggu retur", unit: "unit", kind: "count", basis: "snapshot", formula: "Unit dengan retur sisa bahan yang belum diterima Gudang (menahan penerimaan barang jadi)." },
  { key: "tat_arrival_ready", group: "Kecepatan", label: "Turnaround masuk → siap kirim", unit: "menit", kind: "avg", basis: "ready", formula: "Rata-rata (tanggal siap kirim − tanggal masuk) untuk unit yang siap kirim dalam periode. Nilai per unit tersedia di daftar." },
  { key: "on_time", group: "Kecepatan", label: "Selesai tepat waktu", unit: "%", kind: "rate", basis: "finished", formula: "Unit selesai produksi dalam periode dengan waktu selesai ≤ target selesai rencana ÷ unit selesai yang punya target selesai." },
  { key: "qc_first_pass", group: "Kualitas", label: "Lulus QC pertama kali", unit: "%", kind: "rate", basis: "qc_first", formula: "Unit yang QC pertamanya (selain PENDING) jatuh dalam periode dan hasilnya LULUS ÷ unit yang QC pertamanya jatuh dalam periode." },
  { key: "rework_rate", group: "Kualitas", label: "Tingkat rework", unit: "%", kind: "rate", basis: "qc_first", formula: "Unit dengan minimal satu QC GAGAL (rework) ÷ unit dengan QC pertama dalam periode (kohort yang sama dengan lulus pertama kali)." },
  { key: "doc_completeness", group: "Kualitas", label: "Kelengkapan dokumentasi", unit: "%", kind: "avg", basis: "active", formula: "Rata-rata (foto terpenuhi ÷ foto minimum) per unit aktif dalam periode, memakai matriks dokumentasi kanonis (minimum tiap kategori)." },
  { key: "material_adherence", group: "Bahan", label: "Pemakaian sesuai rencana", unit: "%", kind: "rate", basis: "active", formula: "Baris bahan (unit × bahan) yang pemakaian tercatat ≤ qty rencana ÷ baris bahan yang pemakaiannya tercatat, pada unit aktif dalam periode." },
  { key: "extra_material", group: "Bahan", label: "Unit dengan tambahan bahan", unit: "unit", kind: "count", basis: "active", formula: "Unit aktif dalam periode yang memiliki baris BOM tambahan (rework QC) atau permintaan bahan tambahan." },
  { key: "returns_pending", group: "Bahan", label: "Retur belum diterima", unit: "unit", kind: "count", basis: "snapshot", formula: "Unit dengan retur sisa bahan berstatus PENDING." },
  { key: "waste_units", group: "Bahan", label: "Unit dengan waste", unit: "unit", kind: "count", basis: "active", formula: "Unit aktif dalam periode yang punya pergerakan stok WASTE tertaut unit (jumlah per bahan ada di tabel Gudang)." },
  { key: "attention", group: "Perhatian", label: "Perlu perhatian", unit: "unit", kind: "count", basis: "snapshot", formula: "Unit yang terlambat, tertunda, punya exception rekonsiliasi terbuka, atau retur/barang jadi menunggu lebih lama dari SLA bawaan." },
]);
export const METRIC_BY_KEY = Object.freeze(Object.fromEntries(METRICS.map((m) => [m.key, m])));

const sample = (members) => members.filter((m) => m.counted !== false);
// member: { runId, value?, counted: bool, flag?: string }
function finalize(def, members, extra = {}) {
  const counted = members.filter((m) => m.counted);
  let value = null; let n = 0; let sufficient = true; let reason = null; let denominator = null;
  if (def.kind === "count") { value = counted.length; n = counted.length; }
  else if (def.kind === "rate") {
    n = members.length;
    sufficient = n >= MIN_SAMPLE;
    value = sufficient ? pct(counted.length, members.length) : null;
    denominator = members.length;
  } else {
    const vals = members.filter((m) => m.value != null).map((m) => m.value);
    n = vals.length; sufficient = n >= MIN_SAMPLE; value = sufficient ? round1(mean(vals)) : null; denominator = n;
  }
  if (!sufficient) reason = `Data belum cukup (n=${n}, minimal ${MIN_SAMPLE})`;
  return { key: def.key, label: def.label, group: def.group, unit: def.unit, kind: def.kind, basis: def.basis, snapshot: def.basis === "snapshot", formula: def.formula, note: def.note || null, value, n, denominator, sufficient, reason, members, ...extra };
}

// ---------------------------------------------------------------- perhitungan metrik dari fakta ---------------------------------------------
export function computeMetrics(facts, p, { dailyTarget, now, targetFor = () => dailyTarget }) {
  const out = {};
  const inP = (d) => inPeriod(d, p);
  const m = (key, members, extra) => { out[key] = finalize(METRIC_BY_KEY[key], members, extra); };
  const mk = (f, counted, extra = {}) => ({ runId: f.runId, counted, ...extra });

  const finishedF = facts.filter((f) => inP(f.finishedAt));
  const activeDays = new Set();
  for (const f of facts) { if (keyInPeriod(f.plannedDate, p)) activeDays.add(f.plannedDate); if (f.finishedAt && inP(f.finishedAt)) activeDays.add(wibKey(f.finishedAt)); }
  const dayTargets = [...activeDays].map((d) => targetFor(d));
  const targetTotal = dayTargets.reduce((s, x) => s + x, 0); // jumlah target tiap hari aktif menurut target yang berlaku pada hari itu
  const lo = dayTargets.length ? Math.min(...dayTargets) : dailyTarget; const hi = dayTargets.length ? Math.max(...dayTargets) : dailyTarget;
  m("target_vs_done", finishedF.map((f) => mk(f, true, { value: 1 })), { target: targetTotal, activeDays: activeDays.size, achievementPct: targetTotal > 0 ? pct(finishedF.length, targetTotal) : null, dailyTarget: lo === hi ? lo : null,
    targetDesc: `${lo === hi ? lo : `${lo}–${hi}`}/hari × ${activeDays.size} hari aktif` });
  m("units_in", facts.filter((f) => inP(f.arrivedAt)).map((f) => mk(f, true, { value: 1 })));
  m("units_scheduled", facts.filter((f) => keyInPeriod(f.plannedDate, p)).map((f) => mk(f, true, { value: 1 })));
  m("in_progress", facts.filter((f) => f.statusBucket === "DIKERJAKAN").map((f) => mk(f, true)));
  m("delayed", facts.filter((f) => f.statusBucket === "TERTUNDA").map((f) => mk(f, true, { flag: f.delayReason })));
  m("late_open", facts.filter((f) => f.lateOpen(now)).map((f) => mk(f, true, { value: minutesBetween(f.targetCompleteAt, now) })));
  m("waiting_material", facts.filter((f) => f.waitingMaterial).map((f) => mk(f, true)));
  m("waiting_qc", facts.filter((f) => f.statusBucket === "MENUNGGU_QC").map((f) => mk(f, true)));
  m("waiting_return", facts.filter((f) => f.returns.pending > 0).map((f) => mk(f, true)));
  m("tat_arrival_ready", facts.filter((f) => inP(f.readyAt) && f.arrivedAt).map((f) => mk(f, true, { value: minutesBetween(f.arrivedAt, f.readyAt) })));
  const withTarget = finishedF.filter((f) => f.targetCompleteAt);
  m("on_time", withTarget.map((f) => mk(f, f.finishedAt <= f.targetCompleteAt, { flag: f.finishedAt <= f.targetCompleteAt ? "tepat waktu" : "terlambat", value: minutesBetween(f.targetCompleteAt, f.finishedAt) })));
  const qcF = facts.filter((f) => f.qc.firstAt && inP(f.qc.firstAt));
  m("qc_first_pass", qcF.map((f) => mk(f, f.qc.first === "PASS", { flag: f.qc.first })));
  m("rework_rate", qcF.map((f) => mk(f, f.qc.fails > 0, { value: f.qc.fails })));
  const active = facts.filter((f) => f.activeInPeriod(p));
  m("doc_completeness", active.filter((f) => f.docs.required > 0).map((f) => mk(f, f.docs.lengkap, { value: round1((f.docs.satisfied / f.docs.required) * 100), flag: f.docs.lengkap ? "lengkap" : `kurang ${f.docs.missingTotal}` })));
  const lines = active.flatMap((f) => f.materials.filter((l) => l.used != null).map((l) => ({ f, l })));
  const lineMembers = lines.map(({ f, l }) => ({ runId: f.runId, counted: l.used <= l.planned + 1e-9, value: l.used - l.planned, flag: `${l.code}: pakai ${l.used} / rencana ${l.planned}` }));
  m("material_adherence", lineMembers);
  m("extra_material", active.filter((f) => f.extraMaterial).map((f) => mk(f, true)));
  m("returns_pending", facts.filter((f) => f.returns.pending > 0).map((f) => mk(f, true)));
  m("waste_units", active.filter((f) => f.waste.length > 0).map((f) => mk(f, true, { value: f.waste.reduce((s, w) => s + w.qty, 0) })));
  const att = facts.map((f) => ({ f, reasons: f.attentionReasons(now) })).filter((x) => x.reasons.length);
  m("attention", att.map(({ f, reasons }) => mk(f, true, { flag: reasons.join("; ") })));
  return out;
}

// Daftar anggota metrik -> fakta unik (drill-down). Untuk metrik baris-bahan satu unit bisa muncul beberapa kali -> digabung.
export function drillRows(metric, factsByRun) {
  const by = new Map();
  for (const mem of metric.members) {
    const f = factsByRun.get(mem.runId); if (!f) continue;
    const cur = by.get(mem.runId) || { runId: mem.runId, counted: false, values: [], flags: [] };
    cur.counted = cur.counted || mem.counted; if (mem.value != null) cur.values.push(mem.value); if (mem.flag) cur.flags.push(mem.flag);
    by.set(mem.runId, cur);
  }
  return [...by.values()].map((r) => ({ runId: r.runId, termasuk: r.counted, nilai: r.values.length ? round1(r.values.reduce((s, x) => s + x, 0) / (metric.kind === "avg" || metric.kind === "rate" ? r.values.length : 1)) : null, catatan: [...new Set(r.flags)].join("; ") || null }));
}

// ---------------------------------------------------------------- tren ---------------------------------------------------------------------
export function trendSeries(facts, p, granularity) {
  const keys = bucketsOf(p, granularity);
  const idx = new Map(keys.map((k, i) => [k, i]));
  const mkRow = (k) => ({ bucket: k, masuk: 0, terjadwal: 0, selesai: 0, siapKirim: 0 });
  const rows = keys.map(mkRow);
  const add = (instantOrKey, field, isKey2 = false) => {
    if (!instantOrKey) return; const key = isKey2 ? instantOrKey : wibKey(instantOrKey);
    if (!keyInPeriod(key, p)) return; const i = idx.get(bucketKey(key, granularity)); if (i != null) rows[i][field] += 1;
  };
  for (const f of facts) { add(f.arrivedAt, "masuk"); add(f.plannedDate, "terjadwal", true); add(f.finishedAt, "selesai"); add(f.readyAt, "siapKirim"); }
  return rows;
}

// ---------------------------------------------------------------- Meja ---------------------------------------------------------------------
export function stationReport(facts, p, { stations, capacityPerStation, dailyTarget, now, stationLabel }) {
  const planDays = new Set(facts.filter((f) => keyInPeriod(f.plannedDate, p)).map((f) => f.plannedDate));
  const activeDayCount = planDays.size;
  return stations.map((code) => {
    const mine = facts.filter((f) => f.stationCode === code);
    const scheduled = mine.filter((f) => keyInPeriod(f.plannedDate, p));
    const finished = mine.filter((f) => inPeriod(f.finishedAt, p));
    const durations = finished.filter((f) => f.timing.elapsedMin != null).map((f) => f.timing.elapsedMin);
    const sumT = (sel) => finished.reduce((s, f) => s + (f.timing[sel] || 0), 0);
    const stageAgg = new Map();
    for (const f of mine) for (const s of f.stages) { if (!inPeriod(s.completedAt, p)) continue; const a = stageAgg.get(s.key) || { key: s.key, label: s.label, stepNo: s.stepNo, elapsed: [], pause: 0, blocked: 0 }; a.elapsed.push(s.elapsedMin ?? 0); a.pause += s.pauseMin; a.blocked += s.blockedMin; stageAgg.set(s.key, a); }
    const stages = [...stageAgg.values()].map((a) => ({ key: a.key, label: a.label, stepNo: a.stepNo, n: a.elapsed.length, avgMin: a.elapsed.length ? round1(mean(a.elapsed)) : null, pauseMin: a.pause, blockedMin: a.blocked }));
    const eligible = stages.filter((s) => s.n >= MIN_SAMPLE);
    const bottleneck = eligible.length ? eligible.reduce((a, b) => (b.avgMin > a.avgMin ? b : a)) : null;
    const onTimeBase = finished.filter((f) => f.targetCompleteAt);
    const manualPlans = scheduled.filter((f) => f.stationSequence != null).length;
    const capacityTotal = capacityPerStation * activeDayCount;
    return {
      code, label: stationLabel(code),
      capacityPerDay: capacityPerStation, activeDays: activeDayCount,
      scheduled: scheduled.length, finished: finished.length, open: mine.filter((f) => !f.finishedAt && f.runOpen).length,
      utilizationPct: capacityTotal > 0 ? pct(scheduled.length, capacityTotal) : null,
      avgDurationMin: durations.length >= MIN_SAMPLE ? round1(mean(durations)) : null, durationN: durations.length,
      activeMin: sumT("activeMin"), pauseMin: sumT("pauseMin"), blockedMin: sumT("blockedMin"),
      lateFinished: onTimeBase.filter((f) => f.finishedAt > f.targetCompleteAt).length, lateOpen: mine.filter((f) => f.lateOpen(now)).length, onTimeN: onTimeBase.length,
      manualOrderUnits: manualPlans, manualOrderPct: scheduled.length ? pct(manualPlans, scheduled.length) : null,
      bottleneck: bottleneck ? { label: bottleneck.label, avgMin: bottleneck.avgMin, n: bottleneck.n } : null, stages,
      runIds: { scheduled: scheduled.map((f) => f.runId), finished: finished.map((f) => f.runId) },
    };
  });
}

// ---------------------------------------------------------------- PIC ----------------------------------------------------------------------
export function operatorReport(facts, p, { now }) {
  const roles = [["MEJA", "operatorId", "operatorName", (s) => s.operator === "MEJA"], ["CORNER", "cornerOperatorId", "cornerOperatorName", (s) => s.operator === "CORNER"]];
  const rows = [];
  for (const [role, idKey, nameKey, stageSel] of roles) {
    const byOp = new Map();
    for (const f of facts) { const id = f[idKey]; if (!id) continue; (byOp.get(id) || byOp.set(id, { id, name: f[nameKey] || "—", list: [] }).get(id)).list.push(f); }
    for (const { id, name, list } of byOp.values()) {
      const assigned = list.filter((f) => keyInPeriod(f.plannedDate, p) || inPeriod(f.arrivedAt, p) || inPeriod(f.finishedAt, p));
      const finished = list.filter((f) => inPeriod(f.finishedAt, p));
      const openNow = list.filter((f) => f.runOpen && !f.finishedAt);
      const qc = role === "MEJA" ? list.filter((f) => f.qc.firstAt && inPeriod(f.qc.firstAt, p)) : [];
      const stageAgg = new Map();
      for (const f of list) for (const s of f.stages.filter(stageSel)) { if (!inPeriod(s.completedAt, p)) continue; const a = stageAgg.get(s.key) || { label: s.label, stepNo: s.stepNo, elapsed: [], pause: 0, blocked: 0 }; a.elapsed.push(s.elapsedMin ?? 0); a.pause += s.pauseMin; a.blocked += s.blockedMin; stageAgg.set(s.key, a); }
      const activeDocs = list.filter((f) => f.activeInPeriod(p) && f.docs.required > 0);
      const lateFin = finished.filter((f) => f.targetCompleteAt && f.finishedAt > f.targetCompleteAt).length;
      rows.push({
        id, role, name, assigned: assigned.length, finished: finished.length, active: openNow.filter((f) => f.statusBucket === "DIKERJAKAN").length, open: openNow.length,
        late: lateFin + list.filter((f) => f.lateOpen(now)).length, lateFinished: lateFin, lateOpen: list.filter((f) => f.lateOpen(now)).length,
        pauseMin: [...stageAgg.values()].reduce((s, a) => s + a.pause, 0), blockedMin: [...stageAgg.values()].reduce((s, a) => s + a.blocked, 0),
        stages: [...stageAgg.values()].map((a) => ({ label: a.label, stepNo: a.stepNo, n: a.elapsed.length, avgMin: a.elapsed.length >= MIN_SAMPLE ? round1(mean(a.elapsed)) : null })).sort((x, y) => x.stepNo - y.stepNo),
        qcN: qc.length, firstPassPct: qc.length >= MIN_SAMPLE ? pct(qc.filter((f) => f.qc.first === "PASS").length, qc.length) : null, reworkPct: qc.length >= MIN_SAMPLE ? pct(qc.filter((f) => f.qc.fails > 0).length, qc.length) : null,
        docN: activeDocs.length, docPct: activeDocs.length >= MIN_SAMPLE ? round1(mean(activeDocs.map((f) => (f.docs.satisfied / f.docs.required) * 100))) : null,
        runIds: { assigned: assigned.map((f) => f.runId), finished: finished.map((f) => f.runId) },
      });
    }
  }
  // Urutan nama (BUKAN skor): laporan ini sengaja tidak meranking PIC — volume & periode ditampilkan sebagai konteks.
  return rows.sort((a, b) => a.name.localeCompare(b.name, "id") || a.role.localeCompare(b.role));
}

// ---------------------------------------------------------------- Gudang -------------------------------------------------------------------
export function warehouseReport(w, p, { now }) {
  const inP = (d) => inPeriod(d, p);
  const issues = w.issues.filter((i) => inP(i.createdAt));
  const issued = issues.filter((i) => i.issuedAt);
  const resp = issued.map((i) => i.responseMin).filter((x) => x != null).sort((a, b) => a - b);
  const open = w.issues.filter((i) => !i.issuedAt && i.status !== "CANCELLED");
  const overSla = issued.filter((i) => i.responseMin > SLA.materialResponseMin);
  const causes = new Map();
  for (const i of [...overSla, ...open.filter((o) => minutesBetween(o.createdAt, now) > SLA.materialResponseMin)]) causes.set(i.cause, (causes.get(i.cause) || 0) + 1);
  const returns = w.returns.filter((r) => inP(r.requestedAt));
  const retPending = w.returns.filter((r) => r.status === "PENDING");
  const retPartial = returns.filter((r) => r.status === "RECEIVED" && r.receivedQty != null && r.receivedQty < r.qty - 1e-9);
  const retDone = returns.filter((r) => r.status === "RECEIVED" && !(r.receivedQty != null && r.receivedQty < r.qty - 1e-9));
  const retTimes = returns.filter((r) => r.receivedAt).map((r) => minutesBetween(r.requestedAt, r.receivedAt));
  const shortages = w.shortages.filter((s) => inP(s.reportedAt));
  const shortTimes = shortages.filter((s) => s.resolvedAt).map((s) => minutesBetween(s.reportedAt, s.resolvedAt));
  const fgOffered = w.finishedGoods.filter((g) => g.status === "OFFERED");
  const fgAccepted = w.finishedGoods.filter((g) => g.status === "ACCEPTED" && inP(g.acceptedAt));
  const fgTimes = fgAccepted.map((g) => minutesBetween(g.offeredAt, g.acceptedAt));
  const stat = (arr) => ({ n: arr.length, avgMin: arr.length >= MIN_SAMPLE ? round1(mean(arr)) : null, medianMin: arr.length >= MIN_SAMPLE ? percentile([...arr].sort((a, b) => a - b), 0.5) : null, p90Min: arr.length >= MIN_SAMPLE ? percentile([...arr].sort((a, b) => a - b), 0.9) : null, sufficient: arr.length >= MIN_SAMPLE });
  const wasteBy = new Map();
  for (const m of w.waste.filter((x) => inP(x.at))) { const a = wasteBy.get(m.materialId) || { code: m.code, name: m.name, uom: m.uom, qty: 0, units: new Set(), movements: 0 }; a.qty += m.qty; a.units.add(m.runId); a.movements += 1; wasteBy.set(m.materialId, a); }
  return {
    request: { requested: issues.length, issued: issued.length, openNow: open.length, oldestOpenMin: open.length ? Math.max(...open.map((o) => minutesBetween(o.createdAt, now))) : null, response: stat(resp),
      withinSlaPct: issued.length >= MIN_SAMPLE ? pct(issued.length - overSla.length, issued.length) : null, slaMin: SLA.materialResponseMin, supplemental: issues.filter((i) => i.supplemental).length },
    delayCauses: [...causes.entries()].map(([cause, count]) => ({ cause, count })).sort((a, b) => b.count - a.count),
    returns: { pending: retPending.length, partial: retPartial.length, done: retDone.length, total: returns.length, receive: stat(retTimes), slaMin: SLA.returnReceiveMin, oldestPendingMin: retPending.length ? Math.max(...retPending.map((r) => minutesBetween(r.requestedAt, now))) : null },
    shortages: { reported: shortages.length, openNow: w.shortages.filter((s) => s.status === "OPEN").length, resolve: stat(shortTimes) },
    finishedGoods: { waiting: fgOffered.length, oldestWaitingMin: fgOffered.length ? Math.max(...fgOffered.map((g) => minutesBetween(g.offeredAt, now))) : null, accepted: fgAccepted.length, accept: stat(fgTimes), slaMin: SLA.finishedGoodsAcceptMin },
    waste: [...wasteBy.values()].map((a) => ({ code: a.code, name: a.name, uom: a.uom, qty: Math.round(a.qty * 10000) / 10000, units: a.units.size, movements: a.movements })).sort((a, b) => a.code.localeCompare(b.code)),
    runIds: {
      requested: [...new Set(issues.map((i) => i.runId))], openIssues: [...new Set(open.map((i) => i.runId))], overSla: [...new Set(overSla.map((i) => i.runId))],
      returnsPending: [...new Set(retPending.map((r) => r.runId))], returnsPartial: [...new Set(retPartial.map((r) => r.runId))], returnsDone: [...new Set(retDone.map((r) => r.runId))],
      shortages: [...new Set(shortages.map((s) => s.runId))], fgWaiting: [...new Set(fgOffered.map((g) => g.runId))],
      waste: [...new Set(w.waste.filter((x) => inP(x.at)).map((x) => x.runId))],
    },
  };
}

// ---------------------------------------------------------------- fakta unit -----------------------------------------------------------------
// Satu objek datar per Production Run V2. Diisi service pembaca dari data kanonis; metode di bawah adalah SATU-SATUNYA definisi
// "terlambat", "aktif dalam periode", dan "perlu perhatian" (dipakai ulang oleh semua laporan).
export function makeFact(raw) {
  const f = {
    runOpen: true, phase: null, openException: false, waitingMaterial: false, delayReason: null, currentStepNo: null, stationSequence: null,
    qc: { count: 0, first: null, firstAt: null, fails: 0 }, docs: { required: 0, satisfied: 0, missingTotal: 0, lengkap: false },
    materials: [], extraMaterial: false, waste: [], returns: { pending: 0, oldestPendingAt: null }, fgOfferedAt: null,
    timing: { activeMin: 0, pauseMin: 0, blockedMin: 0, elapsedMin: null }, stages: [], ...raw,
  };
  f.lateOpen = (now) => !!(f.runOpen && !f.finishedAt && f.targetCompleteAt && f.phase !== "HANDOFF" && new Date(f.targetCompleteAt).getTime() < now.getTime());
  f.activeInPeriod = (p) => keyInPeriod(f.plannedDate, p) || inPeriod(f.arrivedAt, p) || inPeriod(f.startedAt, p) || inPeriod(f.finishedAt, p) || inPeriod(f.readyAt, p);
  f.attentionReasons = (now) => {
    const r = [];
    if (f.lateOpen(now)) r.push("terlambat");
    if (f.statusBucket === "TERTUNDA") r.push(`tertunda${f.delayReason ? ` (${f.delayReason})` : ""}`);
    if (f.openException) r.push("exception rekonsiliasi terbuka");
    if (f.returns.oldestPendingAt && minutesBetween(f.returns.oldestPendingAt, now) > SLA.returnReceiveMin) r.push("retur melewati SLA");
    if (f.fgOfferedAt && !f.readyAt && minutesBetween(f.fgOfferedAt, now) > SLA.finishedGoodsAcceptMin) r.push("barang jadi menunggu melewati SLA");
    return r;
  };
  return f;
}

// Status mutually-exclusive untuk filter/kolom status (urutan prioritas = urutan pemeriksaan).
export function statusBucketOf({ readyAt, finishedAt, runStatus, opStatus, openShortage, phase, plannedDate, startedAt }) {
  if (readyAt) return "SIAP_KIRIM";
  if (finishedAt) return "MENUNGGU_GUDANG";
  if (runStatus === "PENDING_ARRIVAL") return "DALAM_PERJALANAN";
  if (openShortage || opStatus === "PAUSED" || opStatus === "BLOCKED" || runStatus === "BLOCKED") return "TERTUNDA";
  if (phase === "QC") return "MENUNGGU_QC";
  if (opStatus === "ACTIVE") return "DIKERJAKAN";
  if (plannedDate) return startedAt ? "DIKERJAKAN" : "TERJADWAL";
  return "MASUK";
}
