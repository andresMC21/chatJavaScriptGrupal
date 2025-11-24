const ChatUI = {
    MessageTypeEnum: {
        TEXT: { value: 0 },
        SYSTEM: { value: 1 },
        AUDIO: { value: 2 },
        VOICECALL: { value: 3 }
    }
};

class ChatApp {
    constructor() {
        this.communicator = null;
        this.chatService = null;
        this.currentUser = null;
        this.selectedContact = null;
        this.pollInterval = null;
        this.selectedGroup = null;
        this.userGroups = new Set(); // Grupos a los que el usuario pertenece

        // Estado de llamadas
        // Estado de llamadas WebRTC
        this.currentCall = null;
        this.isInCall = false;
        this.isRinging = false; // Para llamadas entrantes
        this.callDurationInterval = null;
        this.callStartTime = null;
        
        // WebRTC
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.rtcConfiguration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        // Referencias DOM
        this.messagesContainer = document.getElementById('messages');
        this.contactsList = document.getElementById('contacts');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.chatHeader = document.getElementById('chatHeader');

        this.initializeEventListeners();
    }

    initializeEventListeners() {
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
    }

    async connect() {
        try {
            console.log(" Iniciando conexión con Ice...");

            // Inicializar Ice communicator
            const initData = new Ice.InitializationData();
            initData.properties = Ice.createProperties();

            this.communicator = Ice.initialize(initData);

            console.log(" Communicator inicializado");

            // Crear proxy al servidor usando WebSocket
            const proxyString = "ChatService:ws -h localhost -p 10001 -r /";
            console.log(" Conectando a:", proxyString);

            const base = this.communicator.stringToProxy(proxyString);

            // Casteo obligatorio al tipo generado por Slice
            this.chatService = Chat.ChatServicePrx.uncheckedCast(base);

            console.log(" Conectado al servidor Ice");

            // Configurar el modal de username
            this.setupUsernameModal();

        } catch (error) {
            console.error(" Error conectando:", error);
            alert("No se pudo conectar al servidor: " + error.message);

            // Retry después de 3 segundos
            setTimeout(() => this.connect(), 3000);
        }
    }

    setupUsernameModal() {
        const modal = document.getElementById('usernameModal');
        const input = document.getElementById('usernameInput');
        const joinBtn = document.getElementById('joinChatBtn');

        // Mostrar el modal
        modal.classList.add('active');
        input.focus();

        const handleJoin = async () => {
            const username = input.value.trim();

            if (!username || username.length < 2) {
                input.style.borderColor = 'var(--danger)';
                input.placeholder = 'Por favor ingresa un nombre válido (mínimo 2 caracteres)';
                input.value = '';
                input.focus();
                return;
            }

            // Deshabilitar botón mientras se conecta
            joinBtn.disabled = true;
            joinBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando...';

            try {
                console.log(" Intentando unirse con usuario:", username);

                console.log(" Enviando petición joinChat al servidor...");

                const response = await this.chatService.joinChat(username);

                console.log(" Respuesta recibida:", response);

                // Validación correcta: UserDTO directo
                if (!response || typeof response.id !== "string") {
                    throw new Error("Respuesta no válida del servidor");
                }

                // Asignar el usuario recibido
                this.currentUser = response;

                console.log(" Usuario registrado exitosamente:", this.currentUser);

                this.updateChatHeader("Chat General", "Conectado como " + this.currentUser.username);

                modal.classList.remove('active');

                this.startPolling();

                this.showNotification("¡Bienvenido " + this.currentUser.username + "!", "success");

            } catch (error) {
                console.error(" Error al unirse al chat:", error);

                joinBtn.disabled = false;
                joinBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Unirse al Chat';
                input.style.borderColor = 'var(--danger)';
                input.value = '';
                input.placeholder = 'Error al conectar. Intenta nuevamente';
                input.focus();

                alert("Error al conectar con el servidor:\n" + error.message + "\n\n¿Está el servidor corriendo?");
            }
        };

        // Manejar click en botón
        joinBtn.onclick = handleJoin;

        // Manejar Enter en input
        input.onkeypress = (e) => {
            if (e.key === 'Enter') {
                handleJoin();
            }
        };

        // Evitar cerrar el modal clickeando fuera
        modal.onclick = (e) => {
            if (e.target === modal) {
                input.focus();
            }
        };
    }

