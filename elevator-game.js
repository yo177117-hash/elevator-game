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
  lean: 'https://gundog.dothome.co.kr/public/uploads/gi.jpg?_t=1755699175',   // 기대지마세요
  hand: 'https://gundog.dothome.co.kr/public/uploads/son.jpg?_t=1755699177'   // 손대지마세요
};

let ghostImgs = { move:null, arrive:null, deliver:null, end:null };
let warnImgs  = { lean:null, hand:null };

// p5는 preload() 안에서 로드하면 setup 전에 모두 보장됨
function preload() {
  Object.entries(GHOST_URLS).forEach(([k, url]) => {
    ghostImgs[k] = loadImage(url, null, () => { ghostImgs[k] = null; });
  });
  Object.entries(WARN_URLS).forEach(([k, url]) => {
    warnImgs[k] = loadImage(url, null, () => { warnImgs[k] = null; });
  });
}
function isImgReady(img){
  return img && typeof img === 'object' && 'width' in img && 'height' in img && img.width > 0 && img.height > 0;
}

/* ---------- 상태 ---------- */
let gameState = 'start'; // start, deliveryList, inElevator
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

/* ---------- 사운드 ---------- */
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
// 오버레이(랜덤 유령)
let rndGhostActive = false;
let rndGhostScale = 1.0;
let rndGhostText  = "";              // "공","포","게임"
let rndGhostKind  = "";              // move|arrive|deliver
let rndStartMillis = 0;              // 오버레이 시작시간 (ms)

// 오버레이 직전 깜빡임(플리커)
let preFlickerActive = false;
let preFlickerEnd = 0;               // millis() 값
let pendingGhostKind = null;         // 깜빡임 끝나면 띄울 대상

let pausedMovement = false;
let pausedTarget = null;

const ghostDone = { move:false, arrive:false, deliver:false };

let moveStepCount = 0;
let arriveOpenCount = 0;
let deliveryDoneCount = 0;
let moveGhostTarget = null;
let arriveGhostTarget = null;
let deliverGhostTarget = null;

// 엔딩 유령
let endGhostActive = false;
let endGhostScale  = 1.0;
const END_GHOST_MAX = 4.0;

/* ---------- 랜덤 타겟 ---------- */
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function planGhosts(){
  // 3번 전부 랜덤으로 등장하도록 목표 카운터 랜덤
  moveGhostTarget    = randInt(1,6);
  arriveGhostTarget  = randInt(1,4);
  deliverGhostTarget = randInt(1,4);
}

/* ---------- 트리거(깜빡임 → 오버레이) ---------- */
function triggerRndGhost(kind){
  // 이미 진행 중/엔딩 중이거나 해당 종류를 이미 봤으면 스킵
  if (rndGhostActive || endGhostActive || preFlickerActive) return;
  if (ghostDone[kind]) return;

  // 깜빡임 세팅(0.8s)
  pendingGhostKind = kind;
  preFlickerActive = true;
  preFlickerEnd = millis() + 600;

  // 문 열기·이동 일시정지 등은 지금 처리(깜빡임 중 동시에 진행)
  if (doorState!=='open'){
    doorState='opening';
    doorTimer = Math.max(1, Math.floor((1 - doorProgress) * 60));
  }
  if (kind==='move' && elevatorMoving){
    pausedMovement = true;
    pausedTarget   = targetFloor;
    elevatorMoving = false;
    elevatorDirection = '';
  }
}

function beginRndOverlayFromPending() {
  if (!pendingGhostKind) return;
  rndGhostActive = true;
  rndGhostScale  = 1.0;
  rndGhostKind   = pendingGhostKind;
  rndGhostText   = (rndGhostKind==='move') ? '25horror' : (rndGhostKind==='arrive') ? '25thriller' : '25mystery';
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
    pausedMovement=false;
    targetFloor = pausedTarget;
    if (currentFloor !== targetFloor){
      elevatorMoving=true;
      elevatorDirection = (targetFloor>currentFloor)?'↑':'↓';
      moveTimer=60;
    }
  }
}
function startEndGhost(){
  endGhostActive = true;
  endGhostScale  = 1.0;
  rndStartMillis = millis();
  doorState='opening';
  doorTimer = Math.max(1, Math.floor((1 - doorProgress) * 60));
}

