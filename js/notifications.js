/* ========================================
   SYSTÈME DE NOTIFICATIONS EN TEMPS RÉEL
   ======================================== */

let notificationChannel = null;
let notifications = [];
const NOTIF_PERMISSION_KEY = "xera-notif-permission-requested";

// Initialiser les notifications
async function initializeNotifications() {
    if (!currentUser) return;
    
    // Charger les notifications existantes
    await loadNotifications();
    
    // S'abonner aux nouvelles notifications en temps réel
    subscribeToNotifications();
    
    // Mettre à jour le badge
    updateNotificationBadge();

    // Demander la permission navigateur (une seule fois)
    requestBrowserNotificationPermission();
}

// Charger les notifications existantes
async function loadNotifications() {
    try {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(50);
        
        if (error) throw error;
        
        notifications = data || [];
        updateNotificationBadge();
        
    } catch (error) {
        console.error('Erreur chargement notifications:', error);
    }
}

// S'abonner aux notifications en temps réel
function subscribeToNotifications() {
    if (!currentUser) return;
    
    // Créer un canal de notifications
    notificationChannel = supabase
        .channel('notifications')
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${currentUser.id}`
            },
            (payload) => {
                handleNewNotification(payload.new);
            }
        )
        .subscribe();
}

// Gérer une nouvelle notification
function handleNewNotification(notification) {
    notifications.unshift(notification);
    
    // Afficher une notification toast
    showNotificationToast(notification);

    // Afficher une notification navigateur si permis
    showBrowserNotification(notification);
    
    // Mettre à jour le badge
    updateNotificationBadge();
    
    // Jouer un son (optionnel)
    playNotificationSound();
}

// Afficher un toast de notification
function showNotificationToast(notification) {
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.innerHTML = `
        <div class="notification-toast-content">
            <div class="notification-toast-icon">${getNotificationIcon(notification.type)}</div>
            <div class="notification-toast-text">
                <div class="notification-toast-title">${getNotificationTitle(notification)}</div>
                <div class="notification-toast-message">${notification.message}</div>
            </div>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    // Animation d'entrée
    setTimeout(() => toast.classList.add('show'), 100);
    
    // Retirer après 5 secondes
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
    
    // Cliquer pour fermer
    toast.addEventListener('click', () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    });
}

// Obtenir l'icône selon le type de notification
function getNotificationIcon(type) {
    const icons = {
        follow: '👤',
        new_trace: '📝',
        new_arc: '📈',
        live_start: '🔴',
        encouragement: '✨',
        like: '❤️',
        comment: '💬',
        mention: '@',
        achievement: '🏆'
    };
    return icons[type] || '🔔';
}

// Obtenir le titre de la notification
function getNotificationTitle(notification) {
    const titles = {
        follow: 'Nouvel abonné',
        new_trace: 'Nouvelle trace',
        new_arc: 'Nouvel ARC',
        live_start: 'Live en cours',
        encouragement: 'Nouvel encouragement',
        like: 'Nouveau like',
        comment: 'Nouveau commentaire',
        mention: 'Mention',
        achievement: 'Succès débloqué'
    };
    return titles[notification.type] || 'Notification';
}

// Demander la permission de notifications navigateur (non bloquant)
function requestBrowserNotificationPermission(force = false) {
    if (typeof window === "undefined" || typeof Notification === "undefined")
        return;
    if (Notification.permission === "granted") return;
    const alreadyAsked = localStorage.getItem(NOTIF_PERMISSION_KEY) === "1";
    if (Notification.permission === "denied") return; // respect user choice
    if (alreadyAsked && !force) return;
    try {
        Notification.requestPermission().then((res) => {
            localStorage.setItem(NOTIF_PERMISSION_KEY, "1");
            if (res !== "granted") {
                console.info("Notifications navigateur non autorisées.");
            }
        });
    } catch (e) {
        console.warn("Notification permission request failed", e);
    }
}

