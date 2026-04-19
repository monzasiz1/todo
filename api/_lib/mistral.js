const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

async function parseTaskWithAI(input) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY nicht konfiguriert');

  const now = new Date();
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const currentDate = now.toISOString().split('T')[0];
  const currentDay = days[now.getDay()];
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];
  const dayAfter = new Date(now.getTime() + 172800000).toISOString().split('T')[0];

  // Compute next occurrence of each weekday
  const nextWeekdays = {};
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    nextWeekdays[days[d.getDay()]] = d.toISOString().split('T')[0];
  }

  const systemPrompt = `Du bist ein intelligenter Task-Parser. Analysiere die Eingabe und extrahiere strukturierte Daten.

Aktuelles Datum: ${currentDate} (${currentDay})
Aktuelles Jahr: ${now.getFullYear()}

Nächste Wochentage ab heute:
${Object.entries(nextWeekdays).map(([day, date]) => `- ${day} → ${date}`).join('\n')}

Regeln:
- Erkenne den Aufgabentitel (kurz und prägnant, was getan werden soll)
- Erkenne Beschreibung/Details: Wenn der Nutzer zusätzliche Infos gibt (z.B. "Peter kommt nicht zur Probe", "Milch, Eier, Butter kaufen"), extrahiere diese als description
- Bei Einkaufslisten oder Aufzählungen: Formatiere die Items als "• Item1\\n• Item2\\n• Item3" in der description
- Erkenne Datumsangaben: heute, morgen, übermorgen, Wochentage (nächsten Montag etc.), konkrete Daten
- Erkenne DATUMSBEREICHE: "vom 20. bis 24. April", "20.-24.04", "Montag bis Freitag" → setze date als Startdatum und date_end als Enddatum
- Erkenne Uhrzeiten (18 Uhr, 14:30, nachmittags etc.)
- Erkenne ZEITBEREICHE: "von 14 bis 16 Uhr", "9-12 Uhr", "14:00-15:30" → setze time als Startzeit und time_end als Endzeit
- Wähle eine passende Kategorie aus: Arbeit, Persönlich, Gesundheit, Finanzen, Einkaufen, Haushalt, Bildung, Soziales
- Bestimme die Priorität: low, medium, high, urgent
- Erkenne ob eine Erinnerung gewünscht ist ("erinnere mich", "reminder" etc.)
- Wenn ein Wochentag genannt wird, verwende das nächste passende Datum aus der Liste oben
- WICHTIG: Wenn ein Datum erkennbar ist, gib es IMMER im Format YYYY-MM-DD zurück, niemals null
- WICHTIG: Trenne Titel und Beschreibung intelligent. Der Titel soll kurz sein (z.B. "Einkaufen"), Details kommen in description
- Antworte NUR mit validem JSON, kein anderer Text

Berechne Wochentage korrekt:
- Heute ist ${currentDay}, ${currentDate}
- "morgen" → ${tomorrow}
- "übermorgen" → ${dayAfter}

- Erkenne ob der Nutzer die Aufgabe mit jemandem TEILEN möchte: "mit Max teilen", "für Anna", "zeig das Lisa", "teile mit Max und Anna"
- Wenn Teilen erkannt wird: Extrahiere die Namen in "share_with" als Array
- Erkenne auch: "nicht teilen", "nur für mich", "privat" → share_with: null
- Der Titel soll NICHT den Teilen-Wunsch enthalten (z.B. "Einkaufen mit Max teilen" → title: "Einkaufen", share_with: ["Max"])

Beispiele:
- "Peter kommt nicht zur Probe am Mittwoch 18 Uhr" → title: "Probe", description: "Peter kommt nicht zur Probe", date: Mittwoch-Datum, time: "18:00"
- "Einkaufen Milch Eier Butter Brot morgen" → title: "Einkaufen", description: "• Milch\\n• Eier\\n• Butter\\n• Brot", date: morgen, category: "Einkaufen"
- "Kirmes vom 20. bis 24. April" → title: "Kirmes", date: "2026-04-20", date_end: "2026-04-24"
- "Meeting morgen von 14 bis 16 Uhr" → title: "Meeting", date: morgen, time: "14:00", time_end: "16:00"
- "Arzttermin Dienstag 10-11:30 Uhr Zahnarzt Dr. Mueller" → title: "Arzttermin", description: "Zahnarzt Dr. Mueller", date: Dienstag, time: "10:00", time_end: "11:30"
- "Einkaufen mit Melanie teilen" → title: "Einkaufen", share_with: ["Melanie"], category: "Einkaufen"
- "Projekt für Max und Anna sichtbar machen morgen" → title: "Projekt", share_with: ["Max", "Anna"], date: morgen
- "mit Melanie teilen Geburtstagsparty am Samstag" → title: "Geburtstagsparty", share_with: ["Melanie"], date: Samstag-Datum

JSON Format:
{
  "title": "string (kurz, max 5-6 Wörter)",
  "description": "string oder null (Details, Listen, zusätzliche Infos)",
  "date": "YYYY-MM-DD oder null",
  "date_end": "YYYY-MM-DD oder null (nur bei mehrtägigen Events)",
  "time": "HH:MM oder null",
  "time_end": "HH:MM oder null (nur bei Zeitbereichen)",
  "category": "string",
  "priority": "low|medium|high|urgent",
  "hasReminder": true/false,
  "share_with": ["Name1", "Name2"] oder null,
  "confidence": 0.0-1.0
}`;

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new Error(`Mistral API Fehler: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) throw new Error('Keine Antwort von Mistral erhalten');

  try {
    const parsed = JSON.parse(content);
    return {
      title: parsed.title || input,
      description: parsed.description || null,
      date: parsed.date || null,
      date_end: parsed.date_end || null,
      time: parsed.time || null,
      time_end: parsed.time_end || null,
      category: parsed.category || 'Persönlich',
      priority: parsed.priority || 'medium',
      hasReminder: parsed.hasReminder || false,
      share_with: parsed.share_with || null,
      confidence: parsed.confidence || 0.8,
    };
  } catch {
    return {
      title: input,
      description: null,
      date: null,
      date_end: null,
      time: null,
      time_end: null,
      category: 'Persönlich',
      priority: 'medium',
      hasReminder: false,
      share_with: null,
      confidence: 0.3,
    };
  }
}

async function parsePermissionsWithAI(input, friendNames) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY nicht konfiguriert');

  const systemPrompt = `Du bist ein Berechtigungs-Parser für eine To-Do App. Analysiere die Eingabe und erkenne Berechtigungs-Anweisungen.

Verfügbare Freunde des Users: ${friendNames.join(', ')}

Regeln:
- Erkenne wer etwas SEHEN darf (visible_to)
- Erkenne wer etwas BEARBEITEN darf (editable_by)
- Erkenne Sichtbarkeits-Level: "private" (nur ich), "shared" (alle Freunde), "selected_users" (bestimmte Personen)
- "Nur für mich" → visibility: "private"
- "Alle können das sehen" → visibility: "shared"
- "Max soll das sehen" → visibility: "selected_users", visible_to: ["Max"]
- "Alle können bearbeiten" → editable_by: "all"
- "Max und Anna sollen das bearbeiten können" → editable_by: ["Max", "Anna"]
- "Max soll das sehen aber Anna nicht" → visible_to: ["Max"], excluded: ["Anna"]
- Matche Freundesnamen fuzzy (z.B. "max" → "Max", "anna" → "Anna")
- Antworte NUR mit validem JSON

JSON Format:
{
  "visibility": "private|shared|selected_users",
  "visible_to": ["Name1", "Name2"] oder null,
  "editable_by": ["Name1"] oder "all" oder null,
  "excluded": ["Name"] oder null,
  "confidence": 0.0-1.0
}`;

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) throw new Error(`Mistral API Fehler: ${response.status}`);

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Keine Antwort von Mistral');

  try {
    const parsed = JSON.parse(content);
    return {
      visibility: parsed.visibility || 'private',
      visible_to: parsed.visible_to || null,
      editable_by: parsed.editable_by || null,
      excluded: parsed.excluded || null,
      confidence: parsed.confidence || 0.5,
    };
  } catch {
    return { visibility: 'private', visible_to: null, editable_by: null, excluded: null, confidence: 0.2 };
  }
}

module.exports = { parseTaskWithAI, parsePermissionsWithAI };
