import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createDeck } from "./public/deck.js";
import compression from "compression";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Enable gzip compression for faster responses
app.use(compression());

// Serve static assets with caching
app.use(express.static("public", {
  maxAge: "7d",
  etag: true,
  immutable: true
}));

// const PORT = 3000;
// server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

/** GAME STATE **/
let rooms = {};

// Game state constants
const GAME_STATES = {
  WAITING: 'waiting',
  PREDICTING: 'predicting',
  PLAYING: 'playing',
  SCORING: 'scoring'
};

// Validate game configuration
function validateGameConfig(number_of_decks, min_round_cards, max_round_cards, maxPlayers) {
  if (number_of_decks < 1) return "Number of decks must be at least 1";
  if (min_round_cards < 1) return "Minimum round cards must be at least 1";
  if (max_round_cards < 1) return "Maximum round cards must be at least 1";
  if (min_round_cards > max_round_cards) return "Minimum cards cannot exceed maximum cards";
  if (maxPlayers < 2) return "Need at least 2 players";
  if (max_round_cards * maxPlayers > 52 * number_of_decks) {
    return "Not enough cards for the specified configuration";
  }
  return null;
}

// Helper function to get card value for comparison
function getCardValue(rank) {
  const values = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
    "J": 11, "Q": 12, "K": 13, "A": 14
  };
  return values[rank] || 0;
}

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on("createRoom", ({ roomCode, playerName, maxPlayers, number_of_decks, max_round_cards, min_round_cards }) => {
    if (rooms[roomCode]) {
      socket.emit("errorMessage", "Room already exists");
      return;
    }

    // Validate configuration
    const validationError = validateGameConfig(number_of_decks, min_round_cards, max_round_cards, maxPlayers);
    if (validationError) {
      socket.emit("errorMessage", validationError);
      return;
    }

    rooms[roomCode] = {
      host: socket.id,
      players: [{ id: socket.id, name: playerName }],
      maxPlayers,
      number_of_decks,
      max_round_cards,
      min_round_cards,
      trump_rotation: ["Spades", "Diamonds", "Clubs", "Hearts"],
      current_round: 1,
      cards_this_round: min_round_cards, // Start with configured minimum
      turn_index: 0,
      state: GAME_STATES.WAITING,
      ascending: true, // Track if we're in ascending or descending phase
      predictions: {}, // Store player predictions
      tricks_won: {}, // Store tricks won by each player
      scores: {}, // Store player scores
      current_trick: [], // Current trick cards
      playerHands: {}, // Store each player's hand
      current_play_order: [], // Ordered list of player IDs for current trick
      next_player_index: 0, // Index into current_play_order for whose turn it is
      gameConfig: {
        decks: number_of_decks,
        maxCards: max_round_cards,
        minCards: min_round_cards,
        maxPlayers: maxPlayers
      }
    };

    socket.join(roomCode);
    socket.emit("roomCreated", roomCode);
    
    // Send initial player list to the creator
    socket.emit("playerList", {
      players: rooms[roomCode].players.map(p => p.name),
      config: rooms[roomCode].gameConfig
    });
    
    console.log(`Room ${roomCode} created by ${playerName}`);
  });

  socket.on("joinRoom", ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) {
      return socket.emit("errorMessage", "Room not found");
    }

    if (room.players.find(p => p.id === socket.id)) {
      return socket.emit("errorMessage", "You are already in this room");
    }

    if (room.state !== "waiting") {
      return socket.emit("errorMessage", "Game has already started");
    }

    if (room.players.length >= room.maxPlayers) {
      return socket.emit("errorMessage", "Room is full");
    }

    room.players.push({ id: socket.id, name: playerName });
    socket.join(roomCode);
    
    // Send updated player list and game configuration to everyone in the room
    io.to(roomCode).emit("playerList", {
      players: room.players.map(p => p.name),
      config: room.gameConfig
    });
    
    // Show lobby to the joining player
    socket.emit("joinedRoom", roomCode);
    console.log(`Player ${playerName} joined room ${roomCode}`);
  });

  socket.on("startGame", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("errorMessage", "Room not found");
      return;
    }
    
    if (socket.id !== room.host) {
      socket.emit("errorMessage", "Only the host can start the game");
      return;
    }
    
    if (room.players.length < 2) {
      io.to(roomCode).emit("errorMessage", "Need at least 2 players to start");
      return;
    }

    // Initialize scores for all players
    room.players.forEach(player => {
      room.scores[player.id] = 0;
    });

    console.log(`Game starting in room ${roomCode} with ${room.players.length} players`);
    startRound(roomCode);
  });

  socket.on("makePrediction", ({ roomCode, prediction }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== GAME_STATES.PREDICTING) {
      socket.emit("errorMessage", "Not in prediction phase");
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player) {
      socket.emit("errorMessage", "Player not found in room");
      return;
    }

    // Validate prediction range
    if (prediction < 0 || prediction > room.cards_this_round) {
      socket.emit("errorMessage", `Prediction must be between 0 and ${room.cards_this_round}`);
      return;
    }

    // Get current prediction order
    const currentPredictionOrder = room.predictionOrder || [];
    const currentPlayerIndex = currentPredictionOrder.findIndex(id => id === socket.id);
    
    if (currentPlayerIndex === -1) {
      socket.emit("errorMessage", "It's not your turn to predict");
      return;
    }
    
    // Calculate total predictions so far (excluding current prediction)
    const otherPredictions = { ...room.predictions };
    delete otherPredictions[socket.id]; // Remove current player's existing prediction if any
    const totalPredictions = Object.values(otherPredictions).reduce((sum, p) => sum + p, 0);
    
    // If this is the last player to predict, validate their prediction
    if (currentPlayerIndex === room.players.length - 1) {
      if (totalPredictions + prediction === room.cards_this_round) {
        socket.emit("errorMessage", "Last player's prediction cannot make total equal to number of tricks");
        return;
      }
    }

    room.predictions[socket.id] = prediction;
    console.log(`Player ${player.name} predicted ${prediction} tricks`);
    
    io.to(roomCode).emit("predictionMade", {
      playerName: player.name,
      prediction
    });

    // Remove current player from prediction order
    room.predictionOrder = room.predictionOrder.filter(id => id !== socket.id);

    // Check if all predictions are in
    if (Object.keys(room.predictions).length === room.players.length) {
      console.log("All predictions made, starting play phase");
      room.state = GAME_STATES.PLAYING;
      io.to(roomCode).emit("allPredictionsMade", 
        room.players.reduce((acc, player) => {
          acc[player.name] = room.predictions[player.id];
          return acc;
        }, {})
      );
      startPlayPhase(roomCode);
    } else {
      // Notify next player to predict
      const nextPlayerId = room.predictionOrder[0];
      const nextPlayer = room.players.find(p => p.id === nextPlayerId);
      
      // Compute forbidden value for last predictor (UI help)
      const totalPredictionsNext = Object.values(room.predictions).reduce((s, p) => s + p, 0);
      const isLastNext = room.predictionOrder.length === 1;
      const forbiddenNext = isLastNext ? (room.cards_this_round - totalPredictionsNext) : null;

      io.to(roomCode).emit("nextPlayerPredict", {
        currentPlayer: nextPlayer.name,
        maxPrediction: room.cards_this_round,
        isLast: isLastNext,
        forbidden: forbiddenNext
      });
      console.log(`Next to predict: ${nextPlayer.name}`);
    }
  });

  function startRound(roomCode) {
    const room = rooms[roomCode];
    const deck = createDeck(room.number_of_decks);
    const players = room.players;

    // Reset round-specific state
    room.predictions = {};
    room.tricks_won = {};
    room.current_trick = [];
    room.current_play_order = [];
    room.next_player_index = 0;
    players.forEach(player => {
      room.tricks_won[player.id] = 0;
    });

    // Enter predicting state immediately to block early plays
    room.state = GAME_STATES.PREDICTING;

    // Deal cards to players
    room.playerHands = {};
    players.forEach(player => {
      room.playerHands[player.id] = deck.splice(0, room.cards_this_round);
      // Send cards to player with a small delay to ensure UI is ready
      setTimeout(() => {
        io.to(player.id).emit("yourCards", room.playerHands[player.id]);
      }, 100);
    });

    // Determine trump suit for this round
    const trump = room.trump_rotation[(room.current_round - 1) % 4];
    
    // Determine prediction order (rotates each round)
    const leaderIndex = room.turn_index % players.length;
    const predictionOrder = players.slice(leaderIndex).concat(players.slice(0, leaderIndex));
    room.predictionOrder = predictionOrder.map(p => p.id);

    console.log(`Starting round ${room.current_round} in room ${roomCode}`);
    console.log(`Trump: ${trump}, Cards this round: ${room.cards_this_round}`);
    console.log(`Prediction order: ${predictionOrder.map(p => p.name).join(', ')}`);

    // Send round start info first
    io.to(roomCode).emit("roundStart", {
      round: room.current_round,
      cardsThisRound: room.cards_this_round,
      trump,
      firstPlayer: predictionOrder[0].name,
      ascending: room.ascending
    });

    // Start prediction prompt after a delay to ensure cards are visible
    setTimeout(() => {
      // Compute forbidden for the first predictor (will generally be null unless single player)
      const totalPredictions = Object.values(room.predictions).reduce((sum, p) => sum + p, 0);
      const isLast = room.predictionOrder.length === 1;
      const forbidden = isLast ? (room.cards_this_round - totalPredictions) : null;

      io.to(roomCode).emit("requestPrediction", {
        playerOrder: predictionOrder.map(p => p.name),
        currentPlayer: predictionOrder[0].name,
        maxPrediction: room.cards_this_round,
        isLast,
        forbidden
      });
      console.log(`Requesting prediction from ${predictionOrder[0].name}`);
    }, 1500);
  }

  function startPlayPhase(roomCode) {
    const room = rooms[roomCode];
    const leaderIndex = room.turn_index % room.players.length;
    const playOrder = room.players.slice(leaderIndex).concat(room.players.slice(0, leaderIndex));
    room.current_play_order = playOrder.map(p => p.id);
    room.next_player_index = 0;
    
    io.to(roomCode).emit("playPhaseStart", {
      firstPlayer: playOrder[0].name,
      playOrder: playOrder.map(p => p.name)
    });

    // Notify first player to play
    setTimeout(() => {
      io.to(playOrder[0].id).emit("yourTurnToPlay");
    }, 1000);
    
    console.log(`Play phase started. First player: ${playOrder[0].name}`);
  }

  function determineTrickWinner(trick, trumpSuit) {
    const leadSuit = trick[0].card.suit;
    let winningCard = trick[0];
    let winningValue = getCardValue(trick[0].card.rank);
    let isTrump = (trick[0].card.suit === trumpSuit);

    for (let i = 1; i < trick.length; i++) {
      const currentCard = trick[i];
      const currentValue = getCardValue(currentCard.card.rank);
      const currentIsTrump = (currentCard.card.suit === trumpSuit);

      if (currentIsTrump && !isTrump) {
        winningCard = currentCard;
        winningValue = currentValue;
        isTrump = true;
      } else if (currentIsTrump && isTrump) {
        if (currentValue > winningValue) {
          winningCard = currentCard;
          winningValue = currentValue;
        } else if (currentValue === winningValue) {
          winningCard = currentCard;
        }
      } else if (!currentIsTrump && !isTrump && currentCard.card.suit === leadSuit) {
        if (currentValue > winningValue) {
          winningCard = currentCard;
          winningValue = currentValue;
        } else if (currentValue === winningValue) {
          winningCard = currentCard;
        }
      }
      // If card doesn't follow suit and isn't trump, it can't win
    }

    return winningCard;
  }

  function endRound(roomCode) {
    const room = rooms[roomCode];
    
    // Prevent plays during scoring/transition
    room.state = GAME_STATES.SCORING;

    // Calculate scores
    room.players.forEach(player => {
      const predicted = room.predictions[player.id] || 0;
      const actual = room.tricks_won[player.id] || 0;
      
      if (predicted === actual) {
        room.scores[player.id] += 10 + (actual * 11); // Exact prediction bonus (per-hand scaling)
      } else {
        room.scores[player.id] -= Math.abs(predicted - actual);
      }
    });

    // Convert scores and predictions to player names for display
    const playerScores = room.players.reduce((acc, player) => {
      acc[player.name] = room.scores[player.id];
      return acc;
    }, {});

    const playerPredictions = room.players.reduce((acc, player) => {
      acc[player.name] = {
        predicted: room.predictions[player.id] || 0,
        actual: room.tricks_won[player.id] || 0
      };
      return acc;
    }, {});

    // Send round results
    io.to(roomCode).emit("roundEnd", {
      predictions: playerPredictions,
      tricksWon: room.tricks_won,
      scores: playerScores
    });

    console.log(`Round ${room.current_round} ended in room ${roomCode}`);

    // Prepare for next round
    room.turn_index = (room.turn_index + 1) % room.players.length;
    
    // Update cards for next round
    if (room.ascending) {
      if (room.cards_this_round < room.max_round_cards) {
        room.cards_this_round++;
      } else {
        room.ascending = false;
        room.cards_this_round--;
      }
    } else {
      if (room.cards_this_round > room.min_round_cards) {
        room.cards_this_round--;
      } else {
        // Game over
        const finalScores = room.players.reduce((acc, player) => {
          acc[player.name] = room.scores[player.id];
          return acc;
        }, {});
        
        console.log(`Game over in room ${roomCode}`);
        io.to(roomCode).emit("gameOver", {
          finalScores: finalScores
        });
        
        // Reset room state for a fresh game and auto-restart after a short delay
        room.state = GAME_STATES.WAITING;
        room.current_round = 1;
        room.cards_this_round = room.min_round_cards;
        room.turn_index = 0;
        room.ascending = true;
        // Reset scores for new game

        setTimeout(() => startRound(roomCode), 3000);
        return;
      }
    }

    room.current_round++;
    
    // Start next round after a brief delay
    setTimeout(() => {
      startRound(roomCode);
    }, 5000);
  }

  socket.on("playCard", ({ roomCode, cardIndex }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== GAME_STATES.PLAYING) {
      socket.emit("errorMessage", "Not in play phase");
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player) {
      socket.emit("errorMessage", "Player not found");
      return;
    }

    // Enforce turn order strictly
    if (room.current_play_order && room.current_play_order.length > 0) {
      const expectedPlayerId = room.current_play_order[room.next_player_index];
      if (socket.id !== expectedPlayerId) {
        socket.emit("errorMessage", "It's not your turn to play");
        return;
      }
    }

    // Validate card play
    const hand = room.playerHands[socket.id];
    if (!hand || cardIndex < 0 || cardIndex >= hand.length) {
      socket.emit("errorMessage", "Invalid card selection");
      return;
    }

    // Check if player must follow suit
    if (room.current_trick.length > 0) {
      const leadSuit = room.current_trick[0].card.suit;
      const hasLeadSuit = hand.some(c => c.suit === leadSuit);
      
      if (hasLeadSuit && hand[cardIndex].suit !== leadSuit) {
        socket.emit("errorMessage", "You must follow the lead suit if possible");
        return;
      }
    }

    const card = hand[cardIndex];

    // Remove card from hand and add to trick
    room.playerHands[socket.id] = hand.filter((_, index) => index !== cardIndex);
    room.current_trick.push({ playerId: socket.id, playerName: player.name, card });

    // Update player's hand
    io.to(socket.id).emit("yourCards", room.playerHands[socket.id]);

    console.log(`Player ${player.name} played ${card.rank} of ${card.suit}`);
    io.to(roomCode).emit("cardPlayed", {
      playerName: player.name,
      card
    });

    // Advance to next player in order
    if (room.current_play_order && room.current_play_order.length > 0) {
      room.next_player_index = (room.next_player_index + 1) % room.players.length;
    }

    // If all players have played a card, determine trick winner
    if (room.current_trick.length === room.players.length) {
      const trump = room.trump_rotation[(room.current_round - 1) % 4];
      const winningPlay = determineTrickWinner(room.current_trick, trump);

      // Update tricks won
      room.tricks_won[winningPlay.playerId] = (room.tricks_won[winningPlay.playerId] || 0) + 1;

      // Notify players of trick result
      io.to(roomCode).emit("trickWon", {
        playerName: winningPlay.playerName,
        trick: room.current_trick,
        tricksWon: room.players.reduce((acc, player) => {
          acc[player.name] = room.tricks_won[player.id] || 0;
          return acc;
        }, {})
      });

      console.log(`Trick won by ${winningPlay.playerName}`);

      // Reset current trick
      room.current_trick = [];

      // Check if round is over (all cards played)
      const totalTricksPlayed = Object.values(room.tricks_won).reduce((sum, t) => sum + t, 0);
      if (totalTricksPlayed === room.cards_this_round) {
        // Wait 4s so everyone can see the completed trick before ending the round
        setTimeout(() => endRound(roomCode), 4000);
      } else {
        // Next trick starts with the winner
        const winnerIndex = room.players.findIndex(p => p.id === winningPlay.playerId);
        const playOrder = room.players.slice(winnerIndex).concat(room.players.slice(0, winnerIndex));
        room.current_play_order = playOrder.map(p => p.id);
        room.next_player_index = 0;
        
        // Wait 4s so everyone can see the completed trick before starting next trick
        setTimeout(() => {
          io.to(roomCode).emit("nextTrick", {
            firstPlayer: playOrder[0].name,
            playOrder: playOrder.map(p => p.name)
          });
          io.to(playOrder[0].id).emit("yourTurnToPlay");
        }, 4000);
      }
    } else {
      // Notify next player to play using enforced order
      if (room.current_play_order && room.current_play_order.length > 0) {
        const nextPlayerId = room.current_play_order[room.next_player_index];
        io.to(nextPlayerId).emit("yourTurnToPlay");
      } else {
        // Fallback to original logic if order is not initialized
        const currentPlayerIndex = room.players.findIndex(p => p.id === socket.id);
        const nextPlayerIndex = (currentPlayerIndex + 1) % room.players.length;
        const nextPlayer = room.players[nextPlayerIndex];
        io.to(nextPlayer.id).emit("yourTurnToPlay");
      }
    }
  });

  socket.on("disconnect", () => {
    console.log(`Player disconnected: ${socket.id}`);
    for (const [roomCode, room] of Object.entries(rooms)) {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const playerName = room.players[playerIndex].name;
        room.players = room.players.filter(p => p.id !== socket.id);
        io.to(roomCode).emit("playerList", {
          players: room.players.map(p => p.name),
          config: room.gameConfig
        });
        
        // If game is in progress, try to continue with remaining players
        if (room.state !== GAME_STATES.WAITING) {
          if (room.players.length >= 2) {
            // Clean up state for the disconnected player
            delete room.scores[socket.id];
            delete room.predictions[socket.id];
            delete room.tricks_won[socket.id];
            delete room.playerHands[socket.id];
            if (Array.isArray(room.current_play_order) && room.current_play_order.length) {
              room.current_play_order = room.current_play_order.filter(id => id !== socket.id);
              if (room.next_player_index >= room.current_play_order.length) {
                room.next_player_index = 0;
              }
            }
            // Inform players and restart the current round with remaining players
            io.to(roomCode).emit("errorMessage", `${playerName} disconnected. Restarting current round with ${room.players.length} players.`);
            // Ensure turn index stays in range
            room.turn_index = room.turn_index % room.players.length;
            // Reset transient per-round state; keep scores and round counters
            room.predictions = {};
            room.tricks_won = {};
            room.current_trick = [];
            room.current_play_order = [];
            room.next_player_index = 0;
            room.state = GAME_STATES.PREDICTING;
            setTimeout(() => startRound(roomCode), 500);
          } else {
            // Not enough players to continue
            io.to(roomCode).emit("gameEnded", `${playerName} has disconnected`);
            room.state = GAME_STATES.WAITING;
          }
        }

        console.log(`Player ${playerName} disconnected from room ${roomCode}`);

        // If room is empty, delete it
        if (room.players.length === 0) {
          delete rooms[roomCode];
          console.log(`Room ${roomCode} deleted (empty)`);
        }
      }
    }
  });
});