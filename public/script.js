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
let isMyTurn = false;
let myName = "";

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
  roundInfo.textContent = `Round ${round} | Cards: ${cardsThisRound} | Trump: ${trump} | ${ascending ? "Ascending" : "Descending"}`;
  
  // Clear any previous game state
  document.getElementById("predictions").innerHTML = "";
  document.getElementById("currentTrick").innerHTML = "";
  document.getElementById("gameMessages").innerHTML = "";
  document.getElementById("tricksWon").innerHTML = "";
  
  showGameMessage(`Round ${round} started! Trump suit: ${trump}`);
});

socket.on("yourCards", (cards) => {
  myCards = cards;
  handDiv.innerHTML = "";
  cards.forEach((c, index) => {
    const div = document.createElement("div");
    div.className = "card";
    div.textContent = `${c.rank} ${c.suit[0]}`;
    div.setAttribute("data-index", index);
    div.onclick = () => playCard(index);
    handDiv.appendChild(div);
  });
  
  showGameMessage(`You received ${cards.length} cards. Look at your hand above.`);
});

socket.on("joinedRoom", (code) => {
  setup.classList.add("hidden");
  lobby.classList.remove("hidden");
  roomCode = code;
});

socket.on("errorMessage", msg => {
  alert(msg);
  console.error("Error:", msg);
});

// Prediction phase - FIXED: Show prediction input only when it's your turn AND after cards are visible
socket.on("requestPrediction", ({ playerOrder, currentPlayer, maxPrediction }) => {
  console.log("Prediction requested. Current player:", currentPlayer, "My name:", myName);
  isMyTurn = (currentPlayer === myName);
  
  if (isMyTurn) {
    // Small delay to ensure cards are visible
    setTimeout(() => {
      showPredictionInput(maxPrediction);
    }, 500);
  } else {
    showGameMessage(`Waiting for ${currentPlayer} to predict...`);
  }
});

socket.on("nextPlayerPredict", ({ currentPlayer }) => {
  console.log("Next player to predict:", currentPlayer);
  isMyTurn = (currentPlayer === myName);
  
  if (isMyTurn) {
    showGameMessage("It's your turn to predict!");
    // Get maxPrediction from current round info
    const maxPrediction = myCards.length;
    showPredictionInput(maxPrediction);
  } else {
    showGameMessage(`Waiting for ${currentPlayer} to predict...`);
  }
});

function showPredictionInput(maxPrediction) {
  showGameMessage(`It's your turn to predict! How many tricks will you win? (0-${maxPrediction})`);
  
  // Create prediction UI
  const predictionDiv = document.createElement("div");
  predictionDiv.id = "predictionInput";
  predictionDiv.innerHTML = `
    <div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.2); border-radius: 5px;">
      <p>Make your prediction (0-${maxPrediction}):</p>
      <div id="predictionButtons" style="display: flex; flex-wrap: wrap; gap: 5px; justify-content: center;">
        ${Array.from({length: maxPrediction + 1}, (_, i) => 
          `<button onclick="submitPrediction(${i})" style="padding: 8px 12px;">${i}</button>`
        ).join('')}
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
  showGameMessage(`${playerName} played ${card.rank} of ${card.suit}`);
  handDiv.style.border = "none";
  
  // Add to current trick display
  const currentTrickDiv = document.getElementById("currentTrick");
  const cardDiv = document.createElement("div");
  cardDiv.className = "played-card";
  cardDiv.textContent = `${playerName}: ${card.rank} ${card.suit[0]}`;
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
});

socket.on("gameOver", ({ finalScores }) => {
  let finalHTML = "<h2>Game Over!</h2><h3>Final Scores:</h3>";
  Object.keys(finalScores).forEach(player => {
    finalHTML += `<p><strong>${player}</strong>: ${finalScores[player]}</p>`;
  });
  
  document.getElementById("gameMessages").innerHTML = finalHTML;
  
  // Show restart option
  setTimeout(() => {
    if (confirm("Game Over! Would you like to return to the lobby?")) {
      gameDiv.classList.add("hidden");
      lobby.classList.remove("hidden");
    }
  }, 2000);
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
  isMyTurn = false;
}

function showGameMessage(message) {
  const messagesDiv = document.getElementById("gameMessages");
  const messageElem = document.createElement("div");
  messageElem.textContent = message;
  messagesDiv.appendChild(messageElem);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  
  console.log("Game Message:", message);
}