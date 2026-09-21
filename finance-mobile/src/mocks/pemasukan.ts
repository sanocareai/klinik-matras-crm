// SERVER PEMASUKAN PALSU (mode contoh saja). Meniru bentuk GET /finance/pemasukan/* (klasifikasi & total dihitung "server" = mock ini, bukan layar).

import { toMoney } from "@/lib/money";
import { getSkenario, simulasiBaca } from "./skenario";
import { LABEL_KATEGORI, LIMIT_PEMASUKAN, mapHalaman, mapRingkasan, type FilterPemasukan, type HalamanPemasukan, type KategoriPemasukan, type RingkasanPemasukan } from "@/api/pemasukan";

const m = (s: string) => toMoney(s);

type B = { key: string; jenis: string; id: string; tanggal: string; nomor: string; sumber: string; sumberLabel: string; pihak: string | null; keterangan: string; rekening: string | null; nilai: string; status: string; statusLabel: string; nada: string; kategori: KategoriPemasukan; sub: string; subLabel: string; perluTinjau: boolean; catatan: string | null; dihitung?: boolean; tautan: Record<string, unknown> };
const baris = (kategori: KategoriPemasukan, i: number, x: Partial<B>): B => ({
  key: `${kategori}:${i}`, jenis: "jurnal", id: `id-${kategori}-${i}`, tanggal: "2026-09-10", nomor: `JV-1009202${i}-00${i}`, sumber: "MANUAL", sumberLabel: "Jurnal manual", pihak: null, keterangan: `Contoh ${kategori} ${i}`, rekening: "SANOBANK Kemal",
  nilai: m("1000000"), status: "POSTED", statusLabel: "Terposting", nada: "success", kategori, sub: "", subLabel: "", perluTinjau: false, catatan: null, tautan: { jurnal: { id: `id-${kategori}-${i}`, nomor: `JV-1009202${i}-00${i}` }, pembayaran: null, invoice: null, dokumen: null }, ...x,
});

function data(): B[] {
  const k = getSkenario();
  if (k === "kosong") return [];
  const panjang = k === "panjang";
  const neg = k === "negatif";
  const out: B[] = [
    baris("PENDAPATAN", 1, { sumber: "PENGAKUAN_PENDAPATAN", sumberLabel: "Pengakuan pendapatan", pihak: "Ibu Erni", nilai: panjang ? m("123456789012.50") : m("2500000"), sub: "PENJUALAN", subLabel: "Pengakuan pendapatan", tautan: { jurnal: { id: "j1", nomor: "JV-10092026-001" }, pembayaran: null, invoice: { id: "iv1", nomor: "INV-10092026-001" }, dokumen: null } }),
    baris("PENDAPATAN", 2, { sumber: "REFUND", sumberLabel: "Refund", pihak: "Bapak Budi", nilai: neg ? m("-8000000.55") : m("-120000.55"), sub: "RETUR", subLabel: "Retur/potongan penjualan" }),
    baris("PEMBAYARAN", 1, { jenis: "pembayaran", id: "p1", sumber: "PEMBAYARAN_ORDER", sumberLabel: "Pembayaran pelanggan (TRANSFER)", pihak: "Ibu Erni", nilai: m("1000000"), status: "TERVERIFIKASI", statusLabel: "Terverifikasi", sub: "PEMBAYARAN_TERVERIFIKASI", subLabel: "Uang masuk terverifikasi", tautan: { jurnal: { id: "j2", nomor: "JV-11092026-002" }, pembayaran: { id: "p1" }, invoice: null, dokumen: null } }),
    baris("PEMBAYARAN", 2, { jenis: "pembayaran", id: "p2", sumber: "PEMBAYARAN_ORDER", sumberLabel: "Pembayaran pelanggan (TRANSFER)", pihak: "Ibu Sari", nilai: m("850000"), status: "MENUNGGU", statusLabel: "Menunggu verifikasi", nada: "warning", sub: "PEMBAYARAN_MENUNGGU", subLabel: "Uang masuk menunggu verifikasi", rekening: null, tautan: { jurnal: null, pembayaran: { id: "p2" }, invoice: null, dokumen: null } }),
    baris("PEMBAYARAN", 3, { jenis: "pembayaran", id: "p3", sumber: "PEMBAYARAN_ORDER", sumberLabel: "Pembayaran pelanggan (TRANSFER)", pihak: "Ibu Wati", nilai: m("1980000"), status: "TERVERIFIKASI", statusLabel: "Terverifikasi", rekening: null, sub: "PEMBAYARAN_BELUM_DIBUKUKAN", subLabel: "Terverifikasi, belum masuk buku besar", perluTinjau: true, catatan: "Terverifikasi tetapi belum masuk buku besar: rekening kas/bank belum dipetakan.", tautan: { jurnal: null, pembayaran: { id: "p3" }, invoice: null, dokumen: null } }),
    baris("LAIN", 1, { sumber: "PEMASUKAN_LAIN", sumberLabel: "Pemasukan lain", keterangan: "Bunga bank", nilai: m("75000.50"), sub: "PENDAPATAN_LAIN", subLabel: "Pendapatan lain-lain", tautan: { jurnal: { id: "j3", nomor: "JV-12092026-003" }, pembayaran: null, invoice: null, dokumen: { modul: "pemasukan", id: "oi1" } } }),
    baris("DANA", 1, { keterangan: "Setoran modal", nilai: m("5000000"), sub: "SETORAN_MODAL", subLabel: "Setoran modal pemilik" }),
    baris("DANA", 2, { keterangan: "Pendanaan investor", nilai: m("3000000"), rekening: "PT Sano", sub: "PENDANAAN_PIHAK_KETIGA", subLabel: "Pendanaan pihak ketiga (investor/mitra)" }),
    baris("HISTORIS", 1, { jenis: "historis", id: "h1", nomor: "NOTION-001", sumber: "DATA_SEBELUM_SISTEM", sumberLabel: "Data sebelum sistem (Notion)", pihak: "Ibu Rina", tanggal: "2026-01-10", nilai: m("1500000"), status: "SIAP", statusLabel: "Siap (dihitung)", rekening: null, sub: "HISTORIS", subLabel: "Pendapatan arsip (non-posting)", dihitung: true, tautan: { jurnal: null, pembayaran: null, invoice: null, dokumen: null } }),
    baris("HISTORIS", 2, { jenis: "historis", id: "h2", nomor: "NOTION-004", sumber: "DATA_SEBELUM_SISTEM", sumberLabel: "Data sebelum sistem (Notion)", pihak: "Ibu Y", tanggal: "2026-05-05", nilai: m("-300000"), status: "PERLU_DITINJAU", statusLabel: "Perlu ditinjau", nada: "warning", rekening: null, sub: "HISTORIS", subLabel: "Pendapatan arsip (non-posting)", perluTinjau: true, dihitung: false, catatan: "Nominal negatif (retur/koreksi?) — tidak diklasifikasikan otomatis", tautan: { jurnal: null, pembayaran: null, invoice: null, dokumen: null } }),
  ];
  for (let i = 10; i < 45; i++) out.push(baris("PENDAPATAN", i, { keterangan: `Pengakuan pendapatan ${i}`, nilai: m(String(100000 + i * 1000)), tanggal: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, sumber: "PENGAKUAN_PENDAPATAN", sumberLabel: "Pengakuan pendapatan", sub: "PENJUALAN", subLabel: "Pengakuan pendapatan" }));
  return out;
}

