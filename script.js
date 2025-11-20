// Canvas Setup
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const tCanvas = document.getElementById('trendCanvas');
const tctx = tCanvas.getContext('2d');
const tooltip = document.getElementById('tooltip');

// Simulation State
let particles = [], terrain = [], originalTerrain = [], trees = [], raindrops = [], debris = [], debrisPile = [];
let animating = false, raining = false, fallenParticles = 0, slidingActive = false;
let currentSeed = Date.now(), simulationTime = 0, totalRainfall = 0;
const GAMMA_W = 9.81, MAX_POINTS = 300;
let fosHistory = [], pofHistory = [], ruHistory = [], autoSlideTriggered = false;
let lastFrameTime = Date.now();

// Canvas Zoom State
let canvasZoom = 1;
let canvasOffsetX = 0;
let canvasOffsetY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// Random Number Generator
class Random {
    constructor(s) {
        this.seed = s | 0;
    }
    next() {
        this.seed = (9301 * this.seed + 49297) % 233280;
        return this.seed / 233280;
    }
}

let rng = new Random(currentSeed);

// Particle Class
class Particle {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.initialX = x;
        this.initialY = y;
        this.vx = 0;
        this.vy = 0;
        this.size = type === 'rock' ? 3 : type === 'vegetation' ? 2.2 : 1.8;
        this.type = type;
        this.stable = true;
        this.fallen = false;
        this.mass = type === 'rock' ? 1.5 : type === 'vegetation' ? 0.7 : 1;
        this.color = this.generateColor();
        this.momentum = 0;
    }

    generateColor() {
        const t = rng.next();
        if (this.type === 'vegetation') return `hsl(${110 + t * 20},${60 + t * 20}%,${40 + t * 15}%)`;
        if (this.type === 'rock') return `hsl(0,0%,${45 + t * 20}%)`;
        return `hsl(${25 + t * 10},${45 + t * 15}%,${35 + t * 15}%)`;
    }

    update() {
        if (this.fallen) return;
        if (!this.stable) {
            const env = getEnv();
            const gravity = 0.2 * this.mass;
            let found = false, baseY = 0, slopeAngle = 0;

            for (let i = 0; i < terrain.length - 1; i++) {
                const a = terrain[i], b = terrain[i + 1];
                if (this.x >= a.x && this.x <= b.x) {
                    const t = (this.x - a.x) / (b.x - a.x);
                    baseY = a.y + (b.y - a.y) * t;
                    slopeAngle = Math.atan2(b.y - a.y, b.x - a.x);
                    found = true;
                    break;
                }
            }

            if (found && this.y >= baseY - 8) {
                this.y = baseY - this.size * 0.6;
                const sinSlope = Math.sin(slopeAngle);
                const vegReduction = this.type === 'vegetation' ? 1 - env.vegetation * 0.8 : 1;
                const downForce = Math.sign(slopeAngle) * Math.abs(sinSlope) * 0.5 * vegReduction;
                const ruBoost = 1 + 2 * env.ru;
                const erosionFactor = 1 + env.erosion * 1.2;

                this.vx += downForce * ruBoost * erosionFactor;
                this.vx += 0.05 * (rng.next() - 0.5) * Math.abs(sinSlope);

                const baseDamp = this.type === 'rock' ? 0.97 : this.type === 'vegetation' ? 0.88 : 0.92;
                const damp = Math.max(0.6, baseDamp - 0.3 * env.ru);
                this.vx *= damp;
                this.vy = 0;

                if (Math.abs(this.vx) < 0.02 && Math.abs(sinSlope) < 0.05) {
                    this.stable = true;
                    this.vx = 0;
                    debrisPile.push({ x: this.x, y: baseY, size: this.size, color: this.color });
                }

                if (Math.abs(this.vx) > 1.5 && rng.next() > 0.96) {
                    debris.push(new DebrisCloud(this.x, this.y));
                }
            } else {
                this.vy += gravity;
                this.vx *= 0.98;
                this.vy = Math.min(this.vy, 10);
            }

            this.x += this.vx;
            this.y += this.vy;
            this.momentum = Math.sqrt(this.vx * this.vx + this.vy * this.vy);

            if (this.y > canvas.height + 30 || this.x < -60 || this.x > canvas.width + 60) {
                this.fallen = true;
                if (this.x >= 0 && this.x <= canvas.width) {
                    debrisPile.push({ x: this.x, y: canvas.height - 3, size: this.size * 0.7, color: this.color });
                }
            }
        }
    }

    draw() {
        if (this.fallen) return;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, 2 * Math.PI);
        ctx.fill();

        if (this.momentum > 0.7) {
            ctx.strokeStyle = `rgba(255,120,0,${Math.min(0.6, this.momentum / 4)})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x - 2 * this.vx, this.y - 2 * this.vy);
            ctx.stroke();
        }
    }
}

// Debris Cloud Class
class DebrisCloud {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 2 * (rng.next() - 0.5);
        this.vy = -1.5 * rng.next();
        this.size = 3 + 4 * rng.next();
        this.life = 1;
        this.decay = 0.02;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.07;
        this.vx *= 0.97;
        this.life -= this.decay;
    }

    draw() {
        if (this.life > 0) {
            ctx.fillStyle = `rgba(120,80,40,${0.4 * this.life})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * this.life, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
}

