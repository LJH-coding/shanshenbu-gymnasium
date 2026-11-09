'use strict';
const cv = document.getElementById('c');
let ctx = cv.getContext('2d', { alpha: false });
const {
  W, GROUND, SPEED, GRAV, JUMPV, CD, BEAR, L, KICK_POSE, Fighter, skeleton, kickFoot, launchBalls,
  startBaseSkill, clampX, hurtbox, shanTeleport, canHit, interruptOnHit, knockOut, impactStop,
  advanceFighter: advanceBattleFighter, pushFighters, advanceProjectiles, roundWinner, markRoundWinner
} = ShanshenbuBattleRules;
const H = 720;
const D2R = Math.PI / 180;

/* ================= 音效 ================= */
const query = new URLSearchParams(location.search);
const replayView = query.get('replay') === '1';
const params = replayView ? new URLSearchParams() : query;
// 開發人員後台工具（AI 對手／組合對練／AI 關卡、練習場的馬師傅 1～3 階）：網址加 ?dev=1 才出現，這台會記住；?dev=0 關掉
{ let dev = false; try { if (params.has('dev')) localStorage.setItem('ssb_dev', params.get('dev') === '1' ? '1' : ''); dev = localStorage.getItem('ssb_dev') === '1'; } catch (e) {}
  document.body.classList.toggle('dev', dev); }
// 靜音只在本次開啟有效（不記住），?mute=1 給測試用
let muted = query.get('mute') === '1';
const muteBtn = document.getElementById('mute');
function refreshMute() {
  muteBtn.innerHTML = muted ? '<i>🔇</i>音效：關' : '<i>🔊</i>音效：開';
  document.getElementById('setMute').textContent = muted ? '🔇 音效：關（點了打開）' : '🔊 音效：開（點了關掉）';
}
document.getElementById('setMute').onclick = () => toggleMute();
// ☰ 選單：點按鈕開關，點選單裡任一項或點旁邊就收起來
const menuDrop = document.getElementById('menuDrop');
document.getElementById('menuBtn').onclick = e => { e.stopPropagation(); menuDrop.classList.toggle('hide'); };
menuDrop.addEventListener('click', e => { if (e.target.closest('.mi')) menuDrop.classList.add('hide'); });
addEventListener('pointerdown', e => { if (!e.target.closest('#tools')) menuDrop.classList.add('hide'); });
// iPhone Safari 不理 user-scalable=no：連點兩下會放大、兩指會縮放。擋掉手勢縮放，連點的第二下不讓它變成放大
// （輸入框、可捲動的面板不擋，免得選單點不到）
document.addEventListener('gesturestart', e => { if (!replayView) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', e => { if (!replayView) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', e => {
  if (replayView) return;
  const now = Date.now(), quick = now - lastTouchEnd < 350; lastTouchEnd = now;
  if (quick && !e.target.closest('input,select,textarea,.pnl,#meta,#lobby,#mvPick,#rgPanel,#chestFx,#prPanel,#aiPick,#lvPick,#ladder,#bwJoinBox,#bwPick,#bwKickBox')) e.preventDefault();
}, { passive: false });
function toggleMute() { muted = !muted; refreshMute(); if (muted) stopChant(); else unlockAudio(); }
muteBtn.onclick = toggleMute; refreshMute();

let AC = null;
function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return AC; }
// iPhone：讓網頁聲音不受側邊靜音鍵影響（Safari 17+）
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
function unlockAudio() {
  const a = ac(); if (!a) return;
  if (a.state !== 'running') a.resume().catch(() => {});
  try { const b = a.createBufferSource(); b.buffer = a.createBuffer(1, 1, 22050); b.connect(a.destination); b.start(); } catch (e) {} // iOS 解鎖
}
if (!replayView) for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) addEventListener(ev, unlockAudio, { capture: true });

// 原片人聲：老師喊「閃身步／浪子踢球／狗熊哆嗦毛」＋ 狗熊段「隆咚框」吆喝
// 先解碼成 AudioBuffer，出招當下零延遲播放；解碼失敗（例如直接開本機檔）退回 <audio>
const CLIPS = {}, BUF = {};
// 線上對戰（見下方「線上對戰」段的 rbTick）：倒回去重算同一格時，已經響過的聲音不再響；重算才發現的新聲音（例如晚到的一下打中）太舊（0.2 秒前）就不補了
const RB = { on: false, stepping: false };
function rbSfx(k) {
  if (!RB.stepping) return true;
  const key = RB.simF + k; if (RB.sfx.has(key)) return false;
  RB.sfx.set(key, RB.simF); return RB.F - RB.simF < 12;
}
const BASE_CLIPS = ['shan', 'ball', 'bear', 'chant'];
function loadBaseClips() {
  if (CLIPS.shan) return;
  for (const key of BASE_CLIPS) {
    const url = 'assets/sfx/' + key + '.mp3?v=3';
    const audio = new Audio(url); audio.preload = 'auto'; CLIPS[key] = audio;
    fetch(url).then(r => r.arrayBuffer()).then(data => ac()?.decodeAudioData(data)).then(buffer => {
      if (buffer) BUF[key] = buffer;
    }).catch(() => {});
  }
}
if (!replayView) loadBaseClips();
// 每位角色各自的「隆咚框」吆喝（兩人同時放狗熊也不互相打斷）
const chantNodes = new Map();
function loadClip(k) {
  if (replayView || CLIPS[k] || !(k.startsWith('mv_') || k.startsWith('ma_'))) return;
  const url = (k.startsWith('ma_') ? 'assets/sfx/ma/' : 'assets/sfx/mv/') + k.slice(3) + '.mp3'; // ma_＝馬師傅語音（有放檔案才用）
  const el = new Audio(url); el.preload = 'auto'; CLIPS[k] = el;
  fetch(url).then(r => r.arrayBuffer()).then(b => ac().decodeAudioData(b)).then(d => { BUF[k] = d; }).catch(() => {});
}
// 四人合作線上：role host＝房主（跑整場、送畫面）／guest＝客人（只送按鍵）；snd＝要轉給客人的聲音
const BWN = { role: null, ws: null, ok: false, room: '', key: '', guests: {}, snd: [], sendT: 0, pend: 0, held: 0, ents: new Map(), slots: {}, padSig: '', seq: 0 };
const bwSndOn = () => BWN.role === 'host' && BWN.ok;
function playClip(k, vol = 1, playback) {
  if (!rbSfx('c' + k)) return null;
  loadClip(k);
  if (net.role === 'host' && net.peer && !net.quiet) net.ev.push(['c', k, vol]);
  if (bwSndOn() && !net.quiet) BWN.snd.push(['c', k, vol]);
  if (muted) return null;
  const a = ac();
  const offset = playback?.offset ?? 0;
  if (a && BUF[k] && a.state === 'running') {
    if (offset >= BUF[k].duration) return null;
    const src = a.createBufferSource(), g = a.createGain();
    src.buffer = BUF[k];
    if (playback) src.playbackRate.value = playback.rate;
    g.gain.value = vol; src.connect(g); g.connect(playback?.output || a.destination); src.start(0, offset);
    return { stop: () => { // 短淡出，避免喀一聲
      try { const t = a.currentTime; g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + .1); src.stop(t + .12); } catch (e) {}
    } };
  }
  const el = CLIPS[k]?.cloneNode();
  if (!el) return null;
  el.volume = vol;
  if (playback) {
    el.playbackRate = playback.rate;
    if (offset) el.currentTime = offset;
  }
  el.play().catch(() => {});
  return { stop: () => el.pause() };
}
function startChant(ft, clip = 'chant') { // clip：狗熊的「隆咚框」，或搖頭晃腦的 mv_yaotou_chant
  if (!rbSfx('h' + idOf(ft) + clip)) return;
  stopChant(ft);
  if (net.role === 'host' && net.peer) net.ev.push(['ch', idOf(ft), clip]);
  if (bwSndOn() && ft && ft.nid) BWN.snd.push(['ch', ft.nid, clip]);
  net.quiet = true; const n = playClip(clip, .85); net.quiet = false;
  if (n) chantNodes.set(ft, n);
}
function stopChant(ft) {
  if (!rbSfx('x' + (ft ? idOf(ft) : 0))) return;
  if (net.role === 'host' && net.peer) net.ev.push(['cs', ft ? idOf(ft) : 0]);
  if (bwSndOn() && (!ft || ft.nid)) BWN.snd.push(['cs', ft ? ft.nid : 0]);
  for (const [k, n] of chantNodes) if (!ft || k === ft) { n.stop(); chantNodes.delete(k); }
}
function noiseBuf(a, dur) {
  const b = a.createBuffer(1, a.sampleRate * dur, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = fxRand() * 2 - 1; return b;
}
// 音效用的亂數跟對戰模擬分開：線上對戰重算時同一個聲音不會再響，不能因此讓兩邊的對戰亂數對不上
const fxRand = Math.random;
function synth(type, destination) {
  if (!rbSfx('s' + type)) return;
  if (net.role === 'host' && net.peer) net.ev.push(['s', type]);
  if (bwSndOn()) BWN.snd.push(['s', type]);
  if (muted) return; const a = ac(); if (!a) return; const t = a.currentTime;
  const out = a.createGain(); out.connect(destination || a.destination);
  if (type === 'clap') { // 拍手：很短的一聲雜訊（搖頭晃腦手拍到手）
    const s = a.createBufferSource(); s.buffer = noiseBuf(a, .06);
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.2;
    out.gain.setValueAtTime(.7, t); out.gain.exponentialRampToValueAtTime(.001, t + .06);
    s.connect(f); f.connect(out); s.start(t);
  } else if (type === 'whoosh') {
    const s = a.createBufferSource(); s.buffer = noiseBuf(a, .35);
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3500, t + .18);
    out.gain.setValueAtTime(.0001, t); out.gain.exponentialRampToValueAtTime(.5, t + .05); out.gain.exponentialRampToValueAtTime(.001, t + .32);
    s.connect(f); f.connect(out); s.start(t);
  } else if (type === 'kick' || type === 'hit' || type === 'thud') {
    const o = a.createOscillator(); o.type = 'sine';
    const f0 = type === 'kick' ? 160 : type === 'hit' ? 220 : 90;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(45, t + .15);
    const g = a.createGain(); g.gain.setValueAtTime(.7, t); g.gain.exponentialRampToValueAtTime(.001, t + .18);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + .2);
    const s = a.createBufferSource(); s.buffer = noiseBuf(a, .08);
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = type === 'hit' ? 1500 : 800;
    const g2 = a.createGain(); g2.gain.setValueAtTime(type === 'hit' ? .45 : .25, t); g2.gain.exponentialRampToValueAtTime(.001, t + .07);
    s.connect(hp); hp.connect(g2); g2.connect(out); s.start(t);
    out.gain.value = .6;
  } else if (type === 'gong') {
    for (const [fr, v] of [[220, .35], [331, .2], [467, .15], [612, .1]]) {
      const o = a.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(fr * 1.04, t); o.frequency.exponentialRampToValueAtTime(fr, t + .4);
      const g = a.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + 2.2);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 2.3);
    }
  } else if (type === 'pop') {
    const o = a.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(500, t); o.frequency.exponentialRampToValueAtTime(1400, t + .12);
    const g = a.createGain(); g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.001, t + .15);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + .16);
  }
}

/* ================= 輸入 ================= */
const keys = new Set(), pressed = new Set();
addEventListener('keydown', e => {
  if (replayView) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code); ac(); if (AC && AC.state === 'suspended') AC.resume();
  if (e.code === 'KeyM') toggleMute();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const MAP = {
  // U＝按住「上」（閃身步往上閃）；J＝跳。電腦版跳改空白鍵，W 只管往上閃；手機的 ▲／跳 鈕用 TouchUp，同時算跳和往上
  p1: { L: ['KeyA'], R: ['KeyD'], U: ['TouchUp', 'KeyW'], J: ['Space', 'TouchUp'], S1: ['KeyJ'], S2: ['KeyK'], S3: ['KeyL'],
    X: [['Digit1', 'KeyI'], ['Digit2', 'KeyO'], ['Digit3', 'KeyU'], ['Digit4', 'KeyP'], ['Digit5', 'KeyY'], ['Digit6', 'KeyH'], ['Digit7', 'KeyN'], ['Digit8', 'KeyB'], ['Digit9'], ['Digit0']] }, // X：闖關學到的新招 1～10
  p2: { L: ['ArrowLeft'], R: ['ArrowRight'], U: ['ArrowUp'], J: ['ArrowUp'], S1: ['Numpad1', 'Comma'], S2: ['Numpad2', 'Period'], S3: ['Numpad3', 'Slash'] },
};
const any = (arr, s) => arr.some(k => s.has(k));

/* ================= 觸控按鈕（響應式） ================= */
const isTouch = params.get('touch') === '1' || matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
// 1P 打電腦：左邊方向、右邊招式；2P：左邊整組給 1P、右邊整組給 2P
function layoutPads() {
  const two = !vsCPU && mode !== 'title' && mode !== 'lobby' && !net.role && !(typeof PR !== 'undefined' && PR.on); // 練習場的木樁不用 2P 按鈕
  const cl = document.getElementById('cl'), cr = document.getElementById('cr');
  cl.querySelector('.skrow').classList.toggle('hide', !two);
  cr.querySelector('.mvrow').classList.toggle('hide', !two);
  cr.querySelector('.exrow').classList.toggle('hide', !((RG.on || ladder.on) && p1 && p1.extra && p1.extra.length && mode !== 'title'));
  cl.querySelectorAll('.pb[data-a]').forEach(b => b.dataset.code = MAP.p1[b.dataset.a][0]);
  cr.querySelectorAll('.pb[data-a]').forEach(b => b.dataset.code = (two ? MAP.p2 : MAP.p1)[b.dataset.a][0]);
  cr.querySelectorAll('.xb').forEach(b => b.dataset.code = MAP.p1.X[+b.dataset.x][0]);
  document.body.classList.toggle('stick', STICK && !two); // 搖桿只給單人用；雙人同機還是兩組按鈕
  if (typeof stickLayout === 'function') stickLayout(); // 進出練習場時招式圈大小不同
}
// 搖桿操作：手機預設開（選單可切回舊按鈕，記在這台裝置上）；電腦版沒有觸控按鈕，維持原本的 UI
// 網址 ?pad=stick／?pad=old 也能切
let STICK = isTouch && (params.get('pad') ? params.get('pad') === 'stick' : lsGet('ssb_pad') !== 'old');
function stickLayout() { // 招式鈕繞著拳頭排：左、左上、上（跟傳說對決一樣）
  const pr = document.body.classList.contains('practice'), vm = Math.min(innerWidth, innerHeight); // 尺寸跟 CSS 的 --F 一樣（練習場比較小）
  const F = pr ? Math.min(.19 * vm, 92) : Math.min(.26 * vm, 124), r = F * .98;
  const bw = window.bwPadMode; // 四人合作：內圈 跳／招1／招2，外圈 招3／閃
  document.querySelectorAll('#arc .sk').forEach((b, i) => {
    const [deg, rr] = bw ? [[180, 1], [135, 1], [90, 1], [157.5, 1.9], [112.5, 1.9]][i] || [0, 1] : [180 - 45 * i, 1], a = deg * Math.PI / 180;
    b.style.left = Math.cos(a) * r * rr + 'px'; b.style.top = -Math.sin(a) * r * rr + 'px';
  });
}
stickLayout(); addEventListener('resize', stickLayout);
{
  const zone = document.getElementById('stickZone'), base = document.getElementById('stickBase'), knob = document.getElementById('stickKnob');
  let pid = null, ox = 0, oy = 0;
  const rest = () => { base.style.left = base.style.top = ''; }; // 放開就回到左下角的預設位置（CSS）
  const set = (code, on) => { if (on) { if (!keys.has(code)) pressed.add(code); keys.add(code); } else keys.delete(code); };
  const move = e => {
    const R = base.offsetWidth / 2, dx = Math.max(-R, Math.min(R, e.clientX - ox)), dy = Math.max(-R, Math.min(R, e.clientY - oy));
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    set(MAP.p1.L[0], dx < -R * .3); set(MAP.p1.R[0], dx > R * .3);
    set('StickUp', dy < -R * .5); // 往上推＝閃身步往上閃的方向，不會跳；跳只有右邊的拳頭鈕
    set('StickDown', dy > R * .5); // 往下拉：只有 2.5D 闖關用（往畫面外走）
  };
  const end = () => { pid = null; zone.classList.remove('on'); knob.style.transform = ''; set(MAP.p1.L[0], false); set(MAP.p1.R[0], false); set('StickUp', false); set('StickDown', false); rest(); };
  zone.addEventListener('pointerdown', e => {
    if (pid != null) return; e.preventDefault(); unlockAudio(); pid = e.pointerId; try { zone.setPointerCapture(pid); } catch (err) {}
    const z = zone.getBoundingClientRect(); ox = e.clientX; oy = e.clientY; base.style.left = ox - z.left + 'px'; base.style.top = oy - z.top + 'px'; // 手指按哪裡搖桿就出現在哪裡
    zone.classList.add('on'); move(e);
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId === pid) move(e); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(t, e => { if (e.pointerId === pid) end(); });
}
document.querySelectorAll('.pb').forEach(b => {
  const up = e => { b.classList.remove('on'); keys.delete(b.dataset.code); };
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); unlockAudio(); try { b.setPointerCapture(e.pointerId); } catch (err) {} b.classList.add('on');
    if (!keys.has(b.dataset.code)) pressed.add(b.dataset.code); keys.add(b.dataset.code);
  });
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
});
// 全螢幕：一般瀏覽器用 Fullscreen API（iPad 是 webkit 前綴）；iPhone 不支援，改教他「加入主畫面」
const docEl = document.documentElement;
const fsReq = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
const fsExit = document.exitFullscreen || document.webkitExitFullscreen;
const fsNow = () => document.fullscreenElement || document.webkitFullscreenElement;
const inApp = /ShanshenbuApp/.test(navigator.userAgent); // Android App（Capacitor 殼）裡面：本來就全螢幕
const standalone = inApp || navigator.standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
if (standalone) document.getElementById('fs').classList.add('hide'); // 已經是從主畫面打開：本來就全螢幕
if ('serviceWorker' in navigator && location.protocol === 'https:' && !inApp) navigator.serviceWorker.register('./sw.js').catch(() => {}); // 可安裝成 Web App
document.getElementById('fs').onclick = async () => {
  if (!fsReq) { document.getElementById('fsHelp').classList.remove('hide'); return; }
  try {
    if (!fsNow()) { await fsReq.call(docEl); try { await screen.orientation.lock('landscape'); } catch (e) {} }
    else await fsExit.call(document);
  } catch (e) { document.getElementById('fsHelp').classList.remove('hide'); }
};
document.getElementById('fsOk').onclick = () => document.getElementById('fsHelp').classList.add('hide');
addEventListener('contextmenu', e => e.preventDefault());

/* ================= 骨架與姿勢 =================
   角度單位：度。0 = 垂直向下；正值 = 朝「面向方向」擺。
   手臂角度相對軀幹，腿角度為絕對。 */
const N = { lean: 0, head: 0, bA: -10, bE: 12, fA: 10, fE: -12, bT: -5, bK: 0, fT: 5, fK: 0, rot: 0, dy: 0, turn: 0, nod: 0, back: 0, slip: 0, tl: 1 }; // tl：軀幹往鏡頭彎時看起來變短的比例 // back：1＝背對鏡頭（≥.5 就畫背面）；slip：1＝吊帶從右肩掉下來
const P = o => Object.assign({}, N, o);
// 閃身步（以「移動方向」為正）——取自原片：上身被甩在後、前腳整條伸直滑出
const SHAN_ANT = P({ lean: 6, bA: -28, bE: 20, fA: 22, fE: -10, bT: -14, bK: 18, fT: 14, fK: -18 });
const SHAN_LUNGE = P({ lean: -26, head: -14, bA: -58, bE: -18, fA: -30, fE: 34, bT: -26, bK: 78, fT: 42, fK: 0 });
const SHAN_UP = P({ lean: 0, head: 8, bA: -70, bE: -20, fA: 70, fE: 20, bT: -38, bK: 14, fT: 38, fK: -14 });
// 浪子踢球——雙臂平展如翅、手腕下垂、上身前俯，單腳點地、另一腳屈膝外甩
const BALL_WING = P({ lean: -6, head: 10, bA: -84, bE: 28, fA: 84, fE: -28, bT: -8, bK: 12, fT: 8, fK: -12, dy: -6 });
const BALL_CHAMBER = P({ lean: -14, head: 12, bA: -88, bE: 30, fA: 78, fE: -30, bT: -4, bK: 8, fT: 14, fK: -70 });
const BALL_FLICK = P({ lean: -18, head: 8, bA: -92, bE: 26, fA: 74, fE: -22, bT: -6, bK: 10, fT: 30, fK: 70, dy: -14 });
const BALL_FLICK2 = P({ lean: -14, head: 10, bA: -86, bE: 30, fA: 80, fE: -28, bT: -6, bK: 10, fT: 22, fK: 52, dy: -8 });
// 狗熊哆嗦毛——大馬步、雙手高舉成熊掌、左右甩身哆嗦
const BEAR_LEGS = { bT: -42, bK: 20, fT: 42, fK: -20 };
const BEAR_RISE = P({ lean: 8, bA: -60, bE: -40, fA: 60, fE: 40, bT: -20, bK: 14, fT: 20, fK: -14 });
const BEAR_A = P(Object.assign({ lean: 13, head: 12, bA: -125, bE: -28, fA: 125, fE: 28 }, BEAR_LEGS));
const BEAR_B = P(Object.assign({ lean: -13, head: -10, bA: -95, bE: -70, fA: 95, fE: 70 }, BEAR_LEGS));
const BEAR_C = P(Object.assign({ lean: 6, head: -6, bA: 150, bE: 22, fA: -150, fE: -22 }, BEAR_LEGS));
const BEAR_D = P(Object.assign({ lean: 19, head: 14, bA: -112, bE: 12, fA: 160, fE: 12 }, BEAR_LEGS));
const STUN = P({ lean: -16, head: -22, bA: -25, bE: 150, fA: 25, fE: -150, bT: -10, bK: 14, fT: 10, fK: -14 });
const JUMP = P({ bA: -60, bE: -20, fA: 60, fE: 20, bT: -30, bK: 52, fT: 30, fK: -52 });
const KO = P({ rot: -90, lean: 0, head: -10, bA: -150, bE: 0, fA: 150, fE: 0, bT: -12, bK: 0, fT: 12, fK: 0 });

const ease = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
function lerpPose(a, b, k) { const o = {}; for (const key in N) o[key] = a[key] + (b[key] - a[key]) * k; return o; }
// 順滑補間（Catmull-Rom）：從原片逐格抓的密集關鍵幀用這個，不然每格都減速停一下，看起來一頓一頓
function splinePose(a, b, c, d, k) {
  const o = {}, k2 = k * k, k3 = k2 * k;
  for (const key in N) { const p0 = a[key], p1 = b[key], p2 = c[key], p3 = d[key]; o[key] = .5 * (2 * p1 + (p2 - p0) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k2 + (3 * p1 - p0 - 3 * p2 + p3) * k3); }
  o.back = k < .5 ? b.back : c.back; o.slip = k < .5 ? b.slip : c.slip; // 開關類的不要補間
  return o;
}
function sampleKeys(keysArr, t) {
  if (t <= keysArr[0][0]) return keysArr[0][1];
  for (let i = 0; i < keysArr.length - 1; i++) {
    const [t0, p0] = keysArr[i], [t1, p1] = keysArr[i + 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      if (keysArr.smooth) return splinePose(keysArr[Math.max(0, i - 1)][1], p0, p1, keysArr[Math.min(keysArr.length - 1, i + 2)][1], k);
      return lerpPose(p0, p1, ease(k));
    }
  }
  return keysArr[keysArr.length - 1][1];
}
const SHAN_KEYS = [[0, N], [.07, SHAN_ANT], [.14, SHAN_LUNGE], [.32, SHAN_LUNGE], [.55, N]];
const SHAN_UP_KEYS = [[0, N], [.07, SHAN_ANT], [.14, SHAN_UP], [.34, SHAN_UP], [.55, JUMP]];
const BALL_KEYS = [[0, N], [.18, BALL_WING], [.30, BALL_CHAMBER], [.40, BALL_FLICK], [.55, BALL_FLICK2], [.72, BALL_WING], [.85, N]];
const BEAR_CYCLE = [BEAR_A, BEAR_B, BEAR_C, BEAR_D];

/* ================= 三招動作版本（逐格對照原片做的 5 個版本，ANIM 選用哪一版） =================
   原片觀察：
   閃身步：僵站聳肩 → 瞬間大 V 字橫跨、上身倒向移動方向、手從身前甩到對側膝 → 定住 0.2 秒 → 「啪」彈回立正
   浪子踢球：雙手從身側大拍上舉 → 展成翅膀手腕下垂、低頭彎膝上下彈 → 小腿從後勾起再甩出，有節奏連踢
   狗熊哆嗦毛：爪子收胸前滑步衝出 → 深馬步 → 雙手「熊爪舉頂」與「斜 Y 展臂」交替、身體左右大甩、全身哆嗦；結尾大字跳 */
const STIFF = P({ bA: -16, bE: 6, fA: 16, fE: -6, bT: -3, fT: 3, head: -4 });               // 僵站聳肩、手微外張
const STIFF_POP = P({ bA: -26, bE: 4, fA: 26, fE: -4, bT: -4, fT: 4, head: -8, dy: -10 });  // 彈回立正（小跳）
const SHAN_V = [
  { name: 'A 原片忠實', lunge: P({ lean: 14, head: 12, bA: 40, bE: 12, fA: 22, fE: -8, bT: -42, bK: 4, fT: 44, fK: -6, dy: 4 }),
    hold: P({ lean: 17, head: 15, bA: 52, bE: 14, fA: 24, fE: -8, bT: -44, bK: 4, fT: 46, fK: -6, dy: 8 }) },
  { name: 'B 歪頭二段抖', lunge: P({ lean: 20, head: 26, bA: 48, bE: 14, fA: 26, fE: -6, bT: -44, bK: 4, fT: 46, fK: -6, dy: 6 }),
    hold: P({ lean: 27, head: 34, bA: 58, bE: 16, fA: 30, fE: -6, bT: -46, bK: 4, fT: 48, fK: -6, dy: 10 }), shake: true },
  { name: 'C 蹲聳肩超低跨', prep: P({ dy: 14, bK: 26, fK: -26, bT: -8, fT: 8, bA: -34, bE: 10, fA: 34, fE: -10, head: -12 }),
    lunge: P({ lean: 18, head: 14, bA: 62, bE: 10, fA: 34, fE: -6, bT: -56, bK: 6, fT: 58, fK: -8, dy: 16 }),
    hold: P({ lean: 21, head: 16, bA: 70, bE: 12, fA: 36, fE: -6, bT: -57, bK: 6, fT: 59, fK: -8, dy: 19 }) },
  { name: 'D 雙手同側甩刀', lunge: P({ lean: 22, head: 16, bA: 72, bE: 2, fA: 58, fE: 10, bT: -42, bK: 4, fT: 44, fK: -6, dy: 5 }),
    hold: P({ lean: 25, head: 18, bA: 84, bE: 4, fA: 66, fE: 12, bT: -44, bK: 4, fT: 46, fK: -6, dy: 8 }) },
  { name: 'E 一字馬定格挺胸', lunge: P({ lean: 6, head: 4, bA: 34, bE: 8, fA: 62, fE: -4, bT: -68, bK: 2, fT: 70, fK: -2, dy: 30 }),
    hold: P({ lean: 8, head: 6, bA: 38, bE: 8, fA: 66, fE: -4, bT: -70, bK: 2, fT: 72, fK: -2, dy: 33 }),
    pop: P({ lean: -8, head: -14, bA: -44, bE: -10, fA: 44, fE: 10, bT: -4, fT: 4, dy: -14 }) },
];
for (const v of SHAN_V) {
  const prep = v.prep || P(Object.assign({}, STIFF, { dy: 4, bK: 10, fK: -10 }));
  v.keys = v.shake
    ? [[0, N], [.05, prep], [.1, v.lunge], [.17, v.hold], [.22, v.lunge], [.28, v.hold], [.34, v.lunge], [.43, STIFF_POP], [.55, STIFF]]
    : [[0, N], [.05, prep], [.1, v.lunge], [.3, v.hold], [.43, v.pop || STIFF_POP], [.55, STIFF]];
}
// 浪子踢球（使用者拆解的三段）：①低頭、雙手張開弧度往下、屈膝併腿 ②右腳（後腳）往後勾 ③頭轉向側邊、雙手張開弧度往上、腳順勢踢出
const K1 = P({ lean: 4, head: 6, nod: 7, bA: -70, bE: 32, fA: 70, fE: -32, bT: 6, bK: -24, fT: 10, fK: -26, dy: 8 });
const K1b = P({ lean: 5, head: 7, nod: 8, bA: -68, bE: 34, fA: 68, fE: -34, bT: 8, bK: -32, fT: 12, fK: -34, dy: 12 });  // 膝再彎一點（彈）
const K2 = P({ lean: 6, head: 6, nod: 7, bA: -74, bE: 30, fA: 74, fE: -30, bT: -14, bK: -86, fT: 10, fK: -24, dy: 6 }); // 右腳往後勾
const K3 = P(KICK_POSE); // 轉頭、手往上、踢出
const kp = (base, o) => P(Object.assign({}, base, o));
const BALL_V = [
  { name: 'A 三段忠實', hook: K2, flick: K3,
    keys: [[0, N], [.14, K1], [.26, K1b], [.33, K2], [.4, K3], [.56, kp(K3, { bT: 32, dy: 0 })], [.7, K1], [.85, N]] },
  { name: 'B 大弧度高踢', hook: kp(K2, { bA: -58, bE: 42, fA: 58, fE: -42, bK: -100 }),
    flick: kp(K3, { lean: -8, head: -12, turn: 10, bA: -112, bE: -34, fA: 112, fE: 34, bT: 62, bK: 10, dy: -8 }),
    keys: [[0, N], [.14, kp(K1, { bA: -58, bE: 42, fA: 58, fE: -42 })], [.26, kp(K1b, { bA: -56, bE: 44, fA: 56, fE: -44 })], [.33, kp(K2, { bA: -58, bE: 42, fA: 58, fE: -42, bK: -100 })],
      [.4, kp(K3, { lean: -8, head: -12, turn: 10, bA: -112, bE: -34, fA: 112, fE: 34, bT: 62, bK: 10, dy: -8 })], [.58, kp(K3, { lean: -6, turn: 10, bA: -110, bE: -32, fA: 110, fE: 32, bT: 56, bK: 8, dy: -6 })], [.72, K1], [.85, N]] },
  { name: 'C 先虛勾一下', hook: K2, flick: K3,
    keys: [[0, N], [.12, K1], [.19, kp(K2, { bK: -58, bT: -6 })], [.26, K1b], [.33, K2], [.4, K3], [.56, K3], [.7, K1], [.85, N]] },
  { name: 'D 屈膝彈兩下', hook: K2, flick: K3,
    keys: [[0, N], [.08, K1], [.14, K1b], [.2, K1], [.26, K1b], [.33, K2], [.4, K3], [.58, K3], [.72, K1], [.85, N]] },
  { name: 'E 勾住停頓再爆踢', hook: kp(K2, { bK: -96 }), flick: kp(K3, { bT: 50, lean: -6, turn: 10, dy: -6 }),
    keys: [[0, N], [.12, K1], [.2, kp(K2, { bK: -96 })], [.36, kp(K2, { bK: -100, dy: 8 })], [.4, kp(K3, { bT: 50, lean: -6, turn: 10, dy: -6 })], [.6, kp(K3, { bT: 46, turn: 10, dy: -4 })], [.72, K1], [.85, N]] },
];
const BL = { bT: -45, bK: 24, fT: 45, fK: -24 };                                       // 深馬步
const bl = o => P(Object.assign({}, BL, o));
const CLAW_UP = bl({ head: -6, bA: -152, bE: -52, fA: 152, fE: 52, dy: 4 });           // 熊爪舉頂
const CLAW_UP2 = bl({ head: 4, bA: -138, bE: -66, fA: 140, fE: 64, dy: 6 });
const Y_L = bl({ lean: -18, head: -12, bA: -138, bE: -8, fA: 58, fE: 12 });           // 斜 Y 展臂（往後倒）
const Y_R = bl({ lean: 18, head: 14, bA: -58, bE: -12, fA: 138, fE: 8 });             // 斜 Y 展臂（往前倒）
const SPREAD = bl({ bA: -96, bE: -16, fA: 96, fE: 16, dy: 2 });
const BEAR_GLIDE = P({ lean: -10, head: -8, bA: -14, bE: 148, fA: 14, fE: -148, bT: -22, bK: 30, fT: 32, fK: -8 }); // 爪收胸前滑步
const X_JUMP = P({ head: -10, bA: -140, bE: 0, fA: 140, fE: 0, bT: -30, bK: 0, fT: 30, fK: 0, dy: -34 });
const BEAR_V = [
  { name: 'A 原片忠實', cycle: [CLAW_UP, Y_L, CLAW_UP, Y_R], step: .16, jit: 7 },
  { name: 'B 熊爪狂抖', cycle: [CLAW_UP, CLAW_UP2], step: .09, jit: 15 },
  { name: 'C 斜 Y 大甩', cycle: [Y_L, Y_R], step: .2, jit: 5 },
  { name: 'D 爪展交替抬膝', cycle: [CLAW_UP, bl({ bA: -96, bE: -16, fA: 96, fE: 16, fT: 72, fK: -84, lean: -6 }), CLAW_UP, bl({ bA: -96, bE: -16, fA: 96, fE: 16, bT: -72, bK: 84, lean: 6 })], step: .15, jit: 6 },
  { name: 'E 原片＋大字跳收尾', cycle: [CLAW_UP, Y_L, CLAW_UP, Y_R], step: .16, jit: 7, end: X_JUMP },
  { name: 'F 舊版（原本的）', rise: BEAR_RISE, cycle: BEAR_CYCLE, step: .12, jit: 9, endFrom: BEAR_D }, // 10/19 使用者要回原本的狗熊
];
// 目前選用的版本：?anim=閃,踢,熊（1–5），沒指定就用預設
const ANIM = { shan: 2, ball: 0, bear: 5 }; // 10/19 使用者選定：閃 C、踢 A、熊用原本的（F）
{ const m = (new URLSearchParams(location.search).get('anim') || '').split(',').map(Number);
  ['shan', 'ball', 'bear'].forEach((k, i) => { if (m[i] >= 1 && m[i] <= [SHAN_V, BALL_V, BEAR_V][i].length) ANIM[k] = m[i] - 1; }); }
const SV = () => SHAN_V[ANIM.shan], BV = () => BALL_V[ANIM.ball];
function bearPose(t, vi = ANIM.bear) {
  const V = BEAR_V[vi], n = V.cycle.length;
  if (t < .25) return lerpPose(N, V.rise || BEAR_GLIDE, ease(t / .25));
  if (t < BEAR.activeEnd) {
    const c = (t - .25) / V.step, i = Math.floor(c) % n, k = c - Math.floor(c);
    const p = Object.assign({}, lerpPose(V.cycle[i], V.cycle[(i + 1) % n], ease(Math.min(1, k * 1.6))));
    const j = Math.sin(t * 95), j2 = Math.cos(t * 77), s = V.jit / 9; // 哆嗦
    p.bA += j * 9 * s; p.fA += j2 * 9 * s; p.bE += j2 * 12 * s; p.fE -= j * 12 * s; p.lean += j * 3 * s; p.head += j2 * 6 * s; p.dy += Math.abs(j) * -4 * s;
    return p;
  }
  const last = V.endFrom || V.cycle[(Math.floor((BEAR.activeEnd - .25) / V.step)) % n], u = (t - BEAR.activeEnd) / .3;
  if (V.end) return u < .4 ? lerpPose(last, V.end, ease(u / .4)) : V.end;
  return lerpPose(last, N, ease(Math.min(1, u)));
}

/* ================= 新招式（B 站 BV1WaaN6BEND p01 安徽花鼓燈、p03 山東鼓子秧歌，逐格分解）=================
   每招：dur 動作長度、cd 冷卻、keys 姿勢關鍵格、ev 時間軸事件（突進／命中／飛行道具／格擋／加成…）
   目前只在沙盒（?sandbox=1）試用，正式對戰還是原本三招 */
const M_T = { bA: -90, bE: 0, fA: 90, fE: 0 };                    // 雙臂平展
const M_V = { bA: -150, bE: -10, fA: 150, fE: 10 };               // 雙手上舉 V
const M_X = { bA: 35, bE: 75, fA: -35, fE: -75 };                 // 雙手胸前交叉
const M_HIP = { bA: -60, bE: 104, fA: 60, fE: -104 };             // 雙手叉腰
const M_LUNGE = { bT: -48, bK: 12, fT: 52, fK: -14 };             // 弓步
const M_LOW = { bK: 30, fK: -30, bT: -8, fT: 8, dy: 14 };          // 微蹲
const mp = (...o) => P(Object.assign({}, ...o));
/* 搖頭晃腦（試作，臉書影片 v=1646899166993838 的鼓子秧歌老師，第 33～45 秒）
   精髓：一手固定在胸前手心朝上當「靶」，另一手從外面甩一大圈、拍回這隻手上「啪」，一拍一放來回，頭跟著左右狂甩；
   嘴裡一直喊「隆咚舞動框」（跟狗熊一樣，喊完招名接一段長吆喝）。
   逐格拆（10 fps，一個循環 0.7 秒）：甩到外上方 → 往下掃 → 經過頭旁 → 拍到胸前那隻手、頭甩到另一邊、身體一沉 → 再甩出去
   側面看：固定的是前手（手肘貼腰、前臂立起、手心在胸口），甩的是後手——從身後甩過來拍到前手上（正面看就是從右甩到左） */
const YT_STANCE = { bT: -58, bK: 32, fT: 58, fK: -32, dy: 20 }; // 比一般馬步更開、更低
const YT_HOLD = { fA: 6, fE: 155 };                              // 前手：手心停在胸口（座標約 46,-74）
const YT_CYCLE = [ // [循環內的比例 0～1, 後手（甩的那隻）＋頭]；後手 52°/71° 時剛好拍到前手的手心
  [0, { bA: -115, bE: 15, head: -26, nod: -4, turn: -8 }],      // 甩到身後上方
  [.28, { bA: -20, bE: 40, head: -14, nod: -2 }],               // 往下、往前掃
  [.55, { bA: 150, bE: 60, head: 6, nod: 2 }],                  // 經過頭旁
  [.72, { bA: 52, bE: 71, head: 32, nod: 8, turn: 8, dy: 24 }], // 啪！拍到手上，頭甩到另一邊、身體一沉
  [.86, { bA: 58, bE: 78, head: 22, nod: 4, dy: 22 }],          // 黏住一下再甩出去
];
const YT_CLAP = .72;
// c：一個循環幾秒（遊戲裡比原片快）；n：拍幾下。回傳 keys、整招時間、每一下「拍到手」的時間
function ytBuild(c, n, extra = {}) {
  const keys = [[0, N], [.1, mp(YT_STANCE, YT_HOLD, { bA: 52, bE: 71 }, extra)]], claps = [];
  for (let i = 0; i < n; i++) {
    const t0 = .12 + i * c;
    for (const [u, p] of YT_CYCLE) keys.push([+(t0 + u * c).toFixed(3), mp(YT_STANCE, YT_HOLD, p, extra)]);
    claps.push(+(t0 + YT_CLAP * c).toFixed(3));
  }
  const end = .12 + n * c;
  keys.push([+end.toFixed(3), mp(YT_STANCE, YT_HOLD, { bA: 90, bE: 0, head: -12 }, extra)], [+(end + .25).toFixed(3), N]); // 收尾：手往前甩出去停住
  return { keys, dur: +(end + .25).toFixed(3), claps, end };
}
// 定案方向：「越晃越快」那版（邊甩邊往前逼）＋拍手。吆喝 8.5 秒，從 1.4 秒開始喊，整段唸完是 9.9 秒
// 長時間試作 3 版：招越長、每拍越輕；每拍暈 0.15 秒（比拍的間隔 0.38 秒短），被拍的人中間有空檔可以閃開，不會被鎖死
function YAOTOU_VERSIONS() {
  const mk = (id, name, n, vx, dmg, last, cd, desc) => {
    const b = ytBuild(.38, n);
    return [id, { name, cd, dur: b.dur, keys: b.keys, jit: 3, voices: ['yaotou'], demo: true, desc,
      ev: [{ at: .12, to: b.end, vx }, { at: 1.4, chant: 'mv_yaotou_chant' }, // 「搖頭晃腦」喊完（1.45 秒）再接吆喝
        ...b.claps.map(at => ({ at, sfx: 'clap', hit: { x0: 0, x1: 135, dmg, stun: .15, kb: 40 } })),
        { at: b.end, hit: { x0: 0, x1: 160, dmg: last, stun: .3, kb: 500 } }] }];
  };
  // 定案：唸完版（吆喝整段唸完才停，約 10 秒），冷卻 4 秒（2026-10-30）
  return Object.fromEntries([
    mk('yaotou', '搖頭晃腦', 25, 70, 1, 6, 4, '大馬步一手當靶、一手甩一大圈拍回來「啪」，頭跟著狂甩，慢慢往前逼，吆喝整段唸完才停（約 10 秒）；拍 25 下、每下 1，最後推開'),
  ]);
}
/* 蔡徐坤（試作，B 站 BV18T411y7M5 練習生自我介紹，前 50 秒逐格拆）
   胯下運球：13～23 秒那段壓低運球、胯下換手；雞你太美：22.4～32.6 秒原片 BGM「只因你太美 baby」整段跳完，動作照原片的秒數排 */
const CXD = { bT: -34, bK: 38, fT: 38, fK: -42, dy: 16, lean: 12, head: 6 }; // 壓低運球的蹲姿
const CXW = { bT: -40, bK: 30, fT: 40, fK: -30, dy: 18 };                    // 大開腿站
function drawBasketball(x, y, r = 16, spin = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(spin);
  ctx.fillStyle = '#e8742a'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.strokeStyle = '#3a1d0c'; ctx.lineWidth = 1.6; ctx.beginPath();
  ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r);
  ctx.moveTo(-r * .62, -r * .78); ctx.quadraticCurveTo(-r * .2, 0, -r * .62, r * .78);
  ctx.moveTo(r * .62, -r * .78); ctx.quadraticCurveTo(r * .2, 0, r * .62, r * .78); ctx.stroke();
  ctx.restore();
}
// 招式進行中手上那顆籃球：d＝drawFighter 回傳的骨架位置，回傳球心（null＝球不在手上）
function cxkHands(ft, d) { const hf = [d.x + d.sk.haF[0], d.baseY + d.sk.haF[1]], hb = [d.x + d.sk.haB[0], d.baseY + d.sk.haB[1]]; return { hf, hb, floor: GROUND - ft.y - 14 }; }
const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
/* 胯下運球：原片 13.6～21.4 秒整段運球，tools/pose 每 0.1 秒從原片抓的骨架（動作研究/角色/cxk_full）。
   壓低運球、左右換手、胯下過、球在肩上滾，最後胸前傳球把球砸出去 */
const KX0 = 13.6, KX = v => +(.1 + v - KX0).toFixed(2); // 原片秒數 → 招式時間（先用 0.1 秒從站姿接進去）；BGM cxk_dribble.mp3 從原片 13.5 秒剪起，跟這個對齊
const KX_POSE = [
  [13.6, { lean: 3, head: -16, bA: -63, bE: -25, fA: 48, fE: 164, bT: -18, bK: 38, fT: 6, fK: -7, tl: 0.99 }],
  [13.7, { lean: -1, head: -7, bA: -72, bE: -25, fA: 70, fE: 182, bT: -21, bK: 44, fT: 7, fK: -3, tl: 0.93 }],
  [13.8, { lean: -11, head: 1, bA: -46, bE: 2, fA: 39, fE: 7, bT: -31, bK: 57, fT: -6, fK: 29, tl: 0.8 }],
  [13.9, { lean: -6, head: 4, bA: -15, bE: 5, fA: 20, fE: -11, bT: -30, bK: 72, fT: -3, fK: 4, tl: 0.65 }],
  [14.0, { lean: 7, head: 0, bA: -6, bE: 2, fA: -7, fE: 2, bT: -17, bK: 66, fT: -30, fK: 41, tl: 0.59 }],
  [14.1, { lean: 20, head: -8, bA: -21, bE: 8, fA: -21, fE: 26, bT: -10, bK: 60, fT: -17, fK: 28, tl: 0.61 }],
  [14.2, { lean: 26, head: -4, bA: -39, bE: 7, fA: -11, fE: 31, bT: -7, bK: 44, fT: 0, fK: 6, tl: 0.68 }],
  [14.3, { lean: 26, head: -4, bA: -59, bE: 7, fA: 13, fE: 16, bT: -2, bK: 12, fT: 15, fK: -16, tl: 0.74 }],
  [14.4, { lean: 26, head: -9, bA: -67, bE: 1, fA: 31, fE: 6, bT: 4, bK: -16, fT: 24, fK: -33, tl: 0.78 }],
  [14.5, { lean: 22, head: 2, bA: -72, bE: 5, fA: 27, fE: 10, bT: 7, bK: -28, fT: 35, fK: -53, tl: 0.76 }],
  [14.6, { lean: 6, head: 2, bA: -35, bE: 10, fA: 4, fE: 19, bT: 7, bK: -22, fT: 27, fK: -52, tl: 0.7 }],
  [14.7, { lean: 3, head: -2, bA: -21, bE: 12, fA: 3, fE: 2, bT: 6, bK: -14, fT: 24, fK: -48, tl: 0.64 }],
  [14.8, { lean: -17, head: -10, bA: 15, bE: -7, fA: 20, fE: 0, bT: 9, bK: -19, fT: 11, fK: -38, tl: 0.64 }],
  [14.9, { lean: -23, head: -11, bA: 6, bE: -26, fA: 45, fE: -11, bT: -2, bK: -8, fT: 12, fK: -69, tl: 0.69 }],
  [15.0, { lean: -21, head: -12, bA: -23, bE: -16, fA: 57, fE: -34, bT: -8, bK: 3, fT: 11, fK: -31, tl: 0.77 }],
  [15.1, { lean: -20, head: -6, bA: -37, bE: -11, fA: 64, fE: -70, bT: -9, bK: 14, fT: 15, fK: -45, tl: 0.87 }],
  [15.2, { lean: -19, head: -2, bA: -48, bE: -14, fA: 74, fE: -144, bT: -14, bK: 32, fT: 11, fK: -22, tl: 0.94 }],
  [15.3, { lean: -20, head: 0, bA: -52, bE: -13, fA: 97, fE: -15, bT: -15, bK: 38, fT: -4, fK: 49, tl: 0.97 }],
  [15.4, { lean: -20, head: 0, bA: -32, bE: -24, fA: 77, fE: -16, bT: -24, bK: 54, fT: -5, fK: 26, tl: 0.95 }],
  [15.5, { lean: -9, head: -2, bA: -14, bE: -19, fA: 29, fE: -2, bT: -30, bK: 64, fT: 4, fK: 0, tl: 0.89 }],
  [15.6, { lean: 4, head: -3, bA: -8, bE: 5, fA: -1, fE: -7, bT: -17, bK: 39, fT: -7, fK: 11, tl: 0.83 }],
  [15.7, { lean: 7, head: -2, bA: -8, bE: 5, fA: -6, fE: -5, bT: -16, bK: 85, fT: -19, fK: 24, tl: 0.78 }],
  [15.8, { lean: 20, head: -10, bA: -26, bE: 2, fA: -15, fE: 27, bT: -12, bK: 85, fT: -16, fK: 32, tl: 0.77 }],
  [15.9, { lean: 25, head: -8, bA: -45, bE: 13, fA: -8, fE: 37, bT: -9, bK: 22, fT: 5, fK: 2, tl: 0.77 }],
  [16.0, { lean: 19, head: -3, bA: -40, bE: 7, fA: -15, fE: 46, bT: -2, bK: -3, fT: 13, fK: -14, tl: 0.78 }],
  [16.1, { lean: 12, head: -3, bA: -28, bE: 10, fA: -17, fE: 13, bT: 6, bK: -23, fT: 19, fK: -37, tl: 0.77 }],
  [16.2, { lean: 10, head: -11, bA: -22, bE: 3, fA: -23, fE: 1, bT: 19, bK: -47, fT: 12, fK: -33, tl: 0.74 }],
  [16.3, { lean: 14, head: -10, bA: -45, bE: -7, fA: -26, fE: 0, bT: 26, bK: -50, fT: 25, fK: -48, tl: 0.71 }],
  [16.4, { lean: 14, head: -8, bA: -65, bE: -1, fA: -19, fE: 8, bT: 24, bK: -38, fT: 22, fK: -49, tl: 0.72 }],
  [16.5, { lean: -7, head: -14, bA: -40, bE: -49, fA: 33, fE: -9, bT: 16, bK: -17, fT: 6, fK: -46, tl: 0.76 }],
  [16.6, { lean: -15, head: -16, bA: -2, bE: -127, fA: 64, fE: -20, bT: 14, bK: -15, fT: 8, fK: -95, tl: 0.81 }],
  [16.7, { lean: -14, head: -17, bA: -4, bE: -40, fA: 65, fE: -21, bT: 14, bK: -18, fT: 11, fK: -86, tl: 0.83 }],
  [16.8, { lean: -11, head: -16, bA: -7, bE: -1, fA: 65, fE: -9, bT: 11, bK: -11, fT: 13, fK: -77, tl: 0.84 }],
  [16.9, { lean: -4, head: -13, bA: -14, bE: -10, fA: 55, fE: 21, bT: 11, bK: -9, fT: 14, fK: -65, tl: 0.85 }],
  [17.0, { lean: 2, head: -12, bA: -20, bE: -28, fA: 48, fE: 132, bT: 1, bK: 8, fT: 13, fK: -43, tl: 0.87 }],
  [17.1, { lean: 3, head: -10, bA: -22, bE: -32, fA: 36, fE: 154, bT: -6, bK: 19, fT: 13, fK: -40, tl: 0.92 }],
  [17.2, { lean: 2, head: -10, bA: -24, bE: -42, fA: 27, fE: 172, bT: -12, bK: 32, fT: 10, fK: -25, tl: 0.96 }],
  [17.3, { lean: -3, head: -12, bA: -60, bE: -45, fA: 67, fE: 161, bT: -18, bK: 44, fT: 1, fK: 21, tl: 1.0 }],
  [17.4, { lean: -10, head: -7, bA: -68, bE: -24, fA: 87, fE: -36, bT: -27, bK: 54, fT: -2, fK: 44, tl: 0.92 }],
  [17.5, { lean: -13, head: -1, bA: -40, bE: -9, fA: 46, fE: -9, bT: -35, bK: 68, fT: -8, fK: 20, tl: 0.83 }],
  [17.6, { lean: 0, head: 4, bA: -17, bE: -5, fA: 9, fE: -16, bT: -35, bK: 81, fT: -1, fK: -2, tl: 0.74 }],
  [17.7, { lean: 3, head: 1, bA: -14, bE: 6, fA: -3, fE: -6, bT: -20, bK: 105, fT: -17, fK: 16, tl: 0.72 }],
  [17.8, { lean: 13, head: -3, bA: -16, bE: -1, fA: -19, fE: 13, bT: -13, bK: 50, fT: -24, fK: 28, tl: 0.73 }],
  [17.9, { lean: 24, head: -13, bA: -36, bE: 5, fA: -5, fE: 17, bT: -11, bK: 49, fT: -6, fK: 11, tl: 0.76 }],
  [18.0, { lean: 19, head: -7, bA: -46, bE: 2, fA: 27, fE: 12, bT: -6, bK: 25, fT: 10, fK: -13, tl: 0.82 }],
  [18.1, { lean: 17, head: -7, bA: -55, bE: -2, fA: 45, fE: 11, bT: -2, bK: 10, fT: 16, fK: -21, tl: 0.88 }],
  [18.2, { lean: 13, head: 2, bA: -62, bE: 0, fA: 53, fE: 15, bT: -2, bK: 6, fT: 19, fK: -25, tl: 0.88 }],
  [18.3, { lean: 10, head: 2, bA: -52, bE: 7, fA: 32, fE: 14, bT: 5, bK: -10, fT: 29, fK: -44, tl: 0.84 }],
  [18.4, { lean: 2, head: 1, bA: -25, bE: 8, fA: 19, fE: 9, bT: 6, bK: -12, fT: 29, fK: -53, tl: 0.75 }],
  [18.5, { lean: -13, head: -1, bA: 12, bE: -1, fA: 16, fE: -4, bT: 14, bK: -23, fT: 13, fK: -69, tl: 0.72 }],
  [18.6, { lean: -12, head: -8, bA: 3, bE: -15, fA: 21, fE: -7, bT: 26, bK: -39, fT: 20, fK: -96, tl: 0.72 }],
  [18.7, { lean: -12, head: -7, bA: -7, bE: -12, fA: 26, fE: -10, bT: 25, bK: -40, fT: 22, fK: -90, tl: 0.77 }],
  [18.8, { lean: -9, head: -4, bA: -27, bE: -37, fA: 40, fE: -19, bT: -3, bK: 0, fT: 16, fK: -43, tl: 0.83 }],
  [18.9, { lean: 0, head: -7, bA: -56, bE: -32, fA: 36, fE: -12, bT: -7, bK: 15, fT: 21, fK: -33, tl: 0.88 }],
  [19.0, { lean: 4, head: -8, bA: -81, bE: -53, fA: 33, fE: -189, bT: -17, bK: 39, fT: 16, fK: 1, tl: 0.91 }],
  [19.1, { lean: 3, head: -6, bA: -76, bE: -76, fA: 31, fE: -190, bT: -14, bK: 34, fT: 18, fK: 8, tl: 0.9 }],
  [19.2, { lean: 1, head: -11, bA: -33, bE: -105, fA: 18, fE: -170, bT: -11, bK: 30, fT: 11, fK: 17, tl: 0.88 }],
  [19.3, { lean: -6, head: -12, bA: -7, bE: -6, fA: 21, fE: -62, bT: -11, bK: 28, fT: 6, fK: 0, tl: 0.86 }],
  [19.4, { lean: -9, head: -12, bA: 4, bE: 4, fA: 36, fE: -41, bT: -10, bK: 24, fT: 4, fK: -4, tl: 0.81 }],
  [19.5, { lean: -9, head: -16, bA: -1, bE: -9, fA: 39, fE: 21, bT: -11, bK: 30, fT: -3, fK: -2, tl: 0.79 }],
  [19.6, { lean: -2, head: -7, bA: -20, bE: -18, fA: 51, fE: 10, bT: -8, bK: 28, fT: 2, fK: -5, tl: 0.78 }],
  [19.7, { lean: 1, head: -6, bA: -27, bE: -19, fA: 45, fE: 12, bT: -7, bK: 26, fT: 5, fK: -8, tl: 0.83 }],
  [19.8, { lean: 4, head: -6, bA: -33, bE: 0, fA: 14, fE: 11, bT: -10, bK: 31, fT: 11, fK: -19, tl: 0.86 }],
  [19.9, { lean: 5, head: -6, bA: -21, bE: 61, fA: -1, fE: -54, bT: -13, bK: 27, fT: 13, fK: -23, tl: 0.89 }],
  [20.0, { lean: 0, head: -6, bA: -18, bE: 111, fA: 1, fE: -92, bT: -17, bK: 15, fT: 10, fK: -11, tl: 0.9 }],
  [20.1, { lean: -1, head: -6, bA: -26, bE: 150, fA: -10, fE: -86, bT: -16, bK: 10, fT: 11, fK: -10, tl: 0.94 }],
  [20.2, { lean: -1, head: -5, bA: -26, bE: 198, fA: 3, fE: -161, bT: -14, bK: 10, fT: 15, fK: -15, tl: 0.96 }],
  [20.3, { lean: 4, head: -7, bA: -49, bE: -76, fA: -1, fE: -1, bT: -11, bK: 4, fT: 14, fK: -13, tl: 0.99 }],
  [20.4, { lean: 5, head: -1, bA: -69, bE: -57, fA: 2, fE: 20, bT: -10, bK: 2, fT: 12, fK: -10, tl: 0.99 }],
  [20.5, { lean: 2, head: 9, bA: -105, bE: 65, fA: 11, fE: 24, bT: -9, bK: 2, fT: 11, fK: -6, tl: 1.0 }],
  [20.6, { lean: 3, head: 9, bA: -83, bE: 43, fA: 4, fE: 34, bT: -8, bK: 1, fT: 12, fK: -3, tl: 0.99 }],
  [20.7, { lean: 4, head: 7, bA: -74, bE: 35, fA: -4, fE: 43, bT: -8, bK: 1, fT: 13, fK: -3, tl: 0.97 }],
  [20.8, { lean: 6, head: 7, bA: -45, bE: 16, fA: -19, fE: 112, bT: -10, bK: 4, fT: 14, fK: -2, tl: 0.95 }],
  [20.9, { lean: 5, head: -1, bA: -22, bE: 8, fA: 5, fE: 132, bT: -13, bK: 6, fT: 16, fK: -3, tl: 0.94 }],
  [21.0, { lean: 8, head: 0, bA: -23, bE: 43, fA: -5, fE: 36, bT: -21, bK: 15, fT: 15, fK: -2, tl: 0.93 }],
  [21.1, { lean: 11, head: -3, bA: -19, bE: 50, fA: -19, fE: -2, bT: -22, bK: 16, fT: 13, fK: -1, tl: 0.9 }],
  [21.2, { lean: 12, head: -8, bA: -36, bE: 26, fA: -19, fE: -42, bT: -21, bK: 23, fT: 12, fK: -2, tl: 0.88 }],
  [21.3, { lean: 7, head: -13, bA: -34, bE: -52, fA: -19, fE: -89, bT: -21, bK: 35, fT: 14, fK: 0, tl: 0.88 }],
  [21.4, { lean: 1, head: -14, bA: -30, bE: -75, fA: 2, fE: -101, bT: -24, bK: 43, fT: 11, fK: 12, tl: 0.88 }],
];
const KX_BALL = [[13.6, -55, -48], [13.7, -59, -51], [13.8, -82, -25], [13.9, -50, 41], [14.0, 24, 86], [14.1, 56, 62], [14.2, 71, 38], [14.3, 91, 17], [14.4, 100, 1], [14.5, 93, 5], [14.6, 54, 49], [14.7, 40, 77], [14.8, -42, 69], [14.9, -88, 22], [15.0, -109, -6], [15.1, -114, -20], [15.2, -104, -33], [15.3, -105, -35], [15.4, -101, -13], [15.5, -77, 31], [15.6, -15, 86], [15.7, 1, 89], [15.8, 59, 41], [15.9, 81, 23], [16.0, 72, 26], [16.1, 32, 62], [16.2, -13, 105], [16.3, -59, 51], [16.4, -76, 23], [16.5, -75, -29], [16.6, -71, -25], [16.7, -73, -10], [16.8, -77, 66], [16.9, -77, 71], [17.0, -74, 18], [17.1, -68, -2], [17.2, -67, -27], [17.3, -73, -56], [17.4, -81, -55], [17.5, -87, -9], [17.6, -44, 45], [17.7, -28, 62], [17.8, 34, 61], [17.9, 72, 18], [18.0, 83, -7], [18.1, 90, -24], [18.2, 89, -33], [18.3, 84, -1], [18.4, 55, 43], [18.5, -4, 96], [18.6, -59, 28], [18.7, -69, 8], [18.8, -85, -24], [18.9, -80, -51], [19.0, -67, -76], [19.1, -56, -80], [19.2, -49, -62], [19.3, -45, -16], [19.4, -46, 32], [19.5, -58, 93], [19.6, -61, 16], [19.7, -58, 2], [19.8, -35, -15], [19.9, -5, -19], [20.0, -12, -38], [20.1, -21, -53], [20.2, -20, -69], [20.3, -30, -90], [20.4, -37, -90], [20.5, -27, -97], [20.6, -7, -101], [20.7, 0, -102], [20.8, 18, -92], [20.9, 33, -60], [21.0, 31, -32], [21.1, 22, -10], [21.2, -6, -5], [21.3, -45, -40], [21.4, -56, -44]];
const KX_BOUNCE = [14.0, 14.7, 15.7, 16.2, 16.9, 17.7, 18.5, 19.5]; // 球拍到地上的時間（原片秒數），每拍一下打一下
// 照表補間的球：B＝[[原片秒數, x, y]]（相對髖部、角色面向右），T＝原片秒數→招式時間，gone＝招式時間過了這個球就不在手上
function tableBall(B, T, gone) {
  return (ft, d, t) => {
    const at = (x, y) => [d.x + x * ft.face, d.baseY + y];
    if (t >= gone) return null;
    if (t <= T(B[0][0])) return at(B[0][1], B[0][2]);
    for (let i = 0; i < B.length - 1; i++) {
      const [t0, x0, y0] = B[i], [t1, x1, y1] = B[i + 1];
      if (t <= T(t1)) { const k = (t - T(t0)) / (T(t1) - T(t0)); return at(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k); }
    }
    return at(B[B.length - 1][1], B[B.length - 1][2]);
  };
}
const kuaxiaBall = tableBall(KX_BALL, KX, KX(21.4) + .12);
const JN0 = 22.4, JN = v => +(.6 + v - JN0).toFixed(2); // 原片秒數 → 招式時間（喊完「music」0.6 秒後 BGM 才進來）
// 雞你太美的球：tools/pose/track_ball.py 從原片抓的球心（相對髖部、角色面向右）。22.6 拍到地上、23.4～23.8 在指尖上轉，24.0 甩出去
const JNTM_BALL = [[22.4, -48, -33], [22.6, -74, 104], [22.8, -78, 45], [23.0, -30, -15], [23.2, -36, -59], [23.4, -50, -99], [23.6, -62, -86], [23.8, -75, -74]];
function jntmBall(ft, d, t) {
  const B = JNTM_BALL, at = (x, y) => [d.x + x * ft.face, d.baseY + y];
  if (t <= JN(B[0][0])) return at(B[0][1], B[0][2]);
  for (let i = 0; i < B.length - 1; i++) {
    const [t0, x0, y0] = B[i], [t1, x1, y1] = B[i + 1];
    if (t <= JN(t1)) { const k = (t - JN(t0)) / (JN(t1) - JN(t0)); return at(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k); }
  }
  return t < JN(23.9) ? at(B[B.length - 1][1], B[B.length - 1][2]) : null;
}
// 雞你太美逐格骨架：原片 22.4～32.6 秒每 0.2 秒，tools/pose 從原片抓出來的（extract_pose.py → to_keys.py），back:1＝背對鏡頭
const JNTM_POSE = [
  [22.4, { lean: -11, head: 5, bA: -5, bE: -101, fA: 55, fE: 46, bT: 21, bK: -39, fT: 11, fK: -27, tl: 0.81 }],
  [22.6, { lean: -20, head: -14, bA: 10, bE: -6, fA: 67, fE: -47, bT: -4, bK: 5, fT: 11, fK: -22, slip: 1, tl: 0.77 }],
  [22.8, { lean: -22, head: -12, bA: 10, bE: -19, fA: 66, fE: -53, bT: -3, bK: 2, fT: 12, fK: -12, slip: 1, tl: 0.76 }],
  [23.0, { lean: -14, head: -2, bA: 4, bE: 39, fA: 21, fE: -50, bT: -2, bK: 3, fT: 11, fK: -11, slip: 1, tl: 0.83 }],
  [23.2, { lean: -9, head: 1, bA: -16, bE: 168, fA: 5, fE: -107, bT: -3, bK: 3, fT: 8, fK: -8, tl: 0.92 }],
  [23.4, { lean: -3, head: -2, bA: -28, bE: -102, fA: 26, fE: -49, bT: -6, bK: 4, fT: 5, fK: -5, tl: 0.95 }],
  [23.6, { lean: -3, head: -7, bA: -10, bE: -115, fA: 24, fE: 18, bT: -5, bK: 3, fT: 5, fK: -5, tl: 0.98 }],
  [23.8, { lean: -5, head: -9, bA: -4, bE: -116, fA: 30, fE: 26, bT: -3, bK: 5, fT: 6, fK: -2, tl: 0.99 }],
  [24.0, { lean: -5, head: -8, bA: -110, bE: -16, fA: 71, fE: 55, bT: -1, bK: 0, fT: 8, fK: -27, tl: 0.99 }],
  [24.2, { lean: -5, head: -3, bA: -127, bE: -86, fA: 79, fE: 112, bT: 1, bK: 1, fT: -1, fK: -25, tl: 1.0 }],
  [24.4, { lean: -5, head: 35, bA: -105, bE: -93, fA: 65, fE: 128, bT: 2, bK: -7, fT: 1, fK: -28, tl: 0.98 }],
  [24.6, { lean: 1, head: 20, bA: -7, bE: 30, fA: 51, fE: 129, bT: 9, bK: -26, fT: 27, fK: -84, back: 1, tl: 0.96 }],
  [24.8, { lean: -1, head: 20, bA: -18, bE: 71, fA: 3, fE: -56, bT: -5, bK: -2, fT: 36, fK: -138, back: 1, tl: 0.94 }],
  [25.0, { lean: 8, head: 20, bA: -32, bE: 66, fA: -21, fE: -32, bT: -23, bK: 18, fT: 23, fK: 0, back: 1, tl: 0.95 }],
  [25.2, { lean: 6, head: 20, bA: -33, bE: 65, fA: -5, fE: -84, bT: -30, bK: 17, fT: 28, fK: -12, back: 1, slip: 1, tl: 0.92 }],
  [25.4, { lean: 7, head: 20, bA: -46, bE: 76, fA: -5, fE: -66, bT: -37, bK: 28, fT: 32, fK: -15, back: 1, slip: 1, tl: 0.87 }],
  [25.6, { lean: 16, head: 20, bA: -62, bE: 79, fA: -20, fE: -78, bT: -48, bK: 38, fT: 35, fK: -20, back: 1, slip: 1, tl: 0.81 }],
  [25.8, { lean: 7, head: 20, bA: -38, bE: 63, fA: -1, fE: -84, bT: -39, bK: 32, fT: 37, fK: -24, back: 1, slip: 1, tl: 0.85 }],
  [26.0, { lean: 12, head: 20, bA: -50, bE: 69, fA: -36, fE: -32, bT: -25, bK: 9, fT: 25, fK: -10, back: 1, slip: 1, tl: 0.9 }],
  [26.2, { lean: 14, head: 20, bA: -50, bE: 55, fA: -21, fE: -72, bT: -25, bK: 5, fT: 21, fK: -10, back: 1, slip: 1, tl: 0.95 }],
  [26.4, { lean: 9, head: 20, bA: -47, bE: 78, fA: -13, fE: -87, bT: -29, bK: 14, fT: 31, fK: -25, back: 1, slip: 1, tl: 0.89 }],
  [26.6, { lean: 17, head: 20, bA: -59, bE: 70, fA: -27, fE: -48, bT: -33, bK: 17, fT: 39, fK: -36, back: 1, slip: 1, tl: 0.87 }],
  [26.8, { lean: 19, head: 20, bA: -82, bE: 89, fA: -40, fE: -6, bT: -20, bK: -5, fT: 32, fK: -48, back: 1, slip: 1, tl: 0.9 }],
  [27.0, { lean: 12, head: 20, bA: -85, bE: 171, fA: -3, fE: -4, bT: 31, bK: -34, fT: 1, fK: -20, back: 1, slip: 1, tl: 0.94 }],
  [27.2, { lean: 20, head: 20, bA: -89, bE: 147, fA: -19, fE: 31, bT: 25, bK: -33, fT: 17, fK: -33, back: 1, slip: 1, tl: 0.94 }],
  [27.4, { lean: 8, head: 14, bA: -81, bE: 107, fA: 25, fE: 22, bT: 10, bK: -20, fT: 4, fK: -14, slip: 1, tl: 0.92 }],
  [27.6, { lean: 0, head: -3, bA: -80, bE: -36, fA: 43, fE: 37, bT: 1, bK: -8, fT: -2, fK: -12, slip: 1, tl: 0.94 }],
  [27.8, { lean: -3, head: -13, bA: -37, bE: -25, fA: 3, fE: -48, bT: -3, bK: -3, fT: -5, fK: -10, slip: 1, tl: 0.97 }],
  [28.0, { lean: -8, head: -8, bA: 17, bE: -10, fA: -7, fE: -22, bT: -4, bK: -4, fT: 0, fK: -17, slip: 1, tl: 0.99 }],
  [28.2, { lean: -7, head: 1, bA: 14, bE: 7, fA: -4, fE: -37, bT: -2, bK: -4, fT: 5, fK: -25, slip: 1, tl: 0.98 }],
  [28.4, { lean: 0, head: 6, bA: -19, bE: 13, fA: 10, fE: -30, bT: 3, bK: -14, fT: 7, fK: -28, slip: 1, tl: 0.97 }],
  [28.6, { lean: 8, head: -2, bA: -31, bE: 15, fA: 2, fE: 0, bT: 0, bK: -9, fT: 5, fK: -24, slip: 1, tl: 0.93 }],
  [28.8, { lean: 10, head: -6, bA: -21, bE: 5, fA: -15, fE: -3, bT: 11, bK: -25, fT: 22, fK: -53, slip: 1, tl: 0.94 }],
  [29.0, { lean: 0, head: 9, bA: -43, bE: -43, fA: 19, fE: 39, bT: 11, bK: -27, fT: 14, fK: -47, slip: 1, tl: 0.95 }],
  [29.2, { lean: 5, head: 1, bA: -99, bE: -87, fA: 94, fE: 88, bT: 59, bK: -129, fT: 31, fK: -143, dy: -118, slip: 1, tl: 0.98 }],
  [29.4, { lean: 1, head: -9, bA: -81, bE: -57, fA: 26, fE: 98, bT: 31, bK: -27, fT: -10, fK: -8, slip: 1, tl: 0.92 }],
  [29.6, { lean: -12, head: -2, bA: 44, bE: 80, fA: 4, fE: -63, bT: 14, bK: -3, fT: -6, fK: -46, slip: 1, tl: 0.84 }],
  [29.8, { lean: -17, head: -9, bA: 21, bE: 88, fA: 40, fE: -43, bT: 9, bK: -6, fT: -12, fK: -34, slip: 1, tl: 0.73 }],
  [30.0, { lean: -9, head: 22, bA: 7, bE: 1, fA: 26, fE: 6, bT: 10, bK: -4, fT: 0, fK: -23, slip: 1, tl: 0.65 }],
  [30.2, { lean: 10, head: 19, bA: -30, bE: 34, fA: -21, fE: 2, bT: 11, bK: -4, fT: 15, fK: -14, slip: 1, tl: 0.64 }],
  [30.4, { lean: 13, head: 14, bA: -45, bE: 46, fA: -43, fE: -4, bT: 12, bK: -7, fT: 13, fK: -11, slip: 1, tl: 0.68 }],
  [30.6, { lean: 7, head: -18, bA: -23, bE: 9, fA: -17, fE: -25, bT: 2, bK: -3, fT: 5, fK: -1, slip: 1, tl: 0.74 }],
  [30.8, { lean: 3, head: -21, bA: -14, bE: -1, fA: 15, fE: -35, bT: -26, bK: 33, fT: 2, fK: 7, slip: 1, tl: 0.79 }],
  [31.0, { lean: -7, head: 4, bA: 1, bE: 0, fA: 16, fE: 9, bT: -24, bK: 18, fT: 19, fK: -22, slip: 1, tl: 0.82 }],
  [31.2, { lean: 3, head: -4, bA: -6, bE: -42, fA: 18, fE: -13, bT: -25, bK: 21, fT: 23, fK: -18, slip: 1, tl: 0.87 }],
  [31.4, { lean: 1, head: -9, bA: -70, bE: -88, fA: 64, fE: 51, bT: -24, bK: 17, fT: 28, fK: -16, tl: 0.92 }],
  [31.6, { lean: 2, head: -8, bA: -11, bE: 102, fA: -25, fE: -46, bT: -20, bK: 14, fT: 25, fK: -1, tl: 0.93 }],
  [31.8, { lean: 8, head: -18, bA: -27, bE: 133, fA: -35, fE: 3, bT: -24, bK: 17, fT: 21, fK: -9, tl: 0.94 }],
  [32.0, { lean: -13, head: -13, bA: 53, bE: 92, fA: 48, fE: 11, bT: -22, bK: 14, fT: 28, fK: 1, tl: 0.95 }],
  [32.2, { lean: 2, head: -5, bA: -55, bE: 146, fA: 51, fE: 15, bT: -25, bK: 7, fT: 25, fK: -11, tl: 0.97 }],
  [32.4, { lean: -2, head: -6, bA: -97, bE: 192, fA: 64, fE: -7, bT: -20, bK: 6, fT: 23, fK: -7, tl: 0.99 }],
  [32.6, { lean: -9, head: 8, bA: -118, bE: -18, fA: 47, fE: -78, bT: -9, bK: -7, fT: 36, fK: -20, tl: 1.0 }],
];
/* 蠢蠢欲動：原片 32.6～41.0 秒（雞你太美後面那段舞，招式總長壓在 9 秒；原片抓到 48.4，後面那段先不用），tools/pose 每 0.1 秒抓的骨架（動作研究/角色/cxk_dance2）。
   蹲低、原地跳、手指天、遮臉扭、高踢腿收尾；吊帶這段都沒掉 */
const D2 = v => +(.1 + v - 32.6).toFixed(2); // 原片秒數 → 招式時間；BGM cxk_dance2.mp3 從原片 32.5 秒剪起
const D2_POSE = [
  [32.6, { lean: -9, head: 8, bA: -118, bE: -18, fA: 47, fE: -78, bT: -9, bK: -7, fT: 36, fK: -20, tl: 1 }],
  [32.7, { lean: -8, head: 5, bA: -119, bE: -25, fA: 46, fE: -87, bT: -12, bK: -2, fT: 34, fK: -29, tl: 0.99 }],
  [32.8, { lean: -3, head: -3, bA: -168, bE: -43, fA: 42, fE: -83, bT: -22, bK: 3, fT: 29, fK: -38, tl: 0.93 }],
  [32.9, { lean: 10, head: 4, bA: -71, bE: 155, fA: 8, fE: -58, bT: -38, bK: 7, fT: 33, fK: -44, tl: 0.77 }],
  [33.0, { lean: 19, head: 7, bA: -14, bE: 7, fA: 105, fE: -157, bT: -39, bK: -9, fT: 42, fK: -56, tl: 0.64 }],
  [33.1, { lean: 22, head: 27, bA: 6, bE: 24, fA: -2, fE: -56, bT: -40, bK: -13, fT: 52, fK: -59, tl: 0.56 }],
  [33.2, { lean: 21, head: 29, bA: 12, bE: 29, fA: 41, fE: -44, bT: -39, bK: -19, fT: 57, fK: -65, tl: 0.59 }],
  [33.3, { lean: 7, head: -12, bA: 25, bE: -3, fA: -17, fE: -17, bT: -47, bK: 1, fT: 60, fK: -85, tl: 0.58 }],
  [33.4, { lean: 9, head: 4, bA: -25, bE: 3, fA: -37, fE: -7, bT: -38, bK: -4, fT: 50, fK: -62, tl: 0.57 }],
  [33.5, { lean: 10, head: 0, bA: -57, bE: -173, fA: -24, fE: -23, bT: -40, bK: 13, fT: 45, fK: -60, tl: 0.54 }],
  [33.6, { lean: 8, head: -2, bA: -20, bE: 25, fA: -20, fE: -88, bT: -65, bK: 56, fT: 37, fK: -38, tl: 0.55 }],
  [33.7, { lean: 14, head: -14, bA: -22, bE: 21, fA: -31, fE: -93, bT: -39, bK: 36, fT: 42, fK: -39, tl: 0.55 }],
  [33.8, { lean: 3, head: 3, bA: -28, bE: 43, fA: 18, fE: -127, bT: -29, bK: 17, fT: 24, fK: -20, tl: 0.63 }],
  [33.9, { lean: 5, head: -5, bA: -31, bE: 2, fA: 0, fE: 32, bT: -19, bK: 7, fT: 16, fK: -4, tl: 0.69 }],
  [34.0, { lean: 4, head: -17, bA: -14, bE: -5, fA: -8, fE: -18, bT: -31, bK: 83, fT: 23, fK: -61, dy: -107, tl: 0.74 }],
  [34.1, { lean: 3, head: -17, bA: -11, bE: -9, fA: 0, fE: -12, bT: -38, bK: 158, fT: 30, fK: -141, dy: -160, tl: 0.73 }],
  [34.2, { lean: 5, head: -25, bA: -22, bE: -7, fA: 9, fE: -15, bT: -37, bK: 136, fT: 26, fK: -87, dy: -129, tl: 0.76 }],
  [34.3, { lean: 2, head: -25, bA: -31, bE: 8, fA: 26, fE: -20, bT: -34, bK: 56, fT: 11, fK: -24, dy: -56, tl: 0.8 }],
  [34.4, { lean: 1, head: -24, bA: -31, bE: 23, fA: 16, fE: -14, bT: -29, bK: 30, fT: 3, fK: -2, tl: 0.81 }],
  [34.5, { lean: -5, head: -7, bA: 9, bE: 0, fA: -8, fE: -17, bT: -16, bK: 13, fT: 7, fK: -13, tl: 0.77 }],
  [34.6, { lean: -11, head: -10, bA: 4, bE: 15, fA: 6, fE: -44, bT: -18, bK: 5, fT: 25, fK: -15, tl: 0.77 }],
  [34.7, { lean: -11, head: -11, bA: -22, bE: 17, fA: 24, fE: -76, bT: -31, bK: 22, fT: 23, fK: -14, tl: 0.85 }],
  [34.8, { lean: -2, head: -19, bA: -76, bE: -92, fA: 71, fE: 115, bT: -31, bK: 13, fT: 19, fK: 5, tl: 0.95 }],
  [34.9, { lean: -1, head: -17, bA: -79, bE: -99, fA: 79, fE: 124, bT: -31, bK: 18, fT: 11, fK: 0, tl: 1 }],
  [35.1, { lean: -1, head: -17, bA: -79, bE: -102, fA: 65, fE: 129, bT: -31, bK: 29, fT: -1, fK: -9, tl: 0.99 }],
  [35.2, { lean: -1, head: -15, bA: -72, bE: -105, fA: 56, fE: 133, bT: -29, bK: 27, fT: -4, fK: -26, tl: 0.96 }],
  [35.3, { lean: 0, head: -14, bA: -55, bE: -116, fA: 34, fE: 142, bT: -28, bK: 54, fT: -5, fK: -4, tl: 0.91 }],
  [35.5, { lean: -1, head: -8, bA: -29, bE: -195, fA: -2, fE: -53, bT: -56, bK: 98, fT: -5, fK: 1, tl: 0.85 }],
  [35.6, { lean: 1, head: -8, bA: -53, bE: 158, fA: 20, fE: -115, bT: -20, bK: 5, fT: -4, fK: 9, tl: 0.87 }],
  [35.7, { lean: 4, head: -14, bA: -71, bE: -21, fA: 31, fE: -118, bT: -21, bK: 11, fT: -3, fK: 3, tl: 0.92 }],
  [35.8, { lean: 8, head: -24, bA: -111, bE: -6, fA: 72, fE: 74, bT: -24, bK: 52, fT: -2, fK: 6, tl: 0.92 }],
  [35.9, { lean: 0, head: -9, bA: -77, bE: -149, fA: 51, fE: 157, bT: -20, bK: 58, fT: -2, fK: 6, tl: 0.86 }],
  [36.0, { lean: -11, head: -5, bA: 0, bE: -1, fA: 26, fE: -66, bT: -35, bK: 61, fT: -14, fK: 28, tl: 0.77 }],
  [36.1, { lean: -16, head: -16, bA: 12, bE: -14, fA: 30, fE: -79, bT: -45, bK: 68, fT: -28, fK: 47, tl: 0.67 }],
  [36.2, { lean: -19, head: -24, bA: 23, bE: 66, fA: 21, fE: -71, bT: -80, bK: 72, fT: -29, fK: 43, tl: 0.65 }],
  [36.3, { lean: -12, head: -26, bA: 1, bE: -21, fA: 27, fE: -77, bT: -37, bK: 66, fT: -25, fK: 41, tl: 0.67 }],
  [36.4, { lean: -16, head: -17, bA: 11, bE: -44, fA: 36, fE: -84, bT: -34, bK: 56, fT: -23, fK: 32, tl: 0.72 }],
  [36.5, { lean: -15, head: -22, bA: -34, bE: -172, fA: 25, fE: -53, bT: -37, bK: 61, fT: -23, fK: 39, tl: 0.76 }],
  [36.6, { lean: -8, head: -30, bA: -15, bE: -62, fA: 19, fE: -67, bT: -32, bK: 55, fT: -19, fK: 33, tl: 0.81 }],
  [36.7, { lean: -8, head: -30, bA: -21, bE: -45, fA: 13, fE: -52, bT: -33, bK: 58, fT: -20, fK: 38, tl: 0.84 }],
  [36.8, { lean: -8, head: -19, bA: -28, bE: -52, fA: 18, fE: -55, bT: -29, bK: 51, fT: -20, fK: 36, tl: 0.85 }],
  [36.9, { lean: -3, head: -22, bA: -31, bE: -113, fA: 15, fE: -78, bT: -29, bK: 67, fT: -17, fK: 35, tl: 0.85 }],
  [37.0, { lean: -1, head: -24, bA: -23, bE: -147, fA: 14, fE: -81, bT: -26, bK: 51, fT: -17, fK: 35, tl: 0.87 }],
  [37.1, { lean: 0, head: -25, bA: -55, bE: -68, fA: 13, fE: -73, bT: -23, bK: 54, fT: -17, fK: 38, tl: 0.87 }],
  [37.2, { lean: -4, head: -9, bA: -72, bE: -147, fA: 25, fE: -85, bT: -24, bK: 38, fT: -19, fK: 33, tl: 0.84 }],
  [37.3, { lean: 0, head: 6, bA: -74, bE: -159, fA: 16, fE: -72, bT: -14, bK: 33, fT: -9, fK: 7, tl: 0.84 }],
  [37.4, { lean: 10, head: 1, bA: -64, bE: -158, fA: -1, fE: -84, bT: -17, bK: 72, fT: -4, fK: -7, tl: 0.87 }],
  [37.6, { lean: 9, head: 4, bA: -8, bE: 119, fA: -2, fE: -56, bT: 4, bK: -117, fT: 5, fK: -31, tl: 0.89 }],
  [37.7, { lean: 14, head: 1, bA: -16, bE: 104, fA: -11, fE: -52, bT: 12, bK: -62, fT: 12, fK: -38, tl: 0.87 }],
  [37.8, { lean: 24, head: 7, bA: -34, bE: 28, fA: -50, fE: 0, bT: 27, bK: -53, fT: 29, fK: -60, tl: 0.83 }],
  [38.1, { lean: 11, head: 28, bA: -15, bE: 11, fA: -19, fE: 25, bT: 20, bK: -18, fT: 17, fK: -23, tl: 0.89 }],
  [38.2, { lean: 3, head: 26, bA: -148, bE: -57, fA: -10, fE: 21, bT: 21, bK: -27, fT: 14, fK: -17, tl: 0.94 }],
  [38.3, { lean: 3, head: 22, bA: -75, bE: -133, fA: -10, fE: 7, bT: 18, bK: -15, fT: 12, fK: -15, tl: 0.94 }],
  [38.4, { lean: 10, head: 7, bA: -125, bE: -97, fA: -2, fE: -51, bT: 7, bK: -1, fT: 6, fK: -9, tl: 0.94 }],
  [38.5, { lean: 15, head: -3, bA: -128, bE: -104, fA: 0, fE: -83, bT: -8, bK: 2, fT: -4, fK: -8, tl: 0.94 }],
  [38.6, { lean: 17, head: -13, bA: -115, bE: -110, fA: -8, fE: -89, bT: -28, bK: 25, fT: 4, fK: -10, tl: 0.97 }],
  [38.7, { lean: 16, head: -13, bA: -117, bE: -111, fA: -9, fE: -88, bT: -30, bK: 24, fT: 4, fK: -9, tl: 0.99 }],
  [38.8, { lean: 16, head: -18, bA: -119, bE: -93, fA: -12, fE: -81, bT: -32, bK: 41, fT: 4, fK: -2, tl: 1 }],
  [38.9, { lean: 16, head: -24, bA: -108, bE: -95, fA: -16, fE: -70, bT: -26, bK: 37, fT: -1, fK: -22, tl: 0.97 }],
  [39.0, { lean: 13, head: -24, bA: -104, bE: -94, fA: -16, fE: -57, bT: -8, bK: 21, fT: 1, fK: -18, tl: 0.97 }],
  [39.1, { lean: 11, head: -25, bA: -103, bE: -89, fA: -16, fE: -46, bT: -2, bK: 14, fT: 3, fK: -1, tl: 0.96 }],
  [39.2, { lean: 9, head: -27, bA: -82, bE: -106, fA: -16, fE: -37, bT: -4, bK: 15, fT: -1, fK: 4, tl: 0.96 }],
  [39.3, { lean: 2, head: -26, bA: -76, bE: -104, fA: -4, fE: -35, bT: -13, bK: 43, fT: -1, fK: 8, tl: 0.94 }],
  [39.4, { lean: -4, head: -20, bA: -36, bE: -140, fA: 16, fE: -46, bT: -7, bK: 31, fT: 10, fK: -10, tl: 0.92 }],
  [39.5, { lean: -11, head: -6, bA: -22, bE: -154, fA: 50, fE: -66, bT: 9, bK: -3, fT: 18, fK: -9, tl: 0.92 }],
  [39.6, { lean: -10, head: 11, bA: -13, bE: -176, fA: 41, fE: -48, bT: 17, bK: -9, fT: 28, fK: -3, tl: 0.92 }],
  [39.7, { lean: -11, head: 16, bA: -1, bE: -186, fA: 38, fE: -41, bT: 16, bK: -9, fT: 28, fK: -16, tl: 0.9 }],
  [39.8, { lean: -10, head: 24, bA: 17, bE: 155, fA: 31, fE: -26, bT: 17, bK: -9, fT: 28, fK: -26, tl: 0.87 }],
  [39.9, { lean: -7, head: 24, bA: 10, bE: 154, fA: 25, fE: -19, bT: 18, bK: -14, fT: 26, fK: -40, tl: 0.81 }],
  [40.0, { lean: -3, head: 23, bA: 11, bE: 148, fA: 19, fE: -21, bT: 17, bK: -2, fT: 13, fK: -13, tl: 0.78 }],
  [40.1, { lean: 1, head: 18, bA: 0, bE: 154, fA: 12, fE: -25, bT: 9, bK: 4, fT: 6, fK: -4, tl: 0.77 }],
  [40.2, { lean: 3, head: 17, bA: -7, bE: 155, fA: 8, fE: -33, bT: 6, bK: 3, fT: 3, fK: -12, tl: 0.8 }],
  [40.3, { lean: 7, head: 11, bA: -18, bE: 166, fA: 7, fE: -53, bT: 7, bK: -6, fT: 1, fK: -16, tl: 0.83 }],
  [40.4, { lean: 13, head: 0, bA: -59, bE: 197, fA: -2, fE: -67, bT: 6, bK: 0, fT: 11, fK: -34, tl: 0.88 }],
  [40.5, { lean: 19, head: -11, bA: -93, bE: -147, fA: -12, fE: -80, bT: -7, bK: -3, fT: -4, fK: -16, tl: 0.91 }],
  [40.6, { lean: 23, head: -16, bA: -122, bE: -118, fA: -23, fE: -85, bT: -19, bK: 6, fT: -9, fK: -9, tl: 0.95 }],
  [40.7, { lean: 21, head: -16, bA: -120, bE: -116, fA: -24, fE: -80, bT: -25, bK: 4, fT: -10, fK: -7, tl: 0.97 }],
  [40.8, { lean: 21, head: -18, bA: -92, bE: -134, fA: -29, fE: -76, bT: -43, bK: 9, fT: -9, fK: -4, tl: 0.99 }],
  [40.9, { lean: 20, head: -23, bA: -72, bE: -33, fA: -33, fE: -63, bT: -58, bK: 5, fT: -14, fK: 19, tl: 0.98 }],
  [41.0, { lean: 17, head: -26, bA: -56, bE: -18, fA: -30, fE: -51, bT: -68, bK: 5, fT: -14, fK: 17, tl: 0.96 }],
];
function CXK_MOVES() {
  const J = (v, o) => [JN(v), mp(o)];
  const jkeys = [[0, N], ...JNTM_POSE.map(([v, o]) => J(v, o))]; jkeys.smooth = true;
  const jdur = +(JN(32.6) + .3).toFixed(2); jkeys.push([jdur, N]);
  const H = (v, o) => ({ at: JN(v), hit: Object.assign({ x0: 0, stun: .2, kb: 30 }, o) });
  // 雞你太美也是一中就吃整套：0.3 秒（喊 music 時）就出第一下，招牌動作那幾下照舊，中間補小下讓每兩下不超過 0.4 秒；
  // 每下暈 0.55 秒、不擊退，被打中就一路吃到最後一手指天（那下才擊飛）
  const JL = { x0: -30, stun: .55, kb: 0 };
  const jsig = [[24.6, { x1: 120, dmg: 3 }], [24.8, { x1: 120, dmg: 3 }], ...[25.35, 25.7, 26.05, 26.4].map(v => [v, { x1: 130, dmg: 2 }]),
    [26.8, { x1: 140, dmg: 5 }], [27.4, { x1: 150, dmg: 3, both: true }], [29.4, { x1: 170, dmg: 8, both: true }, { ring: '#ff9de2', shake: 8 }],
    [31.4, { x1: 120, dmg: 3 }], [31.6, { x1: 120, dmg: 3 }]];
  const jhits = [], jt = [22.1, ...jsig.map(s => s[0]), 32.4];
  for (let i = 0; i < jt.length - 1; i++) {
    const n = Math.ceil((jt[i + 1] - jt[i]) / .4);
    for (let j = i ? 1 : 0; j < n; j++) jhits.push({ at: JN(jt[i] + (jt[i + 1] - jt[i]) * j / n), hit: Object.assign({ x1: 130, dmg: 1 }, JL) }); // 補的小下
  }
  for (const [v, o, x] of jsig) jhits.push(Object.assign({ at: JN(v), hit: Object.assign({}, JL, o) }, x));
  // 蠢蠢欲動：同一套「一中就吃整套」——0.3 秒出第一下、每 0.4 秒內一下、每下暈 0.55 秒不擊退，招牌動作打重一點，最後一下擊飛
  const dkeys = [[0, N], ...D2_POSE.map(([v, o]) => [D2(v), mp(o)])]; dkeys.smooth = true;
  const ddur = +(D2(41.0) + .5).toFixed(2); dkeys.push([ddur, N]); // 9 秒
  const dsig = [[34.4, { x1: 160, dmg: 4, both: true }, { ring: '#ff9de2', shake: 6 }], [35.1, { x1: 130, dmg: 3 }]]; // 跳起落地、手指天；高踢腿是最後擊飛那下
  const dhits = [], dt = [32.8, ...dsig.map(s => s[0]), 40.6];
  for (let i = 0; i < dt.length - 1; i++) {
    const n = Math.ceil((dt[i + 1] - dt[i]) / .4);
    for (let j = i ? 1 : 0; j < n; j++) dhits.push({ at: D2(dt[i] + (dt[i + 1] - dt[i]) * j / n), hit: Object.assign({ x1: 130, dmg: 1 }, JL) });
  }
  for (const [v, o, x] of dsig) dhits.push(Object.assign({ at: D2(v), hit: Object.assign({}, JL, o) }, x));
  const kkeys = [[0, N], ...KX_POSE.map(([v, o]) => [KX(v), mp(o)])]; kkeys.smooth = true;
  const PASS = mp({ lean: 10, bT: -18, bK: 10, fT: 22, fK: -10, fA: 92, fE: 0, bA: 88, bE: 4, head: 4 }); // 胸前傳球：雙手往前推
  const kdur = +(KX(21.4) + .55).toFixed(2); kkeys.push([KX(21.4) + .15, PASS], [KX(21.4) + .3, PASS], [kdur, N]);
  // 一中就吃整套：0.25 秒就出第一下，之後每 0.4 秒內一定再打一下、每下暈 0.55 秒（比間隔長），被打中就逃不掉，一路吃到最後傳球
  const kh = [], anchors = [13.75, ...KX_BOUNCE, 21.3];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i], n = Math.ceil((anchors[i + 1] - a) / .4);
    for (let j = 0; j < n; j++) kh.push({ v: a + (anchors[i + 1] - a) * j / n, big: KX_BOUNCE.includes(a) && j === 0 });
  }
  kh.push({ v: 21.3, big: false });
  const KH = ({ v, big }) => ({ at: KX(v), hit: { x0: -30, x1: 115, dmg: big ? 2 : 1, stun: .55, kb: 0 } }); // 拍到地那下 2、中間補的 1；不擊退才黏得住
  return {
    kuaxia: { name: '胯下運球', cd: 6, dur: kdur, demo: true, voices: false, prop: kuaxiaBall,
      desc: '原片 BGM 響起，照原片整段運球（約 8 秒）：壓低運球、左右換手、胯下過、球在肩上滾；一被打中就一路被運球連打暈住，最後胸前傳球把籃球砸出去',
      keys: kkeys,
      ev: [{ at: 0, chant: 'mv_cxk_dribble' }, { at: .1, to: KX(21.2), vx: 40 }, ...kh.map(KH),
        { at: KX(21.4) + .1, proj: { kind: 'bball', vx: 640, dmg: 12, stun: .5, kb: 260 } }] },
    jntm: { name: '雞你太美', cd: 8, dur: jdur, demo: true, voices: ['cxk_music'], prop: jntmBall,
      desc: '喊一聲 music，原片 BGM「只因你太美」響起，照原片整段跳完（約 11 秒）：轉球甩出去、抬膝跳、彎腰抖肩、跳起後踢、縮腿跳落地震一圈、最後一手指天，跳的途中一直打人',
      keys: jkeys,
      ev: [{ at: .6, chant: 'mv_cxk_jntm' }, { at: JN(24), to: JN(32.4), vx: 35 },
        { at: JN(23.9), proj: { kind: 'bball', vx: 520, dmg: 6, stun: .55, kb: 0 } }, ...jhits,
        Object.assign(H(32.4, { x1: 170, dmg: 10, stun: .5, kb: 450 }), { shake: 6 })] },
    chunchun: { name: '蠢蠢欲動', cd: 10, dur: ddur, demo: true, voices: false,
      desc: '原片 BGM 響起，照原片雞你太美後面那段舞跳（9 秒）：蹲低、原地跳、手指天、遮臉扭，最後高踢腿把人踢飛；一被打中就一路暈住吃到最後一下',
      keys: dkeys,
      ev: [{ at: 0, chant: 'mv_cxk_dance2' }, { at: .1, to: D2(40.4), vx: 30 }, ...dhits,
        { at: D2(40.6), hit: { x0: -30, x1: 170, dmg: 8, stun: .5, kb: 450 }, shake: 6 }] },
  };
}
/* 懂王 5 招（試作）：YouTube 名場面——「Nobody knows more than me」手風琴手勢、Apprentice「You're fired」指人、
   霸氣握手（拉過來拍手背、比讚）、蓋牆、造勢大會 YMCA 握拳舞。配音：英文男聲念拼音式中文（外國人腔） */
function trumpWall(ft, d, t) { // 蓋牆：面前升起一道磚牆
  const k = Math.min(1, Math.max(0, (t - .15) / .25)), a = t > 2 ? Math.max(0, 1 - (t - 2) / .3) : 1;
  if (k <= 0 || a <= 0) return null;
  const x = ft.x + ft.face * 95, h = 170 * k;
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#b5552f'; ctx.fillRect(x - 20, GROUND - h, 40, h);
  ctx.strokeStyle = '#e9d3b8'; ctx.lineWidth = 2;
  for (let y = GROUND, r = 0; y > GROUND - h; y -= 17, r++) { ctx.beginPath(); ctx.moveTo(x - 20, y); ctx.lineTo(x + 20, y); const bx = x + (r % 2 ? -7 : 7); ctx.moveTo(bx, y); ctx.lineTo(bx, Math.max(GROUND - h, y - 17)); ctx.stroke(); }
  ctx.restore(); return null;
}
function TRUMP_MOVES() {
  const OUT = { fA: 75, fE: 25, bA: -75, bE: -25 }, IN = { fA: 40, fE: 95, bA: -40, bE: -95 }, SHRUG = { fA: 60, fE: -40, bA: -60, bE: 40, head: 8 };
  const nk = [[0, N]]; [.12, .3, .45, .6, .75, .9, 1.05, 1.2].forEach((t, i) => nk.push([t, mp(i % 2 ? IN : OUT, { head: i % 2 ? 6 : -6, bT: -10, fT: 10 })]));
  nk.push([1.4, mp(SHRUG, { bT: -10, fT: 10 })], [1.55, mp(SHRUG, { bT: -10, fT: 10 })], [1.7, N]);
  const yk = [[0, N]], yh = [];
  for (let i = 0; i < 11; i++) { const t = +(.3 + i * .36).toFixed(2); yh.push(t);
    yk.push([t, mp(i % 2 ? { fA: 10, fE: 70, bA: -15, bE: -130, lean: -4, head: -5, dy: 2 } : { fA: 15, fE: 130, bA: -10, bE: -70, lean: 4, head: 5, dy: 8 }, { bT: -14, bK: 12, fT: 14, fK: -12 })]); }
  yk.push([4.4, mp({ fA: 150, fE: 20, bA: -150, bE: -20, head: -8 })], [4.7, mp({ fA: 150, fE: 20, bA: -150, bE: -20, head: -8 })], [5, N]);
  const sh = (o) => mp({ lean: -8, bT: -16, fT: 16 }, o);
  return {
    dongbi: { name: '沒人比我更懂', cd: 3, dur: 1.7, demo: true, voices: ['trump_nobody'], keys: nk,
      desc: '「沒有人比我更懂」：雙手在胸前像拉手風琴一樣開合，每夾一下打一下（4 下），最後攤手把人推開',
      ev: [...[.3, .6, .9, 1.2].map(at => ({ at, hit: { x0: 0, x1: 125, dmg: 3, stun: .2, kb: 40 } })), { at: 1.4, hit: { x0: 0, x1: 140, dmg: 6, stun: .3, kb: 260 } }] },
    fired: { name: '你被開除了', cd: 2.5, dur: .9, demo: true, voices: ['trump_fired'],
      desc: '「你被開除了！」身體前傾、手往前一指，射出一張開除通知',
      keys: [[0, N], [.15, mp({ fA: 30, fE: 120, lean: -6 })], [.3, mp({ fA: 95, fE: -5, bA: -20, bE: 20, lean: 14, head: 6, fT: 20, fK: -10, bT: -16 })], [.75, mp({ fA: 95, fE: -5, bA: -20, bE: 20, lean: 14, head: 6, fT: 20, fK: -10, bT: -16 })], [.9, N]],
      ev: [{ at: .3, proj: { kind: 'fired', vx: 600, dmg: 14, stun: .5, kb: 220 } }] },
    woshou: { name: '霸氣握手', cd: 4, dur: 1.4, demo: true, voices: ['trump_shake'],
      desc: '「很高興見到你」：伸手握住、一把拉過來，拍兩下手背，最後甩出去比個讚',
      keys: [[0, N], [.15, mp({ fA: 85, fE: -10, lean: 10 })], [.25, mp({ fA: 85, fE: -10, lean: 10 })], [.4, sh({ fA: 40, fE: 60, head: -6 })],
        [.55, sh({ fA: 45, fE: 55, bA: 60, bE: 50 })], [.65, sh({ fA: 45, fE: 55, bA: 40, bE: 30 })], [.75, sh({ fA: 45, fE: 55, bA: 60, bE: 50 })], [.85, sh({ fA: 45, fE: 55, bA: 40, bE: 30 })],
        [1, mp({ fA: 110, fE: -10, bA: -40, bE: 20, lean: 16 })], [1.15, mp({ fA: 30, fE: 120, bA: -10, head: -4 })], [1.4, N]],
      ev: [{ at: .25, grab: { range: 160, dmg: 8, mode: 'pull', stun: 2 } }, { at: .55, hit: { x0: 0, x1: 120, dmg: 3, stun: .4, kb: 0 } }, { at: .75, hit: { x0: 0, x1: 120, dmg: 3, stun: .4, kb: 0 } },
        { at: .95, hit: { x0: 0, x1: 140, dmg: 9, stun: .5, kb: 420 } }] },
    gaiqiang: { name: '蓋一道牆', cd: 5, dur: 2.3, demo: true, voices: ['trump_wall'], prop: trumpWall,
      desc: '「我們要蓋一道牆」：面前升起磚牆，把靠太近的人推開，約 2 秒內擋下所有攻擊（打過來的人會被震一下）',
      keys: [[0, N], [.2, mp({ fA: 90, fE: -10, bA: 80, bE: 10 })], [2.1, mp({ fA: 90, fE: -10, bA: 80, bE: 10 })], [2.3, N]],
      ev: [{ at: .15, guard: 'block', dur: 1.9, stagger: .3 }, { at: .3, hit: { x0: 0, x1: 120, dmg: 6, stun: .3, kb: 320 } }] },
    ymca: { name: 'YMCA 造勢舞', cd: 7, dur: 5, demo: true, voices: ['trump_maga'], keys: yk,
      desc: '「讓美國再次偉大！」造勢大會那段握拳舞：雙拳在胸前輪流打拍子、慢慢往前逼（11 下），中途喊「非常非常大」，最後雙拳舉高震開',
      ev: [{ at: .3, to: 4.3, vx: 45 }, { at: 2, chant: 'mv_trump_huge' }, ...yh.map(at => ({ at, hit: { x0: 0, x1: 120, dmg: 2, stun: .15, kb: 20 } })),
        { at: 4.4, hit: { x0: 0, x1: 160, dmg: 8, stun: .5, kb: 380, both: true }, ring: '#ff6b6b', shake: 6 }] },
  };
}
/* 期間限定：2026 台北市長候選人蔣萬安、沈伯洋（試作，李品逸提的招式）。動作取自公開場面：
   蔣萬安＝辯論會連問「這句話是誰說的」、北市鼠患投藥、砍樹爭議；沈伯洋＝2024/5/17 立院爬上主席台頭著地摔下、辯論會「加 LINE」「回來當立委、我來當市長」。
   語音都是兩人在辯論會、記者會的原聲片段 */
function treeProp(ft, d, t) { // 胡亂砍樹：前面長出一棵樹，砍兩下往前倒
  const hx = d.x + d.sk.haF[0], hy = d.baseY + d.sk.haF[1]; // 手上的斧頭
  if (t < 1.1) { ctx.save(); ctx.translate(hx, hy); ctx.rotate(Math.atan2(d.sk.haF[1] - d.sk.elF[1], d.sk.haF[0] - d.sk.elF[0])); ctx.fillStyle = '#7a5230'; ctx.fillRect(-2, -3, 34, 6); ctx.fillStyle = '#c9ced6'; ctx.beginPath(); ctx.moveTo(28, -3); ctx.lineTo(40, -14); ctx.lineTo(42, 10); ctx.lineTo(28, 3); ctx.fill(); ctx.restore(); }
  const g = Math.min(1, Math.max(0, (t - .08) / .25)); if (g <= 0) return null;
  const fall = Math.min(1, Math.max(0, (t - .78) / .25)), a = t > 1.3 ? Math.max(0, 1 - (t - 1.3) / .3) : 1;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(ft.x + ft.face * 175, GROUND); ctx.rotate(ft.face * fall * fall * Math.PI / 2); ctx.scale(g, g);
  ctx.fillStyle = '#7a5230'; ctx.fillRect(-9, -95, 18, 95);
  ctx.fillStyle = '#3f8f4a'; for (const [cx, cy, r] of [[0, -150, 42], [-30, -118, 32], [30, -118, 32], [0, -112, 30]]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); }
  ctx.restore(); return null;
}
function POL_MOVES() {
  const HIP_B = { bA: -60, bE: 104 };
  return {
    wenda: { name: '問A答B', cd: 3, dur: 1.1, demo: true, voices: ['chiang_who'],
      desc: '「這句話是誰說的？」手一指反問回去：0.9 秒內被打到就自動反擊（18），不回答你的問題',
      keys: [[0, N], [.12, mp(HIP_B, { fA: 120, fE: -20, head: -6, lean: -4 })], [.95, mp(HIP_B, { fA: 125, fE: -25, head: -8, lean: -4 })], [1.1, N]],
      ev: [{ at: .08, guard: 'counter', dur: .9, dmg: 18 }] },
    shuyao: { name: '鼠毒攻擊', cd: 4, dur: .9, demo: true, voices: ['chiang_rat'],
      desc: '彎腰往前撒老鼠藥：前方 200 處留下一灘藥，3 秒內站在裡面每 0.5 秒扣 3（不會被打斷）',
      keys: [[0, N], [.2, mp({ lean: 22, fA: -30, fE: 40, bA: -20, bE: 20, bK: 20, fK: -20, dy: 8 })], [.45, mp({ lean: 18, fA: 100, fE: -10, bA: -20, bE: 20, bK: 20, fK: -20, dy: 8 })], [.7, mp({ lean: 10, fA: 95, fE: -5 })], [.9, N]],
      ev: [{ at: .45, zone: { d: 200, r: 75, life: 3, dmg: 3 } }] },
    kanshu: { name: '胡亂砍樹', cd: 3.5, dur: 1.4, demo: true, voices: ['chiang_std'], prop: treeProp,
      desc: '前面長出一棵樹，舉斧頭砍兩下，樹往前倒下去砸人（130～330 的距離，16）',
      keys: [[0, N], [.2, mp({ fA: 175, fE: -10, bA: 170, bE: 10, lean: -8, head: -6 })], [.45, mp({ fA: 75, fE: -5, bA: 70, bE: 5, lean: 16, head: 8 })], [.58, mp({ fA: 175, fE: -10, bA: 170, bE: 10, lean: -8 })], [.75, mp({ fA: 75, fE: -5, bA: 70, bE: 5, lean: 16, head: 8 })], [1.2, mp({ fA: 60, fE: 0, bA: 55, bE: 0, lean: 10 })], [1.4, N]],
      ev: [{ at: .45, sfx: 'thud' }, { at: .75, sfx: 'thud' }, { at: 1, hit: { x0: 130, x1: 330, dmg: 16, stun: .6, kb: 220 }, shake: 6 }] },
    feipu: { name: '議台飛撲', cd: 4.5, dur: 1.6, demo: true, voices: ['shen_mayor'],
      desc: '「你回來當立委，我來當市長」：爬上人牆往前飛撲，落地壓到人（22、震一圈），但自己頭著地躺一下',
      keys: [[0, N], [.15, mp({ lean: 40, dy: 20, bK: 50, fK: -50, fA: 120, fE: -20, bA: 110, bE: -10 })], [.3, mp({ lean: 40, dy: 14, bK: 60, fK: -40, fA: 140, fE: -10, bA: 130, bE: -10 })],
        [.5, mp({ rot: 60, fA: 160, fE: 0, bA: 150, bE: 0, bT: -20, fT: 10 })], [.75, mp({ rot: 120, fA: 170, bA: 160, bT: -30, fT: -10, head: 10 })], [.95, mp({ rot: 92, fA: 150, bA: 140, bT: -10, fT: 10, head: 14 })], [1.4, mp({ rot: 90, fA: 140, bA: 130, bT: -8, fT: 8, head: 16 })], [1.6, N]],
      ev: [{ at: .3, jump: 620 }, { at: .3, to: .75, vx: 430 }, { at: .7, dive: 1400 }, { at: .7, onLand: true, hit: { x0: -30, x1: 150, dmg: 22, stun: .6, kb: 300 }, ring: '#5fd38a', shake: 8 }] },
    shuangbiao: { name: '超時空雙標', cd: 3, dur: .8, demo: true, voices: ['shen_fact'],
      desc: '「要根基於事實，不要用假消息抹黑」：一個人同時指前後兩邊，前後都打（12）',
      keys: [[0, N], [.15, mp(M_X)], [.3, mp({ bA: -95, bE: -5, fA: 95, fE: 5, head: -4 })], [.6, mp({ bA: -95, bE: -5, fA: 95, fE: 5 })], [.8, N]],
      ev: [{ at: .3, hit: { both: true, x0: 0, x1: 160, dmg: 12, stun: .4, kb: 260 }, ring: '#5fd38a' }] },
    huyan: { name: '胡言亂語', cd: 3, dur: .8, demo: true, voices: ['shen_line'],
      desc: '「大家晚一點加 LINE 也可以」：丟出一個加 LINE 對話框，打中的人左右鍵相反 2 秒（8）',
      keys: [[0, N], [.15, mp({ fA: 60, fE: 60, bA: -20, bE: 20, head: 6 })], [.3, mp({ fA: 95, fE: -10, bA: -20, bE: 20, lean: 6 })], [.65, mp({ fA: 95, fE: -10, bA: -20, bE: 20, lean: 6 })], [.8, N]],
      ev: [{ at: .3, proj: { kind: 'babble', vx: 520, dmg: 8, stun: .3, kb: 120, conf: 2, life: 1.4 } }] },
  };
}
// 被打語音：蔡徐坤偶爾「你干嘛～哎哟～」、懂王「你是假新聞／錯了」；被打倒一定喊
const CHAR_VOX = { cxk: { hurt: ['cxk_nigan', 'cxk_aiyo', 'cxk_niganaiyo'], ko: 'cxk_niganaiyo' }, trump: { demo: true, hurt: ['trump_fake', 'trump_wrong'], ko: 'trump_rigged' } }; // demo：懂王配音還在試作，只在測試版
function charHurtVoice(tgt) {
  const vx = CHAR_VOX[tgt.char]; if (!vx || (vx.demo && !SHOW_DEMO)) return;
  if (tgt.ko) { if (!tgt.cxkKo) { tgt.cxkKo = true; playClip('mv_' + vx.ko); } return; }
  tgt.cxkKo = false;
  const now = performance.now(), r = Math.random(), say = pickOne(vx.hurt); // 亂數一定先抽：線上對戰兩邊的時鐘不同，不能因為「剛講過」少抽一次而讓兩邊亂數對不上
  if (now < (tgt.cxkVT || 0) || r > .3) return;
  tgt.cxkVT = now + 2500; playClip('mv_' + say);
}
const YT_IDS = ['yaotou', 'kuaxia', 'jntm', 'chunchun','dongbi', 'fired', 'woshou', 'gaiqiang', 'ymca', 'wenda', 'shuyao', 'kanshu', 'feipu', 'shuangbiao', 'huyan'];
const MOVES = {
  dahu: { name: '打虎式', cd: 2.8, dur: .8, armor: true,desc: '弓步突進一掌，高舉的手打虎頭。近身重擊、擊退',
    keys: [[0, N], [.12, mp(M_LOW, { lean: -6, bA: -40, bE: 60, fA: -20, fE: 90 })], [.25, mp(M_LUNGE, { lean: 18, head: 8, fA: 150, fE: -10, bA: 40, bE: 80 })], [.6, mp(M_LUNGE, { lean: 16, head: 8, fA: 146, fE: -10, bA: 40, bE: 80 })], [.8, N]],
    ev: [{ at: .12, to: .25, vx: 700 }, { at: .25, hit: { x0: 0, x1: 160, dmg: 14, stun: .5, kb: 320 } }] },
  fengbai: { name: '風擺柳碎步', cd: 3, dur: 1, panic: true, dirInput: true, desc: '被控制時也能放（解控）：小碎步像柳枝隨風飄一大段，期間無敵、不會被打斷、能穿過對手；按住左或右就往那邊飄（途中也能換邊），不按就往後退；不能往上；不會打人',
    keys: [[0, N], [.15, mp({ lean: 25, head: 15, bA: 40, bE: 20, fA: 70, fE: 20, bT: -6, bK: 14, fT: 8, fK: -10 })], [.3, mp({ lean: -20, head: -12, bA: -60, bE: 10, fA: -30, fE: 10, bT: -2, fT: 4 })],
      [.45, mp({ lean: 25, head: 15, bA: 40, bE: 20, fA: 70, fE: 20, bT: -8, bK: 16, fT: 6 })], [.58, mp({ lean: 20, head: 10, bA: -150, bE: 0, fA: 120, fE: 0, bT: -20, bK: -80, fT: 6 })], [.75, mp({ lean: -15, head: -10, bA: -60, fA: -20 })], [1, N]],
    ev: [{ at: 0, guard: 'inv', dur: .9 }, { at: .02, to: .85, vx: -560, ghost: true }] }, // 飄約 460，全程無敵、可以穿過對手
  pingchou: { name: '平抽手', cd: 1, dur: .6, desc: '雙手胸前一收再平平抽開，前後兩邊都打得到',
    keys: [[0, N], [.12, mp(M_X)], [.25, mp(M_T, { head: -4 })], [.45, mp(M_T)], [.6, N]],
    ev: [{ at: .25, hit: { both: true, x0: 0, x1: 156, dmg: 14, stun: .3, kb: 260 } }] }, // 156＝平伸的手尖（肩 28＋臂 86＋手 8）碰到對手身體邊（34）就算中
  fenshou: { name: '分手傾護', cd: 1.3, dur: 1.1, desc: '雙手頭頂交叉護住，一秒內擋下所有攻擊；近身打來的人會被震開一下',
    keys: [[0, N], [.1, mp(M_V)], [.22, mp({ bA: -165, bE: -45, fA: 165, fE: 45, lean: -6 })], [1, mp({ bA: -165, bE: -45, fA: 165, fE: 45, lean: -6 })], [1.1, N]],
    ev: [{ at: .1, guard: 'block', dur: .95, stagger: .4 }] },
  xiaolun: { name: '小掄臂', cd: 2.4, dur: .9, armor: true,desc: '雙臂繞小圈連打五下，把人一路挑到空中，最後一下挑最高',
    keys: [[0, N], [.1, mp(M_T)], [.2, mp(M_X)], [.3, mp(M_T)], [.4, mp(M_X)], [.5, mp(M_T)], [.6, mp(M_X)], [.7, mp(M_T)], [.9, N]],
    ev: [.2, .3, .4, .5, .6].map((at, i) => ({ at, hit: { x0: 0, x1: 115, dmg: 5, stun: .2, kb: 80, launch: i < 4 ? 320 : 700 } })) },
  dalun: { name: '大掄臂', cd: 3, dur: 1, desc: '單臂過頭掄一大圈往下砸，打中會把人掀飛',
    keys: [[0, N], [.2, mp({ fA: -40, bA: -60, lean: -8 })], [.35, mp({ fA: -175, fE: 0, bA: -60, lean: -12, head: -8 })], [.5, mp({ fA: 70, fE: 0, bA: -70, lean: 22, head: 10, bK: 16, fK: -16 })], [.8, mp({ fA: 60, bA: -60, lean: 18 })], [1, N]],
    ev: [{ at: .42, hit: { x0: 20, x1: 200, dmg: 28, stun: .6, kb: 200, launch: 700 } }] },
  cheshui: { name: '車水步', cd: 2.8, dur: 1, desc: '一手指前、一手叉腰，踩著水車步一路往前推',
    keys: [[0, N], [.1, mp({ fA: 100, fE: -10, bA: -45, bE: 112, fT: 40, fK: -60 })], [.25, mp({ fA: 100, fE: -10, bA: -45, bE: 112, bT: -30, bK: -50 })], [.4, mp({ fA: 100, fE: -10, bA: -45, bE: 112, fT: 40, fK: -60 })],
      [.55, mp({ fA: 100, fE: -10, bA: -45, bE: 112, bT: -30, bK: -50 })], [.7, mp({ fA: 100, fE: -10, bA: -45, bE: 112, fT: 40, fK: -60 })], [.85, mp({ fA: 100, fE: -10, bA: -45, bE: 112 })], [1, N]],
    ev: [{ at: .05, to: .95, vx: 280 }, ...[.3, .6, .9].map(at => ({ at, hit: { x0: 0, x1: 100, dmg: 7, stun: .25, kb: 160 } }))] },
  xieta: { name: '斜塔位', cd: 2, dur: 1, desc: '身體斜成一座塔，期間把飛來的球反彈回去，近身的攻擊也擋得住',
    keys: [[0, N], [.15, mp({ lean: -28, head: -10, bA: -150, bE: 0, fA: 40, fE: 0, fT: 40, fK: 0, bT: -8 })], [.85, mp({ lean: -30, head: -12, bA: -152, fA: 38, fT: 42, bT: -8 })], [1, N]],
    ev: [{ at: .05, guard: 'reflect', dur: .85, blockAll: true }] },
  baishi: { name: '敗式', cd: 3.6, dur: 1, desc: '縮身裝輸；這時被打會自動反擊，對方吃 28',
    keys: [[0, N], [.15, mp({ dy: 20, bK: 40, fK: -40, bT: -8, fT: 8, lean: 20, head: 20, nod: 6, bA: 30, bE: 60, fA: -20, fE: -70 })], [.85, mp({ dy: 22, bK: 42, fK: -42, bT: -8, fT: 8, lean: 22, head: 22, nod: 6, bA: 30, bE: 60, fA: -20, fE: -70 })], [1, N]],
    ev: [{ at: .05, guard: 'counter', dur: .8, dmg: 28 }] },
  yaozhong: { name: '腰中盤帶', cd: 3, dur: .9, desc: '雙手繞腰一盤，抓住對手甩到身後，暈 0.9 秒',
    keys: [[0, N], [.15, mp(M_T)], [.3, mp({ fA: 70, fE: 80, bA: -40, bE: -60, lean: 10 })], [.55, mp({ fA: -60, fE: -40, bA: 60, bE: 60, lean: -10, head: -10 })], [.9, N]],
    ev: [{ at: .3, grab: { range: 140, dmg: 24, mode: 'swap', stun: 1.5 } }] }, // 抓技暈＝0.6 × stun
  guabian: { name: '掛鞭式', cd: 2.4, dur: .8, desc: '雙手上舉再甩下，像鞭子一樣只打遠處（300～500 的距離，太近打不到）',
    keys: [[0, N], [.15, mp(M_V)], [.35, mp({ fA: 110, fE: -10, bA: -150, bE: -40, lean: 14 })], [.6, mp({ fA: 100, fE: -10, bA: -140, bE: -40, lean: 12 })], [.8, N]],
    ev: [{ at: .35, hit: { x0: 300, x1: 500, dmg: 18, stun: .4, kb: 200 }, whip: true }] },
  liaowang: { name: '瞭望式', cd: 4, dur: 1.2, desc: '一按馬上生效：6 秒內移動加快 50%、所有招傷害 +60%；前 2 秒免控（不會被打斷、不會暈，但還是會被擊退；沒有減傷）',
    keys: [[0, N], [.2, mp(M_T, { lean: 14, head: 10 })], [.45, mp(M_T, { lean: 0, head: -10, turn: 6 })], [.7, mp(M_T, { lean: -14, head: -12 })], [.95, mp(M_T, { lean: 0, head: 6, turn: -6 })], [1.2, N]],
    ev: [{ at: 0, buff: { speed: 1.5, pow: 1.6, dur: 6 } }, { at: 0, buff: { ccOnly: 2 } }] },
  lisao: { name: '立掃堂', cd: 3, dur: .9, desc: '蹲低掃堂腿再並步轉身，掃倒站在地上的人',
    keys: [[0, N], [.1, mp(M_LOW, { dy: 30, bK: 60, fK: -60 })], [.25, mp(M_T, { dy: 60, fT: 86, fK: 0, bT: -30, bK: 120, lean: 10 })], [.45, mp(M_T, { dy: 50, fT: 70, fK: 0, bT: -30, bK: 110 })], [.65, mp(M_T, { bT: -2, fT: 2 })], [.9, N]],
    ev: [{ at: .25, hit: { x0: 0, x1: 180, maxY: 40, dmg: 22, stun: .9, kb: 120 } }] },
  shuangchao: { name: '雙抄花', cd: 3.3, dur: .8, desc: '雙手胸前抄出一朵花，拋物線丟出去',
    keys: [[0, N], [.1, mp(M_X)], [.2, mp({ bA: 50, bE: 90, fA: -50, fE: -90 })], [.35, mp(M_V, { head: -8 })], [.6, mp(M_V)], [.8, N]],
    ev: [{ at: .35, proj: { kind: 'flower', vx: 560, vy: -200, g: 500, dmg: 16, stun: .8, kb: 220 } }] }, // 弧度壓低：花不會從對手頭上飛過去
  biandan: { name: '扁擔式', cd: 4, dur: .8, desc: '一按馬上生效：3 秒內免控（不會被打斷、不會暈，但還是會被擊退；沒有減傷、反傷）',
    keys: [[0, N], [.2, mp(M_T, { dy: 4 })], [.4, mp(M_T, { dy: -2 })], [.6, mp(M_T, { dy: 4 })], [.8, N]],
    ev: [{ at: 0, buff: { ccOnly: 3 } }] },
  shizi: { name: '獅子回頭', cd: 3, dur: 1, desc: '叉腰下蹲猛回頭一吼，前後的人都被震暈',
    keys: [[0, N], [.15, mp({ fA: 100, bA: -100 })], [.35, mp(M_HIP, M_LOW, { head: -30, turn: -10, lean: -10 })], [.8, mp(M_HIP, M_LOW, { head: -28, turn: -10, lean: -10 })], [1, N]],
    ev: [{ at: .35, hit: { both: true, x0: 0, x1: 220, dmg: 12, stun: .8, kb: 650 }, ring: '#ffd34d' }] }, // 吼完把人往外震開一段
  chayao: { name: '雙手反叉腰', cd: 5, dur: 1.4, desc: '反叉腰得意一下，3 秒內慢慢回 30 血（叉腰這下很好打）',
    keys: [[0, N], [.2, mp(M_HIP, { lean: -4, head: -12 })], [.5, mp(M_HIP, { lean: -5, head: -14, dy: -3 })], [.8, mp(M_HIP, { lean: -4, head: -12 })], [1.1, mp(M_HIP, { lean: -5, head: -14, dy: -3 })], [1.4, N]],
    ev: [{ at: .2, buff: { heal: 30, dur: 3 } }] },
  zhuafen: { name: '抓分手', cd: 3, dur: .8, armor: true,desc: '雙手往前一抓，把遠處的對手拉到面前',
    keys: [[0, N], [.15, mp(M_T)], [.3, mp({ fA: 80, fE: 0, bA: 70, bE: 0, lean: 15 })], [.5, mp(M_HIP, M_LOW, { lean: 6 })], [.8, N]],
    ev: [{ at: .3, grab: { range: 330, dmg: 15, mode: 'pull' } }] },
  xiachuan: { name: '下穿拳傾護', cd: 3.4, dur: .7, armor: true,desc: '一手護頭、壓低身體往前穿一拳，能鑽過飛來的球',
    keys: [[0, N], [.1, mp({ bA: -160, bE: -40, fA: 30, fE: 60 })], [.25, mp(M_LUNGE, { lean: 35, dy: 20, bA: -160, bE: -40, fA: 60, fE: 0 })], [.5, mp(M_LUNGE, { lean: 30, dy: 16, bA: -150, bE: -40, fA: 70 })], [.7, N]],
    ev: [{ at: .05, guard: 'dodgeProj', dur: .35 }, { at: .1, to: .3, vx: 750 }, { at: .28, hit: { x0: 0, x1: 130, dmg: 10, stun: .5, kb: 260, launch: 500 } }] },
  shanhong: { name: '山洪爆發式', cd: 2.5, dur: .8, armor: true,desc: '雙掌收胸再一起推出，把人推飛到牆邊',
    keys: [[0, N], [.15, mp(M_LOW, { bA: 40, bE: 100, fA: 20, fE: 120, lean: -6 })], [.35, mp(M_LUNGE, { fA: 90, fE: 0, bA: 85, bE: 5, lean: 18 })], [.6, mp(M_LUNGE, { fA: 88, bA: 83, lean: 16 })], [.8, N]],
    ev: [{ at: .35, hit: { x0: 0, x1: 250, dmg: 20, stun: .5, kb: 1700 } }] },
  zaiquan: { name: '栽拳出腿', cd: 2.6, dur: .9, desc: '先往下栽一拳，再打直一腿踢出（兩段）',
    keys: [[0, N], [.15, mp({ fA: 50, fE: -100, bA: -40, bE: 30, lean: 10 })], [.3, mp({ fT: 82, fK: 0, lean: -15, bA: -140, bE: -20, fA: 40, fE: -90 })], [.55, mp({ fT: 78, fK: 0, lean: -14, bA: -140, fA: 40, fE: -90 })], [.9, N]],
    ev: [{ at: .18, hit: { x0: 0, x1: 100, dmg: 11, stun: .3, kb: 100 } }, { at: .32, hit: { x0: 30, x1: 170, dmg: 19, stun: .4, kb: 320 } }] },
  sandian: { name: '三點頭', cd: 3, dur: 1, armor: true,desc: '馬步雙手前伸，頭點三下撞三下',
    keys: [[0, N], [.1, mp(BL, { fA: 80, bA: 80 })], [.2, mp(BL, { fA: 80, bA: 80, nod: 9, head: 18 })], [.3, mp(BL, { fA: 80, bA: 80 })], [.45, mp(BL, { fA: 80, bA: 80, nod: 9, head: 18 })], [.55, mp(BL, { fA: 80, bA: 80 })], [.7, mp(BL, { fA: 80, bA: 80, nod: 9, head: 18 })], [.85, mp(BL, { fA: 80, bA: 80 })], [1, N]],
    ev: [{ at: .05, to: .8, vx: 120 }, ...[.2, .45, .7].map(at => ({ at, hit: { x0: 0, x1: 120, dmg: 8, stun: .3, kb: 120 } }))] },
  laoying: { name: '老鷹展翅', cd: 4, dur: 1.45, desc: '跳起展翅滑翔一段，再俯衝落地踩人',
    keys: [[0, N], [.15, mp(M_LUNGE, { dy: 10, bA: -30, fA: 30 })], [.3, mp({ fT: 80, fK: -90, bA: -160, bE: -20, fA: 90, fE: 0 })], [1, mp({ fT: 80, fK: -90, bA: -165, bE: -20, fA: 95, fE: 0, lean: 6 })], [1.1, mp({ lean: 20, bA: -60, fA: 60, fT: 30, bT: -30 })], [1.3, mp(BL, { dy: 10, bA: -100, fA: 100 })], [1.45, N]],
    ev: [{ at: .3, guard: 'dodgeProj', dur: .7 }, { at: .3, jump: 760, float: .55 }, { at: .3, to: 1, vx: 250 }, { at: 1, dive: 1600 }, { at: 1, onLand: true, hit: { both: true, x0: 0, x1: 170, dmg: 45, stun: .5, kb: 300 }, ring: '#fff3d0', shake: 8 }] }, // 展翅滑翔時球打不到
  feiji: { name: '飛機輪', cd: 3, dur: 1, desc: '手臂像螺旋槳狂轉往前衝，前後都會被捲到',
    keys: [[0, N], ...Array.from({ length: 8 }, (_, i) => [.1 + i * .1, mp({ fA: [90, 180, -90, 0][i % 4], fE: 0, bA: [-90, 0, 90, 180][i % 4], bE: 0, lean: 20, bT: -30, bK: -60 })]), [1, N]],
    ev: [{ at: .1, to: .9, vx: 320 }, ...[.15, .3, .45, .6, .75, .9].map(at => ({ at, hit: { both: true, x0: 0, x1: 120, dmg: 4, stun: .2, kb: 120 } }))] },
  yunbu: { name: '雲步', cd: 4.5, dur: .55, desc: '腳底像踩雲平滑穿過對手、期間無敵，穿過去順手往後打一掌',
    keys: [[0, N], [.1, mp({ bT: -3, fT: 6, dy: -2 })], [.25, mp({ bT: -6, fT: 3, dy: -2 })], [.4, mp({ bT: -3, fT: 6, dy: -2 })], [.55, N]],
    ev: [{ at: 0, guard: 'inv', dur: .5 }, { at: .03, to: .45, vx: 650, ghost: true }, { at: .47, hit: { both: true, x0: 0, x1: 130, dmg: 5, stun: .4, kb: 200 } }] },
  yipen: { name: '一盆花轉體', cd: 3, dur: 1, desc: '（簸箕步接一盆花轉體）甩手跳起轉一圈，空中轉身打四周，落地展翅',
    keys: [[0, N], [.15, mp(M_V, M_LOW)], [.35, mp(M_V, { bT: -10, bK: -40, fT: 30, fK: -60 })], [.6, mp(M_V, { bT: -10, bK: -40, fT: 30, fK: -60 })], [.75, mp({ bA: -140, fA: 120, bT: -80, bK: 0, fT: 2, lean: 14 })], [1, N]],
    spin: [.3, .65], ev: [{ at: .3, jump: 800 }, { at: .42, hit: { both: true, x0: 0, x1: 165, dmg: 14, stun: .3, kb: 80 } }, { at: .6, hit: { both: true, x0: 0, x1: 165, dmg: 14, stun: .5, kb: 300, launch: 800 } }] }, // 轉一圈打兩下，第二下踢飛
  chengu: { name: '抻鼓子', cd: 3, dur: .9, desc: '馬步雙手上撐再往下一拉，往前後送出兩道地波（跳起來能躲）',
    keys: [[0, N], [.15, mp(BL, M_V)], [.4, mp(BL, { bA: -60, bE: 120, fA: 60, fE: -120, dy: 14 })], [.65, mp(BL, { bA: -58, bE: 118, fA: 58, fE: -118, dy: 12 })], [.9, N]],
    ev: [{ at: .4, proj: { kind: 'wave', vx: 600, dmg: 16, stun: .4, kb: 200, both: true } }] },
  daqi: { name: '大起步', cd: 2.5, dur: 1, desc: '蹲低一縮，大步躍起成單腳鶴立，落地砸人', // 削弱：拿掉霸體（AI 分析發現它太強）
    keys: [[0, N], [.2, mp(BL, M_LOW, { dy: 24, fA: 40, bA: 40, lean: 16 })], [.4, mp({ fT: 80, fK: -90, bA: -160, bE: -50, fA: 80, fE: 0, lean: -4 })], [.75, mp({ fT: 78, fK: -88, bA: -160, bE: -50, fA: 80 })], [.85, mp(BL, { dy: 10 })], [1, N]],
    ev: [{ at: .25, jump: 900 }, { at: .25, to: .8, vx: 380 }, { at: .8, hit: { x0: -60, x1: 165, dmg: 27, stun: .5, kb: 280 } }] },
  pinghu: { name: '平護', cd: 1.5, dur: .4, desc: '雙臂胸前平平一護（沒有前後搖）：這 0.4 秒被打就格開，對手震住 1 秒、還挨一下',
    keys: [[0, N], [.06, mp(BL, { bA: 80, bE: 10, fA: 92, fE: -10, lean: 4 })], [.34, mp(BL, { bA: 82, bE: 10, fA: 94, fE: -10, lean: 4 })], [.4, N]],
    ev: [{ at: 0, guard: 'parry', dur: .4, pdmg: 8 }] },
  duochan: { name: '跺顫步', cd: 3, dur: 1.2, desc: '連跺四下腳、全身發顫，每跺一下震一圈地',
    keys: [[0, N], ...[.15, .4, .65, .9].flatMap((t, i) => [[t, mp(M_HIP, i % 2 ? { bT: -40, bK: -70 } : { fT: 50, fK: -70 })], [t + .12, mp(M_HIP, { dy: 6 })]]), [1.2, N]],
    jit: 5, ev: [.3, .55, .8, 1.05].map(at => ({ at, hit: { both: true, x0: 0, x1: 160, maxY: 20, dmg: 6, stun: .3, kb: 0 }, ring: '#c9b48a', shake: 6 })) },
  ...YAOTOU_VERSIONS(),
  ...CXK_MOVES(),
  ...TRUMP_MOVES(),
  ...POL_MOVES(),
};
// 暫時下架的招（2026-10-27）：天梯、闖關、擴充模式、練習場都抽不到；招式資料先留著，日後更新再上架
const MOVE_OFF = new Set(['dahu', 'pingchou', 'fenshou', 'cheshui', 'xieta', 'yaozhong', 'lisao', 'chayao', 'zaiquan', 'yipen', 'chengu', 'duochan', 'shizi']);
const MOVE_IDS = Object.keys(MOVES).filter(k => !MOVE_OFF.has(k) && !MOVES[k].demo); // demo：試作中的招（搖頭晃腦 5 版），只在練習場給人試
const SHOW_DEMO = !replayView && (document.body.classList.contains('dev') || /^(shanshenbu-test\.|127\.0\.0\.1|localhost)/.test(location.hostname));
if (SHOW_DEMO) ['mv_yaotou', 'mv_yaotou_chant', 'mv_cxk_changtiao', 'mv_cxk_music', 'mv_cxk_jntm', 'mv_cxk_dribble', 'mv_cxk_dance2', 'mv_cxk_nigan', 'mv_cxk_aiyo', 'mv_cxk_niganaiyo'].forEach(loadClip); // 試作招的語音先載好，第一次出招就聽得到

// 闖關：學到的新招各自的強化（威力、冷卻、範圍、多發、持續時間、效果強度、暈眩）
const MV_DEF = { dmg: 1, cd: 1, area: 1, extra: 0, dur: 1, power: 1, stun: 1, kb: 1, ch: 1, ls: 0, echo: 0, dash: 1, launch: 1, pierce: 0, big: 1,
  inv: false, panic: false, cleanse: 0, shield: 0, multi: false, both: false, pull: false, thorns: 0, gheal: 0, reset: false, aoe: false, rmul: 1, blockAll: false, trail: false, dodge: false };
// 可存好幾次的新招：還有次數就能用
function mvReady(ft, id) { const mm = mvMod(ft, id); return mm.ch > 1 ? (ft.mvCh && ft.mvCh[id] != null ? ft.mvCh[id] : mm.ch) > 0 : !(ft.mvcd[id] > 0); }
const mvCdOf = (ft, id) => MOVES[id].cd * (ft.mods ? ft.mods.cdMul : 1) * mvMod(ft, id).cd;
function mvReach(k) { // 這招打得到多遠（含往前衝的距離），Boss 判斷要不要出用
  let r = 0, dash = 0;
  for (const e of MOVES[k].ev) { if (e.hit) r = Math.max(r, e.hit.x1); if (e.grab) r = Math.max(r, e.grab.range); if (e.to != null && e.vx > 0) dash += e.vx * (e.to - e.at); }
  return r + dash * .8;
}
const mvMod = (ft, id) => (ft.mvMods && ft.mvMods[id]) || MV_DEF;
function mvCat(id) { // 招式類型：決定專屬變體
  const ev = MOVES[id].ev;
  if (ev.some(e => e.proj)) return 'proj';
  if (ev.some(e => e.grab)) return 'grab';
  if (ev.some(e => e.hit)) return 'melee'; // 有打人的（下穿拳、雲步、老鷹）算攻擊招，順便能躲只是附帶
  if (ev.some(e => e.guard)) return 'guard';
  if (ev.some(e => e.buff)) return 'buff';
  return 'melee';
}
function doMove(ft, foe, id) {
  const m = MOVES[id], mm = mvMod(ft, id), cd = mvCdOf(ft, id);
  ft.act = { type: 'mv', id, t: 0, dur: m.dur, fired: 0 };
  if (m.armor || ft.maArmor) { // 霸體招：出招期間照樣扣血，但不會被打斷、不會被暈（撞上狗熊會贏）；馬師傅 3 階每招都霸體
    if (!(ft.armorT > 0)) { ft.armorMul = 1; ft.thorns = 0; } // 沒有扁擔式的霸體時：不減傷、不反傷
    ft.armorT = Math.max(ft.armorT, m.dur);
  }
  if (m.dirInput) { const inp = inputFor(ft); ft.act.dirX = inp.L && !inp.R ? -1 : inp.R && !inp.L ? 1 : 0; } // 風擺柳：按左／右就往那邊飄
  if (ladder.on && ft === p2) ft.mvcd[id] = cd * Math.max(.6, 1 - .04 * LV()); // 天梯：電腦冷卻越來越短
  else if (mm.ch > 1) { ft.mvCh = ft.mvCh || {}; ft.mvCh[id] = (ft.mvCh[id] != null ? ft.mvCh[id] : mm.ch) - 1; if (!(ft.mvcd[id] > 0)) ft.mvcd[id] = cd; }
  else ft.mvcd[id] = cd;
  ft.vx = 0; ft.walkPh = 0;
  if (mm !== MV_DEF) { // 闖關新招強化：一出招就生效的
    if (mm.inv) ft.inv = Math.max(ft.inv, m.dur);
    if (mm.cleanse) { ft.ccImmT = Math.max(ft.ccImmT || 0, mm.cleanse); fx.push({ type: 'txt', ft, text: '免控！', color: '#ffd34d', t: 0 }); }
    if (mm.shield) { ft.armorMul = ft.armorT > 0 ? Math.min(ft.armorMul, .5) : .5; ft.armorT = Math.max(ft.armorT, mm.shield); }
  }
  caption(ft, m.name);
  if (ft.char === 'ma') maOnMove(ft, id); // 馬師傅 Boss 只講自己的台詞；玩家穿馬師傅造型照樣唸招式語音
  else if (!m.boss && m.voices !== false && (!rgQuiet(ft) || m.voices)) playClip('mv_' + (m.voices ? m.voices[Math.floor(Math.random() * m.voices.length)] : id)); // 大媽每次罵都要罵
}
// 招式時間軸：到點的事件跑一次；有 to 的是持續一段時間的移動
function moveTick(ft, foe, a, dt) {
  const m = MOVES[a.id], ev = m.ev, mm = mvMod(ft, a.id);
  let moving = false;
  if (m.dirInput && ft.inp) { const i = ft.inp; if (i.L && !i.R) a.dirX = -1; else if (i.R && !i.L) a.dirX = 1; } // 風擺柳：飄的途中也能換左右（像閃身步一樣控方向，但不能往上）
  for (const b of a.bolts || []) if (!b.done && a.t >= b.at) { // 閃電落下：落點左右 60 內、站在地上附近的都挨
    b.done = true; fx.push({ type: 'bolt', x: b.x, r: b.r, t: 0 }); shake = Math.max(shake, 7); synth('kick');
    for (const tg of (RG.on ? rgFoes(ft) : [foe])) if (Math.abs(tg.x - b.x) < b.r && tg.y < 170) applyHit(ft, tg, b.dmg, b.stun, (Math.sign(tg.x - b.x) || ft.face) * 160, 'mv');
  }
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.to != null) { if (a.t >= e.at && a.t < e.to) { ft.vx = (a.dirX ? a.dirX * Math.abs(e.vx) : ft.face * e.vx) * mm.dash; moving = true; if (e.ghost) a.ghost = true; } continue; }
    const bit = 2 ** i; // 不用位元運算：一招超過 31 個事件（雞你太美一路連打）也記得住，最多 53 個
    if (Math.floor(a.fired / bit) % 2 || a.t < e.at || (e.onLand && !ft.grounded)) continue; // onLand：落地那一刻才算
    a.fired += bit;
    if (e.hit) {
      const h = mm === MV_DEF ? e.hit : Object.assign({}, e.hit, { dmg: e.hit.dmg * mm.dmg, x1: e.hit.x1 * mm.area, x0: e.hit.x0 * (e.hit.x0 < 0 ? mm.area : 1), stun: e.hit.stun * mm.stun,
        kb: e.hit.kb * mm.kb * (mm.pull ? -.8 : 1), launch: (e.hit.launch || (mm.launch > 1 ? 380 : 0)) * mm.launch, both: e.hit.both || mm.both, ls: mm.ls });
      for (const tg of (RG.on ? rgFoes(ft) : [foe])) moveHit(ft, tg, h);
      if (mm.echo && RG.on) RG.echo.push({ ft, h: Object.assign({}, h, { dmg: h.dmg * mm.echo }), t: .3 }); // 餘震：過一下再打一次
    }
    if (e.ring || (e.hit && mm.area > 1)) fx.push({ type: 'ring', x: ft.x, color: e.ring || '#ffd34d', t: 0 }); // 範圍強化過的招也畫圈
    if (e.shake) shake = Math.max(shake, e.shake);
    if (e.sfx) synth(e.sfx); // 例：搖頭晃腦每拍一下手「啪」一聲
    if (e.chant && !rgQuiet(ft)) { a.chant = true; startChant(ft, e.chant); } // 跟狗熊一樣：喊完招名接一段長吆喝，招結束或被打斷就停
    if (e.whip) fx.push({ type: 'whip', ft, t: 0 });
    if (e.guard) { ft.guard = { kind: e.guard, dmg: (e.dmg || 16) * mm.dmg, pdmg: (e.pdmg || 0) * mm.dmg, stagger: e.stagger || 0, id: a.id, heal: mm.gheal, reset: mm.reset, aoe: mm.aoe, rmul: mm.rmul, blockAll: mm.blockAll || e.blockAll, stunMul: mm.stun }; ft.guardT = e.dur * mm.dur; if (e.guard === 'inv') ft.inv = Math.max(ft.inv, ft.guardT); } // 無敵：連抓技也抓不到
    if (e.buff) {
      if (e.buff.speed) { ft.spdMul = 1 + (e.buff.speed - 1) * mm.power; ft.spdT = e.buff.dur * mm.dur; if (mm.dodge) { ft.guard = { kind: 'dodgeProj' }; ft.guardT = ft.spdT; } fx.push({ type: 'txt', ft, text: e.buff.pow ? '加速！加力！' : '加速！', color: '#8fffb0', t: 0 }); }
      if (e.buff.pow) { ft.powMul = 1 + (e.buff.pow - 1) * mm.power; ft.powT = e.buff.dur * mm.dur; }
      if (e.buff.armor) { ft.armorMul = e.buff.armor / mm.power; ft.armorT = e.buff.dur * mm.dur; ft.thorns = (e.buff.thorns || 0) + mm.thorns; /* 招式本身的反傷＋闖關強化疊上去 */ fx.push({ type: 'txt', ft, text: '霸體！', color: '#ffd34d', t: 0 }); }
      if (e.buff.ccOnly) { ft.ccOnlyT = Math.max(ft.ccOnlyT || 0, e.buff.ccOnly * mm.dur); fx.push({ type: 'txt', ft, text: '免控！', color: '#ffd34d', t: 0 }); } // 扁擔式、瞭望式：免控但會被擊退
      if (e.buff.heal) { ft.healRate = e.buff.heal * mm.power / e.buff.dur; ft.healT = e.buff.dur; fx.push({ type: 'txt', ft, text: '回血', color: '#8fffb0', t: 0 }); }
    }
    if (e.bolt) { // 選落點（短 130／中 330／長 560，±40），先亮警示
      const d = [130, 330, 560][Math.floor(Math.random() * 3)] + (Math.random() - .5) * 80, x = clampX(ft.x + ft.face * d);
      const r = 60 * (ft.maBoltR || 1); // 馬師傅 2、3 階：落雷範圍 1.5 倍、傷害加倍
      fx.push({ type: 'boltWarn', x, r, t: 0 }); (a.bolts = a.bolts || []).push({ x, r, at: a.t + e.bolt.warn, dmg: e.bolt.dmg * mm.dmg * (ft.maWul || 1), stun: e.bolt.stun });
    }
    if (e.zone) balls.push({ owner: ft, kind: 'zone', x: clampX(ft.x + ft.face * e.zone.d), y: GROUND - 6, vx: 0, vy: 0, g: 0, r: e.zone.r, dmg: e.zone.dmg * mm.dmg, life: e.zone.life, tick: 0, spin: 0, t: 0, src: a.id }); // 地上一灘持續扣血的藥
    if (e.jump) { ft.vy = e.jump; ft.y = Math.max(ft.y, .01); ft.floatT = e.float || 0; }
    if (e.dive) { ft.vy = -e.dive; ft.floatT = 0; }
    if (e.grab) moveGrab(ft, RG.on ? (rgNearest(ft) || foe) : foe, mm === MV_DEF ? e.grab : Object.assign({}, e.grab, { range: e.grab.range * mm.area, dmg: e.grab.dmg * mm.dmg, stun: (e.grab.stun || 1) * mm.stun, kb: mm.kb, multi: mm.multi }));
    if (e.proj) {
      const pj = e.proj, sk = skeleton(sampleKeys(m.keys, a.t), ft.face);
      const dirs = pj.both ? [1, -1] : [1];
      for (const d of dirs) for (let n = 0; n <= mm.extra; n++) { // 強化「多一發」：花拋高一點、地波晚一點出
        const vx = ft.face * d * pj.vx;
        balls.push({ owner: ft, kind: pj.kind, x: ft.x + Math.sign(vx) * (40 - n * (pj.kind === 'wave' ? 70 : 0)), y: pj.kind === 'wave' ? GROUND - 14 : GROUND - ft.y - 210, vx: vx * (1 - n * .12), vy: (pj.vy || 0) * (1 + n * .25), g: pj.g || 0,
          dmg: pj.dmg * mm.dmg, stun: pj.stun * mm.stun, kbv: pj.kb * mm.kb * mm.big, life: pj.life, spin: 0, t: 0, pierce: mm.pierce, r: 15 * mm.big, sc: mm.big, conf: pj.conf });
      }
      synth('whoosh');
    }
  }
  if (mm.trail && !a.trail && a.t >= m.dur * .75) { // 雲步強化：穿過去的時候順手打一圈
    a.trail = true; fx.push({ type: 'ring', x: ft.x, color: '#e8f4ff', t: 0 });
    for (const tg of (RG.on ? rgFoes(ft) : [foe])) moveHit(ft, tg, { both: true, x0: 0, x1: 170, dmg: 10 * mm.dmg, stun: .6, kb: 220 });
  }
  if (!moving && ft.grounded) ft.vx = 0;
}
function moveRange(ft, foe, h) {
  const dx = (foe.x - ft.x) * ft.face;
  if (Math.abs(foe.y - ft.y) > (h.h || 150)) return false;
  if (h.maxY != null && foe.y > h.maxY) return false;
  return h.both ? Math.abs(dx) <= h.x1 : dx >= h.x0 && dx <= h.x1;
}
function moveHit(ft, foe, h) {
  if (!moveRange(ft, foe, h)) return;
  const dir = h.both ? (Math.sign(foe.x - ft.x) || ft.face) : ft.face;
  if (applyHit(ft, foe, h.dmg, h.stun, dir * h.kb * (h.longKb ? ft.maKb || 1 : 1), 'mv') !== true) return; // longKb：馬師傅 3 階的刺拳打更遠
  if (h.launch && !foe.ko && !(foe.mods && foe.mods.noLaunch)) { foe.vy = h.launch; foe.y = Math.max(foe.y, 1); }
  if (h.ls && ft.maxHp) ft.hp = Math.min(ft.maxHp, ft.hp + h.dmg * (ft.mods ? ft.mods.dmg : 1) * h.ls); // 這招的吸血
}
function moveGrab(ft, foe, g) {
  let n = 0;
  if (g.multi && RG.on) for (const tg of rgFoes(ft)) n += grabOne(ft, tg, g); // 強化：一次抓一排
  else n = grabOne(ft, foe, g);
  if (!n) fx.push({ type: 'txt', ft, text: '沒抓到', color: '#c9d4e2', t: 0 });
}
function grabOne(ft, foe, g) {
  const dx = (foe.x - ft.x) * ft.face, st = .6 * (g.stun || 1), kb = g.kb || 1;
  if (foe.ko || foe.inv > 0 || dx < -20 || dx > g.range || Math.abs(foe.y - ft.y) > 120) return 0;
  if (g.mode === 'swap') { foe.x = clampX(ft.x - ft.face * 80); applyHit(ft, foe, g.dmg, st, -ft.face * 220 * kb, 'mv'); }
  else { foe.x = clampX(ft.x + ft.face * 75); applyHit(ft, foe, g.dmg, st, ft.face * 40 * kb, 'mv'); }
  return 1;
}
// 格擋類：回傳 'blocked'（攻擊被吃掉）、'pass'（穿過去、球繼續飛）或 null（照常受傷）
function guardCheck(att, tgt, dmg, kb, kind) {
  if (!(tgt.guardT > 0) || !tgt.guard) return null;
  const G = tgt.guard, g = G.kind, proj = kind === 'ball';
  const ok = () => { // 防守成功：強化過的會回血／冷卻歸零
    if (G.heal && tgt.maxHp) { tgt.hp = Math.min(tgt.maxHp, tgt.hp + G.heal); fx.push({ type: 'txt', ft: tgt, text: '+' + G.heal, color: '#8fffb0', t: 0 }); }
    if (G.reset && tgt.mvcd && G.id) { tgt.mvcd[G.id] = 0; if (tgt.mvCh) delete tgt.mvCh[G.id]; }
  };
  const near = r => RG.on ? rgFoes(tgt).filter(e => Math.abs(e.x - tgt.x) < r) : [att];
  if (g === 'inv') return 'pass';
  if (g === 'dodgeProj') return proj ? 'pass' : null;
  if (g === 'reflect') {
    if (proj) { ok(); return 'reflect'; }
    if (!G.blockAll) return null;
    fx.push({ type: 'txt', ft: tgt, text: '擋！', color: '#9fe0ff', t: 0 }); synth('thud'); ok(); return 'blocked';
  }
  if (g === 'block') {
    fx.push({ type: 'txt', ft: tgt, text: '擋！', color: '#9fe0ff', t: 0 }); synth('thud'); ok();
    if (G.stagger && !proj && att !== tgt) { att.stun = Math.max(att.stun, G.stagger); att.act = null; } // 擋開：近身打來的人被震一下
    return 'blocked';
  }
  if (g === 'parry') {
    for (const e of (G.aoe ? near(300).concat(att) : [att])) { e.stun = Math.max(e.stun, 1 * (G.stunMul || 1)); e.act = null; }
    if (G.pdmg && !proj) { tgt.guardT = 0; applyHit(tgt, att, G.pdmg, 1 * (G.stunMul || 1), -Math.sign(kb || 1) * 200, 'mv'); } // 格開順手打一下
    tgt.guardT = 0; fx.push({ type: 'txt', ft: tgt, text: G.aoe ? '一震全場！' : '格開！', color: '#9fe0ff', t: 0 }); synth('gong'); ok();
    if (G.aoe) fx.push({ type: 'ring', x: tgt.x, color: '#9fe0ff', t: 0 });
    return 'blocked';
  }
  if (g === 'counter') {
    tgt.guardT = 0; tgt.act = null; fx.push({ type: 'txt', ft: tgt, text: '反擊！', color: '#ff9c5a', t: 0 });
    if (G.aoe) { fx.push({ type: 'ring', x: tgt.x, color: '#ff9c5a', t: 0 }); for (const e of near(240)) applyHit(tgt, e, G.dmg || 16, .6, (Math.sign(e.x - tgt.x) || 1) * 360, 'mv'); }
    else if (!proj) applyHit(tgt, att, G.dmg || 16, .6, -Math.sign(kb || 1) * 360, 'mv');
    ok(); return 'blocked';
  }
  return null;
}
function buffTick(ft, dt) {
  if (ft.guardT > 0) ft.guardT -= dt;
  if (ft.armorT > 0) ft.armorT -= dt;
  if (ft.spdT > 0) ft.spdT -= dt;
  if (ft.powT > 0) ft.powT -= dt;
  if (ft.floatT > 0) ft.floatT -= dt;
  if (ft.healT > 0) { ft.healT -= dt; ft.hp = Math.min(ft.maxHp || 200, ft.hp + ft.healRate * dt); }
  if (ft.ccImmT > 0) ft.ccImmT -= dt;
  if (ft.confT > 0) ft.confT -= dt;
  if (ft.ccOnlyT > 0) ft.ccOnlyT -= dt;
  if (ft.pushT > 0) { ft.pushT -= dt; ft.x = clampX(ft.x + ft.pushV * dt); ft.pushV *= Math.pow(.02, dt); } // 免控時挨打：不會暈，但還是被推開
  if (ft.escT > 0) ft.escT -= dt;
  for (const k in ft.mvcd) ft.mvcd[k] = Math.max(0, ft.mvcd[k] - dt);
  if (ft.mvCh) for (const k in ft.mvCh) { // 存好幾次的新招：冷卻好就補一次
    const mx = mvMod(ft, k).ch;
    if (ft.mvCh[k] < mx && !(ft.mvcd[k] > 0)) { ft.mvCh[k]++; if (ft.mvCh[k] < mx) ft.mvcd[k] = mvCdOf(ft, k); }
  }
}
function drawProj(b) {
  if (b.kind === 'yell') { // 罵聲：漫畫對話框＋亂碼
    const a = b.life ? Math.max(0, 1 - b.t / b.life) : 1, sc = .8 + b.t * .9;
    ctx.save(); ctx.globalAlpha = .4 + .6 * a; ctx.translate(b.x, b.y); ctx.scale(sc, sc);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d61f26'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, 40, 22, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d61f26'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('＃＄％！', 0, 7); ctx.restore();
    return true;
  }
  if (b.kind === 'flower') { // 一朵花
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.spin); if (b.sc) ctx.scale(b.sc, b.sc);
    ctx.fillStyle = '#ff7eb6'; for (let i = 0; i < 5; i++) { ctx.rotate(Math.PI * 2 / 5); ctx.beginPath(); ctx.ellipse(0, -11, 7, 11, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#ffe36b'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill(); ctx.restore();
    return true;
  }
  if (b.kind === 'fired') { // 開除通知
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.sin(b.t * 12) * .15);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d61f26'; ctx.lineWidth = 3; ctx.fillRect(-30, -20, 60, 40); ctx.strokeRect(-30, -20, 60, 40);
    ctx.fillStyle = '#d61f26'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('開除！', 0, 7); ctx.restore();
    return true;
  }
  if (b.kind === 'zone') { // 鼠毒：地上一灘藥＋幾包藥
    const a = Math.min(1, b.t / .2) * (b.t > b.life - .4 ? Math.max(0, (b.life - b.t) / .4) : 1);
    ctx.save(); ctx.globalAlpha = .75 * a; ctx.fillStyle = '#8a4fc0'; ctx.beginPath(); ctx.ellipse(b.x, GROUND - 4, b.r, 12, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = a; ctx.fillStyle = '#3d7bd9'; for (const dx of [-45, -12, 22, 50]) ctx.fillRect(b.x + dx - 6, GROUND - 12 - Math.abs(Math.sin(b.t * 3 + dx)) * 4, 12, 8);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('鼠藥', b.x, GROUND - 22); ctx.restore();
    return true;
  }
  if (b.kind === 'babble') { // 胡言亂語：加 LINE 對話框
    ctx.save(); ctx.translate(b.x, b.y); ctx.fillStyle = '#06c755'; ctx.beginPath(); ctx.ellipse(0, 0, 44, 22, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-26, 14); ctx.lineTo(-38, 28); ctx.lineTo(-14, 18); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('加LINE?', 0, 6); ctx.restore();
    return true;
  }
  if (b.kind === 'bball') { drawBasketball(b.x, b.y, 16 * (b.sc || 1), b.spin); return true; } // 蔡徐坤的籃球
  if (b.kind === 'wave') { // 地波
    ctx.save(); ctx.globalAlpha = .8; ctx.fillStyle = '#c9b48a';
    if (b.sc && b.sc !== 1) { ctx.translate(b.x, GROUND); ctx.scale(b.sc, b.sc); ctx.translate(-b.x, -GROUND); }
    ctx.beginPath(); ctx.ellipse(b.x, GROUND - 4, 30, 20 + Math.sin(b.t * 30) * 4, 0, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = '#fff3d0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(b.x, GROUND - 4, 36, 26, 0, Math.PI, 0); ctx.stroke(); ctx.restore();
    return true;
  }
  return false;
}

/* ================= 角色外觀 ================= */
const SKINS = {
  p1: { name: '花鼓燈大師', shirt: '#f3efe4', rib: 'rgba(0,0,0,.07)', trim: '#1b1b1b', pants: '#b7b09b', pantsDark: '#9c957f', shoe: '#1a1a1a', aura: '#7fe3ff' },
  p2: { name: '影分身', shirt: '#3a3d48', rib: 'rgba(255,255,255,.06)', trim: '#e8c35a', pants: '#24262c', pantsDark: '#17181c', shoe: '#0d0d0d', aura: '#ff8a5c' },
};
const SKIN = '#e9c19c', SKIN_D = '#cf9f78';
// 殘影／受擊閃白：直接換算顏色，不用 ctx.filter / shadowBlur（那兩個每筆都要整張畫布重算，出招時會掉幀）
const GHOST_TONE = { b: 1.6, s: .4, cache: new Map() }, FLASH_TONE = { b: 2.2, s: 1, cache: new Map() };
let TONE = null;
function toneColor(c, b, s) {
  let r, g, bl, a = 1, m;
  if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c))) { r = parseInt(m[1], 16); g = parseInt(m[2], 16); bl = parseInt(m[3], 16); }
  else if ((m = /^rgba?\(([^)]+)\)$/.exec(c))) { [r, g, bl, a = 1] = m[1].split(',').map(Number); }
  else return c;
  r *= b; g *= b; bl *= b;
  const gray = .2126 * r + .7152 * g + .0722 * bl;
  const f = v => Math.round(Math.max(0, Math.min(255, gray + (v - gray) * s)));
  return 'rgba(' + f(r) + ',' + f(g) + ',' + f(bl) + ',' + a + ')';
}
function T(c) {
  if (!TONE) return c;
  let v = TONE.cache.get(c);
  if (v === undefined) { v = toneColor(c, TONE.b, TONE.s); TONE.cache.set(c, v); }
  return v;
}

function limb(a, b, w, color) {
  ctx.strokeStyle = T(color); ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}
function drawArm(sh, el, ha, s, f) {
  const skin = s.skin || SKIN, skinD = s.skinD || SKIN_D;
  if (s.sleeve === 'long') { limb(el, ha, 14, s.shirt); limb(sh, el, 16, s.shirt); }      // 長袖（西裝、外套）
  else if (s.sleeve === 'none') { limb(el, ha, 14, skin); limb(sh, el, 16, skin); }      // 毛皮（熊、袋鼠）
  else {
    limb(el, ha, 12, skin);
    limb(sh, el, 13, skin);
    // 短袖（蓋住上臂一半）＋袖口邊
    const mid = [sh[0] + (el[0] - sh[0]) * .55, sh[1] + (el[1] - sh[1]) * .55];
    limb(sh, mid, 20, s.trim);
    limb(sh, [sh[0] + (el[0] - sh[0]) * .47, sh[1] + (el[1] - sh[1]) * .47], 19, s.shirt);
  }
  const hr = s.handR || 7.5;
  ctx.fillStyle = T(s.hand ? s.hand : skinD); ctx.beginPath(); ctx.arc(ha[0], ha[1], hr, 0, 7); ctx.fill();
  if (!s.hand) { ctx.fillStyle = T(skin); ctx.beginPath(); ctx.arc(ha[0], ha[1], hr - 1, 0, 7); ctx.fill(); }
}
function drawLeg(hip, knee, foot, s, f, back) {
  limb(knee, foot, 20, back ? s.pantsDark : s.pants);
  limb(hip, knee, 25, back ? s.pantsDark : s.pants);
  ctx.fillStyle = T(s.paw || s.shoe); ctx.beginPath(); ctx.ellipse(foot[0] + 3 * (back ? -f : f), foot[1] + 4, s.paw ? 15 : 13, s.paw ? 8 : 7, 0, 0, 7); ctx.fill();
}
function drawHead(s, pose, opts, f) {
  const R = L.HEADR, skin = s.skin || SKIN, skinD = s.skinD || SKIN_D, hd = s.head || 'bald';
  const animal = hd === 'bear' || hd === 'mascot';
  if (hd === 'bear') { // 熊：圓耳、淺色口鼻
    ctx.fillStyle = T(skinD); ctx.beginPath(); ctx.arc(-R + 2, -R + 4, 9, 0, 7); ctx.arc(R - 2, -R + 4, 9, 0, 7); ctx.fill();
    ctx.fillStyle = T(skin); ctx.beginPath(); ctx.ellipse(0, 0, R + 3, R + 2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = T(s.belly); ctx.beginPath(); ctx.ellipse(0, 9, 12, 9, 0, 0, 7); ctx.fill();
  } else if (hd === 'mascot') { // 黃袋鼠：長耳朵、長臉
    ctx.fillStyle = T(skin);
    for (const sx of [-1, 1]) { ctx.save(); ctx.rotate(sx * .18); ctx.beginPath(); ctx.ellipse(sx * 9, -R - 16, 7, 18, 0, 0, 7); ctx.fill(); ctx.restore(); }
    ctx.beginPath(); ctx.ellipse(0, 0, R + 1, R + 6, 0, 0, 7); ctx.fill();
  } else {
    ctx.fillStyle = T(skinD); ctx.beginPath(); ctx.ellipse(-R + 1, 3, 4.5, 7, 0, 0, 7); ctx.ellipse(R - 1, 3, 4.5, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = T(skin); ctx.beginPath(); ctx.ellipse(0, 0, R - 2, R + 2, 0, 0, 7); ctx.fill();
    if (hd === 'bald') {
      ctx.fillStyle = T('rgba(255,255,255,.35)'); ctx.beginPath(); ctx.ellipse(-5, -R + 7, 8, 4, -.3, 0, 7); ctx.fill();
      ctx.fillStyle = T('rgba(110,80,60,.18)'); ctx.beginPath(); ctx.ellipse(0, 12, 12, 6, 0, 0, Math.PI); ctx.fill(); // 鬍渣
    }
  }
  // 臉（turn：轉頭看側邊，五官往面向那邊偏；nod：低頭，五官往下）
  ctx.save();
  if (pose.turn || pose.nod) ctx.translate((pose.turn || 0) * f, pose.nod || 0);
  if (animal) {
    ctx.fillStyle = T('#1a1a1a');
    if (opts.face === 'ko') { ctx.strokeStyle = T('#1a1a1a'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-5, 1); ctx.moveTo(-5, -4); ctx.lineTo(-10, 1); ctx.moveTo(5, -4); ctx.lineTo(10, 1); ctx.moveTo(10, -4); ctx.lineTo(5, 1); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(-8, -3, hd === 'mascot' ? 3.4 : 2.4, 0, 7); ctx.arc(8, -3, hd === 'mascot' ? 3.4 : 2.4, 0, 7); ctx.fill();
      if (hd === 'mascot') { ctx.fillStyle = T('#ffffff'); ctx.beginPath(); ctx.arc(-7, -4, 1.2, 0, 7); ctx.arc(9, -4, 1.2, 0, 7); ctx.fill(); } }
    ctx.fillStyle = T(hd === 'mascot' ? '#7a3e1c' : '#1a1a1a'); ctx.beginPath(); ctx.ellipse(0, hd === 'mascot' ? 6 : 5, hd === 'mascot' ? 9 : 5, hd === 'mascot' ? 7 : 3.5, 0, 0, 7); ctx.fill();
    if (opts.face === 'shout') { ctx.fillStyle = T('#c8475a'); ctx.beginPath(); ctx.ellipse(0, 16, 6, 5, 0, 0, 7); ctx.fill(); }
  } else {
    ctx.strokeStyle = T(hd === 'ma' ? (s.brow || '#2a221d') : '#3a2a20'); ctx.lineWidth = hd === 'ma' ? 3.4 : 2.6; ctx.lineCap = 'round'; // 馬師傅：粗眉
    if (hd === 'ma') { ctx.beginPath(); ctx.moveTo(-12, -6); ctx.lineTo(-4, -7); ctx.moveTo(4, -7); ctx.lineTo(12, -6); ctx.stroke(); ctx.strokeStyle = T('#3a2a20'); ctx.lineWidth = 2.6; }
    else if (hd === 'trump' || hd === 'perm') { ctx.beginPath(); ctx.moveTo(-11, -7); ctx.lineTo(-4, -4); ctx.moveTo(4, -4); ctx.lineTo(11, -7); ctx.stroke(); } // 皺眉
    else { ctx.beginPath(); ctx.moveTo(-11, -5); ctx.lineTo(-4, -6); ctx.moveTo(4, -6); ctx.lineTo(11, -5); ctx.stroke(); }
    ctx.fillStyle = T('#2a1d16');
    if (opts.face === 'ko') {
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, -2); ctx.lineTo(-5, 3); ctx.moveTo(-5, -2); ctx.lineTo(-10, 3); ctx.moveTo(5, -2); ctx.lineTo(10, 3); ctx.moveTo(10, -2); ctx.lineTo(5, 3); ctx.stroke();
    } else { ctx.beginPath(); ctx.arc(-7, 0, 2.2, 0, 7); ctx.arc(7, 0, 2.2, 0, 7); ctx.fill(); }
    ctx.strokeStyle = T(skinD); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(-1.5, 7); ctx.lineTo(1.5, 7.5); ctx.stroke();
    if (opts.face === 'shout') { ctx.fillStyle = T('#5a1f1a'); ctx.beginPath(); ctx.ellipse(0, 13, 5, 5, 0, 0, 7); ctx.fill(); }
    else if (opts.face === 'hurt') { ctx.strokeStyle = T('#3a2a20'); ctx.beginPath(); ctx.moveTo(-5, 14); ctx.lineTo(-2, 11); ctx.lineTo(2, 14); ctx.lineTo(5, 11); ctx.stroke(); }
    else if (hd === 'trump') { ctx.fillStyle = T('#8a3a2a'); ctx.beginPath(); ctx.ellipse(0, 13, 3.5, 2.6, 0, 0, 7); ctx.fill(); } // 嘟嘴
    else if (hd === 'chiang') { ctx.fillStyle = T('#ffffff'); ctx.strokeStyle = T('#5a3a2c'); ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-7, 11); ctx.quadraticCurveTo(0, 18, 7, 11); ctx.closePath(); ctx.fill(); ctx.stroke(); } // 招牌露齒笑
    else { ctx.strokeStyle = T('#5a3a2c'); ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-5, 13); ctx.lineTo(5, 13); ctx.stroke(); }
  }
  ctx.restore();
  // 頭頂：頭髮／頭帶／安全帽
  if (hd === 'hair') { // 鼓子秧歌大師：黑髮旁分、有點蓬
    ctx.fillStyle = T('#1c1a1a'); ctx.beginPath(); ctx.ellipse(0, -R + 4, R + 1, 13, 0, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-R - 1, -R + 6); ctx.quadraticCurveTo(-6, -R - 14, R + 2, -R + 2); ctx.lineTo(R + 1, -2); ctx.lineTo(R - 4, -R + 8); ctx.quadraticCurveTo(0, -R, -R + 2, -4); ctx.closePath(); ctx.fill();
  } else if (hd === 'trump') { // 懂王：橘金色大波浪往前梳（放大一點才誇張）
    ctx.save(); ctx.translate(0, -R + 4); ctx.scale(1.3, 1.35); ctx.translate(0, R - 4);
    ctx.fillStyle = T('#f2c14e');
    ctx.beginPath(); ctx.moveTo(-R - 3, -2); ctx.quadraticCurveTo(-R - 6, -R - 10, -2, -R - 12); ctx.quadraticCurveTo(R + 14, -R - 14, R + 9, -R + 4);
    ctx.quadraticCurveTo(R + 2, -R + 8, R - 2, -R + 10); ctx.quadraticCurveTo(0, -R + 2, -R + 4, -R + 12); ctx.lineTo(-R + 2, -2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = T('#d9a22e'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-8, -R - 6); ctx.quadraticCurveTo(6, -R - 12, R + 6, -R); ctx.stroke();
    ctx.restore();
  } else if (hd === 'perm') { // 大媽：燙捲短髮
    ctx.fillStyle = T('#b9787a');
    for (const [cx, cy, r] of [[-R + 1, -6, 8], [R - 1, -6, 8], [-R + 3, -R + 6, 9], [R - 3, -R + 6, 9], [-10, -R - 2, 9], [0, -R - 5, 10], [10, -R - 2, 9], [-R - 2, 4, 6], [R + 2, 4, 6]]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); }
    ctx.fillStyle = T('rgba(255,255,255,.18)'); ctx.beginPath(); ctx.arc(-6, -R - 4, 4, 0, 7); ctx.fill();
  } else if (hd === 'ma') { // 馬師傅：黑色短髮、瀏海往一邊撥（hair 可換顏色），眼角皺紋；bruise＝「我大意了」那隻腫起來的眼睛
    const hc = s.hair || '#1f1c1a';
    ctx.fillStyle = T(hc);
    ctx.beginPath(); ctx.moveTo(-R + 1, 0); ctx.quadraticCurveTo(-R - 3, -R - 5, 0, -R - 6); ctx.quadraticCurveTo(R + 4, -R - 5, R - 1, 0);
    ctx.lineTo(R - 3, -5); ctx.quadraticCurveTo(R - 5, -R + 5, 3, -R + 8); ctx.quadraticCurveTo(-7, -R + 3, -R + 4, -6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-R + 2, -1, 3, 7, 0, 0, 7); ctx.ellipse(R - 2, -1, 3, 7, 0, 0, 7); ctx.fill(); // 鬢角
    ctx.strokeStyle = T('rgba(255,255,255,.18)'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, -R - 1); ctx.quadraticCurveTo(0, -R - 4, 10, -R); ctx.stroke(); // 頭髮反光
    ctx.strokeStyle = T('rgba(110,70,45,.4)'); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-14, 2); ctx.lineTo(-11, 4); ctx.moveTo(14, 2); ctx.lineTo(11, 4); ctx.stroke(); // 笑紋
    if (s.bruise) { ctx.fillStyle = T('rgba(105,55,115,.55)'); ctx.beginPath(); ctx.ellipse(-7, 1, 7, 5.5, 0, 0, 7); ctx.fill(); ctx.fillStyle = T('rgba(150,60,70,.35)'); ctx.beginPath(); ctx.ellipse(-8, -1, 5, 3, 0, 0, 7); ctx.fill(); }
  } else if (hd === 'chiang') { // 蔣萬安：黑色短髮、側分往上往後梳
    ctx.fillStyle = T('#151515');
    ctx.beginPath(); ctx.moveTo(-R - 1, 2); ctx.quadraticCurveTo(-R - 3, -R - 4, -4, -R - 9); ctx.quadraticCurveTo(10, -R - 15, R + 2, -R - 3); ctx.quadraticCurveTo(R + 3, -R + 4, R - 1, 0);
    ctx.lineTo(R - 4, -6); ctx.quadraticCurveTo(R - 6, -R + 6, 4, -R + 5); ctx.quadraticCurveTo(-8, -R + 3, -R + 4, -5); ctx.lineTo(-R + 3, 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = T('rgba(255,255,255,.22)'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-8, -R - 5); ctx.quadraticCurveTo(4, -R - 11, R - 2, -R - 2); ctx.stroke();
  } else if (hd === 'shen') { // 沈伯洋：深棕蓬鬆短髮、瀏海往一邊撥，圓框眼鏡
    ctx.fillStyle = T('#3a2a22');
    ctx.beginPath(); ctx.moveTo(-R - 2, 3); ctx.quadraticCurveTo(-R - 6, -R - 6, 0, -R - 11); ctx.quadraticCurveTo(R + 7, -R - 7, R + 2, 3);
    ctx.lineTo(R - 3, 2); ctx.quadraticCurveTo(R - 3, -6, R - 7, -8); ctx.quadraticCurveTo(-2, -6, -10, -R + 4); ctx.quadraticCurveTo(-R + 3, -R + 6, -R + 3, 3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = T('rgba(255,255,255,.18)'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, -R - 4); ctx.quadraticCurveTo(0, -R - 10, 12, -R - 5); ctx.stroke();
    ctx.save(); if (pose.turn || pose.nod) ctx.translate((pose.turn || 0) * f, pose.nod || 0);
    ctx.strokeStyle = T('#2b1f18'); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-7, 0, 6, 0, 7); ctx.moveTo(13, 0); ctx.arc(7, 0, 6, 0, 7); ctx.moveTo(-1, -1); ctx.lineTo(1, -1); ctx.moveTo(-13, -1); ctx.lineTo(-R + 2, -2); ctx.moveTo(13, -1); ctx.lineTo(R - 2, -2); ctx.stroke(); ctx.restore();
  } else if (hd === 'cxk') { // 蔡徐坤：灰棕色蓬鬆中分、瀏海蓋到眉毛、兩側蓋住耳朵
    const hc = s.hair || '#6b5d55';
    ctx.fillStyle = T(hc);
    // 一整片：外緣蓬到耳下，內緣沿著臉框——兩側瀏海垂到眉尾、中間分線露一點額頭
    ctx.beginPath(); ctx.moveTo(-R - 3, 7); ctx.quadraticCurveTo(-R - 8, -R - 4, 0, -R - 10); ctx.quadraticCurveTo(R + 8, -R - 4, R + 3, 7);
    ctx.lineTo(R - 3, 7); ctx.quadraticCurveTo(R - 1, -3, R - 5, -6); ctx.quadraticCurveTo(8, -9, 2, -R + 3); ctx.lineTo(-2, -R + 3);
    ctx.quadraticCurveTo(-8, -9, -R + 5, -6); ctx.quadraticCurveTo(-R + 1, -3, -R + 3, 7); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = T('rgba(40,30,25,.35)'); ctx.lineWidth = 1.4; ctx.beginPath(); // 髮絲
    for (const sx of [-1, 1]) { ctx.moveTo(sx * 3, -R - 6); ctx.quadraticCurveTo(sx * 12, -R - 2, sx * (R - 2), -5); ctx.moveTo(sx * 6, -R - 8); ctx.quadraticCurveTo(sx * 17, -R, sx * (R + 1), 3); }
    ctx.stroke();
    ctx.strokeStyle = T('rgba(255,255,255,.2)'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, -R - 4); ctx.quadraticCurveTo(-4, -R - 9, 4, -R - 8); ctx.stroke();
  } else if (hd === 'helmet') { // 外送員：黃色安全帽
    ctx.fillStyle = T('#ffcc00'); ctx.beginPath(); ctx.ellipse(0, -R + 6, R + 4, R - 2, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = T('#1b1b1b'); ctx.fillRect(-R - 4, -R + 5, 2 * R + 8, 4);
    ctx.strokeStyle = T('#1b1b1b'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-R + 2, -R + 8); ctx.lineTo(-6, 18); ctx.lineTo(6, 18); ctx.lineTo(R - 2, -R + 8); ctx.stroke(); // 帽帶
  }
}
// 後腦勺（背對鏡頭）：看不到臉，頭髮蓋住整顆頭；耳朵從兩側露出一點
const HAIR_BACK = { hair: '#1c1a1a', trump: '#f2c14e', perm: '#b9787a', ma: '#1f1c1a', chiang: '#151515', shen: '#3a2a22', cxk: '#6b5d55' };
function drawHeadBack(s) {
  const R = L.HEADR, skin = s.skin || SKIN, skinD = s.skinD || SKIN_D, hd = s.head || 'bald';
  if (hd === 'bear') { ctx.fillStyle = T(skinD); ctx.beginPath(); ctx.arc(-R + 2, -R + 4, 9, 0, 7); ctx.arc(R - 2, -R + 4, 9, 0, 7); ctx.fill(); ctx.fillStyle = T(skin); ctx.beginPath(); ctx.ellipse(0, 0, R + 3, R + 2, 0, 0, 7); ctx.fill(); return; }
  if (hd === 'mascot') { ctx.fillStyle = T(skin); for (const sx of [-1, 1]) { ctx.save(); ctx.rotate(sx * .18); ctx.beginPath(); ctx.ellipse(sx * 9, -R - 16, 7, 18, 0, 0, 7); ctx.fill(); ctx.restore(); } ctx.beginPath(); ctx.ellipse(0, 0, R + 1, R + 6, 0, 0, 7); ctx.fill(); return; }
  ctx.fillStyle = T(skinD); ctx.beginPath(); ctx.ellipse(-R + 1, 3, 4.5, 7, 0, 0, 7); ctx.ellipse(R - 1, 3, 4.5, 7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = T(skin); ctx.beginPath(); ctx.ellipse(0, 0, R - 2, R + 2, 0, 0, 7); ctx.fill();
  if (hd === 'helmet') { ctx.fillStyle = T('#ffcc00'); ctx.beginPath(); ctx.ellipse(0, -R + 6, R + 4, R - 2, 0, Math.PI, 0); ctx.fill(); ctx.fillStyle = T('#1b1b1b'); ctx.fillRect(-R - 4, -R + 5, 2 * R + 8, 4); return; }
  if (hd === 'bald') { ctx.fillStyle = T('rgba(255,255,255,.3)'); ctx.beginPath(); ctx.ellipse(4, -R + 7, 8, 4, .3, 0, 7); ctx.fill(); return; }
  const hc = T(s.hair || HAIR_BACK[hd] || '#1c1a1a');
  ctx.fillStyle = hc;
  if (hd === 'cxk') { // 蓬鬆的後腦：比頭大一圈、髮尾蓋過耳朵垂到後頸，從頭頂髮旋往下放射
    ctx.beginPath(); ctx.moveTo(-R - 4, 9); ctx.quadraticCurveTo(-R - 9, -R - 5, 0, -R - 10); ctx.quadraticCurveTo(R + 9, -R - 5, R + 4, 9);
    ctx.quadraticCurveTo(R - 2, R + 4, 0, R + 5); ctx.quadraticCurveTo(-R + 2, R + 4, -R - 4, 9); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = T('rgba(40,30,25,.35)'); ctx.lineWidth = 1.4; ctx.beginPath();
    for (const a of [-1.15, -.6, 0, .6, 1.15]) { ctx.moveTo(1, -R - 3); ctx.quadraticCurveTo(a * 10, -4, a * 15, R + 2); }
    ctx.stroke();
    ctx.strokeStyle = T('rgba(255,255,255,.2)'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, -R - 4); ctx.quadraticCurveTo(0, -R - 9, 10, -R - 5); ctx.stroke();
    return;
  }
  if (hd === 'perm') { for (const [cx, cy, r] of [[-R + 1, -6, 8], [R - 1, -6, 8], [-R + 3, -R + 6, 9], [R - 3, -R + 6, 9], [-10, -R - 2, 9], [0, -R - 5, 10], [10, -R - 2, 9], [-R - 2, 4, 6], [R + 2, 4, 6], [-8, 2, 9], [8, 2, 9], [0, -6, 10], [0, 8, 8]]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); } return; }
  // 一般短髮：蓋住頭頂到後頸，下緣平
  ctx.beginPath(); ctx.moveTo(-R, 6); ctx.quadraticCurveTo(-R - 3, -R - 5, 0, -R - (hd === 'trump' ? 12 : 7)); ctx.quadraticCurveTo(R + 3, -R - 5, R, 6);
  ctx.quadraticCurveTo(0, 12, -R, 6); ctx.closePath(); ctx.fill();
}
// 這個角色這一格的身體比例：look.dims 蓋過預設 L；pose.tl＝軀幹往鏡頭彎時看起來變短的比例（1＝沒彎）
function bodyDims(s, p) {
  const tl = Number.isFinite(p.tl) ? Math.max(.5, Math.min(1, p.tl)) : 1; // 有些舊姿勢沒有 tl，補間出來是 NaN
  if (!s.dims && tl === 1) return L;
  const D = Object.assign({}, L, s.dims); D.TORSO *= tl; return D;
}
function drawFighter(ft, pose, opts = {}) {
  const s = lookOf(ft), f = opts.f ?? ft.face;
  const L = bodyDims(s, pose); // 這個函式裡的 L 都是這個角色、這一格的比例
  const sk = skeleton(pose, f, L);
  const x = opts.x ?? ft.x, air = opts.y ?? ft.y;
  const baseY = GROUND - air - sk.footY - 8 + pose.dy;
  const skin = s.skin || SKIN, skinD = s.skinD || SKIN_D;
  ctx.save();
  ctx.translate(x, baseY);
  if (pose.rot) { ctx.translate(0, sk.footY); ctx.rotate(pose.rot * D2R * f); ctx.translate(0, -sk.footY); }
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  TONE = opts.tone || null;
  const { u, perp, neck } = sk;
  const hw = 22, sw = L.SHW + 6;
  const pt = (a, b) => [u[0] * a + perp[0] * b, u[1] * a + perp[1] * b];
  if (s.scooter) drawScooter(sk, f);
  if (s.tail) { ctx.strokeStyle = T(s.tail); ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-f * 10, 0); ctx.quadraticCurveTo(-f * 60, 10, -f * 70, 46); ctx.stroke(); } // 袋鼠尾巴
  if (s.box) { const b = pt(L.TORSO - 30, -f * 0); ctx.fillStyle = T('#1b1b1b'); ctx.fillRect(b[0] - f * 30 - 24, b[1] - 34, 48, 52); ctx.fillStyle = T('#ffcc00'); ctx.fillRect(b[0] - f * 30 - 24, b[1] - 12, 48, 8); } // 外送箱
  // 身體
  drawLeg(sk.hipB, sk.kneeB, sk.footB, s, f, true);
  drawLeg(sk.hipF, sk.kneeF, sk.footF, s, f, false);
  if (s.skirt) { // 碎花裙：腰到膝蓋的梯形＋小花點
    const [base, dot, leaf] = s.skirt, yb = Math.max(sk.kneeB[1], sk.kneeF[1]) - 6;
    ctx.fillStyle = T(base); ctx.beginPath(); ctx.moveTo(-25, -8); ctx.lineTo(25, -8); ctx.lineTo(36, yb); ctx.lineTo(-36, yb); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 14; i++) { const fx_ = -28 + (i * 37) % 56, fy = -2 + ((i * 23) % Math.max(10, yb)); ctx.fillStyle = T(i % 3 ? dot : leaf); ctx.beginPath(); ctx.arc(fx_, fy, i % 3 ? 3.4 : 2.4, 0, 7); ctx.fill(); }
    ctx.strokeStyle = T(dot); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-36, yb); ctx.lineTo(36, yb); ctx.stroke();
  }
  // 背對鏡頭：手在身體前面會被軀幹擋住，所以先畫手；正面的細節（領口、項鍊、領帶、臉）都不畫
  const back = pose.back >= .5;
  const slip = s.body === 'suspend' && pose.slip >= .5; // 吊帶掉下來：本人右肩那條滑到手臂上（正面在畫面左＝B 邊，背面在畫面右＝F 邊）
  if (back) { drawArm(sk.shB, sk.elB, sk.haB, s, f); drawArm(sk.shF, sk.elF, sk.haF, s, f); }
  // 上衣（軀幹）
  const c = [pt(-8, -hw - 2), pt(-8, hw + 2), pt(L.TORSO - 10, sw), pt(L.TORSO, sw - 10), pt(L.TORSO + 2, -sw + 10), pt(L.TORSO - 10, -sw)];
  ctx.fillStyle = T(s.shirt); ctx.beginPath(); c.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fill();
  const line = (a, b, col, w) => { ctx.strokeStyle = T(col); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  const poly = (pts, col) => { ctx.fillStyle = T(col); ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fill(); };
  const body = s.body || 'tee';
  if (back) {
    if (body === 'suspend') { const yj = pt(L.TORSO - 34, 0); for (const sd of [-1, 1]) if (!(slip && sd === 1)) line(pt(L.TORSO - 4, sd * 17), yj, s.trim, 4.5); line(yj, pt(-6, 0), s.trim, 4.5); } // 吊帶在背後是 Y 字：兩條從肩膀在背中間會合，一條往下到褲頭
    else if (body === 'tee') { for (let i = -3; i <= 3; i++) line(pt(-6, i * 6), pt(L.TORSO - 6, i * 7.5), s.rib, 2); }
    else if (body === 'fur') { const b = pt(36, 0); ctx.fillStyle = T('rgba(0,0,0,.08)'); ctx.beginPath(); ctx.ellipse(b[0], b[1], 18, 30, Math.atan2(u[0], -u[1]), 0, 7); ctx.fill(); }
  }
  else if (body === 'tee') { for (let i = -3; i <= 3; i++) line(pt(-6, i * 6), pt(L.TORSO - 6, i * 7.5), s.rib, 2); } // 直條羅紋
  else if (body === 'print') { poly([pt(26, -hw - 4), pt(26, hw + 4), pt(44, hw + 6), pt(44, -hw - 6)], '#8d8a83'); for (let i = -2; i <= 2; i++) line(pt(30, i * 9 - 3), pt(40, i * 9 + 4), '#5f5c56', 2); } // 胸前一條圖騰印花
  else if (body === 'jersey') { line(pt(L.TORSO - 14, -sw + 2), pt(L.TORSO - 14, sw - 2), s.trim, 5); ctx.save(); const n = pt(46, 0); ctx.translate(n[0], n[1]); ctx.fillStyle = T('#ffffff'); ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('1', 0, 9); ctx.restore(); }
  else if (body === 'fur') { const b = pt(36, 0); ctx.fillStyle = T(s.belly); ctx.beginPath(); ctx.ellipse(b[0], b[1], 18, 30, Math.atan2(u[0], -u[1]), 0, 7); ctx.fill(); }
  else if (body === 'suit') { poly([pt(L.TORSO + 1, -12), pt(L.TORSO - 44, 0), pt(L.TORSO + 1, 12)], '#ffffff'); poly([pt(L.TORSO - 6, -3), pt(L.TORSO - 6, 3), pt(16, 5), pt(10, 0), pt(16, -5)], s.tie || '#d61f26'); line(pt(L.TORSO - 4, -14), pt(L.TORSO - 46, -2), '#111a30', 2.5); line(pt(L.TORSO - 4, 14), pt(L.TORSO - 46, 2), '#111a30', 2.5); }
  else if (body === 'blouse') { line(pt(L.TORSO - 4, -sw + 6), pt(6, sw - 2), '#5a4632', 4); } // 斜背包的背帶
  else if (body === 'tang') { line(pt(L.TORSO - 2, 0), pt(-6, 0), s.trim, 2); for (let a = L.TORSO - 12; a > 0; a -= 13) line(pt(a, -7), pt(a, 7), s.trim, 3.2); } // 唐裝：中間一排盤扣
  else if (body === 'polo') { // POLO 衫：bands＝[起, 迄, 顏色] 橫條（從腰往上量），領子＋門襟兩顆扣
    const wAt = a => hw + (sw - 10 - hw) * Math.max(0, Math.min(1, a / L.TORSO));
    for (const [a0, a1, col] of s.bands || []) poly([pt(a0, -wAt(a0)), pt(a1, -wAt(a1)), pt(a1, wAt(a1)), pt(a0, wAt(a0))], col);
    line(pt(L.TORSO, 0), pt(L.TORSO - 22, 0), s.trim, 2); for (const a of [L.TORSO - 8, L.TORSO - 17]) { const b = pt(a, 0); ctx.fillStyle = T('#f4f4f4'); ctx.beginPath(); ctx.arc(b[0], b[1], 1.8, 0, 7); ctx.fill(); }
  }
  else if (body === 'puffer') { for (let a = 10; a < L.TORSO - 4; a += 13) line(pt(a, -hw - 4), pt(a, hw + 4), 'rgba(255,255,255,.08)', 2); line(pt(L.TORSO, 0), pt(-6, 0), '#0c0c0e', 2.5); } // 鋪棉外套：一格一格車線＋拉鍊
  else if (body === 'suspend') { for (const sd of [-1, 1]) if (!(slip && sd === -1)) line(pt(L.TORSO - 4, sd * 15), pt(-6, sd * 11), s.trim, 4.5); } // 黑高領＋白吊帶
  else if (body === 'rider') { line(pt(30, -hw - 4), pt(30, hw + 4), '#1b1b1b', 7); line(pt(30, -hw - 4), pt(30, hw + 4), '#e8e8e8', 2); line(pt(L.TORSO - 2, 0), pt(14, 0), '#1b1b1b', 2); }
  // 脖子＋領口
  const animal = body === 'fur';
  if (!animal) {
    limb(neck, [neck[0] + u[0] * 10, neck[1] + u[1] * 10], 15, skinD);
    if (back) { if (body === 'suspend' || body === 'tang' || body === 'puffer') limb(neck, [neck[0] + u[0] * 12, neck[1] + u[1] * 12], 19, s.shirt); } // 背面只看到高領／立領
    else if (body === 'suspend') { limb(neck, [neck[0] + u[0] * 12, neck[1] + u[1] * 12], 19, s.shirt); const pd = pt(L.TORSO - 20, 0); line(pt(L.TORSO - 2, -6), pd, '#c9ccd2', 1.2); line(pt(L.TORSO - 2, 6), pd, '#c9ccd2', 1.2); ctx.fillStyle = T('#e4e6ea'); ctx.fillRect(pd[0] - 2.5, pd[1], 5, 8); } // 高領＋銀色項鍊墜子
    else if (body === 'tang') { line(pt(L.TORSO + 1, -12), pt(L.TORSO + 1, 12), s.shirt, 9); line(pt(L.TORSO + 5, -11), pt(L.TORSO + 5, 11), s.trim, 2); } // 立領
    else if (body === 'polo') { poly([pt(L.TORSO + 3, -14), pt(L.TORSO - 9, -4), pt(L.TORSO + 1, 0)], s.collarCol || s.shirt); poly([pt(L.TORSO + 3, 14), pt(L.TORSO - 9, 4), pt(L.TORSO + 1, 0)], s.collarCol || s.shirt); } // POLO 翻領
    else if (body === 'puffer') { poly([pt(L.TORSO + 1, -11), pt(L.TORSO - 14, 0), pt(L.TORSO + 1, 11)], s.inner || '#e9a3b8'); line(pt(L.TORSO + 3, -15), pt(L.TORSO + 3, 15), s.shirt, 8); } // 外套領口露出裡面的襯衫
    else if (s.collar === 'round') { const a = pt(L.TORSO + 2, 0); ctx.fillStyle = T(skin); ctx.beginPath(); ctx.ellipse(a[0], a[1], 12, 7, Math.atan2(perp[1], perp[0]), 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = T(s.trim); ctx.lineWidth = 3; ctx.stroke(); }
    else if (body === 'tee') {
      const v1 = pt(L.TORSO + 1, -13), v2 = pt(L.TORSO - 26, 0), v3 = pt(L.TORSO + 1, 13);
      poly([v1, v2, v3], skin);
      ctx.strokeStyle = T(s.trim); ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(v1[0], v1[1]); ctx.lineTo(v2[0], v2[1]); ctx.lineTo(v3[0], v3[1]); ctx.stroke();
    }
  }
  // 手臂（後手在軀幹後也照樣畫在上面——正面視角，手常交叉在身前）
  if (!back) { drawArm(sk.shB, sk.elB, sk.haB, s, f); drawArm(sk.shF, sk.elF, sk.haF, s, f); }
  if (slip) { // 滑下來的那條：從褲頭（背面是 Y 字交會點）垂一個弧掛到上臂
    const sh = back ? sk.shF : sk.shB, el = back ? sk.elF : sk.elB, a = back ? pt(L.TORSO - 34, 0) : pt(-6, -11);
    const b = [sh[0] + (el[0] - sh[0]) * .65, sh[1] + (el[1] - sh[1]) * .65];
    ctx.strokeStyle = T(s.trim); ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo((a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 14, b[0], b[1]); ctx.stroke();
  }
  // 頭
  const [hx, hy] = sk.head;
  ctx.save(); ctx.translate(hx, hy); ctx.rotate((pose.lean + pose.head) * D2R * f);
  if (back) drawHeadBack(s); else drawHead(s, pose, opts, f);
  ctx.restore();
  ctx.restore();
  TONE = null;
  return { sk, x, baseY };
}

/* ================= 角色（之後當敵人／Boss 用；目前沙盒可選來試招）=================
   look：外觀設定。head 頭型、body 上衣樣式、sleeve 袖子、skin 膚色、hand 手（手套／熊掌）、paw 腳掌、tail 尾巴、scooter 機車、box 外送箱 */
const CHARS = {
  teacher: { name: '花鼓燈大師', moves: ['shan', 'ball', 'bear'], look: Object.assign({ head: 'bald', body: 'tee' }, SKINS.p1) },
  master: { name: '鼓子秧歌大師', boss: true, moves: ['shan', 'ball', 'bear'],
    look: { name: '鼓子秧歌大師', head: 'hair', body: 'print', shirt: '#c9c5bc', trim: '#9a968e', pants: '#1e1e22', pantsDark: '#141417', shoe: '#111', aura: '#ffd34d', collar: 'round' } },
  bear: { name: '狗熊', moves: ['bear'],
    look: { name: '狗熊', head: 'bear', body: 'fur', sleeve: 'none', shirt: '#8a5a32', skin: '#8a5a32', skinD: '#6e4526', belly: '#b98a5a', pants: '#7c5029', pantsDark: '#6a4422', paw: '#5a3a1e', hand: '#6e4526', aura: '#ffb070' } },
  mascot: { name: '黃袋鼠', moves: ['daqi'],
    look: { name: '黃袋鼠', head: 'mascot', body: 'fur', sleeve: 'none', shirt: '#ffd21f', skin: '#ffd21f', skinD: '#e8b800', belly: '#fff0a8', pants: '#ffd21f', pantsDark: '#e8bb08', paw: '#ffd21f', hand: '#ffd21f', handR: 9, tail: '#ffd21f', aura: '#fff07a' } },
  trump: { name: '懂王', moves: ['ball'],
    look: { name: '懂王', head: 'trump', body: 'suit', sleeve: 'long', shirt: '#1f2a44', trim: '#ffffff', pants: '#1f2a44', pantsDark: '#172036', shoe: '#111', skin: '#eba06a', skinD: '#d08650', aura: '#ff6b6b' } },
  auntie: { name: '暴躁大媽', moves: ['scold'],
    look: { name: '暴躁大媽', head: 'perm', body: 'blouse', shirt: '#f4f1ea', trim: '#d9d4c8', collar: 'round', skirt: ['#f6d2c4', '#d9826a', '#8fb36a'],
      pants: '#e9c19c', pantsDark: '#cf9f78', shoe: '#f2f2f2', aura: '#ff9ccf' } },
  ma: { name: '馬師傅', boss: true, moves: ['shan', 'wulian'], // 天梯 Boss；造型只能打贏天梯最後一關拿到
    look: { name: '馬師傅', head: 'ma', body: 'tang', sleeve: 'long', shirt: '#f2eee3', trim: '#2b2b2b', pants: '#1c1c21', pantsDark: '#131317', shoe: '#1a1a1a', skin: '#e6bb94', skinD: '#c99872', aura: '#9fe0ff' } },
  cxk: { name: '蔡徐坤', moves: ['kuaxia', 'jntm', 'chunchun'], // 試作：測試版衣櫃免費穿、練習場可當木樁
    look: { name: '蔡徐坤', dims: { TORSO: 73, TH: 66, SH: 66, UA: 45, FA: 40 }, // 原片量的：腿長身體短（軀幹:大腿:小腿 ≈ 1:0.9:0.9），總高度跟其他角色一樣
      head: 'cxk', body: 'suspend', sleeve: 'long', shirt: '#17171b', trim: '#f2f2f2', pants: '#8e8a86', pantsDark: '#77736f', shoe: '#141414', skin: '#f3d6c1', skinD: '#dcb59c', aura: '#ff9de2' } },
  chiang: { name: '蔣萬安', moves: ['wenda', 'shuyao', 'kanshu'], // 期間限定試作（2026 台北市長選舉）
    look: { name: '蔣萬安', head: 'chiang', body: 'suit', sleeve: 'long', shirt: '#26385f', trim: '#ffffff', tie: '#8fb6e0', pants: '#26385f', pantsDark: '#1c2a48', shoe: '#111', skin: '#efc9a8', skinD: '#d8ad8a', aura: '#6fa8ff' } },
  shen: { name: '沈伯洋', moves: ['feipu', 'shuangbiao', 'huyan'],
    look: { name: '沈伯洋', head: 'shen', body: 'suit', sleeve: 'long', shirt: '#8d9096', trim: '#ffffff', tie: '#1f2740', pants: '#8d9096', pantsDark: '#74777d', shoe: '#111', skin: '#f0cdb0', skinD: '#d8b090', aura: '#5fd38a' } },
  rider: { name: '外送員', moves: ['shan'],
    look: { name: '外送員', head: 'helmet', body: 'rider', sleeve: 'long', shirt: '#ffcc00', trim: '#1b1b1b', pants: '#2b2b30', pantsDark: '#202024', shoe: '#111', box: true, scooter: true, aura: '#ffe36b' } },
};
// 馬師傅外型候選（照原片）：選定之後把 CHARS.ma.look 換成那一版
const MA_BASE = { name: '馬師傅', head: 'ma', skin: '#dcae86', skinD: '#bf8f68', hair: '#1f1c1a', aura: '#9fe0ff', shoe: '#141414' };
const MA_LOOKS = [
  Object.assign({}, MA_BASE, { tag: '1 閃電鞭版', body: 'polo', shirt: '#22336a', trim: '#1a2852', collarCol: '#1a2852', bands: [[47, 61, '#f3f3f3'], [37, 40, '#f3f3f3'], [67, 70, '#f3f3f3']], pants: '#b9aa8b', pantsDark: '#9d8f71' }),
  Object.assign({}, MA_BASE, { tag: '2 大意了版', body: 'puffer', sleeve: 'long', shirt: '#1d1d22', trim: '#111114', inner: '#eaa2b6', pants: '#2b2b31', pantsDark: '#1e1e23', bruise: true }),
  Object.assign({}, MA_BASE, { tag: '3 唐裝版', body: 'tang', sleeve: 'long', shirt: '#f2eee3', trim: '#2b2b2b', pants: '#1c1c21', pantsDark: '#131317' }),
  Object.assign({}, MA_BASE, { tag: '4 練功服版', body: 'tang', sleeve: 'long', shirt: '#17171b', trim: '#efefef', pants: '#17171b', pantsDark: '#0f0f12' }),
  Object.assign({}, MA_BASE, { tag: '5 條紋 POLO＋瘀青', body: 'polo', shirt: '#2d4f9e', trim: '#24407f', collarCol: '#24407f', bands: [[8, 15, '#f3f3f3'], [24, 31, '#f3f3f3'], [40, 47, '#f3f3f3'], [56, 63, '#f3f3f3'], [72, 78, '#f3f3f3']], pants: '#b9aa8b', pantsDark: '#9d8f71', bruise: true }),
];
CHARS.ma.look = MA_LOOKS[0];
// 玩家穿的馬師傅造型：打贏挑戰馬師傅第 1 關／第 7 關才拿得到（不能用鼓幣買）
CHARS.ma1 = { name: '馬師傅（閃電鞭版）', moves: ['shan', 'ball', 'bear'], look: MA_LOOKS[0] };
CHARS.ma2 = { name: '馬師傅（大意了版）', moves: ['shan', 'ball', 'bear'], look: MA_LOOKS[1] };
const isMa = c => c === 'ma' || c === 'ma1' || c === 'ma2'; // 穿馬師傅造型的也講馬師傅自己的台詞
// 五版並排給人挑（?malooks=1）：蓋一張畫布在遊戲上面，每版站姿＋出鞭姿勢
function maSheet() {
  const c = document.createElement('canvas'); c.width = W; c.height = H; c.style.cssText = 'position:fixed;inset:0;margin:auto;z-index:30;width:min(100vw,calc(100vh*16/9));height:auto;aspect-ratio:16/9;background:#3d86c4';
  document.body.appendChild(c);
  const old = ctx; ctx = c.getContext('2d'); drawStage();
  ctx.fillStyle = 'rgba(0,10,30,.25)'; ctx.fillRect(0, 0, W, 110);
  ctx.textAlign = 'center'; ctx.font = 'bold 40px "Microsoft JhengHei",sans-serif'; outlineText('馬師傅造型：五個版本', W / 2, 62, '#ffe600', 7);
  const lash = mp({ fA: 115, fE: -8, bA: -150, bE: -30, lean: 16, head: 6 }, M_LUNGE);
  MA_LOOKS.forEach((lk, i) => {
    CHARS['ma_v' + i] = { name: lk.tag, look: lk };
    const f = new Fighter('p2', 0, 1); f.char = 'ma_v' + i;
    const x = 120 + i * 240;
    ctx.save(); ctx.translate(x, 0); ctx.scale(.78, .78); ctx.translate(-x, GROUND * (1 / .78 - 1));
    drawFighter(f, N, { x: x - 40, y: 0, f: 1 });
    ctx.globalAlpha = .9; drawFighter(f, lash, { x: x + 85, y: 0, f: 1, face: 'shout' });
    ctx.restore();
    ctx.font = 'bold 26px "Microsoft JhengHei",sans-serif'; outlineText(lk.tag, x + 20, 160, '#fff', 6);
  });
  ctx = old;
  return c;
}
if (params.get('malooks') === '1') setTimeout(maSheet, 300);
const CHAR_IDS = Object.keys(CHARS);
function lookOf(ft) { return ft.look || (ft.char && CHARS[ft.char] && CHARS[ft.char].look) || SKINS[ft.id]; } // ft.look：2.5D 闖關的雜兵直接帶外觀

// 暴躁大媽專用：罵街——指著你罵，罵聲往前噴（敵人專用，不在擴充模式的招式池）
MOVES.scold = { name: '大媽罵街', cd: 2.5, dur: .8, desc: '指著對方大罵，罵聲往前噴出去', voices: ['scold1', 'scold2', 'scold3', 'scold4', 'scold5'],
  keys: [[0, N], [.15, P({ lean: -6, head: -8, bA: -30, bE: 110, fA: 40, fE: 20 })], [.3, P({ lean: 14, head: 10, turn: 4, bA: -45, bE: 110, fA: 92, fE: -6, bT: -14, bK: 6, fT: 16, fK: -8 })],
    [.65, P({ lean: 12, head: 14, turn: 4, bA: -45, bE: 110, fA: 96, fE: -10, bT: -14, bK: 6, fT: 16, fK: -8 })], [.8, N]],
  ev: [{ at: .3, proj: { kind: 'yell', vx: 560, dmg: 7, stun: .35, kb: 180, life: .65 } }] };
// 馬師傅專用：閃電五連鞭——連甩五鞭，每鞭在短／中／長距離隨機落一道閃電（地上先亮警示 0.3 秒，躲得掉）；玩家學不到
MOVES.wulian = { name: '閃電五連鞭', cd: 5, dur: 1.7, boss: true, desc: '連甩五鞭，每鞭在短、中、長距離隨機落一道閃電',
  keys: [[0, N], [.18, mp(M_V, { lean: -8, head: -6 })], ...[0, 1, 2, 3, 4].flatMap(i => [[.3 + i * .2, mp({ fA: 115, fE: -8, bA: -150, bE: -30, lean: 16, head: 6 }, M_LUNGE)], [.4 + i * .2, mp(M_V, { lean: -4 })]]), [1.7, N]],
  ev: [.3, .5, .7, .9, 1.1].map(at => ({ at, bolt: { dmg: 9, stun: .45, warn: .3 } })) };
// 馬師傅專用三招：接（像平護，格開）／化（像敗式，被打自動反擊）／發（左正蹬→右鞭腿→左刺拳，配原片那句語音的節奏，最後刺拳擊退很遠）
MOVES.jie = Object.assign({}, MOVES.pinghu, { name: '接', cd: 2, boss: true, desc: '接：格開對手的攻擊，對手震住 1 秒、再挨一下', ev: [{ at: 0, guard: 'parry', dur: .45, pdmg: 10 }] });
MOVES.hua = Object.assign({}, MOVES.baishi, { name: '化', cd: 3, boss: true, desc: '化：縮身化勁，這時被打會自動反擊', ev: [{ at: .05, guard: 'counter', dur: .8, dmg: 22 }] });
{
  const guard = mp(M_LOW, { bA: 40, bE: 110, fA: 30, fE: 120, lean: 4 });
  const kickF = mp({ fT: 86, fK: 0, bT: -8, bK: 10, lean: -14, bA: -40, bE: 60, fA: 40, fE: -40 });   // 左正蹬：前腳直直踹出去
  const kickB = mp({ bT: 88, bK: 8, fT: -6, fK: 6, lean: -20, head: -6, bA: 60, bE: 40, fA: -50, fE: 30 }); // 右鞭腿：後腳甩上來
  const jab = mp(M_LUNGE, { fA: 92, fE: 0, bA: 40, bE: 105, lean: 16, head: 6 });                          // 左刺拳
  MOVES.fa = { name: '發', cd: 5, dur: 4, boss: true, desc: '發：一個左正蹬、一個右鞭腿、一個左刺拳，最後一拳把人打飛很遠',
    keys: [[0, N], [.45, guard], [.75, kickF], [1.15, kickF], [1.45, guard], [2.4, guard], [2.65, kickB], [3, kickB], [3.2, guard], [3.45, jab], [3.8, jab], [4, N]],
    ev: [{ at: .5, to: .78, vx: 360 }, { at: .82, hit: { x0: 0, x1: 165, dmg: 10, stun: .5, kb: 300 } },
      { at: 2.38, to: 2.64, vx: 360 }, { at: 2.7, hit: { x0: -20, x1: 175, dmg: 12, stun: .6, kb: 260 } },
      { at: 3.28, to: 3.48, vx: 460 }, { at: 3.52, hit: { x0: 0, x1: 150, dmg: 12, stun: .5, kb: 1000, longKb: true } }] };
}
// 黑白足球（浪子踢球用）
function drawSoccer(x, y, spin, r = 15, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y);
  ctx.fillStyle = T('#ffffff'); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.clip(); ctx.rotate(spin);
  const pent = (cx, cy, s, rot) => { ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = rot + i * Math.PI * 2 / 5 - Math.PI / 2; ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * s, cy + Math.sin(a) * s); } ctx.closePath(); ctx.fill(); };
  ctx.fillStyle = T('#111111'); pent(0, 0, r * .36, 0);
  for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5 - Math.PI / 2; pent(Math.cos(a) * r * .95, Math.sin(a) * r * .95, r * .33, a + Math.PI); }
  ctx.strokeStyle = T('#333333'); ctx.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5 - Math.PI / 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * .36, Math.sin(a) * r * .36); ctx.lineTo(Math.cos(a) * r * .62, Math.sin(a) * r * .62); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = T('#222222'); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
  ctx.restore();
}
// 機車（外送員）：畫在腳下，跟著人走
function drawScooter(sk, f) {
  ctx.save(); ctx.translate(0, sk.footY + 2); ctx.scale(1.45, 1.45); ctx.translate(0, -6); // 放大成機車的尺寸
  const y = 0;
  ctx.fillStyle = T('#222222');
  for (const wx of [f * 52, -f * 44]) { ctx.beginPath(); ctx.arc(wx, y + 14, 13, 0, 7); ctx.fill(); }
  ctx.fillStyle = T('#9aa0a6'); for (const wx of [f * 52, -f * 44]) { ctx.beginPath(); ctx.arc(wx, y + 14, 5, 0, 7); ctx.fill(); }
  ctx.fillStyle = T('#ff8fb1'); // 粉紅車身
  ctx.beginPath(); ctx.moveTo(-f * 62, y + 4); ctx.lineTo(-f * 58, y - 22); ctx.lineTo(-f * 20, y - 26); ctx.lineTo(-f * 14, y - 4); ctx.lineTo(f * 34, y - 4); ctx.lineTo(f * 58, y + 6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = T('#d65f86'); ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(f * 50, y + 6); ctx.lineTo(f * 34, y - 70); ctx.stroke(); // 龍頭
  ctx.strokeStyle = T('#222222'); ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(f * 26, y - 72); ctx.lineTo(f * 44, y - 70); ctx.stroke();
  ctx.restore();
}

/* ================= 角色邏輯 ================= */
let p1, p2, balls = [], ghosts = [], fx = [], captions = [], shake = 0, hitstop = 0;
let mode = 'title', vsCPU = true, round = 1, wins = [0, 0], timer = 60, banner = null, stateT = 0, menuSel = 0;

function startMatch(cpu, statMode = 'cpu') { // statMode：後台統計算哪個模式（挑戰馬師傅 ma、排位賽 rank）
  ladder.on = false; RG.on = false; NN.comboMatch = false; NN.level = null; NN.mc = null; NN.matchGen = null; NN.maAI = false; MC.on = false; QP.lv = 0; RK.on = false; // AI 組合對練／關卡／挑戰馬師傅開打時會在 startMatch 之後再打開
  vsCPU = cpu; wins = [0, 0]; round = 1;
  p1 = new Fighter('p1', 380, 1); p2 = new Fighter('p2', 900, -1); // 新角色＝預設招式欄（擴充模式由 extTryStart 換掉）
  const pf = profLoad(); p1.char = pf.skin || 'teacher'; // 造型：每個模式都穿
  if (net.role === 'host') p2.char = okSkin(net.peerSkin) ? net.peerSkin : undefined; else if (!cpu && pf.skin2) p2.char = pf.skin2;
  startRound(); layoutPads();
  RB.pending = !cpu && net.role === 'host' && net.peer; // 線上：呼叫的地方接著會設招式、造型，下一幀（rbBegin）再把整個開場狀態傳給對手
  stat.start(net.role === 'host' ? (statMode === 'rank' ? 'rank' : 'online') : cpu ? statMode : 'local', net.role === 'host' ? 'host' : null);
}
function startRound() {
  p1.reset(380, 1); p2.reset(900, -1); balls = []; ghosts = []; fx = []; captions = []; stopChant();
  timer = 60; mode = 'intro'; stateT = 0; banner = { text: '第 ' + round + ' 回合', sub: '開打！', t: 0 };
  for (const f of [p1, p2]) if (f.maTier) f.hp = f.hpShow = f.maxHp; // 馬師傅每回合補滿他自己的血量 NN.hist = []; NN.acc = 0;
  const ma = [p1, p2].find(f => f.char === 'ma'); if (ma) maSay(ma, 'wude'); // 馬師傅 Boss 開場
}

function inputFor(ft) { // 被「胡言亂語」打中：左右鍵相反
  const i = inputRaw(ft);
  return ft.confT > 0 && i ? Object.assign({}, i, { L: i.R, R: i.L }) : i;
}
// 鼠毒那灘藥：對手站在裡面（在地上）每 0.5 秒扣一次血，不打斷、不擊退
function zoneTick(b, dt) {
  b.t += dt; b.tick -= dt;
  const tgt = b.owner === p1 ? p2 : p1;
  if (b.tick > 0 || !tgt || tgt.ko || tgt.inv > 0 || tgt.y > 40 || Math.abs(tgt.x - b.x) > b.r) return;
  b.tick = .5; const dmg = Math.max(1, Math.round(b.dmg));
  tgt.hp = Math.max(0, tgt.hp - dmg); tgt.flash = .12;
  if (PR.on) { const o = b.owner, act = o.act; o.act = null; o._last = b.src; prHit(o, dmg); o.act = act; } // 練習場記在「鼠毒攻擊」名下
  fx.push({ type: 'num', x: tgt.x, y: hurtbox(tgt).y0 - 10, t: 0, text: '-' + dmg });
  if (tgt.hp <= 0) { tgt.ko = true; tgt.vy = 500; tgt.y = Math.max(tgt.y, 1); }
}
function inputRaw(ft) {
  if (RB.stepping) return RB.inp[ft === p1 ? 0 : 1]; // 線上對戰：兩邊都照「這一格」的按鍵算（見 rbStep）
  if (ft.ai) return ft.ai.inp; // 闖關模式的敵人
  if (SB && ft === p1) { const k = SB.fire; SB.fire = null; return { L: false, R: false, U: false, Up: false, S1: k === 'shan', S2: k === 'ball', S3: k === 'bear' }; }
  if (SB && ft === p2) return { L: false, R: false, U: false, Up: false, S1: false, S2: false, S3: false };
  if (ft === p2 && vsCPU) return cpuInput;
  const m = ft === p1 ? MAP.p1 : MAP.p2;
  const both = (vsCPU || net.role === 'host') && ft === p1; // 打電腦／線上時，方向鍵＋, . / 也能操控 1P
  const has = (k, set) => any(m[k], set) || (both && any(MAP.p2[k], set));
  // U＝按住「上」（閃身步往上閃用）；Up＝剛按下跳。搖桿往上推只算 U（瞄準），不會跳
  return { L: has('L', keys), R: has('R', keys), U: has('U', keys) || (ft === p1 && keys.has('StickUp')), S1: has('S1', pressed), S2: has('S2', pressed), S3: has('S3', pressed), X: ft === p1 && (RG.on || ladder.on) ? MAP.p1.X.map(c => any(c, pressed)) : null, Up: has('J', pressed) };
}

function caption(ft, text) {
  if (RG.on && ft !== p1 && !ft.boss) return; // 闖關：雜兵不跳字幕
  captions = captions.filter(c => c.ft !== ft);
  captions.push({ ft, text, t: 0 });
}

function doSkill(ft, foe, inp, which) {
  const prevShanCd = ft.cd.shan, quiet = rgQuiet(ft) || ft.char === 'ma'; // 馬師傅 Boss 不唸原本三招的語音
  startBaseSkill(ft, foe, inp, which);
  if (which === 'shan') {
    caption(ft, '閃身步'); if (!quiet) playClip('shan'); synth('whoosh');
  } else if (which === 'ball') {
    caption(ft, '浪子踢球'); if (!quiet) playClip('ball');
  } else if (which === 'bear') {
    caption(ft, '狗熊哆嗦毛'); if (!quiet) playClip('bear', .9);
    stopChant(ft); // 先喊完「狗熊哆嗦毛」，再接原片的「隆咚框」吆喝（見 updateFighter）
  }
  if (ft.char === 'ma') maOnMove(ft, which);
  if (ladder.on && ft === p2) ft.cd[which] *= Math.max(.6, 1 - .04 * LV()); // 天梯：電腦冷卻越來越短
  if (ft.mods) { // 闖關強化：冷卻倍率；閃身步可存好幾次（用一次扣一格，冷卻在跑就不重設）
    if (which === 'shan') { ft.shanCh--; ft.cd.shan = prevShanCd > 0 ? prevShanCd : CD.shan * ft.mods.cdMul; }
    else ft.cd[which] *= ft.mods.cdMul;
  }
}
// 闖關模式：雜兵太多時不要每隻都喊（Boss 照喊）
function rgQuiet(ft) {
  if (!RG.on || ft === p1 || ft.boss) return false;
  const now = performance.now(); if (now - RG.lastVoice < 1500) return true;
  RG.lastVoice = now; return false;
}

// 三格招式：原本三招走 doSkill（冷卻在 ft.cd），新招走 doMove（冷卻在 ft.mvcd）
const ORIG = { shan: { name: '閃身步', ch: '閃' }, ball: { name: '浪子踢球', ch: '踢' }, bear: { name: '狗熊哆嗦毛', ch: '熊' } };
const skName = k => ORIG[k] ? ORIG[k].name : MOVES[k].name;
const skChar = k => ORIG[k] ? ORIG[k].ch : MOVES[k].name[0];
const skCd = (ft, k) => ORIG[k] ? ft.cd[k] : (ft.mvcd[k] || 0);
const skMax = k => ORIG[k] ? CD[k] : MOVES[k].cd;
function slotReady(ft, k) {
  if (k === 'shan') return ft.mods ? ft.shanCh > 0 : ft.cd.shan <= 0;
  return skCd(ft, k) <= 0 && ft.grounded;
}
function useSlot(ft, foe, inp, i) {
  const k = ft.load[i]; ft.used[i] = 1; ft._last = k; // 練習場記錄「這下是哪一招打的」
  if (ORIG[k]) doSkill(ft, foe, inp, k); else doMove(ft, foe, k);
}
function applyHit(att, tgt, dmg, stunT, kb, kind) {
  if (!canHit(tgt)) return false;
  const gc = guardCheck(att, tgt, dmg, kb, kind); if (gc) return gc; // 新招的格擋／反擊／反彈
  if (att.maCC) stunT = Math.max(stunT * att.maCC, .5); // 馬師傅 3 階：被他打到會被控更久
  let mul = (att.mods ? att.mods.dmg : att.dmgMul || 1) * (att.powT > 0 ? att.powMul : 1), crit = false; // 闖關：強化／關卡倍率；瞭望式加力
  const am = att.mods, tm = tgt.mods;
  if (am && am.lowhp && att.hp < att.maxHp * .35) mul *= 1.4; // 背水一戰
  if (am && am.crit && Math.random() < am.crit) { mul *= 2; crit = true; }
  if (tm) { mul *= tm.dmgTaken; stunT *= tm.stunRes; kb *= tm.kbRes; } // 皮厚、筋骨硬朗、定海神針
  dmg = Math.max(1, Math.round(dmg * mul));
  if (crit) fx.push({ type: 'txt', ft: tgt, text: '會心！', color: '#ff5a5a', t: 0 });
  if (tm && tm.angry) { for (const k in tgt.cd) tgt.cd[k] = Math.max(0, tgt.cd[k] - tm.angry); for (const k in tgt.mvcd) tgt.mvcd[k] = Math.max(0, tgt.mvcd[k] - tm.angry); }
  if (tgt.heavy) { kb *= .35; stunT *= .5; } // 熊、Boss 比較推不動
  if (att.mods && att.mods.ls) att.hp = Math.min(att.maxHp, att.hp + dmg * att.mods.ls); // 吸血
  if (ladder.on && att === p2) dmg = Math.round(dmg * (1 + .06 * LV())); // 天梯：電腦越後面打越痛
  const bearArm = tm && tm.bearArmor && tgt.act && tgt.act.type === 'bear';
  if (tgt.armorT > 0 || tgt.ccImmT > 0 || tgt.ccOnlyT > 0 || bearArm) { // 霸體／免控：傷害照扣（霸體打折），但不會被打斷、不會暈
    dmg = Math.max(1, Math.round(dmg * (tgt.armorT > 0 ? tgt.armorMul : bearArm ? .5 : 1))); tgt.hp = Math.max(0, tgt.hp - dmg); tgt.flash = .12; if (PR.on) prHit(att, dmg);
    if (tgt.ccOnlyT > 0 && !(tgt.armorT > 0) && !(tgt.ccImmT > 0) && !bearArm && kb) { tgt.pushT = .3; tgt.pushV = kb; } // 只有免控（扁擔式、瞭望式）：照樣被擊退
    fx.push({ type: 'num', x: tgt.x, y: hurtbox(tgt).y0 - 10, t: 0, text: '-' + dmg }); synth('thud');
    if (tgt.armorT > 0 && tgt.thorns && att !== tgt && !att.ko) { // 扁擔反震
      const td = Math.max(1, Math.round(dmg / Math.max(.2, tgt.armorMul) * tgt.thorns)); att.hp = Math.max(0, att.hp - td); att.flash = .12;
      fx.push({ type: 'num', x: att.x, y: hurtbox(att).y0 - 10, t: 0, text: '-' + td });
      if (att.hp <= 0) { att.ko = true; att.stun = 0; att.vy = 500; att.y = Math.max(att.y, 1); }
    }
    if (tgt.hp <= 0) { tgt.ko = true; tgt.vy = 500; tgt.y = Math.max(tgt.y, 1); }
    charHurtVoice(tgt);
    return true;
  }
  tgt.hp = Math.max(0, tgt.hp - dmg); if (PR.on) prHit(att, dmg);
  if (isMa(tgt.char) || isMa(att.char)) maOnHit(att, tgt);
  if (tgt.act && (tgt.act.type === 'bear' || tgt.act.chant)) stopChantIf(tgt);
  interruptOnHit(tgt, stunT, kb);
  if (tm && tm.tenacity && stunT > 0) tgt.postCC = tm.tenacity; // 不倒翁：暈完一段時間免控
  const hb = hurtbox(tgt);
  fx.push({ type: 'spark', x: tgt.x - Math.sign(kb) * 10, y: hb.y0 + 90 + Math.random() * 60, t: 0, big: kind === 'ball' });
  fx.push({ type: 'num', x: tgt.x + (Math.random() * 30 - 15), y: hb.y0 - 10, t: 0, text: '-' + dmg });
  shake = Math.max(shake, kind === 'ball' ? 10 : 5); hitstop = impactStop(kind);
  synth(kind === 'ball' ? 'kick' : 'hit');
  knockOut(tgt, kb);
  charHurtVoice(tgt);
  return true;
}
function stopChantIf(ft) { stopChant(ft); }

// 閃身步瞬移＋殘影（房主模擬、對手端本機預測共用）
function shanMove(ft, a) {
  const ox = ft.x, oy = ft.y;
  shanTeleport(ft, a);
  for (let i = 0; i < 5; i++) {
    const k = i / 5;
    ghosts.push({ ft, x: ox + (ft.x - ox) * k, y: oy + (ft.y - oy) * k, pose: a.dir === 'up' ? SHAN_UP : SV().hold, f: a.dir === 'up' ? ft.face : a.travel, t: -i * .02, life: .35 });
  }
  fx.push({ type: 'lines', ft, x0: ox, x1: ft.x, y0: GROUND - oy - 140, y1: GROUND - ft.y - 140, t: 0 });
  if (ft.mods && ft.mods.shanCut && RG.on && a.dir !== 'up') { // 闖關強化：殘影刀，路過的敵人都挨一下
    const lo = Math.min(ox, ft.x) - 40, hi = Math.max(ox, ft.x) + 40;
    for (const tg of rgFoes(ft)) if (tg.x > lo && tg.x < hi && Math.abs(tg.y - oy) < 200) applyHit(ft, tg, 10, .35, a.travel * 140, 'mv');
  }
  if (ft.mods && ft.mods.shanQuake && RG.on) { // 闖關強化：閃身震地
    fx.push({ type: 'ring', x: ft.x, color: '#9fe0ff', t: 0 });
    for (const tg of rgFoes(ft)) if (Math.abs(tg.x - ft.x) < 140 && tg.y < 40) applyHit(ft, tg, 12, .4, (Math.sign(tg.x - ft.x) || 1) * 260, 'mv');
  }
}
function tryEscape(ft, foe, inp, dt) {
  if (ft.stun > 0 && !ft.ko && !ft.win) { // 解控招（風擺柳碎步）：被暈、被鎖住的時候也能放，放了就脫身
    const j = [inp.S1, inp.S2, inp.S3].findIndex((pr, n) => pr && MOVES[ft.load[n]] && MOVES[ft.load[n]].panic && !(ft.mvcd[ft.load[n]] > 0));
    // 天梯／闖關帶的招用數字鍵 1～0 放，也要能解控
    const xk = j < 0 && inp.X && ft.extra ? ft.extra.find((k, n) => inp.X[n] && MOVES[k] && MOVES[k].panic && mvReady(ft, k)) : null;
    // 電腦（天梯對手、闖關敵人）：被暈超過 0.3 秒、身上有解控招，就有機會用
    const cpuMoves = ft.ai || (ft === p2 && vsCPU && (ladder.on || MC.on)) ? ft.atk : null;
    const ck = j < 0 && !xk && cpuMoves && ft.stun > .3 && Math.random() < dt * 3 ? cpuMoves.find(k => MOVES[k] && MOVES[k].panic && !(ft.mvcd[k] > 0)) : null;
    if (j >= 0 || xk || ck) {
      ft.stun = 0; if (ft.act && ft.act.type === 'bear') stopChant(ft); ft.act = null; ft.face = Math.sign(foe.x - ft.x) || ft.face;
      fx.push({ type: 'txt', ft, text: '解控！', color: '#ffd34d', t: 0 });
      if (j >= 0) useSlot(ft, foe, inp, j); else doMove(ft, foe, xk || ck);
    }
  }
  if (ft.stun > 0 && ft.mods && !ft.ko && !ft.win) { // 闖關解控：被暈的時候也能掙脫
    const xi = inp.X && ft.extra ? ft.extra.findIndex((k, j) => inp.X[j] && (mvMod(ft, k).panic || MOVES[k].panic) && mvReady(ft, k)) : -1;
    if (inp.S1 && ft.mods.escape && !(ft.escT > 0)) { // 金蟬脫殼：用閃身步掙脫（不花次數）
      const ch = ft.shanCh, cd = ft.cd.shan;
      ft.stun = 0; ft.act = null; ft.escT = 6; ft.ccImmT = Math.max(ft.ccImmT || 0, .6);
      fx.push({ type: 'txt', ft, text: '金蟬脫殼！', color: '#ffd34d', t: 0 }); doSkill(ft, foe, inp, 'shan'); ft.shanCh = ch; ft.cd.shan = cd;
    } else if (xi >= 0) { ft.stun = 0; ft.act = null; fx.push({ type: 'txt', ft, text: '解控！', color: '#ffd34d', t: 0 }); doMove(ft, foe, ft.extra[xi]); }
  }

}

const browserBattle = {
  inputFor, buffTick, tryEscape, slotReady, useSlot, moveTick, shanMove, applyHit, stopChant, zoneTick,
  afterStunTick(ft) {
    if (ft.stun <= 0 && ft.postCC) {
      ft.ccImmT = Math.max(ft.ccImmT || 0, ft.postCC);
      ft.postCC = 0;
      fx.push({ type: 'txt', ft, text: '不倒翁！', color: '#ffd34d', t: 0 });
    }
  },
  useExtra(ft, foe, inp) {
    const skill = inp.X && ft.extra && ft.extra.find((k, j) => inp.X[j] && mvReady(ft, k));
    if (!skill) return false;
    doMove(ft, foe, skill);
    return true;
  },
  onBallPrep(ft) { fx.push({ type: 'conjure', ft, t: 0 }); synth('pop'); },
  launchBall(ft) { launchBalls(balls, ft, BV().flick); synth('kick'); },
  onBearChant(ft) { if (ft.char !== 'ma') startChant(ft); },
  bearTargets(ft, foe) { return RG.on ? rgFoes(ft) : [foe]; },
  onBearHit(ft, action) { if (action.hits % 3 === 1) fx.push({ type: 'ctrl', ft, t: 0 }); },
  onKnockoutLanding() { synth('thud'); },
  onReflect(ft) { fx.push({ type: 'txt', ft, text: '反彈！', color: '#9fe0ff', t: 0 }); synth('pop'); },
  onPass(ft) { fx.push({ type: 'txt', ft, text: '閃過！', color: '#8fffb0', t: 0 }); },
  onConfused(ft) { fx.push({ type: 'txt', ft, text: '左右顛倒！', color: '#5fd38a', t: 0 }); }
};

function updateFighter(ft, foe, dt) {
  advanceBattleFighter(ft, foe, dt, browserBattle);
}

function poseOf(ft, now) {
  const a = ft.act;
  if (ft.ko) {
    const k = Math.min(1, (ft.koT || 0) / .5);
    return { pose: lerpPose(STUN, KO, ease(k)), face: 'ko' };
  }
  if (a && a.type === 'taunt') { // 滿貫嘲諷：搖頭晃腦（頭跟著抖）
    const p = Object.assign({}, sampleKeys(MOVES.yaotou.keys, a.t)), j = Math.sin(a.t * 90) * 3;
    p.lean += j * .4; p.bA += j; p.fA -= j; p.head += j;
    return { pose: p, face: 'shout' };
  }
  if (ft.win) {
    const ph = Math.sin(now * 6);
    return { pose: lerpPose(BALL_WING, P(Object.assign({}, BALL_WING, { fT: 20, fK: 50, dy: -10 })), (ph + 1) / 2), face: 'shout' };
  }
  if (ft.stun > 0) {
    const j = Math.sin(now * 70) * 5;
    const p = Object.assign({}, STUN); p.lean += j * .6; p.head += j; p.bA += j; p.fA -= j;
    return { pose: p, face: 'hurt' };
  }
  if (a) {
    if (a.type === 'mv') {
      const m = MOVES[a.id]; let p = sampleKeys(m.keys, a.t), f = ft.face;
      if (m.jit) { p = Object.assign({}, p); const j = Math.sin(a.t * 90) * m.jit; p.lean += j * .4; p.bA += j; p.fA -= j; p.head += j; } // 跺顫步的顫
      if (m.spin && a.t > m.spin[0] && a.t < m.spin[1]) f = Math.sin(a.t * 45) > 0 ? ft.face : -ft.face; // 空中轉體
      return { pose: p, f, face: 'shout' };
    }
    if (a.type === 'shan') return { pose: sampleKeys(a.dir === 'up' ? SHAN_UP_KEYS : SV().keys, a.t), f: a.dir === 'up' ? ft.face : a.travel, face: a.t < .4 ? 'shout' : null };
    if (a.type === 'ball') return { pose: sampleKeys(BV().keys, a.t), face: a.t < .5 ? 'shout' : null };
    if (a.type === 'bear') return { pose: bearPose(a.t), face: 'shout' };
  }
  if (!ft.grounded) return { pose: JUMP };
  if (ft.walkPh) {
    const s = Math.sin(ft.walkPh), c = Math.cos(ft.walkPh);
    return { pose: P({ bT: -5 + s * 14, bK: Math.max(0, c) * 18, fT: 5 - s * 14, fK: -Math.max(0, -c) * 18, bA: -10 - s * 8, fA: 10 - s * 8, dy: -Math.abs(c) * 3 }) };
  }
  const br = Math.sin(now * 2.4) * 2; // 呼吸
  return { pose: P({ bA: -10 - br, fA: 10 + br, dy: br * .5 }) };
}

/* ================= 電腦 AI ================= */
const QuickPlayCpu = globalThis.ShanshenbuQuickPlayCpu;
const ruleCpu = QuickPlayCpu.createCpuState(), cpuInput = ruleCpu.input;
function updateCPU(dt) {
  const me = p2, foe = p1, L = LV();
  if (!((ladder.on || MC.on || me.char === 'ma') && me.atk)) {
    QuickPlayCpu.tickRuleCpu(ruleCpu, { p1, p2, balls }, dt, Math.random, L);
    return;
  }

  // 天梯：電腦用自己隨機抽到的 3～6 招；挑戰馬師傅也走這套
  if (!QuickPlayCpu.advanceRuleDecision(ruleCpu, dt, Math.random, L)) return;
  const dx = foe.x - me.x, dist = Math.abs(dx), dirTo = Math.sign(dx) || -1;
  const hold = { L: false, R: false, U: false };
  const toward = d => { if (d > 0) hold.R = true; else hold.L = true; };
  const threat = QuickPlayCpu.incomingProjectile(me, foe, balls);
  if (me.canAct()) {
    me.ldCool -= ruleCpu.think;
    const dodge = threat && me.atk.includes('shan') && me.cd.shan <= 0 && Math.random() < Math.min(.9, .5 + .04 * L);
    const k = dodge ? 'shan' : me.ldCool <= 0 || (threat && Math.random() < .5) ? bossPick(me, dist, threat, foe) : null;
    if (k) {
      me.face = dirTo;
      if (k === 'shan') doSkill(me, foe, threat ? { L: false, R: false, U: Math.random() < .6 } : { L: dirTo < 0, R: dirTo > 0, U: false }, 'shan');
      else if (ORIG[k]) doSkill(me, foe, cpuInput, k); else doMove(me, foe, k);
      me.ldCool = Math.max(.3, 1.1 - .05 * L) * (.7 + Math.random() * .6);
    } else if (dist > 230) toward(dirTo);
    else if (dist < 120 && Math.random() < .4) toward(-dirTo);
    else if (Math.random() < .3) toward(dirTo);
    if (Math.random() < .03) cpuInput.Up = true;
  }
  ruleCpu.hold = hold;
  Object.assign(cpuInput, hold);
}

/* ================= AI 對手（試玩）：訓練出來的神經網路（tools/ai，三招同招對練）=================
   跟訓練時一樣：每 4/60 秒決定一次、看到的是 0.2 秒前（3 次決定前）的盤面；盤面算法照 tools/assets/ai/env.js 的 observe() */
const NN_TIERS = { off: '關（原本的電腦）', weak: '弱', medium: '中', strong: '強' };
const NN = { tier: NN_TIERS[params.get('ai') || lsGet('ssb_ai')] ? params.get('ai') || lsGet('ssb_ai') : 'off', models: {}, acc: 0, hist: [] };
function nnLoad(tier) {
  if (tier === 'off' || NN.models[tier]) return;
  NN.models[tier] = 'loading';
  fetch('assets/ai/base3_' + tier + '.json').then(r => r.json()).then(j => { NN.models[tier] = { dims: j.dims, W: j.W.map(a => Float32Array.from(a)), b: j.b.map(a => Float32Array.from(a)) }; }).catch(() => { NN.models[tier] = null; });
}
if (!replayView) nnLoad(NN.tier);
const nnModel = () => { const m = NN.models[NN.tier]; return m && m !== 'loading' ? m : null; };
// 30 招通用 AI（第 2 階段）：只在「AI 組合對練」裡用，雙方可以帶任意三招
// 新版（逐招特訓，tools/assets/ai/runs/skill2 最強一代）看 v3 盤面；用哪一版存在 ssb_nnv，AI 組合對練畫面可以切
NN.gen = { skill: 'skill', old: 'old' }[params.get('nn') || lsGet('ssb_nnv')] || 'skill';
const NN_GEN_FILE = { old: 'assets/ai/combos_general.json', skill: 'assets/ai/skill_general.json', it03000: 'assets/ai/skill_it03000.json', n160: 'assets/ai/novice_it00160.json', n400: 'assets/ai/novice_it00400.json' }; // it＊：逐招特訓中途的世代，排位賽中段位用
// NN.matchGen：這一場指定用哪一版（挑戰馬師傅固定舊版、排位依段位），不動玩家在 AI 組合對練選的；startMatch 會清掉
const nnGenKey = () => { const g = NN.matchGen || NN.gen; return g === 'old' ? 'general' : g; };
NN.genModel = () => { const m = NN.models[nnGenKey()]; return m && m !== 'loading' ? m : null; };
function nnLoadGeneral(g = NN.matchGen || NN.gen) {
  const key = g === 'old' ? 'general' : g; if (NN.models[key]) return; NN.models[key] = 'loading';
  fetch(NN_GEN_FILE[g]).then(r => r.json()).then(j => { NN.models[key] = { dims: j.dims, W: j.W.map(a => Float32Array.from(a)), b: j.b.map(a => Float32Array.from(a)) }; }).catch(() => { NN.models[key] = null; });
}
// 一般「對戰電腦」雙方都是基本三招 → 三招 AI；AI 組合對練 → 通用 AI（天梯、闖關、練習場照舊）
const nnOn = () => vsCPU && !ladder.on && !RG.on && !PR.on && !net.role && p2 && (p2.char !== 'ma' || NN.maAI) && (NN.comboMatch ? !!NN.genModel()
  : !!nnModel() && ['shan', 'ball', 'bear'].every((k, i) => p2.load[i] === k && p1.load[i] === k));
function nnObserve(me, foe, loadMe, loadFoe) {
  return QuickPlayCpu.observe({ balls, timer, width: W, ground: GROUND, cooldowns: CD }, me, foe, loadMe, loadFoe,
    (ft, k) => (ft.mvcd[k] || 0) / MOVES[k].cd);
}
// 盤面 v2（照 tools/assets/ai/env.js 的 observe2）：再加上雙方帶的三招、正在放第幾格、擋招種類、加速／加力／回血、飛行道具種類
const NN_POOL = ['shan', 'ball', 'bear', 'dahu', 'fengbai', 'pingchou', 'fenshou', 'xiaolun', 'dalun', 'cheshui', 'xieta', 'baishi', 'yaozhong', 'guabian', 'liaowang', 'lisao',
  'shuangchao', 'biandan', 'shizi', 'chayao', 'zhuafen', 'xiachuan', 'shanhong', 'zaiquan', 'sandian', 'laoying', 'feiji', 'yunbu', 'yipen', 'chengu', 'daqi', 'pinghu', 'duochan'];
function nnObserve2(me, foe, loadMe, loadFoe) {
  const o = nnObserve(me, foe, loadMe, loadFoe).slice(0, 43), f = foe.x >= me.x ? 1 : -1;
  for (const [ft, load] of [[me, loadMe], [foe, loadFoe]]) {
    const a = ft.act, slot = !a ? -1 : load.indexOf(a.type === 'mv' ? a.id : a.type);
    for (let i = 0; i < 3; i++) o.push(slot === i ? 1 : 0);
    const g = ft.guardT > 0 && ft.guard ? ft.guard.kind : null;
    for (const k of ['inv', 'block', 'reflect', 'counter', 'dodgeProj', 'parry']) o.push(g === k ? 1 : 0);
    o.push(ft.spdT > 0 ? 1 : 0, ft.powT > 0 ? 1 : 0, ft.healT > 0 ? 1 : 0);
  }
  const bs = balls.map(b => ({ b, d: Math.abs(b.x - me.x) })).sort((p, q) => p.d - q.d);
  for (let i = 0; i < 3; i++) {
    const e = bs[i]; if (!e) { o.push(0, 0, 0, 0, 0, 0, 0, 0); continue; }
    const b = e.b; o.push(1, (b.x - me.x) * f / 1280, (GROUND - b.y - me.y) / 300, b.vx * f / 820, b.owner === me ? 1 : -1);
    for (const k of [undefined, 'flower', 'wave']) o.push(b.kind === k ? 1 : 0);
  }
  for (const load of [loadMe, loadFoe]) for (let i = 0; i < 3; i++) for (const k of NN_POOL) o.push(load[i] === k ? 1 : 0);
  return o;
}
// 盤面 v3（照 tools/assets/ai/env.js 的 observe3）：再加上雙方正在出哪一招、做到幾成、離下一下打出來還有幾秒
const NN_HIT_AT = {};
const nnHitTimes = k => NN_HIT_AT[k] || (NN_HIT_AT[k] = MOVES[k] ? MOVES[k].ev.filter(e => e.hit || e.grab || e.proj).map(e => e.at).sort((a, b) => a - b) : []);
function nnObserve3(me, foe, loadMe, loadFoe) {
  const o = nnObserve2(me, foe, loadMe, loadFoe);
  for (const ft of [me, foe]) {
    const a = ft.act, k = !a ? null : a.type === 'mv' ? a.id : a.type;
    for (const p of NN_POOL) o.push(p === k ? 1 : 0);
    const m = a && a.type === 'mv' ? MOVES[a.id] : null, t = a ? a.t || 0 : 0;
    const nxt = m ? nnHitTimes(a.id).find(x => x >= t - 1e-6) : undefined;
    o.push(m ? Math.min(1, t / m.dur) : 0, nxt == null ? 1 : Math.min(1, nxt - t));
  }
  return o;
}
// 手殘操作（排位低段）：朝一個方向走一陣子才換方向，偶爾才按招，不看距離也不看時機；動作編號＝方向(0 退、1 停、2 進)＋3×按鍵
function nnClumsy(lv) {
  if (!(NN.cTick > 0)) { const r = Math.random(); NN.cDir = r < .45 ? 2 : r < .65 ? 1 : 0; NN.cTick = 8 + Math.floor(Math.random() * 16); }
  NN.cTick--;
  const r = Math.random(), btn = r < lv.press ? 2 + Math.floor(Math.random() * 3) : r < lv.press + .01 ? 1 : 0;
  return NN.cDir + 3 * btn;
}
function nnTick(dt) { // 代替 updateCPU：結果一樣寫進 cpuInput
  if (!QuickPlayCpu.advanceModelDecision(NN, cpuInput, dt)) return;
  const lv = NN.comboMatch && (NN.level || NN.mc), delay = lv ? lv.delay : 3; // 關卡：電腦的反應延遲（1/15 秒為單位）和失誤率
  const obs = !NN.comboMatch ? nnObserve(p2, p1) : NN.genModel().dims[0] > 300 ? nnObserve3(p2, p1, p2.load, p1.load) : nnObserve2(p2, p1, p2.load, p1.load);
  const delayed = QuickPlayCpu.delayObservation(NN, obs, delay);
  // 走神（排位低段）：偶爾整段時間什麼都不做，站著給人打，比亂按更像新手
  if (lv && lv.lapse) { if (NN.zz > 0) NN.zz--; else if (Math.random() < lv.lapse) NN.zz = lv.lapseLen; } else NN.zz = 0;
  let a = NN.zz > 0 ? 1 : lv && lv.dumb && Math.random() < lv.dumb ? nnClumsy(lv) : lv && lv.eps && Math.random() < lv.eps ? Math.floor(Math.random() * 18) : QuickPlayCpu.inferAction(NN.comboMatch ? NN.genModel() : nnModel(), delayed);
  // 出招間隔（排位低段）：出過招要隔一段時間才能再出，這段時間只能走動，按鍵不算
  if (lv && lv.gap) { if (NN.wait > 0) { NN.wait--; if (a >= 6) a %= 3; } else if (a >= 6) NN.wait = lv.gap * 15 * (.7 + Math.random() * .6); }
  QuickPlayCpu.decodeAction(a, p2, p1, cpuInput);
  if (p2.extra) Object.assign(cpuInput, cpuInput.U ? { U: false, S1: false, X: [true] } : { X: [false] }); // AI 馬師傅：上＋招1＝第 4 招閃電五連鞭（跟訓練時一樣，tools/assets/ai/env.js）
  if (RK.on) rkNudge(); // 排位：模型僵住不出招時推它一把
}

/* ================= 主迴圈 ================= */
function update(dt) {
  stateT += dt;
  for (const c of captions) c.t += dt; captions = captions.filter(c => c.t < 1.3);
  for (const g of ghosts) g.t += dt; ghosts = ghosts.filter(g => g.t < g.life);
  for (const e of fx) e.t += dt; fx = fx.filter(e => e.t < fxLife(e));
  if (mode === 'title') { menuInput(); return; }
  if (mode === 'intro') { if (stateT > 1.6) { mode = 'fight'; banner = null; } return; }
  if (mode === 'lobby' || mode === 'mvpick') return;
  if (mode === 'over') { if (!RB.stepping && !ladder.on && stateT > 1.5 && (pressed.has('Enter') || pressed.has('Space'))) overNext(); p1.koT = (p1.koT || 0) + dt; p2.koT = (p2.koT || 0) + dt; tauntTick(p1, dt); tauntTick(p2, dt); physicsOnly(dt); return; }
  if (mode === 'roundEnd') {
    const sd = (p1.perf === 2 || p2.perf === 2) && stateT < 1.2 ? dt * .3 : dt; // PERFECT：最後一擊倒地放慢
    p1.koT = (p1.koT || 0) + sd; p2.koT = (p2.koT || 0) + sd; physicsOnly(sd);
    if (stateT > 2.6) {
      if (ladder.on) { if (ladder.lastW === 0) ladderWin(); else ladderEnd(); }
      else if (RB.stepping && (wins[0] >= winNeed() || wins[1] >= winNeed())) { mode = 'over'; stateT = 0; RB.overF = RB.simF; perfTaunt(); } // 線上：統計、排位分數等這一格兩邊都確定了才算（rbTick）
      else if (wins[0] >= winNeed() || wins[1] >= winNeed()) { const w1 = wins[0] >= winNeed(); mode = 'over'; stateT = 0; perfTaunt(); stat.end(w1 ? 'p1' : 'p2'); if (NN.level && w1) lvCleared(NN.level); if (MC.on) maStageEnd(w1); if (RK.on) rkEnd(w1); } else { round++; startRound(); }
    }
    return;
  }
  const nn = nnOn(); if (nn) nnTick(dt); // AI 對手：卡頓（hitstop）時也照算時間，跟訓練時一樣
  if (hitstop > 0) { hitstop -= dt; return; }
  if (vsCPU && !nn) updateCPU(dt);
  updateFighter(p1, p2, dt); updateFighter(p2, p1, dt);
  pushFighters(p1, p2);
  balls = advanceProjectiles(balls, p1, p2, dt, browserBattle);
  timer -= dt;
  if (PR.on) prTick(); // 練習場：不會死、不計時、可以無冷卻
  if (p1.ko || p2.ko || timer <= 0) endRound();
}
// 滿貫結束的嘲諷：馬師傅講「來騙！來偷襲！」，其他角色把整套搖頭晃腦打完（約 10 秒：喊招名、拍手聲、吆喝都有，但不打人）
function perfTaunt() {
  const w = p1.perf ? p1 : p2.perf ? p2 : null; if (!w) return;
  const foe = w === p1 ? p2 : p1; w.face = Math.sign(foe.x - w.x) || w.face;
  if (isMa(w.char)) { maSay(w, 'pian', true); return; }
  w.act = { type: 'taunt', t: 0, dur: MOVES.yaotou.dur };
  playClip('mv_yaotou'); caption(w, '搖頭晃腦');
}
// 結算畫面每格：照搖頭晃腦的事件放拍手聲、接吆喝、往前逼（逼到倒地的人旁邊就停），打完收掉吆喝
function tauntTick(ft, dt) {
  const a = ft.act; if (!a || a.type !== 'taunt') return;
  const foe = ft === p1 ? p2 : p1, t1 = a.t + dt;
  for (const e of MOVES.yaotou.ev) {
    if (e.to != null) { if (t1 >= e.at && t1 < e.to && Math.abs(foe.x - ft.x) > 170) ft.vx = ft.face * e.vx; continue; }
    if (a.t >= e.at || t1 < e.at) continue;
    if (e.sfx) synth(e.sfx);
    if (e.chant) startChant(ft, e.chant);
  }
  if (t1 >= a.dur) stopChant(ft);
}
function physicsOnly(dt) {
  for (const ft of [p1, p2]) {
    ft.x = clampX(ft.x + ft.vx * dt); ft.vx *= Math.pow(.05, dt);
    if (ft.y > 0 || ft.vy > 0) { ft.vy -= GRAV * dt; ft.y += ft.vy * dt; if (ft.y <= 0) { ft.y = 0; ft.vy = 0; } }
    if (ft.stun > 0) ft.stun -= dt;
    if (ft.act) { ft.act.t += dt; if (ft.act.t > ft.act.dur) ft.act = null; }
  }
}
function endRound() {
  stopChant();
  const w = roundWinner(p1, p2);
  let perf = 0;
  if (w >= 0) {
    wins[w]++;
    const winner = w === 0 ? p1 : p2;
    markRoundWinner(winner);
    if (winner.hp >= (winner.maxHp || 200)) winner.cleanW++;
    // 滿貫：這回合打完整場結束、對手一回合都沒贏 → 完封（三戰兩勝才算）；每回合都滿血贏 → PERFECT（挑戰馬師傅一局定勝負也算）
    if (!ladder.on && !PR.on && wins[w] >= winNeed() && wins[1 - w] === 0) perf = winner.cleanW >= wins[w] ? 2 : winNeed() >= 2 ? 1 : 0;
    winner.perf = perf;
  }
  mode = 'roundEnd'; stateT = 0; synth('gong');
  const ko = p1.ko || p2.ko;
  banner = { text: perf === 2 ? 'PERFECT' : ko ? 'K.O.' : (timer <= 0 ? '時間到' : ''), sub: w < 0 ? '平手' : (w === 0 ? '1P' : (vsCPU ? '電腦' : '2P')) + ' 勝！', t: 0 };
  if (perf === 2) { shake = 18; hitstop = 0; }
  if (ladder.on) { ladder.lastW = w; banner.sub = w === 0 ? (ladder.sub === 10 ? '打倒階主！' : '過關！') : '挑戰結束'; }
}

let menuBusy = false;
function menuPick(i) {
  const m = MENU[i]; if (!m || menuBusy) return;
  const locked = m.lock && m.lock();
  menuFeel(m, locked); unlockAudio();
  if (locked) { chestToast('🔒 ' + LOCK_MSG); return; }
  menuBusy = true; setTimeout(() => { menuBusy = false; if (mode === 'title') m.go(); }, 130); // 先讓按鈕縮一下再進去
}
function menuInput() {
  const n = MENU.length;
  if (['ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA'].some(k => pressed.has(k))) menuSel = (menuSel + n - 1) % n;
  if (['ArrowDown', 'KeyS', 'ArrowRight', 'KeyD'].some(k => pressed.has(k))) menuSel = (menuSel + 1) % n;
  const d = MENU.findIndex((m, i) => pressed.has('Digit' + (i + 1)));
  if (d >= 0) menuPick(d);
  else if (pressed.has('Enter') || pressed.has('Space')) menuPick(menuSel);
}
cv.addEventListener('click', e => {
  if (replayView) return;
  ac();
  if (mode === 'title') {
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    const i = MENU.findIndex(m => Math.abs(x - m.x) < m.w / 2 && Math.abs(y - m.y) < m.h / 2);
    if (i >= 0) { menuSel = i; menuPick(i); } else titleClick(x, y);
  } else if (mode === 'over' && stateT > 1.5 && (net.role !== 'guest' || RK.on) && !ladder.on && !(RB.on && !RB.overDone)) overNext(); // 線上：結果兩邊確定、記好分數才往下
});
const winNeed = () => MC.on ? 1 : 2; // 挑戰馬師傅：一局定勝負；其他三戰兩勝（平手就再打一局）
// 一場打完按 Enter／點畫面：線上＝再來一場；關卡、挑戰馬師傅＝回關卡圖；其他回首頁
function overNext() {
  stopChant(); // 嘲諷的吆喝還沒唸完就離開：一起停掉
  if (RK.on) rkResult(); else if (net.role === 'host') hostRematch(); else if (MC.on) maOpen(); else if (NN.level) lvOpen(); else { mode = 'title'; layoutPads(); }
}

/* ================= 繪圖 ================= */
// 背景不會動，畫一次存起來，之後每幀只貼圖
let stageCv = null;
function drawStage() {
  if (!stageCv) {
    stageCv = document.createElement('canvas'); stageCv.width = W; stageCv.height = H;
    const real = ctx; ctx = stageCv.getContext('2d'); paintStage(); ctx = real;
  }
  ctx.drawImage(stageCv, 0, 0);
}
function paintStage() {
  // 原片的藍色練功房：直條牆板＋亮面地板
  const g = ctx.createLinearGradient(0, 0, 0, GROUND - 60);
  g.addColorStop(0, '#5ea6dc'); g.addColorStop(1, '#3d86c4');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND - 60);
  const spot = ctx.createRadialGradient(W / 2, 260, 40, W / 2, 260, 700);
  spot.addColorStop(0, 'rgba(255,255,255,.22)'); spot.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spot; ctx.fillRect(0, 0, W, GROUND - 60);
  ctx.strokeStyle = 'rgba(20,60,110,.35)'; ctx.lineWidth = 3;
  for (let x = 90; x < W; x += 230) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GROUND - 60); ctx.stroke(); }
  ctx.fillStyle = '#244f7e'; ctx.fillRect(0, GROUND - 64, W, 8);
  const fg = ctx.createLinearGradient(0, GROUND - 56, 0, H);
  fg.addColorStop(0, '#4e8ec4'); fg.addColorStop(.4, '#3a74a9'); fg.addColorStop(1, '#22496f');
  ctx.fillStyle = fg; ctx.fillRect(0, GROUND - 56, W, H - GROUND + 56);
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  for (let i = 0; i < 6; i++) ctx.fillRect(0, GROUND - 40 + i * 22, W, 2);
}
// 首頁用的平面牆板：漸層、直條位置都跟 CSS 的 #wrap 背景對齊（畫布左右接得剛好）
let flatCv = null, flatKey = '';
function drawFlatStage() {
  const r = cv.getBoundingClientRect(), s = r.width / W, per = .319 * innerHeight, key = [r.left, s, per].map(n => n.toFixed(2)).join();
  if (key !== flatKey) {
    flatKey = key; flatCv = flatCv || Object.assign(document.createElement('canvas'), { width: W, height: H });
    const c = flatCv.getContext('2d'), g = c.createLinearGradient(0, 0, 0, H);
    [[0, '#5ea6dc'], [.758, '#3d86c4'], [.758, '#244f7e'], [.769, '#244f7e'], [.769, '#4e8ec4'], [.86, '#3a74a9'], [1, '#22496f']].forEach(([o, col]) => g.addColorStop(o, col));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(20,60,110,.35)';
    for (let k = Math.floor(r.left / per); k * per < r.right; k++) c.fillRect((k * per - r.left) / s, 0, 3 / s, H * .758);
  }
  ctx.drawImage(flatCv, 0, 0);
}
// 無敵幀光暈：身後一團漸層，一次填色就好
function aura(ft) {
  const cx = ft.x, cy = GROUND - ft.y - 125;
  const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 150);
  g.addColorStop(0, SKINS[ft.id].aura); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save(); ctx.globalAlpha = .55; ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, cy, 95, 165, 0, 0, 7); ctx.fill(); ctx.restore();
}
function shadow(ft) {
  const s = Math.max(.35, 1 - ft.y / 400);
  ctx.fillStyle = 'rgba(0,20,50,.35)'; ctx.beginPath(); ctx.ellipse(ft.x, GROUND + 2, 55 * s, 10 * s, 0, 0, 7); ctx.fill();
}
function drawBall(x, y, spin, r = 15, alpha = 1) { drawSoccer(x, y, spin, r, alpha); } // 浪子踢球：黑白足球
/* ---- 狀態發光：招式生效期間身上有特效，提醒現在在什麼狀態；快結束時越閃越快 ---- */
const ST_GUARD = { counter: ['反', '#9fe0ff'], parry: ['格', '#9fe0ff'], block: ['擋', '#c9e8ff'], reflect: ['彈', '#9fe0ff'], inv: ['無敵', '#e8f6ff'] };
// 這個狀態現在有哪些（血條下的小圖示也用）：[鍵, 字, 顏色, 剩幾秒]
function stList(ft) {
  const r = [];
  if (ft.spdT > 0) r.push(['spd', '速', '#ff8a3d', ft.spdT]);
  if (ft.powT > 0) r.push(['pow', '力', '#ff5a3c', ft.powT]);
  if (ft.armorT > 0) r.push(['armor', '霸', '#ffd34d', ft.armorT]);
  const cc = Math.max(ft.ccImmT || 0, ft.ccOnlyT || 0); if (cc > 0) r.push(['cc', '控', '#ffe9a8', cc]);
  const g = ft.guard && ft.guardT > 0 && ST_GUARD[ft.guard.kind]; if (g) r.push(['guard', g[0], g[1], ft.guardT]);
  if (ft.healT > 0) r.push(['heal', '血', '#8fffb0', ft.healT]);
  return r;
}
// 剩最後 1 秒（短的狀態剩 30%）開始閃，越接近結束閃越快。滿的時間只拿來畫畫面，記在 WeakMap，不放進角色狀態（線上重算不受影響）
const stMax = new WeakMap();
function stBlink(ft, key, T, tsec) {
  let m = stMax.get(ft); if (!m) stMax.set(ft, m = {});
  if (!(T > 0)) { delete m[key]; return 1; }
  if (!(m[key] >= T)) m[key] = T; // 新的一次（或被延長）
  const th = Math.min(1, m[key] * .3); if (T > th) return 1;
  const hz = 4 + 12 * (1 - T / th);
  return Math.sin(tsec * hz * Math.PI * 2) > 0 ? 1 : .2;
}
function stBack(ft, tsec) {
  const fast = Math.max(ft.spdT || 0, ft.powT || 0);
  if (fast > 0) { // 加速加力（瞭望式）：腳下一排火苗＋身體一圈紅光
    const a = stBlink(ft, 'fire', fast, tsec), y0 = GROUND - ft.y, cy = y0 - 130;
    ctx.save(); ctx.globalAlpha = a;
    const rg = ctx.createRadialGradient(ft.x, cy, 40, ft.x, cy, 170); rg.addColorStop(0, 'rgba(255,80,30,.28)'); rg.addColorStop(1, 'rgba(255,80,30,0)');
    ctx.fillStyle = rg; ctx.fillRect(ft.x - 170, cy - 180, 340, 360);
    for (let i = 0; i < 7; i++) {
      const ph = tsec * 9 + i * 1.7, x = ft.x + (i - 3) * 16 + Math.sin(ph) * 4, h = (i % 2 ? 55 : 75) + 35 * (.5 + .5 * Math.sin(ph * 1.3));
      const g = ctx.createLinearGradient(0, y0, 0, y0 - h); g.addColorStop(0, 'rgba(255,220,80,.95)'); g.addColorStop(.35, 'rgba(255,120,30,.85)'); g.addColorStop(1, 'rgba(230,40,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - 12, y0 + 4); ctx.quadraticCurveTo(x - 7, y0 - h * .5, x, y0 - h); ctx.quadraticCurveTo(x + 7, y0 - h * .5, x + 12, y0 + 4); ctx.fill();
    }
    ctx.restore();
  }
  if (ft.healT > 0) { // 回血：綠色光點往上飄
    ctx.save(); ctx.globalAlpha = stBlink(ft, 'heal', ft.healT, tsec); ctx.fillStyle = '#8fffb0';
    for (let i = 0; i < 6; i++) { const u = (tsec * .9 + i / 6) % 1, x = ft.x + Math.sin(i * 2.4 + tsec * 2) * 50; ctx.beginPath(); ctx.arc(x, GROUND - ft.y - 20 - u * 250, 5 * (1 - u) + 2, 0, 7); ctx.fill(); }
    ctx.restore();
  }
}
function stFront(ft, tsec) {
  const g = ft.guard && ft.guardT > 0 && ST_GUARD[ft.guard.kind]; if (!g) return;
  const a = stBlink(ft, 'guard', ft.guardT, tsec), cy = GROUND - ft.y - 130, pulse = .55 + .3 * Math.sin(tsec * 18), hb = hurtbox(ft);
  ctx.save(); ctx.globalAlpha = a;
  ctx.strokeStyle = 'rgba(160,225,255,' + pulse + ')'; ctx.lineWidth = 10; ctx.beginPath(); ctx.ellipse(ft.x, cy, 66, 150, 0, 0, 7); ctx.stroke();
  ctx.strokeStyle = '#f2fbff'; ctx.lineWidth = 3; ctx.stroke();
  ctx.font = 'bold 30px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center';
  outlineText(g[0], ft.x, hb.y0 - 34, g[1], 6);
  ctx.restore();
}
// 血條下面一排小圖示：字＋剩幾秒，快結束一樣會閃
function drawStatusChips(ft, side, x0, y, tsec) {
  let x = x0;
  for (const [key, t, col, T] of stList(ft)) {
    const w = 62, bx = side ? x - w : x;
    ctx.save(); ctx.globalAlpha = stBlink(ft, 'chip' + key, T, tsec);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, y, w, 26, 13) : ctx.rect(bx, y, w, 26); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = 'bold 16px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = col; ctx.fillText(t.length > 1 ? t[0] : t, bx + 15, y + 19);
    ctx.fillStyle = '#fff'; ctx.fillText(T.toFixed(1), bx + 42, y + 19);
    ctx.restore();
    x += side ? -(w + 6) : w + 6;
  }
}
function drawHUD() {
  const bw = 480, bh = 26, y = 34;
  for (const [ft, side] of [[p1, 0], [p2, 1]]) {
    ft.hpShow += (ft.hp - ft.hpShow) * .06;
    const x = side ? W - 60 - bw : 60;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 4, y - 4, bw + 8, bh + 8);
    ctx.fillStyle = '#5a1010'; ctx.fillRect(x, y, bw, bh);
    const wShow = bw * ft.hpShow / (ft.maxHp || 200), wHp = bw * ft.hp / (ft.maxHp || 200);
    ctx.fillStyle = '#ff5a3c'; side ? ctx.fillRect(x + bw - wShow, y, wShow, bh) : ctx.fillRect(x, y, wShow, bh);
    const hg = ctx.createLinearGradient(0, y, 0, y + bh); hg.addColorStop(0, '#ffe36b'); hg.addColorStop(1, '#f0a020');
    ctx.fillStyle = hg; side ? ctx.fillRect(x + bw - wHp, y, wHp, bh) : ctx.fillRect(x, y, wHp, bh);
    ctx.font = 'bold 20px "Microsoft JhengHei",sans-serif'; ctx.textAlign = side ? 'right' : 'left';
    const me = net.role === 'host' ? 0 : net.role === 'guest' ? 1 : -1;
    const label = net.role === 'spec' ? specName(side) + '・' + lookOf(ft).name : RK.on && net.rk && RK.bot ? (side === me ? (myName() || '我') + '（你）' : RK.bot.name + '（' + RK_TIERS[RK.bot.tier][0] + '）') : (side ? (ladder.on ? (ladder.sub === 10 ? '階主 ' : 'CPU ') : vsCPU ? (RK.on && RK.bot ? RK.bot.name + '（' + RK_TIERS[RK.bot.tier][0] + '）' : QP.lv ? 'CPU' + CPU_LV[QP.lv].n + ' ' : nnOn() ? (NN.comboMatch ? 'AI組合 ' : 'AI' + NN_TIERS[NN.tier] + ' ') : 'CPU ') : '2P ') : (ladder.on && ladder.name ? ladder.name + ' ' : '1P ')) + ((ladder.on && !side && ladder.name) || (side && RK.on && RK.bot) ? '' : lookOf(ft).name) + (side === me ? '（你）' : '');
    outlineText(label, side ? x + bw : x, y + bh + 26, '#fff');
    if (!RG.on) drawStatusChips(ft, side, side ? x + bw : x, isTouch ? y + bh + 86 : y + bh + 36, performance.now() / 1000);
    // 回合勝場
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = wins[side] > i ? '#ffd34d' : 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.arc(side ? x + bw - 230 - i * 22 : x + 230 + i * 22, y + bh + 19, 7, 0, 7); ctx.fill();
    }
    // 技能冷卻：電腦版畫在畫面下方（drawSkillBar）；手機版下方是虛擬按鈕，冷卻直接顯示在按鈕上，這裡保留小圖示看對手
    if (!isTouch && !(ladder.on && side === 1 && p1.extra && p1.extra.length)) { drawSkillBar(ft, side); continue; } // 天梯有帶招：下排給玩家，電腦的招畫在血條下
    const sk = ft.load.map(k => [skChar(k), k]);
    sk.forEach(([t, k], i) => {
      const cx = side ? x + bw - 18 - i * 40 : x + 18 + i * 40, cy = y + bh + 62;
      const cd = skCd(ft, k), ready = cd <= 0;
      ctx.fillStyle = ready ? 'rgba(255,170,40,.9)' : 'rgba(0,0,0,.45)';
      ctx.beginPath(); ctx.arc(cx, cy, 16, 0, 7); ctx.fill();
      if (!ready) { ctx.fillStyle = 'rgba(255,170,40,.6)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - cd / skMax(k))); ctx.fill(); }
      ctx.font = 'bold 16px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = ready ? '#3a1600' : '#ddd'; ctx.fillText(t, cx, cy + 6);
    });
  }
  ctx.textAlign = 'center'; ctx.font = 'bold 44px "Microsoft JhengHei",sans-serif';
  outlineText(Math.max(0, Math.ceil(timer)), W / 2, 66, '#fff', 6);
  if (ladder.on) { ctx.font = 'bold 20px "Microsoft JhengHei",sans-serif'; outlineText('天梯 第 ' + ladder.stage + ' 階・第 ' + ladder.sub + ' / 10 關', W / 2, 96, '#ffe36b', 4); }
  if (net.role === 'spec') {
    ctx.font = 'bold 16px "Microsoft JhengHei",sans-serif';
    outlineText('👀 觀戰中' + (net.specInfo && net.specInfo.rk ? '・排位賽' : '') + (net.specNote ? '・' + net.specNote : ''), W / 2, 92, net.specNote ? '#ff8f7a' : '#9fdcff', 4);
  }
  if (net.peer && net.rtt != null) {
    ctx.font = 'bold 16px "Microsoft JhengHei",sans-serif';
    outlineText('延遲 ' + net.rtt + ' ms' + (net.dc ? (net.relay ? '・中繼' : '・直連') : '・伺服器轉送'), W / 2, 92, net.rtt < 80 ? '#8fffb0' : net.rtt < 160 ? '#ffe36b' : '#ff8f7a', 4);
  }
}
// 畫面下方地板上的技能列：大圓鈕＋招式全名＋按鍵，冷卻中顯示剩幾秒
function drawSkillBar(ft, side) {
  const keysTxt = net.role === 'spec' ? null : side === 0 ? (net.role === 'guest' ? null : ['J', 'K', 'L']) : (vsCPU || net.role === 'host' ? null : net.role === 'guest' ? ['J', 'K', 'L'] : ['1', '2', '3']);
  const foeSide = net.role === 'host' ? 1 : net.role === 'guest' ? 0 : net.role === 'spec' ? side : -1; // 觀戰：兩邊的祕密招都用過才揭曉（免得觀戰的人報給對手聽）
  const ex = side === 0 && (RG.on || ladder.on) && ft.extra ? ft.extra : []; // 闖關／天梯學到或帶的新招：接在三招後面
  const all = ft.load.concat(ex), wide = ex.length > 0, step = wide ? Math.min(96, (W - 120) / Math.max(1, all.length - 1)) : 96;
  all.forEach((k, i) => {
    const isEx = i >= ft.load.length, xi = i - ft.load.length;
    const hidden = !isEx && net.ext && side === foeSide && !(ft.used && ft.used[i]); // 祕密：用過才揭曉
    const cx = side ? W / 2 + 228 + i * 96 : wide ? 60 + i * step : W / 2 - 420 + i * 96, cy = 652, r = 25;
    const cd = hidden ? 0 : isEx ? (mvReady(ft, k) ? 0 : ft.mvcd[k] || 0) : skCd(ft, k), ready = cd <= .05;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, 7); ctx.fill();
    ctx.fillStyle = hidden ? '#4a5568' : ready ? (ORIG[k] ? '#ff9a28' : '#5fb8ff') : '#3b4656'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    if (!ready) { ctx.fillStyle = ORIG[k] ? 'rgba(255,154,40,.55)' : 'rgba(95,184,255,.55)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - cd / (isEx ? mvCdOf(ft, k) : skMax(k)))); ctx.fill(); }
    if (ready && !hidden) { ctx.strokeStyle = '#ffe36b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); }
    ctx.textAlign = 'center';
    ctx.font = 'bold 24px "Microsoft JhengHei",sans-serif';
    if (hidden) outlineText('？', cx, cy + 8, '#fff', 4);
    else if (ready) { ctx.fillStyle = ORIG[k] ? '#3a1600' : '#0b2440'; ctx.fillText(skChar(k), cx, cy + 8); }
    else outlineText(cd.toFixed(1), cx, cy + 8, '#fff', 4);
    ctx.font = 'bold 15px "Microsoft JhengHei",sans-serif';
    const lv = isEx && ft.mods ? Object.keys(ft.mods.taken).filter(t => t.startsWith('mv_' + k + '_')).reduce((a, t) => a + ft.mods.taken[t], 0) : 0;
    if (isEx && mvMod(ft, k).ch > 1) { ctx.font = 'bold 14px sans-serif'; outlineText('×' + (ft.mvCh && ft.mvCh[k] != null ? ft.mvCh[k] : mvMod(ft, k).ch), cx + 20, cy - 18, '#8fffb0', 3); }
    ctx.font = 'bold 15px "Microsoft JhengHei",sans-serif';
    const key = isEx ? slotKey(xi) : keysTxt ? keysTxt[i] : '';
    outlineText((hidden ? '？？？' : wide ? skName(k).slice(0, 4) : skName(k)) + (lv ? '+' + lv : '') + (key ? ' ' + key : ''), cx, cy + r + 22, hidden ? '#c9d4e2' : ready ? (isEx ? '#9fdcff' : '#ffe36b') : '#c9d4e2', 4);
    ctx.restore();
  });
}
// 手機：冷卻直接顯示在「閃／踢／熊」按鈕上（變暗＋轉圈＋剩幾秒）
function updatePadCD() {
  if (!isTouch) return;
  const fighting = p1 && !['title', 'lobby'].includes(mode);
  const two = !vsCPU && !net.role;
  document.querySelectorAll('.pb.sk').forEach(b => {
    if (b.dataset.x != null) { // 闖關學到的新招（最多 10 顆）
      const mk = p1 && p1.extra && p1.extra[+b.dataset.x];
      b.style.display = mk ? '' : 'none'; if (!mk) return;
      const ready = mvReady(p1, mk), cd = p1.mvcd[mk] || 0, txt = ready ? MOVES[mk].name[0] : cd.toFixed(1);
      if (b.textContent !== txt) b.textContent = txt;
      const bg = !ready ? `conic-gradient(rgba(95,184,255,.75) ${(1 - cd / mvCdOf(p1, mk)) * 100}%, rgba(20,30,45,.8) 0)` : '';
      if (b.style.background !== bg) b.style.background = bg; return;
    }
    if (!b.dataset.a) return; // 四人合作才出現的「招3／閃」鈕：不是三格招式，不歸這裡管
    const ft = net.role === 'guest' ? p2 : two && b.closest('#cr') ? p2 : p1;
    const k = (ft || dummyA).load[{ S1: 0, S2: 1, S3: 2 }[b.dataset.a]];
    const cd = fighting && ft ? skCd(ft, k) : 0;
    const txt = cd > 0 ? cd.toFixed(1) : skChar(k);
    if (b.textContent !== txt) b.textContent = txt;
    const bg = cd > 0 ? `conic-gradient(rgba(255,154,40,.75) ${(1 - cd / skMax(k)) * 100}%, rgba(20,30,45,.8) 0)` : '';
    if (b.style.background !== bg) b.style.background = bg;
  });
}
function outlineText(t, x, y, fill, lw = 4) {
  ctx.lineJoin = 'round'; ctx.strokeStyle = '#000'; ctx.lineWidth = lw; ctx.strokeText(t, x, y); ctx.fillStyle = fill; ctx.fillText(t, x, y);
}
// 致敬原片的橘色字幕條（黃字黑邊）
function drawCaption(c) {
  const side = c.ft === p1 ? 0 : 1;
  const inK = Math.min(1, c.t / .12), out = c.t > 1.05 ? 1 - (c.t - 1.05) / .25 : 1;
  ctx.save(); ctx.globalAlpha = Math.max(0, out);
  const w = 60 + c.text.length * 38, h = 52, y = isTouch ? H - 92 : H - 166; // 電腦版下方是技能列，字幕往上挪
  const x = side ? W - 30 - w * inK : 30 - w * (1 - inK);
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  if (side) { g.addColorStop(0, 'rgba(240,90,20,0)'); g.addColorStop(.25, '#e8601c'); g.addColorStop(1, '#d4380f'); }
  else { g.addColorStop(0, '#d4380f'); g.addColorStop(.75, '#e8601c'); g.addColorStop(1, 'rgba(240,90,20,0)'); }
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.font = 'bold 36px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center';
  ctx.lineWidth = 7; ctx.strokeStyle = '#1a0a00'; ctx.strokeText(c.text, x + w / 2, y + 39);
  ctx.fillStyle = '#ffe600'; ctx.fillText(c.text, x + w / 2, y + 39);
  ctx.restore();
}
function fxLife(e) { return { num: .8, txt: .8, ctrl: .7, conjure: .25, ring: .45, whip: .25, boltWarn: .3, bolt: .3 }[e.type] || .3; }
function drawFX() {
  for (const e of fx) {
    if (e.type === 'spark') {
      const k = e.t / .3, r = (e.big ? 40 : 26) * (0.4 + k);
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.translate(e.x, e.y);
      ctx.fillStyle = '#fff6b0';
      ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, rr = i % 2 ? r * .4 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (e.type === 'num') {
      ctx.save(); ctx.globalAlpha = 1 - e.t / .8; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center';
      outlineText(e.text, e.x, e.y - e.t * 60, '#ffef5a'); ctx.restore();
    } else if (e.type === 'lines') {
      ctx.save(); ctx.globalAlpha = .7 * (1 - e.t / .3); ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = 3;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(e.x0, e.y0 + i * 28); ctx.lineTo(e.x1, e.y1 + i * 28); ctx.stroke(); }
      ctx.restore();
    } else if (e.type === 'ctrl') {
      const hb = hurtbox(e.ft);
      ctx.save(); ctx.globalAlpha = 1 - e.t / .7; ctx.font = 'bold 28px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center';
      outlineText('被控！', e.ft.x, hb.y0 - 30 - e.t * 30, '#ff9cf0'); ctx.restore();
    } else if (e.type === 'txt') { // 新招的狀態字：擋！反擊！加速！…
      const hb = hurtbox(e.ft);
      ctx.save(); ctx.globalAlpha = 1 - e.t / .8; ctx.font = 'bold 28px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center';
      outlineText(e.text, e.ft.x, hb.y0 - 34 - e.t * 30, e.color); ctx.restore();
    } else if (e.type === 'ring') { // 吼聲／跺地的震波圈
      const k = Math.max(0, Math.min(1, e.t / .45));
      ctx.save(); ctx.globalAlpha = .8 * (1 - k); ctx.strokeStyle = e.color; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(e.x, GROUND - 6, 40 + k * 200, 12 + k * 40, 0, 0, 7); ctx.stroke(); ctx.restore();
    } else if (e.type === 'boltWarn') { // 閃電落點警示：地上一圈越來越亮
      const k = e.t / .3;
      ctx.save(); ctx.globalAlpha = .35 + .6 * k; ctx.strokeStyle = '#ffe36b'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(e.x, GROUND - 4, e.r || 60, 12, 0, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(255,227,107,.25)'; ctx.fill(); ctx.restore();
    } else if (e.type === 'bolt') { // 閃電：從天上鋸齒劈下來
      const k = e.t / .3; let y = 0, x = e.x;
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.lineJoin = 'miter';
      for (const [w, col] of [[16, 'rgba(160,220,255,.5)'], [6, '#ffffff']]) {
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(e.x, 0); x = e.x; y = 0;
        for (let i = 1; i <= 8; i++) { y = (GROUND - 4) * i / 8; x = e.x + (i === 8 ? 0 : Math.sin(i * 2.3 + e.x) * 26); ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.ellipse(e.x, GROUND - 4, (e.r || 60) * 1.15 * (1 - k * .5), 14, 0, 0, 7); ctx.fill(); ctx.restore();
    } else if (e.type === 'whip') { // 掛鞭式的鞭影
      const k = e.t / .25, ft = e.ft, y = GROUND - ft.y - 190;
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#fff6b0'; ctx.lineWidth = 5; ctx.beginPath();
      ctx.moveTo(ft.x + ft.face * 50, y); ctx.quadraticCurveTo(ft.x + ft.face * 170, y - 70, ft.x + ft.face * 280, y + 40); ctx.stroke(); ctx.restore();
    }
  }
}

let last = performance.now();
// 回標題：右上角 🏠 鈕、Android 返回鍵（靠 history）都走這裡
function goHome(ask) {
  if (ask && ['fight', 'intro', 'roundEnd', 'rgIntro', 'rgClear', 'rgPick', 'brawl'].includes(mode)) { askYes('離開這一場，回到首頁？', () => goHome(false)); return false; }
  netLeave(); if (PR.on) prClose();
  if (BW.on) {
    if (BWN.role === 'host' && BW.st !== 'join') BWN.stash = { room: BWN.room, at: Date.now(), bw: Object.assign({}, BW), guests: BWN.guests }; // 房主不小心跳出去：整場先收著，回房間時接著打
    BW.on = false; for (const e of BW.ents) stopChant(e); bwNetClose(); bwPadsSync(); bwNetUi();
  }
  for (const id of ['lobby', 'ladder', 'rgPanel', 'meta', 'mvPick', 'fsHelp', 'acct', 'sets', 'ask', 'ach']) $(id).classList.add('hide');
  RG.on = false; RG.enemies = []; ladder.on = false; balls = []; banner = null; stopChant();
  mode = 'title'; layoutPads(); return true;
}
let homeShown = false;
let fightShown = false;
function homeTick() { // 離開標題時塞一筆 history，讓手機返回鍵回標題而不是關掉 App
  const show = mode !== 'title' && !SB;
  if (show !== homeShown) { homeShown = show; document.body.classList.toggle('ingame', show); // 電腦版離開標題就收起下方列，免得擋到招式列
    if (show && !(history.state && history.state.ssb)) history.pushState({ ssb: 1 }, ''); }
  const fight = show && !['lobby', 'mvpick', 'rgOver'].includes(mode); // 真的在打：左上角只留 🏠，不擋血條
  if (fight !== fightShown) { fightShown = fight; document.body.classList.toggle('fight', fight); }
}
addEventListener('popstate', () => { if (mode !== 'title' && !goHome(true)) history.pushState({ ssb: 1 }, ''); });
document.getElementById('home').onclick = () => { if (!$('chestFx').classList.contains('hide')) return; goHome(true); };
// 自己做的確認視窗（瀏覽器的 confirm() 在 App 內嵌瀏覽器裡可能被擋掉，按了會沒反應）
let askCb = null;
function askYes(msg, onYes, yesTxt = '確定') {
  askCb = onYes; $('askMsg').textContent = msg; $('askYes').textContent = yesTxt; $('ask').classList.remove('hide');
}
document.getElementById('askYes').onclick = () => { $('ask').classList.add('hide'); const cb = askCb; askCb = null; if (cb) cb(); };
document.getElementById('askNo').onclick = () => { $('ask').classList.add('hide'); askCb = null; };
// 打鬥中打開確認／設定：單機暫停（線上對戰沒辦法停）
const isPaused = () => !net.role && (!$('ask').classList.contains('hide') || !$('sets').classList.contains('hide'));
/* ================= 2.5D 四人闖關（試作，只在測試版）=================
   1～4 人同一台：橫向捲軸、可以往畫面裡外走（深度 z），一段一段清敵人，最後打馬師傅
   世界座標：x 左右（關卡全長 BW_LEN）、z 深度（0＝最前面）、y 離地高度。畫面上：地面高度 bwGY(z)、縮放 bwSc(z)
   1P 鍵盤：WASD 走、空白跳、J／K／L 或 1／2／3 三招（跟對戰、闖關模式一樣）、H 打（連按三段）
   2P 鍵盤：方向鍵走、右 Shift／Numpad0 跳、Numpad1～3（或 , . /）三招、Numpad4（或 '）打
   手把（最多 4 支）：A 跳、X 打、Y 踢球、B 狗熊。開打後還沒加入的人按攻擊鍵就能中途加入 */
const BW = { on: false, st: 'join', t: 0, slots: [], ents: [], shots: [], fx: [], ghosts: [], bolts: [], caps: [], ban: null, cam: 0, wave: -1, inWave: false, grp: 0, boss: null, endT: 0, goT: 0, shake: 0, hs: 0, padPrev: {}, lr: {}, voiceT: 0, sayT: 0 };
const BW_LEN = 4300, BW_ZMAX = 190;
const bwGY = z => 700 - z, bwSc = z => .62 - z * .0009; // 越裡面越高、越小
const BW_COL = ['#ff5a5a', '#4da3ff', '#5fd38a', '#ffd34d'];
// 合作闖關能選的角色：衣櫃裡買得到的造型都能穿（只在這個模式），馬師傅兩版要打贏拿到才有；試作角色只在測試版
const bwChars = () => { const own = profLoad().skins; return ['teacher', 'master', 'bear', 'mascot', 'auntie', 'rider', 'trump', ...['ma1', 'ma2'].filter(c => SHOW_DEMO || own.includes(c)), ...(SHOW_DEMO ? ['cxk', 'chiang', 'shen'] : [])]; };
const BW_KB = [
  // 招1／招2／招3 照對戰模式放 J／K／L；普通攻擊 H。合作模式沒有閃身步（S 不綁鍵）
  { L: ['KeyA'], R: ['KeyD'], U: ['KeyW', 'StickUp'], D: ['KeyS', 'StickDown'], J: ['Space', 'TouchUp'], A: ['KeyH'], B: ['KeyJ', 'Digit1'], C: ['KeyK', 'Digit2'], E: ['KeyL', 'Digit3'], S: [] }, // 1／2／3 也能放，跟闖關模式一樣
  { L: ['ArrowLeft'], R: ['ArrowRight'], U: ['ArrowUp'], D: ['ArrowDown'], J: ['Numpad0', 'ShiftRight'], A: ['Numpad4', 'Quote'], B: ['Numpad1', 'Comma'], C: ['Numpad2', 'Period'], E: ['Numpad3', 'Slash'], S: [] },
];
const BW_SRCS = ['k1', 'k2', 'g0', 'g1', 'g2', 'g3'];
const BW_NONE = { L: false, R: false, U: false, D: false, J: false, A: false, B: false, C: false, E: false, S: false, go: false };
// 角色三招（K／L／I）：ball、bear 用闖關自己的版本，其他直接跑 MOVES 的時間軸（bwSlot／bwActTick 的 mv）
const BW_KIT = { teacher: ['ball', 'bear', 'xiaolun'], master: ['ball', 'bear', 'dalun'], bear: ['bear', 'dalun', 'daqi'], mascot: ['daqi', 'ball', 'bear'], auntie: ['scold', 'ball', 'bear'],
  trump: ['fired', 'woshou', 'ymca'], ma1: ['wulian', 'fa', 'hua'], ma2: ['wulian', 'fa', 'hua'], cxk: ['kuaxia', 'jntm', 'chunchun'], chiang: ['kanshu', 'shuyao', 'wenda'], shen: ['shuangbiao', 'huyan', 'feipu'] };
const bwOk = k => k === 'shan' || k === 'ball' || k === 'bear' || (!!MOVES[k] && (SHOW_DEMO || !MOVES[k].demo)); // 試作招（懂王等）正式版先不放
const bwKit = c => (BW_KIT[c] || []).concat(['ball', 'bear', 'xiaolun']).slice(0, 3).map((k, n) => bwOk(k) ? k : ['ball', 'bear', 'xiaolun'][n]).map((k, n, a) => a.indexOf(k) === n ? k : ['xiaolun', 'dalun', 'daqi'].find(x => !a.includes(x)));
// 玩家自選招式的池：自己角色的招排前面，再來踢球、狗熊、擴充模式那些招；馬師傅的招只有穿馬師傅的能選
const bwPool = c => [...new Set([...bwKit(c), ...(BW_KIT[c] || []).filter(bwOk), 'shan', 'ball', 'bear', ...MOVE_IDS.filter(k => !MOVES[k].boss)])];
const bwMvName = id => id === 'shan' ? '閃身步' : id === 'ball' ? '浪子踢球' : id === 'bear' ? '狗熊哆嗦毛' : MOVES[id].name;
let bwPads = [];
function bwPollPads() { // 手把：按鈕只算「這一幀剛按下」
  bwPads = [];
  let list = []; try { list = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) {}
  for (const gp of list) {
    if (!gp || gp.index > 3) continue;
    const b = gp.buttons.map(x => x.pressed), prev = BW.padPrev[gp.index] || [], ax = gp.axes, hit = i => !!b[i] && !prev[i];
    bwPads[gp.index] = { L: ax[0] < -.4 || !!b[14], R: ax[0] > .4 || !!b[15], U: ax[1] < -.4 || !!b[12], D: ax[1] > .4 || !!b[13], J: hit(0), A: hit(2), B: hit(3), C: hit(1), E: hit(6) || hit(7), S: false, go: hit(9) };
    BW.padPrev[gp.index] = b;
  }
}
function bwRead(src) {
  if (src[0] === 'g') return bwPads[+src[1]] || BW_NONE;
  if (src[0] === 'n') { const g = BWN.guests[src.slice(1)]; return g ? bwUnbits(g.cur) : BW_NONE; } // 線上客人
  const m = BW_KB[+src[1] - 1];
  const r = { L: any(m.L, keys), R: any(m.R, keys), U: any(m.U, keys), D: any(m.D, keys), J: any(m.J, pressed), A: any(m.A, pressed), B: any(m.B, pressed), C: any(m.C, pressed), E: any(m.E, pressed), S: any(m.S, pressed),
    go: src === 'k1' ? pressed.has('Enter') : pressed.has('NumpadEnter') };
  if (BW.st !== 'play') { r.A = r.A || r.B; r.C = r.E; r.B = r.E = false; } // 選角／結算：招1 鍵（J）加入、準備，招3 鍵（L）取消
  return r;
}
// 招式：keys 是姿勢時間軸（字串＝BW_P 裡的姿勢）、hits 是判定（x0～x1＝面前多遠、kd＝打倒在地）、warn＝前搖多久（頭上出「！」）
const BW_P = {
  jab: mp(M_LUNGE, { fA: 92, fE: 0, bA: 40, bE: 105, lean: 16, head: 6 }),
  cross: mp(M_LUNGE, { bA: 92, bE: 0, fA: 30, fE: 110, lean: 22, head: 8 }),
  chamber: mp({ bT: -10, bK: 10, fT: 70, fK: 95, lean: -8, bA: -30, bE: 70, fA: 40, fE: 60 }),
  kick: mp({ fT: 86, fK: 0, bT: -8, bK: 10, lean: -14, bA: -40, bE: 60, fA: 40, fE: -40 }),
  wind: mp(M_LOW, { lean: -10, head: -4, bA: -50, bE: 120, fA: 50, fE: 110 }),
  air: P({ fT: 75, fK: 0, bT: -40, bK: 70, lean: -22, head: -6, bA: -70, bE: 40, fA: 30, fE: -10 }),
  crouch: mp(M_LOW, { bK: 50, fK: -50, dy: 30, lean: 10, bA: -40, bE: 60, fA: 40, fE: 60 }),
};
const bwKeys = ks => ks.map(([t, p]) => [t, typeof p === 'string' ? BW_P[p] : p]);
const BW_ATK = {
  jab: { dur: .26, keys: bwKeys([[0, N], [.06, 'jab'], [.17, 'jab'], [.26, N]]), hits: [{ at: .06, x0: 10, x1: 120, dmg: 7, stun: .32, kb: 70 }] },
  cross: { dur: .3, keys: bwKeys([[0, N], [.07, 'cross'], [.2, 'cross'], [.3, N]]), hits: [{ at: .07, x0: 10, x1: 125, dmg: 8, stun: .36, kb: 90 }] },
  kick: { dur: .5, keys: bwKeys([[0, N], [.1, 'chamber'], [.18, 'kick'], [.36, 'kick'], [.5, N]]), hits: [{ at: .18, x0: 10, x1: 150, dmg: 14, stun: .4, kb: 420, kd: 1 }], lunge: 160 },
  air: { dur: 9, keys: bwKeys([[0, 'air'], [1, 'air']]) }, // 跳踢：一直到落地
  punch: { dur: .62, warn: .28, keys: bwKeys([[0, N], [.28, 'wind'], [.34, 'jab'], [.5, 'jab'], [.62, N]]), hits: [{ at: .34, x0: 0, x1: 115, dmg: 9, stun: .38, kb: 140 }] },
  yell: { dur: .8, warn: .25, keys: MOVES.scold.keys, shot: { at: .3, kind: 'yell', vx: 470, dmg: 8, stun: .35, kb: 160, life: 1, y: 150 } },
  pounce: { dur: 1, warn: .3, keys: bwKeys([[0, N], [.3, 'crouch'], [.38, 'air'], [1, 'air']]), pounce: 1 },
  mapunch: { dur: .5, warn: .18, keys: bwKeys([[0, N], [.18, 'wind'], [.24, 'jab'], [.4, 'jab'], [.5, N]]), hits: [{ at: .24, x0: 0, x1: 135, dmg: 14, stun: .4, kb: 420, kd: 1 }] },
  whip: { dur: 1.7, warn: .3, keys: MOVES.wulian.keys, bolts: [.3, .5, .7, .9, 1.1] },
  fa: { dur: 4, warn: .45, keys: MOVES.fa.keys, runs: MOVES.fa.ev.filter(e => e.to),
    hits: MOVES.fa.ev.filter(e => e.hit).map(e => Object.assign({ at: e.at }, e.hit, e.hit.longKb ? { kb: 620, kd: 1 } : {})) },
};
const BW_COMBO = ['jab', 'cross', 'kick'];
const BW_FOES = {
  thug: { name: '小混混', hp: 60, spd: 150, atk: 'punch', look: Object.assign({}, SKINS.p2, { name: '小混混', shirt: '#4a3f6b', trim: '#e86a6a', pants: '#2b3a5c', pantsDark: '#202b45', aura: '#ff7070' }) },
  helmet: { name: '飆仔', hp: 80, spd: 175, atk: 'punch', look: Object.assign({}, CHARS.rider.look, { name: '飆仔', scooter: false, box: false, shirt: '#2f9e6b' }) },
  auntie: { name: '暴躁大媽', hp: 70, spd: 120, atk: 'yell', want: 300, look: CHARS.auntie.look },
  mascot: { name: '黃袋鼠', hp: 90, spd: 190, atk: 'pounce', want: 250, look: CHARS.mascot.look },
  bear: { name: '狗熊', hp: 200, spd: 110, atk: 'hug', heavy: 1, look: CHARS.bear.look },
  ma: { name: '馬師傅', hp: 650, spd: 165, atk: 'boss', heavy: 1, boss: 1, want: 110 },
};
const BW_WAVES = [
  { at: 0, name: '夜市入口', groups: [['thug', 'thug', 'helmet'], ['thug', 'helmet']] },
  { at: 1250, name: '廟口廣場', groups: [['thug', 'auntie', 'helmet'], ['mascot', 'thug', 'auntie']] },
  { at: 2300, name: '巷子底', groups: [['bear', 'thug', 'thug'], ['mascot', 'mascot', 'auntie', 'helmet']] },
  { at: BW_LEN - W, name: '馬師傅的武館', groups: [['ma']] },
];
const bwPlayers = () => BW.ents.filter(e => e.team === 0);
const bwFoesOf = ft => BW.ents.filter(e => e.team !== ft.team && !e.ko);
const bwNP = () => Math.max(1, BW.slots.length);
function bwMk(char, look, x, z, team) {
  const f = new Fighter(team ? 'p2' : 'p1', x, team ? -1 : 1);
  Object.assign(f, { char, look, z, vz: 0, team, downT: 0, downAge: 0, koT: 0, armor: 0, nid: ++BWN.seq }); // nid：線上傳畫面時的代號
  return f;
}
function bwFreeChar(first) {
  const used = BW.slots.map(s => s.char), sk = profLoad().skin;
  const cs = bwChars();
  if (first && cs.includes(sk)) return sk;
  return cs.find(c => !used.includes(c)) || cs[0];
}
function bwOpen() {
  goHome(false); unlockAudio();
  Object.assign(BW, { on: true, st: 'join', t: 0, slots: [], ents: [], shots: [], fx: [], ghosts: [], bolts: [], caps: [], ban: null, cam: 0, goT: 0, lr: {} });
  mode = 'brawl'; vsCPU = true; layoutPads(); BW.ud = {};
}
// 每個角色上次選的三招記在這台裝置（選過的招不在池裡了就換回預設）
const BW_LOAD_KEY = 'ssb_bw_load';
function bwLoadOf(c) {
  let all = {}; try { all = JSON.parse(lsGet(BW_LOAD_KEY) || '{}') || {}; } catch (e) {}
  const v = all[c], pool = bwPool(c);
  return Array.isArray(v) && v.length === 3 && new Set(v).size === 3 && v.every(k => pool.includes(k)) ? v.slice() : bwKit(c);
}
function bwStart() {
  Object.assign(BW, { st: 'play', t: 0, ents: [], shots: [], fx: [], ghosts: [], bolts: [], caps: [], ban: null, cam: 0, wave: -1, inWave: false, grp: 0, boss: null, endT: 0 });
  let all = {}; try { all = JSON.parse(lsGet(BW_LOAD_KEY) || '{}') || {}; } catch (e) {}
  BW.slots.forEach((s, i) => { Object.assign(s, { lives: 2, dealt: 0, kills: 0, downs: 0, row: 0 }); if (!s.load) s.load = bwLoadOf(s.char); all[s.char] = s.load; bwSpawnP(s, i); });
  lsSet(BW_LOAD_KEY, JSON.stringify(all));
  stat.start('brawl');
}
function bwSpawnP(s, i) {
  const p = bwMk(s.char, null, BW.cam + 170 + i * 60, 30 + i * 45, 0);
  if (!s.load) s.load = bwLoadOf(s.char);
  Object.assign(p, { load: s.load.slice(), slot: i, src: s.src, slotObj: s, maxHp: 200, kcd: [0, 0, 0], kmax: [1, 1, 1], cdS: 0, comboN: 0, comboT: 0 });
  s.ft = p; BW.ents.push(p); return p;
}
function bwRespawn(p) { // 從天上掉回來，無敵 2 秒
  p.slotObj.lives--; stopChant(p);
  Object.assign(p, { ko: false, koT: 0, hp: p.maxHp, act: null, stun: 0, downT: 0, x: BW.cam + 220, z: 90, y: 420, vx: 0, vz: 0, vy: 0, inv: 2.2, win: false });
  delete p.cxkKo;
}
function bwSpawnFoe(kind, side) {
  const d = BW_FOES[kind], n = bwNP();
  const x = side > 0 ? BW.cam + W + 70 : BW.cam - 70, z = 15 + Math.random() * (BW_ZMAX - 30);
  const e = bwMk(d.char, d.look, x, z, 1);
  e.kind = kind; e.heavy = d.heavy; e.boss = d.boss;
  e.hp = e.maxHp = Math.round(d.hp * (1 + (n - 1) * (d.boss ? .35 : .25)));
  e.aiCd = .6 + Math.random(); e.zOff = (Math.random() - .5) * 24; e.walkIn = 1;
  BW.ents.push(e); return e;
}
function bwSay(text, clip) { // 字幕（＋馬師傅原聲）
  BW.caps = [{ text, t: 0 }];
  if (clip && MA_HAS[clip]) playClip('ma_' + clip);
}
function bwInFront(a, t, x0, x1, dz = 34, dy = 150) {
  const dx = (t.x - a.x) * a.face;
  return dx >= x0 && dx <= x1 && Math.abs(t.z - a.z) <= dz && Math.abs(t.y - a.y) <= dy;
}
function bwHit(att, tgt, dmg, stun, kb, kd) {
  if (tgt.ko || tgt.inv > 0 || tgt.downT > 0) return false;
  if (tgt.bwGuardT > 0) { // 敗式／化／問A答B：這時被打就擋掉，打的人在身邊就反擊回去
    const g = tgt.bwGuard; tgt.bwGuardT = 0; synth('hit');
    BW.fx.push({ type: 'txt', x: tgt.x, z: tgt.z, y: 300, t: 0, text: g.kind === 'counter' ? '反擊！' : '擋下！', col: '#9fe0ff' });
    if (g.kind === 'counter' && !att.ko && Math.abs(att.x - tgt.x) < 260) { tgt.face = Math.sign(att.x - tgt.x) || tgt.face; bwHit(tgt, att, g.dmg, .6, tgt.face * 380, 1); }
    return 'block';
  }
  if (att.bwPowT > 0) dmg = Math.round(dmg * att.bwPow);
  tgt.hp = Math.max(0, tgt.hp - dmg); tgt.flash = .12;
  const armored = tgt.armor > 0 || (tgt.heavy && tgt.act);
  if (tgt.heavy) { kb *= .3; stun *= .45; kd = 0; }
  if (!armored && (stun > 0 || kb || kd)) { // 鼠藥這種只扣血的不打斷
    if (tgt.act && (tgt.act.type === 'bear' || tgt.act.chant)) stopChant(tgt);
    tgt.act = null; tgt.stun = Math.max(tgt.stun, stun); tgt.vx = kb; tgt.vz = 0;
    if (kd) { tgt.downT = .9; tgt.downAge = 0; tgt.stun = 0; tgt.vy = 480; tgt.y = Math.max(tgt.y, 1); if (tgt.slotObj) tgt.slotObj.downs++; }
  }
  if (tgt.boss) { tgt.poise = (tgt.poise || 0) + dmg; if (tgt.poise >= 70 + 25 * bwNP()) { tgt.poise = 0; tgt.armor = 1.5; tgt.stun = 0; tgt.aiCd = 0; tgt.counter = 1; } } // 馬師傅被圍毆太久：金身＋瞬移反擊
  const s = att.slotObj; if (s) s.dealt += dmg;
  BW.fx.push({ type: 'num', x: tgt.x + Math.random() * 20 - 10, z: tgt.z, y: tgt.y + 250, t: 0, text: '-' + dmg, col: tgt.team ? '#fff' : '#ff8080' });
  BW.fx.push({ type: 'spark', x: tgt.x - Math.sign(kb || 1) * 10, z: tgt.z, y: tgt.y + 130 + Math.random() * 60, t: 0, big: kd });
  BW.hs = kd ? .06 : .025; BW.shake = Math.max(BW.shake, kd ? 9 : 4); synth(kd ? 'kick' : 'hit');
  if (tgt.hp <= 0) {
    Object.assign(tgt, { ko: true, koT: 0, act: null, stun: 0, downT: 0, vy: 560, vx: Math.sign(kb || 1) * 300 }); tgt.y = Math.max(tgt.y, 1);
    stopChant(tgt);
    if (s) s.kills++;
  }
  if (tgt.char) charHurtVoice(tgt);
  return true;
}
function bwAct(ft, id) {
  const d = BW_ATK[id];
  ft.act = { type: 'bwa', id, t: 0, dur: d.dur, keys: d.keys, done: 0, combo: BW_COMBO.includes(id), hitSet: new Set() };
  if (ft.act.combo) ft.comboN = BW_COMBO.indexOf(id) + 1;
  if (ft.grounded) { ft.vx = 0; ft.vz = 0; }
  if (ft.team === 0) synth('whoosh');
}
const BW_SHAN_CD = 1.2;
function bwShan(p, mx, mz) {
  const ux = mx || (mz ? 0 : p.face), len = Math.hypot(ux, mz) || 1;
  p.act = { type: 'shan', t: 0, dur: .55, dir: 'fwd', travel: Math.sign(ux) || p.face, done: false, tx: ux / len * 250, tz: mz / len * 120 };
  p.cdS = 1; p.vx = p.vz = 0; p.stun = 0;
  playClip('shan'); synth('whoosh');
}
function bwSlot(p, n) { // 出角色的第 n 招
  const id = p.load[n];
  if (id === 'shan') { const i = p.inp || BW_NONE; bwShan(p, (i.R ? 1 : 0) - (i.L ? 1 : 0), (i.U ? 1 : 0) - (i.D ? 1 : 0)); p.kcd[n] = p.kmax[n] = BW_SHAN_CD; return; } // 閃身步當成三招之一：往搖桿方向瞬移
  if (id === 'bear') { p.act = { type: 'bear', t: 0, dur: BEAR.dur, nextHit: .3 }; p.vz = 0; playClip('bear', .9); p.kcd[n] = p.kmax[n] = 6; return; }
  if (id === 'ball') { p.act = { type: 'ball', t: 0, dur: .85 }; p.vx = p.vz = 0; playClip('ball'); p.kcd[n] = p.kmax[n] = 1.4; return; }
  const m = MOVES[id];
  p.act = { type: 'mv', id, t: 0, dur: m.dur, fired: 0 }; p.vx = p.vz = 0; p.walkPh = 0;
  if (m.armor) p.armor = m.dur;
  p.kcd[n] = p.kmax[n] = m.cd + (m.dur > 3 ? m.dur : 0); // 蔡徐坤那種跳好幾秒的舞：跳完才開始算冷卻
  BW.fx.push({ type: 'txt', x: p.x, z: p.z, y: 330, t: 0, text: m.name, col: BW_COL[p.slot] });
  if (isMa(p.char)) { const ln = { wulian: 'wulian', fa: 'deng' }[id]; if (ln) bwSay(MA_LINES[ln], ln); }
  else if (m.voices !== false) playClip('mv_' + (m.voices ? pickOne(m.voices) : id));
}
function bwMvHit(ft, h) {
  for (const t of bwFoesOf(ft)) {
    const dx = (t.x - ft.x) * ft.face;
    if (Math.abs(t.z - ft.z) > 38 || Math.abs(t.y - ft.y) > (h.h || 150) || (h.maxY != null && t.y > h.maxY)) continue;
    if (h.both ? Math.abs(dx) > h.x1 : dx < h.x0 || dx > h.x1) continue;
    const dir = h.both ? (Math.sign(t.x - ft.x) || ft.face) : ft.face, kb = Math.min(h.kb, 620);
    if (bwHit(ft, t, h.dmg, h.stun, dir * kb, kb >= 420) === true && h.launch && !t.heavy && !t.ko && !(t.downT > 0)) { t.vy = h.launch * .75; t.y = Math.max(t.y, 1); }
  }
}
function bwGrab(ft, g) { // 抓面前最近的一個
  let best = null, bd = 1e9;
  for (const t of bwFoesOf(ft)) {
    const dx = (t.x - ft.x) * ft.face;
    if (dx < -20 || dx > g.range || Math.abs(t.z - ft.z) > 45 || t.inv > 0 || t.downT > 0 || t.y > 120) continue;
    if (dx < bd) { bd = dx; best = t; }
  }
  if (!best) { BW.fx.push({ type: 'txt', x: ft.x, z: ft.z, y: 300, t: 0, text: '沒抓到', col: '#c9d4e2' }); return; }
  const back = g.mode === 'swap';
  if (!best.heavy) { best.x = ft.x + ft.face * (back ? -80 : 75); best.z = ft.z; }
  bwHit(ft, best, g.dmg, .6 * (g.stun || 1), (back ? -1 : 1) * ft.face * 40);
}
function bwVoice(clip, vol) { // 雜兵別每隻都喊
  if (BW.t - BW.voiceT < 1.5) return; BW.voiceT = BW.t; playClip(clip, vol);
}
function bwActTick(ft, dt) {
  const a = ft.act; if (!a) return;
  a.t += dt;
  if (a.type === 'shan') {
    if (a.t > .03 && a.t < .3) ft.inv = Math.max(ft.inv, .02);
    if (!a.done && a.t >= .1) {
      a.done = true; const ox = ft.x, oz = ft.z;
      ft.x += a.tx; ft.z = Math.max(0, Math.min(BW_ZMAX, ft.z + a.tz));
      if (ft.team === 0) ft.x = Math.max(BW.cam + 40, Math.min(BW.cam + W - 40, ft.x));
      for (let i = 0; i < 5; i++) { const k = i / 5; BW.ghosts.push({ ft, x: ox + (ft.x - ox) * k, z: oz + (ft.z - oz) * k, y: ft.y, pose: SV().hold, f: a.travel, t: -i * .02, life: .35 }); }
    }
  } else if (a.type === 'ball') {
    if (!a.launched && a.t >= .4) {
      a.launched = true; synth('kick');
      BW.shots.push({ kind: 'ball', owner: ft, x: ft.x + ft.face * 50, z: ft.z, y: 55, vx: ft.face * 820, dmg: 16, stun: .5, kb: 320, kd: 1, life: 1.5, spin: 0 });
    }
  } else if (a.type === 'bear') { // 狗熊哆嗦毛：玩家衝一小段、一路連打；狗熊敵人是抱住打（比較慢）
    const foe = ft.team === 1, every = foe ? .45 : BEAR.hitEvery;
    if (a.t < .28 && !foe) ft.vx = ft.face * 420; else ft.vx = 0;
    if (!foe && !a.chant && a.t >= BEAR.chantAt) { a.chant = true; startChant(ft); }
    if (a.t >= a.nextHit && a.t < BEAR.activeEnd) {
      a.nextHit += every;
      for (const t of bwFoesOf(ft)) if (bwInFront(ft, t, -25, 175, 45)) bwHit(ft, t, foe ? 5 : 3, foe ? .3 : .38, ft.face * 60);
    }
  } else if (a.type === 'mv') { // 角色招式：照 1 對 1 的時間軸跑，判定換成有深度的
    const ev = MOVES[a.id].ev; let moving = false;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.to != null) { if (a.t >= e.at && a.t < e.to) { ft.vx = ft.face * e.vx; moving = true; } continue; }
      const bit = 2 ** i;
      if (Math.floor(a.fired / bit) % 2 || a.t < e.at || (e.onLand && !ft.grounded)) continue;
      a.fired += bit;
      if (e.hit) bwMvHit(ft, e.hit);
      if (e.ring) BW.fx.push({ type: 'ring', x: ft.x, z: ft.z, t: 0 });
      if (e.shake) BW.shake = Math.max(BW.shake, e.shake);
      if (e.sfx) synth(e.sfx);
      if (e.chant) { a.chant = true; startChant(ft, e.chant); }
      if (e.guard === 'inv') ft.inv = Math.max(ft.inv, e.dur);
      else if (e.guard) { ft.bwGuard = { kind: e.guard, dmg: e.dmg || 16 }; ft.bwGuardT = e.dur; }
      if (e.buff) { // 瞭望式、扁擔式這類：加速／加力／霸體／回血
        const b = e.buff, say = [];
        if (b.speed) { ft.bwSpd = b.speed; ft.bwSpdT = b.dur; say.push('加速'); }
        if (b.pow) { ft.bwPow = b.pow; ft.bwPowT = b.dur; say.push('加力'); }
        if (b.armor || b.ccOnly) { ft.armor = Math.max(ft.armor, b.ccOnly || b.dur); say.push('霸體'); }
        if (b.heal) { ft.hp = Math.min(ft.maxHp || 200, ft.hp + b.heal); say.push('回血'); }
        if (say.length) BW.fx.push({ type: 'txt', x: ft.x, z: ft.z, y: 290, t: 0, text: say.join('！') + '！', col: '#8fffb0' });
      }
      if (e.jump) { ft.vy = e.jump; ft.y = Math.max(ft.y, .01); }
      if (e.dive) ft.vy = -e.dive;
      if (e.grab) bwGrab(ft, e.grab);
      if (e.zone) BW.shots.push({ kind: 'zone', owner: ft, x: ft.x + ft.face * e.zone.d, z: ft.z, y: 0, vx: 0, r: e.zone.r, dmg: e.zone.dmg, life: e.zone.life, t: 0, tick: 0, spin: 0 });
      if (e.proj) {
        const pj = e.proj;
        for (const d of pj.both ? [1, -1] : [1]) BW.shots.push({ kind: pj.kind, owner: ft, x: ft.x + ft.face * d * 40, z: ft.z, y: ft.y + 150, vx: ft.face * d * pj.vx, dmg: pj.dmg, stun: pj.stun, kb: pj.kb, life: pj.life || 1.4, t: 0, spin: 0, conf: pj.conf });
        synth('whoosh');
      }
      if (e.bolt) { // 玩家的五連鞭：挑畫面裡一個敵人，在他腳下落雷
        const fs = bwFoesOf(ft).filter(t => t.x > BW.cam && t.x < BW.cam + W);
        const tg = fs.length ? fs[Math.floor(Math.random() * fs.length)] : null;
        BW.bolts.push({ owner: ft, x: tg ? tg.x + tg.vx * .25 : ft.x + ft.face * [130, 330, 560][Math.floor(Math.random() * 3)], z: tg ? tg.z : ft.z, t: 0, warn: .35, dmg: e.bolt.dmg + 3 });
      }
    }
    if (!moving && ft.grounded) ft.vx = 0;
    ft.vz = 0;
  } else if (a.type === 'bwa') {
    const d = BW_ATK[a.id];
    if (d.lunge && a.t < .2) ft.vx = ft.face * d.lunge; else if (ft.grounded && !d.pounce) ft.vx = 0;
    if (d.runs) { const r = d.runs.find(r => a.t >= r.at && a.t < r.to); ft.vx = r ? ft.face * r.vx : 0; if (r && ft.tgt) ft.vz = Math.sign(ft.tgt.z - ft.z) * Math.min(160, Math.abs(ft.tgt.z - ft.z) * 4); else ft.vz = 0; }
    (d.hits || []).forEach((h, n) => {
      if (a.done >> n & 1 || a.t < h.at) return;
      a.done |= 1 << n;
      for (const t of bwFoesOf(ft)) if (bwInFront(ft, t, h.x0, h.x1)) bwHit(ft, t, h.dmg, h.stun, ft.face * h.kb, h.kd);
    });
    if (d.shot && !a.shot && a.t >= d.shot.at) {
      a.shot = true; const s = d.shot;
      BW.shots.push({ kind: s.kind, owner: ft, x: ft.x + ft.face * 40, z: ft.z, y: s.y, vx: ft.face * s.vx, dmg: s.dmg, stun: s.stun, kb: s.kb, life: s.life, spin: 0 });
      if (ft.kind === 'auntie') bwVoice('mv_' + MOVES.scold.voices[Math.floor(Math.random() * MOVES.scold.voices.length)]);
    }
    if (d.bolts) d.bolts.forEach((bt, n) => { // 五連鞭：每鞭挑一個玩家，在他腳下（往他走的方向多算一點）先亮警示再落雷
      if (a.done >> n & 1 || a.t < bt) return;
      a.done |= 1 << n;
      const ps = bwPlayers().filter(p => !p.ko); if (!ps.length) return;
      const p = ps[Math.floor(Math.random() * ps.length)];
      BW.bolts.push({ owner: ft, x: p.x + p.vx * .25, z: Math.max(0, Math.min(BW_ZMAX, p.z + p.vz * .25)), t: 0, warn: .5 });
    });
    if (a.id === 'air') {
      for (const t of bwFoesOf(ft)) if (!a.hitSet.has(t) && bwInFront(ft, t, -10, 125, 38, 230)) { a.hitSet.add(t); bwHit(ft, t, 13, .4, ft.face * 360, 1); }
      if (a.t > .05 && ft.grounded) ft.act = null;
      return;
    }
    if (d.pounce) {
      if (!a.leapt && a.t >= .3) { // 黃袋鼠：往目標撲過去
        a.leapt = true; const tg = ft.tgt;
        ft.vy = 820; ft.y = .01;
        ft.vx = tg ? Math.sign(tg.x - ft.x) * Math.min(520, Math.abs(tg.x - ft.x) * 1.15 + 40) : ft.face * 300;
        ft.vz = tg ? (tg.z - ft.z) * 1.4 : 0;
      }
      if (a.leapt && !a.landed && ft.grounded && a.t > .4) {
        a.landed = true; a.t = Math.max(a.t, d.dur - .25); ft.vx = ft.vz = 0;
        BW.shake = Math.max(BW.shake, 7); synth('thud'); BW.fx.push({ type: 'ring', x: ft.x, z: ft.z, t: 0 });
        for (const t of bwFoesOf(ft)) if (Math.abs(t.x - ft.x) < 95 && Math.abs(t.z - ft.z) < 40 && t.y < 60) bwHit(ft, t, 14, .4, (Math.sign(t.x - ft.x) || ft.face) * 380, 1);
      }
      if (!a.landed && a.t > d.dur - .3) a.t = d.dur - .3; // 還在空中：停在跳躍姿勢
    }
  }
  if (ft.act === a && a.t >= a.dur) {
    if (a.type === 'bear' || a.chant) stopChant(ft);
    ft.act = null;
    if (a.combo) { if (a.buf && ft.comboN < 3) bwAct(ft, BW_COMBO[ft.comboN]); else { ft.comboT = .35; if (ft.comboN >= 3) ft.comboN = 0; } }
  }
}
function bwPhys(ft, dt) {
  ft.inv = Math.max(0, ft.inv - dt); ft.flash = Math.max(0, ft.flash - dt); ft.armor = Math.max(0, ft.armor - dt);
  if (ft.bwGuardT > 0) ft.bwGuardT -= dt;
  if (ft.bwSpdT > 0) ft.bwSpdT -= dt;
  if (ft.bwPowT > 0) ft.bwPowT -= dt;
  if (ft.stun > 0) { ft.stun -= dt; ft.vx *= Math.pow(.02, dt); }
  if (ft.downT > 0) { ft.downAge += dt; if (ft.grounded) { ft.downT -= dt; if (ft.downT <= 0) ft.inv = .45; } }
  ft.x += ft.vx * dt; ft.z = Math.max(0, Math.min(BW_ZMAX, ft.z + ft.vz * dt));
  if (ft.y > 0 || ft.vy > 0) {
    ft.vy -= GRAV * dt; ft.y += ft.vy * dt;
    if (ft.y <= 0) { ft.y = 0; ft.vy = 0; if (ft.ko || ft.downT > 0) { synth('thud'); BW.shake = Math.max(BW.shake, 4); } }
  }
  if (ft.grounded && (ft.ko || ft.downT > 0)) { ft.vx *= Math.pow(.005, dt); ft.vz = 0; }
}
function bwPlayer(p, dt) {
  const i = p.inp;
  for (let n = 0; n < 3; n++) p.kcd[n] = Math.max(0, p.kcd[n] - dt); p.cdS = Math.max(0, p.cdS - dt);
  p.comboT = Math.max(0, p.comboT - dt); if (p.comboT <= 0 && !p.act) p.comboN = 0;
  if (p.ko) { p.koT += dt; if (p.koT > 2.5 && p.slotObj.lives > 0 && BW.st === 'play') bwRespawn(p); bwPhys(p, dt); return; }
  if (p.win) { p.vx = p.vz = 0; p.walkPh = 0; bwPhys(p, dt); return; }
  const mx = (i.R ? 1 : 0) - (i.L ? 1 : 0), mz = (i.U ? 1 : 0) - (i.D ? 1 : 0);
  const sn = p.load.indexOf('shan');
  if (p.stun > 0 && sn >= 0 && [i.B, i.C, i.E][sn] && p.kcd[sn] <= 0 && !p.downT) { // 解控：有帶閃身步的話，被打暈時按那招脫身
    if (p.act && p.act.type === 'bear') stopChant(p);
    BW.fx.push({ type: 'txt', x: p.x, z: p.z, y: 300, t: 0, text: '解控！', col: '#ffd34d' }); bwShan(p, mx, mz); p.kcd[sn] = p.kmax[sn] = BW_SHAN_CD;
  }
  if (p.act && p.act.type === 'bwa' && p.act.combo && i.A && p.act.t > .04) p.act.buf = true; // 連段：出拳中再按就接下一下
  if (!p.act && p.stun <= 0 && p.downT <= 0) {
    if (mx) p.face = mx;
    if (i.S && p.cdS <= 0) bwShan(p, mx, mz);
    else if ((i.B || i.C || i.E) && p.grounded) { const n = i.B ? 0 : i.C ? 1 : 2; if (p.kcd[n] <= 0) bwSlot(p, n); }
    else if (i.A && !p.grounded) { if (!p.airUsed) { p.airUsed = true; bwAct(p, 'air'); } }
    else if (i.A) bwAct(p, p.comboT > 0 && p.comboN < 3 ? BW_COMBO[p.comboN] : (p.comboN = 0, 'jab'));
    else if (p.grounded) {
      const sp = p.bwSpdT > 0 ? p.bwSpd : 1;
      p.vx = mx * SPEED * sp; p.vz = mz * 190 * sp;
      if (i.J) { p.vy = JUMPV * .9; p.y = .01; p.airUsed = false; }
      p.walkPh = (mx || mz) ? p.walkPh + dt * 11 : 0;
    } else { p.vx += (mx * SPEED - p.vx) * Math.min(1, dt * 4); p.vz += (mz * 190 - p.vz) * Math.min(1, dt * 4); }
  }
  bwActTick(p, dt);
  bwPhys(p, dt);
  p.x = Math.max(BW.cam + 40, Math.min(BW.cam + W - 40, p.x));
}
function bwTarget(e) { // 最近的玩家（深度差算重一點）
  let best = null, bd = 1e9;
  for (const p of bwPlayers()) { if (p.ko || p.win) continue; const d = Math.abs(p.x - e.x) + 2 * Math.abs(p.z - e.z); if (d < bd) { bd = d; best = p; } }
  return best;
}
const bwAttackers = tg => BW.ents.filter(e => e.team === 1 && e.act && e.tgt === tg).length;
function bwFoe(e, dt) {
  if (e.ko) { e.koT += dt; bwPhys(e, dt); return; }
  e.aiCd -= dt;
  const d = BW_FOES[e.kind];
  if (e.act) { bwActTick(e, dt); bwPhys(e, dt); return; }
  if (e.stun > 0 || e.downT > 0 || !e.grounded) { bwPhys(e, dt); return; }
  const tg = bwTarget(e); e.tgt = tg;
  if (e.confT > 0) { e.confT -= dt; e.vx = tg ? -Math.sign(tg.x - e.x) * d.spd * .6 : 0; e.vz = 0; e.face = Math.sign(e.vx) || e.face; e.walkPh += dt * 10; bwPhys(e, dt); return; }
  if (!tg) { e.vx = e.vz = 0; e.walkPh = 0; bwPhys(e, dt); return; }
  if (e.walkIn && e.x > BW.cam + 60 && e.x < BW.cam + W - 60) e.walkIn = 0;
  const crowd = bwAttackers(tg) >= 2 && !e.boss, want = (d.want || 95) + (crowd ? 150 : 0);
  let side = Math.sign(e.x - tg.x) || 1;
  if (tg.x + side * want < BW.cam + 50 || tg.x + side * want > BW.cam + W - 50) side = -side; // 站位在畫面外：換到另一邊
  const gx = tg.x + side * want, gz = tg.z + (crowd ? e.zOff * 3 : e.zOff * .3);
  const dx = gx - e.x, dz = gz - e.z, dist = Math.abs(tg.x - e.x);
  e.face = Math.sign(tg.x - e.x) || e.face;
  const lined = Math.abs(tg.z - e.z) < 18;
  if (e.boss && e.aiCd <= 0) { bwBoss(e, tg, dist, lined); bwPhys(e, dt); return; }
  if (!crowd && !e.walkIn && e.aiCd <= 0 && lined && Math.abs(dx) < (d.want ? 70 : 26)) {
    e.aiCd = (1 + Math.random() * 1.2) / (1 + .15 * (bwNP() - 1));
    if (d.atk === 'hug') { e.act = { type: 'bear', t: 0, dur: BEAR.dur - .4, nextHit: .3 }; e.armor = BEAR.dur - .4; bwVoice('bear', .6); }
    else bwAct(e, d.atk);
  } else {
    e.vx = Math.abs(dx) > 10 ? Math.sign(dx) * d.spd : 0;
    e.vz = Math.abs(dz) > 6 ? Math.sign(dz) * d.spd * .7 : 0;
    e.walkPh = (e.vx || e.vz) ? e.walkPh + dt * 10 : 0;
  }
  bwPhys(e, dt);
}
function bwBoss(e, tg, dist, lined) { // 馬師傅：遠了就五連鞭／瞬移，近了接化發、快拳
  e.walkPh = 0; e.vx = e.vz = 0;
  const low = e.hp < e.maxHp * .5;
  e.aiCd = (1 + Math.random() * .8) * (low ? .65 : 1) / (1 + .1 * (bwNP() - 1));
  if (low && !e.summoned) { e.summoned = true; bwSay(MA_LINES.pian, 'pian'); for (let i = 0; i < bwNP() + 1; i++) bwSpawnFoe('thug', i % 2 ? 1 : -1); e.aiCd = .3; return; }
  const near = dist < 170 && lined, r = Math.random();
  let k = e.counter ? 'tp' : near ? (r < .3 ? 'fa' : r < .55 ? 'mapunch' : r < .8 ? 'whip' : 'tp') : (r < .55 ? 'whip' : 'tp');
  e.counter = 0;
  if (k === 'tp') { // 閃身步瞬移到玩家背後，接一記快拳
    const ox = e.x, oz = e.z, sd = -(tg.face || 1);
    e.x = tg.x + sd * 100; e.z = tg.z; e.face = -sd;
    for (let i = 0; i < 5; i++) { const q = i / 5; BW.ghosts.push({ ft: e, x: ox + (e.x - ox) * q, z: oz + (e.z - oz) * q, y: 0, pose: SV().hold, f: Math.sign(e.x - ox) || 1, t: -i * .02, life: .35 }); }
    synth('whoosh'); if (BW.t - BW.sayT > 4) { BW.sayT = BW.t; bwSay(MA_LINES.kuai, 'kuai'); }
    bwAct(e, 'mapunch'); return;
  }
  bwAct(e, k);
  if (k === 'whip') { BW.sayT = BW.t; bwSay(MA_LINES.wulian, 'wulian'); }
  if (k === 'fa') { BW.sayT = BW.t; bwSay(MA_LINES.deng, 'deng'); }
}
function bwJoinTick(dt) {
  for (const src of bwSrcs()) {
    const i = bwRead(src); let s = BW.slots.find(q => q.src === src);
    const dir = (i.R ? 1 : 0) - (i.L ? 1 : 0), prev = BW.lr[src] || 0; BW.lr[src] = dir;
    const ud = (i.D ? 1 : 0) - (i.U ? 1 : 0), pud = BW.ud[src] || 0; BW.ud[src] = ud;
    if (!s) { if ((i.A || i.J || i.go) && BW.slots.length < 4) { const c = bwFreeChar(!BW.slots.length); BW.slots.push({ src, char: c, load: bwLoadOf(c), row: 0, ready: false }); synth('pop'); } continue; }
    if (ud && ud !== pud && !s.ready) { s.row = (s.row + ud + 4) % 4; synth('pop'); } // 上下：選角色那格或三招其中一格
    if (dir && dir !== prev && !s.ready) {
      if (!s.row) { const cs = bwChars(), n = cs.length; s.char = cs[(cs.indexOf(s.char) + dir + n) % n]; s.load = bwLoadOf(s.char); }
      else { // 左右換這格的招，跳過另外兩格已經選的
        const pool = bwPool(s.char), k = s.row - 1; let j = pool.indexOf(s.load[k]);
        do j = (j + dir + pool.length) % pool.length; while (s.load.includes(pool[j]) && pool[j] !== s.load[k]);
        s.load[k] = pool[j];
      }
      synth('pop');
    }
    if (i.A || i.J) { if (!s.ready) synth('pop'); s.ready = true; }
    if (i.C) { if (s.ready) s.ready = false; else BW.slots.splice(BW.slots.indexOf(s), 1); }
    if (i.go) BW.slots.forEach(q => q.ready = true);
  }
  if (pressed.has('Escape')) { goHome(false); return; }
  const go = BW.slots.length && BW.slots.every(s => s.ready);
  BW.goT = go ? BW.goT + dt : 0;
  if (BW.goT > 1.2) { BW.goT = 0; bwStart(); }
}
function bwBackToJoin() { for (const e of BW.ents) stopChant(e); BW.st = 'join'; BW.slots.forEach(s => s.ready = false); BW.goT = 0; BW.ents = []; BW.cam = 0; }
function bwTick(dt) {
  bwPadsSync(); bwPadCD(); bwNetUi();
  if (BWN.role === 'guest') { bwGuestTick(dt); return; }
  if (BWN.role === 'host') bwHostTick(dt);
  bwPollPads();
  BW.t += dt;
  if (BW.st === 'join') { bwJoinTick(dt); return; }
  if (BW.st === 'result') {
    if (pressed.has('Escape')) { goHome(false); return; }
    if (BW.slots.some(s => { const i = bwRead(s.src); return i.A || i.go; })) bwBackToJoin();
    return;
  }
  if (pressed.has('Escape')) { goHome(true); return; }
  if (BW.hs > 0) { BW.hs -= dt; return; } // 打中頓一下
  if (BW.st === 'play') for (const src of bwSrcs()) { // 中途加入
    if (BW.slots.length >= 4 || BW.slots.some(s => s.src === src)) continue;
    const i = bwRead(src);
    if (i.A || i.go) { const s = { src, char: bwFreeChar(), ready: true, lives: 2, dealt: 0, kills: 0, downs: 0 }; BW.slots.push(s); const p = bwSpawnP(s, BW.slots.length - 1); p.y = 420; p.inv = 1.5; synth('pop'); }
  }
  for (const p of bwPlayers()) { p.inp = bwRead(p.src); bwPlayer(p, dt); }
  for (const e of BW.ents) if (e.team === 1) { bwFoe(e, dt); if (!e.walkIn && !e.ko) e.x = Math.max(BW.cam + 30, Math.min(BW.cam + W - 30, e.x)); } // 走進畫面之後就不出去（打飛也停在邊上）
  // 同一邊的人不要疊在一起
  const live = BW.ents.filter(e => !e.ko);
  for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
    const A = live[a], B = live[b]; if (A.team !== B.team) continue;
    const dx = B.x - A.x, dz = B.z - A.z;
    if (Math.abs(dx) < 40 && Math.abs(dz) < 16) { const push = (40 - Math.abs(dx)) * .5 * (Math.sign(dx) || 1); A.x -= push * .5; B.x += push * .5; }
  }
  // 投射物
  for (const b of BW.shots) {
    b.t = (b.t || 0) + dt;
    if (b.kind === 'zone') { // 鼠藥：站在裡面（地上）每 0.5 秒扣一次，不打斷
      if ((b.tick -= dt) <= 0) { b.tick = .5; for (const t of bwFoesOf(b.owner)) if (Math.abs(t.x - b.x) < b.r && Math.abs(t.z - b.z) < 40 && t.y < 40) bwHit(b.owner, t, b.dmg, 0, 0); }
      continue;
    }
    b.x += b.vx * dt; b.life -= dt; b.spin += dt * 14 * Math.sign(b.vx);
    for (const t of BW.ents) {
      if (t.team === b.owner.team || t.ko || b.life <= 0) continue;
      if (Math.abs(t.x - b.x) < 42 && Math.abs(t.z - b.z) < 30 && b.y > t.y - 20 && b.y < t.y + 260 && bwHit(b.owner, t, b.dmg, b.stun, Math.sign(b.vx) * b.kb, b.kd)) {
        b.life = 0;
        if (b.conf && t.team === 1 && !t.ko) t.confT = t.boss ? 1 : b.conf; // 胡言亂語：敵人暈頭轉向往反方向走
      }
    }
  }
  BW.shots = BW.shots.filter(b => (b.kind === 'zone' ? b.t < b.life : b.life > 0) && b.x > BW.cam - 200 && b.x < BW.cam + W + 200);
  // 五連鞭的雷（馬師傅打玩家、玩家馬師傅打敵人）
  for (const b of BW.bolts) {
    b.t += dt;
    if (!b.hit && b.t >= b.warn) {
      b.hit = true; BW.shake = Math.max(BW.shake, 8); synth('kick');
      for (const p of bwFoesOf(b.owner)) if (Math.abs(p.x - b.x) < 65 && Math.abs(p.z - b.z) < 32) bwHit(b.owner, p, b.dmg || 11, .5, (Math.sign(p.x - b.x) || 1) * 200);
    }
  }
  BW.bolts = BW.bolts.filter(b => b.t < b.warn + .3);
  for (const g of BW.ghosts) g.t += dt; BW.ghosts = BW.ghosts.filter(g => g.t < g.life);
  for (const f of BW.fx) f.t += dt; BW.fx = BW.fx.filter(f => f.t < (f.type === 'ring' ? .5 : f.type === 'spark' ? .25 : .9));
  for (const c of BW.caps) c.t += dt; BW.caps = BW.caps.filter(c => c.t < 3);
  if (BW.ban) { BW.ban.t += dt; if (BW.ban.t > 2.2) BW.ban = null; }
  BW.ents = BW.ents.filter(e => !(e.team === 1 && e.ko && e.koT > 1.8));
  bwWaves(dt);
  bwEnd(dt);
}
function bwWaves(dt) {
  const ps = bwPlayers().filter(p => !p.ko);
  const foes = BW.ents.filter(e => e.team === 1 && !e.ko).length;
  const w = BW_WAVES[BW.wave], next = BW_WAVES[BW.wave + 1];
  if (BW.inWave) {
    BW.cam += (w.at - BW.cam) * Math.min(1, dt * 6);
    if (BW.grp < w.groups.length && foes <= (BW.grp ? 1 : 0)) { // 上一批快清完就放下一批，從兩邊進來
      const g = w.groups[BW.grp++].slice(), extra = Math.floor(g.length * .5 * (bwNP() - 1));
      for (let i = 0; i < extra; i++) g.push(g[i % g.length] === 'bear' ? 'thug' : g[i % g.length]);
      g.forEach((k, n) => { const e = bwSpawnFoe(k, BW.wave === 0 || k === 'ma' ? 1 : n % 2 ? -1 : 1); if (k === 'ma') { BW.boss = e; e.aiCd = 2; } });
      if (g.includes('ma')) { BW.ban = { text: '馬師傅', sub: '渾元形意太極門掌門人', t: 0 }; bwSay(MA_LINES.wude, 'wude'); }
    }
    if (BW.grp >= w.groups.length && !foes && !BW.boss) { BW.inWave = false; if (next) BW.ban = { text: 'GO ➜', sub: '往右走', t: 0, go: 1 }; }
  } else if (next) {
    if (ps.length) { const avg = ps.reduce((s, p) => s + p.x, 0) / ps.length; BW.cam = Math.max(BW.cam, Math.min(next.at, avg - W / 2 + 120)); }
    if (BW.cam >= next.at - 2) { BW.cam = next.at; BW.wave++; BW.inWave = true; BW.grp = 0; if (next.groups[0][0] !== 'ma') BW.ban = { text: '第 ' + (BW.wave + 1) + ' 段', sub: next.name, t: 0 }; }
  }
}
function bwEnd(dt) {
  if (BW.st === 'play') {
    if (BW.boss && BW.boss.ko) {
      BW.st = 'clear'; BW.endT = 0; bwSay(MA_LINES.dayi, 'dayi'); stat.end('p1');
      for (const e of BW.ents) if (e.team === 1 && !e.ko) Object.assign(e, { ko: true, koT: 0, hp: 0 });
      for (const p of bwPlayers()) { if (p.ko && p.slotObj.lives >= 0) bwRespawn(p), p.y = 0; p.win = true; p.act = null; stopChant(p); }
    } else if (bwPlayers().every(p => p.ko && p.slotObj.lives <= 0 && p.koT > 1.2)) {
      BW.st = 'over'; BW.endT = 0; if (BW.boss) bwSay(MA_LINES.haozi, 'haozi'); stat.end('p2');
    }
  } else if (BW.st === 'clear' || BW.st === 'over') { BW.endT += dt; if (BW.endT > 3.2) BW.st = 'result'; }
}
// ---- 畫面 ----
const bwHash = n => { const x = Math.sin(n * 127.1 + 31.7) * 43758.5453; return x - Math.floor(x); };
const BW_SIGNS = ['滷肉飯', '珍珠奶茶', '雞排', '臭豆腐', '網咖', '檳榔', '當舖', 'KTV', '彩券', '刈包', '藥燉排骨', '夾娃娃', '武館', '國術館'];
function bwBg(cam, ts) {
  const top = bwGY(BW_ZMAX); // 牆腳（地面最裡面）
  const g = ctx.createLinearGradient(0, 0, 0, top); g.addColorStop(0, '#191636'); g.addColorStop(.55, '#4d2a5c'); g.addColorStop(1, '#b8574c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, top);
  // 遠景大樓（視差 .2）＋ 101
  const px = cam * .2;
  { const x = 980 - px, b = 400; ctx.fillStyle = '#231e45'; ctx.fillRect(x - 6, b - 330, 12, 40); for (let i = 0; i < 8; i++) { const w = 46 - i * 2; ctx.beginPath(); ctx.moveTo(x - w / 2 + 4, b - i * 34); ctx.lineTo(x - w / 2, b - i * 34 - 34); ctx.lineTo(x + w / 2, b - i * 34 - 34); ctx.lineTo(x + w / 2 - 4, b - i * 34); ctx.fill(); } ctx.fillRect(x - 30, b, 60, 80); }
  for (let i = Math.floor(px / 110) - 1; i < (px + W) / 110 + 1; i++) {
    const h = 110 + bwHash(i) * 170, x = i * 110 - px;
    ctx.fillStyle = '#2b2450'; ctx.fillRect(x, top - 40 - h, 104, h + 40);
    ctx.fillStyle = 'rgba(255,214,120,.5)';
    for (let r = 0; r < h / 26 - 1; r++) for (let c = 0; c < 4; c++) if (bwHash(i * 31 + r * 7 + c) > .62) ctx.fillRect(x + 10 + c * 24, top - 28 - h + r * 26, 10, 12);
  }
  // 中景店面（視差 .6）：騎樓、招牌、燈籠
  const mx = cam * .6, SW = 250;
  for (let i = Math.floor(mx / SW) - 1; i < (mx + W) / SW + 1; i++) {
    const x = i * SW - mx, hue = Math.floor(bwHash(i + 5) * 360);
    ctx.fillStyle = '#3b3047'; ctx.fillRect(x, top - 290, SW, 290);
    ctx.fillStyle = '#2d2438'; ctx.fillRect(x, top - 290, 8, 290);
    const inG = ctx.createLinearGradient(0, top - 150, 0, top); inG.addColorStop(0, 'rgba(255,196,110,.85)'); inG.addColorStop(1, 'rgba(255,140,70,.6)');
    ctx.fillStyle = inG; ctx.fillRect(x + 22, top - 150, SW - 44, 150);
    ctx.fillStyle = `hsl(${hue},70%,45%)`; for (let s = 0; s < 6; s++) { ctx.fillStyle = s % 2 ? '#f4efe6' : `hsl(${hue},70%,45%)`; ctx.fillRect(x + 14 + s * (SW - 28) / 6, top - 168, (SW - 28) / 6, 22); } // 雨遮
    const sign = BW_SIGNS[((i % BW_SIGNS.length) + BW_SIGNS.length) % BW_SIGNS.length];
    ctx.fillStyle = `hsl(${hue},80%,22%)`; ctx.fillRect(x + 30, top - 250, SW - 60, 56);
    ctx.save(); ctx.shadowColor = `hsl(${hue},100%,65%)`; ctx.shadowBlur = 12; ctx.fillStyle = `hsl(${hue},100%,78%)`;
    ctx.font = 'bold 34px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center'; ctx.fillText(sign, x + SW / 2, top - 209); ctx.restore();
    // 直式霓虹招牌
    const vs = BW_SIGNS[((i * 3 + 4) % BW_SIGNS.length + BW_SIGNS.length) % BW_SIGNS.length].slice(0, 3), on = Math.sin(ts * 3 + i) > -.85;
    ctx.fillStyle = '#1a1424'; ctx.fillRect(x + SW - 34, top - 420, 30, 34 * vs.length + 12);
    ctx.save(); ctx.font = 'bold 26px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = on ? `hsl(${(hue + 140) % 360},100%,70%)` : '#4a3f55'; if (on) { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14; }
    [...vs].forEach((ch, n) => ctx.fillText(ch, x + SW - 19, top - 388 + n * 34)); ctx.restore();
    // 紅燈籠
    for (let l = 0; l < 3; l++) {
      const lx = x + 50 + l * 75, ly = top - 128 + Math.sin(ts * 1.6 + i + l) * 2;
      ctx.fillStyle = '#d6262a'; ctx.beginPath(); ctx.ellipse(lx, ly, 13, 17, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd34d'; ctx.fillRect(lx - 7, ly - 19, 14, 4); ctx.fillRect(lx - 7, ly + 15, 14, 4);
    }
  }
  // 地面：磚地（橫線照深度、直縫照透視）
  const fg = ctx.createLinearGradient(0, top, 0, H); fg.addColorStop(0, '#5a4a52'); fg.addColorStop(1, '#3a2f38');
  ctx.fillStyle = fg; ctx.fillRect(0, top, W, H - top);
  ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 2;
  for (let z = 0; z <= BW_ZMAX; z += 38) { const y = bwGY(z); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let wx = Math.floor(cam / 140) * 140 - 280; wx < cam + W + 280; wx += 140) {
    const sx = wx - cam; ctx.beginPath(); ctx.moveTo(W / 2 + (sx - W / 2) * .82, top); ctx.lineTo(W / 2 + (sx - W / 2) * 1.08, H); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, top - 4, W, 8);
}
function bwPose(ft, ts) {
  if (ft.downT > 0 && !ft.ko) { const k = ft.downT < .25 ? ft.downT / .25 : Math.min(1, ft.downAge / .3); return { pose: lerpPose(N, KO, ease(k)), face: 'hurt' }; }
  const a = ft.act;
  if (a && a.type === 'bwa') return { pose: sampleKeys(a.keys, a.t), face: 'shout' };
  return poseOf(ft, ts);
}
function bwDrawFt(ft, ts) {
  const s = bwSc(ft.z), sx = ft.x - BW.cam, gy = bwGY(ft.z);
  const { pose, f, face } = bwPose(ft, ts);
  let alpha;
  if (ft.ko && ft.team) alpha = Math.max(0, 1 - Math.max(0, ft.koT - .8));
  else if (ft.inv > .5 && ft.team === 0) alpha = .45 + .4 * (Math.sin(ts * 40) > 0);
  ctx.save(); ctx.translate(sx, gy); ctx.scale(s, s); ctx.translate(0, -GROUND);
  if (ft.armor > 0 && ft.boss && !ft.ko) { ctx.fillStyle = 'rgba(255,214,90,.18)'; ctx.beginPath(); ctx.ellipse(0, GROUND - ft.y - 130, 70, 150, 0, 0, 7); ctx.fill(); }
  const drawn = drawFighter(ft, pose, { x: 0, y: ft.y, f, face, tone: ft.flash > 0 ? FLASH_TONE : null, alpha });
  const pm = ft.act && ft.act.type === 'mv' && !ft.ko && MOVES[ft.act.id].prop; // 招式道具（籃球、樹）：道具是照 ft.x 畫的，先借 0 用
  if (pm && drawn) { const ox = ft.x; ft.x = 0; const at = pm(ft, drawn, ft.act.t); ft.x = ox; if (at) drawBasketball(at[0], at[1], 16, ft.act.t * 9 * ft.face); }
  if (ft.bwGuardT > 0 && !ft.ko) { ctx.strokeStyle = 'rgba(159,224,255,.85)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(0, GROUND - ft.y - 130, 70, 150, 0, 0, 7); ctx.stroke(); }
  const top = GROUND - ft.y - 300;
  if (!ft.ko) {
    if (ft.team === 0) { // 頭上的 1P～4P 標籤
      ctx.fillStyle = BW_COL[ft.slot]; ctx.beginPath(); ctx.moveTo(-14, top + 14); ctx.lineTo(14, top + 14); ctx.lineTo(0, top + 30); ctx.fill();
      ctx.font = 'bold 38px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center'; outlineText((ft.slot + 1) + 'P', 0, top + 8, BW_COL[ft.slot], 7);
    } else if (!ft.boss && ft.hp < ft.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(-50, top + 10, 100, 12); ctx.fillStyle = '#ff5a5a'; ctx.fillRect(-48, top + 12, 96 * ft.hp / ft.maxHp, 8);
    }
    const a = ft.act, d = a && a.type === 'bwa' && BW_ATK[a.id];
    if (ft.team === 1 && d && d.warn && a.t < d.warn) { ctx.font = '900 64px sans-serif'; ctx.textAlign = 'center'; outlineText('！', 0, top - 4, '#ff3b3b', 8); } // 前搖：要出手了
    if (ft.confT > 0) { ctx.font = '900 56px sans-serif'; ctx.textAlign = 'center'; outlineText('？', 0, top - 4, '#06c755', 8); }
    if (ft.stun > 0) for (let i = 0; i < 3; i++) { const an = ts * 6 + i * 2.1; ctx.fillStyle = '#ffe14d'; ctx.font = '30px sans-serif'; ctx.fillText('★', Math.cos(an) * 40 - 12, top + 40 + Math.sin(an) * 10); }
  }
  ctx.restore();
}
function bwDrawShot(b) {
  const s = bwSc(b.z), sx = b.x - BW.cam, sy = bwGY(b.z) - b.y * s;
  if (b.kind === 'ball') { drawBall(sx, sy, b.spin, 15 * s * 1.4); return; }
  if (b.kind === 'zone') { ctx.save(); ctx.translate(sx, bwGY(b.z)); ctx.scale(s * 1.3, s * 1.3); ctx.translate(0, -GROUND); drawProj(Object.assign({}, b, { x: 0 })); ctx.restore(); return; }
  if (b.kind !== 'yell') { ctx.save(); ctx.translate(sx, sy); ctx.scale(s * 1.3, s * 1.3); drawProj(Object.assign({}, b, { x: 0, y: 0 })); ctx.restore(); return; } // 開除通知、加 LINE、籃球
  ctx.save(); ctx.translate(sx, sy); ctx.scale(s * 1.4, s * 1.4); // 大媽的罵聲
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, 0, 46, 30, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-Math.sign(b.vx) * 30, 14); ctx.lineTo(-Math.sign(b.vx) * 52, 30); ctx.lineTo(-Math.sign(b.vx) * 14, 22); ctx.fill();
  ctx.fillStyle = '#e0245e'; ctx.font = '900 34px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center'; ctx.fillText('罵！', 0, 12);
  ctx.restore();
}
function bwHUD(ts) {
  for (let i = 0; i < 4; i++) {
    const x = 64 + i * 302, y = 10, s = BW.slots[i], p = s && s.ft;
    ctx.fillStyle = 'rgba(10,8,24,.72)'; ctx.fillRect(x, y, 292, 78);
    ctx.fillStyle = BW_COL[i]; ctx.fillRect(x, y, 6, 78);
    ctx.textAlign = 'left'; ctx.font = 'bold 20px "Microsoft JhengHei",sans-serif';
    if (!p) { ctx.globalAlpha = .55 + .3 * Math.sin(ts * 4); outlineText((i + 1) + 'P　按攻擊鍵加入', x + 18, y + 47, '#fff', 4); ctx.globalAlpha = 1; continue; }
    outlineText((i + 1) + 'P ' + CHARS[s.char].name, x + 16, y + 26, BW_COL[i], 4);
    ctx.textAlign = 'right'; ctx.font = 'bold 18px sans-serif'; outlineText('♥'.repeat(Math.max(0, s.lives + (p.ko ? 0 : 1))) || '✖', x + 284, y + 26, '#ff6b8b', 4);
    ctx.fillStyle = '#300'; ctx.fillRect(x + 16, y + 34, 268, 14);
    ctx.fillStyle = p.hp > p.maxHp * .3 ? '#5fe08a' : '#ff5a5a'; ctx.fillRect(x + 16, y + 34, 268 * p.hp / p.maxHp, 14);
    [...p.load.map((id, n) => [bwMvName(id)[0], p.kcd[n], p.kmax[n]])].forEach(([ch, cd, mx], n) => { // 三招的冷卻
      const cx = x + 28 + n * 32, cy = y + 64;
      ctx.fillStyle = cd > 0 ? '#3a3550' : '#ffcf3d'; ctx.beginPath(); ctx.arc(cx, cy, 13, 0, 7); ctx.fill();
      if (cd > 0) { ctx.fillStyle = 'rgba(255,207,61,.5)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - cd / mx)); ctx.fill(); }
      ctx.fillStyle = cd > 0 ? '#fff' : '#3a2a00'; ctx.font = 'bold 15px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center'; ctx.fillText(cd > 0 ? (cd < 1 ? cd.toFixed(1).slice(1) : Math.ceil(cd)) : ch, cx, cy + 5); // 冷卻中寫剩幾秒
    });
    ctx.textAlign = 'right'; ctx.font = 'bold 15px "Microsoft JhengHei",sans-serif'; outlineText('傷害 ' + s.dealt + '　擊倒 ' + s.kills, x + 284, y + 70, '#ddd', 3);
    if (p.ko && s.lives > 0 && BW.st === 'play') { ctx.textAlign = 'center'; ctx.font = 'bold 18px "Microsoft JhengHei",sans-serif'; outlineText('復活中…', x + 146, y + 47, '#fff', 4); }
  }
  const b = BW.boss;
  if (b && !b.ko) { // 馬師傅血條
    ctx.fillStyle = 'rgba(10,8,24,.75)'; ctx.fillRect(240, H - 52, 800, 40);
    ctx.fillStyle = '#300'; ctx.fillRect(330, H - 40, 696, 18);
    ctx.fillStyle = b.armor > 0 ? '#ffd34d' : '#ff4848'; ctx.fillRect(330, H - 40, 696 * b.hp / b.maxHp, 18);
    ctx.textAlign = 'left'; ctx.font = 'bold 22px "Microsoft JhengHei",sans-serif'; outlineText('馬師傅', 252, H - 23, '#9fe0ff', 4);
  }
  // 進度條：關卡走到哪
  ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(W / 2 - 150, 96, 300, 6);
  ctx.fillStyle = '#ffd34d'; ctx.fillRect(W / 2 - 150, 96, 300 * Math.min(1, BW.cam / (BW_LEN - W)), 6);
}
function bwDrawJoin(ts) {
  ctx.fillStyle = 'rgba(8,6,20,.62)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.font = '900 56px "Microsoft JhengHei",sans-serif'; outlineText('夜市大亂鬥　四人闖關', W / 2, 78, '#ffd34d', 9);
  ctx.font = 'bold 22px "Microsoft JhengHei",sans-serif'; outlineText('1～4 人同一台一起打：鍵盤兩個人＋手把最多四支，招式自己選', W / 2, 114, '#fff', 4);
  for (let i = 0; i < 4; i++) {
    const s = BW.slots[i], x = 40 + i * 302, y = 140, w = 290, h = 410;
    ctx.fillStyle = s ? 'rgba(30,24,60,.9)' : 'rgba(30,24,60,.5)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = s && s.ready ? '#5fe08a' : BW_COL[i]; ctx.lineWidth = s && s.ready ? 6 : 3; ctx.strokeRect(x, y, w, h);
    ctx.font = 'bold 34px "Microsoft JhengHei",sans-serif'; outlineText((i + 1) + 'P', x + w / 2, y + 44, BW_COL[i], 6);
    if (!s) {
      ctx.globalAlpha = .6 + .35 * Math.sin(ts * 4 + i); ctx.font = 'bold 22px "Microsoft JhengHei",sans-serif';
      outlineText('按攻擊鍵加入', x + w / 2, y + 200, '#fff', 4); ctx.globalAlpha = 1;
      ctx.font = '17px "Microsoft JhengHei",sans-serif'; ctx.fillStyle = '#bbb';
      ['鍵盤 1P：J', '鍵盤 2P：Numpad1 或 ,', '手把：X'].forEach((t, n) => ctx.fillText(t, x + w / 2, y + 240 + n * 26));
      continue;
    }
    if (!s.prev || s.prev.char !== s.char) { s.prev = new Fighter('p1', 0, 1); s.prev.char = s.char; }
    ctx.save(); ctx.translate(x + w / 2, y + 262); ctx.scale(.62, .62); ctx.translate(0, -GROUND);
    const br = Math.sin(ts * 2.4) * 2;
    drawFighter(s.prev, s.ready ? P({ bA: -150, bE: -10, fA: 150, fE: 10, dy: -Math.abs(Math.sin(ts * 6)) * 8 }) : P({ bA: -10 - br, fA: 10 + br, dy: br * .5 }), { x: 0, y: 0, f: 1, face: s.ready ? 'shout' : null });
    ctx.restore();
    const sel = n => !s.ready && s.row === n; // 正在改的那格：黃字＋左右箭頭
    if (sel(0)) { ctx.fillStyle = 'rgba(255,211,77,.18)'; ctx.fillRect(x + 8, y + 274, w - 16, 34); }
    ctx.font = 'bold 26px "Microsoft JhengHei",sans-serif'; outlineText((sel(0) ? '◀ ' : '') + CHARS[s.char].name + (sel(0) ? ' ▶' : ''), x + w / 2, y + 300, sel(0) ? '#ffd34d' : '#fff', 5);
    const keys = s.src === 'k1' && !isTouch ? ['J·1', 'K·2', 'L·3'] : s.src === 'k2' ? [',', '.', '/'] : s.src[0] === 'g' ? ['Y', 'B', 'RT'] : ['招1', '招2', '招3']; // 手機、線上客人：按鈕上寫的就是招名
    ctx.font = 'bold 18px "Microsoft JhengHei",sans-serif';
    s.load.forEach((id, n) => {
      const yy = y + 330 + n * 24;
      if (sel(n + 1)) { ctx.fillStyle = 'rgba(255,211,77,.18)'; ctx.fillRect(x + 8, yy - 18, w - 16, 24); }
      outlineText((sel(n + 1) ? '◀ ' : '') + keys[n] + '　' + bwMvName(id) + (sel(n + 1) ? ' ▶' : ''), x + w / 2, yy, sel(n + 1) ? '#ffd34d' : '#cfe3ff', 4);
    });
    ctx.font = 'bold 18px "Microsoft JhengHei",sans-serif';
    outlineText(s.ready ? '準備好了！' : s.src[0] === 'n' || isTouch ? '搖桿上下選格、左右換，按「打」準備' : '上下選格、左右換，攻擊鍵準備', x + w / 2, y + 402, s.ready ? '#5fe08a' : '#ffd34d', 4);
    if (s.src[0] === 'n') { ctx.font = 'bold 16px "Microsoft JhengHei",sans-serif'; outlineText(s.src === 'n' + BWN.key ? '📱 你' : '📱 線上', x + w - 46, y + 30, '#9fe0ff', 4); }
  }
  ctx.font = '18px "Microsoft JhengHei",sans-serif'; ctx.fillStyle = '#ddd';
  ctx.fillText('1P：WASD 走（W／S 往裡外）、空白跳、J／K／L 或 1／2／3 三招、H 打（連按三段）', W / 2, 590);
  ctx.fillText("2P：方向鍵、右 Shift 跳、, . / 三招、' 打　｜　手把：A 跳、X 打、Y／B／RT 三招", W / 2, 618);
  if (BWN.role) { ctx.font = 'bold 20px "Microsoft JhengHei",sans-serif'; outlineText(BWN.role === 'host' ? '線上房號 ' + BWN.room + '：手機掃右上角的 QR code 就能加入（已連線 ' + Object.keys(BWN.guests).length + ' 人）' : BWN.ok ? '已連線到房號 ' + BWN.room + '，等房主開打' : '連線中…', W / 2, 650, '#9fe0ff', 4); }
  else ctx.fillText('全部準備好就開打（Enter 直接開始，Esc 回首頁）。開打後還沒加入的人，按攻擊鍵可以中途加入', W / 2, 646);
  if (BW.goT > 0) { ctx.font = '900 64px "Microsoft JhengHei",sans-serif'; outlineText('開打！', W / 2, 400, '#ffd34d', 10); }
}
function bwDraw(ts) {
  ctx.save();
  if (BW.shake > 0) { ctx.translate((Math.random() - .5) * BW.shake, (Math.random() - .5) * BW.shake); BW.shake *= .85; if (BW.shake < .5) BW.shake = 0; }
  bwBg(BW.cam, ts);
  if (BW.st === 'join') { bwDrawJoin(ts); ctx.restore(); return; }
  for (const b of BW.bolts) { // 落雷警示圈
    const s = bwSc(b.z), sx = b.x - BW.cam, gy = bwGY(b.z), k = Math.min(1, b.t / b.warn);
    ctx.save(); ctx.globalAlpha = b.hit ? 1 - (b.t - b.warn) / .3 : .35 + .4 * k;
    ctx.strokeStyle = '#9fe0ff'; ctx.lineWidth = 3; ctx.fillStyle = 'rgba(159,224,255,.25)';
    ctx.beginPath(); ctx.ellipse(sx, gy, 110 * s * k + 10, 34 * s * k + 4, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  for (const e of BW.ents) { // 影子
    const s = bwSc(e.z), sx = e.x - BW.cam, gy = bwGY(e.z), k = Math.max(.4, 1 - e.y / 500);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(sx, gy, 55 * s * k, 14 * s * k, 0, 0, 7); ctx.fill();
  }
  for (const g of BW.ghosts) {
    if (g.t < 0) continue;
    const s = bwSc(g.z);
    ctx.save(); ctx.globalAlpha = .45 * (1 - g.t / g.life); ctx.translate(g.x - BW.cam, bwGY(g.z)); ctx.scale(s, s); ctx.translate(0, -GROUND);
    drawFighter(g.ft, g.pose, { x: 0, y: g.y, f: g.f, tone: GHOST_TONE }); ctx.restore();
  }
  const list = [...BW.ents.map(e => ({ z: e.z, e })), ...BW.shots.map(b => ({ z: b.z - .5, b }))].sort((a, b) => b.z - a.z); // 裡面的先畫
  for (const it of list) it.e ? bwDrawFt(it.e, ts) : bwDrawShot(it.b);
  for (const b of BW.bolts) if (b.hit) { // 閃電
    const sx = b.x - BW.cam, gy = bwGY(b.z);
    ctx.save(); ctx.globalAlpha = 1 - (b.t - b.warn) / .3; ctx.strokeStyle = '#e8f8ff'; ctx.lineWidth = 6; ctx.shadowColor = '#9fe0ff'; ctx.shadowBlur = 20;
    ctx.beginPath(); let y = 0, x = sx; ctx.moveTo(x, y); while (y < gy) { y += 40; x = sx + (bwHash(y + b.x) - .5) * 50; ctx.lineTo(x, Math.min(y, gy)); } ctx.stroke(); ctx.restore();
  }
  for (const f of BW.fx) {
    const s = bwSc(f.z), sx = f.x - BW.cam, sy = bwGY(f.z) - f.y * s;
    if (f.type === 'num' || f.type === 'txt') { ctx.save(); ctx.globalAlpha = 1 - f.t / .9; ctx.textAlign = 'center'; ctx.font = 'bold ' + (f.type === 'txt' ? 26 : 24) + 'px "Microsoft JhengHei",sans-serif'; outlineText(f.text, sx, sy - f.t * 50, f.col, 4); ctx.restore(); }
    else if (f.type === 'spark') { const k = f.t / .25, r = (f.big ? 46 : 30) * s * 1.6 * (.5 + k); ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#fff3a0'; ctx.lineWidth = 4; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * r * .4, sy + Math.sin(a) * r * .4); ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); ctx.stroke(); } ctx.restore(); }
    else if (f.type === 'ring') { const k = f.t / .5; ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#fff07a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(sx, bwGY(f.z), 40 + 120 * k, 12 + 30 * k, 0, 0, 7); ctx.stroke(); ctx.restore(); }
  }
  bwHUD(ts);
  for (const c of BW.caps) { // 字幕
    ctx.save(); ctx.globalAlpha = Math.min(1, (3 - c.t) * 2); ctx.font = 'bold 30px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'center';
    const y = BW.boss && !BW.boss.ko ? H - 72 : H - 30; outlineText(c.text, W / 2, y, '#fff', 6); ctx.restore();
  }
  if (BW.ban) {
    const k = Math.min(1, BW.ban.t / .25), out = Math.max(0, (BW.ban.t - 1.8) / .4);
    ctx.save(); ctx.globalAlpha = k * (1 - out);
    if (BW.ban.go) { ctx.textAlign = 'right'; ctx.font = '900 72px "Microsoft JhengHei",sans-serif'; if (Math.sin(ts * 8) > -.3) outlineText(BW.ban.text, W - 40, 330, '#ffd34d', 9); }
    else { ctx.translate(W / 2, 300); ctx.scale(1.5 - .5 * k, 1.5 - .5 * k); ctx.textAlign = 'center'; ctx.font = '900 84px "Microsoft JhengHei",sans-serif'; outlineText(BW.ban.text, 0, 0, '#ffd34d', 10); ctx.font = 'bold 36px "Microsoft JhengHei",sans-serif'; outlineText(BW.ban.sub, 0, 56, '#fff', 6); }
    ctx.restore();
  }
  if (!BW.inWave && BW.st === 'play' && BW_WAVES[BW.wave + 1] && !BW.ban && Math.sin(ts * 8) > -.3) { ctx.textAlign = 'right'; ctx.font = '900 72px "Microsoft JhengHei",sans-serif'; outlineText('GO ➜', W - 40, 330, '#ffd34d', 9); }
  if (BW.st === 'clear' || BW.st === 'over') { ctx.textAlign = 'center'; ctx.font = '900 110px "Microsoft JhengHei",sans-serif'; outlineText(BW.st === 'clear' ? '通關！' : '全滅…', W / 2, 330, BW.st === 'clear' ? '#ffd34d' : '#ff6b6b', 12); }
  if (BW.st === 'result') {
    ctx.fillStyle = 'rgba(8,6,20,.78)'; ctx.fillRect(0, 0, W, H);
    const won = BW.boss && BW.boss.ko;
    ctx.textAlign = 'center'; ctx.font = '900 70px "Microsoft JhengHei",sans-serif'; outlineText(won ? '打贏馬師傅了！' : '再接再厲', W / 2, 120, won ? '#ffd34d' : '#ff8a8a', 9);
    const mvp = BW.slots.reduce((m, s) => s.dealt > (m ? m.dealt : -1) ? s : m, null);
    BW.slots.forEach((s, i) => {
      const x = 40 + i * 302, y = 170;
      ctx.fillStyle = 'rgba(30,24,60,.9)'; ctx.fillRect(x, y, 290, 330); ctx.strokeStyle = BW_COL[i]; ctx.lineWidth = 3; ctx.strokeRect(x, y, 290, 330);
      ctx.font = 'bold 30px "Microsoft JhengHei",sans-serif'; outlineText((i + 1) + 'P ' + CHARS[s.char].name, x + 145, y + 46, BW_COL[i], 5);
      if (s === mvp && BW.slots.length > 1) { ctx.font = '900 30px sans-serif'; outlineText('👑 MVP', x + 145, y + 92, '#ffd34d', 5); }
      ctx.font = 'bold 26px "Microsoft JhengHei",sans-serif';
      [['造成傷害', s.dealt], ['擊倒敵人', s.kills], ['被打倒', s.downs]].forEach(([t, v], n) => { ctx.textAlign = 'left'; outlineText(t, x + 24, y + 160 + n * 52, '#ddd', 4); ctx.textAlign = 'right'; outlineText(String(v), x + 266, y + 160 + n * 52, '#fff', 4); });
      ctx.textAlign = 'center';
    });
    ctx.font = 'bold 26px "Microsoft JhengHei",sans-serif'; outlineText('按攻擊鍵或點畫面：再玩一次　｜　Esc 回首頁', W / 2, 580, '#fff', 5);
  }
  ctx.restore();
}
cv.addEventListener('pointerdown', () => { // 手機：點畫面加入（1P，之後用搖桿選角色、選招，按「打」準備）／再玩一次
  if (!BW.on || BWN.role === 'guest') return;
  if (BW.st === 'join') { if (!BW.slots.some(q => q.src === 'k1') && BW.slots.length < 4) { const c = bwFreeChar(!BW.slots.length); BW.slots.push({ src: 'k1', char: c, load: bwLoadOf(c), row: 0, ready: false }); synth('pop'); } }
  else if (BW.st === 'result') bwBackToJoin();
});

/* ---- 四人合作：線上加入。房主跑整場，客人只送按鍵（經伺服器轉），房主每 0.05 秒送一次畫面狀態給客人畫 ---- */
const BW_BITS = ['L', 'R', 'U', 'D', 'J', 'A', 'B', 'C', 'E', 'S', 'go'];
const bwBits = i => BW_BITS.reduce((v, k, n) => v | (i[k] ? 1 << n : 0), 0);
const bwUnbits = v => { const o = {}; BW_BITS.forEach((k, n) => o[k] = !!(v >> n & 1)); return o; };
const bwSrcs = () => BWN.role === 'host' ? BW_SRCS.concat(Object.keys(BWN.guests).map(g => 'n' + g)) : BW_SRCS;
const bwCoLink = () => location.origin + location.pathname + '?co=' + BWN.room + '&qr=1';
function bwNetSend(o) { if (BWN.ws && BWN.ws.readyState === 1) try { BWN.ws.send(JSON.stringify(o)); } catch (e) {} }
function bwNetConnect(role) {
  BWN.role = role; BWN.leaving = false;
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/co?room=' + BWN.room + '&role=' + role + '&k=' + BWN.key);
  BWN.ws = ws;
  ws.onmessage = e => { if (BWN.ws === ws) { let m; try { m = JSON.parse(e.data); } catch (err) { return; } bwNetMsg(m); } };
  ws.onclose = () => {
    if (BWN.ws !== ws) return;
    BWN.ws = null; BWN.ok = false;
    if (BWN.leaving || !BW.on || !BWN.role) return;
    if (document.hidden) { BWN.reHidden = role; return; } // 切到別的網頁／App 時被斷：不算失敗次數，回來再接
    BWN.tries = (BWN.tries || 0) + 1; // 手機切到別的 App 常被斷線：用同一把 key 接回去
    if (BWN.tries < 20) BWN.retryT = setTimeout(() => { if (BW.on && BWN.role === role) bwNetConnect(role); }, Math.min(500 * BWN.tries, 4000));
    else if (role === 'guest') bwNetFail('連線中斷了');
    else BWN.retryT = setTimeout(() => { if (BW.on && BWN.role === role) { BWN.tries = 10; bwNetConnect(role); } }, 8000); // 房主不放棄：一直試，客人那邊會等
  };
}
document.addEventListener('visibilitychange', () => { // 從別的網頁／App 切回來：斷掉的線馬上接回去
  if (document.hidden || !BW.on || !BWN.role || BWN.leaving) return;
  if (!BWN.ws || BWN.ws.readyState > 1) { const r = BWN.reHidden || BWN.role; BWN.reHidden = null; BWN.tries = 0; clearTimeout(BWN.retryT); bwNetConnect(r); }
});
function bwNetHost() { // 房主：開一個 5 位數房號，亮 QR code
  if (BWN.role === 'host') { bwQrShow(); return; }
  BWN.room = String(10000 + Math.floor(Math.random() * 90000)); BWN.key = Math.random().toString(36).slice(2, 14); BWN.guests = {}; BWN.tries = 0;
  bwNetConnect('host');
}
function bwNetJoin(room, key) { // 客人：掃 QR code 進來（key：回到剛剛的房間時沿用原本的代號，房主那邊的角色還是你的）
  bwOpen(); BWN.room = room; BWN.key = key || Math.random().toString(36).slice(2, 14); BWN.tries = 0; BWN.ents = new Map(); BWN.slots = {}; BWN.hostGone = 0;
  bwNetConnect('guest');
}
function bwNetClose() {
  BWN.leaving = true; clearTimeout(BWN.retryT);
  if (BWN.ws) try { BWN.ws.close(); } catch (e) {}
  if (BWN.role === 'guest') { BW.ents = []; BW.slots = []; BW.shots = []; } // 客人的角色是照房主畫面擺的，沒有自己的按鍵來源
  Object.assign(BWN, { role: null, ws: null, ok: false, guests: {}, snd: [], pend: 0, held: 0, ents: new Map(), slots: {} });
  document.getElementById('bwQr').classList.add('hide');
}
function bwNetFail(msg) { const g = BWN.role === 'guest'; bwNetClose(); lsSet(BW_NET_KEY, ''); BWN.stash = null; if (g) goHome(false); askYes(msg, () => {}, '知道了'); }
// 不小心跳出去（按到首頁、App 被關、重新整理）：房號和自己的 key 記在這台裝置，10 分鐘內可以用同一把 key 回去
const BW_NET_KEY = 'ssb_bw_net', BW_BACK_MS = 10 * 60 * 1000;
function bwNetSaved() { let s = null; try { s = JSON.parse(lsGet(BW_NET_KEY) || 'null'); } catch (e) {} return s && s.room && s.key && Date.now() - s.at < BW_BACK_MS ? s : null; }
function bwNetBack() {
  const s = bwNetSaved(); if (!s) return;
  if (s.role === 'guest') { bwNetJoin(s.room, s.key); return; }
  bwOpen();
  const st = BWN.stash; BWN.stash = null;
  if (st && st.room === s.room && Date.now() - st.at < BW_BACK_MS) { Object.assign(BW, st.bw, { on: true }); BWN.guests = st.guests; } else BWN.guests = {};
  BWN.room = s.room; BWN.key = s.key; BWN.tries = 0; BWN.back = true;
  bwNetConnect('host');
}
document.getElementById('bwBackBtn').onclick = () => { unlockAudio(); bwNetBack(); };
// 房主踢人：伺服器把他斷掉、這一局不准他再進來；他的角色直接從場上拿掉
function bwKick(g) {
  if (BWN.role !== 'host') return;
  bwNetSend({ t: 'kick', g }); delete BWN.guests[g];
  const i = BW.slots.findIndex(s => s.src === 'n' + g);
  if (i >= 0) {
    const s = BW.slots.splice(i, 1)[0];
    if (s.ft) { stopChant(s.ft); BW.ents = BW.ents.filter(e => e !== s.ft); BW.ghosts = BW.ghosts.filter(q => q.ft !== s.ft); }
    BW.slots.forEach((q, n) => { if (q.ft) q.ft.slot = n; }); // 後面的人往前補，顏色跟 ?P 跟著換
  }
  synth('pop'); bwKickList();
}
function bwKickList() {
  const L = document.getElementById('bwKickList'), gs = BW.slots.map((s, n) => [s, n]).filter(([s]) => s.src[0] === 'n');
  L.innerHTML = gs.length ? '' : '<div style="padding:10px;color:#bbb">現在沒有線上玩家</div>';
  for (const [s, n] of gs) {
    const r = document.createElement('div'); r.className = 'kr';
    const t = document.createElement('span'); t.textContent = (n + 1) + 'P　📱 ' + (CHARS[s.char] ? CHARS[s.char].name : ''); t.style.color = BW_COL[n];
    const b = document.createElement('button'); b.textContent = '踢出'; b.style.cssText = 'background:#e0464a;color:#fff';
    b.onclick = () => askYes('把 ' + (n + 1) + 'P 請出房間？他這一局不能再進來。', () => bwKick(s.src.slice(1)), '踢出');
    r.append(t, b); L.append(r);
  }
}
document.getElementById('bwKickBtn').onclick = () => { bwKickList(); document.getElementById('bwKickBox').classList.remove('hide'); };
document.getElementById('bwKickNo').onclick = () => document.getElementById('bwKickBox').classList.add('hide');
// 自選三招：整排招直接點，不用在選角格子裡左右一格一格換。房主這台改本機玩家（鍵盤、手把、手機），客人只改自己（送給房主）
const BWP = { src: null, sel: [] };
const bwMine = () => BW.slots.filter(s => BWN.role === 'guest' ? s.src === 'n' + BWN.key : s.src[0] !== 'n');
const bwCdOf = k => k === 'shan' ? BW_SHAN_CD : k === 'ball' ? 1.4 : k === 'bear' ? 6 : MOVES[k].cd;
const bwDescOf = k => ({ shan: '往搖桿方向瞬移；被打暈時按這招可以脫身', ball: '踢出足球打遠距離', bear: '衝上去連打、控住對手' })[k] || MOVES[k].desc;
function bwPickOpen() {
  const mine = bwMine(); if (!mine.length) return;
  if (!mine.some(s => s.src === BWP.src)) BWP.src = mine[0].src;
  BWP.sel = (mine.find(s => s.src === BWP.src).load || []).slice();
  document.getElementById('bpMsg').textContent = ''; bwPickRender(); document.getElementById('bwPick').classList.remove('hide');
}
function bwPickRender() {
  const s = BW.slots.find(q => q.src === BWP.src); if (!s) { document.getElementById('bwPick').classList.add('hide'); return; }
  const who = document.getElementById('bpWho'), mine = bwMine(); who.innerHTML = '';
  if (mine.length > 1) for (const q of mine) { // 同一台有好幾個人：先選要改誰
    const b = document.createElement('button'), n = BW.slots.indexOf(q); b.textContent = (n + 1) + 'P ' + CHARS[q.char].name; b.className = q.src === BWP.src ? 'on' : '';
    b.onclick = () => { BWP.src = q.src; BWP.sel = q.load.slice(); bwPickRender(); }; who.append(b);
  }
  const keyOf = s.src === 'k1' && !isTouch ? ['J 或 1', 'K 或 2', 'L 或 3'] : s.src === 'k2' ? [',', '.', '/'] : s.src[0] === 'g' ? ['Y', 'B', 'RT'] : ['招1', '招2', '招3'];
  const sl = document.getElementById('bpSlots'); sl.innerHTML = '';
  keyOf.forEach((key, i) => { const d = document.createElement('div'); d.className = BWP.sel[i] ? 'on' : ''; d.textContent = BWP.sel[i] ? bwMvName(BWP.sel[i]) : '（空）'; const sm = document.createElement('small'); sm.textContent = key; d.append(sm); sl.append(d); });
  const g = document.getElementById('bpGrid'); g.innerHTML = '';
  for (const k of bwPool(s.char)) {
    const b = document.createElement('button'), n = BWP.sel.indexOf(k); if (n >= 0) b.className = 'on';
    const t = document.createElement('b'); t.textContent = bwMvName(k); if (n >= 0) t.dataset.n = n + 1;
    const c = document.createElement('i'); c.textContent = '冷卻 ' + bwCdOf(k) + ' 秒';
    const d = document.createElement('span'); d.textContent = bwDescOf(k);
    b.append(t, c, d);
    b.onclick = () => { const j = BWP.sel.indexOf(k); if (j >= 0) BWP.sel.splice(j, 1); else if (BWP.sel.length < 3) BWP.sel.push(k); else { document.getElementById('bpMsg').textContent = '已經選滿三招，先點掉一招再換'; return; } document.getElementById('bpMsg').textContent = ''; bwPickRender(); };
    g.append(b);
  }
}
function bwPickApply(src, l) { // 房主（或沒連線）這台：真的改掉那格的三招，記下來下次沿用
  const s = BW.slots.find(q => q.src === src), pool = s && bwPool(s.char);
  if (!s || !Array.isArray(l) || l.length !== 3 || new Set(l).size !== 3 || !l.every(k => pool.includes(k))) return false;
  s.load = l.slice(); if (s.ft) s.ft.load = l.slice();
  let all = {}; try { all = JSON.parse(lsGet(BW_LOAD_KEY) || '{}') || {}; } catch (e) {}
  all[s.char] = s.load; lsSet(BW_LOAD_KEY, JSON.stringify(all)); return true;
}
document.getElementById('bwPickBtn').onclick = () => { unlockAudio(); bwPickOpen(); };
document.getElementById('bpNo').onclick = () => document.getElementById('bwPick').classList.add('hide');
document.getElementById('bpOk').onclick = () => {
  if (BWP.sel.length !== 3) { document.getElementById('bpMsg').textContent = '要選滿三招'; return; }
  if (BWN.role === 'guest') { bwNetSend({ t: 'ld', l: BWP.sel }); const s = BW.slots.find(q => q.src === BWP.src); if (s) s.load = BWP.sel.slice(); }
  else bwPickApply(BWP.src, BWP.sel);
  synth('pop'); document.getElementById('bwPick').classList.add('hide');
};
async function bwQrShow() {
  try { await loadQrLib(); } catch (e) { askYes('QR code 載入失敗，請把房號 ' + BWN.room + ' 告訴朋友：網址加 ?co=' + BWN.room, () => {}, '知道了'); return; }
  const q = qrcode(0, 'M'); q.addData(bwCoLink()); q.make();
  document.getElementById('bwQrImg').innerHTML = q.createSvgTag(8, 16); document.getElementById('bwQrRoom').textContent = BWN.room;
  document.getElementById('bwQr').classList.remove('hide');
}
document.getElementById('bwQr').onclick = () => document.getElementById('bwQr').classList.add('hide');
document.getElementById('bwNetBtn').onclick = () => { unlockAudio(); bwNetHost(); };
// 沒辦法掃 QR code（例如兩支手機、或用電腦加入）：直接輸入房號
document.getElementById('bwJoinBtn').onclick = () => { unlockAudio(); const i = document.getElementById('bwJoinIn'); i.value = ''; document.getElementById('bwJoinMsg').textContent = ''; document.getElementById('bwJoinBox').classList.remove('hide'); i.focus(); }; // 要在點按當下 focus，手機才會跳出鍵盤
document.getElementById('bwJoinNo').onclick = () => document.getElementById('bwJoinBox').classList.add('hide');
document.getElementById('bwJoinIn').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') document.getElementById('bwJoinGo').click(); }); // 打字不要被遊戲當成按鍵
document.getElementById('bwJoinGo').onclick = () => {
  const r = document.getElementById('bwJoinIn').value.replace(/\D/g, '');
  if (r.length < 4) { document.getElementById('bwJoinMsg').textContent = '房號是房主畫面上的 5 位數字'; return; }
  document.getElementById('bwJoinBox').classList.add('hide'); bwNetJoin(r);
};
function bwNetMsg(m) {
  if (m.t === 'err') { bwNetFail(m.msg); return; }
  if (m.t === 'ok') { BWN.ok = true; BWN.tries = 0; BWN.lastSnap = Date.now(); lsSet(BW_NET_KEY, JSON.stringify({ room: BWN.room, key: BWN.key, role: BWN.role, at: Date.now() }));
    if (BWN.role === 'host' && BWN.back) BWN.back = false; // 回到自己的房間：客人還在，不用再亮 QR code
    else if (BWN.role === 'host' && !Object.keys(BWN.guests).length) bwQrShow(); else if (BWN.role === 'guest') BWN.needJoin = true; return; } // 客人一連上就自動加入（等第一份畫面確定房主那邊沒有自己的格子再按）
  if (BWN.role === 'host') {
    if (m.t === 'gj') { if (!BWN.guests[m.g]) { BWN.guests[m.g] = { held: 0, pend: 0, cur: 0 }; synth('pop'); } document.getElementById('bwQr').classList.add('hide'); return; }
    if (m.t === 'gl') { // 客人走了：選角時把他那格拿掉；打到一半就留著（他回來可以接著打）
      if (BW.st === 'join') { delete BWN.guests[m.g]; const i = BW.slots.findIndex(s => s.src === 'n' + m.g); if (i >= 0) BW.slots.splice(i, 1); }
      else if (BWN.guests[m.g]) BWN.guests[m.g].held = 0;
      return;
    }
    const g = m.g && BWN.guests[m.g];
    if (g && m.m && m.m.t === 'in') { g.held = (m.m.h | 0) & 15; g.pend |= m.m.p | 0; }
    if (g && m.m && m.m.t === 'ld' && BW.st === 'join') bwPickApply('n' + m.g, m.m.l); // 客人自選三招：只在選角時收
    return;
  }
  if (m.t === 'kicked') { bwNetFail('你被房主請出房間了'); return; }
  if (m.t === 'hl') { BWN.hostGone = BWN.hostGone || Date.now(); return; } // 房主可能只是切去別的網頁／App：一直等他，不把客人踢掉（想走自己按 🏠）
  if (m.t === 'hb') { BWN.hostGone = 0; BWN.needJoin = true; for (const e of BWN.ents.values()) stopChant(e); BWN.ents = new Map(); BWN.slots = {}; return; } // 房主回來了：他重開的話代號會重排，舊的角色全丟掉照新畫面擺
  if (m.t === 's') { BWN.hostGone = 0; BWN.lastSnap = Date.now(); bwApply(m); }
}
function bwHostTick(dt) {
  for (const g of Object.values(BWN.guests)) { g.cur = g.held | g.pend; g.pend = 0; }
  BWN.sendT -= dt;
  if (BWN.sendT <= 0 && BWN.ok) { BWN.sendT = .05; if (Object.keys(BWN.guests).length) bwNetSend(bwSnap()); else BWN.snd = []; }
}
const R1 = v => Math.round(v * 10) / 10, R2 = v => Math.round(v * 100) / 100;
function bwSnap() { // 客人要畫的東西：角色、投射物、落雷、特效、字幕、選角格子
  return { t: 's', st: BW.st, cam: R1(BW.cam), wv: BW.wave, iw: BW.inWave ? 1 : 0, go: R2(BW.goT || 0), sh: R1(BW.shake), ban: BW.ban, caps: BW.caps, boss: BW.boss ? BW.boss.nid : 0,
    sl: BW.slots.map(s => [s.src, s.char, s.load, s.row | 0, s.ready ? 1 : 0, s.lives | 0, s.dealt | 0, s.kills | 0, s.downs | 0, s.ft ? s.ft.nid : 0]),
    e: BW.ents.map(e => { const a = e.act; return [e.nid, e.team, e.char || '', e.kind || '', R1(e.x), R1(e.z), R1(e.y), e.face, Math.ceil(e.hp), e.maxHp,
      a ? [a.type, a.id || '', R2(a.t), a.travel || 0] : 0, R2(e.stun), R2(e.downT), R2(e.downAge), e.ko ? 1 : 0, R2(e.koT), R2(e.inv), R2(e.flash), R2(e.armor), e.slot == null ? -1 : e.slot,
      R1(e.walkPh || 0), e.win ? 1 : 0, R2(e.confT || 0), R2(e.bwGuardT || 0), e.boss ? 1 : 0, e.kcd ? e.kcd.map(R1) : 0, e.kmax || 0, R1(e.cdS || 0)]; }),
    s: BW.shots.map(b => [b.kind, R1(b.x), R1(b.z), R1(b.y), b.vx, R2(b.t || 0), R2(b.life), R1(b.spin || 0), b.r || 0]),
    b: BW.bolts.map(b => [R1(b.x), R1(b.z), R2(b.t), b.warn, b.hit ? 1 : 0]),
    f: BW.fx.map(f => Object.assign({}, f, { t: R2(f.t), x: R1(f.x), z: R1(f.z), y: R1(f.y || 0) })),
    g: BW.ghosts.map(g => [g.ft.nid, R1(g.x), R1(g.z), R1(g.y), g.f, R2(g.t), g.life]),
    snd: BWN.snd.splice(0) };
}
function bwApply(m) { // 客人：照房主的畫面狀態擺好（位置之後慢慢靠過去）
  Object.assign(BW, { st: m.st, cam: m.cam, wave: m.wv, inWave: !!m.iw, goT: m.go, ban: m.ban, caps: m.caps || [] });
  BW.shake = Math.max(BW.shake, m.sh);
  const seen = [];
  for (const r of m.e) {
    const [id, team, char, kind, x, z, y, face, hp, maxHp, act, stun, downT, downAge, ko, koT, inv, flash, armor, slot, walkPh, win, confT, guardT, boss, kcd, kmax, cdS] = r;
    let e = BWN.ents.get(id);
    if (!e) { e = bwMk(char || null, kind && BW_FOES[kind] ? BW_FOES[kind].look : null, x, z, team); Object.assign(e, { nid: id, kind, y }); BWN.ents.set(id, e); }
    Object.assign(e, { tx: x, tz: z, ty: y, face, hp, maxHp, stun, downT, downAge, ko: !!ko, koT, inv, flash, armor, slot, walkPh, win: !!win, confT, bwGuardT: guardT, boss: !!boss, kcd, kmax, cdS });
    if (act) { const [type, aid, t, travel] = act; if (!e.act || e.act.type !== type || e.act.id !== aid || Math.abs(e.act.t - t) > .12) e.act = { type, id: aid, t, travel, dir: 'fwd', keys: type === 'bwa' && BW_ATK[aid] ? BW_ATK[aid].keys : null }; }
    else e.act = null;
    seen.push(e);
  }
  const keep = new Set(seen.map(e => e.nid));
  for (const [id, e] of BWN.ents) if (!keep.has(id)) { stopChant(e); BWN.ents.delete(id); }
  BW.ents = seen; BW.boss = m.boss ? BWN.ents.get(m.boss) || null : null;
  BW.slots = m.sl.map(([src, char, load, row, ready, lives, dealt, kills, downs, fid]) => {
    const s = BWN.slots[src] || (BWN.slots[src] = { src });
    Object.assign(s, { char, load, row, ready: !!ready, lives, dealt, kills, downs, ft: BWN.ents.get(fid) || null });
    if (s.ft) s.ft.load = load;
    return s;
  });
  if (BWN.needJoin && ['join', 'play'].includes(BW.st)) { BWN.needJoin = false; if (!BW.slots.some(s => s.src === 'n' + BWN.key)) BWN.pend |= 1 << BW_BITS.indexOf('A'); }
  BW.shots = m.s.map(([kind, x, z, y, vx, t, life, spin, r]) => ({ kind, x, z, y, vx, t, life, spin, r }));
  BW.bolts = m.b.map(([x, z, t, warn, hit]) => ({ x, z, t, warn, hit: !!hit }));
  BW.fx = m.f;
  BW.ghosts = m.g.map(([id, x, z, y, f, t, life]) => ({ ft: BWN.ents.get(id), x, z, y, f, t, life, pose: SV().hold })).filter(g => g.ft);
  for (const ev of m.snd || []) {
    if (ev[0] === 'c') playClip(ev[1], ev[2]);
    else if (ev[0] === 's') synth(ev[1]);
    else if (ev[0] === 'ch') { const e = BWN.ents.get(ev[1]); if (e) startChant(e, ev[2]); }
    else if (ev[0] === 'cs') { const e = ev[1] ? BWN.ents.get(ev[1]) : null; if (e || !ev[1]) stopChant(e || undefined); }
  }
}
function bwGuestTick(dt) { // 客人：送自己的按鍵；畫面上的東西在兩次狀態之間自己往前動
  bwPollPads(); BW.t += dt;
  const a = bwRead('k1'), b = bwPads[0] || BW_NONE, i = {};
  for (const k of BW_BITS) i[k] = a[k] || b[k];
  if (pressed.has('Escape')) { goHome(true); return; }
  const h = bwBits(i) & 15; BWN.pend |= bwBits(i) & ~15;
  BWN.sendT -= dt;
  if (BWN.ok && (BWN.pend || h !== BWN.held || BWN.sendT <= 0)) { BWN.sendT = .3; BWN.held = h; bwNetSend({ t: 'in', h, p: BWN.pend }); BWN.pend = 0; }
  const k = Math.min(1, dt * 14);
  for (const e of BW.ents) {
    if (e.tx == null) continue;
    e.x = Math.abs(e.tx - e.x) > 260 ? e.tx : e.x + (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.y += (e.ty - e.y) * k;
    if (e.act) e.act.t += dt; e.koT += dt; e.flash = Math.max(0, e.flash - dt); e.inv = Math.max(0, e.inv - dt);
  }
  for (const s of BW.shots) { s.x += s.vx * dt; s.t += dt; s.spin += dt * 14 * Math.sign(s.vx); }
  for (const x of [...BW.bolts, ...BW.fx, ...BW.ghosts, ...BW.caps]) x.t += dt;
  if (BW.ban) BW.ban.t += dt;
}
function bwNetUi() { // 右上角「線上邀請」鈕：只在選角畫面、自己不是客人的時候出現
  const show = BW.on && BW.st === 'join' && BWN.role !== 'guest';
  const b = document.getElementById('bwNetBtn'); if (b.classList.contains('hide') === show) b.classList.toggle('hide', !show);
  if (show) { const t = BWN.role === 'host' ? '📱 房號 ' + BWN.room + '（點開 QR code）' : '📱 開房（給別人掃碼／輸入房號）'; if (b.textContent !== t) b.textContent = t; }
  const j = document.getElementById('bwJoinBtn'), showJ = show && !BWN.role; // 自己開了房就不用再去加入別人
  if (j.classList.contains('hide') === showJ) j.classList.toggle('hide', !showJ);
  if (!BW.on) document.getElementById('bwJoinBox').classList.add('hide');
  const showP = BW.on && BW.st === 'join' && bwMine().some(s => !s.ready), pb = document.getElementById('bwPickBtn'); // 選角時、自己還沒準備才能換招
  if (pb.classList.contains('hide') === showP) pb.classList.toggle('hide', !showP);
  if (!showP) document.getElementById('bwPick').classList.add('hide');
  const showK = BW.on && BWN.role === 'host' && BW.slots.some(s => s.src[0] === 'n'), kb = document.getElementById('bwKickBtn'); // 有線上玩家才有踢人鈕
  if (kb.classList.contains('hide') === showK) kb.classList.toggle('hide', !showK);
  if (!BW.on || BWN.role !== 'host') document.getElementById('bwKickBox').classList.add('hide');
  const sv = show && !BWN.role ? bwNetSaved() : null, k = document.getElementById('bwBackBtn');
  if (k.classList.contains('hide') === !!sv) k.classList.toggle('hide', !sv);
  if (sv) { const t = '↩ 回到剛剛的房間 ' + sv.room; if (k.textContent !== t) k.textContent = t; }
  let w = ''; // 斷線時畫面上方提示
  if (BW.on && BWN.role && !BWN.ok) w = '📶 重新連線中…';
  else if (BW.on && BWN.role === 'guest' && (BWN.hostGone || Date.now() - (BWN.lastSnap || 0) > 2500)) { // 房主斷線，或切到別的網頁讓遊戲停住：畫面停著等他
    const t = Math.floor((Date.now() - (BWN.hostGone || BWN.lastSnap || Date.now())) / 1000);
    w = '⏳ 房主暫時離開，等他回來…' + (t >= 5 ? '（' + (t < 60 ? t + ' 秒' : Math.floor(t / 60) + ' 分') + '）' : '') + '　想走可以按 🏠';
  }
  const wd = document.getElementById('bwWait'); if (wd.textContent !== w) wd.textContent = w; if (wd.classList.contains('hide') === !!w) wd.classList.toggle('hide', !w);
}
function bwPadsSync() { // 手機按鈕：合作模式換成 打／跳／三招／閃，招名照自己選的招
  let sig = 'off', load = null;
  if (BW.on) { const s = BW.slots.find(q => q.src === (BWN.role === 'guest' ? 'n' + BWN.key : 'k1')); load = s && s.load; sig = 'on' + (load ? load.join() : ''); }
  if (sig === BWN.padSig) return; BWN.padSig = sig; window.bwPadMode = BW.on;
  const arc = document.getElementById('arc'), fist = arc.querySelector('.fist'), sk = [...arc.querySelectorAll('.sk')], all = [fist, ...sk];
  all.forEach(b => { if (b.dataset.o == null) { b.dataset.o = b.dataset.code; b.dataset.ot = b.textContent; } });
  if (!BW.on) { all.forEach(b => { b.dataset.code = b.dataset.o; b.textContent = b.dataset.ot; b.classList.remove('bw2'); b.style.background = ''; delete b.dataset.bn; }); arc.querySelectorAll('.bwx').forEach(b => b.classList.add('hide')); stickLayout(); return; }
  const nm = n => load ? bwMvName(load[n]).slice(0, 2) : '招' + (n + 1);
  fist.dataset.code = 'KeyH'; fist.textContent = '打';
  [['Space', '跳'], ['KeyJ', nm(0)], ['KeyK', nm(1)], ['KeyL', nm(2)]].forEach(([c, t], n) => { const b = sk[n]; if (!b) return; b.dataset.code = c; b.dataset.bn = t; b.textContent = t; b.classList.toggle('bw2', t.length > 1); });
  arc.querySelectorAll('.bwx').forEach(b => b.classList.toggle('hide', b.dataset.bn == null)); // 只剩跳＋三招：多出來的「閃」鈕收起來
  stickLayout();
}
function bwPadCD() { // 手機按鈕的招式冷卻：冷卻中顯示剩幾秒＋橘色轉圈（跟對戰模式一樣）
  if (!isTouch || !BW.on) return;
  const s = BW.slots.find(q => q.src === (BWN.role === 'guest' ? 'n' + BWN.key : 'k1')), p = s && s.ft;
  document.querySelectorAll('#arc .sk').forEach(b => {
    if (b.dataset.bn == null) return;
    const n = { KeyJ: 0, KeyK: 1, KeyL: 2 }[b.dataset.code];
    const cd = !p || BW.st !== 'play' ? 0 : n != null ? (p.kcd ? p.kcd[n] : 0) : b.dataset.code === 'KeyU' ? p.cdS || 0 : 0;
    const mx = n != null ? (p && p.kmax ? p.kmax[n] : 1) : 1;
    const txt = cd > 0 ? cd.toFixed(1) : b.dataset.bn;
    if (b.textContent !== txt) b.textContent = txt;
    const bg = cd > 0 ? `conic-gradient(rgba(255,154,40,.75) ${Math.max(0, 1 - cd / (mx || 1)) * 100}%, rgba(20,30,45,.8) 0)` : '';
    if (b.style.background !== bg) b.style.background = bg;
  });
}
if (params.get('brawl') === '1') setTimeout(bwOpen, 300);
if (params.get('co')) { const r = params.get('co').replace(/\D/g, '').slice(0, 6); const sv = bwNetSaved(); if (r.length >= 4) setTimeout(() => sv && sv.room === r && sv.role === 'guest' ? bwNetBack() : bwNetJoin(r), 300); }
else if (bwNetSaved() && !params.get('sandbox')) setTimeout(() => { const sv = bwNetSaved(); if (sv && mode === 'title') askYes('剛剛的四人合作房間 ' + sv.room + ' 可能還在，要回去嗎？', bwNetBack, '回到房間'); }, 800); // App 被關掉、重新整理後再打開

function frame(now) {
  let dt = Math.max(0, Math.min(.033, (now - last) / 1000)) * (SB ? SB.speed : 1); last = Math.max(last, now); // 時間戳偶爾會比上一幀早：不准倒退
  const paused = isPaused() && mode !== 'title';
  if (paused) dt = 0;
  if (BW.on) { bwTick(dt); pressed.clear(); homeTick(); bwDraw(now / 1000); requestAnimationFrame(frame); return; } // 2.5D 闖關：自己一套更新＋畫面
  if (SB) sandboxTick(dt);
  rbVis(false); if (RB.pending) rbBegin();
  if (paused) {} else if (net.role === 'spec') specTick(dt); else if (RB.on && net.peer) rbTick(dt); else if (net.role === 'guest' && net.peer) {} else if (RG.on && mode !== 'title' && mode !== 'lobby') rgUpdate(dt); else update(dt);
  pressed.clear();
  if (net.role === 'host' && net.peer) hostSend(dt);
  updatePadCD(); homeTick(); rbVis(true);
  const tsec = now / 1000;
  ctx.save();
  if (shake > 0) { ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake); shake *= .85; if (shake < .5) shake = 0; }
  const onTitle = mode === 'title' || mode === 'lobby' || mode === 'mvpick' || !p1;
  // 首頁＋手機橫放（比 16:9 寬）：畫布照 #wrap 兩邊的牆板一模一樣畫，接成一整片藍，中間不會多一層顏色不同的「濾鏡」
  if (onTitle && innerWidth / innerHeight >= 16 / 9 - .01) drawFlatStage(); else drawStage();
  if (onTitle) drawTitle(tsec); else drawBattle(tsec, dt);
  ctx.restore();
  if (!onTitle) perfUi();
  requestAnimationFrame(frame);
}

function drawBattle(tsec, dt) {
  const FTS = RG.on ? [...RG.enemies, p1] : [p1, p2];
  for (const ft of FTS) shadow(ft);
  // 殘影
  for (const g of ghosts) {
    if (g.t < 0) continue;
    ctx.save(); ctx.globalAlpha = .45 * (1 - g.t / g.life);
    drawFighter(g.ft, g.pose, { x: g.x, y: g.y, f: g.f, tone: GHOST_TONE });
    ctx.restore();
  }
  // 角色（受擊閃白）
  const order = RG.on ? FTS : (p1.act && p1.act.type !== 'shan') ? [p2, p1] : [p1, p2];
  for (const ft of order) {
    if (ft.ko && ft.koT === undefined) ft.koT = 0;
    const { pose, f, face } = poseOf(ft, tsec);
    if (ft.inv > 0) aura(ft);
    if (!ft.ko) stBack(ft, tsec); // 加速加力：腳下紅橘火光；回血：綠色光點
    if ((ft.ccImmT > 0 || ft.ccOnlyT > 0) && !ft.ko) { ctx.save(); ctx.globalAlpha = stBlink(ft, 'cc', Math.max(ft.ccImmT || 0, ft.ccOnlyT || 0), tsec); ctx.strokeStyle = 'rgba(255,211,77,.8)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(ft.x, GROUND - ft.y - 130, 70, 150, 0, 0, 7); ctx.stroke(); ctx.restore(); } // 免控：金色框
    const fade = RG.on && ft !== p1 && ft.koT > .6 ? Math.max(0, 1 - (ft.koT - .6) / .8) : undefined; // 闖關：倒下的敵人淡出
    const drawn = drawFighter(ft, pose, { f, face, tone: ft.flash > 0 ? FLASH_TONE : null, alpha: fade });
    const pm = ft.act && ft.act.type === 'mv' && !ft.ko && MOVES[ft.act.id] && MOVES[ft.act.id].prop; // 招式拿在手上的道具（蔡徐坤的籃球）
    if (pm) { const at = pm(ft, drawn, ft.act.t); if (at) drawBasketball(at[0], at[1], 16, ft.act.t * 9 * ft.face); }
    if (ft.armorT > 0 && !ft.ko) { // 霸體：身體外面一層會閃的金色膜
      const cy = GROUND - ft.y - 132, k = (.6 + .25 * Math.sin(tsec * 14)) * stBlink(ft, 'armor', ft.armorT, tsec);
      ctx.save(); ctx.globalAlpha = k;
      ctx.fillStyle = 'rgba(255,214,90,.16)'; ctx.beginPath(); ctx.ellipse(ft.x, cy, 64, 148, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,214,90,.35)'; ctx.lineWidth = 12; ctx.stroke();
      ctx.strokeStyle = '#fff1b0'; ctx.lineWidth = 3; ctx.stroke();
      ctx.restore();
    }
    if (!ft.ko) stFront(ft, tsec); // 敗式這類反擊／格擋架勢：藍白描邊＋頭上一個字
    if (ft.stun > 0 && !ft.ko) { // 暈眩星星
      const hb = hurtbox(ft);
      for (let i = 0; i < 3; i++) { const a = tsec * 6 + i * 2.1; ctx.fillStyle = '#ffe14d'; ctx.font = '18px sans-serif'; ctx.fillText('★', ft.x + Math.cos(a) * 28 - 8, hb.y0 - 4 + Math.sin(a) * 8); }
    }
  }
  // 憑空生球
  for (const e of fx) if (e.type === 'conjure') {
    const ft = e.ft, k = e.t / .25;
    const hk = BV().hook, sk = skeleton(hk, ft.face), baseY = GROUND - ft.y - sk.footY - 8 + hk.dy;
    const bx = ft.x + sk.footB[0] - ft.face * 6, by = baseY + sk.footB[1] - 10;
    ctx.save(); ctx.globalAlpha = 1 - k * .3; ctx.strokeStyle = '#fff3a0'; ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + k * 3, r1 = 40 * (1 - k) + 16, r2 = r1 + 12; ctx.beginPath(); ctx.moveTo(bx + Math.cos(a) * r1, by + Math.sin(a) * r1); ctx.lineTo(bx + Math.cos(a) * r2, by + Math.sin(a) * r2); ctx.stroke(); }
    ctx.restore();
    drawBall(bx, by, k * 4, 15 * Math.min(1, k * 1.4), Math.min(1, k * 2));
  }
  for (const b of balls) {
    if (drawProj(b)) continue;
    ctx.save(); // 速度線
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 4; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const xx = b.x - Math.sign(b.vx) * i * 12, yy = b.y + Math.sin(b.t * 20 - i * .8) * 6; i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
    ctx.stroke(); ctx.restore();
    drawBall(b.x, b.y, b.spin, b.r || 15);
  }
  drawFX();
  if (RG.on) drawRgHUD(); else drawHUD();
  for (const c of captions) drawCaption(c);
  const pwOver = mode === 'over' && !ladder.on && p1 && (p1.perf ? p1 : p2.perf ? p2 : null); // 滿貫結算：版面另外排（見下面）
  if (banner && !pwOver) { // 滿貫結算不畫回合結束的「PERFECT／1P 勝！」橫幅，免得跟結算的字疊在一起
    banner.t += dt;
    const k = Math.min(1, banner.t / .25);
    ctx.save(); ctx.translate(W / 2, 300); ctx.scale(1.6 - .6 * k, 1.6 - .6 * k); ctx.globalAlpha = k;
    ctx.textAlign = 'center'; ctx.font = 'bold 96px "Microsoft JhengHei",sans-serif';
    if (banner.text) outlineText(banner.text, 0, 0, '#ffe600', 10);
    ctx.font = 'bold 54px "Microsoft JhengHei",sans-serif'; outlineText(banner.sub, 0, 80, '#fff', 8);
    ctx.restore();
  }
  if (mode === 'over') {
    const winTxt = ladder.on ? '挑戰結束' : net.role === 'spec' ? specName(wins[0] > wins[1] ? 0 : 1) + ' 獲勝！' : wins[0] > wins[1] ? '1P 獲勝！' : (vsCPU ? '電腦獲勝！' : '2P 獲勝！');
    ctx.textAlign = 'center';
    if (pwOver) {
      // 滿貫：先只有 PERFECT／完封！從大縮小砸下來（畫面上方，底下留給贏的人嘲諷），0.9 秒後其他字才淡入，一行一行不重疊
      const pw = pwOver, perfect = pw.perf === 2, k = Math.min(1, stateT / .35), s = 1 + 1.6 * (1 - k) * (1 - k);
      const top = ctx.createLinearGradient(0, 0, 0, 430); top.addColorStop(0, 'rgba(0,0,0,.6)'); top.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = top; ctx.fillRect(0, 0, W, 430);
      ctx.save(); ctx.translate(W / 2, 200); ctx.scale(s, s); ctx.globalAlpha = k;
      ctx.font = '900 ' + (perfect ? 130 : 100) + 'px "Microsoft JhengHei",sans-serif';
      const g = ctx.createLinearGradient(0, -105, 0, 16); g.addColorStop(0, '#fffbd6'); g.addColorStop(.45, '#ffd34d'); g.addColorStop(1, '#e8601c');
      outlineText(perfect ? 'PERFECT' : '完封！', 0, 0, g, 12);
      ctx.restore();
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, (stateT - .9) / .4));
      ctx.font = 'bold 46px "Microsoft JhengHei",sans-serif'; outlineText(winTxt + '　' + wins[0] + ' : ' + wins[1], W / 2, 268, '#ffe600', 8);
      ctx.font = 'bold 24px "Microsoft JhengHei",sans-serif';
      outlineText(perfect ? (pw.cleanW > 1 ? pw.cleanW + ' 回合全部滿血拿下' : '滿血獲勝，一滴血都沒掉') : '對手一回合都沒拿到', W / 2, 308, '#ffe9a8', 5);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, H);
      ctx.font = 'bold 80px "Microsoft JhengHei",sans-serif';
      outlineText(winTxt, W / 2, 300, '#ffe600', 10);
      ctx.font = 'bold 30px "Microsoft JhengHei",sans-serif';
      outlineText(ladder.on ? '連勝 ' + ladder.streak + ' 場' : wins[0] + ' : ' + wins[1], W / 2, 360, '#fff', 6);
    }
    ctx.font = 'bold 30px "Microsoft JhengHei",sans-serif';
    if (stateT > 1.5 && !ladder.on) outlineText(RK.on ? '按 Enter 或點畫面：看排位分數' : net.role === 'host' ? '按 Enter 或點畫面：再來一場' : net.role === 'guest' ? '等待房主開下一場…' : net.role === 'spec' ? '等他們開下一場…（按 🏠 離開觀戰）' : MC.on ? '按 Enter 或點畫面：回關卡圖' : '按 Enter 回標題', W / 2, pwOver ? 352 : 440, '#fff', 6);
  }
}
/* ---- 滿貫分享：結算畫面出來後拍一張截圖，跳出「分享」鈕（手機叫出分享選單、電腦存圖＋複製文字） ---- */
const perfShot = { blob: null, taken: false };
function perfWho() { return mode === 'over' && (!RB.on || RB.overDone) && p1 && !ladder.on && !RG.on ? (p1.perf ? p1 : p2.perf ? p2 : null) : null; } // 線上：結束那一格兩邊都確定了才算（猜的可能被倒帶）
function perfUi() {
  const pw = perfWho(), btn = $('perfShare');
  if (!pw) { if (perfShot.taken) { perfShot.taken = false; perfShot.blob = null; } if (!btn.classList.contains('hide')) { btn.classList.add('hide'); perfPanel(false); } return; }
  if (!perfShot.taken && stateT > 1.1) { perfShot.taken = true; try { cv.toBlob(b => { perfShot.blob = b; }, 'image/png'); } catch (e) {} }
  if (stateT > 1.4 && btn.classList.contains('hide')) { btn.textContent = '📣 分享這場' + (pw.perf === 2 ? ' PERFECT' : '完封'); btn.classList.remove('hide'); }
}
function perfText() {
  const pw = perfWho() || p1, side = pw === p1 ? 0 : 1, what = pw.perf === 2 ? 'PERFECT 完封' : '2:0 完封';
  const me = net.role === 'guest' ? 1 : net.role === 'spec' ? -1 : 0;
  const foe = RK.on && RK.bot ? RK.bot.name : MC.on ? '馬師傅' : net.role ? '對手' : vsCPU ? '' : '2P';
  const where = RK.on ? '排位賽' : MC.on ? '挑戰馬師傅' : net.role ? '線上對戰' : vsCPU ? '對戰電腦' : '雙人對戰';
  if (me === -1) return '我在《閃身步大亂鬥》觀戰區看到 ' + specName(side) + ' ' + what + ' ' + specName(1 - side) + '！';
  if (side !== me && (net.role || vsCPU)) return '我在《閃身步大亂鬥》' + where + '被 ' + what + ' 了…誰來幫我報仇！';
  return '我在《閃身步大亂鬥》' + where + (foe ? '，把 ' + foe + ' ' : ' ') + what + '！不服來戰 💪';
}
// 分享＝轉發連結：/s?p=2 是預覽頁（LINE／FB 抓得到「PERFECT 完封」標題），點進去直接到遊戲；炫耀文字放訊息裡，網址保持短
function perfLink() { return location.origin + '/s?p=' + ((perfWho() || p1).perf === 2 ? 2 : 1); }
async function perfCopy(s) {
  try { await navigator.clipboard.writeText(s); return true; } catch (e) {}
  try { const ta = document.createElement('textarea'); ta.value = s; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e) { return false; }
}
function perfGo(u) { if (inApp) location.href = u; else window.open(u, '_blank', 'noopener'); } // App 裡換頁會交給系統開瀏覽器／LINE
async function perfPick(k) {
  const txt = perfText(), link = perfLink(), all = txt + '\n' + link, E = encodeURIComponent, tip = $('ppTip');
  const say = s => { tip.textContent = s; };
  if (k === 'line') return perfGo('https://line.me/R/share?text=' + E(all));
  if (k === 'fb') return perfGo('https://www.facebook.com/sharer/sharer.php?u=' + E(link));
  if (k === 'x') return perfGo('https://x.com/intent/post?text=' + E(txt) + '&url=' + E(link));
  if (k === 'th') return perfGo('https://www.threads.net/intent/post?text=' + E(all));
  if (k === 'copy') return say(await perfCopy(all) ? '連結已複製！貼到任何地方都行' : link);
  const file = perfShot.blob && new File([perfShot.blob], 'shanshenbu-perfect.png', { type: 'image/png' });
  try {
    if (k === 'ig' && file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: all }); return; }
    if (k === 'more' && navigator.share) { await navigator.share({ title: '閃身步大亂鬥', text: txt, url: link }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  // IG 沒有「分享連結」的網址：存截圖＋複製文字連結，到 IG 發限動再貼上
  if (k === 'ig' && file && !inApp) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  const ok = await perfCopy(all);
  if (k === 'ig') { say((file && !inApp ? '截圖已存、' : '先截圖，') + (ok ? '連結已複製' : '') + '→ 到 IG 限動貼上'); setTimeout(() => perfGo('https://www.instagram.com/'), 900); }
  else say(ok ? '連結已複製！貼到任何地方都行' : link);
}
function perfPanel(on) { $('perfPanel').classList.toggle('hide', !on); if (on) $('ppTip').textContent = '選一個地方轉發這場 👇'; }
const dummyA = new Fighter('p1', 0, 1), dummyB = new Fighter('p2', 0, -1);
const TITLE_MV = [{ t: '閃身步', k: 'shan', x: W / 2 - 165, w: 130 }, { t: '浪子踢球', k: 'ball', x: W / 2, w: 150 }, { t: '狗熊哆嗦毛', k: 'bear', x: W / 2 + 175, w: 170 }];
let titleAct = null, titleWhich = 0;
function titlePlay(i) { titleAct = { which: i, t0: performance.now() / 1000 }; unlockAudio(); playClip(TITLE_MV[i].k); }
// 標題畫面被點：招式鈕→演那招；點人物→演下一招
function titleClick(x, y) {
  const i = TITLE_MV.findIndex(b => Math.abs(x - b.x) < b.w / 2 && Math.abs(y - 262) < 22);
  if (i >= 0) { titlePlay(i); return true; }
  if ((Math.abs(x - 250) < 110 || Math.abs(x - 1030) < 110) && y > 300 && y < GROUND + 10) { titlePlay((titleWhich + 1) % 3); return true; }
  return false;
}
// 標題選單：1 馬上玩（最大）、2 線上對戰、3 其他模式（闖關／挑戰馬師傅／本地雙人；打贏電腦一場才開）
const MENU = [
  { t: '馬上玩', go: () => quickPlay(), x: W / 2, y: 352, w: 380, h: 86, fs: 42, hero: ['#ff8a3d', '#c4410f', '#ffb070', '#e2541a'] },
  { t: '線上對戰', go: () => openLobby(), x: W / 2 - 142, y: 458, w: 264, h: 60, fs: 28, hero: ['#3f8fe0', '#1d4f8f', '#64aaf0', '#2a63a8'] },
  { t: '其他模式', go: () => omOpen(), x: W / 2 + 142, y: 458, w: 264, h: 60, fs: 28, hero: ['#1fbf7f', '#0b6b47', '#2fe39a', '#0f8a5c'], lock: () => !UNLOCKED },
];
let UNLOCKED = false; // 存檔的 unl：topRefresh 時更新，首頁每幀不用重讀存檔
// 按下去：縮一下＋音效＋震動（手機）
function menuFeel(m, locked) {
  m.pressT = performance.now();
  synth(locked ? 'thud' : 'pop');
  try { navigator.vibrate && navigator.vibrate(locked ? [30, 40, 30] : 18); } catch (e) {}
}
const LOCK_MSG = '打贏電腦一場（三戰兩勝）就解鎖';
function drawTitle(t) { // 不再蓋一層暗色：首頁跟兩邊延伸的牆板一樣亮
  // 兩位大師輪流示範三招；玩家點了「閃／踢／熊」或點人物，就馬上演那一招
  const cyc = (t % 6);
  let which = Math.floor(cyc / 2), lt = cyc % 2;
  if (titleAct && t - titleAct.t0 < 2) { which = titleAct.which; lt = t - titleAct.t0; }
  else if (titleAct) titleAct = null;
  titleWhich = which;
  let pa;
  if (which === 0) pa = sampleKeys(SV().keys, Math.min(.55, lt * .9));
  else if (which === 1) pa = sampleKeys(BV().keys, Math.min(.85, lt));
  else pa = bearPose(.25 + lt);
  ctx.fillStyle = 'rgba(0,20,50,.35)'; ctx.beginPath(); ctx.ellipse(250, GROUND + 2, 55, 10, 0, 0, 7); ctx.ellipse(1030, GROUND + 2, 55, 10, 0, 0, 7); ctx.fill();
  drawFighter(dummyA, pa, { x: 250, y: 0, f: 1, face: 'shout' });
  drawFighter(dummyB, pa, { x: 1030, y: 0, f: -1, face: 'shout' });
  ctx.textAlign = 'center';
  ctx.font = 'bold 96px "Microsoft JhengHei",sans-serif'; outlineText('閃身步', W / 2, 150, '#ffe600', 14);
  ctx.font = 'bold 40px "Microsoft JhengHei",sans-serif'; outlineText('花鼓燈大亂鬥', W / 2, 210, '#fff', 8);
  // 三顆可以點的招式鈕：正在演的那招亮起來
  TITLE_MV.forEach((b, i) => {
    const on = i === which, x0 = b.x - b.w / 2, y0 = 262 - 19;
    ctx.fillStyle = on ? 'rgba(232,96,28,.95)' : 'rgba(0,0,0,.45)'; ctx.fillRect(x0, y0, b.w, 38);
    ctx.strokeStyle = on ? '#ffe36b' : 'rgba(255,255,255,.35)'; ctx.lineWidth = on ? 3 : 1.5; ctx.strokeRect(x0, y0, b.w, 38);
    ctx.font = 'bold 22px "Microsoft JhengHei",sans-serif'; outlineText(b.t, b.x, 262 + 8, on ? '#ffe600' : '#fff', 5);
  });
  if (mode === 'lobby' || mode === 'mvpick') return;
  const nowMs = performance.now();
  MENU.forEach((m, i) => { // 原本的漸層＋金框按鈕；下面有一層厚底，按下去整顆往下壓
    const on = menuSel === i, locked = m.lock && m.lock();
    const pk = m.pressT ? Math.max(0, 1 - (nowMs - m.pressT) / 160) : 0, dy = pk * 6, sc = 1 - pk * .05;
    ctx.save(); ctx.translate(m.x, m.y + dy); ctx.scale(sc, sc);
    const x0 = -m.w / 2, y0 = -m.h / 2, depth = 7 - dy;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x0, y0 + depth, m.w, m.h); // 厚底
    const g = ctx.createLinearGradient(0, y0, 0, y0 + m.h); g.addColorStop(0, m.hero[on ? 2 : 0]); g.addColorStop(1, m.hero[on ? 3 : 1]);
    ctx.fillStyle = g; ctx.fillRect(x0, y0, m.w, m.h);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x0 + 4, y0 + 4, m.w - 8, m.h * .38); // 上半亮面
    ctx.strokeStyle = `rgba(255,227,107,${.65 + .35 * Math.sin(t * 4)})`; ctx.lineWidth = on ? 5 : 3; ctx.strokeRect(x0, y0, m.w, m.h);
    if (locked) { ctx.fillStyle = 'rgba(10,20,30,.55)'; ctx.fillRect(x0, y0, m.w, m.h); }
    ctx.font = `bold ${m.fs}px "Microsoft JhengHei",sans-serif`; outlineText((locked ? '🔒 ' : '') + m.t, 0, m.fs * .36, locked ? '#c9d6e3' : '#fff8c4', 6);
    ctx.restore();
  });
  if (MENU[2].lock()) { ctx.font = 'bold 17px "Microsoft JhengHei",sans-serif'; outlineText(LOCK_MSG, MENU[2].x, MENU[2].y + 54, '#ffe36b', 4); }
  ctx.font = 'bold 20px "Microsoft JhengHei",sans-serif';
  outlineText('現實中請勿模仿，小心十字韌帶', W / 2, 690, '#cfe6ff', 4);
}
/* ================= 線上對戰 =================
   兩邊各跑同一套模擬、只互傳按鍵（rollback，見 rbTick）；房主（1P）只負責開場、再來一場、送畫面給觀戰的人。
   伺服器（worker.js 的 Durable Object）負責牽線、直連打不通時轉送。 */
const net = { role: null, ws: null, room: '', peer: false, quiet: false, ev: [], leaving: false,
  off: null, pc: null, dc: null, pendC: [] };
function idOf(ft) { return ft === p2 ? 2 : 1; }
function ofId(i) { return i === 2 ? p2 : p1; }
const $ = id => document.getElementById(id);

const FKEYS = ['x', 'y', 'vx', 'vy', 'face', 'hp', 'act', 'stun', 'cd', 'mvcd', 'load', 'used', 'walkPh', 'inv', 'ko', 'koT', 'win', 'flash', 'char', // char：兩邊的造型
  'spdT', 'powT', 'ccOnlyT', 'ccImmT', 'armorT', 'guardT', 'guard', 'healT', 'maxHp', 'perf', 'cleanW']; // 狀態發光、滿貫結算（觀戰的人也看得到）
// 線上造型：對手（2P）把自己穿的造型傳給房主，房主放進畫面狀態一起傳回去，兩邊看到的一樣
const okSkin = id => !!id && id !== 'ma' && !!CHARS[id];
function netSkin() {
  const sk = profLoad().skin || 'teacher';
  if (net.role === 'host' && p1 && mode !== 'title') p1.char = sk;
  else if (net.role === 'guest') netSend(JSON.stringify({ t: 'sk', sk, v: NET_V, nm: myName() || '' })); // nm：觀戰清單顯示的暱稱
}
// 連線協定版本：畫面狀態的格式改過就加一；兩邊不同版（有人開著舊網頁沒重新整理）就請他重新整理
const NET_V = 4, NET_OLD = '遊戲版本跟對方不同：請兩邊都重新整理網頁再連一次';
const round2 = (k, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v;
// 角色狀態照 FKEYS 的順序排成陣列送（不重複送欄位名，畫面狀態小三成）；沒有的欄位用 '~'
const packFt = ft => FKEYS.map(k => ft[k] === undefined ? '~' : ft[k]);
const unpackFt = a => { const o = {}; FKEYS.forEach((k, i) => { if (a[i] !== '~') o[k] = a[i]; }); return o; };
function hostSend(dt) {
  if (!p1 || !p2 || mode === 'lobby') return; // lobby：排位選招中，上一場的畫面不用送
  if (net.ev.length) { if (net.specN) wsSend({ t: 'se', ev: net.ev }); net.ev = []; } // 觀戰的人聽房主這邊的聲音（對手自己算、自己放）
  if (performance.now() - (net.liveAt || 0) > 15000) { net.liveAt = performance.now(); wsSend(liveInfo()); } // 觀戰清單：開打就報，之後每 15 秒報一次「還在打」
  specSend(dt);
}
function snapBody() {
  return {
    m: mode, st: stateT, tm: timer, r: round, w: wins, sh: shake, bn: banner, p: [packFt(p1), packFt(p2)],
    b: balls.map(b => ({ o: idOf(b.owner), x: b.x, y: b.y, vx: b.vx, spin: b.spin, t: b.t, k: b.kind, vy: b.vy, g: b.g, r: b.r })),
    g: ghosts.map(g => ({ f: idOf(g.ft), x: g.x, y: g.y, u: g.pose === SHAN_UP ? 1 : 0, ff: g.f, t: g.t, life: g.life })),
    fx: fx.map(e => e.ft ? Object.assign({}, e, { ft: idOf(e.ft) }) : e),
    c: captions.map(c => ({ f: idOf(c.ft), text: c.text, t: c.t })),
  };
}
/* ---- 觀戰：房主有人在看（伺服器告訴他 spn）才多送一份畫面，每秒 20 包、走伺服器，跟對手的直連分開 ---- */
function specSend(dt) {
  if (!net.specN || !net.ws || net.ws.readyState !== 1) return;
  net.svT = (net.svT || 0) + dt; if (net.svT < .05 - .004) return; net.svT = 0;
  if (net.ws.bufferedAmount > 16384) return; // 上傳塞住：觀戰的畫面先讓，不能拖慢對戰
  net.ws.send(JSON.stringify(Object.assign({ t: 'sv', hc: Math.round(performance.now()) }, snapBody()), round2));
}
function liveInfo() {
  const rk = !!(RK.on && net.rk && RK.bot);
  return { t: 'live', room: net.room, a: myName() || '玩家', b: rk ? RK.bot.name : net.peerName || '玩家', ca: p1.char || '', cb: p2.char || '', rk, ext: !!net.ext, w: wins };
}
// 觀戰端：兩個角色都畫「稍微晚一點」的樣子，在兩包之間補動作（每秒只有 20 包，不補會一頓一頓）
const SPEC_D = 130;
function specApply(s) {
  if (!p1) { p1 = new Fighter('p1', 380, 1); p2 = new Fighter('p2', 900, -1); vsCPU = false; hideLobby(); layoutPads(); }
  const sample = performance.now() - s.hc;
  if (net.off == null) net.off = sample;
  net.off = Math.min(sample, net.off + .5); // 以最快到的那包當基準（房主時鐘 → 本機時鐘）
  s.p = s.p.map(unpackFt); net.specNote = '';
  const B = net.sb;
  B.push({ t: Math.max(s.hc + net.off, B.length ? B[B.length - 1].t + .1 : 0), s }); while (B.length > 40) B.shift();
}
function specTick(dt) {
  const B = net.sb; if (!p1 || !B.length) return;
  const rt = performance.now() - SPEC_D;
  while (B.length > 2 && B[1].t < rt) B.shift();
  const a = B[0], b = B[1], s = a.s;
  const el = Math.max(0, Math.min(.25, (rt - a.t) / 1000)), k = b && b.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t))) : 0;
  const fight = s.m === 'fight';
  mode = s.m; stateT = s.st + el; timer = s.tm - (fight ? el : 0); round = s.r; wins = s.w; shake = Math.max(shake, s.sh);
  banner = s.bn ? Object.assign({}, s.bn, { t: s.bn.t + el }) : null;
  [p1, p2].forEach((ft, i) => {
    const st = s.p[i], nb = b && b.s.p[i];
    Object.assign(ft, st); ft.act = st.act && Object.assign({}, st.act); ft.cd = Object.assign({}, st.cd); ft.sx = ft.sy = 0;
    if (nb && Math.abs(nb.x - st.x) < 150 && Math.abs(nb.y - st.y) < 150) { // 瞬移（閃身步）不補，直接到
      if (ft.act && nb.act && nb.act.type === ft.act.type && nb.act.t >= ft.act.t) ft.act.t += (nb.act.t - ft.act.t) * k;
      ft.x = st.x + (nb.x - st.x) * k; ft.y = Math.max(0, st.y + (nb.y - st.y) * k);
      if (nb.walkPh >= st.walkPh && nb.walkPh - st.walkPh < 3) ft.walkPh = st.walkPh + (nb.walkPh - st.walkPh) * k;
    } else if (!nb) advanceFighter(ft, el); // 後面那包還沒到：照速度往前推（最多 0.25 秒）
  });
  balls = s.b.map(x => ({ owner: ofId(x.o), kind: x.k, x: x.x + x.vx * el, y: x.y, vx: x.vx, vy: x.vy || 0, g: x.g || 0, r: x.r, spin: x.spin, t: x.t + el }));
  ghosts = s.g.map(g => ({ ft: ofId(g.f), x: g.x, y: g.y, pose: g.u ? SHAN_UP : SV().hold, f: g.ff, t: g.t + el, life: g.life })).filter(g => g.t < g.life);
  fx = s.fx.map(e => Object.assign({}, e, { t: e.t + el }, e.ft ? { ft: ofId(e.ft) } : {})).filter(e => e.t < fxLife(e));
  captions = s.c.map(c => ({ ft: ofId(c.f), text: c.text, t: c.t + el })).filter(c => c.t < 1.3);
}
function specName(side) { const i = net.specInfo; return (i && (side ? i.b : i.a)) || (side ? '2P' : '1P'); }
function playEv(ev) { // 房主那邊響的聲音，這邊照播
  for (const e of ev || []) {
    if (e[0] === 'c') playClip(e[1], e[2]);
    else if (e[0] === 's') synth(e[1]);
    else if (e[0] === 'ch') startChant(ofId(e[1]), e[2]);
    else if (e[0] === 'cs') stopChant(e[1] ? ofId(e[1]) : undefined);
  }
}
/* ---- 線上對戰（rollback）：兩邊各跑同一套模擬，只互傳按鍵 ----
   以前房主跑模擬、對手照畫面畫：房主出招零延遲、對手出招要等網路一趟，誰開房誰佔便宜；房主網路一卡，對手跟著整個卡。
   現在兩邊完全一樣：每 1/60 秒算一格（RB.F＝算到第幾格），自己的按鍵幾乎馬上算（只晚 RB.D 格，見 rbDW）；
   對手的按鍵還沒到就先猜「照剛剛按著的方向、沒按招」，到了發現猜錯，就倒回那一格用正確的按鍵重算到現在（rbResim）。
   爆 ping 只害到自己：對手某一格的按鍵晚了 W 格（約 0.1～0.25 秒，看平常延遲）還沒到、而且我這邊網路正常（到伺服器的 ping 沒變慢），
   我就把那幾格定案成「照前一格按著的方向、沒按招」，之後才到也不算，並告訴對手（rbCommit 的 fills）；對手收到就把他自己那幾格改掉重算。
   所以網路卡的人自己的動作會被吃掉、被拉回，網路好的人畫面最多只被倒帶 W 格。
   我這邊網路也在卡（到伺服器的 ping 變慢）就不丟對手的按鍵：晚到也照算（倒帶的是我自己這邊）。
   兩邊算的結果每半秒對一次（rbHash），對不上（例如不同瀏覽器的浮點數）就由房主把整個狀態傳過去重來（rbRestart）。 */
const RB_FR = 1000 / 60, RB_WMAX = 180, RB_MODES = new Set(['intro', 'fight', 'roundEnd', 'over']);
// 按鍵一格一個數字：左1 右2 上4（按著）；跳8 招一16 招二32 招三64（這一格剛按下）
const rbDec = c => ({ L: !!(c & 1), R: !!(c & 2), U: !!(c & 4), Up: !!(c & 8), S1: !!(c & 16), S2: !!(c & 32), S3: !!(c & 64), X: null });
function rbHeld() { // 兩組鍵盤＋觸控都算
  const h = k => any(MAP.p1[k], keys) || any(MAP.p2[k], keys);
  return (h('L') ? 1 : 0) | (h('R') ? 2 : 0) | (h('U') || keys.has('StickUp') ? 4 : 0);
}
function rbPress() {
  const p = k => any(MAP.p1[k], pressed) || any(MAP.p2[k], pressed);
  return (p('J') ? 8 : 0) | (p('S1') ? 16 : 0) | (p('S2') ? 32 : 0) | (p('S3') ? 64 : 0);
}
// 對戰用的亂數（mulberry32，跟 tools/assets/ai/sim.js 同一種）：種子由房主開場時決定，存在狀態裡，倒帶重算時一起倒回去
function rbRand() { const a = RB.rng = (RB.rng + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
// 存檔／讀檔：角色、飛行物、特效、計時器、亂數。角色物件本身不換（特效、球記著是誰的），只換裡面的欄位
const rbDeep = v => Array.isArray(v) ? v.map(rbDeep) : v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ? rbObj(v) : v;
function rbObj(o) { const r = {}; for (const k in o) r[k] = rbDeep(o[k]); return r; }
function rbFt(ft) { const r = {}; for (const k of Object.keys(ft)) if (k !== 'hpShow') r[k] = rbDeep(ft[k]); return r; } // hpShow：血條動畫，畫面在跑的
const rbArr = a => a.map(e => Object.assign({}, e));
function rbSave() {
  return { p: [rbFt(p1), rbFt(p2)], b: rbArr(balls), g: rbArr(ghosts), fx: rbArr(fx), c: rbArr(captions), hs: hitstop, m: mode, st: stateT, tm: timer, r: round, w: wins.slice(),
    bn: banner && Object.assign({}, banner), rng: RB.rng, of: RB.overF };
}
function rbLoad(s) {
  [p1, p2].forEach((ft, i) => { const d = s.p[i], hs = ft.hpShow; for (const k of Object.keys(ft)) if (!(k in d)) delete ft[k]; for (const k in d) ft[k] = rbDeep(d[k]); ft.hpShow = hs; });
  balls = rbArr(s.b); ghosts = rbArr(s.g); fx = rbArr(s.fx); captions = rbArr(s.c);
  hitstop = s.hs; mode = s.m; stateT = s.st; timer = s.tm; round = s.r; wins = s.w.slice(); RB.rng = s.rng; RB.overF = s.of;
  banner = !s.bn ? null : banner && banner.text === s.bn.text && banner.sub === s.bn.sub ? banner : Object.assign({}, s.bn); // 同一個橫幅不要重播放大動畫
}
// 傳給對手的整份狀態：角色、殘影姿勢這些參照換成記號
const rbSer = s => JSON.stringify(s, (k, v) => v === p1 ? '@1' : v === p2 ? '@2' : v === SHAN_UP ? '@U' : v === SV().hold ? '@H' : v);
const rbDes = str => JSON.parse(str, (k, v) => v === '@1' ? p1 : v === '@2' ? p2 : v === '@U' ? SHAN_UP : v === '@H' ? SV().hold : v);
function rbHash(s) {
  const str = JSON.stringify([s.p.map(f => [f.x, f.y, f.vx, f.vy, f.hp, f.stun, f.act && f.act.type, f.act && f.act.t, f.cd, f.mvcd, f.ko]), s.b.map(b => [b.x, b.y, b.vx]), s.tm, s.m, s.r, s.w, s.rng]);
  let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rbReset(me, id, T0, F) {
  Object.assign(RB, { on: true, me, id, T0, F, base: F, acc: 0, lastT: 0, heard: false, off: me === 0 ? 0 : RB.off || 0, S: new Map(), mine: [], foe: [], fin: [], used: [[], []], fcu: F - 1, mcu: F - 1, ak: F - 1, pak: F - 1,
    fills: [], mfill: [], dirty: Infinity, pend: 0, sfx: new Map(), myH: new Map(), ph: new Map(), hq: [], nextH: Math.ceil((F + 1) / 30) * 30,
    overF: null, overDone: false, overSeen: 0, vx: [0, 0], vy: [0, 0], visOn: false, va: null, W: RB.W || 8, P: RB.P || 15, D: RB.D || 2, ow: RB.ow || 60, lastMine: F - 1 });
  rbDW();
  RB.st = RB.st && RB.st.id === net.room ? RB.st : { id: net.room, rb: 0, deep: 0, filled: 0, eaten: 0, desync: 0, restart: 0, selfMove: 0, foeMove: 0, lost: 0, stall: 0, stalls: 0 }; // 量測用
}
// 某一格（玩家 p）用哪個按鍵
function rbIn(p, f) {
  if (p === RB.me) {
    for (const r of RB.mfill) if (f >= r[0] && f <= r[1]) return (RB.mine[r[0] - 1] || 0) & 7; // 對手說我這幾格太晚到：算沒按招，照前一格按著的方向
    return RB.mine[f] || 0;
  }
  if (f <= RB.fcu) return RB.fin[f];
  const v = RB.foe[f]; if (v != null) return v;
  for (let g = f - 1; g >= RB.base && g >= f - 400; g--) { const u = g <= RB.fcu ? RB.fin[g] : RB.foe[g]; if (u != null) return u & 7; } // 還沒到：猜他繼續按著剛剛的方向、沒按招
  return 0;
}
const rbDirty = f => { RB.dirty = Math.min(RB.dirty, f); };
function rbCheck(from) { // 新收到的按鍵跟當初算的時候用的不一樣：從那一格開始重算
  for (let f = Math.max(from, RB.base); f < RB.F; f++) if (rbIn(0, f) !== RB.used[0][f] || rbIn(1, f) !== RB.used[1][f]) { rbDirty(f); return; }
}
// 把對手到 upTo 格為止的按鍵定案：有到的照用，沒到的算「照前一格按著的方向、沒按招」，記下來告訴他
function rbCommit(upTo) {
  const foe = RB.me ^ 1; let lo = Infinity;
  for (let n = RB.fcu + 1; n <= upTo; n++) {
    let v = RB.foe[n];
    if (v == null) {
      v = (n > RB.base ? RB.fin[n - 1] : 0) & 7; RB.st.filled++;
      const L = RB.fills[RB.fills.length - 1]; if (L && L[1] === n - 1) L[1] = n; else RB.fills.push([n, n]);
    }
    RB.fin[n] = v; RB.fcu = n;
    if (n < RB.F && RB.used[foe][n] !== v) lo = Math.min(lo, n);
  }
  if (lo < Infinity) rbCheck(lo);
}
// 每一格算完把數字捨到小數 6 位：不同瀏覽器（Chrome／iPhone Safari）的 sin、pow 最後一位可能不一樣，捨掉之後兩邊還是同一個數，不會越差越多
const rbR = v => Math.round(v * 1e6) / 1e6;
function rbQ(o) {
  for (const k in o) {
    const v = o[k];
    if (typeof v === 'number') { if (v % 1) o[k] = rbR(v); }
    else if (Array.isArray(v)) { for (const e of v) if (e && typeof e === 'object') rbQ(e); }
    else if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) rbQ(v);
  }
}
function rbStep(f) {
  const a = rbIn(0, f), b = rbIn(1, f);
  RB.used[0][f] = a; RB.used[1][f] = b; RB.inp = [rbDec(a), rbDec(b)];
  RB.simF = f; RB.stepping = true; const mr = Math.random; Math.random = rbRand;
  try { update(1 / 60); } finally { Math.random = mr; RB.stepping = false; }
  rbQ(p1); rbQ(p2); for (const b of balls) rbQ(b); timer = rbR(timer); stateT = rbR(stateT); hitstop = rbR(hitstop);
  RB.S.set(f + 1, rbSave());
}
// 倒回 RB.dirty 那一格重算到現在；角色因此被移動的距離記在 vx/vy，畫面上 0.1 秒內慢慢收掉（不會一下跳過去）
function rbResim() {
  const f0 = RB.dirty; RB.dirty = Infinity;
  if (f0 >= RB.F) return;
  const s = RB.S.get(f0); if (!s) { RB.st.lost++; rbAskRestart(); return; } // 太久以前的（存檔已經丟了）：請房主整份重傳
  const old = [p1.x, p1.y, p2.x, p2.y];
  rbLoad(s); for (let f = f0; f < RB.F; f++) rbStep(f);
  RB.st.rb++; if (RB.F - f0 > RB.W + 2) RB.st.deep++;
  [p1, p2].forEach((ft, i) => {
    const dx = old[i * 2] - ft.x, dy = old[i * 2 + 1] - ft.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) RB.st[i === RB.me ? 'selfMove' : 'foeMove']++;
    if (Math.abs(dx) < 150 && Math.abs(dy) < 150) { RB.vx[i] += dx; RB.vy[i] += dy; } else RB.vx[i] = RB.vy[i] = 0; // 瞬移那種差很多的直接到
  });
}
function rbVis(on) { // 畫的時候才把修正量加上去，畫完拿掉：模擬本身的位置不動
  if (!RB.on || !p1 || on === RB.visOn) return;
  if (on) { RB.va = [p1, p2].map(ft => [ft, ft.x, ft.y]); [p1, p2].forEach((ft, i) => { ft.x += RB.vx[i]; ft.y = Math.max(0, ft.y + RB.vy[i]); }); }
  else for (const [ft, x, y] of RB.va) { ft.x = x; ft.y = y; } // 放回原本的數字（加了再減會有浮點誤差，兩邊就對不上了）
  RB.visOn = on;
}
// 我這邊的網路正常嗎：每 0.05 秒 ping 一次 Cloudflare，回來得快（不比這場最快的時候慢 70 ms 以上）＝送出去那一刻我的網路是好的（okAt）。
// 要丟對手某一格的按鍵，得先有「那一格之後送出、而且很快回來」的 ping：證明不是我自己在卡。我在卡的時候 ping 回不來，就一格都不丟
// 每 33 ms 送一個、不等上一個回來（WebSocket 照順序回，所以排隊對得上）：證明多新就看多密，網路好的那邊要等的格數少一點
const RB_HP = { ok: false, q: [], last: 0, rtts: [], okAt: 0, okL: [] };
const rbHealthy = () => !RB_HP.ok || performance.now() - RB_HP.okAt < 200;
// 對手第 g 格的按鍵，他在 g－D 格的時間點送出。要算他沒按，得有一個「我網路正常」的證明 ok，滿足：
//   他送出的時候 ≤ ok（就算我之前在卡、他的包卡在路上，我恢復之後也該到了），而且 ok 之後已經過了一趟路程＋60 ms
// （ok 照真實時間比：我剛卡完、畫面還在追的時候，自己算到的格數是落後的，不能拿來證明）
function rbCommitTo(f) {
  const now = performance.now(), cf = Math.floor((now + RB.off - RB.T0) / RB_FR);
  if (!RB.heard) return Math.min(f, cf - RB_WMAX); // 開場／重來後還沒收到對手第一包：他的按鍵還在路上，不能算他沒按
  const H = RB_HP, lim = f - RB.W;
  if (!H.ok) return lim; // 伺服器還不會回 ping（舊版）：只看 W
  const need = now - RB.ow - 60; let ok = -1e9;
  for (let i = H.okL.length - 1; i >= 0; i--) if (H.okL[i] <= need) { ok = H.okL[i]; break; }
  return Math.min(f, Math.max(cf - RB_WMAX, Math.min(lim, Math.floor((ok + RB.off - RB.T0) / RB_FR) + RB.D)));
}
let rbHpWs = null;
setInterval(() => {
  const H = RB_HP, ws = net.ws;
  if (ws !== rbHpWs) { rbHpWs = ws; H.q.length = 0; } // 換了一條連線：舊的回不來了
  if (!RB.on || !ws || ws.readyState !== 1 || H.q.length >= 30) return;
  H.q.push(performance.now()); ws.send('{"t":"hp"}');
}, 33);
function rbHpBack() {
  const H = RB_HP, at = H.q.shift(); if (at == null) return;
  H.last = performance.now() - at; H.ok = true; H.rtts.push(H.last); if (H.rtts.length > 600) H.rtts.shift();
  if (H.last < Math.min(...H.rtts) + 70) { H.okAt = Math.max(H.okAt, at); H.okL.push(at); if (H.okL.length > 200) H.okL.shift(); }
}
// D：自己的按鍵晚幾格才算（1～3 格，約平常單程延遲）：對手的按鍵大多在用到之前就到了，不用猜、不用倒帶。
// 房主開場決定一次、傳給對手，整場不變（格鬥遊戲的做法：中途變來變去手感會忽快忽慢）
const rbMed = a => { const r = (a || []).slice().sort((x, y) => x - y); return r.length ? r[r.length >> 1] : null; };
function rbPickD() { const med = (net.rtts || []).length >= 4 ? rbMed(net.rtts) : null; return med == null ? 2 : Math.max(1, Math.min(3, Math.round(med / 2 / RB_FR))); }
// W：對手的按鍵最多等幾格（平常的單程延遲＋60 ms，扣掉 D，4～15 格）。用中位數不用 90%：爆 ping 那邊的突波不能讓網路好的這邊跟著多等
// P：最多往前猜幾格。對手的按鍵缺超過 P 格就停下來等（不再一直猜、之後倒帶一大段瞬移）。
//    網路好的那邊靠 W 定案，缺的格數不會超過 W＋「證明自己網路正常」要的時間，P 留足這兩個，所以只有網路卡的那邊會停
function rbDW() {
  const med = rbMed(net.rtts) ?? 120, hp = rbMed(RB_HP.rtts) ?? 100;
  RB.ow = med / 2;
  RB.W = Math.max(4, Math.min(15, Math.ceil((med / 2 + 60) / RB_FR) - RB.D));
  RB.P = Math.max(8, RB.W + 2, Math.min(40, Math.ceil((Math.max(RB.ow + 60, hp) + 33 + 40) / RB_FR) - RB.D + 1)); // 定案的落後（路程＋60 ms 或 ping 來回，取大的）＋送 ping 的間隔＋抖動
}
function rbSendIn() {
  const top = RB.lastMine, s = Math.max(RB.pak + 1, top - RB_WMAX, RB.base), k = [];
  for (let f = s; f <= top; f++) k.push(RB.mine[f] || 0);
  netSend(JSON.stringify({ t: 'ri', id: RB.id, s, k, ak: RB.ak, cu: RB.fcu, fl: RB.fills.filter(r => r[1] > RB.fcu - 600), h: RB.hq.slice(-3) }), true, true);
}
function rbRecv(m) {
  if (!RB.on || m.id !== RB.id) return;
  RB.heard = true; let lo = Infinity;
  m.k.forEach((v, i) => { const f = m.s + i; if (f > RB.fcu && RB.foe[f] == null) { RB.foe[f] = v; lo = Math.min(lo, f); } });
  while (RB.ak + 1 <= RB.fcu || RB.foe[RB.ak + 1] != null) RB.ak++;
  RB.pak = Math.max(RB.pak, m.ak); RB.mcu = Math.max(RB.mcu, m.cu);
  for (const r of m.fl || []) { // 對手定案「我這幾格算沒按」
    const q = RB.mfill.find(x => x[0] === r[0]);
    if (!q) { RB.mfill.push(r.slice()); RB.st.eaten += r[1] - r[0] + 1; lo = Math.min(lo, r[0]); }
    else if (r[1] > q[1]) { RB.st.eaten += r[1] - q[1]; lo = Math.min(lo, q[1] + 1); q[1] = r[1]; }
  }
  for (const [f, h] of m.h || []) { RB.ph.set(f, h); rbCmp(f); }
  if (lo < Infinity) rbCheck(lo);
}
function rbCmp(f) {
  const a = RB.myH.get(f), b = RB.ph.get(f); if (a == null || b == null) return;
  RB.ph.delete(f); if (a === b) return;
  RB.st.desync++; rbAskRestart();
}
function rbAskRestart() { if (RB.me === 0) rbRestart(); else if (performance.now() - (RB.askAt || 0) > 1000) { RB.askAt = performance.now(); netSend(JSON.stringify({ t: 'rbrq', id: RB.id })); } }
// 房主：開場（startMatch 之後下一幀）把整個狀態傳給對手，兩邊從第 0 格一起算
function rbBegin() {
  RB.pending = false; if (!(net.role === 'host' && net.peer && p1 && p2)) return;
  RB.rng = (Math.random() * 4294967296) >>> 0; RB.D = rbPickD();
  rbReset(0, (Math.random() * 1e9) | 0, performance.now(), 0); RB.had = true;
  RB.S.set(0, rbSave()); rbSendGo();
}
const rbSendGo = () => netSend(JSON.stringify({ t: 'rbgo', id: RB.id, T0: RB.T0, hn: performance.now(), F: RB.F, D: RB.D, s: rbSer(RB.S.get(RB.F)) }));
// 房主：兩邊算的對不上、對手斷線接回來 → 用房主現在的狀態從這一格重來（fn：重來前要改的，例如對手換了造型）
function rbRestart(fn) {
  if (!RB.on || RB.me !== 0 || performance.now() - (RB.rsAt || 0) < 500) return;
  RB.rsAt = performance.now(); rbVis(false); rbResim(); if (fn) fn();
  const st = RB.st; rbReset(0, (Math.random() * 1e9) | 0, RB.T0, RB.F); RB.st = st; st.restart++;
  RB.S.set(RB.F, rbSave()); rbSendGo();
}
function rbGo(m) { // 對手：收到開場／重來
  rbVis(false);
  const again = m.F === 0 && RB.had && !RK.on; RB.had = true; // 再來一場：統計多算一場（排位一場就結束）
  if (!p1 || m.F === 0) { p1 = new Fighter('p1', 380, 1); p2 = new Fighter('p2', 900, -1); }
  vsCPU = false; const st = RB.st; if (m.D) RB.D = m.D; // 輸入延遲照房主決定的，兩邊一樣
  rbReset(1, m.id, m.T0, m.F); if (m.F > 0 && st) { RB.st = st; st.restart++; }
  rbLoad(rbDes(m.s)); RB.S.set(m.F, rbSave());
  RB.off = net.clk != null ? net.clk : m.hn - performance.now() + (net.rtt || 0) / 2;
  if (again) stat.start('online', 'guest');
  layoutPads();
}
// 對手的時鐘換算成房主的（取來回最快的那次 ping）；開打中慢慢調，不讓自己突然快轉或停住
function rbClock() {
  if (RB.me === 0 || net.clk == null) return;
  const d = net.clk - RB.off;
  RB.off += mode === 'fight' && Math.abs(d) < 100 ? Math.max(-.3, Math.min(.3, d)) : d;
}
function rbTick(dt) {
  if (!RB_MODES.has(mode) || !p1) return;
  const now = performance.now();
  RB.pend |= rbPress(); rbClock();
  if (now - (RB.wAt || 0) > 1000) { RB.wAt = now; rbDW(); }
  // 跟著時鐘一格一格算：兩邊的第 n 格是同一個時間點（誰也不比誰早）
  RB.acc += Math.min(500, now - (RB.lastT || now)) / RB_FR; RB.lastT = now; // 真的經過多久（不用 dt：dt 卡頓時被截到 0.033 秒，會越落越後面）
  const drift = (now + RB.off - RB.T0) / RB_FR - (RB.F + RB.acc);
  if (Math.abs(drift) > 3) RB.acc += drift; else if (Math.abs(drift) > .5) RB.acc += drift * .1;
  if (RB.dirty < RB.F) rbResim();
  let n = Math.max(0, Math.min(30, Math.floor(RB.acc)));
  if (n > 2) n = Math.min(n, 2 + (n >> 2)); // 停過、落後很多：分幾幀快轉追上，不要一幀跳一大段
  let done = 0, stalled = false;
  for (let i = 0; i < n; i++) {
    const f = RB.F;
    const t = f + RB.D, h = rbHeld();
    for (let g = RB.lastMine + 1; g < t; g++) RB.mine[g] = h; // 開場／重來後第一格：前面空出來的照按著的方向
    if (t > RB.lastMine) { RB.mine[t] = h | RB.pend; RB.pend = 0; RB.lastMine = t; }
    rbCommit(rbCommitTo(f));
    if (f - Math.max(RB.ak, RB.fcu) > RB.P) { stalled = true; break; } // 對手的按鍵缺太多格（多半是我自己網路在卡）：停在這格等，不再往前猜
    if (RB.dirty < f) rbResim();
    rbStep(f); RB.F = f + 1; RB.acc--; done++;
  }
  if (stalled) { RB.st.stall++; if (!RB.stallOn) RB.st.stalls++; }
  RB.stallOn = stalled;
  if (done === 1 && n === 1) { if (RB.acc < .25) RB.acc += .01; else if (RB.acc > .75) RB.acc -= .01; } // 每幀剛好算一格時，把「下一格」的時間點放在兩幀中間：畫面更新時間抖一點也不會一幀算兩格、下一幀算零格
  if (done || (stalled && now - (RB.sendAt || 0) > 50)) { RB.sendAt = now; rbSendIn(); } // 停著也要回報收到哪裡（不然對手不知道要補送）
  // 兩邊都定案的格子：每 30 格（半秒）互相對一次結果
  const cf = Math.min(RB.fcu, RB.mcu);
  while (RB.nextH - 1 <= cf && RB.nextH <= RB.F) {
    const f = RB.nextH, s = RB.S.get(f); RB.nextH += 30; if (!s) continue;
    const h = rbHash(s); RB.myH.set(f, h); RB.hq.push([f, h]); if (RB.hq.length > 6) RB.hq.shift(); rbCmp(f);
  }
  const keep = Math.max(Math.min(cf, RB.nextH - 1, RB.dirty) - 1, RB.F - 1200);
  for (const k of RB.S.keys()) { if (k >= keep) break; RB.S.delete(k); }
  if (RB.sfx.size > 600) for (const [k, f] of RB.sfx) if (f < RB.F - 300) RB.sfx.delete(k);
  while (RB.mfill.length && RB.mfill[0][1] < RB.F - 1200) RB.mfill.shift();
  while (RB.fills.length && RB.fills[0][1] < RB.fcu - 600) RB.fills.shift();
  for (const m of RB.myH.keys()) { if (m >= RB.F - 600) break; RB.myH.delete(m); }
  // 一場結束：統計、排位分數等到結束那一格兩邊都確定了才算（對手斷線等不到就 3 秒後照算）
  if (mode === 'over' && RB.overF != null && !RB.overDone) {
    RB.overSeen = RB.overSeen || now;
    if (cf >= RB.overF || now - RB.overSeen > 3000) {
      RB.overDone = true; const w0 = wins[0] >= winNeed();
      stat.end(w0 ? 'p1' : 'p2'); if (RK.on) rkEnd(w0 === (RB.me === 0));
    }
  }
  if (mode === 'over' && RB.overDone && stateT > 1.5 && (net.role === 'host' || RK.on) && (pressed.has('Enter') || pressed.has('Space'))) overNext(); // 房主：再來一場；排位：看分數
  const k = Math.exp(-dt / .07); for (let i = 0; i < 2; i++) { RB.vx[i] *= k; RB.vy[i] *= k; }
}
// 兩包之間自己往前推（照速度移動、動作時間照走）
function advanceFighter(ft, dt, skipAct) {
  if (dt <= 0) return;
  if (ft.stun > 0) { ft.stun -= dt; ft.vx *= Math.pow(.02, dt); }
  ft.x = clampX(ft.x + ft.vx * dt);
  if (ft.y > 0 || ft.vy > 0) {
    const floating = ft.act && ft.act.type === 'shan' && ft.act.dir === 'up' && ft.act.t < .34;
    ft.vy -= GRAV * dt * (floating ? .25 : 1); ft.y = Math.max(0, ft.y + ft.vy * dt);
    if (ft.y <= 0) ft.vy = 0;
  }
  if (!skipAct && ft.act && ft.act.t + dt < ft.act.dur) ft.act.t += dt;
  for (const k in ft.cd) ft.cd[k] = Math.max(0, ft.cd[k] - dt);
  ft.flash = Math.max(0, ft.flash - dt);
}
// 每 0.25 秒量一次來回：兩邊用來決定 W；對手順便拿房主的時鐘對時（rbClock）
setInterval(() => { if (net.role === 'guest' && net.peer) netSend(JSON.stringify({ t: 'pg', ts: performance.now() }), true); }, 250);
function rttAdd(ms) { net.rtt = Math.round(ms); (net.rtts = net.rtts || []).push(ms); if (net.rtts.length > 40) net.rtts.shift(); }

/* ---- 兩支手機直接連線（WebRTC）：伺服器只負責牽線，對戰資料不再繞去美國機房 ----
   直連建不起來（某些行動網路擋）就自動照舊走伺服器轉送
   直連開兩條通道：g＝可靠（選招、音效、設定，一定要到）；u＝快速（畫面、按鍵、測延遲：不重傳、不排隊，掉了就等下一包）。
   以前全部走可靠通道：網路一掉包或上傳頻寬不夠，每包都排在重傳的後面，延遲越疊越高（實測 RTT 100 毫秒的網路會顯示 300～600） */
// 手機網路常常打不通直連（電信 CGNAT）：以前就退回伺服器轉送（TCP，掉一包整串卡住＝「有時頓一下」）。
// 現在跟伺服器要 TURN 中繼（/api/ice，伺服器有設 Cloudflare TURN 金鑰才有）：打不通也走 UDP 中繼，一樣不排隊、不卡
let ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }], iceAt = 0, iceP = null;
function iceLoad() { // 一進遊戲先要一次（帳密 24 小時有效，6 小時換新）
  if (iceP && Date.now() - iceAt < 6 * 3600e3) return iceP;
  iceAt = Date.now();
  return iceP = fetch('/api/ice').then(r => r.json()).then(j => { if (Array.isArray(j.iceServers) && j.iceServers.length) ICE = j.iceServers; }).catch(() => {});
}
if (location.protocol !== 'file:') iceLoad();
const iceWait = () => Promise.race([iceLoad(), new Promise(r => setTimeout(r, 1500))]); // 最多等 1.5 秒，拿不到就照舊只用 STUN
// 直連建好後看實際走哪條：relay＝TURN 中繼（畫面上顯示「中繼」）
async function rtcPath(pc) {
  try {
    const st = await pc.getStats(); let pair = null;
    st.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId); });
    if (!pair) st.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
    const c = pair ? [st.get(pair.localCandidateId), st.get(pair.remoteCandidateId)] : [];
    if (net.pc === pc) net.relay = c.some(x => x && x.candidateType === 'relay');
  } catch (e) {}
}
function wsSend(o) { if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(o)); }
// both：直連之外也從伺服器送一份（對戰按鍵用，很小）：直連那條路突然抖的時候，伺服器那條先到就先用，收的那邊重複的會自己略過
function netSend(msg, fast, both) {
  const u = net.du;
  if (fast && u && u.readyState === 'open') {
    if (u.bufferedAmount < 8192) try { u.send(msg); } catch (e) {} // 塞住就丟，反正下一包會再送
    if (both && net.ws && net.ws.readyState === 1 && net.ws.bufferedAmount < 16384) net.ws.send(msg);
    return;
  }
  if (net.dc && net.dc.readyState === 'open') { try { net.dc.send(msg); return; } catch (e) {} }
  if (net.ws && net.ws.readyState === 1) net.ws.send(msg);
}
function rtcClose() {
  const { pc, dc, du } = net; net.pc = net.dc = net.du = null; net.pendC = []; net.relay = false;
  for (const c of [dc, du]) try { if (c) c.close(); } catch (e) {}
  try { if (pc) pc.close(); } catch (e) {}
}
function rtcNew() {
  rtcClose();
  if (!window.RTCPeerConnection) return null;
  const pc = net.pc = new RTCPeerConnection({ iceServers: ICE });
  pc.onicecandidate = e => { if (e.candidate && net.pc === pc) wsSend({ t: 'rtc', c: e.candidate }); };
  pc.ondatachannel = e => rtcBind(pc, e.channel);
  // 直連中途斷掉（換基地台、Wi-Fi 跳 4G）：失敗就馬上、暫時斷線 2 秒沒回來就重建一條（房主發起；對手請房主重建），中間先走伺服器轉送
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState; if (net.pc !== pc || (s !== 'failed' && s !== 'disconnected')) return;
    clearTimeout(net.iceT);
    net.iceT = setTimeout(() => {
      if (net.pc !== pc || pc.connectionState === 'connected' || !net.peer) return;
      if (net.role === 'host') rtcStart(); else wsSend({ t: 'rtcre' });
    }, s === 'failed' ? 0 : 2000);
  };
  return pc;
}
function rtcBind(pc, dc) {
  const slot = dc.label === 'u' ? 'du' : 'dc';
  dc.onopen = () => { if (net.pc === pc) { net[slot] = dc; if (slot === 'dc') rtcPath(pc); } };
  dc.onclose = () => { if (net[slot] === dc) net[slot] = null; };
  dc.onmessage = e => { if (net.pc === pc) netMsg(JSON.parse(e.data)); };
}
async function rtcStart() { // 房主發起
  const room = net.room; await iceWait(); if (net.room !== room || !net.role) return; // 等 TURN 帳密時離開了房間
  const pc = rtcNew(); if (!pc) return;
  rtcBind(pc, pc.createDataChannel('g', { ordered: false }));
  rtcBind(pc, pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
  try { await pc.setLocalDescription(await pc.createOffer()); wsSend({ t: 'rtc', sdp: pc.localDescription }); } catch (e) {}
}
async function rtcSignal(m) {
  try {
    if (m.sdp && m.sdp.type === 'offer') {
      await iceWait(); // 等 TURN 帳密這段時間收到的候選位址先留著，不要被 rtcNew 清掉
      const keep = net.pendC.splice(0), pc = rtcNew(); if (!pc) return; net.pendC = keep;
      await pc.setRemoteDescription(m.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      wsSend({ t: 'rtc', sdp: pc.localDescription });
    } else if (m.sdp) { if (net.pc) await net.pc.setRemoteDescription(m.sdp); }
    else if (m.c) {
      if (net.pc && net.pc.remoteDescription) await net.pc.addIceCandidate(m.c); else net.pendC.push(m.c);
      return;
    }
    if (net.pc && net.pc.remoteDescription) for (const c of net.pendC.splice(0)) net.pc.addIceCandidate(c).catch(() => {});
  } catch (e) {}
}

function showLobby(panel, err = '') {
  mode = 'lobby'; $('lobby').classList.remove('hide');
  $('lbMain').classList.toggle('hide', panel !== 'main');
  $('lbWait').classList.toggle('hide', panel !== 'wait');
  $('lbSpec').classList.toggle('hide', panel !== 'spec');
  $('lbErr').textContent = err;
  layoutPads();
}
function hideLobby() { $('lobby').classList.add('hide'); }
function openLobby(err = '') { netLeave(); showLobby('main', err); }
function inviteLink() { return location.origin + location.pathname + '?room=' + net.room; }

// rk：排位賽配對到的房間（不顯示連線大廳，選招、結算都在排位畫面裡）；重連時沿用
function netConnect(role, room, retry = false, rk = retry && net.rk) {
  clearTimeout(net.retryT);
  netLeave();
  if (!retry) { net.key = Math.random().toString(36).slice(2, 14); net.tries = 0; }
  net.role = role; net.room = room; net.peer = false; net.leaving = false; net.ev = []; net.rk = rk;
  $('lbRoom').textContent = room;
  $('lbMsg').textContent = retry ? '重新連線中…' : role === 'host' ? '等待對手加入…（' + (net.ext ? '擴充：自選三招' : '經典：閃・踢・熊') + '）' : '連線中…';
  $('lbHint').textContent = '把房號或邀請連結傳給朋友';
  $('lbHint').classList.toggle('hide', role !== 'host'); $('lbCopy').classList.toggle('hide', role !== 'host'); $('lbQr').classList.toggle('hide', role !== 'host'); $('qrBig').classList.add('hide');
  $('lbCopy').textContent = navigator.share && isTouch ? '分享邀請連結' : '複製邀請連結';
  if (!rk) { showLobby('wait'); $('leave').classList.remove('hide'); }
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?room=' + room + '&role=' + role + '&k=' + net.key);
  net.ws = ws;
  ws.onopen = () => { if (net.ws !== ws) return; net.tries = 0; if (role === 'host') $('lbMsg').textContent = '等待對手加入…（' + (net.ext ? '擴充：自選三招' : '經典：閃・踢・熊') + '）'; };
  ws.onmessage = e => { if (net.ws === ws) netMsg(JSON.parse(e.data)); };
  ws.onclose = () => {
    if (net.ws !== ws) return;
    if (net.leaving) { netReset(); return; }
    // 手機切到別的 App 時瀏覽器常切斷連線：同一個房號自動接回去（回到畫面時立刻重連）
    if (net.tries < 30) {
      net.tries++; net.ws = null; net.peer = false; stopChant();
      if (rk) rkPeerOff(); else { $('lbMsg').textContent = '連線中斷，重新連線中…'; showLobby('wait'); }
      net.retryT = setTimeout(() => netConnect(role, room, true), Math.min(500 * net.tries, 4000));
      return;
    }
    if (rk) { rkNetFail('連線中斷了'); return; }
    netReset(); openLobby('連線中斷了，請重新建立或加入房間');
  };
}
addEventListener('visibilitychange', () => {
  if (!document.hidden && net.role && net.room && (!net.ws || net.ws.readyState > 1)) { if (net.role === 'spec') specConnect(net.room, true); else netConnect(net.role, net.room, true); }
});

/* ================= 觀戰區：列出正在打的真人對戰，點一場就看（只看不打，人數不限） ================= */
function specOpen() {
  netLeave(); showLobby('spec'); specList();
  clearInterval(net.specListT); net.specListT = setInterval(() => { if ($('lbSpec').classList.contains('hide') || $('lobby').classList.contains('hide')) clearInterval(net.specListT); else specList(); }, 5000);
}
async function specList() {
  let list = null;
  try { list = (await (await fetch('/api/live', { cache: 'no-store' })).json()).list; } catch (e) {}
  const box = $('spList'); box.textContent = '';
  if (!list) { box.innerHTML = '<div class="sub">讀取失敗，稍後再試</div>'; return; }
  if (!list.length) { box.innerHTML = '<div class="sub">現在沒有人在對戰。<br>開一間房間或打排位賽，別人就看得到你！</div>'; return; }
  const cn = c => (CHARS[c] && CHARS[c].look && CHARS[c].look.name) || '';
  for (const g of list) {
    const b = document.createElement('button'); b.className = 'spRow';
    b.innerHTML = '<span class="spTag' + (g.rk ? ' rk' : '') + '">' + (g.rk ? '排位' : g.ext ? '擴充' : '經典') + '</span>'
      + '<span class="spVs"><b>' + rkEsc(g.a) + '</b><small>' + rkEsc(cn(g.ca)) + '</small></span><span class="spSc">' + (g.w || [0, 0]).join(' : ') + '</span>'
      + '<span class="spVs"><b>' + rkEsc(g.b) + '</b><small>' + rkEsc(cn(g.cb)) + '</small></span><span class="spN">👀 ' + (g.n || 0) + '</span>';
    b.onclick = () => { unlockAudio(); specConnect(g.room); };
    box.appendChild(b);
  }
}
function specConnect(room, retry = false) {
  clearTimeout(net.retryT); clearInterval(net.specListT);
  netLeave();
  if (!retry) { net.tries = 0; net.specInfo = null; }
  net.role = 'spec'; net.room = room; net.peer = false; net.leaving = false; net.ev = []; net.rk = false; net.sb = []; net.off = null;
  p1 = p2 = null; balls = []; ghosts = []; fx = []; captions = []; banner = null;
  document.body.classList.add('spec');
  $('lbRoom').textContent = room; $('lbMsg').textContent = retry ? '重新連線中…' : '連線中…';
  for (const id of ['lbHint', 'lbCopy', 'lbQr', 'qrBig']) $(id).classList.add('hide');
  showLobby('wait'); $('leave').classList.remove('hide');
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?room=' + room + '&role=spec');
  net.ws = ws;
  ws.onopen = () => { if (net.ws === ws) net.tries = 0; };
  ws.onmessage = e => { if (net.ws === ws) netMsg(JSON.parse(e.data)); };
  ws.onclose = () => {
    if (net.ws !== ws) return;
    if (net.leaving) { netReset(); return; }
    if (net.tries < 10) { net.tries++; net.ws = null; stopChant(); net.retryT = setTimeout(() => specConnect(room, true), Math.min(500 * net.tries, 4000)); return; }
    netReset(); specOpen(); $('lbErr').textContent = '觀戰連線中斷了';
  };
}
function specMsg(m) {
  if (m.t === 'sv') { specApply(m); return; }
  if (m.t === 'se') { playEv(m.ev); return; }
  if (m.t === 'sinfo') {
    if (m.info) net.specInfo = m.info;
    if (!m.on && !p1) $('lbMsg').textContent = '這場還沒開始或已經結束，等他們開打…（不想等可以按返回）';
    return;
  }
  if (m.t === 'peer' && !m.on) { stopChant(); net.specNote = '有一方斷線了，等他回來…'; }
}
function netMsg(m) {
  if (net.role === 'spec') { specMsg(m); return; }
  if (m.t === 'ri') { rbRecv(m); return; }
  if (m.t === 'hq') { rbHpBack(); return; }
  if (m.t === 'spn') { net.specN = m.n || 0; return; } // 房主：現在幾個人在看
  if (m.t === 'err') { if (net.rk) { rkNetFail(m.msg); return; } const r = net.room, role = net.role; openLobby(m.msg); if (role === 'guest') $('lbCode').value = r; return; }
  if (m.t === 'peer' && net.rk) { net.peer = !!m.on; if (m.on) rkPeerOn(); else { stopChant(); rtcClose(); rkPeerOff(); } return; }
  if (m.t === 'rkd' && net.rk && net.role === 'guest') { if (m.v !== NET_V) { rkNetFail(NET_OLD); return; } if (!RK.draft) rkDraftStart(m.pool, m.first === 'guest'); return; }
  // 直連的可靠通道不保證順序：對手連選兩招、或「準備」比最後一招先到都有可能 → 先照步數存起來，輪到了再用
  if (m.t === 'rka' && net.rk) { (RK.pendA = RK.pendA || {})[m.s] = m.k; rkFlushFoe(); return; }
  if (m.t === 'rkr' && net.rk) { RK.pendR = m.load; rkFlushFoe(); return; }
  if (m.t === 'peer') {
    if (m.on) {
      net.peer = true; hideLobby();
      if (net.role === 'host') {
        net.peerSkin = null; net.peerName = ''; net.liveAt = 0;
        wsSend({ t: 'cfg', ext: !!net.ext, v: NET_V }); // 告訴對手這間是經典還是擴充
        if (net.ext) extPick(); else startMatch(false);
        rtcStart();
      } else { vsCPU = false; p1 = null; mode = 'intro'; net.ext = false; RB.had = false; stat.start('online', 'guest'); netSkin(); }
      layoutPads();
    } else {
      net.peer = false; RB.on = false; stopChant(); rtcClose(); $('mvPick').classList.add('hide');
      $('lbMsg').textContent = net.role === 'host' ? '對手離線了，等他回來或等新對手加入…' : '房主暫時斷線，等他回來…（不想等可以按返回）';
      showLobby('wait');
    }
    return;
  }
  if (m.t === 'rtc') { rtcSignal(m); return; }
  if (m.t === 'rtcre' && net.role === 'host') { if (!(net.pc && net.pc.connectionState === 'connected')) rtcStart(); return; }
  if (m.t === 'cfg' && net.role === 'guest') { if (m.v !== NET_V) { openLobby(NET_OLD); return; } net.ext = !!m.ext; if (net.ext) extPick(); return; }
  if (m.t === 'repick' && net.role === 'guest') { extPick(); return; }
  if (m.t === 'go' && net.role === 'guest') { $('mvPick').classList.add('hide'); return; }
  if (m.t === 'pkst') { mpPeerReady(); return; }
  if (m.t === 'sk' && net.role === 'host') { if (m.v !== NET_V) { wsSend({ t: 'err', msg: NET_OLD }); return; } if (okSkin(m.sk)) { net.peerSkin = m.sk; if (p2 && p2.char !== m.sk) { if (RB.on) rbRestart(() => { p2.char = m.sk; }); else p2.char = m.sk; } } net.peerName = String(m.nm || '').slice(0, 12); net.liveAt = 0; return; }
  if (m.t === 'pk' && net.role === 'host') { if (validLoad(m.load)) { net.peerLoad = m.load; mpPeerReady(); extTryStart(); } return; }
  if (m.t === 'wait') { $('lbMsg').textContent = '房主暫時不在（可能切去傳房號），等他回到遊戲就會開始…'; return; }
  if (m.t === 'rbgo' && net.role === 'guest') rbGo(m);
  else if (m.t === 'rbrq' && net.role === 'host') { if (m.id === RB.id) rbRestart(); }
  // 延遲量測：對手 → 房主 → 對手 一趟來回；hn＝房主那一刻的時鐘，對手拿來對時
  else if (m.t === 'pg' && net.role === 'host') netSend(JSON.stringify({ t: 'po', ts: m.ts, hn: performance.now() }), true);
  else if (m.t === 'po' && net.role === 'guest') {
    const now = performance.now(), rtt = now - m.ts; rttAdd(rtt); netSend(JSON.stringify({ t: 'rt', ms: net.rtt }));
    const S = net.clkS = net.clkS || []; S.push([rtt, m.hn + rtt / 2 - now]); if (S.length > 20) S.shift();
    net.clk = S.reduce((a, b) => b[0] < a[0] ? b : a)[1];
  }
  else if (m.t === 'rt' && net.role === 'host') rttAdd(m.ms);
}
function netReset() {
  net.role = null; net.ws = null; net.peer = false; net.ev = []; net.rtt = null; net.rtts = []; net.clk = null; net.clkS = []; net.rk = false; clearTimeout(net.retryT); rtcClose();
  RB.on = false; RB.pending = false; RB.had = false;
  net.specN = 0; net.specNote = ''; document.body.classList.remove('spec');
  $('leave').classList.add('hide'); stopChant(); layoutPads();
}
function netLeave() {
  if (net.ws) { const ws = net.ws; netReset(); try { ws.close(1000); } catch (e) {} }
}

$('lbCreate').onclick = () => { unlockAudio(); net.ext = false; netConnect('host', String(1000 + Math.floor(Math.random() * 9000))); };
$('lbCreateX').onclick = () => { unlockAudio(); if (!UNLOCKED) { synth('thud'); $('lbErr').textContent = '🔒 ' + LOCK_MSG; return; } net.ext = true; netConnect('host', String(1000 + Math.floor(Math.random() * 9000))); };
$('lbJoin').onclick = () => {
  unlockAudio();
  const code = $('lbCode').value.replace(/\D/g, '');
  if (code.length !== 4) { $('lbErr').textContent = '請輸入 4 位數房號'; return; }
  netConnect('guest', code);
};
$('lbCode').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') $('lbJoin').click(); });
const backToTitle = () => { netLeave(); hideLobby(); mode = 'title'; layoutPads(); };
$('perfShare').onclick = e => { e.stopPropagation(); perfPanel($('perfPanel').classList.contains('hide')); };
$('perfPanel').onclick = e => { e.stopPropagation(); const k = e.target.closest('[data-k]'); if (!k) { if (e.target.id === 'perfPanel') perfPanel(false); return; } if (k.dataset.k === 'close') perfPanel(false); else perfPick(k.dataset.k); };
$('perfPanel').onkeydown = e => e.stopPropagation();
$('lbBack').onclick = backToTitle;
$('leave').onclick = backToTitle;
$('lbSpecBtn').onclick = () => { unlockAudio(); specOpen(); };
$('spBack').onclick = () => { clearInterval(net.specListT); showLobby('main'); };
$('lbCopy').onclick = async () => {
  const link = inviteLink();
  try {
    if (navigator.share && isTouch) await navigator.share({ title: '閃身步大亂鬥', text: '來跟我對打！房號 ' + net.room, url: link });
    else { await navigator.clipboard.writeText(link); $('lbCopy').textContent = '已複製！'; }
  } catch (e) { $('lbHint').textContent = link; }
};
// 外出推廣：開房後顯示大 QR code，路人用手機掃了直接進房（連結多帶 qr=1，後台看得出掃碼進來的人）
// 產生器 assets/lib/qrcode.js（qrcode-generator，MIT）第一次按才載入
function loadQrLib() {
  if (window.qrcode) return Promise.resolve();
  return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'assets/lib/qrcode.js'; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
}
$('lbQr').onclick = async () => {
  try { await loadQrLib(); } catch (e) { $('lbHint').textContent = 'QR code 載入失敗，請改用複製連結'; return; }
  const q = qrcode(0, 'M'); q.addData(inviteLink() + '&qr=1'); q.make();
  $('qrImg').innerHTML = q.createSvgTag(8, 16); $('qrRoom').textContent = net.room; $('qrBig').classList.remove('hide');
};
$('qrBig').onclick = () => $('qrBig').classList.add('hide');
// 邀請連結 ?room=1234 → 直接加入
{ const r = (params.get('room') || '').replace(/\D/g, ''); if (r.length === 4) { $('lbCode').value = r; setTimeout(() => netConnect('guest', r), 0); } }

/* ================= 遊玩統計（只送匿名代號，後台 /admin 才看得到） ================= */
const stat = (() => {
  const rnd = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  let off = replayView || location.protocol === 'file:' || location.hostname.startsWith('shanshenbu-test'), vid = null;
  try { off = off || localStorage.getItem('ssb_me') === '1'; vid = localStorage.getItem('ssb_vid'); if (!vid) { vid = rnd(); localStorage.setItem('ssb_vid', vid); } } catch (e) {}
  vid = vid || rnd();
  const sid = rnd();
  const send = o => { if (off) return; o.sid = sid; o.vid = vid; try { navigator.sendBeacon('/api/t', JSON.stringify(o)); } catch (e) {} };
  let ref = ''; try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
  send({ e: 'visit', dev: isTouch ? 'mobile' : 'desktop', ref: params.get('qr') ? 'qr-scan' : /ShanshenbuApp/.test(navigator.userAgent) ? 'android-app' : ref }); // qr-scan：外出時掃 QR code 進來的 // 後台看得出多少人用 App
  // 停留時間：畫面在前景才算，切走／關掉時送一次；一直開著就每 5 分鐘補送（省 Cloudflare 請求）
  let acc = 0, game = null;
  const flush = () => { if (acc >= 1) { send({ e: 'hb', sec: Math.round(acc) }); acc = 0; } };
  setInterval(() => { if (!document.hidden) acc++; if (acc >= 300) flush(); }, 1000);
  addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  addEventListener('pagehide', flush);
  return {
    vid, sid,
    start(mode, role) { game = { gid: rnd(), t0: performance.now(), mode, role }; send({ e: 'start', gid: game.gid, mode, role }); },
    end(res) { if (!game) return; const g = game, dur = (performance.now() - g.t0) / 1000; send({ e: 'end', gid: g.gid, dur, res }); game = null; onGameEnd(g.mode, g.role, res, dur); },
  };
})();

if (location.hostname.startsWith('shanshenbu-test')) {
  document.title = '【測試版】' + document.title;
  document.querySelector('#lobby h2').textContent = '線上對戰（測試版）';
  const t = document.createElement('div'); t.textContent = '測試版：只能和也開測試版網址的人連線';
  t.style.cssText = 'position:fixed;top:6px;left:6px;z-index:9;background:#c0392b;color:#fff;font-size:13px;padding:3px 8px;border-radius:6px;pointer-events:none';
  document.body.appendChild(t);
}
/* ================= 連線擴充模式：開打前兩邊祕密各選三招（原本三招＋30 新招）================= */
const EXT_POOL = () => ['shan', 'ball', 'bear', ...MOVE_IDS];
const validLoad = l => Array.isArray(l) && l.length === 3 && new Set(l).size === 3 && l.every(k => EXT_POOL().includes(k));
const mpk = { sel: [], done: false };
function extPick() {
  let prev = []; try { prev = JSON.parse(lsGet('ssb_load') || '[]'); } catch (e) {}
  mpk.sel = validLoad(prev) ? prev.slice() : []; mpk.done = false;
  if (net.role === 'host') { net.myLoad = null; net.peerLoad = null; }
  mode = 'mvpick'; hideLobby(); $('mpMsg').textContent = ''; mpRender();
  $('mvPick').querySelector('h2').textContent = mpk.mc ? '第 ' + (MC.i + 1) + ' 關：選 3 招' : '擴充模式：選 3 招';
  $('mvPick').querySelector('.sub').textContent = mpk.mc ? '任選三招帶去挑戰「' + MC_STAGES[MC.i].n + '」。選的順序就是 J／K／L（手機是三顆招式鈕）' : '對手看不到你選了什麼，出招後才會揭曉。選的順序就是 J／K／L（手機是三顆招式鈕）';
  $('mpBack').classList.toggle('hide', !mpk.mc);
  $('mvPick').classList.remove('hide'); layoutPads();
}
function mpRender() {
  $('mpSlots').innerHTML = '';
  ['J', 'K', 'L'].forEach((key, i) => {
    const d = document.createElement('div'); d.className = mpk.sel[i] ? 'on' : '';
    d.textContent = mpk.sel[i] ? skName(mpk.sel[i]) : '（空）';
    const sm = document.createElement('small'); sm.textContent = key + ' 鍵'; d.appendChild(sm); $('mpSlots').appendChild(d);
  });
  const g = $('mpGrid'); g.innerHTML = '';
  for (const k of EXT_POOL()) {
    const b = document.createElement('button'), n = mpk.sel.indexOf(k);
    if (n >= 0) { b.className = 'on'; }
    b.disabled = mpk.done;
    const t = document.createElement('b'); t.textContent = skName(k); if (n >= 0) t.dataset.n = 'JKL'[n];
    const c = document.createElement('i'); c.textContent = '冷卻 ' + skMax(k) + ' 秒';
    const d = document.createElement('span'); d.textContent = ORIG[k] ? { shan: '瞬移閃避，移動中無敵', ball: '踢出足球打遠距離', bear: '衝上去連打、控住對手' }[k] : MOVES[k].desc;
    b.append(t, c, d);
    b.onclick = () => { if (mpk.done) return; const j = mpk.sel.indexOf(k); if (j >= 0) mpk.sel.splice(j, 1); else if (mpk.sel.length < 3) mpk.sel.push(k); mpRender(); };
    g.appendChild(b);
  }
  $('mpOk').disabled = mpk.sel.length !== 3 || mpk.done;
  $('mpRandom').disabled = mpk.done;
}
$('mpBack').onclick = () => { mpk.mc = false; $('mvPick').classList.add('hide'); maOpen(); };
$('mpRandom').onclick =() => { const pool = EXT_POOL().sort(() => Math.random() - .5); mpk.sel = pool.slice(0, 3); mpRender(); };
$('mpOk').onclick = () => {
  if (mpk.sel.length !== 3 || mpk.done) return;
  if (mpk.mc) { mpk.mc = false; lsSet('ssb_load', JSON.stringify(mpk.sel)); $('mvPick').classList.add('hide'); maStart(mpk.sel); return; } // 挑戰馬師傅：選完直接開打
  mpk.done = true; lsSet('ssb_load', JSON.stringify(mpk.sel)); unlockAudio();
  $('mpMsg').textContent = '已確定！等待對手選招…'; mpRender();
  if (net.role === 'host') { net.myLoad = mpk.sel.slice(); wsSend({ t: 'pkst' }); extTryStart(); }
  else netSend(JSON.stringify({ t: 'pk', load: mpk.sel }));
};
function mpPeerReady() { if (!mpk.done) $('mpMsg').textContent = '對手已經選好了，換你！'; }
function extTryStart() {
  if (net.role !== 'host' || !net.myLoad || !net.peerLoad || !net.peer) return;
  startMatch(false);
  p1.load = net.myLoad; p2.load = net.peerLoad; p1.used = [0, 0, 0]; p2.used = [0, 0, 0];
  $('mvPick').classList.add('hide'); wsSend({ t: 'go' }); layoutPads();
}
/* ================= AI 組合對練（試玩）：你和電腦各選三招，電腦用第 2 階段的 30 招通用 AI ================= */
// 預設的電腦組合：第 2 階段對閃踢熊勝率最高的幾組（tools/assets/ai/results/phase2）
const AP_PRESETS = [
  [['ball', 'biandan', 'chayao'], '遠程＋增益（100%）'], [['dahu', 'fengbai', 'daqi'], '大起步近戰（100%）'], [['liaowang', 'chayao', 'daqi'], '增益＋大起步（100%）'],
  [['xiaolun', 'sandian', 'daqi'], '三近戰（100%）'], [['shuangchao', 'chayao', 'xiachuan'], '丟花拖時間（97%）'], [['shuangchao', 'biandan', 'chayao'], '丟花＋減傷回血（100%）'],
  [['fengbai', 'daqi', 'pinghu'], '防守＋大起步（99%）'], [['liaowang', 'chengu', 'daqi'], '地波＋大起步（99%）'], [['shan', 'ball', 'bear'], '基本三招'],
];
const ap = { me: ['shan', 'ball', 'bear'], ai: AP_PRESETS[0][0].slice(), side: 1 };
function apOpen() {
  ap.lock = null;
  try { const s = JSON.parse(lsGet('ssb_ap') || 'null'); if (s && validLoad(s.me) && validLoad(s.ai)) { ap.me = s.me; ap.ai = s.ai; } } catch (e) {}
  nnLoadGeneral(); mode = 'mvpick'; $('aiPick').classList.remove('hide'); apRender(); layoutPads();
}
function apRender() {
  for (const [id, load] of [['apMe', ap.me], ['apAi', ap.ai]]) {
    $(id).innerHTML = '';
    for (let i = 0; i < 3; i++) { const d = document.createElement('div'); d.className = load[i] ? 'on' : ''; d.textContent = load[i] ? 'JKL'[i] + ' ' + skName(load[i]) : '（空）'; $(id).appendChild(d); }
  }
  document.querySelectorAll('.apSide').forEach(e => e.classList.toggle('on', +e.dataset.s === ap.side));
  const cur = ap.side ? ap.ai : ap.me, g = $('apGrid'); g.innerHTML = '';
  for (const k of EXT_POOL()) {
    const b = document.createElement('button'), n = cur.indexOf(k); if (n >= 0) b.className = 'on';
    const t = document.createElement('b'); t.textContent = skName(k); if (n >= 0) t.dataset.n = 'JKL'[n];
    const c = document.createElement('i'); c.textContent = '冷卻 ' + skMax(k) + ' 秒';
    const d = document.createElement('span'); d.textContent = ORIG[k] ? { shan: '瞬移閃避，移動中無敵', ball: '踢出足球打遠距離', bear: '衝上去連打、控住對手' }[k] : MOVES[k].desc;
    b.append(t, c, d);
    b.onclick = () => { const j = cur.indexOf(k); if (j >= 0) cur.splice(j, 1); else if (cur.length < 3) cur.push(k); apRender(); };
    g.appendChild(b);
  }
  // 從「AI 關卡」進來：電腦的招固定，只能選自己的
  const lk = ap.lock; $('apLock').style.display = lk ? 'block' : 'none'; $('apPreset').style.display = lk ? 'none' : '';
  if (lk) $('apLock').textContent = `${lk.txt}：電腦反應 ${(lk.delay / 15).toFixed(2)} 秒、失誤 ${Math.round(lk.eps * 100)}%` + ($('lvShow').checked ? `｜破解：${lk.counters.map(c => c[1]).join('；')}` : '');
  $('apModel').value = NN.gen;
  const sel = $('apPreset'); if (!sel.options.length) { sel.add(new Option('挑一組強組合給電腦…', '')); AP_PRESETS.forEach(([l, n], i) => sel.add(new Option(n + '：' + l.map(skName).join('／'), i))); }
  const ready = !!NN.genModel();
  $('apGo').disabled = ap.me.length !== 3 || ap.ai.length !== 3 || !ready;
  $('apMsg').textContent = !ready ? (NN.models[nnGenKey()] === null ? 'AI 模型載入失敗' : 'AI 模型載入中…') : '';
  if (!ready && NN.models[nnGenKey()] === 'loading') setTimeout(() => { if (!$('aiPick').classList.contains('hide')) apRender(); }, 300);
}
document.querySelectorAll('.apSide').forEach(e => e.onclick = ev => { if (ev.target.tagName === 'SELECT' || ev.target.tagName === 'OPTION') return; if (ap.lock && +e.dataset.s === 1) return; ap.side = +e.dataset.s; apRender(); });
$('apModel').onchange = e => { NN.gen = e.target.value; lsSet('ssb_nnv', NN.gen); nnLoadGeneral(); apRender(); };
$('apPreset').onchange = e => { if (e.target.value === '') return; ap.ai = AP_PRESETS[+e.target.value][0].slice(); ap.side = 1; e.target.value = ''; apRender(); };
$('apBack').onclick = () => { $('aiPick').classList.add('hide'); if (ap.lock) { $('lvPick').classList.remove('hide'); lvRender(); return; } mode = 'title'; layoutPads(); };
$('apGo').onclick = () => {
  if ($('apGo').disabled) return;
  if (!ap.lock) lsSet('ssb_ap', JSON.stringify({ me: ap.me, ai: ap.ai })); unlockAudio();
  $('aiPick').classList.add('hide');
  startMatch(true); NN.comboMatch = true;
  if (ap.lock) NN.level = { v: ap.lock.v, s: ap.lock.s, delay: ap.lock.delay, eps: ap.lock.eps };
  p1.load = ap.me.slice(); p2.load = ap.ai.slice(); p1.used = [0, 0, 0]; p2.used = [0, 0, 0]; layoutPads();
};
$('apBtn').onclick = apOpen;

/* ================= AI 關卡（試玩）：tools/assets/ai/design_levels.py 設計的 10 版 × 10 關 ================= */
const LVD = { data: null, v: 0 };
const lvDone = () => { try { return JSON.parse(lsGet('ssb_lv') || '{}'); } catch (e) { return {}; } };
function lvCleared(l) { const d = lvDone(); d[l.v + '-' + l.s] = 1; lsSet('ssb_lv', JSON.stringify(d)); }
function lvOpen() {
  nnLoadGeneral(); mode = 'mvpick'; $('lvPick').classList.remove('hide'); layoutPads();
  if (!LVD.data) fetch('assets/ai/levels.json').then(r => r.json()).then(j => { LVD.data = j; lvRender(); }).catch(() => { $('lvDesc').textContent = '找不到關卡資料（assets/ai/levels.json）'; });
  lvRender();
}
function lvRender() {
  if (!LVD.data) { $('lvStages').textContent = '載入中…'; return; }
  const vs = LVD.data.versions, d = lvDone();
  $('lvVers').innerHTML = '';
  vs.forEach((v, i) => {
    const b = document.createElement('button'), n = v.stages.filter(s => d[v.version + '-' + s.stage]).length;
    b.className = i === LVD.v ? 'on' : ''; b.textContent = v.version + '. ' + v.name + (n ? ` ${n}/10` : '');
    b.onclick = () => { LVD.v = i; lvRender(); }; $('lvVers').appendChild(b);
  });
  const v = vs[LVD.v]; $('lvDesc').textContent = v.desc + `（同一組招在這版最多過 ${v.max_cleared_by_one_combo} 關）`;
  $('lvStages').innerHTML = '';
  for (const s of v.stages) {
    const b = document.createElement('button'), clr = d[v.version + '-' + s.stage];
    b.innerHTML = `<b>第 ${s.stage} 關</b>${clr ? ' <span class=clr>✓ 過關</span>' : ''}<span class=bar><i style="width:${Math.round(s.difficulty * 100)}%"></i></span>`
      + `<small>電腦：${s.ai_names}（${s.arch}）</small><small>反應 ${(s.delay / 15).toFixed(2)} 秒・失誤 ${Math.round(s.eps * 100)}%・難度 ${Math.round(s.difficulty * 100)}</small>`
      + ($('lvShow').checked ? `<small class=ctr>破解：${s.counters.map(c => c[1] + ' ' + Math.round(c[2] * 100) + '%').join('；')}</small>` : '');
    b.onclick = () => lvPickStage(v, s); $('lvStages').appendChild(b);
  }
}
function lvPickStage(v, s) {
  $('lvPick').classList.add('hide');
  ap.lock = { v: v.version, s: s.stage, delay: s.delay, eps: s.eps, txt: `${v.name} 第 ${s.stage} 關`, counters: s.counters };
  ap.ai = s.ai.slice(); ap.side = 0; $('aiPick').classList.remove('hide'); apRender();
}
$('lvShow').onchange = () => { lvRender(); if (!$('aiPick').classList.contains('hide')) apRender(); };
$('lvBack').onclick = () => { $('lvPick').classList.add('hide'); mode = 'title'; layoutPads(); };
$('lvBtn').onclick = lvOpen;

function hostRematch() {
  if (net.ext) { extPick(); wsSend({ t: 'repick' }); } else startMatch(false);
}

/* ================= 天梯模式：一關一回合連勝電腦，前 100 名排行（存在伺服器 D1） ================= */
// 天梯：10 階 × 10 小關。stage＝階、sub＝小關；streak＝這次連贏幾關（送分用）
const ladder = { on: false, stage: 1, sub: 1, streak: 0, lastW: -1, t0: 0, name: '', start: 1, coins: 0, top: 0 };
function LV() { return ladder.on ? (ladder.stage - 1) * 1.6 + (ladder.sub - 1) * .15 : p2 && p2.maTier ? 2 + p2.maTier * 2 : MC.on ? 1.5 + MC.i * 1.1 : 0; } // 馬師傅：反應比一般電腦快，越高階越快 // 電腦強度：第 1 階第 1 關＝0，第 10 階第 10 關≈15.8
const LD_OPP = ['p2', 'rider', 'auntie', 'mascot', 'trump', 'bear', 'teacher']; // 每小關換一個造型；第 10 小關是階主（鼓子秧歌大師）
const ldMoveN = () => Math.min(6, 2 + ladder.stage); // 第 1 階 3 招、第 2 階 4 招、第 3 階 5 招、第 4 階起 6 招
const ldPrice = k => Math.round((100 + MOVES[k].cd * 30) / 10) * 10;
function ldOpponent() {
  const boss = ladder.sub === 10, g = (ladder.stage - 1) * 10 + ladder.sub - 1;
  p2.char = boss ? 'master' : LD_OPP[g % 7] === 'p2' ? undefined : LD_OPP[g % 7];
  p2.atk = bossMoves(ldMoveN()); p2.load = p2.atk.slice(); p2.ldCool = 1;
  p2.maxHp = Math.round(200 * (1 + .06 * (ladder.stage - 1)) * (boss ? 1.5 : 1)); p2.hp = p2.hpShow = p2.maxHp;
}
function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function ldShow(view, err = '') {
  mode = 'lobby'; $('ladder').classList.remove('hide');
  $('ldStart').classList.toggle('hide', view !== 'start'); $('ldMoves').classList.add('hide'); $('ldBoard').classList.remove('hide');
  $('ldResult').classList.toggle('hide', view !== 'result');
  $('ldErr').textContent = err; layoutPads();
}
function ldRender(d) {
  const ol = $('ldList'); ol.textContent = '';
  const top = (d && d.top) || [], meRank = d && d.me && d.me.rank;
  if (!top.length) { const li = document.createElement('li'); li.innerHTML = '<span>還沒有人上榜，第一名就是你！</span>'; ol.appendChild(li); }
  top.forEach((r, i) => {
    const li = document.createElement('li'); if (meRank === i + 1) li.className = 'me';
    const b = document.createElement('b'); b.textContent = (i + 1) + '.';
    const n = document.createElement('span'); n.textContent = r.name;
    const v = document.createElement('i'); v.style.fontStyle = 'normal'; v.textContent = ldPos(r.best);
    li.append(b, n, v); ol.appendChild(li);
  });
  return d;
}
// 排行榜 1 分鐘內重看就用上次抓的，不重打伺服器；自己送出分數後一律換新
const boardCache = {};
async function ldFetch(body) {
  try {
    const c = boardCache.ladder;
    if (!body && c && Date.now() - c.at < 60e3) return ldRender(c.d);
    const r = await fetch('/api/ladder' + (body ? '' : '?vid=' + encodeURIComponent(stat.vid)), body ? { method: 'POST', body: JSON.stringify(body) } : {});
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '伺服器錯誤');
    boardCache.ladder = { at: Date.now(), d };
    return ldRender(d);
  } catch (e) { $('ldErr').textContent = '排行榜暫時連不上' + (e.message && !/fetch|JSON/i.test(e.message) ? '：' + e.message : ''); return null; }
}
function openLadder() {
  netLeave(); ladder.on = false;
  ldShow('start'); ldStairs(); ldFetch();
}
function startLadder() {
  const name = myName();
  if (!name) { needName(startLadder); return; }
  unlockAudio();
  $('ladder').classList.add('hide');
  const pf = profLoad();
  vsCPU = true; RG.on = false; ladder.on = true; ladder.name = name; ladder.stage = ladder.start; ladder.sub = 1; ladder.streak = 0; ladder.coins = 0; ladder.t0 = performance.now();
  p1 = new Fighter('p1', 380, 1); p2 = new Fighter('p2', 900, -1); p1.char = pf.skin || 'teacher';
  p1.extra = pf.ldLoad.filter(k => MOVES[k] && pf.ldOwn.includes(k)).slice(0, MAX_MV); // 帶進天梯的招
  startStage(); layoutPads();
  stat.start('ladder', null);
}
function startStage() {
  wins = [0, 0]; round = 1; startRound(); ldOpponent();
  const boss = ladder.sub === 10, nm = p2.char ? CHARS[p2.char].name : '影分身';
  banner = { text: '第 ' + ladder.stage + ' 階・第 ' + ladder.sub + ' 關', sub: (boss ? '階主：' : '對手：') + nm + '（' + p2.atk.length + ' 招）', t: 0 };
}
// 贏一小關：往上爬；打完第 10 小關就上一階（鼓幣改從寶箱拿）
function ladderWin() {
  ladder.streak++; const pf = profLoad(), st = ladder.stage;
  pf.st.ldWins++; pf.ldBest = Math.max(pf.ldBest || 0, (st - 1) * 10 + ladder.sub); // 天梯最遠爬到哪
  if (ladder.sub === 10) {
    const first = st > (pf.ldTop || 0);
    if (first) pf.ldTop = st;
    profSave(pf);
    if (st === 10) { ladderEnd(true); return; }
    ladder.stage++; ladder.sub = 1; ladder.start = Math.max(ladder.start, 1);
    startStage(); banner.sub = (first ? '第一次登上第 ' + ladder.stage + ' 階！' : '上到第 ' + ladder.stage + ' 階！') + '　' + banner.sub; return;
  }
  profSave(pf);
  ladder.sub++; startStage();
}
async function ladderEnd(top) {
  mode = 'over'; stateT = 0; stat.end(top ? 'p1' : 'p2');
  const pos = top ? 100 : (ladder.stage - 1) * 10 + ladder.sub - 1, dur = Math.round((performance.now() - ladder.t0) / 1000);
  $('ldResTitle').textContent = top ? '🏆 登頂！' : '挑戰結束';
  $('ldScore').textContent = top ? '第 10 階 全破' : '第 ' + ladder.stage + ' 階・第 ' + ladder.sub + ' 關';
  $('ldCoinMsg').textContent = '';
  $('ldAgain').textContent = top ? '再爬一次' : '再挑戰第 ' + ladder.stage + ' 階';
  ladder.start = top ? 1 : ladder.stage;
  $('ldMsg').textContent = '送出成績中…';
  setTimeout(() => ldShow('result'), 1200);
  const d = await ldFetch({ vid: stat.vid, sid: stat.sid, name: ladder.name, streak: pos, won: ladder.streak, dur });
  const me = d && d.me;
  $('ldMsg').textContent = !d ? '成績沒送出去（網路問題）' : me && me.rank ? `你的最佳 ${ldPos(me.best)}｜第 ${me.rank} 名` + (me.rank > 100 ? '（再加油就上榜了）' : '') : '還沒過第 1 關，不會上榜，再接再厲！';
}
const ldPos = b => b >= 100 ? '🏆 登頂' : b % 10 ? '第 ' + (Math.floor(b / 10) + 1) + ' 階過 ' + (b % 10) + ' 關' : '登上第 ' + (b / 10 + 1) + ' 階';
// 階梯圖：選從哪一階開始（爬過的階都能選）
function ldStairs() {
  const pf = profLoad(), un = Math.min(10, (pf.ldTop || 0) + 1); ladder.start = Math.min(ladder.start || 1, un);
  const box = $('ldStairs'); box.textContent = '';
  for (let i = 1; i <= 10; i++) {
    const b = document.createElement('button'), lock = i > un;
    b.className = 'ldStep' + (i <= (pf.ldTop || 0) ? ' ok' : '') + (lock ? ' lock' : '') + (i === ladder.start ? ' sel' : '');
    b.style.height = (22 + i * 9.5) + 'px'; b.textContent = i === 10 ? '頂' : i;
    if (!lock) b.onclick = () => { ladder.start = i; ldStairs(); };
    box.appendChild(b);
  }
  $('ldPick').textContent = '從第 ' + ladder.start + ' 階開始　｜　電腦 ' + Math.min(6, 2 + ladder.start) + ' 招' + (pf.ldTop ? '　｜　已登上第 ' + pf.ldTop + ' 階' : '');
  $('ldMvN').textContent = pf.ldLoad.length;
}
// 天梯招式庫：買招、選要帶的（最多 10）
function ldMovesRender() {
  const pf = profLoad(); $('ldCoins').textContent = pf.coins;
  const g = $('ldMvGrid'); g.textContent = '';
  for (const k of MOVE_IDS) {
    const own = pf.ldOwn.includes(k), on = pf.ldLoad.includes(k), price = ldPrice(k), d = document.createElement('div');
    d.className = 'ldMv' + (on ? ' on' : '');
    d.innerHTML = '<div class="n"></div><div class="d"></div><button></button>';
    d.querySelector('.n').textContent = MOVES[k].name + '（冷卻 ' + MOVES[k].cd + ' 秒）'; d.querySelector('.d').textContent = MOVES[k].desc;
    const b = d.querySelector('button');
    if (!own) { b.textContent = '買　' + price + ' 鼓幣'; b.disabled = pf.coins < price; b.onclick = () => { const q = profLoad(); if (q.coins < price || q.ldOwn.includes(k)) return; q.coins -= price; q.ldOwn.push(k); if (q.ldLoad.length < MAX_MV) q.ldLoad.push(k); profSave(q); synth('pop'); ldMovesRender(); }; }
    else { b.className = on ? '' : 'w'; b.textContent = on ? '帶著（第 ' + (pf.ldLoad.indexOf(k) + 1) + ' 格）・點了放下' : '帶進天梯'; b.disabled = !on && pf.ldLoad.length >= MAX_MV;
      b.onclick = () => { const q = profLoad(); q.ldLoad = on ? q.ldLoad.filter(x => x !== k) : q.ldLoad.concat(k).slice(0, MAX_MV); profSave(q); ldMovesRender(); }; }
    g.appendChild(d);
  }
}
$('ldMvBtn').onclick = () => { $('ldStart').classList.add('hide'); $('ldBoard').classList.add('hide'); $('ldMoves').classList.remove('hide'); ldMovesRender(); };
$('ldMvBack').onclick = () => { $('ldMoves').classList.add('hide'); $('ldBoard').classList.remove('hide'); ldShow('start'); ldStairs(); };
$('ldGo').onclick = startLadder;
$('ldAgain').onclick = startLadder;
$('ldResult').insertAdjacentHTML('beforeend', '<button id="ldHome" class="big alt">換階／招式庫</button>');
$('ldHome').onclick = () => { ldShow('start'); ldStairs(); };
$('ldBack').onclick = () => { ladder.on = false; $('ladder').classList.add('hide'); mode = 'title'; layoutPads(); };

/* ================= 闖關模式：敵人一波一波生出來，過關 3 選 1 強化 =================
   玩家＝光頭老師（三招＋學到的新招 I／O）。敵人各有攻擊模式，第 5、10 關 Boss 鼓子秧歌大師 */
const RG = { on: false, stage: 1, enemies: [], queue: [], spawnT: 0, maxAlive: 2, kills: 0, lastVoice: 0, best: 0 };
const EN = {
  rider: { char: 'rider', hp: 35, spd: 300, ai: 'melee', range: 150, atk: ['dahu'], cd: 2.9 },
  mascot: { char: 'mascot', hp: 55, spd: 220, ai: 'melee', range: 280, atk: ['daqi'], cd: 3.2 },
  auntie: { char: 'auntie', hp: 45, spd: 250, ai: 'ranged', keep: [170, 300], atk: ['scold'], cd: 2.3 },
  trump: { char: 'trump', hp: 50, spd: 210, ai: 'ranged', keep: [380, 560], atk: ['ball'], cd: 2.8 },
  bear: { char: 'bear', hp: 130, spd: 170, ai: 'melee', range: 140, atk: ['bear'], cd: 4.5, heavy: true },
  master: { char: 'master', hp: 420, spd: 270, ai: 'boss', atk: ['shan', 'ball', 'bear'], cd: 1.1, boss: true, heavy: true },
};
function rgWave(n) {
  const W_ = [null,
    ['rider', 'rider', 'rider'],
    ['rider', 'auntie', 'mascot', 'rider'],
    ['auntie', 'trump', 'mascot', 'rider'],
    ['rider', 'trump', 'bear', 'rider', 'mascot'],
    ['master', 'rider', 'rider'],
    ['bear', 'rider', 'trump', 'rider', 'mascot'],
    ['bear', 'trump', 'auntie', 'trump', 'mascot'],
    ['trump', 'bear', 'rider', 'trump', 'rider', 'rider'],
    ['mascot', 'trump', 'auntie', 'mascot', 'bear', 'auntie', 'mascot'],
    ['master', 'bear', 'mascot', 'trump']];
  if (W_[n]) return W_[n].slice();
  const pool = ['rider', 'rider', 'auntie', 'mascot', 'trump', 'trump', 'bear'], out = n % 5 === 0 ? Array(n >= 35 ? 3 : n >= 20 ? 2 : 1).fill('master') : [];
  for (let i = 0; i < 6 + (n - 10); i++) out.push(pool[Math.floor(Math.random() * pool.length)]);
  return out;
}
// 第 15 關的 Boss 會 3 招，之後每 5 關多 1 招，最多 6 招
const bossMoveN = () => Math.max(3, Math.min(6, 3 + Math.floor((RG.stage - 15) / 5)));
function bossMoves(n = bossMoveN()) { // 從原本三招＋30 招裡隨機挑，至少 2 招是攻擊招
  const all = ['shan', 'ball', 'bear', ...MOVE_IDS].sort(() => Math.random() - .5);
  const atk = all.filter(k => ORIG[k] ? k !== 'shan' : ['melee', 'proj', 'grab'].includes(mvCat(k)));
  const out = atk.slice(0, 2); for (const k of all) if (out.length < n && !out.includes(k)) out.push(k);
  return out;
}
// 前幾關敵人打比較輕（第 1 關七折），之後逐關變硬、變痛、出手變快
function rgScale() { return { hp: 1 + .12 * (RG.stage - 1), dmg: .7 + .07 * (RG.stage - 1), cd: Math.max(.55, 1 - .04 * (RG.stage - 1)) }; }
// ---------- 玩家存檔（鼓幣、傳承樹）：先存在這台裝置 ----------
const PROF_KEY = 'ssb_profile';
// 存檔碼：8 碼英數（去掉容易看錯的 0/O/1/I），換手機或清掉資料時用來找回進度
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => CODE_CH[b % 32]).join('');
function profLoad() {
  let p = {}; try { p = JSON.parse(lsGet(PROF_KEY) || '{}'); } catch (e) {}
  p = Object.assign({ coins: 0, tree: {}, runs: 0, coinsEarned: 0, skins: ['teacher'], skin: 'teacher', skin2: '', login: { n: 0, last: '' }, best: {}, ldTop: 0, ldOwn: [], ldLoad: [], ldBest: 0, ach: [] }, p);
  p.st = Object.assign({ play: {}, win: {}, ldWins: 0 }, p.st); // 戰績：各模式打幾場、贏幾場、天梯贏幾關
  // 其他模式／擴充的鎖：新玩家要先打贏電腦一場；改版前就玩過的直接開
  const fresh = p.unl == null; if (fresh) p.unl = Object.values(p.st.play).some(n => n > 0) || p.coinsEarned > 0 || p.ldTop > 0 || !!p.name ? 1 : 0;
  if (p.cpuLv == null) p.cpuLv = (p.st.win.cpu || 0) > 0 ? 2 : 1; // 改版前就贏過電腦的，直接開「中」
  if (!p.code || fresh) { p.code = p.code || genCode(); lsSet(PROF_KEY, JSON.stringify(p)); }
  return p;
}
let profSyncT = 0;
function profSave(p) { achScan(p); p.ts = Date.now(); lsSet(PROF_KEY, JSON.stringify(p)); profSync(); topRefresh(); }
// 存檔備份：存檔後最多 1 分鐘才上傳一次，切走／關掉 App 時馬上補傳（存檔碼當鑰匙；本機存檔照舊即時）
function profSync() { if (!profSyncT) profSyncT = setTimeout(profUpload, 60e3); }
function profUpload() {
  if (!profSyncT) return;
  clearTimeout(profSyncT); profSyncT = 0;
  const p = profLoad(), body = JSON.stringify({ code: p.code, vid: stat.vid, data: p });
  try { if (navigator.sendBeacon('/api/profile', body)) return; } catch (e) {}
  fetch('/api/profile', { method: 'POST', body, keepalive: true }).catch(() => {});
}
addEventListener('visibilitychange', () => { if (document.hidden) profUpload(); });
addEventListener('pagehide', profUpload);
async function profRestore(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) throw new Error('存檔碼是 8 碼英文數字');
  const r = await fetch('/api/profile?code=' + code), d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || '連不上伺服器');
  const data = Object.assign({}, d.data, { code });
  lsSet(PROF_KEY, JSON.stringify(data));
  for (const k in (data.best || {})) lsSet('ssb_rg_best_' + k, data.best[k]);
  if (data.name) lsSet('ssb_name', data.name); // 名字跟著存檔走
  topRefresh();
  return data;
}
const fmtCode = c => c.slice(0, 4) + '-' + c.slice(4);
const TREE = [
  { id: 'hp', name: '老師的底子', desc: '起始血量 +10%', max: 5, cost: [50, 100, 200, 350, 500] },
  { id: 'dmg', name: '練過功', desc: '所有傷害 +5%', max: 5, cost: [50, 100, 200, 350, 500] },
  { id: 'reroll', name: '換一批', desc: '過關選卡時可以重抽（每級多 1 次）', max: 3, cost: [150, 300, 500] },
  { id: 'startMove', name: '帶藝入門', desc: '開局就帶 1 個隨機新招', max: 1, cost: [300] },
  { id: 'pickStart', name: '指定起手', desc: '開局從 3 個新招中挑 1 個帶著（要先學「帶藝入門」）', max: 1, cost: [500], need: 'startMove' },
  { id: 'four', name: '多看一眼', desc: '過關選卡從 3 選 1 變成 4 選 1', max: 1, cost: [600] },
  { id: 'revive', name: '再來一次', desc: '每輪可以原地復活 1 次（回一半血）', max: 1, cost: [800] },
];
const tLv = (prof, id) => prof.tree[id] || 0;
function rgTreeOpen() {
  $('rgTitle').textContent = '傳承樹';
  for (const w of ['rgCardsWrap', 'rgOverWrap', 'rgStartWrap']) $(w).classList.add('hide');
  $('rgTreeWrap').classList.remove('hide'); $('rgPanel').classList.remove('hide');
  rgTreeRender();
}
function rgTreeRender() {
  const prof = profLoad(); $('rgTreeCoins').textContent = prof.coins; $('rgTreeCode').textContent = fmtCode(prof.code);
  const box = $('rgTree'); box.textContent = '';
  for (const t of TREE) {
    const lv = tLv(prof, t.id), maxed = lv >= t.max, cost = maxed ? 0 : t.cost[lv], locked = t.need && !tLv(prof, t.need);
    const d = document.createElement('div'); d.className = 'tNode' + (maxed ? ' max' : '');
    d.innerHTML = '<span class="lv"></span><div class="n"></div><div class="d"></div><button></button>';
    d.querySelector('.lv').textContent = 'Lv ' + lv + ' / ' + t.max;
    d.querySelector('.n').textContent = t.name; d.querySelector('.d').textContent = t.desc;
    const b = d.querySelector('button');
    b.textContent = maxed ? '已滿級' : locked ? '先學「帶藝入門」' : '升級　' + cost + ' 鼓幣';
    b.disabled = maxed || locked || prof.coins < cost;
    b.onclick = () => { const p = profLoad(); if (p.coins < cost) return; p.coins -= cost; p.tree[t.id] = lv + 1; profSave(p); synth('pop'); rgTreeRender(); };
    box.appendChild(d);
  }
}
$('rgTreeBtn').onclick = rgTreeOpen;
$('rgTreeBtn2').onclick = rgTreeOpen;
$('rgTreeBack').onclick = () => { $('rgTreeWrap').classList.add('hide'); if (mode === 'rgOver') { $('rgOverWrap').classList.remove('hide'); $('rgTitle').textContent = '闖關結束（' + RG_DIFF[RG.diff].name + '）'; } else rgOpen(); };

// 難度：困難＝原本的設定；簡單／中等加強自己、削弱敵人、過關多回血
const RG_DIFF = {
  easy: { name: '簡單', pHp: 1.6, pDmg: 1.4, eHp: .65, eDmg: .5, heal: 1, desc: '自己血量 ×1.6、傷害 ×1.4｜敵人血量 ×0.65、傷害 ×0.5｜過關回滿血' },
  normal: { name: '中等', pHp: 1.4, pDmg: 1.25, eHp: .75, eDmg: .62, heal: .6, desc: '自己血量 ×1.4、傷害 ×1.25｜敵人血量 ×0.75、傷害 ×0.62｜過關回 60% 血' },
  hard: { name: '困難', pHp: 1, pDmg: 1, eHp: 1, eDmg: 1, heal: .25, desc: '原本的難度｜過關回 25% 血' },
};
// 闖關存檔：每關開打、每次過關選卡時存一份；手機 App 在背景被系統關掉，回來可以從那一關接著打
const RG_SAVE = 'ssb_rg_run';
function rgSave(pick) {
  if (!RG.on || !p1 || !p1.mods) return;
  lsSet(RG_SAVE, JSON.stringify({ v: 1, diff: RG.diff, stage: RG.stage, pick: !!pick, kills: RG.kills, rerolls: RG.rerolls, revives: RG.revives, bosses: RG.bosses,
    dur: Math.round((performance.now() - RG.t0) / 1000), hp: Math.max(1, Math.round(p1.hp)), maxHp: p1.maxHp, mods: p1.mods, extra: p1.extra, mvMods: p1.mvMods || {}, at: Date.now() }));
}
function rgSaved() { try { const s = JSON.parse(lsGet(RG_SAVE) || 'null'); return s && s.v === 1 && RG_DIFF[s.diff] && s.stage >= 1 ? s : null; } catch (e) { return null; } }
function rgApply(s) {
  Object.assign(p1.mods, s.mods); p1.maxHp = s.maxHp; p1.hp = Math.min(s.hp, s.maxHp); p1.shanCh = p1.mods.shanMax || 1;
  p1.extra = s.extra.filter(k => MOVES[k]); p1.mvMods = s.mvMods; for (const k of p1.extra) p1.mvcd[k] = 0;
  Object.assign(RG, { stage: s.stage, kills: s.kills, rerolls: s.rerolls, revives: s.revives, bosses: s.bosses }); RG.t0 = performance.now() - s.dur * 1000;
  if (s.pick) rgOpenCards(); else rgStage();
  layoutPads();
}
function rgStart(diff = RG.diff || 'normal', sv = null) {
  RG.diff = diff; const D = RG_DIFF[diff]; if (!sv) lsSet(RG_SAVE, '');
  ladder.on = false; netLeave(); vsCPU = true; RG.on = true; RG.stage = 1; RG.kills = 0;
  p1 = new Fighter('p1', W / 2, 1); p1.char = profLoad().skin || 'teacher';
  p1.mods = { dmg: D.pDmg, cdMul: 1, spd: 1, ls: 0, pierce: 0, multi: 0, ballBig: 1, shanMax: 1, shanQuake: false, bearRate: 1, taken: {},
    shanCut: false, bearRange: 1, bearArmor: false, stunRes: 1, kbRes: 1, noLaunch: false, tenacity: 0, escape: false, dmgTaken: 1, angry: 0, regen: 0, lowhp: false, crit: 0, killcd: 0 };
  const prof = profLoad(); RG.prof = prof; // 傳承樹：永久強化
  p1.mods.dmg *= 1 + .05 * tLv(prof, 'dmg');
  p1.maxHp = Math.round(200 * D.pHp * (1 + .1 * tLv(prof, 'hp'))); p1.hp = p1.maxHp; p1.shanCh = 1; p1.extra = []; p1.mvMods = {}; RG.t0 = performance.now();
  RG.rerolls = tLv(prof, 'reroll'); RG.revives = tLv(prof, 'revive'); RG.bosses = 0; RG.cardN = tLv(prof, 'four') ? 4 : 3;
  p2 = new Fighter('p2', -999, -1); p2.ko = true; // 一打多模式不用 p2，放一個假的讓舊程式不出錯
  RG.best = +lsGet('ssb_rg_best_' + diff) || 0;
  $('rgPanel').classList.add('hide');
  RG.stage = 1; RG.enemies = []; RG.queue = []; balls = []; stat.start('rogue', null);
  if (sv) { rgApply(sv); return; } // 接續存檔
  if (tLv(prof, 'pickStart')) { rgStartPick(); return; } // 先挑起手招
  if (tLv(prof, 'startMove')) { const k = LEARNABLE[Math.floor(Math.random() * LEARNABLE.length)]; p1.extra.push(k); p1.mvcd[k] = 0; }
  rgStage(); layoutPads();
}
function rgStage() {
  RG.enemies = []; RG.queue = rgWave(RG.stage); RG.spawnT = .6; RG.maxAlive = Math.min(2 + Math.floor(RG.stage / 3), 4) + Math.max(0, RG.queue.filter(k => k === 'master').length - 1); RG.echo = [];
  balls = []; ghosts = []; fx = []; captions = []; stopChant();
  Object.assign(p1, { x: W / 2, y: 0, vx: 0, vy: 0, act: null, stun: 0, inv: 0, guardT: 0, ko: false, win: false });
  const nb = RG.queue.filter(k => k === 'master').length;
  rgSave();
  mode = 'rgIntro'; stateT = 0; banner = { text: '第 ' + RG.stage + ' 關', sub: nb ? 'BOSS：鼓子秧歌大師' + (nb > 1 ? ' ×' + nb : '') + (RG.stage > 10 ? '（每隻會 ' + bossMoveN() + ' 招，隨機）' : '！') : '敵人 ' + RG.queue.length + ' 隻', t: 0 };
}
function rgSpawn(kind) {
  const d = EN[kind], sc = rgScale(), side = Math.random() < .5 ? -1 : 1;
  const e = new Fighter('p2', side < 0 ? 90 : W - 90, -side);
  e.char = d.char; e.kind = kind; e.boss = !!d.boss; e.heavy = !!d.heavy;
  e.atk = e.boss && RG.stage > 10 ? bossMoves() : d.atk;
  const D = RG_DIFF[RG.diff || 'hard'], twin = e.boss && RG.enemies.some(o => o.boss) ? .75 : 1; // 第二、三隻 Boss 血少一點
  e.maxHp = Math.round(d.hp * sc.hp * D.eHp * twin); e.hp = e.maxHp; e.hpShow = e.hp;
  e.baseSpd = d.spd / SPEED; e.dmgMul = sc.dmg * D.eDmg;
  e.ai = { inp: { L: false, R: false, U: false, Up: false, S1: false, S2: false, S3: false }, cool: .8 + Math.random() * .8, think: 0, want: 0 };
  RG.enemies.push(e);
  fx.push({ type: 'ring', x: e.x, color: e.boss ? '#ff6b6b' : '#ffffff', t: 0 });
  if (e.boss) { caption(e, RG.stage > 10 ? e.atk.map(skName).join('、') : '鼓子秧歌大師'); synth('gong'); shake = 10; }
}
function rgFoes(ft) { return ft === p1 ? RG.enemies.filter(e => !e.ko) : [p1]; }
function rgNearest(ft) {
  let best = null, bd = 1e9;
  for (const e of rgFoes(ft)) { const d = Math.abs(e.x - ft.x); if (d < bd) { bd = d; best = e; } }
  return best;
}
// Boss 挑招：看距離、看玩家在幹嘛
function bossPick(e, dist, ballIn, foe = p1) {
  const ok = [];
  for (const k of e.atk) {
    if (ORIG[k]) {
      if (k === 'bear' && dist < 170 && e.cd.bear <= 0) ok.push(k, k);
      if (k === 'ball' && dist > 280 && e.cd.ball <= 0 && e.grounded) ok.push(k, k);
      if (k === 'shan' && dist > 500 && e.cd.shan <= 0) ok.push(k);
      continue;
    }
    if (e.mvcd[k] > 0 || !e.grounded) continue;
    if (MOVES[k].ev.some(v => v.bolt)) { if (dist < 700) ok.push(k, k, k); continue; } // 閃電五連鞭：中遠距離都能放
    const cat = mvCat(k);
    if (cat === 'guard') { if (ballIn || (foe.act && dist < 260)) ok.push(k, k, k); }
    else if (cat === 'buff') { if (dist > 250 && Math.random() < .25) ok.push(k); }
    else if (cat === 'proj') { if (dist > 200) ok.push(k, k); }
    else if (dist <= mvReach(k)) ok.push(k, k);
  }
  return ok.length ? ok[Math.floor(Math.random() * ok.length)] : null;
}
// 敵人的腦袋：決定往哪走、什麼時候出招
function rgThink(e, dt) {
  const a = e.ai, d = EN[e.kind], inp = a.inp;
  a.cool -= dt; a.think -= dt;
  if (!e.canAct() || p1.ko) { inp.L = inp.R = false; return; }
  const dx = p1.x - e.x, dist = Math.abs(dx), dir = Math.sign(dx) || 1;
  const ballIn = balls.find(b => b.owner === p1 && Math.sign(e.x - b.x) === Math.sign(b.vx) && Math.abs(e.x - b.x) < 360 && Math.abs(b.y - (GROUND - e.y - 130)) < 160);
  if (d.ai === 'boss') {
    if (ballIn && e.atk.includes('shan') && e.cd.shan <= 0 && Math.random() < .7) { doSkill(e, p1, { L: false, R: false, U: Math.random() < .6 }, 'shan'); return; }
    if (a.cool <= 0 || (ballIn && a.cool < .6)) {
      const k = bossPick(e, dist, ballIn);
      if (k) {
        e.face = dir;
        if (k === 'shan') { doSkill(e, p1, { L: false, R: false, U: false }, 'shan'); a.cool = .6; }
        else { if (ORIG[k]) doSkill(e, p1, inp, k); else doMove(e, p1, k); a.cool = d.cd * rgScale().cd; }
        return;
      }
    }
  }
  if (a.think <= 0) { // 走位每 0.15 秒想一次，看起來比較像人
    a.think = .12 + Math.random() * .08;
    if (d.ai === 'ranged') a.want = dist < d.keep[0] ? -dir : dist > d.keep[1] ? dir : 0;
    else if (d.ai === 'boss') a.want = dist > 220 ? dir : dist < 110 ? -dir : 0;
    else a.want = dist > d.range * .75 ? dir : 0;
  }
  inp.L = a.want < 0; inp.R = a.want > 0;
  if (a.cool <= 0 && d.ai !== 'boss' && Math.abs(p1.y - e.y) < 130 && e.grounded) {
    const reach = d.ai === 'ranged' ? 900 : d.range;
    if (dist <= reach) {
      const k = d.atk[Math.floor(Math.random() * d.atk.length)];
      e.face = dir;
      if (MOVES[k]) doMove(e, p1, k); else doSkill(e, p1, inp, k);
      a.cool = d.cd * rgScale().cd * (.8 + Math.random() * .5);
    }
  }
}
function rgUpdate(dt) {
  stateT += dt;
  for (const c of captions) c.t += dt; captions = captions.filter(c => c.t < 1.3);
  for (const g of ghosts) g.t += dt; ghosts = ghosts.filter(g => g.t < g.life);
  for (const e of fx) e.t += dt; fx = fx.filter(e => e.t < fxLife(e));
  if (mode === 'rgIntro') { if (stateT > 1.5) { mode = 'fight'; banner = null; } return; }
  if (mode === 'rgPick' || mode === 'rgOver') return;
  if (mode === 'rgClear') { if (stateT > 1.6) rgOpenCards(); return; }
  if (hitstop > 0) { hitstop -= dt; return; }
  // 生怪
  const alive = RG.enemies.filter(e => !e.ko).length;
  RG.spawnT -= dt;
  if (RG.queue.length && RG.spawnT <= 0 && alive < RG.maxAlive) { rgSpawn(RG.queue.shift()); RG.spawnT = 1.4 + Math.random(); }
  for (const e of RG.enemies) if (!e.ko) rgThink(e, dt);
  updateFighter(p1, rgNearest(p1) || p1, dt);
  for (const e of RG.enemies) { updateFighter(e, p1, dt); if (e.ko) e.koT = (e.koT || 0) + dt; }
  // 互推：玩家跟敵人、敵人之間
  const all = [p1, ...RG.enemies.filter(e => !e.ko)];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const A = all[i], B = all[j], dx = B.x - A.x;
    if (Math.abs(dx) < 50 && Math.abs(A.y - B.y) < 150 && !(A.act && A.act.ghost) && !(B.act && B.act.ghost)) {
      const push = (50 - Math.abs(dx)) / 2 * (Math.sign(dx) || 1);
      A.x = clampX(A.x - push); B.x = clampX(B.x + push);
    }
  }
  // 飛行道具：玩家的球打敵人（可穿透），敵人的球打玩家
  for (const b of balls) {
    b.t += dt; b.x += b.vx * dt; b.spin += dt * 18 * Math.sign(b.vx);
    if (b.g) { b.vy += b.g * dt; b.y += b.vy * dt; if (b.y > GROUND - 8) b.dead = true; }
    else if (b.kind !== 'wave') b.y += Math.sin(b.t * 14) * .6;
    const R = b.r || 15;
    for (const tgt of rgFoes(b.owner)) {
      if (b.dead || (b.hitSet && b.hitSet.includes(tgt))) continue;
      const hb = hurtbox(tgt);
      if (b.x > hb.x0 - R && b.x < hb.x1 + R && b.y > hb.y0 && b.y < hb.y1 + 10) {
        const r = applyHit(b.owner, tgt, b.dmg || 16, b.stun || .42, Math.sign(b.vx) * (b.kbv || 260), 'ball');
        if (r === 'reflect') { b.owner = tgt; b.vx = -b.vx; b.hitSet = []; if (tgt.guard && tgt.guard.rmul > 1) b.dmg = (b.dmg || 16) * tgt.guard.rmul; }
        else if (r === 'pass') continue;
        else if (r) { if (b.pierce > 0 && r === true) { b.pierce--; (b.hitSet = b.hitSet || []).push(tgt); } else b.dead = true; }
      }
    }
  }
  balls = balls.filter(b => !b.dead && !(b.life && b.t > b.life) && b.x > -60 && b.x < W + 60);
  // 餘震：新招強化「再打一次」
  for (const q of RG.echo) { q.t -= dt; if (q.t <= 0 && !q.done) { q.done = true; if (!q.ft.ko) { fx.push({ type: 'ring', x: q.ft.x, color: '#ffe36b', t: 0 }); for (const tg of rgFoes(q.ft)) moveHit(q.ft, tg, q.h); } } }
  RG.echo = RG.echo.filter(q => !q.done);
  if (p1.mods.regen && !p1.ko) p1.hp = Math.min(p1.maxHp, p1.hp + p1.maxHp * p1.mods.regen * dt);
  // 倒下的敵人淡出後移除、算擊倒
  for (const e of RG.enemies) if (e.ko && !e.counted) {
    e.counted = true; RG.kills++; if (e.boss) { RG.bosses++; shake = 14; synth('gong'); }
    if (p1.mods.killcd) { for (const k in p1.cd) p1.cd[k] = Math.max(0, p1.cd[k] - p1.mods.killcd); for (const k in p1.mvcd) p1.mvcd[k] = Math.max(0, p1.mvcd[k] - p1.mods.killcd); }
  }
  RG.enemies = RG.enemies.filter(e => !(e.ko && e.koT > 1.4));
  if (p1.ko && RG.revives > 0 && (p1.koT || 0) > .8) { // 傳承「再來一次」：原地復活
    RG.revives--; Object.assign(p1, { ko: false, koT: undefined, hp: Math.round(p1.maxHp / 2), stun: 0, act: null, inv: 2, vy: 0 });
    banner = { text: '再來一次！', sub: '復活，回一半血', t: 0 }; synth('gong'); fx.push({ type: 'ring', x: p1.x, color: '#8fffb0', t: 0 });
    setTimeout(() => { if (banner && banner.text === '再來一次！') banner = null; }, 1400);
  }
  if (p1.ko) { p1.koT = (p1.koT || 0) + dt; if (p1.koT > 1.2) rgGameOver(); return; }
  if (!RG.queue.length && !RG.enemies.length) {
    mode = 'rgClear'; stateT = 0; stopChant(); synth('gong');
    const heal = RG_DIFF[RG.diff].heal; // 過關回血：依難度
    p1.hp = Math.min(p1.maxHp, p1.hp + Math.round(p1.maxHp * heal));
    banner = { text: '過關！', sub: heal >= 1 ? '血量回滿' : '回復 ' + Math.round(heal * 100) + '% 血量', t: 0 };
  }
}
// ---------- 3 選 1 強化 ----------
const LEARNABLE = MOVE_IDS.slice(); // 30 招全部學得到
const MAX_MV = 10; // 新招欄最多 10 招，滿了可以換
const slotKey = i => '1234567890'[i];
const UPG = [
  { id: 'dmg', name: '力氣變大', desc: '所有招式傷害 +25%', max: 5, apply: m => { m.dmg *= 1.25; } },
  { id: 'cd', name: '喘口氣就好', desc: '所有冷卻 −15%', max: 4, apply: m => { m.cdMul *= .85; } },
  { id: 'spd', name: '碎步加速', desc: '移動速度 +20%', max: 3, apply: m => { m.spd *= 1.2; } },
  { id: 'hp', name: '吃飽一點', desc: '最大血量 +40，並回滿血', max: 5, apply: (m, ft) => { ft.maxHp += 40; ft.hp = ft.maxHp; } },
  { id: 'ls', name: '吸收民氣', desc: '打到人時，傷害的 12% 變成自己的血', max: 3, apply: m => { m.ls += .12; } },
  { id: 'pierce', name: '浪子穿心', desc: '浪子踢球可穿透 +1 個敵人', max: 3, apply: m => { m.pierce++; } },
  { id: 'multi', name: '一腳兩球', desc: '浪子踢球多踢出一顆（上下各一）', max: 2, apply: m => { m.multi++; } },
  { id: 'big', name: '大顆足球', desc: '足球變大 40%，擊退更遠', max: 2, apply: m => { m.ballBig *= 1.4; } },
  { id: 'shan2', name: '閃身步連發', desc: '閃身步可以多存一次，連續閃', max: 2, apply: (m, ft) => { m.shanMax++; ft.shanCh++; } },
  { id: 'shanq', name: '閃身震地', desc: '閃身步落地時震傷身邊的敵人', max: 1, apply: m => { m.shanQuake = true; } },
  { id: 'bear', name: '熊抖更快', desc: '狗熊哆嗦毛打擊頻率 +40%', max: 3, apply: m => { m.bearRate *= 1.4; } },
  { id: 'shanCut', name: '殘影刀', desc: '閃身步穿過的敵人都會被殘影砍一下', max: 1, apply: m => { m.shanCut = true; } },
  { id: 'bearBig', name: '熊抱', desc: '狗熊哆嗦毛攻擊範圍 +40%', max: 2, apply: m => { m.bearRange *= 1.4; } },
  { id: 'bearArm', name: '熊皮厚', desc: '狗熊哆嗦毛期間受傷減半、不會被打斷', max: 1, apply: m => { m.bearArmor = true; } },
  // 解控／防禦：闖關最怕被一群人控到死
  { id: 'tough', tag: '解控', name: '筋骨硬朗', desc: '被暈的時間 −25%', max: 3, apply: m => { m.stunRes *= .75; } },
  { id: 'tumbler', tag: '解控', name: '不倒翁', desc: '暈完之後 1.5 秒內不會再被暈（再拿 +1 秒）', max: 2, apply: m => { m.tenacity += m.tenacity ? 1 : 1.5; } },
  { id: 'escape', tag: '解控', name: '金蟬脫殼', desc: '被暈的時候按閃身步直接掙脫（每 6 秒一次，不花次數）', max: 1, apply: m => { m.escape = true; } },
  { id: 'steady', tag: '解控', name: '定海神針', desc: '被擊退的距離 −50%，不會被打飛到空中', max: 1, apply: m => { m.kbRes = .5; m.noLaunch = true; } },
  { id: 'thick', tag: '防禦', name: '皮厚', desc: '受到的傷害 −10%', max: 3, apply: m => { m.dmgTaken *= .9; } },
  { id: 'angry', tag: '防禦', name: '越挫越勇', desc: '每次被打中，所有招式冷卻 −0.4 秒', max: 2, apply: m => { m.angry += .4; } },
  { id: 'regen', tag: '防禦', name: '氣定神閒', desc: '每秒回復 1% 最大血量', max: 2, apply: m => { m.regen += .01; } },
  { id: 'lowhp', name: '背水一戰', desc: '血量低於 35% 時，傷害 +40%', max: 1, apply: m => { m.lowhp = true; } },
  { id: 'crit', name: '會心一擊', desc: '15% 機率打出兩倍傷害', max: 3, apply: m => { m.crit += .15; } },
  { id: 'killcd', name: '打一個喘一口', desc: '每擊倒一個敵人，所有冷卻 −1 秒', max: 2, apply: m => { m.killcd += 1; } },
];
// 30 招各自的專屬強化（每招 3 種，另外每招都有「威力」「冷卻」兩張）
const U = (name, desc, max, apply, tag) => ({ name, desc, max, apply, tag });
const PANIC = (name) => U(name, '被暈的時候也能用，直接解除暈眩（解控）', 1, x => { x.panic = true; }, '解控');
const MV_UP = {
  dahu: [U('猛虎下山', '突進距離 +40%、擊退 +50%', 2, x => { x.dash *= 1.4; x.kb *= 1.5; }), U('打到底', '打中後再補一掌（60% 傷害）', 2, x => { x.echo += .6; }), U('虎威', '打中暈眩 +60%', 2, x => { x.stun *= 1.6; })],
  fengbai: [U('柳枝更長', '退得更遠 +40%', 2, x => { x.dash *= 1.4; }), U('擺回來打一圈', '退完順手打身邊一圈（10 傷害、暈 0.6 秒）', 1, x => { x.trail = true; }), U('隨風不倒', '用完 2 秒內不會再被控', 1, x => { x.cleanse = 2; }, '解控')],
  pingchou: [U('抽得更開', '範圍 +40%', 2, x => { x.area *= 1.4; }), U('連抽', '可以存 2 次連續用', 2, x => { x.ch++; }), U('抽血', '打中回復傷害 30% 的血', 2, x => { x.ls += .3; })],
  fenshou: [U('鐵臂', '格擋時間 +60%', 2, x => { x.dur *= 1.6; }), U('護體回春', '每擋下一次攻擊回 8 血', 2, x => { x.gheal += 8; }), PANIC('緊急護頭')],
  xiaolun: [U('掄不停', '每一下都多震一次（50% 傷害）', 2, x => { x.echo += .5; }), U('掄成風車', '範圍 +40%，前後都打得到', 1, x => { x.area *= 1.4; x.both = true; }), U('掄到暈', '暈眩 +50%', 2, x => { x.stun *= 1.5; })],
  dalun: [U('掀更高', '掀飛高度 +60%、擊退 +40%', 2, x => { x.launch *= 1.6; x.kb *= 1.4; }), U('地裂', '砸地之後再震一次（80% 傷害）', 2, x => { x.echo += .8; }), U('雙掄', '可以存 2 次連續用', 1, x => { x.ch++; })],
  cheshui: [U('水車加速', '衝刺距離 +50%', 2, x => { x.dash *= 1.5; }), U('水來土掩', '推進時霸體 1 秒（受傷減半、不會被打斷）', 1, x => { x.shield = 1; }), U('越推越猛', '擊退 +80%', 2, x => { x.kb *= 1.8; })],
  xieta: [U('反彈加倍', '反彈回去的球傷害 ×2', 2, x => { x.rmul *= 2; }), U('反彈不停', '反彈或擋下成功，冷卻直接歸零', 1, x => { x.reset = true; }), PANIC('緊急傾斜')],
  baishi: [U('詐敗', '反擊傷害 +60%', 2, x => { x.dmg *= 1.6; }), U('敗中求勝', '反擊打到身邊所有敵人', 1, x => { x.aoe = true; }), U('再敗一次', '反擊成功，冷卻直接歸零', 1, x => { x.reset = true; })],
  yaozhong: [U('一次盤一排', '抓範圍內所有敵人', 1, x => { x.multi = true; }), U('甩更遠', '甩出去的擊退 ×2、暈 +50%', 2, x => { x.kb *= 2; x.stun *= 1.5; }), U('盤得更遠', '抓取距離 +60%', 2, x => { x.area *= 1.6; })],
  guabian: [U('長鞭', '鞭子範圍 +40%', 2, x => { x.area *= 1.4; }), U('連甩', '可以存 2 次連續用', 2, x => { x.ch++; }), U('抽筋', '打中暈眩 +60%', 2, x => { x.stun *= 1.6; })],
  liaowang: [U('遠眺', '加速效果 ×1.5、時間 +50%', 2, x => { x.power *= 1.5; x.dur *= 1.5; }), U('眼觀四方', '使用後 4 秒內不會被控', 1, x => { x.cleanse = 4; }, '解控'), U('腳底抹油', '加速期間飛行道具打不到', 1, x => { x.dodge = true; })],
  lisao: [U('掃得更遠', '範圍 +40%', 2, x => { x.area *= 1.4; }), U('掃倒爬不起', '暈眩 +60%', 2, x => { x.stun *= 1.6; }), U('連環掃', '掃完再掃一次（70% 傷害）', 2, x => { x.echo += .7; })],
  shuangchao: [U('花開並蒂', '一次多丟一朵花', 2, x => { x.extra++; }), U('穿花', '花可以穿過 2 個敵人', 2, x => { x.pierce += 2; }), U('大朵花', '花變大 50%、擊退更遠', 2, x => { x.big *= 1.5; })],
  biandan: [U('挑得更久', '免控時間 +40%', 2, x => { x.dur *= 1.4; }), U('輕挑', '冷卻 −25%', 2, x => { x.cd *= .75; }), PANIC('隨時挑起')],
  shizi: [U('獅吼更遠', '範圍 +40%', 2, x => { x.area *= 1.4; }), U('震暈更久', '暈眩 +50%', 2, x => { x.stun *= 1.5; }), U('雙吼', '吼完再吼一次（80% 傷害）', 1, x => { x.echo += .8; })],
  chayao: [U('回更多', '回血量 +60%', 2, x => { x.power *= 1.6; }), U('得意不怕打', '叉腰時霸體 1.4 秒', 1, x => { x.shield = 1.4; }), U('叉腰淨身', '被暈也能用，用了 2 秒內免控', 1, x => { x.panic = true; x.cleanse = 2; }, '解控')],
  zhuafen: [U('長手', '抓取距離 +50%', 2, x => { x.area *= 1.5; }), U('抓過來就暈', '抓到後暈眩 +80%', 2, x => { x.stun *= 1.8; }), U('一把抓', '把範圍內所有敵人一起拉過來', 1, x => { x.multi = true; })],
  xiachuan: [U('穿更遠', '往前穿的距離 +40%', 2, x => { x.dash *= 1.4; }), U('一拳升天', '掀飛 +50%、暈眩 +40%', 2, x => { x.launch *= 1.5; x.stun *= 1.4; }), U('全程無敵', '整招無敵', 1, x => { x.inv = true; })],
  shanhong: [U('洪水滔天', '擊退 +60%、範圍 +20%', 2, x => { x.kb *= 1.6; x.area *= 1.2; }), U('山洪連發', '可以存 2 次連續用', 2, x => { x.ch++; }), U('餘波', '推完再一波（60% 傷害）', 2, x => { x.echo += .6; })],
  zaiquan: [U('腿更長', '範圍 +40%', 2, x => { x.area *= 1.4; }), U('第三段', '兩段打完再補一段（60% 傷害）', 1, x => { x.echo += .6; }), U('栽暈', '暈眩 +60%', 2, x => { x.stun *= 1.6; })],
  sandian: [U('鐵頭', '暈眩 +50%', 2, x => { x.stun *= 1.5; }), U('點頭前進', '往前推的距離 +60%', 2, x => { x.dash *= 1.6; }), U('點頭吸血', '打中回復傷害 30% 的血', 2, x => { x.ls += .3; })],
  laoying: [U('俯衝震地', '落地範圍 +50%', 2, x => { x.area *= 1.5; }), U('鷹擊長空', '整招無敵', 1, x => { x.inv = true; }), U('雙翅', '可以存 2 次連續用', 1, x => { x.ch++; })],
  feiji: [U('渦輪', '往前衝的距離 +40%', 2, x => { x.dash *= 1.4; }), U('螺旋吸入', '打中的敵人會被吸過來', 1, x => { x.pull = true; }), U('吸血輪', '打中回復傷害 25% 的血', 2, x => { x.ls += .25; })],
  yunbu: [U('騰雲', '滑行距離 +50%', 2, x => { x.dash *= 1.5; }), U('雲裡打人', '穿過去之後打身邊一圈', 1, x => { x.trail = true; }), PANIC('雲裡脫身')],
  yipen: [U('花開更大', '範圍 +40%', 2, x => { x.area *= 1.4; }), U('落地開花', '轉完再炸一次（80% 傷害）', 2, x => { x.echo += .8; }), U('轉兩圈', '可以存 2 次連續用', 1, x => { x.ch++; })],
  chengu: [U('三道地波', '每邊多送一道地波', 2, x => { x.extra++; }), U('地波穿透', '地波可以穿過 2 個敵人', 2, x => { x.pierce += 2; }), U('波大浪高', '地波變大 50%、暈眩 +40%', 2, x => { x.big *= 1.5; x.stun *= 1.4; })],
  daqi: [U('鶴立', '落地範圍 +40%', 2, x => { x.area *= 1.4; }), U('震地', '落地再震一次（70% 傷害）', 2, x => { x.echo += .7; }), U('空中無敵', '整招無敵', 1, x => { x.inv = true; })],
  pinghu: [U('格開更久', '格擋時間 +60%、震住更久', 2, x => { x.dur *= 1.6; x.stun *= 1.3; }), U('一震全場', '格開的瞬間，身邊所有敵人都被震住', 1, x => { x.aoe = true; }), PANIC('緊急平護')],
  duochan: [U('震幅更大', '範圍 +40%', 2, x => { x.area *= 1.4; }), U('跺到發麻', '暈眩 +60%', 2, x => { x.stun *= 1.6; }), U('跺地吸血', '打中回復傷害 25% 的血', 2, x => { x.ls += .25; })],
};
// 學到的新招專屬強化卡：威力、冷卻＋這招自己的 3 種
function mvCards() {
  const out = [], m = p1.mods;
  for (const k of p1.extra) {
    const nm = MOVES[k].name, ev = MOVES[k].ev;
    const hurts = ev.some(e => e.hit || e.proj || e.grab || (e.guard && (e.dmg || e.pdmg))); // 不會打人的招不給「威力」
    const list = [
      ...(hurts ? [{ id: 'mv_' + k + '_dmg', max: 3, name: '威力 +40%', desc: '這招的傷害 +40%', apply: x => { x.dmg *= 1.4; } }] : []),
      ...(MOVES[k].cd > 1.5 ? [{ id: 'mv_' + k + '_cd', max: 2, name: '冷卻 −30%', desc: '這招可以更常用', apply: x => { x.cd *= .7; } }] : []), // 已經很短的不再砍
      ...MV_UP[k].map((u, i) => Object.assign({ id: 'mv_' + k + '_s' + i }, u)),
    ];
    for (const c of list) if ((m.taken[c.id] || 0) < c.max) out.push(Object.assign({}, c, { mv: k, name: nm + '：' + c.name, tag: c.tag || '新招強化' }));
  }
  return out.sort(() => Math.random() - .5);
}
function rgCardOptions() {
  const m = p1.mods, opts = [];
  const pool = UPG.filter(u => (m.taken[u.id] || 0) < u.max).sort(() => Math.random() - .5);
  const mc = mvCards();
  if (mc.length) { opts.push(mc.shift()); pool.push(...mc.slice(0, 2)); pool.sort(() => Math.random() - .5); } // 學了新招：保證至少一張它的強化
  const can = LEARNABLE.filter(k => !p1.extra.includes(k)), full = p1.extra.length >= MAX_MV;
  if (can.length && (!full || Math.random() < .5)) { // 招式欄沒滿一定有「學新招」；滿了一半機率出現「換新招」
    const k = can[Math.floor(Math.random() * can.length)];
    opts.push({ id: 'learn', mv: k, tag: full ? '換招' : '新招', name: (full ? '換新招：' : '學新招：') + MOVES[k].name,
      desc: MOVES[k].desc + (full ? '（招式欄滿了，選了要換掉一招）' : `（${isTouch ? '新招鈕' : slotKey(p1.extra.length) + ' 鍵'}，冷卻 ${MOVES[k].cd} 秒）`) });
  }
  while (opts.length < (RG.cardN || 3) && pool.length) opts.push(pool.shift());
  return opts;
}
function rgStartPick() { // 指定起手：3 個新招挑 1
  mode = 'rgPick'; RG.startPick = true;
  RG.cards = LEARNABLE.slice().sort(() => Math.random() - .5).slice(0, 3).map(k => ({ id: 'learn', mv: k, tag: '起手招', name: '起手招：' + MOVES[k].name, desc: MOVES[k].desc + '（' + (isTouch ? '新招鈕' : '1 鍵') + '，冷卻 ' + MOVES[k].cd + ' 秒）' }));
  rgShowCards('選一個起手招帶進闖關');
}
function rgOpenCards() {
  mode = 'rgPick'; banner = null; RG.startPick = false;
  RG.cards = rgCardOptions(); rgSave(true);
  rgShowCards('第 ' + RG.stage + ' 關過關！選一個強化');
}
function rgShowCards(title) {
  const box = $('rgCards'); box.textContent = '';
  RG.cards.forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'rgCard' + (RG.cards.length > 4 ? ' small' : '') + (c.tag === '解控' ? ' cc' : c.mv ? ' mv' : '');
    b.innerHTML = `<b>${i < 10 ? slotKey(i) : ''}${c.tag ? '｜' + c.tag : ''}</b><span class="t"></span><span class="d"></span>`;
    b.querySelector('.t').textContent = c.name; b.querySelector('.d').textContent = c.desc;
    b.onclick = () => rgPick(i); box.appendChild(b);
  });
  $('rgTitle').textContent = title;
  const rr = $('rgReroll'); rr.classList.toggle('hide', RG.startPick || !RG.rerolls); rr.textContent = '🎲 換一批（剩 ' + RG.rerolls + ' 次）';
  for (const w of ['rgOverWrap', 'rgStartWrap', 'rgTreeWrap']) $(w).classList.add('hide');
  $('rgCardsWrap').classList.remove('hide'); $('rgPanel').classList.remove('hide');
}
$('rgReroll').onclick = () => { if (mode !== 'rgPick' || RG.startPick || RG.rerolls <= 0) return; RG.rerolls--; synth('whoosh'); rgOpenCards(); };
function rgPick(i) {
  const c = RG.cards && RG.cards[i]; if (!c || mode !== 'rgPick') return;
  if (c.id === 'learn' && p1.extra.length >= MAX_MV) { // 招式欄滿了：選一招換掉
    RG.newMv = c.mv; RG.cards = p1.extra.map((k, j) => {
      const lv = Object.keys(p1.mods.taken).filter(t => t.startsWith('mv_' + k + '_')).reduce((a, t) => a + p1.mods.taken[t], 0);
      return { id: 'replace', slot: j, tag: '換掉', name: MOVES[k].name + (lv ? ' +' + lv : ''), desc: lv ? '這招的強化會一起消失' : '還沒強化過' };
    }).concat({ id: 'keep', name: '算了，不換', desc: '保留現在的 10 招' });
    rgShowCards('要用「' + MOVES[c.mv].name + '」換掉哪一招？'); $('rgReroll').classList.add('hide'); return;
  }
  if (c.id === 'learn') { p1.extra.push(c.mv); p1.mvcd[c.mv] = 0; }
  else if (c.id === 'keep') {}
  else if (c.id === 'replace') {
    const old = p1.extra[c.slot]; p1.extra[c.slot] = RG.newMv; p1.mvcd[RG.newMv] = 0;
    delete p1.mvMods[old]; if (p1.mvCh) delete p1.mvCh[old];
    for (const t of Object.keys(p1.mods.taken)) if (t.startsWith('mv_' + old + '_')) delete p1.mods.taken[t];
  }
  else if (c.mv) { // 新招強化
    p1.mods.taken[c.id] = (p1.mods.taken[c.id] || 0) + 1;
    p1.mvMods = p1.mvMods || {}; p1.mvMods[c.mv] = p1.mvMods[c.mv] || Object.assign({}, MV_DEF); c.apply(p1.mvMods[c.mv]);
  }
  else { p1.mods.taken[c.id] = (p1.mods.taken[c.id] || 0) + 1; c.apply(p1.mods, p1); }
  $('rgPanel').classList.add('hide'); if (RG.startPick) RG.startPick = false; else RG.stage++; rgStage(); layoutPads(); unlockAudio();
}
function rgGameOver() {
  if (mode === 'rgOver') return;
  mode = 'rgOver'; stopChant(); stat.end('p2'); lsSet(RG_SAVE, '');
  const reached = RG.stage, cleared = reached - 1, prevBest = RG.best, newBest = reached > prevBest && prevBest > 0;
  if (reached > RG.best) { RG.best = reached; lsSet('ssb_rg_best_' + RG.diff, reached); }
  // 存紀錄（鼓幣改從寶箱拿，這裡不給）
  const prof = profLoad();
  prof.runs++; prof.best[RG.diff] = Math.max(prof.best[RG.diff] || 0, RG.best); profSave(prof);
  // 差一點就破紀錄
  $('rgNear').textContent = newBest ? '🎉 新紀錄！打到第 ' + reached + ' 關' : prevBest === 0 ? '第一次闖關，打到第 ' + reached + ' 關！' : reached === prevBest ? '追平你的最佳紀錄！' : '離你的最佳紀錄（第 ' + prevBest + ' 關）只差 ' + (prevBest - reached) + ' 關！';
  $('rgStats').textContent = `打到第 ${reached} 關（過 ${cleared} 關）｜擊倒 ${RG.kills} 隻` + (RG.bosses ? `｜打倒 Boss ${RG.bosses} 隻` : '');
  const cheap = TREE.filter(t => tLv(prof, t.id) < t.max && !(t.need && !tLv(prof, t.need))).map(t => t.cost[tLv(prof, t.id)]).sort((a, b) => a - b)[0];
  $('rgResult').textContent = cheap && prof.coins >= cheap ? '🌳 鼓幣夠了，去傳承樹升級吧！' : '送出成績中…';
  $('rgTitle').textContent = '闖關結束（' + RG_DIFF[RG.diff].name + '）';
  for (const w of ['rgCardsWrap', 'rgStartWrap', 'rgTreeWrap']) $(w).classList.add('hide');
  $('rgOverWrap').classList.remove('hide'); $('rgPanel').classList.remove('hide');
  const canUp = cheap && prof.coins >= cheap;
  rgBoard(RG.diff, { vid: stat.vid, name: RG.name, diff: RG.diff, cleared: reached - 1, kills: RG.kills, dur: Math.round((performance.now() - RG.t0) / 1000) }).then(d => {
    const me = d && d.me;
    let t = !d ? (RG.boardErr === 'bad' ? '成績沒送出（伺服器不收這筆，請回報）' : '成績沒送出（網路問題）') : me && me.rank ? `排行榜：你的最佳過 ${me.best} 關，第 ${me.rank} 名` : '';
    if (d && me && me.rank > 1) { // 下一個要超越的人
      const above = d.top[me.rank - 2]; if (above) t += `｜再過 ${above.best - cleared + (above.best - cleared <= 0 ? 1 : 0)} 關就能超越第 ${me.rank - 1} 名「${above.name}」`;
    }
    $('rgResult').textContent = (canUp ? '🌳 鼓幣夠了，去傳承樹升級吧！　' : '') + t;
  });
}
$('rgAgain').onclick = () => { unlockAudio(); rgStart(RG.diff); };
// ---------- 每日簽到（7 天一輪、漏簽不歸零）＋造型衣櫃 ----------
const DAILY = [30, 40, 50, 60, 80, 100, 200];
const today = () => new Date().toLocaleDateString('sv'); // 本地日期 YYYY-MM-DD
const dailyCan = pf => pf.login.last !== today();
const SKIN_SHOP = [['teacher', 0], ['rider', 300], ['auntie', 400], ['mascot', 500], ['trump', 600], ['bear', 800], ['master', 1200], ['ma1', null, '打贏挑戰馬師傅第 1 關'], ['ma2', null, '打贏挑戰馬師傅第 7 關']]; // null：不能買
if (SHOW_DEMO) SKIN_SHOP.push(['cxk', 0], ['chiang', 0], ['shen', 0]); // 試作角色：測試版免費
function metaOpen(tab) {
  // 只有在首頁才把 mode 換成 lobby；打到一半（尤其線上當房主）打開衣櫃不能讓對戰停掉或把首頁畫面傳給對手
  metaFromTitle = mode === 'title'; if (metaFromTitle) mode = 'lobby'; $('meta').classList.remove('hide');
  $('dailyWrap').classList.toggle('hide', tab !== 'daily'); $('wardWrap').classList.toggle('hide', tab !== 'ward');
  $('metaTitle').textContent = tab === 'daily' ? '🎁 每日簽到' : '👕 造型衣櫃'; $('saveMsg').textContent = '';
  metaRender();
}
function metaRender() {
  const pf = profLoad();
  $('metaCoins').textContent = pf.coins; $('saveCode').textContent = fmtCode(pf.code);
  // 簽到：第幾天
  const box = $('dailyDays'); box.textContent = '';
  const can = dailyCan(pf), cur = pf.login.n % 7;
  DAILY.forEach((v, i) => {
    const d = document.createElement('div'), got = i < cur || (!can && cur === 0 && pf.login.n > 0); // 剛領完第 7 天：整排都領過
    d.className = 'dDay' + (got ? ' got' : '') + (can && i === cur ? ' now' : '');
    d.innerHTML = '第 ' + (i + 1) + ' 天<b></b>'; d.querySelector('b').textContent = v; box.appendChild(d);
  });
  $('dailyGo').disabled = !can;
  $('dailyGo').textContent = can ? '領取 ' + DAILY[cur] + ' 鼓幣' : '今天領過了，明天再來（下一次 ' + DAILY[cur] + ' 鼓幣）';
  // 衣櫃
  const w = $('ward'); w.textContent = '';
  for (const [id, price, how] of SKIN_SHOP) {
    const own = pf.skins.includes(id), it = document.createElement('div');
    it.className = 'wItem' + (pf.skin === id ? ' on' : '');
    const c = document.createElement('canvas'); c.width = 240; c.height = 300; it.appendChild(c); skinPreview(c, id);
    const n = document.createElement('div'); n.className = 'n'; n.textContent = CHARS[id].name; it.appendChild(n);
    const b1 = document.createElement('button');
    if (!own && price == null) { b1.textContent = '🔒 ' + how; b1.disabled = true; }
    else if (!own) { b1.textContent = '買　' + price + ' 鼓幣'; b1.disabled = pf.coins < price; b1.onclick = () => { const q = profLoad(); if (q.coins < price || q.skins.includes(id)) return; q.coins -= price; q.skins.push(id); profSave(q); synth('pop'); metaRender(); }; }
    else { b1.textContent = pf.skin === id ? '穿著中（1P）' : '穿上（1P）'; b1.disabled = pf.skin === id; b1.onclick = () => { const q = profLoad(); q.skin = id; profSave(q); metaRender(); netSkin(); }; }
    it.appendChild(b1);
    if (own) {
      const b2 = document.createElement('button'); b2.className = 'w2';
      b2.textContent = pf.skin2 === id ? '雙人 2P 穿著中（點了換回預設）' : '雙人 2P 穿這個';
      b2.onclick = () => { const q = profLoad(); q.skin2 = q.skin2 === id ? '' : id; profSave(q); metaRender(); };
      it.appendChild(b2);
    }
    w.appendChild(it);
  }
}
function skinPreview(c, id) { // 在小畫布上畫一隻站著的角色
  const f = new Fighter('p1', 0, 1); f.char = id;
  const old = ctx; ctx = c.getContext('2d');
  ctx.setTransform(.82, 0, 0, .82, 120, 292 - GROUND * .82);
  try { drawFighter(f, N, { x: 0, y: 0, f: 1 }); } catch (e) {}
  ctx = old;
}
$('dailyGo').onclick = () => {
  const pf = profLoad(); if (!dailyCan(pf)) return;
  const v = DAILY[pf.login.n % 7]; pf.coins += v; pf.coinsEarned += v; pf.login = { n: pf.login.n + 1, last: today() }; profSave(pf);
  synth('gong'); metaRender(); $('saveMsg').textContent = '';
  $('dailyGo').textContent = '＋' + v + ' 鼓幣！明天再來';
};
$('saveGo').onclick = async () => {
  const pf = profLoad(), raw = $('saveIn').value;
  if (pf.coinsEarned > 0 && !$('saveGo').dataset.ok) { askYes('找回之後，這台裝置現在的進度（' + pf.coins + ' 鼓幣）會被蓋掉，確定嗎？', () => { $('saveGo').dataset.ok = 1; $('saveGo').onclick(); }); return; }
  delete $('saveGo').dataset.ok;
  $('saveMsg').textContent = '找回中…';
  try { const d = await profRestore(raw); metaRender(); if (!$('acct').classList.contains('hide')) pnlOpen('acct'); $('saveMsg').textContent = '找回了！鼓幣 ' + d.coins; $('saveIn').value = ''; }
  catch (e) { $('saveMsg').textContent = e.message; }
};
$('saveIn').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') $('saveGo').onclick(); });
$('metaBack').onclick = () => { $('meta').classList.add('hide'); if (metaFromTitle && mode === 'lobby') mode = 'title'; layoutPads(); };
let metaFromTitle = false;
$('dailyBtn').onclick = () => metaOpen('daily');
$('wardBtn').onclick = () => metaOpen('ward');
// 一開網頁：有進度就順手備份一次。不再一進來就要取名：玩到要上排行榜的模式（闖關）才問。簽到不自動跳（按鈕上有紅點提醒）
if (!replayView) setTimeout(() => {
  const pf = profLoad();
  if (pf.coinsEarned > 0 || pf.login.n > 0) profSync();
}, 900);
// ---------- 名字（首頁取一次，之後不能改）、帳號、設定、左上角鼓幣 ----------
function myName() {
  let n = lsGet('ssb_name');
  if (!n) { const pf = profLoad(); if (pf.name) { n = pf.name; lsSet('ssb_name', n); } }
  return n;
}
let nameCb = null, pnlBack = 'title';
function needName(cb) {
  nameCb = cb || null; if (mode !== 'lobby') { pnlBack = mode; mode = 'lobby'; }
  $('nameIn').value = ''; $('nameErr').textContent = ''; $('nameBox').classList.remove('hide');
  setTimeout(() => { if (!isTouch) $('nameIn').focus(); }, 50);
}
function nameGo() {
  const name = $('nameIn').value.replace(/[\u0000-\u001f<>&"'`\\]/g, '').trim().slice(0, 12);
  if (!name) { $('nameErr').textContent = '先取個名字吧'; $('nameIn').focus(); return; }
  askYes('就叫「' + name + '」嗎？取了之後不能改喔', () => nameSet(name), '就叫這個');
}
function nameSet(name) {
  lsSet('ssb_name', name); const pf = profLoad(); pf.name = name; profSave(pf);
  $('nameBox').classList.add('hide'); if (mode === 'lobby' && pnlBack === 'title' && $('ladder').classList.contains('hide') && $('rgPanel').classList.contains('hide')) mode = 'title';
  const cb = nameCb; nameCb = null; if (cb) cb();
}
$('nameGo').onclick = nameGo;
$('nameNo').onclick = () => { // 不取名：關掉，回到原本的畫面（闖關選單還開著就留在那）
  $('nameBox').classList.add('hide'); nameCb = null;
  if (mode === 'lobby' && pnlBack === 'title' && $('rgPanel').classList.contains('hide') && $('ladder').classList.contains('hide')) mode = 'title';
};
$('nameIn').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') nameGo(); });
function topRefresh() {
  const pf = profLoad(); $('coinNum').textContent = pf.coins;
  UNLOCKED = !!pf.unl || SHOW_DEMO; $('gMenuTxt').textContent = pf.google ? 'Google 已綁定 ✅' : '綁定 Google 帳號';
  $('lbCreateX').textContent = UNLOCKED ? '建立房間：擴充（自選三招）' : '🔒 擴充（自選三招）：' + LOCK_MSG; $('lbCreateX').classList.toggle('locked', !UNLOCKED);
  const dc = dailyCan(pf); $('dailyDot').classList.toggle('hide', !dc); $('dailyDot').textContent = '可領'; $('menuBtn').classList.toggle('dot', dc);
  if (typeof chestRefresh === 'function') chestRefresh(pf);
}
// 帳號／設定：從標題打開時暫時把 mode 換掉，免得數字鍵觸發選單
const PNLS = ['acct', 'sets', 'ach'];
function pnlOpen(id) {
  if (!$('chestFx').classList.contains('hide')) return;
  const was = PNLS.some(p => !$(p).classList.contains('hide'));
  for (const p of PNLS) $(p).classList.add('hide');
  if (!was) { if (mode === 'title') { pnlBack = 'title'; mode = 'lobby'; } else pnlBack = ''; }
  if (id === 'acct') acctRender();
  if (id === 'ach') achRender();
  $(id).classList.remove('hide');
}
function pnlClose() { for (const p of PNLS) $(p).classList.add('hide'); if (pnlBack === 'title' && mode === 'lobby') mode = 'title'; layoutPads(); }
$('acctBtn').onclick = () => pnlOpen('acct');
$('gMenuBtn').onclick = () => { // 直接打開帳號頁、捲到 Google 那一格並閃一下
  pnlOpen('acct'); const a = $('gArea'); a.scrollIntoView({ block: 'center' }); a.classList.remove('flash'); void a.offsetWidth; a.classList.add('flash');
};
$('setBtn').onclick = () => pnlOpen('sets');
$('achBtn').onclick = () => pnlOpen('ach');
document.querySelectorAll('.pClose').forEach(b => b.onclick = pnlClose);
// ---------- 帳號頁：各模式進度 ----------
const rgBestTxt = n => n ? '第 ' + n + ' 關' : '—';
function progRows(pf) {
  const w = pf.st.win, pl = pf.st.play, ld = Math.max(pf.ldBest || 0, (pf.ldTop || 0) * 10);
  return [
    ['闖關・簡單', '最遠 ' + rgBestTxt(pf.best.easy)], ['闖關・中等', '最遠 ' + rgBestTxt(pf.best.normal)], ['闖關・困難', '最遠 ' + rgBestTxt(pf.best.hard)],
    ['挑戰馬師傅', pf.mc ? (pf.mc >= 7 ? '7 關全破' : '過了 ' + pf.mc + ' / 7 關') : '還沒過關'],
    ['對戰電腦', '贏 ' + (w.cpu || 0) + '／' + (pl.cpu || 0) + ' 場'], ['線上對戰', '贏 ' + (w.online || 0) + '／' + (pl.online || 0) + ' 場'],
  ];
}
function acctRender() {
  const pf = profLoad();
  $('acName').textContent = myName() || '（還沒取名）'; $('acCoins').textContent = pf.coins;
  const box = $('acRows'); box.innerHTML = '<div class="sec">各模式進度</div>';
  for (const [k, v] of progRows(pf)) { const r = document.createElement('div'); r.className = 'row2'; r.innerHTML = '<span></span><b></b>'; r.firstChild.textContent = k; r.lastChild.textContent = v; box.appendChild(r); }
  $('saveCode').textContent = fmtCode(pf.code); $('saveMsg').textContent = '';
  profUpload(); // 看到存檔碼時先把還沒上傳的進度補傳，拿去別台找回才是最新的
  gRender();
}
// ---------- Google 帳號綁定：綁了之後換手機、清掉瀏覽器資料，用 Google 登入就能找回進度 ----------
const G = { cid: null, ready: false };
async function gRender() {
  const pf = profLoad(), msg = $('gMsg'), box = $('gBtn');
  if (pf.google) {
    msg.textContent = '✅ 已綁定：' + pf.google + '｜換手機時用同一個 Google 帳號登入就能找回進度';
    box.innerHTML = '<button class="big alt" style="font-size:15px;padding:7px">取消綁定</button>';
    box.firstChild.onclick = () => askYes('取消綁定 ' + pf.google + '？取消後換手機就不能用 Google 找回進度（這台的進度不會不見）', gUnlink, '取消綁定');
    return;
  }
  msg.textContent = '綁定後，換手機或清掉資料，用 Google 登入就能找回鼓幣、造型和進度';
  if (G.cid === null) { try { G.cid = (await (await fetch('/api/google')).json()).clientId || ''; } catch (e) { G.cid = ''; } }
  if (!G.cid) { msg.textContent += '（Google 登入還在設定中，之後開放）'; return; }
  // App 是 WebView，Google 不讓在裡面登入（要改用原生登入，下一版 App 才有）
  if (/ShanshenbuApp/.test(navigator.userAgent)) { msg.textContent = 'App 版的 Google 綁定下一版加入；現在可以先到網頁版綁定，再用存檔碼把進度帶進 App'; box.textContent = ''; return; }
  if (!G.ready) {
    await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = ok; s.onerror = no; document.head.appendChild(s); }).catch(() => {});
    if (!window.google || !google.accounts) { msg.textContent = '連不上 Google，稍後再試'; return; }
    google.accounts.id.initialize({ client_id: G.cid, callback: r => gLogin(r.credential) }); G.ready = true;
  }
  box.textContent = ''; google.accounts.id.renderButton(box, { theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'zh-TW' });
}
async function gUnlink() {
  $('gMsg').textContent = '取消中…';
  try {
    const pf = profLoad(), r = await fetch('/api/google', { method: 'POST', body: JSON.stringify({ unlink: 1, code: pf.code }) });
    if (!r.ok) throw new Error('取消失敗，稍後再試');
    delete pf.google; profSave(pf); G.ready && google.accounts.id.disableAutoSelect(); gRender();
  } catch (e) { $('gMsg').textContent = e.message; }
}
async function gLogin(cred) {
  const pf = profLoad(); $('gMsg').textContent = '綁定中…';
  try {
    const r = await fetch('/api/google', { method: 'POST', body: JSON.stringify({ cred, code: pf.code, vid: stat.vid, data: pf }) }), d = await r.json();
    if (!r.ok) throw new Error(d.error || '綁定失敗');
    if (d.linked) { const q = profLoad(); q.google = d.email || 'Google 帳號'; profSave(q); synth('gong'); gRender(); return; }
    if (d.found) { // 這個 Google 帳號已經綁了另一份存檔（例如舊手機）：問要不要載入
      const c = d.data ? d.data.coins : 0;
      askYes('這個 Google 帳號已經有存檔（鼓幣 ' + c + '）。要載入那份嗎？這台裝置現在的進度（鼓幣 ' + pf.coins + '）會被蓋掉', async () => {
        try { const nd = await profRestore(d.code); const q = profLoad(); q.google = d.email || 'Google 帳號'; profSave(q); acctRender(); $('gMsg').textContent = '✅ 找回了！鼓幣 ' + nd.coins; }
        catch (e) { $('gMsg').textContent = e.message; }
      }, '載入');
      gRender(); return;
    }
  } catch (e) { $('gMsg').textContent = e.message; }
}
// ---------- 成就（解鎖送鼓幣）----------
const totWins = pf => (pf.st.win.cpu || 0) + (pf.st.win.online || 0) + (pf.st.win.ma || 0) + (pf.st.win.rank || 0) + (pf.st.ldWins || 0);
const rgMax = pf => Math.max(pf.best.easy || 0, pf.best.normal || 0, pf.best.hard || 0);
const ACH = [
  // 原本是稱號（閃身步學徒→宗師）；位階名要留給排位賽，改成一般成就（id 不變，領過的不會重領）
  { id: 't1', ic: '🥋', name: '首勝', desc: '贏下第 1 場', goal: 1, v: totWins, coins: 50 },
  { id: 't2', ic: '🥈', name: '二十五勝', desc: '累計贏 25 場', goal: 25, v: totWins, coins: 200 },
  { id: 't3', ic: '🥇', name: '百勝', desc: '累計贏 100 場', goal: 100, v: totWins, coins: 500 },
  { id: 't4', ic: '👑', name: '三百勝', desc: '累計贏 300 場', goal: 300, v: totWins, coins: 1000 },
  { id: 'r1', ic: '⚔️', name: '闖關新手', desc: '闖關打到第 5 關', goal: 5, v: rgMax, coins: 50 },
  { id: 'r2', ic: '🗡️', name: '闖關好手', desc: '闖關打到第 10 關', goal: 10, v: rgMax, coins: 150 },
  { id: 'r3', ic: '🔥', name: '闖關霸主', desc: '闖關打到第 20 關', goal: 20, v: rgMax, coins: 400 },
  { id: 'r4', ic: '💀', name: '困難好漢', desc: '困難模式打到第 10 關', goal: 10, v: pf => pf.best.hard || 0, coins: 400 },
  { id: 'm1', ic: '⚡', name: '不講武德', desc: '打贏初階馬師傅（挑戰馬師傅第 1 關）', goal: 1, v: pf => pf.mc || 0, coins: 100 },
  { id: 'm2', ic: '🥋', name: '過五關', desc: '挑戰馬師傅過第 5 關', goal: 5, v: pf => pf.mc || 0, coins: 300 },
  { id: 'm3', ic: '🏔️', name: '耗子尾汁', desc: '挑戰馬師傅 7 關全破', goal: 7, v: pf => pf.mc || 0, coins: 800 },
  { id: 'o1', ic: '🌐', name: '線上初勝', desc: '線上對戰贏 1 場', goal: 1, v: pf => pf.st.win.online || 0, coins: 80 },
  { id: 'o2', ic: '🌟', name: '線上常勝軍', desc: '線上對戰贏 20 場', goal: 20, v: pf => pf.st.win.online || 0, coins: 400 },
  { id: 'c1', ic: '👕', name: '收藏家', desc: '擁有 4 套造型', goal: 4, v: pf => pf.skins.length, coins: 150 },
  { id: 'd1', ic: '📅', name: '全勤', desc: '每日簽到滿 7 次', goal: 7, v: pf => pf.login.n, coins: 100 },
];
ACH.push({ id: 'b1', ic: '🎁', name: '開箱手', desc: '打開 1 個寶箱', goal: 1, v: pf => pf.chestOpened || 0, coins: 30 }, { id: 'b2', ic: '💎', name: '開箱狂人', desc: '打開 30 個寶箱', goal: 30, v: pf => pf.chestOpened || 0, coins: 300 });
function titleOf(pf) { const t = ACH.filter(a => a.title && pf.ach.includes(a.id)).pop(); return t ? t.name : ''; }
const achQ = [];
function achScan(p) { // profSave 前檢查：新解鎖的加進 ach、送鼓幣、排進通知
  if (!p.ach || !p.st) return;
  for (const a of ACH) if (!p.ach.includes(a.id) && a.v(p) >= a.goal) { p.ach.push(a.id); p.coins += a.coins; p.coinsEarned += a.coins; achQ.push(a); }
  if (achQ.length && !achQ.busy) achNext();
}
function achNext() {
  const a = achQ.shift(); if (!a) { achQ.busy = false; return; }
  achQ.busy = true; synth('gong');
  const d = document.createElement('div'); d.id = 'achToast';
  d.innerHTML = '<span class="ic"></span><div><small>' + (a.title ? '獲得稱號！' : '解鎖成就！') + '</small><span class="n"></span>　+' + a.coins + ' 鼓幣</div>';
  d.querySelector('.ic').textContent = a.ic; d.querySelector('.n').textContent = a.name;
  const old = $('achToast'); if (old) old.remove(); document.body.appendChild(d);
  setTimeout(() => { d.remove(); achNext(); }, 3300);
}
function achRender() {
  const pf = profLoad(), g = $('achGrid'); g.textContent = '';
  $('achSum').textContent = '已解鎖 ' + ACH.filter(a => pf.ach.includes(a.id)).length + ' / ' + ACH.length + (titleOf(pf) ? '　｜　目前稱號：' + titleOf(pf) : '');
  for (const a of ACH) {
    const on = pf.ach.includes(a.id), v = Math.min(a.goal, a.v(pf)), d = document.createElement('div');
    d.className = 'aItem' + (on ? ' on' : '');
    d.innerHTML = '<span class="ic"></span><div style="flex:1"><div class="n"></div><div class="d"></div><div class="pg"><i></i></div></div>';
    d.querySelector('.ic').textContent = a.ic; d.querySelector('.n').textContent = a.name + (a.title ? '（稱號）' : '');
    d.querySelector('.d').textContent = a.desc + '｜' + (on ? '已完成　+' + a.coins + ' 鼓幣' : v + ' / ' + a.goal + '　獎勵 ' + a.coins + ' 鼓幣');
    d.querySelector('.pg i').style.width = (v / a.goal * 100) + '%';
    g.appendChild(d);
  }
}
$('acctSave').appendChild($('saveBox')); // 存檔碼／找回進度搬到帳號頁
// ---------- 寶箱：玩就累積進度，滿 100 開一箱（大多是鼓幣，很低機率出造型或天梯招式）----------
const CHEST_NEED = 100;
const CHEST_ODDS = { skin: .03 }; // 造型 3%，其餘鼓幣（抽招式拿掉了）
function chestSvg(p) { // p：同一頁兩個寶箱，漸層 id 不能撞
  return `<svg viewBox="0 0 200 180"><defs>
  <linearGradient id="${p}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8742a"/><stop offset="1" stop-color="#7a3e10"/></linearGradient>
  <linearGradient id="${p}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e08a3a"/><stop offset="1" stop-color="#a5541a"/></linearGradient>
  <linearGradient id="${p}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a0"/><stop offset=".5" stop-color="#ffd34d"/><stop offset="1" stop-color="#c98a10"/></linearGradient></defs>
  <ellipse cx="100" cy="172" rx="82" ry="8" fill="rgba(0,0,0,.35)"/>
  <rect x="20" y="82" width="160" height="86" rx="8" fill="url(#${p}w)" stroke="#4a2306" stroke-width="4"/>
  <rect x="20" y="152" width="160" height="16" rx="6" fill="#5a2c0a"/>
  <rect x="38" y="82" width="16" height="86" fill="url(#${p}g)" stroke="#8a5a00" stroke-width="2"/><rect x="146" y="82" width="16" height="86" fill="url(#${p}g)" stroke="#8a5a00" stroke-width="2"/>
  <g id="${p === 'b' ? 'cfLid' : p + 'Lid'}">
    <path d="M20 86 L20 58 Q20 18 100 18 Q180 18 180 58 L180 86 Z" fill="url(#${p}l)" stroke="#4a2306" stroke-width="4"/>
    <path d="M38 86 L38 30 Q44 24 54 22 L54 86 Z M146 86 L146 22 Q156 24 162 30 L162 86 Z" fill="url(#${p}g)" stroke="#8a5a00" stroke-width="2"/>
    <rect x="16" y="74" width="168" height="14" rx="5" fill="url(#${p}g)" stroke="#8a5a00" stroke-width="2"/>
    <path d="M60 40 Q100 28 140 40" stroke="rgba(255,255,255,.35)" stroke-width="5" fill="none" stroke-linecap="round"/>
  </g>
  <rect x="84" y="80" width="32" height="36" rx="6" fill="url(#${p}g)" stroke="#8a5a00" stroke-width="3"/>
  <circle cx="100" cy="94" r="5" fill="#5a2c0a"/><rect x="97.5" y="96" width="5" height="11" rx="2" fill="#5a2c0a"/>
</svg>`;
}
$('cbIcon').innerHTML = chestSvg('m');
function chestRefresh(pf) {
  const pts = pf.chestPts || 0, n = Math.floor(pts / CHEST_NEED);
  $('chestBtn').classList.remove('hide'); $('chestBtn').classList.toggle('ready', n > 0);
  $('cbFill').style.width = (n > 0 ? 100 : pts % CHEST_NEED) + '%';
  $('cbTxt').textContent = n > 0 ? '可以開了！' : (pts % CHEST_NEED) + ' / ' + CHEST_NEED;
  $('cbBadge').classList.toggle('hide', n < 1); $('cbBadge').textContent = n;
}
// 每打完一場：記戰績（帳號頁、成就用）；寶箱版再加寶箱進度（越久越多 10～60，贏了再 +10）
function onGameEnd(gmode, role, res, dur) {
  const pf = profLoad(), st = pf.st;
  const won = gmode === 'cpu' || gmode === 'ma' ? res === 'p1' : gmode === 'online' || gmode === 'rank' ? res === (role === 'guest' ? 'p2' : 'p1') : null; // 排位真人對戰：對手端是 2P
  st.play[gmode] = (st.play[gmode] || 0) + 1;
  if (won) st.win[gmode] = (st.win[gmode] || 0) + 1;
  if (gmode === 'cpu' && won && QP.lv && QP.lv >= (pf.cpuLv || 1) && QP.lv < 3) { // 打贏目前最強那級：解鎖下一級
    pf.cpuLv = QP.lv + 1; const nx = CPU_LV[pf.cpuLv].n; setTimeout(() => chestToast('🔓 解鎖「' + nx + '」'), 5200);
  }
  if (gmode === 'cpu' && won && !pf.unl) { pf.unl = 1; setTimeout(() => chestToast('🔓 解鎖了：其他模式、線上擴充模式！'), 2600); }
  const pts = Math.round(Math.min(60, 10 + dur / 6)) + (won || res === 'p1' && !role ? 10 : 0);
  pf.chestPts = (pf.chestPts || 0) + pts;
  profSave(pf);
  chestToast('🎁 寶箱進度 +' + pts + (pf.chestPts >= CHEST_NEED ? '　可以開寶箱了！' : ''));
}
function chestToast(t) {
  const old = $('chestToast'); if (old) old.remove();
  const d = document.createElement('div'); d.id = 'chestToast'; d.textContent = t; document.body.appendChild(d);
  setTimeout(() => d.remove(), 2500);
}
const pickOne = a => a[Math.floor(Math.random() * a.length)];
function chestRoll(pf) {
  const r = Math.random();
  const skins = SKIN_SHOP.filter(s => s[1] != null).map(s => s[0]).filter(id => !pf.skins.includes(id)); // 馬師傅造型只能打贏拿
  if (r < CHEST_ODDS.skin && skins.length) return { kind: 'skin', id: pickOne(skins) };
  const q = Math.random(); // 鼓幣：大多 150～250，偶爾大包（鼓幣只從寶箱和簽到來，所以給多一點）
  const coins = q < .55 ? 150 + 25 * Math.floor(Math.random() * 5) : q < .85 ? 300 + 25 * Math.floor(Math.random() * 5) : q < .97 ? 600 : 1500;
  return { kind: 'coins', n: coins };
}
const cf = { stage: 0, rw: null, raf: 0, back: '' };
function chestOpen() {
  const pf = profLoad();
  if ((pf.chestPts || 0) < CHEST_NEED) {
    const b = $('chestBtn'); b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
    chestToast('再玩幾場就能開（' + (pf.chestPts || 0) + ' / ' + CHEST_NEED + '）'); return;
  }
  cf.back = mode === 'title' ? 'title' : ''; if (mode === 'title') mode = 'lobby';
  cf.stage = 0; cf.rw = null;
  const fx = $('chestFx'); fx.className = 'idle'; fx.style.setProperty('--ray', 'rgba(255,227,107,.28)');
  $('cfChest').innerHTML = chestSvg('b'); const c = $('cfChest'); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
  $('cfTap').textContent = '點一下打開寶箱'; $('cfTap').classList.remove('hide');
  synth('thud');
}
function chestBurst(n, chars, spread) {
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span'), a = Math.random() * Math.PI * 2, d = spread * (.4 + Math.random() * .8);
    s.className = 'cfP'; s.textContent = pickOne(chars);
    s.style.cssText = `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 60}px;--r:${(Math.random() - .5) * 720}deg;--t:${.8 + Math.random() * .7}s;font-size:${20 + Math.random() * 26}px`;
    $('chestFx').appendChild(s); setTimeout(() => s.remove(), 1600);
  }
}
$('chestFx').onclick = e => {
  if (cf.stage !== 0 || e.target.id === 'cfOk') return;
  cf.stage = 1; const fx = $('chestFx');
  $('cfTap').classList.add('hide'); fx.className = 'charge'; synth('whoosh');
  setTimeout(() => { fx.classList.add('c2'); synth('kick'); chestBurst(8, ['✨', '⭐'], 160); }, 550);
  setTimeout(() => {
    // 開箱：先存檔再演，關掉畫面也不會吃掉獎勵
    const pf = profLoad(), rw = chestRoll(pf); cf.rw = rw;
    pf.chestPts = Math.max(0, (pf.chestPts || 0) - CHEST_NEED); pf.chestOpened = (pf.chestOpened || 0) + 1;
    if (rw.kind === 'coins') { pf.coins += rw.n; pf.coinsEarned += rw.n; }
    else if (rw.kind === 'skin') pf.skins.push(rw.id);
    else { pf.ldOwn.push(rw.id); if (pf.ldLoad.length < MAX_MV) pf.ldLoad.push(rw.id); }
    profSave(pf);
    const rare = rw.kind !== 'coins', big = rw.kind === 'coins' && rw.n >= 600;
    fx.style.setProperty('--ray', rare ? 'rgba(210,120,255,.4)' : big ? 'rgba(255,200,40,.45)' : 'rgba(255,227,107,.28)');
    fx.className = 'open'; synth('gong'); shakeEl();
    chestBurst(rw.kind === 'coins' ? Math.min(40, 10 + rw.n / 10) : 30, rw.kind === 'coins' ? ['🪙', '🪙', '✨'] : ['✨', '⭐', '💜', '🌟'], rare ? 420 : 340);
    setTimeout(() => { fx.classList.add('show'); chestReveal(rw); }, 420);
  }, 1250);
};
function shakeEl() { const c = $('cfChest'); c.style.transform = 'translateX(6px)'; setTimeout(() => c.style.transform = '', 80); }
function chestReveal(rw) {
  cancelAnimationFrame(cf.raf);
  const tag = $('cfTag'), card = $('cfCard'), cv2 = $('cfCv');
  tag.className = rw.kind === 'coins' ? (rw.n >= 600 ? 'gold' : '') : 'rare'; card.className = rw.kind === 'coins' ? '' : 'rare';
  cv2.classList.toggle('hide', rw.kind === 'coins'); $('cfBig').classList.toggle('hide', rw.kind !== 'coins');
  if (rw.kind === 'coins') {
    tag.textContent = rw.n >= 1500 ? '超級大包！' : rw.n >= 600 ? '大包鼓幣' : '鼓幣';
    $('cfName').textContent = '🪙 鼓幣'; $('cfDesc').textContent = '可以買造型、傳承樹';
    const t0 = performance.now(); // 數字往上跳
    (function up(now) { const k = Math.min(1, (now - t0) / 700); $('cfBig').textContent = '+' + Math.round(rw.n * (1 - Math.pow(1 - k, 3))); if (k < 1) cf.raf = requestAnimationFrame(up); })(t0);
    return;
  }
  const g = cv2.getContext('2d'), f = new Fighter('p1', 0, 1), t0 = performance.now();
  let m = null, per = 1.4, jumpEv = null, landAt = 0;
  if (rw.kind === 'skin') { // 造型：新衣服的人在卡片裡踢球
    f.char = rw.id;
    tag.textContent = '稀有造型！'; $('cfName').textContent = CHARS[rw.id].name; $('cfDesc').textContent = '已經放進造型衣櫃，去換上吧';
  } else { // 天梯招式：小人在卡片裡一直示範這一招
    m = MOVES[rw.id]; per = m.dur + .7; f.char = profLoad().skin || 'teacher';
    tag.textContent = '稀有招式！'; $('cfName').textContent = m.name; $('cfDesc').textContent = m.desc + '（已放進天梯招式庫）';
    jumpEv = m.ev.find(e => e.jump); landAt = jumpEv ? ((m.ev.find(e => e.dive || e.onLand) || {}).at || jumpEv.at + .5) : 0;
  }
  let lastCall = -1;
  (function loop(now) {
    if ($('chestFx').classList.contains('hide')) return;
    const t = ((now - t0) / 1000) % per;
    let p, face = 1, y = 0;
    if (!m) p = t < .85 ? sampleKeys(BV().keys, t) : N;
    else {
      const a = Math.min(t, m.dur); p = sampleKeys(m.keys, a);
      if (m.jit) { p = Object.assign({}, p); const j = Math.sin(a * 90) * m.jit; p.lean += j * .4; p.bA += j; p.fA -= j; p.head += j; }
      if (m.spin && a > m.spin[0] && a < m.spin[1]) face = Math.sin(a * 45) > 0 ? 1 : -1;
      if (jumpEv && a > jumpEv.at && a < landAt) y = Math.sin((a - jumpEv.at) / (landAt - jumpEv.at) * Math.PI) * 70;
      const call = Math.floor((now - t0) / 1000 / per); if (call !== lastCall) { lastCall = call; if (call < 3) playClip('mv_' + rw.id, .8); } // 喊招名（前三遍）
    }
    const old = ctx; ctx = g;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 400, 452);
    g.fillStyle = 'rgba(0,20,50,.35)'; g.beginPath(); g.ellipse(200, 432, 70, 12, 0, 0, 7); g.fill();
    ctx.setTransform(1.2, 0, 0, 1.2, 200, 432 - GROUND * 1.2);
    try { drawFighter(f, p, { x: 0, y, f: face, face: 'shout' }); } catch (err) {}
    ctx = old;
    cf.raf = requestAnimationFrame(loop);
  })(t0);
}
$('cfOk').onclick = () => {
  cancelAnimationFrame(cf.raf); $('chestFx').className = 'hide'; cf.stage = 0;
  if (cf.back === 'title' && mode === 'lobby') mode = 'title';
  topRefresh();
};
$('chestBtn').onclick = chestOpen;
topRefresh();
// ---------- 馬師傅語音：畫面上一定有字幕；game/assets/sfx/ma/ 放了錄音檔就播檔案，沒有就用瀏覽器內建的中文語音念 ----------
// 原片擷取（assets/sfx/ma/）：wulian 閃電鞭影片開頭；其他都是「原版視頻」那段
const MA_LINES = { wulian: '下面我打一個閃電五連鞭', kuai: '很快啊！', deng: '一個左正蹬，一個右鞭腿，一個左刺拳', dayi: '我大意了啊，沒有閃', wude: '這兩個年輕人不講武德', pian: '來騙！來偷襲！', haozi: '我勸這位年輕人，耗子尾汁' };
const MA_HAS = {};
if (!replayView) for (const k in MA_LINES) fetch('assets/sfx/ma/' + k + '.mp3', { method: 'HEAD' }).then(r => { MA_HAS[k] = r.ok; }).catch(() => {});
function maSay(ft, key, force) {
  if (!ft) return;
  // 別一直講（招式綁定的台詞 force 一定講）。線上（rollback）用模擬的格數算間隔，不用真實時間：倒帶重算時兩邊結果才一樣
  if (RB.on) { if (!force && ft.maF > RB.simF) return; ft.maF = RB.simF + 150; }
  else { if (ft.maT > performance.now() && !force) return; ft.maT = performance.now() + 2500; }
  caption(ft, MA_LINES[key]);
  if (MA_HAS[key]) { playClip('ma_' + key); return; }
  if (!rbSfx('ma' + key) || muted || !window.speechSynthesis) return; // 倒帶重算同一格不要再念一次
  try { const u = new SpeechSynthesisUtterance(MA_LINES[key]); u.lang = 'zh-TW'; u.rate = 1.05; u.pitch = .7; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
// 馬師傅三個階段：1 階閃電鞭版、2 階大意了版、3 階唐裝版
const MA_TIERS = [null,
  { look: 0, hp: 1, wul: 1, boltR: 1 },
  { look: 1, hp: 1.5, wul: 1.5, boltR: 1.5 },
  { look: 2, hp: 2, wul: 2, boltR: 1.5, armor: true, cc: 1.5, kb: 1.5 }]; // 3 階：出招霸體、打中控更久、刺拳打更遠
function maApplyTier(ft, tier) {
  const T3 = MA_TIERS[tier]; CHARS.ma.look = MA_LOOKS[T3.look];
  Object.assign(ft, { char: 'ma', maTier: tier, maWul: T3.wul, maBoltR: T3.boltR, maArmor: !!T3.armor, maCC: T3.cc || 0, maKb: T3.kb || 1, dmgMul: 1.15 });
  ft.atk = ['jie', 'hua', 'fa', 'wulian']; ft.load = ['jie', 'hua', 'fa']; ft.ldCool = 1.2;
  ft.maxHp = ft.hp = ft.hpShow = Math.round(200 * T3.hp);
}
// 挑戰馬師傅（試玩）：一般對戰電腦（三戰兩勝），玩家用自己挑的三招
function maTrial(tier = 1, load) {
  goHome(false); menuDrop.classList.add('hide'); unlockAudio();
  startMatch(true); if (load) p1.load = load.slice();
  maApplyTier(p2, tier); layoutPads(); maSay(p2, 'wude', true);
  banner = { text: '馬師傅 ' + tier + ' 階', sub: ['', '閃電鞭版', '大意了版', '唐裝版'][tier] + (tier === 3 ? '（出招霸體）' : ''), t: 0 };
}
$('maBtn').onclick = () => maTrial(1);
// ---------- 挑戰馬師傅（取代天梯）：7 關，每關三戰兩勝，打贏才開下一關；每關自己挑三招 ----------
// 第 2～6 關：電腦用「AI 關卡」入門版第 2／7／8／9／10 關的三招、反應和失誤率（通用 AI）
let MC_STAGES = [
  { n: '初階馬師傅', sub: '閃電鞭版', ma: 1, face: 'ma1' },
  { n: '暴躁大媽', char: 'auntie', lv: 2 },
  { n: '懂王', char: 'trump', lv: 7 },
  { n: '狗熊', char: 'bear', lv: 8 },
  { n: '花鼓燈大師', char: 'teacher', lv: 9 },
  { n: '鼓子秧歌大師', char: 'master', lv: 10 },
  { n: '二階馬師傅', sub: '大意了版', ma: 2, face: 'ma2' },
];
const mcLevel = s => { const v = LVD.data && LVD.data.versions.find(x => x.version === (s.v || 1)); return v && v.stages.find(x => x.stage === (s.s || s.lv)); };
// 關卡圖的頭像：把角色畫在小畫布上，只取頭那一塊
const faceCache = {};
function faceImg(id) {
  if (faceCache[id]) return faceCache[id];
  const big = document.createElement('canvas'); big.width = 240; big.height = 300; skinPreview(big, id);
  const c = document.createElement('canvas'); c.width = c.height = 160;
  c.getContext('2d').drawImage(big, FACE_BOX[0], FACE_BOX[1], FACE_BOX[2], FACE_BOX[2], 0, 0, 160, 160);
  return (faceCache[id] = c.toDataURL());
}
const FACE_BOX = [68, 56, 104]; // 站姿頭部在 240×300 預覽圖裡的位置（x, y, 邊長）
let MC_SKIN = { 0: 'ma1', 6: 'ma2' }; // 打贏這關送的造型
const MC = { on: false, i: 0, sel: 0 };
// 新版挑戰馬師傅（試作，只在測試版）：tools/assets/ai/mc_design.py 排的關卡路線＝舊模型 AI 關卡＋逐招特訓各階段新模型，由易到難，最後三階馬師傅
// 進度另外記在 pf.mcx，不動正式版的 pf.mc（成就、帳號頁照舊算正式版）
let MC_DEMO = false;
const mcKey = () => !MC_DEMO ? 'mc' : MC.route === 'h' ? 'mch' : 'mcx';
// 兩條路線：一般（30 關，最後三階馬師傅）、高手（tools/assets/ai/mc_hard.py：比舊模型第 10 關難，一路到現在訓練中最強的模型，穿插 AI 坤坤、AI 馬師傅）
const MC_ROUTES = {}; MC.route = 'n';
function mcSetRoute(k) {
  const r = MC_ROUTES[k]; if (!r) return;
  MC.route = k; MC_STAGES = r; MC.sel = 0;
  MC_SKIN = {}; if (k === 'n') MC_STAGES.forEach((e, i) => { if (e.ma === 1 || e.ma === 2) MC_SKIN[i] = 'ma' + e.ma; });
}
if (SHOW_DEMO) for (const [k, f] of [['n', 'mc_stages.json'], ['h', 'mc_hard.json']]) fetch('assets/ai/' + f).then(r => r.json()).then(j => {
  CHARS.ma3 = CHARS.ma3 || { name: '馬師傅（唐裝版）', moves: ['shan', 'ball', 'bear'], look: MA_LOOKS[2] }; // 只拿來畫關卡頭像，不進衣櫃
  MC_ROUTES[k] = j.map(e => Object.assign({ n: e.n || CHARS[e.char].name }, e));
  for (const e of MC_ROUTES[k]) if (e.gen) NN_GEN_FILE[e.gen] = 'assets/ai/' + e.file;
  if (k === 'n') { MC_DEMO = true; mcSetRoute('n'); }
}).catch(() => {});
// ---------- 馬上玩：電腦強度 弱（原本的電腦）→ 中（訓練的「弱」AI）→ 強（訓練的「中」AI）；打贏一級才看得到下一級 ----------
const CPU_LV = [null, { n: '弱', tier: 'off' }, { n: '中', tier: 'weak' }, { n: '強', tier: 'medium' }]; // 解鎖都是三戰兩勝打贏上一級
const QP = { lv: 0 };
function quickPlay() {
  const top = Math.min(3, profLoad().cpuLv || 1);
  for (let l = 2; l <= top; l++) nnLoad(CPU_LV[l].tier);
  if (top <= 1) { qpStart(1); return; } // 還沒解鎖中：直接開打
  mode = 'lobby'; const box = $('cpuLvs'); box.textContent = '';
  for (let l = 1; l <= top; l++) {
    const b = document.createElement('button'); b.dataset.lv = l;
    b.textContent = CPU_LV[l].n;
    b.onclick = () => { synth('pop'); try { navigator.vibrate && navigator.vibrate(15); } catch (e) {} qpStart(l); };
    box.appendChild(b);
  }
  $('cpuPick').classList.remove('hide'); layoutPads();
}
async function qpStart(lv) {
  $('cpuPick').classList.add('hide');
  const t = CPU_LV[lv].tier;
  if (t !== 'off') { nnLoad(t); for (let i = 0; i < 40 && NN.models[t] === 'loading'; i++) await new Promise(r => setTimeout(r, 100)); } // AI 模型還沒下載完就等一下（最多 4 秒）
  mode = 'title'; startMatch(true); NN.tier = t; QP.lv = lv;
}
$('cpuBack').onclick = () => { $('cpuPick').classList.add('hide'); mode = 'title'; layoutPads(); };
function omOpen() { mode = 'lobby'; $('omPanel').classList.remove('hide'); layoutPads(); }
function omClose() { $('omPanel').classList.add('hide'); }
document.querySelectorAll('.omC').forEach(b => b.onclick = () => {
  synth('pop'); try { navigator.vibrate && navigator.vibrate(15); } catch (e) {}
  omClose(); mode = 'title'; const m = b.dataset.m;
  if (m === 'rg') rgOpen(); else if (m === 'bw') bwOpen(); else if (m === 'ma') maOpen(); else if (m === 'rank') rkOpen(); else startMatch(false);
});
// ---------- 閃身步排位賽（試玩）：段位、配對、ban/pick、三戰兩勝、算分 ----------
// 分數 mmr（起始 1000）決定段位。配對先排真人（worker.js 的 /mm），10 秒沒配到才配電腦；電腦裝成真人（名字、造型、算分都一樣）
const RK_TIERS = [['青銅', '🥉', 0], ['白銀', '🥈', 1100], ['黃金', '🥇', 1200], ['白金', '💠', 1300], ['鑽石', '💎', 1400], ['星耀', '🌟', 1500], ['閃身步大師', '👑', 1600]];
// 每個段位派出的電腦：gen＝哪一代模型、delay＝反應延遲（1/15 秒）、eps＝亂按機率、smart＝選招時挑最強招的機率
// dumb／press＝每次決定用手殘操作的機率／手殘時按招的機率、lapse／lapseLen＝開始走神的機率／走神多久（1/15 秒）、nudge＝幾秒沒出招才被推去打人
// 排位賽的電腦要假裝真人：傷害一律全額，只調操作。白金是原本的青銅（延遲 8、亂按 30%）
// 青銅～黃金每階兩種強度（分數在該階下半／上半），共六級。n＊＝從零練的新手模型（runs/novice）；gap＝至少隔幾秒才出下一招
// 實測（對腳本玩家）：亂按、走神都弱不了多少，這遊戲光是亂放招就很痛；真正有效的是限制出招頻率。每回合傷害 27／39／60／90／104／126，白金 147
const RK_LOW = [
  { gen: 'n160', delay: 3, gap: 3, nudge: 5, smart: 0 },
  { gen: 'n400', delay: 3, gap: 2, nudge: 4, smart: 0 },
  { gen: 'n400', delay: 3, gap: 1.4, nudge: 3.4, smart: .05 },
  { gen: 'n400', delay: 3, gap: .6, nudge: 2.6, smart: .1 },
  { gen: 'old', delay: 3, gap: 1, nudge: 3, smart: .15 },
  { gen: 'old', delay: 3, gap: .6, nudge: 2.6, smart: .2 },
];
const RK_BOT = [
  RK_LOW[0], RK_LOW[2], RK_LOW[4], // 只是占位：青銅～黃金實際由 rkCfg 依分數挑
  { gen: 'old', delay: 8, eps: .3, smart: .2 }, // 原本的青銅
  { gen: 'old', delay: 3, eps: 0, smart: .4 },
  { gen: 'it03000', delay: 3, eps: 0, smart: .7 },
  { gen: 'skill', delay: 3, eps: 0, smart: 1 },
];
// 最強一代每招的實測勝率（runs/skill2/skill.csv）：高段電腦 ban、選招挑最高的
const RK_WR = { shanhong: .9, shuangchao: .885, sandian: .878, xiaolun: .845, laoying: .82, zhuafen: .785, feiji: .778, pinghu: .773, dalun: .765, baishi: .758, guabian: .745, fengbai: .74, bear: .72, xiachuan: .71, daqi: .69, ball: .66, liaowang: .66, shan: .655, yunbu: .648, biandan: .63 };
// 電腦的名字：每場現組一個，學真人取名（小名＋生日／年份、英文名、一句廢話、形容詞＋東西），最近用過的不重複
const RK_NM = {
  nick: ['小明', '阿凱', '阿豪', '小宇', '阿翔', '小瑋', '阿哲', '小魚', '阿銘', '小安', '阿倫', '小傑', '阿志', '小欣', '阿皓', '小柏', '阿杰', '小涵', '阿宏', '小恩', '阿德', '小庭', '阿信', '小葳'],
  en: ['kevin', 'jason', 'eric', 'andy', 'leo', 'ryan', 'amy', 'tina', 'momo', 'coco', 'alex', 'ben', 'sean', 'vivian', 'peter', 'jay', 'wei', 'hao', 'yu', 'kai'],
  last: ['chen', 'lin', 'wang', 'huang', 'chang', 'liu', 'tsai', 'yang', 'wu', 'hsu'],
  say: ['今天不加班', '下班打一場', '手殘求放過', '別打我臉', '想睡覺', '又輸了', '閃身步好難', '不想寫作業', '熬夜冠軍', '偷懶中', '等我一下', '隨便玩玩', '我媽叫我吃飯', '明天要考試', '老闆在後面', '只會踢球', '狗熊愛好者', '十字韌帶斷了', '再一場就睡', '第一次玩'],
  adj: ['快樂', '憂鬱', '暴躁', '佛系', '沉默', '躺平', '路過', '想睡', '愛吃', '認真', '可憐', '無敵', '厭世', '迷路'],
  noun: ['小熊', '肥貓', '鹹魚', '阿伯', '大叔', '少年', '西瓜', '珍奶', '雞排', '柴犬', '社畜', '肥宅', '工程師', '高中生', '貓貓', '企鵝'],
  // 大多是出生年、生日、隨便的數字；87、666 這種梗偶爾才出現，太常見會露餡
  num: () => Math.random() < .12 ? pickOne(['87', '666', '520', '168', '1314', '999']) : pickOne([String(70 + Math.floor(Math.random() * 30)), String(1990 + Math.floor(Math.random() * 22)), String(Math.floor(Math.random() * 12) + 1).padStart(2, '0') + String(Math.floor(Math.random() * 28) + 1).padStart(2, '0'), String(Math.floor(Math.random() * 1000))]),
};
// 亂碼帳號（大部分）：真人懶得取名時打的那種——隨手按的字母＋數字、鍵盤順手按、預設帳號、英文名＋生日；偶爾才是中文暱稱
const rkRnd = (set, n) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join('');
const RK_ABC = 'abcdefghijklmnopqrstuvwxyz', RK_CV = ['ba', 'ke', 'mo', 'ri', 'su', 'ta', 'yo', 'zu', 'xi', 'qi', 'lu', 'na', 'pe', 'wo', 'ji', 'ha', 'ko', 'ne'];
const RK_GIB = [
  () => rkRnd(RK_ABC, 3 + Math.floor(Math.random() * 4)) + rkRnd('0123456789', 2 + Math.floor(Math.random() * 4)), // xkqr0812
  () => rkRnd(RK_ABC, 5 + Math.floor(Math.random() * 4)), // fjdkslq
  () => rkRnd(RK_ABC + '0123456789', 7 + Math.floor(Math.random() * 3)), // k3j9dq2m
  () => pickOne(['qwe', 'asd', 'zxc', 'qaz', 'wsx', 'asdf', 'qwer', 'zxcv', 'aaa', 'abc', 'jkl', 'qq', 'ss', 'zz']) + rkRnd('0123456789', 2 + Math.floor(Math.random() * 4)), // zxc5566
  () => pickOne(['user', 'player', 'guest', 'ssb', 'tw', 'yt']) + rkRnd('0123456789', 4 + Math.floor(Math.random() * 4)), // user3381920
  () => rkRnd(RK_CV, 2 + Math.floor(Math.random() * 2)) + (Math.random() < .5 ? rkRnd('0123456789', 2 + Math.floor(Math.random() * 3)) : ''), // kemozu27
  () => rkRnd(RK_ABC, 2) + '_' + rkRnd(RK_ABC + '0123456789', 3 + Math.floor(Math.random() * 4)), // tk_9fq2
  () => { const s = rkRnd(RK_ABC, 4 + Math.floor(Math.random() * 3)); return s[0].toUpperCase() + s.slice(1) + RK_NM.num(); }, // Qiruk1998
];
function rkName() {
  const N = RK_NM, cap = s => s[0].toUpperCase() + s.slice(1), mine = myName();
  const make = [
    ...RK_GIB, ...RK_GIB, ...RK_GIB, // 亂碼帳號佔大多數（約八成）
    () => pickOne(N.en) + N.num(), () => cap(pickOne(N.en)) + cap(pickOne(N.last)) + N.num(), () => pickOne(N.en) + '_' + pickOne(N.last) + N.num(),
    () => pickOne(N.nick) + N.num(), () => pickOne(N.say), () => pickOne(N.adj) + pickOne(N.noun),
  ];
  for (let i = 0; i < 30; i++) {
    const s = pickOne(make)().slice(0, 12);
    if (s !== mine && !RK.names.includes(s)) { RK.names.push(s); if (RK.names.length > 40) RK.names.shift(); return s; }
  }
  return pickOne(N.nick) + Date.now() % 10000;
}
// 真人大多穿預設造型或便宜的，不會每個都穿最貴的
const RK_SKINS = ['teacher', 'teacher', 'teacher', 'teacher', 'teacher', 'rider', 'rider', 'auntie', 'mascot', 'trump', 'bear', 'master'];
const RK = { on: false, bot: null, draft: null, qT: 0, qRaf: 0, tmT: 0, names: [] };
const rkTier = mmr => { let i = 0; RK_TIERS.forEach((t, j) => { if (mmr >= t[2]) i = j; }); return i; };
const rkProf = () => { const pf = profLoad(); pf.rank = Object.assign({ mmr: 1000, games: 0, wins: 0, streak: 0 }, pf.rank); return pf; };
// 六角段位徽章（白金以上多一對翅膀），中間一個字
const RK_COL = [['#b8763e', '#6e3d17', '銅'], ['#d7dee8', '#7d8796', '銀'], ['#ffd25a', '#a66a14', '金'], ['#7fe0d6', '#2a8a84', '白'], ['#7fb4ff', '#2c55b8', '鑽'], ['#d39bff', '#6a2fb0', '星'], ['#ff7a95', '#a3173a', '師']];
let rkCrestN = 0;
function rkCrest(t, on) {
  const [c1, c2, ch] = RK_COL[t], id = 'rkc' + (rkCrestN++);
  return `<svg viewBox="0 0 120 120"${on ? ' class="on"' : ''}><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
    + (t >= 3 ? `<path d="M22 60 Q4 40 10 18 Q24 34 34 46Z M98 60 Q116 40 110 18 Q96 34 86 46Z" fill="url(#${id})" stroke="#3a2a10" stroke-width="2"/>` : '')
    + `<polygon points="60,8 102,32 102,84 60,110 18,84 18,32" fill="url(#${id})" stroke="#3a2a10" stroke-width="3"/><polygon points="60,22 90,39 90,77 60,95 30,77 30,39" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2"/>`
    + `<text x="60" y="71" text-anchor="middle" font-size="28" font-weight="900" fill="#2a1a00" font-family="Noto Serif TC,Songti TC,PMingLiU,serif">${ch}</text></svg>`;
}
// 這個對手實際的設定：青銅（1050 分）、白銀（1150）、黃金（1250）以下半／上半分兩級，白金以上一階一種
function rkCfg(b = RK.bot) { return b.tier <= 2 ? RK_LOW[b.tier * 2 + (b.mmr >= RK_TIERS[b.tier + 1][2] - 50 ? 1 : 0)] : RK_BOT[b.tier]; }
function rkShow(v) { for (const id of ['rkHome', 'rkQueue', 'rkDraft', 'rkRes']) $(id).classList.toggle('hide', id !== v); }
function rkBadge(mmr, ic, tier, pts) {
  const i = rkTier(mmr), t = RK_TIERS[i], nx = RK_TIERS[i + 1];
  $(ic).innerHTML = rkCrest(i); $(tier).textContent = t[0];
  $(pts).textContent = nx ? '分數 ' + Math.round(mmr) + '　·　距離' + nx[0] + ' ' + Math.ceil(nx[2] - mmr) + ' 分' : '分數 ' + Math.round(mmr) + '　·　最高段位';
  return i;
}
function rkOpen() {
  RK.on = false; mode = 'lobby'; $('rkPanel').classList.remove('hide'); rkShow('rkHome');
  const r = rkProf().rank, i = rkBadge(r.mmr, 'rkIc', 'rkTier', 'rkPts'), lo = RK_TIERS[i][2], hi = RK_TIERS[i + 1] ? RK_TIERS[i + 1][2] : lo + 100;
  $('rkFill').style.width = Math.min(100, (r.mmr - lo) / (hi - lo) * 100) + '%';
  $('rkTiers').innerHTML = RK_TIERS.map((t, j) => rkCrest(j, j === i)).join('');
  rkPickerRender();
  layoutPads();
}
// 試玩：直接挑對手段位（RK.pick）；挑了就是試打，不計分。選「自動」才照自己的段位配
function rkPickerRender() {
  const box = $('rkPicker'); box.classList.toggle('hide', !SHOW_DEMO); if (!SHOW_DEMO) return;
  box.innerHTML = '<b>對手：</b>';
  // RK.pick 存對手的分數：青銅～黃金各有弱、強兩級
  [['自動', null], ['青銅弱', 1000], ['青銅強', 1075], ['白銀弱', 1125], ['白銀強', 1175], ['黃金弱', 1225], ['黃金強', 1275], ['白金', 1350], ['鑽石', 1450], ['星耀', 1550], ['閃身步大師', 1650]].forEach(([n, mmr]) => {
    const b = document.createElement('button'); b.textContent = n; b.className = (RK.pick ?? null) === mmr ? 'on' : '';
    b.onclick = () => { RK.pick = mmr; synth('pop'); rkPickerRender(); }; box.appendChild(b);
  });
}
$('rkBack').onclick = () => { rkStopQueue(); $('rkPanel').classList.add('hide'); mode = 'title'; layoutPads(); };
$('rkHomeBtn').onclick = rkOpen;
// 配對中：小人在畫面上用閃身步左右來回閃（帶殘影）
// 先去伺服器排真人（/mm）；排滿 15 秒沒人就問伺服器「我要放棄」，伺服器說 bot 才改配電腦（伺服器說了算，不會兩邊都配到）
// 連不上配對伺服器（例如本機用一般網頁伺服器開）就照樣等滿 15 秒配電腦。試玩挑了對手段位＝直接配電腦（3～6 秒）
const RK_WAIT = 15000;
function rkQueue() {
  rkShow('rkQueue'); RK.qT = performance.now(); RK.draft = null; RK.human = false; RK.ended = false; RK.gaveUp = false; RK.mmOld = false; RK.mmFail = false; RK.queuing = true;
  rkPickBot(); RK.fb = RK.bot; const gen = rkCfg().gen, key = gen === 'old' ? 'general' : gen; nnLoadGeneral(gen); // 一開始配對就先下載備用電腦的模型
  let wait = RK.bot.picked ? 3000 + Math.random() * 3000 : Infinity; // Infinity＝等伺服器回話
  if (!RK.bot.picked) rkMmStart(() => { wait = 0; });
  const c = $('rkQueueCv'), g = c.getContext('2d'), dummy = new Fighter('p1', 0, 1); dummy.char = profLoad().skin || 'teacher';
  const trail = [];
  (function loop(now) {
    const el = (now - RK.qT) / 1000;
    // 後面那段看得出有沒有連上配對伺服器、現在幾個人在排（朋友同時按卻只顯示 1 人＝兩邊開的不是同一個版本／網址）
    const mmTxt = RK.bot.picked ? '（試打：直接配電腦）' : RK.mmOld ? '（你的遊戲版本比對手舊：請重新整理網頁）' : RK.mmOk ? '（排隊中 ' + Math.max(1, RK.qn || 1) + ' 人）' : RK.mmFail ? '（連不上配對伺服器，重試中）' : '';
    if (!RK.human) $('rkQTime').textContent = '配對中 00:' + String(Math.floor(el)).padStart(2, '0') + mmTxt;
    // 每 1.2 秒閃一次：0～0.55 秒是閃身步動作，位置在左右兩點之間瞬移
    const cyc = el % 2.4, half = cyc < 1.2 ? 0 : 1, lt = cyc % 1.2, from = half ? 420 : 140, to = half ? 140 : 420;
    const k = Math.min(1, Math.max(0, (lt - .1) / .2)), x = from + (to - from) * (k * k * (3 - 2 * k));
    if (lt > .1 && lt < .3) trail.push({ x, t: now }); while (trail.length && now - trail[0].t > 350) trail.shift();
    const pose = lt < .55 ? sampleKeys(SV().keys, Math.min(.55, lt)) : N, f = to > from ? 1 : -1;
    const old = ctx; ctx = g; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 560, 280);
    g.fillStyle = 'rgba(0,20,50,.3)'; g.fillRect(0, 250, 560, 30);
    ctx.setTransform(.55, 0, 0, .55, 0, 262 - GROUND * .55);
    for (const tr of trail) { ctx.save(); ctx.globalAlpha = .35 * (1 - (now - tr.t) / 350); try { drawFighter(dummy, pose, { x: tr.x / .55, y: 0, f, tone: GHOST_TONE }); } catch (e) {} ctx.restore(); }
    try { drawFighter(dummy, pose, { x: x / .55, y: 0, f }); } catch (e) {}
    ctx = old;
    if (RK.human) return; // 配到真人了：連線、選招交給 rkHumanFound
    if (!RK.bot.picked && now - RK.qT > RK_WAIT && !RK.gaveUp) { // 15 秒到：還連著配對伺服器就問它，連不上就直接配電腦
      RK.gaveUp = true;
      if (RK.mm && RK.mm.readyState === 1) { RK.mm.send(JSON.stringify({ t: 'giveup' })); setTimeout(() => { wait = 0; }, 3000); } else wait = 0;
    }
    if (now - RK.qT > wait && NN.models[key] && NN.models[key] !== 'loading') { rkFound(); return; } // 模型（3 MB）下載好才配到，免得開打時退回舊電腦
    RK.qRaf = requestAnimationFrame(loop);
  })(RK.qT);
}
// 排隊中斷線（手機切 App、換基地台）就 1 秒後重排；每 2 秒跟伺服器說一聲「還在」，伺服器不會把你配給已經不在的人
function rkMmStart(onBot) {
  clearTimeout(RK.mmRetry);
  let ws; try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/mm'); } catch (e) { RK.mmFail = true; return; }
  RK.mm = ws; RK.mmOk = false; RK.qn = 0;
  ws.onopen = () => { if (RK.mm === ws) RK.mmOk = true, RK.mmFail = false, ws.send(JSON.stringify({ t: 'join', v: NET_V, name: myName() || rkName(), mmr: rkProf().rank.mmr, skin: profLoad().skin || 'teacher', vid: SHOW_DEMO ? '' : stat.vid })); }; // 本機／測試版不帶 vid：同一個瀏覽器兩個分頁才配得到
  const ka = setInterval(() => { if (RK.mm === ws && ws.readyState === 1) ws.send('{"t":"ka"}'); else clearInterval(ka); }, 2000);
  ws.onmessage = e => {
    if (RK.mm !== ws) return; const m = JSON.parse(e.data);
    if (m.t === 'q') RK.qn = m.n;
    else if (m.t === 'old') RK.mmOld = true;
    else if (m.t === 'bot') { rkMmClose(); onBot(); } else if (m.t === 'match') { rkMmClose(); rkHumanFound(m); }
  };
  ws.onclose = () => {
    clearInterval(ka); if (RK.mm !== ws) return;
    RK.mm = null; RK.mmOk = false; RK.mmFail = true;
    if (RK.queuing && !RK.human && !RK.gaveUp) RK.mmRetry = setTimeout(() => { if (RK.queuing && !RK.human && !RK.gaveUp) rkMmStart(onBot); }, 1000);
  };
}
function rkMmClose() { clearTimeout(RK.mmRetry); const ws = RK.mm; RK.mm = null; try { if (ws) ws.close(1000); } catch (e) {} }
function rkStopQueue() { RK.queuing = false; cancelAnimationFrame(RK.qRaf); clearInterval(RK.tmT); rkMmClose(); }
$('rkGo').onclick = () => { unlockAudio(); synth('pop'); rkQueue(); };
$('rkCancel').onclick = () => { rkStopQueue(); clearTimeout(RK.connT); if (net.rk) { netLeave(); netReset(); } RK.human = false; rkOpen(); };
$('rkAgain').onclick = () => { unlockAudio(); rkQueue(); };
// 配到電腦：段位在你上下一階內、分數差不超過 80
function rkFound() { rkStopQueue(); synth('gong'); rkDraftStart(); }
// 配到真人：用配對給的房號連線（先排的當房主）。12 秒內沒連上就改配電腦
function rkHumanFound(m) {
  const f = m.foe || {}; RK.human = true; RK.pendA = {}; RK.pendR = null;
  RK.bot = { picked: false, human: true, name: String(f.name || '玩家').slice(0, 12), mmr: +f.mmr || 1000, tier: rkTier(+f.mmr || 1000), char: okSkin(f.skin) ? f.skin : 'teacher' };
  $('rkQTime').textContent = '找到對手，連線中…';
  netConnect(m.role, m.room, false, true);
  clearTimeout(RK.connT);
  RK.connT = setTimeout(() => { if (!RK.draft && RK.human) { netLeave(); RK.human = false; RK.bot = RK.fb; rkFound(); } }, 12000);
}
function rkPeerOn() {
  clearTimeout(RK.connT); clearTimeout(RK.dropT);
  if (net.role === 'host') rtcStart();
  if (RK.draft) { if (net.role === 'host' && RB.on) rbRestart(); return; } // 斷線又接回來：照原本進度繼續（打到一半：房主把現在的狀態整份傳過去）
  if (net.role === 'host') {
    net.peerSkin = RK.bot.char;
    const pool = rkPool(), hostFirst = Math.random() < .5; // 房主決定公開哪 10 招、誰先手，告訴對手
    netSend(JSON.stringify({ t: 'rkd', pool, first: hostFirst ? 'host' : 'guest', v: NET_V }));
    synth('gong'); rkDraftStart(pool, hostFirst);
  } else { netSkin(); synth('gong'); }
}
// 對手斷線：等 10 秒回來；回不來＝開打前不計分、開打後算贏的那邊（自己斷線回不來的那邊算輸）
function rkPeerOff() {
  if (RK.ended || !RK.human) return;
  clearTimeout(RK.dropT);
  RK.dropT = setTimeout(() => {
    if (net.peer || RK.ended || !RK.human) return;
    const meOk = net.ws && net.ws.readyState === 1;
    if (RK.on && RK.draft && RK.draft.started) { rkEnd(meOk); RK.last.note = meOk ? '　對手中離' : '　你斷線了'; rkResult(); }
    else rkNetFail(meOk ? '對手離線了，這場不計分' : '連線中斷了，這場不計分');
  }, 10000);
}
function rkNetFail(msg) {
  clearTimeout(RK.connT); clearTimeout(RK.dropT); clearInterval(RK.tmT);
  netLeave(); netReset(); RK.human = false; RK.draft = null; RK.on = false; // netReset：斷線重連中（還沒有 ws）也要停掉重連
  rkOpen(); chestToast('⚠ ' + msg);
}
// 對手：分數在你上下 80 分內（所以段位是同段或上下一階）；網址加 ?rkbot=0～6 可以直接指定段位測試
function rkPickBot() {
  const url = SHOW_DEMO ? params.get('rkbot') : null, me = rkProf().rank.mmr, force = RK.pick ?? (url != null && RK_TIERS[+url] ? (RK_TIERS[+url][2] || 1000) + 50 : null), picked = force != null;
  const mmr = picked ? force : Math.max(900, me + (Math.random() * 160 - 80));
  RK.bot = { picked, name: rkName(), mmr, tier: rkTier(mmr), char: pickOne(RK_SKINS) };
}
// ---- ban/pick：公開 10 招（至少 4 招會打人）→ 先手 ban、後手 ban → 先手選 1、後手選 2、先手選 2、後手選 1；每步 30 秒 ----
const rkHurts = k => ORIG[k] ? k !== 'shan' : MOVES[k].ev.some(e => e.hit || e.proj || e.grab);
function rkPool() {
  const all = EXT_POOL().sort(() => Math.random() - .5), hurt = all.filter(rkHurts).slice(0, 4), rest = all.filter(k => !hurt.includes(k)).slice(0, 6);
  return [...hurt, ...rest].sort(() => Math.random() - .5);
}
const RK_STEPS = [['ban', 0], ['ban', 1], ['pick', 0], ['pick', 1], ['pick', 1], ['pick', 0], ['pick', 0], ['pick', 1]]; // 0＝先手
function rkDraftStart(pool = rkPool(), meFirst = Math.random() < .5) { // 真人對戰：房主決定 pool、先手，兩邊用同一份
  RK.draft = { pool, first: meFirst ? 'me' : 'foe', step: 0, ban: { me: null, foe: null }, pick: { me: [], foe: [] }, left: 30 };
  rkShow('rkDraft'); rkDraftRender(); rkTurn();
}
const rkWho = s => (RK_STEPS[s][1] === 0) === (RK.draft.first === 'me') ? 'me' : 'foe';
// 兩邊：名字、ban 一格、三個金框招式格（對手還沒選的顯示 ?）
const rkEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function rkSideHTML(side, title, turn) {
  const d = RK.draft;
  return '<h4>' + rkEsc(title) + '</h4><div class="rkBanBox">' + (d.ban[side] ? '✕ ' + rkEsc(skName(d.ban[side])) : 'BAN') + '</div>'
    + [0, 1, 2].map(i => { const k = d.pick[side][i]; return '<div class="rkSlot' + (k ? ' filled' : '') + '"><b><span>' + (k ? rkEsc(skChar(k)) : side === 'me' ? 'JKL'[i] : '?') + '</span></b>' + (k ? rkEsc(skName(k)) : '') + '</div>'; }).join('');
}
function rkTimer(left, total) { $('rkTm').textContent = left; $('rkRingI').style.setProperty('--p', Math.max(0, left / total * 100) + '%'); }
function rkDraftRender() {
  const d = RK.draft, b = RK.bot, done = d.step >= RK_STEPS.length, who = done ? null : rkWho(d.step), act = done ? '' : RK_STEPS[d.step][0];
  $('rkMe').innerHTML = rkSideHTML('me', '你・' + RK_TIERS[rkTier(rkProf().rank.mmr)][0] + (d.first === 'me' ? '・先手' : ''));
  $('rkFoe').innerHTML = rkSideHTML('foe', b.name + '・' + RK_TIERS[b.tier][0] + (d.first === 'foe' ? '・先手' : ''));
  $('rkMe').classList.toggle('turn', who === 'me'); $('rkFoe').classList.toggle('turn', who === 'foe');
  $('rkStep').textContent = done ? '選招完成' : (who === 'me' ? '換你' : '對手') + (act === 'ban' ? ' ban 一招' : '選招');
  if (done) $('rkTm').textContent = '✓'; else rkTimer(d.left, 30); $('rkOrder').textContent = '';
  const used = new Set([d.ban.me, d.ban.foe, ...d.pick.me, ...d.pick.foe]), pool = $('rkPool'); pool.textContent = '';
  for (const k of d.pool) {
    const bt = document.createElement('button'); bt.innerHTML = '<i></i><span></span>'; bt.firstChild.textContent = skChar(k); bt.lastChild.textContent = skName(k);
    if (d.ban.me === k || d.ban.foe === k) bt.classList.add('ban'); else if (d.pick.me.includes(k)) bt.classList.add('me'); else if (d.pick.foe.includes(k)) bt.classList.add('foe');
    bt.title = ORIG[k] ? '' : MOVES[k].desc;
    bt.disabled = done || who !== 'me' || used.has(k);
    bt.onclick = () => rkAct('me', k);
    pool.appendChild(bt);
  }
}
function rkLeft() { const d = RK.draft, used = new Set([d.ban.me, d.ban.foe, ...d.pick.me, ...d.pick.foe]); return d.pool.filter(k => !used.has(k)); }
function rkAct(side, k) {
  const d = RK.draft; if (d.step >= RK_STEPS.length || rkWho(d.step) !== side || !rkLeft().includes(k)) return;
  if (RK_STEPS[d.step][0] === 'ban') d.ban[side] = k; else d.pick[side].push(k);
  if (RK.human && side === 'me') netSend(JSON.stringify({ t: 'rka', s: d.step, k })); // 真人：告訴對方我第幾步選了什麼
  synth(RK_STEPS[d.step][0] === 'ban' ? 'thud' : 'pop'); d.step++; rkDraftRender(); rkTurn();
}
// 每一步 30 秒：時間到就隨機幫你選；電腦 1～2.5 秒內出手（ban 掉會打人的招、選招至少拿一招會打人的）
function rkTurn() {
  clearInterval(RK.tmT); const d = RK.draft;
  if (d.step >= RK_STEPS.length) { setTimeout(rkArrange, 700); return; }
  d.left = 30; rkDraftRender();
  const who = rkWho(d.step);
  if (who === 'foe' && RK.human && RK.pendA && RK.pendA[d.step] !== undefined) { setTimeout(rkFlushFoe); return; } // 對手這步早就到了
  if (who === 'foe' && !RK.human) setTimeout(() => {
    // 高段：拿走或 ban 掉最強的招；低段：隨便挑。不管哪一段，第一次選招一定選會打人的招，才不會整場打不到人
    // （輪到電腦第一次選招時，最多被拿掉 3 招會打人的，公開的 10 招至少有 4 招，一定還有得選）
    const left = rkLeft(), smart = Math.random() < rkCfg().smart, hurt = left.filter(rkHurts), best = l => l.slice().sort((a, b) => (RK_WR[b] || 0) - (RK_WR[a] || 0))[0];
    const from = RK_STEPS[d.step][0] === 'pick' && !d.pick.foe.some(rkHurts) && hurt.length ? hurt : left;
    rkAct('foe', smart ? best(from) : pickOne(from));
  }, 2000 + Math.random() * 4000); // 選招像真人一樣想一下
  // 真人對手：他那邊時間到會自己幫他選；多等 15 秒還沒動靜（網頁卡住）就算對手離線
  RK.tmT = setInterval(() => { d.left--; rkTimer(Math.max(0, d.left), 30); if (d.left <= 0 && who === 'me') rkAct('me', pickOne(rkLeft())); if (d.left <= -15 && RK.human) rkNetFail('對手沒有回應，這場不計分'); }, 1000);
}
// 選完招：自己排 J／K／L 的位置（點兩招互換），15 秒，時間到或按「開打」就照目前順序
function rkArrange() {
  const d = RK.draft; if (!d) return; d.sel = -1; d.left = 15; d.arr = true; d.ready = d.ready || { me: false, foe: false }; rkArrRender(); // 真人對手可能比我先排好，ready.foe 已經收到
  if (!RK.human) setTimeout(() => { if (RK.draft === d && !d.started) rkReady('foe'); }, 3000 + Math.random() * 8000); // 電腦排好就按準備（真人要想一下）
  // 時間到：打電腦直接開打；真人＝幫我按準備，再等對手（多等 15 秒沒來＝對手離線）
  clearInterval(RK.tmT); RK.tmT = setInterval(() => {
    d.left--; rkTimer(Math.max(0, d.left), 15);
    if (d.left <= 0) { if (!RK.human) rkFight(); else if (!d.ready.me) rkReady('me'); }
    if (d.left <= -15 && RK.human) rkNetFail('對手沒有回應，這場不計分');
  }, 1000);
}
// 對手先到的選招／準備：輪到那一步（或三招都收到了）才套用
function rkFlushFoe() {
  const d = RK.draft; if (!d) return;
  const P = RK.pendA || {};
  while (d.step < RK_STEPS.length && P[d.step] !== undefined && rkWho(d.step) === 'foe') { const k = P[d.step]; delete P[d.step]; rkAct('foe', k); }
  if (RK.pendR && RK.pendR.every(k => d.pick.foe.includes(k))) { const l = RK.pendR; RK.pendR = null; rkFoeReady(l); }
}
// 真人對手排好、按了準備：照他排的順序（同一組三招才收）
function rkFoeReady(load) {
  const d = RK.draft; if (!d || d.started || !Array.isArray(load) || load.length !== 3 || !load.every(k => d.pick.foe.includes(k))) return;
  d.pick.foe = load.slice(); d.ready = d.ready || { me: false, foe: false };
  if (d.arr) rkReady('foe'); else d.ready.foe = true; // 我還沒進到排招畫面：先記著
}
function rkArrRender() {
  const d = RK.draft, pool = $('rkPool');
  $('rkStep').textContent = '排好你的招式位置'; rkTimer(d.left, 15); $('rkOrder').textContent = '點兩招互換';
  const R = d.ready, b0 = RK.bot;
  $('rkMe').innerHTML = rkSideHTML('me', '你' + (R.me ? '　✓ 已準備' : '')); $('rkMe').classList.toggle('turn', !R.me);
  $('rkFoe').innerHTML = rkSideHTML('foe', b0.name + '・' + RK_TIERS[b0.tier][0] + (R.foe ? '　✓ 已準備' : '')); $('rkFoe').classList.toggle('turn', R.foe);
  pool.textContent = '';
  d.pick.me.forEach((k, i) => {
    const b = document.createElement('button'); b.className = 'me' + (d.sel === i ? ' sel' : '');
    b.innerHTML = '<i></i><span></span>'; b.firstChild.textContent = 'JKL'[i]; b.lastChild.textContent = skName(k); b.disabled = R.me;
    b.onclick = () => {
      if (d.sel < 0) d.sel = i; else { if (d.sel !== i) [d.pick.me[d.sel], d.pick.me[i]] = [d.pick.me[i], d.pick.me[d.sel]]; d.sel = -1; synth('pop'); }
      rkArrRender();
    };
    pool.appendChild(b);
  });
  const go = document.createElement('button'); go.className = 'goBtn'; go.textContent = R.me ? '等待對手' : '準備'; go.disabled = R.me; go.onclick = () => rkReady('me'); pool.appendChild(go);
}
// 雙方都按準備就開打；時間到還沒按的算自動準備
function rkReady(side) {
  const d = RK.draft; if (!d || !d.ready || d.ready[side] || d.started) return;
  d.ready[side] = true; synth('pop'); rkArrRender();
  if (RK.human && side === 'me') netSend(JSON.stringify({ t: 'rkr', load: d.pick.me })); // 把我排好的順序給對方（房主開打時要用）
  if (d.ready.me && d.ready.foe) { clearInterval(RK.tmT); setTimeout(rkFight, 600); }
}
// 訓練出來的模型會等對手先動（實測第 12200 代對站著不動的人，25% 的場次一滴血都不打），真人站著就僵住。
// 保險：2.5 秒沒出招，就走到打得到的距離、放一招會打人的招；一出招就交回給模型。之後重訓解決了就拿掉
function rkNudge() {
  const cur = p2.act && (p2.act.type === 'mv' ? p2.act.id : p2.act.type);
  RK.idle = cur && rkHurts(cur) ? 0 : (RK.idle || 0) + 4 / 60; // 空放閃身步、擋招不算出手
  if (RK.idle < (rkCfg().nudge || 2.5) || !p2.canAct()) return;
  const dist = Math.abs(p1.x - p2.x), reach = k => k === 'ball' ? 1300 : k === 'bear' ? 175 : mvCat(k) === 'proj' ? 900 : Math.max(120, mvReach(k));
  const slots = [0, 1, 2].filter(i => rkHurts(p2.load[i]) && slotReady(p2, p2.load[i]));
  const fire = slots.find(i => dist <= reach(p2.load[i])), toward = p1.x > p2.x;
  Object.assign(cpuInput, { L: !toward, R: toward, U: false, Up: false, S1: fire === 0, S2: fire === 1, S3: fire === 2 });
}
function rkFight() {
  const d = RK.draft, b = RK.bot;
  if (!d || d.started) return; d.started = true; RK.idle = 0; // 按「開打」和時間到只算一次
  clearInterval(RK.tmT); $('rkPanel').classList.add('hide'); unlockAudio();
  if (RK.human) { // 真人：照線上對戰（1P＝房主）；房主開場後把狀態傳過來，兩邊一起算
    if (net.role === 'host') {
      mode = 'title'; startMatch(false, 'rank'); RK.on = true;
      p1.load = d.pick.me.slice(); p2.load = d.pick.foe.slice(); p1.used = [0, 0, 0]; p2.used = [0, 0, 0]; p2.char = b.char;
      banner = { text: '排位賽', sub: (myName() || '我') + ' vs ' + b.name, t: 0 }; // 兩邊看到同一個橫幅
    } else { vsCPU = false; if (!RB.on) { p1 = null; mode = 'intro'; } RK.on = true; stat.start('rank', 'guest'); } // 房主先按開打、開場狀態已經到了：不要蓋掉
    layoutPads(); return;
  }
  const bot = rkCfg(b);
  mode = 'title'; startMatch(true, 'rank'); RK.on = true;
  p1.load = d.pick.me.slice(); p2.load = d.pick.foe.slice(); p1.used = [0, 0, 0]; p2.used = [0, 0, 0]; p2.char = b.char;
  NN.comboMatch = true; NN.matchGen = bot.gen; NN.mc = { delay: bot.delay, eps: bot.eps, gap: bot.gap }; NN.wait = 0; // 這個段位對應的那一代模型
  banner = { text: '排位賽', sub: '對手：' + b.name + '（' + RK_TIERS[b.tier][0] + '）', t: 0 };
  layoutPads();
}
// 一場打完：贏＝連勝加分，第 1 場 +10、第 2 場 +15、第 3 場 +20……每場多 5，最多 +50；
// 輸＝照 Elo 扣（K＝前 10 場 40、之後 24，再減半），連勝歸零。真人、電腦算法一樣（電腦要裝成真人，不能算分露餡）
const rkWinPts = streak => Math.min(50, 10 + 5 * streak);
function rkEnd(won) {
  if (RK.ended) return; RK.ended = true; // 一場只算一次（真人對戰：打完和對手中離可能同時發生）
  if (RK.bot.picked) { const t = rkTier(rkProf().rank.mmr); RK.last = { won, delta: 0, before: t, after: t, practice: true }; return; } // 自己挑的對手：不計分
  const pf = rkProf(), r = pf.rank, b = RK.bot, exp = 1 / (1 + Math.pow(10, (b.mmr - r.mmr) / 400));
  const K = (r.games < 10 ? 40 : 24) * .5, delta = won ? rkWinPts(r.streak || 0) : Math.round(K * -exp) || -1;
  r.streak = won ? (r.streak || 0) + 1 : 0;
  const before = rkTier(r.mmr); r.mmr = Math.max(0, r.mmr + delta); r.games++; if (won) r.wins++;
  pf.rank = r; profSave(pf); RK.last = { won, delta, before, after: rkTier(r.mmr), streak: r.streak };
}
function rkResult() {
  if (net.rk) { clearTimeout(RK.dropT); netLeave(); netReset(); RK.human = false; } // 真人對戰打完：離開房間
  const L = RK.last; RK.on = false; mode = 'lobby'; $('rkPanel').classList.remove('hide'); rkShow('rkRes');
  $('rkResT').textContent = L.won ? '🎉 勝利！' : '敗北…'; $('rkResT').style.color = L.won ? '#ffe600' : '#ff8a7a';
  $('rkDelta').textContent = L.practice ? '試打不計分' : (L.delta > 0 ? '+' : '') + L.delta + ' 分' + (L.streak > 1 ? '（' + L.streak + ' 連勝・下一場贏 +' + rkWinPts(L.streak) + '）' : L.streak === 1 ? '（連勝下一場 +' + rkWinPts(1) + '）' : '') + (L.note || ''); $('rkDelta').className = 'rkDelta ' + (L.practice ? '' : L.delta > 0 ? 'up' : 'dn');
  rkBadge(rkProf().rank.mmr, 'rkIc2', 'rkTier2', 'rkPts2');
  if (L.after !== L.before) $('rkTier2').textContent += L.after > L.before ? '　⬆ 升段！' : '　⬇ 降段';
  layoutPads();
}
$('omBack').onclick = () => { omClose(); mode = 'title'; layoutPads(); };
function maOpen() {
  MC.on = false; mode = 'lobby'; $('maPanel').classList.remove('hide');
  nnLoadGeneral('old'); if (!LVD.data) fetch('assets/ai/levels.json').then(r => r.json()).then(j => { LVD.data = j; }).catch(() => {});
  const done = profLoad()[mcKey()] || 0; MC.sel = Math.min(done, MC_STAGES.length - 1); maRender(); layoutPads();
}
function maRender() {
  const done = profLoad()[mcKey()] || 0, box = $('maPath'); box.textContent = ''; box.classList.toggle('many', MC_STAGES.length > 10);
  if (MC_DEMO) { // 測試版：切路線
    let rt = $('maRoute'); if (!rt) { rt = document.createElement('div'); rt.id = 'maRoute'; box.before(rt); }
    rt.textContent = '';
    for (const [k, t] of [['n', '一般路線'], ['h', '高手路線']]) {
      const b = document.createElement('button'); b.className = MC.route === k ? 'on' : ''; b.disabled = !MC_ROUTES[k];
      b.textContent = t + (MC_ROUTES[k] ? `（${MC_ROUTES[k].length} 關）` : '（還沒做好）');
      b.onclick = () => { synth('pop'); mcSetRoute(k); maRender(); }; rt.appendChild(b);
    }
  }
  if (MC_STAGES[MC.sel].gen) nnLoadGeneral(MC_STAGES[MC.sel].gen); // 新模型關卡：選到就先下載模型
  MC_STAGES.forEach((s, i) => {
    if (i) { const l = document.createElement('i'); l.className = 'maL' + (i <= done ? ' done' : ''); box.appendChild(l); }
    const st = i < done ? 'done' : i === done || MC_DEMO ? 'now' : 'lock', b = document.createElement('button'); // 測試版：每關都能直接打
    b.className = 'maN ' + st + (s.ma ? ' boss' : '') + (i === MC.sel ? ' sel' : '');
    b.innerHTML = '<span class="c"><img alt=""></span><em></em><small></small>';
    b.querySelector('img').src = faceImg(s.face || s.char); b.querySelector('em').textContent = st === 'done' ? '✔' : st === 'lock' ? '🔒' : '';
    b.lastChild.textContent = (i + 1) + '. ' + s.n + (MC_DEMO && s.diff != null ? ' ' + Math.round(s.diff * 100) + '%' : '');
    b.onclick = () => { if (st === 'lock') { synth('thud'); $('maInfo').textContent = '第 ' + (i + 1) + ' 關還沒開：先打贏前一關'; return; } synth('pop'); MC.sel = i; maRender(); };
    box.appendChild(b);
  });
  const s = MC_STAGES[MC.sel], skin = MC_SKIN[MC.sel];
  $('maInfo').textContent = '第 ' + (MC.sel + 1) + ' 關：' + s.n + (s.sub ? '（' + s.sub + '）' : '') + (MC.sel < done ? '　已過，可以再打' : '') + (skin ? '　｜　打贏送造型「' + CHARS[skin].name + '」' : '');
  if (MC_DEMO) { // 測試版：難度、電腦用哪個模型、帶什麼招、解法（tools/assets/ai/mc_design.py 量的）
    const d = document.createElement('div'); d.className = 'maDemo';
    const row = (k, v) => { const p = document.createElement('div'); const b = document.createElement('b'); b.textContent = k; p.append(b, v); d.appendChild(p); };
    row('難度', s.diff != null ? Math.round(s.diff * 100) + '%（標準玩家打不贏的比率）' : '—');
    row('電腦模型', s.ma ? '寫死的 Boss 電腦（馬師傅 ' + s.ma + ' 階）' : s.src || '—');
    row('電腦的招', s.ma ? '接／化／發＋閃電五連鞭' : s.sub || '—');
    row('解法', s.counters ? s.counters.map(c => c[1] + ' ' + Math.round(c[2] * 100) + '%').join('；') : '計算中…');
    $('maInfo').appendChild(d);
  }
}
$('maBack').onclick = () => { $('maPanel').classList.add('hide'); mode = 'title'; layoutPads(); };
$('maGo').onclick = () => { $('maPanel').classList.add('hide'); MC.i = MC.sel; mpk.mc = true; extPick(); };
function maStart(load) {
  const i = MC.i, s = MC_STAGES[i]; unlockAudio();
  startMatch(true, 'ma'); MC.on = true; MC.i = i;
  p1.load = load.slice(); p1.used = [0, 0, 0];
  if (s.ma) { maApplyTier(p2, s.ma); maSay(p2, 'wude', true); }
  else if (s.maai) { // AI 馬師傅（tools/assets/ai/runs/char_ma1）：一階的身體＋訓練出來的模型
    maApplyTier(p2, s.maai); p2.extra = ['wulian']; maSay(p2, 'wude', true);
    NN.comboMatch = true; NN.maAI = true; NN.matchGen = s.gen; nnLoadGeneral(s.gen); NN.mc = { delay: s.delay, eps: s.eps };
  } else {
    p2.char = s.char; const lv = s.gen ? null : mcLevel(s);
    if (s.gen) { NN.comboMatch = true; NN.matchGen = s.gen; nnLoadGeneral(s.gen); NN.mc = { delay: s.delay, eps: s.eps }; p2.load = s.ai.slice(); p2.used = [0, 0, 0]; } // 新模型關卡：逐招特訓某一階段的模型
    else if (lv) { NN.comboMatch = true; NN.matchGen = 'old'; NN.mc = { delay: lv.delay, eps: lv.eps }; /* 固定舊版：這幾關的難度是照它設計的 */ p2.load = lv.ai.slice(); p2.used = [0, 0, 0]; } // 通用 AI 照關卡設定打
    else { p2.atk = bossMoves(3); p2.load = p2.atk.slice(0, 3); p2.ldCool = 1; } // 關卡資料沒載到：退回一般電腦
  }
  banner = { text: '第 ' + (i + 1) + ' 關', sub: s.n + (s.sub ? '（' + s.sub + '）' : ''), t: 0 };
  layoutPads();
}
function maStageEnd(won) {
  if (!won) return;
  const pf = profLoad(), K = mcKey(), N = MC_STAGES.length, first = (pf[K] || 0) <= MC.i, skin = MC_SKIN[MC.i];
  pf[K] = Math.max(pf[K] || 0, MC.i + 1);
  let msg = first ? '過關！' + (MC.i + 2 <= N ? '第 ' + (MC.i + 2) + ' 關開了' : N + ' 關全破！') : '再次過關！';
  if (skin && !pf.skins.includes(skin)) { pf.skins.push(skin); msg += '　獲得造型「' + CHARS[skin].name + '」，去衣櫃換上吧'; }
  profSave(pf); setTimeout(() => chestToast('⚡ ' + msg), 2600);
}
if (/^ma[123]?$/.test(params.get('vs') || '')) setTimeout(() => maTrial(+(params.get('vs')[2] || 1)), 400); // 分享連結：?vs=ma2 直接打 2 階
// 招式對應台詞：五連鞭／發（左正蹬那句，動作照語音節奏）／接＝很快啊／化＝來騙來偷襲；玩家穿馬師傅用一般招時偶爾講一句
const MA_MOVE_LINE = { wulian: 'wulian', fa: 'deng', jie: 'kuai', hua: 'pian' };
function maOnMove(ft, id) {
  if (MA_MOVE_LINE[id]) maSay(ft, MA_MOVE_LINE[id], true);
  else if (Math.random() < .3) maSay(ft, Math.random() < .6 ? 'kuai' : 'pian');
}
function maOnHit(att, tgt) {
  if (isMa(tgt.char)) { if (tgt.hp <= 0) maSay(tgt, 'dayi'); else if (Math.random() < .12) maSay(tgt, Math.random() < .6 ? 'dayi' : 'pian'); }
  else if (isMa(att.char) && tgt.hp <= 0) maSay(att, 'haozi');
}
// ---------- 🧪 招式練習場：33 招任挑 3 招放進 J／K／L、無冷卻、對手不會死，每一下打多少都記下來 ----------
const PR = { on: false, load: ['shan', 'ball', 'bear'], sel: 0, noCd: true, foe: 'dummy', sum: {}, log: [], dirty: true, throwT: 0 };
const PR_FOE = { dummy: '對手：木樁', ball: '對手：會丟球的木樁', cpu: '對手：電腦' }; // 馬師傅計畫暫停：先拿掉（要加回來就補 ma: '對手：馬師傅（五連鞭）'）
if (SHOW_DEMO) Object.assign(PR_FOE, { cxk: '對手：蔡徐坤（木樁）', trump: '對手：懂王（木樁）', chiang: '對手：蔣萬安（木樁）', shen: '對手：沈伯洋（木樁）' }); // 試作角色當木樁
function prOpen() {
  goHome(false); menuDrop.classList.add('hide');
  PR.on = true; RG.on = false; ladder.on = false; vsCPU = PR.foe === 'cpu';
  p1 = new Fighter('p1', 380, 1); p2 = new Fighter('p2', 900, -1);
  p1.char = profLoad().skin || 'teacher'; p1.load = PR.load.slice();
  prFoeSet(); balls = []; ghosts = []; fx = []; captions = []; banner = null; wins = [0, 0]; round = 1; timer = 60;
  mode = 'fight'; stateT = 0;
  document.body.classList.add('practice'); $('prPanel').classList.remove('hide');
  prRender(); layoutPads();
}
function prClose() { PR.on = false; document.body.classList.remove('practice'); $('prPanel').classList.add('hide'); stickLayout(); }
function prFoeSet() { // 木樁＝站著不動（自己有按鍵狀態，不吃鍵盤）；電腦＝一般對戰電腦
  if (!PR_FOE[PR.foe]) PR.foe = 'dummy';
  vsCPU = PR.foe === 'cpu';
  if (!p2) return;
  p2.ai = PR.foe === 'cpu' ? null : { inp: { L: false, R: false, U: false, Up: false, S1: false, S2: false, S3: false } };
  p2.char = PR.foe === 'ma' ? 'ma' : ['cxk', 'trump', 'chiang', 'shen'].includes(PR.foe) ? PR.foe : undefined; if (PR.foe === 'ma') maSay(p2, 'wude');
  $('prFoe').textContent = PR_FOE[PR.foe];
}
function prTick() {
  timer = 60;
  for (const ft of [p1, p2]) if (ft.ko) { ft.ko = false; ft.koT = undefined; ft.hp = ft.hpShow = 200; ft.vy = 0; ft.y = 0; ft.stun = 0; ft.act = null; }
  if (PR.noCd) { for (const k in p1.cd) p1.cd[k] = 0; p1.mvcd = {}; }
  if (PR.foe === 'ball' && p2.canAct()) { PR.throwT -= 1 / 60; if (PR.throwT <= 0 && p2.grounded) { PR.throwT = 2.2; p2.face = Math.sign(p1.x - p2.x) || -1; doSkill(p2, p1, {}, 'ball'); } }
  if (PR.foe === 'ma' && p2.canAct()) { PR.throwT -= 1 / 60; if (PR.throwT <= 0 && p2.grounded) { PR.throwT = 3; p2.face = Math.sign(p1.x - p2.x) || -1; doMove(p2, p1, 'wulian'); } } // 馬師傅木樁：每 3 秒一套五連鞭
  if (PR.dirty) prLogRender();
}
function prHit(att, dmg) {
  const src = att.act ? (att.act.type === 'mv' ? att.act.id : att.act.type) : att._last;
  const mine = att === p1, nm = src && (ORIG[src] || MOVES[src]) ? skName(src) : '？';
  if (mine) { const s = PR.sum[nm] || (PR.sum[nm] = { d: 0, n: 0 }); s.d += dmg; s.n++; }
  PR.log.unshift((mine ? '你　' : '對手') + '　' + nm + '　-' + dmg); PR.log.length = Math.min(PR.log.length, 12);
  PR.dirty = true;
}
function prLogRender() {
  PR.dirty = false;
  const box = $('prLog'); box.textContent = '';
  const rows = Object.entries(PR.sum).sort((a, b) => b[1].d - a[1].d);
  for (const [nm, s] of rows) { const d = document.createElement('div'); d.className = 'sum'; d.textContent = nm + '：共 ' + s.d + '（' + s.n + ' 下，平均 ' + (s.d / s.n).toFixed(1) + '）'; box.appendChild(d); }
  for (const t of PR.log) { const d = document.createElement('div'); d.textContent = t; box.appendChild(d); }
  if (!rows.length && !PR.log.length) box.innerHTML = '<div style="color:#6f8aa5">打中了就會記在這裡</div>';
}
function prRender() {
  const sl = $('prSlots'); sl.textContent = '';
  ['J', 'K', 'L'].forEach((key, i) => {
    const b = document.createElement('button'); b.className = i === PR.sel ? 'on' : '';
    b.innerHTML = '<small></small><span></span>'; b.querySelector('small').textContent = key + ' 鍵'; b.lastChild.textContent = skName(PR.load[i]);
    b.onclick = () => { PR.sel = i; prRender(); b.blur(); }; sl.appendChild(b);
  });
  const ls = $('prList'); ls.textContent = '';
  for (const k of [...(SHOW_DEMO ? YT_IDS : []), ...EXT_POOL()]) { // 測試版：試作的招排最前面
    const b = document.createElement('button'); b.className = PR.load.includes(k) ? 'in' : '';
    b.innerHTML = '<b></b><span></span>'; b.firstChild.textContent = skName(k);
    b.lastChild.textContent = '冷卻 ' + skMax(k) + ' 秒'; b.title = ORIG[k] ? '' : MOVES[k].desc;
    if (MOVES[k] && MOVES[k].demo) { b.style.borderColor = '#ff7ad9'; b.lastChild.textContent += '｜試作'; }
    b.onclick = () => { // 放進選中的格子；同一招已經在別格就互換
      const j = PR.load.indexOf(k); if (j >= 0) PR.load[j] = PR.load[PR.sel];
      PR.load[PR.sel] = k; PR.sel = (PR.sel + 1) % 3;
      if (p1) { p1.load = PR.load.slice(); p1.used = [0, 0, 0]; }
      prRender(); layoutPads(); b.blur();
    };
    ls.appendChild(b);
  }
  $('prCd').textContent = '無冷卻：' + (PR.noCd ? '開' : '關'); $('prCd').classList.toggle('on', PR.noCd);
  $('prFoe').textContent = PR_FOE[PR.foe];
  prLogRender();
}
$('prBtn').onclick = prOpen;
const stickLabel = () => { $('stickBtn').lastChild.textContent = STICK ? '搖桿操作：開' : '搖桿操作：關（舊按鈕）'; };
$('stickBtn').onclick = () => { STICK = !STICK; lsSet('ssb_pad', STICK ? 'stick' : 'old'); stickLabel(); layoutPads(); };
stickLabel(); if (!isTouch) $('stickBtn').style.display = 'none'; // 電腦版不顯示這個選項
// AI 對手（試玩）：對戰電腦時，換成訓練出來的神經網路（關→弱→中→強）
const aiLabel = () => { $('aiBtn').lastChild.textContent = 'AI 對手（試玩）：' + NN_TIERS[NN.tier]; };
$('aiBtn').onclick = () => { const ks = Object.keys(NN_TIERS); NN.tier = ks[(ks.indexOf(NN.tier) + 1) % ks.length]; lsSet('ssb_ai', NN.tier); nnLoad(NN.tier); aiLabel(); };
aiLabel();
$('prCd').onclick = e => { PR.noCd = !PR.noCd; prRender(); e.target.blur(); };
$('prFoe').onclick = e => { const ks = Object.keys(PR_FOE); PR.foe = ks[(ks.indexOf(PR.foe) + 1) % ks.length]; PR.throwT = 1; prFoeSet(); e.target.blur(); };
$('prRand').onclick = e => { PR.load = EXT_POOL().sort(() => Math.random() - .5).slice(0, 3); if (p1) p1.load = PR.load.slice(); prRender(); layoutPads(); e.target.blur(); };
$('prReset').onclick = e => { for (const [ft, x, f] of [[p1, 380, 1], [p2, 900, -1]]) { const ld = ft.load, ai = ft.ai, ch = ft.char; ft.reset(x, f); ft.load = ld; ft.ai = ai; ft.char = ch; } balls = []; e.target.blur(); };
$('prClr').onclick = e => { PR.sum = {}; PR.log = []; prLogRender(); e.target.blur(); };
document.querySelectorAll('.prMa').forEach(b => b.onclick = () => { const ld = PR.load.slice(); b.blur(); maTrial(+b.dataset.t, ld); });
$('prPanel').querySelectorAll('.prMa').forEach(b => { b.style.background = '#7a3a12'; b.style.color = '#ffe600'; });
if (params.get('practice') === '1') { // 分享連結：?practice=1&load=dahu,ball,bear 直接帶好三招
  const ld = [...new Set((params.get('load') || '').split(',').filter(k => EXT_POOL().includes(k)))];
  PR.load = ld.concat(['shan', 'ball', 'bear'].filter(k => !ld.includes(k))).slice(0, 3); // 指定的放前面，不足用原本三招補
  setTimeout(prOpen, 300);
}
// ---------- 開場：取名＋選難度＋排行榜（前 100 名，分難度）----------
function rgOpen() {
  netLeave(); ladder.on = false; RG.on = false; mode = 'lobby';
  $('rgTitle').textContent = '闖關模式';
  $('rgCardsWrap').classList.add('hide'); $('rgOverWrap').classList.add('hide'); $('rgTreeWrap').classList.add('hide'); $('rgStartWrap').classList.remove('hide'); $('rgPanel').classList.remove('hide');
  const sv = rgSaved(), cb = $('rgCont'); cb.classList.toggle('hide', !sv);
  if (sv) { cb.innerHTML = '▶ 繼續上次闖關<small></small>'; cb.lastChild.textContent = RG_DIFF[sv.diff].name + '・' + (sv.pick ? '第 ' + sv.stage + ' 關已過，選強化' : '第 ' + sv.stage + ' 關') + '・新招 ' + sv.extra.length + ' 個'; }
  rgTab(RG.diff || 'normal'); layoutPads();
}
$('rgCont').onclick = () => {
  const sv = rgSaved(), name = myName(); if (!sv) { rgOpen(); return; }
  if (!name) { needName(() => $('rgCont').onclick()); return; }
  RG.name = name; unlockAudio(); rgStart(sv.diff, sv);
};
function rgTab(diff) {
  RG.view = diff;
  document.querySelectorAll('#rgTabs button').forEach(b => b.classList.toggle('on', b.dataset.d === diff));
  rgBoard(diff);
}
function rgGo(diff) {
  const name = myName();
  if (!name) { needName(() => rgGo(diff)); return; }
  const sv = rgSaved(); if (sv && !confirm('重新開始會蓋掉上次的進度（' + RG_DIFF[sv.diff].name + '・第 ' + sv.stage + ' 關），確定嗎？')) return;
  RG.name = name; unlockAudio(); rgStart(diff);
}
async function rgBoard(diff, post) {
  const lists = document.querySelectorAll('.rgList');
  RG.boardErr = null;
  try {
    const ck = 'rogue:' + diff, c = boardCache[ck];
    let d;
    if (!post && c && Date.now() - c.at < 60e3) d = c.d;
    else {
      const r = await fetch('/api/rogue' + (post ? '' : '?diff=' + diff + '&vid=' + encodeURIComponent(stat.vid)), post ? { method: 'POST', body: JSON.stringify(post) } : {});
      d = await r.json(); if (!r.ok) throw new Error(d.error || 'server');
      boardCache[ck] = { at: Date.now(), d };
    }
    lists.forEach(ol => {
      ol.textContent = '';
      if (!d.top.length) { const li = document.createElement('li'); li.textContent = '還沒有人上榜，第一名就是你！'; ol.appendChild(li); }
      d.top.forEach((x, i) => {
        const li = document.createElement('li'); if (d.me && d.me.rank === i + 1) li.className = 'me';
        const b = document.createElement('b'); b.textContent = (i + 1) + '.';
        const n = document.createElement('span'); n.textContent = x.name;
        const v = document.createElement('i'); v.textContent = '過 ' + x.best + ' 關｜擊倒 ' + x.kills;
        li.append(b, n, v); ol.appendChild(li);
      });
    });
    $('rgErr').textContent = ''; return d;
  } catch (e) { $('rgErr').textContent = '排行榜暫時連不上' + (e.message && !/fetch|JSON|server|bad/i.test(e.message) ? '：' + e.message : ''); RG.boardErr = e.message; return null; }
}
document.querySelectorAll('#rgTabs button').forEach(b => b.onclick = () => rgTab(b.dataset.d));
document.querySelectorAll('#rgDiffs button').forEach(b => b.onclick = () => rgGo(b.dataset.d));
$('rgBack').onclick = () => { $('rgPanel').classList.add('hide'); mode = 'title'; layoutPads(); };
$('rgHome').onclick = () => { RG.on = false; RG.enemies = []; rgOpen(); };
addEventListener('keydown', e => { if (mode === 'rgPick' && /^Digit\d$/.test(e.code)) rgPick((+e.code.slice(5) + 9) % 10); });
// ---------- 闖關畫面 ----------
function drawRgHUD() {
  const bw = 480, bh = 26, y = 34, x = 60;
  p1.hpShow += (p1.hp - p1.hpShow) * .06;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 4, y - 4, bw + 8, bh + 8);
  ctx.fillStyle = '#5a1010'; ctx.fillRect(x, y, bw, bh);
  ctx.fillStyle = '#ff5a3c'; ctx.fillRect(x, y, bw * Math.max(0, p1.hpShow) / p1.maxHp, bh);
  const hg = ctx.createLinearGradient(0, y, 0, y + bh); hg.addColorStop(0, '#ffe36b'); hg.addColorStop(1, '#f0a020');
  ctx.fillStyle = hg; ctx.fillRect(x, y, bw * Math.max(0, p1.hp) / p1.maxHp, bh);
  ctx.font = 'bold 20px "Microsoft JhengHei",sans-serif'; ctx.textAlign = 'left';
  outlineText((CHARS[p1.char] ? CHARS[p1.char].name : '花鼓燈大師') + '  ' + Math.ceil(p1.hp) + ' / ' + p1.maxHp, x, y + bh + 26, '#fff');
  ctx.textAlign = 'center'; ctx.font = 'bold 40px "Microsoft JhengHei",sans-serif';
  outlineText('第 ' + RG.stage + ' 關', W / 2 + 230, 66, '#ffe600', 6);
  ctx.font = 'bold 20px "Microsoft JhengHei",sans-serif';
  const left = RG.queue.length + RG.enemies.filter(e => !e.ko).length;
  outlineText('剩 ' + left + ' 隻｜擊倒 ' + RG.kills, W / 2 + 230, 96, '#fff', 4);
  outlineText(RG_DIFF[RG.diff].name + '｜最佳第 ' + RG.best + ' 關', W - 130, 66, '#cfe6ff', 4);
  // 敵人頭上的小血條＋名字
  for (const e of RG.enemies) {
    if (e.ko) continue;
    const hb = hurtbox(e), w = e.boss ? 140 : 76, bx = e.x - w / 2, by = hb.y0 - 22;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx - 2, by - 2, w + 4, 11);
    ctx.fillStyle = e.boss ? '#ff4d4d' : '#ff9a28'; ctx.fillRect(bx, by, w * e.hp / e.maxHp, 7);
    ctx.font = 'bold 14px "Microsoft JhengHei",sans-serif'; outlineText(CHARS[e.char].name, e.x, by - 6, e.boss ? '#ffb0b0' : '#fff', 3);
  }
  if (!isTouch) drawSkillBar(p1, 0);
  if (p1.mods.shanMax > 1) { ctx.font = 'bold 16px sans-serif'; outlineText('×' + p1.shanCh, W / 2 - 420 + 22, 632, '#8fffb0', 3); }
}

/* ================= 動作挑選頁（?pick=1，本機用）：原片片段＋每招 5 個版本並排循環 ================= */
function pickPage() {
  for (const id of ['wrap', 'bar', 'pads', 'rot', 'lobby']) $(id).style.display = 'none';
  document.body.style.cssText += ';overflow:auto;touch-action:auto;color:#fff';
  document.documentElement.style.overflow = 'auto';
  const page = document.createElement('div');
  page.style.cssText = 'max-width:1500px;margin:0 auto;padding:16px;font-size:15px';
  page.innerHTML = '<h1 style="margin:0 0 6px;font-size:24px;color:#ffe600">三招動作挑選（每招 5 版）</h1>' +
    '<div style="color:#9fc4ea;margin-bottom:10px">左邊是原片片段，右邊 5 個版本一直循環。挑好跟 Claude 說，例如「閃 A、踢 C、熊 E」。 ' +
    '<button id="pkSpd" class="tb">速度：1×</button></div>';
  document.body.appendChild(page);
  const rows = [['shan', '閃身步', SHAN_V, 1.3], ['ball', '浪子踢球', BALL_V, 1.6], ['bear', '狗熊哆嗦毛', BEAR_V, 3.4]];
  const cells = [], vids = [];
  for (const [kind, title, vars, loop] of rows) {
    const sec = document.createElement('div');
    sec.style.cssText = 'margin:14px 0 22px';
    sec.innerHTML = `<h2 style="margin:0 0 8px;font-size:20px">${title}</h2>`;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start';
    const v = document.createElement('video');
    v.src = 'ref/ref_' + kind + '.mp4'; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.style.cssText = 'width:220px;border-radius:8px;border:2px solid #e8601c';
    const vw = document.createElement('div'); vw.appendChild(v);
    vw.insertAdjacentHTML('beforeend', '<div style="text-align:center;color:#ffb37a">原片</div>');
    row.appendChild(vw); vids.push(v);
    vars.forEach((va, i) => {
      const c = document.createElement('canvas'); c.width = 240; c.height = 290;
      c.style.cssText = 'width:220px;height:auto;aspect-ratio:auto;border-radius:8px;background:#3d86c4';
      const w = document.createElement('div'); w.appendChild(c);
      w.insertAdjacentHTML('beforeend', `<div style="text-align:center">${va.name}</div>`);
      row.appendChild(w); cells.push({ c2: c.getContext('2d'), kind, vi: i, loop });
    });
    sec.appendChild(row); page.appendChild(sec);
  }
  let spd = 1, tt = 0, lastT = performance.now();
  $('pkSpd').onclick = () => { spd = spd === 1 ? .5 : spd === .5 ? .25 : 1; $('pkSpd').textContent = '速度：' + spd + '×'; for (const v of vids) v.playbackRate = spd; };
  const s = .6;
  function mini({ c2, kind, vi, loop }) {
    const real = ctx; ctx = c2;
    const W2 = c2.canvas.width, H2 = c2.canvas.height, lt = tt % loop;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#5ea6dc'; ctx.fillRect(0, 0, W2, H2);
    ctx.fillStyle = '#3a74a9'; ctx.fillRect(0, H2 - 22, W2, 22);
    ctx.setTransform(s, 0, 0, s, W2 / 2, H2 - 20 - GROUND * s);
    let pose = N, x = 0;
    if (kind === 'shan') {
      const v = SHAN_V[vi];
      x = lt < .1 ? -95 : 95;
      if (lt >= .1 && lt < .45) for (let i = 0; i < 5; i++) { // 殘影
        ctx.save(); ctx.globalAlpha = .45 * (1 - (lt - .1) / .35);
        drawFighter(dummyA, v.hold, { x: -95 + 190 * i / 5, y: 0, f: 1, tone: GHOST_TONE }); ctx.restore();
      }
      pose = lt < .55 ? sampleKeys(v.keys, lt) : STIFF;
    } else if (kind === 'ball') {
      const v = BALL_V[vi];
      x = -70; pose = lt < .85 ? sampleKeys(v.keys, lt) : N;
      if (lt >= .4) { const sk = skeleton(v.flick, 1), ff = kickFoot(sk, 1); drawBall(x + ff[0] + 14 + (lt - .4) * 500, GROUND - sk.footY - 8 + v.flick.dy + ff[1] - 6, lt * 18); }
    } else {
      x = -60 + Math.min(lt, .28) * 420; pose = lt < BEAR.dur ? bearPose(lt, vi) : N;
    }
    ctx.fillStyle = 'rgba(0,20,50,.35)'; ctx.beginPath(); ctx.ellipse(x, GROUND + 2, 55, 10, 0, 0, 7); ctx.fill();
    drawFighter(dummyA, pose, { x, y: 0, f: 1, face: 'shout' });
    ctx = real;
  }
  window.pickDrawAt = t => { tt = t; for (const c of cells) mini(c); }; // 測試用：畫指定時間的那一格
  (function loop(now) {
    tt +=Math.min(.05, (now - lastT) / 1000) * spd; lastT = now;
    for (const c of cells) mini(c);
    requestAnimationFrame(loop);
  })(performance.now());
}

layoutPads();
/* ================= 動作沙盒（?sandbox=1，本機用）：用真正的遊戲引擎一直重複出同一招，旁邊放原片對照 =================
   原本三招可換版本；新招 30 個可逐一試。防守類的招會叫假人對手在對的時間打過來，才看得到擋／反擊／反彈 */
const SB = params.get('sandbox') === '1' ? { char: 'teacher', skill: 'shan', speed: 1, t: 9, fire: null, foe: 'auto', p1At: 0, foeAt: 0, p1Done: true, foeDone: true } : null;
const SB_PERIOD = { shan: 1.4, ball: 1.7, bear: 3.6 };
const SB_DIST = { pingchou: 110, xiaolun: 100, sandian: 100, dahu: 200, guabian: 400, zhuafen: 300, shuangchao: 450, chengu: 320, laoying: 300, daqi: 300, cheshui: 200, feiji: 160, yaozhong: 90 };
const SB_FOE = { fenshou: 'melee', xieta: 'ball', baishi: 'melee', pinghu: 'melee', fengbai: 'ball', xiachuan: 'ball', yunbu: 'ball', biandan: 'melee' };
function sbFoeMode() { return SB.foe === 'auto' ? (SB_FOE[SB.skill] || 'stand') : SB.foe; }
function sandboxTick(dt) {
  if (!p1) { vsCPU = false; p1 = new Fighter('p1', 330, 1); p2 = new Fighter('p2', 950, -1); }
  mode = 'fight'; banner = null; timer = 60; wins = [0, 0]; p1.char = SB.char;
  for (const ft of [p1, p2]) if (ft.hp < 40 || ft.ko) { ft.hp = 200; ft.ko = false; ft.koT = undefined; }
  const mv = MOVES[SB.skill], foe = sbFoeMode();
  SB.t += dt;
  const per = mv ? mv.dur + 1.4 + SB.p1At : SB_PERIOD[SB.skill];
  if (SB.t > per && p1.canAct() && p1.grounded && p2.canAct()) {
    // 每次出招前站回原位
    const dist = foe === 'ball' ? 460 : foe === 'melee' ? 200 : mv ? (SB_DIST[SB.skill] || 150) : SB.skill === 'bear' ? 230 : 620;
    Object.assign(p1, { x: 330, vx: 0, vy: 0, y: 0, face: 1, stun: 0, act: null, guardT: 0, armorT: 0, spdT: 0, healT: 0, floatT: 0 });
    Object.assign(p2, { x: 330 + dist, vx: 0, vy: 0, y: 0, face: -1, stun: 0, act: null, guardT: 0, armorT: 0 });
    p1.cd = { shan: 0, ball: 0, bear: 0 }; p2.cd = { shan: 0, ball: 0, bear: 0 }; p1.mvcd = {}; p2.mvcd = {}; balls = [];
    if (SB.skill === 'chayao') p1.hp = 140; // 看得到回血
    // 防守招：讓假人的攻擊剛好打在防守時間的中間
    let mid = 0;
    if (mv) for (const e of mv.ev) { if (e.guard) mid = e.at + e.dur / 2; if (e.buff && e.buff.armor) mid = e.at + .4; }
    const land = foe === 'ball' ? .4 + (dist - 60) / 820 : .25; // 假人出招到打中要多久
    let foeAt = foe === 'stand' ? 99 : (mid || .3) - land, p1At = 0;
    if (foeAt < 0) { p1At = -foeAt; foeAt = 0; }
    Object.assign(SB, { t: 0, p1At, foeAt, p1Done: false, foeDone: foe === 'stand' });
  }
  if (!SB.p1Done && SB.t >= SB.p1At) { SB.p1Done = true; if (mv) doMove(p1, p2, SB.skill); else SB.fire = SB.skill; }
  if (!SB.foeDone && SB.t >= SB.foeAt) {
    SB.foeDone = true; p2.face = -1;
    if (foe === 'ball') doSkill(p2, p1, { L: false, R: false, U: false }, 'ball'); else doMove(p2, p1, 'dahu');
  }
}
function sandboxUI() {
  // 左邊一條控制欄，遊戲畫面往右讓位
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:0;top:0;bottom:0;width:300px;z-index:9;overflow-y:auto;background:#0e1d2e;border-right:2px solid #e8601c;padding:10px;box-sizing:border-box;color:#fff;font-size:14px;touch-action:auto';
  document.body.appendChild(panel);
  $('wrap').style.left = '300px'; cv.style.width = 'min(calc(100vw - 300px), calc(100vh * 16 / 9))';
  $('bar').style.display = 'none'; $('pads').style.display = 'none';
  const h = (tag, css, txt) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; panel.appendChild(e); return e; };
  h('div', 'font-size:18px;font-weight:bold;color:#ffe600;margin-bottom:6px', '動作沙盒');
  const vid = h('video', 'width:100%;border:2px solid #e8601c;border-radius:8px;background:#000');
  vid.muted = vid.loop = vid.autoplay = vid.playsInline = true;
  h('div', 'color:#ffb37a;text-align:center;margin-bottom:6px', '↑ 原片對照');
  const info = h('div', 'background:#13304f;border-radius:8px;padding:8px;margin-bottom:8px;line-height:1.5;min-height:66px');
  const ctl = h('div', 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px');
  const cut = () => { for (const ft of [p1, p2]) if (ft) { ft.act = null; ft.stun = 0; ft.guardT = 0; } stopChant(); balls = []; ghosts = []; fx = []; captions = []; };
  const mk = (parent, txt, fn, css = '') => { const b = document.createElement('button'); b.className = 'tb'; b.style.cssText += css; b.textContent = txt; b.onclick = () => { fn(); refresh(); }; parent.appendChild(b); return b; };
  const spdBtn = mk(ctl, '', () => { SB.speed = SB.speed === 1 ? .5 : SB.speed === .5 ? .25 : 1; vid.playbackRate = SB.speed; });
  const FOES = { auto: '對手：自動', stand: '對手：站著', ball: '對手：丟球', melee: '對手：近身打' };
  const foeBtn = mk(ctl, '', () => { const ks = Object.keys(FOES); SB.foe = ks[(ks.indexOf(SB.foe) + 1) % ks.length]; cut(); SB.t = 99; });
  const pickSkill = k => { cut(); SB.skill = k; SB.t = 99; vid.src = SB.char === 'rider' && k === 'shan' ? 'ref/mv/rider.mp4' : MOVES[k] ? 'ref/mv/' + k + '.mp4' : 'ref/ref_' + k + '.mp4'; vid.playbackRate = SB.speed; };
  h('div', 'color:#9fc4ea;margin:4px 0', '角色（之後當敵人／Boss）');
  const gc = h('div', 'display:grid;grid-template-columns:1fr 1fr;gap:4px');
  const charBtns = CHAR_IDS.map(k => [k, mk(gc, CHARS[k].name + (CHARS[k].boss ? '（Boss）' : ''), () => { cut(); SB.char = k; if (p1) p1.char = k; pickSkill(CHARS[k].moves[0]); }, 'font-size:13px;padding:5px 4px')]);
  h('div', 'color:#9fc4ea;margin:6px 0 4px', '這個角色的招式');
  const gm = h('div', 'display:flex;gap:4px;flex-wrap:wrap');
  h('div', 'color:#9fc4ea;margin:10px 0 4px', '原本三招（可換版本）');
  const g1 = h('div', 'display:flex;gap:6px;flex-wrap:wrap');
  const NAMES = { shan: '閃身步', ball: '浪子踢球', bear: '狗熊哆嗦毛' }, VARS = { shan: SHAN_V, ball: BALL_V, bear: BEAR_V };
  const skillBtns = Object.keys(NAMES).map(k => [k, mk(g1, NAMES[k], () => pickSkill(k))]);
  const g2 = h('div', 'display:flex;gap:4px;flex-wrap:wrap;margin-top:4px');
  const verBtns = [0, 1, 2, 3, 4, 5].map(i => [i, mk(g2, '', () => { cut(); ANIM[SB.skill] = i; SB.t = 99; }, 'font-size:12px;padding:4px 6px')]);
  h('div', 'color:#9fc4ea;margin:10px 0 4px', '新招（B 站教學 p01＋p03，共 ' + MOVE_IDS.length + ' 招）');
  const g3 = h('div', 'display:grid;grid-template-columns:1fr 1fr;gap:4px');
  const mvBtns = MOVE_IDS.map(k => [k, mk(g3, MOVES[k].name, () => pickSkill(k), 'font-size:13px;padding:5px 4px')]);
  h('div', 'color:#6f8aa5;font-size:12px;margin-top:8px', '鍵盤：↑↓ 換招、空白鍵換速度');
  function refresh() {
    for (const [k, b] of [...skillBtns, ...mvBtns]) b.style.background = k === SB.skill ? '#e8601c' : '';
    for (const [k, b] of charBtns) b.style.background = k === SB.char ? '#2b7a3d' : '';
    gm.textContent = '';
    for (const k of CHARS[SB.char].moves) { const b = mk(gm, MOVES[k] ? MOVES[k].name : NAMES[k], () => pickSkill(k), 'font-size:13px;padding:5px 8px'); b.style.background = k === SB.skill ? '#e8601c' : ''; }
    const vars = VARS[SB.skill];
    for (const [i, b] of verBtns) { b.style.display = vars && vars[i] ? '' : 'none'; if (vars && vars[i]) { b.textContent = vars[i].name; b.style.background = ANIM[SB.skill] === i ? '#e8601c' : ''; } }
    spdBtn.textContent = '速度 ' + SB.speed + '×'; foeBtn.textContent = FOES[SB.foe] + (SB.foe === 'auto' ? '（' + { stand: '站著', ball: '丟球', melee: '近身打' }[sbFoeMode()] + '）' : '');
    const m = MOVES[SB.skill];
    info.innerHTML = '';
    const t = document.createElement('div'); t.style.cssText = 'font-size:17px;font-weight:bold;color:#ffe600'; t.textContent = m ? m.name : NAMES[SB.skill]; info.appendChild(t);
    const d = document.createElement('div'); d.textContent = m ? `冷卻 ${m.cd} 秒｜${m.desc}` : '原本三招，可在下面換動作版本'; info.appendChild(d);
  }
  const order = [...Object.keys(NAMES), ...MOVE_IDS];
  addEventListener('keydown', e => {
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { const i = order.indexOf(SB.skill) + (e.code === 'ArrowDown' ? 1 : -1); pickSkill(order[(i + order.length) % order.length]); refresh(); }
    else if (e.code === 'Space') spdBtn.click();
  });
  pickSkill('shan'); refresh();
}
function openReplayViewer() {
  const fileInput = $('replayFile'), play = $('replayPlay'), seek = $('replaySeek');
  const speed = $('replaySpeed'), time = $('replayTime'), status = $('replayStatus'), mute = $('replayMute');
  const fighterNumbers = ['x', 'y', 'hp', 'face', 'vx', 'vy', 'stun', 'inv', 'walkPh', 'flash'];
  const fighterFields = [...fighterNumbers, 'act', 'ko', 'win', 'cd', 'used'];
  const ballNumbers = ['x', 'y', 'vx', 'spin', 't', 'r'];
  const skills = ['shan', 'ball', 'bear'];
  const fighters = ['p1', 'p2'];
  const activeClips = new Set(), chants = new Map();
  let audioOutput = null;
  const winners = new Map([
    ['player_1', '1P 獲勝！'], ['player_2', '2P 獲勝！'],
    ['player', '1P 獲勝！'], ['cpu', '電腦獲勝！'], ['draw', '平手！'],
  ]);
  let replay, animation = 0, index = 0, startAt = 0, startIndex = 0, loadId = 0;

  mode = 'replay';
  document.title = '訓練對戰回放｜閃身步大亂鬥';
  document.documentElement.classList.add('replay-viewer');
  document.body.classList.add('replay-viewer');
  $('replayPanel').classList.remove('hide');
  mute.textContent = muted ? '音效：關' : '音效：開';
  drawStage();

  function validFighter(ft) {
    if (!ft || !fighterNumbers.every(key => Number.isFinite(ft[key])) || ![-1, 1].includes(ft.face)) return false;
    if (typeof ft.ko !== 'boolean' || typeof ft.win !== 'boolean') return false;
    if (!ft.cd || !['shan', 'ball', 'bear'].every(key => Number.isFinite(ft.cd[key]))) return false;
    if (!Array.isArray(ft.used) || ft.used.length !== 3 || !ft.used.every(Number.isFinite)) return false;
    const act = ft.act;
    if (act === null) return true;
    if (!act || !Number.isFinite(act.t) || !['shan', 'ball', 'bear'].includes(act.type)) return false;
    return act.type !== 'shan' || (['up', 'fwd', 'back'].includes(act.dir) && [-1, 1].includes(act.travel));
  }

  function validFrame(frame) {
    return frame && validFighter(frame.p1) && validFighter(frame.p2) && Number.isFinite(frame.timer) &&
      Array.isArray(frame.balls) && frame.balls.every(ball => ball && ballNumbers.every(key => Number.isFinite(ball[key])) &&
        ball.r > 0 && [1, 2].includes(ball.owner));
  }

  function validReplay(data) {
    return data && data.format === 'shanshenbu-replay' && data.version === 1 && data.fps === 60 &&
      ['versus', 'quick_play'].includes(data.mode) && Array.isArray(data.frames) && data.frames.length > 0 &&
      data.result && (data.result.winner === null || winners.has(data.result.winner)) &&
      [null, 'ko', 'timeout'].includes(data.result.reason) && data.frames.every(validFrame);
  }

  function loadFighter(ft, snapshot) {
    for (const key of fighterFields) ft[key] = snapshot[key];
    ft.hpShow = snapshot.hp;
    ft.koT = snapshot.ko ? .5 : 0;
  }

  function showFrame(next) {
    index = next;
    const snapshot = replay.frames[index];
    const { result, fps } = replay;
    loadFighter(p1, snapshot.p1);
    loadFighter(p2, snapshot.p2);
    balls = snapshot.balls.map(ball => ({ ...ball, owner: ball.owner === 1 ? p1 : p2 }));
    timer = snapshot.timer;
    const end = replay.frames.length - 1;
    banner = index === end && result.winner !== null ? {
      text: result.reason === 'ko' ? 'K.O.' : '時間到', sub: winners.get(result.winner), t: .25,
    } : null;
    seek.value = index;
    time.value = `${(index / fps).toFixed(2)} / ${(end / fps).toFixed(2)} 秒`;
    ctx.save();
    drawStage();
    drawBattle(index / fps, 0);
    ctx.restore();
  }

  function replayClip(key, volume, offset = 0) {
    const clip = playClip(key, volume, { output: audioOutput, rate: Number(speed.value), offset });
    if (clip) activeClips.add(clip);
    return clip;
  }

  function stopReplayClips() {
    for (const clip of activeClips) clip.stop();
    activeClips.clear();
    chants.clear();
  }

  function stopReplayAudio() {
    stopReplayClips();
    audioOutput?.disconnect();
    audioOutput = null;
  }

  function startReplayChant(player, action) {
    const offset = Math.max(0, action.t - BEAR.chantAt);
    const clip = replayClip('chant', .85, offset);
    if (clip) chants.set(player, clip);
  }

  function startReplayAudio() {
    stopReplayAudio();
    if (muted) return;
    unlockAudio();
    loadBaseClips();
    const context = ac();
    if (context) {
      audioOutput = context.createGain();
      audioOutput.connect(context.destination);
    }
    for (const player of fighters) {
      const action = replay.frames[index][player].act;
      if (action?.chant) startReplayChant(player, action);
    }
  }

  function playFrameSounds(before, after) {
    // V1 replays store battle states. Cooldown increases also catch moves interrupted on their first tick.
    for (const [side, player] of fighters.entries()) {
      const previous = before[player], current = after[player];
      for (const skill of skills) {
        if (current.cd[skill] <= previous.cd[skill]) continue;
        replayClip(skill, skill === 'bear' ? .9 : 1);
        if (skill === 'shan') synth('whoosh', audioOutput);
      }
      const previousBall = previous.act?.type === 'ball' ? previous.act : null;
      const currentBall = current.act?.type === 'ball' ? current.act : null;
      if (currentBall?.spawned && !previousBall?.spawned) synth('pop', audioOutput);
      const freshBall = ball => ball.owner === side + 1 && ball.t <= 1 / replay.fps;
      if ((currentBall?.launched && !previousBall?.launched) ||
          (after.balls.some(freshBall) && !before.balls.some(freshBall))) synth('kick', audioOutput);

      if (current.act?.chant && !previous.act?.chant) {
        startReplayChant(player, current.act);
      } else if (previous.act?.chant && !current.act?.chant && chants.has(player)) {
        const chant = chants.get(player);
        chant.stop();
        activeClips.delete(chant);
        chants.delete(player);
      }
      // Basic projectiles knock back much faster than the bear combo, even on the KO tick.
      if (current.hp < previous.hp) synth(Math.abs(current.vx) > 100 ? 'kick' : 'hit', audioOutput);
    }
  }

  function pause(silence = true) {
    cancelAnimationFrame(animation);
    animation = 0;
    play.textContent = '播放';
    if (silence) stopReplayAudio();
  }

  function tick(now) {
    const end = replay.frames.length - 1;
    const elapsed = Math.max(0, now - startAt) * replay.fps * Number(speed.value) / 1000;
    const next = Math.min(end, startIndex + Math.floor(elapsed));
    if (!muted) {
      for (let i = index + 1; i <= next; i++) playFrameSounds(replay.frames[i - 1], replay.frames[i]);
    }
    if (next !== index) showFrame(next);
    if (next === end) {
      pause(false);
      stopReplayClips();
      if (replay.result.reason) synth('gong', audioOutput);
    } else animation = requestAnimationFrame(tick);
  }

  play.addEventListener('click', () => {
    if (animation) { pause(); return; }
    if (index === replay.frames.length - 1) showFrame(0);
    startIndex = index;
    startAt = performance.now();
    startReplayAudio();
    play.textContent = '暫停';
    animation = requestAnimationFrame(tick);
  });
  seek.addEventListener('input', () => { pause(); showFrame(Number(seek.value)); });
  speed.addEventListener('change', () => {
    startIndex = index;
    startAt = performance.now();
    if (animation) startReplayAudio();
  });
  mute.addEventListener('click', () => {
    muted = !muted;
    mute.textContent = muted ? '音效：關' : '音效：開';
    if (animation) startReplayAudio();
    else stopReplayAudio();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  fileInput.addEventListener('click', () => { fileInput.value = ''; });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const id = ++loadId;
    pause();
    play.disabled = seek.disabled = speed.disabled = true;
    status.textContent = '讀取回放中…';
    try {
      const data = JSON.parse(await file.text());
      if (id !== loadId) return;
      if (!validReplay(data)) throw new Error('不支援的回放格式');
      replay = data;
      if (!muted) loadBaseClips();
      p1 = new Fighter('p1', 380, 1);
      p2 = new Fighter('p2', 900, -1);
      vsCPU = replay.mode === 'quick_play';
      seek.max = replay.frames.length - 1;
      const matchup = vsCPU ? '玩家 vs. 電腦' : '1P vs. 2P';
      status.textContent = `${file.name} · ${matchup} · ${replay.frames.length} 幀`;
      showFrame(0);
    } catch (error) {
      if (id === loadId) status.textContent = replay ? '回放檔無效，仍顯示上一段回放。' : '無法開啟回放。請選擇有效的第 1 版 JSON 回放檔。';
    } finally {
      if (id === loadId) play.disabled = seek.disabled = speed.disabled = !replay || replay.frames.length === 1;
    }
  });
}

if (replayView) openReplayViewer();
else if (params.get('pick') === '1') pickPage();
else { if (SB) sandboxUI(); requestAnimationFrame(frame); }

