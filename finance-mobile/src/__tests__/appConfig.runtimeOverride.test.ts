// Regression guard untuk jalur TRANSISI OTA runtimeVersion (lihat app.config.ts §EAS_UPDATE_RUNTIME_OVERRIDE
// dan docs/OTA-RUNTIME-TRANSITION.md). Mengevaluasi app.config.ts LANGSUNG (bukan mock) dengan berbagai
// kombinasi env — supaya perubahan pada mekanisme override ini selalu ketahuan lewat `npm run check`,
// bukan cuma lewat baca kode manual sebelum tiap `eas update`.

import fs from "node:fs";
import path from "node:path";

type Env = Record<string, string | undefined>;

/** Jalankan `fn()` dengan env sementara (APP_VARIANT="production" sebagai dasar, bisa ditimpa), lalu pulihkan. Modul di-reset supaya konstanta level-modul app.config.ts dibaca ulang. */
function withEnv<T>(env: Env, fn: () => T): T {
  const asli = { ...process.env };
  for (const [k, v] of Object.entries({ APP_VARIANT: "production", ...env })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    jest.resetModules();
    return fn();
  } finally {
    process.env = asli;
  }
}

function muatConfig(env: Env = {}): ReturnType<typeof import("../../app.config").default> {
  return withEnv(env, () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- muat ulang modul SETELAH jest.resetModules(), butuh require, bukan import statis (yang di-hoist).
    const mod = require("../../app.config");
    return mod.default({ config: {} });
  });
}

describe("app.config.ts — jalur transisi OTA runtimeVersion (EAS_UPDATE_RUNTIME_OVERRIDE)", () => {
  it("default (tanpa env override): runtimeVersion ikut kebijakan appVersion; version tetap 1.1.0", () => {
    const c = muatConfig();
    expect(c.version).toBe("1.1.0");
    expect(c.runtimeVersion).toEqual({ policy: "appVersion" });
  });

  it("tidak aktif kalau env eksplisit undefined — sama persis dengan tanpa env sama sekali", () => {
    const c = muatConfig({ EAS_UPDATE_RUNTIME_OVERRIDE: undefined });
    expect(c.runtimeVersion).toEqual({ policy: "appVersion" });
  });

  it("tidak aktif kalau env string kosong", () => {
    const c = muatConfig({ EAS_UPDATE_RUNTIME_OVERRIDE: "" });
    expect(c.runtimeVersion).toEqual({ policy: "appVersion" });
  });

  it("override valid (1.0.0): runtimeVersion jadi string literal '1.0.0'; `version` (nama/label rilis) TETAP 1.1.0, tidak ikut berubah", () => {
    const c = muatConfig({ EAS_UPDATE_RUNTIME_OVERRIDE: "1.0.0" });
    expect(c.runtimeVersion).toBe("1.0.0");
    expect(c.version).toBe("1.1.0");
  });

  it("hanya menerima format x.y.z angka murni — bentuk lain diabaikan (fallback diam-diam ke appVersion, TIDAK melempar)", () => {
    const takSah = ["1.0", "1.0.0.0", "1.0.0-beta", "v1.0.0", "abc", " 1.0.0", "1.0.0 ", "1.a.0", "1.0.0\n"];
    for (const nilai of takSah) {
      expect(() => muatConfig({ EAS_UPDATE_RUNTIME_OVERRIDE: nilai })).not.toThrow();
      const c = muatConfig({ EAS_UPDATE_RUNTIME_OVERRIDE: nilai });
      expect(c.runtimeVersion).toEqual({ policy: "appVersion" });
    }
  });

  it("override TIDAK BISA mengubah package, plugin, permission, URL update (proyek EAS), atau extra — hanya field runtimeVersion yang boleh berbeda", () => {
    const dasar = muatConfig();
    const override = muatConfig({ EAS_UPDATE_RUNTIME_OVERRIDE: "1.0.0" });
    const { runtimeVersion: _a, ...sisaDasar } = dasar;
    const { runtimeVersion: _b, ...sisaOverride } = override;
    expect(sisaOverride).toEqual(sisaDasar);
  });

  it("package produksi tetap com.sanomatrassehat.finance (tanpa suffix) walau override aktif", () => {
    const c = muatConfig({ EAS_UPDATE_RUNTIME_OVERRIDE: "1.0.0" });
    expect(c.android?.package).toBe("com.sanomatrassehat.finance");
  });

  it("push tetap OFF (permission notifikasi/boot diblokir) walau override runtime aktif", () => {
    const c = muatConfig({ EAS_UPDATE_RUNTIME_OVERRIDE: "1.0.0" });
    expect(c.android?.blockedPermissions).toEqual(
      expect.arrayContaining(["android.permission.POST_NOTIFICATIONS", "android.permission.RECEIVE_BOOT_COMPLETED"]),
    );
  });

  it("URL EAS Update (proyek) tidak berubah oleh override runtime", () => {
    const dasar = muatConfig();
    const override = muatConfig({ EAS_UPDATE_RUNTIME_OVERRIDE: "1.0.0" });
    expect(override.updates).toEqual(dasar.updates);
  });
});

describe("eas.json — channel & API produksi tidak tersentuh oleh mekanisme override (statis, bukan lewat app.config.ts)", () => {
  const easJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../../eas.json"), "utf8"));

  it("EAS_UPDATE_RUNTIME_OVERRIDE tidak di-set di profil build/update manapun — override TIDAK PERNAH aktif secara default", () => {
    const seluruhIsi = JSON.stringify(easJson);
    expect(seluruhIsi).not.toContain("EAS_UPDATE_RUNTIME_OVERRIDE");
  });

  it("profil production tetap channel 'production' dan API HTTPS produksi", () => {
    expect(easJson.build.production.channel).toBe("production");
    expect(easJson.build.production.env.EXPO_PUBLIC_API_URL).toBe("https://app.sanomatrassehat.com/api");
    expect(easJson.build.production.env.EXPO_PUBLIC_PUSH_ENABLED).toBe("false");
  });
});
