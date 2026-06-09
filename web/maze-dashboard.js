let globalData = null;
let clusterData = null;
let activeSubjectId = null;
let showAverage = false;
let activeGroupId = null;
let activePriorityMode = 'average';

document.addEventListener('DOMContentLoaded', () => {
    const summaryEl = document.getElementById('datasetSummary');

    Promise.resolve(window.MAZE_ANALYZER_DATA)
        .then(data => {
            if(!data || !data.cohort_profiles) throw new Error("데이터 없음");
            globalData = data;
            globalData.subjects = Object.keys(data.cohort_profiles || {});
            try { renderThreeBoxesSummary(data.global_summary); } catch(e){}
            
            if (summaryEl) {
                let totalTrials = 0;
                globalData.subjects.forEach(id => { totalTrials += ((globalData.cohort_profiles[id]?.total_rounds||0) * 176); });
                summaryEl.textContent = `${globalData.subjects.length}명 · ${totalTrials} trials · 공통 176 · 제외 0`;
            }
            if (globalData.subjects.length > 0) activeSubjectId = globalData.subjects[0];
            renderParticipantPills(); renderAllCharts();
            if (activeSubjectId) showDetail(activeSubjectId);
        }).catch(err => { if(summaryEl) summaryEl.textContent = "오류 발생: " + err.message; });

    const btnInd = document.getElementById('modeIndividual');
    const btnGrp = document.getElementById('modeGroup');
    const viewInd = document.getElementById('individualView');
    const viewGrp = document.getElementById('groupView');

    if (btnInd && btnGrp) {
        btnInd.addEventListener('click', () => {
            btnInd.className = 'toggle-btn toggle-active'; btnGrp.className = 'toggle-btn toggle-inactive';
            viewInd.style.display = 'block'; viewGrp.style.display = 'none';
        });
        btnGrp.addEventListener('click', () => {
            btnGrp.className = 'toggle-btn toggle-active'; btnInd.className = 'toggle-btn toggle-inactive';
            viewGrp.style.display = 'flex'; viewInd.style.display = 'none';
            if (!clusterData) {
                Promise.resolve(window.MAZE_ANALYZER_CLUSTERS || {}).then(cData => {
                    clusterData = cData; renderClusterList(); drawManifoldMap();
                    if (!activeGroupId) selectCluster(Object.keys(clusterData)[0]);
                });
            } else if (!activeGroupId) {
                selectCluster(Object.keys(clusterData)[0]);
            }
        });
    }

    const searchInput = document.getElementById('nameSearch');
    const searchBtn = document.getElementById('searchBtn');
    const clearBtn = document.getElementById('clearSelection');
    if (searchInput) searchInput.addEventListener('input', () => renderParticipantPills(searchInput.value));
    if (searchBtn) searchBtn.addEventListener('click', () => renderParticipantPills(searchInput.value));
    if (clearBtn) clearBtn.addEventListener('click', () => {
        activeSubjectId = null; showAverage = false; searchInput.value = '';
        renderParticipantPills(); renderAllCharts();
        document.getElementById('detailPanel').innerHTML = '';
        document.getElementById('individualModelPanel').style.display = 'none';
        document.getElementById('transitionPanel').style.display = 'none';
    });
});

// --- INDIVIDUAL TAB FUNCTIONS ---
function renderThreeBoxesSummary(summary) {
    if (!summary) return;
    document.getElementById('polyDegreeValue').textContent = summary.polynomial_degree_label || "--";
    document.getElementById('avgRtValue').textContent = summary.average_response_time ? `${summary.average_response_time.toFixed(2)}s` : "--s";
    document.getElementById('avgAccuracyValue').textContent = summary.average_correction_rate ? `${summary.average_correction_rate.toFixed(1)}%` : "--%";
}

function renderParticipantPills(query = "") {
    const container = document.getElementById('participantPills');
    if (!container || !globalData) return;
    container.innerHTML = '';
    query = query.toLowerCase();

    const avgPill = document.createElement('div');
    avgPill.style.cssText = `display:flex; align-items:center; gap:8px; padding:10px 18px; border-radius:20px; cursor:pointer; flex-shrink:0; transition:all 0.2s; border:1px solid ${showAverage ? '#fde047':'#e2e8f0'}; background:${showAverage ? '#fefce8':'#ffffff'};`;
    avgPill.innerHTML = `<div style="width:14px; height:14px; border:1.5px solid ${showAverage?'#ca8a04':'#94a3b8'}; border-radius:3px; background:${showAverage?'#ca8a04':'transparent'}; display:flex; align-items:center; justify-content:center;">${showAverage?'<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>':''}</div><div><div style="font-weight:800; font-size:14px; color:#1e293b; line-height:1;">평균</div></div>`;
    avgPill.onclick = () => { showAverage = !showAverage; renderParticipantPills(query); renderAllCharts(); };
    container.appendChild(avgPill);

    globalData.subjects.forEach(id => {
        if (query && !id.toLowerCase().includes(query)) return;
        const profile = globalData.cohort_profiles[id];
        const isActive = (activeSubjectId === id);
        const pill = document.createElement('div');
        pill.style.cssText = `display:flex; align-items:center; gap:8px; padding:10px 18px; border-radius:20px; cursor:pointer; flex-shrink:0; transition:all 0.2s; border:1px solid ${isActive?'#fca5a5':'#e2e8f0'}; background:${isActive?'#fef2f2':'#ffffff'};`;
        pill.innerHTML = `<div style="width:14px; height:14px; border:1.5px solid ${isActive?'#dc2626':'#94a3b8'}; border-radius:50%; display:flex; align-items:center; justify-content:center;">${isActive?'<div style="width:8px; height:8px; background:#dc2626; border-radius:50%;"></div>':''}</div><div><div style="font-weight:800; font-size:14px; color:#1e293b; line-height:1;">${id}</div></div>`;
        pill.onclick = () => { activeSubjectId = isActive ? null : id; renderParticipantPills(query); renderAllCharts(); if(activeSubjectId) showDetail(activeSubjectId); };
        container.appendChild(pill);
    });
}

