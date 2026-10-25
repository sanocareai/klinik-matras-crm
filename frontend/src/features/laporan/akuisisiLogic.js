// Logika murni tab "Akuisisi" (Performa Akuisisi per sumber). Semua angka datang dari server (GET /api/atribusi/iklan/sumber); di sini hanya urutan, label, dan format.
// Klien TIDAK menghitung konversi/CPA/ROAS dan tidak pernah mengubah null menjadi 0. Sorotan (highlight) dipilih SERVER dari data; klien hanya menampilkannya.

export const METRIK_URUT = [
  { id: "berOrder", label: "Customer ber-order", jenis: "hitung" },
  { id: "lead", label: "Lead masuk", jenis: "hitung" },
  { id: "membayar", label: "Customer membayar", jenis: "hitung" },
  { id: "lunas", label: "Customer lunas", jenis: "hitung" },
  { id: "konversiOrder", label: "Konversi ber-order", jenis: "rasio" },
  { id: "konversiLunas", label: "Konversi lunas", jenis: "rasio" },
];
export const METRIK_BY_ID = Object.fromEntries(METRIK_URUT.map((m) => [m.id, m]));

const nilaiMetrik = (s, id) => {
  if (id === "konversiOrder" || id === "konversiLunas") return s[id]?.nilai ?? null;
  return s[id] ?? null;
};

/** Urutkan sumber menurut metrik terpilih (menurun). Rasio: sampel kecil dan nilai kosong selalu di bawah sumber yang layak; seri → lead terbanyak. Tidak mengubah array asal. */
export function urutkan(sumber, metrikId = "berOrder") {
  const m = METRIK_BY_ID[metrikId] || METRIK_BY_ID.berOrder;
  const kunci = (s) => { const v = nilaiMetrik(s, m.id); return v === null ? -Infinity : v; };
  const layak = (s) => (m.jenis === "rasio" ? !s.sampelKecil && nilaiMetrik(s, m.id) !== null : true);
  return [...sumber].sort((a, b) => (layak(b) - layak(a)) || (kunci(b) - kunci(a)) || (b.lead - a.lead) || (a.id < b.id ? -1 : 1));
}

export const angka = (n) => (n == null ? "—" : Number(n).toLocaleString("id-ID"));
export const formatPersen = (n) => (n == null ? "—" : `${Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`);
export const rupiah = (n) => (n == null ? "—" : "Rp" + Math.round(Number(n)).toLocaleString("id-ID"));
export const kali = (n) => (n == null ? "—" : Number(n).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×");

/** Nilai + denominator terlihat untuk satu metrik. */
export function tampilMetrik(s, metrikId) {
  const m = METRIK_BY_ID[metrikId] || METRIK_BY_ID.berOrder;
  if (m.jenis === "rasio") {
    const r = s[m.id];
    if (!r || r.nilai === null) return { utama: "—", sub: r && r.penyebut === 0 ? "belum ada lead sah" : null, kosong: true };
    return { utama: formatPersen(r.nilai), sub: `${angka(r.pembilang)} dari ${angka(r.penyebut)} lead sah`, kosong: false };
  }
  const v = s[m.id];
  return { utama: angka(v), sub: m.id === "lead" ? `${angka(s.leadSah)} sah · ${angka(s.spam)} spam` : `dari ${angka(s.leadSah)} lead sah`, kosong: v == null };
}

export const ALASAN_LABEL = {
  BELUM_ADA_SPEND: "belum ada spend", SPEND_TIDAK_LENGKAP: "spend belum lengkap", HARI_BERJALAN_PARSIAL: "hari berjalan parsial", HARI_ATRIBUSI_PARSIAL: "hari atribusi parsial",
  SEBELUM_ATRIBUSI: "sebelum atribusi", BELUM_ADA_KONVERSI: "belum ada konversi", SPEND_NOL: "spend Rp0", TIDAK_ADA_SUMBER_SPEND: "tanpa data spend", BELUM_DIHITUNG: "belum dihitung",
  DATA_TERLAMBAT: "data spend terlambat", MAPPING_BELUM_ADA: "mapping belum ada",
};
export const alasanTeks = (kode) => (kode ? ALASAN_LABEL[kode] || String(kode).toLowerCase().replace(/_/g, " ") : null);

/** Sel biaya (CPA/ROAS): null → "—" + alasan; tidak pernah nol palsu. */
export function selBiaya(biaya, kunci) {
  const v = biaya?.[kunci];
  const alasan = biaya?.alasanNull?.[kunci] ?? (biaya?.status && v == null ? biaya.status : null);
  if (v == null) return { teks: "—", alasan: alasanTeks(alasan), kosong: true };
  return { teks: kunci === "bookedRoas" || kunci === "cashRoas" ? kali(v) : rupiah(v), alasan: null, kosong: false };
}

/** Penanda sorotan per sumber (server memilih). Satu sumber boleh punya beberapa penanda; tidak ada sumber yang di-hardcode sebagai pemenang. */
export function penandaPerSumber(sorotan) {
  const m = new Map();
  for (const s of sorotan || []) (m.get(s.sumberId) || m.set(s.sumberId, []).get(s.sumberId)).push(s);
  return m;
}

const URUT_PERINGATAN = ["SPEND_BELUM_LENGKAP", "HARI_BERJALAN", "LEDGER_TIDAK_LENGKAP", "RENTANG_SEBELUM_ATRIBUSI", "SUMBER_LABEL_CRM", "BUKAN_LEAD_PEMASARAN"];
export function peringatanUrut(lap) {
  return [...(lap?.peringatan || [])].sort((a, b) => (URUT_PERINGATAN.indexOf(a.kode) + 1 || 99) - (URUT_PERINGATAN.indexOf(b.kode) + 1 || 99));
}
export function bannerUtama(lap) {
  const p = peringatanUrut(lap).find((w) => ["SPEND_BELUM_LENGKAP", "HARI_BERJALAN"].includes(w.kode));
  if (!p) return null;
  return p.kode === "SPEND_BELUM_LENGKAP" ? "Spend belum lengkap — CPA dan ROAS belum dapat dinilai." : "Rentang mencakup hari berjalan — biaya per hasil sengaja kosong.";
}
/** Status "customer membayar": angka hanya batas bawah bila ledger belum lengkap. */
export function statusMembayar(lap) {
  const l = lap?.status?.ledger;
  if (!l || l.orderEligible === 0) return { lengkap: true, teks: null };
  const lengkap = l.orderBerLedger >= l.orderEligible;
  return { lengkap, teks: lengkap ? null : `Belum lengkap — ledger ${l.orderBerLedger}/${l.orderEligible} order (${formatPersen(l.persen)})` };
}
/** Delta terhadap periode pembanding (selisih absolut). Tidak ada pembanding → null. */
export function delta(lap, id, kunci) {
  const p = lap?.pembanding?.sumber?.find((x) => x.id === id);
  const s = lap?.sumber?.find((x) => x.id === id);
  if (!p || !s) return null;
  const a = s[kunci], b = p[kunci];
  if (a == null || b == null) return null;
  return a - b;
}
export const deltaTeks = (d) => (d == null ? null : d === 0 ? "sama" : `${d > 0 ? "+" : "−"}${Math.abs(d).toLocaleString("id-ID")}`);

export const BUKTI_LABEL = { ATRIBUSI_TERBUKTI_TERSEDIA: "Label CRM + atribusi terbukti", LABEL_CRM: "Label CRM" };
