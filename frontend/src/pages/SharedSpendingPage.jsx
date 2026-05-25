import { useEffect, useMemo, useState } from 'react';
import { useFriendsStore } from '../store/friendsStore';
import { Share2, Users, TrendingUp, Copy, CheckCircle2, Sparkles, Plus } from 'lucide-react';
import '../styles/shared-spending.css';

const CATEGORY_NODES = [
  { id: 'food', label: 'Essen & Trinken', color: '#60A5FA' },
  { id: 'home', label: 'Miete & Haushalt', color: '#32D583' },
  { id: 'travel', label: 'Reisen & Ausflüge', color: '#FF9F0A' },
  { id: 'free', label: 'Freizeit & Erlebnisse', color: '#D14BE2' },
];

const FALLBACK_FRIENDS = [
  { id: 'friend-0', label: 'Lena', color: '#5AC8FA' },
  { id: 'friend-1', label: 'Jonas', color: '#FF9F0A' },
  { id: 'friend-2', label: 'Mira', color: '#AF52DE' },
];

const FRIEND_FLOW_TEMPLATE = [
  { target: 'food', value: 24 },
  { target: 'travel', value: 18 },
  { target: 'free', value: 14 },
];

function compactName(name) {
  if (!name) return 'Freund';
  return name.split(' ').slice(0, 2).join(' ');
}

