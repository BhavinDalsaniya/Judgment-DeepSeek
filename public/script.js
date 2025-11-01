const socket = io();
const playerNameInput = document.getElementById("playerName");
const roomCodeInput = document.getElementById("roomCode");
const deckCountSelect = document.getElementById("deckCount");
const maxRoundCardsSelect = document.getElementById("maxRoundCards");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const startGameBtn = document.getElementById("startGameBtn");
const lobby = document.getElementById("lobby");
const setup = document.getElementById("setup");
const playersList = document.getElementById("players");
const gameDiv = document.getElementById("game");
const roundInfo = document.getElementById("roundInfo");
const handDiv = document.getElementById("hand");

let roomCode = "";
let myCards = [];
let justDealt = false; // true right after roundStart until first yourCards
let isMyTurn = false;
let myName = "";
let playersInRoom = [];
let previousTotals = {};

function renderScoreHeader() {
  const header = document.getElementById("scoreHeader");
  if (!header) return;
  const cols = ["Round", ...playersInRoom];
  header.innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
}

function resetScoreboardIfNeeded(round) {
  if (round !== 1) return;
  const body = document.getElementById("scoreBody");
  const totalsDiv = document.getElementById("scoreTotals");
  if (body) body.innerHTML = "";
  if (totalsDiv) totalsDiv.innerHTML = "";
  // Initialize previous totals to 0 for all known players
  previousTotals = {};
  playersInRoom.forEach(p => { previousTotals[p] = 0; });
  renderScoreHeader();
}

function updateScoreTotals(currentTotals) {
  const totalsDiv = document.getElementById("scoreTotals");
  if (!totalsDiv) return;
  totalsDiv.innerHTML = playersInRoom.map(p => `<strong>${p}</strong>: ${currentTotals[p] ?? 0}`).join(" ");
}

function appendRoundRow(round, currentTotals) {
  const body = document.getElementById("scoreBody");
  if (!body) return;
  // Ensure player order exists; if not, infer from totals keys
  if (!playersInRoom || playersInRoom.length === 0) {
    playersInRoom = Object.keys(currentTotals);
    renderScoreHeader();
  }
  const deltas = playersInRoom.map(p => (currentTotals[p] ?? 0) - (previousTotals[p] ?? 0));
  const rowHtml = `<tr><td>${round}</td>${deltas.map(d => `<td>${d >= 0 ? '+' + d : d}</td>`).join("")}</tr>`;
  body.insertAdjacentHTML("beforeend", rowHtml);
  // Update previous totals snapshot
  playersInRoom.forEach(p => { previousTotals[p] = currentTotals[p] ?? 0; });
}

function suitSymbol(suit) {
  if (suit === "Spades") return "♠";
  if (suit === "Diamonds") return "♦";
  if (suit === "Clubs") return "♣";
  if (suit === "Hearts") return "♥";
  return suit;
}

function suitColor(suit) {
  return (suit === "Diamonds" || suit === "Hearts") ? "#dc2626" : "#111827";
}

function formatCardHTML(card) {
  const sym = suitSymbol(card.suit);
  const color = suitColor(card.suit);
  return `<div class="card-face">
            <div class="rank">${card.rank}</div>
            <div class="suit" style="color:${color}">${sym}</div>
          </div>`;
}

function formatCardText(card) {
  return `${card.rank} ${suitSymbol(card.suit)}`;
}

// Track current round header data to re-render with optional lead suit
let currentRound = 0;
let currentCardsThisRound = 0;
let currentTrump = "";
let currentAscending = true;

function renderRoundHeader(leadSuit = null) {
  const trumpSym = suitSymbol(currentTrump);
  const trumpColor = suitColor(currentTrump);
  const leadHtml = leadSuit ? ` | Lead: <span style="color:${suitColor(leadSuit)}">${suitSymbol(leadSuit)}</span>` : "";
  roundInfo.innerHTML = `Round ${currentRound} | Cards: ${currentCardsThisRound} | Trump: <span style="color:${trumpColor}">${trumpSym}</span> | ${currentAscending ? "Ascending" : "Descending"}${leadHtml}`;
}

