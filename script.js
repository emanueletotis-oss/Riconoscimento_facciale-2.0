const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const curtain = document.getElementById('videoCurtain');
const loader = document.getElementById('globalLoader');
const inputFile = document.getElementById('inputFile');
const cropModal = document.getElementById('cropModal');
const targetModal = document.getElementById('targetModal');
const cropImgElement = document.getElementById('cropImage');

let db = JSON.parse(localStorage.getItem('faceDB_v7')) || [];
let faceMatcher = null;
let isScanning = false;
let currentFacingMode = 'environment';
let selectedTarget = null;
let stream = null;
let activeEditIndex = -1;
let cropper = null;
let onCropComplete = null;

async function init() {
    toggleLoader(true, "CARICAMENTO IA...");
    const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
    try {
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        updateFaceMatcher();
        renderDB();
    } catch (e) { console.error(e); }
    toggleLoader(false);
}
init();

function toggleLoader(show, text = "") {
    loader.style.display = show ? 'flex' : 'none';
    if(text) document.getElementById('loaderText').innerText = text;
}

function updateFaceMatcher() {
    if (db.length > 0) {
        const labeled = db.map(u => {
            const descs = u.photos.map(p => new Float32Array(Object.values(p.descriptor)));
            return new faceapi.LabeledFaceDescriptors(u.name, descs);
        });
        faceMatcher = new faceapi.FaceMatcher(labeled, 0.55);
    } else { faceMatcher = null; }
}

function calculateEfficacy(photos) {
    if (!photos || photos.length === 0) return { text: "EFFICACIA: 0%", class: "eff-low" };
    const avgScore = photos.reduce((acc, p) => acc + (p.score || 0), 0) / photos.length;
    const score = Math.round(avgScore * 100);
    if (score > 85) return { text: `EFFICACIA: ${score}% (OTTIMA)`, class: "eff-high" };
    if (score > 60) return { text: `EFFICACIA: ${score}% (MEDIA)`, class: "eff-med" };
    return { text: `EFFICACIA: ${score}% (SCARSA)`, class: "eff-low" };
}

// GESTIONE RITAGLIO
async function openCropper(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        cropImgElement.src = e.target.result;
        cropModal.style.display = 'flex';
        if (cropper) cropper.destroy();
        cropper = new Cropper(cropImgElement, {
            aspectRatio: 1,
            viewMode: 1,
            autoCropArea: 1,
            responsive: true,
            restore: false
        });
        onCropComplete = callback;
    };
    reader.readAsDataURL(file);
}

document.getElementById('btnDoCrop').onclick = () => {
    const croppedCanvas = cropper.getCroppedCanvas({ width: 400, height: 400 });
    croppedCanvas.toBlob(async (blob) => {
        cropModal.style.display = 'none';
        if (onCropComplete) onCropComplete(blob);
    }, 'image/jpeg');
};

document.getElementById('btnCancelCrop').onclick = () => {
    cropModal.style.display = 'none';
    if (cropper) cropper.destroy();
};

// ACTIONS DB
document.getElementById('btnAddPhoto').onclick = () => {
    const name = document.getElementById('newName').value;
    if (!name) return alert("Nome mancante!");
    inputFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        openCropper(file, (blob) => addPhotoToDB(name, blob));
    };
    inputFile.click();
};

async function addPhotoToDB(name, blob, isEditing = false) {
    toggleLoader(true, "ANALISI BIOMETRICA...");
    const img = await faceapi.bufferToImage(blob);
    const det = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
    if (det) {
        let user = db.find(u => u.name.toLowerCase() === name.toLowerCase());
        const data = { descriptor: det.descriptor, score: det.score };
        if (user) user.photos.push(data); else db.push({ name, photos: [data] });
        localStorage.setItem('faceDB_v7', JSON.stringify(db));
        updateFaceMatcher(); renderDB();
        if(isEditing) openEditModal(activeEditIndex);
        document.getElementById('newName').value = "";
    } else { alert("VOLTO NON VALIDO NELLA ZONA RITAGLIATA!"); }
    toggleLoader(false);
}

function renderDB() {
    const list = document.getElementById('dbList');
    list.innerHTML = db.map((u, i) => {
        const eff = calculateEfficacy(u.photos);
        return `<div class="db-item">
            <div class="db-name-box">
                <span class="db-name">${u.name}</span>
                <span class="db-efficacy ${eff.class}">${eff.text}</span>
            </div>
            <div class="db-actions">
                <button class="btn btn-target" style="padding:6px 12px; font-size:14px;" onclick="openEditModal(${i})">Modifica</button>
                <button class="btn btn-stop" style="padding:6px 12px; font-size:14px;" onclick="delP(${i})">Elimina</button>
            </div>
        </div>`;
    }).join('');
}

window.openEditModal = (idx) => {
    activeEditIndex = idx;
    const user = db[idx];
    document.getElementById('editNameField').value = user.name;
    const list = document.getElementById('photoStatusList');
    list.innerHTML = user.photos.map((p, pi) => `
        <div class="photo-item">
            <span>Foto ${pi+1} (Qualità: ${Math.round(p.score*100)}%)</span>
            <button onclick="removePhoto(${idx}, ${pi})" style="color:red; background:none; border:none; font-size:20px; cursor:pointer;">&times;</button>
        </div>`).join('');
    document.getElementById('editModal').style.display = 'flex';
};

