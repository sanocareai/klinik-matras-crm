// NILAI TAGIHAN KANONIS per order dan per Resi — SATU tempat, dipakai status bayar CRM, antrean Finance, klaim/tolak Lunas, sisa tagihan,
// dan validasi over-alokasi (Resi Gabungan Fase 3A hardening, 28 Sep 2026).
//
//   tagihanOrder   = Order.value + ongkir yang DITAGIH lewat order ini.
//                    Order dalam Resi BARU: Ongkir Tambahan hanya dihitung di order ANCHOR (tepat sekali per Resi); ongkir yang (keliru)
//                    tercatat di child lain tidak ikut. Order lain (tunggal / BACKFILL_BUNDLE): value + ongkir — sama dengan invoice.
//   dasarStatusBayar = angka pembanding status Lunas/DP di CRM = tagihanOrder (value + ongkir yang ditagih) UNTUK SEMUA order.
//                    Keputusan Owner 29 Sep 2026: ongkir ikut nilai tagihan Finance. Sebelumnya order tunggal memakai Order.value SAJA, padahal
//                    invoice menagih value + ongkir dan jurnal pengakuan pendapatan mengakui ongkir → order tampil "Lunas" dengan piutang ongkir
//                    menggantung (mis. RES-21092026-128, Rp200.000). Komisi sales tetap berbasis Order.value (ongkir bukan omzet sales).
//   tagihanResi    = Σ tagihanOrder child aktif (bukan CANCELLED) = Total Resi.

export const PILIH_TAGIHAN = {
  id: true, value: true, ongkir: true, status: true, groupId: true,
  group: { select: { id: true, source: true, anchorOrderId: true } },
};

const rp = (n) => Number(n) || 0;

/** Konteks grup dari order yang dimuat dengan PILIH_TAGIHAN (atau grup yang dilewatkan terpisah). */
const grupDari = (order, grup) => grup ?? order?.group ?? null;

export function resiBaru(order, grup = null) {
  const g = grupDari(order, grup);
  return !!(order?.groupId && g?.source === "BARU");
}

export function ongkirDitagih(order, grup = null) {
  const g = grupDari(order, grup);
  if (resiBaru(order, g)) return order.id === g.anchorOrderId ? rp(order.ongkir) : 0;
  return rp(order.ongkir);
}

export function tagihanOrder(order, grup = null) {
  return rp(order.value) + ongkirDitagih(order, grup);
}

export function dasarStatusBayar(order, grup = null) {
  return tagihanOrder(order, grup);
}

export function tagihanResi(anak, grup) {
  return anak.filter((o) => o.status !== "CANCELLED").reduce((s, o) => s + tagihanOrder(o, grup), 0);
}

/** Muat order + konteks grupnya. null bila tidak ada. */
export async function muatTagihanOrder(db, orderId) {
  const o = await db.order.findUnique({ where: { id: orderId }, select: PILIH_TAGIHAN });
  if (!o) return null;
  return { order: o, tagihan: tagihanOrder(o), dasarStatus: dasarStatusBayar(o), resiBaru: resiBaru(o) };
}
