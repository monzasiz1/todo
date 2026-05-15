import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { getStoredTheme, setTheme, subscribeTheme } from '../utils/theme';

const OPTIONS = [
  { value: 'light',  label: 'Hell',     icon: Sun },
  { value: 'dark',   label: 'Dunkel',   icon: Moon },
  { value: 'system', label: 'System',   icon: Monitor },
];

export default function ThemeToggle() {
  const [theme, setLocal] = useState(getStoredTheme);

  useEffect(() => subscribeTheme(setLocal), []);

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Erscheinungsbild">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`theme-toggle-btn${active ? ' active' : ''}`}
            onClick={() => setTheme(value)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
