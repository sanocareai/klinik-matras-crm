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
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useTokens } from "../constants/theme";
import Avatar from "./Avatar";
import CustomerProfileContent from "./CustomerProfileContent";
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

  useImperativeHandle(ref, () => ({
    open: () => { setReloadKey((k) => k + 1); sheetRef.current?.present(); },
    close: () => sheetRef.current?.dismiss(),
  }), []);

  const renderBackdrop = useCallback((props) => (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
  ), []);

  if (isGroup) {
    const groupName = conversation?.groupName || "Grup WhatsApp";
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
            <Avatar name={groupName} isGroup size={72} />
            <Text style={styles.name}>{groupName}</Text>
            <Text style={styles.phone}>Percakapan Grup WhatsApp</Text>
          </View>
          <Section title={`Media (${mediaCount})`}>
            <Text style={styles.detailValue}>
              {mediaCount > 0
                ? `${mediaCount} foto/video/dokumen dibagikan di percakapan ini`
                : "Belum ada media dibagikan"}
            </Text>
          </Section>
        </BottomSheetScrollView>
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
      </BottomSheetScrollView>
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
    detailValue: { fontSize: 13, color: tokens.color.textPrimary },
  });
}
