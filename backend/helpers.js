let fs = require('fs');
let https = require('https');
let WebSocketServer = require('websocket').server;


exports.getWsServer = function(port, keyFile, certFile){
    let options = {
        key: fs.readFileSync(keyFile), 
        cert: fs.readFileSync(certFile)
    };
    
    let webServer = https.createServer(options, function(request, response) {
        response.writeHead(404);
        response.end();
    });
    
    webServer.listen(port);
    
    let wsServer = new WebSocketServer({
        httpServer: webServer,
        autoAcceptConnections: false
    });
    
    return wsServer;
}



exports.sendUserList = function(room){
    function formatUser(user){
        return {
            name: user.name,
            id: user.userId
        }
    }

    let userListMsg = {
        type: "userlist",
        users: room.map(formatUser)
    }

    for(let conn of room)
        conn.send(userListMsg);
}

// Message handlers from here down.
exports.signal = function(connection, msg, state){

}

exports.message = function(connection, msg, state){

}

exports.joinRoom = function(connection, msg, state){
    if(connection.userId == msg.id){
        // remove them from their old room
        if(connection.room == null)
            state.notInARoom = state.notInARoom.filter(x => x.userId != msg.id);
        else
            state.rooms[connection.room] = state.rooms[connection.room].filter(x => x.userId != msg.id);

        // join the new room.
        if(!(msg.room in state.rooms))
            state.rooms[msg.room] = [];

        state.rooms[msg.room].push(connection);
        connection.room = msg.room;
        connection.name = msg.name;

        exports.sendUserList(state.rooms[msg.room]);
    }
}

