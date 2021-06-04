// Client side javascript.
import * as helpers from "./frontHelpers.js"


let chatInput = document.querySelector("#chatInput");
chatInput.addEventListener("keyup", function(e){
    if(e.key == "Enter" || e.key == "Return"){
        helpers.chat(chatInput.value);
        chatInput.value = "";
    }
});

window.joinRoom = helpers.joinRoom;
window.helpers = helpers;
