const WebSocket = require('ws');
const authenticateToken = require('./middleware/authenticateWs');
const { handleLogin, handleSignup, handleUpdateProfile, handleReauthenticate } = require('./handlers/auth.js');
const { handleEmailVerification } = require('./handlers/verification.js');
const { handleGetUserProfile } = require('./handlers/user-handlers.js');
const {
    handleGetRooms, 
    handleCreateRoom, 
    handleJoinRoom, 
    handleLeaveRoom, 
    handleChatMessage,
    handleWebRTCSignaling,
    handleGetChatHistory,
    handleDeleteMessage,
    handleGetCategories,
    handleMuteStatusChanged,
    handleSpeakingStatusChanged,
} = require('./handlers/room-handlers.js');
const {
    handleFriendRequest,
    handleAcceptFriendRequest,
    handleDeclineFriendRequest,
    handleRemoveFriend,
    handleGetFriendsList,
    handleDirectMessage,
} = require('./handlers/friend-handlers.js');

const messageHandlers = {
    // Public handlers (no authentication required)
    'login': handleLogin,
    'signup': handleSignup,
    'verify-email': handleEmailVerification,
    'reauthenticate': handleReauthenticate,

    // Protected handlers (authentication required)
    'update-profile': authenticateToken(handleUpdateProfile),
    'get-user-profile': authenticateToken(handleGetUserProfile),
    
    // Friends
    'friend-request': authenticateToken(handleFriendRequest),
    'get-friends-list': authenticateToken(handleGetFriendsList),
    'accept-friend-request': authenticateToken(handleAcceptFriendRequest),
    'decline-friend-request': authenticateToken(handleDeclineFriendRequest),
    'remove-friend': authenticateToken(handleRemoveFriend),
    'direct-message': authenticateToken(handleDirectMessage),

    // Rooms
    'get-rooms': authenticateToken(handleGetRooms),
    'create-room': authenticateToken(handleCreateRoom),
    'join-room': authenticateToken(handleJoinRoom),
    'leave-room': authenticateToken(handleLeaveRoom),
    'get-categories': authenticateToken(handleGetCategories),

    // Chat
    'chat-message': authenticateToken(handleChatMessage),
    'get-chat-history': authenticateToken(handleGetChatHistory),
    'delete-message': authenticateToken(handleDeleteMessage),

    // WebRTC Signaling (authentication is implicitly handled by being in a room)
    'offer': authenticateToken(handleWebRTCSignaling),
    'answer': authenticateToken(handleWebRTCSignaling),
    'ice-candidate': authenticateToken(handleWebRTCSignaling),
    'stream-id-map': authenticateToken(handleWebRTCSignaling),
    'mute-status-changed': authenticateToken(require('./handlers/room-handlers.js').handleMuteStatusChanged),
    'speaking-start': authenticateToken((ws, _, wss, rooms) => handleSpeakingStatusChanged(ws, { isSpeaking: true }, wss, rooms)),
    'speaking-stop': authenticateToken((ws, _, wss, rooms) => handleSpeakingStatusChanged(ws, { isSpeaking: false }, wss, rooms)),
};

function dispatchMessage(ws, message, wss, rooms, userRoomMap) {
    let data;
    try {
        const messageStr = message.toString();
        data = JSON.parse(messageStr);
    } catch (e) {
        console.error("Failed to parse message or message is not JSON", e);
        return;
    }

    const handler = messageHandlers[data.type];
    if (handler) {
        const webrtcSignalTypes = ['offer', 'answer', 'ice-candidate', 'stream-id-map'];
        const payloadExpectedHandlers = [
            'login', 'signup', 'update-profile', 'verify-email', 'get-user-profile',
            'friend-request', 'get-friends-list', 'accept-friend-request', 'decline-friend-request', 'remove-friend', 'direct-message',
            'get-rooms', 'create-room', 'join-room', 'leave-room', 'chat-message', 'get-chat-history', 'delete-message', 'get-categories',
            'reauthenticate'
        ];
        
        if (webrtcSignalTypes.includes(data.type)) {
            // Pass the full data object for WebRTC signals
            handler(ws, data, wss, rooms);
        } else if (payloadExpectedHandlers.includes(data.type)) {
            // Pass only the payload for other handlers
            if (['join-room', 'leave-room'].includes(data.type)) {
                handler(ws, data.payload, wss, rooms, userRoomMap);
            } else {
                handler(ws, data.payload, wss, rooms);
            }
        } else {
            // For handlers that don't expect a payload property
            handler(ws, data, wss, rooms);
        }
    } else {
        console.warn(`No handler found for message type: ${data.type}`);
    }
}

module.exports = dispatchMessage;