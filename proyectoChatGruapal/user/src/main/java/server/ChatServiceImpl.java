package server;

import Chat.*;
import model.*;
import com.zeroc.Ice.Current;
import com.zeroc.IceInternal.Incoming;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CompletionStage;

public class ChatServiceImpl implements ChatService, Subject {
    
    // Almacenamiento usando las clases del modelo existente
    private final Map<String, User> users = new ConcurrentHashMap<>();
    private final List<Message> messages = new CopyOnWriteArrayList<>();
    private final Map<String, UserGroup> groups = new ConcurrentHashMap<>();
    private final List<ObserverPrx> observers = new CopyOnWriteArrayList<>();
    
    // Almacenamiento de mensajes privados: clave = chatId (userId1_userId2 ordenado), valor = lista de mensajes
    private final Map<String, List<Message>> privateMessages = new ConcurrentHashMap<>();

    //Almacenamiento de mensajes privados grupos
    private final Map<String, List<Message>> groupMessages = new ConcurrentHashMap<>();
    
    // Contadores para IDs
    private int userCounter = 0;
    private int messageCounter = 0;
    private int groupCounter = 0;

    // ========== GESTOR DE LLAMADAS ==========
    private final VoiceCallManager callManager = new VoiceCallManager();

    // ========== RESOLVER CONFLICTOS DE INTERFACES ==========
    
    @Override
    public CompletionStage<com.zeroc.Ice.OutputStream> _iceDispatch(Incoming in, Current current) 
            throws com.zeroc.Ice.UserException {
        try {
            return ChatService.super._iceDispatch(in, current);
        } catch (com.zeroc.Ice.OperationNotExistException e) {
            return Subject.super._iceDispatch(in, current);
        }
    }

    @Override
    public String ice_id(Current current) {
        return ChatService.super.ice_id(current);
    }

    @Override
    public String[] ice_ids(Current current) {
        Set<String> allIds = new HashSet<>();
        allIds.addAll(Arrays.asList(ChatService.super.ice_ids(current)));
        allIds.addAll(Arrays.asList(Subject.super.ice_ids(current)));
        return allIds.toArray(new String[0]);
    }

    // ========== MÉTODOS DE USUARIOS ==========
    
    @Override
    public synchronized UserDTO joinChat(String username, Current current) {
        String userId = "user_" + (++userCounter);
        
        User newUser = new User(userId, username);
        newUser.setOnline(true);
        newUser.setConnectedAt(System.currentTimeMillis());
        
        users.put(userId, newUser);
        
        Message systemMsg = new Message(
            "msg_" + (++messageCounter),
            "system",
            "System",
            username + " se ha unido al chat",
            MessageType.SYSTEM
        );
        messages.add(systemMsg);
        
        notifyObservers();
        
        System.out.println("Usuario unido: " + username + " (ID: " + userId + ")");
        
        return newUser.toDTO();
    }

    @Override
    public synchronized void leaveChat(String userId, Current current) {
        User user = users.get(userId);
        if (user != null) {
            user.setOnline(false);

            //metodo para finalizar llamada cunado alguien se va del chat
            if (callManager.isUserInCall(userId)) {
                System.out.println(" Usuario " + user.getUsername() + 
                                  " se desconectó durante una llamada. Finalizando...");
                
                VoiceCall call = callManager.endCall(userId);
                if (call != null) {
                    // Crear mensaje de finalización forzada
                    Message callEndMsg = new Message(
                        "msg_" + (++messageCounter),
                        "system",
                        "System",
                        " Llamada finalizada (usuario desconectado) • Duración: " + 
                        call.getFormattedDuration(),
                        MessageType.VOICECALL
                    );
                    
                    String otherUserId = call.getOtherParticipant(userId);
                    if (otherUserId != null) {
                        String chatId = getPrivateChatId(userId, otherUserId);
                        privateMessages.computeIfAbsent(chatId, k -> new CopyOnWriteArrayList<>())
                                     .add(callEndMsg);
                    }
                }
            }
            
            Message systemMsg = new Message(
                "msg_" + (++messageCounter),
                "system",
                "System",
                user.getUsername() + " ha salido del chat",
                MessageType.SYSTEM
            );
            messages.add(systemMsg);
            
            for (UserGroup group : groups.values()) {
                group.removeParticipant(user);
            }
            
            notifyObservers();
            System.out.println("Usuario salió: " + user.getUsername());
        }
    }

