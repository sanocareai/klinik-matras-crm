// Bottom sheet chat "Tanya Sano" — UI chat sederhana di atas endpoint AI
// Co-pilot yang SUDAH ADA (backend/src/routes/ai.js#copilot-chat, SAMA yang
// dipakai CoPilot.jsx web). State chat cukup di memori per sesi (tidak
// perlu persist — hilang begitu sheet ditutup, sesuai spec).
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from "react-native";
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import Markdown from "react-native-markdown-display";
import { Sparkles, Send } from "lucide-react-native";
import { useTokens } from "../constants/theme";
import { api } from "../api";
import PressableScale from "./PressableScale";

// Style markdown jawaban Sano — ikuti design system (font Inter, warna
// tokens.color.*), BUKAN default react-native-markdown-display. Cuma
// dipakai untuk bubble assistant (inbound) — bubble user tetap plain Text.
// Dibungkus function (dipanggil dgn useMemo di komponen) supaya reaktif
// ikut tema, sama seperti createStyles(tokens) di komponen lain.
function createMarkdownStyles(tokens) {
  return StyleSheet.create({
  body: { color: tokens.color.textPrimary, fontSize: 14, lineHeight: 20, fontFamily: tokens.font.regular },
  paragraph: { marginTop: 0, marginBottom: 6 },
  heading1: { fontFamily: tokens.font.semiBold, fontSize: 18, color: tokens.color.textPrimary, marginTop: 4, marginBottom: 6 },
  heading2: { fontFamily: tokens.font.semiBold, fontSize: 16, color: tokens.color.textPrimary, marginTop: 4, marginBottom: 6 },
  heading3: { fontFamily: tokens.font.semiBold, fontSize: 15, color: tokens.color.textPrimary, marginTop: 4, marginBottom: 4 },
  heading4: { fontFamily: tokens.font.semiBold, fontSize: 14, color: tokens.color.textPrimary, marginTop: 4, marginBottom: 4 },
  heading5: { fontFamily: tokens.font.semiBold, fontSize: 14, color: tokens.color.textPrimary, marginTop: 4, marginBottom: 4 },
  heading6: { fontFamily: tokens.font.semiBold, fontSize: 14, color: tokens.color.textPrimary, marginTop: 4, marginBottom: 4 },
  strong: { fontFamily: tokens.font.semiBold },
  em: { fontStyle: "italic" },
  link: { color: tokens.color.accent, textDecorationLine: "underline" },
  bullet_list: { marginBottom: 6 },
  ordered_list: { marginBottom: 6 },
  list_item: { marginBottom: 3 },
  bullet_list_icon: { color: tokens.color.textSecondary },
  ordered_list_icon: { color: tokens.color.textSecondary },
  code_inline: {
    backgroundColor: tokens.color.subtle, color: tokens.color.textPrimary,
    paddingHorizontal: 4, borderRadius: 4, fontSize: 13,
  },
  code_block: {
    backgroundColor: tokens.color.subtle, color: tokens.color.textPrimary,
    borderRadius: 8, padding: 10, fontSize: 13,
  },
  fence: {
    backgroundColor: tokens.color.subtle, color: tokens.color.textPrimary,
    borderRadius: 8, padding: 10, fontSize: 13,
  },
  blockquote: {
    backgroundColor: tokens.color.subtle, borderLeftWidth: 3, borderLeftColor: tokens.color.border,
    paddingHorizontal: 10, paddingVertical: 6, marginVertical: 6,
  },
  hr: { backgroundColor: tokens.color.border, height: StyleSheet.hairlineWidth, marginVertical: 8 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.color.border, borderRadius: 6, marginVertical: 6 },
  th: {
    padding: 6, fontFamily: tokens.font.semiBold, fontSize: 12, color: tokens.color.textPrimary,
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: tokens.color.border,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
  },
  tr: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.color.border },
    td: {
      padding: 6, fontSize: 12, color: tokens.color.textPrimary,
      borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: tokens.color.border,
    },
  });
}

// Tabel bisa lebih lebar dari bubble (85% layar) — bungkus dengan
// ScrollView horizontal supaya kolom tetap rapi (tidak terpotong/menumpuk),
// bukan mengubah maxWidth bubble (yang akan merusak word-wrap teks biasa).
const markdownRules = {
  table: (node, children, parentNodes, styles) => (
    <ScrollView key={node.key} horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles._VIEW_SAFE_table}>{children}</View>
    </ScrollView>
  ),
};

// context: { conversationId, customerName } opsional — dikirim dari
// ChatScreen. Endpoint copilot-chat TIDAK punya field conversationId/
// customer-context terpisah (sudah dicek dulu di ai.js & CoPilot.jsx web —
// keduanya plain { message, conversationHistory }), jadi konteks dititipkan
// sebagai entri PERTAMA di conversationHistory yang MEMANG sudah didukung
// endpoint ini — bukan field baru. Entri ini TIDAK dirender sebagai bubble
// di UI (invisible ke user), cuma ikut terkirim ke model tiap kali chat.
function buildContextSeed(context) {
  if (!context?.customerName) return null;
  return {
    role: "user",
    content: `[Konteks otomatis: sales sedang membuka percakapan WhatsApp dengan pelanggan "${context.customerName}". Anggap pertanyaan berikut terkait chat ini kecuali disebutkan lain.]`,
  };
}

