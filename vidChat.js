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
        layout: "grid",
        videoFit: localStorage.getItem("vidChatVideoFit") || "contain",
        mirrorLocalCamera: localStorage.getItem("vidChatMirrorLocalCamera") !== "false",
        focusedTileId: null,
        zIndex: 1
    };

    const els = {
        status: document.getElementById("status"),
        copyRoomLink: document.getElementById("copyRoomLink"),
        newRoom: document.getElementById("newRoom"),
        cameraToggle: document.getElementById("cameraToggle"),
        screenToggle: document.getElementById("screenToggle"),
        screenAudio: document.getElementById("screenAudio"),
        appSettingsButton: document.getElementById("appSettingsButton"),
        appSettingsModal: document.getElementById("appSettingsModal"),
        displayName: document.getElementById("displayName"),
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
    bindUi();
    window.addEventListener("resize", keepTilesInsideStage);
    startRoom();
    startCameraPreview();

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
                conn.send({ type: "welcome", roomId, peers: roster });
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
        if (state.localStreams.has("camera")) {
            stopCameraShare();
            return;
        }

        if (!state.previewStreams.has("camera")) {
            await startCameraPreview();
            return;
        }

        shareCameraPreview();
    }

    async function startCameraPreview() {
        if (state.previewStreams.has("camera") || state.localStreams.has("camera")) return;

        els.cameraToggle.disabled = true;
        els.cameraToggle.textContent = "Starting camera...";

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            state.previewStreams.set("camera", stream);
            addCameraTile(stream, true);
            setStatus("Camera preview ready. Share it when you want others to see and hear you.");
        } catch (error) {
            setStatus(`Camera error: ${error.message}`);
        } finally {
            updateMediaButtons();
        }
    }

    function shareCameraPreview() {
        const stream = state.previewStreams.get("camera");
        if (!stream || state.localStreams.has("camera")) return;

        state.localStreams.set("camera", stream);
        addCameraTile(stream, false);
        sendLocalStreamToAll("camera", stream);
        setStatus("Camera and microphone are now shared.");
        updateMediaButtons();
    }

    function stopCameraShare() {
        if (!state.localStreams.has("camera")) return;

        state.localStreams.delete("camera");
        closeOutboundCalls("camera");
        broadcast({ type: "stream-stopped", kind: "camera" });

        const preview = state.previewStreams.get("camera");
        if (preview) {
            addCameraTile(preview, true);
            setStatus("Camera is back to local preview only.");
        } else {
            removeTile(tileId("local", "camera"));
        }

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
                audio: els.screenAudio.checked
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
            preview,
            previewAction: shareCameraPreview
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
        const alreadyExpanded = tile.classList.contains("expanded");
        for (const other of state.tiles.values()) {
            other.classList.remove("expanded");
        }
        tile.classList.toggle("expanded", !alreadyExpanded);
        if (!alreadyExpanded) bringToFront(tile);
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
            bringToFront(tile);
            tile.classList.add("moving");
            els.videos.classList.add("dragging");
            handle.setPointerCapture(event.pointerId);

            const move = (moveEvent) => {
                const dx = moveEvent.clientX - start.clientX;
                const dy = moveEvent.clientY - start.clientY;
                setTileFrame(tile, start.x + dx, start.y + dy, start.width, start.height);
            };
            const stop = () => {
                tile.classList.remove("moving");
                els.videos.classList.remove("dragging");
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", stop);
                handle.removeEventListener("pointercancel", stop);
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

    function updateMediaButtons() {
        const cameraOn = state.localStreams.has("camera");
        const cameraPreview = state.previewStreams.has("camera");
        const screenOn = state.localStreams.has("screen");
        els.cameraToggle.disabled = false;
        els.cameraToggle.textContent = cameraOn ? "Stop camera" : cameraPreview ? "Share camera" : "Start camera";
        els.cameraToggle.classList.toggle("danger", cameraOn);
        els.screenToggle.textContent = screenOn ? "Stop screen" : "Share screen";
        els.screenToggle.classList.toggle("danger", screenOn);
        els.screenAudio.disabled = screenOn;
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
            debug: 1
        };
    }
})();
