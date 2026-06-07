import { Link } from 'react-router-dom';

const sections = [
  {
    title: '1. Verantwortlicher',
    text: [
      'Verantwortlich für die Datenverarbeitung im Sinne der DSGVO ist BeeQu.',
      'Bitte ergänze für den Live-Betrieb die vollständigen Anbieterangaben (Firma, Anschrift, E-Mail, ggf. Datenschutzbeauftragter).',
    ],
  },
  {
    title: '2. Verarbeitete Daten',
    text: [
      'Bei der Nutzung von BeeQu können insbesondere folgende Daten verarbeitet werden: Kontaktdaten (z. B. E-Mail-Adresse), Profildaten, Aufgaben- und Kalenderinhalte, Gruppen- und Chatdaten sowie technische Nutzungsdaten.',
      'Bei Uploads können zudem Dateimetadaten verarbeitet werden, soweit dies für die Bereitstellung der Funktion erforderlich ist.',
    ],
  },
  {
    title: '3. Zwecke und Rechtsgrundlagen',
    text: [
      'Die Verarbeitung erfolgt zur Bereitstellung und Sicherheit der Plattform, zur Vertragsdurchführung, zur Kommunikation mit Nutzern sowie zur Fehleranalyse und Weiterentwicklung.',
      'Rechtsgrundlagen sind insbesondere Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung), lit. c (rechtliche Verpflichtung), lit. f (berechtigtes Interesse) und, soweit erforderlich, lit. a DSGVO (Einwilligung).',
    ],
  },
  {
    title: '4. Speicherung und Löschung',
    text: [
      'Personenbezogene Daten werden nur so lange gespeichert, wie es für die jeweiligen Zwecke erforderlich ist oder gesetzliche Aufbewahrungspflichten bestehen.',
      'Nach Wegfall der Zwecke oder nach Ablauf gesetzlicher Fristen werden Daten gelöscht oder anonymisiert.',
    ],
  },
  {
    title: '5. Empfänger und Auftragsverarbeitung',
    text: [
      'Zur technischen Bereitstellung können externe Dienstleister als Auftragsverarbeiter eingesetzt werden (z. B. Hosting, Datenbank, E-Mail-Versand).',
      'Mit solchen Dienstleistern werden, soweit erforderlich, Verträge zur Auftragsverarbeitung geschlossen.',
    ],
  },
  {
    title: '6. Internationale Datenübermittlungen',
    text: [
      'Sofern Daten in Länder ausserhalb der EU/des EWR übermittelt werden, erfolgt dies nur bei Vorliegen geeigneter Garantien nach Art. 44 ff. DSGVO (z. B. EU-Standardvertragsklauseln).',
    ],
  },
  {
    title: '7. Sicherheit',
    text: [
      'BeeQu trifft angemessene technische und organisatorische Massnahmen zum Schutz personenbezogener Daten vor Verlust, Manipulation und unbefugtem Zugriff.',
    ],
  },
  {
    title: '8. Betroffenenrechte',
    text: [
      'Nutzer haben nach DSGVO insbesondere das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit sowie Widerspruch.',
      'Erteilte Einwilligungen können jederzeit mit Wirkung für die Zukunft widerrufen werden.',
      'Zudem besteht ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde.',
    ],
  },
  {
    title: '9. Cookies und vergleichbare Technologien',
    text: [
      'BeeQu kann technisch notwendige Speicher- und Identifikationsmechanismen verwenden, um Login, Sicherheit und Kernfunktionen bereitzustellen.',
      'Soweit optionale Technologien eingesetzt werden, erfolgt dies nur nach den jeweils geltenden gesetzlichen Vorgaben.',
    ],
  },
  {
    title: '10. Aktualisierung dieser Erklärung',
    text: [
      'Diese Datenschutzerklärung kann angepasst werden, wenn sich rechtliche oder technische Rahmenbedingungen ändern.',
      'Die jeweils aktuelle Version ist auf dieser Seite abrufbar.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <div className="legal-top-nav">
          <Link to="/" className="legal-back-link">Zur Landing</Link>
        </div>

        <header className="legal-header">
          <h1>Datenschutzerklaerung</h1>
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
