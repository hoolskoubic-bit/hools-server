const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const players = {};
let items = {}; // Zbraně a Šály
let cops = {};  // NPC Policie

const mapList = ['stadion', 'hriste', 'park', 'sidliste', 'hospoda', 'nadrazi'];

// Generování zbraní
setInterval(() => {
    if (Object.keys(items).length < 15) {
        let randMap = mapList[Math.floor(Math.random() * mapList.length)];
        let wName = 'Pěst'; let wDmg = 0;
        
        if (randMap === 'hospoda') { wName = 'Rozbitá láhev'; wDmg = 15; }
        else if (randMap === 'stadion') { wName = 'Sedačka'; wDmg = 20; }
        else if (randMap === 'sidliste') { wName = 'Cihla'; wDmg = 10; }
        else { wName = 'Kus klacku'; wDmg = 10; }

        let id = 'w_' + Date.now();
        items[id] = { type: 'weapon', map: randMap, x: Math.random() * 800 + 100, y: Math.random() * 400 + 100, name: wName, damage: wDmg };
        io.emit('updateItems', items);
    }
}, 15000);

// Generování Policie (A.C.A.B.)
setInterval(() => {
    if (Object.keys(cops).length < 5) {
        let randMap = mapList[Math.floor(Math.random() * mapList.length)];
        let cid = 'cop_' + Date.now();
        cops[cid] = { id: cid, map: randMap, x: Math.random() * 800 + 100, y: Math.random() * 400 + 100, hp: 150, maxHp: 150, angle: 0, isAttacking: false, attackCooldown: false };
    }
}, 30000);

// AI Policie (pohyb a útok)
setInterval(() => {
    for (let cid in cops) {
        let cop = cops[cid];
        let target = null;
        let minDist = 9999;

        // Najdi nejbližšího hráče na stejné mapě
        for (let pid in players) {
            let p = players[pid];
            if (p.hp > 0 && p.map === cop.map) {
                let d = Math.hypot(p.x - cop.x, p.y - cop.y);
                if (d < minDist) { minDist = d; target = p; }
            }
        }

        if (target) {
            if (minDist > 50) {
                cop.angle = Math.atan2(target.y - cop.y, target.x - cop.x);
                cop.x += Math.cos(cop.angle) * 1.5; // Fízl je trochu pomalejší
                cop.y += Math.sin(cop.angle) * 1.5;
            } else if (!cop.attackCooldown) {
                // Úder obuškem
                cop.isAttacking = true;
                setTimeout(() => { if (cops[cid]) cops[cid].isAttacking = false; }, 200);
                
                target.hp -= 20; // Fízl dává rány za 20
                io.emit('bloodSpatter', { x: target.x, y: target.y, map: target.map });
                
                if (target.hp <= 0) {
                    io.to(target.id).emit('youDied');
                    // Z hráče vypadne ŠÁLA
                    let sid = 'scarf_' + Date.now();
                    items[sid] = { type: 'scarf', map: target.map, x: target.x, y: target.y, club: target.club };
                    io.emit('updateItems', items);
                }
                
                cop.attackCooldown = true;
                setTimeout(() => { if (cops[cid]) cops[cid].attackCooldown = false; }, 1500); // Útočí každého 1.5s
            }
        }
    }
    // Odešleme data klientům (hráči + fízlové + věci)
    io.emit('updateState', { players, cops, items });
}, 1000 / 30);


io.on('connection', (socket) => {
    socket.on('join', (data) => {
        players[socket.id] = {
            id: socket.id, x: parseFloat(data.x) || 400, y: parseFloat(data.y) || 300,
            name: data.name || 'Neznámý', club: data.club || '', country: data.country || 'EU',
            skinType: data.skinType || 'default', shirtColor: data.shirtColor || '#c0392b', skinColor: data.skinColor || '#f1c27d', hasCap: !!data.hasCap,
            hp: 100, maxHp: 100, angle: parseFloat(data.angle) || 0, isAttacking: false, map: data.map || 'hriste',
            level: parseInt(data.level) || 1, sila: parseInt(data.sila) || 0,
            weaponName: 'Pěst', weaponDamage: 0 // Každý začíná s holýma rukama
        };
        io.emit('updateItems', items);
    });

    socket.on('move', (data) => {
        let p = players[socket.id];
        if (p && p.hp > 0) {
            p.x = parseFloat(data.x); p.y = parseFloat(data.y); p.angle = parseFloat(data.angle);
            if (data.level !== undefined) p.level = parseInt(data.level);
            if (data.sila !== undefined) p.sila = parseInt(data.sila);
            if (data.skinType) p.skinType = data.skinType;

            // Sbírání předmětů
            for (let iid in items) {
                let it = items[iid];
                if (it.map === p.map && Math.hypot(p.x - it.x, p.y - it.y) < 30) {
                    if (it.type === 'scarf') {
                        io.to(socket.id).emit('scarfCollected');
                        delete items[iid];
                        io.emit('updateItems', items);
                    } else if (it.type === 'weapon') {
                        p.weaponName = it.name;
                        p.weaponDamage = it.damage;
                        delete items[iid];
                        io.emit('updateItems', items);
                    }
                }
            }
        }
    });

    socket.on('changeMap', (newMap) => { if (players[socket.id]) players[socket.id].map = newMap; });

    socket.on('attack', () => {
        const attacker = players[socket.id];
        if (!attacker || attacker.hp <= 0) return;

        attacker.isAttacking = true;
        setTimeout(() => { if (players[socket.id]) players[socket.id].isAttacking = false; }, 200);

        let attackBonus = ((attacker.level - 1) * 1) + (attacker.sila * 2) + attacker.weaponDamage;

        // Útok na HRÁČE
        for (let id in players) {
            if (id !== socket.id && players[id].hp > 0 && players[id].map === attacker.map) {
                const victim = players[id];
                if (Math.hypot(attacker.x - victim.x, attacker.y - victim.y) < 55) {
                    let defense = (victim.level - 1) * 2;
                    victim.hp -= Math.max(5, 25 - defense + attackBonus);
                    io.emit('bloodSpatter', { x: victim.x, y: victim.y, map: victim.map });
                    
                    if (victim.hp <= 0) {
                        io.to(socket.id).emit('killConfirmed');
                        io.to(id).emit('youDied');
                        // Vypadne ŠÁLA
                        let sid = 'scarf_' + Date.now();
                        items[sid] = { type: 'scarf', map: victim.map, x: victim.x, y: victim.y, club: victim.club };
                        io.emit('updateItems', items);
                    }
                }
            }
        }

        // Útok na FÍZLY (Cops)
        for (let cid in cops) {
            let cop = cops[cid];
            if (cop.hp > 0 && cop.map === attacker.map) {
                if (Math.hypot(attacker.x - cop.x, attacker.y - cop.y) < 55) {
                    cop.hp -= Math.max(5, 25 + attackBonus);
                    io.emit('bloodSpatter', { x: cop.x, y: cop.y, map: cop.map });
                    
                    if (cop.hp <= 0) {
                        // Když fízl umře, dá útočníkovi Token
                        io.to(socket.id).emit('copKilledToken');
                        delete cops[cid];
                    }
                }
            }
        }
    });

    socket.on('forceRespawn', () => {
        let p = players[socket.id];
        if (p && p.hp <= 0) {
            p.hp = 100; p.weaponName = 'Pěst'; p.weaponDamage = 0; // Ztratí zbraň
            p.x = Math.random() * 800 + 100; p.y = Math.random() * 400 + 100;
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server bezi na portu ${PORT}`));
