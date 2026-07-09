'use strict';

import { state, PLAYER_COLORS } from './state.js';
import { apiPost } from './api.js';

export function refreshRosterView() {
  for (let i = 0; i < 4; i++) {
    const input  = document.getElementById(`r-name-${i}`);
    const circle = document.getElementById(`r-circle-${i}`);
    if (!input) continue;

    const show = i < state.numRacers;
    input.style.display  = show ? '' : 'none';
    circle.style.display = show ? '' : 'none';

    // Only overwrite the name if the field isn't currently being edited
    if (document.activeElement !== input) {
      input.value = state.players[i].name || '';
    }

    // Inactive style: solid circle in player colour, dark number
    input.style.background  = PLAYER_COLORS[i];
    circle.style.background = PLAYER_COLORS[i];
    circle.style.color      = '#16151b';
    circle.style.border     = 'none';
  }
}

// Called when a roster input gains focus (mirrors CiTextField becoming active)
function rosterFocus(i) {
  const circle = document.getElementById(`r-circle-${i}`);
  circle.style.background = 'transparent';
  circle.style.border     = `4px solid ${PLAYER_COLORS[i]}`;
  circle.style.color      = PLAYER_COLORS[i];
}

// Called when a roster input loses focus — save all names
function rosterBlur(i) {
  const circle = document.getElementById(`r-circle-${i}`);
  circle.style.background = PLAYER_COLORS[i];
  circle.style.border     = 'none';
  circle.style.color      = '#16151b';
  // Save all names at once (mirrors animateOut saving all fields)
  const players = Array.from({ length: 4 }, (_, j) => ({
    name: (document.getElementById(`r-name-${j}`)?.value || '').trim(),
  }));
  apiPost('/api/roster', { players });
}

// Tab key cycles through visible roster inputs (mirrors KeyEvent::KEY_TAB handler)
function rosterTab(event, i) {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  const next = (i + 1) % state.numRacers;
  document.getElementById(`r-name-${next}`)?.focus();
}

// Wire the four roster inputs (were inline handlers in the monolith).
export function initRosterView() {
  for (let i = 0; i < 4; i++) {
    const input = document.getElementById(`r-name-${i}`);
    if (!input) continue;
    input.addEventListener('focus',   () => rosterFocus(i));
    input.addEventListener('blur',    () => rosterBlur(i));
    input.addEventListener('keydown', e  => rosterTab(e, i));
  }
}
