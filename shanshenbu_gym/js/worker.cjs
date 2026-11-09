'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { QuickPlayBattle } = require('./quick-play-battle.js');
const { ACTION_COUNT, OBSERVATION_SIZE, prepareModel } = require('./quick-play-cpu.js');

const modelFiles = new Map([
  ['weak', null],
  ['medium', 'base3_weak.json'],
  ['strong', 'base3_medium.json'],
]);
const models = new Map();
let battle;
const isAction = action => Number.isInteger(action) && action >= 0 && action < ACTION_COUNT;

function loadModel(difficulty) {
  const file = modelFiles.get(difficulty);
  if (!file) return undefined;
  if (!models.has(difficulty)) {
    const packagedPath = path.resolve(__dirname, '..', 'models', file);
    const modelPath = fs.existsSync(packagedPath)
      ? packagedPath
      : path.resolve(__dirname, '..', '..', 'assets', 'ai', file);
    const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    if (model.dims?.[0] !== OBSERVATION_SIZE || model.dims.at(-1) !== ACTION_COUNT) {
      throw new Error(`Incompatible Quick Play model: ${file}`);
    }
    models.set(difficulty, prepareModel(model));
  }
  return models.get(difficulty);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let id = null;
  let response;
  try {
    const request = JSON.parse(line);
    if (!Number.isSafeInteger(request?.id)) throw new Error('Expected an integer request id');
    id = request.id;

    if (request.op === 'reset' || request.op === 'reset_versus') {
      const { seed, difficulty, record_replay: recordReplay = false } = request;
      const versus = request.op === 'reset_versus';
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
        throw new Error('Expected a uint32 seed');
      }
      if (typeof recordReplay !== 'boolean') throw new Error('Expected a boolean record_replay');
      if (!versus && !modelFiles.has(difficulty)) throw new Error('Unknown difficulty');
      battle = new QuickPlayBattle({ seed, difficulty, model: versus ? null : loadModel(difficulty), versus, recordReplay });
      response = battle.result();
    } else if (request.op === 'step' || request.op === 'step_versus') {
      if (!battle) throw new Error('Reset the battle before stepping');
      const versus = request.op === 'step_versus';
      if (battle.versus !== versus) throw new Error('Step operation does not match the current battle mode');
      if (versus) {
        if (!Array.isArray(request.actions) || request.actions.length !== 2 || !request.actions.every(isAction)) {
          throw new Error(`Expected two actions between 0 and ${ACTION_COUNT - 1}`);
        }
        response = battle.step(...request.actions);
      } else {
        if (!isAction(request.action)) {
          throw new Error(`Expected an action between 0 and ${ACTION_COUNT - 1}`);
        }
        response = battle.step(request.action);
      }
    } else {
      throw new Error('Unknown operation');
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id, ok: false, error: error.message })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ id, ok: true, ...response })}\n`);
});
