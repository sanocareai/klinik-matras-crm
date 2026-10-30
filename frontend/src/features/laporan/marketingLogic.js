// Logika MURNI tab "Marketing" di Laporan (menggantikan tab Traffic + Akuisisi + Iklan). Tanpa React/DOM, dapat diuji di Node.
// ATURAN: tidak ada perhitungan paralel. Semua angka datang dari service yang sudah ada:
//   /atribusi/iklan/sumber  → kartu ringkas + tabel semua sumber (label CRM; biaya sumber)
//   /atribusi/iklan         → Meta: campaign → ad set → ad (atribusi CTWA terbukti)
//   /analytics/traffic      → tren lead harian, pola jam/hari, respons, kualitas label sumber
// Di sini hanya: kunci URL, urutan/peringkat tampilan, pemilihan kolom, rekonsiliasi lintas bagian, dan butir kualitas data. null (kosong) tidak pernah diubah menjadi 0.
import { METRIK_BY_ID, METRIK_URUT, peringatanUrut, teksPengecualianTotal, NOTA_AMBANG, statusMembayar, ringkasBiayaBerbayar, formatPersen, angka, rupiah, selTotalBerbayar, DASAR_BIAYA_LABEL, ALASAN_LABEL, statusBiayaTeks } from "./akuisisiLogic.js";
import { ringkasCakupan, UMUR, LEVELS } from "./iklanCampaignLogic.js";

export const TAB_MARKETING = "Marketing";

// ── URL lama → tujuan pengganti ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// ?tab=Traffic → Marketing (ringkasan); ?tab=Akuisisi[&sumber=X] → Marketing[&sumber=X]; ?tab=Iklan → Marketing&sumber=META (campaign → ad set → ad). Periode (dari/sampai) dipertahankan oleh pemanggil.
export const TAB_LAMA = Object.freeze({ Traffic: { sumber: null }, Akuisisi: { sumber: undefined }, Iklan: { sumber: "META" } });
/** @returns {{tab:string|null, sumber:string|null}} — tab di luar daftar → tab:null (bukan melempar). */
export function petaTab(tabMentah, sumberMentah, tabsValid = []) {
  if (tabMentah && tabsValid.includes(tabMentah)) return { tab: tabMentah, sumber: tabMentah === TAB_MARKETING ? sumberMentah ?? null : null };
  const lama = tabMentah && Object.prototype.hasOwnProperty.call(TAB_LAMA, tabMentah) ? TAB_LAMA[tabMentah] : null;
  if (!lama) return { tab: null, sumber: null };
  return { tab: TAB_MARKETING, sumber: lama.sumber === undefined ? sumberMentah ?? null : lama.sumber };
}

