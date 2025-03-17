from flask import Flask, render_template, request, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import secrets
import json
import time

app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(16)
socketio = SocketIO(app, cors_allowed_origins="*")

# Veri dizinlerini oluştur
data_dir = "data"
rooms_dir = os.path.join(data_dir, "rooms")
dm_dir = os.path.join(data_dir, "dm")
channels_file = os.path.join(data_dir, "channels.json")

if not os.path.exists(data_dir):
    os.makedirs(data_dir)
if not os.path.exists(rooms_dir):
    os.makedirs(rooms_dir)
if not os.path.exists(dm_dir):
    os.makedirs(dm_dir)

# Kanalları yükle veya varsayılan kanalları oluştur
def load_channels():
    if os.path.exists(channels_file):
        with open(channels_file, 'r', encoding='utf-8') as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return create_default_channels()
    else:
        return create_default_channels()

def create_default_channels():
    default_channels = {
        "genel": {
            "name": "genel",
            "description": "Genel sohbet kanalı",
            "created_by": "sistem",
            "created_at": time.time(),
            "messages": []
        },
        "oyun": {
            "name": "oyun",
            "description": "Oyun sohbet kanalı",
            "created_by": "sistem",
            "created_at": time.time(),
            "messages": []
        },
        "müzik": {
            "name": "müzik",
            "description": "Müzik paylaşım kanalı",
            "created_by": "sistem",
            "created_at": time.time(),
            "messages": []
        }
    }
    save_channels(default_channels)
    return default_channels

def save_channels(channels):
    with open(channels_file, 'w', encoding='utf-8') as f:
        json.dump(channels, f, ensure_ascii=False, indent=2)

# Kullanıcılar ve kanallar
users = {}
rooms = load_channels()

# Direkt mesajlar (dm) için sozlük
dm_messages = {}

# Mesajları JSON dosyalarından yükle
def load_messages():
    global rooms, dm_messages
    
    # Kanal mesajlarını yükle
    for room_name in rooms.keys():
        room_file = os.path.join(rooms_dir, f"{room_name}.json")
        if os.path.exists(room_file):
            with open(room_file, 'r', encoding='utf-8') as f:
                try:
                    messages = json.load(f)
                    rooms[room_name]["messages"] = messages
                except json.JSONDecodeError:
                    rooms[room_name]["messages"] = []
    
    # DM mesajlarını yükle
    dm_files = [f for f in os.listdir(dm_dir) if f.endswith('.json')]
    for dm_file in dm_files:
        dm_id = dm_file[:-5]  # .json uzantısını kaldır
        with open(os.path.join(dm_dir, dm_file), 'r', encoding='utf-8') as f:
            try:
                dm_messages[dm_id] = json.load(f)
            except json.JSONDecodeError:
                dm_messages[dm_id] = []

# Mesajları JSON dosyalarına kaydet
def save_room_messages(room_name):
    room_file = os.path.join(rooms_dir, f"{room_name}.json")
    with open(room_file, 'w', encoding='utf-8') as f:
        json.dump(rooms[room_name]["messages"], f, ensure_ascii=False, indent=2)

def save_dm_messages(dm_id):
    dm_file = os.path.join(dm_dir, f"{dm_id}.json")
    with open(dm_file, 'w', encoding='utf-8') as f:
        json.dump(dm_messages[dm_id], f, ensure_ascii=False, indent=2)

# Başlangıçta mesajları yükle
load_messages()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login', methods=['POST'])
def login():
    username = request.form.get('username')
    if username in users:
        return redirect(url_for('index'))
    
    users[username] = {"sid": "", "active": True}
    session['username'] = username
    return redirect(url_for('chat'))

@app.route('/chat')
def chat():
    if 'username' not in session:
        return redirect(url_for('index'))
    
    return render_template('chat.html', username=session['username'], rooms=rooms)

# DM oda ID'si oluştur (alfabetik sırada)
def get_dm_id(user1, user2):
    users_sorted = sorted([user1, user2])
    return f"{users_sorted[0]}_{users_sorted[1]}"

