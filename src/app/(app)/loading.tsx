export default function Loading() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="space-y-2 pb-2">
        <div className="h-3 w-28 rounded-full" style={{ background: "var(--surface-2)" }} />
        <div className="h-9 w-56 rounded-xl" style={{ background: "var(--surface-2)" }} />
        <div className="h-3 w-80 max-w-full rounded-full" style={{ background: "var(--surface-2)" }} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-32 rounded-[18px]"
            style={{ background: "var(--surface)" }}
          />
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="h-72 rounded-[18px]" style={{ background: "var(--surface)" }} />
        <div className="h-72 rounded-[18px]" style={{ background: "var(--surface)" }} />
      </div>
    </div>
  );
}