    startPolling() {
        console.log(" Iniciando polling de mensajes y usuarios...");

        // Actualizar cada segundo
        this.pollInterval = setInterval(async () => {
            await this.updateMessages();
            await this.updateUsers();
             //actualiza grupos
            await this.updateGroups(); 
        }, 1000);

        // Primera actualización inmediata
        this.updateMessages();
        this.updateUsers();
        this.updateGroups(); 

    }

    async updateMessages() {
        try {
            let messages;
            if (this.selectedGroup) {
                // Obtener mensajes del grupo desde el servidor
                messages = await this.chatService.getGroupMessages(this.selectedGroup.id);

                console.log(` Mensajes del grupo ${this.selectedGroup.name}:`, messages.length);

            } else if (this.selectedContact) {
                // Obtener mensajes privados del chat seleccionado
                messages = await this.chatService.getPrivateMessages(
                    this.currentUser.id,
                    this.selectedContact.id
                );

                // Procesar señales WebRTC en mensajes privados
                this.processWebRTCSignals(messages);
            } else {
                // Obtener mensajes del chat general
                messages = await this.chatService.getMessages();
            }
            this.renderMessages(messages);
        } catch (error) {
            console.error("Error obteniendo mensajes:", error);
        }
    }

    processWebRTCSignals(messages) {
        messages.forEach(msg => {
            if (msg.type.value === ChatUI.MessageTypeEnum.VOICECALL.value) {
                if (msg.content.includes('WEBRTC_SIGNAL:') && msg.senderId !== this.currentUser.id) {
                    const signalData = msg.content.replace('WEBRTC_SIGNAL:', '');
                    this.handleIncomingCall(msg.senderId, msg.senderName, signalData);
                }
                else if (msg.content.includes('WEBRTC_ANSWER:') && msg.senderId !== this.currentUser.id) {
                    const signalData = msg.content.replace('WEBRTC_ANSWER:', '');
                    this.handleWebRTCAnswer(signalData);
                }
            }
        });
    }



    async handleWebRTCAnswer(signalData) {
        if (!this.peerConnection) return;

        const signal = JSON.parse(signalData);
        
        if (signal.type === 'answer') {
            await this.peerConnection.setRemoteDescription(signal.answer);
        } else if (signal.type === 'ice-candidate') {
            await this.peerConnection.addIceCandidate(signal.candidate);
        }
    }

    async handleIncomingCall(callerId, callerName, signalData) {
        if (this.isInCall) {
            console.log(" Ya en llamada, ignorando llamada entrante");
            return;
        }

        const signal = JSON.parse(signalData);
        
        if (signal.type === 'offer') {
            this.incomingCall = {
                callerId: callerId,
                callerName: callerName,
                offer: signal.offer
            };

            this.showIncomingCallInterface(callerName);
        }
    }

