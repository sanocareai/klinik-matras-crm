import { dalamRentang, geserBulan, geserHari, jumlahHari, ketuk, labelRentang, pintasan, selBulan } from "@/features/rentangTanggal";

test("sel bulan: minggu mulai Senin, kosong di depan & belakang, kelipatan 7", () => {
  const nov = selBulan(2026, 10); // 1 Nov 2026 = Minggu → 6 sel kosong
  expect(nov.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
  expect(nov.filter(Boolean)).toHaveLength(30);
  expect(nov.length % 7).toBe(0);
  expect(selBulan(2028, 1).filter(Boolean)).toHaveLength(29); // kabisat
});

test("geser hari & bulan melintasi batas bulan/tahun", () => {
  expect(geserHari("2026-11-01", -1)).toBe("2026-10-31");
  expect(geserHari("2026-12-31", 1)).toBe("2027-01-01");
  expect(geserBulan(2026, 11, 1)).toEqual({ y: 2027, m: 0 });
  expect(geserBulan(2026, 0, -1)).toEqual({ y: 2025, m: 11 });
});

test("ketuk: awal → akhir (ditukar bila lebih awal) → mulai baru", () => {
  let s = ketuk({ awal: null, akhir: null }, "2026-11-10");
  expect(s).toEqual({ awal: "2026-11-10", akhir: null });
  s = ketuk(s, "2026-11-03");
  expect(s).toEqual({ awal: "2026-11-03", akhir: "2026-11-10" });
  expect(ketuk(s, "2026-11-20")).toEqual({ awal: "2026-11-20", akhir: null });
  expect(ketuk({ awal: "2026-11-05", akhir: null }, "2026-11-05")).toEqual({ awal: "2026-11-05", akhir: "2026-11-05" });
  expect(dalamRentang("2026-11-07", "2026-11-03", "2026-11-10")).toBe(true);
  expect(dalamRentang("2026-11-11", "2026-11-03", "2026-11-10")).toBe(false);
});

test("pintasan berakhir hari ini (WIB), termasuk hari ini", () => {
  const p = pintasan(new Date("2026-11-14T18:30:00Z")); // 15 Nov 01.30 WIB
  expect(p.find((x) => x.key === "7")!.r).toEqual({ dari: "2026-11-09", sampai: "2026-11-15" });
  expect(jumlahHari(p.find((x) => x.key === "30")!.r)).toBe(30);
  expect(p.find((x) => x.key === "tahun")!.r.dari).toBe("2026-01-01");
});

test("label rentang", () => {
  expect(labelRentang({ dari: "2026-11-03", sampai: "2026-11-14" })).toBe("3 Nov – 14 Nov 2026");
  expect(labelRentang({ dari: "2025-12-28", sampai: "2026-01-04" })).toBe("28 Des 2025 – 4 Jan 2026");
  expect(labelRentang({ dari: "2026-11-14", sampai: "2026-11-14" })).toBe("14 Nov 2026");
});
