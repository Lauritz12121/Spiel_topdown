import time
import math
import random
import threading
from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = 'brawl-game-secret-key-2024'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading', ping_timeout=30, ping_interval=5, allow_upgrades=False)

# ---------------------------------------------------------------------------
# Game Constants
# ---------------------------------------------------------------------------
MAP_WIDTH = 2400
MAP_HEIGHT = 1600
PLAYER_RADIUS = 22
BULLET_RADIUS = 6
RESPAWN_TIME = 3.0
ROUND_TIME = 180

OBSTACLES = [
    # Top-left cluster
    {"x": 180, "y": 120, "w": 90, "h": 90},
    {"x": 350, "y": 200, "w": 60, "h": 140},
    # Top-center
    {"x": 700, "y": 80, "w": 140, "h": 60},
    {"x": 900, "y": 180, "w": 80, "h": 80},
    # Top-right cluster
    {"x": 1500, "y": 100, "w": 100, "h": 70},
    {"x": 1700, "y": 180, "w": 60, "h": 130},
    {"x": 2050, "y": 120, "w": 90, "h": 90},
    # Middle-left
    {"x": 100, "y": 600, "w": 70, "h": 160},
    {"x": 300, "y": 700, "w": 120, "h": 80},
    # Center arena walls
    {"x": 850, "y": 550, "w": 100, "h": 100},
    {"x": 1100, "y": 500, "w": 60, "h": 200},
    {"x": 1300, "y": 600, "w": 100, "h": 100},
    {"x": 1050, "y": 750, "w": 200, "h": 60},
    # Middle-right
    {"x": 1900, "y": 600, "w": 70, "h": 160},
    {"x": 2100, "y": 700, "w": 120, "h": 80},
    # Bottom-left cluster
    {"x": 180, "y": 1300, "w": 90, "h": 90},
    {"x": 400, "y": 1200, "w": 60, "h": 140},
    # Bottom-center
    {"x": 700, "y": 1400, "w": 140, "h": 60},
    {"x": 950, "y": 1300, "w": 80, "h": 80},
    # Bottom-right cluster
    {"x": 1500, "y": 1350, "w": 100, "h": 70},
    {"x": 1750, "y": 1250, "w": 60, "h": 130},
    {"x": 2050, "y": 1300, "w": 90, "h": 90},
    # Extra cover
    {"x": 550, "y": 450, "w": 80, "h": 80},
    {"x": 1650, "y": 450, "w": 80, "h": 80},
    {"x": 550, "y": 1050, "w": 80, "h": 80},
    {"x": 1650, "y": 1050, "w": 80, "h": 80},
]

BUSHES = [
    # Top area
    {"x": 450, "y": 80, "w": 140, "h": 100, "r": 60},
    {"x": 1200, "y": 60, "w": 160, "h": 110, "r": 65},
    {"x": 1850, "y": 280, "w": 120, "h": 100, "r": 55},
    # Left side
    {"x": 50, "y": 350, "w": 130, "h": 140, "r": 65},
    {"x": 200, "y": 900, "w": 150, "h": 130, "r": 70},
    {"x": 80, "y": 1100, "w": 120, "h": 120, "r": 60},
    # Center bushes (strategic)
    {"x": 650, "y": 650, "w": 130, "h": 130, "r": 65},
    {"x": 1450, "y": 650, "w": 130, "h": 130, "r": 65},
    {"x": 650, "y": 900, "w": 130, "h": 130, "r": 65},
    {"x": 1450, "y": 900, "w": 130, "h": 130, "r": 65},
    {"x": 1050, "y": 380, "w": 110, "h": 100, "r": 55},
    {"x": 1050, "y": 1050, "w": 110, "h": 100, "r": 55},
    # Right side
    {"x": 2150, "y": 350, "w": 130, "h": 140, "r": 65},
    {"x": 2000, "y": 900, "w": 150, "h": 130, "r": 70},
    {"x": 2150, "y": 1100, "w": 120, "h": 120, "r": 60},
    # Bottom area
    {"x": 450, "y": 1400, "w": 140, "h": 100, "r": 60},
    {"x": 1200, "y": 1420, "w": 160, "h": 110, "r": 65},
    {"x": 1850, "y": 1250, "w": 120, "h": 100, "r": 55},
]

SPAWN_POINTS = [
    {"x": 120, "y": 120},
    {"x": 2280, "y": 1480},
    {"x": 120, "y": 1480},
    {"x": 2280, "y": 120},
    {"x": 1200, "y": 120},
    {"x": 1200, "y": 1480},
]

