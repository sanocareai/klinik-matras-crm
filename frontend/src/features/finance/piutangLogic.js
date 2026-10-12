// Logika murni layar "Piutang & Refund" (tanpa React/DOM supaya diuji `node --test`). SEMUA angka datang dari server
// (GET /finance/reports/receivables, …/diagnosis); di sini hanya menyaring, mengurutkan, dan memberi label — TIDAK menghitung ulang saldo/nominal.

export const TAB_PIUTANG = Object.freeze([
  { key: "daftar", label: "Daftar Piutang" },
  { key: "jatuh-tempo", label: "Jatuh Tempo" },
  { key: "perlu-tindakan", label: "Perlu Tindakan" },
  { key: "refund", label: "Refund" },
  { key: "diagnosis", label: "Diagnosis & Penjelasan" },
]);
export const TAB_PIUTANG_KUNCI = TAB_PIUTANG.map((t) => t.key);

export const STATUS_BAYAR_OPSI = Object.freeze([["BELUM_BAYAR", "Belum bayar"], ["DIBAYAR_SEBAGIAN", "Dibayar sebagian"]]);
export const LABEL_STATUS_BAYAR = Object.freeze({ BELUM_BAYAR: "Belum bayar", DIBAYAR_SEBAGIAN: "Dibayar sebagian" });
export const URUT_OPSI = Object.freeze([["sisa", "Sisa terbesar"], ["lama", "Paling lama"]]);
export const UMUR_OPSI = Object.freeze([
  ["belum", "Belum jatuh tempo"], ["tujuh_hari", "Jatuh tempo ≤7 hari"], ["1_30", "Lewat 1–30 hari"], ["31_60", "Lewat 31–60 hari"], ["60_plus", "Lewat >60 hari"],
]);

