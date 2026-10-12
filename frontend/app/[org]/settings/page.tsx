'use client';
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, recommendationsApi } from '@/lib/api';
import { useRefreshUser } from '@/app/providers';
import { useToast } from '@/components/ui/Toast';
import { User, Building2, CheckCircle2, AlertCircle, FileText, Upload } from 'lucide-react';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const refreshUser  = useRefreshUser();
  const toast        = useToast();

  // Always fetch fresh data from server when this page loads
  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn:  () => authApi.me(),
    staleTime: 0, // re-fetch every time the page is visited
  });

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [orgName,  setOrgName]  = useState('');

  // Pre-fill form whenever fresh user data arrives
  useEffect(() => {
    if (user) {
      setFullName(user.full_name        ?? '');
      setUsername(user.username         ?? '');
      setOrgName(user.organization_name ?? '');
    }
  }, [user]);

  const mutation = useMutation({
    mutationFn: () => authApi.updateMe({
      full_name:         fullName || undefined,
      username:          username || undefined,
      organization_name: orgName  || undefined,
    }),
    onSuccess: (updated) => {
      // Update React Query cache immediately — no re-fetch needed
      queryClient.setQueryData(['me'], updated);
      // Also sync global context + localStorage
      refreshUser(updated);
      toast.success('Profile updated successfully');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || 'Failed to update profile');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl">
        <div className="h-8 w-48 bg-slate-200 rounded animate-pulse mb-2" />
        <div className="h-4 w-72 bg-slate-100 rounded animate-pulse mb-8" />
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i}>
              <div className="h-3 w-24 bg-slate-200 rounded animate-pulse mb-2" />
              <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1" style={{ color: '#082E29' }}>Profile Settings</h1>
      <p className="text-base text-slate-500 mb-8">Update your name, username, and organization details.</p>

      <form onSubmit={handleSubmit} className="space-y-6 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">

        {/* Full Name */}
        <div>
          <label className="block text-sm font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
            Full Name
          </label>
          <div className="relative">
            <User size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Your full name"
              className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 focus:bg-white"
            />
          </div>
        </div>

        {/* Username */}
        <div>
          <label className="block text-sm font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
            Username
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base">@</span>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="your_username"
              className="w-full pl-7 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 focus:bg-white"
            />
          </div>
        </div>

        {/* Organization Name */}
        <div>
          <label className="block text-sm font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
            Organization Name
          </label>
          <div className="relative">
            <Building2 size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              placeholder="Your organization"
              className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 focus:bg-white"
            />
          </div>
          <p className="text-[12px] text-slate-400 mt-1.5">
            Updates the name in both your profile and the organization record.
          </p>
        </div>

        {/* Email (read-only) */}
        <div>
          <label className="block text-sm font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
            Email <span className="text-slate-400 font-normal normal-case">(cannot be changed)</span>
          </label>
          <input
            type="email"
            value={user?.email ?? ''}
            disabled
            className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-base text-slate-400 cursor-not-allowed"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-base font-semibold py-2.5 px-4 rounded-lg transition-colors"
        >
          {mutation.isPending ? (
            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : mutation.isSuccess ? (
            <CheckCircle2 size={18} />
          ) : mutation.isError ? (
            <AlertCircle size={18} />
          ) : null}
          {mutation.isPending ? 'Saving…' : 'Save Changes'}
        </button>
      </form>

      <LetterheadCard />
    </div>
  );
}


const LH_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'firm_name',   label: 'Firm name',    placeholder: 'The engineering firm issuing the report' },
  { key: 'address',     label: 'Address',      placeholder: 'City, State' },
  { key: 'phone',       label: 'Phone',        placeholder: '' },
  { key: 'email',       label: 'Email',        placeholder: 'reports@firm.com' },
  { key: 'website',     label: 'Website',      placeholder: 'firm.com' },
  { key: 'client_name', label: 'Client',       placeholder: 'Who the report is prepared for' },
  { key: 'prepared_by', label: 'Prepared by',  placeholder: 'Engineer of record' },
];

function LetterheadCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [logoBusy, setLogoBusy] = useState(false);
  const lhQ = useQuery({ queryKey: ['letterhead'], queryFn: () => recommendationsApi.letterhead() });

  useEffect(() => {
    if (lhQ.data) {
      const next: Record<string, string> = {};
      for (const f of LH_FIELDS) next[f.key] = lhQ.data[f.key] ?? '';
      setForm(next);
    }
  }, [lhQ.data]);

  const save = useMutation({
    mutationFn: () => recommendationsApi.saveLetterhead(form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['letterhead'] }); toast.success('Letterhead saved'); },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Could not save the letterhead'),
  });

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoBusy(true);
    try {
      await recommendationsApi.uploadLogo(file);
      queryClient.invalidateQueries({ queryKey: ['letterhead'] });
      toast.success('Logo updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Could not upload the logo');
    } finally {
      setLogoBusy(false);
      e.target.value = '';
    }
  }

  const logoUrl = lhQ.data?.logo_url as string | null | undefined;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
      className="mt-8 space-y-5 bg-white border border-slate-200 rounded-xl p-6 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <FileText size={18} style={{ color: '#0891B2' }} />
        <h2 className="text-lg font-bold" style={{ color: '#082E29' }}>Report letterhead</h2>
      </div>
      <p className="text-sm text-slate-500">
        Printed on every issued recommendations PDF: firm, contact line, logo, and who the report is prepared for.
      </p>

      <div className="flex items-center gap-4">
        <div className="w-28 h-14 border border-slate-200 rounded-lg bg-slate-50 flex items-center justify-center overflow-hidden">
          {logoUrl ? <img src={logoUrl} alt="logo" className="max-h-12 max-w-[100px] object-contain" /> : <span className="text-xs text-slate-400">no logo</span>}
        </div>
        <label className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50" style={{ color: '#082E29' }}>
          <Upload size={14} /> {logoBusy ? 'Uploading…' : 'Upload logo (PNG or JPEG)'}
          <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={onLogo} disabled={logoBusy} />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {LH_FIELDS.map(f => (
          <div key={f.key}>
            <label className="block text-sm font-semibold text-slate-600 uppercase tracking-wider mb-1.5">{f.label}</label>
            <input
              type="text"
              value={form[f.key] ?? ''}
              onChange={e => setForm({ ...form, [f.key]: e.target.value })}
              placeholder={f.placeholder}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 focus:bg-white"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={save.isPending} className="px-4 py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-60" style={{ background: '#082E29' }}>
          {save.isPending ? 'Saving…' : 'Save letterhead'}
        </button>
      </div>
    </form>
  );
}
