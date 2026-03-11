'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';
import { saveAuth } from '@/lib/auth';
import { Eye, EyeOff, Cpu, SearchCheck, BarChart3, FileText } from 'lucide-react';

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

  const features = [
    { icon: Cpu, title: 'YOLO Detection', desc: 'Computer vision on imagery' },
    { icon: SearchCheck, title: 'S0\u2013S3 Severity', desc: 'Auto severity classification' },
    { icon: BarChart3, title: 'Fleet Dashboard', desc: 'Live critical alert monitoring' },
    { icon: FileText, title: 'Compliance Reports', desc: 'One-click report export' },
  ];

  return (
    <div className="h-screen relative flex overflow-hidden">
      {/* Background image + overlay */}
      <div className="absolute inset-0 z-0">
        <img src="/hero-bg.jpg" alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-[#082E29]/80" />
      </div>

      {/* Left — branding */}
      <div className="relative z-10 w-1/2 h-full flex flex-col items-center justify-center px-16">
        {/* Logo + brand */}
        <div className="flex items-center gap-3 mb-6">
          <img src="/logo.png" alt="Mira Intel" className="w-12 h-12 object-contain"
            style={{ filter: 'drop-shadow(0 0 8px rgba(8,145,178,0.5)) drop-shadow(0 0 16px rgba(147,197,253,0.3))' }} />
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">MIRA INTEL</h1>
            <p className="text-xs text-white/60 uppercase tracking-[0.25em]">Infrastructure Intelligence</p>
          </div>
        </div>

        {/* Badge */}
        <div className="mb-6">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/20 bg-white/5 text-sm text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            AI-Powered Inspection Platform
          </span>
        </div>

        {/* Hero text */}
        <h2 className="text-4xl lg:text-5xl font-bold text-white leading-tight mb-6 text-center">
          Inspect every<br />asset with<br />
          <span className="text-cyan-400">precision.</span>
        </h2>

        <p className="text-white/60 text-sm leading-relaxed max-w-md mb-10 text-center">
          Turn drone footage into actionable structural intelligence &mdash; detect defects, monitor fleet health,
          and generate compliance reports automatically.
        </p>

        {/* Feature cards 2x2 */}
        <div className="grid grid-cols-2 gap-3 max-w-md">
          {features.map((f) => (
            <div key={f.title} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
              <f.icon size={18} className="text-white/50 flex-shrink-0" />
              <div>
                <p className="text-white text-sm font-semibold">{f.title}</p>
                <p className="text-white/40 text-xs">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right — login card */}
      <div className="relative z-10 w-1/2 h-full flex items-center justify-center px-8">
        <div className="w-full max-w-sm bg-white rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-slate-800 mb-1">
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            {mode === 'login' ? 'Sign in to your operations center' : 'Get started with Mira Intel'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Full Name</label>
                  <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-[#EDF6F0] border border-[#C8E6D4] rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    placeholder="Your name" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Organization Name</label>
                  <input type="text" value={organizationName} onChange={e => setOrganizationName(e.target.value)} required
                    className="w-full px-3.5 py-2.5 bg-[#EDF6F0] border border-[#C8E6D4] rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    placeholder="e.g. Woodworks Engineering" />
                </div>
              </>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full px-3.5 py-2.5 bg-[#EDF6F0] border border-[#C8E6D4] rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                placeholder="you@company.com" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required
                  className="w-full px-3.5 py-2.5 pr-10 bg-[#EDF6F0] border border-[#C8E6D4] rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
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
              className="w-full bg-[#082E29] text-white py-3 rounded-xl text-sm font-semibold hover:bg-[#0a3d35] shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Please wait...
                </span>
              ) : mode === 'login' ? (
                <span>Sign In &rarr;</span>
              ) : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-sm mt-5">
            <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="text-teal-600 hover:text-teal-700 font-medium transition-colors">
              {mode === 'login' ? 'New to Mira Intel? Create account' : 'Already have an account? Sign in'}
            </button>
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-4 right-6 z-10">
        <p className="text-xs text-white/30">Mira Intel v1.0 &middot; AI-Powered Infrastructure Inspection</p>
      </div>
    </div>
  );
}
