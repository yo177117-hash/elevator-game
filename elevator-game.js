/* =========================
 * Elevator Game (p5.js)
 * ========================= */

/* ---------- 외부 이미지 ---------- */
const GHOST_URLS = {
  move:   'https://gundog.dothome.co.kr/public/uploads/1.jpg?_t=1755608528',
  arrive: 'https://gundog.dothome.co.kr/public/uploads/2.gif?_t=1755609169',
  deliver:'https://gundog.dothome.co.kr/public/uploads/3.jpg?_t=1755609169',
  end:    'https://gundog.dothome.co.kr/public/uploads/4.jpg?_t=1755609169'
};
const WARN_URLS = {
  lean: 'https://gundog.dothome.co.kr/public/uploads/gi.jpg?_t=1755699175',
  hand: 'https://gundog.dothome.co.kr/public/uploads/son.jpg?_t=1755699177'
};
const BOX_URL = 'https://gundog.dothome.co.kr/public/uploads/box-1.png?_t=1755746605';

let ghostImgs = { move:null, arrive:null, deliver:null, end:null };
let warnImgs  = { lean:null, hand:null };
let boxImg    = null;

function preload() {
  Object.entries(GHOST_URLS).forEach(([k, url]) => {
    ghostImgs[k] = loadImage(url, null, () => { ghostImgs[k] = null; });
  });
  Object.entries(WARN_URLS).forEach(([k, url]) => {
    warnImgs[k] = loadImage(url, null, () => { warnImgs[k] = null; });
  });
  boxImg = loadImage(BOX_URL, null, () => { boxImg = null; });
}
function isImgReady(img){
  return img && typeof img === 'object' && 'width' in img && 'height' in img && img.width > 0 && img.height > 0;
}

/* ---------- 상태 ---------- */
let gameState = 'inElevator'; // start, deliveryList, inElevator
let deliveries = [];
let houses4 = [];
let packages  = [];

let currentFloor = 1;
let targetFloor  = null;
let elevatorMoving = false;
let elevatorDirection = '';
let doorState = 'open';
let doorProgress = 1;
let doorTimer = 0;
let moveTimer = 0;

let showDoor = false;
let doorHitbox = { x:0, y:0, w:0, h:0 };

const ambientAptByFloor = {};
let draggingIdx = -1;
let dragOffset = {x:0,y:0};

/* ---------- (간단) 효과음 ---------- */
/* 요청 사항:
   - 기존 Web Audio로 만든 ‘위잉~’ 이동음/엔딩 비명 제거
   - 이동 시 ele.wav 재생 (루프)
   - 엔딩 시 mp3 1회만 재생
*/
const MOVE_SFX_URL = 'https://gundog.dothome.co.kr/public/uploads/ele.wav?_t=1755774980';
const END_SCREAM_URL = 'https://gundog.dothome.co.kr/public/uploads/992714455D07B50C08.mp3?_t=1755769109';

let moveAudio = null;
let endScreamAudio = null;
let sfxReady = false;
let endScreamPlayed = false;

function initSfx() {
  if (sfxReady) return;
  try {
    moveAudio = new Audio(MOVE_SFX_URL);
    moveAudio.loop = true;
    // 필요 시 볼륨 조정: moveAudio.volume = 0.9;

    endScreamAudio = new Audio(END_SCREAM_URL);
    endScreamAudio.loop = false;
    // 필요 시 볼륨 조정: endScreamAudio.volume = 1.0;

    sfxReady = true;
  } catch(e) {
    // 무음 fallback
    sfxReady = false;
  }
}
function startMoveSfx(){
  if (!sfxReady) return;
  try {
    // iOS 등에서 첫 사용자 제스처 후 재생 허용
    if (moveAudio.paused) {
      moveAudio.currentTime = 0;
      moveAudio.play();
    }
  } catch(e) {}
}
function stopMoveSfx(){
  if (!sfxReady) return;
  try {
    moveAudio.pause();
    moveAudio.currentTime = 0;
  } catch(e) {}
}
function playEndScreamOnce(){
  if (!sfxReady || endScreamPlayed) return;
  endScreamPlayed = true;
  try {
    endScreamAudio.currentTime = 0;
    endScreamAudio.play();
  } catch(e) {}
}

