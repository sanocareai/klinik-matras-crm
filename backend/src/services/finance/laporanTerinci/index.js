// LAPORAN KEUANGAN TERINCI — ORKESTRATOR READ-MODEL (BACA-SAJA).
//
// SATU fungsi menyusun SEMUA yang tampil di layar Laba Rugi terinci DAN Export Excel: kartu (dari labaRugi() yang SAMA, rumus tidak diubah), drilldown, jembatan pendapatan,
// PKR terpisah, HPP & penanda mutu margin, beban per divisi, konflik atribusi, dan daftar gap. Layar dan Excel membaca hasil fungsi ini — tidak ada hitungan lokal di frontend.
//
// KONSISTENSI: seluruh query berjalan di SATU transaksi REPEATABLE READ (snapshot tunggal) sehingga kartu, baris, jembatan, dan kontrol tidak bisa berbeda karena ada jurnal
// baru masuk di tengah pembacaan. Hasilnya membawa CUTOFF (waktu pembacaan WIB/UTC + tanggal buku terakhir) — layar dan Excel mencetaknya.
// Tidak ada tulis ke database. Tidak ada angka estimasi yang ikut laba (lihat hpp.js).

import { labaRugi } from "../reports.js";
import { STATUS_DIHITUNG } from "../journal.js";
import { sumMoney, moneyToNumber } from "../money.js";
import { WIB_OFFSET_MS } from "../../../utils/wib.js";
import { muatBarisLabaRugi, totalKartuDariBaris, kontribusiMetrik, METRIK_DRILLDOWN, LABEL_METRIK, MAKS_BARIS_DRILLDOWN } from "./baris.js";
import { hitungJembatan } from "./jembatan.js";
import { hitungHpp } from "./hpp.js";
import { hitungBebanDivisi } from "./bebanDivisi.js";
import { hitungPkr } from "./pkr.js";
import { PENANDA_PENYAJIAN } from "../penandaBiaya.js";
import { hitungGap } from "./gap.js";

export class LaporanTerinciError extends Error {
  constructor(message, statusCode = 400, code = "LAPORAN_TERINCI") { super(message); this.statusCode = statusCode; this.code = code; }
}

const OPSI_TX = { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 90_000 };
const POLA = /^\d{4}-\d{2}-\d{2}$/;
const rp = (d) => moneyToNumber(d);

export function periodeValid({ fromStr, toStr }) {
  if (!POLA.test(fromStr || "") || !POLA.test(toStr || "")) throw new LaporanTerinciError("Periode tidak valid (format YYYY-MM-DD)", 400, "PERIODE_TIDAK_VALID");
  if (fromStr > toStr) throw new LaporanTerinciError("Tanggal awal periode lebih besar dari tanggal akhir", 400, "PERIODE_TIDAK_VALID");
  return { from: new Date(`${fromStr}T00:00:00.000Z`), to: new Date(`${toStr}T00:00:00.000Z`) };
}

function formatWib(d) { return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 19).replace("T", " "); }

async function cutoff(tx, { toStr }) {
  const sekarang = new Date();
  const maks = await tx.finJournalEntry.aggregate({ where: { status: { in: STATUS_DIHITUNG } }, _max: { date: true } });
  const terakhir = maks._max.date ? maks._max.date.toISOString().slice(0, 10) : null;
  return {
    diambilPada: sekarang.toISOString(), diambilPadaWib: formatWib(sekarang), tanggalBukuTerakhir: terakhir,
    periodeMelewatiBuku: !!terakhir && toStr > terakhir, isolasi: "REPEATABLE READ READ ONLY (snapshot tunggal; database menolak tulisan)",
    basisTanggal: "Tanggal buku jurnal (WIB); status jurnal POSTED + yang kemudian dibalik (REVERSED)",
  };
}

/** Kartu + total baris untuk satu metrik. */
function susunKartu(ringkasan, totalBaris, baris) {
  const nilai = {
    pendapatan: ringkasan.pendapatanBersih, hpp: ringkasan.bebanPokok, laba_kotor: ringkasan.labaKotor, beban_operasional: ringkasan.bebanOperasional, laba_bersih: ringkasan.labaBersih,
  };
  return METRIK_DRILLDOWN.map((m) => {
    const rows = baris.filter((r) => kontribusiMetrik(r, m) !== null);
    return { metrik: m, label: LABEL_METRIK[m], nilai: nilai[m], totalBaris: totalBaris[m], cocok: nilai[m] === totalBaris[m], jumlahBaris: rows.length, jumlahJurnal: new Set(rows.map((r) => r.entryId)).size };
  });
}

