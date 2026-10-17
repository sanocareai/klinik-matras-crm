// "ADMIN OVERRIDE: SIAP KIRIM SAAT PENCATATAN PRODUKSI BELUM SELESAI" — penanda JUJUR untuk Route Planner / Delivery Control / aplikasi Driver (16 Okt 2026, kasus RES-03102026-018-U1).
// Unit yang ditetapkan Admin/Owner siap untuk proses pengiriman sementara Production Run masih berjalan. Itu keputusan Admin, BUKAN hasil pemeriksaan/QC: layar hanya boleh menampilkan
// "override Admin", lokasi pengambilan, dan bahwa Run belum ditutup — tidak pernah klaim pemeriksaan fisik atau QC. Murni BACA; sumber = production_runs_v2.delivery_released_at/delivery_release.
export const LABEL_OVERRIDE_ADMIN = "Siap Kirim — override Admin (pencatatan produksi belum selesai)";

// unitIds -> Map<unitId, { unitCode, pickupLocationCode, decidedAt, decidedByName, reason, runStatus }> untuk Run yang dilepas lewat override.
export async function bacaOverrideAdmin(db, unitIds) {
  const ids = [...new Set((unitIds ?? []).filter(Boolean))];
  const hasil = new Map();
  if (ids.length === 0) return hasil;
  const runs = await db.productionRun.findMany({
    where: { unitId: { in: ids }, deliveryReleasedAt: { not: null } },
    orderBy: { deliveryReleasedAt: "desc" },
    select: { unitId: true, status: true, deliveryReleasedAt: true, deliveryRelease: true, unit: { select: { unitCode: true, storageLocation: true } } },
  });
  for (const r of runs) {
    if (hasil.has(r.unitId)) continue;
    const rel = r.deliveryRelease ?? {};
    hasil.set(r.unitId, {
      unitId: r.unitId, unitCode: r.unit?.unitCode ?? rel.unit?.code ?? null,
      // Lokasi pengambilan yang BENAR = lokasi unit sekarang (bisa dipindah Gudang sesudah override); lokasi saat override tetap di rekam.
      pickupLocationCode: r.unit?.storageLocation ?? rel.pickupLocation?.code ?? null, pickupLocationAtDecision: rel.pickupLocation?.code ?? null,
      decidedAt: r.deliveryReleasedAt, decidedByName: rel.decidedBy?.name ?? null, reason: rel.reason ?? null, runStatus: r.status,
    });
  }
  return hasil;
}

/** Tempel `overrideAdmin` (daftar unit ber-override pada job DELIVERY itu, kosong bila tidak ada) + `labelOverrideAdmin` pada tiap job (mutasi in-place, mengembalikan array yang sama). */
export async function tandaiJobOverrideAdmin(db, jobs) {
  const list = (jobs ?? []).filter((j) => j && j.id);
  if (list.length === 0) return jobs;
  // FAIL-SOFT: penanda hanya PENGAYAAN tampilan. Kegagalan membacanya (DB/skema) tidak boleh mematikan daftar job Route Planner/Driver — job tampil seperti biasa (status unit tetap benar) dan galat dicatat.
  try {
    const baris = await db.jobUnit.findMany({ where: { jobId: { in: list.map((j) => j.id) }, job: { type: "DELIVERY" } }, select: { jobId: true, unitId: true } });
    const peta = await bacaOverrideAdmin(db, baris.map((b) => b.unitId));
    const perJob = new Map();
    for (const b of baris) {
      const o = peta.get(b.unitId); if (!o) continue;
      if (!perJob.has(b.jobId)) perJob.set(b.jobId, []);
      perJob.get(b.jobId).push(o);
    }
    for (const j of list) {
      const o = perJob.get(j.id) ?? [];
      j.overrideAdmin = o;
      j.labelOverrideAdmin = o.length ? LABEL_OVERRIDE_ADMIN : null;
    }
  } catch (err) {
    console.error("[override-admin] penanda tidak terbaca (job tetap tampil tanpa penanda):", err?.message || err);
    for (const j of list) { j.overrideAdmin = []; j.labelOverrideAdmin = null; }
  }
  return jobs;
}