// Raindrop Class
class Raindrop {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = -15;
        this.speed = 6 + 6 * Math.random();
        this.len = 12 + 10 * Math.random();
    }

    update() {
        this.y += this.speed;
        for (let i = 0; i < terrain.length - 1; i++) {
            const a = terrain[i], b = terrain[i + 1];
            if (this.x >= a.x && this.x <= b.x) {
                const t = (this.x - a.x) / (b.x - a.x);
                const groundY = a.y + (b.y - a.y) * t;
                if (this.y >= groundY) return false;
            }
        }
        return this.y < canvas.height + 15;
    }

    draw() {
        ctx.strokeStyle = "rgba(150,200,230,0.7)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - 2, this.y + this.len);
        ctx.stroke();
    }
}

// Utility Functions
function throttle(func, delay) {
    let timeoutId;
    let lastRan;
    return function (...args) {
        if (!lastRan) {
            func.apply(this, args);
            lastRan = Date.now();
        } else {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                if ((Date.now() - lastRan) >= delay) {
                    func.apply(this, args);
                    lastRan = Date.now();
                }
            }, delay - (Date.now() - lastRan));
        }
    };
}

function getEnv() {
    const veg = parseFloat(document.getElementById("vegetation").value) / 100;
    const ero = parseFloat(document.getElementById("erosion").value) / 100;
    const moist = parseFloat(document.getElementById("soilMoisture").value) / 100;
    const rain = parseFloat(document.getElementById("rainIntensity").value);
    const k = parseFloat(document.getElementById("hydCond").value) * 1e-6;
    return {
        vegetation: veg,
        erosion: ero,
        moisture: moist,
        rain: rain,
        k: k,
        soilDepth: parseFloat(document.getElementById("soilDepth").value),
        unitWeight: parseFloat(document.getElementById("unitWeight").value),
        cohesion: parseFloat(document.getElementById("cohesionGeo").value),
        phi: parseFloat(document.getElementById("phiGeo").value),
        slopeAngle: parseFloat(document.getElementById("slopeAngle").value),
        sigma: parseFloat(document.getElementById("fosSigma").value),
        ru: 0
    };
}

// Pore Pressure Calculation
function computeRU() {
    const env = getEnv();
    const baseSat = env.moisture;

    if (raining) {
        const timeAcceleration = 300;
        const simulatedTime = simulationTime * timeAcceleration;
        const I_mm_per_hr = env.rain;
        const I_m_per_hr = I_mm_per_hr / 1000;
        const k_m_per_hr = env.k * 3600;
        const infiltRate_m_per_hr = Math.min(I_m_per_hr, k_m_per_hr);
        const simulatedHours = simulatedTime / 3600;
        const infiltDepth = infiltRate_m_per_hr * simulatedHours;
        const porosity = 0.35;
        const permeabilityFactor = Math.max(0.5, Math.min(2.0, 1.0 / (k_m_per_hr * 100 + 0.01)));
        const ruIncrease = Math.min(0.70, (infiltDepth / (env.soilDepth * porosity)) * permeabilityFactor * 1.5);
        const erosionEffect = env.erosion * 0.15;
        const totalRu = Math.min(0.95, baseSat + ruIncrease + erosionEffect);

        const displayMinutes = simulatedHours * 60;
        document.getElementById('rainTime').textContent = displayMinutes.toFixed(1);
        document.getElementById('infiltStatus').textContent = (infiltDepth * 1000).toFixed(1);
        const ruRatePerHr = simulatedHours > 0 ? (ruIncrease / simulatedHours) : 0;
        document.getElementById('ruRate').textContent = ruRatePerHr.toFixed(3);
        totalRainfall = infiltDepth * 1000;
        document.getElementById('timeDisplay').textContent =
            `Elapsed: ${displayMinutes.toFixed(1)} min | Rain: ${totalRainfall.toFixed(1)} mm`;

        return totalRu;
    }

    document.getElementById('timeDisplay').textContent = `Elapsed: 0.0 min | Rain: 0.0 mm`;
    return baseSat + env.erosion * 0.08;
}

// Effective Cohesion
function computeEffCohesion() {
    const env = getEnv();
    const base = env.cohesion;
    const vegBoost = 1 + env.vegetation * 0.18;
    const erosionRed = 1 - env.erosion * 0.50;
    return Math.max(0.5, base * vegBoost * erosionRed);
}

