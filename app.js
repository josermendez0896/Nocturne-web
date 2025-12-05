/* --- app.js (FINAL V27.2 - Solución de Decodificación por Base64) --- */

/* =========================================
   HELPERS GLOBALES
   ========================================= */
const MAX_WIDTH = 1200; 
let audioEngine; 
let gallery;     
let authMancer;  
let adminMancer; 

// AUDIT (Simplificado para logs de acciones)
const AUDIT = {
    log: (type, message, success = false, data = {}) => {
        if (!gallery || !gallery.db) return; 
        const tx = gallery.db.transaction('auditLog', 'readwrite');
        tx.objectStore('auditLog').add({
            timestamp: Date.now(),
            type: type,
            message: message,
            success: success,
            data: data 
        });
        // Si el log es importante, forzamos la actualización del modal de admin
        if (type.includes('LOGIN') || type.includes('CREATE') || type.includes('DELETE') || type.includes('ROLE')) {
            if (adminMancer && adminMancer.modal.style.display === 'flex') {
                adminMancer.loadAuditLog();
                if (type.includes('USER') || type.includes('ROLE')) {
                    adminMancer.loadUserList(); // Recargar lista de usuarios al haber cambios
                }
            }
        }
    }
};

/* =========================================
   1. IMAGE PROCESSOR (Integrado en el Hilo Principal)
   ========================================= */
const imageProcessor = {
    applyNoir: (d) => { const len = d.length; for (let i = 0; i < len; i += 4) { const avg = (d[i]*0.3 + d[i+1]*0.59 + d[i+2]*0.11) | 0; d[i]=avg; d[i+1]=avg; d[i+2]=avg; } },
    applyVampire: (d) => { const len = d.length; for (let i = 0; i < len; i += 4) { d[i] = (d[i] * 1.8) | 0; d[i+1] = (d[i+1] * 0.4) | 0; d[i+2] = (d[i+2] * 0.4) | 0; } },
    applyGlitch: (d) => { const len = d.length; for (let i = 0; i < len; i += 4) { if (Math.random() > 0.98) { d[i] = 255; d[i+1] = 0; d[i+2] = 255; } } },

    // Función de procesamiento actualizada para máxima compatibilidad con Base64
    process: async (file, title, filter) => { 
        return new Promise(async (resolve, reject) => {
            const img = new Image();
            const reader = new FileReader(); // Usamos FileReader para Base64

            // 1. Manejar el error de decodificación
            img.onerror = () => {
                reject(new Error("Error al decodificar la imagen fuente."));
            };

            img.onload = async () => {
                try {
                    const canvas = document.createElement('canvas'); 
                    const ctx = canvas.getContext('2d');
                    
                    const scale = img.width > MAX_WIDTH ? MAX_WIDTH / img.width : 1;
                    const w = Math.floor(img.width * scale);
                    const h = Math.floor(img.height * scale);
                    
                    canvas.width = w;
                    canvas.height = h;
                    ctx.drawImage(img, 0, 0, w, h);
                    
                    let imageData = ctx.getImageData(0, 0, w, h);
                    
                    // Aplicar filtros
                    if (filter === 'noir') imageProcessor.applyNoir(imageData.data);
                    if (filter === 'vampire') imageProcessor.applyVampire(imageData.data);
                    if (filter === 'glitch') imageProcessor.applyGlitch(imageData.data);

                    ctx.putImageData(imageData, 0, 0);
                    
                    // Generar Blob
                    canvas.toBlob((processedBlob) => {
                        if (!processedBlob) {
                            return reject(new Error("Error al crear Blob procesado."));
                        }
                        
                        const record = { 
                            title: title, 
                            filter: filter,
                            created: Date.now(), 
                            image: processedBlob,
                            isEncrypted: false,
                        };
                        resolve(record);
                    }, 'image/jpeg', 0.85);

                } catch (error) {
                    reject(error);
                }
            };

            // 2. Iniciar la lectura del archivo a Base64
            reader.onload = (e) => {
                img.src = e.target.result; // El src ahora es la Data URL Base64
            };
            reader.onerror = (e) => {
                reject(new Error("Error de lectura de archivo por FileReader."));
            };

            reader.readAsDataURL(file); // Lee el archivo como Data URL
        });
    }
};


/* =========================================
   2. AUDIO ENGINE
   ========================================= */
