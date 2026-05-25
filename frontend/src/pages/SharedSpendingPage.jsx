import { useState, useEffect } from 'react';
import { useSharedSpendingStore } from '../store/sharedSpendingStore';
import NetWorthDashboard from '../components/NetWorthDashboard';
import FinancialGoals from '../components/FinancialGoals';
import CashflowTimeline from '../components/CashflowTimeline';
import { TrendingUp, Target, PiggyBank, Calendar } from 'lucide-react';
import '../styles/shared-spending.css';
import '../styles/advanced-finance.css';

export default function SharedSpendingPage() {
  const { groups, fetchGroups, loading } = useSharedSpendingStore();
  const [activeTab, setActiveTab] = useState('spending');

  useEffect(() => {
    fetchGroups();
  }, []);

  return (
    <div className="shared-spending-page">
      <div className="shared-spending-header">
        <div className="eyebrow">Finanz-Management</div>
        <h2>💰 Finanz-Zentrum</h2>
        <p>Ausgaben, Vermögen, Ziele und Cashflow - alles an einem Ort</p>
      </div>

      {/* Tab Navigation */}
      <div className="spending-tabs-wrapper">
        <div className="spending-tabs">
          <button
            className={`spending-tab ${activeTab === 'spending' ? 'active' : ''}`}
            onClick={() => setActiveTab('spending')}
          >
            <TrendingUp size={18} />
            <span>Ausgaben & Gruppen</span>
          </button>
          <button
            className={`spending-tab ${activeTab === 'net-worth' ? 'active' : ''}`}
            onClick={() => setActiveTab('net-worth')}
          >
            <PiggyBank size={18} />
            <span>Nettovermögen</span>
          </button>
          <button
            className={`spending-tab ${activeTab === 'goals' ? 'active' : ''}`}
            onClick={() => setActiveTab('goals')}
          >
            <Target size={18} />
            <span>Finanz-Ziele</span>
          </button>
          <button
            className={`spending-tab ${activeTab === 'cashflow' ? 'active' : ''}`}
            onClick={() => setActiveTab('cashflow')}
          >
            <Calendar size={18} />
            <span>Cashflow-Timeline</span>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="spending-tabs-content">
        {/* Ausgaben Tab */}
        {activeTab === 'spending' && (
          <div className="tab-content-pane active">
            <div className="spending-groups-section">
              <h3>Gemeinsame Ausgaben-Gruppen</h3>
              {loading ? (
                <p className="loading-state">Lädt...</p>
              ) : groups.length === 0 ? (
                <div className="empty-state">
                  <p>Keine Ausgaben-Gruppen vorhanden</p>
                  <p className="text-secondary">Erstelle eine neue Gruppe, um Ausgaben zu teilen</p>
                </div>
              ) : (
                <div className="groups-grid">
                  {groups.map((group) => (
                    <div key={group.id} className="group-card">
                      <div className="group-header">
                        <h4>{group.name}</h4>
                        <span className="member-count">{group.members?.length || 0} Mitglieder</span>
                      </div>
                      <p className="group-description">{group.description}</p>
                      {group.total_spending && (
                        <div className="group-spending">
                          <span>Gesamtausgaben:</span>
                          <strong>€{group.total_spending.toLocaleString('de-DE', { maximumFractionDigits: 2 })}</strong>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Net Worth Tab */}
        {activeTab === 'net-worth' && (
          <div className="tab-content-pane active">
            <NetWorthDashboard />
          </div>
        )}

        {/* Goals Tab */}
        {activeTab === 'goals' && (
          <div className="tab-content-pane active">
            <FinancialGoals />
          </div>
        )}

        {/* Cashflow Tab */}
        {activeTab === 'cashflow' && (
          <div className="tab-content-pane active">
            <CashflowTimeline />
          </div>
        )}
      </div>
    </div>
  );
}
