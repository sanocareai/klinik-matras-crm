import React, { useState } from "react";
import { BedDouble } from "lucide-react";
import { api } from "../api.js";
import { refreshSocketAuth } from "../lib/socket.js";

export default function Login({ onLogin }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
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
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">
          <div className="login-logo-icon">
            <BedDouble size={22} />
          </div>
          <div className="login-logo-text">
            <h1>Klinik Matras</h1>
            <p>Omnichannel &amp; CRM</p>
          </div>
        </div>

        <div className="form-group">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="form-group" style={{ marginBottom: 4 }}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Memuat..." : "Masuk"}
        </button>
      </form>

      {/* Bug 1c: versi + waktu build kecil — verifikasi cepat user pegang
          bundle TERBARU, bukan basi dari service worker lama (tanpa perlu
          buka DevTools). __APP_VERSION__/__BUILD_TIME__ di-inject vite.config.js. */}
      <p className="login-version">
        v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "?"}
        {typeof __BUILD_TIME__ !== "undefined" ? ` · ${new Date(__BUILD_TIME__).toLocaleString("id-ID")}` : ""}
      </p>
    </div>
  );
}
