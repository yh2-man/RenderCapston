const db = require('../db/Db');
const WebSocket = require('ws');

// Helper function to send data to a WebSocket client
const send = (ws, type, payload) => {
    ws.send(JSON.stringify({ type, payload }));
};

// Helper function to broadcast data to all clients in the lobby
const broadcastToLobby = (wss, type, payload) => {
    const message = JSON.stringify({ type, payload });
    wss.clients.forEach(client => {
        // Send to clients who are connected but not in a room
        if (client.readyState === WebSocket.OPEN && !client.roomId) {
            client.send(message);
        }
    });
};

// Helper function to get categories
async function handleGetCategories(ws) {
    try {
        const result = await db.query('SELECT id, name, image_url FROM categories ORDER BY name ASC');
        send(ws, 'categories-list', result.rows);
    } catch (error) {
        console.error('Failed to get categories:', error);
        send(ws, 'error', { message: 'Failed to retrieve categories list.' });
    }
}

async function handleGetRooms(ws, payload, wss, rooms) {
    console.log('Received request for room list.');
    try {
        const query = `
            SELECT 
                r.id, 
                r.name, 
                r.room_type AS "roomType",
                r.is_private AS "isPrivate",
                r.max_participants AS "maxParticipants", 
                u.username AS "hostName",
                c.name AS "categoryName",
                c.image_url AS "categoryImageUrl"
            FROM rooms r
            INNER JOIN users u ON r.host_id = u.id
            LEFT JOIN categories c ON r.category_id = c.id
            WHERE r.room_type = 'group' -- Only show group rooms in the lobby list
            ORDER BY r.created_at DESC;
        `;
        const result = await db.query(query);
        const dbRooms = result.rows;

        const liveRooms = dbRooms.map(room => ({
            ...room,
            categoryImageUrl: room.categoryImageUrl ? `http://localhost:3001${room.categoryImageUrl}` : null,
            participantCount: rooms.get(room.id)?.size || 0,
        }));

        send(ws, 'rooms-list', liveRooms);
    } catch (error) {
        console.error('Failed to get rooms:', error);
        send(ws, 'error', { message: 'Failed to retrieve room list.' });
    }
}


async function handleCreateRoom(ws, payload, wss, rooms) {
    console.log('[Room-Handler] handleCreateRoom called with payload:', payload);
    const { name, categoryId, maxParticipants, userId, isPrivate, roomType = 'group' } = payload;
    // For group rooms, name is required. For DM rooms, name can be null.
    if (!userId || !maxParticipants) {
        return send(ws, 'error', { message: 'User ID and max participants are required.' });
    }
    if (roomType === 'group' && !name) {
        return send(ws, 'error', { message: 'Room name is required for group rooms.' });
    }

    try {
        const result = await db.query(
            'INSERT INTO rooms (name, room_type, category_id, host_id, max_participants, is_private) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, room_type AS "roomType", category_id AS "categoryId", max_participants AS "maxParticipants", is_private AS "isPrivate", created_at',
            [name || null, roomType, categoryId || null, userId, maxParticipants, isPrivate]
        );
        const newRoom = result.rows[0];
        
        // Add host username to the new room object
        const userResult = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
        const hostName = userResult.rows[0]?.username;

        let categoryName = null;
        let categoryImageUrl = null;
        if (newRoom.categoryId) {
            const categoryResult = await db.query('SELECT name, image_url FROM categories WHERE id = $1', [newRoom.categoryId]);
            if (categoryResult.rows.length > 0) {
                categoryName = categoryResult.rows[0].name;
                categoryImageUrl = categoryResult.rows[0].image_url;
            }
        }

        const roomForClient = {
            ...newRoom,
            hostName,
            categoryName,
            categoryImageUrl: categoryImageUrl ? `http://localhost:3001${categoryImageUrl}` : null,
            participantCount: 0 // Starts with 0, will be 1 after join
        };

        // Broadcast to all clients in the lobby if it's a group room
        if (roomType === 'group') {
            broadcastToLobby(wss, 'room-created', roomForClient);
        }
        
        // Also send a specific confirmation to the creator, which can include more data if needed
        send(ws, 'room-creation-success', roomForClient); 

        console.log(`Room created in DB: ${newRoom.name} (ID: ${newRoom.id}) by user ${userId}. Type: ${roomType}`);

    } catch (error) {
        console.error('Failed to create room:', error);
        send(ws, 'error', { message: 'Failed to create room.' });
    }
}

