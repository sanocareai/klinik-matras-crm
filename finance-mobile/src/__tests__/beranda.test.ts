import fixture from "./fixtures/dashboard-real.json";
import { mapDashboard, NORMALISASI_DASHBOARD } from "@/api/finance";
import { parseResponse } from "@/api/normalize";
import { ApiError } from "@/api/errors";
import type { Capabilities } from "@/api/types";
import { daftarTindakan } from "@/features/beranda/Bagian";
import { klasifikasiGalat } from "@/features/beranda/galat";
import { formatPersen } from "@/features/beranda/format";
import { daftarBulan, periodeBulan, periodeDariId, periodePreset } from "@/lib/periode";
import { peranContoh } from "@/mocks/roles";
import { skenarioDariEmail } from "@/mocks/skenario";

const teksAsli = JSON.stringify(fixture);
const muat = (teks = teksAsli) => mapDashboard(parseResponse(teks, NORMALISASI_DASHBOARD));

function caps(email: string): Capabilities {
  const p = peranContoh(email);
  if ("tanpaAkses" in p) throw new Error("tanpa akses");
  return p.capabilities;
}

describe("kontrak API /finance/dashboard (respons asli dev, Sep 2026)", () => {
  const d = muat();

  it("uang menjadi string desimal persis dari server (tanpa float), termasuk negatif", () => {
    expect(d.totalKas).toBe("-288613431.00");
    expect(d.kasBank[0]?.saldo).toBe("-175967591.00");
    expect(d.kasBank.every((k) => typeof k.saldo === "string")).toBe(true);
    expect(d.labaRugi?.labaBersih).toBe("-199887351.00");
    expect(d.labaRugi?.pendapatanBersih).toBe("3000000.00");
    expect(d.piutang?.menungguVerifikasi).toEqual({ jumlah: 2, total: "3000000.00" });
    expect(d.antrean?.lunasBelumDicatat.total).toBe("3000000.00");
  });

  it("margin adalah persen (number), BUKAN uang", () => {
    expect(d.labaRugi?.marginKotor).toBe(-3496.46);
    expect(d.labaRugi?.marginBersih).toBe(-6662.91);
  });

  it("hitungan tetap number; ember umur lengkap 5 baris berlabel Indonesia", () => {
    expect(d.antrean?.pembelianMenunggu).toBe(5);
    expect(d.catatan?.gapTerbuka).toBe(0);
    expect(d.catatan?.periodeTerbuka).toBe(2);
    expect(d.piutang?.ember.map((e) => e.label)).toEqual(["Belum jatuh tempo", "1–30 hari", "31–60 hari", "61–90 hari", "> 90 hari"]);
    expect(d.piutang?.ember.every((e) => e.total === "0.00")).toBe(true);
  });

  it("gate & kesehatan pembukuan dipetakan; tidak ada bagian hilang", () => {
    expect(d.gate).toEqual({ aktif: false, sejak: null });
    expect(d.catatan?.saldoAwalTerisi).toBe(false);
    expect(d.catatan?.pesan.length).toBeGreaterThan(0);
    expect(d.bagianHilang).toEqual([]);
    expect(d.jurnalTerakhir).toHaveLength(8);
    expect(d.jurnalTerakhir[0]?.total).toMatch(/^\d+\.\d{2}$/);
  });

  it("data pelanggan & nomor rekening tidak ikut ke model klien", () => {
    const teks = JSON.stringify(d);
    expect(teks).not.toContain("accountNumber");
    expect(teks).not.toContain("customerName");
    expect(teks).not.toContain("pembayaranBelumVerifikasi\":[{");
  });

  it("jumlahPembayaranBelumVerifikasi memakai angka server, bukan panjang array yang dipotong", () => {
    const o = JSON.parse(teksAsli) as { antrean: { jumlahPembayaranBelumVerifikasi: number; pembayaranBelumVerifikasi: unknown[] } };
    o.antrean.jumlahPembayaranBelumVerifikasi = 137;
    o.antrean.pembayaranBelumVerifikasi = [];
    expect(muat(JSON.stringify(o)).antrean?.jumlahPembayaranBelumVerifikasi).toBe(137);
  });

  it("nominal sangat panjang tidak kehilangan presisi", () => {
    const o = JSON.parse(teksAsli) as Record<string, unknown>;
    const teks = JSON.stringify(o).replace('"totalKas":-288613431', '"totalKas":98765432109876543.21');
    expect(muat(teks).totalKas).toBe("98765432109876543.21");
  });
});

