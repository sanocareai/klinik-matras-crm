import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { STEPUP_TTL_MS, TIMEOUT_DEFAULT_MS, setClockForTests, useLock } from "@/auth/lock";

// Iterasi PBKDF2 dikecilkan di tes agar cepat; logikanya sama.
jest.mock("@/auth/pin", () => {
  const asli = jest.requireActual("@/auth/pin");
  return { ...asli, buatVerifier: (pin: string, o?: object) => asli.buatVerifier(pin, { ...o, iterations: 500 }) };
});

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const la = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const PIN = "482913";
const SALAH = "135790";

let t = 1_000_000;
const maju = (ms: number) => { t += ms; };

beforeEach(async () => {
  store.clear();
  t = 1_000_000;
  setClockForTests(() => t);
  la.hasHardwareAsync.mockResolvedValue(true);
  la.isEnrolledAsync.mockResolvedValue(true);
  la.authenticateAsync.mockResolvedValue({ success: true } as never);
  await useLock.getState().reset();
  await useLock.getState().load();
});
afterAll(() => setClockForTests(null));

const S = () => useLock.getState();

describe("PIN: dibuat, disimpan aman, diverifikasi", () => {
  it("batas kunci otomatis bawaan = 2 menit", () => {
    expect(TIMEOUT_DEFAULT_MS).toBe(120_000);
    expect(S().timeoutMs).toBe(120_000);
  });

  it("setupPin menyimpan HANYA verifier (bukan PIN); PIN mentah tidak ada di penyimpanan mana pun", async () => {
    const r = await S().setupPin(PIN);
    expect(r).toEqual({ ok: true });
    expect(S().pinSet).toBe(true);
    expect(S().locked).toBe(false);
    expect(S().setupBaru).toBe(true);
    const semua = [...store.values()].join("|");
    expect(store.has("lock.pin.v1")).toBe(true);
    expect(semua).not.toContain(PIN);
    const v = JSON.parse(store.get("lock.pin.v1") as string) as { salt: string; hash: string; iterations: number };
    expect(v.hash).toHaveLength(64);
    expect(v.salt).toHaveLength(32);
    expect(v.iterations).toBeGreaterThan(0);
  });

  it("menolak PIN tidak sah / terlalu lemah", async () => {
    expect(await S().setupPin("12345")).toEqual({ ok: false, reason: "format" });
    expect(await S().setupPin("abcdef")).toEqual({ ok: false, reason: "format" });
    expect(await S().setupPin("111111")).toEqual({ ok: false, reason: "lemah" });
    expect(await S().setupPin("123456")).toEqual({ ok: false, reason: "lemah" });
    expect(await S().setupPin("654321")).toEqual({ ok: false, reason: "lemah" });
    expect(S().pinSet).toBe(false);
    expect(store.has("lock.pin.v1")).toBe(false);
  });

  it("cold start selalu terkunci; PIN benar membuka, salah tidak", async () => {
    await S().setupPin(PIN);
    await S().load(); // simulasi app dibuka ulang
    expect(S().pinSet).toBe(true);
    expect(S().locked).toBe(true);

    const salah = await S().verifyPin(SALAH);
    expect(salah).toMatchObject({ ok: false, reason: "salah" });
    expect(S().locked).toBe(true);

    expect(await S().verifyPin(PIN)).toEqual({ ok: true });
    expect(S().locked).toBe(false);
  });

  it("tanpa PIN: verifyPin ditolak (belum_ada); format salah ditolak sebelum dihitung", async () => {
    expect(await S().verifyPin(PIN)).toEqual({ ok: false, reason: "belum_ada" });
    await S().setupPin(PIN);
    expect(await S().verifyPin("12")).toEqual({ ok: false, reason: "format" });
    expect(S().salah).toBe(0);
  });
});

