export type Team = 'attackers' | 'defenders' | 'spectator';
export interface Rect { x: number; y: number; w: number; h: number; }
export interface Circle { x: number; y: number; r: number; }
export interface GameState { status: 'playing'|'attackers_win'|'defenders_win'; itemsPlaced: number; attackersAlive: number; timeLeft: number; }

export interface TeamConfig {
    total: number;
    useAI: boolean;
}

export interface LocalPlayer {
    id: string;
    type: 'keyboard' | 'gamepad';
    gamepadIndex?: number;
    team: Team;
    label: string;
}

export interface GameConfig {
    localPlayers: LocalPlayer[];
    attackers: TeamConfig;
    defenders: TeamConfig;
    timeLimit: number;
    mapTheme?: 'pigeon' | 'football' | 'duck';
    keyBindings?: {
        up: string;
        down: string;
        left: string;
        right: string;
        pass: string;
        drop: string;
    };
}

export class Player {
    id: string; x: number; y: number; radius = 12; baseSpeed = 210;
    team: Team; isAI: boolean; isFrozen = false; iFrames = 0;
    carryingItem: any = null; color: string;
    localPlayer?: LocalPlayer;
    vx = 0; vy = 0; // Stored velocity for animations
    faceDir = 1;    // 1 for right, -1 for left
    unfreezeTimer = 0;
    dashTimer = 0;
    dashCooldown = 0;
    netX?: number; netY?: number;
    constructor(id: string, x: number, y: number, team: Team, isAI: boolean) {
        this.id = id; this.x = x; this.y = y; this.team = team; this.isAI = isAI;
        this.color = team === 'attackers' ? '#E67E22' : '#2980B9';
        // Give defenders a 15% base speed boost to help them catch up
        if (team === 'defenders') this.baseSpeed = 240;
    }
    get speed() { return this.carryingItem ? this.baseSpeed * 0.70 : this.baseSpeed; }
}

export class Ball {
    x = 600; y = 400; z = 0; vx = 0; vy = 0; vz = 0; radius = 10;
    heldBy: Player | null = null; holdTime = 0;
    lastHeldBy: Player | null = null;
    trail: {x: number, y: number, z: number, alpha: number}[] = [];
}

export class Item {
    id: string; x: number; y: number; radius = 8; isCarried = false; inZone: any = null;
    constructor(id: string, x: number, y: number) { this.id = id; this.x = x; this.y = y; }
}

export class Zone {
    id: string; x: number; y: number; w: number; h: number; hasItem = false;
    plantedTime?: number;
    progress = 0;
    isPlanting = false;
    planter?: Player;
    constructor(id: string, x: number, y: number, w: number, h: number) {
        this.id = id; this.x = x; this.y = y; this.w = w; this.h = h;
    }
}

type PlayerInputState = {
    gamepadAimX: number;
    gamepadAimY: number;
    lastMoveX: number;
    lastMoveY: number;
    wasGamepadThrowing: boolean;
    wasGamepadDrop: boolean;
    wasGamepadDash: boolean;
    isMouseDown: boolean;
    mouseDownTime: number;
    usingGamepad: boolean;
    wasPassRequested: boolean;
};

class SoundSystem {
    audioCtx: AudioContext | null = null;
    enabled: boolean = true;

    bgmInterval: any = null;
    isBGMPlaying: boolean = false;

    roundFinishSound: HTMLAudioElement;
    ballKickSound: HTMLAudioElement;
    stadiumSound: HTMLAudioElement;
    startWhistleSound: HTMLAudioElement;
    goalPSound: HTMLAudioElement;

    constructor() {
        this.roundFinishSound = new Audio('/sounds/roundfinish.wav');
        this.ballKickSound = new Audio('/sounds/ballkick.wav');
        this.stadiumSound = new Audio('/sounds/mixkitstadium.wav');
        this.startWhistleSound = new Audio('/sounds/whistle.mp3');
        this.goalPSound = new Audio('/sounds/goalP.m4a');
        this.goalPSound.volume = 0.4;
        this.stadiumSound.loop = true;
        this.stadiumSound.volume = 0.15; // Low volume for ambience
    }

    init() {
        if (!this.audioCtx && this.enabled) {
            try {
                this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            } catch (e) {
                console.warn("Web Audio API not supported");
            }
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    startBGM() {
        if (!this.audioCtx || !this.enabled || this.bgmInterval) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        this.isBGMPlaying = true;
        
        // Play ambient stadium sound
        if (this.enabled) {
            this.stadiumSound.play().catch(e => console.warn("Audio play failed:", e));
        }

        const sequence = [130.81, 0, 155.56, 130.81, 196.00, 0, 174.61, 0]; // funky bassline
        let step = 0;
        this.bgmInterval = setInterval(() => {
            if (this.audioCtx && this.audioCtx.state === 'running' && this.isBGMPlaying) {
                const f = sequence[step % sequence.length];
                if (f > 0) this.playOscillator(f, f*0.9, 'triangle', 0.2, 0.05, 0.01);
                step++;
            }
        }, 250);
    }

    stopBGM() {
        this.isBGMPlaying = false;
        
        // Stop stadium
        this.stadiumSound.pause();
        this.stadiumSound.currentTime = 0;

        if (this.bgmInterval) {
            clearInterval(this.bgmInterval);
            this.bgmInterval = null;
        }
    }

    playOscillator(freqStart: number, freqEnd: number, type: OscillatorType, duration: number, volStart: number = 0.5, volEnd: number = 0.01) {
        if (!this.audioCtx || !this.enabled) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = type;
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        
        osc.frequency.setValueAtTime(freqStart, this.audioCtx.currentTime);
        if (freqEnd !== freqStart) {
            osc.frequency.exponentialRampToValueAtTime(freqEnd, this.audioCtx.currentTime + duration);
        }
        
        gain.gain.setValueAtTime(volStart, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(volEnd || 0.01, this.audioCtx.currentTime + duration);
        
        osc.start();
        osc.stop(this.audioCtx.currentTime + duration);
    }

    playDash() { this.playOscillator(400, 200, 'triangle', 0.2, 0.2); }
    playPlaceItem() { 
        this.playOscillator(880, 1200, 'sine', 0.15, 0.4); 
    }
    playScore() { 
        this.playOscillator(600, 1200, 'square', 0.2, 0.3); 
        setTimeout(() => this.playOscillator(800, 1600, 'square', 0.4, 0.3), 150); 
    }
    playTick() { this.playOscillator(800, 800, 'sine', 0.05, 0.1); }
    
    playWhistle() { 
        if (!this.enabled) return;
        this.roundFinishSound.currentTime = 0;
        this.roundFinishSound.play().catch(e => console.warn(e));
    }

    playStartWhistle() { 
        if (!this.enabled) return;
        this.startWhistleSound.currentTime = 0;
        this.startWhistleSound.play().catch(e => console.warn(e));
    }

    playThrow() {
        if (!this.enabled) return;
        this.ballKickSound.currentTime = 0;
        this.ballKickSound.play().catch(e => console.warn(e));
    }

    playGoalP() {
        if (!this.enabled) return;
        this.goalPSound.currentTime = 0;
        this.goalPSound.play().catch(e => console.warn(e));
    }
}

export const soundManager = new SoundSystem();

export interface Particle {
    x: number; y: number; vx: number; vy: number;
    life: number; maxLife: number;
    color: string; size: number;
    type: 'spark' | 'snow' | 'firework' | 'dust';
}

export class GameEngine {
    canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
    players: Player[] = []; ball = new Ball(); items: Item[] = []; zones: Zone[] = [];
    walls: Rect[] = []; pillars: Circle[] = [];
    particles: Particle[] = [];
    keys: Record<string, boolean> = {}; 
    lastTime = 0; animationFrameId = 0; intervalId: any = 0;
    onStateChange?: (state: GameState) => void;
    onPlayerStat?: (playerId: string, playerName: string, statType: 'freeze' | 'plant' | 'holdTime', amount: number) => void;
    gameState: GameState = { status: 'playing', itemsPlaced: 0, attackersAlive: 0, timeLeft: 90 };
    playerInputs: Map<string, PlayerInputState> = new Map();
    networkInputs: Map<string, any> = new Map(); // Store remote inputs
    config: GameConfig;
    isPaused = false;
    isNetworkClient = false;

    private handleKeyDown = (e: KeyboardEvent) => {
        this.keys[e.key.toLowerCase()] = true;
        if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
            if (document.activeElement === document.body) e.preventDefault();
        }
    };
    private handleKeyUp = (e: KeyboardEvent) => this.keys[e.key.toLowerCase()] = false;

    constructor(canvas: HTMLCanvasElement, config: GameConfig) {
        this.canvas = canvas; this.ctx = canvas.getContext('2d')!;
        this.config = config;
        this.initMap(); this.initEntities(); this.bindEvents();
    }

    getInputState(p: Player): PlayerInputState {
        if (!this.playerInputs.has(p.id)) {
            this.playerInputs.set(p.id, {
                gamepadAimX: 1, gamepadAimY: 0, lastMoveX: p.faceDir, lastMoveY: 0,
                wasGamepadDrop: false, wasGamepadThrowing: false, wasGamepadDash: false,
                isMouseDown: false, mouseDownTime: 0, usingGamepad: false, wasPassRequested: false
            });
        }
        return this.playerInputs.get(p.id)!;
    }

    initMap() {
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        const mx = cw * 0.0416;
        const my = ch * 0.0625;
        const zw = cw * 0.0833;
        const zh = ch * 0.125;
        const wt = cw * 0.0166;

        this.walls = [
            // Z1 L-shape
            { x: mx + zw, y: my, w: wt, h: zh + wt },
            { x: mx, y: my + zh, w: zw, h: wt },
            // Z2 L-shape
            { x: cw - mx - zw - wt, y: my, w: wt, h: zh + wt },
            { x: cw - mx - zw, y: my + zh, w: zw, h: wt },
            // Z3 L-shape
            { x: mx + zw, y: ch - my - zh - wt, w: wt, h: zh + wt },
            { x: mx, y: ch - my - zh - wt, w: zw, h: wt },
            // Z4 L-shape
            { x: cw - mx - zw - wt, y: ch - my - zh - wt, w: wt, h: zh + wt },
            { x: cw - mx - zw, y: ch - my - zh - wt, w: zw, h: wt },
        ];
        this.pillars = [
            { x: cw * 0.375, y: ch * 0.3125, r: cw * 0.025 },
            { x: cw * 0.625, y: ch * 0.3125, r: cw * 0.025 },
            { x: cw * 0.375, y: ch * 0.6875, r: cw * 0.025 },
            { x: cw * 0.625, y: ch * 0.6875, r: cw * 0.025 },
        ];
        this.zones = [
            new Zone('z1', mx, my, zw, zh),
            new Zone('z2', cw - mx - zw, my, zw, zh),
            new Zone('z3', mx, ch - my - zh, zw, zh),
            new Zone('z4', cw - mx - zw, ch - my - zh, zw, zh),
            new Zone('z5', cw/2 - zw/2, ch/2 - zh/2, zw, zh),
        ];
    }

    initEntities() {
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        
        this.players = []; this.items = []; this.ball = new Ball();
        this.ball.x = cw / 2; this.ball.y = ch / 2;
        this.ball.radius = cw * 0.0083;
        this.zones.forEach(z => z.hasItem = false);

        this.playerInputs.clear();
        this.gameState = { status: 'playing', itemsPlaced: 0, attackersAlive: 0, timeLeft: this.config.timeLimit };

        const assignedAttackers = this.config.localPlayers.filter(lp => lp.team === 'attackers');
        const assignedDefenders = this.config.localPlayers.filter(lp => lp.team === 'defenders');

        let aCount = 0;
        const setupPlayer = (p: Player) => {
            p.radius = cw * 0.0125;
            p.baseSpeed = cw * 0.2083;
            return p;
        };

        for (const lp of assignedAttackers) {
            if (aCount >= this.config.attackers.total) break;
            const p = setupPlayer(new Player(`a${aCount}`, cw * 0.0833, ch/2 + (aCount * (ch*0.0625) - (ch*0.0625)), 'attackers', false));
            p.localPlayer = lp;
            this.players.push(p);
            aCount++;
        }
        if (this.config.attackers.useAI) {
            while (aCount < this.config.attackers.total) {
                const p = setupPlayer(new Player(`a${aCount}`, cw * 0.0833 + (aCount * cw*0.04), ch/2 + (aCount % 2 === 0 ? ch*0.0625 : -ch*0.0625), 'attackers', true));
                this.players.push(p);
                aCount++;
            }
        }
        this.gameState.attackersAlive = aCount;

        let dCount = 0;
        for (const lp of assignedDefenders) {
            if (dCount >= this.config.defenders.total) break;
            const p = setupPlayer(new Player(`d${dCount}`, cw * 0.9166, ch/2 + (dCount * (ch*0.0625) - (ch*0.0625)), 'defenders', false));
            p.localPlayer = lp;
            this.players.push(p);
            dCount++;
        }
        if (this.config.defenders.useAI) {
            while (dCount < this.config.defenders.total) {
                const p = setupPlayer(new Player(`d${dCount}`, cw * 0.9166 - (dCount * cw*0.04), ch/2 + (dCount % 2 === 0 ? ch*0.0625 : -ch*0.0625), 'defenders', true));
                this.players.push(p);
                dCount++;
            }
        }

        [{x:cw/2,y:ch*0.1875}, {x:cw/2,y:ch*0.8125}, {x:cw*0.25,y:ch/2}, {x:cw*0.75,y:ch/2}, {x:cw/2,y:ch/2}].forEach((pos, i) => {
            const item = new Item(`i${i}`, pos.x, pos.y);
            item.radius = cw * 0.0066;
            this.items.push(item);
        });
        this.notifyState();
    }

    setConfig(config: GameConfig) { 
        this.config = config; 
        this.initEntities(); 
    }

    bindEvents() {
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
    }

    unbindEvents() {
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
    }

    start() {
        this.lastTime = performance.now();
        
        // Physics Loop (runs in setInterval so it continues even if backgrounded)
        this.intervalId = setInterval(() => {
            const time = performance.now();
            let dt = (time - this.lastTime) / 1000;
            this.lastTime = time;
            
            // Limit catchup to 1 second max
            if (dt > 1) dt = 1;
            
            // Sub-step catchup if dt is huge
            while (dt > 0.033) {
                this.update(0.033);
                dt -= 0.033;
            }
            if (dt > 0) this.update(dt);
        }, 16);

        // Render Loop
        const drawLoop = () => {
            this.draw();
            this.animationFrameId = requestAnimationFrame(drawLoop);
        };
        this.animationFrameId = requestAnimationFrame(drawLoop);
    }

    stop() { 
        if (this.intervalId) clearInterval(this.intervalId);
        cancelAnimationFrame(this.animationFrameId); 
        this.unbindEvents();
    }

    emitParticles(x: number, y: number, type: 'spark'|'snow'|'firework'|'dust', count: number) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            let speed = Math.random() * 50 + 20;
            let life = Math.random() * 0.3 + 0.2;
            let size = Math.random() * 3 + 1;
            let color = '#FFFFFF';

            if (type === 'spark') {
                speed = Math.random() * 150 + 50;
                life = Math.random() * 0.4 + 0.1;
                size = Math.random() * 4 + 1;
                color = Math.random() > 0.5 ? '#F1C40F' : '#E67E22';
            } else if (type === 'dust') {
                speed = Math.random() * 40 + 10;
                life = Math.random() * 0.5 + 0.3;
                size = Math.random() * 6 + 2;
                color = 'rgba(149, 165, 166, 0.6)';
            } else if (type === 'snow') {
                speed = Math.random() * 80 + 30;
                life = Math.random() * 0.6 + 0.4;
                size = Math.random() * 4 + 2;
                color = '#00E5FF';
            } else if (type === 'firework') {
                speed = Math.random() * 200 + 50;
                life = Math.random() * 0.8 + 0.4;
                size = Math.random() * 5 + 2;
                const colors = ['#E74C3C', '#2ECC71', '#3498DB', '#F1C40F', '#9B59B6'];
                color = colors[Math.floor(Math.random() * colors.length)];
            }

            this.particles.push({
                x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                life, maxLife: life, color, size, type
            });
        }
    }