describe("data parsial: bagian yang tidak ada ditandai, tidak crash, tidak jadi angka nol palsu", () => {
  it("bagian hilang tercatat di bagianHilang", () => {
    const o = JSON.parse(teksAsli) as Record<string, unknown>;
    delete o.labaRugi;
    delete o.piutang;
    delete o.antrean;
    const d = muat(JSON.stringify(o));
    expect(d.labaRugi).toBeNull();
    expect(d.piutang).toBeNull();
    expect(d.antrean).toBeNull();
    expect(d.bagianHilang).toEqual(expect.arrayContaining(["labaRugi", "piutang", "antrean"]));
    expect(d.utang).not.toBeNull();
    expect(d.totalKas).toBe("-288613431.00");
  });

  it("payload rusak / kosong tidak melempar", () => {
    const d = mapDashboard({});
    expect(d.bagianHilang.length).toBe(7);
    expect(d.kasBank).toEqual([]);
    expect(d.totalKas).toBeNull();
    expect(() => mapDashboard(null)).not.toThrow();
    expect(() => mapDashboard("bukan objek")).not.toThrow();
  });

  it("baris jurnal/rekening yang cacat dibuang, yang sehat dipertahankan", () => {
    const o = JSON.parse(teksAsli) as { jurnalTerakhir: unknown[]; kasBank: unknown[] };
    o.jurnalTerakhir.push({ id: "x", total: "bukan angka" }, null, 5);
    o.kasBank.push({ id: "z", name: "Rusak", saldo: "abc" });
    const d = muat(JSON.stringify(o));
    expect(d.jurnalTerakhir).toHaveLength(8);
    expect(d.kasBank).toHaveLength(3);
  });
});

