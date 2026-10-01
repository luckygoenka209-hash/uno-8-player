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
    for (const type of TYPES.slice(1)) d.push({color,type},{color,type});
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
function publicState(room) {
  return {
    players: room.players.map(p => ({id:p.id,name:p.name,count:p.hand.length,saidUno:p.saidUno})),
    top: room.discard[room.discard.length-1],
    currentColor: room.currentColor,
    turn: room.players[room.turn]?.id,
    started: room.started,
    winner: room.winner || null,
    pendingPenalty: room.pendingPenalty,
    penaltyType: room.penaltyType
  };
}
function refill(room) {
  if (room.deck.length) return;
  if (room.discard.length <= 1) return;
  const top=room.discard.pop();
  room.deck=shuffle(room.discard.splice(0));
  room.discard=[top];
}
function draw(room,p,n=1) {
  const got=[];
  for(let i=0;i<n;i++){
    refill(room);
    if(!room.deck.length) break;
    got.push(room.deck.pop());
  }
  p.hand.push(...got);
  return got;
}
function nextTurn(room,steps=1) {
  room.turn = (room.turn + steps) % room.players.length;
}
function start(room) {
  if(room.players.length<2) return false;
  room.deck=shuffle(makeDeck());
  room.discard=[]; room.currentColor=null; room.winner=null;
  room.pendingPenalty=0; room.penaltyType=null;
  for(const p of room.players){p.hand=[];p.saidUno=false;}
  for(let i=0;i<7;i++) for(const p of room.players) draw(room,p,1);

  let first=room.deck.pop();
  while(first.color==="wild"){ room.deck.unshift(first); first=room.deck.pop(); }
  room.discard.push(first); room.currentColor=first.color; room.turn=0; room.started=true;

  if(first.type==="skip") nextTurn(room,1);
  else if(first.type==="reverse") nextTurn(room, room.players.length>2 ? room.players.length-1 : 1);
  else if(first.type==="draw2"){
    room.pendingPenalty=2; room.penaltyType="draw2";
  }
  return true;
}
function basePlayable(card, room) {
  const top=room.discard[room.discard.length-1];
  if(card.color==="wild") return true;
  return card.color===room.currentColor || card.type===top.type;
}
function validateCombo(room,p,indices) {
  if(!Array.isArray(indices) || indices.length<1) return "Select at least one card.";
  const unique=[...new Set(indices)].sort((a,b)=>a-b);
  if(unique.some(i=>!Number.isInteger(i)||i<0||i>=p.hand.length)) return "Invalid card selection.";
  const cards=unique.map(i=>p.hand[i]);
  if(!basePlayable(cards[0],room)) return "The first card cannot be played.";

  const first=cards[0];
  if(first.type==="draw2" || first.type==="draw4") {
    if(!cards.every(c=>c.type===first.type)) return "Stack only the same penalty type.";
    return null;
  }
  if(/^[0-9]$/.test(first.type)) {
    if(!cards.every(c=>c.type===first.type)) return "Number combo requires the same number.";
    return null;
  }
  if(cards.length>1) return "Only same-number cards and identical +2/+4 cards can be combined.";
  return null;
}
function playCombo(room,p,indices,colorChoice) {
  if(room.players[room.turn]?.id!==p.id) return {error:"Not your turn."};
  const err=validateCombo(room,p,indices);
  if(err) return {error:err};

  const unique=[...new Set(indices)].sort((a,b)=>b-a);
  const cards=unique.map(i=>p.hand[i]).reverse();
  const first=cards[0];

  if(first.type==="draw4" && !colorChoice) return {error:"Choose a color for +4."};
  for(const i of unique) p.hand.splice(i,1);
  room.discard.push(...cards);

  if(first.color==="wild") room.currentColor=colorChoice;
  else room.currentColor=first.color;

  const comboSize=cards.length;
  p.saidUno=false;

  if(p.hand.length===0){
    room.winner=p.name; room.started=false; return {};
  }

  if(p.hand.length===1){
    // Player must press UNO before the next player acts.
    p.saidUno=false;
  }

  if(first.type==="draw2" || first.type==="draw4"){
    room.pendingPenalty=(room.pendingPenalty||0) + comboSize*(first.type==="draw2"?2:4);
    room.penaltyType=first.type;
    nextTurn(room,1);
  } else if(first.type==="skip"){
    nextTurn(room,2);
  } else if(first.type==="reverse"){
    nextTurn(room, room.players.length===2 ? 2 : room.players.length-1);
  } else {
    nextTurn(room,1);
  }
  return {};
}
function enforceUnoPenalty(room,p) {
  // House rule: if a player has one card and did not call UNO before the
  // next turn starts, they draw 2 cards when their turn arrives.
  if(p.hand.length===1 && !p.saidUno){
    draw(room,p,2);
    p.saidUno=false;
    return true;
  }
  return false;
}

