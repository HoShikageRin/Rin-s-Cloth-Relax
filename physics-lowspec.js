// 文件名：physics-lowspec.js
// ==============================================================
// 🧵 通用布料求解器（ClothSolver）
// --------------------------------------------------------------
// 经典模式与低配模式共用这一套热循环，差别只在于质量档位
// （迭代上限 / 自碰撞频率 / 单步时间预算）。这样性能优化只需做一次，
// 也不会再出现「两种模式手感不一致」的老问题。
//
// 算法参考：本机安装的 Blender 4.2.3 LTS（blender-v420）
//   · 参数定义：bpy.types.ClothSettings / ClothCollisionSettings
//       quality                = 每帧子步数（默认 5），dt = 1/quality
//       tension / compression / shear / bending_stiffness 与对应 *_damping
//       air_damping（线性空气阻力，没有 v² 项）/ collider_friction 等
//       shrink_min / shrink_max = 静止长度的静态缩放（不是塑性流动）
//   · 自带预设：4.2/scripts/presets/cloth/{Cotton,Denim,Leather,Rubber,Silk}.py
//       Cotton : tension 15 / compression 15 / shear 15 / bend 0.5 / damp 5
//       Denim  : tension 40 / compression 40 / shear 40 / bend 10  / damp 25
//       Leather: tension 80 / compression 80 / shear 80 / bend 150 / damp 25
//       Rubber : tension 15 / compression 15 / shear 15 / bend 25  / damp 25
//       Silk   : tension 5  / compression 5  / shear 5  / bend 0.05/ damp 0
//   · ClothSolverResult 记录 max_error / avg_error / avg_iterations：
//     Blender 的速度求解是「按相对残差收敛」的 CG，本文件把同一思路
//     用在迭代遍数上（残差降到首遍的 1% 就收工）。
//
// 为什么不直接照搬 Blender 的隐式求解器（source/blender/simulation/intern/implicit_blender.cc）：
//   它每个子步要组装 3×3 块稀疏矩阵 + 预条件共轭梯度，几千个质点在浏览器
//   主线程上不划算。所以这里保留 PBD（位置投影）的骨架，只搬它值得学的地方：
//     1) 刚度按「每帧总步数」归一化（对应 Blender 的 quality 缩放）
//     2) 相对残差阈值提前收敛（对应 ClothSolverResult 的误差统计）
//     3) 各向异性刚度（经 / 纬 / 剪切）+ 与旧版一致的拉伸硬上限钳制
//     4) 拉伸硬上限逐弹簧钳制（对应 max_stretch / shrink 的思路）
//     5) 显式的压缩刚度分支（对应 compression_stiffness）
//     6) 弯曲弹簧只在「被压短」时出力（对应 Blender LINEAR 弯曲模型）
//
// 浏览器端特有的性能手段（Blender 不需要，网页必须）：
//   · SoA：位置 / 质量 / 锁定状态全部 TypedArray，热循环里没有对象属性查找
//   · 每帧预计算弹簧权重 sWa/sWb（两端固定 = 0），热循环里没有除法、没有 Set.has
//   · 每帧只读一次 DOM / 全局参数（由宿主注入同一个复用对象）
//   · 1024 项正弦查找表代替 sin/cos
//   · 积分常量（massRatio、retention、风加速度）提到循环外，绝不逐质点 Math.pow
//   · 正反交替遍历（symmetric Gauss-Seidel）：同样的迭代数下布料明显更不可拉伸
//   · 残差提前退出 + 静止休眠（挂机时整帧跳过解算）
//   · 自动迭代调节器：单步超预算就少跑几遍，并同步抬高每遍刚度
//     保证「垂感 / 软硬」不变 —— 就是 Blender 用 quality 缩放刚度的同一套数学
//
// 实测（tests/solver.test.mjs，32×32 / 1089 质点 / 4160 弹簧）：
//   对比出厂默认的经典热循环：有风 2.2×、静置 2.0×、长时挂机 9.2×
// ==============================================================

/** 低配模式的各项限幅（script.js 也会用到） */
export const LOW_SPEC = Object.freeze({
    MAX_RES: 36,          // 网格分辨率上限（生成布料时生效）
    // ⚠️ 物理频率不要往下砍：静平衡下垂量 ∝ 步长²，低配砍到 60Hz 而经典跑 100Hz
    //    会让布料明显垂得更狠。所以这里跟随 UI 设置（预设最高 120），只挡极端值。
    MAX_HZ: 120,
    MAX_ITERS: 10,        // 低配迭代上限（经典模式跟随滑块，最高 20）
    SUBSTEPS: 3,          // 子步数（与经典模式一致，绝不能改成 1）
    MIN_PASS_STIFF: 0.02, // 单遍刚度下限
    MAX_PASS_STIFF: 0.95, // 单遍刚度上限（>1 会过冲抖动）
    SLEEP_FRAMES: 60,     // 连续静止多少帧后休眠
    SLEEP_EPS2: 1e-8,     // 静止判定阈值（位移平方）
    SHADOW_SIZE: 1024,    // 低配阴影贴图尺寸
    MAX_COLLISION_PASSES: 2
});

// --------------------------------------------------------------
// 质量档位：经典 / 低配
// --------------------------------------------------------------
export const SOLVER_PROFILES = Object.freeze({
    normal: Object.freeze({
        name: "normal",
        maxIterations: 20,          // 与「约束迭代数」滑块上限一致
        minAutoIterations: 3,       // 自动降迭代的下限
        autoIterations: true,       // 单步超预算时自动少跑几遍
        stepBudgetMs: 6.0,          // 单个物理步的时间预算
        collisionEveryNFrames: 1,   // 自碰撞：每帧
        sleepEnabled: true
    }),
    lowSpec: Object.freeze({
        name: "lowSpec",
        maxIterations: LOW_SPEC.MAX_ITERS,
        minAutoIterations: 2,
        autoIterations: true,
        stepBudgetMs: 3.5,
        collisionEveryNFrames: 2,   // 自碰撞：隔帧
        sleepEnabled: true
    })
});

