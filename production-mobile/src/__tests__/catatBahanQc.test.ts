import { bolehKonfirmasi, parseJumlah, perluPembetulan, satuanKirim, sidik, tubuhBiasa, tubuhPembetulan, tubuhPratinjau, validasi, type Isian } from "@/features/catatBahanQc";
import { bulanWib, kelompokPengajuan } from "@/api/bahanQc";
import { pickGlassTier } from "@/design/glass";

jest.mock("@/auth/session", () => ({ api: { get: jest.fn(), command: jest.fn() } }));

const busa = { materialId: "11111111-1111-4111-8111-111111111111", nama: "HR Foam", kode: "HR-30", satuan: "LEMBAR", satuanPakai: null };
const wibing = { materialId: "22222222-2222-4222-8222-222222222222", nama: "List Wibing", kode: "LW", satuan: "ROLL", satuanPakai: { satuanStok: "ROLL", satuanPakai: "METER", faktor: 90 } };
const isi = (p: Partial<Isian> = {}): Isian => ({ bahan: busa, qty: "2", satuan: null, catatan: "", alasan: "", tanggal: "2026-11-10", ...p });
const SEKARANG = new Date("2026-11-14T05:00:00Z"); // 12.00 WIB

describe("parseJumlah", () => {
  test("koma & titik desimal, dibulatkan 4 desimal", () => {
    expect(parseJumlah("1,5")).toBe(1.5);
    expect(parseJumlah(" 2.25 ")).toBe(2.25);
    expect(parseJumlah("0,123456")).toBe(0.1235);
  });
  test("bukan angka → null", () => {
    for (const s of ["", "abc", "1,2,3", "-1", "1e3"]) expect(parseJumlah(s)).toBeNull();
  });
});

describe("validasi", () => {
  test("bahan & jumlah wajib", () => {
    expect(validasi(isi({ bahan: null }), "IN_PRODUCTION")).toEqual({ ok: false, galat: "Pilih bahan lebih dulu." });
    expect(validasi(isi({ qty: "0" }), "IN_PRODUCTION").ok).toBe(false);
    expect(validasi(isi(), "IN_PRODUCTION")).toEqual({ ok: true, qty: 2 });
  });
  test("unit belum terkirim tidak butuh alasan/tanggal", () => {
    expect(validasi(isi({ alasan: "", tanggal: "" }), "READY_FOR_DELIVERY").ok).toBe(true);
    expect(perluPembetulan("READY_FOR_DELIVERY")).toBe(false);
  });
  test("unit TERKIRIM: alasan ≥ 5 dan tanggal valid, tidak di masa depan (WIB)", () => {
    expect(perluPembetulan("DELIVERED")).toBe(true);
    expect(validasi(isi({ alasan: "lupa" }), "DELIVERED", SEKARANG).ok).toBe(false);
    expect(validasi(isi({ alasan: "Lupa dicatat", tanggal: "2026-11-15" }), "DELIVERED", SEKARANG).ok).toBe(false);
    expect(validasi(isi({ alasan: "Lupa dicatat", tanggal: "2026-02-30" }), "DELIVERED", SEKARANG).ok).toBe(false);
    expect(validasi(isi({ alasan: "Lupa dicatat", tanggal: "2026-11-14" }), "DELIVERED", SEKARANG)).toEqual({ ok: true, qty: 2 });
  });
});