describe("percobaan salah: jeda, tersimpan, dan hapus data", () => {
  beforeEach(async () => { await S().setupPin(PIN); await S().load(); });

  it("salah 1–4 hanya memberi tahu sisa percobaan; ke-5 memicu jeda 30 detik", async () => {
    for (let i = 1; i <= 4; i++) {
      const r = await S().verifyPin(SALAH);
      expect(r).toMatchObject({ ok: false, reason: "salah", sisaPercobaan: 5 - i });
    }
    const kelima = await S().verifyPin(SALAH);
    expect(kelima).toMatchObject({ ok: false, reason: "jeda", sisaDetik: 30 });
  });

  it("selama jeda, PIN yang BENAR pun ditolak; setelah jeda lewat, PIN benar diterima dan hitungan direset", async () => {
    for (let i = 0; i < 5; i++) await S().verifyPin(SALAH);
    const dalamJeda = await S().verifyPin(PIN);
    expect(dalamJeda).toMatchObject({ ok: false, reason: "jeda" });
    expect(S().locked).toBe(true);
    maju(31_000);
    expect(await S().verifyPin(PIN)).toEqual({ ok: true });
    expect(S().salah).toBe(0);
    expect(S().sampaiMs).toBe(0);
  });

  it("hitungan salah bertahan setelah app ditutup dan dibuka lagi (tidak bisa direset dengan restart)", async () => {
    for (let i = 0; i < 3; i++) await S().verifyPin(SALAH);
    await S().load();
    expect(S().salah).toBe(3);
    const r = await S().verifyPin(SALAH); // ke-4
    expect(r).toMatchObject({ reason: "salah", sisaPercobaan: 1 });
    await S().load();
    const kelima = await S().verifyPin(SALAH);
    expect(kelima).toMatchObject({ reason: "jeda" });
    await S().load(); // buka ulang tepat saat masih dijeda
    expect(await S().verifyPin(PIN)).toMatchObject({ ok: false, reason: "jeda" });
  });

  it("ke-8 memicu jeda 5 menit; ke-10 menghapus PIN dan pengaturan (harus login ulang)", async () => {
    const hasil: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const r = await S().verifyPin(SALAH);
      hasil.push(!r.ok ? `${r.reason}${r.sisaDetik ? `:${r.sisaDetik}` : ""}` : "ok");
      maju(301_000); // menunggu jeda selesai agar percobaan berikutnya benar-benar dihitung
    }
    expect(hasil.slice(0, 4)).toEqual(["salah", "salah", "salah", "salah"]);
    expect(hasil[4]).toBe("jeda:30");
    expect(hasil[7]).toBe("jeda:300");
    expect(hasil[9]).toBe("hapus");
    expect(S().pinSet).toBe(false);
    expect(store.has("lock.pin.v1")).toBe(false);
    expect(store.has("lock.settings.v1")).toBe(false);
  });
});

describe("ubah PIN", () => {
  beforeEach(async () => { await S().setupPin(PIN); await S().load(); await S().verifyPin(PIN); });

  it("PIN lama salah ditolak; benar → PIN baru berlaku dan yang lama tidak lagi", async () => {
    expect(await S().changePin(SALAH, "246802")).toMatchObject({ ok: false, reason: "salah" });
    expect(await S().changePin(PIN, "246802")).toEqual({ ok: true });
    await S().load();
    expect(await S().verifyPin(PIN)).toMatchObject({ ok: false });
    expect(await S().verifyPin("246802")).toEqual({ ok: true });
  });

  it("PIN baru harus berbeda dan tidak lemah; tidak ada PIN mentah tersimpan", async () => {
    expect(await S().changePin(PIN, PIN)).toEqual({ ok: false, reason: "sama" });
    expect(await S().changePin(PIN, "000000")).toEqual({ ok: false, reason: "lemah" });
    await S().changePin(PIN, "246802");
    expect([...store.values()].join("|")).not.toContain("246802");
  });
});

