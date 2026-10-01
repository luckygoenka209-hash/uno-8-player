const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const COLORS = ["red","yellow","green","blue"];
const TYPES = ["0","1","2","3","4","5","6","7","8","9","skip","reverse","draw2"];

function makeDeck() {
  const d = [];
  for (const color of COLORS) {
    d.push({color,type:"0"});
    for (const type of TYPES.slice(1)) {
      d.push({color,type},{color,type});
    }
  }
  for (let i=0;i<4;i++) d.push({color:"wild",type:"wild"},{color:"wild",type:"draw4"});
  return d;
}
function shuffle(a) {
  for (let i=a.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function cardName(c) {
  return c.type === "draw2" ? "+2" : c.type === "draw4" ? "+4" :
    c.type === "reverse" ? "↔" : c.type === "skip" ? "⊘" : c.type === "wild" ? "WILD" : c.type;
}
function publicState(room) {
  return {
    players: room.players.map(p => ({id:p.id,name:p.name,count:p.hand.length})),
    top: room.discard[room.discard.length-1],
    currentColor: room.currentColor,
    turn: room.players[room.turn]?.id,
    started: room.started,
    winner: room.winner || null
  };
}
function broadcast(room) {
  io.to(room.id).emit("state", publicState(room));
  for (const p of room.players) io.to(p.id).emit("hand", p.hand);
}
function refill(room) {
  if (room.deck.length) return;
  const top=room.discard.pop();
  room.deck=shuffle(room.discard.splice(0));
  room.discard=[top];
}
function draw(room, p, n=1) {
  const got=[];
  for(let i=0;i<n;i++){
    refill(room);
    if(!room.deck.length) break;
    got.push(room.deck.pop());
  }
  p.hand.push(...got);
  return got;
}
function nextTurn(room, steps=1) {
  room.turn = (room.turn + steps) % room.players.length;
}
function start(room) {
  if(room.players.length<2) return false;
  room.deck=shuffle(makeDeck());
  room.discard=[];
  room.currentColor=null;
  room.winner=null;
  for(const p of room.players) p.hand=[];
  for(let i=0;i<7;i++) for(const p of room.players) draw(room,p,1);
  let first=room.deck.pop();
  while(first.color==="wild") { room.deck.unshift(first); first=room.deck.pop(); }
  room.discard.push(first);
  room.currentColor=first.color;
  room.turn=0;
  room.started=true;
  if(first.type==="skip") nextTurn(room,1);
  else if(first.type==="reverse") nextTurn(room, room.players.length>2 ? room.players.length-1 : 1);
  else if(first.type==="draw2") { draw(room,room.players[room.turn],2); nextTurn(room,1); }
  return true;
}
function canPlay(card, room) {
  const top=room.discard[room.discard.length-1];
  return card.color==="wild" || card.color===room.currentColor || card.type===top.type;
}
function play(room,p,idx,colorChoice) {
  if(room.players[room.turn]?.id!==p.id) return {error:"Not your turn."};
  const card=p.hand[idx];
  if(!card || !canPlay(card,room)) return {error:"You cannot play that card."};
  if((card.type==="draw4") && !colorChoice) return {error:"Choose a color for +4."};
  p.hand.splice(idx,1);
  room.discard.push(card);
  if(card.color==="wild") room.currentColor=colorChoice;
  else room.currentColor=card.color;

  if(p.hand.length===0) {
    room.winner=p.name; room.started=false; return {};
  }
  let steps=1;
  if(card.type==="skip") steps=2;
  if(card.type==="reverse") steps = room.players.length===2 ? 2 : room.players.length-1;
  if(card.type==="draw2") {
    nextTurn(room,1);
    draw(room,room.players[room.turn],2);
    steps=1;
  } else if(card.type==="draw4") {
    nextTurn(room,1);
    draw(room,room.players[room.turn],4);
    steps=1;
  }
  nextTurn(room,steps);
  return {};
}

io.on("connection", socket => {
  socket.on("createRoom", ({name}, cb) => {
    let id;
    do { id=Math.random().toString(36).slice(2,7).toUpperCase(); } while(rooms.has(id));
    const room={id,players:[],deck:[],discard:[],turn:0,currentColor:null,started:false,winner:null};
    rooms.set(id,room);
    join(socket,room,name,cb);
  });
  socket.on("joinRoom", ({roomId,name},cb) => {
    const room=rooms.get(String(roomId||"").toUpperCase());
    if(!room) return cb({ok:false,error:"Room not found."});
    if(room.players.length>=8) return cb({ok:false,error:"Room is full (8 players maximum)."});
    if(room.started) return cb({ok:false,error:"Game already started."});
    join(socket,room,name,cb);
  });
  function join(socket,room,name,cb) {
    const clean=String(name||"Player").trim().slice(0,18)||"Player";
    const p={id:socket.id,name:clean,hand:[]};
    room.players.push(p); socket.join(room.id); socket.roomId=room.id;
    cb({ok:true,roomId:room.id});
    broadcast(room);
  }
  socket.on("startGame", cb => {
    const room=rooms.get(socket.roomId);
    if(!room) return cb?.({ok:false,error:"Room missing."});
    if(room.players[0]?.id!==socket.id) return cb?.({ok:false,error:"Only the host can start."});
    if(!start(room)) return cb?.({ok:false,error:"Need at least 2 players."});
    broadcast(room); cb?.({ok:true});
  });
  socket.on("playCard", ({index,color},cb) => {
    const room=rooms.get(socket.roomId); if(!room) return;
    const p=room.players.find(x=>x.id===socket.id); if(!p) return;
    const r=play(room,p,index,color);
    cb?.({ok:!r.error,error:r.error});
    if(!r.error) broadcast(room);
  });
  socket.on("drawCard", cb => {
    const room=rooms.get(socket.roomId); if(!room||!room.started) return;
    const p=room.players[room.turn];
    if(p.id!==socket.id) return cb?.({ok:false,error:"Not your turn."});
    draw(room,p,1); nextTurn(room,1); broadcast(room); cb?.({ok:true});
  });
  socket.on("uno", () => {
    const room=rooms.get(socket.roomId); if(room) io.to(room.id).emit("message", `${room.players.find(p=>p.id===socket.id)?.name||"Player"} called UNO!`);
  });
  socket.on("disconnect", () => {
    const room=rooms.get(socket.roomId); if(!room) return;
    const idx=room.players.findIndex(p=>p.id===socket.id);
    if(idx>=0) {
      room.players.splice(idx,1);
      if(room.players.length===0) rooms.delete(room.id);
      else {
        if(room.turn>=room.players.length) room.turn=0;
        if(room.players.length<2) room.started=false;
        broadcast(room);
      }
    }
  });
});

server.listen(process.env.PORT||3000,()=>console.log("UNO server running"));
