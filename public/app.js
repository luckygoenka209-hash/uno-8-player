const socket=io();
const $=id=>document.getElementById(id);
let myHand=[], state=null, pendingIndex=null;
const labels={skip:"⊘",reverse:"↔",draw2:"+2",draw4:"+4",wild:"WILD"};
function cardText(c){return labels[c.type]??c.type}
function cardEl(c,small=false){
  const d=document.createElement("div"); d.className=`card ${c.color}`;
  d.textContent=cardText(c); return d;
}
function msg(t){$("msg").textContent=t||""}
function name(){return $("name").value.trim()||"Player"}
$("create").onclick=()=>socket.emit("createRoom",{name:name()},r=>r.ok?enter(r.roomId):$("homeMsg").textContent=r.error);
$("join").onclick=()=>socket.emit("joinRoom",{name:name(),roomId:$("room").value},r=>r.ok?enter(r.roomId):$("homeMsg").textContent=r.error);
function enter(id){$("home").hidden=true;$("game").hidden=false;$("roomLabel").textContent="#"+id}
$("start").onclick=()=>socket.emit("startGame",r=>{if(r&&!r.ok)msg(r.error)});
$("draw").onclick=()=>socket.emit("drawCard",r=>{if(r&&!r.ok)msg(r.error)});
$("uno").onclick=()=>socket.emit("uno");
socket.on("message",msg);
socket.on("state",s=>{state=s;render()});
socket.on("hand",h=>{myHand=h;renderHand()});
function render(){
  if(!state)return;
  $("turnLabel").textContent=state.started?`Turn: ${state.players.find(p=>p.id===state.turn)?.name||"?"}`:(state.winner?`Winner: ${state.winner}`:"Lobby");
  $("players").innerHTML="";
  state.players.forEach(p=>{let x=document.createElement("div");x.className="player"+(p.id===state.turn?" active":"");x.innerHTML=`<span>${p.name}</span><b>${p.count}</b>`;$("players").appendChild(x)});
  $("start").style.display=(!state.started&&!state.winner&&state.players.length>=2)?"inline-block":"none";
  $("top").innerHTML=""; if(state.top)$("top").appendChild(cardEl(state.top));
  $("color").textContent=state.currentColor?`Current colour: ${state.currentColor.toUpperCase()}`:"";
  if(state.winner)msg(`🏆 ${state.winner} won the game!`);
  renderHand();
}
function renderHand(){
  $("hand").innerHTML="";
  myHand.forEach((c,i)=>{
    const d=cardEl(c,true);
    const playable=state?.started && state.turn===socket.id && state && (c.color==="wild"||c.color===state.currentColor||c.type===state.top?.type);
    if(!playable)d.classList.add("disabled");
    d.onclick=()=>{if(!playable)return;if(c.type==="wild"||c.type==="draw4"){pendingIndex=i;$("modal").hidden=false}else play(i)};
    $("hand").appendChild(d);
  });
}
function play(i,color){$("modal").hidden=true;socket.emit("playCard",{index:i,color},r=>{if(r&&!r.ok)msg(r.error)})}
document.querySelectorAll(".choices button").forEach(b=>b.onclick=()=>play(pendingIndex,b.dataset.c));