class AudioEngine {
    constructor() { 
        this.ctx = null; this.rainNode = null; this.analyser = null; 
        this.isPlaying = false; 
        this.canvas = document.getElementById('vizCanvas'); 
        this.canvasCtx = this.canvas.getContext('2d', { alpha: true });
        this.animationId = null;

        this.resizeCanvas(); 
        window.addEventListener('resize', () => this.resizeCanvas());
        
        document.addEventListener('visibilitychange', () => {
            if (this.ctx) {
                if (document.hidden) {
                    cancelAnimationFrame(this.animationId);
                    if(this.ctx.state === 'running') this.ctx.suspend();
                } else if (this.isPlaying) {
                    this.ctx.resume();
                    this.visualize();
                }
            }
        });
    }
    resizeCanvas() { this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; }
    init() { if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC(); } }
    
    createRain() {
        if(this.ctx.state === 'suspended') this.ctx.resume();
        this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 256;
        const bSize = 2 * this.ctx.sampleRate; const buffer = this.ctx.createBuffer(1, bSize, this.ctx.sampleRate);
        const output = buffer.getChannelData(0); let lastOut = 0; 
        for (let i = 0; i < bSize; i++) { const white = Math.random() * 2 - 1; output[i] = (lastOut + (0.02 * white)) / 1.02; lastOut = output[i]; output[i] *= 3.5; }
        
        this.rainNode = this.ctx.createBufferSource(); this.rainNode.buffer = buffer; this.rainNode.loop = true;
        const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 400;
        const gain = this.ctx.createGain(); gain.gain.value = 0.2;
        
        this.rainNode.connect(filter); filter.connect(gain); gain.connect(this.analyser); this.analyser.connect(this.ctx.destination);
        this.rainNode.start(); 
        this.visualize();
    }
    visualize() {
        if(!this.isPlaying || document.hidden) return;
        const bufferLength = this.analyser.frequencyBinCount; 
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);
        this.canvasCtx.clearRect(0,0,this.canvas.width, this.canvas.height);
        const barWidth = (this.canvas.width / bufferLength) * 2.5; 
        let x = 0;
        for(let i = 0; i < bufferLength; i++) {
            const barHeight = dataArray[i] * 1.5; 
            this.canvasCtx.fillStyle = `rgba(${barHeight + 50}, 10, 10, 0.5)`; 
            this.canvasCtx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight); 
            x += barWidth + 1;
        }
        this.animationId = requestAnimationFrame(() => this.visualize());
    }

    toggle() { this.init(); if (this.isPlaying) this.stop(); else { this.createRain(); this.isPlaying = true; document.getElementById('btnAudio').classList.add('active'); } }
    stop() { 
        if (this.rainNode) { try{this.rainNode.stop()}catch(e){}; } 
        this.isPlaying = false; 
        cancelAnimationFrame(this.animationId); 
        this.canvasCtx.clearRect(0,0,this.canvas.width,this.canvas.height); 
        document.getElementById('btnAudio').classList.remove('active'); 
    }
}

/* =========================================
   3. DATA MANCER (Manejo de Binarios para Backup)
   ========================================= */
class DataMancer {
    constructor(dbGetter) { this.getDb = dbGetter; }
    blobToBase64(blob) { return new Promise(r => { const reader = new FileReader(); reader.onloadend = () => r(reader.result); reader.readAsDataURL(blob); }); }
    
    async exportData() {
        const db = this.getDb(); if(!db) return alert("DB no lista");
        const btn = document.getElementById('btnBackup');
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Generando...'; btn.disabled = true;

        try {
            const tx = db.transaction('artworks', 'readonly');
            const all = await new Promise(r => { tx.objectStore('artworks').getAll().onsuccess = (e) => r(e.target.result); });
            
            const parts = ['['];
            
            for(let i=0; i < all.length; i++) {
                let item = all[i];
                let data = { ...item };
                
                // Convertir Blob a Base64
                data.image = await this.blobToBase64(item.image); 
                
                // Excluyendo campos de cifrado (aunque ya no se usan)
                delete data.isEncrypted; 
                delete data.buffer; 
                delete data.salt; 
                delete data.iv; 
                delete data.dataHash; 
                delete data.hasSecret; 

                parts.push(JSON.stringify(data) + (i < all.length - 1 ? ',' : ''));
            }
            parts.push(']');

            const blob = new Blob(parts, {type: "application/json"});
            const a = document.createElement('a'); 
            a.href = URL.createObjectURL(blob); 
            a.download = `Nocturne_Backup_${Date.now()}.json`; 
            a.click();
            AUDIT.log('BACKUP_SUCCESS', `Backup complete (${all.length} items).`, true, {user: gallery.currentUser});

        } catch(err) {
            console.error(err);
            AUDIT.log('BACKUP_FAIL', `Backup failed: ${err.message}`, false, {user: gallery.currentUser});
            alert("Error en backup.");
        } finally {
            btn.innerHTML = originalText; btn.disabled = false;
        }
    }
    
    async importData(data) {
        const tx = this.getDb().transaction('artworks', 'readwrite'); 
        const store = tx.objectStore('artworks');
        for (let item of data) {
            delete item.id; 
            
            if (item.image) { 
                const res = await fetch(item.image); 
                item.image = await res.blob(); 
            }

            item.isEncrypted = false; 
            item.hasSecret = false;
            
            store.add(item);
        }
        
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e);
        });
    }
}

/* =========================================
   4. AUTH MANCER (Controlador de Acceso Criptográfico)
   ========================================= */
const PBKDF2_ITERATIONS = 200000; 
const HASH_LENGTH = 512; 

class AuthMancer {
    constructor(dbGetter) {
        this.getDb = dbGetter;
        this.modal = document.getElementById('authModal');
        this.msg = document.getElementById('authMessage');
        this.content = document.querySelector('.auth-content');
    }

    generateSalt() {
        return window.crypto.getRandomValues(new Uint8Array(16)); 
    }