async function handleJoinRoom(ws, payload, wss, rooms, userRoomMap) { // Add userRoomMap
    const { roomId, userId } = payload;
    
    try {
        // Ensure the room exists in the database before joining
        const dbResult = await db.query(
            `SELECT 
                r.id, r.name, r.room_type AS "roomType", r.is_private AS "isPrivate", 
                r.max_participants AS "maxParticipants", r.host_id AS "hostId", r.category_id AS "categoryId",
                c.name AS "categoryName", c.image_url AS "categoryImageUrl"
            FROM rooms r
            LEFT JOIN categories c ON r.category_id = c.id
            WHERE r.id = $1`,
            [roomId]
        );
        if (dbResult.rows.length === 0) {
            return send(ws, 'error', { message: 'Room not found.' });
        }
        
        const dbRoom = dbResult.rows[0];
        let room = rooms.get(roomId);

        // If room is not in memory, create it
        if (!room) {
            room = new Set();
            rooms.set(roomId, room);
        }

        // Check if room is full
        if (room.size >= dbRoom.maxParticipants) {
            return send(ws, 'error', { message: 'Room is full.' });
        }

        // --- REORDERED LOGIC TO PREVENT RACE CONDITION ---

        // 1. Prepare all necessary data first
        const joiningUserResult = await db.query('SELECT id, username, tag, profile_image_url FROM users WHERE id = $1', [userId]);
        const joiningUser = joiningUserResult.rows[0];
        if (joiningUser.profile_image_url) {
            joiningUser.profile_image_url = `http://localhost:3001${joiningUser.profile_image_url}`;
        }

        // Temporarily add the new user to the room to build the full participant list
        room.add(ws);
        ws.roomId = roomId; // Set these early for the participantPromises
        ws.userId = userId;

        const participantPromises = Array.from(room).map(async client => {
            if (client.userId) {
                const userResult = await db.query('SELECT id, username, tag, profile_image_url FROM users WHERE id = $1', [client.userId]);
                const user = userResult.rows[0];
                if (user && user.profile_image_url) {
                    user.profile_image_url = `http://localhost:3001${user.profile_image_url}`;
                }
                return user;
            }
            return null;
        });
        const currentParticipants = (await Promise.all(participantPromises)).filter(p => p !== null);
        
        // Remove the user again before the final state update to avoid double-adding issues if logic changes
        room.delete(ws);

        const roomInfoPayload = {
            room: {
                id: dbRoom.id,
                name: dbRoom.name,
                roomType: dbRoom.roomType,
                isPrivate: dbRoom.isPrivate,
                categoryName: dbRoom.categoryName,
                categoryImageUrl: dbRoom.categoryImageUrl ? `http://localhost:3001${dbRoom.categoryImageUrl}` : null,
                hostId: dbRoom.hostId,
                maxParticipants: dbRoom.maxParticipants,
            },
            participants: currentParticipants,
        };

        // 2. Officially add user to the room state
        ws.roomId = roomId;
        ws.userId = userId;
        userRoomMap.set(userId, roomId);
        room.add(ws);
        
        // 3. Send room-info to the NEWLY joined client FIRST
        send(ws, 'room-info', roomInfoPayload);
        send(ws, 'joined-room', { roomId }); // Also confirm join

        // 4. THEN, notify other clients in the room
        room.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                send(client, 'user-joined', { user: joiningUser });
            }
        });

        // 5. Finally, notify the lobby of the participant count change
        broadcastToLobby(wss, 'room-updated', { roomId, participantCount: room.size });

        console.log(`User ${userId} joined room ${roomId}. Current participants: ${room.size}`);

    } catch (error) {
        console.error(`Failed to join room ${roomId}:`, error);
        send(ws, 'error', { message: 'Error joining room.' });
    }
}