describe("tubuh permintaan", () => {
  test("bahan tanpa aturan satuan: tidak mengirim satuan", () => {
    expect(tubuhBiasa(isi({ catatan: " lapisan atas " }), 2)).toEqual({ materialId: busa.materialId, qty: 2, note: "lapisan atas" });
  });
  test("bahan beraturan satuan pakai: satuan pakai default, server yang mengonversi", () => {
    const i = isi({ bahan: wibing, qty: "4,5", satuan: null });
    expect(satuanKirim(i)).toBe("METER");
    expect(tubuhBiasa(i, 4.5)).toEqual({ materialId: wibing.materialId, qty: 4.5, satuan: "METER" });
    expect(tubuhPratinjau({ ...i, satuan: "ROLL" }, 1)).toMatchObject({ jenis: "TAMBAH", satuan: "ROLL", qty: 1 });
  });
  test("pembetulan membawa saldo & sidik HPP dari pratinjau, konfirmasi ganda hanya bila diperiksa", () => {
    const pra = { stok: { saldoDilihat: { v: 3 } }, hppOperasional: { sidik: "abc" } };
    const i = isi({ alasan: "  Terlewat saat kirim ", tanggal: "2026-11-10" });
    expect(tubuhPembetulan(i, 2, pra, false)).toEqual({ materialId: busa.materialId, qty: 2, alasanPembetulan: "Terlewat saat kirim", tanggalPemakaian: "2026-11-10", saldoDilihat: { v: 3 }, hppSidik: "abc" });
    expect(tubuhPembetulan(i, 2, pra, true)).toMatchObject({ konfirmasiBukanGanda: true });
  });
});

describe("bolehKonfirmasi", () => {
  const i = isi({ alasan: "Terlewat", tanggal: "2026-11-10" });
  test("pratinjau harus untuk isian yang sama", () => {
    const pra = { boleh: true };
    expect(bolehKonfirmasi(pra, sidik(i), sidik(i), false)).toBe(true);
    expect(bolehKonfirmasi(pra, sidik({ ...i, qty: "3" }), sidik(i), false)).toBe(false);
    expect(bolehKonfirmasi(null, sidik(i), null, false)).toBe(false);
    expect(bolehKonfirmasi({ boleh: false }, sidik(i), sidik(i), true)).toBe(false);
  });
  test("kemungkinan ganda wajib diperiksa", () => {
    const pra = { boleh: true, sudahTercatat: { perluKonfirmasi: true } };
    expect(bolehKonfirmasi(pra, sidik(i), sidik(i), false)).toBe(false);
    expect(bolehKonfirmasi(pra, sidik(i), sidik(i), true)).toBe(true);
  });
});

describe("bulanWib & pengajuan", () => {
  test("batas bulan kalender WIB, termasuk pergantian tahun", () => {
    expect(bulanWib(0, new Date("2026-11-30T18:00:00Z"))).toMatchObject({ dari: "2026-12-01", sampai: "2026-12-31", label: "Desember 2026" }); // 01.00 WIB 1 Des
    expect(bulanWib(-1, new Date("2026-01-10T03:00:00Z"))).toMatchObject({ dari: "2025-12-01", sampai: "2025-12-31" });
    expect(bulanWib(0, new Date("2028-02-10T03:00:00Z")).sampai).toBe("2028-02-29");
  });
  test("pengajuan dikelompokkan per unit", () => {
    const m = kelompokPengajuan([{ id: "a", unitId: "u1" }, { id: "b", unitId: "u1" }, { id: "c", unitId: "u2" }] as never);
    expect(m.get("u1")?.length).toBe(2);
    expect(m.has("u3")).toBe(false);
  });
});

describe("tier kaca", () => {
  test("gerak dikurangi → MINIMAL; Android lama / RAM kecil → LITE; HP kuat → FULL", () => {
    expect(pickGlassTier({ androidApi: 34, totalMemoryBytes: 8e9, kurangiGerak: true })).toBe("MINIMAL");
    expect(pickGlassTier({ androidApi: 29, totalMemoryBytes: 8e9, kurangiGerak: false })).toBe("LITE");
    expect(pickGlassTier({ androidApi: 34, totalMemoryBytes: 2e9, kurangiGerak: false })).toBe("LITE");
    expect(pickGlassTier({ androidApi: 34, totalMemoryBytes: null, kurangiGerak: false })).toBe("LITE");
    expect(pickGlassTier({ androidApi: 34, totalMemoryBytes: 8e9, kurangiGerak: false })).toBe("FULL");
  });
});
