package model;

/**
 * Representa una llamada de voz activa entre dos usuarios
 */
public class VoiceCall {
    private String callId;
    private String callerId;
    private String callerName;
    private String targetId;
    private String targetName;
    private long startTime;
    private long endTime;
    private CallStatus status;
    
    public enum CallStatus {
        RINGING,    // Llamada iniciada, esperando respuesta
        ACTIVE,     // Llamada en curso
        ENDED       // Llamada finalizada
    }
    
    public VoiceCall(String callId, String callerId, String callerName, 
                     String targetId, String targetName) {
        this.callId = callId;
        this.callerId = callerId;
        this.callerName = callerName;
        this.targetId = targetId;
        this.targetName = targetName;
        this.startTime = System.currentTimeMillis();
        this.status = CallStatus.RINGING;
    }
    
    /**
     * Calcula la duración de la llamada en milisegundos
     */
    public long getDuration() {
        long end = (status == CallStatus.ENDED) ? endTime : System.currentTimeMillis();
        return end - startTime;
    }
    
    /**
     * Formatea la duración en formato MM:SS
     */
    public String getFormattedDuration() {
        long seconds = getDuration() / 1000;
        long minutes = seconds / 60;
        seconds = seconds % 60;
        
        if (minutes > 0) {
            return String.format("%d:%02d", minutes, seconds);
        } else {
            return String.format("0:%02d", seconds);
        }
    }
    
    /**
     * Verifica si un usuario es participante de esta llamada
     */
    public boolean isParticipant(String userId) {
        return callerId.equals(userId) || targetId.equals(userId);
    }
    
    /**
     * Obtiene el ID del otro participante
     */
    public String getOtherParticipant(String userId) {
        if (callerId.equals(userId)) {
            return targetId;
        } else if (targetId.equals(userId)) {
            return callerId;
        }
        return null;
    }
    
    /**
     * Obtiene el nombre del otro participante
     */
    public String getOtherParticipantName(String userId) {
        if (callerId.equals(userId)) {
            return targetName;
        } else if (targetId.equals(userId)) {
            return callerName;
        }
        return null;
    }
    
    /**
     * Marca la llamada como activa (cuando el receptor contesta)
     */
    public void markAsActive() {
        this.status = CallStatus.ACTIVE;
        this.startTime = System.currentTimeMillis(); // Reiniciar contador cuando se contesta
    }
    
    /**
     * Marca la llamada como finalizada
     */
    public void markAsEnded() {
        this.status = CallStatus.ENDED;
        this.endTime = System.currentTimeMillis();
    }
    
    /**
     * Verifica si la llamada está activa
     */
    public boolean isActive() {
        return status == CallStatus.ACTIVE;
    }
    
    /**
     * Verifica si la llamada está sonando (esperando respuesta)
     */
    public boolean isRinging() {
        return status == CallStatus.RINGING;
    }
    
    /**
     * Verifica si la llamada ha finalizado
     */
    public boolean isEnded() {
        return status == CallStatus.ENDED;
    }
    
    /**
     * Obtiene información resumida de la llamada
     */
    public String getCallSummary() {
        return String.format("Llamada %s: %s -> %s (%s)", 
            callId, callerName, targetName, status);
    }
    
    // Getters y Setters
    public String getCallId() { return callId; }
    public void setCallId(String callId) { this.callId = callId; }
    
    public String getCallerId() { return callerId; }
    public void setCallerId(String callerId) { this.callerId = callerId; }
    
    public String getCallerName() { return callerName; }
    public void setCallerName(String callerName) { this.callerName = callerName; }
    
    public String getTargetId() { return targetId; }
    public void setTargetId(String targetId) { this.targetId = targetId; }
    
    public String getTargetName() { return targetName; }
    public void setTargetName(String targetName) { this.targetName = targetName; }
    
    public long getStartTime() { return startTime; }
    public void setStartTime(long startTime) { this.startTime = startTime; }
    
    public long getEndTime() { return endTime; }
    public void setEndTime(long endTime) { this.endTime = endTime; }
    
    public CallStatus getStatus() { return status; }
    public void setStatus(CallStatus status) { this.status = status; }
}