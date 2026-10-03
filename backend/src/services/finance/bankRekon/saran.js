// SARAN PENCOCOKAN — MURNI (tanpa database, tanpa efek samping). Bank ↔ Buku pada SATU rekening.
//
// Prinsip yang tidak boleh dilanggar:
//   • Saran tidak pernah menulis apa pun. Pencocokan baru terjadi lewat tindakan eksplisit (manual) atau perintah "Cocokkan otomatis".
//   • COCOK OTOMATIS hanya untuk pasangan 1:1 yang TIDAK AMBIGU di kedua arah: nominal sama persis, selisih tanggal ≤ 3 hari, dan baris bank itu hanya punya SATU kandidat buku
//     (dalam jendela 7 hari) dan sebaliknya. Dua kandidat atau lebih di salah satu sisi = ambigu = TIDAK dicocokkan otomatis, hanya DISARANKAN.
//   • Kombinasi (1:N, N:1: mis. transfer Rp6.496.000 + biaya Rp2.500 di bank = satu baris buku Rp6.498.500) selalu hanya saran.
//
// Nilai bertanda dari sudut pandang rekening: + masuk, − keluar (bank: kredit−debit; buku: debit−kredit pada akun kas/bank).
import { toMoney, ZERO } from "../money.js";

export const JENDELA_HARI = 7;
export const JENDELA_OTOMATIS_HARI = 3;
const MAKS_POOL = 20;
const MAKS_UKURAN = 3;
const MAKS_SARAN_KOMBINASI = 3;

const hari = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const token = (t) => new Set(String(t ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 4 && !/^\d{1,3}$/.test(x)));

/** Skor kemiripan teks (jumlah token ≥4 huruf/angka yang sama, maks 3) — penunjang urutan saran, BUKAN syarat pencocokan. */
export function skorTeks(a, b) {
  const ta = token(a), tb = token(b);
  let n = 0;
  for (const x of ta) if (tb.has(x)) n += 1;
  return Math.min(n, 3);
}

/**
 * @param {{bank: {id,tanggal,nilai,deskripsi,referensi}[], buku: {id,tanggal,nilai,teks}[]}} data   hanya baris yang BELUM dicocokkan/dikecualikan
 * @returns {{ kandidatBank: Map<string, object[]>, kandidatBuku: Map<string, object[]>, otomatis: {bankId,bukuId}[], kombinasi: object[] }}
 */
