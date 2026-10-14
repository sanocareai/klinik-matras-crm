// Model murni "sumber Penjualan Karyawan" untuk badge/dropdown ringkas di semua workspace. Satu bentuk dari dua sumber data:
//   • CRM/Finance : ringkasOrderPkr  → { nomor, penjual:{name}, pembeli, identitas, items, ringkasUnit, unitBaris, pembayaran }
//   • Produksi/Delivery : rujukan    → { nomor, karyawan, pembeli, identitas (proyeksi), kirimLabel }
// Aturan: customer/pembeli utama = Bpk. Indra; karyawan penjual (Kemal) hanya SUMBER — tidak pernah jadi nama customer. Tanpa nominal; status pembayaran hanya bila server mengirimnya.
export function modelSumberPkr(pkr) {
  if (!pkr?.nomor) return null;
  const id = pkr.identitas || null;
  const karyawan = id?.karyawanPenjual?.nama ?? pkr.penjual?.name ?? pkr.karyawan ?? null;
  const customer = id?.customer?.nama ?? pkr.pembeli ?? null;
  const penerima = id?.penerima?.berbeda ? { nama: id.penerima.nama ?? null, telepon: id.penerima.telepon ?? null } : null;
  const jumlahItem = Array.isArray(pkr.items) ? pkr.items.length : null;
  const jumlahUnit = pkr.ringkasUnit?.total ?? (Array.isArray(pkr.unitBaris) ? pkr.unitBaris.length : null);
  return {
    nomor: pkr.nomor,
    penjualanId: pkr.penjualanId ?? null,
    karyawan,
    ringkas: karyawan ? `Dijual oleh ${karyawan}` : "Penjualan Karyawan",
    customer,
    legacy: Boolean(id?.legacy),
    penerima,
    jumlahItem,
    jumlahUnit,
    pembayaranLabel: pkr.pembayaran?.label ?? null,
  };
}

/** Baris dropdown (label, nilai) — null/"" dibuang. Urutan: nomor PKR → karyawan penjual → customer → penerima → item & unit → pembayaran. */
export function barisSumberPkr(m) {
  if (!m) return [];
  const item = [m.jumlahItem != null ? `${m.jumlahItem} item` : null, m.jumlahUnit != null ? `${m.jumlahUnit} unit produksi` : null].filter(Boolean).join(" · ");
  return [
    ["Nomor PKR", m.nomor],
    ["Karyawan penjual", m.karyawan],
    ["Customer/pembeli", m.customer ? `${m.customer}${m.legacy ? " (data customer belum lengkap)" : ""}` : null],
    ["Penerima", m.penerima ? `${m.penerima.nama ?? "—"}${m.penerima.telepon ? ` · ${m.penerima.telepon}` : ""}` : "Sama dengan pembeli"],
    ["Item & unit", item || null],
    ["Status pembayaran", m.pembayaranLabel],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
}
