import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { autentikasi, infoPerangkat, PESAN_GAGAL, type HasilAutentikasi, type InfoPerangkat } from "./biometrik";

// KEAMANAN & MASUK CEPAT
//
// 1. MASUK CEPAT — email + kata sandi disimpan di expo-secure-store (Android Keystore, hanya perangkat ini, tidak ikut backup)
//    dan HANYA dibaca setelah pengguna lolos sidik jari / wajah / PIN HP. Menyimpan juga wajib lolos autentikasi sekali
//    (membuktikan pemilik HP yang mengaktifkan). Kata sandi yang sudah tidak berlaku (server 401) otomatis dihapus.
// 2. KUNCI APLIKASI (opsional, mati bawaan) — aplikasi dibuka dari nol, atau kembali dari latar belakang lebih lama dari
//    batas waktu, meminta sidik jari / wajah / PIN HP. Saat ke latar belakang isi layar langsung ditutup (Recents).
// 3. Email terakhir diingat (bukan rahasia) supaya kolom email terisi sendiri.
// Semua keputusan waktu memakai fungsi murni di bawah (dites di __tests__/keamanan.test.ts).

const OPSI: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const KEY_KREDENSIAL = "produksi.login-cepat.v1";
const KEY_PENGATURAN = "produksi.keamanan.v1";

// Tanpa "Langsung": kamera (foto/video bukti) dan layar PIN HP membuka aplikasi lain sebentar — terkunci tiap kali
// kembali dari kamera akan mengganggu kerja di lantai produksi.
export const BATAS_PILIHAN: { ms: number; label: string }[] = [
  { ms: 60_000, label: "1 menit" },
  { ms: 300_000, label: "5 menit" },
  { ms: 900_000, label: "15 menit" },
  { ms: 1_800_000, label: "30 menit" },
];
export const BATAS_BAWAAN_MS = 300_000;

let sekarang = () => Date.now();
/** Ganti jam — hanya untuk tes. */
export function setJamUntukTes(fn: (() => number) | null) { sekarang = fn ?? (() => Date.now()); }

/** Kembali ke depan → perlu dikunci? Murni. */
export function perluDikunci(p: { kunciAktif: boolean; sudahTerkunci: boolean; backgroundAt: number | null; batasMs: number; kini: number }): boolean {
  if (!p.kunciAktif) return false;
  if (p.sudahTerkunci) return true;
  return p.backgroundAt != null && p.kini - p.backgroundAt >= p.batasMs;
}

// Selama dialog autentikasi terbuka (dan sesaat sesudahnya) perpindahan latar belakang DIABAIKAN: layar PIN/pola HP adalah
// activity lain, jadi Android melaporkan aplikasi "ke belakang" lalu "ke depan" — tanpa penjaga ini kunci akan berulang.
export const TENGGANG_SETELAH_AUTENTIKASI_MS = 2_000;
let sibukAutentikasi = false;
let tenggangSampai = 0;
async function autentikasiTerjaga(judul: string): Promise<HasilAutentikasi> {
  sibukAutentikasi = true;
  try { return await autentikasi(judul); } finally { sibukAutentikasi = false; tenggangSampai = sekarang() + TENGGANG_SETELAH_AUTENTIKASI_MS; }
}
const abaikanPerpindahan = () => sibukAutentikasi || sekarang() < tenggangSampai;

type Pengaturan = { kunciAktif: boolean; batasMs: number; emailTerakhir: string | null; loginCepatEmail: string | null };
type Kredensial = { email: string; password: string };

export type HasilMasukCepat = { ok: true; email: string; password: string } | { ok: false; pesan: string; dibatalkan?: boolean };

type State = Pengaturan & {
  siap: boolean;
  info: InfoPerangkat;
  terkunci: boolean;
  tutup: boolean;
  backgroundAt: number | null;
  muat: () => Promise<void>;
  segarkanPerangkat: () => Promise<void>;
  ingatEmail: (email: string) => Promise<void>;
  simpanLoginCepat: (email: string, password: string) => Promise<HasilAutentikasi>;
  /** Setelah login manual berhasil: perbarui kata sandi tersimpan bila emailnya sama (kata sandi mungkin baru diganti). */
  perbaruiSandiTersimpan: (email: string, password: string) => Promise<void>;
  ambilLoginCepat: () => Promise<HasilMasukCepat>;
  hapusLoginCepat: () => Promise<void>;
  setKunci: (aktif: boolean) => Promise<HasilAutentikasi>;
  setBatas: (ms: number) => Promise<void>;
  buka: () => Promise<HasilAutentikasi>;
  keBelakang: () => void;
  keDepan: () => void;
  /** Dipanggil saat masuk (sesi baru) → tidak terkunci; saat keluar → tidak ada yang perlu dikunci. */
  lepasKunci: () => void;
  reset: () => Promise<void>;
};

const PENGATURAN_AWAL: Pengaturan = { kunciAktif: false, batasMs: BATAS_BAWAAN_MS, emailTerakhir: null, loginCepatEmail: null };
const AWAL = { ...PENGATURAN_AWAL, siap: false, info: { status: "tidak_ada", jenis: [] } as InfoPerangkat, terkunci: false, tutup: false, backgroundAt: null as number | null };

