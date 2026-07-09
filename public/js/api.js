'use strict';

import { setActiveView } from './race-view.js';

// ── API helpers ───────────────────────────────────────────────────────────────
export async function apiPost(path, body) {
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  } catch (e) {
    console.error('API error', path, e);
  }
}

export async function navigate(appState) {
  await apiPost('/api/navigate', { state: appState });
  // Optimistic — server will confirm via WS app_state message
  setActiveView(appState);
}
