/* Tile-based backrooms level: zoned rooms joined by narrow corridors.
   Everything downstream (collision, line of sight, pathing) reads the tile
   grid directly rather than the meshes, so geometry stays a pure render
   concern. */
window.BR = window.BR || {};
(function (BR) {
  'use strict';

  var TILE = 3.3;
  var GW = 64, GH = 64;
  var STEP = 1.2;            // height of one terrace level
  var CRATE_COUNT = 16;

  var HALL = 0, MAZE = 1, PILLAR = 2, POOL = 3, RED = 4, STAIR = 5;

  var ZONES = [
    { key: 'hall', name: '노란 복도', height: 3.7,
      wall:  { base: '#bd9f59', grain: 0.05, mode: 'stripe' },
      floor: { base: '#87713f', grain: 0.12, mode: 'carpet' },
      ceil:  { base: '#ccb072', grain: 0.03, mode: 'panel' },
      fog: 0x15100a, fogNear: 2.4, fogFar: 19,
      lightColor: 0xfff0bb, lightIntensity: 1.15, lightStep: 4, flicker: 0.02 },

    { key: 'maze', name: '미로', height: 3.05,
      wall:  { base: '#a98d4c', grain: 0.07, mode: 'stripe' },
      floor: { base: '#75643a', grain: 0.14, mode: 'carpet' },
      ceil:  { base: '#b39a63', grain: 0.04, mode: 'panel' },
      fog: 0x0f0b05, fogNear: 1.8, fogFar: 12,
      lightColor: 0xffe7a4, lightIntensity: 0.8, lightStep: 7, flicker: 0.08 },

    { key: 'pillar', name: '기둥 홀', height: 5.4,
      wall:  { base: '#b0a077', grain: 0.05, mode: 'concrete' },
      floor: { base: '#7a7053', grain: 0.09, mode: 'concrete' },
      ceil:  { base: '#bdaa82', grain: 0.03, mode: 'panel' },
      fog: 0x100f0a, fogNear: 3, fogFar: 24,
      lightColor: 0xf6eed2, lightIntensity: 0.9, lightStep: 6, flicker: 0.03 },

    { key: 'pool', name: '풀룸', height: 5.9,
      wall:  { base: '#dde6e1', grain: 0.02, mode: 'tile' },
      floor: { base: '#c9d4cf', grain: 0.03, mode: 'tile' },
      ceil:  { base: '#e6ede8', grain: 0.02, mode: 'tile' },
      fog: 0x08160f, fogNear: 3.2, fogFar: 26,
      lightColor: 0xd6fff0, lightIntensity: 1.2, lightStep: 5, flicker: 0.01 },

    { key: 'red', name: '레드존', height: 3.3,
      wall:  { base: '#732220', grain: 0.08, mode: 'stripe' },
      floor: { base: '#451412', grain: 0.12, mode: 'carpet' },
      ceil:  { base: '#5c1a18', grain: 0.05, mode: 'panel' },
      fog: 0x160303, fogNear: 1.6, fogFar: 11,
      lightColor: 0xff4f3c, lightIntensity: 1.3, lightStep: 5, flicker: 0.07 },

    { key: 'stair', name: '계단 홀', height: 7.8,
      wall:  { base: '#9a9886', grain: 0.05, mode: 'concrete' },
      floor: { base: '#6c695a', grain: 0.08, mode: 'concrete' },
      ceil:  { base: '#a8a690', grain: 0.03, mode: 'panel' },
      fog: 0x0c0d0b, fogNear: 3, fogFar: 25,
      lightColor: 0xeef2dc, lightIntensity: 1.05, lightStep: 5, flicker: 0.04 }
  ];

  BR.TILE = TILE;
  BR.GW = GW;
  BR.GH = GH;
  BR.ZONES = ZONES;
  BR.STEP = STEP;
  BR.HALL = HALL; BR.MAZE = MAZE; BR.PILLAR = PILLAR; BR.POOL = POOL; BR.RED = RED; BR.STAIR = STAIR;

  // Neighbour directions: 0 +x, 1 -x, 2 +z, 3 -z.
  var DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1], OPP = [1, 0, 3, 2];
  // Where the midpoint of each tile edge sits, in tile-local 0..1 coords.
  var EDGE = [[1, 0.5], [0, 0.5], [0.5, 1], [0.5, 0]];
  BR.DX = DX; BR.DZ = DZ;

  function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------------------------------------------------------------- queries
  BR.inBounds = function (tx, tz) { return tx >= 0 && tx < GW && tz >= 0 && tz < GH; };

  BR.isFloor = function (level, tx, tz) {
    if (!BR.inBounds(tx, tz)) return false;
    return level.floor[tz * GW + tx] === 1;
  };
  BR.isSolid = function (level, tx, tz) {
    if (!BR.inBounds(tx, tz)) return true;
    return level.floor[tz * GW + tx] !== 1;
  };
  BR.zoneAt = function (level, tx, tz) {
    if (!BR.inBounds(tx, tz)) return HALL;
    return level.zone[tz * GW + tx];
  };
  BR.isWaterTile = function (level, tx, tz) {
    if (!BR.inBounds(tx, tz)) return false;
    return level.water[tz * GW + tx] === 1;
  };
  BR.tileOf = function (x, z) {
    return { tx: Math.floor(x / TILE), tz: Math.floor(z / TILE) };
  };
  BR.tileCenter = function (tx, tz) {
    return { x: (tx + 0.5) * TILE, z: (tz + 0.5) * TILE };
  };
  BR.solidAtWorld = function (level, x, z) {
    return BR.isSolid(level, Math.floor(x / TILE), Math.floor(z / TILE));
  };
  BR.zoneAtWorld = function (level, x, z) {
    return BR.zoneAt(level, Math.floor(x / TILE), Math.floor(z / TILE));
  };
  BR.waterAtWorld = function (level, x, z) {
    return BR.isWaterTile(level, Math.floor(x / TILE), Math.floor(z / TILE));
  };

  // ------------------------------------------------------------ heights
  // Each floor tile has a terrace level (0..3). Stair tiles ramp up one level
  // in their direction (0 +x, 1 -x, 2 +z, 3 -z); -1 = not a stair.
  function tileHeightAt(level, tx, tz, fx, fz) {
    var i = tz * GW + tx;
    var base = level.height[i] * STEP;
    var s = level.stair[i];
    if (s < 0) return base;
    var t = s === 0 ? fx : s === 1 ? 1 - fx : s === 2 ? fz : 1 - fz;
    return base + Math.max(0, Math.min(1, t)) * STEP;
  }
  BR.groundAt = function (level, x, z) {
    var tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    if (!BR.isFloor(level, tx, tz)) return 0;
    return tileHeightAt(level, tx, tz, x / TILE - tx, z / TILE - tz);
  };
  BR.isStair = function (level, tx, tz) {
    return BR.inBounds(tx, tz) && level.stair[tz * GW + tx] >= 0;
  };
  // Can you walk from a tile to its neighbour in direction k? Both must be
  // floor and the shared edge must sit at the same height on either side -
  // which lets you climb a stair from its ends but never vault onto it from
  // the side, or step off a raised platform.
  BR.canStep = function (level, tx, tz, k) {
    var nx = tx + DX[k], nz = tz + DZ[k];
    if (!BR.isFloor(level, tx, tz) || !BR.isFloor(level, nx, nz)) return false;
    var ha = tileHeightAt(level, tx, tz, EDGE[k][0], EDGE[k][1]);
    var hb = tileHeightAt(level, nx, nz, EDGE[OPP[k]][0], EDGE[OPP[k]][1]);
    return Math.abs(ha - hb) < 0.35;
  };
  BR.edgeHeight = function (level, tx, tz, k) {
    return tileHeightAt(level, tx, tz, EDGE[k][0], EDGE[k][1]);
  };

  // A body is blocked when any corner of its bounding square lands in a solid
  // tile - cheap and exact enough for axis-aligned tile walls.
  // Height changes count too: a ledge or the side of a stair is a wall as
  // far as the feet are concerned.
  BR.blocked = function (level, x, z, r, fromX, fromZ) {
    if (BR.solidAtWorld(level, x - r, z - r) || BR.solidAtWorld(level, x + r, z - r) ||
        BR.solidAtWorld(level, x - r, z + r) || BR.solidAtWorld(level, x + r, z + r)) return true;
    var hc = BR.groundAt(level, x, z);
    if (fromX !== undefined && Math.abs(hc - BR.groundAt(level, fromX, fromZ)) > 0.5) return true;
    return Math.abs(BR.groundAt(level, x - r, z - r) - hc) > 0.5 ||
           Math.abs(BR.groundAt(level, x + r, z - r) - hc) > 0.5 ||
           Math.abs(BR.groundAt(level, x - r, z + r) - hc) > 0.5 ||
           Math.abs(BR.groundAt(level, x + r, z + r) - hc) > 0.5;
  };

  // Grid-marching ray (Amanatides & Woo). Walls are full-height columns, so a
  // 2D march on XZ answers both camera collision and line of sight exactly -
  // no mesh raycasting, no edge-grazing flicker.
  BR.rayDistance = function (level, ox, oz, dx, dz, maxDist) {
    var len = Math.hypot(dx, dz);
    if (len < 1e-6) return maxDist;
    dx /= len; dz /= len;

    var tx = Math.floor(ox / TILE), tz = Math.floor(oz / TILE);
    if (BR.isSolid(level, tx, tz)) return 0;

    var stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    var tMaxX = dx !== 0 ? Math.abs(((dx > 0 ? (tx + 1) : tx) * TILE - ox) / dx) : Infinity;
    var tMaxZ = dz !== 0 ? Math.abs(((dz > 0 ? (tz + 1) : tz) * TILE - oz) / dz) : Infinity;
    var tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    var tDeltaZ = dz !== 0 ? Math.abs(TILE / dz) : Infinity;

    var t = 0, guard = 0;
    while (t < maxDist && guard++ < 512) {
      if (tMaxX < tMaxZ) { tx += stepX; t = tMaxX; tMaxX += tDeltaX; }
      else { tz += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; }
      if (t > maxDist) break;
      if (BR.isSolid(level, tx, tz)) return t;
    }
    return maxDist;
  };

  BR.hasLineOfSight = function (level, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az;
    var dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    return BR.rayDistance(level, ax, az, dx, dz, dist) >= dist - 0.001;
  };

  // ------------------------------------------------------------- pathfinding
  // Distance field flooded out from one tile. Entities walk it downhill, so a
  // single field per tick serves every hunter at once.
  BR.flowField = function (level, tx, tz) {
    var dist = new Int32Array(GW * GH).fill(-1);
    if (!BR.isFloor(level, tx, tz)) return dist;
    var queue = new Int32Array(GW * GH);
    var head = 0, tail = 0;
    dist[tz * GW + tx] = 0;
    queue[tail++] = tz * GW + tx;
    while (head < tail) {
      var cur = queue[head++];
      var cx = cur % GW, cz = (cur - cx) / GW;
      var d = dist[cur] + 1;
      for (var k = 0; k < 4; k++) {
        if (!BR.canStep(level, cx, cz, k)) continue;
        var nx = cx + DX[k], nz = cz + DZ[k];
        var ni = nz * GW + nx;
        if (dist[ni] !== -1) continue;
        dist[ni] = d;
        queue[tail++] = ni;
      }
    }
    return dist;
  };

  // Next tile to step to when descending a flow field.
  BR.flowStep = function (level, field, tx, tz) {
    var here = field[tz * GW + tx];
    if (here === undefined || here < 0) return null;
    var best = null, bestD = here;
    for (var k = 0; k < 4; k++) {
      if (!BR.canStep(level, tx, tz, k)) continue;
      var nx = tx + DX[k], nz = tz + DZ[k];
      var d = field[nz * GW + nx];
      if (d >= 0 && d < bestD) { bestD = d; best = { tx: nx, tz: nz }; }
    }
    return best;
  };

  // ------------------------------------------------------------- generation
  BR.generateLevel = function () {
    var floor = new Uint8Array(GW * GH);
    var zone = new Uint8Array(GW * GH);
    var water = new Uint8Array(GW * GH);
    var height = new Uint8Array(GW * GH);
    var stair = new Int8Array(GW * GH).fill(-1);
    var crate = new Uint8Array(GW * GH);
    var rooms = [];

    function fill(x0, z0, w, h, zoneIdx) {
      for (var z = z0; z < z0 + h; z++) {
        for (var x = x0; x < x0 + w; x++) {
          floor[z * GW + x] = 1;
          zone[z * GW + x] = zoneIdx;
        }
      }
    }
    function areaFree(x0, z0, w, h, pad) {
      if (x0 - pad < 1 || z0 - pad < 1 || x0 + w + pad > GW - 1 || z0 + h + pad > GH - 1) return false;
      for (var z = z0 - pad; z < z0 + h + pad; z++) {
        for (var x = x0 - pad; x < x0 + w + pad; x++) {
          if (floor[z * GW + x]) return false;
        }
      }
      return true;
    }

    // Biggest footprints first - the small halls can always slot into leftovers,
    // but a pillar hall that loses the draw simply never appears.
    var plan = [
      { zoneIdx: STAIR,  count: 2, w: [13, 16], h: [12, 15] },
      { zoneIdx: PILLAR, count: 2, w: [12, 16], h: [11, 15] },
      { zoneIdx: MAZE,   count: 3, w: [10, 14], h: [10, 14] },
      { zoneIdx: POOL,   count: 2, w: [10, 13], h: [9, 12] },
      { zoneIdx: RED,    count: 2, w: [8, 11], h: [7, 10] },
      { zoneIdx: HALL,   count: 6, w: [7, 12], h: [6, 10] }
    ];

    plan.forEach(function (spec) {
      for (var n = 0; n < spec.count; n++) {
        for (var attempt = 0; attempt < 900; attempt++) {
          var w = ri(spec.w[0], spec.w[1]);
          var h = ri(spec.h[0], spec.h[1]);
          var x0 = ri(2, GW - w - 3);
          var z0 = ri(2, GH - h - 3);
          if (!areaFree(x0, z0, w, h, 2)) continue;
          fill(x0, z0, w, h, spec.zoneIdx);
          rooms.push({
            zoneIdx: spec.zoneIdx, x0: x0, z0: z0, w: w, h: h,
            cx: x0 + (w >> 1), cz: z0 + (h >> 1)
          });
          break;
        }
      }
    });

    // Pillar grids, maze clutter and pool basins give each zone its silhouette.
    rooms.forEach(function (room) {
      var x, z;
      if (room.zoneIdx === PILLAR) {
        for (z = room.z0 + 1; z < room.z0 + room.h - 1; z++) {
          for (x = room.x0 + 1; x < room.x0 + room.w - 1; x++) {
            if ((x - room.x0) % 3 === 1 && (z - room.z0) % 3 === 1) floor[z * GW + x] = 0;
          }
        }
      } else if (room.zoneIdx === MAZE) {
        var chunks = Math.floor((room.w * room.h) / 7);
        for (var c = 0; c < chunks; c++) {
          var len = ri(2, 5);
          var horiz = Math.random() < 0.5;
          var sx = ri(room.x0 + 1, room.x0 + room.w - 2);
          var sz = ri(room.z0 + 1, room.z0 + room.h - 2);
          for (var s = 0; s < len; s++) {
            var wx = horiz ? sx + s : sx;
            var wz = horiz ? sz : sz + s;
            if (wx > room.x0 && wx < room.x0 + room.w - 1 && wz > room.z0 && wz < room.z0 + room.h - 1) {
              floor[wz * GW + wx] = 0;
            }
          }
        }
      } else if (room.zoneIdx === POOL) {
        room.pool = { x0: room.x0 + 2, z0: room.z0 + 2, w: room.w - 4, h: room.h - 4 };
        for (z = room.pool.z0; z < room.pool.z0 + room.pool.h; z++) {
          for (x = room.pool.x0; x < room.pool.x0 + room.pool.w; x++) {
            if (floor[z * GW + x]) water[z * GW + x] = 1;
          }
        }
      }
    });

    // Corridors: chain every room to its nearest already-linked neighbour, then
    // add a few extra links so the map has loops to escape around.
    // Mixed corridor widths: a few broad halls, mostly single-tile squeezes.
    function carveCorridor(ax, az, bx, bz) {
      var x = ax, z = az;
      var horizFirst = Math.random() < 0.5;
      var wide = Math.random() < 0.35;
      function put(px, pz) {
        if (px < 1 || pz < 1 || px > GW - 2 || pz > GH - 2) return;
        var i = pz * GW + px;
        if (!floor[i]) { floor[i] = 1; zone[i] = HALL; height[i] = 0; }
      }
      function putH(px, pz) { put(px, pz); if (wide) put(px, pz + 1); }
      function putV(px, pz) { put(px, pz); if (wide) put(px + 1, pz); }
      if (horizFirst) {
        for (; x !== bx; x += (bx > x ? 1 : -1)) putH(x, z);
        for (; z !== bz; z += (bz > z ? 1 : -1)) putV(x, z);
      } else {
        for (; z !== bz; z += (bz > z ? 1 : -1)) putV(x, z);
        for (; x !== bx; x += (bx > x ? 1 : -1)) putH(x, z);
      }
      put(bx, bz);
    }

    // Safety net: rejection sampling can starve on an unlucky seed.
    if (!rooms.length) {
      fill(4, 4, 14, 12, HALL);
      rooms.push({ zoneIdx: HALL, x0: 4, z0: 4, w: 14, h: 12, cx: 11, cz: 10 });
    }

    if (rooms.length > 1) {
      var linked = [rooms[0]];
      var pending = rooms.slice(1);
      while (pending.length) {
        var bestI = 0, bestJ = 0, bestD = Infinity;
        for (var i = 0; i < linked.length; i++) {
          for (var j = 0; j < pending.length; j++) {
            var d = Math.abs(linked[i].cx - pending[j].cx) + Math.abs(linked[i].cz - pending[j].cz);
            if (d < bestD) { bestD = d; bestI = i; bestJ = j; }
          }
        }
        carveCorridor(linked[bestI].cx, linked[bestI].cz, pending[bestJ].cx, pending[bestJ].cz);
        linked.push(pending[bestJ]);
        pending.splice(bestJ, 1);
      }
      for (var extra = 0; extra < 5; extra++) {
        var a = rooms[Math.floor(Math.random() * rooms.length)];
        var b = rooms[Math.floor(Math.random() * rooms.length)];
        if (a !== b) carveCorridor(a.cx, a.cz, b.cx, b.cz);
      }
    }

    // Terraces: nested raised platforms, each reached by only one or two
    // stairs, so a book on the top tier means finding the way up.
    function terraceRoom(room, maxLv) {
      var rect = { x0: room.x0, z0: room.z0, w: room.w, h: room.h };
      room.tiers = [];
      function makeFloor(x, z, lv) {
        var i = z * GW + x;
        floor[i] = 1; zone[i] = room.zoneIdx; height[i] = lv; water[i] = 0;
      }
      for (var lv = 1; lv <= maxLv; lv++) {
        var aw = rect.w - 4, ah = rect.h - 4;
        if (aw < 3 || ah < 3) break;
        var pw = ri(Math.max(3, Math.ceil(aw * 0.6)), aw);
        var ph = ri(Math.max(3, Math.ceil(ah * 0.6)), ah);
        var px0 = ri(rect.x0 + 2, rect.x0 + 2 + aw - pw);
        var pz0 = ri(rect.z0 + 2, rect.z0 + 2 + ah - ph);
        for (var z = pz0; z < pz0 + ph; z++) {
          for (var x = px0; x < px0 + pw; x++) height[z * GW + x] = lv;
        }
        var nStairs = (lv === 1 && Math.random() < 0.5) ? 2 : 1;
        var sides = shuffle([0, 1, 2, 3]);
        for (var s = 0; s < nStairs; s++) {
          var side = sides[s], sx, sz, ax, az, tx2, tz2;
          if (side === 0) { sz = ri(pz0, pz0 + ph - 1); sx = px0 - 1; ax = sx - 1; az = sz; tx2 = px0; tz2 = sz; }
          else if (side === 1) { sz = ri(pz0, pz0 + ph - 1); sx = px0 + pw; ax = sx + 1; az = sz; tx2 = px0 + pw - 1; tz2 = sz; }
          else if (side === 2) { sx = ri(px0, px0 + pw - 1); sz = pz0 - 1; ax = sx; az = sz - 1; tx2 = sx; tz2 = pz0; }
          else { sx = ri(px0, px0 + pw - 1); sz = pz0 + ph; ax = sx; az = sz + 1; tx2 = sx; tz2 = pz0 + ph - 1; }
          makeFloor(sx, sz, lv - 1);
          stair[sz * GW + sx] = side;      // side index doubles as rise direction
          makeFloor(ax, az, lv - 1);
          makeFloor(tx2, tz2, lv);
        }
        room.tiers.push({ lv: lv, x0: px0, z0: pz0, w: pw, h: ph });
        rect = { x0: px0, z0: pz0, w: pw, h: ph };
      }
    }
    rooms.forEach(function (room) {
      if (room.zoneIdx === STAIR) terraceRoom(room, 3);
      else if (room.zoneIdx === PILLAR) terraceRoom(room, 2);
    });

    var level = { floor: floor, zone: zone, water: water, rooms: rooms,
                  height: height, stair: stair, crate: crate };

    // Spawn in a hall room, then keep only what is actually reachable from it.
    var hallRooms = rooms.filter(function (room) { return room.zoneIdx === HALL; });
    var spawnRoom = hallRooms.length ? hallRooms[Math.floor(Math.random() * hallRooms.length)] : rooms[0];
    var spawnTile = { tx: spawnRoom.cx, tz: spawnRoom.cz };
    var reachField = BR.flowField(level, spawnTile.tx, spawnTile.tz);

    // Crates: hiding spots pushed up against room walls. Each one is a solid
    // tile, so it is only kept if it does not cut anything off.
    function countReach(field) {
      var n = 0;
      for (var q = 0; q < field.length; q++) if (field[q] >= 0) n++;
      return n;
    }
    var roomOf = new Int16Array(GW * GH).fill(-1);
    rooms.forEach(function (room, ri2) {
      for (var z = room.z0; z < room.z0 + room.h; z++) {
        for (var x = room.x0; x < room.x0 + room.w; x++) roomOf[z * GW + x] = ri2;
      }
    });
    var crateCands = [];
    for (var ci = 0; ci < GW * GH; ci++) {
      if (reachField[ci] < 0 || roomOf[ci] < 0 || height[ci] || stair[ci] >= 0 || water[ci]) continue;
      var cx0 = ci % GW, cz0 = (ci - cx0) / GW;
      if (Math.abs(cx0 - spawnTile.tx) + Math.abs(cz0 - spawnTile.tz) < 4) continue;
      var touchesWall = false, nearStair = false;
      for (var ck = 0; ck < 4; ck++) {
        var ni2 = (cz0 + DZ[ck]) * GW + cx0 + DX[ck];
        if (!floor[ni2]) touchesWall = true;
        if (stair[ni2] >= 0 || height[ni2]) nearStair = true;
      }
      if (touchesWall && !nearStair) crateCands.push({ tx: cx0, tz: cz0 });
    }
    shuffle(crateCands);
    var crates = [];
    var reachCount = countReach(reachField);
    for (var cc = 0; cc < crateCands.length && crates.length < CRATE_COUNT; cc++) {
      var cand = crateCands[cc];
      var spaced = crates.every(function (o) {
        return Math.abs(o.tx - cand.tx) + Math.abs(o.tz - cand.tz) >= 6;
      });
      if (!spaced) continue;
      var cidx = cand.tz * GW + cand.tx;
      floor[cidx] = 0;
      var test = countReach(BR.flowField(level, spawnTile.tx, spawnTile.tz));
      if (test === reachCount - 1) {
        crate[cidx] = 1;
        reachCount = test;
        var wc = BR.tileCenter(cand.tx, cand.tz);
        crates.push({ tx: cand.tx, tz: cand.tz, x: wc.x, z: wc.z });
      } else {
        floor[cidx] = 1;
      }
    }
    reachField = BR.flowField(level, spawnTile.tx, spawnTile.tz);

    var reachable = [];
    for (var ti = 0; ti < GW * GH; ti++) {
      if (reachField[ti] >= 0) {
        reachable.push({ tx: ti % GW, tz: (ti - (ti % GW)) / GW, d: reachField[ti] });
      }
    }

    function roomReachableTiles(room) {
      var out = [];
      for (var z = room.z0; z < room.z0 + room.h; z++) {
        for (var x = room.x0; x < room.x0 + room.w; x++) {
          if (reachField[z * GW + x] >= 0) out.push({ tx: x, tz: z });
        }
      }
      return out;
    }

    var reachableRooms = rooms.filter(function (room) {
      return roomReachableTiles(room).length > 4;
    });

    // Exit: a random wall spot in a random room that is at least moderately
    // far from spawn - so it moves every run and has to be searched for.
    function roomDist(room) {
      var best = -1;
      roomReachableTiles(room).forEach(function (t) {
        var d = reachField[t.tz * GW + t.tx];
        if (d > best) best = d;
      });
      return best;
    }
    var exitDist = 0;
    reachableRooms.forEach(function (room) { exitDist = Math.max(exitDist, roomDist(room)); });
    var exitPool = reachableRooms.filter(function (room) {
      return room !== spawnRoom && roomDist(room) >= exitDist * 0.5;
    });
    if (!exitPool.length) exitPool = reachableRooms.filter(function (room) { return room !== spawnRoom; });
    if (!exitPool.length) exitPool = [spawnRoom];
    var exitRoom = exitPool[Math.floor(Math.random() * exitPool.length)];

    // Prefer a ground tile backed by a wall so the door sits flush against it.
    var exitTile = null, exitDir = 2;
    var exitCands = [];
    roomReachableTiles(exitRoom).forEach(function (t) {
      var i = t.tz * GW + t.tx;
      if (height[i] || stair[i] >= 0 || water[i]) return;
      var k, nx, nz;
      for (k = 0; k < 4; k++) {
        nx = t.tx + DX[k]; nz = t.tz + DZ[k];
        if (BR.isStair(level, nx, nz) || BR.inBounds(nx, nz) && height[nz * GW + nx]) return;
      }
      for (k = 0; k < 4; k++) {
        nx = t.tx + DX[k]; nz = t.tz + DZ[k];
        if (BR.inBounds(nx, nz) && !floor[nz * GW + nx] && !crate[nz * GW + nx]) {
          exitCands.push({ tx: t.tx, tz: t.tz, dir: k });
          break;
        }
      }
    });
    if (exitCands.length) {
      var pick = exitCands[Math.floor(Math.random() * exitCands.length)];
      exitTile = { tx: pick.tx, tz: pick.tz };
      exitDir = pick.dir;
    } else {
      var exitTiles = roomReachableTiles(exitRoom);
      exitTile = exitTiles[Math.floor(Math.random() * exitTiles.length)] || spawnTile;
    }

    var bookRooms = shuffle(reachableRooms.filter(function (room) {
      return room !== exitRoom && room !== spawnRoom;
    }));
    var bookTiles = [];
    for (var b = 0; b < bookRooms.length && bookTiles.length < 8; b++) {
      var tiles = roomReachableTiles(bookRooms[b]).filter(function (t) {
        return !BR.isWaterTile(level, t.tx, t.tz) && !BR.isStair(level, t.tx, t.tz) &&
               Math.abs(t.tx - exitTile.tx) + Math.abs(t.tz - exitTile.tz) > 4;
      });
      // Terraced rooms usually hide their book on the highest tier.
      var top = 0;
      tiles.forEach(function (t) { top = Math.max(top, height[t.tz * GW + t.tx]); });
      if (top > 0 && Math.random() < 0.75) {
        tiles = tiles.filter(function (t) { return height[t.tz * GW + t.tx] === top; });
      }
      if (tiles.length) bookTiles.push(tiles[Math.floor(Math.random() * tiles.length)]);
    }

    // Entities start far away so the first minute is exploration, not ambush.
    var farTiles = reachable.filter(function (t) { return t.d > exitDist * 0.45; });
    shuffle(farTiles);
    var hunterSpawns = farTiles.slice(0, 3);
    if (hunterSpawns.length < 3) hunterSpawns = reachable.slice(-3);

    // Ceiling fixtures, spaced per zone so the maze and red zone stay gloomy.
    var fixtures = [];
    for (var fz = 0; fz < GH; fz++) {
      for (var fx = 0; fx < GW; fx++) {
        if (reachField[fz * GW + fx] < 0) continue;
        var zi = zone[fz * GW + fx];
        var spec = ZONES[zi];
        if (fx % spec.lightStep !== 1 || fz % spec.lightStep !== 1) continue;
        var c = BR.tileCenter(fx, fz);
        fixtures.push({
          x: c.x, z: c.z, zoneIdx: zi, y: spec.height - 0.12,
          color: spec.lightColor, intensity: spec.lightIntensity, flicker: spec.flicker
        });
      }
    }

    // Floor arrows pointing along the route to the exit - the only navigation
    // aid left now that the minimap is gone.
    var exitField = BR.flowField(level, exitTile.tx, exitTile.tz);
    var arrows = [];
    var corridorTiles = reachable.filter(function (t) {
      return zone[t.tz * GW + t.tx] === HALL && exitField[t.tz * GW + t.tx] > 6;
    });
    shuffle(corridorTiles);
    for (var ai = 0; ai < corridorTiles.length && arrows.length < 22; ai++) {
      var t = corridorTiles[ai];
      var next = BR.flowStep(level, exitField, t.tx, t.tz);
      if (!next) continue;
      var tooClose = arrows.some(function (a) {
        return Math.abs(a.tx - t.tx) + Math.abs(a.tz - t.tz) < 7;
      });
      if (tooClose) continue;
      arrows.push({
        tx: t.tx, tz: t.tz,
        angle: Math.atan2(next.tx - t.tx, next.tz - t.tz)
      });
    }

    level.spawnTile = spawnTile;
    level.exitTile = exitTile;
    level.exitDir = exitDir;
    level.crates = crates;
    level.exitRoom = exitRoom;
    level.bookTiles = bookTiles;
    level.hunterSpawns = hunterSpawns;
    level.fixtures = fixtures;
    level.arrows = arrows;
    level.reachField = reachField;
    level.reachable = reachable;
    return level;
  };

  // ---------------------------------------------------------------- textures
  function makeCanvas(size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }

  function buildTexture(spec, size) {
    size = size || 128;
    var c = makeCanvas(size);
    var ctx = c.getContext('2d');
    ctx.fillStyle = spec.base;
    ctx.fillRect(0, 0, size, size);

    var i, x, y;
    if (spec.mode === 'stripe') {
      for (i = 0; i < 46; i++) {
        ctx.strokeStyle = 'rgba(60,44,18,' + (0.05 + Math.random() * 0.1) + ')';
        ctx.lineWidth = 1 + Math.random() * 2;
        x = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (Math.random() * 8 - 4), size);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,28,10,0.16)';
      ctx.fillRect(0, size * 0.78, size, size * 0.06);
    } else if (spec.mode === 'carpet') {
      for (i = 0; i < size * size * 0.35; i++) {
        ctx.fillStyle = 'rgba(40,30,12,' + (Math.random() * 0.14) + ')';
        ctx.fillRect(Math.random() * size, Math.random() * size, 1.6, 1.6);
      }
      for (i = 0; i < 7; i++) {
        ctx.fillStyle = 'rgba(30,22,8,0.10)';
        ctx.beginPath();
        ctx.ellipse(Math.random() * size, Math.random() * size,
          8 + Math.random() * 22, 6 + Math.random() * 16, Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (spec.mode === 'tile') {
      var cells = 4, step = size / cells;
      ctx.strokeStyle = 'rgba(120,150,145,0.55)';
      ctx.lineWidth = 2;
      for (i = 0; i <= cells; i++) {
        ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke();
      }
      for (i = 0; i < 40; i++) {
        ctx.fillStyle = 'rgba(150,175,170,' + (Math.random() * 0.14) + ')';
        ctx.fillRect(Math.random() * size, Math.random() * size, step * 0.9, step * 0.9);
      }
    } else if (spec.mode === 'concrete') {
      for (i = 0; i < size * size * 0.25; i++) {
        ctx.fillStyle = 'rgba(50,46,34,' + (Math.random() * 0.12) + ')';
        ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
      }
      for (i = 0; i < 10; i++) {
        ctx.strokeStyle = 'rgba(45,40,30,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.random() * size, Math.random() * size);
        ctx.lineTo(Math.random() * size, Math.random() * size);
        ctx.stroke();
      }
    } else if (spec.mode === 'panel') {
      ctx.strokeStyle = 'rgba(70,55,25,0.4)';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
      ctx.fillStyle = 'rgba(70,55,25,0.08)';
      ctx.fillRect(size * 0.1, size * 0.1, size * 0.8, size * 0.8);
    }

    if (spec.grain) {
      for (i = 0; i < size * size * spec.grain; i++) {
        ctx.fillStyle = 'rgba(20,16,8,' + (Math.random() * 0.10) + ')';
        ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
      }
    }

    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // ------------------------------------------------------------- mesh build
  BR.buildLevelMeshes = function (level) {
    var group = new THREE.Group();
    var wallTiles = [], floorTiles = [], ceilTiles = [];
    var zi, i;

    for (zi = 0; zi < ZONES.length; zi++) {
      wallTiles.push([]); floorTiles.push([]); ceilTiles.push([]);
    }

    var raisedTiles = [], stairTiles = [];
    for (zi = 0; zi < ZONES.length; zi++) raisedTiles.push([]);

    for (var tz = 0; tz < GH; tz++) {
      for (var tx = 0; tx < GW; tx++) {
        var solid = BR.isSolid(level, tx, tz);
        var ti = tz * GW + tx;
        if (!solid || level.crate[ti]) {
          var z0 = BR.zoneAt(level, tx, tz);
          ceilTiles[z0].push({ tx: tx, tz: tz });
          if (level.stair[ti] >= 0) stairTiles.push({ tx: tx, tz: tz, dir: level.stair[ti], lv: level.height[ti], zoneIdx: z0 });
          else if (!solid && level.height[ti] > 0) raisedTiles[z0].push({ tx: tx, tz: tz, lv: level.height[ti] });
          else floorTiles[z0].push({ tx: tx, tz: tz });
          continue;
        }
        // Solid tiles only get geometry when they actually face open space.
        var facing = -1;
        for (var dz = -1; dz <= 1 && facing < 0; dz++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            if (BR.isFloor(level, tx + dx, tz + dz)) { facing = BR.zoneAt(level, tx + dx, tz + dz); break; }
          }
        }
        if (facing >= 0) wallTiles[facing].push({ tx: tx, tz: tz });
      }
    }

    var dummy = new THREE.Object3D();
    var unitBox = new THREE.BoxGeometry(1, 1, 1);
    var floorGeo = new THREE.PlaneGeometry(TILE, TILE);
    floorGeo.rotateX(-Math.PI / 2);
    var ceilGeo = new THREE.PlaneGeometry(TILE, TILE);
    ceilGeo.rotateX(Math.PI / 2);

    function addInstanced(geo, mat, tiles, place) {
      if (!tiles.length) return null;
      var mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
      for (var n = 0; n < tiles.length; n++) {
        var c = BR.tileCenter(tiles[n].tx, tiles[n].tz);
        place(dummy, c, tiles[n]);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    }

    for (zi = 0; zi < ZONES.length; zi++) {
      var spec = ZONES[zi];
      var wallMat = new THREE.MeshStandardMaterial({ map: buildTexture(spec.wall), roughness: 0.95 });
      var floorMat = new THREE.MeshStandardMaterial({ map: buildTexture(spec.floor), roughness: 1 });
      var ceilMat = new THREE.MeshStandardMaterial({ map: buildTexture(spec.ceil), roughness: 1 });
      var wallGeo = new THREE.BoxGeometry(TILE, spec.height, TILE);

      addInstanced(wallGeo, wallMat, wallTiles[zi], function (d, c) {
        d.position.set(c.x, this.h / 2, c.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 1, 1);
      }.bind({ h: spec.height }));

      addInstanced(floorGeo, floorMat, floorTiles[zi], function (d, c) {
        d.position.set(c.x, 0, c.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 1, 1);
      });

      addInstanced(ceilGeo, ceilMat, ceilTiles[zi], function (d, c) {
        d.position.set(c.x, this.h, c.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 1, 1);
      }.bind({ h: spec.height }));

      // Raised platforms: a solid block per tile with the floor laid on top.
      if (raisedTiles[zi].length) {
        var sideMat = new THREE.MeshStandardMaterial({ map: buildTexture(spec.wall), color: 0xb8b0a0, roughness: 0.95 });
        addInstanced(unitBox, sideMat, raisedTiles[zi], function (d, c, t) {
          var hh = t.lv * STEP;
          d.position.set(c.x, hh / 2, c.z);
          d.rotation.set(0, 0, 0);
          d.scale.set(TILE, hh, TILE);
        });
        addInstanced(floorGeo, floorMat, raisedTiles[zi], function (d, c, t) {
          d.position.set(c.x, t.lv * STEP + 0.004, c.z);
          d.rotation.set(0, 0, 0);
          d.scale.set(1, 1, 1);
        });
      }
    }

    // Stairs: six real steps with bright nosings so they read from afar.
    var STEPS = 6;
    var stepMat = new THREE.MeshStandardMaterial({ color: 0x9a927c, roughness: 0.9 });
    var nosingMat = new THREE.MeshStandardMaterial({ color: 0xd9b23a, emissive: 0x5a4208, emissiveIntensity: 0.5, roughness: 0.6 });
    stairTiles.forEach(function (st) {
      var c = BR.tileCenter(st.tx, st.tz);
      var g = new THREE.Group();
      var base = st.lv * STEP;
      if (base > 0) {
        var bm = new THREE.Mesh(unitBox, stepMat);
        bm.scale.set(TILE, base, TILE);
        bm.position.set(0, base / 2, 0);
        g.add(bm);
      }
      var depth = TILE / STEPS;
      for (var n = 0; n < STEPS; n++) {
        var hh = (n + 1) * STEP / STEPS;
        // Built rising along +x, then the whole group is turned to face dir.
        var sm = new THREE.Mesh(unitBox, stepMat);
        sm.scale.set(depth, hh, TILE);
        sm.position.set(-TILE / 2 + depth * (n + 0.5), base + hh / 2, 0);
        g.add(sm);
        var nm = new THREE.Mesh(unitBox, nosingMat);
        nm.scale.set(0.12, 0.03, TILE * 0.98);
        nm.position.set(-TILE / 2 + depth * n + 0.07, base + hh + 0.012, 0);
        g.add(nm);
      }
      g.rotation.y = [0, Math.PI, -Math.PI / 2, Math.PI / 2][st.dir];
      g.position.set(c.x, 0, c.z);
      group.add(g);
    });

    // Railings wherever a walkable edge drops to lower floor.
    var railBars = [], railPosts = [];
    for (var rz = 0; rz < GH; rz++) {
      for (var rx = 0; rx < GW; rx++) {
        var ri0 = rz * GW + rx;
        if (!level.floor[ri0] || level.stair[ri0] >= 0) continue;
        var myH = level.height[ri0] * STEP;
        if (!myH) continue;
        for (var k = 0; k < 4; k++) {
          var nx = rx + DX[k], nz = rz + DZ[k];
          if (!BR.isFloor(level, nx, nz) || BR.canStep(level, rx, rz, k)) continue;
          if (BR.edgeHeight(level, nx, nz, OPP[k]) > myH - 0.3) continue;
          var cc = BR.tileCenter(rx, rz);
          var ex = cc.x + DX[k] * (TILE / 2 - 0.06), ez = cc.z + DZ[k] * (TILE / 2 - 0.06);
          var along = k < 2;   // edge runs along z when facing +-x
          railBars.push({ x: ex, z: ez, y: myH + 1.0, along: along });
          railBars.push({ x: ex, z: ez, y: myH + 0.55, along: along });
          railPosts.push({ x: ex + (along ? 0 : TILE / 2 - 0.05), z: ez + (along ? TILE / 2 - 0.05 : 0), y: myH + 0.5 });
          railPosts.push({ x: ex - (along ? 0 : TILE / 2 - 0.05), z: ez - (along ? TILE / 2 - 0.05 : 0), y: myH + 0.5 });
        }
      }
    }
    var railMat = new THREE.MeshStandardMaterial({ color: 0xc9b46a, metalness: 0.5, roughness: 0.45, emissive: 0x2a2208 });
    function addRail(list, sx, sy, sz, rotate) {
      if (!list.length) return;
      var mesh = new THREE.InstancedMesh(unitBox, railMat, list.length);
      for (var n = 0; n < list.length; n++) {
        var it = list[n];
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(0, rotate && it.along ? Math.PI / 2 : 0, 0);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    addRail(railBars, TILE, 0.07, 0.07, true);
    addRail(railPosts, 0.08, 1.0, 0.08, false);

    // Wooden crates - the hiding spots.
    var crateTex = (function () {
      var c = makeCanvas(128), ctx = c.getContext('2d');
      ctx.fillStyle = '#8a6334'; ctx.fillRect(0, 0, 128, 128);
      for (var i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#7d592d' : '#94703c';
        ctx.fillRect(0, i * 21 + 2, 128, 19);
      }
      ctx.strokeStyle = '#4a3216'; ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, 118, 118);
      ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(120, 120); ctx.stroke();
      var t = new THREE.CanvasTexture(c);
      return t;
    })();
    var crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85 });
    level.crates.forEach(function (cr) {
      var m = new THREE.Mesh(unitBox, crateMat);
      m.scale.set(TILE * 0.88, 1.85, TILE * 0.88);
      m.position.set(cr.x, 0.925, cr.z);
      group.add(m);
    });

    // Emissive light panels so distant fixtures still read as lights even
    // though only a handful of real PointLights follow the player around.
    var panelGeo = new THREE.BoxGeometry(TILE * 0.55, 0.08, TILE * 0.55);
    var panelsByZone = {};
    level.fixtures.forEach(function (f) {
      (panelsByZone[f.zoneIdx] = panelsByZone[f.zoneIdx] || []).push(f);
    });
    Object.keys(panelsByZone).forEach(function (key) {
      var list = panelsByZone[key];
      var spec2 = ZONES[key];
      var mat = new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: spec2.lightColor, emissiveIntensity: 1.1, roughness: 0.4
      });
      var mesh = new THREE.InstancedMesh(panelGeo, mat, list.length);
      for (var n = 0; n < list.length; n++) {
        dummy.position.set(list[n].x, spec2.height - 0.06, list[n].z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    });

    // Pool water: a translucent sheet just above the tiles, scrolled slowly.
    var waterMeshes = [];
    level.rooms.forEach(function (room) {
      if (room.zoneIdx !== POOL || !room.pool) return;
      var wTex = buildTexture({ base: '#2f8f7d', grain: 0.05, mode: 'tile' });
      wTex.repeat.set(room.pool.w, room.pool.h);
      var mat = new THREE.MeshStandardMaterial({
        map: wTex, color: 0x66d8c0, transparent: true, opacity: 0.72,
        roughness: 0.15, metalness: 0.25
      });
      var geo = new THREE.PlaneGeometry(room.pool.w * TILE, room.pool.h * TILE);
      geo.rotateX(-Math.PI / 2);
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (room.pool.x0 + room.pool.w / 2) * TILE, 0.34,
        (room.pool.z0 + room.pool.h / 2) * TILE
      );
      group.add(mesh);
      waterMeshes.push({ mesh: mesh, tex: wTex });
    });

    // Arched openings along pool room walls, echoing the poolrooms reference.
    var archShape = new THREE.Shape();
    archShape.moveTo(-1.05, 0);
    archShape.lineTo(-1.05, 1.5);
    archShape.absarc(0, 1.5, 1.05, Math.PI, 0, true);
    archShape.lineTo(1.05, 0);
    archShape.lineTo(0.78, 0);
    archShape.lineTo(0.78, 1.5);
    archShape.absarc(0, 1.5, 0.78, 0, Math.PI, false);
    archShape.lineTo(-0.78, 0);
    archShape.lineTo(-1.05, 0);
    var archGeo = new THREE.ExtrudeGeometry(archShape, { depth: 0.25, bevelEnabled: false });
    var archMat = new THREE.MeshStandardMaterial({ color: 0xe8efe9, roughness: 0.8 });
    // The opening behind each frame glows, so the arcade reads as daylight
    // leaking in from somewhere it has no business leaking in from.
    var archGlowShape = new THREE.Shape();
    archGlowShape.moveTo(-0.78, 0);
    archGlowShape.lineTo(-0.78, 1.5);
    archGlowShape.absarc(0, 1.5, 0.78, Math.PI, 0, true);
    archGlowShape.lineTo(0.78, 0);
    archGlowShape.lineTo(-0.78, 0);
    var archGlowGeo = new THREE.ShapeGeometry(archGlowShape);
    // fog:false keeps these readable from across the room - they double as
    // landmarks now that there is no map.
    var archGlowMat = new THREE.MeshBasicMaterial({ color: 0xdff6ef, fog: false });

    level.rooms.forEach(function (room) {
      if (room.zoneIdx !== POOL) return;
      [
        { z: room.z0, flip: 0 },
        { z: room.z0 + room.h - 1, flip: Math.PI }
      ].forEach(function (side) {
        for (var ax = room.x0 + 1; ax < room.x0 + room.w - 1; ax += 3) {
          var c = BR.tileCenter(ax, side.z);
          var push = side.flip ? TILE * 0.35 : -TILE * 0.35;
          var arch = new THREE.Mesh(archGeo, archMat);
          arch.position.set(c.x, 0, c.z + push);
          arch.rotation.y = side.flip;
          arch.scale.set(1.3, 1.45, 1);
          group.add(arch);

          var glow = new THREE.Mesh(archGlowGeo, archGlowMat);
          glow.position.set(c.x, 0, c.z + push * 1.12);
          glow.rotation.y = side.flip;
          glow.scale.set(1.3, 1.45, 1);
          group.add(glow);
        }
      });
    });

    // Exit-route arrows on the floor.
    var arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.55);
    arrowShape.lineTo(0.42, -0.1);
    arrowShape.lineTo(0.16, -0.1);
    arrowShape.lineTo(0.16, -0.55);
    arrowShape.lineTo(-0.16, -0.55);
    arrowShape.lineTo(-0.16, -0.1);
    arrowShape.lineTo(-0.42, -0.1);
    arrowShape.lineTo(0, 0.55);
    var arrowGeo = new THREE.ShapeGeometry(arrowShape);
    arrowGeo.rotateX(-Math.PI / 2);
    var arrowMat = new THREE.MeshStandardMaterial({
      color: 0x203018, emissive: 0x5fe07a, emissiveIntensity: 0.9,
      transparent: true, opacity: 0.75
    });
    level.arrows.forEach(function (a) {
      var c = BR.tileCenter(a.tx, a.tz);
      var mesh = new THREE.Mesh(arrowGeo, arrowMat);
      mesh.position.set(c.x, 0.03, c.z);
      mesh.rotation.y = a.angle;
      group.add(mesh);
    });

    return { group: group, waterMeshes: waterMeshes };
  };

})(window.BR);