// Afficher une notification navigateur (lorsque l'onglet est ouvert)
function showBrowserNotification(notification) {
    if (typeof window === "undefined" || typeof Notification === "undefined")
        return;
    if (Notification.permission !== "granted") return;

    const title = getNotificationTitle(notification);
    const body = notification.message || "";
    const icon = "icons/logo.png";
    try {
        const n = new Notification(title, { body, icon, tag: notification.id });
        n.onclick = () => {
            window.focus();
            if (notification.link) {
                window.location.href = notification.link;
            }
            n.close();
        };
    } catch (e) {
        console.warn("Browser notification error:", e);
    }
}

// Mettre à jour le badge de notifications
function updateNotificationBadge() {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    
    const unreadCount = notifications.filter(n => !n.read).length;
    
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

// Afficher le panneau de notifications
function toggleNotificationPanel() {
    const panel = document.getElementById('notification-panel');
    if (!panel) return;
    
    const isVisible = panel.classList.contains('show');
    
    if (isVisible) {
        panel.classList.remove('show');
    } else {
        panel.classList.add('show');
        renderNotifications();
    }
}

// Rendre les notifications dans le panneau
function renderNotifications() {
    const container = document.getElementById('notification-list');
    if (!container) return;
    
    if (notifications.length === 0) {
        container.innerHTML = `
            <div class="notification-empty">
                <p>Aucune notification</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = notifications.map(notif => `
        <div class="notification-item ${notif.read ? '' : 'unread'}" onclick="handleNotificationClick('${notif.id}')">
            <div class="notification-icon">${getNotificationIcon(notif.type)}</div>
            <div class="notification-content">
                <div class="notification-title">${getNotificationTitle(notif)}</div>
                <div class="notification-message">${notif.message}</div>
                <div class="notification-time">${formatNotificationTime(notif.created_at)}</div>
            </div>
        </div>
    `).join('');
}

// Gérer le clic sur une notification
async function handleNotificationClick(notificationId) {
    try {
        // Marquer comme lue
        await supabase
            .from('notifications')
            .update({ read: true })
            .eq('id', notificationId);
        
        // Mettre à jour localement
        const notif = notifications.find(n => n.id === notificationId);
        if (notif) {
            notif.read = true;
            updateNotificationBadge();
            renderNotifications();
        }
        
        // Fermer le panneau
        toggleNotificationPanel();
        
        // Naviguer vers la ressource liée (optionnel)
        if (notif && notif.link) {
            window.location.href = notif.link;
        }
        
    } catch (error) {
        console.error('Erreur marquage notification:', error);
    }
}

// Marquer toutes les notifications comme lues
async function markAllNotificationsAsRead() {
    try {
        await supabase
            .from('notifications')
            .update({ read: true })
            .eq('user_id', currentUser.id)
            .eq('read', false);
        
        notifications.forEach(n => n.read = true);
        updateNotificationBadge();
        renderNotifications();
        
    } catch (error) {
        console.error('Erreur marquage notifications:', error);
    }
}

// Formater le temps de la notification
function formatNotificationTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'À l\'instant';
    if (minutes < 60) return `Il y a ${minutes} min`;
    if (hours < 24) return `Il y a ${hours}h`;
    if (days < 7) return `Il y a ${days}j`;
    
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// Jouer un son de notification
function playNotificationSound() {
    // Créer un son simple avec Web Audio API
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
        // Ignorer les erreurs de son
    }
}

// Créer une notification (fonction utilitaire)
async function createNotification(userId, type, message, link = null) {
    try {
        const { data, error } = await supabase
            .from('notifications')
            .insert({
                user_id: userId,
                type: type,
                message: message,
                link: link,
                read: false
            })
            .select()
            .single();
        
        if (error) throw error;
        
        return { success: true, data: data };
        
    } catch (error) {
        console.error('Erreur création notification:', error);
        return { success: false, error: error.message };
    }
}

// Se désabonner des notifications
function unsubscribeFromNotifications() {
    if (notificationChannel) {
        supabase.removeChannel(notificationChannel);
        notificationChannel = null;
    }
}
