// Logika PENYAJIAN halaman Kas & Bank (murni, tanpa React). Hanya menyusun ulang field yang SUDAH dikirim server:
// GET /finance/cash-accounts (saldo buku per rekening aktif), GET /finance/rekon-bank/kartu (saldo koran/hitung fisik, selisih, belum cocok),
// GET /finance/buku/rekening/:id/mutasi, GET /finance/transfers. Tidak ada rumus saldo, selisih, atau status baru di sini.
import { jenisRekening } from "../ringkasanTampilan.js";
import { keSen } from "../rekonBankLogic.js";

export const LABEL_JENIS = Object.freeze({ KAS: "Kas tunai", BANK: "Rekening bank", EWALLET: "E-wallet / QRIS" });
export const BATAS_TRANSFER = 200; // batas take di GET /finance/transfers (server tidak mengirim penanda terpotong)

/** Tab halaman. "mutasi" (deep link lama ?tab=mutasi) menampilkan daftar rekening yang sama dengan "rekening". */
export const TAB_KAS = Object.freeze(["rekening", "mutasi", "transfer", "pemasukan"]);
export const tabAktifKas = (tab) => (tab === "mutasi" ? "rekening" : tab);

/** Nomor rekening disamarkan untuk kartu ("••••3900"); nomor lengkap hanya di rincian/menu. Nomor ≤ 4 karakter ditampilkan apa adanya. */
export function nomorSamar(nomor) {
  const n = String(nomor ?? "").replace(/\s+/g, "");
  if (!n) return "";
  return n.length <= 4 ? n : `••••${n.slice(-4)}`;
}

/** Warna kartu = identitas visual jenis rekening (BUKAN penilaian keamanan atau kecocokan saldo). */
export function warnaKartu(r) {
  const { jenis } = jenisRekening(r);
  if (jenis === "TUNAI") return "lime";
  if (jenis === "EWALLET") return "muda";
  if (jenis === "BCA") return "putih";
  return "lavender";
}

const norm = (v) => String(v ?? "").toLowerCase();
const angka = (x) => `${Math.round(Number(x) || 0)} ${(Number(x) || 0).toLocaleString("id-ID")}`;

/** Pencarian & filter rekening (sisi-klien) — sama dengan halaman lama: nama, jenis, bank, nomor, pemilik, akun COA, saldo, status. */
export function saringRekening(daftar, { q, jenis, status }) {
  const kata = norm(q).split(/\s+/).filter(Boolean);
  return (daftar || []).filter((a) => {
    if (jenis && a.kind !== jenis) return false;
    if (status && (status === "aktif") !== !!a.active) return false;
    if (!kata.length) return true;
    const gudang = [a.name, a.kind, LABEL_JENIS[a.kind], a.accountNumber, a.bankName, a.accountHolder, a.account?.code, a.account?.name, a.active ? angka(a.saldo) : "", a.active ? "aktif" : "nonaktif"].filter((x) => x !== null && x !== undefined).join(" ").toLowerCase();
    return kata.every((k) => gudang.includes(k));
  });
}

/**
 * Status pencocokan satu rekening untuk kartu. Membedakan: fitur belum aktif · rekening koran belum diimpor · kas fisik belum dihitung ·
 * selisih tercatat · sama pada tanggal tertentu. "Data tidak tersedia" TIDAK pernah menjadi Rp0, dan "0 baris belum dipasangkan" tidak dibaca
 * sebagai "semua sudah diperiksa" (tanpa impor server selalu mengirim 0).
 * `k` = elemen GET /finance/rekon-bank/kartu untuk rekening ini (null bila rekening nonaktif / kartu belum termuat); `sakelarAktif` = pengaturan fitur.
 */
export function statusPencocokan({ kind, k, sakelarAktif, kartuTermuat = true, kartuGagal = false }) {
  if (kartuGagal) return { kode: "gagal", label: "Status pencocokan tidak dapat dimuat", nada: "redup" };
  if (!kartuTermuat) return { kode: "memuat", label: "Memuat status pencocokan…", nada: "redup" };
  if (!k) return { kode: "tidak-tersedia", label: "Status pencocokan tidak tersedia", nada: "redup" };
  const kas = kind === "KAS";
  const sumber = k.sumberSaldoBank === "OPNAME_FISIK" ? "hitung fisik" : "rekening koran";
  if (k.saldoBank != null) {
    const sen = k.selisih != null ? keSen(k.selisih) : null;
    if (sen === 0) return { kode: "sama", label: `Sama dengan ${sumber}`, tanggal: k.tanggalSaldoBank, nada: "hijau", sumber };
    if (sen === null) return { kode: "diketahui", label: `Saldo ${sumber} tercatat`, tanggal: k.tanggalSaldoBank, nada: "netral", sumber };
    return { kode: "selisih", label: `Selisih dengan ${sumber}`, selisih: k.selisih, tanggal: k.tanggalSaldoBank, nada: "perhatian", sumber };
  }
  // Fitur pencocokan nonaktif dijelaskan SEKALI oleh strip halaman; di kartu, "belum diimpor / belum dihitung" tetap benar apa pun status fiturnya.
  return kas
    ? { kode: "kas-belum-dihitung", label: "Kas fisik belum dihitung", nada: "netral" }
    : { kode: "koran-belum-diimpor", label: "Rekening koran belum diimpor", nada: "netral" };
}

