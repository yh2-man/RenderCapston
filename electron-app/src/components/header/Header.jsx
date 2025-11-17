import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import { useFriends } from '../../context/FriendsContext'; // Import useFriends
import './Header.css';

const Header = () => {
  const { user } = useContext(AuthContext);
  const { setActiveConversation } = useFriends(); // Get the setter for the active conversation
  const navigate = useNavigate();

  const handleLogoClick = () => {
    // First, close any active DM conversation
    setActiveConversation(null);
    // Then, navigate to the lobby
    navigate('/lobby');
  };

  return (
    <header className="app-header">
      <div className="header-section header-left">
        <span className="header-logo" onClick={handleLogoClick}>
          OurChat
        </span>
      </div>
      <div className="header-section header-center">
        <div className="header-ad-space">
          {/* Ad content goes here */}
        </div>
      </div>
      <div className="header-section header-right">
        {user && (
          <div className="settings-icon" onClick={() => navigate('/settings')} title="설정">
            ⚙️
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
