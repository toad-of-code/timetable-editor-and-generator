import fs from 'fs';

const logContent = fs.readFileSync('logs/editor-log_2026-04-08T12-06-18.txt', 'utf-8');

const lines = logContent.split('\n');
let currentDay = '';

const roomUsage = new Map(); // key: "DAY|TIME|ROOM", val: array of session details

let inSchedule = false;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes('─── DAY-BY-DAY SCHEDULE ───')) {
        inSchedule = true;
        continue;
    }
    
    if (!inSchedule) continue;
    
    if (line.match(/── (MON|TUE|WED|THU|FRI) ──/)) {
        currentDay = line.match(/── (MON|TUE|WED|THU|FRI) ──/)[1];
        continue;
    }
    
    // Match line format like: "│     08:50-09:50  GenAI        L CC-1-2205  📚"
    // or "│     08:50-12:00  PM           P CC-3-5006"
    const match = line.match(/│\s+([\d:]+-[\d:]+)\s+(.+?)\s+[LTP]\s+([^\s]+)/);
    
    if (match) {
        const time = match[1];
        const subject = match[2].trim();
        const room = match[3];
        
        if (room !== 'TBA') {
            const key = `${currentDay}|${time}|${room}`;
            if (!roomUsage.has(key)) {
                roomUsage.set(key, []);
            }
            roomUsage.get(key).push(`${subject} at ${time} in ${room}`);
        }
    }
}

let conflictsFound = 0;

for (const [key, sessions] of roomUsage.entries()) {
    if (sessions.length > 1) {
        console.log(`❌ CONFLICT FOUND on [${key}]:`);
        sessions.forEach(s => console.log(`   - ${s}`));
        conflictsFound++;
    }
}

// Next, let's verify overlapping times for the same room (e.g., 08:50-12:00 overlaps 09:50-10:50)
const parseTime = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

// Group by DAY + ROOM to check overlapping intervals
const allSessions = [];
roomUsage.forEach((sessions, key) => {
    const [day, time, room] = key.split('|');
    const [startSpan, endSpan] = time.split('-');
    const startMins = parseTime(startSpan);
    const endMins = parseTime(endSpan);
    
    sessions.forEach(subj => {
        allSessions.push({
            day, room, startMins, endMins, subject: subj, rawTime: time
        });
    });
});

for (let i = 0; i < allSessions.length; i++) {
    for (let j = i + 1; j < allSessions.length; j++) {
        const a = allSessions[i];
        const b = allSessions[j];
        if (a.day === b.day && a.room === b.room) {
            // Check overlap
            if (a.startMins < b.endMins && b.startMins < a.endMins) {
                // Ignore if it's the exact same session (handled by exact time match)
                if (a.subject !== b.subject) {
                    console.log(`❌ OVERLAP FOUND in ${a.room} on ${a.day}:`);
                    console.log(`   - ${a.subject} (${a.rawTime})`);
                    console.log(`   - ${b.subject} (${b.rawTime})`);
                    conflictsFound++;
                }
            }
        }
    }
}


if (conflictsFound === 0) {
    console.log("✅ Exhaustive search complete. ZERO room conflicts or overlaps found in the log.");
} else {
    console.log(`Found ${conflictsFound} conflicts!`);
}
