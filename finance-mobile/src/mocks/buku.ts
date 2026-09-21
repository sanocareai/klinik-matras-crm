// SERVER BUKU PALSU (mode contoh saja — tidak pernah aktif di production). Meniru kontrak GET /finance/buku/* dan pencocokan bank: jurnal (satu TIDAK seimbang,
// satu pasangan balik, dokumen terkait), buku besar dengan saldo berjalan (aritmetika sen di "server" = mock ini), rekonsiliasi dengan kandidat.
// Skenario `konflik` / `izin` / `putus` mensimulasikan 409 / 403 / hasil tidak pasti pada pencocokan.

import { ApiError } from "@/api/errors";
import { LIMIT_BUKU } from "@/api/buku";
import { toMoney, type Money } from "@/lib/money";
import { useSession } from "@/auth/session";
import { has } from "@/auth/capabilities";
import { getSkenario, simulasiBaca, versiSkenario } from "./skenario";
import type { AkunPilihan, AksiTx, BukuBesarHalaman, DetailJurnal, FilterJurnal, HalamanJurnal, JurnalItem, RekonDetail, RekonItem } from "@/api/types";

const m = toMoney;
const HARI = 86400000;
const hariWIB = (d: Date) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const lalu = (n: number) => hariWIB(new Date(Date.now() - n * HARI));
const tunda = (ms: number) => new Promise<void>((r) => setTimeout(r, getSkenario() === "lambat" ? 4000 : ms));

const sen = (v: string): bigint => { const neg = v.startsWith("-"); const [w = "0", f = "00"] = (neg ? v.slice(1) : v).split("."); const x = BigInt(w) * 100n + BigInt(f.padEnd(2, "0").slice(0, 2)); return neg ? -x : x; };
const dariSen = (v: bigint): Money => { const neg = v < 0n; const a = neg ? -v : v; return m(`${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`); };

const AKUN: (AkunPilihan & { id: string })[] = [
  { id: "a-bank", code: "1-1200", name: "Bank", type: "ASET", normalBalance: "DEBIT", active: true },
  { id: "a-kas", code: "1-1100", name: "Kas", type: "ASET", normalBalance: "DEBIT", active: true },
  { id: "a-modal", code: "3-1100", name: "Modal Disetor", type: "EKUITAS", normalBalance: "KREDIT", active: true },
  { id: "a-iklan", code: "6-1200", name: "Beban Iklan & Pemasaran", type: "BEBAN", normalBalance: "DEBIT", active: true },
  { id: "a-bbm", code: "6-1300", name: "Beban BBM", type: "BEBAN", normalBalance: "DEBIT", active: true },
  { id: "a-kosong", code: "6-1900", name: "Beban Lain-lain", type: "BEBAN", normalBalance: "DEBIT", active: true },
];
const akunById = (id: string) => AKUN.find((a) => a.id === id);

type Baris = { lineId: string; akunId: string; d: string; k: string; ket?: string; rekening?: string };
type J = { id: string; nomor: string; tanggal: string; ket: string; sumber: string; status: string; baris: Baris[]; dokumen?: JurnalItem["dokumen"]; membalik?: string; dibalikOleh?: string; oleh?: string };
const LABEL_SUMBER: Record<string, string> = { SALDO_AWAL: "Saldo awal", PENGELUARAN: "Pengeluaran", REVERSAL: "Jurnal balik", MANUAL: "Jurnal manual", PEMASUKAN_LAIN: "Pemasukan lain" };
const STATUS: Record<string, [string, JurnalItem["nada"]]> = { POSTED: ["Terposting", "success"], REVERSED: ["Sudah dibalik", "warning"] };

let jurnal: J[] = [];
let rekon: RekonDetail[] = [];
let versiDb = -1;

