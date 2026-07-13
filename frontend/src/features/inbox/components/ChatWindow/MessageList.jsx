import React, { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { X } from "lucide-react";
import "yet-another-react-lightbox/styles.css";

// Fase G: lightbox cuma di-load saat foto pertama kali diklik, bukan ikut
// initial bundle chat (dipakai jarang dibanding teks/media dasar lainnya).
const Lightbox = lazy(() => import("yet-another-react-lightbox"));
import dayjs from "dayjs";
import MessageBubble from "./MessageBubble.jsx";
import { MessageListSkeleton } from "../Skeletons.jsx";
import { useMessagesForConv } from "../../stores/messageStore.js";
import { dateDividerLabel } from "../../utils/formatTime.js";

const START_INDEX = 1_000_000;
const PAGE_SIZE = 50;

// Fase G: posisi scroll per percakapan — Virtuoso di-key={conversationId}
// (full remount tiap ganti chat), jadi state internalnya tidak otomatis
// bertahan. Simpan snapshot resmi Virtuoso (getState/restoreStateFrom,
// lihat dok react-virtuoso) di Map level modul supaya "buka chat lain lalu
// balik lagi" mengembalikan posisi scroll, bukan selalu lompat ke bawah.
const scrollStateByConvId = new Map();

// Susun array flat [divider, message, message, divider, message, ...] dari
// window pesan yang sedang ditampilkan.
function buildItems(messages) {
  const items = [];
  let lastDateKey = null;
  for (const m of messages) {
    const dateKey = dayjs(m.createdAt).format("YYYY-MM-DD");
    if (dateKey !== lastDateKey) {
      items.push({ type: "divider", key: `divider-${dateKey}`, label: dateDividerLabel(m.createdAt) });
      lastDateKey = dateKey;
    }
    // key: pakai _key stabil (lihat messageStore.js#ensureKey), BUKAN m.id
    // langsung — id berubah saat entry optimistic (temp-...) direkonsiliasi
    // jadi id asli DB, kalau computeItemKey ikut berubah Virtuoso melihatnya
    // sebagai cell baru (remove+insert) alih-alih update in place.
    items.push({ type: "message", key: m._key || m.id, message: m });
  }
  return items;
}

// ⚠️ CATATAN: backend GET /:id/messages balikin SELURUH riwayat sekaligus
// (lihat useMessages.js) — jadi "load pesan lebih lama saat scroll ke atas"
// di bawah ini murni WINDOWING lokal (reveal lebih banyak dari array yang
// sudah lengkap di messageStore), bukan fetch baru ke server. Pola
// firstItemIndex tetap dipakai (mengikuti panduan resmi react-virtuoso
// "prepending items") supaya scroll position tidak lompat saat window
// diperlebar — perilakunya sama persis dari sudut pandang user meskipun
// datanya sudah ada di memori.
//
// Divider tanggal di sini TIDAK true CSS-sticky (butuh index-matching
// dengan Virtuoso yang berisiko meleset tanpa bisa dites visual di sini) —
// disederhanakan jadi divider inline bergaya pill, cukup jelas menandai
// pergantian hari meski tidak menempel di atas saat scroll. Kandidat
// perbaikan di fase berikutnya kalau perlu betul-betul sticky.
const MessageList = forwardRef(function MessageList(
  {
    conversation, onReply, onForward, onEdit, onRetry, loading,
    onDeleteLocal, onDeleteEveryone, onEnterSelection, selectionMode, selectedIds, onToggleSelect,
  },
  ref,
) {
  const conversationId = conversation?.id;
  const isGroup = conversation?.type === "GROUP";
  const allMessages = useMessagesForConv(conversationId);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const [highlightedId, setHighlightedId] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { type: 'image'|'video', url }

  const virtuosoRef = useRef(null);
  const isNewConvRef = useRef(true);
  const prependingRef = useRef(false);
  const prevItemCountRef = useRef(0);
  const pendingScrollIdRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const rangeChangeTimerRef = useRef(null);

  const windowed = useMemo(() => allMessages.slice(-visibleCount), [allMessages, visibleCount]);
  const items = useMemo(() => buildItems(windowed), [windowed]);

  // Reset window setiap ganti percakapan
  useEffect(() => {
    isNewConvRef.current = true;
    setVisibleCount(PAGE_SIZE);
    // Batalkan snapshot rangeChanged yang masih tertunda dari conversation
    // SEBELUMNYA — kalau dibiarkan jalan, closure-nya membawa conversationId
    // lama tapi virtuosoRef.current sudah menunjuk instance Virtuoso conv
    // BARU (key={conversationId} cuma remount <Virtuoso>, bukan MessageList
    // ini), jadi snapshot conv baru bisa salah tersimpan di slot conv lama.
    return () => clearTimeout(rangeChangeTimerRef.current);
  }, [conversationId]);

  // Jaga posisi scroll: firstItemIndex cuma di-mundurkan saat window
  // BENAR-BENAR diperlebar dari atas (prependingRef=true) — pesan baru yang
  // nempel di bawah (chat aktif nerima pesan masuk) tidak menyentuh ini.
  useEffect(() => {
    if (isNewConvRef.current) {
      setFirstItemIndex(START_INDEX);
      prevItemCountRef.current = items.length;
      isNewConvRef.current = false;
      prependingRef.current = false;
      return;
    }
    if (prependingRef.current) {
      const diff = items.length - prevItemCountRef.current;
      if (diff > 0) setFirstItemIndex((v) => v - diff);
      prependingRef.current = false;
    }
    prevItemCountRef.current = items.length;
  }, [items.length]);

  // Setelah window diperlebar untuk keperluan "jump to reply", baru scroll
  useEffect(() => {
    if (pendingScrollIdRef.current && !prependingRef.current) {
      const id = pendingScrollIdRef.current;
      pendingScrollIdRef.current = null;
      requestAnimationFrame(() => performScroll(id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  function findLocalIndexById(id) {
    return items.findIndex((it) => it.type === "message" && it.message.id === id);
  }

  function performScroll(id) {
    const idx = findLocalIndexById(id);
    if (idx === -1) return;
    virtuosoRef.current?.scrollToIndex({ index: idx, align: "center", behavior: "smooth" });
    setHighlightedId(id);
    clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 1600);
  }

  function scrollToMessage(id) {
    const rawIndex = allMessages.findIndex((m) => m.id === id);
    if (rawIndex === -1) return; // pesan tidak ada di percakapan ini sama sekali
    const needed = allMessages.length - rawIndex + 5; // buffer kecil
    if (needed > visibleCount) {
      prependingRef.current = true;
      pendingScrollIdRef.current = id;
      setVisibleCount(Math.min(needed, allMessages.length));
      return;
    }
    performScroll(id);
  }

  // Dipakai dari luar (index.jsx) untuk fitur InChatSearch — lompat ke
  // pesan hasil pencarian lewat ref, tanpa perlu prop-drilling tambahan.
  useImperativeHandle(ref, () => ({ scrollToMessage }));

  function handleStartReached() {
    if (visibleCount >= allMessages.length) return;
    prependingRef.current = true;
    setVisibleCount((v) => Math.min(v + PAGE_SIZE, allMessages.length));
  }

  function handleRetry(m) {
    onRetry?.(m);
  }

  if (!conversationId) return null;

  return (
    <div className="message-list-wrap">
      {items.length === 0 && loading ? (
        <MessageListSkeleton />
      ) : items.length === 0 ? (
        <div className="message-list-empty">Belum ada pesan di percakapan ini.</div>
      ) : (
        <Virtuoso
          key={conversationId}
          ref={virtuosoRef}
          className="message-virtuoso"
          data={items}
          firstItemIndex={firstItemIndex}
          {...(scrollStateByConvId.has(conversationId)
            ? { restoreStateFrom: scrollStateByConvId.get(conversationId) }
            : { initialTopMostItemIndex: items.length - 1 })}
          // BUG (fix): rangeChanged terpanggil pada SETIAP pergeseran window
          // render Virtuoso akibat scroll — bisa puluhan kali per gesture
          // scroll manual, TERLEPAS dari ada/tidaknya pesan baru (lihat
          // react-virtuoso type docs: "each time the list items are
          // rendered due to scrolling"). getState() sebelumnya dipanggil
          // sinkron pada SETIAP event itu (snapshot ukuran+posisi seluruh
          // list) — kerja berat berulang di main thread persis saat user
          // sedang scroll, inilah penyebab glitch/patah yang dilaporkan
          // (muncul sama saja baik chat diam maupun aktif terima pesan,
          // karena akar masalahnya bukan soal data, tapi frekuensi panggilan
          // ini). Snapshot cuma dipakai utk restore posisi scroll saat
          // BALIK ke percakapan ini nanti (bukan sesuatu yang perlu presisi
          // real-time) — debounce ke 1x per jeda scroll sudah lebih dari
          // cukup, dan menghapus kerja berulang itu dari tengah gesture scroll.
          rangeChanged={() => {
            clearTimeout(rangeChangeTimerRef.current);
            rangeChangeTimerRef.current = setTimeout(() => {
              virtuosoRef.current?.getState((state) => {
                scrollStateByConvId.set(conversationId, state);
              });
            }, 200);
          }}
          startReached={handleStartReached}
          followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
          computeItemKey={(_, item) => item.key}
          itemContent={(_, item) => {
            if (item.type === "divider") {
              return (
                <div className="date-divider-row">
                  <span className="date-divider-pill">{item.label}</span>
                </div>
              );
            }
            const m = item.message;
            return (
              <MessageBubble
                message={m}
                conversationId={conversationId}
                isGroup={isGroup}
                onReply={onReply}
                onForward={onForward}
                onEdit={onEdit}
                onJumpToReply={scrollToMessage}
                highlighted={highlightedId === m.id}
                onRetry={handleRetry}
                onOpenMedia={(type, url) => setLightbox({ type, url })}
                onDeleteLocal={onDeleteLocal}
                onDeleteEveryone={onDeleteEveryone}
                onEnterSelection={onEnterSelection}
                selectionMode={selectionMode}
                selected={selectedIds?.has(m.id)}
                onToggleSelect={onToggleSelect}
              />
            );
          }}
        />
      )}

      {/* Lightbox foto — mount (dan download chunk-nya) cuma saat benar-benar dibuka */}
      {lightbox?.type === "image" && (
        <Suspense fallback={null}>
          <Lightbox
            open
            close={() => setLightbox(null)}
            slides={[{ src: lightbox.url }]}
          />
        </Suspense>
      )}

      {/* Video fullscreen — dipakai class media-viewer yang sama dengan galeri Customer Panel */}
      {lightbox?.type === "video" && (
        <div className="media-viewer-overlay" onClick={() => setLightbox(null)}>
          <button className="media-viewer-close" onClick={() => setLightbox(null)} title="Tutup"><X size={20} /></button>
          <div className="media-viewer-body" onClick={(e) => e.stopPropagation()}>
            <video src={lightbox.url} controls autoPlay />
          </div>
        </div>
      )}
    </div>
  );
});

export default MessageList;
