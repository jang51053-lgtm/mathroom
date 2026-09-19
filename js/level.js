/* Tile-based backrooms level: zoned rooms joined by narrow corridors.
   Everything downstream (collision, line of sight, pathing) reads the tile
   grid directly rather than the meshes, so geometry stays a pure render
   concern. */
window.BR = window.BR || {};
(function (BR) {
  'use strict';

  var TILE = 3.3;
  var GW = 58, GH = 58;

  var HALL = 0, MAZE = 1, PILLAR = 2, POOL = 3, RED = 4;

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
      lightColor: 0xff4f3c, lightIntensity: 1.3, lightStep: 5, flicker: 0.07 }
  ];

  BR.TILE = TILE;
  BR.GW = GW;
  BR.GH = GH;
  BR.ZONES = ZONES;
  BR.HALL = HALL; BR.MAZE = MAZE; BR.PILLAR = PILLAR; BR.POOL = POOL; BR.RED = RED;

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

  // A body is blocked when any corner of its bounding square lands in a solid
  // tile - cheap and exact enough for axis-aligned tile walls.
  BR.blocked = function (level, x, z, r) {
    return BR.solidAtWorld(level, x - r, z - r) || BR.solidAtWorld(level, x + r, z - r) ||
           BR.solidAtWorld(level, x - r, z + r) || BR.solidAtWorld(level, x + r, z + r);
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
        var nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        var nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!BR.isFloor(level, nx, nz)) continue;
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
      var nx = tx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      var nz = tz + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (!BR.isFloor(level, nx, nz)) continue;
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
        if (!floor[i]) { floor[i] = 1; zone[i] = HALL; }
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

    var level = { floor: floor, zone: zone, water: water, rooms: rooms };

    // Spawn in a hall room, then keep only what is actually reachable from it.
    var spawnRoom = null;
    for (var r = 0; r < rooms.length; r++) {
      if (rooms[r].zoneIdx === HALL) { spawnRoom = rooms[r]; break; }
    }
    if (!spawnRoom) spawnRoom = rooms[0];
    var spawnTile = { tx: spawnRoom.cx, tz: spawnRoom.cz };
    var reachField = BR.flowField(level, spawnTile.tx, spawnTile.tz);

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

    // Exit sits in the room furthest from spawn; books are scattered across the
    // rest so the player has to cross several zones to finish.
    var exitRoom = null, exitDist = -1;
    reachableRooms.forEach(function (room) {
      var d = reachField[room.cz * GW + room.cx];
      if (d > exitDist) { exitDist = d; exitRoom = room; }
    });
    if (!exitRoom) exitRoom = reachableRooms[reachableRooms.length - 1] || spawnRoom;

    var exitTiles = roomReachableTiles(exitRoom);
    var exitTile = exitTiles[Math.floor(exitTiles.length / 2)] || spawnTile;

    var bookRooms = shuffle(reachableRooms.filter(function (room) {
      return room !== exitRoom && room !== spawnRoom;
    }));
    var bookTiles = [];
    for (var b = 0; b < bookRooms.length && bookTiles.length < 8; b++) {
      var tiles = roomReachableTiles(bookRooms[b]).filter(function (t) {
        return !BR.isWaterTile(level, t.tx, t.tz) &&
               Math.abs(t.tx - exitTile.tx) + Math.abs(t.tz - exitTile.tz) > 4;
      });
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

    for (var tz = 0; tz < GH; tz++) {
      for (var tx = 0; tx < GW; tx++) {
        var solid = BR.isSolid(level, tx, tz);
        if (!solid) {
          var z0 = BR.zoneAt(level, tx, tz);
          floorTiles[z0].push({ tx: tx, tz: tz });
          ceilTiles[z0].push({ tx: tx, tz: tz });
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
    }

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