export function cariSaran({ bank, buku }) {
  const kandidatBank = new Map(bank.map((b) => [b.id, []]));
  const kandidatBuku = new Map(buku.map((j) => [j.id, []]));

  // 1:1 — nominal sama persis & dalam jendela hari.
  const perNilai = new Map();
  for (const j of buku) { const k = toMoney(j.nilai).toFixed(2); if (!perNilai.has(k)) perNilai.set(k, []); perNilai.get(k).push(j); }
  for (const b of bank) {
    for (const j of perNilai.get(toMoney(b.nilai).toFixed(2)) ?? []) {
      const selisihHari = hari(b.tanggal, j.tanggal);
      if (Math.abs(selisihHari) > JENDELA_HARI) continue;
      const skor = 100 - Math.abs(selisihHari) * 5 + skorTeks(`${b.deskripsi} ${b.referensi ?? ""}`, j.teks) * 4;
      const info = { skor, selisihHari };
      kandidatBank.get(b.id).push({ bukuId: j.id, ...info });
      kandidatBuku.get(j.id).push({ bankId: b.id, ...info });
    }
  }
  for (const arr of [...kandidatBank.values(), ...kandidatBuku.values()]) arr.sort((x, y) => y.skor - x.skor);

  // OTOMATIS: unik di kedua arah (dalam jendela 7 hari) & selisih hari ≤ 3.
  const otomatis = [];
  for (const b of bank) {
    const kb = kandidatBank.get(b.id);
    if (kb.length !== 1) continue;
    const j = kb[0];
    if (Math.abs(j.selisihHari) > JENDELA_OTOMATIS_HARI) continue;
    const kj = kandidatBuku.get(j.bukuId);
    if (kj.length === 1 && kj[0].bankId === b.id) otomatis.push({ bankId: b.id, bukuId: j.bukuId });
  }

  // KOMBINASI — hanya untuk baris yang belum punya kandidat 1:1.
  const kombinasi = [];
  const sudah = new Set();
  const cariSubset = (target, pool, ambil) => {
    const hasil = [];
    const tanda = target.isNegative() ? -1 : 1;
    const calon = pool.filter((x) => (toMoney(x.nilai).isNegative() ? -1 : 1) === tanda && !toMoney(x.nilai).isZero()).slice(0, MAKS_POOL);
    const rec = (mulai, dipilih, jumlah) => {
      if (hasil.length > MAKS_SARAN_KOMBINASI) return;
      if (dipilih.length >= 2 && jumlah.equals(target)) { hasil.push(dipilih.map(ambil)); return; }
      if (dipilih.length >= MAKS_UKURAN) return;
      for (let i = mulai; i < calon.length; i += 1) {
        const total = jumlah.plus(toMoney(calon[i].nilai));
        if (total.abs().greaterThan(target.abs())) continue; // sama tanda → terlampaui; pangkas
        rec(i + 1, [...dipilih, calon[i]], total);
      }
    };
    rec(0, [], ZERO);
    return hasil;
  };
  const dekat = (tanggal, arr) => arr.filter((x) => Math.abs(hari(tanggal, x.tanggal)) <= JENDELA_HARI).sort((x, y) => Math.abs(hari(tanggal, x.tanggal)) - Math.abs(hari(tanggal, y.tanggal)));
  for (const b of bank) {
    if (kandidatBank.get(b.id).length) continue;
    const subset = cariSubset(toMoney(b.nilai), dekat(b.tanggal, buku), (x) => x.id); // 1 bank : N buku
    subset.slice(0, MAKS_SARAN_KOMBINASI).forEach((ids) => {
      const kunci = `B:${b.id}|J:${[...ids].sort().join(",")}`;
      if (sudah.has(kunci)) return; sudah.add(kunci);
      kombinasi.push({ bentuk: "1:N", bankIds: [b.id], bukuIds: ids, ambigu: subset.length > 1 });
    });
  }
  for (const j of buku) {
    if (kandidatBuku.get(j.id).length) continue;
    const subset = cariSubset(toMoney(j.nilai), dekat(j.tanggal, bank), (x) => x.id); // N bank : 1 buku (mis. transfer + biaya bank)
    subset.slice(0, MAKS_SARAN_KOMBINASI).forEach((ids) => {
      const kunci = `B:${[...ids].sort().join(",")}|J:${j.id}`;
      if (sudah.has(kunci)) return; sudah.add(kunci);
      kombinasi.push({ bentuk: "N:1", bankIds: ids, bukuIds: [j.id], ambigu: subset.length > 1 });
    });
  }
  return { kandidatBank, kandidatBuku, otomatis, kombinasi };
}

/** Bentuk kelompok dari jumlah sisi: "1:1" | "1:N" | "N:1" | "N:N" (bank:buku). */
export function bentukKelompok(nBank, nBuku) {
  const s = (n) => (n === 1 ? "1" : "N");
  return `${s(nBank)}:${s(nBuku)}`;
}

const POLA_KATEGORI = [
  ["PAJAK_BUNGA", /pajak\s*(bunga)?|\btax\b|pph/i],
  ["BUNGA", /\bbunga\b|\binterest\b/i],
  ["BIAYA_BANK", /\b(biaya|fee|adm|admin|administrasi|charge)\b/i],
];
/** Kategori otomatis dari sumber jurnal & keterangan bank (boleh ditimpa pengguna). null bila tidak jelas. */
export function tebakKategori({ sumberJurnal = [], deskripsiBank = [], bedaHari = 0 }) {
  if (sumberJurnal.some((s) => s === "TRANSFER_KAS")) return "TRANSFER_ANTAR_REKENING";
  const teks = deskripsiBank.join(" ");
  for (const [kode, pola] of POLA_KATEGORI) if (pola.test(teks)) return kode;
  if (Math.abs(bedaHari) > 0) return "BEDA_TANGGAL";
  return null;
}