    @Override
    public UserDTO[] getUsers(Current current) {
        return users.values().stream()
            .map(User::toDTO)
            .toArray(UserDTO[]::new);
    }

    // ========== MÉTODOS DE MENSAJES ==========

    @Override
    public synchronized void sendMessage(String userId, String content, MessageTypeEnum type, Current current) {
        User user = users.get(userId);
        if (user == null) {
            System.err.println("Usuario no encontrado: " + userId);
            return;
        }

        MessageType messageType = MessageType.fromIceEnum(type);

        Message message = new Message(
            "msg_" + (++messageCounter),
            userId,
            user.getUsername(),
            content,
            messageType
        );
        
        messages.add(message);
        notifyObservers();
        
        System.out.println("[" + user.getUsername() + "]: " + content);
    }

    @Override
    public void answerVoiceCall(String userId, Current current) {
        User user = users.get(userId);
        
        if (user == null) {
            System.err.println(" Usuario no encontrado: " + userId);
            return;
        }

        // Delegar al manager el manejo de contestar llamada
        if (!callManager.answerCall(userId)) {
            System.err.println(" No se pudo contestar la llamada para: " + user.getUsername());
            return;
        }

        String callerId = callManager.getOtherParticipant(userId);
        if (callerId != null) {
            // Crear mensaje de llamada contestada
            createCallMessage(callerId, userId, 
                "Llamada contestada", 
                user.getUsername() + " contestó la llamada"
            );
        }
        
        System.out.println( user.getUsername() + " contestó la llamada");
    }

    @Override
    public void rejectVoiceCall(String userId, Current current) {
        User user = users.get(userId);
        
        if (user == null) {
            System.err.println(" Usuario no encontrado: " + userId);
            return;
        }

        // Delegar al manager el rechazo de llamada
        VoiceCall call = callManager.rejectCall(userId);
        
        if (call == null) {
            System.err.println(" No hay llamada para rechazar: " + user.getUsername());
            return;
        }

        String callerId = call.getCallerId();
        // Crear mensaje de llamada rechazada
        createCallMessage(callerId, userId, 
            "Llamada rechazada", 
            user.getUsername() + " rechazó la llamada"
        );
        
        System.out.println( user.getUsername() + " rechazó la llamada");
    }

    @Override
    public MessageDTO[] getMessages(Current current) {
        return messages.stream()
            .map(Message::toDTO)
            .toArray(MessageDTO[]::new);
    }

    // ========== MÉTODOS DE MENSAJES PRIVADOS ==========

    /**
     * Genera un ID único para el chat privado entre dos usuarios.
     * El ID es el mismo independientemente del orden de los usuarios.
     */
    private String getPrivateChatId(String userId1, String userId2) {
        if (userId1.compareTo(userId2) < 0) {
            return userId1 + "_" + userId2;
        } else {
            return userId2 + "_" + userId1;
        }
    }
    @Override
    // TODO: Regenerar código Ice desde Chat.ice para que este método tenga @Override
    public synchronized void sendPrivateMessage(String userId, String targetUserId, String content, MessageTypeEnum type, Current current) {
        User sender = users.get(userId);
        User target = users.get(targetUserId);
        
        if (sender == null) {
            System.err.println("Usuario remitente no encontrado: " + userId);
            return;
        }
        
        if (target == null) {
            System.err.println("Usuario destino no encontrado: " + targetUserId);
            return;
        }

        MessageType messageType = MessageType.fromIceEnum(type);

        Message message = new Message(
            "msg_" + (++messageCounter),
            userId,
            sender.getUsername(),
            content,
            messageType
        );

        // Obtener o crear la lista de mensajes para este chat privado
        String chatId = getPrivateChatId(userId, targetUserId);
        privateMessages.computeIfAbsent(chatId, k -> new CopyOnWriteArrayList<>()).add(message);

        System.out.println("[" + sender.getUsername() + " -> " + target.getUsername() + "]: " + content);
    }
    
