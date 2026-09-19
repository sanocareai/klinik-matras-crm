import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { autentikasiBiometrik, statusBiometrik, type BiometricResult, type BiometricStatus } from "./biometric";
import { buatVerifier, cekPin, jedaSetelahSalah, pinLemah, pinValid, type PinVerifier } from "./pin";

// KUNCI APLIKASI (PIN 6 digit + biometrik opsional) — PRD §11.4/§11.5.
//   • Cold start selalu terkunci (bila PIN sudah dibuat).
//   • Ke background lebih lama dari batas (default 2 menit) → terkunci saat kembali.
//   • Saat ke background, isi layar langsung ditutup (`cover`) sebelum sistem mengambil cuplikan.
//   • Percobaan salah tersimpan (tidak reset dengan menutup app): 5 → jeda 30 dtk, 8 → 5 mnt, 10 → hapus data.
//   • Step-up: aksi sensitif meminta autentikasi ulang bila unlock terakhir > 2 menit.
// PIN TIDAK PERNAH disimpan mentah: hanya verifier PBKDF2 di SecureStore. Verifier disimpan di variabel modul,
// bukan di state (tidak ikut terekspos ke komponen).

export const TIMEOUT_DEFAULT_MS = 120_000;
export const TIMEOUT_PILIHAN: { ms: number; label: string }[] = [
  { ms: 0, label: "Langsung" },
  { ms: 30_000, label: "30 detik" },
  { ms: 60_000, label: "1 menit" },
  { ms: 120_000, label: "2 menit" },
  { ms: 300_000, label: "5 menit" },
];
export const STEPUP_TTL_MS = 120_000;
export const BIOMETRIK_MAKS_GAGAL = 3;

const OPSI: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const KEY_PIN = "lock.pin.v1";
const KEY_SET = "lock.settings.v1";
const KEY_ATT = "lock.attempts.v1";

let sekarang = () => Date.now();
/** Ganti jam — hanya untuk tes. */
export function setClockForTests(fn: (() => number) | null) { sekarang = fn ?? (() => Date.now()); }

/** Detik tersisa pada jeda percobaan salah (0 bila tidak sedang dijeda). Memakai jam yang sama dengan store. */
export function sisaJedaDetik(sampaiMs: number): number {
  return Math.max(0, Math.ceil((sampaiMs - sekarang()) / 1000));
}

let verifier: PinVerifier | null = null;
let stepUpResolver: ((ok: boolean) => void) | null = null;
let stepUpPromise: Promise<boolean> | null = null;

export type PinResult =
  | { ok: true }
  | { ok: false; reason: "salah" | "jeda" | "hapus" | "belum_ada" | "format" | "lemah" | "sama"; sisaDetik?: number; sisaPercobaan?: number };

type LockState = {
  ready: boolean;
  pinSet: boolean;
  locked: boolean;
  /** Layar ditutup sementara (app di background) supaya isi tidak terlihat di Recents/saat kembali. */
  cover: boolean;
  timeoutMs: number;
  biometricEnabled: boolean;
  biometricStatus: BiometricStatus;
  biometrikGagal: number;
  salah: number;
  sampaiMs: number;
  lastUnlockAt: number;
  backgroundAt: number | null;
  stepUpOpen: boolean;
  /** true dari PIN dibuat sampai pengguna menutup langkah tawaran biometrik (alur pengaturan awal). */
  setupBaru: boolean;

  load: () => Promise<void>;
  setupPin: (pin: string) => Promise<PinResult>;
  verifyPin: (pin: string) => Promise<PinResult>;
  changePin: (lama: string, baru: string) => Promise<PinResult>;
  unlockBiometric: () => Promise<BiometricResult>;
  setBiometric: (aktif: boolean) => Promise<BiometricResult>;
  refreshBiometric: () => Promise<void>;
  setTimeoutMs: (ms: number) => Promise<void>;
  lock: () => void;
  appToBackground: () => void;
  appToForeground: () => void;
  selesaiSetup: () => void;
  requireStepUp: () => Promise<boolean>;
  resolveStepUp: (ok: boolean) => void;
  reset: () => Promise<void>;
};

