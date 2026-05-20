(function () {
    if (typeof Peer === "undefined") {
        throw new Error("PeerJS is required for MeliChat.");
    }

    const roomAdjectives = [
        "amber", "brave", "bright", "calm", "clever", "cosmic", "crisp", "daring",
        "electric", "frosty", "gentle", "golden", "hidden", "lucky", "lunar", "magic",
        "merry", "neon", "nimble", "polar", "quiet", "rapid", "silver", "solar",
        "steady", "swift", "vivid", "wild", "ancient", "bold", "breezy", "brisk",
        "cobalt", "curious", "dreamy", "emerald", "fearless", "glowing", "happy", "ivory",
        "jolly", "kind", "misty", "nova", "opal", "playful", "proud", "ruby",
        "sapphire", "shimmering", "tidy", "zesty"
    ];
    const roomNouns = [
        "atlas", "beacon", "bridge", "canyon", "comet", "cove", "ember", "forest",
        "harbor", "lantern", "meadow", "meteor", "orbit", "pixel", "prairie", "quartz",
        "river", "rocket", "summit", "tempo", "tower", "valley", "voyage", "wave",
        "window", "zephyr", "anchor", "arcade", "aurora", "breeze", "citadel", "cloud",
        "compass", "delta", "echo", "galaxy", "garden", "glacier", "horizon", "island",
        "jewel", "lagoon", "matrix", "nebula", "oasis", "portal", "reef", "signal",
        "spark", "studio"
    ];
    const qualityLevels = ["auto", "low", "medium", "high", "max"];
    const qualityLabels = {
        auto: "Auto",
        low: "Low (360p)",
        medium: "Balanced (540p)",
        high: "HD (720p)",
        max: "Max (1080p)"
    };
    const qualityProfiles = {
        camera: {
            low: { scaleResolutionDownBy: 4, maxBitrate: 300000, maxFramerate: 12 },
            medium: { scaleResolutionDownBy: 2, maxBitrate: 750000, maxFramerate: 20 },
            high: { scaleResolutionDownBy: 1.5, maxBitrate: 1500000, maxFramerate: 30 },
            max: { scaleResolutionDownBy: 1, maxBitrate: 3000000, maxFramerate: 30 }
        },
        screen: {
            low: { scaleResolutionDownBy: 4, maxBitrate: 600000, maxFramerate: 10 },
            medium: { scaleResolutionDownBy: 2, maxBitrate: 1200000, maxFramerate: 15 },
            high: { scaleResolutionDownBy: 1.5, maxBitrate: 2500000, maxFramerate: 24 },
            max: { scaleResolutionDownBy: 1, maxBitrate: 5000000, maxFramerate: 30 }
        }
    };
    const qualityRank = new Map(qualityLevels.map((quality, index) => [quality, index]));
    const connectionStaleLimitMs = 20000;
    const connectionRepairFailureLimit = 5;
    const connectionAbandonFailureLimit = 20;
    const forwardingDirectFanout = 4;
    const forwardingRelayFanout = 4;

    const qs = new URLSearchParams(window.location.search);
    const roomId = sanitizeRoomId(qs.get("room")) || createRoomId();
    const roomPeerId = `vidchat-room-${roomId}`;
    const state = {
        peer: null,
        coordinatorPeer: null,
        coordinatorClaimTimer: null,
        isHost: false,
        autoCameraAttempted: false,
        previewStreams: new Map(),
        localStreams: new Map(),
        outboundCalls: new Map(),
        inboundCalls: new Map(),
        callRetryTimers: new Map(),
        dataRetryTimers: new Map(),
        dataRetryAttempts: new Map(),
        dataConnections: new Map(),
        dataLastSeen: new Map(),
        connectionFailureCounts: new Map(),
        connectionDebugLog: [],
        streamFailureCounts: new Map(),
        abandonedPeers: new Set(),
        abandonedStreams: new Set(),
        knownPeers: new Set(),
        expectedRemoteStreams: new Map(),
        expectedRemoteStreamSince: new Map(),
        missingStreamRequests: new Map(),
        lastStreamManifestAt: 0,
        lastPeerSyncAt: 0,
        peerNames: new Map(),
        tiles: new Map(),
        tileConfigs: new Map(),
        displayName: ensureDisplayName(),
        chatName: localStorage.getItem("vidChatChatName") || "MeliChat",
        bgColor: localStorage.getItem("vidChatBgColor") || "#000000",
        bgImage: localStorage.getItem("vidChatBgImage") || "",
        accentColor: localStorage.getItem("vidChatAccentColor") || "#ff7ac8",
        layout: "grid",
        videoFit: localStorage.getItem("vidChatVideoFit") || "contain",
        mirrorLocalCamera: localStorage.getItem("vidChatMirrorLocalCamera") !== "false",
        streamForwardingEnabled: localStorage.getItem("vidChatStreamForwarding") !== "false",
        cameraFacingMode: localStorage.getItem("vidChatCameraFacingMode") || "",
        cameraSendQuality: localStorage.getItem("vidChatCameraQuality") || "auto",
        screenSendQuality: localStorage.getItem("vidChatScreenQuality") || "auto",
        cameraRecoveryAttempts: 0,
        cameraRecoveryTimer: null,
        healthTimer: null,
        networkRecoveryTimer: null,
        focusedTileId: null,
        activeFeedModalId: null,
        fullscreenSelfViewPositions: new Map(),
        fullscreenSelfViewDrag: null,
        remoteQualityPreferences: new Map(),
        remoteQualityCaps: new Map(),
        appliedQualityTargets: new Map(),
        forwardingPeerCaps: new Map(),
        forwardingRelayTargets: new Map(),
        forwardingTasks: new Map(),
        forwardedOutboundCalls: new Map(),
        forwardingHandoffTimers: new Map(),
        receivedStreams: new Map(),
        zIndex: 1,
        unreadCount: 0,
        chatOpen: false,
        chatHistory: [],
        connectionSummaryTimer: null,
        incomingFiles: new Map(),
        outgoingFiles: new Map()
    };
    const pendingRemoteAudioElements = new Set();
    const boundRemoteAudioTracks = new WeakSet();
    const maxDataConnectionRetries = 4;
    const maxMediaCallRetries = 3;
    const fileChunkSize = 64 * 1024;
    const fileBackpressureLimit = 1024 * 1024;
    const emojiAliasOverrides = {
        "100": "💯",
        angry: "😠",
        boom: "💥",
        check: "✅",
        computer: "💻",
        cool: "😎",
        devil: "😈",
        evil: "😈",
        fear: "😨",
        flex: "💪",
        haha: "😂",
        happy: "😄",
        hmmm: "🤔",
        mindblown: "🤯",
        ok: "👌",
        party: "🥳",
        praise: "🙌",
        smile: "😊",
        thumbsup: "👍"
    };

    function debugConnection(event, details = {}) {
        const peerId = details.peerId;
        const conn = peerId ? state.dataConnections.get(peerId) : null;
        const pc = details.pc || findPeerConnection(details.source || conn);
        const cleanDetails = {};
        for (const [key, value] of Object.entries(details)) {
            if (key === "source" || key === "pc") continue;
            cleanDetails[key] = value;
        }
        const lastSeen = peerId ? state.dataLastSeen.get(peerId) : null;
        const entry = {
            event,
            at: new Date().toISOString(),
            selfId: state.peer && state.peer.id,
            roomId,
            peerId,
            details: cleanDetails,
            dataConnection: conn ? {
                open: !!conn.open,
                type: conn.type,
                peer: conn.peer
            } : null,
            peerConnection: pc ? {
                connectionState: pc.connectionState,
                iceConnectionState: pc.iceConnectionState,
                iceGatheringState: pc.iceGatheringState,
                signalingState: pc.signalingState
            } : null,
            lastSeen,
            staleMs: typeof lastSeen === "number" && lastSeen > 0 ? Date.now() - lastSeen : null,
            failureCount: peerId ? state.connectionFailureCounts.get(peerId) || 0 : null,
            online: navigator.onLine,
            network: navigator.connection ? {
                effectiveType: navigator.connection.effectiveType,
                downlink: navigator.connection.downlink,
                rtt: navigator.connection.rtt,
                saveData: navigator.connection.saveData
            } : null,
            totals: {
                dataConnections: state.dataConnections.size,
                outboundCalls: state.outboundCalls.size,
                inboundCalls: state.inboundCalls.size,
                knownPeers: state.knownPeers.size,
                abandonedPeers: state.abandonedPeers.size
            }
        };

        state.connectionDebugLog.push(entry);
        if (state.connectionDebugLog.length > 100) state.connectionDebugLog.shift();
        window.vidChatConnectionDebug = state.connectionDebugLog;
        window.vidChatCopyConnectionDebug = () => JSON.stringify(state.connectionDebugLog, null, 2);
        console.groupCollapsed(`[VidChat connection] ${event}${peerId ? ` ${shortPeer(peerId)}` : ""}`);
        console.log(entry);
        console.groupEnd();
    }

    const emojis = buildEmojiIndex();
    const emojiByCode = new Map(emojis.map((emoji) => [emoji.code.toLowerCase(), emoji.char]));

    const els = {
        status: document.getElementById("status"),
        copyRoomLink: document.getElementById("copyRoomLink"),
        newRoom: document.getElementById("newRoom"),
        cameraToggle: document.getElementById("cameraToggle"),
        screenToggle: document.getElementById("screenToggle"),
        screenAudioMute: document.getElementById("screenAudioMute"),
        openChat: document.getElementById("openChat"),
        chatBadge: document.getElementById("chatBadge"),
        chatModal: document.getElementById("chatModal"),
        chatHistory: document.getElementById("chatHistory"),
        chatInput: document.getElementById("chatInput"),
        sendChat: document.getElementById("sendChat"),
        attachFile: document.getElementById("attachFile"),
        fileInput: document.getElementById("fileInput"),
        emojiAutocomplete: document.getElementById("emojiAutocomplete"),
        appSettingsButton: document.getElementById("appSettingsButton"),
        appSettingsModal: document.getElementById("appSettingsModal"),
        screenShareModal: document.getElementById("screenShareModal"),
        screenShareModalTitle: document.getElementById("screenShareModalTitle"),
        screenShareModalSubtitle: document.getElementById("screenShareModalSubtitle"),
        screenShareModalControls: document.getElementById("screenShareModalControls"),
        connectionSummary: document.getElementById("connectionSummary"),
        connectionSummaryMeta: document.getElementById("connectionSummaryMeta"),
        refreshConnections: document.getElementById("refreshConnections"),
        displayName: document.getElementById("displayName"),
        brandName: document.getElementById("brandName"),
        chatNameInput: document.getElementById("chatNameInput"),
        customRoomId: document.getElementById("customRoomId"),
        openCustomRoom: document.getElementById("openCustomRoom"),
        bgColorInput: document.getElementById("bgColorInput"),
        bgImageInput: document.getElementById("bgImageInput"),
        clearBgImage: document.getElementById("clearBgImage"),
        accentColorInput: document.getElementById("accentColorInput"),
        mirrorLocalCamera: document.getElementById("mirrorLocalCamera"),
        streamForwardingEnabled: document.getElementById("streamForwardingEnabled"),
        feedModal: document.getElementById("feedModal"),
        feedModalTitle: document.getElementById("feedModalTitle"),
        feedModalSubtitle: document.getElementById("feedModalSubtitle"),
        feedModalControls: document.getElementById("feedModalControls"),
        videos: document.getElementById("videos"),
        tileTemplate: document.getElementById("tileTemplate")
    };

    updateUrl(roomId);
    applyVideoFit();
    applyMirrorSetting();
    applyTheme();
    applyChatName();
    bindUi();
    startHealthLoop();
    window.addEventListener("resize", keepTilesInsideStage);
    startRoom();

    async function startRoom() {
        setStatus("Opening room...");
        const peer = new Peer(undefined, peerOptions());

        peer.on("open", () => {
            state.peer = peer;
            bindPeer(peer);
            setStatus(`Connected as ${peer.id}. Opening room...`);
            scheduleCoordinatorClaim(0);
            startCameraAfterConnection();
        });

        peer.on("error", (error) => {
            setStatus(`Peer error: ${error.message || error.type}`);
        });
    }

    function scheduleCoordinatorClaim(delay) {
        if (!state.peer || state.isHost || state.coordinatorPeer || state.coordinatorClaimTimer) return;

        state.coordinatorClaimTimer = window.setTimeout(() => {
            state.coordinatorClaimTimer = null;
            claimCoordinator();
        }, delay);
    }

    function claimCoordinator() {
        if (!state.peer || state.isHost || state.coordinatorPeer) return;

        const coordinatorPeer = new Peer(roomPeerId, peerOptions());
        coordinatorPeer.on("open", () => {
            state.coordinatorPeer = coordinatorPeer;
            state.isHost = true;
            bindCoordinatorPeer(coordinatorPeer);
            broadcast({ type: "coordinator-changed", peerId: state.peer.id });
            updatePeerStatus();
        });
        coordinatorPeer.on("error", (error) => {
            coordinatorPeer.destroy();
            if (state.coordinatorPeer === coordinatorPeer) state.coordinatorPeer = null;
            state.isHost = false;
            if (error.type === "unavailable-id") {
                connectData(roomPeerId, true);
                return;
            }
            setStatus(`Room coordinator error: ${error.message || error.type}`);
        });
        coordinatorPeer.on("close", () => {
            if (state.coordinatorPeer !== coordinatorPeer) return;
            state.coordinatorPeer = null;
            state.isHost = false;
            scheduleCoordinatorClaim(randomCoordinatorDelay());
            updatePeerStatus();
        });
    }

    function bindPeer(peer) {
        peer.on("connection", (conn) => registerConnection(conn));
        peer.on("call", handleIncomingCall);
        peer.on("disconnected", () => {
            debugConnection("peerjs-disconnected", { peerId: state.peer && state.peer.id });
            setStatus("Disconnected from PeerJS. Reconnecting...");
            peer.reconnect();
        });
    }

    function bindCoordinatorPeer(peer) {
        peer.on("connection", (conn) => registerConnection(conn, true));
        peer.on("call", handleIncomingCall);
    }

    function handleIncomingCall(call) {
        const kind = call.metadata && call.metadata.kind ? call.metadata.kind : "camera";
        const sourcePeerId = call.metadata && call.metadata.sourcePeerId ? call.metadata.sourcePeerId : call.peer;
        const key = `${kind}:${sourcePeerId}`;
        const oldCall = state.inboundCalls.get(key);
        state.inboundCalls.set(key, call);
        if (oldCall && oldCall !== call) oldCall.close();

        call.answer();
        call.on("stream", (stream) => {
            if (state.inboundCalls.get(key) !== call) return;
            addRemoteStream(sourcePeerId, call.metadata, stream);
            rememberReceivedStream(sourcePeerId, kind, stream, call.metadata);
            updateForwardingTask(sourcePeerId, kind);
        });
        call.on("close", () => {
            debugConnection("media-call-close", { peerId: sourcePeerId, kind, source: call });
            clearIncomingCall(key, call);
        });
        call.on("error", (error) => {
            debugConnection("media-call-error", { peerId: sourcePeerId, kind, source: call, error: error && (error.message || error.type || String(error)) });
            clearIncomingCall(key, call);
        });
    }

    function clearIncomingCall(key, call) {
        if (state.inboundCalls.get(key) !== call) return;
        state.inboundCalls.delete(key);
        const [kind, peerId] = splitCallKey(key);
        removeTile(tileId(peerId, kind));
    }

    function registerConnection(conn, coordinatorConnection = false) {
        if (state.dataConnections.has(conn.peer)) {
            const oldConn = state.dataConnections.get(conn.peer);
            if (oldConn.open) oldConn.close();
        }

        state.dataConnections.set(conn.peer, conn);
        conn.on("open", () => {
            clearDataConnectionRetry(conn.peer);
            markPeerSeen(conn.peer);
            rememberPeer(conn.peer);
            debugConnection("data-open", { peerId: conn.peer, source: conn });
            conn.send({ type: "hello", peerId: state.peer.id, displayName: state.displayName, streamForwardingEnabled: state.streamForwardingEnabled });
            sendStreamManifestTo(conn.peer);

            if (state.isHost && coordinatorConnection) {
                const roster = roomRoster(conn.peer);
                conn.send({ type: "welcome", roomId, peers: roster, history: state.chatHistory, coordinatorPeerId: state.peer.id });
                broadcast({ type: "peer-joined", peerId: conn.peer }, conn.peer);
            }

            sendLocalStreamsTo(conn.peer);
            publishLocalStreamManifest(true);
            updatePeerStatus();
        });

        conn.on("data", (message) => {
            markPeerSeen(conn.peer);
            handleMessage(conn.peer, message);
        });
        conn.on("close", () => {
            if (state.dataConnections.get(conn.peer) !== conn) return;
            state.dataConnections.delete(conn.peer);
            clearMissingStreamRequestsForPeer(conn.peer);
            debugConnection("data-close-retry-queued", { peerId: conn.peer, source: conn });
            failIncomingFilesForPeer(conn.peer, "Transfer interrupted.");
            failOutgoingFilesForPeer(conn.peer, "Peer disconnected during transfer.");
            if (conn.peer === roomPeerId) {
                scheduleCoordinatorClaim(randomCoordinatorDelay());
            } else {
                rememberPeer(conn.peer);
                scheduleDataConnectionRetry(conn.peer, false);
            }
            updatePeerStatus();
        });
        conn.on("error", (error) => {
            if (state.dataConnections.get(conn.peer) !== conn) return;
            state.dataConnections.delete(conn.peer);
            clearMissingStreamRequestsForPeer(conn.peer);
            debugConnection("data-error-retry-queued", { peerId: conn.peer, source: conn, error: error && (error.message || error.type || String(error)) });
            failIncomingFilesForPeer(conn.peer, "Transfer failed.");
            failOutgoingFilesForPeer(conn.peer, "Peer connection failed during transfer.");
            if (conn.peer === roomPeerId) {
                scheduleCoordinatorClaim(randomCoordinatorDelay());
            } else {
                rememberPeer(conn.peer);
                scheduleDataConnectionRetry(conn.peer, false);
            }
            updatePeerStatus();
        });
    }

    function handleMessage(peerId, message) {
        if (!message || typeof message !== "object") return;

        if (message.displayName) {
            setPeerName(peerId, message.displayName);
        }
        if (typeof message.streamForwardingEnabled === "boolean") {
            state.forwardingPeerCaps.set(peerId, message.streamForwardingEnabled);
        }

        if (message.type === "hello") {
            return;
        }

        if (message.type === "health-ping") {
            sendToPeer(peerId, { type: "health-pong", timestamp: Date.now() });
            return;
        }

        if (message.type === "health-pong") {
            return;
        }

        if (message.type === "peer-sync") {
            handlePeerSync(peerId, message);
            return;
        }

        if (message.type === "stream-manifest") {
            handleStreamManifest(peerId, message);
            return;
        }

        if (message.type === "quality-preference") {
            handleQualityPreference(peerId, message);
            return;
        }

        if (message.type === "forwarding-capability") {
            rebalanceStreamForwarding(true);
            return;
        }

        if (message.type === "forwarding-assignment") {
            handleForwardingAssignment(peerId, message);
            return;
        }

        if (message.type === "request-stream") {
            resendLocalStreamToPeer(peerId, message.kind);
            return;
        }

        if (message.type === "welcome") {
            setStatus(`Joined room ${message.roomId}. Connecting to ${message.peers.length} peer(s).`);
            message.peers.forEach((id) => {
                rememberPeer(id);
                connectData(id, false);
            });
            if (message.history) {
                message.history.forEach((msg) => {
                    if (msg.type === "chat") {
                        addChatMessage(msg.peerId, msg.text, msg.timestamp);
                    } else if (msg.type === "chat-image") {
                        addChatImageMessage(msg.peerId, msg.src, msg.timestamp, msg.caption || msg.name || "");
                    } else if (msg.type === "file" && msg.data) {
                        addFileMessage(msg.peerId, msg.name, msg.size, msg.data, msg.timestamp);
                    }
                });
            }
            return;
        }

        if (message.type === "coordinator-changed") {
            if (message.peerId && message.peerId !== state.peer.id) connectData(roomPeerId, false);
            updatePeerStatus();
            return;
        }

        if (message.type === "peer-joined") {
            rememberPeer(message.peerId);
            connectData(message.peerId, false);
            publishPeerSync(true);
            updatePeerStatus();
            return;
        }

        if (message.type === "peer-left") {
            forgetPeer(message.peerId);
            clearDataConnectionRetry(message.peerId);
            closeCallsForPeer(message.peerId);
            removePeerTiles(message.peerId);
            updatePeerStatus();
            return;
        }

        if (message.type === "stream-stopped") {
            forgetExpectedRemoteStream(peerId, message.kind);
            clearForwardingTask(peerId, message.kind);
            removeTile(tileId(peerId, message.kind));
            return;
        }

        if (message.type === "name-changed") {
            setPeerName(peerId, message.displayName);
        }

        if (message.type === "chat") {
            addChatMessage(peerId, message.text, message.timestamp);
        }

        if (message.type === "chat-image") {
            addChatImageMessage(peerId, message.src, message.timestamp, message.caption || message.name || "");
        }

        if (message.type === "file" && message.data) {
            addFileMessage(peerId, message.name, message.size, message.data, message.timestamp);
        }

        if (message.type === "file-start") {
            handleFileStart(peerId, message);
        }

        if (message.type === "file-chunk") {
            handleFileChunk(peerId, message).catch(() => {});
        }

        if (message.type === "file-end") {
            handleFileEnd(peerId, message);
        }

        if (message.type === "file-ack") {
            handleFileAck(peerId, message);
        }

        if (message.type === "file-error") {
            handleFileError(peerId, message);
        }
    }

    function sendChatMessage() {
        const text = expandEmojiShortcodes(els.chatInput.value).trim();
        if (!text) return;

        els.chatInput.value = "";
        els.emojiAutocomplete.classList.add("hidden");

        const standaloneImageUrl = normalizeChatImageUrl(text);
        if (standaloneImageUrl) {
            const msg = { type: "chat-image", src: standaloneImageUrl, timestamp: Date.now(), caption: "" };
            addChatImageMessage("local", msg.src, msg.timestamp, msg.caption);
            broadcast(msg);
            return;
        }

        const msg = { type: "chat", text, timestamp: Date.now() };
        addChatMessage("local", msg.text, msg.timestamp);
        broadcast(msg);
    }

    function addChatMessage(peerId, text, timestamp) {
        const imageUrl = normalizeChatImageUrl(text);
        if (imageUrl) {
            addChatImageMessage(peerId, imageUrl, timestamp, "");
            return;
        }

        const local = peerId === "local";
        const author = local ? state.displayName : (state.peerNames.get(peerId) || shortPeer(peerId));
        const timeStr = new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        const messageEl = document.createElement("div");
        messageEl.className = `chat-message ${local ? "local" : ""}`;

        const authorEl = document.createElement("span");
        authorEl.className = "author";
        authorEl.textContent = author;

        const timeEl = document.createElement("span");
        timeEl.className = "timestamp";
        timeEl.textContent = timeStr;
        authorEl.appendChild(timeEl);

        const contentEl = document.createElement("div");
        contentEl.className = "content";
        // Convert URLs to clickable links safely
        contentEl.innerHTML = linkify(text);

        messageEl.append(authorEl, contentEl);
        els.chatHistory.appendChild(messageEl);
        els.chatHistory.scrollTop = els.chatHistory.scrollHeight;

        state.chatHistory.push({ peerId, author, text, timestamp, type: "chat" });

        if (!local && !state.chatOpen) {
            state.unreadCount++;
            updateChatBadge();
        }
    }

    function addChatImageMessage(peerId, src, timestamp, caption) {
        const local = peerId === "local";
        const author = local ? state.displayName : (state.peerNames.get(peerId) || shortPeer(peerId));
        const timeStr = new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const safeSrc = safeChatImageSource(src);
        if (!safeSrc) {
            addChatMessage(peerId, caption || "[image]", timestamp);
            return;
        }

        const messageEl = document.createElement("div");
        messageEl.className = `chat-message ${local ? "local" : ""}`;

        const authorEl = document.createElement("span");
        authorEl.className = "author";
        authorEl.textContent = author;

        const timeEl = document.createElement("span");
        timeEl.className = "timestamp";
        timeEl.textContent = timeStr;
        authorEl.appendChild(timeEl);

        const contentEl = document.createElement("div");
        contentEl.className = "content chat-image";

        const img = document.createElement("img");
        img.alt = caption || "Shared image";
        img.src = safeSrc;
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";

        contentEl.appendChild(img);

        if (caption) {
            const captionEl = document.createElement("div");
            captionEl.className = "image-caption";
            captionEl.textContent = caption;
            contentEl.appendChild(captionEl);
        }

        messageEl.append(authorEl, contentEl);
        els.chatHistory.appendChild(messageEl);
        els.chatHistory.scrollTop = els.chatHistory.scrollHeight;

        state.chatHistory.push({ peerId, author, src: safeSrc, caption: caption || "", timestamp, type: "chat-image" });

        if (!local && !state.chatOpen) {
            state.unreadCount++;
            updateChatBadge();
        }
    }

    async function sendClipboardImage(file) {
        if (!file || !file.type || !file.type.startsWith("image/")) return;
        const src = await blobToDataUrl(file);
        const msg = {
            type: "chat-image",
            src,
            timestamp: Date.now(),
            caption: file.name || "Pasted image"
        };
        addChatImageMessage("local", msg.src, msg.timestamp, msg.caption);
        broadcast(msg);
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error || new Error("Could not read image clipboard data."));
            reader.readAsDataURL(blob);
        });
    }

    function linkify(text) {
        // Escape HTML to prevent XSS before adding our own <a> tags
        const div = document.createElement("div");
        div.textContent = text;
        const escapedText = div.innerHTML;

        const urlPattern = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        return escapedText.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    }

    function normalizeChatImageUrl(text) {
        const value = String(text || "").trim();
        if (!value || /\s/.test(value)) return null;
        const url = safeHttpUrl(value);
        if (!url) return null;
        if (!isLikelyImageUrl(url)) return null;
        return url.toString();
    }

    function safeChatImageSource(src) {
        const value = String(src || "").trim();
        if (!value) return null;
        if (value.startsWith("data:image/")) return value;
        const url = safeHttpUrl(value);
        if (!url) return null;
        if (!isLikelyImageUrl(url)) return null;
        return url.toString();
    }

    function safeHttpUrl(value) {
        try {
            const url = new URL(value, window.location.href);
            if (url.protocol !== "http:" && url.protocol !== "https:") return null;
            return url;
        } catch {
            return null;
        }
    }

    function isLikelyImageUrl(url) {
        return /\.(png|jpe?g|gif|webp|bmp|avif|svg)(?:[?#].*)?$/i.test(url.pathname);
    }

    function addFileMessage(peerId, name, size, data, timestamp) {
        const local = peerId === "local";
        const author = local ? state.displayName : (state.peerNames.get(peerId) || shortPeer(peerId));
        const timeStr = new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        const messageEl = document.createElement("div");
        messageEl.className = `chat-message ${local ? "local" : ""}`;

        const authorEl = document.createElement("span");
        authorEl.className = "author";
        authorEl.textContent = author;

        const timeEl = document.createElement("span");
        timeEl.className = "timestamp";
        timeEl.textContent = timeStr;
        authorEl.appendChild(timeEl);

        const contentEl = document.createElement("div");
        contentEl.className = "content";

        const blob = data instanceof Blob ? data : new Blob([data]);
        renderFileAttachment(contentEl, name, size, blob);
        messageEl.append(authorEl, contentEl);
        els.chatHistory.appendChild(messageEl);
        els.chatHistory.scrollTop = els.chatHistory.scrollHeight;

        state.chatHistory.push({ peerId, author, name, size, timestamp, type: "file" });

        if (!local && !state.chatOpen) {
            state.unreadCount++;
            updateChatBadge();
        }
    }

    function addFileTransferMessage(peerId, name, size, timestamp, label) {
        const local = peerId === "local";
        const author = local ? state.displayName : (state.peerNames.get(peerId) || shortPeer(peerId));
        const timeStr = new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        const messageEl = document.createElement("div");
        messageEl.className = `chat-message ${local ? "local" : ""}`;

        const authorEl = document.createElement("span");
        authorEl.className = "author";
        authorEl.textContent = author;

        const timeEl = document.createElement("span");
        timeEl.className = "timestamp";
        timeEl.textContent = timeStr;
        authorEl.appendChild(timeEl);

        const contentEl = document.createElement("div");
        contentEl.className = "content file-transfer";

        const title = document.createElement("div");
        title.className = "file-transfer-title";
        const nameEl = document.createElement("strong");
        nameEl.textContent = name;
        const sizeEl = document.createElement("span");
        sizeEl.className = "file-info";
        sizeEl.textContent = formatBytes(size);
        title.append(nameEl, sizeEl);

        const status = document.createElement("div");
        status.className = "file-transfer-status";
        status.textContent = label;

        const progress = document.createElement("progress");
        progress.className = "file-progress";
        progress.max = size || 1;
        progress.value = 0;

        const attachment = document.createElement("div");
        attachment.className = "file-attachment hidden";

        contentEl.append(title, status, progress, attachment);
        messageEl.append(authorEl, contentEl);
        els.chatHistory.appendChild(messageEl);
        els.chatHistory.scrollTop = els.chatHistory.scrollHeight;

        if (!local && !state.chatOpen) {
            state.unreadCount++;
            updateChatBadge();
        }

        return {
            messageEl,
            status,
            progress,
            attachment,
            name,
            size,
            complete(text) {
                status.textContent = text;
                progress.value = progress.max;
                contentEl.classList.add("complete");
                attachment.classList.remove("hidden");
            },
            fail(text) {
                status.textContent = text;
                contentEl.classList.add("failed");
            }
        };
    }

    function updateFileProgress(ui, received, total, prefix) {
        if (!ui) return;
        ui.progress.max = total || 1;
        ui.progress.value = Math.min(received, total || received);
        const percent = total ? Math.floor((received / total) * 100) : 0;
        ui.status.textContent = `${prefix} ${formatBytes(received)} of ${formatBytes(total)} (${percent}%)`;
        els.chatHistory.scrollTop = els.chatHistory.scrollHeight;
    }

    async function sendFile(file) {
        if (!state.peer) {
            const ui = addFileTransferMessage("local", file.name, file.size, Date.now(), "Room is still connecting.");
            ui.fail("Room is still connecting. Try again in a moment.");
            return;
        }

        const recipients = [...state.dataConnections.values()].filter((conn) => conn.open);
        const timestamp = Date.now();
        const transferId = `${state.peer.id}-${timestamp}-${Math.random().toString(36).slice(2)}`;
        const totalBytes = file.size * Math.max(1, recipients.length);
        const ui = addFileTransferMessage("local", file.name, file.size, timestamp, recipients.length ? `Sending to ${recipients.length} peer${recipients.length === 1 ? "" : "s"}...` : "No connected peers to send to.");

        if (!recipients.length) {
            ui.fail("No connected peers to send to.");
            return;
        }

        let sentBytes = 0;
        let completed = 0;
        state.outgoingFiles.set(transferId, {
            ui,
            recipients: new Set(recipients.map((conn) => conn.peer)),
            acknowledged: new Set(),
            failed: new Set()
        });

        const results = await Promise.allSettled(recipients.map(async (conn) => {
            conn.send({
                type: "file-start",
                transferId,
                name: file.name,
                size: file.size,
                mimeType: file.type || "application/octet-stream",
                timestamp
            });

            for (let offset = 0, index = 0; offset < file.size; offset += fileChunkSize, index++) {
                const chunk = await file.slice(offset, offset + fileChunkSize).arrayBuffer();
                await waitForSendBuffer(conn);
                conn.send({
                    type: "file-chunk",
                    transferId,
                    index,
                    data: chunk
                });
                sentBytes += chunk.byteLength;
                updateFileProgress(ui, sentBytes, totalBytes, "Sent");
            }

            await waitForSendBuffer(conn);
            conn.send({ type: "file-end", transferId });
            completed++;
            if (state.outgoingFiles.has(transferId)) {
                ui.status.textContent = `Uploaded to ${completed} of ${recipients.length} peer${recipients.length === 1 ? "" : "s"}...`;
            }
        }));

        const failures = results.filter((result) => result.status === "rejected").length;
        if (failures) {
            ui.fail(`Failed for ${failures} peer${failures === 1 ? "" : "s"}.`);
            state.outgoingFiles.delete(transferId);
            return;
        }

        if (state.outgoingFiles.has(transferId)) {
            ui.status.textContent = `Uploaded to ${recipients.length} peer${recipients.length === 1 ? "" : "s"}. Waiting for download confirmation...`;
        }
    }

    function waitForSendBuffer(conn) {
        return new Promise((resolve) => {
            const channel = conn.dataChannel || conn._dc;
            if (!channel || typeof channel.bufferedAmount !== "number") {
                resolve();
                return;
            }

            const check = () => {
                if (!conn.open || channel.readyState === "closed") {
                    resolve();
                    return;
                }
                if (channel.bufferedAmount < fileBackpressureLimit) {
                    resolve();
                    return;
                }
                window.setTimeout(check, 30);
            };
            check();
        });
    }

    function handleFileStart(peerId, message) {
        if (!message.transferId || !message.name || typeof message.size !== "number") return;
        const transferKey = fileTransferKey(peerId, message.transferId);
        const existing = state.incomingFiles.get(transferKey);
        if (existing) existing.ui.fail("Transfer restarted.");

        const ui = addFileTransferMessage(peerId, message.name, message.size, message.timestamp || Date.now(), "Receiving...");
        state.incomingFiles.set(transferKey, {
            peerId,
            transferId: message.transferId,
            name: message.name,
            size: message.size,
            mimeType: message.mimeType || "application/octet-stream",
            timestamp: message.timestamp || Date.now(),
            chunks: [],
            receivedBytes: 0,
            ui
        });
    }

    async function handleFileChunk(peerId, message) {
        const transfer = state.incomingFiles.get(fileTransferKey(peerId, message.transferId));
        if (!transfer || typeof message.index !== "number") return;

        const chunk = await normalizeFileChunk(message.data);
        if (!chunk || transfer.chunks[message.index]) return;

        transfer.chunks[message.index] = chunk;
        transfer.receivedBytes += chunk.byteLength;
        updateFileProgress(transfer.ui, transfer.receivedBytes, transfer.size, "Received");
    }

    function handleFileEnd(peerId, message) {
        const key = fileTransferKey(peerId, message.transferId);
        const transfer = state.incomingFiles.get(key);
        if (!transfer) return;

        state.incomingFiles.delete(key);
        if (transfer.receivedBytes !== transfer.size) {
            transfer.ui.fail(`Transfer incomplete: ${formatBytes(transfer.receivedBytes)} of ${formatBytes(transfer.size)} received.`);
            sendToPeer(peerId, { type: "file-error", transferId: message.transferId, reason: "Transfer incomplete." });
            return;
        }

        const blob = new Blob(transfer.chunks, { type: transfer.mimeType });
        finalizeFileTransferMessage(transfer.ui, transfer.name, transfer.size, blob, transfer.mimeType);
        transfer.ui.complete("Received. Download is ready.");
        sendToPeer(peerId, { type: "file-ack", transferId: message.transferId });
    }

    function finalizeFileTransferMessage(ui, name, size, blob, mimeType) {
        if (!ui || !ui.attachment) return;
        renderFileAttachment(ui.attachment, name, size, blob, mimeType);
    }

    function renderFileAttachment(container, name, size, blob, mimeType) {
        if (!container) return null;

        const type = mimeType || (blob && blob.type) || "";
        const url = URL.createObjectURL(blob);
        const isImage = type.startsWith("image/") || isLikelyImageName(name);

        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.className = "file-link";

        const icon = document.createElement("span");
        icon.textContent = "📁";

        const label = document.createElement("span");
        label.textContent = name;

        const info = document.createElement("span");
        info.className = "file-info";
        info.textContent = `(${formatBytes(size)})`;

        link.append(icon, label, info);
        container.replaceChildren(link);
        container.classList.remove("hidden");

        if (isImage) {
            const preview = document.createElement("img");
            preview.className = "file-preview-image";
            preview.alt = name;
            preview.src = url;
            container.appendChild(preview);
        }

        return url;
    }

    function isLikelyImageName(name) {
        return /\.(png|jpe?g|gif|webp|bmp|avif|svg)(?:[?#].*)?$/i.test(String(name || ""));
    }

    async function normalizeFileChunk(data) {
        if (data instanceof ArrayBuffer) return data;
        if (data instanceof Blob) return data.arrayBuffer();
        if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        return null;
    }

    function failIncomingFilesForPeer(peerId, reason) {
        for (const [key, transfer] of state.incomingFiles) {
            if (transfer.peerId !== peerId) continue;
            transfer.ui.fail(reason);
            state.incomingFiles.delete(key);
        }
    }

    function failOutgoingFilesForPeer(peerId, reason) {
        for (const [transferId, transfer] of state.outgoingFiles) {
            if (!transfer.recipients.has(peerId) || transfer.acknowledged.has(peerId)) continue;
            transfer.failed.add(peerId);
            updateOutgoingFileStatus(transferId, reason);
        }
    }

    function handleFileAck(peerId, message) {
        const transfer = state.outgoingFiles.get(message.transferId);
        if (!transfer) return;

        transfer.acknowledged.add(peerId);
        updateOutgoingFileStatus(message.transferId);
    }

    function handleFileError(peerId, message) {
        const transfer = state.outgoingFiles.get(message.transferId);
        if (!transfer) return;

        transfer.failed.add(peerId);
        updateOutgoingFileStatus(message.transferId, message.reason || "Transfer failed.");
    }

    function updateOutgoingFileStatus(transferId, failureReason) {
        const transfer = state.outgoingFiles.get(transferId);
        if (!transfer) return;

        const total = transfer.recipients.size;
        const done = transfer.acknowledged.size;
        const failed = transfer.failed.size;

        if (failed) {
            transfer.ui.fail(`${failureReason || "Transfer failed."} ${done} confirmed, ${failed} failed.`);
            state.outgoingFiles.delete(transferId);
            return;
        }

        if (done >= total) {
            transfer.ui.complete(`Received by ${total} peer${total === 1 ? "" : "s"}.`);
            state.outgoingFiles.delete(transferId);
            return;
        }

        transfer.ui.status.textContent = `Received by ${done} of ${total} peer${total === 1 ? "" : "s"}...`;
    }

    function sendToPeer(peerId, message) {
        const conn = state.dataConnections.get(peerId);
        if (conn && conn.open) conn.send(message);
    }

    function fileTransferKey(peerId, transferId) {
        return `${peerId}:${transferId}`;
    }

    function formatBytes(bytes) {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    function updateChatBadge() {
        els.chatBadge.textContent = state.unreadCount;
        els.chatBadge.classList.toggle("hidden", state.unreadCount === 0);
    }

    function buildEmojiIndex() {
        const byCode = new Map();

        function addEmoji(name, char, terms = []) {
            if (!name || !char) return;
            const normalizedName = name.toLowerCase();
            const code = `:${normalizedName}:`;
            if (byCode.has(code)) return;

            byCode.set(code, {
                code,
                char,
                searchTerms: [normalizedName, ...terms.map((term) => String(term).toLowerCase())]
            });
        }

        for (const [char, aliases, tags, description] of window.VIDCHAT_EMOJI_DATA || []) {
            for (const alias of aliases || []) {
                addEmoji(alias, char, [...(tags || []), description || ""]);
            }
        }

        for (const [alias, char] of Object.entries(emojiAliasOverrides)) {
            addEmoji(alias, char);
        }

        return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
    }

    function expandEmojiShortcodes(text) {
        return text.replace(/:([a-z0-9_+\-]+):/gi, (match) => emojiByCode.get(match.toLowerCase()) || match);
    }

    function handleChatInput() {
        const value = els.chatInput.value;
        const lastColonIndex = value.lastIndexOf(":");

        if (lastColonIndex === -1 || lastColonIndex < value.lastIndexOf(" ")) {
            els.emojiAutocomplete.classList.add("hidden");
            return;
        }

        const query = value.slice(lastColonIndex).toLowerCase();
        if (!/^:[a-z0-9_+\-]*$/.test(query)) {
            els.emojiAutocomplete.classList.add("hidden");
            return;
        }

        const term = query.slice(1);
        const matches = emojis
            .filter((emoji) => emoji.code.startsWith(query) || emoji.searchTerms.some((searchTerm) => searchTerm.startsWith(term)))
            .slice(0, 40);

        if (matches.length === 0) {
            els.emojiAutocomplete.classList.add("hidden");
            return;
        }

        renderEmojiAutocomplete(matches, lastColonIndex);
    }

    function handleChatPaste(event) {
        const clipboardItems = [...(event.clipboardData && event.clipboardData.items ? event.clipboardData.items : [])];
        const imageItem = clipboardItems.find((item) => item.kind === "file" && item.type && item.type.startsWith("image/"));
        if (!imageItem) return;

        const file = imageItem.getAsFile();
        if (!file) return;

        event.preventDefault();
        sendClipboardImage(file).catch((error) => {
            setStatus(`Clipboard image error: ${error.message}`);
        });
    }

    function renderEmojiAutocomplete(matches, index) {
        els.emojiAutocomplete.replaceChildren();
        matches.forEach((emoji, i) => {
            const div = document.createElement("div");
            div.className = `emoji-option ${i === 0 ? "active" : ""}`;
            const symbol = document.createElement("span");
            symbol.className = "symbol";
            symbol.textContent = emoji.char;
            const shortcode = document.createElement("span");
            shortcode.className = "shortcode";
            shortcode.textContent = emoji.code;
            div.append(symbol, shortcode);
            div.addEventListener("click", () => {
                const before = els.chatInput.value.slice(0, index);
                const after = els.chatInput.value.slice(els.chatInput.selectionStart);
                els.chatInput.value = before + emoji.char + " " + after;
                els.emojiAutocomplete.classList.add("hidden");
                els.chatInput.focus();
            });
            els.emojiAutocomplete.appendChild(div);
        });
        els.emojiAutocomplete.classList.remove("hidden");
    }

    function moveAutocompleteSelection(dir) {
        const options = [...els.emojiAutocomplete.querySelectorAll(".emoji-option")];
        const activeIndex = options.findIndex(o => o.classList.contains("active"));
        const nextIndex = (activeIndex + dir + options.length) % options.length;
        options.forEach(o => o.classList.remove("active"));
        options[nextIndex].classList.add("active");
        options[nextIndex].scrollIntoView({ block: "nearest" });
    }

    function connectData(peerId, required) {
        if (state.abandonedPeers.has(peerId)) return;
        if (!peerId || peerId === state.peer.id) return;
        const existing = state.dataConnections.get(peerId);
        if (existing && existing.open) return;
        if (existing) {
            existing.close();
            state.dataConnections.delete(peerId);
        }

        debugConnection("data-connect-start", { peerId, required });
        const conn = state.peer.connect(peerId, { reliable: true });
        registerConnection(conn);
        conn.on("error", (error) => {
            debugConnection("data-connect-error", { peerId, required, source: conn, error: error && (error.message || error.type || String(error)) });
            if (required) setStatus("The room is not reachable yet. Check the link or try again.");
            if (peerId === roomPeerId) scheduleCoordinatorClaim(randomCoordinatorDelay());
            scheduleDataConnectionRetry(peerId, required);
        });
    }

    function scheduleDataConnectionRetry(peerId, required) {
        if (!peerId || state.dataConnections.has(peerId) || state.dataRetryTimers.has(peerId)) return;

        const attempt = (state.dataRetryAttempts.get(peerId) || 0) + 1;
        if (attempt > maxDataConnectionRetries) {
            debugConnection("data-connect-retries-exhausted", { peerId, required, attempt });
            if (peerId === roomPeerId) scheduleCoordinatorClaim(randomCoordinatorDelay());
            return;
        }

        state.dataRetryAttempts.set(peerId, attempt);
        const delay = Math.min(8000, 600 * (2 ** (attempt - 1)));
        debugConnection("data-connect-retry-scheduled", { peerId, required, attempt, delay });
        const timer = window.setTimeout(() => {
            state.dataRetryTimers.delete(peerId);
            if (!state.dataConnections.has(peerId)) connectData(peerId, required);
        }, delay);
        state.dataRetryTimers.set(peerId, timer);
    }

    function clearDataConnectionRetry(peerId) {
        const timer = state.dataRetryTimers.get(peerId);
        if (timer) window.clearTimeout(timer);
        state.dataRetryTimers.delete(peerId);
        state.dataRetryAttempts.delete(peerId);
    }

    async function toggleCamera() {
        if (state.localStreams.has("camera") || state.previewStreams.has("camera")) {
            stopFullCamera();
            return;
        }

        await startAndShareCamera();
    }

    async function startAndShareCamera() {
        els.cameraToggle.disabled = true;
        els.cameraToggle.textContent = "Starting...";

        try {
            const stream = await acquireCameraStream(state.cameraFacingMode);
            state.cameraFacingMode = cameraFacingModeFromStream(stream) || state.cameraFacingMode;
            localStorage.setItem("vidChatCameraFacingMode", state.cameraFacingMode || "");
            state.cameraRecoveryAttempts = 0;
            state.localStreams.set("camera", stream);
            addCameraTile(stream, false);
            sendLocalStreamToAll("camera", stream);
            publishLocalStreamManifest(true);
            applyQualityPolicies(true);
            setStatus("Camera and microphone are now shared.");
        } catch (error) {
            setStatus(`Camera error: ${error.message}`);
        } finally {
            try {
                updateMediaButtons();
            } catch (err) {
                console.error("updateMediaButtons failed", err);
                if (els && els.cameraToggle) {
                    els.cameraToggle.disabled = false;
                    els.cameraToggle.textContent = (state.localStreams.has("camera") || state.previewStreams.has("camera")) ? "Remove Video" : "Share Camera/Mic";
                }
            }
        }
    }

    async function acquireCameraStream(facingMode) {
        const video = facingMode ? { facingMode: { ideal: facingMode } } : true;
        return navigator.mediaDevices.getUserMedia({ video, audio: true });
    }

    function cameraFacingModeFromStream(stream) {
        const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
        const settings = track && typeof track.getSettings === "function" ? track.getSettings() : null;
        return settings && settings.facingMode ? settings.facingMode : "";
    }

    function startCameraAfterConnection() {
        if (state.autoCameraAttempted || state.localStreams.has("camera") || state.previewStreams.has("camera")) return;
        state.autoCameraAttempted = true;
        startAndShareCamera();
    }

    function stopFullCamera() {
        const stream = state.localStreams.get("camera") || state.previewStreams.get("camera");
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
        }
        clearLocalCameraRecovery();

        state.localStreams.delete("camera");
        state.previewStreams.delete("camera");
        removeTile(tileId("local", "camera"));

        closeOutboundCalls("camera");
        broadcast({ type: "stream-stopped", kind: "camera" });

        setStatus("You are now spectating.");
        updateMediaButtons();
    }

    async function toggleScreen() {
        if (state.localStreams.has("screen")) {
            openScreenShareManager();
            return;
        }

        await startScreenShare();
    }

    async function startScreenShare(replaceExisting = false) {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") {
            showScreenShareUnsupported();
            return;
        }

        if (isMobileBrowser() && !mobileScreenCaptureLikelySupported()) {
            showMobileScreenShareInstructions();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });

            if (replaceExisting) {
                replaceLocalScreenShare(stream);
            } else {
                addLocalStream("screen", stream);
            }

            if (els.screenShareModal.open) {
                renderScreenShareManager();
            }

            const [videoTrack] = stream.getVideoTracks();
            if (videoTrack) videoTrack.addEventListener("ended", () => stopLocalStream("screen"));
        } catch (error) {
            if (isMobileBrowser()) {
                showMobileScreenShareInstructions(error);
            } else {
                setStatus(`Screen share error: ${error.message}`);
            }
        }
    }

    async function switchLocalCameraFacing() {
        const stream = state.localStreams.get("camera") || state.previewStreams.get("camera");
        if (!stream) return;

        const currentFacing = cameraFacingModeFromStream(stream) || state.cameraFacingMode || "user";
        const nextFacing = currentFacing === "environment" ? "user" : "environment";
        await restartLocalCameraStream(stream, nextFacing);
    }

    function isMobileBrowser() {
        return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    }

    function isAndroidChrome() {
        const ua = navigator.userAgent || "";
        return /Android/i.test(ua) && /Chrome\/[0-9]+/i.test(ua) && !/OPR|Edg|SamsungBrowser/i.test(ua);
    }

    function mobileScreenCaptureLikelySupported() {
        if (!isMobileBrowser()) return true;
        return isAndroidChrome() && (location.protocol === "https:" || location.hostname === "localhost");
    }

    function showScreenShareUnsupported() {
        setStatus("Screen sharing is not available in this browser. Use a desktop browser or a supported Android Chrome browser over HTTPS.");
    }

    function showMobileScreenShareInstructions(error) {
        let message = "Screen sharing from mobile browsers is limited. On Android, use Chrome over HTTPS and accept the browser screen-share prompt. iOS browsers do not currently expose reliable browser screen capture.";
        if (location.protocol !== "https:" && location.hostname !== "localhost") {
            message += " This page also needs to be loaded over HTTPS for screen sharing.";
        }
        if (error && error.message) {
            message += ` Browser error: ${error.message}`;
        }
        setStatus(message);
    }

    function replaceLocalScreenShare(stream) {
        const current = state.localStreams.get("screen");
        if (current) {
            closeOutboundCalls("screen");
            removeTile(tileId("local", "screen"));
            current.getTracks().forEach((track) => track.stop());
        }

        state.localStreams.set("screen", stream);
        addTile({
            id: tileId("local", "screen"),
            owner: "You",
            subtitle: screenSubtitle(stream),
            kind: "screen",
            stream,
            muted: true,
            local: true
        });

        sendLocalStreamToAll("screen", stream);
        publishLocalStreamManifest(true);
        applyQualityPolicies(true);
        updateMediaButtons();
    }

    function openScreenShareManager() {
        if (!state.localStreams.has("screen")) return;
        renderScreenShareManager();
        if (!els.screenShareModal.open) els.screenShareModal.showModal();
    }

    function renderScreenShareManager() {
        const stream = state.localStreams.get("screen");
        els.screenShareModalTitle.textContent = "Screen Sharing";
        els.screenShareModalControls.replaceChildren();

        if (!stream) {
            els.screenShareModalSubtitle.textContent = "No screen is currently being shared.";
            els.screenShareModalControls.appendChild(makeModalButton("Share screen", () => startScreenShare(), "primary"));
            return;
        }

        const screenRow = document.createElement("div");
        screenRow.className = "setting-row";
        const screenLabel = document.createElement("span");
        const screenValue = document.createElement("span");
        screenLabel.textContent = "Current screen";
        screenValue.textContent = screenSubtitle(stream);
        screenRow.append(screenLabel, screenValue);

        els.screenShareModalSubtitle.textContent = "Choose another screen, mute the screen video, or stop sharing.";
        els.screenShareModalControls.appendChild(screenRow);
        els.screenShareModalControls.appendChild(makeModalButton("Share another screen", () => startScreenShare(true), "primary"));
        els.screenShareModalControls.appendChild(makeModalButton("Stop sharing", () => {
            stopLocalStream("screen");
            if (els.screenShareModal.open) els.screenShareModal.close();
        }, "danger"));
    }

    function addLocalStream(kind, stream) {
        shareLocalStream(kind, stream);
    }

    function shareLocalStream(kind, stream, options = {}) {
        const replaceExisting = Boolean(options.replaceExisting);
        const currentStream = state.localStreams.get(kind);
        if (currentStream && currentStream !== stream) {
            if (replaceExisting) {
                closeOutboundCalls(kind);
                removeTile(tileId("local", kind));
            }
            currentStream.getTracks().forEach((track) => track.stop());
        }

        state.localStreams.set(kind, stream);
        addTile({
            id: tileId("local", kind),
            owner: "You",
            subtitle: kind === "screen" ? screenSubtitle(stream) : "Camera and microphone",
            kind,
            stream,
            muted: true,
            local: true
        });

        sendLocalStreamToAll(kind, stream);
        publishLocalStreamManifest(true);
        applyQualityPolicies(true);
        updateMediaButtons();
    }

    function addCameraTile(stream, preview) {
        addTile({
            id: tileId("local", "camera"),
            owner: "You",
            subtitle: preview ? "Preview only - not shared" : "Camera and microphone shared",
            kind: "camera",
            stream,
            muted: true,
            local: true,
            preview
        });
        if (!preview) scheduleLocalCameraRenderCheck(stream);
    }

    function scheduleLocalCameraRenderCheck(stream, delay = 1200) {
        clearLocalCameraRecovery();
        state.cameraRecoveryTimer = window.setTimeout(() => {
            state.cameraRecoveryTimer = null;
            checkLocalCameraRendering(stream);
        }, delay);
    }

    function clearLocalCameraRecovery() {
        if (!state.cameraRecoveryTimer) return;
        window.clearTimeout(state.cameraRecoveryTimer);
        state.cameraRecoveryTimer = null;
    }

    function checkLocalCameraRendering(stream) {
        if (state.localStreams.get("camera") !== stream) return;

        const video = localCameraVideo();
        if (!video) return;
        ensureVideoPlayback(video);

        const hasLiveVideo = stream.getVideoTracks().some((track) => track.enabled && track.readyState === "live");
        const isRendering = isVideoElementRendering(video);
        if (!hasLiveVideo || isRendering) return;

        if (state.cameraRecoveryAttempts === 0) {
            state.cameraRecoveryAttempts += 1;
            reattachVideoStream(video, stream);
            scheduleLocalCameraRenderCheck(stream, 1400);
            return;
        }

        if (state.cameraRecoveryAttempts === 1) {
            state.cameraRecoveryAttempts += 1;
            restartLocalCameraStream(stream);
        }
    }

    function reattachVideoStream(video, stream) {
        video.pause();
        video.srcObject = null;
        video.load();
        video.srcObject = stream;
        ensureVideoPlayback(video);
    }

    async function restartLocalCameraStream(oldStream, facingMode) {
        if (state.localStreams.get("camera") !== oldStream) return;

        try {
            const stream = await acquireCameraStream(facingMode || cameraFacingModeFromStream(oldStream) || state.cameraFacingMode);
            state.cameraFacingMode = cameraFacingModeFromStream(stream) || state.cameraFacingMode;
            localStorage.setItem("vidChatCameraFacingMode", state.cameraFacingMode || "");
            if (state.localStreams.get("camera") !== oldStream) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            oldStream.getTracks().forEach((track) => track.stop());
            state.localStreams.set("camera", stream);
            closeOutboundCalls("camera");
            addCameraTile(stream, false);
            sendLocalStreamToAll("camera", stream);
            publishLocalStreamManifest(true);
            applyQualityPolicies(true);
            updateMediaButtons();
        } catch (error) {
            setStatus(`Camera recovery error: ${error.message}`);
        }
    }

    function localCameraVideo() {
        const tile = state.tiles.get(tileId("local", "camera"));
        return tile ? tile.querySelector("video") : null;
    }

    function createLocalMediaOverlay(config) {
        const overlay = document.createElement("button");
        overlay.type = "button";
        overlay.className = "local-media-overlay hidden";
        overlay.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (config.kind === "camera") {
                restartLocalCameraStream(config.stream);
                return;
            }
            if (config.kind === "screen") toggleScreen();
        });
        return overlay;
    }

    function stopLocalStream(kind) {
        const stream = state.localStreams.get(kind);
        if (!stream) return;

        stream.getTracks().forEach((track) => track.stop());
        state.localStreams.delete(kind);
        removeTile(tileId("local", kind));

        closeOutboundCalls(kind);

        broadcast({ type: "stream-stopped", kind });
        publishLocalStreamManifest(true);
        updateMediaButtons();
    }

    function closeOutboundCalls(kind) {
        for (const [key, call] of state.outboundCalls) {
            if (key.startsWith(`${kind}:`)) {
                clearMediaCallRetry(key);
                clearForwardingHandoffTimer(key);
                call.close();
                state.outboundCalls.delete(key);
            }
        }
    }

    function sendLocalStreamToAll(kind, stream) {
        routeLocalStream(kind, stream, true);
    }

    function sendLocalStreamsTo(peerId) {
        if (!peerId || peerId === roomPeerId) return;
        rebalanceStreamForwarding(true);
    }

    function callPeer(peerId, kind, stream, attempt = 0, metadataOverrides = {}) {
        if (!state.peer || peerId === state.peer.id) return;

        const key = `${kind}:${peerId}`;
        const oldCall = state.outboundCalls.get(key);
        if (oldCall) {
            state.outboundCalls.delete(key);
            oldCall.close();
        }
        clearMediaCallRetry(key);

        const call = state.peer.call(peerId, stream, {
            metadata: {
                kind,
                from: state.peer.id,
                displayName: state.displayName,
                sourcePeerId: state.peer.id,
                sourceDisplayName: state.displayName,
                hasAudio: stream.getAudioTracks().length > 0,
                ...metadataOverrides
            }
        });

        state.outboundCalls.set(key, call);
        window.setTimeout(() => {
            applyQualityToPeer(peerId, kind, true);
        }, 0);
        call.on("close", () => clearOutboundCall(key, call, stream, attempt));
        call.on("error", () => clearOutboundCall(key, call, stream, attempt));
    }

    function clearOutboundCall(key, call, stream, attempt) {
        if (state.outboundCalls.get(key) !== call) return;
        state.outboundCalls.delete(key);
        state.appliedQualityTargets.delete(key);
        scheduleMediaCallRetry(key, stream, attempt + 1);
    }

    function scheduleMediaCallRetry(key, stream, attempt) {
        if (attempt > maxMediaCallRetries || state.callRetryTimers.has(key)) return;
        const [kind, peerId] = splitCallKey(key);
        if (state.localStreams.get(kind) !== stream || !state.dataConnections.has(peerId)) return;

        const delay = Math.min(6000, 750 * (2 ** (attempt - 1)));
        const timer = window.setTimeout(() => {
            state.callRetryTimers.delete(key);
            if (state.localStreams.get(kind) === stream && state.dataConnections.has(peerId)) {
                routeLocalStream(kind, stream, true);
            }
        }, delay);
        state.callRetryTimers.set(key, timer);
    }

    function clearMediaCallRetry(key) {
        const timer = state.callRetryTimers.get(key);
        if (timer) window.clearTimeout(timer);
        state.callRetryTimers.delete(key);
    }

    function rebalanceStreamForwarding(force = false) {
        for (const [kind, stream] of state.localStreams) {
            routeLocalStream(kind, stream, force);
        }
    }

    function routeLocalStream(kind, stream, force = false) {
        if (!stream || !state.peer) return;

        const recipients = currentMediaRecipients();
        const routes = forwardingRoutesForRecipients(recipients);
        const directTargets = new Set(routes.directTargets);
        const assignmentsByRelay = routes.assignmentsByRelay;

        for (const [peerId, conn] of state.dataConnections) {
            if (peerId === roomPeerId || peerId === state.peer.id || !conn.open) continue;
            const key = `${kind}:${peerId}`;
            if (directTargets.has(peerId)) {
                clearForwardingHandoffTimer(key);
                if (force || !state.outboundCalls.has(key)) callPeer(peerId, kind, stream);
            } else if (state.outboundCalls.has(key)) {
                scheduleForwardingHandoffClose(kind, peerId);
            }
        }

        publishForwardingAssignments(kind, assignmentsByRelay);
    }

    function scheduleForwardingHandoffClose(kind, peerId) {
        const key = `${kind}:${peerId}`;
        if (state.forwardingHandoffTimers.has(key)) return;

        const timer = window.setTimeout(() => {
            state.forwardingHandoffTimers.delete(key);
            const stream = state.localStreams.get(kind);
            if (!stream) return;
            const routes = forwardingRoutesForRecipients(currentMediaRecipients());
            if (new Set(routes.directTargets).has(peerId)) return;
            const call = state.outboundCalls.get(key);
            if (!call) return;
            clearMediaCallRetry(key);
            call.close();
            state.outboundCalls.delete(key);
        }, 2000);
        state.forwardingHandoffTimers.set(key, timer);
    }

    function clearForwardingHandoffTimer(key) {
        const timer = state.forwardingHandoffTimers.get(key);
        if (timer) window.clearTimeout(timer);
        state.forwardingHandoffTimers.delete(key);
    }

    function currentMediaRecipients() {
        return [...state.dataConnections.keys()]
            .filter((peerId) => peerId !== roomPeerId && peerId !== (state.peer && state.peer.id))
            .filter((peerId) => !state.abandonedPeers.has(peerId))
            .filter((peerId) => {
                const conn = state.dataConnections.get(peerId);
                return conn && conn.open;
            })
            .sort();
    }

    function forwardingRoutesForRecipients(recipients) {
        if (!state.streamForwardingEnabled || recipients.length <= forwardingDirectFanout) {
            return { directTargets: recipients, assignmentsByRelay: new Map() };
        }

        const relayCandidates = recipients.filter((peerId) => state.forwardingPeerCaps.get(peerId) !== false);
        const relayCount = Math.min(
            relayCandidates.length,
            forwardingDirectFanout,
            Math.max(1, Math.ceil((recipients.length - forwardingDirectFanout) / forwardingRelayFanout))
        );
        const relayPeers = relayCandidates.slice(0, relayCount);
        if (!relayPeers.length) return { directTargets: recipients, assignmentsByRelay: new Map() };

        const directTargets = new Set(relayPeers);
        for (const peerId of recipients) {
            if (directTargets.size >= forwardingDirectFanout) break;
            directTargets.add(peerId);
        }

        const overflow = recipients.filter((peerId) => !directTargets.has(peerId));
        const assignmentsByRelay = new Map(relayPeers.map((peerId) => [peerId, new Set()]));
        overflow.forEach((targetPeerId, index) => {
            const relayPeerId = relayPeers[index % relayPeers.length];
            if (relayPeerId !== targetPeerId) assignmentsByRelay.get(relayPeerId).add(targetPeerId);
        });

        return { directTargets: [...directTargets], assignmentsByRelay };
    }

    function publishForwardingAssignments(kind, assignmentsByRelay) {
        const currentRelays = new Set(assignmentsByRelay.keys());
        const previousRelays = state.forwardingRelayTargets.get(kind) || new Set();

        for (const relayPeerId of previousRelays) {
            if (!currentRelays.has(relayPeerId)) {
                sendForwardingAssignment(kind, relayPeerId, []);
            }
        }

        for (const [relayPeerId, targets] of assignmentsByRelay) {
            sendForwardingAssignment(kind, relayPeerId, [...targets]);
        }

        state.forwardingRelayTargets.set(kind, currentRelays);
    }

    function sendForwardingAssignment(kind, relayPeerId, targets) {
        sendToPeer(relayPeerId, {
            type: "forwarding-assignment",
            sourcePeerId: state.peer && state.peer.id,
            sourceDisplayName: state.displayName,
            kind,
            targets,
            streamForwardingEnabled: state.streamForwardingEnabled
        });
    }

    function handleForwardingAssignment(fromPeerId, message) {
        if (!state.streamForwardingEnabled || !message || message.sourcePeerId !== fromPeerId || !message.kind) return;
        const targets = Array.isArray(message.targets)
            ? message.targets.filter((peerId) => peerId && peerId !== state.peer.id && peerId !== fromPeerId && peerId !== roomPeerId)
            : [];
        const key = forwardingTaskKey(fromPeerId, message.kind);

        if (!targets.length) {
            clearForwardingTask(fromPeerId, message.kind);
            return;
        }

        state.forwardingTasks.set(key, {
            sourcePeerId: fromPeerId,
            sourceDisplayName: sanitizeDisplayName(message.sourceDisplayName) || state.peerNames.get(fromPeerId) || shortPeer(fromPeerId),
            kind: message.kind,
            targets: new Set(targets)
        });
        updateForwardingTask(fromPeerId, message.kind);
    }

    function rememberReceivedStream(sourcePeerId, kind, stream, metadata) {
        const key = forwardingTaskKey(sourcePeerId, kind);
        const previousStream = state.receivedStreams.get(key);
        if (previousStream && previousStream !== stream) {
            closeStaleForwardedCalls(sourcePeerId, kind, new Set());
        }
        state.receivedStreams.set(key, stream);
    }

    function updateForwardingTask(sourcePeerId, kind) {
        const key = forwardingTaskKey(sourcePeerId, kind);
        const task = state.forwardingTasks.get(key);
        const stream = state.receivedStreams.get(key);
        if (!task || !stream || !state.streamForwardingEnabled) return;

        const activeTargets = new Set();
        for (const targetPeerId of task.targets) {
            const conn = state.dataConnections.get(targetPeerId);
            if (!conn || !conn.open || state.abandonedPeers.has(targetPeerId)) continue;
            activeTargets.add(targetPeerId);
            forwardStreamToPeer(task, stream, targetPeerId);
        }

        closeStaleForwardedCalls(sourcePeerId, kind, activeTargets);
    }

    function forwardStreamToPeer(task, stream, targetPeerId) {
        if (!state.peer || targetPeerId === state.peer.id || targetPeerId === task.sourcePeerId) return;

        const key = forwardedCallKey(task.sourcePeerId, task.kind, targetPeerId);
        const oldCall = state.forwardedOutboundCalls.get(key);
        if (oldCall) return;

        const call = state.peer.call(targetPeerId, stream, {
            metadata: {
                kind: task.kind,
                from: task.sourcePeerId,
                sourcePeerId: task.sourcePeerId,
                sourceDisplayName: task.sourceDisplayName,
                displayName: task.sourceDisplayName,
                relayPeerId: state.peer.id,
                relayed: true,
                hasAudio: stream.getAudioTracks().length > 0
            }
        });

        state.forwardedOutboundCalls.set(key, call);
        call.on("close", () => {
            if (state.forwardedOutboundCalls.get(key) === call) state.forwardedOutboundCalls.delete(key);
        });
        call.on("error", () => {
            if (state.forwardedOutboundCalls.get(key) === call) state.forwardedOutboundCalls.delete(key);
        });
    }

    function closeStaleForwardedCalls(sourcePeerId, kind, activeTargets) {
        for (const [key, call] of [...state.forwardedOutboundCalls]) {
            const parts = splitForwardedCallKey(key);
            if (!parts || parts.sourcePeerId !== sourcePeerId || parts.kind !== kind) continue;
            if (activeTargets.has(parts.targetPeerId)) continue;
            call.close();
            state.forwardedOutboundCalls.delete(key);
        }
    }

    function clearForwardingTask(sourcePeerId, kind) {
        const key = forwardingTaskKey(sourcePeerId, kind);
        state.forwardingTasks.delete(key);
        state.receivedStreams.delete(key);
        closeStaleForwardedCalls(sourcePeerId, kind, new Set());
    }

    function clearForwardingStateForPeer(peerId) {
        for (const key of [...state.forwardingTasks.keys()]) {
            const [sourcePeerId, kind] = splitForwardingTaskKey(key);
            if (sourcePeerId === peerId) clearForwardingTask(sourcePeerId, kind);
        }
        for (const key of [...state.receivedStreams.keys()]) {
            const [sourcePeerId, kind] = splitForwardingTaskKey(key);
            if (sourcePeerId === peerId) clearForwardingTask(sourcePeerId, kind);
        }
        for (const [key, call] of [...state.forwardedOutboundCalls]) {
            const parts = splitForwardedCallKey(key);
            if (!parts || parts.sourcePeerId !== peerId && parts.targetPeerId !== peerId) continue;
            call.close();
            state.forwardedOutboundCalls.delete(key);
        }
        for (const [kind, relays] of state.forwardingRelayTargets) {
            if (!relays.delete(peerId)) continue;
            state.forwardingRelayTargets.set(kind, relays);
        }
    }

    function clearAllForwardingTasks() {
        for (const key of [...state.forwardingTasks.keys()]) {
            const [sourcePeerId, kind] = splitForwardingTaskKey(key);
            clearForwardingTask(sourcePeerId, kind);
        }
        for (const [key, call] of [...state.forwardedOutboundCalls]) {
            call.close();
            state.forwardedOutboundCalls.delete(key);
        }
        for (const kind of [...state.forwardingRelayTargets.keys()]) {
            publishForwardingAssignments(kind, new Map());
        }
        state.forwardingRelayTargets.clear();
    }

    function forwardingTaskKey(sourcePeerId, kind) {
        return `${sourcePeerId}:${kind}`;
    }

    function splitForwardingTaskKey(key) {
        const separator = key.lastIndexOf(":");
        return [key.slice(0, separator), key.slice(separator + 1)];
    }

    function forwardedCallKey(sourcePeerId, kind, targetPeerId) {
        return `${sourcePeerId}:${kind}:${targetPeerId}`;
    }

    function splitForwardedCallKey(key) {
        const parts = key.split(":");
        if (parts.length < 3) return null;
        return {
            sourcePeerId: parts[0],
            kind: parts[1],
            targetPeerId: parts.slice(2).join(":")
        };
    }

    function rememberPeer(peerId) {
        if (!peerId || peerId === roomPeerId || peerId === (state.peer && state.peer.id)) return;
        state.knownPeers.add(peerId);
        state.abandonedPeers.delete(peerId);
        state.connectionFailureCounts.delete(peerId);
    }

    function forgetPeer(peerId) {
        if (!peerId || peerId === roomPeerId) return;
        state.knownPeers.delete(peerId);
        state.abandonedPeers.delete(peerId);
        state.connectionFailureCounts.delete(peerId);
        state.expectedRemoteStreams.delete(peerId);
        state.forwardingPeerCaps.delete(peerId);
        clearForwardingStateForPeer(peerId);
        clearPeerQualityState(peerId);
        clearMissingStreamRequestsForPeer(peerId);
    }

    function markPeerSeen(peerId) {
        if (!peerId) return;
        state.dataLastSeen.set(peerId, Date.now());
        if (peerId !== roomPeerId) {
            state.abandonedPeers.delete(peerId);
            state.connectionFailureCounts.delete(peerId);
        }
    }

    function startHealthLoop() {
        if (state.healthTimer) return;
        state.healthTimer = window.setInterval(runHealthCheck, 1000);
        window.addEventListener("online", scheduleNetworkRecovery);
        window.addEventListener("offline", () => setStatus("Network offline. Waiting to reconnect..."));
        window.addEventListener("focus", runHealthCheck);
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) runHealthCheck();
        });
        if (navigator.connection && typeof navigator.connection.addEventListener === "function") {
            navigator.connection.addEventListener("change", scheduleNetworkRecovery);
        }
    }

    function runHealthCheck() {
        recoverPeerConnection();
        ensureRoomCoordinatorReachable();
        sendHealthPings();
        publishPeerSync();
        publishLocalStreamManifest();
        requestMissingExpectedStreams();
        repairDeadConnections();
        ensureLocalStreamsAreShared();
        applyQualityPolicies();
        refreshMediaElements();
    }

    function scheduleNetworkRecovery() {
        if (state.networkRecoveryTimer) window.clearTimeout(state.networkRecoveryTimer);
        state.networkRecoveryTimer = window.setTimeout(() => {
            state.networkRecoveryTimer = null;
            runNetworkRecovery();
        }, 350);
    }

    function runNetworkRecovery() {
        setStatus("Network changed. Rechecking room connections...");
        recoverPeerConnection();
        recoverCoordinatorPeer();
        ensureRoomCoordinatorReachable();
        reconnectKnownPeers();
        repairDeadConnections();
        ensureLocalStreamsAreShared(true);
        applyQualityPolicies(true);
        window.setTimeout(() => {
            ensureRoomCoordinatorReachable();
            reconnectKnownPeers();
            ensureLocalStreamsAreShared(true);
            repairDeadConnections();
            applyQualityPolicies(true);
        }, 1800);
        window.setTimeout(() => {
            ensureRoomCoordinatorReachable();
            reconnectKnownPeers();
            ensureLocalStreamsAreShared(true);
            repairDeadConnections();
            applyQualityPolicies(true);
        }, 4500);
        updatePeerStatus();
    }

    function recoverPeerConnection() {
        if (!state.peer || state.peer.destroyed) return;
        if (state.peer.disconnected && typeof state.peer.reconnect === "function") {
            try {
                debugConnection("peerjs-reconnect-start", { peerId: state.peer.id });
                state.peer.reconnect();
            } catch (error) {
                debugConnection("peerjs-reconnect-error", { peerId: state.peer.id, error: error && (error.message || String(error)) });
                setStatus(`Reconnect error: ${error.message}`);
            }
        }
    }

    function recoverCoordinatorPeer() {
        if (!state.coordinatorPeer || state.coordinatorPeer.destroyed) return;
        if (state.coordinatorPeer.disconnected && typeof state.coordinatorPeer.reconnect === "function") {
            try {
                debugConnection("coordinator-reconnect-start", { peerId: roomPeerId });
                state.coordinatorPeer.reconnect();
            } catch (error) {
                debugConnection("coordinator-reconnect-error", { peerId: roomPeerId, error: error && (error.message || String(error)) });
                state.coordinatorPeer.destroy();
                state.coordinatorPeer = null;
                state.isHost = false;
                scheduleCoordinatorClaim(randomCoordinatorDelay());
            }
        }
    }

    function sendHealthPings() {
        const now = Date.now();
        for (const [peerId, conn] of state.dataConnections) {
            if (!conn.open) continue;
            try {
                conn.send({ type: "health-ping", timestamp: now });
            } catch (error) {
                debugConnection("health-ping-send-failed", { peerId, source: conn, error: error && (error.message || String(error)) });
            }
        }
    }

    function publishPeerSync(force = false) {
        const now = Date.now();
        if (!force && now - state.lastPeerSyncAt < 10000) return;
        state.lastPeerSyncAt = now;
        const peers = currentPeerList();
        for (const [peerId, conn] of state.dataConnections) {
            if (!conn.open) continue;
            conn.send({ type: "peer-sync", peers, timestamp: now, streamForwardingEnabled: state.streamForwardingEnabled });
        }
    }

    function currentPeerList() {
        const peers = new Set([...state.knownPeers, ...state.dataConnections.keys()]);
        peers.delete(roomPeerId);
        peers.delete(state.peer && state.peer.id);
        return [...peers].filter((peerId) => !state.abandonedPeers.has(peerId));
    }

    function handlePeerSync(fromPeerId, message) {
        rememberPeer(fromPeerId);
        if (!Array.isArray(message.peers)) return;
        message.peers.forEach((peerId) => {
            if (!peerId || peerId === state.peer.id || peerId === roomPeerId) return;
            rememberPeer(peerId);
            if (!state.dataConnections.has(peerId)) connectData(peerId, false);
        });
    }

    function publishLocalStreamManifest(force = false) {
        const now = Date.now();
        if (!force && now - state.lastStreamManifestAt < 10000) return;
        state.lastStreamManifestAt = now;

        const streams = localStreamManifest();
        for (const [peerId, conn] of state.dataConnections) {
            if (!conn.open) continue;
            conn.send({ type: "stream-manifest", streams, timestamp: now });
        }
    }

    function sendStreamManifestTo(peerId) {
        sendToPeer(peerId, { type: "stream-manifest", streams: localStreamManifest(), timestamp: Date.now() });
    }

    function localStreamManifest() {
        return [...state.localStreams]
            .filter(([, stream]) => stream.getTracks().some((track) => track.readyState === "live"))
            .map(([kind, stream]) => ({
                kind,
                hasVideo: stream.getVideoTracks().some((track) => track.readyState === "live"),
                hasAudio: stream.getAudioTracks().some((track) => track.readyState === "live"),
                qualityCap: localStreamQualityCap(kind)
            }));
    }

    function handleStreamManifest(peerId, message) {
        if (!Array.isArray(message.streams)) return;
        const expected = new Set();
        for (const streamInfo of message.streams) {
            if (!streamInfo || !streamInfo.kind) continue;
            expected.add(streamInfo.kind);
            state.remoteQualityCaps.set(remoteQualityKey(peerId, streamInfo.kind), normalizeQuality(streamInfo.qualityCap));
            state.abandonedStreams.delete(expectedRemoteStreamKey(peerId, streamInfo.kind));
            trackExpectedRemoteStream(peerId, streamInfo.kind);
        }
        state.expectedRemoteStreams.set(peerId, expected);
        clearUnexpectedRemoteStreamExpectations(peerId, expected);
        refreshOpenFeedModal();
    }

    function handleQualityPreference(peerId, message) {
        if (!message || !message.kind) return;
        const quality = normalizeQuality(message.quality);
        const key = remoteQualityKey(peerId, message.kind);
        state.remoteQualityPreferences.set(key, quality);
        applyQualityToPeer(peerId, message.kind, true);
        refreshOpenFeedModal();
    }

    function requestMissingExpectedStreams() {
        for (const [peerId, kinds] of state.expectedRemoteStreams) {
            const conn = state.dataConnections.get(peerId);
            if (!conn || !conn.open || state.abandonedPeers.has(peerId)) continue;
            for (const kind of kinds) {
                const key = expectedRemoteStreamKey(peerId, kind);
                if (state.abandonedStreams.has(key)) continue;

                if (hasHealthyRemoteStream(peerId, kind)) {
                    state.streamFailureCounts.delete(key);
                    state.expectedRemoteStreamSince.delete(key);
                    state.missingStreamRequests.delete(key);
                    continue;
                }

                const failures = (state.streamFailureCounts.get(key) || 0) + 1;
                state.streamFailureCounts.set(key, failures);
                if (failures === 3) {
                    debugConnection("remote-stream-suspect", { peerId, kind, failures });
                    requestRemoteStream(peerId, kind, "health-check");
                } else if (failures >= 12) {
                    debugConnection("remote-stream-abandoned", { peerId, kind, failures });
                    state.abandonedStreams.add(key);
                    state.streamFailureCounts.delete(key);
                    state.missingStreamRequests.delete(key);
                }
            }
        }
    }

    async function applyQualityPolicies(force = false) {
        const jobs = [];
        for (const [key, call] of state.outboundCalls) {
            const [kind, peerId] = splitCallKey(key);
            jobs.push(applyQualityToPeer(peerId, kind, force, call));
        }
        await Promise.allSettled(jobs);
    }

    async function applyQualityToPeer(peerId, kind, force = false, call = null) {
        const key = remoteQualityKey(peerId, kind);
        const outboundCall = call || state.outboundCalls.get(`${kind}:${peerId}`);
        if (!outboundCall) return;

        const pc = findPeerConnection(outboundCall);
        if (!pc || typeof pc.getSenders !== "function" || typeof pc.getStats !== "function") return;
        const sender = pc.getSenders().find((candidate) => candidate && candidate.track && candidate.track.kind === "video");
        if (!sender || typeof sender.getParameters !== "function" || typeof sender.setParameters !== "function") return;

        let stats = null;
        try {
            stats = await pc.getStats();
        } catch {
            stats = null;
        }

        const target = resolveOutboundQuality(kind, peerId, stats);
        if (!force && state.appliedQualityTargets.get(key) === target) return;

        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        const encoding = { ...params.encodings[0] };
        const profile = qualityProfile(kind, target);

        if (profile) {
            encoding.maxBitrate = profile.maxBitrate;
            encoding.maxFramerate = profile.maxFramerate;
        } else {
            delete encoding.maxBitrate;
            delete encoding.maxFramerate;
        }

        params.encodings[0] = encoding;
        params.degradationPreference = kind === "screen" ? "maintain-resolution" : "balanced";

        try {
            await sender.setParameters(params);
            state.appliedQualityTargets.set(key, target);
        } catch (error) {
            console.error("Failed to apply media quality", error);
        }
    }

    function requestRemoteStream(peerId, kind, reason) {
        const key = `${peerId}:${kind}`;
        const now = Date.now();
        if (now - (state.missingStreamRequests.get(key) || 0) < 10000) return;
        state.missingStreamRequests.set(key, now);
        debugConnection("remote-stream-request", { peerId, kind, reason });
        sendToPeer(peerId, { type: "request-stream", kind, reason });
    }

    function hasHealthyRemoteStream(peerId, kind) {
        const config = state.tileConfigs.get(tileId(peerId, kind));
        if (!config || !config.stream) return false;
        const tracks = config.stream.getTracks();
        if (!tracks.some((track) => track.readyState === "live")) return false;
        const videoTracks = config.stream.getVideoTracks();
        return !videoTracks.length || videoTracks.some((track) => track.readyState === "live");
    }

    function trackExpectedRemoteStream(peerId, kind) {
        const key = expectedRemoteStreamKey(peerId, kind);
        if (hasHealthyRemoteStream(peerId, kind)) {
            state.expectedRemoteStreamSince.delete(key);
            state.missingStreamRequests.delete(key);
            return;
        }
        if (!state.expectedRemoteStreamSince.has(key)) state.expectedRemoteStreamSince.set(key, Date.now());
    }

    function clearUnexpectedRemoteStreamExpectations(peerId, expected) {
        for (const key of [...state.expectedRemoteStreamSince.keys()]) {
            const [keyPeerId, kind] = splitExpectedRemoteStreamKey(key);
            if (keyPeerId === peerId && !expected.has(kind)) {
                state.expectedRemoteStreamSince.delete(key);
                state.missingStreamRequests.delete(key);
            }
        }
    }

    function expectedRemoteStreamKey(peerId, kind) {
        return `${peerId}:${kind}`;
    }

    function splitExpectedRemoteStreamKey(key) {
        const separator = key.lastIndexOf(":");
        return [key.slice(0, separator), key.slice(separator + 1)];
    }

    function forgetExpectedRemoteStream(peerId, kind) {
        const expected = state.expectedRemoteStreams.get(peerId);
        if (!expected) return;
        expected.delete(kind);
        state.missingStreamRequests.delete(`${peerId}:${kind}`);
        state.expectedRemoteStreamSince.delete(expectedRemoteStreamKey(peerId, kind));
        state.streamFailureCounts.delete(expectedRemoteStreamKey(peerId, kind));
        state.abandonedStreams.delete(expectedRemoteStreamKey(peerId, kind));
        if (!expected.size) state.expectedRemoteStreams.delete(peerId);
    }

    function clearMissingStreamRequestsForPeer(peerId) {
        for (const key of [...state.missingStreamRequests.keys()]) {
            if (key.startsWith(`${peerId}:`)) state.missingStreamRequests.delete(key);
        }
        for (const key of [...state.expectedRemoteStreamSince.keys()]) {
            if (key.startsWith(`${peerId}:`)) state.expectedRemoteStreamSince.delete(key);
        }
        for (const key of [...state.streamFailureCounts.keys()]) {
            if (key.startsWith(`${peerId}:`)) state.streamFailureCounts.delete(key);
        }
        for (const key of [...state.abandonedStreams]) {
            if (key.startsWith(`${peerId}:`)) state.abandonedStreams.delete(key);
        }
    }

    function clearPeerQualityState(peerId) {
        for (const key of [...state.remoteQualityPreferences.keys()]) {
            if (key.startsWith(`${peerId}:`)) state.remoteQualityPreferences.delete(key);
        }
        for (const key of [...state.remoteQualityCaps.keys()]) {
            if (key.startsWith(`${peerId}:`)) state.remoteQualityCaps.delete(key);
        }
        for (const key of [...state.appliedQualityTargets.keys()]) {
            if (key.startsWith(`${peerId}:`)) state.appliedQualityTargets.delete(key);
        }
    }

    function resendLocalStreamToPeer(peerId, kind) {
        const stream = state.localStreams.get(kind);
        const conn = state.dataConnections.get(peerId);
        if (!stream || !conn || !conn.open) return;
        const key = `${kind}:${peerId}`;
        const oldCall = state.outboundCalls.get(key);
        if (oldCall) {
            clearMediaCallRetry(key);
            oldCall.close();
            state.outboundCalls.delete(key);
        }
        callPeer(peerId, kind, stream);
    }

    function rebuildPeerConnections() {
        for (const peerId of state.dataConnections.keys()) {
            rememberPeer(peerId);
        }

        for (const [key, call] of [...state.outboundCalls]) {
            clearMediaCallRetry(key);
            clearForwardingHandoffTimer(key);
            call.close();
            state.outboundCalls.delete(key);
        }

        for (const key of [...state.forwardingHandoffTimers.keys()]) {
            clearForwardingHandoffTimer(key);
        }

        for (const [key, call] of [...state.forwardedOutboundCalls]) {
            call.close();
            state.forwardedOutboundCalls.delete(key);
        }
        state.forwardingRelayTargets.clear();
        state.forwardingTasks.clear();
        state.receivedStreams.clear();

        for (const [key, call] of [...state.inboundCalls]) {
            call.close();
            state.inboundCalls.delete(key);
            const [kind, peerId] = splitCallKey(key);
            removeTile(tileId(peerId, kind));
        }

        for (const [peerId, conn] of [...state.dataConnections]) {
            conn.close();
            state.dataConnections.delete(peerId);
            state.dataLastSeen.delete(peerId);
            state.expectedRemoteStreams.delete(peerId);
            clearMissingStreamRequestsForPeer(peerId);
            if (peerId !== roomPeerId) removePeerTiles(peerId);
        }
    }

    function reconnectKnownPeers() {
        for (const peerId of state.knownPeers) {
            if (state.abandonedPeers.has(peerId)) continue;
            connectData(peerId, false);
        }
    }

    function ensureRoomCoordinatorReachable() {
        if (!state.peer) return;
        if (state.isHost || state.coordinatorPeer) return;
        const roomConn = state.dataConnections.get(roomPeerId);
        if (!roomConn || !roomConn.open) connectData(roomPeerId, true);
    }

    function repairDeadConnections() {
        const now = Date.now();
        const connectedPeers = new Set();

        for (const [peerId, conn] of [...state.dataConnections]) {
            connectedPeers.add(peerId);
            const lastSeen = state.dataLastSeen.get(peerId);
            const heartbeatFailed = lastSeen === 0;
            const staleHeartbeat = typeof lastSeen === "number" && lastSeen > 0 && now - lastSeen > connectionStaleLimitMs;
            const pc = findPeerConnection(conn);
            const failed = !conn.open || heartbeatFailed || staleHeartbeat || isPeerConnectionDead(pc);
            if (!failed) {
                if (peerId !== roomPeerId) state.connectionFailureCounts.delete(peerId);
                continue;
            }

            const failures = (state.connectionFailureCounts.get(peerId) || 0) + 1;
            state.connectionFailureCounts.set(peerId, failures);
            debugConnection("connection-suspect", {
                peerId,
                source: conn,
                pc,
                failures,
                reasons: {
                    dataOpen: !!conn.open,
                    heartbeatFailed,
                    staleHeartbeat,
                    staleMs: typeof lastSeen === "number" && lastSeen > 0 ? now - lastSeen : null,
                    peerConnectionState: pc && pc.connectionState,
                    iceConnectionState: pc && pc.iceConnectionState
                }
            });
            if (failures < connectionRepairFailureLimit) continue;

            state.dataConnections.delete(peerId);
            clearDataConnectionRetry(peerId);
            conn.close();
            if (peerId === roomPeerId) {
                debugConnection("room-connection-repair", { peerId, failures });
                scheduleCoordinatorClaim(randomCoordinatorDelay());
            } else if (failures >= connectionAbandonFailureLimit) {
                debugConnection("peer-abandoned", { peerId, failures });
                abandonPeer(peerId);
            } else {
                debugConnection("data-reconnect-start", { peerId, failures });
                connectData(peerId, false);
            }
        }

        for (const peerId of [...state.knownPeers]) {
            if (connectedPeers.has(peerId) || state.abandonedPeers.has(peerId)) continue;
            const failures = (state.connectionFailureCounts.get(peerId) || 0) + 1;
            state.connectionFailureCounts.set(peerId, failures);
            debugConnection("known-peer-missing", { peerId, failures });
            if (failures >= connectionAbandonFailureLimit) {
                debugConnection("known-peer-abandoned", { peerId, failures });
                abandonPeer(peerId);
            } else if (failures >= connectionRepairFailureLimit) {
                connectData(peerId, false);
            }
        }

        for (const [key, call] of [...state.outboundCalls]) {
            const pc = findPeerConnection(call);
            if (!isPeerConnectionDead(pc)) continue;
            debugConnection("outbound-media-dead", { peerId: splitCallKey(key)[1], key, source: call, pc });
            state.outboundCalls.delete(key);
            call.close();
            const [kind, peerId] = splitCallKey(key);
            const stream = state.localStreams.get(kind);
            if (stream && state.dataConnections.has(peerId)) routeLocalStream(kind, stream, true);
        }

        for (const [key, call] of [...state.forwardedOutboundCalls]) {
            const pc = findPeerConnection(call);
            if (!isPeerConnectionDead(pc)) continue;
            const parts = splitForwardedCallKey(key);
            debugConnection("forwarded-media-dead", { peerId: parts && parts.targetPeerId, key, source: call, pc });
            state.forwardedOutboundCalls.delete(key);
            call.close();
            if (parts) updateForwardingTask(parts.sourcePeerId, parts.kind);
        }

        for (const [key, call] of [...state.inboundCalls]) {
            const pc = findPeerConnection(call);
            if (!isPeerConnectionDead(pc)) continue;
            debugConnection("inbound-media-dead", { peerId: splitCallKey(key)[1], key, source: call, pc });
            clearIncomingCall(key, call);
            call.close();
        }
    }

    function abandonPeer(peerId) {
        state.abandonedPeers.add(peerId);
        state.knownPeers.delete(peerId);
        state.connectionFailureCounts.delete(peerId);
        state.dataLastSeen.delete(peerId);
        state.expectedRemoteStreams.delete(peerId);
        clearPeerQualityState(peerId);
        clearMissingStreamRequestsForPeer(peerId);
        removePeerTiles(peerId);
    }

    function isPeerConnectionDead(pc) {
        if (!pc) return false;
        return [pc.connectionState, pc.iceConnectionState].some((stateValue) => stateValue === "failed" || stateValue === "closed");
    }

    function ensureLocalStreamsAreShared(force = false) {
        for (const [kind, stream] of state.localStreams) {
            const hasLiveTrack = stream.getTracks().some((track) => track.enabled && track.readyState === "live");
            if (!hasLiveTrack) continue;
            routeLocalStream(kind, stream, force);
        }
    }

    function refreshMediaElements() {
        for (const [id, config] of state.tileConfigs) {
            const tile = state.tiles.get(id);
            const video = tile && tile.querySelector("video");
            if (!tile || !video) continue;

            if (video.srcObject !== config.stream) video.srcObject = config.stream;
            ensureVideoPlayback(video);

            if (config.local) {
                updateLocalMediaPrompt(config);
            } else {
                if (config.stream.getAudioTracks().some((track) => track.enabled && track.readyState === "live") && video.muted && video.volume > 0) {
                    queueRemoteAudioUnlock(video);
                    unlockRemoteAudio();
                }
                updateRemotePlaybackPrompt(video);
            }
            updateVideoIndicator(id);
            updateMuteIndicator(id);
        }

        const cameraStream = state.localStreams.get("camera");
        if (cameraStream && !state.cameraRecoveryTimer) scheduleLocalCameraRenderCheck(cameraStream, 0);
    }

    function addRemoteStream(peerId, metadata, stream) {
        const kind = metadata && metadata.kind ? metadata.kind : "camera";
        if (metadata && metadata.displayName) {
            setPeerName(peerId, metadata.displayName);
        }
        addTile({
            id: tileId(peerId, kind),
            owner: remoteDisplayName(peerId, metadata),
            subtitle: kind === "screen" ? screenSubtitle(stream) : "Camera and microphone",
            kind,
            stream,
            muted: false,
            local: false
        });
        updatePeerStatus();
    }

    function addTile(config) {
        const oldTile = state.tiles.get(config.id);
        const oldFrame = oldTile ? {
            x: oldTile.offsetLeft,
            y: oldTile.offsetTop,
            width: oldTile.offsetWidth,
            height: oldTile.offsetHeight,
            placed: oldTile.dataset.placed === "true"
        } : null;

        removeTile(config.id);

        const fragment = els.tileTemplate.content.cloneNode(true);
        const tile = fragment.querySelector(".video-tile");
        const video = fragment.querySelector("video");
        const title = fragment.querySelector(".tile-title");
        const videoStateIcon = fragment.querySelector(".video-state-icon");
        const muteIcon = fragment.querySelector(".mute-icon");
        const settingsButton = fragment.querySelector(".tile-settings-button");
        const resizeHandle = document.createElement("span");
        const cameraSwitchButton = document.createElement("button");
        const isRemote = !config.local;
        const hasRemoteAudio = isRemote && config.stream.getAudioTracks().length > 0;
        const muteForAutoplay = hasRemoteAudio;

        tile.dataset.tileId = config.id;
        config.createdAt = Date.now();
        tile.classList.add(config.kind);
        tile.classList.toggle("preview", Boolean(config.preview));
        tile.classList.toggle("local-camera", config.local && config.kind === "camera");
        tile.style.zIndex = String(++state.zIndex);
        title.textContent = tileTitle(config);
        video.srcObject = config.stream;
        video.autoplay = true;
        video.setAttribute("autoplay", "");
        video.setAttribute("playsinline", "");
        video.playsInline = true;
        video.muted = config.muted || muteForAutoplay;
        video.defaultMuted = video.muted;
        video.dataset.remoteMedia = isRemote ? "true" : "false";
        video.dataset.remoteAudioMutedForAutoplay = muteForAutoplay ? "true" : "false";
        ensureVideoPlayback(video);
        if (muteForAutoplay) {
            queueRemoteAudioUnlock(video, false);
        }
        if (isRemote) bindRemoteAudioTrackEvents(config.stream, video);
        resizeHandle.className = "resize-handle";
        resizeHandle.title = "Resize video";
        resizeHandle.setAttribute("aria-hidden", "true");

        settingsButton.addEventListener("click", (event) => {
            event.stopPropagation();
            openFeedModal(config.id);
        });

        tile.addEventListener("dblclick", (event) => {
            if (isInteractiveControl(event.target)) return;
            toggleTileExpanded(tile);
        });
        tile.addEventListener("pointerdown", () => bringToFront(tile));
        bindTileDragging(tile, tile);
        bindTileResizing(tile, resizeHandle);

        if (config.local && config.kind === "camera" && shouldShowCameraSwitchControl()) {
            cameraSwitchButton.type = "button";
            cameraSwitchButton.className = "camera-switch-button";
            cameraSwitchButton.title = "Switch camera";
            cameraSwitchButton.setAttribute("aria-label", "Switch camera");
            cameraSwitchButton.textContent = "↺";
            cameraSwitchButton.addEventListener("click", (event) => {
                event.stopPropagation();
                switchLocalCameraFacing().catch((error) => {
                    setStatus(`Camera switch error: ${error.message}`);
                });
            });
            tile.appendChild(cameraSwitchButton);
        }

        if (config.preview) {
            const previewOverlay = document.createElement("div");
            const previewText = document.createElement("span");
            const previewButton = document.createElement("button");

            previewOverlay.className = "preview-overlay";
            previewText.textContent = "Preview only";
            previewButton.type = "button";
            previewButton.className = "primary";
            previewButton.textContent = "Share camera";
            previewButton.addEventListener("click", (event) => {
                event.stopPropagation();
                config.previewAction();
            });

            previewOverlay.append(previewText, previewButton);
            tile.appendChild(previewOverlay);
        }

        if (config.local) {
            tile.appendChild(createLocalMediaOverlay(config));
        }

        if (isRemote) {
            tile.appendChild(createRemotePlaybackOverlay(video));
        }

        tile.appendChild(resizeHandle);
        els.videos.appendChild(fragment);
        state.tiles.set(config.id, tile);
        state.tileConfigs.set(config.id, config);
        ensureVideoPlayback(video);
        if (muteForAutoplay) unlockRemoteAudio();
        if (videoStateIcon) {
            videoStateIcon.textContent = "🚫 Video off";
        }
        updateMuteIndicator(config.id);
        updateLocalTileState(config.id);
        updateVideoIndicator(config.id);
        updateLocalMediaPrompt(config);
        if (oldFrame && oldFrame.placed) {
            setTileFrame(tile, oldFrame.x, oldFrame.y, oldFrame.width, oldFrame.height);
        } else {
            placeTileWithoutOverlap(tile);
        }
        resolveOverlaps();
        applyFocus();
        syncFullscreenSelfView();
    }

    function toggleTracks(tracks) {
        if (!tracks.length) return;
        const nextEnabled = !tracks.some((track) => track.enabled);
        tracks.forEach((track) => {
            track.enabled = nextEnabled;
        });
    }

    function isEditableTarget(target) {
        const element = target instanceof Element ? target : null;
        if (!element) return false;
        return Boolean(element.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
    }

    function localMediaStreams() {
        return [...new Set([...state.localStreams.values(), ...state.previewStreams.values()])];
    }

    function refreshActiveFeedModal() {
        const id = state.activeFeedModalId;
        if (!id || !els.feedModal.open) return;
        const config = state.tileConfigs.get(id);
        const tile = state.tiles.get(id);
        if (!config || !tile) return;

        if (config.local) {
            renderFeedModal(config, tile);
            return;
        }

        refreshOpenFeedModal();
    }

    function toggleLocalMedia(kind) {
        const tracks = [];
        for (const stream of localMediaStreams()) {
            if (kind === "audio") {
                tracks.push(...stream.getAudioTracks());
            } else {
                tracks.push(...stream.getVideoTracks());
            }
        }

        if (!tracks.length) return false;

        toggleTracks(tracks);

        for (const [id, config] of state.tileConfigs) {
            if (!config.local) continue;
            updateLocalTileState(id);
            updateLocalMediaPrompt(config);
        }

        publishLocalStreamManifest(true);
        updateMediaButtons();
        refreshActiveFeedModal();
        return true;
    }

    function updateLocalTileState(id) {
        const tile = state.tiles.get(id);
        const config = state.tileConfigs.get(id);
        if (!tile || !config || !config.local) return;

        tile.classList.toggle("video-muted", !config.stream.getVideoTracks().some((track) => track.enabled));
        updateVideoIndicator(id);
        updateMuteIndicator(id);
        updateLocalMediaPrompt(config);
    }

    function updateLocalMediaPrompt(config) {
        if (!config || !config.local) return;
        const tile = state.tiles.get(config.id);
        const overlay = tile && tile.querySelector(".local-media-overlay");
        if (!tile || !overlay) return;

        const videoTracks = config.stream.getVideoTracks();
        const audioTracks = config.stream.getAudioTracks();
        const liveVideo = videoTracks.some((track) => track.enabled && track.readyState === "live");
        const liveAudio = audioTracks.some((track) => track.enabled && track.readyState === "live");
        const endedVideo = videoTracks.length > 0 && !videoTracks.some((track) => track.readyState === "live");
        const video = tile.querySelector("video");
        const shouldRender = config.kind === "camera" || config.kind === "screen";
        const stillStarting = Date.now() - (config.createdAt || 0) < 1800;
        const rendering = video ? isVideoElementRendering(video) : false;
        let message = "";

        if (!videoTracks.length) {
            if (config.kind === "screen" && liveAudio) {
                message = "Screen video is off. Audio is still shared.";
            } else {
                message = config.kind === "screen" ? "Tap to reshare screen" : "Tap to share camera";
            }
        } else if (endedVideo) {
            message = config.kind === "screen" ? "Screen share stopped. Tap to reshare." : "Camera stopped. Tap to restart.";
        } else if (config.kind === "screen" && !liveVideo && liveAudio) {
            message = "Screen video is muted. Audio is still shared.";
        } else if (liveVideo && shouldRender && !rendering && !stillStarting) {
            message = config.kind === "screen" ? "Screen looks stuck. Tap to reshare." : "Camera looks stuck. Tap to restart.";
        }

        overlay.classList.toggle("hidden", !message);
        overlay.textContent = message;
    }

    function updateTrackState(config, videoButton, audioButton) {
        const { kind, stream } = config;
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        const videoOn = videoTracks.some((track) => track.enabled);
        const audioOn = audioTracks.some((track) => track.enabled);

        if (kind === "screen") {
            videoButton.textContent = videoTracks.length === 0 ? "No screen video" : (videoOn ? "Mute screen video" : "Show screen video");
        } else {
            videoButton.textContent = videoTracks.length === 0 ? "No video" : (videoOn ? "Mute video" : "Show video");
        }
        audioButton.textContent = audioTracks.length === 0 ? "No audio" : kind === "screen" ? (audioOn ? "Mute audio" : "Unmute audio") : (audioOn ? "Mute mic" : "Unmute mic");

        videoButton.classList.toggle("danger", videoOn);
        audioButton.classList.toggle("danger", audioOn);
        videoButton.disabled = videoTracks.length === 0;
        audioButton.disabled = audioTracks.length === 0;
        updateLocalTileState(config.id);

        const tile = state.tiles.get(config.id);
        if (tile) {
            tile.classList.toggle("audio-muted", !audioOn);
        }

        updateMuteIndicator(config.id);
        updateFeedModalSubtitle(config);
    }

    function updateMuteIndicator(id) {
        const tile = state.tiles.get(id);
        const config = state.tileConfigs.get(id);
        if (!tile || !config) return;

        const muteIcon = tile.querySelector(".mute-icon");
        if (!muteIcon) return;

        const audioTracks = config.stream.getAudioTracks();
        const hasAudio = audioTracks.length > 0;
        const audioOn = audioTracks.some((track) => track.enabled && track.readyState === "live");
        const muted = hasAudio && !audioOn;

        tile.classList.toggle("audio-muted", muted);
        muteIcon.classList.toggle("hidden", !muted);
        muteIcon.disabled = true;
        muteIcon.textContent = "🔇";
        muteIcon.title = config.local
            ? (config.kind === "screen" ? "Screen audio muted" : "Microphone muted")
            : "Remote audio muted";
    }

    function updateVideoIndicator(id) {
        const tile = state.tiles.get(id);
        const config = state.tileConfigs.get(id);
        if (!tile || !config) return;

        const videoStateIcon = tile.querySelector(".video-state-icon");
        if (!videoStateIcon) return;

        const videoTracks = config.stream.getVideoTracks();
        const videoOn = videoTracks.some((track) => track.enabled && track.readyState === "live");
        const hidden = videoTracks.length > 0 && !videoOn;

        tile.classList.toggle("video-muted", hidden);
        videoStateIcon.classList.toggle("hidden", !hidden);
        videoStateIcon.title = hidden ? "Video hidden" : "Video shared";
        videoStateIcon.setAttribute("aria-label", videoStateIcon.title);
    }

    function shouldShowCameraSwitchControl() {
        return isMobileBrowser() || window.matchMedia("(pointer: coarse)").matches;
    }

    function localSubtitle(kind, stream, preview) {
        const hasVideo = stream.getVideoTracks().length > 0;
        const hasAudio = stream.getAudioTracks().length > 0;
        const videoOn = stream.getVideoTracks().some((track) => track.enabled);
        const audioOn = stream.getAudioTracks().some((track) => track.enabled);

        if (preview) {
            return "Preview only - not shared";
        }

        if (kind === "screen") {
            return screenSubtitle(stream);
        }

        if (!hasVideo && !hasAudio) return "No camera or microphone";
        if (!videoOn && !audioOn) return "Camera and microphone muted";
        if (!videoOn) return "Camera muted, microphone shared";
        if (!audioOn) return "Camera shared, microphone muted";
        return "Camera and microphone shared";
    }

    function openFeedModal(id) {
        const config = state.tileConfigs.get(id);
        const tile = state.tiles.get(id);
        if (!config || !tile) return;

        state.activeFeedModalId = id;
        renderFeedModal(config, tile);
        if (!els.feedModal.open) els.feedModal.showModal();
    }

    function refreshOpenFeedModal() {
        const id = state.activeFeedModalId;
        if (!id || !els.feedModal.open) return;
        const config = state.tileConfigs.get(id);
        const tile = state.tiles.get(id);
        if (!config || !tile) return;
        if (config.local) {
            renderFeedModal(config, tile);
            return;
        }
        updateFeedModalSubtitle(config);

        const peerId = splitCallKey(config.id)[0];
        const qualitySelect = els.feedModalControls.querySelector(".quality-select");
        if (qualitySelect) {
            populateQualitySelect(qualitySelect, remoteQualityPreference(peerId, config.kind), remoteQualityCap(peerId, config.kind));
        }
    }

    function renderFeedModal(config, tile) {
        els.feedModalTitle.textContent = tileTitle(config);
        els.feedModalControls.replaceChildren();
        updateFeedModalSubtitle(config);

        const focusButton = makeModalButton("Focus video", () => focusTile(config.id));
        els.feedModalControls.appendChild(focusButton);

        if (config.preview && typeof config.previewAction === "function") {
            els.feedModalControls.appendChild(makeModalButton("Share camera", config.previewAction, "primary"));
        }

        if (config.local) {
            els.feedModalControls.appendChild(createSenderQualityRow(config));

            if (config.kind === "screen") {
                const videoButton = makeModalButton("", () => {
                    toggleTracks(config.stream.getVideoTracks());
                    updateTrackState(config, videoButton, audioButton);
                });
                const audioButton = makeModalButton("", () => {
                    toggleTracks(config.stream.getAudioTracks());
                    updateTrackState(config, videoButton, audioButton);
                });
                updateTrackState(config, videoButton, audioButton);
                els.feedModalControls.append(videoButton, audioButton);
                els.feedModalControls.appendChild(makeModalButton("Manage screen sharing", openScreenShareManager));
                els.feedModalControls.appendChild(makeModalButton("Stop sharing", () => {
                    stopLocalStream("screen");
                    if (els.screenShareModal.open) els.screenShareModal.close();
                }, "danger"));
                return;
            }

            const videoButton = makeModalButton("Mute video", () => {
                toggleTracks(config.stream.getVideoTracks());
                updateTrackState(config, videoButton, audioButton);
            });
            const audioButton = makeModalButton("Mute mic", () => {
                toggleTracks(config.stream.getAudioTracks());
                updateTrackState(config, videoButton, audioButton);
            });

            updateTrackState(config, videoButton, audioButton);
            els.feedModalControls.append(videoButton, audioButton);
            return;
        }

        const video = tile.querySelector("video");
        const peerId = splitCallKey(config.id)[0];
        const qualityLabelRow = document.createElement("label");
        const qualityLabelText = document.createElement("span");
        const qualitySelect = document.createElement("select");
        qualityLabelRow.className = "setting-row";
        qualityLabelText.textContent = "Receive quality";
        qualitySelect.className = "quality-select";
        populateQualitySelect(qualitySelect, remoteQualityPreference(peerId, config.kind), remoteQualityCap(peerId, config.kind));
        qualitySelect.addEventListener("change", () => {
            const nextQuality = setRemoteQualityPreference(peerId, config.kind, qualitySelect.value);
            qualitySelect.value = nextQuality;
            updateFeedModalSubtitle(config);
        });
        qualityLabelRow.append(qualityLabelText, qualitySelect);

        const volumeLabel = document.createElement("label");
        const volumeText = document.createElement("span");
        const volume = document.createElement("input");
        volumeLabel.className = "volume-control";
        volumeText.textContent = "Audio";
        volume.type = "range";
        volume.className = "volume-slider";
        volume.min = "0";
        volume.max = "1";
        volume.step = "0.05";
        volume.value = String(video.volume || 1);
        volume.addEventListener("input", () => {
            video.volume = Number(volume.value);
            video.muted = video.volume === 0;
            if (video.muted) {
                pendingRemoteAudioElements.delete(video);
                video.dataset.remoteAudioMutedForAutoplay = "false";
            } else {
                queueRemoteAudioUnlock(video);
                unlockRemoteAudio();
            }
        });

        volumeLabel.append(volumeText, volume);
        els.feedModalControls.append(qualityLabelRow, volumeLabel);
    }

    function updateFeedModalSubtitle(config) {
        if (!config) return;
        if (config.local) {
            els.feedModalSubtitle.textContent = localSubtitle(config.kind, config.stream, Boolean(config.preview));
            return;
        }

        const peerId = splitCallKey(config.id)[0];
        const cap = remoteQualityCap(peerId, config.kind);
        const pref = remoteQualityPreference(peerId, config.kind);
        const effectivePref = cap !== "auto" && pref !== "auto" && qualityRank.get(pref) > qualityRank.get(cap) ? cap : pref;
        const suffix = cap === "auto" ? "Sender is using auto quality." : `Sender cap: ${qualityLabel(cap)}.`;
        const selection = effectivePref === "auto" ? "Receiving in auto mode." : `Selected: ${qualityLabel(effectivePref)}.`;
        els.feedModalSubtitle.textContent = `${config.subtitle} ${suffix} ${selection}`;
    }

    function createSenderQualityRow(config) {
        const row = document.createElement("label");
        row.className = "setting-row";

        const label = document.createElement("span");
        label.textContent = "Send quality";

        const select = document.createElement("select");
        const kind = config.kind === "screen" ? "screen" : "camera";
        const storedQuality = kind === "screen" ? state.screenSendQuality : state.cameraSendQuality;
        initQualitySelect(select, kind, storedQuality, (quality) => {
            if (kind === "screen") {
                state.screenSendQuality = quality;
                localStorage.setItem("vidChatScreenQuality", quality);
            } else {
                state.cameraSendQuality = quality;
                localStorage.setItem("vidChatCameraQuality", quality);
            }
            publishLocalStreamManifest(true);
            applyQualityPolicies(true);
            updateFeedModalSubtitle(config);
        });

        row.append(label, select);
        return row;
    }

    function makeModalButton(label, onClick, className) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        if (className) button.className = className;
        button.addEventListener("click", onClick);
        return button;
    }

    function removeTile(id) {
        const tile = state.tiles.get(id);
        if (!tile) return;
        const video = tile.querySelector("video");
        if (video) pendingRemoteAudioElements.delete(video);
        tile.remove();
        state.tiles.delete(id);
        state.tileConfigs.delete(id);
        if (state.focusedTileId === id) state.focusedTileId = null;
        applyFocus();
        syncFullscreenSelfView();
    }

    function removePeerTiles(peerId) {
        [...state.tiles.keys()]
            .filter((id) => id.startsWith(`${peerId}:`))
            .forEach((id) => removeTile(id));
    }

    function ensureVideoPlayback(video) {
        const tryPlay = () => {
            const playAttempt = video.play();
            if (!playAttempt || typeof playAttempt.catch !== "function") {
                updateRemotePlaybackPrompt(video);
                return;
            }
            if (playAttempt && typeof playAttempt.catch === "function") {
                playAttempt
                    .then(() => updateRemotePlaybackPrompt(video))
                    .catch(() => {
                        if (video.dataset.remoteMedia !== "true") return;
                        video.muted = true;
                        const mutedPlayAttempt = video.play();
                        if (!mutedPlayAttempt || typeof mutedPlayAttempt.catch !== "function") {
                            updateRemotePlaybackPrompt(video);
                            return;
                        }
                        mutedPlayAttempt
                            .then(() => updateRemotePlaybackPrompt(video))
                            .catch(() => setRemotePlaybackPrompt(video, "media"));
                    });
            }
        };

        video.addEventListener("loadedmetadata", tryPlay, { once: true });
        video.addEventListener("canplay", tryPlay, { once: true });
        tryPlay();
    }

    function isVideoElementRendering(video) {
        return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
            && video.videoWidth > 0
            && video.videoHeight > 0
            && !video.paused;
    }

    function unlockRemoteAudio() {
        for (const video of [...pendingRemoteAudioElements]) {
            if (!video.isConnected) continue;
            if (video.volume === 0) {
                pendingRemoteAudioElements.delete(video);
                setRemotePlaybackPrompt(video, "");
                continue;
            }

            video.muted = false;
            video.defaultMuted = false;
            const playAttempt = video.play();
            if (!playAttempt || typeof playAttempt.catch !== "function") {
                pendingRemoteAudioElements.delete(video);
                video.dataset.remoteAudioMutedForAutoplay = "false";
                setRemotePlaybackPrompt(video, "");
                continue;
            }

            playAttempt
                .then(() => {
                    pendingRemoteAudioElements.delete(video);
                    video.dataset.remoteAudioMutedForAutoplay = "false";
                    setRemotePlaybackPrompt(video, "");
                })
                .catch(() => {
                    video.muted = true;
                    setRemotePlaybackPrompt(video, "audio");
                    ensureVideoPlayback(video);
                });
        }
    }

    function queueRemoteAudioUnlock(video, showPrompt = true) {
        if (!video || video.dataset.remoteMedia !== "true" || video.volume === 0) return;
        video.dataset.remoteAudioMutedForAutoplay = "true";
        pendingRemoteAudioElements.add(video);
        if (showPrompt && video.muted) setRemotePlaybackPrompt(video, "audio");
    }

    function bindRemoteAudioTrackEvents(stream, video) {
        stream.getAudioTracks().forEach((track) => bindRemoteAudioTrack(track, video));
        stream.addEventListener("addtrack", (event) => {
            if (!event.track || event.track.kind !== "audio") return;
            bindRemoteAudioTrack(event.track, video);
            queueRemoteAudioUnlock(video);
            unlockRemoteAudio();
        });
    }

    function bindRemoteAudioTrack(track, video) {
        if (track.kind !== "audio" || boundRemoteAudioTracks.has(track)) return;
        boundRemoteAudioTracks.add(track);
        track.addEventListener("unmute", () => {
            queueRemoteAudioUnlock(video);
            unlockRemoteAudio();
        });
        track.addEventListener("ended", () => updateRemotePlaybackPrompt(video));
    }

    function createRemotePlaybackOverlay(video) {
        const overlay = document.createElement("button");
        overlay.type = "button";
        overlay.className = "remote-playback-overlay hidden";
        overlay.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (video.dataset.remoteAudioMutedForAutoplay === "true") {
                queueRemoteAudioUnlock(video);
                unlockRemoteAudio();
            }
            ensureVideoPlayback(video);
        });
        return overlay;
    }

    function updateRemotePlaybackPrompt(video) {
        if (video.dataset.remoteMedia !== "true") return;
        if (video.paused) {
            setRemotePlaybackPrompt(video, "media");
            return;
        }
        if (video.dataset.remoteAudioMutedForAutoplay === "true" && video.muted && video.volume > 0) {
            setRemotePlaybackPrompt(video, "audio");
            return;
        }
        setRemotePlaybackPrompt(video, "");
    }

    function setRemotePlaybackPrompt(video, mode) {
        const tile = video.closest(".video-tile");
        const overlay = tile ? tile.querySelector(".remote-playback-overlay") : null;
        if (!overlay) return;

        overlay.classList.toggle("hidden", !mode);
        overlay.classList.toggle("audio-only", mode === "audio");
        overlay.textContent = mode === "media" ? "Click to start video and audio" : mode === "audio" ? "Click for audio" : "";
    }

    function focusTile(id) {
        state.focusedTileId = state.focusedTileId === id ? null : id;
        if (state.focusedTileId) setLayout("spotlight");
        const tile = state.tiles.get(id);
        if (tile) bringToFront(tile);
        applyFocus();
    }

    function toggleTileExpanded(tile) {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            tile.requestFullscreen().catch((err) => {
                console.error(`Error attempting to enable full-screen mode: ${err.message}`);
                // Fallback to CSS expanded mode if requestFullscreen fails
                const alreadyExpanded = tile.classList.contains("expanded");
                for (const other of state.tiles.values()) {
                    other.classList.remove("expanded");
                }
                tile.classList.toggle("expanded", !alreadyExpanded);
                if (!alreadyExpanded) bringToFront(tile);
                syncFullscreenSelfView(tile.classList.contains("expanded") ? tile : null);
            });
        }
    }

    document.addEventListener("fullscreenchange", () => {
        const full = document.fullscreenElement;
        for (const tile of state.tiles.values()) {
            tile.classList.toggle("expanded", tile === full);
        }
        syncFullscreenSelfView(full);
    });

    function syncFullscreenSelfView(activeTile = currentExpandedTile()) {
        for (const tile of state.tiles.values()) {
            if (tile !== activeTile) removeSelfView(tile);
        }

        if (!activeTile || activeTile.classList.contains("local-camera")) {
            if (activeTile) removeSelfView(activeTile);
            return;
        }

        const localStream = state.localStreams.get("camera");
        if (!localStream || !localStream.getVideoTracks().some((track) => track.enabled && track.readyState === "live")) {
            removeSelfView(activeTile);
            return;
        }

        let selfView = activeTile.querySelector(".fullscreen-self-view");
        let video = selfView && selfView.querySelector("video");
        if (!selfView) {
            selfView = document.createElement("div");
            selfView.className = "fullscreen-self-view";
            video = document.createElement("video");
            video.autoplay = true;
            video.muted = true;
            video.defaultMuted = true;
            video.playsInline = true;
            const label = document.createElement("span");
            label.textContent = "You";
            selfView.append(video, label);
            if (shouldShowCameraSwitchControl()) {
                selfView.appendChild(createFullscreenSelfViewCameraSwitchButton());
            }
            activeTile.appendChild(selfView);
            bindFullscreenSelfViewDragging(selfView);
        }

        if (video.srcObject !== localStream) video.srcObject = localStream;
        selfView.classList.toggle("mirrored", state.mirrorLocalCamera);
        selfView.dataset.tileId = activeTile.dataset.tileId || "";
        applyFullscreenSelfViewPosition(selfView, activeTile);
        ensureVideoPlayback(video);
    }

    function currentExpandedTile() {
        if (document.fullscreenElement && document.fullscreenElement.classList.contains("video-tile")) {
            return document.fullscreenElement;
        }
        return [...state.tiles.values()].find((tile) => tile.classList.contains("expanded")) || null;
    }

    function removeSelfView(tile) {
        const selfView = tile && tile.querySelector(".fullscreen-self-view");
        if (!selfView) return;
        if (state.fullscreenSelfViewDrag && state.fullscreenSelfViewDrag.selfView === selfView) {
            state.fullscreenSelfViewDrag = null;
        }
        selfView.remove();
    }

    function createFullscreenSelfViewCameraSwitchButton() {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "fullscreen-self-view-switch";
        button.title = "Switch camera";
        button.setAttribute("aria-label", "Switch camera");
        button.textContent = "↺";
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            switchLocalCameraFacing().catch((error) => {
                setStatus(`Camera switch error: ${error.message}`);
            });
        });
        return button;
    }

    function bindFullscreenSelfViewDragging(selfView) {
        if (selfView.dataset.dragBound === "true") return;
        selfView.dataset.dragBound = "true";
        selfView.addEventListener("pointerdown", (event) => {
            if (isInteractiveControl(event.target)) return;
            startFullscreenSelfViewDrag(event, selfView);
        });
    }

    function startFullscreenSelfViewDrag(event, selfView) {
        const tile = selfView.closest(".video-tile");
        if (!tile) return;

        event.preventDefault();
        selfView.setPointerCapture(event.pointerId);

        const parentRect = tile.getBoundingClientRect();
        const viewRect = selfView.getBoundingClientRect();
        const start = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            left: viewRect.left - parentRect.left,
            top: viewRect.top - parentRect.top,
            width: viewRect.width,
            height: viewRect.height
        };

        state.fullscreenSelfViewDrag = { selfView, tile };
        selfView.classList.add("dragging");

        const move = (moveEvent) => {
            const nextLeft = clamp(start.left + (moveEvent.clientX - start.pointerX), 8, Math.max(8, parentRect.width - start.width - 8));
            const nextTop = clamp(start.top + (moveEvent.clientY - start.pointerY), 8, Math.max(8, parentRect.height - start.height - 8));
            selfView.style.left = `${nextLeft}px`;
            selfView.style.top = `${nextTop}px`;
            selfView.style.right = "auto";
            selfView.style.bottom = "auto";
            state.fullscreenSelfViewPositions.set(tile.dataset.tileId || "", {
                left: nextLeft,
                top: nextTop
            });
        };

        const stop = () => {
            selfView.classList.remove("dragging");
            selfView.removeEventListener("pointermove", move);
            selfView.removeEventListener("pointerup", stop);
            selfView.removeEventListener("pointercancel", stop);
            state.fullscreenSelfViewDrag = null;
        };

        selfView.addEventListener("pointermove", move);
        selfView.addEventListener("pointerup", stop);
        selfView.addEventListener("pointercancel", stop);
    }

    function applyFullscreenSelfViewPosition(selfView, activeTile) {
        const tileId = activeTile.dataset.tileId || "";
        const saved = state.fullscreenSelfViewPositions.get(tileId);
        if (saved) {
            selfView.style.left = `${saved.left}px`;
            selfView.style.top = `${saved.top}px`;
            selfView.style.right = "auto";
            selfView.style.bottom = "auto";
            return;
        }

        selfView.style.left = "";
        selfView.style.top = "";
        selfView.style.right = "";
        selfView.style.bottom = "";
    }

    function applyFocus() {
        for (const [id, tile] of state.tiles) {
            tile.classList.toggle("focused", id === state.focusedTileId);
        }
    }

    function setLayout(layout) {
        state.layout = layout;
        els.videos.classList.remove("grid", "spotlight", "filmstrip");
        els.videos.classList.add(layout);
        document.querySelectorAll(".layout-button").forEach((button) => {
            button.classList.toggle("active", button.dataset.layout === layout);
        });
        arrangeTiles(layout, true);
    }

    function keepTilesInsideStage() {
        for (const tile of state.tiles.values()) {
            setTileFrame(tile, tile.offsetLeft, tile.offsetTop, tile.offsetWidth, tile.offsetHeight);
        }
        resolveOverlaps();
    }

    function resolveOverlaps() {
        for (const tile of state.tiles.values()) {
            if (frameOverlaps(tile, currentFrame(tile))) {
                placeTileWithoutOverlap(tile);
            }
        }
    }

    function placeTileWithoutOverlap(tile) {
        const stage = stageRect();
        const width = Math.min(Math.max(tile.offsetWidth || 360, 120), Math.max(120, stage.width));
        const height = Math.min(Math.max(tile.offsetHeight || 240, 90), Math.max(90, stage.height));
        const frame = findOpenFrame(tile, { x: 0, y: 0, width, height });
        if (frame) {
            setTileFrame(tile, frame.x, frame.y, frame.width, frame.height, false);
            return;
        }
        arrangeTiles(state.layout, true);
    }

    function arrangeTiles(layout, force) {
        const tiles = [...state.tiles.values()];
        if (!tiles.length) return;

        const stage = stageRect();
        if (!stage.width || !stage.height) return;

        if (layout === "spotlight") {
            arrangeSpotlight(tiles, stage, force);
            return;
        }

        if (layout === "filmstrip") {
            arrangeFilmstrip(tiles, stage, force);
            return;
        }

        arrangeGrid(tiles, stage, force);
    }

    function arrangeGrid(tiles, stage, force) {
        const gap = 10;
        const columns = Math.max(1, Math.ceil(Math.sqrt(tiles.length)));
        const rows = Math.max(1, Math.ceil(tiles.length / columns));
        const tileWidth = Math.max(120, (stage.width - gap * (columns - 1)) / columns);
        const tileHeight = Math.max(90, (stage.height - gap * (rows - 1)) / rows);

        tiles.forEach((tile, index) => {
            if (!force && tile.dataset.placed === "true") return;
            const column = index % columns;
            const row = Math.floor(index / columns);
            setTileFrame(tile, column * (tileWidth + gap), row * (tileHeight + gap), tileWidth, tileHeight, false);
        });
    }

    function arrangeSpotlight(tiles, stage, force) {
        const gap = 10;
        const focused = state.focusedTileId ? state.tiles.get(state.focusedTileId) : tiles[0];
        const sideWidth = Math.min(280, Math.max(120, stage.width * 0.25));
        const mainWidth = tiles.length > 1 ? stage.width - sideWidth - gap : stage.width;
        const mainHeight = stage.height;

        if (focused && (force || focused.dataset.placed !== "true")) {
            setTileFrame(focused, 0, 0, mainWidth, mainHeight, false);
        }

        const sideTiles = tiles.filter((tile) => tile !== focused);
        const sideHeight = Math.max(90, (stage.height - gap * Math.max(0, sideTiles.length - 1)) / Math.max(1, sideTiles.length));
        sideTiles.forEach((tile, index) => {
            if (!force && tile.dataset.placed === "true") return;
            setTileFrame(tile, mainWidth + gap, index * (sideHeight + gap), sideWidth, sideHeight, false);
        });
    }

    function arrangeFilmstrip(tiles, stage, force) {
        const gap = 10;
        if (tiles.length * 120 + Math.max(0, tiles.length - 1) * gap > stage.width) {
            arrangeGrid(tiles, stage, force);
            return;
        }
        const tileWidth = Math.max(120, (stage.width - gap * Math.max(0, tiles.length - 1)) / Math.max(1, tiles.length));
        const tileHeight = Math.max(90, stage.height - gap);

        tiles.forEach((tile, index) => {
            if (!force && tile.dataset.placed === "true") return;
            setTileFrame(tile, index * (tileWidth + gap), 0, tileWidth, tileHeight, false);
        });
    }

    function bindTileDragging(tile, handle) {
        handle.addEventListener("pointerdown", (event) => {
            if (isInteractiveControl(event.target)) return;
            if (tile.classList.contains("expanded")) return;
            event.preventDefault();

            const start = pointerState(event, tile);
            let home = { x: start.x, y: start.y, width: start.width, height: start.height };
            let hasSwapped = false;

            bringToFront(tile);
            tile.classList.add("moving");
            els.videos.classList.add("dragging");
            handle.setPointerCapture(event.pointerId);

            const move = (moveEvent) => {
                const dx = moveEvent.clientX - start.clientX;
                const dy = moveEvent.clientY - start.clientY;
                const nextX = start.x + dx;
                const nextY = start.y + dy;

                const centerX = nextX + start.width / 2;
                const centerY = nextY + start.height / 2;

                for (const other of state.tiles.values()) {
                    if (other === tile) continue;
                    const otherFrame = currentFrame(other);

                    if (centerX > otherFrame.x && centerX < otherFrame.x + otherFrame.width &&
                        centerY > otherFrame.y && centerY < otherFrame.y + otherFrame.height) {

                        const targetFrame = { ...otherFrame };
                        setTileFrame(other, home.x, home.y, home.width, home.height, false);
                        home = targetFrame;
                        hasSwapped = true;
                        break;
                    }
                }

                setTileFrame(tile, nextX, nextY, start.width, start.height, false);
            };

            const stop = () => {
                tile.classList.remove("moving");
                els.videos.classList.remove("dragging");
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", stop);
                handle.removeEventListener("pointercancel", stop);

                if (hasSwapped) {
                    setTileFrame(tile, home.x, home.y, home.width, home.height, false);
                }
            };

            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", stop);
            handle.addEventListener("pointercancel", stop);
        });
    }

    function bindTileResizing(tile, handle) {
        handle.addEventListener("pointerdown", (event) => {
            if (tile.classList.contains("expanded")) return;
            event.preventDefault();
            event.stopPropagation();

            const start = pointerState(event, tile);
            bringToFront(tile);
            tile.classList.add("moving");
            els.videos.classList.add("resizing");
            handle.setPointerCapture(event.pointerId);

            const move = (moveEvent) => {
                const dx = moveEvent.clientX - start.clientX;
                const dy = moveEvent.clientY - start.clientY;
                setTileFrame(tile, start.x, start.y, start.width + dx, start.height + dy);
            };
            const stop = () => {
                tile.classList.remove("moving");
                els.videos.classList.remove("resizing");
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", stop);
                handle.removeEventListener("pointercancel", stop);
            };

            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", stop);
            handle.addEventListener("pointercancel", stop);
        });
    }

    function pointerState(event, tile) {
        return {
            clientX: event.clientX,
            clientY: event.clientY,
            x: tile.offsetLeft,
            y: tile.offsetTop,
            width: tile.offsetWidth,
            height: tile.offsetHeight
        };
    }

    function setTileFrame(tile, x, y, width, height, avoidOverlap = true) {
        const stage = stageRect();
        const minWidth = 120;
        const minHeight = 90;
        let frame = {
            width: clamp(width, minWidth, Math.max(minWidth, stage.width)),
            height: clamp(height, minHeight, Math.max(minHeight, stage.height))
        };
        frame.x = clamp(x, 0, Math.max(0, stage.width - frame.width));
        frame.y = clamp(y, 0, Math.max(0, stage.height - frame.height));

        if (avoidOverlap && frameOverlaps(tile, frame)) {
            frame = currentFrame(tile, stage);
        }

        const id = tile.dataset.tileId;
        if (id && state.tileConfigs.has(id)) {
            const cfg = state.tileConfigs.get(id);
            cfg.x = frame.x;
            cfg.y = frame.y;
            cfg.width = frame.width;
            cfg.height = frame.height;
        }

        tile.style.left = `${frame.x}px`;
        tile.style.top = `${frame.y}px`;
        tile.style.width = `${frame.width}px`;
        tile.style.height = `${frame.height}px`;
        tile.dataset.placed = "true";
    }

    function findOpenFrame(tile, frame) {
        const stage = stageRect();
        const step = 10;
        const maxX = Math.max(0, stage.width - frame.width);
        const maxY = Math.max(0, stage.height - frame.height);

        for (let y = 0; y <= maxY; y += step) {
            for (let x = 0; x <= maxX; x += step) {
                const candidate = { ...frame, x, y };
                if (!frameOverlaps(tile, candidate)) return candidate;
            }
        }

        return null;
    }

    function frameOverlaps(tile, frame) {
        for (const other of state.tiles.values()) {
            if (other === tile) continue;
            if (rectsOverlap(frame, currentFrame(other))) return true;
        }
        return false;
    }

    function currentFrame(tile, stage = stageRect()) {
        const id = tile.dataset.tileId;
        const cfg = id ? state.tileConfigs.get(id) : null;

        if (cfg && typeof cfg.x === "number") {
            return { x: cfg.x, y: cfg.y, width: cfg.width, height: cfg.height };
        }

        const width = clamp(tile.offsetWidth || 120, 120, Math.max(120, stage.width));
        const height = clamp(tile.offsetHeight || 90, 90, Math.max(90, stage.height));
        return {
            x: clamp(tile.offsetLeft || 0, 0, Math.max(0, stage.width - width)),
            y: clamp(tile.offsetTop || 0, 0, Math.max(0, stage.height - height)),
            width,
            height
        };
    }

    function rectsOverlap(a, b) {
        return a.x < b.x + b.width
            && a.x + a.width > b.x
            && a.y < b.y + b.height
            && a.y + a.height > b.y;
    }

    function stageRect() {
        const styles = getComputedStyle(els.videos);
        const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
        const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
        return {
            width: Math.max(0, els.videos.clientWidth - paddingX),
            height: Math.max(0, els.videos.clientHeight - paddingY)
        };
    }

    function bringToFront(tile) {
        tile.style.zIndex = String(++state.zIndex);
    }

    function isInteractiveControl(target) {
        return Boolean(target.closest("button, input, label, .resize-handle"));
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function broadcast(message, exceptPeerId) {
        for (const [peerId, conn] of state.dataConnections) {
            if (peerId !== exceptPeerId && conn.open) conn.send(message);
        }
    }

    function roomRoster(exceptPeerId) {
        const peers = new Set([...state.knownPeers, ...state.dataConnections.keys()]);
        peers.delete(exceptPeerId);
        peers.delete(roomPeerId);
        peers.delete(state.peer && state.peer.id);
        return [...peers].filter((peerId) => !state.abandonedPeers.has(peerId));
    }

    function randomCoordinatorDelay() {
        return 500 + Math.floor(Math.random() * 1200);
    }

    function closeCallsForPeer(peerId) {
        for (const [key, call] of state.outboundCalls) {
            if (key.endsWith(`:${peerId}`)) {
                clearMediaCallRetry(key);
                clearForwardingHandoffTimer(key);
                call.close();
                state.outboundCalls.delete(key);
            }
        }

        for (const [key, call] of state.inboundCalls) {
            if (key.endsWith(`:${peerId}`) || call.peer === peerId) {
                call.close();
                state.inboundCalls.delete(key);
            }
        }

        clearForwardingStateForPeer(peerId);
    }

    function splitCallKey(key) {
        const separator = key.indexOf(":");
        return [key.slice(0, separator), key.slice(separator + 1)];
    }

    async function updateConnectionSummary() {
        if (!els.connectionSummary) return;

        els.connectionSummaryMeta.textContent = "Refreshing WebRTC stats...";
        const entries = collectConnectionEntries();
        const summaries = await Promise.all(entries.map(readConnectionSummary));

        els.connectionSummary.replaceChildren();

        if (summaries.length === 0) {
            const empty = document.createElement("p");
            empty.className = "connection-empty";
            empty.textContent = "No peer connections yet.";
            els.connectionSummary.appendChild(empty);
            els.connectionSummaryMeta.textContent = "Start or join a call to see connection routes.";
            return;
        }

        summaries.forEach((summary) => els.connectionSummary.appendChild(renderConnectionSummary(summary)));
        const relayed = summaries.filter((summary) => summary.route === "turn").length;
        const staleEntries = summaries.filter((summary) => typeof summary.staleMs === "number");
        const staleCount = staleEntries.filter((summary) => summary.staleMs >= connectionStaleLimitMs).length;
        const failedCount = summaries.filter((summary) => summary.heartbeatFailed).length;
        const oldestStale = staleEntries.length ? Math.max(...staleEntries.map((summary) => summary.staleMs)) : null;
        const freshnessText = oldestStale == null
            ? (failedCount ? `${failedCount} heartbeat${failedCount === 1 ? "" : "s"} failed` : "freshness unavailable")
            : `${staleCount + failedCount} stale; oldest ${formatConnectionAge(oldestStale)}`;
        els.connectionSummaryMeta.textContent = `${summaries.length} connection${summaries.length === 1 ? "" : "s"}; ${relayed} using TURN relay; ${freshnessText}.`;
    }

    function collectConnectionEntries() {
        const entries = [];
        const seen = new Set();

        function add(label, peerId, kind, direction, source) {
            const pc = findPeerConnection(source);
            const key = pc || `${direction}:${kind}:${peerId}`;
            if (seen.has(key)) return;
            seen.add(key);
            entries.push({ label, peerId, kind, direction, pc, source });
        }

        for (const [peerId, conn] of state.dataConnections) {
            add("Data channel", peerId, "chat/data", "data", conn);
        }

        for (const [key, call] of state.outboundCalls) {
            const [kind, peerId] = splitCallKey(key);
            add(`${capitalize(kind)} sent`, peerId, kind, "outbound", call);
        }

        for (const [key, call] of state.forwardedOutboundCalls) {
            const parts = splitForwardedCallKey(key);
            if (!parts) continue;
            add(`${capitalize(parts.kind)} forwarded`, parts.targetPeerId, parts.kind, "outbound relay", call);
        }

        for (const [key, call] of state.inboundCalls) {
            const [kind, peerId] = splitCallKey(key);
            add(`${capitalize(kind)} received`, peerId, kind, "inbound", call);
        }

        return entries;
    }

    function findPeerConnection(source) {
        if (!source) return null;
        return source.peerConnection
            || source._pc
            || source.pc
            || (source.provider && source.provider._pc)
            || null;
    }

    async function readConnectionSummary(entry) {
        const lastSeenAt = state.dataLastSeen.get(entry.peerId);
        const heartbeatFailed = lastSeenAt === 0;
        const staleMs = typeof lastSeenAt === "number" && lastSeenAt > 0 ? Math.max(0, Date.now() - lastSeenAt) : null;
        const base = {
            ...entry,
            peerLabel: state.peerNames.get(entry.peerId) || shortPeer(entry.peerId),
            route: "unknown",
            state: "unknown",
            iceState: "unknown",
            local: null,
            remote: null,
            pair: null,
            audio: null,
            lastSeenAt: typeof lastSeenAt === "number" ? lastSeenAt : null,
            heartbeatFailed,
            staleMs,
            freshness: connectionFreshnessLabel(lastSeenAt),
            error: ""
        };

        if (!entry.pc || typeof entry.pc.getStats !== "function") {
            return { ...base, audio: mediaAudioSummary(entry, null), error: "WebRTC stats are not exposed for this PeerJS connection." };
        }

        try {
            const stats = await entry.pc.getStats();
            const pairInfo = selectedCandidatePair(stats);
            const route = candidateUsesTurn(pairInfo.local) || candidateUsesTurn(pairInfo.remote) ? "turn" : pairInfo.local || pairInfo.remote ? "direct" : "unknown";
            return {
                ...base,
                route,
                state: entry.pc.connectionState || entry.pc.iceConnectionState || "unknown",
                iceState: entry.pc.iceConnectionState || "unknown",
                local: pairInfo.local,
                remote: pairInfo.remote,
                pair: pairInfo.pair,
                audio: mediaAudioSummary(entry, stats)
            };
        } catch (error) {
            return { ...base, audio: mediaAudioSummary(entry, null), error: error.message || "Could not read WebRTC stats." };
        }
    }

    function selectedCandidatePair(stats) {
        let pair = null;

        stats.forEach((report) => {
            if (report.type === "transport" && report.selectedCandidatePairId) {
                pair = stats.get(report.selectedCandidatePairId) || pair;
            }
            if (report.type === "candidate-pair" && report.selected) {
                pair = report;
            }
        });

        if (!pair) {
            stats.forEach((report) => {
                if (report.type === "candidate-pair" && report.nominated && report.state === "succeeded") {
                    pair = report;
                }
            });
        }

        return {
            pair,
            local: pair ? stats.get(pair.localCandidateId) || null : null,
            remote: pair ? stats.get(pair.remoteCandidateId) || null : null
        };
    }

    function renderConnectionSummary(summary) {
        const item = document.createElement("article");
        item.className = `connection-card ${summary.route}`;
        item.classList.toggle("stale", summary.heartbeatFailed || (typeof summary.staleMs === "number" && summary.staleMs >= connectionStaleLimitMs));

        const header = document.createElement("div");
        header.className = "connection-card-header";

        const titleWrap = document.createElement("div");
        const title = document.createElement("h4");
        const subtitle = document.createElement("p");
        title.textContent = `${summary.peerLabel} - ${summary.label}`;
        subtitle.textContent = `${capitalize(summary.direction)} ${summary.kind} connection`;
        titleWrap.append(title, subtitle);

        const badge = document.createElement("span");
        badge.className = `route-badge ${summary.route}`;
        badge.textContent = routeLabel(summary.route);
        header.append(titleWrap, badge);

        const grid = document.createElement("dl");
        grid.className = "connection-detail-grid";
        addDetail(grid, "State", `${summary.state} / ICE ${summary.iceState}`);
        addDetail(grid, "Freshness", summary.freshness);
        addDetail(grid, "Local", candidateLabel(summary.local));
        addDetail(grid, "Remote", candidateLabel(summary.remote));
        addDetail(grid, "Traffic", trafficLabel(summary.pair));
        if (summary.audio) addDetail(grid, summary.audio.label, summary.audio.value);
        if (summary.error) addDetail(grid, "Stats", summary.error);

        item.append(header, grid);
        return item;
    }

    function addDetail(list, label, value) {
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        list.append(term, description);
    }

    function routeLabel(route) {
        if (route === "turn") return "TURN relay";
        if (route === "direct") return "Direct";
        return "Unknown";
    }

    function candidateLabel(candidate) {
        if (!candidate) return "Not selected yet";
        const type = candidate.candidateType || candidate.type || "unknown";
        const protocol = candidate.protocol || "unknown";
        const address = candidate.address || candidate.ip || candidate.url || "";
        const port = candidate.port ? `:${candidate.port}` : "";
        return `${type.toUpperCase()} over ${protocol.toUpperCase()}${address ? ` - ${address}${port}` : ""}`;
    }

    function trafficLabel(pair) {
        if (!pair) return "No selected pair yet";
        const sent = typeof pair.bytesSent === "number" ? formatBytes(pair.bytesSent) : "0 Bytes";
        const received = typeof pair.bytesReceived === "number" ? formatBytes(pair.bytesReceived) : "0 Bytes";
        const rtt = typeof pair.currentRoundTripTime === "number" ? `; RTT ${Math.round(pair.currentRoundTripTime * 1000)} ms` : "";
        return `${sent} sent, ${received} received${rtt}`;
    }

    function connectionFreshnessLabel(lastSeenAt) {
        if (lastSeenAt == null) return "No heartbeat yet";
        if (lastSeenAt === 0) return "Heartbeat check failed";

        const age = Math.max(0, Date.now() - lastSeenAt);
        if (age < 4000) return "Seen just now";
        if (age >= connectionStaleLimitMs) return `Stale for ${formatConnectionAge(age)}`;
        return `Seen ${formatConnectionAge(age)} ago`;
    }

    function formatConnectionAge(ms) {
        const totalSeconds = Math.max(0, Math.round(ms / 1000));
        if (totalSeconds < 5) return "just now";
        if (totalSeconds < 60) return `${totalSeconds}s`;

        const totalMinutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (totalMinutes < 60) {
            return seconds ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
        }

        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    function mediaAudioSummary(entry, stats) {
        if (entry.direction !== "inbound" || (entry.kind !== "camera" && entry.kind !== "screen")) return null;

        const config = state.tileConfigs.get(tileId(entry.peerId, entry.kind));
        const stream = config && config.stream;
        const tracks = stream ? stream.getAudioTracks() : [];
        const audioStats = inboundAudioStats(stats);
        const video = mediaElementForTile(entry.peerId, entry.kind);

        if (!tracks.length) {
            return audioStats
                ? { label: "Audio received", value: `No rendered audio track; RTP has ${formatBytes(audioStats.bytesReceived || 0)} received` }
                : { label: "Audio received", value: "No audio track on this stream" };
        }

        const liveTracks = tracks.filter((track) => track.readyState === "live").length;
        const enabledTracks = tracks.filter((track) => track.enabled).length;
        const packets = audioStats && typeof audioStats.packetsReceived === "number" ? audioStats.packetsReceived : 0;
        const bytes = audioStats && typeof audioStats.bytesReceived === "number" ? audioStats.bytesReceived : 0;
        const transport = audioStats
            ? packets > 0 || bytes > 0 ? `RTP receiving ${formatBytes(bytes)}` : "RTP selected, no audio packets yet"
            : "No inbound audio RTP stats yet";
        const playback = video
            ? video.muted ? "playback muted or waiting for click" : video.paused ? "video element paused" : "playback unmuted"
            : "no video element";

        return {
            label: "Audio received",
            value: `${enabledTracks}/${tracks.length} enabled, ${liveTracks}/${tracks.length} live; ${transport}; ${playback}`
        };
    }

    function inboundAudioStats(stats) {
        if (!stats) return null;
        let best = null;
        stats.forEach((report) => {
            if (report.type !== "inbound-rtp" || report.kind !== "audio") return;
            if (!best || (report.bytesReceived || 0) > (best.bytesReceived || 0)) best = report;
        });
        return best;
    }

    function mediaElementForTile(peerId, kind) {
        const tile = state.tiles.get(tileId(peerId, kind));
        return tile ? tile.querySelector("video") : null;
    }

    function candidateUsesTurn(candidate) {
        return Boolean(candidate && (candidate.candidateType === "relay" || candidate.type === "relay"));
    }

    function capitalize(value) {
        return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
    }

    function startConnectionSummaryUpdates() {
        updateConnectionSummary();
        if (state.connectionSummaryTimer) window.clearInterval(state.connectionSummaryTimer);
        state.connectionSummaryTimer = window.setInterval(updateConnectionSummary, 3000);
    }

    function stopConnectionSummaryUpdates() {
        if (!state.connectionSummaryTimer) return;
        window.clearInterval(state.connectionSummaryTimer);
        state.connectionSummaryTimer = null;
    }

    function bindUi() {
        document.addEventListener("pointerdown", unlockRemoteAudio, true);
        document.addEventListener("click", unlockRemoteAudio, true);
        document.addEventListener("keydown", unlockRemoteAudio, true);
        document.addEventListener("touchstart", unlockRemoteAudio, true);
        els.copyRoomLink.addEventListener("click", () => copyText(roomUrl(roomId), "Room link copied."));
        els.newRoom.addEventListener("click", () => {
            window.location.href = roomUrl(createRoomId());
        });
        els.cameraToggle.addEventListener("click", toggleCamera);
        els.screenToggle.addEventListener("click", toggleScreen);
        els.screenAudioMute.addEventListener("click", toggleScreenAudioMute);
        els.appSettingsButton.addEventListener("click", () => {
            startConnectionSummaryUpdates();
            els.appSettingsModal.showModal();
        });
        els.appSettingsModal.addEventListener("close", stopConnectionSummaryUpdates);
        els.screenShareModal.addEventListener("close", () => {
            refreshActiveFeedModal();
        });
        els.refreshConnections.addEventListener("click", updateConnectionSummary);
        els.displayName.value = state.displayName;
        els.displayName.addEventListener("change", () => updateDisplayName(els.displayName.value));
        els.displayName.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                updateDisplayName(els.displayName.value);
                els.displayName.blur();
            }
        });

        els.chatNameInput.value = state.chatName;
        els.chatNameInput.addEventListener("input", () => {
            state.chatName = els.chatNameInput.value || "MeliChat";
            localStorage.setItem("vidChatChatName", state.chatName);
            applyChatName();
        });

        els.customRoomId.value = roomId;
        els.customRoomId.addEventListener("input", () => {
            const sanitized = sanitizeRoomId(els.customRoomId.value);
            els.openCustomRoom.disabled = !sanitized || sanitized === roomId;
        });
        els.customRoomId.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            openCustomRoom();
        });
        els.openCustomRoom.addEventListener("click", openCustomRoom);
        els.openCustomRoom.disabled = true;

        els.bgColorInput.value = state.bgColor;
        els.bgColorInput.addEventListener("input", () => {
            state.bgColor = els.bgColorInput.value;
            localStorage.setItem("vidChatBgColor", state.bgColor);
            applyTheme();
        });

        els.bgImageInput.addEventListener("change", (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                state.bgImage = e.target.result;
                localStorage.setItem("vidChatBgImage", state.bgImage);
                applyTheme();
            };
            reader.readAsDataURL(file);
        });

        els.clearBgImage.addEventListener("click", () => {
            state.bgImage = "";
            localStorage.removeItem("vidChatBgImage");
            els.bgImageInput.value = "";
            applyTheme();
        });

        els.accentColorInput.value = state.accentColor;
        els.accentColorInput.addEventListener("input", () => {
            state.accentColor = els.accentColorInput.value;
            localStorage.setItem("vidChatAccentColor", state.accentColor);
            applyTheme();
        });

        els.mirrorLocalCamera.checked = state.mirrorLocalCamera;
        els.mirrorLocalCamera.addEventListener("change", () => {
            state.mirrorLocalCamera = els.mirrorLocalCamera.checked;
            localStorage.setItem("vidChatMirrorLocalCamera", String(state.mirrorLocalCamera));
            applyMirrorSetting();
        });
        els.streamForwardingEnabled.checked = state.streamForwardingEnabled;
        els.streamForwardingEnabled.addEventListener("change", () => {
            state.streamForwardingEnabled = els.streamForwardingEnabled.checked;
            localStorage.setItem("vidChatStreamForwarding", String(state.streamForwardingEnabled));
            broadcast({ type: "forwarding-capability", streamForwardingEnabled: state.streamForwardingEnabled });
            if (!state.streamForwardingEnabled) {
                clearAllForwardingTasks();
            }
            rebalanceStreamForwarding(true);
        });
        document.querySelectorAll("input[name='videoFit']").forEach((input) => {
            input.checked = input.value === state.videoFit;
            input.addEventListener("change", () => {
                if (!input.checked) return;
                state.videoFit = input.value;
                localStorage.setItem("vidChatVideoFit", state.videoFit);
                applyVideoFit();
            });
        });
        document.querySelectorAll(".layout-button").forEach((button) => {
            button.addEventListener("click", () => setLayout(button.dataset.layout));
        });

        els.openChat.addEventListener("click", () => {
            state.chatOpen = true;
            state.unreadCount = 0;
            updateChatBadge();
            els.chatModal.showModal();
            els.chatInput.focus();
        });

        els.chatModal.addEventListener("close", () => {
            state.chatOpen = false;
        });
        els.feedModal.addEventListener("close", () => {
            state.activeFeedModalId = null;
        });

        els.attachFile.addEventListener("click", () => els.fileInput.click());
        els.fileInput.addEventListener("change", (event) => {
            const file = event.target.files[0];
            if (!file) return;

            sendFile(file).finally(() => {
                els.fileInput.value = "";
            });
        });

        els.sendChat.addEventListener("click", sendChatMessage);
        els.chatInput.addEventListener("keydown", (event) => {
            const autocompleteVisible = !els.emojiAutocomplete.classList.contains("hidden");

            if (event.key === "Escape" && autocompleteVisible) {
                els.emojiAutocomplete.classList.add("hidden");
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            if ((event.key === "Enter" || event.key === "Tab") && autocompleteVisible) {
                const active = els.emojiAutocomplete.querySelector(".active");
                if (active) {
                    active.click();
                    event.preventDefault();
                    return;
                }
            }
            if (event.key === "Enter") {
                event.preventDefault();
                sendChatMessage();
            }
            if (event.key === "ArrowDown" && autocompleteVisible) {
                moveAutocompleteSelection(1);
                event.preventDefault();
            }
            if (event.key === "ArrowUp" && autocompleteVisible) {
                moveAutocompleteSelection(-1);
                event.preventDefault();
            }
        });

        els.chatInput.addEventListener("input", handleChatInput);
        els.chatInput.addEventListener("paste", handleChatPaste);

        document.addEventListener("pointerdown", (event) => {
            if (!event.target.closest(".autocomplete-wrapper")) {
                els.emojiAutocomplete.classList.add("hidden");
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                for (const tile of state.tiles.values()) {
                    tile.classList.remove("expanded");
                }
                syncFullscreenSelfView(null);
                return;
            }

            if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
            if (isEditableTarget(event.target)) return;

            const key = event.key.toLowerCase();
            if (key === "m") {
                if (toggleLocalMedia("audio")) event.preventDefault();
                return;
            }

            if (key === "v") {
                if (toggleLocalMedia("video")) event.preventDefault();
            }
        });
    }

    function applyVideoFit() {
        els.videos.classList.toggle("fit-cover", state.videoFit === "cover");
    }

    function applyMirrorSetting() {
        els.videos.classList.toggle("mirror-local-camera", state.mirrorLocalCamera);
        syncFullscreenSelfView();
    }

    function applyChatName() {
        els.brandName.textContent = state.chatName;
        document.title = state.chatName;
    }

    function applyTheme() {
        document.documentElement.style.setProperty("--bg", state.bgColor);
        document.documentElement.style.setProperty("--bg-image", state.bgImage ? `url(${state.bgImage})` : "none");
        document.documentElement.style.setProperty("--accent", state.accentColor);
    }

    function initQualitySelect(select, kind, value, onChange) {
        if (!select) return;
        populateQualitySelect(select, value, "auto");
        select.value = normalizeQuality(value);
        select.addEventListener("change", () => {
            const quality = normalizeQuality(select.value);
            select.value = quality;
            onChange(quality);
        });
    }

    function populateQualitySelect(select, selectedQuality, maxQuality = "auto") {
        if (!select) return;
        const normalizedSelected = normalizeQuality(selectedQuality);
        const normalizedMax = normalizeQuality(maxQuality);
        select.replaceChildren();

        for (const quality of qualityLevels) {
            const option = document.createElement("option");
            option.value = quality;
            option.textContent = qualityLabels[quality] || quality;
            option.disabled = normalizedMax !== "auto" && quality !== "auto" && qualityRank.get(quality) > qualityRank.get(normalizedMax);
            select.appendChild(option);
        }

        if (normalizedMax !== "auto" && normalizedSelected !== "auto" && qualityRank.get(normalizedSelected) > qualityRank.get(normalizedMax)) {
            select.value = normalizedMax;
        } else {
            select.value = normalizedSelected;
        }
    }

    function normalizeQuality(value) {
        return qualityRank.has(String(value)) ? String(value) : "auto";
    }

    function qualityLabel(value) {
        return qualityLabels[normalizeQuality(value)] || qualityLabels.auto;
    }

    function qualityProfile(kind, level) {
        const normalizedKind = kind === "screen" ? "screen" : "camera";
        const normalizedLevel = normalizeQuality(level);
        if (normalizedLevel === "auto") return null;
        return qualityProfiles[normalizedKind][normalizedLevel] || null;
    }

    function localStreamQualityCap(kind) {
        return normalizeQuality(kind === "screen" ? state.screenSendQuality : state.cameraSendQuality);
    }

    function remoteQualityKey(peerId, kind) {
        return `${peerId}:${kind}`;
    }

    function remoteQualityPreference(peerId, kind) {
        return normalizeQuality(state.remoteQualityPreferences.get(remoteQualityKey(peerId, kind)) || "auto");
    }

    function remoteQualityCap(peerId, kind) {
        return normalizeQuality(state.remoteQualityCaps.get(remoteQualityKey(peerId, kind)) || "auto");
    }

    function setRemoteQualityPreference(peerId, kind, quality, send = true) {
        const key = remoteQualityKey(peerId, kind);
        const cap = remoteQualityCap(peerId, kind);
        const normalized = normalizeQuality(quality);
        const nextQuality = cap !== "auto" && normalized !== "auto" && qualityRank.get(normalized) > qualityRank.get(cap) ? cap : normalized;
        state.remoteQualityPreferences.set(key, nextQuality);
        if (send) {
            sendToPeer(peerId, { type: "quality-preference", kind, quality: nextQuality });
        }
        return nextQuality;
    }

    function refreshOpenFeedModal() {
        const id = state.activeFeedModalId;
        if (!id || !els.feedModal.open) return;
        const config = state.tileConfigs.get(id);
        const tile = state.tiles.get(id);
        if (!config || !tile) return;
        renderFeedModal(config, tile);
    }

    function autoQualityForConnection(kind, stats) {
        const pair = selectedCandidatePair(stats);
        const outbound = outboundVideoStats(stats);
        if (!pair.pair || !outbound) return "high";
        const rtt = pair.pair && typeof pair.pair.currentRoundTripTime === "number" ? pair.pair.currentRoundTripTime * 1000 : 0;
        const available = pair.pair && typeof pair.pair.availableOutgoingBitrate === "number" ? pair.pair.availableOutgoingBitrate : 0;
        const packetsSent = outbound && typeof outbound.packetsSent === "number" ? outbound.packetsSent : 0;
        const packetsLost = outbound && typeof outbound.packetsLost === "number" ? outbound.packetsLost : 0;
        const loss = packetsSent + packetsLost > 0 ? packetsLost / (packetsSent + packetsLost) : 0;
        const lowFloor = kind === "screen" ? 600000 : 300000;
        const mediumFloor = kind === "screen" ? 1200000 : 700000;
        const highFloor = kind === "screen" ? 2500000 : 1400000;

        if (loss > 0.12 || rtt > 550 || (available && available < lowFloor)) return "low";
        if (loss > 0.06 || rtt > 350 || (available && available < mediumFloor)) return "medium";
        if (loss > 0.02 || rtt > 220 || (available && available < highFloor)) return "high";
        return "max";
    }

    function outboundVideoStats(stats) {
        if (!stats) return null;
        let best = null;
        stats.forEach((report) => {
            if (report.type !== "outbound-rtp" || report.kind !== "video") return;
            if (!best || (report.bytesSent || 0) > (best.bytesSent || 0)) best = report;
        });
        return best;
    }

    function resolveOutboundQuality(kind, peerId, stats) {
        const requested = remoteQualityPreference(peerId, kind);
        const localCap = localStreamQualityCap(kind);
        const target = requested === "auto" ? autoQualityForConnection(kind, stats) : requested;
        if (localCap !== "auto" && qualityRank.get(target) > qualityRank.get(localCap)) {
            return localCap;
        }
        return target;
    }

    function toggleScreenAudioMute() {
        const stream = state.localStreams.get("screen");
        if (!stream) return;

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) return;

        const nextEnabled = !audioTracks.some(t => t.enabled);
        audioTracks.forEach(t => t.enabled = nextEnabled);

        const tile = state.tiles.get(tileId("local", "screen"));
        if (tile) {
            tile.classList.toggle("audio-muted", !nextEnabled);
        }

        updateMediaButtons();
    }

    function updateMediaButtons() {
        const hasCamera = state.localStreams.has("camera") || state.previewStreams.has("camera");
        const screenOn = state.localStreams.has("screen");
        const screenStream = state.localStreams.get("screen");
        const screenHasVideo = screenStream && screenStream.getVideoTracks().some((track) => track.enabled && track.readyState === "live");
        const hasScreenAudio = screenStream && screenStream.getAudioTracks().length > 0;
        const screenAudioMuted = hasScreenAudio && !screenStream.getAudioTracks().some(t => t.enabled);
        const screenAudioOnly = screenOn && !screenHasVideo && hasScreenAudio && !screenAudioMuted;

        els.cameraToggle.disabled = false;
        els.cameraToggle.textContent = hasCamera ? "Remove Video" : "Share Camera/Mic";
        els.cameraToggle.classList.toggle("danger", hasCamera);

        els.screenToggle.textContent = screenOn ? (screenAudioOnly ? "Screen Audio Only" : "Screen Sharing") : "Share screen";
        els.screenToggle.title = screenOn ? "Manage screen sharing" : "Share screen";
        els.screenToggle.classList.toggle("danger", false);
        els.screenToggle.classList.toggle("primary", screenOn);

        els.screenAudioMute.classList.toggle("hidden", !screenOn || !hasScreenAudio);
        els.screenAudioMute.textContent = screenAudioMuted ? "Unmute Screen" : "Mute Screen";
        els.screenAudioMute.classList.toggle("danger", !screenAudioMuted && hasScreenAudio);
    }

    function updateDisplayName(value) {
        const nextName = sanitizeDisplayName(value) || "Guest";
        state.displayName = nextName;
        localStorage.setItem("vidChatDisplayName", nextName);
        els.displayName.value = nextName;
        broadcast({ type: "name-changed", displayName: nextName });
        setStatus(`Name updated to ${nextName}.`);
    }

    function openCustomRoom() {
        const nextRoomId = sanitizeRoomId(els.customRoomId.value);
        if (!nextRoomId) {
            setStatus("Enter a room ID with letters, numbers, or spaces.");
            return;
        }
        if (nextRoomId === roomId) {
            els.openCustomRoom.disabled = true;
            setStatus(`Already in room ${roomId}.`);
            return;
        }

        window.location.href = roomUrl(nextRoomId);
    }

    function setPeerName(peerId, displayName) {
        const nextName = sanitizeDisplayName(displayName);
        if (!nextName) return;

        state.peerNames.set(peerId, nextName);
        for (const [id, config] of state.tileConfigs) {
            if (!id.startsWith(`${peerId}:`)) continue;
            config.owner = nextName;
            updateTileTitle(id);
        }
    }

    function updateTileTitle(id) {
        const tile = state.tiles.get(id);
        const config = state.tileConfigs.get(id);
        if (!tile || !config) return;

        const title = tile.querySelector(".tile-title");
        if (title) title.textContent = tileTitle(config);
    }

    function tileTitle(config) {
        return `${config.owner} - ${config.kind === "screen" ? "Screen" : "Camera"}`;
    }

    function remoteDisplayName(peerId, metadata) {
        return sanitizeDisplayName(metadata && metadata.displayName)
            || state.peerNames.get(peerId)
            || shortPeer(peerId);
    }

    function updatePeerStatus() {
        const count = [...state.dataConnections.keys()].filter((peerId) => peerId !== roomPeerId).length;
        const role = state.isHost ? "coordinating room" : "connected";
        setStatus(`${role}; ${count} peer${count === 1 ? "" : "s"} in direct reach.`);
    }

    async function copyText(text, message) {
        try {
            await navigator.clipboard.writeText(text);
            setStatus(message);
        } catch (error) {
            setStatus("Copy failed. Use the URL in the address bar.");
        }
    }

    function setStatus(message) {
        els.status.textContent = message;
    }

    function screenSubtitle(stream) {
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        const videoOn = videoTracks.some((track) => track.enabled && track.readyState === "live");
        const audioOn = audioTracks.some((track) => track.enabled && track.readyState === "live");

        if (!videoTracks.length) {
            return audioOn ? "Screen video off. Audio still shared." : "Screen share stopped.";
        }
        if (!videoOn && audioOn) return "Screen video muted. Audio still shared.";
        if (!videoOn && !audioOn) return "Screen and audio muted.";
        if (videoOn && !audioOn) return "Screen video shared, audio muted.";
        return "Screen video shared with audio.";
    }

    function tileId(peerId, kind) {
        return `${peerId}:${kind || "camera"}`;
    }

    function shortPeer(peerId) {
        if (peerId === roomPeerId) return "Room";
        return peerId.length > 12 ? `${peerId.slice(0, 6)}...${peerId.slice(-4)}` : peerId;
    }

    function roomUrl(id) {
        const url = new URL(window.location.href);
        url.search = "";
        url.hash = "";
        url.searchParams.set("room", id);
        return url.toString();
    }

    function updateUrl(id) {
        window.history.replaceState(null, "", roomUrl(id));
    }

    function createRoomId() {
        return `${randomRoomWord(roomAdjectives)}-${randomRoomWord(roomNouns)}`;
    }

    function randomRoomWord(words) {
        const values = new Uint32Array(1);
        crypto.getRandomValues(values);
        return words[values[0] % words.length];
    }

    function ensureDisplayName() {
        const storedName = sanitizeDisplayName(localStorage.getItem("vidChatDisplayName"));
        if (storedName) return storedName;

        const promptedName = sanitizeDisplayName(window.prompt("What name should appear on your video?", ""));
        const displayName = promptedName || "Guest";
        localStorage.setItem("vidChatDisplayName", displayName);
        return displayName;
    }

    function sanitizeDisplayName(value) {
        if (!value) return "";
        return String(value).replace(/\s+/g, " ").trim().slice(0, 32);
    }

    function sanitizeRoomId(value) {
        if (!value) return "";
        return String(value)
            .toLowerCase()
            .trim()
            .replace(/['"]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48);
    }

    function peerOptions() {
        return {
            debug: 1,
            config: {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    { urls: "stun:stun1.l.google.com:19302" },
                    { urls: "stun:stun2.l.google.com:19302" },
                    {
                        urls: [
                            "turn:pi.mckeown.in:45873?transport=udp",
                            "turn:pi.mckeown.in:45873?transport=tcp"
                        ],
                        username: "jack",
                        credential: "iWHaJ5MsaW7dFlvN2YuW+c0DPN+4eNNt"
                    }
                ]
            }
        };
    }

})();