    showIncomingCallInterface(callerName) {
        const incomingCallInterface = document.createElement('div');
        incomingCallInterface.id = 'incomingCallInterface';
        incomingCallInterface.className = 'call-interface incoming-call active';
        
        incomingCallInterface.innerHTML = `
            <div class="call-container">
                <div class="call-header">
                    <div class="call-avatar incoming">
                        <i class="fas fa-phone"></i>
                    </div>
                    <div class="call-info">
                        <h3>${this.escapeHtml(callerName)}</h3>
                        <div class="call-status">Llamada entrante...</div>
                    </div>
                </div>
                <div class="call-controls">
                    <button class="call-control-btn decline-btn" onclick="window.chatApp.rejectIncomingCall()">
                        <i class="fas fa-times"></i>
                    </button>
                    <button class="call-control-btn answer-btn" onclick="window.chatApp.answerIncomingCall()">
                        <i class="fas fa-phone"></i>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(incomingCallInterface);

        // Reproducir sonido de llamada
        this.playRingtone();
    }

    async answerIncomingCall() {
        if (!this.incomingCall) return;

        try {
            // Ocultar interfaz de llamada entrante
            this.hideIncomingCallInterface();

            // Notificar al servidor que contestamos la llamada
            await this.chatService.answerVoiceCall(this.currentUser.id);

            // Obtener stream de audio
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            // Crear conexión peer
            this.peerConnection = new RTCPeerConnection(this.rtcConfiguration);

            // Agregar stream local
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            // Manejar stream remoto
            this.peerConnection.ontrack = (event) => {
                console.log(" Stream remoto recibido");
                this.remoteStream = event.streams[0];
                this.setupRemoteAudio();
            };

            // Manejar candidatos ICE
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendWebRTCAnswer(this.incomingCall.callerId, {
                        type: 'ice-candidate',
                        candidate: event.candidate
                    });
                }
            };

            // Establecer oferta remota
            await this.peerConnection.setRemoteDescription(this.incomingCall.offer);

            // Crear respuesta
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            // Enviar respuesta
            this.sendWebRTCAnswer(this.incomingCall.callerId, {
                type: 'answer',
                answer: answer
            });

            this.isInCall = true;
            this.currentCall = {
                targetId: this.incomingCall.callerId,
                startTime: new Date(),
                isCaller: false
            };

            this.showCallInterface();
            this.incomingCall = null;

        } catch (error) {
            console.error("Error contestando llamada:", error);
            alert("Error al contestar la llamada");
        }
    }

    async rejectIncomingCall() {
        if (!this.incomingCall) return;

        try {
            await this.chatService.rejectVoiceCall(this.currentUser.id);
            this.hideIncomingCallInterface();
            this.incomingCall = null;
        } catch (error) {
            console.error("Error rechazando llamada:", error);
        }
    }

    hideIncomingCallInterface() {
        const incomingCallInterface = document.getElementById('incomingCallInterface');
        if (incomingCallInterface) {
            incomingCallInterface.remove();
        }
        this.stopRingtone();
    }

    playRingtone() {
        // Crear un tono de llamada simple (puedes reemplazar con un archivo de audio)
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.value = 800;
        gainNode.gain.value = 0.5;
        
        oscillator.start();
        
        // Detener después de 1 segundo y repetir
        setInterval(() => {
            oscillator.stop();
            oscillator.start();
        }, 1000);
        
        this.ringtone = oscillator;
    }

    stopRingtone() {
        if (this.ringtone) {
            this.ringtone.stop();
            this.ringtone = null;
        }
    }

    async updateUsers() {
        try {
            const users = await this.chatService.getUsers();
            this.renderContacts(users);
        } catch (error) {
            console.error("Error obteniendo usuarios:", error);
        }
    }
    //metodo para actualizar grupos 
    async updateGroups() {
        try {
            const groups = await this.chatService.getGroups();

            // Actualizar el Set de grupos del usuario
            this.userGroups.clear();
            groups.forEach(group => {
                if (group.memberIds && group.memberIds.includes(this.currentUser.id)) {
                    this.userGroups.add(group.id);
                }
            });

            this.renderGroups(groups);
        } catch (error) {
            console.error("Error obteniendo grupos:", error);
        }
    }

     //metodo para renderizar lista de grupos
     renderGroups(groups) {

        const groupsContainer = document.getElementById('groupsList') || this.createGroupsSection();

        groupsContainer.innerHTML = '';

        if (groups.length === 0) {
            groupsContainer.innerHTML = `
                <div class="contact" style="justify-content: center; padding: 20px;">
                    <span style="color: var(--text-muted);">No hay grupos creados</span>
                </div>
            `;
            return;
        }

        groups.forEach(group => {
            const groupElement = this.createGroupElement(group);
            groupsContainer.appendChild(groupElement);
        });
    }

    //metodo Crear elemento HTML para grupo 
    createGroupElement(group) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'contact group';

        // Verificar si el usuario ya pertenece al grupo
        const isMember = group.memberIds && group.memberIds.includes(this.currentUser.id);

        groupDiv.onclick = () => this.handleGroupClick(group, isMember);

        const memberCount = group.memberIds ? group.memberIds.length : 0;
        const initials = group.name.split(' ').map(word => word[0]).join('').toUpperCase().substring(0, 2);

         // Añadir indicador visual si ya eres miembro
        const memberBadge = isMember ? '<span class="member-badge">✓ Miembro</span>' : '';

        groupDiv.innerHTML = `
            <div class="avatar group-avatar">${initials}</div>
            <div class="contact-info">
                <div class="contact-name">${this.escapeHtml(group.name)}</div>
                <div class="contact-preview group-preview">
                    <i class="fas fa-users"></i> ${memberCount} miembro${memberCount !== 1 ? 's' : ''}
                    ${memberBadge}
                </div>
            </div>
        `;

        // Resaltar si está seleccionado
        if (this.selectedGroup && this.selectedGroup.id === group.id) {
            groupDiv.classList.add('active');
        }

        return groupDiv;
    }

    async handleGroupClick(group, isMember) {
        if (!isMember) {
            // Mostrar modal de confirmación para unirse
            this.showJoinGroupModal(group);
        } else {
            // Ya es miembro, abrir el chat del grupo
            this.selectGroup(group);
        }
    }

    showJoinGroupModal(group) {
        // Crear modal dinámico
        const modal = document.createElement('div');
        modal.className = 'modal-overlay active';
        modal.id = 'joinGroupModal';
        
        modal.innerHTML = `
            <div class="modal join-modal">
                <div class="modal-header">
                    <h3>
                        <i class="fas fa-users"></i>
                        Unirse al grupo
                    </h3>
                </div>
                <div style="margin: 20px 0;">
                    <p style="color: var(--text); font-size: 1.1rem; text-align: center; margin-bottom: 10px;">
                        ¿Quieres unirte al grupo <strong>${this.escapeHtml(group.name)}</strong>?
                    </p>
                    <p style="color: var(--text-muted); font-size: 0.9rem; text-align: center;">
                        Actualmente tiene ${group.memberIds ? group.memberIds.length : 0} miembro${group.memberIds && group.memberIds.length !== 1 ? 's' : ''}
                    </p>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn-secondary" id="cancelJoinBtn">
                        <i class="fas fa-times"></i> Cancelar
                    </button>
                    <button class="btn-primary" id="confirmJoinBtn">
                        <i class="fas fa-check"></i> Unirse
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        const confirmBtn = modal.querySelector('#confirmJoinBtn');
        const cancelBtn = modal.querySelector('#cancelJoinBtn');

        confirmBtn.onclick = async () => {
            try {
                confirmBtn.disabled = true;
                confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uniéndose...';
                
                // Llamar al servidor para unirse al grupo
                await this.chatService.joinGroup(group.id, this.currentUser.id);
                
                this.userGroups.add(group.id);
                this.showNotification(`Te has unido al grupo ${group.name}`, 'success');
                
                modal.remove();
                
                // Actualizar grupos inmediatamente
                await this.updateGroups();
                
                // Pequeño delay para asegurar sincronización con el servidor
                setTimeout(async () => {
                    // Buscar el grupo actualizado
                    const groups = await this.chatService.getGroups();
                    const updatedGroup = groups.find(g => g.id === group.id);
                    if (updatedGroup) {
                        this.selectGroup(updatedGroup);
                    }
                }, 300);
                
            } catch (error) {
                console.error(" Error uniéndose al grupo:", error);
                alert("Error al unirse al grupo: " + error.message);
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i class="fas fa-check"></i> Unirse';
            }
        };

        cancelBtn.onclick = () => modal.remove();
        
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    }

