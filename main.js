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
const coinImg = new Image();

// skins catalog
const SKINS = [
  {id:'default', name:'Default', src:'assets/bull.svg', cost:0},
  {id:'red', name:'Raging Red', src:'assets/bull_red.svg', cost:10},
  {id:'gold', name:'Golden', src:'assets/bull_gold.svg', cost:25},
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
const coins = [];
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

function reset(){
  bird.y = H/2; bird.vy = 0; frames = 0; score = 0;
  pipes.length = 0; coins.length = 0; gameRunning = false;
  overlay.style.display = 'block';
  overlay.textContent = 'Click or press Space to start';
  updateUI();
}

function spawnPipe(){
  const gap = Math.floor(Math.random()*(gapMax-gapMin))+gapMin;
  const gapY = Math.floor(Math.random()*(H - gap - 120))+40;
  const x = W + 10;
  pipes.push({x, gapY, gap, w:pipeWidth, passed:false});
  // coin in center of gap
  coins.push({x: x + pipeWidth/2, y: gapY + gap/2, r:18, collected:false});
}

function flap(){ bird.vy = -flapStrength; }

function update(){
  if(!gameRunning) return;
  frames++;
  // physics
  bird.vy += gravity;
  if(bird.vy > maxFall) bird.vy = maxFall;
  bird.y += bird.vy;

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
    if(dist < c.r + 10){ c.collected = true; coinsCollected += 1; saveState(); updateUI(); }
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

  // coins (A+ paper)
  for(const c of coins){ if(c.collected) continue; ctx.drawImage(coinImg, c.x - c.r, c.y - c.r, c.r*2, c.r*2); }

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
window.addEventListener('keydown', e=>{ if(e.code==='Space'){ e.preventDefault(); if(!gameRunning){ startGame(); } flap(); } });
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
  SKINS.forEach(s => {
    const card = document.createElement('div'); card.className='skin-card';
    const img = document.createElement('img'); img.src = s.src; img.alt = s.name;
    const title = document.createElement('div'); title.textContent = s.name;
    const cost = document.createElement('div'); cost.className='skin-cost'; cost.textContent = s.cost > 0 ? `${s.cost} coins` : 'Free';
    const btn = document.createElement('button');
    if(ownedSkins.includes(s.id)){
      btn.textContent = (selectedSkin===s.id)? 'Equipped' : 'Equip';
      btn.disabled = (selectedSkin===s.id);
      btn.onclick = ()=>{ selectedSkin = s.id; bullImg.src = s.src; saveState(); renderSkins(); };
    } else {
      btn.textContent = `Buy`;
      btn.onclick = ()=>{
        if(coinsCollected >= s.cost){ coinsCollected -= s.cost; ownedSkins.push(s.id); saveState(); updateUI(); renderSkins(); } else { alert('Not enough coins'); }
      };
    }
    card.appendChild(img); card.appendChild(title); card.appendChild(cost); card.appendChild(btn);
    skinsList.appendChild(card);
  });
}

shopBtn.addEventListener('click', openShop);
closeShop.addEventListener('click', closeShopFn);

// Start the render loop once both images are ready. Handle cached images too.
function startLoopWhenReady(){
  // set bull src based on selected skin
  const skin = SKINS.find(s=>s.id===selectedSkin) || SKINS[0];
  bullImg.src = skin.src;
  coinImg.src = 'assets/usf.svg';

  if(bullImg.complete && coinImg.complete){
    requestAnimationFrame(loop);
    return;
  }
  let loaded = 0;
  const cb = ()=>{ loaded++; if(loaded === 2) requestAnimationFrame(loop); };
  bullImg.onload = cb;
  coinImg.onload = cb;
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
