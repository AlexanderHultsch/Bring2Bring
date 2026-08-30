// Shared helpers for the route layer: the 404 builder, the numeric id
// parser, and the session-regeneration wrapper, each formerly duplicated
// across several router files.

// SPECIFICATION.md section 5.1: unauthorized access to a recipe answers
// 404, never 403 — existence of a recipe someone doesn't own is not
// information to leak.
export function notFoundError() {
  const error = new Error('Not found');
  error.status = 404;
  return error;
}

export function parseId(raw) {
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}