    async hashPassword(password, salt) {
        const enc = new TextEncoder();
        const key = await window.crypto.subtle.importKey(
            "raw", 
            enc.encode(password), 
            { name: "PBKDF2" }, 
            false, 
            ["deriveBits"]
        );
        const derivedBits = await window.crypto.subtle.deriveBits(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: PBKDF2_ITERATIONS,
                hash: "SHA-512",
            },
            key,
            HASH_LENGTH
        );
        return new Uint8Array(derivedBits); 
    }

    async attemptLogin() {
        const username = document.getElementById('authUsername').value.trim();
        const password = document.getElementById('authPassword').value;

        if (!username || !password) {
            this.showMessage("ERROR: Usuario o Clave requeridos.", true);
            return;
        }

        this.setLoading(true);

        try {
            const db = this.getDb();
            const tx = db.transaction('users', 'readonly');
            const store = tx.objectStore('users');
            const index = store.index('username');
            
            const request = index.get(username);

            request.onsuccess = async (e) => {
                const userRecord = e.target.result;

                if (!userRecord) {
                    const userCount = await this.getUserCount();
                    if (userCount === 0) {
                        this.registerInitialUser(username, password);
                    } else {
                        this.showMessage("AUTENTICACIÓN FALLIDA: ID de Operador Desconocido.", true);
                        this.setLoading(false);
                    }
                    return;
                }

                const storedHash = userRecord.passwordHash;
                const salt = userRecord.salt;
                
                const calculatedHash = await this.hashPassword(password, salt);
                
                // Fallback de comparación de hash (solución a TypeError en entornos restringidos)
                let isMatch;
                if (window.crypto.subtle && window.crypto.subtle.timingSafeEqual) {
                    isMatch = window.crypto.subtle.timingSafeEqual(calculatedHash, storedHash);
                } else {
                    isMatch = calculatedHash.length === storedHash.length &&
                              calculatedHash.every((val, i) => val === storedHash[i]);
                }

                if (isMatch) {
                    this.accessGranted(userRecord);
                } else {
                    this.showMessage("AUTENTICACIÓN FALLIDA: Clave Criptográfica Inválida.", true);
                    this.setLoading(false);
                }
            };

            request.onerror = () => {
                this.showMessage("ERROR CRÍTICO: Fallo al acceder a DB de Usuarios.", true);
                this.setLoading(false);
            };

        } catch (error) {
            console.error("Auth Error:", error);
            this.showMessage("ERROR: Fallo en el proceso de Hashing.", true);
            this.setLoading(false);
        }
    }

    getUserCount() {
        return new Promise((resolve) => {
            const db = this.getDb();
            if (!db) return resolve(0);
            const tx = db.transaction('users', 'readonly');
            tx.objectStore('users').count().onsuccess = (e) => resolve(e.target.result);
        });
    }

    async registerInitialUser(username, password) {
        this.showMessage("DB VACÍA. Creando ID de Operador Inicial...", false);
        const salt = this.generateSalt();
        const hash = await this.hashPassword(password, salt);
        
        const userRecord = {
            username: username,
            passwordHash: hash,
            salt: salt,
            iterations: PBKDF2_ITERATIONS,
            role: 'admin' // Primer usuario siempre es admin
        };

        const db = this.getDb();
        const tx = db.transaction('users', 'readwrite');
        tx.objectStore('users').add(userRecord);

        tx.oncomplete = () => {
            AUDIT.log('REGISTER_SUCCESS', `Initial admin user ${username} created.`, true, {user: username, role: 'admin'});
            this.accessGranted(userRecord);
        };
        tx.onerror = (err) => {
            this.showMessage("ERROR: Fallo al guardar el usuario inicial.", true);
            console.error(err);
            this.setLoading(false);
        };
    }

    accessGranted(userRecord) {
        this.setLoading(false);
        this.showMessage("ACCESO CONCEDIDO. Inicializando Galería...", false, "var(--cyber)");
        AUDIT.log('LOGIN_SUCCESS', `User ${userRecord.username} logged in with role ${userRecord.role}.`, true, {user: userRecord.username, role: userRecord.role});
        
        // Guardar el rol en la galería (necesario para la UI)
        gallery.currentUser = userRecord.username;
        gallery.currentUserRole = userRecord.role || 'viewer'; // Fallback a viewer si el campo role es viejo
        gallery.toggleAdminButton(); // Mostrar/ocultar botón de Admin

        setTimeout(() => {
            this.hideModal();
            gallery.loadGallery(); 
        }, 1500); 
    }

    showModal() {
        this.modal.style.display = 'flex';
    }
    
    hideModal() {
        this.modal.style.display = 'none';
    }

    setLoading(isLoading) {
        this.content.classList.toggle('loading', isLoading);
        document.getElementById('authUsername').disabled = isLoading;
        document.getElementById('authPassword').disabled = isLoading;
    }

    showMessage(text, isError = false, color = null) {
        this.msg.innerText = text;
        this.msg.style.color = color || (isError ? 'var(--accent)' : 'var(--text)');
    }
}


/* =========================================
   5. ADMIN MANCER (Funciones de Administración MEJORADAS)
   ========================================= */
class AdminMancer {
    constructor(dbGetter) {
        this.getDb = dbGetter;
        this.modal = document.getElementById('adminModal');
        
        this.setupEvents();
    }

    setupEvents() {
        document.getElementById('btnCloseAdmin').addEventListener('click', () => this.hideModal());
        document.getElementById('btnShowAudit').addEventListener('click', () => this.loadAuditLog());
        document.getElementById('btnCleanAudit').addEventListener('click', () => gallery.handleLogCleanup());
        document.getElementById('btnShowNewUser').addEventListener('click', () => this.toggleNewUserForm(true));
        document.getElementById('btnCancelNewUser').addEventListener('click', () => this.toggleNewUserForm(false));
        document.getElementById('btnCreateUser').addEventListener('click', () => this.handleUserCreation());
        
        // EVENTOS ACTUALIZADOS
        document.getElementById('btnChangePasswordSelf').addEventListener('click', () => this.handleChangePassword('self'));
        document.getElementById('btnForcePasswordReset').addEventListener('click', () => this.handleChangePassword('forced'));
        
        // Delegación de eventos para la tabla de usuarios (Mejora: CRUD)
        document.getElementById('userTableBody').addEventListener('change', (e) => {
            if (e.target.tagName === 'SELECT' && e.target.classList.contains('role-select')) {
                const userId = parseInt(e.target.dataset.id);
                const newRole = e.target.value;
                this.updateUserRole(userId, newRole);
            }
        });
        document.getElementById('userTableBody').addEventListener('click', (e) => {
            const btn = e.target.closest('button.delete-user-btn');
            if (btn) {
                const userId = parseInt(btn.dataset.id);
                this.deleteUser(userId);
            }
        });
    }

