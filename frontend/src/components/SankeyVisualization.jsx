import { useMemo, useRef, useEffect, useState } from 'react';
import '../styles/sankey-premium.css';

/**
 * Premium Sankey Visualization - Stripe/Apple/Linear Level Design
 * Income/Members → Budget → Categories → Transactions → Remaining
 */
export default function SankeyVisualization({ data }) {
  const svgRef = useRef(null);
  const [hoverNode, setHoverNode] = useState(null);
  const [hoverFlow, setHoverFlow] = useState(null);

  // Layout berechnung
  const layout = useMemo(() => {
    if (!data || !data.members?.length) {
      return { nodes: [], flows: [], empty: true };
    }

    const WIDTH = 1400;
    const HEIGHT = 680;
    const MARGIN = { top: 80, right: 120, bottom: 80, left: 120 };
    const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
    const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

    // Level 1: Income Sources
    const memberIncomeTotals = {};
    (data.incomes || []).forEach((e) => {
      memberIncomeTotals[e.user_id] = (memberIncomeTotals[e.user_id] || 0) + e.amount;
    });

    const level1Nodes = data.members
      .map((m) => ({
        id: `level1-${m.id}`,
        memberId: m.id,
        level: 1,
        label: m.name,
        value: memberIncomeTotals[m.id] || 0,
        color: m.color || '#5AC8FA',
      }))
      .filter((n) => n.value > 0);

    if (level1Nodes.length === 0) {
      return { nodes: [], flows: [], empty: true };
    }

    const totalIncome = level1Nodes.reduce((s, n) => s + n.value, 0);
    const totalExpense = (data.expenses || []).reduce((s, e) => s + e.amount, 0);

    // Level 2: Central Budget Hub
    const level2Node = {
      id: 'level2-budget',
      level: 2,
      label: 'Budget',
      value: totalIncome,
      color: '#06B6D4', // Cyan
      isHub: true,
    };

    // Level 3: Categories
    const catExpenseTotals = {};
    (data.expenses || []).forEach((e) => {
      catExpenseTotals[e.category] = (catExpenseTotals[e.category] || 0) + e.amount;
    });

    const categoryColors = {
      food: '#F59E0B',    // Amber
      home: '#10B981',    // Emerald
      travel: '#3B82F6',  // Blue
      free: '#A855F7',    // Purple
      salary: '#34D399',  // Teal
      gift: '#EC4899',    // Pink
      side: '#8B5CF6',    // Violet
      other: '#6B7280',   // Gray
    };

    const level3Nodes = (data.expenseCategories || [])
      .map((c) => ({
        id: `level3-${c.id}`,
        catId: c.id,
        level: 3,
        label: c.label,
        value: catExpenseTotals[c.id] || 0,
        color: categoryColors[c.id] || c.color || '#8B5CF6',
      }))
      .filter((n) => n.value > 0);

    const remaining = Math.max(0, totalIncome - totalExpense);
    if (remaining > 0.01) {
      level3Nodes.push({
        id: 'level3-remaining',
        level: 3,
        label: 'Verbleibend',
        value: remaining,
        color: '#10B981',
        isRemaining: true,
      });
    }

    // Level 4: Top Transactions
    const topExpenses = [...(data.expenses || [])]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 14);

    const txByCat = {};
    topExpenses.forEach((e) => {
      if (!txByCat[e.category]) txByCat[e.category] = [];
      txByCat[e.category].push(e);
    });

    const level4Nodes = [];
    level3Nodes.forEach((cat) => {
      if (cat.isRemaining) return;
      const txs = (txByCat[cat.catId] || []).slice(0, 4);
      txs.forEach((tx) => {
        level4Nodes.push({
          id: `level4-${tx.id}`,
          txId: tx.id,
          catId: cat.catId,
          level: 4,
          label: tx.description || cat.label,
          value: tx.amount,
          color: cat.color,
          parentCatId: cat.id,
        });
      });
    });

    // Level 5: Remaining
    const level5Node = remaining > 0.01 ? {
      id: 'level5-remaining',
      level: 5,
      label: 'Gespart',
      value: remaining,
      color: '#10B981',
    } : null;

    // Position nodes auf Y-Achse (vertikal zentiert per Level)
    const positionNodes = (nodes) => {
      if (nodes.length === 0) return nodes;
      const totalHeight = nodes.reduce((s, n) => s + n.value, 0);
      const maxHeight = Math.max(60, (innerHeight * totalHeight) / (totalIncome + 1));
      const scale = maxHeight / totalHeight;

      let y = MARGIN.top + (innerHeight - maxHeight) / 2;
      return nodes.map((n) => {
        const h = Math.max(8, n.value * scale);
        const node = { ...n, y, height: h };
        y += h + 4;
        return node;
      });
    };

    const positioned1 = positionNodes(level1Nodes);
    const pos2 = {
      ...level2Node,
      y: MARGIN.top + (innerHeight - 50) / 2,
      height: 50,
    };
    const positioned3 = positionNodes(level3Nodes);
    const positioned4 = positionNodes(level4Nodes);
    const pos5 = level5Node ? {
      ...level5Node,
      y: MARGIN.top + (innerHeight - 60) / 2,
      height: 60,
    } : null;

    // X-Positionen
    const xPositions = {
      1: MARGIN.left + 60,
      2: MARGIN.left + innerWidth * 0.25,
      3: MARGIN.left + innerWidth * 0.50,
      4: MARGIN.left + innerWidth * 0.75,
      5: MARGIN.left + innerWidth + 20,
    };

    // Alle Nodes
    const allNodes = [
      ...positioned1,
      pos2,
      ...positioned3,
      ...positioned4,
      ...(pos5 ? [pos5] : []),
    ].map((n) => ({
      ...n,
      x: xPositions[n.level] || MARGIN.left + 60,
    }));

    // Flows (Bänder)
    const flows = [];

    // L1 → L2
    let cursorL2 = pos2.y;
    positioned1.forEach((n1) => {
      const flow = {
        id: `flow-${n1.id}-${pos2.id}`,
        source: n1,
        target: pos2,
        value: n1.value,
        type: 'income',
      };
      flows.push(flow);
      cursorL2 += n1.height + 2;
    });

    // L2 → L3
    let cursorL3 = positioned3[0]?.y || MARGIN.top + (innerHeight / 2);
    positioned3.forEach((n3) => {
      flows.push({
        id: `flow-${pos2.id}-${n3.id}`,
        source: pos2,
        target: n3,
        value: n3.value,
        type: 'expense',
      });
    });

    // L3 → L4
    positioned4.forEach((n4) => {
      const parent = positioned3.find((c) => c.id === n4.parentCatId);
      if (parent) {
        flows.push({
          id: `flow-${parent.id}-${n4.id}`,
          source: parent,
          target: n4,
          value: n4.value,
          type: 'transaction',
        });
      }
    });

    // L3 (Remaining) → L5 (Remaining)
    const remainingCat = positioned3.find((c) => c.isRemaining);
    if (remainingCat && pos5) {
      flows.push({
        id: `flow-${remainingCat.id}-${pos5.id}`,
        source: remainingCat,
        target: pos5,
        value: remainingCat.value,
        type: 'savings',
      });
    }

    return {
      nodes: allNodes,
      flows,
      empty: false,
      width: WIDTH,
      height: HEIGHT,
      margin: MARGIN,
    };
  }, [data]);

  if (layout.empty) {
    return (
      <div className="sankey-empty">
        <p>Keine Daten verfügbar</p>
      </div>
    );
  }

  const generatePath = (source, target) => {
    const x0 = source.x + 24;
    const x1 = target.x;
    const y0 = source.y + source.height / 2;
    const y1 = target.y + target.height / 2;
    const xi = (x0 + x1) / 2;

    return `M${x0},${y0}C${xi},${y0} ${xi},${y1} ${x1},${y1}`;
  };

  const getFlowColor = (flow) => {
    const sourceOpacity = hoverFlow === flow.id ? 1 : 0.6;
    if (flow.type === 'income') return `rgba(6, 182, 212, ${sourceOpacity})`;
    if (flow.type === 'savings') return `rgba(16, 185, 129, ${sourceOpacity})`;
    return `rgba(${parseInt(flow.source.color.slice(1, 3), 16)}, ${parseInt(flow.source.color.slice(3, 5), 16)}, ${parseInt(flow.source.color.slice(5, 7), 16)}, ${sourceOpacity})`;
  };

  const flowCount = layout.flows.length;
  const nodeCount = layout.nodes.length;

  return (
    <div className="sankey-container">
      {/* Background */}
      <div className="sankey-bg">
        <div className="sankey-gradient-bg" />
        <div className="sankey-grid-overlay" />
        <div className="sankey-orb sankey-orb-1" />
        <div className="sankey-orb sankey-orb-2" />
      </div>

      {/* SVG Visualization */}
      <svg
        ref={svgRef}
        width={layout.width}
        height={layout.height}
        className="sankey-svg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        <defs>
          {/* Gradients für Flows */}
          {layout.flows.map((flow, i) => (
            <linearGradient
              key={`grad-${flow.id}`}
              id={`flow-gradient-${flow.id}`}
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor={flow.source.color} stopOpacity={0.7} />
              <stop offset="100%" stopColor={flow.target.color} stopOpacity={0.5} />
            </linearGradient>
          ))}

          {/* Glow Filter */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Node Glow */}
          <filter id="node-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Flows (Bänder) */}
        {layout.flows.map((flow) => (
          <g key={`flow-group-${flow.id}`}>
            {/* Glow Background */}
            <path
              d={generatePath(flow.source, flow.target)}
              stroke={flow.source.color}
              strokeWidth={Math.max(2, flow.target.height * 1.2)}
              fill="none"
              opacity={hoverFlow === flow.id ? 0.3 : 0.1}
              className="sankey-flow-glow"
            />

            {/* Main Flow */}
            <path
              d={generatePath(flow.source, flow.target)}
              stroke={`url(#flow-gradient-${flow.id})`}
              strokeWidth={Math.max(1, flow.target.height)}
              fill="none"
              className={`sankey-flow ${hoverFlow === flow.id ? 'active' : ''}`}
              onMouseEnter={() => setHoverFlow(flow.id)}
              onMouseLeave={() => setHoverFlow(null)}
              style={{
                filter: hoverFlow === flow.id ? 'drop-shadow(0 0 8px currentColor)' : 'none',
                cursor: 'pointer',
              }}
            />
          </g>
        ))}

        {/* Nodes */}
        {layout.nodes.map((node) => (
          <g
            key={`node-${node.id}`}
            onMouseEnter={() => setHoverNode(node.id)}
            onMouseLeave={() => setHoverNode(null)}
            className={`sankey-node ${hoverNode === node.id ? 'hover' : ''}`}
            style={{ cursor: 'pointer' }}
          >
            {/* Node Background */}
            <rect
              x={node.x - 12}
              y={node.y}
              width={24}
              height={node.height}
              rx={4}
              fill={node.color}
              opacity={0.15}
              className="node-bg"
            />

            {/* Node Main */}
            <rect
              x={node.x - 12}
              y={node.y}
              width={24}
              height={node.height}
              rx={4}
              fill={node.color}
              opacity={hoverNode === node.id ? 0.95 : 0.7}
              className="node-main"
              filter="url(#node-glow)"
            />

            {/* Node Border */}
            <rect
              x={node.x - 12}
              y={node.y}
              width={24}
              height={node.height}
              rx={4}
              fill="none"
              stroke={node.color}
              strokeWidth="1"
              opacity={0.4}
              className="node-border"
            />
          </g>
        ))}

        {/* Node Labels */}
        {layout.nodes.map((node) => {
          const isLeftSide = node.level <= 2;
          const x = isLeftSide ? node.x - 40 : node.x + 40;
          const textAnchor = isLeftSide ? 'end' : 'start';
          const value = (node.value || 0).toLocaleString('de-DE', { maximumFractionDigits: 0 });

          return (
            <g key={`label-${node.id}`}>
              {/* Label Background */}
              <rect
                x={isLeftSide ? x - 130 : x}
                y={node.y + node.height / 2 - 24}
                width={130}
                height={48}
                rx={8}
                fill="rgba(15, 23, 42, 0.8)"
                opacity={hoverNode === node.id ? 1 : 0.5}
                className="label-bg"
                backdropFilter="blur(8px)"
              />

              {/* Label Text */}
              <text
                x={x}
                y={node.y + node.height / 2 - 4}
                textAnchor={textAnchor}
                className="node-label"
                opacity={hoverNode === node.id ? 1 : 0.7}
              >
                {node.label}
              </text>

              {/* Value */}
              <text
                x={x}
                y={node.y + node.height / 2 + 14}
                textAnchor={textAnchor}
                className="node-value"
                opacity={hoverNode === node.id ? 1 : 0.6}
              >
                €{value}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="sankey-legend">
        <div className="legend-item">
          <div className="legend-dot" style={{ backgroundColor: '#06B6D4' }} />
          <span>Einnahmen</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ backgroundColor: '#F59E0B' }} />
          <span>Kategorien</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ backgroundColor: '#10B981' }} />
          <span>Ersparnisse</span>
        </div>
      </div>
    </div>
  );
}
