const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

async function parseTaskWithAI(input, options = {}) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY nicht konfiguriert');

  const { groupNames = [], groupContext = null, categoryNames = [], knownLocations = [] } = options;

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
${groupContext ? `
Gruppenkontext: Diese Aufgabe kommt aus einer Gruppe namens "${groupContext.groupName}" mit ${groupContext.memberCount || '?'} Mitgliedern. Berücksichtige das beim Erstellen (z.B. passender Ort, Dauer, Kategorie).` : ''}
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
- KATEGORIE: Wähle die am besten passende Kategorie.${categoryNames.length > 0 ? `
  - Der Nutzer hat bereits diese Kategorien: ${categoryNames.join(', ')}.
  - Bevorzuge IMMER eine bestehende Kategorie, wenn sie thematisch passt (auch fuzzy, z.B. "sport"/"laufen" → "Gesundheit" falls vorhanden). Gib den Namen EXAKT so zurück wie in der Liste.
  - Nur wenn KEINE bestehende Kategorie passt, schlage eine neue, sinnvolle vor (z.B. Arbeit, Persönlich, Gesundheit, Finanzen, Einkaufen, Haushalt, Bildung, Soziales).` : `
  - Nutze eine aus: Arbeit, Persönlich, Gesundheit, Finanzen, Einkaufen, Haushalt, Bildung, Soziales.`}
- ORT/LOCATION erkennen: Wenn ein Ort, Treffpunkt, eine Adresse oder ein Raum genannt wird, extrahiere ihn als "location".
  - Beispiele: "im Creative Space", "bei Dr. Müller", "Fitnessstudio McFit", "Büro", "Zuhause", "Rathausplatz 3", "Zoom", "online", "Stadion".
  - Erkenne auch "bei", "im", "in der", "@", "Ort:", "Treffpunkt", "Adresse".
  - Der Ort gehört NICHT in den Titel und NICHT in die Beschreibung — nur in "location".
  - Wenn kein Ort erkennbar ist → location: null.${knownLocations.length > 0 ? `
  - Häufig genutzte Orte des Nutzers (bevorzugt wiederverwenden bei passender Nennung): ${knownLocations.join(', ')}.` : ''}
