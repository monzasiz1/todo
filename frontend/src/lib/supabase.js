// Supabase-Client für Realtime-Subscriptions.
//
// Wichtig: Wir benutzen den Client AUSSCHLIESSLICH für Realtime-Channels
// (Postgres Changes + Presence). Alle CRUD-Operationen laufen weiterhin
// über unsere eigene /api/* Schicht mit JWT-Auth.
//
// Konfiguration kommt aus Vite-Env (in .env / Vercel ENV):
//   VITE_SUPABASE_URL       = https://<project-ref>.supabase.co
//   VITE_SUPABASE_ANON_KEY  = eyJ…  (anon/public Key, darf im Browser sein)
//
// Authentifizierung für RLS-Policies passiert per
//   supabase.realtime.setAuth(jwt)
// Der JWT kommt vom /api/auth/realtime-token Endpunkt (signiert mit dem
// Supabase JWT-Secret, enthält `app_user_id` Claim).

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client = null;

export function getSupabase() {
  if (client) return client;
  if (!url || !anonKey) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY nicht gesetzt – Realtime deaktiviert.'
      );
    }
    return null;
  }
  client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
  return client;
}

export function isSupabaseConfigured() {
  return Boolean(url && anonKey);
}
