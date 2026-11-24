// 文件名：physics.js
// ==============================================================
// 🧵 布料物理解算器（XPBD · 唯一物理模块）
// --------------------------------------------------------------
// 前面两版都试过、都不用了：
//   * 位置投影 + 硬拉伸上限（旧 simulate）：拉一点就绷死，超限处还会被
//     「0.35 消能」把速度清零 → 穿模夹住、拖动发卡。
//   * 纯力驱动弹簧（physics-blender.js）：刚度和步长耦合，轻轻一抽
//     （位移被瞬间拉大 → 力 ∝ 应变 → 加速度爆掉）就崩。
//
// 这一版用 **XPBD**（Extended Position Based Dynamics，Müller 2020）：
//
//   1. 子步预测：v += a·h，x += v·h
//   2. 约束求解：C = |x_b − x_a| − rest，
//        Δλ = (−C − α̃·λ) / (w_a + w_b + α̃)，  α̃ = α / h²
//        x_a += w_a·Δλ·n，x_b −= w_b·Δλ·n
//   3. 速度回写：v = (x − x_prev) / h
//
//   为什么稳：约束是**位置投影**，单次修正量被 C 本身限死（还有限幅），
//   再怎么猛拽也只是"被拉过去"，不会像力驱动那样把能量灌进去炸开；
//   而刚度由**柔度 α**（m/N）控制，与步长 / 子步数 / 迭代数无关 ——
//   布料是弹性可伸的（自然），又不是橡皮筋。
//
// Blender 对应关系（默认值）：
//   重力 9.81 m/s²   → 重力滑块（0.1 → 15 单位/秒²）
//   Mass 0.3 kg      → 质点质量滑块 ×0.01（30 → 0.30 kg，布的总质量）
//   Air Damping 1.0  → 空气阻力滑块 ×18（0.055 → 1.0 kg/s）
//   Structural/Shear/Bending → 刚度 × shear / stiffX / stiffY / bend（柔度换算）
//   Quality Steps    → 约束迭代数滑块 = 子步数（默认 6）
//   终速 = 质量·重力 ÷ 空气阻力（所以重布掉得快、薄纱慢慢飘）
// ==============================================================

/** 渲染 / 求解相关的公开常量（script.js 会用到） */
export const PHYS = Object.freeze({
    MAX_RES: 40,             // 低配模式的网格分辨率上限
    MAX_HZ: 240,             // 物理更新率上限
    SHADOW_SIZE: 1024,       // 低配阴影贴图

    SUBSTEPS_MIN: 2,
    SUBSTEPS_MAX: 12,        // 约束迭代数滑块 → 子步数（上限）

    REF_ROWS: 24,            // 行数归一参考（保证加密网格不变软）
    COMPLIANCE_SCALE: 667,   // 柔度 α0 = 1/(刚度 × 667)，单位 1/N
    BEND_STIFF: 20,          // 弯曲刚度倍率（越大越挺）
    BEND_MIN_MUL: 0.05,

    AIR_SCALE: 18,           // 空气阻力滑块 → kg/s（Blender Air Damping）
    MASS_SCALE: 0.01,        // 质点质量滑块 → kg（60 → 0.6 kg）
    VEL_SCALE: 60,           // 最大速度滑块 → 单位/秒（0.2 → 12 u/s 的软上限）

    SLEEP_FRAMES: 60,        // 静止多少帧后休眠
    SLEEP_EPS2: 1e-9,        // 休眠位移阈值²（单帧 < 3e-5）
    ITER_PER_SUBSTEP: 1      // 每个子步的约束迭代遍数（XPBD 靠子步，不靠迭代）
});

// --------------------------------------------------------------
// 查表 sin / cos（风场湍流）
// --------------------------------------------------------------
const SIN_BITS = 10;
const SIN_SIZE = 1 << SIN_BITS;
const SIN_MASK = SIN_SIZE - 1;
const SIN_QUARTER = SIN_SIZE >> 2;
const SIN_SCALE = SIN_SIZE / (Math.PI * 2);
const SIN_LUT = new Float32Array(SIN_SIZE);
for (let i = 0; i < SIN_SIZE; i++) SIN_LUT[i] = Math.sin((i / SIN_SIZE) * Math.PI * 2);
const fastSin = (x) => SIN_LUT[((x * SIN_SCALE) | 0) & SIN_MASK];
const fastCos = (x) => SIN_LUT[(((x * SIN_SCALE) | 0) + SIN_QUARTER) & SIN_MASK];