- Bestimme die Priorität: low, medium, high, urgent
- Erkenne ob der Termin GANZTÄGIG ist:
  - "ganztägig", "den ganzen Tag", "ohne Uhrzeit", "all day", "Urlaub" (ohne Uhrzeit), Feiertage, mehrtägige Events ohne Uhrzeit → all_day: true, time: null, time_end: null
  - Wenn eine Uhrzeit angegeben ist → all_day: false
  - Wenn kein explizites Datum aber ganztägig → all_day: true
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
- "Urlaub nächste Woche" → title: "Urlaub", date: Montag-nächste-Woche, date_end: Freitag-nächste-Woche, all_day: true
- "Feiertag morgen" → title: "Feiertag", date: morgen, all_day: true
- "Termin ganztägig Montag" → title: "Termin", date: Montag, all_day: true
- "Peter kommt nicht zur Probe am Mittwoch 18 Uhr" → title: "Probe", description: "Peter kommt nicht zur Probe", date: Mittwoch-Datum, time: "18:00"
- "Einkaufen Milch Eier Butter Brot morgen" → title: "Einkaufen", description: "• Milch\\n• Eier\\n• Butter\\n• Brot", date: morgen, category: "Einkaufen"
- "Kirmes vom 20. bis 24. April" → title: "Kirmes", date: "2026-04-20", date_end: "2026-04-24"
- "Meeting morgen von 14 bis 16 Uhr" → title: "Meeting", date: morgen, time: "14:00", time_end: "16:00"
- "Arzttermin Dienstag 10-11:30 Uhr Zahnarzt Dr. Mueller" → title: "Arzttermin", description: "Zahnarzt Dr. Mueller", date: Dienstag, time: "10:00", time_end: "11:30", category: "Gesundheit"
- "Meeting morgen 14 Uhr im Creative Space" → type: "event", title: "Meeting", date: morgen, time: "14:00", location: "Creative Space", category: "Arbeit"
- "Freitag 18:30 Fußballtraining im Stadion" → type: "event", title: "Fußballtraining", date: Freitag, time: "18:30", location: "Stadion", category: "Gesundheit"
- "Zahnarzt bei Dr. Schmidt Mittwoch 9 Uhr" → type: "event", title: "Zahnarzt", date: Mittwoch, time: "09:00", location: "Dr. Schmidt", category: "Gesundheit"
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
  "location": "string oder null (Ort/Treffpunkt/Adresse, NICHT im Titel)",
  "priority": "low|medium|high|urgent",
  "hasReminder": true/false,
  "reminder_at": "YYYY-MM-DDTHH:MM:00 oder null (nur wenn hasReminder true)",
  "recurrence_rule": "daily|weekly|biweekly|monthly|yearly|weekdays" oder null,
  "recurrence_interval": 1 (Zahl, Standard 1),
  "recurrence_end": "YYYY-MM-DD oder null",
  "share_with": ["Name1", "Name2"] oder null,
  "group_name": "Gruppenname" oder null,
  "all_day": true/false,
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
      max_tokens: 700,
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
    const out = {
      type: parsed.type === 'event' ? 'event' : 'task',
      title: parsed.title || input,
      description: parsed.description || null,
      date: parsed.date || null,
      date_end: parsed.date_end || null,
      time: parsed.time || null,
      time_end: parsed.time_end || null,
      category: parsed.category || 'Persönlich',
      location: parsed.location || null,
      priority: parsed.priority || 'medium',
      hasReminder: parsed.hasReminder || false,
      reminder_at: parsed.reminder_at || null,
      recurrence_rule: parsed.recurrence_rule || null,
      recurrence_interval: parsed.recurrence_interval || 1,
      recurrence_end: parsed.recurrence_end || null,
      share_with: parsed.share_with || null,
      group_name: parsed.group_name || null,
      all_day: parsed.all_day === true,
      confidence: parsed.confidence || 0.8,
    };
    // If all_day, strip times
    if (out.all_day) { out.time = null; out.time_end = null; }
    return out;
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
      location: null,
      priority: 'medium',
      hasReminder: false,
      reminder_at: null,
      recurrence_rule: null,
      recurrence_interval: 1,
      recurrence_end: null,
      share_with: null,
      group_name: null,
      all_day: false,
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
   - Einfach löschen: "Lösche Zahnarzt", "Entferne den Termin Reinigung", "Streich Einkaufen", "weg mit Meeting", "Termin absagen", "cancel Probe"
   - Mit Datumbereich: "Lösche Zahnarzt von 20. bis 24. April" → date: "2026-04-20", date_end: "2026-04-24"
   - Ganzes Jahr: "Lösche komplett 2029" → date: "2029-01-01", date_end: "2029-12-31", task_title: null
   - Titel in Jahr: "Lösche Zahnarzt in 2029" → task_title: "Zahnarzt", date: "2029-01-01", date_end: "2029-12-31"
   - Bei Bereich ohne Titel: Alle Aufgaben in diesem Zeitraum löschen
3. "move" - Aufgabe/Termin verschieben (Datum/Zeit ändern)
   - "Verschiebe Zahnarzt auf Freitag", "Reinigung auf morgen", "Meeting auf 15 Uhr", "Arzttermin von Montag auf Mittwoch"
   - "Zahnarzt statt Montag lieber Dienstag", "Probe eine Stunde später", "verschieb das auf nächste Woche"
   - "verschiebe zahnarzt termin morgen auf freitag" → intent: "move", task_title: "Zahnarzt", new_date: Freitag-Datum
   - "Meeting von 14 auf 16 Uhr" → intent: "move", task_title: "Meeting", new_time: "16:00"
   - "den Arzt morgen auf nächste Woche" → intent: "move", new_date: nächste-Woche-gleicher-Tag
   - WICHTIG: Bei "verschiebe X morgen auf Y" bedeutet "morgen" wann der Termin AKTUELL ist, "auf Y" ist das NEUE Datum
