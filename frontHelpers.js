let myId = null;
window.peers = [];
let hostname = window.location.hostname || "localhost";
function isRealHostname(hostname){
    let prefixes = [
        "192.168.",
        "10.",
        "localhost",
        "127."
    ]
    return !Array.some(prefixes.map(p => hostname.startsWith(p)));
}
if(isRealHostname(hostname)){
    hostname = "sock." + hostname;
}
console.log(`Websocket Hostname: ${hostname}`);
let ws = new WebSocket(`wss://${hostname}:6503`, "json");
window.camOn = 0;
window.zip = function(...args) {
    let result = [];

    let n = Math.min(...args.map(x => x.length));
    for (let i = 0; i < n; i++) {
        result.push(args.map(x => x[i]));
    }

    return result;
}

window.logz = function(l) {
    console.log(`${Date.now()}   ${l}`)
}

ws.onmessage = function(e) {
    let msg = JSON.parse(e.data);

    switch (msg.type) {
        case "id":
            myId = msg.id;
            logz(`Received id: ${myId}`)
            break;

        case "userlist": // Received an updated user list
            handleUserlistMsg(msg);
            break;


            // Signaling messages: these messages are used by WebRTC Signaling.
        case "video-offer": // Invitation and offer to chat
            handleVideoOfferMsg(msg);
            break;

        case "video-answer": // Callee has answered our offer
            handleVideoAnswerMsg(msg);
            break;

        case "new-ice-candidate": // A new ICE candidate has been received
            handleNewICECandidateMsg(msg);
            break;

        case "hang-up": // The other peer has hung up the call
            handleHangUpMsg(msg);
            break;


            // Unknown message; output to console for debugging.
        default:
            console.error("Unknown message received:");
            console.error(msg);
    }
};


export function getPeerById(id) {
    for (let p of peers) {
        if (p.id == id)
            return p;
    }
    return null;
}


export function sendToServer(msg) {
    var msgJSON = JSON.stringify(msg);
    // logz("Sending '" + msg.type + "' message: " + msgJSON);
    ws.send(msgJSON);
}

export function joinRoom(room, username) {
    sendToServer({
        type: "joinRoom",
        room: room,
        id: myId,
        name: username
    });
}

function closeVideoCall() {

}

function sendTrackToPeers(track, type){
    for (let peer of peers) {
        if (peer.conn !== null) {
            logz(`Trying to send ${type} ${track.kind} track to ${peer.id}`);
            try{
                let stream = new MediaStream();
                stream.addTrack(track);
                let typeInfo = {
                    type: "trackIdentifier",
                    // trackIdentifier: track.id,
                    trackIdentifier: stream.id,
                    trackType: type
                };
                peer.dc.send(JSON.stringify(typeInfo));
                peer.conn.addTrack(track, stream);
            }
            catch(e){
                console.error(e);
            }
        }
    }
}

function sendTracksToPeers(stream, type) {
    for (let track of stream.getTracks()) {
        sendTrackToPeers(track, type);
    }
}
window.sendTracksToPeers = sendTracksToPeers;
window.f = function() { sendTracksToPeers(getPeerById(myId).webcamStream, "webcam") }

window.enableCamera = async function() {
    logz("enabling camera...")
    window.camOn = Date.now()
    let me = getPeerById(myId);
    if (!me.webcamStream) {
        me.webcamStream = await navigator.mediaDevices.getUserMedia({
            video: {
                aspectRatio: { ideal: 1.333333 },
                frameRate: 25
            },
            audio: true
        });
        // me.webcamStream = await navigator.mediaDevices.getDisplayMedia()
    }
    // sendTracksToPeers(me.webcamStream);
}

