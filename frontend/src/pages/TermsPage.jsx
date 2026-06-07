import { Link } from 'react-router-dom';

const sections = [
  {
    title: '1. Geltungsbereich',
    text: [
      'Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für die Nutzung der Web- und App-Dienste von BeeQu (nachfolgend BeeQu).',
      'Mit der Registrierung oder Nutzung der Plattform stimmen Nutzer diesen AGB in der jeweils gültigen Fassung zu.',
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
      'Für die vollständige Nutzung ist ein Nutzerkonto erforderlich. Die bei der Registrierung gemachten Angaben müssen wahrheitsgemäß sein.',
      'Nutzer sind verpflichtet, ihre Zugangsdaten vertraulich zu behandeln und vor unbefugtem Zugriff zu schützen.',
    ],
  },
  {
    title: '4. Zulässige Nutzung',
    text: [
      'Die Plattform darf nur im Rahmen der geltenden Gesetze verwendet werden.',
      'Unzulässig sind insbesondere missbräuchliche, rechtswidrige oder sicherheitsgefährdende Handlungen sowie Versuche, den Dienst technisch zu stören.',
    ],
  },
  {
    title: '5. Verfügbarkeit und Änderungen',
    text: [
      'BeeQu ist um eine hohe Verfügbarkeit bemüht, kann jedoch keine unterbrechungsfreie Erreichbarkeit garantieren.',
      'BeeQu behält sich vor, Funktionen weiterzuentwickeln, anzupassen oder einzustellen, sofern berechtigte Interessen und die Zumutbarkeit für Nutzer gewahrt bleiben.',
    ],
  },
  {
    title: '6. Preise und Zahlung',
    text: [
      'Kostenpflichtige Tarife werden vor Vertragsschluss klar ausgewiesen.',
      'Abrechnungszeitraum, Zahlungsart, Laufzeit und Kündigungsfristen ergeben sich aus dem jeweils gebuchten Plan.',
    ],
  },
  {
    title: '7. Inhalte und Rechte',
    text: [
      'Nutzer bleiben Inhaber der von ihnen eingestellten Inhalte.',
      'Soweit für die Vertragserfüllung erforderlich, räumen Nutzer BeeQu ein einfaches, nicht ausschließliches Nutzungsrecht zur Speicherung, Verarbeitung und Anzeige der Inhalte ein.',
    ],
  },
  {
    title: '8. Haftung',
    text: [
      'BeeQu haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit sowie bei Verletzung von Leben, Körper und Gesundheit.',
      'Bei leicht fahrlässiger Verletzung wesentlicher Vertragspflichten ist die Haftung auf den vertragstypisch vorhersehbaren Schaden begrenzt.',
      'Im Uebrigen ist die Haftung ausgeschlossen, soweit gesetzlich zulässig.',
    ],
  },
  {
    title: '9. Laufzeit und Kündigung',
    text: [
      'Nutzer können ihr Konto jederzeit kündigen, sofern keine abweichenden Fristen bei kostenpflichtigen Tarifen gelten.',
      'BeeQu kann Konten aus wichtigem Grund sperren oder kündigen, insbesondere bei schwerwiegenden Verstößen gegen diese AGB.',
    ],
  },
  {
    title: '10. Schlussbestimmungen',
    text: [
      'Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts, soweit keine zwingenden Verbraucherschutzvorschriften entgegenstehen.',
      'Sollten einzelne Bestimmungen dieser AGB unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.',
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
