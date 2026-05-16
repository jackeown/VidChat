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
        "100": "4af",
        angry: "620",
        boom: "4a5",
        check: "197",
        computer: "4bb",
        cool: "60e",
        devil: "608",
        evil: "608",
        fear: "628",
        flex: "4aa",
        haha: "602",
        happy: "604",
        hmmm: "914",
        mindblown: "92f",
        ok: "44c",
        party: "973",
        praise: "64c",
        smile: "60a",
        thumbsup: "44d"
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

    // ... rest of file is unchanged until ...

    function linkify(text) {
        // Escape HTML to prevent XSS before adding our own <a> tags
        const div = document.createElement("div");
        div.textContent = text;
        const escapedText = div.innerHTML;

        // FIXED: removed duplicate %% in regex pattern
        const urlPattern = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        return escapedText.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    }

    // ...rest of file unchanged...

})();