function loop(){
    console.log('loop...')
    
    try{
        let me = getPeerById(myId);
        for(let peer of peers){
            let webcam = document.querySelector(`#video-${peer.id}`);
            let screen = document.querySelector(`#screen-${peer.id}`);
    
            if(!webcam){
                logz(`Creating user div for ${peer.id}`);
                createUserDiv(peer);
            }
            else if(!webcam.srcObject && peer.webcamStream){
                logz(`adding srcObject for ${peer.id}`);
                webcam.srcObject = peer.webcamStream;
                webcam.muted = true;
            }
            else if(webcam.srcObject && !peer.webcamStream){
                webcam.srcObject = null;
            }
    
            if(!screen && peer.screenStream){
                // logz(`Creating screen div for ${peer.id}`);
                // createScreenDiv(peer);
            }
            else if(screen && !peer.screenStream){
                // logz(`Destroying screen div for ${peer.id}`);
                // destroyScreenDiv(peer);
            }
            
        }

    
        if(me.webcamStream){
            for(let peer of peers){
                if(peer.id !== myId){
                    let tracksTheyHave = peer.conn.getTransceivers().map(t => t.sender.track || t.receiver.track);
                    console.log(tracksTheyHave);
    
                    for(let track of me.webcamStream.getTracks()){
                        if(!tracksTheyHave.map(t => t.id).includes(track.id)){
                            console.log(`Sending tracks to ${peer.name}`)
                            sendTrackToPeers(track, "webcam");
                        }
                        else{
                            console.log(`${peer.name} already has all your tracks!`);
                        }
                    }
                }
            }
        }
        else{
            enableCamera();
        }
    }
    catch(e){
        console.error(e);
        // try{
        //     window.loopErrors.push(e);
        // }
        // catch(e){console.log("WTF")}
    }

    setTimeout(loop, 1000);
}
window.loopErrors = [];
setTimeout(loop, 1000);


function createUserDivButtons(user) {
    let buttons = document.createElement("div");

    let vidToggle = document.createElement("button");
    vidToggle.id = "vidToggle";
    vidToggle.innerHTML = "vidToggle";
    vidToggle.disabled = true;

    let audioToggle = document.createElement("button");
    audioToggle.id = "audioToggle";
    audioToggle.innerHTML = "audioToggle";
    audioToggle.disabled = true;

    let screenToggle = document.createElement("button");
    screenToggle.id = "screenToggle";
    screenToggle.innerHTML = "screenToggle";

    buttons.append(vidToggle, audioToggle, screenToggle);
    return buttons;
}




window.createUserDiv = function(user) {
    let videos = document.getElementById("videos");


    let videoDiv = document.createElement("div");
    videoDiv.classList.add("videoDiv")
    videoDiv.addEventListener("dblclick", function(e) {
        if (document.fullscreenElement == videoDiv)
            document.exitFullscreen();
        else
            videoDiv.requestFullscreen();
    })

    let video = document.createElement("video");
    video.classList.add("video");
    if (user.id == myId)
        video.classList.add("flipVideo");
    video.id = `video-${user.id}`;
    video.autoplay = true;

    videoDiv.append(video);
    videoDiv.innerHTML += `${user.name}'s Webcam`
    videoDiv.append(createUserDivButtons(user));

    videos.append(videoDiv);
}

function removePeer(id) {
    document.getElementById(`video-${id}`).parentElement.remove();
    peers = peers.filter(peer => peer.id != id);
}




async function handleUserlistMsg(msg) {
    let newUsers = [];
    let newConns = [];

    let peerIds = peers.map(p => p.id);
    // look for new peers.
    for (let user of msg.users) {
        if (!peerIds.includes(user.id)) {
            let p = null;
            if (user.id != myId) {
                logz(`Creating peer connection for ${user.id}`);
                p = createPeerConnection(user.id);
            }
            newUsers.push(user);
            newConns.push(p);
        }
    }

    newConns = await Promise.all(newConns);
    for (let [user, connection] of zip(newUsers, newConns)) {
        user.conn = connection;
        user.trackTypeMap = {};
        user.mysteryTracks = [];
        if (user.conn && myId < user.id) {
            logz(`Creating data channel for ${user.id}`)
            user.dc = user.conn.createDataChannel(`chat_channel_with_${user.id}`);
            user.dc.onmessage = handleDataChannelMessage(user.id);
        }
        peers.push(user);
        createUserDiv(user);
    }
    // enableCamera();

    // remove peers that have left.
    window.msg = msg;
    for (let peer of peers) {
        if (msg.users.filter(user => user.id == peer.id).length == 0) {
            removePeer(peer.id);
        }
    }
}