function seed() {
  const k = getSkenario();
  jurnal = [];
  rekon = [];
  if (k === "kosong") return;
  const bar = (id: string, akunId: string, d: string, kr: string, ket?: string): Baris => ({ lineId: id, akunId, d, k: kr, ket });
  jurnal.push({ id: "j1", nomor: "JV-01092026-001", tanggal: "2026-09-01", ket: "Modal awal Sep", sumber: "SALDO_AWAL", status: "POSTED", baris: [bar("l1a", "a-bank", "50000000.00", "0.00"), bar("l1b", "a-modal", "0.00", "50000000.00")] });
  jurnal.push({ id: "j2", nomor: "JV-10092026-002", tanggal: "2026-09-10", ket: "EXP-10092026-001 — Servis truk", sumber: "PENGELUARAN", status: "POSTED", dokumen: { modul: "pengeluaran", id: "e1", nomor: "EXP-10092026-001" }, oleh: "Natasha", baris: [bar("l2a", "a-bbm", "200000.00", "0.00"), bar("l2b", "a-bank", "0.00", "200000.00")] });
  jurnal.push({ id: "j3", nomor: "JV-12092026-003", tanggal: "2026-09-12", ket: "EXP-12092026-002 — Meta ads", sumber: "PENGELUARAN", status: "REVERSED", dibalikOleh: "JV-13092026-004", dokumen: { modul: "pengeluaran", id: "e2", nomor: "EXP-12092026-002" }, baris: [bar("l3a", "a-iklan", "3000000.00", "0.00"), bar("l3b", "a-bank", "0.00", "3000000.00")] });
  jurnal.push({ id: "j4", nomor: "JV-13092026-004", tanggal: "2026-09-13", ket: "Pembatalan JV-12092026-003 — salah input", sumber: "REVERSAL", status: "POSTED", membalik: "JV-12092026-003", baris: [bar("l4a", "a-bank", "3000000.00", "0.00"), bar("l4b", "a-iklan", "0.00", "3000000.00")] });
  jurnal.push({ id: "j5", nomor: "JV-15092026-005", tanggal: "2026-09-15", ket: "Fixture timpang", sumber: "MANUAL", status: "POSTED", baris: [bar("l5a", "a-bank", "100000.00", "0.00"), bar("l5b", "a-modal", "0.00", "70000.00")] });
  jurnal.push({ id: "j6", nomor: "JV-16092026-006", tanggal: "2026-09-16", ket: "Bunga bank", sumber: "PEMASUKAN_LAIN", status: "POSTED", baris: [bar("l6a", "a-bank", "75000.50", "0.00"), bar("l6b", "a-kosong", "0.00", "75000.50")] });
  for (let i = 0; i < 24; i++) {
    const tgl = lalu(i + 1);
    jurnal.push({ id: `jx${i}`, nomor: `JV-${tgl.slice(8)}${tgl.slice(5, 7)}${tgl.slice(0, 4)}-${100 + i}`, tanggal: tgl, ket: `Bensin harian ${i + 1}`, sumber: "PENGELUARAN", status: "POSTED", baris: [bar(`lx${i}a`, "a-bbm", `${(i + 1) * 10000}.00`, "0.00"), bar(`lx${i}b`, "a-kas", "0.00", `${(i + 1) * 10000}.00`)] });
  }
  const b = (id: string, tanggal: string, ket: string, nominal: string, extra: Partial<RekonDetail["baris"][number]> = {}): RekonDetail["baris"][number] => ({
    id, tanggal, keterangan: ket, referensi: null, nominal: m(nominal), status: "BELUM_COCOK", statusLabel: "Belum cocok", nada: "warning", catatan: null, cocokDengan: null, dicocokkan: null, kandidat: [],
    aksi: { cocokkan: { boleh: false, alasan: null, path: "", metode: "POST", perlu: [], tetap: null }, lepas: { boleh: false, alasan: null, path: "", metode: "POST", perlu: [], tetap: null } }, ...extra,
  });
  rekon.push({
    id: "r1", rekening: { id: "rk1", name: "KEM - Sano Bank" }, periode: { from: "2026-09-01", to: "2026-09-30" }, status: "DRAFT", statusLabel: "Berjalan", nada: "warning", catatan: null,
    saldoAwalKoran: m("0.00"), saldoKoran: m("52875000.50"), saldoBuku: m("52875000.50"), selisih: m("0.00"), cocok: true,
    ringkasan: { jumlahBaris: 3, belumCocok: 3, cocokBaris: 0, diabaikan: 0, mutasiBukuBelumDipasangkan: 3 }, terpotong: false, riwayat: [{ waktu: new Date(Date.now() - 3 * HARI).toISOString(), peristiwa: "DIBUAT", label: "Koran bank dicatat", oleh: "Natasha", catatan: null }], diperbaruiPada: null, penutup: null,
    baris: [b("rb1", "2026-09-10", "TRF servis truk", "-200000.00"), b("rb2", "2026-09-16", "Bunga bank", "75000.50"), b("rb3", "2026-09-20", "Biaya admin bank", "-2500.00")],
  });
  rekon.push({
    id: "r2", rekening: { id: "rk2", name: "PT Sano" }, periode: { from: "2026-08-01", to: "2026-08-31" }, status: "SELESAI", statusLabel: "Selesai", nada: "success", catatan: "Ditutup dengan selisih biaya admin", saldoAwalKoran: m("0.00"), saldoKoran: m("36870615.00"), saldoBuku: m("36868115.00"), selisih: m("2500.00"), cocok: false,
    ringkasan: { jumlahBaris: 0, belumCocok: 0, cocokBaris: 0, diabaikan: 0, mutasiBukuBelumDipasangkan: 0 }, terpotong: false, riwayat: [], diperbaruiPada: null, penutup: { pada: new Date(Date.now() - 20 * HARI).toISOString(), oleh: { id: "u", name: "Kemal" } }, baris: [],
  });
  hitungKandidat();
}

