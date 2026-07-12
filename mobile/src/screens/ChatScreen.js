// ChatScreen (Fase M-C) — desain light-blue, paritas WA: semua varian bubble,
// reply/forward, VN, offline outbox. Pola SAMA dengan
// frontend/src/features/inbox/components/ChatWindow/index.jsx +
// MessageList.jsx + MessageBubble.jsx + Composer.jsx, diadaptasi ke RN.
//
// Windowing pesan: backend GET /:id/messages balikin SELURUH riwayat
// sekaligus (tidak ada pagination server) — "muat pesan lebih lama saat
// scroll ke atas" di sini murni WINDOWING lokal (reveal lebih banyak dari
// array yang sudah lengkap di messageStore), sama seperti versi web.
//
// Catatan FlashList v2: prop "inverted" (yang diminta prompt fase ini)
// SUDAH DIHAPUS dari FlashList v2 — API resminya sekarang
// maintainVisibleContentPosition.startRenderingFromBottom untuk chat UI
// (lihat dokumen paket), jadi list di bawah pakai itu, bukan inverted.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Modal,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import NetInfo from "@react-native-community/netinfo";
import {
  ChevronLeft, MoreVertical, WifiOff, X, Send, UserPlus, UserCog,
  Circle, CircleDot, CheckCircle2, RefreshCw, AlertTriangle,
} from "lucide-react-native";
import { api, mediaUrl } from "../api";
import { tokens } from "../constants/theme";
import { dateDividerLabel } from "../utils/format";
import { lightHaptic } from "../lib/haptics";
import Avatar from "../components/Avatar";
import PressableScale from "../components/PressableScale";
import { ChatListSkeleton } from "../components/SkeletonLoader";
import MessageBubble from "../components/MessageBubble";
import AttachComposer from "../components/AttachComposer";
import VoiceRecorderBar from "../components/VoiceRecorderBar";
import MediaViewerModal from "../components/MediaViewerModal";
import ForwardModal from "../components/ForwardModal";
import TransferModal from "../components/TransferModal";
import CustomerSheet from "../components/CustomerSheet";
import SanoAssistant from "../components/SanoAssistant";
import { useAuth } from "../context/AuthContext";
import { useConversationStore } from "../store/conversationStore";
import { useMessageStore, useMessagesForConv } from "../store/messageStore";
import { useComposerStore, useDraft, useReplyTarget } from "../store/composerStore";
import { useOutboxStore } from "../store/outboxStore";

const POLL_MS = 5000;
const PAGE_SIZE = 50;

// Lokasi/kontak/poll simpan JSON mentah di content (lihat MessageBubble.js)
// — jangan ditampilkan apa adanya di preview reply-bar, tampilkan label saja.
const STRUCTURED_MEDIA_LABEL = { location: "Lokasi", contact: "Kontak", poll: "Polling" };

const STATUS_OPTIONS = [
  { key: "OPEN", label: "Tandai Terbuka", Icon: CircleDot, color: tokens.color.accent },
  { key: "PENDING", label: "Tandai Pending", Icon: Circle, color: tokens.color.warning },
  { key: "RESOLVED", label: "Tandai Selesai", Icon: CheckCircle2, color: tokens.color.success },
];

// Susun array flat [divider, message, message, divider, ...] dari window
// pesan yang sedang ditampilkan.
function buildItems(messages) {
  const items = [];
  let lastDateKey = null;
  for (const m of messages) {
    const dateKey = new Date(m.createdAt).toDateString();
    if (dateKey !== lastDateKey) {
      items.push({ _type: "divider", id: `divider-${dateKey}`, label: dateDividerLabel(m.createdAt) });
      lastDateKey = dateKey;
    }
    items.push({ _type: "message", id: m.id, message: m });
  }
  return items;
}

