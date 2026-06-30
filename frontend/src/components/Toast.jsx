import React, { useEffect, useRef } from "react";
import { CheckCircle, XCircle, Info, AlertTriangle, X } from "lucide-react";

// Gunakan dengan useToast hook atau langsung lewat ToastContext
// Cara paling simpel: simpan state toasts di App.jsx dan pass ke sini

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

function ToastItem({ toast, onDismiss }) {
  const Icon = ICONS[toast.type] || Info;

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration || 3000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div className={`toast toast-${toast.type || "info"}`}>
      <Icon size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, display: "flex" }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export default function Toast({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// Helper: buat object toast baru
let _nextId = 1;
export function createToast(message, type = "info", duration = 3000) {
  return { id: _nextId++, message, type, duration };
}

// Custom hook agar mudah dipakai di halaman manapun
export function useToast() {
  const [toasts, setToasts] = React.useState([]);

  function show(message, type = "info", duration = 3000) {
    setToasts((prev) => [...prev, createToast(message, type, duration)]);
  }

  function dismiss(id) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return { toasts, show, dismiss };
}
