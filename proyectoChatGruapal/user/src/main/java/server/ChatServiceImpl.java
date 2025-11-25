package server;

import Chat.*;
import model.*;
import com.zeroc.Ice.Current;
import com.zeroc.IceInternal.Incoming;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CompletableFuture;

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

    // ========== RESOLVER CONFLICTOS DE INTERFACES ==========
    
    // Implementar _iceDispatch manualmente para resolver el conflicto de herencia múltiple
    @Override
    public java.util.concurrent.CompletionStage<com.zeroc.Ice.OutputStream> _iceDispatch(Incoming in, Current current) 
            throws com.zeroc.Ice.UserException {
        // Primero intentar con las operaciones de ChatService
        String[] chatServiceOps = {
            "createGroup", "endVoiceCall", "getGroupMessages", "getGroups",
            "getMessages", "getPrivateMessages", "getUsers", "ice_id", "ice_ids",
            "ice_isA", "ice_ping", "joinChat", "joinGroup", "leaveChat",
            "sendGroupMessage", "sendMessage", "sendPrivateMessage", "startVoiceCall"
        };
        
        int pos = Arrays.binarySearch(chatServiceOps, current.operation);
        if (pos >= 0) {
            // Es una operación de ChatService, delegar a su implementación
            return ChatService.super._iceDispatch(in, current);
        }
        
        // Si no es de ChatService, intentar con Subject
        String[] subjectOps = {
            "attachObserver", "detachObserver", "ice_id", "ice_ids",
            "ice_isA", "ice_ping"
        };
        
        pos = Arrays.binarySearch(subjectOps, current.operation);
        if (pos >= 0) {
            // Es una operación de Subject, delegar a su implementación
            return Subject.super._iceDispatch(in, current);
        }
        
        // Si no es de ninguna, lanzar excepción
        throw new com.zeroc.Ice.OperationNotExistException(current.id, current.facet, current.operation);
    }

    @Override
    public String ice_id(Current current) {
        // Retornar la ID principal (ChatService)
        return ChatService.ice_staticId();
    }

    @Override
    public String[] ice_ids(Current current) {
        // Combinar todas las IDs de ambas interfaces
        Set<String> allIds = new HashSet<>();
        allIds.addAll(Arrays.asList(ChatService.super.ice_ids(current)));
        allIds.addAll(Arrays.asList(Subject.super.ice_ids(current)));
        // Ordenar para consistencia
        String[] result = allIds.toArray(new String[0]);
        Arrays.sort(result);
        return result;
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

        // Log para verificar el tamaño del contenido recibido
        if (type == MessageTypeEnum.AUDIO) {
            System.out.println("Mensaje de audio recibido - Longitud del contenido: " + content.length() + " caracteres");
            System.out.println("Tamaño estimado del audio: " + (content.length() * 3) / 4 + " bytes");
            if (content.length() > 0) {
                System.out.println("Primeros 50 caracteres: " + content.substring(0, Math.min(50, content.length())));
                System.out.println("Últimos 50 caracteres: " + content.substring(Math.max(0, content.length() - 50)));
            }
        }

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

        if (type == MessageTypeEnum.AUDIO) {
            System.out.println("[" + sender.getUsername() + " -> " + target.getUsername() + "]: Audio guardado (tamaño: " + content.length() + " caracteres)");
        } else {
            System.out.println("[" + sender.getUsername() + " -> " + target.getUsername() + "]: " + content);
        }
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
        
        if (caller != null && target != null) {
            Message callMsg = new Message(
                "msg_" + (++messageCounter),
                userId,
                caller.getUsername(),
                "Llamada de voz iniciada con " + target.getUsername(),
                MessageType.VOICECALL
            );
            messages.add(callMsg);
            notifyObservers();
            System.out.println("Llamada iniciada: " + caller.getUsername() + " -> " + target.getUsername());
        }
    }

    @Override
    public void endVoiceCall(String userId, Current current) {
        User user = users.get(userId);
        if (user != null) {
            Message callMsg = new Message(
                "msg_" + (++messageCounter),
                userId,
                user.getUsername(),
                "Llamada de voz finalizada",
                MessageType.VOICECALL
            );
            messages.add(callMsg);
            notifyObservers();
            System.out.println("Llamada finalizada: " + user.getUsername());
        }
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
                // Llamadas asíncronas - manejar los CompletableFuture
                CompletableFuture<Void> msgFuture = observer.updateMessagesAsync(msgArray);
                CompletableFuture<Void> userFuture = observer.updateUsersAsync(userArray);
                
                // Manejar errores asincrónicamente
                msgFuture.exceptionally(ex -> {
                    System.err.println("Error notificando mensajes al observer: " + ex.getMessage());
                    synchronized (observers) {
                        toRemove.add(observer);
                    }
                    return null;
                });
                
                userFuture.exceptionally(ex -> {
                    System.err.println("Error notificando usuarios al observer: " + ex.getMessage());
                    synchronized (observers) {
                        toRemove.add(observer);
                    }
                    return null;
                });
            } catch (Exception e) {
                System.err.println("Error notificando observer: " + e.getMessage());
                toRemove.add(observer);
            }
        }
        
        // Remover observadores con errores
        synchronized (observers) {
            observers.removeAll(toRemove);
        }
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
        
        // Log para verificar el tamaño del contenido recibido
        if (type == MessageTypeEnum.AUDIO) {
            System.out.println("Mensaje de audio en grupo recibido - Longitud del contenido: " + content.length() + " caracteres");
            System.out.println("Tamaño estimado del audio: " + (content.length() * 3) / 4 + " bytes");
        }
        
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
        if (type == MessageTypeEnum.AUDIO) {
            System.out.println(" [Grupo: " + group.getName() + "] " + user.getUsername() + ": Audio guardado (tamaño: " + content.length() + " caracteres)");
        } else {
            System.out.println(" [Grupo: " + group.getName() + "] " + user.getUsername() + ": " + content);
        }
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