async function baca<T>(key: string): Promise<T | null> {
  try { const raw = await SecureStore.getItemAsync(key, OPSI); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}
const tulis = (key: string, v: unknown) => SecureStore.setItemAsync(key, JSON.stringify(v), OPSI);
const hapus = (key: string) => SecureStore.deleteItemAsync(key, OPSI).catch(() => {});
const normalEmail = (e: string) => e.trim().toLowerCase();

export const useKeamanan = create<State>((set, get) => {
  const simpanPengaturan = async (p: Partial<Pengaturan>) => {
    const s = get();
    const baru: Pengaturan = { kunciAktif: s.kunciAktif, batasMs: s.batasMs, emailTerakhir: s.emailTerakhir, loginCepatEmail: s.loginCepatEmail, ...p };
    await tulis(KEY_PENGATURAN, baru);
    set(baru);
  };

  return {
    ...AWAL,

    muat: async () => {
      const [p, info, kred] = await Promise.all([baca<Partial<Pengaturan>>(KEY_PENGATURAN), infoPerangkat(), baca<Kredensial>(KEY_KREDENSIAL)]);
      const batasMs = BATAS_PILIHAN.some((b) => b.ms === p?.batasMs) ? (p!.batasMs as number) : BATAS_BAWAAN_MS;
      // Kunci tidak bisa jalan tanpa kunci layar HP → anggap mati (jangan mengurung pengguna).
      const kunciAktif = !!p?.kunciAktif && info.status !== "tidak_ada";
      set({
        ...AWAL, siap: true, info, batasMs, kunciAktif,
        emailTerakhir: p?.emailTerakhir ?? null,
        loginCepatEmail: kred?.email && kred.password ? kred.email : null,
        terkunci: kunciAktif, // dibuka dari nol → terkunci (gerbang hanya tampil bila ada sesi)
      });
    },

    segarkanPerangkat: async () => {
      const info = await infoPerangkat();
      set({ info, ...(info.status === "tidak_ada" ? { kunciAktif: false, terkunci: false } : {}) });
    },

    ingatEmail: async (email) => { await simpanPengaturan({ emailTerakhir: normalEmail(email) }); },

    simpanLoginCepat: async (email, password) => {
      const r = await autentikasiTerjaga("Aktifkan masuk cepat");
      if (!r.ok) return r;
      await tulis(KEY_KREDENSIAL, { email: normalEmail(email), password } satisfies Kredensial);
      await simpanPengaturan({ loginCepatEmail: normalEmail(email) });
      return r;
    },

    perbaruiSandiTersimpan: async (email, password) => {
      const tersimpan = get().loginCepatEmail;
      if (!tersimpan || tersimpan !== normalEmail(email)) return;
      await tulis(KEY_KREDENSIAL, { email: tersimpan, password } satisfies Kredensial);
    },

    ambilLoginCepat: async () => {
      if (!get().loginCepatEmail) return { ok: false, pesan: "Masuk cepat belum diaktifkan di HP ini." };
      const r = await autentikasiTerjaga("Masuk ke SANSS Produksi");
      if (!r.ok) return { ok: false, pesan: r.pesan, dibatalkan: r.alasan === "dibatalkan" };
      const k = await baca<Kredensial>(KEY_KREDENSIAL);
      if (!k?.email || !k.password) {
        await get().hapusLoginCepat();
        return { ok: false, pesan: "Data masuk cepat tidak ditemukan. Masuk dengan email & kata sandi." };
      }
      return { ok: true, email: k.email, password: k.password };
    },

    hapusLoginCepat: async () => {
      await hapus(KEY_KREDENSIAL);
      await simpanPengaturan({ loginCepatEmail: null });
    },

    setKunci: async (aktif) => {
      // Menyalakan DAN mematikan wajib lolos autentikasi (orang lain yang memegang HP tidak bisa mematikannya).
      const r = await autentikasiTerjaga(aktif ? "Aktifkan kunci aplikasi" : "Matikan kunci aplikasi");
      if (!r.ok) return r;
      await simpanPengaturan({ kunciAktif: aktif });
      set({ terkunci: false });
      return r;
    },

    setBatas: async (ms) => {
      if (!BATAS_PILIHAN.some((b) => b.ms === ms)) return;
      await simpanPengaturan({ batasMs: ms });
    },

    buka: async () => {
      if (get().info.status === "tidak_ada") { set({ terkunci: false, kunciAktif: false }); return { ok: false, alasan: "tidak_tersedia", pesan: PESAN_GAGAL.tidak_tersedia }; }
      const r = await autentikasiTerjaga("Buka SANSS Produksi");
      if (r.ok) set({ terkunci: false, tutup: false });
      return r;
    },

    keBelakang: () => { if (get().kunciAktif && !abaikanPerpindahan()) set({ backgroundAt: sekarang(), tutup: true }); },

    keDepan: () => {
      const s = get();
      if (abaikanPerpindahan()) { set({ tutup: false, backgroundAt: null }); return; }
      if (!s.kunciAktif) { set({ tutup: false, backgroundAt: null }); return; }
      const kunci = perluDikunci({ kunciAktif: s.kunciAktif, sudahTerkunci: s.terkunci, backgroundAt: s.backgroundAt, batasMs: s.batasMs, kini: sekarang() });
      set({ terkunci: kunci, tutup: false, backgroundAt: null });
    },

    lepasKunci: () => set({ terkunci: false, tutup: false, backgroundAt: null }),

    reset: async () => {
      sibukAutentikasi = false; tenggangSampai = 0;
      await Promise.all([hapus(KEY_KREDENSIAL), hapus(KEY_PENGATURAN)]);
      set({ ...AWAL, siap: true });
    },
  };
});
