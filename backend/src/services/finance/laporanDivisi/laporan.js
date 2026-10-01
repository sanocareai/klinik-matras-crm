// LAPORAN DIVISI — mesin tunggal (Fase 2). SATU fungsi menghasilkan angka untuk layar Finance pusat, layar workspace divisi, drill-down, jembatan, dan Export Excel.
// Tidak ada formula lokal di frontend atau per workspace. BACA-SAJA.
//
// KONSEP YANG SENGAJA TERPISAH (satu transaksi sumber hanya berkontribusi SEKALI pada metrik yang sama):
//   Aktual (Beban Diakui)  = Σ (debit − kredit) akun BEBAN/BEBAN POKOK pada jurnal (POSTED/REVERSED), tanggal buku. Sama dengan beban_diakui Fase 1.
//   Kas Keluar             = uang yang benar-benar keluar dari Kas/Bank per jurnal (aturan arusKas Fase 1: transfer antar rekening hanya neto/biaya adminnya).
//   Komitmen               = dokumen diajukan/disetujui yang uangnya belum keluar (komitmen.js) — bukan beban dan bukan kas bila belum dibukukan.
//   Anggaran               = versi DISETUJUI (anggaran.js); belum ada → null ("Belum ada anggaran").
//   Persediaan             = nilai penerimaan & pemakaian dilaporkan TERPISAH untuk Gudang; penerimaan (aset) tidak pernah dihitung sebagai beban.
// Pencegah hitung ganda: uang muka diberikan = Kas Keluar divisi pemegang; pertanggungjawabannya = Aktual (beban) TANPA kas lagi. Tagihan supplier = utang/beban sekali;
// pembayarannya = Kas Keluar saja. AdSpend = satu jurnal (beban + bank). Transfer antarbank = netto biaya admin saja. Refund = kas keluar Sales + kontra pendapatan (bukan beban).
//
// JEMBATAN (hanya Finance): Σ Aktual semua kelompok = beban_diakui ledger (independen); Σ Kas Keluar semua kelompok + Di Luar Divisi = Kas Keluar Arus Kas Fase 1. Residual harus Rp0.
import { moneyToNumber } from "../money.js";
import { STATUS_DIHITUNG } from "../journal.js";
import { arusKas } from "../reports.js";
import { startOfDayWIB } from "../../../utils/wib.js";
import { atribusiEntri, TAHAP } from "./atribusi.js";
import { hitungKomitmen, JENIS_KOMITMEN } from "./komitmen.js";
import { anggaranBerlaku } from "./anggaran.js";
import { tetapkanScope, bolehRinci, bolehSensitif, LEVEL } from "./akses.js";
import { DIVISI, SEMUA_KELOMPOK, LABEL_DIVISI, KELOMPOK, AKUN_SENSITIF, DI_LUAR_DIVISI, TIDAK_TERKLASIFIKASI, bulanKunci } from "./divisi.js";

const rp = (n) => Math.round((Number(n) || 0) * 100) / 100;
const TIPE_BEBAN = ["BEBAN", "BEBAN_POKOK"];

export const BASIS_LAPORAN = Object.freeze({
  aktual: "Tanggal buku (jurnal)", kasKeluar: "Tanggal buku (jurnal Kas/Bank)", komitmen: "Tanggal dokumen", anggaran: "Bulan anggaran",
  zonaWaktu: "WIB (UTC+7)", status: "Jurnal POSTED + yang kemudian dibalik (REVERSED); pembalikan mengikuti divisi jurnal asli",
});
export const TIDAK_TERMASUK = Object.freeze([
  "Draf pengajuan (belum diajukan)", "Dokumen ditolak/dibatalkan (jurnalnya dibalik)", "Penerimaan barang & pembelian aset (aset/persediaan, bukan beban)",
  "Pendapatan, pembayaran order, saldo awal, rekonsiliasi (bukan biaya divisi)", "Estimasi (mis. estimasi tol Google) — hanya pengeluaran AKTUAL yang dihitung",
]);

