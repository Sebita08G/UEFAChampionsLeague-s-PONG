const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const WIN_SCORE = 10;

// Coordenadas provisionales del campo (canvas: 960 x 540).
// Se ajustarán con F3 activado cuando midamos el césped del estadio.
const FIELD = { left: 32, right: 930, top: 170, bottom: 470 };
const GOAL = {
  left: { x: 8, y: 238, width: 83, height: 151 },
  right: { x: 870, y: 240, width: 80, height: 150 }
};
let debugHitboxes = false;
let pointerPosition = { x: 0, y: 0 };

const HALF_SECONDS = 150;
const TOTAL_SECONDS = HALF_SECONDS * 2;
const SPRITE_COLUMNS = 5;
const SPRITE_ROWS = 3;

const PROJECT_BASE = new URL("./", document.baseURI);
const CLUBS_INDEX = new URL("images/clubs/clubs.json", PROJECT_BASE);

const ASSET = {
  stage: "images/stages/stadium.png",
  ball: "images/items/ball.png",
  menuMusic: "audio/music/main_menu.mp3",
  goal: "audio/sounds/GOAL.mp3",
  missed: "audio/sounds/MISSED.mp3",
  kick: "audio/sounds/kick.mp3",
  crowd: "audio/sounds/afition.mp3"
};

const screens = {
  intro: document.getElementById("introScreen"),
  menu: document.getElementById("mainMenu"),
  clubs: document.getElementById("clubScreen"),
  game: document.getElementById("gameScreen")
};

const imageCache = new Map();
const audio = {
  menu: new Audio(ASSET.menuMusic),
  goal: new Audio(ASSET.goal),
  missed: new Audio(ASSET.missed),
  kick: new Audio(ASSET.kick),
  crowd: new Audio(ASSET.crowd)
};
audio.menu.loop = true;
audio.crowd.loop = true;
audio.menu.volume = 0.45;
audio.crowd.volume = 0.28;
audio.goal.volume = 0.8;
audio.kick.volume = 0.55;
audio.missed.volume = 0.5;

let clubs = [];
let gameMode = "cpu";
let cpuDifficulty = "professional";

const CPU_DIFFICULTIES = {
  amateur: { reactionSeconds: 0.40 },
  professional: { reactionSeconds: 0.27 },
  legend: { reactionSeconds: 0.20 }
};

function getCpuReactionFrames() {
  return CPU_DIFFICULTIES[cpuDifficulty].reactionSeconds * 60;
}
let selectedTeams = [];
let matchTeams = [];
let score = [0, 0];
let remainingTime = TOTAL_SECONDS;
let currentHalf = 1;
let matchState = "stopped";
let keys = {};
let lastFrame = 0;
let animationFrame = 0;
let ballFrame = 0;
let ballFrameTimer = 0;
let lastScoringTeam = null;
let kickoffTeam = 0;
let goalPauseRemaining = 0;
let cpuKickoffTimer = 0;
let goalPauseScorer = null;

const stageImage = loadImage(ASSET.stage);
const ballImage = loadImage(ASSET.ball);

function loadImage(src) {
  if (!imageCache.has(src)) {
    const img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return imageCache.get(src);
}

function playSound(name) {
  const sound = audio[name];
  if (!sound) return;
  sound.currentTime = 0;
  sound.play().catch(() => {});
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, element]) => {
    element.classList.toggle("hidden", key !== name);
  });
}

function startMenuMusic() {
  audio.crowd.pause();
  audio.menu.play().catch(() => {});
}

function startMatchMusic() {
  // Durante el partido solo suena la afición; no se reproduce champions.mp3.
  audio.menu.pause();
  audio.crowd.currentTime = 0;
  audio.crowd.play().catch(() => {});
}