export async function mockDaftarPemasukan(f: FilterPemasukan, page: number): Promise<HalamanPemasukan> {
  await simulasiBaca("pemasukan:daftar");
  const kata = f.q.trim().toLowerCase();
  const tampil = data().filter((b) => (!f.kategori || b.kategori === f.kategori) && (!kata || `${b.nomor} ${b.pihak ?? ""} ${b.keterangan}`.toLowerCase().includes(kata)));
  const dari = (page - 1) * LIMIT_PEMASUKAN;
  return mapHalaman({ items: tampil.slice(dari, dari + LIMIT_PEMASUKAN).map((b) => ({ ...b, kategoriLabel: LABEL_KATEGORI[b.kategori] })), page, total: tampil.length, adaLagi: dari + LIMIT_PEMASUKAN < tampil.length, totalNilai: m("0"), terpotong: false, diperbaruiPada: new Date().toISOString() });
}

export async function mockRingkasanPemasukan(from: string, to: string): Promise<RingkasanPemasukan> {
  await simulasiBaca("pemasukan:ringkasan");
  const kosong = getSkenario() === "kosong";
  const jn = (jumlah: number, nilai: string) => ({ jumlah: kosong ? 0 : jumlah, nilai: kosong ? m("0") : m(nilai) });
  const r = mapRingkasan({
    periode: { from, to }, terpotong: false, labelHistoris: "Data sebelum sistem berasal dari arsip lama dan belum memengaruhi buku besar sampai proses rekonsiliasi dan posting disetujui.",
    pendapatanSistem: { ...jn(30, "64696000"), bruto: kosong ? m("0") : m("64816000.55"), retur: kosong ? m("0") : m("-120000.55") },
    pendapatanHistoris: { ...jn(6, "6450000"), lunas: kosong ? m("0") : m("2400000"), belumBayar: kosong ? m("0") : m("2250000"), perluDitinjau: jn(3, "-300000") },
    pendapatanGabungan: { nilai: kosong ? m("0") : m("71146000"), catatan: "Pendapatan sistem + pendapatan historis (setelah deduplikasi). TIDAK ditambah lagi dengan pembayaran masuk." },
    pembayaranMasuk: { terverifikasi: jn(23, "50883030"), menunggu: jn(1, "850000"), tidakDihitung: jn(0, "0"), belumDibukukan: jn(1, "1980000") },
    piutangTersisa: { nilai: kosong ? m("0") : m("7012970"), jumlahOrder: kosong ? 0 : 5, perTanggal: to },
    pemasukanLain: jn(1, "75000.50"),
    danaMasukBukanPendapatan: { ...jn(2, "8000000"), rincian: kosong ? [] : [{ sub: "SETORAN_MODAL", label: "Setoran modal pemilik", nilai: m("5000000"), jumlah: 1 }, { sub: "PENDANAAN_PIHAK_KETIGA", label: "Pendanaan pihak ketiga (investor/mitra)", nilai: m("3000000"), jumlah: 1 }] },
    perluDitinjau: jn(2, "2280000"),
    dikecualikan: { transfer: jn(4, "14150000"), saldoAwal: jn(5, "2478661140"), pembalikanBiaya: jn(28, "110173765") },
    cutoff: { tanggal: "2026-07-12", dasar: "Order sistem paling awal: RES-12072026-001 (2026-07-12).", celahPengakuan: { dari: "2026-07-12", sampai: "2026-09-17", jumlahOrder: 458, nilaiOrder: m("1051563000") } },
    penjelasan: ["Pendapatan adalah penjualan yang sudah diakui. Uang masuk adalah pembayaran yang benar-benar diterima. Keduanya berbeda."],
  });
  return r as RingkasanPemasukan;
}
