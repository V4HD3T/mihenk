/**
 * routeTable.js
 *
 * Every route the Express app actually serves, as `METHOD /path` strings.
 *
 * This exists so the OpenAPI document can be checked against the running app
 * rather than trusted. A hand-written specification is worth having only for as
 * long as it is true, and the usual way it stops being true is that someone
 * adds an endpoint and forgets the document - which no amount of care prevents
 * and one test does.
 */

/**
 * Reconstructs the mount path of a sub-router from the regexp Express builds
 * for it. There is no public API for this, so the shape of that regexp is
 * pinned by the route-table test: if a future Express changes it, that test
 * fails rather than the document silently describing nothing.
 */
function mountPath(layer) {
  if (layer.path) return layer.path;
  const source = layer.regexp?.source;
  if (!source) return '';
  return source
    .replace('^\\/', '/')
    .replace('\\/?(?=\\/|$)', '')
    .replace(/\\\//g, '/')
    .replace(/\$$/, '')
    .replace(/\?\(\?=.*\)$/, '');
}

/**
 * A router mounted at /api/courses registers its index as '/', which joins up
 * to '/api/courses/'. Express serves both spellings and the document names one,
 * so the trailing slash is dropped here rather than being a difference the
 * comparison would report forever.
 */
function normalize(path) {
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

/** @returns {string[]} sorted `METHOD /path` entries, e.g. `GET /api/problems/:id` */
function routeTable(app) {
  const routes = [];

  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const path = normalize(prefix + layer.route.path) || '/';
        for (const method of Object.keys(layer.route.methods)) {
          routes.push(`${method.toUpperCase()} ${path}`);
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer));
      }
    }
  };

  walk(app._router.stack, '');
  return [...new Set(routes)].sort();
}

module.exports = { routeTable, mountPath, normalize };
