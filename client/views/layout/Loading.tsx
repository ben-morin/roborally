// What a page shows while the subscription it waits on is in flight. Replaces the
// `loading` template.
export function Loading() {
  return (
    <div className="text-center" style={{ padding: 50 }}>
      <p>Loading...</p>
    </div>
  );
}
