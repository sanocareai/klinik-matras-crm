// Logika murni tab "Akuisisi" (Performa Akuisisi per sumber). Semua angka datang dari server (GET /api/atribusi/iklan/sumber); di sini hanya urutan, label, dan format.
// Klien TIDAK menghitung konversi/CPA/ROAS dan tidak pernah mengubah null menjadi 0. Sorotan (highlight) dipilih SERVER dari data; klien hanya menampilkannya.

export const METRIK_URUT = [
  { id: "berOrder", label: "Customer ber-order", jenis: "hitung" },
  { id: "lead", label: "Lead masuk", jenis: "hitung" },
  { id: "membayar", label: "Customer membayar", jenis: "hitung" },
  { id: "lunas", label: "Customer lunas", jenis: "hitung" },
  { id: "konversiOrder", label: "Konversi ber-order (÷ total lead, termasuk spam)", jenis: "rasio", nonSpam: false },
  { id: "konversiOrderNonSpam", label: "Konversi ber-order non-spam (÷ lead sah)", jenis: "rasio", nonSpam: true },
  { id: "konversiLunas", label: "Konversi lunas (÷ total lead, termasuk spam)", jenis: "rasio", nonSpam: false },
  { id: "konversiLunasNonSpam", label: "Konversi lunas non-spam (÷ lead sah)", jenis: "rasio", nonSpam: true },
];
export const METRIK_BY_ID = Object.fromEntries(METRIK_URUT.map((m) => [m.id, m]));

const nilaiMetrik = (s, id) => (METRIK_BY_ID[id]?.jenis === "rasio" ? s[id]?.nilai ?? null : s[id] ?? null);
export const PENYEBUT_LABEL = { TOTAL_LEAD_TERMASUK_SPAM: "total lead (termasuk spam)", LEAD_SAH_NON_SPAM: "lead sah (non-spam)" };

/** Urutkan sumber menurut metrik terpilih (menurun). Rasio: sampel kecil dan nilai kosong selalu di bawah sumber yang layak; seri → lead terbanyak. Tidak mengubah array asal. */
export function urutkan(sumber, metrikId = "berOrder") {
  const m = METRIK_BY_ID[metrikId] || METRIK_BY_ID.berOrder;
  const kunci = (s) => { const v = nilaiMetrik(s, m.id); return v === null ? -Infinity : v; };
  const kecil = (s) => (m.nonSpam ? s.sampelKecilNonSpam : s.sampelKecil);
  const layak = (s) => (m.jenis === "rasio" ? !kecil(s) && nilaiMetrik(s, m.id) !== null : true);
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
    if (!r || r.nilai === null) return { utama: "—", sub: r && r.penyebut === 0 ? `belum ada ${PENYEBUT_LABEL[r.penyebutJenis] || "lead"}` : null, kosong: true };
    return { utama: formatPersen(r.nilai), sub: `${angka(r.pembilang)} dari ${angka(r.penyebut)} ${PENYEBUT_LABEL[r.penyebutJenis] || "lead"}`, kosong: false };
  }
  const v = s[m.id];
  return { utama: angka(v), sub: m.id === "lead" ? `${angka(s.leadSah)} sah · ${angka(s.spam)} spam` : `dari ${angka(s.lead)} total lead (${angka(s.leadSah)} sah)`, kosong: v == null };
}

