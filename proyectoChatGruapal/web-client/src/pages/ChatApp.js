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
        // Prevenir múltiples inicializaciones
        if (window.chatAppInstance) {
            console.warn("ChatApp ya está inicializado, reutilizando instancia existente");
            return window.chatAppInstance;
        }

        this.communicator = null;
        this.chatService = null;
        this.currentUser = null;
        this.selectedContact = null;
        this.pollInterval = null;
        this.selectedGroup = null;
        this.userGroups = new Set(); // Grupos a los que el usuario pertenece

        // Flag para prevenir múltiples envíos simultáneos
        this.isSendingAudio = false;

        // Referencias DOM
        this.messagesContainer = document.getElementById('messages');
        this.contactsList = document.getElementById('contacts');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.chatHeader = document.getElementById('chatHeader');

        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;

        this.initializeEventListeners();
        
        // Guardar instancia global
        window.chatAppInstance = this;
    }

    initializeEventListeners() {
        // Remover listeners previos si existen para evitar duplicados
        const newSendBtn = this.sendBtn.cloneNode(true);
        this.sendBtn.parentNode.replaceChild(newSendBtn, this.sendBtn);
        this.sendBtn = newSendBtn;

        const newMessageInput = this.messageInput.cloneNode(true);
        this.messageInput.parentNode.replaceChild(newMessageInput, this.messageInput);
        this.messageInput = newMessageInput;

        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        // Botón iniciar grabación
        const micBtn = document.querySelector('.mic-btn');
        if (micBtn && !micBtn.dataset.listenerAdded) {
            micBtn.addEventListener('click', () => this.startRecording());
            micBtn.dataset.listenerAdded = 'true';
        }

        // Botón cancelar grabación
        const cancelAudioBtn = document.querySelector('#recordingInput .cancel-btn');
        if (cancelAudioBtn && !cancelAudioBtn.dataset.listenerAdded) {
            cancelAudioBtn.addEventListener('click', () => this.cancelRecording());
            cancelAudioBtn.dataset.listenerAdded = 'true';
        }

        // Botón enviar audio
        const sendAudioBtn = document.querySelector('#recordingInput .send-btn');
        if (sendAudioBtn && !sendAudioBtn.dataset.listenerAdded) {
            sendAudioBtn.addEventListener('click', () => this.sendAudioMessage());
            sendAudioBtn.dataset.listenerAdded = 'true';
        }
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
            } else {
                // Obtener mensajes del chat general
                messages = await this.chatService.getMessages();
            }
            this.renderMessages(messages);
        } catch (error) {
            console.error("Error obteniendo mensajes:", error);
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

        onlineUsers.forEach(user => {
            const contactDiv = document.createElement('div');
            contactDiv.className = 'contact';
            contactDiv.onclick = () => this.selectContact(user);

            const initial = user.username.charAt(0).toUpperCase();
            const statusClass = user.isOnline ? 'online' : 'offline';

            contactDiv.innerHTML = `
                <div class="avatar">${initial}</div>
                <div class="contact-info">
                    <div class="contact-name">${user.username}</div>
                    <div class="contact-preview ${statusClass}">
                        ${user.isOnline ? '● En línea' : '○ Desconectado'}
                    </div>
                </div>
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

        if (messages.length === 0) {
            this.messagesContainer.innerHTML = `
                <div class="messages-placeholder">
                    <i class="fas fa-comment-dots"></i>
                    <p>No hay mensajes aún. ¡Sé el primero en escribir!</p>
                </div>
            `;
            return;
        }

        messages.forEach(msg => {
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
            messageDiv.className = isMyMessage ? 'message my-message' : 'message other-message';
            messageDiv.innerHTML = `
                <div class="message-content">
                    <i class="fas fa-phone"></i> ${this.escapeHtml(msg.content)}
                </div>
                ${!isMyMessage ? `<div class="message-sender">${this.escapeHtml(msg.senderName)}</div>` : ''}
            `;
        } else if (msg.type.value === ChatUI.MessageTypeEnum.AUDIO.value) {
            const isMyMessage = msg.senderId === this.currentUser.id;

            const audioUrl = "data:audio/webm;base64," + msg.content;

            messageDiv.className = isMyMessage ? 'message my-message' : 'message other-message';
            messageDiv.innerHTML = `
        <div class="message-content audio-message">
            <audio controls src="${audioUrl}"></audio>
        </div>
        ${this.selectedGroup || !isMyMessage ? `<div class="message-sender">${this.escapeHtml(msg.senderName)}</div>` : ''}
    `;
        } else {
            messageDiv.className = isMyMessage ? 'message my-message' : 'message other-message';

            // En grupos, SIEMPRE mostrar el nombre del remitente para evitar confusión
            const showSender = this.selectedGroup || !isMyMessage;

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

    async startRecording() {
        try {
            if (this.isRecording) return;

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            this.isRecording = true;

            this.mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) {
                    this.audioChunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                // Este handler se sobrescribirá en sendAudioMessage si es necesario
                console.log("Grabación detenida");
            };

            this.mediaRecorder.start();
            
            // Mostrar la interfaz de grabación
            this.showRecordingInterface();
            
            console.log("Grabación iniciada...");
        } catch (e) {
            console.error("Error iniciando grabación:", e);
            alert("No se pudo acceder al micrófono");
            this.isRecording = false;
        }
    }

    cancelRecording() {
        if (!this.isRecording || !this.mediaRecorder) return;

        try {
            this.mediaRecorder.stop();
        } catch { }

        // Cerrar el stream de medios
        if (this.mediaRecorder && this.mediaRecorder.stream) {
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }

        this.isRecording = false;
        this.audioChunks = [];
        this.mediaRecorder = null;
        this.hideRecordingInterface();
        console.log("Grabación cancelada");
    }

    hideRecordingInterface() {
        const recordingInput = document.getElementById('recordingInput');
        const normalInput = document.getElementById('normalInput');
        if (recordingInput) recordingInput.style.display = 'none';
        if (normalInput) normalInput.style.display = 'flex';
    }

    showRecordingInterface() {
        const recordingInput = document.getElementById('recordingInput');
        const normalInput = document.getElementById('normalInput');
        if (recordingInput) recordingInput.style.display = 'flex';
        if (normalInput) normalInput.style.display = 'none';
    }

    async sendAudioMessage() {
        // Prevenir múltiples envíos simultáneos
        if (this.isSendingAudio) {
            console.warn("Ya hay un envío de audio en proceso, ignorando...");
            return;
        }

        console.log("sendAudioMessage llamado - currentUser:", this.currentUser);
        console.log("sendAudioMessage - selectedContact:", this.selectedContact);
        console.log("sendAudioMessage - selectedGroup:", this.selectedGroup);
        
        // Verificar que el chatService esté disponible
        if (!this.chatService) {
            console.error("ChatService no disponible");
            alert("No se pudo enviar el mensaje de audio: Servicio no disponible");
            this.hideRecordingInterface();
            return;
        }

        // Verificar que el usuario esté conectado
        if (!this.currentUser || !this.currentUser.id) {
            console.error("Usuario no conectado, no se puede enviar audio. currentUser:", this.currentUser);
            alert("No se pudo enviar el mensaje de audio: Debes estar conectado primero");
            this.hideRecordingInterface();
            return;
        }

        // Marcar como enviando
        this.isSendingAudio = true;

        if (!this.mediaRecorder) {
            console.warn("No se ha iniciado una grabación");
            alert("No se pudo enviar el mensaje de audio: No hay grabación activa");
            this.hideRecordingInterface();
            return;
        }

        if (!this.isRecording && (!this.audioChunks || this.audioChunks.length === 0)) {
            console.warn("No hay grabación activa ni datos de audio");
            alert("No se pudo enviar el mensaje de audio: No hay grabación activa");
            this.hideRecordingInterface();
            return;
        }

        try {
            // Detener la grabación y esperar a que termine
            await new Promise((resolve, reject) => {
                // Guardar el handler original si existe
                const originalOnStop = this.mediaRecorder.onstop;
                
                this.mediaRecorder.onstop = () => {
                    try {
                        // Restaurar el handler original si existía
                        if (originalOnStop) {
                            originalOnStop();
                        }
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                };

                this.mediaRecorder.onerror = (event) => {
                    reject(new Error("Error en MediaRecorder: " + event.error));
                };

                try {
                    if (this.mediaRecorder.state === 'recording') {
                        this.mediaRecorder.stop();
                    } else {
                        // Si ya está detenido, resolver inmediatamente
                        resolve();
                    }
                } catch (e) {
                    reject(e);
                }
            });

            // Esperar un momento para asegurar que todos los chunks se hayan recopilado
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verificar que haya chunks de audio
            if (!this.audioChunks || this.audioChunks.length === 0) {
                console.warn("No hay audio para enviar");
                alert("No se pudo enviar el mensaje de audio: No hay datos de audio");
                this.isRecording = false;
                this.audioChunks = [];
                return;
            }

            // Crear el blob con todos los chunks
            const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
            
            // Verificar que el blob tenga contenido
            if (blob.size === 0) {
                console.warn("El blob de audio está vacío");
                alert("No se pudo enviar el mensaje de audio: El audio está vacío");
                this.isRecording = false;
                this.audioChunks = [];
                return;
            }

            // Convertir a base64
            const base64 = await this.blobToBase64(blob);

            // Guardar referencias locales ANTES de limpiar estado
            const currentUser = this.currentUser;
            const selectedGroup = this.selectedGroup;
            const selectedContact = this.selectedContact;
            const stream = this.mediaRecorder ? this.mediaRecorder.stream : null;

            // Verificar que el usuario actual esté disponible
            if (!currentUser || !currentUser.id) {
                console.error("Usuario actual no disponible después de procesar audio");
                alert("No se pudo enviar el mensaje de audio: Usuario no autenticado");
                this.isRecording = false;
                this.audioChunks = [];
                if (stream) {
                    stream.getTracks().forEach(track => track.stop());
                }
                this.mediaRecorder = null;
                this.hideRecordingInterface();
                return;
            }

            // Cerrar el stream de medios si existe
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }

            // Limpiar el estado
            this.isRecording = false;
            this.audioChunks = [];
            this.mediaRecorder = null;

            // Enviar a backend según el chat activo usando las referencias locales
            try {
                if (selectedGroup && selectedGroup.id) {
                    console.log("Enviando audio al grupo:", selectedGroup.id);
                    await this.chatService.sendGroupMessage(
                        selectedGroup.id,
                        currentUser.id,
                        base64,
                        Chat.MessageTypeEnum.AUDIO
                    );
                } else if (selectedContact && selectedContact.id) {
                    console.log("Enviando audio a contacto:", selectedContact.id);
                    await this.chatService.sendPrivateMessage(
                        currentUser.id,
                        selectedContact.id,
                        base64,
                        Chat.MessageTypeEnum.AUDIO
                    );
                } else {
                    // Enviar al chat general
                    console.log("Enviando audio al chat general");
                    await this.chatService.sendMessage(
                        currentUser.id,
                        base64,
                        Chat.MessageTypeEnum.AUDIO
                    );
                }
            } catch (sendError) {
                console.error("Error al enviar audio al servidor:", sendError);
                throw sendError;
            }

            console.log("Audio enviado correctamente");
            
            // Ocultar la interfaz de grabación primero
            this.hideRecordingInterface();
            
            // Esperar un momento para que el servidor procese el mensaje
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Actualizar mensajes para mostrar el audio enviado
            await this.updateMessages();

        } catch (err) {
            console.error("Error enviando audio:", err);
            alert("No se pudo enviar el mensaje de audio: " + (err.message || err));
            
            // Limpiar el estado en caso de error
            this.isRecording = false;
            this.audioChunks = [];
            if (this.mediaRecorder && this.mediaRecorder.stream) {
                this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            }
            this.mediaRecorder = null;
            this.hideRecordingInterface();
        } finally {
            // Siempre liberar el flag de envío
            this.isSendingAudio = false;
        }
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
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

        // Si hay un contacto seleccionado, agregar botón para volver al chat general
        const backButton = this.selectedContact ? `
            <button class="icon-btn back-btn" title="Volver al chat general" onclick="window.chatApp.backToGeneralChat()">
                <i class="fas fa-arrow-left"></i>
            </button>
        ` : '';

        headerInfo.innerHTML = `
            ${backButton}
            <div class="chat-header-text">
                <h2 class="chat-title">${title}</h2>
                <span class="chat-subtitle">${subtitle}</span>
            </div>
        `;
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

// Añadir estilos adicionales
const style = document.createElement('style');
style.textContent = `
    .system-message {
        align-self: center;
        margin: 10px 0;
    }
    .system-message-content {
        background: var(--bg-card);
        color: var(--text-muted);
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .system-message-content i {
        color: var(--secondary);
    }
    
    .member-badge {
        display: inline-block;
        background: var(--secondary);
        color: white;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.7rem;
        margin-left: 8px;
        font-weight: 600;
    }
    
    .btn-secondary {
        flex: 1;
        padding: 14px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--bg-input);
        color: var(--text);
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s ease;
    }
    
    .btn-secondary:hover {
        background: var(--bg-card);
        border-color: var(--text-muted);
    }
    
    .notification {
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--bg-card);
        color: var(--text);
        padding: 15px 20px;
        border-radius: 12px;
        border: 1px solid var(--border);
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        transform: translateX(400px);
        opacity: 0;
        transition: all 0.3s ease;
        z-index: 2000;
        max-width: 350px;
    }
    
    .notification.show {
        transform: translateX(0);
        opacity: 1;
    }
    
    .notification-success {
        border-color: var(--secondary);
    }
    
    .notification-success i {
        color: var(--secondary);
    }
    
    .notification-info i {
        color: var(--primary);
    }
    
    .back-btn {
        margin-right: 10px;
    }
    
    .back-btn:hover {
        transform: translateX(-2px);
    }
    
    .join-modal {
        animation: modalZoomIn 0.3s ease;
    }
    
    @keyframes modalZoomIn {
        from {
            transform: scale(0.9);
            opacity: 0;
        }
        to {
            transform: scale(1);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);

// Inicializar la aplicación - Prevenir múltiples inicializaciones
let app;

// Solo inicializar si no existe ya una instancia
if (!window.chatApp && !window.chatAppInstance) {
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', async () => {
            console.log(" Iniciando ChatApp...");
            app = new ChatApp();
            window.chatApp = app;

            // Conectar al servidor
            setTimeout(async () => {
                await app.connect();
            }, 500);
        });
    } else {
        // DOM ya está listo
        console.log(" Iniciando ChatApp (DOM ya listo)...");
        app = new ChatApp();
        window.chatApp = app;

        // Conectar al servidor
        setTimeout(async () => {
            await app.connect();
        }, 500);
    }
} else {
    console.log(" ChatApp ya está inicializado, reutilizando instancia existente");
    app = window.chatApp || window.chatAppInstance;
}

// Desconectar al cerrar la página
window.addEventListener('beforeunload', () => {
    if (app) {
        app.disconnect();
    }
});