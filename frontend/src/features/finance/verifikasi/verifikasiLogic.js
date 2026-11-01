// Logika PENYAJIAN halaman Verifikasi pembayaran Finance (murni, tanpa React). Hanya menata data yang SUDAH dikirim server
// (GET /api/finance/customer-payments, /penerimaan/klaim-lunas, /penerimaan/lunas-belum-dicatat, /pemasukan/ringkasan).
// Tidak ada rumus baru: angka periode memakai penjumlahan yang SAMA dengan halaman lama (pembayaran aktif = tidak dibatalkan).

/** Antrean/status. `id` = nilai ?tab= LAMA (tidak berubah; "" = semua). `utama` = tampil sebagai pilihan utama. `semuaPeriode` = tidak terikat periode. */
export const ANTREAN = Object.freeze([
  { id: "perlu", label: "Perlu verifikasi", judul: "Perlu verifikasi", utama: true, semuaPeriode: true,
    ringkas: "Dua antrean berbeda: order yang ditandai lunas oleh Sales, dan pembayaran yang sudah tercatat tetapi menunggu verifikasi." },
  { id: "lunas_crm", label: "Ditandai lunas oleh Sales", judul: "Ditandai lunas oleh Sales", utama: true, semuaPeriode: true, hanyaKlaim: true,
    ringkas: "Order yang ditandai lunas oleh Sales. Belum ada uang masuk yang terbukti sampai Finance memverifikasi." },
  { id: "terverifikasi", label: "Terverifikasi", judul: "Pembayaran terverifikasi", utama: true,
    ringkas: "Pembayaran yang sudah diperiksa Finance dan masuk pembukuan." },
  { id: "dibatalkan", label: "Dibatalkan", judul: "Pembayaran dibatalkan",
    ringkas: "Pembayaran yang dibatalkan atau diganti versi baru. Barisnya tetap ada supaya bisa ditelusuri; nilainya tidak dihitung." },
  { id: "semua", label: "Semua pembayaran", judul: "Semua pembayaran",
    ringkas: "Semua pembayaran pada periode terpilih, apa pun statusnya." },
]);
// "semua" = tanpa filter status (dulu kunci kosong "", yang selalu ditolak useUrlTab dan memantul kembali ke "perlu").
export const TAB_URL = Object.freeze(["perlu", "lunas_crm", "terverifikasi", "dibatalkan", "semua"]);
/** Nilai `status` untuk server dari id antrean ("semua" → kosong). */
export const statusServer = (id) => (id === "semua" ? "" : id);
export const antreanDari = (id) => ANTREAN.find((a) => a.id === id) ?? ANTREAN[0];

export const LABEL_CARA_BAYAR = Object.freeze({ TRANSFER: "Transfer", CASH: "Tunai", QRIS: "QRIS", CARD: "Kartu" });
export const LABEL_JENIS = Object.freeze({ DP: "DP", CICILAN: "Cicilan", PELUNASAN: "Pelunasan" });

/** Rentang lebar untuk antrean tanpa periode — SAMA dengan yang dipakai server untuk export antrean (export/pembayaran.js). */
export const SEMUA_PERIODE = Object.freeze({ from: "2000-01-01", to: "2100-01-01" });
/** Batas baris yang dikirim server untuk layar (customer-payments `take`). Di atas ini daftar bisa terpotong. */
export const BATAS_BARIS_SERVER = 300;

/**
 * Status satu pembayaran. Empat makna yang BERBEDA (jangan disamakan):
 *  - MENUNGGU       : tercatat, belum diperiksa Finance. Dihitung sebagai "tercatat", bukan uang masuk terverifikasi.
 *  - TERVERIFIKASI  : sudah diperiksa Finance dan masuk pembukuan.
 *  - DIBATALKAN     : dibatalkan (alasan tercatat). Nilai asli tetap ditampilkan; TIDAK dihitung.
 *  - DIGANTI        : dibatalkan karena diganti versi koreksi. TIDAK dihitung; pembayaran penggantinya yang dihitung.
 */
export function statusPembayaran(p) {
  if (p.cancelledAt) return p.replacedBy
    ? { kode: "DIGANTI", label: "Diganti versi baru", nada: "orange", tidakDihitung: true }
    : { kode: "DIBATALKAN", label: "Dibatalkan", nada: "red", tidakDihitung: true };
  if (p.terverifikasi) return { kode: "TERVERIFIKASI", label: "Terverifikasi", nada: "green", tidakDihitung: false };
  return { kode: "MENUNGGU", label: "Menunggu verifikasi", nada: "orange", tidakDihitung: false };
}

export const tidakDihitung = (p) => !!p?.cancelledAt;

/** Foto bukti sebuah pembayaran: proofPhotoUrls, atau proofPhotoUrl lama bila daftar kosong (sama dengan BuktiThumb.daftarBukti, diulang di sini agar berkas ini murni). */
export const daftarBukti = (p) => (p?.proofPhotoUrls?.length ? p.proofPhotoUrls : p?.proofPhotoUrl ? [p.proofPhotoUrl] : []);

