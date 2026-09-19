import { buatVerifier, cekPin, jedaSetelahSalah, pinLemah, pinValid } from "@/auth/pin";
import { pickGlassTier } from "@/design/glass";
import { hariIniWIB, periodeBulanIni, tanggalPendek, tanggalPanjang, waktuLengkap, wibParts, sapaan } from "@/lib/dates";
import { statusInfo, STATUS } from "@/lib/strings";
import { colors, toneColors } from "@/design/tokens";

const GB = 1024 * 1024 * 1024;

describe("PIN lokal", () => {
  it("verifier PBKDF2: PIN benar lolos, salah gagal; salt berbeda membuat hash berbeda", async () => {
    const v1 = await buatVerifier("482913", { iterations: 1000 });
    const v2 = await buatVerifier("482913", { iterations: 1000, salt: new Uint8Array(16).fill(9) });
    expect(await cekPin("482913", v1)).toBe(true);
    expect(await cekPin("482914", v1)).toBe(false);
    expect(v1.hash).not.toContain("482913");
    expect(v1.hash).toHaveLength(64);
    expect(v2.hash).not.toBe(v1.hash);
    expect(v2.salt).not.toBe(v1.salt);
  });

  it("hanya 6 digit angka", async () => {
    expect(pinValid("123456")).toBe(true);
    for (const buruk of ["12345", "1234567", "12345a", "", "12 456"]) expect(pinValid(buruk)).toBe(false);
    await expect(buatVerifier("abc")).rejects.toThrow();
    expect(await cekPin("abc", await buatVerifier("482913", { iterations: 1000 }))).toBe(false);
  });

  it("PIN lemah: digit sama semua atau berurutan naik/turun", () => {
    for (const p of ["000000", "111111", "123456", "234567", "654321", "987654"]) expect(pinLemah(p)).toBe(true);
    for (const p of ["482913", "135790", "121212"]) expect(pinLemah(p)).toBe(false);
  });

  it("jeda percobaan salah: 5→30 dtk, 8→5 mnt, 10→hapus data", () => {
    expect(jedaSetelahSalah(0)).toBe(0);
    expect(jedaSetelahSalah(4)).toBe(0);
    expect(jedaSetelahSalah(5)).toBe(30);
    expect(jedaSetelahSalah(7)).toBe(30);
    expect(jedaSetelahSalah(8)).toBe(300);
    expect(jedaSetelahSalah(9)).toBe(300);
    expect(jedaSetelahSalah(10)).toBe("hapus");
  });
});

describe("tier glass", () => {
  const dasar = { androidApi: 34, totalMemoryBytes: 8 * GB, efekRingan: false, kurangiGerak: false };
  it("FULL hanya untuk Android 12+ dengan RAM cukup", () => {
    expect(pickGlassTier(dasar)).toBe("FULL");
    expect(pickGlassTier({ ...dasar, androidApi: 31 })).toBe("FULL");
  });
  it("LITE untuk Android lama, RAM kecil/tak diketahui, atau Efek Ringan", () => {
    expect(pickGlassTier({ ...dasar, androidApi: 30 })).toBe("LITE");
    expect(pickGlassTier({ ...dasar, androidApi: 26 })).toBe("LITE");
    expect(pickGlassTier({ ...dasar, totalMemoryBytes: 3 * GB })).toBe("LITE");
    expect(pickGlassTier({ ...dasar, totalMemoryBytes: null })).toBe("LITE");
    expect(pickGlassTier({ ...dasar, efekRingan: true })).toBe("LITE");
  });
  it("MINIMAL bila gerak dikurangi (mengalahkan semua)", () => {
    expect(pickGlassTier({ ...dasar, kurangiGerak: true })).toBe("MINIMAL");
    expect(pickGlassTier({ ...dasar, androidApi: 26, kurangiGerak: true })).toBe("MINIMAL");
  });
});

describe("tanggal WIB (bukan zona perangkat)", () => {
  it("jam 00:00–07:00 WIB tidak jatuh ke hari sebelumnya", () => {
    // 2026-09-18T18:30Z = 19 Sep 01:30 WIB
    expect(hariIniWIB(new Date("2026-09-18T18:30:00Z"))).toBe("2026-09-19");
    expect(hariIniWIB(new Date("2026-09-18T16:59:59Z"))).toBe("2026-09-18");
    expect(wibParts("2026-09-18T18:30:00Z")).toMatchObject({ y: 2026, m: 9, d: 19, hh: 1, mm: 30 });
  });
  it("format tanggal Indonesia", () => {
    expect(tanggalPendek("2026-09-19")).toBe("19 Sep 2026");
    expect(tanggalPendek(null)).toBe("—");
    expect(tanggalPendek("2026-09-18T18:30:00Z")).toBe("19 Sep 2026");
    expect(tanggalPanjang("2026-09-19")).toBe("Sabtu, 19 September 2026");
    expect(waktuLengkap("2026-09-19T07:05:00Z")).toBe("19 Sep 2026 · 14.05 WIB");
  });
  it("periode bulan berjalan menurut WIB (akhir bulan tepat)", () => {
    expect(periodeBulanIni(new Date("2026-09-19T03:00:00Z"))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodeBulanIni(new Date("2026-02-10T03:00:00Z"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // 30 Sep 17:30Z = 1 Okt 00:30 WIB → sudah Oktober
    expect(periodeBulanIni(new Date("2026-09-30T17:30:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("sapaan menurut jam WIB", () => {
    expect(sapaan(new Date("2026-09-19T01:00:00Z"))).toBe("Selamat pagi"); // 08.00 WIB
    expect(sapaan(new Date("2026-09-19T14:00:00Z"))).toBe("Selamat malam"); // 21.00 WIB
  });
});

describe("status & warna", () => {
  it("status dikenal punya label Indonesia; yang tak dikenal ditampilkan apa adanya (tidak crash)", () => {
    expect(statusInfo("MENUNGGU_APPROVAL")).toEqual({ label: "Menunggu persetujuan", tone: "warning" });
    expect(statusInfo("BELUM_DIVERIFIKASI").label).toBe("Menunggu verifikasi");
    expect(statusInfo("STATUS_BARU_DARI_SERVER")).toEqual({ label: "STATUS_BARU_DARI_SERVER", tone: "neutral" });
  });
  it("semua status server yang diketahui terpetakan", () => {
    for (const s of ["DRAFT", "DISETUJUI", "DITOLAK", "DIBAYAR", "DIBATALKAN", "LUNAS", "AKTIF", "POSTED", "REVERSED", "OPEN", "CLOSED"]) {
      expect(STATUS[s]).toBeDefined();
    }
  });
  it("token warna lengkap untuk terang & gelap", () => {
    expect(Object.keys(colors.light).sort()).toEqual(Object.keys(colors.dark).sort());
    expect(toneColors(colors.light, "danger").fg).toBe("#DC2626");
    expect(colors.light.primary).toBe("#2064B7");
  });
});