// ── PERINGKAT META (kriteria sama dengan tool MCP performa_campaign_meta: laporanMeta.js#KRITERIA_URUT) ─────────────────────────────────────────────
// `ambil` membaca BARIS MENTAH laporan (/atribusi/iklan → grup[]). Semua "terbaik dulu"; arah asc hanya CPA. null = tidak dapat diperingkat (bukan 0).
export const KRITERIA_META = Object.freeze([
  { id: "customer_ber_order", label: "Customer ber-order", arah: "desc", ambil: (g) => g.customerDenganOrder },
  { id: "customer_lunas_ledger", label: "Customer lunas (ledger)", arah: "desc", ambil: (g) => g.closingUtama?.customerLunasTerbuktiLedger },
  { id: "customer_pernah_membayar", label: "Customer membayar", arah: "desc", ambil: (g) => g.customerPernahMembayar },
  { id: "lead_akuisisi", label: "Lead akuisisi terbukti", arah: "desc", ambil: (g) => g.lead?.unik },
  { id: "nilai_order", label: "Nilai order", arah: "desc", ambil: (g) => g.bookedValue },
  { id: "uang_ledger_bersih", label: "Uang diterima bersih", arah: "desc", ambil: (g) => g.uangBersihLedger },
  { id: "cpa_lunas", label: "CPA lunas (terendah = terbaik)", arah: "asc", ambil: (g) => g.biaya?.cpa, alasan: (g) => g.biaya?.alasanNull?.cpa },
  { id: "booked_roas", label: "Booked ROAS", arah: "desc", ambil: (g) => g.biaya?.bookedRoas, alasan: (g) => g.biaya?.alasanNull?.bookedRoas },
  { id: "cash_roas", label: "Cash ROAS", arah: "desc", ambil: (g) => g.biaya?.cashRoas, alasan: (g) => g.biaya?.alasanNull?.cashRoas },
]);
export const KRITERIA_META_BY_ID = Object.fromEntries(KRITERIA_META.map((k) => [k.id, k]));
export const KRITERIA_META_BAWAAN = "customer_ber_order";
export const kriteriaMetaValid = (id) => Object.prototype.hasOwnProperty.call(KRITERIA_META_BY_ID, id);

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Kriteria mana yang punya NILAI pada minimal satu baris terpetakan (CPA/ROAS valid hanya bila server mengisinya). */
export function kriteriaTersedia(grup) {
  const mapped = (grup || []).filter((g) => g.status === "MAPPED");
  return Object.fromEntries(KRITERIA_META.map((k) => [k.id, mapped.some((g) => num(k.ambil(g)) !== null)]));
}

/**
 * Urutkan baris laporan Meta: MAPPED berperingkat (seri = peringkat sama, kompetisi 1-2-2-4) → MAPPED tanpa nilai (tanpa peringkat + alasan) → UNMAPPED → UNKNOWN.
 * UNMAPPED/UNKNOWN SELALU ikut tampil (rekonsiliasi), tidak pernah diperingkat. Pemecah seri hanya mengatur urutan tampil.
 */
export function urutkanMeta(grup, kriteriaId = KRITERIA_META_BAWAAN) {
  const k = KRITERIA_META_BY_ID[kriteriaId] || KRITERIA_META_BY_ID[KRITERIA_META_BAWAAN];
  const n0 = (v) => Number(v) || 0;
  const pemecah = (a, b) => (n0(b.closingUtama?.customerLunasTerbuktiLedger) - n0(a.closingUtama?.customerLunasTerbuktiLedger)) || (n0(b.customerPernahMembayar) - n0(a.customerPernahMembayar))
    || (n0(b.customerDenganOrder) - n0(a.customerDenganOrder)) || (n0(b.lead?.unik) - n0(a.lead?.unik)) || (String(a.kunci) < String(b.kunci) ? -1 : String(a.kunci) > String(b.kunci) ? 1 : 0);
  const mapped = (grup || []).filter((g) => g.status === "MAPPED");
  const ada = mapped.filter((g) => num(k.ambil(g)) !== null);
  const tanpa = mapped.filter((g) => num(k.ambil(g)) === null);
  ada.sort((a, b) => (k.arah === "asc" ? num(k.ambil(a)) - num(k.ambil(b)) : num(k.ambil(b)) - num(k.ambil(a))) || pemecah(a, b));
  let peringkat = 0, sebelumnya;
  const hasil = ada.map((g, i) => { const v = num(k.ambil(g)); if (i === 0 || v !== sebelumnya) { peringkat = i + 1; sebelumnya = v; } return { g, peringkat, nilai: v, alasan: null }; });
  tanpa.sort(pemecah);
  for (const g of tanpa) hasil.push({ g, peringkat: null, nilai: null, alasan: k.alasan?.(g) ?? "TIDAK_TERSEDIA" });
  for (const st of ["UNMAPPED", "UNKNOWN"]) for (const g of (grup || []).filter((x) => x.status === st).sort(pemecah)) hasil.push({ g, peringkat: null, nilai: num(k.ambil(g)), alasan: null, tanpaPeringkat: st });
  const semuaNol = ada.length > 0 && ada.every((g) => num(k.ambil(g)) === 0);
  return { baris: hasil, kriteria: k, semuaNol };
}

