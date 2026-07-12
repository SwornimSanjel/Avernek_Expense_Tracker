export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div
        className="h-8 w-48 rounded-lg"
        style={{ background: "var(--surface-2)" }}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-28 rounded-2xl"
            style={{ background: "var(--surface)" }}
          />
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="h-72 rounded-2xl" style={{ background: "var(--surface)" }} />
        <div className="h-72 rounded-2xl" style={{ background: "var(--surface)" }} />
      </div>
    </div>
  );
}
