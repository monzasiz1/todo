const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

async function parseTaskWithAI(input, options = {}) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY nicht konfiguriert');

  const { groupNames = [] } = options;

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
- WICHTIG: Unterscheide ob es sich um einen TERMIN (type: "event") oder eine AUFGABE (type: "task") handelt:
  - TERMIN (event): Feste Zeitpunkte wie Arzttermin, Meeting, Probe, Geburtstag, Konzert, Vorlesung, Kirmes, Feiertag, Urlaub. Termine haben typischerweise ein festes Datum/Uhrzeit und können NICHT abgehakt werden.
  - AUFGABE (task): Dinge die erledigt werden müssen wie Einkaufen, Rechnung bezahlen, Wäsche waschen, E-Mail schreiben, Hausaufgaben. Aufgaben können als erledigt markiert werden.
  - Im Zweifel: Wenn eine Uhrzeit/Zeitraum UND ein Ort oder Treffpunkt erkennbar ist → event. Wenn eine Tätigkeit beschrieben wird die abgearbeitet werden soll → task.
- Erkenne den Aufgabentitel (kurz und prägnant, was getan werden soll)
- Erkenne Beschreibung/Details: Wenn der Nutzer zusätzliche Infos gibt (z.B. "Peter kommt nicht zur Probe", "Milch, Eier, Butter kaufen"), extrahiere diese als description
- Bei Einkaufslisten oder Aufzählungen: Formatiere die Items als "• Item1\\n• Item2\\n• Item3" in der description
- Erkenne Datumsangaben: heute, morgen, übermorgen, Wochentage (nächsten Montag etc.), konkrete Daten
- Erkenne DATUMSBEREICHE: "vom 20. bis 24. April", "20.-24.04", "Montag bis Freitag" → setze date als Startdatum und date_end als Enddatum
- Erkenne Uhrzeiten (18 Uhr, 14:30, nachmittags etc.)
- Erkenne ZEITBEREICHE: "von 14 bis 16 Uhr", "9-12 Uhr", "14:00-15:30" → setze time als Startzeit und time_end als Endzeit
- Wähle eine passende Kategorie aus: Arbeit, Persönlich, Gesundheit, Finanzen, Einkaufen, Haushalt, Bildung, Soziales
- Bestimme die Priorität: low, medium, high, urgent
- Erkenne ob eine Erinnerung gewünscht ist ("erinnere mich", "reminder", "erinnern", "Erinnerung", "nicht vergessen", "denk dran" etc.)
- ERINNERUNGEN: Wenn der Nutzer eine Erinnerung wünscht, berechne "reminder_at" als vollständigen ISO-8601-Zeitstempel:
  - "heute Reinigung erinnern um 18:58" → hasReminder: true, reminder_at: "${currentDate}T18:58:00"
  - "morgen um 9 Uhr erinnern Arzt" → hasReminder: true, reminder_at: "${tomorrow}T09:00:00"
  - "erinnere mich Freitag 14:30" → hasReminder: true, reminder_at: "<Freitag-Datum>T14:30:00"
  - Wenn eine Uhrzeit im Text steht aber keine separate Erinnerungs-Zeit: Nutze die Task-Uhrzeit als Erinnerungszeit
  - Wenn "erinnern" + Datum + Uhrzeit: Berechne reminder_at aus dem erkannten Datum+Uhrzeit
  - Wenn "erinnern" ohne Uhrzeit aber mit Datum: Setze reminder_at auf Datum mit 09:00 Uhr
  - Wenn "erinnern" ohne Datum und Uhrzeit: Setze reminder_at auf heute 1 Stunde vor jetzt, oder 30 Min vor Taskzeit
  - WICHTIG: reminder_at muss IMMER im Format "YYYY-MM-DDTHH:MM:00" sein wenn hasReminder true ist
  - WICHTIG: Wörter wie "erinnern", "erinnere", "Erinnerung", "nicht vergessen" bedeuten IMMER hasReminder: true
- Wenn ein Wochentag genannt wird, verwende das nächste passende Datum aus der Liste oben
- WICHTIG: Wenn ein Datum erkennbar ist, gib es IMMER im Format YYYY-MM-DD zurück, niemals null
- WICHTIG: Trenne Titel und Beschreibung intelligent. Der Titel soll kurz sein (z.B. "Einkaufen"), Details kommen in description
- WIEDERKEHRENDE AUFGABEN erkennen:
  - "täglich", "jeden Tag" → recurrence_rule: "daily"
  - "wöchentlich", "jede Woche", "jeden Montag", "jeden Dienstag" etc. → recurrence_rule: "weekly" (und setze date auf den nächsten passenden Wochentag)
  - "alle 2 Wochen", "zweiwöchentlich" → recurrence_rule: "biweekly"
  - "monatlich", "jeden Monat", "jeden 1." → recurrence_rule: "monthly"
  - "jährlich", "jedes Jahr" → recurrence_rule: "yearly"
  - "werktags", "unter der Woche", "Montag bis Freitag" → recurrence_rule: "weekdays"
  - "alle X Tage/Wochen/Monate" → recurrence_rule: passendes + recurrence_interval: X
  - Wenn ein Enddatum für die Wiederholung erkannt wird ("bis Ende Juni", "bis Ende Mai", "bis 31.12.") → recurrence_end: YYYY-MM-DD
  - "Ende <Monat>" = letzter Kalendertag dieses Monats im aktuellen Jahr (oder nächstes Jahr, falls Monat schon vorbei)
  - Wenn KEINE Wiederholung erkannt wird → recurrence_rule: null