/** Kandidat per baris koran belum cocok = mutasi Bank di periode dengan nominal & arah sama (server-side di backend nyata). */
function hitungKandidat() {
  const caps = useSession.getState().capabilities;
  const boleh = has(caps, "financePost");
  for (const r of rekon) {
    const pakai = new Set(r.baris.filter((x) => x.cocokDengan).map((x) => x.cocokDengan?.lineId));
    for (const x of r.baris) {
      if (x.status === "BELUM_COCOK") {
        x.kandidat = jurnal.filter((j) => j.tanggal === x.tanggal || j.ket.toLowerCase().includes(x.keterangan.toLowerCase().split(" ").at(-1) ?? "###")).flatMap((j) => j.baris.filter((l) => l.akunId === "a-bank" && !pakai.has(l.lineId) && sen(l.d) - sen(l.k) === sen(x.nominal)).map((l) => ({ lineId: l.lineId, jurnalId: j.id, nomor: j.nomor, tanggal: j.tanggal, keterangan: j.ket, sumber: LABEL_SUMBER[j.sumber] ?? j.sumber, nilai: dariSen(sen(l.d) - sen(l.k)) })));
      } else x.kandidat = [];
      const ok = boleh && r.status === "DRAFT";
      const aksi = (b: boolean, alasan: string, path: string): AksiTx => ({ boleh: b, alasan: b ? null : alasan, path, metode: "POST", perlu: [], tetap: null });
      x.aksi = {
        cocokkan: aksi(ok && x.status === "BELUM_COCOK" && x.kandidat.length > 0, !boleh ? "Akun Anda tidak boleh mencocokkan mutasi." : x.status !== "BELUM_COCOK" ? "Baris ini sudah diproses." : r.status !== "DRAFT" ? "Rekonsiliasi periode ini sudah selesai." : "Tidak ada mutasi buku dengan nominal & arah yang sama. Catat penyesuaian sebagai jurnal di web dulu.", `/finance/bank-lines/${x.id}/match`),
        lepas: aksi(ok && x.status === "COCOK", !boleh ? "Akun Anda tidak boleh mencocokkan mutasi." : x.status !== "COCOK" ? "Baris ini belum dicocokkan." : "Rekonsiliasi periode ini sudah selesai.", `/finance/bank-lines/${x.id}/unmatch`),
      };
    }
    r.ringkasan = {
      jumlahBaris: r.baris.length, belumCocok: r.baris.filter((x) => x.status === "BELUM_COCOK").length, cocokBaris: r.baris.filter((x) => x.status === "COCOK").length, diabaikan: 0,
      mutasiBukuBelumDipasangkan: jurnal.flatMap((j) => j.baris).filter((l) => l.akunId === "a-bank" && !sudahDipakai(l.lineId, r)).length,
    };
  }
}
const sudahDipakai = (lineId: string, r: RekonDetail) => r.baris.some((x) => x.cocokDengan?.lineId === lineId);

