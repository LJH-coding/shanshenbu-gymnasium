(function (root, factory) {
  'use strict';
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.ShanshenbuBattleRules = rules;
})(globalThis, function () {
  'use strict';

  const W = 1280, GROUND = 610;
  const SPEED = 300, GRAV = 2600, JUMPV = 950;
  const CD = { shan: 1, ball: 1.4, bear: 4 };
  const BEAR = { chantAt: 1.22, activeEnd: 2.6, dur: 2.9, hitEvery: .18, dmg: 3 };
  const D2R = Math.PI / 180;
  const L = { TH: 60, SH: 58, UA: 44, FA: 42, TORSO: 86, HIPW: 17, SHW: 28, HEADR: 21 };
  const KICK_POSE = { lean: -2, head: -8, turn: 8, bA: -98, bE: -26, fA: 98, fE: 26, bT: 36, bK: 8, fT: 6, fK: -14, dy: -2 };

  class Fighter {
    constructor(id, x, face) {
      this.id = id;
      this.load = ['shan', 'ball', 'bear'];
      this.used = [0, 0, 0];
      this.cleanW = 0;
      this.perf = 0;
      this.reset(x, face);
    }

    reset(x, face) {
      this.x = x; this.y = 0; this.vx = 0; this.vy = 0; this.face = face;
      this.hp = 200; this.hpShow = 200; this.act = null; this.stun = 0; this.cd = { shan: 0, ball: 0, bear: 0 };
      this.walkPh = 0; this.inv = 0; this.ko = false; this.win = false; this.flash = 0; this.hitCount = 0;
      this.guard = null; this.guardT = 0; this.armorT = 0; this.armorMul = 1; this.spdT = 0; this.spdMul = 1;
      this.powT = 0; this.powMul = 1; this.healT = 0; this.healRate = 0; this.floatT = 0; this.mvcd = {};
      this.ccOnlyT = 0; this.pushT = 0; this.pushV = 0;
    }

    get grounded() { return this.y <= 0; }
    canAct() { return !this.act && this.stun <= 0 && !this.ko && !this.win; }
  }

  function skeleton(p, f, D = L) {
    const v = (a, len) => [Math.sin(a * D2R) * f * len, Math.cos(a * D2R) * len];
    const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
    const hipB = [-D.HIPW * f, 0], hipF = [D.HIPW * f, 0];
    const kneeB = add(hipB, v(p.bT, D.TH)), footB = add(kneeB, v(p.bT + p.bK, D.SH));
    const kneeF = add(hipF, v(p.fT, D.TH)), footF = add(kneeF, v(p.fT + p.fK, D.SH));
    const u = [Math.sin(p.lean * D2R) * f, -Math.cos(p.lean * D2R)];
    const perp = [Math.cos(p.lean * D2R) * f, Math.sin(p.lean * D2R)];
    const neck = [u[0] * D.TORSO, u[1] * D.TORSO];
    const shB = [neck[0] - perp[0] * D.SHW - u[0] * 8, neck[1] - perp[1] * D.SHW - u[1] * 8];
    const shF = [neck[0] + perp[0] * D.SHW - u[0] * 8, neck[1] + perp[1] * D.SHW - u[1] * 8];
    const va = (a, len) => v(a + p.lean, len);
    const elB = add(shB, va(p.bA, D.UA)), haB = add(elB, va(p.bA + p.bE, D.FA));
    const elF = add(shF, va(p.fA, D.UA)), haF = add(elF, va(p.fA + p.fE, D.FA));
    const hd = (p.lean + p.head) * D2R;
    const head = [neck[0] + Math.sin(hd) * f * (D.HEADR + 8), neck[1] - Math.cos(hd) * (D.HEADR + 8)];
    const footY = Math.max(footB[1], footF[1]);
    return { hipB, hipF, kneeB, footB, kneeF, footF, neck, shB, shF, elB, haB, elF, haF, head, hd, footY, u, perp };
  }

  // The projectile starts at the leading foot of the actual kick pose.
  function kickFoot(sk, face) {
    return sk.footF[0] * face >= sk.footB[0] * face ? sk.footF : sk.footB;
  }

  function launchBalls(balls, ft, pose = KICK_POSE) {
    const sk = skeleton(pose, ft.face);
    const foot = kickFoot(sk, ft.face);
    const baseY = GROUND - ft.y - sk.footY - 8 + pose.dy;
    const mods = ft.mods;
    const count = 1 + (mods ? mods.multi : 0);
    const size = mods ? mods.ballBig : 1;
    for (let i = 0; i < count; i++) {
      balls.push({
        owner: ft, x: ft.x + foot[0] + ft.face * 14, y: baseY + foot[1] - 6 - i * 52,
        vx: ft.face * 820, spin: 0, t: 0, pierce: mods ? mods.pierce : 0, r: 15 * size, kbv: 260 * size
      });
    }
  }

  function startBaseSkill(ft, foe, input, skill) {
    if (skill === 'shan') {
      const toward = Math.sign(foe.x - ft.x) || ft.face;
      const backward = (input.L && toward > 0) || (input.R && toward < 0);
      const dir = input.U ? 'up' : backward ? 'back' : 'fwd';
      const travel = dir === 'back' ? -toward : toward;
      ft.act = { type: 'shan', t: 0, dur: .55, dir, travel, done: false };
      ft.vx = 0;
    } else if (skill === 'ball') {
      ft.act = { type: 'ball', t: 0, dur: .85, spawned: false, launched: false };
      ft.vx = 0;
    } else if (skill === 'bear') {
      ft.act = { type: 'bear', t: 0, dur: BEAR.dur, nextHit: .3, hits: 0 };
    } else {
      return;
    }
    ft.cd[skill] = CD[skill];
  }

  function baseSlotReady(ft, skill) {
    return ft.cd[skill] <= 0 && (skill === 'shan' || ft.grounded);
  }

  function useBaseSlot(ft, foe, input, slot) {
    const skill = ft.load[slot];
    ft.used[slot] = 1;
    ft._last = skill;
    startBaseSkill(ft, foe, input, skill);
  }

  const clampX = x => Math.max(70, Math.min(W - 70, x));

  function hurtbox(ft) {
    return { x0: ft.x - 30, x1: ft.x + 30, y0: GROUND - ft.y - 265, y1: GROUND - ft.y };
  }

  function shanTeleport(ft, action) {
    action.done = true;
    if (action.dir === 'up') {
      ft.y = Math.min(ft.y + 230, 330);
      ft.vy = 120;
    } else {
      ft.x = clampX(ft.x + action.travel * 250);
    }
  }

  function canHit(target) {
    return !target.ko && !(target.inv > 0);
  }

  function interruptOnHit(target, stun, knockback) {
    target.act = null;
    target.stun = Math.max(target.stun, stun);
    target.vx = knockback;
    target.flash = .12;
  }

  function knockOut(target, knockback) {
    if (target.hp <= 0) {
      target.ko = true;
      target.stun = 0;
      target.vy = 500;
      target.y = Math.max(target.y, 1);
      target.vx = knockback * 1.6;
    }
  }

  const impactStop = kind => kind === 'ball' ? .07 : .025;

  function advanceAction(ft, foe, action, dt, hooks) {
    action.t += dt;
    if (action.type === 'shan') {
      if (action.t > .03 && action.t < .3) ft.inv = .02;
      if (!action.done && action.t >= .1) (hooks.shanMove || shanTeleport)(ft, action);
    } else if (action.type === 'ball') {
      if (!action.spawned && action.t >= .2) {
        action.spawned = true;
        hooks.onBallPrep?.(ft);
      }
      if (!action.launched && action.t >= .4) {
        action.launched = true;
        hooks.launchBall(ft);
      }
    } else if (action.type === 'mv') {
      hooks.moveTick?.(ft, foe, action, dt);
    } else if (action.type === 'bear') {
      ft.vx = action.t < .28 ? ft.face * 420 : 0;
      if (!action.chant && action.t >= BEAR.chantAt) {
        action.chant = true;
        hooks.onBearChant?.(ft);
      }
      if (action.t >= action.nextHit && action.t < BEAR.activeEnd) {
        action.nextHit += BEAR.hitEvery / (ft.mods ? ft.mods.bearRate : 1);
        const targets = hooks.bearTargets ? hooks.bearTargets(ft, foe) : [foe];
        for (const target of targets) {
          const dx = (target.x - ft.x) * ft.face;
          if (dx > -25 && dx < 175 * (ft.mods ? ft.mods.bearRange : 1) && Math.abs(target.y - ft.y) < 140) {
            if (hooks.applyHit(ft, target, BEAR.dmg, .38, ft.face * 60, 'bear')) {
              action.hits++;
              hooks.onBearHit?.(target, action);
            }
          }
        }
      }
    }
    if (action.t >= action.dur) {
      if (action.type === 'bear' || action.chant) hooks.stopChant?.(ft);
      ft.act = null;
    }
  }

  function advanceFighter(ft, foe, dt, hooks) {
    const input = hooks.inputFor(ft);
    ft.inp = input;
    hooks.buffTick?.(ft, dt);
    for (const key in ft.cd) ft.cd[key] = Math.max(0, ft.cd[key] - dt);
    if (ft.mods && ft.shanCh < ft.mods.shanMax && ft.cd.shan <= 0) {
      ft.shanCh++;
      if (ft.shanCh < ft.mods.shanMax) ft.cd.shan = CD.shan * ft.mods.cdMul;
    }
    ft.inv = Math.max(0, ft.inv - dt);
    ft.flash = Math.max(0, ft.flash - dt);
    if (ft.stun > 0) {
      ft.stun -= dt;
      ft.vx *= Math.pow(.02, dt);
      hooks.afterStunTick?.(ft);
    }
    hooks.tryEscape?.(ft, foe, input, dt);

    if (ft.canAct()) {
      ft.face = Math.sign(foe.x - ft.x) || ft.face;
      const ready = hooks.slotReady || baseSlotReady;
      const slot = [input.S1, input.S2, input.S3].findIndex((pressed, i) => pressed && ready(ft, ft.load[i]));
      if (slot >= 0) {
        (hooks.useSlot || useBaseSlot)(ft, foe, input, slot);
      } else if (!hooks.useExtra?.(ft, foe, input)) {
        const move = ((input.R ? 1 : 0) - (input.L ? 1 : 0)) * (ft.spdT > 0 ? ft.spdMul : 1) *
          (ft.mods ? ft.mods.spd : ft.baseSpd || 1);
        if (ft.grounded) {
          ft.vx = move * SPEED;
          if (input.Up) {
            ft.vy = JUMPV;
            ft.y = .01;
          }
        } else {
          ft.vx += (move * SPEED - ft.vx) * Math.min(1, dt * 4);
        }
        if (move && ft.grounded) ft.walkPh += dt * 11;
        else ft.walkPh = 0;
      }
    }

    const action = ft.act;
    if (action) advanceAction(ft, foe, action, dt, hooks);
    ft.x = clampX(ft.x + ft.vx * dt);
    if (ft.y > 0 || ft.vy > 0) {
      const floating = (action && action.type === 'shan' && action.dir === 'up' && action.t < .34) || ft.floatT > 0;
      ft.vy -= GRAV * dt * (floating ? .25 : 1);
      ft.y += ft.vy * dt;
      if (ft.y <= 0) {
        ft.y = 0;
        ft.vy = 0;
        if (ft.ko) hooks.onKnockoutLanding?.();
      }
    }
    if (ft.grounded && !action && ft.stun <= 0 && !ft.ko && !(hooks.inputFor(ft).L || hooks.inputFor(ft).R)) {
      ft.vx = 0;
    }
    if (ft.ko && ft.grounded) ft.vx *= Math.pow(.01, dt);
  }

  function pushFighters(p1, p2) {
    const dx = p2.x - p1.x;
    if (Math.abs(dx) < 50 && Math.abs(p1.y - p2.y) < 150 && !p1.ko && !p2.ko &&
        !p1.act?.ghost && !p2.act?.ghost) {
      const push = (50 - Math.abs(dx)) / 2 * (Math.sign(dx) || 1);
      p1.x = clampX(p1.x - push);
      p2.x = clampX(p2.x + push);
    }
  }

  function advanceProjectiles(balls, p1, p2, dt, hooks) {
    for (const ball of balls) {
      if (ball.kind === 'zone') {
        hooks.zoneTick?.(ball, dt);
        continue;
      }
      ball.t += dt;
      ball.x += ball.vx * dt;
      ball.spin += dt * 18 * Math.sign(ball.vx);
      if (ball.g) {
        ball.vy += ball.g * dt;
        ball.y += ball.vy * dt;
        if (ball.y > GROUND - 8) ball.dead = true;
      } else if (ball.kind !== 'wave') {
        ball.y += Math.sin(ball.t * 14) * .6;
      }
      const target = ball.owner === p1 ? p2 : p1;
      const box = hurtbox(target);
      if (!ball.dead && ball.x > box.x0 - 14 && ball.x < box.x1 + 14 && ball.y > box.y0 && ball.y < box.y1 + 10) {
        const hit = hooks.applyHit(ball.owner, target, ball.dmg || 16, ball.stun || .42,
          Math.sign(ball.vx) * (ball.kbv || 260), 'ball');
        if (hit === 'reflect') {
          ball.owner = target;
          ball.vx = -ball.vx * 1.15;
          ball.x = target.x + Math.sign(ball.vx) * 40;
          hooks.onReflect?.(target);
        } else if (hit === 'pass') {
          if (!ball.passed) {
            ball.passed = true;
            hooks.onPass?.(target);
          }
        } else if (hit) {
          ball.dead = true;
          if (ball.conf && hit === true) {
            target.confT = ball.conf;
            hooks.onConfused?.(target);
          }
        }
      }
    }
    return balls.filter(b => !b.dead && !(b.life && b.t > b.life) && b.x > -60 && b.x < W + 60);
  }

  function roundWinner(p1, p2) {
    if (p1.ko && !p2.ko) return 1;
    if (p2.ko && !p1.ko) return 0;
    return p1.hp === p2.hp ? -1 : p1.hp > p2.hp ? 0 : 1;
  }

  function markRoundWinner(winner) {
    winner.act = null;
    winner.stun = 0;
    winner.win = true;
  }

  return {
    W, GROUND, SPEED, GRAV, JUMPV, CD, BEAR, L, KICK_POSE, Fighter, skeleton, kickFoot, launchBalls,
    startBaseSkill, clampX, hurtbox, shanTeleport, canHit, interruptOnHit, knockOut, impactStop,
    advanceFighter, pushFighters, advanceProjectiles, roundWinner, markRoundWinner
  };
});
