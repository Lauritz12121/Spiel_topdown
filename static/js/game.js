// ===========================================================================
// Brawl Arena – Client  (v2 – camera, mobile, bushes, aim-line, minimap)
// ===========================================================================
(function () {
    "use strict";

    // -----------------------------------------------------------------------
    // DOM refs
    // -----------------------------------------------------------------------
    const lobbyScreen  = document.getElementById("lobby-screen");
    const gameScreen   = document.getElementById("game-screen");
    const gameoverScreen = document.getElementById("gameover-screen");
    const canvas       = document.getElementById("game-canvas");
    const ctx          = canvas.getContext("2d");
    let minimapEl = null;
    let mctx = null;

    const usernameInput = document.getElementById("username-input");
    const joinBtn       = document.getElementById("join-btn");
    const readyBtn      = document.getElementById("ready-btn");
    const lobbyStatus   = document.getElementById("lobby-status");
    const lobbyPlayers  = document.getElementById("lobby-players");
    const restartBtn    = document.getElementById("restart-btn");

    // HUD refs – resolved lazily to survive stale cached HTML
    function $(id) { return document.getElementById(id); }
    let hudHpBar, hudHpText, hudTimer, hudKills, hudDeaths,
        killFeed, dmgNumbers, cooldownOverlay, cooldownBar,
        respawnOverlay, respawnTimerEl, bushIndicator;

    function resolveHudRefs() {
        if (hudHpBar) return;
        hudHpBar       = $("hud-hp-bar");
        hudHpText      = $("hud-hp-text");
        hudTimer       = $("hud-timer");
        hudKills       = $("hud-kills");
        hudDeaths      = $("hud-deaths");
        killFeed       = $("kill-feed");
        dmgNumbers     = $("damage-numbers");
        cooldownOverlay = $("cooldown-overlay");
        cooldownBar    = $("cooldown-bar");
        respawnOverlay = $("respawn-overlay");
        respawnTimerEl = $("respawn-timer");
        bushIndicator  = $("bush-indicator");
    }

    const gameoverTitle = document.getElementById("gameover-title");
    const gameoverStats = document.getElementById("gameover-stats");

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------
    let VIEW_W = 1050;   // virtual viewport width the player sees
    let VIEW_H = 750;   // virtual viewport height
    const INTERP = 0.3;
    const PLAYER_R = 22;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------
    let socket = null;
    let myId = null;
    let selectedBrawler = "fighter";
    let username = "";
    let gameActive = false;
    let gameLoopRunning = false;
    let isMobile = false;
    let controlMode = "joystick"; // "joystick" or "dpad"
    let botCount = 0;

    let gameState = {
        players: {}, bullets: [], obstacles: [], bushes: [],
        map_width: 2400, map_height: 1600, time_left: 180,
    };

    // Camera (world coords of top-left corner)
    let cam = { x: 0, y: 0 };

    // Input
    const keys = {};
    let mouseX = 0, mouseY = 0, mouseDown = false;

    // Mobile joystick state (dynamic – drawn at touch position)
    let moveJoy  = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0 };
    let shootJoy = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0, angle: 0, dist: 0 };
    const JOY_MAX = 55;
    const JOY_BASE_R = 55;
    const JOY_KNOB_R = 24;

    // Interpolated render positions
    let renderPlayers = {};

    // Blood particle system
    let particles = [];

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    function showScreen(scr) {
        [lobbyScreen, gameScreen, gameoverScreen].forEach(s => s.classList.remove("active"));
        scr.classList.add("active");
    }

    function isMobileDevice() {
        return "ontouchstart" in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 768;
    }

    function shouldUseJoysticks() {
        return true; // Always use joysticks on all devices
    }

    function tapHandler(el, fn) {
        let touchFired = false;
        el.addEventListener("touchstart", (e) => {
            e.preventDefault();
            e.stopPropagation();
            touchFired = true;
            fn(e);
        }, { passive: false });
        el.addEventListener("click", (e) => {
            if (touchFired) { touchFired = false; return; }
            fn(e);
        });
    }

    // -----------------------------------------------------------------------
    // Socket
    // -----------------------------------------------------------------------
    function connectSocket() {
        if (socket && socket.connected) {
            socket.disconnect();
        }
        socket = io("/game", { transports: ["polling"], upgrade: false });

        socket.on("connect", () => {
            myId = socket.id;
            // If we were in the lobby and reconnected, re-join
            if (lobbyScreen.classList.contains("active") && joinBtn.classList.contains("hidden")) {
                socket.emit("join_lobby", { username, brawler_type: selectedBrawler });
                // Reset ready button to match server state (re-joined = not ready)
                readyBtn.classList.remove("ready");
                readyBtn.textContent = "BEREIT";
            }
            // If we were in the game and reconnected, request game state
            if (gameScreen.classList.contains("active") && gameActive) {
                socket.emit("request_game_state", {});
            }
        });
        socket.on("lobby_joined", (d) => { myId = d.id; });

        socket.on("lobby_update", (data) => {
            lobbyStatus.classList.remove("hidden");
            lobbyPlayers.innerHTML = "";
            const colorMap = { fighter: "#3498db", tank: "#e74c3c", burst: "#2ecc71" };
            for (const [, info] of Object.entries(data.players)) {
                const col = colorMap[info.brawler_type] || "#3498db";
                const div = document.createElement("div");
                div.className = "lobby-player";
                div.innerHTML = `<span><span class="player-dot" style="background:${col}"></span>${info.username}</span>
                    <span class="ready-badge ${info.ready ? "is-ready" : "is-waiting"}">${info.ready ? "BEREIT" : "Wartet..."}</span>`;
                lobbyPlayers.appendChild(div);
            }
            // Show bots
            const botListEl = $("bot-list");
            if (botListEl && data.bots) {
                botListEl.innerHTML = "";
                for (const b of data.bots) {
                    const col = colorMap[b.brawler_type] || "#888";
                    const div = document.createElement("div");
                    div.className = "lobby-player bot-player";
                    div.innerHTML = `<span><span class="player-dot" style="background:${col}"></span>${b.name}</span>
                        <span class="ready-badge is-ready">BOT</span>`;
                    botListEl.appendChild(div);
                }
            }
            const bcEl = $("bot-count");
            if (bcEl && data.bot_count !== undefined) {
                botCount = data.bot_count;
                bcEl.textContent = botCount;
            }
        });

        socket.on("game_start", (state) => {
            gameState = state;
            gameActive = true;
            gameLoopRunning = true;
            renderPlayers = {};
            resolveHudRefs();
            for (const [sid, p] of Object.entries(state.players)) {
                renderPlayers[sid] = { x: p.x, y: p.y, angle: p.angle || 0 };
            }
            showScreen(gameScreen);
            resizeCanvas();
            // Show control toggle on mobile during game
            if (isMobile) {
                const cb = $("ctrl-mode-btn");
                if (cb) cb.classList.remove("hidden");
            }
            requestAnimationFrame(gameLoop);
        });

        socket.on("game_state", (state) => {
            if (!gameActive) return;
            for (const [sid, p] of Object.entries(state.players)) {
                if (!renderPlayers[sid]) {
                    renderPlayers[sid] = { x: p.x, y: p.y, angle: p.angle || 0 };
                } else {
                    // Snap position if player was invisible (at -1000) and is now visible
                    const rp = renderPlayers[sid];
                    if ((rp.tx !== undefined && rp.tx < -500) && p.x > -500) {
                        rp.x = p.x;
                        rp.y = p.y;
                    }
                }
                renderPlayers[sid].tx = p.x;
                renderPlayers[sid].ty = p.y;
                renderPlayers[sid].ta = p.angle || 0;
            }
            for (const sid of Object.keys(renderPlayers)) {
                if (!state.players[sid]) delete renderPlayers[sid];
            }
            gameState = state;
        });

        socket.on("game_event", (evt) => {
            if (evt.type === "kill") {
                addKillMsg(`${evt.killer_name} → ${evt.victim_name}`);
                spawnBloodBurst(evt.x || 0, evt.y || 0, 30);
            } else if (evt.type === "hit") {
                showDmgNumber(evt.x, evt.y, evt.damage);
                spawnBloodBurst(evt.x, evt.y, 12);
            } else if (evt.type === "round_over") {
                gameActive = false;
                gameLoopRunning = false;
                showGameOver();
            }
        });

        socket.on("bullet_fired", () => {});
        socket.on("player_left", (d) => { delete renderPlayers[d.id]; });
        socket.on("game_over", () => { gameActive = false; gameLoopRunning = false; showGameOver(); });
        socket.on("disconnect", () => { gameActive = false; gameLoopRunning = false; });
    }

    // -----------------------------------------------------------------------
    // Lobby (touch-safe)
    // -----------------------------------------------------------------------
    document.querySelectorAll(".brawler-card").forEach(card => {
        tapHandler(card, () => {
            document.querySelectorAll(".brawler-card").forEach(c => c.classList.remove("selected"));
            card.classList.add("selected");
            selectedBrawler = card.dataset.type;
        });
    });

    tapHandler(joinBtn, () => {
        if (joinBtn.classList.contains("hidden")) return;
        username = usernameInput.value.trim() || "Spieler";
        joinBtn.textContent = "VERBINDE...";
        joinBtn.style.opacity = "0.6";
        if (!socket || !socket.connected) connectSocket();
        const tryJoin = () => {
            if (socket && socket.connected) {
                socket.emit("join_lobby", { username, brawler_type: selectedBrawler });
                joinBtn.classList.add("hidden");
                joinBtn.textContent = "LOBBY BEITRETEN";
                joinBtn.style.opacity = "1";
            } else {
                setTimeout(tryJoin, 150);
            }
        };
        tryJoin();
    });

    tapHandler(readyBtn, () => {
        if (socket && socket.connected) {
            if (readyBtn.classList.contains("ready")) {
                // Un-ready
                socket.emit("player_unready", {});
                readyBtn.classList.remove("ready");
                readyBtn.textContent = "BEREIT";
            } else {
                // Ready up
                socket.emit("player_ready", {});
                readyBtn.classList.add("ready");
                readyBtn.textContent = "NICHT BEREIT";
            }
        }
    });

    tapHandler(restartBtn, () => {
        goToLobby();
    });

    function goToLobby() {
        if (socket && socket.connected) socket.disconnect();
        socket = null;
        myId = null;
        showScreen(lobbyScreen);
        joinBtn.classList.remove("hidden");
        lobbyStatus.classList.add("hidden");
        readyBtn.classList.remove("ready");
        readyBtn.textContent = "BEREIT";
        gameActive = false;
        gameLoopRunning = false;
        renderPlayers = {};
        botCount = 0;
        // Hide control toggle when leaving game
        const cb = $("ctrl-mode-btn");
        if (cb) cb.classList.add("hidden");
        const bcEl = $("bot-count");
        if (bcEl) bcEl.textContent = "0";
        const blEl = $("bot-list");
        if (blEl) blEl.innerHTML = "";
        // Pre-connect socket so it's ready for next join
        setTimeout(() => { connectSocket(); }, 300);
    }

    // -----------------------------------------------------------------------
    // Canvas sizing – fill the wrapper, we handle camera ourselves
    // -----------------------------------------------------------------------
    function resizeCanvas() {
        const wr = document.getElementById("canvas-wrapper");
        const dpr = window.devicePixelRatio || 1;
        const w = wr.clientWidth;
        const h = wr.clientHeight;
        canvas.width  = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width  = w + "px";
        canvas.style.height = h + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("orientationchange", () => {
        // iOS needs a short delay to settle the new layout after rotation
        setTimeout(resizeCanvas, 150);
        setTimeout(resizeCanvas, 500);
    });

    // -----------------------------------------------------------------------
    // Camera
    // -----------------------------------------------------------------------
    function updateCamera() {
        const me = gameState.players[myId];
        if (!me) return;
        const rp = renderPlayers[myId];
        if (!rp) return;
        const scale = getScale();
        const dpr = window.devicePixelRatio || 1;
        const viewW = (canvas.width / dpr) / scale;
        const viewH = (canvas.height / dpr) / scale;
        cam.x = rp.x - viewW / 2;
        cam.y = rp.y - viewH / 2;
        cam.x = Math.max(0, Math.min(gameState.map_width  - viewW, cam.x));
        cam.y = Math.max(0, Math.min(gameState.map_height - viewH, cam.y));
    }

    function getScale() {
        const dpr = window.devicePixelRatio || 1;
        const sx = (canvas.width / dpr) / VIEW_W;
        const sy = (canvas.height / dpr) / VIEW_H;
        return Math.min(sx, sy);
    }

    function worldToScreen(wx, wy) {
        const s = getScale();
        return { x: (wx - cam.x) * s, y: (wy - cam.y) * s };
    }

    function screenToWorld(sx, sy) {
        const s = getScale();
        return { x: sx / s + cam.x, y: sy / s + cam.y };
    }

    // -----------------------------------------------------------------------
    // Keyboard
    // -----------------------------------------------------------------------
    window.addEventListener("keydown", (e) => { keys[e.key.toLowerCase()] = true; });
    window.addEventListener("keyup",   (e) => { keys[e.key.toLowerCase()] = false; });

    // -----------------------------------------------------------------------
    // Mouse
    // -----------------------------------------------------------------------
    canvas.addEventListener("mousemove", (e) => {
        const r = canvas.getBoundingClientRect();
        mouseX = e.clientX - r.left;
        mouseY = e.clientY - r.top;
    });
    canvas.addEventListener("mousedown", (e) => { if (e.button === 0) mouseDown = true; });
    canvas.addEventListener("mouseup",   (e) => { if (e.button === 0) mouseDown = false; });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // -----------------------------------------------------------------------
    // Mobile Touch – document-level listeners for iOS reliability
    // Left half of screen = move joystick, Right half = shoot joystick
    // -----------------------------------------------------------------------
    function setupCanvasTouch() {
        // Touch events for mobile
        document.addEventListener("touchstart", (e) => {
            if (!gameActive && !gameScreen.classList.contains("active")) return;
            // Don't intercept touches on HUD buttons
            const tag = e.target.tagName.toLowerCase();
            if (tag === "button" || tag === "input" || tag === "select") return;
            if (e.target.id === "ctrl-mode-btn" || e.target.id === "leave-btn") return;
            e.preventDefault();

            const midX = window.innerWidth / 2;
            for (const t of e.changedTouches) {
                if (t.clientX < midX) {
                    if (!moveJoy.active) {
                        moveJoy.id = t.identifier;
                        moveJoy.active = true;
                        moveJoy.cx = t.clientX;
                        moveJoy.cy = t.clientY;
                        moveJoy.dx = 0; moveJoy.dy = 0; moveJoy.dist = 0;
                        moveJoy.screenDx = 0; moveJoy.screenDy = 0;
                    }
                } else {
                    if (!shootJoy.active) {
                        shootJoy.id = t.identifier;
                        shootJoy.active = true;
                        shootJoy.cx = t.clientX;
                        shootJoy.cy = t.clientY;
                        shootJoy.dx = 0; shootJoy.dy = 0; shootJoy.dist = 0;
                        shootJoy.screenDx = 0; shootJoy.screenDy = 0;
                    }
                }
            }
        }, { passive: false });

        document.addEventListener("touchmove", (e) => {
            if (!moveJoy.active && !shootJoy.active) return;
            e.preventDefault();
            for (const t of e.changedTouches) {
                let joy = null;
                if (t.identifier === moveJoy.id) joy = moveJoy;
                else if (t.identifier === shootJoy.id) joy = shootJoy;
                if (!joy) continue;
                let dx = t.clientX - joy.cx;
                let dy = t.clientY - joy.cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > JOY_MAX) { dx = dx / dist * JOY_MAX; dy = dy / dist * JOY_MAX; }
                joy.dx = dx / JOY_MAX;
                joy.dy = dy / JOY_MAX;
                joy.dist = Math.min(dist, JOY_MAX) / JOY_MAX;
                joy.angle = Math.atan2(dy, dx);
                joy.screenDx = dx;
                joy.screenDy = dy;
            }
        }, { passive: false });

        const endTouch = (e) => {
            for (const t of e.changedTouches) {
                if (t.identifier === moveJoy.id) {
                    moveJoy.active = false; moveJoy.id = null;
                    moveJoy.dx = 0; moveJoy.dy = 0; moveJoy.dist = 0;
                    moveJoy.screenDx = 0; moveJoy.screenDy = 0;
                }
                if (t.identifier === shootJoy.id) {
                    if (shootJoy.dist > 0.3 && socket && socket.connected) {
                        socket.emit("player_shoot", { angle: shootJoy.angle });
                    }
                    shootJoy.active = false; shootJoy.id = null;
                    shootJoy.dx = 0; shootJoy.dy = 0; shootJoy.dist = 0;
                    shootJoy.screenDx = 0; shootJoy.screenDy = 0;
                }
            }
        };
        document.addEventListener("touchend", endTouch, { passive: false });
        document.addEventListener("touchcancel", endTouch, { passive: false });

        // Mouse events for PC joysticks
        canvas.addEventListener("mousedown", (e) => {
            if (!gameActive && !gameScreen.classList.contains("active")) return;
            if (e.target.tagName.toLowerCase() === "button") return;
            e.preventDefault();

            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const midX = canvas.width / 2;

            if (x < midX) {
                // Move joystick
                moveJoy.active = true;
                moveJoy.id = "mouse";
                moveJoy.cx = x;
                moveJoy.cy = y;
                moveJoy.screenDx = 0;
                moveJoy.screenDy = 0;
            } else {
                // Shoot joystick
                shootJoy.active = true;
                shootJoy.id = "mouse";
                shootJoy.cx = x;
                shootJoy.cy = y;
                shootJoy.screenDx = 0;
                shootJoy.screenDy = 0;
            }
        });

        canvas.addEventListener("mousemove", (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            if (moveJoy.active && moveJoy.id === "mouse") {
                moveJoy.screenDx = x - moveJoy.cx;
                moveJoy.screenDy = y - moveJoy.cy;
                const dist = Math.sqrt(moveJoy.screenDx * moveJoy.screenDx + moveJoy.screenDy * moveJoy.screenDy);
                if (dist > JOY_MAX) {
                    const scale = JOY_MAX / dist;
                    moveJoy.screenDx *= scale;
                    moveJoy.screenDy *= scale;
                }
                moveJoy.dx = moveJoy.screenDx / JOY_MAX;
                moveJoy.dy = moveJoy.screenDy / JOY_MAX;
            }

            if (shootJoy.active && shootJoy.id === "mouse") {
                shootJoy.screenDx = x - shootJoy.cx;
                shootJoy.screenDy = y - shootJoy.cy;
                const dist = Math.sqrt(shootJoy.screenDx * shootJoy.screenDx + shootJoy.screenDy * shootJoy.screenDy);
                if (dist > JOY_MAX) {
                    const scale = JOY_MAX / dist;
                    shootJoy.screenDx *= scale;
                    shootJoy.screenDy *= scale;
                }
                shootJoy.dx = shootJoy.screenDx / JOY_MAX;
                shootJoy.dy = shootJoy.screenDy / JOY_MAX;
                shootJoy.dist = dist / JOY_MAX;
                shootJoy.angle = Math.atan2(shootJoy.dy, shootJoy.dx);
            }
        });

        canvas.addEventListener("mouseup", (e) => {
            if (moveJoy.active && moveJoy.id === "mouse") {
                moveJoy.active = false;
                moveJoy.id = null;
                moveJoy.dx = 0;
                moveJoy.dy = 0;
                moveJoy.screenDx = 0;
                moveJoy.screenDy = 0;
            }
            if (shootJoy.active && shootJoy.id === "mouse") {
                if (shootJoy.dist > 0.3 && socket && socket.connected) {
                    socket.emit("player_shoot", { angle: shootJoy.angle });
                }
                shootJoy.active = false;
                shootJoy.id = null;
                shootJoy.dx = 0;
                shootJoy.dy = 0;
                shootJoy.dist = 0;
                shootJoy.screenDx = 0;
                shootJoy.screenDy = 0;
            }
        });
    }

    // -----------------------------------------------------------------------
    // Input → server
    // -----------------------------------------------------------------------
    let lastShootSend = 0;
    let lastMoveSend = 0;
    function processInput() {
        if (!socket || !socket.connected || !gameActive) return;
        const now = performance.now();

        // Movement (rate-limited for consistency)
        let dx = 0, dy = 0;
        if (shouldUseJoysticks()) {
            if (moveJoy.active) { dx = moveJoy.dx; dy = moveJoy.dy; }
        } else {
            if (keys["w"] || keys["arrowup"])    dy -= 1;
            if (keys["s"] || keys["arrowdown"])  dy += 1;
            if (keys["a"] || keys["arrowleft"])  dx -= 1;
            if (keys["d"] || keys["arrowright"]) dx += 1;
        }
        if (dx !== 0 || dy !== 0) {
            socket.emit("player_move", { dx, dy });
        }

        // Aiming & Shooting
        if (shouldUseJoysticks()) {
            if (shootJoy.active && shootJoy.dist > 0.15) {
                socket.emit("player_angle", { angle: shootJoy.angle });
                // Auto-fire while held, throttled
                if (shootJoy.dist > 0.3 && now - lastShootSend > 100) {
                    socket.emit("player_shoot", { angle: shootJoy.angle });
                    lastShootSend = now;
                }
            }
        } else {
            const me = gameState.players[myId];
            if (me && me.alive) {
                const rp = renderPlayers[myId];
                if (rp) {
                    const sp = worldToScreen(rp.x, rp.y);
                    const angle = Math.atan2(mouseY - sp.y, mouseX - sp.x);
                    socket.emit("player_angle", { angle });
                    if (mouseDown) socket.emit("player_shoot", { angle });
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Game Loop
    // -----------------------------------------------------------------------
    function gameLoop(ts) {
        if (!gameActive) return;
        processInput();
        interpolate();
        updateCamera();
        render();
        renderMinimap();
        updateHUD();
        requestAnimationFrame(gameLoop);
    }

    function interpolate() {
        for (const [, rp] of Object.entries(renderPlayers)) {
            if (rp.tx !== undefined) {
                rp.x += (rp.tx - rp.x) * INTERP;
                rp.y += (rp.ty - rp.y) * INTERP;
                rp.angle += (rp.ta - rp.angle) * INTERP;
            }
        }
        updateParticles();
    }

    // -----------------------------------------------------------------------
    // Blood Particle System
    // -----------------------------------------------------------------------
    function spawnBloodBurst(wx, wy, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 0.5 + Math.random() * 3.5;
            const size = 2 + Math.random() * 4;
            const life = 0.4 + Math.random() * 0.6;
            particles.push({
                x: wx + (Math.random() - 0.5) * 10,
                y: wy + (Math.random() - 0.5) * 10,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: size,
                life: life,
                maxLife: life,
                r: 180 + Math.floor(Math.random() * 75),
                g: Math.floor(Math.random() * 30),
                b: Math.floor(Math.random() * 20),
                gravity: 0.03 + Math.random() * 0.04,
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.3,
            });
        }
        if (particles.length > 500) particles.splice(0, particles.length - 500);
    }

    function updateParticles() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += p.gravity;
            p.vx *= 0.97;
            p.vy *= 0.97;
            p.life -= 0.016;
            p.rotation += p.rotSpeed;
            p.size *= 0.995;
            if (p.life <= 0) particles.splice(i, 1);
        }
    }

    function drawParticles() {
        for (const p of particles) {
            const alpha = Math.max(0, (p.life / p.maxLife));
            const fadeAlpha = alpha > 0.3 ? 1 : alpha / 0.3;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.globalAlpha = fadeAlpha * 0.9;
            // Main drop
            ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
            ctx.beginPath();
            ctx.arc(0, 0, p.size, 0, Math.PI * 2);
            ctx.fill();
            // Bright core
            ctx.fillStyle = `rgba(255,${50 + p.g},${30 + p.b},${fadeAlpha * 0.5})`;
            ctx.beginPath();
            ctx.arc(0, 0, p.size * 0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.restore();
        }
    }

    // -----------------------------------------------------------------------
    // Main Render
    // -----------------------------------------------------------------------
    function render() {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr, h = canvas.height / dpr;
        const s = getScale();
        ctx.clearRect(0, 0, w, h);

        ctx.save();
        ctx.scale(s, s);
        ctx.translate(-cam.x, -cam.y);

        drawBackground(s);
        drawBushes();
        drawObstacles();
        drawBullets();
        drawPlayers(s);
        drawParticles();
        drawAimLine(s);

        ctx.restore();

        // Draw joysticks (screen space, on top)
        if (isMobile) drawJoysticks();
    }

    // --- Background ---
    function drawBackground(s) {
        const mw = gameState.map_width, mh = gameState.map_height;
        ctx.fillStyle = "#2d5a27";
        ctx.fillRect(0, 0, mw, mh);
        // Subtle grid
        ctx.strokeStyle = "rgba(255,255,255,0.035)";
        ctx.lineWidth = 1 / s;
        const gridSize = 80;
        const x0 = Math.floor(cam.x / gridSize) * gridSize;
        const y0 = Math.floor(cam.y / gridSize) * gridSize;
        const x1 = cam.x + canvas.width / s;
        const y1 = cam.y + canvas.height / s;
        for (let gx = x0; gx <= x1; gx += gridSize) {
            ctx.beginPath(); ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); ctx.stroke();
        }
        for (let gy = y0; gy <= y1; gy += gridSize) {
            ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke();
        }
        // Map border
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 4 / s;
        ctx.strokeRect(0, 0, mw, mh);
    }

    // --- Bushes ---
    function drawBushes() {
        const bushes = gameState.bushes || [];
        for (const b of bushes) {
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            // Multiple overlapping circles for organic shape
            ctx.fillStyle = "rgba(34,120,34,0.55)";
            const r = b.r || 50;
            for (let i = 0; i < 5; i++) {
                const ox = (i % 3 - 1) * r * 0.4;
                const oy = (Math.floor(i / 3) - 0.5) * r * 0.4;
                ctx.beginPath();
                ctx.arc(cx + ox, cy + oy, r * 0.7, 0, Math.PI * 2);
                ctx.fill();
            }
            // Darker edge spots
            ctx.fillStyle = "rgba(20,80,20,0.35)";
            ctx.beginPath();
            ctx.arc(cx - r * 0.3, cy - r * 0.2, r * 0.35, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx + r * 0.3, cy + r * 0.25, r * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // --- Obstacles ---
    function drawObstacles() {
        for (const obs of gameState.obstacles) {
            // Shadow
            ctx.fillStyle = "rgba(0,0,0,0.25)";
            ctx.fillRect(obs.x + 4, obs.y + 4, obs.w, obs.h);
            // Main block
            ctx.fillStyle = "#5a5a5a";
            ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
            // Top highlight
            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.fillRect(obs.x, obs.y, obs.w, 5);
            // Border
            ctx.strokeStyle = "#3a3a3a";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
            // Crack detail
            ctx.strokeStyle = "rgba(0,0,0,0.15)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(obs.x + obs.w * 0.3, obs.y);
            ctx.lineTo(obs.x + obs.w * 0.5, obs.y + obs.h * 0.5);
            ctx.lineTo(obs.x + obs.w * 0.7, obs.y + obs.h);
            ctx.stroke();
        }
    }

    // --- Bullets ---
    function drawBullets() {
        for (const b of gameState.bullets) {
            // Glow
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.radius * 2.5, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,200,50,0.15)";
            ctx.fill();
            // Core
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
            ctx.fillStyle = b.color || "#ffcc00";
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.6)";
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    // --- Players ---
    function drawPlayers(s) {
        for (const [sid, p] of Object.entries(gameState.players)) {
            if (p.visible === false && sid !== myId) continue;
            const rp = renderPlayers[sid];
            if (!rp) continue;
            const px = rp.x, py = rp.y;
            const pr = PLAYER_R;
            const angle = rp.angle || 0;
            const isMe = sid === myId;

            if (!p.alive) {
                ctx.globalAlpha = 0.25;
                ctx.beginPath();
                ctx.arc(px, py, pr, 0, Math.PI * 2);
                ctx.fillStyle = "#555";
                ctx.fill();
                ctx.globalAlpha = 1;
                continue;
            }

            // Shadow
            ctx.beginPath();
            ctx.ellipse(px + 2, py + 4, pr * 0.85, pr * 0.45, 0, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0,0,0,0.2)";
            ctx.fill();

            // Gun barrel
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);
            ctx.fillStyle = "#3a3a3a";
            const gunL = pr * 1.5, gunW = pr * 0.38;
            ctx.fillRect(pr * 0.2, -gunW / 2, gunL, gunW);
            ctx.strokeStyle = "#2a2a2a";
            ctx.lineWidth = 1;
            ctx.strokeRect(pr * 0.2, -gunW / 2, gunL, gunW);
            // Muzzle
            ctx.fillStyle = "#222";
            ctx.fillRect(pr * 0.2 + gunL - 4, -gunW / 2 - 1, 5, gunW + 2);
            ctx.restore();

            // Body
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            ctx.strokeStyle = isMe ? "#fff" : "rgba(255,255,255,0.25)";
            ctx.lineWidth = isMe ? 2.5 : 1.2;
            ctx.stroke();

            // Inner highlight
            ctx.beginPath();
            ctx.arc(px - pr * 0.2, py - pr * 0.2, pr * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,255,255,0.1)";
            ctx.fill();

            // Eyes
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);
            [[0.3, -0.25], [0.3, 0.25]].forEach(([ex, ey]) => {
                ctx.beginPath();
                ctx.arc(pr * ex, pr * ey, pr * 0.14, 0, Math.PI * 2);
                ctx.fillStyle = "#fff";
                ctx.fill();
                ctx.beginPath();
                ctx.arc(pr * (ex + 0.06), pr * ey, pr * 0.07, 0, Math.PI * 2);
                ctx.fillStyle = "#111";
                ctx.fill();
            });
            ctx.restore();

            // HP bar
            const hpW = pr * 2.8, hpH = 5;
            const hpX = px - hpW / 2, hpY = py - pr - 14;
            const hpPct = Math.max(0, p.hp / p.max_hp);
            ctx.fillStyle = "rgba(0,0,0,0.45)";
            roundRect(ctx, hpX - 1, hpY - 1, hpW + 2, hpH + 2, 3);
            ctx.fill();
            ctx.fillStyle = "#5e1010";
            roundRect(ctx, hpX, hpY, hpW, hpH, 2);
            ctx.fill();
            ctx.fillStyle = hpPct > 0.5 ? "#2ecc71" : hpPct > 0.25 ? "#f39c12" : "#e74c3c";
            if (hpPct > 0) {
                roundRect(ctx, hpX, hpY, hpW * hpPct, hpH, 2);
                ctx.fill();
            }

            // Name
            ctx.fillStyle = isMe ? "#fff" : "rgba(255,255,255,0.8)";
            ctx.font = `bold 11px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(p.username, px, hpY - 3);
        }
    }

    function roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.lineTo(x + w - r, y);
        c.arcTo(x + w, y, x + w, y + r, r);
        c.lineTo(x + w, y + h - r);
        c.arcTo(x + w, y + h, x + w - r, y + h, r);
        c.lineTo(x + r, y + h);
        c.arcTo(x, y + h, x, y + h - r, r);
        c.lineTo(x, y + r);
        c.arcTo(x, y, x + r, y, r);
        c.closePath();
    }

    // --- Aim Line (mobile shoot joystick preview + PC mouse aim) ---
    function drawAimLine(s) {
        const me = gameState.players[myId];
        if (!me || !me.alive) return;
        const rp = renderPlayers[myId];
        if (!rp) return;

        let angle, showLine = false;

        if (isMobile && shootJoy.active && shootJoy.dist > 0.15) {
            angle = shootJoy.angle;
            showLine = true;
        } else if (!isMobile) {
            const sp = worldToScreen(rp.x, rp.y);
            angle = Math.atan2(mouseY - sp.y, mouseX - sp.x);
            showLine = true;
        }

        if (!showLine) return;

        const range = me.bullet_range || 700;

        const px = rp.x, py = rp.y;
        const ex = px + Math.cos(angle) * range;
        const ey = py + Math.sin(angle) * range;

        // Dotted aim line
        ctx.save();
        ctx.setLineDash([6, 8]);
        ctx.strokeStyle = isMobile
            ? "rgba(255, 255, 100, 0.5)"
            : "rgba(255, 255, 255, 0.2)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(angle) * (PLAYER_R + 10), py + Math.sin(angle) * (PLAYER_R + 10));
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);

        // Endpoint circle
        ctx.beginPath();
        ctx.arc(ex, ey, 6, 0, Math.PI * 2);
        ctx.strokeStyle = isMobile
            ? "rgba(255, 255, 100, 0.4)"
            : "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Draw mobile joysticks (screen-space overlay on canvas)
    // -----------------------------------------------------------------------
    function drawJoysticks() {
        if (controlMode === "dpad") {
            drawDpadHint();
        } else {
            drawOneJoystick(moveJoy, "rgba(255,255,255,0.12)", "rgba(255,255,255,0.30)");
            drawOneJoystick(shootJoy, "rgba(255,100,100,0.12)", "rgba(255,100,100,0.35)");
        }
    }

    function drawOneJoystick(joy, baseCol, knobCol) {
        if (!joy.active) return;
        const r = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const cx = (joy.cx - r.left) * (canvas.width / dpr / r.width);
        const cy = (joy.cy - r.top) * (canvas.height / dpr / r.height);
        // Base
        ctx.beginPath();
        ctx.arc(cx, cy, JOY_BASE_R, 0, Math.PI * 2);
        ctx.fillStyle = baseCol;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Knob
        const kx = cx + (joy.screenDx || 0);
        const ky = cy + (joy.screenDy || 0);
        ctx.beginPath();
        ctx.arc(kx, ky, JOY_KNOB_R, 0, Math.PI * 2);
        ctx.fillStyle = knobCol;
        ctx.fill();
    }

    function _touchToCanvas(tx, ty) {
        const r = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        return {
            x: (tx - r.left) * (canvas.width / dpr / r.width),
            y: (ty - r.top) * (canvas.height / dpr / r.height),
        };
    }

    function drawDpadHint() {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        // Left side: movement hint
        ctx.globalAlpha = 0.15;
        ctx.font = "bold 14px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.fillText("BEWEGEN", w * 0.25, h - 20);
        // Right side: shoot hint
        ctx.fillStyle = "#f66";
        ctx.fillText("ZIELEN + SCHIESSEN", w * 0.75, h - 20);
        // Active indicator
        if (moveJoy.active) {
            const c = _touchToCanvas(moveJoy.cx, moveJoy.cy);
            const ex = c.x + (moveJoy.screenDx || 0) * 1.5;
            const ey = c.y + (moveJoy.screenDy || 0) * 1.5;
            ctx.globalAlpha = 0.25;
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(ex, ey); ctx.stroke();
            ctx.beginPath(); ctx.arc(ex, ey, 8, 0, Math.PI * 2);
            ctx.fillStyle = "#fff"; ctx.fill();
        }
        if (shootJoy.active) {
            const c = _touchToCanvas(shootJoy.cx, shootJoy.cy);
            const ex = c.x + (shootJoy.screenDx || 0) * 1.5;
            const ey = c.y + (shootJoy.screenDy || 0) * 1.5;
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = "#f66";
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(ex, ey); ctx.stroke();
            ctx.beginPath(); ctx.arc(ex, ey, 8, 0, Math.PI * 2);
            ctx.fillStyle = "#f66"; ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // -----------------------------------------------------------------------
    // Minimap
    // -----------------------------------------------------------------------
    function renderMinimap() {
        if (!minimapEl) {
            minimapEl = document.getElementById("minimap");
            if (!minimapEl) return;
            mctx = minimapEl.getContext("2d");
        }
        if (!mctx) return;
        const mw = minimapEl.width = minimapEl.clientWidth * (window.devicePixelRatio || 1);
        const mh = minimapEl.height = minimapEl.clientHeight * (window.devicePixelRatio || 1);
        const sx = mw / gameState.map_width;
        const sy = mh / gameState.map_height;
        mctx.clearRect(0, 0, mw, mh);

        // BG
        mctx.fillStyle = "rgba(30,60,25,0.8)";
        mctx.fillRect(0, 0, mw, mh);

        // Bushes
        mctx.fillStyle = "rgba(34,120,34,0.5)";
        for (const b of (gameState.bushes || [])) {
            mctx.beginPath();
            mctx.arc((b.x + b.w / 2) * sx, (b.y + b.h / 2) * sy, (b.r || 40) * Math.min(sx, sy), 0, Math.PI * 2);
            mctx.fill();
        }

        // Obstacles
        mctx.fillStyle = "rgba(90,90,90,0.7)";
        for (const o of gameState.obstacles) {
            mctx.fillRect(o.x * sx, o.y * sy, o.w * sx, o.h * sy);
        }

        // Viewport box
        const scale = getScale();
        const vw = (canvas.width / scale) * sx;
        const vh = (canvas.height / scale) * sy;
        mctx.strokeStyle = "rgba(255,255,255,0.4)";
        mctx.lineWidth = 1;
        mctx.strokeRect(cam.x * sx, cam.y * sy, vw, vh);

        // Players
        for (const [sid, p] of Object.entries(gameState.players)) {
            if (!p.alive || !p.visible) continue;
            const rp = renderPlayers[sid];
            if (!rp) continue;
            mctx.beginPath();
            mctx.arc(rp.x * sx, rp.y * sy, sid === myId ? 4 : 3, 0, Math.PI * 2);
            mctx.fillStyle = p.color;
            mctx.fill();
            if (sid === myId) {
                mctx.strokeStyle = "#fff";
                mctx.lineWidth = 1;
                mctx.stroke();
            }
        }
    }

    // -----------------------------------------------------------------------
    // HUD Update
    // -----------------------------------------------------------------------
    function updateHUD() {
        const me = gameState.players[myId];
        if (!me) return;
        resolveHudRefs();

        // HP bar
        const pct = Math.max(0, me.hp / me.max_hp);
        if (hudHpBar) {
            hudHpBar.style.width = (pct * 100) + "%";
            hudHpBar.style.background = pct > 0.5 ? "#2ecc71" : pct > 0.25 ? "#f39c12" : "#e74c3c";
        }
        if (hudHpText) hudHpText.textContent = `${me.hp}/${me.max_hp}`;

        // Timer
        const tl = gameState.time_left || 0;
        const mins = Math.floor(tl / 60);
        const secs = Math.floor(tl % 60);
        if (hudTimer) hudTimer.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;

        // Kills/Deaths
        if (hudKills) hudKills.textContent = `K: ${me.kills}`;
        if (hudDeaths) hudDeaths.textContent = `D: ${me.deaths}`;

        // Cooldown bar
        const now = Date.now() / 1000;
        const lastFire = me.last_fire || 0;
        const cd = me.fire_cooldown || 0.4;
        const cdPct = Math.min(1, (now - lastFire) / cd);
        if (cooldownOverlay && cooldownBar) {
            if (cdPct < 1) {
                cooldownOverlay.classList.remove("hidden");
                cooldownBar.style.width = (cdPct * 100) + "%";
                cooldownBar.style.background = "#e74c3c";
            } else {
                cooldownOverlay.classList.remove("hidden");
                cooldownBar.style.width = "100%";
                cooldownBar.style.background = "#2ecc71";
            }
        }

        // Respawn overlay
        if (respawnOverlay) {
            if (!me.alive && me.respawn_at) {
                respawnOverlay.classList.remove("hidden");
                const left = Math.max(0, me.respawn_at - now);
                if (respawnTimerEl) respawnTimerEl.textContent = `Respawn in ${Math.ceil(left)}...`;
            } else {
                respawnOverlay.classList.add("hidden");
            }
        }

        // Bush indicator
        if (bushIndicator) {
            if (me.in_bush && me.alive) {
                bushIndicator.classList.remove("hidden");
            } else {
                bushIndicator.classList.add("hidden");
            }
        }
    }

    // -----------------------------------------------------------------------
    // Damage Numbers
    // -----------------------------------------------------------------------
    function showDmgNumber(wx, wy, dmg) {
        const sp = worldToScreen(wx, wy);
        const el = document.createElement("div");
        el.className = "dmg-num";
        el.textContent = `-${dmg}`;
        el.style.left = sp.x + "px";
        el.style.top = sp.y + "px";
        resolveHudRefs();
        if (!dmgNumbers) return;
        dmgNumbers.appendChild(el);
        setTimeout(() => el.remove(), 850);
    }

    // -----------------------------------------------------------------------
    // Kill Feed
    // -----------------------------------------------------------------------
    function addKillMsg(text) {
        const div = document.createElement("div");
        div.className = "kill-msg";
        div.textContent = text;
        resolveHudRefs();
        if (!killFeed) return;
        killFeed.appendChild(div);
        setTimeout(() => div.remove(), 4500);
    }

    // -----------------------------------------------------------------------
    // Game Over
    // -----------------------------------------------------------------------
    function showGameOver() {
        gameoverTitle.textContent = "SPIEL VORBEI";
        let html = "";
        const sorted = Object.values(gameState.players).sort((a, b) => b.kills - a.kills);
        let rank = 0;
        for (const p of sorted) {
            rank++;
            const medal = rank === 1 ? "🏆 " : "";
            html += `<div class="stat-row">
                <span style="color:${p.color}">${medal}${p.username}</span>
                <span>K: ${p.kills} / D: ${p.deaths}</span>
            </div>`;
        }
        gameoverStats.innerHTML = html;
        showScreen(gameoverScreen);
    }

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------
    function init() {
        isMobile = isMobileDevice();
        // Always setup touch/mouse controls for joysticks
        setupCanvasTouch();
        
        // Mobile: smaller viewport = more zoom, feels faster
        if (isMobile) {
            VIEW_W = 650;   // Mobile viewport (moderate zoom)
            VIEW_H = 450;
            // Try to lock screen to landscape (supported on some browsers)
            try {
                if (screen.orientation && screen.orientation.lock) {
                    screen.orientation.lock("landscape").catch(() => {});
                }
            } catch (_) {}
            // Control mode toggle (only visible during game, setup handler now)
            const ctrlBtn = $("ctrl-mode-btn");
            if (ctrlBtn) {
                tapHandler(ctrlBtn, () => {
                    controlMode = controlMode === "joystick" ? "dpad" : "joystick";
                    ctrlBtn.textContent = controlMode === "joystick" ? "\uD83C\uDFAE Joystick" : "\u2B06\uFE0F D-Pad";
                });
            }
        }
        // Leave button
        const leaveBtn = $("leave-btn");
        if (leaveBtn) tapHandler(leaveBtn, () => { gameActive = false; goToLobby(); });
        // Bot controls
        const botMinus = $("bot-minus");
        const botPlus = $("bot-plus");
        if (botMinus) tapHandler(botMinus, () => {
            botCount = Math.max(0, botCount - 1);
            if (socket && socket.connected) socket.emit("set_bots", { count: botCount });
        });
        if (botPlus) tapHandler(botPlus, () => {
            botCount = Math.min(8, botCount + 1);
            if (socket && socket.connected) socket.emit("set_bots", { count: botCount });
        });
        showScreen(lobbyScreen);
        // Connect socket on page load so it's ready when user taps join
        connectSocket();
        
        // Handle tab visibility changes (iOS Safari canvas fix)
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && gameActive && gameScreen.classList.contains("active")) {
                // Tab became visible again during game - fix canvas
                resizeCanvas();
                if (!gameLoopRunning) {
                    gameLoopRunning = true;
                    requestAnimationFrame(gameLoop);
                }
            }
        });
    }

    init();
})();