    showModal() {
        if (gallery.currentUserRole !== 'admin') {
            alert("Acceso denegado: Se requiere rol de Administrador.");
            return;
        }
        document.getElementById('adminMessage').innerText = ''; // Limpiar mensajes
        document.getElementById('adminNewPassword').value = '';
        document.getElementById('adminConfirmPassword').value = '';
        document.getElementById('resetUsername').value = '';
        document.getElementById('resetNewPassword').value = '';

        this.toggleNewUserForm(false);
        this.loadAuditLog(); // Cargar logs al abrir
        this.loadUserList(); // Cargar lista de usuarios al abrir
        this.modal.style.display = 'flex';
    }

    hideModal() {
        this.modal.style.display = 'none';
    }

    toggleNewUserForm(show) {
        document.getElementById('newUserForm').style.display = show ? 'block' : 'none';
        document.getElementById('btnShowNewUser').style.display = show ? 'none' : 'block';
        document.getElementById('newUserMessage').innerText = '';
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
    }
    
    // --- GESTIÓN DE USUARIOS (CRUD) ---

    async loadUserList() {
        const tableBody = document.getElementById('userTableBody');
        tableBody.innerHTML = '';
        const db = this.getDb(); if (!db) return;

        const users = await new Promise(r => {
            db.transaction('users', 'readonly').objectStore('users').getAll().onsuccess = (e) => r(e.target.result);
        });

        users.forEach(user => {
            const row = tableBody.insertRow();
            row.dataset.id = user.id;

            // Columna 1: ID Operador
            row.insertCell().textContent = user.username;

            // Columna 2: Rol (Select/Dropdown)
            const roleCell = row.insertCell();
            const select = document.createElement('select');
            select.className = 'role-select';
            select.dataset.id = user.id;

            ['viewer', 'uploader', 'admin'].forEach(role => {
                const option = document.createElement('option');
                option.value = role;
                option.textContent = role.toUpperCase();
                if (user.role === role) option.selected = true;
                select.appendChild(option);
            });
            
            // Si el usuario es el admin actual, no puede cambiarse el rol a sí mismo
            if (user.username === gallery.currentUser) {
                select.disabled = true;
            }

            roleCell.appendChild(select);

            // Columna 3: Acción (Botón Borrar)
            const actionCell = row.insertCell();
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-danger delete-user-btn';
            deleteBtn.dataset.id = user.id;
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
            
            // No permitir borrar al admin actual
            if (user.username === gallery.currentUser) {
                deleteBtn.disabled = true;
                deleteBtn.title = "No puedes eliminar tu propia sesión.";
            }

            actionCell.appendChild(deleteBtn);
        });
    }

    async updateUserRole(id, newRole) {
        const db = this.getDb();
        if (!confirm(`¿Confirmas cambiar el rol del operador ID ${id} a ${newRole.toUpperCase()}?`)) {
            this.loadUserList(); // Recargar para revertir la selección visual
            return;
        }

        try {
            const tx = db.transaction('users', 'readwrite');
            const userStore = tx.objectStore('users');
            
            const userRecord = await new Promise((resolve, reject) => {
                const req = userStore.get(id);
                req.onsuccess = (e) => resolve(e.target.result);
                req.onerror = reject;
            });

            if (!userRecord) throw new Error("Registro no encontrado.");

            userRecord.role = newRole;
            const putRequest = userStore.put(userRecord);

            putRequest.onsuccess = () => {
                AUDIT.log('USER_ROLE_CHANGE', `User ${userRecord.username} role changed to ${newRole}.`, true, {admin: gallery.currentUser, targetUser: userRecord.username});
                document.getElementById('adminMessage').innerText = `Rol de ${userRecord.username} actualizado a ${newRole.toUpperCase()}.`;
                this.loadUserList();
            };
            putRequest.onerror = () => { throw new Error("Error de DB al guardar el rol."); };

        } catch (error) {
            document.getElementById('adminMessage').innerText = `ERROR: ${error.message}`;
            this.loadUserList(); // Asegurar consistencia visual
        }
    }

    deleteUser(id) {
        if (!confirm("ADVERTENCIA CRÍTICA: ¿Deseas eliminar permanentemente este operador?")) return;

        const db = this.getDb();
        const tx = db.transaction('users', 'readwrite');
        const userStore = tx.objectStore('users');
        
        // Obtener el nombre de usuario antes de borrar para el log
        userStore.get(id).onsuccess = (e) => {
            const username = e.target.result ? e.target.result.username : 'Unknown';
            userStore.delete(id).onsuccess = () => {
                AUDIT.log('USER_DELETE_SUCCESS', `User ${username} deleted.`, true, {admin: gallery.currentUser, deletedUser: username});
                document.getElementById('adminMessage').innerText = `Operador ${username} eliminado.`;
                this.loadUserList();
            };
            userStore.delete(id).onerror = () => {
                 AUDIT.log('USER_DELETE_FAIL', `Attempt to delete user ${username} failed.`, false);
                 document.getElementById('adminMessage').innerText = `ERROR: Fallo al eliminar operador ${username}.`;
            };
        };
    }
    
