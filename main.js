const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const overlay = document.getElementById('overlay');

const highscoreEl = document.getElementById('highscore');
const coinCountEl = document.getElementById('coinCount');
const shopBtn = document.getElementById('shopBtn');
const shop = document.getElementById('shop');
const skinsList = document.getElementById('skinsList');
const closeShop = document.getElementById('closeShop');

// base (internal) canvas size — game logic uses these coordinates
const baseW = canvas.width, baseH = canvas.height;
let W = baseW, H = baseH;

const bullImg = new Image();
// grade images (A-F)
const GRADE_IMAGES = {};
['A','B','C','D','E','F'].forEach(g => { GRADE_IMAGES[g] = new Image(); GRADE_IMAGES[g].src = `assets/grade_${g}.svg`; });

// skins catalog
const SKINS = [
  // Free default
  {id:'default', name:'Default', src:'assets/bull.svg', cost:0},
  // Budget coins (5-15 coins)
  {id:'frost', name:'Frost', src:'assets/bull_frost.svg', cost:5},
  {id:'flame', name:'Flame', src:'assets/bull_flame.svg', cost:8},
  // Medium coins (12-30 coins)
  {id:'gray', name:'Steel Gray', src:'assets/bull_gray.svg', cost:12},
  {id:'black', name:'Midnight', src:'assets/bull_black.svg', cost:15},
  {id:'red', name:'Raging Red', src:'assets/bull_red.svg', cost:10},
  {id:'cowboy', name:'Cowboy', src:'assets/bull_cowboy.svg', cost:20},
  {id:'emerald', name:'Emerald', src:'assets/bull_emerald.svg', cost:25},
  {id:'gold', name:'Golden', src:'assets/bull_gold.svg', cost:25},
  {id:'party', name:'Party', src:'assets/bull_party.svg', cost:30},
  {id:'royal', name:'Royal', src:'assets/bull_royal.svg', cost:40},
  // Score-based unlocks
  {id:'hs10', name:'Skilled (HS10)', src:'assets/bull_frost.svg', unlockScore:10, cost:0},
  {id:'hs20', name:'Expert (HS20)', src:'assets/bull_flame.svg', unlockScore:20, cost:0},
  {id:'hs30', name:'Master (HS30)', src:'assets/bull_emerald.svg', unlockScore:30, cost:0},
  {id:'hs40', name:'Legend (HS40)', src:'assets/bull_royal.svg', unlockScore:40, cost:0},
  {id:'hs50', name:'Champion (HS50)', src:'assets/bull_legend.svg', unlockScore:50, cost:0},
  {id:'shadow', name:'Shadow (HS60)', src:'assets/bull_shadow.svg', unlockScore:60, cost:0},
];

// persistent state
let highScore = parseInt(localStorage.getItem('bull_highscore') || '0', 10);
let coinsCollected = parseInt(localStorage.getItem('bull_coins') || '0', 10);
let ownedSkins = JSON.parse(localStorage.getItem('bull_owned') || 'null') || ['default'];
let selectedSkin = localStorage.getItem('bull_selected') || 'default';

let gameRunning = false;
let frames = 0;
let score = 0;

const bird = {x:80,y:H/2,vy:0,w:48,h:36};
let gravity = 0.45, flapStrength = 8, maxFall = 12;

const pipes = [];
const coins = []; // now holds grade items (A-F)
const pipeWidth = 60;
const gapMin = 130, gapMax = 180;
const spawnInterval = 100; // frames (roughly every 1.6s at 60fps)

function saveState(){
  localStorage.setItem('bull_highscore', String(highScore));
  localStorage.setItem('bull_coins', String(coinsCollected));
  localStorage.setItem('bull_owned', JSON.stringify(ownedSkins));
  localStorage.setItem('bull_selected', selectedSkin);
}

function updateUI(){
  scoreEl.textContent = `Score: ${score}`;
  highscoreEl.textContent = `High: ${highScore}`;
  coinCountEl.textContent = `Coins: ${coinsCollected}`;
}

