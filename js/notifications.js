/* ========================================
   SYSTÈME DE NOTIFICATIONS EN TEMPS RÉEL
   ======================================== */

let notificationChannel = null;
let notifications = [];
const NOTIF_PERMISSION_KEY = "xera-notif-permission-requested";
const PUSH_SUBSCRIBE_URL = "/api/push/subscribe";
const VAPID_PUBLIC_KEY =
    (typeof window !== "undefined" && window.VAPID_PUBLIC_KEY) ||
    "<REMPLACEZ_PAR_VOTRE_CLE_PUBLIQUE_VAPID>";
let swRegistration = null;
let pushSubscription = null;

// Initialiser les notifications
async function initializeNotifications() {
    if (!currentUser) return;
    
    // Charger les notifications existantes
    await loadNotifications();
    
    // S'abonner aux nouvelles notifications en temps réel
    subscribeToNotifications();

    // Mettre à jour le badge
    updateNotificationBadge();

    // Afficher un CTA type YouTube pour déclencher la demande via geste utilisateur
    renderNotificationPermissionCTA();

    // Enregistrer le service worker / push uniquement si déjà autorisé
    setupPushNotifications();
}

// Enregistrer le SW + abonnement push
async function setupPushNotifications() {
    if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
    ) {
        return;
    }
    if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.includes("REMPLACEZ")) {
        console.warn(
            "VAPID_PUBLIC_KEY manquante. Configurez js/push-config.js pour activer le push.",
        );
        return;
    }

    try {
        swRegistration =
            swRegistration ||
            (await navigator.serviceWorker.register("/sw.js", {
                scope: "/",
            }));

        // Si le SW a été mis à jour, conserver la clé publique pour resubscribe
        if (swRegistration?.active) {
            swRegistration.active.postMessage({
                type: "SET_VAPID",
                publicKey: VAPID_PUBLIC_KEY,
            });
        }

        // Ne pas forcer la demande ici : on attend le geste utilisateur (CTA)
        if (Notification.permission !== "granted") return;

        pushSubscription =
            pushSubscription || (await swRegistration.pushManager.getSubscription());

        if (!pushSubscription) {
            const appServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
            pushSubscription = await swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: appServerKey,
            });
        }

        if (pushSubscription) {
            await sendSubscriptionToServer(pushSubscription);
        }

        // Écoute les resubscriptions envoyées par le SW
        navigator.serviceWorker.addEventListener("message", async (event) => {
            if (event.data?.type === "PUSH_SUBSCRIPTION_REFRESH") {
                pushSubscription = event.data.subscription;
                await sendSubscriptionToServer(pushSubscription);
            }
        });
    } catch (error) {
        console.warn("Push setup failed:", error);
    }
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
        collaboration: '🤝',
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
        collaboration: 'Demande de collaboration',
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

// CTA léger pour inviter l'utilisateur à autoriser les notifications (YouTube-like)
function renderNotificationPermissionCTA() {
    if (typeof window === "undefined" || typeof Notification === "undefined")
        return;
    const alreadyAsked = localStorage.getItem(NOTIF_PERMISSION_KEY) === "1";
    if (Notification.permission === "granted" || Notification.permission === "denied")
        return;
    if (alreadyAsked) return;

    const anchor =
        document.getElementById("notification-btn") ||
        document.querySelector(".nav-actions") ||
        document.body;
    if (!anchor) return;

    // Avoid duplicate banner
    if (document.getElementById("notif-permission-cta")) return;

    const cta = document.createElement("div");
    cta.id = "notif-permission-cta";
    cta.style.cssText =
        "position:fixed; bottom:18px; right:18px; max-width:320px; z-index:1200; background:var(--surface-color, #111); color:var(--text-primary, #fff); border:1px solid var(--border-color, rgba(255,255,255,0.12)); box-shadow:0 12px 30px rgba(0,0,0,0.25); border-radius:14px; padding:14px 16px; display:flex; gap:12px; align-items:flex-start;";
    cta.innerHTML = `
        <div style="flex-shrink:0; width:36px; height:36px; border-radius:10px; background:linear-gradient(135deg, #6366f1, #8b5cf6); display:flex; align-items:center; justify-content:center; font-size:18px;">🔔</div>
        <div style="flex:1; min-width:0;">
            <div style="font-weight:700; margin-bottom:6px;">Activer les notifications</div>
            <div style="color:var(--text-secondary, #b5b5c3); font-size:0.9rem; line-height:1.3;">Soyez averti des nouveaux lives, réponses et encouragements.</div>
            <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                <button id="notif-cta-allow" class="btn-verify" style="padding:8px 12px; border:none; border-radius:10px; background:#10b981; color:#fff; cursor:pointer;">Autoriser</button>
                <button id="notif-cta-later" class="btn-ghost" style="padding:8px 12px; border:1px solid var(--border-color, rgba(255,255,255,0.15)); border-radius:10px; background:transparent; color:var(--text-secondary, #b5b5c3); cursor:pointer;">Plus tard</button>
            </div>
        </div>
    `;

    document.body.appendChild(cta);

    const closeCta = () => {
        cta.remove();
    };

    const allowBtn = document.getElementById("notif-cta-allow");
    const laterBtn = document.getElementById("notif-cta-later");

    if (allowBtn) {
        allowBtn.addEventListener("click", async () => {
            localStorage.setItem(NOTIF_PERMISSION_KEY, "1");
            const perm = await Notification.requestPermission();
            if (perm === "granted") {
                // Inscrire au push dès l'acceptation
                setupPushNotifications();
                ToastManager?.success(
                    "Notifications activées",
                    "Nous vous avertirons comme sur YouTube.",
                );
            }
            closeCta();
        });
    }

    if (laterBtn) {
        laterBtn.addEventListener("click", () => {
            cta.style.opacity = "0";
            setTimeout(closeCta, 120);
        });
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

    // Optionnel: se désabonner du push
    if (pushSubscription && swRegistration) {
        pushSubscription.unsubscribe().catch(() => {});
    }
}

// Convertir une clé publique VAPID base64 vers Uint8Array
function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Envoyer l'abonnement push au backend
async function sendSubscriptionToServer(subscription) {
    if (!currentUser || !subscription) return;
    try {
        await fetch(PUSH_SUBSCRIBE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId: currentUser.id,
                subscription,
            }),
            credentials: "include",
        });
    } catch (error) {
        console.warn("Impossible d'enregistrer l'abonnement push", error);
    }
}
