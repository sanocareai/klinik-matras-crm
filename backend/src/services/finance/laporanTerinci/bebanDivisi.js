// BEBAN PER DIVISI (BACA-SAJA) — akun → divisi → jenis biaya → dokumen → jurnal, dari baris Laba Rugi + atribusi KODE ASLI Laporan Divisi.
//
// Aturan atribusi (eksplisit → relasi → kategori → bersama → tidak terklasifikasi) TIDAK didefinisikan ulang di sini. Yang ditambahkan hanya penyajian:
//   • setiap divisi dipecah per akun dan per jenis biaya (nama akun);
//   • "Belum teratribusi" = biaya tanpa bukti divisi (nominal + daftar sumber), TIDAK dimasukkan ke divisi lain;
//   • "Biaya Bersama" tetap terpisah (belum ada alokasi resmi);
//   • KONFLIK BUKTI: baris yang buktinya menunjuk lebih dari satu divisi (mis. divisi eksplisit di dokumen ≠ pemetaan kategori). Divisi terpilih mengikuti prioritas
//     aturan; kandidat lain ditampilkan supaya manusia yang memutuskan — angka tidak diubah.
// Pembayaran utang, uang muka, penerimaan persediaan, transfer kas, dan pembelian aset BUKAN beban dan tidak ada di sini (baris Laba Rugi hanya akun beban).

import { sumMoney, moneyToNumber } from "../money.js";
import { DIVISI, TIDAK_TERKLASIFIKASI } from "../laporanDivisi/divisi.js";
import { labelDivisi } from "./baris.js";

const URUT = [...DIVISI.filter((d) => d !== "SHARED"), "SHARED", TIDAK_TERKLASIFIKASI];
const rp = (d) => moneyToNumber(d);

export function hitungBebanDivisi(baris, ringkasan) {
  const beban = baris.filter((r) => r.akunTipe === "BEBAN" || r.akunTipe === "BEBAN_POKOK");
  const per = new Map();
  for (const r of beban) {
    const d = per.get(r.divisi) ?? { scope: r.divisi, label: labelDivisi(r.divisi), rows: [] };
    d.rows.push(r); per.set(r.divisi, d);
  }
  const divisi = [...per.values()].sort((a, b) => URUT.indexOf(a.scope) - URUT.indexOf(b.scope)).map((d) => {
    const akun = new Map();
    for (const r of d.rows) { const a = akun.get(r.akunKode) ?? { kode: r.akunKode, nama: r.akunNama, tipe: r.akunTipe, nilai: [], nBaris: 0, dokumen: new Set() }; a.nilai.push(r.nilai); a.nBaris++; if (r.dokumen?.nomor) a.dokumen.add(r.dokumen.nomor); akun.set(r.akunKode, a); }
    return {
      scope: d.scope, label: d.label,
      operasional: rp(sumMoney(d.rows.filter((r) => r.akunTipe === "BEBAN").map((r) => r.nilai))),
      bebanPokok: rp(sumMoney(d.rows.filter((r) => r.akunTipe === "BEBAN_POKOK").map((r) => r.nilai))),
      total: rp(sumMoney(d.rows.map((r) => r.nilai))),
      nBaris: d.rows.length, nDokumen: new Set(d.rows.map((r) => r.dokumen?.nomor ?? r.nomorJurnal)).size, nKonflik: d.rows.filter((r) => r.konflik.length > 0).length,
      akun: [...akun.values()].map((a) => { const nilai = rp(sumMoney(a.nilai)); return { kode: a.kode, nama: a.nama, tipe: a.tipe, nilai, nBaris: a.nBaris, nDokumen: a.dokumen.size, ...(nilai < 0 ? { pembalikBebanBersih: true } : {}) }; }).sort((x, y) => x.kode.localeCompare(y.kode)),
      pembalikBebanBersih: rp(sumMoney(d.rows.map((r) => r.nilai))) < 0, // total divisi (biaya neto) negatif = pembalik beban bersih
    };
  });

  const konflikRows = beban.filter((r) => r.konflik.length > 0);
  const konflik = {
    jumlahBaris: konflikRows.length,
    nominal: rp(sumMoney(konflikRows.map((r) => r.nilai))),
    penjelasan: "Dokumen memuat bukti divisi yang saling bertentangan (mis. divisi tertulis di dokumen ≠ pemetaan kategori). Angka mengikuti prioritas aturan atribusi; kandidat lain ditampilkan untuk diputuskan manusia.",
    baris: konflikRows.map((r) => ({
      id: r.id, nomorJurnal: r.nomorJurnal, tanggal: r.tanggal, sumber: r.sumber, akunKode: r.akunKode, akunNama: r.akunNama, nilai: r.nilai, dokumen: r.dokumen?.nomor ?? null, dokumenModul: r.dokumen?.modul ?? null, dokumenId: r.dokumenId ?? null,
      deskripsi: r.deskripsi, divisiTerpilih: r.divisi, divisiTerpilihLabel: r.divisiLabel, kandidat: r.konflik, kandidatLabel: r.konflik.map(labelDivisi), tahap: r.tahap, aturan: r.aturan,
    })),
  };

  const belum = beban.filter((r) => r.divisi === TIDAK_TERKLASIFIKASI);
  const belumTeratribusi = {
    nominal: rp(sumMoney(belum.map((r) => r.nilai))), jumlahBaris: belum.length,
    sumber: [...new Map(belum.map((r) => [r.sumber, 0])).keys()],
    baris: belum.map((r) => ({ id: r.id, nomorJurnal: r.nomorJurnal, tanggal: r.tanggal, sumber: r.sumber, akunKode: r.akunKode, akunNama: r.akunNama, nilai: r.nilai, dokumen: r.dokumen?.nomor ?? null, deskripsi: r.deskripsi, aturan: r.aturan })),
  };

  const totalDivisi = rp(sumMoney(divisi.map((d) => d.total)));
  const totalLedger = rp(sumMoney([ringkasan.bebanPokok, ringkasan.bebanOperasional]));
  return { divisi, konflik, belumTeratribusi, totalDivisi, totalLedger, residual: rp(sumMoney([totalLedger]).minus(totalDivisi)) };
}
