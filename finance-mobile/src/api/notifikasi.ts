import { randomUUID } from "expo-crypto";
import { api } from "@/auth/session";
import { ENV } from "@/lib/env";

// PREFERENSI NOTIFIKASI (S11): GET/PUT /api/mobile/notification-prefs. Baris tidak ada di server = semua kategori aktif.
// Server tetap membatasi penerima menurut izin; preferensi hanya menambah pembatasan.

export const KATEGORI = ["approval", "pembayaran", "piutang", "supplier", "sensitif"] as const;
export type KategoriNotif = (typeof KATEGORI)[number];
export type Preferensi = { categories: Record<KategoriNotif, boolean>; pushEnabled: boolean; fcmConfigured: boolean };

const SEMUA_AKTIF: Preferensi = { categories: { approval: true, pembayaran: true, piutang: true, supplier: true, sensitif: true }, pushEnabled: false, fcmConfigured: false };

function petakan(raw: unknown): Preferensi {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const c = o.categories && typeof o.categories === "object" ? (o.categories as Record<string, unknown>) : {};
  return {
    categories: Object.fromEntries(KATEGORI.map((k) => [k, c[k] !== false])) as Record<KategoriNotif, boolean>,
    pushEnabled: o.pushEnabled === true,
    fcmConfigured: o.fcmConfigured === true,
  };
}

export async function ambilPreferensi(): Promise<Preferensi> {
  if (ENV.useMocks) return contoh;
  return petakan(await api.get<unknown>("/mobile/notification-prefs"));
}

export async function simpanPreferensi(categories: Partial<Record<KategoriNotif, boolean>>): Promise<Preferensi> {
  if (ENV.useMocks) { contoh = { ...contoh, categories: { ...contoh.categories, ...categories } as Preferensi["categories"] }; return contoh; }
  return petakan(await api.command<unknown>("PUT", "/mobile/notification-prefs", randomUUID(), { body: { categories } }));
}

let contoh: Preferensi = { ...SEMUA_AKTIF, pushEnabled: true };