document.getElementById('editNameField').oninput = (e) => {
    db[activeEditIndex].name = e.target.value;
    localStorage.setItem('faceDB_v7', JSON.stringify(db));
    renderDB();
};

window.removePhoto = (ui, pi) => {
    db[ui].photos.splice(pi, 1);
    if(db[ui].photos.length === 0) { db.splice(ui, 1); document.getElementById('editModal').style.display='none'; }
    localStorage.setItem('faceDB_v7', JSON.stringify(db));
    updateFaceMatcher(); renderDB();
    if(db[ui]) openEditModal(ui);
};

document.getElementById('btnAddNewPhoto').onclick = () => {
    inputFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        openCropper(file, (blob) => addPhotoToDB(db[activeEditIndex].name, blob, true));
    };
    inputFile.click();
};

document.getElementById('closeEditModal').onclick = () => document.getElementById('editModal').style.display = 'none';

// VIDEO LOGIC
async function startDetection() {
    const displaySize = { width: video.offsetWidth, height: video.offsetHeight };
    faceapi.matchDimensions(canvas, displaySize);
    const loop = async () => {
        if (!isScanning) return;
        const detections = await faceapi.detectAllFaces(video).withFaceLandmarks().withFaceDescriptors();
        const resized = faceapi.resizeResults(detections, displaySize);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        resized.forEach(det => {
            const { x, y, width, height } = det.detection.box;
            let label = "Sconosciuto";
            let matched = false;
            if (selectedTarget) {
                const dists = selectedTarget.photos.map(p => faceapi.euclideanDistance(det.descriptor, new Float32Array(Object.values(p.descriptor))));
                if (Math.min(...dists) < 0.6) { matched = true; label = selectedTarget.name; }
            } else if (faceMatcher) {
                const m = faceMatcher.findBestMatch(det.descriptor);
                if (m.label !== 'unknown') { matched = true; label = m.label; }
            }
            const color = matched ? "rgb(124, 252, 0)" : "rgb(255, 215, 0)";
            ctx.strokeStyle = color; ctx.lineWidth = matched ? 6 : 3;
            ctx.strokeRect(x, y, width, height);
            ctx.fillStyle = color; ctx.font = "bold 22px Arial";
            ctx.fillText(label.toUpperCase(), x, y - 10);
        });
        requestAnimationFrame(loop);
    };
    loop();
}

document.getElementById('btnStart').onclick = async () => {
    isScanning = true; curtain.style.display = 'block'; document.getElementById('placeholder').style.display = 'none';
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacingMode, width: 1280, height: 720 } });
        video.srcObject = stream;
        video.onplaying = () => { video.style.opacity = "1"; setTimeout(() => { curtain.style.display = 'none'; startDetection(); }, 600); };
    } catch (e) { isScanning = false; }
};

document.getElementById('btnStop').onclick = () => {
    isScanning = false; if (stream) stream.getTracks().forEach(t => t.stop());
    video.srcObject = null; video.style.opacity = "0";
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('placeholder').style.display = 'flex'; selectedTarget = null;
};

// TARGET SELECTION
document.getElementById('btnTarget').onclick = () => {
    targetModal.style.display = 'flex';
    const l = document.getElementById('dbTargetList');
    l.innerHTML = `<div class="mini-item" onclick="selT(null)">🔍 TUTTI</div>` + 
        db.map((u, i) => `<div class="mini-item" onclick="selT(${i})">👤 ${u.name}</div>`).join('');
};

window.selT = (i) => { selectedTarget = i !== null ? db[i] : null; targetModal.style.display = 'none'; };

document.getElementById('uploadNewTarget').onclick = () => {
    inputFile.onchange = (e) => {
        const file = e.target.files[0]; if(!file) return;
        // Chiudi il modal del target subito per mostrare il ritagliatore
        targetModal.style.display = 'none';
        
        openCropper(file, async (blob) => {
            toggleLoader(true, "ANALISI TARGET...");
            const img = await faceapi.bufferToImage(blob);
            const det = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
            if (det) { 
                selectedTarget = { name: "Esterno", photos: [{descriptor: det.descriptor, score: det.score}] }; 
            } else { 
                alert("Volto non trovato!"); 
            }
            toggleLoader(false);
        });
    };
    inputFile.click();
};

document.getElementById('closeTargetModal').onclick = () => targetModal.style.display = 'none';
document.getElementById('btnOpenDB').onclick = () => { document.getElementById('mainScreen').classList.remove('active'); document.getElementById('dbScreen').classList.add('active'); };
document.getElementById('btnCloseDB').onclick = () => { document.getElementById('dbScreen').classList.remove('active'); document.getElementById('mainScreen').classList.add('active'); };
document.getElementById('btnSwitch').onclick = () => { currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user'; if(isScanning) document.getElementById('btnStart').click(); };
window.delP = (i) => { if(confirm("Eliminare profilo?")) { db.splice(i, 1); localStorage.setItem('faceDB_v7', JSON.stringify(db)); updateFaceMatcher(); renderDB(); } };