function applyScoreUnlocks(){
  let changed = false;
  SKINS.forEach(s => {
    if(s.unlockScore && highScore >= s.unlockScore && !ownedSkins.includes(s.id)){
      ownedSkins.push(s.id);
      changed = true;
    }
  });
  if(changed) saveState();
}

function reset(){
  bird.y = H/2; bird.vy = 0; frames = 0; score = 0;
  pipes.length = 0; coins.length = 0; gameRunning = false;
  overlay.style.display = 'block';
  overlay.textContent = 'Click or press Space to start';
  updateUI();
}

function randomGradeType(currentScore){
  // base weights (increased A weight to spawn more A grades)
  const base = { A:20, B:12, C:25, D:15, E:10, F:8 };
  // scale weights: as score increases, good grades become more likely, bad grades less likely
  const goodMultiplier = Math.min(2.0, 1 + (currentScore || 0) * 0.02);
  const badMultiplier = Math.max(0.3, 1 - (currentScore || 0) * 0.02);
  const entries = Object.entries(base).map(([g,w]) => {
    const mult = (g === 'A' || g === 'B' || g === 'C') ? goodMultiplier : badMultiplier;
    return [g, w * mult];
  });
  const total = entries.reduce((s,[,w]) => s + w, 0);
  let r = Math.random() * total;
  for(const [g,w] of entries){ if(r < w) return g; r -= w; }
  return 'C';
}

const GRADE_VALUES = { A:5, B:3, C:1, D:-2, E:-3, F:-5 };

function spawnPipe(){
  // Flappy-like pipe spawn with guaranteed passage: random gap size and a gapY
  // Scale gap difficulty: wider at start, narrower as score increases
  const difficultyFactor = Math.min(1.0, score / 40); // 0 at score 0, 1 at score 40+
  const currentGapMin = Math.floor(gapMin + (180 - gapMin) * (1 - difficultyFactor)); // 180 at start, 130 at high score
  const currentGapMax = Math.floor(gapMax + (220 - gapMax) * (1 - difficultyFactor)); // 220 at start, 180 at high score
  const gap = Math.floor(Math.random()*(currentGapMax-currentGapMin))+currentGapMin;
  const x = W + 10;

  // If a previous gap exists, constrain the new gapY so the vertical overlap
  // between intervals is at least `minOverlap` pixels. This prevents impossible walls.
  const minOverlap = 28; // pixels of required vertical overlap between consecutive gaps
  let gapY;
  if(typeof spawnPipe._prevGapY !== 'undefined'){
    const prevY = spawnPipe._prevGapY;
    const prevGap = spawnPipe._prevGap;
    // allowed gapY range derived so that overlap >= minOverlap:
    // gapY must be in [prevY + minOverlap - gap, prevY + prevGap - minOverlap]
    const low = prevY + minOverlap - gap;
    const high = prevY + prevGap - minOverlap;
    const minY = Math.max(40, Math.ceil(low));
    const maxY = Math.min(H - gap - 80, Math.floor(high));
    if(minY <= maxY){
      gapY = Math.floor(minY + Math.random() * (maxY - minY + 1));
    } else {
      // If no valid range, place gap near previous center to maximize overlap
      const center = Math.floor(prevY + (prevGap - gap)/2);
      gapY = Math.max(40, Math.min(H - gap - 80, center + Math.floor((Math.random()*21)-10)));
    }
  } else {
    gapY = Math.floor(Math.random()*(H - gap - 120))+40;
  }

  pipes.push({x, gapY, gap, w:pipeWidth, passed:false});

  // spawn a grade item: good grades inside the gap, bad grades to left/right outside pipe
  const type = randomGradeType(score);
  const value = GRADE_VALUES[type];
  const gy = gapY + 20 + Math.random()*(Math.max(0, gap - 40));
  let gx;
  if(value < 0){
    // place to left or right outside pipe to encourage avoiding horizontally
    const side = Math.random() < 0.5 ? -1 : 1;
    const offsetX = 80 + Math.random()*40;
    gx = side === -1 ? x - offsetX : x + pipeWidth + offsetX;
  } else {
    // good grades spawn inside the gap area
    gx = x + pipeWidth/2 + (Math.random()*40 - 20);
  }
  coins.push({x: gx, y: gy, r:20, collected:false, type, value, img: GRADE_IMAGES[type]});

  // remember last spawned gap for next spawn
  spawnPipe._prevGapY = gapY;
  spawnPipe._prevGap = gap;
}

