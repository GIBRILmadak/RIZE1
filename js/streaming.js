/* ========================================
   SYSTÈME DE LIVE STREAMING
   ======================================== */

if (!window.__streamingLoaded) {
    window.__streamingLoaded = true;

    let currentStream = null;
    let streamChannel = null;
    let chatChannel = null;
    let signalChannel = null;
    let viewerHeartbeat = null;
    let previewHeartbeat = null;
    let previewCanvas = null;
    let previewCtx = null;
    let previewInFlight = false;
    let lastPreviewStamp = 0;
    let peerConnections = new Map();
    let localMediaStream = null;
    let activeStreamId = null;
    let isStreamHost = false;
    let pendingViewerJoins = new Set();
    let viewerCountInterval = null;
    const renderedChatMessageIds = new Set();

// Créer une session de streaming
async function createStreamingSession(streamData) {
    try {
        const { data, error } = await supabase
            .from('streaming_sessions')
            .insert({
                user_id: currentUser.id,
                title: streamData.title,
                description: streamData.description,
                thumbnail_url: streamData.thumbnailUrl,
                status: 'live'
            })
            .select()
            .single();
        
        if (error) throw error;
        
        // Afficher immédiatement le message côté client
        handleNewChatMessage(data);
        return { success: true, data: data };
        
    } catch (error) {
        console.error('Erreur création stream:', error);
        return { success: false, error: error.message };
    }
}

// Démarrer un stream
async function startStream(streamData) {
    try {
        // Créer la session
        const result = await createStreamingSession(streamData);
        if (!result.success) throw new Error(result.error);
        
        currentStream = result.data;
        
        // Enregistrer immédiatement la présence de l'hôte
        try {
            if (currentUser) {
                await supabase
                    .from('stream_viewers')
                    .upsert({
                        stream_id: currentStream.id,
                        user_id: currentUser.id,
                        last_seen: new Date().toISOString()
                    }, { onConflict: 'stream_id,user_id' });
            }
        } catch (error) {
            console.warn('Présence hôte non enregistrée (sera retentée via heartbeat):', error);
        }

        // S'abonner aux événements du stream
        subscribeToStream(currentStream.id);
        
        // Démarrer le heartbeat pour maintenir la présence
        startViewerHeartbeat(currentStream.id);
        startViewerCountSync(currentStream.id);
        
        return { success: true, stream: currentStream };
        
    } catch (error) {
        console.error('Erreur démarrage stream:', error);
        return { success: false, error: error.message };
    }
}

// Rejoindre un stream
async function joinStream(streamId) {
    try {
        // Enregistrer comme viewer
        const { error } = await supabase
            .from('stream_viewers')
            .upsert({
                stream_id: streamId,
                user_id: currentUser.id,
                last_seen: new Date().toISOString()
            }, { onConflict: 'stream_id,user_id' });
        
        if (error) {
            if (error.code === '23505' || error.status === 409) {
                // Conflit d'unicité: déjà enregistré comme viewer
                console.warn('Viewer déjà enregistré, conflit ignoré.');
            } else {
                throw error;
            }
        }
        
        // Récupérer les infos du stream
        const { data: stream, error: streamError } = await supabase
            .from('streaming_sessions')
            .select('*, users(name, avatar)')
            .eq('id', streamId)
            .single();
        
        if (streamError) throw streamError;
        
        currentStream = stream;
        
        // S'abonner aux événements
        subscribeToStream(streamId);
        
        // Démarrer le heartbeat
        startViewerHeartbeat(streamId);
        startViewerCountSync(streamId);
        
        return { success: true, stream: stream };
        
    } catch (error) {
        console.error('Erreur rejoindre stream:', error);
        return { success: false, error: error.message };
    }
}

// S'abonner aux événements du stream
function subscribeToStream(streamId) {
    // Canal pour les messages de chat
    chatChannel = supabase
        .channel(`stream-chat-${streamId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'stream_messages',
                filter: `stream_id=eq.${streamId}`
            },
            (payload) => {
                handleNewChatMessage(payload.new);
            }
        )
        .subscribe();
    
    // Canal pour les mises à jour du stream
    streamChannel = supabase
        .channel(`stream-${streamId}`)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'streaming_sessions',
                filter: `id=eq.${streamId}`
            },
            (payload) => {
                handleStreamUpdate(payload.new);
            }
        )
        .subscribe();
}

// Envoyer un message dans le chat
async function sendChatMessage(message) {
    if (!currentStream) return { success: false, error: 'Pas de stream actif' };
    if (!currentUser) return { success: false, error: 'Utilisateur non connecté' };
    
    try {
        const { data, error } = await supabase
            .from('stream_messages')
            .insert({
                stream_id: currentStream.id,
                user_id: currentUser.id,
                message: message
            })
            .select('*, users(name, avatar)')
            .single();
        
        if (error) throw error;
        
        return { success: true, data: data };
        
    } catch (error) {
        console.error('Erreur envoi message:', error);
        return { success: false, error: error.message };
    }
}

// Charger l'historique du chat
async function loadChatHistory(streamId, limit = 50) {
    try {
        const { data, error } = await supabase
            .from('stream_messages')
            .select('*, users(name, avatar)')
            .eq('stream_id', streamId)
            .order('created_at', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        const messages = data.reverse();
        messages.forEach(msg => {
            const key = getChatMessageKey(msg);
            if (key) renderedChatMessageIds.add(key);
        });
        return { success: true, messages };
        
    } catch (error) {
        console.error('Erreur chargement chat:', error);
        return { success: false, error: error.message };
    }
}

function getChatMessageKey(message) {
    if (!message) return null;
    if (message.id) return String(message.id);
    const userId = message.user_id || 'u';
    const createdAt = message.created_at || '';
    const body = message.message || '';
    return `${userId}:${createdAt}:${body}`;
}

// Gérer un nouveau message de chat
function handleNewChatMessage(message) {
    const chatContainer = document.getElementById('stream-chat-messages');
    if (!chatContainer) return;
    
    const key = getChatMessageKey(message);
    if (key && renderedChatMessageIds.has(key)) return;
    if (key) renderedChatMessageIds.add(key);

    const messageElement = createChatMessageElement(message);
    chatContainer.appendChild(messageElement);
    
    // Scroll vers le bas
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Créer un élément de message de chat
function createChatMessageElement(message) {
    const div = document.createElement('div');
    div.className = 'chat-message';
    
    const isOwnMessage = message.user_id === currentUser?.id;
    if (isOwnMessage) div.classList.add('own-message');
    
    const username = message.users?.name || 'Utilisateur';
    const userId = message.users?.id || message.user_id;
    const usernameHtml = typeof window.renderUsernameWithBadge === 'function' && userId
        ? window.renderUsernameWithBadge(username, userId)
        : username;

    div.innerHTML = `
        <img src="${message.users?.avatar || 'https://placehold.co/32'}" class="chat-avatar" alt="${message.users?.name}">
        <div class="chat-message-content">
            <div class="chat-message-header">
                <span class="chat-username">${usernameHtml}</span>
                <span class="chat-timestamp">${formatChatTime(message.created_at)}</span>
            </div>
            <div class="chat-message-text">${escapeHtml(message.message)}</div>
        </div>
    `;
    
    return div;
}

// Gérer une mise à jour du stream
function handleStreamUpdate(stream) {
    currentStream = stream;
    
    // Mettre à jour l'UI
    updateStreamUI(stream);
    
    // Si le stream est terminé
    if (stream.status === 'ended') {
        handleStreamEnded();
    }
}

// Mettre à jour l'UI du stream
function updateStreamUI(stream) {
    const viewerCount = document.getElementById('stream-viewer-count');
    if (viewerCount) {
        viewerCount.textContent = stream.viewer_count || 0;
    }
    
    const chatViewerCount = document.getElementById('chat-viewer-count');
    if (chatViewerCount) {
        chatViewerCount.textContent = stream.viewer_count || 0;
    }
    
    const status = document.getElementById('stream-status');
    if (status) {
        status.textContent = stream.status === 'live' ? '🔴 EN DIRECT' : 'Terminé';
        status.className = `stream-status ${stream.status}`;
    }
}

async function getViewerCountForStream(streamId) {
    if (!streamId) return null;
    try {
        const cutoffIso = new Date(Date.now() - 30000).toISOString();
        const { count, error } = await supabase
            .from('stream_viewers')
            .select('user_id', { count: 'exact', head: true })
            .eq('stream_id', streamId)
            .gte('last_seen', cutoffIso);
        if (error) throw error;
        return typeof count === 'number' ? count : null;
    } catch (error) {
        console.error('Erreur récupération viewers:', error);
        return null;
    }
}

async function syncViewerCount(streamId, { updateSession = false } = {}) {
    const count = await getViewerCountForStream(streamId);
    if (count === null) return;

    if (currentStream) {
        currentStream.viewer_count = count;
    }
    updateStreamUI({ viewer_count: count, status: currentStream?.status || 'live' });

    if (updateSession) {
        try {
            await supabase
                .from('streaming_sessions')
                .update({ viewer_count: count })
                .eq('id', streamId);
        } catch (error) {
            console.error('Erreur update viewer_count:', error);
        }
    }
}

function startViewerCountSync(streamId) {
    if (viewerCountInterval) {
        clearInterval(viewerCountInterval);
        viewerCountInterval = null;
    }
    const shouldUpdateSession = !!isStreamHost;
    syncViewerCount(streamId, { updateSession: shouldUpdateSession });
    const intervalMs = shouldUpdateSession ? 10000 : 15000;
    viewerCountInterval = setInterval(() => {
        syncViewerCount(streamId, { updateSession: shouldUpdateSession });
    }, intervalMs);
}

// Terminer un stream
async function endStream() {
    if (!currentStream) return { success: false, error: 'Pas de stream actif' };
    
    try {
        const { error } = await supabase
            .from('streaming_sessions')
            .update({
                status: 'ended',
                ended_at: new Date().toISOString()
            })
            .eq('id', currentStream.id);
        
        if (error) throw error;
        
        // Nettoyer
        cleanupStream();
        
        return { success: true };
        
    } catch (error) {
        console.error('Erreur fin stream:', error);
        return { success: false, error: error.message };
    }
}

// Quitter un stream
function leaveStream() {
    cleanupStream();
    
    // Rediriger vers la page discover
    navigateTo('discover');
}

// Nettoyer les ressources du stream
function cleanupStream() {
    // Arrêter le heartbeat
    if (viewerHeartbeat) {
        clearInterval(viewerHeartbeat);
        viewerHeartbeat = null;
    }
    if (viewerCountInterval) {
        clearInterval(viewerCountInterval);
        viewerCountInterval = null;
    }
    
    // Se désabonner des canaux
    if (chatChannel) {
        supabase.removeChannel(chatChannel);
        chatChannel = null;
    }
    
    if (streamChannel) {
        supabase.removeChannel(streamChannel);
        streamChannel = null;
    }
    
    if (signalChannel) {
        supabase.removeChannel(signalChannel);
        signalChannel = null;
    }
    
    if (previewHeartbeat) {
        clearInterval(previewHeartbeat);
        previewHeartbeat = null;
    }
    previewCanvas = null;
    previewCtx = null;
    previewInFlight = false;
    lastPreviewStamp = 0;
    
    peerConnections.forEach(pc => {
        try { pc.close(); } catch (e) {}
    });
    peerConnections.clear();
    localMediaStream = null;
    activeStreamId = null;
    isStreamHost = false;
    pendingViewerJoins.clear();
    renderedChatMessageIds.clear();
    
    currentStream = null;
}

function getRtcConfig() {
    return {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };
}

function sendSignal(payload) {
    if (!signalChannel) return;
    signalChannel.send({
        type: 'broadcast',
        event: 'signal',
        payload: payload
    });
}

function createPeerConnection(peerId, isHostSide) {
    const pc = new RTCPeerConnection(getRtcConfig());
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal({
                type: 'ice',
                streamId: activeStreamId,
                from: currentUser?.id || null,
                to: peerId,
                candidate: event.candidate
            });
        }
    };
    
    pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'failed' || state === 'closed' || state === 'disconnected') {
            try { pc.close(); } catch (e) {}
            peerConnections.delete(peerId);
        }
    };
    
    if (!isHostSide) {
        pc.ontrack = (event) => {
            const [remoteStream] = event.streams || [];
            if (!remoteStream) return;
            const video = document.getElementById('stream-video');
            if (video) {
                video.srcObject = remoteStream;
                video.autoplay = true;
                video.playsInline = true;
                video.muted = true;
                const playPromise = video.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => {});
                }
            }
            setViewerWaiting(false);
        };
    }
    
    return pc;
}

async function handleViewerJoin(viewerId) {
    if (!viewerId) return;
    if (!localMediaStream) {
        pendingViewerJoins.add(viewerId);
        return;
    }
    
    const pc = createPeerConnection(viewerId, true);
    peerConnections.set(viewerId, pc);
    
    localMediaStream.getTracks().forEach(track => {
        pc.addTrack(track, localMediaStream);
    });
    
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({
            type: 'offer',
            streamId: activeStreamId,
            from: currentUser?.id || null,
            to: viewerId,
            sdp: pc.localDescription
        });
    } catch (error) {
        console.error('Erreur création offer WebRTC:', error);
    }
}

async function handleOffer(payload) {
    const hostId = payload?.from;
    if (!hostId) return;
    
    let pc = peerConnections.get(hostId);
    if (!pc) {
        pc = createPeerConnection(hostId, false);
        peerConnections.set(hostId, pc);
    }
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({
            type: 'answer',
            streamId: activeStreamId,
            from: currentUser?.id || null,
            to: hostId,
            sdp: pc.localDescription
        });
    } catch (error) {
        console.error('Erreur réponse offer WebRTC:', error);
    }
}

async function handleAnswer(payload) {
    const viewerId = payload?.from;
    if (!viewerId) return;
    const pc = peerConnections.get(viewerId);
    if (!pc) return;
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    } catch (error) {
        console.error('Erreur setRemoteDescription answer:', error);
    }
}

async function handleIce(payload) {
    const peerId = payload?.from;
    if (!peerId) return;
    const pc = peerConnections.get(peerId);
    if (!pc) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (error) {
        console.error('Erreur ICE candidate:', error);
    }
}

function initWebRtcSignaling(streamId, isHost) {
    if (!streamId) return;
    activeStreamId = streamId;
    isStreamHost = isHost;
    
    if (signalChannel) {
        supabase.removeChannel(signalChannel);
    }
    
    signalChannel = supabase
        .channel(`stream-signal-${streamId}`)
        .on('broadcast', { event: 'signal' }, ({ payload }) => {
            if (!payload || payload.streamId !== activeStreamId) return;
            if (payload.to && payload.to !== currentUser?.id) return;
            
            if (payload.type === 'viewer-join' && isStreamHost) {
                handleViewerJoin(payload.from);
            } else if (payload.type === 'offer' && !isStreamHost) {
                handleOffer(payload);
            } else if (payload.type === 'answer' && isStreamHost) {
                handleAnswer(payload);
            } else if (payload.type === 'ice') {
                handleIce(payload);
            }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED' && !isStreamHost) {
                sendSignal({
                    type: 'viewer-join',
                    streamId: activeStreamId,
                    from: currentUser?.id || null,
                    to: null
                });
            }
        });
}

// Démarrer la mise à jour des previews (frames) pour Discover
function startLivePreviewUpdates(streamId) {
    if (!streamId || !supabase) return;
    if (previewHeartbeat) clearInterval(previewHeartbeat);
    previewCanvas = previewCanvas || document.createElement('canvas');
    previewCtx = previewCtx || previewCanvas.getContext('2d', { willReadFrequently: true });

    const updatePreview = async () => {
        if (previewInFlight) return;
        if (!currentStream || currentStream.id !== streamId) return;
        if (document.hidden) return;

        const video = document.getElementById('stream-video');
        if (!video || video.readyState < 2) return;

        const now = Date.now();
        if (now - lastPreviewStamp < 3000) return;
        lastPreviewStamp = now;

        const maxWidth = 480;
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        const scale = Math.min(1, maxWidth / vw);
        const tw = Math.max(1, Math.floor(vw * scale));
        const th = Math.max(1, Math.floor(vh * scale));

        previewCanvas.width = tw;
        previewCanvas.height = th;
        previewCtx.drawImage(video, 0, 0, tw, th);

        let dataUrl = '';
        try {
            dataUrl = previewCanvas.toDataURL('image/jpeg', 0.65);
        } catch (e) {
            return;
        }

        previewInFlight = true;
        try {
            await supabase
                .from('streaming_sessions')
                .update({ thumbnail_url: dataUrl })
                .eq('id', streamId);
        } catch (error) {
            console.error('Erreur update preview live:', error);
        } finally {
            previewInFlight = false;
        }
    };

    // Premier push rapide
    setTimeout(updatePreview, 800);
    previewHeartbeat = setInterval(updatePreview, 3500);
}

// Démarrer le heartbeat pour maintenir la présence
function startViewerHeartbeat(streamId) {
    const touch = async () => {
        if (!currentUser) return;
        try {
            await supabase
                .from('stream_viewers')
                .upsert({
                    stream_id: streamId,
                    user_id: currentUser.id,
                    last_seen: new Date().toISOString()
                });
        } catch (error) {
            console.error('Erreur heartbeat:', error);
        }
    };
    // Premier ping immédiat
    touch();
    // Mettre à jour toutes les 20 secondes
    viewerHeartbeat = setInterval(touch, 20000);
}

// Gérer la fin du stream
function handleStreamEnded() {
    alert('Le stream est terminé');
    leaveStream();
}

// Récupérer les streams en direct
async function getLiveStreams() {
    try {
        const { data, error } = await supabase
            .from('streaming_sessions')
            .select('*, users(name, avatar)')
            .eq('status', 'live')
            .order('started_at', { ascending: false });
        
        if (error) throw error;
        
        return { success: true, streams: data };
        
    } catch (error) {
        console.error('Erreur récupération streams:', error);
        return { success: false, error: error.message };
    }
}

// Formater le temps pour le chat
function formatChatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Échapper le HTML pour éviter les XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Configurer les médias du diffuseur (Host)
async function setupBroadcasterMedia(options = {}) {
    try {
        const source = options.source || 'camera';
        let stream = null;
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

        const requestUserMedia = async (constraints) => {
            try {
                return await navigator.mediaDevices.getUserMedia(constraints);
            } catch (error) {
                if (constraints.audio) {
                    try {
                        const fallback = { ...constraints, audio: false };
                        const streamNoAudio = await navigator.mediaDevices.getUserMedia(fallback);
                        if (window.ToastManager) {
                            ToastManager.info('Micro désactivé', 'Live lancé sans audio');
                        }
                        return streamNoAudio;
                    } catch (fallbackError) {
                        throw error;
                    }
                }
                throw error;
            }
        };

        const requestDisplayMedia = async (constraints) => {
            try {
                return await navigator.mediaDevices.getDisplayMedia(constraints);
            } catch (error) {
                if (constraints.audio) {
                    try {
                        const fallback = { ...constraints, audio: false };
                        const streamNoAudio = await navigator.mediaDevices.getDisplayMedia(fallback);
                        if (window.ToastManager) {
                            ToastManager.info('Micro désactivé', 'Partage d\'écran sans audio');
                        }
                        return streamNoAudio;
                    } catch (fallbackError) {
                        throw error;
                    }
                }
                throw error;
            }
        };

        if (source === 'screen' && navigator.mediaDevices.getDisplayMedia) {
            try {
                stream = await requestDisplayMedia({
                    video: {
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                        frameRate: { ideal: 30 }
                    },
                    audio: true
                });
            } catch (error) {
                if (isMobile) {
                    if (window.ToastManager) {
                        ToastManager.info('Partage d\'écran indisponible', 'Bascule sur la caméra');
                    }
                    stream = await requestUserMedia({
                        video: {
                            width: { ideal: 1280 },
                            height: { ideal: 720 },
                            frameRate: { ideal: 30 }
                        },
                        audio: true
                    });
                } else {
                    throw error;
                }
            }
        } else {
            stream = await requestUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: true
            });
        }
        
        const video = document.getElementById('stream-video');
        if (video) {
            video.srcObject = stream;
            video.muted = true; // Garder muet pour permettre l'autoplay
            video.autoplay = true;
            video.playsInline = true;
            const playPromise = video.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(() => {});
            }
            
            // Ajouter un indicateur visuel que c'est bien le host
            const container = document.querySelector('.stream-video-container');
            if (container) {
                container.classList.remove('stream-host-live');
            }
            
            // Modifier l'interface pour le host
            const followBtn = document.getElementById('follow-btn');
            if (followBtn) {
                followBtn.style.display = 'none'; // Le host ne peut pas se suivre lui-même
            }
            
            // Ajouter bouton de fin de stream
            const actionsContainer = document.querySelector('.stream-actions');
            if (actionsContainer) {
                const endBtn = document.createElement('button');
                endBtn.className = 'stream-action-btn btn';
                endBtn.style.backgroundColor = '#ef4444';
                endBtn.style.color = 'white';
                endBtn.innerHTML = `
                    <span class="btn-text">Terminer le Live</span>
                `;
                endBtn.onclick = async () => {
                    if (confirm('Voulez-vous vraiment arrêter le live ?')) {
                        try {
                            endBtn.disabled = true;
                            endBtn.style.opacity = '0.7';
                            const result = await endStream();
                            if (!result || !result.success) {
                                const message = result?.error || 'Impossible de terminer le live';
                                console.error('Fin du live échouée:', message);
                                if (window.ToastManager) {
                                    ToastManager.error('Erreur', message);
                                } else {
                                    alert(message);
                                }
                                endBtn.disabled = false;
                                endBtn.style.opacity = '';
                                return;
                            }
                            // Arrêter les tracks
                            stream.getTracks().forEach(track => track.stop());
                            window.location.href = 'index.html';
                        } catch (error) {
                            console.error('Erreur bouton fin de live:', error);
                            if (window.ToastManager) {
                                ToastManager.error('Erreur', error?.message || 'Impossible de terminer le live');
                            }
                            endBtn.disabled = false;
                            endBtn.style.opacity = '';
                        }
                    }
                };
                actionsContainer.prepend(endBtn);
            }
            
            // Activer le son par défaut pour le host
            const audioBtn = document.getElementById('audio-toggle-btn');
            if (audioBtn) {
                audioBtn.classList.add('active');
                audioBtn.style.color = '#10b981';
            }
            
            localMediaStream = stream;
            if (pendingViewerJoins.size > 0) {
                const pending = Array.from(pendingViewerJoins);
                pendingViewerJoins.clear();
                pending.forEach(viewerId => handleViewerJoin(viewerId));
            }
            
            if (currentStream && currentStream.id) {
                startLivePreviewUpdates(currentStream.id);
            }
        }
    } catch (error) {
        console.error("Erreur accès média diffuseur:", error);
        alert("Impossible d'accéder à la caméra/micro. Vérifiez vos permissions.");
    }
}

// Initialiser la page de stream
async function initializeStreamPage(streamId) {
    // Rejoindre le stream
    const result = await joinStream(streamId);
    
    if (!result.success) {
        alert('Erreur: ' + result.error);
        setChatEnabled(false);
        navigateTo('discover');
        return;
    }
    
    if (result.stream) {
        hydrateStreamInfo(result.stream);
    }

    const isHost = Boolean(currentUser && currentStream && currentUser.id === currentStream.user_id);
    applyStreamRoleUI(isHost);
    initWebRtcSignaling(streamId, isHost);
    startViewerCountSync(streamId);

    // Si l'utilisateur actuel est le créateur du stream (Host)
    if (isHost) {
        console.log('Mode Diffuseur activé');
        await setupBroadcasterMedia({ source: window._streamBroadcastSource });
        setViewerWaiting(false);
    } else {
        setViewerWaiting(true);
    }
    
    // Charger l'historique du chat
    const chatResult = await loadChatHistory(streamId);
    if (chatResult.success) {
        const chatContainer = document.getElementById('stream-chat-messages');
        if (chatContainer) {
            chatContainer.innerHTML = '';
            chatResult.messages.forEach(msg => {
                const element = createChatMessageElement(msg);
                chatContainer.appendChild(element);
            });
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }
    
    // Configurer le formulaire de chat
    const chatForm = document.getElementById('stream-chat-form');
    if (chatForm) {
        if (!chatForm.dataset.bound) {
            chatForm.dataset.bound = 'true';
            chatForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const input = document.getElementById('stream-chat-input');
                const message = input.value.trim();
                
                if (!message) return;
                
                const result = await sendChatMessage(message);
                if (result.success) {
                    input.value = '';
                } else {
                    if (window.ToastManager) {
                        ToastManager.error('Chat', result.error || 'Impossible d\'envoyer le message');
                    } else {
                        alert(result.error || 'Impossible d\'envoyer le message');
                    }
                }
            });
        }
    }

    setChatEnabled(true);
}

function hydrateStreamInfo(stream) {
    const titleEl = document.getElementById('stream-title');
    if (titleEl) {
        titleEl.textContent = stream.title || 'Live Stream';
    }

    const descriptionEl = document.getElementById('stream-description');
    if (descriptionEl) {
        descriptionEl.textContent = stream.description || 'Aucune description.';
    }

    const hostNameEl = document.getElementById('stream-host-name');
    if (hostNameEl) {
        const hostName = stream.users?.name || stream.host_name || 'Hôte';
        const hostId = stream.users?.id || stream.user_id || null;
        if (hostId && typeof window.renderUsernameWithBadge === 'function') {
            hostNameEl.innerHTML = window.renderUsernameWithBadge(hostName, hostId);
        } else {
            hostNameEl.textContent = hostName;
        }
    }

    const hostAvatarEl = document.getElementById('stream-host-avatar');
    if (hostAvatarEl) {
        const avatarUrl = stream.users?.avatar || stream.host_avatar || '';
        if (avatarUrl) {
            hostAvatarEl.src = avatarUrl;
            hostAvatarEl.alt = 'Avatar de l\'hôte';
        } else {
            hostAvatarEl.removeAttribute('src');
        }
    }

    const breadcrumb = document.getElementById('stream-breadcrumb-title');
    if (breadcrumb) {
        breadcrumb.textContent = stream.title || 'Stream en cours';
    }
}

function applyStreamRoleUI(isHost) {
    document.body.classList.toggle('is-stream-host', isHost);
    document.body.classList.toggle('is-stream-viewer', !isHost);

    const status = document.getElementById('stream-status');
    if (status) {
        status.textContent = isHost ? '🔴 EN DIRECT (Vous diffusez)' : '🔴 EN DIRECT';
    }

    const roleBadge = document.getElementById('stream-role-badge');
    if (roleBadge) {
        roleBadge.remove();
    }

    const likeBtn = document.getElementById('like-btn');
    const followBtn = document.getElementById('follow-btn');
    const shareBtn = document.getElementById('share-btn');
    const buttons = [likeBtn, followBtn, shareBtn].filter(Boolean);

    buttons.forEach(btn => {
        if (isHost) {
            btn.disabled = true;
            btn.classList.add('disabled');
            btn.style.opacity = '0.6';
            btn.style.cursor = 'not-allowed';
        } else {
            btn.disabled = false;
            btn.classList.remove('disabled');
            btn.style.opacity = '';
            btn.style.cursor = '';
        }
    });

    const chatInput = document.getElementById('stream-chat-input');
    if (chatInput) {
        chatInput.placeholder = isHost ? 'Écrire à vos viewers...' : 'Envoyer un message...';
    }
}

function setChatEnabled(enabled) {
    const chatInput = document.getElementById('stream-chat-input');
    const chatButton = document.querySelector('#stream-chat-form .stream-chat-send');
    if (chatInput) {
        chatInput.disabled = !enabled;
        if (!enabled) {
            chatInput.placeholder = 'Chat indisponible...';
        }
    }
    if (chatButton) {
        chatButton.disabled = !enabled;
    }
}

function setViewerWaiting(isWaiting) {
    const container = document.querySelector('.stream-video-container');
    if (!container) return;

    let waiting = document.getElementById('stream-waiting');
    if (!waiting) {
        waiting = document.createElement('div');
        waiting.id = 'stream-waiting';
        waiting.className = 'stream-waiting';
        waiting.innerHTML = `
            <div class="stream-waiting-card">
                <div class="stream-waiting-title">En attente du flux…</div>
                <div class="stream-waiting-subtitle">Le live va commencer sous peu.</div>
            </div>
        `;
        container.appendChild(waiting);
    }

    waiting.style.display = isWaiting ? 'flex' : 'none';

    const info = document.querySelector('.stream-info');
    if (info) {
        let note = document.getElementById('stream-waiting-note');
        if (!note) {
            note = document.createElement('div');
            note.id = 'stream-waiting-note';
            note.className = 'stream-waiting-note';
            note.innerHTML = `
                <strong>Live en préparation</strong>
                <span>Le flux vidéo n'est pas encore disponible.</span>
            `;
            info.prepend(note);
        }
        note.style.display = isWaiting ? 'flex' : 'none';
    }

    const likeBtn = document.getElementById('like-btn');
    const followBtn = document.getElementById('follow-btn');
    const shareBtn = document.getElementById('share-btn');
    const buttons = [likeBtn, followBtn, shareBtn].filter(Boolean);
    buttons.forEach(btn => {
        if (isWaiting) {
            btn.disabled = true;
            btn.classList.add('disabled');
            btn.style.opacity = '0.6';
            btn.style.cursor = 'not-allowed';
        } else {
            btn.disabled = false;
            btn.classList.remove('disabled');
            btn.style.opacity = '';
            btn.style.cursor = '';
        }
    });

    const status = document.getElementById('stream-status');
    if (status && isWaiting) {
        status.textContent = '⏳ EN ATTENTE DU LIVE';
        status.classList.remove('live');
    } else if (status) {
        status.textContent = '🔴 EN DIRECT';
        status.classList.add('live');
    }
}

// Exposer les fonctions utilisées par d'autres scripts
    window.startStream = startStream;
    window.joinStream = joinStream;
    window.endStream = endStream;
    window.leaveStream = leaveStream;
    window.initializeStreamPage = initializeStreamPage;
} else {
    console.warn('streaming.js déjà chargé, initialisation ignorée.');
}