    //metodo Seleccionar grupo
    selectGroup(group) {
        this.selectedGroup = group;
        this.selectedContact = null;

        const memberCount = group.memberIds ? group.memberIds.length : 0;
        this.updateChatHeader(
            group.name, 
            `Grupo • ${memberCount} miembro${memberCount !== 1 ? 's' : ''}`
        );

        // Resaltar grupo seleccionado
        document.querySelectorAll('.contact').forEach(c => c.classList.remove('active'));
        const groupElements = Array.from(document.querySelectorAll('.contact.group'));
        const selectedElement = groupElements.find(el => {
            const nameElement = el.querySelector('.contact-name');
            return nameElement && nameElement.textContent === group.name;
        });
        if (selectedElement) {
            selectedElement.classList.add('active');
        }

        // Cargar mensajes del grupo inmediatamente
        this.updateMessages();
        
        console.log(` Grupo seleccionado: ${group.name} (ID: ${group.id})`);
    }

    // metodo Crear sección de grupos en el sidebar
    createGroupsSection() {
        const sidebar = document.querySelector('.sidebar');

        // Crear contenedor de grupos
        const groupsSection = document.createElement('div');
        groupsSection.id = 'groupsSection';
        groupsSection.className = 'groups-section';

        groupsSection.innerHTML = `
            <div class="section-header">
                <h3>Grupos</h3>
            </div>
            <div id="groupsList" class="groups-list"></div>
        `;

        // Insertar después de la lista de contactos
        const contactsList = document.getElementById('contacts');
        sidebar.insertBefore(groupsSection, contactsList.nextSibling);

        return document.getElementById('groupsList');
    }