BOT_NAMES = ["Hans", "Fritz", "Karl", "Otto", "Max", "Günter", "Werner", "Klaus", "Dieter", "Heinz"]

BRAWLER_TYPES = {
    "fighter": {
        "name": "Fighter",
        "color": "#3498db",
        "speed": 6.0,
        "damage": 18,
        "hp": 100,
        "fire_cooldown": 1.0,
        "bullet_speed": 60.0,
        "bullet_range": 800,
        "burst_count": 1,
    },
    "tank": {
        "name": "Tank",
        "color": "#e74c3c",
        "speed": 3.0,
        "damage": 80,
        "hp": 160,
        "fire_cooldown": 3.5,
        "bullet_speed": 45.0,
        "bullet_range": 600,
        "burst_count": 1,
    },
    "burst": {
        "name": "Burst",
        "color": "#2ecc71",
        "speed": 5.0,
        "damage": 6,
        "hp": 110,
        "fire_cooldown": 1.8,
        "bullet_speed": 55.0,
        "bullet_range": 700,
        "burst_count": 10,
    },
    "dragonlord": {
        "name": "Drachenlord",
        "color": "#9b59b6",
        "speed": 7.0,
        "damage": 20,
        "hp": 90,
        "fire_cooldown": 2.5,
        "bullet_speed": 40.0,
        "bullet_range": 400,
        "burst_count": 3,
    },
}

