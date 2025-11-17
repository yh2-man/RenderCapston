import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useAudioProcessor } from '../hooks/useAudioProcessor';
import { useWebRTCManager } from '../hooks/useWebRTCManager';
import PropTypes from 'prop-types';

const defaultContextValue = {
    joinRoom: () => {},
    leaveRoom: () => {},
    fullCleanup: () => {},
    localStream: null,
    participants: {},
    setLocalAudioMuted: () => {},
    isGlobalMuted: false,
    setIsGlobalMuted: () => {},
    activateLocalStream: () => {},
    isMicActive: false,
    isLocalUserSpeaking: false, // Add default value
};

const WebRTCContext = createContext(defaultContextValue);

export function useWebRTC() {
    return useContext(WebRTCContext);
}

export function WebRTCProvider({ children }) {
    const { user, sendMessage, addMessageListener, removeMessageListener, currentRoom, setCurrentRoom } = useAuth();
    const { startProcessing, stopProcessing, processedStream: localStream } = useAudioProcessor();
    const [activeRoomId, setActiveRoomId] = useState(null);
    const [isGlobalMuted, setIsGlobalMuted] = useState(false);
    const [isMicActive, setIsMicActive] = useState(false);

    const { participants, cleanupAndResetAll, setLocalAudioMuted, isLocalUserSpeaking } = useWebRTCManager({
        user,
        currentRoom,
        localStream,
        sendMessage,
        addMessageListener,
        removeMessageListener,
        setCurrentRoom,
    });

    const fullCleanup = useCallback(async () => {
        cleanupAndResetAll();
        await stopProcessing();
        setIsMicActive(false);
        setActiveRoomId(null);
        setCurrentRoom(null);
        setIsGlobalMuted(false);
    }, [cleanupAndResetAll, stopProcessing, setCurrentRoom]);

    // Effect to automatically clean up when the user logs out.
    useEffect(() => {
        if (!user) {
            fullCleanup();
        }
    }, [user, fullCleanup]);

    const activateLocalStream = useCallback(async () => {
        if (localStream) return;
        try {
            const rawMicStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
            await startProcessing(rawMicStream);
            setIsMicActive(true);
        } catch (error) {
            console.error('Error activating local stream:', error);
        }
    }, [localStream, startProcessing]);

    const leaveRoom = useCallback(async () => {
        if (!activeRoomId || !user) return;
        sendMessage({ type: 'leave-room', payload: { roomId: activeRoomId, userId: user.id } });
        await fullCleanup();
    }, [activeRoomId, user, sendMessage, fullCleanup]);

    const joinRoom = useCallback(async (newRoomId) => {
        console.log(`[WebRTCContext] joinRoom called with roomId: ${newRoomId}`);
        if (!user) return;
        if (activeRoomId === newRoomId) return;
        
        // The server will handle moving the user from the old room to the new one.
        // No need to call leaveRoom() on the client, which was causing stream cleanup issues.

        try {
            await activateLocalStream();
            setActiveRoomId(newRoomId);
            sendMessage({ type: 'join-room', payload: { roomId: newRoomId, userId: user.id } });
        } catch (error) {
            console.error('Error joining room:', error);
        }
    }, [user, activeRoomId, activateLocalStream, sendMessage]);

    const value = {
        joinRoom,
        leaveRoom,
        fullCleanup,
        localStream,
        participants, // Use participants instead of remoteStreams
        setLocalAudioMuted,
        isGlobalMuted,
        setIsGlobalMuted,
        activateLocalStream,
        isMicActive,
        isLocalUserSpeaking, // Expose the value
    };

    return (
        <WebRTCContext.Provider value={value}>
            {children}
        </WebRTCContext.Provider>
    );
}

WebRTCProvider.propTypes = {
    children: PropTypes.node.isRequired,
};