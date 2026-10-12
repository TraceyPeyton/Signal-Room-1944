(() => {
  const GAME_ENDPOINT = "/.netlify/functions/game";
  const $ = (id) => document.getElementById(id);
  const home = $("home");
  const room = $("room");
  let mode = "create";
  let session = null;
  let roomState = null;
  let pollHandle = null;
  let clockHandle = null;
  let pollBusy = false;
  let feedbackMessage = "";
  let leaving = false;

  function cleanName(value) {
    return value.trim().replace(/\s+/g, " ").slice(0, 18);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function setNotice(message) {
    $("homeNotice").textContent = message;
  }

  function setMode(next) {
    mode = next;
    $("tabCreate").classList.toggle("active", mode === "create");
    $("tabJoin").classList.toggle("active", mode === "join");
    $("joinFields").classList.toggle("hidden", mode !== "join");
    $("themeField").classList.toggle("hidden", mode !== "create");
    $("homeAction").textContent = mode === "create" ? "Create signal room" : "Join signal room";
    setNotice("");
  }

  function setLoading(message) {
    $("homeAction").disabled = true;
    $("practiceAction").disabled = true;
    setNotice(message);
  }

  function restoreHome() {
    home.classList.remove("hidden");
    room.classList.add("hidden");
    $("homeAction").disabled = false;
    $("practiceAction").disabled = false;
    setNotice("");
  }

  async function request(action, payload = {}) {
    const response = await fetch(GAME_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The room service could not complete that action.");
    return data;
  }

  function credentialPayload() {
    return session ? {
      roomCode: session.roomCode,
      playerId: session.playerId,
      token: session.token,
    } : {};
  }

  function saveSession() {
    if (session) sessionStorage.setItem(`signal-room:${session.roomCode}`, JSON.stringify(session));
  }

  function clearSession() {
    if (session) sessionStorage.removeItem(`signal-room:${session.roomCode}`);
    session = null;
    roomState = null;
    feedbackMessage = "";
  }

  function enterRoom(data) {
    room.innerHTML = "";
    session = data.session;
    roomState = data.state;
    feedbackMessage = "";
    leaving = false;
    saveSession();
    home.classList.add("hidden");
    room.classList.remove("hidden");
    renderScreen();
    startUpdates();
  }

  async function createRoom(practice = false) {
    setLoading(practice ? "Opening a practice session…" : "Opening a secure room…");
    try {
      const data = await request("create", {
        name: cleanName($("homeName").value),
        theme: $("homeTheme").value,
        practice,
      });
      enterRoom(data);
    } catch (error) {
      restoreHome();
      setNotice(error.message);
    }
  }

  async function joinRoom() {
    const roomCode = $("homeCode").value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (roomCode.length !== 6) return setNotice("Enter the six-character room code.");
    setLoading("Calling the signal room…");
    try {
      const data = await request("join", {
        roomCode,
        name: cleanName($("homeName").value),
      });
      enterRoom(data);
    } catch (error) {
      restoreHome();
      setNotice(error.message);
    }
  }

  async function restoreSessionFromInvite() {
    const params = new URLSearchParams(location.search);
    const invitedCode = (params.get("room") || "").toUpperCase().slice(0, 6);
    if (invitedCode.length !== 6) return;
    setMode("join");
    $("homeCode").value = invitedCode;
    const saved = sessionStorage.getItem(`signal-room:${invitedCode}`);
    if (!saved) return;
    try {
      const savedSession = JSON.parse(saved);
      const data = await request("state", {
        roomCode: savedSession.roomCode,
        playerId: savedSession.playerId,
        token: savedSession.token,
      });
      enterRoom({ session: savedSession, state: data.state });
    } catch {
      sessionStorage.removeItem(`signal-room:${invitedCode}`);
    }
  }

  function showFeedback(message) {
    feedbackMessage = message;
    const feedback = document.querySelector("#room .feedback");
    if (feedback) feedback.textContent = message;
  }

  function startUpdates() {
    stopUpdates();
    pollHandle = setInterval(refreshState, 1800);
    clockHandle = setInterval(updateClock, 1000);
    updateClock();
  }

  function stopUpdates() {
    clearInterval(pollHandle);
    clearInterval(clockHandle);
    pollHandle = null;
    clockHandle = null;
  }

  function sameState(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  async function refreshState() {
    if (!session || pollBusy || leaving) return;
    pollBusy = true;
    try {
      const data = await request("state", credentialPayload());
      if (!sameState(roomState, data.state)) {
        roomState = data.state;
        renderScreen();
      }
      if (roomState.status === "finished" || roomState.status === "closed") stopUpdates();
    } catch (error) {
      if (error.message.includes("session is no longer active")) {
        stopUpdates();
        showFeedback(error.message);
      }
    } finally {
      pollBusy = false;
    }
  }

  async function performAction(action, extra = {}) {
    try {
      const data = await request(action, { ...credentialPayload(), ...extra });
      if (data.state && !sameState(roomState, data.state)) {
        roomState = data.state;
        renderScreen();
      }
      if (data.feedback) showFeedback(data.feedback);
      if (roomState.status === "finished" || roomState.status === "closed") stopUpdates();
    } catch (error) {
      showFeedback(error.message);
    }
  }

  async function leaveRoom() {
    if (!session) return restoreHome();
    leaving = true;
    stopUpdates();
    try {
      await request("leave", credentialPayload());
    } catch {
      // Returning to the main menu should work even if the connection has dropped.
    }
    clearSession();
    leaving = false;
    restoreHome();
    history.replaceState(null, "", location.pathname);
  }

  async function shareRoom() {
    const url = new URL(location.href);
    url.search = `?room=${encodeURIComponent(session.roomCode)}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      showFeedback(`Invite link copied. Share it with room code ${session.roomCode}.`);
    } catch {
      showFeedback(`Room code: ${session.roomCode}`);
    }
  }

  function updateClock() {
    if (!roomState || roomState.status !== "playing" || !roomState.round) return;
    const seconds = Math.max(0, Math.ceil((roomState.round.deadline - Date.now()) / 1000));
    const timer = $("gameTimer");
    const bar = $("progressBar");
    if (timer) {
      timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      timer.classList.toggle("urgent", seconds <= 15);
    }
    if (bar) bar.style.width = `${Math.max(0, (seconds / 90) * 100)}%`;
    const countdown = $("clueCountdown");
    if (countdown) {
      const elapsed = Math.floor((Date.now() - roomState.round.startedAt) / 1000);
      countdown.textContent = `NEXT CLUE IN ${20 - (elapsed % 20)} SECONDS`;
    }
  }

  function renderScores(players, currentPlayerId, showSolved = false) {
    return [...players]
      .sort((a, b) => b.score - a.score)
      .map((player, index) => `<div class="score-row ${player.id === currentPlayerId ? "me" : ""}"><span>${index + 1}. ${escapeHtml(player.name)}${showSolved && player.solved ? " ✓" : ""}</span><span class="score">${player.score}</span></div>`)
      .join("");
  }

  function renderScreen() {
    if (!session || !roomState) return;
    const currentGuess = $("guess");
    const guessDraft = currentGuess?.value ?? "";
    const guessWasFocused = currentGuess !== null && document.activeElement === currentGuess;
    const selectionStart = currentGuess?.selectionStart ?? guessDraft.length;
    const selectionEnd = currentGuess?.selectionEnd ?? selectionStart;
    const state = roomState;
    const isHost = session.playerId === state.hostPlayerId;
    const players = state.players;
    const me = players.find((player) => player.id === session.playerId);
    let body = "";

    if (state.status === "lobby") {
      const activeCount = players.filter((player) => player.connected).length;
      body = `<div class="card"><div class="lobby-head"><div class="room-badge"><span class="label">${state.practice ? "Solo practice" : "Room code"}</span><span class="room-code">${escapeHtml(state.roomCode)}</span><span class="subtle">${state.practice ? "Practice the full six-round loop on this device." : "Share this with your signal unit"}</span>${state.theme ? `<span class="subtle">Theme · ${escapeHtml(state.theme)}</span>` : ""}</div>${state.practice ? "" : `<div class="room-actions"><button id="copyRoom" class="btn secondary" type="button">Copy invite</button></div>`}</div><ul class="roster">${players.map((player) => `<li><span class="player-name"><i class="dot" style="${player.connected ? "" : "background:var(--dim);box-shadow:none"}"></i>${escapeHtml(player.name)}${player.id === state.hostPlayerId ? '<span class="host-tag">HOST</span>' : ""}</span><span class="subtle">${player.connected ? "Ready" : "Offline"}</span></li>`).join("")}</ul><div class="lobby-foot"><button id="leave" class="btn quiet" type="button">Main menu</button>${isHost ? `<button id="start" class="btn" type="button" ${activeCount < 2 && !state.practice ? "disabled" : ""}>${state.practice ? "Start practice" : activeCount < 2 ? "Waiting for another agent" : "Start game"}</button>` : '<button class="btn" type="button" disabled>Waiting for host</button>'}</div><div class="notice">${activeCount < 2 && !state.practice ? "At least two players are needed to begin." : ""}</div></div>`;
    } else if (state.status === "finished") {
      const sorted = [...players].sort((a, b) => b.score - a.score);
      const winnerNames = sorted.filter((player) => state.winners.includes(player.id)).map((player) => escapeHtml(player.name));
      const title = winnerNames.length > 1 ? "Shared victory!" : `${winnerNames[0] || "No winner"} wins!`;
      body = `<div class="card winner"><div class="medal">✦</div><p class="eyebrow">SIX ROUND TRANSMISSION COMPLETE</p><h2>${title}</h2><p class="subtle">Final intelligence board</p><div class="scores">${renderScores(players, session.playerId)}</div><div class="lobby-foot"><button id="leave" class="btn secondary" type="button">Main menu</button></div></div>`;
    } else if (state.status === "closed") {
      body = `<div class="card winner"><div class="medal">S</div><p class="eyebrow">SIGNAL ROOM CLOSED</p><h2>Transmission ended.</h2><p class="subtle">The host returned to the main menu.</p><div class="lobby-foot"><button id="leave" class="btn secondary" type="button">Main menu</button></div></div>`;
    } else if (state.round) {
      const round = state.round;
      const reveal = state.status === "roundOver";
      const solved = Boolean(me && me.solved);
      const seconds = Math.max(0, Math.ceil((round.deadline - Date.now()) / 1000));
      const clues = round.clues.map((clue, index) => `<div class="clue"><b>CLUE ${index + 1}</b>${escapeHtml(clue)}</div>`).join("");
      const countdown = round.clueCount < 3 && !reveal
        ? `<div id="clueCountdown" class="locked">NEXT CLUE IN ${20 - (Math.floor((Date.now() - round.startedAt) / 1000) % 20)} SECONDS</div>`
        : "";
      const answer = reveal
        ? `<div class="answer-card"><div class="label">Decoded word</div><div class="answer">${escapeHtml(round.answer || "")}</div><div class="result-text">${escapeHtml(state.activity[0] || "Round complete.")}</div></div>`
        : `<form id="guessForm" class="guess-row"><input id="guess" maxlength="24" autocomplete="off" placeholder="Enter decoded word…" ${solved ? "disabled" : ""} aria-label="Your word guess"><button class="btn" type="submit" ${solved ? "disabled" : ""}>${solved ? "Decoded ✓" : "Submit guess"}</button></form><div class="feedback" role="status">${escapeHtml(feedbackMessage || (solved ? "You cracked this transmission. Watch the board for the next round." : ""))}</div>`;
      const nextButton = reveal && isHost
        ? `<button id="next" class="btn" type="button">${round.index >= round.count ? "View final results" : "Next transmission"}</button>`
        : "";
      const hostStatus = isHost && !reveal
        ? `<div class="card"><p class="label">Your channel</p><p class="subtle" style="margin:0">Room stays live while this tab is open.</p></div>`
        : "";
      body = `<div class="game-grid"><div class="game-main"><div class="round-line"><span class="round-title">Transmission ${round.index} / ${round.count}</span><span id="gameTimer" class="timer ${seconds <= 15 ? "urgent" : ""}">${reveal ? "DECODED" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`}</span></div><div class="progress"><i id="progressBar" style="width:${reveal ? 100 : Math.max(0, (seconds / 90) * 100)}%"></i></div><div class="intercept"><div class="cipher">${escapeHtml(round.cipher)}</div><div class="cipher-note">${escapeHtml(round.note)}</div></div><div class="clues">${clues}${countdown}</div>${answer}<div class="lobby-foot"><button id="leave" class="btn quiet" type="button">Main menu</button>${nextButton}</div></div><aside class="sidebar"><div class="card"><p class="label">Intelligence board</p><div class="scores">${renderScores(players, session.playerId, !reveal)}</div></div><div class="card"><p class="label">Recent signals</p><div class="activity">${state.activity.length ? state.activity.map((message) => `<div>${escapeHtml(message)}</div>`).join("") : "<span>Waiting for the first solve…</span>"}</div></div>${hostStatus}</aside></div>`;
    }

    room.innerHTML = body;
    const nextGuess = $("guess");
    if (nextGuess && guessDraft) {
      nextGuess.value = guessDraft;
      if (guessWasFocused) {
        nextGuess.focus({ preventScroll: true });
        nextGuess.setSelectionRange(selectionStart, selectionEnd);
      }
    }
    const start = $("start");
    if (start) start.addEventListener("click", () => performAction("start"));
    const copy = $("copyRoom");
    if (copy) copy.addEventListener("click", shareRoom);
    const leave = $("leave");
    if (leave) leave.addEventListener("click", leaveRoom);
    const form = $("guessForm");
    if (form) form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("guess");
      if (!input.value.trim()) return;
      const guess = input.value;
      input.value = "";
      await performAction("guess", { guess });
    });
    const next = $("next");
    if (next) next.addEventListener("click", () => performAction("next"));
    updateClock();
  }

  $("tabCreate").addEventListener("click", () => setMode("create"));
  $("tabJoin").addEventListener("click", () => setMode("join"));
  $("homeAction").addEventListener("click", () => mode === "create" ? createRoom(false) : joinRoom());
  $("practiceAction").addEventListener("click", () => createRoom(true));
  $("homeName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("homeAction").click();
  });
  $("homeCode").addEventListener("input", (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });

  window.addEventListener("beforeunload", () => {
    if (!session || leaving) return;
    fetch(GAME_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "leave", ...credentialPayload() }),
      keepalive: true,
    });
    stopUpdates();
  });

  restoreSessionFromInvite();
})();
