'use strict';

const rules = require('./battle-rules.js');
const cpuPolicy = require('./quick-play-cpu.js');

const TICKS_PER_SECOND = 60;
const DT = 1 / TICKS_PER_SECOND;
const ROUND_SECONDS = 60;
const ROUND_TICKS = ROUND_SECONDS * TICKS_PER_SECOND;

// Same seeded generator as the browser's rollback simulation, local to each round.
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    const a = state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clearPressed(input) {
  input.Up = input.S1 = input.S2 = input.S3 = false;
}

function snapshotFighter(fighter) {
  const { x, y, hp, face, vx, vy, act, stun, inv, ko, win, walkPh, cd, used, flash } = fighter;
  return {
    x, y, hp, face, vx, vy, act: act ? { ...act } : null, stun, inv, ko, win, walkPh,
    cd: { ...cd }, used: [...used], flash,
  };
}

class QuickPlayBattle {
  constructor({ seed, difficulty, model, versus = false, recordReplay = false }) {
    this.rng = createRandom(seed);
    this.difficulty = difficulty;
    this.versus = versus;
    this.recordReplay = recordReplay;
    this.model = versus ? null : model;
    this.playerNames = versus ? ['player_1', 'player_2'] : ['player', 'cpu'];
    this.width = rules.W;
    this.ground = rules.GROUND;
    this.cooldowns = rules.CD;
    this.cpu = versus ? null : cpuPolicy.createCpuState();
    this.p1 = new rules.Fighter('p1', 380, 1);
    this.p2 = new rules.Fighter('p2', 900, -1);
    this.balls = [];
    this.timer = ROUND_SECONDS;
    this.activeTicks = 0;
    this.frames = 0;
    this.hitstop = 0;
    this.reason = null;
    this.winner = null;
    this.hooks = {
      inputFor: ft => ft === this.p1 ? this.input : (this.cpu ? this.cpu.input : this.opponentInput),
      launchBall: ft => rules.launchBalls(this.balls, ft),
      applyHit: (attacker, target, damage, stun, knockback, kind) => {
        if (!rules.canHit(target)) return false;
        target.hp = Math.max(0, target.hp - damage);
        rules.interruptOnHit(target, stun, knockback);
        this.hitstop = rules.impactStop(kind);
        rules.knockOut(target, knockback);
        return true;
      }
    };
  }

  tick() {
    this.frames++;
    if (this.model) cpuPolicy.tickModelCpu(this.cpu, this, this.model, DT, this.rng);
    if (this.hitstop > 0) {
      this.hitstop -= DT;
      return;
    }
    if (this.cpu && !this.model) cpuPolicy.tickRuleCpu(this.cpu, this, DT, this.rng);

    rules.advanceFighter(this.p1, this.p2, DT, this.hooks);
    rules.advanceFighter(this.p2, this.p1, DT, this.hooks);
    rules.pushFighters(this.p1, this.p2);
    this.balls = rules.advanceProjectiles(this.balls, this.p1, this.p2, DT, this.hooks);
    this.activeTicks++;
    this.timer = (ROUND_TICKS - this.activeTicks) / TICKS_PER_SECOND;

    if (this.p1.ko || this.p2.ko || this.activeTicks === ROUND_TICKS) {
      this.reason = this.p1.ko || this.p2.ko ? 'ko' : 'timeout';
      const winner = rules.roundWinner(this.p1, this.p2);
      this.winner = winner < 0 ? 'draw' : this.playerNames[winner];
      if (winner >= 0) rules.markRoundWinner(winner === 0 ? this.p1 : this.p2);
    }
  }

  step(action, opponentAction) {
    if (this.reason) throw new Error('Round has ended. Reset before stepping again.');
    // Resolve both relative directions from the same pre-step positions.
    this.input = cpuPolicy.decodeAction(action, this.p1, this.p2);
    if (this.versus) this.opponentInput = cpuPolicy.decodeAction(opponentAction, this.p2, this.p1);
    const replayFrames = this.recordReplay ? [] : null;
    for (let i = 0; i < cpuPolicy.MODEL_FRAME_SKIP && !this.reason; i++) {
      this.tick();
      replayFrames?.push(this.replayFrame());
      // Move and aim are held. Jump and the three skill keys are single presses.
      clearPressed(this.input);
      if (this.versus) clearPressed(this.opponentInput);
    }
    return this.result(replayFrames);
  }

  replayFrame() {
    return {
      p1: snapshotFighter(this.p1),
      p2: snapshotFighter(this.p2),
      balls: this.balls.map(({ x, y, vx, spin, t, r, owner }) => ({
        x, y, vx, spin, t, r, owner: owner === this.p1 ? 1 : 2,
      })),
      timer: this.timer,
    };
  }

  result(replayFrames = this.recordReplay ? [this.replayFrame()] : null) {
    const observation = this.versus ? {
      player_1: cpuPolicy.observe(this, this.p1, this.p2),
      player_2: cpuPolicy.observe(this, this.p2, this.p1),
    } : cpuPolicy.observe(this);
    const hp = this.versus
      ? { player_1_hp: this.p1.hp, player_2_hp: this.p2.hp }
      : { player_hp: this.p1.hp, cpu_hp: this.p2.hp };
    const info = { winner: this.winner, reason: this.reason, ...hp, frames: this.frames };
    if (!this.versus) info.difficulty = this.difficulty;
    const result = {
      observation,
      reward: this.winner === this.playerNames[0] ? 1 : this.winner === this.playerNames[1] ? -1 : 0,
      terminated: this.reason !== null,
      info,
    };
    if (replayFrames) result.replay_frames = replayFrames;
    return result;
  }
}

module.exports = { QuickPlayBattle };