# ---------------------------------------------------------------------------
# Game State
# ---------------------------------------------------------------------------
class GameState:
    def __init__(self):
        self.players = {}
        self.bullets = []
        self.bullet_id_counter = 0
        self.lobby = {}
        self.game_active = False
        self.round_start_time = None
        self.burst_queue = []  # [{"sid", "angle", "remaining", "next_fire"}]
        self.bots = {}  # bot_id -> bot AI state
        self.bot_id_counter = 0
        self.pending_bots = []  # [{"name", "brawler_type"}] added from lobby
        self.lock = threading.Lock()

    def add_player(self, sid, username, brawler_type):
        used_spawns = [
            (p["x"], p["y"]) for p in self.players.values()
        ]
        available = [s for s in SPAWN_POINTS
                     if not any(abs(s["x"] - ux) < 100 and abs(s["y"] - uy) < 100
                                for ux, uy in used_spawns)]
        if not available:
            available = SPAWN_POINTS
        spawn = random.choice(available)
        brawler = BRAWLER_TYPES.get(brawler_type, BRAWLER_TYPES["fighter"])
        with self.lock:
            self.players[sid] = {
                "id": sid,
                "username": username,
                "brawler_type": brawler_type,
                "x": spawn["x"],
                "y": spawn["y"],
                "hp": brawler["hp"],
                "max_hp": brawler["hp"],
                "speed": brawler["speed"],
                "damage": brawler["damage"],
                "fire_cooldown": brawler["fire_cooldown"],
                "bullet_speed": brawler["bullet_speed"],
                "bullet_range": brawler["bullet_range"],
                "burst_count": brawler.get("burst_count", 1),
                "color": brawler["color"],
                "kills": 0,
                "deaths": 0,
                "alive": True,
                "respawn_at": None,
                "last_fire": 0,
                "angle": 0,
                "in_bush": False,
            }

    def remove_player(self, sid):
        with self.lock:
            self.players.pop(sid, None)
            self.lobby.pop(sid, None)

    def _point_in_bush(self, x, y):
        for bush in BUSHES:
            cx = bush["x"] + bush["w"] / 2
            cy = bush["y"] + bush["h"] / 2
            if abs(x - cx) < bush["w"] / 2 and abs(y - cy) < bush["h"] / 2:
                return True
        return False

    def move_player(self, sid, dx, dy):
        with self.lock:
            p = self.players.get(sid)
            if not p or not p["alive"]:
                return
            speed = p["speed"]
            length = math.sqrt(dx * dx + dy * dy)
            if length > 0:
                dx = (dx / length) * speed
                dy = (dy / length) * speed

            new_x = p["x"] + dx
            new_y = p["y"] + dy

            new_x = max(PLAYER_RADIUS, min(MAP_WIDTH - PLAYER_RADIUS, new_x))
            new_y = max(PLAYER_RADIUS, min(MAP_HEIGHT - PLAYER_RADIUS, new_y))

            if not self._collides_obstacle(new_x, new_y, PLAYER_RADIUS):
                p["x"] = new_x
                p["y"] = new_y

            p["in_bush"] = self._point_in_bush(p["x"], p["y"])

    def _spawn_bullet(self, p, sid, angle, spread=0):
        """Create a single bullet (called with lock held)."""
        a = angle + spread
        self.bullet_id_counter += 1
        bullet = {
            "id": self.bullet_id_counter,
            "owner": sid,
            "x": p["x"] + math.cos(a) * (PLAYER_RADIUS + BULLET_RADIUS + 2),
            "y": p["y"] + math.sin(a) * (PLAYER_RADIUS + BULLET_RADIUS + 2),
            "start_x": p["x"],
            "start_y": p["y"],
            "dx": math.cos(a) * p["bullet_speed"],
            "dy": math.sin(a) * p["bullet_speed"],
            "damage": p["damage"],
            "color": p["color"],
            "radius": BULLET_RADIUS,
            "max_range": p["bullet_range"],
        }
        self.bullets.append(bullet)
        return bullet

    def fire_bullet(self, sid, angle):
        with self.lock:
            p = self.players.get(sid)
            if not p or not p["alive"]:
                return None
            now = time.time()
            if now - p["last_fire"] < p["fire_cooldown"]:
                return None
            p["last_fire"] = now
            p["angle"] = angle
            p["in_bush"] = False
            burst = p.get("burst_count", 1)
            if burst > 1:
                # Queue remaining burst shots
                self.burst_queue = [bq for bq in self.burst_queue if bq["sid"] != sid]
                self.burst_queue.append({
                    "sid": sid,
                    "angle": angle,
                    "remaining": burst - 1,
                    "next_fire": now + 0.05,
                })
            # Fire first bullet (with small random spread for burst)
            spread = random.uniform(-0.08, 0.08) if burst > 1 else 0
            return self._spawn_bullet(p, sid, angle, spread)

    def update(self):
        with self.lock:
            now = time.time()
            # Round timer
            time_left = -1
            if self.round_start_time:
                elapsed = now - self.round_start_time
                time_left = max(0, ROUND_TIME - elapsed)
                if time_left <= 0:
                    return self._end_round()

            # Process burst queues
            bursts_done = []
            for bq in self.burst_queue:
                if now >= bq["next_fire"] and bq["remaining"] > 0:
                    p = self.players.get(bq["sid"])
                    if p and p["alive"]:
                        spread = random.uniform(-0.12, 0.12)
                        self._spawn_bullet(p, bq["sid"], bq["angle"], spread)
                        bq["remaining"] -= 1
                        bq["next_fire"] = now + 0.05
                    else:
                        bq["remaining"] = 0
                if bq["remaining"] <= 0:
                    bursts_done.append(bq)
            for bq in bursts_done:
                self.burst_queue.remove(bq)

            # Bot AI
            self.update_bots()

            # Respawn check
            for p in self.players.values():
                if not p["alive"] and p["respawn_at"] and now >= p["respawn_at"]:
                    spawn = random.choice(SPAWN_POINTS)
                    p["x"] = spawn["x"]
                    p["y"] = spawn["y"]
                    p["hp"] = p["max_hp"]
                    p["alive"] = True
                    p["respawn_at"] = None
                    p["in_bush"] = self._point_in_bush(p["x"], p["y"])

            # Update bullets
            bullets_to_remove = []
            hit_events = []
            for b in self.bullets:
                b["x"] += b["dx"]
                b["y"] += b["dy"]

                # Out of bounds
                if b["x"] < 0 or b["x"] > MAP_WIDTH or b["y"] < 0 or b["y"] > MAP_HEIGHT:
                    bullets_to_remove.append(b)
                    continue

                # Range limit
                dist_from_start = math.sqrt(
                    (b["x"] - b["start_x"]) ** 2 + (b["y"] - b["start_y"]) ** 2
                )
                if dist_from_start > b["max_range"]:
                    bullets_to_remove.append(b)
                    continue

                # Hit obstacle
                if self._collides_obstacle(b["x"], b["y"], b["radius"]):
                    bullets_to_remove.append(b)
                    continue

                # Hit player
                for p in self.players.values():
                    if p["id"] == b["owner"] or not p["alive"]:
                        continue
                    dist = math.sqrt((b["x"] - p["x"]) ** 2 + (b["y"] - p["y"]) ** 2)
                    if dist < PLAYER_RADIUS + b["radius"]:
                        p["hp"] -= b["damage"]
                        bullets_to_remove.append(b)
                        if p["hp"] <= 0:
                            p["hp"] = 0
                            p["alive"] = False
                            p["deaths"] += 1
                            p["respawn_at"] = now + RESPAWN_TIME
                            owner = self.players.get(b["owner"])
                            if owner:
                                owner["kills"] += 1
                            hit_events.append({
                                "type": "kill",
                                "victim": p["id"],
                                "killer": b["owner"],
                                "victim_name": p["username"],
                                "killer_name": owner["username"] if owner else "?",
                                "x": p["x"],
                                "y": p["y"],
                            })
                        else:
                            hit_events.append({
                                "type": "hit",
                                "victim": p["id"],
                                "shooter": b["owner"],
                                "damage": b["damage"],
                                "x": p["x"],
                                "y": p["y"],
                            })
                        break

            for b in bullets_to_remove:
                if b in self.bullets:
                    self.bullets.remove(b)

            return hit_events

    # --- Bot personality presets per brawler type ---
    BOT_PROFILES = {
        "fighter": {
            "aggro_range": 900,
            "ideal_range_pct": 0.85,   # stay at 85% of bullet_range (680 for fighter)
            "retreat_hp_pct": 0.2,
            "accuracy": 0.9,
            "strafe_speed": 0.8,
            "chase_speed": 1.0,
            "reaction": (0.15, 0.4),
        },
        "tank": {
            "aggro_range": 700,
            "ideal_range_pct": 0.85,   # stay at 85% of bullet_range (510 for tank)
            "retreat_hp_pct": 0.15,
            "accuracy": 0.8,
            "strafe_speed": 0.5,
            "chase_speed": 0.9,
            "reaction": (0.25, 0.55),
        },
        "burst": {
            "aggro_range": 800,
            "ideal_range_pct": 0.88,   # stay at 88% of bullet_range (616 for burst)
            "retreat_hp_pct": 0.35,
            "accuracy": 0.85,
            "strafe_speed": 0.9,
            "chase_speed": 0.8,
            "reaction": (0.2, 0.5),
        },
    }

    def add_bot(self, name, brawler_type):
        """Add a bot as a player with AI state."""
        self.bot_id_counter += 1
        bot_id = f"bot_{self.bot_id_counter}"
        self.add_player(bot_id, name, brawler_type)
        profile = self.BOT_PROFILES.get(brawler_type, self.BOT_PROFILES["fighter"])
        self.bots[bot_id] = {
            "target": None,
            "wander_angle": random.uniform(0, math.pi * 2),
            "wander_change": 0,
            "state": "wander",
            "reaction_delay": random.uniform(*profile["reaction"]),
            "last_decision": 0,
            "accuracy": profile["accuracy"] + random.uniform(-0.05, 0.05),
            "strafe_dir": random.choice([-1, 1]),
            "strafe_change": 0,
            "profile": profile,
            "stuck_timer": 0,
            "stuck_x": 0,
            "stuck_y": 0,
            "avoidance_angle": 0,  # current wall-avoidance steer
        }
        return bot_id

    def _obstacle_avoidance(self, px, py, desired_dx, desired_dy, radius):
        """Steer around obstacles. Returns adjusted (dx, dy)."""
        # Check if desired direction is blocked
        speed = math.sqrt(desired_dx ** 2 + desired_dy ** 2)
        if speed < 0.01:
            return desired_dx, desired_dy

        # Look ahead multiple steps
        look_dist = radius * 3
        check_x = px + (desired_dx / speed) * look_dist
        check_y = py + (desired_dy / speed) * look_dist

        if not self._collides_obstacle(check_x, check_y, radius + 5):
            return desired_dx, desired_dy  # path clear

        # Find nearest obstacle edge to steer around
        best_dx, best_dy = 0, 0
        best_score = -999

        # Try 8 directions to find clear path closest to desired
        desired_angle = math.atan2(desired_dy, desired_dx)
        for offset in [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, math.pi]:
            test_angle = desired_angle + offset
            tx = px + math.cos(test_angle) * look_dist
            ty = py + math.sin(test_angle) * look_dist
            if not self._collides_obstacle(tx, ty, radius + 5):
                # Score: prefer directions closer to original desired direction
                score = 1.0 - abs(offset) / math.pi
                if score > best_score:
                    best_score = score
                    best_dx = math.cos(test_angle) * speed
                    best_dy = math.sin(test_angle) * speed

        if best_score > -999:
            return best_dx, best_dy

        # Completely stuck: try perpendicular
        perp_angle = desired_angle + math.pi / 2
        return math.cos(perp_angle) * speed, math.sin(perp_angle) * speed

    def _try_move_bot(self, p, dx, dy):
        """Move bot with wall sliding. Tries full move, then axis-separated."""
        if dx == 0 and dy == 0:
            return
        length = math.sqrt(dx * dx + dy * dy)
        if length < 0.001:
            return
        speed = p["speed"]
        ndx = (dx / length) * speed
        ndy = (dy / length) * speed

        new_x = max(PLAYER_RADIUS, min(MAP_WIDTH - PLAYER_RADIUS, p["x"] + ndx))
        new_y = max(PLAYER_RADIUS, min(MAP_HEIGHT - PLAYER_RADIUS, p["y"] + ndy))

        # Try full move
        if not self._collides_obstacle(new_x, new_y, PLAYER_RADIUS):
            p["x"] = new_x
            p["y"] = new_y
        else:
            # Wall sliding: try X only
            slide_x = max(PLAYER_RADIUS, min(MAP_WIDTH - PLAYER_RADIUS, p["x"] + ndx))
            if not self._collides_obstacle(slide_x, p["y"], PLAYER_RADIUS):
                p["x"] = slide_x
            # Wall sliding: try Y only
            slide_y = max(PLAYER_RADIUS, min(MAP_HEIGHT - PLAYER_RADIUS, p["y"] + ndy))
            if not self._collides_obstacle(p["x"], slide_y, PLAYER_RADIUS):
                p["y"] = slide_y

        p["in_bush"] = self._point_in_bush(p["x"], p["y"])

    def _has_line_of_sight(self, x1, y1, x2, y2):
        """Check if a straight line between two points is blocked by obstacles."""
        dist = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        if dist < 1:
            return True
        steps = int(dist / 20) + 1
        for i in range(1, steps + 1):
            t = i / steps
            cx = x1 + (x2 - x1) * t
            cy = y1 + (y2 - y1) * t
            if self._collides_obstacle(cx, cy, BULLET_RADIUS):
                return False
        return True

    def update_bots(self):
        """AI tick for all bots. Called with lock held."""
        now = time.time()
        for bot_id, ai in list(self.bots.items()):
            p = self.players.get(bot_id)
            if not p or not p["alive"]:
                continue

            profile = ai["profile"]

            # Stuck detection: if barely moved in 1 second, force new wander
            if now - ai["stuck_timer"] > 1.0:
                moved = math.sqrt((p["x"] - ai["stuck_x"]) ** 2 +
                                  (p["y"] - ai["stuck_y"]) ** 2)
                ai["stuck_x"] = p["x"]
                ai["stuck_y"] = p["y"]
                ai["stuck_timer"] = now
                if moved < 3:
                    ai["wander_angle"] = random.uniform(0, math.pi * 2)
                    ai["state"] = "wander"

            # Find nearest alive enemy (prefer visible ones)
            nearest = None
            nearest_dist = float("inf")
            for sid, other in self.players.items():
                if sid == bot_id or not other["alive"]:
                    continue
                if other.get("in_bush") and not p.get("in_bush"):
                    continue  # can't see players in bushes
                d = math.sqrt((p["x"] - other["x"]) ** 2 + (p["y"] - other["y"]) ** 2)
                if d < nearest_dist:
                    nearest_dist = d
                    nearest = other

            # Decision making (throttled)
            if now - ai["last_decision"] > ai["reaction_delay"]:
                ai["last_decision"] = now
                ai["reaction_delay"] = random.uniform(*profile["reaction"])

                hp_pct = p["hp"] / p["max_hp"]
                if nearest and hp_pct < profile["retreat_hp_pct"] and nearest_dist < 400:
                    ai["state"] = "retreat"
                elif nearest and nearest_dist < profile["aggro_range"]:
                    ai["state"] = "chase"
                else:
                    ai["state"] = "wander"

                if random.random() < 0.3:
                    ai["strafe_dir"] *= -1

            # Compute desired movement direction
            dx, dy = 0, 0
            # ideal = percentage of bullet_range (bots try to stay at max range)
            ideal = p["bullet_range"] * profile["ideal_range_pct"]
            tolerance = ideal * 0.12  # ±12% band around ideal range

            if ai["state"] == "wander":
                if now - ai["wander_change"] > random.uniform(1.5, 3.5):
                    ai["wander_angle"] = random.uniform(0, math.pi * 2)
                    ai["wander_change"] = now
                dx = math.cos(ai["wander_angle"])
                dy = math.sin(ai["wander_angle"])
                # Edge avoidance
                margin = 120
                if p["x"] < margin: dx += (margin - p["x"]) / margin
                if p["x"] > MAP_WIDTH - margin: dx -= (p["x"] - (MAP_WIDTH - margin)) / margin
                if p["y"] < margin: dy += (margin - p["y"]) / margin
                if p["y"] > MAP_HEIGHT - margin: dy -= (p["y"] - (MAP_HEIGHT - margin)) / margin

            elif ai["state"] == "chase" and nearest:
                angle_to = math.atan2(nearest["y"] - p["y"], nearest["x"] - p["x"])
                if nearest_dist > ideal + tolerance:
                    # Too far: move toward enemy to get into max range
                    dx = math.cos(angle_to) * profile["chase_speed"]
                    dy = math.sin(angle_to) * profile["chase_speed"]
                elif nearest_dist < ideal - tolerance:
                    # Too close: back up to maintain max range distance
                    dx = -math.cos(angle_to) * 0.8
                    dy = -math.sin(angle_to) * 0.8
                else:
                    # In sweet spot at max range: strafe to dodge
                    strafe_a = angle_to + (math.pi / 2) * ai["strafe_dir"]
                    dx = math.cos(strafe_a) * profile["strafe_speed"]
                    dy = math.sin(strafe_a) * profile["strafe_speed"]

            elif ai["state"] == "retreat" and nearest:
                angle_away = math.atan2(p["y"] - nearest["y"], p["x"] - nearest["x"])
                retreat_offset = ai["strafe_dir"] * 0.4
                dx = math.cos(angle_away + retreat_offset)
                dy = math.sin(angle_away + retreat_offset)

            # Apply obstacle avoidance to desired direction
            if dx != 0 or dy != 0:
                dx, dy = self._obstacle_avoidance(p["x"], p["y"], dx, dy, PLAYER_RADIUS)
                self._try_move_bot(p, dx, dy)

            # Shooting - only if line of sight is clear
            if nearest and nearest_dist < p["bullet_range"] * 0.9:
                has_los = self._has_line_of_sight(p["x"], p["y"],
                                                   nearest["x"], nearest["y"])
                if has_los:
                    angle_to = math.atan2(nearest["y"] - p["y"],
                                          nearest["x"] - p["x"])
                    inaccuracy = (1.0 - ai["accuracy"]) * 0.4
                    aim_angle = angle_to + random.uniform(-inaccuracy, inaccuracy)
                    p["angle"] = aim_angle

                    if now - p["last_fire"] >= p["fire_cooldown"]:
                        p["last_fire"] = now
                        p["in_bush"] = False
                        burst = p.get("burst_count", 1)
                        if burst > 1:
                            self.burst_queue = [bq for bq in self.burst_queue
                                                if bq["sid"] != bot_id]
                            self.burst_queue.append({
                                "sid": bot_id,
                                "angle": aim_angle,
                                "remaining": burst - 1,
                                "next_fire": now + 0.05,
                            })
                        spread = random.uniform(-0.08, 0.08) if burst > 1 else 0
                        self._spawn_bullet(p, bot_id, aim_angle, spread)
                else:
                    # No line of sight: move toward enemy to find angle
                    if ai["state"] != "retreat":
                        angle_to = math.atan2(nearest["y"] - p["y"],
                                              nearest["x"] - p["x"])
                        move_dx = math.cos(angle_to)
                        move_dy = math.sin(angle_to)
                        move_dx, move_dy = self._obstacle_avoidance(
                            p["x"], p["y"], move_dx, move_dy, PLAYER_RADIUS)
                        self._try_move_bot(p, move_dx, move_dy)

    def _end_round(self):
        self.game_active = False
        self.bots.clear()
        self.burst_queue.clear()
        # Remove all bot entries from players
        bot_sids = [sid for sid in self.players if sid.startswith("bot_")]
        for sid in bot_sids:
            del self.players[sid]
        return [{"type": "round_over"}]

    def _collides_obstacle(self, x, y, radius):
        for obs in OBSTACLES:
            closest_x = max(obs["x"], min(x, obs["x"] + obs["w"]))
            closest_y = max(obs["y"], min(y, obs["y"] + obs["h"]))
            dist = math.sqrt((x - closest_x) ** 2 + (y - closest_y) ** 2)
            if dist < radius:
                return True
        return False

    def get_state_for(self, viewer_sid):
        now = time.time()
        time_left = -1
        if self.round_start_time:
            time_left = max(0, ROUND_TIME - (now - self.round_start_time))

        viewer = self.players.get(viewer_sid)
        viewer_in_bush = viewer["in_bush"] if viewer else False

        players_data = {}
        for sid, p in self.players.items():
            visible = True
            # Bush stealth: hidden unless viewer is also in a bush or is the player
            if p["in_bush"] and sid != viewer_sid:
                visible = False
            players_data[sid] = {
                "id": p["id"],
                "username": p["username"],
                "brawler_type": p["brawler_type"],
                "x": p["x"] if visible else -1000,
                "y": p["y"] if visible else -1000,
                "hp": p["hp"],
                "max_hp": p["max_hp"],
                "kills": p["kills"],
                "deaths": p["deaths"],
                "alive": p["alive"],
                "color": p["color"],
                "angle": p["angle"],
                "visible": visible,
                "in_bush": p["in_bush"] if sid == viewer_sid else False,
                "respawn_at": p["respawn_at"] if not p["alive"] else None,
                "last_fire": p["last_fire"] if sid == viewer_sid else 0,
                "fire_cooldown": p["fire_cooldown"] if sid == viewer_sid else 0,
                "bullet_range": p["bullet_range"],
            }

        return {
            "players": players_data,
            "bullets": [
                {"id": b["id"], "x": b["x"], "y": b["y"],
                 "radius": b["radius"], "color": b["color"]}
                for b in self.bullets
            ],
            "obstacles": OBSTACLES,
            "bushes": BUSHES,
            "map_width": MAP_WIDTH,
            "map_height": MAP_HEIGHT,
            "time_left": time_left,
        }

    def get_lobby_info(self):
        return {
            "players": {sid: info for sid, info in self.lobby.items()},
            "game_active": self.game_active,
            "count": len(self.lobby),
        }


