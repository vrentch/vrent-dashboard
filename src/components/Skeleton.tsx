export function CardSkeleton() {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div className="relative overflow-hidden">
        <div className="space-y-3">
          <div className="h-3 w-24 rounded bg-black/5" />
          <div className="h-4 w-full rounded bg-black/10" />
          <div className="h-4 w-4/5 rounded bg-black/10" />
          <div className="h-3 w-full rounded bg-black/5" />
          <div className="h-3 w-2/3 rounded bg-black/5" />
        </div>
        <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent [animation:shimmer_1.4s_infinite]" />
      </div>
    </div>
  )
}
