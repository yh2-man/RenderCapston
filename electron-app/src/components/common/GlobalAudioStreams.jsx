import React, { useRef, useEffect } from 'react';

const AudioStream = ({ stream, isMuted }) => {
    const audioRef = useRef(null);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.srcObject = stream;
        }
    }, [stream]);

    // The `muted` attribute's presence means true. It must be absent for audio to play.
    // We only add the muted property to the element if isMuted is actually true.
    const audioProps = {
        ref: audioRef,
        autoPlay: true,
        playsInline: true,
    };

    if (isMuted) {
        audioProps.muted = true;
    }

    return <audio {...audioProps} />;
};

const GlobalAudioStreams = ({ participants, isGlobalMuted }) => {
    // participants is an object: { userId: { stream, user, isMuted } }
    const streams = Object.entries(participants || {});

    return (
        <div className="global-audio-streams" style={{ display: 'none' }}>
            {streams.map(([userId, participantInfo]) => {
                if (!participantInfo || !participantInfo.stream) {
                    return null;
                }
                // participantInfo.isMuted is the individual mute status from the sender
                // isGlobalMuted is the local user's choice to mute all incoming audio
                const isEffectivelyMuted = isGlobalMuted || participantInfo.isMuted;

                return (
                    <AudioStream
                        key={userId}
                        stream={participantInfo.stream}
                        isMuted={isEffectivelyMuted}
                    />
                );
            })}
        </div>
    );
};

export default GlobalAudioStreams;