function flap(){ bird.vy = -flapStrength; }

function update(){
  if(!gameRunning) return;
  frames++;
  // physics
  bird.vy += gravity;
  if(bird.vy > maxFall) bird.vy = maxFall;
  bird.y += bird.vy;

  // increase speed as score increases (makes game harder over time)
  // speed scales with progress (very gentle growth)
  if(frames % spawnInterval === 0) spawnPipe();

  // move pipes and coins
  for(let i=pipes.length-1;i>=0;i--){
    pipes[i].x -= 2.6;
    if(pipes[i].x + pipes[i].w < -50) pipes.splice(i,1);
  }
  for(let i=coins.length-1;i>=0;i--){
    coins[i].x -= 2.6;
    if(coins[i].x + coins[i].r < -50) coins.splice(i,1);
  }

  // collisions
  // ground/ceiling (ground is 60px high)
  if(bird.y + bird.h/2 >= H - 60 || bird.y - bird.h/2 <= 0){ gameOver(); }

  // pipes and scoring
  for(const p of pipes){
    const bx = bird.x, by = bird.y, bw = bird.w, bh = bird.h;
    // horizontal overlap
    if(bx + bw/2 > p.x && bx - bw/2 < p.x + p.w){
      if(by - bh/2 < p.gapY || by + bh/2 > p.gapY + p.gap) { gameOver(); }
    }
    // score when bird passes pipe
    if(!p.passed && p.x + p.w < bird.x - bw/2){ p.passed = true; score += 1; if(score > highScore){ highScore = score; saveState(); } updateUI(); }
  }

  // coins
  for(const c of coins){
    if(c.collected) continue;
    const dx = bird.x - c.x; const dy = bird.y - c.y; const dist = Math.hypot(dx,dy);
    if(dist < c.r + 10){
      c.collected = true;
      if(c.value > 0){ coinsCollected += c.value; }
      else { coinsCollected = Math.max(0, coinsCollected + c.value); }
      saveState(); updateUI();
    }
  }
}

function gameOver(){ gameRunning = false; overlay.textContent = `Game Over — Score: ${score}. Click to restart`; overlay.style.display='block'; saveState(); }

