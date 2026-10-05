// Simulasi seret-lepas untuk MODE DEMO — logika MURNI, tanpa jaringan, tanpa efek samping. Hanya mengubah SALINAN papan/Command Center di memori
// (state React halaman); dimuat ulang / keluar Mode Demo = dataset awal kembali. Keputusan drop (decideDrop) SAMA dengan mode nyata; bedanya
// hanya di sini perubahan diterapkan ke memori, bukan lewat command server.
const clone = (x) => (typeof structuredClone === "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

const viewsOf = (board, cc) => [
  ...(board?.stations || []).flatMap((s) => s.items || []),
  ...(cc?.columns || []).flatMap((c) => c.items || []),
];

function patchPlan(board, cc, planId, patch) {
  for (const v of viewsOf(board, cc)) if (v?.plan?.id === planId) Object.assign(v.plan, patch);
}
function removeFromStations(board, planId) {
  let removed = null;
  for (const s of board.stations || []) {
    const i = (s.items || []).findIndex((v) => v?.plan?.id === planId);
    if (i >= 0) { [removed] = s.items.splice(i, 1); }
    s.count = (s.items || []).length;
  }
  return removed;
}
function setSequences(board, cc, stationCode, orderedIds) {
  orderedIds.forEach((id, i) => patchPlan(board, cc, id, { stationSequence: i + 1 }));
  const st = (board.stations || []).find((s) => s.code === stationCode);
  if (st) st.items.sort((a, b) => (a.plan.stationSequence ?? 999) - (b.plan.stationSequence ?? 999));
}

/**
 * simulateDrop({ board, cc, view, decision, date }) -> { board, cc, message }
 * decision: hasil decideDrop (place | reorder | unschedule | moveDate). Selain itu: tanpa perubahan.
 */
export function simulateDrop({ board, cc, view, decision, date }) {
  const b = clone(board); const c = clone(cc);
  const planId = view?.plan?.id;
  if (!b || !c || !planId || !decision) return { board, cc, message: "" };
  const code = view.unit?.unitCode;
  const labelOf = (stationCode) => (b.stations || []).find((s) => s.code === stationCode)?.label || stationCode;
  const bumpPlanned = (d) => { if (b.kpi) b.kpi.planned = Math.max(0, (b.kpi.planned ?? 0) + d); };

  switch (decision.type) {
    case "unschedule": {
      if (removeFromStations(b, planId)) bumpPlanned(-1);
      patchPlan(b, c, planId, { stationCode: null, stationLabel: null, productionDate: null, stationSequence: null });
      return { board: b, cc: c, message: `${code} dikembalikan ke Belum Dijadwalkan` };
    }
    case "reorder": {
      setSequences(b, c, decision.stationCode, decision.orderedIds);
      return { board: b, cc: c, message: `Urutan ${labelOf(decision.stationCode)} diperbarui` };
    }
    case "place": {
      const moved = removeFromStations(b, planId) || clone(viewsOf(b, c).find((v) => v?.plan?.id === planId) || view);
      const wasPlanned = !!moved?.plan?.stationCode;
      patchPlan(b, c, planId, { stationCode: decision.stationCode, stationLabel: labelOf(decision.stationCode), productionDate: date });
      const st = (b.stations || []).find((s) => s.code === decision.stationCode);
      if (st) {
        const item = clone(moved); item.plan = { ...item.plan, stationCode: decision.stationCode, stationLabel: st.label, productionDate: date };
        st.items.push(item); st.count = st.items.length;
      }
      if (!wasPlanned) bumpPlanned(1);
      setSequences(b, c, decision.stationCode, decision.orderedIds);
      return { board: b, cc: c, message: `${code} dijadwalkan ke ${labelOf(decision.stationCode)}` };
    }
    case "moveDate": {
      if (removeFromStations(b, planId)) bumpPlanned(-1); // papan ini untuk `date`; unit pindah ke tanggal lain
      patchPlan(b, c, planId, { productionDate: decision.date });
      return { board: b, cc: c, message: `${code} dipindah ke tanggal ${decision.date}` };
    }
    default:
      return { board, cc, message: "" };
  }
}
