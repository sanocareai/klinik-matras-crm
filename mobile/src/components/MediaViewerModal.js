// Modal fullscreen untuk foto/video — pinch zoom + swipe antar media (semua
// foto/video yang sudah termuat di percakapan ini, urut kronologis, mulai
// dari item yang di-tap). Tidak pakai library lightbox eksternal — pinch/pan
// dibangun manual pakai react-native-gesture-handler (sudah ada sejak M-B).
import React, { useEffect, useRef, useState } from "react";
import {
  Modal, View, Image, StyleSheet, Dimensions, TouchableOpacity, Text, FlatList,
} from "react-native";
// Ganti dari expo-av (deprecated, crash New Architecture — lihat
// mobile/CLAUDE.md) ke expo-video, API resmi pengganti sejak SDK 54+.
import { VideoView, useVideoPlayer } from "expo-video";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { X } from "lucide-react-native";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function ZoomableImage({ uri, onZoomChange }) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const baseScale = useRef(1);
  const baseTranslate = useRef({ x: 0, y: 0 });

  function resetZoom() {
    baseScale.current = 1;
    baseTranslate.current = { x: 0, y: 0 };
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    onZoomChange?.(false);
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = clamp(baseScale.current * e.scale, MIN_SCALE, MAX_SCALE);
      setScale(next);
      onZoomChange?.(next > 1.02);
    })
    .onEnd(() => {
      baseScale.current = scale;
      if (scale <= 1.02) resetZoom();
    });

  const pan = Gesture.Pan()
    .enabled(scale > 1.02)
    .onUpdate((e) => {
      setTranslate({
        x: baseTranslate.current.x + e.translationX,
        y: baseTranslate.current.y + e.translationY,
      });
    })
    .onEnd(() => {
      baseTranslate.current = translate;
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  return (
    <View style={styles.page}>
      <GestureDetector gesture={composed}>
        <Image
          source={{ uri }}
          resizeMode="contain"
          style={[
            styles.fullImage,
            { transform: [{ translateX: translate.x }, { translateY: translate.y }, { scale }] },
          ]}
        />
      </GestureDetector>
      {scale > 1.02 && (
        <TouchableOpacity style={styles.resetZoomBtn} onPress={resetZoom}>
          <Text style={styles.resetZoomText}>1:1</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function VideoPage({ uri, active }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });

  // useVideoPlayer tidak punya prop shouldPlay seperti expo-av — kontrol
  // play/pause manual mengikuti halaman mana yang lagi aktif di swiper.
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  return (
    <View style={styles.page}>
      <VideoView
        player={player}
        style={styles.fullImage}
        nativeControls
        contentFit="contain"
      />
    </View>
  );
}

// items: [{ id, type: 'image'|'video', url }], initialIndex: posisi awal
export default function MediaViewerModal({ visible, items, initialIndex = 0, onClose }) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const listRef = useRef(null);

  function onViewableItemsChanged({ viewableItems }) {
    if (viewableItems?.[0]) setActiveIndex(viewableItems[0].index ?? 0);
  }
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 60 });

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <X size={18} color="#fff" strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={styles.counter}>{activeIndex + 1} / {items.length}</Text>

        <FlatList
          ref={listRef}
          data={items}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
          keyExtractor={(item) => item.id}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfigRef.current}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item, index }) =>
            item.type === "video" ? (
              <VideoPage uri={item.url} active={index === activeIndex} />
            ) : (
              <ZoomableImage uri={item.url} onZoomChange={setZoomed} />
            )
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)" },
  page: { width: SCREEN_W, height: SCREEN_H, alignItems: "center", justifyContent: "center" },
  fullImage: { width: SCREEN_W, height: SCREEN_H },
  closeBtn: {
    position: "absolute", top: 44, right: 16, zIndex: 10,
    width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  closeText: { color: "#fff", fontSize: 18 },
  counter: {
    position: "absolute", top: 52, alignSelf: "center", zIndex: 10,
    color: "#fff", fontSize: 13, fontWeight: "600",
  },
  resetZoomBtn: {
    position: "absolute", bottom: 40, alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  resetZoomText: { color: "#fff", fontWeight: "700" },
});