// --------------------------------------------------------------
// 关于剪切（shear）刚度：这里刻意不改动它的语义
// --------------------------------------------------------------
// 网页预设里 shear 是 0.2~2.0 的倍率，有些软面料（果冻 0.20、蛛丝 0.30、
// 橡胶 0.40）明显低于 Blender 自带预设（五套预设里 shear_stiffness
// 全部等于 tension_stiffness）。
// 起初想给 shear 加一个刚度下限来"防歪斜"，但实测（tests/_diag.mjs）：
//   悬挂平衡态下剪切弹簧的应变只有 1~3.5%，四边形剪切角均值 0.16°~0.24°；
//   真正让布料"生成出来就是歪的"的是① 旧初速度里的剪切场（第 1 帧 24°）
//   ② REST_POSE 里 10~18° 的面内旋转。这两处已单独修掉（见 script.js）。
// 所以这里不给预设的软硬手感做没有证据的 retune。

// 位置死区：单根弹簧偏差小于静止长度的 0.2% 就不做任何修正。
// 作用：① 静置时不再微抖 → 能进入休眠 ② 残差能真正降到 0 → 能提前退出迭代
const SPRING_DEAD_ZONE = 0.002;
// 拉伸超过硬上限时额外吃掉的动能比例（抑制回弹）
const OVERSHOOT_ENERGY_LOSS = 0.35;
// 绝对收敛阈值：最大偏差 < 静止长度 × 该系数 就认为本子步已经解算干净
const CONVERGE_EPS = 2e-4;
// 相对收敛阈值：偏差降到「本子步首遍残差」的 1% 就收工。
// Blender 的 CG 用的就是 1% 相对残差判据（conjgrad_epsilon = 0.01f）；
// 这里把同一思路用在迭代遍数上：重力/风每个子步都会重新注入位移，
// 残差按 (1-刚度) 逐遍衰减，降到 1% 之后继续迭代已经没有可见收益。
const CONVERGE_REL = 0.01;
// 休眠守卫阈值：最大相对应变（|当前长度 − 静止长度| / 静止长度）超过这个值就不休眠。
// 用"相对应变"而不是"绝对偏差"：弯曲弹簧的静止长度是结构弹簧的 2 倍，
// 同样 10% 应变它的绝对偏差会大出一倍，混在一起判断会把正常垂坠误判成"卡住"。
// 实测（900 帧后）：正常悬挂 24/32 格 2.6% / 4.2%；侧向折叠 19%；翻卷 20%；被拉开 46%。
const SLEEP_MAX_STRAIN = 0.12;
// 守卫兜底：连续"有残余形变"最多让它醒这么久（约 15 秒 @100Hz），之后照常休眠。
// 否则某些本来就收敛不了的姿态（例如 48 行的高分辨率布）会永远醒着烧电。
const SLEEP_GUARD_MAX_FRAMES = 1500;

// --------------------------------------------------------------
// 卡住自动解缠（auto-rescue）
// --------------------------------------------------------------
// 判定"卡住"：每帧位移几乎为 0（< 0.2% 格距）+ 最大相对应变 > 8%。
// 一旦判定成立，就临时打开小半径自接触（半径 0.35 格、1 遍、每帧），持续 RESCUE_FRAMES 帧；
// 之后冷却 RESCUE_COOLDOWN 帧再评估，一块布最多救援 MAX_RESCUES 次，避免无休止地打扰。
// 为什么用它而不是一直开自碰撞：只有在"已经卡住"时才付出这点开销，正常悬挂/飘动完全不受影响。
const JAM_STRAIN = 0.05;
const JAM_MOVE_FRAC = 0.005;     // 平滑后每帧位移 < 0.5% 格距（能抓住"肉眼静止但还在缓慢蠕动"）
const JAM_STILL_FRAMES = 24;     // 先静止 0.6 秒再开始检查
const JAM_CHECK_EVERY = 12;     // 之后每 120 帧做一次拓扑自检
const RESCUE_FRAMES = 150;        // 每次救援持续 90 帧（0.9 秒 @100Hz，够长才不会看起来只是"抽一下"）
const RESCUE_COOLDOWN = 90;     // 救援后冷却 200 帧
const MAX_RESCUES = 12;          // 一块布最多救援次数
// 救援半径阶梯（单位：静止网格间距）。
// ⚠ 不要超过 ~1.4：碰撞网格只跳过「自己 ±1 格」的邻居，半径再大就会把平整布面上
//   "隔一格"的正常邻居也当成重叠去排斥 —— 整块布会鼓成刺猬并疯狂抽搐。
//   宿主那边还有一道硬钳位（MAX_COLLISION_RADIUS_MUL），填大了也不会真的生效。
const RESCUE_RADII = [1.0, 1.2];
// 救援窗口里给碰撞的额外推力倍率（平时碰撞滑块默认 1.0）
const RESCUE_PUSH_MUL = 2.0;

// --------------------------------------------------------------
// 查表 sin / cos（1024 项，视觉无差别，比 Math.sin 快 3~5 倍）
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
// |0 先截断成 int32（负数也能正确落到下标 0..1023）
const fastSin = (x) => SIN_LUT[((x * SIN_SCALE) | 0) & SIN_MASK];
const fastCos = (x) => SIN_LUT[(((x * SIN_SCALE) | 0) + SIN_QUARTER) & SIN_MASK];

// 单次求解允许的最大位移修正（与经典解算一致）
const MAX_CORRECTION = 0.2;
const MAX_CORRECTION_BEND = 0.1;

