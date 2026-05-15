// Minimaler iCalendar (RFC 5545) Parser fuer VEVENT-Import.
// Unterstuetzt: line folding, escape-Sequenzen, DTSTART/DTEND (DATE & DATE-TIME),
// SUMMARY, DESCRIPTION, LOCATION, UID. Mehrtaegige bzw. all-day Termine werden erkannt.
// Wiederholungs-Regeln (RRULE) werden NICHT expandiert – jedes VEVENT wird als
// einmaliger Termin importiert. Reicht fuer Export-Dateien aus Google Calendar,
// Apple Calendar und Outlook.

function unfoldLines(text) {
  // RFC 5545: Folded lines beginnen mit Space oder Tab und gehoeren an die
  // vorhergehende Zeile angehaengt.
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescapeIcsText(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function splitProp(line) {
  // Liefert { name, params, value }. Beispiel:
  // "DTSTART;TZID=Europe/Berlin:20260120T100000" -> { name: 'DTSTART', params: { TZID: 'Europe/Berlin' }, value: '20260120T100000' }
  const colonIdx = line.indexOf(':');
  if (colonIdx < 0) return null;
  const head = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const segs = head.split(';');
  const name = segs.shift().toUpperCase();
  const params = {};
  for (const seg of segs) {
    const eq = seg.indexOf('=');
    if (eq > 0) params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
  }
  return { name, params, value };
}

function parseIcsDate(value, params = {}) {
  // Liefert { date: 'YYYY-MM-DD', time: 'HH:MM' | null, allDay: boolean }
  // Akzeptiert: 20260120 (DATE), 20260120T143000, 20260120T143000Z
  const v = String(value || '').trim();
  if (!v) return null;
  const isDateOnly = params.VALUE === 'DATE' || /^\d{8}$/.test(v);
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, , isUtc] = m;
  const date = `${y}-${mo}-${d}`;

  if (isDateOnly || !hh) {
    return { date, time: null, allDay: true };
  }

  if (isUtc) {
    // UTC nach lokal konvertieren (sonst springt z.B. 23:00Z UTC einen Tag zurueck).
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, 0));
    const lyear = dt.getFullYear();
    const lmonth = String(dt.getMonth() + 1).padStart(2, '0');
    const lday = String(dt.getDate()).padStart(2, '0');
    const lh = String(dt.getHours()).padStart(2, '0');
    const lm = String(dt.getMinutes()).padStart(2, '0');
    return { date: `${lyear}-${lmonth}-${lday}`, time: `${lh}:${lm}`, allDay: false };
  }

  return { date, time: `${hh}:${mm}`, allDay: false };
}

// Bei all-day Events ist DTEND laut RFC exklusiv (Tag nach dem letzten Tag).
// Wir wandeln das in inklusives Ende um, damit der Nutzer das echte Enddatum sieht.
function adjustExclusiveEnd(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function parseIcs(text) {
  const lines = unfoldLines(text);
  const events = [];
  let calendarName = null;
  let current = null;

  for (const line of lines) {
    if (!line) continue;
    const upper = line.toUpperCase();

    if (upper === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (upper === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }

    const prop = splitProp(line);
    if (!prop) continue;

    if (!current) {
      if (prop.name === 'X-WR-CALNAME') calendarName = unescapeIcsText(prop.value);
      continue;
    }

    switch (prop.name) {
      case 'SUMMARY':
        current.title = unescapeIcsText(prop.value);
        break;
      case 'DESCRIPTION':
        current.description = unescapeIcsText(prop.value);
        break;
      case 'LOCATION':
        current.location = unescapeIcsText(prop.value);
        break;
      case 'UID':
        current.uid = String(prop.value || '').trim();
        break;
      case 'DTSTART': {
        const parsed = parseIcsDate(prop.value, prop.params);
        if (parsed) {
          current.date = parsed.date;
          current.time = parsed.time;
          current.all_day = parsed.allDay;
        }
        break;
      }
      case 'DTEND': {
        const parsed = parseIcsDate(prop.value, prop.params);
        if (parsed) {
          current._dtEndAllDay = parsed.allDay;
          current.date_end = parsed.allDay ? adjustExclusiveEnd(parsed.date) : parsed.date;
          current.time_end = parsed.time;
        }
        break;
      }
      case 'RRULE':
        current.rrule = String(prop.value || '').trim();
        break;
      default:
        break;
    }
  }

  // Normalisieren + filtern (Eintraege ohne Titel oder Datum verwerfen).
  const normalized = events
    .filter((ev) => ev.title && ev.date)
    .map((ev) => {
      const sameDay = !ev.date_end || ev.date_end === ev.date;
      const out = {
        title: ev.title.trim(),
        description: buildDescription(ev),
        date: ev.date,
        date_end: sameDay ? null : ev.date_end,
        time: ev.all_day ? null : (ev.time || null),
        time_end: ev.all_day ? null : (ev.time_end || null),
        all_day: !!ev.all_day,
        type: 'event',
        priority: 'medium',
        uid: ev.uid || null,
        recurrence_hint: ev.rrule || null,
      };
      return out;
    });

  return { events: normalized, calendarName, totalParsed: events.length };
}

function buildDescription(ev) {
  const parts = [];
  if (ev.description) parts.push(ev.description.trim());
  if (ev.location) parts.push(`Ort: ${ev.location.trim()}`);
  if (ev.rrule) parts.push(`Wiederholung (Original): ${ev.rrule}`);
  return parts.length ? parts.join('\n\n') : null;
}