/* ---------- 딩동벨(도어벨) ----------
   * 기존 코드 유지 (사용자 요청은 이동음/비명만 교체였음)
   * Web Audio 기반 간단 톤
*/
let audioCtx = null;
function initAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    try { audioCtx = new AC(); } catch(e) {}
  }
}
function tone(freq, t, dur=0.18, gain=0.22) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  osc.type='sine'; osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t+dur+0.02);
}
function playDingDong() {
  initAudio(); if (!audioCtx) return;
  const t = audioCtx.currentTime;
  tone(784,t); tone(659,t+0.22);
}

/* ---------- 유령/엔딩 ---------- */
let rndGhostActive = false;
let rndGhostScale = 1.0;
let rndGhostText  = "";
let rndGhostKind  = "";
let rndStartMillis = 0;

const FLICKER_DURATION_MS = 1200;
const FLICKER_INTERVAL_MS = 180;
const FLICKER_FADE_MS     = 80;

let preFlickerActive = false;
let preFlickerStart  = 0;
let preFlickerEnd    = 0;
let pendingGhostKind = null;

let pausedMovement = false;
let pausedTarget = null;

const ghostDone = { move:false, arrive:false, deliver:false };

let moveStepCount = 0;
let arriveOpenCount = 0;
let deliveryDoneCount = 0;
let moveGhostTarget = null;
let arriveGhostTarget = null;
let deliverGhostTarget = null;

let endGhostActive = false;
let endGhostScale  = 1.0;
const END_GHOST_MAX = 4.0;

/* ---------- 랜덤 타겟 ---------- */
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function planGhosts(){
  moveGhostTarget    = randInt(1,6);
  arriveGhostTarget  = randInt(1,4);
  deliverGhostTarget = randInt(1,4);
}

/* ---------- 트리거(깜빡임 → 오버레이) ---------- */
function triggerRndGhost(kind){
  if (rndGhostActive || endGhostActive || preFlickerActive) return;
  if (ghostDone[kind]) return;

  pendingGhostKind = kind;
  preFlickerActive = true;
  preFlickerStart  = millis();
  preFlickerEnd    = preFlickerStart + FLICKER_DURATION_MS;

  if (doorState!=='open'){
    doorState='opening';
    doorTimer = Math.max(1, Math.floor((1 - doorProgress) * 60));
  }
  if (kind==='move' && elevatorMoving){
    // 이동 중 유령 등장 → 이동 일시정지 + 이동 사운드 정지
    pausedMovement = true;
    pausedTarget   = targetFloor;
    elevatorMoving = false;
    elevatorDirection = '';
    stopMoveSfx();
  }
}
function beginRndOverlayFromPending() {
  if (!pendingGhostKind) return;
  rndGhostActive = true;
  rndGhostScale  = 1.0;
  rndGhostKind   = pendingGhostKind;
  rndGhostText   = (rndGhostKind==='move') ? '25HORROR'
                  : (rndGhostKind==='arrive') ? '25THRILLER'
                  : '25MYSTERY';
  rndStartMillis = millis();
  pendingGhostKind = null;
}
function stopRndGhost(){
  if (!rndGhostActive) return;
  rndGhostActive = false;
  rndGhostScale  = 1.0;
  ghostDone[rndGhostKind] = true;

  doorState='closing'; doorTimer=60;

  if (pausedMovement){
    // 유령 종료 후 재이동 + 이동 사운드 재시작
    pausedMovement=false;
    targetFloor = pausedTarget;
    if (currentFloor !== targetFloor){
      elevatorMoving=true;
      elevatorDirection = (targetFloor>currentFloor)?'↑':'↓';
      moveTimer=60;
      startMoveSfx();
    }
  }
}
function startEndGhost(){
  endGhostActive = true;
  endGhostScale  = 1.0;
  rndStartMillis = millis();
  doorState='opening';
  doorTimer = Math.max(1, Math.floor((1 - doorProgress) * 60));
  stopMoveSfx();         // 엔딩에선 이동 사운드 정지
  playEndScreamOnce();   // 엔딩 비명 1회 재생
}