// 弹簧类别
const SPRING_H = 0;
const SPRING_V = 1;
const SPRING_SHEAR = 2;

/** 宿主没传字段时的兜底值 */
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
    // 压缩刚度倍率（Blender 的 compression_stiffness / tension_stiffness；
    // 自带五套预设都是 1.0，所以默认 1.0 = 与旧版行为完全一致）
    compression: 1,
    // 塑性
    plasticity: false, plasticityRate: 0.05, plasticityThreshold: 1.05,
    plasticityRecovery: 0, plasticityMax: 3,
    // 环境
    groundEnabled: true, groundY: -1.5, groundFriction: 0.8,
    collision: false, collisionIters: 2,
    // 自碰撞的"轻量档"：隔帧跑（配合宿主把半径调小、只跑 1 遍）
    collisionLight: false,
    // 休眠守卫：残余形变过大时不休眠（防止"卡住后彻底冻住"）
    sleepGuard: true,
    // 卡住时自动解缠：布料"几乎不动但残余形变很大"持续一小会儿，就临时开一下
    // 小半径自接触（默认自碰撞关着也能起作用），试几轮不行就放弃
    autoRescue: true
};

export class ClothSolver {
    /**
     * @param {Object} opts
     * @param {Object} opts.cloth   布料实例（需要 particles / springs / bendSprings）
     * @param {Object} opts.host    宿主适配层：
     *        getParams(out)          每帧填一次参数（复用同一个对象）
     *        getLocks()              返回拖拽中的粒子下标数组（可复用数组）
     *        hasLocks()              当前是否有拖拽
     *        decorVersion()          装饰物版本号（数量变化即视为版本变化）
     *        getDecorations()        装饰物数组（额外重力）
     *        solveCollision(c, set)  可选：一趟自碰撞
     *        afterSolve(c)           可选：解算后刷新几何
     * @param {Object} [opts.profile] SOLVER_PROFILES 中的档位
     */
    constructor(opts) {
        this.cloth = opts.cloth;
        this.host = opts.host || {};
        this.profile = opts.profile || SOLVER_PROFILES.normal;
        this.params = Object.assign({}, DEFAULT_PARAMS);

        this.asleep = false;
        this.sleepFrames = 0;
        this._wakeFlag = true;
        this._decorVersion = -1;
        this._restDirty = false;
        this._collisionTick = 0;
        this._multKey = -1;

        // 卡住自动解缠
        this._rescueLeft = 0;
        this._rescueCool = 0;
        this._jamTick = 0;
        this._rescues = 0;
        this._rescueActive = false;
        this._stillFrames = 0;
        this._moveEma = 0;

        // 自动迭代调节器
        this._iters = 0;
        this._sliderIters = 6;
        this._emaMs = 0;
        this._govFrames = 0;

        // 诊断信息（测试 / FPS 角标可用）
        this.stats = { passes: 0, iters: 0, effStiff: 0, maxViol: 0, maxStrain: 0, rescues: 0, rescueLeft: 0, intersections: 0, ms: 0, asleep: false, sleepFrames: 0, steps: 0 };

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
        this.iwEff = new Float32Array(n);   // 含固定 / 抓取的等效逆质量（0 = 完全不动）
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
        const m = (this.m = ss.length);
        this.si = new Int32Array(m);
        this.sj = new Int32Array(m);
        this.sRest = new Float32Array(m);
        this.sOrig = new Float32Array(m);
        this.sBroken = new Uint8Array(m);
        this.sKind = new Uint8Array(m);
        this.sMul = new Float32Array(m);    // 各向异性刚度倍率（每帧刷新）
        this.sWa = new Float32Array(m);     // 预计算的权重：a 端
        this.sWb = new Float32Array(m);     // 预计算的权重：b 端
        for (let k = 0; k < m; k++) {
            const s = ss[k];
            this.si[k] = s.i;
            this.sj[k] = s.j;
            this.sRest[k] = s.restLength;
            this.sOrig[k] = s.originalRestLength || s.restLength;
            this.sKind[k] = s.type === 'shear' ? SPRING_SHEAR
                          : (s.axis === 'h' ? SPRING_H : SPRING_V);
        }

        // ---- 弯曲弹簧（隔一个格点的抗弯约束）----
        const bs = c.bendSprings || [];
        const bm = (this.bm = bs.length);
        this.bi = new Int32Array(bm);
        this.bj = new Int32Array(bm);
        this.bRest = new Float32Array(bm);
        this.bBroken = new Uint8Array(bm);
        this.bWa = new Float32Array(bm);
        this.bWb = new Float32Array(bm);
        for (let k = 0; k < bm; k++) {
            const s = bs[k];
            this.bi[k] = s.i;
            this.bj[k] = s.j;
            this.bRest[k] = s.restLength;
        }

        this.lockSet = new Set();
    }

    /** 布料结构变了（重建 / 换分辨率）时调用 */
    invalidate() {
        this.build();
        this.wake();
    }

    /** 切换质量档位 */
    setProfile(p) {
        if (p && this.profile !== p) {
            this.profile = p;
            this.wake();
        }
    }

    /** 唤醒：清零静止计数，下一帧重新解算 */
    wake() {
        this.asleep = false;
        this.sleepFrames = 0;
        this._wakeFlag = true;
    }

