import React, { useEffect, useState, useRef } from "react";
import { X, Download, Share2 } from "lucide-react";

// Safari iOS TIDAK PERNAH fire "beforeinstallprompt" — tidak ada API
// programatik utk memicu instalasi PWA di iOS sama sekali (batasan
// platform, bukan bug). Satu-satunya cara: user manual Share > "Tambah
// ke Layar Utama". Sebelumnya banner ini HANYA pernah tampil di
// Chromium (Chrome/Edge/Brave/Opera Android) — di iPhone banner ini
// diam-diam tidak pernah muncul sama sekali, user iPhone tidak pernah
// tahu app ini bisa di-install.
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}
// Sudah running sebagai app ter-install (bukan tab browser biasa) —
// window.navigator.standalone khusus Safari iOS, display-mode standard
// dipakai Chromium/Firefox. Kalau sudah standalone, jangan tawarkan install lagi.
function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export default function InstallPrompt() {
  const [visible, setVisible]   = useState(false);
  const [iosMode, setIosMode]   = useState(false);
  const deferredPrompt = useRef(null);

  useEffect(() => {
    // Tidak tampil kalau sudah pernah di-dismiss atau sudah ter-install
    if (localStorage.getItem("pwa-install-dismissed")) return;

    // Hanya tampil di mobile (layar < 768px)
    if (window.innerWidth >= 768) return;

    if (isStandalone()) return; // sudah di-install, tidak perlu ditawarkan lagi

    if (isIOS()) {
      setIosMode(true);
      setVisible(true);
      return;
    }

    // Cek apakah event sudah di-capture lebih awal di index.html
    if (window.__pwaInstallEvent) {
      deferredPrompt.current = window.__pwaInstallEvent;
      setVisible(true);
      return;
    }

    // Kalau belum, listen event yang mungkin belum firing
    function handleBeforeInstall(e) {
      e.preventDefault();
      deferredPrompt.current = e;
      setVisible(true);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt.current) return;
    deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    deferredPrompt.current = null;
    localStorage.setItem("pwa-install-dismissed", "1");
    setVisible(false);
  }

  function handleDismiss() {
    localStorage.setItem("pwa-install-dismissed", "1");
    setVisible(false);
  }

  if (!visible) return null;

  // iOS: tidak ada tombol "Install" programatik — tampilkan instruksi
  // manual singkat (ikon Share adalah petunjuk visual paling dikenali).
  if (iosMode) {
    return (
      <div className="install-prompt install-prompt-ios">
        <div className="install-prompt-icon">
          <Share2 size={18} />
        </div>
        <p className="install-prompt-text">
          Ketuk <strong>Bagikan</strong> di Safari, lalu pilih <strong>"Tambah ke Layar Utama"</strong> untuk install
        </p>
        <button className="install-prompt-close" onClick={handleDismiss} title="Tutup">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="install-prompt">
      <div className="install-prompt-icon">
        <Download size={18} />
      </div>
      <p className="install-prompt-text">
        Install Klinik Matras CRM untuk akses lebih cepat
      </p>
      <button className="install-prompt-btn" onClick={handleInstall}>
        Install
      </button>
      <button className="install-prompt-close" onClick={handleDismiss} title="Tutup">
        <X size={16} />
      </button>
    </div>
  );
}