    renderContacts(users) {
        this.contactsList.innerHTML = '';

        const onlineUsers = users.filter(user =>
            user.id !== this.currentUser.id && user.isOnline
        );

        if (onlineUsers.length === 0) {
            this.contactsList.innerHTML = `
                <div class="contact" style="justify-content: center; padding: 20px;">
                    <span style="color: var(--text-muted);">No hay otros usuarios conectados</span>
                </div>
            `;
            return;
        }

        //esta parte renderiza todos los elementos en comun que tendra cada usuario
        onlineUsers.forEach(user => {
            const contactDiv = document.createElement('div');
            contactDiv.className = 'contact';
            contactDiv.onclick = () => this.selectContact(user);

            const initial = user.username.charAt(0).toUpperCase();
            const statusClass = user.isOnline ? 'online' : 'offline';

            // Agregar botón de llamada a cada contacto
            const callButton = this.isInCall ? '' : `
                <button class="call-btn" title="Llamar" onclick="event.stopPropagation(); window.chatApp.startVoiceCall('${user.id}')">
                    <i class="fas fa-phone"></i>
                </button>
            `;

            contactDiv.innerHTML = `
                <div class="avatar">${initial}</div>
                <div class="contact-info">
                    <div class="contact-name">${user.username}</div>
                    <div class="contact-preview ${statusClass}">
                        ${user.isOnline ? '● En línea' : '○ Desconectado'}
                    </div>
                </div>
                ${callButton}
            `;

            this.contactsList.appendChild(contactDiv);
        });
    }

    renderMessages(messages) {
        const placeholder = this.messagesContainer.querySelector('.messages-placeholder');
        if (placeholder && messages.length > 0) {
            placeholder.remove();
        }

        const shouldScrollDown = this.isScrolledToBottom();
        this.messagesContainer.innerHTML = '';

        // Filtrar mensajes de señal WebRTC (no mostrarlos en el chat)
        const displayMessages = messages.filter(msg => 
            !msg.content.includes('WEBRTC_SIGNAL:') && 
            !msg.content.includes('WEBRTC_ANSWER:')
        );

        if (displayMessages.length === 0) {
            let contextText = 'No hay mensajes aún. ¡Sé el primero en escribir!';
            let icon = 'comment-dots';
            
            if (this.selectedGroup) {
                contextText = `No hay mensajes en el grupo <strong>${this.escapeHtml(this.selectedGroup.name)}</strong>. ¡Sé el primero en escribir!`;
                icon = 'users';
            } else if (this.selectedContact) {
                contextText = `No hay mensajes con <strong>${this.escapeHtml(this.selectedContact.username)}</strong>. ¡Inicia la conversación!`;
                icon = 'comment';
            }
            
            this.messagesContainer.innerHTML = `
                <div class="messages-placeholder">
                    <i class="fas fa-${icon}"></i>
                    <p>${contextText}</p>
                </div>
            `;
            return;
        }

        displayMessages.forEach(msg => {
            const messageDiv = this.createMessageElement(msg);
            this.messagesContainer.appendChild(messageDiv);
        });

        if (shouldScrollDown) {
            this.scrollToBottom();
        }
    }

