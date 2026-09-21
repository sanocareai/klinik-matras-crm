import { ApiClient, type Tokens } from "@/api/client";
import { ApiError } from "@/api/errors";

type Balasan = { status: number; body?: unknown; headers?: Record<string, string> };

function fakeResponse({ status, body, headers = {} }: Balasan): Response {
  const teks = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status,
    text: async () => teks,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Response;
}

const TOKEN_A: Tokens = { accessToken: "A1", refreshToken: "R1", accessTokenExpiresAt: "2026-09-19T10:15:00Z", refreshTokenExpiresAt: "2026-10-03T10:00:00Z" };
const TOKEN_B: Tokens = { accessToken: "A2", refreshToken: "R2", accessTokenExpiresAt: "2026-09-19T10:30:00Z", refreshTokenExpiresAt: "2026-10-03T10:15:00Z" };

function buat(handler: (url: string, init: RequestInit) => Balasan | Promise<Balasan>) {
  let tokens: Tokens | null = TOKEN_A;
  const urutanSimpan: string[] = [];
  const hilang: string[] = [];
  const panggilan: { url: string; init: RequestInit }[] = [];
  let n = 0;
  const klien = new ApiClient({
    baseUrl: "https://x.test/api",
    getTokens: () => tokens,
    saveTokens: async (t) => { urutanSimpan.push(`simpan:${t.refreshToken}`); tokens = t; },
    onSessionLost: (r) => { hilang.push(r); },
    newId: () => `req-${++n}`,
    device: () => ({ id: "dev-1", appVersion: "0.1.0" }),
    fetchImpl: (async (url: string, init: RequestInit) => {
      panggilan.push({ url, init });
      return fakeResponse(await handler(url, init));
    }) as unknown as typeof fetch,
  });
  return { klien, panggilan, urutanSimpan, hilang, getTokens: () => tokens };
}

