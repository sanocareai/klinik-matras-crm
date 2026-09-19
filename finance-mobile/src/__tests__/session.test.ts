import * as SecureStore from "expo-secure-store";
import type { Capabilities } from "@/api/types";
import { api, useSession } from "@/auth/session";
import { useLock } from "@/auth/lock";

// Mode server nyata: `useMocks=false`, fetch diganti fake.
jest.mock("@/lib/env", () => ({
  ENV: { appEnv: "production", apiUrl: "https://app.test/api", useMocks: false, variant: "production", version: "1.0.0" },
}));
jest.mock("expo-device", () => ({ modelName: "Pixel Uji" }));


const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const CAPS_FINANCE: Capabilities = {
  financeRead: true, financePost: true, financeApprove: true, financeAdmin: false,
  paymentRead: true, paymentWrite: true, expenseSubmit: true, financeApp: true, preset: "FINANCE",
};
const CAPS_SALES: Capabilities = { ...CAPS_FINANCE, financeRead: false, financePost: false, financeApprove: false, paymentWrite: false, financeApp: false, preset: "NONE" };
const USER = { id: "u1", name: "Natasha", role: "FINANCE", roles: ["FINANCE"], avatarUrl: null };

const tok = (n: number) => ({
  accessToken: `access-${n}`, refreshToken: `smr_refresh_${n}_abcdefghijk`,
  accessTokenExpiresAt: "2026-09-19T10:15:00Z", refreshTokenExpiresAt: "2026-10-19T10:00:00Z",
});

type Panggilan = { url: string; method: string; headers: Record<string, string>; body: unknown };
let panggilan: Panggilan[] = [];
let penangan: (p: Panggilan) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

function fakeFetch(): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const p: Panggilan = {
      url: String(url), method: String(init.method), headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    panggilan.push(p);
    const r = await penangan(p);
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status,
      text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)),
      headers: { get: () => null },
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(async () => {
  store.clear();
  panggilan = [];
  penangan = () => ({ status: 500 });
  global.fetch = fakeFetch();
  await useLock.getState().reset();
  await useSession.getState().logout();
  panggilan = [];
  useSession.setState({ sesiHilang: null });
});

const S = () => useSession.getState();
const rutePanggil = (frag: string) => panggilan.filter((p) => p.url.includes(frag));