export const alasanKosong = (kode) => (kode ? ALASAN_LABEL[kode] || String(kode).toLowerCase().replace(/_/g, " ") : "tidak tersedia");

// ── JEJAK META (breadcrumb dari level + id di URL; nama dibaca dari baris laporan yang sudah dimuat) ───────────────────────────────────────────────
export const levelValid = (v) => LEVELS.includes(v);
export const umurValid = (v) => UMUR.some((u) => u.id === v);
export const idValid = (v) => typeof v === "string" && /^\d{5,32}$/.test(v);
/** Normalisasi parameter drilldown dari URL: level ad butuh campaign; adset tanpa campaign → campaign; kombinasi tak konsisten diturunkan ke level yang sah. */
export function normalisasiJalurMeta({ level, campaign, adset } = {}) {
  let lv = levelValid(level) ? level : "campaign";
  const camp = idValid(campaign) ? campaign : null; const set = idValid(adset) ? adset : null;
  if (lv !== "campaign" && !camp) lv = "campaign";
  if (lv === "ad" && !set) lv = "adset";
  return { level: lv, campaign: lv === "campaign" ? null : camp, adset: lv === "ad" ? set : null };
}
/** Jejak: Marketing › Meta › [Campaign] › [Ad set] ; nama dari baris laporan (campaign/adSet), fallback ke ID. */
export function jejakMeta(jalur, grup) {
  const sampel = (grup || []).find((g) => g.campaign?.id || g.adSet?.id) || null;
  const out = [{ level: "campaign", label: "Semua campaign" }];
  if (jalur.level !== "campaign") out.push({ level: "adset", label: sampel?.campaign?.nama || `Campaign ${jalur.campaign}` });
  if (jalur.level === "ad") out.push({ level: "ad", label: sampel?.adSet?.nama || `Ad Set ${jalur.adset}` });
  return out;
}

// ── TABEL SUMBER ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Kolom utama selalu tampil di desktop; tambahan lewat pilihan kolom (?kolom=lengkap). Mobile memakai kartu (ringkas + detail yang dapat dibuka).
export const KOLOM_SUMBER = Object.freeze([
  { id: "lead", label: "Lead", utama: true }, { id: "berOrder", label: "Ber-order", utama: true }, { id: "lunas", label: "Lunas", utama: true },
  { id: "nilai", label: "Nilai order", utama: true }, { id: "uang", label: "Uang bersih", utama: true }, { id: "spend", label: "Biaya iklan", utama: true },
  { id: "konversi", label: "Konversi", utama: true }, { id: "cpa", label: "CPA lunas", utama: true },
  { id: "spam", label: "Spam", utama: false }, { id: "membayar", label: "Membayar", utama: false }, { id: "konversiNonSpam", label: "Konversi non-spam", utama: false },
  { id: "booked", label: "Booked ROAS", utama: false }, { id: "cash", label: "Cash ROAS", utama: false },
]);
export const MODE_KOLOM = Object.freeze(["ringkas", "lengkap"]);
export const kolomTampil = (mode) => KOLOM_SUMBER.filter((k) => k.utama || mode === "lengkap");
export const urutSumberValid = (v) => Object.prototype.hasOwnProperty.call(METRIK_BY_ID, v);
export const URUT_SUMBER_BAWAAN = "berOrder";
export { METRIK_URUT };

