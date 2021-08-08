let helpers = require("./helpers.js");

let state = {
    notInARoom: [],
    rooms: {},
}

let newUserId = 0;

let ws;
if(process.argv.length > 2 && process.argv[2] === "secure"){
    console.log(`Running Securely...`);
    ws = helpers.getWssServer(6503, "key.pem", "cert.crt");
}
else{
    console.log(`Running Insecurely...`);
    ws = helpers.getWsServer(6503);
}
ws.on("request", function(request) {
    let connection = request.accept("json", request.origin);
    newUserId++;

    connection.on("message", handleMessage(connection));
    connection.on("close", handleClose(connection));
    connection.userId = newUserId;
    connection.room = null;
    connection.send = data => connection.sendUTF(JSON.stringify(data));

    state.notInARoom.push(connection);

    connection.send({
        type: "id",
        id: newUserId
    });
});


function status() {
    console.log(state.notInARoom.map(x => x.userId));
    for (let room of Object.keys(state.rooms)) {
        console.log("-----------------------------------------------");
        console.log(room);
        console.log(state.rooms[room].map(user => user.userId));
        console.log("-----------------------------------------------");
    }
}

function handleMessage(connection) {
    return function(messageText) {
        console.log(messageText);
        status();

        if (messageText.type === "utf8") {
            let msg = JSON.parse(messageText.utf8Data);
            if (["joinRoom"].includes(msg.type))
                helpers[msg.type](connection, msg, state);
            else {
                if (msg.target && connection.room != null) {
                    let target = state.rooms[connection.room].filter(x => x.userId == msg.target)[0];
                    if (target !== undefined)
                        target.send(msg);
                }
            }
        }
    }
}

function handleClose(connection) {
    return function(reason, description) {
        if (state.notInARoom.includes(connection)) {
            state.notInARoom = state.notInARoom.filter(x => x.connected);
        } else {
            for (let r of Object.keys(state.rooms)) {
                if (state.rooms[r].includes(connection)) {
                    state.rooms[r] = state.rooms[r].filter(x => x.connected);
                    helpers.sendUserList(state.rooms[r]);
                    break;
                }
            }
        }
    }
}