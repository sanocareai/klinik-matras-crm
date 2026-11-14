import { chipKategori, hitungFilter, kategoriTambahan, kelompokDokumentasi, paramDaftarOrder, ringkasBaris, tanggalPendek, type BarisOrder, type KategoriDok } from "@/features/order";

const bulan = { dari: "2026-11-01", sampai: "2026-11-30" };

describe("paramDaftarOrder", () => {
  test("semua tanpa periode: hanya halaman & cari", () => {
    expect(paramDaftarOrder({ q: "  RES-1 ", filter: "semua", bulan: null }, 2)).toEqual({ q: "RES-1", displayStatus: undefined, kelengkapan: undefined, urut: undefined, dari: undefined, sampai: undefined, page: 2, pageSize: 30 });
  });
  test("aktif = semua status sebelum Terkirim; terkirim; bahan belum dicatat = terlama dulu + periode", () => {
    expect(paramDaftarOrder({ q: "", filter: "aktif", bulan: null }, 1).displayStatus).toBe("PENGAMBILAN,DIPROSES,SIAP_KIRIM");
    expect(paramDaftarOrder({ q: "", filter: "terkirim", bulan: null }, 1).displayStatus).toBe("TERKIRIM");
    const b = paramDaftarOrder({ q: "", filter: "bahan", bulan }, 1);
    expect([b.kelengkapan, b.urut, b.dari, b.sampai, b.displayStatus]).toEqual(["BAHAN_BELUM_DICATAT", "terlama", "2026-11-01", "2026-11-30", undefined]);
  });
});

test("hitungFilter dari hitungan status server", () => {
  expect(hitungFilter(undefined)).toBeNull();
  expect(hitungFilter({ PENGAMBILAN: 34, DIPROSES: 24, SIAP_KIRIM: 32, TERKIRIM: 634 })).toEqual({ aktif: 90, terkirim: 634, semua: 724 });
});

describe("ringkasBaris", () => {
  const dasar: BarisOrder = { id: "u1", unitCode: "RES-1-U1", merk: "Sano", ukuran: "160x200", status: "DELIVERED", createdAt: "2026-11-01T03:00:00Z", order: { orderNumber: "RES-1", customer: { name: "Hani" } }, adopsi: null };
  test("terkirim & selesai: satu chip; bahan belum dicatat ditandai", () => {
    const r = ringkasBaris({ ...dasar, adopsi: { statusOrder: { key: "TERKIRIM", label: "Terkirim" }, kerja: { key: "SELESAI", label: "Selesai", tone: "green" }, kelengkapan: { keys: ["BAHAN_BELUM_DICATAT"] } } });
    expect(r.sub).toBe("Hani · Sano 160x200");
    expect(r.chips).toEqual([{ label: "Terkirim", tone: "green" }, { label: "Bahan belum dicatat", tone: "orange" }]);
    expect(r.bahanBelum).toBe(true);
  });
  test("label kerja yang sama dengan status order tidak diulang (Dibatalkan)", () => {
    const r = ringkasBaris({ ...dasar, adopsi: { statusOrder: { key: "DIBATALKAN", label: "Dibatalkan" }, kerja: { key: "DIBATALKAN", label: "Dibatalkan", tone: "neutral" } } });
    expect(r.chips).toEqual([{ label: "Dibatalkan", tone: "gray" }]);
  });
  test("sudah diajukan → chip hijau; status kerja ikut tampil selama belum terkirim", () => {
    const r = ringkasBaris({ ...dasar, adopsi: { statusOrder: { key: "DIPROSES", label: "Diproses" }, kerja: { key: "DIKERJAKAN", label: "Sudah dikerjakan", tone: "accent" }, kelengkapan: { keys: ["BAHAN_BELUM_DICATAT"] } } }, true);
    expect(r.chips).toEqual([{ label: "Diproses", tone: "blue" }, { label: "Sudah dikerjakan", tone: "blue" }, { label: "Bahan diajukan", tone: "green" }]);
  });
});

test("tanggalPendek: tanggal polos & ISO (WIB)", () => {
  expect(tanggalPendek("2026-09-27")).toBe("27 Sep 2026");
  expect(tanggalPendek("2026-10-31T18:30:00Z")).toBe("1 Nov 2026"); // 01.30 WIB
  expect(tanggalPendek(null)).toBeNull();
  expect(tanggalPendek("bukan tanggal")).toBeNull();
});

describe("dokumentasi", () => {
  const k = (p: Partial<KategoriDok>): KategoriDok => ({ key: "X", label: "X", group: "BEFORE", applicable: true, count: 0, min: 2, status: "MENUNGGU", missing: 0, ...p });
  test("kelompok hanya kategori yang berlaku, urutan Sebelum → Proses → Sesudah", () => {
    const g = kelompokDokumentasi([k({ key: "A", group: "AFTER" }), k({ key: "B", group: "BEFORE", applicable: false }), k({ key: "C", group: "BEFORE" })]);
    expect(g.map((x) => [x.label, x.kategori.map((c) => c.key)])).toEqual([["Sebelum", ["C"]], ["Sesudah", ["A"]]]);
  });
  test("chip V2 memakai status server; dokumentasi tambahan (tanpa minimal) hanya jumlah foto", () => {
    expect(chipKategori({ count: 3, min: 3, status: "LENGKAP", missing: 0 })).toEqual({ label: "3/3 · lengkap", tone: "green" });
    expect(chipKategori({ count: 1, min: 3, status: "KURANG", missing: 2 })).toEqual({ label: "1/3 · kurang 2", tone: "orange" });
    const [t0, t1] = kategoriTambahan([{ key: "A", label: "A", group: "AFTER", count: 0, items: [] }, { key: "B", label: "B", group: "AFTER", count: 2, items: [] }]);
    expect([chipKategori(t0!), chipKategori(t1!)]).toEqual([{ label: "Belum ada", tone: "gray" }, { label: "2 foto", tone: "blue" }]);
    expect(t0!.applicable).toBe(true);
  });
});