// Effective Friction Angle
function computeEffFriction() {
    const env = getEnv();
    return env.phi + env.vegetation * 1.5;
}

// Factor of Safety (Infinite Slope Method)
function computeFoS() {
    const env = getEnv();
    const z = env.soilDepth;
    const gamma = env.unitWeight;
    const c = computeEffCohesion();
    const phi = computeEffFriction() * Math.PI / 180;
    const beta = env.slopeAngle * Math.PI / 180;
    const ru = computeRU();
    env.ru = ru;

    const u = ru * GAMMA_W * z;
    const normalStress = gamma * z * Math.pow(Math.cos(beta), 2);
    const effectiveStress = Math.max(0, normalStress - u);
    const shearStrength = c + effectiveStress * Math.tan(phi);
    const drivingStress = gamma * z * Math.sin(beta) * Math.cos(beta);

    if (Math.abs(drivingStress) < 1e-6) return 999;

    const fos = shearStrength / drivingStress;
    return Math.max(0, Math.min(20, fos));
}

// Error Function for Normal Distribution
function erf(x) {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * x);
    return sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
}

function normalCdf(x, mu = 0, sigma = 1) {
    return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
}

// Probability of Failure
function computePoF(FoS, cov) {
    if (FoS <= 0 || !isFinite(FoS)) return 1;
    const sigma = cov * FoS;
    if (sigma <= 0) return FoS < 1 ? 1 : 0;
    return Math.max(0, Math.min(1, normalCdf(1, FoS, sigma)));
}

function pushTrend(fos, pof) {
    if (fosHistory.length >= MAX_POINTS) {
        fosHistory.shift();
        pofHistory.shift();
    }
    fosHistory.push(fos);
    pofHistory.push(100 * pof);
}

// Update UI Effects
function updateEffects() {
    const env = getEnv();
    const vegCohesion = (env.cohesion * env.vegetation * 0.18).toFixed(1);
    document.getElementById("vegEffect").textContent = vegCohesion;
    const erosionLoss = (env.cohesion * env.erosion * 0.50).toFixed(1);
    document.getElementById("erosionEffect").textContent = erosionLoss;
    document.getElementById("moistureEffect").textContent = env.moisture.toFixed(2);
    const ceff = computeEffCohesion();
    document.getElementById("ceffValue").textContent = ceff.toFixed(1) + " kPa";
}

// Update Risk Assessment
function updateRisk() {
    const fosEl = document.getElementById("fosValue");
    const pofEl = document.getElementById("pofValue");
    const ruEl = document.getElementById("ruValue");
    const fosStatusEl = document.getElementById("fosStatus");
    const pofStatusEl = document.getElementById("pofStatus");
    const sysEl = document.getElementById("systemStatus");

    if (!terrain.length) {
        fosEl.textContent = "—";
        pofEl.textContent = "—";
        ruEl.textContent = "—";
        return;
    }

    const fos = computeFoS();
    const cov = parseFloat(document.getElementById("fosSigma").value);
    const pof = computePoF(fos, cov);
    const ru = computeRU();

    fosEl.textContent = isFinite(fos) ? fos.toFixed(3) : "—";
    pofEl.textContent = (100 * pof).toFixed(2) + "%";
    ruEl.textContent = ru.toFixed(3);

    pushTrend(isFinite(fos) ? Math.min(fos, 10) : 10, pof);
    updateEffects();

    fosEl.className = "value";
    pofEl.className = "value";

    if (fos >= 1.5 && pof < 0.05) {
        fosEl.classList.add("risk-low");
        pofEl.classList.add("risk-low");
        fosStatusEl.textContent = "✓ Safe - Acceptable";
        pofStatusEl.textContent = "✓ Very Low Risk";
        sysEl.textContent = "🟢 Stable";
    } else if (fos >= 1.2 && pof < 0.20) {
        fosEl.classList.add("risk-medium");
        pofEl.classList.add("risk-medium");
        fosStatusEl.textContent = "⚠ Marginal - Monitor";
        pofStatusEl.textContent = "⚠ Moderate Risk";
        sysEl.textContent = "🟡 Caution";
    } else if (fos >= 1.0 && pof < 0.50) {
        fosEl.classList.add("risk-high");
        pofEl.classList.add("risk-high");
        fosStatusEl.textContent = "⚠ Critical - Unstable";
        pofStatusEl.textContent = "⚠ High Risk";
        sysEl.textContent = "🟠 Unstable";
    } else {
        fosEl.classList.add("risk-high");
        pofEl.classList.add("risk-high");
        fosStatusEl.textContent = "✗ Failure Imminent";
        pofStatusEl.textContent = "✗ Extreme Risk";
        sysEl.textContent = "🔴 FAILING";
    }

    // Auto-trigger landslide based on probability
    if (!autoSlideTriggered && !slidingActive && (fos < 1.0 || pof > 0.5)) {
        autoSlideTriggered = true;
        setTimeout(() => startLandslide(true), 800);
    }
}

