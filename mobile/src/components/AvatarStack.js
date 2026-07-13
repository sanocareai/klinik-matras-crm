// AvatarStack — tumpuk beberapa avatar overlap + badge "+N" kalau ada lebih
// banyak dari yang ditampilkan. Dipakai ConversationItem utk item GRUP
// (ganti ikon grup statis 👥 lama). Backend belum expose daftar member grup
// (lihat CLAUDE.md "Conversation type GROUP" — cuma groupName yang tersimpan),
// jadi sekarang biasanya dipanggil dengan 1 avatar (nama grup) + badge ikon
// Users kecil di pojok menandakan ini grup. Komponen sengaja generic
// (avatars: [{name}], extraCount) supaya begitu backend expose member list
// asli, tinggal diisi tanpa ubah komponen ini.
import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Users } from "lucide-react-native";
import Avatar from "./Avatar";
import { useTokens } from "../constants/theme";

const OVERLAP = 0.42; // seberapa besar avatar berikutnya menutup yang sebelumnya

export default function AvatarStack({ avatars = [], size = 48, extraCount = 0, isGroup = false }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const shown = avatars.slice(0, 3);
  const stackWidth = size + Math.max(0, shown.length - 1) * size * (1 - OVERLAP);
  const badgeSize = size * 0.42;

  return (
    <View style={{ width: stackWidth, height: size }}>
      {shown.map((a, i) => (
        <View
          key={i}
          style={[
            styles.avatarWrap,
            { left: i * size * (1 - OVERLAP), zIndex: shown.length - i, borderRadius: size / 2 },
          ]}
        >
          <Avatar name={a.name} size={size} avatarUrl={a.avatarUrl} />
        </View>
      ))}
      {isGroup && (
        <View
          style={[
            styles.badge,
            { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: tokens.color.accent },
          ]}
        >
          <Users size={badgeSize * 0.58} color="#fff" strokeWidth={2.5} />
        </View>
      )}
      {extraCount > 0 && (
        <View
          style={[
            styles.badge,
            { minWidth: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: tokens.color.textSecondary, paddingHorizontal: 3 },
          ]}
        >
          <Text style={styles.countText}>+{extraCount}</Text>
        </View>
      )}
    </View>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    // borderColor dulu hardcode putih (asumsi selalu di atas background
    // putih) — sekarang ikut tokens.color.card supaya "cincin pemisah" ini
    // tetap masuk akal di dark mode (card gelap), bukan garis putih ganjil.
    avatarWrap: { position: "absolute", top: 0, borderWidth: 2, borderColor: tokens.color.card },
    badge: {
      position: "absolute", right: -2, bottom: -2,
      alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: tokens.color.card,
    },
    countText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  });
}