/** Ringkasan per akun per metrik (untuk tab "Per akun" tanpa memuat seluruh baris). */
function akunPerMetrik(baris) {
  const out = {};
  for (const m of METRIK_DRILLDOWN) {
    const peta = new Map();
    for (const r of baris) {
      const k = kontribusiMetrik(r, m); if (k === null) continue;
      const a = peta.get(r.akunKode) ?? { kode: r.akunKode, nama: r.akunNama, tipe: r.akunTipe, nilai: [], nBaris: 0, jurnal: new Set() };
      a.nilai.push(k); a.nBaris++; a.jurnal.add(r.entryId); peta.set(r.akunKode, a);
    }
    out[m] = [...peta.values()].map((a) => { const nilai = rp(sumMoney(a.nilai)); return { kode: a.kode, nama: a.nama, tipe: a.tipe, nilai, nBaris: a.nBaris, nJurnal: a.jurnal.size, ...((a.tipe === "BEBAN" || a.tipe === "BEBAN_POKOK") && (m === "hpp" || m === "beban_operasional") && nilai < 0 ? { pembalikBebanBersih: true } : {}) }; }).sort((x, y) => x.kode.localeCompare(y.kode));
  }
  return out;
}

function susunKontrol({ ringkasan, kartu, jembatan, bebanDivisi, pkr, gap, catatan, akunLR = null }) {
  const k = (kunci, label, kiri, kanan) => ({ kunci, label, kiri, kanan, selisih: rp(sumMoney([kiri]).minus(kanan)), ok: rp(sumMoney([kiri]).minus(kanan)) === 0 });
  const daftar = [
    ...kartu.map((c) => k(`kartu_${c.metrik}`, `Kartu ${c.label} = Σ baris jurnal`, c.nilai, c.totalBaris)),
    ...(akunLR ? [
      k("akun_beban_pokok", "Σ akun beban pokok (Laba Rugi) = Σ baris jurnal", akunLR.bebanPokok, kartu.find((c) => c.metrik === "hpp").totalBaris),
      k("akun_beban_operasional", "Σ akun beban operasional (Laba Rugi) = Σ baris jurnal", akunLR.bebanOperasional, kartu.find((c) => c.metrik === "beban_operasional").totalBaris),
    ] : []),
    k("jembatan_residual_sales", "Jembatan: residual sisi Sales", jembatan.residual.sales, 0),
    k("jembatan_residual_bruto", "Jembatan: residual pendapatan bruto", jembatan.residual.bruto, 0),
    k("jembatan_residual_retur", "Jembatan: residual retur", jembatan.residual.retur, 0),
    k("jembatan_residual_bersih", "Jembatan: residual pendapatan bersih", jembatan.residual.bersih, 0),
    k("beban_divisi", "Σ beban per divisi = beban pokok + beban operasional", bebanDivisi.totalDivisi, bebanDivisi.totalLedger),
    k("pkr_ledger_dokumen", "PKR: pendapatan 4-1250 = Σ total dokumen periode", pkr.ringkasan.pendapatanLedger, pkr.ringkasan.penjualanDokumen),
    k("gap_banner", "Daftar gap = banner \"transaksi belum dibukukan\"", gap.jumlahTerbuka, catatan.gapTerbuka),
  ];
  return { daftar, semuaOk: daftar.every((x) => x.ok), jumlahGagal: daftar.filter((x) => !x.ok).length };
}

/**
 * Seluruh pembacaan laporan terinci berjalan di SATU transaksi REPEATABLE READ **READ ONLY**. "Baca-saja" bukan lagi sifat implementasi: database sendiri MENOLAK
 * INSERT/UPDATE/DELETE/DDL di dalam transaksi ini (SQLSTATE 25006). `SET TRANSACTION READ ONLY` harus menjadi pernyataan PERTAMA setelah BEGIN (sebelum query apa pun).
 */
export async function jalankanBacaSaja(db, fn) {
  if (typeof db.$transaction === "function") {
    return db.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return fn(tx); }, OPSI_TX);
  }
  return fn(db);
}
const jalankan = jalankanBacaSaja;

/**
 * Baca seluruh laporan terinci.
 * @param db   PrismaClient
 * @param opts { fromStr, toStr, bolehSensitif?, denganBaris? }  denganBaris=true menyertakan seluruh baris jurnal (untuk Export Excel).
 */
export async function bacaLaporanTerinci(db, { fromStr, toStr, bolehSensitif = false, denganBaris = false }) {
  const { from, to } = periodeValid({ fromStr, toStr });
  return jalankan(db, async (tx) => {
    const lr = await labaRugi(tx, { from, to });
    const ringkasan = lr.ringkasan;
    const baris = await muatBarisLabaRugi(tx, { from, to, bolehSensitif });
    const totalBaris = totalKartuDariBaris(baris);
    const kartu = susunKartu(ringkasan, totalBaris, baris);
    const [jembatan, hpp, pkr, gap, ctf] = await Promise.all([
      hitungJembatan(tx, { fromStr, toStr, baris, ringkasan }),
      hitungHpp(tx, { fromStr, toStr, baris }),
      hitungPkr(tx, { from, to, baris }),
      hitungGap(tx, { fromStr, toStr, catatan: lr.catatan }),
      cutoff(tx, { toStr }),
    ]);
    const bebanDivisi = hitungBebanDivisi(baris, ringkasan);
    const akunLR = { bebanPokok: rp(sumMoney(lr.bebanPokok.map((r) => r.nilai))), bebanOperasional: rp(sumMoney(lr.bebanOperasional.map((r) => r.nilai))) };
    const kontrol = susunKontrol({ ringkasan, kartu, jembatan, bebanDivisi, pkr, gap, catatan: lr.catatan, akunLR });
    return {
      periode: { from: fromStr, to: toStr }, cutoff: ctf, catatan: lr.catatan,
      ringkasan, penanda: PENANDA_PENYAJIAN, kartu, akunPerMetrik: akunPerMetrik(baris),
      margin: { nilai: ringkasan.marginKotor, status: hpp.status, pesan: hpp.pesan, final: hpp.final },
      jembatan, pkr, hpp, bebanDivisi, gap, kontrol,
      jumlahBaris: baris.length,
      ...(denganBaris ? { baris } : {}),
    };
  });
}