async function loadClubs() {
  const hint = document.getElementById("selectionHint");
  const startButton = document.getElementById("startMatch");
  startButton.disabled = true;
  hint.textContent = "Cargando clubes...";

  const indexResponse = await fetch(CLUBS_INDEX.href, { cache: "no-store" });
  if (!indexResponse.ok) throw new Error(`No se pudo leer clubs.json (HTTP ${indexResponse.status}). Comprueba que ejecutas el juego desde un servidor web y no abriendo index.html como archivo.`);

  const indexData = await indexResponse.json();
  const folders = Array.isArray(indexData) ? indexData : indexData.clubs;
  if (!Array.isArray(folders) || folders.length === 0) {
    throw new Error("El índice no contiene carpetas de clubes.");
  }

  const results = await Promise.allSettled(folders.map(async entry => {
    const folder = typeof entry === "string" ? entry : entry.folder;
    if (!folder) throw new Error("Hay una carpeta sin nombre en el índice.");

    const configUrl = new URL(`images/clubs/${encodeURIComponent(folder)}/config.json`, PROJECT_BASE);
    const response = await fetch(configUrl.href, { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo cargar ${folder}/config.json (HTTP ${response.status}).`);

    const config = await response.json();
    if (!config.club_name || !config.club_shield || !config.player || !config.goalkeeper) {
      throw new Error(`La configuración de ${folder} está incompleta.`);
    }
    return { ...config, folder };
  }));

  clubs = results.filter(result => result.status === "fulfilled").map(result => result.value);
  const failed = results.filter(result => result.status === "rejected");

  if (clubs.length === 0) throw new Error("No se pudo cargar ningún club. Revisa la consola del navegador (F12) para ver el error concreto.");

  populateClubSelectors();
  startButton.disabled = false;
  hint.textContent = failed.length
    ? `Se cargaron ${clubs.length} de ${folders.length} clubes. Fallaron: ${failed.map(item => item.reason.message).join(" | ")}`
    : `Se cargaron ${clubs.length} clubes correctamente. Jugador 1: W A S D · CPU: control automático`;
  if (failed.length) console.warn("Clubes que no se pudieron cargar:", failed.map(item => item.reason));
}

function populateClubSelectors() {
  const selects = [
    document.getElementById("teamOneSelect"),
    document.getElementById("teamTwoSelect")
  ];

  selects.forEach(select => {
    select.innerHTML = "";
    clubs.forEach(club => {
      const option = document.createElement("option");
      option.value = club.folder;
      option.textContent = club.club_name;
      select.appendChild(option);
    });
  });

  selects[0].value = clubs[0].folder;
  selects[1].value = (clubs[1] || clubs[0]).folder;
  updateClubCards();
}

function renderClubCard(containerId, club) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const shield = document.createElement("img");
  shield.src = new URL(club.club_shield, PROJECT_BASE).href;
  shield.alt = `Escudo de ${club.club_name}`;
  shield.onerror = () => {
    shield.alt = `Escudo no disponible: ${club.club_name}`;
    shield.classList.add("shield-error");
    console.error(`No se pudo cargar el escudo de ${club.club_name}:`, shield.src);
  };

  const name = document.createElement("strong");
  name.textContent = club.club_name;
  container.append(shield, name);
}

function updateClubCards() {
  const first = clubs.find(club => club.folder === document.getElementById("teamOneSelect").value);
  const second = clubs.find(club => club.folder === document.getElementById("teamTwoSelect").value);
  if (first) renderClubCard("teamOneCard", first);
  if (second) renderClubCard("teamTwoCard", second);
}

function makeCharacter(club, role, teamIndex) {
  const data = club[role];
  return {
    name: data.name,
    image: loadImage(data.image),
    speedStat: data.stats.speed,
    kickStat: data.stats.kick,
    role,
    teamIndex,
    x: 0,
    y: HEIGHT / 2,
    width: role === "goalkeeper" ? 64 : 72,
    height: role === "goalkeeper" ? 76 : 82,
    hitWidth: 40,
    hitHeight: 40,
    direction: teamIndex === 0 ? 1 : -1,
    aiTargetY: HEIGHT / 2,
    aiThinkTimer: 0,
    aiObservedLastHit: null
  };
}

function createTeam(club, index) {
  return {
    club,
    index,
    score: 0,
    goalkeeper: makeCharacter(club, "goalkeeper", index),
    player: makeCharacter(club, "player", index)
  };
}

function placeTeams() {
  const left = matchTeams[0];
  const right = matchTeams[1];

  // Porteros adelantados respecto a la línea de fondo, pero aún protegiendo la portería.
  left.goalkeeper.x = FIELD.left + 45;
  left.player.x = FIELD.left + 115;
  right.player.x = FIELD.right - 115 - right.player.width;
  right.goalkeeper.x = FIELD.right - 45 - right.goalkeeper.width;

  [left, right].forEach(team => {
    team.goalkeeper.teamIndex = team.index;
    team.player.teamIndex = team.index;
    team.goalkeeper.y = HEIGHT / 2 - team.goalkeeper.height / 2;
    team.player.y = HEIGHT / 2 - team.player.height / 2;
  });
}

function resetBall(direction = Math.random() < 0.5 ? -1 : 1) {
  ball.x = WIDTH / 2;
  ball.y = HEIGHT / 2;
  ball.radius = 15;
  ball.vx = direction * 5.2;
  ball.vy = (Math.random() * 2 - 1) * 2.8;
  ball.lastHit = null;
}

let ball = { x: WIDTH / 2, y: HEIGHT / 2, radius: 15, vx: 5.2, vy: 2, lastHit: null };

function beginMatch() {
  const firstFolder = document.getElementById("teamOneSelect").value;
  const secondFolder = document.getElementById("teamTwoSelect").value;
  selectedTeams = [
    clubs.find(club => club.folder === firstFolder),
    clubs.find(club => club.folder === secondFolder)
  ];
  if (selectedTeams.some(club => !club)) {
    document.getElementById("selectionHint").textContent = "Selecciona dos clubes válidos antes de comenzar.";
    return;
  }
  matchTeams = selectedTeams.map((club, index) => {
    const team = createTeam(club, index);
    team.controlPlayer = index === 0 ? 1 : (gameMode === "pvp" ? 2 : 0);
    return team;
  });
  score = [0, 0];
  remainingTime = TOTAL_SECONDS;
  currentHalf = 1;
  matchState = "kickoff";
  kickoffTeam = 0; // El equipo de la izquierda siempre realiza el saque inicial.
  goalPauseRemaining = 0;
  cpuKickoffTimer = 0;
  keys = {};
  placeTeams();
  resetBall(0);
  updateHud();
  updateControlsText();
  document.getElementById("matchOverlay").classList.add("hidden");
  showScreen("game");
  startMatchMusic();
  updateControlsText();
  lastFrame = performance.now();
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(gameLoop);
}

function updateHud() {
  const left = matchTeams[0];
  const right = matchTeams[1];
  if (!left || !right) return;
  document.getElementById("leftShield").src = left.club.club_shield;
  document.getElementById("rightShield").src = right.club.club_shield;
  document.getElementById("leftClubName").textContent = left.club.club_acronym;
  document.getElementById("rightClubName").textContent = right.club.club_acronym;
  document.getElementById("leftScore").textContent = score[0];
  document.getElementById("rightScore").textContent = score[1];
  document.getElementById("halfLabel").textContent = currentHalf === 1 ? "1.ª PARTE" : "2.ª PARTE";
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const minutes = Math.floor(remainingTime / 60);
  const seconds = Math.floor(remainingTime % 60);
  document.getElementById("matchTimer").textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateControlsText() {
  const text = gameMode === "cpu"
    ? "Jugador 1: W A S D · CPU: control automático"
    : "Jugador 1: W A S D · Jugador 2: FLECHAS";
  const status = matchState === "kickoff"
    ? `SAQUE: ${kickoffTeam === 0 ? "EQUIPO IZQUIERDO (D)" : (gameMode === "cpu" ? "CPU" : "EQUIPO DERECHO (←)")}`
    : text;
  document.getElementById("controlsText").textContent = status;
}

function getSide(team) {
  return team.index;
}

// Las estadísticas de los archivos config.json están limitadas al rango 5–10.
function getStatValue(character, statName) {
  const value = Number(character[statName === "speed" ? "speedStat" : "kickStat"]);
  return Number.isFinite(value) ? Math.max(5, Math.min(10, value)) : 5;
}

function moveCharacter(character, team, dt) {
  const side = getSide(team);
  const isHuman = Boolean(team.controlPlayer);
  const keysForTeam = team.controlPlayer === 1
    ? { up: "w", down: "s", left: "a", right: "d" }
    : { up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright" };

  let dx = 0;
  let dy = 0;
  const speedStat = getStatValue(character, "speed");
  // Velocidad: 4 px/frame con stat 5 y 8.5 px/frame con stat 10.
  const movementSpeed = (4 + (speedStat - 5) * 0.9) * dt;

  if (isHuman) {
    if (keys[keysForTeam.up]) dy -= 1;
    if (keys[keysForTeam.down]) dy += 1;
    if (character.role === "player") {
      if (keys[keysForTeam.left]) dx -= 1;
      if (keys[keysForTeam.right]) dx += 1;
    }
  } else {
    // La CPU tarda un poco en reaccionar cuando el rival golpea la pelota.
    if (character.aiObservedLastHit !== ball.lastHit) {
      character.aiObservedLastHit = ball.lastHit;
      character.aiThinkTimer = getCpuReactionFrames(); // demora según la dificultad elegida
    }

    character.aiThinkTimer = Math.max(0, character.aiThinkTimer - dt);
    if (character.aiThinkTimer === 0) {
      character.aiTargetY = ball.y - character.height / 2;
      character.aiThinkTimer = 5; // actualiza su objetivo unas 12 veces por segundo
    }

    const targetY = character.aiTargetY;
    const difference = targetY - character.y;
    // En Aficionado y Profesional el portero también usa el seguimiento reducido.
    // En Leyenda conserva su velocidad de seguimiento actual.
    const goalkeeperFollowMultiplier = cpuDifficulty === "legend" ? 0.82 : 0.68;
    const cpuSpeed = movementSpeed * (character.role === "goalkeeper" ? goalkeeperFollowMultiplier : 0.68);
    if (Math.abs(difference) > 5) dy = Math.sign(difference);
    if (character.role === "player") {
      const targetX = Math.max(WIDTH * 0.55, Math.min(WIDTH * 0.82, ball.x + 85));
      character.x += Math.sign(targetX - character.x) * Math.min(Math.abs(targetX - character.x), cpuSpeed * 0.55);
    }
    character.y += dy * cpuSpeed;
  }

  if (isHuman) {
    const length = Math.hypot(dx, dy) || 1;
    character.x += (dx / length) * movementSpeed;
    character.y += (dy / length) * movementSpeed;
  }

  if (character.role === "goalkeeper") {
    character.x = side === 0 ? FIELD.left + 45 : FIELD.right - 45 - character.width;
  } else {
    const minX = side === 0 ? FIELD.left + 55 : WIDTH * 0.52;
    const maxX = side === 0 ? WIDTH * 0.46 - character.width : FIELD.right - 55 - character.width;
    character.x = Math.max(minX, Math.min(maxX, character.x));
  }
  character.y = Math.max(FIELD.top, Math.min(FIELD.bottom - character.height, character.y));
}

function getHitBox(character) {
  return {
    x: character.x + (character.width - character.hitWidth) / 2,
    y: character.y + (character.height - character.hitHeight) / 2,
    width: character.hitWidth,
    height: character.hitHeight
  };
}

function collideWithCharacter(character, team) {
  const box = getHitBox(character);
  const nearestX = Math.max(box.x, Math.min(ball.x, box.x + box.width));
  const nearestY = Math.max(box.y, Math.min(ball.y, box.y + box.height));
  const dx = ball.x - nearestX;
  const dy = ball.y - nearestY;

  if (dx * dx + dy * dy > ball.radius * ball.radius) return false;
  if ((team.index === 0 && ball.vx >= 0) || (team.index === 1 && ball.vx <= 0)) return false;

  const centerY = box.y + box.height / 2;
  // El punto de contacto determina el ángulo: centro = recto; bordes = diagonal.
  const impact = Math.max(-1, Math.min(1,
    (ball.y - centerY) / (box.height / 2 + ball.radius)
  ));
  const kickStat = getStatValue(character, "kick");
  // La estadística kick controla la velocidad total de salida (6 a 11,5).
  const force = 6 + (kickStat - 5) * 1.1;
  const direction = team.index === 0 ? 1 : -1;
  const angle = impact * (Math.PI / 4);

  // Separa la pelota del personaje para evitar que quede atrapada dentro de su hitbox.
  ball.x = team.index === 0
    ? box.x + box.width + ball.radius + 1
    : box.x - ball.radius - 1;

  // Conserva una pequeña parte del movimiento vertical previo para dar continuidad al rebote.
  const incomingSpin = ball.vy * 0.12;
  ball.vx = direction * force * Math.cos(angle);
  ball.vy = force * Math.sin(angle) + incomingSpin;
  ball.lastHit = team.index;
  playSound("kick");
  return true;
}

function circleIntersectsRect(circle, rect) {
  const nearestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height));
  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

function getGoalHitboxes() {
  return GOAL;
}

function updateBall(dt) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Límites superior e inferior del terreno de juego.
  if (ball.y - ball.radius <= FIELD.top || ball.y + ball.radius >= FIELD.bottom) {
    ball.y = Math.max(FIELD.top + ball.radius, Math.min(FIELD.bottom - ball.radius, ball.y));
    ball.vy *= -1;
  }

  for (const team of matchTeams) {
    const defenders = [team.goalkeeper, team.player];
    for (const character of defenders) {
      if (collideWithCharacter(character, team)) break;
    }
  }

  // Solo se marca gol al entrar en el rectángulo de la portería.
  const goals = getGoalHitboxes();
  if (ball.vx < 0 && circleIntersectsRect(ball, goals.left)) {
    registerGoal(1);
    return;
  }
  if (ball.vx > 0 && circleIntersectsRect(ball, goals.right)) {
    registerGoal(0);
    return;
  }

  // Si no entra en la portería, los laterales son paredes y la pelota rebota.
  if (ball.x - ball.radius <= FIELD.left) {
    ball.x = FIELD.left + ball.radius;
    ball.vx = Math.abs(ball.vx);
  } else if (ball.x + ball.radius >= FIELD.right) {
    ball.x = FIELD.right - ball.radius;
    ball.vx = -Math.abs(ball.vx);
  }
}

function registerGoal(scoringTeam) {
  if (matchState !== "playing") return;
  score[scoringTeam] += 1;
  lastScoringTeam = scoringTeam;
  goalPauseScorer = scoringTeam;
  kickoffTeam = 1 - scoringTeam; // Saca el equipo que recibió el gol.
  goalPauseRemaining = 2;
  updateHud();
  playSound("goal");

  // Mantiene el balón dentro de la portería y lo frena durante la pausa.
  const goal = scoringTeam === 0 ? GOAL.right : GOAL.left;
  ball.x = scoringTeam === 0 ? goal.x + goal.width - ball.radius : goal.x + ball.radius;
  ball.y = Math.max(goal.y + ball.radius, Math.min(goal.y + goal.height - ball.radius, ball.y));
  ball.vx = scoringTeam === 0 ? Math.max(2, Math.abs(ball.vx) * 0.55) : -Math.max(2, Math.abs(ball.vx) * 0.55);
  ball.vy *= 0.55;
  matchState = "goal_pause";

  if (score[scoringTeam] >= WIN_SCORE) {
    // Se conserva la pausa visual antes de mostrar el resultado final.
    pendingMatchFinish = { winner: scoringTeam, title: "¡VICTORIA!" };
  }
}

let pendingMatchFinish = null;

function updateGoalPause(dt) {
  const friction = Math.pow(0.94, dt);
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.vx *= friction;
  ball.vy *= friction;
  goalPauseRemaining -= dt / 60;

  if (goalPauseRemaining <= 0) {
    if (pendingMatchFinish) {
      const result = pendingMatchFinish;
      pendingMatchFinish = null;
      finishMatch(result.winner, result.title);
      return;
    }
    resetBall(0);
    matchState = "kickoff";
    cpuKickoffTimer = 0.6;
    updateControlsText();
  }
}

function startKickoff(teamIndex) {
  if (matchState !== "kickoff" || teamIndex !== kickoffTeam) return;
  const direction = teamIndex === 0 ? 1 : -1;
  ball.x = WIDTH / 2;
  ball.y = HEIGHT / 2;
  ball.vx = direction * 5.2;
  ball.vy = 0;
  ball.lastHit = teamIndex;
  matchState = "playing";
  matchTeams[teamIndex].player.aiObservedLastHit = teamIndex;
  matchTeams[teamIndex].goalkeeper.aiObservedLastHit = teamIndex;
  updateControlsText();
}

function updateKickoff(dt) {
  // La CPU ejecuta el saque automáticamente cuando le corresponde.
  if (gameMode === "cpu" && kickoffTeam === 1) {
    cpuKickoffTimer += dt / 60;
    if (cpuKickoffTimer >= 0.6) startKickoff(1);
  }
}

function updateMatch(dt) {
  if (matchState === "goal_pause") {
    updateGoalPause(dt);
    return;
  }
  if (matchState === "kickoff") {
    updateKickoff(dt);
    return;
  }
  if (matchState !== "playing") return;

  remainingTime = Math.max(0, remainingTime - dt / 60);
  updateTimerDisplay();

  matchTeams.forEach(team => {
    moveCharacter(team.goalkeeper, team, dt);
    moveCharacter(team.player, team, dt);
  });
  updateBall(dt);

  if (remainingTime <= 0) {
    if (currentHalf === 1) {
      beginSecondHalf();
    } else if (score[0] === score[1]) {
      finishMatch(null, "¡EMPATE!");
    } else {
      finishMatch(score[0] > score[1] ? 0 : 1, "¡PARTIDO FINALIZADO!");
    }
  }
}

function beginSecondHalf() {
  currentHalf = 2;
  remainingTime = HALF_SECONDS;
  matchTeams.reverse();
  score.reverse();
  matchTeams.forEach((team, index) => { team.index = index; });
  placeTeams();
  resetBall(Math.random() < 0.5 ? -1 : 1);
  updateHud();
  showMatchOverlay("DESCANSO", "Cambio de campo. ¡Comienza la segunda parte!", "EMPEZAR 2.ª PARTE", () => {
    matchState = "playing";
    lastFrame = performance.now();
  });
  matchState = "halftime";
}

function showMatchOverlay(title, message, buttonText, callback) {
  document.getElementById("overlayTitle").textContent = title;
  document.getElementById("overlayText").textContent = message;
  const button = document.getElementById("overlayButton");
  button.textContent = buttonText;
  button.onclick = callback;
  document.getElementById("matchOverlay").classList.remove("hidden");
}

function finishMatch(winnerIndex, title) {
  matchState = "finished";

  audio.crowd.pause();
  const message = winnerIndex === null
    ? `Empate ${score[0]} - ${score[1]}`
    : `${matchTeams[winnerIndex].club.club_name} gana ${score[0]} - ${score[1]}`;
  showMatchOverlay(title, message, "VOLVER AL MENÚ", () => {
    matchState = "stopped";
    showScreen("menu");
    startMenuMusic();
  });
}

function drawCharacter(character) {
  const img = character.image;
  if (!img || !img.complete || !img.naturalWidth) return;

  const frameWidth = img.naturalWidth / SPRITE_COLUMNS;
  const frameHeight = img.naturalHeight / SPRITE_ROWS;
  const drawX = character.x;
  const drawY = character.y;

  ctx.save();
  if (character.teamIndex === 1) {
    ctx.translate(drawX + character.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, frameWidth, frameHeight, 0, drawY, character.width, character.height);
  } else {
    ctx.drawImage(img, 0, 0, frameWidth, frameHeight, drawX, drawY, character.width, character.height);
  }
  ctx.restore();
}

function drawBall() {
  if (ballImage.complete && ballImage.naturalWidth) {
    const frameWidth = ballImage.naturalWidth / 5;
    const frameHeight = ballImage.naturalHeight;
    ctx.drawImage(
      ballImage,
      ballFrame * frameWidth, 0, frameWidth, frameHeight,
      ball.x - 19, ball.y - 19, 38, 38
    );
  } else {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }
}

function drawDebugHitboxes() {
  const goals = getGoalHitboxes();
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#00e5ff";
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(FIELD.left, FIELD.top, FIELD.right - FIELD.left, FIELD.bottom - FIELD.top);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(0, 220, 90, 0.28)";
  ctx.fillRect(goals.left.x, goals.left.y, goals.left.width, goals.left.height);
  ctx.fillRect(goals.right.x, goals.right.y, goals.right.width, goals.right.height);
  ctx.strokeStyle = "#00dc5a";
  ctx.strokeRect(goals.left.x, goals.left.y, goals.left.width, goals.left.height);
  ctx.strokeRect(goals.right.x, goals.right.y, goals.right.width, goals.right.height);
  ctx.fillStyle = "#fff";
  ctx.font = "14px monospace";
  ctx.fillText(`Puntero: x=${Math.round(pointerPosition.x)} y=${Math.round(pointerPosition.y)}`, 12, 22);
  ctx.fillText("F3: ocultar/mostrar límites · Cian: campo · Verde: hitboxes de portería", 12, 42);
  ctx.restore();
}

function drawGame() {
  if (stageImage.complete && stageImage.naturalWidth) {
    ctx.drawImage(stageImage, 0, 0, WIDTH, HEIGHT);
  } else {
    ctx.fillStyle = "#18743a";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  matchTeams.forEach(team => {
    drawCharacter(team.goalkeeper);
    drawCharacter(team.player);
  });
  drawBall();
  if (debugHitboxes) drawDebugHitboxes();
}

function gameLoop(timestamp) {
  if (matchState === "stopped" || matchState === "finished") return;
  const dt = Math.min((timestamp - lastFrame) / (1000 / 60) || 1, 2);
  lastFrame = timestamp;

  if (["playing", "kickoff", "goal_pause"].includes(matchState)) {
    updateMatch(dt);
    ballFrameTimer += dt;
    if (ballFrameTimer >= 7) {
      ballFrame = (ballFrame + 1) % 5;
      ballFrameTimer = 0;
    }
  }

  drawGame();
  animationFrame = requestAnimationFrame(gameLoop);
}

function returnToMenu() {
  matchState = "stopped";
  cancelAnimationFrame(animationFrame);

  audio.crowd.pause();
  showScreen("menu");
  startMenuMusic();
}

document.getElementById("introStart").addEventListener("click", () => {
  showScreen("menu");
  startMenuMusic();
});
document.getElementById("friendlyMode").addEventListener("click", () => {
  updateModeSelection();
  showScreen("clubs");
});
document.getElementById("gameModeSelect").addEventListener("change", updateModeSelection);
document.getElementById("cpuDifficultySelect").addEventListener("change", event => {
  cpuDifficulty = event.target.value;
});

function updateModeSelection() {
  gameMode = document.getElementById("gameModeSelect").value;
  document.getElementById("difficultyMode").classList.toggle("hidden", gameMode !== "cpu");
  cpuDifficulty = document.getElementById("cpuDifficultySelect").value;
  document.getElementById("teamTwoLabel").textContent = gameMode === "pvp" ? "JUGADOR 2" : "CPU";
  document.getElementById("selectionHint").textContent = gameMode === "pvp"
    ? "Jugador 1: W A S D · Jugador 2: FLECHAS"
    : "Jugador 1: W A S D · CPU: control automático";
}
document.getElementById("teamOneSelect").addEventListener("change", updateClubCards);
document.getElementById("teamTwoSelect").addEventListener("change", updateClubCards);
document.getElementById("backToMenu").addEventListener("click", () => showScreen("menu"));
document.getElementById("startMatch").addEventListener("click", beginMatch);
document.getElementById("quitMatch").addEventListener("click", returnToMenu);
document.getElementById("overlayButton").addEventListener("click", () => {});

canvas.addEventListener("pointermove", event => {
  const rect = canvas.getBoundingClientRect();
  pointerPosition = {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
});

document.addEventListener("keydown", event => {
  if (matchState === "kickoff") {
    const kickoffSide = matchTeams[kickoffTeam];
    const attackDirection = kickoffTeam === 0 ? 1 : -1;
    const keyForKickoff = kickoffSide.controlPlayer === 1
      ? (attackDirection > 0 ? "d" : "a")
      : "arrow" + (attackDirection > 0 ? "right" : "left");
    if (event.key.toLowerCase() === keyForKickoff) {
      event.preventDefault();
      startKickoff(kickoffTeam);
    }
  }
  if (event.key === "F3") {
    event.preventDefault();
    debugHitboxes = !debugHitboxes;
  }
  const key = event.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
  keys[key] = true;
  if (key === "enter" && !screens.intro.classList.contains("hidden")) {
    showScreen("menu");
    startMenuMusic();
  }
});
document.addEventListener("keyup", event => {
  keys[event.key.toLowerCase()] = false;
});

loadClubs().catch(error => {
  console.error("Error cargando clubes:", error);
  document.getElementById("selectionHint").textContent = error.message;
  document.getElementById("startMatch").disabled = true;
});

showScreen("intro");