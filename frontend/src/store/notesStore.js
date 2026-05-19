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
  archivedNotes: [],
  archivedLoading: false,
  loading: false,
  error: null,
  lastFetchAt: 0,

  // Mindmap-Verbindungen zwischen Notes (note_connections-Tabelle)
  connections: [],
  connectionsLoading: false,

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

      // Offline / Netzwerk-Glitch (iOS PWA tritt das oft): Request wurde in
      // die Offline-Queue eingereiht. Direkt optimistisch eine Platzhalter-
      // Notiz in den State legen, damit "Neue Notiz" auf dem Handy nicht
      // wirkungslos aussieht.
      if (result && result.__queued) {
        const tempNote = {
          id: result.tempId,
          ...noteData,
          __offline: true,
          created_at: new Date().toISOString(),
        };
        set((s) => {
          const updated = [...s.notes, tempNote];
          writeNotesCache(updated);
          return { notes: updated };
        });
        return tempNote;
      }

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
        : null; // don't add id-less optimistic entry — wait for real server response

      if (!newNote || newNote.id == null) {
        // Server hat 2xx geliefert, aber kein note-Objekt -> Fehler bubblen,
        // damit UI Feedback geben kann statt stiller "nichts passiert"-Bug.
        throw new Error('Notiz konnte nicht erstellt werden (leere Server-Antwort).');
      }

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

  // Delete note (permanent)
  deleteNote: async (noteId) => {
    try {
      await api.deleteNote?.(noteId);
      set((s) => {
        const updated = s.notes.filter((n) => String(n.id) !== String(noteId));
        const updatedArchive = s.archivedNotes.filter((n) => String(n.id) !== String(noteId));
        writeNotesCache(updated);
        return { notes: updated, archivedNotes: updatedArchive };
      });
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Archive a note (mark completed → wandert in Archiv)
  completeNote: async (noteId) => {
    try {
      const completedAt = new Date().toISOString();
      // Hole die Note bevor sie aus der Liste fliegt, damit wir sie ins
      // Archive-Array verschieben können (instant UX, kein Refetch nötig)
      const noteToArchive = get().notes.find((n) => String(n.id) === String(noteId));
      await api.updateNote?.(noteId, { completed: true, completed_at: completedAt });
      set((s) => {
        const remaining = s.notes.filter((n) => String(n.id) !== String(noteId));
        const archived = noteToArchive
          ? [{ ...noteToArchive, completed: true, completed_at: completedAt }, ...s.archivedNotes]
          : s.archivedNotes;
        writeNotesCache(remaining);
        return { notes: remaining, archivedNotes: archived };
      });
      return true;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Restore an archived note → wandert zurück aufs Board
  restoreArchivedNote: async (noteId) => {
    try {
      const noteToRestore = get().archivedNotes.find((n) => String(n.id) === String(noteId));
      await api.updateNote?.(noteId, { completed: false, completed_at: null });
      set((s) => {
        const archivedRemaining = s.archivedNotes.filter((n) => String(n.id) !== String(noteId));
        const restored = noteToRestore
          ? [...s.notes, { ...noteToRestore, completed: false, completed_at: null }]
          : s.notes;
        writeNotesCache(restored);
        return { notes: restored, archivedNotes: archivedRemaining };
      });
      return true;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Fetch archived (completed) notes
  fetchArchivedNotes: async () => {
    set({ archivedLoading: true });
    try {
      const data = await api.getArchivedNotes?.();
      const archivedNotes = data?.notes || [];
      set({ archivedNotes, archivedLoading: false });
      return archivedNotes;
    } catch (err) {
      set({ error: err.message, archivedLoading: false });
      return [];
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

  // ──────────────────────────────────────────────────────────────────────
  // Mindmap-Verbindungen (alle Connections auf dem Board)
  // ──────────────────────────────────────────────────────────────────────
  fetchConnections: async () => {
    set({ connectionsLoading: true });
    try {
      const data = await api.listNoteConnections?.();
      const connections = Array.isArray(data?.connections) ? data.connections : [];
      set({ connections, connectionsLoading: false });
      return connections;
    } catch (err) {
      console.warn('[notesStore] fetchConnections failed:', err?.message || err);
      set({ connectionsLoading: false });
      return get().connections;
    }
  },

  addConnection: async (noteId1, noteId2, relationshipType = 'related') => {
    if (!noteId1 || !noteId2 || String(noteId1) === String(noteId2)) return null;
    try {
      const data = await api.addNoteConnection?.(noteId1, noteId2, relationshipType);
      const conn = data?.connection;
      if (!conn) return null;

      set((s) => {
        // Doppelte vermeiden
        const exists = s.connections.some(
          (c) =>
            String(c.id) === String(conn.id) ||
            (String(c.note_id_1) === String(conn.note_id_1) &&
              String(c.note_id_2) === String(conn.note_id_2))
        );
        return exists ? s : { connections: [...s.connections, conn] };
      });
      return conn;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  removeConnection: async (connectionOrPair) => {
    try {
      // Akzeptiert: { id } | { note_id_1, note_id_2 } | Connection-Objekt
      if (connectionOrPair?.id) {
        await api.removeNoteConnectionById?.(connectionOrPair.id);
      } else if (connectionOrPair?.note_id_1 && connectionOrPair?.note_id_2) {
        await api.removeNoteConnection?.(connectionOrPair.note_id_1, connectionOrPair.note_id_2);
      } else {
        return false;
      }

      set((s) => ({
        connections: s.connections.filter((c) => {
          if (connectionOrPair?.id) return String(c.id) !== String(connectionOrPair.id);
          const a = String(connectionOrPair.note_id_1);
          const b = String(connectionOrPair.note_id_2);
          const ca = String(c.note_id_1);
          const cb = String(c.note_id_2);
          return !((ca === a && cb === b) || (ca === b && cb === a));
        }),
      }));
      return true;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // Clear cache
  clearCache: () => {
    localStorage.removeItem(getNotesCacheKey());
    set({ notes: [], lastFetchAt: 0 });
  },
}));

