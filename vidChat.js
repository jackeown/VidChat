(function () {
    if (typeof Peer === "undefined") {
        throw new Error("PeerJS is required for MeliChat.");
    }

    const qs = new URLSearchParams(window.location.search);
    const roomId = sanitizeRoomId(qs.get("room")) || createRoomId();
    const roomPeerId = `vidchat-room-${roomId}`;
    const state = {
        peer: null,
        isHost: false,
        previewStreams: new Map(),
        localStreams: new Map(),
        outboundCalls: new Map(),
        dataConnections: new Map(),
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
        focusedTileId: null,
        zIndex: 1,
        unreadCount: 0,
        chatOpen: false,
        chatHistory: []
    };

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
        displayName: document.getElementById("displayName"),
        brandName: document.getElementById("brandName"),
        chatNameInput: document.getElementById("chatNameInput"),
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
    window.addEventListener("resize", keepTilesInsideStage);
    startRoom();

    async function startRoom() {
        setStatus("Opening room...");
        const hostPeer = new Peer(roomPeerId, peerOptions());

        hostPeer.on("open", () => {
            state.peer = hostPeer;
            state.isHost = true;
            bindPeer(hostPeer);
            setStatus(`Room ready. You are hosting as ${hostPeer.id}.`);
        });

        hostPeer.on("error", (error) => {
            if (error.type === "unavailable-id") {
                hostPeer.destroy();
                joinRoom();
                return;
            }
            setStatus(`Peer error: ${error.message || error.type}`);
        });
    }

    function joinRoom() {
        setStatus("Joining room...");
        const guestPeer = new Peer(undefined, peerOptions());
        guestPeer.on("open", () => {
            state.peer = guestPeer;
            bindPeer(guestPeer);
            connectData(roomPeerId, true);
            setStatus(`Connected as ${guestPeer.id}. Waiting for peers...`);
        });
        guestPeer.on("error", (error) => {
            setStatus(`Peer error: ${error.message || error.type}`);
        });
    }

    function bindPeer(peer) {
        peer.on("connection", (conn) => registerConnection(conn));
        peer.on("call", (call) => {
            call.answer();
            call.on("stream", (stream) => addRemoteStream(call.peer, call.metadata, stream));
            call.on("close", () => removeTile(tileId(call.peer, call.metadata && call.metadata.kind)));
            call.on("error", () => removeTile(tileId(call.peer, call.metadata && call.metadata.kind)));
        });
        peer.on("disconnected", () => setStatus("Disconnected from PeerJS. Reconnecting..."));
    }

    function registerConnection(conn) {
        if (state.dataConnections.has(conn.peer)) {
            const oldConn = state.dataConnections.get(conn.peer);
            if (oldConn.open) oldConn.close();
        }

        state.dataConnections.set(conn.peer, conn);
        conn.on("open", () => {
            conn.send({ type: "hello", peerId: state.peer.id, displayName: state.displayName });

            if (state.isHost) {
                const roster = [...state.dataConnections.keys()].filter((id) => id !== conn.peer);
                conn.send({ type: "welcome", roomId, peers: roster, history: state.chatHistory });
                broadcast({ type: "peer-joined", peerId: conn.peer }, conn.peer);
            }

            sendLocalStreamsTo(conn.peer);
            updatePeerStatus();
        });

        conn.on("data", (message) => handleMessage(conn.peer, message));
        conn.on("close", () => {
            if (state.dataConnections.get(conn.peer) !== conn) return;
            state.dataConnections.delete(conn.peer);
            closeCallsForPeer(conn.peer);
            removePeerTiles(conn.peer);
            if (state.isHost) broadcast({ type: "peer-left", peerId: conn.peer });
            updatePeerStatus();
        });
        conn.on("error", () => {
            if (state.dataConnections.get(conn.peer) !== conn) return;
            state.dataConnections.delete(conn.peer);
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

        if (message.type === "welcome") {
            setStatus(`Joined room ${message.roomId}. Connecting to ${message.peers.length} peer(s).`);
            message.peers.forEach((id) => connectData(id, false));
            if (message.history) {
                message.history.forEach((msg) => {
                    if (msg.type === "chat") {
                        addChatMessage(msg.peerId, msg.text, msg.timestamp);
                    } else if (msg.type === "file") {
                        addFileMessage(msg.peerId, msg.name, msg.size, msg.data, msg.timestamp);
                    }
                });
            }
            return;
        }

        if (message.type === "peer-joined") {
            updatePeerStatus();
            return;
        }

        if (message.type === "peer-left") {
            removePeerTiles(message.peerId);
            updatePeerStatus();
            return;
        }

        if (message.type === "stream-stopped") {
            removeTile(tileId(peerId, message.kind));
            return;
        }

        if (message.type === "name-changed") {
            setPeerName(peerId, message.displayName);
        }

        if (message.type === "chat") {
            addChatMessage(peerId, message.text, message.timestamp);
        }

        if (message.type === "file") {
            addFileMessage(peerId, message.name, message.size, message.data, message.timestamp);
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

        const urlPattern = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
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

        state.chatHistory.push({ peerId, author, name, size, data, timestamp, type: "file" });

        if (!local && !state.chatOpen) {
            state.unreadCount++;
            updateChatBadge();
        }
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
        if (!peerId || peerId === state.peer.id || state.dataConnections.has(peerId)) return;

        const conn = state.peer.connect(peerId, { reliable: true });
        registerConnection(conn);
        conn.on("error", () => {
            if (required) setStatus("The room is not reachable yet. Check the link or try again.");
        });
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
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            state.localStreams.set("camera", stream);
            addCameraTile(stream, false);
            sendLocalStreamToAll("camera", stream);
            setStatus("Camera and microphone are now shared.");
        } catch (error) {
            setStatus(`Camera error: ${error.message}`);
        } finally {
            updateMediaButtons();
        }
    }

    function stopFullCamera() {
        const stream = state.localStreams.get("camera") || state.previewStreams.get("camera");
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
        }

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
            stopLocalStream("screen");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });
            addLocalStream("screen", stream);
            stream.getVideoTracks()[0].addEventListener("ended", () => stopLocalStream("screen"));
        } catch (error) {
            setStatus(`Screen share error: ${error.message}`);
        }
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
    }

    function stopLocalStream(kind) {
        const stream = state.localStreams.get(kind);
        if (!stream) return;

        stream.getTracks().forEach((track) => track.stop());
        state.localStreams.delete(kind);
        removeTile(tileId("local", kind));

        closeOutboundCalls(kind);

        broadcast({ type: "stream-stopped", kind });
        updateMediaButtons();
    }

    function closeOutboundCalls(kind) {
        for (const [key, call] of state.outboundCalls) {
            if (key.startsWith(`${kind}:`)) {
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

    function callPeer(peerId, kind, stream) {
        if (!state.peer || peerId === state.peer.id) return;

        const key = `${kind}:${peerId}`;
        const oldCall = state.outboundCalls.get(key);
        if (oldCall) oldCall.close();

        const call = state.peer.call(peerId, stream, {
            metadata: {
                kind,
                from: state.peer.id,
                displayName: state.displayName,
                hasAudio: stream.getAudioTracks().length > 0
            }
        });

        state.outboundCalls.set(key, call);
        call.on("close", () => state.outboundCalls.delete(key));
        call.on("error", () => state.outboundCalls.delete(key));
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

        tile.dataset.tileId = config.id;
        tile.classList.add(config.kind);
        tile.classList.toggle("preview", Boolean(config.preview));
        tile.classList.toggle("local-camera", config.local && config.kind === "camera");
        tile.style.zIndex = String(++state.zIndex);
        title.textContent = tileTitle(config);
        video.srcObject = config.stream;
        video.muted = config.muted;
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

        tile.appendChild(resizeHandle);
        els.videos.appendChild(fragment);
        state.tiles.set(config.id, tile);
        state.tileConfigs.set(config.id, config);
        updateLocalTileState(config.id);
        if (oldFrame && oldFrame.placed) {
            setTileFrame(tile, oldFrame.x, oldFrame.y, oldFrame.width, oldFrame.height);
        } else {
            placeTileWithoutOverlap(tile);
        }
        resolveOverlaps();
        applyFocus();
    }

    function toggleTracks(tracks) {
        if (!tracks.length) return;
        const nextEnabled = !tracks.some((track) => track.enabled);
        tracks.forEach((track) => {
            track.enabled = nextEnabled;
        });
    }

    function updateLocalTileState(id) {
        const tile = state.tiles.get(id);
        const config = state.tileConfigs.get(id);
        if (!tile || !config || !config.local) return;

        tile.classList.toggle("video-muted", !config.stream.getVideoTracks().some((track) => track.enabled));
    }

    function updateTrackState(config, videoButton, audioButton) {
        const { kind, stream } = config;
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        const videoOn = videoTracks.some((track) => track.enabled);
        const audioOn = audioTracks.some((track) => track.enabled);

        videoButton.textContent = videoTracks.length === 0 ? "No video" : kind === "screen" ? (videoOn ? "Hide" : "Show") : (videoOn ? "Mute video" : "Show video");
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

        updateFeedModalSubtitle(config);
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
            if (!hasAudio) return videoOn ? "Screen shared without audio" : "Screen hidden, no audio";
            if (!videoOn && !audioOn) return "Screen and audio muted";
            if (!videoOn) return "Screen hidden, audio shared";
            if (!audioOn) return "Screen shared, audio muted";
            return "Screen and audio shared";
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

        els.feedModalTitle.textContent = tileTitle(config);
        els.feedModalControls.replaceChildren();
        updateFeedModalSubtitle(config);

        const focusButton = makeModalButton("Focus video", () => focusTile(id));
        els.feedModalControls.appendChild(focusButton);

        if (config.preview && typeof config.previewAction === "function") {
            els.feedModalControls.appendChild(makeModalButton("Share camera", config.previewAction, "primary"));
        }

        if (config.local) {
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
        } else {
            const video = tile.querySelector("video");
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
            });

            volumeLabel.append(volumeText, volume);
            els.feedModalControls.appendChild(volumeLabel);
        }

        els.feedModal.showModal();
    }

    function updateFeedModalSubtitle(config) {
        if (!config) return;
        els.feedModalSubtitle.textContent = config.local
            ? localSubtitle(config.kind, config.stream, Boolean(config.preview))
            : config.subtitle;
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
        tile.remove();
        state.tiles.delete(id);
        state.tileConfigs.delete(id);
        if (state.focusedTileId === id) state.focusedTileId = null;
        applyFocus();
    }

    function removePeerTiles(peerId) {
        [...state.tiles.keys()]
            .filter((id) => id.startsWith(`${peerId}:`))
            .forEach((id) => removeTile(id));
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
            });
        }
    }

    document.addEventListener("fullscreenchange", () => {
        const full = document.fullscreenElement;
        for (const tile of state.tiles.values()) {
            tile.classList.toggle("expanded", tile === full);
        }
    });

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

    function closeCallsForPeer(peerId) {
        for (const [key, call] of state.outboundCalls) {
            if (key.endsWith(`:${peerId}`)) {
                call.close();
                state.outboundCalls.delete(key);
            }
        }
    }

    function bindUi() {
        els.copyRoomLink.addEventListener("click", () => copyText(roomUrl(roomId), "Room link copied."));
        els.newRoom.addEventListener("click", () => {
            window.location.href = roomUrl(createRoomId());
        });
        els.cameraToggle.addEventListener("click", toggleCamera);
        els.screenToggle.addEventListener("click", toggleScreen);
        els.screenAudioMute.addEventListener("click", toggleScreenAudioMute);
        els.appSettingsButton.addEventListener("click", () => els.appSettingsModal.showModal());
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

        els.attachFile.addEventListener("click", () => els.fileInput.click());
        els.fileInput.addEventListener("change", (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const msg = {
                    type: "file",
                    name: file.name,
                    size: file.size,
                    data: e.target.result,
                    timestamp: Date.now()
                };
                addFileMessage("local", msg.name, msg.size, msg.data, msg.timestamp);
                broadcast(msg);
                els.fileInput.value = "";
            };
            reader.readAsArrayBuffer(file);
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

        document.addEventListener("pointerdown", (event) => {
            if (!event.target.closest(".autocomplete-wrapper")) {
                els.emojiAutocomplete.classList.add("hidden");
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            for (const tile of state.tiles.values()) {
                tile.classList.remove("expanded");
            }
        });
    }

    function applyVideoFit() {
        els.videos.classList.toggle("fit-cover", state.videoFit === "cover");
    }

    function applyMirrorSetting() {
        els.videos.classList.toggle("mirror-local-camera", state.mirrorLocalCamera);
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
        const hasScreenAudio = screenStream && screenStream.getAudioTracks().length > 0;
        const screenAudioMuted = hasScreenAudio && !screenStream.getAudioTracks().some(t => t.enabled);

        els.cameraToggle.disabled = false;
        els.cameraToggle.textContent = hasCamera ? "Remove Video" : "Share Camera/Mic";
        els.cameraToggle.classList.toggle("danger", hasCamera);
        
        els.screenToggle.textContent = screenOn ? "Stop screen" : "Share screen";
        els.screenToggle.classList.toggle("danger", screenOn);

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
        const count = state.dataConnections.size;
        const role = state.isHost ? "hosting" : "connected";
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
        return stream.getAudioTracks().length ? "Screen share with audio" : "Screen share without audio";
    }

    function tileId(peerId, kind) {
        return `${peerId}:${kind || "camera"}`;
    }

    function shortPeer(peerId) {
        if (peerId === roomPeerId) return "Host";
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
        const bytes = new Uint8Array(6);
        crypto.getRandomValues(bytes);
        return [...bytes].map((byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 10);
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
        return value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48);
    }

    function peerOptions() {
        return {
            debug: 1,
            config: {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    { urls: "stun:stun1.l.google.com:19302" },
                    { urls: "stun:stun2.l.google.com:19302" },
                    { urls: "stun:stun.services.mozilla.com" },
                    {
                        urls: "turn:openrelay.metered.ca:80",
                        username: "openrelayproject",
                        credential: "openrelayproject"
                    },
                    {
                        urls: "turn:openrelay.metered.ca:443",
                        username: "openrelayproject",
                        credential: "openrelayproject"
                    },
                    {
                        urls: "turns:openrelay.metered.ca:443?transport=tcp",
                        username: "openrelayproject",
                        credential: "openrelayproject"
                    }
                ]
            }
        };
    }
})();
