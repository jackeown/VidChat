(function () {
    if (typeof Peer === "undefined") {
        throw new Error("PeerJS is required for VidChat.");
    }

    const qs = new URLSearchParams(window.location.search);
    const roomId = sanitizeRoomId(qs.get("room")) || createRoomId();
    const roomPeerId = `vidchat-room-${roomId}`;
    const state = {
        peer: null,
        isHost: false,
        localStreams: new Map(),
        outboundCalls: new Map(),
        dataConnections: new Map(),
        tiles: new Map(),
        layout: "grid",
        focusedTileId: null,
        zIndex: 1
    };

    const els = {
        status: document.getElementById("status"),
        roomId: document.getElementById("roomId"),
        copyRoomId: document.getElementById("copyRoomId"),
        copyRoomLink: document.getElementById("copyRoomLink"),
        newRoom: document.getElementById("newRoom"),
        cameraToggle: document.getElementById("cameraToggle"),
        screenToggle: document.getElementById("screenToggle"),
        screenAudio: document.getElementById("screenAudio"),
        videos: document.getElementById("videos"),
        tileTemplate: document.getElementById("tileTemplate")
    };

    els.roomId.value = roomId;
    updateUrl(roomId);
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
            conn.send({ type: "hello", peerId: state.peer.id });

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
            stopLocalStream("camera");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            addLocalStream("camera", stream);
        } catch (error) {
            setStatus(`Camera error: ${error.message}`);
        }
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

    function stopLocalStream(kind) {
        const stream = state.localStreams.get(kind);
        if (!stream) return;

        stream.getTracks().forEach((track) => track.stop());
        state.localStreams.delete(kind);
        removeTile(tileId("local", kind));

        for (const [key, call] of state.outboundCalls) {
            if (key.startsWith(`${kind}:`)) {
                call.close();
                state.outboundCalls.delete(key);
            }
        }

        broadcast({ type: "stream-stopped", kind });
        updateMediaButtons();
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
                hasAudio: stream.getAudioTracks().length > 0
            }
        });

        state.outboundCalls.set(key, call);
        call.on("close", () => state.outboundCalls.delete(key));
        call.on("error", () => state.outboundCalls.delete(key));
    }

    function addRemoteStream(peerId, metadata, stream) {
        const kind = metadata && metadata.kind ? metadata.kind : "camera";
        addTile({
            id: tileId(peerId, kind),
            owner: shortPeer(peerId),
            subtitle: kind === "screen" ? screenSubtitle(stream) : "Camera and microphone",
            kind,
            stream,
            muted: false,
            local: false
        });
        updatePeerStatus();
    }

    function addTile(config) {
        removeTile(config.id);

        const fragment = els.tileTemplate.content.cloneNode(true);
        const tile = fragment.querySelector(".video-tile");
        const video = fragment.querySelector("video");
        const title = fragment.querySelector(".tile-title");
        const subtitle = fragment.querySelector(".tile-subtitle");
        const focusButton = fragment.querySelector(".focus-button");
        const audioButton = fragment.querySelector(".audio-button");
        const audioPopover = fragment.querySelector(".audio-popover");
        const volume = fragment.querySelector(".volume-slider");
        const resizeHandle = document.createElement("span");

        tile.dataset.tileId = config.id;
        tile.classList.add(config.kind);
        tile.style.zIndex = String(++state.zIndex);
        title.textContent = `${config.owner} - ${config.kind === "screen" ? "Screen" : "Camera"}`;
        subtitle.textContent = config.subtitle;
        video.srcObject = config.stream;
        video.muted = config.muted;
        video.volume = Number(volume.value);
        resizeHandle.className = "resize-handle";
        resizeHandle.title = "Resize video";
        resizeHandle.setAttribute("aria-hidden", "true");

        volume.disabled = config.local;
        audioButton.disabled = config.local;
        audioButton.title = config.local ? "Local preview audio is muted" : "Adjust this video's audio";
        audioButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const open = audioPopover.hidden;
            closeAudioPopovers(tile);
            audioPopover.hidden = !open;
            audioButton.classList.toggle("active", open);
        });
        volume.addEventListener("input", () => {
            video.volume = Number(volume.value);
            video.muted = video.volume === 0;
        });

        focusButton.addEventListener("click", () => focusTile(config.id));
        tile.addEventListener("dblclick", () => focusTile(config.id));
        tile.addEventListener("pointerdown", () => bringToFront(tile));
        bindTileDragging(tile, fragment.querySelector(".tile-bar"));
        bindTileResizing(tile, resizeHandle);

        tile.appendChild(resizeHandle);
        els.videos.appendChild(fragment);
        state.tiles.set(config.id, tile);
        arrangeTiles(state.layout, false);
        applyFocus();
    }

    function closeAudioPopovers(exceptTile) {
        for (const tile of state.tiles.values()) {
            if (tile === exceptTile) continue;
            const popover = tile.querySelector(".audio-popover");
            const button = tile.querySelector(".audio-button");
            if (popover) popover.hidden = true;
            if (button) button.classList.remove("active");
        }
    }

    function removeTile(id) {
        const tile = state.tiles.get(id);
        if (!tile) return;
        tile.remove();
        state.tiles.delete(id);
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

    function applyFocus() {
        for (const [id, tile] of state.tiles) {
            tile.classList.toggle("focused", id === state.focusedTileId);
        }
    }

    function setLayout(layout) {
        state.layout = layout;
        els.videos.className = `video-stage ${layout}`;
        document.querySelectorAll(".layout-button").forEach((button) => {
            button.classList.toggle("active", button.dataset.layout === layout);
        });
        arrangeTiles(layout, true);
    }

    function keepTilesInsideStage() {
        for (const tile of state.tiles.values()) {
            setTileFrame(tile, tile.offsetLeft, tile.offsetTop, tile.offsetWidth, tile.offsetHeight);
        }
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
        const tileWidth = Math.max(180, (stage.width - gap * (columns - 1)) / columns);
        const tileHeight = Math.max(140, (stage.height - gap * (rows - 1)) / rows);

        tiles.forEach((tile, index) => {
            if (!force && tile.dataset.placed === "true") return;
            const column = index % columns;
            const row = Math.floor(index / columns);
            setTileFrame(tile, column * (tileWidth + gap), row * (tileHeight + gap), tileWidth, tileHeight);
        });
    }

    function arrangeSpotlight(tiles, stage, force) {
        const gap = 10;
        const focused = state.focusedTileId ? state.tiles.get(state.focusedTileId) : tiles[0];
        const sideWidth = Math.min(280, Math.max(180, stage.width * 0.25));
        const mainWidth = tiles.length > 1 ? stage.width - sideWidth - gap : stage.width;
        const mainHeight = stage.height;

        if (focused && (force || focused.dataset.placed !== "true")) {
            setTileFrame(focused, 0, 0, mainWidth, mainHeight);
        }

        const sideTiles = tiles.filter((tile) => tile !== focused);
        const sideHeight = Math.max(140, (stage.height - gap * Math.max(0, sideTiles.length - 1)) / Math.max(1, sideTiles.length));
        sideTiles.forEach((tile, index) => {
            if (!force && tile.dataset.placed === "true") return;
            setTileFrame(tile, mainWidth + gap, index * (sideHeight + gap), sideWidth, sideHeight);
        });
    }

    function arrangeFilmstrip(tiles, stage, force) {
        const gap = 10;
        const tileWidth = Math.min(360, Math.max(220, stage.width * 0.34));
        const tileHeight = Math.max(150, stage.height - gap);

        tiles.forEach((tile, index) => {
            if (!force && tile.dataset.placed === "true") return;
            const x = Math.min(stage.width - tileWidth, index * (tileWidth + gap));
            setTileFrame(tile, Math.max(0, x), 0, tileWidth, tileHeight);
        });
    }

    function bindTileDragging(tile, handle) {
        handle.addEventListener("pointerdown", (event) => {
            if (isInteractiveControl(event.target)) return;
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

    function setTileFrame(tile, x, y, width, height) {
        const stage = stageRect();
        const minWidth = 180;
        const minHeight = 140;
        const nextWidth = clamp(width, minWidth, Math.max(minWidth, stage.width));
        const nextHeight = clamp(height, minHeight, Math.max(minHeight, stage.height));
        const nextX = clamp(x, 0, Math.max(0, stage.width - nextWidth));
        const nextY = clamp(y, 0, Math.max(0, stage.height - nextHeight));

        tile.style.left = `${nextX}px`;
        tile.style.top = `${nextY}px`;
        tile.style.width = `${nextWidth}px`;
        tile.style.height = `${nextHeight}px`;
        tile.dataset.placed = "true";
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
        els.copyRoomId.addEventListener("click", () => copyText(roomId, "Room ID copied."));
        els.copyRoomLink.addEventListener("click", () => copyText(roomUrl(roomId), "Room link copied."));
        els.newRoom.addEventListener("click", () => {
            window.location.href = roomUrl(createRoomId());
        });
        els.cameraToggle.addEventListener("click", toggleCamera);
        els.screenToggle.addEventListener("click", toggleScreen);
        document.addEventListener("click", (event) => {
            if (!event.target.closest(".audio-popover, .audio-button")) closeAudioPopovers();
        });
        document.querySelectorAll(".layout-button").forEach((button) => {
            button.addEventListener("click", () => setLayout(button.dataset.layout));
        });
    }

    function updateMediaButtons() {
        const cameraOn = state.localStreams.has("camera");
        const screenOn = state.localStreams.has("screen");
        els.cameraToggle.textContent = cameraOn ? "Stop camera" : "Share camera";
        els.cameraToggle.classList.toggle("danger", cameraOn);
        els.screenToggle.textContent = screenOn ? "Stop screen" : "Share screen";
        els.screenToggle.classList.toggle("danger", screenOn);
        els.screenAudio.disabled = screenOn;
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
            els.roomId.select();
            setStatus("Copy failed. Select the room ID manually.");
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
