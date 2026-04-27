import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Key, Mail } from 'lucide-react';

const ease = [0.25, 0.46, 0.45, 0.94];

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    const success = await login(email, password);
    if (success) navigate('/app');
  };

  return (
    <div className="bq-auth-page">

      <Link to="/landing" className="bq-auth-back">
        ← Zurück zur Startseite
      </Link>

      <div className="bq-auth-form-panel">
        <motion.div
          className="bq-auth-form-inner"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease }}
        >
          {/* Logo */}
          <div className="bq-auth-card-logo">
            <img src="/icons/icon.svg" alt="BeeQu" />
            <span>BeeQu</span>
          </div>

          <div className="bq-auth-form-head">
            <h1>Willkommen zurück</h1>
            <p>Bei deinem BeeQu-Konto anmelden</p>
          </div>

          {error && (
            <motion.div
              className="bq-auth-error"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <AlertCircle size={15} />
              <span>{error}</span>
            </motion.div>
          )}

          <form className="bq-auth-form" onSubmit={handleSubmit}>
            <div className="bq-field">
              <label htmlFor="email">E-Mail-Adresse</label>
              <div className="bq-input-wrap">
                <Mail size={16} className="bq-input-icon" />
                <input
                  id="email"
                  type="email"
                  placeholder="du@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="bq-field">
              <label htmlFor="password">Passwort</label>
              <div className="bq-input-wrap">
                <Key size={16} className="bq-input-icon" />
                <input
                  id="password"
                  type="password"
                  placeholder="Dein Passwort"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>

            <button type="submit" className="bq-auth-submit" disabled={loading}>
              {loading
                ? <span className="bq-auth-spinner" />
                : <>Anmelden <ArrowRight size={16} /></>
              }
            </button>
          </form>

          <div className="bq-auth-switch">
            <span>Noch kein Konto?</span>
            <Link to="/register">Kostenlos registrieren</Link>
          </div>
        </motion.div>
      </div>

    </div>
  );
}
