const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
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
  friendlySides: document.getElementById("friendlySidesScreen"),
  championsMode: document.getElementById("championsModeScreen"),
  competitionSetup: document.getElementById("competitionSetupScreen"),
  champions: document.getElementById("championsScreen"),
  bracket: document.getElementById("bracketScreen"),
  game: document.getElementById("gameScreen")
};

const imageCache = new Map();
const audio = {
  menu: new Audio(ASSET.menuMusic),
  goal: new Audio(ASSET.goal),
  missed: new Audio(ASSET.missed),
  kick: new Audio(ASSET.kick),
  whistle: new Audio("audio/sounds/whistle.mp3"),
  finalWhistle: new Audio("audio/sounds/final_whistle.mp3"),
  crowd: new Audio(ASSET.crowd)
};
audio.menu.loop = true;
audio.crowd.loop = true;
audio.menu.volume = 0.45;
audio.crowd.volume = 0.28;
audio.goal.volume = 0.8;
audio.kick.volume = 0.55;
audio.missed.volume = 0.5;
audio.whistle.volume = 0.8;
audio.finalWhistle.volume = 0.9;

let clubs = [];
let gameMode = "cpu";
let cpuDifficulty = "professional";
let tournamentMode = false;
let tournament = null;
let bracketContinueAction = null;
let matchStateBeforeBracket = "playing";

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
const friendlyAssignments = { 1: null, 2: null };
let friendlyJoinOrder = [];
const friendlySidePositions = { 1: 0, 2: 0 }; // -1 local, 0 neutral, 1 visitante
const playerIcons = {
  1: loadImage("images/menu/player_1.png"),
  2: loadImage("images/menu/player_2.png")
};
let score = [0, 0];
let remainingTime = HALF_SECONDS;
let currentHalf = 1;
let extraTimeActive = false;
let extraTimeGoals = [0, 0];
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
  populateChampionsSelector();
  renderFriendlySelection();
  startButton.disabled = false;
  document.getElementById("startChampions").disabled = clubs.length < 4;
  document.getElementById("championsHint").textContent = clubs.length < 4
    ? "Se necesitan al menos cuatro clubes para disputar la competición."
    : `Se han cargado ${clubs.length} clubes. Elige tu equipo y dificultad.`;
  hint.textContent = failed.length
    ? `Se cargaron ${clubs.length} de ${folders.length} clubes. Fallaron: ${failed.map(item => item.reason.message).join(" | ")}`
    : `Se cargaron ${clubs.length} clubes correctamente. Jugador 1: W A S D · CPU: control automático`;
  if (failed.length) console.warn("Clubes que no se pudieron cargar:", failed.map(item => item.reason));
}