/* ---------- p5 ---------- */
function setup(){
  createCanvas(960, 600).parent('game-container');
  generateGameData();
  planGhosts();
}
function draw(){
  background(20);

  drawFrame();
  drawElevator();
  drawRightPanel();

  updateElevator();

  drawPreFlicker();
  drawGhostOverlay();
}

/* ---------- UI ---------- */
function drawFrame(){
  noStroke(); fill(32); rect(20,20,200,560,6);
  stroke(80); noFill(); rect(230,20,520,560);
  noStroke(); fill(28); rect(770,20,170,560,6);
}

/* ---------- 우측 패널 & 패키지 ---------- */
function drawRightPanel(){
  const listX=785, listY=50, listW=160, listH=220;

  fill(200); textAlign(CENTER,TOP); textSize(14);
  text('배달 목록', 770+85, 30);

  fill(46); rect(listX, listY, listW, listH, 10);
  fill(255); textAlign(LEFT,TOP); textSize(14);
  let yy=listY+14;
  for (const d of houses4){
    const done = deliveries.some(x=>x.floor===d.floor && x.apt===d.apt && x.delivered && !x.isMystery);
    text(`${d.name}: ${d.floor}층, ${d.apt}호${done?' (완료)':''}`, listX+10, yy);
    yy+=22;
  }

  const packX=listX, packY=listY+listH+16, packW=listW, packH=560-(packY-20)-20;
  fill(46); rect(packX, packY, packW, packH, 10);
  fill(255); textSize(14); textAlign(LEFT,TOP);
  text('택배 보낼 것', packX+10, packY+10);

  drawPackages(packX+10, packY+40);
}

function drawPackages(baseX, baseY){
  const dx=78, dy=58;
  const slots=[
    {x:baseX,     y:baseY},
    {x:baseX,     y:baseY+dy},
    {x:baseX+dx,  y:baseY},
    {x:baseX+dx,  y:baseY+dy},
    {x:baseX,     y:baseY+dy*2},
  ];

  // 드래그 중 아닌 박스
  for (let i=0;i<packages.length;i++){
    const p=packages[i];
    if (p.dragging) continue;
    if (p.delivered) continue;               // 완료 박스 숨김
    p.x=slots[i].x; p.y=slots[i].y;
    drawOnePackage(p);
  }
  // 드래그 중 박스는 맨 위
  for (let i=0;i<packages.length;i++){
    const p=packages[i];
    if (!p.dragging) continue;
    if (p.delivered) continue;
    drawOnePackage(p);
  }
}

function drawOnePackage(p){
  let targetH = 48, targetW = 64;
  if (isImgReady(boxImg)) {
    const r = boxImg.width / boxImg.height;
    targetW = targetH * r;
  }
  p.w = targetW; p.h = targetH;
  if (p.dragging){ p.x=mouseX-dragOffset.x; p.y=mouseY-dragOffset.y; }

  if (isImgReady(boxImg)) image(boxImg, p.x, p.y, p.w, p.h);
  else { fill(210,150,80); rect(p.x,p.y,p.w,p.h,6); }

  if (!p.delivered) {
    const badgeW = Math.max(34, textWidth(p.label) + 12);
    const badgeH = 16;
    fill(0,160); rect(p.x + p.w*0.5 - badgeW/2, p.y + p.h*0.35 - badgeH/2, badgeW, badgeH, 6);
    fill(255); textAlign(CENTER,CENTER); textSize(12);
    text(p.label, p.x + p.w*0.5, p.y + p.h*0.35);
  }

  const hovered = mouseX>=p.x && mouseX<=p.x+p.w && mouseY>=p.y && mouseY<=p.y+p.h;
  if (hovered && !p.delivered && !p.dragging){
    noFill(); stroke(255,220); rect(p.x,p.y,p.w,p.h,6); noStroke();
  }
}