4. "update" - Aufgabe/Termin ändern (Titel, Priorität, Uhrzeit, Beschreibung, Wiederholung etc.)
   - "Ändere Einkaufen zu dringend", "Zahnarzt Beschreibung: Raum 3"
   - "ändere Uhrzeit zu 8:30", "Zeit auf 10 Uhr setzen", "Uhrzeit ändern"
   - WIEDERKEHREND MACHEN: Erkenne wenn ein bestehender Termin wiederkehrend werden soll
     Signalwörter: "wiederkehrend", "wiederholen", "jedes Jahr", "jährlich", "jede Woche", "wöchentlich",
     "täglich", "monatlich", "jeden Monat", "jährlich wiederholen", "soll sich wiederholen"
     → intent: "update", updates.recurrence_rule, updates.recurrence_interval (Standard: 1)
   - recurrence_rule Werte:
     "täglich" / "jeden Tag" → "daily"
     "wöchentlich" / "jede Woche" / "jeden [Wochentag]" → "weekly"
     "alle 2 Wochen" / "jede zweite Woche" → "biweekly"
     "monatlich" / "jeden Monat" / "monatlich" → "monthly"
     "jährlich" / "jedes Jahr" / "einmal im Jahr" → "yearly"
     "werktags" / "jeden Werktag" / "Montag bis Freitag" → "weekdays"
   - recurrence_interval: Zahl (Standard 1, bei "alle 2 Wochen" → 2, bei "alle 3 Monate" → 3)
   - recurrence_end: Enddatum falls angegeben (YYYY-MM-DD), sonst null (kein Ende)
5. "attach" - Datei an Aufgabe anhängen
   - "Hänge Datei an Rechnung bezahlen", "Datei anhängen an Meeting", "Bild an Einkaufsliste", "Foto zu Zahnarzt hinzufügen"
   - Erkenne den Aufgabentitel aus der Liste
6. "query" - Frage nach freier Zeit / Kapazitäten im Kalender (KEINE neue Aufgabe!)
   - Signalwörter: "wann habe ich Zeit", "wo hab ich noch Platz", "wann bin ich frei", "kapazitäten",
     "wann kann ich Sport machen", "welcher Tag ist frei", "wann habe ich keinen Termin",
     "wo ist noch nichts eingetragen", "freie Slots", "wann könnte ich", "an welchem Tag",
     "hab ich noch Platz", "wann passt es", "wann wäre ein guter Zeitpunkt"
   - Beispiele: "Wo hab ich noch Kapazitäten?", "Wann kann ich zum Sport?", "Welcher Tag ist noch frei?"
   - WICHTIG: Kein task_title nötig, kein new_date/time nötig

SCOPE - Gilt die Änderung für ALLE Vorkommen oder nur EINEN Termin?
- scope: "single" → Nur DIESEN einen Termin ändern
  - Signalwörter: "nur am [Datum]", "nur diesen", "nicht wiederkehrend", "nur einmal", "nur den am [Datum]"
  - Beispiel: "ändere Uhrzeit zu 8:30 nur am 18. Mai" → scope: "single", target_date: "2026-05-18"
  - Beispiel: "verschiebe Probe am 20. Mai auf 10 Uhr, nicht die anderen" → scope: "single", target_date: "2026-05-20"
- scope: "all" → Alle Vorkommen / die ganze Terminserie ändern
  - Signalwörter: "alle", "immer", "jedes Mal", "die ganze Serie", "fortlaufend", "wiederkehrend"
  - Beispiel: "ändere alle Probe Termine auf 8:30" → scope: "all"
  - Wenn kein Datum und kein Scope-Hinweis erkennbar ist: scope: "all" (Standard für Änderungen)
- Wenn ein SPEZIFISCHES Datum genannt wird OHNE "alle"/"immer" → scope: "single", target_date = dieses Datum
- Wenn KEIN spezifisches Datum genannt wird → scope: "all"

Regeln:
- Matche den Task-Titel FUZZY aus der Liste (z.B. "zahnarzt" → "Zahnarzt", "reinigung" → "Reinigung")
- Bei "delete" und "move": task_title MUSS auf eine existierende Aufgabe verweisen (AUSNAHME: bei delete mit Datumbereich ohne Titel)
- Bei "delete" mit Datumbereich: Erkenne date (YYYY-MM-DD) und date_end (YYYY-MM-DD)
  - "von X bis Y" / "vom X. bis Y." → date_start, date_end
  - "in 2029" / "komplett 2029" → date_start: 2029-01-01, date_end: 2029-12-31
  - "in März 2029" → date_start: 2029-03-01, date_end: 2029-03-31
- Bei "move": Erkenne new_date (YYYY-MM-DD) und/oder new_time (HH:MM)
- Bei "move" ohne explizites Datum/Zeit: Versuche es aus dem Kontext zu erkennen
- Wenn der Nutzer sagt "auf morgen" → new_date: ${tomorrow}
- Wochentage korrekt berechnen aus der Liste oben
- Bei "update" mit Uhrzeit (z.B. "ändere Zeit zu 8:30", "Uhrzeit auf 10:00"): updates.time = "HH:MM"
- Bei "update" mit Wiederholung: updates.recurrence_rule = "yearly"/"monthly" etc., updates.recurrence_interval = 1
- Im Zweifel: intent "create" (Standardfall)

