import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "../api";
import { createIdempotencyKey, isRetryableExecutionError, queueStorageKey } from "./executionCore";

const listeners = new Set();
let flushing = false;

function emit(userId, queue) {
  for (const listener of listeners) listener(userId, queue);
}

export function subscribeExecutionQueue(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function readExecutionQueue(userId) {
  const raw = await AsyncStorage.getItem(queueStorageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(userId, queue) {
  await AsyncStorage.setItem(queueStorageKey(userId), JSON.stringify(queue));
  emit(userId, queue);
}

async function stagePhotos(userId, idempotencyKey, photos) {
  if (!photos?.length) return [];
  const root = `${FileSystem.documentDirectory}driver-execution/${encodeURIComponent(userId)}/${idempotencyKey}/`;
  await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  const staged = [];
  for (let i = 0; i < photos.length; i += 1) {
    const source = photos[i];
    const target = `${root}${i}.jpg`;
    await FileSystem.copyAsync({ from: source.uri, to: target });
    staged.push({ uri: target, type: "image/jpeg", name: `${idempotencyKey}-${i}.jpg` });
  }
  return staged;
}

async function cleanupItem(item) {
  const first = item.photos?.[0]?.uri;
  if (!first) return;
  const dir = first.slice(0, first.lastIndexOf("/") + 1);
  try { await FileSystem.deleteAsync(dir, { idempotent: true }); } catch {}
}

export async function enqueueExecution({ userId, jobId = null, routeId = null, action, payload = {}, photos = [] }) {
  const idempotencyKey = createIdempotencyKey(userId.slice(0, 8));
  const staged = await stagePhotos(userId, idempotencyKey, photos);
  const item = {
    idempotencyKey, jobId, routeId, action, payload, photos: staged,
    uploadedUrls: [], createdAt: new Date().toISOString(), attempts: 0,
    lastError: null, blocked: false,
  };
  const queue = await readExecutionQueue(userId);
  queue.push(item);
  await writeQueue(userId, queue);
  return item;
}

async function uploadRemaining(userId, item, queue) {
  for (let i = item.uploadedUrls.length; i < item.photos.length; i += 1) {
    const result = await api.uploadJobPhoto(item.jobId, item.photos[i]);
    const url = result.urls?.[0] || result.url;
    if (!url) throw new Error("Server tidak mengembalikan URL foto");
    item.uploadedUrls.push(url);
    await writeQueue(userId, queue); // checkpoint setelah tiap file; retry tidak upload ulang file yang sudah sukses.
  }
}

async function sendItem(item) {
  const locationPayload = item.payload.location ? { location: item.payload.location } : {};
  if (item.action === "route-start") {
    return api.startRoute(item.routeId, { proofPhotoUrls: item.uploadedUrls }, item.idempotencyKey);
  }
  if (item.action === "start") return api.startArmadaJob(item.jobId, { proofPhotoUrls: item.uploadedUrls }, item.idempotencyKey);
  if (item.action === "arrive") return api.arriveArmadaJob(item.jobId, locationPayload, item.idempotencyKey);
  if (item.action === "complete") {
    return api.completeArmadaJob(item.jobId, {
      proofPhotoUrls: item.uploadedUrls,
      recipientName: item.payload.recipientName,
      note: item.payload.note,
      ...locationPayload,
    }, item.idempotencyKey);
  }
  if (item.action === "fail") {
    return api.failArmadaJob(item.jobId, {
      failureReason: item.payload.failureReason,
      failurePhotoUrls: item.uploadedUrls,
      note: item.payload.note,
      ...locationPayload,
    }, item.idempotencyKey);
  }
  throw Object.assign(new Error(`Aksi antrean tidak dikenal: ${item.action}`), { status: 400 });
}

export async function flushExecutionQueue(userId) {
  if (!userId || flushing) return { synced: 0 };
  flushing = true;
  let synced = 0;
  try {
    const queue = await readExecutionQueue(userId);
    for (let index = 0; index < queue.length;) {
      const item = queue[index];
      if (item.blocked) { index += 1; continue; }
      try {
        await uploadRemaining(userId, item, queue);
        await sendItem(item);
        await cleanupItem(item);
        queue.splice(index, 1);
        synced += 1;
        await writeQueue(userId, queue);
      } catch (error) {
        item.attempts += 1;
        item.lastError = error.message || "Gagal sinkronisasi";
        item.blocked = !isRetryableExecutionError(error);
        await writeQueue(userId, queue);
        // 401/token kedaluwarsa atau gangguan server/jaringan: hentikan batch,
        // pertahankan antrean untuk login/online berikutnya.
        break;
      }
    }
    return { synced, pending: queue.length };
  } finally {
    flushing = false;
  }
}

export async function removeExecution(userId, idempotencyKey) {
  const queue = await readExecutionQueue(userId);
  const item = queue.find((entry) => entry.idempotencyKey === idempotencyKey);
  if (item) await cleanupItem(item);
  const next = queue.filter((entry) => entry.idempotencyKey !== idempotencyKey);
  await writeQueue(userId, next);
}
