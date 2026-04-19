import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

export async function parseTaskWithAI(input) {
  if (!MISTRAL_API_KEY) {
    throw new Error('MISTRAL_API_KEY nicht konfiguriert');
  }

  const now = new Date();
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const currentDate = now.toISOString().split('T')[0];
  const currentDay = days[now.getDay()];

  const systemPrompt = `Du bist ein Task-Parser. Analysiere die Eingabe und extrahiere strukturierte Daten.

Aktuelles Datum: ${currentDate} (${currentDay})

Regeln:
- Erkenne den Aufgabentitel (was getan werden soll)
- Erkenne Datumsangaben: heute, morgen, übermorgen, Wochentage (nächsten Montag etc.), konkrete Daten
- Erkenne Uhrzeiten (18 Uhr, 14:30, nachmittags etc.)
- Wähle eine passende Kategorie aus: Arbeit, Persönlich, Gesundheit, Finanzen, Einkaufen, Haushalt, Bildung, Soziales
- Bestimme die Priorität: low, medium, high, urgent
- Erkenne ob eine Erinnerung gewünscht ist ("erinnere mich", "reminder" etc.)
- Wenn ein Wochentag genannt wird, berechne das nächste entsprechende Datum ab heute
- Antworte NUR mit validem JSON, kein anderer Text

Berechne Wochentage korrekt:
- Heute ist ${currentDay}, ${currentDate}
- "Freitag" → das Datum des nächsten Freitags
- "morgen" → ${new Date(now.getTime() + 86400000).toISOString().split('T')[0]}
- "übermorgen" → ${new Date(now.getTime() + 172800000).toISOString().split('T')[0]}

JSON Format:
{
  "title": "string (der bereinigte Aufgabentitel)",
  "date": "YYYY-MM-DD oder null",
  "time": "HH:MM oder null",
  "category": "string (eine der genannten Kategorien)",
  "priority": "low|medium|high|urgent",
  "hasReminder": true/false,
  "confidence": 0.0-1.0
}`;

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
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
    const errText = await response.text();
    console.error('Mistral API error:', response.status, errText);
    throw new Error(`Mistral API Fehler: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Keine Antwort von Mistral erhalten');
  }

  try {
    const parsed = JSON.parse(content);
    return {
      title: parsed.title || input,
      date: parsed.date || null,
      time: parsed.time || null,
      category: parsed.category || 'Persönlich',
      priority: parsed.priority || 'medium',
      hasReminder: parsed.hasReminder || false,
      confidence: parsed.confidence || 0.8,
    };
  } catch {
    console.error('Failed to parse Mistral response:', content);
    return {
      title: input,
      date: null,
      time: null,
      category: 'Persönlich',
      priority: 'medium',
      hasReminder: false,
      confidence: 0.3,
    };
  }
}
