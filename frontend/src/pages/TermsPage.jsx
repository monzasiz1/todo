import { Link } from 'react-router-dom';

const sections = [
  {
    title: '1. Geltungsbereich',
    text: [
      'Diese Allgemeinen Geschaeftsbedingungen (AGB) gelten fuer die Nutzung der Web- und App-Dienste von BeeQu (nachfolgend BeeQu).',
      'Mit der Registrierung oder Nutzung der Plattform stimmen Nutzer diesen AGB in der jeweils gueltigen Fassung zu.',
    ],
  },
  {
    title: '2. Vertragsgegenstand',
    text: [
      'BeeQu stellt eine Plattform zur Verwaltung von Aufgaben, Terminen, Notizen und Teamfunktionen bereit.',
      'Der konkrete Funktionsumfang kann je nach Tarif variieren. Angaben zu Tarifen und Leistungen sind auf der Preisseite einsehbar.',
    ],
  },
  {
    title: '3. Registrierung und Nutzerkonto',
    text: [
      'Fuer die vollstaendige Nutzung ist ein Nutzerkonto erforderlich. Die bei der Registrierung gemachten Angaben muessen wahrheitsgemaess sein.',
      'Nutzer sind verpflichtet, ihre Zugangsdaten vertraulich zu behandeln und vor unbefugtem Zugriff zu schuetzen.',
    ],
  },
  {
    title: '4. Zulaessige Nutzung',
    text: [
      'Die Plattform darf nur im Rahmen der geltenden Gesetze verwendet werden.',
      'Unzulaessig sind insbesondere missbraeuchliche, rechtswidrige oder sicherheitsgefaehrdende Handlungen sowie Versuche, den Dienst technisch zu stoeren.',
    ],
  },
  {
    title: '5. Verfuegbarkeit und Aenderungen',
    text: [
      'BeeQu ist um eine hohe Verfuegbarkeit bemueht, kann jedoch keine unterbrechungsfreie Erreichbarkeit garantieren.',
      'BeeQu behaelt sich vor, Funktionen weiterzuentwickeln, anzupassen oder einzustellen, sofern berechtigte Interessen und die Zumutbarkeit fuer Nutzer gewahrt bleiben.',
    ],
  },
  {
    title: '6. Preise und Zahlung',
    text: [
      'Kostenpflichtige Tarife werden vor Vertragsschluss klar ausgewiesen.',
      'Abrechnungszeitraum, Zahlungsart, Laufzeit und Kuendigungsfristen ergeben sich aus dem jeweils gebuchten Plan.',
    ],
  },
  {
    title: '7. Inhalte und Rechte',
    text: [
      'Nutzer bleiben Inhaber der von ihnen eingestellten Inhalte.',
      'Soweit fuer die Vertragserfuellung erforderlich, raeumen Nutzer BeeQu ein einfaches, nicht ausschliessliches Nutzungsrecht zur Speicherung, Verarbeitung und Anzeige der Inhalte ein.',
    ],
  },
  {
    title: '8. Haftung',
    text: [
      'BeeQu haftet unbeschraenkt bei Vorsatz und grober Fahrlaessigkeit sowie bei Verletzung von Leben, Koerper und Gesundheit.',
      'Bei leicht fahrlaessiger Verletzung wesentlicher Vertragspflichten ist die Haftung auf den vertragstypisch vorhersehbaren Schaden begrenzt.',
      'Im Uebrigen ist die Haftung ausgeschlossen, soweit gesetzlich zulaessig.',
    ],
  },
  {
    title: '9. Laufzeit und Kuendigung',
    text: [
      'Nutzer koennen ihr Konto jederzeit kuendigen, sofern keine abweichenden Fristen bei kostenpflichtigen Tarifen gelten.',
      'BeeQu kann Konten aus wichtigem Grund sperren oder kuendigen, insbesondere bei schwerwiegenden Verstoessen gegen diese AGB.',
    ],
  },
  {
    title: '10. Schlussbestimmungen',
    text: [
      'Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts, soweit keine zwingenden Verbraucherschutzvorschriften entgegenstehen.',
      'Sollten einzelne Bestimmungen dieser AGB unwirksam sein, bleibt die Wirksamkeit der uebrigen Bestimmungen unberuehrt.',
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <div className="legal-top-nav">
          <Link to="/" className="legal-back-link">Zur Landing</Link>
        </div>

        <header className="legal-header">
          <h1>Allgemeine Geschaeftsbedingungen (AGB)</h1>
          <p>Stand: 02.05.2026</p>
          <p>
            Hinweis: Dieser Text ist eine allgemeine Vorlage und ersetzt keine individuelle Rechtsberatung.
            Bitte pruefe den Inhalt vor Produktivnutzung rechtlich.
          </p>
        </header>

        <section className="legal-section">
          {sections.map((section) => (
            <article key={section.title} className="legal-card">
              <h2>{section.title}</h2>
              {section.text.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
