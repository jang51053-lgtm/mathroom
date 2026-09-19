/* Backrooms math escape - game loop, player, entities, HUD.
   Level geometry and tile queries live in level.js; entity silhouettes in
   entities.js. */
(function () {
  'use strict';

  var BR = window.BR;

  // =========================================================================
  // CONFIG
  // =========================================================================
  var KEYS_NEEDED = 3;
  var INTERACT_RADIUS = 2.7;

  var WALK_SPEED = 5.4;
  var SPRINT_MULT = 1.75;
  var WATER_MULT = 0.62;
  var PLAYER_RADIUS = 0.32;
  var STAMINA_MAX = 100;
  var STAMINA_DRAIN = 30;
  var STAMINA_REGEN = 15;
  var STAMINA_RESUME = 25;

  // Tight over-the-shoulder rig - the whole point is feeling boxed in.
  var CAM_DIST = 1.95;
  var CAM_SHOULDER = 0.42;
  var CAM_EYE = 1.5;

  var TEACHER_PATROL = 2.3;
  var TEACHER_CHASE_BASE = 4.1;
  var TEACHER_CHASE_STEP = 0.55;
  var TEACHER_CHASE_CAP = 7.4;
  var TEACHER_DETECT = 11;
  var TEACHER_LOSE = 17;

  var LURKER_SPEED = 5.2;
  var LURKER_CATCH = 0.85;
  var LURKER_WAKE_AT = 1;        // keys collected before it starts hunting

  var WATCHER_FEAR_RATE = 7.5;
  var WATCHER_FEAR_DECAY = 16;
  var CATCH_RADIUS = 0.95;

  var ASSET_PATHS = {
    player: 'assets/models/player.glb',
    baldi: 'assets/models/baldi.glb',
    book: 'assets/models/book.glb'
  };
  var ASSET_TUNING = {
    player: { scale: 0.6, rotationY: Math.PI, yOffset: 0 },
    baldi: { scale: 0.41, rotationY: Math.PI, yOffset: 0 },
    book: { scale: 1, rotationY: 0, yOffset: 0 }
  };

  document.getElementById('keyNeed').textContent = KEYS_NEEDED;
  document.getElementById('startKeyNeed').textContent = KEYS_NEEDED;

  // =========================================================================
  // AUDIO - everything is synthesised, no sound files to ship
  // =========================================================================
  var actx = null, masterGain = null, droneOsc = null, droneGain = null, droneFilter = null;
  var whineOsc = null, whineGain = null;

  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = actx.createGain();
      masterGain.gain.value = 0.9;
      masterGain.connect(actx.destination);

      // Room tone: the ever-present fluorescent hum.
      droneOsc = actx.createOscillator();
      droneOsc.type = 'sawtooth';
      droneOsc.frequency.value = 58;
      droneFilter = actx.createBiquadFilter();
      droneFilter.type = 'lowpass';
      droneFilter.frequency.value = 240;
      droneGain = actx.createGain();
      droneGain.gain.value = 0.035;
      droneOsc.connect(droneFilter);
      droneFilter.connect(droneGain);
      droneGain.connect(masterGain);
      droneOsc.start();

      // Tinnitus whine that rises with fear.
      whineOsc = actx.createOscillator();
      whineOsc.type = 'sine';
      whineOsc.frequency.value = 2400;
      whineGain = actx.createGain();
      whineGain.gain.value = 0;
      whineOsc.connect(whineGain);
      whineGain.connect(masterGain);
      whineOsc.start();
    } catch (e) { actx = null; }
  }

  function panNode(pan) {
    if (!actx) return null;
    if (actx.createStereoPanner) {
      var p = actx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      return p;
    }
    return null;
  }

  function tone(freq, dur, type, gain, pan) {
    if (!actx) return;
    try {
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = gain === undefined ? 0.07 : gain;
      o.connect(g);
      var p = panNode(pan);
      if (p) { g.connect(p); p.connect(masterGain); } else { g.connect(masterGain); }
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.stop(actx.currentTime + dur);
    } catch (e) { /* audio is decoration, never fatal */ }
  }

  function noise(dur, gain, pan, filterFreq) {
    if (!actx) return;
    try {
      var frames = Math.floor(actx.sampleRate * dur);
      var buf = actx.createBuffer(1, frames, actx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      var src = actx.createBufferSource();
      src.buffer = buf;
      var f = actx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq || 1200;
      var g = actx.createGain();
      g.gain.value = gain === undefined ? 0.1 : gain;
      src.connect(f); f.connect(g);
      var p = panNode(pan);
      if (p) { g.connect(p); p.connect(masterGain); } else { g.connect(masterGain); }
      src.start();
    } catch (e) { /* ignore */ }
  }

  function heartbeat(intensity) {
    tone(54, 0.16, 'sine', 0.10 + intensity * 0.16);
    setTimeout(function () { tone(44, 0.2, 'sine', 0.07 + intensity * 0.12); }, 165);
  }

  // Where a world point sits left/right of the camera, for panned cues.
  function panFor(x, z) {
    var fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    var right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
    var dx = x - camera.position.x, dz = z - camera.position.z;
    var len = Math.hypot(dx, dz) || 1;
    return Math.max(-1, Math.min(1, (right.x * dx + right.z * dz) / len));
  }

  // =========================================================================
  // THREE SETUP
  // =========================================================================
  var container = document.getElementById('threeContainer');
  var scene = new THREE.Scene();
  var bg = 0x0a0806;
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, 2.4, 18);

  var camera = new THREE.PerspectiveCamera(74, 1, 0.05, 90);
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  function resize() {
    var w = container.clientWidth || 320;
    var h = container.clientHeight || 240;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    var sc = document.getElementById('staticCanvas');
    sc.width = Math.floor(w / 3);
    sc.height = Math.floor(h / 3);
  }
  window.addEventListener('resize', resize);

  scene.add(new THREE.AmbientLight(0xfff0cc, 0.13));

  // A small pool of real lights follows the player between ceiling fixtures,
  // so the level can have hundreds of lamps without hundreds of lights.
  var LIGHT_POOL = 7;
  var lightPool = [];
  for (var li = 0; li < LIGHT_POOL; li++) {
    var pl = new THREE.PointLight(0xffffff, 0, 16, 1.4);
    scene.add(pl);
    lightPool.push({ light: pl, fixture: null, phase: Math.random() * 6.28 });
  }

  var playerLamp = new THREE.PointLight(0xffe9c4, 0.55, 7.5);
  playerLamp.position.set(0, 1.7, 0);
  scene.add(playerLamp);

  // =========================================================================
  // ASSETS (optional .glb, otherwise procedural placeholders)
  // =========================================================================
  var gltfLoader = (window.THREE && THREE.GLTFLoader) ? new THREE.GLTFLoader() : null;

  function pickClip(clips, patterns) {
    for (var p = 0; p < patterns.length; p++) {
      for (var i = 0; i < clips.length; i++) {
        if (patterns[p].test(clips[i].name)) return clips[i];
      }
    }
    return null;
  }

  // Assets are optional, so remember which ones are absent rather than
  // re-requesting a missing file once per object every time a level loads.
  var missingAssets = {};

  function tryAttachModel(group, url, tuning, animOut) {
    if (!gltfLoader || missingAssets[url]) return;
    tuning = tuning || {};
    gltfLoader.load(url, function (gltf) {
      var model = gltf.scene;
      var s = tuning.scale || 1;
      model.scale.set(s, s, s);
      if (tuning.rotationY) model.rotation.y = tuning.rotationY;
      if (tuning.yOffset) model.position.y = tuning.yOffset;
      while (group.children.length) group.remove(group.children[0]);
      group.add(model);

      var clips = gltf.animations || [];
      if (animOut && clips.length) {
        var mixer = new THREE.AnimationMixer(model);
        var walkClip = pickClip(clips, [/^walk$/i, /walk/i, /run/i]) || clips[0];
        var idleClip = pickClip(clips, [/^idle$/i, /idle/i]);
        var walkAction = mixer.clipAction(walkClip);
        walkAction.play();
        var idleAction = idleClip ? mixer.clipAction(idleClip) : null;
        if (idleAction) {
          idleAction.play();
          walkAction.setEffectiveWeight(0);
          idleAction.setEffectiveWeight(1);
        }
        animOut.mixer = mixer;
        animOut.walkAction = walkAction;
        animOut.idleAction = idleAction;
        animOut.walking = false;
      }
    }, undefined, function () {
      missingAssets[url] = true;   // no asset yet - placeholder stays
    });
  }

  function setWalking(anim, walking) {
    if (!anim || !anim.mixer || !anim.idleAction) return;
    if (anim.walking === walking) return;
    anim.walking = walking;
    anim.walkAction.setEffectiveWeight(walking ? 1 : 0);
    anim.idleAction.setEffectiveWeight(walking ? 0 : 1);
  }

  // =========================================================================
  // ACTORS
  // =========================================================================
  var player = new THREE.Group();
  player.add(BR.createPlayerPlaceholder());
  scene.add(player);
  var playerAnim = {};
  tryAttachModel(player, ASSET_PATHS.player, ASSET_TUNING.player, playerAnim);

  var teacher = new THREE.Group();
  teacher.add(BR.createTeacherPlaceholder());
  scene.add(teacher);
  var teacherAnim = {};
  tryAttachModel(teacher, ASSET_PATHS.baldi, ASSET_TUNING.baldi, teacherAnim);

  var lurker = BR.createLurker();
  lurker.visible = false;
  scene.add(lurker);

  var watcher = BR.createWatcher();
  watcher.visible = false;
  scene.add(watcher);

  var levelGroup = null;
  var propGroup = new THREE.Group();
  scene.add(propGroup);
  var booksGroup = new THREE.Group();
  scene.add(booksGroup);

  var level = null;
  var waterMeshes = [];
  var books = [];
  var exitDoor = null;
  var doorLocked = true;

  // =========================================================================
  // GAME STATE
  // =========================================================================
  var gameState = 'start';   // start | playing | question | gameover | win
  var keyCount = 0;
  var fear = 0;
  var danger = 0;
  var elapsed = 0;

  var curVel = { x: 0, z: 0 };
  var stamina = STAMINA_MAX;
  var canSprint = true;
  var sprintHeld = false;

  var orbitYaw = Math.PI, orbitPitch = 0.22;
  var camFrac = 1;

  var playerFlow = null;
  var flowTimer = 0;

  var teacherState = 'patrol';
  var teacherPenalty = 0;
  var teacherPatrolField = null;
  var teacherPatrolTarget = null;
  var teacherVel = { x: 0, z: 0 };

  var lurkerActive = false;
  var lurkerVel = { x: 0, z: 0 };
  var lurkerStepTimer = 0;

  var watcherActive = false;
  var watcherTimer = 14;
  var watcherUnseen = 0;
  var watcherStareTimer = 0;

  var heartTimer = 0;
  var stepTimer = 0;
  var bookPingTimer = 0;
  var doorToastCooldown = 0;
  var wrongCount = 0;
  var BEST_TIME_KEY = 'backrooms_best_time';

  // =========================================================================
  // HUD
  // =========================================================================
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function showToast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 1800);
  }

  var vignetteEl = document.getElementById('vignette');
  var staticCanvas = document.getElementById('staticCanvas');
  var staticCtx = staticCanvas.getContext('2d');
  var zoneLabel = document.getElementById('zoneLabel');
  var staminaFill = document.getElementById('staminaFill');
  var keyCountEl = document.getElementById('keyCount');
  var timerEl = document.getElementById('timerHud');

  function formatTime(seconds) {
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function readBestTime() {
    try {
      var raw = window.localStorage.getItem(BEST_TIME_KEY);
      return raw === null ? null : parseFloat(raw);
    } catch (e) { return null; }
  }
  function writeBestTime(t) {
    try { window.localStorage.setItem(BEST_TIME_KEY, String(t)); } catch (e) { /* private mode */ }
  }

  // Ramped steeply so low fear is a faint crawl and only the last stretch
  // actually blinds you - a linear ramp made the screen unreadable at 50%.
  function drawStatic(intensity) {
    if (intensity <= 0.02) {
      staticCanvas.style.opacity = 0;
      return;
    }
    staticCanvas.style.opacity = Math.min(0.34, Math.pow(intensity, 1.8) * 0.45);
    var w = staticCanvas.width, h = staticCanvas.height;
    var img = staticCtx.createImageData(w, h);
    var d = img.data;
    var density = 0.18 + intensity * 0.3;
    for (var i = 0; i < d.length; i += 4) {
      if (Math.random() > density) { d[i + 3] = 0; continue; }
      var v = 120 + Math.random() * 135;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    staticCtx.putImageData(img, 0, 0);
  }

  // =========================================================================
  // MATH QUESTIONS
  // =========================================================================
  var questionModal = document.getElementById('questionModal');
  var qText = document.getElementById('qText');
  var qChoices = document.getElementById('qChoices');
  var activeBook = null;

  // ---- rounding problems -------------------------------------------------
  // Six templates, each filled with fresh random numbers, so a run never
  // repeats the same set twice.
  var PLACE_NAME = { 1: '일', 10: '십', 100: '백', 1000: '천', 10000: '만' };

  function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function fmtInt(n) { return n.toLocaleString('ko-KR'); }
  function roundUnit(n, unit) { return Math.floor(n / unit + 0.5) * unit; }

  // 을/를 depends on whether the final digit's Korean reading ends in a
  // consonant: 이·사·오·구 do not, everything else does.
  function objParticle(numText) {
    var digits = numText.replace(/[^0-9]/g, '');
    var last = digits.charAt(digits.length - 1);
    return '2459'.indexOf(last) >= 0 ? '를' : '을';
  }

  // Distractors collide with each other often (rounding up and rounding to the
  // next place can land on the same number), so callers pass a top-up function
  // that can keep producing fresh ones until there really are four options.
  function buildChoices(correctLabel, wrongLabels, topUp) {
    // Dedupe on numeric value, not on the label: "3" and "3.0" are the same
    // answer wearing different clothes, and shipping both makes a question
    // that punishes a correct pick.
    function valueKey(label) {
      var num = parseFloat(String(label).replace(/[^0-9.\-]/g, ''));
      return isFinite(num) ? 'v' + num : 's' + label;
    }

    var seen = {};
    seen[valueKey(correctLabel)] = true;
    var list = [{ label: correctLabel, correct: true }];

    function offer(label) {
      if (label === null || label === undefined) return;
      label = String(label);
      if (!label.length) return;
      var key = valueKey(label);
      if (seen[key]) return;
      seen[key] = true;
      list.push({ label: label, correct: false });
    }

    for (var i = 0; i < wrongLabels.length && list.length < 4; i++) offer(wrongLabels[i]);
    for (var n = 1; list.length < 4 && topUp && n < 40; n++) offer(topUp(n));

    for (var j = list.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var t = list[j]; list[j] = list[k]; list[k] = t;
    }
    return list;
  }

  // Wrong answers must still look like answers: positive, and never the
  // correct value in disguise.
  function intLabels(answer, candidates) {
    var out = [];
    candidates.forEach(function (v) {
      if (typeof v !== 'number' || !isFinite(v) || v <= 0 || v === answer) return;
      out.push(fmtInt(v));
    });
    return out;
  }
  function intTopUp(answer, unit) {
    return function (n) {
      var v = answer + (n % 2 ? 1 : -1) * unit * Math.ceil(n / 2);
      return v > 0 && v !== answer ? fmtInt(v) : null;
    };
  }

  // "3,472를 십의 자리에서 반올림하면?" / "…반올림하여 백의 자리까지 나타내면?"
  function qIntRound(phrasing) {
    var unit = [10, 100, 1000][ri(0, 2)];
    var n;
    do { n = ri(unit * 2, unit * 95); } while (n % unit === 0);
    var answer = roundUnit(n, unit);
    var nText = fmtInt(n);
    var text = phrasing === 0
      ? nText + objParticle(nText) + ' ' + PLACE_NAME[unit / 10] + '의 자리에서 반올림하면?'
      : nText + objParticle(nText) + ' 반올림하여 ' + PLACE_NAME[unit] + '의 자리까지 나타내면?';
    return {
      text: text,
      choices: buildChoices(fmtInt(answer), intLabels(answer, [
        Math.ceil(n / unit) * unit,
        Math.floor(n / unit) * unit,
        roundUnit(n, unit * 10),
        answer + unit,
        answer - unit
      ]), intTopUp(answer, unit))
    };
  }

  // Decimals: round to a whole number or to one decimal place.
  function qDecimalRound() {
    var deep = Math.random() < 0.5;          // deep = round at the 2nd decimal
    var n, guard = 0;
    do {
      n = ri(105, 990) / 100;                // 1.05 ~ 9.90
      // A one-decimal answer of "3.0" would make the distractor "3" equally
      // correct, so keep drawing until the tenths digit is non-zero.
    } while (deep && Math.floor(n * 10 + 0.5) % 10 === 0 && guard++ < 50);
    var nText = n.toFixed(2);
    var answer, answerText, wrongs;
    if (!deep) {
      answer = Math.floor(n + 0.5);
      answerText = String(answer);
      wrongs = [String(Math.ceil(n)), String(Math.floor(n)),
                (Math.floor(n * 10 + 0.5) / 10).toFixed(1), String(answer + 1)];
    } else {
      answer = Math.floor(n * 10 + 0.5) / 10;
      answerText = answer.toFixed(1);
      wrongs = [(Math.ceil(n * 10) / 10).toFixed(1), (Math.floor(n * 10) / 10).toFixed(1),
                String(Math.floor(n + 0.5)), (answer + 0.1).toFixed(1)];
    }
    return {
      text: nText + objParticle(nText) + ' 소수 ' + (deep ? '둘째' : '첫째') +
            ' 자리에서 반올림하면?',
      choices: buildChoices(answerText, wrongs, function (k) {
        var stepSize = deep ? 0.1 : 1;
        var v = answer + (k % 2 ? 1 : -1) * stepSize * Math.ceil(k / 2);
        if (v <= 0) return null;
        return deep ? v.toFixed(1) : String(Math.round(v));
      })
    };
  }

  // Same maths wrapped in a word problem.
  var WORD_CONTEXTS = [
    { subject: '놀이공원 입장객', unit: '명' },
    { subject: '상자 안의 사탕', unit: '개' },
    { subject: '도서관의 책', unit: '권' },
    { subject: '경기장 관중', unit: '명' },
    { subject: '학교까지의 거리', unit: 'm' }
  ];
  function qWordRound() {
    var ctx = WORD_CONTEXTS[ri(0, WORD_CONTEXTS.length - 1)];
    var unit = [100, 1000][ri(0, 1)];
    var n;
    do { n = ri(unit * 2, unit * 90); } while (n % unit === 0);
    var answer = roundUnit(n, unit);
    return {
      text: ctx.subject + '가 ' + fmtInt(n) + ctx.unit + '입니다. ' +
            PLACE_NAME[unit / 10] + '의 자리에서 반올림하면 약 몇 ' + ctx.unit + '일까요?',
      choices: buildChoices(fmtInt(answer) + ctx.unit,
        intLabels(answer, [
          Math.ceil(n / unit) * unit,
          Math.floor(n / unit) * unit,
          roundUnit(n, unit * 10),
          answer + unit
        ]).map(function (label) { return label + ctx.unit; }),
        function (k) {
          var extra = intTopUp(answer, unit)(k);
          return extra === null ? null : extra + ctx.unit;
        })
    };
  }

  // Reverse: which of these numbers rounds to the given value?
  function qReverseRound() {
    var unit = [10, 100][ri(0, 1)];
    var target = roundUnit(ri(unit * 3, unit * 80), unit);
    var half = unit / 2;
    var correct = ri(target - half, target + half - 1);
    if (correct < 0) correct = target;
    var wrongs = intLabels(correct, [
      target - half - ri(1, half - 1),
      target + half + ri(0, half - 1),
      target + unit + ri(1, half - 1)
    ]);
    return {
      text: '반올림하여 ' + PLACE_NAME[unit] + '의 자리까지 나타내면 ' +
            fmtInt(target) + '이 되는 수는?',
      // Top-ups walk further out of the rounding band so they stay wrong.
      choices: buildChoices(fmtInt(correct), wrongs, function (k) {
        var v = target + (k % 2 ? 1 : -1) * (half + unit * Math.ceil(k / 2));
        return v > 0 ? fmtInt(v) : null;
      })
    };
  }

  // Boundary: smallest / largest natural number that rounds to the target.
  function qBoundaryRound() {
    var unit = [10, 100][ri(0, 1)];
    var target = roundUnit(ri(unit * 3, unit * 60), unit);
    var wantSmallest = Math.random() < 0.5;
    var answer = wantSmallest ? target - unit / 2 : target + unit / 2 - 1;
    return {
      text: '반올림하여 ' + PLACE_NAME[unit] + '의 자리까지 나타내면 ' + fmtInt(target) +
            '이 되는 자연수 중 가장 ' + (wantSmallest ? '작은' : '큰') + ' 수는?',
      choices: buildChoices(fmtInt(answer), intLabels(answer, [
        wantSmallest ? target - unit / 2 - 1 : target + unit / 2,
        wantSmallest ? target - unit / 2 + 1 : target + unit / 2 - 2,
        target,
        wantSmallest ? target - unit : target + unit
      ]), intTopUp(answer, 1))
    };
  }

  var QUESTION_POOL = [
    function () { return qIntRound(0); },
    function () { return qIntRound(1); },
    qDecimalRound,
    qWordRound,
    qReverseRound,
    qBoundaryRound
  ];

  function genQuestion() {
    var make = QUESTION_POOL[Math.floor(Math.random() * QUESTION_POOL.length)];
    var q = make();
    // A template can collide on its own distractors; fall back rather than
    // ever showing a question with fewer than four options.
    if (q.choices.length < 4) q = qIntRound(0);
    return q;
  }

  function tryOpenBook(book) {
    var d = Math.hypot(player.position.x - book.mesh.position.x, player.position.z - book.mesh.position.z);
    if (d > INTERACT_RADIUS) { showToast('책에 더 가까이 다가가세요'); return; }
    activeBook = book;
    var q = genQuestion();
    qText.textContent = q.text;
    qChoices.innerHTML = '';
    q.choices.forEach(function (choice) {
      var btn = document.createElement('button');
      btn.className = 'qBtn';
      btn.textContent = choice.label;
      btn.addEventListener('click', function () { answerQuestion(choice.correct); });
      qChoices.appendChild(btn);
    });
    questionModal.style.display = 'flex';
    gameState = 'question';
  }

  function answerQuestion(correct) {
    questionModal.style.display = 'none';
    gameState = 'playing';
    if (correct) {
      tone(760, 0.12, 'sine', 0.09);
      setTimeout(function () { tone(1040, 0.16, 'sine', 0.08); }, 110);
      activeBook.solved = true;
      activeBook.mesh.visible = false;
      keyCount++;
      keyCountEl.textContent = keyCount;
      showToast('정답! 열쇠 획득 (' + keyCount + '/' + KEYS_NEEDED + ')');
      if (keyCount >= LURKER_WAKE_AT && !lurkerActive) wakeLurker();
      if (keyCount >= KEYS_NEEDED && doorLocked) unlockDoor();
    } else {
      tone(120, 0.35, 'sawtooth', 0.11);
      wrongCount++;
      teacherPenalty = Math.min(TEACHER_CHASE_CAP - TEACHER_CHASE_BASE, teacherPenalty + TEACHER_CHASE_STEP);
      fear = Math.min(100, fear + 12);
      showToast('오답… 무언가가 더 빨라졌다');
    }
    activeBook = null;
  }

  // =========================================================================
  // LEVEL SETUP
  // =========================================================================
  function clearGroup(group) {
    while (group.children.length) {
      var child = group.children.pop();
      group.remove(child);
      child.traverse && child.traverse(function (o) {
        if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      });
    }
  }

  function setupGame() {
    if (levelGroup) {
      scene.remove(levelGroup);
      levelGroup.traverse(function (o) { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
    }
    clearGroup(propGroup);
    clearGroup(booksGroup);

    level = BR.generateLevel();
    var built = BR.buildLevelMeshes(level);
    levelGroup = built.group;
    waterMeshes = built.waterMeshes;
    scene.add(levelGroup);

    // Books
    books = [];
    level.bookTiles.forEach(function (t) {
      var c = BR.tileCenter(t.tx, t.tz);
      var mesh = BR.createBook();
      mesh.position.set(c.x, 0, c.z);
      booksGroup.add(mesh);
      tryAttachModel(mesh, ASSET_PATHS.book, ASSET_TUNING.book);
      books.push({ mesh: mesh, solved: false });
    });

    // Exit door
    var ec = BR.tileCenter(level.exitTile.tx, level.exitTile.tz);
    exitDoor = BR.createExitDoor();
    exitDoor.position.set(ec.x, 0, ec.z);
    propGroup.add(exitDoor);
    doorLocked = true;

    // Actors
    var sc = BR.tileCenter(level.spawnTile.tx, level.spawnTile.tz);
    player.position.set(sc.x, 0, sc.z);
    player.rotation.y = 0;
    player.visible = true;
    curVel = { x: 0, z: 0 };

    var hs = level.hunterSpawns;
    var tc = BR.tileCenter(hs[0].tx, hs[0].tz);
    teacher.position.set(tc.x, 0, tc.z);
    teacherVel = { x: 0, z: 0 };
    teacherState = 'patrol';
    teacherPenalty = 0;
    teacherPatrolField = null;
    teacherPatrolTarget = null;

    var lc = BR.tileCenter(hs[1].tx, hs[1].tz);
    lurker.position.set(lc.x, 0, lc.z);
    lurker.visible = false;
    lurkerActive = false;
    lurkerVel = { x: 0, z: 0 };

    watcher.visible = false;
    watcherActive = false;
    watcherTimer = 24;
    watcherUnseen = 0;
    watcherStareTimer = 0;

    keyCount = 0;
    keyCountEl.textContent = 0;
    wrongCount = 0;
    fear = 0;
    danger = 0;
    elapsed = 0;
    timerEl.textContent = '0:00';
    stamina = STAMINA_MAX;
    canSprint = true;
    sprintHeld = false;
    orbitYaw = Math.PI;
    orbitPitch = 0.22;
    camFrac = 1;
    playerFlow = null;
    flowTimer = 0;

    showToast('책 ' + books.length + '권 중 ' + KEYS_NEEDED + '문제를 풀어라', 3200);
  }

  function unlockDoor() {
    doorLocked = false;
    exitDoor.userData.panel.material.color.set(0x3fb04a);
    exitDoor.userData.panel.material.emissive.set(0x0f5a1c);
    exitDoor.userData.lamp.color.set(0x7dff9a);
    showToast('탈출문이 열렸다', 2600);
    tone(320, 0.5, 'triangle', 0.09);
  }

  function wakeLurker() {
    lurkerActive = true;
    lurker.visible = true;
    showToast('무언가가… 보고 있지 않을 때만 움직인다', 3400);
    noise(0.8, 0.14, 0, 600);
  }

  // =========================================================================
  // INPUT
  // =========================================================================
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerpAngle(a, b, t) {
    var d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  var lookId = null, lastX = 0, lastY = 0;
  var LOOK_SENS = 0.0105;
  var tapId = null, tapStartX = 0, tapStartY = 0, tapStartT = 0, tapDragged = false;

  container.addEventListener('pointerdown', function (e) {
    var rect = container.getBoundingClientRect();
    var lx = e.clientX - rect.left;
    tapId = e.pointerId; tapStartX = e.clientX; tapStartY = e.clientY;
    tapStartT = performance.now(); tapDragged = false;
    if (lx >= rect.width * 0.35 && lookId === null) {
      lookId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
      container.setPointerCapture(e.pointerId);
    }
  });
  container.addEventListener('pointermove', function (e) {
    if (e.pointerId === tapId) {
      if (Math.abs(e.clientX - tapStartX) > 8 || Math.abs(e.clientY - tapStartY) > 8) tapDragged = true;
    }
    if (e.pointerId !== lookId) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    orbitYaw -= dx * LOOK_SENS;
    orbitPitch = clamp(orbitPitch - dy * LOOK_SENS, -0.15, 0.62);
  });
  function endLook(e) {
    if (e.pointerId === lookId) lookId = null;
    if (e.pointerId === tapId) {
      if (!tapDragged && performance.now() - tapStartT < 350) handleTap(e.clientX, e.clientY);
      tapId = null;
    }
  }
  container.addEventListener('pointerup', endLook);
  container.addEventListener('pointercancel', endLook);

  var raycaster = new THREE.Raycaster();
  function handleTap(clientX, clientY) {
    if (gameState !== 'playing') return;
    var rect = container.getBoundingClientRect();
    var ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    var hits = raycaster.intersectObjects(booksGroup.children, true);
    if (hits.length) {
      var obj = hits[0].object;
      while (obj && obj.parent !== booksGroup) obj = obj.parent;
      var book = null;
      for (var i = 0; i < books.length; i++) if (books[i].mesh === obj) book = books[i];
      if (book && !book.solved) { tryOpenBook(book); return; }
    }
    interactNearest();
  }

  function interactNearest() {
    var best = null, bestD = INTERACT_RADIUS;
    books.forEach(function (b) {
      if (b.solved) return;
      var d = Math.hypot(player.position.x - b.mesh.position.x, player.position.z - b.mesh.position.z);
      if (d < bestD) { bestD = d; best = b; }
    });
    if (best) tryOpenBook(best);
  }

  var joy = document.getElementById('joystick');
  var stick = document.getElementById('stick');
  var joyId = null, joyVec = { x: 0, y: 0 }, joyRect = null;
  joy.addEventListener('pointerdown', function (e) {
    joyId = e.pointerId; joyRect = joy.getBoundingClientRect();
    joy.setPointerCapture(e.pointerId);
    updateJoy(e.clientX, e.clientY);
  });
  joy.addEventListener('pointermove', function (e) { if (e.pointerId === joyId) updateJoy(e.clientX, e.clientY); });
  function updateJoy(x, y) {
    var cx = joyRect.left + joyRect.width / 2, cy = joyRect.top + joyRect.height / 2;
    var dx = x - cx, dy = y - cy, max = joyRect.width / 2;
    var dist = Math.min(Math.hypot(dx, dy), max);
    var ang = Math.atan2(dy, dx);
    var nx = Math.cos(ang) * dist, ny = Math.sin(ang) * dist;
    stick.style.left = (25 + nx * 0.55) + 'px';
    stick.style.top = (25 + ny * 0.55) + 'px';
    var vx = nx / max, vy = ny / max;
    joyVec = Math.hypot(vx, vy) < 0.12 ? { x: 0, y: 0 } : { x: vx, y: vy };
  }
  function endJoy(e) {
    if (e.pointerId !== joyId) return;
    joyId = null; joyVec = { x: 0, y: 0 };
    stick.style.left = '25px'; stick.style.top = '25px';
  }
  joy.addEventListener('pointerup', endJoy);
  joy.addEventListener('pointercancel', endJoy);

  var runBtn = document.getElementById('runBtn');
  runBtn.addEventListener('pointerdown', function (e) { sprintHeld = true; runBtn.classList.add('active'); e.preventDefault(); });
  runBtn.addEventListener('pointerup', function () { sprintHeld = false; runBtn.classList.remove('active'); });
  runBtn.addEventListener('pointercancel', function () { sprintHeld = false; runBtn.classList.remove('active'); });

  var keys = {};
  window.addEventListener('keydown', function (e) {
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'e' && gameState === 'playing') interactNearest();
  });
  window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });

  // =========================================================================
  // CAMERA
  // =========================================================================
  function updateCamera(dt) {
    var eyeX = player.position.x, eyeY = CAM_EYE, eyeZ = player.position.z;
    var right = { x: Math.cos(orbitYaw), z: -Math.sin(orbitYaw) };
    var back = { x: Math.sin(orbitYaw) * Math.cos(orbitPitch), z: Math.cos(orbitYaw) * Math.cos(orbitPitch) };

    var targetX = eyeX + back.x * CAM_DIST + right.x * CAM_SHOULDER;
    var targetZ = eyeZ + back.z * CAM_DIST + right.z * CAM_SHOULDER;
    var targetY = eyeY + Math.sin(orbitPitch) * CAM_DIST;

    var dx = targetX - eyeX, dz = targetZ - eyeZ;
    var horiz = Math.hypot(dx, dz);
    var wanted = 1;
    if (horiz > 0.001) {
      var hit = BR.rayDistance(level, eyeX, eyeZ, dx, dz, horiz + 0.4);
      var allowed = Math.min(horiz, Math.max(0.3, hit - 0.32));
      wanted = allowed / horiz;
    }
    // Tile walls give an exact hit distance, so a single symmetric ease is
    // enough to keep this smooth without the camera ever clipping through.
    camFrac += (wanted - camFrac) * Math.min(1, dt * 20);

    var cx = eyeX + (targetX - eyeX) * camFrac;
    var cy = eyeY + (targetY - eyeY) * camFrac;
    var cz = eyeZ + (targetZ - eyeZ) * camFrac;

    var zoneSpec = BR.ZONES[BR.zoneAtWorld(level, player.position.x, player.position.z)];
    cy = Math.min(cy, zoneSpec.height - 0.3);

    // Last-resort guard: the shoulder offset swings sideways, so in a tight
    // corner the eased position can still land inside a wall. Reel it in until
    // it is back in open air.
    var guard = 0;
    while (BR.solidAtWorld(level, cx, cz) && guard++ < 8) {
      cx = eyeX + (cx - eyeX) * 0.65;
      cz = eyeZ + (cz - eyeZ) * 0.65;
      cy = eyeY + (cy - eyeY) * 0.65;
    }

    camera.position.set(cx, cy, cz);
    camera.lookAt(
      eyeX + right.x * CAM_SHOULDER * 0.6,
      eyeY - 0.08,
      eyeZ + right.z * CAM_SHOULDER * 0.6
    );

    // Squeezed against a wall the camera ends up inside the player, so drop
    // the body and let it read as first person until there is room again.
    // Hysteresis keeps it from strobing at the threshold.
    var camGap = Math.hypot(cx - eyeX, cz - eyeZ);
    if (player.visible && camGap < 1.15) player.visible = false;
    else if (!player.visible && camGap > 1.4) player.visible = true;
  }

  // =========================================================================
  // LIGHTING / ATMOSPHERE
  // =========================================================================
  var lightRefreshTimer = 0;
  function updateLights(dt) {
    lightRefreshTimer -= dt;
    if (lightRefreshTimer <= 0) {
      lightRefreshTimer = 0.18;
      var near = [];
      for (var i = 0; i < level.fixtures.length; i++) {
        var f = level.fixtures[i];
        var d2 = (f.x - player.position.x) * (f.x - player.position.x) +
                 (f.z - player.position.z) * (f.z - player.position.z);
        if (d2 < 650) near.push({ f: f, d2: d2 });
      }
      near.sort(function (a, b) { return a.d2 - b.d2; });
      for (var p = 0; p < lightPool.length; p++) {
        lightPool[p].fixture = p < near.length ? near[p].f : null;
      }
    }

    for (var k = 0; k < lightPool.length; k++) {
      var slot = lightPool[k];
      if (!slot.fixture) { slot.light.intensity *= 0.9; continue; }
      var fx = slot.fixture;
      slot.light.position.set(fx.x, fx.y, fx.z);
      slot.light.color.setHex(fx.color);
      slot.phase += dt * (3 + fx.flicker * 40);
      var flick = 1;
      if (Math.random() < fx.flicker * (0.5 + danger)) flick = 0.25;
      else flick = 0.92 + Math.sin(slot.phase) * 0.08;
      var target = fx.intensity * flick;
      slot.light.intensity += (target - slot.light.intensity) * Math.min(1, dt * 12);
      slot.light.distance = 15;
    }

    playerLamp.position.set(player.position.x, 1.75, player.position.z);
  }

  var fogColor = new THREE.Color(bg);
  function updateAtmosphere(dt) {
    var zoneSpec = BR.ZONES[BR.zoneAtWorld(level, player.position.x, player.position.z)];
    fogColor.lerp(new THREE.Color(zoneSpec.fog), Math.min(1, dt * 1.6));
    scene.fog.color.copy(fogColor);
    scene.background.copy(fogColor);
    scene.fog.near += (zoneSpec.fogNear - scene.fog.near) * Math.min(1, dt * 1.6);
    // Fear tightens the fog in on the player.
    var fearPull = 1 - (fear / 100) * 0.45;
    scene.fog.far += (zoneSpec.fogFar * fearPull - scene.fog.far) * Math.min(1, dt * 1.6);

    if (zoneLabel.dataset.zone !== zoneSpec.key) {
      zoneLabel.dataset.zone = zoneSpec.key;
      zoneLabel.textContent = zoneSpec.name;
      zoneLabel.classList.remove('show');
      void zoneLabel.offsetWidth;
      zoneLabel.classList.add('show');
      if (droneFilter) droneFilter.frequency.value = 160 + zoneSpec.height * 40;
    }

    waterMeshes.forEach(function (w) {
      w.tex.offset.x += dt * 0.012;
      w.tex.offset.y += dt * 0.008;
    });

    books.forEach(function (b, i) {
      if (b.solved) return;
      b.mesh.rotation.y += dt * 0.7;
      var body = b.mesh.userData.body;
      if (body) body.position.y = 0.78 + Math.sin(elapsed * 1.7 + i) * 0.09;
      var halo = b.mesh.userData.halo;
      if (halo) halo.intensity = 0.7 + Math.sin(elapsed * 3 + i) * 0.25;
    });
  }

  // =========================================================================
  // ENTITY AI
  // =========================================================================
  function steer(obj, vel, targetX, targetZ, speed, dt, faceMove) {
    var dx = targetX - obj.position.x, dz = targetZ - obj.position.z;
    var dist = Math.hypot(dx, dz);
    if (dist < 0.001) return 0;
    var vx = (dx / dist) * speed, vz = (dz / dist) * speed;
    vel.x += (vx - vel.x) * Math.min(1, dt * 9);
    vel.z += (vz - vel.z) * Math.min(1, dt * 9);
    obj.position.x += vel.x * dt;
    obj.position.z += vel.z * dt;
    if (faceMove !== false) {
      var ang = Math.atan2(-vel.x, -vel.z);
      obj.rotation.y = lerpAngle(obj.rotation.y, ang, 0.18);
    }
    return Math.hypot(vel.x, vel.z);
  }

  function followFlow(obj, vel, field, speed, dt) {
    var t = BR.tileOf(obj.position.x, obj.position.z);
    var next = BR.flowStep(level, field, t.tx, t.tz);
    var target;
    if (!next) {
      target = { x: player.position.x, z: player.position.z };
    } else {
      var c = BR.tileCenter(next.tx, next.tz);
      target = { x: c.x, z: c.z };
    }
    return steer(obj, vel, target.x, target.z, speed, dt);
  }

  // Is this object inside the player's view cone with a clear line to it?
  function isObserved(obj, maxDist, cone) {
    var dx = obj.position.x - camera.position.x;
    var dz = obj.position.z - camera.position.z;
    var d = Math.hypot(dx, dz);
    if (d > maxDist) return false;
    var fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    var flen = Math.hypot(fwd.x, fwd.z) || 1;
    var dot = (fwd.x * dx + fwd.z * dz) / (flen * (d || 1));
    if (dot < cone) return false;
    return BR.hasLineOfSight(level, camera.position.x, camera.position.z, obj.position.x, obj.position.z);
  }

  function updateTeacher(dt) {
    var dx = teacher.position.x - player.position.x;
    var dz = teacher.position.z - player.position.z;
    var distToPlayer = Math.hypot(dx, dz);

    if (teacherState === 'patrol') {
      if (distToPlayer < TEACHER_DETECT &&
          BR.hasLineOfSight(level, teacher.position.x, teacher.position.z, player.position.x, player.position.z)) {
        teacherState = 'chase';
        showToast('선생님이 당신을 발견했다!');
        tone(240, 0.3, 'square', 0.1, panFor(teacher.position.x, teacher.position.z));
      }
    } else if (distToPlayer > TEACHER_LOSE) {
      teacherState = 'patrol';
      teacherPatrolField = null;
      showToast('선생님을 따돌렸다');
    }

    var moved;
    if (teacherState === 'chase' && playerFlow) {
      moved = followFlow(teacher, teacherVel, playerFlow,
        Math.min(TEACHER_CHASE_CAP, TEACHER_CHASE_BASE + teacherPenalty), dt);
    } else {
      if (!teacherPatrolField || !teacherPatrolTarget ||
          Math.hypot(teacher.position.x - teacherPatrolTarget.x, teacher.position.z - teacherPatrolTarget.z) < 1.2) {
        var spot = level.reachable[Math.floor(Math.random() * level.reachable.length)];
        teacherPatrolField = BR.flowField(level, spot.tx, spot.tz);
        var c = BR.tileCenter(spot.tx, spot.tz);
        teacherPatrolTarget = { x: c.x, z: c.z };
      }
      moved = followFlow(teacher, teacherVel, teacherPatrolField, TEACHER_PATROL, dt);
    }

    setWalking(teacherAnim, moved > 0.25);
    if (teacherAnim.mixer) teacherAnim.mixer.update(dt);

    if (distToPlayer < CATCH_RADIUS) endGame('gameover', '선생님에게 붙잡혔다');
  }

  function updateLurker(dt) {
    if (!lurkerActive) return;
    var observed = isObserved(lurker, 34, 0.35);

    if (observed) {
      // Frozen while watched - it only twitches.
      lurkerVel.x *= 0.1; lurkerVel.z *= 0.1;
      lurker.userData.limbs.forEach(function (limb, i) {
        limb.rotation.x += Math.sin(elapsed * 11 + i) * 0.004;
      });
      var faceAng = Math.atan2(-(player.position.x - lurker.position.x), -(player.position.z - lurker.position.z));
      lurker.rotation.y = lerpAngle(lurker.rotation.y, faceAng, 0.08);
    } else if (playerFlow) {
      var moved = followFlow(lurker, lurkerVel, playerFlow, LURKER_SPEED, dt);
      lurker.userData.limbs.forEach(function (limb, i) {
        limb.rotation.x = Math.sin(elapsed * 9 + i * 1.6) * 0.5;
      });
      lurkerStepTimer -= dt;
      if (lurkerStepTimer <= 0 && moved > 0.5) {
        lurkerStepTimer = 0.22;
        var d = Math.hypot(lurker.position.x - player.position.x, lurker.position.z - player.position.z);
        if (d < 26) {
          noise(0.07, Math.max(0.02, 0.16 - d * 0.005), panFor(lurker.position.x, lurker.position.z), 2600);
        }
      }
    }

    var dist = Math.hypot(lurker.position.x - player.position.x, lurker.position.z - player.position.z);
    if (dist < LURKER_CATCH) endGame('gameover', '보지 않은 사이, 그것이 닿았다');
  }

  function spawnWatcher() {
    var candidates = level.reachable.filter(function (t) {
      var c = BR.tileCenter(t.tx, t.tz);
      var d = Math.hypot(c.x - player.position.x, c.z - player.position.z);
      if (d < 11 || d > 26) return false;
      var zoneSpec = BR.ZONES[BR.zoneAt(level, t.tx, t.tz)];
      if (zoneSpec.height < 3.6) return false;
      return BR.hasLineOfSight(level, c.x, c.z, player.position.x, player.position.z);
    });
    if (!candidates.length) { watcherTimer = 6; return; }
    var pick = candidates[Math.floor(Math.random() * candidates.length)];
    var c2 = BR.tileCenter(pick.tx, pick.tz);
    watcher.position.set(c2.x, 0, c2.z);
    watcher.visible = true;
    watcherActive = true;
    watcherUnseen = 0;
    watcherStareTimer = 0;
    noise(1.1, 0.07, panFor(c2.x, c2.z), 400);
  }

  function updateWatcher(dt) {
    if (!watcherActive) {
      watcherTimer -= dt;
      if (watcherTimer <= 0) spawnWatcher();
      return;
    }

    var faceAng = Math.atan2(-(player.position.x - watcher.position.x), -(player.position.z - watcher.position.z));
    watcher.rotation.y = lerpAngle(watcher.rotation.y, faceAng, 0.12);

    var seen = isObserved(watcher, 40, 0.72);
    var dist = Math.hypot(watcher.position.x - player.position.x, watcher.position.z - player.position.z);

    if (seen) {
      watcherUnseen = 0;
      fear = Math.min(100, fear + WATCHER_FEAR_RATE * dt * (1 + (26 - Math.min(dist, 26)) / 40));
      watcherStareTimer += dt;
      // Keep staring and it closes the gap in sudden steps - but it always
      // keeps its distance, looming rather than filling the screen.
      if (watcherStareTimer > 3.6 && dist > 10) {
        watcherStareTimer = 0;
        var t = BR.tileOf(watcher.position.x, watcher.position.z);
        var pt = BR.tileOf(player.position.x, player.position.z);
        var field = BR.flowField(level, pt.tx, pt.tz);
        var step = BR.flowStep(level, field, t.tx, t.tz);
        for (var s = 0; s < 2 && step; s++) {
          t = step;
          step = BR.flowStep(level, field, t.tx, t.tz);
        }
        var c = BR.tileCenter(t.tx, t.tz);
        if (Math.hypot(c.x - player.position.x, c.z - player.position.z) > 7) {
          watcher.position.set(c.x, 0, c.z);
          noise(0.25, 0.14, panFor(c.x, c.z), 900);
        }
      }
      // Walk right up to it and it simply is not there any more.
      if (dist < 4) {
        watcher.visible = false;
        watcherActive = false;
        watcherTimer = 20 + Math.random() * 16;
        fear = Math.min(100, fear + 16);
        noise(0.5, 0.2, 0, 1800);
        tone(150, 0.4, 'sawtooth', 0.12);
      }
    } else {
      watcherUnseen += dt;
      if (watcherUnseen > 3.5) {
        watcher.visible = false;
        watcherActive = false;
        watcherTimer = 14 + Math.random() * 16;
      }
    }

    if (watcher.userData.glow) {
      watcher.userData.glow.intensity = 0.35 + (fear / 100) * 0.8;
    }

    if (fear >= 100) endGame('gameover', '너무 오래 바라보았다');
  }

  // =========================================================================
  // GAME FLOW
  // =========================================================================
  function endGame(state, reason) {
    if (gameState !== 'playing' && gameState !== 'question') return;
    gameState = state;
    questionModal.style.display = 'none';
    // Overlays freeze at whatever they were showing, so wipe them by hand.
    staticCanvas.style.opacity = 0;
    vignetteEl.style.opacity = 0.55;
    vignetteEl.classList.remove('alarm');
    fear = 0;
    if (state === 'gameover') {
      document.getElementById('gameOverReason').textContent = reason;
      document.getElementById('gameOverScreen').hidden = false;
      tone(90, 0.8, 'sawtooth', 0.14);
      noise(1.2, 0.18, 0, 500);
    } else {
      var best = readBestTime();
      var isRecord = best === null || elapsed < best;
      if (isRecord) writeBestTime(elapsed);

      document.getElementById('winTime').textContent = formatTime(elapsed);
      document.getElementById('winSolved').textContent = keyCount + ' / ' + books.length;
      document.getElementById('winWrong').textContent = wrongCount + '회';
      document.getElementById('winBest').textContent = isRecord
        ? '신기록!'
        : formatTime(best);
      document.getElementById('winBest').classList.toggle('record', isRecord);

      document.getElementById('winScreen').hidden = false;
      tone(520, 0.14, 'sine', 0.09);
      setTimeout(function () { tone(680, 0.14, 'sine', 0.09); }, 140);
      setTimeout(function () { tone(880, 0.35, 'sine', 0.09); }, 290);
    }
    if (whineGain) whineGain.gain.value = 0;
  }

  function startRound() {
    initAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    document.getElementById('startScreen').hidden = true;
    document.getElementById('gameOverScreen').hidden = true;
    document.getElementById('winScreen').hidden = true;
    setupGame();
    resize();
    gameState = 'playing';
  }

  document.getElementById('startBtn').addEventListener('click', startRound);
  document.getElementById('retryBtn').addEventListener('click', startRound);
  document.getElementById('againBtn').addEventListener('click', startRound);

  // =========================================================================
  // PLAYER
  // =========================================================================
  function updatePlayer(dt) {
    var moveX = joyVec.x, moveZ = joyVec.y;
    if (keys['w'] || keys['arrowup']) moveZ -= 1;
    if (keys['s'] || keys['arrowdown']) moveZ += 1;
    if (keys['a'] || keys['arrowleft']) moveX -= 1;
    if (keys['d'] || keys['arrowright']) moveX += 1;
    var mag = Math.hypot(moveX, moveZ);
    if (mag > 1) { moveX /= mag; moveZ /= mag; }

    var wantsSprint = (sprintHeld || keys['shift']) && canSprint && mag > 0.05;
    if (wantsSprint) {
      stamina = Math.max(0, stamina - STAMINA_DRAIN * dt);
      if (stamina <= 0) canSprint = false;
    } else {
      stamina = Math.min(STAMINA_MAX, stamina + STAMINA_REGEN * dt);
      if (!canSprint && stamina >= STAMINA_RESUME) canSprint = true;
    }
    staminaFill.style.width = (stamina / STAMINA_MAX * 100) + '%';
    staminaFill.classList.toggle('low', stamina < STAMINA_RESUME);

    var inWater = BR.waterAtWorld(level, player.position.x, player.position.z);
    var maxSpeed = WALK_SPEED * (wantsSprint ? SPRINT_MULT : 1) * (inWater ? WATER_MULT : 1);

    var targetVX = 0, targetVZ = 0;
    if (moveX || moveZ) {
      var forward = { x: -Math.sin(orbitYaw), z: -Math.cos(orbitYaw) };
      var right = { x: Math.cos(orbitYaw), z: -Math.sin(orbitYaw) };
      targetVX = (forward.x * -moveZ + right.x * moveX) * maxSpeed;
      targetVZ = (forward.z * -moveZ + right.z * moveX) * maxSpeed;
    }
    curVel.x += (targetVX - curVel.x) * Math.min(1, dt * 14);
    curVel.z += (targetVZ - curVel.z) * Math.min(1, dt * 14);

    var nx = player.position.x + curVel.x * dt;
    var nz = player.position.z + curVel.z * dt;
    if (!BR.blocked(level, nx, player.position.z, PLAYER_RADIUS)) player.position.x = nx; else curVel.x = 0;
    if (!BR.blocked(level, player.position.x, nz, PLAYER_RADIUS)) player.position.z = nz; else curVel.z = 0;

    var speedMag = Math.hypot(curVel.x, curVel.z);
    if (speedMag > 0.3) {
      player.rotation.y = lerpAngle(player.rotation.y, Math.atan2(-curVel.x, -curVel.z), 0.26);
    }
    setWalking(playerAnim, speedMag > 0.3);
    if (playerAnim.mixer) {
      playerAnim.mixer.timeScale = wantsSprint ? 1.6 : 1;
      playerAnim.mixer.update(dt);
    }

    // Footsteps double as a water cue.
    stepTimer -= dt;
    if (speedMag > 0.6 && stepTimer <= 0) {
      stepTimer = wantsSprint ? 0.3 : 0.46;
      if (inWater) noise(0.18, 0.06, 0, 2200);
      else noise(0.07, 0.035, 0, 700);
    }

    // Exit
    if (exitDoor) {
      doorToastCooldown -= dt;
      var dDist = Math.hypot(player.position.x - exitDoor.position.x, player.position.z - exitDoor.position.z);
      if (dDist < 1.8) {
        if (!doorLocked) endGame('win');
        else if (doorToastCooldown <= 0) {
          showToast('열쇠가 부족하다 (' + keyCount + '/' + KEYS_NEEDED + ')');
          doorToastCooldown = 2.5;
        }
      } else if (dDist < 16 && Math.random() < dt * 0.6) {
        tone(70, 0.5, 'sine', 0.02, panFor(exitDoor.position.x, exitDoor.position.z));
      }
    }

    // Nearby unsolved books whisper so a map-less level stays findable.
    bookPingTimer -= dt;
    if (bookPingTimer <= 0) {
      bookPingTimer = 1.6;
      var nearest = null, nearestD = 15;
      books.forEach(function (b) {
        if (b.solved) return;
        var d = Math.hypot(player.position.x - b.mesh.position.x, player.position.z - b.mesh.position.z);
        if (d < nearestD) { nearestD = d; nearest = b; }
      });
      if (nearest) {
        tone(1180, 0.11, 'sine', 0.018 + (15 - nearestD) * 0.003,
          panFor(nearest.mesh.position.x, nearest.mesh.position.z));
      }
    }
  }

  // =========================================================================
  // TENSION
  // =========================================================================
  function updateTension(dt) {
    var nearest = Infinity;
    var dT = Math.hypot(teacher.position.x - player.position.x, teacher.position.z - player.position.z);
    nearest = Math.min(nearest, dT);
    if (lurkerActive) {
      nearest = Math.min(nearest, Math.hypot(lurker.position.x - player.position.x, lurker.position.z - player.position.z));
    }

    var proximity = clamp(1 - (nearest - 2) / 15, 0, 1);
    if (teacherState === 'chase') proximity = Math.max(proximity, 0.55);
    danger += (proximity - danger) * Math.min(1, dt * 3);

    if (!watcherActive || !isObserved(watcher, 40, 0.72)) {
      fear = Math.max(0, fear - WATCHER_FEAR_DECAY * dt);
    }

    var vig = 0.32 + danger * 0.42 + (fear / 100) * 0.2;
    vignetteEl.style.opacity = Math.min(0.95, vig);
    vignetteEl.classList.toggle('alarm', teacherState === 'chase' || danger > 0.7);

    drawStatic(fear / 100);
    if (whineGain && actx) {
      whineGain.gain.value = (fear / 100) * 0.03;
      whineOsc.frequency.value = 2100 + (fear / 100) * 1500;
    }
    if (droneGain) droneGain.gain.value = 0.03 + danger * 0.035;

    heartTimer -= dt;
    if (danger > 0.16 && heartTimer <= 0) {
      heartTimer = 1.15 - danger * 0.8;
      heartbeat(danger);
    }
  }

  // =========================================================================
  // MAIN LOOP
  // =========================================================================
  var clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);

    if ((gameState === 'playing' || gameState === 'question') && level) {
      elapsed += dt;
      timerEl.textContent = formatTime(elapsed);

      flowTimer -= dt;
      if (flowTimer <= 0) {
        flowTimer = 0.3;
        var pt = BR.tileOf(player.position.x, player.position.z);
        playerFlow = BR.flowField(level, pt.tx, pt.tz);
      }

      if (gameState === 'playing') updatePlayer(dt);

      updateTeacher(dt);
      updateLurker(dt);
      updateWatcher(dt);
      updateTension(dt);
      updateLights(dt);
      updateAtmosphere(dt);
      updateCamera(dt);
    }

    renderer.render(scene, camera);
  }

  resize();
  animate();

})();