/* ---------- p5 ---------- */
function setup(){
  // 게임 캔버스는 기존 크기 유지
  createCanvas(960, 600).parent('game-container');
}
function draw(){
  background(20);

  // 1) 프레임, 우측패널 먼저 (항상 뒤)
  drawFrame();
  drawRightPanel();

  // 2) 엘리베이터와 문
  drawElevator();

  // 3) 이동 로직 업데이트
  updateElevator();

  // 4) 깜빡임 → (끝나면) 오버레이
  drawPreFlicker();
  drawGhostOverlay();
}

/* ---------- 화면 UI ---------- */
function drawStartScreen(){
  fill(50); rect(width/2-150, height/2-200, 300, 400, 20);
  fill(255); textAlign(CENTER,CENTER); textSize(28);
  text('택배원의 하루', width/2, height/2-120);
  drawButton(width/2-70, height/2+100, 140, 45, '게임 시작', () => {
    generateGameData(); planGhosts(); gameState='deliveryList';
  });
}
function drawDeliveryList(){
  fill(50); rect(width/2-180, height/2-220, 360, 440, 20);
  fill(255); textAlign(CENTER,TOP); textSize(22);
  text('배달 목록(미리보기)', width/2, height/2-200);
  textSize(16);
  const y0 = height/2-160;
  for (let i=0;i<houses4.length;i++){
    const d = houses4[i];
    text(`${d.name}: ${d.floor}층, ${d.apt}호`, width/2, y0 + i*28);
  }
  drawButton(width/2-70, height/2+160, 140, 45, '배달 시작', () => gameState='inElevator');
}
function drawFrame(){
  if (gameState==='start' || gameState==='deliveryList') {
    drawStartOrListFrame();
    return;
  }
  noStroke(); fill(32); rect(20,20,200,560,6);
  stroke(80); noFill(); rect(230,20,520,560);
  noStroke(); fill(28); rect(770,20,170,560,6);
}
function drawStartOrListFrame(){
  noStroke(); fill(32); rect(20,20,200,560,6);
  stroke(80); noFill(); rect(230,20,520,560);
  noStroke(); fill(28); rect(770,20,170,560,6);

  if (gameState==='start')       drawStartScreen();
  else if (gameState==='deliveryList') drawDeliveryList();
}

/* ---------- 우측 패널 ---------- */
function drawRightPanel(){
  if (gameState!=='inElevator') return;

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
  const dx=68, dy=40;
  const slots=[
    {x:baseX, y:baseY},
    {x:baseX, y:baseY+dy},
    {x:baseX+dx, y:baseY},
    {x:baseX+dx, y:baseY+dy},
    {x:baseX, y:baseY+dy*2},
  ];
  for (let i=0;i<packages.length;i++){
    const p=packages[i];
    if(!p.dragging){ p.x=slots[i].x; p.y=slots[i].y; }
    const hovered = mouseX>=p.x && mouseX<=p.x+p.w && mouseY>=p.y && mouseY<=p.y+p.h;
    if (p.delivered) fill(80); else fill(230,140,60);
    rect(p.x,p.y,p.w,p.h,6);
    fill(255); textAlign(CENTER,CENTER); textSize(13);
    text(p.label, p.x+p.w/2, p.y+p.h/2);
    if (p.dragging){ p.x=mouseX-dragOffset.x; p.y=mouseY-dragOffset.y; }
    if (hovered && !p.delivered){ noFill(); stroke(255,220); rect(p.x,p.y,p.w,p.h,6); noStroke(); }
  }
}

