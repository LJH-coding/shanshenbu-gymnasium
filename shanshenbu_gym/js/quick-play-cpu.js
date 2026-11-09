(function () {
  'use strict';

  const ACTION_COUNT = 18;
  const OBSERVATION_SIZE = 58;
  const MODEL_FRAME_SKIP = 4;
  const MODEL_INTERVAL = MODEL_FRAME_SKIP / 60;
  const MODEL_DELAY = 3;
  const BASE_MOVES = ['shan', 'ball', 'bear'];
  const BASE_COOLDOWNS = { shan: 1, ball: 1.4, bear: 4 };

  function createCpuState() {
    const hold = { L: false, R: false, U: false };
    return {
      input: { ...hold, S1: false, S2: false, S3: false, Up: false },
      hold,
      think: 0,
      acc: 0,
      hist: [],
    };
  }

  function clearPressed(input) {
    input.Up = input.S1 = input.S2 = input.S3 = false;
  }

  function advanceRuleDecision(cpu, dt, rng, level) {
    clearPressed(cpu.input);
    cpu.think -= dt;
    if (cpu.think > 0) {
      Object.assign(cpu.input, cpu.hold);
      return false;
    }
    cpu.think = (.14 + rng() * .1) * Math.max(.45, 1 - .06 * level);
    return true;
  }

  function incomingProjectile(me, foe, balls) {
    return balls.find(ball => ball.owner === foe && Math.sign(me.x - ball.x) === Math.sign(ball.vx) && Math.abs(me.x - ball.x) < 330);
  }

  function tickRuleCpu(cpu, game, dt, rng = Math.random, level = 0) {
    const input = cpu.input;
    if (!advanceRuleDecision(cpu, dt, rng, level)) return input;

    const { p1: foe, p2: me, balls } = game;
    const dx = foe.x - me.x, dist = Math.abs(dx), dirTo = Math.sign(dx) || -1;
    const hold = { L: false, R: false, U: false };
    const toward = direction => { if (direction > 0) hold.R = true; else hold.L = true; };
    const threat = incomingProjectile(me, foe, balls);

    if (me.canAct()) {
      if (threat && me.cd.shan <= 0 && rng() < Math.min(.92, .55 + .05 * level)) {
        if (rng() < .6) hold.U = true; else toward(-dirTo);
        input.S1 = true;
      } else if (foe.act && foe.act.type === 'bear' && dist < 220 && me.cd.shan <= 0 && rng() < Math.min(.9, .5 + .04 * level)) {
        toward(-dirTo);
        input.S1 = true;
      } else if (dist < 165 && me.cd.bear <= 0 && rng() < Math.min(.9, .6 + .03 * level)) input.S3 = true;
      else if (dist > 260 && me.cd.ball <= 0 && rng() < Math.min(.8, .45 + .03 * level)) input.S2 = true;
      else if (dist > 420 && me.cd.shan <= 0 && rng() < .12) input.S1 = true;
      else if (dist > 210) toward(dirTo);
      else if (dist < 130 && rng() < .4) toward(-dirTo);
      else if (rng() < .3) toward(dirTo);
      if (rng() < .04) input.Up = true;
    }

    cpu.hold = hold;
    return Object.assign(input, hold);
  }

  function observe(game, me = game.p1, foe = game.p2, loadMe = BASE_MOVES, loadFoe = BASE_MOVES, moveCooldown) {
    const { balls, timer, width = 1280, ground = 610, cooldowns = BASE_COOLDOWNS } = game;
    const facing = foe.x >= me.x ? 1 : -1;
    const obs = [];

    for (const [fighter, load] of [[me, loadMe], [foe, loadFoe]]) {
      const act = fighter.act;
      obs.push(fighter.hp / 200, fighter.y / 300, fighter.vy / 1000, fighter.vx * facing / 800,
        Math.min(fighter.stun, 2), fighter.inv > 0 ? 1 : 0, fighter.ko ? 1 : 0, fighter.canAct() ? 1 : 0,
        fighter.grounded ? 1 : 0, fighter.armorT > 0 || fighter.ccOnlyT > 0 ? 1 : 0);
      obs.push(act ? 0 : 1);
      for (const type of ['shan', 'ball', 'bear', 'mv']) obs.push(act && act.type === type ? 1 : 0);
      obs.push(act ? Math.min(act.t || 0, 3) / 3 : 0);
      for (const move of load) {
        const fraction = cooldowns[move] != null ? fighter.cd[move] / cooldowns[move] : moveCooldown(fighter, move);
        obs.push(Math.min(1, fraction));
      }
    }

    const back = facing > 0 ? me.x : width - me.x;
    const foeBack = facing > 0 ? width - foe.x : foe.x;
    obs.push((foe.x - me.x) * facing / 1280, (foe.y - me.y) / 300, back / 1280, foeBack / 1280, timer / 60);

    const closest = balls.map(ball => ({ ball, distance: Math.abs(ball.x - me.x) })).sort((a, b) => a.distance - b.distance);
    for (let i = 0; i < 3; i++) {
      if (!closest[i]) {
        obs.push(0, 0, 0, 0, 0);
        continue;
      }
      const { ball } = closest[i];
      obs.push(1, (ball.x - me.x) * facing / 1280, (ground - ball.y - me.y) / 300,
        ball.vx * facing / 820, ball.owner === me ? 1 : -1);
    }
    return obs;
  }

  function decodeAction(action, me, foe, input = {}) {
    const direction = ((action % 3) - 1) * (foe.x >= me.x ? 1 : -1);
    const button = Math.floor(action / 3);
    return Object.assign(input, {
      L: direction < 0,
      R: direction > 0,
      U: button === 5,
      Up: button === 1,
      S1: button === 2 || button === 5,
      S2: button === 3,
      S3: button === 4,
    });
  }

  function prepareModel(json) {
    return {
      dims: json.dims,
      W: json.W.map(layer => Float32Array.from(layer)),
      b: json.b.map(layer => Float32Array.from(layer)),
    };
  }

  function inferAction(model, obs, rng = Math.random) {
    let values = obs;
    for (let layer = 0; layer < model.W.length; layer++) {
      const weights = model.W[layer], biases = model.b[layer];
      const nIn = model.dims[layer], nOut = model.dims[layer + 1];
      const next = new Float32Array(nOut), last = layer === model.W.length - 1;
      for (let unit = 0; unit < nOut; unit++) {
        let sum = biases[unit];
        const offset = unit * nIn;
        for (let i = 0; i < nIn; i++) sum += weights[offset + i] * values[i];
        next[unit] = last ? sum : Math.tanh(sum);
      }
      values = next;
    }

    const max = Math.max(...values);
    const probabilities = Array.from(values, value => Math.exp(value - max));
    let sample = rng() * probabilities.reduce((a, b) => a + b, 0);
    for (let i = 0; i < probabilities.length; i++) {
      sample -= probabilities[i];
      if (sample <= 0) return i;
    }
    return probabilities.length - 1;
  }

  function advanceModelDecision(cpu, input, dt) {
    clearPressed(input);
    if (input.X) input.X = [false];
    cpu.acc += dt;
    if (cpu.acc < MODEL_INTERVAL) return false;
    cpu.acc -= MODEL_INTERVAL;
    if (cpu.acc > MODEL_INTERVAL) cpu.acc = 0;
    return true;
  }

  function delayObservation(cpu, obs, delay) {
    cpu.hist.push(obs);
    while (cpu.hist.length > delay + 1) cpu.hist.shift();
    return cpu.hist[0];
  }

  function tickModelCpu(cpu, game, model, dt, rng = Math.random) {
    const input = cpu.input;
    if (!advanceModelDecision(cpu, input, dt)) return input;
    const obs = delayObservation(cpu, observe(game, game.p2, game.p1), MODEL_DELAY);
    return decodeAction(inferAction(model, obs, rng), game.p2, game.p1, input);
  }

  const api = {
    ACTION_COUNT, OBSERVATION_SIZE, MODEL_FRAME_SKIP,
    createCpuState, tickRuleCpu, tickModelCpu, observe, decodeAction, prepareModel,
    advanceRuleDecision, incomingProjectile, advanceModelDecision, delayObservation, inferAction,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.ShanshenbuQuickPlayCpu = api;
})();
