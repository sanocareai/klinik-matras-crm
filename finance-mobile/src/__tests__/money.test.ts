import {
  formatRupiah, formatRupiahRingkas, isMoneyString, isNegative, isZero, parseInputRupiah, rasio, splitRupiah, terbesar, toMoney, toMoneyOrNull,
} from "@/lib/money";

describe("toMoney / normalisasi string desimal", () => {
  it("menormalkan ke minimal 2 desimal tanpa menyentuh float", () => {
    expect(toMoney("1234567.5")).toBe("1234567.50");
    expect(toMoney("50000")).toBe("50000.00");
    expect(toMoney("0.1")).toBe("0.10");
    expect(toMoney("007.25")).toBe("7.25");
    expect(toMoney("-12.3")).toBe("-12.30");
  });

  it("nilai sangat besar (di atas 2^53) tetap tepat", () => {
    expect(toMoney("9007199254740993.10")).toBe("9007199254740993.10");
    expect(formatRupiah(toMoney("9007199254740993.10"))).toBe("Rp 9.007.199.254.740.993,10");
  });

  it("menolak yang bukan angka desimal; nol negatif menjadi nol", () => {
    expect(() => toMoney("12,5")).toThrow();
    expect(() => toMoney("abc")).toThrow();
    expect(() => toMoney("1e5")).toThrow();
    expect(toMoneyOrNull("x")).toBeNull();
    expect(toMoneyOrNull(null)).toBeNull();
    expect(toMoney("-0")).toBe("0.00");
    expect(isMoneyString("12.30")).toBe(true);
    expect(isMoneyString(12.3)).toBe(false);
  });

  it("isNegative / isZero", () => {
    expect(isNegative(toMoney("-0.01"))).toBe(true);
    expect(isNegative(toMoney("0.00"))).toBe(false);
    expect(isZero(toMoney("0"))).toBe(true);
    expect(isZero(toMoney("0.01"))).toBe(false);
  });
});

describe("formatRupiah / splitRupiah", () => {
  it("format Indonesia: titik ribuan, koma desimal hanya bila ada sen", () => {
    expect(formatRupiah(toMoney("8200000"))).toBe("Rp 8.200.000");
    expect(formatRupiah(toMoney("8200000.28"))).toBe("Rp 8.200.000,28");
    expect(formatRupiah(toMoney("999"))).toBe("Rp 999");
    expect(formatRupiah(toMoney("1000"))).toBe("Rp 1.000");
    expect(formatRupiah(toMoney("0"))).toBe("Rp 0");
    expect(formatRupiah(toMoney("-1500000"))).toBe("-Rp 1.500.000");
    expect(formatRupiah(toMoney("12"), { selaluDesimal: true })).toBe("Rp 12,00");
    expect(formatRupiah(toMoney("1250000"), { simbol: false })).toBe("1.250.000");
  });

  it("splitRupiah memisahkan pecahan untuk tampilan redup", () => {
    expect(splitRupiah(toMoney("8200.28"))).toEqual({ negatif: false, utuh: "8.200", pecahan: "28" });
    expect(splitRupiah(toMoney("8200"))).toEqual({ negatif: false, utuh: "8.200", pecahan: "" });
    expect(splitRupiah(toMoney("-5.5"))).toEqual({ negatif: true, utuh: "5", pecahan: "50" });
  });
});

describe("formatRupiahRingkas (hanya tampilan)", () => {
  it("menyingkat dengan pembulatan setengah-naik", () => {
    expect(formatRupiahRingkas(toMoney("824460000"))).toBe("Rp 824,5 jt");
    expect(formatRupiahRingkas(toMoney("1250000"))).toBe("Rp 1,3 jt");
    expect(formatRupiahRingkas(toMoney("1200000"))).toBe("Rp 1,2 jt");
    expect(formatRupiahRingkas(toMoney("1000000"))).toBe("Rp 1 jt");
    expect(formatRupiahRingkas(toMoney("15000"))).toBe("Rp 15 rb");
    expect(formatRupiahRingkas(toMoney("999"))).toBe("Rp 999");
    expect(formatRupiahRingkas(toMoney("1300000000"))).toBe("Rp 1,3 M");
    expect(formatRupiahRingkas(toMoney("-2500000"))).toBe("-Rp 2,5 jt");
  });
});

describe("parseInputRupiah (isian format Indonesia)", () => {
  it("membaca titik ribuan, koma desimal, dan simbol Rp", () => {
    expect(parseInputRupiah("150.000")).toBe("150000.00");
    expect(parseInputRupiah("150.000,50")).toBe("150000.50");
    expect(parseInputRupiah("1500000")).toBe("1500000.00");
    expect(parseInputRupiah("Rp 2.500.000")).toBe("2500000.00");
    expect(parseInputRupiah("75,5")).toBe("75.50");
    expect(parseInputRupiah("1.234.567,89")).toBe("1234567.89");
  });

  it("menolak yang tidak sah", () => {
    expect(parseInputRupiah("")).toBeNull();
    expect(parseInputRupiah("abc")).toBeNull();
    expect(parseInputRupiah("12,345")).toBeNull();
    expect(parseInputRupiah("1.2.3")).toBeNull();
  });
});

describe("rasio & terbesar (geometri chart, tanpa float uang)", () => {
  it("rasio bagian ÷ maksimum", () => {
    expect(rasio(toMoney("50"), toMoney("100"))).toBe(0.5);
    expect(rasio(toMoney("0"), toMoney("100"))).toBe(0);
    expect(rasio(toMoney("100"), toMoney("0"))).toBe(0);
    expect(rasio(toMoney("-5"), toMoney("100"))).toBe(0);
    expect(rasio(toMoney("300"), toMoney("100"))).toBe(1);
    expect(rasio(toMoney("118400000"), toMoney("236900000"))).toBeCloseTo(0.499, 2);
  });

  it("terbesar membandingkan nilai desimal secara benar", () => {
    expect(terbesar([toMoney("9.99"), toMoney("10.00"), toMoney("2.50")])).toBe("10.00");
    expect(terbesar([toMoney("100.10"), toMoney("100.09")])).toBe("100.10");
    expect(terbesar([toMoney("-5")])).toBe("0.00");
    expect(terbesar([])).toBe("0.00");
  });
});
