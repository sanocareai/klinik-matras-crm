// UJI KONTRAK S9–S10: respons backend NYATA (fixture dari backend/tests/integration/financeBuku.integration.test.js dengan DUMP_BUKU=1, database uji)
// dibaca oleh pemeta klien: tidak ada item jatuh, uang tetap string desimal, angka laporan sama dengan respons server, tidak ada hitungan klien.

/* eslint-disable import/first */
jest.mock("@/lib/env", () => ({ ENV: { useMocks: false, apiUrl: "http://x/api" } }));

import fixtureRaw from "./fixtures/buku-real.json";
import { parseResponse } from "@/api/normalize";
import { NORMALISASI_BUKU, mapAkun, mapBuku, mapDetailJurnal, mapHalamanJurnal, mapRekonDetail, mapRekonItem } from "@/api/buku";
import { NORMALISASI_LAPORAN, mapLaporan } from "@/api/laporan";
import { formatRupiah, isMoneyString } from "@/lib/money";
import type { JenisLaporanNyata } from "@/api/types";

const fx = fixtureRaw as unknown as Record<string, any>;
const bacaBuku = <T>(v: unknown): T => parseResponse<T>(JSON.stringify(v), NORMALISASI_BUKU);
const bacaLap = <T>(v: unknown): T => parseResponse<T>(JSON.stringify(v), NORMALISASI_LAPORAN);

describe("kontrak buku (respons nyata)", () => {
  it("jurnal: semua item terbaca; uang string desimal; seimbang dari server", () => {
    const h = mapHalamanJurnal(bacaBuku(fx.jurnal));
    expect(h.items.length).toBe(fx.jurnal.items.length);
    expect(h.items.length).toBeGreaterThan(0);
    for (const j of h.items) {
      expect(isMoneyString(j.totalDebit)).toBe(true);
      expect(isMoneyString(j.totalKredit)).toBe(true);
      expect(j.seimbang).toBe(true);
    }
  });

  it("detail jurnal: baris debit/kredit, dokumen terkait, riwayat", () => {
    const d = mapDetailJurnal(bacaBuku(fx.jurnalDetail));
    expect(d).not.toBeNull();
    expect(d?.baris.length).toBeGreaterThanOrEqual(2);
    for (const b of d?.baris ?? []) { expect(isMoneyString(b.debit)).toBe(true); expect(isMoneyString(b.kredit)).toBe(true); }
  });

  it("akun & buku besar: saldo awal, mutasi, saldo berjalan dari server", () => {
    const akun = mapAkun(bacaBuku(fx.akun));
    expect(akun.length).toBeGreaterThan(0);
    const b = mapBuku(bacaBuku(fx.mutasi));
    expect(b).not.toBeNull();
    for (const s of [b?.saldoAwal, b?.totalDebit, b?.totalKredit, b?.saldoAkhir]) expect(isMoneyString(String(s))).toBe(true);
    expect(b?.baris.length).toBe(fx.mutasi.baris.length);
    for (const r of b?.baris ?? []) expect(isMoneyString(r.saldo)).toBe(true);
    // saldo berjalan baris terakhir = saldo akhir (keduanya dari server)
    expect(b?.baris.at(-1)?.saldo).toBe(b?.saldoAkhir);
  });

  it("rekonsiliasi: daftar dan detail terbaca dengan aksi dari server", () => {
    const item = mapRekonItem(bacaBuku(fx.rekon.items[0]));
    expect(item).not.toBeNull();
    expect(isMoneyString(String(item?.selisih))).toBe(true);
    const d = mapRekonDetail(bacaBuku(fx.rekonDetail));
    expect(d).not.toBeNull();
    expect(d?.baris.length).toBe(fx.rekonDetail.baris.length);
    expect(d?.baris[0]?.aksi.cocokkan.path).toMatch(/^\/finance\/bank-lines\/.+\/match$/);
  });
});

describe("kontrak laporan (respons nyata)", () => {
  const PETA: [JenisLaporanNyata, string][] = [["laba-rugi", "income-statement"], ["neraca", "balance-sheet"], ["arus-kas", "cash-flow"], ["neraca-saldo", "trial-balance"], ["umur-piutang", "receivables"], ["umur-utang", "payables"]];

  it.each(PETA)("%s: terbaca lengkap tanpa bagian yang hilang", (jenis, kunci) => {
    const l = mapLaporan(jenis, bacaLap(fx.laporan[kunci]), "2026-09-30");
    expect(l.bagianKosong).toEqual([]);
    for (const r of l.ringkasan) if (r.nilai) expect(isMoneyString(r.nilai)).toBe(true);
  });

  it("neraca: angka sama dengan server, seimbang dari server, laba tahun berjalan (negatif) tampil utuh", () => {
    const l = mapLaporan("neraca", bacaLap(fx.laporan["balance-sheet"]), "2026-09-30");
    expect(l.seimbang).toBe(true);
    const ekuitas = l.bagian.find((b) => b.judul === "Ekuitas");
    const laba = ekuitas?.baris.find((b) => b.kunci === "laba-tahun-berjalan");
    expect(laba?.nilai).toBe("-200000.00");
    expect(formatRupiah(laba?.nilai as never)).toContain("200.000");
    const totalAset = l.ringkasan.find((r) => r.label === "Total aset");
    expect(totalAset?.nilai).toBe("49800000.00");
  });

  it("neraca saldo: total & seimbang dari server; baris akun bisa di-drill", () => {
    const l = mapLaporan("neraca-saldo", bacaLap(fx.laporan["trial-balance"]), "2026-09-30");
    expect(l.seimbang).toBe(true);
    expect(l.bagian.flatMap((b) => b.baris).every((b) => b.drill?.tipe === "akun")).toBe(true);
  });
});