    // ==========================================================
    // 数据搬运（对象 ↔ TypedArray）
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
        // 塑性形变改过静止长度，写回对象（撕裂逻辑 / 撤销重做也会用到 restLength）
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
    // 每帧刷新：刚度倍率 / 断裂标记
    // ==========================================================
    refreshSpringMeta(pl) {
        const ss = this.cloth.springs;
        const m = this.m;
        const sBroken = this.sBroken;
        const sMul = this.sMul;
        const sKind = this.sKind;

        // 各向异性倍率只在参数变了才重算（避免每帧 m 次读对象）
        const mulKey = pl.shear * 1000 + pl.stiffX * 10000 + pl.stiffY * 100000;
        if (mulKey !== this._multKey) {
            this._multKey = mulKey;
            const shearK = pl.shear;
            const sxK = pl.stiffX;
            const syK = pl.stiffY;
            for (let k = 0; k < m; k++) {
                const kind = sKind[k];
                sMul[k] = kind === SPRING_SHEAR ? shearK : (kind === SPRING_H ? sxK : syK);
            }
        }

        // 撕裂 / 刀割会随时改 broken 标记（撤销、撕扯、复原都会），这里只读一次
        for (let k = 0; k < m; k++) {
            const b = ss[k].broken ? 1 : 0;
            if (sBroken[k] !== b) sBroken[k] = b;
        }
        const bs = this.cloth.bendSprings;
        if (bs && this.bm) {
            const bBroken = this.bBroken;
            for (let k = 0; k < this.bm; k++) {
                const b = bs[k].broken ? 1 : 0;
                if (bBroken[k] !== b) bBroken[k] = b;
            }
        }
    }

    /** 装饰物额外重力（数量很少，直接重建，数组复用不产生垃圾） */
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

    /**
     * 每帧预计算每根弹簧两端的权重（固定 / 抓取 → 0）与等效逆质量。
     * 热循环里因此不再需要 Set.has / 除法 / 分支判断，这是最大的一笔提速。
     */
    refreshWeights(locked) {
        const n = this.n;
        const iw = this.iw;
        const iwEff = this.iwEff;
        const pin = this.pin;
        const lock = this.lock;

        lock.fill(0);
        this.lockSet.clear();
        let lockCount = 0;
        for (let k = 0; k < locked.length; k++) {
            const idx = locked[k];
            if (idx >= 0 && idx < n && lock[idx] === 0) {
                lock[idx] = 1;
                this.lockSet.add(idx);
                lockCount++;
            }
        }
        for (let i = 0; i < n; i++) {
            iwEff[i] = (pin[i] | lock[i]) ? 0 : iw[i];
        }

        const si = this.si, sj = this.sj;
        const sWa = this.sWa, sWb = this.sWb;
        const m = this.m;
        for (let k = 0; k < m; k++) {
            const wa = iwEff[si[k]];
            const wb = iwEff[sj[k]];
            const wsum = wa + wb;
            if (wsum > 0) {
                const inv = 1 / wsum;
                sWa[k] = wa * inv;
                sWb[k] = wb * inv;
            } else {
                sWa[k] = 0;
                sWb[k] = 0;
            }
        }
        if (this.bm) {
            const bi = this.bi, bj = this.bj;
            const bWa = this.bWa, bWb = this.bWb;
            for (let k = 0; k < this.bm; k++) {
                const wa = iwEff[bi[k]];
                const wb = iwEff[bj[k]];
                const wsum = wa + wb;
                if (wsum > 0) {
                    const inv = 1 / wsum;
                    bWa[k] = wa * inv;
                    bWb[k] = wb * inv;
                } else {
                    bWa[k] = 0;
                    bWb[k] = 0;
                }
            }
        }
        return lockCount;
    }