function calculateCohortAverage(taskKey) {
    const roundData = {};
    if (!globalData) return { raw_points: [], accuracy_trend: { curve: [] } };
    globalData.subjects.forEach(id => {
        const profile = globalData.cohort_profiles[id];
        if (profile?.tasks?.[taskKey]?.raw_points) {
            profile.tasks[taskKey].raw_points.forEach(pt => {
                if (isNaN(pt.round)) return;
                if (!roundData[pt.round]) roundData[pt.round] = { accSum: 0, rtSum: 0, count: 0 };
                roundData[pt.round].accSum += pt.accuracy; roundData[pt.round].rtSum += pt.rt; roundData[pt.round].count += 1;
            });
        }
    });
    const points = [], curve = [];
    Object.keys(roundData).sort((a,b)=>a-b).forEach(r => {
        const rnd = parseInt(r);
        points.push({ round: rnd, accuracy: roundData[r].accSum/roundData[r].count, rt: roundData[r].rtSum/roundData[r].count });
        curve.push({ round: rnd, value: roundData[r].accSum/roundData[r].count }); 
    });
    return { raw_points: points, accuracy_trend: { curve: curve } };
}

function renderAllCharts() {
    if (!globalData) return;
    let activeMazeData = null, activeRsvpData = null;
    if (activeSubjectId) { activeMazeData = globalData.cohort_profiles[activeSubjectId].tasks.maze; activeRsvpData = globalData.cohort_profiles[activeSubjectId].tasks.rsvp; }
    let avgMazeData = null, avgRsvpData = null;
    if (showAverage) { avgMazeData = calculateCohortAverage('maze'); avgRsvpData = calculateCohortAverage('rsvp'); }
    try { drawDualLearningCurve('mazeVectorChart', activeMazeData, '#059669', avgMazeData, '#eab308'); } catch(e){}
    try { drawDualLearningCurve('rsvpVectorChart', activeRsvpData, '#2563eb', avgRsvpData, '#eab308'); } catch(e){}
    try { drawSpaghettiTrend('mazeRtTrendChart', 'maze', 'rt'); drawSpaghettiTrend('mazeAccTrendChart', 'maze', 'accuracy'); } catch(e){}
    try { drawSpaghettiTrend('rsvpRtTrendChart', 'rsvp', 'rt'); drawSpaghettiTrend('rsvpAccTrendChart', 'rsvp', 'accuracy'); } catch(e){}
}

function drawDualLearningCurve(svgId, mainData, mainColor, avgData, avgColor) {
    const svg = document.getElementById(svgId); if (!svg) return; svg.innerHTML = '';
    let allPts = (mainData?.raw_points||[]).concat(avgData?.raw_points||[]);
    if (allPts.length === 0) return;
    const padL = 60, padR = 30, padT = 30, padB = 50;
    const w = 540 - padL - padR, h = 440 - padT - padB;
    const minR = 1, maxR = Math.max(5, ...allPts.map(p=>p.round));
    const minV = Math.max(0, Math.min(...allPts.map(p=>p.accuracy))-10), maxV = 100;
    const getX = r => padL + ((r-minR)/(maxR-minR||1))*w, getY = v => padT + (1 - ((v-minV)/(maxV-minV||1)))*h;

    // Y-Axis Grids and Labels
    for (let pct = Math.floor(minV/10)*10; pct <= maxV; pct+=10) {
        const y = getY(pct), line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        Object.assign(line.style, { stroke: "#f1f5f9", strokeWidth: "1" });
        line.setAttribute("x1",padL); line.setAttribute("y1",y); line.setAttribute("x2",padL+w); line.setAttribute("y2",y);
        svg.appendChild(line);
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text"); text.textContent = `${pct}%`;
        text.setAttribute("x", padL - 10); text.setAttribute("y", y + 4);
        Object.assign(text.style, { fontSize: "10px", fill: "#94a3b8", textAnchor: "end", fontFamily: "sans-serif" }); svg.appendChild(text);
    }
    
    // X-Axis Grids and Labels
    for (let r = minR; r <= maxR; r++) {
        const x = getX(r), text = document.createElementNS("http://www.w3.org/2000/svg", "text"); text.textContent = `${r}차`;
        text.setAttribute("x", x); text.setAttribute("y", padT + h + 20);
        Object.assign(text.style, { fontSize: "11px", fill: "#64748b", textAnchor: "middle", fontFamily: "sans-serif" }); svg.appendChild(text);
    }

    const plot = (data, color, isAvg) => {
        if(!data||!data.raw_points) return;
        const trend = data.accuracy_trend?.curve||[];
        if(trend.length>1){
            let d=""; trend.forEach((p,i)=>d+=(i===0?"M":"L")+` ${getX(p.round)} ${getY(p.value)}`);
            const path=document.createElementNS("http://www.w3.org/2000/svg","path");
            path.setAttribute("d",d); path.setAttribute("stroke",color); path.setAttribute("stroke-width",isAvg?"3":"2.5"); path.setAttribute("fill","none");
            if(isAvg) path.style.opacity="0.6"; else path.setAttribute("stroke-dasharray","4,4"); svg.appendChild(path);
        }
        data.raw_points.forEach(p=>{
            const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
            c.setAttribute("cx",getX(p.round)); c.setAttribute("cy",getY(p.accuracy)); c.setAttribute("r",isAvg?"4":"6");
            c.setAttribute("fill",isAvg?color:"#ef4444"); c.setAttribute("stroke","#fff"); c.setAttribute("stroke-width","2"); svg.appendChild(c);
        });
    };
    if(avgData) plot(avgData, avgColor, true); if(mainData) plot(mainData, mainColor, false);
}