    update(dt: number) {
        if (this.isPaused || this.gameState.status !== 'playing') return;

        if (this.isNetworkClient) {
            // Client only updates particles, actual positions come from network sync
            this.particles.forEach(p => {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                if (p.type === 'snow') { p.vy += 50 * dt; }
                if (p.type === 'firework') { p.vy += 100 * dt; p.vx *= 0.95; p.vy *= 0.95; }
                p.life -= dt;
            });
            this.particles = this.particles.filter(p => p.life > 0);
            return;
        }

        const prevSeconds = Math.ceil(this.gameState.timeLeft);
        this.gameState.timeLeft -= dt;
        if (this.gameState.timeLeft <= 0) {
            this.gameState.timeLeft = 0;
            this.gameState.status = 'defenders_win';
            this.notifyState();
            return;
        }

        // Update particles
        this.particles.forEach(p => {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.type === 'snow') { p.vy += 50 * dt; } // gravity for snow
            if (p.type === 'firework') { p.vy += 100 * dt; p.vx *= 0.95; p.vy *= 0.95; } // gravity & drag
            p.life -= dt;
        });
        this.particles = this.particles.filter(p => p.life > 0);

        this.updatePlayers(dt); this.updateAI(dt); this.updateBall(dt); this.checkWinConditions();

