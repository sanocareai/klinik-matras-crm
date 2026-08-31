// Progres target TIM (8 sales + team lead jika ada) — SATU sumber kebenaran,
// dipakai SalesReportTab.jsx (kartu "Target Tim") dan RingkasanTab.jsx (kartu
// "Target Bulanan"). Sebelumnya diturunkan inline di SalesReportTab.jsx saja;
// diekstrak (26 Agustus 2026) supaya kalau angkanya perlu berubah, cukup
// diubah di SATU tempat — dua turunan independen dari data yang sama itu
// persis kelas bug yang berulang kali muncul & diperbaiki sepanjang sesi ini
// (conversion rate, gap Total Percakapan vs Ditangani, dst).
//
// Target TIM Novi (team lead) = closing pribadinya + closing 8 sales (total
// tim) dibagi target tim miliknya — BUKAN cuma closing pribadinya sendirian
// (yang akan selalu jauh dari target, karena memang bukan dia yang closing
// semuanya). Kalau BELUM ada team lead diset, jatuh ke jumlah target 8 sales.
export function computeTeamTarget(report) {
  const rows = report?.rows || [];
  const total = report?.total;

  const teamLeadRows = rows
    .filter((r) => r.isTeamLead)
    .map((r) => {
      const teamGrossValue = r.grossValue + (total?.grossValue || 0);
      return {
        ...r,
        teamGrossValue,
        teamPercentToTarget: r.target > 0 ? Math.round((teamGrossValue / r.target) * 100) : null,
      };
    });
  const teamLead = teamLeadRows[0] || null;

  const teamGrossAll = (total?.grossValue || 0) + teamLeadRows.reduce((s, r) => s + r.grossValue, 0);
  const teamOrdersAll = (total?.orders || 0) + teamLeadRows.reduce((s, r) => s + r.orders, 0);
  const teamAovAll = teamOrdersAll > 0 ? Math.round(teamGrossAll / teamOrdersAll) : 0;
  // teamCollectedAll (30 Agustus 2026) — sama pola dengan teamGrossAll,
  // tapi basis KOMISI: nilai yang sudah lunas (Order.paidAt) sampai batas
  // periode, bukan sekadar closing/reach. Lihat catatan panjang di
  // routes/analytics.js #computeSalesRow.
  const teamCollectedAll = (total?.collectedValue || 0) + teamLeadRows.reduce((s, r) => s + (r.collectedValue || 0), 0);

  return {
    teamLeadRows, teamLead, teamGrossAll, teamOrdersAll, teamAovAll, teamCollectedAll,
    percentToTarget: (teamLead ? teamLead.teamPercentToTarget : total?.percentToTarget) ?? null,
    targetValue: (teamLead ? teamLead.target : total?.target) || 0,
  };
}
