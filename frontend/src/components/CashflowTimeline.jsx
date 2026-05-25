import { useEffect, useState } from 'react';
import { useCashflowStore } from '../store/advancedFinance';
import { Calendar, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import '../styles/advanced-finance.css';

export default function CashflowTimeline() {
  const { timeline, projections, timelineLoading, projectionsLoading, fetchTimeline, fetchProjections } = useCashflowStore();
  const [view, setView] = useState('timeline'); // 'timeline' oder 'projections'
  const [monthsAhead, setMonthsAhead] = useState(3);

  useEffect(() => {
    if (view === 'timeline') {
      fetchTimeline(monthsAhead);
    } else {
      fetchProjections(monthsAhead);
    }
  }, [view, monthsAhead, fetchTimeline, fetchProjections]);

  const formatAmount = (amount) => {
    return (amount || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="cashflow-container">
      <div className="cashflow-header">
        <h2>Cashflow-Timeline</h2>
        <p className="cashflow-subtitle">Wann wird Geld kritisch? Szenarien visualisieren</p>
      </div>

      {/* View Selector */}
      <div className="cashflow-tabs">
        <button
          className={`tab ${view === 'timeline' ? 'active' : ''}`}
          onClick={() => setView('timeline')}
        >
          <Calendar size={16} /> Nächste 3 Monate
        </button>
        <button
          className={`tab ${view === 'projections' ? 'active' : ''}`}
          onClick={() => setView('projections')}
        >
          <TrendingUp size={16} /> Vorhersage
        </button>
      </div>

      {/* Timeline View */}
      {view === 'timeline' && (
        <div className="timeline-section">
          <div className="timeline-info">
            <p>Alle Einnahmen, Ausgaben und wichtigen Ereignisse der nächsten Monate</p>
          </div>

          {timelineLoading ? (
            <p>Lädt...</p>
          ) : timeline.length === 0 ? (
            <p className="empty-state">Keine Ereignisse vorhanden</p>
          ) : (
            <div className="timeline-view">
              {timeline.map((event, idx) => (
                <div
                  key={event.id || idx}
                  className={`timeline-event ${event.type} ${event.isCritical ? 'critical' : ''}`}
                >
                  <div className="event-marker" />

                  <div className="event-content">
                    <div className="event-header">
                      <span className="event-date">{formatDate(event.date)}</span>
                      <span className={`event-type-badge type-${event.type}`}>
                        {event.type === 'income' && <TrendingDown size={14} />}
                        {event.type === 'expense' && <TrendingUp size={14} />}
                        {event.type.toUpperCase()}
                      </span>
                    </div>

                    <p className="event-title">{event.title}</p>

                    <div className="event-footer">
                      <span className={`event-amount ${event.type === 'income' ? 'income' : 'expense'}`}>
                        {event.type === 'income' ? '+' : '-'}
                        {formatAmount(Math.abs(event.amount))}
                      </span>
                      <span className="running-balance">
                        Balance: {formatAmount(event.runningBalance)}
                      </span>
                    </div>

                    {event.isCritical && (
                      <div className="event-warning">
                        <AlertTriangle size={14} />
                        Niedriger Kontostand
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Projections View */}
      {view === 'projections' && (
        <div className="projections-section">
          <div className="projections-controls">
            <label>
              Monate im Voraus:
              <select value={monthsAhead} onChange={(e) => setMonthsAhead(Number(e.target.value))}>
                <option value={1}>1 Monat</option>
                <option value={3}>3 Monate</option>
                <option value={6}>6 Monate</option>
                <option value={12}>12 Monate</option>
              </select>
            </label>
          </div>

          {projectionsLoading ? (
            <p>Lädt Vorhersage...</p>
          ) : projections.length === 0 ? (
            <p className="empty-state">Keine Daten für Vorhersage verfügbar</p>
          ) : (
            <div className="projections-grid">
              {projections.map((proj, idx) => {
                const balance = proj.projectedBalance;
                const isPositive = balance >= 0;

                return (
                  <div key={idx} className={`projection-card ${isPositive ? 'positive' : 'negative'}`}>
                    <p className="proj-month">{new Date(`${proj.month}-01`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</p>

                    <div className="proj-row">
                      <span className="proj-label">Einnahmen</span>
                      <span className="proj-value income">+{formatAmount(proj.projectedIncome)}</span>
                    </div>

                    <div className="proj-row">
                      <span className="proj-label">Ausgaben</span>
                      <span className="proj-value expense">-{formatAmount(proj.projectedExpenses)}</span>
                    </div>

                    <div className="proj-separator" />

                    <div className="proj-balance">
                      <span className="proj-label">Bilanz</span>
                      <span className={`proj-value balance ${isPositive ? 'income' : 'expense'}`}>
                        {isPositive ? '+' : ''}{formatAmount(balance)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="projections-info">
            <p>
              💡 <strong>Tipp:</strong> Diese Vorhersagen basieren auf durchschnittlichen historischen Daten. Aktualisieren Sie regelmäßig, um Genauigkeit zu verbessern.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