Antworte NUR mit validem JSON:
{
  "intent": "create|delete|move|update|attach|query",
  "task_title": "Erkannter Aufgabentitel aus der Liste (oder null bei create)",
  "new_date": "YYYY-MM-DD oder null (nur bei move)",
  "new_time": "HH:MM oder null (nur bei move)",
  "updates": {} oder null (nur bei update: z.B. {"time": "08:30", "recurrence_rule": "yearly", "recurrence_interval": 1, "recurrence_end": null}),
  "scope": "single oder all",
  "target_date": "YYYY-MM-DD oder null (das Datum des spezifischen Vorkommens bei scope=single)",
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
      intent: ['create', 'delete', 'move', 'update', 'attach', 'query'].includes(parsed.intent) ? parsed.intent : 'create',
      task_title: parsed.task_title || null,
      new_date: parsed.new_date || null,
      new_time: parsed.new_time || null,
      updates: parsed.updates || null,
      scope: ['single', 'all'].includes(parsed.scope) ? parsed.scope : 'all',
      target_date: parsed.target_date || null,
      confidence: parsed.confidence || 0.5,
    };
  } catch {
    return { intent: 'create', task_title: null, new_date: null, new_time: null, updates: null, scope: 'all', target_date: null, confidence: 0.2 };
  }
}

async function answerCalendarQueryWithAI(question, calendarContext) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY nicht konfiguriert');

  const systemPrompt = `Du bist ein hilfreicher Kalender-Assistent der BeeQu-App.
Der Nutzer stellt eine Frage über seinen Kalender / seine freie Zeit.
Antworte auf Deutsch, konkret, freundlich und kurz (max. 4 Sätze).
Nenne spezifische Tage und Uhrzeiten. Wenn du Sport oder Aktivitäten empfiehlst, nenne den besten Tag dafür.
Nutze keine Markdown-Formatierung, schreibe normalen Text.

Heutiges Datum: ${calendarContext.today} (${calendarContext.todayName})

Termine und Aufgaben der nächsten 14 Tage:
${calendarContext.days.map(d => {
  const events = d.tasks.length === 0
    ? 'Nichts eingetragen – komplett frei'
    : d.tasks.map(t => `  • ${t.title}${t.time ? ` um ${t.time}${t.time_end ? `–${t.time_end}` : ''}` : ' (ganztägig)'}`).join('\n');
  return `${d.dayName}, ${d.date}:\n${events}`;
}).join('\n\n')}`;

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
        { role: 'user', content: question },
      ],
      temperature: 0.4,
      max_tokens: 250,
    }),
  });

  if (!response.ok) throw new Error(`Mistral API Fehler: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || 'Ich konnte deinen Kalender leider nicht analysieren.';
}

async function parseChecklistWithAI(input) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY nicht konfiguriert');

  const systemPrompt = `Du bist ein Assistent fuer Notizen. Deine Aufgabe: aus freiem Text eine abhakbare To-do-Liste erzeugen.

Regeln:
- Erkenne Aufgaben/Artikel in Texten wie: "gemuese, aepfel, bananen", "bitte kaufen: Milch, Eier", "Packen: Shirt, Hose".
- Entferne Fuellwoerter und gib kurze, klare Item-Texte aus.
- Liefere maximal 20 Items.
- Erhalte die Reihenfolge aus dem Ursprungstext.
- Wenn kein Listeninhalt erkennbar ist, gib items als leeres Array zurueck.
- Antworte NUR mit validem JSON.

JSON Format:
{
  "intro": "string oder null",
  "items": [
    { "text": "string", "checked": false }
  ],
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
        { role: 'user', content: String(input || '') },
      ],
      temperature: 0.1,
      max_tokens: 350,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) throw new Error(`Mistral API Fehler: ${response.status}`);

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Keine Antwort von Mistral');

  try {
    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .map((entry) => ({
            text: String(entry?.text || '').trim(),
            checked: entry?.checked === true,
          }))
          .filter((entry) => entry.text.length > 0)
          .slice(0, 20)
      : [];

    return {
      intro: parsed.intro ? String(parsed.intro).trim() : null,
      items,
      confidence: Number(parsed.confidence) || 0.5,
    };
  } catch {
    return { intro: null, items: [], confidence: 0.2 };
  }
}

