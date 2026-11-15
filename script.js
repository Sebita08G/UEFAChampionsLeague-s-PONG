
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const paddleWidth = 12;
const paddleHeight = 90;

const MAX_SCORE = 10;
const INITIAL_SPEED = 5;
const SPEED_INCREASE = 0.5;
const MAX_SPEED = 12;

let playerScore = 0;
let opponentScore = 0;
let gameOver = false;

const player = {
    x: 20,
    y: 180,
    speed: 7
};

const opponent = {
    x: 768,
    y: 180,
    speed: 4
};

const ball = {
    x: 400,
    y: 225,
    radius: 9,
    speedX: INITIAL_SPEED,
    speedY: 3
};

let keys = {};

document.addEventListener("keydown", (e) => {
    keys[e.key] = true;

    if (["ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
    }
});

document.addEventListener("keyup", (e) => {
    keys[e.key] = false;
});

function drawPaddle(x, y) {
    ctx.fillStyle = "white";
    ctx.fillRect(x, y, paddleWidth, paddleHeight);
}

function drawBall() {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#00ff99";
    ctx.fill();
    ctx.closePath();
}

function drawCenterLine() {
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = "#555";
    ctx.beginPath();
    ctx.moveTo(400, 0);
    ctx.lineTo(400, 450);
    ctx.stroke();
    ctx.setLineDash([]);
}

function update() {
    if (gameOver) return;

    // Moviment del jugador
    if (keys["ArrowUp"]) {
        player.y -= player.speed;
    }

    if (keys["ArrowDown"]) {
        player.y += player.speed;
    }

    player.y = Math.max(
        0,
        Math.min(canvas.height - paddleHeight, player.y)
    );

    // Moviment de la CPU
    let target = ball.y - paddleHeight / 2;

    if (opponent.y < target) {
        opponent.y += opponent.speed;
    } else if (opponent.y > target) {
        opponent.y -= opponent.speed;
    }

    opponent.y = Math.max(
        0,
        Math.min(canvas.height - paddleHeight, opponent.y)
    );

    // Moviment de la pilota
    ball.x += ball.speedX;
    ball.y += ball.speedY;

    // Rebot contra les parets
    if (
        ball.y - ball.radius <= 0 ||
        ball.y + ball.radius >= canvas.height
    ) {
        ball.speedY *= -1;
    }

    // Col·lisió amb el jugador
    if (
        ball.speedX < 0 &&
        ball.x - ball.radius <= player.x + paddleWidth &&
        ball.x + ball.radius >= player.x &&
        ball.y + ball.radius >= player.y &&
        ball.y - ball.radius <= player.y + paddleHeight
    ) {
        ball.x = player.x + paddleWidth + ball.radius;

        ball.speedX = Math.abs(ball.speedX);
        ball.speedY += (
            ball.y - (player.y + paddleHeight / 2)
        ) * 0.08;

        increaseBallSpeed();
    }

    // Col·lisió amb la CPU
    if (
        ball.speedX > 0 &&
        ball.x + ball.radius >= opponent.x &&
        ball.x - ball.radius <= opponent.x + paddleWidth &&
        ball.y + ball.radius >= opponent.y &&
        ball.y - ball.radius <= opponent.y + paddleHeight
    ) {
        ball.x = opponent.x - ball.radius;

        ball.speedX = -Math.abs(ball.speedX);
        ball.speedY += (
            ball.y - (opponent.y + paddleHeight / 2)
        ) * 0.08;

        increaseBallSpeed();
    }

    // Punt per a la CPU
    if (ball.x < 0) {
        opponentScore++;
        updateScore();
        checkWinner();

        if (!gameOver) resetBall();
    }

    // Punt per al jugador
    if (ball.x > canvas.width) {
        playerScore++;
        updateScore();
        checkWinner();

        if (!gameOver) resetBall();
    }
}

// Augmentar la velocitat progressivament
function increaseBallSpeed() {
    let direction = Math.sign(ball.speedX);

    let currentSpeed = Math.sqrt(
        ball.speedX * ball.speedX +
        ball.speedY * ball.speedY
    );

    let newSpeed = Math.min(
        currentSpeed + SPEED_INCREASE,
        MAX_SPEED
    );

    let angle = Math.atan2(ball.speedY, ball.speedX);

    ball.speedX = Math.cos(angle) * newSpeed;
    ball.speedY = Math.sin(angle) * newSpeed;

    // Assegurar que continua avançant cap a l'altre costat
    ball.speedX = direction * Math.abs(ball.speedX);
}

function updateScore() {
    document.getElementById("playerScore").textContent = playerScore;
    document.getElementById("opponentScore").textContent = opponentScore;
}

// Comprovar qui ha guanyat
function checkWinner() {
    if (playerScore >= MAX_SCORE) {
        endGame("HAS GUANYAT!", "victory");
    } else if (opponentScore >= MAX_SCORE) {
        endGame("HAS PERDUT!", "defeat");
    }
}

function endGame(message, result) {
    gameOver = true;

    const endScreen = document.getElementById("endScreen");
    const endMessage = document.getElementById("endMessage");
    const finalScore = document.getElementById("finalScore");

    endMessage.textContent = message;
    endMessage.style.color =
        result === "victory" ? "#00ff99" : "#ff4444";

    finalScore.textContent =
        `Resultat final: ${playerScore} - ${opponentScore}`;

    endScreen.classList.remove("hidden");
}

// Reiniciar pilota després d'un punt
function resetBall() {
    ball.x = canvas.width / 2;
    ball.y = canvas.height / 2;

    ball.speedX = Math.random() > 0.5
        ? INITIAL_SPEED
        : -INITIAL_SPEED;

    ball.speedY = (Math.random() - 0.5) * 6;
}

// Dibuixar el joc
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawCenterLine();
    drawPaddle(player.x, player.y);
    drawPaddle(opponent.x, opponent.y);
    drawBall();
}

// Bucle principal
function gameLoop() {
    update();
    draw();

    requestAnimationFrame(gameLoop);
}

// Reiniciar tota la partida
function restartGame() {
    playerScore = 0;
    opponentScore = 0;
    gameOver = false;

    player.y = 180;
    opponent.y = 180;

    ball.x = canvas.width / 2;
    ball.y = canvas.height / 2;

    ball.speedX = INITIAL_SPEED;
    ball.speedY = 3;

    keys = {};

    updateScore();

    document.getElementById("endScreen").classList.add("hidden");
}

gameLoop();

  