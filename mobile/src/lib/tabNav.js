// Logika MURNI navigasi bottom tab (tanpa React/RN supaya bisa dites dengan node --test).

// ── Animasi ─────────────────────────────────────────────────────────────────────────────────────
// Isi layar TIDAK dianimasikan: layar tujuan langsung tampil (tanpa translateX / fade layar penuh). Yang bergerak hanya
// indikator tab (pil meluncur + pop skala kecil + ikon), di UI thread (Reanimated), transform/opacity saja.
// Varian dipilih dari hasil ukur (docs/qa/tab-transition-perf-2026-09.md): "instant" = pindah langsung; "fade" = fade
// isi 100 ms (hanya untuk pembanding QA — tidak dipakai bila menambah jank).
export const TAB_VARIANT = "instant";
export const TAB_DUR = 200;                  // ms — pil meluncur (jendela 160–200)
export const TAB_ICON_MS = 180;              // ms — pop skala + opacity indikator/ikon (160–200)
export const TAB_FADE_MS = 100;              // ms — fade isi (80–120), varian "fade" saja
export const TAB_POP_SCALE = 0.94;           // skala awal indikator saat tab dipilih → 1
export const TAB_ICON_DIM = 0.6;             // opacity awal ikon yang baru dipilih → 1
export const TAB_BEZIER = [0.33, 0, 0.2, 1]; // ease-out: berangkat cepat, mendarat pelan

/** Konfigurasi transisi ISI layar. Reduce-motion / "instant" → tanpa animasi apa pun pada isi layar. */
export function tabTransition({ reduceMotion = false, variant = TAB_VARIANT } = {}) {
  if (reduceMotion || variant !== "fade") return { animation: "none", duration: 0 };
  return { animation: "shift", duration: TAB_FADE_MS };
}

/** Durasi animasi indikator (pil/ikon). Reduce-motion → 0: pil pindah seketika, tanpa pop/opacity. */
export function indicatorTiming({ reduceMotion = false } = {}) {
  return reduceMotion
    ? { pill: 0, icon: 0, popScale: 1, iconDim: 1 }
    : { pill: TAB_DUR, icon: TAB_ICON_MS, popScale: TAB_POP_SCALE, iconDim: TAB_ICON_DIM };
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