// ── KARTU RINGKAS (satu baris, dari total /sumber) ───────────────────────────────────────────────────────────────────────────────────────────────
// Semua kartu membaca objek server yang SAMA dengan tabel; tidak ada angka yang dihitung ulang. "Lunas" = customer lunas terbukti LEDGER (bukan status CRM).
export function kartuRingkas(lap) {
  const t = lap?.total; if (!t) return [];
  const bayar = statusMembayar(lap); const bb = t.berbayar;
  const spend = selTotalBerbayar(bb, "spend"); const rb = ringkasBiayaBerbayar(lap);
  return [
    { id: "lead", judul: "Total lead", nilai: angka(t.lead), sub: `${angka(t.leadSah)} sah · ${angka(t.spam)} spam`, tip: "Customer baru dibuat di periode, semua sumber pemasaran. Spam ikut terhitung (sama dengan penyebut konversi utama); lead sah = bukan spam/staf/karyawan." },
    { id: "berOrder", judul: "Customer ber-order", nilai: angka(t.berOrder), sub: `dari ${angka(t.leadSah)} lead sah`, tip: "Customer unik dengan ≥ 1 order eligible. Ber-order BUKAN berarti sudah membayar." },
    { id: "lunas", judul: "Customer lunas", nilai: bayar.lengkap ? angka(t.lunas) : `≥ ${angka(t.lunas)}`, sub: bayar.lengkap ? "terbukti ledger" : "terbukti ledger · batas bawah", tip: "Customer unik yang ledger pembayarannya (setelah refund disetujui) menutup seluruh tagihan. Bukan status LUNAS di CRM.", peringatan: !bayar.lengkap },
    { id: "nilai", judul: "Nilai order", nilai: rupiah(t.nilaiOrderSaatIni), sub: "kohort lead · nilai saat ini", tip: "Σ nilai order eligible kohort lead periode ini. Bukan uang diterima dan bukan laba." },
    { id: "uang", judul: "Uang diterima bersih", nilai: rupiah(t.uangBersih), sub: "ledger − refund", tip: "Pembayaran sah di ledger dikurangi refund disetujui. Batas bawah: pembayaran di luar sistem tidak terlihat. Bukan laba bersih." },
    { id: "biaya", judul: "Biaya iklan", nilai: spend.teks, kosong: spend.kosong, sub: spend.kosong ? (spend.alasan || "belum lengkap") : `${rb?.jumlah ?? 0} sumber berbayar`, tip: "Total biaya sumber berbayar pada periode yang sama; terisi hanya bila SEMUA sumber berbayar lengkap setiap hari. Kosong ≠ Rp0." },
  ];
}

// ── REKONSILIASI LEAD LINTAS BAGIAN ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Kartu "Total lead" (/sumber) memuat spam; tren harian & pola (/analytics/traffic) tanpa spam dan tanpa B2B/penjualan karyawan. Keduanya customer yang dibuat pada rentang WIB yang sama:
//   total lead (sumber) − spam (sumber) = lead tanpa spam  ⇒  harus sama dengan total tren. Selisih ≠ 0 hanya wajar bila dua pembacaan terjadi pada saat berbeda (hari berjalan) — ditandai, tidak disembunyikan.
export function rekonLead(lap, traffic, { termasukHariBerjalan = false } = {}) {
  const t = lap?.total;
  if (!t) return { tersedia: false, alasan: "SUMBER_BELUM_DIMUAT" };
  if (!traffic || traffic.totalLeads == null) return { tersedia: false, alasan: "TRAFFIC_BELUM_DIMUAT" };
  const tanpaSpam = (t.lead ?? 0) - (t.spam ?? 0);
  const selisih = traffic.totalLeads - tanpaSpam;
  const jumlahHarian = (traffic.daily || []).reduce((s, d) => s + (d.value || 0), 0);
  return {
    tersedia: true, totalLead: t.lead, spam: t.spam, tanpaSpam, tren: traffic.totalLeads, jumlahHarian, selisih, cocok: selisih === 0,
    harianCocokTotal: jumlahHarian === traffic.totalLeads,
    penjelasanSelisih: selisih === 0 ? null : (termasukHariBerjalan ? "Periode memuat hari berjalan: dua laporan dibaca pada saat berbeda, lead masih bertambah." : "Selisih tidak terduga antara laporan sumber dan laporan traffic — jangan dipakai sebagai angka final."),
  };
}

