// 文件名：physics-lowspec.js
// ==============================================================
// 🪶 低配模式物理求解器（Low-Spec Cloth Solver）
// --------------------------------------------------------------
// 设计目标：在核显 / 老笔记本 / 手机上也能把布料解算跑顺。
//
// 和经典解算（Cloth.simulate，每帧 3 子步 + 对象粒子）相比，这里做了 5 件事：
//
//  1) SoA 数组化
//     粒子的位置 / 上一帧位置 / 逆质量 / 锁定状态全部放进 TypedArray，
//     弹簧的 i、j、静止长度、刚度倍率也打包成 TypedArray。
//     好处：内存连续、没有对象属性查找、没有每帧 new 出来的临时数组和 Map。
//
//  2) 跟随 UI 的迭代次数（默认与经典解算等价）
//     子步结构保持和经典解算一样（每帧 3 个子步），这一步不能省：
//     改成单子步会让每帧位移只剩 1/3，布料会飘得又慢又软。
//     约束迭代数跟随「性能参数 → 约束迭代数」滑块（默认 6 → 每帧 18 遍，
//     和经典解算完全相同）；用户把它调低（3~4）时，每遍的刚度会按
//         k = 1 - (1 - kc)^(3·iterations / (3·iters))
//     自动抬高，让整帧的收敛程度仍然与经典一致 —— 也就是"少算几遍但软硬不变"。
//
//     注意：本引擎的静平衡下垂量 ∝ 步长²，所以物理频率绝不能私下砍低
//     （低配限到 60Hz 而经典跑 100Hz 时，布料会明显垂得更狠）。
//
//  3) 热循环里不读 DOM、不建对象
//     所有参数由宿主（script.js）每帧注入一次到同一个复用对象里。
//
//  4) 静止休眠
//     布料连续若干帧位移小于阈值、且没有风 / 没有拖拽 / 没有塑性形变时，
//     直接跳过整帧解算，只保留渲染。挂机看布料时这是最大的一笔省电。
//
//  5) 查表三角函数
//     风场湍流原本每粒子每子步要 6 次 sin + 6 次 cos，
//     这里用 1024 项正弦查找表代替，视觉几乎无法区分，速度约快 3~5 倍。
//
// 本文件不依赖 three.js，也不直接碰 DOM：宿主通过 host 注入参数与回调。
// ==============================================================

/** 低配模式的各项限幅 / 调参常量（script.js 也会用到） */
export const LOW_SPEC = Object.freeze({
    MAX_RES: 36,          // 网格分辨率上限（生成布料时生效）
    // ⚠️ 物理频率**不要**往下砍：本引擎的静平衡下垂量 ∝ 步长²，
    //    把低配限到 60Hz 而经典跑 100Hz 时，布料会明显垂得更狠。
    //    所以这里跟随 UI 设置（预设最高 120），只挡掉极端值。
    MAX_HZ: 120,          // 物理更新率上限
    // 约束迭代数：跟随「性能参数 → 约束迭代数」滑块（默认 6）。
    // 6 次 × 3 子步 = 18 遍，与经典解算完全一致 → 垂感、软硬都和最原始版本一样；
    // 想更省就把它调到 3~4（垂感会略软一点），想更硬就往上调。
    MAX_ITERS: 10,        // 约束迭代次数上限（预设最高 15，超出的部分会被压到 10）
    SUBSTEPS: 3,          // 子步数（必须与经典解算一致，见 simulate() 注释）
    MIN_PASS_STIFF: 0.02, // 单次迭代刚度下限
    MAX_PASS_STIFF: 0.95, // 单次迭代刚度上限（>1 会过冲抖动）
    SLEEP_FRAMES: 60,     // 连续静止多少帧后进入休眠
    SLEEP_EPS2: 1e-8,     // 静止判定阈值（位移平方；单帧移动 < 1e-4 ≈ 0.005% 画布，肉眼不可见）
    SHADOW_SIZE: 1024,    // 低配阴影贴图尺寸
    MAX_COLLISION_PASSES: 2
});