function draw(){
  // sky bg
  ctx.clearRect(0,0,W,H);
  // background hills / ground
  ctx.fillStyle = '#7fbf55'; ctx.fillRect(0,H-60,W,60);

  // pipes
  for(const p of pipes){
    ctx.fillStyle = '#1e8f4a';
    // top
    ctx.fillRect(p.x,0,p.w,p.gapY);
    // bottom
    ctx.fillRect(p.x,p.gapY + p.gap,p.w,H - (p.gapY + p.gap) - 60);
    // pipe cap
    ctx.fillStyle = '#146733';
    ctx.fillRect(p.x-4,p.gapY - 8,p.w+8,8);
    ctx.fillRect(p.x-4,p.gapY + p.gap,p.w+8,8);
  }

  // grades (A-F)
  for(const c of coins){ if(c.collected) continue; if(c.img && c.img.complete) ctx.drawImage(c.img, c.x - c.r, c.y - c.r, c.r*2, c.r*2); else {
    // fallback circle with letter
    ctx.fillStyle = c.value>0 ? '#ffd166' : '#d9534f'; ctx.beginPath(); ctx.arc(c.x,c.y,c.r,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#fff'; ctx.font='20px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(c.type, c.x, c.y);
  } }

  // bull (player)
  ctx.save();
  ctx.translate(bird.x, bird.y);
  const tilt = Math.max(Math.min(bird.vy / 12, 0.9), -0.9);
  ctx.rotate(tilt);
  ctx.drawImage(bullImg, -bird.w/2, -bird.h/2, bird.w, bird.h);
  ctx.restore();
}

function loop(){ update(); draw(); requestAnimationFrame(loop); }

// controls
window.addEventListener('keydown', e=>{ if(e.code==='Space'){ e.preventDefault(); if(!gameRunning){ startGame(); } else { flap(); } } });
canvas.addEventListener('click', ()=>{ if(!gameRunning){ startGame(); } else { flap(); } });

function startGame(){
  if(!gameRunning){
    gameRunning = true;
    overlay.style.display='none';
    // ensure an initial pipe appears immediately when starting
    if(pipes.length === 0) spawnPipe();
  }
}

// make canvas scale to fit the window while keeping aspect ratio
function resizeCanvasToWindow(){
  const scale = Math.min(window.innerWidth / baseW, window.innerHeight / baseH);
  canvas.style.width = `${Math.floor(baseW * scale)}px`;
  canvas.style.height = `${Math.floor(baseH * scale)}px`;
}

window.addEventListener('resize', resizeCanvasToWindow);

// Shop UI
function openShop(){
  renderSkins();
  shop.classList.remove('hidden');
}
function closeShopFn(){ shop.classList.add('hidden'); }

function renderSkins(){
  skinsList.innerHTML = '';
  // apply any score-based unlocks before rendering
  applyScoreUnlocks();
  SKINS.forEach(s => {
    const card = document.createElement('div'); card.className='skin-card';
    const img = document.createElement('img'); img.src = s.src; img.alt = s.name;
    const title = document.createElement('div'); title.textContent = s.name;
    const cost = document.createElement('div'); cost.className='skin-cost'; cost.textContent = s.cost > 0 ? `${s.cost} coins` : (s.unlockScore ? `Unlock at HS ${s.unlockScore}` : 'Free');
    const btn = document.createElement('button');
    const isOwned = ownedSkins.includes(s.id);
    const isLockedByScore = s.unlockScore && highScore < s.unlockScore;

    if(isOwned){
      btn.textContent = (selectedSkin===s.id)? 'Equipped' : 'Equip';
      btn.disabled = (selectedSkin===s.id);
      btn.onclick = ()=>{ selectedSkin = s.id; bullImg.src = s.src; saveState(); renderSkins(); };
    } else if(isLockedByScore){
      btn.textContent = `Locked`;
      btn.disabled = true;
    } else if(s.cost && s.cost > 0){
      btn.textContent = `Buy`;
      btn.onclick = ()=>{
        if(coinsCollected >= s.cost){ coinsCollected -= s.cost; ownedSkins.push(s.id); saveState(); updateUI(); renderSkins(); } else { alert('Not enough coins'); }
      };
    } else {
      // free and not owned (e.g., unlocked by score)
      btn.textContent = `Unlock`;
      btn.onclick = ()=>{ ownedSkins.push(s.id); saveState(); renderSkins(); };
    }
    card.appendChild(img); card.appendChild(title); card.appendChild(cost); card.appendChild(btn);
    skinsList.appendChild(card);
  });
}

shopBtn.addEventListener('click', openShop);
closeShop.addEventListener('click', closeShopFn);

// Start the render loop once the bull image is ready. Grade images load independently.
function startLoopWhenReady(){
  const skin = SKINS.find(s=>s.id===selectedSkin) || SKINS[0];
  bullImg.src = skin.src;
  if(bullImg.complete){ requestAnimationFrame(loop); }
  else { bullImg.onload = ()=> requestAnimationFrame(loop); }
}

// initial layout + start
resizeCanvasToWindow();
updateUI();
reset();
startLoopWhenReady();

// overlay click should immediately restart the game (no perceptible delay)
overlay.addEventListener('click', ()=>{
  if(!gameRunning){ reset(); startGame(); }
});
