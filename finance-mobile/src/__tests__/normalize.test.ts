import { parseResponse } from "@/api/normalize";
import { mapDashboard } from "@/api/finance";

describe("parseResponse — uang tidak pernah menjadi float", () => {
  it("angka dengan pecahan → string desimal (literal dipertahankan)", () => {
    const r = parseResponse<{ saldo: string; nilaiOrder: string }>('{"saldo":1234567.50,"nilaiOrder":50000}');
    expect(r.saldo).toBe("1234567.50");
    expect(r.nilaiOrder).toBe("50000.00");
  });

  it("presisi yang hilang pada JSON.parse biasa tetap terjaga", () => {
    const teks = '{"amount":9007199254740993.10}';
    expect(String((JSON.parse(teks) as { amount: number }).amount)).not.toBe("9007199254740993.1"); // bukti: float kehilangan presisi
    expect(parseResponse<{ amount: string }>(teks).amount).toBe("9007199254740993.10");
  });

  it("kunci bernuansa uang yang bulat tetap string; hitungan tetap number", () => {
    const r = parseResponse<{ totalKas: string; sisa: string; jumlah: number; lineNo: number; id: number }>(
      '{"totalKas":272950725,"sisa":0,"jumlah":12,"lineNo":3,"id":7}',
    );
    expect(r.totalKas).toBe("272950725.00");
    expect(r.sisa).toBe("0.00");
    expect(r.jumlah).toBe(12);
    expect(r.lineNo).toBe(3);
    expect(r.id).toBe(7);
  });

  it("berlaku rekursif pada objek bersarang dan larik", () => {
    const r = parseResponse<{ kasBank: { saldo: string }[]; labaRugi: { labaBersih: string; marginBersih: string } }>(
      '{"kasBank":[{"saldo":100},{"saldo":250.5}],"labaRugi":{"labaBersih":-2500000,"marginBersih":12.5}}',
    );
    expect(r.kasBank.map((k) => k.saldo)).toEqual(["100.00", "250.50"]);
    expect(r.labaRugi.labaBersih).toBe("-2500000.00");
    expect(r.labaRugi.marginBersih).toBe("12.50"); // pecahan selalu string desimal
  });

  it("endpoint bisa menyatakan kunci hitungan (mis. total pada daftar jurnal) dan kunci uang tambahan", () => {
    const r = parseResponse<{ total: number; entries: unknown[] }>('{"total":55,"entries":[]}', { hitungan: ["total"] });
    expect(r.total).toBe(55);
    const e = parseResponse<{ belum_jatuh_tempo: string }>('{"belum_jatuh_tempo":118400000}', { uang: ["belum_jatuh_tempo"] });
    expect(e.belum_jatuh_tempo).toBe("118400000.00");
  });

  it("angka berformat eksponen ditolak (bukan bentuk Decimal(18,2))", () => {
    expect(() => parseResponse('{"amount":1e21}')).toThrow();
  });

  it("nilai non-angka dibiarkan; boolean & string tidak berubah", () => {
    const r = parseResponse<{ seimbang: boolean; nama: string; catatan: null }>('{"seimbang":true,"nama":"Kas","catatan":null}');
    expect(r).toEqual({ seimbang: true, nama: "Kas", catatan: null });
  });
});

describe("mapDashboard — bentuk dashboard asli server", () => {
  it("memetakan ringkasan umur (kunci belum_jatuh_tempo, 1_30, …) menjadi ember bertotal string", () => {
    const raw = parseResponse(
      JSON.stringify({
        periode: { from: "2026-09-01", to: "2026-09-30" },
        kasBank: [{ id: "a", name: "SANOBANK Kemal", kind: "BANK", saldo: 158420350, accountNumber: "1234567890" }],
        totalKas: 158420350,
        labaRugi: { pendapatanBruto: 1, retur: 0, pendapatanBersih: 1, bebanPokok: 0, labaKotor: 1, bebanOperasional: 0, labaBersih: 1 },
        piutang: {
          total: 236900000,
          ringkasan: { belum_jatuh_tempo: 118400000, "1_30": 64200000, "31_60": 31800000, "61_90": 14500000, "90_plus": 8000000 },
          menungguVerifikasi: { jumlah: 12, total: 38600000 },
        },
        utang: { total: 0, ringkasan: { belum_jatuh_tempo: 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0 } },
        antrean: {
          jumlahPembayaranBelumVerifikasi: 4, lunasBelumDicatat: { jumlah: 12, total: 38600000 },
          pengeluaranMenunggu: 3, pembelianMenunggu: 2, tagihanMenunggu: 1, refundMenunggu: 1,
        },
        jurnalTerakhir: [],
        catatan: { gapTerbuka: 2, saldoAwalTerisi: true, pesan: [] },
      }),
      { uang: ["belum_jatuh_tempo", "1_30", "31_60", "61_90", "90_plus"] },
    );
    const d = mapDashboard(raw as Parameters<typeof mapDashboard>[0]);
    expect(d.totalKas).toBe("158420350.00");
    expect(d.piutang.ember).toHaveLength(5);
    expect(d.piutang.ember[0]).toEqual({ label: "Belum jatuh tempo", total: "118400000.00", jumlah: 0 });
    expect(d.piutang.ember[4]?.total).toBe("8000000.00");
    expect(d.antrean.pengeluaranMenunggu).toBe(3);
    expect(d.antrean.lunasBelumDicatat.jumlah).toBe(12);
    // nomor rekening tidak ikut ke model klien
    expect(JSON.stringify(d.kasBank)).not.toContain("1234567890");
  });
});
