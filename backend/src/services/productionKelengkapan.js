// KELENGKAPAN ORDER PRODUKSI — pemuatan fakta (BULK, baca-saja) + penempelan klasifikasi ke baris unit. Aturan klasifikasi ada di lib/domain/kelengkapanOrderProduksi.js (murni).
//
// Dipakai SAMA oleh daftar Order Produksi, drawer unit, filter/hitungan, dan ekspor Excel (semua lewat perkayaBarisUnit → adopsi.kelengkapan), jadi tidak ada klasifikasi kedua yang bisa menyimpang.
// Layanan ini TIDAK menulis apa pun: membuka daftar/drawer/filter tidak mengubah status bisnis. Keadaan catatan historis memakai keadaan EFEKTIF yang sama dengan drawer (terapkanKeadaanEfektif).
import { terapkanKeadaanEfektif } from "./catatanPemakaianHistoris.js";
import { klasifikasiKelengkapan, uraikanAlasanCatatan } from "../lib/domain/kelengkapanOrderProduksi.js";
import { TIPE_OP } from "./finance/hargaBerlaku.js";

const kosong = () => ({
  catatan: { ada: 0, perluDicek: 0, siapPosting: 0, flagsPerluDicek: [] },
  sementara: { perluTerpetakan: 0, perluBelumTerpetakan: 0 },
  hpp: { gerak: 0, hargaBelumDiketahui: 0, perluPenerapan: 0, gagal: 0 },
  pernyataan: null,
});

/**
 * Fakta kelengkapan per unit (Map unitId → fakta). Empat query bulk, tidak bertambah per unit.
 * `hargaBelumDiketahui` / `perluPenerapan`: pergerakan TANPA pembekuan bernilai (belum dibekukan atau dibekukan tanpa harga) dipisah menurut ada-tidaknya harga berlaku bahan PADA waktu pemakaian
 * (baris harga_berlaku dengan effective_from ≤ waktu pergerakan). Pergerakan DINILAI tidak dihitung; GAGAL_PEMBEKUAN dihitung sendiri.
 */
export async function muatFaktaKelengkapan(db, unitIds) {
  const peta = new Map();
  if (!unitIds?.length) return peta;
  for (const id of unitIds) peta.set(id, kosong());
  const [notes, sementara, hppRows, pernyataan] = await Promise.all([
    db.unitUsageNote.findMany({ where: { unitId: { in: unitIds } }, select: { id: true, unitId: true, state: true, origin: true, flags: true } }),
    db.unitProvisionalUsage.findMany({ where: { unitId: { in: unitIds }, status: "PERLU_REKONSILIASI" }, select: { unitId: true, materialId: true } }),
    db.$queryRawUnsafe(`
      with m as (
        select s.id, s.unit_id, s.material_id, s.created_at,
               (select o.status from stock_movement_biaya_operasional o where o.movement_id = s.id order by o.created_at desc, o.id desc limit 1) st,
               exists (select 1 from material_harga_berlaku h where h.material_id = s.material_id and h.effective_from <= s.created_at) ada_harga
        from stock_movements s where s.unit_id = any($1::uuid[]) and s.type::text = any($2::text[])
      )
      select unit_id::text unit_id, count(*)::int gerak,
             count(*) filter (where st = 'GAGAL_PEMBEKUAN')::int gagal,
             count(*) filter (where (st is null or st = 'TANPA_HARGA') and not ada_harga)::int harga_belum_diketahui,
             count(*) filter (where (st is null or st = 'TANPA_HARGA') and ada_harga)::int perlu_penerapan
      from m group by unit_id`, unitIds, TIPE_OP),
    db.unitMaterialDeclaration.findMany({ where: { unitId: { in: unitIds }, status: "ACTIVE" }, select: { id: true, unitId: true, reason: true, declaredAt: true, declaredById: true } }),
  ]);
  const efektif = await terapkanKeadaanEfektif(db, notes);
  for (const r of efektif) {
    const f = peta.get(r.unitId); if (!f) continue;
    if (r.state !== "TIDAK_DIHITUNG") f.catatan.ada += 1;
    if (r.state === "PERLU_DICEK") { f.catatan.perluDicek += 1; f.catatan.flagsPerluDicek.push(Array.isArray(r.flags) ? r.flags : []); }
    if (r.state === "SIAP_POSTING") f.catatan.siapPosting += 1;
  }
  for (const r of sementara) { const f = peta.get(r.unitId); if (!f) continue; if (r.materialId) f.sementara.perluTerpetakan += 1; else f.sementara.perluBelumTerpetakan += 1; }
  for (const r of hppRows) {
    const f = peta.get(r.unit_id); if (!f) continue;
    f.hpp = { gerak: r.gerak, hargaBelumDiketahui: r.harga_belum_diketahui, perluPenerapan: r.perlu_penerapan, gagal: r.gagal };
  }
  const pelakuIds = [...new Set(pernyataan.map((p) => p.declaredById).filter(Boolean))];
  const nama = pelakuIds.length ? new Map((await db.user.findMany({ where: { id: { in: pelakuIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map();
  for (const p of pernyataan) { const f = peta.get(p.unitId); if (f) f.pernyataan = { id: p.id, alasan: p.reason, oleh: nama.get(p.declaredById) ?? null, at: p.declaredAt }; }
  return peta;
}

/** Klasifikasi untuk satu baris yang SUDAH diperkaya (butuh status kerja efektif, pemakaian, dan rujukan PKR dari perkayaBarisUnit). */
export function kelengkapanBaris(baris, fakta) {
  const f = fakta ?? kosong();
  const p = baris.adopsi?.pemakaianBahan ?? {};
  return klasifikasiKelengkapan({
    unitStatus: baris.status, kerjaKey: baris.adopsi?.kerja?.key,
    pemakaian: { baru: p.baruCatatan, lama: p.komponenLamaDipakaiKembali, sementaraPerlu: p.sementaraPerluRekonsiliasi, sementaraSelesai: p.sementaraSudahDirekonsiliasi },
    sementara: f.sementara,
    catatan: { ada: f.catatan.ada, perluDicek: f.catatan.perluDicek, siapPosting: f.catatan.siapPosting, alasan: uraikanAlasanCatatan(f.catatan.flagsPerluDicek) },
    hpp: f.hpp, pernyataan: f.pernyataan,
    pkr: baris.penjualanKaryawan ? { nomor: baris.penjualanKaryawan.nomor, lengkap: baris.penjualanKaryawan.lengkap, kurang: baris.penjualanKaryawan.kurang } : null,
  });
}