// ── Notes AI: Zusammenfassung, Rewrite, Tag-Vorschlaege ────────────
//
// Inputs sind frei (Plain-Text oder simples HTML). Wir strippen Tags
// auf der Server-Seite vor dem Prompt, damit der LLM nicht durch Markup
// abgelenkt wird. Ergebnisse sind reiner Text/Listen — Markup wird im
// Frontend (optional) wieder erzeugt.

function stripHtmlForAi(input) {
  return String(input || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>(?:\s*)/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 6000);
}

async function summarizeNoteWithAI(input) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY nicht konfiguriert');
  const text = stripHtmlForAi(input);
  if (!text) return { summary: '', confidence: 0.0 };

  const systemPrompt = `Du fasst Notizen auf Deutsch zusammen.

Regeln:
- 2 bis 4 kurze Bulletpoints, jeweils maximal 1 Satz.
- Behalte konkrete Fakten (Namen, Daten, Zahlen) bei.
- Keine Floskeln, keine Wiederholungen, kein Markup.
- Antworte NUR mit validem JSON.

JSON Format:
{
  "summary": "string (Bullets durch \\n - getrennt)",
  "confidence": 0.0-1.0
}`;

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.2,
      max_tokens: 400,
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
      summary: String(parsed.summary || '').trim(),
      confidence: Number(parsed.confidence) || 0.5,
    };
  } catch {
    return { summary: '', confidence: 0.2 };
  }
}

async function rewriteNoteWithAI(input, style = 'cleanup') {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY nicht konfiguriert');
  const text = stripHtmlForAi(input);
  if (!text) return { rewritten: '', confidence: 0.0 };

  const styleHint = {
    cleanup: 'Behalte Inhalt und Tonalitaet, verbessere Grammatik, Rechtschreibung und Lesbarkeit. Keine Kuerzungen.',
    short: 'Kuerze auf das Wesentliche (max 50 Prozent der Laenge). Keine Fakten weglassen.',
    formal: 'Schreibe sachlich und foermlich (Sie-Form, klare Saetze). Inhalt unveraendert.',
    casual: 'Schreibe locker und freundlich (Du-Form, kurze Saetze). Inhalt unveraendert.',
  }[style] || 'Behalte Inhalt und Tonalitaet, verbessere Grammatik und Lesbarkeit.';

  const systemPrompt = `Du ueberarbeitest Notizen auf Deutsch.

${styleHint}

Regeln:
- Antworte mit dem ueberarbeiteten Text als reiner Plain-Text.
- KEIN Markdown, KEINE Anfuehrungszeichen drumherum, KEINE Erklaerung.
- Behalte Absatz-Struktur (Leerzeilen).`;

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      max_tokens: 1200,
    }),
  });
  if (!response.ok) throw new Error(`Mistral API Fehler: ${response.status}`);
  const data = await response.json();
  const rewritten = data.choices?.[0]?.message?.content?.trim() || '';
  return { rewritten, confidence: rewritten ? 0.8 : 0.0 };
}

