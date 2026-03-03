# ⚔️ Brawl Arena – Top-Down Multiplayer Shooter

Ein Echtzeit-Multiplayer Top-Down Shooter (ähnlich Brawl Stars) mit Python Flask Backend und WebSockets.

## Features
- **Echtzeit-Multiplayer** via WebSockets (Flask-SocketIO)
- **2 Brawler**: Fighter (schnell, wenig HP) und Tank (langsam, viel HP)
- **PC-Steuerung**: WASD + Maus zum Zielen/Schießen
- **Mobile-Steuerung**: Virtuelle Joysticks
- **Map** mit Hindernissen, HP-Balken, Kill-Feed
- **Lobby-System** mit Ready-Check

## Setup

```bash
# Abhängigkeiten installieren
pip install -r requirements.txt

# Server starten
python server.py
```

Dann im Browser öffnen: **http://localhost:5000**

Für 2 Spieler: Zwei Browser-Tabs/-Fenster öffnen.

## Steuerung

### PC
- **WASD** – Bewegen
- **Maus** – Zielen
- **Linksklick** – Schießen

### Mobile
- **Linker Joystick** – Bewegen
- **Rechter Joystick** – Zielen & Schießen

## Technik
- **Backend**: Python Flask + Flask-SocketIO + Eventlet
- **Frontend**: HTML5 Canvas + Vanilla JS
- **Kommunikation**: WebSockets für Echtzeit-Synchronisation
- **Game Loop**: Server-seitig bei ~30 Ticks/Sekunde