/** Periode bawaan layar Piutang: posisi HARI INI (WIB). "Jatuh tempo" & "≤7 hari" selalu relatif terhadap posisi ini. */
export function periodeBawaanPiutang(now = new Date()) {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const y = wib.getUTCFullYear(); const m = p(wib.getUTCMonth() + 1);
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${p(wib.getUTCDate())}` };
}

/** Kelompok umur — SAMA dengan definisi server: lewat jatuh tempo = hariLewat > 0; ≤7 hari = jatuh tempo hari ini s.d. 7 hari ke depan (−7 ≤ hariLewat ≤ 0). */
export function cocokUmur(hariLewat, kelompok) {
  const h = Number(hariLewat);
  if (!kelompok || !Number.isFinite(h)) return true;
  switch (kelompok) {
    case "belum": return h <= 0;
    case "tujuh_hari": return h <= 0 && h >= -7;
    case "1_30": return h >= 1 && h <= 30;
    case "31_60": return h >= 31 && h <= 60;
    case "60_plus": return h > 60;
    default: return true;
  }
}

/** Baris tab: "jatuh-tempo" = yang sudah lewat jatuh tempo (definisi server `jatuhTempo.lewat`); selain itu semua. */
export const barisUntukTab = (baris, tab) => (tab === "jatuh-tempo" ? (baris || []).filter((b) => Number(b.hariLewat) > 0) : (baris || []));

/** Nominal bisa dicari sebagai "150000" maupun "150.000". */
export function teksNominal(x) {
  const n = Math.round(Number(x));
  if (!Number.isFinite(n)) return "";
  return `${n} ${n.toLocaleString("id-ID")}`;
}

const kecil = (v) => String(v ?? "").toLowerCase();

/** Saring + urutkan baris piutang. `filter` = { q, status, umur, sales, urut }. Tidak mengubah angka baris. */
export function saringPiutang(baris, { q = "", status = "", umur = "", sales = "", urut = "sisa" } = {}) {
  const kata = kecil(q).trim().split(/\s+/).filter(Boolean);
  const hasil = (baris || []).filter((b) => {
    if (status && b.statusBayar !== status) return false;
    if (sales && b.salesName !== sales) return false;
    if (!cocokUmur(b.hariLewat, umur)) return false;
    if (!kata.length) return true;
    const gudang = [b.orderNumber, b.invoiceNumber, b.customerName, b.salesName, teksNominal(b.sisaTagihan), teksNominal(b.tagihanDiakui)].map(kecil).join(" ");
    return kata.every((k) => gudang.includes(k));
  });
  const kunci = urut === "lama" ? (b) => Number(b.hariLewat) || 0 : (b) => Number(b.sisaTagihan) || 0;
  return [...hasil].sort((a, b) => kunci(b) - kunci(a));
}

/** Jumlah filter aktif (untuk badge tombol Filter di mobile). Urutan bawaan "sisa" tidak dihitung. */
export const jumlahFilterAktif = ({ status, umur, sales, urut }) => [status, umur, sales, urut && urut !== "sisa" ? urut : ""].filter(Boolean).length;

/** Strip ringkas di tab bawaan: "Saldo buku cocok · N order perlu tindakan". Data dari diagnosis server; null bila belum dimuat. */
export function ringkasDiagnosis(diag) {
  if (!diag) return null;
  const per = diag.rekonsiliasi?.perKategori ?? {};
  const totalKategori = Object.values(per).reduce((s, k) => s + (k?.total ?? 0), 0);
  const neraca = diag.neraca ?? 0;
  const cocok = Math.abs(diag.rekonsiliasi?.selisih ?? 0) < 0.5 && Math.abs(totalKategori - neraca) < 0.5;
  return { cocok, perluTindakan: diag.perluTindakan?.jumlah ?? 0, neraca };
}

/**
 * Kelompok tab "Perlu Tindakan" dari read-model server `perluTindakanOrder`: SATU order = SATU entri walau punya beberapa masalah (alasan digabung di server).
 * Entri dikelompokkan menurut ALASAN UTAMA (urutan prioritas server = `alasanTindakan`); alasan lain tampil sebagai "+N alasan lain" dan lengkap di drawer.
 * Mengembalikan [{ kode, label, tingkat, baris: [{ orderId, orderNumber, customerName, salesName, nilai, alasan[], alasanLain, penjelasan, tindakan }] }] — hanya kelompok berisi.
 */
export function kelompokPerluTindakan(diag) {
  if (!diag) return [];
  const daftar = diag.perluTindakanOrder ?? [];
  const urut = Object.keys(diag.alasanTindakan ?? {});
  const hasil = new Map();
  for (const e of daftar) {
    const utama = e.alasan?.[0];
    if (!utama) continue;
    const g = hasil.get(e.alasanUtama) ?? { kode: e.alasanUtama, label: utama.label, tingkat: utama.tingkat ?? "periksa", baris: [] };
    g.baris.push({
      orderId: e.orderId, orderNumber: e.orderNumber, customerName: e.customerName, salesName: e.salesName ?? null, nilai: e.nilai ?? 0,
      alasan: e.alasan, alasanLain: Math.max(e.alasan.length - 1, 0), penjelasan: utama.penjelasan, tindakan: utama.tindakan,
    });
    hasil.set(e.alasanUtama, g);
  }
  return [...hasil.values()].sort((x, y) => (urut.indexOf(x.kode) === -1 ? 99 : urut.indexOf(x.kode)) - (urut.indexOf(y.kode) === -1 ? 99 : urut.indexOf(y.kode)));
}

/** Alasan lengkap satu order dari diagnosis (untuk drawer): [] bila order tidak masuk Perlu Tindakan. */
export function alasanOrder(diag, orderId) {
  return (diag?.perluTindakanOrder ?? []).find((e) => e.orderId === orderId)?.alasan ?? [];
}

/** Penjelasan scope Export untuk filterLabel (server menampilkannya di berkas). `tab` = kunci tab aktif. */
export function labelScopeExport(tab, { jumlahTampil, jumlahTotal, filterAktif, posisiTeks = null }) {
  const nama = TAB_PIUTANG.find((t) => t.key === tab)?.label ?? tab;
  const bagian = [["Tab", nama]];
  if (posisiTeks) bagian.push(["Cutoff posisi", `saldo buku besar sampai ${posisiTeks} (WIB, inklusif) — bukan filter transaksi periode`]);
  if (tab === "daftar" || tab === "jatuh-tempo") bagian.push(["Piutang", `${jumlahTampil} dari ${jumlahTotal} order${filterAktif ? " (sesuai filter aktif)" : ""}`]);
  if (tab === "perlu-tindakan" || tab === "diagnosis") bagian.push(["Catatan", "Berkas memuat daftar Piutang & Refund; rincian diagnosis tidak ikut diekspor"]);
  return bagian;
}
