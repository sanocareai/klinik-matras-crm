// Logika murni "Uang muka PO → penerapan ke faktur supplier". TIDAK ada rumus keuangan baru di sini: kelayakan (supplier sama, uang muka DIBAYAR, saldo > 0, status faktur,
// samaPO/bedaPO) diputuskan SERVER lewat GET /finance/purchase-orders/uang-muka/faktur/:billId/kandidat. Yang ada hanya: memilih bagian respons itu yang boleh diperingatkan
// (hanya uang muka yang tertaut ke PO faktur yang sama), aritmetika sen untuk pratinjau, dan kesiapan formulir. Validasi akhir tetap di server.
import { formatUangTepat } from "../tagihan/tagihanLogika.js";
import { kesiapanTerapkan } from "../uangMukaLogic.js";

const sen = (n) => Math.round((Number(n) || 0) * 100);
const rupiah = (s) => s / 100;

/** Batas faktur yang diperiksa otomatis untuk penanda/peringatan (satu panggilan kandidat per faktur). Di atas batas, layar WAJIB menyatakan cakupannya — tidak boleh tampak "semua sudah diperiksa". */
export const BATAS_PERIKSA_UANG_MUKA = 60;

/** Kalimat cakupan pemeriksaan uang muka di daftar; null bila semua kandidat diperiksa dan tidak ada yang gagal. */
export function teksCakupanPeriksa({ total = 0, diperiksa = 0, terpotong = false, gagal = 0 } = {}) {
  const bagian = [];
  if (terpotong) bagian.push(`Penanda uang muka hanya diperiksa untuk ${diperiksa} dari ${total} faktur bersisa yang tampil. Faktur tanpa penanda BELUM tentu bebas uang muka — rincian faktur dan pembayaran tetap memeriksanya.`);
  if (gagal > 0) bagian.push(`Pemeriksaan uang muka gagal untuk ${gagal} faktur; baris tanpa penanda belum diperiksa.`);
  return bagian.length ? bagian.join(" ") : null;
}

/** Kode galat server yang berarti "data yang Anda lihat sudah basi": isian dipertahankan, pengguna diminta memuat ulang. */
export const KODE_PERLU_MUAT_ULANG = ["SISA_FAKTUR_BERUBAH", "MELEBIHI_SALDO_UANG_MUKA", "MELEBIHI_SISA_FAKTUR", "FAKTUR_TIDAK_BISA_DITERAPKAN"];

/**
 * Ringkasan kelayakan satu faktur dari respons kandidat server.
 * - `sesuai`: hanya uang muka yang `samaPO` (tertaut jelas ke PO faktur ini). Hanya ini yang memicu peringatan/tawaran.
 * - `lain`: uang muka supplier yang sama tetapi PO lain / tanpa PO → TIDAK pernah dipasangkan otomatis; hanya bisa dipilih eksplisit.
 * - `jumlah` = yang bisa mengurangi faktur ini = min(saldo uang muka PO ini, sisa faktur) — sama arti dengan `saran` server per uang muka.
 */
export function ringkasKelayakan(data) {
  const f = data?.faktur;
  const dasar = { ada: false, jumlah: 0, saldoPO: 0, sisa: f ? Number(f.sisaUtang) || 0 : 0, sesuai: [], lain: [], sebab: "" };
  if (!f) return { ...dasar, sebab: "tanpa-data" };
  const semua = Array.isArray(data.uangMuka) ? data.uangMuka : [];
  const sesuai = semua.filter((d) => d.samaPO);
  const lain = semua.filter((d) => !d.samaPO);
  const dasarIsi = { ...dasar, sesuai, lain };
  if (!f.bolehDiterapkan) return { ...dasarIsi, sebab: "status-faktur" };
  const sisa = sen(f.sisaUtang);
  if (sisa <= 0) return { ...dasarIsi, sebab: "sisa-nol" };
  const saldo = sesuai.reduce((s, d) => s + sen(d.saldoBelumDiterapkan), 0);
  const jumlah = Math.min(saldo, sisa);
  return { ...dasarIsi, ada: sesuai.length > 0 && jumlah > 0, jumlah: rupiah(jumlah), saldoPO: rupiah(saldo), sisa: rupiah(sisa), sebab: sesuai.length === 0 ? "tanpa-uang-muka-po" : "" };
}

/** Kalimat peringatan baku (nominal = saldo uang muka PO ini yang belum diterapkan, dari server; dengan sen bila ada). */
export function teksPeringatanUangMuka(r) {
  const dasar = `Ada uang muka ${formatUangTepat(r.saldoPO)} untuk PO ini yang belum diterapkan. Periksa sebelum mencatat pembayaran baru.`;
  return sen(r.saldoPO) > sen(r.jumlah) ? `${dasar} Yang bisa mengurangi sisa tagihan ini: ${formatUangTepat(r.jumlah)}.` : dasar;
}

