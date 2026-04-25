/**
 * Notes API Handler
 * Handles CRUD operations for Notes
 * Database schema required:
 * - notes (id, user_id, title, content, importance, date, linked_task_id, created_at, updated_at)
 * - note_shares (id, note_id, friend_id, permission, created_at)
 * - note_connections (id, note_id_1, note_id_2, relationship_type, created_at)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Verify user session
async function verifyUser(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user;
}

// GET /api/notes - Fetch user's notes
export async function getNotes(req, res) {
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ error: error.message });
  }
}

// POST /api/notes - Create new note
export async function createNote(req, res) {
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { title, content, importance, date, linked_task_id } = req.body;

    const { data, error } = await supabase
      .from('notes')
      .insert({
        user_id: user.id,
        title,
        content,
        importance,
        date,
        linked_task_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select();

    if (error) throw error;
    res.status(201).json(data?.[0]);
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ error: error.message });
  }
}

// PATCH /api/notes/[id] - Update note
export async function updateNote(req, res) {
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const updates = req.body;

    const { data, error } = await supabase
      .from('notes')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id)
      .select();

    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Note not found' });

    res.status(200).json(data[0]);
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: error.message });
  }
}

// DELETE /api/notes/[id] - Delete note
export async function deleteNote(req, res) {
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;

    // Delete associated shares and connections
    await supabase.from('note_shares').delete().eq('note_id', id);
    await supabase
      .from('note_connections')
      .delete()
      .or(`note_id_1.eq.${id},note_id_2.eq.${id}`);

    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;
    res.status(204).send('');
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ error: error.message });
  }
}

// POST /api/notes/[id]/link-task - Link note to task
export async function linkNoteToTask(req, res) {
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const { task_id } = req.body;

    const { data, error } = await supabase
      .from('notes')
      .update({ linked_task_id: task_id, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .select();

    if (error) throw error;
    res.status(200).json(data?.[0]);
  } catch (error) {
    console.error('Error linking note to task:', error);
    res.status(500).json({ error: error.message });
  }
}

// POST /api/notes/[id]/share - Share note with friend
export async function shareNote(req, res) {
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const { friend_id, permission } = req.body;

    const { data, error } = await supabase
      .from('note_shares')
      .insert({
        note_id: id,
        friend_id,
        permission,
        created_at: new Date().toISOString(),
      })
      .select();

    if (error) throw error;
    res.status(201).json(data?.[0]);
  } catch (error) {
    console.error('Error sharing note:', error);
    res.status(500).json({ error: error.message });
  }
}

// GET /api/notes/[id]/connections - Get connected notes
export async function getNoteConnections(req, res) {
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;

    const { data, error } = await supabase
      .from('note_connections')
      .select('*')
      .or(`note_id_1.eq.${id},note_id_2.eq.${id}`);

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (error) {
    console.error('Error fetching note connections:', error);
    res.status(500).json({ error: error.message });
  }
}

// POST /api/notes/[id]/connect - Connect two notes
export async function connectNotes(req, res) {
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const { other_note_id, relationship_type } = req.body;

    const { data, error } = await supabase
      .from('note_connections')
      .insert({
        note_id_1: id,
        note_id_2: other_note_id,
        relationship_type: relationship_type || 'related',
        created_at: new Date().toISOString(),
      })
      .select();

    if (error) throw error;
    res.status(201).json(data?.[0]);
  } catch (error) {
    console.error('Error connecting notes:', error);
    res.status(500).json({ error: error.message });
  }
}

// GET /api/notes/shared - Get shared notes for current user
export async function getSharedNotes(req, res) {
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('note_shares')
      .select('notes(*)')
      .eq('friend_id', user.id);

    if (error) throw error;
    
    // Extract notes from the shares
    const notes = data?.map(share => share.notes).filter(Boolean) || [];
    res.status(200).json(notes);
  } catch (error) {
    console.error('Error fetching shared notes:', error);
    res.status(500).json({ error: error.message });
  }
}

// Route handler for dynamic routes
export default async function handler(req, res) {
  const { id, method } = req.query;

  if (!id) {
    // Root level /api/notes endpoints
    if (req.method === 'GET') return getNotes(req, res);
    if (req.method === 'POST') return createNote(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Note-specific endpoints
  switch (method) {
    case 'PATCH':
      return updateNote(req, res);
    case 'DELETE':
      return deleteNote(req, res);
    case 'link-task':
      return linkNoteToTask(req, res);
    case 'share':
      if (req.method === 'POST') return shareNote(req, res);
      break;
    case 'connections':
      if (req.method === 'GET') return getNoteConnections(req, res);
      if (req.method === 'POST') return connectNotes(req, res);
      break;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
