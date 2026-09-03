// Resolves `meteor/check` for both/easySchemaConfig.ts, which builds a named
// `Match.Where` matcher for null (jam:easy-schema 1.7.1 crashes on a bare `null` inside
// `AnyOf`, and the crash is swallowed — the collection silently loses its DB validator).
//
// Real `Match.Where(fn)` returns a `Where` instance carrying the predicate as
// `.condition`; the shape matters here because the config module then assigns `.name` on
// what it gets back. A plain function would swallow that assignment silently.
export const Match = {
  Where: (condition) => ({ condition }),
};
