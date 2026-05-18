// Lightweight Realtime-only Store fuer Online-Status und Tipp-Indikatoren.
// Keine Persistenz, kein Cache - reine ephemerale Live-Daten.
//
// Befuellt wird der Store vom useRealtime-Hook:
//   - Presence-Channel 'online'      -> setOnlineUsers / addOnline / removeOnline
//   - Broadcast 'typing:<groupId>'   -> markTyping(groupId, userId)
//
// Konsumiert wird er von der UI (z.B. GroupChatPanel) per useStatusStore().

import { create } from 'zustand';

const TYPING_TIMEOUT_MS = 4000;
const typingTimers = new Map(); // key = `${groupId}:${userId}` -> setTimeout handle

export const useStatusStore = create((set, get) => ({
  onlineUserIds: new Set(),
  // typing: Map<groupId, Set<userId>>
  typingByGroup: new Map(),

  setOnlineUsers: (userIds) => set({ onlineUserIds: new Set(userIds.map(Number)) }),
  addOnline: (userId) => set((s) => {
    const next = new Set(s.onlineUserIds);
    next.add(Number(userId));
    return { onlineUserIds: next };
  }),
  removeOnline: (userId) => set((s) => {
    const next = new Set(s.onlineUserIds);
    next.delete(Number(userId));
    return { onlineUserIds: next };
  }),

  markTyping: (groupId, userId) => {
    const gId = String(groupId);
    const uId = Number(userId);
    set((s) => {
      const map = new Map(s.typingByGroup);
      const setForGroup = new Set(map.get(gId) || []);
      setForGroup.add(uId);
      map.set(gId, setForGroup);
      return { typingByGroup: map };
    });
    // Auto-Cleanup: wenn keine neuen Tipp-Events nachkommen, nach 4s entfernen.
    const key = `${gId}:${uId}`;
    if (typingTimers.has(key)) clearTimeout(typingTimers.get(key));
    const handle = setTimeout(() => {
      typingTimers.delete(key);
      get().clearTyping(gId, uId);
    }, TYPING_TIMEOUT_MS);
    typingTimers.set(key, handle);
  },

  clearTyping: (groupId, userId) => set((s) => {
    const gId = String(groupId);
    const uId = Number(userId);
    const map = new Map(s.typingByGroup);
    const setForGroup = new Set(map.get(gId) || []);
    setForGroup.delete(uId);
    if (setForGroup.size === 0) map.delete(gId);
    else map.set(gId, setForGroup);
    return { typingByGroup: map };
  }),

  reset: () => set({ onlineUserIds: new Set(), typingByGroup: new Map() }),
}));

// Hilfs-Selektoren:
export const isUserOnline = (userId) => useStatusStore.getState().onlineUserIds.has(Number(userId));
export const getTypingInGroup = (groupId) => useStatusStore.getState().typingByGroup.get(String(groupId)) || new Set();