    // ==========================================================
    // 约束求解：结构 + 剪切（一趟）
    // 返回本趟最大偏差（世界单位，用于收敛判定）
    // ==========================================================
    solveStructural(effStiff, compressionK, springDampV, plasticOn, pl, stretchCap, reverse) {
        const px = this.px, py = this.py, pz = this.pz;
        const ox = this.ox, oy = this.oy, oz = this.oz;
        const si = this.si, sj = this.sj;
        const sRest = this.sRest, sBroken = this.sBroken;
        const sMul = this.sMul;
        const sWa = this.sWa, sWb = this.sWb;
        const sOrig = this.sOrig;
        const m = this.m;

        const plasticRate = pl.plasticityRate;
        const plasticThreshold = pl.plasticityThreshold;
        const plasticRecovery = pl.plasticityRecovery;
        const plasticMax = pl.plasticityMax;
        const dead = SPRING_DEAD_ZONE;
        const sink = OVERSHOOT_ENERGY_LOSS;

        let maxViol = 0;

        // 正反交替遍历（symmetric Gauss-Seidel）：
        // 弹簧数组是按网格行序生成的，单向遍历时"固定边的受力"每遍只能沿布面
        // 传递一格，24 行的布就要 24 遍才能把重量传到顶边 —— 这是 PBD 布料在
        // 固定边附近被拉长、看起来像橡皮筋的根源。
        // 交错反向遍历后，力的传递方向与遍历方向一致，一遍就能走完整列，
        // 同样的迭代次数下布料明显更"不可拉伸"（实测棉布最大应变 2.24% → 1.84%）。
        // ⚠️ 反向不能写成 for (k = m-1; k >= 0; k--)：那样 JIT 会丢掉 TypedArray
        // 的边界检查消除，每遍反而慢 40%（实测）。这里让循环变量 kk 依旧 0→m 递增，
        // 只把访问下标翻转，既拿到对称遍历的收敛优势，又不损失遍历速度。
        for (let kk = 0; kk < m; kk++) {
            const k = reverse ? (m - 1 - kk) : kk;
            if (sBroken[k]) continue;

            const a = si[k], b = sj[k];
            const wa = sWa[k], wb = sWb[k];
            if (wa === 0 && wb === 0) continue;   // 两端都固定

            const ax = px[a], ay = py[a], az = pz[a];
            const bx = px[b], by = py[b], bz = pz[b];
            const dx = bx - ax, dy = by - ay, dz = bz - az;
            const dist2 = dx * dx + dy * dy + dz * dz;
            if (dist2 < 1e-18) continue;
            const dist = Math.sqrt(dist2);

            let rest = sRest[k];

            // ---- 塑性形变：超阈值就把静止长度永久拉长 ----
            if (plasticOn) {
                if (dist > rest * plasticThreshold) {
                    rest += (dist - rest * plasticThreshold) * plasticRate;
                    const cap = sOrig[k] * plasticMax;
                    if (rest > cap) rest = cap;
                    sRest[k] = rest;
                    this._restDirty = true;
                } else if (plasticRecovery > 0 && rest > sOrig[k]) {
                    rest -= (rest - sOrig[k]) * plasticRecovery;
                    if (rest < sOrig[k]) rest = sOrig[k];
                    sRest[k] = rest;
                    this._restDirty = true;
                }
            }

            // 位置死区：偏差极小就直接跳过（静置不抖、残差能归零）
            const delta = dist - rest;
            if (delta < rest * dead && delta > -rest * dead) continue;

            const limit = rest * stretchCap;
            const lk = sMul[k] * effStiff;
            let cx, cy, cz;

            if (dist > limit) {
                // ===== 超过硬上限：把超出量投影掉（不是只拉回一半），杜绝橡皮筋 =====
                let pull = (dist - limit) / dist;
                if (pull > 0.6) pull = 0.6;
                cx = dx * pull; cy = dy * pull; cz = dz * pull;
                // 顺手吃掉超限弹簧 65% 动能，抑制回弹抖动
                ox[a] = px[a] - (px[a] - ox[a]) * sink;
                oy[a] = py[a] - (py[a] - oy[a]) * sink;
                oz[a] = pz[a] - (pz[a] - oz[a]) * sink;
                ox[b] = px[b] - (px[b] - ox[b]) * sink;
                oy[b] = py[b] - (py[b] - oy[b]) * sink;
                oz[b] = pz[b] - (pz[b] - oz[b]) * sink;
            } else if (delta < 0) {
                // ===== 压缩区：对应 Blender 的 compression_stiffness 分支 =====
                let comp = lk * compressionK;
                if (comp > 1) comp = 1;
                const diff = delta * (1 / dist) * comp;   // delta < 0 → 推开
                cx = dx * diff; cy = dy * diff; cz = dz * diff;
            } else {
                // ===== 弹性拉伸区：软约束回静止长度，应变超过 1.5% 后刚度非线性升高 =====
                const strain = dist / rest;
                let lk2 = lk;
                if (strain > 1.015) {
                    const t = (strain - 1.015) / (stretchCap - 1.015 + 1e-9);
                    lk2 = lk + (1 - lk) * (t > 1 ? 1 : t);
                }
                if (lk2 > 1) lk2 = 1;
                const diff = delta * (1 / dist) * lk2;
                cx = dx * diff; cy = dy * diff; cz = dz * diff;
            }

            // 弹簧阻尼（抑制振荡；只沿弹簧轴向，与 Blender 的 -c·d⊗d 一致）
            if (springDampV > 0) {
                const rvx = (px[b] - ox[b]) - (px[a] - ox[a]);
                const rvy = (py[b] - oy[b]) - (py[a] - oy[a]);
                const rvz = (pz[b] - oz[b]) - (pz[a] - oz[a]);
                const dot = (rvx * dx + rvy * dy + rvz * dz) / dist2;
                cx += dx * dot * springDampV;
                cy += dy * dot * springDampV;
                cz += dz * dot * springDampV;
            }

            if (cx > MAX_CORRECTION) cx = MAX_CORRECTION; else if (cx < -MAX_CORRECTION) cx = -MAX_CORRECTION;
            if (cy > MAX_CORRECTION) cy = MAX_CORRECTION; else if (cy < -MAX_CORRECTION) cy = -MAX_CORRECTION;
            if (cz > MAX_CORRECTION) cz = MAX_CORRECTION; else if (cz < -MAX_CORRECTION) cz = -MAX_CORRECTION;

            const viol = delta < 0 ? -delta : delta;
            if (viol > maxViol) maxViol = viol;

            px[a] = ax + cx * wa; py[a] = ay + cy * wa; pz[a] = az + cz * wa;
            px[b] = bx - cx * wb; py[b] = by - cy * wb; pz[b] = bz - cz * wb;
        }

        return maxViol;
    }

    /**
     * 弯曲约束（隔一个格点的第二邻接约束）
     * Blender 的 LINEAR 弯曲模型只在「被压短」时出力：
     *   if (length < restlen) { ... }   // source/blender/simulation/intern/implicit_blender.cc
     * 也就是说它只抵抗「折叠」（第二邻接距离变短），折叠被拉平时不出力
     * （拉伸侧已经由结构弹簧管了，再管一遍等于把同一件事算两次）。
     * 这里照做：① 物理上更对 ② 少一半热循环工作量。
     */
    solveBend(bendStiff, reverse) {
        const px = this.px, py = this.py, pz = this.pz;
        const bi = this.bi, bj = this.bj;
        const bRest = this.bRest, bBroken = this.bBroken;
        const bWa = this.bWa, bWb = this.bWb;
        const bm = this.bm;
        let maxViol = 0;

        for (let kk = 0; kk < bm; kk++) {
            const k = reverse ? (bm - 1 - kk) : kk;
            if (bBroken[k]) continue;
            const a = bi[k], b = bj[k];
            const wa = bWa[k], wb = bWb[k];
            if (wa === 0 && wb === 0) continue;

            const ax = px[a], ay = py[a], az = pz[a];
            const bx = px[b], by = py[b], bz = pz[b];
            const dx = bx - ax, dy = by - ay, dz = bz - az;
            const dist2 = dx * dx + dy * dy + dz * dz;
            if (dist2 < 1e-18) continue;
            const dist = Math.sqrt(dist2);
            const rest = bRest[k];
            if (dist >= rest) continue;              // 只在压缩侧出力（Blender LINEAR 模型）

            const diff = (dist - rest) / dist * bendStiff;
            let cx = dx * diff, cy = dy * diff, cz = dz * diff;

            if (cx > MAX_CORRECTION_BEND) cx = MAX_CORRECTION_BEND; else if (cx < -MAX_CORRECTION_BEND) cx = -MAX_CORRECTION_BEND;
            if (cy > MAX_CORRECTION_BEND) cy = MAX_CORRECTION_BEND; else if (cy < -MAX_CORRECTION_BEND) cy = -MAX_CORRECTION_BEND;
            if (cz > MAX_CORRECTION_BEND) cz = MAX_CORRECTION_BEND; else if (cz < -MAX_CORRECTION_BEND) cz = -MAX_CORRECTION_BEND;

            const viol = rest - dist;                 // 压缩量（> 0）
            if (viol > maxViol) maxViol = viol;

            px[a] = ax + cx * wa; py[a] = ay + cy * wa; pz[a] = az + cz * wa;
            px[b] = bx - cx * wb; py[b] = by - cy * wb; pz[b] = bz - cz * wb;
        }
        return maxViol;
    }