const SanoChatSheet = forwardRef(function SanoChatSheet({ context }, ref) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const markdownStyles = useMemo(() => createMarkdownStyles(tokens), [tokens]);
  const sheetRef = useRef(null);
  const scrollRef = useRef(null);
  const snapPoints = useMemo(() => ["70%", "95%"], []);
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', content } — di memori saja
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // Auto-scroll ke bawah tiap kali ada bubble baru (pesan user, jawaban
  // Sano, atau bubble "mengetik") — BottomSheetScrollView forward ref
  // kompatibel dengan ScrollView biasa (lihat @gorhom/bottom-sheet v5).
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, sending]);

  useImperativeHandle(ref, () => ({
    open: () => sheetRef.current?.present(),
    close: () => sheetRef.current?.dismiss(),
  }), []);

  const renderBackdrop = (props) => (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
  );

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    const userMsg = { role: "user", content: text };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setSending(true);
    try {
      const contextSeed = buildContextSeed(context);
      const history = contextSeed ? [contextSeed, ...messages] : messages;
      const { reply } = await api.coPilotChat(text, history);
      setMessages([...newMsgs, { role: "assistant", content: reply }]);
    } catch (err) {
      Alert.alert("Gagal tanya Sano", err.message);
      // Buang pesan user yang gagal supaya tidak "menggantung" tanpa balasan.
      setMessages(messages);
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: tokens.color.card }}
      handleIndicatorStyle={{ backgroundColor: tokens.color.border }}
    >
      <View style={styles.header}>
        <Sparkles size={18} color={tokens.color.accent} strokeWidth={2.2} style={{ marginRight: 6 }} />
        <Text style={styles.headerTitle}>Tanya Sano</Text>
        {context?.customerName && (
          <View style={styles.contextChip}>
            <Text style={styles.contextChipText} numberOfLines={1}>{context.customerName}</Text>
          </View>
        )}
      </View>

      <BottomSheetScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent}>
        {messages.length === 0 && (
          <View style={styles.emptyWrap}>
            <Sparkles size={28} color={tokens.color.accent} strokeWidth={1.8} />
            <Text style={styles.emptyText}>
              Tanya apa saja soal produk, harga, atau cara jawab pelanggan — Sano bantu jawab.
            </Text>
          </View>
        )}
        {messages.map((m, i) => (
          <View
            key={i}
            style={[styles.bubbleRow, m.role === "user" ? styles.bubbleRowOut : styles.bubbleRowIn]}
          >
            <View style={[styles.bubble, m.role === "user" ? styles.bubbleOut : styles.bubbleIn]}>
              {m.role === "user" ? (
                <Text style={[styles.bubbleText, styles.bubbleTextOut]}>{m.content}</Text>
              ) : (
                <Markdown style={markdownStyles} rules={markdownRules}>{m.content}</Markdown>
              )}
            </View>
          </View>
        ))}
        {sending && (
          <View style={[styles.bubbleRow, styles.bubbleRowIn]}>
            <View style={[styles.bubble, styles.bubbleIn, styles.typingBubble]}>
              <ActivityIndicator size="small" color={tokens.color.textMuted} />
              <Text style={styles.typingText}>Sano mengetik…</Text>
            </View>
          </View>
        )}
      </BottomSheetScrollView>

      <View style={styles.inputBar}>
        <BottomSheetTextInput
          style={styles.input}
          placeholder="Tanya Sano…"
          placeholderTextColor={tokens.color.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
        />
        <PressableScale
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          <Send size={18} color="#fff" strokeWidth={2.2} />
        </PressableScale>
      </View>
    </BottomSheetModal>
  );
});

export default SanoChatSheet;

function createStyles(tokens) {
  return StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10 },
  headerTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, flex: 1 },
  contextChip: {
    backgroundColor: tokens.color.accentSoft, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 140,
  },
  contextChipText: { fontSize: 11, fontWeight: "600", color: tokens.color.accent },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 16, flexGrow: 1 },
  emptyWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 13, color: tokens.color.textMuted, textAlign: "center", paddingHorizontal: 20 },
  bubbleRow: { width: "100%", marginBottom: 8 },
  bubbleRowOut: { alignItems: "flex-end" },
  bubbleRowIn: { alignItems: "flex-start" },
  bubble: {
    maxWidth: "85%", borderRadius: tokens.radius.bubble, paddingHorizontal: 12, paddingVertical: 9,
  },
  bubbleOut: { backgroundColor: tokens.color.accent, borderBottomRightRadius: tokens.radius.bubbleTail },
  bubbleIn: {
    backgroundColor: tokens.color.subtle, borderBottomLeftRadius: tokens.radius.bubbleTail,
  },
  bubbleText: { fontSize: 14, color: tokens.color.textPrimary, lineHeight: 20 },
  bubbleTextOut: { color: "#fff" },
  typingBubble: { flexDirection: "row", alignItems: "center", gap: 8 },
  typingText: { fontSize: 13, color: tokens.color.textMuted, fontStyle: "italic" },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.color.border,
  },
  input: {
    flex: 1, backgroundColor: tokens.color.subtle, borderRadius: tokens.radius.pill, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 14, maxHeight: 100, color: tokens.color.textPrimary,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: tokens.color.accent,
    alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.5 },
  });
}
