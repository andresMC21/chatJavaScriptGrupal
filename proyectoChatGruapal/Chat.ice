module Chat {

    // Enum for message types
    enum MessageTypeEnum {
        TEXT,
        SYSTEM,
        AUDIO,
        VOICECALL
    }

    // DTO for messages
    struct MessageDTO {
        string id;
        string senderId;
        string senderName;
        string content;
        long timestamp;
        MessageTypeEnum type;
    }

    // DTO for users
    struct UserDTO {
        string id;
        string username;
        bool isOnline;
        long connectedAt;
    }
    
    // --- NUEVO ORDEN ---

    // 1. Declaración de tipos usados en otras estructuras
    sequence<string> StringList; // Define StringList

    // 2. DTO for groups (Ahora GroupDTO está definido antes de GroupList)
    struct GroupDTO {
        string id;
        string name;
        StringList memberIds; // StringList ya existe
    }

    // 3. Secuencias (Ahora todos los tipos subyacentes existen)
    sequence<MessageDTO> MessageList;
    sequence<UserDTO> UserList;
    sequence<GroupDTO> GroupList; // GroupDTO ya existe
    
    // --- FIN DEL NUEVO ORDEN ---

    // Observer interface
    interface Observer {
        void updateMessages(MessageList messages);
        void updateUsers(UserList users);
    }

    // Subject interface
    interface Subject {
        void attachObserver(Observer* obs);
        void detachObserver(Observer* obs);
    }

    // Main chat service (Ahora GroupList existe)
    interface ChatService {
        // Users
        UserDTO joinChat(string username);
        void leaveChat(string userId);
        UserList getUsers();

        // Messages
        void sendMessage(string userId, string content, MessageTypeEnum type);
        MessageList getMessages();

        // Private Messages
        void sendPrivateMessage(string userId, string targetUserId, string content, MessageTypeEnum type);
        MessageList getPrivateMessages(string userId, string targetUserId);

        // Groups
        GroupDTO createGroup(string groupName, string creatorId);
        void joinGroup(string groupId, string userId);
        GroupList getGroups(); // GroupList ya existe

        // Voice calls
        void startVoiceCall(string userId, string targetUserId);
        void endVoiceCall(string userId);
        void answerVoiceCall(string userId);
        void rejectVoiceCall(string userId);

        // Señalización WebRTC
        void sendWebRTCSignal(string userId, string targetUserId, string signalData);
        void sendWebRTCAnswer(string userId, string targetUserId, string signalData);

        // Private Mesage Groups
        void sendGroupMessage(string groupId, string userId, string content, MessageTypeEnum type);
        MessageList getGroupMessages(string groupId);
    }

};