    createMessageElement(msg) {
        const isMyMessage = msg.senderId === this.currentUser.id;
        const messageDiv = document.createElement('div');

        if (msg.type.value === ChatUI.MessageTypeEnum.SYSTEM.value) {
            messageDiv.className = 'system-message';
            messageDiv.innerHTML = `
                <div class="system-message-content">
                    <i class="fas fa-info-circle"></i>
                    ${this.escapeHtml(msg.content)}
                </div>
            `;
        } else if (msg.type.value === ChatUI.MessageTypeEnum.VOICECALL.value) {
            messageDiv.className = isMyMessage ? 'message my-message call-message' : 'message other-message call-message';
            
            // Determinar si es un mensaje de inicio o fin de llamada
            const isCallStart = msg.content.includes('iniciada');
            const isCallEnd = msg.content.includes('finalizada');
            
            const callIcon = isCallStart ? 'fa-phone' : 
                        isCallEnd ? 'fa-phone-slash' : 'fa-phone';
            
            const callClass = isCallStart ? 'call-start' : 
                            isCallEnd ? 'call-end' : 'call-active';
            
            messageDiv.innerHTML = `
                <div class="message-content call-content ${callClass}">
                    <i class="fas ${callIcon}"></i> 
                    ${this.escapeHtml(msg.content)}
                    ${isCallStart && !isMyMessage && !this.isInCall ? `
                        <button class="join-call-btn" onclick="window.chatApp.answerIncomingCall()">
                            <i class="fas fa-phone"></i> Contestar
                        </button>
                    ` : ''}
                </div>
                ${!isMyMessage ? `<div class="message-sender">${this.escapeHtml(msg.senderName)}</div>` : ''}
            `;
        } else {
            messageDiv.className = isMyMessage ? 'message my-message' : 'message other-message';
            
            const showSender = this.selectedGroup && !isMyMessage;
            
            messageDiv.innerHTML = `
                <div class="message-content">${this.escapeHtml(msg.content)}</div>
                ${showSender ? `<div class="message-sender">${this.escapeHtml(msg.senderName)}</div>` : ''}
            `;
        }

        return messageDiv;
    }

    async sendMessage() {
        const content = this.messageInput.value.trim();
        if (!content || !this.currentUser) return;

        try {
            console.log(" Enviando mensaje:", content);

            if (this.selectedGroup) {
                // Enviar mensaje al grupo (usando sendGroupMessage del servidor)
                await this.chatService.sendGroupMessage(
                    this.selectedGroup.id,
                    this.currentUser.id,
                    content,
                    Chat.MessageTypeEnum.TEXT
                );
                console.log(` Mensaje enviado al grupo: ${this.selectedGroup.name}`);
            } else if (this.selectedContact) {
                // Enviar mensaje privado
                await this.chatService.sendPrivateMessage(
                    this.currentUser.id,
                    this.selectedContact.id,
                    content,
                    Chat.MessageTypeEnum.TEXT
                );
                console.log(` Mensaje privado enviado a: ${this.selectedContact.username}`);
            } else {
                // Enviar mensaje al chat general
                await this.chatService.sendMessage(
                    this.currentUser.id,
                    content,
                    Chat.MessageTypeEnum.TEXT
                );
                console.log(" Mensaje enviado al chat general");
            }

            this.messageInput.value = '';
            this.messageInput.focus();
            
            // Actualizar mensajes inmediatamente
            await this.updateMessages();

        } catch (error) {
            console.error(" Error enviando mensaje:", error);
            alert("Error al enviar mensaje: " + error.message);
        }
    }

    // ========== FUNCIONALIDADES DE LLAMADA ==========

    async startVoiceCall(targetUserId = null) {
        const callTargetId = targetUserId || (this.selectedContact ? this.selectedContact.id : null);
        
        if (!callTargetId) {
            alert("Selecciona un contacto para llamar");
            return;
        }

        if (this.isInCall) {
            alert("Ya estás en una llamada");
            return;
        }

        try {
            console.log(` Iniciando llamada WebRTC con usuario: ${callTargetId}`);
            
            // Iniciar llamada en el servidor
            await this.chatService.startVoiceCall(this.currentUser.id, callTargetId);
            
            // Configurar WebRTC
            await this.setupWebRTCAsCaller(callTargetId);
            
            this.showNotification("Llamada iniciada", "success");

        } catch (error) {
            console.error(" Error iniciando llamada:", error);
            alert("Error al iniciar la llamada: " + error.message);
        }
    }

