function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`bg-slate-700/50 animate-pulse rounded-xl ${className}`} />;
}

export function DashboardSkeleton() {
  return (
    <div className="p-8 space-y-8">
      <div className="space-y-2">
        <SkeletonBox className="h-9 w-64" />
        <SkeletonBox className="h-5 w-96" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-panel p-6 rounded-2xl space-y-4">
            <SkeletonBox className="h-10 w-10 rounded-xl" />
            <SkeletonBox className="h-4 w-24" />
            <SkeletonBox className="h-8 w-12" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-panel p-6 rounded-2xl space-y-4">
            <SkeletonBox className="h-6 w-36" />
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="flex justify-between items-center">
                  <SkeletonBox className="h-4 w-24" />
                  <SkeletonBox className="h-4 w-10" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrdersSkeleton() {
  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <SkeletonBox className="h-9 w-40" />
          <SkeletonBox className="h-5 w-64" />
        </div>
        <SkeletonBox className="h-10 w-32 rounded-xl" />
      </div>
      <div className="flex gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBox key={i} className="h-9 w-24 rounded-lg" />
        ))}
      </div>
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-700/50">
          <SkeletonBox className="h-9 w-full max-w-sm rounded-xl" />
        </div>
        <div className="divide-y divide-slate-700/30">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <SkeletonBox className="h-4 w-20" />
              <SkeletonBox className="h-4 w-32 flex-1" />
              <SkeletonBox className="h-6 w-20 rounded-full" />
              <SkeletonBox className="h-4 w-24" />
              <SkeletonBox className="h-4 w-20" />
              <SkeletonBox className="h-8 w-16 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PaymentsSkeleton() {
  return (
    <div className="p-8 space-y-6">
      <div className="space-y-2">
        <SkeletonBox className="h-9 w-40" />
        <SkeletonBox className="h-5 w-64" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-panel p-5 rounded-2xl space-y-3">
            <SkeletonBox className="h-4 w-28" />
            <SkeletonBox className="h-8 w-24" />
          </div>
        ))}
      </div>
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="divide-y divide-slate-700/30">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <SkeletonBox className="h-4 w-16" />
              <SkeletonBox className="h-4 w-32 flex-1" />
              <SkeletonBox className="h-6 w-20 rounded-full" />
              <SkeletonBox className="h-4 w-24" />
              <SkeletonBox className="h-8 w-20 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="p-8 space-y-6">
      <div className="space-y-2">
        <SkeletonBox className="h-9 w-40" />
        <SkeletonBox className="h-5 w-64" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-panel p-5 rounded-2xl space-y-3">
            <SkeletonBox className="h-4 w-24" />
            <SkeletonBox className="h-8 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-panel p-6 rounded-2xl space-y-4">
            <SkeletonBox className="h-6 w-36" />
            <SkeletonBox className="h-48 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TeamSkeleton() {
  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <SkeletonBox className="h-9 w-40" />
          <SkeletonBox className="h-5 w-56" />
        </div>
        <SkeletonBox className="h-10 w-32 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass-panel p-6 rounded-2xl space-y-4">
            <div className="flex items-center gap-4">
              <SkeletonBox className="h-12 w-12 rounded-full" />
              <div className="space-y-2 flex-1">
                <SkeletonBox className="h-5 w-32" />
                <SkeletonBox className="h-4 w-20" />
              </div>
              <SkeletonBox className="h-6 w-16 rounded-full" />
            </div>
            <div className="space-y-2">
              <SkeletonBox className="h-4 w-full" />
              <SkeletonBox className="h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