describe("login", () => {
  it("sukses: token disimpan di SecureStore (bukan di tempat lain), capabilities dari server, ID perangkat dikirim", async () => {
    penangan = () => ({ status: 200, body: { ...tok(1), user: USER, capabilities: CAPS_FINANCE } });
    await S().login("  natasha@klinikmatras.com ", "rahasia123");
    expect(S().status).toBe("signedIn");
    expect(S().capabilities?.financeApp).toBe(true);
    expect(S().user?.name).toBe("Natasha");
    const kirim = panggilan[0]!;
    expect(kirim.url).toBe("https://app.test/api/mobile/auth/login");
    expect(kirim.headers["Idempotency-Key"]).toBeTruthy();
    expect(kirim.headers.Authorization).toBeUndefined();
    const b = kirim.body as { email: string; device: { id: string; platform: string } };
    expect(b.email).toBe("natasha@klinikmatras.com");
    expect(b.device.id).toBeTruthy();
    expect(b.device.platform).toBe("android");
    const tersimpan = JSON.parse(store.get("session.v1") as string) as { tokens: { refreshToken: string } };
    expect(tersimpan.tokens.refreshToken).toBe(tok(1).refreshToken);
  });

  it("akun tanpa akses Finance ditolak dan TIDAK ada token yang tersimpan", async () => {
    penangan = () => ({ status: 200, body: { ...tok(1), user: USER, capabilities: CAPS_SALES } });
    await expect(S().login("sales@klinikmatras.com", "x")).rejects.toMatchObject({ code: "NOT_FINANCE_TEAM" });
    expect(S().status).not.toBe("signedIn");
    expect(store.has("session.v1")).toBe(false);
  });

  it("kata sandi salah (401) → galat dari server diteruskan, tetap keluar", async () => {
    penangan = () => ({ status: 401, body: { error: "Email atau kata sandi salah", code: "INVALID_CREDENTIALS" } });
    await expect(S().login("a@b.c", "salah")).rejects.toMatchObject({ status: 401 });
    expect(S().status).not.toBe("signedIn");
  });

  it("dibatasi laju (429) → galat berkode RATE_LIMITED", async () => {
    penangan = () => ({ status: 429, body: { error: "Terlalu banyak percobaan", code: "RATE_LIMITED" } });
    await expect(S().login("a@b.c", "x")).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });

  it("jaringan putus → galat jaringan, bukan sesi rusak", async () => {
    global.fetch = (async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch;
    await expect(S().login("a@b.c", "x")).rejects.toMatchObject({ code: "NETWORK" });
    expect(S().status).not.toBe("signedIn");
  });
});

describe("pulihkan sesi & role dari /auth/me", () => {
  async function masuk() {
    penangan = () => ({ status: 200, body: { ...tok(1), user: USER, capabilities: CAPS_FINANCE } });
    await S().login("natasha@klinikmatras.com", "x");
    panggilan = [];
  }

  it("restore memuat sesi tersimpan lalu menyegarkan capabilities dari server", async () => {
    await masuk();
    useSession.setState({ status: "loading", user: null, capabilities: null });
    penangan = (p) => p.url.endsWith("/auth/me")
      ? { status: 200, body: { ...USER, capabilities: { ...CAPS_FINANCE, financeApprove: false, preset: "ACCOUNTANT" } } }
      : { status: 500 };
    await S().restore();
    expect(S().status).toBe("signedIn");
    await S().refreshMe();
    expect(S().capabilities?.preset).toBe("ACCOUNTANT");
    expect(S().capabilities?.financeApprove).toBe(false);
    const me = rutePanggil("/auth/me")[0]!;
    expect(me.headers.Authorization).toBe(`Bearer ${tok(1).accessToken}`);
  });

  it("tanpa sesi tersimpan → signedOut", async () => {
    await S().restore();
    expect(S().status).toBe("signedOut");
  });

  it("server bilang tidak lagi tim Finance → keluar otomatis dan alasan dicatat", async () => {
    await masuk();
    penangan = (p) => p.url.endsWith("/auth/me")
      ? { status: 200, body: { ...USER, capabilities: CAPS_SALES } }
      : { status: 200, body: { ok: true } };
    await S().refreshMe();
    expect(S().status).toBe("signedOut");
    expect(S().sesiHilang).toBe("NOT_FINANCE_TEAM");
    expect(store.has("session.v1")).toBe(false);
  });

  it("offline saat refreshMe → tetap masuk dengan capabilities tersimpan", async () => {
    await masuk();
    global.fetch = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    await S().refreshMe();
    expect(S().status).toBe("signedIn");
    expect(S().capabilities?.financeApp).toBe(true);
  });

  it("sesi dicabut di server (401 SESSION_REVOKED) → kembali ke login dengan alasan", async () => {
    await masuk();
    penangan = () => ({ status: 401, body: { error: "Sesi dicabut", code: "SESSION_REVOKED" } });
    await S().refreshMe();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(S().status).toBe("signedOut");
    expect(S().sesiHilang).toBe("SESSION_REVOKED");
    expect(store.has("session.v1")).toBe(false);
  });
});

describe("refresh token: rotasi & single-flight", () => {
  it("token kedaluwarsa → refresh SEKALI untuk banyak permintaan paralel; token baru tersimpan sebelum dipakai", async () => {
    penangan = () => ({ status: 200, body: { ...tok(1), user: USER, capabilities: CAPS_FINANCE } });
    await S().login("natasha@klinikmatras.com", "x");
    panggilan = [];
    let refreshCount = 0;
    penangan = async (p) => {
      if (p.url.endsWith("/mobile/auth/refresh")) {
        refreshCount++;
        await new Promise((r) => setTimeout(r, 5));
        return { status: 200, body: tok(2) };
      }
      if (p.headers.Authorization === `Bearer ${tok(1).accessToken}`) return { status: 401, body: { error: "Token kedaluwarsa", code: "TOKEN_INVALID" } };
      return { status: 200, body: { ok: p.url } };
    };
    const hasil = await Promise.all([api.get("/finance/a"), api.get("/finance/b"), api.get("/finance/c")]);
    expect(hasil).toHaveLength(3);
    expect(refreshCount).toBe(1);
    const tersimpan = JSON.parse(store.get("session.v1") as string) as { tokens: { refreshToken: string; accessToken: string } };
    expect(tersimpan.tokens.refreshToken).toBe(tok(2).refreshToken);
    expect(tersimpan.tokens.accessToken).toBe(tok(2).accessToken);
    const ulang = panggilan.filter((p) => p.url.includes("/finance/") && p.headers.Authorization === `Bearer ${tok(2).accessToken}`);
    expect(ulang).toHaveLength(3);
  });

  it("refresh token dipakai ulang / dicabut (REFRESH_REUSED) → sesi berakhir, token lokal terhapus", async () => {
    penangan = () => ({ status: 200, body: { ...tok(1), user: USER, capabilities: CAPS_FINANCE } });
    await S().login("natasha@klinikmatras.com", "x");
    penangan = (p) => p.url.endsWith("/mobile/auth/refresh")
      ? { status: 401, body: { error: "Sesi dicabut", code: "REFRESH_REUSED" } }
      : p.url.endsWith("/mobile/auth/logout") ? { status: 200, body: { ok: true } }
      : { status: 401, body: { error: "Token kedaluwarsa", code: "TOKEN_INVALID" } };
    await expect(api.get("/finance/x")).rejects.toMatchObject({ code: "REFRESH_REUSED" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(S().status).toBe("signedOut");
    expect(S().sesiHilang).toBe("REFRESH_REUSED");
    expect(store.has("session.v1")).toBe(false);
  });
});

describe("logout", () => {
  it("mencabut sesi di server dengan refresh token, menghapus token, PIN, dan pengaturan kunci lokal", async () => {
    penangan = () => ({ status: 200, body: { ...tok(1), user: USER, capabilities: CAPS_FINANCE } });
    await S().login("natasha@klinikmatras.com", "x");
    await useLock.getState().setupPin("482913");
    expect([...store.keys()].some((k) => k.startsWith("lock."))).toBe(true);
    panggilan = [];
    penangan = () => ({ status: 200, body: { ok: true } });
    await S().logout();
    const cabut = rutePanggil("/mobile/auth/logout");
    expect(cabut).toHaveLength(1);
    expect((cabut[0]!.body as { refreshToken: string }).refreshToken).toBe(tok(1).refreshToken);
    expect(cabut[0]!.headers.Authorization).toBeUndefined();
    expect(S().status).toBe("signedOut");
    expect(S().user).toBeNull();
    expect(S().capabilities).toBeNull();
    expect(store.has("session.v1")).toBe(false);
    expect([...store.keys()].filter((k) => k.startsWith("lock."))).toEqual([]);
    expect(useLock.getState().pinSet).toBe(false);
  });

  it("server tak terjangkau saat logout → tetap keluar secara lokal", async () => {
    penangan = () => ({ status: 200, body: { ...tok(1), user: USER, capabilities: CAPS_FINANCE } });
    await S().login("natasha@klinikmatras.com", "x");
    global.fetch = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    await S().logout();
    expect(S().status).toBe("signedOut");
    expect(store.has("session.v1")).toBe(false);
  });

  it("token/PIN tidak pernah tampil di log saat alur login–logout", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    penangan = () => ({ status: 200, body: { ...tok(1), user: USER, capabilities: CAPS_FINANCE } });
    await S().login("natasha@klinikmatras.com", "kataSandiRahasia");
    await useLock.getState().setupPin("482913");
    await S().logout();
    const semua = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const rahasia of [tok(1).accessToken, tok(1).refreshToken, "kataSandiRahasia", "482913"]) expect(semua).not.toContain(rahasia);
    spies.forEach((s) => s.mockRestore());
  });
});
