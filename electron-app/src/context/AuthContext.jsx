import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebSocketClient } from '../hooks/useWebSocketClient';
import { useNotification } from './NotificationContext';
import PropTypes from 'prop-types';

export const AuthContext = createContext(null);

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(null);
    const [currentRoom, setCurrentRoom] = useState(null); // State for current room
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const { addNotification } = useNotification();
    const { isConnected, sendMessage, addMessageListener, removeMessageListener, disconnect, connect } = useWebSocketClient('ws://localhost:3001');
    const keepLoggedInRef = useRef(true); // Ref to store login persistence preference

    // Effect 1: Runs once on mount to get token and initiate connection
    useEffect(() => {
        const bootstrapAuth = async () => {
            try {
                const storedToken = await window.electron.store.get('token');
                if (storedToken) {
                    setToken(storedToken);
                    connect(); // Initiate connection
                } else {
                    setLoading(false); // No token, not loading.
                }
            } catch (error) {
                console.error("Failed to bootstrap auth:", error);
                setLoading(false);
            }
        };
        bootstrapAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Should only run once.

    // Effect 2: Runs when token and connection are ready
    useEffect(() => {
        if (token && isConnected) {
            const authenticateAndLoad = async () => {
                // 1. Authenticate WebSocket
                sendMessage({ type: 'reauthenticate', payload: { token } });

                // 2. Fetch user profile
                const response = await fetch('http://localhost:3001/api/me', {
                    headers: { 'Authorization': `Bearer ${token}` },
                });

                if (response.ok) {
                    const userData = await response.json();
                    setUser(userData);
                } else {
                    // Token is invalid, clear it
                    await window.electron.store.delete('token');
                    setUser(null);
                    setToken(null);
                }
                setLoading(false); // Finish loading
            };
            authenticateAndLoad();
        }
    }, [token, isConnected, sendMessage]);


    // Effect 3: Manages WebSocket message listeners
    useEffect(() => {
        if (!isConnected) return;

        const handleGenericMessage = (type) => (data) => {
            addNotification(data.message, type);
        };

        const handleLoginSuccess = async (data) => {
            addNotification('로그인 성공!', 'success');
            setUser(data.user);
            setToken(data.token);
            if (keepLoggedInRef.current) {
                await window.electron.store.set('token', data.token);
            }
            navigate('/lobby');
        };

        const handleUpdateProfileSuccess = (data) => {
            addNotification(data.message, 'success');
            if (data.user) {
                setUser(prev => ({ ...prev, ...data.user }));
            }
        };

        const listeners = {
            'login-success': handleLoginSuccess,
            'login-failure': handleGenericMessage('error'),
            'signup-failure': handleGenericMessage('error'),
            'signup-needs-verification': handleGenericMessage('info'),
            'email-verification-success': handleGenericMessage('success'),
            'email-verification-failure': handleGenericMessage('error'),
            'update-profile-success': handleUpdateProfileSuccess,
            'update-profile-failure': handleGenericMessage('error'),
        };

        Object.entries(listeners).forEach(([type, handler]) => addMessageListener(type, handler));

        return () => {
            Object.entries(listeners).forEach(([type, handler]) => removeMessageListener(type, handler));
        };
    }, [isConnected, addMessageListener, removeMessageListener, navigate, addNotification]);
    
    const loginAndSetPersistence = useCallback((email, password, keepLoggedIn) => {
        keepLoggedInRef.current = keepLoggedIn;
        connect(); // Ensure connection is active before sending message
        // A small delay might be needed if the connection is not instant
        setTimeout(() => {
            sendMessage({ type: 'login', payload: { email, password } });
        }, 100); // 100ms delay
    }, [sendMessage, connect]);

    const logout = useCallback(async () => {
        // Full cleanup of all session-related resources
        if (disconnect) {
            disconnect();
        }
        
        await window.electron.store.delete('token');
        setUser(null);
        setToken(null);
        setCurrentRoom(null); // Also clear the current room
        navigate('/');
    }, [navigate, disconnect]);

    const updateUser = useCallback((updatedFields) => {
        setUser(prev => ({ ...prev, ...updatedFields }));
    }, []);

    const value = useMemo(() => ({
        user,
        token,
        loading, // Expose loading state
        currentRoom, // Expose currentRoom
        setCurrentRoom, // Expose setCurrentRoom
        isConnected,
        sendMessage,
        addMessageListener,
        removeMessageListener,
        logout,
        updateUser,
        loginAndSetPersistence, // Expose the new login function
        disconnect, // Expose disconnect for good measure
        connect, // Expose connect
    }), [user, token, loading, currentRoom, isConnected, sendMessage, addMessageListener, removeMessageListener, logout, updateUser, loginAndSetPersistence, disconnect, connect]);

    if (loading) {
        return <div>Loading...</div>;
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};