    @Override
    // TODO: Regenerar código Ice desde Chat.ice para que este método tenga @Override
    public MessageDTO[] getPrivateMessages(String userId, String targetUserId, Current current) {
        String chatId = getPrivateChatId(userId, targetUserId);
        List<Message> chatMessages = privateMessages.get(chatId);
        
        if (chatMessages == null || chatMessages.isEmpty()) {
            return new MessageDTO[0];
        }
        
        return chatMessages.stream()
            .map(Message::toDTO)
            .toArray(MessageDTO[]::new);
    }

    // ========== MÉTODOS DE GRUPOS ==========

    @Override
    public synchronized GroupDTO createGroup(String groupName, String creatorId, Current current) {
        String groupId = "group_" + (++groupCounter);
        
        UserGroup newGroup = new UserGroup(groupId, groupName);
        
        User creator = users.get(creatorId);
        if (creator != null) {
            newGroup.addParticipant(creator);
            creator.getGroups().put(groupId, newGroup);
            
            Message systemMsg = new Message(
                "msg_" + (++messageCounter),
                "system",
                "System",
                creator.getUsername() + " creó el grupo: " + groupName,
                MessageType.SYSTEM
            );
            messages.add(systemMsg);
        }
        
        groups.put(groupId, newGroup);
        
        notifyObservers();
        System.out.println("Grupo creado: " + groupName + " (ID: " + groupId + ")");
        
        return newGroup.toDTO();
    }

    @Override
    public synchronized void joinGroup(String groupId, String userId, Current current) {
        UserGroup group = groups.get(groupId);
        User user = users.get(userId);
        
        if (group == null || user == null) {
            System.err.println("Grupo o usuario no encontrado");
            return;
        }
        
        if (!group.hasParticipant(userId)) {
            group.addParticipant(user);
            user.getGroups().put(groupId, group);
            
            Message systemMsg = new Message(
                "msg_" + (++messageCounter),
                "system",
                "System",
                user.getUsername() + " se unió al grupo: " + group.getName(),
                MessageType.SYSTEM
            );
            messages.add(systemMsg);
            
            notifyObservers();
            System.out.println(user.getUsername() + " se unió al grupo " + group.getName());
        }
    }

    @Override
    public GroupDTO[] getGroups(Current current) {
        return groups.values().stream()
            .map(UserGroup::toDTO)
            .toArray(GroupDTO[]::new);
    }

    // ========== MÉTODOS DE LLAMADAS DE VOZ ==========

    @Override
    public void startVoiceCall(String userId, String targetUserId, Current current) {
        User caller = users.get(userId);
        User target = users.get(targetUserId);

        // Validar que ambos usuarios existen (las llamadas son entre dos usuarios)
        if (caller == null) {
            System.err.println(" Usuario llamador no encontrado: " + userId);
            return;
        }
        
        if (target == null) {
            System.err.println(" Usuario objetivo no encontrado: " + targetUserId);
            return;
        }

        // ========== USAR EL CALL MANAGER ==========
        VoiceCall call = callManager.startCall(
            userId, caller.getUsername(),
            targetUserId, target.getUsername()
        );

        if (call == null) {
            // La llamada no se pudo iniciar (usuario ocupado)
            String otherUser = callManager.isUserInCall(userId) ? 
                             caller.getUsername() : target.getUsername();
            
            Message busyMsg = new Message(
                "msg_" + (++messageCounter),
                "system",
                "System",
                otherUser + " está en otra llamada",
                MessageType.SYSTEM
            );
            
            String chatId = getPrivateChatId(userId, targetUserId);
            privateMessages.computeIfAbsent(chatId, k -> new CopyOnWriteArrayList<>()).add(busyMsg);
            
            notifyObservers();
            return;
        }

        // Llamada iniciada exitosamente, crear mensaje
        Message callMsg = new Message(
            "msg_" + (++messageCounter),
            userId,
            caller.getUsername(),
            " Llamada de voz iniciada",
            MessageType.VOICECALL
        );
        
        String chatId = getPrivateChatId(userId, targetUserId);
        privateMessages.computeIfAbsent(chatId, k -> new CopyOnWriteArrayList<>()).add(callMsg);
        
        notifyObservers();
        
    }

