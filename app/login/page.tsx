'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Inloggen mislukt.');
        setLoading(false);
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Er ging iets mis. Probeer het opnieuw.');
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 min-h-screen flex items-center justify-center bg-[#0f1023] px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center text-sm font-bold text-white">
            S
          </div>
          <div>
            <div className="text-lg font-bold text-white leading-none">Sentinel</div>
            <div className="text-[9px] text-gray-500 tracking-widest mt-0.5">DASHBOARD</div>
          </div>
        </div>

        <div className="bg-[#15162e] border border-[#26284a] rounded-2xl p-7">
          <h1 className="text-lg font-semibold text-white">Inloggen</h1>
          <p className="text-xs text-gray-400 mt-1">
            Log in om je dashboard te bekijken.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">
                E-mailadres
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                className="w-full rounded-lg bg-[#0f1023] border border-[#2c2e52] px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                placeholder="naam@bedrijf.nl"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">
                Wachtwoord
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full rounded-lg bg-[#0f1023] border border-[#2c2e52] px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 transition-colors disabled:opacity-50"
            >
              {loading ? 'Bezig met inloggen…' : 'Inloggen'}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-gray-600 mt-6">
          TLE Business B.V. · Sentinel Dashboard
        </p>
      </div>
    </div>
  );
}