// Start Landslide - Now properly uses probability
function startLandslide(isAuto = false) {
    if (slidingActive) return;
    slidingActive = true;
    animating = true;

    if (!terrain.length) return;

    const seedIdx = Math.floor(terrain.length * (0.35 + 0.35 * rng.next()));
    const seedX = terrain[seedIdx].x;
    const fos = computeFoS();
    const cov = parseFloat(document.getElementById("fosSigma").value);
    const pof = computePoF(fos, cov);
    
    // Failure zone size based on conditions
    const baseFailZone = isAuto ? 180 : 140;
    const fosMultiplier = Math.max(0.5, (1.5 - fos)); // Lower FoS = larger zone
    const failZone = baseFailZone * (1 + fosMultiplier * 0.5);
    
    let affected = 0;

    particles.forEach(pt => {
        if (pt.fallen) return;
        const dx = Math.abs(pt.x - seedX);
        if (dx < failZone) {
            // Probability-based failure determination
            const distanceFactor = 1 - dx / failZone; // Closer to epicenter = higher probability
            const baseProb = isAuto ? pof * 0.9 : pof * 0.7; // Auto-trigger uses higher probability
            const finalProb = baseProb * distanceFactor * (0.6 + 0.7 * rng.next());
            
            // Each particle has independent probability to fail
            if (rng.next() < finalProb) {
                pt.stable = false;
                const slopeRad = getEnv().slopeAngle * Math.PI / 180;
                const dir = Math.sign(Math.sin(slopeRad)) || (rng.next() > 0.5 ? 1 : -1);
                
                // Speed scales with FoS deficit and distance from epicenter
                const speedFactor = Math.max(0.3, (1.5 - fos)) * 1.8 + 0.4;
                const distanceSpeedMod = 0.5 + 0.5 * distanceFactor;
                
                pt.vx = dir * (0.4 + 0.6 * rng.next()) * speedFactor * distanceSpeedMod;
                pt.vy = -0.2 * rng.next();
                
                if (rng.next() > 0.82) debris.push(new DebrisCloud(pt.x, pt.y));
                affected++;
            }
        }
    });

    // Trees affected by probability
    trees.forEach(t => {
        const dx = Math.abs(t.x - seedX);
        if (dx < failZone * 0.8) {
            const distanceFactor = 1 - dx / (failZone * 0.8);
            const treeFailProb = pof * 0.75 * distanceFactor;
            if (rng.next() < treeFailProb) {
                t.fallen = true;
                t.targetAngle = (t.x - seedX) > 0 ? 0.3 * Math.PI : -0.3 * Math.PI;
            }
        }
    });

    requestAnimationFrame(animate);
    console.log((isAuto ? "AUTO-" : "") + "Landslide | FoS:", fos.toFixed(3), "| PoF:", (100 * pof).toFixed(2) + "%", "| Affected:", affected, "particles");
}

// Toggle Rain
function toggleRain() {
    raining = !raining;
    const btn = document.getElementById("rainBtn");
    const statusDiv = document.getElementById("rainStatus");

    if (raining) {
        btn.textContent = "🌧️ Stop Rain";
        btn.style.background = "linear-gradient(135deg,#065f46,#0891b2)";
        statusDiv.style.display = 'block';
        lastFrameTime = Date.now();
    } else {
        btn.textContent = "🌧️ Start Rain";
        btn.style.background = "linear-gradient(135deg,#0ea5e9,#06b6d4)";
        statusDiv.style.display = 'none';
    }

    if (!animating) requestAnimationFrame(animate);
}

function toggleEducational() {
    const panel = document.getElementById("educationalPanel");
    panel.classList.toggle("open");
}

