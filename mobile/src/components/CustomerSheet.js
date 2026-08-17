// Bottom sheet Info Pelanggan — dibuka dari tap nama/avatar di header chat.
// INDIVIDUAL: delegasi penuh ke CustomerProfileContent.js (profil + pipeline
// + info + order + catatan) — SAMA PERSIS dengan yang dipakai
// CustomerDetailScreen.js (tab Pelanggan, full screen), diekstrak supaya
// tidak duplikasi logic. GROUP: nama grup + jumlah media (member count
// TIDAK tersedia — WAHA group-participants belum diintegrasikan backend,
// lihat catatan yang sama di
// frontend/src/features/inbox/components/CustomerPanel/GroupPanel.jsx) —
// TETAP di sini saja (bukan di CustomerProfileContent) karena tab
// Pelanggan/CustomerDetail tidak pernah berurusan dengan grup WhatsApp.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { ChevronRight, Shield } from "lucide-react-native";
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import { formatNomor } from "../utils/mention";
import Avatar from "./Avatar";
import CustomerProfileContent from "./CustomerProfileContent";
import GaleriMediaModal from "./GaleriMediaModal";
import { useMessagesForConv } from "../store/messageStore";

function Section({ title, children }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </View>
  );
}

const CustomerSheet = forwardRef(function CustomerSheet({ conversation }, ref) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const sheetRef = useRef(null);
  const snapPoints = useMemo(() => ["60%", "95%"], []);

  const isGroup = conversation?.type === "GROUP";
  const customerId = conversation?.customerId;
  const groupMessages = useMessagesForConv(conversation?.id);
  const mediaCount = useMemo(
    () => groupMessages.filter((m) => !!m.mediaType && !!m.mediaUrl).length,
    [groupMessages],
  );

  // Sheet TETAP mount di background antara buka/tutup (gorhom bottom-sheet
  // tidak unmount kontennya) — reloadKey dinaikkan tiap open() supaya data
  // customer di-refetch fresh tiap kali sheet dibuka (bukan cuma sekali di
  // mount pertama), sama seperti perilaku lama sebelum di-refactor.
  const [reloadKey, setReloadKey] = useState(0);
  const [showGaleri, setShowGaleri] = useState(false);

  // FITUR (tambahan, 17 Agt 2026): Info Grup ala WhatsApp — foto, deskripsi,
  // daftar anggota + badge Admin. Sebelumnya sheet grup cuma nama + hitungan
  // media, jauh dari yang diminta ("profile grup buat seperti whatsapp").
  const [groupInfo, setGroupInfo] = useState(null); // { name, topic, avatarUrl }
  const [members, setMembers] = useState([]);

  useImperativeHandle(ref, () => ({
    open: () => { setReloadKey((k) => k + 1); sheetRef.current?.present(); },
    close: () => sheetRef.current?.dismiss(),
  }), []);

  useEffect(() => {
    if (!isGroup || !conversation?.id) return;
    let alive = true;
    api.getGroupInfo(conversation.id).then((d) => { if (alive) setGroupInfo(d); }).catch(() => {});
    api.getParticipants(conversation.id).then((d) => { if (alive) setMembers(d); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, isGroup, reloadKey]);

  const renderBackdrop = useCallback((props) => (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
  ), []);

  if (isGroup) {
    const groupName = groupInfo?.name || conversation?.groupName || "Grup WhatsApp";
    const memberCount = members.length;
    return (
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: tokens.color.card }}
        handleIndicatorStyle={{ backgroundColor: tokens.color.border }}
      >
        <BottomSheetScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={styles.profile}>
            {groupInfo?.avatarUrl ? (
              <Image source={{ uri: groupInfo.avatarUrl }} style={styles.groupPhoto} contentFit="cover" />
            ) : (
              <Avatar name={groupName} isGroup size={88} />
            )}
            <Text style={styles.name}>{groupName}</Text>
            <Text style={styles.phone}>
              Grup{memberCount > 0 ? ` · ${memberCount} anggota` : ""}
            </Text>
          </View>

          {/* Deskripsi grup — read-only (WAHA belum kita pakai untuk MENGUBAH
              deskripsi, cuma menampilkan). String kosong (topic memang belum
              diisi admin grup) dibedakan dari null (gagal ambil/belum termuat)
              lewat pemeriksaan groupInfo terlebih dulu. */}
          {groupInfo && (
            <Section title="Deskripsi">
              <Text style={styles.detailValue}>
                {groupInfo.topic?.trim() || "Belum ada deskripsi grup"}
              </Text>
            </Section>
          )}

          <Section title={`Media (${mediaCount})`}>
            <TouchableOpacity
              style={styles.mediaLink}
              disabled={mediaCount === 0}
              onPress={() => setShowGaleri(true)}
            >
              <Text style={styles.detailValue}>
                {mediaCount > 0
                  ? `${mediaCount} foto/video/dokumen dibagikan di percakapan ini`
                  : "Belum ada media dibagikan"}
              </Text>
              {mediaCount > 0 && <ChevronRight size={16} color={tokens.color.textMuted} strokeWidth={2} />}
            </TouchableOpacity>
          </Section>

          {/* Daftar anggota — nama dari CRM (lewat nomor telepon) kalau ada,
              kalau tidak fallback ke nomor yang enak dibaca. TIDAK PERNAH
              menampilkan LID mentah ke pengguna (lihat backend
              GET /:id/participants & utils/mention.js). */}
          <Section title={`${memberCount} Anggota`}>
            <View style={{ marginTop: -4 }}>
              {members.map((m) => {
                const label = m.name || formatNomor(m.phone) || "Anggota";
                return (
                  <View key={m.phone || m.lid} style={styles.memberRow}>
                    <Avatar name={label} size={40} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.memberName} numberOfLines={1}>{label}</Text>
                      {!!m.name && !!m.phone && (
                        <Text style={styles.memberPhone} numberOfLines={1}>{formatNomor(m.phone)}</Text>
                      )}
                    </View>
                    {m.isAdmin && (
                      <View style={styles.adminBadge}>
                        <Shield size={11} color={tokens.color.accent} strokeWidth={2.4} />
                        <Text style={styles.adminBadgeText}>Admin</Text>
                      </View>
                    )}
                  </View>
                );
              })}
              {members.length === 0 && (
                <Text style={styles.detailValue}>Memuat daftar anggota…</Text>
              )}
            </View>
          </Section>
        </BottomSheetScrollView>
        <GaleriMediaModal
          visible={showGaleri}
          conversationId={conversation?.id}
          onClose={() => setShowGaleri(false)}
        />
      </BottomSheetModal>
    );
  }

  return (
    // BUG (fix): CustomerProfileContent di dalam sini punya banyak TextInput
    // (nama, catatan, dan sekarang field edit OrderCard.js — merk/ukuran/
    // keluhan/harga) — default gorhom bottom-sheet android_keyboardInputMode
    // = "adjustPan" (BUKAN "adjustResize"), yang cuma GESER seluruh sheet
    // ke atas sedikit alih-alih benar-benar resize area kontennya, jadi
    // field yang posisinya dekat bawah sheet (mis. Order, yang ada di
    // bagian bawah profil) tetap ketutup keyboard. android_keyboardInputMode
    // "adjustResize" + keyboardBehavior "interactive" bikin sheet ikut
    // resize proporsional sama seperti native adjustResize biasa;
    // keyboardBlurBehavior "restore" balikin sheet ke snap point semula
    // begitu keyboard ditutup (bukan nyangkut di posisi sempit).
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: tokens.color.card }}
      handleIndicatorStyle={{ backgroundColor: tokens.color.border }}
      android_keyboardInputMode="adjustResize"
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
    >
      <BottomSheetScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <CustomerProfileContent customerId={customerId} reloadKey={reloadKey} />
        <Section title={`Media (${mediaCount})`}>
          <TouchableOpacity
            style={styles.mediaLink}
            disabled={mediaCount === 0}
            onPress={() => setShowGaleri(true)}
          >
            <Text style={styles.detailValue}>
              {mediaCount > 0
                ? `${mediaCount} foto/video/dokumen dibagikan di percakapan ini`
                : "Belum ada media dibagikan"}
            </Text>
            {mediaCount > 0 && <ChevronRight size={16} color={tokens.color.textMuted} strokeWidth={2} />}
          </TouchableOpacity>
        </Section>
      </BottomSheetScrollView>
      <GaleriMediaModal
        visible={showGaleri}
        conversationId={conversation?.id}
        onClose={() => setShowGaleri(false)}
      />
    </BottomSheetModal>
  );
});

export default CustomerSheet;

function createStyles(tokens) {
  return StyleSheet.create({
    profile: { alignItems: "center", padding: 20 },
    name: { fontSize: 19, fontWeight: "700", color: tokens.color.textPrimary },
    phone: { fontSize: 14, color: tokens.color.textSecondary },
    section: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: tokens.color.border },
    sectionLabel: { fontSize: 12, fontWeight: "700", color: tokens.color.textMuted, marginBottom: 8, textTransform: "uppercase" },
    detailValue: { fontSize: 13, color: tokens.color.textPrimary, flex: 1 },
    mediaLink: { flexDirection: "row", alignItems: "center", gap: 6 },
    groupPhoto: { width: 88, height: 88, borderRadius: 44, backgroundColor: tokens.color.subtle },
    memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
    memberName: { fontSize: 14, fontWeight: "600", color: tokens.color.textPrimary },
    memberPhone: { fontSize: 12, color: tokens.color.textMuted, marginTop: 1 },
    adminBadge: {
      flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3,
      borderRadius: 999, backgroundColor: tokens.color.accentSoft,
    },
    adminBadgeText: { fontSize: 10.5, fontWeight: "700", color: tokens.color.accent },
  });
}
