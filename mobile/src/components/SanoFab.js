// Floating Action Button "Tanya Sano" — ikon Sparkles, pulse idle + scale
// tekan. Murni tombol (visual+animasi), sheet chat-nya ada di
// SanoChatSheet.js — dua-duanya digabung lewat SanoAssistant.js.
import React, { useEffect, useMemo } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Sparkles } from "lucide-react-native";
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, withRepeat, withSequence, Easing, cancelAnimation,
} from "react-native-reanimated";
import { useTokens } from "../constants/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const FAB_SIZE = 52;
import { useIsFocused } from "@react-navigation/native";

const PRESS_SCALE = 0.95;

export default function SanoFab({ onPress, bottomOffset = 16 }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const pulse = useSharedValue(1);
  const press = useSharedValue(1);

  const focused = useIsFocused();
  useEffect(() => {
    // Layar tidak aktif: hentikan denyut (animasi UI thread tak berhenti sendiri saat layar dibekukan).
    if (!focused) { cancelAnimation(pulse); pulse.value = 1; return; }
    // Idle: pulse scale 1 → 1.06, loop 2 detik, bolak-balik (reverse: true)
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [pulse, focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value * press.value }],
  }));

  function handlePressIn() {
    press.value = withTiming(PRESS_SCALE, { duration: 100 });
  }
  function handlePressOut() {
    press.value = withTiming(1, { duration: 100 });
  }

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.fab, { bottom: bottomOffset }, animatedStyle]}
    >
      <Sparkles size={24} color="#fff" strokeWidth={2.2} />
    </AnimatedPressable>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    fab: {
      position: "absolute", right: 16,
      width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2,
      backgroundColor: tokens.color.accent,
      alignItems: "center", justifyContent: "center",
      ...tokens.shadow.soft, shadowOpacity: 0.18, shadowRadius: 10, elevation: 5,
      zIndex: 20,
    },
  });
}
