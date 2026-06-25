import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../lib/api';
import { useAuthStore } from '../store';

type Step = 'credentials' | 'mfa';

export default function Login() {
  const navigate  = useNavigate();
  const { setAuth } = useAuthStore();

  const [step, setStep]             = useState<Step>('credentials');
  const [mfaSession, setMfaSession] = useState('');
  const [username, setUsername]     = useState('');
  const [password, setPassword]     = useState('');
  const [otp, setOtp]               = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const otpRef = useRef<HTMLInputElement>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await authApi.login(username, password);
      const data = res.data;
      if (data.mfa_required) {
        setMfaSession(data.mfa_session);
        setStep('mfa');
        setTimeout(() => otpRef.current?.focus(), 100);
      } else {
        setAuth(data.token, data.user);
        navigate('/dashboard', { replace: true });
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Identifiants invalides. Veuillez réessayer.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfa(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.verifyMfa(mfaSession, otp);
      setAuth(res.data.token, res.data.user);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Code OTP invalide ou session expirée.');
      setOtp('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-mine-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-mine-accent rounded-2xl text-3xl mb-4 shadow-lg">
            ⛏
          </div>
          <h1 className="text-2xl font-bold text-white">FMS Mining</h1>
          <p className="text-mine-muted text-sm mt-1">Fleet Management System</p>
        </div>

        <div className="card p-8 shadow-2xl">

          {/* Step bar */}
          <div className="flex gap-2 mb-6">
            <div className="flex-1 h-1 rounded-full bg-mine-accent" />
            <div className={`flex-1 h-1 rounded-full transition-colors duration-300 ${step === 'mfa' ? 'bg-mine-accent' : 'bg-mine-border'}`} />
          </div>

          {/* ── STEP 1: credentials ─── */}
          {step === 'credentials' && (
            <>
              <h2 className="text-lg font-semibold mb-1">Connexion</h2>
              <p className="text-mine-muted text-sm mb-6">Entrez vos identifiants pour accéder au système.</p>
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-mine-muted mb-1.5 uppercase tracking-wider">Nom d'utilisateur</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="admin" autoComplete="username" autoFocus required className="input w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-mine-muted mb-1.5 uppercase tracking-wider">Mot de passe</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••" autoComplete="current-password" required className="input w-full" />
                </div>
                {error && (
                  <div className="flex gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2.5">
                    <span>⚠</span><span>{error}</span>
                  </div>
                )}
                <button type="submit" disabled={loading || !username || !password}
                  className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading
                    ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />Vérification…</span>
                    : 'Se connecter →'}
                </button>
              </form>
            </>
          )}

          {/* ── STEP 2: MFA OTP ─── */}
          {step === 'mfa' && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">🔐</span>
                <h2 className="text-lg font-semibold">Authentification à deux facteurs</h2>
              </div>
              <p className="text-mine-muted text-sm mb-6">
                Ouvrez votre application d'authentification (Google Authenticator, Authy…) et entrez le code à 6 chiffres affiché pour <span className="text-white font-mono">{username}</span>.
              </p>
              <form onSubmit={handleMfa} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-mine-muted mb-1.5 uppercase tracking-wider">Code OTP</label>
                  <input ref={otpRef} type="text" inputMode="numeric" pattern="\d{6}" maxLength={6}
                    value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000 000" autoComplete="one-time-code"
                    className="input w-full text-center text-2xl font-mono tracking-[0.5em] py-3" />
                  <p className="text-xs text-mine-muted mt-1.5">Le code change toutes les 30 secondes.</p>
                </div>
                {error && (
                  <div className="flex gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2.5">
                    <span>⚠</span><span>{error}</span>
                  </div>
                )}
                <button type="submit" disabled={loading || otp.length !== 6}
                  className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading
                    ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />Vérification…</span>
                    : 'Valider le code →'}
                </button>
                <button type="button" onClick={() => { setStep('credentials'); setOtp(''); setError(''); }}
                  className="w-full text-sm text-mine-muted hover:text-white transition-colors text-center py-1">
                  ← Retour à la connexion
                </button>
              </form>
            </>
          )}
        </div>

        {/* Demo accounts hint */}
        <div className="mt-5 p-4 bg-mine-panel/50 rounded-xl border border-mine-border text-xs text-mine-muted">
          <div className="font-semibold text-mine-accent mb-2">Comptes de démonstration</div>
          <div className="space-y-1">
            <div><span className="text-white font-mono">admin</span> / <span className="font-mono">Admin@Mine2024</span> — Accès complet (CRUD)</div>
            <div><span className="text-white font-mono">dispatcher</span> / <span className="font-mono">Dispatch@2024</span> — Dispatch + lecture</div>
          </div>
        </div>
      </div>
    </div>
  );
}