createRoomBtn.onclick = () => {
  const playerName = playerNameInput.value.trim();
  if (!playerName) {
    alert("Please enter your name!");
    return;
  }
  myName = playerName;
  roomCode = roomCodeInput.value.trim() || Math.random().toString(36).substring(2, 6).toUpperCase();

  const number_of_decks = parseInt(deckCountSelect.value);
  const max_round_cards = parseInt(maxRoundCardsSelect.value);

  // Validate the game configuration
  const maxPossibleCards = number_of_decks * 52;
  const maxPlayersAllowed = Math.floor(maxPossibleCards / max_round_cards);
  
  if (maxPlayersAllowed < 2) {
    alert("Invalid configuration: Not enough cards for minimum 2 players. Please adjust deck count or max cards per round.");
    return;
  }

  socket.emit("createRoom", {
    roomCode,
    playerName,
    maxPlayers: Math.min(4, maxPlayersAllowed),
    number_of_decks,
    max_round_cards
  });
};

joinRoomBtn.onclick = () => {
  const playerName = playerNameInput.value.trim();
  myName = playerName;
  roomCode = roomCodeInput.value.trim();
  
  if (!playerName) {
    alert("Please enter your name!");
    return;
  }
  if (!roomCode) {
    alert("Please enter a room code!");
    return;
  }
  
  socket.emit("joinRoom", { roomCode, playerName });
};

startGameBtn.onclick = () => {
  socket.emit("startGame", { roomCode });
};

socket.on("roomCreated", (code) => {
  setup.classList.add("hidden");
  lobby.classList.remove("hidden");
  startGameBtn.classList.remove("hidden");
  roomCodeInput.value = code;
  alert(`Room created! Share this code with other players: ${code}`);
  console.log("Room created:", code);
});

socket.on("playerList", (data) => {
  const { players, config } = data;
  playersInRoom = players.slice();
  
  // Update players list
  playersList.innerHTML = "";
  players.forEach(name => {
    const li = document.createElement("li");
    li.textContent = name;
    playersList.appendChild(li);
  });

  // Update game configuration display
  const gameConfigDiv = document.getElementById("gameConfig");
  if (config) {
    gameConfigDiv.innerHTML = `
      <p>🎴 Number of Decks: ${config.decks}</p>
      <p>📊 Max Cards per Round: ${config.maxCards}</p>
      <p>👥 Maximum Players: ${config.maxPlayers}</p>
    `;
  }

  // Show start button only if there are at least 2 players
  startGameBtn.classList.toggle("hidden", players.length < 2);
});

socket.on("roundStart", ({ round, trump, cardsThisRound, ascending }) => {
  lobby.classList.add("hidden");
  gameDiv.classList.remove("hidden");
  currentRound = round;
  currentTrump = trump;
  currentCardsThisRound = cardsThisRound;
  currentAscending = ascending;
  renderRoundHeader();
  // Reset scoreboard for a fresh game at round 1
  resetScoreboardIfNeeded(round);
  
  // Clear any previous game state
  document.getElementById("predictions").innerHTML = "";
  document.getElementById("currentTrick").innerHTML = "";
  document.getElementById("gameMessages").innerHTML = "";
  document.getElementById("tricksWon").innerHTML = "";
  justDealt = true;
  
  showGameMessage(`Round ${round} started! Trump suit: ${trump}`);
});

socket.on("yourCards", (cards) => {
  myCards = cards;
  handDiv.innerHTML = "";
  cards.forEach((c, index) => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = formatCardHTML(c);
    div.setAttribute("data-index", index);
    div.onclick = () => playCard(index);
    handDiv.appendChild(div);
  });
  
  if (justDealt) {
    showGameMessage(`You received ${cards.length} cards. Look at your hand above.`);
    justDealt = false;
  }
});

socket.on("joinedRoom", (code) => {
  setup.classList.add("hidden");
  lobby.classList.remove("hidden");
  roomCode = code;
});

