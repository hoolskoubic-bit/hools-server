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
            deadTime: 0
        };
        console.log('Do arény vstoupil: ' + data.name);
    });

    socket.on('move', (data) => {
        if (players[socket.id] && players[socket.id].hp > 0) {
            players[socket.id].x = parseFloat(data.x);
            players[socket.id].y = parseFloat(data.y);
            players[socket.id].angle = parseFloat(data.angle);
        }
    });

    socket.on('attack', () => {
        const attacker = players[socket.id];
        if (!attacker || attacker.hp <= 0) return;

        attacker.isAttacking = true;
        setTimeout(() => { if (players[socket.id]) players[socket.id].isAttacking = false; }, 200);

        for (let id in players) {
            if (id !== socket.id && players[id].hp > 0) {
                const victim = players[id];
                const dist = Math.hypot(attacker.x - victim.x, attacker.y - victim.y);
                
                if (dist < 55) {
                    victim.hp -= 25;
                    io.emit('bloodSpatter', { x: victim.x, y: victim.y });
                    
                    if (victim.hp <= 0) {
                        io.to(socket.id).emit('killConfirmed');
                        io.to(id).emit('youDied');
                        victim.deadTime = Date.now();
                        
                        setTimeout(() => {
                            if (players[id]) {
                                players[id].hp = 100;
                                players[id].x = Math.random() * 800 + 100;
                                players[id].y = Math.random() * 400 + 100;
                            }
                        }, 3000);
                    }
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Hráč odešel z arény: ' + socket.id);
        delete players[socket.id];
    });
});

setInterval(() => {
    io.emit('updateState', players);
}, 1000 / 60);

const PORT = 3000;
// 0.0.0.0 otevírá server pro celou lokální síť, ne jen pro PC!
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Hooligans Europe] WebSocket Server běží na portu ${PORT}`);
});