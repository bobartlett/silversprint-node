'use strict';

// Converts milliseconds to "MM:SS.cc" timestamp string.
// Mirrors sb::utils::millisToTimestamp() referenced in GFXMain::onRaceFinished().
function millisToTimestamp(ms) {
  const totalMs = Math.max(0, Math.round(ms));
  const mins    = Math.floor(totalMs / 60000);
  const secs    = Math.floor((totalMs % 60000) / 1000);
  const centis  = Math.floor((totalMs % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

module.exports = { millisToTimestamp };