function pastikan() { if (versiDb !== versiSkenario()) { seed(); versiDb = versiSkenario(); } }

function keItem(j: J): JurnalItem {
  const d = j.baris.reduce((s, b) => s + sen(b.d), 0n);
  const k = j.baris.reduce((s, b) => s + sen(b.k), 0n);
  const [statusLabel, nada] = STATUS[j.status] ?? [j.status, "neutral" as const];
  return {
    id: j.id, nomor: j.nomor, tanggal: j.tanggal, keterangan: j.ket, sumber: j.sumber, sumberLabel: LABEL_SUMBER[j.sumber] ?? j.sumber, status: j.status, statusLabel, nada, totalDebit: dariSen(d), totalKredit: dariSen(k),
    seimbang: d === k, selisih: dariSen(d - k), jumlahBaris: j.baris.length,
    membalik: j.membalik ? { id: jurnal.find((x) => x.nomor === j.membalik)?.id ?? "", nomor: j.membalik } : null, dibalikOleh: j.dibalikOleh ? { id: jurnal.find((x) => x.nomor === j.dibalikOleh)?.id ?? "", nomor: j.dibalikOleh } : null,
    dokumen: j.dokumen ?? null, dibuatOleh: j.oleh ? { id: "u1", name: j.oleh } : null,
  };
}

export async function mockDaftarJurnal(f: FilterJurnal, page: number): Promise<HalamanJurnal> {
  await simulasiBaca("buku:jurnal");
  pastikan();
  const kata = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean).map((k) => (/^[\d.]+$/.test(k) ? k.replace(/\./g, "") : k));
  const semua = jurnal.filter((j) => (!f.from || !f.to || (j.tanggal >= f.from && j.tanggal <= f.to)) && (!f.source || j.sumber === f.source) && (!f.akunId || j.baris.some((b) => b.akunId === f.akunId))
    && kata.every((k) => `${j.nomor} ${j.ket} ${j.baris.map((b) => `${sen(b.d) / 100n} ${sen(b.k) / 100n}`).join(" ")}`.toLowerCase().includes(k)));
  const dasar = semua;
  const pilih = dasar.filter((j) => !f.status || j.status === f.status).sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1));
  const awal = (page - 1) * LIMIT_BUKU;
  const items = pilih.slice(awal, awal + LIMIT_BUKU).map(keItem);
  const hitung: Record<string, number> = {};
  for (const j of dasar) hitung[j.status] = (hitung[j.status] ?? 0) + 1;
  return { items, page, total: pilih.length, adaLagi: awal + items.length < pilih.length, hitung, tidakSeimbang: jurnal.filter((j) => !keItem(j).seimbang).length, diperbaruiPada: new Date().toISOString() };
}

export async function mockDetailJurnal(id: string): Promise<DetailJurnal> {
  await simulasiBaca(`buku:jurnal:${id}`);
  pastikan();
  const j = jurnal.find((x) => x.id === id);
  if (!j) throw new ApiError({ status: 404, code: "NOT_FOUND", message: "Data tidak ditemukan" });
  const item = keItem(j);
  return {
    ...item, baris: j.baris.map((b, i) => ({ no: i + 1, akunId: b.akunId, kodeAkun: akunById(b.akunId)?.code ?? "", namaAkun: akunById(b.akunId)?.name ?? "", debit: m(b.d), kredit: m(b.k), keterangan: b.ket ?? null, order: null, pelanggan: null, supplier: null, rekening: b.akunId === "a-bank" ? "KEM - Sano Bank" : null })),
    diposting: { pada: new Date(Date.now() - 2 * HARI).toISOString(), oleh: { id: "u1", name: "Natasha" } }, alasanBalik: j.dibalikOleh ? "salah input" : null,
    riwayat: [{ waktu: new Date(Date.now() - 2 * HARI).toISOString(), peristiwa: "DIBUAT", label: "Dibuat", oleh: "Natasha", catatan: null }, ...(j.dibalikOleh ? [{ waktu: new Date(Date.now() - HARI).toISOString(), peristiwa: "DIBALIK", label: `Dibalik oleh ${j.dibalikOleh}`, oleh: null, catatan: "salah input" }] : [])],
    catatan: item.seimbang ? null : "Jurnal ini TIDAK seimbang. Ini keadaan darurat — hubungi admin; perbaikannya hanya di web.",
  };
}

