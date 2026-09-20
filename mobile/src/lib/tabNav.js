// Logika MURNI navigasi bottom tab (tanpa React/RN supaya bisa dites dengan node --test).

// ── Animasi ─────────────────────────────────────────────────────────────────────────────────────
// Kurva & durasi SATU sumber untuk isi layar (RN Animated, native driver) dan pil tab bar (Reanimated, UI thread).
export const TAB_DUR = 200;                 // ms — di dalam jendela 180–220
export const TAB_SHIFT_DP = 20;             // dp — geser pendek (12–24), bukan satu layar penuh
export const TAB_BEZIER = [0.33, 0, 0.2, 1]; // ease-out: berangkat cepat, mendarat pelan

/** Konfigurasi transisi tab. Reduce-motion → tanpa animasi sama sekali (pil pindah seketika). */
export function tabTransition({ reduceMotion = false } = {}) {
  return reduceMotion
    ? { animation: "none", duration: 0, shift: 0 }
    : { animation: "shift", duration: TAB_DUR, shift: TAB_SHIFT_DP };
}

// ── Daftar ───────────────────────────────────────────────────────────────────────────────────────
// Batas kolam daur-ulang FlashList (sel di luar layar yang tetap ter-mount). Cukup untuk scroll bolak-balik mulus.
export const LIST_RECYCLE_POOL = 8;

/**
 * Data daftar untuk layar tab yang sedang TIDAK tampil. Layar tersembunyi terukur 0 px: FlashList mengukur tiap sel
 * bertinggi 0, sehingga SEMUA baris dianggap "terlihat" dan seluruhnya di-render (300 chat ≈ 9 rb view native ≈ 4 dtk
 * beban thread JS saat layar akhirnya dibuka). Selama tersembunyi daftar dibekukan pada data terakhir yang tampil
 * (atau contoh `hiddenSample` baris bila belum pernah tampil); begitu fokus, data terbaru dipakai penuh.
 */
export const HIDDEN_LIST_SAMPLE = 12;
export function holdListData({ focused, data, held, hiddenSample = HIDDEN_LIST_SAMPLE }) {
  if (focused) return data;
  if (held !== undefined) return held;
  return Array.isArray(data) ? data.slice(0, hiddenSample) : data;
}

// ── Label & aksesibilitas ───────────────────────────────────────────────────────────────────────
export const TAB_LABEL = { Home: "Beranda", Chats: "Inbox", Pelanggan: "Pelanggan", Order: "Order", Profil: "Profil" };

/** Props aksesibilitas satu item tab (role "tab" + label + status terpilih). */
export function tabA11y(routeName, focused, badge = 0) {
  const label = TAB_LABEL[routeName] || routeName;
  return {
    accessibilityRole: "tab",
    accessibilityLabel: badge > 0 ? `${label}, ${badge} belum dibaca` : label,
    accessibilityState: { selected: !!focused },
  };
}

// ── Ketukan beruntun ────────────────────────────────────────────────────────────────────────────
/**
 * Mencegah navigasi ganda & animasi bertumpuk. Ketukan pada tab yang SUDAH menjadi tujuan (aktif ATAU sedang
 * dalam perjalanan) diabaikan; ketukan ke tab LAIN selalu diizinkan (animasi lama diinterupsi aman oleh Animated).
 * `inFlight` kedaluwarsa sendiri supaya tidak pernah macet bila state navigasi tak kunjung menyusul.
 */
export function createTabRequestGuard({ ttlMs = TAB_DUR + 120, now = () => Date.now() } = {}) {
  let target = null;
  let since = 0;
  return {
    /** true = lanjutkan navigasi. `activeName` = tab yang saat ini fokus menurut state navigator. */
    request(name, activeName) {
      const fresh = target !== null && now() - since < ttlMs;
      const destination = fresh ? target : activeName;
      if (name === destination) return false; // sudah di sana / sedang menuju ke sana
      target = name;
      since = now();
      return true;
    },
    /** State navigator sudah mencapai `activeName` → hentikan pelacakan. */
    settle(activeName) {
      if (target === activeName) target = null;
    },
    get pending() { return target; },
  };
}

// ── Preload idle ────────────────────────────────────────────────────────────────────────────────
/**
 * Preload tab (mount di belakang layar) SETELAH Home stabil, satu per satu, tidak pernah saat startup kritis.
 * `schedule/cancel` diinjeksi (setTimeout/clearTimeout di app; timer palsu di tes). `interrupt()` = user menyentuh
 * tab bar → tunda (jangan menambah pekerjaan saat user berinteraksi). `preload(name)` mengembalikan boolean/void.
 */
export function createIdlePreloader({ order, preload, schedule = setTimeout, cancel = clearTimeout, firstDelayMs = 2500, gapMs = 1500, retryMs = 1200, isBusy = () => false }) {
  const queue = [...order];
  let timer = null;
  let stopped = false;
  const step = () => {
    timer = null;
    if (stopped || queue.length === 0) return;
    if (isBusy()) { timer = schedule(step, retryMs); return; } // user sedang berinteraksi/animasi berjalan
    const name = queue.shift();
    try { preload(name); } catch { /* preload hanya optimasi */ }
    if (queue.length) timer = schedule(step, gapMs);
  };
  return {
    start() { if (!timer && !stopped) timer = schedule(step, firstDelayMs); },
    interrupt() { if (stopped || queue.length === 0) return; if (timer) cancel(timer); timer = schedule(step, retryMs); },
    stop() { stopped = true; if (timer) cancel(timer); timer = null; },
    get remaining() { return [...queue]; },
  };
}