// Reset Simulation
function resetSim() {
    animating = false;
    raining = false;
    slidingActive = false;
    autoSlideTriggered = false;
    simulationTime = 0;
    totalRainfall = 0;

    const btn = document.getElementById("rainBtn");
    btn.textContent = "🌧️ Start Rain";
    btn.style.background = "linear-gradient(135deg,#0ea5e9,#06b6d4)";
    document.getElementById("rainStatus").style.display = 'none';

    // Reset to optimal default values
    document.getElementById("vegetation").value = 50;
    document.getElementById("vegVal").textContent = "50%";
    
    document.getElementById("erosion").value = 20;
    document.getElementById("erosionVal").textContent = "20%";
    
    document.getElementById("soilMoisture").value = 30;
    document.getElementById("moistureVal").textContent = "30%";
    
    document.getElementById("rainIntensity").value = 10;
    document.getElementById("rainVal").textContent = "10 mm/hr";
    
    document.getElementById("fosSigma").value = 0.15;
    document.getElementById("covVal").textContent = "15%";

    // Reset geotechnical parameters to defaults
    document.getElementById("soilDepth").value = 3.0;
    document.getElementById("unitWeight").value = 19.0;
    document.getElementById("cohesionGeo").value = 15;
    document.getElementById("phiGeo").value = 32;
    document.getElementById("slopeAngle").value = 30;
    document.getElementById("hydCond").value = 5.0;

    // Clear history arrays
    fosHistory = [];
    pofHistory = [];
    ruHistory = [];

    // Reset time display
    document.getElementById('timeDisplay').textContent = `Elapsed: 0.0 min | Rain: 0.0 mm`;
    
    // Reset rain status displays
    document.getElementById('rainTime').textContent = '0.0';
    document.getElementById('infiltStatus').textContent = '—';
    document.getElementById('ruRate').textContent = '—';
    
    // Reset fallen particles count
    document.getElementById("fallenCount").textContent = "0";

    // Generate new terrain
    generateTerrain();

    // Force vegetation regeneration immediately
    populateVegetationAndParticles();

    // Force recalculation of everything
    const fos = computeFoS();
    const cov = parseFloat(document.getElementById("fosSigma").value);
    const pof = computePoF(fos, cov);
    const ru = computeRU();
    const ceff = computeEffCohesion();

    // Update displays
    document.getElementById("fosValue").textContent = fos.toFixed(3);
    document.getElementById("pofValue").textContent = (100 * pof).toFixed(2) + "%";
    document.getElementById("ruValue").textContent = ru.toFixed(3);
    document.getElementById("ceffValue").textContent = ceff.toFixed(1) + " kPa";

    // Update status & colors
    updateRisk();
    drawTrendChart();
}
// Generate Terrain - ENHANCED VERSION
function generateTerrain() {
    currentSeed = Date.now();
    rng = new Random(currentSeed);
    particles = [];
    terrain = [];
    trees = [];
    debris = [];
    debrisPile = [];
    raindrops = [];
    originalTerrain = [];
    fallenParticles = 0;
    slidingActive = false;
    autoSlideTriggered = false;
    simulationTime = 0;
    totalRainfall = 0;
    lastFrameTime = Date.now();

    const points = 140;
    const env = getEnv();
    const slopeRad = env.slopeAngle * Math.PI / 180;

    // Initialize terrain with at least 2 points
    for (let i = 0; i < points; i++) {
        const x = i / (points - 1) * canvas.width;
        const n = i / (points - 1);
        let y = 0.82 * canvas.height - n * canvas.width * Math.tan(slopeRad) - 180 * Math.pow(n - 0.5, 2) + 30 * (rng.next() - 0.5);
        y = Math.max(70, Math.min(canvas.height - 70, y));
        terrain.push({ x: x, y: y, displaced: 0 });
    }

    // Ensure we have valid terrain data
    if (terrain.length < 2) {
        console.error("Terrain generation failed - insufficient points");
        return;
    }

    // Smooth terrain
    for (let k = 0; k < 4; k++) {
        for (let i = 1; i < terrain.length - 1; i++) {
            terrain[i].y = (terrain[i - 1].y + terrain[i].y + terrain[i + 1].y) / 3;
        }
    }

    originalTerrain = terrain.map(t => ({ x: t.x, y: t.y }));

    // Create new RNG for particles
    rng = new Random(currentSeed + 1000);

    populateVegetationAndParticles();
    fosHistory = [];
    pofHistory = [];
    updateRisk();
    drawTrendChart();
    draw();
}

// Populate Vegetation and Particles - FIXED VERSION
function populateVegetationAndParticles() {
    const env = getEnv();
    particles = [];
    trees = [];

    // Check if terrain has enough points
    if (terrain.length < 2) return;

    for (let i = 0; i < terrain.length - 1; i++) {
        const a = terrain[i];
        const b = terrain[i + 1];
        
        // Additional safety check
        if (!a || !b) continue;
        
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const cells = Math.ceil(segLen / 3.5);

        for (let c = 0; c < cells; c++) {
            const tt = c / cells;
            const px = a.x + (b.x - a.x) * tt + 1.5 * (rng.next() - 0.5);
            const py = a.y + (b.y - a.y) * tt + 1.5 * (rng.next() - 0.5);
            const layers = 3 + Math.floor(rng.next() * 2);

            for (let s = 0; s < layers; s++) {
                let type = "soil";
                const r = 100 * rng.next();

                if (r < 8) {
                    type = "rock";
                } else if (r < 8 + (env.vegetation * 30)) {
                    type = "vegetation";
                }

                particles.push(new Particle(px, py - s * 1.8, type));
            }
        }
    }

    const baseTreeCount = Math.floor(5 + env.vegetation * 45);
    for (let t = 0; t < baseTreeCount; t++) {
        // Ensure we don't try to access terrain beyond its bounds
        const idx = Math.floor(rng.next() * Math.max(1, terrain.length - 2));
        const base = terrain[idx];
        
        if (!base) continue;
        
        trees.push({
            x: base.x,
            y: base.y,
            size: 2 + 3 * rng.next(),
            fallen: false,
            angle: 0,
            targetAngle: 0,
            update() {
                if (this.fallen) this.angle += 0.1 * (this.targetAngle - this.angle);
            },
            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate(this.angle);
                const s = this.size;
                ctx.fillStyle = "rgba(101,67,33,1)";
                ctx.fillRect(-0.18 * s, 0, 0.36 * s, -2.2 * s);
                ctx.fillStyle = "rgba(34,139,34,0.9)";
                ctx.beginPath();
                ctx.moveTo(-0.9 * s, -1.6 * s);
                ctx.lineTo(0, -3.2 * s);
                ctx.lineTo(0.9 * s, -1.6 * s);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
        });
    }

    draw();
}