export const ALASAN_LABEL = {
  BELUM_ADA_SPEND: "belum ada spend", SPEND_TIDAK_LENGKAP: "spend belum lengkap", HARI_BERJALAN_PARSIAL: "hari berjalan parsial", HARI_ATRIBUSI_PARSIAL: "hari atribusi parsial",
  SEBELUM_ATRIBUSI: "sebelum atribusi", BELUM_ADA_KONVERSI: "belum ada konversi", SPEND_NOL: "spend Rp0", TIDAK_ADA_SUMBER_SPEND: "tanpa data spend", BELUM_DIHITUNG: "belum dihitung",
  DATA_TERLAMBAT: "data spend terlambat", MAPPING_BELUM_ADA: "mapping belum ada",
  BELUM_DIISI: "biaya belum diisi", RENTANG_TIDAK_COCOK: "total rentang tidak cocok", DETAIL_AD_SELISIH: "detail Ad mungkin parsial", TIDAK_TERSEDIA_ORGANIK: "biaya tidak tersedia", TIDAK_ADA_BIAYA_DIALOKASIKAN: "biaya tidak tersedia",
  SPEND_TIDAK_LENGKAP_PADA_SUMBER_WAJIB: "ada sumber berbayar yang biayanya belum lengkap",
};
export const STATUS_BIAYA_LABEL = {
  LENGKAP: "Biaya lengkap", BELUM_DIISI: "Biaya belum diisi", SPEND_TIDAK_LENGKAP: "Biaya belum lengkap", RENTANG_TIDAK_COCOK: "Total rentang tidak cocok", DETAIL_AD_SELISIH: "Detail Ad mungkin parsial",
  HARI_BERJALAN_PARSIAL: "Mencakup hari berjalan", TIDAK_TERSEDIA_ORGANIK: "Biaya tidak tersedia", BELUM_DIHITUNG: "Belum dihitung",
};
export const statusBiayaTeks = (st) => STATUS_BIAYA_LABEL[st] || (st ? String(st).toLowerCase().replace(/_/g, " ") : "—");
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