function normalizeTag(tag) {
  return String(tag || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-äöüß ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function buildFallbackNoteTags(input, reason = 'fallback') {
  const text = stripHtmlForAi(input);
  if (!text) return { tags: [], confidence: 0.0, source: reason };

  const stop = new Set([
    'und', 'oder', 'aber', 'dass', 'das', 'der', 'die', 'den', 'dem', 'des', 'ein', 'eine',
    'einer', 'einem', 'einen', 'ist', 'sind', 'war', 'waren', 'mit', 'fuer', 'auf', 'bei',
    'von', 'vom', 'zum', 'zur', 'im', 'in', 'am', 'an', 'aus', 'als', 'auch', 'nicht',
    'noch', 'nur', 'bitte', 'heute', 'morgen', 'gestern', 'dann', 'wenn', 'weil', 'ueber',
    'unter', 'ohne', 'wie', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'mein', 'dein',
    'sein', 'ihr', 'unser', 'euer', 'todo', 'notiz', 'notizen', 'task', 'tasks',
  ]);

  const hashTags = [];
  const hashRe = /#([a-z0-9äöüß\-]{2,24})/gi;
  let m = hashRe.exec(text);
  while (m) {
    hashTags.push(normalizeTag(m[1]));
    m = hashRe.exec(text);
  }

  const freq = new Map();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\-\s]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  for (const raw of words) {
    const token = normalizeTag(raw);
    if (token.length < 3 || /^\d+$/.test(token) || stop.has(token)) continue;
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([token]) => token);

  const unique = [];
  for (const t of [...hashTags, ...ranked]) {
    if (!t || unique.includes(t)) continue;
    unique.push(t);
    if (unique.length >= 6) break;
  }

  return {
    tags: unique,
    confidence: unique.length > 0 ? 0.35 : 0.1,
    source: reason,
  };
}

async function suggestNoteTagsWithAI(input) {
  const key = process.env.MISTRAL_API_KEY;
  const text = stripHtmlForAi(input);
  if (!text) return { tags: [], confidence: 0.0 };
  if (!key) return buildFallbackNoteTags(text, 'missing_api_key');

  const systemPrompt = `Du schlaegst Tags fuer Notizen vor.

Regeln:
- 3 bis 6 kurze Tags (1-2 Worte, kleingeschrieben, Deutsch).
- Themen-/Kategorie-orientiert (z. B. "einkauf", "projekt-x", "urlaub").
- Keine Sonderzeichen ausser Bindestrich.
- Antworte NUR mit validem JSON.

JSON Format:
{
  "tags": ["string", ...],
  "confidence": 0.0-1.0
}`;

  try {
    const response = await fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) throw new Error(`Mistral API Fehler: ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Keine Antwort von Mistral');
    const parsed = JSON.parse(content);
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .map((t) => normalizeTag(t))
          .filter((t) => t.length >= 2 && t.length <= 24)
          .slice(0, 6)
      : [];
    if (tags.length === 0) return buildFallbackNoteTags(text, 'ai_empty_tags');
    return {
      tags,
      confidence: Number(parsed.confidence) || 0.5,
    };
  } catch (err) {
    console.warn('suggestNoteTagsWithAI fallback aktiv:', err?.message || err);
    return buildFallbackNoteTags(text, 'ai_error');
  }
}

async function parseSpendingWithAI(input) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY nicht konfiguriert');

  const systemPrompt = `Du bist ein Finanz-Assistent. Analysiere Freitext und extrahiere eine Einnahme oder Ausgabe.

WICHTIG: Antworte NUR mit validem JSON-Objekt.

JSON Format:
{
  "kind": "income" | "expense",
  "category": "food" | "home" | "travel" | "free" | "salary" | "gift" | "side" | "other",
  "amount": number,
  "description": "string",
  "recurrence": "none" | "monthly" | "quarterly" | "yearly",
  "confidence": 0.0-1.0
}

Regeln:
- kind = "income" bei: Gehalt, Lohn, Geschenk, Auszahlung, Erstattung, Verkauf, Nebenjob, Trinkgeld, Rente, Bonus, Zinsen, Dividende, BAföG, Stipendium.
- kind = "expense" bei: Kauf, Rechnung, Miete, Einkauf, Restaurant, Tanken, Ticket, Hotel, sonst alles was Geld kostet.
- Ausgaben-Kategorien:
  - "food" = Essen, Trinken, Restaurant, Cafe, Supermarkt, Lieferdienst, Pizza, Bäcker
  - "home" = Miete, Nebenkosten, Strom, Wasser, Internet, Möbel, Renovierung, Versicherung, Putzmittel
  - "travel" = Tickets, Bahn, Flug, Hotel, Tanken, Taxi, Urlaub, Ausflug, Maut
  - "free" = Freizeit, Kino, Konzert, Sport, Hobby, Streaming, Bücher, Spiele, Shopping, Kleidung
- Einnahmen-Kategorien:
  - "salary" = Gehalt, Lohn, monatliches Einkommen, Rente, BAföG
  - "gift" = Geschenk, Trinkgeld, Spende
  - "side" = Nebenjob, Verkauf, Freelance, Bonus, Provision
  - "other" = alles andere Eingehende
- amount: Zahl in Euro. Akzeptiere "10€", "10,50", "10.50", "ca 20". Falls unklar → 0.
- description: kurze beschreibende Zeile, z.B. "Pizza Mario", "Wocheneinkauf REWE", "Gehalt Mai", "Tankfüllung". Lass den Betrag und das Wort "Euro" aus der Beschreibung weg.
- recurrence: erkenne ob es sich um eine WIEDERKEHRENDE Zahlung handelt:
  - "monatlich", "jeden Monat", "pro Monat", "p.M.", "monatl.", "Abo", "Miete", "Gehalt", "Strom", "Netflix", "Spotify", "Versicherung", "Handyvertrag", "Internet", "GEZ", "Rundfunk", "Fitnessstudio" → "monthly"
  - "vierteljährlich", "quartalsweise", "alle 3 Monate", "alle drei Monate", "Q1/Q2/Q3/Q4" → "quarterly"
  - "jährlich", "jedes Jahr", "p.a.", "pro Jahr", "Jahresbeitrag", "Versicherung jährlich" → "yearly"
  - sonst → "none"
- confidence: dein Sicherheitswert.

Beispiele:
- "25€ Pizza heute" → {"kind":"expense","category":"food","amount":25,"description":"Pizza","recurrence":"none","confidence":0.95}
- "Wocheneinkauf REWE 87,50" → {"kind":"expense","category":"food","amount":87.50,"description":"Wocheneinkauf REWE","recurrence":"none","confidence":0.95}
- "Tankfüllung 65" → {"kind":"expense","category":"travel","amount":65,"description":"Tankfüllung","recurrence":"none","confidence":0.9}
- "Gehalt 2400" → {"kind":"income","category":"salary","amount":2400,"description":"Gehalt","recurrence":"monthly","confidence":0.95}
- "Miete 850 monatlich" → {"kind":"expense","category":"home","amount":850,"description":"Miete","recurrence":"monthly","confidence":0.98}
- "Netflix Abo 17,99" → {"kind":"expense","category":"free","amount":17.99,"description":"Netflix Abo","recurrence":"monthly","confidence":0.95}
- "Versicherung 320 vierteljährlich" → {"kind":"expense","category":"home","amount":320,"description":"Versicherung","recurrence":"quarterly","confidence":0.95}
- "GEZ alle 3 Monate 55,08" → {"kind":"expense","category":"home","amount":55.08,"description":"GEZ Rundfunkbeitrag","recurrence":"quarterly","confidence":0.95}
- "KfZ-Versicherung 480 jährlich" → {"kind":"expense","category":"travel","amount":480,"description":"KfZ-Versicherung","recurrence":"yearly","confidence":0.95}
- "Oma 50 geschenkt" → {"kind":"income","category":"gift","amount":50,"description":"Geschenk Oma","recurrence":"none","confidence":0.9}
- "Konzertkarte Rammstein 89" → {"kind":"expense","category":"free","amount":89,"description":"Konzertkarte Rammstein","recurrence":"none","confidence":0.95}`;

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
        { role: 'user', content: String(input || '') },
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) throw new Error(`Mistral API Fehler: ${response.status}`);

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Keine Antwort von Mistral');

  try {
    const parsed = JSON.parse(content);
    const kind = parsed.kind === 'income' ? 'income' : 'expense';
    const expenseCats = new Set(['food', 'home', 'travel', 'free']);
    const incomeCats = new Set(['salary', 'gift', 'side', 'other']);
    const validCats = kind === 'income' ? incomeCats : expenseCats;
    const category = validCats.has(parsed.category) ? parsed.category : (kind === 'income' ? 'other' : 'free');
    const validRecurrences = new Set(['none', 'monthly', 'quarterly', 'yearly']);
    const recurrence = validRecurrences.has(parsed.recurrence) ? parsed.recurrence : 'none';
    let amount = Number(parsed.amount);
    if (!Number.isFinite(amount) || amount < 0) amount = 0;
    amount = Math.round(amount * 100) / 100;
    return {
      kind,
      category,
      amount,
      description: String(parsed.description || '').slice(0, 200).trim(),
      recurrence,
      confidence: Number(parsed.confidence) || 0.5,
    };
  } catch {
    return { kind: 'expense', category: 'free', amount: 0, description: '', recurrence: 'none', confidence: 0.1 };
  }
}

module.exports = {
  parseTaskWithAI,
  parsePermissionsWithAI,
  classifyIntentWithAI,
  answerCalendarQueryWithAI,
  parseChecklistWithAI,
  summarizeNoteWithAI,
  rewriteNoteWithAI,
  suggestNoteTagsWithAI,
  parseSpendingWithAI,
};

