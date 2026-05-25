import { useState } from 'react';
import NetWorthDashboard from '../components/NetWorthDashboard';
import FinancialGoals from '../components/FinancialGoals';
import CashflowTimeline from '../components/CashflowTimeline';
import '../styles/advanced-finance.css';

export default function FinanceDashboardPage() {
  const [activeTab, setActiveTab] = useState('net-worth');

  return (
    <div className="finance-dashboard-page">
      <div className="dashboard-header">
        <h1>💰 Finanz-Dashboard</h1>
        <p>Vollständige Kontrolle über deine Finanzen: Nettovermögen, Ziele, Cashflow</p>
      </div>

      <div className="dashboard-tabs-container">
        <div className="tabs-wrapper">
          <div className="tabs-header">
            <button
              className={`tab-button ${activeTab === 'net-worth' ? 'active' : ''}`}
              onClick={() => setActiveTab('net-worth')}
            >
              💎 Nettovermögen
            </button>
            <button
              className={`tab-button ${activeTab === 'goals' ? 'active' : ''}`}
              onClick={() => setActiveTab('goals')}
            >
              🎯 Finanz-Ziele
            </button>
            <button
              className={`tab-button ${activeTab === 'cashflow' ? 'active' : ''}`}
              onClick={() => setActiveTab('cashflow')}
            >
              📊 Cashflow-Timeline
            </button>
          </div>

          <div className="tabs-content">
            {activeTab === 'net-worth' && (
              <div className="tab-pane active">
                <NetWorthDashboard />
              </div>
            )}

            {activeTab === 'goals' && (
              <div className="tab-pane active">
                <FinancialGoals />
              </div>
            )}

            {activeTab === 'cashflow' && (
              <div className="tab-pane active">
                <CashflowTimeline />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