async function handleLeaveRoom(ws, payload, wss, rooms, userRoomMap) { // Add userRoomMap
    const { roomId, userId } = ws;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (room) {
        room.delete(ws);
        console.log(`User ${userId} left room ${roomId}. Remaining participants: ${room.size}`);

        // Fetch room details to get room_type and is_private
        const roomDetailsResult = await db.query('SELECT room_type, is_private FROM rooms WHERE id = $1', [roomId]);
        const roomType = roomDetailsResult.rows[0]?.room_type || 'group';
        const isPrivate = roomDetailsResult.rows[0]?.is_private || false;

        // Notify lobby of participant count change (only for group rooms)
        if (roomType === 'group') {
            broadcastToLobby(wss, 'room-updated', { roomId, participantCount: room.size, roomType, isPrivate });
        }

        // Notify remaining clients in the same room
        room.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                send(client, 'user-left', { userId });
            }
        });

        // If the room is now empty, remove it from memory, DB, and notify lobby
        if (room.size === 0) {
            console.log(`[DEBUG] Room ${roomId} is empty. Attempting to delete from memory and DB.`);
            rooms.delete(roomId);
            // Only delete group rooms from DB when empty. DM rooms might persist.
            if (roomType === 'group') {
                try {
                    const deleteResult = await db.query('DELETE FROM rooms WHERE id = $1', [roomId]);
                    console.log(`[DEBUG] DB Delete result for room ${roomId}:`, deleteResult.rowCount);
                    // Broadcast to lobby that the room is deleted
                    broadcastToLobby(wss, 'room-deleted', { roomId });
                    console.log(`[DEBUG] Broadcasted 'room-deleted' for room ${roomId}.`);
                } catch (error) {
                    console.error(`[DEBUG] Failed to delete room ${roomId} from database:`, error);
                }
            } else if (roomType === 'dm') {
                console.log(`[DEBUG] DM Room ${roomId} is empty. Not deleting from DB.`);
                // DM rooms are not deleted from DB when empty, they persist for chat history.
            }
        } else { // Room still has participants
            // Check if the leaving user was the host
            const roomDbResult = await db.query('SELECT host_id, room_type, is_private FROM rooms WHERE id = $1', [roomId]);
            const currentHostId = roomDbResult.rows[0]?.host_id;

            if (currentHostId === userId) {
                // Host is leaving, elect a new host
                const remainingParticipants = Array.from(room);
                if (remainingParticipants.length > 0) {
                    const newHostWs = remainingParticipants[0]; // Elect the first remaining participant
                    const newHostId = newHostWs.userId;

                    // Update host in DB
                    await db.query('UPDATE rooms SET host_id = $1 WHERE id = $2', [newHostId, roomId]);
                    console.log(`[DEBUG] Room ${roomId}: Host changed from ${userId} to ${newHostId}.`);

                    // Notify all remaining clients in the room about the new host
                    room.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            send(client, 'host-changed', { roomId, newHostId });
                        }
                    });

                    // Update lobby with new host info
                    const newHostUserResult = await db.query('SELECT username FROM users WHERE id = $1', [newHostId]);
                    const newHostUsername = newHostUserResult.rows[0]?.username;
                    if (roomType === 'group') {
                        broadcastToLobby(wss, 'room-updated', { roomId, hostId: newHostId, hostName: newHostUsername, participantCount: room.size, roomType, isPrivate });
                    }

                } else {
                    // This case should ideally be handled by room.size === 0, but as a fallback
                    console.log(`[DEBUG] Room ${roomId} is empty after host left. Deleting.`);
                    rooms.delete(roomId);
                    if (roomType === 'group') {
                        try {
                            await db.query('DELETE FROM rooms WHERE id = $1', [roomId]);
                            broadcastToLobby(wss, 'room-deleted', { roomId });
                        } catch (error) {
                            console.error(`[DEBUG] Failed to delete room ${roomId} from database after host left:`, error);
                        }
                    }
                }
            } else {
                console.log(`[DEBUG] User ${userId} left room ${roomId}. Not host. Room still has participants: ${room.size}.`);
                // Only update participant count in lobby if non-host leaves
                if (roomType === 'group') {
                    broadcastToLobby(wss, 'room-updated', { roomId, participantCount: room.size, roomType, isPrivate });
                }
            }
        }
    }
    ws.roomId = null;
    userRoomMap.delete(userId); // Remove from userRoomMap
}