/* ---------- 엘리베이터/문 ---------- */
function drawElevator(){
  fill(100); rect(230,20,520,560);
  drawLeftPanel();

  const area={x:260,y:50,w:460,h:500};
  const eachW=(area.w/2)*(1-doorProgress);
  const gapX=area.x+eachW;
  const gapW=area.w-eachW*2;

  showDoor = (doorProgress>0.18);
  if (showDoor) drawApartmentDoor(gapX, area.y, gapW, area.h);

  // 문
  fill(120); stroke(200); strokeWeight(2);
  rect(area.x, area.y, eachW, area.h);
  rect(area.x+area.w-eachW, area.y, eachW, area.h);
  noStroke();

  // 스티커
  if (eachW > 5 && isImgReady(warnImgs.lean) && isImgReady(warnImgs.hand)) {
    imageMode(CENTER);
    const lcx = area.x + eachW/2;
    const lcy = area.y + area.h*0.22;
    const rcx = area.x + area.w - eachW/2;
    const rcy = lcy;

    const stickerW = Math.min(80, eachW*0.7);
    const stickerH = stickerW * (warnImgs.lean.height / warnImgs.lean.width);
    image(warnImgs.lean, lcx, lcy, stickerW, stickerH);
    image(warnImgs.hand, rcx, rcy, stickerW, stickerH);
    imageMode(CORNER);
  }
}

function drawLeftPanel(){
  fill(0); rect(35,40,150,40,6);
  fill(255,80,80); textAlign(CENTER,CENTER); textSize(18);
  text(`${currentFloor}층 ${elevatorDirection}`, 35+75, 60);

  let y=100;
  for (let i=0;i<10;i++){
    const lf=10-i, rf=20-i;
    drawButton(35,y,60,26,`${lf}`,()=>floorClick(lf));
    drawButton(105,y,60,26,`${rf}`,()=>floorClick(rf));
    y+=32;
  }
  drawButton(35,y+6,60,26,'열림',()=>{
    if(!elevatorMoving && doorState!=='open'){ doorState='opening'; doorTimer=Math.max(1,Math.floor((1-doorProgress)*60)); }
  });
  drawButton(105,y+6,60,26,'닫힘',()=>{
    if (rndGhostActive){ stopRndGhost(); return; }
    if(!endGhostActive && !elevatorMoving && doorState!=='closed'){
      doorState='closing'; doorTimer=Math.max(1,Math.floor(doorProgress)*60);
    }
  });
}

function floorClick(f){
  if (elevatorMoving) return;
  targetFloor = f;
  if (currentFloor===targetFloor){
    doorState='opening'; doorTimer=Math.max(1,Math.floor((1-doorProgress)*60));
    elevatorDirection='';
    arriveOpenCount++;
    if (!ghostDone.arrive && arriveOpenCount===arriveGhostTarget) triggerRndGhost('arrive');
    return;
  }
  if (doorState==='closed'){
    // 이동 시작 → 이동 사운드 시작
    elevatorMoving=true;
    elevatorDirection=(targetFloor>currentFloor)?'↑':'↓';
    moveTimer=60;
    startMoveSfx();
  } else {
    doorState='closing';
    doorTimer=Math.max(1,Math.floor(doorProgress)*60);
  }
}

function drawApartmentDoor(x,y,w,h){
  noStroke(); fill(48); rect(x,y,w,h);
  fill(60); rect(x,y+h-90,w,90);

  const dw=Math.min(160, w*0.7), dh=h-160;
  const dx=x+w/2-dw/2, dy=y+80;
  fill(170,140,100); rect(dx,dy,dw,dh,6);
  fill(30); rect(dx+dw-20, dy+dh/2-5, 12,10,2);

  const next = deliveries.find(d=>d.floor===currentFloor && !d.delivered && !d.isMystery);
  let showApt;
  if (next) showApt = next.apt;
  else {
    if (!ambientAptByFloor[currentFloor]) {
      const unit=(Math.floor(Math.random()*4)+1);
      ambientAptByFloor[currentFloor]=aptStr(currentFloor,unit);
    }
    showApt = ambientAptByFloor[currentFloor];
  }

  const pw=86, ph=28, px=dx+dw/2-pw/2, py=dy+26;
  fill(245,220,120); rect(px,py,pw,ph,4);
  fill(30); textAlign(CENTER,CENTER); textSize(14); text(`${showApt}`, px+pw/2, py+ph/2);

  doorHitbox = {x:dx, y:dy, w:dw, h:dh};

  fill(220); textSize(12); textAlign(CENTER,TOP);
  const hasJobs=!!next;
  text(hasJobs?'해당 층: 택배를 문으로 드래그해 놓으세요':'해당 층 배달 건이 없습니다', x+w/2, y+h-70);
}

