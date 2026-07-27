const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const players = {};
let items = {}; 
let cops = {};  

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

// Generování Policie (A.C.A.B.) s LEVELY
setInterval(() => {
    if (Object.keys(cops).length < 5) {
        let randMap = mapList[Math.floor(Math.random() * mapList.length)];
        let cid = 'cop_' + Date.now();
        
        // Náhodný level od 1 do 5
        let lvl = Math.floor(Math.random() * 5) + 1; 
        // Výpočet HP podle levelu (Lvl 1 = 150 HP, Lvl 5 = 350 HP)
        let copHp = 100 + (lvl * 50); 
        
        cops[cid] = { 
            id: cid, map: randMap, x: Math.random() * 800 + 100, y: Math.random() * 400 + 100, 
            hp: copHp, maxHp: copHp, angle: 0, isAttacking: false, attackCooldown: false, 
            level: lvl // Uložíme level k fízlovi
        };
    }
}, 30000);

// AI Policie (pohyb a útok)
setInterval(() => {
    for (let cid in cops) {
        let cop = cops[cid];
        let target = null;
        let minDist = 9999;

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
                cop.x += Math.cos(cop.angle) * 1.5; 
                cop.y += Math.sin(cop.angle) * 1.5;
            } else if (!cop.attackCooldown) {
                cop.isAttacking = true;
                setTimeout(() => { if (cops[cid]) cops[cid].isAttacking = false; }, 200);
                
                // Poškození od fízla závisí na jeho levelu!
                let copDamage = 15 + (cop.level * 5); // Lvl 1: 20 dmg, Lvl 5: 40 dmg
                let playerDefense = (target.level - 1) * 2;
                
                target.hp -= Math.max(5, copDamage - playerDefense); 
                io.emit('bloodSpatter', { x: target.x, y: target.y, map: target.map });
                
                if (target.hp <= 0) {
                    io.to(target.id).emit('youDied');
                    let sid = 'scarf_' + Date.now();
                    items[sid] = { type: 'scarf', map: target.map, x: target.x, y: target.y, club: target.club };
                    io.emit('updateItems', items);
                }
                
                cop.attackCooldown = true;
                setTimeout(() => { if (cops[cid]) cops[cid].attackCooldown = false; }, 1500); 
            }
        }
    }
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
            weaponName: 'Pěst', weaponDamage: 0
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
                        let sid = 'scarf_' + Date.now();
                        items[sid] = { type: 'scarf', map: victim.map, x: victim.x, y: victim.y, club: victim.club };
                        io.emit('updateItems', items);
                    }
                }
            }
        }

        // Útok na FÍZLY
        for (let cid in cops) {
            let cop = cops[cid];
            if (cop.hp > 0 && cop.map === attacker.map) {
                if (Math.hypot(attacker.x - cop.x, attacker.y - cop.y) < 55) {
                    // Policie má také obranu podle levelu!
                    let copDefense = (cop.level - 1) * 3;
                    cop.hp -= Math.max(5, 25 + attackBonus - copDefense);
                    io.emit('bloodSpatter', { x: cop.x, y: cop.y, map: cop.map });
                    
                    if (cop.hp <= 0) {
                        // Pošleme klientovi i level zabitého fízla, ať dostane správnou odměnu
                        io.to(socket.id).emit('copKilledToken', { level: cop.level });
                        delete cops[cid];
                    }
                }
            }
        }
    });

    socket.on('forceRespawn', () => {
        let p = players[socket.id];
        if (p && p.hp <= 0) {
            p.hp = 100; p.weaponName = 'Pěst'; p.weaponDamage = 0; 
            p.x = Math.random() * 800 + 100; p.y = Math.random() * 400 + 100;
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server bezi na portu ${PORT}`));
