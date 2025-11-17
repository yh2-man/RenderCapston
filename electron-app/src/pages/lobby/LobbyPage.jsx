import React, { useState, useEffect, useCallback } from 'react';
import { requestRooms, createRoom } from '../../api/roomApi';
import { useAuth } from '../../context/AuthContext';
import RoomCard from '../../components/lobby/RoomCard';
import Button from '../../components/common/Button';
import Input from '../../components/common/Input';
import CreateRoomModal from '../../components/lobby/CreateRoomModal';
// import { CATEGORIES } from '../../constants/categories'; // Removed
import AutocompleteSelect from '../../components/common/AutocompleteSelect';
import { useNotification } from '../../context/NotificationContext';
import { useNavigate } from 'react-router-dom';
import ActiveCallCard from '../../components/lobby/ActiveCallCard';

const LobbyPage = () => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [roomNameFilter, setRoomNameFilter] = useState('');
  const [categories, setCategories] = useState([]); // New state for categories
  
  const allCategoriesLabel = '모든 카테고리';
  const [categoryFilter, setCategoryFilter] = useState(allCategoriesLabel);

  const { user, sendMessage, addMessageListener, removeMessageListener, isConnected } = useAuth();
  const { addNotification } = useNotification();
  const navigate = useNavigate();

  // Function to request categories from server
  const requestCategories = useCallback(() => {
    sendMessage({ type: 'get-categories' });
  }, [sendMessage]);

  useEffect(() => {
    const handleRoomsList = (roomList) => {
      const formattedRooms = roomList.map(room => ({
        ...room,
        roomId: room.id,
        roomName: room.name, // Use name as roomName for consistency
        category: room.categoryName, // Map categoryName to category for filtering
      }));
      setRooms(formattedRooms);
      setLoading(false);
    };

    const handleRoomCreated = (newRoom) => {
      // Only add group rooms to the lobby list
      if (newRoom.roomType === 'group') {
        const formattedNewRoom = {
          ...newRoom,
          roomId: newRoom.id,
          roomName: newRoom.name,
          category: newRoom.categoryName,
        };
        setRooms(prevRooms => [formattedNewRoom, ...prevRooms]);
      }
    };

    const handleRoomDeleted = (payload) => {
      const { roomId } = payload;
      const numericRoomId = parseInt(roomId, 10);
      setRooms(prevRooms => prevRooms.filter(room => room.roomId !== numericRoomId));
    };

    const handleRoomUpdated = (payload) => {
      const { roomId, participantCount, hostId, hostName, roomType, isPrivate } = payload;
      const numericRoomId = parseInt(roomId, 10);
      setRooms(prevRooms =>
        prevRooms.map(room =>
          room.roomId === numericRoomId ? { ...room, participantCount, hostId, hostName, roomType, isPrivate } : room
        )
      );
    };

    const handleCreateRoomSuccess = (newlyCreatedRoom) => {
      console.log('[LobbyPage] handleCreateRoomSuccess called with payload:', JSON.stringify(newlyCreatedRoom, null, 2));
      if (newlyCreatedRoom && newlyCreatedRoom.id) {
        navigate(`/room/${newlyCreatedRoom.id}`);
      } else {
        console.error('Could not navigate to new room, ID is missing in payload:', newlyCreatedRoom);
        addNotification('방 생성 후 자동 입장에 실패했습니다.', 'error');
      }
    };

    const handleCategoriesList = (categoryList) => {
      setCategories(categoryList); // Store full category objects
    };

    addMessageListener('rooms-list', handleRoomsList);
    addMessageListener('room-created', handleRoomCreated);
    addMessageListener('room-deleted', handleRoomDeleted);
    addMessageListener('room-updated', handleRoomUpdated);
    addMessageListener('room-creation-success', handleCreateRoomSuccess);
    addMessageListener('categories-list', handleCategoriesList); // New listener

    return () => {
      removeMessageListener('rooms-list', handleRoomsList);
      removeMessageListener('room-created', handleRoomCreated);
      removeMessageListener('room-deleted', handleRoomDeleted);
      removeMessageListener('room-updated', handleRoomUpdated);
      removeMessageListener('room-creation-success', handleCreateRoomSuccess);
      removeMessageListener('categories-list', handleCategoriesList);
    };
  }, [addMessageListener, removeMessageListener, navigate, addNotification]);

  // Effect for fetching initial data based on connection status
  useEffect(() => {
    if (isConnected) {
      setLoading(true);
      requestRooms(sendMessage); // Request rooms
      requestCategories(); // Request categories
    } else {
      setLoading(true);
      setRooms([]);
      setCategories([]);
    }
  }, [isConnected, sendMessage, requestCategories]);

  const handleCreateRoom = (newRoomData) => {
    console.log('[LobbyPage] handleCreateRoom triggered with:', newRoomData);

    if (!user) {
      console.error("Cannot create room: User not logged in.");
      return;
    }
    if (!newRoomData.roomName.trim()) {
      addNotification('방 제목을 입력해주세요.', 'error');
      return;
    }

    const payload = {
      name: newRoomData.roomName,
      categoryId: newRoomData.categoryId, // Use the ID passed directly from the modal
      maxParticipants: newRoomData.maxParticipants,
      userId: user.id,
      isPrivate: newRoomData.isPrivate || false,
      roomType: 'group',
    };

    console.log('[LobbyPage] Calling createRoom with payload:', payload);
    createRoom(sendMessage, payload);
    setIsModalOpen(false);
  };

  // Update filtering logic for autocomplete
  const filteredRooms = rooms.filter(room => {
    const nameMatch = room.roomName.toLowerCase().includes(roomNameFilter.toLowerCase());
    
    const categoryMatch = categoryFilter === allCategoriesLabel || 
                          categoryFilter === '' || 
                          (room.category && room.category.toLowerCase().includes(categoryFilter.toLowerCase()));

    return nameMatch && categoryMatch;
  });

  return (
    <div className="lobby-page-main">
      <ActiveCallCard />
      <header className="lobby-page-header">
        <div className="room-filters">
          <div className="category-filter-wrapper">
            <AutocompleteSelect
              options={categories.map(cat => cat.name)} // Use category names for options
              value={categoryFilter}
              onChange={setCategoryFilter}
              allOptionsLabel={allCategoriesLabel}
              placeholder="카테고리 검색..."
            />
          </div>
          <div className="room-name-filter-wrapper">
            <Input 
              placeholder="방 제목 검색..."
              value={roomNameFilter}
              onChange={e => setRoomNameFilter(e.target.value)}
            />
          </div>
          <Button className="create-room-button" onClick={() => setIsModalOpen(true)} width="120px">+ 방 생성</Button>
        </div>
      </header>

      <main className="room-list-container custom-scrollbar">
        {loading ? (
          <div className="loading-indicator">방 목록을 불러오는 중...</div>
        ) : (
          <div className="room-list">
            {filteredRooms.map(room => (
              <RoomCard key={room.roomId} room={room} />
            ))}
          </div>
        )}
      </main>

      <CreateRoomModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)} 
        onCreate={handleCreateRoom}
        categories={categories} // Pass categories to modal
      />
    </div>
  );
};

export { LobbyPage };