        if (this.gameState.status === 'playing' && Math.ceil(this.gameState.timeLeft) !== prevSeconds) {
            this.notifyState();
        }
    }

    updatePlayers(dt: number) {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

        this.players.forEach(p => {
            if (p.iFrames > 0) p.iFrames -= dt;
            if (p.dashCooldown > 0) p.dashCooldown -= dt;
            if (p.dashTimer > 0) p.dashTimer -= dt;

            if (p.isFrozen) {
                let beingRevived = false;
                this.players.forEach(s => {
                    if (s.team === 'attackers' && !s.isFrozen && this.dist(p, s) < p.radius + s.radius + 15) {
                        beingRevived = true;
                    }
                });
                if (beingRevived) {
                    p.unfreezeTimer += dt;
                    if (p.unfreezeTimer >= 3) {
                        p.isFrozen = false; p.iFrames = 2; p.unfreezeTimer = 0;
                        this.emitParticles(p.x, p.y, 'snow', 20);
                    }
                } else {
                    p.unfreezeTimer = 0;
                }
                return;
            }

            let dx = 0, dy = 0;
            if (!p.isAI) {
                // If Host and player is remote, use networkInputs instead of local keys
                const isRemote = p.localPlayer?.id.startsWith('net-'); // or however we flag remote!
                if (!p.localPlayer) return;

                const input = this.getInputState(p);
                let activeKeys = this.keys;
                
                // Merge network keys if available
                if (this.networkInputs.has(p.localPlayer.id)) {
                    activeKeys = this.networkInputs.get(p.localPlayer.id).keys || {};
                }

                const lp = p.localPlayer;

                if (lp.type === 'keyboard' || this.networkInputs.has(lp.id)) {
                    const binds = this.config.keyBindings || { up: 'w', down: 's', left: 'a', right: 'd', pass: ' ', drop: 'q' };
                    if (activeKeys[binds.up.toLowerCase()] || activeKeys['arrowup']) dy -= 1;
                    if (activeKeys[binds.down.toLowerCase()] || activeKeys['arrowdown']) dy += 1;
                    if (activeKeys[binds.left.toLowerCase()] || activeKeys['arrowleft']) dx -= 1;
                    if (activeKeys[binds.right.toLowerCase()] || activeKeys['arrowright']) dx += 1;

                    if (p.team === 'defenders') {
                        const isThrowingKey = !!activeKeys[binds.pass.toLowerCase()];
                        if (isThrowingKey && !input.isMouseDown && this.ball.heldBy === p) {
                            input.isMouseDown = true;
                            input.mouseDownTime = performance.now();
                            input.usingGamepad = false;
                        } else if (!isThrowingKey && input.isMouseDown && this.ball.heldBy === p) {
                            input.isMouseDown = false;
                            this.throwBall(p, p.x + input.lastMoveX * 200, p.y + input.lastMoveY * 200, (performance.now() - input.mouseDownTime) / 1000);
                        }
                        
                        if (isThrowingKey && !input.wasPassRequested && this.ball.heldBy !== p) {
                            this.requestPass(p);
                        }
                        input.wasPassRequested = isThrowingKey;

                        if (activeKeys['shift'] && p.dashCooldown <= 0 && p.dashTimer <= 0) {
                            p.dashTimer = 0.2;
                            p.dashCooldown = 3;
                            soundManager.playDash?.();
                        }
                    }
                    if (p.team === 'attackers') {
                        if ((activeKeys[binds.drop.toLowerCase()] && !input.wasGamepadDrop)) {
                            this.dropItem(p);
                        }
                        input.wasGamepadDrop = !!activeKeys[binds.drop.toLowerCase()];
                    }
                }

                if (lp.type === 'gamepad') {
                    let gamepad: any = undefined;
                    if (this.networkInputs.has(lp.id) && this.networkInputs.get(lp.id).gamepadAxes) {
                        const netInp = this.networkInputs.get(lp.id);
                        gamepad = { axes: netInp.gamepadAxes, buttons: netInp.gamepadButtons.map((pressed: boolean) => ({ pressed, value: pressed ? 1 : 0 })) };
                    } else if (lp.gamepadIndex !== undefined) {
                        gamepad = gamepads[lp.gamepadIndex];
                    }

                    if (gamepad) {
                        const lsX = gamepad.axes[0] || 0;
                        const lsY = gamepad.axes[1] || 0;
                        if (Math.abs(lsX) > 0.2) { dx += lsX; input.usingGamepad = true; }
                        if (Math.abs(lsY) > 0.2) { dy += lsY; input.usingGamepad = true; }

                        if (p.team === 'defenders') {
                            const rsX = gamepad.axes[2] || 0;
                            const rsY = gamepad.axes[3] || 0;
                            if (Math.abs(rsX) > 0.2 || Math.abs(rsY) > 0.2) {
                                input.gamepadAimX = rsX;
                                input.gamepadAimY = rsY;
                                input.usingGamepad = true;
                            }

                            const isThrowing = (gamepad.buttons[7]?.value > 0.1) || gamepad.buttons[0]?.pressed;
                            if (isThrowing && !input.wasGamepadThrowing && this.ball.heldBy === p) {
                                input.isMouseDown = true;
                                input.mouseDownTime = performance.now();
                                input.usingGamepad = true;
                            } else if (!isThrowing && input.wasGamepadThrowing && this.ball.heldBy === p) {
                                input.isMouseDown = false;
                                const targetX = p.x + input.lastMoveX * 200;
                                const targetY = p.y + input.lastMoveY * 200;
                                this.throwBall(p, targetX, targetY, (performance.now() - input.mouseDownTime) / 1000);
                            }
                            input.wasGamepadThrowing = !!isThrowing;

                            const isReqPass = !!(gamepad.buttons[0]?.pressed || gamepad.buttons[3]?.pressed);
                            if (isReqPass && !input.wasPassRequested) {
                                this.requestPass(p);
                            }
                            input.wasPassRequested = isReqPass;

                            const isDashing = !!(gamepad.buttons[5]?.pressed || gamepad.buttons[1]?.pressed);
                            if (isDashing && !input.wasGamepadDash && p.dashCooldown <= 0 && p.dashTimer <= 0) {
                                p.dashTimer = 0.2;
                                p.dashCooldown = 3;
                            }
                            input.wasGamepadDash = isDashing;
                        }

                        if (p.team === 'attackers') {
                            const btnA = gamepad.buttons[0]?.pressed;
                            if (btnA && !input.wasGamepadDrop) {
                                this.dropItem(p);
                                input.usingGamepad = true;
                            }
                            input.wasGamepadDrop = btnA;
                        }
                    }
                }
            }

            if (dx !== 0 || dy !== 0) {
                const len = Math.sqrt(dx*dx + dy*dy);
                const mult = len > 1 ? 1 / len : 1;
                const input = this.getInputState(p);
                input.lastMoveX = dx * mult;
                input.lastMoveY = dy * mult;
                let speedMult = 1;
                if (p.dashTimer > 0) speedMult = 3;
                this.movePlayer(p, dx * mult * p.speed * speedMult * dt, dy * mult * p.speed * speedMult * dt);
            }

            if (p.team === 'attackers') {
                if (!p.carryingItem) {
                    const item = this.items.find(i => !i.isCarried && !i.inZone && this.dist(p, i) < p.radius + i.radius);
                    if (item) { 
                        item.isCarried = true; 
                        p.carryingItem = item; 
                    }
                } else {
                    if (this.onPlayerStat) {
                        const name = p.localPlayer ? p.localPlayer.label : (p.team === 'attackers' ? 'Attacker Bot' : 'Defender Bot');
                        this.onPlayerStat(p.localPlayer ? p.localPlayer.id : p.id, name, 'holdTime', dt);
                    }
                    p.carryingItem.x = p.x; p.carryingItem.y = p.y - 20;

                    const zone = this.zones.find(z => this.pointInRect(p.x, p.y, z));
                    if (zone && !zone.hasItem && !zone.isPlanting) {
                        this.dropItem(p);
                    }
                }
            } else if (p.team === 'defenders') {
                if (!this.ball.heldBy && this.ball.z < 20 && this.dist(p, this.ball) < p.radius + this.ball.radius + 10) {
                    this.ball.heldBy = p; this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
                }
            }
        });

        let piecePlacedThisFrame = false;
        // Update Zones planting logic
        this.zones.forEach(z => {
            if (z.isPlanting && !z.hasItem) {
                const isPlayerStanding = this.players.some(p => p.team === 'attackers' && !p.isFrozen && this.pointInRect(p.x, p.y, z));
                if (isPlayerStanding) {
                    z.progress += dt;
                    if (z.progress >= 5) {
                        z.progress = 5;
                        z.hasItem = true;
                        z.isPlanting = false;
                        z.plantedTime = performance.now();
                        if (z.planter && this.onPlayerStat) {
                            const p = z.planter;
                            const name = p.localPlayer ? p.localPlayer.label : (p.team === 'attackers' ? 'Attacker Bot' : 'Defender Bot');
                            this.onPlayerStat(p.localPlayer ? p.localPlayer.id : p.id, name, 'plant', 1);
                        }
                        this.gameState.itemsPlaced++;
                        piecePlacedThisFrame = true;
                        this.notifyState();
                        this.emitParticles(z.x + z.w/2, z.y + z.h/2, 'firework', 50);
                    }
                }
            }
        });

        if (piecePlacedThisFrame && this.gameState.itemsPlaced === 4) {
            soundManager.playGoalP();
        }
    }

    movePlayer(p: Player, mx: number, my: number) {
        // Approximate actual velocity by tracking the actual distance moved this frame
        const startX = p.x;
        const startY = p.y;
        
        p.x += mx; if (this.checkWallCollision(p)) p.x -= mx;
        p.y += my; if (this.checkWallCollision(p)) p.y -= my;
        p.x = Math.max(p.radius, Math.min(this.canvas.width - p.radius, p.x));
        p.y = Math.max(p.radius, Math.min(this.canvas.height - p.radius, p.y));
        
        p.vx = p.x - startX;
        p.vy = p.y - startY;
        
        // Update facing direction
        if (p.vx < -0.1) p.faceDir = -1;
        else if (p.vx > 0.1) p.faceDir = 1;

        if (p.dashTimer > 0 && (Math.abs(p.vx) > 0 || Math.abs(p.vy) > 0)) {
            // Emits 1-2 dust spark particles per movement frame while dashing
            if (Math.random() < 0.6) {
                this.emitParticles(p.x, p.y + p.radius, 'dust', 1);
            }
        }
    }

    checkWallCollision(p: {x:number, y:number, radius:number}) {
        for (const w of this.walls) if (this.circleRectCollide(p.x, p.y, p.radius, w.x, w.y, w.w, w.h)) return true;
        for (const pil of this.pillars) if (this.dist(p, pil) < p.radius + pil.r) return true;
        return false;
    }

    updateAI(dt: number) {
        this.players.forEach(p => {
            if (!p.isAI || p.isFrozen) return;
            let targetX = p.x, targetY = p.y, shouldMove = false;

            if (p.team === 'attackers') {
                const frozenTargets = this.players.filter(t => t.team === 'attackers' && t.isFrozen);
                const frozen = frozenTargets.sort((a, b) => this.dist(p, a) - this.dist(p, b))[0];
                if (frozen) { targetX = frozen.x; targetY = frozen.y; shouldMove = true; }
                else if (p.carryingItem) {
                    const emptyZones = this.zones.filter(z => !z.hasItem && !z.isPlanting);
                    const emptyZone = emptyZones.sort((a, b) => this.dist(p, {x: a.x + a.w/2, y: a.y + a.h/2}) - this.dist(p, {x: b.x + b.w/2, y: b.y + b.h/2}))[0];
                    if (emptyZone) {
                        targetX = emptyZone.x + emptyZone.w/2; targetY = emptyZone.y + emptyZone.h/2; shouldMove = true;
                        if (this.pointInRect(p.x, p.y, emptyZone)) {
                            this.dropItem(p);
                        }
                    }
                } else {
                    const plantingZones = this.zones.filter(z => z.isPlanting && !z.hasItem);
                    const urgentZone = plantingZones.sort((a,b) => this.dist(p, {x: a.x + a.w/2, y: a.y + a.h/2}) - this.dist(p, {x: b.x + b.w/2, y: b.y + b.h/2}))[0];
                    if (urgentZone) {
                        targetX = urgentZone.x + urgentZone.w/2; targetY = urgentZone.y + urgentZone.h/2; shouldMove = true;
                    } else {
                        const items = this.items.filter(i => !i.isCarried && !i.inZone);
                        const item = items.sort((a, b) => this.dist(p, a) - this.dist(p, b))[0];
                        if (item) { targetX = item.x; targetY = item.y; shouldMove = true; }
                        else {
                            // Evade closest defender if no chores
                            const defenders = this.players.filter(d => d.team === 'defenders');
                            const closestDefender = defenders.sort((a, b) => this.dist(p, a) - this.dist(p, b))[0];
                            if (closestDefender && this.dist(p, closestDefender) < 300) {
                                targetX = p.x + (p.x - closestDefender.x);
                                targetY = p.y + (p.y - closestDefender.y);
                                shouldMove = true;
                            }
                        }
                    }
                }
            } else {
                if (this.ball.heldBy === p) {
                    const targets = this.players.filter(a => a.team === 'attackers' && !a.isFrozen);
                    const target = targets.sort((a, b) => this.dist(p, a) - this.dist(p, b))[0];
                    if (target && Math.random() < 0.03) {
                        const tx = target.x + (target.vx || 0) * 0.4;
                        const ty = target.y + (target.vy || 0) * 0.4;
                        this.throwBall(p, tx, ty, this.dist(p, target) > 400 ? 0.6 : 0.2);
                    }
                } else if (!this.ball.heldBy) {
                    targetX = this.ball.x; targetY = this.ball.y; shouldMove = true;
                    // Dodge to the ball!
                    if (p.dashCooldown <= 0 && this.dist(p, this.ball) > 100 && Math.random() < 0.02) {
                        p.dashTimer = 0.2; p.dashCooldown = 3;
                    }
                } else {
                    const targets = this.players.filter(a => a.team === 'attackers' && !a.isFrozen);
                    const target = targets.sort((a, b) => this.dist(p, a) - this.dist(p, b))[0];
                    if (target) {
                        targetX = target.x; targetY = target.y; shouldMove = true;
                        // Dash to close the gap!
                        if (p.dashCooldown <= 0 && this.dist(p, target) > 120 && Math.random() < 0.02) {
                            p.dashTimer = 0.2; p.dashCooldown = 3;
                        }
                    }
                }
            }

            if (shouldMove) {
                const dx = targetX - p.x, dy = targetY - p.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist > 5) {
                    let dirX = dx / dist;
                    let dirY = dy / dist;

                    let avoidX = 0, avoidY = 0;
                    for (const pil of this.pillars) {
                        const pdx = p.x - pil.x, pdy = p.y - pil.y;
                        const pdist = Math.sqrt(pdx*pdx + pdy*pdy);
                        if (pdist < p.radius + pil.r + 60) {
                            const strength = (1 - Math.max(0, pdist - p.radius - pil.r)/60);
                            avoidX += (pdx / pdist) * strength;
                            avoidY += (pdy / pdist) * strength;
                            // Tangential force to slide around
                            avoidX += (pdy / pdist) * strength * 0.8;
                            avoidY -= (pdx / pdist) * strength * 0.8;
                        }
                    }
                    for (const w of this.walls) {
                        const cx = Math.max(w.x, Math.min(p.x, w.x + w.w));
                        const cy = Math.max(w.y, Math.min(p.y, w.y + w.h));
                        const pdx = p.x - cx, pdy = p.y - cy;
                        const pdist = Math.sqrt(pdx*pdx + pdy*pdy);
                        if (pdist < p.radius + 60 && pdist > 0) {
                            const strength = (1 - Math.max(0, pdist - p.radius)/60);
                            avoidX += (pdx / pdist) * strength;
                            avoidY += (pdy / pdist) * strength;
                            // Tangential force to slide around
                            avoidX += (pdy / pdist) * strength * 0.8;
                            avoidY -= (pdx / pdist) * strength * 0.8;
                        }
                    }
                    
                    dirX += avoidX * 2.5;
                    dirY += avoidY * 2.5;
                    
                    const newLen = Math.sqrt(dirX*dirX + dirY*dirY);
                    if (newLen > 0) {
                        dirX /= newLen;
                        dirY /= newLen;
                    }
                    
                    let speedMult = 1;
                    if (p.dashTimer > 0) speedMult = 3;

                    this.movePlayer(p, dirX * p.speed * speedMult * dt, dirY * p.speed * speedMult * dt);
                }
            }
        });
    }

    updateBall(dt: number) {
        // Update trail fade
        this.ball.trail.forEach(t => t.alpha -= dt * 2);
        this.ball.trail = this.ball.trail.filter(t => t.alpha > 0);

        if (this.ball.heldBy) {
            this.ball.x = this.ball.heldBy.x; this.ball.y = this.ball.heldBy.y; this.ball.z = 20;
            if ((this.ball.holdTime += dt) > 5) { this.ball.heldBy = null; this.ball.holdTime = 0; }
            return;
        }

        // Add trail if moving fast
        if (Math.abs(this.ball.vx) > 50 || Math.abs(this.ball.vy) > 50) {
            this.ball.trail.push({x: this.ball.x, y: this.ball.y, z: this.ball.z, alpha: 1});
        }

        if (this.ball.z > 0 || this.ball.vz !== 0) {
            this.ball.vz -= 800 * dt; this.ball.z += this.ball.vz * dt;
            if (this.ball.z <= 0) {
                this.ball.z = 0; this.ball.vz *= -0.6;
                if (Math.abs(this.ball.vz) < 20) this.ball.vz = 0;
            }
        }

        if (this.ball.z === 0) {
            this.ball.vx *= Math.exp(-2 * dt); this.ball.vy *= Math.exp(-2 * dt);
            if (Math.abs(this.ball.vx) < 5) this.ball.vx = 0;
            if (Math.abs(this.ball.vy) < 5) this.ball.vy = 0;
        }

        const nextX = this.ball.x + this.ball.vx * dt, nextY = this.ball.y + this.ball.vy * dt;

        if (this.ball.z < 40) {
            let colX = false, colY = false;
            for (const w of this.walls) {
                if (this.circleRectCollide(nextX, this.ball.y, this.ball.radius, w.x, w.y, w.w, w.h)) colX = true;
                if (this.circleRectCollide(this.ball.x, nextY, this.ball.radius, w.x, w.y, w.w, w.h)) colY = true;
            }
            for (const pil of this.pillars) {
                if (this.dist({x: nextX, y: this.ball.y}, pil) < this.ball.radius + pil.r) colX = true;
                if (this.dist({x: this.ball.x, y: nextY}, pil) < this.ball.radius + pil.r) colY = true;
            }
            if (colX) this.ball.vx *= -1.05; else this.ball.x = nextX;
            if (colY) this.ball.vy *= -1.05; else this.ball.y = nextY;
        } else {
            this.ball.x = nextX; this.ball.y = nextY;
        }

        if (this.ball.x < 0 || this.ball.x > this.canvas.width) {
            this.ball.vx *= -1.05;
            this.emitParticles(this.ball.x, this.ball.y, 'dust', 5);
        }
        
        // Advanced Top Wall handling (Angled glass ceiling effect so ball doesn't go off-screen)
        if (this.ball.y - this.ball.z < 0) {
            this.ball.y = this.ball.z;
            if (this.ball.vy < 0) this.ball.vy *= -1.05;   // Bounce down off the visual ceiling
            if (this.ball.vz > 0) this.ball.vz *= -0.5; // Dampen the height
        } else if (this.ball.y > this.canvas.height) {
            this.ball.vy *= -1.05;
        }

        this.ball.x = Math.max(0, Math.min(this.canvas.width, this.ball.x));
        this.ball.y = Math.max(0, Math.min(this.canvas.height, this.ball.y));

        if (Math.sqrt(this.ball.vx*this.ball.vx + this.ball.vy*this.ball.vy) > 150 && this.ball.z < 40) {
            this.players.forEach(p => {
                // Secret Hitbox buff: Add +8 radius leeway for getting frozen
                if (p.team === 'attackers' && !p.isFrozen && p.iFrames <= 0 && this.dist(this.ball, p) < this.ball.radius + p.radius + 8) {
                    p.isFrozen = true; this.dropItem(p, true);
                    this.ball.vx *= -0.5; this.ball.vy *= -0.5;
                    this.emitParticles(p.x, p.y, 'snow', 30);
                    if (this.ball.lastHeldBy && this.onPlayerStat) {
                        const hb = this.ball.lastHeldBy;
                        const name = hb.localPlayer ? hb.localPlayer.label : (hb.team === 'attackers' ? 'Attacker Bot' : 'Defender Bot');
                        this.onPlayerStat(hb.localPlayer ? hb.localPlayer.id : hb.id, name, 'freeze', 1);
                    }
                }
            });
        }
    }

    throwBall(p: Player, targetX: number, targetY: number, holdDuration: number) {
        this.ball.lastHeldBy = p;
        this.ball.heldBy = null; this.ball.holdTime = 0;
        const dx = targetX - p.x, dy = targetY - p.y, dist = Math.sqrt(dx*dx + dy*dy);
        const dirX = dist > 0 ? dx/dist : p.faceDir;
        const dirY = dist > 0 ? dy/dist : 0;
        if (holdDuration < 0.2) {
            this.ball.vx = dirX * 960; this.ball.vy = dirY * 960; this.ball.vz = 100;
        } else {
            this.ball.vx = dirX * 480; this.ball.vy = dirY * 480; this.ball.vz = 400 + Math.min(holdDuration * 2, 1) * 300;
        }
        
        // Play throw sound effect
        if (soundManager.playThrow) {
            soundManager.playThrow();
        }
    }

    requestPass(p: Player) {
        if (this.ball.heldBy && this.ball.heldBy.isAI && this.ball.heldBy.team === p.team) {
            this.throwBall(this.ball.heldBy, p.x, p.y, 0.3);
        }
    }

    dropItem(p: Player, throwAway: boolean = false) {
        if (!p.carryingItem) return;
        const item = p.carryingItem; p.carryingItem = null; item.isCarried = false;
        const zone = this.zones.find(z => this.pointInRect(p.x, p.y, z));
        if (zone && !zone.hasItem && !zone.isPlanting && !throwAway) {
            zone.isPlanting = true;
            zone.progress = 0;
            zone.planter = p;
            item.inZone = zone;
            item.x = zone.x + zone.w/2; item.y = zone.y + zone.h/2;
            soundManager.playPlaceItem?.(); // visual start sound
        } else {
            // Always throw away slightly if dropped outside a valid zone to prevent instant auto-pickup
            const angle = Math.random() * Math.PI * 2;
            const dist = 60 + Math.random() * 40;
            item.x = p.x + Math.cos(angle) * dist;
            item.y = p.y + Math.sin(angle) * dist;
            item.x = Math.max(item.radius + 10, Math.min(this.canvas.width - item.radius - 10, item.x));
            item.y = Math.max(item.radius + 10, Math.min(this.canvas.height - item.radius - 10, item.y));
        }
    }

    getNetworkState() {
        return {
            ball: { x: this.ball.x, y: this.ball.y, z: this.ball.z, heldById: this.ball.heldBy ? this.ball.heldBy.id : null },
            players: this.players.map(p => ({
                id: p.id,
                x: p.x, y: p.y, faceDir: p.faceDir,
                isFrozen: p.isFrozen, iFrames: p.iFrames,
                dashTimer: p.dashTimer, unfreezeTimer: p.unfreezeTimer,
                carryingItemId: p.carryingItem ? p.carryingItem.id : null
            })),
            items: this.items.map(i => ({ id: i.id, x: i.x, y: i.y, isCarried: i.isCarried, inZoneId: i.inZone ? i.inZone.id : null })),
            zones: this.zones.map(z => ({ id: z.id, hasItem: z.hasItem, progress: z.progress, isPlanting: z.isPlanting })),
            gameState: this.gameState
        };
    }

    applyNetworkState(state: any) {
        if (!state) return;
        this.gameState = state.gameState;
        
        if (state.ball) {
            this.ball.x = state.ball.x; this.ball.y = state.ball.y; this.ball.z = state.ball.z;
            this.ball.heldBy = state.ball.heldById ? this.players.find(p => p.id === state.ball.heldById) || null : null;
        }

        if (state.players) {
            state.players.forEach((sp: any) => {
                const p = this.players.find(pl => pl.id === sp.id);
                if (p) {
                    p.x = sp.x; p.y = sp.y; p.faceDir = sp.faceDir;
                    p.isFrozen = sp.isFrozen; p.iFrames = sp.iFrames;
                    p.dashTimer = sp.dashTimer; p.unfreezeTimer = sp.unfreezeTimer;
                    p.carryingItem = sp.carryingItemId ? this.items.find(i => i.id === sp.carryingItemId) || null : null;
                }
            });
        }

        if (state.items) {
            state.items.forEach((si: any) => {
                const i = this.items.find(it => it.id === si.id);
                if (i) {
                    i.x = si.x; i.y = si.y; i.isCarried = si.isCarried;
                    i.inZone = si.inZoneId ? this.zones.find(z => z.id === si.inZoneId) || null : null;
                }
            });
        }

        if (state.zones) {
            state.zones.forEach((sz: any) => {
                const z = this.zones.find(zo => zo.id === sz.id);
                if (z) {
                    z.hasItem = sz.hasItem; z.progress = sz.progress; z.isPlanting = sz.isPlanting;
                }
            });
        }
    }

    checkWinConditions() {
        if (this.gameState.itemsPlaced >= 5) { this.gameState.status = 'attackers_win'; this.notifyState(); }
        const activeAttackers = this.players.filter(p => p.team === 'attackers' && !p.isFrozen).length;
        this.gameState.attackersAlive = activeAttackers;
        if (activeAttackers === 0 && this.gameState.status !== 'attackers_win') { this.gameState.status = 'defenders_win'; this.notifyState(); }
    }

    notifyState() { if (this.onStateChange) this.onStateChange({ ...this.gameState }); }

    draw() {
        if (this.config.mapTheme === 'football') {
            this.drawFootballMap();
        } else if (this.config.mapTheme === 'duck') {
            this.drawDuckMap();
        } else {
            this.drawPigeonMap();
        }
        
        // Draw zone progress bars
        this.zones.forEach(z => {
            if (!z.hasItem && z.isPlanting && z.progress > 0) {
                const barW = z.w * 0.8;
                const barH = 10;
                const progressRatio = Math.min(z.progress / 5, 1);
                const bx = z.x + (z.w - barW)/2;
                const by = z.y + z.h - 20;

                // Background
                this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
                this.ctx.beginPath();
                this.ctx.roundRect(bx, by, barW, barH, 4);
                this.ctx.fill();
                
                // Fill
                this.ctx.fillStyle = '#FFEA00';
                this.ctx.beginPath();
                this.ctx.roundRect(bx + 1, by + 1, Math.max(0, (barW - 2) * progressRatio), barH - 2, 3);
                this.ctx.fill();
                
                // Text remaining time
                this.ctx.fillStyle = '#FFFFFF';
                this.ctx.font = 'bold 10px Inter';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'bottom';
                this.ctx.fillText(Math.ceil(5 - z.progress) + 's', z.x + z.w/2, by - 4);
            }
        });

        // Items - Now theme dependent
        this.items.forEach(i => {
            if (i.isCarried) return;
            
            if (this.config.mapTheme === 'football') {
                // Football theme items (Soccer balls to collect)
                this.drawShadow(i.x, i.y + 6, i.radius, i.radius/2);
                
                this.ctx.fillStyle = '#FFFFFF'; 
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 1;
                
                // Draw small soccer ball
                this.ctx.beginPath();
                let cy = i.y - 4 + Math.sin(performance.now()/300)*2; // floating
                this.ctx.arc(i.x, cy, i.radius, 0, Math.PI*2);
                this.ctx.fill();
                this.ctx.stroke();

                this.ctx.fillStyle = '#000000';
                this.ctx.beginPath(); this.ctx.arc(i.x, cy, i.radius * 0.4, 0, Math.PI*2); this.ctx.fill();
            } else if (this.config.mapTheme === 'duck') {
                // Desert Track items (Wrench)
                let cy = i.y - 4 + Math.sin(performance.now()/300)*2;
                
                // Shadow
                this.drawShadow(i.x, i.y + 6, i.radius, i.radius/2);
                
                this.ctx.save();
                this.ctx.translate(i.x, cy);
                this.ctx.rotate(Math.sin(performance.now() / 500) * 0.5); // Slight tick-tock rotation
                
                // Wrench base
                this.ctx.fillStyle = '#95A5A6'; // Silver
                this.ctx.strokeStyle = '#2C3E50'; // Dark outline
                this.ctx.lineWidth = 1.5;
                
                // Handle
                this.ctx.fillRect(-2, -i.radius * 0.6, 4, i.radius * 1.2);
                this.ctx.strokeRect(-2, -i.radius * 0.6, 4, i.radius * 1.2);
                
                // Top crescent (U shape)
                this.ctx.beginPath();
                this.ctx.arc(0, -i.radius * 0.6, 5, Math.PI, 0);
                this.ctx.lineTo(2, -i.radius * 0.6 - 5);
                this.ctx.lineTo(-2, -i.radius * 0.6 - 5);
                this.ctx.closePath();
                
                this.ctx.beginPath();
                this.ctx.arc(0, -i.radius * 0.6, 5, Math.PI, 0);
                this.ctx.arc(0, -i.radius * 0.6, 2, 0, Math.PI, true);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();

                // Bottom ring (circle with a hole)
                this.ctx.beginPath();
                this.ctx.arc(0, i.radius * 0.6, 4, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
                
                // Inner hole
                this.ctx.fillStyle = '#EBB778'; // Sand color for hollow look
                this.ctx.beginPath();
                this.ctx.arc(0, i.radius * 0.6, 1.5, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
                
                this.ctx.restore();

            } else {
                // Pigeon theme items (Carrot)
                let cy = i.y - 4 + Math.sin(performance.now()/300)*2;

                this.drawShadow(i.x, i.y + 6, i.radius, i.radius/2);
                
                // Carrot body (Orange triangle)
                this.ctx.fillStyle = '#E67E22';
                this.ctx.beginPath();
                this.ctx.moveTo(i.x - 4, cy - i.radius);
                this.ctx.lineTo(i.x + 4, cy - i.radius);
                this.ctx.lineTo(i.x, cy + i.radius);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.strokeStyle = '#D35400';
                this.ctx.lineWidth = 1;
                this.ctx.stroke();

                // Carrot leaves (Green)
                this.ctx.fillStyle = '#2ECC71';
                this.ctx.beginPath();
                this.ctx.moveTo(i.x, cy - i.radius);
                this.ctx.lineTo(i.x - 6, cy - i.radius - 8);
                this.ctx.lineTo(i.x + 6, cy - i.radius - 8);
                this.ctx.closePath();
                this.ctx.fill();
            }
        });

        // Players (Hover Athletes vs Football Players)
        this.players.forEach(p => {
            const isEMP = p.isFrozen;
            const primaryColor = isEMP ? '#00E5FF' : p.color; // Cyan for EMP freeze
            
            if (this.config.mapTheme === 'football') {
                this.ctx.save(); // Save overall player state
                
                // Base shadow (unflipped so it stays centered correctly)
                this.drawShadow(p.x, p.y + 14 * 1.8, 12 * 1.8, 5 * 1.8, 0.4);

                this.ctx.translate(p.x, p.y);
                // The character drawing is naturally facing left.
                // If faceDir is 1 (moving right), we need to flip them (scale -1).
                // If faceDir is -1 (moving left), we keep them as is (scale 1).
                this.ctx.scale(1.8 * -p.faceDir, 1.8); 
                this.ctx.translate(-p.x, -p.y);

                const bounce = Math.sin(performance.now() / 150 + p.x) * 1.5;
                const headY = p.y - 24 + bounce;
                const bodyY = p.y - 12 + bounce;
                const shortsY = bodyY + 11;
                const legsY = shortsY + 6;

                if (p.team === 'attackers') {
                    // Brazil Style Flat Character
                    
                    // Legs & Shoes
                    this.ctx.fillStyle = '#FFFFFF'; // Sock
                    this.ctx.fillRect(p.x - 5, legsY, 4, 6);
                    this.ctx.fillRect(p.x + 1, legsY, 4, 6);
                    this.ctx.fillStyle = '#F16F2E'; // Shoe
                    this.ctx.beginPath(); this.ctx.roundRect(p.x - 8, legsY + 4, 7, 4, [4,0,0,4]); this.ctx.fill();
                    this.ctx.beginPath(); this.ctx.roundRect(p.x - 1, legsY + 4, 7, 4, [4,0,0,4]); this.ctx.fill();

                    // Shorts
                    this.ctx.fillStyle = '#2B5A9C';
                    this.ctx.fillRect(p.x - 7, shortsY, 14, 6);
                    this.ctx.fillStyle = '#FFFFFF'; // Stripe
                    this.ctx.fillRect(p.x + 3, shortsY, 2, 6);

                    // Shirt
                    this.ctx.fillStyle = '#FFD028';
                    this.ctx.fillRect(p.x - 7, bodyY, 14, 11);
                    
                    // Chest Logo / Pocket
                    this.ctx.fillStyle = '#189347';
                    this.ctx.beginPath(); this.ctx.roundRect(p.x + 1, bodyY + 3, 3, 4, [0,0,2,2]); this.ctx.fill();

                    // Collar
                    this.ctx.beginPath();
                    this.ctx.moveTo(p.x - 4, bodyY);
                    this.ctx.lineTo(p.x + 1, bodyY);
                    this.ctx.lineTo(p.x - 1, bodyY + 4);
                    this.ctx.fill();

                    // Arms
                    // Back Arm (Right)
                    this.ctx.fillStyle = '#FFD028';
                    this.ctx.fillRect(p.x + 7, bodyY, 4, 5);
                    this.ctx.fillStyle = '#189347'; 
                    this.ctx.fillRect(p.x + 7, bodyY + 5, 4, 2);
                    this.ctx.fillStyle = '#FFFFFF'; // Armband
                    this.ctx.fillRect(p.x + 7, bodyY + 7, 4, 3);
                    this.ctx.fillStyle = '#AE673B'; // Hand
                    this.ctx.fillRect(p.x + 7, bodyY + 10, 4, 4);

                    // Front Arm (Left)
                    this.ctx.fillStyle = '#FFD028';
                    this.ctx.fillRect(p.x - 11, bodyY, 4, 5);
                    this.ctx.fillStyle = '#189347'; 
                    this.ctx.fillRect(p.x - 11, bodyY + 5, 4, 2);
                    this.ctx.fillStyle = '#AE673B'; // Hand
                    this.ctx.fillRect(p.x - 11, bodyY + 7, 4, 5);

                    // Head
                    this.ctx.fillStyle = '#AE673B';
                    this.ctx.beginPath(); this.ctx.roundRect(p.x - 6, headY, 12, 12, [0, 0, 4, 4]); this.ctx.fill();

                    // Ear
                    this.ctx.beginPath(); this.ctx.arc(p.x + 6, headY + 7, 2.5, 0, Math.PI*2); this.ctx.fill();

                    // Hair
                    this.ctx.fillStyle = '#523315';
                    this.ctx.fillRect(p.x - 6, headY, 12, 4); // top
                    this.ctx.fillRect(p.x + 4, headY + 4, 3, 3); // sideburn
                    
                    // Hair Bangs
                    this.ctx.beginPath();
                    this.ctx.moveTo(p.x - 6, headY);
                    this.ctx.lineTo(p.x - 9, headY + 3);
                    this.ctx.lineTo(p.x - 4, headY + 2);
                    this.ctx.lineTo(p.x - 7, headY + 6);
                    this.ctx.lineTo(p.x - 2, headY + 4);
                    this.ctx.fill();

                } else {
                    // Argentina Style Flat Character
                    
                    // Legs & Shoes
                    this.ctx.fillStyle = '#FFFFFF'; // Sock
                    this.ctx.fillRect(p.x - 5, legsY, 4, 6);
                    this.ctx.fillRect(p.x + 1, legsY, 4, 6);
                    
                    this.ctx.fillStyle = '#6CBCE4'; // Sock Stripe
                    this.ctx.fillRect(p.x - 5, legsY + 2, 4, 2);
                    this.ctx.fillRect(p.x + 1, legsY + 2, 4, 2);
                    
                    this.ctx.fillStyle = '#F16F2E'; // Shoe
                    this.ctx.beginPath(); this.ctx.roundRect(p.x - 8, legsY + 4, 7, 4, [4,0,0,4]); this.ctx.fill();
                    this.ctx.beginPath(); this.ctx.roundRect(p.x - 1, legsY + 4, 7, 4, [4,0,0,4]); this.ctx.fill();

                    // Shorts
                    this.ctx.fillStyle = '#F0F0F0';
                    this.ctx.fillRect(p.x - 7, shortsY, 14, 6);

                    // Shirt Base
                    this.ctx.fillStyle = '#FFFFFF';
                    this.ctx.fillRect(p.x - 7, bodyY, 14, 11);
                    
                    // Light Blue Stripes
                    this.ctx.fillStyle = '#6CBCE4';
                    this.ctx.fillRect(p.x - 6, bodyY, 3, 11);
                    this.ctx.fillRect(p.x - 1, bodyY, 3, 11);
                    this.ctx.fillRect(p.x + 4, bodyY, 3, 11);

                    // Collar
                    this.ctx.fillStyle = '#001C3E';
                    this.ctx.beginPath();
                    this.ctx.moveTo(p.x - 1, bodyY);
                    this.ctx.lineTo(p.x + 3, bodyY);
                    this.ctx.lineTo(p.x - 1, bodyY + 4);
                    this.ctx.fill();

                    // Chest Shield
                    this.ctx.fillStyle = '#C29B62'; // golden shield
                    this.ctx.beginPath(); this.ctx.roundRect(p.x + 1, bodyY + 3, 3, 4, [0,0,2,2]); this.ctx.fill();

                    // Arms
                    // Back Arm (Right)
                    this.ctx.fillStyle = '#6CBCE4'; // Arm has stripe color
                    this.ctx.fillRect(p.x + 7, bodyY, 4, 5);
                    this.ctx.fillStyle = '#001C3E'; // Cuff
                    this.ctx.fillRect(p.x + 7, bodyY + 5, 4, 2);
                    this.ctx.fillStyle = '#F3B08B'; // Hand
                    this.ctx.fillRect(p.x + 7, bodyY + 7, 4, 5);

                    // Front Arm (Left)
                    this.ctx.fillStyle = '#6CBCE4';
                    this.ctx.fillRect(p.x - 11, bodyY, 4, 5);
                    this.ctx.fillStyle = '#001C3E'; // Cuff
                    this.ctx.fillRect(p.x - 11, bodyY + 5, 4, 2);
                    this.ctx.fillStyle = '#F3B08B'; // Hand
                    this.ctx.fillRect(p.x - 11, bodyY + 7, 4, 5);

                    // Head
                    this.ctx.fillStyle = '#F3B08B';
                    this.ctx.beginPath(); this.ctx.roundRect(p.x - 6, headY, 12, 12, [0, 0, 4, 4]); this.ctx.fill();

                    // Ear
                    this.ctx.beginPath(); this.ctx.arc(p.x + 6, headY + 7, 2.5, 0, Math.PI*2); this.ctx.fill();

                    // Hair
                    this.ctx.fillStyle = '#5A391A';
                    this.ctx.fillRect(p.x - 6, headY, 12, 3); // top
                    this.ctx.fillRect(p.x - 6, headY + 3, 5, 2); // front bang
                    this.ctx.fillRect(p.x + 4, headY + 3, 3, 3); // sideburn
                }
                
                this.ctx.restore(); // Restore body scale transform that flipped the player
                
                // EMP Status Effect overlay
                if (isEMP) {
                    this.ctx.fillStyle = 'rgba(0, 229, 255, 0.4)';
                    // We must scale manually since we restored the context, or just save/translate again
                    this.ctx.save();
                    this.ctx.translate(p.x, p.y);
                    this.ctx.scale(1.8, 1.8);
                    this.ctx.translate(-p.x, -p.y);
                    
                    this.ctx.beginPath(); this.ctx.roundRect(p.x - 12, headY, 24, legsY - headY + 8, 4); this.ctx.fill();
                    // lightning bolt indicator
                    this.ctx.strokeStyle = '#00E5FF';
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath();
                    this.ctx.moveTo(p.x + 2, headY - 4);
                    this.ctx.lineTo(p.x - 2, headY + 2);
                    this.ctx.lineTo(p.x + 2, headY + 2);
                    this.ctx.lineTo(p.x - 1, headY + 8);
                    this.ctx.stroke();
                    
                    this.ctx.restore();
                }

            } else if (this.config.mapTheme === 'duck') {
                // "Tiny Character" style: Big head, tiny pill body, black outline
                const bounce = Math.sin(performance.now() / 150 + p.x) * 2;
                
                // Outline config
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = 3;

                // Base shadow
                this.drawShadow(p.x, p.y + p.radius + 4, p.radius * 0.9, p.radius * 0.4, 0.4);

                this.ctx.save();
                this.ctx.translate(p.x, p.y);
                this.ctx.scale(p.faceDir, 1);
                this.ctx.translate(-p.x, -p.y);

                // Arms
                this.ctx.fillStyle = primaryColor;
                this.ctx.beginPath(); this.ctx.arc(p.x - p.radius * 0.5, p.y + bounce, 4, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
                this.ctx.beginPath(); this.ctx.arc(p.x + p.radius * 0.5, p.y + bounce, 4, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();

                // Body (tiny capsule)
                this.ctx.beginPath(); 
                this.ctx.roundRect(p.x - p.radius * 0.6, p.y - p.radius * 0.2 + bounce, p.radius * 1.2, p.radius, 6); 
                this.ctx.fill(); this.ctx.stroke();
                
                // Big Round Head
                this.ctx.beginPath(); 
                this.ctx.ellipse(p.x, p.y - p.radius * 0.7 + bounce, p.radius * 1.3, p.radius * 1.1, 0, 0, Math.PI * 2);
                this.ctx.fill(); this.ctx.stroke();

                // Huge black oval eyes
                this.ctx.fillStyle = '#000000';
                // Move eyes slightly in the direction they are facing for better effect
                this.ctx.beginPath(); this.ctx.ellipse(p.x - p.radius * 0.3 + 2, p.y - p.radius * 0.6 + bounce, p.radius * 0.2, p.radius * 0.4, 0, 0, Math.PI * 2); this.ctx.fill();
                this.ctx.beginPath(); this.ctx.ellipse(p.x + p.radius * 0.7 + 2, p.y - p.radius * 0.6 + bounce, p.radius * 0.2, p.radius * 0.4, 0, 0, Math.PI * 2); this.ctx.fill();
                
                this.ctx.restore();

            } else {
                // Pigeon Map Characters (Geese)
                const isPigeonThemeMoving = ('vx' in p) ? (Math.abs((p as any).vx) > 0.1 || Math.abs((p as any).vy) > 0.1) : false;
                // walkPhase is based on position so it loops naturally as they move
                const walkPhase = (p.x + p.y) * 0.15; 
                // Leg swing: limits the swing to a small arc
                const legSwing = isPigeonThemeMoving ? Math.sin(walkPhase) * 6 : 0;
                // Bob: body bounces up and down while moving
                const bob = isPigeonThemeMoving ? Math.abs(Math.sin(walkPhase)) * 3 : 0;
                // Tilt: body tilts slightly while moving
                const tilt = isPigeonThemeMoving ? Math.sin(walkPhase) * 0.1 : 0;
                
                // Base shadow
                this.drawShadow(p.x, p.y + 12, p.radius * 0.8, p.radius * 0.3, 0.4);

                this.ctx.save(); // Save overall player state
                this.ctx.translate(p.x, p.y - bob); // apply bob to entire body relative to feet!
                
                this.ctx.save(); // Save body state
                this.ctx.scale(p.faceDir, 1); // Flip body based on direction
                this.ctx.rotate(tilt); // Keep tilt

                if (p.team === 'attackers') {
                    // Red Goose (Bomb Goose)
                    
                    // Feet (Orange) - drawn relative to translate, so subtract p.x/p.y
                    this.ctx.strokeStyle = '#2A1F1D'; // Dark outline
                    this.ctx.lineWidth = 1.5;
                    this.ctx.fillStyle = '#FFA77A'; // Peach/orange feet
                    
                    // Left leg (moves forward when legSwing > 0)
                    this.ctx.beginPath(); this.ctx.moveTo(-4, p.radius + bob); this.ctx.lineTo(-4 + legSwing, p.radius + 6 + bob); this.ctx.stroke();
                    this.ctx.beginPath(); this.ctx.moveTo(-4 + legSwing, p.radius + 6 + bob); this.ctx.lineTo(-8 + legSwing, p.radius + 6 + bob); this.ctx.lineTo(-2 + legSwing, p.radius + 8 + bob); this.ctx.closePath(); this.ctx.fill(); this.ctx.stroke();
                    
                    // Right leg (moves backward when legSwing > 0)
                    this.ctx.beginPath(); this.ctx.moveTo(4, p.radius + bob); this.ctx.lineTo(4 - legSwing, p.radius + 6 + bob); this.ctx.stroke();
                    this.ctx.beginPath(); this.ctx.moveTo(4 - legSwing, p.radius + 6 + bob); this.ctx.lineTo(8 - legSwing, p.radius + 6 + bob); this.ctx.lineTo(2 - legSwing, p.radius + 8 + bob); this.ctx.closePath(); this.ctx.fill(); this.ctx.stroke();

                    // Main Body (Vibrant Red/Pinkish)
                    this.ctx.fillStyle = '#E84A5F'; 
                    this.ctx.strokeStyle = '#2A1F1D';
                    this.ctx.lineWidth = 2;
                    
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, -p.radius * 0.2, p.radius * 1.1, p.radius * 1.4, 0, 0, Math.PI * 2);
                    this.ctx.fill(); this.ctx.stroke();

                    // Tail feathers
                    this.ctx.beginPath();
                    this.ctx.moveTo(-p.radius, p.radius*0.5);
                    this.ctx.lineTo(-p.radius - 8, p.radius*0.3);
                    this.ctx.lineTo(-p.radius + 2, p.radius*0.8);
                    this.ctx.closePath();
                    this.ctx.fill(); this.ctx.stroke();

                    // Head feathers top
                    this.ctx.beginPath();
                    this.ctx.moveTo(-2, -p.radius * 1.5);
                    this.ctx.quadraticCurveTo(2, -p.radius * 1.8, +6, -p.radius * 1.4);
                    this.ctx.fill(); this.ctx.stroke();

                    // Big Half-Closed Grumpy Eye
                    this.ctx.fillStyle = '#FFFFFF';
                    this.ctx.beginPath(); 
                    this.ctx.arc(4, -p.radius * 0.6, 6, 0, Math.PI*2);
                    this.ctx.fill(); this.ctx.stroke();
                    
                    // Grumpy Eyelid
                    this.ctx.fillStyle = '#E84A5F';
                    this.ctx.beginPath(); 
                    this.ctx.arc(4, -p.radius * 0.6, 6.2, Math.PI, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.beginPath();
                    this.ctx.moveTo(-2.5, -p.radius * 0.6);
                    this.ctx.lineTo(10.5, -p.radius * 0.6 + 2); // Angled down
                    this.ctx.stroke();

                    // Pupil
                    this.ctx.fillStyle = '#111';
                    this.ctx.beginPath(); this.ctx.arc(6, -p.radius * 0.6 + 2, 1.5, 0, Math.PI*2); this.ctx.fill();

                    // Beak (Large Orange/Peach)
                    this.ctx.fillStyle = '#FF9D5C';
                    this.ctx.beginPath();
                    this.ctx.moveTo(2, -p.radius * 0.1);
                    this.ctx.quadraticCurveTo(16, -p.radius * 0.3, 18, p.radius * 0.2);
                    this.ctx.quadraticCurveTo(8, p.radius * 0.5, -2, p.radius * 0.2);
                    this.ctx.closePath();
                    this.ctx.fill(); this.ctx.stroke();

                    // Wing (flap when moving)
                    const wingRot = isPigeonThemeMoving ? Math.sin(walkPhase) * 0.2 : 0;
                    this.ctx.save();
                    this.ctx.translate(-4, p.radius * 0.4);
                    this.ctx.rotate(wingRot);
                    this.ctx.fillStyle = '#E84A5F';
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, 0, 6, 12, Math.PI/6, 0, Math.PI*2);
                    this.ctx.fill(); this.ctx.stroke();
                    this.ctx.restore();

                } else {
                    // White Ghost Goose (Defender)
                    // Feet (Greyish)
                    this.ctx.strokeStyle = '#2A1F1D'; 
                    this.ctx.lineWidth = 1.5;
                    this.ctx.fillStyle = '#B0BEC5'; 
                    
                    // Left leg
                    this.ctx.beginPath(); this.ctx.moveTo(-4, p.radius + bob); this.ctx.lineTo(-4 + legSwing, p.radius + 6 + bob); this.ctx.stroke();
                    this.ctx.beginPath(); this.ctx.moveTo(-4 + legSwing, p.radius + 6 + bob); this.ctx.lineTo(-8 + legSwing, p.radius + 6 + bob); this.ctx.lineTo(-2 + legSwing, p.radius + 8 + bob); this.ctx.closePath(); this.ctx.fill(); this.ctx.stroke();
                    
                    // Right leg
                    this.ctx.beginPath(); this.ctx.moveTo(4, p.radius + bob); this.ctx.lineTo(4 - legSwing, p.radius + 6 + bob); this.ctx.stroke();
                    this.ctx.beginPath(); this.ctx.moveTo(4 - legSwing, p.radius + 6 + bob); this.ctx.lineTo(8 - legSwing, p.radius + 6 + bob); this.ctx.lineTo(2 - legSwing, p.radius + 8 + bob); this.ctx.closePath(); this.ctx.fill(); this.ctx.stroke();

                    // Main Body (White)
                    this.ctx.fillStyle = '#F5F5F5'; 
                    this.ctx.strokeStyle = '#2A1F1D';
                    this.ctx.lineWidth = 2;
                    
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, -p.radius * 0.2, p.radius * 1.1, p.radius * 1.4, 0, 0, Math.PI * 2);
                    this.ctx.fill(); this.ctx.stroke();

                    // Tail feathers
                    this.ctx.beginPath();
                    this.ctx.moveTo(-p.radius, p.radius*0.5);
                    this.ctx.lineTo(-p.radius - 8, p.radius*0.3);
                    this.ctx.lineTo(-p.radius + 2, p.radius*0.8);
                    this.ctx.closePath();
                    this.ctx.fill(); this.ctx.stroke();

                    // Head feathers top (Ghost style)
                    this.ctx.beginPath();
                    this.ctx.moveTo(-2, -p.radius * 1.5);
                    this.ctx.quadraticCurveTo(2, -p.radius * 1.8, 6, -p.radius * 1.4);
                    this.ctx.fill(); this.ctx.stroke();

                    // The Big Stitched X Eye (Black Circle, White X, stitches)
                    this.ctx.fillStyle = '#111';
                    this.ctx.beginPath();
                    this.ctx.arc(4, -p.radius * 0.6, 7, 0, Math.PI*2);
                    this.ctx.fill();
                    
                    // White X inside the black eye
                    this.ctx.strokeStyle = '#FFF';
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath(); this.ctx.moveTo(1, -p.radius * 0.6 - 3); this.ctx.lineTo(7, -p.radius * 0.6 + 3); this.ctx.stroke();
                    this.ctx.beginPath(); this.ctx.moveTo(7, -p.radius * 0.6 - 3); this.ctx.lineTo(1, -p.radius * 0.6 + 3); this.ctx.stroke();
                    
                    // Stitch line down the face
                    this.ctx.strokeStyle = '#2A1F1D';
                    this.ctx.lineWidth = 1;
                    this.ctx.beginPath(); this.ctx.moveTo(4, -p.radius * 0.6 + 7); this.ctx.lineTo(4, 4); this.ctx.stroke();
                    // Stitch crosses
                    this.ctx.beginPath(); this.ctx.moveTo(2, -p.radius * 0.2); this.ctx.lineTo(6, -p.radius * 0.2 + 2); this.ctx.stroke();
                    this.ctx.beginPath(); this.ctx.moveTo(2, 1); this.ctx.lineTo(6, 3); this.ctx.stroke();

                    // Beak (Grey/Whiteish)
                    this.ctx.fillStyle = '#CFD8DC';
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath();
                    this.ctx.moveTo(2, -p.radius * 0.1);
                    this.ctx.quadraticCurveTo(16, -p.radius * 0.3, 18, p.radius * 0.2);
                    this.ctx.quadraticCurveTo(8, p.radius * 0.5, -2, p.radius * 0.2);
                    this.ctx.closePath();
                    this.ctx.fill(); this.ctx.stroke();

                    // Wing
                    const wingRot = isPigeonThemeMoving ? Math.sin(walkPhase) * 0.2 : 0;
                    this.ctx.save();
                    this.ctx.translate(-4, p.radius * 0.4);
                    this.ctx.rotate(wingRot);
                    this.ctx.fillStyle = '#F5F5F5';
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, 0, 6, 12, Math.PI/6, 0, Math.PI*2);
                    this.ctx.fill(); this.ctx.stroke();
                    this.ctx.restore();
                }

                this.ctx.restore(); // restore body state (flip & tilt)

                // Name label above the goose (Unflipped)
                this.ctx.fillStyle = '#FFFFFF';
                this.ctx.font = 'bold 10px Inter, sans-serif';
                this.ctx.textAlign = 'center';
                this.ctx.fillText(p.localPlayer ? p.localPlayer.label : (p.isAI ? 'BOT' : 'PLAYER'), 0, -p.radius * 2.2);

                this.ctx.restore(); // restore overall player transform
            }

            // Target Indicator Circle below player (like Mario Strikers)
            if (p.localPlayer || (this.config.mapTheme === 'football' && p.team === 'attackers')) {
                this.ctx.strokeStyle = primaryColor;
                this.ctx.lineWidth = 2;
                this.ctx.beginPath(); this.ctx.ellipse(p.x, p.y + p.radius, p.radius + 5, (p.radius + 5) * 0.5, 0, 0, Math.PI*2); this.ctx.stroke();
            }

            // Ice Freeze Effect
            if (isEMP) {
                this.ctx.fillStyle = 'rgba(164, 245, 255, 0.5)';
                this.ctx.strokeStyle = '#00BFFF';
                this.ctx.lineWidth = 3;
                const iceW = p.radius * 2.6;
                const iceH = p.radius * 3.2;
                
                this.ctx.beginPath();
                this.ctx.roundRect(p.x - iceW/2, p.y - iceH/2 + 2, iceW, iceH, 8);
                this.ctx.fill();
                this.ctx.stroke();

                // Ice reflection shine
                this.ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.moveTo(p.x - iceW/2 + 6, p.y - iceH/2 + 8);
                this.ctx.lineTo(p.x - iceW/2 + 14, p.y - iceH/2 + 8);
                this.ctx.stroke();
                
                // Ice cold particles or frost text
                this.ctx.fillStyle = '#00BFFF';
                this.ctx.font = 'bold 10px "Inter", sans-serif';
                this.ctx.textAlign = 'center';
                this.ctx.fillText('FROZEN', p.x, p.y + iceH/2 + 14);

                if (p.unfreezeTimer > 0) {
                    const progress = p.unfreezeTimer / 3;
                    const barWidth = 40;
                    const barHeight = 8;
                    const barY = p.y + iceH/2 + 20;
                    
                    this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
                    this.ctx.beginPath();
                    this.ctx.roundRect(p.x - barWidth/2, barY, barWidth, barHeight, 4);
                    this.ctx.fill();
                    
                    this.ctx.fillStyle = '#00FF00';
                    this.ctx.beginPath();
                    this.ctx.roundRect(p.x - barWidth/2 + 1, barY + 1, Math.max(0, (barWidth - 2) * progress), barHeight - 2, 3);
                    this.ctx.fill();
                }
            }

            let badgeY = p.y - p.radius - 20;
            if (this.config.mapTheme === 'football') {
                badgeY = p.y - 75; // Account for 1.8x character scaling
            } else if (this.config.mapTheme === 'duck') {
                badgeY = p.y - p.radius - 25; // Duck huge heads
            }

            const drawBadge = (text: string, bgColor: string, textColor: string) => {
                this.ctx.font = 'bold 10px "Inter", sans-serif';
                const textWidth = this.ctx.measureText(text).width;
                const px = p.x;
                const py = badgeY;
                
                // Background
                this.ctx.fillStyle = bgColor;
                this.ctx.beginPath();
                this.ctx.roundRect(px - textWidth/2 - 6, py - 14, textWidth + 12, 18, 4);
                this.ctx.fill();
                
                // Pointer arrow down
                this.ctx.beginPath();
                this.ctx.moveTo(px - 4, py + 4);
                this.ctx.lineTo(px + 4, py + 4);
                this.ctx.lineTo(px, py + 8);
                this.ctx.fill();

                // Text
                this.ctx.fillStyle = textColor;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(text, px, py - 4);
            };

            if (!p.isAI) {
                if (p.localPlayer) {
                    const label = p.localPlayer.label.toUpperCase();
                    drawBadge(label, primaryColor, '#FFFFFF');
                }
                
                // Throw Trajectory
                if (p.team === 'defenders') {
                    const input = this.getInputState(p);
                    if (input.isMouseDown && !input.usingGamepad) {
                        this.ctx.beginPath(); 
                        this.ctx.moveTo(p.x, p.y); 
                        let targetX = p.x + input.lastMoveX * 200;
                        let targetY = p.y + input.lastMoveY * 200;
                        
                        this.ctx.lineTo(targetX, targetY);
                        this.ctx.strokeStyle = '#FF1744'; 
                        this.ctx.lineWidth = 2;
                        this.ctx.setLineDash([8, 8]); 
                        this.ctx.stroke(); 
                        this.ctx.setLineDash([]);
                        
                        // Target crosshair
                        this.ctx.beginPath(); this.ctx.arc(targetX, targetY, 5, 0, Math.PI*2); this.ctx.stroke();
                    }
                }
            } else {
                drawBadge('AI', 'rgba(0,0,0,0.6)', '#FFFFFF');
            }

            // Invincibility Frames Effect
            if (p.iFrames > 0) { 
                this.ctx.strokeStyle = 'rgba(255,255,255,0.8)'; this.ctx.lineWidth = 2; 
                this.ctx.setLineDash([4, 4]); this.ctx.beginPath(); this.ctx.arc(p.x, p.y, p.radius + 6, 0, Math.PI * 2); this.ctx.stroke(); this.ctx.setLineDash([]);
            }
            
            // Carrying Item Visual
            if (p.carryingItem) { 
                if (this.config.mapTheme === 'football') {
                    // Holding a small soccer ball (Dribbling by the foot)
                    this.ctx.fillStyle = '#FFFFFF'; 
                    this.ctx.strokeStyle = '#000000';
                    this.ctx.lineWidth = 1;
                    
                    // Position by the foot: slightly ahead in faceDir, and down near y + 14
                    let cx = p.x + (12 * p.faceDir); 
                    let cy = p.y + 14; 
                    
                    // Add dribble bounce effect
                    cy += Math.abs(Math.sin(performance.now() / 150)) * 6 - 3;
                    
                    this.ctx.beginPath();
                    this.ctx.arc(cx, cy, p.carryingItem.radius, 0, Math.PI*2);
                    this.ctx.fill();
                    this.ctx.stroke();

                    this.ctx.fillStyle = '#000000';
                    this.ctx.beginPath(); this.ctx.arc(cx, cy, p.carryingItem.radius * 0.4, 0, Math.PI*2); this.ctx.fill();
                } else if (this.config.mapTheme === 'duck') {
                    // Holding a Wrench
                    let cx = p.x + (8 * p.faceDir); 
                    let cy = p.y;
                    
                    this.ctx.save();
                    this.ctx.translate(cx, cy);
                    // Slight tilt forward based on face dir
                    this.ctx.rotate(p.faceDir * Math.PI / 6 + Math.sin(performance.now() / 200) * 0.2); 
                    
                    const r = p.carryingItem.radius;
                    
                    // Wrench base
                    this.ctx.fillStyle = '#95A5A6'; // Silver
                    this.ctx.strokeStyle = '#2C3E50'; // Dark outline
                    this.ctx.lineWidth = 1.5;
                    
                    // Handle
                    this.ctx.fillRect(-2, -r * 0.6, 4, r * 1.8);
                    this.ctx.strokeRect(-2, -r * 0.6, 4, r * 1.8);
                    
                    // Top crescent (U shape)
                    this.ctx.beginPath();
                    this.ctx.arc(0, -r * 0.6, 5, Math.PI, 0);
                    this.ctx.lineTo(2, -r * 0.6 - 5);
                    this.ctx.lineTo(-2, -r * 0.6 - 5);
                    this.ctx.closePath();
                    this.ctx.stroke();
                    this.ctx.beginPath();
                    this.ctx.arc(0, -r * 0.6, 5, Math.PI, 0);
                    this.ctx.arc(0, -r * 0.6, 2, 0, Math.PI, true);
                    this.ctx.closePath();
                    this.ctx.fill();

                    // Bottom ring (circle with a hole)
                    this.ctx.beginPath();
                    this.ctx.arc(0, r * 1.2, 4, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.stroke();
                    
                    // Inner hole
                    this.ctx.fillStyle = this.config.mapTheme === 'duck' ? '#EBB778' : '#000'; // Match background
                    this.ctx.beginPath();
                    this.ctx.arc(0, r * 1.2, 1.5, 0, Math.PI * 2);
                    this.ctx.fill();
                    
                    this.ctx.restore();
                } else {
                    // Holding a Carrot
                    let cx = p.x; let cy = p.y - p.radius - 8;
                    
                    this.ctx.fillStyle = '#E67E22';
                    this.ctx.beginPath();
                    this.ctx.moveTo(cx - 3, cy - p.carryingItem.radius);
                    this.ctx.lineTo(cx + 3, cy - p.carryingItem.radius);
                    this.ctx.lineTo(cx, cy + p.carryingItem.radius);
                    this.ctx.closePath();
                    this.ctx.fill();
                    this.ctx.strokeStyle = '#D35400';
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();

                    // Leaves
                    this.ctx.fillStyle = '#2ECC71';
                    this.ctx.beginPath();
                    this.ctx.moveTo(cx, cy - p.carryingItem.radius);
                    this.ctx.lineTo(cx - 5, cy - p.carryingItem.radius - 6);
                    this.ctx.lineTo(cx + 5, cy - p.carryingItem.radius - 6);
                    this.ctx.closePath();
                    this.ctx.fill();
                }
            }
        });

        // The Ball (Actually representing a very large thrown seed/projectile in this context, or bread chunk)
        
        // Draw Ball Trail
        if (this.ball.trail.length > 0) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.ball.trail[0].x, this.ball.trail[0].y - this.ball.trail[0].z);
            for (let i = 1; i < this.ball.trail.length; i++) {
                this.ctx.lineTo(this.ball.trail[i].x, this.ball.trail[i].y - this.ball.trail[i].z);
            }
            this.ctx.lineTo(this.ball.x, this.ball.y - this.ball.z);
            const trailAlpha = this.ball.trail[0].alpha;
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${trailAlpha * 0.5})`;
            this.ctx.lineWidth = this.ball.radius * 0.8;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.stroke();
        }

        const shadowScale = Math.max(0.3, 1 - (this.ball.z / 200));
        this.drawShadow(this.ball.x, this.ball.y, this.ball.radius * shadowScale, (this.ball.radius * 0.6) * shadowScale);

        const ballRenderY = this.ball.y - this.ball.z;
        
        if (this.config.mapTheme === 'football') {
            // Football theme ball (Classic Soccer Ball pattern)
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.beginPath(); this.ctx.arc(this.ball.x, ballRenderY, this.ball.radius, 0, Math.PI * 2); this.ctx.fill();
            
            // Simple soccer pentagon/hexagon pattern approximation
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
            
            this.ctx.fillStyle = '#000000';
            this.ctx.beginPath(); this.ctx.arc(this.ball.x, ballRenderY, this.ball.radius * 0.3, 0, Math.PI*2); this.ctx.fill();
            
            const numSpots = 5;
            for(let i=0; i<numSpots; i++){
                const angle = (Math.PI*2/numSpots) * i;
                const spotX = this.ball.x + Math.cos(angle) * this.ball.radius * 0.7;
                const spotY = ballRenderY + Math.sin(angle) * this.ball.radius * 0.7;
                
                this.ctx.beginPath();
                this.ctx.moveTo(this.ball.x, ballRenderY);
                this.ctx.lineTo(spotX, spotY);
                this.ctx.stroke();
                
                this.ctx.beginPath();
                this.ctx.arc(spotX, spotY, this.ball.radius * 0.2, 0, Math.PI*2);
                this.ctx.fill();
            }
        } else if (this.config.mapTheme === 'duck') {
            // Car Tire / Wheel
            // Tire rubber
            this.ctx.fillStyle = '#1C2833'; 
            this.ctx.beginPath(); 
            this.ctx.arc(this.ball.x, ballRenderY, this.ball.radius, 0, Math.PI * 2); 
            this.ctx.fill();
            this.ctx.strokeStyle = '#111111';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Inner rim (metallic)
            this.ctx.fillStyle = '#95A5A6';
            this.ctx.beginPath(); 
            this.ctx.arc(this.ball.x, ballRenderY, this.ball.radius * 0.6, 0, Math.PI * 2); 
            this.ctx.fill();
            this.ctx.strokeStyle = '#7F8C8D';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();

            // Center hub
            this.ctx.fillStyle = '#2C3E50';
            this.ctx.beginPath(); 
            this.ctx.arc(this.ball.x, ballRenderY, this.ball.radius * 0.2, 0, Math.PI * 2); 
            this.ctx.fill();
            
            // Lug nuts (small dots)
            this.ctx.fillStyle = '#FDFEFE';
            for (let i = 0; i < 5; i++) {
                const angle = (Math.PI * 2 / 5) * i;
                const nutX = this.ball.x + Math.cos(angle) * this.ball.radius * 0.4;
                const nutY = ballRenderY + Math.sin(angle) * this.ball.radius * 0.4;
                this.ctx.beginPath();
                this.ctx.arc(nutX, nutY, 1.5, 0, Math.PI*2);
                this.ctx.fill();
            }
        } else {
            // Pumpkin Projectile (Farm theme)
            this.ctx.translate(this.ball.x, ballRenderY);
            let rot = this.ball.z * 0.1; 
            this.ctx.rotate(rot);

            // Pumpkin Body (Orange)
            this.ctx.fillStyle = '#D35400';
            this.ctx.beginPath(); 
            this.ctx.ellipse(0, 0, this.ball.radius * 1.1, this.ball.radius * 0.9, 0, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.strokeStyle = '#A04000';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Pumpkin Ridges
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, this.ball.radius * 0.7, this.ball.radius * 0.9, 0, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, this.ball.radius * 0.3, this.ball.radius * 0.9, 0, 0, Math.PI * 2);
            this.ctx.stroke();

            // Pumpkin Stem
            this.ctx.fillStyle = '#27AE60';
            this.ctx.beginPath();
            this.ctx.moveTo(-2, -this.ball.radius * 0.8);
            this.ctx.lineTo(2, -this.ball.radius * 0.8);
            this.ctx.lineTo(4, -this.ball.radius * 1.3);
            this.ctx.lineTo(0, -this.ball.radius * 1.3);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();

            this.ctx.rotate(-rot);
            this.ctx.translate(-this.ball.x, -ballRenderY);
        }
        this.drawParticles();
    }

    drawShadow(x: number, y: number, rx: number, ry: number, alpha: number = 0.3) {
        this.ctx.save();
        this.ctx.fillStyle = `rgba(0,0,0,${alpha})`;
        this.ctx.filter = 'blur(4px)';
        this.ctx.beginPath();
        this.ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
    }

    drawParticles() {
        this.particles.forEach(p => {
            const alpha = Math.max(0, p.life / p.maxLife);
            this.ctx.globalAlpha = alpha;
            this.ctx.fillStyle = p.color;
            this.ctx.beginPath();
            if (p.type === 'snow') {
                // Snowflakes are squares or circles
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            } else if (p.type === 'firework') {
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            } else if (p.type === 'spark') {
                this.ctx.rect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
            } else if (p.type === 'dust') {
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            }
            this.ctx.fill();
        });
        this.ctx.globalAlpha = 1;
    }

    drawPigeonMap() {
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        
        // Base grass background
        this.ctx.fillStyle = '#A4D373'; // Farm grass green
        this.ctx.fillRect(0, 0, cw, ch);
        
        // Grass texture (small darker grass shapes)
        this.ctx.fillStyle = '#8CBA5E';
        for(let i=10; i<cw; i+=40) {
            for(let j=10; j<ch; j+=40) {
                if((i+j) % 3 === 0) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(i, j);
                    this.ctx.lineTo(i - 4, j - 6);
                    this.ctx.lineTo(i - 2, j);
                    this.ctx.lineTo(i + 4, j - 8);
                    this.ctx.lineTo(i + 2, j);
                    this.ctx.fill();
                }
            }
        }

        // Top Dirt Path branching out
        this.ctx.fillStyle = '#D4B886'; // Dirt/Sand
        this.ctx.beginPath();
        this.ctx.moveTo(cw/2 - 40, 0);
        this.ctx.lineTo(cw/2 + 40, 0);
        this.ctx.bezierCurveTo(cw/2 + 40, 40, cw/2 + 80, 50, cw/2 + 100, 60);
        this.ctx.lineTo(cw/2 - 100, 60);
        this.ctx.bezierCurveTo(cw/2 - 80, 50, cw/2 - 40, 40, cw/2 - 40, 0);
        this.ctx.fill();

        // Main Dirt Play Area
        this.ctx.fillStyle = '#D4B886';
        this.ctx.beginPath();
        this.ctx.roundRect(40, 40, cw - 80, ch - 80, 20);
        this.ctx.fill();
        
        // Dirt area shadow/border
        this.ctx.strokeStyle = '#BCA375';
        this.ctx.lineWidth = 4;
        this.ctx.beginPath();
        this.ctx.roundRect(40, 40, cw - 80, ch - 80, 20);
        this.ctx.stroke();

        // Sand scattered marks
        this.ctx.strokeStyle = '#CDB17F';
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';
        for(let i=60; i<cw-60; i+=80) {
            for(let j=60; j<ch-60; j+=70) {
                if((i+j) % 2 === 0) {
                    this.ctx.beginPath(); 
                    this.ctx.moveTo(i, j); 
                    this.ctx.quadraticCurveTo(i + 5, j - 5, i + 10, j); 
                    this.ctx.stroke();
                }
            }
        }

        // Draw Windmill (Top Center)
        const wx = cw/2, wy = 25;
        // House base
        this.ctx.fillStyle = '#8B5A2B';
        this.ctx.beginPath(); this.ctx.moveTo(wx - 25, wy + 20); this.ctx.lineTo(wx + 25, wy + 20); 
        this.ctx.lineTo(wx + 15, wy - 15); this.ctx.lineTo(wx - 15, wy - 15); this.ctx.fill();
        // Roof
        this.ctx.fillStyle = '#C0392B';
        this.ctx.beginPath(); this.ctx.moveTo(wx - 20, wy - 15); this.ctx.lineTo(wx + 20, wy - 15); this.ctx.lineTo(wx, wy - 30); this.ctx.fill();
        // Door
        this.ctx.fillStyle = '#5CA4FF';
        this.ctx.fillRect(wx - 6, wy + 8, 12, 12);
        // Sails (Animated)
        const rot = performance.now() / 1000;
        this.ctx.translate(wx, wy - 10);
        this.ctx.rotate(rot);
        this.ctx.fillStyle = '#E3D7A3';
        this.ctx.strokeStyle = '#C4B47C';
        this.ctx.lineWidth = 2;
        for(let i=0; i<4; i++) {
            this.ctx.rotate(Math.PI/2);
            this.ctx.beginPath(); this.ctx.moveTo(0,0); this.ctx.lineTo(5, 10); this.ctx.lineTo(5, 30); this.ctx.lineTo(-5, 30); this.ctx.lineTo(-5, 10); this.ctx.fill(); this.ctx.stroke();
            this.ctx.fillStyle = '#D66B5A'; // small red detail on sail
            this.ctx.fillRect(-2, 20, 4, 8);
            this.ctx.fillStyle = '#E3D7A3';
        }
        this.ctx.rotate(-rot - Math.PI*2); // reset rotate
        this.ctx.translate(-wx, -(wy - 10));
        // Hub
        this.ctx.fillStyle = '#A0522D';
        this.ctx.beginPath(); this.ctx.arc(wx, wy - 10, 4, 0, Math.PI*2); this.ctx.fill();

        // Simple Trees scattered around border
        const drawTree = (tx: number, ty: number, scale: number = 1) => {
            this.drawShadow(tx, ty + 10, 15*scale, 5*scale, 0.2); // shadow
            this.ctx.fillStyle = '#8B5A2B'; this.ctx.fillRect(tx - 3*scale, ty, 6*scale, 10*scale); // trunk
            this.ctx.fillStyle = '#388E3C';
            this.ctx.beginPath(); this.ctx.moveTo(tx, ty - 30*scale); this.ctx.lineTo(tx + 20*scale, ty + 5*scale); this.ctx.lineTo(tx - 20*scale, ty + 5*scale); this.ctx.fill();
            this.ctx.fillStyle = '#2E7D32';
            this.ctx.beginPath(); this.ctx.moveTo(tx, ty - 30*scale); this.ctx.lineTo(tx + 20*scale, ty + 5*scale); this.ctx.lineTo(tx, ty + 5*scale); this.ctx.fill();
        };

        drawTree(25, 60, 1.2); drawTree(20, 150, 0.9); drawTree(28, ch - 80, 1.1);
        drawTree(cw - 25, 80, 1); drawTree(cw - 15, 250, 1.3); drawTree(cw - 20, ch - 120, 0.8);
        drawTree(100, 25); drawTree(cw - 100, 20, 1.2);

        // Wooden fence at bottom
        this.ctx.fillStyle = '#A0522D';
        this.ctx.strokeStyle = '#8B4513';
        this.ctx.lineWidth = 2;
        for(let i=0; i<cw; i+=60) {
            this.ctx.fillRect(i + 25, ch - 35, 10, 25);
            this.ctx.strokeRect(i + 25, ch - 35, 10, 25);
            if (i < cw - 60) {
                this.ctx.fillRect(i + 35, ch - 25, 50, 6);
                this.ctx.strokeRect(i + 35, ch - 25, 50, 6);
            }
        }

        // Center line (Subtle dirt path divider)
        this.ctx.strokeStyle = 'rgba(0,0,0,0.05)';
        this.ctx.lineWidth = 10;
        this.ctx.beginPath(); this.ctx.moveTo(cw/2, 40); this.ctx.lineTo(cw/2, ch-40); this.ctx.stroke();

        // Delivery Zones (Farming Plots)
        this.zones.forEach(z => {
            const zcx = z.x + z.w/2;
            const zcy = z.y + z.h/2;
            
            // Dirt Plot
            this.ctx.fillStyle = '#6D4C41';
            this.ctx.beginPath(); this.ctx.roundRect(z.x, z.y, z.w, z.h, 8); this.ctx.fill();
            this.ctx.strokeStyle = '#5D4037';
            this.ctx.lineWidth = 3; this.ctx.strokeRect(z.x, z.y, z.w, z.h);

            // Furrows
            this.ctx.strokeStyle = '#4E342E';
            this.ctx.lineWidth = 2;
            for(let i=10; i<z.w; i+=15) {
                this.ctx.beginPath(); this.ctx.moveTo(z.x+i, z.y + 5); this.ctx.lineTo(z.x+i, z.y+z.h - 5); this.ctx.stroke();
            }
            
            if (z.plantedTime) {
                const age = performance.now() - z.plantedTime;
                
                // Dust particles on plant
                if (age < 500) {
                    this.ctx.globalAlpha = 1 - (age / 500); // fade out over time
                    this.ctx.fillStyle = '#D3A982'; // Light dust/soil color
                    for (let p = 0; p < 8; p++) {
                        const angle = p * (Math.PI * 2 / 8) + (age * 0.005);
                        const dist = age * 0.08;
                        const px = zcx + Math.cos(angle) * dist;
                        const py = zcy + Math.sin(angle) * dist - (age * 0.05); // slightly move upwards
                        
                        this.ctx.beginPath(); 
                        this.ctx.arc(px, py, Math.max(0, 5 - (age / 100)), 0, Math.PI*2); 
                        this.ctx.fill();
                    }
                    this.ctx.globalAlpha = 1.0;
                }
            }

            if (z.hasItem) {
                // Grow little carrots/plants with animation
                let scale = 1;
                let yOffset = 0;
                
                if (z.plantedTime) {
                    const age = performance.now() - z.plantedTime;
                    if (age < 500) {
                        // Pop up animation (0 to 1 with elastic overshoot)
                        const t = age / 500;
                        scale = Math.sin(t * Math.PI) * 1.2; // overshoot
                        yOffset = -Math.sin(t * Math.PI * 0.5) * 15; // spring up
                    } else {
                        // gentle idle sway
                        scale = 1 + Math.sin((performance.now() - z.plantedTime)/300) * 0.05;
                    }
                }

                this.ctx.save();
                this.ctx.translate(zcx, zcy + yOffset);
                this.ctx.scale(scale, scale);

                this.ctx.fillStyle = '#E67E22'; // carrot orange
                this.ctx.beginPath(); this.ctx.moveTo(-5, 0); this.ctx.lineTo(5, 0); this.ctx.lineTo(0, 15); this.ctx.fill();
                this.ctx.fillStyle = '#2ECC71'; // leaves
                this.ctx.beginPath(); this.ctx.moveTo(0, 0); this.ctx.lineTo(-8, -10); this.ctx.lineTo(8, -10); this.ctx.fill();
                
                this.ctx.restore();
            }
        });

        // Walls (Hay Bales)
        this.walls.forEach(w => { 
            this.ctx.save(); this.ctx.fillStyle = 'rgba(0,0,0,0.3)'; this.ctx.filter = 'blur(4px)'; this.ctx.fillRect(w.x + 4, w.y + 8, w.w, w.h); this.ctx.restore();
            this.ctx.fillStyle = '#F4D03F'; this.ctx.fillRect(w.x, w.y, w.w, w.h); 
            this.ctx.strokeStyle = '#D4AC0D'; this.ctx.lineWidth = 2; this.ctx.strokeRect(w.x, w.y, w.w, w.h); 
            // Hay lines
            this.ctx.beginPath(); this.ctx.moveTo(w.x, w.y + w.h/2); this.ctx.lineTo(w.x + w.w, w.y + w.h/2); this.ctx.stroke();
            this.ctx.beginPath(); this.ctx.moveTo(w.x + w.w/3, w.y); this.ctx.lineTo(w.x + w.w/3, w.y + w.h); this.ctx.stroke();
            this.ctx.beginPath(); this.ctx.moveTo(w.x + (w.w*2)/3, w.y); this.ctx.lineTo(w.x + (w.w*2)/3, w.y + w.h); this.ctx.stroke();
        });
        
        // Pillars (Wooden Stumps)
        this.pillars.forEach(p => { 
            this.drawShadow(p.x + 4, p.y + 6, p.r, p.r, 0.3);
            this.ctx.fillStyle = '#A0522D'; this.ctx.beginPath(); this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); this.ctx.fill(); 
            this.ctx.strokeStyle = '#8B4513'; this.ctx.lineWidth = 3; this.ctx.stroke(); 
             // Tree rings
            this.ctx.strokeStyle = '#CD853F'; this.ctx.lineWidth = 1;
            this.ctx.beginPath(); this.ctx.arc(p.x, p.y, p.r * 0.6, 0, Math.PI * 2); this.ctx.stroke();
            this.ctx.beginPath(); this.ctx.arc(p.x, p.y, p.r * 0.3, 0, Math.PI * 2); this.ctx.stroke();
        });
    }

    drawFootballMap() {
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        // Bright Pitch Background, but pigeon / park themed
        this.ctx.fillStyle = '#2fb032'; this.ctx.fillRect(0, 0, cw, ch);
        
        // Alternating Grass Stripes
        this.ctx.fillStyle = '#37c23a';
        for (let i = 0; i < cw; i += cw*0.066) {
            this.ctx.fillRect(i, 0, cw*0.033, ch);
        }

        // Pitch Markings
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.lineWidth = 4;
        this.ctx.beginPath();
        // Outer bounds
        this.ctx.strokeRect(cw*0.025, ch*0.0375, cw - cw*0.05, ch - ch*0.075);
        // Halfway line
        this.ctx.moveTo(cw / 2, ch*0.0375);
        this.ctx.lineTo(cw / 2, ch - ch*0.0375);
        // Center circle
        this.ctx.moveTo(cw / 2 + cw*0.083, ch / 2);
        this.ctx.arc(cw / 2, ch / 2, cw*0.083, 0, Math.PI * 2);
        // Penalty areas
        this.ctx.strokeRect(cw*0.025, ch/2 - ch*0.187, cw*0.125, ch*0.375); // Left area
        this.ctx.strokeRect(cw - cw*0.15, ch/2 - ch*0.187, cw*0.125, ch*0.375); // Right area
        
        // Goal areas
        this.ctx.strokeRect(cw*0.025, ch/2 - ch*0.075, cw*0.05, ch*0.15); // Left goal area
        this.ctx.strokeRect(cw - cw*0.075, ch/2 - ch*0.075, cw*0.05, ch*0.15); // Right goal area
        
        this.ctx.stroke();

        // Center dot
        this.ctx.beginPath();
        this.ctx.arc(cw / 2, ch / 2, cw*0.005, 0, Math.PI * 2);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fill();

        // Delivery/Target Zones - Football mats
        this.zones.forEach(z => {
            this.ctx.fillStyle = z.hasItem ? 'rgba(255, 234, 0, 0.4)' : 'rgba(255,255,255,0.2)';
            this.ctx.strokeStyle = z.hasItem ? '#FFEA00' : '#FFFFFF';
            this.ctx.lineWidth = 4; 
            
            // Draw zone base - rounded rect
            this.ctx.beginPath();
            this.ctx.roundRect(z.x, z.y, z.w, z.h, 15);
            this.ctx.fill();
            this.ctx.stroke();

            // Inner checkerboard / pattern
            this.ctx.strokeStyle = z.hasItem ? 'rgba(255,234,0,0.5)' : 'rgba(255,255,255,0.3)';
            this.ctx.lineWidth = 2;
            for(let i=10; i<z.w; i+=20) {
                this.ctx.beginPath(); this.ctx.moveTo(z.x+i, z.y); this.ctx.lineTo(z.x+i, z.y+z.h); this.ctx.stroke();
            }
            
            if (z.hasItem) {
                // Goal scored indicator
                this.ctx.fillStyle = '#FFEA00';
                this.ctx.beginPath();
                this.ctx.arc(z.x + z.w/2, z.y + z.h/2, 12, 0, Math.PI*2);
                this.ctx.fill();
            }
        });

        // Arena Bumpers (Walls/Pillars) - Stadium Barricades
        this.ctx.fillStyle = '#E74C3C'; // Red brick/barrier
        this.ctx.strokeStyle = '#C0392B'; 
        this.ctx.lineWidth = 3;
        this.walls.forEach(w => { 
            // Shadow
            this.ctx.save(); this.ctx.fillStyle = 'rgba(0,0,0,0.4)'; this.ctx.filter = 'blur(4px)'; this.ctx.fillRect(w.x + 4, w.y + 10, w.w, w.h); this.ctx.restore();
            
            // Base Barrier
            this.ctx.fillStyle = '#E74C3C';
            this.ctx.fillRect(w.x, w.y, w.w, w.h); 
            this.ctx.strokeRect(w.x, w.y, w.w, w.h); 

            // Barrier details (stripes)
            this.ctx.fillStyle = '#F1C40F';
            for (let i = 0; i < w.w; i += 20) {
                 this.ctx.fillRect(w.x + i, w.y, 10, w.h);
            }
        });
        
        this.pillars.forEach(p => { 
            // Pillar Shadow
            this.drawShadow(p.x + 4, p.y + 10, p.r, p.r, 0.4);
            
            // Base Pillar (Barrel/Cone)
            const grad = this.ctx.createRadialGradient(p.x - p.r/3, p.y - p.r/3, p.r/4, p.x, p.y, p.r);
            grad.addColorStop(0, '#E67E22');
            grad.addColorStop(1, '#D35400');
            
            this.ctx.fillStyle = grad;
            this.ctx.strokeStyle = '#A04000';
            this.ctx.lineWidth = 3;
            
            this.ctx.beginPath(); this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); this.ctx.fill(); this.ctx.stroke(); 

            // Inner circle detail
            this.ctx.fillStyle = '#F39C12';
            this.ctx.beginPath(); this.ctx.arc(p.x, p.y, p.r/2, 0, Math.PI * 2); this.ctx.fill(); this.ctx.stroke(); 
        });
    }

    drawDuckMap() {
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        // Low Poly Desert Racing Theme
        this.ctx.fillStyle = '#EBB778'; // Sand background
        this.ctx.fillRect(0, 0, cw, ch);

        // Asphalt Track (Oval pattern)
        this.ctx.fillStyle = '#424949';
        this.ctx.beginPath();
        this.ctx.roundRect(cw*0.1, ch*0.1, cw*0.8, ch*0.8, 100);
        this.ctx.fill();

        // Inner Sand
        this.ctx.fillStyle = '#EBB778';
        this.ctx.beginPath();
        this.ctx.roundRect(cw*0.25, ch*0.25, cw*0.5, ch*0.5, 50);
        this.ctx.fill();

        // Red/White Curbs (Track borders)
        this.ctx.lineWidth = 10;
        
        // Outer border Stripes
        this.ctx.setLineDash([20, 20]);
        this.ctx.lineDashOffset = 0;
        this.ctx.strokeStyle = '#E74C3C';
        this.ctx.beginPath(); this.ctx.roundRect(cw*0.08, ch*0.08, cw*0.84, ch*0.84, 110); this.ctx.stroke();
        
        this.ctx.lineDashOffset = 20;
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.beginPath(); this.ctx.roundRect(cw*0.08, ch*0.08, cw*0.84, ch*0.84, 110); this.ctx.stroke();

        // Inner border Stripes
        this.ctx.setLineDash([15, 15]);
        this.ctx.lineDashOffset = 0;
        this.ctx.strokeStyle = '#E74C3C';
        this.ctx.beginPath(); this.ctx.roundRect(cw*0.23, ch*0.23, cw*0.54, ch*0.54, 60); this.ctx.stroke();
        
        this.ctx.lineDashOffset = 15;
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.beginPath(); this.ctx.roundRect(cw*0.23, ch*0.23, cw*0.54, ch*0.54, 60); this.ctx.stroke();

        this.ctx.setLineDash([]); // Reset dash

        // Low Poly Trees (triangles)
        const drawTree = (tx: number, ty: number, scale: number = 1) => {
            // Shadow
            this.ctx.fillStyle = 'rgba(0,0,0,0.2)';
            this.ctx.beginPath(); this.ctx.ellipse(tx + 5*scale, ty + 10*scale, 10*scale, 5*scale, 0, 0, Math.PI*2); this.ctx.fill();
            
            // Light Green side
            this.ctx.fillStyle = '#2ECC71';
            this.ctx.beginPath(); this.ctx.moveTo(tx, ty - 25*scale); this.ctx.lineTo(tx + 12*scale, ty + 10*scale); this.ctx.lineTo(tx - 12*scale, ty + 10*scale); this.ctx.fill();
            
            // Dark Green side (shadow)
            this.ctx.fillStyle = '#27AE60';
            this.ctx.beginPath(); this.ctx.moveTo(tx, ty - 25*scale); this.ctx.lineTo(tx + 12*scale, ty + 10*scale); this.ctx.lineTo(tx, ty + 10*scale); this.ctx.fill();
            
            // Trunk
            this.ctx.fillStyle = '#8D6E63';
            this.ctx.fillRect(tx - 3*scale, ty + 10*scale, 6*scale, 8*scale);
        };

        drawTree(cw*0.05, ch*0.1);
        drawTree(cw*0.95, ch*0.1, 1.2);
        drawTree(cw*0.05, ch*0.9, 0.8);
        drawTree(cw*0.95, ch*0.9);
        drawTree(cw*0.5, ch*0.35, 1.5);
        drawTree(cw*0.5, ch*0.65, 1.3);

        // Target Zones (Starting/Finish Lines Tents)
        this.zones.forEach(z => {
            // Draw checkered background (White/Grey for contrast)
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.fillRect(z.x, z.y, z.w, z.h);
            
            this.ctx.fillStyle = '#95A5A6';
            for(let ix=0; ix<z.w; ix+=15) {
                for(let iy=0; iy<z.h; iy+=15) {
                    if ((Math.floor(ix/15) + Math.floor(iy/15)) % 2 === 0) {
                        this.ctx.fillRect(z.x + ix, z.y + iy, 15, 15);
                    }
                }
            }
            
            // Outline
            this.ctx.strokeStyle = '#1A252F';
            this.ctx.lineWidth = 4;
            this.ctx.strokeRect(z.x, z.y, z.w, z.h);

            // Overhead Tent/Arch structure
            this.ctx.fillStyle = z.hasItem ? '#3498DB' : '#E74C3C';
            // Simple generic arch representation 
            this.ctx.fillRect(z.x - 10, z.y - 10, 10, z.h + 20); // Left pillar
            this.ctx.fillRect(z.x + z.w, z.y - 10, 10, z.h + 20); // Right pillar
            this.ctx.fillRect(z.x - 10, z.y - 15, z.w + 20, 15); // Top bar
            this.ctx.fillRect(z.x - 10, z.y + z.h, z.w + 20, 15); // Bottom bar (if needed)

            // Outline for arch parts
            this.ctx.strokeRect(z.x - 10, z.y - 10, 10, z.h + 20);
            this.ctx.strokeRect(z.x + z.w, z.y - 10, 10, z.h + 20);
            this.ctx.strokeRect(z.x - 10, z.y - 15, z.w + 20, 15);
            this.ctx.strokeRect(z.x - 10, z.y + z.h, z.w + 20, 15);
        });

        // Arena Bumpers (Walls/Blocks) - Simple tire piles or low-poly blocks
        this.ctx.fillStyle = '#34495E'; 
        this.ctx.strokeStyle = '#1A252F'; 
        this.ctx.lineWidth = 3;
        this.walls.forEach(w => { 
            // Shadow
            this.ctx.save(); this.ctx.fillStyle = 'rgba(0,0,0,0.3)'; this.ctx.filter = 'blur(4px)'; this.ctx.fillRect(w.x + 4, w.y + 4, w.w, w.h); this.ctx.restore();
            
            // Block
            this.ctx.fillStyle = '#E67E22';
            this.ctx.fillRect(w.x, w.y, w.w, w.h); 
            this.ctx.strokeRect(w.x, w.y, w.w, w.h); 
        });
        
        this.pillars.forEach(p => { 
            // Shadow
            this.drawShadow(p.x + 4, p.y + 4, p.r, p.r, 0.3);
            
            // Tires setup
            this.ctx.fillStyle = '#2C3E50';
            this.ctx.beginPath(); this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); this.ctx.fill(); this.ctx.stroke(); 

            this.ctx.fillStyle = '#1A252F';
            this.ctx.beginPath(); this.ctx.arc(p.x, p.y, p.r * 0.5, 0, Math.PI * 2); this.ctx.fill(); this.ctx.stroke(); 
        });
    }

    dist(p1: {x:number, y:number}, p2: {x:number, y:number}) { return Math.sqrt(Math.pow(p1.x-p2.x,2) + Math.pow(p1.y-p2.y,2)); }
    pointInRect(x: number, y: number, r: Rect) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
    circleRectCollide(cx: number, cy: number, cr: number, rx: number, ry: number, rw: number, rh: number) {
        let testX = cx, testY = cy;
        if (cx < rx) testX = rx; else if (cx > rx + rw) testX = rx + rw;
        if (cy < ry) testY = ry; else if (cy > ry + rh) testY = ry + rh;
        return Math.sqrt(Math.pow(cx - testX, 2) + Math.pow(cy - testY, 2)) <= cr;
    }
}