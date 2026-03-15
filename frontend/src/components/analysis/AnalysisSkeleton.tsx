/**
 * Skeleton loading state for the Analysis page.
 */

function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded-xl ${className}`} />
}

export default function AnalysisSkeleton() {
  return (
    <div className="space-y-5">
      {/* Hero skeleton */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <Pulse className="h-7 w-24 mb-2" />
        <Pulse className="h-10 w-40 mb-3" />
        <div className="flex gap-2">
          <Pulse className="h-8 w-32" />
          <Pulse className="h-8 w-36" />
        </div>
      </div>

      {/* Cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <Pulse className="h-4 w-24 mb-4" />
            <Pulse className="h-8 w-full mb-3" />
            <Pulse className="h-6 w-3/4 mb-2" />
            <Pulse className="h-6 w-1/2" />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <Pulse className="h-4 w-20 mb-3" />
        <Pulse className="h-[360px] w-full" />
      </div>

      {/* Narrative skeleton */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <Pulse className="h-4 w-28 mb-4" />
        <div className="space-y-3">
          <Pulse className="h-4 w-full" />
          <Pulse className="h-4 w-5/6" />
          <Pulse className="h-4 w-4/5" />
          <Pulse className="h-4 w-full" />
          <Pulse className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  )
}