socket.on("errorMessage", msg => {
  alert(msg);
  console.error("Error:", msg);
  // If an invalid play was attempted during our turn, allow retry
  if (msg.includes("must follow the lead suit") || msg.includes("Invalid card selection")) {
    isMyTurn = true;
    handDiv.style.border = "2px solid #ffb703";
  }
});

// Prediction phase - FIXED: Show prediction input only when it's your turn AND after cards are visible
socket.on("requestPrediction", ({ playerOrder, currentPlayer, maxPrediction, isLast, forbidden }) => {
  console.log("Prediction requested. Current player:", currentPlayer, "My name:", myName);
  isMyTurn = (currentPlayer === myName);
  
  if (isMyTurn) {
    // Small delay to ensure cards are visible
    setTimeout(() => {
      showPredictionInput(maxPrediction, isLast, forbidden);
    }, 500);
  } else {
    showGameMessage(`Waiting for ${currentPlayer} to predict...`);
  }
});

socket.on("nextPlayerPredict", ({ currentPlayer, maxPrediction, isLast, forbidden }) => {
  console.log("Next player to predict:", currentPlayer);
  isMyTurn = (currentPlayer === myName);
  
  if (isMyTurn) {
    showGameMessage("It's your turn to predict!");
    // Prefer server-provided maxPrediction; fallback to hand size
    const maxPred = typeof maxPrediction === 'number' ? maxPrediction : myCards.length;
    showPredictionInput(maxPred, isLast, forbidden);
  } else {
    showGameMessage(`Waiting for ${currentPlayer} to predict...`);
  }
});

function showPredictionInput(maxPrediction, isLast = false, forbidden = null) {
  showGameMessage(`It's your turn to predict! How many tricks will you win? (0-${maxPrediction})`);
  
  // Create prediction UI
  const predictionDiv = document.createElement("div");
  predictionDiv.id = "predictionInput";
  predictionDiv.innerHTML = `
    <div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.2); border-radius: 5px;">
      <p>Make your prediction (0-${maxPrediction})${isLast && forbidden !== null ? ` — Note: ${forbidden} is disabled for last player` : ''}:</p>
      <div id="predictionButtons" style="display: flex; flex-wrap: wrap; gap: 5px; justify-content: center;">
        ${Array.from({length: maxPrediction + 1}, (_, i) => {
          const isForbidden = isLast && forbidden === i;
          const disabledAttr = isForbidden ? 'disabled' : '';
          const title = isForbidden ? 'Not allowed for last player this round' : '';
          const style = `padding: 8px 12px;${isForbidden ? ' opacity: 0.5; cursor: not-allowed; pointer-events: none;' : ''}`;
          return `<button ${disabledAttr} title="${title}" onclick="submitPrediction(${i})" style="${style}">${i}</button>`;
        }).join('')}
      </div>
    </div>
  `;
  
  const messagesDiv = document.getElementById("gameMessages");
  messagesDiv.appendChild(predictionDiv);
}

// Global function for prediction buttons
window.submitPrediction = function(prediction) {
  const predictionInput = document.getElementById("predictionInput");
  if (predictionInput) {
    predictionInput.remove();
  }
  
  socket.emit("makePrediction", { roomCode, prediction });
  showGameMessage(`You predicted: ${prediction} tricks`);
};

socket.on("predictionMade", ({ playerName, prediction }) => {
  showGameMessage(`${playerName} predicted ${prediction} tricks`);
});

socket.on("allPredictionsMade", (predictions) => {
  let predictionsHTML = "<h3>All Predictions:</h3>";
  Object.keys(predictions).forEach(player => {
    predictionsHTML += `<p>${player}: ${predictions[player]} tricks</p>`;
  });
  document.getElementById("predictions").innerHTML = predictionsHTML;
  showGameMessage("All predictions are in! Starting play phase...");
});

// Play phase
socket.on("playPhaseStart", ({ firstPlayer, playOrder }) => {
  showGameMessage(`Play phase started! ${firstPlayer} goes first.`);
});

