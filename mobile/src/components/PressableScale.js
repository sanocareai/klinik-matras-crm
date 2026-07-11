// Wrapper tekan-mengecil standar (scale 0.97) — dipakai di semua tombol/card
// interaktif baru supaya feel-nya konsisten (spec design refresh Apple-style).
// Reanimated sudah terpasang & jalan di project ini (lihat package.json).
import React from "react";
import { Pressable } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_SCALE = 0.97;
const DURATION = 100;

export default function PressableScale({ style, onPressIn, onPressOut, children, ...rest }) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  function handlePressIn(e) {
    scale.value = withTiming(PRESS_SCALE, { duration: DURATION });
    onPressIn?.(e);
  }
  function handlePressOut(e) {
    scale.value = withTiming(1, { duration: DURATION });
    onPressOut?.(e);
  }

  return (
    <AnimatedPressable
      style={[style, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