const SPRING_H = 0, SPRING_V = 1, SPRING_SHEAR = 2;

const DEFAULT_PARAMS = {
    simMult: 1, stiffness: 0.45, stretchLimit: 1.5, damping: 0.055, mass: 25,
    gravity: 0.1, gravityAngle: 0, iterations: 6,
    wind: 0, windDir: 0, noiseAmp: 0.4, noiseRandom: 0.5, noiseSpeed: 1.6,
    windSpatialFreq: 4, windZ: 0,
    airDampingExp: 0.2, velocityRetention: 1, maxVelocity: 0.2,
    shear: 1, stiffX: 1, stiffY: 1, bend: 0.1, springDamp: 0,
    plasticity: false, plasticityRate: 0.05, plasticityThreshold: 1.05,
    plasticityRecovery: 0, plasticityMax: 3,
    groundEnabled: true, groundY: -1.5, groundFriction: 0.8,
    collision: false
};

export class ClothSolver {
    constructor(opts) {
        this.cloth = opts.cloth;
        this.host = opts.host;
        this.params = Object.assign({}, DEFAULT_PARAMS);

        this.asleep = false;
        this.sleepFrames = 0;
        this._wakeFlag = true;
        this._decorVersion = -1;
        this._restDirty = false;
        this._dtCache = 1 / 60;

        this.build();
    }

    // ==========================================================
    // 构建
    // ==========================================================
    build() {
        const c = this.cloth;
        const P = c.particles;
        const n = (this.n = P.length);

        this.x = new Float32Array(n);
        this.y = new Float32Array(n);
        this.z = new Float32Array(n);
        this.qx = new Float32Array(n);      // 子步起点（用于回写速度）
        this.qy = new Float32Array(n);
        this.qz = new Float32Array(n);
        this.vx = new Float32Array(n);
        this.vy = new Float32Array(n);
        this.vz = new Float32Array(n);
        this.ax = new Float32Array(n);      // 外力加速度
        this.ay = new Float32Array(n);
        this.az = new Float32Array(n);
        this.lx = new Float32Array(n);      // 上帧位置（休眠判定）
        this.ly = new Float32Array(n);
        this.lz = new Float32Array(n);
        this.iw = new Float32Array(n);
        this.pin = new Uint8Array(n);
        this.lock = new Uint8Array(n);
        this.extraG = new Float32Array(n);

        for (let i = 0; i < n; i++) {
            const p = P[i];
            this.x[i] = p.x; this.y[i] = p.y; this.z[i] = p.z;
            this.qx[i] = p.x; this.qy[i] = p.y; this.qz[i] = p.z;
            this.lx[i] = p.x; this.ly[i] = p.y; this.lz[i] = p.z;
            this.iw[i] = p.invMass;
            this.pin[i] = p.pinned ? 1 : 0;
        }

        const ss = c.springs;
        const m = (this.m = ss.length);
        this.si = new Int32Array(m);
        this.sj = new Int32Array(m);
        this.sRest = new Float32Array(m);
        this.sOrig = new Float32Array(m);
        this.sAlpha = new Float32Array(m);   // 柔度 α（m/N）
        this.sLambda = new Float32Array(m);
        this.sBroken = new Uint8Array(m);
        this.sMul = new Float32Array(m);
        this.sKind = new Uint8Array(m);
        for (let k = 0; k < m; k++) {
            const s = ss[k];
            this.si[k] = s.i;
            this.sj[k] = s.j;
            this.sRest[k] = s.restLength;
            this.sOrig[k] = s.originalRestLength || s.restLength;
            this.sKind[k] = s.type === 'shear' ? SPRING_SHEAR
                          : (s.axis === 'h' ? SPRING_H : SPRING_V);
        }

        const bs = c.bendSprings || [];
        const bm = (this.bm = bs.length);
        this.bi = new Int32Array(bm);
        this.bj = new Int32Array(bm);
        this.bRest = new Float32Array(bm);
        this.bAlpha = new Float32Array(bm);
        this.bLambda = new Float32Array(bm);
        this.bBroken = new Uint8Array(bm);
        for (let k = 0; k < bm; k++) {
            const s = bs[k];
            this.bi[k] = s.i;
            this.bj[k] = s.j;
            this.bRest[k] = s.restLength;
        }

        this.lockSet = new Set();
        this._lockBuf = [];
    }