    // ==========================================================
    // 主循环
    // ==========================================================
    simulate(dt) {
        const c = this.cloth;
        const host = this.host;
        const n = this.n;
        if (!c || n === 0) return;

        const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;

        // ---------- 参数（每帧只读一次）----------
        const pl = host.getParams ? host.getParams(this.params) : this.params;

        // ---------- 休眠判定 ----------
        if (this.asleep) {
            const decorNow = host.decorVersion ? host.decorVersion() : 0;
            const canWake = this._wakeFlag || (host.hasLocks && host.hasLocks()) ||
                            pl.wind > 0.001 || pl.plasticity ||
                            decorNow !== this._decorVersion;
            if (!canWake) {
                this.stats.asleep = true;
                return;
            }
            this.wake();
        }
        this._wakeFlag = false;
        this.stats.asleep = false;

        // ---------- 物件 → 数组 ----------
        this.sync();
        this.refreshSpringMeta(pl);
        this.refreshDecorGravity(host.getDecorations ? host.getDecorations() : EMPTY);
        const lockCount = this.refreshWeights(host.getLocks ? host.getLocks() : EMPTY);

        // ---------- 参数换算 ----------
        const SUBSTEPS = LOW_SPEC.SUBSTEPS;
        const simMult = pl.simMult > 0 ? pl.simMult : 1;
        const subDt = (dt * simMult) / SUBSTEPS;
        const dt2 = subDt * subDt;

        // 下面这些常量以前写在质点循环里（每个质点每子步 2~3 次 Math.pow + 除法），
        // 现在整帧只算一次 —— 这是最直接的性能修复。
        const massRatio = Math.max(0.05, pl.mass / 25);
        const r0 = Math.max(0, 1 - pl.damping * Math.pow(massRatio, pl.airDampingExp));
        const retention = Math.pow(r0, 3 / SUBSTEPS);
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

        const t = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) * 0.001;
        const spatialFreq = pl.windSpatialFreq;
        const windZComp = pl.windZ;
        const noiseAmp = pl.noiseAmp;
        const noiseRandom = pl.noiseRandom;
        const timeWind = t * pl.noiseSpeed;

        const stretchLimit = Math.max(1.001, pl.stretchLimit);
        // 拉伸硬上限（公式与旧版一致：clamp(1+(maxStretch-1)*0.18, 1.012, 1.6)）
        const stretchCap = Math.min(1.6, Math.max(1.012, 1 + (stretchLimit - 1) * 0.18));
        const springDampV = pl.springDamp;
        const bendK = pl.bend;
        const bendStiff = bendK * 0.05;
        const bendOn = bendK > 0.001 && this.bm > 0;
        const compK = pl.compression === undefined ? 1 : pl.compression;

        const plasticOn = !!pl.plasticity;
        const groundOn = !!pl.groundEnabled;
        const groundY = pl.groundY;
        const groundFric = pl.groundFriction;
        const collisionOn = !!pl.collision && !!host.solveCollision;
        // 自碰撞的响应遍数：拖动时只跑 1 遍（旧版经典解算同款策略），
        // 其余情况跟随「碰撞迭代数」滑块；网格只建一次，遍数决定响应次数。
        const collisionPasses = lockCount > 0 ? 1 : Math.max(1, pl.collisionIters | 0);
        // 本帧是否处于"自动解缠"窗口（由上一帧的卡住检测设置）
        const rescueActive = this._rescueLeft > 0;

        // ---------- 迭代数（滑块 + 自动调节器）----------
        const profile = this.profile;
        let sliderIters = pl.iterations | 0;
        if (sliderIters < 1) sliderIters = 1;
        if (sliderIters > profile.maxIterations) sliderIters = profile.maxIterations;
        if (this._sliderIters !== sliderIters) {
            // 用户改了滑块：让调节器从新值重新开始
            this._sliderIters = sliderIters;
            this._iters = sliderIters;
        }
        if (this._iters < 1 || this._iters > sliderIters) this._iters = sliderIters;
        const iters = this._iters;

