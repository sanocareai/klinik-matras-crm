// P9 UX Realignment — adaptor MURNI untuk halaman Ringkasan: dua sumber (Command Center V2, atau V1 bila Production V2
// belum aktif) diterjemahkan ke SATU bentuk ringkasan { tiles, pipeline, attention, pic } yang dirender sama persis.
// Tidak ada KPI baru dihitung di sini — setiap angka adalah angka server apa adanya (atau jumlah item kolom yang sama).

const STATUS = "/bengkel/production-v2";
const QC = null; // halaman QC disembunyikan sementara (slice 1): angka tetap tampil, tanpa tautan
const countOf = (columns, key) => columns?.find((c) => c.key === key)?.count ?? 0;

export function summaryFromV2(cc) {
  const k = cc.kpi || {};
  const unitIdByRun = new Map();
  for (const col of cc.columns || []) for (const it of col.items || []) if (it.runId && it.unit?.id) unitIdByRun.set(it.runId, it.unit.id);
  return {
    source: "V2",
    tiles: [
      { key: "target", label: "Target hari ini", value: k.target ?? 0, tone: "neutral", to: "/bengkel/rencana-produksi" },
      { key: "done", label: "Selesai hari ini", value: k.selesaiHariIni ?? 0, of: k.target ?? 0, tone: "green" },
      { key: "active", label: "Sedang dikerjakan", value: k.sedangDikerjakan ?? 0, tone: "neutral", to: STATUS },
      { key: "queue", label: "Antre (tiba, belum mulai)", value: countOf(cc.columns, "TIBA_BELUM_MULAI"), tone: "neutral", to: STATUS },
      { key: "late", label: "Terlambat", value: k.terlambat ?? 0, tone: k.terlambat > 0 ? "red" : "neutral", to: STATUS },
      { key: "material", label: "Menunggu bahan", value: k.menungguBahan ?? 0, tone: k.menungguBahan > 0 ? "red" : "neutral", to: STATUS },
      { key: "qc", label: "Menunggu QC", value: k.menungguQc ?? 0, tone: k.menungguQc > 0 ? "orange" : "neutral", to: QC },
    ],
    pipeline: (cc.columns || []).map((c) => ({ key: c.key, label: c.label, count: c.count ?? c.items?.length ?? 0 })),
    attention: (cc.attention || []).map((a) => ({
      severity: a.severity, code: a.code, text: a.text, unitCode: a.unitCode, orderNumber: a.orderNumber,
      to: unitIdByRun.get(a.runId) ? `${STATUS}?unit=${unitIdByRun.get(a.runId)}` : null,
    })),
    pic: cc.picActivity || [],
  };
}

export function summaryFromV1(v1) {
  const s = v1.summary || {}, f = v1.flow || {};
  const tracked = (s.unitsWithDueDate || 0) > 0;
  return {
    source: "V1",
    tiles: [
      { key: "target", label: "Target hari ini", value: s.targetToday ?? 0, tone: "neutral" },
      { key: "done", label: "Selesai hari ini", value: s.completedToday ?? 0, of: s.targetToday ?? 0, tone: "green" },
      { key: "active", label: "Sedang dikerjakan", value: s.inProgress ?? 0, tone: "neutral" },
      { key: "queue", label: "Antre", value: f.queued ?? 0, tone: "neutral" },
      { key: "late", label: "Terlambat", value: tracked ? (s.overdue ?? 0) : "—", tone: tracked && s.overdue > 0 ? "red" : "neutral" },
      { key: "material", label: "Pekerjaan tertunda", value: s.blocked ?? 0, tone: s.blocked > 0 ? "red" : "neutral" },
      { key: "qc", label: "Menunggu QC", value: f.waitingQc ?? 0, tone: f.waitingQc > 0 ? "orange" : "neutral", to: QC },
    ],
    pipeline: [],
    attention: (v1.exceptions || []).map((e) => ({
      severity: /BLOCK|OVERDUE/i.test(e.type || "") ? "critical" : "warning", code: e.type, text: `${e.unitCode}: ${e.reason}`, unitCode: e.unitCode, orderNumber: e.orderNumber || null, to: e.href || null,
    })),
    pic: [],
  };
}