    // --- CREACIÓN DE USUARIO ---

    async handleUserCreation() {
        const username = document.getElementById('newUsername').value.trim();
        const password = document.getElementById('newPassword').value;
        const role = document.getElementById('newUserRole').value;

        if (!username || !password) {
            document.getElementById('newUserMessage').innerText = "Usuario y Clave son obligatorios.";
            return;
        }

        try {
            const salt = authMancer.generateSalt();
            const hash = await authMancer.hashPassword(password, salt);
            
            const userRecord = {
                username: username,
                passwordHash: hash,
                salt: salt,
                iterations: PBKDF2_ITERATIONS,
                role: role
            };

            const db = this.getDb();
            const tx = db.transaction('users', 'readwrite');
            
            const request = tx.objectStore('users').add(userRecord);

            request.onsuccess = () => {
                AUDIT.log('USER_CREATE_SUCCESS', `New user ${username} created with role ${role}.`, true, {admin: gallery.currentUser, newUser: username});
                document.getElementById('newUserMessage').innerText = `Usuario ${username} creado con éxito.`;
                this.toggleNewUserForm(false);
            };

            request.onerror = (e) => {
                const message = (e.target.error.name === 'ConstraintError') ? "Error: El nombre de usuario ya existe." : "Error al crear usuario.";
                AUDIT.log('USER_CREATE_FAIL', message, false, {attemptedUser: username, admin: gallery.currentUser});
                document.getElementById('newUserMessage').innerText = message;
            };

        } catch (error) {
            document.getElementById('newUserMessage').innerText = "Error criptográfico al crear usuario.";
        }
    }

    // --- CAMBIO DE CONTRASEÑA (UNIFICADO) ---

    async handleChangePassword(mode) {
        const msgElement = document.getElementById('adminMessage');
        msgElement.innerText = '';

        let username, newPass;

        if (mode === 'self') {
            newPass = document.getElementById('adminNewPassword').value;
            const confirmPass = document.getElementById('adminConfirmPassword').value;
            username = gallery.currentUser;
            
            if (!newPass || newPass !== confirmPass) {
                msgElement.innerText = "Error: Las contraseñas no coinciden o están vacías.";
                return;
            }
        } else if (mode === 'forced') {
            username = document.getElementById('resetUsername').value.trim();
            newPass = document.getElementById('resetNewPassword').value;
            
            if (!username || !newPass) {
                msgElement.innerText = "Error: ID de Operador y Nueva Clave son requeridos para el restablecimiento forzado.";
                return;
            }
            if (!confirm(`ADVERTENCIA: ¿Restablecer la clave del operador ${username} a la clave provista? Esta acción no se puede deshacer.`)) return;
        }

        try {
            const db = this.getDb();
            const tx = db.transaction('users', 'readwrite');
            const userStore = tx.objectStore('users');
            const index = userStore.index('username');
            
            const getRequest = index.get(username);
            
            getRequest.onsuccess = async (e) => {
                const userRecord = e.target.result;
                if (!userRecord) {
                    msgElement.innerText = `Error: Operador ${username} no encontrado.`;
                    AUDIT.log('PASSWORD_CHANGE_FAIL', `Attempt to reset password for non-existent user ${username}.`, false, {admin: gallery.currentUser});
                    return;
                }
                
                // Generar nueva sal y nuevo hash
                const newSalt = authMancer.generateSalt();
                const newHash = await authMancer.hashPassword(newPass, newSalt);

                userRecord.salt = newSalt;
                userRecord.passwordHash = newHash;

                const putRequest = userStore.put(userRecord);

                putRequest.onsuccess = () => {
                    const action = mode === 'self' ? 'Clave Personal' : 'Restablecimiento Forzado';
                    msgElement.innerText = `${action} de ${username} exitoso.`;
                    AUDIT.log('PASSWORD_CHANGE_SUCCESS', `${action} success for user ${username}.`, true, {admin: gallery.currentUser, targetUser: username});
                    
                    // Limpiar campos
                    document.getElementById('adminNewPassword').value = '';
                    document.getElementById('adminConfirmPassword').value = '';
                    document.getElementById('resetUsername').value = '';
                    document.getElementById('resetNewPassword').value = '';
                };
                putRequest.onerror = () => {
                    msgElement.innerText = `Error de DB al guardar la nueva clave de ${username}.`;
                };
            };
            getRequest.onerror = () => {
                msgElement.innerText = `Error al buscar el operador ${username} en la DB.`;
            };

        } catch (error) {
            msgElement.innerText = "Error criptográfico al cambiar la contraseña.";
        }
    }


    // --- LOG DE AUDITORÍA ---

    loadAuditLog() {
        const tableBody = document.getElementById('auditTableBody');
        tableBody.innerHTML = '';

        const db = this.getDb();
        if (!db) return;

        const tx = db.transaction('auditLog', 'readonly');
        const store = tx.objectStore('auditLog');
        
        // Cargar los últimos 50 logs en orden inverso
        const request = store.openCursor(null, 'prev'); 
        let count = 0;
        
        request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor && count < 50) {
                const log = cursor.value;
                const row = tableBody.insertRow();
                
                const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + new Date(log.timestamp).toLocaleDateString();
                const successText = log.success ? '✅ OK' : '❌ FAIL';
                
                row.insertCell().textContent = time;
                row.insertCell().textContent = log.type;
                row.insertCell().textContent = log.message;
                row.insertCell().textContent = successText;
                
                row.className = log.success ? 'log-success' : 'log-fail';

                count++;
                cursor.continue();
            }
        };
    }
}

