// ─────────────────────────────────────────────────────────────────────────
// Supabase Realtime Broadcast (HTTP)
// ─────────────────────────────────────────────────────────────────────────
// Schickt Broadcast-Events ueber den Realtime-HTTP-Endpoint, ohne dass wir
// dafuer den schweren @supabase/supabase-js-Client im Serverless-Bundle
// brauchen. Aufruf ist fire-and-forget: ein Fehler wird nur geloggt, die
// API-Response wird nicht verzoegert.
//
// Erwartete ENV:
//   SUPABASE_URL                 z.B. https://xxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    JWT aus Project Settings -> API
//
// Verwendung (Chat-Broadcast nach INSERT in group_messages):
//   broadcast('rt-chat', 'new_message', { group_id, message_id })
//     .catch((err) => console.error('broadcast failed:', err));
//
// Hinweis: Broadcast umgeht RLS. Deshalb senden wir nur leichte Trigger
// (group_id + message_id), keine Inhalte. Empfaenger laden den Inhalt
// weiterhin ueber die normale (RLS-gesicherte) REST-API nach.
// ─────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function isConfigured() {
  return !!(SUPABASE_URL && SERVICE_ROLE);
}

/**
 * Sendet ein einzelnes Broadcast-Event.
 * @param {string} topic   Channel-Name, z.B. 'rt-chat'
 * @param {string} event   Event-Name, z.B. 'new_message'
 * @param {object} payload JSON-serialisierbares Payload-Objekt
 * @returns {Promise<void>}
 */
async function broadcast(topic, event, payload) {
  if (!isConfigured()) {
    // Im Dev ohne Supabase-Keys einfach schweigen.
    return;
  }
  const url = `${SUPABASE_URL}/realtime/v1/api/broadcast`;
  const body = JSON.stringify({
    messages: [{ topic, event, payload: payload ?? {} }],
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`broadcast ${topic}/${event} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

module.exports = { broadcast, isConfigured };
