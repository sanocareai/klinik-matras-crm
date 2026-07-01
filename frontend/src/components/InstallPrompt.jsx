import React, { useEffect, useState, useRef } from "react";
import { X, Download } from "lucide-react";

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const deferredPrompt = useRef(null);

  useEffect(() => {
    // Tidak tampil kalau sudah pernah di-dismiss atau sudah ter-install
    if (localStorage.getItem("pwa-install-dismissed")) return;

    // Hanya tampil di mobile (layar < 768px)
    if (window.innerWidth >= 768) return;

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