    @Override
    public void endVoiceCall(String userId, Current current) {
        User user = users.get(userId);
        
        if (user == null) {
            System.err.println(" Usuario no encontrado: " + userId);
            return;
        }
        
        // ========== USAR EL CALL MANAGER ==========
        VoiceCall call = callManager.endCall(userId);
        
        if (call == null) {
            System.err.println(" Usuario " + user.getUsername() + " no está en ninguna llamada");
            return;
        }
        
        // Crear mensaje de finalización
        Message callMsg = new Message(
            "msg_" + (++messageCounter),
            userId,
            user.getUsername(),
            " Llamada finalizada x Duración: " + call.getFormattedDuration(),
            MessageType.VOICECALL
        );
        
        String otherUserId = call.getOtherParticipant(userId);
        if (otherUserId != null) {
            String chatId = getPrivateChatId(userId, otherUserId);
            privateMessages.computeIfAbsent(chatId, k -> new CopyOnWriteArrayList<>()).add(callMsg);
        }
        
        notifyObservers();
    }

    // ========== MÉTODOS DE SEÑALIZACIÓN WEBRTC ==========

    @Override
    public void sendWebRTCSignal(String userId, String targetUserId, String signalData, Current current) {
        if (!validateUser(userId) || !validateUser(targetUserId)) {
            return;
        }

        User sender = users.get(userId);
        User target = users.get(targetUserId);
        
        System.out.println("📡 Enviando señal WebRTC de " + sender.getUsername() + 
                          " a " + target.getUsername());
        
        sendWebRTCMessage(userId, targetUserId, "WEBRTC_SIGNAL:", signalData);
    }

    @Override
    public void sendWebRTCAnswer(String userId, String targetUserId, String signalData, Current current) {
        if (!validateUser(userId) || !validateUser(targetUserId)) {
            return;
        }

        User sender = users.get(userId);
        User target = users.get(targetUserId);
        
        System.out.println("📡 Enviando respuesta WebRTC de " + sender.getUsername() + 
                          " a " + target.getUsername());
        
        sendWebRTCMessage(userId, targetUserId, "WEBRTC_ANSWER:", signalData);
    }

    /**
     * Valida que ambos participantes de la llamada existan
     */
    private boolean validateCallParticipants(User caller, User target, String callerId, String targetId) {
        if (caller == null) {
            System.err.println("❌ Usuario llamador no encontrado: " + callerId);
            return false;
        }
        
        if (target == null) {
            System.err.println("❌ Usuario objetivo no encontrado: " + targetId);
            return false;
        }

        if (callerId.equals(targetId)) {
            System.err.println("❌ Un usuario no puede llamarse a sí mismo");
            return false;
        }

        return true;
    }

    /**
     * Maneja el caso cuando un usuario está ocupado
     */
    private void handleBusyCall(User caller, User target, String userId, String targetUserId) {
        String busyUser = callManager.isUserInCall(userId) ? 
                         caller.getUsername() : target.getUsername();
        
        Message busyMsg = new Message(
            "msg_" + (++messageCounter),
            "system",
            "System",
            busyUser + " está en otra llamada",
            MessageType.SYSTEM
        );
        
        String chatId = getPrivateChatId(userId, targetUserId);
        privateMessages.computeIfAbsent(chatId, k -> new CopyOnWriteArrayList<>()).add(busyMsg);
        
        notifyObservers();
    }

    /**
     * Crea un mensaje de llamada en el chat privado
     */
    private void createCallMessage(String userId, String targetUserId, String content, String logMessage) {
        Message callMsg = new Message(
            "msg_" + (++messageCounter),
            userId,
            users.get(userId).getUsername(),
            content,
            MessageType.VOICECALL
        );
        
        String chatId = getPrivateChatId(userId, targetUserId);
        privateMessages.computeIfAbsent(chatId, k -> new CopyOnWriteArrayList<>()).add(callMsg);
        
        notifyObservers();
        System.out.println("📞 " + logMessage);
    }

