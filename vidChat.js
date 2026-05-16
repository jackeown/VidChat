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
        cameraRecoveryAttempts: 0,
        cameraRecoveryTimer: null,
        healthTimer: null,
        networkRecoveryTimer: null,
        focusedTileId: null,
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
        const key = `${kind}:${call.peer}`;
        const oldCall = state.inboundCalls.get(key);
        state.inboundCalls.set(key, call);
        if (oldCall && oldCall !== call) oldCall.close();

        call.answer();
        call.on("stream", (stream) => {
            if (state.inboundCalls.get(key) !== call) return;
            addRemoteStream(call.peer, call.metadata, stream);
        });
        call.on("close", () => clearIncomingCall(key, call));
        call.on("error", () => clearIncomingCall(key, call));
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
            conn.send({ type: "hello", peerId: state.peer.id, displayName: state.displayName });
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
            state.dataLastSeen.delete(conn.peer);
            clearMissingStreamRequestsForPeer(conn.peer);
            closeCallsForPeer(conn.peer);
            failIncomingFilesForPeer(conn.peer, "Transfer interrupted.");
            failOutgoingFilesForPeer(conn.peer, "Peer disconnected during transfer.");
            removePeerTiles(conn.peer);
            if (state.isHost && coordinatorConnection) broadcast({ type: "peer-left", peerId: conn.peer });
            if (conn.peer === roomPeerId) {
                scheduleCoordinatorClaim(randomCoordinatorDelay());
            }
            updatePeerStatus();
        });
        conn.on("error", () => {
            if (state.dataConnections.get(conn.peer) !== conn) return;
            state.dataConnections.delete(conn.peer);
            state.dataLastSeen.delete(conn.peer);
            clearMissingStreamRequestsForPeer(conn.peer);
            failIncomingFilesForPeer(conn.peer, "Transfer failed.");
            failOutgoingFilesForPeer(conn.peer, "Peer connection failed during transfer.");
            if (conn.peer === roomPeerId) {
                scheduleCoordinatorClaim(randomCoordinatorDelay());
            }
            updatePeerStatus();
        });
    }

    function handleMessage(peerId, message) {
        if (!message || typeof message !== "object") return;

        if (message.displayName) {
            setPeerName(peerId, message.displayName);
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
                    } else if (msg.type === "file" && msg.data) {
                        addFileMessage(msg.peerId, msg.name, msg.size, msg.data, msg.timestamp);
                    }
                });
            }
            return;
        }

        if (message.type === "coordinator-changed") {
            if (message.peerId && message.peerId !== state.peer.id) connectData(roomPeerId, true);
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
            removePeerTiles(message.peerId);
            updatePeerStatus();
            return;
        }

        if (message.type === "stream-stopped") {
            forgetExpectedRemoteStream(peerId, message.kind);
            removeTile(tileId(peerId, message.kind));
            return;
        }

        if (message.type === "name-changed") {
            setPeerName(peerId, message.displayName);
        }

        if (message.type === "chat") {
            addChatMessage(peerId, message.text, message.timestamp);
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
        const msg = { type: "chat", text, timestamp: Date.now() };
        addChatMessage("local", msg.text, msg.timestamp);
        broadcast(msg);
    }

    function addChatMessage(peerId, text, timestamp) {
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

    function linkify(text) {
        // Escape HTML to prevent XSS before adding our own <a> tags
        const div = document.createElement("div");
        div.textContent = text;
        const escapedText = div.innerHTML;

        const urlPattern = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        return escapedText.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
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
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.className = "file-link";
        link.innerHTML = `<span>📁 ${name}</span> <span class="file-info">(${formatBytes(size)})</span>`;
        
        contentEl.appendChild(link);
        messageEl.append(authorEl, contentEl);
        els.chatHistory.appendChild(messageEl);
        els.chatHistory.scrollTop = els.chatHistory.scrollHeight;

        state.chatHistory.push({ peerId, author, name, size, timestamp, type: "file" });

        if (!local && !state.chatOpen) {
            state.unreadCount++;
            updateChatBadge();
        }
    }

    // ... rest of file unchanged until toggleScreen definition ...

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
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            state.cameraRecoveryAttempts = 0;
            state.localStreams.set("camera", stream);
            addCameraTile(stream, false);
            sendLocalStreamToAll("camera", stream);
            publishLocalStreamManifest(true);
            setStatus("Camera and microphone are now shared.");
        } catch (error) {
            setStatus(`Camera error: ${error.message}`);
        } finally {
            updateMediaButtons();
        }
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

    // Improved toggleScreen: detect support and show helpful instructions on mobile when unsupported
    async function toggleScreen() {
        if (state.localStreams.has("screen")) {
            stopLocalStream("screen");
            return;
        }

        // Feature detection
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") {
            // getDisplayMedia not available at all
            showScreenShareUnsupported();
            return;
        }

        // On mobile browsers, support is partial. Allow Android Chrome (likely supported) but show guidance for others
        if (isMobile() && !mobileScreenCaptureLikelySupported()) {
            showMobileScreenShareInstructions();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });
            addLocalStream("screen", stream);
            if (stream.getVideoTracks().length) {
                stream.getVideoTracks()[0].addEventListener("ended", () => stopLocalStream("screen"));
            }
        } catch (error) {
            // If the user is on a mobile browser that rejects the call, give a clearer message
            if (isMobile()) {
                showMobileScreenShareInstructions(error);
            } else {
                setStatus(`Screen share error: ${error.message}`);
            }
        }
    }

    function isMobile() {
        return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    }

    function isAndroidChrome() {
        const ua = navigator.userAgent || "";
        return /Android/i.test(ua) && /Chrome\/[0-9]+/i.test(ua) && !/OPR|Edg|SamsungBrowser/i.test(ua);
    }

    function mobileScreenCaptureLikelySupported() {
        // Conservative heuristics: Android Chrome over HTTPS is likely to support getDisplayMedia.
        if (!isMobile()) return true;
        if (isAndroidChrome()) return (location.protocol === 'https:' || location.hostname === 'localhost');
        // iOS Safari and many other mobile browsers do not support screen capture via getDisplayMedia.
        return false;
    }

    function showScreenShareUnsupported() {
        setStatus("Screen sharing is not available in this browser. Use a desktop browser or a mobile browser that supports screen capture (e.g. Chrome on Android over HTTPS).");
    }

    function showMobileScreenShareInstructions(error) {
        // Provide actionable guidance for mobile users
        let message = "Screen sharing from mobile browsers is limited.";
        message += " On iOS (Safari) screen capture via the browser is not supported.";
        message += " On Android, use Chrome (recent versions) over HTTPS and tap \"Share screen\" when prompted.";
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            message += " Also ensure the site is loaded over HTTPS — screen capture is only allowed in secure contexts.";
        }
        if (error && error.message) {
            message += ` Error: ${error.message}`;
        }
        setStatus(message);
    }

    function addLocalStream(kind, stream) {
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

    async function restartLocalCameraStream(oldStream) {
        if (state.localStreams.get("camera") !== oldStream) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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
                call.close();
                state.outboundCalls.delete(key);
            }
        }
    }

    function sendLocalStreamToAll(kind, stream) {
        for (const peerId of state.dataConnections.keys()) {
            callPeer(peerId, kind, stream);
        }
    }

    function sendLocalStreamsTo(peerId) {
        for (const [kind, stream] of state.localStreams) {
            callPeer(peerId, kind, stream);
        }
    }

    function callPeer(peerId, kind, stream, attempt = 0) {
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
                hasAudio: stream.getAudioTracks().length > 0
            }
        });

        state.outboundCalls.set(key, call);
        call.on("close", () => clearOutboundCall(key, call, stream, attempt));
        call.on("error", () => clearOutboundCall(key, call, stream, attempt));
    }

    function clearOutboundCall(key, call, stream, attempt) {
        if (state.outboundCalls.get(key) !== call) return;
        state.outboundCalls.delete(key);
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
                callPeer(peerId, kind, stream, attempt);
            }
        }, delay);
        state.callRetryTimers.set(key, timer);
    }

    function clearMediaCallRetry(key) {
        const timer = state.callRetryTimers.get(key);
        if (timer) window.clearTimeout(timer);
        state.callRetryTimers.delete(key);
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
        window.setTimeout(() => {
            ensureRoomCoordinatorReachable();
            reconnectKnownPeers();
            ensureLocalStreamsAreShared(true);
            repairDeadConnections();
        }, 1800);
        window.setTimeout(() => {
            ensureRoomCoordinatorReachable();
            reconnectKnownPeers();
            ensureLocalStreamsAreShared(true);
            repairDeadConnections();
        }, 4500);
        updatePeerStatus();
    }

    function recoverPeerConnection() {
        if (!state.peer || state.peer.destroyed) return;
        if (state.peer.disconnected && typeof state.peer.reconnect === "function") {
            try {
                state.peer.reconnect();
            } catch (error) {
                setStatus(`Reconnect error: ${error.message}`);
            }
        }
    }

    function recoverCoordinatorPeer() {
        if (!state.coordinatorPeer || state.coordinatorPeer.destroyed) return;
        if (state.coordinatorPeer.disconnected && typeof state.coordinatorPeer.reconnect === "function") {
            try {
                state.coordinatorPeer.reconnect();
            } catch (error) {
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
                state.dataLastSeen.set(peerId, 0);
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
            conn.send({ type: "peer-sync", peers, timestamp: now });
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
                hasAudio: stream.getAudioTracks().some((track) => track.readyState === "live")
            }));
    }

    function handleStreamManifest(peerId, message) {
        if (!Array.isArray(message.streams)) return;
        const expected = new Set();
        for (const streamInfo of message.streams) {
            if (!streamInfo || !streamInfo.kind) continue;
            expected.add(streamInfo.kind);
            state.abandonedStreams.delete(expectedRemoteStreamKey(peerId, streamInfo.kind));
            trackExpectedRemoteStream(peerId, streamInfo.kind);
        }
        state.expectedRemoteStreams.set(peerId, expected);
        clearUnexpectedRemoteStreamExpectations(peerId, expected);
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
                    requestRemoteStream(peerId, kind, "health-check");
                } else if (failures >= 12) {
                    state.abandonedStreams.add(key);
                    state.streamFailureCounts.delete(key);
                    state.missingStreamRequests.delete(key);
                }
            }
        }
    }

    function requestRemoteStream(peerId, kind, reason) {
        const key = `${peerId}:${kind}`;
        const now = Date.now();
        if (now - (state.missingStreamRequests.get(key) || 0) < 10000) return;
        state.missingStreamRequests.set(key, now);
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
            call.close();
            state.outboundCalls.delete(key);
        }

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
            const lastSeen = state.dataLastSeen.get(peerId) || now;
            const staleHeartbeat = now - lastSeen > 4500;
            const failed = !conn.open || staleHeartbeat || isPeerConnectionInterrupted(findPeerConnection(conn));
            if (!failed) {
                if (peerId !== roomPeerId) state.connectionFailureCounts.delete(peerId);
                continue;
            }

            const failures = (state.connectionFailureCounts.get(peerId) || 0) + 1;
            state.connectionFailureCounts.set(peerId, failures);
            if (failures < 3) continue;

            state.dataConnections.delete(peerId);
            state.dataLastSeen.delete(peerId);
            state.expectedRemoteStreams.delete(peerId);
            clearMissingStreamRequestsForPeer(peerId);
            conn.close();
            closeCallsForPeer(peerId);
            if (peerId === roomPeerId) {
                scheduleCoordinatorClaim(randomCoordinatorDelay());
            } else if (failures >= 12) {
                abandonPeer(peerId);
            } else {
                connectData(peerId, false);
            }
        }

        for (const peerId of [...state.knownPeers]) {
            if (connectedPeers.has(peerId) || state.abandonedPeers.has(peerId)) continue;
            const failures = (state.connectionFailureCounts.get(peerId) || 0) + 1;
            state.connectionFailureCounts.set(peerId, failures);
            if (failures >= 12) {
                abandonPeer(peerId);
            } else if (failures >= 3) {
                connectData(peerId, false);
            }
        }

        for (const [key, call] of [...state.outboundCalls]) {
            if (!isPeerConnectionDead(findPeerConnection(call))) continue;
            state.outboundCalls.delete(key);
            call.close();
            const [kind, peerId] = splitCallKey(key);
            const stream = state.localStreams.get(kind);
            if (stream && state.dataConnections.has(peerId)) callPeer(peerId, kind, stream);
        }

        for (const [key, call] of [...state.inboundCalls]) {
            if (!isPeerConnectionDead(findPeerConnection(call))) continue;
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
        clearMissingStreamRequestsForPeer(peerId);
        removePeerTiles(peerId);
    }

    function isPeerConnectionDead(pc) {
        if (!pc) return false;
        const stateValue = pc.connectionState || pc.iceConnectionState;
        return stateValue === "failed" || stateValue === "closed";
    }

    function isPeerConnectionInterrupted(pc) {
        if (!pc) return false;
        const stateValue = pc.connectionState || pc.iceConnectionState;
        return stateValue === "failed" || stateValue === "closed" || stateValue === "disconnected";
    }

    function ensureLocalStreamsAreShared(force = false) {
        for (const [kind, stream] of state.localStreams) {
            const hasLiveTrack = stream.getTracks().some((track) => track.enabled && track.readyState === "live");
            if (!hasLiveTrack) continue;

            for (const [peerId, conn] of state.dataConnections) {
                if (state.abandonedPeers.has(peerId)) continue;
                if (!conn.open || peerId === state.peer.id) continue;
                const key = `${kind}:${peerId}`;
                if (force || !state.outboundCalls.has(key)) callPeer(peerId, kind, stream);
            }
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
        const settingsButton = fragment.querySelector(".tile-settings-button");
        const resizeHandle = document.createElement("span");
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
        tile.classList.toggle("audio-muted", config.stream.getAudioTracks().length > 0 && !config.stream.getAudioTracks().some(t => t.enabled));
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
        updateLocalTileState(config.id);
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

    // ... rest of file unchanged ...

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
