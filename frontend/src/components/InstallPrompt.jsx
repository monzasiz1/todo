import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, Smartphone, Monitor, Share } from 'lucide-react';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      setIsInstalled(true);
      return;
    }

    // Check if dismissed recently (24h cooldown)
    const dismissed = localStorage.getItem('pwa-dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 86400000) return;

    // iOS detection
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(ios);

    if (ios) {
      // Show iOS guide after 3 seconds
      const timer = setTimeout(() => setShowBanner(true), 3000);
      return () => clearTimeout(timer);
    }

    // Android/Desktop: listen for beforeinstallprompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setTimeout(() => setShowBanner(true), 2000);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setShowBanner(false);
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (isIOS) {
      setShowIOSGuide(true);
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setShowIOSGuide(false);
    localStorage.setItem('pwa-dismissed', Date.now().toString());
  };

  if (isInstalled || !showBanner) return null;

  return (
    <AnimatePresence>
      {showIOSGuide ? (
        <motion.div
          className="install-banner"
          initial={{ opacity: 0, y: 80 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 80 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          <button className="install-banner-close" onClick={handleDismiss}>
            <X size={16} />
          </button>
          <div className="install-banner-icon ios-guide">
            <Share size={24} />
          </div>
          <div className="install-banner-text">
            <strong>So installierst du Taski</strong>
            <p>
              1. Tippe auf <Share size={14} style={{ verticalAlign: 'middle' }} /> (Teilen-Button)<br />
              2. Wähle <strong>„Zum Home-Bildschirm"</strong><br />
              3. Tippe auf <strong>„Hinzufügen"</strong>
            </p>
          </div>
        </motion.div>
      ) : (
        <motion.div
          className="install-banner"
          initial={{ opacity: 0, y: 80 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 80 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          <button className="install-banner-close" onClick={handleDismiss}>
            <X size={16} />
          </button>
          <div className="install-banner-icon">
            {isIOS ? <Smartphone size={24} /> : <Download size={24} />}
          </div>
          <div className="install-banner-text">
            <strong>Taski installieren</strong>
            <p>{isIOS
              ? 'Füge Taski zum Home-Bildschirm hinzu'
              : 'App installieren für schnellen Zugriff'
            }</p>
          </div>
          <button className="install-banner-btn" onClick={handleInstall}>
            {isIOS ? 'Anleitung' : 'Installieren'}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
