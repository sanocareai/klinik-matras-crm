import React, { useState } from "react";
import { api } from "../api.js";
import { refreshSocketAuth } from "../lib/socket.js";
import { Button } from "@/components/ui/button.jsx";
import { BRAND } from "@/lib/brand.js";

export default function Login({ onLogin }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  // ⚠️ LOGIKA AUTENTIKASI TIDAK DIUBAH (Wave 1 = visual saja) — validasi
  // (required), loading state, error handling, refreshSocketAuth(), onLogin,
  // dan penyimpanan token semuanya PERSIS seperti sebelumnya.
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
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-slate-50 to-brand-50 px-4 py-[max(16px,env(safe-area-inset-top))]">
      <form
        onSubmit={handleSubmit}
        className="flex w-[380px] max-w-[92vw] flex-col gap-3.5 rounded-[20px] border border-black/5 bg-white p-10 shadow-[0_20px_60px_rgba(15,23,42,0.12)]"
      >
        {/* Brand lockup */}
        <div className="mb-1.5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white">
            <img src="/logo-small.png" alt="Logo" className="h-7 w-7 object-contain" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-[-0.01em] text-slate-900">{BRAND.name}</h1>
            <p className="mt-0.5 text-[13px] text-slate-500">{BRAND.subtitle}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-email" className="text-xs font-medium text-slate-500">Email</label>
          <input
            id="login-email"
            type="email"
            placeholder="nama@klinikmatras.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-600/30"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-password" className="text-xs font-medium text-slate-500">Password</label>
          <input
            id="login-password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-600/30"
          />
        </div>

        {error && <p className="text-[13px] text-chart-rose">{error}</p>}

        <Button type="submit" size="lg" disabled={loading} className="mt-1 w-full">
          {loading ? "Memuat..." : "Masuk"}
        </Button>
      </form>

      {/* Bug 1c: versi + waktu build kecil — verifikasi cepat user pegang bundle
          TERBARU, bukan basi dari service worker lama (tanpa buka DevTools).
          __APP_VERSION__/__BUILD_TIME__ di-inject vite.config.js. */}
      <p className="mt-3.5 text-[11px] tracking-[0.2px] text-slate-400">
        v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "?"}
        {typeof __BUILD_TIME__ !== "undefined" ? ` · ${new Date(__BUILD_TIME__).toLocaleString("id-ID")}` : ""}
      </p>
    </div>
  );
}