/** Keadaan bukti satu pembayaran: jumlah foto yang terunggah. "Terunggah" BUKAN "terverifikasi" — Finance yang memeriksa isinya. */
export function keadaanBukti(p) {
  const n = daftarBukti(p).length;
  return { jumlah: n, ada: n > 0, label: n > 0 ? `${n} foto bukti` : "Belum ada bukti" };
}

/** Angka periode: pembayaran aktif (tidak dibatalkan) dipisah terverifikasi / menunggu. Penjumlahan SAMA dengan halaman lama. */
export function ringkasPeriode(semua) {
  const aktif = (semua ?? []).filter((p) => !p.cancelledAt);
  const jumlahRp = (arr) => arr.reduce((s, p) => s + (p.amount || 0), 0);
  const sudahList = aktif.filter((p) => p.terverifikasi);
  const belumList = aktif.filter((p) => !p.terverifikasi);
  return {
    aktif: aktif.length, total: jumlahRp(aktif),
    sudah: jumlahRp(sudahList), sudahJumlah: sudahList.length,
    belum: jumlahRp(belumList), belumJumlah: belumList.length,
    dibatalkan: (semua ?? []).length - aktif.length,
  };
}

/** Daftar mungkin terpotong server (300 baris): layar harus jujur bahwa angka dihitung dari baris yang dimuat. */
export const daftarTerpotong = (jumlahBaris) => (Number(jumlahBaris) || 0) >= BATAS_BARIS_SERVER;

/** Pembayaran pengganti: versi yang menggantikan `p` (p.replacedBy.id) dan versi yang digantikan `p` (p.replacesPaymentId), bila ada di daftar yang dimuat. */
export function relasiVersi(p, daftar) {
  const per = new Map((daftar ?? []).map((x) => [x.id, x]));
  return {
    penggantiId: p.replacedBy?.id ?? null,
    pengganti: p.replacedBy?.id ? per.get(p.replacedBy.id) ?? null : null,
    digantikanId: p.replacesPaymentId ?? null,
    digantikan: p.replacesPaymentId ? per.get(p.replacesPaymentId) ?? null : null,
  };
}

/** Alasan batal untuk ditampilkan: teks server apa adanya + siapa/kapan. Kosong → null (jangan mengarang alasan). */
export function alasanBatal(p) {
  if (!p?.cancelledAt) return null;
  return { alasan: String(p.cancelReason ?? "").trim() || null, oleh: p.cancelledBy?.name ?? null, pada: p.cancelledAt };
}

/** Opsi rekening untuk filter, dari pembayaran yang dimuat (id → nama). Pembayaran tanpa rekening tidak punya opsi sendiri. */
export function opsiRekening(payments) {
  const per = new Map();
  for (const p of payments ?? []) if (p.cashAccount?.id) per.set(p.cashAccount.id, p.cashAccount.name);
  return [...per.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "id"));
}

/** Jumlah filter di "Filter lainnya" yang aktif (Dibagi ke order lain, Foto bukti). */
export const jumlahFilterLanjutan = ({ alokasi, bukti }) => (alokasi ? 1 : 0) + (bukti ? 1 : 0);

/** Kalimat tentang gerbang verifikasi yang sedang berlaku (dari `gate` server). Tidak mengarang tanggal. */
export function teksGerbang(gate) {
  return gate?.enabled
    ? "Gerbang verifikasi menyala: status Lunas di CRM baru berlaku setelah pembayarannya diverifikasi di sini (untuk pembayaran baru; yang lama tidak berubah)."
    : "Gerbang verifikasi mati: bila Sales menandai order Lunas, statusnya langsung berlaku di CRM. Tugas Finance di sini memastikan uangnya benar-benar masuk. Admin bisa menyalakan gerbang di Pengaturan Finance.";
}

/** Respons lama (balapan): hanya permintaan TERAKHIR yang boleh mengisi layar. */
export function buatPenjaga() {
  let n = 0;
  return { mulai: () => ++n, terbaru: (saya) => saya === n };
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const urai = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "")); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
const akhirBulan = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Label singkat periode untuk judul angka: satu bulan penuh → "Okt 2026"; selain itu "1 Okt – 31 Okt 2026" / "1 Okt 2026 – 5 Jan 2027". */
export function labelPeriode(from, to) {
  const a = urai(from); const b = urai(to);
  if (!a || !b) return "—";
  if (a.y === b.y && a.m === b.m && a.d === 1 && b.d === akhirBulan(b.y, b.m)) return `${BULAN[a.m - 1]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${BULAN[a.m - 1]} – ${b.d} ${BULAN[b.m - 1]} ${b.y}`;
  return `${a.d} ${BULAN[a.m - 1]} ${a.y} – ${b.d} ${BULAN[b.m - 1]} ${b.y}`;
}

/** Label tab untuk Export Excel: SENGAJA tetap memakai nama lama supaya berkas Excel tidak berubah walau nama tab di layar disederhanakan. */
export const LABEL_TAB_EXPORT = Object.freeze({ perlu: "Perlu Verifikasi Finance", lunas_crm: "Klaim Lunas dari Sales", terverifikasi: "Uang Masuk Terverifikasi", dibatalkan: "Dibatalkan", semua: "Semua" });