// ── KUALITAS DATA ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Butir kualitas data. status: "ok" | "perhatian" | "info". Semua teks berasal dari objek server; tidak ada ambang buatan. */
export function kualitasData({ lap, iklan, traffic, periode }) {
  const out = [];
  const l = lap?.status?.ledger;
  if (l) out.push({ id: "coverage", judul: "Cakupan ledger", status: l.orderEligible > 0 && l.orderBerLedger < l.orderEligible ? "perhatian" : "ok", nilai: formatPersen(l.persen), teks: `${angka(l.orderBerLedger)} dari ${angka(l.orderEligible)} order eligible punya pembayaran di ledger.` });
  const bayar = statusMembayar(lap);
  if (lap) out.push({ id: "ledgerParsial", judul: "Ledger parsial", status: bayar.lengkap ? "ok" : "perhatian", nilai: bayar.lengkap ? "Lengkap" : "Parsial", teks: bayar.lengkap ? "Semua order eligible punya pembayaran di ledger." : `${bayar.teks}. Customer membayar/lunas adalah batas bawah.` });
  const rb = ringkasBiayaBerbayar(lap);
  if (rb) out.push({ id: "spendSumber", judul: "Biaya sumber berbayar", status: rb.lengkap ? "ok" : "perhatian", nilai: rb.lengkap ? "Lengkap" : "Belum lengkap", teks: rb.lengkap ? `${rb.jumlah} sumber berbayar terisi setiap hari. Terisi ≠ diverifikasi independen.` : (rb.belum.map((x) => `${x.id}: ${statusBiayaTeks(x.status).toLowerCase()}`).join(" · ") || "Ada sumber berbayar yang belum lengkap.") });
  const b = iklan?.biaya;
  if (iklan) {
    const hariHilang = b?.kesegaran?.hariHilang;
    const terhubung = !!b?.sumber?.terhubung;
    out.push({
      id: "spendMeta", judul: "Spend Meta (per Ad ID)", status: terhubung && (!Array.isArray(hariHilang) || hariHilang.length === 0) && !b?.sumber?.terlambat ? "ok" : "perhatian",
      nilai: !terhubung ? "Belum tersambung" : Array.isArray(hariHilang) && hariHilang.length ? `${hariHilang.length} hari hilang` : (b?.sumber?.terlambat ? "Terlambat" : "Terisi"),
      teks: !terhubung ? "Belum ada spend Meta per Ad ID di sistem — CPA/ROAS campaign tidak dapat dihitung." : `Spend terakhir ${b?.sumber?.terakhirTanggal ?? "—"} WIB${Array.isArray(hariHilang) && hariHilang.length ? `; hari tanpa spend: ${hariHilang.slice(0, 10).join(", ")}${hariHilang.length > 10 ? ` … (+${hariHilang.length - 10})` : ""}` : ""}${(b?.spendTidakTerpetakan ?? 0) > 0 ? `; spend tanpa mapping ${rupiah(b.spendTidakTerpetakan)}` : ""}.`,
    });
    const grup = iklan.grup || [];
    const unknown = grup.find((g) => g.status === "UNKNOWN");
    const unmapped = grup.filter((g) => g.status === "UNMAPPED");
    const adIdUnmapped = (iklan.tidakTerpetakan?.adIds || []).length || unmapped.length;
    out.push({ id: "unknown", judul: "UNKNOWN", status: (unknown?.lead?.unik ?? 0) > 0 ? "perhatian" : "ok", nilai: angka(unknown?.lead?.unik ?? 0), teks: "Lead baru bertouch iklan tanpa bukti akuisisi kausal. Tidak dikreditkan ke campaign mana pun." });
    out.push({ id: "unmapped", judul: "UNMAPPED", status: adIdUnmapped > 0 ? "perhatian" : "ok", nilai: `${angka(adIdUnmapped)} Ad ID`, teks: adIdUnmapped > 0 ? `${angka(unmapped.reduce((s, g) => s + (g.lead?.unik ?? 0), 0))} lead pada Ad ID yang belum punya pemetaan Ad → Ad Set → Campaign. Tampil terpisah, tidak ditebak dari nama.` : "Semua Ad ID bertouch sudah terpetakan." });
    const cak = ringkasCakupan(iklan);
    if (cak) out.push({ id: "atribusiMeta", judul: "Cakupan atribusi Meta", status: "info", nilai: cak.persenDenganTouch != null ? formatPersen(cak.persenDenganTouch) : "—", teks: `${angka(cak.bagian[0]?.n)} dari ${angka(cak.total)} lead baru terbukti per Ad ID (touch CTWA). Atribusi tersimpan sejak ${iklan.atribusi?.attributionStartWib ?? "belum ada touch"}.${cak.metaAds ? ` Selisih terhadap label META_ADS di CRM (${angka(cak.metaAds.label)} lead baru): ${angka(cak.metaAds.terbukti)} terbukti per Ad ID · ${angka(cak.metaAds.unknown)} UNKNOWN · ${angka(cak.metaAds.sudahAda)} customer sudah ada · ${angka(cak.metaAds.tanpaTouch)} tanpa touch iklan (label dari clid/teks/tautan, tanpa Ad ID — tidak diberi kredit campaign).` : ""}` });
    out.push({ id: "rekonMeta", judul: "Rekonsiliasi laporan Meta", status: iklan.rekonsiliasi?.ok ? "ok" : "perhatian", nilai: iklan.rekonsiliasi?.ok ? `OK (${iklan.rekonsiliasi.cek?.length ?? 0})` : "GAGAL", teks: iklan.rekonsiliasi?.ok ? "Σ campaign = Σ ad set = Σ ad = total." : "Rekonsiliasi gagal — jangan memakai angka campaign ini." });
  }
  const a = traffic?.atribusi;
  if (a && a.total > 0) out.push({ id: "labelSumber", judul: "Sumber lead diketahui", status: a.rate != null && a.rate < 20 ? "perhatian" : "info", nilai: a.rate != null ? `${a.rate}%` : "—", teks: `${angka(a.teridentifikasi)} dari ${angka(a.total)} lead (tanpa spam) punya sumber yang diketahui sistem; sisanya WhatsApp langsung tanpa jejak teknis — keterbatasan pelacakan, bukan berarti organik.${a.belumDikonfirmasi > 0 ? ` ${angka(a.belumDikonfirmasi)} belum dikonfirmasi sales.` : ""}`, aksi: a.belumDikonfirmasi > 0 ? { teks: "Lihat daftar yang belum dikonfirmasi", ke: "/customers?source=WHATSAPP_DIRECT&confirmed=false" } : null });
  const r = rekonLead(lap, traffic, { termasukHariBerjalan: periode?.termasukHariBerjalan });
  if (r.tersedia) out.push({ id: "rekonLead", judul: "Rekonsiliasi total lead", status: r.cocok && r.harianCocokTotal ? "ok" : "perhatian", nilai: r.cocok ? "Cocok" : `Selisih ${r.selisih > 0 ? "+" : "−"}${angka(Math.abs(r.selisih))}`, teks: `Total lead ${angka(r.totalLead)} − spam ${angka(r.spam)} = ${angka(r.tanpaSpam)} lead tanpa spam; tren harian ${angka(r.tren)} (Σ harian ${angka(r.jumlahHarian)}).${r.penjelasanSelisih ? ` ${r.penjelasanSelisih}` : ""}` });
  return out;
}