/* ---------- 깜빡임(느리게) ---------- */
function drawPreFlicker(){
  if (!preFlickerActive) return;

  const now = millis();
  if (now >= preFlickerEnd) {
    preFlickerActive = false;
    beginRndOverlayFromPending();
    return;
  }

  const elapsed   = now - preFlickerStart;
  const periodIdx = Math.floor(elapsed / FLICKER_INTERVAL_MS);
  const within    = elapsed % FLICKER_INTERVAL_MS;

  const targetBright = (periodIdx % 2 === 0);
  const t = constrain(within / FLICKER_FADE_MS, 0, 1);
  const k = targetBright ? t : (1 - t);

  const brightAlpha = 180;
  const darkAlpha   = 200;
  const a = Math.round(brightAlpha * k + darkAlpha * (1 - k));
  fill(targetBright ? color(255, a) : color(0, a));
  rect(0,0,width,height);
}

/* ---------- 유령 오버레이 ---------- */
function drawGhostOverlay(){
  if (rndGhostActive) {
    drawFullscreenGhost(
      rndGhostKind==='move'   ? ghostImgs.move
    : rndGhostKind==='arrive' ? ghostImgs.arrive
    :                           ghostImgs.deliver,
      rndGhostText,
      2.2,
      rndGhostKind==='arrive' ? 10000 : 0,
      () => stopRndGhost(),
      true,
      null
    );
  }
  if (endGhostActive) {
    drawFullscreenGhost(
      ghostImgs.end,
      'The END',
      END_GHOST_MAX,
      0,
      () => { window.location.href='https://www.onstove.com'; },
      true,
      () => { window.location.href='https://www.onstove.com'; }
    );
  }
}
function computePulseScale(elapsedMs, base=1.0, stepGrow=0.12, stepMs=400, maxScale=1.8){
  const step = floor(elapsedMs / stepMs);
  const prevScale   = min(base + (step-1)*stepGrow, maxScale);
  const targetScale = min(base + step*stepGrow,     maxScale);
  const t = (elapsedMs % stepMs) / stepMs;
  let k;
  if (t < 0.35) { const nt = t / 0.35; k = 1 - pow(1-nt, 3); }
  else k = 1;
  return lerp(prevScale, targetScale, k);
}
function drawFullscreenGhost(img, label, maxScale, textDelayMs, onEsc, usePulse, onTextClick){
  fill(0,180); rect(0,0,width,height);

  const vw = Math.min(1280, width);
  const vh = Math.min(720, height);
  let iw=vw, ih=vh;
  if (isImgReady(img)) {
    const r = img.width / img.height;
    if (vw / vh > r) { ih = vh; iw = ih * r; }
    else            { iw = vw; ih = iw / r; }
  }

  const elapsed = millis() - rndStartMillis;
  if (usePulse) {
    rndGhostScale = computePulseScale(elapsed, 0.1, 0.5, 50, maxScale);
  } else {
    rndGhostScale = min(maxScale, rndGhostScale + 0.8);
  }

  imageMode(CENTER);
  if (isImgReady(img)) image(img, width/2, height/2, iw*rndGhostScale, ih*rndGhostScale);
  imageMode(CORNER);

  // ESC 버튼
  const escW=70, escH=32, escX=width-escW-16, escY=16;
  fill(0,180); rect(escX,escY,escW,escH,6);
  fill(255); textAlign(CENTER,CENTER); textSize(14); text('ESC', escX+escW/2, escY+escH/2);
  if (mouseIsPressed &&
      mouseX>=escX && mouseX<=escX+escW &&
      mouseY>=escY && mouseY<=escY+escH) {
    onEsc && onEsc();
  }

  // 텍스트 & 클릭
  if (elapsed >= textDelayMs) {
    const alpha = map(rndGhostScale,1.0,2.0,100,255,true);
    const ts = 42*rndGhostScale;
    textSize(ts);
    fill(255,alpha);
    textAlign(CENTER,CENTER);
    const tx = width/2;
    const ty = height/2 + 40*rndGhostScale;
    text(label, tx, ty);

    if (onTextClick) {
      const tw = textWidth(label);
      const th = ts * 1.2;
      const bx = tx - tw/2 - 8;
      const by = ty - th/2;
      const bw = tw + 16;
      const bh = th;
      if (mouseIsPressed &&
          mouseX>=bx && mouseX<=bx+bw &&
          mouseY>=by && mouseY<=by+bh) {
        onTextClick();
      }
    }
  }
}

