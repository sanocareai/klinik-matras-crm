// DRY-RUN ATRIBUSI DIVISI (Fase 2) — BACA-SAJA. Mengelompokkan SELURUH transaksi biaya/kas dalam rentang menjadi empat kelompok yang harus disetujui Owner sebelum apa pun
// dianggap final. TIDAK menulis apa pun ke database (tidak ada backfill, tidak ada kolom divisi baru pada dokumen lama).
//   1. DETERMINISTIK        — divisi terbukti (eksplisit / relasi sumber / mapping kategori) dan tidak ada petunjuk yang bertentangan.
//   2. SHARED               — biaya bersama (divisi UMUM/kategori umum); tetap SHARED sampai ada alokasi resmi.
//   3. TIDAK_TERKLASIFIKASI — tidak ada bukti divisi (mis. jurnal manual, kategori pembelian belum terpetakan).
//   4. KONFLIK              — dokumen punya petunjuk divisi yang bertentangan (mis. divisi dokumen ≠ divisi kategori); atribusi tetap mengikuti prioritas, tetapi perlu ditinjau.
// Di luar empat kelompok: DI_LUAR_DIVISI (sumber non-biaya: pembayaran order, saldo awal, rekonsiliasi) — dilaporkan terpisah supaya tidak tampak sebagai kebocoran.
import { atribusiEntri, TAHAP } from "./atribusi.js";
import { muatFakta } from "./laporan.js";
import { DI_LUAR_DIVISI, TIDAK_TERKLASIFIKASI, LABEL_DIVISI } from "./divisi.js";

const rp = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CONTOH = 6;

export async function dryRunAtribusi(db, { from, to }) {
  const fakta = await muatFakta(db, { from, to });
  const atr = await atribusiEntri(db, fakta.map((f) => ({ id: f.id, source: f.source, sourceId: f.sourceId, reversalOfId: f.reversalOfId })));
  const G = { DETERMINISTIK: [], SHARED: [], TIDAK_TERKLASIFIKASI: [], KONFLIK: [], DI_LUAR_DIVISI: [] };
  for (const f of fakta) {
    const a = atr.get(f.id);
    if (!a) continue;
    for (const b of a.bagian) {
      const rec = { entryId: f.id, nomor: f.nomor, tanggal: f.tanggal, sumber: a.sumberAsli, dokumen: a.dokumen?.nomor ?? null, scope: b.scope, aktual: f.aktual * b.bobot, kasKeluar: f.kasKeluar * b.bobot, aturan: a.aturan, tahap: a.tahap, konflik: a.konflik ?? [], sensitif: !!(a.sensitif || f.sensitifAkun) };
      if (b.scope === DI_LUAR_DIVISI) G.DI_LUAR_DIVISI.push(rec);
      else if (a.konflik?.length) G.KONFLIK.push(rec);
      else if (b.scope === TIDAK_TERKLASIFIKASI) G.TIDAK_TERKLASIFIKASI.push(rec);
      else if (b.scope === "SHARED") G.SHARED.push(rec);
      else G.DETERMINISTIK.push(rec);
    }
  }
  const ringkas = (arr) => {
    const perScope = new Map(); const perSumber = new Map(); const perTahap = new Map();
    for (const r of arr) {
      const s = perScope.get(r.scope) ?? { scope: r.scope, label: LABEL_DIVISI[r.scope] ?? r.scope, n: 0, aktual: 0, kasKeluar: 0 }; s.n += 1; s.aktual += r.aktual; s.kasKeluar += r.kasKeluar; perScope.set(r.scope, s);
      const u = perSumber.get(r.sumber) ?? { sumber: r.sumber, n: 0, aktual: 0, kasKeluar: 0, aturan: new Set() }; u.n += 1; u.aktual += r.aktual; u.kasKeluar += r.kasKeluar; u.aturan.add(r.aturan); perSumber.set(r.sumber, u);
      const t = perTahap.get(r.tahap) ?? { tahap: r.tahap, n: 0 }; t.n += 1; perTahap.set(r.tahap, t);
    }
    return {
      jumlahTransaksi: arr.length, aktual: rp(arr.reduce((s, r) => s + r.aktual, 0)), kasKeluar: rp(arr.reduce((s, r) => s + r.kasKeluar, 0)), sensitif: arr.filter((r) => r.sensitif).length,
      perScope: [...perScope.values()].map((s) => ({ ...s, aktual: rp(s.aktual), kasKeluar: rp(s.kasKeluar) })).sort((a, b) => Math.abs(b.aktual) - Math.abs(a.aktual)),
      perSumber: [...perSumber.values()].map((u) => ({ sumber: u.sumber, n: u.n, aktual: rp(u.aktual), kasKeluar: rp(u.kasKeluar), aturan: [...u.aturan].slice(0, 3) })).sort((a, b) => Math.abs(b.aktual) + Math.abs(b.kasKeluar) - Math.abs(a.aktual) - Math.abs(a.kasKeluar)),
      perTahap: [...perTahap.values()],
      contoh: [...arr].sort((a, b) => Math.abs(b.aktual) + Math.abs(b.kasKeluar) - Math.abs(a.aktual) - Math.abs(a.kasKeluar)).slice(0, CONTOH).map((r) => ({ nomor: r.nomor, tanggal: r.tanggal, sumber: r.sumber, dokumen: r.dokumen, scope: r.scope, aktual: rp(r.aktual), kasKeluar: rp(r.kasKeluar), aturan: r.aturan, konflik: r.konflik })),
    };
  };
  const hasil = { periode: { from, to }, bacaSaja: true, dibuatPada: new Date().toISOString(), jumlahEntri: fakta.length, kelompok: {} };
  for (const [k, arr] of Object.entries(G)) hasil.kelompok[k] = ringkas(arr);
  hasil.catatan = [
    "Dry-run ini hanya MEMBACA. Tidak ada data historis yang diubah atau diisi ulang (backfill) — atribusi dihitung saat laporan dibuka dari dokumen sumber.",
    "SHARED mencakup dokumen berdivisi UMUM (termasuk yang bernilai default); tetap biaya bersama sampai ada alokasi resmi per divisi.",
    "KONFLIK: atribusi mengikuti prioritas (eksplisit → relasi → kategori) tetapi ditandai untuk ditinjau.",
  ];
  return hasil;
}
