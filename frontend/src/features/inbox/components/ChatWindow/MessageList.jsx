import React, { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { X, ArrowDown } from "lucide-react";
import "yet-another-react-lightbox/styles.css";

// Fase G: lightbox cuma di-load saat foto pertama kali diklik, bukan ikut
// initial bundle chat (dipakai jarang dibanding teks/media dasar lainnya).
const Lightbox = lazy(() => import("yet-another-react-lightbox"));
import dayjs from "dayjs";
import MessageBubble from "./MessageBubble.jsx";
import { MessageListSkeleton } from "../Skeletons.jsx";
import { useMessageStore, useMessagesForConv, useHasMoreForConv } from "../../stores/messageStore.js";
import { loadOlderMessages } from "../../hooks/useMessages.js";
import { dateDividerLabel } from "../../utils/formatTime.js";

const START_INDEX = 1_000_000;
const PAGE_SIZE = 50;

// Fase G: posisi scroll per percakapan — Virtuoso di-key={conversationId}
// (full remount tiap ganti chat), jadi state internalnya tidak otomatis
// bertahan. Simpan snapshot resmi Virtuoso (getState/restoreStateFrom,
// lihat dok react-virtuoso) di Map level modul supaya "buka chat lain lalu
// balik lagi" mengembalikan posisi scroll, bukan selalu lompat ke bawah.
const scrollStateByConvId = new Map();

// Wave 7 (redesign Inbox, plan starry-humming-knuth) — pengelompokan pesan
// beruntun dari pengirim yang sama. "Sama pengirim" untuk OUTBOUND/INBOUND
// di chat individual cukup `direction` (tidak ada identitas sales-per-pesan
// di data ini — grep dikonfirmasi, jadi tidak ada info yang HILANG dengan
// menggabungkan visual antar sales berbeda yang sama-sama membalas). Untuk
// pesan MASUK di grup, pakai `senderName` (field yang SUDAH ada, dipakai
// label nama pengirim) supaya 2 anggota grup berbeda tidak ikut tergabung.
// Jeda >5 menit MEMUTUS grup walau pengirimnya sama (gaya WA/Slack) — dua
// pesan yang kebetulan searah tapi terpisah jauh waktunya tidak masuk akal
// dianggap "satu giliran ngomong".
const GROUP_GAP_MS = 5 * 60 * 1000;

function messageGroupKey(m, isGroup) {
  if (isGroup && m.direction === "INBOUND") return `in:${m.senderName || m.id}`;
  return m.direction;
}

// Susun array flat [divider, message, message, divider, message, ...] dari
// window pesan yang sedang ditampilkan.
function buildItems(messages, isGroup) {
  const items = [];
  let lastDateKey = null;
  let prevMsg = null;
  for (const m of messages) {
    // Kunci hari (kalender device, sama dengan dayjs lokal) tanpa dayjs: dihitung untuk SETIAP
    // pesan tiap kali daftar dibangun ulang (ratusan pesan per pesan baru).
    const dt = new Date(m.createdAt);
    const dateKey = dt.getFullYear() * 10000 + (dt.getMonth() + 1) * 100 + dt.getDate();
    if (dateKey !== lastDateKey) {
      items.push({ type: "divider", key: `divider-${dateKey}`, label: dateDividerLabel(m.createdAt) });
      lastDateKey = dateKey;
      prevMsg = null; // divider SELALU memutus grup, apa pun isi pesannya
    }
    const isFirstInGroup = !prevMsg
      || messageGroupKey(prevMsg, isGroup) !== messageGroupKey(m, isGroup)
      || (new Date(m.createdAt).getTime() - new Date(prevMsg.createdAt).getTime()) > GROUP_GAP_MS;
    // key: pakai _key stabil (lihat messageStore.js#ensureKey), BUKAN m.id
    // langsung — id berubah saat entry optimistic (temp-...) direkonsiliasi
    // jadi id asli DB, kalau computeItemKey ikut berubah Virtuoso melihatnya
    // sebagai cell baru (remove+insert) alih-alih update in place.
    items.push({ type: "message", key: m._key || m.id, message: m, isFirstInGroup });
    prevMsg = m;
  }
  // Pass kedua: isLastInGroup butuh lihat item BERIKUTNYA (belum ada saat
  // item ini pertama kali di-push di loop atas), jadi baru bisa dihitung
  // setelah array-nya lengkap. Item TERAKHIR sebelum divider berikutnya
  // (atau akhir array) otomatis jadi penutup grup.
  for (let i = 0; i < items.length; i++) {
    if (items[i].type !== "message") continue;
    const next = items[i + 1];
    items[i].isLastInGroup = !next || next.type === "divider" || next.isFirstInGroup;
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
    conversation, onReply, onForward, onEdit, onRetry, loading, mentionMap,
    onDeleteLocal, onDeleteEveryone, onEnterSelection, selectionMode, selectedIds, onToggleSelect,
  },
  ref,
) {
  const conversationId = conversation?.id;
  const isGroup = conversation?.type === "GROUP";
  const allMessages = useMessagesForConv(conversationId);
  const hasMore = useHasMoreForConv(conversationId);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const [highlightedId, setHighlightedId] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { type: 'image'|'video', url }

  // Callback dari ChatWindow dibuat ulang tiap render ChatWindow (inline). Kalau diteruskan
  // langsung ke MessageBubble, React.memo-nya percuma: SETIAP pesan baru/ketikan me-render
  // semua bubble yang tampil. Pembungkus stabil di bawah membaca versi terbaru lewat ref.
  const cbRef = useRef({});
  cbRef.current = { onReply, onForward, onEdit, onRetry, onDeleteLocal, onDeleteEveryone, onEnterSelection, onToggleSelect, scrollToMessage };
  const stable = useMemo(() => ({
    onReply: (...a) => cbRef.current.onReply?.(...a),
    onForward: (...a) => cbRef.current.onForward?.(...a),
    onEdit: (...a) => cbRef.current.onEdit?.(...a),
    onRetry: (...a) => cbRef.current.onRetry?.(...a),
    onDeleteLocal: (...a) => cbRef.current.onDeleteLocal?.(...a),
    onDeleteEveryone: (...a) => cbRef.current.onDeleteEveryone?.(...a),
    onEnterSelection: (...a) => cbRef.current.onEnterSelection?.(...a),
    onToggleSelect: (...a) => cbRef.current.onToggleSelect?.(...a),
    onJumpToReply: (...a) => cbRef.current.scrollToMessage?.(...a),
    onOpenMedia: (type, url) => setLightbox({ type, url }),
  }), []);

  const virtuosoRef = useRef(null);
  const isNewConvRef = useRef(true);
  const prependingRef = useRef(false);
  const prevItemCountRef = useRef(0);
  const pendingScrollIdRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const rangeChangeTimerRef = useRef(null);

  const windowed = useMemo(() => allMessages.slice(-visibleCount), [allMessages, visibleCount]);
  const items = useMemo(() => buildItems(windowed, isGroup), [windowed, isGroup]);

  // Wave 7 — "N pesan baru ↓" menggantikan lompatan senyap saat user sedang
  // baca riwayat lama (scroll ke atas) lalu pesan baru masuk. followOutput
  // (di bawah) SUDAH benar menangani kasus "user memang di bawah" (auto-
  // scroll smooth) — dua mekanisme ini SENGAJA tidak saling override:
  // pill cuma nambah kalau `!isAtBottom` PAS pesan baru masuk.
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const prevMessageCountRef = useRef(0);
  const prevLastKeyRef = useRef(null);

  // Reset window setiap ganti percakapan
  useEffect(() => {
    isNewConvRef.current = true;
    setVisibleCount(PAGE_SIZE);
    setIsAtBottom(true);
    setNewMessageCount(0);
    // Batalkan snapshot rangeChanged yang masih tertunda dari conversation
    // SEBELUMNYA — kalau dibiarkan jalan, closure-nya membawa conversationId
    // lama tapi virtuosoRef.current sudah menunjuk instance Virtuoso conv
    // BARU (key={conversationId} cuma remount <Virtuoso>, bukan MessageList
    // ini), jadi snapshot conv baru bisa salah tersimpan di slot conv lama.
    return () => clearTimeout(rangeChangeTimerRef.current);
  }, [conversationId]);

  // Hitung pesan baru yang masuk SEMENTARA user tidak di bawah. `isAtBottom`
  // sengaja jadi dependency (bukan cuma dibaca lewat ref) — begitu user
  // scroll balik ke bawah sendiri, effect ini ikut jalan ulang tapi
  // `newCount > prevCount` sudah pasti false (panjang tidak berubah), jadi
  // aman no-op, cuma handleAtBottomStateChange di bawah yang mereset counter.
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const newCount = allMessages.length;
    // Hanya hitung kalau pesan TERAKHIR berubah — memuat halaman riwayat lama
    // (prepend) menambah panjang array tapi bukan "pesan baru".
    const lastKey = allMessages[newCount - 1]?._key ?? null;
    if (newCount > prevCount && !isAtBottom && lastKey !== prevLastKeyRef.current) {
      setNewMessageCount((c) => c + (newCount - prevCount));
    }
    prevMessageCountRef.current = newCount;
    prevLastKeyRef.current = lastKey;
  }, [allMessages.length, isAtBottom]);

  function handleAtBottomStateChange(atBottom) {
    setIsAtBottom(atBottom);
    if (atBottom) setNewMessageCount(0);
  }

  function scrollToBottom() {
    virtuosoRef.current?.scrollToIndex({ index: items.length - 1, align: "end", behavior: "smooth" });
    setNewMessageCount(0);
  }

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

  async function scrollToMessage(id) {
    let rawIndex = allMessages.findIndex((m) => m.id === id);
    // Pesan (mis. yang dikutip reply) mungkin lebih lama dari yang sudah dimuat —
    // muat halaman lama bertahap (maks 10 halaman) sampai ketemu.
    for (let i = 0; rawIndex === -1 && i < 10 && useMessageStore.getState().hasMoreByConvId[conversationId]; i++) {
      const added = await loadOlderMessages(conversationId);
      if (!added) break;
      rawIndex = (useMessageStore.getState().messagesByConvId[conversationId] || []).findIndex((m) => m.id === id);
    }
    if (rawIndex === -1) return; // pesan tidak ada di percakapan ini sama sekali
    const total = (useMessageStore.getState().messagesByConvId[conversationId] || []).length;
    if (total !== allMessages.length) {
      // Riwayat baru dimuat: perlebar window supaya target masuk, scroll setelah render
      prependingRef.current = true;
      pendingScrollIdRef.current = id;
      setVisibleCount(Math.min(total - rawIndex + 5, total));
      return;
    }
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

  async function handleStartReached() {
    if (visibleCount < allMessages.length) {
      prependingRef.current = true;
      setVisibleCount((v) => Math.min(v + PAGE_SIZE, allMessages.length));
      return;
    }
    // Semua yang sudah di memori sudah tampil → minta halaman lebih lama ke server.
    if (!hasMore) return;
    const added = await loadOlderMessages(conversationId);
    if (added > 0) {
      prependingRef.current = true;
      setVisibleCount((v) => v + added);
    }
  }

  function handleRetry(m) {
    onRetry?.(m);
  }

  // itemContent STABIL: Virtuoso me-render ulang semua baris tampil kalau identitas fungsi ini
  // berubah. Deps hanya nilai yang memang mengubah tampilan bubble.
  const hasEdit = !!onEdit, hasDelLocal = !!onDeleteLocal, hasDelAll = !!onDeleteEveryone;
  const renderItem = useCallback((_, item) => {
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
        isFirstInGroup={item.isFirstInGroup}
        isLastInGroup={item.isLastInGroup}
        mentionMap={mentionMap}
        onReply={stable.onReply}
        onForward={stable.onForward}
        onEdit={hasEdit ? stable.onEdit : undefined}
        onJumpToReply={stable.onJumpToReply}
        highlighted={highlightedId === m.id}
        onRetry={stable.onRetry}
        onOpenMedia={stable.onOpenMedia}
        onDeleteLocal={hasDelLocal ? stable.onDeleteLocal : undefined}
        onDeleteEveryone={hasDelAll ? stable.onDeleteEveryone : undefined}
        onEnterSelection={stable.onEnterSelection}
        selectionMode={selectionMode}
        selected={selectedIds?.has(m.id)}
        onToggleSelect={stable.onToggleSelect}
      />
    );
  }, [conversationId, isGroup, mentionMap, highlightedId, selectionMode, selectedIds, stable, hasEdit, hasDelLocal, hasDelAll]);

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
          followOutput={(atBottom) => (atBottom ? "smooth" : false)}
          atBottomStateChange={handleAtBottomStateChange}
          computeItemKey={(_, item) => item.key}
          itemContent={renderItem}
        />
      )}

      {/* Wave 7 — muncul HANYA saat ada pesan baru masuk sementara user
          scroll ke atas baca riwayat lama (isAtBottom false). Kalau user
          memang di bawah, followOutput di atas sudah auto-scroll smooth,
          pill ini tidak pernah tampil (tidak ada gunanya). */}
      {newMessageCount > 0 && (
        <button type="button" className="new-messages-pill" onClick={scrollToBottom}>
          <ArrowDown size={14} /> {newMessageCount} pesan baru
        </button>
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
