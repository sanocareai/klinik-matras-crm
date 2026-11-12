import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { infoPerangkat, labelMetode, petakanGalat } from "@/auth/biometrik";
import { BATAS_BAWAAN_MS, TENGGANG_SETELAH_AUTENTIKASI_MS, perluDikunci, setJamUntukTes, useKeamanan } from "@/auth/keamanan";

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const la = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const S = () => useKeamanan.getState();
const KEY_KRED = "produksi.login-cepat.v1";
const KEY_SET = "produksi.keamanan.v1";

let t = 1_000_000;
const maju = (ms: number) => { t += ms; };
const berhasil = () => la.authenticateAsync.mockResolvedValue({ success: true } as never);
const gagalDengan = (error: string) => la.authenticateAsync.mockResolvedValue({ success: false, error } as never);

beforeEach(async () => {
  store.clear();
  t = 1_000_000;
  setJamUntukTes(() => t);
  la.getEnrolledLevelAsync.mockResolvedValue(3 as never);
  la.supportedAuthenticationTypesAsync.mockResolvedValue([1] as never);
  la.authenticateAsync.mockReset();
  berhasil();
  await S().reset();
  await S().muat();
});
afterAll(() => setJamUntukTes(null));

describe("kemampuan HP", () => {
  it("sidik jari / wajah / hanya PIN / tanpa kunci layar", async () => {
    expect(await infoPerangkat()).toEqual({ status: "tersedia", jenis: ["sidik_jari"] });
    expect(labelMetode({ status: "tersedia", jenis: ["sidik_jari"] })).toBe("sidik jari");
    expect(labelMetode({ status: "tersedia", jenis: ["wajah"] })).toBe("wajah");
    expect(labelMetode({ status: "tersedia", jenis: ["sidik_jari", "wajah"] })).toBe("sidik jari / wajah");
    la.getEnrolledLevelAsync.mockResolvedValue(1 as never);
    expect(await infoPerangkat()).toEqual({ status: "hanya_pin", jenis: [] });
    expect(labelMetode({ status: "hanya_pin", jenis: [] })).toBe("PIN HP");
    la.getEnrolledLevelAsync.mockResolvedValue(0 as never);
    expect((await infoPerangkat()).status).toBe("tidak_ada");
    la.getEnrolledLevelAsync.mockRejectedValue(new Error("x"));
    expect((await infoPerangkat()).status).toBe("tidak_ada");
  });
  it("galat sistem dipetakan ke pesan Bahasa Indonesia", () => {
    expect(petakanGalat("user_cancel")).toBe("dibatalkan");
    expect(petakanGalat("system_cancel")).toBe("dibatalkan");
    expect(petakanGalat("lockout")).toBe("terkunci");
    expect(petakanGalat("passcode_not_set")).toBe("tidak_tersedia");
    expect(petakanGalat("authentication_failed")).toBe("gagal");
    expect(petakanGalat(undefined)).toBe("gagal");
  });
  it("dialog sistem mengizinkan cadangan PIN/pola HP dan wajah kelas 'weak'", async () => {
    await S().buka();
    expect(la.authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({ disableDeviceFallback: false, biometricsSecurityLevel: "weak" }));
  });
});

describe("masuk cepat", () => {
  it("menyimpan WAJIB lolos autentikasi; dibatalkan = tidak tersimpan", async () => {
    gagalDengan("user_cancel");
    const r = await S().simpanLoginCepat("Imam@KlinikMatras.com ", "rahasia1");
    expect(r).toMatchObject({ ok: false, alasan: "dibatalkan" });
    expect(store.has(KEY_KRED)).toBe(false);
    expect(S().loginCepatEmail).toBeNull();
  });
  it("tersimpan di SecureStore; kata sandi TIDAK ada di pengaturan biasa; email dinormalkan", async () => {
    expect((await S().simpanLoginCepat("Imam@KlinikMatras.com ", "rahasia1")).ok).toBe(true);
    expect(JSON.parse(store.get(KEY_KRED)!)).toEqual({ email: "imam@klinikmatras.com", password: "rahasia1" });
    expect(store.get(KEY_SET)).not.toContain("rahasia1");
    expect(S().loginCepatEmail).toBe("imam@klinikmatras.com");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(KEY_KRED, expect.any(String), { keychainAccessible: "WHEN_UNLOCKED_THIS_DEVICE_ONLY" });
  });
  it("membaca kata sandi HANYA setelah lolos autentikasi", async () => {
    await S().simpanLoginCepat("imam@klinikmatras.com", "rahasia1");
    gagalDengan("authentication_failed");
    const gagal = await S().ambilLoginCepat();
    expect(gagal).toMatchObject({ ok: false });
    expect(JSON.stringify(gagal)).not.toContain("rahasia1");
    gagalDengan("user_cancel");
    expect(await S().ambilLoginCepat()).toMatchObject({ ok: false, dibatalkan: true });
    berhasil();
    expect(await S().ambilLoginCepat()).toEqual({ ok: true, email: "imam@klinikmatras.com", password: "rahasia1" });
  });
  it("belum aktif → tidak memunculkan dialog sama sekali", async () => {
    expect(await S().ambilLoginCepat()).toMatchObject({ ok: false });
    expect(la.authenticateAsync).not.toHaveBeenCalled();
  });
  it("tetap ada setelah aplikasi dibuka ulang; kata sandi baru diperbarui hanya untuk email yang sama", async () => {
    await S().simpanLoginCepat("imam@klinikmatras.com", "lama");
    await S().muat();
    expect(S().loginCepatEmail).toBe("imam@klinikmatras.com");
    await S().perbaruiSandiTersimpan("orang.lain@klinikmatras.com", "x");
    expect(JSON.parse(store.get(KEY_KRED)!).password).toBe("lama");
    await S().perbaruiSandiTersimpan("IMAM@klinikmatras.com", "baru");
    expect(JSON.parse(store.get(KEY_KRED)!).password).toBe("baru");
  });
  it("hapus → kredensial hilang dari penyimpanan", async () => {
    await S().simpanLoginCepat("imam@klinikmatras.com", "rahasia1");
    await S().hapusLoginCepat();
    expect(store.has(KEY_KRED)).toBe(false);
    expect(S().loginCepatEmail).toBeNull();
  });
  it("email terakhir diingat (bukan rahasia) untuk mengisi kolom login", async () => {
    await S().ingatEmail(" Ferdy@KlinikMatras.com");
    await S().muat();
    expect(S().emailTerakhir).toBe("ferdy@klinikmatras.com");
  });
});