    wake() {
        this.asleep = false;
        this.sleepFrames = 0;
        this._wakeFlag = true;
    }

    // ==========================================================
    // 数据搬运
    // ==========================================================
    sync() {
        const P = this.cloth.particles;
        const n = this.n;
        for (let i = 0; i < n; i++) {
            const p = P[i];
            this.x[i] = p.x; this.y[i] = p.y; this.z[i] = p.z;
            this.pin[i] = p.pinned ? 1 : 0;
        }
    }

    flush(dt) {
        const P = this.cloth.particles;
        const n = this.n;
        const inv = 1 / Math.max(1e-6, dt);
        for (let i = 0; i < n; i++) {
            const p = P[i];
            p.x = this.x[i]; p.y = this.y[i]; p.z = this.z[i];
            // 其它模块（拖拽 / 水渍 / 撕裂 / 速度场后处理）仍读 oldX，从速度回填
            p.oldX = this.x[i] - this.vx[i] * dt;
            p.oldY = this.y[i] - this.vy[i] * dt;
            p.oldZ = this.z[i] - this.vz[i] * dt;
        }
        if (this._restDirty) {
            const ss = this.cloth.springs;
            const sRest = this.sRest;
            for (let k = 0; k < this.m; k++) {
                if (ss[k].restLength !== sRest[k]) ss[k].restLength = sRest[k];
            }
            this._restDirty = false;
        }
    }

    refreshMeta(pl) {
        const ss = this.cloth.springs;
        const m = this.m;
        const alpha0 = 1 / (Math.max(0.01, pl.stiffness) * PHYS.COMPLIANCE_SCALE);   // 1/N
        const sRest = this.sRest, sBroken = this.sBroken, sAlpha = this.sAlpha, sKind = this.sKind;
        const shearK = Math.max(0.05, pl.shear);
        const sxK = Math.max(0.05, pl.stiffX);
        const syK = Math.max(0.05, pl.stiffY);
        for (let k = 0; k < m; k++) {
            const s = ss[k];
            sBroken[k] = s.broken ? 1 : 0;
            sRest[k] = s.restLength;
            const kind = sKind[k];
            const mul = kind === SPRING_SHEAR ? shearK : (kind === SPRING_H ? sxK : syK);
            // α ∝ rest：保证网格加密后应变不变（ε = α0·张力）
            sAlpha[k] = alpha0 * s.restLength / mul;
        }
        const bs = this.cloth.bendSprings;
        if (bs && this.bm) {
            const bBroken = this.bBroken, bRest = this.bRest, bAlpha = this.bAlpha;
            const bendMul = Math.max(PHYS.BEND_MIN_MUL, pl.bend * PHYS.BEND_STIFF);
            for (let k = 0; k < this.bm; k++) {
                bBroken[k] = bs[k].broken ? 1 : 0;
                bRest[k] = bs[k].restLength;
                bAlpha[k] = alpha0 * bs[k].restLength / bendMul;
            }
        }
    }

    refreshDecorGravity(decorations) {
        const g = this.extraG;
        g.fill(0);
        const n = this.n;
        for (let d = 0; d < decorations.length; d++) {
            const item = decorations[d];
            const idx = item.particleIndex;
            if (idx >= 0 && idx < n) {
                let extra = 0;
                if (item.weight === 'heavy') extra = 2.5;
                else if (item.weight === 'medium') extra = 1.0;
                else if (item.weight === 'light') extra = -0.2;
                g[idx] += extra;
            }
        }
    }