describe("kunci otomatis saat app di latar belakang", () => {
  beforeEach(async () => { await S().setupPin(PIN); });

  it("kembali sebelum batas 2 menit → tetap terbuka; sesudahnya → terkunci", async () => {
    S().appToBackground();
    expect(S().cover).toBe(true); // isi langsung ditutup saat ke background
    maju(119_000);
    S().appToForeground();
    expect(S().locked).toBe(false);
    expect(S().cover).toBe(false);

    S().appToBackground();
    maju(121_000);
    S().appToForeground();
    expect(S().locked).toBe(true);
    expect(S().cover).toBe(false);
  });

  it("batas dapat diubah (Langsung / 30 dtk / 1 / 2 / 5 menit), tersimpan, dan nilai lain ditolak", async () => {
    await S().setTimeoutMs(0);
    S().appToBackground();
    S().appToForeground();
    expect(S().locked).toBe(true); // "langsung"

    await S().verifyPin(PIN);
    await S().setTimeoutMs(30_000);
    S().appToBackground(); maju(29_000); S().appToForeground();
    expect(S().locked).toBe(false);
    S().appToBackground(); maju(31_000); S().appToForeground();
    expect(S().locked).toBe(true);

    await S().setTimeoutMs(12345); // bukan pilihan
    expect(S().timeoutMs).toBe(30_000);
    await S().load();
    expect(S().timeoutMs).toBe(30_000); // tersimpan lintas buka-ulang
  });

  it("tanpa PIN tidak ada yang dikunci/ditutup; foreground tanpa background tidak mengubah apa pun", async () => {
    await S().reset();
    S().appToBackground();
    expect(S().cover).toBe(false);
    S().appToForeground();
    expect(S().locked).toBe(false);
  });

  it("sudah terkunci → tetap terkunci walau kembali cepat", async () => {
    S().lock();
    S().appToBackground(); maju(1000); S().appToForeground();
    expect(S().locked).toBe(true);
  });
});

describe("biometrik opsional dengan cadangan PIN", () => {
  beforeEach(async () => { await S().setupPin(PIN); await S().load(); await S().verifyPin(PIN); });

  it("aktif hanya setelah lolos biometrik sekali; tersimpan; bisa dimatikan", async () => {
    expect(await S().setBiometric(true)).toEqual({ ok: true });
    expect(S().biometricEnabled).toBe(true);
    await S().load();
    expect(S().biometricEnabled).toBe(true);
    await S().setBiometric(false);
    expect(S().biometricEnabled).toBe(false);
  });

  it("dibatalkan / gagal saat mengaktifkan → tidak aktif, pesan Indonesia", async () => {
    la.authenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" } as never);
    const r = await S().setBiometric(true);
    expect(r).toMatchObject({ ok: false, reason: "dibatalkan" });
    expect(S().biometricEnabled).toBe(false);
    if (!r.ok) expect(r.pesan).toMatch(/PIN/);
  });

  it("sensor tidak ada / belum ada sidik jari terdaftar → tidak bisa diaktifkan", async () => {
    la.isEnrolledAsync.mockResolvedValue(false);
    expect(await S().setBiometric(true)).toMatchObject({ ok: false, reason: "belum_terdaftar" });
    la.hasHardwareAsync.mockResolvedValue(false);
    expect(await S().setBiometric(true)).toMatchObject({ ok: false, reason: "tidak_tersedia" });
    expect(S().biometricEnabled).toBe(false);
  });

  it("membuka kunci dengan biometrik; kegagalan ke-3 mematikan biometrik sementara dan PIN tetap berfungsi", async () => {
    await S().setBiometric(true);
    S().lock();
    la.authenticateAsync.mockResolvedValue({ success: true } as never);
    expect(await S().unlockBiometric()).toEqual({ ok: true });
    expect(S().locked).toBe(false);

    S().lock();
    la.authenticateAsync.mockClear();
    la.authenticateAsync.mockResolvedValue({ success: false, error: "authentication_failed" } as never);
    for (let i = 0; i < 3; i++) expect(await S().unlockBiometric()).toMatchObject({ ok: false, reason: "gagal" });
    expect(S().biometrikGagal).toBe(3);
    expect(la.authenticateAsync).toHaveBeenCalledTimes(3);

    // Percobaan ke-4 tidak lagi memanggil sensor.
    const r = await S().unlockBiometric();
    expect(r).toMatchObject({ ok: false, reason: "tidak_tersedia" });
    expect(la.authenticateAsync).toHaveBeenCalledTimes(3);

    // Cadangan: PIN tetap bisa membuka, dan biometrik pulih.
    expect(await S().verifyPin(PIN)).toEqual({ ok: true });
    expect(S().locked).toBe(false);
    expect(S().biometrikGagal).toBe(0);
  });

  it("dibatalkan pengguna tidak dihitung sebagai gagal; lockout sistem dihitung dan berpesan Indonesia", async () => {
    await S().setBiometric(true);
    S().lock();
    la.authenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" } as never);
    await S().unlockBiometric();
    expect(S().biometrikGagal).toBe(0);
    la.authenticateAsync.mockResolvedValue({ success: false, error: "lockout" } as never);
    const r = await S().unlockBiometric();
    expect(r).toMatchObject({ ok: false, reason: "terkunci" });
    if (!r.ok) expect(r.pesan).toMatch(/terkunci sementara/i);
    expect(S().biometrikGagal).toBe(1);
  });

  it("biometrik aktif tapi sidik jari kemudian dihapus dari HP → otomatis tidak dipakai saat buka ulang", async () => {
    await S().setBiometric(true);
    la.isEnrolledAsync.mockResolvedValue(false);
    await S().load();
    expect(S().biometricEnabled).toBe(false);
    expect(S().biometricStatus).toBe("belum_terdaftar");
  });
});