window.addToChat = function(message) {
    logz("adding message to chat: ", message);
    message = JSON.parse(message.data);
    let text = `[${new Date().toLocaleTimeString()}] <b>${message.user}</b>: ${message.body}<br><br>`;
    document.querySelector("#messages").innerHTML += text;
    // chatBox.scrollTop = chatBox.scrollHeight - chatBox.clientHeight;
}


export function chat(message) {
    message = {
        type: "chat",
        body: message,
        user: getPeerById(myId).name,
    }

    for (let peer of peers) {
        if (peer.id != myId)
            peer.dc.send(JSON.stringify(message))
    }

    addToChat({ data: JSON.stringify(message) });
}










/* ICE HELPERS BELOW HERE... */

/* Signaling messages from the server */
async function handleVideoOfferMsg(msg) {
    let peer = getPeerById(msg.sender);
    logz(`Received video offer from ${peer.id}`)

    let desc = new RTCSessionDescription(msg.sdp);
    await peer.conn.setRemoteDescription(desc);

    let answer = await peer.conn.createAnswer();
    await peer.conn.setLocalDescription(answer);
    logz(`Sending video answer to ${peer.id}`)
    sendToServer({
        sender: myId,
        target: peer.id,
        type: "video-answer",
        answer: peer.conn.localDescription
    });
}

async function handleVideoAnswerMsg(msg) {
    let peer = getPeerById(msg.sender);
    logz(`Received video answer from ${peer.id}. check window.ans`)
    window.ans = msg.answer;

    let desc = new RTCSessionDescription(msg.answer)
    window.desc = desc;
    await peer.conn.setRemoteDescription(desc);
}

async function handleNewICECandidateMsg(msg) {
    var candidate = new RTCIceCandidate(msg.candidate);
    let peer = getPeerById(msg.sender);
    logz(`handling NewICE Candidate for ${JSON.stringify(peer)}, ${JSON.stringify(peer.conn.iceConnectionState)}`)

    window.iceConnectionState = JSON.parse(JSON.stringify(peer.conn.iceConnectionState));
    // "new", "checking", "connected"
    if (!["checking", "connected"].includes(peer.conn.iceConnectionState)) {
        try {
            await peer.conn.addIceCandidate(candidate);
        } catch (e) {
            window.msg = msg;
            window.candidate = candidate;
            window.icePeer = peer;
            logz(window.iceConnectionState);
            console.error(e);
        }
    }
}

function handleHangUpMsg(msg) {
    logz(`Need to implement handleHangUpMsg: `, msg);
}


/* Handlers for local ICE async events */
async function createPeerConnection(targetId) {
    logz(`Setting up a connection with ${targetId}...`);

    let conn = new RTCPeerConnection({ iceServers: [{ 'urls': 'stun:stun.l.google.com:19302' }] });
    //let peer = getPeerById(targetId); 
    // The line above was a bug as it will always be null! it needs to be invoked in ondatachannel

    // Set up event handlers for the ICE negotiation process.
    conn.onicecandidate = handleICECandidateEvent(targetId);
    conn.oniceconnectionstatechange = handleICEConnectionStateChangeEvent(conn);
    conn.onicegatheringstatechange = handleICEGatheringStateChangeEvent(conn);
    conn.onsignalingstatechange = handleSignalingStateChangeEvent(conn);
    conn.onnegotiationneeded = handleNegotiationNeededEvent(targetId, conn);
    conn.ontrack = handleTrackEvent(targetId);

    let handler = handleDataChannelMessage(targetId);
    conn.ondatachannel = function(event) {
        logz(`received data channel from ${targetId}`)
        let peer = getPeerById(targetId);
        event.channel.onmessage = handler;
        peer.dc = event.channel;
    }

    return conn;
}

