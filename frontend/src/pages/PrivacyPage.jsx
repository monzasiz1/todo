import { Link } from 'react-router-dom';

const sections = [
  {
    title: '1. Verantwortlicher',
    text: [
      'Verantwortlich fuer die Datenverarbeitung im Sinne der DSGVO ist BeeQu.',
      'Bitte ergaenze fuer den Live-Betrieb die vollstaendigen Anbieterangaben (Firma, Anschrift, E-Mail, ggf. Datenschutzbeauftragter).',
    ],
  },
  {
    title: '2. Verarbeitete Daten',
    text: [
      'Bei der Nutzung von BeeQu koennen insbesondere folgende Daten verarbeitet werden: Kontaktdaten (z. B. E-Mail-Adresse), Profildaten, Aufgaben- und Kalenderinhalte, Gruppen- und Chatdaten sowie technische Nutzungsdaten.',
      'Bei Uploads koennen zudem Dateimetadaten verarbeitet werden, soweit dies fuer die Bereitstellung der Funktion erforderlich ist.',
    ],
  },
  {
    title: '3. Zwecke und Rechtsgrundlagen',
    text: [
      'Die Verarbeitung erfolgt zur Bereitstellung und Sicherheit der Plattform, zur Vertragsdurchfuehrung, zur Kommunikation mit Nutzern sowie zur Fehleranalyse und Weiterentwicklung.',
      'Rechtsgrundlagen sind insbesondere Art. 6 Abs. 1 lit. b DSGVO (Vertragserfuellung), lit. c (rechtliche Verpflichtung), lit. f (berechtigtes Interesse) und, soweit erforderlich, lit. a DSGVO (Einwilligung).',
    ],
  },
  {
    title: '4. Speicherung und Loeschung',
    text: [
      'Personenbezogene Daten werden nur so lange gespeichert, wie es fuer die jeweiligen Zwecke erforderlich ist oder gesetzliche Aufbewahrungspflichten bestehen.',
      'Nach Wegfall der Zwecke oder nach Ablauf gesetzlicher Fristen werden Daten geloescht oder anonymisiert.',
    ],
  },
  {
    title: '5. Empfaenger und Auftragsverarbeitung',
    text: [
      'Zur technischen Bereitstellung koennen externe Dienstleister als Auftragsverarbeiter eingesetzt werden (z. B. Hosting, Datenbank, E-Mail-Versand).',
      'Mit solchen Dienstleistern werden, soweit erforderlich, Vertraege zur Auftragsverarbeitung geschlossen.',
    ],
  },
  {
    title: '6. Internationale Datenuebermittlungen',
    text: [
      'Sofern Daten in Laender ausserhalb der EU/des EWR uebermittelt werden, erfolgt dies nur bei Vorliegen geeigneter Garantien nach Art. 44 ff. DSGVO (z. B. EU-Standardvertragsklauseln).',
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
      'Nutzer haben nach DSGVO insbesondere das Recht auf Auskunft, Berichtigung, Loeschung, Einschraenkung der Verarbeitung, Datenuebertragbarkeit sowie Widerspruch.',
      'Erteilte Einwilligungen koennen jederzeit mit Wirkung fuer die Zukunft widerrufen werden.',
      'Zudem besteht ein Beschwerderecht bei einer Datenschutzaufsichtsbehoerde.',
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
    title: '10. Aktualisierung dieser Erklaerung',
    text: [
      'Diese Datenschutzerklaerung kann angepasst werden, wenn sich rechtliche oder technische Rahmenbedingungen aendern.',
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