/**
 * Drilldown satu kartu: baris jurnal + pengelompokan, dengan total yang WAJIB sama dengan kartu.
 * @param opts { fromStr, toStr, metrik, akun?, divisi?, sumber?, q?, bolehSensitif? }
 */
export async function drilldownMetrik(db, { fromStr, toStr, metrik, akun = null, divisi = null, sumber = null, q = null, bolehSensitif = false, maksBaris = MAKS_BARIS_DRILLDOWN }) {
  const batas = Math.min(Math.max(Number(maksBaris) || MAKS_BARIS_DRILLDOWN, 1), MAKS_BARIS_DRILLDOWN); // batas daftar yang DIKIRIM (tes boleh memperkecil; produksi memakai MAKS_BARIS_DRILLDOWN)
  if (!METRIK_DRILLDOWN.includes(metrik)) throw new LaporanTerinciError(`Metrik tidak dikenal. Pilihan: ${METRIK_DRILLDOWN.join(", ")}`, 400, "METRIK_TIDAK_DIKENAL");
  const { from, to } = periodeValid({ fromStr, toStr });
  return jalankan(db, async (tx) => {
    const lr = await labaRugi(tx, { from, to });
    const semua = await muatBarisLabaRugi(tx, { from, to, bolehSensitif });
    const ctf = await cutoff(tx, { toStr });
    const milik = semua.map((r) => ({ r, k: kontribusiMetrik(r, metrik) })).filter((x) => x.k !== null);
    const nilaiKartu = { pendapatan: lr.ringkasan.pendapatanBersih, hpp: lr.ringkasan.bebanPokok, laba_kotor: lr.ringkasan.labaKotor, beban_operasional: lr.ringkasan.bebanOperasional, laba_bersih: lr.ringkasan.labaBersih }[metrik];
    const totalSemua = rp(sumMoney(milik.map((x) => x.k)));
    const kata = q ? String(q).trim().toLowerCase().slice(0, 80) : "";
    const tersaring = milik.filter(({ r }) =>
      (!akun || r.akunKode === akun) && (!divisi || r.divisi === divisi) && (!sumber || r.sumber === sumber)
      && (!kata || [r.nomorJurnal, r.dokumen?.nomor, r.orderNomor, r.deskripsi, r.akunNama].some((t) => String(t ?? "").toLowerCase().includes(kata))));
    const kelompok = (kunci, label) => {
      const m = new Map();
      for (const { r, k } of milik) { const key = kunci(r); const g = m.get(key) ?? { kunci: key, label: label(r), nilai: [], nBaris: 0 }; g.nilai.push(k); g.nBaris++; m.set(key, g); }
      return [...m.values()].map((g) => ({ kunci: g.kunci, label: g.label, nilai: rp(sumMoney(g.nilai)), nBaris: g.nBaris }));
    };
    const terpotong = tersaring.length > batas;
    return {
      metrik, label: LABEL_METRIK[metrik], periode: { from: fromStr, to: toStr }, cutoff: ctf,
      nilaiKartu, totalSemuaBaris: totalSemua, jumlahSemua: milik.length, cocok: nilaiKartu === totalSemua, penanda: PENANDA_PENYAJIAN,
      filter: { akun, divisi, sumber, q: kata || null },
      // totalTersaring + jumlah dihitung dari SELURUH baris yang lolos filter di server (bukan dari daftar yang dikirim); daftar `baris` dipotong di MAKS_BARIS_DRILLDOWN → `terpotong`.
      totalTersaring: rp(sumMoney(tersaring.map((x) => x.k))), jumlah: tersaring.length, jumlahDitampilkan: Math.min(tersaring.length, batas), maksBaris: batas, terpotong,
      sifatNilai: metrik === "hpp" || metrik === "beban_operasional" ? "BIAYA_NETO" : "EFEK_LABA",
      baris: tersaring.slice(0, batas).map(({ r, k }) => ({ ...r, kontribusi: k })),
      grupAkun: kelompok((r) => r.akunKode, (r) => `${r.akunKode} ${r.akunNama}`).sort((a, b) => a.kunci.localeCompare(b.kunci)),
      grupDivisi: kelompok((r) => r.divisi, (r) => r.divisiLabel).sort((a, b) => Math.abs(b.nilai) - Math.abs(a.nilai)),
      grupSumber: kelompok((r) => r.sumber, (r) => r.sumber).sort((a, b) => Math.abs(b.nilai) - Math.abs(a.nilai)),
    };
  });
}