// ── 1. FAKTA: entri jurnal ber-biaya / ber-kas pada periode ───────────────────────────────────────────────────────────
export async function muatFakta(db, { from, to }) {
  const akun = await db.finAccount.findMany({ where: { systemKey: { in: ["KAS", "BANK", "PERSEDIAAN_BAHAN"] } }, select: { id: true, systemKey: true } });
  const idKas = akun.filter((a) => a.systemKey === "KAS" || a.systemKey === "BANK").map((a) => a.id);
  const idPersediaan = akun.find((a) => a.systemKey === "PERSEDIAAN_BAHAN")?.id ?? null;
  const gte = new Date(`${from}T00:00:00.000Z`); const lte = new Date(`${to}T00:00:00.000Z`);

  const lines = await db.finJournalLine.findMany({
    where: {
      entry: { status: { in: STATUS_DIHITUNG }, date: { gte, lte } },
      OR: [{ accountId: { in: idKas } }, { account: { type: { in: TIPE_BEBAN } } }, ...(idPersediaan ? [{ accountId: idPersediaan }] : [])],
    },
    select: { debit: true, credit: true, accountId: true, account: { select: { code: true, name: true, type: true } }, entry: { select: { id: true, entryNumber: true, date: true, description: true, source: true, sourceId: true, reversalOfId: true } } },
  });

  // entri yang menyentuh akun SENSITIF (gaji, kasbon, investor, prive) — disaring dari tampilan non-Finance
  const sens = await db.finJournalLine.findMany({ where: { entry: { status: { in: STATUS_DIHITUNG }, date: { gte, lte } }, account: { code: { in: [...AKUN_SENSITIF] } } }, select: { entryId: true } });
  const idSensitif = new Set(sens.map((s) => s.entryId));

  const peta = new Map();
  for (const l of lines) {
    const e = l.entry;
    if (!peta.has(e.id)) peta.set(e.id, { entry: e, kasD: 0, kasK: 0, aktual: 0, akun: new Map(), persD: 0, persK: 0 });
    const f = peta.get(e.id);
    const d = Number(l.debit); const k = Number(l.credit);
    if (idKas.includes(l.accountId)) { f.kasD += d; f.kasK += k; }
    if (TIPE_BEBAN.includes(l.account.type)) {
      f.aktual += d - k;
      const cur = f.akun.get(l.account.code) ?? { nama: l.account.name, nilai: 0 };
      cur.nilai += d - k; f.akun.set(l.account.code, cur);
    }
    if (l.accountId === idPersediaan) { f.persD += d; f.persK += k; }
  }

  const fakta = [];
  for (const f of peta.values()) {
    const e = f.entry;
    const net = f.kasD - f.kasK;
    // aturan arusKas Fase 1: entri dengan arus kas bersih nol tidak dihitung; transfer antar rekening = hanya neto (biaya admin)
    let kasKeluar = 0;
    if (Math.abs(net) > 0.004) kasKeluar = e.source === "TRANSFER_KAS" ? Math.max(-net, 0) : f.kasK;
    const penerimaan = e.source === "PENERIMAAN_BAHAN" ? f.persD - f.persK : 0;
    const pemakaian = e.source === "PEMAKAIAN_BAHAN" ? f.persK - f.persD : 0;
    if (Math.abs(f.aktual) < 0.004 && kasKeluar === 0 && Math.abs(penerimaan) < 0.004 && Math.abs(pemakaian) < 0.004) continue;
    fakta.push({
      id: e.id, nomor: e.entryNumber, tanggal: e.date.toISOString().slice(0, 10), deskripsi: e.description, source: e.source, sourceId: e.sourceId, reversalOfId: e.reversalOfId,
      aktual: f.aktual, kasKeluar, penerimaan, pemakaian, akun: [...f.akun].map(([kode, v]) => ({ kode, nama: v.nama, nilai: v.nilai })), sensitifAkun: idSensitif.has(e.id),
    });
  }
  return fakta;
}

// ── 2. KELOMPOK RINCIAN per divisi ────────────────────────────────────────────────────────────────────────────────────
/** Cocok bila: kode kategori terdaftar, ATAU kode akun terdaftar, ATAU (sumber terdaftar dan kelompok tidak membatasi akun). */
function kelompokUntuk(scope, { kategoriKode, source, akunKode }) {
  for (const g of KELOMPOK[scope] ?? []) {
    if (kategoriKode && g.kategori?.includes(kategoriKode)) return g;
    if (akunKode && g.akun?.includes(akunKode)) return g;
    if (g.sumber?.includes(source) && !g.akun) return g;
  }
  return null;
}

