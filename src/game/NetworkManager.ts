import Peer, { DataConnection } from 'peerjs';

export interface NetworkInputPayload {
    type: 'input';
    playerId: string;
    keys: Record<string, boolean>;
    gamepadAxes?: number[];
    gamepadButtons?: boolean[];
}

export interface NetworkLobbyPayload {
    type: 'lobby_state';
    players: { id: string, type: string, gamepadIndex?: number, label: string, team: string, isBot?: boolean, isReady?: boolean }[];
    settings?: any;
}

export interface NetworkStatePayload {
    type: 'state';
    time: number;
    ball: { x: number, y: number, z: number, heldById: string | null };
    players: { id: string, x: number, y: number, faceDir: number, isFrozen: boolean, iFrames: number, dashTimer: number, unfreezeTimer: number, carryingItemId: string | null }[];
    items: { id: string, x: number, y: number, isCarried: boolean, inZoneId: string | null }[];
    zones: { id: string, hasItem: boolean, progress: number, isPlanting: boolean }[];
    gameState: any;
    matchStats: any;
    uiState?: { currentRound: number; scoreTeam1: number; scoreTeam2: number; matchStatus: string; roundResult: string; countdown: number | 'GO!' | null };
}

export type NetworkRole = 'offline' | 'host' | 'client';

export class NetworkManager {
    peer: Peer | null = null;
    connection: DataConnection | null = null;
    role: NetworkRole = 'offline';
    roomId: string = '';
    playerName: string = 'Player';
    
    // Callbacks
    onStateReceived?: (state: NetworkStatePayload) => void;
    onInputReceived?: (input: NetworkInputPayload) => void;
    onLobbyStateReceived?: (state: NetworkLobbyPayload) => void;
    onLobbyActionReceived?: (action: any, peerId: string) => void;
    onPlayerJoined?: (peerId: string, name: string) => void;
    onPlayerLeft?: (peerId: string) => void;
    onGameStarted?: () => void;
    onConnected?: () => void;
    onDisconnected?: () => void;
    onError?: (err: string) => void;

    // For Host to manage multiple clients
    clients: Map<string, DataConnection> = new Map();

    initHost(roomId: string, playerName: string) {
        this.role = 'host';
        this.roomId = roomId;
        this.playerName = playerName;
        this.peer = new Peer(roomId);

        this.peer.on('open', (id) => {
            console.log('Host created room:', id);
            if (this.onConnected) this.onConnected();
        });

        this.peer.on('connection', (conn) => {
            this.clients.set(conn.peer, conn);
            
            conn.on('data', (data: any) => {
                if (data.type === 'hello') {
                    if (this.onPlayerJoined) this.onPlayerJoined(conn.peer, data.name || 'Remote Player');
                } else if (data.type === 'input' && this.onInputReceived) {
                    this.onInputReceived(data);
                } else if (data.type === 'lobby_action' && this.onLobbyActionReceived) {
                    this.onLobbyActionReceived(data.action, conn.peer);
                }
            });

            conn.on('open', () => {
                // Connection opened
            });

            conn.on('close', () => {
                this.clients.delete(conn.peer);
                if (this.onPlayerLeft) this.onPlayerLeft(conn.peer);
            });
        });

        this.peer.on('error', (err) => {
            if (this.onError) this.onError(err.message);
        });
    }

    initClient(roomId: string, playerName: string) {
        this.role = 'client';
        this.playerName = playerName;
        // Connect to a specific host ID
        this.peer = new Peer(); // random client ID
        
        this.peer.on('open', (id) => {
            this.connection = this.peer!.connect(roomId);
            
            this.connection.on('open', () => {
                console.log('Connected to Host!');
                this.connection?.send({ type: 'hello', name: this.playerName });
                if (this.onConnected) this.onConnected();
            });

            this.connection.on('data', (data: any) => {
                if (data.type === 'start_game' && this.onGameStarted) {
                    this.onGameStarted();
                } else if (data.type === 'state' && this.onStateReceived) {
                    this.onStateReceived(data);
                } else if (data.type === 'lobby_state' && this.onLobbyStateReceived) {
                    this.onLobbyStateReceived(data);
                } else if (data.type === 'lobby_action' && this.onLobbyActionReceived) {
                    this.onLobbyActionReceived(data.action, 'host');
                }
            });

            this.connection.on('close', () => {
                if (this.onDisconnected) this.onDisconnected();
            });
        });

        this.peer.on('error', (err) => {
            if (this.onError) this.onError(err.message);
        });
    }

    sendStateToClients(state: NetworkStatePayload) {
        if (this.role !== 'host') return;
        this.broadcast(state);
    }

    sendLobbyState(state: NetworkLobbyPayload) {
        if (this.role !== 'host') return;
        this.broadcast(state);
    }

    sendInputToHost(input: NetworkInputPayload) {
        if (this.role !== 'client' || !this.connection?.open) return;
        this.connection.send(input);
    }

    sendLobbyAction(action: any) {
        if (this.role !== 'client' || !this.connection?.open) return;
        this.connection.send({ type: 'lobby_action', action });
    }

    broadcast(data: any) {
        this.clients.forEach(conn => {
            if (conn.open) conn.send(data);
        });
    }

    disconnect() {
        if (this.connection) this.connection.close();
        if (this.peer) this.peer.destroy();
        this.role = 'offline';
        this.clients.clear();
    }
}

export const networkManager = new NetworkManager();