socket.on("yourTurnToPlay", () => {
  isMyTurn = true;
  showGameMessage("🎯 It's your turn to play a card! Click on a card from your hand.");
  // Highlight hand or show some indication
  handDiv.style.border = "2px solid #ffb703";
});

socket.on("cardPlayed", ({ playerName, card }) => {
  showGameMessage(`${playerName} played ${formatCardText(card)}`);
  handDiv.style.border = "none";
  
  // Add to current trick display
  const currentTrickDiv = document.getElementById("currentTrick");
  // If this is the first card of the trick, update lead suit in header
  if (currentTrickDiv.childElementCount === 0) {
    renderRoundHeader(card.suit);
  }
  const cardDiv = document.createElement("div");
  cardDiv.className = "played-card";
  cardDiv.innerHTML = `${playerName}: ${formatCardHTML(card)}`;
  currentTrickDiv.appendChild(cardDiv);
});

socket.on("trickWon", ({ playerName, trick, tricksWon }) => {
  showGameMessage(`🎉 ${playerName} won the trick!`);
  
  // Update tricks won display
  let tricksHTML = "<h3>Tricks Won:</h3>";
  Object.keys(tricksWon).forEach(player => {
    tricksHTML += `<p>${player}: ${tricksWon[player]}</p>`;
  });
  document.getElementById("tricksWon").innerHTML = tricksHTML;
  
  // Clear current trick
  document.getElementById("currentTrick").innerHTML = "";
  // Reset lead suit indicator
  renderRoundHeader();
});

socket.on("nextTrick", ({ firstPlayer, playOrder }) => {
  showGameMessage(`Next trick! ${firstPlayer} leads.`);
});

socket.on("roundEnd", ({ predictions, tricksWon, scores }) => {
  let resultsHTML = "<h3>Round Results:</h3>";
  Object.keys(predictions).forEach(player => {
    const pred = predictions[player];
    const scoreChange = pred.predicted === pred.actual ? 
      `+${10 + pred.actual}` : 
      `-${Math.abs(pred.predicted - pred.actual)}`;
    
    resultsHTML += `
      <p><strong>${player}</strong>: Predicted ${pred.predicted}, Won ${pred.actual} → ${scoreChange}</p>
    `;
  });
  
  resultsHTML += "<h3>Total Scores:</h3>";
  Object.keys(scores).forEach(player => {
    resultsHTML += `<p><strong>${player}</strong>: ${scores[player]}</p>`;
  });
  
  document.getElementById("gameMessages").innerHTML = resultsHTML;

  // Update scoreboard: totals header and per-round row
  appendRoundRow(currentRound, scores);
  updateScoreTotals(scores);
});

socket.on("gameOver", ({ finalScores }) => {
  let finalHTML = "<h2>Game Over!</h2><h3>Final Scores:</h3>";
  Object.keys(finalScores).forEach(player => {
    finalHTML += `<p><strong>${player}</strong>: ${finalScores[player]}</p>`;
  });
  
  document.getElementById("gameMessages").innerHTML = finalHTML;
  // No popup; server will auto-start the next game. Optionally inform players.
  showGameMessage("Starting next game shortly...");
});

socket.on("gameEnded", (reason) => {
  alert(`Game ended: ${reason}`);
  gameDiv.classList.add("hidden");
  lobby.classList.remove("hidden");
});

function playCard(cardIndex) {
  if (!isMyTurn) {
    alert("It's not your turn!");
    return;
  }
  
  if (cardIndex < 0 || cardIndex >= myCards.length) {
    alert("Invalid card selection");
    return;
  }
  
  const card = myCards[cardIndex];
  console.log("Playing card:", card, "Index:", cardIndex);
  
  socket.emit("playCard", { roomCode, cardIndex });
}

function showGameMessage(message) {
  const messagesDiv = document.getElementById("gameMessages");
  const messageElem = document.createElement("div");
  messageElem.textContent = message;
  messagesDiv.appendChild(messageElem);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  
  console.log("Game Message:", message);
}