game = GameState()

# ---------------------------------------------------------------------------
# Game Loop
# ---------------------------------------------------------------------------
def game_loop_thread():
    while True:
        if game.game_active and len(game.players) > 0:
            hit_events = game.update()
            # Collect sids first, then emit outside lock to avoid deadlock
            with game.lock:
                human_sids = [sid for sid in game.players if not sid.startswith("bot_")]
            for sid in human_sids:
                state = game.get_state_for(sid)
                socketio.emit('game_state', state, to=sid, namespace='/game')
            if hit_events:
                for evt in hit_events:
                    socketio.emit('game_event', evt, namespace='/game')
                    if evt.get("type") == "round_over":
                        socketio.emit('game_over', {"reason": "time_up"}, namespace='/game')
        time.sleep(1 / 30)

# ---------------------------------------------------------------------------
# Flask Routes
# ---------------------------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/brawlers')
def get_brawlers():
    return jsonify(BRAWLER_TYPES)

@app.route('/api/map')
def get_map():
    return jsonify({
        "width": MAP_WIDTH,
        "height": MAP_HEIGHT,
        "obstacles": OBSTACLES,
        "bushes": BUSHES,
        "spawn_points": SPAWN_POINTS,
    })

# ---------------------------------------------------------------------------
# WebSocket Events – Lobby
# ---------------------------------------------------------------------------
@socketio.on('connect', namespace='/game')
def on_connect():
    print(f"[CONNECT] {request.sid}")