        // ---- 自适应刚度：让「少量迭代」达到「经典解算大量迭代」的收敛程度 ----
        // 经典解算每帧共做 3 × iterations 次约束迭代，每次残留 (1 - kc)；
        // 本求解器每帧做 SUBSTEPS × iters 次，那就把每次的刚度抬到
        //     k = 1 - (1 - kc)^(3·iterations / (SUBSTEPS·iters))
        // 这样整帧的残留误差和经典解算基本一致（等价于 Blender 用 quality
        // 缩放刚度的做法），手感不会被"换算法"换掉。
        const classicPasses = 3 * sliderIters;
        const ourPasses = Math.max(1, SUBSTEPS * iters);
        const kc = Math.min(0.97, pl.stiffness * (1.5 / stretchLimit));
        let effStiff = 1 - Math.pow(1 - kc, classicPasses / ourPasses);
        if (!(effStiff >= LOW_SPEC.MIN_PASS_STIFF)) effStiff = LOW_SPEC.MIN_PASS_STIFF;
        if (effStiff > LOW_SPEC.MAX_PASS_STIFF) effStiff = LOW_SPEC.MAX_PASS_STIFF;

        // 收敛阈值（相对网格尺寸）
        const rest0 = c.baseRestLength > 0 ? c.baseRestLength : 0.03;
        const convEps = rest0 * CONVERGE_EPS;

        let totalPasses = 0;
        let maxIterUsed = 0;
        let frameViol = 0;      // 本帧最后一次迭代后的最大约束偏差（世界单位）

