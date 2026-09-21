// S11 — Notifikasi: daftar putih tautan, flag OFF (tanpa izin/token/listener), izin kontekstual (bukan startup), pendaftaran token, kanal privat,
// dan layar preferensi per kategori menurut capability.

/* eslint-disable @typescript-eslint/no-require-imports */
import { adaTautanTertunda, ambilTautanTertunda, petaTautan } from "@/lib/tautan";

const mockNotif = {
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  addNotificationResponseReceivedListener: jest.fn(),
  AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
};
jest.mock("expo-notifications", () => mockNotif);
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.0.0", extra: { eas: { projectId: "pid" } } } }, ExecutionEnvironment: {} }));

const mockPerintah = jest.fn(async () => ({}));
jest.mock("@/auth/session", () => {
  const actual = jest.requireActual("@/auth/session");
  return { ...actual, api: { ...actual.api, command: (...a: unknown[]) => (mockPerintah as unknown as (...x: unknown[]) => unknown)(...a) } };
});
jest.mock("@/auth/storage", () => ({ ...jest.requireActual("@/auth/storage"), getDeviceId: async () => "dev-1" }));

beforeEach(() => {
  jest.clearAllMocks();
  mockNotif.getExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[abc]" });
});

describe("tautan dari notifikasi (daftar putih)", () => {
  it.each([
    [{ path: "/persetujuan/expense/abc-123" }, "/persetujuan/[jenis]/[id]"],
    [{ path: "/persetujuan/refund/x" }, "/persetujuan/[jenis]/[id]"],
    [{ path: "/pembayaran/p1" }, "/pembayaran/[id]"],
    [{ path: "/pembayaran" }, "/pembayaran"],
    [{ path: "/tx/pengeluaran/e1" }, "/tx/[modul]/[id]"],
    [{ path: "/tx/piutang" }, "/tx/[modul]"],
    [{ path: "/tx/tagihan" }, "/tx/[modul]"],
  ])("%j → dibuka", (data, pathname) => { expect(petaTautan(data)?.pathname).toBe(pathname); });

  it.each([
    null, undefined, "x", {}, { path: 5 }, { path: "" },
    { path: "/persetujuan/salah/1" }, { path: "/persetujuan/expense/../../keamanan" }, { path: "/persetujuan/expense/a b" },
    { path: "/tx/rahasia/1" }, { path: "//evil.example/x" }, { path: "https://evil.example" }, { path: "javascript:alert(1)" },
    { path: `/persetujuan/expense/${"a".repeat(65)}` }, { path: `/${"a".repeat(300)}` }, { url: "sanofinance://approval/expense/1" }, { path: "/login" }, { path: "/keamanan" },
  ])("%j → ditolak (tidak ada navigasi)", (data) => { expect(petaTautan(data)).toBeNull(); });

  it("tautan tertunda dibuka SEKALI", () => {
    const { tundaTautan } = jest.requireActual("@/lib/tautan") as typeof import("@/lib/tautan");
    tundaTautan({ pathname: "/pembayaran" });
    expect(adaTautanTertunda()).toBe(true);
    expect(ambilTautanTertunda()).toEqual({ pathname: "/pembayaran" });
    expect(adaTautanTertunda()).toBe(false);
    expect(ambilTautanTertunda()).toBeNull();
  });
});

function muatPush(pushEnabled: boolean) {
  jest.resetModules();
  jest.doMock("@/lib/env", () => ({ ENV: { appEnv: "production", useMocks: false, pushEnabled, readOnly: false, version: "1.0.0", apiUrl: "http://x/api", variant: "production" } }));
  return require("@/auth/push") as typeof import("@/auth/push");
}