const URUT_PERINGATAN = ["SPEND_BELUM_LENGKAP", "HARI_BERJALAN", "BIAYA_SEMENTARA", "MANUAL_DIABAIKAN", "LEDGER_TIDAK_LENGKAP", "RENTANG_SEBELUM_ATRIBUSI", "SUMBER_LABEL_CRM", "BUKAN_LEAD_PEMASARAN"];
export function peringatanUrut(lap) {
  return [...(lap?.peringatan || [])].sort((a, b) => (URUT_PERINGATAN.indexOf(a.kode) + 1 || 99) - (URUT_PERINGATAN.indexOf(b.kode) + 1 || 99));
}
export function bannerUtama(lap) {
  const p = peringatanUrut(lap).find((w) => ["SPEND_BELUM_LENGKAP", "HARI_BERJALAN"].includes(w.kode));
  if (!p) return null;
  if (p.kode === "SPEND_BELUM_LENGKAP") return p.data?.sumber && p.pesan ? p.pesan : "Spend belum lengkap — CPA dan ROAS belum dapat dinilai.";
  return "Rentang mencakup hari berjalan — biaya per hasil sengaja kosong.";
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

/** Teks lengkap sorotan konversi: nilai + pembilang/penyebut + jenis konversi + catatan ambang. Sorotan lain: label saja. */
export function teksSorotan(p) {
  if (!p) return "";
  if (p.jenis === "KONVERSI_BER_ORDER_PER_TOTAL_LEAD") return `${p.label}: ${formatPersen(p.nilai)} (${angka(p.pembilang)} dari ${angka(p.penyebut)} ${p.jenisTeks?.split("÷ ")[1] || "total lead"}). ${p.catatan || ""}`.trim();
  return p.label;
}
/** Ringkas pengecualian per sumber untuk ditampilkan eksplisit. */
export function teksPengecualian(s) {
  const p = s?.pengecualian; if (!p) return null;
  return `Dikeluarkan dari lead sah: spam ${angka(p.spam)} · staf internal ${angka(p.internalStaff)} · profil karyawan ${angka(p.profilKaryawan)}`;
}
export function teksPengecualianTotal(lap) {
  const p = lap?.pengecualianTotal; if (!p) return null;
  const d = p.dikeluarkanDariSemuaSumber || { total: 0, perLabel: {} };
  const rinci = Object.entries(d.perLabel || {}).map(([k, v]) => `${k.replace(/_/g, " ").toLowerCase()} ${angka(v)}`).join(" · ");
  return `Pengecualian: spam ${angka(p.spam)} · staf internal ${angka(p.internalStaff)} · profil karyawan ${angka(p.profilKaryawan)} · B2B/penjualan karyawan (di luar semua sumber) ${angka(d.total)}${rinci ? ` (${rinci})` : ""}`;
}
export const NOTA_AMBANG = "Sampel kecil = < 30 lead (aturan tampilan sementara). Ini bukan uji signifikansi statistik dan sorotan bukan pemenang pasti.";

// ═══ BIAYA SUMBER, NILAI & PEMBAYARAN (kontrak server: sumber[].biaya, sumber[].uang, total.berbayar) ═══════════════════════════════════════════════════════════
// Definisi (sama untuk kartu, tabel, detail, dan ekspor — semuanya membaca objek server yang sama):
//   Nilai order        = Σ nilai order eligible kohort lead (nilai SAAT INI, bukan uang masuk).
//   Pembayaran bersih  = pembayaran sah di ledger − refund disetujui (uang tercatat, BUKAN nilai order).
//   Biaya iklan        = biaya SUMBER pada rentang yang sama (detail Ad / entri manual / total rentang), lengkap bila setiap hari terisi; selain itu null + alasan.
//   CPA lunas          = biaya ÷ customer UNIK lunas-terbukti (kohort lead periode ini, dievaluasi sampai waktu cutoff). Dasar: "Atribusi label CRM" — BUKAN CPA campaign.
//   Booked ROAS        = nilai order ÷ biaya.   Cash ROAS = pembayaran bersih ÷ biaya.   Keduanya terpisah; tidak pernah dicampur.
export const DASAR_BIAYA_LABEL = "Atribusi label CRM";
export const sumberBerbiaya = (s) => s?.jenis === "IKLAN" || s?.jenis === "LAINNYA";

/** Sel biaya sumber: '—' + alasan; organik → 'biaya tidak tersedia' (bukan Rp0). */
export function selBiayaSumber(s, kunci) {
  const b = s?.biaya;
  if (!b) return { teks: "—", alasan: null, kosong: true };
  if (kunci === "spend") {
    if (b.spend == null) return { teks: "—", alasan: alasanTeks(b.status) || null, kosong: true };
    return { teks: rupiah(b.spend), alasan: b.status === "LENGKAP" ? null : statusBiayaTeks(b.status).toLowerCase(), kosong: false };
  }
  const c = selBiaya(b, kunci);
  return { ...c, sementara: !c.kosong && b.sementara === true };
}
/** Sel untuk total sumber berbayar (alasanNull berupa teks tunggal). */
export function selTotalBerbayar(t, kunci) {
  const v = t?.[kunci];
  if (v == null) return { teks: "—", alasan: alasanTeks(typeof t?.alasanNull === "string" ? t.alasanNull : null), kosong: true, sementara: false };
  return { teks: kunci === "spend" || kunci === "cpa" ? rupiah(v) : kali(v), alasan: null, kosong: false, sementara: t.sementara === true };
}
export const sementaraTeks = (b) => (b?.sementara ? (b.alasanSementara || []).map((a) => String(a).split(":")[0].replace(/_/g, " ").toLowerCase()).join(", ") : null);

/** Waktu cutoff evaluasi pembayaran (dari server, WIB). */
export const teksCutoff = (lap) => lap?.cutoffEvaluasi?.waktuWib || null;

/** Ringkasan 'berapa sumber berbayar sudah lengkap biayanya'. */
export function ringkasBiayaBerbayar(lap) {
  const b = lap?.total?.berbayar; if (!b) return null;
  return { lengkap: b.lengkap === true, jumlah: (b.sumber || []).length, belum: (b.belumLengkap || []).map((x) => ({ id: x.id, status: x.status })) };
}

// ── EKSPOR CSV: kolom = apa yang tampil di layar; nilai null → sel kosong + kolom alasan (tidak pernah 0). ────────────────────────────────────────────────────
const CSV_KOLOM = ["Sumber", "Dasar biaya", "Lead", "Spam", "Lead sah", "Ber-order", "Membayar", "Lunas", "Konversi ber-order % (÷ total lead termasuk spam)", "Pembilang", "Penyebut",
  "Nilai order saat ini (Rp)", "Pembayaran tercatat bersih (Rp)", "Biaya iklan (Rp)", "Status biaya", "CPA lunas (Rp)", "Alasan CPA kosong", "Booked ROAS", "Cash ROAS", "Alasan ROAS kosong", "Sementara"];
const cel = (v) => {
  if (v == null) return "";
  let t = String(v);
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(t)) t = "'" + t;   // cegah formula injection di Excel
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
export function buatCsvAkuisisi(lap) {
  if (!lap) return "";
  const p = lap.periode || {};
  const meta = [["Periode lead masuk (WIB)", `${p.dari ?? ""} s/d ${p.sampai ?? ""}`], ["Evaluasi pembayaran sampai", teksCutoff(lap) || ""], ["Dasar sumber", "Label CRM (Customer.leadSource); CPA/ROAS = Atribusi label CRM, bukan CPA campaign"],
    ["Definisi", "Nilai order = nilai order eligible saat ini; Pembayaran bersih = ledger - refund disetujui; CPA lunas = biaya sumber / customer unik lunas; null dikosongkan"]];
  const baris = (lap.sumber || []).map((s) => {
    const b = s.biaya || {};
    return [s.label, b.dasar === "ATRIBUSI_LABEL_CRM" ? DASAR_BIAYA_LABEL : "", s.lead, s.spam, s.leadSah, s.berOrder, s.membayar, s.lunas, s.konversiOrder?.nilai, s.konversiOrder?.pembilang, s.konversiOrder?.penyebut,
      s.uang?.nilaiOrderSaatIni, s.uang?.uangBersih, b.spend, statusBiayaTeks(b.status), b.cpa, b.cpa == null ? (alasanTeks(b.alasanNull?.cpa) || "") : "", b.bookedRoas, b.cashRoas,
      b.cashRoas == null ? (alasanTeks(b.alasanNull?.cashRoas) || "") : "", b.sementara ? "ya" : ""];
  });
  const t = lap.total || {}; const bb = t.berbayar;
  const total = ["TOTAL (semua sumber)", "", t.lead, t.spam, t.leadSah, t.berOrder, t.membayar, t.lunas, "", "", "", t.nilaiOrderSaatIni, t.uangBersih, "", "", "", "", "", "", "", ""];
  const berbayar = bb ? ["TOTAL sumber berbayar", DASAR_BIAYA_LABEL, bb.lead, "", "", "", "", bb.lunas, "", "", "", bb.nilaiOrderSaatIni, bb.uangBersih, bb.spend, bb.lengkap ? "Biaya lengkap" : "Ada sumber belum lengkap", bb.cpa, bb.cpa == null ? (alasanTeks(bb.alasanNull) || "") : "", bb.bookedRoas, bb.cashRoas, bb.cashRoas == null ? (alasanTeks(bb.alasanNull) || "") : "", bb.sementara ? "ya" : ""] : null;
  return [...meta.map((r) => r.map(cel).join(",")), "", CSV_KOLOM.map(cel).join(","), ...baris.map((r) => r.map(cel).join(",")), total.map(cel).join(","), ...(berbayar ? [berbayar.map(cel).join(",")] : [])].join("\r\n") + "\r\n";
}
export const namaBerkasCsv = (lap) => `akuisisi-${lap?.periode?.dari ?? "x"}_${lap?.periode?.sampai ?? "x"}.csv`;
