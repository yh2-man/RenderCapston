import { useEffect, useRef, useState, useCallback } from 'react';

export const useWebSocketClient = (url) => {
    const ws = useRef(null);
    const [isConnected, setIsConnected] = useState(false);
    const messageListeners = useRef(new Map());
    const reconnectTimeoutRef = useRef(null); // For managing reconnect timer
    const reconnectAttemptsRef = useRef(0); // For exponential backoff

    const addMessageListener = useCallback((type, listener) => {
        if (!messageListeners.current.has(type)) {
            messageListeners.current.set(type, new Set());
        }
        messageListeners.current.get(type).add(listener);
    }, []);

    const removeMessageListener = useCallback((type, listener) => {
        if (messageListeners.current.has(type)) {
            messageListeners.current.get(type).delete(listener);
            if (messageListeners.current.get(type).size === 0) {
                messageListeners.current.delete(type);
            }
        }
    }, []);

    const sendMessage = useCallback((messageObject) => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify(messageObject));
        } else {
            console.warn('WebSocket is not connected. Message not sent:', messageObject);
        }
    }, []);

    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
        }
        if (ws.current) {
            ws.current.shouldReconnect = false; // Prevent the onclose handler from reconnecting
            ws.current.close();
        }
    }, []);

    const connect = useCallback(() => {
        if (!url) return;
        // Clear any existing reconnect timer before attempting a new connection
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        // Only connect if not already connected or connecting
        if (ws.current && (ws.current.readyState === WebSocket.CONNECTING || ws.current.readyState === WebSocket.OPEN)) {
            return;
        }

        console.log('Attempting to connect WebSocket...');
        const socket = new WebSocket(url);
        ws.current = socket;

        socket.onopen = () => {
            console.log('WebSocket connected.');
            setIsConnected(true);
            reconnectAttemptsRef.current = 0; // Reset attempts on successful connection
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type && messageListeners.current.has(data.type)) {
                    messageListeners.current.get(data.type).forEach(listener => listener(data.payload));
                }
            } catch (error) {
                console.error('Failed to parse message:', error);
            }
        };

        socket.onclose = () => {
            console.log('WebSocket disconnected.');
            setIsConnected(false);

            // Only attempt to reconnect if the component is still mounted
            // and it's not a manual close from cleanup
            if (ws.current && ws.current.shouldReconnect !== false) { // Use a flag to prevent reconnect on manual close
                const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
                console.log(`Will attempt to reconnect in ${delay / 1000}s`);
                reconnectAttemptsRef.current++;
                reconnectTimeoutRef.current = setTimeout(connect, delay);
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            // onclose will be called after onerror, so no need to setIsConnected(false) here
        };
    }, [url]); // connect function only depends on url

    useEffect(() => {
        // Delay the initial connection attempt slightly to ensure the Electron renderer is fully ready
        connect();

        return () => {
            // Stop any pending reconnection attempts when the hook unmounts.
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            // The manual `disconnect` function is now responsible for permanent closure.
            // We no longer set `shouldReconnect = false` here, to allow for auto-reconnect
            // if the server drops the connection for reasons other than a manual logout.
        };
    }, [connect]); // useEffect depends on the stable 'connect' function

    return { isConnected, sendMessage, addMessageListener, removeMessageListener, disconnect, connect };
};