/* ---------- 로직 ---------- */
function updateElevator(){
  if (doorState==='closing' && doorTimer>0){
    doorTimer--; doorProgress=doorTimer/60;
    if (doorTimer<=0){
      doorState='closed'; doorProgress=0;
      if (targetFloor!==null && targetFloor!==currentFloor){
        // 이동 시작 → 이동 사운드 시작
        elevatorMoving=true;
        elevatorDirection=(targetFloor>currentFloor)?'↑':'↓';
        moveTimer=60;
        startMoveSfx();
      }
    }
  } else if (doorState==='opening' && doorTimer>0){
    doorTimer--; doorProgress=1-(doorTimer/60);
    if (doorTimer<=0){ doorState='open'; doorProgress=1; }
  } else if (elevatorMoving && moveTimer>0){
    moveTimer--;
    if (moveTimer<=0){
      if (currentFloor < targetFloor) currentFloor++;
      else if (currentFloor > targetFloor) currentFloor--;
      moveStepCount++;
      if (!ghostDone.move && moveStepCount===moveGhostTarget) triggerRndGhost('move');
      moveTimer=60;
      if (currentFloor===targetFloor){
        // 도착 → 이동 정지 + 이동 사운드 정지
        elevatorMoving=false; elevatorDirection='';
        stopMoveSfx();
        doorState='opening'; doorTimer=60;
        arriveOpenCount++;
        if (!ghostDone.arrive && arriveOpenCount===arriveGhostTarget) triggerRndGhost('arrive');
      }
    }
  }
}

/* ---------- 데이터/유틸 ---------- */
function pad2(n){ return n.toString().padStart(2,'0'); }
function aptStr(f,u){ return `${f}${pad2(u)}`; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j]];} return a; }
function choice(a){ return a[Math.floor(Math.random()*a.length)]; }

function generateGameData(){
  deliveries=[]; packages=[]; houses4=[];
  for (const k in ambientAptByFloor) delete ambientAptByFloor[k];

  const names=['이수현','최은경','김민지','정해인','박지훈','홍길동','유재한','박소연','김도윤','최성민'];
  const floors=shuffle([...Array(20).keys()].map(i=>i+1));
  const used=new Set();
  while(houses4.length<4 && floors.length){
    const floor=floors.pop();
    const unit=Math.floor(Math.random()*4)+1;
    const key=`${floor}-${unit}`;
    if (used.has(key)) continue;
    used.add(key);
    houses4.push({name:choice(names), floor, apt:aptStr(floor,unit), delivered:false});
  }
  deliveries = houses4.map(h => ({...h, delivered:false, isMystery:false}));
  const mysteryTarget = choice(houses4);
  deliveries.push({name:mysteryTarget.name, floor:mysteryTarget.floor, apt:mysteryTarget.apt, delivered:false, isMystery:true});

  packages = [
    ...houses4.map(h => ({label:h.apt, floor:h.floor, apt:h.apt, isMystery:false, delivered:false, dragging:false, x:0, y:0, w:64, h:48})),
    {label:'??', floor:mysteryTarget.floor, apt:mysteryTarget.apt, isMystery:true, delivered:false, dragging:false, x:0, y:0, w:64, h:48}
  ];

  currentFloor=1; targetFloor=null;
  doorState='open'; doorProgress=1; elevatorMoving=false; elevatorDirection='';
  rndGhostActive=false; rndGhostScale=1.0; rndGhostText=''; rndGhostKind=''; pausedMovement=false; pausedTarget=null;
  endGhostActive=false; endGhostScale=1.0; endScreamPlayed=false;
  preFlickerActive=false; pendingGhostKind=null;

  moveStepCount=0; arriveOpenCount=0; deliveryDoneCount=0;
  ghostDone.move=false; ghostDone.arrive=false; ghostDone.deliver=false;

  // 혹시 남아있을 수 있는 이동 사운드 정지
  stopMoveSfx();
}