const AWAL = {
  ready: false, pinSet: false, locked: false, cover: false, timeoutMs: TIMEOUT_DEFAULT_MS,
  biometricEnabled: false, biometricStatus: "tidak_ada_perangkat" as BiometricStatus, biometrikGagal: 0,
  salah: 0, sampaiMs: 0, lastUnlockAt: 0, backgroundAt: null as number | null, stepUpOpen: false, setupBaru: false,
};

async function baca<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key, OPSI);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
async function tulis(key: string, v: unknown) {
  await SecureStore.setItemAsync(key, JSON.stringify(v), OPSI);
}

async function simpanPengaturan(s: { biometric: boolean; timeoutMs: number }) {
  await tulis(KEY_SET, s);
}

function sisaSebelumJeda(salah: number): number {
  const batas = [5, 8, 10].filter((b) => b > salah);
  return batas.length ? (batas[0] as number) - salah : 0;
}

export const useLock = create<LockState>((set, get) => ({
  ...AWAL,

  load: async () => {
    const [pin, pengaturan, att, status] = await Promise.all([
      baca<PinVerifier>(KEY_PIN),
      baca<{ biometric?: boolean; timeoutMs?: number }>(KEY_SET),
      baca<{ salah?: number; sampaiMs?: number }>(KEY_ATT),
      statusBiometrik(),
    ]);
    verifier = pin && pin.hash && pin.salt && pin.iterations ? pin : null;
    const timeoutMs = TIMEOUT_PILIHAN.some((t) => t.ms === pengaturan?.timeoutMs) ? (pengaturan?.timeoutMs as number) : TIMEOUT_DEFAULT_MS;
    set({
      ...AWAL,
      ready: true,
      pinSet: verifier !== null,
      locked: verifier !== null, // cold start selalu terkunci
      timeoutMs,
      biometricEnabled: !!pengaturan?.biometric && status === "tersedia",
      biometricStatus: status,
      salah: Math.max(0, Number(att?.salah) || 0),
      sampaiMs: Math.max(0, Number(att?.sampaiMs) || 0),
    });
  },

  setupPin: async (pin) => {
    if (!pinValid(pin)) return { ok: false, reason: "format" };
    if (pinLemah(pin)) return { ok: false, reason: "lemah" };
    verifier = await buatVerifier(pin);
    await tulis(KEY_PIN, verifier);
    await tulis(KEY_ATT, { salah: 0, sampaiMs: 0 });
    set({ pinSet: true, locked: false, cover: false, salah: 0, sampaiMs: 0, lastUnlockAt: sekarang(), biometrikGagal: 0, setupBaru: true });
    return { ok: true };
  },

  verifyPin: async (pin) => {
    if (!verifier) return { ok: false, reason: "belum_ada" };
    if (!pinValid(pin)) return { ok: false, reason: "format" };
    const t = sekarang();
    const { sampaiMs, salah: salahSaatIni } = get();
    if (t < sampaiMs) return { ok: false, reason: "jeda", sisaDetik: Math.ceil((sampaiMs - t) / 1000) };

    if (await cekPin(pin, verifier)) {
      await tulis(KEY_ATT, { salah: 0, sampaiMs: 0 });
      set({ locked: false, cover: false, salah: 0, sampaiMs: 0, lastUnlockAt: sekarang(), biometrikGagal: 0 });
      return { ok: true };
    }

    const salah = salahSaatIni + 1;
    const jeda = jedaSetelahSalah(salah);
    if (jeda === "hapus") {
      await get().reset();
      return { ok: false, reason: "hapus" };
    }
    const sampai = jeda > 0 ? sekarang() + jeda * 1000 : 0;
    await tulis(KEY_ATT, { salah, sampaiMs: sampai });
    set({ salah, sampaiMs: sampai });
    return jeda > 0
      ? { ok: false, reason: "jeda", sisaDetik: jeda, sisaPercobaan: 0 }
      : { ok: false, reason: "salah", sisaPercobaan: sisaSebelumJeda(salah) };
  },

  changePin: async (lama, baru) => {
    if (lama === baru && pinValid(baru)) return { ok: false, reason: "sama" };
    const cek = await get().verifyPin(lama);
    if (!cek.ok) return cek;
    if (!pinValid(baru)) return { ok: false, reason: "format" };
    if (pinLemah(baru)) return { ok: false, reason: "lemah" };
    verifier = await buatVerifier(baru);
    await tulis(KEY_PIN, verifier);
    set({ lastUnlockAt: sekarang() });
    return { ok: true };
  },

  unlockBiometric: async () => {
    const { biometricEnabled, biometrikGagal } = get();
    if (!biometricEnabled || biometrikGagal >= BIOMETRIK_MAKS_GAGAL) {
      return { ok: false, reason: "tidak_tersedia", pesan: "Biometrik tidak dipakai. Masukkan PIN." };
    }
    const r = await autentikasiBiometrik("Buka SANO Finance");
    if (r.ok) {
      set({ locked: false, cover: false, lastUnlockAt: sekarang(), biometrikGagal: 0 });
    } else if (r.reason === "gagal" || r.reason === "terkunci") {
      set({ biometrikGagal: get().biometrikGagal + 1 }); // dibatalkan pengguna tidak dihitung
    }
    return r;
  },

  setBiometric: async (aktif) => {
    const { timeoutMs } = get();
    if (!aktif) {
      await simpanPengaturan({ biometric: false, timeoutMs });
      set({ biometricEnabled: false });
      return { ok: true };
    }
    // Aktifkan HANYA setelah pengguna benar-benar lolos biometrik sekali (fungsi ini juga
    // menghasilkan pesan yang tepat bila biometrik tidak ada / belum terdaftar).
    const r = await autentikasiBiometrik("Aktifkan biometrik untuk SANO Finance");
    set({ biometricStatus: await statusBiometrik() });
    if (r.ok) {
      await simpanPengaturan({ biometric: true, timeoutMs });
      set({ biometricEnabled: true, biometrikGagal: 0 });
    }
    return r;
  },

  refreshBiometric: async () => {
    const status = await statusBiometrik();
    set({ biometricStatus: status, ...(status !== "tersedia" ? { biometricEnabled: false } : {}) });
  },

  setTimeoutMs: async (ms) => {
    if (!TIMEOUT_PILIHAN.some((t) => t.ms === ms)) return;
    await simpanPengaturan({ biometric: get().biometricEnabled, timeoutMs: ms });
    set({ timeoutMs: ms });
  },

  lock: () => { if (get().pinSet) set({ locked: true }); },

  appToBackground: () => {
    if (!get().pinSet) return;
    set({ backgroundAt: sekarang(), cover: true });
  },

  appToForeground: () => {
    const { pinSet, backgroundAt, timeoutMs, locked } = get();
    if (!pinSet) return;
    const lama = backgroundAt == null ? 0 : sekarang() - backgroundAt;
    const kunci = locked || (backgroundAt != null && lama >= timeoutMs);
    set({ locked: kunci, cover: false, backgroundAt: null });
  },

  selesaiSetup: () => set({ setupBaru: false }),

  requireStepUp: () => {
    const { pinSet, lastUnlockAt } = get();
    if (!pinSet) return Promise.resolve(false); // aksi sensitif tanpa PIN tidak diizinkan
    if (sekarang() - lastUnlockAt < STEPUP_TTL_MS) return Promise.resolve(true);
    if (stepUpPromise) return stepUpPromise;
    stepUpPromise = new Promise<boolean>((resolve) => { stepUpResolver = resolve; });
    set({ stepUpOpen: true });
    return stepUpPromise;
  },

  resolveStepUp: (ok) => {
    const r = stepUpResolver;
    stepUpResolver = null;
    stepUpPromise = null;
    set({ stepUpOpen: false, ...(ok ? { lastUnlockAt: sekarang() } : {}) });
    r?.(ok);
  },

  reset: async () => {
    verifier = null;
    await Promise.all([KEY_PIN, KEY_SET, KEY_ATT].map((k) => SecureStore.deleteItemAsync(k, OPSI).catch(() => {})));
    stepUpResolver?.(false);
    stepUpResolver = null;
    stepUpPromise = null;
    set({ ...AWAL, ready: true });
  },
}));
