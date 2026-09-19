import { peranContoh } from "@/mocks/roles";
import type { Capabilities } from "@/api/types";
import {
  AksesDitolak, assertCan, bisaMencatatAtauVerifikasi, has, ringkasHakAkses, tabTerlihat,
} from "@/auth/capabilities";
import { aksiUntuk } from "@/features/aksi";
import { jalankanPerintah, StepUpDibatalkan } from "@/api/command";
import { setClockForTests, useLock } from "@/auth/lock";
import { useSession } from "@/auth/session";
import { redact } from "@/lib/log";
import { PESAN_BIOMETRIK } from "@/auth/biometric";
import { pesanSesiHilang, pesanUntukPengguna, ApiError } from "@/api/errors";

function caps(email: string): Capabilities {
  const p = peranContoh(email);
  if ("tanpaAkses" in p) throw new Error("tanpa akses");
  return p.capabilities;
}
const FINANCE = caps("finance@x");
const OWNER = caps("owner@x");
const AKUNTAN = caps("akuntan@x");
const APPROVER = caps("approver@x");

describe("capability guard per peran", () => {
  it("PAYMENT_WRITE (verifikasi pembayaran) hanya FINANCE; OWNER/ACCOUNTANT/APPROVER hanya baca", () => {
    expect(has(FINANCE, "paymentWrite")).toBe(true);
    for (const c of [OWNER, AKUNTAN, APPROVER]) {
      expect(has(c, "paymentWrite")).toBe(false);
      expect(has(c, "paymentRead")).toBe(true);
    }
  });

  it("ACCOUNTANT: baca + catat, tanpa setujui; APPROVER: baca + setujui, tanpa catat", () => {
    expect(has(AKUNTAN, ["financeRead", "financePost"])).toBe(true);
    expect(has(AKUNTAN, "financeApprove")).toBe(false);
    expect(has(APPROVER, ["financeRead", "financeApprove"])).toBe(true);
    expect(has(APPROVER, "financePost")).toBe(false);
  });

  it("mode any/all dan capabilities kosong → tidak boleh apa pun", () => {
    expect(has(APPROVER, ["financePost", "financeApprove"], "any")).toBe(true);
    expect(has(APPROVER, ["financePost", "financeApprove"], "all")).toBe(false);
    expect(has(null, "financeRead")).toBe(false);
    expect(has(undefined, ["financeRead"], "any")).toBe(false);
  });

  it("assertCan melempar AksesDitolak berpesan Indonesia", () => {
    expect(() => assertCan(APPROVER, "financePost")).toThrow(AksesDitolak);
    expect(() => assertCan(APPROVER, "financePost")).toThrow(/mencatat transaksi/);
    expect(() => assertCan(AKUNTAN, "financeApprove")).toThrow(/tidak punya izin/);
    expect(() => assertCan(FINANCE, ["financePost", "financeApprove"])).not.toThrow();
  });

  it("tab terlihat mengikuti izin, bukan nama role", () => {
    expect(tabTerlihat(FINANCE)).toEqual(["index", "transaksi", "persetujuan", "laporan", "lainnya"]);
    expect(tabTerlihat(OWNER)).toEqual(["index", "transaksi", "persetujuan", "laporan", "lainnya"]);
    expect(tabTerlihat(AKUNTAN)).toEqual(["index", "transaksi", "laporan", "lainnya"]);
    expect(tabTerlihat(APPROVER)).toEqual(["index", "transaksi", "persetujuan", "laporan", "lainnya"]);
    expect(tabTerlihat(null)).toEqual(["lainnya"]);
  });

  it("FAB (+) hanya untuk yang bisa mencatat atau memverifikasi", () => {
    expect(bisaMencatatAtauVerifikasi(FINANCE)).toBe(true);
    expect(bisaMencatatAtauVerifikasi(AKUNTAN)).toBe(true);
    expect(bisaMencatatAtauVerifikasi(APPROVER)).toBe(false);
    expect(bisaMencatatAtauVerifikasi(OWNER)).toBe(true); // OWNER punya FINANCE_POST menurut server
  });

  it("aksi cepat: FINANCE 8, ACCOUNTANT tanpa verifikasi, APPROVER kosong, OWNER tidak dapat aksi cepat", () => {
    expect(aksiUntuk(FINANCE)).toHaveLength(8);
    const akuntan = aksiUntuk(AKUNTAN).map((a) => a.id);
    expect(akuntan).toHaveLength(7);
    expect(akuntan).not.toContain("verifikasi");
    expect(aksiUntuk(APPROVER)).toEqual([]);
    expect(aksiUntuk(OWNER)).toEqual([]);
    expect(aksiUntuk(null)).toEqual([]);
  });

  it("ringkasan hak akses menampilkan yang boleh & tidak", () => {
    const r = ringkasHakAkses(APPROVER);
    expect(r.find((x) => x.need === "financeApprove")?.boleh).toBe(true);
    expect(r.find((x) => x.need === "paymentWrite")?.boleh).toBe(false);
  });

  it("peran contoh: email menentukan preset; tanpaakses ditolak", () => {
    expect(peranContoh("tanpaakses@x")).toEqual({ tanpaAkses: true });
    expect(caps("accountant@x").preset).toBe("ACCOUNTANT");
    expect(caps("penyetuju@x").preset).toBe("APPROVER");
    expect(caps("siapa@x").preset).toBe("FINANCE");
  });
});