/* =========================================
   6. GOTHIC GALLERY (MAIN CONTROLLER)
   ========================================= */
class GothicGallery {
    constructor() {
        this.dbName = 'NocturneDB_V4';
        this.db = null;
        this.objectUrls = [];
        this.modalUrl = null; 
        this.cachedItems = []; 
        this.idleTimer = null;
        this.sleepThrottler = false; 
        this.currentViewIndex = 0; // Para el carrusel
        this.currentUser = null;
        this.currentUserRole = 'guest';

        this.dataMancer = new DataMancer(() => this.db);
        window.dataMancer = this.dataMancer;

        // Intentamos abrir la DB con la versión más reciente (4)
        this.initDB();
        this.setupEvents();
        this.setupPanicMode();
        this.setupAutoSleep();
    }

    debounce(func, wait) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; }
    escapeHtml(text) { return text ? text.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#039;'}[m])) : text; }
    formatDate(timestamp) { 
        if (!timestamp) return 'N/A';
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString(); 
    }

    setupEvents() {
        document.getElementById('btnUpload').addEventListener('click', () => this.handleUpload());
        document.getElementById('importFile').addEventListener('change', (e) => this.handleImport(e));
        
        // Filtro y Ordenamiento
        document.getElementById('inpSearch').addEventListener('input', this.debounce((e) => this.renderGrid(e.target.value), 300));
        document.getElementById('selSearchFilter').addEventListener('change', () => this.renderGrid(document.getElementById('inpSearch').value));
        document.getElementById('selSortOrder').addEventListener('change', () => this.renderGrid(document.getElementById('inpSearch').value));
        
        document.getElementById('btnAdmin').addEventListener('click', () => adminMancer.showModal());

        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('inpFile');

        dropZone.addEventListener('click', () => fileInput.click());
        ['dragenter','dragover','dragleave','drop'].forEach(eName => dropZone.addEventListener(eName, e => {e.preventDefault(); e.stopPropagation()}));
        dropZone.addEventListener('dragenter', () => dropZone.classList.add('dragover'));
        dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', () => dropZone.classList.remove('dragover'));

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if(files.length > 0) {
                fileInput.files = files; 
                dropZone.querySelector('p').innerText = `Archivo: ${files[0].name}`;
                dropZone.querySelector('i').className = "fas fa-check";
                dropZone.style.borderColor = "var(--cyber)";
            }
        });
        
        fileInput.addEventListener('change', () => {
            if(fileInput.files[0]) {
                dropZone.querySelector('p').innerText = `Archivo: ${fileInput.files[0].name}`;
                dropZone.querySelector('i').className = "fas fa-check";
            }
        });
        
        const galleryGrid = document.getElementById('galleryGrid');

        // Delegación de Eventos para botones de la galería
        galleryGrid.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            
            const action = btn.dataset.action;
            const id = parseInt(btn.dataset.id);
            const imgSrc = btn.dataset.imgSrc;
            
            if (action === 'view' && imgSrc) {
                this.currentViewIndex = this.cachedItems.findIndex(item => item.id === id); 
                this.showImageModal(imgSrc, id);
            } else if (action === 'delete' && id) {
                this.deleteItem(id);
            }
        });

        // Manejar el cierre del modal de vista 
        document.getElementById('viewModal').addEventListener('click', (e) => {
            if (e.target.id === 'viewModal') {
                this.closeModal();
            }
        });

        // Navegación Carrusel
        document.getElementById('btnPrev').addEventListener('click', () => this.navigateCarousel(-1));
        document.getElementById('btnNext').addEventListener('click', () => this.navigateCarousel(1));
    }

    toggleAdminButton() {
        const btnAdmin = document.getElementById('btnAdmin');
        if (this.currentUserRole === 'admin') {
            btnAdmin.style.display = 'block';
        } else {
            btnAdmin.style.display = 'none';
        }
    }

    setupPanicMode() {
        let lastPress = 0;
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const now = Date.now();
                if (now - lastPress < 500) this.triggerPanic();
                lastPress = now;
            }
        });
        window.addEventListener('touchstart', (e) => {
            if (e.touches.length >= 3) {
                e.preventDefault(); 
                this.triggerPanic();
            }
        }, { passive: false });
    }

    triggerPanic() {
        document.body.innerHTML = ''; 
        document.body.classList.add('panic-mode');
        audioEngine.stop(); 
        console.clear(); 
        AUDIT.log('PANIC', 'Panic Mode triggered.', true, {user: this.currentUser});
        alert("SESSION TERMINATED");
    }

    setupAutoSleep() {
        const reset = () => {
            if (this.sleepThrottler) return; 
            this.sleepThrottler = true;
            setTimeout(() => this.sleepThrottler = false, 1000); 

            clearTimeout(this.idleTimer);
            document.body.classList.remove('sleep-mode');
            document.getElementById('sleepOverlay').style.display = 'none';
            
            this.idleTimer = setTimeout(() => {
                document.body.classList.add('sleep-mode');
                document.getElementById('sleepOverlay').style.display = 'flex';
                AUDIT.log('LOCK', 'Auto-Sleep activated (60s idle).', true, {user: this.currentUser});
            }, 60000); 
        };
        
        window.addEventListener('mousemove', reset);
        window.addEventListener('keydown', reset);
        window.addEventListener('touchstart', reset);
        reset(); 
    }

    async checkInitialAccess() {
        const userCount = await authMancer.getUserCount(); 

        if (userCount === 0) {
            authMancer.showModal(); 
            authMancer.showMessage("BIENVENIDO: Cree el ID de Operador Inicial.", false, "var(--cyber)");
            // Cargar la galería, aunque esté vacía, para mostrar la interfaz
            this.loadGallery();
        } else {
            authMancer.showModal(); 
            authMancer.showMessage("ACCESO RESTRINGIDO. Inicie Sesión.", false);
        }
    }

    initDB() {
        // V4 para asegurar el campo 'role' y la estructura de users
        const req = indexedDB.open(this.dbName, 4); 

        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            const oldVersion = e.oldVersion;

            if (oldVersion < 1) {
                if (!db.objectStoreNames.contains('artworks')) 
                    db.createObjectStore('artworks', { keyPath: 'id', autoIncrement: true });
            }
            if (oldVersion < 2) {
                if (!db.objectStoreNames.contains('auditLog')) 
                    db.createObjectStore('auditLog', { keyPath: 'id', autoIncrement: true });
            }
            if (oldVersion < 3) {
                // Se crea la tienda 'users'
                if (!db.objectStoreNames.contains('users')) {
                    const userStore = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
                    userStore.createIndex('username', 'username', { unique: true });
                }
            }
        };
        req.onsuccess = (e) => { 
            this.db = e.target.result; 
            this.checkInitialAccess(); 
            this.updateStorage(); 
        };
    }

    async handleImport(e) {
        const file = e.target.files[0]; if(!file) return;
        
        try {
            const text = await file.text(); 
            const data = JSON.parse(text);
            
            await this.dataMancer.importData(data);
            
            alert("Restauración OK."); 
            AUDIT.log('IMPORT_SUCCESS', `Restored ${data.length} items.`, true, {user: this.currentUser});
            this.loadGallery(); 
            this.updateStorage(); 
            e.target.value = ''; 

        } catch(err) { 
            AUDIT.log('IMPORT_FAIL', `Import failed: ${err.message}`, false, {user: this.currentUser});
            alert("Backup corrupto o error de escritura en DB."); 
        }
    }
    
    getFormInputs() {
        return {
            file: document.getElementById('inpFile').files[0],
            title: document.getElementById('inpTitle').value,
            filter: document.getElementById('selFilter').value
        };
    }

    async handleUpload() {
        const { file, title, filter } = this.getFormInputs(); 
        
        if (!file || !title) return alert("Faltan datos.");
        
        const btn = document.getElementById('btnUpload');
        const originalText = '<i class="fas fa-upload"></i> PROCESAR Y GUARDAR';
        
        // Procesamiento en el hilo principal (solución de máxima compatibilidad)
        btn.innerHTML = '<i class="fas fa-cog fa-spin"></i> PROCESANDO (Hilo Principal)...'; 
        btn.disabled = true;

        try {
            const record = await imageProcessor.process(file, title, filter);
            
            const tx = this.db.transaction('artworks', 'readwrite');
            tx.objectStore('artworks').add(record);
            
            tx.oncomplete = () => {
                AUDIT.log('UPLOAD_SUCCESS', `File: ${record.title} processed and saved.`, true, {user: this.currentUser});
                this.resetForm();
                this.loadGallery();
                this.updateStorage();
            };
            tx.onerror = (err) => { throw new Error(err.target.error); };


        } catch (err) {
            AUDIT.log('UPLOAD_FAIL', `Processing/DB Error: ${err.message}`, false, {user: this.currentUser});
            alert("Error al procesar o guardar en DB: " + err.message);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
    
    loadGallery() {
        if(!this.db) return;
        const tx = this.db.transaction('artworks', 'readonly');
        tx.objectStore('artworks').getAll().onsuccess = (e) => {
            // Guardar todos los items y aplicar ordenamiento inicial
            this.cachedItems = e.target.result;
            this.renderGrid(); 
        };
    }

    renderGrid(filterText = '') {
        const grid = document.getElementById('galleryGrid');
        grid.innerHTML = '';
        
        this.objectUrls.forEach(url => URL.revokeObjectURL(url)); 
        this.objectUrls = [];

        const currentFilter = document.getElementById('selSearchFilter').value;
        const currentSort = document.getElementById('selSortOrder').value;
        
        // 1. Filtrado
        let itemsToShow = this.cachedItems.filter(item => {
            const matchesSearch = item.title.toLowerCase().includes(filterText.toLowerCase());
            const matchesFilter = currentFilter === 'all' || item.filter === currentFilter;
            return matchesSearch && matchesFilter;
        });

        // 2. Ordenamiento
        itemsToShow.sort((a, b) => {
            if (currentSort === 'newest') return b.created - a.created;
            if (currentSort === 'oldest') return a.created - b.created;
            if (currentSort === 'titleAsc') return a.title.localeCompare(b.title);
            if (currentSort === 'titleDesc') return b.title.localeCompare(a.title);
            return 0;
        });
        
        // 3. Renderizado
        const fragment = document.createDocumentFragment();

        itemsToShow.forEach(item => {
            const card = document.createElement('div');
            // Usamos el ID de la base de datos como identificador de tarjeta
            card.className = `art-card`; 
            
            let imgSrc = URL.createObjectURL(item.image);
            this.objectUrls.push(imgSrc);

            const img = document.createElement('img');
            img.src = imgSrc;
            
            const overlay = document.createElement('div');
            overlay.className = 'overlay';
            
            const titleElement = document.createElement('h3');
            titleElement.textContent = this.escapeHtml(item.title);

            const actions = document.createElement('div');
            actions.className = 'card-actions';

            actions.innerHTML = `
                <button data-action="view" data-id="${item.id}" data-img-src="${imgSrc}">
                    <i class="fas fa-eye"></i>
                </button>
                <button data-action="delete" data-id="${item.id}">
                    <i class="fas fa-trash"></i>
                </button>
            `;
            
            overlay.appendChild(titleElement);
            overlay.appendChild(actions);
            
            card.appendChild(img);
            card.appendChild(overlay);

            fragment.appendChild(card); 
        });
        grid.appendChild(fragment); 
        
        this.itemsCurrentlyDisplayed = itemsToShow; // Para la navegación del carrusel
    }

    handleLogCleanup() {
        if(!confirm("¿Deseas borrar el Log de Auditoría (registro de acciones)?")) return;
        
        const tx = this.db.transaction('auditLog', 'readwrite');
        tx.objectStore('auditLog').clear();
        
        tx.oncomplete = () => {
            alert("Log de Auditoría borrado exitosamente.");
            AUDIT.log('LOG_CLEANUP_SUCCESS', 'Audit Log erased.', true, {user: this.currentUser});
            adminMancer.loadAuditLog(); // Refrescar la vista del admin
        };
        tx.onerror = () => {
             alert("Error al borrar Log.");
        };
    }

    closeModal() {
        document.getElementById('viewModal').style.display = 'none';
        
        if(this.modalUrl) {
            URL.revokeObjectURL(this.modalUrl);
            this.modalUrl = null;
        }
    }

    showImageModal(imgSrc, id) { 
        this.closeModal(); 
        
        const modal = document.getElementById('viewModal');
        const img = document.getElementById('viewImg');
        const info = document.getElementById('viewInfo');
        
        // Obtener la información del ítem
        const item = this.cachedItems.find(i => i.id === id);
        
        info.innerHTML = `
            <p><strong>Título:</strong> ${this.escapeHtml(item.title)}</p>
            <p><strong>Filtro Aplicado:</strong> ${item.filter}</p>
            <p><strong>Fecha de Creación:</strong> ${this.formatDate(item.created)}</p>
        `;

        img.src = imgSrc;
        this.modalUrl = imgSrc; 
        
        // Actualizar el índice de la vista
        this.currentViewIndex = this.cachedItems.findIndex(i => i.id === id);
        
        // Controlar la visibilidad de los botones del carrusel
        document.getElementById('btnPrev').disabled = this.currentViewIndex <= 0;
        document.getElementById('btnNext').disabled = this.currentViewIndex >= this.cachedItems.length - 1;

        modal.style.display = 'flex';
    }
    
    navigateCarousel(direction) {
        let newIndex = this.currentViewIndex + direction;
        
        if (newIndex >= 0 && newIndex < this.cachedItems.length) {
            this.currentViewIndex = newIndex;
            const item = this.cachedItems[this.currentViewIndex];
            
            // Revocar el URL anterior antes de crear el nuevo para la siguiente imagen
            if(this.modalUrl) URL.revokeObjectURL(this.modalUrl);
            
            const newImgSrc = URL.createObjectURL(item.image);
            
            // Llamar a showImageModal para actualizar la imagen, la info y el estado de los botones
            this.showImageModal(newImgSrc, item.id);
        }
    }

    deleteItem(id) {
        if(confirm("¿Eliminar?")) {
            const tx = this.db.transaction(['artworks', 'auditLog'], 'readwrite');
            tx.objectStore('artworks').delete(id);
            
            tx.oncomplete = () => { 
                AUDIT.log('DELETE', `Item ID ${id} deleted.`, true, {user: this.currentUser});
                this.loadGallery(); 
                this.updateStorage(); 
            }
        }
    }
    
    // MEJORA: Mostrar MB/GB exactos
    async updateStorage() {
        const storageFill = document.getElementById('storageFill');
        if(navigator.storage && navigator.storage.estimate) {
            const {usage, quota} = await navigator.storage.estimate();
            
            const usageMB = (usage / (1024 * 1024)).toFixed(2);
            const quotaMB = (quota / (1024 * 1024)).toFixed(2);
            const percent = Math.floor((usage/quota)*100);
            
            storageFill.style.width = Math.max(percent, 1) + "%";
            storageFill.title = `Uso: ${usageMB} MB de ${quotaMB} MB (${percent}%)`;
        } else {
             storageFill.style.width = "1%";
             storageFill.title = "Estimación de almacenamiento no disponible.";
        }
    }

    resetForm() {
        document.getElementById('inpTitle').value = '';
        document.getElementById('inpFile').value = '';
        
        document.getElementById('selFilter').value = 'none';
        
        document.querySelector('.drop-zone p').innerText = "Arrastra tu imagen aquí";
        document.querySelector('.drop-zone i').className = "fas fa-cloud-upload-alt";
        document.querySelector('.drop-zone').style.borderColor = "#333";
    }
}

/* =========================================
   INICIALIZACIÓN GLOBAL
   ========================================= */
function initApp() {
    audioEngine = new AudioEngine();
    gallery = new GothicGallery();
    authMancer = new AuthMancer(() => gallery.db);
    adminMancer = new AdminMancer(() => gallery.db); 
    
    window.gallery = gallery; 
    window.authMancer = authMancer;
    window.audioEngine = audioEngine; 
    window.adminMancer = adminMancer;
}

// Ejecutar la inicialización
initApp();
