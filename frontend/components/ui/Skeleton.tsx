export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function KPISkeleton() {
  return (
    <div className="bg-card-dark border border-card-border rounded-xl p-5 shadow-card-dark">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-10 w-10 rounded-xl" />
      </div>
      <Skeleton className="h-9 w-16 mt-1" />
      <Skeleton className="h-0.5 w-full mt-4" />
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-card-dark border border-card-border rounded-xl p-5 shadow-card-dark">
      <div className="flex items-start justify-between mb-3">
        <Skeleton className="h-6 w-24 rounded-md" />
        <Skeleton className="h-6 w-16 rounded-md" />
      </div>
      <Skeleton className="h-5 w-40 mt-3" />
      <Skeleton className="h-3 w-32 mt-2" />
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-card-border">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

export function TableRowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-card-border">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-6 w-20 rounded-full ml-auto" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div>
      <div className="mb-8">
        <Skeleton className="h-7 w-40 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[0,1,2,3].map(i => <KPISkeleton key={i} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card-dark border border-card-border rounded-xl p-6 shadow-card-dark">
          <Skeleton className="h-4 w-40 mb-6" />
          <div className="space-y-3">
            {[0,1,2].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        </div>
        <div className="bg-card-dark border border-card-border rounded-xl p-6 shadow-card-dark">
          <Skeleton className="h-4 w-40 mb-6" />
          <div className="space-y-3">
            {[0,1,2,3].map(i => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
          </div>
        </div>
      </div>
    </div>
  );
}
