import { ApiClient, type Tokens } from "@/api/client";
import { ApiError } from "@/api/errors";

const T0: Tokens = { accessToken: "lama", refreshToken: "smr_lama", accessTokenExpiresAt: "", refreshTokenExpiresAt: "" };

function jawab(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), headers: { get: () => null } } as unknown as Response;
}

function buat(fetchImpl: jest.Mock, opsi: { https?: boolean } = {}) {
  let tokens: Tokens | null = { ...T0 };
  const hilang = jest.fn();
  const client = new ApiClient({
    baseUrl: opsi.https ? "https://x/api" : "http://x/api",
    wajibHttps: opsi.https === false ? true : false,
    getTokens: () => tokens,
    saveTokens: async (t) => { tokens = t; },
    onSessionLost: hilang,
    newId: () => "id",
    device: () => ({ id: "dev", appVersion: "0.1.0" }),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, hilang, tokens: () => tokens };
}

test("token kedaluwarsa → refresh SEKALI dengan app=production lalu permintaan diulang dengan token baru", async () => {
  const f = jest.fn()
    .mockResolvedValueOnce(jawab(401, { error: "x", code: "TOKEN_INVALID" }))
    .mockResolvedValueOnce(jawab(200, { accessToken: "baru", refreshToken: "smr_baru", accessTokenExpiresAt: "", refreshTokenExpiresAt: "" }))
    .mockResolvedValueOnce(jawab(200, { ok: true }));
  const { client, tokens } = buat(f);
  await expect(client.get("/production-v2/andon")).resolves.toEqual({ ok: true });
  const [urlRefresh, initRefresh] = f.mock.calls[1]!;
  expect(urlRefresh).toBe("http://x/api/mobile/auth/refresh");
  expect(JSON.parse(initRefresh.body)).toMatchObject({ refreshToken: "smr_lama", app: "production" });
  expect(f.mock.calls[2]![1].headers.Authorization).toBe("Bearer baru");
  expect(tokens()?.refreshToken).toBe("smr_baru");
});

test("sesi dicabut → onSessionLost dipanggil dengan kodenya", async () => {
  const f = jest.fn().mockResolvedValueOnce(jawab(401, { error: "dicabut", code: "SESSION_REVOKED" }));
  const { client, hilang } = buat(f);
  await expect(client.get("/production-v2/andon")).rejects.toBeInstanceOf(ApiError);
  expect(hilang).toHaveBeenCalledWith("SESSION_REVOKED");
});

test("perintah membawa Idempotency-Key; putus jaringan pada perintah = tidakPasti", async () => {
  const f = jest.fn().mockRejectedValueOnce(new Error("putus"));
  const { client } = buat(f);
  const e = (await client.command("POST", "/x", "kunci-1", { body: {} }).catch((x: unknown) => x)) as ApiError;
  expect(e).toBeInstanceOf(ApiError);
  expect(e.tidakPasti).toBe(true);
  expect(f.mock.calls[0]![1].headers["Idempotency-Key"]).toBe("kunci-1");
});

test("HTTPS wajib di luar development", async () => {
  const f = jest.fn();
  const { client } = buat(f, { https: false });
  await expect(client.get("/x")).rejects.toMatchObject({ code: "HTTPS_WAJIB" });
  expect(f).not.toHaveBeenCalled();
});
