// ========== 외부 이미지 ==========
const GHOST_URLS = {
  move:   'https://gundog.dothome.co.kr/public/uploads/1.jpg?_t=1755608528',
  arrive: 'https://gundog.dothome.co.kr/public/uploads/2.gif?_t=1755609169',
  deliver:'https://gundog.dothome.co.kr/public/uploads/3.jpg?_t=1755609169',
  end:    'https://gundog.dothome.co.kr/public/uploads/4.jpg?_t=1755609169'
};
let ghostImgs = { move:null, arrive:null, deliver:null, end:null };
function loadGhostImagesNoCORS() {
  Object.entries(GHOST_URLS).forEach(([k, url]) => {
    loadImage(url, (img) => { ghostImgs[k] = img; }, () => { ghostImgs[k] = null; });
  });
}

// ========== 상태 ==========
let gameState = 'start'; // start, deliveryList, inElevator
let deliveries = []; // 4 유니크 + 1 미스터리
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

// 드래그
let draggingIdx = -1;
let dragOffset = {x:0,y:0};

// 띵동
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

// 랜덤 귀신 관련
let rndGhostActive = false;
let rndGhostScale = 1.0;
let rndGhostGrow  = 0.012;
let rndGhostText  = ""; 
let rndGhostKind  = ""; 

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
const END_GHOST_MAX = 3.2;
let endGhostGrow   = 0.022;

function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function planGhosts(){
  moveGhostTarget    = randInt(1,6);
  arriveGhostTarget  = randInt(1,4);
  deliverGhostTarget = randInt(1,4);
}

function triggerRndGhost(kind){
  if (rndGhostActive || endGhostActive) return;
  if (ghostDone[kind]) return;

  rndGhostActive = true;
  rndGhostScale  = 1.0;
  rndGhostKind   = kind;
  rndGhostText   = (kind==='move') ? '공' : (kind==='arrive') ? '포' : '게임';

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
  endGhostActive = true;
  endGhostScale  = 1.0;
  doorState='opening';
  doorTimer = Math.max(1, Math.floor((1 - doorProgress) * 60));
}
function tryEndGhostAutoRedirect(){
  if (endGhostActive && endGhostScale >= END_GHOST_MAX){
    window.location.href = 'https://www.onstove.com';
  }
}

// p5
function setup(){
  createCanvas(960, 600).parent('game-container');
  loadGhostImagesNoCORS();
}
function draw(){
  background(20);
  if (gameState==='start') drawStartScreen();
  else if (gameState==='deliveryList') drawDeliveryList();
  else if (gameState==='inElevator'){ drawFrame(); drawElevator(); drawRightPanel(); }
  updateElevator();
}

// ... (중간: UI, 엘리베이터, 귀신, 데이터, 드래그 등 네가 준 코드 동일)
// ⚠️ 길어서 생략했지만, 위에 내가 준 완성본과 같은 로직 그대로야.

// 버튼 (디바운스)
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
function mouseReleased(){
  _justClicked = false;
  // ... (드래그 해제 처리 포함)
}
function keyPressed(){
  if (keyCode === 27 && rndGhostActive) stopRndGhost();
}
