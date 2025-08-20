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
let ghostImgs = { move:null, arrive:null, deliver:null, end:null };

// p5는 preload() 안에서 로드하면 setup 전에 보장됨
function preload() {
  Object.entries(GHOST_URLS).forEach(([k, url]) => {
    ghostImgs[k] = loadImage(url, null, () => { ghostImgs[k] = null; });
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
// 랜덤 유령(3종) — 천천히 커짐, 최대 도달 뒤에만 글씨 노출
let rndGhostActive = false;
let rndGhostScale  = 1.0;
let rndGhostGrow   = 0.012;   // 천천히
const RND_GHOST_MAX = 2.2;    // 랜덤 유령 최대 스케일
let rndGhostText   = "";       // "horror","thriller","mystery"
let rndGhostKind   = "";       // move|arrive|deliver

let pausedMovement = false;
let pausedTarget = null;

const ghostDone = { move:false, arrive:false, deliver:false };

// 언제 터뜨릴지 랜덤 타이밍
let moveStepCount = 0;
let arriveOpenCount = 0;
let deliveryDoneCount = 0;
let moveGhostTarget = null;
let arriveGhostTarget = null;
let deliverGhostTarget = null;

// 엔딩 유령(4번 이미지) — “즉시” 크게, 이미지 클릭 시 이동
let endGhostActive = false;
let endGhostScale  = 1.0;
const END_GHOST_MAX = 4.0;   // 즉시 이 크기로
let endGhostGrow   = 0.012;  // (엔딩은 사용 안 하지만 유지)
let endGhostHitbox = {x:0,y:0,w:0,h:0}; // 클릭 판정에 사용

function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function planGhosts(){
  // 각 타입 한 번씩, “언제 나올지”만 랜덤
  moveGhostTarget    = randInt(1,6);  // 이동 스텝 중
  arriveGhostTarget  = randInt(1,4);  // 문 열림 횟수 중
  deliverGhostTarget = randInt(1,4);  // 정상 배송 완료 횟수 중
}

function triggerRndGhost(kind){
  if (rndGhostActive || endGhostActive) return;
  if (ghostDone[kind]) return;

  rndGhostActive = true;
  rndGhostScale  = 1.0;
  rndGhostKind   = kind;
  rndGhostText   = (kind==='move') ? 'horror' : (kind==='arrive') ? 'thriller' : 'mystery';

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
  // 엔딩 유령은 “즉시” 크게
  endGhostActive = true;
  endGhostScale  = END_GHOST_MAX;
  // 문은 열려 있어야 보임
  doorState='opening';
  doorTimer = Math.max(1, Math.floor((1 - doorProgress) * 60));
}

/* ---------- p5 ---------- */
function setup(){
  createCanvas(960, 600).parent('game-container');
}
function draw(){
  background(20);
  if (gameState==='start') drawStartScreen();
  else if (gameState==='deliveryList') drawDeliveryList();
  else if (gameState==='inElevator'){ drawFrame(); drawElevator(); drawRightPanel(); }
  updateElevator();
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
  noStroke(); fill(32); rect(20,20,200,560,6);
  stroke(80); noFill(); rect(230,20,520,560);
  noStroke(); fill(28); rect(770,20,170,560,6);
}

/* ---------- 우측 패널 ---------- */
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
  fill(100); rect(230,20,520,560);
  drawLeftPanel();

  const area={x:260,y:50,w:460,h:500};
  const eachW=(area.w/2)*(1-doorProgress);
  const gapX=area.x+eachW;
  const gapW=area.w-eachW*2;

  showDoor = (doorProgress>0.18);
  if (showDoor) drawApartmentDoor(gapX, area.y, gapW, area.h);

  // 유령은 문 틈 기준으로 그림
  if (rndGhostActive) drawRndGhost();
  if (endGhostActive) drawEndGhost();

  // 엘리베이터 문 (마지막에 그려 문으로 가림)
  fill(120); stroke(200); strokeWeight(2);
  rect(area.x, area.y, eachW, area.h);
  rect(area.x+area.w-eachW, area.y, eachW, area.h);
  noStroke();
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

  doorHitbox = {x:dx,y:dy,w:dw,h:dh};

  fill(220); textSize(12); textAlign(CENTER,TOP);
  const hasJobs=!!next;
  text(hasJobs?'해당 층: 택배를 문으로 드래그해 놓으세요':'해당 층 배달 건이 없습니다', x+w/2, y+h-70);
}

/* ---------- 유령 ---------- */
function drawGhostImageOrFallback(img,cx,cy,scaleV,txt,baseW,baseH){
  if (isImgReady(img)) {
    try{
      imageMode(CENTER);
      image(img, cx, cy, baseW * scaleV, baseH * scaleV);
      imageMode(CORNER);
    }catch(e){
      drawGhostFallback(cx,cy,scaleV);
    }
  } else {
    drawGhostFallback(cx,cy,scaleV);
  }
  if (txt) {
    const alpha = map(scaleV,1.0, RND_GHOST_MAX, 100, 255, true);
    fill(255,alpha); textAlign(CENTER,CENTER); textSize(32*scaleV);
    text(txt, cx, cy+40*scaleV);
  }
}
function drawGhostFallback(cx,cy,scaleV){
  push();
  translate(cx, cy);
  scale(scaleV);
  noStroke();
  fill(230);
  ellipse(0, -10, 120, 140);
  rect(-60, 40, 120, 120, 20);
  pop();
}
function drawRndGhost(){
  if (doorProgress < 0.2) return;
  const cx = doorHitbox.x + doorHitbox.w/2;
  const cy = doorHitbox.y + doorHitbox.h*0.52;
  const baseW = doorHitbox.w * 0.9;
  const baseH = doorHitbox.h * 0.9;

  rndGhostScale = Math.min(RND_GHOST_MAX, rndGhostScale + rndGhostGrow);

  const img = (rndGhostKind==='move') ? ghostImgs.move
           : (rndGhostKind==='arrive') ? ghostImgs.arrive
           : ghostImgs.deliver;

  // 최대 크기에 도달하기 전까지는 글씨 숨김
  const showText = (rndGhostScale >= RND_GHOST_MAX);
  drawGhostImageOrFallback(img, cx, cy, rndGhostScale, showText ? rndGhostText : '', baseW, baseH);
}
function drawEndGhost(){
  if (doorProgress < 0.2) return;
  const cx = doorHitbox.x + doorHitbox.w/2;
  const cy = doorHitbox.y + doorHitbox.h*0.52;
  const baseW = doorHitbox.w * 1.2;
  const baseH = doorHitbox.h * 1.2;

  // 엔딩은 즉시 최대 스케일(END_GHOST_MAX)으로 고정 표시
  const s = END_GHOST_MAX;
  drawGhostImageOrFallback(ghostImgs.end, cx, cy, s, '', baseW, baseH); // 글씨는 없음

  // 클릭 판정용 hitbox 저장
  endGhostHitbox = {
    x: cx - (baseW * s) / 2,
    y: cy - (baseH * s) / 2,
    w: baseW * s,
    h: baseH * s
  };
}

/* ---------- 로직 ---------- */
function updateElevator(){
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
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function choice(a){ return a[Math.floor(Math.random()*a.length)]; }

function generateGameData(){
  deliveries=[]; packages=[]; houses4=[];
  for (const k in ambientAptByFloor) delete ambientAptByFloor[k];

  const names=['박지훈','최은경','정해인','김민지','이수현','홍길동','유재한','박소연','김도윤','최성민'];
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
  endGhostActive=false; endGhostScale=1.0; endGhostHitbox={x:0,y:0,w:0,h:0};

  moveStepCount=0; arriveOpenCount=0; deliveryDoneCount=0;
  ghostDone.move=false; ghostDone.arrive=false; ghostDone.deliver=false;
}

/* ---------- 드래그/클릭 ---------- */
function mousePressed(){
  // 엔딩 유령 클릭 → 이동
  if (endGhostActive && endGhostHitbox.w>0 && endGhostHitbox.h>0) {
    const mx = mouseX, my = mouseY;
    const b = endGhostHitbox;
    if (mx>=b.x && mx<=b.x+b.w && my>=b.y && my<=b.y+b.h) {
      window.location.href = 'https://www.onstove.com';
      return;
    }
  }

  if (gameState!=='inElevator') return;
  initAudio();
  if (rndGhostActive) return;

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

  if (draggingIdx===-1) return;
  const p=packages[draggingIdx]; p.dragging=false;

  const inDoor = mouseX>=doorHitbox.x && mouseX<=doorHitbox.x+doorHitbox.w &&
                 mouseY>=doorHitbox.y && mouseY<=doorHitbox.y+doorHitbox.h;

  if (doorState==='open' && showDoor && inDoor && currentFloor===p.floor){
    if (p.isMystery){
      // 엔딩 조건: 일반 배달 전부 완료 + 세 랜덤 유령 모두 나옴
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

/* ---------- ESC로 유령 닫기 & 버튼 디바운스 ---------- */
function keyPressed(){
  if (keyCode === 27 && rndGhostActive) stopRndGhost();
}
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
