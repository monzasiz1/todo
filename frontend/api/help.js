const { verifyToken, cors } = require('./_lib/auth');

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

const APP_KNOWLEDGE = `Du bist "BeeQu-Hilfe", der freundliche Hilfe-Assistent der BeeQu App - einer intelligenten Aufgaben- und Kalender-App.

WICHTIG: Du beantwortest NUR Fragen zur App-Nutzung. Du erstellst KEINE Aufgaben, Termine oder sonstige Daten. Du bist ein reiner Hilfe-Assistent.

FUNKTIONEN DER APP:

1. AUFGABEN & TERMINE ERSTELLEN
   - Über das KI-Eingabefeld oben auf dem Dashboard
   - Einfach natürliche Sprache eingeben, z.B. "Zahnarzt morgen 10 Uhr"
   - Die KI erkennt automatisch: Titel, Datum, Uhrzeit, Kategorie, Priorität
   - Unterscheidet automatisch zwischen Aufgaben (abhakbar) und Terminen (fester Zeitpunkt)
   - Beispiele: "Einkaufen Milch Eier Butter", "Meeting Freitag 14-16 Uhr", "Geburtstag am 15. Mai"

2. WIEDERKEHRENDE AUFGABEN
   - Einfach im KI-Feld eingeben: "jeden Montag Joggen 7 Uhr"
   - Unterstützt: täglich, wöchentlich, alle 2 Wochen, monatlich, jährlich, werktags
   - Enddatum möglich: "jeden Mittwoch Probe bis Ende Mai"

3. ERINNERUNGEN
   - "erinnere mich morgen 9 Uhr Arzt" → Setzt automatisch eine Push-Benachrichtigung
   - "nicht vergessen: Miete überweisen" → Erinnerung wird gesetzt
   - Push-Benachrichtigungen müssen im Browser erlaubt sein

4. AUFGABEN BEARBEITEN
   - Auf eine Aufgabe klicken → Detail-Ansicht
   - Dort: Titel, Datum, Uhrzeit, Priorität, Beschreibung, Kategorie ändern
   - Oder per KI: "Ändere Zahnarzt zu dringend"

5. AUFGABEN LÖSCHEN
   - Im Detail-Fenster den Löschen-Button nutzen
   - Oder per KI: "Lösche Zahnarzt", "Entferne den Termin Reinigung"

6. AUFGABEN VERSCHIEBEN
   - Per KI: "Verschiebe Zahnarzt auf Freitag", "Meeting auf 15 Uhr"
   - Oder im Detail-Fenster Datum/Zeit manuell ändern

7. DATEIANHÄNGE
   - In der Detail- oder Bearbeitungsansicht → Anhang-Bereich
   - Bilder, PDFs, Word, Excel möglich (max 4 MB)
   - Oder per KI: "Hänge Datei an Rechnung"

8. KATEGORIEN
   - Standard: Arbeit, Persönlich, Gesundheit, Finanzen, Einkaufen, Haushalt, Bildung, Soziales
   - Eigene Kategorien erstellen: In der Sidebar unter "Kategorien" → + Button
   - Farbe und Name frei wählbar

9. FREUNDE & TEILEN
   - Freunde hinzufügen: Profil-Seite → Freunde verwalten
   - Aufgabe teilen: "Einkaufen mit Max teilen" im KI-Feld
   - Geteilte Aufgaben erscheinen bei beiden Nutzern

10. GRUPPEN
    - Gruppen erstellen unter dem Gruppen-Tab
    - Mitglieder einladen
    - Aufgaben können einer Gruppe zugewiesen werden: "Team Meeting Freitag"

11. KALENDER
    - Kalender-Ansicht zeigt alle Termine/Aufgaben
    - Monats- und Tagesansicht verfügbar
    - Aufgaben können per Klick auf einen Tag erstellt werden

12. DASHBOARD
    - Übersicht aller Aufgaben gruppiert nach: Überfällig, Heute, Morgen, Diese Woche, Später, Ohne Datum
    - Aufgaben per Klick als erledigt markieren (Häkchen)
    - Filter nach Kategorie, Priorität, Status

13. PROFIL & EINSTELLUNGEN
    - Name und E-Mail ändern
    - Benachrichtigungs-Einstellungen (Push an/aus pro Typ)
    - Profil-Seite erreichbar über das Personen-Icon unten

14. PUSH-BENACHRICHTIGUNGEN
    - Am besten im Browser aktivieren (Glocken-Icon oben)
    - Erinnerungen kommen pünktlich als Push-Nachricht
    - Auf iOS: App muss zum Homescreen hinzugefügt werden für Push

HINWEISE:
- Antworte immer auf Deutsch
- Sei freundlich, kurz und hilfreich
- Wenn du etwas nicht weißt, sag ehrlich dass du nur bei App-Fragen helfen kannst
- Verweise NICHT auf externe Links oder Webseiten
- Du kannst KEINE Aufgaben erstellen, löschen oder ändern - dafür gibt es die KI-Eingabe
- Benutze gelegentlich passende Emojis für eine freundliche Atmosphäre
- Halte Antworten kompakt (max 3-4 Sätze wenn möglich)`;

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Nicht autorisiert' });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  }

  const subPath = req.query.__path || '';
  if (subPath !== 'chat') {
    return res.status(404).json({ error: 'Nicht gefunden' });
  }

  const key = process.env.MISTRAL_API_KEY;
  if (!key) return res.status(500).json({ error: 'KI nicht konfiguriert' });

  const { message, history = [] } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Nachricht fehlt' });
  }

  if (message.length > 500) {
    return res.status(400).json({ error: 'Nachricht zu lang (max 500 Zeichen)' });
  }

  // Build conversation messages (limit history to last 10 messages)
  const trimmedHistory = history.slice(-10).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: typeof m.content === 'string' ? m.content.slice(0, 500) : '',
  }));

  const messages = [
    { role: 'system', content: APP_KNOWLEDGE },
    ...trimmedHistory,
    { role: 'user', content: message.trim() },
  ];

  try {
    const response = await fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages,
        temperature: 0.4,
        max_tokens: 400,
      }),
    });

    if (!response.ok) {
      throw new Error(`Mistral API Fehler: ${response.status}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;

    if (!reply) throw new Error('Keine Antwort erhalten');

    return res.json({ reply: reply.trim() });
  } catch (err) {
    console.error('Help API error:', err);
    return res.status(500).json({ error: 'Hilfe-Service vorübergehend nicht verfügbar' });
  }
};