export default function ChatScreen({ route, navigation }) {
  const { conversationId, name: routeName, isGroup: routeIsGroup, customerId: routeCustomerId } = route.params;
  const { user } = useAuth();

  const conversation = useConversationStore((s) => s.conversationsById[conversationId]);
  const allMessages = useMessagesForConv(conversationId);
  const draft = useDraft(conversationId);
  const replyTarget = useReplyTarget();

  const [text, setText] = useState(draft);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [highlightedId, setHighlightedId] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [mediaViewer, setMediaViewer] = useState(null); // { items, index }
  const [isOffline, setIsOffline] = useState(false);

  const listRef = useRef(null);
  const pollRef = useRef(null);
  const pendingScrollIdRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const customerSheetRef = useRef(null);

  const isGroup = conversation ? conversation.type === "GROUP" : !!routeIsGroup;
  const customerId = conversation?.customerId ?? routeCustomerId;
  const name = isGroup
    ? (conversation?.groupName || routeName || "Grup WhatsApp")
    : (conversation?.customer?.name || conversation?.customer?.phone || routeName || "Pelanggan");
  const assignedTo = conversation?.assignedTo;
  const isMine = assignedTo?.id === user?.id;
  const canTakeover = conversation?.canTakeOver ?? false;

  const load = useCallback(async (silent = false) => {
    try {
      const data = await api.getMessages(conversationId);
      useMessageStore.getState().setMessages(conversationId, data);
      // Cerminkan efek samping backend (isRead=true, unread=false) supaya
      // badge unread di Inbox hilang seketika, tidak perlu nunggu refetch list.
      useConversationStore.getState().upsertConversation({ id: conversationId, unread: false, isRead: true });
      setLoadError(null);
    } catch (err) {
      if (!silent) setLoadError(err.message || "Gagal memuat pesan");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [load]);

  // Join room socket percakapan ini selama layar dibuka (lihat useSocketEvents di App.js)
  useEffect(() => {
    useConversationStore.getState().setActive(conversationId);
    return () => useConversationStore.getState().setActive(null);
  }, [conversationId]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [conversationId]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => setIsOffline(state.isConnected === false));
    return unsubscribe;
  }, []);

  const windowed = useMemo(() => allMessages.slice(-visibleCount), [allMessages, visibleCount]);
  const items = useMemo(() => buildItems(windowed), [windowed]);

  // Semua foto/video yang sudah termuat di percakapan ini — dipakai swipe gallery MediaViewerModal.
  const galleryItems = useMemo(() => allMessages
    .filter((m) => (m.mediaType === "image" || m.mediaType === "video") && m.mediaUrl)
    .map((m) => ({ id: m.id, type: m.mediaType, url: mediaUrl(m.mediaUrl) })),
  [allMessages]);

  // Setelah window diperlebar demi "jump to reply", baru scroll (lihat scrollToMessage)
  useEffect(() => {
    if (!pendingScrollIdRef.current) return;
    const id = pendingScrollIdRef.current;
    const target = items.find((it) => it._type === "message" && it.message.id === id);
    if (!target) return;
    pendingScrollIdRef.current = null;
    requestAnimationFrame(() => {
      listRef.current?.scrollToItem({ item: target, animated: true, viewPosition: 0.5 });
      setHighlightedId(id);
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 1500);
    });
  }, [items]);

  // useCallback — dipakai sebagai prop MessageBubble (onJumpToReply) lewat
  // renderItem di bawah. Kalau bukan useCallback, fungsi ini (dan renderItem
  // yang menutupnya) dapat reference baru SETIAP render ChatScreen (termasuk
  // tiap keystroke di composer TextInput!), bikin SEMUA bubble yang lagi
  // kelihatan re-render walau pesannya sendiri tidak berubah — memo() di
  // MessageBubble jadi percuma. Ini akar masalah lag scroll MessageList.
  const scrollToMessage = useCallback((id) => {
    const rawIndex = allMessages.findIndex((m) => m.id === id);
    if (rawIndex === -1) return; // pesan belum ke-load sama sekali di percakapan ini
    const needed = allMessages.length - rawIndex + 5;
    if (needed > visibleCount) {
      pendingScrollIdRef.current = id;
      setVisibleCount(Math.min(needed, allMessages.length));
      return;
    }
    const target = items.find((it) => it._type === "message" && it.message.id === id);
    if (!target) return;
    listRef.current?.scrollToItem({ item: target, animated: true, viewPosition: 0.5 });
    setHighlightedId(id);
    clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 1500);
  }, [allMessages, visibleCount, items]);

  const handleStartReached = useCallback(() => {
    if (visibleCount >= allMessages.length) return;
    setVisibleCount((v) => Math.min(v + PAGE_SIZE, allMessages.length));
  }, [visibleCount, allMessages.length]);

  function handleChangeText(t) {
    setText(t);
    useComposerStore.getState().setDraft(conversationId, t);
  }

  async function handleSend() {
    const content = text.trim();
    if (!content || sending) return;
    lightHaptic();
    const currentReply = replyTarget;
    setSending(true);
    setText("");
    useComposerStore.getState().clearComposer(conversationId);

    const tempId = `temp-${Date.now()}`;
    useMessageStore.getState().appendMessage(conversationId, {
      id: tempId,
      conversationId,
      direction: "OUTBOUND",
      content,
      replyTo: currentReply || null,
      createdAt: new Date().toISOString(),
      status: "sending",
    });

    try {
      const msg = await api.sendMessage(
        conversationId, content, currentReply?.externalId || null, currentReply?.id || null,
      );
      useMessageStore.getState().replaceTempMessage(conversationId, tempId, msg);
    } catch (err) {
      // Gagal (kemungkinan offline di lapangan) — antre, dicoba otomatis lagi
      // begitu koneksi kembali (lihat src/lib/outboxFlush.js).
      useOutboxStore.getState().enqueue({
        convId: conversationId, tempId,
        payload: { content, quotedMessageId: currentReply?.externalId || null, replyToId: currentReply?.id || null },
      });
    } finally {
      setSending(false);
    }
  }

  const handleRetry = useCallback((m) => {
    const tempId = `temp-${Date.now()}`;
    useMessageStore.setState((state) => ({
      messagesByConvId: {
        ...state.messagesByConvId,
        [conversationId]: (state.messagesByConvId[conversationId] || [])
          .filter((x) => x.id !== m.id)
          .concat([{ ...m, id: tempId, status: "sending" }]),
      },
    }));
    api.sendMessage(conversationId, m.content, m.replyTo?.externalId || null, m.replyTo?.id || null)
      .then((msg) => useMessageStore.getState().replaceTempMessage(conversationId, tempId, msg))
      .catch(() => useOutboxStore.getState().enqueue({
        convId: conversationId, tempId, payload: { content: m.content },
      }));
  }, [conversationId]);

  async function changeStatus(status) {
    setShowMenu(false);
    try {
      const updated = await api.updateConversation(conversationId, { status });
      useConversationStore.getState().upsertConversation(updated);
    } catch (err) {
      Alert.alert("Gagal", err.message);
    }
  }

  async function doTakeover() {
    try {
      const updated = await api.takeoverConversation(conversationId);
      useConversationStore.getState().upsertConversation(updated);
    } catch (err) {
      Alert.alert("Gagal", err.message);
    }
  }

  // Ambil Percakapan (belum ada assignedToId) → langsung, tidak perlu konfirmasi.
  // Ambil Alih (dari sales lain) → konfirmasi dulu, sama seperti web (confirm()).
  function handleTakeover() {
    setShowMenu(false);
    if (assignedTo) {
      Alert.alert(
        "Ambil Alih Percakapan",
        `Percakapan ini sedang ditangani ${assignedTo.name}. Ambil alih sebagai lead kamu?`,
        [{ text: "Batal", style: "cancel" }, { text: "Ambil Alih", onPress: doTakeover }],
      );
    } else {
      doTakeover();
    }
  }

  const openMediaViewer = useCallback((msg) => {
    const idx = galleryItems.findIndex((x) => x.id === msg.id);
    setMediaViewer({ items: galleryItems, index: idx === -1 ? 0 : idx });
  }, [galleryItems]);

  // Stabil (tanpa dependency berubah-ubah) — dulu dibuat inline di dalam
  // renderItem (`onReply={(msg) => ...}`), jadi closure baru tiap render
  // walau isinya sama persis tiap kali. Sama seperti scrollToMessage dkk di
  // atas, ini yang bikin MessageBubble.memo() tidak pernah bisa bail-out.
  const handleReplyMessage = useCallback((msg) => {
    useComposerStore.getState().setReplyTarget(msg);
  }, []);
  const handleForwardMessage = useCallback((msg) => {
    setForwardMsg(msg);
  }, []);

  const renderItem = useCallback(({ item }) => {
    if (item._type === "divider") {
      return (
        <View style={styles.dividerWrap}>
          <Text style={styles.dividerText}>{item.label}</Text>
        </View>
      );
    }
    const m = item.message;
    return (
      <MessageBubble
        message={m}
        isGroup={isGroup}
        highlighted={highlightedId === m.id}
        onReply={handleReplyMessage}
        onForward={handleForwardMessage}
        onJumpToReply={scrollToMessage}
        onRetry={handleRetry}
        onOpenMedia={openMediaViewer}
      />
    );
  }, [isGroup, highlightedId, handleReplyMessage, handleForwardMessage, scrollToMessage, handleRetry, openMediaViewer]);

  return (
    // behavior="padding" di KEDUA platform (bukan "height" di Android) —
    // "height" mengubah tinggi terukur KeyboardAvoidingView sendiri, yang di
    // Android modern (edge-to-edge, default sejak Expo SDK 54+/RN 0.86)
    // sering meleset/telat mengikuti animasi keyboard sehingga composer
    // tetap ketutup. "padding" cuma menambah paddingBottom sebesar tinggi
    // keyboard, lebih konsisten di kedua platform. Header ada DI DALAM
    // (child) KeyboardAvoidingView ini, bukan di luar/sibling-nya, jadi
    // TIDAK perlu keyboardVerticalOffset — offset itu cuma untuk elemen
    // tetap di ATAS KeyboardAvoidingView yang bukan bagian dari view ini
    // (mis. header react-navigation bawaan, yang di app ini headerShown:
    // false / tidak dipakai).
    <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={0}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={26} color={tokens.color.textPrimary} strokeWidth={2.2} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerInfo}
          onPress={() => customerSheetRef.current?.open()}
        >
          <Avatar name={name} size={38} isGroup={isGroup} avatarUrl={conversation?.customer?.profilePictureUrl} />
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text style={styles.headerName} numberOfLines={1}>{name}</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {isGroup ? "Percakapan Grup" : (conversation?.customer?.phone || "Ketuk untuk info pelanggan")}
            </Text>
          </View>
        </TouchableOpacity>
        {!isGroup && (
          <TouchableOpacity onPress={() => setShowMenu(true)} style={styles.menuBtn}>
            <MoreVertical size={22} color={tokens.color.textPrimary} strokeWidth={2.2} />
          </TouchableOpacity>
        )}
      </View>

      {/* Daftar pesan */}
      {loading ? (
        <ChatListSkeleton />
      ) : loadError && items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <AlertTriangle size={36} color={tokens.color.danger} strokeWidth={1.6} style={{ marginBottom: 8 }} />
          <Text style={styles.emptyText}>Gagal memuat pesan</Text>
          <Text style={styles.errorDetail} numberOfLines={2}>{loadError}</Text>
          <PressableScale style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
            <RefreshCw size={14} color="#fff" strokeWidth={2.2} style={{ marginRight: 6 }} />
            <Text style={styles.retryBtnText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Belum ada pesan di percakapan ini</Text>
        </View>
      ) : (
        <FlashList
          ref={listRef}
          style={styles.list}
          data={items}
          keyExtractor={(item) => item.id}
          // Sebelumnya cuma dibedakan "divider" vs "message" — semua tipe
          // media (teks pendek ~57px, foto ~260px, audio ~75px, kartu
          // lokasi/kontak/poll ~110px) dipaksa masuk SATU pool recycling yang
          // sama. FlashList merecycle cell dalam 1 tipe yang sama, jadi kalau
          // ukurannya beda jauh, cell bekas foto dipakai ulang utk teks (atau
          // sebaliknya) → guncang/reflow tiap recycle, ini penyebab lag utama
          // di FlashList (bukan estimatedItemSize semata). Pisah per
          // mediaType supaya tiap pool isinya seragam.
          getItemType={(item) => (item._type === "divider" ? "divider" : (item.message.mediaType || "text"))}
          // BUG (fix): estimasi 57 SEBELUMNYA cuma pas untuk teks SATU
          // baris — pesan nyata mayoritas 1-2 baris (fontSize15 line-height
          // ~19-20px tiap baris), jadi estimasi yang representatif adalah
          // ~2 baris: paddingVertical 8*2=16 + text 2×~19=38 + metaRow
          // ~14+3 + row marginVertical 2*2=4 ≈ 75. Estimasi yang KETAT ke
          // kasus minimum (1 baris) justru bikin FlashList SERING salah
          // tebak ukuran pesan yang baru saja dikirim (kebanyakan >1 baris)
          // → tampak "glitch" scroll naik dikit tiap kirim pesan, saat
          // FlashList mengoreksi posisi setelah ukuran asli terukur.
          // getItemType di atas yang menangani tipe lain (foto/video/audio/dst).
          estimatedItemSize={75}
          maintainVisibleContentPosition={{
            startRenderingFromBottom: true,
            autoscrollToBottomThreshold: 0.2,
            autoscrollToTopThreshold: 0.2,
          }}
          onStartReached={handleStartReached}
          onStartReachedThreshold={0.3}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}
        />
      )}

      {/* Input kirim pesan — grup DULU cuma bisa dibaca (composer di-disable
          total), sekarang bisa balas juga (backend sudah handle groupJid
          sebagai target kirim, lihat resolveSendTarget di conversations.js —
          murni gating UI yang dihapus di sini). Indikator "Mengirim sebagai
          [nama]" gantikan banner "hanya bisa dibaca" lama, supaya sales sadar
          pesannya keluar atas nama akun mereka sendiri ke grup bersama. */}
      <>
          {isGroup && (
            <View style={styles.groupSenderBanner}>
              <Text style={styles.groupSenderBannerText} numberOfLines={1}>
                Mengirim sebagai {user?.name || "kamu"}
              </Text>
            </View>
          )}
          {assignedTo && !isMine && (
            <View style={styles.assignedBanner}>
              <Avatar name={assignedTo.name} avatarUrl={assignedTo.avatarUrl} size={20} />
              <Text style={styles.assignedBannerText} numberOfLines={1}>
                Ditangani oleh {assignedTo.name}
              </Text>
              <TouchableOpacity onPress={handleTakeover}>
                <Text style={styles.assignedBannerBtn}>Ambil Alih</Text>
              </TouchableOpacity>
            </View>
          )}
          {isOffline && (
            <View style={styles.offlineBanner}>
              <WifiOff size={14} color={styles.offlineBannerText.color} strokeWidth={2} style={{ marginRight: 6 }} />
              <Text style={styles.offlineBannerText}>Menunggu koneksi… pesan akan otomatis terkirim</Text>
            </View>
          )}
          {replyTarget && (
            <View style={styles.replyBar}>
              <View style={styles.replyBarAccent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.replyBarTitle}>
                  Membalas {replyTarget.direction === "OUTBOUND" ? "pesan kamu" : "pelanggan"}
                </Text>
                <Text style={styles.replyBarText} numberOfLines={1}>
                  {STRUCTURED_MEDIA_LABEL[replyTarget.mediaType]
                    || replyTarget.content
                    || (replyTarget.mediaType ? `[${replyTarget.mediaType}]` : "Pesan")}
                </Text>
              </View>
              <TouchableOpacity onPress={() => useComposerStore.getState().clearReply()}>
                <X size={18} color={tokens.color.textSecondary} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.inputBar}>
            <AttachComposer
              conversationId={conversationId}
              onSent={(msg) => useMessageStore.getState().appendMessage(conversationId, msg)}
            />
            <TextInput
              style={styles.input}
              placeholder="Ketik pesan…"
              placeholderTextColor={tokens.color.textMuted}
              value={text}
              onChangeText={handleChangeText}
              multiline
            />
            {text.trim() ? (
              <PressableScale
                style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={sending}
              >
                {sending ? <ActivityIndicator color="#fff" size="small" /> : <Send size={18} color="#fff" strokeWidth={2.2} />}
              </PressableScale>
            ) : (
              <VoiceRecorderBar
                conversationId={conversationId}
                onSent={(msg) => useMessageStore.getState().appendMessage(conversationId, msg)}
              />
            )}
          </View>
      </>

      {/* Menu aksi percakapan */}
      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowMenu(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Aksi Percakapan</Text>
            {!assignedTo && (
              <TouchableOpacity style={styles.sheetItemRow} onPress={handleTakeover}>
                <UserPlus size={17} color={tokens.color.textPrimary} strokeWidth={2} style={styles.sheetItemIcon} />
                <Text style={styles.sheetItemText}>Ambil Percakapan</Text>
              </TouchableOpacity>
            )}
            {assignedTo && !isMine && canTakeover && (
              <TouchableOpacity style={styles.sheetItemRow} onPress={handleTakeover}>
                <UserPlus size={17} color={tokens.color.textPrimary} strokeWidth={2} style={styles.sheetItemIcon} />
                <Text style={styles.sheetItemText}>Ambil Alih (belum dibalas 1j+)</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.sheetItemRow} onPress={() => { setShowMenu(false); setShowTransfer(true); }}>
              <UserCog size={17} color={tokens.color.textPrimary} strokeWidth={2} style={styles.sheetItemIcon} />
              <Text style={styles.sheetItemText}>Transfer ke Sales Lain</Text>
            </TouchableOpacity>
            {STATUS_OPTIONS.map((s) => (
              <TouchableOpacity key={s.key} style={styles.sheetItemRow} onPress={() => changeStatus(s.key)}>
                <s.Icon size={17} color={s.color} strokeWidth={2} style={styles.sheetItemIcon} />
                <Text style={styles.sheetItemText}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <TransferModal
        visible={showTransfer}
        conversationId={conversationId}
        currentAssignedId={assignedTo?.id}
        onClose={() => setShowTransfer(false)}
        onTransferred={(updated) => useConversationStore.getState().upsertConversation(updated)}
      />

      <ForwardModal visible={!!forwardMsg} message={forwardMsg} onClose={() => setForwardMsg(null)} />

      {mediaViewer && (
        <MediaViewerModal
          visible={!!mediaViewer}
          items={mediaViewer.items}
          initialIndex={mediaViewer.index}
          onClose={() => setMediaViewer(null)}
        />
      )}

      <CustomerSheet
        ref={customerSheetRef}
        conversation={conversation || {
          id: conversationId,
          type: isGroup ? "GROUP" : "INDIVIDUAL",
          customerId,
          groupName: isGroup ? name : undefined,
        }}
      />

      {/* "Tanya Sano" FAB — bottomOffset lebih tinggi dari Home supaya tidak
          menutupi composer/input bar di bawahnya. Konteks pelanggan
          dititipkan (lihat catatan di SanoChatSheet.js) — grup tidak punya
          konteks pelanggan tunggal, FAB tetap tampil tanpa context. */}
      <SanoAssistant bottomOffset={84} context={!isGroup ? { customerName: name } : null} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  header: {
    backgroundColor: tokens.color.card, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: tokens.color.border,
  },
  backBtn: { paddingHorizontal: 8 },
  backIcon: { color: tokens.color.textPrimary, fontSize: 30, lineHeight: 32 },
  headerInfo: { flexDirection: "row", alignItems: "center", flex: 1 },
  headerName: { color: tokens.color.textPrimary, fontSize: 16, fontWeight: "700" },
  headerSub: { color: tokens.color.textSecondary, fontSize: 11 },
  menuBtn: { paddingHorizontal: 12 },
  menuIcon: { color: tokens.color.textPrimary, fontSize: 22, fontWeight: "700" },
  list: { flex: 1 },
  dividerWrap: { alignItems: "center", marginVertical: 8 },
  dividerText: {
    backgroundColor: tokens.color.subtle, color: tokens.color.textSecondary, fontSize: 12,
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, overflow: "hidden",
  },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  emptyText: { color: tokens.color.textMuted, textAlign: "center" },
  errorDetail: { color: tokens.color.textMuted, fontSize: 12, marginTop: 4, textAlign: "center" },
  retryBtn: {
    flexDirection: "row", alignItems: "center", backgroundColor: tokens.color.accent,
    borderRadius: tokens.radius.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: 16,
  },
  retryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  groupSenderBanner: {
    backgroundColor: tokens.color.subtle, paddingVertical: 5, paddingHorizontal: 12,
  },
  groupSenderBannerText: { color: tokens.color.textMuted, fontSize: 11, textAlign: "center" },
  offlineBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#fef3c7", paddingVertical: 6, paddingHorizontal: 12,
  },
  offlineBannerText: { color: "#92400e", fontSize: 12, textAlign: "center" },
  assignedBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: tokens.color.accentSoft, paddingVertical: 8, paddingHorizontal: 12,
  },
  assignedBannerText: { color: tokens.color.accent, fontSize: 12, fontWeight: "600", flex: 1, marginLeft: 8, marginRight: 8 },
  assignedBannerBtn: { color: tokens.color.accent, fontSize: 12, fontWeight: "700", textDecorationLine: "underline" },
  replyBar: {
    flexDirection: "row", alignItems: "center", backgroundColor: tokens.color.subtle,
    paddingHorizontal: 10, paddingVertical: 8, gap: 8,
  },
  replyBarAccent: { width: 3, alignSelf: "stretch", backgroundColor: tokens.color.accent, borderRadius: 2 },
  replyBarTitle: { fontSize: 11, fontWeight: "700", color: tokens.color.accent },
  replyBarText: { fontSize: 12, color: tokens.color.textSecondary },
  replyBarClose: { fontSize: 15, color: tokens.color.textMuted, padding: 4 },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", padding: 8, gap: 4,
    backgroundColor: tokens.color.card, borderTopWidth: 1, borderTopColor: tokens.color.border,
  },
  input: {
    flex: 1, backgroundColor: tokens.color.subtle, borderRadius: tokens.radius.pill, paddingHorizontal: 16,
    paddingVertical: 9, fontSize: 15, maxHeight: 110, color: tokens.color.textPrimary,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: tokens.color.accent,
    alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.6 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 18, paddingBottom: 28,
  },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 8 },
  sheetItem: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border },
  sheetItemRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
  },
  sheetItemIcon: { marginRight: 10 },
  sheetItemText: { fontSize: 15, color: tokens.color.textPrimary },
});