describe("ApiClient", () => {
  it("wajibHttps: baseUrl HTTP polos diblokir SEBELUM ada permintaan (preview/production)", async () => {
    const fetchImpl = jest.fn();
    const klien = new ApiClient({ baseUrl: "http://x.test/api", wajibHttps: true, getTokens: () => TOKEN_A, saveTokens: async () => undefined, onSessionLost: () => undefined, newId: () => "id", device: () => ({ id: "d", appVersion: "1" }), fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(klien.get("/finance/x")).rejects.toMatchObject({ code: "HTTPS_WAJIB" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("GET: Bearer + X-Request-Id; uang di respons menjadi string desimal", async () => {
    const { klien, panggilan } = buat(() => ({ status: 200, body: { totalKas: 1250000.5 } }));
    const r = await klien.get<{ totalKas: string }>("/finance/dashboard", { query: { from: "2026-09-01", to: "2026-09-30" } });
    expect(r.totalKas).toBe("1250000.50");
    const h = panggilan[0]?.init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer A1");
    expect(h["X-Request-Id"]).toBe("req-1");
    expect(panggilan[0]?.url).toBe("https://x.test/api/finance/dashboard?from=2026-09-01&to=2026-09-30");
  });

  it("command WAJIB Idempotency-Key dan mengirim kunci itu di header", async () => {
    const { klien, panggilan } = buat(() => ({ status: 201, body: { id: "x" } }));
    expect(() => klien.command("POST", "/finance/expenses", "")).toThrow(/Idempotency-Key/);
    await klien.command("POST", "/finance/expenses", "kunci-123456", { body: { amount: "50000.00" } });
    const h = panggilan[0]?.init.headers as Record<string, string>;
    expect(h["Idempotency-Key"]).toBe("kunci-123456");
    expect(h["Content-Type"]).toBe("application/json");
    expect(panggilan[0]?.init.body).toBe('{"amount":"50000.00"}'); // uang dikirim sebagai string
  });

  it("401 TOKEN_INVALID → refresh sekali, token baru DISIMPAN sebelum dipakai, permintaan diulang dengan kunci sama", async () => {
    let refreshDipanggil = 0;
    const { klien, panggilan, urutanSimpan } = buat((url, init) => {
      if (url.endsWith("/mobile/auth/refresh")) { refreshDipanggil++; return { status: 200, body: { ...TOKEN_B } }; }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer A1" ? { status: 401, body: { error: "Sesi tidak valid", code: "TOKEN_INVALID" } } : { status: 201, body: { ok: true } };
    });
    const r = await klien.command<{ ok: boolean }>("POST", "/finance/transfers", "kunci-abcdef01", { body: {} });
    expect(r.ok).toBe(true);
    expect(refreshDipanggil).toBe(1);
    expect(urutanSimpan).toEqual(["simpan:R2"]);
    const ulang = panggilan[panggilan.length - 1]?.init.headers as Record<string, string>;
    expect(ulang.Authorization).toBe("Bearer A2");
    expect(ulang["Idempotency-Key"]).toBe("kunci-abcdef01");
  });

  it("refresh SINGLE-FLIGHT: 5 request paralel yang kedaluwarsa hanya memicu satu refresh", async () => {
    let refresh = 0;
    const { klien } = buat(async (url, init) => {
      if (url.endsWith("/mobile/auth/refresh")) {
        refresh++;
        await new Promise((res) => setTimeout(res, 20));
        return { status: 200, body: { ...TOKEN_B } };
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer A1" ? { status: 401, body: { error: "x", code: "TOKEN_INVALID" } } : { status: 200, body: { ok: 1 } };
    });
    const hasil = await Promise.all([1, 2, 3, 4, 5].map((i) => klien.get(`/finance/x${i}`)));
    expect(hasil).toHaveLength(5);
    expect(refresh).toBe(1);
  });

  it("sesi dicabut / refresh dipakai ulang → onSessionLost dan galat berkode", async () => {
    const a = buat(() => ({ status: 401, body: { error: "Sesi dicabut", code: "SESSION_REVOKED" } }));
    await expect(a.klien.get("/finance/dashboard")).rejects.toMatchObject({ code: "SESSION_REVOKED", status: 401 });
    expect(a.hilang).toEqual(["SESSION_REVOKED"]);

    const b = buat((url) => (url.endsWith("/refresh")
      ? { status: 401, body: { error: "dipakai ulang", code: "REFRESH_REUSED" } }
      : { status: 401, body: { error: "x", code: "TOKEN_INVALID" } }));
    await expect(b.klien.get("/finance/dashboard")).rejects.toMatchObject({ code: "REFRESH_REUSED" });
    expect(b.hilang).toContain("REFRESH_REUSED");
  });

  it("pesan galat server ditampilkan apa adanya; 409/403/429 membawa info", async () => {
    const { klien } = buat(() => ({ status: 429, body: { error: "Terlalu banyak percobaan.", code: "RATE_LIMITED" }, headers: { "retry-after": "42" } }));
    const e = (await klien.get("/x").catch((x: unknown) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe("Terlalu banyak percobaan.");
    expect(e.retryAfterSeconds).toBe(42);

    const k = buat(() => ({ status: 409, body: { error: "Sudah berstatus DISETUJUI" } }));
    const c = (await k.klien.command("POST", "/finance/expenses/1/approve", "kunci-zzzzzz1").catch((x: unknown) => x)) as ApiError;
    expect(c.isConflict).toBe(true);
    expect(c.message).toBe("Sudah berstatus DISETUJUI");
  });

  it("jaringan putus: GET → NETWORK biasa; COMMAND → tidakPasti=true (jangan kirim ulang buta)", async () => {
    const klien = new ApiClient({
      baseUrl: "https://x.test/api", getTokens: () => TOKEN_A, saveTokens: async () => {}, onSessionLost: () => {},
      newId: () => "id", device: () => ({ id: "d", appVersion: "1" }),
      fetchImpl: (async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch,
    });
    const g = (await klien.get("/x").catch((x: unknown) => x)) as ApiError;
    expect(g.code).toBe("NETWORK");
    expect(g.tidakPasti).toBe(false);
    const c = (await klien.command("POST", "/finance/expenses", "kunci-tidakpasti").catch((x: unknown) => x)) as ApiError;
    expect(c.isNetwork).toBe(true);
    expect(c.tidakPasti).toBe(true);
    expect(c.message).toMatch(/belum pasti/i);
  });

  it("respons non-JSON pada sukses → galat PARSE, bukan crash", async () => {
    const { klien } = buat(() => ({ status: 200, body: "<html>bukan json</html>" }));
    await expect(klien.get("/x")).rejects.toMatchObject({ code: "PARSE" });
  });

  it("tanpa token: tidak mengirim Authorization; login memakai auth:false", async () => {
    const { klien, panggilan } = buat(() => ({ status: 200, body: { ok: true } }));
    await klien.get("/mobile/config", { auth: false });
    const h = panggilan[0]?.init.headers as Record<string, string>;
    expect(h.Authorization).toBeUndefined();
  });
});
