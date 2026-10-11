// FDH 16-file + Fee Schedule app logic (rebuilt)
(function(){
"use strict";
const C = window.CA_CONST || {};
const SNAP = window.CA_SNAPSHOT || [];

// ---------- helpers ----------
const fmtB = n => (n==null?0:+n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtI = n => (n==null?0:+n).toLocaleString("en-US");
const esc = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const dbg = (...a) => { if(window.bmsDebug) bmsDebug.log(...a); };

// ---------- sidebar nav ----------
const navBtns = document.querySelectorAll(".nav-btn");
navBtns.forEach(b=>b.addEventListener("click",()=>{
  navBtns.forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById("view-"+b.dataset.view).classList.add("active");
  dbg("nav -> "+b.dataset.view);
}));

// ===================== VIEW 1: FDH DASHBOARD =====================
// 8 fund groups (grouped by local pttype)
const FUND_GROUPS = [
  {key:"UC_IN",  name:"สปสช. บัตรทอง (ในเขต)", codes:["79","89"]},
  {key:"UC_OUT", name:"สปสช. บัตรทอง (นอกเขต)", codes:["90","UC"]},
  {key:"UC_OLD", name:"สปสช. (รหัสยกเลิกใช้)", codes:["BB","BD","BF","BL","BN","BP","BT","BW","CA","CC","CD","DJ","EC","ED","EE","FC","KP","LI"]},
  {key:"CSMBS",  name:"ข้าราชการ / กรมบัญชีกลาง", codes:["04","07","08","03"]},
  {key:"SSS",    name:"ประกันสังคม", codes:["34","35"]},
  {key:"MIG",    name:"ต่างด้าว / แรงงานต่างด้าว", codes:["67"]},
  {key:"SELF",   name:"ชำระเงินเอง / อื่น ๆ", codes:["10","28"]},
  {key:"OTHER",  name:"กองทุนอื่น / ไม่ได้จัดกลุ่ม", codes:[]}
];
const CODE2GROUP = {};
FUND_GROUPS.forEach(g=>g.codes.forEach(c=>CODE2GROUP[c]=g.key));

// 16-faam / 18-category reference (CHRGITEM + ADP TYPE)
const CATS = [
  [1,"ค่าห้อง / ค่าอาหาร","11","12","10"],
  [2,"อวัยวะเทียม / อุปกรณ์บำบัดรักษา","21","22","2"],
  [3,"ยาและสารอาหารทางเส้นเลือดที่ใช้ใน รพ.","31","32","แฟ้ม DRU"],
  [4,"ยาที่นำไปใช้ต่อที่บ้าน","41","42","แฟ้ม DRU"],
  [5,"เวชภัณฑ์ที่ไม่ใช่ยา","51","52","11"],
  [6,"บริการโลหิตและส่วนประกอบของโลหิต","61","62","14"],
  [7,"ตรวจวินิจฉัยทางเทคนิคการแพทย์และพยาธิวิทยา","71","72","15"],
  [8,"ตรวจวินิจฉัยและรักษาทางรังสีวิทยา","81","82","16"],
  [9,"ตรวจวินิจฉัยโดยวิธีพิเศษอื่น ๆ","91","92","9"],
  [10,"อุปกรณ์ของใช้และเครื่องมือการแพทย์","A1","A2","18"],
  [11,"ทำหัตถการและบริการวิสัญญี","B1","B2","19"],
  [12,"ค่าบริการทางการพยาบาล","C1","C2","17"],
  [13,"บริการทางทันตกรรม","D1","D2","12"],
  [14,"บริการทางกายภาพบำบัดและเวชกรรมฟื้นฟู","E1","E2","20"],
  [15,"ค่าบริการฝังเข็มฯ และอื่น ๆ","F1","F2","13"],
  [16,"ค่าบริการผ่าตัดและห้องคลอด","G1","G2","–"],
  [17,"ค่าธรรมเนียมบุคลากรทางการแพทย์","H1","H2","–"],
  [18,"บริการอื่น ๆ และส่งเสริมป้องกันโรค","I1","I2","–"]
];
document.getElementById("catBody").innerHTML = CATS.map(r=>
  "<tr><td>"+r[0]+"</td><td>"+esc(r[1])+"</td><td>"+r[2]+"</td><td>"+r[3]+"</td><td>"+r[4]+"</td></tr>"
).join("");

const SQL_FD_FUNDS = "SELECT oi.pttype, COUNT(DISTINCT oi.vn) AS visits, COUNT(*) AS items, ROUND(SUM(COALESCE(oi.sum_price,0)),2) AS total FROM opitemrece oi WHERE oi.vstdate BETWEEN :df AND :dt AND COALESCE(oi.sum_price,0) <> 0 GROUP BY oi.pttype ORDER BY total DESC LIMIT 100";
const SQL_FD_SAMPLE = "SELECT oi.vstdate, oi.hn, oi.vn, oi.pttype, nd.name AS item_name, COALESCE(oi.sum_price,0) AS amt FROM opitemrece oi JOIN nondrugitems nd ON nd.icode = oi.icode WHERE oi.vstdate BETWEEN :df AND :dt AND COALESCE(oi.sum_price,0) <> 0 ORDER BY oi.vstdate DESC LIMIT 50";

async function loadFdH(from, to){
  const msg = document.getElementById("fdhMsg");
  const btn = document.getElementById("btnFdHLoad");
  if(!from || !to){ msg.className="msg err"; msg.textContent="โปรดเลือกวันที่ต้นและวันที่สุดท้ายก่อนกดโหลด"; return; }
  if(!window.bmsData || !window.bmsData.sql){
    msg.className="msg err";
    msg.textContent="bmsData.sql ไม่อยู่ใน sandbox นี้ — โหลดข้อมูลสดไม่ได้ (ระบบจะขอขออนุญาตใหม่เมื่อกดอีกครั้ง)";
    return;
  }
  btn.disabled = true; btn.textContent = "⏳ กำลังโหลด...";
  msg.className = "msg"; msg.textContent = "กำลังโหลดข้อมูลช่วง "+from+" ถึง "+to+" ...";
  try{
    const params = { df:{value:from, value_type:"date"}, dt:{value:to, value_type:"date"} };
    const [funds, samples] = await Promise.all([
      window.bmsData.sql(SQL_FD_FUNDS, params),
      window.bmsData.sql(SQL_FD_SAMPLE, params)
    ]);
    renderFdH(funds||[], samples||[], from, to);
    msg.className = "msg ok";
    msg.textContent = "โหลดแล้ว: "+from+" ถึง "+to+" · "+(funds||[]).length+" รหัส pttype · "+(samples||[]).length+" ตัวอย่าง";
    dbg("FDH loaded "+(funds||[]).length+" pttype / "+(samples||[]).length+" sample");
  }catch(e){
    msg.className = "msg err";
    msg.textContent = "โหลดข้อมูลสดไม่ได้: "+esc(e.message||e)+" — ลองใหม่ได้เสมอ";
    dbg("FDH load error: "+(e.message||e));
  }
  btn.disabled = false; btn.textContent = "⟳ โหลดข้อมูลสด";
}

function renderFdH(funds, samples, from, to){
  // group pttype rows into fund groups
  const gmap = {};
  FUND_GROUPS.forEach(g=>gmap[g.key]={visits:0,items:0,total:0,seen:new Set()});
  let totV=0, totI=0, totT=0;
  (funds||[]).forEach(r=>{
    const key = CODE2GROUP[String(r.pttype)] || "OTHER";
    const g = gmap[key];
    g.visits += +r.visits||0; g.items += +r.items||0; g.total += +r.total||0;
    g.seen.add(String(r.pttype));
    totV += +r.visits||0; totI += +r.items||0; totT += +r.total||0;
  });
  document.getElementById("fdhVisits").textContent = fmtI(totV);
  document.getElementById("fdhItems").textContent = fmtI(totI);
  document.getElementById("fdhTotal").textContent = fmtB(totT);
  document.getElementById("fundGrid").innerHTML = FUND_GROUPS.map(g=>{
    const d = gmap[g.key];
    return "<div class='fund'><div class='fn'><span class='dot "+(d.total>0?"y":"n")+"'></span>"+esc(g.name)+"</div>"
      +"<div class='vv'>"+fmtB(d.total)+"</div>"
      +"<div class='mm'>"+fmtI(d.visits)+" visit · "+fmtI(d.items)+" รายการ"+(d.seen.size?" · "+[...d.seen].slice(0,8).join(", ")+(d.seen.size>8?" …":""):"")+"</div></div>";
  }).join("");
  const sb = document.getElementById("fdhSample");
  if(!(samples||[]).length){ sb.innerHTML = "<tr><td colspan='6' class='empty'>ไม่มีรายการในช่วงนี้</td></tr>"; }
  else sb.innerHTML = samples.map(r=>
    "<tr><td>"+esc(String(r.vstdate||"").slice(0,10))+"</td><td>"+esc(r.hn)+"</td><td>"+esc(r.vn)+"</td><td>"+esc(r.pttype)+"</td><td>"+esc(r.item_name)+"</td><td>"+fmtB(r.amt)+"</td></tr>"
  ).join("");
}
document.getElementById("btnFdHLoad").onclick = () => loadFdH(document.getElementById("dFrom").value, document.getElementById("dTo").value);
document.getElementById("btnFdHReset").onclick = () => {
  document.getElementById("dFrom").value = ""; document.getElementById("dTo").value = "";
  document.getElementById("fdhMsg").className="msg";
  document.getElementById("fdhMsg").textContent = "ยังไม่ได้โหลดข้อมูล — เลือกช่วงวันที่แล้วกด \"⟳ โหลดข้อมูลสด\"";
  document.getElementById("fundGrid").innerHTML = "";
  document.getElementById("fdhSample").innerHTML = "<tr><td colspan='6' class='empty'>ยังไม่มีข้อมูล</td></tr>";
  ["fdhVisits","fdhItems","fdhTotal"].forEach(id=>document.getElementById(id).textContent="–");
};

// ===================== VIEW 2: CA FEE SCHEDULE =====================
// Portable SQL (PostgreSQL): CONCAT + CURRENT_DATE, oi.pttype direct (no pttype join needed for code)
const SQL_CA = "SELECT oi.vn, oi.an, oi.hn, oi.vstdate, "
  + "CONCAT(COALESCE(p.pname,''),' ',COALESCE(p.fname,''),' ',COALESCE(p.lname,'')) AS full_name, "
  + "p.nationality, nat.name AS nat_name, p.birthday, "
  + "ROUND((CURRENT_DATE - p.birthday)/365.25, 0) AS age, "
  + "oi.pttype AS pcode, pt.name AS fund_name, "
  + "oi.icode, nd.name AS item_name, "
  + "CASE WHEN EXISTS (SELECT 1 FROM ovstdiag d WHERE d.vn=oi.vn AND d.icd10='Z128') THEN 1 ELSE 0 END AS has_z128, "
  + "CASE WHEN EXISTS (SELECT 1 FROM ovstdiag d WHERE d.vn=oi.vn AND d.icd10 IN ('2721','2722','2723','2724')) THEN 1 ELSE 0 END AS has_icd9_272, "
  + "CASE WHEN EXISTS (SELECT 1 FROM ovstdiag d WHERE d.vn=oi.vn AND d.icd10='2729') THEN 1 ELSE 0 END AS has_icd9_2729, "
  + "CASE WHEN EXISTS (SELECT 1 FROM opitemrece oi2 WHERE oi2.vn=oi.vn AND oi2.icode IN ('3103910','3103912')) THEN 1 ELSE 0 END AS has_walkin_er "
  + "FROM opitemrece oi "
  + "JOIN nondrugitems nd ON nd.icode = oi.icode "
  + "JOIN patient p ON p.hn = oi.hn "
  + "LEFT JOIN pttype pt ON pt.pttype = oi.pttype "
  + "LEFT JOIN nationality nat ON nat.nationality = p.nationality "
  + "WHERE nd.nhso_adp_code = '90004' "
  + "ORDER BY oi.vn LIMIT :limit OFFSET :offset";

// fund acceptance: UC / CSMBS / SSS (local pttype codes)
const UC_CODES = ["79","89","90","UC","BB","BD","BF","BL","BN","BP","BT","BW","CA","CC","CD","DJ","EC","ED","EE","FC","KP","LI"];
const CSMBS_CODES = ["04","07","08","03"];
const SSS_CODES = ["34","35"];
function fundOk(code){
  const c = String(code||"");
  return UC_CODES.indexOf(c)>=0 || CSMBS_CODES.indexOf(c)>=0 || SSS_CODES.indexOf(c)>=0;
}

function evalRow(x){
  const checks = {
    adp: true, // all rows are 90004 by construction
    thai: String(x.nationality)==="99",
    age: x.age!=null && +x.age>=40,
    fund: fundOk(x.pcode),
    z128: +x.has_z128===1,
    icd9: +x.has_icd9_272===1 || +x.has_icd9_2729===1,
    nowalkin: +x.has_walkin_er!==1
  };
  checks.pass = Object.keys(checks).every(k=>k!=="pass"&&checks[k]);
  return checks;
}

let caRows = [];
let caSource = "none";

async function loadCa(from, to){
  const btn = document.getElementById("btnLoadLive");
  const rm = document.getElementById("caRangeMsg");
  btn.disabled = true; btn.textContent = "⏳ โหลดข้อมูล...";
  rm.className = "msg"; rm.textContent = "กำลังโหลด...";
  try{
    let rows = null;
    let liveErr = null;
    // 1) PRIMARY: bmsData.sql (direct SQL, no dataset registration needed)
    if(window.bmsData && window.bmsData.sql){
      try{
        const sql = (from && to)
          ? SQL_CA.replace("ORDER BY oi.vn", "AND oi.vstdate BETWEEN :df AND :dt ORDER BY oi.vn")
          : SQL_CA;
        const base = {};
        if(from && to){ base.df={value:from, value_type:"date"}; base.dt={value:to, value_type:"date"}; }
        rows = [];
        const CHUNK = 100; let off = 0;
        while(true){
          const p = Object.assign({}, base, {limit:{value:CHUNK, value_type:"int"}, offset:{value:off, value_type:"int"}});
          const chunk = await window.bmsData.sql(sql, p);
          rows = rows.concat(chunk||[]);
          if((chunk||[]).length < CHUNK) break;
          off += CHUNK;
          if(off >= 2000) break;
        }
        caSource = "live";
      }catch(e){ liveErr = e; rows = null; }
    }
    // 2) FALLBACK: embedded snapshot (filtered client-side)
    if(rows == null){
      if(!SNAP.length) throw new Error("bmsData.sql ไม่อยู่ใน sandbox และไม่มี snapshot สำรอง — กด \"⟳ โหลดข้อมูลสด\" อีกครั้ง");
      rows = SNAP.filter(x=>{
        if(from && to){
          const d = String(x.vstdate||"").slice(0,10);
          if(d < from || d > to) return false;
        }
        return true;
      });
      caSource = "snapshot";
    }
    caRows = rows || [];
    rm.className = "msg ok";
    rm.textContent = (from && to ? "ช่วงวันที่ "+from+" ถึง "+to+" · " : "ทั้งหมด · ")
      + caRows.length + " รายการ · แหล่งข้อมูล: "
      + (caSource==="live" ? "สด (bmsData.sql)" : "snapshot ใน app")
      + (liveErr ? " · (โหลดสดไม่ได้: "+(liveErr.message||liveErr)+")" : "");
    dbg("CA loaded "+caRows.length+" candidates (source="+caSource+")");
    renderCaTable();
  }catch(e){
    caRows = [];
    document.getElementById("caTable").innerHTML =
      "<tr><td colspan='10' class='empty'>โหลดข้อมูลสดไม่ได้: "+esc(e.message||e)+"<br>ระบบจะขออนุญาตจากผู้ใช้เมื่อกด \"⟳ โหลดข้อมูลสด\" อีกครั้ง</td></tr>";
    document.getElementById("caCount").textContent = "";
    rm.className = "msg err"; rm.textContent = "ผิดพลาด: "+esc(e.message||e);
    dbg("CA load error: "+(e.message||e));
  }
  btn.disabled = false; btn.textContent = "⟳ โหลดข้อมูลสด (ทั้งหมด)";
}
document.getElementById("btnLoadLive").onclick = () => loadCa();
document.getElementById("btnCaRange").onclick = () => {
  const f = document.getElementById("caFrom").value;
  const t = document.getElementById("caTo").value;
  const rm = document.getElementById("caRangeMsg");
  if(!f || !t){ rm.className="msg err"; rm.textContent="โปรดเลือกวันที่ต้นและวันที่สุดท้ายก่อน"; return; }
  loadCa(f, t);
};
document.getElementById("btnCaRangeReset").onclick = () => {
  document.getElementById("caFrom").value = "";
  document.getElementById("caTo").value = "";
  loadCa();
};
document.getElementById("caHn").addEventListener("input", renderCaTable);
document.getElementById("caFilter").addEventListener("change", renderCaTable);

function renderCaTable(){
  const q = (document.getElementById("caHn").value||"").trim().toLowerCase();
  const flt = document.getElementById("caFilter").value;
  const rows = caRows.filter(x=>{
    const ev = evalRow(x);
    if(flt==="pass" && !ev.pass) return false;
    if(flt==="fix" && ev.pass) return false;
    if(q){
      const hay = [x.vn,x.an,x.hn,x.full_name,x.pcode,x.fund_name].map(v=>String(v||"").toLowerCase()).join(" ");
      if(hay.indexOf(q)<0) return false;
    }
    return true;
  });
  const passN = caRows.filter(x=>evalRow(x).pass).length;
  document.getElementById("chTotal").textContent = fmtI(caRows.length);
  document.getElementById("chPass").textContent = fmtI(passN);
  document.getElementById("chFix").textContent = fmtI(caRows.length-passN);
  document.getElementById("caCount").textContent = "แสดง "+rows.length+" จาก "+caRows.length+" รายการ (แหล่ง: "+(caSource==="live"?"สด":"snapshot")+")";
  const tb = document.getElementById("caTable");
  if(!rows.length){ tb.innerHTML = "<tr><td colspan='10' class='empty'>ยังไม่มีข้อมูล — กด \"⟳ โหลดข้อมูลสด\" หรือเลือกช่วงวันที่ได้</td></tr>"; renderPlan([]); return; }
  tb.innerHTML = rows.map(x=>{
    const ev = evalRow(x);
    const dot = b => "<span class='dot "+(b?"y":"n")+"'></span>";
    return "<tr>"
      +"<td>"+esc(String(x.vstdate||"").slice(0,10))+"</td>"
      +"<td>"+esc(x.hn)+"</td>"
      +"<td>"+esc(x.full_name)+"</td>"
      +"<td>"+(x.age!=null?x.age:"?")+"</td>"
      +"<td>"+esc(x.nat_name||"-")+"</td>"
      +"<td>"+esc(x.fund_name||x.pcode||"-")+"</td>"
      +"<td>"+dot(ev.z128)+"</td>"
      +"<td>"+dot(ev.icd9)+"</td>"
      +"<td>"+dot(ev.nowalkin)+"</td>"
      +"<td>"+(ev.pass?"<span class='badge pass'>ผ่าน</span>":"<span class='badge fix'>แก้ไข</span>")+"</td>"
      +"</tr>";
  }).join("");
  renderPlan(rows.filter(x=>!evalRow(x).pass));
}

function renderPlan(fixRows){
  const card = document.getElementById("planCard");
  const body = document.getElementById("planBody");
  if(!fixRows.length){ card.style.display="none"; return; }
  const lines = [];
  fixRows.slice(0,50).forEach(x=>{
    const ev = evalRow(x);
    const acts = [];
    if(!ev.z128) acts.push("เพิ่ม ICD-10 Z128 ในวินิจฉัย (VN "+x.vn+")");
    if(!ev.icd9) acts.push("เลือก ICD-9 2721-2724 หรือ 2729 (VN "+x.vn+")");
    if(!ev.nowalkin) acts.push("ลบรายการ WALKIN/ER-EXT (icode 3103910/3103912) ของ VN "+x.vn);
    if(!ev.thai) acts.push("ชาติไม่ใช่ไทย (nat "+esc(x.nationality)+") — ไม่ผ่านเงื่อนไข");
    if(!ev.age) acts.push("อายุ < 40 (อายุ "+(x.age!=null?x.age:"?")+" ปี) — ไม่ผ่านเงื่อนไข");
    if(!ev.fund) acts.push("กองทุน "+esc(x.fund_name||x.pcode)+" ไม่อยู่ใน UC/ข้าราชการ/ประกันสังคม — ไม่ผ่านเงื่อนไข");
    lines.push("<div class='plan-item'><div class='ph'>VN "+esc(x.vn)+" · HN "+esc(x.hn)+" · "+esc(x.full_name||"")+"</div>"
      + (acts.length ? acts.map(a=>"• "+esc(a)).join("<br>") : "") + "</div>");
  });
  body.innerHTML = lines.join("") + (fixRows.length>50 ? "<div class='msg'>... อีก "+(fixRows.length-50)+" รายการ (แสดง 50 แรก)</div>" : "");
  card.style.display = "";
}

// boot
dbg("App ready: FDH 8 fund groups / CA menu armed / date-range enabled / snapshot="+SNAP.length+" rows");
})();
