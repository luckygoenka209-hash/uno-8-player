const socket = io();

const $ = id => document.getElementById(id);

let myHand = [];
let state = null;
let pendingIndices = [];

const labels = {
  skip: "⛔",
  reverse: "↔",
  draw2: "+2",
  draw4: "+4",
  wild: "WILD"
};

function cardText(c) {
  return labels[c.type] ?? c.type;
}

function cardEl(c, selected = false) {
  const d = document.createElement("div");
  d.className = `card ${c.color}`;
  if (selected) d.classList.add("selected");
  d.textContent = cardText(c);
  return d;
}

function msg(t) {
  $("msg").textContent = t || "";
}

function name() {
  return $("name").value.trim() || "Player";
}

$("create").onclick = () => {
  socket.emit("createRoom", { name: name() }, r => {
    if (r?.ok) enterGame(r.roomId);
    else msg(r?.error);
  });
};

$("join").onclick = () => {
  socket.emit(
    "joinRoom",
    {
      name: name(),
      roomId: $("room").value.trim()
    },
    r => {
      if (r?.ok) enterGame(r.roomId);
      else msg(r?.error);
    }
  );
};

function enterGame(roomId) {
  $("home").hidden = true;
  $("game").hidden = false;
  $("roomLabel").textContent = `#${roomId}`;
}

$("start").onclick = () => {
  socket.emit("startGame", r => {
    if (r && !r.ok) msg(r.error);
  });
};

$("draw").onclick = () => {
  socket.emit("drawCard", r => {
    if (r && !r.ok) msg(r.error);
  });
};

$("uno").onclick = () => {
  socket.emit("uno", r => {
    if (r && !r.ok) msg(r.error);
  });
};

socket.on("message", msg);

socket.on("state", s => {
  state = s;
  render();
});

socket.on("hand", h => {
  myHand = h;
  pendingIndices = [];
  renderHand();
});

function render() {
  if (!state) return;

  const current = state.players.find(p => p.id === state.turn);

  $("turnLabel").textContent =
    state.started
      ? `Turn: ${current ? current.name : "?"}`
      : state.winner
        ? `Winner: ${state.winner}`
        : "Lobby";

  $("players").innerHTML = "";

  state.players.forEach(p => {
    const x = document.createElement("div");
    x.className = `player ${p.id === state.turn ? "active" : ""}`;

    x.innerHTML = `
      <span>${p.name}</span>
      <b>${p.count}</b>
    `;

    $("players").appendChild(x);
  });

  $("start").style.display =
    !state.started && !state.winner && state.players.length >= 2
      ? "inline-block"
      : "none";

  $("top").innerHTML = "";

  if (state.top) {
    $("top").appendChild(cardEl(state.top));
  }

  $("color").textContent =
    state.currentColor
      ? `Current colour: ${state.currentColor.toUpperCase()}`
      : "";

  if (state.pendingPenalty > 0) {
    $("msg").textContent =
      `⚠️ ${state.pendingPenalty} cards penalty — stack ${state.penaltyType === "draw2" ? "+2" : "+4"} or draw.`;
  }

  renderHand();
}

function renderHand() {
  if (!$("hand")) return;

  $("hand").innerHTML = "";

  myHand.forEach((c, i) => {
    const selected = pendingIndices.includes(i);
    const d = cardEl(c, selected);

    const playable =
      state &&
      state.started &&
      state.turn === socket.id &&
      canPlay(c);

    if (!playable) d.classList.add("disabled");

    d.onclick = () => {
      if (!playable) return;

      toggleCard(i);
    };

    $("hand").appendChild(d);
  });

  updatePlayButton();
}

function canPlay(card) {
  if (!state?.top) return true;

  if (state.pendingPenalty > 0) {
    return card.type === state.penaltyType;
  }

  return (
    card.color === "wild" ||
    card.color === state.currentColor ||
    card.type === state.top.type
  );
}

function toggleCard(index) {
  if (pendingIndices.includes(index)) {
    pendingIndices = pendingIndices.filter(i => i !== index);
  } else {
    pendingIndices.push(index);
  }

  renderHand();
}

function updatePlayButton() {
  const old = document.getElementById("playSelected");

  if (old) old.remove();

  if (!state?.started || state.turn !== socket.id) return;

  const btn = document.createElement("button");
  btn.id = "playSelected";
  btn.textContent =
    pendingIndices.length > 1
      ? `Play ${pendingIndices.length} Cards`
      : "Play Card";

  btn.onclick = playSelected;

  $("hand").after(btn);
}

function playSelected() {
  if (!pendingIndices.length) {
    msg("Select a card first.");
    return;
  }

  const cards = pendingIndices.map(i => myHand[i]);

  const hasDraw4 = cards.some(c => c.type === "draw4");

  if (hasDraw4) {
    if (cards.every(c => c.type === "draw4")) {
      pendingColorPlay();
    } else {
      msg("You can only combine identical +4 cards.");
    }
    return;
  }

  socket.emit(
    "playCards",
    {
      indices: pendingIndices,
      color: null
    },
    r => {
      if (r && !r.ok) msg(r.error);
    }
  );

  pendingIndices = [];
}

function pendingColorPlay() {
  $("modal").hidden = false;
}

document.querySelectorAll(".choices button").forEach(btn => {
  btn.onclick = () => {
    const color = btn.dataset.c;

    $("modal").hidden = true;

    socket.emit(
      "playCards",
      {
        indices: pendingIndices,
        color
      },
      r => {
        if (r && !r.ok) msg(r.error);
      }
    );

    pendingIndices = [];
  };
});

socket.on("connect", () => {
  render();
});
