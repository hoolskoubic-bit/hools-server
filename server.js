const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const players = {};

io.on('connection', (socket) => {
    console.log('Nové spojení navázáno: ' + socket.id);

    socket.on('join', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: parseFloat(data.x) || 400,
            y: parseFloat(data.y) || 300,
            name: data.name || 'Neznámý',
            club: data.club || '',
            country: data.country || 'EU',
            shirtColor: data.shirtColor || '#c0392b',
            skinColor: data.skinColor || '#f1c27d',
            hasCap: !!data.hasCap,
            hp: 100,
            maxHp: 100,
            angle: parseFloat(data.angle) || 0,
            isAttacking: false,
            deadTime: 0,
            map: data.map || 'hriste',
            level: parseInt(data.level) || 1, // PŘIDÁNO: Načtení levelu
            sila: parseInt(data.sila) || 0    // PŘIDÁNO: Načtení síly
        };
    });

    socket.on('move', (data) => {
        if (players[socket.id] && players[socket.id].hp > 0) {
            players[socket.id].x = parseFloat(data.x);
            players[socket.id].y = parseFloat(data.y);
            players[socket.id].angle = parseFloat(data.angle);
            // PŘIDÁNO: Aktualizace statů při pohybu
            if (data.level !== undefined) players[socket.id].level = parseInt(data.level);
            if (data.sila !== undefined) players[socket.id].sila = parseInt(data.sila);
        }
    });

    // Přechod mezi lokacemi
    socket.on('changeMap', (newMap) => {
        if (players[socket.id]) {
            players[socket.id].map = newMap;
        }
    });

    socket.on('attack', () => {
        const attacker = players[socket.id];
        if (!attacker || attacker.hp <= 0) return;

        attacker.isAttacking = true;
        setTimeout(() => { if (players[socket.id]) players[socket.id].isAttacking = false; }, 200);

        for (let id in players) {
            // Útok funguje jen pokud jsou hráči na STEJNÉ MAPĚ
            if (id !== socket.id && players[id].hp > 0 && players[id].map === attacker.map) {
                const victim = players[id];
                const dist = Math.hypot(attacker.x - victim.x, attacker.y - victim.y);
                
                if (dist < 55) {
                    // --- VÝPOČET ZRANĚNÍ PODLE LEVELU A SÍLY ---
                    let baseDamage = 25;
                    // Obrana: Každý level oběti nad lvl 1 snižuje zranění o 2 body
                    let defense = (victim.level - 1) * 2;
                    // Útok: Level přidává 1 bod, každý bod síly přidává 2 body zranění
                    let attackBonus = ((attacker.level - 1) * 1) + (attacker.sila * 2);
                    
                    // Finální zranění (nikdy neklesne pod 5 bodů)
                    let finalDamage = Math.max(5, baseDamage - defense + attackBonus);
                    
                    victim.hp -= finalDamage;
                    io.emit('bloodSpatter', { x: victim.x, y: victim.y, map: victim.map });
                    
                    if (victim.hp <= 0) {
                        io.to(socket.id).emit('killConfirmed');
                        io.to(id).emit('youDied');
                        victim.deadTime = Date.now();
                        
                        setTimeout(() => {
                            if (players[id] && players[id].hp <= 0) {
                                players[id].hp = 100;
                                players[id].x = Math.random() * 800 + 100;
                                players[id].y = Math.random() * 400 + 100;
                            }
                        }, 60000); 
                    }
                }
            }
        }
    });

    socket.on('forceRespawn', () => {
        if (players[socket.id] && players[socket.id].hp <= 0) {
            players[socket.id].hp = 100;
            players[socket.id].x = Math.random() * 800 + 100;
            players[socket.id].y = Math.random() * 400 + 100;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

setInterval(() => {
    io.emit('updateState', players);
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server bezi na portu ${PORT}`);
});