@socketio.on('disconnect', namespace='/game')
def on_disconnect():
    sid = request.sid
    print(f"[DISCONNECT] {sid}")
    # If in active game, mark as disconnected but keep player (allow rejoin)
    if game.game_active and sid in game.players:
        with game.lock:
            game.players[sid]["disconnected"] = True
            game.players[sid]["disconnect_time"] = time.time()
        print(f"  -> marked disconnected (can rejoin)")
    else:
        game.remove_player(sid)
    socketio.emit('player_left', {"id": sid}, namespace='/game')
    # Count connected humans
    with game.lock:
        connected_humans = [s for s in game.players
                           if not s.startswith("bot_") and not game.players[s].get("disconnected")]
    if len(connected_humans) < 1 and game.game_active:
        game.game_active = False
        game.bots.clear()
        socketio.emit('game_over', {"reason": "not_enough_players"}, namespace='/game')
    emit_lobby_update()

@socketio.on('join_lobby', namespace='/game')
def on_join_lobby(data):
    sid = request.sid
    username = data.get('username', f'Player_{sid[:6]}')
    brawler_type = data.get('brawler_type', 'fighter')

    # If game is active, try to rejoin as disconnected player
    if game.game_active:
        with game.lock:
            for old_sid, p in list(game.players.items()):
                if old_sid.startswith("bot_"):
                    continue
                if p.get("username") == username and p.get("disconnected"):
                    # Rejoin! Move player data to new SID
                    player_data = game.players.pop(old_sid)
                    player_data["id"] = sid
                    player_data["disconnected"] = False
                    player_data.pop("disconnect_time", None)
                    game.players[sid] = player_data
                    print(f"[REJOIN] {username} ({old_sid} -> {sid})")
                    state = game.get_state_for(sid)
                    emit('game_start', state, namespace='/game')
                    return
        # No matching player found, just add to lobby as spectator
        print(f"[JOIN_LOBBY] {username} - game already active, added to lobby")

    game.lobby[sid] = {"username": username, "brawler_type": brawler_type, "ready": False}
    join_room('lobby')
    emit('lobby_joined', {"id": sid, "username": username}, namespace='/game')
    emit_lobby_update()