function drawSpaghettiTrend(svgId, taskKey, metric) {
    const svg = document.getElementById(svgId); if (!svg||!globalData) return; svg.innerHTML = '';
    let allV=[], pLines=[];
    globalData.subjects.forEach(id => {
        const pts = globalData.cohort_profiles[id]?.tasks?.[taskKey]?.raw_points||[];
        if(pts.length>0){
            const line = pts.filter(p=>!isNaN(p.round)&&!isNaN(p[metric])).map(p=>({round:p.round, value:p[metric]}));
            if(line.length > 0) { pLines.push({id, points:line}); line.forEach(d=>allV.push(d.value)); }
        }
    });
    if(allV.length===0) return;
    const padL=40, padR=20, padT=20, padB=30;
    const w=500-padL-padR, h=220-padT-padB;
    const minR=1, maxR=Math.max(7,...pLines.map(l=>Math.max(...l.points.map(p=>p.round))));
    
    let minV, maxV, ySteps=[];
    if(metric==='accuracy'){ 
        minV=Math.max(0,Math.min(...allV)-10); maxV=100; 
        for (let pct = Math.floor(minV/10)*10; pct <= maxV; pct += 10) ySteps.push(pct);
        if (ySteps.length === 0) ySteps = [0, 50, 100]; 
        minV = ySteps[0];
    } else { 
        const rawMin=Math.min(...allV), rawMax=Math.max(...allV);
        const diff=rawMax-rawMin||0.5; minV=Math.max(0,rawMin-diff*0.15); maxV=rawMax+diff*0.15; 
        for (let i = 0; i <= 4; i++) ySteps.push(minV + ((maxV - minV) * i / 4));
    }
    const getX=r=>padL+((r-minR)/(maxR-minR||1))*w, getY=v=>padT+(1-((v-minV)/(maxV-minV||1)))*h;

    // Y-Axis Labels
    const yAxisLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    yAxisLabel.textContent = metric === 'rt' ? "RT" : "정답률";
    yAxisLabel.setAttribute("x", -(padT + h / 2)); yAxisLabel.setAttribute("y", 12); yAxisLabel.setAttribute("transform", "rotate(-90)");
    Object.assign(yAxisLabel.style, { fontSize: "12px", fontWeight: "800", fill: "#475569", textAnchor: "middle", fontFamily: "sans-serif" });
    svg.appendChild(yAxisLabel);

    // X-Axis Labels
    const xAxisLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    xAxisLabel.textContent = "차수";
    xAxisLabel.setAttribute("x", padL + w / 2); xAxisLabel.setAttribute("y", padT + h + 26);
    Object.assign(xAxisLabel.style, { fontSize: "12px", fontWeight: "800", fill: "#475569", textAnchor: "middle", fontFamily: "sans-serif" });
    svg.appendChild(xAxisLabel);

    ySteps.forEach(val => {
        const y = getY(val);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        Object.assign(line.style, { stroke: "#f1f5f9", strokeWidth: "1" });
        line.setAttribute("x1", padL); line.setAttribute("y1", y); line.setAttribute("x2", padL + w); line.setAttribute("y2", y); 
        svg.appendChild(line);
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text"); 
        text.textContent = metric === 'accuracy' ? `${val}%` : val.toFixed(1);
        text.setAttribute("x", padL - 8); text.setAttribute("y", y + 4); 
        Object.assign(text.style, { fontSize: "10px", fill: "#94a3b8", textAnchor: "end", fontFamily: "sans-serif" }); 
        svg.appendChild(text);
    });

    for (let r = minR; r <= maxR; r++) {
        const x = getX(r);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        Object.assign(line.style, { stroke: "#f1f5f9", strokeWidth: "1" });
        line.setAttribute("x1", x); line.setAttribute("y1", padT); line.setAttribute("x2", x); line.setAttribute("y2", padT + h); 
        svg.appendChild(line);
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text"); text.textContent = r;
        text.setAttribute("x", x); text.setAttribute("y", padT + h + 15); 
        Object.assign(text.style, { fontSize: "11px", fill: "#64748b", textAnchor: "middle", fontFamily: "sans-serif" }); 
        svg.appendChild(text);
    }

    pLines.forEach(l=>{
        if(activeSubjectId&&l.id===activeSubjectId&&!showAverage) return;
        let d=""; l.points.sort((a,b)=>a.round-b.round).forEach((p,i)=>d+=(i===0?"M":"L")+` ${getX(p.round)} ${getY(p.value)}`);
        const pth=document.createElementNS("http://www.w3.org/2000/svg","path");
        pth.setAttribute("d",d); pth.setAttribute("stroke","#3b82f6"); pth.setAttribute("stroke-width","0.75"); pth.setAttribute("fill","none"); pth.style.opacity="0.2"; svg.appendChild(pth);
        l.points.forEach(p=>{
            const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
            c.setAttribute("cx",getX(p.round)); c.setAttribute("cy",getY(p.value)); c.setAttribute("r","1.5"); c.setAttribute("fill","#3b82f6"); c.style.opacity="0.3"; svg.appendChild(c);
        });
    });
    
    let hp=null, hc="#ef4444";
    if(showAverage){ hp=calculateCohortAverage(taskKey).raw_points.map(p=>({round:p.round,value:p[metric]})); hc="#eab308"; }
    else if(activeSubjectId) { const al=pLines.find(l=>l.id===activeSubjectId); if(al) hp=al.points; }
    
    if(hp){
        let d=""; hp.sort((a,b)=>a.round-b.round).forEach((p,i)=>d+=(i===0?"M":"L")+` ${getX(p.round)} ${getY(p.value)}`);
        const pth=document.createElementNS("http://www.w3.org/2000/svg","path");
        pth.setAttribute("d",d); pth.setAttribute("stroke",hc); pth.setAttribute("stroke-width","2"); pth.setAttribute("fill","none"); svg.appendChild(pth);
        hp.forEach(p=>{
            const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
            c.setAttribute("cx",getX(p.round)); c.setAttribute("cy",getY(p.value)); c.setAttribute("r","4"); c.setAttribute("fill",hc); svg.appendChild(c);
        });
    }
}

// === MODULAR RENDERERS FOR BOTH INDIVIDUAL & GROUP TABS ===

