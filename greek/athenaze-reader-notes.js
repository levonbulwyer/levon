/* ============================================================
   Athenaze Greek reader engine.
   Expects window.LESSONS = {lessons:[{num,title,mode,utterances,utterances_en,
   exercise_lines,exercise_lines_en,extras:[{heading,lines,lines_en}]}], missing:[N,...]}
   Every line has a stable id: L{num}-t{i} / L{num}-e{i} / L{num}-x{k}-{i},
   and its audio lives at audio/{num}/{id}.mp3
   ============================================================ */
(function(){
"use strict";
var DATA = window.LESSONS || {lessons:[], missing:[]};
var GAP_MS = 350;        // pause between clips in a lesson playlist
var LOOP_GAP_MS = 700;   // pause before a looped clip/playlist restarts

function el(tag, cls, text){
  var e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text != null) e.textContent = text;
  return e;
}

/* ---------------- saved progress (this browser only) ---------------- */
var KEY_KNOWN = "athenaze-known", KEY_NOTES = "athenaze-notes";
function load(key, fallback){
  try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch(e){ return fallback; }
}
function save(key, val){
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(e){}
}
var known = load(KEY_KNOWN, []);          // [lesson numbers]
var notes = load(KEY_NOTES, {});          // {lessonNum or "general": text}
var chipFor = {};                         // lessonNum -> nav chip
var sectionFor = {};                      // lessonNum -> <section>

function isKnown(n){ return known.indexOf(n) !== -1; }
function setKnown(n, on){
  known = known.filter(function(k){ return k !== n; });
  if(on) known.push(n);
  known.sort(function(a,b){ return a-b; });
  save(KEY_KNOWN, known);
  refreshKnown(n);
}
function refreshKnown(n){
  var on = isKnown(n);
  if(chipFor[n]) chipFor[n].classList.toggle("chip-known", on);
  if(sectionFor[n]) sectionFor[n].classList.toggle("known", on);
  var c = document.getElementById("knownCount");
  if(c) c.textContent = "Known " + known.length + "/" + DATA.lessons.length;
}

/* ---------------- navigation ---------------- */
function buildNav(){
  var nav = document.getElementById("chips");
  var all = DATA.lessons.map(function(l){return l.num;}).concat(DATA.missing).sort(function(a,b){return a-b;});
  all.forEach(function(n){
    if(DATA.missing.indexOf(n) !== -1){
      var span = el("span", "chip chip-missing", String(n));
      span.title = "Not in this reader";
      nav.appendChild(span);
    } else {
      var a = el("a", "chip", String(n));
      a.href = "#lesson-" + n;
      chipFor[n] = a;
      nav.appendChild(a);
    }
  });
}

/* ---------------- audio engine ----------------
   One <audio> element. A "session" is a queue of {src,row} played in order,
   owned by one play button and its paired loop button. */
var player = null;
var session = null;
var gapTimer = null;

function clearNow(){
  var cur = document.querySelectorAll(".line.now");
  for(var i=0;i<cur.length;i++) cur[i].classList.remove("now");
}

function stopSession(){
  if(gapTimer){ clearTimeout(gapTimer); gapTimer = null; }
  if(player){ player.pause(); player.onended = null; player.onerror = null; }
  if(session){ session.btn.classList.remove("playing"); }
  clearNow();
  session = null;
}

function playIndex(s){
  if(session !== s) return;
  var item = s.queue[s.idx];
  clearNow();
  if(item.row){
    item.row.classList.add("now");
    if(s.queue.length > 1) item.row.scrollIntoView({block:"nearest", behavior:"smooth"});
  }
  player.src = item.src;
  player.onended = function(){ advance(s); };
  player.onerror = function(){ advance(s); };   // skip a missing clip rather than stall
  var p = player.play();
  if(p && p.catch) p.catch(function(){});
}

function advance(s){
  if(session !== s) return;
  s.idx++;
  if(s.idx < s.queue.length){
    gapTimer = setTimeout(function(){ playIndex(s); }, GAP_MS);
  } else if(s.loopBtn.classList.contains("on")){
    s.idx = 0;
    gapTimer = setTimeout(function(){ playIndex(s); }, LOOP_GAP_MS);
  } else {
    stopSession();
  }
}

function startSession(queue, btn, loopBtn){
  if(!player) player = document.getElementById("player");
  var wasMine = session && session.btn === btn;
  stopSession();
  if(wasMine) return;              // second click on a playing button = stop
  session = {queue:queue, idx:0, btn:btn, loopBtn:loopBtn};
  btn.classList.add("playing");
  playIndex(session);
}

function makeControls(getQueue, big){
  var wrap = el("span", big ? "ctrls ctrls-big" : "ctrls");
  var play = el("button", big ? "lesson-play" : "play-btn", big ? "⏵" : "▶");
  play.type = "button";
  play.title = big ? "Play whole chapter" : "Play line";
  var loop = el("button", big ? "loop-btn loop-big" : "loop-btn", "↻");
  loop.type = "button";
  loop.title = big ? "Loop whole chapter" : "Loop this line";
  play.addEventListener("click", function(e){
    e.preventDefault();
    startSession(getQueue(), play, loop);
  });
  loop.addEventListener("click", function(e){
    e.preventDefault();
    loop.classList.toggle("on");
    // turning loop on for something not yet playing starts it
    if(loop.classList.contains("on") && !(session && session.btn === play)){
      startSession(getQueue(), play, loop);
    }
  });
  wrap.appendChild(play);
  wrap.appendChild(loop);
  return wrap;
}

/* ---------------- lesson rendering ---------------- */
function lineRow(id, fr, en, extraCls, src, registry){
  var row = el("div", "line" + (extraCls ? " " + extraCls : ""));
  row.id = id;
  registry.push({src:src, row:row});
  row.appendChild(makeControls(function(){ return [{src:src, row:row}]; }, false));
  var txt = el("div", "txt");
  txt.appendChild(el("span", "fr", fr));
  if(en) txt.appendChild(el("span", "en", en));
  row.appendChild(txt);
  return row;
}

function buildLesson(l, parent){
  var sec = el("section", "lesson");
  sec.id = "lesson-" + l.num;
  var all = [];                    // every clip in reading order, for the lesson playlist
  var base = "audio/" + l.num + "/";

  var h = el("div", "lesson-h");
  h.appendChild(el("span", "lnum", "Chapter " + l.num));
  h.appendChild(el("span", "ltitle", l.title));
  h.appendChild(makeControls(function(){ return all.slice(); }, true));
  sec.appendChild(h);

  var textBlock = el("div", "block text-block " + (l.mode === "dialogue" ? "dialogue" : "narrative"));
  l.utterances.forEach(function(u, i){
    var cls = l.mode === "dialogue" ? (i % 2 === 0 ? "turn turn-a" : "turn turn-b") : "sent";
    var id = "L" + l.num + "-t" + i;
    textBlock.appendChild(lineRow(id, u, (l.utterances_en||[])[i], cls, base + id + ".mp3", all));
  });
  sec.appendChild(textBlock);

  if(l.exercise_lines && l.exercise_lines.length){
    var exWrap = el("div", "block ex-block");
    exWrap.appendChild(el("div", "block-h", "Exercice"));
    l.exercise_lines.forEach(function(u, i){
      var id = "L" + l.num + "-e" + i;
      exWrap.appendChild(lineRow(id, u, (l.exercise_lines_en||[])[i], "ex-line", base + id + ".mp3", all));
    });
    sec.appendChild(exWrap);
  }

  (l.extras || []).forEach(function(x, k){
    var xWrap = el("div", "block extra-block");
    xWrap.appendChild(el("div", "block-h", x.heading));
    x.lines.forEach(function(u, i){
      var id = "L" + l.num + "-x" + k + "-" + i;
      xWrap.appendChild(lineRow(id, u, (x.lines_en||[])[i], (x.cls||"verse-line"), base + id + ".mp3", all));
    });
    sec.appendChild(xWrap);
  });

  /* end-of-lesson: "I know this" + notes for Claude */
  var foot = el("div", "lesson-foot");
  var lab = el("label", "known-box");
  var cb = el("input");
  cb.type = "checkbox";
  cb.checked = isKnown(l.num);
  cb.addEventListener("change", function(){ setKnown(l.num, cb.checked); });
  lab.appendChild(cb);
  lab.appendChild(el("span", null, "I know this chapter — no revision needed"));
  foot.appendChild(lab);
  foot.appendChild(noteBox(String(l.num),
    "Notes for Claude on this chapter — grammar questions, corrections, things to explain or add…"));
  sec.appendChild(foot);

  sectionFor[l.num] = sec;
  parent.appendChild(sec);
  refreshKnown(l.num);
}

/* a textarea that saves as you type and grows with its content */
function noteBox(key, placeholder){
  var ta = el("textarea", "note");
  ta.placeholder = placeholder;
  ta.rows = 2;
  ta.value = notes[key] || "";
  var t = null;
  function grow(){ ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px"; }
  ta.addEventListener("input", function(){
    grow();
    clearTimeout(t);
    t = setTimeout(function(){
      if(ta.value.trim()) notes[key] = ta.value; else delete notes[key];
      save(KEY_NOTES, notes);
      refreshNotesPanel();
    }, 300);
  });
  setTimeout(grow, 0);
  return ta;
}

/* ---------------- bottom panel: gather everything for Claude ---------------- */
function compileNotes(){
  var byNum = {};
  DATA.lessons.forEach(function(l){ byNum[l.num] = l; });
  var out = ["Athenaze Greek reader — notes for Claude (" + new Date().toISOString().slice(0,10) + ")"];
  out.push("Known chapters: " + (known.length ? known.join(", ") : "none") + " (" + known.length + "/" + DATA.lessons.length + ")");
  Object.keys(notes).filter(function(k){ return k !== "general"; })
    .sort(function(a,b){ return a-b; })
    .forEach(function(k){
      var l = byNum[k];
      out.push("");
      out.push("Chapter " + k + (l ? " — " + l.title : "") + ":");
      out.push(notes[k].trim());
    });
  if(notes.general){ out.push(""); out.push("General:"); out.push(notes.general.trim()); }
  return out.join("\n");
}

function refreshNotesPanel(){
  var n = Object.keys(notes).length;
  var s = document.getElementById("notesStatus");
  if(s) s.textContent = n ? n + (n === 1 ? " note" : " notes") + " ready to send" : "No notes yet";
}

function buildNotesPanel(){
  var host = document.getElementById("notesPanel");
  if(!host) return;
  host.appendChild(el("div", "panel-h", "Notes for Claude"));
  host.appendChild(el("p", "panel-sub",
    "Anything not tied to one lesson goes here. “Copy for Claude” gathers this plus every lesson's notes and your known-lessons list into one message — paste it into our chat and I'll make the updates."));
  host.appendChild(noteBox("general", "General notes — features you want, things that feel off, questions…"));

  var row = el("div", "panel-actions");
  var copy = el("button", "btn btn-primary", "Copy for Claude");
  copy.type = "button";
  copy.addEventListener("click", function(){
    var text = compileNotes();
    function done(){ copy.textContent = "Copied ✓ — paste it into the chat"; setTimeout(function(){ copy.textContent = "Copy for Claude"; }, 2500); }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done, function(){ fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  });
  var dl = el("button", "btn", "Save as file");
  dl.type = "button";
  dl.addEventListener("click", function(){
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([compileNotes()], {type:"text/plain"}));
    a.download = "athenaze-notes-" + new Date().toISOString().slice(0,10) + ".txt";
    document.body.appendChild(a); a.click(); a.remove();
  });
  var clear = el("button", "btn btn-quiet", "Clear notes");
  clear.type = "button";
  var armed = false, armT = null;
  clear.addEventListener("click", function(){
    if(!armed){
      armed = true; clear.textContent = "Click again to clear all notes";
      armT = setTimeout(function(){ armed = false; clear.textContent = "Clear notes"; }, 3000);
      return;
    }
    clearTimeout(armT); armed = false; clear.textContent = "Clear notes";
    notes = {}; save(KEY_NOTES, notes);
    var boxes = document.querySelectorAll("textarea.note");
    for(var i=0;i<boxes.length;i++){ boxes[i].value = ""; boxes[i].style.height = "auto"; }
    refreshNotesPanel();
  });
  row.appendChild(copy); row.appendChild(dl); row.appendChild(clear);
  row.appendChild(el("span", "panel-status")).id = "notesStatus";
  host.appendChild(row);
  refreshNotesPanel();
}

function fallbackCopy(text){
  var ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch(e){}
  ta.remove();
}

buildNav();
var reader = document.getElementById("reader");
DATA.lessons.forEach(function(l){ buildLesson(l, reader); });
buildNotesPanel();

/* ---------------- "Hide known" switch ---------------- */
var hideKnown = document.getElementById("hideKnown");
if(hideKnown){
  try { hideKnown.checked = localStorage.getItem("athenaze-hide-known") === "1"; } catch(e){}
  document.body.classList.toggle("hide-known", hideKnown.checked);
  hideKnown.addEventListener("change", function(){
    document.body.classList.toggle("hide-known", hideKnown.checked);
    try { localStorage.setItem("athenaze-hide-known", hideKnown.checked ? "1" : "0"); } catch(e){}
  });
}

/* ---------------- English toggle (remembered per browser) ---------------- */
var enToggle = document.getElementById("enToggle");
function applyEn(){ document.body.classList.toggle("hide-en", !enToggle.checked); }
if(enToggle){
  try { if(localStorage.getItem("athenaze-hide-en") === "1") enToggle.checked = false; } catch(e){}
  applyEn();
  enToggle.addEventListener("change", function(){
    applyEn();
    try { localStorage.setItem("athenaze-hide-en", enToggle.checked ? "0" : "1"); } catch(e){}
  });
}

/* ---------------- jump-to-chapter box ---------------- */
var jump = document.getElementById("jumpBox");
if(jump){
  jump.addEventListener("keydown", function(e){
    if(e.key === "Enter"){
      var target = document.getElementById("lesson-" + parseInt(jump.value, 10));
      if(target) target.scrollIntoView({behavior:"smooth", block:"start"});
    }
  });
}

/* Esc stops whatever is playing */
document.addEventListener("keydown", function(e){ if(e.key === "Escape") stopSession(); });
})();
