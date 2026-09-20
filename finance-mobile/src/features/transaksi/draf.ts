import * as SecureStore from "expo-secure-store";
import type { ModulTx } from "@/api/types";

// DRAF LOKAL — hanya isian teks (tanpa foto) disimpan di penyimpanan aman perangkat supaya tidak hilang bila aplikasi tertutup. Draf TIDAK PERNAH
// dikirim/diposting otomatis: pengguna harus membuka formulir dan menekan kirim sendiri. Batas SecureStore ~2 KB per kunci → isian dipangkas.

const kunci = (modul: ModulTx) => `draf_tx_${modul.replace(/\W/g, "_")}`;
const BATAS = 1800;
const OPSI: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export type IsianDraf = Record<string, string>;

export async function simpanDraf(modul: ModulTx, isian: IsianDraf): Promise<boolean> {
  const bersih: IsianDraf = {};
  for (const [k, v] of Object.entries(isian)) if (typeof v === "string" && v.trim()) bersih[k] = v.length > 300 ? v.slice(0, 300) : v;
  const bungkus = () => JSON.stringify({ isian: bersih, simpanPada: new Date().toISOString() });
  if (bungkus().length > BATAS) delete bersih.catatan;
  if (Object.keys(bersih).length === 0 || bungkus().length > BATAS) return false;
  try { await SecureStore.setItemAsync(kunci(modul), bungkus(), OPSI); return true; } catch { return false; }
}

export async function bacaDraf(modul: ModulTx): Promise<{ isian: IsianDraf; simpanPada: string } | null> {
  try {
    const raw = await SecureStore.getItemAsync(kunci(modul), OPSI);
    if (!raw) return null;
    const o = JSON.parse(raw) as { isian?: IsianDraf; simpanPada?: string };
    return o.isian && typeof o.isian === "object" ? { isian: o.isian, simpanPada: o.simpanPada ?? "" } : null;
  } catch { return null; }
}

export async function hapusDraf(modul: ModulTx): Promise<void> {
  try { await SecureStore.deleteItemAsync(kunci(modul), OPSI); } catch { /* abaikan */ }
}
