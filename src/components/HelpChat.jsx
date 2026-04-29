import { useState, useRef, useEffect } from 'react';
import { MessageCircleQuestion, X, Send, Loader2 } from 'lucide-react';
import { api } from '../utils/api';

export default function HelpChat({ hideFab = false }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hallo! 👋 Ich bin der BeeQu-Hilfe-Assistent. Frag mich alles zur App-Nutzung!' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Listen for open event from profile page (mobile)
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener('open-help-chat', handleOpen);
    return () => window.removeEventListener('open-help-chat', handleOpen);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Send history (without the greeting) for context
      const history = messages.filter((_, i) => i > 0);
      const data = await api.helpChat(text, history);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Entschuldigung, ich bin gerade nicht erreichbar. Versuch es gleich nochmal! 🙏' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const quickQuestions = [
    'Wie erstelle ich eine Aufgabe?',
    'Wie funktionieren Erinnerungen?',
    'Wie teile ich Aufgaben?',
    'Wie erstelle ich Kategorien?',
  ];

  return (
    <>
      {/* Floating Button */}
      {!open && !hideFab && (
        <button className="help-fab" onClick={() => setOpen(true)} title="Hilfe">
          <MessageCircleQuestion size={24} />
        </button>
      )}

      {/* Chat Window */}
      {open && (
        <div className="help-chat">
          <div className="help-chat-header">
            <div className="help-chat-header-info">
              <div className="help-chat-avatar">
                <MessageCircleQuestion size={18} />
              </div>
              <div>
                <div className="help-chat-title">BeeQu Hilfe</div>
                <div className="help-chat-subtitle">KI-Assistent</div>
              </div>
            </div>
            <button className="help-chat-close" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="help-chat-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`help-msg ${msg.role}`}>
                <div className="help-msg-bubble">{msg.content}</div>
              </div>
            ))}

            {loading && (
              <div className="help-msg assistant">
                <div className="help-msg-bubble help-msg-typing">
                  <Loader2 size={16} className="help-spinner" />
                  Schreibt...
                </div>
              </div>
            )}

            {/* Quick Questions (only when just the greeting) */}
            {messages.length === 1 && !loading && (
              <div className="help-quick-questions">
                {quickQuestions.map((q, i) => (
                  <button
                    key={i}
                    className="help-quick-btn"
                    onClick={() => {
                      setInput(q);
                      setTimeout(() => {
                        setInput(q);
                        const fakeMsg = { role: 'user', content: q };
                        setMessages((prev) => [...prev, fakeMsg]);
                        setInput('');
                        setLoading(true);
                        api.helpChat(q, [])
                          .then((data) => setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]))
                          .catch(() => setMessages((prev) => [...prev, { role: 'assistant', content: 'Entschuldigung, Fehler aufgetreten.' }]))
                          .finally(() => setLoading(false));
                      }, 0);
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="help-chat-input">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Frage stellen..."
              disabled={loading}
              maxLength={500}
            />
            <button
              className="help-send-btn"
              onClick={sendMessage}
              disabled={!input.trim() || loading}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

