// UJI KONTRAK: respons backend NYATA (fixture dibuat oleh backend/tests/integration/financeTransaksi.integration.test.js dengan DUMP_TRANSAKSI=1 dari
// database uji, semua 9 modul) dibaca oleh pemeta klien. Menjamin klien tidak menjatuhkan item, uang tetap string desimal, dan aksi dari server terbaca.

/* eslint-disable import/first */
jest.mock("@/lib/env", () => ({ ENV: { useMocks: false, apiUrl: "http://x/api" } }));

import fixtureRaw from "./fixtures/transaksi-real.json";
import { parseResponse } from "@/api/normalize";
import { MODUL_LIST, NORMALISASI_TX, mapDetailTx, mapHalamanTx, mapOpsiForm } from "@/api/transaksi";
import { isMoneyString } from "@/lib/money";

type Fixture = { opsi: unknown; ringkasan: unknown; modul: Record<string, { daftar: { items: unknown[] }; detail: unknown }> };
const baca = <T>(v: unknown): T => parseResponse<T>(JSON.stringify(v), NORMALISASI_TX);
const fx = fixtureRaw as unknown as Fixture;

describe("kontrak respons nyata", () => {
  it.each(MODUL_LIST)("%s: tidak ada item yang jatuh, uang string desimal, detail terbaca", (m) => {
    const isi = fx.modul[m];
    expect(isi).toBeTruthy();
    const h = mapHalamanTx(baca(isi?.daftar));
    expect(h.items.length).toBe(isi?.daftar.items.length);
    expect(h.items.length).toBeGreaterThan(0);
    for (const i of h.items) {
      expect(isMoneyString(i.nominal)).toBe(true);
      expect(i.modul).toBe(m);
      if (i.sisa != null) expect(isMoneyString(i.sisa)).toBe(true);
    }
    const d = mapDetailTx(baca(isi?.detail));
    expect(d).not.toBeNull();
    expect(d?.bagian.length).toBeGreaterThan(0);
    for (const b of d?.bagian ?? []) for (const r of b.baris) if (r.jenis === "uang") expect(isMoneyString(r.nilai)).toBe(true);
  });

  it("pengeluaran: aksi dari server terbaca lengkap dengan alamat perintah dokumen", () => {
    const i = mapHalamanTx(baca(fx.modul.pengeluaran?.daftar)).items[0];
    expect(i?.aksi.bayar?.path).toMatch(/^\/finance\/expenses\/.+\/pay$/);
    expect(i?.aksi.batalkan?.perlu).toEqual(["alasan"]);
    expect(i?.aksi.ubah?.metode).toBe("PATCH");
    expect(i?.notaWajib).toBe(true); // 900.000 tanpa foto ≥ ambang nota
  });

  it("kasbon: sisa & terbayar string; potong gaji membawa method tetap", () => {
    const i = mapHalamanTx(baca(fx.modul.kasbon?.daftar)).items[0];
    expect(i?.sisa).toBe("1000000.00");
    expect(i?.aksi.potongGaji?.tetap).toEqual({ method: "POTONG_GAJI" });
  });

  it("tagihan: sisa utang, jatuh tempo, umur, dan nilai tetap untuk pembayaran", () => {
    const i = mapHalamanTx(baca(fx.modul.tagihan?.daftar)).items[0];
    expect(i?.status).toBe("DIBAYAR_SEBAGIAN");
    expect(i?.sisa).toBe("600000.00");
    expect(i?.terbayar).toBe("400000.00");
    expect(i?.jatuhTempo).toBe("2026-08-15");
    expect(i?.umurHari).toBeGreaterThan(0);
    expect(i?.aksi.bayar?.boleh).toBe(true);
    expect(i?.aksi.bayar?.tetap?.billId).toBe(i?.id);
  });

  it("piutang: sisa dari buku besar, pembayaran resmi + aksi alokasi, order pelanggan", () => {
    const h = mapHalamanTx(baca(fx.modul.piutang?.daftar));
    expect(h.items[0]?.sisa).toBe("1500000.00");
    expect(h.items[0]?.umurHari).toBeGreaterThan(0);
    expect(h.ringkasan.umur).toBeTruthy();
    const d = mapDetailTx(baca(fx.modul.piutang?.detail));
    expect(d?.pembayaran[0]?.nominal).toBe("500000.00");
    expect(d?.pembayaran[0]?.aksiAlokasi.boleh).toBe(true);
    expect(d?.orderPelanggan.length).toBeGreaterThan(0);
  });

  it("refund: menunggu dan tautan Inbox S4 untuk yang boleh memutuskan", () => {
    const i = mapHalamanTx(baca(fx.modul.refund?.daftar)).items[0];
    expect(i?.status).toBe("MENUNGGU_APPROVAL");
    expect(i?.persetujuan?.jenis).toBe("refund");
  });

  it("opsi formulir: rekening bersaldo string, akun pemasukan lain tanpa akun penjualan, karyawan aktif", () => {
    const o = mapOpsiForm(baca(fx.opsi));
    expect(o.rekening.length).toBeGreaterThan(0);
    for (const r of o.rekening) expect(isMoneyString(r.saldo)).toBe(true);
    expect(o.akunPemasukanLain.length).toBeGreaterThan(0);
    expect(o.akunPemasukanLain.some((a) => /Penjualan|Layanan|Sewa|Ongkir/i.test(a.name))).toBe(false);
    expect(o.karyawan.map((k) => k.name)).toContain("Agung");
    expect(isMoneyString(o.ambangNotaRupiah)).toBe(true);
  });
});