// Draw Terrain
function drawTerrain() {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, "#87CEEB");
    g.addColorStop(1, "#E0F6FF");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const tg = ctx.createLinearGradient(0, Math.min(...terrain.map(t => t.y)), 0, canvas.height);
    tg.addColorStop(0, "#7a6550");
    tg.addColorStop(1, "#5a4a3a");
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    for (let p of terrain) ctx.lineTo(p.x, p.y);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#5a4530";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(terrain[0].x, terrain[0].y);
    for (let p of terrain) ctx.lineTo(p.x, p.y);
    ctx.stroke();

    debrisPile.forEach(d => {
        ctx.fillStyle = d.color;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 0.6 * d.size, 0, 2 * Math.PI);
        ctx.fill();
        ctx.globalAlpha = 1;
    });
}

// Draw Scene
function draw() {
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvasOffsetX, canvasOffsetY);
    ctx.scale(canvasZoom, canvasZoom);

    drawTerrain();
    particles.forEach(p => p.draw());
    trees.forEach(t => t.draw());

    ctx.restore();
}

// Animation Loop
function animate() {
    const now = Date.now();
    const deltaTime = (now - lastFrameTime) / 1000;
    lastFrameTime = now;

    if (raining) {
        simulationTime += deltaTime;
    }

    let needsRedraw = false;

    if (raining) {
        const env = getEnv();
        const raindropsToSpawn = Math.floor(env.rain / 10);
        for (let i = 0; i < raindropsToSpawn; i++) {
            if (rng.next() > 0.75) raindrops.push(new Raindrop());
        }
        needsRedraw = true;
    }

    if (raindrops.length > 0) {
        raindrops = raindrops.filter(r => {
            const alive = r.update();
            return alive;
        });
        needsRedraw = true;
    }

    if (debris.length > 0) {
        debris = debris.filter(d => {
            d.update();
            return d.life > 0;
        });
        needsRedraw = true;
    }

    const hasMoving = particles.some(p => !p.stable && !p.fallen);
    if (hasMoving) {
        particles.forEach(p => p.update());
        trees.forEach(t => t.update());
        updateTerrain();
        needsRedraw = true;
    }

    if (needsRedraw) {
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.translate(canvasOffsetX, canvasOffsetY);
        ctx.scale(canvasZoom, canvasZoom);

        drawTerrain();
        raindrops.forEach(r => r.draw());
        debris.forEach(d => d.draw());
        particles.forEach(p => p.draw());
        trees.forEach(t => t.draw());

        ctx.restore();
    }

    // Update stats periodically
    if (needsRedraw || raining) {
        fallenParticles = particles.filter(p => p.fallen).length;
        document.getElementById("fallenCount").textContent = fallenParticles;
        updateRisk();
        drawTrendChart();
    }

    if (animating || raining || debris.length > 0 || hasMoving || raindrops.length > 0) {
        requestAnimationFrame(animate);
    } else {
        animating = false;
        if (!hasMoving && fallenParticles > 0) slidingActive = false;
    }
}

// Update Terrain
function updateTerrain() {
    if (slidingActive) {
        for (let i = 0; i < terrain.length; i++) {
            const diff = originalTerrain[i].y - terrain[i].y;
            if (Math.abs(diff) > 0.5) {
                terrain[i].y += diff * 0.05;
            }
        }
    }

    particles.forEach(p => {
        if (!p.fallen && p.stable) {
            const idxObj = terrain.reduce((acc, pt, idx) => {
                const d = Math.abs(pt.x - p.x);
                return d < acc.dist ? { idx, dist: d } : acc;
            }, { idx: 0, dist: Infinity });
            const i = idxObj.idx;
            const a = terrain[i];
            const b = terrain[i + 1] || a;
            let t = (p.x - a.x) / (b.x - a.x);
            if (!isFinite(t)) t = 0;
            const surfaceY = a.y + (b.y - a.y) * t;
            p.y = surfaceY - 0.5 * p.size;
        }
    });

    trees.forEach(tr => {
        const idxObj = terrain.reduce((acc, pt, idx) => {
            const d = Math.abs(pt.x - tr.x);
            return d < acc.dist ? { idx, dist: d } : acc;
        }, { idx: 0, dist: Infinity });
        const i = idxObj.idx;
        const a = terrain[i];
        const b = terrain[i + 1] || a;
        let t = (tr.x - a.x) / (b.x - a.x);
        if (!isFinite(t)) t = 0;
        const sy = a.y + (b.y - a.y) * t;
        tr.y = sy;
    });
}

