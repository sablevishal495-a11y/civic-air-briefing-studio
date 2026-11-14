/**
 * Backend client.
 */

import { API_BASE } from './state.js';

/** Call a backend route by name. The name is sent in the path and as ?op= so any host routing can resolve it. */
export function api(route, body) {
  return fetch(`${API_BASE + route  }?op=${  route}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  }).then((res) => {
    return res.json().catch(() => { return {}; }).then((data) => {
      if (!res.ok) throw new Error(data.error || `The server returned an error (${  res.status  }).`);
      return data;
    });
  });
}