describe("kunci aplikasi", () => {
  it("mati bawaan; menyalakan & mematikan wajib lolos autentikasi", async () => {
    expect(S().kunciAktif).toBe(false);
    expect(S().batasMs).toBe(BATAS_BAWAAN_MS);
    gagalDengan("user_cancel");
    await S().setKunci(true);
    expect(S().kunciAktif).toBe(false);
    berhasil();
    await S().setKunci(true);
    expect(S().kunciAktif).toBe(true);
    gagalDengan("authentication_failed");
    await S().setKunci(false);
    expect(S().kunciAktif).toBe(true);
  });
  it("dibuka dari nol → terkunci; buka berhasil → terbuka; gagal → tetap terkunci", async () => {
    await S().setKunci(true);
    await S().muat();
    expect(S().terkunci).toBe(true);
    gagalDengan("authentication_failed");
    expect((await S().buka()).ok).toBe(false);
    expect(S().terkunci).toBe(true);
    berhasil();
    expect((await S().buka()).ok).toBe(true);
    expect(S().terkunci).toBe(false);
  });
  it("HP kehilangan kunci layar → kunci dianggap mati (pengguna tidak terkurung)", async () => {
    await S().setKunci(true);
    la.getEnrolledLevelAsync.mockResolvedValue(0 as never);
    await S().muat();
    expect(S().kunciAktif).toBe(false);
    expect(S().terkunci).toBe(false);
  });
  it("latar belakang: layar ditutup; kembali sebelum batas → tidak terkunci; lewat batas → terkunci", async () => {
    await S().setKunci(true);
    maju(TENGGANG_SETELAH_AUTENTIKASI_MS + 1);
    await S().setBatas(60_000);
    S().keBelakang();
    expect(S().tutup).toBe(true);
    maju(59_000);
    S().keDepan();
    expect(S()).toMatchObject({ terkunci: false, tutup: false });
    S().keBelakang();
    maju(60_000);
    S().keDepan();
    expect(S().terkunci).toBe(true);
  });
  it("layar PIN HP / kamera yang membuka activity lain TIDAK memicu kunci berulang (tenggang setelah autentikasi)", async () => {
    await S().setKunci(true);
    await S().setBatas(60_000);
    let selesai: (v: unknown) => void = () => {};
    la.authenticateAsync.mockImplementation(() => new Promise((r) => { selesai = r; }) as never);
    S().lepasKunci();
    useKeamanan.setState({ terkunci: true });
    const sebelum = la.authenticateAsync.mock.calls.length;
    const p = S().buka();
    while (la.authenticateAsync.mock.calls.length === sebelum) await Promise.resolve(); // dialog sistem terbuka
    S().keBelakang(); // layar PIN HP terbuka
    maju(120_000); // lama mengetik PIN
    selesai({ success: true });
    await p;
    S().keDepan(); // kembali dari layar PIN
    expect(S()).toMatchObject({ terkunci: false, tutup: false });
    maju(TENGGANG_SETELAH_AUTENTIKASI_MS + 1);
    S().keBelakang();
    expect(S().tutup).toBe(true); // setelah tenggang, perilaku normal lagi
  });
  it("kunci mati → latar belakang tidak menutup layar", () => {
    S().keBelakang();
    expect(S().tutup).toBe(false);
  });
  it("aturan murni perluDikunci", () => {
    const d = { kunciAktif: true, sudahTerkunci: false, backgroundAt: 0, batasMs: 1000, kini: 999 };
    expect(perluDikunci(d)).toBe(false);
    expect(perluDikunci({ ...d, kini: 1000 })).toBe(true);
    expect(perluDikunci({ ...d, kunciAktif: false, kini: 9999 })).toBe(false);
    expect(perluDikunci({ ...d, sudahTerkunci: true })).toBe(true);
    expect(perluDikunci({ ...d, backgroundAt: null, kini: 9999 })).toBe(false);
  });
  it("batas di luar pilihan diabaikan", async () => {
    await S().setBatas(1234);
    expect(S().batasMs).toBe(BATAS_BAWAAN_MS);
  });
});