async function handleChatMessage(ws, payload, wss, rooms) {
    const { roomId, userId, content } = payload; // Changed 'message' to 'content'
    if (!roomId || !userId || !content) return;

    try {
        // 1. Save message to DB
        const result = await db.query(
            'INSERT INTO chat_messages (room_id, user_id, content) VALUES ($1, $2, $3) RETURNING id, created_at, is_edited, deleted_at', // Changed 'message' to 'content', added returning fields
            [roomId, userId, content]
        );
        const { id: messageId, created_at: timestamp, is_edited: isEdited, deleted_at: deletedAt } = result.rows[0];

        // 2. Fetch sender's username and profile image URL
        const userResult = await db.query(
            'SELECT username, profile_image_url FROM users WHERE id = $1',
            [userId]
        );
        const sender = userResult.rows[0];

        // 3. Broadcast message to all clients in the room
        const room = rooms.get(roomId);
        if (room) {
            room.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    send(client, 'new-message', {
                        id: messageId, // Include message ID
                        roomId,
                        userId,
                        username: sender.username,
                        profile_image_url: sender.profile_image_url ? `http://localhost:3001${sender.profile_image_url}` : null,
                        content,
                        timestamp,
                        isEdited,
                        deletedAt,
                    });
                }
            });
        }
    } catch (error) {
        console.error('Failed to save or broadcast chat message:', error);
    }
}

function handleWebRTCSignaling(ws, data, wss, rooms) {
    const { type, payload } = data;
    const { targetUserId, ...signalingData } = payload;
    const senderId = ws.userId;

    if (!targetUserId || !senderId) {
        console.error('[WebRTC Signaling] Error: targetUserId or senderId is missing.', { targetUserId, senderId });
        return;
    }

    let targetClient = null;
    for (const client of wss.clients) {
        // --- DETAILED DEBUG LOG ---
        console.log(`[WebRTC Signaling] Searching... Target: ${targetUserId} (type: ${typeof targetUserId}), Checking client: ${client.userId} (type: ${typeof client.userId}) in room: ${client.roomId}`);
        // --- END DEBUG LOG ---

        // Ensure both are treated as the same type for comparison
        if (String(client.userId) === String(targetUserId) && String(client.roomId) === String(ws.roomId)) {
            targetClient = client;
            break;
        }
    }

    if (targetClient && targetClient.readyState === WebSocket.OPEN) {
        console.log(`[WebRTC Signaling] Success: Found target ${targetUserId}. Relaying ${type} from ${senderId}.`);
        send(targetClient, type, { ...signalingData, senderId });
    } else {
        console.warn(`[WebRTC Signaling] Failure: Target client ${targetUserId} not found or not open in room ${ws.roomId}.`);
        send(ws, 'error', { message: `Target user ${targetUserId} is not available for WebRTC signaling.` });
    }
}


