
let myId = null;
window.peers = [];
let hostname = window.location.hostname || "localhost";
let ws = new WebSocket(`wss://${hostname}:6503`, "json");

window.zip = function (...args) {
    let result = [];

    let n = Math.min(...args.map(x => x.length));
    for (let i = 0; i < n; i++) {
        result.push(args.map(x => x[i]));
    }

    return result;
}

ws.onmessage = function (e) {
    let msg = JSON.parse(e.data);

    switch (msg.type) {
        case "id":
            myId = msg.id;
            console.log(`Received id: ${myId}`)
            break;

        case "userlist":  // Received an updated user list
            handleUserlistMsg(msg);
            break;

            
        // Signaling messages: these messages are used by WebRTC Signaling.
        case "video-offer":  // Invitation and offer to chat
            handleVideoOfferMsg(msg);
            break;

        case "video-answer":  // Callee has answered our offer
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
    // console.log("Sending '" + msg.type + "' message: " + msgJSON);
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


function sendTracksToPeers(stream){
    for(let track of stream.getTracks()){
        for(let peer of peers){
            if (peer.conn !== null){
                console.log(`Sending Track to ${peer.id}`);
                peer.conn.addTrack(track);
            }
        }
    }
}
window.sendTracksToPeers = sendTracksToPeers;
window.f = function(){sendTracksToPeers(getPeerById(myId).webcamStream)}

window.enableCamera = async function(){
    console.log("enabling camera...")
    let me = getPeerById(myId);
    if(!me.webcamStream){
        me.webcamStream = await navigator.mediaDevices.getUserMedia({
            video: {
                aspectRatio: {ideal: 1.333333},
                frameRate: 25
            },
            audio: true
        });
        // me.webcamStream = await navigator.mediaDevices.getDisplayMedia()
    }
    // sendTracksToPeers(me.webcamStream);
}

// function loop(){
//     let videos = Array.from(document.querySelectorAll(".video"));
//     let me = getPeerById(myId);

//     for(let peer of peers){
//         let webcam = document.querySelector(`#video-${peer.id}`);
//         let screen = document.querySelector(`#screen-${peer.id}`);

//         if(webcam === null){
//             console.log(`Creating webcam div for ${peer.id}`)
//             createWebcamDiv(peer);
//         }

//         if(screen === null && peer.screenStream){
//             console.log(`Creating screen div for ${peer.id}`)
//             createScreenDiv(peer);
//         }

//         if(webcam.srcObject === null && peer.webcamStream){
//             console.log(`adding srcObject for ${peer.id}`)
//             webcam.srcObject = peer.webcamStream;
//             webcam.muted = true;
//         }
//     }

//     // Weird hack...
//     // If we don't have someone's video, let's send them ours.
//     if(me.webcamStream){
//         for(let peer of peers){
//             let video = document.querySelector(`#video-${peer.id}`)
//             if(video && video.srcObject === null){
//                 sendTracksToPeers(me.webcamStream);
//                 break;
//             }
//         }
//     }
//     else{
//         enableCamera();
//     }

//     // setTimeout(loop, 1000);
// }
// setInterval(loop, 1000);


function createWebcamDivButtons(user){
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




window.createWebcamDiv = function(user){
    let videos = document.getElementById("videos");
    

    let videoDiv = document.createElement("div");
    videoDiv.classList.add("videoDiv")
    videoDiv.addEventListener("dblclick", function(e){
        if(document.fullscreenElement == videoDiv)
            document.exitFullscreen();
        else
            videoDiv.requestFullscreen();
    })

    let video = document.createElement("video");
    video.classList.add("video");
    if(user.id == myId)
        video.classList.add("flipVideo");
    video.id = `video-${user.id}`;
    video.autoplay = true;
    
    videoDiv.append(video);
    videoDiv.innerHTML += `${user.name}'s Webcam`
    videoDiv.append(createWebcamDivButtons(user));

    videos.append(videoDiv);
}

function removePeer(id){
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
            if(user.id != myId)
                p = createPeerConnection(user.id);
            console.log(`Became aware of user ${user.id}`)
            newUsers.push(user);
            newConns.push(p);
        }
    }

    newConns = await Promise.all(newConns);
    for (let [user, connection] of zip(newUsers, newConns)) {
        user.conn = connection;
        if (user.conn && myId < user.id){
            console.log(`Creating data channel for ${user.id}`)
            user.dc = user.conn.createDataChannel(`chat_channel_with_${user.id}`);        
        }
        peers.push(user);
        createWebcamDiv(user);
    }
    // enableCamera();

    // remove peers that have left.
    window.msg = msg;
    for (let peer of peers){
        if(msg.users.filter(user => user.id == peer.id).length == 0){
            removePeer(peer.id);
        }
    }
}


function addToChat(message) {
    console.log("adding message to chat: ", message);
    message = JSON.parse(message.data);
    let text = `[${new Date().toLocaleTimeString()}] <b>${message.user}</b>: ${message.body}<br><br>`;
    document.querySelector("#messages").innerHTML += text;
    // chatBox.scrollTop = chatBox.scrollHeight - chatBox.clientHeight;
}


export function chat(message) {
    message = {
        body: message,
        user: getPeerById(myId).name,
    }

    for (let peer of peers) {
        if (peer.id != myId)
            peer.dc.send(JSON.stringify(message))
    }

    addToChat({data: JSON.stringify(message)});
}










/* ICE HELPERS BELOW HERE... */

/* Signaling messages from the server */
async function handleVideoOfferMsg(msg) {
    let peer = getPeerById(msg.sender);
    console.log(`Received video offer from ${peer.id}`)

    let desc = new RTCSessionDescription(msg.sdp);
    await peer.conn.setRemoteDescription(desc);

    let answer = await peer.conn.createAnswer();
    await peer.conn.setLocalDescription(answer);
    console.log(`Sending video answer to ${peer.id}`)
    sendToServer({
        sender: myId,
        target: peer.id,
        type: "video-answer",
        answer: peer.conn.localDescription
    });
}

async function handleVideoAnswerMsg(msg) {
    let peer = getPeerById(msg.sender);
    console.log(`Received video answer from ${peer.id}`)
    console.log(msg.answer);

    let desc = new RTCSessionDescription(msg.answer)
    window.desc = desc;
    await peer.conn.setRemoteDescription(desc);
}

async function handleNewICECandidateMsg(msg) {
    var candidate = new RTCIceCandidate(msg.candidate);
    let peer = getPeerById(msg.sender);

    window.iceConnectionState = JSON.parse(JSON.stringify(peer.conn.iceConnectionState));
    if(!["new", "checking", "connected"].includes(peer.conn.iceConnectionState)){
        try{
            await peer.conn.addIceCandidate(candidate);
        }
        catch(e){
            window.msg = msg;
            window.candidate = candidate;
            window.icePeer = peer;
            console.log(window.iceConnectionState);
            console.error(e);
        }
    }
}

function handleHangUpMsg(msg) {
    console.log(`Need to implement handleHangUpMsg: `, msg);
}


/* Handlers for local ICE async events */
async function createPeerConnection(targetId) {
    console.log(`Setting up a connection with ${targetId}...`);

    let conn = new RTCPeerConnection({ iceServers: [{ 'urls': 'stun:stun.l.google.com:19302' }] });
    let peer = getPeerById(targetId);

    // Set up event handlers for the ICE negotiation process.
    conn.onicecandidate = handleICECandidateEvent(targetId);
    conn.oniceconnectionstatechange = handleICEConnectionStateChangeEvent(conn);
    conn.onicegatheringstatechange = handleICEGatheringStateChangeEvent(conn);
    conn.onsignalingstatechange = handleSignalingStateChangeEvent(conn);
    conn.onnegotiationneeded = handleNegotiationNeededEvent(targetId, conn);
    conn.ontrack = handleTrackEvent(targetId);

    conn.ondatachannel = function (event) {
        console.log(`received data channel from ${targetId}`)
        peer.dc = event.channel;
        event.channel.onmessage = function (message) {
            addToChat(message);
        };
    }

    return conn;
}

function handleICECandidateEvent(targetId) {
    return function (event) {
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
    return function (event) {
        // console.log("*** ICE connection state changed to " + connection.iceConnectionState);

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
    return function (event) {
        // console.log("*** ICE gathering state changed to: " + connection.iceGatheringState);
    }
}

function handleSignalingStateChangeEvent(connection) {
    return function (event) {
        // console.log("*** WebRTC signaling state changed to: " + connection.signalingState);
        if (connection.signalingState == "closed")
            closeVideoCall();
    }
}

function handleNegotiationNeededEvent(targetId, connection) {
    return async function () {
        console.log("*** Negotiation needed");

        try {
            // Send the offer to the remote peer.
            if(myId < targetId){
                console.log("---> Creating offer");
                const offer = await connection.createOffer();
    
                if (connection.signalingState != "stable") {
                    console.log("     -- The connection isn't stable yet; postponing...")
                    return;
                }
    
                await connection.setLocalDescription(offer);
                console.log("---> Sending the offer to the remote peer");
                sendToServer({
                    sender: myId,
                    target: targetId,
                    type: "video-offer",
                    sdp: connection.localDescription
                });
            }
        } catch (err) {
            console.log("*** The following error occurred while handling the negotiationneeded event:");
            console.error(err);
        };
    }
}

function handleTrackEvent(targetId){
    return function(event) {
        let peer = getPeerById(targetId);

        console.log(`*** Track Received from ${peer.id}`);
        console.log(event);
        

        if(peer.webcamStream === undefined)
            peer.webcamStream = new MediaStream();
        
        if(peer.webcamStream.getVideoTracks().length == 0 && event.track.kind == "video")
            peer.webcamStream.addTrack(event.track)
        else if(peer.webcamStream.getAudioTracks().length == 0 && event.track.kind == "audio")
            peer.webcamStream.addTrack(event.track)

        document.getElementById(`video-${targetId}`).srcObject = peer.webcamStream;
    }
}