'use client';
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, organizationsApi } from '@/lib/api';
import type { OrgUser, UserRole } from '@/types';
import { useRefreshUser } from '@/app/providers';
import { useToast } from '@/components/ui/Toast';
import { User, Building2, CheckCircle2, AlertCircle, Users, KeyRound, UserPlus } from 'lucide-react';

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
        {user?.role === 'viewer' ? (
          <p className="text-sm text-slate-500">Your role is read only. Ask your organisation admin to change your name.</p>
        ) : (
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
        )}
      </form>

      <PasswordCard />
      {user?.role === 'admin' && <OrganisationUsersCard myId={user.id} />}
    </div>
  );
}

const inputCls = "w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 focus:bg-white";
const labelCls = "block text-sm font-semibold text-slate-600 uppercase tracking-wider mb-1.5";
const ROLE_LABELS: Record<UserRole, string> = { admin: 'Admin', engineer: 'Engineer', analyst: 'Analyst', viewer: 'Viewer (read only)' };

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const m = useMutation({
    mutationFn: () => authApi.changePassword(current, next),
    onSuccess: () => { toast.success('Password changed'); setCurrent(''); setNext(''); setAgain(''); },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Could not change the password'),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) { toast.error('New password must be at least 8 characters'); return; }
    if (next !== again) { toast.error('The two new passwords do not match'); return; }
    m.mutate();
  };
  return (
    <form onSubmit={submit} className="mt-6 space-y-4 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: '#082E29' }}><KeyRound size={18} /> Change password</h2>
      <div><label className={labelCls}>Current password</label><input type="password" value={current} onChange={e => setCurrent(e.target.value)} className={inputCls} required /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>New password</label><input type="password" value={next} onChange={e => setNext(e.target.value)} className={inputCls} required minLength={8} /></div>
        <div><label className={labelCls}>New password again</label><input type="password" value={again} onChange={e => setAgain(e.target.value)} className={inputCls} required minLength={8} /></div>
      </div>
      <button type="submit" disabled={m.isPending} className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold py-2 px-4 rounded-lg">
        {m.isPending ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}

function OrganisationUsersCard({ myId }: { myId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const usersQ = useQuery<OrgUser[]>({ queryKey: ['org-users'], queryFn: organizationsApi.listUsers });
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('engineer');
  const [password, setPassword] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['org-users'] });
  const createM = useMutation({
    mutationFn: () => organizationsApi.createUser({ email, full_name: fullName || undefined, role, password }),
    onSuccess: (u) => { toast.success(`Added ${u.email} as ${ROLE_LABELS[u.role] ?? u.role}`); setEmail(''); setFullName(''); setPassword(''); refresh(); },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Could not add the user'),
  });
  const updateM = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { role?: UserRole; is_active?: boolean } }) => organizationsApi.updateUser(id, data),
    onSuccess: () => { toast.success('Updated'); refresh(); },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'Could not update the user'),
  });
  return (
    <div className="mt-6 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: '#082E29' }}><Users size={18} /> Organisation users</h2>
      <p className="text-[13px] text-slate-500 mt-1 mb-4">
        Admin runs the organisation. Engineer uploads, reviews and issues reports. Viewer sees dashboards, inspections and reports and cannot change anything. Hand the temporary password over directly; the person changes it on first login.
      </p>
      <table className="w-full text-sm mb-5">
        <thead><tr className="text-left text-[12px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
          <th className="py-2 pr-2">Email</th><th className="py-2 pr-2">Name</th><th className="py-2 pr-2">Role</th><th className="py-2 pr-2">Last login</th><th className="py-2"></th>
        </tr></thead>
        <tbody>
          {(usersQ.data ?? []).map(u => (
            <tr key={u.id} className={`border-b border-slate-100 ${u.is_active ? '' : 'opacity-50'}`}>
              <td className="py-2 pr-2">{u.email}{u.id === myId && <span className="ml-1 text-[11px] text-slate-400">(you)</span>}</td>
              <td className="py-2 pr-2">{u.full_name || ''}</td>
              <td className="py-2 pr-2">
                <select value={u.role} disabled={updateM.isPending} onChange={e => updateM.mutate({ id: u.id, data: { role: e.target.value as UserRole } })} className="bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-sm">
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </td>
              <td className="py-2 pr-2 text-slate-500">{u.last_login ? new Date(u.last_login).toLocaleDateString() : 'never'}</td>
              <td className="py-2 text-right">
                <button type="button" disabled={updateM.isPending || u.id === myId} onClick={() => updateM.mutate({ id: u.id, data: { is_active: !u.is_active } })}
                  className="text-[12px] font-semibold text-slate-500 hover:text-red-600 disabled:opacity-40">
                  {u.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
              </td>
            </tr>
          ))}
          {usersQ.data && usersQ.data.length === 0 && <tr><td colSpan={5} className="py-3 text-slate-400">No users yet.</td></tr>}
        </tbody>
      </table>
      <form onSubmit={e => { e.preventDefault(); createM.mutate(); }} className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} required /></div>
        <div><label className={labelCls}>Name</label><input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Role</label>
          <select value={role} onChange={e => setRole(e.target.value as UserRole)} className={inputCls}>
            {(Object.keys(ROLE_LABELS) as UserRole[]).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div><label className={labelCls}>Temporary password</label><input type="text" value={password} onChange={e => setPassword(e.target.value)} className={inputCls} required minLength={8} placeholder="at least 8 characters" /></div>
        <div className="col-span-2">
          <button type="submit" disabled={createM.isPending} className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold py-2 px-4 rounded-lg">
            <UserPlus size={16} /> {createM.isPending ? 'Adding…' : 'Add user'}
          </button>
        </div>
      </form>
    </div>
  );
}
