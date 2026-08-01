import React, { useState } from "react";
import { Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { api } from "../api.js";
import { refreshSocketAuth } from "../lib/socket.js";
import { BRAND } from "@/lib/brand.js";

// LOGIN SANSS — layar split (redesign 1 Agustus 2026, Gilang).
// Kiri: panel biru gelap berisi identitas produk + 3 nilai jual.
// Kanan: form putih bersih. Di bawah lg, panel kiri DISEMBUNYIKAN total
// (bukan ditumpuk) — di HP yang dibutuhkan cuma form, panel marketing
// setinggi layar justru memaksa scroll sebelum bisa mengetik.
//
// ⚠️ LOGIKA AUTENTIKASI TIDAK DIUBAH sama sekali oleh redesign ini —
// validasi (required), loading state, error handling, refreshSocketAuth(),
// onLogin, dan penyimpanan token PERSIS seperti sebelumnya.

const HIGHLIGHTS = [
  { title: "Connected", body: "Alur kerja lintas divisi dalam satu sistem." },
  { title: "Trackable", body: "Status order dan stok mudah dipantau." },
  { title: "Actionable", body: "Informasi prioritas untuk keputusan cepat." },
];

export default function Login({ onLogin }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token, user } = await api.login(email, password);
      localStorage.setItem("token", token);
      refreshSocketAuth();
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] bg-white">
      {/* ── Panel kiri (desktop saja) ─────────────────────────────────── */}
      <aside className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-[#0A2463] via-[#123C9E] to-[#1D4ED8] px-12 py-10 text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.13]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.65) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.65) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div aria-hidden className="pointer-events-none absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-white/10 blur-3xl" />

        {/* Brand */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white">
            <img src="/logo-small.png" alt="" className="h-6 w-6 object-contain" />
          </div>
          <div>
            <div className="text-[17px] font-bold leading-tight tracking-tight">{BRAND.name}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
              {BRAND.subtitle}
            </div>
          </div>
        </div>

        {/* Isi tengah */}
        <div className="relative my-auto max-w-lg py-10">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-[11px] font-semibold backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Connected operations workspace
          </span>

          <h1 className="mt-7 text-[44px] font-bold leading-[1.08] tracking-tight xl:text-[52px]">
            Sano Integrated<br />Smart System.
          </h1>

          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/75">
            Kelola perjalanan order SANO dari lead pertama, produksi kasur, kontrol
            stok, hingga pengiriman dalam satu sistem terintegrasi.
          </p>

          <div className="mt-9 grid grid-cols-3 gap-3">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="rounded-xl bg-white/10 p-4 backdrop-blur-sm ring-1 ring-white/15">
                <div className="text-[13px] font-semibold">{h.title}</div>
                <div className="mt-1.5 text-[11px] leading-snug text-white/65">{h.body}</div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[11px] text-white/45">
          © {new Date().getFullYear()} {BRAND.name} — {BRAND.subtitle}.
        </p>
      </aside>

      {/* ── Panel kanan: form ─────────────────────────────────────────── */}
      <main className="flex w-full flex-col justify-center px-6 py-10 sm:px-10 lg:w-1/2 lg:px-16">
        <div className="mx-auto w-full max-w-[420px]">
          {/* Brand versi mobile — panel kiri hilang di bawah lg, jadi
              identitas produk tetap harus muncul di suatu tempat. */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#123C9E]">
              <img src="/logo-small.png" alt="" className="h-6 w-6 object-contain" />
            </div>
            <div>
              <div className="text-[17px] font-bold leading-tight tracking-tight text-ink">{BRAND.name}</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink3">
                {BRAND.subtitle}
              </div>
            </div>
          </div>

          <h2 className="text-[30px] font-bold tracking-tight text-ink">Selamat datang 👋</h2>
          <p className="mt-2.5 text-[14px] leading-relaxed text-ink2">
            Masuk menggunakan akun internal SANO untuk membuka workspace {BRAND.name}.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="login-email" className="text-[13px] font-semibold text-ink">
                Email kerja
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink3" />
                <input
                  id="login-email"
                  type="email"
                  placeholder="nama@klinikmatras.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="h-12 w-full rounded-xl border border-border bg-white pl-11 pr-4 text-[14px] text-ink outline-none transition-colors placeholder:text-ink3 focus:border-accent focus:ring-4 focus:ring-accent/10"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="login-password" className="text-[13px] font-semibold text-ink">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink3" />
                <input
                  id="login-password"
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="h-12 w-full rounded-xl border border-border bg-white pl-11 pr-11 text-[14px] text-ink outline-none transition-colors placeholder:text-ink3 focus:border-accent focus:ring-4 focus:ring-accent/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? "Sembunyikan password" : "Tampilkan password"}
                  className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink3 transition-colors hover:text-ink2"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-redbg px-4 py-3 text-[13px] font-medium text-red">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#123C9E] to-[#1D4ED8] text-[15px] font-semibold text-white shadow-lg shadow-blue-600/20 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-blue-600/30 focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
                </>
              ) : (
                `Masuk ke ${BRAND.name}`
              )}
            </button>
          </form>

          {/* Bug 1c: versi + waktu build kecil — verifikasi cepat user pegang
              bundle TERBARU, bukan basi dari service worker lama (tanpa buka
              DevTools). __APP_VERSION__/__BUILD_TIME__ di-inject vite.config.js. */}
          <p className="mt-10 text-center text-[11px] tracking-[0.2px] text-ink3">
            v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "?"}
            {typeof __BUILD_TIME__ !== "undefined"
              ? ` · ${new Date(__BUILD_TIME__).toLocaleString("id-ID")}`
              : ""}
          </p>
        </div>
      </main>
    </div>
  );
}
