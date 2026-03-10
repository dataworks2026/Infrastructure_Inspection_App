'use client';
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/lib/api';
import { useRefreshUser } from '@/app/providers';
import { useToast } from '@/components/ui/Toast';
import { User, Building2, CheckCircle2, AlertCircle } from 'lucide-react';

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
      <div className="max-w-xl mx-auto py-10 px-4">
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
    <div className="max-w-xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Profile Settings</h1>
      <p className="text-sm text-slate-500 mb-8">Update your name, username, and organization details.</p>

      <form onSubmit={handleSubmit} className="space-y-6 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">

        {/* Full Name */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
            Full Name
          </label>
          <div className="relative">
            <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Your full name"
              className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 focus:bg-white"
            />
          </div>
        </div>

        {/* Username */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
            Username
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">@</span>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="your_username"
              className="w-full pl-7 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 focus:bg-white"
            />
          </div>
        </div>

        {/* Organization Name */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
            Organization Name
          </label>
          <div className="relative">
            <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              placeholder="Your organization"
              className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400 focus:bg-white"
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">
            Updates the name in both your profile and the organization record.
          </p>
        </div>

        {/* Email (read-only) */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
            Email <span className="text-slate-400 font-normal normal-case">(cannot be changed)</span>
          </label>
          <input
            type="email"
            value={user?.email ?? ''}
            disabled
            className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-400 cursor-not-allowed"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition-colors"
        >
          {mutation.isPending ? (
            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : mutation.isSuccess ? (
            <CheckCircle2 size={16} />
          ) : mutation.isError ? (
            <AlertCircle size={16} />
          ) : null}
          {mutation.isPending ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
