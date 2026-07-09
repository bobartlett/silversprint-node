'use strict';

import { state, PLAYER_COLORS } from './state.js';

// ── Progress ring renderer (Phase 4d) ─────────────────────────────────────────
//
// Mirrors RaceView.cpp + RaceProgress.frag:
//   innerRad=187, outerRad=388, 4 rings ordered outermost→innermost
//   Ring i (player i): outer = 187+(4-i)×50.25, inner = 187+(3-i)×50.25
//   Dial center (960,612). Canvas top-left (572,224) → canvas center (388,388).
//
//   Shader logic:
//     le  = fract(leadPct)                   leading-edge position [0,1)
//     te  = le - max(0.05, tailLen)           tail (trailing) edge
//     tailLen = clamp(mph/30 × 0.30, 0, 0.50)
//     alpha   = linear from 0 at te → 1 at le (smoothstep near leading edge)
//
//   Canvas approximation: draw 32 thin arc segments with linearly increasing alpha.

const _RC = document.getElementById('rings-canvas');
const _RX = _RC.getContext('2d');
const _CX = 388;          // canvas center X  (960 - 572)
const _CY = 388;          // canvas center Y  (612 - 224)
const _IR = 187;          // innermost radius
const _OR = 388;          // outermost radius
const _RS = (_OR - _IR) / 4;  // radial size per ring ≈ 50.25

function _ringRadii(playerIdx) {
  return {
    outer: _IR + _RS * (4 - playerIdx),
    inner: _IR + _RS * (3 - playerIdx),
  };
}

function _drawArcWithTail(ctx, cx, cy, innerR, outerR, leadPct, tailLen, color) {
  // fract() equivalent — always in [0,1)
  const le   = ((leadPct % 1) + 1) % 1;
  const tail = Math.max(0.05, tailLen);   // minimum 5% tail (matches max(0.05, uTailLen))
  const te   = le - tail;                 // trailing edge (may be negative = wraps)

  const START = -Math.PI / 2;   // 12 o'clock (matches -90° in createVbo)
  const FULL  = Math.PI * 2;
  const SEGS  = 32;

  ctx.save();
  for (let seg = 0; seg < SEGS; seg++) {
    const t0 = seg       / SEGS;
    const t1 = (seg + 1) / SEGS;

    const a0 = START + (te + t0 * tail) * FULL;
    const a1 = START + (te + t1 * tail) * FULL;

    // Alpha: linear 0→1 from tail end to leading edge (matches shader colPct)
    // Smoothstep tweak near leading edge mirrors `sm = smoothstep(1,0.99,colPct)`
    const mid = (t0 + t1) / 2;
    ctx.globalAlpha = mid * (mid < 0.97 ? 1 : (1 - mid) / 0.03);

    ctx.beginPath();
    ctx.arc(cx, cy, outerR, a0, a1);
    ctx.arc(cx, cy, innerR, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

export function drawRings() {
  _RX.clearRect(0, 0, _RC.width, _RC.height);

  for (let i = 0; i < state.numRacers; i++) {
    const p = state.players[i];

    // radialPos mirrors C++ radialPos logic in RaceView::draw()
    let radialPos;
    if (state.raceType === 'DISTANCE') {
      radialPos = p.percent;
    } else {
      // Time race: 1 lap = 100 metres (matches `pd->getDistanceMeters() / 100.0`)
      radialPos = p.distanceMeters / 100.0;
    }

    // tailLen mirrors: lmap(mph, 0,30, 0,0.30), clamp(0,0.50)
    const tailLen = Math.min(Math.max((p.mph / 30.0) * 0.30, 0), 0.50);

    const { inner, outer } = _ringRadii(i);
    _drawArcWithTail(_RX, _CX, _CY, inner, outer, radialPos, tailLen, PLAYER_COLORS[i]);
  }
}