    /**
     * Envía un mensaje de señalización WebRTC
     */
    private void sendWebRTCMessage(String userId, String targetUserId, String prefix, String signalData) {
        Message signalMsg = new Message(
            "signal_" + System.currentTimeMillis(),
            userId,
            users.get(userId).getUsername(),
            prefix + signalData,
            MessageType.VOICECALL
        );
        
        String chatId = getPrivateChatId(userId, targetUserId);
        privateMessages.computeIfAbsent(chatId, k -> new CopyOnWriteArrayList<>()).add(signalMsg);
        
        notifyObservers();
    }

    /**
     * Valida que un usuario exista
     */
    private boolean validateUser(String userId) {
        if (!users.containsKey(userId)) {
            System.err.println("❌ Usuario no encontrado: " + userId);
            return false;
        }
        return true;
    }


    // ========== PATRÓN OBSERVER ==========

    @Override
    public void attachObserver(ObserverPrx obs, Current current) {
        if (!observers.contains(obs)) {
            observers.add(obs);
            System.out.println("Observer agregado. Total: " + observers.size());
        }
    }

    @Override
    public void detachObserver(ObserverPrx obs, Current current) {
        observers.remove(obs);
        System.out.println("Observer removido. Total: " + observers.size());
    }

    private void notifyObservers() {
        MessageDTO[] msgArray = messages.stream()
            .map(Message::toDTO)
            .toArray(MessageDTO[]::new);
            
        UserDTO[] userArray = users.values().stream()
            .map(User::toDTO)
            .toArray(UserDTO[]::new);
        
        List<ObserverPrx> toRemove = new ArrayList<>();
        
        for (ObserverPrx observer : observers) {
            try {
                observer.updateMessagesAsync(msgArray);
                observer.updateUsersAsync(userArray);
            } catch (Exception e) {
                System.err.println("Error notificando observer: " + e.getMessage());
                toRemove.add(observer);
            }
        }
        
        observers.removeAll(toRemove);
    }

   

    // ========== Metodos para mensajes y chat privado grupos ==========

    @Override
    public synchronized void sendGroupMessage(String groupId, String userId, 
            String content, MessageTypeEnum type, Current current) {
        
        // Validar que el grupo existe
        UserGroup group = groups.get(groupId);
        if (group == null) {
            System.err.println(" Grupo no encontrado: " + groupId);
            return;
        }
        
        // Validar que el usuario existe
        User user = users.get(userId);
        if (user == null) {
            System.err.println(" Usuario no encontrado: " + userId);
            return;
        }
        
        // Verificar que el usuario pertenece al grupo
        if (!group.hasParticipant(userId)) {
            System.err.println(" Usuario " + user.getUsername() + " no pertenece al grupo " + group.getName());
            return;
        }
        
        // Convertir tipo de mensaje
        MessageType messageType = MessageType.fromIceEnum(type);
        
        // Crear el mensaje
        Message message = new Message(
            "msg_" + (++messageCounter),
            userId,
            user.getUsername(),
            content,
            messageType
        );
        
        // Almacenar mensaje en el grupo
        groupMessages.computeIfAbsent(groupId, k -> new CopyOnWriteArrayList<>()).add(message);
        
        // Log en consola del servidor
        System.out.println(" [Grupo: " + group.getName() + "] " + user.getUsername() + ": " + content);
    }

    @Override
    public MessageDTO[] getGroupMessages(String groupId, Current current) {
        // Validar que el grupo existe
        if (!groups.containsKey(groupId)) {
            System.err.println(" Grupo no encontrado: " + groupId);
            return new MessageDTO[0];
        }
        
        // Obtener mensajes del grupo
        List<Message> messages = groupMessages.get(groupId);
        
        // Si no hay mensajes, retornar array vacío
        if (messages == null || messages.isEmpty()) {
            return new MessageDTO[0];
        }
        
        // Convertir mensajes a DTOs y retornar
        return messages.stream()
            .map(Message::toDTO)
            .toArray(MessageDTO[]::new);
    }
}