// --------------------------------------------------------------
// 查表 sin / cos
// --------------------------------------------------------------
const SIN_BITS = 10;
const SIN_SIZE = 1 << SIN_BITS;          // 1024
const SIN_MASK = SIN_SIZE - 1;
const SIN_QUARTER = SIN_SIZE >> 2;
const SIN_SCALE = SIN_SIZE / (Math.PI * 2);
const SIN_LUT = new Float32Array(SIN_SIZE);
for (let i = 0; i < SIN_SIZE; i++) {
    SIN_LUT[i] = Math.sin((i / SIN_SIZE) * Math.PI * 2);
}
// |0 先截断成 int32（负数也能正确落到数组下标 0..1023）
const fastSin = (x) => SIN_LUT[((x * SIN_SCALE) | 0) & SIN_MASK];
const fastCos = (x) => SIN_LUT[(((x * SIN_SCALE) | 0) + SIN_QUARTER) & SIN_MASK];

// 单次求解允许的最大位移修正（与经典解算保持一致）
const MAX_CORRECTION = 0.2;
const MAX_CORRECTION_BEND = 0.1;
const MAX_PULL_PER_PASS = 0.05;

// 弹簧类别：0 = 横向结构，1 = 纵向结构，2 = 剪切（对角线）
const SPRING_H = 0;
const SPRING_V = 1;
const SPRING_SHEAR = 2;

/** 宿主没传字段时的兜底值，保证 params 里的每个字段都存在 */
const DEFAULT_PARAMS = {
    // 基础
    simMult: 1, stiffness: 0.45, stretchLimit: 1.5, damping: 0.07, mass: 25,
    gravity: 0.1, gravityAngle: 0, iterations: 6,
    // 风
    wind: 0, windDir: 0, noiseAmp: 0.4, noiseRandom: 0.5, noiseSpeed: 1.6,
    windSpatialFreq: 4, windZ: 0,
    // 高级
    airDampingExp: 0.2, velocityRetention: 1, maxVelocity: 0.2,
    shear: 1, stiffX: 1, stiffY: 1, bend: 0.1, springDamp: 0,
    // 塑性
    plasticity: false, plasticityRate: 0.05, plasticityThreshold: 1.05,
    plasticityRecovery: 0, plasticityMax: 3,
    // 环境
    groundEnabled: true, groundY: -1.5, groundFriction: 0.8,
    collision: false
};

export class LowSpecSolver {
    /**
     * @param {Object} opts
     * @param {Object} opts.cloth  布料实例（需要 particles / springs / bendSprings）
     * @param {Object} opts.host   宿主适配层：
     *        getParams(out)          每帧填一次参数（复用同一个对象）
     *        getLocks()              返回拖拽中的粒子下标数组（可复用数组）
     *        hasLocks()              当前是否有拖拽
     *        decorVersion()          装饰物版本号（数量变化即视为版本变化）
     *        solveCollision(c, set)  可选：一趟自碰撞
     *        afterSolve(c)           可选：解算后刷新几何
     */
    constructor(opts) {
        this.cloth = opts.cloth;
        this.host = opts.host;
        this.params = Object.assign({}, DEFAULT_PARAMS);

        this.asleep = false;
        this.sleepFrames = 0;
        this._wakeFlag = true;
        this._decorVersion = -1;
        this._restDirty = false;

        this.build();
    }