const kosong = () => ({ aktual: 0, kasKeluar: 0, nDokumen: 0, penerimaan: 0, pemakaian: 0, kelompok: new Map(), kategori: new Map(), proyek: new Map(), tren: new Map(), tahap: new Map(), konflik: 0 });
const tambahKel = (map, kunci, label, a, k) => { const c = map.get(kunci) ?? { kunci, label, aktual: 0, kasKeluar: 0, nDokumen: 0 }; c.aktual += a; c.kasKeluar += k; c.nDokumen += 1; map.set(kunci, c); };

/** Agregasi fakta teratribusi → per kelompok (scope). Mengembalikan { per:Map, baris:[...] }. */
export function agregasi(fakta, atr, { sertakanSensitif, filter = {} }) {
  const per = new Map();
  const baris = [];
  let disaring = 0;
  for (const f of fakta) {
    const a = atr.get(f.id);
    if (!a) continue;
    const sens = f.sensitifAkun || a.sensitif;
    if (sens && !sertakanSensitif) { disaring += 1; continue; }
    if (filter.kategori && a.kategori?.kode !== filter.kategori) continue;
    if (filter.proyek && (a.proyek ?? "").toLowerCase() !== String(filter.proyek).toLowerCase()) continue;
    if (filter.status && a.status !== filter.status) continue;
    for (const b of a.bagian) {
      const scope = b.scope;
      if (!per.has(scope)) per.set(scope, kosong());
      const c = per.get(scope);
      const akt = f.aktual * b.bobot; const kas = f.kasKeluar * b.bobot;
      c.aktual += akt; c.kasKeluar += kas; c.penerimaan += f.penerimaan * b.bobot; c.pemakaian += f.pemakaian * b.bobot; c.nDokumen += 1;
      if (a.konflik?.length) c.konflik += 1;
      // kelompok: aktual per AKUN (satu jurnal bisa memuat beberapa akun), kas per entri
      let kasDialokasi = false;
      const akunList = f.akun.length ? f.akun : [{ kode: null, nama: null, nilai: 0 }];
      for (const ak of akunList) {
        const g = kelompokUntuk(scope, { kategoriKode: a.kategori?.kode, source: a.sumberAsli, akunKode: ak.kode });
        const kunci = g?.kunci ?? "_lain"; const label = g?.label ?? "Komponen lain";
        tambahKel(c.kelompok, kunci, label, ak.nilai * b.bobot, kasDialokasi ? 0 : kas);
        kasDialokasi = true;
      }
      const kk = a.kategori?.kode ?? (f.akun[0] ? `AKUN:${f.akun[0].kode}` : "—");
      const kn = a.kategori?.nama ?? f.akun[0]?.nama ?? "Tanpa kategori";
      tambahKel(c.kategori, kk, kn, akt, kas);
      if (a.proyek) tambahKel(c.proyek, a.proyek, a.proyek, akt, kas);
      const bln = f.tanggal.slice(0, 7);
      const t = c.tren.get(bln) ?? { bulan: bln, aktual: 0, kasKeluar: 0 }; t.aktual += akt; t.kasKeluar += kas; c.tren.set(bln, t);
      const th = c.tahap.get(a.tahap) ?? { tahap: a.tahap, n: 0, aktual: 0, kasKeluar: 0 }; th.n += 1; th.aktual += akt; th.kasKeluar += kas; c.tahap.set(a.tahap, th);
      baris.push({
        entryId: f.id, nomor: f.nomor, tanggal: f.tanggal, deskripsi: f.deskripsi, sumber: a.sumberAsli, scope, bobot: b.bobot, aktual: rp(akt), kasKeluar: rp(kas),
        tahap: a.tahap, aturan: a.aturan, konflik: a.konflik ?? [], dokumen: a.dokumen, kategori: a.kategori, status: a.status ?? null, proyek: a.proyek ?? null, balik: !!a.balik, sensitif: !!sens,
      });
    }
  }
  return { per, baris, disaring };
}

