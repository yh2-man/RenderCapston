import { useState, useEffect, useCallback, useRef } from 'react';
import { Connection } from '../core/Connection';
import useVoiceActivity from './useVoiceActivity';

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

export function useWebRTCManager({ user, currentRoom, localStream, sendMessage, addMessageListener, removeMessageListener, setCurrentRoom }) {
    const [participants, setParticipants] = useState({}); // Unified state: { userId: { stream, user, isMuted, isSpeaking } }
    const peerConnections = useRef({});
    const isHost = currentRoom?.hostId === user?.id;

    const userTracks = useRef(new Map());
    const streamIdToUserIdMapping = useRef({});
    const [_, set_] = useState(0);

    // Use voice activity hook to detect when the local user is speaking
    const { isSpeaking: isLocalUserSpeaking } = useVoiceActivity(localStream, { threshold: 2, delay: 150 });

    // Broadcast speaking status to all peers
    useEffect(() => {
        Object.values(peerConnections.current).forEach(conn => {
            conn.sendData({
                type: 'speaking_status',
                payload: { isSpeaking: isLocalUserSpeaking },
            });
        });
    }, [isLocalUserSpeaking]);

    // Callback to handle incoming data channel messages
    const handleDataMessage = useCallback((message, remoteUserId) => {
        const { type, payload } = message;
        if (type === 'speaking_status') {
            // Update local state for the speaking participant
            setParticipants(prev => {
                if (!prev[remoteUserId]) return prev;
                return {
                    ...prev,
                    [remoteUserId]: { ...prev[remoteUserId], isSpeaking: payload.isSpeaking },
                };
            });

            // If host, relay this message to all other participants
            if (isHost) {
                Object.entries(peerConnections.current).forEach(([peerId, conn]) => {
                    // Don't send the message back to the original sender
                    if (String(peerId) !== String(remoteUserId)) {
                        conn.sendData({
                            type: 'speaking_status',
                            payload: {
                                // Forward the original sender's ID and status
                                userId: remoteUserId,
                                isSpeaking: payload.isSpeaking
                            }
                        });
                    }
                });
            }
        }
    }, [isHost]);

    // Modified callback for participants to handle direct and relayed data messages
    const handleParticipantDataMessage = useCallback((message, fallbackId) => {
        const { type, payload } = message;
        if (type === 'speaking_status') {
            // If payload.userId exists, it's a relayed status. Otherwise, it's from the fallbackId (the host).
            const speakingUserId = payload.userId || fallbackId;
            const { isSpeaking } = payload;
            
            setParticipants(prev => {
                if (!prev[speakingUserId]) return prev;
                // Prevent unnecessary re-renders if the state is the same
                if (prev[speakingUserId].isSpeaking === isSpeaking) return prev;
                
                return {
                    ...prev,
                    [speakingUserId]: { ...prev[speakingUserId], isSpeaking: isSpeaking },
                };
            });
        }
    }, []);

        const cleanupPeerConnections = useCallback(() => {

            console.log('Cleaning up peer connections only...');

            Object.values(peerConnections.current).forEach(conn => conn.close());

            peerConnections.current = {};

            userTracks.current.clear();

            streamIdToUserIdMapping.current = {};

        }, []);

    

            const cleanupAndResetAll = useCallback(() => {

    

                console.log('Cleaning up all connections and resetting state...');

    

                cleanupPeerConnections();

    

                setParticipants({}); // Reset participants

    

            }, [cleanupPeerConnections]);

    

        

    

            // --- HOST-SPECIFIC LOGIC ---

    

        

    

            const prevIsHost = useRef(isHost);

    

            const isInitialMount = useRef(true);

    

        

    

            useEffect(() => {

    

                // This effect handles the case where a participant is promoted to host.

    

                // It should not run on the initial mount.

    

                if (isInitialMount.current) {

    

                    isInitialMount.current = false;

    

                } else if (isHost && !prevIsHost.current) {

    

                    // Condition: Became host, and was not host before.

    

                    console.log('[Host Migration] This client is the new host. Re-establishing connections...');

    

                    

    

                    const existingParticipants = { ...participants };

    

                    Object.values(existingParticipants).forEach(p => {

    

                        if (!p.user || String(p.user.id) === String(user.id)) return;

    

        

    

                        const remoteUser = p.user;

    

                        console.log(`[Host Migration] Initiating connection to existing participant: ${remoteUser.username} (${remoteUser.id})`);

    

                        

    

                        const onDataMessageForConn = (msg) => handleDataMessage(msg, remoteUser.id);

    

                        const conn = new Connection(user.id, remoteUser.id, sendMessage, ICE_SERVERS, onDataMessageForConn);

    

                        peerConnections.current[remoteUser.id] = conn;

    

        

    

                        conn.createDataChannel('voice-activity');

    

        

    

                        if (localStream) {

    

                            localStream.getAudioTracks().forEach(track => conn.addTrack(track, localStream));

    

                        }

    

        

    

                        conn.peerConnection.ontrack = (event) => {

    

                            const remoteTrack = event.track;

    

                            const remoteStream = event.streams[0];

    

                            console.log(`[Host Migration] Host: Received track from ${remoteUser.id}`);

    

                            userTracks.current.set(remoteUser.id, { track: remoteTrack, stream: remoteStream });

    

                            setParticipants(prev => ({

    

                                ...prev,

    

                                [remoteUser.id]: { ...prev[remoteUser.id], stream: remoteStream }

    

                            }));

    

                        };

    

        

    

                        conn.createOffer();

    

                    });

    

                }

    

                

    

                // Update the ref for the next render

    

                prevIsHost.current = isHost;

    

            }, [isHost]); // Reduced dependencies to only what's needed

    

        

    

            const handleNewPeerForHost = useCallback((payload) => {

    

                const remoteUser = payload.user;

    

                if (String(remoteUser.id) === String(user.id) || !localStream) return;

    

                if (peerConnections.current[remoteUser.id]) return;

    

        

    

                console.log(`Host: Handling new peer ${remoteUser.username} (${remoteUser.id})`);

    

                setParticipants(prev => ({ ...prev, [remoteUser.id]: { user: remoteUser, stream: null, isMuted: false, isSpeaking: false } }));

    

        

    

                const onDataMessageForConn = (msg) => handleDataMessage(msg, remoteUser.id);

    

                const conn = new Connection(user.id, remoteUser.id, sendMessage, ICE_SERVERS, onDataMessageForConn);

    

                peerConnections.current[remoteUser.id] = conn;

    

        

    

                // Create the data channel for speaking status

    

                conn.createDataChannel('voice-activity');

    

        

    

                // Add host's track to the new connection

    

                const hostTrack = localStream.getAudioTracks()[0];

    

                if (hostTrack) conn.addTrack(hostTrack, localStream);

    

        

    

                // Add tracks of other existing participants to the new connection

    

                userTracks.current.forEach((trackInfo, userId) => {

    

                    if (String(userId) !== String(remoteUser.id)) {

    

                        conn.addTrack(trackInfo.track, trackInfo.stream);

    

                    }

    

                });

    

        

    

                // --- STATE SYNC FOR NEW PEER ---

    

                // Send the current mute status of all existing participants to the new peer

    

                Object.entries(participants).forEach(([pId, pData]) => {

    

                    if (pData.isMuted) {

    

                        sendMessage({

    

                            type: 'mute-status-changed',

    

                            payload: { targetUserId: remoteUser.id, userId: pId, isMuted: true }

    

                        });

    

                    }

    

                });

    

                // Also send host's mute status

    

                const isHostMuted = !localStream?.getAudioTracks()[0]?.enabled;

    

                if (isHostMuted) {

    

                     sendMessage({

    

                        type: 'mute-status-changed',

    

                        payload: { targetUserId: remoteUser.id, userId: user.id, isMuted: true }

    

                    });

    

                }

    

                // --- END STATE SYNC ---

    

        

    

        

    

                // --- BUG FIX: Send the map BEFORE creating the offer ---

    

                // Build the map of all known stream IDs to user IDs

    

                const streamIdToUserIdMap = {};

    

                userTracks.current.forEach((trackInfo, userId) => {

    

                    streamIdToUserIdMap[trackInfo.stream.id] = userId;

    

                });

    

                if (localStream) {

    

                    streamIdToUserIdMap[localStream.id] = user.id;

    

                }

    

        

    

                // Send the map to the new peer so they know who the upcoming tracks belong to

    

                sendMessage({

    

                    type: 'stream-id-map',

    

                    payload: {

    

                        targetUserId: remoteUser.id,

    

                        ...streamIdToUserIdMap

    

                    },

    

                });

    

                // --- END BUG FIX ---

    

        

    

                conn.peerConnection.ontrack = (event) => {

    

                    const remoteTrack = event.track;

    

                    const remoteStream = event.streams[0];

    

                    console.log(`Host: Received track from new peer ${remoteUser.id}`);

    

                    

    

                    userTracks.current.set(remoteUser.id, { track: remoteTrack, stream: remoteStream });

    

        

    

                    // Relay this new track to all OTHER existing peers

    

                    Object.entries(peerConnections.current).forEach(([peerId, peerConn]) => {

    

                        if (String(peerId) !== String(remoteUser.id)) {

    

                            console.log(`Host: Relaying track from ${remoteUser.id} to ${peerId}.`);

    

                            // Also send a map update to the existing peer

    

                            const mapUpdate = { [remoteStream.id]: remoteUser.id };

    

                             sendMessage({

    

                                type: 'stream-id-map',

    

                                payload: {

    

                                    targetUserId: peerId,

    

                                    ...mapUpdate

    

                                },

    

                            });

    

                            peerConn.addTrack(remoteTrack, remoteStream);

    

                            peerConn.createOffer(); // Renegotiate to send the new track

    

                        }

    

                    });

    

        

    

                    setParticipants(prev => ({

    

                        ...prev,

    

                        [remoteUser.id]: { ...prev[remoteUser.id], stream: remoteStream }

    

                    }));

    

                };

    

        

    

                conn.createOffer();

    

            }, [user?.id, localStream, sendMessage, handleDataMessage, participants]);

    

        

    

            // --- PARTICIPANT-SPECIFIC LOGIC ---

    

            const handleNewPeerForParticipant = useCallback((payload) => {

    

                const remoteUser = payload.user;

    

                if (String(remoteUser.id) === String(user.id)) return;

    

                

    

                console.log(`Participant: Notified of new peer ${remoteUser.username} (${remoteUser.id})`);

    

                setParticipants(prev => ({ ...prev, [remoteUser.id]: { user: remoteUser, stream: null, isMuted: false, isSpeaking: false } }));

    

            }, [user?.id]);

    

        

    

            const handleOfferForParticipant = useCallback(async (payload) => {

    

                const hostId = payload.senderId;

    

                if (!localStream) return;

    

        

    

                let conn = peerConnections.current[hostId];

    

                if (!conn) {

    

                    // For participants, the data channel message is from the host.
            // The handler needs the host's ID as a fallback for direct messages.
            const onDataMessageForConn = (msg) => handleParticipantDataMessage(msg, hostId);

    

                    conn = new Connection(user.id, hostId, sendMessage, ICE_SERVERS, onDataMessageForConn);

    

                    peerConnections.current[hostId] = conn;

    

                    localStream.getTracks().forEach(track => conn.addTrack(track, localStream));

    

        

    

                    conn.peerConnection.ontrack = (event) => {

    

                        const newStream = event.streams[0];

    

                        if (newStream) {

    

                            console.log(`[onTrack] Participant received a stream with ID: ${newStream.id}`);

    

                            const userId = streamIdToUserIdMapping.current[newStream.id];

    

                            if (userId) {

    

                                console.log(`[onTrack] Found mapping for stream ${newStream.id} -> userId ${userId}.`);

    

                                setParticipants(prev => ({

    

                                    ...prev,

    

                                    [userId]: { ...(prev[userId] || {}), stream: newStream }

    

                                }));

    

                            } else {

    

                                // SAFETY NET for race condition

    

                                console.warn(`[onTrack] No mapping found for stream ${newStream.id}. Storing temporarily.`);

    

                                setParticipants(prev => ({

    

                                    ...prev,

    

                                    [newStream.id]: { ...(prev[newStream.id] || {}), stream: newStream }

    

                                }));

    

                            }

    

                        }

    

                    };

    

                }

    

                await conn.handleOffer(payload.sdp);

    

            }, [user?.id, localStream, sendMessage, handleParticipantDataMessage]);

    

        

    

            // --- COMMON EVENT LISTENERS ---

    

            useEffect(() => {

    

                if (!user) return;

    

        

    

                const handleAnswer = (p) => peerConnections.current[p.senderId]?.handleAnswer(p.sdp);

    

                const handleIceCandidate = (p) => peerConnections.current[p.senderId]?.handleIceCandidate(p.candidate);

    

                

    

                const handleStreamIdMap = (payload) => {

    

                    const { senderId, targetUserId, ...mapData } = payload;

    

                    const newMapping = { ...streamIdToUserIdMapping.current, ...mapData };

    

                    streamIdToUserIdMapping.current = newMapping;

    

        

    

                    // Explicitly remap any orphaned streams that we now have a mapping for.

    

                    setParticipants(prev => {

    

                        let needsUpdate = false;

    

                        const newParticipants = { ...prev };

    

                        for (const streamId in mapData) {

    

                            if (Object.prototype.hasOwnProperty.call(newParticipants, streamId)) {

    

                                const userId = mapData[streamId];

    

                                console.log(`[Remapping] Found userId ${userId} for orphaned stream ${streamId}.`);

    

                                

    

                                const existingParticipant = newParticipants[userId] || {};

    

                                const temporaryData = newParticipants[streamId];

    

                                newParticipants[userId] = { ...existingParticipant, ...temporaryData };

    

        

    

                                delete newParticipants[streamId];

    

                                needsUpdate = true;

    

                            }

    

                        }

    

                        return needsUpdate ? newParticipants : prev;

    

                    });

    

                };

    

                

    

                const handlePeerDisconnected = (payload) => {

    

                    const { userId } = payload;

    

                    if (!userId) return;

    

                    if (peerConnections.current[userId]) {

    

                        peerConnections.current[userId].close();

    

                        delete peerConnections.current[userId];

    

                    }

    

                    if (userTracks.current.has(userId)) {

    

                        userTracks.current.delete(userId);

    

                    }

    

                    setParticipants(prev => {

    

                        const newState = { ...prev };

    

                        delete newState[userId];

    

                        return newState;

    

                    });

    

                };

    

                

    

                const handleHostChanged = (p) => {

    

                    cleanupPeerConnections(); // Only clean connections, not participant state

    

                    setCurrentRoom(prev => (prev ? { ...prev, hostId: p.newHostId } : null));

    

                };

    

        

    

                const handleRoomInfo = (payload) => {

    

                    setCurrentRoom(payload.room);

    

                    const initialParticipants = {};

    

                    payload.participants.forEach(p => {

    

                        if (p.id !== user.id) {

    

                            initialParticipants[p.id] = { user: p, stream: null, isMuted: false, isSpeaking: false };

    

                        }

    

                    });

    

                    setParticipants(initialParticipants);

    

                };

    

        

    

                const handleMuteStatusChanged = (payload) => {

    

                    setParticipants(prev => {

    

                        if (!prev[payload.userId]) return prev; // Don't add new users from this event

    

                        return {

    

                            ...prev,

    

                            [payload.userId]: { ...prev[payload.userId], isMuted: payload.isMuted }

    

                        };

    

                    });

    

                     // If host, relay this to other peers to ensure sync

    

                    if (isHost) {

    

                        Object.entries(peerConnections.current).forEach(([peerId, conn]) => {

    

                            // Don't send to the client who originated the change if it was a broadcast

    

                            if (payload.senderId && String(peerId) === String(payload.senderId)) return;

    

                            

    

                            sendMessage({

    

                                type: 'mute-status-changed',

    

                                payload: {

    

                                    targetUserId: peerId,

    

                                    userId: payload.userId,

    

                                    isMuted: payload.isMuted

    

                                }

    

                            });

    

                        });

    

                    }

    

                };

    

        

    

                addMessageListener('answer', handleAnswer);

    

                addMessageListener('ice-candidate', handleIceCandidate);

    

                addMessageListener('stream-id-map', handleStreamIdMap);

    

                addMessageListener('user-left', handlePeerDisconnected); // Changed from 'peer-disconnected'

    

                addMessageListener('host-changed', handleHostChanged);

    

                addMessageListener('room-info', handleRoomInfo);

    

                addMessageListener('mute-status-changed', handleMuteStatusChanged);

    

        

    

                if (currentRoom) {

    

                    if (isHost) {

    

                        addMessageListener('user-joined', handleNewPeerForHost);

    

                    } else {

    

                        addMessageListener('offer', handleOfferForParticipant);

    

                        addMessageListener('user-joined', handleNewPeerForParticipant);

    

                    }

    

                }

    

        

    

                return () => {

    

                    removeMessageListener('answer', handleAnswer);

    

                    removeMessageListener('ice-candidate', handleIceCandidate);

    

                    removeMessageListener('stream-id-map', handleStreamIdMap);

    

                    removeMessageListener('user-left', handlePeerDisconnected); // Changed from 'peer-disconnected'

    

                    removeMessageListener('host-changed', handleHostChanged);

    

                    removeMessageListener('room-info', handleRoomInfo);

    

                    removeMessageListener('mute-status-changed', handleMuteStatusChanged);

    

                    if (currentRoom) {

    

                        if (isHost) {

    

                            removeMessageListener('user-joined', handleNewPeerForHost);

    

                        } else {

    

                            removeMessageListener('offer', handleOfferForParticipant);

    

                            removeMessageListener('user-joined', handleNewPeerForParticipant);

    

                        }

    

                    }

    

                };

    

            }, [user, currentRoom, isHost, addMessageListener, removeMessageListener, handleNewPeerForHost, handleOfferForParticipant, handleNewPeerForParticipant, cleanupPeerConnections, setCurrentRoom]);

    

        

    

        const setLocalAudioMuted = useCallback((muted) => {

            if (!localStream) return;

            localStream.getAudioTracks().forEach(track => track.enabled = !muted);

            sendMessage({ type: 'mute-status-changed', payload: { userId: user.id, isMuted: muted } });

        }, [localStream, user?.id, sendMessage]);

    

        return { participants, cleanupAndResetAll, setLocalAudioMuted, isLocalUserSpeaking };

    }

    