io.on("connection", socket => {
  socket.on("createRoom", ({name}, cb) => {
    let id;
    do { id=Math.random().toString(36).slice(2,7).toUpperCase(); } while(rooms.has(id));
    const room={id,players:[],deck:[],discard:[],turn:0,currentColor:null,started:false,winner:null,pendingPenalty:0,penaltyType:null};
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
  function join(socket,room,name,cb){
    const clean=String(name||"Player").trim().slice(0,18)||"Player";
    room.players.push({id:socket.id,name:clean,hand:[],saidUno:false});
    socket.join(room.id); socket.roomId=room.id;
    cb({ok:true,roomId:room.id}); broadcast(room);
  }
  function broadcast(room){
    io.to(room.id).emit("state",publicState(room));
    for(const p of room.players) io.to(p.id).emit("hand",p.hand);
  }

  socket.on("startGame",cb=>{
    const room=rooms.get(socket.roomId); if(!room) return cb?.({ok:false,error:"Room missing."});
    if(room.players[0]?.id!==socket.id) return cb?.({ok:false,error:"Only the host can start."});
    if(!start(room)) return cb?.({ok:false,error:"Need at least 2 players."});
    broadcast(room); cb?.({ok:true});
  });

  socket.on("playCards",({indices,color},cb)=>{
    const room=rooms.get(socket.roomId); if(!room||!room.started) return;
    const p=room.players.find(x=>x.id===socket.id); if(!p) return;

    // UNO penalty is checked when the player's next turn begins.
    if(enforceUnoPenalty(room,p)) broadcast(room);

    // If this is a pending penalty, the current player must stack the same type.
    if(room.pendingPenalty>0){
      const selected=(indices||[]).map(Number);
      if(!selected.length) return cb?.({ok:false,error:`You must stack ${room.penaltyType === "draw2" ? "+2" : "+4"} or draw ${room.pendingPenalty} cards.`});
      const cards=selected.map(i=>p.hand[i]).filter(Boolean);
      if(!cards.length || !cards.every(c=>c.type===room.penaltyType))
        return cb?.({ok:false,error:`Only another ${room.penaltyType === "draw2" ? "+2" : "+4"} can be stacked.`});
    }

    const beforePenalty=room.pendingPenalty;
    const r=playCombo(room,p,indices,color);
    if(r.error) return cb?.({ok:false,error:r.error});

    if(beforePenalty>0 && p.hand.length>=0){
      // Successfully stacked: accumulated penalty is carried forward.
      // playCombo already added this player's new penalty.
    }

    // Once the penalty has been passed to the next player, leave it active.
    // If a non-penalty card was somehow played, reset (validation prevents this).
    broadcast(room); cb?.({ok:true});
  });

  socket.on("drawCard",cb=>{
    const room=rooms.get(socket.roomId); if(!room||!room.started) return;
    const p=room.players[room.turn];
    if(p.id!==socket.id) return cb?.({ok:false,error:"Not your turn."});

    // Apply a missed-UNO penalty before the player takes their normal action.
    if(enforceUnoPenalty(room,p)) broadcast(room);

    // A player facing a +2/+4 may take the accumulated penalty instead of stacking.
    if(room.pendingPenalty>0){
      const amount=room.pendingPenalty;
      draw(room,p,amount);
      room.pendingPenalty=0; room.penaltyType=null;
    } else {
      draw(room,p,1);
    }
    p.saidUno=false;
    nextTurn(room,1);
    // The player who just got the turn is checked for an old missed UNO call.
    const now=room.players[room.turn];
    enforceUnoPenalty(room,now);
    broadcast(room); cb?.({ok:true});
  });

  socket.on("uno",cb=>{
    const room=rooms.get(socket.roomId); if(!room) return;
    const p=room.players.find(x=>x.id===socket.id); if(!p) return;
    if(p.hand.length!==1) return cb?.({ok:false,error:"You can only call UNO with one card left."});
    p.saidUno=true;
    io.to(room.id).emit("message",`${p.name} called UNO!`);
    broadcast(room); cb?.({ok:true});
  });

  socket.on("disconnect",()=>{
    const room=rooms.get(socket.roomId); if(!room) return;
    const idx=room.players.findIndex(p=>p.id===socket.id);
    if(idx>=0){
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