describe("filter periode (WIB)", () => {
  const now = new Date("2026-09-19T03:00:00Z");
  it("pilihan cepat: bulan ini, bulan lalu, kuartal, tahun", () => {
    const p = periodePreset(now);
    expect(p.map((x) => x.id)).toEqual(["bulan-ini", "bulan-lalu", "kuartal-ini", "tahun-ini"]);
    expect(p[0]).toMatchObject({ label: "September 2026", from: "2026-09-01", to: "2026-09-30" });
    expect(p[1]).toMatchObject({ label: "Agustus 2026", from: "2026-08-01", to: "2026-08-31" });
    expect(p[2]).toMatchObject({ label: "Kuartal 3 2026", from: "2026-07-01", to: "2026-09-30" });
    expect(p[3]).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
  });
  it("Januari: bulan lalu = Desember tahun sebelumnya; Februari kabisat", () => {
    expect(periodePreset(new Date("2026-01-10T03:00:00Z"))[1]).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodeBulan(2028, 2).to).toBe("2028-02-29");
    expect(periodeBulan(2026, 2).to).toBe("2026-02-28");
  });
  it("batas bulan mengikuti WIB (30 Sep 17.30Z sudah Oktober)", () => {
    expect(periodePreset(new Date("2026-09-30T17:30:00Z"))[0]).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("daftar 12 bulan terbaru dulu, melewati pergantian tahun", () => {
    const b = daftarBulan(new Date("2026-02-10T03:00:00Z"), 4);
    expect(b.map((x) => x.from)).toEqual(["2026-02-01", "2026-01-01", "2025-12-01", "2025-11-01"]);
  });
  it("id → periode; id asing jatuh ke bulan ini; bulan tak sah ditolak", () => {
    expect(periodeDariId("bulan:2026-07", now)).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
    expect(periodeDariId("ngawur", now).id).toBe("bulan-ini");
    expect(periodeDariId("bulan:2026-13", now).id).toBe("bulan-ini");
  });
});

describe("visibilitas berdasarkan capabilities (pekerjaan tertunda)", () => {
  const d = muat();
  const antrean = { ...(d.antrean as NonNullable<typeof d.antrean>), jumlahPembayaranBelumVerifikasi: 4, pengeluaranMenunggu: 3, pembelianMenunggu: 0, tagihanMenunggu: 0, refundMenunggu: 1 };
  const id = (c: Capabilities) => daftarTindakan(antrean, 2, c).map((t) => t.id);

  it("FINANCE melihat persetujuan, verifikasi, lunas belum dicatat, dan data belum lengkap", () => {
    expect(id(caps("finance@x"))).toEqual(["persetujuan", "verifikasi", "lunas", "gap"]);
  });
  it("APPROVER: persetujuan + baca pembayaran; ACCOUNTANT tanpa persetujuan", () => {
    expect(id(caps("approver@x"))).toContain("persetujuan");
    expect(id(caps("akuntan@x"))).not.toContain("persetujuan");
    expect(id(caps("akuntan@x"))).toContain("verifikasi");
  });
  it("tanpa capabilities → hanya yang tidak butuh izin khusus", () => {
    expect(daftarTindakan(antrean, 0, null)).toEqual([]);
  });
  it("ringkasan persetujuan menyebut rincian per jenis; nol tidak ditampilkan", () => {
    const t = daftarTindakan(antrean, 0, caps("finance@x")).find((x) => x.id === "persetujuan");
    expect(t?.jumlah).toBe(4);
    expect(t?.ringkas).toBe("3 pengeluaran · 1 refund");
  });
  it("antrean kosong → daftar kosong (tampil 'tidak ada pekerjaan tertunda')", () => {
    const nol = { ...antrean, jumlahPembayaranBelumVerifikasi: 0, pengeluaranMenunggu: 0, pembelianMenunggu: 0, tagihanMenunggu: 0, refundMenunggu: 0, lunasBelumDicatat: { jumlah: 0, total: "0.00" as never, baru: null, lama: null } };
    expect(daftarTindakan(nol, 0, caps("finance@x"))).toEqual([]);
  });
});

describe("klasifikasi galat → teks Indonesia", () => {
  const galat = (status: number, code: string, extra: object = {}) => new ApiError({ status, code, message: "teknis: stack trace", ...extra });

  it("offline / jaringan", () => {
    expect(klasifikasiGalat(galat(0, "NETWORK"), false)).toMatchObject({ jenis: "offline", judul: "Tidak ada koneksi" });
    expect(klasifikasiGalat(galat(0, "TIMEOUT"), true)).toMatchObject({ jenis: "offline", judul: "Server tidak menjawab" });
    expect(klasifikasiGalat(new Error("x"), false).jenis).toBe("offline");
  });
  it("sesi habis: 401 dan kode sesi hilang", () => {
    expect(klasifikasiGalat(galat(401, "SESSION_EXPIRED"), true).jenis).toBe("sesi");
    expect(klasifikasiGalat(galat(401, "TOKEN_INVALID"), true).jenis).toBe("sesi");
    expect(klasifikasiGalat(galat(401, "SESSION_REVOKED"), true).judul).toBe("Sesi Anda berakhir");
  });
  it("akun tidak berizin (403), server 5xx, rate limit berwaktu, galat lain", () => {
    expect(klasifikasiGalat(galat(403, "FORBIDDEN"), true)).toMatchObject({ jenis: "izin", judul: "Akun ini belum berizin" });
    expect(klasifikasiGalat(galat(503, "X"), true)).toMatchObject({ jenis: "server", judul: "Server sedang bermasalah" });
    expect(klasifikasiGalat(galat(429, "RATE_LIMITED", { retryAfterSeconds: 120 }), true).isi).toMatch(/2 menit/);
    expect(klasifikasiGalat(galat(429, "RATE_LIMITED", { retryAfterSeconds: 20 }), true).isi).toMatch(/20 detik/);
    expect(klasifikasiGalat(new Error("aneh"), true).jenis).toBe("lain");
  });
  it("teks yang tampil tidak pernah memuat pesan teknis server", () => {
    for (const e of [galat(500, "INTERNAL"), galat(0, "NETWORK"), galat(403, "X"), galat(401, "SESSION_EXPIRED")]) {
      const k = klasifikasiGalat(e, true);
      expect(`${k.judul} ${k.isi}`).not.toContain("stack trace");
    }
  });
});

describe("format non-uang & skenario contoh", () => {
  it("persen: koma desimal, pemisah ribuan, negatif, pembulatan", () => {
    expect(formatPersen(10.05)).toBe("10,1%");
    expect(formatPersen(-3496.46)).toBe("-3.496,5%");
    expect(formatPersen(20)).toBe("20%");
    expect(formatPersen(-0.01)).toBe("0%");
    expect(formatPersen(null)).toBeNull();
    expect(formatPersen(Number.NaN)).toBeNull();
  });
  it("skenario dibaca dari tanda + pada email; tak dikenal = normal", () => {
    expect(skenarioDariEmail("finance+kosong@x")).toBe("kosong");
    expect(skenarioDariEmail("owner+PANJANG@x")).toBe("panjang");
    expect(skenarioDariEmail("finance+ngawur@x")).toBe("normal");
    expect(skenarioDariEmail("finance@x")).toBe("normal");
  });
});
