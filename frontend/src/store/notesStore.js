import { create } from 'zustand';
import { api } from '../utils/api';

const NOTES_CACHE_KEY = 'beequ_notes_cache_v1';

function getNotesCacheKey() {
  try {
    const token = localStorage.getItem('token') || 'anon';
    return `${NOTES_CACHE_KEY}:${token.slice(0, 24)}`;
  } catch {
    return `${NOTES_CACHE_KEY}:anon`;
  }
}

function readNotesCache() {
  try {
    const raw = localStorage.getItem(getNotesCacheKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeNotesCache(notes) {
  try {
    localStorage.setItem(getNotesCacheKey(), JSON.stringify(Array.isArray(notes) ? notes : []));
  } catch {
    // ignore quota/security errors
  }
}

export const useNotesStore = create((set, get) => ({
  notes: readNotesCache(),
  loading: false,
  error: null,
  lastFetchAt: 0,

  // Fetch notes from backend
  fetchNotes: async (options = {}) => {
    const now = Date.now();
    const maxAgeMs = 15000;
    const force = options?.force === true;

    if (!force && now - get().lastFetchAt < maxAgeMs) {
      return get().notes;
    }

    set({ loading: true });
    try {
      const [ownData, sharedData] = await Promise.all([
        api.getNotes?.(),
        api.getSharedNotes?.().catch((err) => {
          console.warn('[notesStore] getSharedNotes failed:', err?.message || err);
          return { notes: [] };
        }),
      ]);

      const ownNotes = ownData?.notes || [];
      const sharedNotes = sharedData?.notes || [];

      const mergedById = new Map();
      ownNotes.forEach((note) => {
        mergedById.set(String(note.id), note);
      });
      sharedNotes.forEach((note) => {
        const key = String(note.id);
        if (mergedById.has(key)) return;
        mergedById.set(key, { ...note, is_shared_note: true });
      });

      const notes = [...mergedById.values()];
      writeNotesCache(notes);
      set({ notes, loading: false, error: null, lastFetchAt: now });
      return notes;
    } catch (err) {
      const cached = readNotesCache();
      if (cached.length > 0) {
        set({ notes: cached, error: null, loading: false });
        return cached;
      }
      set({ error: err.message, loading: false });
      return get().notes;
    }
  },

  // Create new note
  createNote: async (noteData) => {
    try {
      const result = await api.createNote?.(noteData);
      const serverNote = result?.note;

      // Merge: server data takes priority (id, timestamps) but input data fills gaps
      // so participant_ids / responsible_user_id from the form are never lost
      const newNote = serverNote
        ? {
            ...noteData,
            ...serverNote,
            participant_ids: serverNote.participant_ids ?? noteData.participant_ids ?? [],
            responsible_user_id: serverNote.responsible_user_id ?? noteData.responsible_user_id ?? null,
          }
        : noteData;

      set((s) => {
        const updated = [...s.notes, newNote];
        writeNotesCache(updated);
        return { notes: updated };
      });
      return newNote;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Update existing note
  updateNote: async (noteId, updates) => {
    try {
      const result = await api.updateNote?.(noteId, updates);
      const serverNote = result?.note;

      // Merge: preserve participant data from updates if server didn't return it
      const merged = serverNote
        ? {
            ...updates,
            ...serverNote,
            participant_ids: serverNote.participant_ids ?? updates.participant_ids,
            responsible_user_id: serverNote.responsible_user_id ?? updates.responsible_user_id,
          }
        : updates;

      set((s) => {
        // Use String comparison to avoid number/string type mismatch
        const updated = s.notes.map((n) =>
          String(n.id) === String(noteId) ? { ...n, ...merged } : n
        );
        writeNotesCache(updated);
        return { notes: updated };
      });
      return merged;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Delete note
  deleteNote: async (noteId) => {
    try {
      await api.deleteNote?.(noteId);
      set((s) => {
        const updated = s.notes.filter((n) => n.id !== noteId);
        writeNotesCache(updated);
        return { notes: updated };
      });
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Link note to task/event
  linkNoteToTask: async (noteId, taskId) => {
    try {
      await api.linkNoteToTask?.(noteId, taskId);
      const updated = await get().updateNote(noteId, { linked_task_id: taskId });
      return updated;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Share note with friend
  shareNoteWithFriend: async (noteId, friendId, permission = 'view') => {
    try {
      const result = await api.shareNote?.(noteId, { friend_id: friendId, permission });
      return result;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Remove note share for friend
  unshareNoteForFriend: async (noteId, friendId) => {
    try {
      const result = await api.unshareNote?.(noteId, friendId);
      return result;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Get notes shared with me
  getSharedNotes: async () => {
    try {
      const data = await api.getSharedNotes?.();
      return data?.notes || [];
    } catch (err) {
      set({ error: err.message });
      return [];
    }
  },

  // Create note connection
  connectNotes: async (noteId1, noteId2, relationshipType = 'related') => {
    try {
      await api.connectNotes?.(noteId1, noteId2, relationshipType);
      return true;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Remove note connection
  disconnectNotes: async (noteId1, noteId2) => {
    try {
      await api.disconnectNotes?.(noteId1, noteId2);
      return true;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Get note connections
  getNoteConnections: async (noteId) => {
    try {
      const data = await api.getNoteConnections?.(noteId);
      return data?.connections || [];
    } catch (err) {
      return [];
    }
  },

  // Clear cache
  clearCache: () => {
    localStorage.removeItem(getNotesCacheKey());
    set({ notes: [], lastFetchAt: 0 });
  },
}));