/* ---------- 드래그/클릭 ---------- */
function mousePressed(){
  if (preFlickerActive || rndGhostActive || endGhostActive) return;

  // 첫 사용자 제스처 시점에 오디오 초기화
  initSfx();
  initAudio();

  // 클릭한 패키지 찾기(맨 위부터)
  for (let i=packages.length-1;i>=0;i--){
    const p=packages[i];
    if (p.delivered) continue;
    if (mouseX>=p.x && mouseX<=p.x+p.w && mouseY>=p.y && mouseY<=p.y+p.h){

      // 모든 일반 배송 완료 후 ?? 클릭 → 즉시 엔딩
      if (p.isMystery) {
        const normalsDone = deliveries.every(d => d.isMystery || d.delivered);
        if (normalsDone && !endGhostActive) {
          p.delivered = true;
          const found=deliveries.find(d=>d.isMystery && !d.delivered);
          if (found) found.delivered=true;
          startEndGhost();
          return;
        }
      }

      // 그 외는 드래그
      draggingIdx=i; p.dragging=true;
      dragOffset.x=mouseX-p.x; dragOffset.y=mouseY-p.y;
      break;
    }
  }
}
function mouseReleased(){
  _justClicked = false;
  if (preFlickerActive || rndGhostActive || endGhostActive) return;

  if (draggingIdx===-1) return;
  const p=packages[draggingIdx]; p.dragging=false;

  const inDoor = mouseX>=doorHitbox.x && mouseX<=doorHitbox.x+doorHitbox.w &&
                 mouseY>=doorHitbox.y && mouseY<=doorHitbox.y+doorHitbox.h;

  if (doorState==='open' && showDoor && inDoor && currentFloor===p.floor){
    if (!p.isMystery && !p.delivered){
      p.delivered=true; // 완료 즉시 숨김
      const order=deliveries.find(d=>!d.delivered && !d.isMystery && d.floor===p.floor && d.apt===p.apt);
      if (order) order.delivered=true;
      const h=houses4.find(h=>h.floor===p.floor && h.apt===p.apt);
      if (h) h.delivered = deliveries.some(d=>d.floor===h.floor && d.apt===h.apt && d.delivered && !d.isMystery);
      playDingDong();

      deliveryDoneCount++;
      if (!ghostDone.deliver){
        if (!deliverGhostTarget) deliverGhostTarget = randInt(1,4);
        if (deliveryDoneCount===deliverGhostTarget) triggerRndGhost('deliver');
      }
    }
  }
  draggingIdx=-1;
}

/* ---------- ESC ---------- */
function keyPressed(){
  if (keyCode === 27 && rndGhostActive) stopRndGhost();
  if (keyCode === 27 && endGhostActive) { window.location.href='https://www.onstove.com'; }
}

/* ---------- 버튼 유틸 ---------- */
let _justClicked = false;
function drawButton(x,y,w,h,label,onClick){
  const hover = mouseX>x && mouseX<x+w && mouseY>y && mouseY<y+h;
  fill(hover?150:100); rect(x,y,w,h,6);
  fill(255); textAlign(CENTER,CENTER); textSize(12);
  text(label, x+w/2, y+h/2);
  if (hover && mouseIsPressed && !_justClicked) {
    _justClicked = true;
    onClick();
  }
}