// ── EKSPOR CSV META (kolom = tabel di layar; null dikosongkan + kolom alasan) ──────────────────────────────────────────────────────────────────────
const cel = (v) => {
  if (v == null) return "";
  let t = String(v);
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(t)) t = "'" + t;   // cegah formula injection di Excel
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
export function buatCsvMeta(lap, kriteriaId = KRITERIA_META_BAWAAN) {
  if (!lap) return "";
  const { baris, kriteria } = urutkanMeta(lap.grup || [], kriteriaId);
  const p = lap.rentangLead || {};
  const meta = [["Periode lead (WIB)", `${p.dari ?? ""} s/d ${p.sampai ?? ""}`], ["Level", p.level ?? ""], ["Urut", kriteria.label],
    ["Definisi", "Ber-order, membayar, dan lunas (ledger) adalah tiga metrik terpisah; nilai order bukan uang diterima; null dikosongkan"]];
  const kolom = ["Peringkat", "Status", "Nama", "ID", "Lead", "Spam", "Customer ber-order", "Customer membayar", "Customer lunas (ledger)", "Nilai order (Rp)", "Uang diterima bersih (Rp)", "Spend (Rp)", "CPA lunas (Rp)", "Alasan CPA kosong", "Booked ROAS", "Cash ROAS"];
  const isi = baris.map(({ g, peringkat }) => {
    const lvl = g.level; const ent = lvl === "campaign" ? g.campaign : lvl === "adset" ? g.adSet : g.ad;
    const b = g.biaya || {};
    return [peringkat ?? "", g.status, g.status === "MAPPED" ? ent?.nama ?? "" : "", g.status === "MAPPED" ? ent?.id ?? "" : (g.ad?.id ?? ""), g.lead?.unik, g.lead?.spam, g.customerDenganOrder, g.customerPernahMembayar, g.closingUtama?.customerLunasTerbuktiLedger,
      g.bookedValue, g.uangBersihLedger, b.spend, b.cpa, b.cpa == null ? alasanKosong(b.alasanNull?.cpa) : "", b.bookedRoas, b.cashRoas];
  });
  return [...meta.map((r) => r.map(cel).join(",")), "", kolom.map(cel).join(","), ...isi.map((r) => r.map(cel).join(","))].join("\r\n") + "\r\n";
}
export const namaBerkasCsvMeta = (lap) => `marketing-meta-${lap?.rentangLead?.level ?? "campaign"}-${lap?.rentangLead?.dari ?? "x"}_${lap?.rentangLead?.sampai ?? "x"}.csv`;