describe("push — flag OFF (default v1 tanpa Firebase)", () => {
  it("tidak menyentuh izin, token, kanal, atau listener sama sekali", async () => {
    const p = muatPush(false);
    expect(p.pushTersedia()).toBe(false);
    expect(await p.segarkanTokenPush()).toBe("dilewati");
    expect(await p.aktifkanNotifikasi()).toBe("dilewati");
    expect(await p.statusIzin()).toBe("tidak_tersedia");
    p.pasangPendengarTautan()();
    expect(mockNotif.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mockNotif.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockNotif.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockNotif.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    expect(mockPerintah).not.toHaveBeenCalled();
  });
});

describe("push — flag ON", () => {
  it("startup/kembali ke aplikasi: izin BELUM ada → tidak ada dialog izin dan tidak ada token", async () => {
    mockNotif.getPermissionsAsync.mockResolvedValue({ status: "undetermined" });
    const p = muatPush(true);
    expect(await p.segarkanTokenPush()).toBe("dilewati");
    expect(mockNotif.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockPerintah).not.toHaveBeenCalled();
  });

  it("izin sudah ada: token disegarkan diam-diam (rotasi/pasang ulang) ke /mobile/devices", async () => {
    mockNotif.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    const p = muatPush(true);
    expect(await p.segarkanTokenPush()).toBe("ok");
    expect(mockNotif.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockPerintah).toHaveBeenCalledWith("POST", "/mobile/devices", expect.any(String), { body: expect.objectContaining({ deviceId: "dev-1", token: "ExponentPushToken[abc]", provider: "expo" }) });
  });

  it("aktifkan (tindakan pengguna): meminta izin lalu mendaftar; ditolak → tidak mendaftar", async () => {
    mockNotif.getPermissionsAsync.mockResolvedValue({ status: "undetermined" });
    mockNotif.requestPermissionsAsync.mockResolvedValue({ status: "denied" });
    let p = muatPush(true);
    expect(await p.aktifkanNotifikasi()).toBe("ditolak");
    expect(mockPerintah).not.toHaveBeenCalled();
    mockNotif.requestPermissionsAsync.mockResolvedValue({ status: "granted" });
    p = muatPush(true);
    expect(await p.aktifkanNotifikasi()).toBe("ok");
    expect(mockPerintah).toHaveBeenCalledTimes(1);
  });

  it("kanal Android privat di layar kunci", async () => {
    mockNotif.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    const p = muatPush(true);
    (require("react-native") as { Platform: { OS: string } }).Platform.OS = "android";
    await p.segarkanTokenPush();
    const kanal = mockNotif.setNotificationChannelAsync.mock.calls as unknown as [string, { lockscreenVisibility: number }][];
    expect(kanal.map((c) => c[0]).sort()).toEqual(["approval", "pembayaran", "pengingat", "sensitif"]);
    for (const [, opsi] of kanal) expect(opsi.lockscreenVisibility).toBe(0);
  });

  it("kegagalan (server/token) tidak melempar — aplikasi tidak boleh crash", async () => {
    mockNotif.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    mockNotif.getExpoPushTokenAsync.mockRejectedValue(new Error("Firebase belum dikonfigurasi"));
    const p = muatPush(true);
    await expect(p.segarkanTokenPush()).resolves.toBe("gagal");
    mockPerintah.mockRejectedValueOnce(new Error("jaringan"));
    mockNotif.getExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[abc]" });
    await expect(p.segarkanTokenPush()).resolves.toBe("gagal");
  });

  it("ketukan notifikasi: hanya path valid yang disimpan", () => {
    ambilTautanTertunda();
    let kirim: (r: unknown) => void = () => undefined;
    mockNotif.addNotificationResponseReceivedListener.mockImplementation((f: (r: unknown) => void) => { kirim = f; return { remove: jest.fn() }; });
    const p = muatPush(true);
    const lepas = p.pasangPendengarTautan();
    const { adaTautanTertunda: ada, ambilTautanTertunda: ambil } = require("@/lib/tautan") as typeof import("@/lib/tautan");
    kirim({ notification: { request: { content: { data: { path: "/keamanan" } } } } });
    expect(ada()).toBe(false);
    kirim({ notification: { request: { content: { data: { path: "/persetujuan/expense/e1" } } } } });
    expect(ambil()).toEqual({ pathname: "/persetujuan/[jenis]/[id]", params: { jenis: "expense", id: "e1" } });
    lepas();
  });
});
