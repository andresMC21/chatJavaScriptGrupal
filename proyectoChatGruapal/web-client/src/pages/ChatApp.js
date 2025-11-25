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

        // Variables de audio
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordedAudio = null;
        this.isRecording = false;
        this.recordingStartTime = null;
        this.recordingTimerInterval = null;

        // Referencias DOM
        this.messagesContainer = document.getElementById('messages');
        this.contactsList = document.getElementById('contacts');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.chatHeader = document.getElementById('chatHeader');

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

        // Botón de micrófono para grabar audio - usar delegación de eventos para mayor robustez
        const micBtn = document.querySelector('.mic-btn');
        if (micBtn) {
            // Remover listener previo si existe
            const newMicBtn = micBtn.cloneNode(true);
            micBtn.parentNode.replaceChild(newMicBtn, micBtn);
            newMicBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleMicClick();
            });
        }

        // Botón cancelar grabación
        const cancelAudioBtn = document.querySelector('#recordingInput .cancel-btn');
        if (cancelAudioBtn) {
            const newCancelBtn = cancelAudioBtn.cloneNode(true);
            cancelAudioBtn.parentNode.replaceChild(newCancelBtn, cancelAudioBtn);
            newCancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.cancelRecording();
            });
        }

        // Botón enviar audio
        const sendAudioBtn = document.querySelector('#recordingInput .send-btn');
        if (sendAudioBtn) {
            const newSendAudioBtn = sendAudioBtn.cloneNode(true);
            sendAudioBtn.parentNode.replaceChild(newSendAudioBtn, sendAudioBtn);
            newSendAudioBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.sendAudio();
            });
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
            
            // Log para depuración de mensajes de audio
            messages.forEach(msg => {
                if (msg.type && msg.type.value === ChatUI.MessageTypeEnum.AUDIO.value) {
                    console.log("Mensaje de audio recibido - ID:", msg.id, "Longitud contenido:", msg.content ? msg.content.length : 0);
                    if (msg.content && msg.content.length > 0) {
                        console.log("  Primeros 100 chars:", msg.content.substring(0, Math.min(100, msg.content.length)));
                        console.log("  Últimos 100 chars:", msg.content.substring(Math.max(0, msg.content.length - 100)));
                    }
                }
            });
            
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

        if (messages.length === 0) {
            // Solo limpiar si realmente no hay mensajes
            if (this.messagesContainer.children.length > 0) {
                this.messagesContainer.innerHTML = `
                    <div class="messages-placeholder">
                        <i class="fas fa-comment-dots"></i>
                        <p>No hay mensajes aún. ¡Sé el primero en escribir!</p>
                    </div>
                `;
            }
            return;
        }

        // Obtener mensajes existentes en el DOM
        const existingMessageIds = new Set();
        const existingMessages = Array.from(this.messagesContainer.children).filter(child => {
            const msgId = child.dataset.messageId;
            if (msgId) {
                existingMessageIds.add(msgId);
                return true;
            }
            return false;
        });

        // Si no hay mensajes en el DOM, renderizar todos
        if (existingMessages.length === 0) {
            this.messagesContainer.innerHTML = '';
            messages.forEach(msg => {
                const messageDiv = this.createMessageElement(msg);
                this.messagesContainer.appendChild(messageDiv);
            });
        } else {
            // Solo agregar mensajes nuevos al final
            messages.forEach(msg => {
                if (!existingMessageIds.has(msg.id)) {
                    const messageDiv = this.createMessageElement(msg);
                    this.messagesContainer.appendChild(messageDiv);
                }
            });
        }

        if (shouldScrollDown) {
            this.scrollToBottom();
        }
    }

    createMessageElement(msg) {
        const isMyMessage = msg.senderId === this.currentUser.id;
        const messageDiv = document.createElement('div');
        messageDiv.dataset.messageId = msg.id; // Asignar ID para evitar recrear mensajes existentes

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

            // Verificar que el contenido no esté vacío
            if (!msg.content || msg.content.length === 0) {
                messageDiv.className = isMyMessage ? 'message my-message' : 'message other-message';
                messageDiv.innerHTML = `
                    <div class="message-content">Error: Audio vacío</div>
                    ${this.selectedGroup || !isMyMessage ? `<div class="message-sender">${this.escapeHtml(msg.senderName)}</div>` : ''}
                `;
                return messageDiv;
            }

            messageDiv.className = isMyMessage ? 'message my-message' : 'message other-message';
            
            // Crear contenedor del mensaje
            const messageContent = document.createElement('div');
            messageContent.className = 'message-content audio-message';
            
            // Crear elemento audio directamente (más confiable que innerHTML)
            const audioElement = document.createElement('audio');
            const audioId = `audio-${msg.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
            audioElement.id = audioId;
            audioElement.controls = true;
            audioElement.preload = 'metadata'; // Cambiar de 'auto' a 'metadata' para evitar carga completa
            audioElement.autoplay = false; // Asegurar que no se reproduzca automáticamente
            
            // Intentar diferentes tipos MIME para compatibilidad
            const mimeTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/mp4'
            ];
            
            // Crear el data URI con el primer tipo MIME
            const audioUrl = `data:${mimeTypes[0]};base64,${msg.content}`;
            
            // Log para depuración
            console.log("Renderizando audio - ID:", msg.id, "Longitud base64:", msg.content.length);
            console.log("URL de audio creada (primeros 100 chars):", audioUrl.substring(0, 100));
            
            // Agregar event listeners para depuración y manejo de errores
            audioElement.addEventListener('loadedmetadata', () => {
                console.log(`✓ Audio ${msg.id} cargado - Duración: ${audioElement.duration.toFixed(2)}s`);
            });
            
            audioElement.addEventListener('canplay', () => {
                console.log(`✓ Audio ${msg.id} puede reproducirse`);
                // Asegurar que no se reproduzca automáticamente
                if (audioElement.autoplay) {
                    audioElement.pause();
                    audioElement.currentTime = 0;
                }
            });
            
            audioElement.addEventListener('canplaythrough', () => {
                console.log(`✓ Audio ${msg.id} listo para reproducir completamente`);
                // Asegurar que no se reproduzca automáticamente
                if (!audioElement.paused && audioElement.currentTime > 0) {
                    audioElement.pause();
                    audioElement.currentTime = 0;
                }
            });
            
            // Establecer la fuente después de configurar los listeners para evitar reproducción automática
            audioElement.src = audioUrl;
            
            // Asegurar que esté pausado después de establecer la fuente
            audioElement.pause();
            audioElement.currentTime = 0;
            
            audioElement.addEventListener('error', (e) => {
                console.error(`✗ Error cargando audio ${msg.id}:`, audioElement.error);
                if (audioElement.error) {
                    console.error("  Código:", audioElement.error.code);
                    console.error("  Mensaje:", audioElement.error.message);
                    
                    // Intentar con otro tipo MIME si hay error
                    if (audioElement.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                        console.log("  Intentando con tipo MIME alternativo...");
                        for (let i = 1; i < mimeTypes.length; i++) {
                            const altUrl = `data:${mimeTypes[i]};base64,${msg.content}`;
                            console.log(`  Probando: ${mimeTypes[i]}`);
                            audioElement.src = altUrl;
                            break;
                        }
                    }
                }
            });
            
            audioElement.addEventListener('loadstart', () => {
                console.log(`→ Audio ${msg.id} comenzando a cargar`);
                // Asegurar que no se reproduzca automáticamente al cargar
                if (!audioElement.paused) {
                    audioElement.pause();
                    audioElement.currentTime = 0;
                }
            });
            
            audioElement.addEventListener('loadeddata', () => {
                console.log(`→ Audio ${msg.id} datos cargados`);
                // Asegurar que no se reproduzca automáticamente después de cargar datos
                if (!audioElement.paused) {
                    audioElement.pause();
                    audioElement.currentTime = 0;
                }
            });
            
            // Agregar el audio al contenedor
            messageContent.appendChild(audioElement);
            messageDiv.appendChild(messageContent);
            
            // Asegurar que esté pausado después de agregarlo al DOM (algunos navegadores pueden intentar reproducir)
            setTimeout(() => {
                if (!audioElement.paused) {
                    audioElement.pause();
                    audioElement.currentTime = 0;
                }
            }, 100);
            
            // Agregar nombre del remitente si es necesario
            if (this.selectedGroup || !isMyMessage) {
                const senderDiv = document.createElement('div');
                senderDiv.className = 'message-sender';
                senderDiv.textContent = msg.senderName;
                messageDiv.appendChild(senderDiv);
            }
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


    // ========== FUNCIONALIDAD DE AUDIO - IMPLEMENTACIÓN SIMPLE ==========
    
    handleMicClick() {
        if (!this.isRecording) {
            this.startRecording();
        } else {
            this.sendAudio();
        }
    }

    async startRecording() {
        // Validar que no esté grabando ya
        if (this.isRecording) {
            console.warn("Ya hay una grabación en curso");
            return;
        }
        
        try {
            console.log("Solicitando acceso al micrófono...");
            
            // Obtener acceso al micrófono con configuración optimizada
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 44100
                } 
            });
            
            console.log("✓ Acceso al micrófono concedido");
            
            // Determinar el mejor codec disponible
            let mimeType = '';
            const codecs = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/mp4'
            ];
            
            for (const codec of codecs) {
                if (MediaRecorder.isTypeSupported(codec)) {
                    mimeType = codec;
                    console.log("Codec seleccionado:", codec);
                    break;
                }
            }
            
            if (!mimeType) {
                console.warn("Usando codec por defecto del navegador");
            }
            
            // Crear MediaRecorder con el mejor codec
            const options = mimeType ? { mimeType } : {};
            this.mediaRecorder = new MediaRecorder(stream, options);
            this.audioChunks = [];
            
            // Capturar chunks de audio cada 100ms para mejor captura
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.audioChunks.push(event.data);
                    const totalSize = this.audioChunks.reduce((sum, chunk) => sum + chunk.size, 0);
                    console.log(`Chunk recibido: ${event.data.size} bytes | Total: ${this.audioChunks.length} chunks, ${totalSize} bytes`);
                }
            };
            
            // Cuando se detiene, crear el blob final
            this.mediaRecorder.onstop = () => {
                if (this.audioChunks.length > 0) {
                    const audioBlob = new Blob(this.audioChunks, { type: mimeType || 'audio/webm' });
                    this.recordedAudio = audioBlob;
                    const totalSize = this.audioChunks.reduce((sum, chunk) => sum + chunk.size, 0);
                    console.log("✓ Grabación detenida - Blob:", audioBlob.size, "bytes | Chunks totales:", totalSize, "bytes");
                } else {
                    console.warn("No se capturaron chunks de audio");
                }
            };
            
            // Manejar errores del MediaRecorder
            this.mediaRecorder.onerror = (event) => {
                console.error("Error en MediaRecorder:", event.error);
                alert("Error durante la grabación: " + event.error.message);
                this.cancelRecording();
            };
            
            // Iniciar grabación con timeslice de 100ms para capturar datos periódicamente
            this.mediaRecorder.start(100);
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            
            console.log("✓ Grabación iniciada");
            
            // Mostrar interfaz de grabación
            this.showRecordingInterface();
            this.startRecordingTimer();
            
            // Cambiar icono del botón de micrófono a enviar
            const micBtn = document.querySelector('.mic-btn');
            if (micBtn) {
                micBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
                micBtn.title = "Enviar audio";
            }
            
        } catch (error) {
            console.error("Error al iniciar grabación:", error);
            
            let errorMessage = "No se pudo acceder al micrófono.";
            if (error.name === 'NotAllowedError') {
                errorMessage = "Permiso de micrófono denegado. Por favor, permite el acceso al micrófono en la configuración del navegador.";
            } else if (error.name === 'NotFoundError') {
                errorMessage = "No se encontró ningún micrófono. Por favor, conecta un micrófono e intenta de nuevo.";
            } else if (error.name === 'NotReadableError') {
                errorMessage = "El micrófono está siendo usado por otra aplicación. Por favor, cierra otras aplicaciones que usen el micrófono.";
            } else {
                errorMessage = error.message || errorMessage;
            }
            
            alert(errorMessage);
            this.isRecording = false;
        }
    }

    startRecordingTimer() {
        const timeDisplay = document.querySelector('.recording-time');
        if (!timeDisplay) return;

        this.recordingTimerInterval = setInterval(() => {
            if (!this.isRecording) {
                clearInterval(this.recordingTimerInterval);
                return;
            }
            const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            timeDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }, 100);
    }

    cancelRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        
        if (this.mediaRecorder && this.mediaRecorder.stream) {
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        
        if (this.recordingTimerInterval) {
            clearInterval(this.recordingTimerInterval);
            this.recordingTimerInterval = null;
        }
        
        this.isRecording = false;
        this.audioChunks = [];
        this.recordedAudio = null;
        this.mediaRecorder = null;
        this.hideRecordingInterface();
        this.resetMicButton();
    }

    async sendAudio() {
        // Validar que hay algo para enviar
        if (!this.isRecording && !this.recordedAudio) {
            console.warn("No hay audio para enviar");
            return;
        }
        
        // Validar que el usuario esté conectado
        if (!this.currentUser || !this.currentUser.id) {
            alert("Debes estar conectado para enviar audio");
            this.cancelRecording();
            return;
        }
        
        // Validar que el servicio esté disponible
        if (!this.chatService) {
            alert("Servicio de chat no disponible");
            this.cancelRecording();
            return;
        }
        
        try {
            // Si está grabando, detener la grabación primero
            if (this.isRecording && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                console.log("Deteniendo grabación antes de enviar...");
                
                // Solicitar datos finales antes de detener
                this.mediaRecorder.requestData();
                
                // Detener y esperar a que termine
                await new Promise((resolve, reject) => {
                    let resolved = false;
                    const timeout = setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            console.warn("Timeout esperando detención de grabación");
                            resolve();
                        }
                    }, 5000);
                    
                    const originalOnStop = this.mediaRecorder.onstop;
                    this.mediaRecorder.onstop = () => {
                        if (originalOnStop) originalOnStop();
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            // Esperar un poco más para que se procesen todos los chunks
                            setTimeout(resolve, 300);
                        }
                    };
                    
                    this.mediaRecorder.onerror = (event) => {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            reject(new Error("Error en MediaRecorder: " + event.error));
                        }
                    };
                    
                    try {
                        this.mediaRecorder.stop();
                    } catch (e) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            reject(e);
                        }
                    }
                });
            }
            
            // Cerrar stream de audio
            if (this.mediaRecorder && this.mediaRecorder.stream) {
                this.mediaRecorder.stream.getTracks().forEach(track => {
                    track.stop();
                    console.log("Track de audio detenido:", track.kind);
                });
            }
            
            // Detener timer de grabación
            if (this.recordingTimerInterval) {
                clearInterval(this.recordingTimerInterval);
                this.recordingTimerInterval = null;
            }

            // Enforce minimum recording duration of 1 second
            if (this.recordingStartTime) {
                const durationSeconds = (Date.now() - this.recordingStartTime) / 1000;
                console.log(`Duración de grabación: ${durationSeconds.toFixed(2)} segundos`);
                if (durationSeconds < 1) {
                    alert("El mensaje de audio es demasiado corto. Por favor, graba al menos 1 segundo de audio.");
                    this.cancelRecording();
                    return;
                }
            }
            
            // Crear el blob final con todos los chunks
            let audioBlob = null;
            const mimeType = this.mediaRecorder?.mimeType || 'audio/webm;codecs=opus';
            
            if (this.audioChunks.length > 0) {
                audioBlob = new Blob(this.audioChunks, { type: mimeType });
                const totalSize = this.audioChunks.reduce((sum, chunk) => sum + chunk.size, 0);
                console.log("Blob creado - tamaño:", audioBlob.size, "bytes, chunks:", this.audioChunks.length, "tamaño total chunks:", totalSize, "bytes");
            } else if (this.recordedAudio) {
                audioBlob = this.recordedAudio;
                console.log("Usando audio grabado previamente - tamaño:", audioBlob.size, "bytes");
            }
            
            // Validar que el blob tenga contenido
            if (!audioBlob || audioBlob.size === 0) {
                alert("No hay audio para enviar. Por favor, graba un mensaje de audio.");
                this.cancelRecording();
                return;
            }

            // Warning if audio size is too small (e.g., less than 1KB ~ might be incomplete)
            if (audioBlob.size < 1024) {
                console.warn("Advertencia: El audio grabado es muy pequeño (" + audioBlob.size + " bytes). Puede estar incompleto o muy corto.");
            }

            // Log mediaRecorder state for debugging
            if (this.mediaRecorder) {
                console.log("Estado de mediaRecorder al enviar audio:", this.mediaRecorder.state);
            }
            
            // Convertir a base64
            console.log("Convirtiendo audio a base64...");
            const base64 = await this.blobToBase64(audioBlob);
            console.log("Base64 generado - longitud:", base64.length, "caracteres");
            
            // Guardar referencias antes de limpiar estado
            const currentUser = this.currentUser;
            const selectedGroup = this.selectedGroup;
            const selectedContact = this.selectedContact;
            
            // Limpiar estado de grabación
            this.isRecording = false;
            this.audioChunks = [];
            this.recordedAudio = null;
            this.mediaRecorder = null;
            this.hideRecordingInterface();
            this.resetMicButton();
            
            // Enviar al servidor según el tipo de chat
            console.log("Enviando audio al servidor...");
            if (selectedGroup && selectedGroup.id) {
                console.log("Enviando audio al grupo:", selectedGroup.name, "ID:", selectedGroup.id);
                await this.chatService.sendGroupMessage(
                    selectedGroup.id,
                    currentUser.id,
                    base64,
                    Chat.MessageTypeEnum.AUDIO
                );
            } else if (selectedContact && selectedContact.id) {
                console.log("Enviando audio a contacto privado:", selectedContact.username, "ID:", selectedContact.id);
                await this.chatService.sendPrivateMessage(
                    currentUser.id,
                    selectedContact.id,
                    base64,
                    Chat.MessageTypeEnum.AUDIO
                );
            } else {
                console.log("Enviando audio al chat general");
                await this.chatService.sendMessage(
                    currentUser.id,
                    base64,
                    Chat.MessageTypeEnum.AUDIO
                );
            }
            
            console.log("✓ Audio enviado correctamente al servidor");
            
            // Actualizar mensajes para mostrar el audio enviado
            setTimeout(async () => {
                await this.updateMessages();
            }, 500);
            
        } catch (error) {
            console.error("Error enviando audio:", error);
            alert("Error al enviar audio: " + (error.message || error));
            
            // Limpiar estado en caso de error
            this.cancelRecording();
        }
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result;
                if (!result) {
                    reject(new Error("Error al leer el audio"));
                    return;
                }
                const base64 = result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    resetMicButton() {
        const micBtn = document.querySelector('.mic-btn');
        if (micBtn) {
            micBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            micBtn.title = "Record voice note";
        }
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