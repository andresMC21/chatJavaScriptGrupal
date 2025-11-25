package model;

import Chat.GroupDTO;
import java.util.HashSet;
import java.util.Set;

public class UserGroup {
    private String id;
    private String name;
    private Set<User> participants = new HashSet<>();
    
    public UserGroup(String id, String name) {
        this.id = id;
        this.name = name;
        this.participants = new HashSet<>();
    }

    public UserGroup(String id, String name, Set<User> participants) {
        this.id = id;
        this.name = name;
        this.participants = participants;
    }

    // Constructor desde GroupDTO
    public UserGroup(GroupDTO dto) {
        this.id = dto.id;
        this.name = dto.name;
        this.participants = new HashSet<>();
        // Los participantes se cargarán por separado usando sus IDs
    }

    // Convertir a DTO para Ice
    public GroupDTO toDTO() {
        String[] memberIds = participants.stream()
            .map(User::getId)
            .toArray(String[]::new);
        return new GroupDTO(id, name, memberIds);
    }

    // Getters y Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    
    public Set<User> getParticipants() { return participants; }
    public void setParticipants(Set<User> participants) { this.participants = participants; }
    
    public void addParticipant(User user) {
        participants.add(user);
    }
    
    public void removeParticipant(User user) {
        participants.remove(user);
    }
    
    public boolean hasParticipant(String userId) {
        return participants.stream()
            .anyMatch(user -> user.getId().equals(userId));
    }
}