function populateClubSelectors() {
  const selects = [
    document.getElementById("localClubSelect"),
    document.getElementById("awayClubSelect")
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
  if (clubs.length) {
    selects[0].value = clubs[0].folder;
    selects[1].value = (clubs[1] || clubs[0]).folder;
  }
  updateFriendlyClubCards();
}

function updateFriendlyClubCards() {
  const local = clubs.find(club => club.folder === document.getElementById("localClubSelect").value);
  const away = clubs.find(club => club.folder === document.getElementById("awayClubSelect").value);
  if (local) renderClubCard("localTeamCard", local);
  if (away) renderClubCard("awayTeamCard", away);
}

function renderFriendlySelection() {
  updateFriendlyClubCards();
  const localPlayers = [1, 2].filter(player => friendlyAssignments[player] === "local");
  const awayPlayers = [1, 2].filter(player => friendlyAssignments[player] === "away");
  const hint = document.getElementById("selectionHint");
  if (!localPlayers.length && !awayPlayers.length) {
    hint.textContent = "Ningún jugador participa: la CPU controlará ambos equipos con la dificultad seleccionada.";
  } else if (localPlayers.length === 2 || awayPlayers.length === 2) {
    hint.textContent = "Ambos jugadores jugarán juntos: el primero que se unió controlará al jugador de campo y el segundo al portero.";
  } else if (localPlayers.length && awayPlayers.length) {
    hint.textContent = "Cada jugador controlará su propio equipo. El partido será Jugador contra Jugador.";
  } else {
    const player = localPlayers[0] || awayPlayers[0];
    hint.textContent = `Jugador ${player} jugará con el equipo elegido contra la CPU. Si el Jugador 1 no participa, el Jugador 2 controlará todo su equipo.`;
  }
}

function setFriendlySide(player, position) {
  friendlySidePositions[player] = Math.max(-1, Math.min(1, position));
  const side = position < 0 ? "local" : position > 0 ? "away" : null;
  const previous = friendlyAssignments[player];
  if (!side) {
    friendlyAssignments[player] = null;
    friendlyJoinOrder = friendlyJoinOrder.filter(item => item !== player);
  } else if (previous !== side) {
    friendlyAssignments[player] = side;
    friendlyJoinOrder = friendlyJoinOrder.filter(item => item !== player);
    friendlyJoinOrder.push(player);
  }
  renderFriendlySideSelection();
}

function renderFriendlySideSelection() {
  [1, 2].forEach(player => {
    const position = friendlySidePositions[player];
    const marker = document.getElementById(`player${player}SideMarker`);
    if (!marker) return;
    marker.style.left = position < 0 ? "21.43%" : position > 0 ? "78.57%" : "50%";
    marker.style.top = player === 1 ? "36%" : "66%";
  });
}

function continueToFriendlyClubs() {
  if (tournamentMode && tournament?.kind === "competition") {
    const localPlayers = [1, 2].filter(player => friendlyAssignments[player] === "local");
    const awayPlayers = [1, 2].filter(player => friendlyAssignments[player] === "away");
    if (!localPlayers.length && !awayPlayers.length) {
      simulateCurrentCompetitionMatch();
      return;
    }
    startCompetitionMatch();
    return;
  }
  renderFriendlySelection();
  showScreen("clubs");
}

function populateChampionsSelector() {
  const select = document.getElementById("championsClubSelect");
  select.innerHTML = "";
  clubs.forEach(club => {
    const option = document.createElement("option");
    option.value = club.folder;
    option.textContent = club.club_name;
    select.appendChild(option);
  });
  if (clubs.length) renderClubCard("championsClubCard", clubs[0]);
}

function updateChampionsClubCard() {
  const club = clubs.find(item => item.folder === document.getElementById("championsClubSelect").value);
  if (club) renderClubCard("championsClubCard", club);
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

  // Posiciones habituales de los cuatro personajes.
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

// Coloca al equipo que saca en formación de saque: el jugador con el balón
// en los pies, en el centro de su propia mitad.
function prepareKickoffPositions() {
  placeTeams();
  const team = matchTeams[kickoffTeam];
  if (!team) return;

  const midpoint = (FIELD.left + FIELD.right) / 2;
  const ownHalfCenterX = kickoffTeam === 0
    ? (FIELD.left + midpoint) / 2
    : (midpoint + FIELD.right) / 2;

  team.player.x = ownHalfCenterX - team.player.width / 2;
  team.player.y = HEIGHT / 2 - team.player.height / 2;

  const direction = kickoffTeam === 0 ? 1 : -1;
  ball.x = team.player.x + team.player.width / 2 + direction * 18;
  ball.y = team.player.y + team.player.height - ball.radius * 0.55;
  ball.vx = 0;
  ball.vy = 0;
  ball.lastHit = null;
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
  tournamentMode = false;
  tournament = null;
  const firstFolder = document.getElementById("localClubSelect").value;
  const secondFolder = document.getElementById("awayClubSelect").value;
  selectedTeams = [
    clubs.find(club => club.folder === firstFolder),
    clubs.find(club => club.folder === secondFolder)
  ];
  if (selectedTeams.some(club => !club)) {
    document.getElementById("selectionHint").textContent = "Selecciona dos clubes válidos antes de comenzar.";
    return;
  }
  gameMode = friendlyAssignments[1] && friendlyAssignments[2] && friendlyAssignments[1] !== friendlyAssignments[2] ? "pvp" : "cpu";
  cpuDifficulty = document.getElementById("cpuDifficultySelect").value;
  matchTeams = selectedTeams.map((club, index) => {
    const team = createTeam(club, index);
    const side = index === 0 ? "local" : "away";
    const assignedPlayers = friendlyJoinOrder.filter(player => friendlyAssignments[player] === side);
    team.controllers = { player: 0, goalkeeper: 0 };
    if (assignedPlayers.length === 1) {
      // Un jugador controla al jugador de campo y al portero simultáneamente.
      team.controllers.player = assignedPlayers[0];
      team.controllers.goalkeeper = assignedPlayers[0];
    } else if (assignedPlayers.length === 2) {
      // Cuando ambos juegan juntos, el primero controla campo y el segundo portería.
      team.controllers.player = assignedPlayers[0];
      team.controllers.goalkeeper = assignedPlayers[1];
    }
    team.controlPlayer = team.controllers.player || 0;
    return team;
  });
  score = [0, 0];
  remainingTime = HALF_SECONDS;
  currentHalf = 1;
  extraTimeActive = false;
  extraTimeGoals = [0, 0];
  matchState = "kickoff";
  kickoffTeam = 0; // El equipo de la izquierda siempre realiza el saque inicial.
  goalPauseRemaining = 0;
  cpuKickoffTimer = 0;
  keys = {};
  prepareKickoffPositions();
  updateHud();
  updateControlsText();
  document.getElementById("matchOverlay").classList.add("hidden");
  document.getElementById("viewBracket").classList.toggle("hidden", !tournamentMode);
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
  document.getElementById("leftScore").textContent = score[0] + (extraTimeActive ? extraTimeGoals[0] : 0);
  document.getElementById("rightScore").textContent = score[1] + (extraTimeActive ? extraTimeGoals[1] : 0);
  document.getElementById("halfLabel").textContent =
    currentHalf === 1 ? "1.ª PARTE" : currentHalf === 2 ? "2.ª PARTE" : "PRÓRROGA";
  updateTimerDisplay();
}

function updateTimerDisplay() {
  if (extraTimeActive) {
    document.getElementById("matchTimer").textContent = "∞";
    return;
  }
  const minutes = Math.floor(remainingTime / 60);
  const seconds = Math.floor(remainingTime % 60);
  document.getElementById("matchTimer").textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateControlsText() {
  const controls = [];
  matchTeams.forEach((team, side) => {
    const localName = side === 0 ? "Local" : "Visitante";
    Object.entries(team.controllers || {}).forEach(([role, player]) => {
      if (player) controls.push(`J${player} ${localName}: ${role === "player" ? "campo" : "portero"}`);
    });
  });
  const text = tournamentMode && tournament?.kind === "individual"
    ? "Jugador 1: W A S D · CPU: control automático"
    : `${controls.join(" · ") || "CPU: control automático"} · J1: WASD · J2: FLECHAS`;
  const kickoffController = matchTeams[kickoffTeam]?.controllers?.player ?? matchTeams[kickoffTeam]?.controlPlayer ?? 0;
  const kickoffName = kickoffController ? `JUGADOR ${kickoffController}` : "CPU";
  const status = matchState === "kickoff" ? `SAQUE: ${kickoffName} · ${kickoffController === 1 ? (kickoffTeam === 0 ? "D" : "A") : kickoffController === 2 ? (kickoffTeam === 0 ? "→" : "←") : "AUTOMÁTICO"}` : text;
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
  const controller = team.controllers?.[character.role] ?? team.controlPlayer ?? 0;
  const isHuman = Boolean(controller);
  const keysForTeam = controller === 1
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
      const targetX = side === 0
        ? Math.max(FIELD.left + 55, Math.min(WIDTH * 0.46 - character.width, ball.x - 85))
        : Math.max(WIDTH * 0.55, Math.min(FIELD.right - 55 - character.width, ball.x + 85));
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
  if (extraTimeActive) extraTimeGoals[scoringTeam] += 1;
  else score[scoringTeam] += 1;
  lastScoringTeam = scoringTeam;
  goalPauseScorer = scoringTeam;
  kickoffTeam = 1 - scoringTeam; // Saca el equipo que recibió el gol.
  goalPauseRemaining = 2;
  updateHud();
  playSound("goal");
  playSound("whistle");

  // El balón permanece dentro de la portería y rebota contra sus cuatro lados.
  goalPauseGoalRect = scoringTeam === 0 ? GOAL.right : GOAL.left;
  const goal = goalPauseGoalRect;
  ball.x = scoringTeam === 0 ? goal.x + goal.width - ball.radius - 1 : goal.x + ball.radius + 1;
  ball.y = Math.max(goal.y + ball.radius, Math.min(goal.y + goal.height - ball.radius, ball.y));
  ball.vx = scoringTeam === 0 ? Math.max(2, Math.abs(ball.vx) * 0.55) : -Math.max(2, Math.abs(ball.vx) * 0.55);
  ball.vy *= 0.55;
  matchState = "goal_pause";

  if (extraTimeActive && extraTimeGoals[scoringTeam] >= 2) {
    // En prórroga se mantiene la regla de muerte súbita a dos goles.
    pendingMatchFinish = { winner: scoringTeam, title: "¡VICTORIA EN LA PRÓRROGA!" };
  }
}

let pendingMatchFinish = null;
let goalPauseGoalRect = null;

function updateGoalPause(dt) {
  const goal = goalPauseGoalRect;
  const friction = Math.pow(0.94, dt);
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Rebotes dentro de la hitbox de la portería, igual que contra las paredes del campo.
  if (goal) {
    const minX = goal.x + ball.radius;
    const maxX = goal.x + goal.width - ball.radius;
    const minY = goal.y + ball.radius;
    const maxY = goal.y + goal.height - ball.radius;

    if (ball.x <= minX || ball.x >= maxX) {
      ball.x = Math.max(minX, Math.min(maxX, ball.x));
      ball.vx *= -1;
    }
    if (ball.y <= minY || ball.y >= maxY) {
      ball.y = Math.max(minY, Math.min(maxY, ball.y));
      ball.vy *= -1;
    }
  }

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
    goalPauseGoalRect = null;
    matchState = "kickoff";
    cpuKickoffTimer = 0;
    prepareKickoffPositions();
    updateControlsText();
  }
}

function startKickoff(teamIndex) {
  if (matchState !== "kickoff" || teamIndex !== kickoffTeam) return;
  const direction = teamIndex === 0 ? 1 : -1;
  const team = matchTeams[teamIndex];
  const kickStat = getStatValue(team.player, "kick");
  // El saque tiene potencia según stats.kick, como un rebote normal.
  const force = 6 + (kickStat - 5) * 1.1;

  let angle = 0;
  const kickoffController = team.controllers?.player ?? team.controlPlayer ?? 0;
  if (kickoffController) {
    // El jugador de campo que controla el saque puede orientar el disparo.
    const upKey = kickoffController === 1 ? "w" : "arrowup";
    const downKey = kickoffController === 1 ? "s" : "arrowdown";
    if (keys[upKey]) angle = -Math.PI / 6;
    else if (keys[downKey]) angle = Math.PI / 6;
  } else {
    // La CPU dirige el saque hacia una zona cercana al jugador rival.
    const opponent = matchTeams[1 - teamIndex].player;
    const targetY = opponent.y + opponent.height / 2;
    angle = Math.atan2(targetY - ball.y, Math.abs(opponent.x - ball.x));
    angle = Math.max(-Math.PI / 6, Math.min(Math.PI / 6, angle));
  }

  ball.vx = direction * force * Math.cos(angle);
  ball.vy = force * Math.sin(angle);
  ball.lastHit = teamIndex;
  matchState = "playing";
  team.player.aiObservedLastHit = teamIndex;
  team.goalkeeper.aiObservedLastHit = teamIndex;
  playSound("kick");
  playSound("whistle");
  updateControlsText();
}

function updateKickoff(dt) {
  // La CPU ejecuta el saque automáticamente, ocupe el lado que ocupe.
  if (!(matchTeams[kickoffTeam]?.controllers?.player ?? matchTeams[kickoffTeam]?.controlPlayer)) {
    cpuKickoffTimer += dt / 60;
    if (cpuKickoffTimer >= 1) startKickoff(kickoffTeam);
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

  if (!extraTimeActive) remainingTime = Math.max(0, remainingTime - dt / 60);
  updateTimerDisplay();

  matchTeams.forEach(team => {
    moveCharacter(team.goalkeeper, team, dt);
    moveCharacter(team.player, team, dt);
  });
  updateBall(dt);

  if (remainingTime <= 0) {
    if (currentHalf === 1) {
      beginSecondHalf();
    } else if (score[0] === score[1] && tournamentMode && tournament.round === "final") {
      startExtraTime("La final ha terminado empatada. ¡Comienza la prórroga! El primero en marcar 2 goles será campeón.");
    } else if (score[0] === score[1]) {
      finishMatch(null, "¡EMPATE!");
    } else {
      finishMatch(score[0] > score[1] ? 0 : 1, "¡PARTIDO FINALIZADO!");
    }
  }
}

function startExtraTime(message) {
  extraTimeActive = true;
  extraTimeGoals = [0, 0];
  currentHalf = 3;
  remainingTime = 0;
  kickoffTeam = 0;
  goalPauseRemaining = 0;
  goalPauseGoalRect = null;
  pendingMatchFinish = null;
  cpuKickoffTimer = 0;
  matchState = "kickoff";
  prepareKickoffPositions();
  updateHud();
  startMatchMusic();
  showMatchOverlay(
    "PRÓRROGA",
    message,
    "INICIAR PRÓRROGA",
    () => {
      document.getElementById("matchOverlay").classList.add("hidden");
      matchState = "kickoff";
      lastFrame = performance.now();
      updateControlsText();
    }
  );
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
    document.getElementById("matchOverlay").classList.add("hidden");
    matchState = "playing";
    lastFrame = performance.now();
    updateControlsText();
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
  if (matchState === "finished" || matchState === "final_whistle") return;

  // Congela el partido durante todo el silbato final.
  matchState = "final_whistle";
  keys = {};

  // El silbato final sustituye al normal y la afición se detiene.
  audio.whistle.pause();
  audio.whistle.currentTime = 0;
  audio.crowd.pause();
  audio.finalWhistle.pause();
  audio.finalWhistle.currentTime = 0;

  const playerSide = matchTeams.findIndex(team => Object.values(team.controllers || {}).some(Boolean) || team.controlPlayer);
  const resultTitle = winnerIndex === null
    ? "¡EMPATE!"
    : tournamentMode
      ? (winnerIndex === playerSide ? "¡VICTORIA!" : "¡DERROTA!")
      : gameMode === "cpu"
        ? (winnerIndex === playerSide ? "¡VICTORIA!" : "¡DERROTA!")
        : (title || "¡PARTIDO FINALIZADO!");
  const finalScore = score.map((goals, index) => goals + (extraTimeActive ? extraTimeGoals[index] : 0));
  const message = winnerIndex === null
    ? `Empate ${finalScore[0]} - ${finalScore[1]}`
    : `${matchTeams[winnerIndex].club.club_name} gana ${finalScore[0]} - ${finalScore[1]}`;

  const revealResult = () => {
    if (matchState !== "final_whistle") return;
    matchState = "finished";
    if (tournamentMode) {
      handleTournamentMatchEnd(winnerIndex, message);
      return;
    }
    showMatchOverlay(resultTitle, message, "VOLVER AL MENÚ", () => {
      matchState = "stopped";
      showScreen("menu");
      startMenuMusic();
    });
  };

  // La pantalla de resultado aparece únicamente cuando termina el audio.
  audio.finalWhistle.onended = revealResult;
  audio.finalWhistle.play().catch(() => {
    // Si el navegador no puede reproducir el archivo, no dejamos el partido bloqueado.
    revealResult();
  });
}

function shuffleClubs(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function simulateCpuSemi(clubA, clubB) {
  const firstLeg = [Math.floor(Math.random() * 5), Math.floor(Math.random() * 5)];
  const secondLeg = [Math.floor(Math.random() * 5), Math.floor(Math.random() * 5)];
  const totalA = firstLeg[0] + secondLeg[1];
  const totalB = firstLeg[1] + secondLeg[0];
  const winner = totalA === totalB
    ? (Math.random() < 0.5 ? clubA : clubB)
    : (totalA > totalB ? clubA : clubB);
  return { clubA, clubB, winner, firstLeg, secondLeg, totalA, totalB };
}

function getTournamentDifficulty() {
  if (tournament.round === "semifinal") return tournament.difficulty;
  return tournament.difficulty === "amateur" ? "professional" : "legend";
}

function beginChampionsTournament() {
  const playerClub = clubs.find(club => club.folder === document.getElementById("championsClubSelect").value);
  if (!playerClub || clubs.length < 4) {
    document.getElementById("championsHint").textContent = "No hay cuatro clubes disponibles para iniciar la competición.";
    return;
  }
  const opponents = shuffleClubs(clubs.filter(club => club.folder !== playerClub.folder)).slice(0, 3);
  const cpuSemi = simulateCpuSemi(opponents[1], opponents[2]);
  tournament = {
    playerClub,
    difficulty: document.getElementById("championsDifficultySelect").value,
    semifinalOpponent: opponents[0],
    finalOpponent: cpuSemi.winner,
    cpuSemi,
    playerSemi: { firstLeg: null, secondLeg: null, aggregatePlayer: null, aggregateOpponent: null, winner: null },
    finalResult: null,
    round: "semifinal",
    leg: 1,
    aggregatePlayer: 0,
    aggregateOpponent: 0
  };
  tournamentMode = true;
  gameMode = "cpu";
  showTournamentBracket(
    "SEMIFINALES · IDA",
    "Este es el cuadro inicial. La otra semifinal ya se ha simulado. Revisa los emparejamientos antes de comenzar tu eliminatoria.",
    "COMENZAR IDA",
    () => startTournamentMatch(tournament.semifinalOpponent, 1)
  );
}

function startTournamentMatch(opponent, leg) {
  tournament.leg = leg;
  tournament.currentOpponent = opponent;
  cpuDifficulty = getTournamentDifficulty();
  const playerOnLeft = tournament.round === "final" || leg === 1;
  const leftClub = playerOnLeft ? tournament.playerClub : opponent;
  const rightClub = playerOnLeft ? opponent : tournament.playerClub;
  matchTeams = [leftClub, rightClub].map((club, index) => {
    const team = createTeam(club, index);
    team.controlPlayer = club.folder === tournament.playerClub.folder ? 1 : 0;
    team.controllers = { player: team.controlPlayer, goalkeeper: 0 };
    return team;
  });
  selectedTeams = [leftClub, rightClub];
  score = [0, 0];
  remainingTime = HALF_SECONDS;
  currentHalf = 1;
  extraTimeActive = false;
  extraTimeGoals = [0, 0];
  matchState = "kickoff";
  kickoffTeam = 0;
  goalPauseRemaining = 0;
  goalPauseGoalRect = null;
  pendingMatchFinish = null;
  cpuKickoffTimer = 0;
  keys = {};
  prepareKickoffPositions();
  updateHud();
  updateControlsText();
  document.getElementById("matchOverlay").classList.add("hidden");
  document.getElementById("viewBracket").classList.remove("hidden");
  showScreen("game");
  startMatchMusic();
  lastFrame = performance.now();
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(gameLoop);
}

function showTournamentBracket(status, message, buttonLabel, action) {
  renderTournamentBracket();
  document.getElementById("bracketStatus").textContent = status;
  document.getElementById("bracketMessage").textContent = message;
  const button = document.getElementById("bracketBack");
  button.textContent = buttonLabel;
  bracketContinueAction = action;
  showScreen("bracket");
}

function finishTournamentAndReturn(title, message) {
  showTournamentBracket(title, message, "VOLVER AL MENÚ", returnToMenu);
}

function handleTournamentMatchEnd(winnerIndex, matchMessage) {
  if (tournament?.kind === "competition") { handleCompetitionMatchEnd(winnerIndex, matchMessage); return; }
  const playerSide = matchTeams.findIndex(team => team.controlPlayer === 1);
  const playerGoals = score[playerSide] + (extraTimeActive ? extraTimeGoals[playerSide] : 0);
  const opponentGoals = score[1 - playerSide] + (extraTimeActive ? extraTimeGoals[1 - playerSide] : 0);

  if (tournament.round === "semifinal" && tournament.leg === 1) {
    tournament.aggregatePlayer = playerGoals;
    tournament.aggregateOpponent = opponentGoals;
    tournament.playerSemi.firstLeg = [playerGoals, opponentGoals];
    showTournamentBracket(
      "SEMIFINAL · IDA FINALIZADA",
      `${matchMessage}. Resultado de ida: ${playerGoals} - ${opponentGoals}. Consulta el global provisional en el cuadro.`,
      "CONTINUAR A LA VUELTA",
      () => startTournamentMatch(tournament.semifinalOpponent, 2)
    );
    return;
  }

  if (tournament.round === "semifinal" && tournament.extraTimeForSemifinal) {
    const playerWon = extraTimeGoals[playerSide] > extraTimeGoals[1 - playerSide];
    const regularPlayerGoals = score[playerSide];
    const regularOpponentGoals = score[1 - playerSide];
    tournament.playerSemi.secondLeg = [regularPlayerGoals, regularOpponentGoals];
    tournament.playerSemi.aggregatePlayer = tournament.aggregatePlayer;
    tournament.playerSemi.aggregateOpponent = tournament.aggregateOpponent;
    tournament.playerSemi.extraTime = [...extraTimeGoals];
    tournament.playerSemi.winner = playerWon ? tournament.playerClub : tournament.semifinalOpponent;
    tournament.extraTimeForSemifinal = false;
    if (!playerWon) {
      showTournamentBracket(
        "ELIMINADO EN SEMIFINALES",
        `La prórroga termina ${extraTimeGoals[playerSide]} - ${extraTimeGoals[1 - playerSide]}.`,
        "VOLVER AL MENÚ",
        returnToMenu
      );
      return;
    }
    tournament.round = "final";
    showTournamentBracket(
      "¡CLASIFICADO PARA LA FINAL!",
      `Has ganado la eliminatoria en la prórroga por ${extraTimeGoals[playerSide]} - ${extraTimeGoals[1 - playerSide]}. Tu rival será ${tournament.finalOpponent.club_name}.`,
      "COMENZAR LA FINAL",
      () => startTournamentMatch(tournament.finalOpponent, 1)
    );
    return;
  }

  if (tournament.round === "semifinal") {
    tournament.aggregatePlayer += playerGoals;
    tournament.aggregateOpponent += opponentGoals;
    tournament.playerSemi.secondLeg = [playerGoals, opponentGoals];
    tournament.playerSemi.aggregatePlayer = tournament.aggregatePlayer;
    tournament.playerSemi.aggregateOpponent = tournament.aggregateOpponent;

    const firstLegPoints = tournament.playerSemi.firstLeg[0] > tournament.playerSemi.firstLeg[1] ? 3
      : tournament.playerSemi.firstLeg[0] === tournament.playerSemi.firstLeg[1] ? 1 : 0;
    const secondLegPoints = playerGoals > opponentGoals ? 3
      : playerGoals === opponentGoals ? 1 : 0;
    const firstLegOpponentPoints = tournament.playerSemi.firstLeg[1] > tournament.playerSemi.firstLeg[0] ? 3
      : tournament.playerSemi.firstLeg[1] === tournament.playerSemi.firstLeg[0] ? 1 : 0;
    const secondLegOpponentPoints = opponentGoals > playerGoals ? 3
      : opponentGoals === playerGoals ? 1 : 0;
    const playerPoints = firstLegPoints + secondLegPoints;
    const opponentPoints = firstLegOpponentPoints + secondLegOpponentPoints;
    const playerGoalDifference = tournament.aggregatePlayer - tournament.aggregateOpponent;

    tournament.playerSemi.playerPoints = playerPoints;
    tournament.playerSemi.opponentPoints = opponentPoints;

    if (playerPoints === opponentPoints && playerGoalDifference === 0) {
      tournament.extraTimeForSemifinal = true;
      startExtraTime("La eliminatoria está igualada en puntos y diferencia de goles. ¡Prórroga! El primero en marcar 2 goles se clasifica.");
      return;
    }
    if (playerPoints < opponentPoints ||
        (playerPoints === opponentPoints && playerGoalDifference < 0)) {
      tournament.playerSemi.winner = tournament.semifinalOpponent;
      showTournamentBracket(
        "ELIMINADO EN SEMIFINALES",
        `Puntos de la eliminatoria: ${playerPoints} - ${opponentPoints}. Diferencia de goles: ${playerGoalDifference}. ${tournament.semifinalOpponent.club_name} se clasifica para la final.`,
        "VOLVER AL MENÚ",
        returnToMenu
      );
      return;
    }

    tournament.playerSemi.winner = tournament.playerClub;
    tournament.round = "final";
    showTournamentBracket(
      "¡CLASIFICADO PARA LA FINAL!",
      `Has ganado la semifinal por ${tournament.aggregatePlayer} - ${tournament.aggregateOpponent}. Tu rival será ${tournament.finalOpponent.club_name}. La final se disputa a un solo partido.`,
      "COMENZAR LA FINAL",
      () => startTournamentMatch(tournament.finalOpponent, 1)
    );
    return;
  }

  if (tournament.round === "final" && winnerIndex === null && !tournament.extraTimeForFinal) {
    tournament.extraTimeForFinal = true;
    startExtraTime("La final ha terminado empatada. ¡Prórroga! El primer equipo que marque 2 goles será campeón.");
    return;
  }
  if (tournament.round === "final" && tournament.extraTimeForFinal) {
    winnerIndex = extraTimeGoals[0] > extraTimeGoals[1] ? 0 : 1;
    tournament.extraTimeForFinal = false;
  }
  tournament.finalResult = {
    playerGoals,
    opponentGoals,
    extraTimeGoals: extraTimeActive ? [...extraTimeGoals] : null,
    winner: winnerIndex === null ? null : matchTeams[winnerIndex].club
  };
  if (winnerIndex === null) {
    showTournamentBracket(
      "FINAL EMPATADA",
      "La final ha terminado empatada.",
      "VOLVER AL MENÚ",
      returnToMenu
    );
    return;
  }
  const champion = matchTeams[winnerIndex];
  const playerWon = champion.controlPlayer === 1;
  showTournamentBracket(
    playerWon ? "¡CAMPEÓN DE EUROPA!" : "COMPETICIÓN FINALIZADA",
    playerWon
      ? `¡Has conquistado la UEFA Champions League con ${tournament.playerClub.club_name}! 🏆`
      : `${champion.club.club_name} ha ganado la final. Marcador: ${playerGoals} - ${opponentGoals}.`,
    "VOLVER AL MENÚ",
    returnToMenu
  );
}


function resetCompetitionSideSelection() {
  friendlyAssignments[1] = null;
  friendlyAssignments[2] = null;
  friendlyJoinOrder = [];
  friendlySidePositions[1] = 0;
  friendlySidePositions[2] = 0;
  renderFriendlySideSelection();
  const match = getCompetitionCurrentMatch();
  const label = match?.round === "final" ? "GRAN FINAL" : `SEMIFINAL ${match?.semiIndex === 0 ? "1" : "2"} · ${match?.leg === 1 ? "IDA" : "VUELTA"}`;
  const [localClub, awayClub] = getCompetitionMatchClubs(match);
  const localInfo = document.getElementById("competitionLocalClubInfo");
  const awayInfo = document.getElementById("competitionAwayClubInfo");
  renderClubCard("competitionLocalClubInfo", localClub);
  renderClubCard("competitionAwayClubInfo", awayClub);
  localInfo.classList.remove("hidden");
  awayInfo.classList.remove("hidden");
  document.getElementById("sideSelectionEyebrow").textContent = "UEFA CHAMPIONS LEAGUE · COMPETENCIA";
  document.getElementById("sideSelectionTitle").textContent = "Elige tu bando";
  document.querySelector("#friendlySidesScreen .friendly-instructions").textContent =
    `${label}. Elige LOCAL, NEUTRAL o VISITANTE. Puedes cambiar de equipo en el siguiente partido.`;
  document.querySelector("#friendlySidesScreen .selection-hint").textContent =
    "Jugador 1: A / D · Jugador 2: ← / → · Centro: no participar (simulación CPU)";
}
function getCompetitionCurrentMatch() {
  if (!tournament || tournament.kind !== "competition") return null;
  return tournament.schedule[tournament.scheduleIndex] || null;
}
function beginCompetitionTournament() {
  if (clubs.length < 4) return;
  const drawn = shuffleClubs(clubs).slice(0, 4);
  tournament = {
    kind: "competition",
    difficulty: document.getElementById("competitionDifficultySelect").value,
    clubs: drawn,
    semifinals: [
      { clubs: [drawn[0], drawn[1]], results: [null, null], winner: null },
      { clubs: [drawn[2], drawn[3]], results: [null, null], winner: null }
    ],
    finalists: null,
    finalResult: null,
    schedule: [
      { round: "semifinal", semiIndex: 0, leg: 1 },
      { round: "semifinal", semiIndex: 0, leg: 2 },
      { round: "semifinal", semiIndex: 1, leg: 1 },
      { round: "semifinal", semiIndex: 1, leg: 2 },
      { round: "final", leg: 1 }
    ],
    scheduleIndex: 0,
    competitionExtraTimeSemi: false,
    competitionExtraTimeFinal: false
  };
  tournamentMode = true;
  gameMode = "cpu";
  showTournamentBracket(
    "SORTEO COMPLETADO",
    "Estos son los cuatro clubes sorteados. Se disputarán las dos semifinales a ida y vuelta y después la final. Pulsa para comenzar el primer encuentro.",
    "COMENZAR COMPETICIÓN",
    promptCompetitionMatch
  );
}
function promptCompetitionMatch() {
  if (!tournament || tournament.kind !== "competition") return;
  if (tournament.scheduleIndex >= tournament.schedule.length) return;
  resetCompetitionSideSelection();
  showScreen("friendlySides");
}
function getCompetitionMatchClubs(match = getCompetitionCurrentMatch()) {
  if (match.round === "final") return tournament.finalists;
  const pair = tournament.semifinals[match.semiIndex].clubs;
  return match.leg === 1 ? pair : [pair[1], pair[0]];
}
function configureCompetitionTeams(leftClub, rightClub) {
  const assignments = { local: [], away: [] };
  [1, 2].forEach(player => {
    const side = friendlyAssignments[player];
    if (side) assignments[side].push(player);
  });
  return [leftClub, rightClub].map((club, index) => {
    const team = createTeam(club, index);
    const players = assignments[index === 0 ? "local" : "away"];
    const ordered = friendlyJoinOrder.filter(player => players.includes(player));
    team.controllers = { player: 0, goalkeeper: 0 };
    if (ordered.length === 1) {
      team.controllers.player = ordered[0];
      team.controllers.goalkeeper = ordered[0];
    } else if (ordered.length === 2) {
      team.controllers.player = ordered[0];
      team.controllers.goalkeeper = ordered[1];
    }
    team.controlPlayer = team.controllers.player || 0;
    return team;
  });
}
function launchCompetitionMatch(leftClub, rightClub) {
  matchTeams = configureCompetitionTeams(leftClub, rightClub);
  selectedTeams = [leftClub, rightClub];
  score = [0, 0];
  remainingTime = HALF_SECONDS;
  currentHalf = 1;
  extraTimeActive = false;
  extraTimeGoals = [0, 0];
  matchState = "kickoff";
  kickoffTeam = 0;
  goalPauseRemaining = 0;
  goalPauseGoalRect = null;
  pendingMatchFinish = null;
  cpuKickoffTimer = 0;
  keys = {};
  prepareKickoffPositions();
  updateHud();
  updateControlsText();
  document.getElementById("matchOverlay").classList.add("hidden");
  document.getElementById("viewBracket").classList.remove("hidden");
  showScreen("game");
  startMatchMusic();
  lastFrame = performance.now();
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(gameLoop);
}
function startCompetitionMatch() {
  const [leftClub, rightClub] = getCompetitionMatchClubs();
  const currentMatch = getCompetitionCurrentMatch();
  cpuDifficulty = currentMatch.round === "final"
    ? (tournament.difficulty === "amateur" ? "professional" : "legend")
    : tournament.difficulty;
  const localPlayers = [1, 2].filter(player => friendlyAssignments[player] === "local");
  const awayPlayers = [1, 2].filter(player => friendlyAssignments[player] === "away");
  gameMode = localPlayers.length && awayPlayers.length ? "pvp" : "cpu";
  launchCompetitionMatch(leftClub, rightClub);
}
function randomCompetitionScore() {
  return Math.floor(Math.random() * 5);
}
function getSemiDecision(semi) {
  const [a, b] = semi.clubs;
  const first = semi.results[0];
  const second = semi.results[1];
  const points = [0, 0];
  [first, second].forEach(result => {
    if (result[0] > result[1]) points[0] += 3;
    else if (result[0] < result[1]) points[1] += 3;
    else { points[0]++; points[1]++; }
  });
  const goalsA = first[0] + second[0];
  const goalsB = first[1] + second[1];
  if (points[0] !== points[1]) return { winner: points[0] > points[1] ? a : b, points, goalsA, goalsB };
  if (goalsA !== goalsB) return { winner: goalsA > goalsB ? a : b, points, goalsA, goalsB };
  return { winner: null, points, goalsA, goalsB };
}
function finishCompetitionSemi(index, winner) {
  tournament.semifinals[index].winner = winner;
  if (tournament.semifinals.every(semi => semi.winner)) {
    tournament.finalists = tournament.semifinals.map(semi => semi.winner);
  }
}
function simulateCurrentCompetitionMatch() {
  const match = getCompetitionCurrentMatch();
  if (!match) return;
  if (match.round === "semifinal") {
    const semi = tournament.semifinals[match.semiIndex];
    const result = [randomCompetitionScore(), randomCompetitionScore()];
    semi.results[match.leg - 1] = result;
    let message = `Partido simulado: ${result[0]} - ${result[1]}.`;
    if (match.leg === 2) {
      let decision = getSemiDecision(semi);
      if (!decision.winner) {
        const extra = Math.floor(Math.random() * 2) + 1;
        decision.winner = Math.random() < 0.5 ? semi.clubs[0] : semi.clubs[1];
        message += ` La eliminatoria quedó igualada y se decidió en una prórroga simulada (${extra} goles).`;
      }
      finishCompetitionSemi(match.semiIndex, decision.winner);
      message += ` Se clasifica ${decision.winner.club_name}.`;
    }
    tournament.scheduleIndex++;
    const status = match.leg === 1 ? "IDA SIMULADA" : "VUELTA SIMULADA";
    showTournamentBracket(status, message, tournament.scheduleIndex < 4 ? "SIGUIENTE PARTIDO" : "CONTINUAR", advanceCompetition);
    return;
  }
  const result = [randomCompetitionScore(), randomCompetitionScore()];
  let winner;
  let extraTime = null;
  if (result[0] === result[1]) {
    extraTime = Math.random() < 0.5 ? [2, 1] : [1, 2];
    winner = tournament.finalists[extraTime[0] > extraTime[1] ? 0 : 1];
  } else {
    winner = tournament.finalists[result[0] > result[1] ? 0 : 1];
  }
  tournament.finalResult = { goals: result, winner, extraTime, simulated: true };
  tournament.scheduleIndex++;
  const detail = extraTime ? `Empate en el tiempo reglamentario; prórroga simulada ${extraTime[0]} - ${extraTime[1]}. ` : "";
  showTournamentBracket("FINAL SIMULADA", `Resultado: ${result[0]} - ${result[1]}. ${detail}${winner.club_name} gana la UEFA Champions League.`, "FINALIZAR", finishCompetition);
}
function advanceCompetition() {
  if (tournament.scheduleIndex >= tournament.schedule.length) {
    finishCompetition();
    return;
  }
  promptCompetitionMatch();
}
function finishCompetition() {
  const champion = tournament.finalResult?.winner;
  showTournamentBracket(
    "COMPETICIÓN FINALIZADA",
    champion ? `🏆 ${champion.club_name} es el campeón de Europa.` : "La competición ha terminado.",
    "VOLVER AL MENÚ",
    returnToMenu
  );
}
function handleCompetitionMatchEnd(winnerIndex, matchMessage) {
  const match = getCompetitionCurrentMatch();
  if (!match) return;
  const finalGoals = score.map((goals, index) => goals + (extraTimeActive ? extraTimeGoals[index] : 0));
  if (match.round === "semifinal") {
    const semi = tournament.semifinals[match.semiIndex];
    if (tournament.competitionExtraTimeSemi) {
      const winner = matchTeams[extraTimeGoals[0] > extraTimeGoals[1] ? 0 : 1].club;
      tournament.competitionExtraTimeSemi = false;
      finishCompetitionSemi(match.semiIndex, winner);
      tournament.scheduleIndex++;
      showTournamentBracket("SEMIFINAL RESUELTA", `La eliminatoria terminó igualada en puntos y goles. ${winner.club_name} se clasifica tras la prórroga.`, "SIGUIENTE PARTIDO", advanceCompetition);
      return;
    }
    const clubA = semi.clubs[0];
    const leftIsA = matchTeams[0].club.folder === clubA.folder;
    semi.results[match.leg - 1] = leftIsA ? finalGoals : [...finalGoals].reverse();
    if (match.leg === 1) {
      tournament.scheduleIndex++;
      showTournamentBracket("SEMIFINAL · IDA FINALIZADA", `${matchMessage}. Se jugará ahora el partido de vuelta.`, "CONTINUAR", advanceCompetition);
      return;
    }
    const decision = getSemiDecision(semi);
    if (!decision.winner) {
      tournament.competitionExtraTimeSemi = true;
      startExtraTime("La eliminatoria está igualada en puntos y diferencia de goles. ¡Prórroga! El primero en marcar 2 goles se clasifica.");
      return;
    }
    finishCompetitionSemi(match.semiIndex, decision.winner);
    tournament.scheduleIndex++;
    showTournamentBracket("SEMIFINAL COMPLETADA", `${decision.winner.club_name} se clasifica para la final. Puntos: ${decision.points[0]} - ${decision.points[1]} · Global: ${decision.goalsA} - ${decision.goalsB}.`, "SIGUIENTE PARTIDO", advanceCompetition);
    return;
  }
  if (tournament.competitionExtraTimeFinal) {
    const winner = matchTeams[extraTimeGoals[0] > extraTimeGoals[1] ? 0 : 1].club;
    tournament.competitionExtraTimeFinal = false;
    tournament.finalResult = { goals: finalGoals, winner, extraTime: [...extraTimeGoals] };
    tournament.scheduleIndex++;
    showTournamentBracket("¡FINALIZADA!", `${winner.club_name} gana la final en la prórroga y se proclama campeón de Europa.`, "FINALIZAR", finishCompetition);
    return;
  }
  if (winnerIndex === null) {
    tournament.competitionExtraTimeFinal = true;
    startExtraTime("La final ha terminado empatada. ¡Prórroga! El primer equipo que marque 2 goles será campeón.");
    return;
  }
  const winner = matchTeams[winnerIndex].club;
  tournament.finalResult = { goals: finalGoals, winner };
  tournament.scheduleIndex++;
  showTournamentBracket("¡FINALIZADA!", `${winner.club_name} gana la final por ${finalGoals[0]} - ${finalGoals[1]} y se proclama campeón de Europa.`, "FINALIZAR", finishCompetition);
}

function bracketClub(club, scoreText = "", status = "") {
  if (!club) return '<div class="bracket-team"><span class="bracket-team-name">Por determinar</span></div>';
  const shield = new URL(club.club_shield, PROJECT_BASE).href;
  return `<div class="bracket-team ${status}">
    <img src="${shield}" alt="">
    <span class="bracket-team-name">${club.club_name}</span>
    <strong class="bracket-team-score">${scoreText}</strong>
  </div>`;
}

function bracketMatchCard(title, clubA, clubB, lines, winner = null, state = "") {
  const teamAStatus = winner && winner.folder === clubA?.folder ? "qualified" : "";
  const teamBStatus = winner && winner.folder === clubB?.folder ? "qualified" : "";
  return `<article class="bracket-match ${state}">
    <h3>${title}</h3>
    ${bracketClub(clubA, "", teamAStatus)}
    ${bracketClub(clubB, "", teamBStatus)}
    <div class="bracket-match-scores">${lines.map(line => `<p>${line}</p>`).join("")}</div>
    ${winner ? `<div class="bracket-qualified">CLASIFICADO: ${winner.club_name}</div>` : ""}
  </article>`;
}

function renderTournamentBracket() {
  if (!tournament) return;
  if (tournament.kind === "competition") {
    const semiCards = tournament.semifinals.map((semi, index) => {
      const lines = semi.results.map((result, leg) => result
        ? `${leg === 0 ? "Ida" : "Vuelta"}: ${result[0]} - ${result[1]}`
        : `${leg === 0 ? "Ida" : "Vuelta"}: Pendiente`);
      const winner = semi.winner;
      return bracketMatchCard(`SEMIFINAL ${index + 1} · IDA Y VUELTA`, semi.clubs[0], semi.clubs[1], lines, winner, winner ? "completed" : "current");
    }).join("");
    const finalLines = tournament.finalResult
      ? [`Final: ${tournament.finalResult.goals[0]} - ${tournament.finalResult.goals[1]}`]
      : ["Final: Pendiente"];
    const finalWinner = tournament.finalResult?.winner || null;
    const finalCard = bracketMatchCard("FINAL · PARTIDO ÚNICO", tournament.finalists?.[0] || null, tournament.finalists?.[1] || null, finalLines, finalWinner, tournament.finalists ? "current" : "");
    document.getElementById("tournamentBracket").innerHTML = `
      <section class="bracket-column"><h2>SEMIFINALES</h2>${semiCards}</section>
      <div class="bracket-connector" aria-hidden="true">›</div>
      <section class="bracket-column final-column"><h2>FINAL</h2>${finalCard}
      <div class="bracket-champion">${finalWinner ? `🏆 CAMPEÓN: ${finalWinner.club_name}` : "🏆 Por decidir"}</div></section>`;
    document.getElementById("bracketStatus").textContent = finalWinner ? "COMPETICIÓN FINALIZADA" : tournament.finalists ? "GRAN FINAL" : "SEMIFINALES";
    return;
  }
  const cpu = tournament.cpuSemi;
  const semi = tournament.playerSemi;
  const cpuWinner = cpu.winner;
  const playerWinner = semi.winner;
  const cpuLines = [
    `Ida: ${cpu.firstLeg[0]} - ${cpu.firstLeg[1]}`,
    `Vuelta: ${cpu.secondLeg[1]} - ${cpu.secondLeg[0]}`,
    `Global: ${cpu.totalA} - ${cpu.totalB}`
  ];
  const playerLines = [
    `Ida: ${semi.firstLeg ? `${semi.firstLeg[0]} - ${semi.firstLeg[1]}` : "Pendiente"}`,
    `Vuelta: ${semi.secondLeg ? `${semi.secondLeg[0]} - ${semi.secondLeg[1]}` : "Pendiente"}`,
    `Global: ${semi.aggregatePlayer === null ? "—" : `${semi.aggregatePlayer} - ${semi.aggregateOpponent}`}`
  ];
  const finalLines = tournament.finalResult
    ? [`Final: ${tournament.finalResult.playerGoals} - ${tournament.finalResult.opponentGoals}`]
    : ["Final: Pendiente"];
  const playerSemiCard = bracketMatchCard(
    "SEMIFINAL 1 · IDA Y VUELTA",
    tournament.playerClub,
    tournament.semifinalOpponent,
    playerLines,
    playerWinner,
    tournament.round === "semifinal" ? "current" : ""
  );
  const cpuSemiCard = bracketMatchCard(
    "SEMIFINAL 2 · CPU",
    cpu.clubA,
    cpu.clubB,
    cpuLines,
    cpuWinner,
    "simulated"
  );
  const finalWinner = tournament.finalResult?.winner || null;
  const finalParticipantsReady = tournament.round === "final" || Boolean(tournament.finalResult);
  const finalCard = bracketMatchCard(
    "FINAL · PARTIDO ÚNICO",
    finalParticipantsReady ? (playerWinner || tournament.playerClub) : null,
    finalParticipantsReady ? cpuWinner : null,
    finalLines,
    finalWinner,
    tournament.round === "final" ? "current" : ""
  );
  document.getElementById("tournamentBracket").innerHTML = `
    <section class="bracket-column">
      <h2>SEMIFINALES</h2>
      ${playerSemiCard}
      ${cpuSemiCard}
    </section>
    <div class="bracket-connector" aria-hidden="true">›</div>
    <section class="bracket-column final-column">
      <h2>FINAL</h2>
      ${finalCard}
      <div class="bracket-champion">${finalWinner ? `🏆 CAMPEÓN: ${finalWinner.club_name}` : "🏆 Por decidir"}</div>
    </section>`;
  document.getElementById("bracketStatus").textContent =
    tournament.finalResult?.winner ? "COMPETICIÓN FINALIZADA" :
    tournament.round === "final" ? "GRAN FINAL" :
    semi.secondLeg ? "SEMIFINAL COMPLETADA" :
    semi.firstLeg ? "SEMIFINAL · VUELTA PENDIENTE" : "SEMIFINALES · IDA PENDIENTE";
}

function openTournamentBracket() {
  if (!tournamentMode || !tournament) return;
  matchStateBeforeBracket = matchState;
  showTournamentBracket(
    tournament.round === "final" ? "GRAN FINAL" : `SEMIFINAL · ${tournament.leg === 1 ? "IDA" : "VUELTA"}`,
    "Consulta el progreso de todas las eliminatorias. Puedes volver al partido cuando quieras.",
    "VOLVER AL PARTIDO",
    () => {
      matchState = matchStateBeforeBracket;
      showScreen("game");
      lastFrame = performance.now();
    }
  );
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

function drawKickoffPlayerIndicators() {
  matchTeams.forEach(team => {
    const assignments = team.controllers || {};
    ["player", "goalkeeper"].forEach(role => {
      const playerNumber = assignments[role];
      if (!playerNumber) return;
      const character = team[role];
      const icon = playerIcons[playerNumber];
      const centerX = character.x + character.width / 2;
      const topY = character.y - 43;
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#07152b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(centerX, topY + 35);
      ctx.lineTo(centerX - 10, topY + 19);
      ctx.lineTo(centerX + 10, topY + 19);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (icon?.complete && icon.naturalWidth) {
        ctx.drawImage(icon, centerX - 17, topY - 17, 34, 34);
      }
      ctx.restore();
    });
  });
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
  if (matchState === "kickoff" && !tournamentMode) drawKickoffPlayerIndicators();
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
  document.getElementById("sideSelectionEyebrow").textContent = "MODO AMISTOSO";
  document.getElementById("competitionLocalClubInfo").classList.add("hidden");
  document.getElementById("competitionAwayClubInfo").classList.add("hidden");
  document.getElementById("sideSelectionTitle").textContent = "Elige tu bando";
  document.querySelector("#friendlySidesScreen .friendly-instructions").textContent = "Muévete entre LOCAL, NEUTRAL y VISITANTE. Puedes cambiar de bando en cualquier momento antes de continuar.";
  document.querySelector("#friendlySidesScreen .selection-hint").textContent = "Jugador 1: A / D · Jugador 2: ← / → · Centro: no jugar";
  tournamentMode = false;
  tournament = null;
  friendlyAssignments[1] = null;
  friendlyAssignments[2] = null;
  friendlyJoinOrder = [];
  friendlySidePositions[1] = 0;
  friendlySidePositions[2] = 0;
  renderFriendlySideSelection();
  showScreen("friendlySides");
});
document.getElementById("friendlySidesContinue").addEventListener("click", continueToFriendlyClubs);
document.getElementById("backToSides").addEventListener("click", () => {
  renderFriendlySideSelection();
  showScreen("friendlySides");
});
document.getElementById("championsMode").addEventListener("click", () => showScreen("championsMode"));
document.getElementById("individualMode").addEventListener("click", () => {
  updateChampionsClubCard();
  showScreen("champions");
});
document.getElementById("competitionMode").addEventListener("click", () => showScreen("competitionSetup"));
document.getElementById("championsModeBack").addEventListener("click", () => showScreen("menu"));
document.getElementById("competitionSetupBack").addEventListener("click", () => showScreen("championsMode"));
document.getElementById("startCompetition").addEventListener("click", beginCompetitionTournament);
document.getElementById("championsClubSelect").addEventListener("change", updateChampionsClubCard);
document.getElementById("championsBack").addEventListener("click", () => showScreen("championsMode"));
document.getElementById("startChampions").addEventListener("click", beginChampionsTournament);
document.getElementById("viewBracket").addEventListener("click", openTournamentBracket);
document.getElementById("bracketBack").addEventListener("click", () => {
  if (typeof bracketContinueAction === "function") bracketContinueAction();
});
document.getElementById("cpuDifficultySelect").addEventListener("change", event => {
  cpuDifficulty = event.target.value;
});
document.querySelectorAll(".side-join").forEach(button => {
  button.addEventListener("click", () => assignFriendlyPlayer(Number(button.dataset.player), button.dataset.side));
});
document.getElementById("localClubSelect").addEventListener("change", updateFriendlyClubCards);
document.getElementById("awayClubSelect").addEventListener("change", updateFriendlyClubCards);


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
  if (!screens.friendlySides.classList.contains("hidden")) {
    const key = event.key.toLowerCase();
    if (key === "a" || key === "d") {
      event.preventDefault();
      setFriendlySide(1, friendlySidePositions[1] + (key === "a" ? -1 : 1));
      return;
    }
    if (key === "arrowleft" || key === "arrowright") {
      event.preventDefault();
      setFriendlySide(2, friendlySidePositions[2] + (key === "arrowleft" ? -1 : 1));
      return;
    }
    if (key === "enter") {
      event.preventDefault();
      continueToFriendlyClubs();
      return;
    }
    if (key === "escape") {
      event.preventDefault();
      showScreen("menu");
      return;
    }
    return;
  }
  // Durante el silbato final no se aceptan controles del partido.
  if (matchState === "final_whistle") {
    event.preventDefault();
    return;
  }
  if (matchState === "kickoff") {
    const kickoffSide = matchTeams[kickoffTeam];
    const attackDirection = kickoffTeam === 0 ? 1 : -1;
    const kickoffController = kickoffSide.controllers?.player ?? kickoffSide.controlPlayer ?? 0;
    const keyForKickoff = kickoffController === 1
      ? (attackDirection > 0 ? "d" : "a")
      : kickoffController === 2
        ? "arrow" + (attackDirection > 0 ? "right" : "left")
        : null;
    if (keyForKickoff && event.key.toLowerCase() === keyForKickoff) {
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
// Intenta iniciar la música desde la pantalla de título.
// Si el navegador bloquea la reproducción automática, introStart/ENTER la iniciarán
// en la primera interacción del usuario.
startMenuMusic();