// Draw Trend Chart
function drawTrendChart() {
    tctx.clearRect(0, 0, tCanvas.width, tCanvas.height);
    tctx.fillStyle = "#fafafa";
    tctx.fillRect(0, 0, tCanvas.width, tCanvas.height);

    const w = tCanvas.width, h = tCanvas.height;
    const leftPad = 45, rightPad = 15, topPad = 15, bottomPad = 25;
    const plotW = w - leftPad - rightPad;
    const plotH = h - topPad - bottomPad;
    const n = Math.max(1, fosHistory.length);
    const fosMin = 0;
    const fosMax = Math.max(3, Math.max(...(fosHistory.length ? fosHistory : [2])));
    const fosRange = fosMax - fosMin;
    const pofMin = 0;
    const pofMax = 100;
    const pofRange = pofMax - pofMin;

    tctx.strokeStyle = "#e5e7eb";
    tctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = topPad + (plotH / 5) * i;
        tctx.beginPath();
        tctx.moveTo(leftPad, y);
        tctx.lineTo(w - rightPad, y);
        tctx.stroke();
    }

    const fos1Y = topPad + plotH * (1 - (1 - fosMin) / fosRange);
    tctx.strokeStyle = "#10b981";
    tctx.lineWidth = 2;
    tctx.setLineDash([5, 5]);
    tctx.beginPath();
    tctx.moveTo(leftPad, fos1Y);
    tctx.lineTo(w - rightPad, fos1Y);
    tctx.stroke();
    tctx.setLineDash([]);

    if (fosHistory.length > 1) {
        tctx.beginPath();
        for (let i = 0; i < n; i++) {
            const x = leftPad + (i / (n - 1)) * plotW;
            const fosVal = Math.min(fosMax, Math.max(fosMin, fosHistory[i]));
            const y = topPad + plotH * (1 - (fosVal - fosMin) / fosRange);
            if (i === 0) tctx.moveTo(x, y);
            else tctx.lineTo(x, y);
        }
        tctx.strokeStyle = "#2563eb";
        tctx.lineWidth = 2.5;
        tctx.stroke();
    }

    if (pofHistory.length > 1) {
        tctx.beginPath();
        for (let i = 0; i < n; i++) {
            const x = leftPad + (i / (n - 1)) * plotW;
            const pofVal = Math.min(pofMax, Math.max(pofMin, pofHistory[i]));
            const y = topPad + plotH * (1 - (pofVal - pofMin) / pofRange);
            if (i === 0) tctx.moveTo(x, y);
            else tctx.lineTo(x, y);
        }
        tctx.strokeStyle = "#dc2626";
        tctx.lineWidth = 2.5;
        tctx.stroke();
    }

    tctx.fillStyle = "#475569";
    tctx.font = "bold 11px sans-serif";
    tctx.textAlign = "left";
    tctx.fillText(`FoS: 0-${fosMax.toFixed(0)}`, 8, 20);
    tctx.textAlign = "right";
    tctx.fillText("PoF: 0-100%", w - 8, 20);
    tctx.fillStyle = "#6b7280";
    tctx.font = "10px sans-serif";
    tctx.textAlign = "center";
    tctx.fillText("Time →", w / 2, h - 5);
}

// Canvas Zoom Functions
function zoomCanvas(direction) {
    const oldZoom = canvasZoom;
    canvasZoom += direction * 0.2;
    canvasZoom = Math.max(0.5, Math.min(3, canvasZoom));

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const zoomFactor = canvasZoom / oldZoom;

    canvasOffsetX = centerX - (centerX - canvasOffsetX) * zoomFactor;
    canvasOffsetY = centerY - (centerY - canvasOffsetY) * zoomFactor;

    document.getElementById('canvasZoomLevel').textContent = `Zoom: ${Math.round(canvasZoom * 100)}%`;
    draw();
}

function resetZoom() {
    canvasZoom = 1;
    canvasOffsetX = 0;
    canvasOffsetY = 0;
    document.getElementById('canvasZoomLevel').textContent = 'Zoom: 100%';
    draw();
}

// Canvas Drag Functionality
canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragStartX = e.clientX - canvasOffsetX;
    dragStartY = e.clientY - canvasOffsetY;
});

canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
        canvasOffsetX = e.clientX - dragStartX;
        canvasOffsetY = e.clientY - dragStartY;
        draw();
    }
});

canvas.addEventListener('mouseup', () => {
    isDragging = false;
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
});

// Canvas Wheel Zoom
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    zoomCanvas(direction);
});

// Trend Chart Tooltip
tCanvas.addEventListener('mousemove', ev => {
    const rect = tCanvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const leftPad = 45, rightPad = 15;
    const plotW = tCanvas.width - leftPad - rightPad;
    const idx = Math.round((x - leftPad) / plotW * (fosHistory.length - 1));

    if (idx >= 0 && idx < fosHistory.length) {
        tooltip.style.display = 'block';
        tooltip.style.left = (ev.clientX + 15) + 'px';
        tooltip.style.top = (ev.clientY + 15) + 'px';
        tooltip.innerHTML = `<strong>Sample #${idx + 1}</strong><br>FoS: <strong>${fosHistory[idx].toFixed(3)}</strong><br>PoF: <strong>${pofHistory[idx].toFixed(2)}%</strong>`;
    } else {
        tooltip.style.display = 'none';
    }
});

tCanvas.addEventListener('mouseleave', () => tooltip.style.display = 'none');

// Event Listeners - Environmental Controls
document.getElementById("vegetation").addEventListener('input', throttle(e => {
    document.getElementById("vegVal").textContent = e.target.value + "%";
    populateVegetationAndParticles();
    if (!animating && !slidingActive) {
        updateRisk();
        drawTrendChart();
    }
}, 100));

document.getElementById("erosion").addEventListener('input', e => {
    document.getElementById("erosionVal").textContent = e.target.value + "%";
    if (!animating && !slidingActive) {
        updateRisk();
        drawTrendChart();
    }
});

document.getElementById("soilMoisture").addEventListener('input', e => {
    document.getElementById("moistureVal").textContent = e.target.value + "%";
    if (!animating && !slidingActive) {
        updateRisk();
        drawTrendChart();
    }
});

document.getElementById("rainIntensity").addEventListener('input', e => {
    document.getElementById("rainVal").textContent = e.target.value + " mm/hr";
    if (!animating && !slidingActive) {
        updateRisk();
        drawTrendChart();
    }
});

document.getElementById("fosSigma").addEventListener('input', e => {
    document.getElementById("covVal").textContent = (100 * parseFloat(e.target.value)).toFixed(0) + "%";
    if (!animating && !slidingActive) {
        updateRisk();
        drawTrendChart();
    }
});

// Event Listeners - Geotechnical Parameters
["soilDepth", "unitWeight", "cohesionGeo", "phiGeo", "slopeAngle", "hydCond"].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        if (id === "slopeAngle") {
            generateTerrain();
        } else if (!animating && !slidingActive) {
            updateRisk();
            drawTrendChart();
        }
    });
});

// Event Listeners - Simulation Controls
document.getElementById("triggerBtn").addEventListener('click', () => startLandslide(false));
document.getElementById("rainBtn").addEventListener('click', () => toggleRain());
document.getElementById("resetBtn").addEventListener('click', () => resetSim());

// Formula Panel Functions
let formulaPanelOpen = false;
let panelZoom = 100;

function toggleFormulas() {
    formulaPanelOpen = !formulaPanelOpen;
    const panel = document.getElementById('formulaPanel');
    if (formulaPanelOpen) {
        panel.classList.add('open');
    } else {
        panel.classList.remove('open');
    }
}

function zoomPanel(direction) {
    panelZoom += direction * 10;
    panelZoom = Math.max(70, Math.min(130, panelZoom));
    document.getElementById('formulaContent').style.fontSize = panelZoom + '%';
    document.getElementById('zoomLevel').textContent = `Zoom: ${panelZoom}%`;
}

// Resize Handler
function resizeCanvases() {
    const parentWidth = canvas.parentElement.clientWidth - 24;
    canvas.width = Math.max(700, parentWidth);
    canvas.height = 450;
    tCanvas.width = Math.max(500, canvas.width - 80);
    tCanvas.height = 160;

    if (terrain.length > 0) {
        const oldWidth = terrain[terrain.length - 1].x;
        const newWidth = canvas.width;
        const scale = newWidth / oldWidth;

        terrain.forEach(t => t.x *= scale);
        originalTerrain.forEach(t => t.x *= scale);
        particles.forEach(p => {
            p.x *= scale;
            p.initialX *= scale;
        });
        trees.forEach(t => t.x *= scale);

        drawTrendChart();
        draw();
    }
}

window.addEventListener('resize', () => {
    clearTimeout(window._resizeTO);
    window._resizeTO = setTimeout(resizeCanvases, 200);
});

// Initialize
(function init() {
    resizeCanvases();
    generateTerrain();
})();