- Antworte NUR mit validem JSON, kein anderer Text

Berechne Wochentage korrekt:
- Heute ist ${currentDay}, ${currentDate}
- "morgen" → ${tomorrow}
- "übermorgen" → ${dayAfter}

- Erkenne ob der Nutzer die Aufgabe mit jemandem TEILEN möchte: "mit Max teilen", "für Anna", "zeig das Lisa", "teile mit Max und Anna"
- Wenn Teilen erkannt wird: Extrahiere die Namen in "share_with" als Array
- Erkenne auch: "nicht teilen", "nur für mich", "privat" → share_with: null
- Der Titel soll NICHT den Teilen-Wunsch enthalten (z.B. "Einkaufen mit Max teilen" → title: "Einkaufen", share_with: ["Max"])
${groupNames.length > 0 ? `
- GRUPPEN-ERKENNUNG: Der User ist Mitglied folgender Gruppen: ${groupNames.join(', ')}
- Wenn der Text einen Gruppennamen enthält (fuzzy match, z.B. "family" → "Family", "arbeit" → "Arbeit Team"), setze "group_name" auf den erkannten Gruppennamen
- Beispiele: "mit Family morgen schwimmen gehen" → title: "Schwimmen gehen", group_name: "Family", date: morgen
- "Team Meeting Freitag 10 Uhr" (Gruppe "Team" existiert) → title: "Meeting", group_name: "Team", date: Freitag, time: "10:00"
- Der Gruppenname soll NICHT im Titel erscheinen
- Wenn keine Gruppe erkannt wird: group_name: null
` : ''}

Beispiele:
- "Peter kommt nicht zur Probe am Mittwoch 18 Uhr" → title: "Probe", description: "Peter kommt nicht zur Probe", date: Mittwoch-Datum, time: "18:00"
- "Einkaufen Milch Eier Butter Brot morgen" → title: "Einkaufen", description: "• Milch\\n• Eier\\n• Butter\\n• Brot", date: morgen, category: "Einkaufen"
- "Kirmes vom 20. bis 24. April" → title: "Kirmes", date: "2026-04-20", date_end: "2026-04-24"
- "Meeting morgen von 14 bis 16 Uhr" → title: "Meeting", date: morgen, time: "14:00", time_end: "16:00"
- "Arzttermin Dienstag 10-11:30 Uhr Zahnarzt Dr. Mueller" → title: "Arzttermin", description: "Zahnarzt Dr. Mueller", date: Dienstag, time: "10:00", time_end: "11:30"
- "Einkaufen mit Melanie teilen" → title: "Einkaufen", share_with: ["Melanie"], category: "Einkaufen"
- "Projekt für Max und Anna sichtbar machen morgen" → title: "Projekt", share_with: ["Max", "Anna"], date: morgen
- "mit Melanie teilen Geburtstagsparty am Samstag" → title: "Geburtstagsparty", share_with: ["Melanie"], date: Samstag-Datum
- "jeden Montag Joggen 7 Uhr" → title: "Joggen", date: nächsten-Montag, time: "07:00", recurrence_rule: "weekly"
- "täglich Medikamente nehmen" → title: "Medikamente nehmen", date: heute, recurrence_rule: "daily"
- "alle 2 Wochen Putzen" → title: "Putzen", date: heute, recurrence_rule: "biweekly"
- "monatlich Miete überweisen am 1." → title: "Miete überweisen", recurrence_rule: "monthly"
- "werktags Standup 9 Uhr" → title: "Standup", date: nächster-Werktag, time: "09:00", recurrence_rule: "weekdays"
- "jeden Mittwoch bis Ende Mai ist mittwochs Probe von 19:00 bis 21:00 Uhr" → title: "Probe", date: nächster-Mittwoch, time: "19:00", time_end: "21:00", recurrence_rule: "weekly", recurrence_end: "YYYY-05-31"

