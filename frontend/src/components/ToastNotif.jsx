import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { X, MessageSquare } from "lucide-react";
import Avatar from "./Avatar.jsx";

export default function ToastNotif({ toast, onClose }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  if (!toast) return null;

  function handleClick() {
    navigate(`/inbox?conv=${toast.conversationId}`);
    onClose();
  }

  return (
    <div className="toast-notif" role="alert" aria-live="polite">
      <button className="toast-notif-inner" onClick={handleClick}>
        <div className="toast-notif-icon">
          <Avatar name={toast.customerName} size="sm" />
        </div>
        <div className="toast-notif-body">
          <div className="toast-notif-name">{toast.customerName}</div>
          <div className="toast-notif-preview">
            {toast.preview || <span style={{ fontStyle: "italic" }}>Pesan baru</span>}
          </div>
        </div>
      </button>
      <button className="toast-notif-close" onClick={onClose} title="Tutup">
        <X size={13} />
      </button>
    </div>
  );
}
