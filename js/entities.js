/* Procedural entity silhouettes. These are built from primitives so the game
   has no hard asset dependency - drop a .glb in assets/models and it replaces
   the matching shape automatically (see ASSET_PATHS in main.js). */
window.BR = window.BR || {};
(function (BR) {
  'use strict';

  function limbSegment(mat, len, thick) {
    var geo = new THREE.CylinderGeometry(thick, thick * 0.8, len, 5);
    geo.translate(0, -len / 2, 0);
    return new THREE.Mesh(geo, mat);
  }

  // A spindly black armature - long kinked limbs, hunched skull, no mass.
  BR.createLurker = function () {
    var group = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.95, metalness: 0.05 });

    var spine = limbSegment(mat, 1.05, 0.055);
    spine.position.y = 1.6;
    group.add(spine);

    var hip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.12), mat);
    hip.position.y = 0.58;
    group.add(hip);

    var shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.12), mat);
    shoulder.position.y = 1.58;
    group.add(shoulder);

    var skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 0), mat);
    skull.scale.set(1, 1.25, 0.85);
    skull.position.set(0, 1.82, 0.05);
    skull.rotation.z = 0.25;
    group.add(skull);

    // Arms and legs get randomised kinks so no two lurkers stand alike.
    function buildLimb(rootX, rootY, upperLen, lowerLen, swing, forward) {
      var upper = limbSegment(mat, upperLen, 0.045);
      upper.position.set(rootX, rootY, 0);
      upper.rotation.z = swing;
      upper.rotation.x = forward;
      var lower = limbSegment(mat, lowerLen, 0.035);
      lower.position.set(0, -upperLen, 0);
      lower.rotation.z = -swing * 1.8;
      lower.rotation.x = -forward * 0.6;
      upper.add(lower);
      var digit = limbSegment(mat, 0.22, 0.02);
      digit.position.set(0, -lowerLen, 0);
      digit.rotation.z = swing * 0.9;
      lower.add(digit);
      group.add(upper);
      return upper;
    }

    var jitter = function () { return (Math.random() - 0.5) * 0.5; };
    group.userData.limbs = [
      buildLimb(-0.26, 1.58, 0.62, 0.66, 0.55 + jitter(), 0.18),
      buildLimb(0.26, 1.58, 0.62, 0.66, -0.55 + jitter(), -0.24),
      buildLimb(-0.16, 0.58, 0.58, 0.6, 0.12 + jitter() * 0.4, 0.1),
      buildLimb(0.16, 0.58, 0.58, 0.6, -0.12 + jitter() * 0.4, -0.1)
    ];

    var shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);

    return group;
  };

  // Very tall, very thin, and the only light on it is its eyes.
  BR.createWatcher = function () {
    var group = new THREE.Group();
    var skin = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.9 });

    var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.9, 8), skin);
    torso.position.y = 2.05;
    group.add(torso);

    var legs = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 1.25, 8), skin);
    legs.position.y = 0.62;
    group.add(legs);

    var head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 14), skin);
    head.scale.set(0.85, 1.15, 0.9);
    head.position.y = 3.18;
    group.add(head);

    var eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    [-0.075, 0.075].forEach(function (ox) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMat);
      eye.position.set(ox, 3.22, 0.17);
      group.add(eye);
    });

    // Arms reach almost to the floor, like the reference silhouette.
    [-1, 1].forEach(function (side) {
      var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.035, 2.3, 6), skin);
      arm.position.set(side * 0.26, 1.95, 0);
      arm.rotation.z = side * 0.06;
      group.add(arm);
    });

    var glow = new THREE.PointLight(0xbfe8ff, 0.45, 5);
    glow.position.set(0, 3.2, 0.2);
    group.add(glow);
    group.userData.glow = glow;

    return group;
  };

  // Fallback teacher body, used until assets/models/baldi.glb loads.
  BR.createTeacherPlaceholder = function () {
    var group = new THREE.Group();
    var shirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.42, 0.95, 12),
      new THREE.MeshStandardMaterial({ color: 0x2fae3f, roughness: 0.7 })
    );
    shirt.position.y = 0.72;
    group.add(shirt);

    var legMat = new THREE.MeshStandardMaterial({ color: 0x2244aa });
    [-0.14, 0.14].forEach(function (ox) {
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.62, 8), legMat);
      leg.position.set(ox, 0.31, 0);
      group.add(leg);
    });

    var head = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xe8cf9a, roughness: 0.75 })
    );
    head.position.y = 1.5;
    group.add(head);
    return group;
  };

  // Fallback player body.
  BR.createPlayerPlaceholder = function () {
    var group = new THREE.Group();
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.4, 1.0, 12),
      new THREE.MeshStandardMaterial({ color: 0x7a3b3b, roughness: 0.7 })
    );
    body.position.y = 0.7;
    group.add(body);
    var head = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 14, 14),
      new THREE.MeshStandardMaterial({ color: 0xd9b98a, roughness: 0.8 })
    );
    head.position.y = 1.45;
    group.add(head);
    return group;
  };

  // Glowing notebook the player taps to trigger a math problem. It floats and
  // spins so it stays readable as an objective across a dark room.
  BR.createBook = function () {
    var group = new THREE.Group();
    var body = new THREE.Group();

    var cover = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.075, 0.56),
      new THREE.MeshStandardMaterial({
        color: 0x2f5fd0, emissive: 0x2b5fff, emissiveIntensity: 0.9, roughness: 0.45
      })
    );
    body.add(cover);

    var pages = new THREE.Mesh(
      new THREE.BoxGeometry(0.40, 0.055, 0.52),
      new THREE.MeshStandardMaterial({
        color: 0xf6efd8, emissive: 0xfff4d0, emissiveIntensity: 0.55, roughness: 0.8
      })
    );
    pages.position.y = 0.035;
    body.add(pages);

    var spine = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.1, 0.57),
      new THREE.MeshStandardMaterial({
        color: 0x1d3f96, emissive: 0x2b5fff, emissiveIntensity: 0.7, roughness: 0.4
      })
    );
    spine.position.set(-0.21, 0.01, 0);
    body.add(spine);

    body.rotation.z = 0.25;
    body.position.y = 0.78;
    group.add(body);
    group.userData.body = body;

    var halo = new THREE.PointLight(0x6fa8ff, 0.9, 7);
    halo.position.y = 0.85;
    group.add(halo);
    group.userData.halo = halo;
    return group;
  };

  // Locked exit; turns green and stops blocking once every key is found.
  BR.createExitDoor = function () {
    var group = new THREE.Group();
    var frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 3.3, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x4a3a1c, roughness: 0.9 })
    );
    frame.position.y = 1.65;
    group.add(frame);

    var panel = new THREE.Mesh(
      new THREE.BoxGeometry(1.75, 2.8, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xb03030, emissive: 0x501008, emissiveIntensity: 0.7 })
    );
    panel.position.set(0, 1.62, 0.13);
    group.add(panel);

    var lamp = new THREE.PointLight(0xff5a44, 1.1, 8);
    lamp.position.set(0, 2.6, 0.5);
    group.add(lamp);

    group.userData.panel = panel;
    group.userData.lamp = lamp;
    return group;
  };

})(window.BR);
