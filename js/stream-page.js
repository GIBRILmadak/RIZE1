/* ========================================
   INITIALISATION PAGE STREAM
   ======================================== */

(function () {
    console.log('[stream-page] chargé');
    function getParams() {
        const urlParams = new URLSearchParams(window.location.search);
        return {
            streamId: urlParams.get('id'),
            hostId: urlParams.get('host'),
            title: urlParams.get('title') || 'Live Stream',
            isNewLive: urlParams.get('new') === 'true',
            source: urlParams.get('source') || 'camera'
        };
    }

    function ensureNavigateTo() {
        if (typeof window.navigateTo !== 'function') {
            window.navigateTo = (anchor) => {
                if (anchor) {
                    window.location.href = `index.html#${anchor}`;
                } else {
                    window.location.href = 'index.html';
                }
            };
        }
    }

    function updateTitleForNewLive(title) {
        const titleEl = document.getElementById('stream-title');
        const breadcrumb = document.getElementById('stream-breadcrumb-title');
        if (titleEl) titleEl.textContent = title;
        if (breadcrumb) breadcrumb.textContent = title;
    }

    async function ensureStreamingLoaded() {
        if (typeof window.initializeStreamPage === 'function') return true;

        const existingScript = document.querySelector('script[src="js/streaming.js"]');
        if (existingScript) return typeof window.initializeStreamPage === 'function';

        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'js/streaming.js';
            script.onload = () => resolve(typeof window.initializeStreamPage === 'function');
            script.onerror = () => resolve(false);
            document.head.appendChild(script);
        });
    }

    async function ensureAuth() {
        if (typeof window.checkAuth === 'function') {
            await window.checkAuth();
        } else if (window.supabase && window.supabase.auth && typeof window.supabase.auth.getSession === 'function') {
            try {
                const { data: { session } } = await window.supabase.auth.getSession();
                if (session && session.user) {
                    window.currentUser = session.user;
                    window.currentUserId = session.user.id;
                }
            } catch (error) {
                console.warn('Erreur getSession:', error);
            }
        }

        if (!window.currentUser && window.supabase && window.supabase.auth && typeof window.supabase.auth.getUser === 'function') {
            try {
                const { data: { user } } = await window.supabase.auth.getUser();
                if (user) {
                    window.currentUser = user;
                    window.currentUserId = user.id;
                }
            } catch (error) {
                console.warn('Erreur getUser:', error);
            }
        }
    }

    async function boot() {
        const { streamId, hostId, title, isNewLive, source } = getParams();

        if (!streamId && !hostId) {
            alert('ID de stream manquant');
            window.location.href = 'index.html';
            return;
        }

        await ensureAuth();

        if (!window.currentUser) {
            if (window.ToastManager) {
                window.ToastManager.error('Non connecté', 'Veuillez vous reconnecter');
            }
            window.location.href = 'login.html';
            return;
        }

        ensureNavigateTo();

        const finalStreamId = streamId || hostId;
        window._streamBroadcastSource = source;

        if (isNewLive) {
            updateTitleForNewLive(title);
            if (window.ToastManager) {
                window.ToastManager.success('Live prêt', 'Votre page de streaming est prête !');
            }
        }

        const hasStreaming = await ensureStreamingLoaded();
        if (hasStreaming && typeof window.initializeStreamPage === 'function') {
            await window.initializeStreamPage(finalStreamId);
        } else {
            console.warn('initializeStreamPage introuvable, affichage statique.');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.addEventListener('beforeunload', () => {
        if (typeof window.leaveStream === 'function') {
            window.leaveStream();
        }
    });
})();