describe("step-up untuk aksi sensitif", () => {
  beforeEach(async () => { await S().setupPin(PIN); });

  it("unlock terakhir < 2 menit → langsung lolos tanpa meminta lagi", async () => {
    maju(STEPUP_TTL_MS - 1000);
    expect(await S().requireStepUp()).toBe(true);
    expect(S().stepUpOpen).toBe(false);
  });

  it("lewat 2 menit → meminta konfirmasi; berhasil → true dan jendela baru dimulai", async () => {
    maju(STEPUP_TTL_MS + 1000);
    const p = S().requireStepUp();
    expect(S().stepUpOpen).toBe(true);
    S().resolveStepUp(true);
    expect(await p).toBe(true);
    expect(S().stepUpOpen).toBe(false);
    expect(await S().requireStepUp()).toBe(true); // masih dalam jendela baru
  });

  it("dibatalkan → false; beberapa pemanggil serempak berbagi satu permintaan", async () => {
    maju(STEPUP_TTL_MS + 1000);
    const a = S().requireStepUp();
    const b = S().requireStepUp();
    expect(a).toBe(b);
    S().resolveStepUp(false);
    expect(await a).toBe(false);
  });

  it("tanpa PIN, aksi sensitif tidak diizinkan; reset membatalkan permintaan yang menggantung", async () => {
    maju(STEPUP_TTL_MS + 1000);
    const p = S().requireStepUp();
    await S().reset();
    expect(await p).toBe(false);
    expect(await S().requireStepUp()).toBe(false);
  });
});

describe("reset (logout)", () => {
  it("menghapus PIN, pengaturan, dan hitungan salah dari penyimpanan aman", async () => {
    await S().setupPin(PIN);
    await S().setBiometric(true);
    await S().verifyPin(SALAH);
    await S().reset();
    expect([...store.keys()].filter((k) => k.startsWith("lock."))).toEqual([]);
    expect(S().pinSet).toBe(false);
    expect(S().biometricEnabled).toBe(false);
  });
});