export async function mockDaftarAkun(q: string): Promise<AkunPilihan[]> {
  await simulasiBaca("buku:akun");
  return AKUN.filter((a) => !q.trim() || `${a.code} ${a.name}`.toLowerCase().includes(q.trim().toLowerCase()));
}

export async function mockMutasiAkun(akunId: string, from: string, to: string, page: number): Promise<BukuBesarHalaman> {
  await simulasiBaca(`buku:mutasi:${akunId}`);
  pastikan();
  const a = akunById(akunId);
  if (!a) throw new ApiError({ status: 404, code: "NOT_FOUND", message: "Data tidak ditemukan" });
  const net = (l: Baris) => (a.normalBalance === "DEBIT" ? sen(l.d) - sen(l.k) : sen(l.k) - sen(l.d));
  const semua = jurnal.flatMap((j) => j.baris.filter((l) => l.akunId === akunId).map((l) => ({ j, l }))).sort((x, y) => (x.j.tanggal === y.j.tanggal ? (x.j.nomor < y.j.nomor ? -1 : 1) : x.j.tanggal < y.j.tanggal ? -1 : 1));
  const awal = semua.filter((x) => x.j.tanggal < from).reduce((s, x) => s + net(x.l), 0n);
  const dalam = semua.filter((x) => x.j.tanggal >= from && x.j.tanggal <= to);
  let saldo = awal;
  let td = 0n;
  let tk = 0n;
  const baris = dalam.map(({ j, l }) => { saldo += net(l); td += sen(l.d); tk += sen(l.k); return { lineId: l.lineId, jurnalId: j.id, nomor: j.nomor, tanggal: j.tanggal, keterangan: j.ket, sumber: j.sumber, sumberLabel: LABEL_SUMBER[j.sumber] ?? j.sumber, status: j.status, debit: m(l.d), kredit: m(l.k), saldo: dariSen(saldo), penanda: null }; });
  const lim = 30;
  const skip = (page - 1) * lim;
  return {
    akun: { id: a.id, kode: a.code, nama: a.name, tipe: a.type, saldoNormal: a.normalBalance }, periode: { from, to }, saldoAwal: dariSen(awal), totalDebit: dariSen(td), totalKredit: dariSen(tk), saldoAkhir: dariSen(saldo),
    total: baris.length, page, adaLagi: skip + lim < baris.length, baris: baris.slice(skip, skip + lim), diperbaruiPada: new Date().toISOString(),
  };
}

export async function mockDaftarRekon(): Promise<RekonItem[]> {
  await simulasiBaca("buku:rekon");
  pastikan();
  hitungKandidat();
  return rekon.map((r) => ({ id: r.id, rekening: r.rekening, periode: r.periode, status: r.status, statusLabel: r.statusLabel, nada: r.nada, saldoKoran: r.saldoKoran, saldoBuku: r.saldoBuku, selisih: r.selisih, cocok: r.cocok, jumlahBaris: r.baris.length, belumCocok: r.ringkasan.belumCocok, cocokBaris: r.ringkasan.cocokBaris, diabaikan: r.ringkasan.diabaikan }));
}

