import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext'; // Import useAuth

const FriendsContext = createContext();

export const useFriends = () => useContext(FriendsContext);

export const FriendsProvider = ({ children }) => {
    const [friends, setFriends] = useState([]);
    const [pendingRequests, setPendingRequests] = useState({ incoming: [], outgoing: [] });
    const [blockedUsers, setBlockedUsers] = useState([]);
    const [directMessages, setDirectMessages] = useState({}); // Store messages by friend ID
    const [unreadMessages, setUnreadMessages] = useState({}); // Store unread message counts by friend ID
    const [activeConversation, setActiveConversation] = useState(null); // ID of the friend in the active DM

    const { user, isConnected, sendMessage, addMessageListener, removeMessageListener } = useAuth();

    // Ref to hold the current active conversation to avoid re-running the main effect
    const activeConversationRef = useRef(activeConversation);
    useEffect(() => {
        activeConversationRef.current = activeConversation;
    }, [activeConversation]);

    useEffect(() => {
        if (!isConnected || !user) return;

        const handleFriendsList = (data) => {
            setFriends(data.accepted || []);
            setPendingRequests(data.pending || { incoming: [], outgoing: [] });
            setBlockedUsers(data.blocked || []);
        };

        const handleFriendUpdate = (data) => {
            if (data.status === 'accepted') {
                const newFriend = data.user;
                setFriends(prev => [...prev, newFriend]);
                setPendingRequests(prev => ({
                    incoming: prev.incoming.filter(u => u.id !== newFriend.id),
                    outgoing: prev.outgoing.filter(u => u.id !== newFriend.id),
                }));
            }
        };

        const handleFriendRemoved = (data) => {
            const { removedFriendId } = data;
            setFriends(prev => prev.filter(f => f.id !== removedFriendId));
            setDirectMessages(prev => {
                const newDMs = { ...prev };
                delete newDMs[removedFriendId];
                return newDMs;
            });
            // Use the ref to get the current value without adding a dependency
            if (activeConversationRef.current === removedFriendId) {
                setActiveConversation(null);
            }
        };
        
        const handleFriendRequestReceived = (data) => {
            setPendingRequests(prev => ({
                ...prev,
                incoming: [...prev.incoming.filter(u => u.id !== data.id), data]
            }));
        };

        const handleDirectMessageReceived = (message) => {
            const { sender_id } = message;
            setDirectMessages(prev => ({
                ...prev,
                [sender_id]: [...(prev[sender_id] || []), message]
            }));
            // Use the ref to get the current value without adding a dependency
            if (sender_id !== activeConversationRef.current) {
                setUnreadMessages(prev => ({
                    ...prev,
                    [sender_id]: (prev[sender_id] || 0) + 1,
                }));
            }
        };

        const handleDirectMessageSent = (message) => {
            const { receiver_id } = message;
            setDirectMessages(prev => ({
                ...prev,
                [receiver_id]: [...(prev[receiver_id] || []), message]
            }));
        };

        const listeners = {
            'friends-list-success': handleFriendsList,
            'friend-update': handleFriendUpdate,
            'friend-removed': handleFriendRemoved,
            'friend-request-received': handleFriendRequestReceived,
            'direct-message-received': handleDirectMessageReceived,
            'direct-message-sent': handleDirectMessageSent,
        };

        Object.entries(listeners).forEach(([type, handler]) => addMessageListener(type, handler));
        sendMessage({ type: 'get-friends-list' });

        return () => {
            Object.entries(listeners).forEach(([type, handler]) => removeMessageListener(type, handler));
        };
    }, [isConnected, user, sendMessage, addMessageListener, removeMessageListener]);

    const sendFriendRequest = (fullTag) => sendMessage({ type: 'friend-request', payload: { fullTag } });
    const acceptFriendRequest = (requesterId) => sendMessage({ type: 'accept-friend-request', payload: { requesterId } });
    const declineFriendRequest = (otherUserId) => sendMessage({ type: 'decline-friend-request', payload: { otherUserId } });
    const removeFriend = (friendId) => sendMessage({ type: 'remove-friend', payload: { friendId } });
    const sendDirectMessage = (receiverId, content) => sendMessage({ type: 'direct-message', payload: { receiverId, content } });

    const markMessagesAsRead = useCallback((friendId) => {
        if (unreadMessages[friendId] > 0) {
            setUnreadMessages(prev => ({ ...prev, [friendId]: 0 }));
        }
    }, [unreadMessages]);

    const value = {
        friends,
        pendingRequests,
        blockedUsers,
        directMessages,
        unreadMessages,
        activeConversation,
        setActiveConversation,
        sendFriendRequest,
        acceptFriendRequest,
        declineFriendRequest,
        removeFriend,
        sendDirectMessage,
        markMessagesAsRead,
    };

    return (
        <FriendsContext.Provider value={value}>
            {children}
        </FriendsContext.Provider>
    );
};
