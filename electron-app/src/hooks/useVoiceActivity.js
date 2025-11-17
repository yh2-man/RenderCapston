import { useState, useEffect, useRef } from 'react';

export function useVoiceActivity(stream, options) {
    // Use default empty object for options if not provided, and provide default values
    const { onSpeaking, onStoppedSpeaking, threshold = 1, delay = 150 } = options || {};
    const [isSpeaking, setIsSpeaking] = useState(false);
    
    // Use refs to hold values that change within the loop but shouldn't re-trigger the effect
    const animationFrame = useRef(null);
    const speakingTimeout = useRef(null);
    const isSpeakingRef = useRef(false);

    useEffect(() => {
        // Update the ref whenever the state changes
        isSpeakingRef.current = isSpeaking;
    }, [isSpeaking]);

    useEffect(() => {
        console.log('[useVoiceActivity] Processing stream:', stream);
        if (!stream || !stream.getAudioTracks().length || stream.getAudioTracks().every(t => !t.enabled)) {
            if (isSpeakingRef.current) {
                setIsSpeaking(false);
                onStoppedSpeaking?.();
            }
            return;
        }

        let audioContext;
        let analyser;
        let source;

        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.smoothingTimeConstant = 0.5;
            analyser.fftSize = 512;
            source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            const checkVolume = () => {
                analyser.getByteTimeDomainData(dataArray);
                let sumSquares = 0.0;
                for (const amplitude of dataArray) {
                    const val = (amplitude / 128.0) - 1.0; // Normalize to -1.0 to 1.0
                    sumSquares += val * val;
                }
                const rms = Math.sqrt(sumSquares / dataArray.length);
                const volume = rms * 100; // Scale to a 0-100 range

                if (volume > threshold) {
                    // --- User is speaking ---
                    clearTimeout(speakingTimeout.current);
                    speakingTimeout.current = null;
                    if (!isSpeakingRef.current) {
                        setIsSpeaking(true);
                        onSpeaking?.();
                    }
                } else {
                    // --- User is not speaking ---
                    if (isSpeakingRef.current && !speakingTimeout.current) {
                        speakingTimeout.current = setTimeout(() => {
                            setIsSpeaking(false);
                            onStoppedSpeaking?.();
                        }, delay);
                    }
                }
                animationFrame.current = requestAnimationFrame(checkVolume);
            };

            animationFrame.current = requestAnimationFrame(checkVolume);

        } catch (error) {
            console.error('Error setting up audio processor for voice activity:', error);
        }

        return () => {
            if (animationFrame.current) {
                cancelAnimationFrame(animationFrame.current);
            }
            if (speakingTimeout.current) {
                clearTimeout(speakingTimeout.current);
            }
            if (source) {
                source.disconnect();
            }
            if (audioContext && audioContext.state !== 'closed') {
                audioContext.close();
            }
        };
    }, [stream, threshold, delay, onSpeaking, onStoppedSpeaking]);

    return { isSpeaking };
}

export default useVoiceActivity;