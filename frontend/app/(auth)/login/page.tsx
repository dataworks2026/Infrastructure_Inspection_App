'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';
import { saveAuth } from '@/lib/auth';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const token = mode === 'login'
        ? await authApi.login(email, password)
        : await authApi.register(email, password, fullName, organizationName);
      saveAuth(token);
      router.replace('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-sky-50 to-blue-50 p-5">
      <div className="w-full max-w-[420px]">
        {/* Brand header — logo left of title */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-white shadow-lg shadow-blue-500/20 flex items-center justify-center p-1.5">
            <img src="/logo.png" alt="Mira Intel" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">MIRA INTEL</h1>
            <p className="text-sm text-slate-500 mt-0.5">Infrastructure Inspection Platform</p>
          </div>
        </div>

        {/* Form card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-xl shadow-slate-200/50">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            {mode === 'login' ? 'Sign in to continue to your dashboard' : 'Get started with Mira Intel'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Full Name</label>
                  <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white"
                    placeholder="Your name" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Organization Name</label>
                  <input type="text" value={organizationName} onChange={e => setOrganizationName(e.target.value)} required
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white"
                    placeholder="e.g. Woodworks Engineering" />
                </div>
              </>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white"
                placeholder="you@company.com" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                  className="w-full px-3.5 py-2.5 pr-10 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white"
                  placeholder="Enter your password" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 font-medium">{error}</div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-sky-500 to-blue-600 text-white py-2.5 rounded-lg text-sm font-bold uppercase tracking-wider hover:from-sky-600 hover:to-blue-700 shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Please wait...
                </span>
              ) : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
              <div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-slate-400">or</span></div>
            </div>

            <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="w-full text-center text-sm text-mira-blue hover:text-sky-700 font-medium transition-colors py-1">
              {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Mira Intel v1.0 &middot; AI-Powered Infrastructure Analysis
        </p>
      </div>
    </div>
  );
}
