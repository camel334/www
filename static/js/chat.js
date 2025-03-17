document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    let currentRoom = '';
    let currentDm = '';
    let chatType = 'channel'; // 'channel' veya 'dm'
    let dmUser = '';
    
    // DOM elementleri
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message');
    const messagesContainer = document.getElementById('messages');
    const currentRoomElement = document.getElementById('current-room');
    const chatTypeElement = document.getElementById('chat-type');
    const roomItems = document.querySelectorAll('.room-item');
    const sendButton = document.getElementById('send-btn');
    const usersList = document.getElementById('users');
    const dmUsersList = document.getElementById('dm-users');
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // DM Modal
    const dmModal = document.getElementById('dm-modal');
    const closeModal = document.querySelector('.close-modal');
    const dmUserList = document.getElementById('dm-user-list');
    
    // Sekme değiştirme
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;
            
            // Aktif sekme butonunu güncelle
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Sekme içeriğini göster/gizle
            tabContents.forEach(content => {
                if (content.id === `${tabName}-tab`) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
            
            // DM sekmesine geçildiğinde yeni DM başlatma butonu ekle
            if (tabName === 'dm' && !document.querySelector('.start-dm-btn')) {
                const startDmBtn = document.createElement('button');
                startDmBtn.classList.add('start-dm-btn');
                startDmBtn.textContent = 'Yeni Direkt Mesaj';
                startDmBtn.addEventListener('click', openDmModal);
                
                document.getElementById('dm-tab').appendChild(startDmBtn);
            }
        });
    });
    
    // DM modalını aç
    function openDmModal() {
        updateDmUserList();
        dmModal.style.display = 'block';
    }
    
    // DM modalını kapat
    closeModal.addEventListener('click', () => {
        dmModal.style.display = 'none';
    });
    
    // Modal dışına tıklandığında kapat
    window.addEventListener('click', (event) => {
        if (event.target === dmModal) {
            dmModal.style.display = 'none';
        }
    });
    
    // DM kullanıcı listesini güncelle
    function updateDmUserList() {
        dmUserList.innerHTML = '';
        const currentUsername = document.querySelector('.user-info span').textContent;
        
        Object.keys(users).forEach(user => {
            if (user !== currentUsername) {
                const userElement = document.createElement('li');
                userElement.textContent = user;
                userElement.addEventListener('click', () => {
                    startDm(user);
                    dmModal.style.display = 'none';
                });
                dmUserList.appendChild(userElement);
            }
        });
    }
    
    // DM başlat
    function startDm(user) {
        // Önceki odadan ayrıl
        if (currentRoom) {
            socket.emit('leave_room', { room: currentRoom });
            const activeRoomItem = document.querySelector('.room-item.active');
            if (activeRoomItem) {
                activeRoomItem.classList.remove('active');
            }
            currentRoom = '';
        }
        
        // DM oda tipine geç
        chatType = 'dm';
        dmUser = user;
        chatTypeElement.textContent = 'Direkt Mesaj';
        currentRoomElement.textContent = user;
        
        // Mesaj gönderme alanını aktifleştir
        messageInput.disabled = false;
        sendButton.disabled = false;
        
        // Sunucuya DM başlat bilgisi gönder
        socket.emit('start_dm', { user: user });
        
        // DM'leri temizle
        messagesContainer.innerHTML = '';
    }
    
    // DM listesine kullanıcı ekle
    function addToDmList(user, dmId) {
        // Eğer zaten varsa ekleme
        if (document.querySelector(`.dm-item[data-dm-id="${dmId}"]`)) {
            return;
        }
        
        const dmItem = document.createElement('li');
        dmItem.classList.add('dm-item');
        dmItem.dataset.dmId = dmId;
        dmItem.dataset.user = user;
        dmItem.textContent = user;
        
        dmItem.addEventListener('click', () => {
            // Önceki seçilmiş DM veya odayı kaldır
            const activeItems = document.querySelectorAll('.room-item.active, .dm-item.active');
            activeItems.forEach(item => item.classList.remove('active'));
            
            dmItem.classList.add('active');
            startDm(user);
        });
        
        dmUsersList.appendChild(dmItem);
    }
    
    // Socket.IO olayları
    socket.on('connect', () => {
        console.log('Sunucuya bağlanıldı!');
    });
    
    socket.on('user_list', (users) => {
        updateUsersList(users);
    });
    
    socket.on('receive_message', (data) => {
        if (data.room === currentRoom && chatType === 'channel') {
            addMessage(data);
        }
    });
    
    socket.on('room_history', (messages) => {
        messagesContainer.innerHTML = '';
        messages.forEach(message => {
            addMessage(message);
        });
        scrollToBottom();
    });
    
    // DM olayları
    socket.on('dm_started', (data) => {
        const { dm_id, user } = data;
        addToDmList(user, dm_id);
    });
    
    socket.on('dm_history', (data) => {
        const { dm_id, messages, user } = data;
        currentDm = dm_id;
        
        // DM listesine ekle
        addToDmList(user, dm_id);
        
        // Mesajları temizle ve yeni mesajları ekle
        messagesContainer.innerHTML = '';
        messages.forEach(message => {
            addDirectMessage(message);
        });
        scrollToBottom();
    });
    
    socket.on('receive_dm', (data) => {
        const { dm_id, message, user } = data;
        
        // Bu DM'le ilgileniyorsak mesajı göster
        if (dm_id === currentDm && chatType === 'dm') {
            addDirectMessage(message);
            scrollToBottom();
        }
        
        // DM listesine ekleyelim
        addToDmList(user, dm_id);
    });
    
    // Mesaj gönderme
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const message = messageInput.value.trim();
        if (!message) return;
        
        if (chatType === 'channel' && currentRoom) {
            socket.emit('send_message', {
                message: message,
                room: currentRoom
            });
        } else if (chatType === 'dm' && currentDm) {
            socket.emit('send_dm', {
                message: message,
                dm_id: currentDm,
                user: dmUser
            });
        }
        
        messageInput.value = '';
    });
    
    // Oda seçimi
    roomItems.forEach(item => {
        item.addEventListener('click', () => {
            const room = item.dataset.room;
            
            // Önceki seçilmiş DM veya odayı kaldır
            const activeItems = document.querySelectorAll('.room-item.active, .dm-item.active');
            activeItems.forEach(item => item.classList.remove('active'));
            
            // DM modundan kanal moduna geç
            chatType = 'channel';
            chatTypeElement.textContent = 'Kanal';
            
            if (currentRoom) {
                socket.emit('leave_room', { room: currentRoom });
            }
            
            if (currentDm) {
                currentDm = '';
            }
            
            currentRoom = room;
            item.classList.add('active');
            currentRoomElement.textContent = room;
            messageInput.disabled = false;
            sendButton.disabled = false;
            
            socket.emit('join_room', { room: room });
        });
    });
    
    // Kanal mesajı ekleme fonksiyonu
    function addMessage(data) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        
        if (data.username === 'Sistem') {
            messageElement.classList.add('system');
            messageElement.innerHTML = `
                <div class="content">${data.message}</div>
            `;
        } else {
            const timestamp = data.timestamp ? new Date(data.timestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();
            
            messageElement.innerHTML = `
                <span class="username">${data.username}</span>
                <span class="timestamp">${timestamp}</span>
                <div class="content">${data.message}</div>
            `;
        }
        
        messagesContainer.appendChild(messageElement);
        scrollToBottom();
    }
    
    // DM mesajı ekleme fonksiyonu
    function addDirectMessage(data) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        
        const timestamp = data.timestamp ? new Date(data.timestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();
        
        messageElement.innerHTML = `
            <span class="username">${data.username}</span>
            <span class="timestamp">${timestamp}</span>
            <div class="content">${data.message}</div>
        `;
        
        messagesContainer.appendChild(messageElement);
        scrollToBottom();
    }
    
    // Kullanıcı listesini güncelleme
    const users = {}; // Aktif kullanıcıları sakla
    
    function updateUsersList(userList) {
        usersList.innerHTML = '';
        
        userList.forEach(user => {
            users[user] = true; // Kullanıcıyı aktif olarak işaretle
            
            const userElement = document.createElement('li');
            userElement.textContent = user;
            userElement.addEventListener('click', () => {
                startDm(user);
            });
            usersList.appendChild(userElement);
        });
    }
    
    // Mesajların en altına kaydırma
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}); 