export { DASAR_BIAYA_LABEL };

// ── TAMPILAN KOHORT UMUR (Meta) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Baris "virtual" untuk umur kohort ≥ N hari: nilai yang sama persis dengan yang ditampilkan (kematangan server) dipakai juga untuk peringkat, sehingga urutan = angka di layar.
 * Kohort tidak memuat pembayaran bersih/customer membayar/DP → null (bukan 0), peringkat kriteria itu "tanpa peringkat".
 */
export function terapkanUmur(g, umur = "semua") {
  const k = umur === "semua" ? null : g.kematangan?.[umur];
  if (!k) return g;
  return {
    ...g, customerDenganOrder: k.customerDenganOrder, orderEligible: k.orderEligible, bookedValue: k.bookedValue,
    closingUtama: { ...(g.closingUtama || {}), customerLunasTerbuktiLedger: k.customerLunasTerbuktiLedger },
    uangLedger: k.uangLedger, uangBersihLedger: null, customerPernahMembayar: null, customerLunasMenurutCrm: null, orderPernahDp: null,
    _leadMatang: k.leadMatang, _kohort: true,
  };
}

/** Konversi TOTAL = Σ ber-order ÷ Σ lead (pembilang dan penyebut total — bukan rata-rata rasio per baris). Pembulatan sama dengan server (2 desimal). */
export function konversiTotal(t) {
  if (!t) return { nilai: null, pembilang: null, penyebut: null };
  const p = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : null);
  return { nilai: p(t.berOrder, t.lead), pembilang: t.berOrder, penyebut: t.lead, nilaiNonSpam: p(t.berOrder, t.leadSah), penyebutNonSpam: t.leadSah };
}