@socketio.on('player_ready', namespace='/game')
def on_player_ready(data):
    sid = request.sid
    if sid in game.lobby:
        game.lobby[sid]["ready"] = True
    emit_lobby_update()
    total = len(game.lobby) + len(game.pending_bots)
    if total >= 2 and all(p["ready"] for p in game.lobby.values()):
        start_game()

@socketio.on('player_unready', namespace='/game')
def on_player_unready(data):
    sid = request.sid
    if sid in game.lobby:
        game.lobby[sid]["ready"] = False
    emit_lobby_update()

@socketio.on('set_bots', namespace='/game')
def on_set_bots(data):
    count = max(0, min(8, int(data.get('count', 0))))
    game.pending_bots = []
    brawler_types = list(BRAWLER_TYPES.keys())
    for i in range(count):
        name = BOT_NAMES[i % len(BOT_NAMES)]
        bt = random.choice(brawler_types)
        game.pending_bots.append({"name": f"[BOT] {name}", "brawler_type": bt})
    emit_lobby_update()

def emit_lobby_update():
    info = game.get_lobby_info()
    info["bot_count"] = len(game.pending_bots)
    info["bots"] = [{"name": b["name"], "brawler_type": b["brawler_type"]} for b in game.pending_bots]
    socketio.emit('lobby_update', info, namespace='/game')