function handleICECandidateEvent(targetId) {
    return function(event) {
        let peer = getPeerById(targetId);
        if (event.candidate && (peer.conn == null || peer.conn.connectionState != "connected")) {
            sendToServer({
                type: "new-ice-candidate",
                sender: myId,
                target: targetId,
                candidate: event.candidate
            });
        }
    }
}

function handleICEConnectionStateChangeEvent(connection) {
    return function(event) {
        // logz("*** ICE connection state changed to " + connection.iceConnectionState);

        switch (connection.iceConnectionState) {
            case "closed":
            case "failed":
            case "disconnected":
                closeVideoCall();
                break;
        }
    }
}

function handleICEGatheringStateChangeEvent(connection) {
    return function(event) {
        // logz("*** ICE gathering state changed to: " + connection.iceGatheringState);
    }
}

function handleSignalingStateChangeEvent(connection) {
    return function(event) {
        // logz("*** WebRTC signaling state changed to: " + connection.signalingState);
        if (connection.signalingState == "closed")
            closeVideoCall();
    }
}

function handleNegotiationNeededEvent(targetId, connection) {
    return async function() {
        logz("*** Negotiation needed");
        // let shouldSend = (myId < targetId);
        let shouldSend = true;
        // let timeDiff = Date.now() - window.camOn;
        // logz(`time since I turned on my video: ${timeDiff}`)
        // if (timeDiff < 10000) {
        //     shouldSend = true
        //     logz(`creating offer even though my id is bigger...`)
        // }
        try {
            // Send the offer to the remote peer.
            if (shouldSend) {
                logz("---> Creating offer");
                const offer = await connection.createOffer();

                if (connection.signalingState != "stable") {
                    logz("     -- The connection isn't stable yet; postponing...")
                    return;
                }

                await connection.setLocalDescription(offer);
                logz("---> Sending the offer to the remote peer");
                sendToServer({
                    sender: myId,
                    target: targetId,
                    type: "video-offer",
                    sdp: connection.localDescription
                });
            }
        } catch (err) {
            logz("*** The following error occurred while handling the negotiationneeded event:");
            console.error(err);
        };
    }
}



function handleDataChannelMessage(id){
    return function(message){
        window.dcmessage = message;
        let peer = getPeerById(id);
        let parsed = JSON.parse(message.data);
        if(parsed.type === "chat"){
            addToChat(message);
        }
        else if(parsed.type === "trackIdentifier"){
            peer.trackTypeMap[parsed.trackIdentifier] = parsed.trackType;
        }
    };
}

function handleTrackEvent(targetId) {
    return function(event) {
        logz(`*** Track Received from ${targetId}`);
        event.track.fakeId = event.streams[0].id;
        let peer = getPeerById(targetId);
        peer.mysteryTracks.push(event.track);
    }
}


function updateOrCreateStream(peer, streamName, track){
    if (!peer[streamName])
        peer[streamName] = new MediaStream();

    if (peer[streamName].getVideoTracks().length == 0 && track.kind == "video")
        peer[streamName].addTrack(track);
    else if (peer[streamName].getAudioTracks().length == 0 && track.kind == "audio"){
        peer[streamName].addTrack(track);
    }
}

function solveMysteryTracks(){
    for(let peer of peers){
        let removed = [];
        for(let [i, track] of peer.mysteryTracks.entries()){
            if(track.fakeId in peer.trackTypeMap){
                if(peer.trackTypeMap[track.fakeId] === "webcam"){
                    updateOrCreateStream(peer, "webcamStream", track);
                }
                else if(peer.trackTypeMap[track.fakeId] === "screen"){
                    updateOrCreateStream(peer, "screenStream", track);
                }
                removed.push(i);
            }
        }
        peer.mysteryTracks = peer.mysteryTracks.filter((x,i) => !removed.includes(i));
    }
}
setInterval(solveMysteryTracks, 1000);