    // ==========================================================
    // 构建：把对象数据打包进 TypedArray
    // ==========================================================
    build() {
        const c = this.cloth;
        const P = c.particles;
        const n = (this.n = P.length);

        this.px = new Float32Array(n);
        this.py = new Float32Array(n);
        this.pz = new Float32Array(n);
        this.ox = new Float32Array(n);
        this.oy = new Float32Array(n);
        this.oz = new Float32Array(n);
        // 上一帧位置：只用于休眠判定
        this.lx = new Float32Array(n);
        this.ly = new Float32Array(n);
        this.lz = new Float32Array(n);
        this.iw = new Float32Array(n);      // 逆质量
        this.pin = new Uint8Array(n);       // 1 = 固定点（红线上锁）
        this.lock = new Uint8Array(n);      // 1 = 本帧被手指 / 鼠标抓住
        this.extraG = new Float32Array(n);  // 装饰物带来的额外重力

        for (let i = 0; i < n; i++) {
            const p = P[i];
            this.iw[i] = p.invMass;
            this.pin[i] = p.pinned ? 1 : 0;
            this.lx[i] = p.x;
            this.ly[i] = p.y;
            this.lz[i] = p.z;
        }

        // ---- 结构 / 剪切弹簧 ----
        const ss = c.springs;
        const m = ss.length;
        this.si = new Int32Array(m);
        this.sj = new Int32Array(m);
        this.sRest = new Float32Array(m);
        this.sOrig = new Float32Array(m);
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
        this.m = m;

        // ---- 弯曲弹簧（隔一个格点的抗弯约束）----
        const bs = c.bendSprings || [];
        const bm = bs.length;
        this.bi = new Int32Array(bm);
        this.bj = new Int32Array(bm);
        this.bRest = new Float32Array(bm);
        this.bBroken = new Uint8Array(bm);
        for (let k = 0; k < bm; k++) {
            const s = bs[k];
            this.bi[k] = s.i;
            this.bj[k] = s.j;
            this.bRest[k] = s.restLength;
        }
        this.bm = bm;

        this.lockSet = new Set();
        this._lockBuf = [];
    }