export async function mockDetailRekon(id: string): Promise<RekonDetail> {
  await simulasiBaca(`buku:rekon:${id}`);
  pastikan();
  hitungKandidat();
  const r = rekon.find((x) => x.id === id);
  if (!r) throw new ApiError({ status: 404, code: "NOT_FOUND", message: "Data tidak ditemukan" });
  return JSON.parse(JSON.stringify(r)) as RekonDetail;
}

const galat = (kode: string, status: number, pesan: string, tidakPasti = false) => new ApiError({ status, code: kode, message: pesan, tidakPasti });
function gagalSkenario() {
  const s = getSkenario();
  if (s === "izin") throw galat("FORBIDDEN", 403, "Anda tidak punya izin untuk tindakan ini");
  if (s === "offline" || s === "putus") throw galat("NETWORK", 0, "Status belum pasti — koneksi terputus setelah perintah terkirim.", true);
  if (s === "galat") throw galat("INTERNAL", 500, "boom");
}

export async function mockCocokkan(path: string, journalLineId: string): Promise<void> {
  await tunda(450);
  pastikan();
  gagalSkenario();
  const id = /\/bank-lines\/([^/]+)\/match$/.exec(path)?.[1];
  const r = rekon.find((x) => x.baris.some((b) => b.id === id));
  const x = r?.baris.find((b) => b.id === id);
  if (!r || !x) throw galat("NOT_FOUND", 404, "Baris koran bank tidak ditemukan");
  if (getSkenario() === "konflik") { x.status = "COCOK"; x.statusLabel = "Cocok"; x.nada = "success"; throw galat("KONFLIK", 409, "Baris koran ini sudah dicocokkan"); }
  if (r.status === "SELESAI") throw galat("KONFLIK", 409, "Rekonsiliasi periode ini sudah ditutup — buka kembali kalau memang perlu diubah");
  if (x.status === "COCOK") throw galat("KONFLIK", 409, "Baris koran ini sudah dicocokkan");
  if (r.baris.some((b) => b.cocokDengan?.lineId === journalLineId)) throw galat("KONFLIK", 409, "Baris jurnal ini sudah dicocokkan dengan baris koran lain");
  const k = x.kandidat.find((c) => c.lineId === journalLineId);
  if (!k) throw galat("VALIDASI", 400, "Baris jurnal itu bukan mutasi rekening yang sedang direkonsiliasi");
  x.status = "COCOK"; x.statusLabel = "Cocok"; x.nada = "success"; x.cocokDengan = { lineId: k.lineId, jurnalId: k.jurnalId, nomor: k.nomor, tanggal: k.tanggal, keterangan: k.keterangan, nilai: k.nilai };
  x.dicocokkan = { oleh: { id: "u", name: useSession.getState().user?.name ?? "Anda" }, pada: new Date().toISOString() };
  r.riwayat.push({ waktu: new Date().toISOString(), peristiwa: "DOCUMENT_EDITED", label: "Baris koran dicocokkan", oleh: useSession.getState().user?.name ?? "Anda", catatan: x.keterangan });
}

export async function mockLepas(path: string): Promise<void> {
  await tunda(450);
  pastikan();
  gagalSkenario();
  const id = /\/bank-lines\/([^/]+)\/unmatch$/.exec(path)?.[1];
  const r = rekon.find((x) => x.baris.some((b) => b.id === id));
  const x = r?.baris.find((b) => b.id === id);
  if (!r || !x) throw galat("NOT_FOUND", 404, "Baris koran bank tidak ditemukan");
  if (r.status === "SELESAI") throw galat("KONFLIK", 409, "Rekonsiliasi periode ini sudah ditutup — buka kembali kalau memang perlu diubah");
  if (x.status !== "COCOK") throw galat("KONFLIK", 409, "Baris koran ini tidak sedang dicocokkan");
  x.status = "BELUM_COCOK"; x.statusLabel = "Belum cocok"; x.nada = "warning"; x.cocokDengan = null; x.dicocokkan = null;
  r.riwayat.push({ waktu: new Date().toISOString(), peristiwa: "DOCUMENT_EDITED", label: "Pencocokan baris koran dilepas", oleh: useSession.getState().user?.name ?? "Anda", catatan: x.keterangan });
}
