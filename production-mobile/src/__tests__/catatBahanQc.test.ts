import {
  angka, bolehKirimKeranjang, bolehKonfirmasi, geserJumlah, hapusKeranjang, hppBaris, isianDari, keadaanSaldo, parseJumlah, perluPembetulan, qtyStok, ringkasHpp, rupiah,
  satuanKirim, sidik, tambahKeranjang, teksStok, tubuhBiasa, tubuhPembetulan, tubuhPratinjau, ubahKeranjang, validasi, type BahanKeranjang, type BarisKeranjang, type Bersama, type Isian,
} from "@/features/catatBahanQc";
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

// ── Keranjang (gaya kasir) ──
const kBusa: BahanKeranjang = { ...busa, tersedia: 5, saldoDiketahui: true, keadaan: "CUKUP", harga: { harga: 72000 } };
const kWibing: BahanKeranjang = { ...wibing, tersedia: 2, saldoDiketahui: true, keadaan: "CUKUP", harga: { harga: 90000 } };
const kTanpaHarga: BahanKeranjang = { materialId: "33333333-3333-4333-8333-333333333333", nama: "Benang", kode: "BN", satuan: "ROLL", satuanPakai: null, tersedia: null, saldoDiketahui: false, harga: { harga: null } };
const baris = (bahan: BahanKeranjang, qty: string, satuan: string | null = bahan.satuanPakai?.satuanPakai ?? null): BarisKeranjang => ({ bahan, qty, satuan });
const BERSAMA: Bersama = { catatan: "", alasan: "", tanggal: "2026-11-10" };

describe("keranjang", () => {
  test("tambah tidak menggandakan; bahan beraturan mulai dari satuan pakai; ubah & hapus", () => {
    let k = tambahKeranjang([], kBusa);
    k = tambahKeranjang(k, kBusa);
    k = tambahKeranjang(k, kWibing);
    expect(k.map((b) => [b.bahan.kode, b.qty, b.satuan])).toEqual([["HR-30", "", null], ["LW", "", "METER"]]);
    k = ubahKeranjang(k, kBusa.materialId, { qty: "2" });
    expect(k[0]!.qty).toBe("2");
    expect(hapusKeranjang(k, kBusa.materialId).map((b) => b.bahan.kode)).toEqual(["LW"]);
  });
  test("tombol − / +: naik-turun 1, tidak pernah di bawah nol (0 → kosong)", () => {
    expect(geserJumlah("", 1)).toBe("1");
    expect(geserJumlah("1,5", 1)).toBe("2,5");
    expect(geserJumlah("1", -1)).toBe("");
    expect(geserJumlah("0,5", -1)).toBe("");
  });
  test("angka & rupiah gaya Indonesia tanpa Intl", () => {
    expect(angka(1234567.5)).toBe("1.234.567,5");
    expect(angka(0.22225)).toBe("0,2223");
    expect(rupiah(144000)).toBe("Rp144.000");
    expect(rupiah(12500.5)).toBe("Rp12.500,5");
    expect(rupiah(null)).toBe("—");
  });
  test("jumlah satuan pakai dikonversi ke satuan stok (45 meter ÷ 90 = 0,5 roll)", () => {
    expect(qtyStok(baris(kWibing, "45"))).toBe(0.5);
    expect(qtyStok(baris(kWibing, "1", "ROLL"))).toBe(1);
    expect(qtyStok(baris(kBusa, ""))).toBeNull();
  });
  test("HPP baris = jumlah stok × Harga Berlaku; tanpa harga tidak ditebak; peran tanpa izin tersembunyi", () => {
    expect(hppBaris(baris(kBusa, "2"))).toEqual({ status: "ada", harga: 72000, subtotal: 144000 });
    expect(hppBaris(baris(kWibing, "45")).subtotal).toBe(45000); // 0,5 roll × Rp90.000
    expect(hppBaris(baris(kBusa, "")).subtotal).toBeNull();
    expect(hppBaris(baris(kTanpaHarga, "1")).status).toBe("tanpa_harga");
    expect(hppBaris(baris({ ...kBusa, harga: null }, "1")).status).toBe("tersembunyi");
  });
  test("total hanya menjumlah baris berharga & berjumlah; sisanya dihitung terpisah (bukan Rp0)", () => {
    const r = ringkasHpp([baris(kBusa, "2"), baris(kWibing, "45"), baris(kTanpaHarga, "1"), baris(kBusa, "")]);
    expect(r).toEqual({ tampil: true, total: 189000, nTanpaHarga: 1, nBelumJumlah: 1 });
    expect(ringkasHpp([baris({ ...kBusa, harga: null }, "1")]).tampil).toBe(false);
    expect(ringkasHpp([]).tampil).toBe(false);
  });
  test("teks stok: belum diketahui bukan nol; habis; tersedia", () => {
    expect(teksStok(kTanpaHarga)).toEqual({ teks: "Stok belum diketahui", nada: "gray" });
    expect(teksStok({ ...kBusa, tersedia: 0, keadaan: "NOL_TERHITUNG" }).teks).toBe("Habis menurut catatan");
    expect(teksStok(kBusa)).toEqual({ teks: "Tersedia 5 lembar", nada: "green" });
  });
  test("saldo: kurang & belum diketahui diblokir sebelum dikirim; cukup menampilkan sisa", () => {
    expect(keadaanSaldo(baris(kBusa, "6")).blok).toBe(true);
    expect(keadaanSaldo(baris(kTanpaHarga, "1")).blok).toBe(true);
    expect(keadaanSaldo(baris(kBusa, "2"))).toEqual({ blok: false, teks: "Sisa setelah dicatat: 3 lembar" });
    expect(keadaanSaldo(baris(kWibing, "90")).blok).toBe(false); // 90 meter = 1 roll ≤ 2 roll
  });
  test("boleh kirim keranjang: semua jumlah > 0 dan stok cukup; unit terkirim tidak memakai cek saldo lokal", () => {
    expect(bolehKirimKeranjang([], BERSAMA, "IN_PRODUCTION")).toEqual({ ok: false, galat: "Pilih bahan dulu dari katalog." });
    expect(bolehKirimKeranjang([baris(kBusa, "1"), baris(kWibing, "")], BERSAMA, "IN_PRODUCTION").ok).toBe(false);
    expect(bolehKirimKeranjang([baris(kBusa, "9")], BERSAMA, "IN_PRODUCTION")).toEqual({ ok: false, galat: "HR Foam: stok tidak cukup atau belum diketahui." });
    expect(bolehKirimKeranjang([baris(kBusa, "1"), baris(kWibing, "45")], BERSAMA, "IN_PRODUCTION")).toEqual({ ok: true });
    expect(bolehKirimKeranjang([baris(kBusa, "9")], { ...BERSAMA, alasan: "Lupa dicatat" }, "DELIVERED").ok).toBe(true); // dampak stok diputuskan pratinjau server
    expect(bolehKirimKeranjang([baris(kBusa, "1")], BERSAMA, "DELIVERED").ok).toBe(false); // alasan wajib
  });
  test("tiap baris keranjang dikirim dengan tubuh yang sama seperti pencatatan satu bahan", () => {
    const i = isianDari(baris(kWibing, "45"), { ...BERSAMA, catatan: "lapisan atas" });
    expect(tubuhBiasa(i, 45)).toEqual({ materialId: kWibing.materialId, qty: 45, note: "lapisan atas", satuan: "METER" });
  });
});