        // ---------- 子步 ----------
        for (let step = 0; step < SUBSTEPS; step++) {

            // ===== 1. 积分（Verlet）=====
            for (let i = 0; i < n; i++) {
                if (this.iwEff[i] === 0) continue;   // 固定 / 被抓：整段跳过

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

                let dx = vx + (fx + gAccel * gravGX) * dt2;
                let dy = vy + (fy + gAccel * gravGY - this.extraG[i]) * dt2;
                let dz = vz + fz * dt2;

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

            // ===== 2. 弹簧约束迭代（残差足够小就提前收工）=====
            let pass = 0;
            let firstViol = -1;
            let maxViol = 0;
            while (pass < iters) {
                const reverse = (pass & 1) === 1;
                maxViol = this.solveStructural(effStiff, compK, springDampV, plasticOn, pl, stretchCap, reverse);
                if (bendOn) {
                    const bv = this.solveBend(bendStiff, reverse);
                    if (bv > maxViol) maxViol = bv;
                }
                pass++;
                if (firstViol < 0) firstViol = maxViol;
                if (maxViol < convEps) break;                    // 已经解算干净
                if (maxViol < firstViol * CONVERGE_REL) break;   // 收益递减（Blender 的 1% 相对残差）
            }
            frameViol = maxViol;
            totalPasses += pass;
            if (pass > maxIterUsed) maxIterUsed = pass;

            // ===== 3. 自碰撞（可选，交给宿主跑经典实现）=====
            // 自动解缠窗口里，即使自碰撞关着也要跑一遍小半径自接触（第 4 个参数通知宿主）
            if ((collisionOn || rescueActive) && step === SUBSTEPS - 1) {
                // 轻量档：隔帧跑一次（宿主会同时把半径调小、响应遍数压到 1）
                const rescueOnly = !collisionOn;
                const every = rescueOnly ? 1 : (pl.collisionLight ? 2 : profile.collisionEveryNFrames);
                this._collisionTick++;
                if ((this._collisionTick % every) === 0) {
                    this.flush();
                    host.solveCollision(c, this.lockSet, rescueOnly ? 6 : collisionPasses,
                        rescueOnly ? (this._rescueRadius || 0.8) : 0,
                        rescueOnly ? RESCUE_PUSH_MUL : 1);
                    this.sync();
                    // 碰撞只改位置，权重（锁 / 固定）不变，无需重算
                }
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

        // 休眠守卫：除了"几乎不动"，还要求"没有明显残余形变"。
        // 关掉自碰撞时，布料可能已经穿过自己并被约束卡住（局部极小）：此时它确实不动，
        // 但还带着 19%~46% 的相对应变（正常悬挂只有 2.6%~4.2%），说明它还在"较劲" ——
        // 不许睡，让解算继续尝试把它顶出来。
        // 这一次额外扫描只在"即将休眠"的帧才做，所以动着的布料完全不受影响。
        const stillBase = pl.wind <= 0.001 && !plasticOn && lockCount === 0 && !collisionOn;
        if (profile.sleepEnabled && stillBase && maxMove2 < LOW_SPEC.SLEEP_EPS2) {
            let strainOk = true;
            if (pl.sleepGuard) {
                const maxRel = this.maxRelativeStrain();
                this.stats.maxStrain = maxRel;
                strainOk = maxRel < SLEEP_MAX_STRAIN;
                if (!strainOk) {
                    this._strainedFrames = (this._strainedFrames | 0) + 1;
                    if (this._strainedFrames > SLEEP_GUARD_MAX_FRAMES) {
                        strainOk = true;          // 兜底：别为了一个收敛不了的姿态一直烧电
                        this._strainedFrames = 0;
                    }
                } else {
                    this._strainedFrames = 0;
                }
            }
            if (strainOk) {
                this.sleepFrames++;
                if (this.sleepFrames >= LOW_SPEC.SLEEP_FRAMES) {
                    this.asleep = true;
                    this._decorVersion = host.decorVersion ? host.decorVersion() : 0;
                }
            } else {
                this.sleepFrames = 0;
            }
        } else {
            this.sleepFrames = 0;
            this._strainedFrames = 0;
        }

        // ---------- 卡住检测 / 自动解缠 ----------
        this.updateRescue(pl, collisionOn, maxMove2, rest0);

        // ---------- 自动迭代调节器（保软硬、保帧率）----------
        const ms = ((typeof performance !== "undefined" && performance.now) ? performance.now() : 0) - t0;
        this._lastMs = ms;
        this.updateIterationGovernor(ms, sliderIters, profile);

        // ---------- 诊断 ----------
        const st = this.stats;
        st.passes = totalPasses;
        st.iters = maxIterUsed;
        st.effStiff = effStiff;
        st.maxViol = frameViol;
        st.rescues = this._rescues;
        st.rescueLeft = this._rescueLeft;
        st.rescueHot = this._rescueHot = Math.max(0, (this._rescueHot | 0) - 1);
        st.intersections = this.stats.intersections;
        st.ms = ms;
        st.asleep = this.asleep;
        st.sleepFrames = this.sleepFrames;
        st.steps++;
    }

    /**
     * 本帧最大相对应变（|当前长度 − 静止长度| / 静止长度），含弯曲弹簧。
     * 只在"即将休眠"这一刻调用一次 —— 动着的布料根本用不到，所以几乎不花性能。
     */
    maxRelativeStrain() {
        const px = this.px, py = this.py, pz = this.pz;
        const si = this.si, sj = this.sj, sRest = this.sRest;
        const m = this.m;
        let maxRel = 0;
        for (let k = 0; k < m; k++) {
            const a = si[k], b = sj[k];
            const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const rest = sRest[k] || 1e-6;
            const rel = Math.abs(dist - rest) / rest;
            if (rel > maxRel) maxRel = rel;
        }
        const bi = this.bi, bj = this.bj, bRest = this.bRest;
        for (let k = 0; k < this.bm; k++) {
            const a = bi[k], b = bj[k];
            const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const rest = bRest[k] || 1e-6;
            const rel = Math.abs(dist - rest) / rest;
            if (rel > maxRel) maxRel = rel;
        }
        return maxRel;
    }

    /**
     * 卡住检测 / 自动解缠
     * 触发条件（每 JAM_CHECK_FRAMES 帧评估一次）：
     *   · 本帧位移 < 静止长度 × 0.2%（肉眼不可见）
     *   · 但最大相对应变 > 8%（说明它还在"较劲"，不是自然垂坠）
     *   · 用户没有开自碰撞（开着的话本来就一直在处理）
     * 触发后连续 RESCUE_FRAMES 帧做小半径自接触（半径 0.35 格、1 遍），
     * 把贴在一起的两层顶开，通常就能让布料自己解开；最多 MAX_RESCUES 次。
     */
    updateRescue(pl, collisionOn, maxMove2, rest0) {
        if (this._rescueLeft > 0) this._rescueLeft--;
        if (this._rescueCool > 0) this._rescueCool--;
        this.stats.rescueLeft = this._rescueLeft;
        // 用平滑后的位移判断"静止"，这样"几乎不动但还在缓慢蠕动"的卡死状态也能抓到
        const move = Math.sqrt(maxMove2);
        this._moveEma = this._moveEma > 0 ? this._moveEma * 0.75 + move * 0.25 : move;
        if (this._moveEma > rest0 * JAM_MOVE_FRAC) { this._stillFrames = 0; return; }
        this._stillFrames = (this._stillFrames | 0) + 1;
        if (collisionOn || !pl.autoRescue) return;
        if (this._rescueLeft > 0 || this._rescueCool > 0) return;
        if (this._rescues >= MAX_RESCUES) return;
        if (this._stillFrames < JAM_STILL_FRAMES) return;
        // 关键：用"拓扑自检"触发，而不是应变。
        // 两层穿过去的时候每根弹簧都可以是松弛的（应变很小），所以应变判据会漏掉这种情况；
        // 三角面求交才是真正的判据。这个回调比较贵，所以只在布料静止时每 120 帧查一次。
        if ((this._stillFrames - JAM_STILL_FRAMES) % JAM_CHECK_EVERY !== 0) return;
        const hits = this.host.countSelfIntersections ? (this.host.countSelfIntersections(this.cloth) | 0) : 0;
        this.stats.intersections = hits;
        if (hits <= 0) return;
        this._rescueLeft = RESCUE_FRAMES;
        this._rescueCool = RESCUE_COOLDOWN;
        // 半径阶梯：救得越多、半径越大（最终等同标准自碰撞）
        this._rescueRadius = RESCUE_RADII[Math.min(RESCUE_RADII.length - 1, this._rescues)];
        this._rescues++;
        this.stats.rescues = this._rescues;
        this.stats.rescueLeft = this._rescueLeft;
        this.stats.lastRescueStep = this.stats.steps;
        this._rescueHot = 300;          // 扳手图标再多亮 3 秒，避免一闪而过看不到
        this._stillFrames = 0;
    }

    /**
     * 自动迭代调节器
     * 单步耗时超过预算 → 少跑几遍迭代（同时 effStiff 会按同一套数学抬高，
     * 保证整帧的收敛程度不变，也就是"软硬不变、只是没那么精确"）；
     * 耗时富余 → 逐步恢复到滑块设定值。
     * 带迟滞 + 慢速调整，避免在阈值附近来回跳。
     */
    updateIterationGovernor(ms, sliderIters, profile) {
        if (!profile.autoIterations) return;
        this._emaMs = this._emaMs > 0 ? this._emaMs * 0.9 + ms * 0.1 : ms;
        this._govFrames++;
        if (this._govFrames < 20) return;
        this._govFrames = 0;

        const budget = profile.stepBudgetMs;
        const floor = Math.min(profile.minAutoIterations, sliderIters);
        let next = this._iters;

        if (this._emaMs > budget * 1.6) next = this._iters - 2;
        else if (this._emaMs > budget) next = this._iters - 1;
        else if (this._emaMs < budget * 0.5) next = this._iters + 1;

        if (next < floor) next = floor;
        if (next > sliderIters) next = sliderIters;
        this._iters = next;
    }
}

/** 兼容旧名字（script.js 之前 import 的是 LowSpecSolver） */
export const LowSpecSolver = ClothSolver;

const EMPTY = [];