function renderConfusionMatrices(rawPoints, panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    let matrixHtmlString = "";
    if (rawPoints) {
        rawPoints.forEach(pt => {
            if(!pt.matrix) return;
            const m = pt.matrix;
            const safeTotal = m.total_items > 0 ? m.total_items : 176;
            const toPct = val => (((val||0)/safeTotal)*100).toFixed(1) + '%';
            matrixHtmlString += `
                <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:18px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #f1f5f9; padding-bottom:8px;">
                        <span style="font-weight:800; font-size:14px; color:#1e293b;">${pt.round}차 과제</span>
                        <span style="font-size:12px; font-weight:600; color:#059669; background:#f0fdf4; padding:2px 8px; border-radius:20px;">정답률: ${pt.accuracy?.toFixed(1)||0}%</span>
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:center;">
                        <thead><tr style="background:#f8fafc; color:#64748b;"><th style="padding:6px; border:1px solid #e2e8f0;">정답 여부</th><th style="padding:6px; border:1px solid #e2e8f0;">응답 O</th><th style="padding:6px; border:1px solid #e2e8f0;">응답 X</th></tr></thead>
                        <tbody>
                            <tr>
                                <td style="padding:8px; border:1px solid #e2e8f0; background:#f8fafc; font-weight:700;">정답 O</td>
                                <td style="padding:8px; border:1px solid #e2e8f0; color:#059669; background:#f0fdf4; font-weight:700;">O &rarr; O<br><span style="font-size:15px;">${m.true_O||0}</span><br><span style="color:#64748b; font-size:10px;">(${toPct(m.true_O)})</span></td>
                                <td style="padding:8px; border:1px solid #e2e8f0; color:#ef4444; background:#fef2f2;">O &rarr; X<br><span style="font-size:15px;">${m.false_X||0}</span><br><span style="color:#64748b; font-size:10px;">(${toPct(m.false_X)})</span></td>
                            </tr>
                            <tr>
                                <td style="padding:8px; border:1px solid #e2e8f0; background:#f8fafc; font-weight:700;">정답 X</td>
                                <td style="padding:8px; border:1px solid #e2e8f0; color:#ef4444; background:#fef2f2;">X &rarr; O<br><span style="font-size:15px;">${m.false_O||0}</span><br><span style="color:#64748b; font-size:10px;">(${toPct(m.false_O)})</span></td>
                                <td style="padding:8px; border:1px solid #e2e8f0; color:#059669; background:#f0fdf4; font-weight:700;">X &rarr; X<br><span style="font-size:15px;">${m.true_X||0}</span><br><span style="color:#64748b; font-size:10px;">(${toPct(m.true_X)})</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>`;
        });
    }
    if(matrixHtmlString !== "") {
        panel.innerHTML = `<div style="margin-top:25px; border-top:2px dashed #e2e8f0; padding-top:20px;"><h3 style="font-size:16px; font-weight:800; margin-bottom:15px;">📊 O/X 응답 세부 분석 (Confusion Matrix)</h3><div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:20px;">${matrixHtmlString}</div></div>`;
    } else { panel.innerHTML = ''; }
    panel.style.display = matrixHtmlString !== "" ? "block" : "none";
}

function renderTransitionPanelData(taskData, rId, mId, sId) {
    const rCon = document.getElementById(rId), mCon = document.getElementById(mId), svg = document.getElementById(sId);
    if (!rCon || !mCon || !svg || !taskData) return;

    let rHtml = "";
    if (taskData.raw_points) {
        taskData.raw_points.forEach(pt => {
            if(isNaN(pt.accuracy)) return;
            const total = pt.matrix?.total_items || 176;
            const correct = pt.matrix ? (pt.matrix.true_O + pt.matrix.true_X) : Math.round((pt.accuracy/100)*total);
            const incorrect = total - correct;
            rHtml += `<div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:12px 16px; min-width:140px; flex-shrink:0;"><div style="font-size:12px; font-weight:800; margin-bottom:6px;">${pt.round||0}회차</div><div style="font-size:13px; font-weight:700;"><span style="color:#059669; margin-right:8px;">${correct} 정답</span><span style="color:#ef4444;">${incorrect} 오답</span></div></div>`;
        });
    }
    rCon.innerHTML = rHtml;

    let mHtml = "";
    if (taskData.transitions) {
        taskData.transitions.forEach(tr => {
            const total = (tr.cc||0) + (tr.cx||0) + (tr.xx||0) + (tr.xc||0);
            if (total === 0) return;
            const toPct = val => (((val||0)/total)*100).toFixed(1)+'%';
            mHtml += `
                <div style="min-width: 260px; flex-shrink:0;">
                    <div style="font-size:14px; font-weight:900; color:#2563eb; margin-bottom:4px;">${tr.from_round} &rarr; ${tr.to_round}</div>
                    <div style="font-size:11px; font-weight:700; color:#64748b; margin-bottom:8px;">총 ${total}문항 비교</div>
                    <table style="width:100%; border-collapse:collapse; font-size:11px; text-align:center; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px;">
                        <thead><tr style="background:#f8fafc; color:#64748b;"><th style="padding:6px; border:1px solid #e2e8f0;">이전 &rarr; 다음</th><th style="padding:6px; border:1px solid #e2e8f0;">유지</th><th style="padding:6px; border:1px solid #e2e8f0;">변화</th></tr></thead>
                        <tbody>
                            <tr>
                                <td style="padding:8px; border:1px solid #e2e8f0; background:#f8fafc; font-weight:700;">정답</td>
                                <td style="padding:8px; border:1px solid #e2e8f0; background:#f0fdf4;"><div style="color:#059669; font-size:16px; font-weight:800;">${tr.cc||0}개</div><div style="color:#64748b;">${toPct(tr.cc)}</div></td>
                                <td style="padding:8px; border:1px solid #e2e8f0; background:#fef2f2;"><div style="color:#ef4444; font-size:16px; font-weight:800;">${tr.cx||0}개</div><div style="color:#64748b;">${toPct(tr.cx)}</div></td>
                            </tr>
                            <tr>
                                <td style="padding:8px; border:1px solid #e2e8f0; background:#f8fafc; font-weight:700;">오답</td>
                                <td style="padding:8px; border:1px solid #e2e8f0; background:#fef2f2;"><div style="color:#ef4444; font-size:16px; font-weight:800;">${tr.xx||0}개</div><div style="color:#64748b;">${toPct(tr.xx)}</div></td>
                                <td style="padding:8px; border:1px solid #e2e8f0; background:#f0fdf4;"><div style="color:#059669; font-size:16px; font-weight:800;">${tr.xc||0}개</div><div style="color:#64748b;">${toPct(tr.xc)}</div></td>
                            </tr>
                        </tbody>
                    </table>
                </div>`;
        });
    }
    mCon.innerHTML = mHtml;

    svg.innerHTML = '';
    const trans = taskData.transitions;
    if (!trans || trans.length === 0) return;

    const padL=40, padR=40, padT=20, padB=40;
    const w = 800 - padL - padR, h = 250 - padT - padB;
    const highestPoint = Math.max(...trans.map(t => Math.max(t.xx||0, t.cx||0)));
    const maxVal = Math.max(25, Math.ceil(highestPoint/5)*5 + 5);
    const getX = idx => padL + (idx/(trans.length-1||1))*w, getY = v => padT + (1 - (v/maxVal))*h;

    // Y Axis Grids
    for (let i=0; i<=maxVal; i+= (maxVal > 100 ? 50 : 5)) {
        const y=getY(i), line=document.createElementNS("http://www.w3.org/2000/svg","line");
        line.setAttribute("x1",padL); line.setAttribute("y1",y); line.setAttribute("x2",padL+w); line.setAttribute("y2",y);
        line.style.stroke="#f1f5f9"; svg.appendChild(line);
        const text=document.createElementNS("http://www.w3.org/2000/svg","text"); text.textContent=i;
        text.setAttribute("x",padL-10); text.setAttribute("y",y+4); text.style.cssText="font-size:11px; fill:#94a3b8; text-anchor:end;"; svg.appendChild(text);
    }
    
    // X Axis Labels
    trans.forEach((tr, idx) => {
        const x=getX(idx);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        Object.assign(line.style, { stroke: "#f1f5f9", strokeWidth: "1" });
        line.setAttribute("x1", x); line.setAttribute("y1", padT); line.setAttribute("x2", x); line.setAttribute("y2", padT+h); svg.appendChild(line);

        const text=document.createElementNS("http://www.w3.org/2000/svg","text"); text.textContent=`${tr.from_round}→${tr.to_round}`;
        text.setAttribute("x",x); text.setAttribute("y",padT+h+20); text.style.cssText="font-size:12px; fill:#64748b; text-anchor:middle;"; svg.appendChild(text);
    });

    const drawLine = (key, color, isDashed) => {
        let d=""; trans.forEach((tr,idx)=>d+=(idx===0?"M":"L")+` ${getX(idx)} ${getY(tr[key]||0)}`);
        const p=document.createElementNS("http://www.w3.org/2000/svg","path");
        p.setAttribute("d",d); p.setAttribute("stroke",color); p.setAttribute("stroke-width","2.5"); p.setAttribute("fill","none");
        if(isDashed) p.setAttribute("stroke-dasharray","6,6"); svg.appendChild(p);
        trans.forEach((tr,idx)=>{
            const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
            c.setAttribute("cx",getX(idx)); c.setAttribute("cy",getY(tr[key]||0)); c.setAttribute("r","5");
            c.setAttribute("fill",color); c.setAttribute("stroke","#fff"); c.setAttribute("stroke-width","2"); svg.appendChild(c);
        });
    };
    try { drawLine("cx", "#f59e0b", true); drawLine("xx", "#ef4444", false); } catch(e){} 
}

