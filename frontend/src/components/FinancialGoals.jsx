import { useEffect, useState } from 'react';
import { useGoalsStore } from '../store/advancedFinance';
import { Plus, Target, TrendingUp } from 'lucide-react';
import '../styles/advanced-finance.css';

export default function FinancialGoals() {
  const { goals, summary, loading, fetchGoals, createGoal, updateGoal, contributeToGoal, deleteGoal } = useGoalsStore();
  const [showNewGoal, setShowNewGoal] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    target_amount: 0,
    category: 'other',
    emoji: '🎯',
    target_date: '',
    auto_save_monthly: 0,
  });

  useEffect(() => {
    fetchGoals();
  }, []);

  const handleAddGoal = async (e) => {
    e.preventDefault();
    try {
      await createGoal(formData);
      setFormData({
        title: '',
        target_amount: 0,
        category: 'other',
        emoji: '🎯',
        target_date: '',
        auto_save_monthly: 0,
      });
      setShowNewGoal(false);
      await fetchGoals();
    } catch (err) {
      alert('Fehler beim Erstellen des Ziels');
    }
  };

  const handleContribute = async (goalId, amount) => {
    try {
      await contributeToGoal(goalId, amount);
      await fetchGoals();
    } catch (err) {
      alert('Fehler bei Beitrag');
    }
  };

  return (
    <div className="goals-container">
      <div className="goals-header">
        <div>
          <h2>Finanzielle Ziele</h2>
          <p className="goals-subtitle">Träume mit Zielen verwirklichen</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNewGoal(true)}>
          <Plus size={16} /> Neues Ziel
        </button>
      </div>

      {/* Goals Summary */}
      {summary && (
        <div className="goals-summary">
          <div className="summary-card">
            <p className="summary-label">Aktive Ziele</p>
            <p className="summary-value">{summary.activeGoals}</p>
          </div>
          <div className="summary-card">
            <p className="summary-label">Gesamt Sparziel</p>
            <p className="summary-value">
              €{summary.totalTargetAmount.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="summary-card">
            <p className="summary-label">Gesamt Gespart</p>
            <p className="summary-value">
              €{summary.totalSavedAmount.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>
      )}

      {/* New Goal Form */}
      {showNewGoal && (
        <form className="goals-form" onSubmit={handleAddGoal}>
          <div className="form-group">
            <label>Ziel-Titel</label>
            <input
              type="text"
              placeholder="z.B. Urlaub, Auto, Notgroschen"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
            />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label>Zielbetrag (€)</label>
              <input
                type="number"
                value={formData.target_amount}
                onChange={(e) => setFormData({ ...formData, target_amount: parseFloat(e.target.value) })}
                required
              />
            </div>
            <div className="form-group">
              <label>Zieldatum</label>
              <input
                type="date"
                value={formData.target_date}
                onChange={(e) => setFormData({ ...formData, target_date: e.target.value })}
              />
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label>Auto-Sparrate (€/Monat)</label>
              <input
                type="number"
                value={formData.auto_save_monthly}
                onChange={(e) => setFormData({ ...formData, auto_save_monthly: parseFloat(e.target.value) })}
              />
            </div>
            <div className="form-group">
              <label>Emoji</label>
              <input
                type="text"
                maxLength="2"
                value={formData.emoji}
                onChange={(e) => setFormData({ ...formData, emoji: e.target.value })}
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowNewGoal(false)}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn-primary">
              Speichern
            </button>
          </div>
        </form>
      )}

      {/* Goals List */}
      <div className="goals-list">
        {loading ? (
          <p>Lädt...</p>
        ) : goals.length === 0 ? (
          <p className="empty-state">Keine Ziele hinzugefügt</p>
        ) : (
          goals
            .filter((g) => g.status === 'active')
            .map((goal) => {
              const prog = goal.progress || {};
              return (
                <div key={goal.id} className="goal-card">
                  <div className="goal-header">
                    <div>
                      <span className="goal-emoji">{goal.emoji || '🎯'}</span>
                      <h3 className="goal-title">{goal.title}</h3>
                    </div>
                    <div className="goal-priority" data-priority={goal.priority}>
                      {goal.priority}
                    </div>
                  </div>

                  <div className="goal-progress">
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${prog.percentComplete || 0}%` }}
                      />
                    </div>
                    <p className="progress-text">
                      €{(prog.progressAmount || 0).toLocaleString('de-DE', { maximumFractionDigits: 0 })} / €
                      {(goal.target_amount).toLocaleString('de-DE', { maximumFractionDigits: 0 })}
                    </p>
                  </div>

                  <div className="goal-details">
                    {prog.monthsRemaining && (
                      <div className="detail-item">
                        <span className="detail-label">Noch {prog.monthsRemaining} Monate</span>
                        <span className="detail-value">
                          €{prog.monthlyNeeded.toLocaleString('de-DE', { maximumFractionDigits: 0 })}/Monat nötig
                        </span>
                      </div>
                    )}
                    {goal.auto_save_monthly && (
                      <div className="detail-item">
                        <span className="detail-label">Auto-Sparrate</span>
                        <span
                          className={`detail-value ${prog.isOnTrack ? 'on-track' : 'warning'}`}
                        >
                          €{Number(goal.auto_save_monthly).toLocaleString('de-DE', { maximumFractionDigits: 0 })}/Monat
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="goal-actions">
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => handleContribute(goal.id, 100)}
                    >
                      +€100 Hinzufügen
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => deleteGoal(goal.id)}>
                      Löschen
                    </button>
                  </div>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}
