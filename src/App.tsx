import React, { useState, useEffect, useRef } from 'react';
import Game from './components/Game';
import { Gamepad2, Settings, Play, Maximize, Minimize, Users, Info, ChevronLeft, ChevronRight, Monitor, Keyboard, Wifi, Globe, Check } from 'lucide-react';
import { GameConfig, Team, LocalPlayer } from './game/Engine';
import { networkManager } from './game/NetworkManager';

type Screen = 'menu' | 'settings' | 'game' | 'controls' | 'online' | 'client_lobby';

type ActiveDevice = {
  id: string;
  type: 'keyboard' | 'gamepad';
  gamepadIndex?: number;
  label: string;
  team: Team;
  isBot?: boolean;
  isReady?: boolean;
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const [onlineRoomCode, setOnlineRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('Player 1');
  const [isConnecting, setIsConnecting] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  
  const [devices, setDevices] = useState<ActiveDevice[]>([
    { id: 'keyboard', type: 'keyboard', label: 'Keyboard P1', team: 'spectator' }
  ]);

  const [teamConfig, setTeamConfig] = useState({
    attackers: { total: 4, useAI: true },
    defenders: { total: 5, useAI: true }
  });

  const [totalRounds, setTotalRounds] = useState<number>(6);
  const [timeLimit, setTimeLimit] = useState<number>(90);
  const [mapTheme, setMapTheme] = useState<'pigeon' | 'football' | 'duck'>('pigeon');
  const [rotateMaps, setRotateMaps] = useState<boolean>(false);
  
  const [keyBindings, setKeyBindings] = useState({
    up: 'w', down: 's', left: 'a', right: 'd', pass: ' ', drop: 'q'
  });

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
        if ('keyboard' in navigator && (navigator as any).keyboard && typeof (navigator as any).keyboard.lock === 'function') {
          await (navigator as any).keyboard.lock(['Escape']);
        }
      } catch (err) {
        console.error("Fullscreen/KeyboardLock error:", err);
      }
    } else {
      if ('keyboard' in navigator && (navigator as any).keyboard && typeof (navigator as any).keyboard.unlock === 'function') {
        (navigator as any).keyboard.unlock();
      }
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);

    const initSound = () => {
        import('./game/Engine').then(({ soundManager }) => {
            soundManager.init();
        });
        document.removeEventListener('click', initSound);
        document.removeEventListener('keydown', initSound);
    };
    document.addEventListener('click', initSound);
    document.addEventListener('keydown', initSound);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleGlobalKeyDown);
      document.removeEventListener('click', initSound);
      document.removeEventListener('keydown', initSound);
    };
  }, []);

  useEffect(() => {
    networkManager.onConnected = () => {
        setIsConnecting(false);
        if (networkManager.role === 'client') {
            setScreen('settings');
        } else {
            setScreen('settings');
        }
    };
    networkManager.onError = (err) => {
        setIsConnecting(false);
        setOnlineError(err);
    };
    networkManager.onDisconnected = () => {
        if (screen === 'game' || screen === 'client_lobby' || screen === 'settings') {
            if (networkManager.role !== 'offline') {
                setScreen('menu');
                setOnlineError('Disconnected from network');
                networkManager.disconnect();
            }
        }
    };
    networkManager.onPlayerJoined = (peerId, name) => {
        setDevices(prev => {
            if (prev.find(d => d.id === peerId)) return prev;
            return [...prev, { id: peerId, type: 'gamepad', label: name, team: 'spectator' }];
        });
    };
    networkManager.onPlayerLeft = (peerId) => {
        setDevices(prev => prev.filter(d => d.id !== peerId));
    };
    networkManager.onLobbyStateReceived = (state) => {
         // @ts-ignore
         setDevices(state.players);
         if (state.settings) {
              setTeamConfig(state.settings.teamConfig);
              setMapTheme(state.settings.mapTheme);
              setTotalRounds(state.settings.totalRounds);
         }
    };
    networkManager.onLobbyActionReceived = (action, peerId) => {
         if (action.type === 'move') {
             handleDeviceMove(action.id, 'gamepad', undefined, action.label || 'Remote', action.dir);
         } else if (action.type === 'return_lobby') {
             setScreen('settings');
         } else if (action.type === 'toggle_ready') {
             setDevices(prev => prev.map(d => (d.id === action.id || d.id.startsWith(`${action.id}-`)) ? { ...d, isReady: !d.isReady } : d));
         }
    };
    networkManager.onGameStarted = () => {
         setScreen('game');
    };
  }, [screen]);

  useEffect(() => {
      if (networkManager.role === 'host' && screen === 'settings') {
          networkManager.sendLobbyState({
              type: 'lobby_state',
              players: devices.map(d => ({ id: d.id, type: d.type as any, gamepadIndex: d.gamepadIndex, label: d.label, team: d.team, isBot: d.isBot, isReady: d.isReady })),
              settings: { teamConfig, mapTheme, totalRounds }
          });
      }
  }, [devices, teamConfig, mapTheme, totalRounds, screen]);

  const handleDeviceMove = (
    id: string, 
    type: 'keyboard' | 'gamepad' | 'bot', 
    gamepadIndex: number | undefined, 
    label: string, 
    dir: 'left' | 'right'
  ) => {
    if (networkManager.role === 'client') {
        const netId = id === 'keyboard' ? (networkManager.peer?.id || id) : `${networkManager.peer?.id}-${id}`;
        networkManager.sendLobbyAction({ type: 'move', id: netId, dir, label: label === 'Keyboard P1' ? playerName : label });
        return;
    }

    setDevices(prev => {
       let existing = prev.find(d => d.id === id);
       let updatedList = prev;
       
       if (!existing) {
           existing = { id, type: type as any, gamepadIndex, label, team: 'spectator', isBot: type === 'bot' };
           updatedList = [...prev, existing];
       }
       
       const currentTeam = existing.team;
       let newTeam = currentTeam;
  
       if (dir === 'left') {
           if (currentTeam === 'defenders') newTeam = 'spectator';
           else if (currentTeam === 'spectator') newTeam = 'attackers';
       } else {
           if (currentTeam === 'attackers') newTeam = 'spectator';
           else if (currentTeam === 'spectator') newTeam = 'defenders';
       }
  
       if (newTeam === currentTeam) return updatedList; // no change
  
       return updatedList.map(d => d.id === id ? { ...d, team: newTeam } : d);
    });
  };

  // Controller Polling
  useEffect(() => {
    if (screen !== 'settings') return;
    
    let frame: number;
    const lastInput = new Map<string, number>();
  
    const checkInputs = () => {
      const now = performance.now();
      
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < gamepads.length; i++) {
          const gp = gamepads[i];
          if (!gp) continue;
          
          const deviceId = `gamepad-${i}`;
          let movedLeft = false;
          let movedRight = false;
  
          // D-Pad or Left Stick
          if (gp.axes[0] < -0.5 || gp.buttons[14]?.pressed) movedLeft = true;
          if (gp.axes[0] > 0.5 || gp.buttons[15]?.pressed) movedRight = true;
  
          if (movedLeft || movedRight) {
              const lastTime = lastInput.get(deviceId) || 0;
              if (now - lastTime > 200) { // debounce 200ms
                  lastInput.set(deviceId, now);
                  const label = `Gamepad ${i + 1}`;
                  handleDeviceMove(deviceId, 'gamepad', i, label, movedLeft ? 'left' : 'right');
              }
          }
      }
      frame = requestAnimationFrame(checkInputs);
    };
    frame = requestAnimationFrame(checkInputs);
    return () => cancelAnimationFrame(frame);
  }, [screen]);

  // Keyboard Listener
  useEffect(() => {
    if (screen !== 'settings') return;
    
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        handleDeviceMove('keyboard', 'keyboard', undefined, 'Keyboard', 'left');
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        handleDeviceMove('keyboard', 'keyboard', undefined, 'Keyboard', 'right');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen]);

  const compiledConfig: GameConfig = React.useMemo(() => {
    const isBotAdded = devices.some(d => d.isBot);
    return {
      localPlayers: devices.filter(d => d.team !== 'spectator' && !d.isBot).map(d => ({
          id: d.id,
          type: d.type as any,
          gamepadIndex: d.gamepadIndex,
          team: d.team,
          label: d.label
      })),
      attackers: { total: devices.filter(d => d.team === 'attackers').length, useAI: isBotAdded },
      defenders: { total: devices.filter(d => d.team === 'defenders').length, useAI: isBotAdded },
      timeLimit,
      mapTheme,
      keyBindings
    };
  }, [devices, teamConfig, timeLimit, mapTheme, keyBindings]);

  if (screen === 'game') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
        <Game 
          baseConfig={compiledConfig} 
          totalRounds={totalRounds}
          rotateMaps={rotateMaps}
          onBack={() => setScreen('menu')} 
          onReturnToLobby={() => {
              if (networkManager.role === 'host') {
                  networkManager.broadcast({ type: 'lobby_action', action: { type: 'return_lobby' } });
              }
              setScreen('settings');
          }}
          isAllReady={devices.every(d => d.team === 'spectator' || d.isBot || d.id === 'keyboard' || d.id.startsWith('gamepad-') || d.isReady)}
          isClientReady={networkManager.role === 'client' && devices.find(d => d.id === networkManager.peer?.id || d.id.startsWith(`${networkManager.peer?.id}-`))?.isReady}
          onToggleReady={() => {
              networkManager.sendLobbyAction({ type: 'toggle_ready', id: networkManager.peer?.id || '' });
          }}
          onClearReady={() => {
              setDevices(prev => prev.map(d => ({ ...d, isReady: false })));
          }}
        />
      </div>
    );
  }

  const attackers = devices.filter(d => d.team === 'attackers');
  const spectators = devices.filter(d => d.team === 'spectator');
  const defenders = devices.filter(d => d.team === 'defenders');

  const DeviceBadge = ({ device }: { device: ActiveDevice }) => {
    const isAttacker = device.team === 'attackers';
    const isDefender = device.team === 'defenders';
    const bg = isAttacker ? 'bg-[#E67E22] border-[#D35400] text-white shadow-[#D35400]' : 
               isDefender ? 'bg-[#3498DB] border-[#2980B9] text-white shadow-[#2980B9]' : 
               'bg-[#BDC3C7] border-[#95A5A6] text-[#2C3E50] shadow-[#2C3E50]';
    return (
      <div className={`relative w-full px-4 py-3 rounded-2xl border-4 flex items-center justify-center gap-3 shadow-[0_4px_0_var(--tw-shadow-color)] ${bg}`}>
        {device.isBot ? <Monitor size={24} /> : device.type === 'keyboard' ? <Keyboard size={24} /> : <Gamepad2 size={24} />}
        <span className="font-black text-lg uppercase tracking-wide truncate">{device.label}</span>
        {device.isReady && !device.isBot && device.team !== 'spectator' && (
           <div className="absolute -top-3 -right-3 bg-[#2ECC71] border-4 border-[#1A252F] rounded-full p-1 shadow-lg pointer-events-none">
              <Check size={16} strokeWidth={4} className="text-white" />
           </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#3b414a] text-[#d9dce1] flex flex-col items-center justify-center p-6">
      
      <button 
        onClick={toggleFullscreen}
        className="absolute top-6 right-6 p-3 bg-[#4d5560] hover:bg-[#F39C12] text-white rounded-xl shadow-[0_4px_0_rgba(0,0,0,0.3)] transition-all z-10"
        title="Toggle Fullscreen"
      >
        {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
      </button>

      <div className={`w-full flex flex-col items-center ${screen === 'settings' ? 'max-w-7xl' : 'max-w-2xl'}`}>
        
        {screen === 'menu' && (
          <>
            <h1 className="text-7xl font-black text-[#F1C40F] tracking-tight mb-2 text-center uppercase" style={{WebkitTextStroke: '3px #2C3E50', textShadow: '0 6px 0 #2C3E50'}}>
              ESPORTS PITCH
            </h1>
            <p className="text-[#E67E22] font-bold text-xl mb-12 uppercase bg-[#2C3E50] px-4 py-1 rounded-full shadow-[0_4px_0_rgba(0,0,0,0.3)]">
              VS SERIES
            </p>
            <div className="w-full max-w-md flex flex-col gap-6">
              <button 
                onClick={() => setScreen('game')}
                className="w-full flex items-center justify-center gap-3 bg-[#F1C40F] hover:bg-[#F39C12] text-[#2C3E50] py-5 font-black text-2xl uppercase tracking-wide transition-all rounded-2xl shadow-[0_6px_0_#D4AC0D] active:translate-y-2 active:shadow-none"
              >
                <Play fill="currentColor" size={28} />
                PLAY MATCH
              </button>
              <button 
                onClick={() => setScreen('settings')}
                className="w-full flex items-center justify-center gap-3 bg-[#E67E22] hover:bg-[#D35400] text-white py-4 font-black text-xl uppercase tracking-wide transition-all rounded-2xl shadow-[0_6px_0_#935116] active:translate-y-2 active:shadow-none"
              >
                <Settings size={24} />
                GAME SETTINGS
              </button>
              <button 
                onClick={() => setScreen('controls')}
                className="w-full flex items-center justify-center gap-3 bg-[#3498DB] hover:bg-[#2980B9] text-white py-4 font-black text-xl uppercase tracking-wide transition-all rounded-2xl shadow-[0_6px_0_#1F618D] active:translate-y-2 active:shadow-none"
              >
                <Keyboard size={24} />
                CONTROLS
              </button>
              <button 
                onClick={() => { setOnlineError(''); setScreen('online'); }}
                className="w-full flex items-center justify-center gap-3 bg-[#9B59B6] hover:bg-[#8E44AD] text-white py-4 font-black text-xl uppercase tracking-wide transition-all rounded-2xl shadow-[0_6px_0_#732D91] active:translate-y-2 active:shadow-none"
              >
                <Globe size={24} />
                ONLINE MULTIPLAYER
              </button>
            </div>
          </>
        )}

        {screen === 'online' && (
          <div className="w-full max-w-md bg-[#2C3E50] rounded-[2.5rem] p-8 shadow-[0_16px_0_rgba(0,0,0,0.4)] border-8 border-[#1A252F] flex flex-col gap-6">
            <div className="flex items-center justify-between pb-4 border-b-4 border-[#34495E]">
                <h2 className="text-3xl font-black text-[#F1C40F] uppercase tracking-wide flex items-center gap-3"><Globe size={32}/> ONLINE</h2>
                <button 
                  onClick={() => { networkManager.disconnect(); setScreen('menu'); }}
                  className="p-3 bg-[#E74C3C] hover:bg-[#C0392B] text-white rounded-xl shadow-[0_4px_0_#922B21] transition-all active:translate-y-1 active:shadow-none border-2 border-[#1A252F]"
                >
                  <ChevronLeft size={24} />
                </button>
            </div>

            {onlineError && <div className="bg-[#E74C3C]/20 border-2 border-[#E74C3C] text-[#E74C3C] p-3 rounded-lg text-center font-bold uppercase">{onlineError}</div>}

            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 mb-2">
                    <span className="text-[#95A5A6] font-bold uppercase text-sm px-2">Your Name</span>
                    <input 
                        type="text" 
                        placeholder="ENTER YOUR NAME" 
                        maxLength={12}
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        className="bg-[#1A252F] text-white text-center font-black text-2xl py-3 rounded-xl border-2 border-[#34495E] outline-none focus:border-[#F1C40F] transition-all uppercase placeholder-[#34495E]"
                    />
                </div>
                <button 
                  onClick={() => {
                      if (!playerName.trim()) return;
                      setIsConnecting(true); setOnlineError('');
                      const code = Math.random().toString(36).substring(2, 6).toUpperCase();
                      setOnlineRoomCode(code);
                      setDevices([{ id: 'keyboard', type: 'keyboard', label: playerName, team: 'spectator' }]);
                      networkManager.initHost('esports-pitch-' + code, playerName);
                  }}
                  disabled={isConnecting || !playerName.trim()}
                  className="w-full bg-[#2ECC71] disabled:opacity-50 hover:bg-[#27AE60] text-white py-4 font-black text-xl tracking-wide rounded-2xl shadow-[0_4px_0_#1E8449] active:translate-y-2 active:shadow-none flex items-center justify-center gap-2"
                >
                    <Wifi size={24} /> HOST A MATCH
                </button>
                
                <div className="relative flex items-center py-2">
                    <div className="flex-grow border-t-2 border-[#34495E]"></div>
                    <span className="flex-shrink-0 mx-4 text-[#95A5A6] font-bold uppercase">OR JOIN</span>
                    <div className="flex-grow border-t-2 border-[#34495E]"></div>
                </div>

                <div className="flex flex-col gap-2">
                    <input 
                        type="text" 
                        placeholder="ENTER 4-LETTER CODE" 
                        maxLength={4}
                        value={onlineRoomCode}
                        onChange={(e) => setOnlineRoomCode(e.target.value.toUpperCase())}
                        className="bg-[#1A252F] text-white text-center font-black text-2xl py-3 rounded-xl border-2 border-[#34495E] outline-none focus:border-[#F1C40F] transition-all uppercase placeholder-[#34495E]"
                    />
                    <button 
                      onClick={() => {
                          if (onlineRoomCode.length < 4 || !playerName.trim()) return;
                          setIsConnecting(true); setOnlineError('');
                          networkManager.initClient('esports-pitch-' + onlineRoomCode, playerName);
                      }}
                      disabled={isConnecting || onlineRoomCode.length < 4 || !playerName.trim()}
                      className="w-full bg-[#3498DB] disabled:opacity-50 hover:bg-[#2980B9] text-white py-4 font-black text-xl tracking-wide rounded-2xl shadow-[0_4px_0_#1F618D] active:translate-y-2 active:shadow-none"
                    >
                        {isConnecting ? 'CONNECTING...' : 'JOIN MATCH'}
                    </button>
                </div>
            </div>

            {isConnecting && networkManager.role === 'host' && (
                <div className="mt-4 bg-[#34495E] p-6 rounded-2xl border-4 border-[#F39C12] text-center animate-pulse">
                    <p className="text-[#BDC3C7] font-bold uppercase mb-2">Room Code</p>
                    <h1 className="text-6xl font-black text-white tracking-widest">{onlineRoomCode}</h1>
                    <p className="text-[#F1C40F] font-bold mt-4">Waiting for opponent...</p>
                </div>
            )}
          </div>
        )}

        {screen === 'settings' && (
          <div className="w-full bg-[#2C3E50] rounded-[2.5rem] p-8 shadow-[0_16px_0_rgba(0,0,0,0.4)] border-8 border-[#1A252F] flex flex-col gap-8">
            
            {networkManager.role !== 'offline' && (
               <div className="bg-[#E67E22] rounded-3xl p-6 flex flex-col md:flex-row items-center justify-between border-4 border-[#D35400] shadow-[0_8px_0_#A04000] -mt-2">
                  <div className="flex items-center gap-4 mb-4 md:mb-0">
                     <Wifi className="text-white shrink-0" size={40} />
                     <div className="flex flex-col">
                        <span className="text-orange-200 font-bold uppercase text-sm tracking-wider">ROOM CODE</span>
                        <span className="text-white font-black text-5xl tracking-widest leading-none drop-shadow-md">{networkManager.roomId.replace('esports-pitch-', '')}</span>
                     </div>
                  </div>
                  <div className="flex flex-col items-center md:items-end">
                      <span className="text-white font-black text-2xl uppercase">{devices.length} Player{devices.length !== 1 ? 's' : ''}</span>
                      <span className="text-orange-200 font-bold text-sm uppercase">{networkManager.role === 'host' ? 'Waiting for players to join...' : 'Connected to host'}</span>
                  </div>
               </div>
            )}

            {/* Header Region */}
            <div className="flex items-center justify-between pb-6 border-b-4 border-[#34495E]">
               <div className="flex items-center gap-4">
                 <button 
                   onClick={() => setScreen('menu')}
                   className="p-3 bg-[#E74C3C] hover:bg-[#C0392B] text-white rounded-xl shadow-[0_4px_0_#922B21] transition-all active:translate-y-1 active:shadow-none border-2 border-[#1A252F]"
                   title="Back to Menu"
                 >
                   <ChevronLeft size={32} />
                 </button>
                 <Settings className="text-[#F1C40F] hidden sm:block" size={48} />
                 <h2 className="text-3xl sm:text-4xl font-black text-white uppercase tracking-widest drop-shadow-md" style={{WebkitTextStroke: '1px #1A252F'}}>Match Setup</h2>
               </div>
                {networkManager.role === 'client' ? (
                  <button 
                    onClick={() => networkManager.sendLobbyAction({ type: 'toggle_ready', id: networkManager.peer?.id || '' })}
                    className="flex items-center gap-2 bg-[#F1C40F] hover:bg-[#F39C12] text-[#2C3E50] px-6 py-3 font-black text-xl uppercase tracking-wide transition-all rounded-2xl shadow-[0_6px_0_#D4AC0D] active:translate-y-2 active:shadow-none border-4 border-[#1A252F]"
                  >
                   <Check strokeWidth={4} size={24} />
                   TOGGLE READY
                 </button>
                ) : (
                  <button 
                    onClick={() => {
                        networkManager.broadcast({ type: 'start_game' });
                        setScreen('game');
                    }}
                    disabled={!devices.every(d => d.team === 'spectator' || d.isBot || d.id === 'keyboard' || d.id.startsWith('gamepad-') || d.isReady)}
                    className="flex items-center gap-2 bg-[#2ECC71] disabled:opacity-50 disabled:bg-[#7F8C8D] hover:bg-[#27AE60] text-white px-6 sm:px-8 py-3 sm:py-4 font-black text-xl sm:text-2xl uppercase tracking-wide transition-all rounded-2xl shadow-[0_6px_0_#1E8449] active:translate-y-2 active:shadow-none border-4 border-[#1A252F]"
                  >
                   <Play fill="currentColor" size={24} className="hidden sm:block" />
                   {devices.every(d => d.team === 'spectator' || d.isBot || d.id === 'keyboard' || d.id.startsWith('gamepad-') || d.isReady) ? 'START' : 'WAITING FOR READY...'}
                 </button>
                )}
            </div>

            {networkManager.role === 'client' && (
                 <div className="bg-[#E74C3C]/20 border-2 border-[#E74C3C] text-[#E74C3C] p-3 rounded-lg text-center font-bold uppercase mb-4">
                     You are a connected client. Only the Host can change the game settings.
                 </div>
            )}

            {/* Grid Setup */}
            <div className={`grid grid-cols-1 gap-8 ${networkManager.role === 'client' ? 'pointer-events-none opacity-80' : ''}`}>
                
                {/* Game Rules */}
                <div className="w-full bg-[#34495E] rounded-3xl p-6 border-4 border-[#1A252F] shadow-[0_8px_0_rgba(0,0,0,0.2)] flex flex-col md:flex-row gap-8 relative overflow-hidden">
                    <h3 className="hidden md:block text-2xl font-black text-[#F1C40F] uppercase tracking-wide relative z-10 border-b-2 border-[#1A252F] pb-2 min-w-[200px]">Arena Rules</h3>
                    
                    <div className="flex flex-col gap-3 relative z-10">
                        <label className="text-xl font-bold text-[#BDC3C7] uppercase flex items-center gap-2">Location</label>
                        <select 
                            value={mapTheme}
                            onChange={(e) => setMapTheme(e.target.value as 'pigeon' | 'football' | 'duck')}
                            className="bg-[#EAECEE] border-4 border-[#1A252F] text-[#2C3E50] px-4 py-4 rounded-2xl outline-none font-black text-xl uppercase shadow-[0_4px_0_#95A5A6] cursor-pointer"
                        >
                            <option value="football">Football Pitch</option>
                            <option value="pigeon">Pigeon Roof</option>
                            <option value="duck">Duck Park</option>
                        </select>
                    </div>

                    <label className="flex items-center justify-between px-4 py-3 bg-[#1A252F] rounded-xl border-4 border-[#1A252F] cursor-pointer group mt-2">
                        <span className="text-white font-bold text-sm">ROTATE MAPS EV. ROUND</span>
                        <div className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${rotateMaps ? 'bg-[#2ECC71]' : 'bg-[#7F8C8D]'}`}>
                            <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${rotateMaps ? 'translate-x-6' : 'translate-x-0'}`} />
                        </div>
                        <input type="checkbox" className="hidden" checked={rotateMaps} onChange={(e) => setRotateMaps(e.target.checked)} />
                    </label>
                    
                    <div className="grid grid-cols-2 gap-4 relative z-10">
                        <div className="flex flex-col gap-3">
                            <label className="text-xl font-bold text-[#BDC3C7] uppercase">Time</label>
                            <select 
                                value={timeLimit}
                                onChange={(e) => setTimeLimit(Number(e.target.value))}
                                className="bg-[#EAECEE] border-4 border-[#1A252F] text-[#2C3E50] px-4 py-3 rounded-xl outline-none font-black text-lg shadow-[0_4px_0_#95A5A6] cursor-pointer"
                            >
                                <option value={60}>1:00 Min</option>
                                <option value={90}>1:30 Min</option>
                                <option value={120}>2:00 Min</option>
                            </select>
                        </div>
                        <div className="flex flex-col w-full gap-3">
                            <label className="text-xl font-bold text-[#BDC3C7] uppercase">Rounds</label>
                            <select 
                                value={totalRounds}
                                onChange={(e) => setTotalRounds(Number(e.target.value))}
                                className="bg-[#EAECEE] border-4 border-[#1A252F] text-[#2C3E50] px-4 py-3 rounded-xl outline-none font-black text-lg shadow-[0_4px_0_#95A5A6] cursor-pointer"
                            >
                                <option value={2}>2 ROUNDS</option>
                                <option value={4}>4 ROUNDS</option>
                                <option value={6}>6 ROUNDS</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Lobby: Player Controller Assignment */}
            <div className="bg-[#1A252F] rounded-3xl p-8 border-4 border-[#34495E] shadow-inner mt-4">
                <div className="flex justify-between items-end mb-6">
                    <div>
                       <h3 className="text-3xl font-black text-white uppercase tracking-widest flex items-center gap-3">
                           <Users className="text-[#3498DB]" size={36} />
                           Lobby Assignment
                       </h3>
                       <p className="text-[#95A5A6] font-bold text-lg mt-2 uppercase tracking-wide">
                           Use Left/Right (A/D or D-pad) to switch teams. Press any button to join.
                       </p>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row items-stretch justify-between gap-6 min-h-[220px]">
                    {/* Team 1 Area */}
                    <div className="flex-1 bg-[#2C3E50] border-4 border-[#E67E22] rounded-2xl p-6 flex flex-col items-center gap-4 relative overflow-hidden shadow-inner">
                        <span className="text-[#E67E22] font-black text-3xl uppercase tracking-wider">TEAM 1 (ORG)</span>
                        {attackers.map(d => <div key={d.id} className="w-full relative z-10 flex items-center gap-2">
                           <DeviceBadge device={d} />
                           {d.isBot && networkManager.role !== 'client' && (
                               <button onClick={() => setDevices(prev => prev.filter(x => x.id !== d.id))} className="p-3 bg-red-600 hover:bg-red-500 rounded-xl text-white shadow-md active:translate-y-1 my-3 border-b-4 border-red-800">
                                  <ChevronLeft size={20} />
                               </button>
                           )}
                        </div>)}
                        {attackers.length === 0 && <span className="text-[#E67E22]/50 text-xl font-bold uppercase tracking-wider mt-12 mb-4">Waiting...</span>}
                        {networkManager.role !== 'client' && <button onClick={() => setDevices(prev => [...prev, { id: 'bot-' + Math.random(), type: 'bot' as any, label: 'Bot Player', team: 'attackers', isBot: true }])} className="mt-auto w-full py-2 bg-[#E67E22]/20 hover:bg-[#E67E22]/50 border-2 border-[#E67E22] text-[#F39C12] font-bold uppercase rounded-xl transition-all">+ Add Bot</button>}
                    </div>

                    {/* Neutral Area */}
                    <div className="flex-1 bg-[#2C3E50]/50 border-4 border-[#95A5A6] border-dashed rounded-2xl p-6 flex flex-col items-center gap-4 relative">
                        <span className="text-[#95A5A6] font-black text-2xl uppercase text-center w-full pb-2 border-b-2 border-[#95A5A6]/30">Unassigned</span>
                        {spectators.map(d => <div key={d.id} className="w-full"><DeviceBadge device={d} /></div>)}
                    </div>

                    {/* Team 2 Area */}
                    <div className="flex-1 bg-[#2C3E50] border-4 border-[#3498DB] rounded-2xl p-6 flex flex-col items-center gap-4 relative overflow-hidden shadow-inner">
                        <span className="text-[#3498DB] font-black text-3xl uppercase tracking-wider">TEAM 2 (BLU)</span>
                        {defenders.map(d => <div key={d.id} className="w-full relative z-10 flex items-center gap-2">
                           <DeviceBadge device={d} />
                           {d.isBot && networkManager.role !== 'client' && (
                               <button onClick={() => setDevices(prev => prev.filter(x => x.id !== d.id))} className="p-3 bg-red-600 hover:bg-red-500 rounded-xl text-white shadow-md active:translate-y-1 my-3 border-b-4 border-red-800">
                                  <ChevronLeft size={20} />
                               </button>
                           )}
                        </div>)}
                        {defenders.length === 0 && <span className="text-[#3498DB]/50 text-xl font-bold uppercase tracking-wider mt-12 mb-4">Waiting...</span>}
                        {networkManager.role !== 'client' && <button onClick={() => setDevices(prev => [...prev, { id: 'bot-' + Math.random(), type: 'bot' as any, label: 'Bot Player', team: 'defenders', isBot: true }])} className="mt-auto w-full py-2 bg-[#3498DB]/20 hover:bg-[#3498DB]/50 border-2 border-[#3498DB] text-[#85C1E9] font-bold uppercase rounded-xl transition-all">+ Add Bot</button>}
                    </div>
                </div>
            </div>

          </div>
        )}

        {screen === 'controls' && (
          <div className="w-full bg-[#2C3E50] rounded-[2.5rem] p-8 shadow-[0_16px_0_rgba(0,0,0,0.4)] border-8 border-[#1A252F] flex flex-col gap-8 max-w-4xl">
            {/* Header */}
            <div className="flex items-center justify-between pb-6 border-b-4 border-[#34495E]">
               <div className="flex items-center gap-4">
                 <Keyboard className="text-[#3498DB]" size={48} />
                 <h2 className="text-4xl font-black text-white uppercase tracking-widest drop-shadow-md" style={{WebkitTextStroke: '1px #1A252F'}}>Game Controls</h2>
               </div>
               <button 
                 onClick={() => setScreen('menu')}
                 className="flex items-center gap-2 bg-[#E67E22] hover:bg-[#D35400] text-white px-8 py-4 font-black text-2xl uppercase tracking-wide transition-all rounded-2xl shadow-[0_6px_0_#A04000] active:translate-y-2 active:shadow-none border-4 border-[#1A252F]"
               >
                 <ChevronLeft size={28} />
                 BACK
               </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               {/* Gamepad Guide */}
               <div className="bg-[#34495E] rounded-3xl p-6 border-4 border-[#1A252F] shadow-[0_8px_0_rgba(0,0,0,0.2)] flex flex-col gap-6">
                 <div className="flex items-center gap-3 border-b-2 border-[#1A252F] pb-2">
                    <Gamepad2 className="text-[#2ECC71]" size={32} />
                    <h3 className="text-2xl font-black text-[#2ECC71] uppercase tracking-wide">Gamepad</h3>
                 </div>
                 <div className="flex flex-col gap-4 text-lg font-bold text-[#BDC3C7]">
                    <div className="flex justify-between items-center"><span className="text-white">Move (<span className="text-sm font-medium">also aiming</span>)</span><span className="bg-[#1A252F] px-3 py-1 rounded-lg">Left Stick</span></div>
                    <div className="flex justify-between items-center"><span className="text-white">Throw Ball (Blue Team)</span><span className="bg-[#1A252F] px-3 py-1 rounded-lg">RT / A</span></div>
                    <div className="flex justify-between items-center"><span className="text-white">Request Pass (Blue Team)</span><span className="bg-[#1A252F] px-3 py-1 rounded-lg">A / Y</span></div>
                    <div className="flex justify-between items-center"><span className="text-white">Drop Ball (Orange Team)</span><span className="bg-[#1A252F] px-3 py-1 rounded-lg">A / X</span></div>
                    <div className="flex justify-between items-center"><span className="text-white">Switch Team (Menu)</span><span className="bg-[#1A252F] px-3 py-1 rounded-lg">D-Pad L/R</span></div>
                 </div>
               </div>

               {/* Keyboard Guide & Customization */}
               <div className="bg-[#34495E] rounded-3xl p-6 border-4 border-[#1A252F] shadow-[0_8px_0_rgba(0,0,0,0.2)] flex flex-col gap-6">
                 <div className="flex items-center gap-3 border-b-2 border-[#1A252F] pb-2">
                    <Keyboard className="text-[#F1C40F]" size={32} />
                    <h3 className="text-2xl font-black text-[#F1C40F] uppercase tracking-wide">Keyboard</h3>
                 </div>
                 <p className="text-[#95A5A6] text-sm font-bold uppercase tracking-wide mb-2">Click a button below to change the key bind.</p>
                 
                 <div className="grid grid-cols-2 gap-4">
                     <div className="flex flex-col gap-1">
                         <span className="text-[#BDC3C7] font-bold text-sm uppercase">Move Up</span>
                         <input type="text" maxLength={1} value={keyBindings.up} onChange={(e) => setKeyBindings({...keyBindings, up: e.target.value.toLowerCase() || 'w'})} className="bg-[#1A252F] text-white font-black text-xl text-center uppercase py-2 rounded-xl outline-none border-2 border-transparent focus:border-[#F1C40F] transition-all" />
                     </div>
                     <div className="flex flex-col gap-1">
                         <span className="text-[#BDC3C7] font-bold text-sm uppercase">Move Down</span>
                         <input type="text" maxLength={1} value={keyBindings.down} onChange={(e) => setKeyBindings({...keyBindings, down: e.target.value.toLowerCase() || 's'})} className="bg-[#1A252F] text-white font-black text-xl text-center uppercase py-2 rounded-xl outline-none border-2 border-transparent focus:border-[#F1C40F] transition-all" />
                     </div>
                     <div className="flex flex-col gap-1">
                         <span className="text-[#BDC3C7] font-bold text-sm uppercase">Move Left</span>
                         <input type="text" maxLength={1} value={keyBindings.left} onChange={(e) => setKeyBindings({...keyBindings, left: e.target.value.toLowerCase() || 'a'})} className="bg-[#1A252F] text-white font-black text-xl text-center uppercase py-2 rounded-xl outline-none border-2 border-transparent focus:border-[#F1C40F] transition-all" />
                     </div>
                     <div className="flex flex-col gap-1">
                         <span className="text-[#BDC3C7] font-bold text-sm uppercase">Move Right</span>
                         <input type="text" maxLength={1} value={keyBindings.right} onChange={(e) => setKeyBindings({...keyBindings, right: e.target.value.toLowerCase() || 'd'})} className="bg-[#1A252F] text-white font-black text-xl text-center uppercase py-2 rounded-xl outline-none border-2 border-transparent focus:border-[#F1C40F] transition-all" />
                     </div>
                     <div className="flex flex-col gap-1">
                         <span className="text-[#BDC3C7] font-bold text-sm uppercase">Drop (Orange)</span>
                         <input type="text" maxLength={1} value={keyBindings.drop} onChange={(e) => setKeyBindings({...keyBindings, drop: e.target.value.toLowerCase() || 'q'})} className="bg-[#1A252F] text-white font-black text-xl text-center uppercase py-2 rounded-xl outline-none border-2 border-transparent focus:border-[#F1C40F] transition-all" />
                     </div>
                     <div className="flex flex-col gap-1">
                         <span className="text-[#BDC3C7] font-bold text-sm uppercase">Pass (Blue)</span>
                         <input type="text" maxLength={1} value={keyBindings.pass === ' ' ? 'SPACE' : keyBindings.pass} onChange={(e) => setKeyBindings({...keyBindings, pass: e.target.value.toLowerCase() || ' '})} className="bg-[#1A252F] text-white font-black text-xl text-center uppercase py-2 rounded-xl outline-none border-2 border-transparent focus:border-[#F1C40F] transition-all" />
                     </div>
                 </div>

                 <div className="mt-4 pt-4 border-t-2 border-[#1A252F] flex flex-col gap-2 text-md font-bold text-[#BDC3C7]">
                    <div className="flex justify-between items-center"><span className="text-white">Throw Ball</span><span className="bg-[#1A252F] px-3 py-1 rounded-lg">Pass Key (Space)</span></div>
                    <p className="text-[#F39C12] text-xs">Ball is thrown in the direction you are facing/moving.</p>
                 </div>

               </div>
            </div>
            
          </div>
        )}
      </div>
    </div>
  );
}
