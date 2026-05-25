import { useEffect, useState } from 'react';
import { useNetWorthStore } from '../store/advancedFinance';
import { Plus, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import '../styles/advanced-finance.css';

export default function NetWorthDashboard() {
  const { accounts, liabilities, summary, loading, fetchNetWorth, createAccount, createLiability } = useNetWorthStore();
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [showNewLiability, setShowNewLiability] = useState(false);
  const [formData, setFormData] = useState({ name: '', type: 'checking', balance: 0 });

  useEffect(() => {
    fetchNetWorth();
  }, [fetchNetWorth]);

  const handleAddAccount = async (e) => {
    e.preventDefault();
    try {
      await createAccount(formData);
      setFormData({ name: '', type: 'checking', balance: 0 });
      setShowNewAccount(false);
      await fetchNetWorth();
    } catch (err) {
      alert('Fehler beim Erstellen des Kontos');
    }
  };

  const netWorth = summary?.netWorth || 0;
  const isPositive = netWorth >= 0;

  return (
    <div className="net-worth-container">
      <div className="net-worth-header">
        <h2>Mein Vermögen</h2>
        <p className="net-worth-subtitle">Umfassende Vermögensübersicht</p>
      </div>

      {/* Netto-Vermögen Karte */}
      <div className={`net-worth-card ${isPositive ? 'positive' : 'negative'}`}>
        <div className="card-header">
          <span className="card-label">Netto-Vermögen</span>
          {isPositive ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
        </div>
        <div className="card-value">
          €{netWorth.toLocaleString('de-DE', { maximumFractionDigits: 2 })}
        </div>
        <div className="card-breakdown">
          <div className="breakdown-item">
            <span>Vermögenswerke</span>
            <strong>€{(summary?.totalAssets || 0).toLocaleString('de-DE', { maximumFractionDigits: 0 })}</strong>
          </div>
          <div className="breakdown-item">
            <span>Schulden</span>
            <strong>€{(summary?.totalLiabilities || 0).toLocaleString('de-DE', { maximumFractionDigits: 0 })}</strong>
          </div>
        </div>
      </div>

      {/* Konten Sektion */}
      <div className="net-worth-section">
        <div className="section-header">
          <h3>Konten & Vermögenswerke</h3>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNewAccount(true)}>
            <Plus size={16} /> Konto hinzufügen
          </button>
        </div>

        {showNewAccount && (
          <form className="net-worth-form" onSubmit={handleAddAccount}>
            <input
              type="text"
              placeholder="Kontoname"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })}>
              <option value="checking">Girokonto</option>
              <option value="savings">Sparkonto</option>
              <option value="investment">Investment</option>
              <option value="crypto">Crypto</option>
              <option value="cash">Bargeld</option>
            </select>
            <input
              type="number"
              placeholder="Saldo"
              value={formData.balance}
              onChange={(e) => setFormData({ ...formData, balance: parseFloat(e.target.value) })}
            />
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowNewAccount(false)}>
                Abbrechen
              </button>
              <button type="submit" className="btn btn-primary">
                Speichern
              </button>
            </div>
          </form>
        )}

        <div className="accounts-grid">
          {loading ? (
            <p>Lädt...</p>
          ) : accounts.length === 0 ? (
            <p className="empty-state">Keine Konten hinzugefügt</p>
          ) : (
            accounts.map((account) => (
              <div key={account.id} className="account-card">
                <div className="account-header">
                  <Wallet size={18} />
                  <span className="account-type">{account.type}</span>
                </div>
                <p className="account-name">{account.name}</p>
                <p className="account-balance">
                  €{Number(account.balance).toLocaleString('de-DE', { maximumFractionDigits: 2 })}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Schulden Sektion */}
      <div className="net-worth-section">
        <div className="section-header">
          <h3>Schulden & Verbindlichkeiten</h3>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNewLiability(true)}>
            <Plus size={16} /> Schuld hinzufügen
          </button>
        </div>

        {liabilities.length > 0 && (
          <div className="liabilities-list">
            {liabilities.map((liability) => (
              <div key={liability.id} className="liability-item">
                <div>
                  <p className="liability-name">{liability.name}</p>
                  <p className="liability-type">{liability.type}</p>
                </div>
                <div className="liability-amount">
                  €{Number(liability.amount_owed).toLocaleString('de-DE', { maximumFractionDigits: 2 })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