function drawStylizedModelChart(svgId, taskData, metric) {
    const svg = document.getElementById(svgId);
    if (!svg || !taskData || !taskData.raw_points) return; svg.innerHTML = '';
    const points = taskData.raw_points, trend = metric === 'rt' ? taskData.rt_trend : taskData.accuracy_trend;
    if (points.length === 0) return;
    
    const w=450, h=250, padX=40, padTop=60, padBot=40;
    const rounds = points.map(p=>p.round).filter(r=>!isNaN(r));
    if(rounds.length === 0) return;
    const minR = Math.min(...rounds), maxR = Math.max(...rounds);
    
    const vals = points.map(p=>metric==='rt'?p.rt:p.accuracy).filter(v=>!isNaN(v));
    const trendVals = trend?.curve ? trend.curve.map(c=>c.value).filter(v=>!isNaN(v)) : [];
    const allVals = vals.concat(trendVals);
    if(allVals.length === 0) return;
    
    let minV = Math.min(...allVals), maxV = Math.max(...allVals);
    if (metric === 'accuracy') { minV = Math.max(0, minV-5); maxV = Math.min(100, maxV+5); } 
    else { const b = (maxV-minV)*0.2||0.5; minV = Math.max(0, minV-b); maxV = maxV+b; }
    
    const getX = r => padX + ((r-minR)/(maxR-minR||1))*(w - padX * 2);
    const getY = v => padTop + (1 - ((v-minV)/(maxV-minV||1)))*(h - padTop - padBot);

    // Title
    const t = document.createElementNS("http://www.w3.org/2000/svg","text"); t.textContent = metric==='rt'?'RT':'Accuracy';
    t.setAttribute('x',w/2); t.setAttribute('y',30); t.style.cssText="font-size:18px; font-weight:900; fill:#1e293b; text-anchor:middle;"; svg.appendChild(t);

    // X-Axis Grids and Labels
    for(let r = minR; r <= maxR; r++) {
        const x = getX(r);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute('x1', x); line.setAttribute('y1', padTop); line.setAttribute('x2', x); line.setAttribute('y2', h - padBot);
        line.setAttribute('stroke', '#e2e8f0'); line.setAttribute('stroke-width', '1'); svg.appendChild(line);
        
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text"); t.textContent = r;
        t.setAttribute('x', x); t.setAttribute('y', h - padBot + 25);
        Object.assign(t.style, { fontSize: "14px", fill: "#64748b", textAnchor: "middle", fontFamily: "sans-serif" }); svg.appendChild(t);
    }

    if (trend?.curve?.length > 0) {
        let d=""; trend.curve.forEach((c,i)=>d+=(i===0?'M':'L')+` ${getX(c.round)} ${getY(c.value)}`);
        const p=document.createElementNS("http://www.w3.org/2000/svg","path");
        p.setAttribute('d',d); p.setAttribute('stroke','#2563eb'); p.setAttribute('stroke-width','2.5'); p.setAttribute('stroke-dasharray','6,6'); p.setAttribute('fill','none'); svg.appendChild(p);
    }
    
    points.forEach(p=>{
        if(isNaN(p.round)||isNaN(p[metric])) return;
        const x=getX(p.round), y=getY(p[metric]);
        const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
        c.setAttribute('cx',x); c.setAttribute('cy',y); c.setAttribute('r','6'); c.setAttribute('fill','#ef4444'); svg.appendChild(c);
        
        const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text"); lbl.textContent = p.round;
        lbl.setAttribute('x', x); lbl.setAttribute('y', y - 12);
        Object.assign(lbl.style, { fontSize: "14px", fontWeight: "800", fill: "#ef4444", textAnchor: "middle", fontFamily: "sans-serif" }); svg.appendChild(lbl);
    });
}