def start_game():
    print(f"[START_GAME] lobby={list(game.lobby.keys())}")
    game.game_active = True
    game.round_start_time = time.time()
    game.bullets.clear()
    game.bots.clear()
    game.burst_queue.clear()
    game.players.clear()
    game.bot_id_counter = 0
    for sid, info in list(game.lobby.items()):
        game.add_player(sid, info["username"], info["brawler_type"])
    for bot_info in game.pending_bots:
        game.add_bot(bot_info["name"], bot_info["brawler_type"])
    game.lobby.clear()
    game.pending_bots.clear()
    with game.lock:
        human_sids = [sid for sid in game.players if not sid.startswith("bot_")]
    print(f"[START_GAME] sending game_start to: {human_sids}")
    for sid in human_sids:
        state = game.get_state_for(sid)
        print(f"[START_GAME] emitting to {sid}")
        socketio.emit('game_start', state, to=sid, namespace='/game')
        print(f"[START_GAME] emitted to {sid}")

# ---------------------------------------------------------------------------
# WebSocket Events – Gameplay
# ---------------------------------------------------------------------------
@socketio.on('request_game_state', namespace='/game')
def on_request_game_state():
    sid = request.sid
    if game.game_active and sid in game.players:
        state = game.get_state_for(sid)
        socketio.emit('game_start', state, to=sid, namespace='/game')

@socketio.on('player_move', namespace='/game')
def on_player_move(data):
    sid = request.sid
    dx = data.get('dx', 0)
    dy = data.get('dy', 0)
    game.move_player(sid, dx, dy)

@socketio.on('player_shoot', namespace='/game')
def on_player_shoot(data):
    sid = request.sid
    angle = data.get('angle', 0)
    bullet = game.fire_bullet(sid, angle)
    if bullet:
        socketio.emit('bullet_fired', {
            "id": bullet["id"],
            "x": bullet["x"],
            "y": bullet["y"],
            "dx": bullet["dx"],
            "dy": bullet["dy"],
            "color": bullet["color"],
            "owner": sid,
        }, namespace='/game')

@socketio.on('player_angle', namespace='/game')
def on_player_angle(data):
    sid = request.sid
    with game.lock:
        p = game.players.get(sid)
        if p:
            p["angle"] = data.get('angle', 0)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    game_thread = threading.Thread(target=game_loop_thread, daemon=True)
    game_thread.start()
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)