/** Baris tambahan pada kartu: baris belum dipasangkan (hanya bila > 0) dan tanggal rekonsiliasi terakhir (hanya bila fitur aktif). */
export function catatanKartu({ k, sakelarAktif }) {
  if (!k) return [];
  const out = [];
  if (k.belumCocok > 0) out.push({ kode: "belum-dipasangkan", teks: `${Number(k.belumCocok).toLocaleString("id-ID")} baris belum dipasangkan` });
  if (sakelarAktif) out.push(k.terakhirDirekonsiliasi ? { kode: "rekon", tanggal: k.terakhirDirekonsiliasi } : { kode: "rekon-belum", teks: "Belum pernah direkonsiliasi" });
  return out;
}

/** Teks cakupan "Total saldo pembukuan": posisi tanggal, jumlah rekening aktif, dan batasnya. Total datang dari server (rekening aktif saja). */
export function cakupanTotal({ accounts, hariIni }) {
  const aktif = (accounts || []).filter((a) => a.active).length;
  const nonaktif = (accounts || []).length - aktif;
  return { aktif, nonaktif, posisi: hariIni };
}

/** Kalimat hasil daftar rekening. */
export function kalimatRekening({ tampil, total }) {
  return tampil === total ? `${total} rekening` : `${tampil} dari ${total} rekening`;
}

// ── Mutasi Buku ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Kalimat hasil mutasi + penjelasan saldo berjalan. Saldo tiap baris dihitung server atas SELURUH urutan periode, bukan baris yang terlihat. */
export function kalimatMutasi({ total, jumlahMutasi, disaring }) {
  const t = Number(total) || 0; const j = Number(jumlahMutasi) || 0;
  return { teks: disaring ? `${t.toLocaleString("id-ID")} dari ${j.toLocaleString("id-ID")} mutasi` : `${j.toLocaleString("id-ID")} mutasi`, catatSaldo: disaring ? "Saldo berjalan mengikuti seluruh urutan transaksi, termasuk yang tidak tampil karena filter." : null };
}

/** Saldo akhir periode bukan saldo terbaru: beri tahu bila akhir periode ≠ posisi hari ini (kartu rekening memakai posisi hari ini). */
export function catatanPosisiMutasi({ periodeTo, hariIni }) {
  if (!periodeTo || !hariIni || periodeTo === hariIni) return null;
  return periodeTo > hariIni ? null : `Saldo akhir adalah posisi per ${periodeTo}, bukan saldo terbaru; daftar rekening menampilkan posisi hari ini.`;
}

/** Status pencocokan satu baris mutasi buku (statusCocok dari server): null = belum dipasangkan. */
export function pencocokanBaris(b) {
  const peta = { COCOK_OTOMATIS: ["Cocok otomatis", "hijau"], COCOK_MANUAL: ["Cocok manual", "hijau"], DIKECUALIKAN: ["Dikecualikan", "netral"] };
  const p = peta[b?.statusCocok];
  return p ? { label: p[0], nada: p[1] } : { label: "Belum dipasangkan", nada: "redup" };
}

export const LABEL_STATUS_JURNAL = Object.freeze({ POSTED: "Terposting", REVERSED: "Sudah dibalik" });

// ── Transfer ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Status transfer: terposting atau dibatalkan (jurnal pembalik). Transfer tidak punya tahap draft/persetujuan. */
export const statusTransfer = (t) => (t?.cancelledAt ? { kode: "batal", label: "Dibatalkan", nada: "merah" } : { kode: "posting", label: "Terposting", nada: "hijau" });

/** Komponen transfer persis dari server: nilai transfer, biaya admin, total keluar dari asal (totalKeluarRekening), diterima tujuan (nominalDiterima). Tidak ada angka yang ditebak. */
export function komponenTransfer(t) {
  const biaya = Number(t?.biayaAdmin ?? t?.feeAmount ?? 0);
  return {
    nilai: Number(t?.amount) || 0,
    biaya: biaya > 0 ? biaya : 0,
    totalKeluar: t?.totalKeluarRekening != null ? Number(t.totalKeluarRekening) : null,
    diterima: t?.nominalDiterima != null ? Number(t.nominalDiterima) : null,
  };
}

export function saringTransfer(daftar, { q, dari, ke, status, tanggalPendek }) {
  const kata = norm(q).split(/\s+/).filter(Boolean);
  return (daftar || []).filter((t) => {
    if (dari && t.fromAccount?.name !== dari) return false;
    if (ke && t.toAccount?.name !== ke) return false;
    if (status && (status === "batal") !== !!t.cancelledAt) return false;
    if (!kata.length) return true;
    const gudang = [t.transferNumber, t.date, tanggalPendek ? tanggalPendek(t.date) : "", t.fromAccount?.name, t.toAccount?.name, angka(t.amount), angka(t.feeAmount), t.note, t.notes, t.reference, t.cancelledAt ? "dibatalkan" : "terposting"].filter((x) => x !== null && x !== undefined).join(" ").toLowerCase();
    return kata.every((k) => gudang.includes(k));
  });
}

/** Batas pemuatan transfer: server memuat paling banyak 200 per periode; baru diaku terpotong bila jumlah termuat = batas. */
export function kalimatTransfer({ tampil, termuat }) {
  const t = tampil === termuat ? `${termuat} transfer` : `${tampil} dari ${termuat} transfer`;
  return { teks: t, catatan: termuat >= BATAS_TRANSFER ? `Daftar memuat paling banyak ${BATAS_TRANSFER} transfer terbaru pada periode ini. Persempit periode untuk melihat sisanya.` : null };
}

/** Peta id → rekening (untuk logo bank pada baris transfer, yang hanya membawa id & nama rekening). */
export const petaRekening = (accounts) => new Map((accounts || []).map((a) => [a.id, a]));