function showDetail(id) {
    const profile = globalData?.cohort_profiles[id];
    if (!profile) return;

    try {
        const modelPanel = document.getElementById('individualModelPanel');
        if (modelPanel) {
            modelPanel.style.display = 'flex';
            document.getElementById('individualMetaLabel').textContent = `${profile.student_id} · ${profile.total_rounds||0}회 · ${(profile.total_rounds||0)*176} trials`;
            if(profile.tasks?.maze) {
                drawStylizedModelChart('stylizedMazeRt', profile.tasks.maze, 'rt'); drawStylizedModelChart('stylizedMazeAcc', profile.tasks.maze, 'accuracy');
                document.getElementById('mazeFormulaFooter').innerHTML = `<span style="color:#2563eb; font-weight:800; margin-right:12px;">RT 추세선</span> ${profile.tasks.maze.rt_trend?.formula||''} &nbsp;&nbsp;|&nbsp;&nbsp; <span style="color:#2563eb; font-weight:800; margin-right:12px;">ACC 추세선</span> ${profile.tasks.maze.accuracy_trend?.formula||''}`;
            }
            if(profile.tasks?.rsvp) {
                drawStylizedModelChart('stylizedRsvpRt', profile.tasks.rsvp, 'rt'); drawStylizedModelChart('stylizedRsvpAcc', profile.tasks.rsvp, 'accuracy');
                document.getElementById('rsvpFormulaFooter').innerHTML = `<span style="color:#2563eb; font-weight:800; margin-right:12px;">RT 추세선</span> ${profile.tasks.rsvp.rt_trend?.formula||''} &nbsp;&nbsp;|&nbsp;&nbsp; <span style="color:#2563eb; font-weight:800; margin-right:12px;">ACC 추세선</span> ${profile.tasks.rsvp.accuracy_trend?.formula||''}`;
            }
        }
    } catch(e) {}

    try {
        const transPanel = document.getElementById('transitionPanel');
        if (transPanel && profile.tasks?.maze) {
            transPanel.style.display = 'flex';
            renderTransitionPanelData(profile.tasks.maze, 'transitionRoundsContainer', 'transitionMatricesContainer', 'transitionLineChart');
        }
    } catch(e) {}

    renderConfusionMatrices(profile.tasks?.maze?.raw_points, 'detailPanel');
}

// --- GROUP TAB FUNCTIONS ---

function renderClusterList() {
    const container = document.getElementById('clusterListContainer');
    if (!container || !clusterData) return;
    container.innerHTML = '';
    
    Object.keys(clusterData).forEach(key => {
        const group = clusterData[key], el = document.createElement('div');
        el.className = 'cluster-card';
        el.style.cssText = "display:flex; align-items:center; gap:16px; padding:16px 20px; border:1px solid #e2e8f0; border-radius:12px; background:#ffffff; transition:all 0.2s; cursor:pointer;";
        el.innerHTML = `<div style="width:20px; height:20px; border-radius:50%; border:2px solid #cbd5e1; display:flex; align-items:center; justify-content:center;"><div style="width:10px; height:10px; background:${group.color}; border-radius:50%;"></div></div><div style="font-size:15px; font-weight:800; color:#1e293b;">${group.name} · <span style="font-weight:600; color:#64748b;">${group.desc}</span> · ${group.members.length}명</div>`;
        el.addEventListener('mouseenter', () => { if(activeGroupId !== key) el.style.borderColor = '#94a3b8'; });
        el.addEventListener('mouseleave', () => { if(activeGroupId !== key) el.style.borderColor = '#e2e8f0'; });
        el.addEventListener('click', () => {
            selectCluster(key);
        });
        container.appendChild(el);
    });

    const legContainer = document.getElementById('manifoldLegend');
    if (legContainer) {
        legContainer.innerHTML = '';
        Object.values(clusterData).forEach(group => {
            legContainer.innerHTML += `<div style="display:flex; align-items:center; gap:6px;"><div style="width:12px; height:12px; border-radius:50%; background:${group.color};"></div>${group.name.split(' -')[0]}</div>`;
        });
    }
}

function selectCluster(key) {
    if (!key || !clusterData?.[key]) return;
    activeGroupId = key;
    activePriorityMode = 'average';
    document.querySelectorAll('.cluster-card').forEach(card => card.style.borderColor = '#e2e8f0');
    const keys = Object.keys(clusterData);
    const selectedCard = document.querySelectorAll('.cluster-card')[keys.indexOf(key)];
    if (selectedCard) selectedCard.style.borderColor = clusterData[key].color;
    const priorityPanel = document.getElementById('priorityGraphPanel');
    if (priorityPanel) priorityPanel.style.display = 'block';
    renderPriorityGraph();
    renderGroupExtras();
}

