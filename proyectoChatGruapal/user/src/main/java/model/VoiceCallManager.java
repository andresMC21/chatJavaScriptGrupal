package model;

import model.VoiceCall;
import model.VoiceCall.CallStatus;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Gestor centralizado para manejar las llamadas de voz del chat
 */
public class VoiceCallManager {

    /**
     * Inicia una nueva llamada entre dos usuarios
     * 
     * @param callerId ID del usuario que inicia la llamada
     * @param callerName Nombre del usuario que inicia la llamada
     * @param targetId ID del usuario que recibe la llamada
     * @param targetName Nombre del usuario que recibe la llamada
     * @return VoiceCall creada o null si no se pudo crear
     */
    
    // Map para trackear llamadas activas: userId -> VoiceCall
    private final Map<String, VoiceCall> activeCalls = new ConcurrentHashMap<>();
    
    // Contador para generar IDs únicos de llamadas
    private final AtomicInteger callCounter = new AtomicInteger(0);
    
    /**
     * Inicia una nueva llamada entre dos usuarios
     */
    public VoiceCall startCall(String callerId, String callerName, 
                               String targetId, String targetName) {
        
        // Verificar si el llamador ya está en una llamada
        if (isUserInCall(callerId)) {
            System.err.println(" Usuario " + callerName + " ya está en una llamada");
            return null;
        }
        
        // Verificar si el objetivo ya está en una llamada
        if (isUserInCall(targetId)) {
            System.err.println(" Usuario " + targetName + " ya está en otra llamada");
            return null;
        }
        
        // Crear nueva llamada
        String callId = "call_" + callCounter.incrementAndGet();
        VoiceCall call = new VoiceCall(callId, callerId, callerName, targetId, targetName);
        
        // Registrar llamada para ambos usuarios
        activeCalls.put(callerId, call);
        activeCalls.put(targetId, call);
        
        System.out.println(" Llamada iniciada: " + call.getCallSummary());
        
        return call;
    }
    
    /**
     * Finaliza una llamada activa
     */
    public VoiceCall endCall(String userId) {
        VoiceCall call = activeCalls.get(userId);
        
        if (call == null) {
            System.err.println(" Usuario " + userId + " no está en ninguna llamada");
            return null;
        }
        
        // Marcar llamada como finalizada
        call.markAsEnded();
        
        // Obtener el otro participante
        String otherUserId = call.getOtherParticipant(userId);
        
        // Eliminar llamada de ambos usuarios
        activeCalls.remove(userId);
        if (otherUserId != null) {
            activeCalls.remove(otherUserId);
        }
        
        System.out.println(" Llamada finalizada: " + call.getCallId() + 
                          " (Duración: " + call.getFormattedDuration() + ")");
        
        return call;
    }
    
    /**
     * Marca una llamada como activa (cuando el receptor contesta)
     */
    public boolean answerCall(String userId) {
        VoiceCall call = activeCalls.get(userId);
        
        if (call == null || !call.isRinging()) {
            System.err.println(" No hay llamada entrante para el usuario: " + userId);
            return false;
        }
        
        call.markAsActive();
        System.out.println(" Llamada contestada: " + call.getCallSummary());
        return true;
    }
    
    /**
     * Rechaza una llamada entrante
     */
    public VoiceCall rejectCall(String userId) {
        VoiceCall call = activeCalls.get(userId);
        
        if (call == null || !call.isRinging()) {
            System.err.println(" No hay llamada entrante para rechazar: " + userId);
            return null;
        }
        
        return endCall(userId);
    }
    
    /**
     * Verifica si un usuario está actualmente en una llamada
     */
    public boolean isUserInCall(String userId) {
        return activeCalls.containsKey(userId);
    }
    
    /**
     * Obtiene la llamada activa de un usuario
     */
    public VoiceCall getActiveCall(String userId) {
        return activeCalls.get(userId);
    }
    
    /**
     * Obtiene el otro participante de una llamada
     */
    public String getOtherParticipant(String userId) {
        VoiceCall call = activeCalls.get(userId);
        return call != null ? call.getOtherParticipant(userId) : null;
    }
    
    /**
     * Obtiene el nombre del otro participante
     */
    public String getOtherParticipantName(String userId) {
        VoiceCall call = activeCalls.get(userId);
        return call != null ? call.getOtherParticipantName(userId) : null;
    }
    
    /**
     * Verifica si un usuario tiene una llamada entrante
     */
    public boolean hasIncomingCall(String userId) {
        VoiceCall call = activeCalls.get(userId);
        return call != null && call.isRinging() && call.getTargetId().equals(userId);
    }
    
    /**
     * Obtiene información del llamador para una llamada entrante
     */
    public String getCallerInfo(String userId) {
        VoiceCall call = activeCalls.get(userId);
        if (call != null && call.isRinging() && call.getTargetId().equals(userId)) {
            return call.getCallerName() + " (" + call.getCallerId() + ")";
        }
        return null;
    }
    
    /**
     * Finaliza todas las llamadas activas de un usuario
     * Útil cuando un usuario se desconecta abruptamente
     */
    public void endAllCallsForUser(String userId) {
        if (isUserInCall(userId)) {
            endCall(userId);
        }
    }
    
    /**
     * Obtiene el número de llamadas activas
     */
    public int getActiveCallsCount() {
        // Dividir entre 2 porque cada llamada registra 2 entradas (una por usuario)
        return activeCalls.size() / 2;
    }
    
    /**
     * Obtiene estadísticas de llamadas
     */
    public String getCallStatistics() {
        int ringing = 0;
        int active = 0;
        int total = getActiveCallsCount();
        
        for (VoiceCall call : activeCalls.values()) {
            if (call.isRinging()) ringing++;
            else if (call.isActive()) active++;
        }
        
        return String.format("Llamadas: %d total, %d sonando, %d activas", 
                           total, ringing / 2, active / 2);
    }
    
    /**
     * Limpia todas las llamadas (útil para testing o reset)
     */
    public void clearAllCalls() {
        activeCalls.clear();
        System.out.println(" Todas las llamadas han sido limpiadas");
    }
}