describe("jalankanPerintah: guard + step-up + Idempotency-Key", () => {
  let t = 5_000_000;
  beforeEach(async () => {
    t = 5_000_000;
    setClockForTests(() => t);
    await useLock.getState().reset();
    useSession.setState({ capabilities: FINANCE, status: "signedIn" });
  });
  afterAll(() => setClockForTests(null));

  it("tanpa izin → ditolak SEBELUM run dipanggil", async () => {
    useSession.setState({ capabilities: APPROVER });
    const run = jest.fn(async () => "ok");
    await expect(jalankanPerintah({ need: "paymentWrite", run })).rejects.toBeInstanceOf(AksesDitolak);
    expect(run).not.toHaveBeenCalled();
  });

  it("dengan izin → run menerima Idempotency-Key; kunci yang diberikan dipakai ulang persis", async () => {
    const run = jest.fn(async (k: string) => k);
    const k1 = await jalankanPerintah({ need: "financeApprove", run });
    expect(k1).toBeTruthy();
    const k2 = await jalankanPerintah({ need: "financeApprove", kunci: "kunci-tetap", run });
    expect(k2).toBe("kunci-tetap");
  });

  it("aksi sensitif: step-up dibatalkan → run tidak dipanggil; disetujui → lanjut", async () => {
    await useLock.getState().setupPin("482913");
    t += 3 * 60_000; // lewat jendela step-up 2 menit
    const run = jest.fn(async () => "ok");
    const p1 = jalankanPerintah({ need: "financeApprove", stepUp: true, run });
    await Promise.resolve();
    useLock.getState().resolveStepUp(false);
    await expect(p1).rejects.toBeInstanceOf(StepUpDibatalkan);
    expect(run).not.toHaveBeenCalled();

    const p2 = jalankanPerintah({ need: "financeApprove", stepUp: true, run });
    await Promise.resolve();
    useLock.getState().resolveStepUp(true);
    await expect(p2).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("aksi sensitif tepat setelah unlock → tidak meminta ulang", async () => {
    await useLock.getState().setupPin("482913");
    const run = jest.fn(async () => "ok");
    await expect(jalankanPerintah({ need: "financeApprove", stepUp: true, run })).resolves.toBe("ok");
    expect(useLock.getState().stepUpOpen).toBe(false);
  });
});

describe("log aman (redact)", () => {
  it("menyamarkan token, sandi, PIN, email, nominal, Authorization — termasuk yang bersarang", () => {
    const keluar = redact({
      accessToken: "abc", refreshToken: "smr_xxxxxxxxxxxxxxxx", password: "p", pin: "482913", email: "a@b.c",
      headers: { Authorization: "Bearer zzz" }, amount: "1500000.00", ok: "tampil",
      daftar: [{ pinHash: "h", nama: "aman" }],
    }) as Record<string, unknown>;
    const teks = JSON.stringify(keluar);
    for (const r of ["abc", "smr_xxxxxxxxxxxxxxxx", "482913", "a@b.c", "Bearer zzz", "1500000.00", '"h"']) expect(teks).not.toContain(r);
    expect(keluar.ok).toBe("tampil");
    expect((keluar.daftar as { nama: string }[])[0]?.nama).toBe("aman");
  });

  it("nilai string yang tampak seperti token disamarkan walau kuncinya tidak dikenal", () => {
    expect(redact("smr_abcdefghijklmnop")).toBe("[disembunyikan]");
    expect(redact("eyJhbGciOi.eyJzdWIi.sig")).toBe("[disembunyikan]");
    expect(redact("Bearer abc")).toBe("[disembunyikan]");
    expect(redact("biasa")).toBe("biasa");
  });
});

describe("pesan Indonesia untuk keadaan galat", () => {
  it("pesan biometrik lengkap dan menyebut PIN sebagai cadangan", () => {
    for (const k of ["dibatalkan", "gagal", "terkunci", "tidak_tersedia", "belum_terdaftar"] as const) {
      expect(PESAN_BIOMETRIK[k].length).toBeGreaterThan(10);
    }
    expect(PESAN_BIOMETRIK.gagal).toMatch(/PIN/);
  });

  it("alasan sesi hilang punya pesan; tidak berizin dan PIN terlalu banyak salah dikenali", () => {
    expect(pesanSesiHilang("NOT_FINANCE_TEAM")).toMatch(/akses Finance/);
    expect(pesanSesiHilang("PIN_TERLALU_BANYAK_SALAH")).toMatch(/PIN/);
    expect(pesanSesiHilang("SESSION_REVOKED")).toBeTruthy();
    expect(pesanSesiHilang(null)).toBeNull();
  });

  it("galat server 5xx generik (tanpa bocor detail), 429 berwaktu, jaringan", () => {
    const e500 = new ApiError({ status: 500, code: "INTERNAL", message: "stack trace rahasia" });
    expect(pesanUntukPengguna(e500)).not.toContain("stack trace");
    expect(pesanUntukPengguna(e500)).toMatch(/Server/i);
    const e429 = new ApiError({ status: 429, code: "RATE_LIMITED", message: "x", retryAfterSeconds: 90 });
    expect(pesanUntukPengguna(e429)).toMatch(/menit|detik/);
  });
});
