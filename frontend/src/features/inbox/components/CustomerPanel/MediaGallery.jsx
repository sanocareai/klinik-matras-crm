import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Video, X } from "lucide-react";
import "yet-another-react-lightbox/styles.css";
import { useMessagesForConv } from "../../stores/messageStore.js";

// Fase G: lightbox cuma di-load saat foto pertama kali diklik.
const Lightbox = lazy(() => import("yet-another-react-lightbox"));

const PAGE = 30;

// Data diambil dari messageStore (sudah dimuat penuh oleh useMessages.js di
// ChatWindow, tidak fetch ulang — lihat catatan pagination di
// features/inbox/hooks/useMessages.js). "Infinite scroll" di sini murni
// windowing render (reveal 30 item per batch via IntersectionObserver) —
// datanya sendiri sudah lengkap di memori, sama seperti pola MessageList.
export default function MediaGallery({ conversationId }) {
  const messages = useMessagesForConv(conversationId);
  const [tab, setTab] = useState("media"); // 'media' | 'doc'
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const sentinelRef = useRef(null);

  const mediaItems = useMemo(
    () => messages.filter((m) => m.mediaUrl && (m.mediaType === "image" || m.mediaType === "video")),
    [messages],
  );
  const docItems = useMemo(
    () => messages.filter((m) => m.mediaUrl && m.mediaType === "document"),
    [messages],
  );
  const items = tab === "media" ? mediaItems : docItems;

  useEffect(() => { setVisibleCount(PAGE); }, [tab, conversationId]);

  const visibleItems = items.slice(0, visibleCount);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= items.length) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setVisibleCount((v) => Math.min(v + PAGE, items.length));
    }, { rootMargin: "100px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [items.length, visibleCount]);

  // Lightbox foto — video pakai modal terpisah (konsisten dengan MessageList.jsx)
  const imageSlides = mediaItems.filter((m) => m.mediaType === "image").map((m) => ({ src: m.mediaUrl }));

  function handleClickItem(m) {
    if (m.mediaType === "video") { setVideoUrl(m.mediaUrl); return; }
    const idx = mediaItems.filter((x) => x.mediaType === "image").findIndex((x) => x.id === m.id);
    if (idx !== -1) setLightboxIndex(idx);
  }

  return (
    <div className="media-gallery">
      <div className="media-gallery-tabs">
        <button className={`media-gallery-tab${tab === "media" ? " active" : ""}`} onClick={() => setTab("media")}>Media</button>
        <button className={`media-gallery-tab${tab === "doc" ? " active" : ""}`} onClick={() => setTab("doc")}>Dokumen</button>
      </div>

      {items.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 12.5, padding: "8px 0" }}>
          {tab === "media" ? "Belum ada foto/video di percakapan ini." : "Belum ada dokumen di percakapan ini."}
        </p>
      ) : tab === "media" ? (
        <div className="media-gallery-grid">
          {visibleItems.map((m) => (
            <button key={m.id} className="media-gallery-item" onClick={() => handleClickItem(m)}>
              {m.mediaType === "image" && <img src={m.mediaUrl} alt="" loading="lazy" />}
              {m.mediaType === "video" && <div className="media-gallery-thumb-icon"><Video size={20} /></div>}
            </button>
          ))}
        </div>
      ) : (
        <div className="media-gallery-doc-list">
          {visibleItems.map((m) => (
            <a key={m.id} href={m.mediaUrl} target="_blank" rel="noreferrer" className="media-gallery-doc-item">
              <FileText size={16} style={{ flexShrink: 0 }} />
              <span>{m.mediaUrl.split("/").pop()}</span>
            </a>
          ))}
        </div>
      )}

      {visibleCount < items.length && <div ref={sentinelRef} style={{ height: 1 }} />}

      {lightboxIndex !== null && (
        <Suspense fallback={null}>
          <Lightbox open index={lightboxIndex} close={() => setLightboxIndex(null)} slides={imageSlides} />
        </Suspense>
      )}

      {videoUrl && (
        <div className="media-viewer-overlay" onClick={() => setVideoUrl(null)}>
          <button className="media-viewer-close" onClick={() => setVideoUrl(null)}><X size={20} /></button>
          <div className="media-viewer-body" onClick={(e) => e.stopPropagation()}>
            <video src={videoUrl} controls autoPlay />
          </div>
        </div>
      )}
    </div>
  );
}