    // ==========================================================
    // 主循环
    // ==========================================================
    simulate(dt) {
        const c = this.cloth;
        const host = this.host;
        const n = this.n;
        if (!c || n === 0) return;
        this._dtCache = dt;

        const pl = host.getParams(this.params);

        // ---------- 休眠 ----------
        if (this.asleep) {
            const decorNow = host.decorVersion ? host.decorVersion() : 0;
            const canWake = this._wakeFlag || host.hasLocks() ||
                            pl.wind > 0.001 || pl.plasticity ||
                            decorNow !== this._decorVersion;
            if (!canWake) return;
            this.wake();
        }
        this._wakeFlag = false;

        // ---------- 锁定点 ----------
        const lock = this.lock;
        lock.fill(0);
        this.lockSet.clear();
        const locked = host.getLocks();
        let lockCount = 0;
        for (let k = 0; k < locked.length; k++) {
            const idx = locked[k];
            if (idx >= 0 && idx < n && lock[idx] === 0) {
                lock[idx] = 1;
                this.lockSet.add(idx);
                lockCount++;
            }
        }

        this.sync();
        this.refreshMeta(pl);
        this.refreshDecorGravity(host.getDecorations ? host.getDecorations() : []);

        // ---------- 参数换算 ----------
        let substeps = pl.iterations | 0;
        if (substeps < PHYS.SUBSTEPS_MIN) substeps = PHYS.SUBSTEPS_MIN;
        if (substeps > PHYS.SUBSTEPS_MAX) substeps = PHYS.SUBSTEPS_MAX;
        const simMult = pl.simMult > 0 ? pl.simMult : 1;
        const h = (dt * simMult) / substeps;
        const h2 = h * h;

        // 质量：滑块 ×0.01 = 布料总质量(kg)，再平摊到每个质点
        const massKg = Math.max(0.005, pl.mass * PHYS.MASS_SCALE);
        const massRatio = Math.max(0.05, massKg / 0.3);
        const wPar = n / massKg;                     // 每个质点的逆质量 (1/kg)

        // 空气阻力：滑块 ×18 = kg/s；每质点分到的阻力 ∝ 1/n
        // → 阻尼率 = 空气阻力 / 总质量，终速 = 总质量·重力 / 空气阻力（与网格密度无关）
        const airDamping = Math.max(0, pl.damping * PHYS.AIR_SCALE)
                          * Math.pow(massRatio, pl.airDampingExp);
        const dragRate = airDamping / massKg;         // 1/s
        const velRet = Math.max(0, Math.min(1, pl.velocityRetention));
        const maxVel = Math.max(0.5, pl.maxVelocity * PHYS.VEL_SCALE);

        const gAccel = pl.gravity * 150;
        const gAng = pl.gravityAngle * Math.PI / 180;
        const gX = gAccel * Math.sin(gAng);
        const gY = -gAccel * Math.cos(gAng);

        const windAng = pl.windDir * Math.PI / 180;
        const baseWindX = Math.cos(windAng);
        const baseWindY = Math.sin(windAng);
        const windAccel = pl.wind * 105 * Math.pow(massRatio, -0.5);
        const tWind = performance.now() * 0.001 * pl.noiseSpeed;
        const spatialFreq = pl.windSpatialFreq;
        const windZComp = pl.windZ;
        const noiseAmp = pl.noiseAmp;
        const noiseRandom = pl.noiseRandom;

        const springDamp = Math.max(0, pl.springDamp) * 100;   // 1/s（内部摩擦）
        const plasticOn = !!pl.plasticity;
        const plasticRate = pl.plasticityRate;
        const plasticThreshold = Math.max(1.0, pl.plasticityThreshold);
        const plasticRecovery = pl.plasticityRecovery;
        const plasticMax = pl.plasticityMax;
        const epsMax = Math.max(0.01, (pl.stretchLimit || 1.5) - 1);   // 弹性上限（防面条）

        const groundOn = !!pl.groundEnabled;
        const groundY = pl.groundY;
        const groundFric = Math.max(0, Math.min(1, pl.groundFriction));

        const x = this.x, y = this.y, z = this.z;
        const qx = this.qx, qy = this.qy, qz = this.qz;
        const vx = this.vx, vy = this.vy, vz = this.vz;
        const ax = this.ax, ay = this.ay, az = this.az;
        const si = this.si, sj = this.sj, sRest = this.sRest, sBroken = this.sBroken;
        const sAlpha = this.sAlpha, sLambda = this.sLambda;
        const bi = this.bi, bj = this.bj, bRest = this.bRest, bBroken = this.bBroken;
        const bAlpha = this.bAlpha, bLambda = this.bLambda;
        const m = this.m, bm = this.bm;
        const maxCorr = Math.max(1e-4, (c.baseRestLength || 0.04) * 1.5);

        // ---------- 子步 ----------
        for (let step = 0; step < substeps; step++) {

            // ===== 1. 外力 + 预测 =====
            for (let i = 0; i < n; i++) {
                qx[i] = x[i]; qy[i] = y[i]; qz[i] = z[i];
                if (this.pin[i] || lock[i]) { vx[i] = 0; vy[i] = 0; vz[i] = 0; continue; }

                let gx = gX, gy = gY - this.extraG[i], gz = 0;
                if (windAccel !== 0) {
                    const nx = x[i] * spatialFreq + tWind;
                    const ny = y[i] * spatialFreq + tWind * 1.2;
                    const nz = z[i] * spatialFreq + tWind * 0.8;
                    const tx = fastSin(nx) * fastCos(ny) + fastSin(nz * 1.3) * fastCos(nx * 0.9);
                    const ty = fastSin(ny) * fastCos(nz) + fastSin(nx * 1.1) * fastCos(ny * 0.8);
                    const tz = fastSin(nz) * fastCos(nx) + fastSin(ny * 1.4) * fastCos(nz * 1.1);
                    const sc = windAccel * noiseAmp;
                    gx += (baseWindX + tx * noiseRandom) * sc;
                    gy += (baseWindY + ty * noiseRandom) * sc;
                    gz += (windZComp + tz * noiseRandom) * sc;
                }
                ax[i] = gx; ay[i] = gy; az[i] = gz;

                // 半隐式欧拉 + 隐式空气阻力（稳定，且与步长无关）
                let nvx = vx[i] + gx * h;
                let nvy = vy[i] + gy * h;
                let nvz = vz[i] + gz * h;
                const dmp = 1 / (1 + dragRate * h);
                nvx *= dmp; nvy *= dmp; nvz *= dmp;
                if (velRet < 1) { nvx *= velRet; nvy *= velRet; nvz *= velRet; }
                const sp2 = nvx * nvx + nvy * nvy + nvz * nvz;
                if (sp2 > maxVel * maxVel) {
                    const sc = maxVel / Math.sqrt(sp2);
                    nvx *= sc; nvy *= sc; nvz *= sc;
                }
                vx[i] = nvx; vy[i] = nvy; vz[i] = nvz;
                x[i] += nvx * h; y[i] += nvy * h; z[i] += nvz * h;
            }

            // ===== 2. 结构 / 剪切约束（XPBD）=====
            for (let k = 0; k < m; k++) sLambda[k] = 0;
            for (let it = 0; it < PHYS.ITER_PER_SUBSTEP; it++) {
                for (let k = 0; k < m; k++) {
                    if (sBroken[k]) continue;
                    const a = si[k], b = sj[k];
                    const wa = (this.pin[a] | lock[a]) ? 0 : wPar;
                    const wb = (this.pin[b] | lock[b]) ? 0 : wPar;
                    const wsum = wa + wb;
                    if (wsum === 0) continue;

                    const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
                    const d2 = dx * dx + dy * dy + dz * dz;
                    if (d2 < 1e-18) continue;
                    const d = Math.sqrt(d2);
                    let rest = sRest[k];

                    // ---- 塑性：超阈值就把静止长度永久拉长 ----
                    if (plasticOn) {
                        if (d > rest * plasticThreshold) {
                            let nr = rest + (d - rest * plasticThreshold) * plasticRate;
                            const cap = this.sOrig[k] * plasticMax;
                            if (nr > cap) nr = cap;
                            sRest[k] = nr; rest = nr; this._restDirty = true;
                        } else if (plasticRecovery > 0 && rest > this.sOrig[k]) {
                            let nr = rest - (rest - this.sOrig[k]) * plasticRecovery;
                            if (nr < this.sOrig[k]) nr = this.sOrig[k];
                            sRest[k] = nr; rest = nr; this._restDirty = true;
                        }
                    }

                    // 「最大拉伸」= 弹性上限：上限内按柔度弹性伸长，
                    // 超过上限就当成刚性约束（α̃=0，全额投影），不会拉成面条
                    let C = d - rest;
                    const maxStretch = rest * epsMax;
                    if (C > maxStretch) C = maxStretch;
                    if (C < -rest * 0.9) C = -rest * 0.9;
                    const beyond = d - rest > maxStretch;

                    const alphaTilde = beyond ? 0 : sAlpha[k] / h2;
                    const dLambda = (-C - alphaTilde * sLambda[k]) / (wsum + alphaTilde);
                    sLambda[k] += dLambda;

                    // 相对修正量：rel = −(w_a+w_b)·Δλ。拉伸时 Δλ<0 ⇒ rel>0，
                    // 方向沿 n（a→b）：a 被拉向 b、b 被拉向 a。
                    // （符号搞反就会把布往外推 → 一拉就崩，这里务必保持负号）
                    const inv = 1 / d;
                    let rel = -dLambda * wsum;
                    const relAbs = Math.abs(rel);
                    if (relAbs > maxCorr) rel *= maxCorr / relAbs;

                    const cx = dx * inv * rel, cy = dy * inv * rel, cz = dz * inv * rel;
                    const ka = wa / wsum, kb = wb / wsum;
                    x[a] += cx * ka; y[a] += cy * ka; z[a] += cz * ka;
                    x[b] -= cx * kb; y[b] -= cy * kb; z[b] -= cz * kb;
                }

                // ===== 3. 弯曲约束 =====
                if (bm) {
                    for (let k = 0; k < bm; k++) {
                        if (bBroken[k]) continue;
                        const a = bi[k], b = bj[k];
                        const wa = (this.pin[a] | lock[a]) ? 0 : wPar;
                        const wb = (this.pin[b] | lock[b]) ? 0 : wPar;
                        const wsum = wa + wb;
                        if (wsum === 0) continue;

                        const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
                        const d2 = dx * dx + dy * dy + dz * dz;
                        if (d2 < 1e-18) continue;
                        const d = Math.sqrt(d2);
                        const rest = bRest[k];

                        let C = d - rest;
                        const bMax = rest * epsMax;
                        if (C > bMax) C = bMax;
                        if (C < -rest * 0.9) C = -rest * 0.9;
                        const bBeyond = d - rest > bMax;

                        const alphaTilde = bBeyond ? 0 : bAlpha[k] / h2;
                        const dLambda = (-C - alphaTilde * bLambda[k]) / (wsum + alphaTilde);
                        bLambda[k] += dLambda;

                        const inv = 1 / d;
                        let rel = -dLambda * wsum;      // 同上：负号不能丢
                        const relAbs = Math.abs(rel);
                        if (relAbs > maxCorr) rel *= maxCorr / relAbs;

                        const cx = dx * inv * rel, cy = dy * inv * rel, cz = dz * inv * rel;
                        const ka = wa / wsum, kb = wb / wsum;
                        x[a] += cx * ka; y[a] += cy * ka; z[a] += cz * ka;
                        x[b] -= cx * kb; y[b] -= cy * kb; z[b] -= cz * kb;
                    }
                }
            }

            // ===== 4. 回写速度 v = (x − x_prev)/h =====
            for (let i = 0; i < n; i++) {
                if (this.pin[i] || lock[i]) { vx[i] = 0; vy[i] = 0; vz[i] = 0; continue; }
                let nvx = (x[i] - qx[i]) / h;
                let nvy = (y[i] - qy[i]) / h;
                let nvz = (z[i] - qz[i]) / h;
                // 安全上限：约束修正也会注入速度，极端拖拽（一帧拽很远）时
                // 不让它变成"弹弓"，这也是"轻轻一抽就崩"的最后一道保险
                const sp2 = nvx * nvx + nvy * nvy + nvz * nvz;
                if (sp2 > maxVel * maxVel) {
                    const sc = maxVel / Math.sqrt(sp2);
                    nvx *= sc; nvy *= sc; nvz *= sc;
                }
                vx[i] = nvx; vy[i] = nvy; vz[i] = nvz;
            }

            // ===== 5. 内部摩擦：沿弹簧方向吃掉一部分相对速度 =====
            // （织物纤维之间的阻尼；不影响整块布的自由落体与整体摆动）
            if (springDamp > 0) {
                const f = Math.min(0.5, springDamp * h);
                for (let k = 0; k < m; k++) {
                    if (sBroken[k]) continue;
                    const a = si[k], b = sj[k];
                    const pinA = this.pin[a] | lock[a], pinB = this.pin[b] | lock[b];
                    if (pinA && pinB) continue;
                    const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
                    const d2 = dx * dx + dy * dy + dz * dz;
                    if (d2 < 1e-18) continue;
                    const rvx = vx[b] - vx[a], rvy = vy[b] - vy[a], rvz = vz[b] - vz[a];
                    const rvn = (rvx * dx + rvy * dy + rvz * dz) / d2;
                    const jx = dx * rvn * f, jy = dy * rvn * f, jz = dz * rvn * f;
                    if (!pinA) { vx[a] += jx; vy[a] += jy; vz[a] += jz; }
                    if (!pinB) { vx[b] -= jx; vy[b] -= jy; vz[b] -= jz; }
                }
            }

            // ===== 6. 地面 =====
            if (groundOn) {
                for (let i = 0; i < n; i++) {
                    if (this.pin[i] || lock[i]) continue;
                    if (y[i] < groundY) {
                        y[i] = groundY;
                        if (vy[i] < 0) vy[i] = -vy[i] * 0.2;          // 落地轻微回弹
                        vx[i] *= 1 - groundFric;
                        vz[i] *= 1 - groundFric;
                    }
                }
            }

            // ===== 7. 自碰撞（可选，交给宿主跑经典实现）=====
            if (pl.collision && host.solveCollision && step === substeps - 1) {
                this.flush(dt);
                host.solveCollision(c, this.lockSet);
                this.sync();
                // 自碰撞是用 old 位置做摩擦的，这里把速度读回来
                const P = c.particles;
                const iv = 1 / Math.max(1e-6, dt);
                for (let i = 0; i < n; i++) {
                    if (this.pin[i] || lock[i]) continue;
                    this.vx[i] = (this.x[i] - P[i].oldX) * iv;
                    this.vy[i] = (this.y[i] - P[i].oldY) * iv;
                    this.vz[i] = (this.z[i] - P[i].oldZ) * iv;
                }
            }
        }

        // ---------- 写回 + 几何 ----------
        this.flush(dt);
        if (host.afterSolve) host.afterSolve(c);

        // ---------- 休眠 ----------
        let maxMove2 = 0;
        const lx = this.lx, ly = this.ly, lz = this.lz;
        for (let i = 0; i < n; i++) {
            const ddx = x[i] - lx[i], ddy = y[i] - ly[i], ddz = z[i] - lz[i];
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 > maxMove2) maxMove2 = d2;
            lx[i] = x[i]; ly[i] = y[i]; lz[i] = z[i];
        }
        const still = pl.wind <= 0.001 && !plasticOn && lockCount === 0 && !pl.collision;
        if (still && maxMove2 < PHYS.SLEEP_EPS2) {
            this.sleepFrames++;
            if (this.sleepFrames >= PHYS.SLEEP_FRAMES) {
                this.asleep = true;
                this._decorVersion = host.decorVersion ? host.decorVersion() : 0;
            }
        } else {
            this.sleepFrames = 0;
        }
    }
}
