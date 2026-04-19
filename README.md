# 🧠 Taski – KI-gestützte To-Do & Kalender App

Eine moderne, produktionsreife Web-App mit KI-gestützter Aufgabenverwaltung. Schreibe einfach in natürlicher Sprache – die KI erkennt automatisch Titel, Datum, Uhrzeit, Kategorie und Priorität.

## ✨ Features

- **KI Natural Language Parsing** – "Freitag Reinigung 18 Uhr" → strukturierte Aufgabe
- **Mistral AI Integration** – Leistungsfähiges AI-Backend für Texterkennung
- **Kalender** – Monats- und Wochenansicht
- **Drag & Drop** – Aufgaben per Drag neu ordnen
- **Smart Kategorien** – Automatisch durch KI erkannt
- **Auto-Priorisierung** – KI schätzt Dringlichkeit ein
- **Live Feedback** – Sofortige Rückmeldung nach Aktionen
- **Apple iOS Design** – Glassmorphism, sanfte Animationen, Premium-Look
- **Responsive** – Mobile + Desktop optimiert

## 🛠 Tech Stack

| Layer     | Technologie                        |
|-----------|-----------------------------------|
| Frontend  | React (Vite), Framer Motion, Zustand |
| Backend   | Node.js, Express                   |
| Datenbank | PostgreSQL                         |
| KI        | Mistral AI API                     |
| Auth      | JWT (bcrypt)                       |
| Styling   | Custom CSS (Apple iOS Design)      |

## 📋 Voraussetzungen

- **Node.js** 18+ (https://nodejs.org)
- **PostgreSQL** 14+ (https://www.postgresql.org/download/)
- **Mistral AI API Key** (https://console.mistral.ai)

## 🚀 Setup Anleitung

### 1. Repository klonen & Dependencies installieren

```bash
cd ai-todo-calendar
npm run install:all
```

### 2. Umgebungsvariablen konfigurieren

`.env` im Root-Verzeichnis erstellen (siehe `.env.example`):

```env
MISTRAL_API_KEY=dein_mistral_api_key
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ai_todo_calendar
DB_USER=postgres
DB_PASSWORD=dein_passwort
JWT_SECRET=ein_sicheres_geheimnis
PORT=3001
```

### 3. PostgreSQL Datenbank erstellen

```bash
# PostgreSQL Terminal öffnen
psql -U postgres

# Datenbank erstellen
CREATE DATABASE ai_todo_calendar;
\q
```

### 4. Datenbank-Schema initialisieren

```bash
npm run db:init
```

### 5. App starten

```bash
npm run dev
```

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3001
- **API Health**: http://localhost:3001/api/health

## 📁 Projektstruktur

```
ai-todo-calendar/
├── .env.example          # Umgebungsvariablen Template
├── package.json          # Root Scripts
├── README.md
├── backend/
│   ├── package.json
│   ├── server.js         # Express Server
│   ├── config/
│   │   └── db.js         # PostgreSQL Connection
│   ├── middleware/
│   │   └── auth.js       # JWT Auth
│   ├── models/
│   │   └── init.sql      # DB Schema
│   ├── routes/
│   │   ├── auth.js       # Login/Register
│   │   ├── tasks.js      # CRUD Tasks
│   │   ├── categories.js # Kategorien
│   │   └── ai.js         # KI Parsing
│   └── services/
│       └── mistral.js    # Mistral AI Service
├── frontend/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── index.css        # Apple iOS Design
│       ├── store/
│       │   ├── authStore.js # Auth State
│       │   └── taskStore.js # Task State
│       ├── utils/
│       │   └── api.js       # API Client
│       ├── components/
│       │   ├── AIInput.jsx       # KI Eingabefeld
│       │   ├── Calendar.jsx      # Kalender
│       │   ├── FeedbackToast.jsx # Toast Benachrichtigungen
│       │   ├── Layout.jsx        # App Layout
│       │   ├── Sidebar.jsx       # Navigation
│       │   ├── TaskCard.jsx      # Aufgaben-Karte
│       │   └── TaskList.jsx      # Aufgabenliste
│       └── pages/
│           ├── Dashboard.jsx     # Hauptseite
│           ├── CalendarPage.jsx  # Kalender-Seite
│           ├── Login.jsx
│           └── Register.jsx
```

## 🔑 API Endpoints

### Auth
- `POST /api/auth/register` – Registrierung
- `POST /api/auth/login` – Anmeldung
- `GET /api/auth/me` – Aktueller Benutzer

### Tasks
- `GET /api/tasks` – Alle Aufgaben (mit Filtern)
- `GET /api/tasks/range?start=&end=` – Aufgaben im Datumsbereich
- `POST /api/tasks` – Aufgabe erstellen
- `PUT /api/tasks/:id` – Aufgabe bearbeiten
- `PATCH /api/tasks/:id/toggle` – Status umschalten
- `PATCH /api/tasks/reorder` – Reihenfolge ändern
- `DELETE /api/tasks/:id` – Aufgabe löschen
- `GET /api/tasks/reminders/due` – Fällige Erinnerungen

### KI
- `POST /api/ai/parse` – Text analysieren (Vorschau)
- `POST /api/ai/parse-and-create` – Text analysieren & Aufgabe erstellen

### Kategorien
- `GET /api/categories` – Alle Kategorien
- `POST /api/categories` – Kategorie erstellen
- `DELETE /api/categories/:id` – Kategorie löschen

## 🧪 Beispiel KI-Eingaben

| Eingabe | Erkanntes Ergebnis |
|---------|-------------------|
| "Freitag Reinigung 18 Uhr" | Titel: Reinigung, Datum: nächster Freitag, Zeit: 18:00, Kategorie: Haushalt |
| "Erinnere mich morgen an Rechnung" | Titel: Rechnung, Datum: morgen, Erinnerung: ja, Kategorie: Finanzen |
| "Dringend: Arzttermin Mittwoch 10:30" | Titel: Arzttermin, Datum: Mittwoch, Zeit: 10:30, Priorität: urgent, Kategorie: Gesundheit |
| "Milch und Eier kaufen" | Titel: Milch und Eier kaufen, Kategorie: Einkaufen |

## 📄 Lizenz

MIT License