function drawManifoldMap() {
    const svg = document.getElementById('manifoldSvg');
    if (!svg || !clusterData) return; svg.innerHTML = '';
    const pad=40, w=720, h=370;
    let allX=[], allY=[]; Object.values(clusterData).forEach(g=>g.coords.forEach(c=>{allX.push(c.x); allY.push(c.y);}));
    if(allX.length===0) return;
    const minX=Math.min(...allX)-5, maxX=Math.max(...allX)+5, minY=Math.min(...allY)-5, maxY=Math.max(...allY)+5;
    const getX=v=>pad+((v-minX)/(maxX-minX||1))*w, getY=v=>pad+(1-((v-minY)/(maxY-minY||1)))*h;
    
    Object.values(clusterData).forEach(group => {
        if(!group.coords||group.coords.length===0) return;
        let cx=0, cy=0; group.coords.forEach(c=>{cx+=getX(c.x); cy+=getY(c.y);}); cx/=group.coords.length; cy/=group.coords.length;
        let md=40; group.coords.forEach(c=>{const d=Math.sqrt(Math.pow(getX(c.x)-cx,2)+Math.pow(getY(c.y)-cy,2)); if(d>md) md=d;});
        const c=document.createElementNS("http://www.w3.org/2000/svg","circle"); c.setAttribute("cx",cx); c.setAttribute("cy",cy); c.setAttribute("r",md+20); c.setAttribute("fill",group.color); c.style.opacity="0.1"; svg.appendChild(c);
        group.coords.forEach(c=>{
            const d=document.createElementNS("http://www.w3.org/2000/svg","circle"); d.setAttribute("cx",getX(c.x)); d.setAttribute("cy",getY(c.y)); d.setAttribute("r","6"); d.setAttribute("fill",group.color); d.setAttribute("stroke","#fff"); d.setAttribute("stroke-width","2"); svg.appendChild(d);
            const l=document.createElementNS("http://www.w3.org/2000/svg","text"); l.textContent=c.id; l.setAttribute("x",getX(c.x)); l.setAttribute("y",getY(c.y)-10); l.style.cssText="font-size:10px; font-weight:800; fill:#1e293b; text-anchor:middle; opacity:0;";
            d.addEventListener('mouseenter',()=>l.style.opacity="1"); d.addEventListener('mouseleave',()=>l.style.opacity="0"); svg.appendChild(l);
        });
    });
}

function renderPriorityGraph() {
    if(!activeGroupId || !clusterData || !globalData) return;
    const group = clusterData[activeGroupId], members = group.members;
    const pillContainer = document.getElementById('priorityGraphPills');
    if(pillContainer) {
        pillContainer.innerHTML = '';
        const makePill = (id, label) => {
            const isAct = (activePriorityMode === id), p = document.createElement('div');
            p.style.cssText = `padding:8px 16px; border-radius:20px; font-size:13px; cursor:pointer; transition:all 0.2s; border:1px solid ${isAct?'#cbd5e1':'#e2e8f0'}; background:${isAct?'#f1f5f9':'#ffffff'}; font-weight:${isAct?'800':'600'}; color:${isAct?'#0f172a':'#64748b'};`;
            p.textContent = label; p.onclick = () => { activePriorityMode = id; renderPriorityGraph(); }; pillContainer.appendChild(p);
        };
        makePill('average', '그룹 평균'); members.forEach(m => makePill(m, m));
    }

    let plotData = [];
    if (activePriorityMode === 'average') {
        const roundAgg = {};
        members.forEach(m => {
            (globalData.cohort_profiles[m]?.tasks?.maze?.raw_points||[]).forEach(p => {
                if(isNaN(p.round)||isNaN(p.rt)||isNaN(p.accuracy)) return;
                if(!roundAgg[p.round]) roundAgg[p.round] = {rt:0, acc:0, c:0};
                roundAgg[p.round].rt+=p.rt; roundAgg[p.round].acc+=p.accuracy; roundAgg[p.round].c++;
            });
        });
        plotData = Object.keys(roundAgg).map(r => ({ round: parseInt(r), rt: roundAgg[r].rt/roundAgg[r].c, acc: roundAgg[r].acc/roundAgg[r].c })).sort((a,b)=>a.round-b.round);
    } else {
        plotData = (globalData.cohort_profiles[activePriorityMode]?.tasks?.maze?.raw_points||[]).filter(p=>!isNaN(p.round)&&!isNaN(p.rt)&&!isNaN(p.accuracy)).map(p=>({round:p.round, rt:p.rt, acc:p.accuracy})).sort((a,b)=>a.round-b.round);
    }

    if (plotData.length > 0) {
        document.getElementById('pgRounds').textContent = plotData.length;
        document.getElementById('pgRt').textContent = (plotData.reduce((s,d)=>s+d.rt,0)/plotData.length).toFixed(2)+"s";
        document.getElementById('pgAcc').textContent = (plotData.reduce((s,d)=>s+d.acc,0)/plotData.length).toFixed(1)+"%";
    }

    const svg = document.getElementById('prioritySvg'); if (!svg) return; svg.innerHTML = ''; if (plotData.length === 0) return;
    const padL=60, padR=40, padT=40, padB=60;
    const w = 800 - padL - padR, h = 400 - padT - padB;
    const rts=plotData.map(p=>p.rt), accs=plotData.map(p=>p.acc);
    const minRt=Math.max(0,Math.min(...rts)-0.5), maxRt=Math.max(...rts)+0.5, minAcc=Math.max(0,Math.min(...accs)-2), maxAcc=Math.min(100,Math.max(...accs)+2);
    const getX=rt=>padL+((rt-minRt)/(maxRt-minRt||1))*w, getY=acc=>padT+(1-((acc-minAcc)/(maxAcc-minAcc||1)))*h;

    for (let i=0; i<=4; i++) {
        const val=minAcc+((maxAcc-minAcc)*i/4), y=getY(val), line=document.createElementNS("http://www.w3.org/2000/svg","line");
        Object.assign(line.style, { stroke: "#e2e8f0", strokeWidth: "1" }); line.setAttribute("x1",padL); line.setAttribute("y1",y); line.setAttribute("x2",padL+w); line.setAttribute("y2",y); svg.appendChild(line);
        const text=document.createElementNS("http://www.w3.org/2000/svg","text"); text.textContent=val.toFixed(1)+"%"; text.setAttribute("x",padL-10); text.setAttribute("y",y+4); Object.assign(text.style, { fontSize: "11px", fill: "#64748b", textAnchor: "end", fontFamily: "sans-serif", fontWeight:"600" }); svg.appendChild(text);
    }
    const lY=document.createElementNS("http://www.w3.org/2000/svg","text"); lY.textContent="정답률"; lY.setAttribute("x",-(padT+h/2)); lY.setAttribute("y",15); lY.setAttribute("transform","rotate(-90)"); Object.assign(lY.style, {fontSize:"12px", fontWeight:"900", fill:"#0f172a", textAnchor:"middle"}); svg.appendChild(lY);

    for (let i=0; i<=5; i++) {
        const val=minRt+((maxRt-minRt)*i/5), x=getX(val), line=document.createElementNS("http://www.w3.org/2000/svg","line");
        Object.assign(line.style, { stroke: "#e2e8f0", strokeWidth: "1" }); line.setAttribute("x1",x); line.setAttribute("y1",padT); line.setAttribute("x2",x); line.setAttribute("y2",padT+h); svg.appendChild(line);
        const text=document.createElementNS("http://www.w3.org/2000/svg","text"); text.textContent=val.toFixed(1); text.setAttribute("x",x); text.setAttribute("y",padT+h+20); Object.assign(text.style, { fontSize: "11px", fill: "#64748b", textAnchor: "middle", fontFamily: "sans-serif", fontWeight:"600" }); svg.appendChild(text);
    }
    const lX=document.createElementNS("http://www.w3.org/2000/svg","text"); lX.textContent="RT (반응시간)"; lX.setAttribute("x",padL+w/2); lX.setAttribute("y",padT+h+50); Object.assign(lX.style, {fontSize:"12px", fontWeight:"900", fill:"#0f172a", textAnchor:"middle"}); svg.appendChild(lX);

    const color = activePriorityMode === 'average' ? '#ef4444' : '#3b82f6';
    let d=""; plotData.forEach((p,i)=>d+=(i===0?"M":"L")+` ${getX(p.rt)} ${getY(p.acc)}`);
    const path=document.createElementNS("http://www.w3.org/2000/svg","path"); path.setAttribute("d",d); path.setAttribute("stroke",color); path.setAttribute("stroke-width","2.5"); path.setAttribute("fill","none"); svg.appendChild(path);
    plotData.forEach(p=>{
        const c=document.createElementNS("http://www.w3.org/2000/svg","circle"); c.setAttribute("cx",getX(p.rt)); c.setAttribute("cy",getY(p.acc)); c.setAttribute("r","5"); c.setAttribute("fill",color); c.setAttribute("stroke","#fff"); c.setAttribute("stroke-width","2"); svg.appendChild(c);
        const l=document.createElementNS("http://www.w3.org/2000/svg","text"); l.textContent=p.round; l.setAttribute("x",getX(p.rt)); l.setAttribute("y",getY(p.acc)-10); l.style.cssText=`font-size:14px; font-weight:900; fill:${color}; text-anchor:middle;`; svg.appendChild(l);
    });
}