/** Pilihan awal dialog: hanya uang muka yang tertaut ke PO yang sama. Tanpa kecocokan jelas → TIDAK ada yang terpilih (tidak menebak pasangan). */
export function pilihanAwal(data) {
  const pertama = (data?.uangMuka || []).find((d) => d.samaPO);
  return pertama ? { id: pertama.id, nominal: String(pertama.saran) } : { id: null, nominal: "" };
}

/** Nominal maksimum yang boleh diterapkan untuk satu uang muka pada faktur ini (sen-tepat). */
export function maksimalPenerapan(uangMuka, sisaFaktur) {
  if (!uangMuka) return 0;
  return rupiah(Math.max(0, Math.min(sen(uangMuka.saldoBelumDiterapkan), sen(sisaFaktur))));
}

/** Pratinjau sebelum → sesudah (hanya pengurangan sen dari angka server; konfirmasi server menentukan hasil akhir). */
export function pratinjauPenerapan({ sisaFaktur, uangMuka, nominal }) {
  const n = sen(nominal);
  const sisaSebelum = sen(sisaFaktur);
  const saldoSebelum = sen(uangMuka?.saldoBelumDiterapkan);
  return {
    sisaSebelum: rupiah(sisaSebelum), sisaSesudah: rupiah(Math.max(0, sisaSebelum - n)),
    saldoSebelum: rupiah(saldoSebelum), saldoSesudah: rupiah(Math.max(0, saldoSebelum - n)),
    melunasi: n > 0 && sisaSebelum - n <= 0,
  };
}

/** Uang muka yang BUKAN tertaut ke PO faktur ini (PO lain atau tanpa PO) butuh centang konfirmasi eksplisit di layar. */
export const perluKonfirmasiPasangan = (uangMuka) => !!uangMuka && !uangMuka.samaPO;

export function kesiapanPenerapan({ uangMuka, nominal, sisaFaktur, konfirmasi, konfirmasiPasangan = false }) {
  if (uangMuka && perluKonfirmasiPasangan(uangMuka) && !konfirmasiPasangan) {
    return { siap: false, pesan: uangMuka.bedaPO ? "Uang muka ini dibayar untuk PO lain — centang konfirmasi pengalihan." : "Uang muka ini tidak tertaut ke PO faktur ini — centang konfirmasi pasangan." };
  }
  return kesiapanTerapkan({ uangMuka, nominal, sisaFaktur, konfirmasi, konfirmasiBedaPO: !!uangMuka?.bedaPO ? konfirmasiPasangan : true });
}

/** Body POST /uang-muka/terapkan. `konfirmasiBedaPO` hanya dikirim bila memang beda PO (kontrak server tidak berubah). */
export function bodyPenerapan({ uangMuka, billId, nominal, sisaFaktur, konfirmasiPasangan = false, catatan = "" }) {
  return {
    advanceId: uangMuka.id, billId, amount: Number(nominal), konfirmasi: true, sisaFakturDilihat: Number(sisaFaktur),
    ...(uangMuka.bedaPO && konfirmasiPasangan ? { konfirmasiBedaPO: true } : {}),
    ...(String(catatan).trim() ? { catatan: String(catatan).trim() } : {}),
  };
}

/**
 * Validasi nominal pembayaran kas terhadap sisa faktur TERKINI (dari server). Dipakai form Catat Pembayaran: nominal lebih dari sisa ditandai (server tetap menolak).
 * @returns {{ lebih: boolean, sisa: number }}
 */
export function cekNominalBayar(nominal, sisaFaktur) {
  return { lebih: sen(nominal) > sen(sisaFaktur), sisa: rupiah(sen(sisaFaktur)) };
}

/** Faktur yang masih layak diperiksa uang mukanya: disetujui/dibayar sebagian, ada sisa, bertaut ke PO. */
export const fakturPerluPeriksaUangMuka = (b) => !!b?.purchaseOrderId && ["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(b.status) && Number(b.sisa) > 0;

/**
 * Nominal yang akan keluar dari kas pada pembayaran, per faktur yang masih ada uang muka PO-nya.
 * @param {Array<{id:string,billNumber:string}>} fakturTerbuka
 * @param {Record<string,string|number>} alokasi billId → nominal diisi
 * @param {Map<string, ReturnType<typeof ringkasKelayakan>>} peta
 */
export function fakturBerisikoBayarKedua(fakturTerbuka, alokasi, peta) {
  return fakturTerbuka.filter((b) => Number(alokasi?.[b.id]) > 0 && peta?.get(b.id)?.ada)
    .map((b) => ({ id: b.id, nomor: b.billNumber, nominalKas: Number(alokasi[b.id]), uangMuka: peta.get(b.id).saldoPO, bisaDiterapkan: peta.get(b.id).jumlah }));
}