async function handleGetChatHistory(ws, payload) {
    const { roomId, beforeMessageId, limit = 50 } = payload; // Default limit to 50 messages
    if (!roomId) {
        return send(ws, 'error', { message: 'Room ID is required to fetch chat history.' });
    }

    try {
        let query = `
            SELECT
                cm.id,
                cm.room_id AS "roomId",
                cm.user_id AS "userId",
                u.username,
                u.profile_image_url AS "profileImageUrl",
                cm.content, -- Changed from cm.message
                cm.is_edited AS "isEdited",
                cm.created_at AS "timestamp",
                cm.updated_at AS "updatedAt",
                cm.deleted_at AS "deletedAt"
            FROM chat_messages cm
            JOIN users u ON cm.user_id = u.id
            WHERE cm.room_id = $1
        `;
        const queryParams = [roomId];
        let paramIndex = 2;

        if (beforeMessageId) {
            query += ` AND cm.id < $${paramIndex++}`;
            queryParams.push(beforeMessageId);
        }

        query += ` ORDER BY cm.created_at DESC LIMIT $${paramIndex++}`;
        queryParams.push(limit);

        const result = await db.query(query, queryParams);
        const chatHistory = result.rows.map(row => ({
            ...row,
            profileImageUrl: row.profileImageUrl ? `http://localhost:3001${row.profileImageUrl}` : null,
        })).reverse(); // Reverse to get oldest first

        send(ws, 'chat-history', { roomId, messages: chatHistory });

    } catch (error) {
        console.error('Failed to fetch chat history:', error);
        send(ws, 'error', { message: 'Failed to fetch chat history.' });
    }
}

async function handleDeleteMessage(ws, payload, wss, rooms) {
    const { messageId } = payload;
    const { userId, roomId } = ws;

    if (!messageId || !userId || !roomId) {
        return send(ws, 'error', { message: 'Invalid request for message deletion.' });
    }

    try {
        // 1. Verify that the user requesting deletion is the author of the message
        const messageResult = await db.query('SELECT user_id FROM chat_messages WHERE id = $1', [messageId]);
        if (messageResult.rows.length === 0) {
            return send(ws, 'error', { message: 'Message not found.' });
        }
        if (messageResult.rows[0].user_id !== userId) {
            return send(ws, 'error', { message: 'You do not have permission to delete this message.' });
        }

        // 2. Perform the soft delete by updating the deleted_at timestamp
        await db.query('UPDATE chat_messages SET deleted_at = NOW() WHERE id = $1', [messageId]);

        // 3. Broadcast the deletion to all clients in the room
        const room = rooms.get(roomId);
        if (room) {
            const broadcastPayload = { roomId, messageId };
            room.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    send(client, 'message-deleted', broadcastPayload);
                }
            });
        }
        console.log(`Message ${messageId} in room ${roomId} soft-deleted by user ${userId}.`);

    } catch (error) {
        console.error(`Failed to soft-delete message ${messageId}:`, error);
        send(ws, 'error', { message: 'Failed to delete message.' });
    }
}

async function handleMuteStatusChanged(ws, payload, wss, rooms) {
    const { userId, isMuted, targetUserId } = payload;
    const senderId = ws.userId;
    const { roomId } = ws;

    if (!roomId || userId === undefined || isMuted === undefined) {
        return; // Invalid payload
    }

    // If a targetUserId is specified, send only to that user.
    if (targetUserId) {
        for (const client of wss.clients) {
            if (String(client.userId) === String(targetUserId) && String(client.roomId) === String(roomId)) {
                send(client, 'mute-status-changed', { userId, isMuted, senderId });
                break;
            }
        }
    } else {
        // Otherwise, broadcast to the entire room.
        const room = rooms.get(roomId);
        if (room) {
            room.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    send(client, 'mute-status-changed', { userId, isMuted, senderId });
                }
            });
        }
    }
}

// This message is sent by the client but requires no server-side action.
// We add an empty handler to prevent "No handler found" errors.
function handleStreamIdMap() {
    // Do nothing.
}
module.exports = {
    handleGetRooms,
    handleCreateRoom,
    handleJoinRoom,
    handleLeaveRoom,
    handleChatMessage,
    handleWebRTCSignaling,
    handleGetChatHistory, // Export the new handler
    handleDeleteMessage,
    handleGetCategories,
    handleMuteStatusChanged,
    handleStreamIdMap,
};
