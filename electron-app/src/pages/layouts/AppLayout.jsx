import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from '../../components/header/Header';
import Footer from '../../components/common/Footer';
import FriendsPanel from '../../components/friends/FriendsPanel';
import SettingsPanel from '../../components/settings/SettingsPanel';
import GlobalAudioStreams from '../../components/common/GlobalAudioStreams';
import MicLoopbackPlayer from '../../components/common/MicLoopbackPlayer';
import DirectMessagePanel from '../../components/dms/DirectMessagePanel'; // Import DM Panel
import { useFriends } from '../../context/FriendsContext'; // Import useFriends
import { useWebRTC } from '../../context/WebRTCContext';
import './AppLayout.css';

const AppLayout = () => {
  const location = useLocation();
  const { activeConversation } = useFriends();
  const isSettingsPage = location.pathname.startsWith('/settings');
  const { participants, isGlobalMuted } = useWebRTC();

  return (
    <div className="app-container">
      <Header />
      <div className="main-content-with-friends">
        {isSettingsPage ? <SettingsPanel /> : <FriendsPanel />}
        <main className="main-content">
          {activeConversation ? <DirectMessagePanel /> : <Outlet />}
        </main>
      </div>
      <Footer />
      <GlobalAudioStreams participants={participants} isGlobalMuted={isGlobalMuted} />
      <MicLoopbackPlayer />
    </div>
  );
};

export default AppLayout;
