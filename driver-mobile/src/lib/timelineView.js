// Histori Waktu rute & stop (fase 2, 7 Okt 2026) — murni (tanpa React Native), diuji `node --test`.
// Server menyusun label/WIB/durasi (GET /armada/routes/:id/timeline); aplikasi hanya memilih penanda tampilan. TIDAK menghitung durasi, TIDAK mengisi waktu
// yang tidak ada: tonggak tanpa bukti waktu tampil "Tidak tersedia".

// Penanda untuk satu tonggak: urutan tetap supaya tampilan konsisten.
export function eventBadges(event) {
  const out = [];
  if (event?.lateSync) out.push({ key: "late", label: "Sinkron terlambat", tone: "warn" });
  if (event?.suspect) out.push({ key: "clock", label: "Jam perangkat janggal", tone: "danger" });
  if (event?.effectiveSource === "KOREKSI") out.push({ key: "fix", label: "Dikoreksi", tone: "info" });
  return out;
}

// Baris ringkas durasi per stop: hanya yang ada (angka) atau catatan alasan tidak dihitung; kosong bila keduanya tidak ada.
export function durationLine(stop) {
  const parts = [
    stop?.travelDurationText ? `Perjalanan: ${stop.travelDurationText}` : stop?.travelDurationNote || null,
    stop?.serviceDurationText ? `Layanan: ${stop.serviceDurationText}` : stop?.serviceDurationNote || null,
  ].filter(Boolean);
  return parts.join(" · ");
}

// Daftar baris tampilan satu stop: tonggak bertanda waktu + tonggak yang seharusnya ada tetapi tanpa bukti ("Tidak tersedia").
export function stopRows(stop) {
  const rows = (stop?.events || []).map((e) => ({
    key: e.id || `${e.action}-${e.at}`, label: e.label, atText: e.atText, meta: [e.actorName ? `oleh ${e.actorName}` : null, e.sourceLabel].filter(Boolean).join(" · "),
    receivedText: e.receivedText && e.receivedText !== e.atText ? `diterima server ${e.receivedText}` : null, detail: e.detail || null, badges: eventBadges(e),
    corrections: (e.corrections || []).map((c) => `Koreksi oleh ${c.actorName || "—"}: ${c.fromText || "—"} → ${c.toText}. Alasan: ${c.reason}`),
  }));
  const missing = (stop?.missing || []).map((m) => ({ key: `missing-${m.action}`, label: m.label, atText: m.atText, meta: "", receivedText: null, detail: null, badges: [], corrections: [], missing: true }));
  return [...rows, ...missing];
}
