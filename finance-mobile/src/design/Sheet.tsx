import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "./theme";
import { font, radius } from "./tokens";

type Props = {
  visible: boolean;
  onClose: () => void;
  judul?: string;
  sub?: string;
  children: React.ReactNode;
};

/** Bottom sheet sederhana (Modal). Isi permukaan glass tanpa blur — ringan di HP lama. */
export function Sheet({ visible, onClose, judul, sub, children }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} accessibilityLabel="Tutup" />
      <View
        style={{
          backgroundColor: colors.solid, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 20,
          borderTopWidth: 1, borderColor: colors.glassStroke,
        }}
      >
        <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.hairline, marginBottom: 14 }} />
        {judul ? <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 18 }}>{judul}</Text> : null}
        {sub ? <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 12 }}>{sub}</Text> : null}
        {children}
      </View>
    </Modal>
  );
}
