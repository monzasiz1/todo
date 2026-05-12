import { supabase } from './_lib/db.js';
import { authenticate } from './_lib/auth.js';
import { cache, invalidate } from './_lib/cache.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authResponse = await authenticate(req, res);
  if (authResponse.error) {
    return res.status(401).json({ error: authResponse.error });
  }
  const { user } = authResponse;
  const cacheKey = `notes:${user.id}`;

  try {
    switch (req.method) {
      case 'GET': {
        const cachedData = await cache.get(cacheKey);
        if (cachedData) {
          return res.status(200).json(cachedData);
        }

        const { data: notes, error: notesError } = await supabase
          .from('notes')
          .select('*')
          .eq('user_id', user.id);

        if (notesError) throw notesError;

        const { data: connections, error: connectionsError } = await supabase
          .from('note_connections')
          .select('*')
          .eq('user_id', user.id);
        
        if (connectionsError) throw connectionsError;
        
        const data = { notes, connections };
        await cache.set(cacheKey, data);

        return res.status(200).json(data);
      }

      case 'POST': {
        await invalidate(cacheKey);
        const { title, content, position_x, position_y, importance, due_date } = req.body;
        const { data: newNote, error: newNoteError } = await supabase
          .from('notes')
          .insert({ user_id: user.id, title, content, position_x, position_y, importance, due_date })
          .select()
          .single();
        
        if (newNoteError) throw newNoteError;
        return res.status(201).json(newNote);
      }

      case 'PUT': {
        await invalidate(cacheKey);
        const { id, ...updates } = req.body;
        if (!id) return res.status(400).json({ error: 'Note ID is required' });

        const { data: updatedNote, error: updateError } = await supabase
          .from('notes')
          .update(updates)
          .eq('id', id)
          .eq('user_id', user.id)
          .select()
          .single();

        if (updateError) throw updateError;
        return res.status(200).json(updatedNote);
      }

      case 'DELETE': {
        await invalidate(cacheKey);
        const { id: deleteId } = req.query;
        if (!deleteId) return res.status(400).json({ error: 'Note ID is required' });

        const { error: deleteError } = await supabase
          .from('notes')
          .delete()
          .eq('id', deleteId)
          .eq('user_id', user.id);

        if (deleteError) throw deleteError;
        return res.status(204).end();
      }

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error('Notes API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
