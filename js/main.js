(function(){
  // =========================================================================
  // CONFIG
  // =========================================================================
  var interiorSize = 5;                 // hallway grid is interiorSize x interiorSize
  var gridSize = interiorSize + 2;      // + one ring of classroom slots around it
  var cellSize = 8;
  var wallThick = 0.4;
  var wallH = 4.6;
  var mazeExtent = gridSize*cellSize;
  var playerRadius = 0.35;
  var catchRadius = 0.95;
  var interactRadius = 2.9;
  var roomSlotCount = 9;                // classrooms carved out of the perimeter ring
  var booksCount = 5;                   // must be < roomSlotCount (1 slot becomes the exit)
  var keysNeeded = 3;
  var camDist = 5.6;

  var walkSpeed = 5.2;
  var sprintMultiplier = 1.7;
  var staminaMax = 100;
  var staminaDrainPerSec = 30;
  var staminaRegenPerSec = 16;
  var staminaResumeThreshold = 25;

  // baldi behaviour: wanders randomly until it notices the player, then hunts;
  // if the player gets far enough away again it gives up and resumes wandering.
  var baldiPatrolSpeed = 2.2;
  var baldiChaseSpeedBase = 3.8;
  var baldiChaseSpeedStep = 0.55;        // permanent chase-speed penalty per wrong answer
  var baldiChaseSpeedCap = 7.2;
  var baldiDetectRadius = 9.5;           // must also have line of sight to notice the player
  var baldiLoseRadius = 14;              // must exceed this before baldi gives up the chase

  // Paths for optional real assets. Drop matching .glb files here and they will
  // automatically replace the placeholder shapes below - no other code changes needed.
  var ASSET_PATHS = {
    player: 'assets/models/player.glb',
    baldi: 'assets/models/baldi.glb',
    book: 'assets/models/book.glb'
  };
  // Tweak per-model if a dropped-in asset needs a different scale/facing than the placeholder.
  var ASSET_TUNING = {
    player: { scale: 1, rotationY: 0, yOffset: 0 },
    baldi: { scale: 1, rotationY: 0, yOffset: 0 },
    book: { scale: 1, rotationY: 0, yOffset: 0 }
  };

  document.getElementById('keyNeed').textContent = keysNeeded;
  document.getElementById('startKeyNeed').textContent = keysNeeded;

  // =========================================================================
  // audio (no external files)
  // =========================================================================
  var actx = null;
  function beep(freq, dur, type){
    try{
      if(!actx) actx = new (window.AudioContext||window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type||'sine'; o.frequency.value = freq;
      g.gain.value = 0.08;
      o.connect(g); g.connect(actx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime+dur);
      o.stop(actx.currentTime+dur);
    }catch(e){}
  }

  // =========================================================================
  // three.js setup
  // =========================================================================
  var container = document.getElementById('threeContainer');
  var w = container.clientWidth || 320;
  var h = container.clientHeight || 240;

  var scene = new THREE.Scene();
  var bg = 0x14100a;
  scene.fog = new THREE.Fog(bg, 5, 28);
  scene.background = new THREE.Color(bg);

  var camera = new THREE.PerspectiveCamera(62, w/h, 0.1, 100);
  var renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(w,h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xfff2c0, 0.16));

  // ---------- optional GLTF asset loading (falls back to placeholders) ----------
  var gltfLoader = (window.THREE && THREE.GLTFLoader) ? new THREE.GLTFLoader() : null;
  function tryAttachModel(targetGroup, url, tuning){
    if(!gltfLoader) return;
    tuning = tuning||{};
    gltfLoader.load(url, function(gltf){
      var model = gltf.scene;
      var s = tuning.scale||1;
      model.scale.set(s,s,s);
      if(tuning.rotationY) model.rotation.y = tuning.rotationY;
      if(tuning.yOffset) model.position.y = tuning.yOffset;
      while(targetGroup.children.length){ targetGroup.remove(targetGroup.children[0]); }
      targetGroup.add(model);
    }, undefined, function(){
      // asset not present yet - keep using the placeholder mesh, this is expected
      // until real art is dropped into assets/models/.
    });
  }

  function makeTexture(base, grain, w1, h1, vertical){
    var c = document.createElement('canvas'); c.width=w1; c.height=h1;
    var ctx = c.getContext('2d');
    ctx.fillStyle = base; ctx.fillRect(0,0,w1,h1);
    for(var i=0;i<60;i++){
      ctx.strokeStyle = 'rgba(90,70,30,'+(0.04+Math.random()*0.08)+')';
      ctx.beginPath();
      if(vertical){
        var x = Math.random()*w1;
        ctx.moveTo(x,0); ctx.lineTo(x+(Math.random()*6-3), h1);
      } else {
        var y = Math.random()*h1;
        ctx.moveTo(0,y); ctx.lineTo(w1, y+(Math.random()*6-3));
      }
      ctx.stroke();
    }
    for(var i=0;i<w1*h1*grain;i++){
      ctx.fillStyle = 'rgba(70,55,25,'+(Math.random()*0.08)+')';
      ctx.fillRect(Math.random()*w1, Math.random()*h1, 1,1);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }
  function makeCeilTexture(){
    var s=128, c=document.createElement('canvas'); c.width=s;c.height=s;
    var ctx=c.getContext('2d');
    ctx.fillStyle='#c9ac6c'; ctx.fillRect(0,0,s,s);
    ctx.strokeStyle='rgba(90,70,30,0.35)'; ctx.lineWidth=2;
    ctx.strokeRect(1,1,s-2,s-2);
    return new THREE.CanvasTexture(c);
  }

  var wallTex = makeTexture('#b0925a', 0.04, 128,128, true);
  var floorTex = makeTexture('#8a744a', 0.09, 128,128, false);
  var ceilTex = makeCeilTexture();
  ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping;

  wallTex.repeat.set(mazeExtent/3, wallH/3);
  var wallMat = new THREE.MeshStandardMaterial({map:wallTex, roughness:0.95});
  floorTex.repeat.set(mazeExtent/2, mazeExtent/2);
  var floorMat = new THREE.MeshStandardMaterial({map:floorTex, roughness:1});
  ceilTex.repeat.set(mazeExtent/2, mazeExtent/2);
  var ceilMat = new THREE.MeshStandardMaterial({map:ceilTex, roughness:1});

  var floor = new THREE.Mesh(new THREE.PlaneGeometry(mazeExtent, mazeExtent), floorMat);
  floor.rotation.x = -Math.PI/2;
  floor.position.set(mazeExtent/2, 0, mazeExtent/2);
  scene.add(floor);

  var ceiling = new THREE.Mesh(new THREE.PlaneGeometry(mazeExtent, mazeExtent), ceilMat);
  ceiling.rotation.x = Math.PI/2;
  ceiling.position.set(mazeExtent/2, wallH, mazeExtent/2);
  scene.add(ceiling);

  var mazeGroup = new THREE.Group();
  scene.add(mazeGroup);
  var booksGroup = new THREE.Group();
  scene.add(booksGroup);

  var wallBoxes = []; // {minX,maxX,minZ,maxZ}
  var wallMeshes = []; // for camera raycasting
  var doorBoxIndex = -1;

  function addWall(x,z,sx,sz,mat,group){
    var m = new THREE.Mesh(new THREE.BoxGeometry(sx, wallH, sz), mat||wallMat);
    m.position.set(x, wallH/2, z);
    (group||mazeGroup).add(m);
    wallMeshes.push(m);
    wallBoxes.push({minX:x-sx/2, maxX:x+sx/2, minZ:z-sz/2, maxZ:z+sz/2});
    return m;
  }

  // =========================================================================
  // school layout: a looped hallway grid (interior) ringed by classroom slots
  // =========================================================================
  var cells, doorCell, baldiStartCell, bookCells, roomCells, startCell;

  function makeCells(){
    cells = [];
    for(var r=0;r<gridSize;r++){
      var row=[];
      for(var c=0;c<gridSize;c++){
        row.push({r:r,c:c,N:true,S:true,E:true,W:true,visited:false,isRoom:false,doorDir:null});
      }
      cells.push(row);
    }
  }
  function cellAt(r,c){ return (r>=0&&r<gridSize&&c>=0&&c<gridSize) ? cells[r][c] : null; }
  var interiorMin = 1, interiorMax = gridSize-2;
  function isInterior(r,c){ return r>=interiorMin&&r<=interiorMax&&c>=interiorMin&&c<=interiorMax; }

  function openBetween(a,b){
    if(b.r===a.r-1){ a.N=false; b.S=false; }
    else if(b.r===a.r+1){ a.S=false; b.N=false; }
    else if(b.c===a.c+1){ a.E=false; b.W=false; }
    else if(b.c===a.c-1){ a.W=false; b.E=false; }
  }
  function dirFromTo(a,b){
    if(b.r===a.r-1) return 'N';
    if(b.r===a.r+1) return 'S';
    if(b.c===a.c+1) return 'E';
    return 'W';
  }
  function oppositeDir(d){ return d==='N'?'S':d==='S'?'N':d==='E'?'W':'E'; }

  function shuffle(arr){
    for(var i=arr.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=arr[i]; arr[i]=arr[j]; arr[j]=t; }
    return arr;
  }

  function carveHallways(){
    var start = cells[interiorMin][interiorMin];
    var stack=[start]; start.visited=true;
    while(stack.length){
      var cur = stack[stack.length-1];
      var opts = [];
      [[-1,0],[1,0],[0,1],[0,-1]].forEach(function(d){
        var nr=cur.r+d[0], nc=cur.c+d[1];
        if(isInterior(nr,nc)){
          var n = cells[nr][nc];
          if(!n.visited) opts.push(n);
        }
      });
      if(!opts.length){ stack.pop(); continue; }
      var pick = opts[Math.floor(Math.random()*opts.length)];
      openBetween(cur, pick);
      pick.visited = true;
      stack.push(pick);
    }
    // extra loops so the chase has multiple routes through the hallway grid
    for(var r=interiorMin;r<=interiorMax;r++){
      for(var c=interiorMin;c<=interiorMax;c++){
        var cell = cells[r][c];
        if(c+1<=interiorMax && cell.E && Math.random()<0.22){ openBetween(cell, cells[r][c+1]); }
        if(r+1<=interiorMax && cell.S && Math.random()<0.22){ openBetween(cell, cells[r+1][c]); }
      }
    }
  }

  function carveClassrooms(){
    var candidates = [];
    for(var c=interiorMin;c<=interiorMax;c++){
      candidates.push({room:cellAt(0,c), hall:cellAt(1,c)});
      candidates.push({room:cellAt(gridSize-1,c), hall:cellAt(gridSize-2,c)});
    }
    for(var r=interiorMin;r<=interiorMax;r++){
      candidates.push({room:cellAt(r,0), hall:cellAt(r,1)});
      candidates.push({room:cellAt(r,gridSize-1), hall:cellAt(r,gridSize-2)});
    }
    shuffle(candidates);
    var chosen = candidates.slice(0, Math.min(roomSlotCount, candidates.length));
    roomCells = chosen.map(function(pair){
      openBetween(pair.room, pair.hall);
      pair.room.isRoom = true;
      pair.room.doorDir = dirFromTo(pair.room, pair.hall);
      return pair.room;
    });
  }

  function neighborsOf(r,c){
    var cell = cells[r][c], out=[];
    if(!cell.N) out.push(cellAt(r-1,c));
    if(!cell.S) out.push(cellAt(r+1,c));
    if(!cell.E) out.push(cellAt(r,c+1));
    if(!cell.W) out.push(cellAt(r,c-1));
    return out;
  }

  function bfsAll(startR,startC){
    var dist = [];
    for(var r=0;r<gridSize;r++){ dist.push(new Array(gridSize).fill(-1)); }
    dist[startR][startC]=0;
    var q=[cells[startR][startC]];
    while(q.length){
      var cur = q.shift();
      var neigh = neighborsOf(cur.r,cur.c);
      for(var i=0;i<neigh.length;i++){
        var nb = neigh[i];
        if(dist[nb.r][nb.c]===-1){ dist[nb.r][nb.c]=dist[cur.r][cur.c]+1; q.push(nb); }
      }
    }
    return dist;
  }

  function bfsPath(fromR,fromC,toR,toC){
    var visited = [];
    for(var r=0;r<gridSize;r++) visited.push(new Array(gridSize).fill(false));
    var parent = {};
    visited[fromR][fromC]=true;
    var q=[cells[fromR][fromC]];
    var key = function(cell){ return cell.r+'_'+cell.c; };
    while(q.length){
      var cur = q.shift();
      if(cur.r===toR && cur.c===toC) break;
      var neigh = neighborsOf(cur.r,cur.c);
      for(var i=0;i<neigh.length;i++){
        var nb = neigh[i];
        if(!visited[nb.r][nb.c]){
          visited[nb.r][nb.c]=true;
          parent[key(nb)] = cur;
          q.push(nb);
        }
      }
    }
    if(!visited[toR][toC]) return [cells[fromR][fromC]];
    var path = [cells[toR][toC]];
    var cur = cells[toR][toC];
    while(!(cur.r===fromR && cur.c===fromC)){
      cur = parent[key(cur)];
      path.unshift(cur);
    }
    return path;
  }

  function cellCenter(r,c){
    return {x:(c+0.5)*cellSize, z:(r+0.5)*cellSize};
  }

  function clearGroup(group){
    while(group.children.length){
      var m = group.children.pop();
      group.remove(m);
      if(m.geometry) m.geometry.dispose();
    }
  }

  function buildMazeGeometry(){
    clearGroup(mazeGroup);
    wallBoxes = [];
    wallMeshes = [];
    for(var r=0;r<gridSize;r++){
      for(var c=0;c<gridSize;c++){
        var cell = cells[r][c];
        var cx=(c+0.5)*cellSize, cz=(r+0.5)*cellSize;
        if(cell.N) addWall(cx, r*cellSize, cellSize+wallThick, wallThick);
        if(cell.W) addWall(c*cellSize, cz, wallThick, cellSize+wallThick);
        if(r===gridSize-1 && cell.S) addWall(cx, (r+1)*cellSize, cellSize+wallThick, wallThick);
        if(c===gridSize-1 && cell.E) addWall((c+1)*cellSize, cz, wallThick, cellSize+wallThick);
      }
    }
    // hallway ceiling light fixtures
    var lights = [];
    function addFixture(x,z){
      var frame = new THREE.Mesh(new THREE.BoxGeometry(3.2,0.1,1.1), new THREE.MeshStandardMaterial({color:0x4a3d1f}));
      frame.position.set(x, wallH-0.06, z);
      mazeGroup.add(frame);
      var barMat = new THREE.MeshStandardMaterial({color:0xfff7d6, emissive:0xfff0b0, emissiveIntensity:1.2});
      for(var i=0;i<3;i++){
        var bar = new THREE.Mesh(new THREE.BoxGeometry(2.8,0.05,0.15), barMat);
        bar.position.set(x, wallH-0.02, z-0.35+i*0.35);
        mazeGroup.add(bar);
      }
      var pl = new THREE.PointLight(0xfff2c0, 1.0, 13);
      pl.position.set(x, wallH-0.6, z);
      mazeGroup.add(pl);
      lights.push(pl);
    }
    for(var r=interiorMin;r<=interiorMax;r++){
      for(var c=interiorMin;c<=interiorMax;c++){
        if((r+c)%2===0){ var p=cellCenter(r,c); addFixture(p.x,p.z); }
      }
    }
    return lights;
  }

  function decorateRoom(cell){
    var pos = cellCenter(cell.r, cell.c);
    var back = oppositeDir(cell.doorDir);
    var inset = cellSize/2 - 0.35;
    var bx=pos.x, bz=pos.z, rotY=0;
    if(back==='N'){ bz = pos.z-inset; rotY=0; }
    else if(back==='S'){ bz = pos.z+inset; rotY=Math.PI; }
    else if(back==='E'){ bx = pos.x+inset; rotY=-Math.PI/2; }
    else { bx = pos.x-inset; rotY=Math.PI/2; }

    var board = new THREE.Mesh(new THREE.BoxGeometry(2.4,1.3,0.08), new THREE.MeshStandardMaterial({color:0x1e4530, roughness:0.8}));
    board.position.set(bx, 1.7, bz);
    board.rotation.y = rotY;
    mazeGroup.add(board);

    var deskMat = new THREE.MeshStandardMaterial({color:0x6b5230, roughness:0.8});
    var forwardX = pos.x-bx, forwardZ = pos.z-bz;
    var flen = Math.hypot(forwardX,forwardZ)||1;
    forwardX/=flen; forwardZ/=flen;
    var sideX = -forwardZ, sideZ = forwardX;
    [-1,1].forEach(function(s){
      var desk = new THREE.Mesh(new THREE.BoxGeometry(0.9,0.55,0.6), deskMat);
      desk.position.set(pos.x + sideX*s*0.9 - forwardX*0.6, 0.28, pos.z + sideZ*s*0.9 - forwardZ*0.6);
      mazeGroup.add(desk);
    });
  }

  // ---------- door ----------
  var door, doorLocked = true;
  function buildDoor(){
    var pos = cellCenter(doorCell.r, doorCell.c);
    var g = new THREE.Group();
    var frameMat = new THREE.MeshStandardMaterial({color:0x5a4520});
    var frame = new THREE.Mesh(new THREE.BoxGeometry(2.2,3.2,0.3), frameMat);
    frame.position.y = 1.6;
    g.add(frame);
    var panelMat = new THREE.MeshStandardMaterial({color:0xb03030, emissive:0x400000, emissiveIntensity:0.4});
    var panel = new THREE.Mesh(new THREE.BoxGeometry(1.7,2.7,0.15), panelMat);
    panel.position.set(0,1.6,0.1);
    g.add(panel);
    var lockMat = new THREE.MeshStandardMaterial({color:0xffe28a, emissive:0xffcf5a, emissiveIntensity:0.6});
    var lock = new THREE.Mesh(new THREE.SphereGeometry(0.18,10,10), lockMat);
    lock.position.set(0,1.4,0.22);
    g.add(lock);
    g.position.set(pos.x, 0, pos.z);
    g.userData.panel = panel;
    g.userData.lock = lock;
    mazeGroup.add(g);
    door = g;
    doorLocked = true;
    doorBoxIndex = wallBoxes.length;
    wallBoxes.push({minX:pos.x-1.1,maxX:pos.x+1.1,minZ:pos.z-0.3,maxZ:pos.z+0.3});
  }
  function unlockDoor(){
    doorLocked = false;
    door.userData.panel.material.color.set(0x3fb04a);
    door.userData.panel.material.emissive.set(0x0a3a10);
    door.userData.lock.material.color.set(0x8affa0);
    door.userData.lock.material.emissive.set(0x2fdf5a);
    if(doorBoxIndex>=0){ wallBoxes.splice(doorBoxIndex,1); doorBoxIndex=-1; }
  }

  // ---------- books ----------
  var books = []; // {mesh, cell, solved}
  function buildBooks(){
    clearGroup(booksGroup);
    books = [];
    for(var i=0;i<bookCells.length;i++){
      var cell = bookCells[i];
      var pos = cellCenter(cell.r, cell.c);
      var g = new THREE.Group();
      var coverMat = new THREE.MeshStandardMaterial({color:0x3a6bd8, emissive:0x0a1a4a, emissiveIntensity:0.5, roughness:0.5});
      var cover = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.35,0.42), coverMat);
      cover.position.y = 0.5;
      g.add(cover);
      var pagesMat = new THREE.MeshStandardMaterial({color:0xf0e6c8});
      var pages = new THREE.Mesh(new THREE.BoxGeometry(0.46,0.3,0.38), pagesMat);
      pages.position.y = 0.5;
      g.add(pages);
      g.position.set(pos.x, 0, pos.z);
      booksGroup.add(g);
      tryAttachModel(g, ASSET_PATHS.book, ASSET_TUNING.book);
      books.push({mesh:g, cell:cell, solved:false});
    }
  }

  // ---------- player ----------
  var player = new THREE.Group();
  var bodyMat = new THREE.MeshStandardMaterial({color:0x7a3b3b, roughness:0.7});
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.4,1.0,12), bodyMat);
  body.position.y = 0.7;
  player.add(body);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.26,14,14), new THREE.MeshStandardMaterial({color:0xd9b98a, roughness:0.8}));
  head.position.y = 1.45;
  player.add(head);
  var shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5,16), new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:0.35}));
  shadow.rotation.x = -Math.PI/2;
  shadow.position.y = 0.02;
  player.add(shadow);
  scene.add(player);
  var playerLight = new THREE.PointLight(0xfff2c0, 0.55, 8);
  playerLight.position.set(0,2,0);
  player.add(playerLight);
  tryAttachModel(player, ASSET_PATHS.player, ASSET_TUNING.player);

  // ---------- baldi (teacher) ----------
  var baldi = new THREE.Group();
  var bShirt = new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.42,0.95,12), new THREE.MeshStandardMaterial({color:0x2fae3f, roughness:0.7}));
  bShirt.position.y = 0.72;
  baldi.add(bShirt);
  var bLegL = new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.13,0.62,8), new THREE.MeshStandardMaterial({color:0x2244aa}));
  bLegL.position.set(-0.14,0.31,0); baldi.add(bLegL);
  var bLegR = bLegL.clone(); bLegR.position.x = 0.14; baldi.add(bLegR);
  var bHead = new THREE.Mesh(new THREE.SphereGeometry(0.27,16,16), new THREE.MeshStandardMaterial({color:0xe8cf9a, roughness:0.75}));
  bHead.position.y = 1.5; baldi.add(bHead);
  var eyeMat = new THREE.MeshBasicMaterial({color:0x1a1408});
  var eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035,8,8), eyeMat); eyeL.position.set(-0.09,1.54,0.24); baldi.add(eyeL);
  var eyeR = eyeL.clone(); eyeR.position.x = 0.09; baldi.add(eyeR);
  var mouth = new THREE.Mesh(new THREE.BoxGeometry(0.14,0.03,0.02), new THREE.MeshBasicMaterial({color:0xaa2020}));
  mouth.position.set(0,1.42,0.26); baldi.add(mouth);
  var ruler = new THREE.Mesh(new THREE.BoxGeometry(0.08,1.0,0.04), new THREE.MeshStandardMaterial({color:0xe0b050}));
  ruler.position.set(0.42,1.05,0.15); ruler.rotation.z = -0.25;
  baldi.add(ruler);
  var bShadow = shadow.clone(); baldi.add(bShadow);
  scene.add(baldi);
  tryAttachModel(baldi, ASSET_PATHS.baldi, ASSET_TUNING.baldi);

  // ---------- collision ----------
  var margin = playerRadius;
  function collides(x,z,radius){
    var m = radius===undefined?margin:radius;
    if(x<m||x>mazeExtent-m||z<m||z>mazeExtent-m) return true;
    for(var i=0;i<wallBoxes.length;i++){
      var b = wallBoxes[i];
      if(x>b.minX-m && x<b.maxX+m && z>b.minZ-m && z<b.maxZ+m) return true;
    }
    return false;
  }

  function worldToCell(x,z){
    var c = Math.floor(x/cellSize), r = Math.floor(z/cellSize);
    c = Math.max(0,Math.min(gridSize-1,c));
    r = Math.max(0,Math.min(gridSize-1,r));
    return {r:r,c:c};
  }

  // =========================================================================
  // camera controls
  // =========================================================================
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function lerpAngle(a,b,t){
    var d = ((b-a+Math.PI)%(Math.PI*2))-Math.PI;
    if(d<-Math.PI) d+=Math.PI*2;
    return a+d*t;
  }
  var orbitYaw = Math.PI, orbitPitch = 0.38;
  var lookId=null,lastX=0,lastY=0;
  var lookSens = 0.0105;
  var tapId=null, tapStartX=0, tapStartY=0, tapStartT=0, tapDragged=false;

  container.addEventListener('pointerdown', function(e){
    var rect = container.getBoundingClientRect();
    var lx = e.clientX-rect.left;
    tapId = e.pointerId; tapStartX=e.clientX; tapStartY=e.clientY; tapStartT=performance.now(); tapDragged=false;
    if(lx >= rect.width*0.4 && lookId===null){
      lookId = e.pointerId; lastX=e.clientX; lastY=e.clientY;
      container.setPointerCapture(e.pointerId);
    }
  });
  container.addEventListener('pointermove', function(e){
    if(e.pointerId===tapId){
      if(Math.abs(e.clientX-tapStartX)>8 || Math.abs(e.clientY-tapStartY)>8) tapDragged=true;
    }
    if(e.pointerId!==lookId) return;
    var dx=e.clientX-lastX, dy=e.clientY-lastY;
    lastX=e.clientX; lastY=e.clientY;
    orbitYaw -= dx*lookSens;
    orbitPitch = clamp(orbitPitch - dy*lookSens, 0.08, 0.85);
  });
  function endLook(e){
    if(e.pointerId===lookId) lookId=null;
    if(e.pointerId===tapId){
      var dt = performance.now()-tapStartT;
      if(!tapDragged && dt<350){
        handleTap(e.clientX, e.clientY);
      }
      tapId=null;
    }
  }
  container.addEventListener('pointerup', endLook);
  container.addEventListener('pointercancel', endLook);

  var raycaster = new THREE.Raycaster();
  function handleTap(clientX, clientY){
    if(gameState!=='playing') return;
    var rect = container.getBoundingClientRect();
    var ndc = new THREE.Vector2(
      ((clientX-rect.left)/rect.width)*2-1,
      -((clientY-rect.top)/rect.height)*2+1
    );
    raycaster.setFromCamera(ndc, camera);
    var hits = raycaster.intersectObjects(booksGroup.children, true);
    if(hits.length){
      var obj = hits[0].object;
      while(obj && obj.parent!==booksGroup) obj = obj.parent;
      var book = books.find(function(b){ return b.mesh===obj; });
      if(book && !book.solved) tryOpenBook(book);
    }
  }

  // ---------- joystick ----------
  var joy = document.getElementById('joystick');
  var stick = document.getElementById('stick');
  var joyId=null, joyVec={x:0,y:0}, joyRect;
  joy.addEventListener('pointerdown', function(e){
    joyId=e.pointerId; joyRect=joy.getBoundingClientRect();
    joy.setPointerCapture(e.pointerId);
    updateJoy(e.clientX,e.clientY);
  });
  joy.addEventListener('pointermove', function(e){ if(e.pointerId===joyId) updateJoy(e.clientX,e.clientY); });
  function updateJoy(x,y){
    var cx=joyRect.left+joyRect.width/2, cy=joyRect.top+joyRect.height/2;
    var dx=x-cx, dy=y-cy, max=joyRect.width/2;
    var dist=Math.min(Math.sqrt(dx*dx+dy*dy),max);
    var ang=Math.atan2(dy,dx);
    var nx=Math.cos(ang)*dist, ny=Math.sin(ang)*dist;
    stick.style.left=(25+nx*0.55)+'px'; stick.style.top=(25+ny*0.55)+'px';
    var vx=nx/max, vy=ny/max, mag=Math.sqrt(vx*vx+vy*vy);
    joyVec = mag<0.12 ? {x:0,y:0} : {x:vx,y:vy};
  }
  function endJoy(e){
    if(e.pointerId!==joyId) return;
    joyId=null; joyVec={x:0,y:0};
    stick.style.left='25px'; stick.style.top='25px';
  }
  joy.addEventListener('pointerup', endJoy);
  joy.addEventListener('pointercancel', endJoy);

  // ---------- run / sprint ----------
  var runBtn = document.getElementById('runBtn');
  var staminaFill = document.getElementById('staminaFill');
  var sprintHeld = false;
  var stamina = staminaMax;
  var canSprint = true;
  runBtn.addEventListener('pointerdown', function(e){ sprintHeld=true; runBtn.classList.add('active'); e.preventDefault(); });
  runBtn.addEventListener('pointerup', function(){ sprintHeld=false; runBtn.classList.remove('active'); });
  runBtn.addEventListener('pointercancel', function(){ sprintHeld=false; runBtn.classList.remove('active'); });

  var keys={};
  window.addEventListener('keydown', function(e){ keys[e.key.toLowerCase()]=true; });
  window.addEventListener('keyup', function(e){ keys[e.key.toLowerCase()]=false; });

  // =========================================================================
  // toast
  // =========================================================================
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function showToast(msg, ms){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if(toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, ms||1500);
  }

  // =========================================================================
  // math questions
  // =========================================================================
  function genQuestion(){
    var ops = ['+','-','×'];
    var op = ops[Math.floor(Math.random()*ops.length)];
    var a,b,answer,text;
    if(op==='+'){ a=Math.floor(Math.random()*40)+5; b=Math.floor(Math.random()*40)+5; answer=a+b; text=a+' + '+b; }
    else if(op==='-'){ a=Math.floor(Math.random()*40)+15; b=Math.floor(Math.random()*a); answer=a-b; text=a+' - '+b; }
    else { a=Math.floor(Math.random()*9)+2; b=Math.floor(Math.random()*9)+2; answer=a*b; text=a+' × '+b; }
    var choices = [answer];
    while(choices.length<4){
      var delta = Math.floor(Math.random()*9)-4;
      if(delta===0) delta = 3;
      var cand = answer+delta;
      if(cand>=0 && choices.indexOf(cand)===-1) choices.push(cand);
    }
    shuffle(choices);
    return {text:text, answer:answer, choices:choices};
  }

  var questionModal = document.getElementById('questionModal');
  var qText = document.getElementById('qText');
  var qChoices = document.getElementById('qChoices');
  var activeBook = null;

  function tryOpenBook(book){
    var dist = Math.hypot(player.position.x-book.mesh.position.x, player.position.z-book.mesh.position.z);
    if(dist>interactRadius){
      showToast('책에 더 가까이 다가가세요');
      return;
    }
    openQuestion(book);
  }

  function openQuestion(book){
    activeBook = book;
    var q = genQuestion();
    qText.textContent = q.text + ' = ?';
    qChoices.innerHTML = '';
    q.choices.forEach(function(choice){
      var btn = document.createElement('button');
      btn.className = 'qBtn';
      btn.textContent = choice;
      btn.addEventListener('click', function(){ answerQuestion(choice===q.answer); });
      qChoices.appendChild(btn);
    });
    questionModal.style.display = 'flex';
    gameState = 'question';
  }

  function answerQuestion(correct){
    questionModal.style.display = 'none';
    gameState = 'playing';
    if(correct){
      beep(880,0.15,'sine');
      activeBook.solved = true;
      activeBook.mesh.visible = false;
      keyCount++;
      document.getElementById('keyCount').textContent = keyCount;
      showToast('정답입니다! 열쇠 획득 ('+keyCount+'/'+keysNeeded+')');
      if(keyCount>=keysNeeded && doorLocked){ unlockDoor(); showToast('열쇠를 모두 모았습니다! 탈출문이 열렸습니다'); }
    } else {
      beep(160,0.25,'sawtooth');
      chaseSpeedPenalty = Math.min(baldiChaseSpeedCap-baldiChaseSpeedBase, chaseSpeedPenalty + baldiChaseSpeedStep);
      showToast('틀렸습니다! 선생님이 쫓아올 때 더 빨라집니다');
    }
    activeBook = null;
  }

  // =========================================================================
  // baldi AI
  // =========================================================================
  var baldiState = 'patrol'; // 'patrol' | 'chase'
  var chaseSpeedPenalty = 0; // accumulated permanently from wrong answers
  var chaseRepathTimer = 0;
  var CHASE_REPATH_INTERVAL = 0.35;
  var chasePath = [];
  var chaseWaypointIdx = 1;
  var patrolPath = [];
  var patrolWaypointIdx = 1;
  var baldiVel = {x:0,z:0};
  var losRay = new THREE.Raycaster();

  function hasLineOfSight(ax,az,bx,bz){
    var dx=bx-ax, dz=bz-az, dist=Math.hypot(dx,dz);
    if(dist<0.001) return true;
    losRay.set(new THREE.Vector3(ax,1.4,az), new THREE.Vector3(dx/dist,0,dz/dist));
    losRay.far = dist;
    return losRay.intersectObjects(wallMeshes, false).length===0;
  }

  function pickRandomPatrolCell(excludeR, excludeC){
    var pool = [];
    for(var r=interiorMin;r<=interiorMax;r++){
      for(var c=interiorMin;c<=interiorMax;c++){
        if(r===excludeR && c===excludeC) continue;
        pool.push(cells[r][c]);
      }
    }
    if(Math.random()<0.3){
      roomCells.forEach(function(rc){ if(!(rc.r===excludeR && rc.c===excludeC)) pool.push(rc); });
    }
    return pool[Math.floor(Math.random()*pool.length)];
  }

  function updatePatrolPath(){
    var bc = worldToCell(baldi.position.x, baldi.position.z);
    var target = pickRandomPatrolCell(bc.r, bc.c);
    var path = bfsPath(bc.r, bc.c, target.r, target.c);
    patrolPath = path.map(function(cell){ return cellCenter(cell.r, cell.c); });
    patrolWaypointIdx = 1;
  }

  function updateChasePath(){
    var bc = worldToCell(baldi.position.x, baldi.position.z);
    var pc = worldToCell(player.position.x, player.position.z);
    var path = bfsPath(bc.r, bc.c, pc.r, pc.c);
    chasePath = path.map(function(cell){ return cellCenter(cell.r, cell.c); });
    chaseWaypointIdx = 1;
  }

  function updateBaldi(dt){
    var distToPlayer = Math.hypot(baldi.position.x-player.position.x, baldi.position.z-player.position.z);

    if(baldiState==='patrol'){
      if(distToPlayer<baldiDetectRadius && hasLineOfSight(baldi.position.x,baldi.position.z,player.position.x,player.position.z)){
        baldiState = 'chase';
        chasePath = [];
        chaseRepathTimer = 0;
        showToast('선생님에게 들켰습니다!');
        beep(300,0.2,'square');
      }
    } else {
      if(distToPlayer>baldiLoseRadius){
        baldiState = 'patrol';
        patrolPath = [];
        showToast('선생님을 따돌렸습니다');
      }
    }

    var target;
    if(baldiState==='chase'){
      chaseRepathTimer -= dt;
      if(chaseRepathTimer<=0){ updateChasePath(); chaseRepathTimer = CHASE_REPATH_INTERVAL; }
      if(chasePath.length<=1){
        target = {x:player.position.x, z:player.position.z};
      } else {
        if(chaseWaypointIdx>=chasePath.length) chaseWaypointIdx = chasePath.length-1;
        target = chasePath[chaseWaypointIdx];
        var dd = Math.hypot(baldi.position.x-target.x, baldi.position.z-target.z);
        if(dd<0.35 && chaseWaypointIdx<chasePath.length-1) chaseWaypointIdx++;
      }
    } else {
      if(patrolPath.length===0 || patrolWaypointIdx>=patrolPath.length){ updatePatrolPath(); }
      target = patrolPath[patrolWaypointIdx] || {x:baldi.position.x, z:baldi.position.z};
      var dd2 = Math.hypot(baldi.position.x-target.x, baldi.position.z-target.z);
      if(dd2<0.35){
        if(patrolWaypointIdx<patrolPath.length-1) patrolWaypointIdx++;
        else { patrolPath = []; }
      }
    }

    var speed = baldiState==='chase' ? Math.min(baldiChaseSpeedCap, baldiChaseSpeedBase+chaseSpeedPenalty) : baldiPatrolSpeed;
    var dx = target.x-baldi.position.x, dz = target.z-baldi.position.z;
    var dist = Math.hypot(dx,dz);
    if(dist>0.001){
      var vx = (dx/dist)*speed, vz=(dz/dist)*speed;
      baldiVel.x += (vx-baldiVel.x)*Math.min(1,8*dt);
      baldiVel.z += (vz-baldiVel.z)*Math.min(1,8*dt);
      baldi.position.x += baldiVel.x*dt;
      baldi.position.z += baldiVel.z*dt;
      var ang = Math.atan2(baldiVel.x, baldiVel.z);
      baldi.rotation.y = lerpAngle(baldi.rotation.y, ang, 0.15);
    }
    if(distToPlayer<catchRadius){ triggerGameOver(); }
  }

  // =========================================================================
  // minimap
  // =========================================================================
  var mm = document.getElementById('minimap');
  var mmCtx = mm.getContext('2d');
  function drawMinimap(){
    var scale = mm.width/mazeExtent;
    mmCtx.clearRect(0,0,mm.width,mm.height);
    mmCtx.fillStyle = 'rgba(20,16,10,0.4)';
    mmCtx.fillRect(0,0,mm.width,mm.height);
    for(var i=0;i<wallBoxes.length;i++){
      var b = wallBoxes[i];
      mmCtx.fillStyle = 'rgba(200,170,110,0.8)';
      mmCtx.fillRect(b.minX*scale, b.minZ*scale, Math.max(1,(b.maxX-b.minX)*scale), Math.max(1,(b.maxZ-b.minZ)*scale));
    }
    books.forEach(function(bk){
      if(bk.solved) return;
      mmCtx.fillStyle = '#5a9bff';
      mmCtx.beginPath();
      mmCtx.arc(bk.mesh.position.x*scale, bk.mesh.position.z*scale, 2.5, 0, Math.PI*2);
      mmCtx.fill();
    });
    if(door){
      mmCtx.fillStyle = doorLocked ? '#d04040' : '#40d060';
      mmCtx.fillRect(door.position.x*scale-3, door.position.z*scale-3, 6, 6);
    }
    if(baldiState==='chase'){
      mmCtx.fillStyle = '#ff4040';
      mmCtx.beginPath();
      mmCtx.arc(baldi.position.x*scale, baldi.position.z*scale, 3, 0, Math.PI*2);
      mmCtx.fill();
    }
    mmCtx.save();
    mmCtx.translate(player.position.x*scale, player.position.z*scale);
    mmCtx.rotate(player.rotation.y);
    mmCtx.fillStyle = '#ffe28a';
    mmCtx.beginPath();
    mmCtx.moveTo(0,-4); mmCtx.lineTo(3,3); mmCtx.lineTo(-3,3); mmCtx.closePath();
    mmCtx.fill();
    mmCtx.restore();
  }

  // =========================================================================
  // camera collision
  // =========================================================================
  var camRay = new THREE.Raycaster();
  function computeCameraPos(){
    var desiredX = player.position.x + camDist*Math.sin(orbitYaw)*Math.cos(orbitPitch);
    var desiredY = player.position.y + 1.3 + camDist*Math.sin(orbitPitch);
    var desiredZ = player.position.z + camDist*Math.cos(orbitYaw)*Math.cos(orbitPitch);
    var origin = new THREE.Vector3(player.position.x, player.position.y+1.3, player.position.z);
    var dirVec = new THREE.Vector3(desiredX-origin.x, desiredY-origin.y, desiredZ-origin.z);
    var fullDist = dirVec.length();
    dirVec.normalize();
    camRay.set(origin, dirVec);
    camRay.far = fullDist;
    var hits = camRay.intersectObjects(wallMeshes, false);
    var finalDist = fullDist;
    if(hits.length){ finalDist = Math.max(0.6, hits[0].distance-0.25); }
    var camY = origin.y + dirVec.y*finalDist;
    var ceilingLimit = wallH - 0.35;
    if(camY>ceilingLimit && dirVec.y>0){
      finalDist = Math.min(finalDist, (ceilingLimit-origin.y)/dirVec.y);
      camY = origin.y + dirVec.y*finalDist;
    }
    return {
      x: origin.x + dirVec.x*finalDist,
      y: camY,
      z: origin.z + dirVec.z*finalDist
    };
  }

  // =========================================================================
  // game state / lifecycle
  // =========================================================================
  var gameState = 'start'; // start | playing | question | gameover | win
  var keyCount = 0;
  var curVel = {x:0,z:0};
  var doorToastCooldown = 0;

  function setupGame(){
    makeCells();
    carveHallways();
    carveClassrooms();

    startCell = cells[interiorMin][interiorMin];
    var dist = bfsAll(startCell.r, startCell.c);

    // exit = farthest classroom from the start
    var best=null, bestD=-1;
    roomCells.forEach(function(rc){ if(dist[rc.r][rc.c]>bestD){ bestD=dist[rc.r][rc.c]; best=rc; } });
    doorCell = best;

    // baldi spawns deep in the hallway network, away from the player start
    var best2=null, bestD2=-1;
    for(var r=interiorMin;r<=interiorMax;r++){
      for(var c=interiorMin;c<=interiorMax;c++){
        if(r===startCell.r&&c===startCell.c) continue;
        if(dist[r][c]>bestD2){ bestD2=dist[r][c]; best2={r:r,c:c}; }
      }
    }
    baldiStartCell = cells[best2.r][best2.c];

    var remainingRooms = shuffle(roomCells.filter(function(rc){ return rc!==doorCell; }));
    bookCells = remainingRooms.slice(0, Math.min(booksCount, remainingRooms.length));

    buildMazeGeometry();
    roomCells.forEach(decorateRoom);
    buildDoor();
    buildBooks();

    var startPos = cellCenter(startCell.r, startCell.c);
    player.position.set(startPos.x, 0, startPos.z);
    player.rotation.y = 0;
    curVel = {x:0,z:0};
    stamina = staminaMax;
    canSprint = true;
    sprintHeld = false;

    var bPos = cellCenter(baldiStartCell.r, baldiStartCell.c);
    baldi.position.set(bPos.x, 0, bPos.z);
    baldiVel = {x:0,z:0};
    baldiState = 'patrol';
    chaseSpeedPenalty = 0;
    chasePath = [];
    patrolPath = [];
    chaseRepathTimer = 0;

    keyCount = 0;
    document.getElementById('keyCount').textContent = 0;
    orbitYaw = Math.PI; orbitPitch = 0.38;
  }

  function triggerGameOver(){
    if(gameState!=='playing') return;
    gameState = 'gameover';
    beep(120,0.5,'square');
    document.getElementById('gameOverScreen').hidden = false;
  }
  function triggerWin(){
    if(gameState!=='playing') return;
    gameState = 'win';
    beep(660,0.12,'sine');
    setTimeout(function(){ beep(880,0.12,'sine'); }, 130);
    setTimeout(function(){ beep(1100,0.25,'sine'); }, 260);
    document.getElementById('winScreen').hidden = false;
  }

  document.getElementById('startBtn').addEventListener('click', function(){
    document.getElementById('startScreen').hidden = true;
    setupGame();
    gameState = 'playing';
  });
  document.getElementById('retryBtn').addEventListener('click', function(){
    document.getElementById('gameOverScreen').hidden = true;
    setupGame();
    gameState = 'playing';
  });
  document.getElementById('againBtn').addEventListener('click', function(){
    document.getElementById('winScreen').hidden = true;
    setupGame();
    gameState = 'playing';
  });

  // =========================================================================
  // main loop
  // =========================================================================
  var clock = new THREE.Clock();
  function animate(){
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);

    if(gameState==='playing' || gameState==='question'){
      if(gameState==='playing'){
        var moveX = joyVec.x, moveZ = joyVec.y;
        if(keys['w']||keys['arrowup']) moveZ -= 1;
        if(keys['s']||keys['arrowdown']) moveZ += 1;
        if(keys['a']||keys['arrowleft']) moveX -= 1;
        if(keys['d']||keys['arrowright']) moveX += 1;
        var mag = Math.sqrt(moveX*moveX+moveZ*moveZ);
        if(mag>1){ moveX/=mag; moveZ/=mag; }

        var wantsSprint = (sprintHeld || keys['shift']) && canSprint && mag>0.05;
        if(wantsSprint){
          stamina = Math.max(0, stamina - staminaDrainPerSec*dt);
          if(stamina<=0) canSprint = false;
        } else {
          stamina = Math.min(staminaMax, stamina + staminaRegenPerSec*dt);
          if(!canSprint && stamina>=staminaResumeThreshold) canSprint = true;
        }
        staminaFill.style.width = (stamina/staminaMax*100)+'%';
        staminaFill.classList.toggle('low', stamina<staminaResumeThreshold);

        var maxSpeed = walkSpeed * (wantsSprint ? sprintMultiplier : 1);
        var targetVX=0, targetVZ=0;
        if(moveX||moveZ){
          var forward = {x:-Math.sin(orbitYaw), z:-Math.cos(orbitYaw)};
          var right = {x:Math.cos(orbitYaw), z:-Math.sin(orbitYaw)};
          var fAmt = -moveZ, sAmt = moveX;
          targetVX = (forward.x*fAmt + right.x*sAmt)*maxSpeed;
          targetVZ = (forward.z*fAmt + right.z*sAmt)*maxSpeed;
        }
        var accel = 13;
        curVel.x += (targetVX-curVel.x)*Math.min(1,accel*dt);
        curVel.z += (targetVZ-curVel.z)*Math.min(1,accel*dt);

        var nx = player.position.x + curVel.x*dt;
        var nz = player.position.z + curVel.z*dt;
        if(!collides(nx, player.position.z)) player.position.x = nx; else curVel.x=0;
        if(!collides(player.position.x, nz)) player.position.z = nz; else curVel.z=0;

        var speedMag = Math.sqrt(curVel.x*curVel.x+curVel.z*curVel.z);
        if(speedMag>0.3){
          var targetAngle = Math.atan2(-curVel.x, -curVel.z);
          player.rotation.y = lerpAngle(player.rotation.y, targetAngle, 0.26);
          var bobSpeed = wantsSprint ? 16 : 10;
          body.position.y = 0.7 + Math.sin(clock.elapsedTime*bobSpeed)*0.03;
        }

        doorToastCooldown -= dt;
        if(door){
          var dDist = Math.hypot(player.position.x-door.position.x, player.position.z-door.position.z);
          if(dDist<1.6){
            if(!doorLocked){ triggerWin(); }
            else if(doorToastCooldown<=0){ showToast('열쇠가 부족합니다 ('+keyCount+'/'+keysNeeded+')'); doorToastCooldown=2.5; }
          }
        }
      }

      updateBaldi(dt);

      var camPos = computeCameraPos();
      camera.position.set(camPos.x, camPos.y, camPos.z);
      camera.lookAt(player.position.x, player.position.y+1.2, player.position.z);

      drawMinimap();
    }

    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', function(){
    var nw = container.clientWidth, nh = container.clientHeight;
    if(nw && nh){
      camera.aspect = nw/nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw,nh);
    }
  });
})();
