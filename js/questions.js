/* Rounding problems (5학년 어림하기). Kept separate from main.js so the maths
   can be tested in Node without a browser:
     node -e "global.window={};require('./js/questions.js');console.log(window.BR.genQuestion())"
   Every question carries `explain`, shown after a wrong answer so a miss
   still teaches something. Numbers are handled as integers throughout -
   no floating-point rounding anywhere. */
window.BR = window.BR || {};
(function (BR) {
  'use strict';

  var PLACE_NAME = { 1: '일', 10: '십', 100: '백', 1000: '천', 10000: '만' };

  function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function fmtInt(n) { return n.toLocaleString('ko-KR'); }
  // Integer-only rounding: (n + unit/2) / unit, floored.
  function roundUnit(n, unit) { return Math.floor((n + unit / 2) / unit) * unit; }

  // 을/를 for a number: depends on the Korean reading of the last digit.
  // 이(2)·사(4)·오(5)·구(9) end in a vowel, everything else in a consonant.
  function numHasBatchim(numText) {
    var digits = numText.replace(/[^0-9]/g, '');
    return '2459'.indexOf(digits.charAt(digits.length - 1)) < 0;
  }
  function objParticle(numText) { return numHasBatchim(numText) ? '을' : '를'; }

  // 이/가 for a Korean word, read off the final syllable's 받침.
  function subjParticle(word) {
    var code = word.charCodeAt(word.length - 1) - 0xAC00;
    if (code < 0 || code > 11171) return '이(가)';
    return code % 28 ? '이' : '가';
  }

  // Up/down verdict for the digit that decides the rounding.
  function verdict(digit) {
    return digit + ' → ' + (digit >= 5 ? '5 이상이라 올림' : '5보다 작아서 버림');
  }

  function buildChoices(correctLabel, wrongLabels, topUp) {
    // Dedupe on numeric value: "3" and "3.0" are the same answer.
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

  function intExplain(n, unit, answer) {
    var look = unit / 10;
    var digit = Math.floor(n / look) % 10;
    return PLACE_NAME[look] + '의 자리 숫자를 봐요: ' + verdict(digit) +
      '\n' + fmtInt(n) + ' → ' + fmtInt(answer);
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
      explain: intExplain(n, unit, answer),
      choices: buildChoices(fmtInt(answer), intLabels(answer, [
        Math.ceil(n / unit) * unit,
        Math.floor(n / unit) * unit,
        roundUnit(n, unit * 10),
        answer + unit,
        answer - unit
      ]), intTopUp(answer, unit))
    };
  }

  // Decimals, kept as hundredths (k = 105 means 1.05).
  function decText(k) {
    var r = k % 100;
    return Math.floor(k / 100) + '.' + (r < 10 ? '0' : '') + r;
  }
  function tenthsText(t) { return Math.floor(t / 10) + '.' + (t % 10); }

  function qDecimalRound() {
    var deep = Math.random() < 0.5;          // deep = round at the 2nd decimal
    var k, guard = 0;
    do {
      k = ri(105, 990);
      // A one-decimal answer of "3.0" would make "3" equally correct.
    } while (deep && Math.floor((k + 5) / 10) % 10 === 0 && guard++ < 50);
    var nText = decText(k);
    var answerText, wrongs, digit, step;
    if (!deep) {
      var a = Math.floor((k + 50) / 100);
      answerText = String(a);
      digit = Math.floor(k / 10) % 10;
      wrongs = [String(Math.ceil(k / 100)), String(Math.floor(k / 100)),
                tenthsText(Math.floor((k + 5) / 10)), String(a + 1)];
      step = function (n) {
        var v = a + (n % 2 ? 1 : -1) * Math.ceil(n / 2);
        return v > 0 ? String(v) : null;
      };
    } else {
      var t = Math.floor((k + 5) / 10);        // answer in tenths
      answerText = tenthsText(t);
      digit = k % 10;
      wrongs = [tenthsText(Math.ceil(k / 10)), tenthsText(Math.floor(k / 10)),
                String(Math.floor((k + 50) / 100)), tenthsText(t + 1)];
      step = function (n) {
        var v = t + (n % 2 ? 1 : -1) * Math.ceil(n / 2);
        return v > 0 ? tenthsText(v) : null;
      };
    }
    return {
      text: nText + objParticle(nText) + ' 소수 ' + (deep ? '둘째' : '첫째') + ' 자리에서 반올림하면?',
      explain: '소수 ' + (deep ? '둘째' : '첫째') + ' 자리 숫자를 봐요: ' + verdict(digit) +
        '\n' + nText + ' → ' + answerText,
      choices: buildChoices(answerText, wrongs, step)
    };
  }

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
      text: ctx.subject + subjParticle(ctx.subject) + ' ' + fmtInt(n) + ctx.unit + '입니다. ' +
            PLACE_NAME[unit / 10] + '의 자리에서 반올림하면 약 몇 ' + ctx.unit + '일까요?',
      explain: intExplain(n, unit, answer) + ctx.unit,
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

  function rangeExplain(target, unit) {
    return '반올림해서 ' + fmtInt(target) + '이 되는 수는\n' +
      fmtInt(target - unit / 2) + ' 이상 ' + fmtInt(target + unit / 2) + ' 미만이에요';
  }

  // Reverse: which of these numbers rounds to the given value?
  function qReverseRound() {
    var unit = [10, 100][ri(0, 1)];
    var target = roundUnit(ri(unit * 3, unit * 80), unit);
    var half = unit / 2;
    var correct = ri(target - half, target + half - 1);
    var wrongs = intLabels(correct, [
      target - half - ri(1, half - 1),
      target + half + ri(0, half - 1),
      target + unit + ri(1, half - 1)
    ]);
    return {
      text: '반올림하여 ' + PLACE_NAME[unit] + '의 자리까지 나타내면 ' + fmtInt(target) + '이 되는 수는?',
      explain: rangeExplain(target, unit),
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
      explain: rangeExplain(target, unit) + '\n그래서 가장 ' + (wantSmallest ? '작은' : '큰') +
        ' 수는 ' + fmtInt(answer),
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
  BR.QUESTION_POOL = QUESTION_POOL;

  BR.genQuestion = function () {
    var q = QUESTION_POOL[Math.floor(Math.random() * QUESTION_POOL.length)]();
    if (q.choices.length < 4) q = qIntRound(0);
    return q;
  };

})(window.BR);
