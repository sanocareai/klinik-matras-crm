import React from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/design/Screen";
import { Button, EmptyState } from "@/design/ui";

export default function TidakDitemukan() {
  const router = useRouter();
  return (
    <Screen>
      <EmptyState judul="Halaman tidak ditemukan" isi="Tautan ini tidak dikenali oleh aplikasi." />
      <Button label="Ke Beranda" onPress={() => router.replace("/")} style={{ marginTop: 16 }} />
      <Text />
    </Screen>
  );
}