JSON Format:
{
  "type": "task|event",
  "title": "string (kurz, max 5-6 Wörter)",
  "description": "string oder null (Details, Listen, zusätzliche Infos)",
  "date": "YYYY-MM-DD oder null",
  "date_end": "YYYY-MM-DD oder null (nur bei mehrtägigen Events)",
  "time": "HH:MM oder null",
  "time_end": "HH:MM oder null (nur bei Zeitbereichen)",
  "category": "string",
  "priority": "low|medium|high|urgent",
  "hasReminder": true/false,
  "reminder_at": "YYYY-MM-DDTHH:MM:00 oder null (nur wenn hasReminder true)",
  "recurrence_rule": "daily|weekly|biweekly|monthly|yearly|weekdays" oder null,
  "recurrence_interval": 1 (Zahl, Standard 1),
  "recurrence_end": "YYYY-MM-DD oder null",
  "share_with": ["Name1", "Name2"] oder null,
  "group_name": "Gruppenname" oder null,
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
      type: parsed.type === 'event' ? 'event' : 'task',
      title: parsed.title || input,
      description: parsed.description || null,
      date: parsed.date || null,
      date_end: parsed.date_end || null,
      time: parsed.time || null,
      time_end: parsed.time_end || null,
      category: parsed.category || 'Persönlich',
      priority: parsed.priority || 'medium',
      hasReminder: parsed.hasReminder || false,
      reminder_at: parsed.reminder_at || null,
      recurrence_rule: parsed.recurrence_rule || null,
      recurrence_interval: parsed.recurrence_interval || 1,
      recurrence_end: parsed.recurrence_end || null,
      share_with: parsed.share_with || null,
      group_name: parsed.group_name || null,
      confidence: parsed.confidence || 0.8,
    };
  } catch {
    return {
      type: 'task',
      title: input,
      description: null,
      date: null,
      date_end: null,
      time: null,
      time_end: null,
      category: 'Persönlich',
      priority: 'medium',
      hasReminder: false,
      reminder_at: null,
      recurrence_rule: null,
      recurrence_interval: 1,
      recurrence_end: null,
      share_with: null,
      group_name: null,
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

async function classifyIntentWithAI(input, taskTitles = []) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY nicht konfiguriert');

  const now = new Date();
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const currentDate = now.toISOString().split('T')[0];
  const currentDay = days[now.getDay()];
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];

  const nextWeekdays = {};
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    nextWeekdays[days[d.getDay()]] = d.toISOString().split('T')[0];
  }

  const systemPrompt = `Du bist ein Intent-Classifier für eine To-Do/Kalender App.
Analysiere die Eingabe und erkenne was der Nutzer tun möchte.

Aktuelles Datum: ${currentDate} (${currentDay})
Morgen: ${tomorrow}
Nächste Wochentage:
${Object.entries(nextWeekdays).map(([day, date]) => `- ${day} → ${date}`).join('\n')}

Vorhandene Aufgaben/Termine des Nutzers:
${taskTitles.length > 0 ? taskTitles.map((t, i) => `${i + 1}. "${t.title}" (Datum: ${t.date || 'keins'}, Zeit: ${t.time || 'keine'})`).join('\n') : '(keine)'}

INTENT ERKENNUNG:
1. "create" - Neue Aufgabe/Termin erstellen (Standard wenn nichts anderes erkannt)
   - "Morgen Zahnarzt 10 Uhr", "Einkaufen", "Meeting Freitag"
2. "delete" - Aufgabe/Termin löschen/entfernen
   - "Lösche Zahnarzt", "Entferne den Termin Reinigung", "Streich Einkaufen", "weg mit Meeting", "Termin absagen", "cancel Probe"
3. "move" - Aufgabe/Termin verschieben (Datum/Zeit ändern)
   - "Verschiebe Zahnarzt auf Freitag", "Reinigung auf morgen", "Meeting auf 15 Uhr", "Arzttermin von Montag auf Mittwoch"
   - "Zahnarzt statt Montag lieber Dienstag", "Probe eine Stunde später", "verschieb das auf nächste Woche"
4. "update" - Aufgabe/Termin ändern (Titel, Priorität, Beschreibung etc.)
   - "Ändere Einkaufen zu dringend", "Zahnarzt Beschreibung: Raum 3"

Regeln:
- Matche den Task-Titel FUZZY aus der Liste (z.B. "zahnarzt" → "Zahnarzt", "reinigung" → "Reinigung")
- Bei "delete" und "move": task_title MUSS auf eine existierende Aufgabe verweisen
- Bei "move": Erkenne new_date (YYYY-MM-DD) und/oder new_time (HH:MM)
- Bei "move" ohne explizites Datum/Zeit: Versuche es aus dem Kontext zu erkennen
- Wenn der Nutzer sagt "auf morgen" → new_date: ${tomorrow}
- Wochentage korrekt berechnen aus der Liste oben
- Im Zweifel: intent "create" (Standardfall)

Antworte NUR mit validem JSON:
{
  "intent": "create|delete|move|update",
  "task_title": "Erkannter Aufgabentitel aus der Liste (oder null bei create)",
  "new_date": "YYYY-MM-DD oder null (nur bei move)",
  "new_time": "HH:MM oder null (nur bei move)",
  "updates": {} oder null (nur bei update: z.B. {"priority": "urgent", "description": "..."}),
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
      intent: ['create', 'delete', 'move', 'update'].includes(parsed.intent) ? parsed.intent : 'create',
      task_title: parsed.task_title || null,
      new_date: parsed.new_date || null,
      new_time: parsed.new_time || null,
      updates: parsed.updates || null,
      confidence: parsed.confidence || 0.5,
    };
  } catch {
    return { intent: 'create', task_title: null, new_date: null, new_time: null, updates: null, confidence: 0.2 };
  }
}

module.exports = { parseTaskWithAI, parsePermissionsWithAI, classifyIntentWithAI };
