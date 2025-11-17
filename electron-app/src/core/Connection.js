/**
 * Represents a single RTCPeerConnection to another user.
 * Manages the creation and negotiation of the connection.
 */
export class Connection {
    constructor(localId, remoteId, sendMessage, rtcConfig, onDataMessage) {
        this.localId = localId;
        this.remoteId = remoteId;
        this.sendMessage = sendMessage;
        this.peerConnection = new RTCPeerConnection(rtcConfig);
        this.audioSender = null; // To store the RTCRtpSender for the audio track
        this.dataChannel = null;
        this.onDataMessage = onDataMessage;

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendMessage({
                    type: 'ice-candidate',
                    payload: {
                        targetUserId: this.remoteId,
                        candidate: event.candidate,
                    },
                });
            }
        };

        // Handle data channel created by the remote peer
        this.peerConnection.ondatachannel = (event) => {
            console.log(`[Connection] Received data channel "${event.channel.label}" from ${this.remoteId}`);
            this.dataChannel = event.channel;
            this.dataChannel.onmessage = (e) => {
                if (this.onDataMessage) {
                    this.onDataMessage(JSON.parse(e.data));
                }
            };
        };
    }

    createDataChannel(label) {
        if (this.dataChannel) return;
        console.log(`[Connection] Creating data channel "${label}" to ${this.remoteId}`);
        this.dataChannel = this.peerConnection.createDataChannel(label);
        this.dataChannel.onmessage = (event) => {
            if (this.onDataMessage) {
                this.onDataMessage(JSON.parse(event.data));
            }
        };
        // Note: onopen/onclose handlers can be added here for debugging if needed
    }

    sendData(data) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(data));
        }
    }

    addTrack(track, stream) {
        const sender = this.peerConnection.addTrack(track, stream);
        if (track.kind === 'audio') {
            this.audioSender = sender;
        }
        return sender;
    }

    setAudioEnabled(enabled) {
        if (this.audioSender && this.audioSender.track) {
            this.audioSender.track.enabled = enabled;
        }
    }

    /**
     * Creates and sends an SDP offer to the remote peer.
     */
    async createOffer() {
        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            this.sendMessage({
                type: 'offer',
                payload: {
                    targetUserId: this.remoteId,
                    sdp: this.peerConnection.localDescription,
                },
            });
        } catch (e) {
            console.error('Error creating offer:', e);
        }
    }

    /**
     * Handles an incoming SDP offer, creates an answer, and sends it.
     * @param {RTCSessionDescriptionInit} sdp The SDP offer from the remote peer.
     */
    async handleOffer(sdp) {
        try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.sendMessage({
                type: 'answer',
                payload: {
                    targetUserId: this.remoteId,
                    sdp: this.peerConnection.localDescription,
                },
            });
        } catch (e) {
            console.error('Error handling offer:', e);
        }
    }

    /**
     * Handles an incoming SDP answer.
     * @param {RTCSessionDescriptionInit} sdp The SDP answer from the remote peer.
     */
    async handleAnswer(sdp) {
        try {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        } catch (e) {
            console.error('Error handling answer:', e);
        }
    }

    /**
     * Adds an ICE candidate received from the remote peer.
     * @param {RTCIceCandidateInit} candidate The ICE candidate.
     */
    async handleIceCandidate(candidate) {
        try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Error adding received ICE candidate', e);
        }
    }

    /**
     * Closes the peer connection.
     */
    close() {
        this.peerConnection.close();
    }
}