/* ---------- 엘리베이터/문 ---------- */
function drawElevator(){
  if (gameState!=='inElevator') return;

  fill(100); rect(230,20,520,560);
  drawLeftPanel();

  const area={x:260,y:50,w:460,h:500};
  const eachW=(area.w/2)*(1-doorProgress);
  const gapX=area.x+eachW;
  const gapW=area.w-eachW*2;

  showDoor = (doorProgress>0.18);
  if (showDoor) drawApartmentDoor(gapX, area.y, gapW, area.h);

  // 엘리베이터 문(먼저 칠)
  fill(120); stroke(200); strokeWeight(2);
  rect(area.x, area.y, eachW, area.h);                       // 왼쪽
  rect(area.x+area.w-eachW, area.y, eachW, area.h);          // 오른쪽
  noStroke();

  // 문이 보일 때 스티커 표시(거의 닫혀 있거나 닫히는 중 포함)
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
  if (gameState!=='inElevator') return;
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
    elevatorMoving=true;
    elevatorDirection=(targetFloor>currentFloor)?'↑':'↓';
    moveTimer=60;
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

/* ---------- 깜빡임 ---------- */
function drawPreFlicker(){
  if (!preFlickerActive) return;

  // 어둡게 → 밝게를 빠르게 랜덤 반복
  const remain = preFlickerEnd - millis();
  if (remain <= 0) {
    preFlickerActive = false;
    beginRndOverlayFromPending();
    return;
  }

  // 60~120ms 주기로 밝기 변화
  const period = 60 + (frameCount % 2) * 40;
  const phase = (frameCount % Math.floor(period/16));
  const isBright = phase < 2 || random() < 0.1;

  // 화면 덮는 플래시
  if (isBright) fill(255, 200);
  else fill(0, 200);
  rect(0,0,width,height);
}

/* ---------- 유령 오버레이 (맨 마지막) ---------- */
function drawGhostOverlay(){
  // 랜덤 유령
  if (rndGhostActive) {
    drawFullscreenGhost(
      rndGhostKind==='move'   ? ghostImgs.move
    : rndGhostKind==='arrive' ? ghostImgs.arrive
    :                           ghostImgs.deliver,
      rndGhostText,
      2.2,                // 최대 스케일
      rndGhostKind==='arrive' ? 10000 : 0,  // 2번(GIF) 자막 10초 지연
      () => stopRndGhost(),
      true                // pulse 모드 사용 (계단식 확대)
    );
  }

  // 엔딩 유령
  if (endGhostActive) {
    drawFullscreenGhost(
      ghostImgs.end,
      '게임',
      END_GHOST_MAX,
      0,
      () => { window.location.href='https://www.onstove.com'; },
      true                // 엔딩도 펄스 확대로 연출
    );
  }
}

// 계단식(펄스) 스케일 계산
function computePulseScale(elapsedMs, base=1.0, stepGrow=0.12, stepMs=280, maxScale=2.2){
  const step = floor(elapsedMs / stepMs);                 // 몇 번 '땅' 했는지
  const prevScale = min(base + (step-1)*stepGrow, maxScale);
  const targetScale = min(base + step*stepGrow, maxScale);

  // 스텝 내 진행도(0~1)
  const t = (elapsedMs % stepMs) / stepMs;

  // 초반 35%만 빠르게 치고 올라가고 이후 hold (ease-out 느낌)
  let k;
  if (t < 0.35) {
    const nt = t / 0.35;
    k = 1 - pow(1-nt, 3); // cubic easeOut
  } else {
    k = 1;
  }
  return lerp(prevScale, targetScale, k);
}

function drawFullscreenGhost(img, label, maxScale, textDelayMs, onEsc, usePulse){
  // 배경 반투명
  fill(0,180); rect(0,0,width,height);

  // 원본비 유지 + 최대 1920x1080
  const vw = Math.min(1920, width);
  const vh = Math.min(1080, height);
  let iw=vw, ih=vh;
  if (isImgReady(img)) {
    const r = img.width / img.height;
    if (vw / vh > r) { ih = vh; iw = ih * r; }
    else            { iw = vw; ih = iw / r; }
  }

  // 스케일: 펄스(계단식) or 유지
  const elapsed = millis() - rndStartMillis;
  if (usePulse) {
    rndGhostScale = computePulseScale(elapsed, 1.0, 0.12, 400, maxScale);
  } else {
    rndGhostScale = min(maxScale, rndGhostScale + 0.02);
  }

  // 중앙 배치
  imageMode(CENTER);
  if (isImgReady(img)) image(img, width/2, height/2, iw*rndGhostScale, ih*rndGhostScale);
  imageMode(CORNER);

  // ESC 버튼 (우상단)
  const escW=70, escH=32, escX=width-escW-16, escY=16;
  fill(0,180); rect(escX,escY,escW,escH,6);
  fill(255); textAlign(CENTER,CENTER); textSize(14); text('ESC', escX+escW/2, escY+escH/2);
  if (mouseIsPressed &&
      mouseX>=escX && mouseX<=escX+escW &&
      mouseY>=escY && mouseY<=escY+escH) {
    onEsc();
  }

  // 자막(지연 적용)
  if (elapsed >= textDelayMs) {
    const alpha = map(rndGhostScale,1.0,2.0,100,255,true);
    fill(255,alpha); textAlign(CENTER,CENTER); textSize(32*rndGhostScale);
    text(label, width/2, height/2 + 40*rndGhostScale);
  }
}

/* ---------- 로직 ---------- */
function updateElevator(){
  if (gameState!=='inElevator') return;

  if (doorState==='closing' && doorTimer>0){
    doorTimer--; doorProgress=doorTimer/60;
    if (doorTimer<=0){
      doorState='closed'; doorProgress=0;
      if (targetFloor!==null && targetFloor!==currentFloor){
        elevatorMoving=true;
        elevatorDirection=(targetFloor>currentFloor)?'↑':'↓';
        moveTimer=60;
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
        elevatorMoving=false; elevatorDirection='';
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
    ...houses4.map(h => ({label:h.apt, floor:h.floor, apt:h.apt, isMystery:false, delivered:false, dragging:false, x:0, y:0, w:60, h:26})),
    {label:'??', floor:mysteryTarget.floor, apt:mysteryTarget.apt, isMystery:true, delivered:false, dragging:false, x:0, y:0, w:60, h:26}
  ];

  currentFloor=1; targetFloor=null;
  doorState='open'; doorProgress=1; elevatorMoving=false; elevatorDirection='';
  rndGhostActive=false; rndGhostScale=1.0; rndGhostText=''; rndGhostKind=''; pausedMovement=false; pausedTarget=null;
  endGhostActive=false; endGhostScale=1.0;
  preFlickerActive=false; pendingGhostKind=null;

  moveStepCount=0; arriveOpenCount=0; deliveryDoneCount=0;
  ghostDone.move=false; ghostDone.arrive=false; ghostDone.deliver=false;
}

/* ---------- 드래그 ---------- */
function mousePressed(){
  if (preFlickerActive || rndGhostActive || endGhostActive) return; // 오버레이/깜빡임 중엔 드래그 금지
  if (gameState!=='inElevator') return;
  initAudio();
  for (let i=packages.length-1;i>=0;i--){
    const p=packages[i];
    if (p.delivered) continue;
    if (mouseX>=p.x && mouseX<=p.x+p.w && mouseY>=p.y && mouseY<=p.y+p.h){
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
    if (p.isMystery){
      const normalsDone = deliveries.every(d => d.isMystery || d.delivered);
      const allRndDone  = ghostDone.move && ghostDone.arrive && ghostDone.deliver;
      if (normalsDone && allRndDone && !endGhostActive){
        p.delivered=true;
        const found=deliveries.find(d=>d.isMystery && !d.delivered);
        if (found) found.delivered=true;
        startEndGhost();
      }
    } else {
      if (!p.delivered){
        p.delivered=true;
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
