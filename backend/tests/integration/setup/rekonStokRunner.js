// Runner penyesuaian stok hasil rekonsiliasi (Okt 2026) — DEFAULT DRY-RUN.
//
// Memakai HANYA jalur resmi lewat HTTP: POST /api/inventory/adjustments → PATCH status → POST /:id/post.
// TIDAK menulis stock_movements langsung, TIDAK menyentuh jurnal.
//
// Idempotensi: tiap butir rencana punya `key` (mis. REKON-STOK-2026-10:<kodeMaterial>). Key disisipkan di awal `reason`.
// Sebelum membuat request baru, runner membaca daftar adjustment dan MELEWATI butir yang key-nya sudah ada pada request
// berstatus apa pun selain CANCELLED. Jadi menjalankan ulang tidak menggandakan request maupun movement.
//
// Delta dihitung terhadap saldo ledger PADA TANGGAL HITUNG (ledgerT), bukan saldo hari ini — lihat Rekonsiliasi-Stok…xlsx.
// Pemisahan tugas: PEMOHON mengajukan (DRAFT→WAITING_APPROVAL) dan memposting; PENYETUJU (orang lain, INVENTORY_ADJUSTMENT_APPROVE) hanya menyetujui.
export async function jalankanRekon({ plan, pemohon, penyetuju, pemosting = pemohon, apply = false }) {
  const hasil = { dryRun: !apply, dibuat: [], dilewati: [], ditolak: [], diposting: [] };
  const daftar = await pemohon.get("/api/inventory/adjustments");
  if (daftar.status !== 200) throw new Error("gagal membaca daftar adjustment: " + daftar.status);
  const sudah = (daftar.body.requests || []).filter((r) => r.status !== "CANCELLED");
  for (const item of plan) {
    if (!item.key || !item.materialId) { hasil.ditolak.push({ key: item.key, alasan: "key/materialId wajib" }); continue; }
    if (!Number.isFinite(item.delta) || item.delta === 0) { hasil.dilewati.push({ key: item.key, alasan: "delta nol" }); continue; }
    const ada = sudah.find((r) => String(r.reason || "").startsWith(item.key));
    if (ada) { hasil.dilewati.push({ key: item.key, alasan: `sudah ada ${ada.adjustmentNumber} (${ada.status})` }); continue; }
    if (!apply) { hasil.dibuat.push({ key: item.key, delta: item.delta, dryRun: true }); continue; }
    const c = await pemohon.post("/api/inventory/adjustments", {
      materialId: item.materialId, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: item.delta, reason: `${item.key} ${item.reason || ""}`.trim(),
    });
    if (c.status !== 201) { hasil.ditolak.push({ key: item.key, alasan: `buat: ${c.status} ${c.body?.error}` }); continue; }
    const id = c.body.id;
    const s1 = await pemohon.patch(`/api/inventory/adjustments/${id}`, { status: "WAITING_APPROVAL" });
    const s2 = s1.status === 200 ? await penyetuju.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" }) : s1;
    if (s2.status !== 200) { hasil.ditolak.push({ key: item.key, alasan: `setuju: ${s2.status} ${s2.body?.error}`, id }); continue; }
    const p = await pemosting.post(`/api/inventory/adjustments/${id}/post`, {});
    if (p.status !== 200) { hasil.ditolak.push({ key: item.key, alasan: `post: ${p.status} ${p.body?.error}`, id }); continue; }
    hasil.dibuat.push({ key: item.key, id, delta: item.delta });
    hasil.diposting.push(id);
    sudah.push(p.body);
  }
  return hasil;
}
