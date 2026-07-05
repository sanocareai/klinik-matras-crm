import React from "react";
import { useNavigate } from "react-router-dom";

export default function CoPilotFloat() {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate("/copilot")}
      title="Tanya Sano Co-pilot"
      style={{
        position: "fixed", bottom: 24, right: 24, zIndex: 1050,
        width: 52, height: 52, borderRadius: "50%",
        background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
        border: "none", cursor: "pointer",
        boxShadow: "0 4px 18px rgba(124,58,237,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: 22,
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = "0 6px 24px rgba(124,58,237,0.65)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 18px rgba(124,58,237,0.5)"; }}
    >
      ✨
    </button>
  );
}
