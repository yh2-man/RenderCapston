import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useWebRTC } from '../../context/WebRTCContext';
import useVoiceActivity from '../../hooks/useVoiceActivity';
import RoomHeaderCard from '../../components/room/RoomHeaderCard';
import ChatPanel from '../../components/room/ChatPanel';
import Button from '../../components/common/Button';
import GlobalAudioStreams from '../../components/common/GlobalAudioStreams';
import './RoomPage.css';

// Updated component to work with the new participants object structure
const ParticipantMedia = ({ participant }) => {
  const { user, stream, isMuted, isSpeaking } = participant;

  // This check is crucial because the user object might not be available instantly
  if (!user) {
    return null; // Or a placeholder
  }

  const avatarUrl = user.profile_image_url || null;

  return (
    <div className={`participant-card ${isSpeaking && !isMuted ? 'speaking' : ''}`}>
      <div className="profile-avatar">
        {avatarUrl ? (
          <img src={avatarUrl} alt={user.username} className="avatar-img" />
        ) : (
          <div className="avatar-placeholder">{user.username.charAt(0)}</div>
        )}
        {isMuted && <div className="mute-indicator">🔇</div>}
      </div>
      <div className="username-display">{user.username}</div>
    </div>
  );
};

const RoomPage = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user, currentRoom, loading, sendMessage, addMessageListener, removeMessageListener } = useAuth();
  
  // Data now comes from useWebRTC, which has the unified state
  const { joinRoom, leaveRoom, participants, setLocalAudioMuted, isGlobalMuted, setIsGlobalMuted, isLocalUserSpeaking } = useWebRTC();

  const [chatMessages, setChatMessages] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  
  // Effect to join the room, now aware of auth loading state
  useEffect(() => {
    if (loading) {
      return; // Wait for authentication to complete
    }
    if (user && roomId) {
      joinRoom(roomId);
    } else {
      // If auth is done and there's still no user, redirect.
      navigate('/lobby');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, roomId, loading, navigate]);

  // Effect for chat, mostly unchanged
  useEffect(() => {
    if (loading || !user || !roomId) return;

    sendMessage({ type: 'get-chat-history', payload: { roomId } });

    const handleNewMessage = (payload) => {
      setChatMessages(prev => [...prev, payload]);
    };
    const handleChatHistory = (payload) => {
      setChatMessages(payload.messages || []);
    };
    const handleMessageDeleted = (payload) => {
        setChatMessages(prev =>
            prev.map(msg =>
                msg.id === payload.messageId
                    ? { ...msg, deleted_at: new Date().toISOString(), content: '삭제된 메시지입니다.' }
                    : msg
            )
        );
    };

    addMessageListener('new-message', handleNewMessage);
    addMessageListener('chat-history', handleChatHistory);
    addMessageListener('message-deleted', handleMessageDeleted);

    return () => {
      removeMessageListener('new-message', handleNewMessage);
      removeMessageListener('chat-history', handleChatHistory);
      removeMessageListener('message-deleted', handleMessageDeleted);
    };
  }, [user, roomId, loading, sendMessage, addMessageListener, removeMessageListener]);


  const handleLeaveRoom = () => {
    leaveRoom();
    navigate('/lobby');
  };

  const handleSendMessage = (content) => {
    if (user && roomId && content.trim()) {
      sendMessage({ type: 'chat-message', payload: { roomId, userId: user.id, content } });
    }
  };

  const handleDeleteMessage = (messageId) => {
    if (user && roomId && messageId) {
        sendMessage({ type: 'delete-message', payload: { messageId } });
    }
  };

  const handleToggleMute = () => {
    setIsMuted(prev => {
      const newMuteState = !prev;
      setLocalAudioMuted(newMuteState);
      return newMuteState;
    });
  };

  if (!currentRoom) {
    return <div className="room-page-layout">Joining room...</div>;
  }

  const localUserAvatarUrl = user?.profile_image_url
    ? `http://localhost:3001${user.profile_image_url}`
    : null;

  return (
    <div className="room-content-wrapper">
      <RoomHeaderCard 
        title={currentRoom.name} 
        onHangUp={handleLeaveRoom} 
      />
      <div className="room-main-content">
        <div className="participants-grid">
          {/* Local User */}
          <div className={`participant-card ${isLocalUserSpeaking && !isMuted ? 'speaking' : ''}`}>
            <div className="profile-avatar">
              {localUserAvatarUrl ? (
                <img src={localUserAvatarUrl} alt={user.username} className="avatar-img" />
              ) : (
                <div className="avatar-placeholder">{user.username.charAt(0)}</div>
              )}
              {isMuted && <div className="mute-indicator">🔇</div>}
            </div>
            <div className="username-display">{user?.username} (Me)</div>
          </div>

          {/* Remote Participants from the unified state */}
          {Object.values(participants)
            .filter(p => p.user) // Filter out participants without user info
            .map(p => (
              <ParticipantMedia 
                key={p.user.id} 
                participant={p} 
              />
            ))}
        </div>
        <div className="call-controls-bar">
          <Button onClick={handleToggleMute} size="small">
            {isMuted ? '음소거 해제' : '음소거'}
          </Button>
          <Button onClick={() => setIsGlobalMuted(!isGlobalMuted)} size="small">
            {isGlobalMuted ? '모든 소리 켜기' : '모든 소리 끄기'}
          </Button>
        </div>
        <ChatPanel roomId={roomId} messages={chatMessages} onSendMessage={handleSendMessage} onDeleteMessage={handleDeleteMessage} />
      </div>
    </div>
  );
};

export default RoomPage;
