import React from "react";

// Skeleton bersama untuk 3 kolom Inbox — dipakai saat data awal belum siap.
// Reuse class .skeleton (shimmer) yang sudah ada di index.css.

export function ConversationListSkeleton({ count = 8 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="conversation-item" style={{ cursor: "default" }}>
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }} />
          <div className="conversation-item-body">
            <div className="skeleton skeleton-text" style={{ width: "55%", height: 13 }} />
            <div className="skeleton skeleton-text" style={{ width: "85%", height: 11, marginTop: 8, marginBottom: 0 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageListSkeleton() {
  const pattern = [
    { align: "flex-start", width: 180 },
    { align: "flex-end",   width: 140 },
    { align: "flex-start", width: 220 },
    { align: "flex-start", width: 120 },
    { align: "flex-end",   width: 200 },
  ];
  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }} aria-hidden="true">
      {pattern.map((p, i) => (
        <div key={i} style={{ display: "flex", justifyContent: p.align }}>
          <div className="skeleton" style={{ width: p.width, height: 38, borderRadius: 14 }} />
        </div>
      ))}
    </div>
  );
}

export function CustomerPanelSkeleton() {
  return (
    <div className="panel-body" aria-hidden="true">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div className="skeleton" style={{ width: 64, height: 64, borderRadius: "50%" }} />
        <div className="skeleton skeleton-text" style={{ width: 120, height: 14 }} />
        <div className="skeleton skeleton-text" style={{ width: 90, height: 11 }} />
      </div>
      {[70, 55, 65].map((w, i) => (
        <div key={i} className="panel-section">
          <div className="skeleton skeleton-text" style={{ width: 80, height: 10, marginBottom: 10 }} />
          <div className="skeleton" style={{ width: `${w}%`, height: 32, borderRadius: 8 }} />
        </div>
      ))}
    </div>
  );
}