    async setupWebRTCAsCaller(targetUserId) {
        try {
            // Obtener stream de audio
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            // Crear conexión peer
            this.peerConnection = new RTCPeerConnection(this.rtcConfiguration);

            // Agregar stream local
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            // Manejar stream remoto
            this.peerConnection.ontrack = (event) => {
                console.log(" Stream remoto recibido");
                this.remoteStream = event.streams[0];
                this.setupRemoteAudio();
            };

            // Manejar candidatos ICE
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendWebRTCSignal(targetUserId, {
                        type: 'ice-candidate',
                        candidate: event.candidate
                    });
                }
            };

            // Crear oferta
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            // Enviar oferta al receptor
            this.sendWebRTCSignal(targetUserId, {
                type: 'offer',
                offer: offer
            });

            this.isInCall = true;
            this.currentCall = {
                targetId: targetUserId,
                startTime: new Date(),
                isCaller: true
            };

            this.showCallInterface();

        } catch (error) {
            console.error("Error configurando WebRTC:", error);
            throw error;
        }
    }

    setupRemoteAudio() {
        const remoteAudio = document.getElementById('remoteAudio');
        if (remoteAudio && this.remoteStream) {
            remoteAudio.srcObject = this.remoteStream;
            remoteAudio.play().catch(e => console.error("Error reproduciendo audio remoto:", e));
        }
    }

    sendWebRTCSignal(targetUserId, signal) {
        this.chatService.sendWebRTCSignal(
            this.currentUser.id,
            targetUserId,
            JSON.stringify(signal)
        );
    }

    sendWebRTCAnswer(targetUserId, signal) {
        this.chatService.sendWebRTCAnswer(
            this.currentUser.id,
            targetUserId,
            JSON.stringify(signal)
        );
    }

    async endVoiceCall() {
        if (!this.isInCall) return;

        try {
            console.log(" Finalizando llamada...");
            
            await this.chatService.endVoiceCall(this.currentUser.id);
            
            // Cerrar conexión WebRTC
            if (this.peerConnection) {
                this.peerConnection.close();
                this.peerConnection = null;
            }

            // Detener streams
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }

            if (this.remoteStream) {
                this.remoteStream.getTracks().forEach(track => track.stop());
                this.remoteStream = null;
            }

            this.hideCallInterface();
            this.showNotification("Llamada finalizada", "info");
            
            console.log(" Llamada finalizada exitosamente");

        } catch (error) {
            console.error(" Error finalizando llamada:", error);
            alert("Error al finalizar la llamada: " + error.message);
        }
    }

    showCallInterface() {
        const callInterface = document.createElement('div');
        callInterface.id = 'callInterface';
        callInterface.className = 'call-interface active';
        
        const targetUser = this.selectedContact || { username: 'Usuario' };
        
        callInterface.innerHTML = `
            <div class="call-container">
                <div class="call-header">
                    <div class="call-avatar">
                        <i class="fas fa-user"></i>
                    </div>
                    <div class="call-info">
                        <h3>En llamada con ${this.escapeHtml(targetUser.username)}</h3>
                        <div class="call-timer">00:00</div>
                        <div class="call-status">Llamada en curso...</div>
                    </div>
                </div>
                <div class="call-controls">
                    <button class="call-control-btn hangup-btn" onclick="window.chatApp.endVoiceCall()">
                        <i class="fas fa-phone-slash"></i>
                    </button>
                </div>
                <audio id="remoteAudio" autoplay playsinline></audio>
                <audio id="localAudio" muted autoplay playsinline></audio>
            </div>
        `;

        document.body.appendChild(callInterface);

        // Configurar audio local (solo para eco)
        const localAudio = document.getElementById('localAudio');
        if (localAudio && this.localStream) {
            localAudio.srcObject = this.localStream;
        }

        // Iniciar temporizador
        this.callStartTime = new Date();
        this.callDurationInterval = setInterval(() => {
            this.updateCallTimer();
        }, 1000);

        this.updateUsers();
    }

    hideCallInterface() {
        const callInterface = document.getElementById('callInterface');
        if (callInterface) {
            callInterface.remove();
        }

        if (this.callDurationInterval) {
            clearInterval(this.callDurationInterval);
            this.callDurationInterval = null;
        }

        this.isInCall = false;
        this.currentCall = null;
        this.callStartTime = null;

        // Actualizar lista de contactos para habilitar botones de llamada
        this.updateUsers();
    }

    updateCallTimer() {
        if (!this.callStartTime) return;

        const now = new Date();
        const diff = Math.floor((now - this.callStartTime) / 1000);
        const minutes = Math.floor(diff / 60).toString().padStart(2, '0');
        const seconds = (diff % 60).toString().padStart(2, '0');
        
        const timerElement = document.querySelector('.call-timer');
        if (timerElement) {
            timerElement.textContent = `${minutes}:${seconds}`;
        }
    }


    selectContact(user) {
        this.selectedContact = user;
        this.selectedGroup = null; // ← Deseleccionar grupo
        this.updateChatHeader(user.username, user.isOnline ? 'En línea' : 'Desconectado');

        // Marcar el contacto como activo
        document.querySelectorAll('.contact').forEach(c => c.classList.remove('active'));
        const contacts = Array.from(document.querySelectorAll('.contact'));
        const selectedContactElement = contacts.find(c => {
            const nameElement = c.querySelector('.contact-name');
            return nameElement && nameElement.textContent === user.username;
        });
        if (selectedContactElement) {
            selectedContactElement.classList.add('active');
        }

        // Cargar mensajes privados inmediatamente
        this.updateMessages();
    }

    updateChatHeader(title, subtitle) {
        const headerInfo = this.chatHeader.querySelector('.chat-header-info');
        
        const backButton = (this.selectedContact || this.selectedGroup) ? `
            <button class="icon-btn back-btn" title="Volver al chat general" onclick="window.chatApp.backToGeneralChat()">
                <i class="fas fa-arrow-left"></i>
            </button>
        ` : '';
        
        // Botón de llamada solo si hay contacto seleccionado y no estamos en llamada
        const callButton = (this.selectedContact && !this.isInCall) ? `
            <button class="icon-btn call-btn" title="Llamar" onclick="window.chatApp.startVoiceCall()">
                <i class="fas fa-phone"></i>
            </button>
        ` : '';
        
        headerInfo.innerHTML = `
            ${backButton}
            <div class="chat-header-text">
                <h2 class="chat-title">${this.escapeHtml(title)}</h2>
                <span class="chat-subtitle">${subtitle}</span>
            </div>
        `;

        // Actualizar área de acciones del header
        const chatActions = this.chatHeader.querySelector('.chat-actions');
        chatActions.innerHTML = callButton;
    }

    backToGeneralChat() {
        this.selectedContact = null;
        this.updateChatHeader("Chat General", "Conectado como " + this.currentUser.username);
        
        // Desmarcar todos los contactos
        document.querySelectorAll('.contact').forEach(c => c.classList.remove('active'));
        
        // Cargar mensajes del chat general
        this.updateMessages();
    }

    isScrolledToBottom() {
        const threshold = 50;
        return this.messagesContainer.scrollHeight - this.messagesContainer.scrollTop
            <= this.messagesContainer.clientHeight + threshold;
    }

    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showNotification(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        // Crear notificación visual
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'info-circle'}"></i>
            ${this.escapeHtml(message)}
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    async disconnect() {
        // Finalizar llamada si está activa
        if (this.isInCall) {
            await this.endVoiceCall();
        }

        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }

        if (this.currentUser && this.chatService) {
            try {
                await this.chatService.leaveChat(this.currentUser.id);
                console.log(" Desconectado correctamente");
            } catch (error) {
                console.error("Error al desconectar:", error);
            }
        }

        if (this.communicator) {
            await this.communicator.destroy();
        }
    }
}

// Inicializar la aplicación
let app;

window.addEventListener('DOMContentLoaded', async () => {
    console.log(" Iniciando ChatApp...");
    app = new ChatApp();
    window.chatApp = app;

    // Conectar al servidor
    setTimeout(async () => {
        await app.connect();
    }, 500);
});

// Desconectar al cerrar la página
window.addEventListener('beforeunload', () => {
    if (app) {
        app.disconnect();
    }
});