// ── 3. BULAN dalam rentang, proyeksi ──────────────────────────────────────────────────────────────────────────────────
export function daftarBulan(from, to, maks = 24) {
  const out = [];
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [yt, mt] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  while ((y < yt || (y === yt && m <= mt)) && out.length < maks) { out.push(`${y}-${String(m).padStart(2, "0")}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
}
const hariDalamBulan = (bulan) => new Date(Date.UTC(Number(bulan.slice(0, 4)), Number(bulan.slice(5, 7)), 0)).getUTCDate();
const tanggalWIB = (d) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** Proyeksi akhir bulan HANYA untuk satu bulan kalender penuh yang sedang berjalan (WIB). Rata-rata harian × hari bulan. */
export function proyeksiAkhirBulan({ from, to, aktual, sekarang = new Date() }) {
  const bulan = from.slice(0, 7);
  if (bulan !== to.slice(0, 7) || from.slice(8, 10) !== "01" || to.slice(8, 10) !== String(hariDalamBulan(bulan)).padStart(2, "0")) return { nilai: null, alasan: "Proyeksi hanya tersedia untuk satu bulan kalender penuh" };
  const hariIni = tanggalWIB(sekarang);
  if (hariIni.slice(0, 7) !== bulan) return { nilai: null, alasan: hariIni.slice(0, 7) > bulan ? "Bulan sudah berakhir — angka aktual sudah final" : "Bulan belum berjalan" };
  const hari = Number(hariIni.slice(8, 10));
  if (hari < 3) return { nilai: null, alasan: "Terlalu awal bulan untuk memproyeksikan (kurang dari 3 hari data)" };
  return { nilai: rp((aktual / hari) * hariDalamBulan(bulan)), alasan: null, hariBerjalan: hari, hariBulan: hariDalamBulan(bulan) };
}

// ── 4. LAPORAN LENGKAP ────────────────────────────────────────────────────────────────────────────────────────────────
export async function bangunLaporan(db, { from, to, scopeDiminta = null, filter = {}, akses, sekarang = new Date(), denganBaris = false }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw Object.assign(new Error("Periode wajib diisi (from & to, YYYY-MM-DD, from ≤ to)"), { statusCode: 400 });
  const scopes = tetapkanScope(akses, scopeDiminta);
  const semua = bolehSensitif(akses);

  const [fakta, komitmenSemua] = await Promise.all([muatFakta(db, { from, to }), hitungKomitmen(db, { from, to })]);
  const atr = await atribusiEntri(db, fakta.map((f) => ({ id: f.id, source: f.source, sourceId: f.sourceId, reversalOfId: f.reversalOfId })));
  const { per, baris, disaring } = agregasi(fakta, atr, { sertakanSensitif: semua, filter });
  const anggaran = await anggaranBerlaku(db, { from, to, divisions: scopes.filter((s) => DIVISI.includes(s)) });
  const bulan = daftarBulan(from, to);

  // komitmen per kelompok (filter kategori/status ikut)
  const komitmen = new Map();
  for (const k of komitmenSemua) {
    const a = k.atribusi;
    if (a.sensitif && !semua) continue;
    if (filter.kategori && a.kategori?.kode !== filter.kategori) continue;
    if (filter.status && k.status !== filter.status) continue;
    // Proyek/campaign hanya dikenal pada belanja iklan; dokumen komitmen tidak punya proyek → tidak ikut bila filter proyek aktif (konsisten dengan Aktual & Kas Keluar).
    if (filter.proyek && (a.proyek ?? "").toLowerCase() !== String(filter.proyek).toLowerCase()) continue;
    for (const b of a.bagian) {
      const c = komitmen.get(b.scope) ?? { belumDibukukan: 0, dibukukanBelumDibayar: 0, n: 0 };
      if (k.jenis === JENIS_KOMITMEN.BELUM_DIBUKUKAN) c.belumDibukukan += k.jumlah * b.bobot; else c.dibukukanBelumDibayar += k.jumlah * b.bobot;
      c.n += 1; komitmen.set(b.scope, c);
    }
  }

  const divisi = [];
  for (const scope of scopes) {
    if (scope === DI_LUAR_DIVISI) continue;
    const c = per.get(scope) ?? kosong();
    const rinci = bolehRinci(akses, scope);
    const ang = anggaran.get(scope);
    // Filter kategori/proyek: pembanding anggaran = baris anggaran kategori/proyek itu (bukan total divisi), supaya Aktual terfilter tidak dibandingkan dengan total.
    const anggaranTotal = !ang ? null : filter.kategori ? (ang.perKategori.get(filter.kategori)?.jumlah ?? null) : filter.proyek ? (ang.perProyek.get(filter.proyek) ?? null) : rp(ang.total);
    const aktual = rp(c.aktual);
    const proy = proyeksiAkhirBulan({ from, to, aktual, sekarang });
    const sisa = anggaranTotal == null ? null : rp(anggaranTotal - aktual);
    const kel = [...c.kelompok.values()];
    const tampil = kel.filter((g) => g.kunci !== "_lain" && (Math.abs(g.aktual) >= 0.005 || Math.abs(g.kasKeluar) >= 0.005));
    const lain = kel.filter((g) => g.kunci === "_lain" || (Math.abs(g.aktual) < 0.005 && Math.abs(g.kasKeluar) < 0.005));
    const kom = komitmen.get(scope) ?? { belumDibukukan: 0, dibukukanBelumDibayar: 0, n: 0 };
    const overBudget = anggaranTotal != null && aktual > anggaranTotal;
    const proyeksiOver = anggaranTotal != null && proy.nilai != null && proy.nilai > anggaranTotal && !overBudget;
    divisi.push({
      scope, label: LABEL_DIVISI[scope], level: akses.scopes.get(scope), rinci,
      aktual, kasKeluar: rp(c.kasKeluar), nDokumen: c.nDokumen,
      komitmen: { belumDibukukan: rp(kom.belumDibukukan), dibukukanBelumDibayar: rp(kom.dibukukanBelumDibayar), nDokumen: kom.n },
      anggaran: anggaranTotal, sisaAnggaran: sisa, persenTerpakai: anggaranTotal ? rp((aktual / anggaranTotal) * 100) : null, anggaranBulan: ang ? Object.fromEntries(ang.bulan) : null,
      proyeksi: { ...proy, anggaranPersenProyeksi: proy.nilai != null && anggaranTotal ? rp((proy.nilai / anggaranTotal) * 100) : null },
      alert: overBudget ? { jenis: "OVER_BUDGET", pesan: `Aktual melebihi anggaran sebesar Rp${Math.round(aktual - anggaranTotal).toLocaleString("id-ID")}` } : proyeksiOver ? { jenis: "PROYEKSI_OVER", pesan: "Proyeksi akhir bulan melampaui anggaran" } : null,
      kelompok: tampil.map((g) => ({ kunci: g.kunci, label: g.label, aktual: rp(g.aktual), kasKeluar: rp(g.kasKeluar), nDokumen: g.nDokumen })),
      komponenLain: { aktual: rp(lain.reduce((s, g) => s + g.aktual, 0)), kasKeluar: rp(lain.reduce((s, g) => s + g.kasKeluar, 0)), daftar: [...new Set([...(KELOMPOK[scope] ?? []).filter((g) => !tampil.some((t) => t.kunci === g.kunci)).map((g) => g.label), ...lain.filter((g) => g.kunci !== "_lain").map((g) => g.label)])] },
      perKategori: rinci ? [...c.kategori.values()].sort((a, b) => Math.abs(b.aktual) - Math.abs(a.aktual)).map((g) => ({ kode: g.kunci, nama: g.label, aktual: rp(g.aktual), kasKeluar: rp(g.kasKeluar), nDokumen: g.nDokumen, anggaran: ang?.perKategori.get(g.kunci)?.jumlah ?? null })) : [],
      perProyek: rinci ? [...c.proyek.values()].map((g) => ({ proyek: g.kunci, aktual: rp(g.aktual), kasKeluar: rp(g.kasKeluar), anggaran: ang?.perProyek.get(g.kunci) ?? null })) : [],
      tren: bulan.map((b) => ({ bulan: b, aktual: rp(c.tren.get(b)?.aktual ?? 0), kasKeluar: rp(c.tren.get(b)?.kasKeluar ?? 0), anggaran: ang?.bulan.get(b) ?? null })),
      tahap: semua ? [...c.tahap.values()].map((t) => ({ tahap: t.tahap, n: t.n, aktual: rp(t.aktual), kasKeluar: rp(t.kasKeluar) })) : undefined,
      konflik: semua ? c.konflik : undefined,
      persediaan: scope === "WAREHOUSE" ? { nilaiPenerimaan: rp(c.penerimaan), nilaiPemakaian: rp(c.pemakaian) } : undefined,
    });
  }
  const urut = (a, b) => SEMUA_KELOMPOK.indexOf(a.scope) - SEMUA_KELOMPOK.indexOf(b.scope);
  divisi.sort(urut);

  const jumlah = (arr, f) => rp(arr.reduce((s, d) => s + (d[f] ?? 0), 0));
  const adaAnggaran = divisi.filter((d) => d.anggaran != null);
  const ringkasan = {
    aktual: jumlah(divisi, "aktual"), kasKeluar: jumlah(divisi, "kasKeluar"),
    komitmenBelumDibukukan: rp(divisi.reduce((s, d) => s + d.komitmen.belumDibukukan, 0)), komitmenDibukukanBelumDibayar: rp(divisi.reduce((s, d) => s + d.komitmen.dibukukanBelumDibayar, 0)),
    anggaran: adaAnggaran.length ? jumlah(adaAnggaran, "anggaran") : null,
    sisaAnggaran: adaAnggaran.length ? rp(jumlah(adaAnggaran, "anggaran") - jumlah(adaAnggaran, "aktual")) : null,
    divisiTanpaAnggaran: divisi.filter((d) => d.anggaran == null && d.scope !== "SHARED" && d.scope !== TIDAK_TERKLASIFIKASI).length,
    alert: divisi.filter((d) => d.alert).map((d) => ({ scope: d.scope, label: d.label, ...d.alert })),
  };

  // JEMBATAN — hanya Finance (angka seluruh buku). Dua pembanding independen dari helper Fase 1.
  let jembatan = null;
  if (semua && !filter.kategori && !filter.proyek && !filter.status) {
    const [ledger, kas] = await Promise.all([bebanLedger(db, { from, to }), arusKas(db, { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${to}T00:00:00.000Z`) })]);
    const aktualDivisi = rp([...per.entries()].filter(([k]) => k !== DI_LUAR_DIVISI).reduce((s, [, c]) => s + c.aktual, 0));
    const aktualLuar = rp(per.get(DI_LUAR_DIVISI)?.aktual ?? 0);
    const kasDivisi = rp([...per.entries()].filter(([k]) => k !== DI_LUAR_DIVISI).reduce((s, [, c]) => s + c.kasKeluar, 0));
    const kasLuar = rp(per.get(DI_LUAR_DIVISI)?.kasKeluar ?? 0);
    jembatan = {
      aktual: { totalKelompok: aktualDivisi, diLuarDivisi: aktualLuar, ledger: rp(ledger), residual: rp(aktualDivisi + aktualLuar - ledger), pembanding: "Σ debit−kredit akun beban & beban pokok (jurnal POSTED/REVERSED) — sama dengan Beban Diakui Fase 1" },
      kasKeluar: { totalKelompok: kasDivisi, diLuarDivisi: kasLuar, arusKas: rp(kas.ringkasan.keluar), residual: rp(kasDivisi + kasLuar - kas.ringkasan.keluar), pembanding: "Kas Keluar pada Laporan Arus Kas (Fase 1)" },
      status: { perhitungan: Math.abs(aktualDivisi + aktualLuar - ledger) < 0.01 && Math.abs(kasDivisi + kasLuar - kas.ringkasan.keluar) < 0.01 ? "COCOK" : "TIDAK_COCOK" },
    };
  }

  return {
    periode: { from, to, bulan }, filter, basis: BASIS_LAPORAN, tidakTermasuk: TIDAK_TERMASUK, scopeTampil: scopes,
    akses: { level: akses.level, scopes: Object.fromEntries(akses.scopes), sakelar: akses.sakelar },
    ringkasan, divisi, jembatan, sensitifDisaring: !semua && disaring > 0,
    ...(denganBaris ? { baris: baris.filter((b) => scopes.includes(b.scope)), komitmenRinci: komitmenSemua.filter((k) => !(k.atribusi.sensitif && !semua) && k.atribusi.bagian.some((b) => scopes.includes(b.scope))) } : {}),
  };
}

/** Beban Diakui ledger independen (dipakai jembatan). */
export async function bebanLedger(db, { from, to }) {
  const r = await db.finJournalLine.aggregate({
    where: { account: { type: { in: TIPE_BEBAN } }, entry: { status: { in: STATUS_DIHITUNG }, date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } } },
    _sum: { debit: true, credit: true },
  });
  return moneyToNumber(r._sum.debit ?? 0) - moneyToNumber(r._sum.credit ?? 0);
}

export { startOfDayWIB, TAHAP, LEVEL, bulanKunci };