export default function SharedSpendingPage() {
  const { friends, pending, fetchFriends, loading } = useFriendsStore();
  const [shareState, setShareState] = useState('');

  useEffect(() => {
    fetchFriends();
  }, []);

  const displayFriends = useMemo(() => {
    if (friends && friends.length > 0) {
      return friends.slice(0, 3).map((friend, index) => ({
        id: `friend-${index}`,
        label: compactName(friend.name || friend.email || `Freund ${index + 1}`),
        color: ['#5AC8FA', '#FF9F0A', '#AF52DE'][index % 3],
      }));
    }
    return FALLBACK_FRIENDS;
  }, [friends]);

  const sankeyData = useMemo(() => {
    const nodes = [
      { id: 'me', label: 'Du', color: 'var(--primary)' },
      ...displayFriends,
    ];

    const friendFlows = displayFriends.map((friend, index) => ({
      source: friend.id,
      target: FRIEND_FLOW_TEMPLATE[index]?.target || 'food',
      value: FRIEND_FLOW_TEMPLATE[index]?.value || 16,
      color: friend.color,
    }));

    const flows = [
      { source: 'me', target: 'food', value: 46, color: '#60A5FA' },
      { source: 'me', target: 'home', value: 28, color: '#32D583' },
      { source: 'me', target: 'free', value: 18, color: '#FF9F0A' },
      ...friendFlows,
    ];

    const totals = {
      total: flows.reduce((sum, flow) => sum + flow.value, 0),
      categories: CATEGORY_NODES.reduce((acc, node) => ({ ...acc, [node.id]: 0 }), {}),
      friends: nodes.length,
    };
    flows.forEach((flow) => {
      totals.categories[flow.target] = (totals.categories[flow.target] || 0) + flow.value;
    });

    return { nodes, flows, totals };
  }, [displayFriends]);

  const maxCategory = useMemo(() => {
    const entries = Object.entries(sankeyData.totals.categories);
    return entries.reduce((best, current) => (current[1] > best[1] ? current : best), ['food', 0]);
  }, [sankeyData.totals.categories]);

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/app/shared-spending`;
    try {
      await navigator.clipboard.writeText(url);
      setShareState('Link kopiert!');
    } catch {
      setShareState('Link kopieren fehlgeschlagen.');
    }
    window.setTimeout(() => setShareState(''), 2800);
  };

  const sourcePositions = useMemo(() => {
    const nodeHeight = 64;
    const gap = 18;
    const positions = {};
    sankeyData.nodes.forEach((node, index) => {
      positions[node.id] = 24 + index * (nodeHeight + gap);
    });
    return positions;
  }, [sankeyData.nodes]);

  const targetPositions = useMemo(() => {
    const nodeHeight = 64;
    const gap = 18;
    const positions = {};
    CATEGORY_NODES.forEach((category, index) => {
      positions[category.id] = 22 + index * (nodeHeight + gap);
    });
    return positions;
  }, []);

  const chartPaths = useMemo(() => {
    const sourceX = 200;
    const targetX = 740;
    const curveOffset = 140;
    const maxWidth = Math.max(...sankeyData.flows.map((flow) => flow.value));

    return sankeyData.flows.map((flow, index) => {
      const sy = sourcePositions[flow.source] + 32;
      const ty = targetPositions[flow.target] + 32;
      const width = Math.max(8, (flow.value / maxWidth) * 26);
      const d = `M ${sourceX} ${sy} C ${sourceX + curveOffset} ${sy} ${targetX - curveOffset} ${ty} ${targetX} ${ty}`;
      return {
        id: `${flow.source}-${flow.target}-${index}`,
        d,
        width,
        color: flow.color,
      };
    });
  }, [sankeyData.flows, sourcePositions, targetPositions]);

  return (
    <div className="shared-spending-page">
      <section className="page-header shared-spending-header">
        <div>
          <span className="eyebrow">Neues Diagramm</span>
          <h2>Gemeinsam Ausgaben steuern</h2>
          <p>
            Erstelle ein interaktives Ausgaben-Dashboard für dich und deine Freunde. Teilt Kosten, behaltet Budgets im Blick und findet schnell, wer wie viel beiträgt.
          </p>
        </div>
        <div className="shared-spending-header-actions">
          <button type="button" className="sankey-btn sankey-btn-primary" onClick={handleCopyLink}>
            <Copy size={18} /> Link kopieren
          </button>
          <button type="button" className="sankey-btn sankey-btn-secondary" onClick={handleCopyLink}>
            <Share2 size={18} /> Teilen
          </button>
        </div>
      </section>

      <div className="sankey-summary-grid">
        <article className="sankey-summary-card">
          <div className="sankey-summary-icon">
            <Users size={20} />
          </div>
          <span className="sankey-summary-label">Teamgröße</span>
          <strong>{sankeyData.totals.friends} Personen</strong>
          <p>{friends.length > 0 ? 'Aktive Freunde und geteilte Ausgaben' : 'Nutze Vorschläge oder lade Freunde ein'}</p>
        </article>
        <article className="sankey-summary-card">
          <div className="sankey-summary-icon">
            <TrendingUp size={20} />
          </div>
          <span className="sankey-summary-label">Gemeinsame Ausgaben</span>
          <strong>{sankeyData.totals.total} €</strong>
          <p>Im Diagramm zeigt jede Verbindung ihren Anteil an den Gesamtkosten.</p>
        </article>
        <article className="sankey-summary-card">
          <div className="sankey-summary-icon">
            <Sparkles size={20} />
          </div>
          <span className="sankey-summary-label">Top Kategorie</span>
          <strong>{CATEGORY_NODES.find((node) => node.id === maxCategory[0])?.label}</strong>
          <p>{maxCategory[1]} € steuern den größten Fluss.</p>
        </article>
      </div>

      <section className="sankey-card">
        <div className="sankey-visual">
          <div className="sankey-column sankey-source-column">
            <div className="sankey-column-title">Freunde</div>
            {sankeyData.nodes.map((node) => (
              <div key={node.id} className="sankey-node-card" style={{ top: sourcePositions[node.id], borderColor: node.color }}>
                <div className="sankey-node-meta">
                  <span className="sankey-node-badge" style={{ background: node.color }} />
                  <strong>{node.label}</strong>
                </div>
                <span className="sankey-node-sub">{node.id === 'me' ? 'Eigenanteil' : 'Beitrag'}</span>
              </div>
            ))}
          </div>

          <div className="sankey-chart-wrapper">
            <svg className="sankey-chart" viewBox="0 0 960 360" preserveAspectRatio="xMidYMid meet">
              {chartPaths.map((path) => (
                <path
                  key={path.id}
                  d={path.d}
                  stroke={path.color}
                  strokeWidth={path.width}
                  fill="none"
                  strokeLinecap="round"
                />
              ))}
            </svg>
          </div>

          <div className="sankey-column sankey-target-column">
            <div className="sankey-column-title">Kostenpunkte</div>
            {CATEGORY_NODES.map((node) => (
              <div key={node.id} className="sankey-node-card" style={{ top: targetPositions[node.id], borderColor: node.color }}>
                <div className="sankey-node-meta">
                  <span className="sankey-node-badge" style={{ background: node.color }} />
                  <strong>{node.label}</strong>
                </div>
                <span className="sankey-node-sub">{sankeyData.totals.categories[node.id]} €</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sankey-footer">
          <div className="sankey-legend">
            {CATEGORY_NODES.map((category) => (
              <div key={category.id} className="sankey-legend-item">
                <span className="sankey-legend-dot" style={{ background: category.color }} />
                <span>{category.label}</span>
              </div>
            ))}
          </div>
          <div className="sankey-hint">
            {friends.length > 0 ? (
              <span>Zeige allen Teammitgliedern den aktuellen Status, dann bleibt der Überblick klar.</span>
            ) : (
              <span>Freunde fehlen? Öffne die Freundesliste, um sie hinzuzufügen und gemeinsam auszugeben.</span>
            )}
          </div>
        </div>
      </section>

      <div className="shared-spending-actions">
        <button type="button" className="sankey-btn sankey-btn-primary" onClick={handleCopyLink}>
          <Copy size={18} /> Freigabe-Link kopieren
        </button>
        <button type="button" className="sankey-btn sankey-btn-secondary" onClick={() => window.location.assign('/app/groups')}>
          <Plus size={18} /> Freund einladen
        </button>
      </div>

      {shareState && (
        <div className="shared-spending-toast">
          <CheckCircle2 size={16} /> {shareState}
        </div>
      )}
    </div>
  );
}