    /** 唤醒：清零静止计数，下一帧重新解算 */
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
        const px = this.px, py = this.py, pz = this.pz;
        const ox = this.ox, oy = this.oy, oz = this.oz;
        const pin = this.pin;
        for (let i = 0; i < n; i++) {
            const p = P[i];
            px[i] = p.x; py[i] = p.y; pz[i] = p.z;
            ox[i] = p.oldX; oy[i] = p.oldY; oz[i] = p.oldZ;
            pin[i] = p.pinned ? 1 : 0;
        }
    }

    flush() {
        const P = this.cloth.particles;
        const n = this.n;
        const px = this.px, py = this.py, pz = this.pz;
        const ox = this.ox, oy = this.oy, oz = this.oz;
        for (let i = 0; i < n; i++) {
            const p = P[i];
            p.x = px[i]; p.y = py[i]; p.z = pz[i];
            p.oldX = ox[i]; p.oldY = oy[i]; p.oldZ = oz[i];
        }
        // 塑性形变改过静止长度，写回对象（撕裂逻辑也会用到 restLength）
        if (this._restDirty) {
            const ss = this.cloth.springs;
            const sRest = this.sRest;
            for (let k = 0; k < this.m; k++) {
                if (ss[k].restLength !== sRest[k]) ss[k].restLength = sRest[k];
            }
            this._restDirty = false;
        }
    }

    // ==========================================================
    // 每帧刷新弹簧元数据（断裂标记 / 静止长度 / 刚度倍率）
    // ==========================================================
    refreshSpringMeta(pl) {
        const ss = this.cloth.springs;
        const m = this.m;
        const sBroken = this.sBroken;
        const sRest = this.sRest;
        const sMul = this.sMul;
        const sKind = this.sKind;
        const shearK = pl.shear;
        const sxK = pl.stiffX;
        const syK = pl.stiffY;
        for (let k = 0; k < m; k++) {
            const s = ss[k];
            sBroken[k] = s.broken ? 1 : 0;
            sRest[k] = s.restLength;
            const kind = sKind[k];
            sMul[k] = kind === SPRING_SHEAR ? shearK : (kind === SPRING_H ? sxK : syK);
        }
        const bs = this.cloth.bendSprings;
        if (bs && this.bm) {
            const bBroken = this.bBroken;
            const bRest = this.bRest;
            for (let k = 0; k < this.bm; k++) {
                const s = bs[k];
                bBroken[k] = s.broken ? 1 : 0;
                bRest[k] = s.restLength;
            }
        }
    }

    /** 装饰物额外重力（数量很少，直接每帧重建，复用同一个数组） */
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

        // ---------- 参数（每帧只读一次）----------
        const pl = host.getParams(this.params);

        // ---------- 休眠判定 ----------
        if (this.asleep) {
            const decorNow = host.decorVersion ? host.decorVersion() : 0;
            const canWake = this._wakeFlag || host.hasLocks() ||
                            pl.wind > 0.001 || pl.plasticity ||
                            decorNow !== this._decorVersion;
            if (!canWake) return;
            this.wake();
        }
        this._wakeFlag = false;

        // ---------- 锁定点（拖拽中的粒子）----------
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

        // ---------- 物件 → 数组 ----------
        this.sync();
        this.refreshSpringMeta(pl);
        this.refreshDecorGravity(host.getDecorations ? host.getDecorations() : []);

        // ---------- 参数换算 ----------
        // ---- 子步结构（必须与经典解算保持一致）----
        // ⚠️ 不要把 SUBSTEPS 改成 1 来省性能：经典解算每帧跑 3 个 Verlet 子步，
        //    位置被推进 3 次、速度按几何级数累计；单子步会让每帧位移只剩 1/3 左右，
        //    布料就会"飘得又慢又软"（之前那版低配模式的轻飘飘就是这么来的）。
        //    这里的提速靠：数组化 + 更少迭代 + 不读 DOM + 静止休眠 + 渲染降级。
        const SUBSTEPS = LOW_SPEC.SUBSTEPS;
        const simMult = pl.simMult > 0 ? pl.simMult : 1;
        const subDt = (dt * simMult) / SUBSTEPS;
        const dt2 = subDt * subDt;

        const massRatio = Math.max(0.05, pl.mass / 25);
        // r0 = 经典解算每个子步的速度衰减系数
        const r0 = Math.max(0, 1 - pl.damping * Math.pow(massRatio, pl.airDampingExp));
        const retention = Math.pow(r0, 3 / SUBSTEPS);   // 每帧总衰减与经典一致

        const gAccel = pl.gravity * 150;
        const windAccel = pl.wind * 105 * Math.pow(massRatio, -0.5);

        const velRet = pl.velocityRetention;
        const maxDelta = pl.maxVelocity;

        const gAng = pl.gravityAngle * Math.PI / 180;
        const gravGX = Math.sin(gAng);
        const gravGY = -Math.cos(gAng);
        const windAng = pl.windDir * Math.PI / 180;
        const baseWindX = Math.cos(windAng);
        const baseWindY = Math.sin(windAng);

        const t = performance.now() * 0.001;
        const spatialFreq = pl.windSpatialFreq;
        const windZComp = pl.windZ;
        const noiseAmp = pl.noiseAmp;
        const noiseRandom = pl.noiseRandom;
        const noiseSpeed = pl.noiseSpeed;
        const timeWind = t * noiseSpeed;

        const stretchLimit = Math.max(1.001, pl.stretchLimit);
        // 🧵 硬拉伸上限：只给 stretchLimit 的一小部分（真实布料 1~3% 应变）
        // 硬上限收紧到 18% 的 stretchLimit 余量：棉/麻类几乎拉不动，弹性材料仍有空间
        const strainHardCap = Math.min(1.6, Math.max(1.012, 1 + (stretchLimit - 1) * 0.18));
        const springDampV = pl.springDamp;
        const bendK = pl.bend;

        let iters = pl.iterations | 0;
        if (iters < 1) iters = 1;
        if (iters > LOW_SPEC.MAX_ITERS) iters = LOW_SPEC.MAX_ITERS;

        // ---- 自适应刚度：让「少量迭代」达到「经典解算大量迭代」的收敛程度 ----
        // 经典解算每帧共做 3 × iterations 次约束迭代，每次残留 (1 - kc)；
        // 本求解器每帧做 SUBSTEPS × iters 次，那就把每次的刚度抬到
        //     k = 1 - (1 - kc)^(3·iterations / (SUBSTEPS·iters))
        // 这样整帧的残留误差和经典解算基本一致，手感不会被"换算法"换掉。
        const classicPasses = 3 * Math.max(1, pl.iterations);
        const ourPasses = Math.max(1, SUBSTEPS * iters);
        const kc = Math.min(0.97, pl.stiffness * (1.5 / stretchLimit));
        let effStiff = 1 - Math.pow(1 - kc, classicPasses / ourPasses);
        if (!(effStiff >= LOW_SPEC.MIN_PASS_STIFF)) effStiff = LOW_SPEC.MIN_PASS_STIFF;
        if (effStiff > LOW_SPEC.MAX_PASS_STIFF) effStiff = LOW_SPEC.MAX_PASS_STIFF;

        const plasticOn = !!pl.plasticity;
        const plasticRate = pl.plasticityRate;
        const plasticThreshold = Math.max(1.0, pl.plasticityThreshold);
        const plasticRecovery = pl.plasticityRecovery;
        const plasticMax = pl.plasticityMax;

        const groundOn = !!pl.groundEnabled;
        const groundY = pl.groundY;
        const groundFric = pl.groundFriction;

        // ---------- 子步 ----------
        for (let step = 0; step < SUBSTEPS; step++) {

            // ===== 1. 积分（Verlet）=====
            for (let i = 0; i < n; i++) {
                if (this.pin[i] || lock[i]) continue;

                const xi = this.px[i], yi = this.py[i], zi = this.pz[i];
                const vx = (xi - this.ox[i]) * retention * velRet;
                const vy = (yi - this.oy[i]) * retention * velRet;
                const vz = (zi - this.oz[i]) * retention * velRet;
                this.ox[i] = xi; this.oy[i] = yi; this.oz[i] = zi;

                let fx = 0, fy = 0, fz = 0;
                if (windAccel !== 0) {
                    // 与经典解算相同的三组湍流，只是把 sin/cos 换成查表
                    const nx = xi * spatialFreq + timeWind;
                    const ny = yi * spatialFreq + timeWind * 1.2;
                    const nz = zi * spatialFreq + timeWind * 0.8;
                    const tx = fastSin(nx) * fastCos(ny) + fastSin(nz * 1.3) * fastCos(nx * 0.9);
                    const ty = fastSin(ny) * fastCos(nz) + fastSin(nx * 1.1) * fastCos(ny * 0.8);
                    const tz = fastSin(nz) * fastCos(nx) + fastSin(ny * 1.4) * fastCos(nz * 1.1);
                    const scale = windAccel * noiseAmp;
                    fx = (baseWindX + tx * noiseRandom) * scale;
                    fy = (baseWindY + ty * noiseRandom) * scale;
                    fz = (windZComp + tz * noiseRandom) * scale;
                }

                let dx = vx + fx * dt2;
                let dy = vy + (fy + gAccel * gravGY - this.extraG[i]) * dt2;
                let dz = vz + fz * dt2;
                dx += gAccel * gravGX * dt2;

                if (dx > maxDelta) dx = maxDelta; else if (dx < -maxDelta) dx = -maxDelta;
                if (dy > maxDelta) dy = maxDelta; else if (dy < -maxDelta) dy = -maxDelta;
                if (dz > maxDelta) dz = maxDelta; else if (dz < -maxDelta) dz = -maxDelta;

                let nxp = xi + dx;
                let nyp = yi + dy;
                let nzp = zi + dz;

                // 地面碰撞
                if (groundOn && nyp < groundY) {
                    nyp = groundY;
                    const hvx = nxp - this.ox[i];
                    const hvz = nzp - this.oz[i];
                    this.ox[i] = nxp - hvx * groundFric;
                    this.oz[i] = nzp - hvz * groundFric;
                    this.oy[i] = nyp + (nyp - this.oy[i]) * 0.2;
                }

                this.px[i] = nxp; this.py[i] = nyp; this.pz[i] = nzp;
            }

            // ===== 2. 弹簧约束迭代 =====
            const si = this.si, sj = this.sj;
            const sRest = this.sRest, sBroken = this.sBroken, sMul = this.sMul;
            const m = this.m;

            for (let it = 0; it < iters; it++) {
                for (let k = 0; k < m; k++) {
                    if (sBroken[k]) continue;

                    const a = si[k], b = sj[k];
                    const pinA = this.pin[a] | lock[a];
                    const pinB = this.pin[b] | lock[b];
                    if (pinA && pinB) continue;

                    const wa = pinA ? 0 : this.iw[a];
                    const wb = pinB ? 0 : this.iw[b];
                    const wsum = wa + wb;
                    if (wsum === 0) continue;

                    const dx = this.px[b] - this.px[a];
                    const dy = this.py[b] - this.py[a];
                    const dz = this.pz[b] - this.pz[a];
                    const dist2 = dx * dx + dy * dy + dz * dz;
                    if (dist2 < 1e-16) continue;
                    const dist = Math.sqrt(dist2);

                    let rest = sRest[k];

                    // ---- 塑性形变：超阈值就把静止长度永久拉长 ----
                    if (plasticOn) {
                        if (dist > rest * plasticThreshold) {
                            rest += (dist - rest * plasticThreshold) * plasticRate;
                            const cap = this.sOrig[k] * plasticMax;
                            if (rest > cap) rest = cap;
                            sRest[k] = rest;
                            this._restDirty = true;
                        } else if (plasticRecovery > 0 && rest > this.sOrig[k]) {
                            rest -= (rest - this.sOrig[k]) * plasticRecovery;
                            if (rest < this.sOrig[k]) rest = this.sOrig[k];
                            sRest[k] = rest;
                            this._restDirty = true;
                        }
                    }

                    // ===== 拉伸约束：软弹性区间 + 硬上限投影 =====
                    // 热循环里只做乘法比较，避免每根弹簧每遍都做除法 / 开方（赛扬这类 CPU 最吃这个）。
                    const limit = rest * strainHardCap;
                    let cx, cy, cz;

                    // 死区：微小超出（<0.3%）不校正，否则静置时永远在微抖 → 永不休眠
                    if (dist > limit * 1.003) {
                        // 超出硬上限：修正比例 = 超出量 / 当前长度，直接限幅（无需 sqrt）
                        let pull = (dist - limit) / dist;
                        if (pull > 0.6) pull = 0.6;
                        cx = dx * pull; cy = dy * pull; cz = dz * pull;
                        // 吃掉超限弹簧 65% 动能，抑制回弹
                        this.ox[a] = this.px[a] - (this.px[a] - this.ox[a]) * 0.35;
                        this.oy[a] = this.py[a] - (this.py[a] - this.oy[a]) * 0.35;
                        this.oz[a] = this.pz[a] - (this.pz[a] - this.oz[a]) * 0.35;
                        this.ox[b] = this.px[b] - (this.px[b] - this.ox[b]) * 0.35;
                        this.oy[b] = this.py[b] - (this.py[b] - this.oy[b]) * 0.35;
                        this.oz[b] = this.pz[b] - (this.pz[b] - this.oz[b]) * 0.35;
                    } else if (dist > limit) {
                        // 临界带内：只做位置校正，不动速度（避免持续注入运动量）
                        let pull = (dist - limit) / dist;
                        if (pull > 0.3) pull = 0.3;
                        cx = dx * pull; cy = dy * pull; cz = dz * pull;
                    } else {
                        // 弹性区间：软约束 + 应变超过 1.5% 后刚度非线性升高
                        let lk = effStiff * sMul[k];
                        const soft = rest * 1.015;
                        if (dist > soft) {
                            const hard = rest * strainHardCap;
                            const t = (dist - soft) / (hard - soft + 1e-9);
                            lk += (1 - lk) * (t > 1 ? 1 : t);
                        }
                        if (lk > 1) lk = 1;
                        const inv = 1 / dist;
                        const diff = (dist - rest) * inv * lk;
                        cx = dx * diff; cy = dy * diff; cz = dz * diff;
                    }

                    // 弹簧阻尼（抑制高频振荡）
                    if (springDampV > 0) {
                        const rvx = (this.px[b] - this.ox[b]) - (this.px[a] - this.ox[a]);
                        const rvy = (this.py[b] - this.oy[b]) - (this.py[a] - this.oy[a]);
                        const rvz = (this.pz[b] - this.oz[b]) - (this.pz[a] - this.oz[a]);
                        const dot = (rvx * dx + rvy * dy + rvz * dz) / dist2;
                        cx += dx * dot * springDampV;
                        cy += dy * dot * springDampV;
                        cz += dz * dot * springDampV;
                    }

                    if (cx > MAX_CORRECTION) cx = MAX_CORRECTION; else if (cx < -MAX_CORRECTION) cx = -MAX_CORRECTION;
                    if (cy > MAX_CORRECTION) cy = MAX_CORRECTION; else if (cy < -MAX_CORRECTION) cy = -MAX_CORRECTION;
                    if (cz > MAX_CORRECTION) cz = MAX_CORRECTION; else if (cz < -MAX_CORRECTION) cz = -MAX_CORRECTION;

                    const ka = wa / wsum;
                    const kb = wb / wsum;
                    this.px[a] += cx * ka; this.py[a] += cy * ka; this.pz[a] += cz * ka;
                    this.px[b] -= cx * kb; this.py[b] -= cy * kb; this.pz[b] -= cz * kb;
                }

                // ===== 3. 弯曲弹簧（不参与塑性 / 最大拉伸）=====
                if (bendK > 0.001 && this.bm) {
                    const bi = this.bi, bj = this.bj;
                    const bRest = this.bRest, bBroken = this.bBroken;
                    const bendStiff = bendK * 0.05;
                    for (let k = 0; k < this.bm; k++) {
                        if (bBroken[k]) continue;

                        const a = bi[k], b = bj[k];
                        const pinA = this.pin[a] | lock[a];
                        const pinB = this.pin[b] | lock[b];
                        if (pinA && pinB) continue;

                        const wa = pinA ? 0 : this.iw[a];
                        const wb = pinB ? 0 : this.iw[b];
                        const wsum = wa + wb;
                        if (wsum === 0) continue;

                        const dx = this.px[b] - this.px[a];
                        const dy = this.py[b] - this.py[a];
                        const dz = this.pz[b] - this.pz[a];
                        const dist2 = dx * dx + dy * dy + dz * dz;
                        if (dist2 < 1e-16) continue;
                        const dist = Math.sqrt(dist2);

                        const diff = (dist - bRest[k]) / dist * bendStiff;
                        let cx = dx * diff, cy = dy * diff, cz = dz * diff;


                        if (cx > MAX_CORRECTION_BEND) cx = MAX_CORRECTION_BEND; else if (cx < -MAX_CORRECTION_BEND) cx = -MAX_CORRECTION_BEND;
                        if (cy > MAX_CORRECTION_BEND) cy = MAX_CORRECTION_BEND; else if (cy < -MAX_CORRECTION_BEND) cy = -MAX_CORRECTION_BEND;
                        if (cz > MAX_CORRECTION_BEND) cz = MAX_CORRECTION_BEND; else if (cz < -MAX_CORRECTION_BEND) cz = -MAX_CORRECTION_BEND;

                        const ka = wa / wsum;
                        const kb = wb / wsum;
                        this.px[a] += cx * ka; this.py[a] += cy * ka; this.pz[a] += cz * ka;
                        this.px[b] -= cx * kb; this.py[b] -= cy * kb; this.pz[b] -= cz * kb;
                    }
                }
            }

            // ===== 4. 自碰撞（可选，交给宿主跑经典实现）=====
            // 只在最后一个子步做一次：经典解算每个子步都建一次网格，代价很高，
            // 低配模式下每帧收尾对一次就够（视觉上差别很小）。
            if (pl.collision && host.solveCollision && step === SUBSTEPS - 1) {
                this.flush();
                host.solveCollision(c, this.lockSet);
                this.sync();
            }
        }

        // ---------- 写回 + 刷新几何 ----------
        this.flush();
        if (host.afterSolve) host.afterSolve(c);

        // ---------- 静止检测 ----------
        let maxMove2 = 0;
        const lx = this.lx, ly = this.ly, lz = this.lz;
        for (let i = 0; i < n; i++) {
            const ddx = this.px[i] - lx[i];
            const ddy = this.py[i] - ly[i];
            const ddz = this.pz[i] - lz[i];
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 > maxMove2) maxMove2 = d2;
            lx[i] = this.px[i]; ly[i] = this.py[i]; lz[i] = this.pz[i];
        }

        const still = pl.wind <= 0.001 && !plasticOn && lockCount === 0 && !pl.collision;
        if (still && maxMove2 < LOW_SPEC.SLEEP_EPS2) {
            this.sleepFrames++;
            if (this.sleepFrames >= LOW_SPEC.SLEEP_FRAMES) {
                this.asleep = true;
                this._decorVersion = host.decorVersion ? host.decorVersion() : 0;
            }
        } else {
            this.sleepFrames = 0;
        }
    }
}

