const WebSocket = require('ws');
const dispatchMessage = require('./message-dispatcher.js');
const db = require('./db/Db.js');

class WebSocketServer {
    constructor() {
        this.wss = null;
        this.rooms = new Map();
        this.userRoomMap = new Map(); // New map to track userId -> roomId
    }

    start(server) {
        this.wss = new WebSocket.Server({ noServer: true });

        server.on('upgrade', (request, socket, head) => {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit('connection', ws, request);
            });
        });

        this.wss.on('connection', (ws) => {
            this.handleConnection(ws);
        });

        console.log('WebSocket server started and attached to HTTP server.');
    }

    handleConnection(ws) {
        console.log('Client connected.');

        ws.on('message', (message) => {
            dispatchMessage(ws, message, this.wss, this.rooms, this.userRoomMap); // Pass userRoomMap
        });

        ws.on('close', () => {
            this.handleClose(ws);
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    }

    async handleClose(ws) {
        const userId = ws.userId;
        let roomId = null;
        let room = null;

        // Find the room the user was in by iterating through all rooms.
        // This is more robust than relying on potentially stale ws properties.
        for (const [currentRoomId, currentRoomSet] of this.rooms.entries()) {
            if (currentRoomSet.has(ws)) {
                roomId = currentRoomId;
                room = currentRoomSet;
                break;
            }
        }

        console.log(`Client disconnected (userId: ${userId}, roomId: ${roomId}). Handling leave...`);

        if (!roomId || !userId || !room) {
            // User was not in any room, no action needed.
            return;
        }

        // --- Start of Unified Leave Logic (from handleLeaveRoom) ---
        
        // Remove the client from the room Set and the user-to-room map
        room.delete(ws);
        this.userRoomMap.delete(userId);
        console.log(`User ${userId} left room ${roomId}. Remaining participants: ${room.size}`);

        // Notify remaining clients in the same room
        room.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'user-left', payload: { userId } }));
            }
        });

        // If the room is now empty, remove it from memory and DB
        if (room.size === 0) {
            console.log(`[DEBUG] Room ${roomId} is empty. Deleting from memory and DB.`);
            this.rooms.delete(roomId);
            try {
                // Only delete group rooms from DB when empty.
                const roomDetailsResult = await db.query('SELECT room_type FROM rooms WHERE id = $1', [roomId]);
                if (roomDetailsResult.rows[0]?.room_type === 'group') {
                    await db.query('DELETE FROM rooms WHERE id = $1', [roomId]);
                    // No need to broadcast room-deleted, as no one is in the lobby in this context
                }
            } catch (error) {
                console.error(`[DEBUG] Failed to delete room ${roomId} from DB:`, error);
            }
        } else { // Room still has participants, check for host migration
            const roomDbResult = await db.query('SELECT host_id FROM rooms WHERE id = $1', [roomId]);
            if (roomDbResult.rows[0]?.host_id === userId) {
                // The host left, elect a new one
                const newHostWs = Array.from(room)[0]; // Elect the first remaining participant
                const newHostId = newHostWs.userId;

                await db.query('UPDATE rooms SET host_id = $1 WHERE id = $2', [newHostId, roomId]);
                console.log(`[DEBUG] Room ${roomId}: Host changed from ${userId} to ${newHostId}.`);

                // Notify all remaining clients about the new host
                room.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'host-changed', payload: { newHostId } }));
                    }
                });
            }
        }
        // --- End of Unified Leave Logic ---
    }
}

// Export a singleton instance
module.exports = new WebSocketServer();
