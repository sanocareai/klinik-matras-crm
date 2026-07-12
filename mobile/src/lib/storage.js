// Storage key-value persisten untuk store (draft, outbox, dsb).
//
// ⚠️ Ganti dari react-native-mmkv (native module — crash "undefined cannot
// be used as a constructor" karena native module MMKV belum ter-build di
// APK development ini) ke @react-native-async-storage/async-storage, yang
// sudah pasti ter-link (dipakai luas, sudah jadi dependency project ini).
//
// AsyncStorage API-nya full ASYNC, sementara interface lama (MMKV) yang
// dipakai zustandAsyncStorage di bawah ini SYNCHRONOUS (getString/set/delete
// balikin nilai langsung, bukan Promise) — supaya composerStore.js &
// outboxStore.js TIDAK perlu diubah sama sekali, dipakai pola in-memory
// cache: semua key dibaca ke memori SEKALI saat init (hydrate), lalu
// getString/set/delete baca/tulis ke cache itu secara sync. Tulis ke
// AsyncStorage sungguhan jalan fire-and-forget di background — draft/outbox
// bukan data kritis yang butuh konfirmasi tersimpan sebelum lanjut.
import AsyncStorage from "@react-native-async-storage/async-storage";

// Prefix supaya key kita tidak tabrakan dengan key AsyncStorage punya
// library lain di app yang sama.
const KEY_PREFIX = "klinik-matras-mobile:";

const cache = new Map();

// Hydrate sekali di awal — baca semua key milik kita dari AsyncStorage ke
// cache in-memory. zustandAsyncStorage.getItem menunggu promise ini dulu
// sebelum baca cache, supaya rehydrate zustand tidak kejar-kejaran dengan
// hydrate yang belum selesai (race saat app baru dibuka).
const hydrated = (async () => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const ownKeys = allKeys.filter((k) => k.startsWith(KEY_PREFIX));
    if (!ownKeys.length) return;
    const pairs = await AsyncStorage.multiGet(ownKeys);
    for (const [key, value] of pairs) {
      if (value != null) cache.set(key.slice(KEY_PREFIX.length), value);
    }
  } catch (err) {
    console.warn("[storage] Gagal hydrate dari AsyncStorage:", err.message);
  }
})();

const storage = {
  getString: (key) => cache.get(key),
  set: (key, value) => {
    cache.set(key, value);
    AsyncStorage.setItem(KEY_PREFIX + key, value).catch((err) => {
      console.warn("[storage] Gagal simpan ke AsyncStorage:", err.message);
    });
  },
  delete: (key) => {
    cache.delete(key);
    AsyncStorage.removeItem(KEY_PREFIX + key).catch(() => {});
  },
};

export default storage;

// Adapter supaya bisa dipakai zustand persist middleware (createJSONStorage
// butuh getItem/setItem/removeItem, bukan getString/set/delete-nya di atas).
// getItem sengaja ASYNC (nunggu `hydrated` dulu) — zustand persist middleware
// sudah native mendukung storage async (auto-await), jadi rehydrate store
// dijamin baca cache yang sudah lengkap, bukan cache kosong di jendela awal
// sebelum hydrate() selesai.
export const zustandAsyncStorage = {
  getItem: async (name) => {
    await hydrated;
    return storage.getString(name) ?? null;
  },
  setItem: (name, value) => storage.set(name, value),
  removeItem: (name) => storage.delete(name),
};
