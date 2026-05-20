const { cors, verifyToken } = require('./_lib/auth');

// Mapbox Geocoding-Proxy.
// Wir senden den Token NIE ins Frontend; statt dessen ruft das Frontend
// /api/geocode?q=... auf und wir leiten die Anfrage mit unserem Server-Token
// an Mapbox weiter. So koennen wir das Limit zentral kontrollieren und den
// Token jederzeit rotieren.
//
// Erwartete Vercel-ENV:
//   MAPBOX_TOKEN  -> Secret-Token (pk.* oder besser sk.* mit Geocoding-Scope)
//
// Fallback: wenn kein Token gesetzt ist, leiten wir auf die kostenlose
// OpenStreetMap-Nominatim-Instanz weiter, damit das Feature nie komplett
// kaputt geht.

const MAPBOX_URL = 'https://api.mapbox.com/search/geocode/v6/forward';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Sehr einfacher In-Memory-Cache pro Vercel-Instanz (5 Min TTL).
// Reduziert Mapbox-Quota bei Wiederholungseingaben deutlich.
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { value, at: Date.now() });
}

async function queryMapbox(q, lang, limit, token) {
  const url = new URL(MAPBOX_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('language', lang);
  url.searchParams.set('access_token', token);
  // Bevorzugt Adressen + Strassen, keine reinen Laender/Regionen.
  url.searchParams.set('types', 'address,street,place,locality,neighborhood,postcode');

  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`mapbox ${r.status}`);
  const data = await r.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  return features.map((f) => {
    const p = f?.properties || {};
    const ctx = p.context || {};
    const street = p.name || ctx.street?.name || '';
    const houseNumber = p.address_number || ctx.address?.address_number || '';
    const postcode = ctx.postcode?.name || '';
    const place = ctx.place?.name || ctx.locality?.name || ctx.region?.name || '';
    const country = ctx.country?.name || '';
    const fullName = p.full_address || p.place_formatted || p.name || '';
    return {
      display: fullName,
      road: street,
      houseNumber,
      postcode,
      city: place,
      country,
      lat: f?.geometry?.coordinates?.[1] ?? null,
      lng: f?.geometry?.coordinates?.[0] ?? null,
      source: 'mapbox',
    };
  });
}

async function queryNominatim(q, lang, limit) {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('accept-language', lang);

  const r = await fetch(url.toString(), {
    headers: { 'User-Agent': 'workmatch-app/1.0 (geocode-proxy)' },
  });
  if (!r.ok) throw new Error(`nominatim ${r.status}`);
  const data = await r.json();
  return (Array.isArray(data) ? data : []).map((item) => {
    const a = item.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.hamlet || '';
    return {
      display: item.display_name || '',
      road: a.road || a.pedestrian || a.footway || '',
      houseNumber: a.house_number || '',
      postcode: a.postcode || '',
      city,
      country: a.country || '',
      lat: item.lat ? Number(item.lat) : null,
      lng: item.lon ? Number(item.lon) : null,
      source: 'nominatim',
    };
  });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  // Nur eingeloggte User duerfen den Proxy benutzen, sonst koennte jemand
  // unser Mapbox-Kontingent leersaugen.
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ items: [] });

  const lang = String(req.query.lang || 'de').slice(0, 5);
  const limitRaw = Number(req.query.limit || 6);
  const limit = Math.max(1, Math.min(10, Number.isFinite(limitRaw) ? limitRaw : 6));

  const cacheKey = `${lang}|${limit}|${q.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.setHeader('X-Geocode-Cache', 'hit');
    return res.json({ items: cached });
  }

  const token = process.env.MAPBOX_TOKEN;

  try {
    let items;
    if (token) {
      try {
        items = await queryMapbox(q, lang, limit, token);
      } catch (err) {
        console.warn('[geocode] mapbox failed, fallback nominatim:', err.message);
        items = await queryNominatim(q, lang, limit);
      }
    } else {
      items = await queryNominatim(q, lang, limit);
    }
    cacheSet(cacheKey, items);
    res.setHeader('X-Geocode-Cache', 'miss');
    res.setHeader('X-Geocode-Source', items[0]?.source || (token ? 'mapbox' : 'nominatim'));
    return res.json({ items });
  } catch (err) {
    console.error('[geocode] failed:', err);
    return res.status(502).json({ error: 'geocode_failed' });
  }
};
