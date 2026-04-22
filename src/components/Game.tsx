import React, { useEffect, useRef, useState, useMemo } from 'react';
import { GameEngine, GameState, GameConfig, soundManager } from '../game/Engine';
import { networkManager } from '../game/NetworkManager';
import { Trophy, Skull, RefreshCw, ArrowLeft, Play, Home, Settings, Users, Check } from 'lucide-react';

interface GameProps {
    baseConfig: GameConfig;
    totalRounds: number;
    rotateMaps: boolean;
    onBack: () => void;
    onReturnToLobby?: () => void;
    isAllReady?: boolean;
    isClientReady?: boolean;
    onToggleReady?: () => void;
    onClearReady?: () => void;
}

type MatchStatus = 'countdown' | 'playing' | 'round_over' | 'match_over';
type RoundResult = 'none' | 'attackers_win' | 'defenders_win';

export default function Game({ baseConfig, totalRounds, rotateMaps, onBack, onReturnToLobby, isAllReady = true, isClientReady = false, onToggleReady, onClearReady }: GameProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [engine, setEngine] = useState<GameEngine | null>(null);
    const [gameState, setGameState] = useState<GameState>({ status: 'playing', itemsPlaced: 0, attackersAlive: baseConfig.attackers.total, timeLeft: baseConfig.timeLimit });
    
    // Match State
    const [currentRound, setCurrentRound] = useState(1);
    const [scoreTeam1, setScoreTeam1] = useState(0);
    const [scoreTeam2, setScoreTeam2] = useState(0);
    const [matchStatus, setMatchStatus] = useState<MatchStatus>('countdown');
    const [roundResult, setRoundResult] = useState<RoundResult>('none');
    const [countdown, setCountdown] = useState<number | 'GO!' | null>(3);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [matchStats, setMatchStats] = useState<Record<string, { name: string, freezes: number, plants: number, holdTime: number }>>({});
    const matchStatsRef = useRef(matchStats);

    const currentRoundRef = useRef(currentRound);
    const scoreTeam1Ref = useRef(scoreTeam1);
    const scoreTeam2Ref = useRef(scoreTeam2);
    const matchStatusRef = useRef(matchStatus);
    const roundResultRef = useRef(roundResult);
    const countdownRef = useRef(countdown);

    useEffect(() => { 
        matchStatsRef.current = matchStats; 
        currentRoundRef.current = currentRound;
        scoreTeam1Ref.current = scoreTeam1;
        scoreTeam2Ref.current = scoreTeam2;
        matchStatusRef.current = matchStatus;
        roundResultRef.current = roundResult;
        countdownRef.current = countdown;
    }, [matchStats, currentRound, scoreTeam1, scoreTeam2, matchStatus, roundResult, countdown]);

    const isSwapped = currentRound > totalRounds / 2;

    const currentConfig: GameConfig = useMemo(() => {
        let activeConfig = baseConfig;
        
        if (isSwapped) {
            // Swap local players' teams
            const newLocalPlayers = baseConfig.localPlayers.map(p => {
                if (p.team === 'attackers') return { ...p, team: 'defenders' as const };
                if (p.team === 'defenders') return { ...p, team: 'attackers' as const };
                return p;
            });
            activeConfig = {
                ...baseConfig,
                attackers: baseConfig.defenders,
                defenders: baseConfig.attackers,
                localPlayers: newLocalPlayers,
            };
        }

        if (rotateMaps) {
            const themes: ('pigeon' | 'football' | 'duck')[] = ['pigeon', 'football', 'duck'];
            const baseIndex = themes.indexOf(baseConfig.mapTheme || 'pigeon');
            const currentIndex = (baseIndex + currentRound - 1) % themes.length;
            activeConfig = { ...activeConfig, mapTheme: themes[currentIndex] };
        }

        return activeConfig;
    }, [baseConfig, isSwapped, rotateMaps, currentRound]);

    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!canvasRef.current || !containerRef.current) return;
        
        const initGame = () => {
            if (!canvasRef.current || !containerRef.current) return;
            // Only set internal resolution once upon mounting
            if (canvasRef.current.width === 0 || canvasRef.current.height === 0 || canvasRef.current.width === 300) {
                // Determine a good base resolution based on the screen, but then leave it alone.
                canvasRef.current.width = containerRef.current.clientWidth;
                canvasRef.current.height = containerRef.current.clientHeight;
            }

            const newEngine = new GameEngine(canvasRef.current, currentConfig);
            newEngine.onStateChange = (state) => setGameState(state);
            newEngine.onPlayerStat = (playerId, playerName, statType, amount) => {
                setMatchStats(prev => {
                    const stats = prev[playerId] || { name: playerName, freezes: 0, plants: 0, holdTime: 0 };
                    return {
                        ...prev,
                        [playerId]: { ...stats, name: playerName, [statType]: stats[statType] + amount }
                    };
                });
            };
            newEngine.isPaused = true;

            if (networkManager.role === 'client') {
                newEngine.isNetworkClient = true;
                networkManager.onStateReceived = (state) => {
                    newEngine.applyNetworkState(state);
                    setGameState(state.gameState);
                    if (state.matchStats) {
                        setMatchStats(state.matchStats);
                    }
                    if (state.uiState) {
                        setCurrentRound(state.uiState.currentRound);
                        setScoreTeam1(state.uiState.scoreTeam1);
                        setScoreTeam2(state.uiState.scoreTeam2);
                        setMatchStatus(state.uiState.matchStatus as MatchStatus);
                        setRoundResult(state.uiState.roundResult as RoundResult);
                        setCountdown(state.uiState.countdown);
                    }
                };
                const interval = setInterval(() => {
                    currentConfig.localPlayers.forEach(p => {
                        if (p.id === networkManager.peer?.id || p.id.startsWith(`${networkManager.peer?.id}-`)) {
                            const inputPayload: any = { type: 'input', playerId: p.id, keys: newEngine.keys };
                            if (p.gamepadIndex !== undefined && navigator.getGamepads) {
                                const gp = navigator.getGamepads()[p.gamepadIndex];
                                if (gp) {
                                    inputPayload.gamepadAxes = Array.from(gp.axes);
                                    inputPayload.gamepadButtons = gp.buttons.map(b => b.pressed);
                                }
                            }
                            networkManager.sendInputToHost(inputPayload);
                        }
                    });
                }, 33);
                const origStop = newEngine.stop.bind(newEngine);
                newEngine.stop = () => { origStop(); clearInterval(interval); };
            }

            if (networkManager.role === 'host') {
                networkManager.onInputReceived = (input) => {
                    newEngine.networkInputs.set(input.playerId, input);
                };
                const interval = setInterval(() => {
                    const statePayload = {
                        ...newEngine.getNetworkState(),
                        type: 'state' as const,
                        time: performance.now(),
                        matchStats: matchStatsRef.current,
                        uiState: {
                            currentRound: currentRoundRef.current,
                            scoreTeam1: scoreTeam1Ref.current,
                            scoreTeam2: scoreTeam2Ref.current,
                            matchStatus: matchStatusRef.current,
                            roundResult: roundResultRef.current,
                            countdown: countdownRef.current
                        }
                    };
                    networkManager.sendStateToClients(statePayload);
                }, 33);
                const origStop = newEngine.stop.bind(newEngine);
                newEngine.stop = () => { origStop(); clearInterval(interval); };
            }

            newEngine.notifyState();
            newEngine.start();
            setEngine(newEngine);
            return newEngine;
        };

        const currentEngine = initGame();
        
        setMatchStatus('countdown');
        setCountdown(3);

        return () => {
            if (currentEngine) currentEngine.stop();
        };
    }, [currentConfig, currentRound]);

    // Handle Escape key to toggle settings
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (matchStatus === 'playing') {
                    if (isSettingsOpen) {
                        handleCloseSettings();
                    } else {
                        handleOpenSettings();
                    }
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [matchStatus, isSettingsOpen, engine]);

    useEffect(() => {
        if (matchStatus === 'countdown' && countdown !== null) {
            if (typeof countdown === 'number' && countdown > 1) {
                soundManager.playTick();
                const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
                return () => clearTimeout(timer);
            } else if (countdown === 1) {
                soundManager.playTick();
                const timer = setTimeout(() => setCountdown('GO!'), 1000);
                return () => clearTimeout(timer);
            } else if (countdown === 'GO!') {
                soundManager.playStartWhistle();
                const timer = setTimeout(() => {
                    setMatchStatus('playing');
                    if (engine) engine.isPaused = false;
                }, 1000);
                return () => clearTimeout(timer);
            }
        }
    }, [matchStatus, countdown, engine]);

    useEffect(() => {
        if (matchStatus === 'playing') {
            soundManager.startBGM();
        } else {
            soundManager.stopBGM();
        }
        return () => {
            soundManager.stopBGM();
        };
    }, [matchStatus]);

    // Handle round end score calculation
    useEffect(() => {
        if (gameState.status !== 'playing' && matchStatus === 'playing') {
            setRoundResult(gameState.status);
            const attackersWon = gameState.status === 'attackers_win';
            
            // Team 1 started as Attackers (Emerald), Team 2 started as Defenders (Red)
            if (!isSwapped) {
                if (attackersWon) setScoreTeam1(s => s + 1);
                else setScoreTeam2(s => s + 1);
            } else {
                // Roles swapped: Team 1 is Defenders, Team 2 is Attackers
                if (attackersWon) setScoreTeam2(s => s + 1);
                else setScoreTeam1(s => s + 1);
            }

            if (currentRound >= totalRounds) {
                setMatchStatus('match_over');
            } else {
                setMatchStatus('round_over');
            }
            
            soundManager.playWhistle();
        }
    }, [gameState.status, matchStatus, currentRound, totalRounds, isSwapped]);

    const handleNextRound = () => {
        if (currentRound < totalRounds) {
            setGameState(prev => ({...prev, status: 'playing'}));
            setCurrentRound(r => r + 1);
            if (engine) {
                engine.initEntities();
                engine.isPaused = true;
                engine.notifyState();
            }
            setMatchStatus('countdown');
            setCountdown(3);
            if (onClearReady) onClearReady();
        }
    };

    const handleRestartMatch = () => {
        setIsSettingsOpen(false);
        setScoreTeam1(0);
        setScoreTeam2(0);
        setMatchStats({});
        setGameState(prev => ({...prev, status: 'playing'}));
        if (currentRound === 1) {
            // Need to recreate or just init? React's currentRound dependency will re-init game hook above if currentRound changes.
            // If currentRound is ALREADY 1, the hook doesn't re-run. We must do it manually.
            if (engine) {
                engine.isPaused = true;
                engine.initEntities();
                engine.notifyState();
            }
            setMatchStatus('countdown');
            setCountdown(3);
        } else {
            // This triggers the useEffect, recreating the engine anyway.
            setCurrentRound(1);
        }
    };

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const isFootballTheme = baseConfig.mapTheme === 'football';

    const handleOpenSettings = () => {
        setIsSettingsOpen(true);
        if (engine) engine.isPaused = true;
    };

    const handleCloseSettings = () => {
        setIsSettingsOpen(false);
        if (engine && matchStatus === 'playing') engine.isPaused = false;
    };

    // Full screen absolute layout
    const containerClasses = "fixed inset-0 bg-[#3b414a] overflow-hidden select-none"
    
    return (
        <div className={containerClasses} style={{fontFamily: "'Fredoka', 'Comic Sans MS', 'Nunito', sans-serif"}}>
            
            {/* Playable Canvas */}
            <div className="absolute inset-0 w-full h-full" ref={containerRef}>
                <canvas 
                    ref={canvasRef} 
                    className="w-full h-full cursor-crosshair block outline-none"
                />
            </div>

            {/* Overlay HUD - Chunky/Small Style */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-30 pointer-events-none flex flex-col items-center">
                <div className="flex items-center gap-3">
                    {/* Team 1 Score */}
                    <div className="bg-[#E67E22] rounded-xl w-10 h-10 flex flex-col items-center justify-center border-4 border-[#2C3E50] shadow-[0_4px_0_#935116]">
                        <span className="text-white text-xl font-black drop-shadow-md leading-none" style={{WebkitTextStroke: '1px #935116'}}>{!isSwapped ? scoreTeam1 : scoreTeam2}</span>
                    </div>

                    {/* Timer & Round */}
                    <div className="bg-[#2C3E50] rounded-xl px-4 py-1 flex flex-col items-center border-4 border-[#1A252F] shadow-[0_4px_0_#1A252F] min-w-[80px]">
                        <span className="text-[#F1C40F] text-[9px] font-bold uppercase tracking-widest leading-none mb-1">R{currentRound}/{totalRounds}</span>
                        <div className={`text-xl font-black tracking-widest leading-none ${gameState.timeLeft <= 10 ? 'text-[#E74C3C] animate-pulse drop-shadow-[0_0_8px_#E74C3C]' : 'text-white'}`}>
                            {formatTime(gameState.timeLeft)}
                        </div>
                    </div>

                    {/* Team 2 Score */}
                    <div className="bg-[#3498DB] rounded-xl w-10 h-10 flex flex-col items-center justify-center border-4 border-[#2C3E50] shadow-[0_4px_0_#1F618D]">
                        <span className="text-white text-xl font-black drop-shadow-md leading-none" style={{WebkitTextStroke: '1px #1F618D'}}>{!isSwapped ? scoreTeam2 : scoreTeam1}</span>
                    </div>
                </div>
                
                {/* Visual Objective Counter */}
                <div className="mt-2 flex gap-1 bg-[#2C3E50] px-2 py-1 rounded-full border-4 border-[#1A252F] shadow-[0_4px_0_#1A252F]">
                    {[1, 2, 3, 4, 5].map((item) => (
                        <div key={item} className={`w-3 h-2 rounded-full transition-all duration-500 border-2 ${item <= gameState.itemsPlaced ? 'bg-[#F1C40F] border-[#D4AC0D] shadow-[0_0_8px_#F1C40F]' : 'bg-[#1A252F] border-[#1A252F]'}`} />
                    ))}
                </div>
            </div>

            {/* Top Right - Settings Button */}
            <div className="absolute top-4 right-4 z-40">
                <button 
                    onClick={handleOpenSettings}
                    className="p-2 bg-[#F1C40F] hover:bg-[#F39C12] text-[#2C3E50] rounded-xl transition-all shadow-[0_4px_0_#D4AC0D] active:translate-y-1 active:shadow-none border-4 border-[#1A252F] pointer-events-auto"
                    title="Settings"
                >
                    <Settings size={20} />
                </button>
            </div>

            {/* Game Over / Countdown Screen */}
            {matchStatus !== 'playing' && (
                <div className={`absolute inset-0 flex flex-col items-center justify-center z-50 ${matchStatus === 'countdown' ? 'bg-transparent' : 'bg-[#3b414a]/90 backdrop-blur-md'}`}>
                    {matchStatus === 'countdown' ? (
                        <h2 className={`text-9xl md:text-[10rem] font-black pointer-events-none text-white ${countdown === 'GO!' ? 'animate-ping !text-white' : 'animate-bounce'}`} style={{WebkitTextStroke: '6px #1A252F', textShadow: '0 12px 0 #1A252F'}}>
                            {countdown}
                        </h2>
                    ) : matchStatus === 'round_over' ? (
                        <div className="flex flex-col items-center max-w-2xl text-center px-6 scale-up-center bg-[#34495E] p-10 rounded-[3rem] border-8 border-[#1A252F] shadow-[0_16px_0_rgba(0,0,0,0.5)]">
                            <div className={`mb-4 p-4 rounded-full inline-flex border-4 border-[#1A252F] shadow-[0_4px_0_#1A252F] ${roundResult === 'attackers_win' ? 'bg-[#E67E22] text-white' : 'bg-[#3498DB] text-white'}`}>
                                <Trophy size={48} />
                            </div>
                            <h2 className={`text-5xl font-black mb-4 tracking-tight uppercase ${roundResult === 'attackers_win' ? 'text-[#F1C40F]' : 'text-[#85C1E9]'}`} style={{WebkitTextStroke: '2px #1A252F', textShadow: '0 4px 0 #1A252F'}}>
                                {roundResult === 'attackers_win' 
                                    ? (baseConfig.mapTheme === 'duck' ? 'TRACK CLEARED!' : baseConfig.mapTheme === 'pigeon' ? 'HARVEST STOLEN!' : 'TOUCHDOWN!')
                                    : (baseConfig.mapTheme === 'duck' ? 'LAP DENIED!' : baseConfig.mapTheme === 'pigeon' ? 'FARM DEFENDED!' : 'DEFENSE HOLDS!')}
                            </h2>
                            <p className="text-white text-xl font-bold mb-8 tracking-widest bg-[#1A252F] px-6 py-2 rounded-full shadow-[0_4px_0_rgba(0,0,0,0.3)] uppercase">
                                {roundResult === 'attackers_win' 
                                    ? (baseConfig.mapTheme === 'duck' ? 'All wrenches collected on the track.' : baseConfig.mapTheme === 'pigeon' ? 'All carrots were carried away!' : 'All points were brought to the zones.')
                                    : gameState.timeLeft <= 0 ? 'Time ran out! Defenders successfully guarded their half.' : 'All attackers were tackled.'}
                            </p>
                            {networkManager.role === 'client' ? (
                                <button 
                                    onClick={onToggleReady}
                                    className="group flex items-center gap-3 px-8 py-4 bg-[#2ECC71] hover:bg-[#27AE60] text-white font-black text-2xl uppercase tracking-widest rounded-2xl transition-all shadow-[0_6px_0_#1E8449] active:translate-y-2 active:shadow-none pointer-events-auto border-4 border-[#1A252F]"
                                >
                                    <Check strokeWidth={4} size={28} />
                                    {isClientReady ? 'WAITING FOR HOST...' : 'READY UP'}
                                </button>
                            ) : (
                                <button 
                                    onClick={handleNextRound}
                                    disabled={!isAllReady}
                                    className="group flex items-center gap-3 px-8 py-4 bg-[#F1C40F] disabled:opacity-50 disabled:bg-[#7F8C8D] hover:bg-[#F39C12] text-[#2C3E50] font-black text-2xl uppercase tracking-widest rounded-2xl transition-all shadow-[0_6px_0_#D4AC0D] active:translate-y-2 active:shadow-none pointer-events-auto border-4 border-[#1A252F]"
                                >
                                    <Play fill="currentColor" size={28} />
                                    {isAllReady ? 'START NEXT ROUND' : 'WAITING FOR PLAYERS...'}
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center max-w-3xl text-center px-6 scale-up-center bg-[#2C3E50] p-10 rounded-[3rem] border-8 border-[#1A252F] shadow-[0_16px_0_rgba(0,0,0,0.5)]">
                            <h2 className="text-6xl font-black mb-4 tracking-tight uppercase text-[#F1C40F]" style={{WebkitTextStroke: '2px #1A252F', textShadow: '0 6px 0 #1A252F'}}>
                                MATCH COMPLETE!
                            </h2>
                            <p className="text-white text-xl font-bold mb-8 tracking-widest uppercase bg-[#1A252F] px-6 py-2 rounded-full shadow-[0_4px_0_rgba(0,0,0,0.3)]">
                                {scoreTeam1 > scoreTeam2 ? "TEAM ORANGE WINS THE SERIES" : scoreTeam2 > scoreTeam1 ? "TEAM BLUE WINS THE SERIES" : "SERIES TIED - NO WINNER"}
                            </p>
                            
                            {/* MVP Section */}
                            {(() => {
                                let mvpId: string | null = null;
                                let mvpScore = -1;
                                let mvpType = '';
                                let stats: any = null;

                                Object.entries(matchStats as Record<string, { name: string, freezes: number, plants: number, holdTime: number }>).forEach(([pId, s]) => {
                                    const score = s.plants * 5 + s.freezes * 3 + s.holdTime * 0.1;
                                    if (score > mvpScore) {
                                        mvpScore = score;
                                        stats = s;
                                        if (s.plants > s.freezes * 1.5) mvpType = 'Master Planter';
                                        else if (s.freezes > s.plants * 1.5) mvpType = 'Ice Cold Defender';
                                        else mvpType = 'All-Star MVP';
                                    }
                                });

                                return stats ? (
                                    <div className="flex flex-col items-center bg-[#1A252F] p-6 rounded-[2rem] border-4 border-[#F1C40F] shadow-[0_0_20px_#F1C40F,0_8px_0_#D4AC0D] mb-8 w-full max-w-2xl transform hover:scale-105 transition-transform duration-300">
                                        <div className="flex items-center gap-3 mb-2 animate-pulse">
                                            <Trophy className="text-[#F1C40F]" size={28} />
                                            <h3 className="text-[#F1C40F] text-2xl font-black uppercase tracking-widest text-center">{mvpType}</h3>
                                            <Trophy className="text-[#F1C40F]" size={28} />
                                        </div>
                                        <div className="text-5xl font-black text-white mb-6 uppercase tracking-wider" style={{WebkitTextStroke: '1px #000'}}>{stats.name}</div>
                                        
                                        <div className="flex justify-around px-4 w-full gap-4">
                                            <div className="flex flex-col items-center bg-[#2C3E50] p-4 rounded-xl border-2 border-[#34495E] shadow-[0_4px_0_#1A252F] flex-1">
                                                <span className="text-[#95A5A6] font-bold uppercase text-xs tracking-wider mb-2">Planted</span>
                                                <span className="text-[#2ECC71] text-4xl font-black tracking-tighter" style={{WebkitTextStroke: '1px #1E8449'}}>{stats.plants}</span>
                                            </div>
                                            <div className="flex flex-col items-center bg-[#2C3E50] p-4 rounded-xl border-2 border-[#34495E] shadow-[0_4px_0_#1A252F] flex-1">
                                                <span className="text-[#95A5A6] font-bold uppercase text-xs tracking-wider mb-2">Frozen</span>
                                                <span className="text-[#00E5FF] text-4xl font-black tracking-tighter" style={{WebkitTextStroke: '1px #00BFFF'}}>{stats.freezes}</span>
                                            </div>
                                            <div className="flex flex-col items-center bg-[#2C3E50] p-4 rounded-xl border-2 border-[#34495E] shadow-[0_4px_0_#1A252F] flex-1">
                                                <span className="text-[#95A5A6] font-bold uppercase text-xs tracking-wider mb-2">Possession</span>
                                                <span className="text-[#E67E22] text-4xl font-black tracking-tighter" style={{WebkitTextStroke: '1px #D35400'}}>{Math.round(stats.holdTime)}s</span>
                                            </div>
                                        </div>
                                    </div>
                                ) : null;
                            })()}

                            <div className="flex items-center gap-8 bg-[#34495E] p-8 rounded-[2rem] border-4 border-[#1A252F] shadow-[0_8px_0_rgba(0,0,0,0.3)] mb-10 w-full justify-center">
                                <div className="flex flex-col items-center">
                                    <span className="text-[#E67E22] font-black mb-2 uppercase tracking-wider text-xl drop-shadow-md">Team Org</span>
                                    <span className="text-8xl font-black text-white" style={{WebkitTextStroke: '2px #1A252F', textShadow: '0 6px 0 #1A252F'}}>{scoreTeam1}</span>
                                </div>
                                <span className="text-[#95A5A6] text-6xl font-black drop-shadow-md">-</span>
                                <div className="flex flex-col items-center">
                                    <span className="text-[#3498DB] font-black mb-2 uppercase tracking-wider text-xl drop-shadow-md">Team Blu</span>
                                    <span className="text-8xl font-black text-white" style={{WebkitTextStroke: '2px #1A252F', textShadow: '0 6px 0 #1A252F'}}>{scoreTeam2}</span>
                                </div>
                            </div>
                            
                            <div className="flex gap-6">
                                <button 
                                    onClick={handleRestartMatch}
                                    className="flex items-center gap-3 px-6 py-4 bg-[#2ECC71] hover:bg-[#27AE60] text-white font-black text-xl uppercase tracking-wide rounded-2xl transition-all shadow-[0_6px_0_#1E8449] active:translate-y-2 active:shadow-none pointer-events-auto border-4 border-[#1A252F]"
                                >
                                    <RefreshCw size={24} />
                                    REPLAY SERIES
                                </button>
                                {networkManager.role !== 'offline' && onReturnToLobby && (
                                    <button 
                                        onClick={onReturnToLobby}
                                        className="flex items-center gap-3 px-6 py-4 bg-[#E67E22] hover:bg-[#D35400] text-white font-black text-xl uppercase tracking-wide rounded-2xl transition-all shadow-[0_6px_0_#A04000] active:translate-y-2 active:shadow-none pointer-events-auto border-4 border-[#1A252F]"
                                    >
                                        <Users size={24} />
                                        TO LOBBY
                                    </button>
                                )}
                                <button 
                                    onClick={onBack}
                                    className="flex items-center gap-3 px-6 py-4 bg-[#E74C3C] hover:bg-[#C0392B] text-white font-black text-xl uppercase tracking-wide rounded-2xl transition-all shadow-[0_6px_0_#922B21] active:translate-y-2 active:shadow-none pointer-events-auto border-4 border-[#1A252F]"
                                >
                                    <Home size={24} />
                                    MAIN MENU
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
            
            {/* Settings Overlay */}
            {isSettingsOpen && (
                <div className="absolute inset-0 bg-[#3b414a]/80 backdrop-blur-sm z-[60] flex items-center justify-center pointer-events-auto">
                    <div className="bg-[#34495E] border-8 border-[#1A252F] rounded-3xl p-6 shadow-[0_12px_0_rgba(0,0,0,0.4)] flex flex-col gap-6 text-center min-w-[280px] max-w-[320px]">
                        <div className="flex flex-col items-center mb-1">
                            <Settings size={32} className="text-[#F1C40F] mb-3" />
                            <h2 className="text-3xl font-black text-white uppercase tracking-widest drop-shadow-md" style={{WebkitTextStroke: '2px #1A252F'}}>PAUSED</h2>
                        </div>
                        
                        <div className="flex flex-col gap-3">
                            <button onClick={handleCloseSettings} className="px-4 py-3 bg-[#2ECC71] hover:bg-[#27AE60] text-white font-black text-lg tracking-wider rounded-xl border-4 border-[#1A252F] transition-all shadow-[0_4px_0_#1E8449] active:shadow-none active:translate-y-1">
                                RESUME GAME
                            </button>

                            <button onClick={handleRestartMatch} className="px-4 py-3 bg-[#F1C40F] hover:bg-[#F39C12] text-[#2C3E50] font-black text-lg tracking-wider rounded-xl border-4 border-[#1A252F] transition-all shadow-[0_4px_0_#D4AC0D] flex justify-center items-center gap-2 active:shadow-none active:translate-y-1">
                                <RefreshCw size={20} /> RESTART MATCH
                            </button>
                            
                            {networkManager.role !== 'offline' && onReturnToLobby && (
                                <button onClick={onReturnToLobby} className="px-4 py-3 bg-[#E67E22] hover:bg-[#D35400] text-white font-black text-lg tracking-wider rounded-xl border-4 border-[#1A252F] transition-all shadow-[0_4px_0_#A04000] flex justify-center items-center gap-2 active:shadow-none active:translate-y-1">
                                    <Users size={20} /> RETURN TO LOBBY
                                </button>
                            )}

                            <button onClick={onBack} className="px-4 py-3 bg-[#E74C3C] hover:bg-[#C0392B] text-white font-black text-lg tracking-wider rounded-xl border-4 border-[#1A252F] transition-all shadow-[0_4px_0_#922B21] flex justify-center items-center gap-2 active:shadow-none active:translate-y-1">
                                <Home size={20} /> LEAVE MATCH
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Global style overrides for animations */}
            <style dangerouslySetInnerHTML={{__html: `
                @keyframes scale-up-center {
                    0% { transform: scale(0.8); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                }
                .scale-up-center {
                    animation: scale-up-center 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
                }
            `}} />
        </div>
    );
}