@socketio.on('connect')
def handle_connect():
    if 'username' in session:
        username = session['username']
        users[username]["sid"] = request.sid
        emit('user_list', list(users.keys()), broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    if 'username' in session:
        username = session['username']
        if username in users:
            users[username]["active"] = False
        emit('user_list', list(users.keys()), broadcast=True)

@socketio.on('join_room')
def handle_join_room(data):
    room = data['room']
    join_room(room)
    session['current_room'] = room
    emit('receive_message', {
        'username': 'Sistem',
        'message': f"{session['username']} odaya katıldı.",
        'room': room,
        'timestamp': time.time()
    }, to=room)
    emit('room_history', rooms[room]['messages'], to=request.sid)

@socketio.on('leave_room')
def handle_leave_room(data):
    room = data['room']
    leave_room(room)
    emit('receive_message', {
        'username': 'Sistem',
        'message': f"{session['username']} odadan ayrıldı.",
        'room': room,
        'timestamp': time.time()
    }, to=room)

@socketio.on('send_message')
def handle_send_message(data):
    room = data['room']
    message = data['message']
    username = session['username']
    timestamp = time.time()
    
    message_data = {
        'username': username,
        'message': message,
        'room': room,
        'timestamp': timestamp
    }
    rooms[room]['messages'].append(message_data)
    
    # En fazla 50 mesaj sakla
    if len(rooms[room]['messages']) > 50:
        rooms[room]['messages'] = rooms[room]['messages'][-50:]
    
    # Mesajları JSON dosyasına kaydet
    save_room_messages(room)
    
    emit('receive_message', message_data, to=room)

# Kanal oluşturma
@socketio.on('create_channel')
def handle_create_channel(data):
    channel_name = data['name'].lower().strip()
    description = data.get('description', '')
    username = session['username']
    
    # Kanal adı kontrolü
    if not channel_name or channel_name in rooms:
        emit('channel_error', {
            'message': 'Bu kanal adı zaten kullanılıyor veya geçersiz.'
        })
        return
    
    # Yeni kanalı oluştur
    rooms[channel_name] = {
        'name': channel_name,
        'description': description,
        'created_by': username,
        'created_at': time.time(),
        'messages': []
    }
    
    # Kanalları kaydet
    save_channels(rooms)
    
    # Tüm kullanıcılara yeni kanal bilgisini gönder
    emit('channel_created', {
        'name': channel_name,
        'description': description,
        'created_by': username
    }, broadcast=True)

# DM mesaj işlemleri
@socketio.on('start_dm')
def handle_start_dm(data):
    target_user = data['user']
    current_user = session['username']
    
    if target_user == current_user:
        return
    
    dm_id = get_dm_id(current_user, target_user)
    
    # DM mesaj geçmişini oluştur
    if dm_id not in dm_messages:
        dm_messages[dm_id] = []
    
    # DM odasına katıl
    join_room(dm_id)
    session['current_dm'] = dm_id
    
    # Hedef kullanıcı aktifse, ona da bildirim gönder
    if target_user in users and users[target_user]["active"]:
        target_sid = users[target_user]["sid"]
        if target_sid:
            join_room(dm_id, sid=target_sid)
            emit('dm_started', {
                'dm_id': dm_id,
                'user': current_user
            }, to=target_sid)
    
    # Mesaj geçmişini gönder
    emit('dm_history', {
        'dm_id': dm_id,
        'messages': dm_messages[dm_id],
        'user': target_user
    }, to=request.sid)

@socketio.on('send_dm')
def handle_send_dm(data):
    dm_id = data['dm_id']
    message = data['message']
    target_user = data['user']
    current_user = session['username']
    timestamp = time.time()
    
    if dm_id not in dm_messages:
        dm_messages[dm_id] = []
    
    message_data = {
        'username': current_user,
        'message': message,
        'timestamp': timestamp
    }
    
    dm_messages[dm_id].append(message_data)
    
    # Mesajları JSON dosyasına kaydet
    save_dm_messages(dm_id)
    
    # Mesajı dm odasına gönder
    emit('receive_dm', {
        'dm_id': dm_id,
        'message': message_data,
        'user': current_user
    }, to=dm_id)

if __name__ == '__main__':
    if not os.path.exists('templates'):
        os.makedirs('templates')
    if not os.path.exists('static'):
        os.makedirs('static')
    socketio.run(app, debug=True) 