function renderGroupExtras() {
    if(!activeGroupId || !clusterData || !globalData) return;
    const group = clusterData[activeGroupId], members = group.members;
    
    const aggregateTask = (taskKey) => {
        const roundData = {}, transData = {};
        members.forEach(m => {
            const profile = globalData.cohort_profiles[m];
            if(!profile?.tasks?.[taskKey]) return;
            
            (profile.tasks[taskKey].raw_points||[]).forEach(pt => {
                if(isNaN(pt.round)) return;
                if(!roundData[pt.round]) roundData[pt.round] = { round: pt.round, rtSum: 0, accSum: 0, count: 0, m_true_O: 0, m_true_X: 0, m_false_O: 0, m_false_X: 0, m_total: 0 };
                roundData[pt.round].rtSum += pt.rt || 0;
                roundData[pt.round].accSum += pt.accuracy || 0;
                roundData[pt.round].count += 1;
                if(pt.matrix) {
                    roundData[pt.round].m_true_O += pt.matrix.true_O || 0; roundData[pt.round].m_true_X += pt.matrix.true_X || 0;
                    roundData[pt.round].m_false_O += pt.matrix.false_O || 0; roundData[pt.round].m_false_X += pt.matrix.false_X || 0;
                    roundData[pt.round].m_total += pt.matrix.total_items || 176;
                }
            });
            
            (profile.tasks[taskKey].transitions||[]).forEach(tr => {
                const key = `${tr.from_round}-${tr.to_round}`;
                if(!transData[key]) transData[key] = { from_round: tr.from_round, to_round: tr.to_round, cc: 0, cx: 0, xx: 0, xc: 0 };
                transData[key].cc += tr.cc || 0; transData[key].cx += tr.cx || 0; transData[key].xx += tr.xx || 0; transData[key].xc += tr.xc || 0;
            });
        });
        
        const raw_points = Object.values(roundData).sort((a,b) => a.round - b.round).map(r => ({
            round: r.round, rt: r.count>0 ? r.rtSum/r.count : 0, accuracy: r.count>0 ? r.accSum/r.count : 0,
            matrix: { true_O: r.m_true_O, true_X: r.m_true_X, false_O: r.m_false_O, false_X: r.m_false_X, total_items: r.m_total }
        }));
        const transitions = Object.values(transData).sort((a,b) => a.from_round - b.from_round);
        return { raw_points, transitions, rt_trend: {curve: raw_points.map(p=>({round:p.round, value:p.rt}))}, accuracy_trend: {curve: raw_points.map(p=>({round:p.round, value:p.accuracy}))} };
    };

    const aggMaze = aggregateTask('maze'), aggRsvp = aggregateTask('rsvp');

    const modelPanel = document.getElementById('groupModelPanel');
    if(modelPanel) {
        modelPanel.style.display = 'flex';
        document.getElementById('groupMetaLabel').textContent = `${group.name} · ${members.length}명 통합 평균 모델`;
        drawStylizedModelChart('gStylizedMazeRt', aggMaze, 'rt'); drawStylizedModelChart('gStylizedMazeAcc', aggMaze, 'accuracy');
        drawStylizedModelChart('gStylizedRsvpRt', aggRsvp, 'rt'); drawStylizedModelChart('gStylizedRsvpAcc', aggRsvp, 'accuracy');
    }

    const transPanel = document.getElementById('groupTransitionPanel');
    if(transPanel) {
        transPanel.style.display = 'flex';
        renderTransitionPanelData(aggMaze, 'gTransitionRoundsContainer', 'gTransitionMatricesContainer', 'gTransitionLineChart');
    }

    renderConfusionMatrices(aggMaze.raw_points, 'groupDetailPanel');
}
